// @vitest-environment jsdom
//
// 프로필 아바타 색 고르기 — 스와치와 미리보기는 화면 표시색(흰 이니셜 대비를 맞춘 색)으로 칠하되,
// 고름 표시와 서버로 보내는 값은 저장값(AVATAR_COLORS 팔레트 값) 그대로다. 백엔드 허용 목록이 그 값이다.
// 색과 무관한 하위 구역(토큰·화면 모양·언어)은 빈 구역으로 대신한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Profile from '@/components/Profile/Profile';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key }),
}));
vi.mock('@/library/_axios', () => ({ axios: api, getBaseURL: () => '' }));
vi.mock('@/components/Profile/ProfileTokens', () => ({ default: () => null }));
vi.mock('@/components/Profile/AppearanceSection', () => ({ default: () => null }));
vi.mock('@/components/Profile/LanguageRegionSection', () => ({ default: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ME = { user_id: 3, username: '박현성', email: 'park@example.com', avatar_url: null, avatar_color: '#059669' };

let root;
let container;

const swatch = (stored) => container.querySelector(`.Profile__ColorSwatch[title="${stored}"]`);
const isSelected = (stored) => swatch(stored).classList.contains('Profile__ColorSwatch--selected');
const preview = () => container.querySelector('.Profile__AvatarMain');

beforeEach(async () => {
  api.get.mockResolvedValue({ data: { status: true, user: ME } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Profile />); });
  await act(async () => {});   // /profile/me 응답
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('프로필 아바타 색', () => {
  it('저장된 #059669는 고른 것으로 표시되고, 그 스와치와 미리보기는 진한 표시색으로 칠한다', () => {
    expect(isSelected('#059669')).toBe(true);
    expect(swatch('#059669').style.background).toBe('rgb(4, 120, 87)');
    expect(swatch('#0D9488').style.background).toBe('rgb(15, 118, 110)');
    expect(preview().style.background).toBe('rgb(4, 120, 87)');
    // 나머지 색 스와치는 저장값 그대로 칠한다
    expect(swatch('#5E6AD2').style.background).toBe('rgb(94, 106, 210)');
    expect(swatch('#475569').style.background).toBe('rgb(71, 85, 105)');
  });

  it('#0D9488 스와치를 누르면 서버에는 저장값 #0D9488을 보내고, 돌아온 값으로 고름 표시가 옮겨 간다', async () => {
    api.patch.mockResolvedValue({ data: { status: true, avatar_color: '#0D9488' } });
    await act(async () => { swatch('#0D9488').click(); });
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith('/profile/avatar-color', { color: '#0D9488' });
    expect(isSelected('#0D9488')).toBe(true);
    expect(isSelected('#059669')).toBe(false);
    expect(preview().style.background).toBe('rgb(15, 118, 110)');
    expect(JSON.parse(sessionStorage.getItem('profile')).avatar_color).toBe('#0D9488');
  });
});
