import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { GitBranch, FilePenLine, CalendarCheck, Workflow, CircleCheck, Star, Compass, History, ChartNoAxesCombined, MessageSquare, Plus, Minus, X, Check, MoveDiagonal2 } from 'lucide-react';
import NavLink from '@/components/common/NavLink';
import { useUiPrefs } from '@/library/UiPrefsContext';
import { useDateFormat } from '@/hooks/useDateFormat';
import { shouldInterceptNavClick } from '@/library/navLink';
import { HOME_ITEMS, resolveHomeLayout, resolveHomeSize, moveHomeItem } from '@/library/homeLayout';
import HomeWidgets from './HomeWidgets';
import useHomeResize from './useHomeResize';

const ICONS = { branch: GitBranch, canvas: FilePenLine, scrum: CalendarCheck, track: Workflow, tasks: CircleCheck, star: Star, browse: Compass, recent: History, sprints: ChartNoAxesCombined, messages: MessageSquare };
const labelFor = (item, t) => item.name || t(`home.canvas.${item.label}`);

function HomeItem({ id, editing, onRemove, onMove, register, size, resize }) {
  const { t } = useTranslation();
  const item = HOME_ITEMS[id], Icon = ICONS[item.icon], label = labelFor(item, t);
  const resizing = resize.draft?.id === id;
  const { setNodeRef, attributes, listeners, isDragging } = useSortable({ id, disabled: !editing || !!resize.draft });
  const ref = node => { setNodeRef(node); register(id, node); };
  return (
    <div ref={ref} data-home-item={id} className={`HomeCanvas__Item HomeCanvas__Item--${item.kind}${isDragging ? ' HomeCanvas__Item--dragging' : ''}${resizing ? ' HomeCanvas__Item--resizing' : ''}`}
      style={{ gridColumn: `span ${size.columns}`, gridRow: `span ${size.rows}` }}>
      <div className="HomeCanvas__TileContent" inert={editing}>
        {item.kind === 'app' ? (
          <NavLink href={item.href} className="HomeCanvas__App" aria-label={t('home.canvas.open', { name: label })}>
            <span className={`HomeCanvas__Icon HomeCanvas__Icon--${item.color}`} data-home-launch-origin><Icon size={32} strokeWidth={1.75} /></span>
            <span className="HomeCanvas__AppName">{label}</span>
          </NavLink>
        ) : <HomeWidgets id={id} height={size.rows * (resize.rowHeight + resize.rowGap) - resize.rowGap} />}
      </div>
      {editing && <>
        <button type="button" className="HomeCanvas__Move" {...attributes} {...listeners}
          aria-label={t('home.canvas.move', { name: label })} aria-describedby="home-move-help"
          onKeyDown={event => {
            if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
              event.preventDefault(); onMove(id, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
            } else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onRemove(id); }
          }} />
        <button type="button" className="HomeCanvas__Remove" data-home-remove
          aria-label={t('home.canvas.remove', { name: label })} onClick={() => onRemove(id)}><Minus size={15} /></button>
        {item.kind === 'widget' && <button type="button" className="HomeCanvas__Resize" data-home-resize
          aria-label={t('home.canvas.resize', { name: label, ...size })} aria-describedby="home-resize-help"
          onPointerDown={event => resize.start(id, event)} onPointerMove={resize.move}
          onPointerUp={event => { resize.move(event); resize.finish(true, event); }}
          onPointerCancel={event => resize.finish(false, event)} onLostPointerCapture={event => resize.finish(false, event)}
          onKeyDown={event => resize.key(id, event)}><MoveDiagonal2 size={18} /></button>}
        {resizing && <span className="HomeCanvas__Size" role="status">{size.columns} × {size.rows}</span>}
      </>}
    </div>
  );
}

export default function HomeView() {
  const { t } = useTranslation();
  const { formatTimestamp } = useDateFormat();
  const { prefs, loaded, loadStatus, setNamespaceChecked } = useUiPrefs();
  const ready = loaded && loadStatus === 'success';
  const order = ready ? resolveHomeLayout(prefs) : [];
  const [editing, setEditing] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [kind, setKind] = useState('widget');
  const [drag, setDrag] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [toolbarHost, setToolbarHost] = useState(null);
  const [now, setNow] = useState(null);
  const nodes = useRef(new Map()), hold = useRef(null), revision = useRef(0);
  const editRef = useRef(null), addRef = useRef(null), catalogRef = useRef(null);
  const gridRef = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    setToolbarHost(document.getElementById('home-controls'));
    setNow(new Date().toISOString());
    const clock = setInterval(() => setNow(new Date().toISOString()), 60000);
    return () => { clearInterval(clock); clearTimeout(hold.current?.timer); };
  }, []);
  useEffect(() => {
    const clear = () => { clearTimeout(hold.current?.timer); hold.current = null; };
    window.addEventListener('pointerup', clear); window.addEventListener('pointercancel', clear); window.addEventListener('blur', clear);
    return () => { clear(); window.removeEventListener('pointerup', clear); window.removeEventListener('pointercancel', clear); window.removeEventListener('blur', clear); };
  }, []);
  useEffect(() => { if (catalog) catalogRef.current?.querySelector('button')?.focus(); }, [catalog]);

  const update = async (next, namespace = 'home_layout') => {
    const current = ++revision.current;
    setSaving(true); setSaveError(false);
    try { await setNamespaceChecked(namespace, next); }
    catch { if (revision.current === current) setSaveError(true); }
    finally { if (revision.current === current) setSaving(false); }
  };
  const resize = useHomeResize(gridRef, prefs.home_sizes, (id, size) => update({ ...prefs.home_sizes, [id]: size }, 'home_sizes'));
  const closeCatalog = () => { setCatalog(false); requestAnimationFrame(() => addRef.current?.focus()); };
  const remove = id => { resize.finish(); update(order.filter(key => key !== id)); requestAnimationFrame(() => editRef.current?.focus()); };
  const move = (id, direction) => {
    const target = order[order.indexOf(id) + direction];
    if (target) update(moveHomeItem(order, id, target));
  };
  const clearHold = () => { clearTimeout(hold.current?.timer); hold.current = null; };
  const toolbar = <div className="HomeCanvas__Controls">
    {now && <span className="HomeCanvas__Date">{formatTimestamp(now, { month: 'long', day: 'numeric', weekday: 'long' })}</span>}
    {editing && <button ref={addRef} type="button" data-home-add className="HomeCanvas__Control" onClick={() => { resize.finish(); setCatalog(true); }}><Plus size={15} />{t('home.canvas.add')}</button>}
    <button ref={editRef} type="button" data-home-edit className={`HomeCanvas__Control${editing ? ' HomeCanvas__Control--done' : ''}`}
      disabled={!ready} aria-pressed={editing} onClick={() => { resize.finish(); setEditing(value => !value); }}>{t(editing ? 'home.canvas.done' : 'home.canvas.edit')}</button>
  </div>;

  return (
    <section className={`HomeCanvas${editing ? ' HomeCanvas--editing' : ''}`} aria-label={t('home.canvas.home')}
      onKeyDown={event => { if (event.key === 'Escape' && !catalog) { if (resize.finish()) return; clearHold(); setEditing(false); editRef.current?.focus(); } }}>
      {toolbarHost ? createPortal(toolbar, toolbarHost) : <div className="HomeCanvas__Toolbar">{toolbar}</div>}
      <div className="HomeCanvas__Status" role={saveError || loadStatus === 'error' ? 'alert' : 'status'}>
        {saveError ? t('home.canvas.saveFailed') : loadStatus === 'error' ? t('home.canvas.loadFailed') : !loaded ? t('common.state.loading') : saving ? t('home.canvas.saving') : ''}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={({ active }) => {
          clearHold();
          const node = nodes.current.get(active.id), content = node?.querySelector('.HomeCanvas__TileContent');
          if (content) setDrag({ id: active.id, html: content.innerHTML, width: node.offsetWidth, height: node.offsetHeight });
        }}
        onDragCancel={() => setDrag(null)}
        onDragEnd={({ active, over }) => { setDrag(null); if (over && active.id !== over.id) update(moveHomeItem(order, active.id, over.id)); }}>
        <SortableContext items={order} strategy={() => null}>
          <div ref={gridRef} className="HomeCanvas__Grid" inert={catalog} aria-busy={!loaded}
            onPointerDown={event => {
              if (editing || !loaded || loadStatus === 'error' || event.button !== 0 || !event.target.closest('[data-home-item]')) return;
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
              size={resize.draft?.id === id ? resize.draft : resolveHomeSize(id, prefs.home_sizes, resize.columns)} resize={resize}
              register={(key, node) => { if (node) nodes.current.set(key, node); else nodes.current.delete(key); }} />)}
            {ready && order.length === 0 && <div className="HomeCanvas__Empty"><p>{t('home.canvas.empty')}</p><button type="button" data-home-empty-add className="HomeCanvas__Control" onClick={() => { setEditing(true); setCatalog(true); }}>{t('home.canvas.addItems')}</button></div>}
          </div>
        </SortableContext>
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
            return <button key={id} type="button" data-catalog-add={id} className="HomeCanvas__CatalogItem" disabled={added} onClick={() => { update([...order, id]); closeCatalog(); }}>
              <span className="HomeCanvas__CatalogIcon"><Icon size={23} /></span><span>{labelFor(item, t)}<small>{added ? t('home.canvas.added') : item.kind === 'widget' ? t('home.canvas.widgetSize', { columns: item.columns, rows: item.rows }) : t('home.canvas.shortcut')}</small></span>{added ? <Check size={16} /> : <Plus size={16} />}
            </button>;
          })}</div>
          <p>{t('home.canvas.removeHint')}</p>
        </section>
      </div>}
    </section>
  );
}
