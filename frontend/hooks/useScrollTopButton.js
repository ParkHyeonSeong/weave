import { useCallback, useEffect, useState } from 'react';
import { isEditableElement, scrollBehavior, shouldShowScrollTop } from '@/library/scrollRegion';

// 맨 위로 버튼이 덮으면 안 되는 요소 — 댓글 입력기·설명 편집기(툴바 포함)·패널의 태스크 삭제
export const SCROLL_TOP_AVOID_SELECTOR = '[data-scroll-top-avoid]';

const overlaps = (a, b) => a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
  && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * 맨 위로 버튼 상태.
 *
 * scrollEl = 맨 위로 올릴 스크롤 영역, regionEl = 그 영역과 버튼을 함께 품은 요소(포커스·가림을 보는 범위).
 * 둘 다 HTMLElement|null — 나중에 나타나는 요소라 ref가 아니라 요소를 받는다. buttonRef = 버튼(숨김 중에도 자리를 잡고 있다).
 * 보이는 조건: 영역 높이의 절반 이상 내려왔고(scrollTopThreshold), 그 안에서 글을 입력 중이 아니고,
 * 버튼 자리에 입력기·하단 작업 버튼(SCROLL_TOP_AVOID_SELECTOR)이 겹치지 않을 것.
 * 다시 나타나는 것은 스크롤·크기 변화 때만이다 — 포커스 변화는 숨기기만 한다. 입력기에서 등록 버튼을 누르는 도중
 * (누름과 뗌 사이) 포커스가 그 버튼으로 옮겨 가며 맨 위로가 그 자리에 나타나 클릭을 가로채지 않게.
 * 입력 중 판정은 이벤트 시점이 아니라 다음 프레임의 document.activeElement로 한다 — 입력기가 포커스를 쥔 채
 * 사라져(댓글 등록 후 다시 그리기) focusout이 오지 않는 경우도 다음 scroll에서 바로잡힌다.
 */
export default function useScrollTopButton(scrollEl, regionEl, buttonRef) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!scrollEl) {
      setVisible(false);
      return undefined;
    }
    const region = regionEl || scrollEl;
    let raf = 0;
    let canShow = false;
    const update = () => {
      raf = 0;
      const allowShow = canShow;
      canShow = false;
      const active = document.activeElement;
      const editing = !!active && region.contains(active) && isEditableElement(active);
      let show = !editing && shouldShowScrollTop({
        scrollTop: scrollEl.scrollTop,
        clientHeight: scrollEl.clientHeight,
      });
      const button = buttonRef?.current;
      if (show && button) {
        const spot = button.getBoundingClientRect();
        show = ![...region.querySelectorAll(SCROLL_TOP_AVOID_SELECTOR)]
          .some((el) => overlaps(el.getBoundingClientRect(), spot));
      }
      setVisible((v) => (allowShow ? show : v && show));
    };
    const schedule = (allowShow) => {
      if (allowShow) canShow = true;
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onScroll = () => schedule(true);
    const onFocus = () => schedule(false);
    canShow = true;
    update();
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    region.addEventListener('focusin', onFocus);
    region.addEventListener('focusout', onFocus);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onScroll) : null;
    ro?.observe(scrollEl);
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      region.removeEventListener('focusin', onFocus);
      region.removeEventListener('focusout', onFocus);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollEl, regionEl, buttonRef]);

  // 이 영역만 올린다 — 배경 목록·다른 패널·사이드바의 스크롤은 건드리지 않는다
  const scrollToTop = useCallback(() => {
    if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: scrollBehavior() });
  }, [scrollEl]);

  return { visible, scrollToTop };
}
