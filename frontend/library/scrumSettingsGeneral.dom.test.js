// @vitest-environment jsdom
//
// 스크럼 보드 설정 '일반' 탭(ScrumSettingsGeneral) — 카드 세 장(보드 정보·공개 범위·회고) + 저장 + 위험 구역.
// 고르는 칸(공개 범위·회고 주기·기준 요일)은 회색 세그먼트(aria-pressed), 바꾸기 전에는 저장이 꺼져 있다.
// 관리자가 아니면 모두 읽기 전용이고 저장·위험 구역이 없다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ScrumSettingsGeneral from '@/components/Scrum/Settings/ScrumSettingsGeneral';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, o) => (o ? `${key}${JSON.stringify(o)}` : key) }),
}));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/library/_axios', () => ({ axios: { patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/components/Layout/Toast', () => ({ showToast: vi.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BOARD = {
  board_id: 4, name: 'AI Center', color: '#16A34A', visibility: 'private',
  retro_cadence: 'biweekly', retro_interval_weeks: null, retro_anchor_weekday: 4,
};

let root;
let container;

const render = (isAdmin) => act(() => {
  root.render(<ScrumSettingsGeneral board={BOARD} boardId={4} isAdmin={isAdmin} onUpdated={vi.fn()} />);
});
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent === label);
const saveBtn = () => container.querySelector('.ScrumSettings__SaveBtn');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('관리자', () => {
  it('카드 세 장과 위험 구역, 지금 값이 눌린 세그먼트로 보인다', () => {
    render(true);
    expect(container.querySelectorAll('.ScrumSettings__Card')).toHaveLength(4);
    expect(container.querySelector('.ScrumSettings__Card--danger')).not.toBeNull();
    expect(button('scrum.settings.visibilityPrivate').getAttribute('aria-pressed')).toBe('true');
    expect(button('scrum.cadence.biweekly').getAttribute('aria-pressed')).toBe('true');
    expect(button('scrum.grid.fri').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.ScrumSettings__Swatch[aria-pressed="true"]').getAttribute('aria-label'))
      .toBe('scrum.settings.colorAria{"color":"#16A34A"}');
  });

  it('바꾸기 전엔 저장이 꺼져 있고, N주마다를 고르면 주 수 입력이 생기며 저장이 켜진다', () => {
    render(true);
    expect(saveBtn().disabled).toBe(true);
    expect(container.querySelector('.ScrumSettings__Input--number')).toBeNull();
    act(() => { button('scrum.cadence.everyNWeeks').click(); });
    expect(button('scrum.cadence.everyNWeeks').getAttribute('aria-pressed')).toBe('true');
    expect(button('scrum.cadence.biweekly').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.ScrumSettings__Input--number')).not.toBeNull();
    expect(saveBtn().disabled).toBe(false);
  });

  it('아카이브는 보드 이름을 똑같이 적어야 확정 버튼이 켜진다', () => {
    render(true);
    act(() => { container.querySelector('.ScrumSettings__DangerBtn').click(); });
    const confirm = container.querySelector('.ScrumSettings__DangerConfirmBtn');
    expect(confirm.disabled).toBe(true);
  });
});

describe('관리자가 아닐 때', () => {
  it('세그먼트·입력은 읽기 전용이고 저장·위험 구역이 없다', () => {
    render(false);
    expect(container.querySelectorAll('.ScrumSettings__Card')).toHaveLength(3);
    expect(container.querySelector('.ScrumSettings__Card--danger')).toBeNull();
    expect(saveBtn()).toBeNull();
    expect(button('scrum.cadence.weekly').disabled).toBe(true);
    expect(container.querySelector('.ScrumSettings__Input').disabled).toBe(true);
  });
});
