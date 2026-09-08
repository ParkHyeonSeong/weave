import { useMemo, useRef, useState, useEffect } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import EntityIcon from '@/components/common/EntityIcon';
import Avatar from '@/components/common/Avatar';
import { useDateFormat } from '@/hooks/useDateFormat';
import { addDaysToDateOnly, diffDateOnlyDays, parseDateOnly, toDateOnly } from '@/library/formatDateTime';
import { useTranslation } from 'react-i18next';

// ── 캘린더 유틸 ─────────────────────────────────────────────────────────────
// 이 타임라인의 축은 **달력 날짜**다. 내부 프레임을 전부 'YYYY-MM-DD' 문자열로 다룬다 —
// 예전처럼 new Date(str + 'T00:00:00')로 로컬 Date를 만들면 (a) 렌더 timezone에 따라
// 하루가 밀리고 (b) DST 경계에서 ms 나눗셈이 흔들린다.
const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (s) => s || '';                        // React key (이미 정규 문자열)
const parseDate = (str) => toDateOnly(str) || null;    // date-only 정규화
const addDays = addDaysToDateOnly;
const diffDays = (a, b) => diffDateOnlyDays(a, b) ?? 0;
const firstOfMonth = (s) => { const p = parseDateOnly(s); return p ? `${p.y}-${pad2(p.m)}-01` : ''; };
const nextMonth = (s) => {
  const p = parseDateOnly(s);
  if (!p) return '';
  return p.m === 12 ? `${p.y + 1}-01-01` : `${p.y}-${pad2(p.m + 1)}-01`;
};
// 요일도 UTC 컴포넌트로만 — 로컬 Date를 거치지 않는다.
const dayOfWeek = (s) => {
  const p = parseDateOnly(s);
  return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : 0;
};

const DAY_WIDTH = 26;        // 1일 = 26px
const LANE_HEIGHT = 50;      // 각 task row 높이
const GROUP_HEAD_HEIGHT = 32;

export default function TrackTimeline({
  items, links, branchById, workflowStatuses,
  selectedItemId, onSelectItem,
}) {
  const { t } = useTranslation();
  // "오늘"은 파생값이므로 **개인 timezone**의 오늘을 쓴다(브라우저 timezone 아님).
  const { formatDateOnly, today: personalToday, timeZone } = useDateFormat();
  const TODAY = useMemo(() => personalToday(), [personalToday, timeZone]);
  const monthLabel = (s) => formatDateOnly(s, { month: 'short' });

  // 1) 날짜 범위 계산
  const { rangeStart, rangeEnd, totalDays } = useMemo(() => {
    const validItems = items.filter((it) => !it.restricted && (it.start_date || it.due_date));
    if (validItems.length === 0) {
      const s = addDays(TODAY, -7);
      const e = addDays(TODAY, 28);
      return { rangeStart: s, rangeEnd: e, totalDays: diffDays(s, e) };
    }
    let min = null, max = null;
    validItems.forEach((it) => {
      const s = parseDate(it.start_date) || parseDate(it.due_date);
      const e = parseDate(it.due_date) || parseDate(it.start_date);
      if (!min || s < min) min = s;
      if (!max || e > max) max = e;
    });
    const pad = 4;
    const start = addDays(min, -pad);
    const end = addDays(max, pad);
    return { rangeStart: start, rangeEnd: end, totalDays: diffDays(start, end) };
  }, [items, TODAY]);

  // 2) Branch별로 그룹핑
  const groupedItems = useMemo(() => {
    const byBranch = new Map();
    items.forEach((it) => {
      if (it.restricted) return;
      if (!it.start_date && !it.due_date) return;
      const key = it.branch_id;
      if (!byBranch.has(key)) byBranch.set(key, []);
      byBranch.get(key).push(it);
    });
    return Array.from(byBranch.entries()).map(([branchId, list]) => ({
      branch: branchById[branchId] || { name: '?', color: '#9CA3AF', key: '?' },
      items: list.sort((a, b) => {
        // date-only는 0패딩 ISO라 문자열 비교가 곧 날짜순이다.
        const aDate = parseDate(a.start_date || a.due_date) || '';
        const bDate = parseDate(b.start_date || b.due_date) || '';
        return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
      }),
    }));
  }, [items, branchById]);

  // 3) 위치 계산 함수
  const dayToX = (date) => diffDays(rangeStart, date) * DAY_WIDTH;

  // 4) Item rect 계산 (groupedItems 그리는 순서대로)
  const itemRects = useMemo(() => {
    const rects = new Map();
    let y = 0;
    groupedItems.forEach((grp) => {
      y += GROUP_HEAD_HEIGHT;
      grp.items.forEach((it) => {
        const s = parseDate(it.start_date) || parseDate(it.due_date);
        const e = parseDate(it.due_date) || parseDate(it.start_date);
        const x = dayToX(s);
        const w = Math.max(diffDays(s, e) * DAY_WIDTH + DAY_WIDTH, 40);
        rects.set(it.item_id, { x, y: y + 10, w, h: LANE_HEIGHT - 20 });
        y += LANE_HEIGHT;
      });
    });
    return rects;
  }, [groupedItems, rangeStart]);

  // 5) 의존성 화살표 — row 사이 gutter 따라 라우팅
  //    source 막대 끝에서 같은 행 우측으로 빠짐 → row 사이 빈 공간 (gutter)으로 세로 이동
  //    → target 막대 왼쪽 직전에서 target row로 진입.
  //    이렇게 하면 막대 위를 가로지르지 않음.
  const linkPaths = useMemo(() => {
    return links
      .map((l) => {
        const s = itemRects.get(l.source_item_id);
        const e = itemRects.get(l.target_item_id);
        if (!s || !e) return null;
        const sx = s.x + s.w;
        const sy = s.y + s.h / 2;
        const ex = e.x;
        const ey = e.y + e.h / 2;
        const isMat = l.materialized && l.link_type === 'flow_to';
        const isRel = l.link_type === 'relates_to';

        const goingDown = ey > sy;
        // gutter: source row의 막대 아래(또는 위) 빈 공간 y좌표
        const sourceGutterY = goingDown
          ? s.y + s.h + (LANE_HEIGHT - s.h) / 2 - 1   // source row 막대 바로 아래 gutter 중앙
          : s.y - (LANE_HEIGHT - s.h) / 2 + 1;        // source row 막대 위 gutter 중앙

        // source 끝에서 가로로 약간 → 세로로 gutter까지 → 가로로 target 직전까지 → 세로로 target row로
        const sourceExitX = sx + 14;
        const targetEntryX = ex - 14;

        const r = 6;  // 둥근 모서리
        const d = [
          `M ${sx} ${sy}`,
          `L ${sourceExitX - r} ${sy}`,
          `Q ${sourceExitX} ${sy} ${sourceExitX} ${sy + (goingDown ? r : -r)}`,
          `L ${sourceExitX} ${sourceGutterY - (goingDown ? r : -r)}`,
          `Q ${sourceExitX} ${sourceGutterY} ${sourceExitX + r} ${sourceGutterY}`,
          `L ${targetEntryX - r} ${sourceGutterY}`,
          `Q ${targetEntryX} ${sourceGutterY} ${targetEntryX} ${sourceGutterY + (ey > sourceGutterY ? r : -r)}`,
          `L ${targetEntryX} ${ey - (ey > sourceGutterY ? r : -r)}`,
          `Q ${targetEntryX} ${ey} ${targetEntryX + r} ${ey}`,
          `L ${ex} ${ey}`,
        ].join(' ');

        return { id: l.link_id, d, isMat, isRel };
      })
      .filter(Boolean);
  }, [links, itemRects]);

  // 6) 날짜 헤더 (주 단위)
  const weekTicks = useMemo(() => {
    const ticks = [];
    let d = rangeStart;
    // 가장 가까운 월요일로 정렬
    const dow = dayOfWeek(d);
    if (dow !== 1) d = addDays(d, (8 - dow) % 7);
    while (d && d <= rangeEnd) {
      ticks.push(d);
      d = addDays(d, 7);
    }
    return ticks;
  }, [rangeStart, rangeEnd]);

  // 7) 월 라벨
  const monthTicks = useMemo(() => {
    const ticks = [];
    let d = firstOfMonth(rangeStart);
    while (d && d <= rangeEnd) {
      ticks.push(d);
      d = nextMonth(d);
    }
    return ticks;
  }, [rangeStart, rangeEnd]);

  const totalWidth = totalDays * DAY_WIDTH;
  const totalHeight = groupedItems.reduce(
    (sum, g) => sum + GROUP_HEAD_HEIGHT + g.items.length * LANE_HEIGHT, 0
  );
  const todayX = dayToX(TODAY);

  // 가로 스크롤 동기화 (헤더 ↔ 본문) + 세로 스크롤 동기화 (좌측 레인 라벨)
  const headRef = useRef(null);
  const bodyRef = useRef(null);
  const lanesInnerRef = useRef(null);
  const syncScroll = (e) => {
    if (headRef.current) headRef.current.scrollLeft = e.target.scrollLeft;
    if (lanesInnerRef.current) lanesInnerRef.current.style.transform = `translateY(-${e.target.scrollTop}px)`;
  };

  // Today 위치로 자동 스크롤 (마운트 시 1회)
  const didScrollRef = useRef(false);
  useEffect(() => {
    if (didScrollRef.current) return;
    if (bodyRef.current && todayX > 0) {
      bodyRef.current.scrollLeft = Math.max(0, todayX - 200);
      didScrollRef.current = true;
    }
  }, [todayX]);

  return (
    <div className="TrackTimeline">
      {/* 상단: 월 + 주 헤더 */}
      <div className="TrackTimeline__HeadWrap" ref={headRef}>
        <div className="TrackTimeline__Head" style={{ width: totalWidth }}>
          {/* 월 라벨 */}
          <div className="TrackTimeline__Months">
            {monthTicks.map((m, i) => {
              const next = monthTicks[i + 1] || rangeEnd;
              const x = dayToX(m);
              const w = (diffDays(m, next)) * DAY_WIDTH;
              return (
                <div key={dateKey(m)} className="TrackTimeline__MonthCell" style={{ left: x, width: w }}>
                  <span className="TrackTimeline__MonthLabel">{monthLabel(m)}</span>
                </div>
              );
            })}
          </div>
          {/* 주 라벨 */}
          <div className="TrackTimeline__Weeks">
            {weekTicks.map((w) => (
              <div
                key={dateKey(w)}
                className="TrackTimeline__WeekCell"
                style={{ left: dayToX(w) }}
              >
                <span className="TrackTimeline__WeekLabel">{formatDateOnly(w, { month: 'numeric', day: 'numeric' })}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 본문: 좌측 라벨 + 가로 스크롤되는 캔버스 */}
      <div className="TrackTimeline__Body">
        {/* 좌측 lane labels — 캔버스 세로 스크롤과 translateY로 동기화 */}
        <div className="TrackTimeline__Lanes">
          <div className="TrackTimeline__LanesInner" ref={lanesInnerRef} style={{ height: totalHeight }}>
            {(() => {
              const out = [];
              let y = 0;
              groupedItems.forEach((grp) => {
                out.push(
                  <div
                    key={`g-${grp.branch.branch_id}`}
                    className="TrackTimeline__LaneGroup"
                    style={{ top: y, height: GROUP_HEAD_HEIGHT, borderLeftColor: grp.branch.color }}
                  >
                    <EntityIcon
                      icon={grp.branch.icon}
                      color={grp.branch.color}
                      size={14}
                      entityType="branch"
                    />
                    <span className="TrackTimeline__LaneGroupName">{grp.branch.name}</span>
                    <span className="TrackTimeline__LaneGroupCount">{grp.items.length}</span>
                  </div>
                );
                y += GROUP_HEAD_HEIGHT;
                grp.items.forEach((it) => {
                  out.push(
                    <div
                      key={`l-${it.item_id}`}
                      className={`TrackTimeline__LaneRow ${selectedItemId === it.item_id ? 'TrackTimeline__LaneRow--selected' : ''}`}
                      style={{ top: y, height: LANE_HEIGHT }}
                      onClick={() => onSelectItem(it.item_id)}
                    >
                      <span className="TrackTimeline__LaneTaskId">{it.display_id}</span>
                      <span className="TrackTimeline__LaneTaskTitle">{it.title}</span>
                      {it.parent && (
                        <span className="TrackTimeline__LaneParentChip" title={it.parent.title}>
                          └ {it.parent.display_id}
                        </span>
                      )}
                    </div>
                  );
                  y += LANE_HEIGHT;
                });
              });
              return out;
            })()}
          </div>
        </div>

        {/* 우측 canvas */}
        <div className="TrackTimeline__Canvas" ref={bodyRef} onScroll={syncScroll}>
          <div
            className="TrackTimeline__CanvasInner"
            style={{ width: totalWidth, height: totalHeight }}
          >
            {/* 주말 음영 + 주 그리드 */}
            <div className="TrackTimeline__Grid" aria-hidden>
              {weekTicks.map((w) => (
                <div key={`gw-${dateKey(w)}`} className="TrackTimeline__GridWeek" style={{ left: dayToX(w) }} />
              ))}
            </div>

            {/* 행 분리선 */}
            <div className="TrackTimeline__Rows" aria-hidden>
              {(() => {
                const out = [];
                let y = 0;
                groupedItems.forEach((grp) => {
                  out.push(
                    <div
                      key={`gh-${grp.branch.branch_id}`}
                      className="TrackTimeline__RowGroupHead"
                      style={{ top: y, height: GROUP_HEAD_HEIGHT }}
                    />
                  );
                  y += GROUP_HEAD_HEIGHT;
                  grp.items.forEach((it) => {
                    out.push(
                      <div
                        key={`rr-${it.item_id}`}
                        className="TrackTimeline__RowDivider"
                        style={{ top: y + LANE_HEIGHT - 1 }}
                      />
                    );
                    y += LANE_HEIGHT;
                  });
                });
                return out;
              })()}
            </div>

            {/* Today 라인 */}
            {todayX >= 0 && todayX <= totalWidth && (
              <div className="TrackTimeline__Today" style={{ left: todayX }}>
                <span className="TrackTimeline__TodayPin">{t('common.time.today')}</span>
              </div>
            )}

            {/* 의존성 화살표 (SVG) */}
            <svg
              className="TrackTimeline__Links"
              width={totalWidth}
              height={totalHeight}
              aria-hidden
            >
              <defs>
                <marker
                  id="tl-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                </marker>
              </defs>
              {linkPaths.map((lp) => (
                <path
                  key={lp.id}
                  d={lp.d}
                  fill="none"
                  className={`TrackTimeline__Link ${lp.isMat ? 'TrackTimeline__Link--mat' : ''} ${lp.isRel ? 'TrackTimeline__Link--rel' : ''}`}
                  markerEnd={lp.isRel ? undefined : 'url(#tl-arrow)'}
                />
              ))}
            </svg>

            {/* Task 막대 */}
            {groupedItems.map((grp) =>
              grp.items.map((it) => {
                const r = itemRects.get(it.item_id);
                if (!r) return null;
                const ws = workflowStatuses[it.status] || {};
                const isSelected = selectedItemId === it.item_id;
                return (
                  <div
                    key={`b-${it.item_id}`}
                    className={`TrackTimeline__Bar ${isSelected ? 'TrackTimeline__Bar--selected' : ''} TrackTimeline__Bar--${it.status}`}
                    style={{
                      left: r.x, top: r.y, width: r.w, height: r.h,
                      '--branch-color': grp.branch.color,
                      '--status-color': ws.color || '#9CA3AF',
                    }}
                    onClick={() => onSelectItem(it.item_id)}
                    title={it.title}
                  >
                    <span className="TrackTimeline__BarLeft" />
                    <span className="TrackTimeline__BarTitle">{it.title}</span>
                    {it.assignees && it.assignees[0] && (
                      <Avatar
                        className="TrackTimeline__BarAvatar"
                        user={it.assignees[0]}
                        size={18}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
