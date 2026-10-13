import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SCROLL_IDLE_MS, TASK_SECTION_ATTR, atScrollEnd, pickActiveSection, sectionScrollTop,
} from '@/library/taskSectionNav';
import { scrollBehavior } from '@/library/scrollRegion';

/**
 * 섹션 바로가기의 현재 섹션 판정 + 클릭 이동.
 *
 * scrollEl = 스크롤 영역(패널 본문 / 전체 상세 __Main), rootEl = 섹션들의 직계 부모,
 * navEl = 바로가기. 스크롤 영역 **안**에 sticky로 붙어 있으면(전체 상세) 그 높이만큼 본문 위쪽을 가리고,
 * **밖**에 있으면(패널: 헤더 아래 고정) 가리지 않는다. 셋 다 HTMLElement|null — 태스크가 로드된 뒤에야
 * 생기므로 ref가 아니라 요소를 받는다(요소가 바뀌면 리스너를 다시 건다).
 *
 * 클릭 이동은 그 스크롤 영역에만 scrollTo를 부른다(scrollIntoView는 조상 스크롤러까지 움직인다).
 * 이동이 멈출 때까지(scroll 무소식 SCROLL_IDLE_MS) 현재 섹션을 다시 고르지 않는다 — 짧은 마지막 섹션은
 * 끝까지 내려도 기준선에 닿지 않으므로, 누른 항목이 그대로 표시돼야 한다. 도중에 사용자가 직접 스크롤해
 * 목적지에서 벗어났으면 멈춘 위치로 다시 고른다.
 */
export default function useSectionNav({ scrollEl, rootEl, navEl, sectionIds }) {
  const [activeSection, setActiveSection] = useState(null);
  const lockRef = useRef(null);   // { expected, timer } — 클릭 이동 중

  const anchorOf = useCallback(
    (id) => (rootEl ? rootEl.querySelector(`:scope > [${TASK_SECTION_ATTR}="${id}"]`) : null),
    [rootEl],
  );

  // 지금 렌더된 섹션 id — 렌더되지 않은 섹션으로 가는 메뉴를 만들지 않기 위해 메뉴를 열 때 묻는다
  const presentSectionIds = useCallback(
    () => new Set(sectionIds.filter((id) => anchorOf(id))),
    [sectionIds, anchorOf],
  );

  // 바로가기가 가리는 스크롤 영역 위쪽 높이(px) — sticky top 0 기준(스크롤 영역에 위쪽 패딩이 없어야 한다)
  const navOverlap = useCallback(
    () => (navEl && scrollEl && scrollEl.contains(navEl) ? navEl.offsetHeight : 0),
    [navEl, scrollEl],
  );

  const recompute = useCallback(() => {
    if (!scrollEl) return;
    const top = scrollEl.getBoundingClientRect().top;
    const anchors = [];
    for (const id of sectionIds) {
      const el = anchorOf(id);
      if (el) anchors.push({ id, top: el.getBoundingClientRect().top - top });
    }
    setActiveSection(pickActiveSection(anchors, {
      navHeight: navOverlap(),
      viewportHeight: scrollEl.clientHeight,
      atBottom: atScrollEnd(scrollEl),
    }));
  }, [scrollEl, sectionIds, anchorOf, navOverlap]);

  const release = useCallback(() => {
    const lock = lockRef.current;
    if (!lock) return;
    clearTimeout(lock.timer);
    lockRef.current = null;
    if (scrollEl && Math.abs(scrollEl.scrollTop - lock.expected) > 2) recompute();
  }, [scrollEl, recompute]);

  useEffect(() => {
    if (!scrollEl) return undefined;
    let raf = 0;
    const onScroll = () => {
      const lock = lockRef.current;
      if (lock) {
        clearTimeout(lock.timer);
        lock.timer = setTimeout(release, SCROLL_IDLE_MS);
        return;
      }
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; recompute(); });
    };
    recompute();
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    // 영역 크기(패널 폭·창 크기)나 본문 높이(섹션 비동기 로드)가 바뀌면 위치가 달라진다
    const ro = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { if (!lockRef.current) recompute(); })
      : null;
    ro?.observe(scrollEl);
    if (rootEl && rootEl !== scrollEl) ro?.observe(rootEl);
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      if (lockRef.current) {
        clearTimeout(lockRef.current.timer);
        lockRef.current = null;
      }
    };
  }, [scrollEl, rootEl, recompute, release]);

  const scrollToSection = useCallback((id) => {
    const el = anchorOf(id);
    if (!scrollEl || !el) return false;
    const expected = sectionScrollTop({
      scrollTop: scrollEl.scrollTop,
      sectionTop: el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top,
      navHeight: navOverlap(),
      maxScroll: scrollEl.scrollHeight - scrollEl.clientHeight,
    });
    setActiveSection(id);
    if (lockRef.current) clearTimeout(lockRef.current.timer);
    // 이미 그 자리라 scroll 이벤트가 오지 않아도 풀리도록 첫 타이머를 건다
    lockRef.current = { expected, timer: setTimeout(release, SCROLL_IDLE_MS * 2) };
    scrollEl.scrollTo({ top: expected, behavior: scrollBehavior() });
    return true;
  }, [scrollEl, anchorOf, navOverlap, release]);

  return { activeSection, scrollToSection, presentSectionIds };
}
