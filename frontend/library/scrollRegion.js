// 스크롤 영역 공용 판정. 맨 위로 버튼(hooks/useScrollTopButton)과 섹션 바로가기(hooks/useSectionNav)가 함께 쓴다.

/** OS '동작 줄이기' 설정이면 부드러운 스크롤 대신 바로 이동한다(기존 관례: matchMedia). */
export function scrollBehavior() {
  const reduce = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return reduce ? 'auto' : 'smooth';
}

/**
 * 맨 위로 버튼을 보일 스크롤 거리 — 그 영역 높이의 절반.
 * 1440×900 실측: 패널 본문 735px → 368px, 전체 상세·Canvas 824px → 412px
 * (390×844 모바일: 패널 본문 755px → 378px, 전체 상세·Canvas 740px → 370px).
 * 한 화면(824px)으로 잡으면 Canvas 샘플(최대 스크롤 883px)에서 마지막 59px에서만 보인다.
 */
export function scrollTopThreshold(clientHeight) {
  return Math.round(clientHeight / 2);
}

export function shouldShowScrollTop({ scrollTop, clientHeight }) {
  return clientHeight > 0 && scrollTop >= scrollTopThreshold(clientHeight);
}

const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'checkbox', 'radio', 'submit', 'reset', 'color', 'range', 'file', 'image', 'hidden',
]);

/** 글을 입력하는 요소인가 — 그 안에 포커스가 있는 동안 맨 위로 버튼을 숨겨 입력기·툴바를 가리지 않는다. */
export function isEditableElement(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  const ce = el.getAttribute('contenteditable');
  if (ce === '' || ce === 'true' || ce === 'plaintext-only') return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((el.getAttribute('type') || 'text').toLowerCase());
  return false;
}
