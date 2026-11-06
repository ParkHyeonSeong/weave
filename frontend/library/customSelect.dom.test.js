// @vitest-environment jsdom
//
// 공용 CustomSelect — 모달 밖 일반 사용처의 열기·선택·닫기가 그대로인지, 그리고 열린 목록을 닫은 Esc를
// '처리됨'(preventDefault)으로 표시해 바깥 창이 같은 Esc로 함께 닫히지 않게 하는지.
// 포커스 복귀는 켠 곳(returnFocusOnEscape)에서만이다 — 다른 사용처의 포커스 동작은 그대로다.
// 목록은 DropdownPortal로 document.body에 포털된다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CustomSelect from '@/components/common/CustomSelect';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
  { value: 'new', label: '최신순' },
  { value: 'old', label: '오래된순' },
];

let root;
let container;
let onChange;

function Harness(props) {
  const [value, setValue] = useState('new');
  return (
    <>
      <CustomSelect value={value} options={OPTIONS} onChange={(v) => { onChange(v); setValue(v); }} ariaLabel="정렬" {...props} />
      <button type="button" className="Outside">바깥</button>
    </>
  );
}

const $ = (sel) => document.querySelector(sel);
const trigger = () => $('.CustomSelect__Trigger');
const options = () => [...document.querySelectorAll('.CustomSelect__Option')];

function press(key) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => { (document.activeElement || document.body).dispatchEvent(ev); });
  return ev;
}

beforeEach(() => {
  onChange = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Harness />); });
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('CustomSelect — 모달 밖 기본 사용', () => {
  it('누르면 목록이 열려 열림을 알리고, 항목을 고르면 값을 알린 뒤 닫힌다', () => {
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    act(() => { trigger().click(); });
    expect(options().map((o) => o.textContent)).toEqual(['최신순', '오래된순']);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    // 트리거가 가리키는 목록(aria-controls)이 실제로 항목을 담은 포털 목록이다
    expect(document.getElementById(trigger().getAttribute('aria-controls')).contains(options()[1])).toBe(true);

    act(() => { options()[1].click(); });
    expect(onChange).toHaveBeenCalledWith('old');
    expect(options()).toHaveLength(0);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().textContent).toBe('오래된순');
  });

  it('바깥을 누르면 값을 바꾸지 않고 닫힌다', () => {
    act(() => { trigger().click(); });
    act(() => { $('.Outside').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(options()).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('CustomSelect — Esc', () => {
  it('열린 목록의 Esc는 목록만 닫고 처리됨으로 표시하며, 포커스는 트리거에 남는다', () => {
    trigger().focus();
    act(() => { trigger().click(); });
    const ev = press('Escape');
    expect(options()).toHaveLength(0);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it('목록이 닫혀 있으면 Esc를 건드리지 않는다 — 다른 곳의 Esc 처리를 막지 않는다', () => {
    trigger().focus();
    const ev = press('Escape');
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  it('기본은 포커스를 옮기지 않는다 — 다른 칸으로 옮겨 간 포커스를 끌어오지 않는다', () => {
    act(() => { trigger().click(); });
    $('.Outside').focus();
    press('Escape');
    expect(options()).toHaveLength(0);
    expect(document.activeElement).toBe($('.Outside'));
  });

  it.each([
    ['목록 항목', () => options()[0]],
    ['목록 밖 다른 칸', () => $('.Outside')],
  ])('returnFocusOnEscape면 포커스가 %s에 있어도 Esc 뒤 트리거로 돌아간다', (_, focusTarget) => {
    act(() => { root.render(<Harness returnFocusOnEscape />); });
    act(() => { trigger().click(); });
    focusTarget().focus();
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(options()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger());
  });
});
