// @vitest-environment jsdom
// 협업 연결·전달 안내 배지의 한·영 문구와 접근성 계약. 연결돼 있고 확인 안 된 편집이 없으면 아무것도 그리지 않는다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from '@/library/i18n';
import CollabStatusBadge from '@/components/shared/CollabStatusBadge';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root = null;
beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; });
afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = null; }
  await i18next.changeLanguage('en');
});

async function render(props) {
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<CollabStatusBadge {...props} />); });
  return document.querySelector('.CollabStatusBadge');
}

describe('CollabStatusBadge', () => {
  it('연결돼 있고 확인 안 된 편집이 없으면 아무것도 그리지 않는다', async () => {
    expect(await render({ connection: 'connected', pending: false })).toBeNull();
  });

  it.each([
    ['en', 'connecting', false, 'Connecting…', false],
    ['ko', 'connecting', false, '연결 중…', false],
    ['en', 'reconnecting', false, 'Connection lost · Reconnecting…', true],
    ['ko', 'reconnecting', false, '연결이 끊겼어요 · 다시 연결하는 중…', true],
    ['en', 'reconnecting', true, 'Changes not yet confirmed · Keep this page open until it reconnects', true],
    ['ko', 'reconnecting', true, '전송이 확인되지 않은 입력이 있어요 · 다시 연결될 때까지 이 화면을 닫지 마세요', true],
    ['en', 'connected', true, 'Confirming your changes…', true],
    ['ko', 'connected', true, '입력 전송 확인 중…', true],
  ])('%s · %s · pending=%s → "%s"', async (lng, connection, pending, text, warn) => {
    await i18next.changeLanguage(lng);
    const el = await render({ connection, pending });
    expect(el.textContent).toBe(text);
    expect(el.getAttribute('role')).toBe('status');
    expect(el.classList.contains('CollabStatusBadge--warn')).toBe(warn);
  });
});
