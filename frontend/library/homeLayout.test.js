import { describe, expect, it } from 'vitest';
import { resolveHomeLayout, moveHomeItem, resolveHomeSize } from './homeLayout';

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
