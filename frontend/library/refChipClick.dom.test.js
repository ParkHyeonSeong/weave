// @vitest-environment jsdom
// 읽기 화면(저장된 HTML)의 ref 칩 좌클릭 → 편집기 칩과 같은 canvas:ref_click 이벤트(RefPanelHost가 패널을 연다).
// 서버(MCP·API)가 링크를 칩으로 저장하면서, 전에는 클릭되던 링크가 읽기 화면에서 안 눌리던 회귀를 막는다
// (독립 리뷰 Important 3, 설계 §5.7·§7.5).
import { it, expect, afterEach } from 'vitest';
import { openRefChipPanel } from './refUrl';

const HTML = '<p>'
  + '<span data-task-ref="true" data-task-id="12" data-branch-id="3" class="task-ref">WV-12 t'
  + '<span class="ref-chip__badge" data-ref-badge="true">To Do</span></span> '
  + '<span data-issue-ref="true" data-issue-id="7" data-task-id="12" data-branch-id="3" class="issue-ref">WV-12 i'
  + '<span class="ref-chip__badge" data-ref-badge="true">Open</span></span> '
  + '<span data-doc-ref="true" data-page-id="77" data-canvas-id="5" class="doc-ref">doc</span> '
  + '<a href="/x">plain</a></p>';

let cleanup = () => {};
afterEach(() => cleanup());

function mount(types) {
  const root = document.createElement('div');
  root.innerHTML = HTML;
  document.body.appendChild(root);
  const events = [];
  const handled = [];
  const onRef = (e) => events.push(e.detail);
  window.addEventListener('canvas:ref_click', onRef);
  root.addEventListener('click', (e) => handled.push(openRefChipPanel(e, types)));
  cleanup = () => { window.removeEventListener('canvas:ref_click', onRef); root.remove(); };
  return { root, events, handled };
}

const click = (el, init = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ...init }));

it('태스크·이슈·문서 칩 좌클릭은 편집기 칩과 같은 이벤트를 낸다(배지를 눌러도)', () => {
  const { root, events, handled } = mount();
  click(root.querySelector('[data-task-ref] [data-ref-badge]'));
  click(root.querySelector('[data-issue-ref]'));
  click(root.querySelector('[data-doc-ref]'));
  expect(events).toEqual([
    { type: 'task', data: { branchId: '3', taskId: '12' } },
    { type: 'issue', data: { branchId: '3', taskId: '12', issueId: '7' } },
    { type: 'doc', data: { canvasId: '5', pageId: '77' } },
  ]);
  expect(handled).toEqual([true, true, true]);
});

it('ctrl·cmd·shift 클릭, 가운데 클릭, 칩 밖 클릭은 처리하지 않는다', () => {
  const { root, events, handled } = mount();
  const chip = root.querySelector('[data-doc-ref]');
  click(chip, { ctrlKey: true });
  click(chip, { metaKey: true });
  click(chip, { shiftKey: true });
  click(chip, { button: 1 });
  click(root.querySelector('a'));
  expect(events).toEqual([]);
  expect(handled).toEqual([false, false, false, false, false]);
});

it('고른 종류만 처리한다(태스크 칩을 따로 다루는 화면용)', () => {
  const { root, events } = mount(['issue', 'doc']);
  click(root.querySelector('[data-task-ref]'));
  click(root.querySelector('[data-issue-ref]'));
  expect(events.map((e) => e.type)).toEqual(['issue']);
});
