// @vitest-environment jsdom
import { useRef, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useHomeLaunchTransition from './useHomeLaunchTransition';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root, router, animations;
function Surface() {
  const ref = useRef(null);
  useHomeLaunchTransition(ref, router);
  return <div ref={ref}><main>{router.asPath}</main><span data-source /></div>;
}
const request = () => {
  const event = new CustomEvent('home:launch', { cancelable: true, detail: { href: '/canvas', source: container.querySelector('[data-source]') } });
  window.dispatchEvent(event); return event;
};
beforeEach(() => {
  animations = [];
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 100, width: 68, height: 68 });
  Element.prototype.animate = vi.fn(function () { let finish; const finished = new Promise(resolve => { finish = resolve; }); const animation = { finished, cancel: vi.fn(), finish }; animations.push(animation); return animation; });
  window.matchMedia = vi.fn(() => ({ matches: false }));
  router = { pathname: '/', asPath: '/', push: vi.fn().mockResolvedValue(true) };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => root.render(<Surface />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); delete Element.prototype.animate; });

it('expands the actual app surface only for a home launch and cleans up afterward', async () => {
  await act(async () => { expect(request().defaultPrevented).toBe(true); });
  expect(router.push).toHaveBeenCalledTimes(1);
  router.pathname = '/canvas'; router.asPath = '/canvas';
  act(() => root.render(<Surface />));
  expect(document.querySelector('[data-home-transition-snapshot]')).not.toBeNull();
  expect(Element.prototype.animate).toHaveBeenCalledTimes(2);
  expect(Element.prototype.animate.mock.calls[0][1].duration).toBe(420);
  await act(async () => animations.forEach(animation => animation.finish()));
  expect(document.querySelector('[data-home-transition-snapshot]')).toBeNull();
  expect(container.firstChild.style.pointerEvents).toBe('');
  router.pathname = '/branch'; router.asPath = '/branch';
  act(() => root.render(<Surface />));
  expect(Element.prototype.animate).toHaveBeenCalledTimes(2);
});

it('leaves reduced-motion and app-to-app clicks to normal navigation', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  expect(request().defaultPrevented).toBe(false);
  window.matchMedia.mockReturnValue({ matches: false });
  router.pathname = '/branch'; router.asPath = '/branch';
  act(() => root.render(<Surface />));
  expect(request().defaultPrevented).toBe(false);
  expect(router.push).not.toHaveBeenCalled();
});

it('releases failed navigation so another launch can be attempted', async () => {
  router.push.mockRejectedValueOnce(new Error('route failed'));
  await act(async () => request());
  expect(document.querySelector('[data-home-transition-snapshot]')).toBeNull();
  await act(async () => request());
  expect(router.push).toHaveBeenCalledTimes(2);
});

it('cancels temporary animations on unmount', async () => {
  await act(async () => request());
  router.pathname = '/canvas'; router.asPath = '/canvas';
  act(() => root.render(<Surface />));
  act(() => root.unmount());
  expect(document.querySelector('[data-home-transition-snapshot]')).toBeNull();
  expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true);
  root = createRoot(container);
});
