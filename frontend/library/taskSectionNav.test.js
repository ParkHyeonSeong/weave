import { describe, it, expect } from 'vitest';
import {
  FULL_PAGE_NAV, PANEL_NAV, atScrollEnd, itemKeyOf, pickActiveSection, presentItems, readingLine,
  sectionIdsOf, sectionScrollTop, targetSectionOf,
} from './taskSectionNav';

// 1440×900 실측: 패널 본문 clientHeight 771px, 바로가기 높이 37px(36 + 아래 테두리 1)
const PANEL = { navHeight: 37, viewportHeight: 771 };

describe('readingLine — 바로가기 아래 남은 높이의 1/4, 24~160px', () => {
  it('패널 실측값이면 바로가기 + 160px', () => {
    expect(readingLine(37, 771)).toBe(197);
  });
  it('낮은 영역은 최소 24px', () => {
    expect(readingLine(37, 100)).toBe(61);
    expect(readingLine(0, 0)).toBe(24);
  });
});

describe('pickActiveSection — 현재 읽는 섹션', () => {
  it('맨 위: 기준선 위에 올라온 첫 섹션', () => {
    const anchors = [{ id: 'subtasks', top: 150 }, { id: 'description', top: 350 }];
    expect(pickActiveSection(anchors, { ...PANEL, atBottom: false })).toBe('subtasks');
  });
  it('기준선 위 섹션이 없으면 첫 섹션', () => {
    const anchors = [{ id: 'subtasks', top: 400 }, { id: 'description', top: 600 }];
    expect(pickActiveSection(anchors, { ...PANEL, atBottom: false })).toBe('subtasks');
  });
  it('중간: 머리가 기준선 위로 올라온 마지막 섹션(입력 순서와 무관)', () => {
    const anchors = [
      { id: 'details', top: 120 }, { id: 'subtasks', top: -1700 }, { id: 'description', top: -1500 }, { id: 'comments', top: 900 },
    ];
    expect(pickActiveSection(anchors, { ...PANEL, atBottom: false })).toBe('details');
  });
  it('기준선과 같은 높이는 그 섹션', () => {
    const anchors = [{ id: 'subtasks', top: -300 }, { id: 'description', top: 197 }];
    expect(pickActiveSection(anchors, { ...PANEL, atBottom: false })).toBe('description');
  });
  it('끝까지 내렸으면 머리가 화면 안에 있는 마지막 섹션', () => {
    const anchors = [{ id: 'comments', top: 300 }, { id: 'activity', top: 600 }];
    expect(pickActiveSection(anchors, { ...PANEL, atBottom: true })).toBe('activity');
  });
  it('끝인데 화면 안에 머리가 없으면 마지막 섹션', () => {
    const anchors = [{ id: 'comments', top: -900 }, { id: 'activity', top: -100 }];
    expect(pickActiveSection(anchors, { ...PANEL, atBottom: true })).toBe('activity');
  });
  it('섹션이 없으면 null', () => {
    expect(pickActiveSection([], { ...PANEL, atBottom: false })).toBeNull();
  });
});

describe('atScrollEnd — 끝까지 내렸는가', () => {
  it('끝에서 2px 안이면 끝', () => {
    expect(atScrollEnd({ scrollTop: 2391, clientHeight: 735, scrollHeight: 3126 })).toBe(true);
    expect(atScrollEnd({ scrollTop: 2389, clientHeight: 735, scrollHeight: 3126 })).toBe(true);
    expect(atScrollEnd({ scrollTop: 2300, clientHeight: 735, scrollHeight: 3126 })).toBe(false);
  });
  it('스크롤할 거리가 없으면(짧은 태스크) 끝이 아니다', () => {
    expect(atScrollEnd({ scrollTop: 0, clientHeight: 735, scrollHeight: 735 })).toBe(false);
    expect(atScrollEnd({ scrollTop: 0, clientHeight: 735, scrollHeight: 600 })).toBe(false);
  });
});

describe('sectionScrollTop — 섹션 머리를 바로가기 바로 아래(8px)에', () => {
  it('현재 위치 + 섹션 위치 − 바로가기 − 8', () => {
    expect(sectionScrollTop({ scrollTop: 0, sectionTop: 300, navHeight: 37, maxScroll: 2355 })).toBe(255);
    expect(sectionScrollTop({ scrollTop: 1000, sectionTop: -400, navHeight: 37, maxScroll: 2355 })).toBe(555);
  });
  it('0~maxScroll로 자른다', () => {
    expect(sectionScrollTop({ scrollTop: 2000, sectionTop: 900, navHeight: 37, maxScroll: 2355 })).toBe(2355);
    expect(sectionScrollTop({ scrollTop: 0, sectionTop: 20, navHeight: 37, maxScroll: 2355 })).toBe(0);
    expect(sectionScrollTop({ scrollTop: 0, sectionTop: 300, navHeight: 37, maxScroll: -5 })).toBe(0);
  });
});

describe('메뉴 항목 ↔ 섹션', () => {
  it('패널 메뉴는 9개 섹션을 다룬다', () => {
    expect(sectionIdsOf(PANEL_NAV).sort()).toEqual([
      'activity', 'comments', 'dependencies', 'description', 'details', 'issues', 'pageLinks', 'pullRequests', 'subtasks',
    ]);
  });
  it('전체 상세 메뉴에는 속성이 없다(오른쪽 열)', () => {
    expect(sectionIdsOf(FULL_PAGE_NAV)).not.toContain('details');
  });
  it('섹션을 품은 항목 key', () => {
    expect(itemKeyOf(PANEL_NAV, 'issues')).toBe('issues');
    expect(itemKeyOf(FULL_PAGE_NAV, 'issues')).toBe('links');
    expect(itemKeyOf(FULL_PAGE_NAV, 'details')).toBeNull();
    expect(itemKeyOf(PANEL_NAV, null)).toBeNull();
  });
  it('렌더되지 않은 섹션만 가진 항목은 뺀다', () => {
    const present = new Set(['pageLinks', 'issues', 'pullRequests', 'activity']);
    expect(presentItems(PANEL_NAV.overflow, present).map((i) => i.key))
      .toEqual(['pageLinks', 'issues', 'pullRequests', 'activity']);
  });
  it('묶음 항목은 렌더된 첫 섹션으로 간다', () => {
    const links = FULL_PAGE_NAV.primary.find((i) => i.key === 'links');
    expect(targetSectionOf(links, new Set(['pageLinks', 'issues']))).toBe('pageLinks');
    expect(targetSectionOf(links, new Set(['dependencies', 'pageLinks']))).toBe('dependencies');
    expect(targetSectionOf(links, new Set())).toBeNull();
  });
});
