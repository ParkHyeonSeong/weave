import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp } from 'lucide-react';
import useScrollTopButton from '@/hooks/useScrollTopButton';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 스크롤 영역의 맨 위로 버튼. 영역을 품은 위치 기준 요소(regionEl, position 있음)의 우하단 16px에 놓인다(SCSS).
 * 숨길 때도 자리는 잡아 둔다(visibility) — 그 자리에 입력기·하단 작업 버튼이 겹치는지 재기 위해서다.
 * 숨김 중에는 보이지 않고, 누를 수도 포커스할 수도 없다.
 * 마우스 누름이 포커스를 빼앗지 않게 막는다 — 설명 편집기는 blur에 저장·종료되기 때문이다.
 * 키보드로 눌렀으면(포커스가 버튼에 있으면) 올라간 뒤 영역 맨 앞 조작 요소로 포커스를 옮긴다 —
 * 버튼이 사라지며 포커스가 문서 처음으로 튀지 않게.
 */
export default function ScrollTopButton({ scrollEl, regionEl }) {
  const { t } = useTranslation();
  const buttonRef = useRef(null);
  const { visible, scrollToTop } = useScrollTopButton(scrollEl, regionEl, buttonRef);

  const onClick = (e) => {
    const fromKeyboard = document.activeElement === e.currentTarget;
    scrollToTop();
    if (fromKeyboard) scrollEl?.querySelector(FOCUSABLE)?.focus({ preventScroll: true });
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`ScrollTopButton${visible ? '' : ' ScrollTopButton--hidden'}`}
      aria-hidden={visible ? undefined : true}
      tabIndex={visible ? undefined : -1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <ArrowUp size={14} aria-hidden="true" />
      <span>{t('common.scrollTop.label')}</span>
    </button>
  );
}
