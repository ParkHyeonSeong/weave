// 태스크 패널·전체 상세의 섹션 바로가기 계산(순수 함수). DOM 측정·이벤트는 hooks/useSectionNav.js가 맡는다.

/** 섹션 루트에 다는 표지. 바로가기는 섹션들의 직계 부모 아래에서 이 속성으로만 섹션을 찾는다. */
export const TASK_SECTION_ATTR = 'data-task-section';

/** 클릭 이동 시 섹션 머리와 바로가기 사이에 둘 여백(px). */
export const SECTION_SCROLL_GAP = 8;

/** 클릭 이동이 끝났다고 보는 scroll 무소식 시간(ms). 그동안은 현재 섹션을 다시 고르지 않는다. */
export const SCROLL_IDLE_MS = 160;

// 좁은 패널: 기본 4개 + 더보기 5개. 항목 하나가 섹션 여러 개를 품을 수 있다(sections).
export const PANEL_NAV = {
  primary: [
    { key: 'subtasks', sections: ['subtasks'] },
    { key: 'description', sections: ['description'] },
    { key: 'details', sections: ['details'] },
    { key: 'comments', sections: ['comments'] },
  ],
  overflow: [
    { key: 'dependencies', sections: ['dependencies'] },
    { key: 'pageLinks', sections: ['pageLinks'] },
    { key: 'issues', sections: ['issues'] },
    { key: 'pullRequests', sections: ['pullRequests'] },
    { key: 'activity', sections: ['activity'] },
  ],
};

// 전체 상세: 속성은 오른쪽 열이라 메뉴에 넣지 않고 본문 열만 추적한다. 연결 4종은 한 항목으로 묶는다.
export const FULL_PAGE_NAV = {
  primary: [
    { key: 'subtasks', sections: ['subtasks'] },
    { key: 'description', sections: ['description'] },
    { key: 'links', sections: ['dependencies', 'pageLinks', 'issues', 'pullRequests'] },
    { key: 'comments', sections: ['comments'] },
    { key: 'activity', sections: ['activity'] },
  ],
  overflow: [],
};

/** 메뉴 설정이 다루는 섹션 id 전부 */
export function sectionIdsOf(nav) {
  return [...nav.primary, ...nav.overflow].flatMap((item) => item.sections);
}

/**
 * 현재 읽는 섹션의 기준선(스크롤 영역 윗변에서 px). 바로가기 아래로 남은 높이의 1/4이되 24~160px로 묶는다.
 * 섹션 머리가 이 선 위로 올라오면 그 섹션을 읽는 중으로 본다.
 */
export function readingLine(navHeight, viewportHeight) {
  const room = Math.max(0, viewportHeight - navHeight);
  return navHeight + Math.min(160, Math.max(24, Math.round(room / 4)));
}

/**
 * 끝까지 내렸는가. 스크롤할 거리가 없는 영역(짧은 태스크)은 끝이 아니다 — 그렇지 않으면
 * 맨 위에서도 마지막 섹션(활동)이 현재 섹션이 된다.
 */
export function atScrollEnd({ scrollTop, clientHeight, scrollHeight }) {
  return scrollHeight - clientHeight > 2 && scrollTop + clientHeight >= scrollHeight - 2;
}

/**
 * 현재 섹션 id. anchors = [{ id, top }] (top: 스크롤 영역 윗변 기준 px). 섹션이 없으면 null.
 * - 끝까지 내렸으면: 머리가 화면 안에 있는 마지막 섹션 — 짧은 마지막 섹션도 고를 수 있게
 * - 아니면: 머리가 기준선 위로 올라온 마지막 섹션, 하나도 없으면 첫 섹션
 */
export function pickActiveSection(anchors, { navHeight, viewportHeight, atBottom }) {
  if (!anchors.length) return null;
  const sorted = [...anchors].sort((a, b) => a.top - b.top);
  if (atBottom) {
    const inView = sorted.filter((a) => a.top < viewportHeight);
    return (inView.length ? inView[inView.length - 1] : sorted[sorted.length - 1]).id;
  }
  const line = readingLine(navHeight, viewportHeight);
  let active = sorted[0].id;
  for (const a of sorted) {
    if (a.top > line) break;
    active = a.id;
  }
  return active;
}

/** 섹션 머리가 바로가기 바로 아래(gap)에 오도록 할 scrollTop. 0~maxScroll로 자른다. */
export function sectionScrollTop({ scrollTop, sectionTop, navHeight, maxScroll, gap = SECTION_SCROLL_GAP }) {
  const target = Math.round(scrollTop + sectionTop - navHeight - gap);
  return Math.max(0, Math.min(target, Math.max(0, maxScroll)));
}

/** 섹션 id를 품은 메뉴 항목의 key (없으면 null) */
export function itemKeyOf(nav, sectionId) {
  if (!sectionId) return null;
  const item = [...nav.primary, ...nav.overflow].find((it) => it.sections.includes(sectionId));
  return item ? item.key : null;
}

/** 실제로 렌더된 섹션(presentIds)을 하나라도 가진 항목만 남긴다 */
export function presentItems(items, presentIds) {
  return items.filter((it) => it.sections.some((id) => presentIds.has(id)));
}

/** 항목을 눌렀을 때 갈 섹션 = 그 항목의 섹션 중 렌더된 첫 번째 */
export function targetSectionOf(item, presentIds) {
  return item.sections.find((id) => presentIds.has(id)) ?? null;
}
