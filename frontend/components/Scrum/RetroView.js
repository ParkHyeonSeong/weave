import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useScrumRetroCollab from '@/library/useScrumRetroCollab';
import ScrumCell from './ScrumCell';
import Avatar from '@/components/common/Avatar';

const getProfile = () => { try { return JSON.parse(sessionStorage.getItem('profile') || '{}'); } catch { return {}; } };
const COLS = [['keep', 'scrum.retro.colKeep'], ['problem', 'scrum.retro.colProblem'], ['try', 'scrum.retro.colTry']];

// 회고도 멤버별로 각자 KPT를 적는다. 한 회고 문서(period) 안에서 멤버마다
// 별도 fragment(`${userId}:keep|problem|try`)에 바인딩 → 동시 협업·격리.
// 기간 선택/이동·라벨은 상위(ScrumBoardView) 헤더 nav가 담당하고, 여기선 넘겨받은
// retro(기간 문서)를 멤버별로 렌더한다.
export default function RetroView({ boardId, members = [], retro = null, manual = false }) {
  const { t } = useTranslation();
  const user = useMemo(() => { const p = getProfile(); return p.user_id ? { user_id: p.user_id, username: p.username, avatar_url: p.avatar_url, avatar_color: p.avatar_color } : null; }, []);

  const { ydoc } = useScrumRetroCollab(boardId, retro?.retro_id, user);

  if (manual) return <div className="RetroView__Empty">{t('scrum.retro.manualNotice')}</div>;
  if (!retro || !ydoc) return <div className="RetroView__Loading">{t('scrum.retro.loading')}</div>;

  return (
    <div className="RetroView">
      <div className="RetroView__Period">{t('scrum.retro.heading')}</div>
      {members.map((m) => (
        <div key={m.user_id} className="RetroMember">
          <div className="RetroMember__Head">
            <Avatar user={m} size={20} className="RetroMember__Avatar" />
            <span className="RetroMember__Name">{m.username}</span>
            {m.user_id === user?.user_id && <em className="RetroMember__You">{t('scrum.you')}</em>}
          </div>
          <div className="RetroView__Cols">
            {COLS.map(([key, labelKey]) => (
              <div key={key} className={`RetroCol RetroCol--${key}`}>
                <div className="RetroCol__Head">{t(labelKey)}</div>
                <div className="RetroCol__Body">
                  <ScrumCell ydoc={ydoc} fragmentKey={`${m.user_id}:${key}`} placeholder="" members={members} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
