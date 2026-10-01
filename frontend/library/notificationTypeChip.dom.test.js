// @vitest-environment jsdom
//
// GitHub PR 자동 전환(backend/core/service/task_transition.py)이 보내는 알림 type은 'task_status'다.
// Header의 아이콘·칩 표는 아무도 보내지 않는 'task_status_changed'를 키로 들고 있어서,
// 이 알림만 기본 종 아이콘에 종류 칩('상태') 없이 그려졌다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2 } from 'lucide-react';

vi.mock('next/router', () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(async () => {}),
    pathname: '/', query: {}, asPath: '/', events: { on: vi.fn(), off: vi.fn() },
  }),
}));

import i18next from '@/library/i18n';
import { ThemeProvider } from '@/library/theme';
import Header from '@/components/Layout/Header';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// task_transition.py가 만드는 알림 모양 그대로
const STATUS_NOTI = {
  notification_id: 1,
  type: 'task_status',
  actor_id: null,
  actor_name: null,
  title: 'WV-1 Ship it changed status',
  payload: { key: 'taskStatusChanged', params: { ref: 'WV-1 Ship it' } },
  link: '/branch/1/task/2',
  entity_type: 'task',
  entity_id: 2,
  is_read: false,
  created_at: '2026-09-30T00:00:00Z',
};

let roots = [];

function render(node) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const r = createRoot(el);
  roots.push(r);
  act(() => { r.render(node); });
  return el;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, addEventListener: () => {}, removeEventListener: () => {},
  });
  globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
  document.body.innerHTML = '';
});

afterEach(() => {
  roots.forEach((r) => act(() => r.unmount()));
  roots = [];
});

describe("알림 종류 'task_status'(GitHub 자동 전환)", () => {
  it("상태 아이콘과 '상태' 칩으로 그린다", async () => {
    const header = render(
      <ThemeProvider>
        <Header isMobile={false} notifications={[STATUS_NOTI]} unreadCount={1} />
      </ThemeProvider>,
    );
    await act(async () => { header.querySelector('.Header__NotiWrap .Header__IconBtn').click(); });

    const row = header.querySelector('.Header__NotiItem');
    const chip = row.querySelector('.Header__NotiChip');
    expect(chip?.textContent).toBe(i18next.t('notifications.types.status'));
    expect(chip.classList.contains('Header__NotiChip--task')).toBe(true);

    const expectedIcon = render(<CheckCircle2 />).querySelector('svg').getAttribute('class');
    expect(row.querySelector('.Header__NotiIcon svg').getAttribute('class')).toBe(expectedIcon);
  });
});
