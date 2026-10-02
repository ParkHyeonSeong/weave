// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
const router = vi.hoisted(() => ({ pathname: '/', asPath: '/', push: vi.fn(), query: {} }));
vi.mock('@/library/_axios', () => ({ axios: api }));
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('react-i18next', async importOriginal => ({ ...(await importOriginal()), useTranslation: () => ({ t: key => key, i18n: { language: 'en' } }) }));
import { UiPrefsProvider } from './UiPrefsContext';
import HomeView from '@/components/Home/HomeView';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root, stored;
const originalWidth = window.innerWidth;
const click = async element => { await act(async () => { element.click(); }); };
const editButton = () => container.querySelector('[data-home-edit]');

beforeEach(async () => {
  stored = { home_layout: ['app:branch', 'app:canvas', 'widget:recent'] };
  api.get.mockImplementation(async path => ({ data: { status: true, ...(path === '/profile/ui-prefs' ? { ui_prefs: stored } : { items: [], tasks: [], branches: [], rooms: [], today_pending: [], retro_due: [] }) } }));
  api.patch.mockImplementation(async (_path, patch) => { stored = { ...stored, ...patch }; return { data: { status: true } }; });
  router.push.mockReset().mockResolvedValue(true);
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<UiPrefsProvider><HomeView /></UiPrefsProvider>); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); window.innerWidth = originalWidth; vi.useRealTimers(); vi.clearAllMocks(); });

describe('home editing', () => {
  it('waits for personal preferences before showing tiles or fetching unselected widgets', async () => {
    act(() => root.render(null));
    let finish;
    api.get.mockClear().mockImplementation(path => path === '/profile/ui-prefs'
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({ data: { status: true, items: [], tasks: [], branches: [], rooms: [] } }));
    await act(async () => root.render(<UiPrefsProvider><HomeView /></UiPrefsProvider>));
    expect(container.querySelector('[data-home-item]')).toBeNull();
    expect(api.get.mock.calls.map(([path]) => path)).toEqual(['/profile/ui-prefs']);
    await act(async () => finish({ data: { status: true, ui_prefs: stored } }));
    expect(container.querySelector('[data-home-item="app:branch"]')).not.toBeNull();
    expect(container.querySelector('[data-home-item="widget:mytasks"]')).toBeNull();
  });

  it('opens an app normally, but protects its link while editing', async () => {
    expect(editButton()).not.toBeNull();
    await click(container.querySelector('[data-home-item="app:branch"] a'));
    expect(router.push).toHaveBeenCalledWith('/branch', undefined, expect.any(Object));
    router.push.mockClear();
    await click(editButton());
    await click(container.querySelector('[data-home-item="app:branch"] a'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('removes an app only from the home and can add it back from the catalog', async () => {
    expect(editButton()).not.toBeNull();
    await click(editButton());
    await click(container.querySelector('[data-home-item="app:branch"] [data-home-remove]'));
    expect(container.querySelector('[data-home-item="app:branch"]')).toBeNull();
    expect(stored.home_layout).toEqual(['app:canvas', 'widget:recent']);
    await click(container.querySelector('[data-home-add]'));
    await click(container.querySelector('[data-catalog-kind="app"]'));
    await click(container.querySelector('[data-catalog-add="app:branch"]'));
    expect(container.querySelector('[data-home-item="app:branch"]')).not.toBeNull();
    expect(stored.home_layout).toEqual(['app:canvas', 'widget:recent', 'app:branch']);
  });

  it('enters edit on long press and cancels the press when scrolling', async () => {
    expect(editButton()).not.toBeNull();
    vi.useFakeTimers();
    const tile = container.querySelector('[data-home-item="app:branch"]');
    const pointer = (type, x) => { const event = new Event(type, { bubbles: true }); Object.assign(event, { button: 0, clientX: x, clientY: 10 }); tile.dispatchEvent(event); };
    act(() => { pointer('pointerdown', 10); pointer('pointermove', 35); vi.advanceTimersByTime(550); });
    expect(editButton().getAttribute('aria-pressed')).toBe('false');
    act(() => { pointer('pointerdown', 10); vi.advanceTimersByTime(550); });
    expect(editButton().getAttribute('aria-pressed')).toBe('true');
    act(() => { pointer('pointerup', 10); tile.querySelector('a').click(); });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('restores the previous layout and shows failure when saving fails', async () => {
    expect(editButton()).not.toBeNull();
    api.patch.mockRejectedValueOnce(new Error('offline'));
    await click(editButton());
    await click(container.querySelector('[data-home-item="app:branch"] [data-home-remove]'));
    expect(container.querySelector('[data-home-item="app:branch"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('home widget resizing', () => {
  const tile = () => container.querySelector('[data-home-item="widget:recent"]');
  const handle = () => tile().querySelector('[data-home-resize]');
  const key = async value => { await act(async () => handle().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))); };

  it('resizes with the keyboard, persists it, and leaves item order intact', async () => {
    await click(editButton());
    expect(handle()).not.toBeNull();
    expect(container.querySelector('[data-home-item="app:canvas"] [data-home-resize]')).toBeNull();
    await key('ArrowRight');
    await key('ArrowDown');
    expect(tile().style.gridColumn).toBe('span 5');
    expect(tile().style.gridRow).toBe('span 3');
    expect(stored.home_sizes['widget:recent']).toEqual({ columns: 5, rows: 3 });
    expect(stored.home_layout).toEqual(['app:branch', 'app:canvas', 'widget:recent']);
    act(() => root.render(null));
    await act(async () => root.render(<UiPrefsProvider><HomeView /></UiPrefsProvider>));
    expect(tile().style.gridRow).toBe('span 3');
    expect(handle()).toBeNull();
  });

  it('previews pointer resizing, supports cancellation, and saves only on release', async () => {
    await click(editButton());
    expect(handle()).not.toBeNull();
    container.querySelector('.HomeCanvas__Grid').getBoundingClientRect = () => ({ width: 912 });
    const pointer = (type, x, y) => { const event = new Event(type, { bubbles: true }); Object.assign(event, { button: 0, pointerId: 1, clientX: x, clientY: y }); handle().dispatchEvent(event); };
    act(() => { pointer('pointerdown', 300, 200); pointer('pointermove', 532, 432); });
    expect(tile().style.gridColumn).toBe('span 6');
    expect(tile().style.gridRow).toBe('span 4');
    expect(api.patch).not.toHaveBeenCalled();
    await key('Escape');
    expect(tile().style.gridColumn).toBe('span 4');
    expect(api.patch).not.toHaveBeenCalled();
    act(() => { pointer('pointerdown', 300, 200); pointer('pointermove', 532, 432); });
    await act(async () => pointer('pointerup', 532, 432));
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(stored.home_sizes['widget:recent']).toEqual({ columns: 6, rows: 4 });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('rolls back a rejected size save without disturbing the layout', async () => {
    await click(editButton());
    expect(handle()).not.toBeNull();
    api.patch.mockRejectedValueOnce(new Error('offline'));
    await key('ArrowDown');
    expect(tile().style.gridRow).toBe('span 2');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(stored.home_layout).toEqual(['app:branch', 'app:canvas', 'widget:recent']);
  });

  it('fits narrow screens and keeps the desktop width when only changing height', async () => {
    act(() => root.render(null));
    stored.home_sizes = { 'widget:recent': { columns: 8, rows: 5 } };
    window.innerWidth = 600;
    await act(async () => root.render(<UiPrefsProvider><HomeView /></UiPrefsProvider>));
    expect(tile().style.gridColumn).toBe('span 4');
    await click(editButton());
    await key('ArrowRight');
    expect(api.patch).not.toHaveBeenCalled();
    await key('ArrowDown');
    expect(stored.home_sizes['widget:recent']).toEqual({ columns: 8, rows: 6 });
    act(() => { window.innerWidth = 1200; window.dispatchEvent(new Event('resize')); });
    expect(tile().style.gridColumn).toBe('span 8');
    expect(tile().style.gridRow).toBe('span 6');
  });

  it('shows more fetched content after growing without remounting the widget', async () => {
    act(() => root.render(null));
    api.get.mockImplementation(async path => ({ data: { status: true, ...(path === '/profile/ui-prefs' ? { ui_prefs: stored } : {
      items: Array.from({ length: 8 }, (_, index) => ({ type: 'page', page_id: index + 1, canvas_id: 1, canvas_name: 'Canvas', title: `Document ${index + 1}` })),
    }) } }));
    await act(async () => root.render(<UiPrefsProvider><HomeView /></UiPrefsProvider>));
    expect(tile().querySelectorAll('.RecentItems__Item')).toHaveLength(3);
    const fetches = api.get.mock.calls.filter(([path]) => path === '/recent-views').length;
    await click(editButton());
    await key('ArrowDown');
    expect(tile().querySelectorAll('.RecentItems__Item')).toHaveLength(5);
    expect(api.get.mock.calls.filter(([path]) => path === '/recent-views')).toHaveLength(fetches);
  });

  it('discards a lost gesture and ignores another pointer releasing', async () => {
    await click(editButton());
    container.querySelector('.HomeCanvas__Grid').getBoundingClientRect = () => ({ width: 912 });
    const pointer = (type, pointerId, clientY) => { const event = new Event(type, { bubbles: true }); Object.assign(event, { button: 0, pointerId, clientX: 300, clientY }); handle().dispatchEvent(event); };
    act(() => { pointer('pointerdown', 1, 200); pointer('pointermove', 1, 432); pointer('pointerup', 2, 432); });
    expect(tile().style.gridRow).toBe('span 4');
    expect(api.patch).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(tile().style.gridRow).toBe('span 2');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('does not scroll or resize when holding a handle near the bottom without dragging', async () => {
    await click(editButton());
    vi.useFakeTimers();
    container.className = 'Layout__Content';
    container.getBoundingClientRect = () => ({ top: 0, bottom: 600 });
    container.querySelector('.HomeCanvas__Grid').getBoundingClientRect = () => ({ width: 912 });
    const pointer = type => { const event = new Event(type, { bubbles: true }); Object.assign(event, { button: 0, pointerId: 1, clientX: 500, clientY: 580 }); handle().dispatchEvent(event); };
    act(() => { pointer('pointerdown'); vi.advanceTimersByTime(240); });
    expect(container.scrollTop).toBe(0);
    expect(tile().style.gridRow).toBe('span 2');
    await act(async () => pointer('pointerup'));
    expect(api.patch).not.toHaveBeenCalled();
  });
});
