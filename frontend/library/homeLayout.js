export const HOME_ITEMS = {
  'app:branch': { kind: 'app', name: 'Branch', icon: 'branch', href: '/branch', color: 'indigo', columns: 1, rows: 1 },
  'app:canvas': { kind: 'app', name: 'Canvas', icon: 'canvas', href: '/canvas', color: 'green', columns: 1, rows: 1 },
  'app:scrum': { kind: 'app', name: 'Scrum', icon: 'scrum', href: '/scrum', color: 'green', columns: 1, rows: 1 },
  'app:track': { kind: 'app', name: 'Track', icon: 'track', href: '/tracks', color: 'indigo', columns: 1, rows: 1 },
  'app:mytasks': { kind: 'app', label: 'myTasks', icon: 'tasks', href: '/my-tasks', color: 'blue', columns: 1, rows: 1 },
  'app:starred': { kind: 'app', label: 'favorites', icon: 'star', href: '/canvas?homeTab=starred', color: 'amber', columns: 1, rows: 1 },
  'app:browse': { kind: 'app', label: 'browse', icon: 'browse', href: '/browse', color: 'amber', columns: 1, rows: 1 },
  'widget:scrum': { kind: 'widget', label: 'todayScrum', icon: 'scrum', columns: 2, rows: 2 },
  'widget:mytasks': { kind: 'widget', label: 'myTasks', icon: 'tasks', columns: 4, rows: 2 },
  'widget:recent': { kind: 'widget', label: 'continue', icon: 'recent', columns: 4, rows: 2 },
  'widget:starred': { kind: 'widget', label: 'favoriteItems', icon: 'star', columns: 4, rows: 2 },
  'widget:sprints': { kind: 'widget', label: 'activeSprints', icon: 'sprints', columns: 2, rows: 2 },
  'widget:messages': { kind: 'widget', label: 'messages', icon: 'messages', columns: 2, rows: 2 },
};

const DEFAULT_LAYOUT = [
  'widget:scrum', 'widget:mytasks', 'app:branch', 'app:canvas', 'app:scrum', 'app:track',
  'widget:recent', 'app:mytasks', 'app:starred', 'widget:sprints',
];
const LEGACY_APPS = ['scrum', 'track', 'branch', 'canvas'];
const LEGACY_WIDGETS = ['mytasks', 'recent', 'starred'];
const uniqueKnown = items => [...new Set(items.filter(id => typeof id === 'string' && Object.hasOwn(HOME_ITEMS, id)))];

export function resolveHomeLayout(prefs = {}) {
  // An empty saved array is intentional. Never re-add things the person removed.
  if (Array.isArray(prefs.home_layout)) return uniqueKnown(prefs.home_layout);
  if (!Array.isArray(prefs.launchpad_order) && !Array.isArray(prefs.widget_layout)) return [...DEFAULT_LAYOUT];
  const apps = [...new Set([...(Array.isArray(prefs.launchpad_order) ? prefs.launchpad_order : []).filter(key => LEGACY_APPS.includes(key)), ...LEGACY_APPS])];
  const widgets = uniqueKnown((Array.isArray(prefs.widget_layout) ? prefs.widget_layout : LEGACY_WIDGETS).map(key => `widget:${key}`));
  return uniqueKnown(['widget:scrum', ...widgets.slice(0, 1), ...apps.map(key => `app:${key}`), ...widgets.slice(1), 'app:mytasks', 'app:starred']);
}

export function moveHomeItem(items, active, over) {
  const from = items.indexOf(active), to = items.indexOf(over);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items];
  next.splice(from, 1);
  next.splice(to, 0, active);
  return next;
}

export function resolveHomeSize(id, sizes = {}, columnCount = 8) {
  const item = HOME_ITEMS[id];
  if (!item || item.kind === 'app') return { columns: 1, rows: 1 };
  const saved = sizes?.[id];
  const columns = Number.isSafeInteger(saved?.columns) ? saved.columns : item.columns;
  const rows = Number.isSafeInteger(saved?.rows) ? saved.rows : item.rows;
  return {
    columns: Math.min(columnCount, Math.max(item.columns, Math.min(8, columns))),
    rows: Math.max(item.rows, rows),
  };
}

const HOME_MODES = ['wide', 'compact'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const safeInteger = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x
  && a.y < b.y + b.h && a.y + a.h > b.y;
const sameRect = (a, b) => a && b && ['x', 'y', 'w', 'h'].every(key => a[key] === b[key]);

function validRect(id, rect) {
  if (!Object.hasOwn(HOME_ITEMS, id) || !exactKeys(rect, ['x', 'y', 'w', 'h'])) return false;
  if (!safeInteger(rect.x, 0) || !safeInteger(rect.y, 0) || !safeInteger(rect.w, 1) || !safeInteger(rect.h, 1)
    || !Number.isSafeInteger(rect.x + rect.w) || !Number.isSafeInteger(rect.y + rect.h)) return false;
  const item = HOME_ITEMS[id];
  return item.kind === 'app' ? rect.w === 1 && rect.h === 1 : rect.w >= item.columns && rect.h >= item.rows;
}

export function getHomeGridMetrics(contentWidth, gridWidth) {
  const mode = contentWidth <= 760 ? 'compact' : 'wide';
  const columnGap = mode === 'compact' ? 14 : 16;
  const rowHeight = mode === 'compact' ? 90 : 94;
  const rowGap = mode === 'compact' ? 20 : 22;
  const columns = Math.max(4, Math.ceil((gridWidth + columnGap) / 116));
  return { mode, columns, rowHeight, rowGap, columnGap,
    columnStep: (gridWidth + columnGap) / columns, rowStep: rowHeight + rowGap };
}

export function checkHomePlacement(base, id, rect) {
  if (!safeInteger(base?.columns, 4) || !validRect(id, rect) || rect.x + rect.w > base.columns) return 'bounds';
  return Object.entries(base.placements).some(([otherId, other]) => otherId !== id && overlaps(rect, other)) ? 'occupied' : 'ok';
}

export function validateHomeCanvas(value) {
  if (!exactKeys(value, ['version', 'items', 'layouts']) || value.version !== 1 || !Array.isArray(value.items)
    || value.items.some(id => typeof id !== 'string' || !Object.hasOwn(HOME_ITEMS, id))
    || new Set(value.items).size !== value.items.length || !exactKeys(value.layouts, HOME_MODES)) return false;
  return HOME_MODES.every(mode => {
    const base = value.layouts[mode];
    return exactKeys(base, ['columns', 'placements']) && safeInteger(base.columns, 4)
      && exactKeys(base.placements, value.items)
      && value.items.every(id => validRect(id, base.placements[id]))
      && value.items.every(id => checkHomePlacement(base, id, base.placements[id]) === 'ok');
  });
}

// A first free rectangle starts at a row boundary or an obstacle's bottom,
// and at the left edge or an obstacle's right edge. Never allocate by height.
function firstFit(placements, columns, w, h, startY = 0, startX = 0, sparse = false) {
  const obstacles = Object.values(placements);
  const rows = [...new Set([startY, ...(sparse ? [startY + 1] : []),
    ...obstacles.map(rect => rect.y + rect.h).filter(y => y >= startY)])].sort((a, b) => a - b);
  for (const y of rows) {
    const left = y === startY ? startX : 0;
    const xs = [...new Set([left, ...obstacles.map(rect => rect.x + rect.w).filter(x => x >= left)])].sort((a, b) => a - b);
    for (const x of xs) {
      const rect = { x, y, w, h };
      if (x + w <= columns && Number.isSafeInteger(x + w) && Number.isSafeInteger(y + h)
        && !obstacles.some(other => overlaps(rect, other))) return rect;
    }
  }
  throw new RangeError('Home placement exceeds safe integer coordinates');
}

function migrateHomeBase(items, sizes, columns) {
  const placements = {};
  let x = 0, y = 0;
  for (const id of items) {
    const size = resolveHomeSize(id, sizes, columns);
    const rect = firstFit(placements, columns, size.columns, size.rows, y, x, true);
    placements[id] = rect;
    x = rect.x; y = rect.y;
  }
  return { columns, placements };
}

export function resolveHomeCanvas(prefs = {}) {
  if (Object.hasOwn(prefs, 'home_canvas')) {
    return validateHomeCanvas(prefs.home_canvas) ? { status: 'ready', canvas: prefs.home_canvas } : { status: 'invalid' };
  }
  const items = resolveHomeLayout(prefs);
  try {
    const canvas = { version: 1, items, layouts: {
      wide: migrateHomeBase(items, prefs.home_sizes, 8),
      compact: migrateHomeBase(items, prefs.home_sizes, 4),
    } };
    return validateHomeCanvas(canvas) ? { status: 'ready', canvas } : { status: 'invalid' };
  } catch { return { status: 'invalid' }; }
}

export function projectHomeBase(base, items, columns) {
  const placements = {}, overflow = [];
  let startY = 0;
  for (const [index, id] of items.entries()) {
    const rect = base.placements[id];
    if (rect.x + rect.w <= columns) {
      placements[id] = { ...rect };
      startY = Math.max(startY, rect.y + rect.h);
    } else overflow.push({ id, rect, index });
  }
  overflow.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.index - b.index);
  for (const { id, rect } of overflow) {
    placements[id] = firstFit(placements, columns, Math.min(rect.w, columns), rect.h, startY);
  }
  return { columns, placements };
}

export function applyHomePlacement(canvas, mode, visible, id, rect) {
  if (!HOME_MODES.includes(mode) || !canvas.items.includes(id) || checkHomePlacement(visible, id, rect) !== 'ok'
    || sameRect(visible.placements[id], rect)) return canvas;
  return { ...canvas, layouts: { ...canvas.layouts, [mode]: {
    columns: visible.columns, placements: { ...visible.placements, [id]: { ...rect } },
  } } };
}

export function addHomeItem(canvas, mode, visible, id) {
  if (!HOME_MODES.includes(mode) || !Object.hasOwn(HOME_ITEMS, id) || canvas.items.includes(id)) return canvas;
  const item = HOME_ITEMS[id], layouts = { ...canvas.layouts };
  for (const key of HOME_MODES) {
    const base = key === mode ? visible : canvas.layouts[key];
    const rect = firstFit(base.placements, base.columns, item.columns, item.rows);
    layouts[key] = { columns: base.columns, placements: { ...base.placements, [id]: rect } };
  }
  return { ...canvas, items: [...canvas.items, id], layouts };
}

export function removeHomeItem(canvas, mode, visible, id) {
  if (!HOME_MODES.includes(mode) || !canvas.items.includes(id)) return canvas;
  const layouts = { ...canvas.layouts };
  for (const key of HOME_MODES) {
    const base = key === mode ? visible : canvas.layouts[key];
    const placements = { ...base.placements };
    delete placements[id];
    layouts[key] = { columns: base.columns, placements };
  }
  return { ...canvas, items: canvas.items.filter(itemId => itemId !== id), layouts };
}
