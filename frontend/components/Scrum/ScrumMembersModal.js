import { useEffect, useId } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import ScrumMembersPanel from './ScrumMembersPanel';

/**
 * 멤버 관리 모달 — 모달 셸(백드롭/헤더/닫기)만 담당하고
 * 본문은 ScrumMembersPanel을 그대로 감싼다.
 */
export default function ScrumMembersModal({ boardId, myRole, count, onClose, onChanged }) {
  const { t } = useTranslation();
  const router = useRouter();
  const titleId = useId();

  // ESC 닫기
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="ScrumMembers__Backdrop" onClick={onClose}>
      <div
        className="ScrumMembers"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ScrumMembers__Head">
          {/* 하루 보기 팀원 목록 제목('팀원 2')과 같은 모양 — 아이콘 없이 이름과 인원 */}
          <h2 className="ScrumMembers__HeadTitle" id={titleId}>
            {t('scrum.members.title')}
            {typeof count === 'number' && <span className="ScrumMembers__Count">{count}</span>}
          </h2>
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
