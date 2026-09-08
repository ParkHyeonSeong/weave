import { useTranslation } from 'react-i18next';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { axios } from '@/library/_axios';
import { ddayBadge } from '@/library/dueBadge';
import { useDateFormat } from '@/hooks/useDateFormat';
import { progressPercent } from '@/library/subtaskProgress';
import { formatSprintRange } from '@/library/formatTime';

const BUCKET_TITLE_KEY = {
  open: 'home.statDrill.buckets.open', in_progress: 'home.statDrill.buckets.inProgress',
  due_this_week: 'home.statDrill.buckets.dueThisWeek', active_sprint: 'home.statDrill.buckets.activeSprint',
};
const CAP = 8;

export default function StatDrilldownPopover({ bucket, onClose, onOpenTask, onOpenSprint }) {
  const { t } = useTranslation();
  // 마감일은 date-only(요일 포함 표시), D-day는 개인 timezone의 오늘 기준 파생값.
  const { formatDateOnly, today: personalToday } = useDateFormat();
  const dueText = (iso) => (iso ? formatDateOnly(iso, { month: 'numeric', day: 'numeric', weekday: 'short' }) : t('common.time.noDueDate'));
  const [state, setState] = useState({ status: 'loading', items: [], total: 0 });
  const [expanded, setExpanded] = useState(false);
  const [flip, setFlip] = useState(false); // 뷰포트 우측 넘침 시 우측 정렬(반응형 2열에서 idx1·3 카드 대응)
  const ref = useRef(null);

  // 정렬 판정: 앵커(.StatTile__Anchor) 왼쪽 + 팝오버 폭이 뷰포트를 넘으면 우측으로 flip.
  // 팝오버 자신의 rect가 아니라 앵커 기준으로 재므로 flip 상태와 무관 → 플립-플롭 없음.
  // resize도 구독해 연 상태에서 창 크기가 바뀌어도 재측정(2열↔4열 전환 대응).
  useLayoutEffect(() => {
    const measure = () => {
      if (!ref.current) return;
      const anchor = ref.current.parentElement; // .StatTile__Anchor (position: relative)
      const width = ref.current.offsetWidth || 330;
      const left = anchor ? anchor.getBoundingClientRect().left : 0;
      setFlip(left + width > window.innerWidth - 8);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const load = async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const res = await axios.get('/branches/home-stats/items', { params: { bucket, limit: 50 } });
      if (res.data.status) {
        setState({ status: 'ready', items: res.data.items, total: res.data.total_count });
      } else {
        setState({ status: 'error', items: [], total: 0 });
      }
    } catch {
      setState({ status: 'error', items: [], total: 0 });
    }
  };

  useEffect(() => { load(); /* bucket 고정 마운트당 1회 */ }, []); // eslint-disable-line

  // 바깥 클릭 / ESC 닫기. 트리거 타일(.StatTile__Anchor) 클릭은 타일 onClick 토글에
  // 위임하므로 여기서 무시한다 — 안 그러면 mousedown 닫힘 → 이어지는 click 재열림으로
  // "같은 카드 재클릭 닫힘"이 동작하지 않는다.
  useEffect(() => {
    const onDoc = (e) => {
      if (e.target.closest && e.target.closest('.StatTile__Anchor')) return;
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const isSprint = bucket === 'active_sprint';
  // 모든 bucket 동일 처리: 상위 CAP개 → "전체 보기"로 펼침(로드분 스크롤) → total>로드분이면 "외 N개" 안내.
  // 스프린트도 같은 패턴을 공유해 50개+여도 한 번에 다 렌더/포커스되지 않게 한다(특수처리 제거).
  const shown = expanded ? state.items : state.items.slice(0, CAP);
  const hasMore = state.items.length > CAP;
  const capped = state.total > state.items.length; // total > limit(50) → 일부만 로드됨

  return (
    <div className={`StatDrill${flip ? ' StatDrill--right' : ''}`} ref={ref}>
      <div className="StatDrill__Head">
        <span>{t(BUCKET_TITLE_KEY[bucket])}</span>
        <span className="StatDrill__HeadMeta">
          {state.status === 'ready' && (isSprint
            ? t('home.statDrill.sprintCount', { count: state.total })
            : `${t('home.statDrill.sortByDue')} · ${expanded
              ? (capped
                ? t('home.statDrill.top', { value: state.items.length })
                : t('home.statDrill.all', { value: state.total }))
              : t('home.statDrill.top', { value: Math.min(CAP, state.total) })}`)}
        </span>
      </div>

      {state.status === 'loading' && (
        <>{[0, 1, 2].map((i) => (
          <div className="StatDrill__Sk" key={i}><span className="StatDrill__Dot" style={{ background: 'var(--color-border)' }} /><span className="sk" /></div>
        ))}</>
      )}

      {state.status === 'error' && (
        <div className="StatDrill__Error">{t('home.statDrill.loadFailed')}<button type="button" onClick={load}>{t('common.actions.retry')}</button></div>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <div className="StatDrill__Empty">{isSprint ? t('home.statDrill.emptySprints') : t('home.statDrill.emptyItems')}</div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <>
          <div className="StatDrill__Scroll">
            {shown.map((it) => isSprint ? (
              <div className="StatDrill__Row" key={it.sprint_id}
                   role="button" tabIndex={0}
                   onClick={() => onOpenSprint({ branchId: it.branch_id })}
                   onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenSprint({ branchId: it.branch_id }); } }}>
                <div className="StatDrill__Main">
                  <div className="StatDrill__SprintTop">
                    <span className="StatDrill__Title">{it.sprint_name}</span>
                    <span className="StatDrill__Pct">{progressPercent({ done: it.done_count, total: it.total_count_tasks })}%</span>
                  </div>
                  <div className="StatDrill__Sub">
                    <span className="StatDrill__Branch">#{it.branch_name}</span>
                    {it.start_date && it.end_date ? ` · ${formatSprintRange(it.start_date, it.end_date)}` : ''}
                  </div>
                  <div className="StatDrill__Bar"><i style={{ width: `${progressPercent({ done: it.done_count, total: it.total_count_tasks })}%` }} /></div>
                </div>
              </div>
            ) : (
              <div className="StatDrill__Row" key={it.task_id}
                   role="button" tabIndex={0}
                   onClick={() => onOpenTask({ branchId: it.branch_id, taskId: it.task_id })}
                   onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenTask({ branchId: it.branch_id, taskId: it.task_id }); } }}>
                <span className="StatDrill__Dot" />
                <div className="StatDrill__Main">
                  <div className="StatDrill__Title">{it.title}</div>
                  <div className="StatDrill__Sub"><span className="StatDrill__Branch">#{it.branch_name}</span> · {dueText(it.due_date)}</div>
                </div>
                {(() => { const b = ddayBadge(it.due_date, personalToday()); return <span className={`StatDrill__Dday StatDrill__Dday--${b.cls}`}>{b.text}</span>; })()}
              </div>
            ))}
          </div>
          {hasMore && !expanded && (
            <button type="button" className="StatDrill__Foot StatDrill__Foot--more" onClick={() => setExpanded(true)}>{capped ? t('home.statDrill.showTop', { value: state.items.length }) : t('home.statDrill.showAll', { value: state.total })}</button>
          )}
          {expanded && hasMore && (
            <button type="button" className="StatDrill__Foot StatDrill__Foot--collapse" onClick={() => setExpanded(false)}>{t('home.statDrill.collapse')}</button>
          )}
          {state.total > state.items.length && (
            <div className="StatDrill__Note">{t('home.statDrill.moreInBoards', { value: state.total - state.items.length })}</div>
          )}
        </>
      )}
    </div>
  );
}
