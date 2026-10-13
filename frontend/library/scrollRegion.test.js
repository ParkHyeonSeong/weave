// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isEditableElement, scrollBehavior, scrollTopThreshold, shouldShowScrollTop } from './scrollRegion';

describe('맨 위로 버튼 노출 기준 — 영역 높이의 절반', () => {
  it('1440×900·390×844 실측값', () => {
    expect(scrollTopThreshold(735)).toBe(368);   // 패널 본문(바로가기는 본문 밖)
    expect(scrollTopThreshold(824)).toBe(412);   // 전체 상세·Canvas
    expect(scrollTopThreshold(755)).toBe(378);   // 모바일 패널 본문
    expect(scrollTopThreshold(740)).toBe(370);   // 모바일 전체 상세·Canvas
  });
  it('기준 미만은 숨기고 이상은 보인다', () => {
    expect(shouldShowScrollTop({ scrollTop: 0, clientHeight: 824 })).toBe(false);
    expect(shouldShowScrollTop({ scrollTop: 411, clientHeight: 824 })).toBe(false);
    expect(shouldShowScrollTop({ scrollTop: 412, clientHeight: 824 })).toBe(true);
  });
  it('Canvas 샘플(최대 스크롤 883px)에서도 끝 전에 보인다', () => {
    expect(shouldShowScrollTop({ scrollTop: 450, clientHeight: 824 })).toBe(true);
  });
  it('높이가 0인 영역(숨김·렌더 전)은 숨긴다', () => {
    expect(shouldShowScrollTop({ scrollTop: 0, clientHeight: 0 })).toBe(false);
  });
});

describe('isEditableElement', () => {
  const el = (tag, attrs = {}) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  it('글 입력 요소', () => {
    expect(isEditableElement(el('textarea'))).toBe(true);
    expect(isEditableElement(el('input'))).toBe(true);
    expect(isEditableElement(el('input', { type: 'search' }))).toBe(true);
    expect(isEditableElement(el('div', { contenteditable: 'true' }))).toBe(true);
    expect(isEditableElement(el('div', { contenteditable: '' }))).toBe(true);
  });
  it('글을 입력하지 않는 요소', () => {
    expect(isEditableElement(el('button'))).toBe(false);
    expect(isEditableElement(el('input', { type: 'checkbox' }))).toBe(false);
    expect(isEditableElement(el('input', { type: 'color' }))).toBe(false);
    expect(isEditableElement(el('div', { contenteditable: 'false' }))).toBe(false);
    expect(isEditableElement(null)).toBe(false);
    expect(isEditableElement(document)).toBe(false);
  });
});

describe('scrollBehavior — prefers-reduced-motion', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('동작 줄이기면 auto, 아니면 smooth', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }));
    expect(scrollBehavior()).toBe('auto');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(scrollBehavior()).toBe('smooth');
  });
});
