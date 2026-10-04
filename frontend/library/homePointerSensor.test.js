// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePointerSensor from '@/components/Home/HomePointerSensor';

let target, events;
const pointer = (type, x, buttons = 1) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 100, button: 0, buttons });
  target.dispatchEvent(event);
  return event;
};
const blur = () => window.dispatchEvent(new Event('blur'));

beforeEach(() => {
  vi.useFakeTimers();
  target = document.createElement('button');
  document.body.append(target);
  events = [];
  new HomePointerSensor({
    active: 'app:branch',
    activeNode: { node: { current: target } },
    event: pointer('pointerdown', 100),
    context: { current: {} },
    options: { activationConstraint: { distance: 6 } },
    onStart: () => events.push('start'),
    onMove: () => events.push('move'),
    onPending() {},
    onAbort: () => events.push('abort'),
    onCancel: () => events.push('cancel'),
    onEnd: () => events.push('end'),
  });
});
afterEach(() => {
  pointer('pointercancel', 100, 0);
  vi.runAllTimers();
  target.remove();
  vi.useRealTimers();
});

describe('home pointer gesture cancellation', () => {
  it('cancels a pending press on blur before a released pointer can start dragging', () => {
    blur();
    pointer('pointermove', 120, 0);
    pointer('pointerup', 120, 0);
    expect(events).toEqual(['abort', 'cancel']);
  });

  it('cancels an active drag on blur and ignores later movement and release', () => {
    pointer('pointermove', 120);
    pointer('pointermove', 140);
    blur();
    pointer('pointermove', 160, 0);
    pointer('pointerup', 160, 0);
    expect(events).toEqual(['start', 'move', 'cancel']);
  });

  it('removes the blur callback after a normal release', () => {
    pointer('pointermove', 120);
    pointer('pointerup', 120, 0);
    blur();
    pointer('pointermove', 140, 0);
    expect(events).toEqual(['start', 'end']);
  });

  it('removes the blur callback after native cancellation', () => {
    pointer('pointermove', 120);
    pointer('pointercancel', 120, 0);
    blur();
    pointer('pointerup', 120, 0);
    expect(events).toEqual(['start', 'cancel']);
  });
});
