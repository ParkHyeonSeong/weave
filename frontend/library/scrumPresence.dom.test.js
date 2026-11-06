// @vitest-environment jsdom
//
// 보드 머리의 '편집 중' 표시(ScrumPresence) — 공용 AvatarStack으로 아바타는 4개까지, 나머지는 +N 칩.
// awareness 항목의 name이 아바타 이름으로 읽히는지, 인원 글자가 전체 수를 세는지 본다.
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
