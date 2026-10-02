import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// Only HomeView emits this request. Ordinary links, browser history and app-to-app
// navigation keep their existing behavior. Animate the real destination surface.
export default function useHomeLaunchTransition(surfaceRef, router) {
  const pending = useRef(null);
  const clear = useCallback(current => {
    if (!current || pending.current !== current) return;
    pending.current = null;
    clearTimeout(current.timeout);
    current.animations?.forEach(animation => animation.cancel());
    current.snapshot.remove();
    if (current.original) Object.assign(current.surface.style, current.original);
  }, []);

  useEffect(() => {
    const launch = event => {
      const { href, source } = event.detail || {};
      const surface = surfaceRef.current;
      if (router.pathname !== '/' || !surface?.contains(source) || typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !surface.animate) return;
      const origin = source.getBoundingClientRect();
      if (!origin.width || !origin.height) return;
      event.preventDefault();
      if (pending.current) return;
      const snapshot = surface.cloneNode(true);
      snapshot.setAttribute('data-home-transition-snapshot', '');
      snapshot.setAttribute('aria-hidden', 'true');
      snapshot.inert = true;
      snapshot.removeAttribute('id');
      snapshot.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      const current = { href, surface, snapshot, origin, scrollTop: surface.querySelector('main')?.scrollTop || 0 };
      pending.current = current;
      // A route that never settles must not prevent a later click from retrying.
      current.timeout = setTimeout(() => clear(current), 15000);
      Promise.resolve(router.push(href)).then(result => { if (!result) clear(current); }, () => clear(current));
    };
    window.addEventListener('home:launch', launch);
    return () => window.removeEventListener('home:launch', launch);
  }, [router, surfaceRef, clear]);

  useLayoutEffect(() => {
    const current = pending.current;
    if (!current || current.animations || router.asPath === '/') return;
    if (router.asPath !== current.href) { clear(current); return; }
    const { surface, snapshot, origin } = current;
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) { clear(current); return; }
    current.original = { position: surface.style.position, zIndex: surface.style.zIndex, pointerEvents: surface.style.pointerEvents, transformOrigin: surface.style.transformOrigin };
    Object.assign(snapshot.style, { position: 'fixed', left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, zIndex: '1000', pointerEvents: 'none', margin: '0' });
    document.body.append(snapshot);
    const main = snapshot.querySelector('main');
    if (main) main.scrollTop = current.scrollTop;
    Object.assign(surface.style, { position: 'relative', zIndex: '1001', pointerEvents: 'none', transformOrigin: '0 0' });
    const options = { duration: 420, easing: 'cubic-bezier(.19,1,.25,1)', fill: 'both' };
    try {
      current.animations = [
        surface.animate([
          { transform: `translate(${origin.left - bounds.left}px, ${origin.top - bounds.top}px) scale(${origin.width / bounds.width}, ${origin.height / bounds.height})`, opacity: .5, clipPath: 'inset(0 round 32px)' },
          { transform: 'translate(0, 0) scale(1)', opacity: 1, clipPath: 'inset(0 round 0px)' },
        ], options),
        snapshot.animate([{ transform: 'scale(1)', filter: 'blur(0)', opacity: 1 }, { transform: 'scale(.96)', filter: 'blur(3px)', opacity: .25 }], options),
      ];
      Promise.all(current.animations.map(animation => animation.finished)).then(() => clear(current), () => clear(current));
    } catch { clear(current); }
  }, [router.asPath, clear]);

  useEffect(() => () => clear(pending.current), [clear]);
}
