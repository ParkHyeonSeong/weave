// @vitest-environment jsdom
//
// 공용 AvatarStack — 다른 화면(홈 카드·캔버스 접속자·트랙 머리)이 쓰는 기본 +N 글자와
// onOverflowClick +N 버튼은 그대로다. 가려진 이름 보기는 켠 곳(스크럼 편집 중 표시)에서만 붙는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import AvatarStack from '@/components/common/AvatarStack';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, o) => (o ? `${key}${JSON.stringify(o)}` : key) }),
}));
vi.mock('@/library/_axios', () => ({ getBaseURL: () => '' }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USERS = [1, 2, 3, 4, 5, 6].map((n) => ({ user_id: n, username: `member${n}` }));

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

const chip = () => container.querySelector('.AvatarStack__More');
const namesPopup = () => document.querySelector('.AvatarStack__Names');

describe('AvatarStack 기본 동작은 그대로', () => {
  it('기본 +N은 글자일 뿐이다 — 버튼이 아니고 마우스를 올려도 이름 창이 뜨지 않는다', () => {
    act(() => { root.render(<AvatarStack users={USERS} max={4} />); });
    expect(chip().tagName).toBe('SPAN');
    expect(chip().textContent).toBe('+2');
    expect(chip().getAttribute('aria-describedby')).toBeNull();
    act(() => { chip().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
    expect(namesPopup()).toBeNull();
  });

  it('onOverflowClick이 있으면 +N 버튼을 누를 때 그 처리를 부르고, 이름 창은 뜨지 않는다', () => {
    const onOverflowClick = vi.fn();
    act(() => { root.render(<AvatarStack users={USERS} max={4} onOverflowClick={onOverflowClick} />); });
    expect(chip().tagName).toBe('BUTTON');
    act(() => { chip().focus(); });
    act(() => { chip().click(); });
    expect(onOverflowClick).toHaveBeenCalledTimes(1);
    expect(namesPopup()).toBeNull();
  });
});
