import { memo, useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CircleAlert, CircleCheck, Clock, Lightbulb, ThumbsUp } from 'lucide-react';
import useScrumRetroCollab from '@/library/useScrumRetroCollab';
import useCollabSynced from '@/library/useCollabSynced';
import useYDocRevision from '@/library/useYDocRevision';
import { cellHasContent, retroCellKey } from '@/library/scrumCellContent';
import { retroDeadline } from '@/library/scrumViewModel';
import { useWorkspaceDateFormat } from '@/hooks/useDateFormat';
import ScrumCell from './ScrumCell';
import Avatar from '@/components/common/Avatar';
import CollabStatusBadge from '@/components/shared/CollabStatusBadge';

const getProfile = () => { try { return JSON.parse(sessionStorage.getItem('profile') || '{}'); } catch { return {}; } };

// 회고 세 칸 — 칸 키의 col 값 · 이름 · 항목별 열 머리 아이콘
const COLS = [
  { col: 'keep', label: 'scrum.retro.colKeep', Icon: ThumbsUp },
  { col: 'problem', label: 'scrum.retro.colProblem', Icon: CircleAlert },
  { col: 'try', label: 'scrum.retro.colTry', Icon: Lightbulb },
];
const DEADLINE_KEYS = {
  remaining: 'scrum.retro.deadlineRemaining',
  today: 'scrum.retro.deadlineToday',
  passed: 'scrum.retro.deadlinePassed',
};
const NO_KEYS = new Set();

// 항목별 보기의 열 하나(스펙 §6.5): 머리(아이콘·이름·쓴 사람 수) → 내 블록(늘, 비어 있어도 바로 쓰게) →
// 이 칸에 내용이 있는 다른 사람 블록 → 맨 아래 '아직 안 쓴 사람' 아바타 한 줄.
// 멤버 목록은 보드뷰가 본인을 맨 위로 정렬해 넘기므로 그 순서가 곧 블록 순서다.
// 블록은 사람 id를 key로 그린다 — 다른 사람 블록이 생기고 없어져도 내 편집기는 다시 만들어지지 않는다.
// synced: 회고 문서의 첫 동기화 — 그 전에는 쓴 사람 수를 자리만 지키며 숨기고(.is-pending·aria-hidden — 열 머리 높이·
// 제목 줄바꿈이 동기화 때 바뀌지 않게), '아직 안 쓴 사람'은 그리지 않는다(블록·편집기는 그대로).
function RetroTopicColumn({ col, label, Icon, ydoc, members, meId, written, pinned, onTouch, synced }) {
  const { t } = useTranslation();
  const idBase = useId();
  const wrote = (m) => written.get(m.user_id)[col];
  const shown = (m) => m.user_id === meId || wrote(m) || pinned.has(retroCellKey(m.user_id, col));
  const blocks = members.filter(shown);
  const notYet = members.filter((m) => !shown(m));
  const titleId = `${idBase}-title`;
  const notYetId = `${idBase}-not-yet`;

  return (
    <section className={`RetroTopic__Col RetroTopic__Col--${col}`} aria-labelledby={titleId}>
      <header className="RetroTopic__ColHead">
        <Icon size={16} />
        <h3 className="RetroTopic__ColTitle" id={titleId}>{t(label)}</h3>
        <span className={`RetroTopic__ColCount${synced ? '' : ' is-pending'}`} aria-hidden={synced ? undefined : true}>
          {t('scrum.retro.colWriters', { count: members.filter(wrote).length })}
        </span>
      </header>
      <div className="RetroTopic__Blocks">
        {blocks.map((m) => {
          const key = retroCellKey(m.user_id, col);
          const isMe = m.user_id === meId;
          const nameId = `${idBase}-name-${m.user_id}`;
          return (
            <article
              key={m.user_id}
              className={`RetroTopic__Block${isMe ? ' RetroTopic__Block--me' : ''}`}
              aria-labelledby={nameId}
              onFocus={isMe ? undefined : () => onTouch(key)}
            >
              <div className="RetroTopic__Who">
                {/* 이름이 옆에 있으니 아바타 이름표는 읽지 않는다 */}
                <span className="RetroTopic__WhoAvatar" aria-hidden="true"><Avatar user={m} size={22} /></span>
                <span className="RetroTopic__Name" id={nameId}>{m.username}</span>
                {isMe && <em className="RetroTopic__You">{t('scrum.you')}</em>}
              </div>
              <ScrumCell ydoc={ydoc} fragmentKey={key} placeholder="" members={members} />
            </article>
          );
        })}
      </div>
      {synced && notYet.length > 0 && (
        <div className="RetroTopic__NotYet">
          <span className="RetroTopic__NotYetLabel" id={notYetId}>{t('scrum.retro.notYet')}</span>
          <ul className="RetroTopic__NotYetList" aria-labelledby={notYetId}>
            {notYet.map((m) => (
              <li key={m.user_id}>
                <span className="RetroView__Face RetroView__Face--faded" role="img" aria-label={m.username} title={m.username}>
                  <Avatar user={m} size={22} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// 사람별 보기의 카드 한 장: 머리(아바타·이름·'나'·작성 상태) + Keep | Problem | Try 세 칸(전부 편집기).
// 작성 상태는 회고 문서의 첫 동기화(synced) 뒤에만 그린다.
function RetroPersonCard({ member, isMe, wrote, synced, ydoc, members }) {
  const { t } = useTranslation();
  const nameId = useId();
  return (
    <article className={`RetroPerson__Card${isMe ? ' RetroPerson__Card--me' : ''}`} aria-labelledby={nameId}>
      <header className="RetroPerson__Head">
        <Avatar user={member} size={30} className="RetroPerson__Avatar" />
        <h3 className="RetroPerson__Name" id={nameId}>{member.username}</h3>
        {isMe && <em className="RetroPerson__You">{t('scrum.you')}</em>}
        {synced && (wrote ? (
          <span className="RetroPerson__Status RetroPerson__Status--written">
            <CircleCheck size={14} />
            {t('scrum.day.statusWritten')}
          </span>
        ) : (
          <span className="RetroPerson__Status">{t('scrum.day.statusEmpty')}</span>
        ))}
      </header>
      <div className="RetroPerson__Panes">
        {COLS.map(({ col, label }) => (
          <section key={col} className={`RetroPerson__Pane RetroPerson__Pane--${col}`}>
            <span className="RetroPerson__PaneLabel">{t(label)}</span>
            <ScrumCell ydoc={ydoc} fragmentKey={retroCellKey(member.user_id, col)} placeholder="" members={members} />
          </section>
        ))}
      </div>
    </article>
  );
}

// 회고 탭 본문(스펙 §6.5). 멤버마다 별도 fragment(`${userId}:keep|problem|try`)에 바인딩 → 동시 협업·격리.
// 기간 선택/이동·보기 전환은 상위(ScrumBoardView) 툴바가 맡고, 여기선 넘겨받은 retro(기간 문서)를
// view('topic' 항목별 | 'person' 사람별)에 맞게 그린다. 쓰기만 하고 발표하지 않는 비동기 회고라
// 머리에 마감(현재 회고일 때만)과 누가 썼는지를 둔다.
// memo: 보드뷰는 주간 문서 접속자(presence)가 바뀔 때마다 다시 그려지므로, props(전부 원시값·안정값)가 같으면
// 여기서 멈춘다. 회고 문서 변경은 useYDocRevision이 직접 받는다.
function RetroView({ boardId, members = [], retro = null, manual = false, view = 'topic', meId = null, isCurrent = false }) {
  const { t } = useTranslation();
  // 공용 기간(회고 마감)은 workspace 날짜로만 — 설정 확정 전 today()는 null이라 마감 칩을 숨긴다(fail-closed)
  const { today, formatDateOnly, formatDateOnlyRange } = useWorkspaceDateFormat();
  const titleId = useId();
  const rosterId = useId();
  const user = useMemo(() => { const p = getProfile(); return p.user_id ? { user_id: p.user_id, username: p.username, avatar_url: p.avatar_url, avatar_color: p.avatar_color } : null; }, []);

  const { ydoc, provider, connection, pending } = useScrumRetroCollab(boardId, retro?.retro_id, user);
  const revision = useYDocRevision(ydoc);
  // 회고 문서의 첫 동기화. 그 전의 빈 문서로 누가 썼는지(작성 현황·열 머리 수·아직 안 쓴 사람·작성함/작성 전)를
  // 말하지 않는다 — 기다리는 동안은 CollabStatusBadge가 '연결 중'을 알린다. 칸 편집기는 그대로 둔다.
  // 요약 줄·열 머리 수는 자리를 지킨 채 숨긴다(.is-pending = visibility:hidden, aria-hidden) — 동기화 때 머리가 밀리지 않게.
  const synced = useCollabSynced(provider);

  // 사람마다 세 칸의 작성 여부(백엔드 cell_has_content와 같은 기준). 머리의 작성 현황·열 머리 수·안 쓴 사람이 모두 여기서 나온다.
  // revision: 문서 변경 신호, synced: 첫 동기화 — 둘 다 값 자체는 쓰지 않는다. synced가 없으면 동기화로 다시 그릴 때
  // (문서 변경 신호는 다음 프레임에 온다) 동기화 전 빈 문서로 센 값을 한 프레임 보인다.
  const written = useMemo(() => new Map(members.map((m) => [m.user_id, Object.fromEntries(
    COLS.map(({ col }) => [col, cellHasContent(ydoc, retroCellKey(m.user_id, col))]),
  )])), [revision, synced, ydoc, members]);

  // 항목별 보기에서 들어가 고친 남의 블록(칸 키). 이 문서에서는 내용을 다 지워도 숨기지 않는다 —
  // 쓰던 편집기가 사라지지 않게(하루 보기의 '만진 칸'과 같은 규칙). 다른 회고 문서로 가면 풀린다.
  const [touched, setTouched] = useState({ doc: null, keys: NO_KEYS });
  const pinned = touched.doc === ydoc ? touched.keys : NO_KEYS;
  const touch = useCallback((key) => setTouched((prev) => {
    const keys = prev.doc === ydoc ? prev.keys : NO_KEYS;
    return keys.has(key) ? prev : { doc: ydoc, keys: new Set(keys).add(key) };
  }), [ydoc]);

  if (manual) return <div className="RetroView__Empty">{t('scrum.retro.manualNotice')}</div>;
  if (!retro || !ydoc) return <div className="RetroView__Loading">{t('scrum.retro.loading')}</div>;

  const total = members.length;
  const wroteAny = (m) => COLS.some(({ col }) => written.get(m.user_id)[col]);
  const writtenCount = members.filter(wroteAny).length;
  // 마감일 = 기간 끝날. 현재 회고인데 오늘이 그 뒤면(주말 등) '마감 지남'(스펙 §8)
  const deadline = retroDeadline(retro.period_end, today(), isCurrent);
  const dueDate = formatDateOnly(retro.period_end, { month: 'long', day: 'numeric', weekday: 'short' });

  return (
    <section className="RetroView" aria-labelledby={titleId}>
      <div className="RetroView__Head">
        <div className="RetroView__HeadText">
          <div className="RetroView__TitleRow">
            <h2 className="RetroView__Title" id={titleId}>{formatDateOnlyRange(retro.period_start, retro.period_end)}</h2>
            {deadline && (
              <span className={`RetroView__Deadline RetroView__Deadline--${deadline.kind}`}>
                <Clock size={12} strokeWidth={2.4} />
                {t(DEADLINE_KEYS[deadline.kind], deadline.kind === 'remaining'
                  ? { date: dueDate, count: deadline.days }
                  : { date: dueDate })}
              </span>
            )}
            <CollabStatusBadge connection={connection} pending={pending} />
          </div>
          <p className={`RetroView__Summary${synced ? '' : ' is-pending'}`} aria-hidden={synced ? undefined : true}>
            {t('scrum.retro.writtenSummary', { total, written: writtenCount })}
          </p>
        </div>
        {total > 0 && (
          <div className="RetroView__Roster">
            <span className="RetroView__RosterLabel" id={rosterId}>{t('scrum.retro.rosterLabel')}</span>
            <ul className="RetroView__RosterList" aria-labelledby={rosterId}>
              {members.map((m) => {
                // 첫 동기화 전에는 이름만 — 쓴 사람(✓)·안 쓴 사람(흐림)으로 가르지 않는다
                const done = synced && wroteAny(m);
                const faded = synced && !done;
                const label = synced
                  ? t(done ? 'scrum.retro.rosterWritten' : 'scrum.retro.rosterEmpty', { name: m.username })
                  : m.username;
                return (
                  <li key={m.user_id}>
                    <span className={`RetroView__Face${faded ? ' RetroView__Face--faded' : ''}`} role="img" aria-label={label} title={label}>
                      <Avatar user={m} size={28} title={label} />
                      {done && <span className="RetroView__FaceCheck"><Check size={9} strokeWidth={4} /></span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {view === 'person' ? (
        <div className="RetroPerson">
          {members.map((m) => (
            <RetroPersonCard
              key={m.user_id}
              member={m}
              isMe={m.user_id === meId}
              wrote={wroteAny(m)}
              synced={synced}
              ydoc={ydoc}
              members={members}
            />
          ))}
        </div>
      ) : (
        <div className="RetroTopic">
          {COLS.map(({ col, label, Icon }) => (
            <RetroTopicColumn
              key={col}
              col={col}
              label={label}
              Icon={Icon}
              ydoc={ydoc}
              members={members}
              meId={meId}
              written={written}
              pinned={pinned}
              onTouch={touch}
              synced={synced}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(RetroView);
