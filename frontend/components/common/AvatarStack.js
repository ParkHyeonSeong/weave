import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Avatar from './Avatar';
import DropdownPortal from './DropdownPortal';
import { avatarMarkup } from '@/library/userAvatar';

// +N에 가려진 사람 이름(showHiddenNames) — 마우스를 올리거나 포커스가 오면 보이고, 떠나거나 Esc면 닫힌다.
// 스크린리더는 열지 않아도 설명(aria-describedby)으로 숨은 인원과 이름을 듣는다 — 보이는 목록은 같은 내용이라 aria-hidden.
// 이름 창은 DropdownPortal(body 포털) — 머리 줄에 잘리지 않고 화면 가장자리 안으로 붙는다.
// 마우스 처리는 감싼 span에 둔다: 포털된 이름 창도 React 트리로는 그 안이라 창 위로 옮겨 가도 닫히지 않는다.
function HiddenNames({ users }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const chipRef = useRef(null);
  const popupRef = useRef(null);
  const descId = useId();
  const names = users.map((u) => avatarMarkup(u).title);

  // 마우스로만 연 경우(포커스는 다른 곳)도 Esc로 닫힌다
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return (
    <span className="AvatarStack__MoreWrap" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={chipRef}
        type="button"
        className="AvatarStack__More AvatarStack__More--btn"
        aria-describedby={descId}
        onFocus={show}
        onBlur={hide}
        onClick={show}
      >
        +{users.length}
      </button>
      <span id={descId} hidden>
        {t('misc.avatar.hiddenNames', { count: users.length, names: names.join(', ') })}
      </span>
      <DropdownPortal anchorRef={chipRef} open={open} align="right" dropdownRef={popupRef}>
        <ul className="AvatarStack__Names" aria-hidden="true">
          {names.map((name, i) => <li key={i}>{name}</li>)}
        </ul>
      </DropdownPortal>
    </span>
  );
}

// 멤버 스택 + (옵션) 클릭 가능한 +N 오버플로.
// showHiddenNames: +N에서 가려진 사람 이름을 보여 준다(onOverflowClick이 있으면 그 버튼이 우선).
export default function AvatarStack({
  users = [], max = 4, size = 'sm', overlapping = true,
  onOverflowClick, showHiddenNames = false, className = '',
}) {
  const shown = users.slice(0, max);
  const remaining = users.length - max;
  return (
    <div className={`AvatarStack ${overlapping ? 'AvatarStack--overlap' : ''} ${className}`}>
      {shown.map((u, i) => (
        <span
          key={u.user_id ?? u.id ?? `idx-${i}`}
          className="AvatarStack__Item"
          style={{ zIndex: users.length - i }}
        >
          <Avatar user={u} size={size} />
        </span>
      ))}
      {remaining > 0 && (
        onOverflowClick ? (
          <button type="button" className="AvatarStack__More AvatarStack__More--btn" onClick={onOverflowClick}>
            +{remaining}
          </button>
        ) : showHiddenNames ? (
          <HiddenNames users={users.slice(max)} />
        ) : (
          <span className="AvatarStack__More">+{remaining}</span>
        )
      )}
    </div>
  );
}
