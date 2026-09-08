import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon, Users, ArrowLeft } from 'lucide-react';
import { axios } from '@/library/_axios';
import ScrumSettingsGeneral from './ScrumSettingsGeneral';
import ScrumMembersPanel from '@/components/Scrum/ScrumMembersPanel';

const SUB_TABS = [
  { key: 'general', labelKey: 'scrum.settings.tabGeneral', icon: SettingsIcon },
  { key: 'members', labelKey: 'scrum.settings.tabMembers', icon: Users },
];

export default function ScrumSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const boardId = router.isReady ? Number(router.query.boardId) : null;
  const [board, setBoard] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState('general');
  const [notFound, setNotFound] = useState(false);

  const fetchBoard = useCallback(async () => {
    if (!boardId) return;
    try {
      const res = await axios.get(`/scrum/${boardId}`);
      if (res.data.status) setBoard(res.data.board);
      else setNotFound(true);
    } catch {
      setNotFound(true);
    }
  }, [boardId]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  if (notFound) {
    return (
      <div className="TrackSettings TrackSettings--notfound">
        <div className="TrackSettings__NotFoundTitle">{t('scrum.settings.boardNotFound')}</div>
        <button className="TrackSettings__BackBtn" onClick={() => router.push('/scrum')}>
          ← {t('scrum.settings.backToScrum')}
        </button>
      </div>
    );
  }
  if (!board) return null;

  const isAdmin = board.my_role === 'admin';

  return (
    <div className="TrackSettings">
      <div className="TrackSettings__Header">
        <button
          className="TrackSettings__BackLink"
          onClick={() => router.push(`/scrum/${boardId}`)}
        >
          <ArrowLeft size={14} /> {t('scrum.settings.backToBoard')}
        </button>
        <div className="TrackSettings__HeaderTitle">
          <span
            className="ScrumSettings__ColorDot"
            style={{ background: board.color || '#16A34A' }}
          />
          <h1 className="TrackSettings__Name">{board.name}</h1>
        </div>
      </div>

      <div className="TrackSettings__SubTabs">
        {SUB_TABS.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            className={`TrackSettings__SubTab ${activeSubTab === key ? 'TrackSettings__SubTab--active' : ''}`}
            onClick={() => setActiveSubTab(key)}
          >
            <Icon size={14} />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="TrackSettings__Content">
        {activeSubTab === 'general' && (
          // key는 데이터 id로 (boardId는 router 파생 → fetch 완료 전 먼저 바뀌어 입력값 stale 유발)
          <ScrumSettingsGeneral
            key={board.board_id}
            board={board}
            boardId={boardId}
            isAdmin={isAdmin}
            onUpdated={fetchBoard}
          />
        )}
        {activeSubTab === 'members' && (
          <ScrumMembersPanel
            boardId={boardId}
            myRole={board.my_role}
            onChanged={fetchBoard}
          />
        )}
      </div>
    </div>
  );
}
