import { memo, useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, Sunrise, Sunset } from 'lucide-react';
import ScrumWeekCell from './ScrumWeekCell';
import Avatar from '@/components/common/Avatar';
import { useWorkspaceDateFormat } from '@/hooks/useDateFormat';
import useWeekWritten from '@/library/useWeekWritten';
import { weekCellKey } from '@/library/scrumCellContent';
import { WEEKDAYS, WEEKDAY_KEYS, WEEKDAY_LONG_KEYS, weekColumnTemplate } from '@/library/scrumViewModel';

// 행 =칸 키의 row 값('plan' | 'gap') · 라벨 · 아이콘(하루 카드의 칸 라벨과 같은 해·노을)
const ROWS = [
  { row: 'plan', label: 'scrum.grid.rowPlan', Icon: Sunrise },
  { row: 'gap', label: 'scrum.grid.rowRecap', Icon: Sunset },
];
// 첫 동기화 전 열 폭: 아무도 안 썼는지 모르므로 넓게 보지 않는 요일을 모두 '누군가 쓴 요일'(1fr)로 둔다 —
// 빈 문서로 '아무도 안 쓴 요일'(0.55fr)을 그렸다가 동기화 뒤 넓어지지 않게.
const ASSUME_WRITTEN = WEEKDAYS.map(() => true);

// 한 주 보기(스펙 §6.3): 요일 머리 행 + 사람 카드(머리 + 보이는 행 × 월~금).
// 넓게 보는 요일(focusDay) 칸만 편집하고, 나머지는 한 줄 요약(ScrumWeekCell). 열 폭은
// 넓게 보는 요일 > 누군가 할 일·리캡을 쓴 요일 > 아무도 안 쓴 요일(weekColumnTemplate).
// 머리 행과 각 카드의 행이 같은 열 값을 받아 줄이 맞는다. 트랙 최소 폭의 합보다 좁으면
// .ScrumWeek가 그만큼 넓어지고 스크롤 영역(.ScrumBoard__BodyMain)이 가로로 넘긴다.
// memo: 보드뷰는 접속자(presence)가 바뀔 때마다 다시 그려지므로, props(전부 원시값·안정값)가 같으면
// 칸 편집기까지 내려가지 않게 막는다. 문서 변경은 useWeekWritten이 직접 받는다.
// synced: 주간 문서의 첫 동기화. 그 전에는 요일 머리의 수를 자리만 지킨 채 숨기고(.is-pending = visibility:hidden,
// aria-hidden — 동기화 때 머리 행 높이가 바뀌지 않게), 카드 머리의 '이번 주 n일'은 그리지 않는다(칸은 그대로).
function ScrumWeekGrid({
  ydoc, members, meId, dates, focusDay, onFocusDay, showPlan, showRecap, mineOnly, todayIdx, synced,
}) {
  const { t } = useTranslation();
  // 공유 주차의 날짜(보드뷰가 주차로 한 번 계산해 넘긴다) — 시간대 변환 없이 표기만 locale에 맞춘다.
  const { formatDateOnly } = useWorkspaceDateFormat();
  const idBase = useId();
  const [folded, setFolded] = useState(() => new Set());

  // 사람마다 5일 × 할 일·리캡 작성 여부. 머리 행의 수·열 폭·카드 머리가 모두 여기서 나온다.
  const written = useWeekWritten(ydoc, members, synced);

  const total = members.length;
  const dayCounts = WEEKDAYS.map((d) => ({
    plan: members.filter((m) => written.get(m.user_id).plan[d]).length,
    recap: members.filter((m) => written.get(m.user_id).gap[d]).length,
  }));
  // '누군가 쓴 요일'은 할 일 또는 리캡에 내용이 있는 요일 — 보이는 행·나만과 상관없이 전원 기준(스펙 §8)
  const columns = weekColumnTemplate(focusDay, synced ? dayCounts.map((c) => c.plan + c.recap > 0) : ASSUME_WRITTEN);
  const gridStyle = { gridTemplateColumns: columns };

  // 요일마다 고정된 '넓히기' 함수 — 칸(memo)에 렌더마다 새 함수를 넘기지 않는다
  const widen = useMemo(() => WEEKDAYS.map((d) => () => onFocusDay(d)), [onFocusDay]);
  const toggleFold = useCallback((userId) => setFolded((prev) => {
    const next = new Set(prev);
    if (next.has(userId)) next.delete(userId); else next.add(userId);
    return next;
  }), []);

  const visible = mineOnly ? members.filter((m) => m.user_id === meId) : members;
  const rows = ROWS.filter(({ row }) => (row === 'plan' ? showPlan : showRecap));
  const dayNames = WEEKDAYS.map((d) => t(WEEKDAY_LONG_KEYS[d]));   // 월요일…금요일 — 머리 title·칸의 '더 보기' 이름

  return (
    <div className="ScrumWeek">
      <div className="ScrumWeek__Head" style={gridStyle}>
        <div className="ScrumWeek__Corner">
          {t('scrum.day.railTitle')}{' '}
          <span className="ScrumWeek__CornerCount">{total}</span>
        </div>
        {WEEKDAYS.map((d) => {
          const focused = d === focusDay;
          return (
            <button
              key={dates[d].date}
              type="button"
              className="ScrumWeek__Day"
              aria-pressed={focused}
              title={focused ? undefined : t('scrum.week.widen', { day: dayNames[d] })}
              onClick={() => onFocusDay(d)}
            >
              <span className="ScrumWeek__DayTop">
                <span>{t(WEEKDAY_KEYS[d])}</span>
                <span className="ScrumWeek__DayDate">
                  {formatDateOnly(dates[d].date, { month: 'numeric', day: 'numeric' })}
                </span>
                {d === todayIdx && <span className="ScrumWeek__Today">{t('common.time.today')}</span>}
              </span>
              <span className={`ScrumWeek__DayCounts${synced ? '' : ' is-pending'}`} aria-hidden={synced ? undefined : true}>
                {t('scrum.week.dayCounts', { plan: dayCounts[d].plan, recap: dayCounts[d].recap, total })}
              </span>
            </button>
          );
        })}
      </div>

      {visible.map((m) => {
        const userId = m.user_id;
        const isMe = userId === meId;
        const open = !folded.has(userId);
        const nameId = `${idBase}-name-${userId}`;
        const mine = written.get(userId);
        return (
          <section
            key={userId}
            className={`ScrumWeek__Card${isMe ? ' ScrumWeek__Card--me' : ''}`}
            aria-labelledby={nameId}
          >
            <header className="ScrumWeek__CardHead">
              <Avatar user={m} size={28} className="ScrumWeek__Avatar" />
              <h3 className="ScrumWeek__Name" id={nameId}>{m.username}</h3>
              {isMe && <em className="ScrumWeek__You">{t('scrum.you')}</em>}
              {synced && (
                <span className="ScrumWeek__Note">
                  {t('scrum.week.memberNote', {
                    plan: mine.plan.filter(Boolean).length,
                    recap: mine.gap.filter(Boolean).length,
                  })}
                </span>
              )}
              <button
                type="button"
                className="ScrumWeek__Toggle"
                aria-expanded={open}
                aria-label={t(open ? 'scrum.day.fold' : 'scrum.day.unfold', { name: m.username })}
                onClick={() => toggleFold(userId)}
              >
                <ChevronUp size={16} />
              </button>
            </header>
            {open && rows.map(({ row, label, Icon }) => (
              <div key={row} className="ScrumWeek__Row" style={gridStyle}>
                <div className="ScrumWeek__RowLabel">
                  <Icon size={14} />
                  <span className="ScrumWeek__RowLabelText">{t(label)}</span>
                </div>
                {WEEKDAYS.map((d) => (
                  <div key={d} className={`ScrumWeek__Cell${d === todayIdx ? ' is-today' : ''}`}>
                    <ScrumWeekCell
                      ydoc={ydoc}
                      fragmentKey={weekCellKey(userId, d, row)}
                      members={members}
                      focused={d === focusDay}
                      onFocus={widen[d]}
                      dayName={dayNames[d]}
                    />
                  </div>
                ))}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

export default memo(ScrumWeekGrid);
