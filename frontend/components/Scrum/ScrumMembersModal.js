import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { Users, X } from 'lucide-react';
import ScrumMembersPanel from './ScrumMembersPanel';

/**
 * 멤버 관리 모달 — 모달 셸(백드롭/헤더/닫기)만 담당하고
 * 본문은 ScrumMembersPanel을 그대로 감싼다.
 */
export default function ScrumMembersModal({ boardId, myRole, count, onClose, onChanged }) {
  const { t } = useTranslation();
  const router = useRouter();

  // ESC 닫기
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="ScrumMembers__Backdrop" onClick={onClose}>
      <div className="ScrumMembers" onClick={(e) => e.stopPropagation()}>
        <header className="ScrumMembers__Head">
          <div className="ScrumMembers__HeadTitle">
            <Users size={16} />
            <span>{t('scrum.members.title')}</span>
            {typeof count === 'number' && <em className="ScrumMembers__Count">{count}</em>}
          </div>
          <button
            type="button"
            className="ScrumMembers__Close"
            onClick={onClose}
            aria-label={t('common.actions.close')}
          >
            <X size={16} />
          </button>
        </header>

        <ScrumMembersPanel
          boardId={boardId}
          myRole={myRole}
          onChanged={onChanged}
          onLeave={() => { onClose(); router.push('/scrum'); }}
        />
      </div>
    </div>
  );
}
