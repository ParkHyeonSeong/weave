// @vitest-environment jsdom
//
// 보드 머리의 '편집 중' 표시(ScrumPresence) — 공용 AvatarStack으로 아바타는 4개까지, 나머지는 +N 칩.
// awareness 항목의 name이 아바타 이름으로 읽히는지, 인원 글자가 전체 수를 세는지 본다.
// +N은 가려진 사람 이름을 마우스(올리기)·키보드(포커스)로 보여 주고, 스크린리더에는 설명으로 알린다.
import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ScrumPresence from '@/components/Scrum/ScrumPresence';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, o) => (o ? `${key}${JSON.stringify(o)}` : key) }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const user = (n) => ({ clientId: n, userId: n, name: `사람${n}`, avatar_url: null, avatar_color: null });

let root;
let container;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

it('4명까지는 아바타만 겹쳐 보이고 편집 중 인원을 글자로 보인다', () => {
  act(() => { root.render(<ScrumPresence users={[1, 2, 3].map(user)} />); });
  const avatars = container.querySelectorAll('.AvatarStack .Avatar');
  expect(avatars).toHaveLength(3);
  expect(avatars[0].getAttribute('title')).toBe('사람1');
  expect(container.querySelector('.AvatarStack__More')).toBeNull();
  expect(container.querySelector('.ScrumBoard__LiveText').textContent).toBe('scrum.board.editingCount{"count":3}');
});

it('5명 이상이면 아바타 4개 뒤에 +N 칩, 인원 글자는 전체 수', () => {
  act(() => { root.render(<ScrumPresence users={[1, 2, 3, 4, 5, 6].map(user)} />); });
  expect(container.querySelectorAll('.AvatarStack .Avatar')).toHaveLength(4);
  expect(container.querySelector('.AvatarStack__More').textContent).toBe('+2');
  expect(container.querySelector('.ScrumBoard__LiveText').textContent).toBe('scrum.board.editingCount{"count":6}');
});

// ── +N에 가려진 이름 ─────────────────────────────────────────────────────────────
const render = (ids) => act(() => { root.render(<ScrumPresence users={ids.map(user)} />); });
const chip = () => container.querySelector('.AvatarStack__More');
// 이름 창은 DropdownPortal로 body에 포털된다
const shownNames = () => [...document.querySelectorAll('.AvatarStack__Names li')].map((li) => li.textContent);
const description = () => document.getElementById(chip().getAttribute('aria-describedby'))?.textContent;
const hover = (el) => act(() => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
const unhover = (el) => act(() => { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
const pressEscape = () => act(() => {
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
});

it.each([
  [0, 0, null],
  [1, 1, null],
  [4, 4, null],
  [5, 4, '+1'],
  [6, 4, '+2'],
])('%i명이면 아바타 %i개, +N은 %s', (n, avatars, more) => {
  render(Array.from({ length: n }, (_, i) => i + 1));
  expect(container.querySelectorAll('.AvatarStack .Avatar')).toHaveLength(avatars);
  expect(chip()?.textContent ?? null).toBe(more);
});

it('+N에 마우스를 올리면 가려진 사람 이름만 보이고, 마우스가 떠나면 닫힌다', () => {
  render([1, 2, 3, 4, 5, 6]);
  expect(shownNames()).toEqual([]);
  hover(chip());
  expect(shownNames()).toEqual(['사람5', '사람6']);
  unhover(chip());
  expect(shownNames()).toEqual([]);
});

it('마우스가 +N에서 포털된 이름 창으로 옮겨 가도 닫히지 않고, 창에서 바깥으로 나가면 닫힌다', () => {
  render([1, 2, 3, 4, 5, 6]);
  hover(chip());
  const name = document.querySelector('.AvatarStack__Names li');
  act(() => { chip().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: name })); });
  expect(shownNames()).toEqual(['사람5', '사람6']);
  act(() => { name.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
  expect(shownNames()).toEqual([]);
});

it('키보드: +N에 포커스가 오면 이름이 보이고, Esc로 닫히며(포커스는 그대로), 다시 누르면 열리고, 포커스가 떠나면 닫힌다', () => {
  render([1, 2, 3, 4, 5, 6]);
  expect(chip().tagName).toBe('BUTTON');
  act(() => { chip().focus(); });
  expect(shownNames()).toEqual(['사람5', '사람6']);
  pressEscape();
  expect(shownNames()).toEqual([]);
  expect(document.activeElement).toBe(chip());
  act(() => { chip().click(); });   // 버튼 위 Enter와 같은 동작
  expect(shownNames()).toEqual(['사람5', '사람6']);
  act(() => { chip().blur(); });
  expect(shownNames()).toEqual([]);
});

it('스크린리더: +N은 열지 않아도 숨은 인원과 이름을 설명으로 갖는다', () => {
  render([1, 2, 3, 4, 5, 6]);
  expect(chip().getAttribute('aria-describedby')).toBeTruthy();
  expect(description()).toBe('misc.avatar.hiddenNames{"count":2,"names":"사람5, 사람6"}');
});

it('목록이 바뀌면 이름도 지금 목록을 따른다 — 나간 사람·바뀐 순서가 남지 않고, 다시 늘어도 저절로 열리지 않는다', () => {
  render([1, 2, 3, 4, 5, 6]);
  act(() => { chip().focus(); });
  expect(shownNames()).toEqual(['사람5', '사람6']);

  render([1, 2, 3, 4, 5]);         // 사람6이 나갔다
  expect(chip().textContent).toBe('+1');
  expect(shownNames()).toEqual(['사람5']);

  render([5, 2, 3, 4, 1]);         // 순서가 바뀌어 다섯째가 사람1
  expect(shownNames()).toEqual(['사람1']);
  expect(description()).toBe('misc.avatar.hiddenNames{"count":1,"names":"사람1"}');

  render([1, 2, 3, 4]);            // 넷 이하 — +N과 이름 창이 함께 사라진다
  expect(chip()).toBeNull();
  expect(shownNames()).toEqual([]);

  render([1, 2, 3, 4, 5, 6, 7]);
  expect(chip().textContent).toBe('+3');
  expect(shownNames()).toEqual([]);
});
