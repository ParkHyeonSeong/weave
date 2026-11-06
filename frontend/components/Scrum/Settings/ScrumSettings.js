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
      <div className="ScrumSettings ScrumSettings--notfound">
        <p className="ScrumSettings__NotFoundTitle">{t('scrum.settings.boardNotFound')}</p>
        <button type="button" className="ScrumSettings__Back" onClick={() => router.push('/scrum')}>
          <ArrowLeft size={15} />
          {t('scrum.settings.backToScrum')}
        </button>
      </div>
    );
  }
  if (!board) return null;

  const isAdmin = board.my_role === 'admin';

  return (
    <div className="ScrumSettings">
      <button type="button" className="ScrumSettings__Back" onClick={() => router.push(`/scrum/${boardId}`)}>
        <ArrowLeft size={15} />
        {t('scrum.settings.backToBoard')}
      </button>
      {/* 보드 머리처럼 이름만 — 보드 색은 사이드바·홈 카드가 보인다 */}
      <h1 className="ScrumSettings__Title">{board.name}</h1>

      {/* 보드의 '주간보드 | 회고'와 같은 밑줄 탭 */}
      <div className="ScrumSettings__Tabs">
        {SUB_TABS.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className="ScrumSettings__Tab"
            aria-pressed={activeSubTab === key}
            onClick={() => setActiveSubTab(key)}
          >
            <Icon size={15} />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="ScrumSettings__Content">
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
          <section className="ScrumSettings__Card">
            <ScrumMembersPanel
              boardId={boardId}
              myRole={board.my_role}
              onChanged={fetchBoard}
              withHeader
            />
          </section>
        )}
      </div>
    </div>
  );
}
