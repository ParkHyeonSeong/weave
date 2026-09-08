import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { axios } from '@/library/_axios';
import { Plus } from 'lucide-react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import EpicBar from './EpicBar';
import EpicModal from '@/components/modal/EpicModal';
import DropdownPortal from '@/components/common/DropdownPortal';
import { useDateFormat } from '@/hooks/useDateFormat';
import { diffDateOnlyDays, toDateOnly } from '@/library/formatDateTime';

import { formatSprintRange } from '@/library/formatTime';
import { useTranslation } from 'react-i18next';

const STATUS_LABEL_KEYS = { future: 'branch.sprintStatus.future', active: 'branch.sprintStatus.active', closed: 'branch.sprintStatus.closed' };

// 겹치는 스프린트를 별도 lane에 배치
function assignLanes(sprintBars) {
  const sorted = [...sprintBars].sort((a, b) => a.left - b.left);
  const lanes = [];
  for (const bar of sorted) {
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (bar.left >= lanes[i]) {
        lanes[i] = bar.left + bar.width;
        bar.lane = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bar.lane = lanes.length;
      lanes.push(bar.left + bar.width);
    }
  }
  return lanes.length;
}

const VIEW_MODES = [
  { key: 'week', labelKey: 'branch.epics.viewMode.week', pxPerDay: 16 },
  { key: 'month', labelKey: 'branch.epics.viewMode.month', pxPerDay: 4 },
  { key: 'quarter', labelKey: 'branch.epics.viewMode.quarter', pxPerDay: 1.5 },
];

const DEFAULT_nameColWidth = 400;
const MIN_nameColWidth = 200;
const MAX_nameColWidth = 600;

export default function EpicTimeline({ branchId, onSelectEpic }) {
  const { t } = useTranslation();
  const { formatDateOnly, today: personalToday, timeZone } = useDateFormat();
  // 타임라인의 "오늘"은 파생값 — 개인 timezone의 달력 날짜('YYYY-MM-DD')를 쓴다.
  const todayStr = useMemo(() => personalToday(), [personalToday, timeZone]);
  const [epics, setEpics] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [epicModal, setEpicModal] = useState({ open: false });
  const [viewMode, setViewMode] = useState('month');
  const [sprintPopover, setSprintPopover] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [nameColWidth, setNameColWidth] = useState(DEFAULT_nameColWidth);
  const popoverRef = useRef(null);
  const scrollRef = useRef(null);
  const didScroll = useRef(false);
  const resizeRef = useRef(null);
  const didInitColWidth = useRef(false);
  const [hoveredSprintId, setHoveredSprintId] = useState(null);
  const sprintAnchorRef = useRef(null);
  const sprintTooltipRef = useRef(null);

  // DnD 센서: 5px 이동 후 드래그 시작 (클릭과 구분)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // 스크롤포트(가로 스크롤 뷰포트) 폭 기준 자동 이름 컬럼 폭 — 넓은 컨테이너에서 400px 고정폭이
  // 캘린더 영역을 다 잡아먹지 않도록 40%를 상한(400px)으로 캡. 단, 매우 좁은 컨테이너에서는
  // MIN_nameColWidth(200px) 바닥이 우선이라 결과 폭이 스크롤포트의 40%를 넘을 수 있다.
  const computeAutoWidth = useCallback(() => {
    const scrollportWidth = scrollRef.current?.clientWidth || 0;
    if (scrollportWidth <= 0) return DEFAULT_nameColWidth;
    return Math.min(DEFAULT_nameColWidth, Math.max(MIN_nameColWidth, scrollportWidth * 0.4));
  }, []);

  // 최초로 ScrollWrap이 DOM에 붙는 시점 1회만 자동폭 적용 — 이후 수동 리사이즈는 건드리지 않음.
  // filteredEpics는 아래에서 useMemo로 선언되므로 여기서 참조할 수 없어 loading/epics.length를 대리
  // 트리거로 사용: 최초 로드(loading false 전환)뿐 아니라 "에픽 0개 브랜치에서 첫 에픽 생성" 같은
  // 뒤늦은 마운트도 잡아야 하므로 둘 다 의존성에 둔다.
  useLayoutEffect(() => {
    if (didInitColWidth.current || !scrollRef.current) return;
    didInitColWidth.current = true;
    setNameColWidth(computeAutoWidth());
  }, [loading, epics.length, computeAutoWidth]);

  // 컬럼 리사이즈 핸들러
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = nameColWidth;

    const onMove = (ev) => {
      const newWidth = Math.min(MAX_nameColWidth, Math.max(MIN_nameColWidth, startWidth + ev.clientX - startX));
      setNameColWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [nameColWidth]);

  // 더블클릭: 스크롤포트 기준 자동폭으로 리셋
  const handleResizeReset = useCallback(() => {
    setNameColWidth(computeAutoWidth());
  }, [computeAutoWidth]);

  useEffect(() => {
    fetchData();
  }, [branchId]);

  useEffect(() => {
    const handleRefresh = () => fetchData();
    window.addEventListener('epic:updated', handleRefresh);
    return () => window.removeEventListener('epic:updated', handleRefresh);
  }, [branchId]);

  const fetchData = async () => {
    try {
      const [epicRes, sprintRes] = await Promise.all([
        axios.get(`/branches/${branchId}/epics`),
        axios.get(`/branches/${branchId}/sprints`),
      ]);
      if (epicRes.data.status) setEpics(epicRes.data.epics);
      if (sprintRes.data.status) setSprints(sprintRes.data.sprints);
    } catch {}
    setLoading(false);
  };

  const modeConfig = VIEW_MODES.find((m) => m.key === viewMode);
  const pxPerDay = modeConfig?.pxPerDay || 4;

  // 고정 범위: 1년 전 ~ 2년 후.
  // 축은 **달력 날짜**다 — 로컬 Date로 구성하되 픽셀 산술에 쓰는 값은 'YYYY-MM-DD'로
  // 뽑아 diffDateOnlyDays로 센다(ms 나눗셈은 DST 경계에서 하루가 어긋난다).
  const { timelineStartStr, totalDays, headerLabels } = useMemo(() => {
    const p = todayStr.split('-');
    const y = Number(p[0]);
    const m = Number(p[1]);            // 1-based
    const start = new Date(y - 1, m - 1, 1);
    const end = new Date(y + 2, m - 1, 0);
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const startStr = ymd(start);
    const endStr = ymd(end);
    const total = diffDateOnlyDays(startStr, endStr) ?? 0;

    // 월 단위 라벨
    const labels = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const isJan = cursor.getMonth() === 0;
      // 눈금 라벨은 달력 축이지 instant가 아니다 — date-only 문자열로 만들어 넘긴다.
      const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-01`;
      labels.push({
        label: isJan
          ? formatDateOnly(monthKey, { month: 'short', year: 'numeric' })
          : formatDateOnly(monthKey, { month: 'short' }),
        offset: diffDateOnlyDays(startStr, monthKey) ?? 0,
        isYear: isJan,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return { timelineStartStr: startStr, totalDays: total, headerLabels: labels };
    // formatDateOnly는 locale에 의존한다 — 언어를 바꾸면 눈금 라벨도 다시 계산돼야 한다.
  }, [formatDateOnly, todayStr]);

  const timelineWidth = totalDays * pxPerDay;

  // 날짜 -> px 위치.
  // sprint/epic 날짜는 date-only다 — new Date('YYYY-MM-DD')는 UTC 자정 instant라
  // 음수 offset(미주)에서 막대가 하루 왼쪽으로 밀렸다. 달력 일수로만 센다.
  const getPosition = useCallback((dateStr) => {
    const days = diffDateOnlyDays(timelineStartStr, toDateOnly(dateStr));
    if (days == null) return null;
    return days * pxPerDay;
  }, [timelineStartStr, pxPerDay]);

  // 오늘 위치로 자동 스크롤 (최초 1회)
  useEffect(() => {
    if (loading || didScroll.current || !scrollRef.current) return;
    const todayPx = getPosition(todayStr);
    if (todayPx != null) {
      const container = scrollRef.current;
      container.scrollLeft = todayPx - container.clientWidth / 3;
      didScroll.current = true;
    }
  }, [loading, getPosition, todayStr]);

  // viewMode 변경 시 오늘 중심으로 재스크롤
  useEffect(() => {
    if (!scrollRef.current) return;
    const todayPx = getPosition(todayStr);
    if (todayPx != null) {
      const container = scrollRef.current;
      container.scrollLeft = todayPx - container.clientWidth / 3;
    }
  }, [viewMode, getPosition, todayStr]);

  // 팝오버 외부 클릭 닫기
  useEffect(() => {
    if (!sprintPopover) return;
    const handleClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setSprintPopover(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [sprintPopover]);

  // 스프린트 바 데이터 + lane 계산
  const { sprintBars, laneCount } = useMemo(() => {
    const bars = sprints
      .filter((s) => s.start_date && s.end_date)
      .map((s) => {
        const left = getPosition(s.start_date);
        const right = getPosition(s.end_date);
        if (left == null || right == null) return null;
        return { ...s, left, width: Math.max(right - left, 2), lane: 0 };
      })
      .filter(Boolean);
    const count = assignLanes(bars);
    return { sprintBars: bars, laneCount: count };
  }, [sprints, getPosition]);

  const todayPx = useMemo(() => {
    return getPosition(todayStr);
  }, [getPosition, todayStr]);

  // 필터: done 숨기기 (sort_order는 서버에서 이미 적용)
  const filteredEpics = useMemo(() => {
    return showDone ? epics : epics.filter((e) => e.status !== 'done');
  }, [epics, showDone]);

  // 드래그 중인 에픽
  const activeEpic = activeId ? filteredEpics.find((e) => String(e.epic_id) === activeId) : null;

  // 드래그 시작 -> 스크롤 잠금
  const handleDragStart = ({ active }) => {
    setActiveId(active.id);
    if (scrollRef.current) scrollRef.current.style.overflowX = 'hidden';
  };

  // 드래그 완료 -> 스크롤 복원 + 순서 저장
  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);
    if (scrollRef.current) scrollRef.current.style.overflowX = 'auto';
    if (!over || active.id === over.id) return;

    const oldIndex = filteredEpics.findIndex((e) => String(e.epic_id) === active.id);
    const newIndex = filteredEpics.findIndex((e) => String(e.epic_id) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // 낙관적 업데이트
    const reordered = arrayMove(filteredEpics, oldIndex, newIndex);
    setEpics(showDone ? reordered : reordered.concat(epics.filter((e) => e.status === 'done')));

    try {
      await axios.post(`/branches/${branchId}/epics/reorder`, {
        epic_ids: reordered.map((e) => e.epic_id),
      });
    } catch {
      fetchData(); // 실패 시 원복
    }
  };

  if (loading) return null;

  return (
    <div className="EpicTimeline">
      {/* 상단 액션 */}
      <div className="EpicTimeline__Actions">
        <button
          className="EpicTimeline__CreateBtn"
          onClick={() => setEpicModal({ open: true })}
        >
          <Plus size={14} />
          {t('branch.epics.createEpic')}
        </button>

        <label className="EpicTimeline__ShowDone">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          {t('branch.epics.showDone')}
        </label>

        <div className="EpicTimeline__ViewModes">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.key}
              className={`EpicTimeline__ViewBtn ${viewMode === mode.key ? 'EpicTimeline__ViewBtn--active' : ''}`}
              onClick={() => setViewMode(mode.key)}
            >
              {t(mode.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {filteredEpics.length === 0 ? (
        <div className="EpicTimeline__Empty">
          {t('branch.epics.empty')}
        </div>
      ) : (
        <div className="EpicTimeline__Container">
          {/* 스크롤 가능 영역 */}
          <div className="EpicTimeline__ScrollWrap" ref={scrollRef}>
            <div className="EpicTimeline__Inner" style={{ width: nameColWidth + timelineWidth }}>

              {/* 월 헤더 */}
              <div className="EpicTimeline__Header">
                <div className="EpicTimeline__NameCol" style={{ width: nameColWidth, minWidth: nameColWidth }}>
                  <div
                    className="EpicTimeline__ResizeHandle"
                    onMouseDown={handleResizeStart}
                    onDoubleClick={handleResizeReset}
                    title={t('branch.epics.resizeHint')}
                  />
                </div>
                <div className="EpicTimeline__TimelineCol" style={{ width: timelineWidth }}>
                  {headerLabels.map((m, i) => (
                    <div
                      key={i}
                      className={`EpicTimeline__Month ${m.isYear ? 'EpicTimeline__Month--year' : ''}`}
                      style={{ left: m.offset * pxPerDay }}
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* 스프린트 라벨 행 */}
              {sprintBars.length > 0 && (
                <div className="EpicTimeline__SprintRow">
                  <div className="EpicTimeline__NameCol" style={{ width: nameColWidth, minWidth: nameColWidth }}>
                    <span className="EpicTimeline__SprintRowLabel">{t('branch.epics.sprintsRow')}</span>
                  </div>
                  <div
                    className="EpicTimeline__SprintRowTimeline"
                    style={{ width: timelineWidth, height: laneCount * 24 + 8 }}
                  >
                    {sprintBars.map((s) => {
                      const statusClass = s.status === 'active' ? 'EpicTimeline__SprintLabel--active'
                        : s.status === 'closed' ? 'EpicTimeline__SprintLabel--closed' : '';
                      const isOpen = sprintPopover === s.sprint_id;
                      return (
                        <div
                          key={s.sprint_id}
                          className={`EpicTimeline__SprintLabel ${statusClass}`}
                          style={{
                            left: s.left,
                            width: s.width,
                            top: s.lane * 24 + 4,
                          }}
                          onClick={() => setSprintPopover(isOpen ? null : s.sprint_id)}
                          onMouseEnter={(e) => { sprintAnchorRef.current = e.currentTarget; setHoveredSprintId(s.sprint_id); }}
                          onMouseLeave={() => setHoveredSprintId(null)}
                        >
                          <span className="EpicTimeline__SprintLabelText">{s.sprint_name}</span>
                          {/* __ScrollWrap이 overflow-y:hidden이라 앵커 기준 fixed 포털로 클리핑 회피 (DropdownPortal 재사용) */}
                          {hoveredSprintId === s.sprint_id && (
                            <DropdownPortal anchorRef={sprintAnchorRef} open dropdownRef={sprintTooltipRef}>
                              <div className="EpicTimeline__SprintTooltip">
                                {s.sprint_name}
                                <br />
                                {formatSprintRange(s.start_date, s.end_date)}
                              </div>
                            </DropdownPortal>
                          )}
                          {isOpen && (
                            <div className="EpicTimeline__SprintPopover" ref={popoverRef} onClick={(e) => e.stopPropagation()}>
                              <div className="EpicTimeline__SprintPopoverName">{s.sprint_name}</div>
                              <div className="EpicTimeline__SprintPopoverMeta">
                                <span className={`EpicTimeline__SprintPopoverStatus EpicTimeline__SprintPopoverStatus--${s.status}`}>
                                  {STATUS_LABEL_KEYS[s.status] ? t(STATUS_LABEL_KEYS[s.status]) : s.status}
                                </span>
                                <span className="EpicTimeline__SprintPopoverDate">
                                  {formatSprintRange(s.start_date, s.end_date)}
                                </span>
                              </div>
                              {s.goal && (
                                <div className="EpicTimeline__SprintPopoverGoal">{s.goal}</div>
                              )}
                              <div className="EpicTimeline__SprintPopoverTasks">
                                {s.task_count != null ? t('branch.epics.taskCount', { count: s.task_count }) : ''}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 에픽 행 */}
              <div className="EpicTimeline__Body">
                {/* Sprint 구간 배경 */}
                <div className="EpicTimeline__SprintBg" style={{ left: nameColWidth, width: timelineWidth }}>
                  {sprints
                    .filter((s) => s.start_date && s.end_date)
                    .map((s) => {
                      const left = getPosition(s.start_date);
                      const right = getPosition(s.end_date);
                      if (left == null || right == null) return null;
                      return (
                        <div
                          key={s.sprint_id}
                          className="EpicTimeline__SprintRange"
                          style={{ left, width: right - left }}
                        />
                      );
                    })}
                </div>

                {/* 오늘 마커 */}
                {todayPx != null && (
                  <div className="EpicTimeline__Today" style={{ left: nameColWidth + todayPx }}>
                    <div className="EpicTimeline__TodayLine" />
                  </div>
                )}

                {/* DnD 영역 */}
                <DndContext
                  sensors={sensors}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => {
                    setActiveId(null);
                    if (scrollRef.current) scrollRef.current.style.overflowX = 'auto';
                  }}
                >
                  <SortableContext
                    items={filteredEpics.map((e) => String(e.epic_id))}
                    strategy={verticalListSortingStrategy}
                  >
                    {filteredEpics.map((epic) => (
                      <EpicBar
                        key={epic.epic_id}
                        epic={epic}
                        getPosition={getPosition}
                        timelineWidth={timelineWidth}
                        nameColWidth={nameColWidth}
                        onClick={() => onSelectEpic(epic)}
                      />
                    ))}
                  </SortableContext>
                  <DragOverlay dropAnimation={null}>
                    {activeEpic && (
                      <EpicBar
                        epic={activeEpic}
                        getPosition={getPosition}
                        timelineWidth={timelineWidth}
                        nameColWidth={nameColWidth}
                        isOverlay
                      />
                    )}
                  </DragOverlay>
                </DndContext>
              </div>
            </div>
          </div>
        </div>
      )}

      {epicModal.open && (
        <EpicModal
          branchId={branchId}
          epic={null}
          onClose={() => setEpicModal({ open: false })}
        />
      )}
    </div>
  );
}
