// @vitest-environment jsdom
//
// 칸 서식 툴바는 편집기 자리(getBoundingClientRect)를 재서 fixed로 뜬다. 편집기 위쪽 배치가 바뀌어
// 편집기만 밀려날 때(오늘 할 일 칸을 비우면 카드에 '가져오기' 줄이 생긴다)는 편집기 이벤트가 다시 오지
// 않는다 — 조상 크기 변화로 다시 재야 툴바가 새 줄의 버튼을 가리지 않는다. jsdom에는 배치가 없어
// 편집기 자리를 정해 주고, ResizeObserver는 콜백을 모아 직접 부른다.
import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'ko' } }),
}));

import ScrumCellToolbar from '@/components/Scrum/ScrumCellToolbar';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let observers;

beforeEach(() => {
  observers = [];
  globalThis.ResizeObserver = class {
    constructor(cb) { this.cb = cb; this.targets = new Set(); observers.push(this); }
    observe(el) { this.targets.add(el); }
    disconnect() { this.targets.clear(); }
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  document.body.innerHTML = '';
  delete globalThis.ResizeObserver;
});

// 툴바가 쓰는 것만 흉내 낸다 — on/off 이벤트·isFocused·view.dom·isActive
function fakeEditor(dom) {
  const handlers = {};
  return {
    isFocused: true,
    view: { dom },
    isActive: () => false,
    on(name, fn) { (handlers[name] ||= new Set()).add(fn); },
    off(name, fn) { handlers[name]?.delete(fn); },
    emit(name) { handlers[name]?.forEach((fn) => fn()); },
  };
}

it('편집기 위에 줄이 생겨 편집기만 밀려나도 툴바가 새 자리로 따라가고, 툴바가 사라지면 지켜보기를 멈춘다', async () => {
  // 카드 > 편집기 — 카드에 줄이 끼면 카드 크기만 바뀌고 편집기는 아래로 밀린다
  const card = document.createElement('div');
  const dom = document.createElement('div');
  card.appendChild(dom);
  document.body.appendChild(card);
  let editorTop = 349;
  dom.getBoundingClientRect = () => (
    { left: 523, top: editorTop, right: 1401, bottom: editorTop + 27, width: 878, height: 27 });
  const editor = fakeEditor(dom);
  const toolbar = () => container.querySelector('.ScrumCellToolbar');

  act(() => { root.render(<ScrumCellToolbar editor={editor} />); });
  act(() => { editor.emit('focus'); });
  expect(toolbar().style.top).toBe('311px');   // 편집기 위 38px

  // 편집기 이벤트 없이 카드에 '가져오기' 줄(53px)이 끼어 편집기가 내려간다 — 카드 크기 변화만 알린다
  editorTop = 402;
  act(() => { observers.filter((o) => o.targets.has(card)).forEach((o) => o.cb([])); });
  expect(toolbar().style.top).toBe('364px');

  // 포커스가 빠져 툴바가 사라지면 조상 지켜보기도 끝난다
  editor.isFocused = false;
  await act(async () => { editor.emit('blur'); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(toolbar()).toBeNull();
  expect(observers.some((o) => o.targets.size > 0)).toBe(false);
});
