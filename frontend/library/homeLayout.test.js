import { describe, expect, it } from 'vitest';
import { resolveHomeLayout, moveHomeItem, resolveHomeSize, getHomeGridMetrics, validateHomeCanvas, resolveHomeCanvas, projectHomeBase, checkHomePlacement, applyHomePlacement, addHomeItem, removeHomeItem } from './homeLayout';

describe('personal home layout', () => {
  it('restores an intentionally empty home without adding removed apps back', () => {
    expect(resolveHomeLayout({ home_layout: [] })).toEqual([]);
  });

  it('keeps saved mixed order and discards duplicates and unavailable items', () => {
    expect(resolveHomeLayout({ home_layout: ['app:canvas', 'widget:recent', 'removed', 'app:canvas', null] }))
      .toEqual(['app:canvas', 'widget:recent']);
  });

  it('migrates legacy app order and keeps hidden widgets hidden', () => {
    const result = resolveHomeLayout({ launchpad_order: ['canvas', 'branch'], widget_layout: ['starred'] });
    expect(result.filter(id => id.startsWith('app:')).slice(0, 4))
      .toEqual(['app:canvas', 'app:branch', 'app:scrum', 'app:track']);
    expect(result.filter(id => id.startsWith('widget:'))).toEqual(['widget:scrum', 'widget:starred']);
  });

  it('does not repopulate legacy widgets when all were removed', () => {
    expect(resolveHomeLayout({ widget_layout: [] }).filter(id => id.startsWith('widget:')))
      .toEqual(['widget:scrum']);
  });

  it('moves an app across a widget without losing either item', () => {
    expect(moveHomeItem(['app:branch', 'widget:recent', 'app:canvas'], 'app:branch', 'app:canvas'))
      .toEqual(['widget:recent', 'app:canvas', 'app:branch']);
    expect(moveHomeItem(['app:branch'], 'app:branch', 'missing')).toEqual(['app:branch']);
  });
});

const canvasFixture = () => ({
  version: 1, items: ['app:branch', 'widget:recent'],
  layouts: {
    wide: { columns: 8, placements: {
      'app:branch': { x: 0, y: 0, w: 1, h: 1 },
      'widget:recent': { x: 2, y: 0, w: 4, h: 2 },
    } },
    compact: { columns: 4, placements: {
      'app:branch': { x: 0, y: 0, w: 1, h: 1 },
      'widget:recent': { x: 0, y: 1, w: 4, h: 2 },
    } },
  },
});

describe('home canvas coordinates', () => {
  it('moves just one item and preserves the other mode and source', () => {
    const canvas = canvasFixture(), before = structuredClone(canvas);
    const next = applyHomePlacement(canvas, 'wide', canvas.layouts.wide, 'app:branch', { x: 7, y: 3, w: 1, h: 1 });
    expect(next.layouts.wide.placements['app:branch']).toEqual({ x: 7, y: 3, w: 1, h: 1 });
    expect(next.layouts.wide.placements['widget:recent']).toEqual({ x: 2, y: 0, w: 4, h: 2 });
    expect(next.layouts.compact).toBe(canvas.layouts.compact);
    expect(canvas).toEqual(before);
    expect(validateHomeCanvas(next)).toBe(true);
  });

  it('rejects overlap, out-of-bounds and unchanged placements without a save', () => {
    const canvas = canvasFixture(), base = canvas.layouts.wide;
    expect(checkHomePlacement(base, 'app:branch', { x: 3, y: 0, w: 1, h: 1 })).toBe('occupied');
    expect(checkHomePlacement(base, 'app:branch', { x: 8, y: 0, w: 1, h: 1 })).toBe('bounds');
    expect(checkHomePlacement(base, 'app:branch', { x: 0, y: 0, w: 1, h: 1 })).toBe('ok');
    expect(applyHomePlacement(canvas, 'wide', base, 'app:branch', { x: 3, y: 0, w: 1, h: 1 })).toBe(canvas);
    expect(applyHomePlacement(canvas, 'wide', base, 'app:branch', base.placements['app:branch'])).toBe(canvas);
    expect(applyHomePlacement(canvas, 'wide', base, 'missing', { x: 1, y: 2, w: 1, h: 1 })).toBe(canvas);
  });

  it('saves the visible projection as the active mode while preserving initial wide width', () => {
    const { canvas } = resolveHomeCanvas({ home_layout: ['widget:recent', 'app:branch'], home_sizes: { 'widget:recent': { columns: 8, rows: 64 } } });
    const visible = projectHomeBase(canvas.layouts.compact, canvas.items, 5);
    const next = applyHomePlacement(canvas, 'compact', visible, 'app:branch', { x: 4, y: 64, w: 1, h: 1 });
    expect(next.layouts.compact.columns).toBe(5);
    expect(next.layouts.compact.placements['app:branch']).toEqual({ x: 4, y: 64, w: 1, h: 1 });
    expect(next.layouts.wide.placements['widget:recent']).toEqual({ x: 0, y: 0, w: 8, h: 64 });
    expect(resolveHomeCanvas({ home_canvas: next }).canvas.layouts.wide).toEqual(canvas.layouts.wide);
  });

  it('adds only the new item to each mode and preserves holes after removal', () => {
    const canvas = canvasFixture();
    const next = addHomeItem(canvas, 'wide', canvas.layouts.wide, 'app:canvas');
    expect(next.items).toEqual(['app:branch', 'widget:recent', 'app:canvas']);
    expect(next.layouts.wide.placements['app:canvas']).toEqual({ x: 1, y: 0, w: 1, h: 1 });
    expect(next.layouts.compact.placements['app:canvas']).toEqual({ x: 1, y: 0, w: 1, h: 1 });
    expect(next.layouts.compact.placements['widget:recent']).toEqual(canvas.layouts.compact.placements['widget:recent']);
    expect(addHomeItem(next, 'wide', next.layouts.wide, 'app:canvas')).toBe(next);
    expect(addHomeItem(next, 'wide', next.layouts.wide, 'missing')).toBe(next);
    const removed = removeHomeItem(next, 'wide', next.layouts.wide, 'app:branch');
    expect(removed.items).toEqual(['widget:recent', 'app:canvas']);
    expect(removed.layouts.wide.placements['app:canvas']).toEqual({ x: 1, y: 0, w: 1, h: 1 });
    expect(removed.layouts.compact.placements['widget:recent']).toEqual(canvas.layouts.compact.placements['widget:recent']);
    expect(removeHomeItem(removed, 'wide', removed.layouts.wide, 'app:branch')).toBe(removed);
    const restored = addHomeItem(removed, 'wide', removed.layouts.wide, 'app:branch');
    expect(restored.layouts.wide.placements['app:branch']).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(validateHomeCanvas(restored)).toBe(true);
  });

  it('allows a screen-wide resize beyond eight cells without moving neighboring items', () => {
    const canvas = canvasFixture();
    canvas.layouts.wide.columns = 17;
    const before = structuredClone(canvas);
    const next = applyHomePlacement(canvas, 'wide', canvas.layouts.wide, 'widget:recent', { x: 0, y: 1, w: 17, h: 64 });
    expect(next.layouts.wide.placements['widget:recent']).toEqual({ x: 0, y: 1, w: 17, h: 64 });
    expect(next.layouts.wide.placements['app:branch']).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(next.layouts.compact).toBe(canvas.layouts.compact);
    expect(validateHomeCanvas(next)).toBe(true);
    expect(canvas).toEqual(before);
    expect(applyHomePlacement(canvas, 'wide', canvas.layouts.wide, 'widget:recent', { x: 0, y: 0, w: 17, h: 64 })).toBe(canvas);
  });

  it('places an added app below a tall full-width widget without allocating its rows', () => {
    const canvas = { version: 1, items: ['widget:recent'], layouts: {
      wide: { columns: 17, placements: { 'widget:recent': { x: 0, y: 0, w: 17, h: 1000000 } } },
      compact: { columns: 4, placements: { 'widget:recent': { x: 0, y: 0, w: 4, h: 1000000 } } },
    } };
    const next = addHomeItem(canvas, 'wide', canvas.layouts.wide, 'app:branch');
    expect(next.layouts.wide.placements['app:branch']).toEqual({ x: 0, y: 1000000, w: 1, h: 1 });
    expect(next.layouts.compact.placements['app:branch']).toEqual({ x: 0, y: 1000000, w: 1, h: 1 });
  });
});

describe('home canvas reading and validation', () => {
  it('keeps empty legacy homes empty in both modes', () => {
    expect(resolveHomeCanvas({ home_layout: [], launchpad_order: ['branch'] })).toEqual({ status: 'ready', canvas: {
      version: 1, items: [], layouts: { wide: { columns: 8, placements: {} }, compact: { columns: 4, placements: {} } },
    } });
  });

  it('migrates the old sparse cursor without backfilling previous gaps', () => {
    const { canvas } = resolveHomeCanvas({ home_layout: ['app:branch', 'widget:recent', 'app:canvas'], home_sizes: { 'widget:recent': { columns: 8, rows: 64 } } });
    expect(canvas.layouts.wide.placements).toEqual({
      'app:branch': { x: 0, y: 0, w: 1, h: 1 },
      'widget:recent': { x: 0, y: 1, w: 8, h: 64 },
      'app:canvas': { x: 0, y: 65, w: 1, h: 1 },
    });
    expect(canvas.layouts.compact.placements['widget:recent']).toEqual({ x: 0, y: 1, w: 4, h: 64 });
    expect(validateHomeCanvas(canvas)).toBe(true);
  });

  it('uses valid v1 over legacy and treats invalid existing namespaces as errors', () => {
    const canvas = canvasFixture();
    expect(resolveHomeCanvas({ home_canvas: canvas, home_layout: [] })).toEqual({ status: 'ready', canvas });
    for (const home_canvas of [null, undefined, {}, { ...canvas, version: 2 }, { ...canvas, items: ['app:branch', 'app:branch'] }, { ...canvas, layouts: { wide: canvas.layouts.wide } }]) {
      expect(resolveHomeCanvas({ home_canvas, home_layout: [] })).toEqual({ status: 'invalid' });
    }
    const empty = { version: 1, items: [], layouts: { wide: { columns: 8, placements: {} }, compact: { columns: 4, placements: {} } } };
    expect(resolveHomeCanvas({ home_canvas: empty, home_layout: ['app:branch'] }).canvas.items).toEqual([]);
  });

  it('rejects unknown fields, missing placements, invalid sizes and overlap', () => {
    const invalid = mutate => { const canvas = canvasFixture(); mutate(canvas); expect(validateHomeCanvas(canvas)).toBe(false); };
    invalid(canvas => { canvas.extra = true; });
    invalid(canvas => { canvas.layouts.mobile = canvas.layouts.compact; });
    invalid(canvas => { canvas.layouts.wide.extra = true; });
    invalid(canvas => { canvas.layouts.wide.placements['app:branch'].extra = true; });
    invalid(canvas => { delete canvas.layouts.compact.placements['app:branch']; });
    invalid(canvas => { canvas.layouts.compact.placements['app:canvas'] = { x: 1, y: 0, w: 1, h: 1 }; });
    invalid(canvas => { canvas.items[0] = 'missing'; });
    invalid(canvas => { canvas.layouts.wide.placements['app:branch'].w = 2; });
    invalid(canvas => { canvas.layouts.wide.placements['widget:recent'].w = 3; });
    invalid(canvas => { canvas.layouts.wide.placements['widget:recent'].h = 1; });
    invalid(canvas => { canvas.layouts.wide.placements['app:branch'].x = 3; });
    invalid(canvas => { canvas.layouts.wide.placements['widget:recent'].x = 5; });
  });

  it('reports malformed rectangle objects as invalid instead of throwing while reading', () => {
    for (const rect of [null, undefined, [], {}, 'rectangle']) {
      const canvas = canvasFixture(); canvas.layouts.wide.placements['widget:recent'] = rect;
      expect(validateHomeCanvas(canvas)).toBe(false);
      expect(resolveHomeCanvas({ home_canvas: canvas, home_layout: [] })).toEqual({ status: 'invalid' });
    }
  });

  it('accepts full-screen spans beyond eight and tall widgets within safe numeric bounds', () => {
    const canvas = canvasFixture();
    canvas.layouts.wide = { columns: 17, placements: { 'app:branch': { x: 0, y: 0, w: 1, h: 1 }, 'widget:recent': { x: 0, y: 1, w: 17, h: 1000000 } } };
    expect(validateHomeCanvas(canvas)).toBe(true);
    for (const value of [true, '8', 8.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = canvasFixture(); invalid.layouts.wide.columns = value;
      expect(validateHomeCanvas(invalid)).toBe(false);
    }
    for (const key of ['x', 'y', 'w', 'h']) {
      const invalid = canvasFixture(); invalid.layouts.wide.placements['widget:recent'][key] = true;
      expect(validateHomeCanvas(invalid)).toBe(false);
    }
    const invalid = canvasFixture(); invalid.layouts.wide.placements['widget:recent'].y = Number.MAX_SAFE_INTEGER;
    expect(validateHomeCanvas(invalid)).toBe(false);
  });
});

describe('home viewport projection', () => {
  it('reserves every fitting item before placing overflow apps side by side', () => {
    const items = ['app:branch', 'app:canvas', 'widget:scrum'];
    const base = { columns: 8, placements: {
      'app:branch': { x: 6, y: 0, w: 1, h: 1 },
      'app:canvas': { x: 7, y: 0, w: 1, h: 1 },
      'widget:scrum': { x: 0, y: 0, w: 2, h: 2 },
    } };
    const before = structuredClone(base), projected = projectHomeBase(base, items, 4);
    expect(projected.placements).toEqual({
      'widget:scrum': { x: 0, y: 0, w: 2, h: 2 },
      'app:branch': { x: 0, y: 2, w: 1, h: 1 },
      'app:canvas': { x: 1, y: 2, w: 1, h: 1 },
    });
    expect(base).toEqual(before);
    expect(projectHomeBase(base, items, 8)).toEqual(base);
  });

  it('orders overflow spatially and restores clipped widget widths when widening', () => {
    const items = ['app:canvas', 'widget:recent', 'app:branch'];
    const base = { columns: 8, placements: {
      'app:canvas': { x: 7, y: 3, w: 1, h: 1 },
      'widget:recent': { x: 0, y: 0, w: 8, h: 2 },
      'app:branch': { x: 6, y: 3, w: 1, h: 1 },
    } };
    expect(projectHomeBase(base, items, 4).placements).toEqual({
      'widget:recent': { x: 0, y: 0, w: 4, h: 2 },
      'app:branch': { x: 0, y: 2, w: 1, h: 1 },
      'app:canvas': { x: 1, y: 2, w: 1, h: 1 },
    });
    expect(projectHomeBase(base, items, 8)).toEqual(base);
  });

  it('measures shared geometry with screen-wide spans and bounded icon pitch', () => {
    expect(getHomeGridMetrics(390, 342)).toEqual({ mode: 'compact', columns: 4, rowHeight: 90, rowGap: 20, columnGap: 14, columnStep: 89, rowStep: 110 });
    const wide = getHomeGridMetrics(1920, 1848);
    expect(wide.mode).toBe('wide'); expect(wide.columns).toBe(17); expect(wide.columnStep).toBeLessThanOrEqual(116);
    expect(getHomeGridMetrics(760, 688).mode).toBe('compact');
    expect(getHomeGridMetrics(761, 689).mode).toBe('wide');
  });
});

describe('widget sizes', () => {
  it('keeps default and minimum sizes, while allowing the whole grid and tall widgets', () => {
    expect(resolveHomeSize('widget:recent')).toEqual({ columns: 4, rows: 2 });
    expect(resolveHomeSize('widget:recent', { 'widget:recent': { columns: 2, rows: 1 } })).toEqual({ columns: 4, rows: 2 });
    expect(resolveHomeSize('widget:scrum', { 'widget:scrum': { columns: 8, rows: 64 } })).toEqual({ columns: 8, rows: 64 });
  });

  it('fits a narrow screen without replacing the saved desktop width', () => {
    const sizes = { 'widget:recent': { columns: 8, rows: 5 } };
    expect(resolveHomeSize('widget:recent', sizes, 4)).toEqual({ columns: 4, rows: 5 });
    expect(resolveHomeSize('widget:recent', sizes, 8)).toEqual({ columns: 8, rows: 5 });
    expect(sizes['widget:recent']).toEqual({ columns: 8, rows: 5 });
  });

  it('ignores invalid dimensions and never resizes an app icon', () => {
    expect(resolveHomeSize('widget:scrum', { 'widget:scrum': { columns: '6', rows: Infinity } })).toEqual({ columns: 2, rows: 2 });
    expect(resolveHomeSize('app:canvas', { 'app:canvas': { columns: 8, rows: 12 } })).toEqual({ columns: 1, rows: 1 });
  });
});
