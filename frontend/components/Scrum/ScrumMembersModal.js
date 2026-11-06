import { useEffect, useId, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import ScrumMembersPanel from './ScrumMembersPanel';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Tab 순서 — 창 안 조작 요소(문서 순서). 역할 목록처럼 body에 포털된 목록은 창 DOM 밖(문서 끝)에 붙지만,
// 열려 있으면 그 트리거(aria-expanded + aria-controls) 바로 뒤에 끼워 넣는다. 창 DOM만 보면 목록이 순환에서 빠진다.
function focusCycle(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE)].flatMap((el) => {
    const popupId = el.getAttribute('aria-expanded') === 'true' && el.getAttribute('aria-controls');
    const popup = popupId ? document.getElementById(popupId) : null;
    return popup && !dialog.contains(popup) ? [el, ...popup.querySelectorAll(FOCUSABLE)] : [el];
  });
}

/**
 * 멤버 관리 모달 — 모달 셸(백드롭/헤더/닫기)만 담당하고
 * 본문은 ScrumMembersPanel을 그대로 감싼다.
 * 키보드: 열면 닫기 버튼으로 포커스, Tab·Shift+Tab은 창 안에서만 돌고, 닫히면 창을 연 버튼으로 돌아간다.
 */
export default function ScrumMembersModal({ boardId, myRole, count, onClose, onChanged }) {
  const { t } = useTranslation();
  const router = useRouter();
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const lastFocusRef = useRef(null); // 창 안에서 마지막으로 포커스가 있던 곳

  // 열 때 포커스가 있던 곳(머리의 '멤버' 버튼)을 기억해 두고 닫기 버튼으로 옮긴다 — 닫히면(언마운트) 되돌린다
  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  // ESC 닫기 + Tab 순환. 먼저 처리된 Esc(preventDefault로 표시)는 창을 닫지 않는다 — 열린 역할 목록은 목록만, 명령 팔레트는
  // 팔레트만 닫고 포커스는 창 안으로 되찾는다(이때 팔레트는 이미 내려가 있을 수 있어 activeElement로는 층을 가릴 수 없다).
  // 한글 조합 중 Esc는 조합만 끝낸다 — 팔레트도 이 Esc로 닫히지 않으므로 뒤의 창이 대신 닫히면 안 된다.
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') {
        if (e.isComposing) return;
        if (e.defaultPrevented) lastFocusRef.current?.focus();
        else onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = focusCycle(dialogRef.current);
      if (!items.length) return;
      const active = document.activeElement;
      const i = items.indexOf(active);
      // 창 위에 뜬 다른 층(명령 팔레트 등)의 Tab은 그 층 몫이다 — 포커스를 잃어 body에 있을 때만 창으로 데려온다
      if (i === -1 && active !== document.body) return;
      e.preventDefault();
      const step = e.shiftKey ? -1 : 1;
      const next = i === -1
        ? items[e.shiftKey ? items.length - 1 : 0]
        : items[(i + step + items.length) % items.length];
      next.focus();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="ScrumMembers__Backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="ScrumMembers"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => { lastFocusRef.current = e.target; }}
      >
        <header className="ScrumMembers__Head">
          {/* 하루 보기 팀원 목록 제목('팀원 2')과 같은 모양 — 아이콘 없이 이름과 인원 */}
          <h2 className="ScrumMembers__HeadTitle" id={titleId}>
            {t('scrum.members.title')}
            {typeof count === 'number' && <span className="ScrumMembers__Count">{count}</span>}
          </h2>
          <button
            ref={closeRef}
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
