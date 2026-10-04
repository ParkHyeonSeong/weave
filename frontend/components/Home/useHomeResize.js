import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HOME_ITEMS, checkHomePlacement } from '@/library/homeLayout';

// A gesture owns only a preview. One successful release saves the whole layout.
export default function useHomeResize({ gridRef, geometry, visible, onCommit, onInvalid }) {
  const [draft, setDraft] = useState(null);
  const session = useRef(null);
  const latest = useRef(null);
  latest.current = { geometry, visible, onCommit, onInvalid };

  const finish = (commit = false, event) => {
    const current = session.current;
    if (!current || (event && event.pointerId !== current.pointerId)) return false;
    session.current = null;
    cancelAnimationFrame(current.frame);
    if (current.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    setDraft(null);
    if (commit && current.geometry.key === latest.current.geometry.key) {
      const reason = checkHomePlacement(latest.current.visible, current.id, current.next);
      if (reason === 'ok') latest.current.onCommit(current.id, current.next);
      else latest.current.onInvalid(reason);
    }
    return true;
  };

  useLayoutEffect(() => { finish(); }, [geometry.key]);
  useEffect(() => {
    const cancel = () => finish();
    window.addEventListener('blur', cancel);
    return () => { cancel(); window.removeEventListener('blur', cancel); };
  }, []);

  const preview = current => {
    const minimum = HOME_ITEMS[current.id];
    const { columnStep, rowStep, columns } = current.geometry;
    const scrollDelta = (current.scroller?.scrollTop || 0) - current.scrollTop;
    const rect = {
      ...current.start,
      w: Math.min(columns - current.start.x, Math.max(minimum.columns,
        current.start.w + Math.round((current.x - current.startX) / columnStep))),
      h: Math.max(minimum.rows, current.start.h + Math.round((current.y - current.startY + scrollDelta) / rowStep)),
    };
    if (rect.w !== current.next.w || rect.h !== current.next.h) {
      current.next = rect;
      setDraft({ id: current.id, rect, reason: checkHomePlacement(current.visible, current.id, rect) });
    }
  };

  const autoScroll = () => {
    const current = session.current;
    if (!current) return;
    const scroller = current.scroller;
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      const distance = current.y > bounds.bottom - 56 ? current.y - (bounds.bottom - 56)
        : current.y < bounds.top + 56 ? current.y - (bounds.top + 56) : 0;
      if (distance) { scroller.scrollTop += Math.max(-16, Math.min(16, distance / 4)); preview(current); }
    }
    current.frame = requestAnimationFrame(autoScroll);
  };

  const start = (id, event) => {
    const { geometry: measured, visible: base } = latest.current;
    if (event.button !== 0 || session.current || !measured.ready || !base?.placements[id]) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
    const rect = base.placements[id], scroller = gridRef.current?.closest('.Layout__Content');
    session.current = {
      id, target: event.currentTarget, pointerId: event.pointerId,
      geometry: measured, visible: base, start: rect, next: rect,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      scroller, scrollTop: scroller?.scrollTop || 0,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraft({ id, rect, reason: 'ok' });
  };

  const move = event => {
    const current = session.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (current.geometry.key !== latest.current.geometry.key) { finish(); return; }
    event.preventDefault(); event.stopPropagation();
    current.x = event.clientX; current.y = event.clientY;
    if (!current.moved && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
      current.moved = true;
      current.frame = requestAnimationFrame(autoScroll);
    }
    preview(current);
  };

  const key = (id, event) => {
    if (event.key === 'Escape' && finish()) { event.preventDefault(); event.stopPropagation(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || session.current) return;
    event.preventDefault(); event.stopPropagation();
    const { geometry: measured, visible: base } = latest.current;
    const rect = base?.placements[id];
    if (!measured.ready || !rect) return;
    const item = HOME_ITEMS[id];
    const next = {
      ...rect,
      w: Math.min(base.columns - rect.x, Math.max(item.columns,
        rect.w + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0))),
      h: Math.max(item.rows, rect.h + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)),
    };
    const reason = checkHomePlacement(base, id, next);
    if (reason === 'ok') latest.current.onCommit(id, next);
    else latest.current.onInvalid(reason);
  };
  return { draft, start, move, key, finish };
}
