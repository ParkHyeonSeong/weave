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
