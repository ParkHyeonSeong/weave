import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { DndContext, DragOverlay, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import { GitBranch, FilePenLine, CalendarCheck, Workflow, CircleCheck, Star, Compass, History, ChartNoAxesCombined, MessageSquare, Plus, Minus, X, Check, MoveDiagonal2 } from 'lucide-react';
import NavLink from '@/components/common/NavLink';
import { useUiPrefs } from '@/library/UiPrefsContext';
import { useDateFormat } from '@/hooks/useDateFormat';
import { shouldInterceptNavClick } from '@/library/navLink';
import { HOME_ITEMS, resolveHomeCanvas, projectHomeBase, checkHomePlacement, applyHomePlacement, addHomeItem, removeHomeItem } from '@/library/homeLayout';
import HomeWidgets from './HomeWidgets';
import useHomeResize from './useHomeResize';
import useHomeGrid from './useHomeGrid';
import HomePointerSensor from './HomePointerSensor';

const ICONS = { branch: GitBranch, canvas: FilePenLine, scrum: CalendarCheck, track: Workflow, tasks: CircleCheck, star: Star, browse: Compass, recent: History, sprints: ChartNoAxesCombined, messages: MessageSquare };
const labelFor = (item, t) => item.name || t(`home.canvas.${item.label}`);

function HomeItem({ id, editing, onRemove, onMove, register, rect, resize, dragId }) {
  const { t } = useTranslation();
  const item = HOME_ITEMS[id], Icon = ICONS[item.icon], label = labelFor(item, t);
  const resizing = resize.draft?.id === id;
  const { setNodeRef, attributes, listeners } = useDraggable({ id, disabled: !editing || !!resize.draft });
  const size = resize.draft?.id === id ? resize.draft.rect : rect;
  const ref = node => { setNodeRef(node); register(id, node); };
  return (
    <div ref={ref} data-home-item={id} className={`HomeCanvas__Item HomeCanvas__Item--${item.kind}${dragId === id ? ' HomeCanvas__Item--dragging' : ''}${resizing ? ' HomeCanvas__Item--resizing' : ''}`}
      style={{ gridColumn: `${rect.x + 1} / span ${rect.w}`, gridRow: `${rect.y + 1} / span ${rect.h}` }}>
      <div className="HomeCanvas__TileContent" inert={editing}>
        {item.kind === 'app' ? (
          <NavLink href={item.href} className="HomeCanvas__App" aria-label={t('home.canvas.open', { name: label })}>
            <span className={`HomeCanvas__Icon HomeCanvas__Icon--${item.color}`} data-home-launch-origin><Icon size={32} strokeWidth={1.75} /></span>
            <span className="HomeCanvas__AppName">{label}</span>
          </NavLink>
        ) : <HomeWidgets id={id} />}
      </div>
      {editing && <>
        <button type="button" className="HomeCanvas__Move" {...attributes} {...listeners}
          aria-label={t('home.canvas.move', { name: label })} aria-describedby="home-move-help"
          onKeyDown={event => {
            if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
              event.preventDefault(); onMove(id, event.key);
            } else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onRemove(id); }
          }} />
        <button type="button" className="HomeCanvas__Remove" data-home-remove
          aria-label={t('home.canvas.remove', { name: label })} onClick={() => onRemove(id)}><Minus size={15} /></button>
        {item.kind === 'widget' && <button type="button" className="HomeCanvas__Resize" data-home-resize
          aria-label={t('home.canvas.resize', { name: label, columns: size.w, rows: size.h })} aria-describedby="home-resize-help"
          onPointerDown={event => resize.start(id, event)} onPointerMove={resize.move}
          onPointerUp={event => { resize.move(event); resize.finish(true, event); }}
          onPointerCancel={event => resize.finish(false, event)} onLostPointerCapture={event => resize.finish(false, event)}
          onKeyDown={event => resize.key(id, event)}><MoveDiagonal2 size={18} /></button>}
        {resizing && <span className="HomeCanvas__Size" role="status">{size.w} × {size.h}</span>}
      </>}
    </div>
  );
}

export default function HomeView() {
  const { t } = useTranslation();
  const { formatTimestamp } = useDateFormat();
  const { prefs, loaded, loadStatus, setNamespaceChecked } = useUiPrefs();
  const resolved = useMemo(() => loaded && loadStatus === 'success' ? resolveHomeCanvas(prefs) : null, [prefs, loaded, loadStatus]);
  const canvas = resolved?.canvas;
  const invalid = loadStatus === 'error' || resolved?.status === 'invalid';
  const [editing, setEditing] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [kind, setKind] = useState('widget');
  const [drag, setDrag] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [notice, setNotice] = useState('');
  const [toolbarHost, setToolbarHost] = useState(null);
  const [now, setNow] = useState(null);
  const nodes = useRef(new Map()), hold = useRef(null), revision = useRef(0);
  const editRef = useRef(null), addRef = useRef(null), catalogRef = useRef(null);
  const gridRef = useRef(null), dragSession = useRef(null);
  const geometry = useHomeGrid(gridRef);
  const ready = !!canvas && geometry.ready;
  const visible = useMemo(() => canvas ? projectHomeBase(canvas.layouts[geometry.mode], canvas.items, geometry.columns) : null, [canvas, geometry.mode, geometry.columns]);
  // Tab order follows the visual rows without changing saved item membership.
  const order = useMemo(() => canvas ? [...canvas.items].sort((a, b) => {
    const first = visible.placements[a], second = visible.placements[b];
    return first.y - second.y || first.x - second.x;
  }) : [], [canvas, visible]);
  const clearHold = useCallback(() => { clearTimeout(hold.current?.timer); hold.current = null; }, []);
  const cancelDrag = useCallback(() => {
    const active = !!dragSession.current;
    dragSession.current = null; setDrag(null);
    return active;
  }, []);
  const sensors = useSensors(useSensor(HomePointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    setToolbarHost(document.getElementById('home-controls'));
    setNow(new Date().toISOString());
    const clock = setInterval(() => setNow(new Date().toISOString()), 60000);
    return () => { clearInterval(clock); clearTimeout(hold.current?.timer); };
  }, []);
  useEffect(() => {
    const cancel = () => { clearHold(); cancelDrag(); };
    window.addEventListener('pointerup', clearHold); window.addEventListener('pointercancel', clearHold); window.addEventListener('blur', cancel);
    return () => { clearHold(); window.removeEventListener('pointerup', clearHold); window.removeEventListener('pointercancel', clearHold); window.removeEventListener('blur', cancel); };
  }, [clearHold, cancelDrag]);
  useLayoutEffect(() => { clearHold(); cancelDrag(); }, [geometry.key, clearHold, cancelDrag]);
  useEffect(() => { if (catalog) catalogRef.current?.querySelector('button')?.focus(); }, [catalog]);

  const update = async next => {
    if (!ready || next === canvas) return;
    const current = ++revision.current;
    setSaving(true); setSaveError(false); setNotice('');
    try { await setNamespaceChecked('home_canvas', next); }
    catch { if (revision.current === current) setSaveError(true); }
    finally { if (revision.current === current) setSaving(false); }
  };
  const onInvalid = reason => setNotice(t(`home.canvas.${reason === 'occupied' ? 'occupied' : 'outside'}`));
  const commitPlacement = (id, rect) => {
    if (!ready) return;
    const reason = checkHomePlacement(visible, id, rect);
    if (reason !== 'ok') { onInvalid(reason); return; }
    update(applyHomePlacement(canvas, geometry.mode, visible, id, rect));
  };
  const resize = useHomeResize({ gridRef, geometry, visible, onCommit: commitPlacement, onInvalid });
  const cancelGesture = () => { resize.finish(); cancelDrag(); clearHold(); };
  const closeCatalog = () => { setCatalog(false); requestAnimationFrame(() => addRef.current?.focus()); };
  const remove = id => { cancelGesture(); update(removeHomeItem(canvas, geometry.mode, visible, id)); requestAnimationFrame(() => editRef.current?.focus()); };
  const move = (id, key) => {
    if (dragSession.current || resize.draft) return;
    const rect = visible.placements[id];
    commitPlacement(id, { ...rect, x: rect.x + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0),
      y: rect.y + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0) });
  };
  const dragCandidate = delta => {
    const session = dragSession.current;
    if (!session || session.geometry.key !== geometry.key) return null;
    // dnd-kit already includes scroll displacement in delta.
    const rect = { ...session.start, x: session.start.x + Math.round(delta.x / session.geometry.columnStep),
      y: session.start.y + Math.round(delta.y / session.geometry.rowStep) };
    return { id: session.id, rect, reason: checkHomePlacement(visible, session.id, rect) };
  };
  const candidate = resize.draft || drag?.candidate;
  const placementNotice = candidate && candidate.reason !== 'ok'
    ? t(`home.canvas.${candidate.reason === 'occupied' ? 'occupied' : 'outside'}`) : '';
  const bottom = Math.max(0, ...Object.values(visible?.placements || {}).map(rect => rect.y + rect.h));
  const rows = editing ? Math.max(bottom, candidate ? candidate.rect.y + candidate.rect.h : 0) + Math.max(2, candidate?.rect.h || 0) : bottom;
  const toolbar = <div className="HomeCanvas__Controls">
    {now && <span className="HomeCanvas__Date">{formatTimestamp(now, { month: 'long', day: 'numeric', weekday: 'long' })}</span>}
    {editing && <button ref={addRef} type="button" data-home-add className="HomeCanvas__Control" onClick={() => { cancelGesture(); setCatalog(true); }}><Plus size={15} />{t('home.canvas.add')}</button>}
    <button ref={editRef} type="button" data-home-edit className={`HomeCanvas__Control${editing ? ' HomeCanvas__Control--done' : ''}`}
      disabled={!ready} aria-pressed={editing} onClick={() => { cancelGesture(); setNotice(''); setEditing(value => !value); }}>{t(editing ? 'home.canvas.done' : 'home.canvas.edit')}</button>
  </div>;

  return (
    <section className={`HomeCanvas${editing ? ' HomeCanvas--editing' : ''}`} aria-label={t('home.canvas.home')}
      onKeyDownCapture={event => { if (event.key === 'Escape' && !catalog) { if (resize.finish() || cancelDrag()) return; clearHold(); setEditing(false); editRef.current?.focus(); } }}>
      {toolbarHost ? createPortal(toolbar, toolbarHost) : <div className="HomeCanvas__Toolbar">{toolbar}</div>}
      <div className="HomeCanvas__Status" role={saveError || invalid ? 'alert' : 'status'}>
        {candidate ? placementNotice : saveError ? t('home.canvas.saveFailed') : invalid ? t('home.canvas.loadFailed') : !loaded ? t('common.state.loading') : saving ? t('home.canvas.saving') : notice}
      </div>
      <DndContext sensors={sensors} autoScroll={!!drag}
        onDragStart={({ active }) => {
          clearHold(); setNotice('');
          if (!ready || !editing || resize.draft || !visible.placements[active.id]) return;
          const node = nodes.current.get(active.id), content = node?.querySelector('.HomeCanvas__TileContent');
          if (!content) return;
          dragSession.current = { id: active.id, geometry, start: visible.placements[active.id] };
          setDrag({ id: active.id, html: content.innerHTML, width: node.offsetWidth, height: node.offsetHeight,
            candidate: { id: active.id, rect: visible.placements[active.id], reason: 'ok' } });
        }}
        onDragMove={({ delta }) => {
          const next = dragCandidate(delta);
          if (next) setDrag(previous => previous ? { ...previous, candidate: next } : null);
        }}
        onDragCancel={cancelDrag}
        onDragEnd={({ delta }) => {
          const next = dragCandidate(delta);
          cancelDrag();
          if (next) commitPlacement(next.id, next.rect);
        }}>
          <div ref={gridRef} className="HomeCanvas__Grid" inert={catalog} aria-busy={!loaded}
            style={{ '--home-columns': geometry.columns, '--home-column-step': `${geometry.columnStep}px`,
              '--home-row-step': `${geometry.rowStep}px`, minHeight: Math.max(0, rows * geometry.rowStep - geometry.rowGap) }}
            onScrollCapture={clearHold}
            onPointerDown={event => {
              if (editing || !ready || event.button !== 0 || !event.target.closest('[data-home-item]')) return;
              clearHold();
              hold.current = { x: event.clientX, y: event.clientY, timer: setTimeout(() => { hold.current = null; setEditing(true); }, 500) };
            }}
            onPointerMove={event => { if (hold.current && Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y) > 9) clearHold(); }}
            onPointerLeave={clearHold}
            onContextMenu={event => { if (event.target.closest('[data-home-item]')) event.preventDefault(); }}
            onClickCapture={event => {
              if (editing && !event.target.closest('button[data-home-remove], [data-home-resize], .HomeCanvas__Move, [data-home-empty-add]')) { event.preventDefault(); event.stopPropagation(); return; }
              const anchor = event.target.closest('a[href]');
              if (!anchor || !shouldInterceptNavClick(event)) return;
              const tile = anchor.closest('[data-home-item]');
              const request = new CustomEvent('home:launch', { cancelable: true, detail: { href: anchor.getAttribute('href'), source: tile?.querySelector('[data-home-launch-origin]') || tile } });
              if (!window.dispatchEvent(request)) event.preventDefault();
            }}>
            {order.map(id => <HomeItem key={id} id={id} editing={editing} onRemove={remove} onMove={move}
              rect={visible.placements[id]} resize={resize} dragId={drag?.id}
              register={(key, node) => { if (node) nodes.current.set(key, node); else nodes.current.delete(key); }} />)}
            {candidate && <div className="HomeCanvas__PlacementLayer" aria-hidden="true"><div data-home-placement data-valid={candidate.reason === 'ok'} className="HomeCanvas__Placement"
              style={{ left: candidate.rect.x * geometry.columnStep, top: candidate.rect.y * geometry.rowStep,
                width: candidate.rect.w * geometry.columnStep - geometry.columnGap, height: candidate.rect.h * geometry.rowStep - geometry.rowGap }} /></div>}
            {ready && order.length === 0 && <div className="HomeCanvas__Empty"><p>{t('home.canvas.empty')}</p><button type="button" data-home-empty-add className="HomeCanvas__Control" onClick={() => { setEditing(true); setCatalog(true); }}>{t('home.canvas.addItems')}</button></div>}
          </div>
        <DragOverlay dropAnimation={null}>{drag && <div className="HomeCanvas__DragPreview" style={{ width: drag.width, height: drag.height }} aria-hidden="true" inert dangerouslySetInnerHTML={{ __html: drag.html }} />}</DragOverlay>
      </DndContext>
      <footer className="HomeCanvas__Footer"><span />{t(editing ? 'home.canvas.editHint' : 'home.canvas.home')}</footer>
      <span id="home-move-help" className="HomeCanvas__SrOnly">{t('home.canvas.keyboardHint')}</span>
      <span id="home-resize-help" className="HomeCanvas__SrOnly">{t('home.canvas.resizeHint')}</span>
      {catalog && <div className="HomeCanvas__Backdrop" onClick={event => { if (event.target === event.currentTarget) closeCatalog(); }}>
        <section ref={catalogRef} className="HomeCanvas__Catalog" role="dialog" aria-modal="true" aria-labelledby="home-catalog-title"
          onKeyDown={event => {
            if (event.key === 'Escape') { event.stopPropagation(); closeCatalog(); }
            if (event.key === 'Tab') {
              const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')], first = buttons[0], last = buttons[buttons.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
          }}>
          <header><h2 id="home-catalog-title">{t('home.canvas.addToHome')}</h2><button type="button" className="HomeCanvas__Close" aria-label={t('common.actions.close')} onClick={closeCatalog}><X size={18} /></button></header>
          <div className="HomeCanvas__CatalogTabs">{['app', 'widget'].map(value => <button key={value} type="button" data-catalog-kind={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{t(`home.canvas.${value}s`)}</button>)}</div>
          <div className="HomeCanvas__CatalogList">{Object.entries(HOME_ITEMS).filter(([, item]) => item.kind === kind).map(([id, item]) => {
            const Icon = ICONS[item.icon], added = order.includes(id);
            return <button key={id} type="button" data-catalog-add={id} className="HomeCanvas__CatalogItem" disabled={added} onClick={() => { update(addHomeItem(canvas, geometry.mode, visible, id)); closeCatalog(); }}>
              <span className="HomeCanvas__CatalogIcon"><Icon size={23} /></span><span>{labelFor(item, t)}<small>{added ? t('home.canvas.added') : item.kind === 'widget' ? t('home.canvas.widgetSize', { columns: item.columns, rows: item.rows }) : t('home.canvas.shortcut')}</small></span>{added ? <Check size={16} /> : <Plus size={16} />}
            </button>;
          })}</div>
          <p>{t('home.canvas.removeHint')}</p>
        </section>
      </div>}
    </section>
  );
}
