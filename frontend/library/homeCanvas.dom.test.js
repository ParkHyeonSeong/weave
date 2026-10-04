// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
const router = vi.hoisted(() => ({ pathname: '/', asPath: '/', push: vi.fn(), query: {} }));
const dnd = vi.hoisted(() => ({ handlers: null }));
vi.mock('@/library/_axios', () => ({ axios: api }));
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('react-i18next', async importOriginal => ({ ...(await importOriginal()), useTranslation: () => ({ t: key => key, i18n: { language: 'en' } }) }));
// jsdom cannot measure a native drag. Exercise our DndContext event boundary,
// keeping the real HomeView, preference provider, geometry and resize handlers.
vi.mock('@dnd-kit/core', async importOriginal => ({
  ...(await importOriginal()),
  DndContext: props => { dnd.handlers = props; return props.children; },
  DragOverlay: ({ children }) => children,
  useDraggable: () => ({ setNodeRef() {}, attributes: {}, listeners: {}, isDragging: false }),
}));
import { UiPrefsProvider } from './UiPrefsContext';
import HomeView from '@/components/Home/HomeView';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root, stored;
const originalWidth = window.innerWidth;
const click = async element => { await act(async () => element.click()); };
const editButton = () => container.querySelector('[data-home-edit]');
const tile = id => container.querySelector(`[data-home-item="${id}"]`);
const handle = () => tile('widget:recent').querySelector('[data-home-resize]');
const key = async (element, value) => { await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))); };
const resizeWindow = width => act(() => { window.innerWidth = width; window.dispatchEvent(new Event('resize')); });
const pointer = (element, type, x, y, pointerId = 1) => {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { button: 0, pointerId, clientX: x, clientY: y });
  element.dispatchEvent(event);
};
const drag = async (phase, id = 'app:branch', x = 0, y = 0) => {
  await act(async () => dnd.handlers[phase]({ active: { id }, over: null, delta: { x, y } }));
};
const mount = async () => { await act(async () => root.render(<UiPrefsProvider><HomeView /></UiPrefsProvider>)); };
const remount = async () => { act(() => root.render(null)); await mount(); };

beforeEach(async () => {
  window.innerWidth = 984; // 912px grid: eight columns, 116px center-to-center.
  stored = { home_layout: ['app:branch', 'app:canvas', 'widget:recent'] };
  api.get.mockImplementation(async path => ({ data: { status: true, ...(path === '/profile/ui-prefs' ? { ui_prefs: stored } : { items: [], tasks: [], branches: [], rooms: [], today_pending: [], retro_due: [] }) } }));
  api.patch.mockImplementation(async (_path, patch) => { stored = { ...stored, ...patch }; return { data: { status: true } }; });
  router.push.mockReset().mockResolvedValue(true);
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const content = this.classList.contains('Layout__Content');
    const narrow = window.innerWidth <= 760;
    const width = content ? window.innerWidth : window.innerWidth - (narrow ? 48 : 72);
    return { x: content ? 0 : 36, y: content ? 0 : 100, left: content ? 0 : 36,
      top: content ? 0 : 100, width, height: 600, right: width + 36, bottom: 700 };
  });
  container = document.createElement('div'); container.className = 'Layout__Content'; document.body.append(container); root = createRoot(container);
  await mount();
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); window.innerWidth = originalWidth;
  vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks();
});

describe('home cell editing', () => {
  it('waits for personal preferences before showing tiles or fetching widgets', async () => {
    act(() => root.render(null));
    let finish;
    api.get.mockClear().mockImplementation(path => path === '/profile/ui-prefs'
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({ data: { status: true, items: [], tasks: [], branches: [], rooms: [] } }));
    await mount();
    expect(container.querySelector('[data-home-item]')).toBeNull();
    expect(api.get.mock.calls.map(([path]) => path)).toEqual(['/profile/ui-prefs']);
    await act(async () => finish({ data: { status: true, ui_prefs: stored } }));
    expect(tile('app:branch')).not.toBeNull();
    expect(tile('widget:mytasks')).toBeNull();
  });

  it('opens links normally and protects them while editing', async () => {
    await click(tile('app:branch').querySelector('a'));
    expect(router.push).toHaveBeenCalledWith('/branch', undefined, expect.any(Object));
    router.push.mockClear();
    await click(editButton());
    await click(tile('app:branch').querySelector('a'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('uses explicit positions and saves a blank-cell drop without moving neighbors', async () => {
    expect(tile('widget:recent').style.gridColumn).toBe('3 / span 4');
    await click(editButton());
    const neighbor = tile('widget:recent').style.cssText;
    await drag('onDragStart');
    await drag('onDragMove', 'app:branch', 812, 348);
    expect(container.querySelector('[data-home-placement]')).not.toBeNull();
    expect(api.patch).not.toHaveBeenCalled();
    await drag('onDragEnd', 'app:branch', 812, 348);
    expect(stored.home_canvas.layouts.wide.placements['app:branch']).toEqual({ x: 7, y: 3, w: 1, h: 1 });
    expect(tile('widget:recent').style.cssText).toBe(neighbor);
    expect(api.patch).toHaveBeenCalledTimes(1);
    await remount();
    expect(tile('app:branch').style.gridColumn).toBe('8 / span 1');
    expect(tile('app:branch').style.gridRow).toBe('4 / span 1');
  });

  it('rejects a collision and a drop outside the canvas', async () => {
    await click(editButton());
    for (const dx of [348, -116, 928]) {
      await drag('onDragStart');
      await drag('onDragMove', 'app:branch', dx, 0);
      expect(container.querySelector('[data-home-placement]').getAttribute('data-valid')).toBe('false');
      expect(container.querySelector('.HomeCanvas__Status').textContent).toBe(`home.canvas.${dx === 348 ? 'occupied' : 'outside'}`);
      await drag('onDragEnd', 'app:branch', dx, 0);
      expect(tile('app:branch').style.gridColumn).toBe('1 / span 1');
    }
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('moves an app by real rows and columns using the keyboard', async () => {
    await click(editButton());
    const moveButton = tile('app:branch').querySelector('.HomeCanvas__Move');
    moveButton.focus();
    await key(moveButton, 'ArrowDown');
    expect(stored.home_canvas.layouts.wide.placements['app:branch']).toEqual({ x: 0, y: 1, w: 1, h: 1 });
    expect(stored.home_canvas.layouts.wide.placements['app:canvas']).toEqual({ x: 1, y: 0, w: 1, h: 1 });
    expect(stored.home_canvas.layouts.compact.placements['app:branch']).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(document.activeElement).toBe(moveButton);
  });

  it('removes and adds only the selected home item in both modes', async () => {
    await click(editButton());
    await click(tile('app:branch').querySelector('[data-home-remove]'));
    expect(tile('app:branch')).toBeNull();
    expect(stored.home_canvas.items).toEqual(['app:canvas', 'widget:recent']);
    expect(stored.home_canvas.layouts.compact.placements['app:branch']).toBeUndefined();
    const old = structuredClone(stored.home_canvas.layouts);
    await click(container.querySelector('[data-home-add]'));
    await click(container.querySelector('[data-catalog-kind="app"]'));
    await click(container.querySelector('[data-catalog-add="app:branch"]'));
    expect(tile('app:branch')).not.toBeNull();
    for (const mode of ['wide', 'compact']) {
      expect(stored.home_canvas.layouts[mode].placements['widget:recent']).toEqual(old[mode].placements['widget:recent']);
    }
  });

  it('cancels long press on pointer movement and internal scroll', async () => {
    vi.useFakeTimers();
    const app = tile('app:branch');
    act(() => { pointer(app, 'pointerdown', 10, 10); pointer(app, 'pointermove', 35, 10); vi.advanceTimersByTime(550); });
    expect(editButton().getAttribute('aria-pressed')).toBe('false');
    act(() => {
      pointer(app, 'pointerdown', 10, 10);
      tile('widget:recent').querySelector('.Widget__Body').dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(550);
    });
    expect(editButton().getAttribute('aria-pressed')).toBe('false');
    act(() => { pointer(app, 'pointerdown', 10, 10); vi.advanceTimersByTime(550); });
    expect(editButton().getAttribute('aria-pressed')).toBe('true');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('blocks editing corrupt new preferences rather than replacing them with legacy', async () => {
    stored.home_canvas = { version: 2, items: [] };
    await remount();
    expect(editButton().disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('restores the confirmed state after a rejected placement save', async () => {
    await click(editButton());
    api.patch.mockRejectedValueOnce(new Error('offline'));
    await key(tile('app:branch').querySelector('.HomeCanvas__Move'), 'ArrowDown');
    expect(tile('app:branch').style.gridRow).toBe('1 / span 1');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('does not save a click-sized gesture or a window resize', async () => {
    await click(editButton());
    await drag('onDragStart');
    await drag('onDragEnd');
    resizeWindow(1920); resizeWindow(390); resizeWindow(984);
    expect(api.patch).not.toHaveBeenCalled();
    expect(tile('widget:recent').style.gridColumn).toBe('3 / span 4');
  });

  it('discards a drag if geometry changes even when column count stays the same', async () => {
    await click(editButton());
    await drag('onDragStart');
    await drag('onDragMove', 'app:branch', 0, 116);
    resizeWindow(980); // remains eight columns
    await drag('onDragEnd', 'app:branch', 0, 116);
    expect(api.patch).not.toHaveBeenCalled();
    expect(tile('app:branch').style.gridRow).toBe('1 / span 1');
  });

  it('cancels a drag on Escape without ending editing or saving later on release', async () => {
    await click(editButton());
    await drag('onDragStart');
    await drag('onDragMove', 'app:branch', 0, 116);
    await key(container.querySelector('.HomeCanvas'), 'Escape');
    await drag('onDragEnd', 'app:branch', 0, 116);
    expect(api.patch).not.toHaveBeenCalled();
    expect(editButton().getAttribute('aria-pressed')).toBe('true');
  });
});

describe('anchored widget resizing', () => {
  it('grows the selected widget, keeps positions, and restores the result on reload', async () => {
    await click(editButton());
    await key(handle(), 'ArrowRight'); await key(handle(), 'ArrowDown');
    expect(stored.home_canvas.layouts.wide.placements['widget:recent']).toEqual({ x: 2, y: 0, w: 5, h: 3 });
    expect(stored.home_canvas.layouts.wide.placements['app:branch']).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    await remount();
    expect(tile('widget:recent').style.gridRow).toBe('1 / span 3');
    expect(handle()).toBeNull();
  });

  it('keeps a pointer resize as a candidate until release and supports cancellation', async () => {
    await click(editButton());
    act(() => { pointer(handle(), 'pointerdown', 300, 200); pointer(handle(), 'pointermove', 532, 432); });
    expect(tile('widget:recent').style.gridColumn).toBe('3 / span 4');
    expect(container.querySelector('[data-home-placement]').style.width).toBe('680px');
    expect(api.patch).not.toHaveBeenCalled();
    await key(handle(), 'Escape');
    expect(container.querySelector('[data-home-placement]')).toBeNull();
    act(() => { pointer(handle(), 'pointerdown', 300, 200); pointer(handle(), 'pointermove', 532, 432); });
    await act(async () => pointer(handle(), 'pointerup', 532, 432));
    expect(stored.home_canvas.layouts.wide.placements['widget:recent']).toEqual({ x: 2, y: 0, w: 6, h: 4 });
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('cancels an overlapping resize instead of moving its neighbor', async () => {
    await click(editButton());
    await drag('onDragStart', 'app:branch');
    await drag('onDragEnd', 'app:branch', 696, 0);
    api.patch.mockClear();
    await key(handle(), 'ArrowRight');
    expect(api.patch).not.toHaveBeenCalled();
    expect(tile('widget:recent').style.gridColumn).toBe('3 / span 4');
    expect(tile('app:branch').style.gridColumn).toBe('7 / span 1');
  });

  it('preserves the original wide size when the first edit is in compact mode', async () => {
    stored.home_sizes = { 'widget:recent': { columns: 8, rows: 5 } };
    resizeWindow(390); await remount();
    await click(editButton());
    await key(handle(), 'ArrowDown');
    expect(stored.home_canvas.layouts.compact.placements['widget:recent']).toEqual({ x: 0, y: 1, w: 4, h: 6 });
    expect(stored.home_canvas.layouts.wide.placements['widget:recent']).toEqual({ x: 0, y: 1, w: 8, h: 5 });
    resizeWindow(984);
    expect(tile('widget:recent').style.gridColumn).toBe('1 / span 8');
    expect(tile('widget:recent').style.gridRow).toBe('2 / span 5');
  });

  it('rolls back a rejected resize as a whole home layout', async () => {
    await click(editButton());
    api.patch.mockRejectedValueOnce(new Error('offline'));
    await key(handle(), 'ArrowDown');
    expect(tile('widget:recent').style.gridRow).toBe('1 / span 2');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('ignores another pointer and cancels on blur, geometry change or pointer cancellation', async () => {
    await click(editButton());
    act(() => { pointer(handle(), 'pointerdown', 300, 200); pointer(handle(), 'pointermove', 300, 432); pointer(handle(), 'pointerup', 300, 432, 2); });
    expect(container.querySelector('[data-home-placement]')).not.toBeNull();
    act(() => window.dispatchEvent(new Event('blur')));
    expect(container.querySelector('[data-home-placement]')).toBeNull();
    act(() => { pointer(handle(), 'pointerdown', 300, 200); pointer(handle(), 'pointermove', 300, 432); });
    resizeWindow(980);
    await act(async () => pointer(handle(), 'pointerup', 300, 432));
    act(() => { pointer(handle(), 'pointerdown', 300, 200); pointer(handle(), 'pointermove', 300, 432); pointer(handle(), 'pointercancel', 300, 432); });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('does not auto-scroll or save when only holding the resize handle', async () => {
    await click(editButton()); vi.useFakeTimers();
    act(() => { pointer(handle(), 'pointerdown', 500, 680); vi.advanceTimersByTime(240); });
    expect(container.scrollTop).toBe(0);
    await act(async () => pointer(handle(), 'pointerup', 500, 680));
    expect(api.patch).not.toHaveBeenCalled();
  });
});
