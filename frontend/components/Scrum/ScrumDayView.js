import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsDownUp, ChevronsUpDown, CircleCheck } from 'lucide-react';
import ScrumDayCard, { dayCardDomId } from './ScrumDayCard';
import Avatar from '@/components/common/Avatar';
import { useWorkspaceDateFormat } from '@/hooks/useDateFormat';
import useWeekWritten from '@/library/useWeekWritten';
import { WEEKDAYS } from '@/library/scrumViewModel';
import { scrollBehavior } from '@/library/scrollRegion';

// 팀원 목록의 5칸 점: 할 일을 썼으면 채움, 아직 오지 않은 날의 빈 칸은 빈 테두리, 지난 빈 칸은 회색.
// written이 null(첫 동기화 전이라 모름)이면 채움·회색 없이 날짜로 정해지는 빈 테두리·선택 표시만 둔다.
const dotClass = (written, upcoming, selected) => `ScrumDay__Dot${
  written ? ' is-written' : upcoming ? ' is-upcoming' : written === false ? ' is-missed' : ''}${selected ? ' is-selected' : ''}`;

const RAIL_GAP = 16;        // sticky top과 같은 값 — 스크롤 영역 위아래로 이만큼 띄운다
const RAIL_MIN_MAX = 120;   // 아주 낮은 창에서도 목록이 이보다 작아지지는 않게

// 팀원 목록이 카드 옆(같은 줄)에 있으면 스크롤 영역에 보이는 높이에 맞춘 상한(px), 카드 위로 쌓였으면 null.
// 참조 패널이 열려 본문만 좁아지는 경우도 있어 뷰포트가 아니라 실제 배치를 잰다.
function useRailMaxHeight(layoutRef) {
  const [railMax, setRailMax] = useState(null);
  useEffect(() => {
    const layout = layoutRef.current;
    const scroller = layout?.parentElement;   // .ScrumBoard__BodyMain — 하루 보기의 스크롤 컨테이너
    if (!layout || !scroller || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const rail = layout.firstElementChild.getBoundingClientRect();
      const main = layout.lastElementChild.getBoundingClientRect();
      const beside = main.left >= rail.right;   // 줄바꿈되면 카드 목록이 아래로 내려가 왼쪽이 같아진다
      setRailMax(beside ? Math.max(RAIL_MIN_MAX, scroller.clientHeight - RAIL_GAP * 2) : null);
    };
    const observer = new ResizeObserver(measure);   // 처음 관찰할 때도 한 번 불린다
    observer.observe(layout);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [layoutRef]);
  return railMax;
}

// 하루 보기(스펙 §6.2): 왼쪽 팀원 목록 + 고른 날의 머리(날짜·요약·필터·접기) + 사람 카드.
// memo: 보드뷰는 접속자(presence)가 바뀔 때마다 다시 그려지므로, props가 같으면 카드·편집기까지
// 내려가지 않게 막는다(ScrumWeekGrid와 같은 이유). 문서 변경은 useWeekWritten이 직접 받는다.
// synced: 주간 문서의 첫 동기화. 그 전에는 썼는지 말하지 않는다(목록 ✓/작성 전·점 채움/회색·요약·카드 상태).
function ScrumDayView({ ydoc, members, meId, selectedDay, todayIdx, dates, synced }) {
  const { t } = useTranslation();
  const { today, formatDateOnly } = useWorkspaceDateFormat();
  const railTitleId = useId();
  const dayTitleId = useId();
  const [mineOnly, setMineOnly] = useState(false);
  const [folded, setFolded] = useState(() => new Set());
  const [jump, setJump] = useState(null);   // { userId } — 매번 새 객체라 같은 사람을 다시 눌러도 스크롤한다
  const layoutRef = useRef(null);
  const railMax = useRailMaxHeight(layoutRef);

  // 사람마다 이번 주 5일의 할 일·리캡 작성 여부. 목록 상태·점은 할 일만 센다(스펙 §8).
  const status = useWeekWritten(ydoc, members, synced);

  const total = members.length;
  const written = members.filter((m) => status.get(m.user_id).plan[selectedDay]).length;
  const recaps = members.filter((m) => status.get(m.user_id).gap[selectedDay]).length;
  const todayStr = today();
  // 'YYYY-MM-DD'끼리는 문자열 순서가 날짜 순서다. 지난주는 전부 지난 날, 다음 주는 전부 남은 날.
  const isUpcoming = (d) => !!todayStr && dates[d].date > todayStr;

  const iAmMember = members.some((m) => m.user_id === meId);
  const visible = mineOnly ? members.filter((m) => m.user_id === meId) : members;
  const anyFolded = visible.some((m) => folded.has(m.user_id));

  const toggleFold = useCallback((userId) => setFolded((prev) => {
    const next = new Set(prev);
    if (next.has(userId)) next.delete(userId); else next.add(userId);
    return next;
  }), []);
  // 보이는 카드만 대상으로 한다('나만'일 때 숨은 카드의 접힘은 그대로)
  const toggleAll = () => setFolded((prev) => {
    const next = new Set(prev);
    visible.forEach((m) => (anyFolded ? next.delete(m.user_id) : next.add(m.user_id)));
    return next;
  });

  useEffect(() => {
    if (!jump) return;
    document.getElementById(dayCardDomId(jump.userId))?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }, [jump]);
  const jumpTo = (userId) => {
    if (mineOnly && userId !== meId) setMineOnly(false);   // '나만'으로 숨긴 카드면 먼저 보이게 한다
    setJump({ userId });
  };

  return (
    <div className="ScrumDay" ref={layoutRef}>
      {/* 카드 옆에 있을 때만 sticky(is-sticky): 이 칸이 카드 목록 높이로 늘어나 안쪽 목록이 따라올 자리가 되고,
          목록은 스크롤 영역 높이를 넘지 않게 잘려 안에서 스크롤된다. 카드 위로 쌓이면 sticky·상한 모두 없다. */}
      <div className="ScrumDay__RailWrap">
        <aside
          className={`ScrumDay__Rail${railMax ? ' is-sticky' : ''}`}
          style={railMax ? { maxHeight: railMax } : undefined}
          aria-labelledby={railTitleId}
        >
          <h2 className="ScrumDay__RailTitle" id={railTitleId}>
            {t('scrum.day.railTitle')}{' '}
            <span className="ScrumDay__RailCount">{total}</span>
          </h2>
          <ul className="ScrumDay__Members">
            {members.map((m) => {
              const plans = status.get(m.user_id).plan;
              return (
                <li key={m.user_id}>
                  <button type="button" className="ScrumDay__Member" onClick={() => jumpTo(m.user_id)}>
                    {/* 이름이 옆에 있으니 아바타의 이름 라벨은 버튼 이름에서 뺀다 */}
                    <span className="ScrumDay__MemberAvatar" aria-hidden="true"><Avatar user={m} size={28} /></span>
                    <span className="ScrumDay__MemberMain">
                      <span className="ScrumDay__MemberName">
                        <span className="ScrumDay__MemberNameText">{m.username}</span>
                        {m.user_id === meId && <em className="ScrumDay__You">{t('scrum.you')}</em>}
                      </span>
                      <span className="ScrumDay__Dots" aria-hidden="true">
                        {WEEKDAYS.map((d) => (
                          <span key={d} className={dotClass(synced ? plans[d] : null, isUpcoming(d), d === selectedDay)} />
                        ))}
                      </span>
                    </span>
                    {synced && (plans[selectedDay] ? (
                      <CircleCheck className="ScrumDay__MemberDone" size={16} role="img" aria-label={t('scrum.day.statusWritten')} />
                    ) : (
                      <span className="ScrumDay__MemberEmpty">{t('scrum.day.statusEmpty')}</span>
                    ))}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="ScrumDay__Legend" aria-hidden="true">
            <span><span className="ScrumDay__Dot is-written" />{t('scrum.day.legendWritten')}</span>
            <span><span className="ScrumDay__Dot is-missed" />{t('scrum.day.legendMissing')}</span>
            <span><span className="ScrumDay__Dot is-upcoming" />{t('scrum.day.legendUpcoming')}</span>
          </div>
        </aside>
      </div>

      <section className="ScrumDay__Main" aria-labelledby={dayTitleId}>
        <div className="ScrumDay__Head">
          <div className="ScrumDay__HeadText">
            <div className="ScrumDay__TitleRow">
              <h2 className="ScrumDay__Title" id={dayTitleId}>
                {formatDateOnly(dates[selectedDay].date, { month: 'long', day: 'numeric', weekday: 'long' })}
              </h2>
              {selectedDay === todayIdx && <span className="ScrumDay__Today">{t('common.time.today')}</span>}
            </div>
            {/* 첫 동기화 전에는 자리만 지킨 채 숨긴다(.is-pending = visibility:hidden, aria-hidden) — 동기화 때 머리가 밀리지 않게 */}
            <p className={`ScrumDay__Summary${synced ? '' : ' is-pending'}`} aria-hidden={synced ? undefined : true}>
              {written || recaps ? t('scrum.day.summary', { total, written, recaps }) : t('scrum.day.summaryNone')}
            </p>
          </div>
          <div className="ScrumDay__Tools">
            {iAmMember && (
              <div className="ScrumSegment" role="group" aria-label={t('scrum.day.railTitle')}>
                <button type="button" className="ScrumSegment__Btn" aria-pressed={!mineOnly} onClick={() => setMineOnly(false)}>
                  {t('scrum.day.filterAll')}
                </button>
                <button type="button" className="ScrumSegment__Btn" aria-pressed={mineOnly} onClick={() => setMineOnly(true)}>
                  {t('scrum.day.filterMine')}
                </button>
              </div>
            )}
            <button type="button" className="ScrumDay__FoldAll" onClick={toggleAll}>
              {anyFolded ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
              {t(anyFolded ? 'scrum.day.unfoldAll' : 'scrum.day.foldAll')}
            </button>
          </div>
        </div>
        <div className="ScrumDay__Cards">
          {visible.map((m) => (
            <ScrumDayCard
              key={m.user_id}
              ydoc={ydoc}
              member={m}
              members={members}
              isMe={m.user_id === meId}
              dayIdx={selectedDay}
              open={!folded.has(m.user_id)}
              onToggle={toggleFold}
              synced={synced}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

export default memo(ScrumDayView);
