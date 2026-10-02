import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { resolveHomeSize } from '@/library/homeLayout';

// Size drafts stay local to the gesture. Only a completed gesture writes preferences.
export default function useHomeResize(gridRef, sizes, save) {
  const [columns, setColumns] = useState(8);
  const [draft, setDraft] = useState(null);
  const session = useRef(null);
  const rowHeight = columns === 4 ? 90 : 94, rowGap = columns === 4 ? 20 : 22;

  const finish = (commit = false, event) => {
    const current = session.current;
    if (!current || (event && event.pointerId !== current.pointerId)) return false;
    session.current = null;
    cancelAnimationFrame(current.frame);
    if (current.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    setDraft(null);
    if (commit) {
      // A narrow viewport is a display constraint, not a request to shrink the desktop layout.
      const next = { ...current.next, columns: current.next.columns === current.start.columns ? current.saved.columns : current.next.columns };
      if (next.columns !== current.saved.columns || next.rows !== current.saved.rows) save(current.id, next);
    }
    return true;
  };

  useLayoutEffect(() => {
    const container = gridRef.current?.closest('.Layout__Content') || gridRef.current?.parentElement;
    const measure = () => setColumns((container?.clientWidth || window.innerWidth) <= 760 ? 4 : 8);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (container) observer?.observe(container);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [gridRef]);
  useEffect(() => { finish(); }, [columns]); // Cancel if the grid changes during a gesture.
  useEffect(() => {
    const cancel = () => finish();
    window.addEventListener('blur', cancel);
    return () => { cancel(); window.removeEventListener('blur', cancel); };
  }, []);

  const preview = current => {
    const scrollDelta = (current.scroller?.scrollTop || 0) - current.scrollTop;
    const next = resolveHomeSize(current.id, { [current.id]: {
      columns: current.start.columns + Math.round((current.x - current.startX) / current.columnStep),
      rows: current.start.rows + Math.round((current.y - current.startY + scrollDelta) / current.rowStep),
    } }, columns);
    if (next.columns !== current.next.columns || next.rows !== current.next.rows) {
      current.next = next;
      setDraft({ id: current.id, ...next });
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
    if (event.button !== 0 || session.current) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus();
    const grid = gridRef.current, css = getComputedStyle(grid);
    const startSize = resolveHomeSize(id, sizes, columns);
    const scroller = grid.closest('.Layout__Content');
    session.current = {
      id, target: event.currentTarget, pointerId: event.pointerId,
      saved: resolveHomeSize(id, sizes), start: startSize, next: startSize,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      columnStep: (grid.getBoundingClientRect().width + (parseFloat(css.columnGap) || (columns === 4 ? 14 : 16))) / columns,
      rowStep: (parseFloat(css.gridAutoRows) || rowHeight) + (parseFloat(css.rowGap) || rowGap),
      scroller, scrollTop: scroller?.scrollTop || 0,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraft({ id, ...startSize });
  };
  const move = event => {
    const current = session.current;
    if (!current || event.pointerId !== current.pointerId) return;
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
    const saved = resolveHomeSize(id, sizes), visible = resolveHomeSize(id, sizes, columns);
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const next = resolveHomeSize(id, { [id]: {
      columns: horizontal ? visible.columns + (event.key === 'ArrowRight' ? 1 : -1) : saved.columns,
      rows: saved.rows + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0),
    } }, horizontal ? columns : 8);
    if (horizontal && next.columns === visible.columns) return;
    if (next.columns !== saved.columns || next.rows !== saved.rows) save(id, next);
  };
  return { columns, rowHeight, rowGap, draft, start, move, key, finish };
}
