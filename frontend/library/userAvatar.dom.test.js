// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { buildAvatarDOM, avatarMarkup } from './userAvatar.js';
import Avatar from '@/components/common/Avatar';

vi.mock('@/library/_axios', () => ({ getBaseURL: () => '' }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('buildAvatarDOM', () => {
  it('사진 있으면 baseUrl 접두된 img 렌더', () => {
    const el = buildAvatarDOM(
      { username: '김철수', user_id: 3, avatar_url: '/api/uploads/avatars/a.png' },
      'http://h',
    );
    const img = el.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.src).toBe('http://h/api/uploads/avatars/a.png');
    expect(el.getAttribute('title')).toBe('김철수');
  });

  it('사진 없으면 이니셜+배경색', () => {
    const el = buildAvatarDOM({ username: 'henry', user_id: 1 });
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('HE');
    expect(el.style.background).not.toBe('');
  });

  it('이미지 로드 실패 시 이니셜로 폴백', () => {
    const el = buildAvatarDOM(
      { username: '김철수', user_id: 3, avatar_url: '/api/uploads/avatars/broken.png' },
      'http://h',
    );
    el.querySelector('img').onerror();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('철수');
  });

  it('악성 username도 textContent라 마크업 주입 불가', () => {
    const el = buildAvatarDOM({ username: '<img src=x onerror=alert(1)>', user_id: 1 });
    expect(el.querySelector('img')).toBeNull();
    expect(el.innerHTML).not.toContain('<img');
  });
});

// 공용 <Avatar>와 협업 커서용 buildAvatarDOM은 같은 사용자를 같은 색으로 칠한다(jsdom은 hex를 rgb()로 돌려준다)
describe('<Avatar>와 buildAvatarDOM — 같은 표시색', () => {
  let root;
  let container;
  afterEach(() => {
    if (root) act(() => { root.unmount(); });
    container?.remove();
    root = null;
  });
  function renderAvatar(user) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root.render(<Avatar user={user} />); });
    return container.querySelector('.Avatar');
  }

  it.each([
    ['자동 배정 #059669 자리', { username: 'henry', user_id: 1 }, 'rgb(4, 120, 87)'],
    ['저장값 #0D9488', { username: 'henry', user_id: 3, avatar_color: '#0D9488' }, 'rgb(15, 118, 110)'],
    ['저장값 #059669', { username: 'henry', user_id: 3, avatar_color: '#059669' }, 'rgb(4, 120, 87)'],
    ['나머지 색은 그대로(#9333EA)', { username: 'henry', user_id: 3 }, 'rgb(147, 51, 234)'],
  ])('%s', (_, user, bg) => {
    expect(buildAvatarDOM(user).style.background).toBe(bg);
    const el = renderAvatar(user);
    expect(el.style.background).toBe(bg);
    expect(el.textContent).toBe('HE');
  });

  it('사진이 있으면 사진을 먼저 보이고, 깨지면 이니셜과 같은 표시색으로 바뀐다(둘 다)', () => {
    const user = { username: '김철수', user_id: 7, avatar_url: '/api/uploads/avatars/broken.png' };

    const dom = buildAvatarDOM(user);
    expect(dom.querySelector('img')).not.toBeNull();
    expect(dom.style.background).toBe('');
    dom.querySelector('img').onerror();
    expect(dom.textContent).toBe('철수');
    expect(dom.style.background).toBe('rgb(15, 118, 110)');

    const el = renderAvatar(user);
    expect(el.querySelector('img')).not.toBeNull();
    expect(el.style.background).toBe('');
    act(() => { el.querySelector('img').dispatchEvent(new Event('error')); });
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('철수');
    expect(el.style.background).toBe('rgb(15, 118, 110)');
  });
});

describe('avatarMarkup — avatar_url 신뢰 경계', () => {
  it('외부 절대 URL은 사진으로 취급하지 않음 (트래킹 픽셀 차단)', () => {
    const m = avatarMarkup({ username: 'evil', user_id: 9, avatar_url: 'http://evil.com/p.gif' }, 'http://h');
    expect(m.src).toBeNull();
  });
  it('프로토콜 상대 URL(//)도 거부', () => {
    const m = avatarMarkup({ username: 'evil', user_id: 9, avatar_url: '//evil.com/p.gif' }, 'http://h');
    expect(m.src).toBeNull();
  });
  it('서버 상대 경로는 허용', () => {
    const m = avatarMarkup({ username: 'ok', user_id: 1, avatar_url: '/api/uploads/avatars/a.png' }, 'http://h');
    expect(m.src).toBe('http://h/api/uploads/avatars/a.png');
  });
});
