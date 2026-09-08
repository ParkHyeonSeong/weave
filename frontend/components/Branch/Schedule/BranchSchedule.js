import { useState, useEffect, useMemo, useCallback } from 'react';
import { axios } from '@/library/_axios';
import { ChevronLeft, ChevronRight, Plus, ListTodo, Layers, CalendarRange } from 'lucide-react';
import ScheduleEventModal from './ScheduleEventModal';
import { useDateFormat } from '@/hooks/useDateFormat';
import { parseDateOnly } from '@/library/formatDateTime';
import { useTranslation } from 'react-i18next';

const WEEK_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// 월의 캘린더 그리드 생성 (6주 x 7일)
function buildCalendarGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay(); // 0=Sun
  const gridStart = new Date(year, month, 1 - startOffset);

  const weeks = [];
  const cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// 'YYYY-MM-DD' → 그리드와 같은 프레임의 로컬 자정 Date. ⚠️ new Date('YYYY-MM-DD')는 UTC 자정
// instant라 음수 offset(미주)에서 하루 전 셀에 그려진다 — 컴포넌트로만 만든다.
function fromDateStr(s) {
  const p = parseDateOnly(s);
  return p ? new Date(p.y, p.m - 1, p.d) : null;
}

// 날짜를 YYYY-MM-DD 문자열로
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// 두 날짜가 같은 날인지
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// 스프린트 바를 주 단위로 분할
function buildSprintSegments(sprints, weeks) {
  const segments = [];

  sprints.forEach((sprint) => {
    if (!sprint.start_date || !sprint.end_date) return;

    const sStart = fromDateStr(sprint.start_date);
    const sEnd = fromDateStr(sprint.end_date);
    if (!sStart || !sEnd) return;

    weeks.forEach((week, weekIdx) => {
      const weekStart = week[0];
      const weekEnd = week[6];

      // 이 주와 스프린트가 겹치는지
      if (sStart > weekEnd || sEnd < weekStart) return;

      const segStart = sStart < weekStart ? weekStart : sStart;
      const segEnd = sEnd > weekEnd ? weekEnd : sEnd;

      const colStart = segStart.getDay();
      const colEnd = segEnd.getDay();

      segments.push({
        sprint,
        weekIdx,
        colStart,
        colEnd,
        continuedLeft: sStart < weekStart,
        continuedRight: sEnd > weekEnd,
      });
    });
  });

  return segments;
}

// 겹치는 세그먼트를 lane에 배치
function assignLanes(segments) {
  // 주별로 그룹핑
  const byWeek = {};
  segments.forEach((seg) => {
    if (!byWeek[seg.weekIdx]) byWeek[seg.weekIdx] = [];
    byWeek[seg.weekIdx].push(seg);
  });

  const laneCountByWeek = {};

  Object.keys(byWeek).forEach((weekIdx) => {
    const segs = byWeek[weekIdx].sort((a, b) => a.colStart - b.colStart);
    const lanes = []; // lanes[i] = 해당 lane이 차지하는 마지막 colEnd

    segs.forEach((seg) => {
      let placed = false;
      for (let i = 0; i < lanes.length; i++) {
        if (seg.colStart > lanes[i]) {
          lanes[i] = seg.colEnd;
          seg.lane = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        seg.lane = lanes.length;
        lanes.push(seg.colEnd);
      }
    });

    laneCountByWeek[weekIdx] = lanes.length;
  });

  return laneCountByWeek;
}

// 이벤트를 날짜별로 그룹핑
function groupEventsByDate(events) {
  const map = {};
  events.forEach((evt) => {
    const start = evt.start_date;
    const end = evt.end_date || evt.start_date;
    // 멀티데이 이벤트: 각 날짜에 표시
    const cursor = fromDateStr(start);
    const endDate = fromDateStr(end);
    if (!cursor || !endDate) return;
    while (cursor <= endDate) {
      const key = toDateStr(cursor);
      if (!map[key]) map[key] = [];
      map[key].push(evt);
      cursor.setDate(cursor.getDate() + 1);
    }
  });
  return map;
}

// 태스크를 날짜별로 그룹핑 (start_date, due_date 각각 표시)
function groupTasksByDate(tasks) {
  const map = {};
  tasks.forEach((task) => {
    if (task.start_date) {
      if (!map[task.start_date]) map[task.start_date] = [];
      map[task.start_date].push({ ...task, _dateType: 'start' });
    }
    if (task.due_date && task.due_date !== task.start_date) {
      if (!map[task.due_date]) map[task.due_date] = [];
      map[task.due_date].push({ ...task, _dateType: 'due' });
    }
  });
  return map;
}

// 에픽을 날짜별로 그룹핑 (start_date, due_date 각각 표시)
function groupEpicsByDate(epics) {
  const map = {};
  epics.forEach((epic) => {
    if (epic.start_date) {
      if (!map[epic.start_date]) map[epic.start_date] = [];
      map[epic.start_date].push({ ...epic, _dateType: 'start' });
    }
    if (epic.due_date && epic.due_date !== epic.start_date) {
      if (!map[epic.due_date]) map[epic.due_date] = [];
      map[epic.due_date].push({ ...epic, _dateType: 'due' });
    }
  });
  return map;
}

const MAX_VISIBLE_ITEMS = 3;

export default function BranchSchedule({ branchId }) {
  const { t } = useTranslation();
  const { formatDateOnly, today: personalToday } = useDateFormat();
  // "오늘"은 개인 timezone 기준(date-only 문자열)을 그리드 프레임의 로컬 자정 Date로 옮긴 것.
  const todayDate = () => fromDateStr(personalToday()) || new Date();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const initial = todayDate();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });
  const [events, setEvents] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [calendarTasks, setCalendarTasks] = useState([]);
  const [calendarEpics, setCalendarEpics] = useState([]);
  const [showSprints, setShowSprints] = useState(true);
  const [showTasks, setShowTasks] = useState(false);
  const [showEpics, setShowEpics] = useState(false);
  const [expandedCells, setExpandedCells] = useState({});
  const [eventModal, setEventModal] = useState({ open: false, event: null, defaultDate: '' });

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const today = todayDate();

  // 캘린더 그리드
  const weeks = useMemo(() => buildCalendarGrid(year, month), [year, month]);

  // 데이터 범위 (그리드 시작~끝)
  const rangeStart = useMemo(() => toDateStr(weeks[0][0]), [weeks]);
  const rangeEnd = useMemo(() => toDateStr(weeks[5][6]), [weeks]);

  // 데이터 페칭
  const fetchData = useCallback(async () => {
    try {
      const promises = [
        axios.get(`/branches/${branchId}/sprints`),
        axios.get(`/branches/${branchId}/schedule-events?range_start=${rangeStart}&range_end=${rangeEnd}`),
      ];
      if (showTasks) {
        promises.push(axios.get(`/branches/${branchId}/schedule-events/calendar-tasks?range_start=${rangeStart}&range_end=${rangeEnd}`));
      }
      if (showEpics) {
        promises.push(axios.get(`/branches/${branchId}/schedule-events/calendar-epics?range_start=${rangeStart}&range_end=${rangeEnd}`));
      }

      const results = await Promise.all(promises);
      if (results[0].data.status) setSprints(results[0].data.sprints);
      if (results[1].data.status) setEvents(results[1].data.events);

      let idx = 2;
      if (showTasks) {
        if (results[idx]?.data.status) setCalendarTasks(results[idx].data.tasks);
        idx++;
      } else {
        setCalendarTasks([]);
      }
      if (showEpics) {
        if (results[idx]?.data.status) setCalendarEpics(results[idx].data.epics);
      } else {
        setCalendarEpics([]);
      }
    } catch {}
  }, [branchId, rangeStart, rangeEnd, showTasks, showEpics]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // schedule:updated 이벤트 수신
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener('schedule:updated', handler);
    return () => window.removeEventListener('schedule:updated', handler);
  }, [fetchData]);

  // 스프린트 세그먼트 계산 (토글 OFF면 빈 배열)
  const sprintSegments = useMemo(() => showSprints ? buildSprintSegments(sprints, weeks) : [], [sprints, weeks, showSprints]);
  const laneCountByWeek = useMemo(() => assignLanes(sprintSegments), [sprintSegments]);

  // 이벤트/태스크/에픽을 날짜별 그룹핑
  const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);
  const tasksByDate = useMemo(() => groupTasksByDate(calendarTasks), [calendarTasks]);
  const epicsByDate = useMemo(() => groupEpicsByDate(calendarEpics), [calendarEpics]);

  // 월 이동 시 확장 상태 리셋
  const goToPrev = () => { setCurrentMonth(new Date(year, month - 1, 1)); setExpandedCells({}); };
  const goToNext = () => { setCurrentMonth(new Date(year, month + 1, 1)); setExpandedCells({}); };
  const goToToday = () => {
    const now = todayDate();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setExpandedCells({});
  };

  // 월 라벨
  // 개인 Schedule의 월 라벨/오늘 강조는 개인 timezone을 쓴다(공유 기간이 아니다).
  const monthLabel = formatDateOnly(
    `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-01`,
    { year: 'numeric', month: 'long' },
  );

  // 셀 클릭 -> 일정 생성
  const handleCellClick = (date) => {
    setEventModal({ open: true, event: null, defaultDate: toDateStr(date) });
  };

  // 이벤트 pill 클릭 -> 편집
  const handleEventClick = (e, evt) => {
    e.stopPropagation();
    setEventModal({ open: true, event: evt, defaultDate: '' });
  };

  return (
    <div className="BranchSchedule">
      {/* 상단 액션 바 */}
      <div className="BranchSchedule__Actions">
        <div className="BranchSchedule__MonthNav">
          <button className="BranchSchedule__NavBtn" onClick={goToPrev}>
            <ChevronLeft size={16} />
          </button>
          <span className="BranchSchedule__MonthLabel">{monthLabel}</span>
          <button className="BranchSchedule__NavBtn" onClick={goToNext}>
            <ChevronRight size={16} />
          </button>
          <button className="BranchSchedule__TodayBtn" onClick={goToToday}>
            {t('common.time.today')}
          </button>
        </div>
        <div className="BranchSchedule__ActionsRight">
          <button
            className={`BranchSchedule__ToggleBtn ${showSprints ? 'BranchSchedule__ToggleBtn--active' : ''}`}
            onClick={() => setShowSprints((prev) => !prev)}
            title={showSprints ? t('branch.schedule.hideSprints') : t('branch.schedule.showSprints')}
          >
            <CalendarRange size={14} />
            {t('branch.schedule.sprints')}
          </button>
          <button
            className={`BranchSchedule__ToggleBtn ${showTasks ? 'BranchSchedule__ToggleBtn--active' : ''}`}
            onClick={() => setShowTasks((prev) => !prev)}
            title={showTasks ? t('branch.schedule.hideTasks') : t('branch.schedule.showTasks')}
          >
            <ListTodo size={14} />
            {t('branch.schedule.tasks')}
          </button>
          <button
            className={`BranchSchedule__ToggleBtn ${showEpics ? 'BranchSchedule__ToggleBtn--active' : ''}`}
            onClick={() => setShowEpics((prev) => !prev)}
            title={showEpics ? t('branch.schedule.hideEpics') : t('branch.schedule.showEpics')}
          >
            <Layers size={14} />
            {t('branch.schedule.epics')}
          </button>
          <button
            className="BranchSchedule__CreateBtn"
            onClick={() => setEventModal({ open: true, event: null, defaultDate: toDateStr(today) })}
          >
            <Plus size={14} />
            {t('branch.schedule.addEvent')}
          </button>
        </div>
      </div>

      {/* 캘린더 */}
      <div className="BranchSchedule__Calendar">
        {/* 요일 헤더 */}
        <div className="BranchSchedule__WeekHeader">
          {WEEK_DAY_KEYS.map((day, i) => (
            <div
              key={day}
              className={`BranchSchedule__WeekDay ${i === 0 || i === 6 ? 'BranchSchedule__WeekDay--weekend' : ''}`}
            >
              {t(`branch.schedule.weekDays.${day}`)}
            </div>
          ))}
        </div>

        {/* 그리드 본체 */}
        <div className="BranchSchedule__Grid">
          {weeks.map((week, weekIdx) => {
            const laneCount = laneCountByWeek[weekIdx] || 0;
            // 스프린트 바 높이만큼 이벤트 영역을 아래로 밀기
            const sprintBarOffset = laneCount * 20 + (laneCount > 0 ? 4 : 0);

            return (
              <div className="BranchSchedule__Row" key={weekIdx}>
                {/* 스프린트 바 오버레이 */}
                {laneCount > 0 && (
                  <div className="BranchSchedule__SprintBars">
                    {sprintSegments
                      .filter((seg) => seg.weekIdx === weekIdx)
                      .map((seg, i) => {
                        const leftPct = (seg.colStart / 7) * 100;
                        const widthPct = ((seg.colEnd - seg.colStart + 1) / 7) * 100;
                        const top = (seg.lane || 0) * 20;

                        const statusClass = `BranchSchedule__SprintBar--${seg.sprint.status || 'future'}`;
                        const contLeftClass = seg.continuedLeft ? 'BranchSchedule__SprintBar--continued-left' : '';
                        const contRightClass = seg.continuedRight ? 'BranchSchedule__SprintBar--continued-right' : '';

                        return (
                          <div
                            key={`${seg.sprint.sprint_id}-${weekIdx}-${i}`}
                            className={`BranchSchedule__SprintBar ${statusClass} ${contLeftClass} ${contRightClass}`}
                            style={{ left: `${leftPct}%`, width: `${widthPct}%`, top: `${top}px` }}
                            title={t('branch.schedule.sprintTooltip', {
                              name: seg.sprint.sprint_name,
                              status: t(`branch.sprintStatus.${seg.sprint.status}`, { defaultValue: seg.sprint.status }),
                            })}
                          >
                            {!seg.continuedLeft && seg.sprint.sprint_name}
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* 날짜 셀 */}
                {week.map((date, dayIdx) => {
                  const isOutside = date.getMonth() !== month;
                  const isToday = isSameDay(date, today);
                  const dateStr = toDateStr(date);

                  // 이벤트 > 에픽 > 태스크 순서로 머지
                  const dayEvents = eventsByDate[dateStr] || [];
                  const dayEpics = showEpics ? (epicsByDate[dateStr] || []) : [];
                  const dayTasks = showTasks ? (tasksByDate[dateStr] || []) : [];

                  const allItems = [
                    ...dayEvents.map((evt) => ({ ...evt, _type: 'event' })),
                    ...dayEpics.map((ep) => ({ ...ep, _type: 'epic' })),
                    ...dayTasks.map((t) => ({ ...t, _type: 'task' })),
                  ];

                  const isExpanded = expandedCells[dateStr];
                  const visibleItems = isExpanded ? allItems : allItems.slice(0, MAX_VISIBLE_ITEMS);
                  const hiddenCount = allItems.length - MAX_VISIBLE_ITEMS;

                  const cellClass = [
                    'BranchSchedule__Cell',
                    isOutside ? 'BranchSchedule__Cell--outside' : '',
                    isToday ? 'BranchSchedule__Cell--today' : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <div
                      key={dayIdx}
                      className={cellClass}
                      onClick={() => handleCellClick(date)}
                    >
                      <div className="BranchSchedule__DateNum">
                        {date.getDate()}
                      </div>
                      <div className="BranchSchedule__Events" style={{ marginTop: sprintBarOffset > 0 ? sprintBarOffset : undefined }}>
                        {visibleItems.map((item) => {
                          if (item._type === 'epic') {
                            return (
                              <div
                                key={`epic-${item.epic_id}-${item._dateType}`}
                                className="BranchSchedule__EpicPill"
                                onClick={(e) => e.stopPropagation()}
                                title={t('branch.schedule.epicTooltip', { name: item.epic_name, count: item.task_count })}
                              >
                                <span
                                  className="BranchSchedule__EventDot"
                                  style={{ backgroundColor: item.color || '#5E6AD2' }}
                                />
                                <span className="BranchSchedule__EpicName">{item.epic_name}</span>
                                {item.task_count > 0 && (
                                  <span className="BranchSchedule__EpicBadge">{item.task_count}</span>
                                )}
                              </div>
                            );
                          }
                          if (item._type === 'task') {
                            return (
                              <div
                                key={`task-${item.task_id}-${item._dateType}`}
                                className="BranchSchedule__TaskPill"
                                onClick={(e) => e.stopPropagation()}
                                title={`${item.display_id} ${item.title}`}
                              >
                                <span className="BranchSchedule__TaskId">{item.display_id}</span>
                                <span className="BranchSchedule__TaskTitle">{item.title}</span>
                              </div>
                            );
                          }
                          // event
                          return (
                            <div
                              key={`event-${item.schedule_event_id}`}
                              className="BranchSchedule__EventPill"
                              onClick={(e) => handleEventClick(e, item)}
                            >
                              <span
                                className="BranchSchedule__EventDot"
                                style={{ backgroundColor: item.color || '#5E6AD2' }}
                              />
                              <span className="BranchSchedule__EventTitle">{item.title}</span>
                            </div>
                          );
                        })}
                        {!isExpanded && hiddenCount > 0 && (
                          <div
                            className="BranchSchedule__MoreEvents"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedCells((prev) => ({ ...prev, [dateStr]: true }));
                            }}
                          >
                            {t('branch.schedule.moreItems', { count: hiddenCount })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* 일정 모달 */}
      {eventModal.open && (
        <ScheduleEventModal
          branchId={branchId}
          event={eventModal.event}
          defaultDate={eventModal.defaultDate}
          onClose={() => setEventModal({ open: false, event: null, defaultDate: '' })}
        />
      )}
    </div>
  );
}
