// @vitest-environment jsdom
// 읽기 화면은 dangerouslySetInnerHTML로 저장 HTML을 넣고 useRefHydration이 칩을 최신 상태(제목·상태·삭제 표시)로 고친다.
// React 19는 화면이 다시 그려질 때마다(같은 HTML이어도) innerHTML을 다시 넣어 그 결과를 지운다 — 태스크 전체 페이지에서
// 대상이 삭제된 칩의 취소선이 열 때마다 들쭉날쭉 사라지던 원인(실제 Chrome 5회 중 1회). 본문이 다시 들어오면 다시 반영해야 한다.
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { post: vi.fn(), get: vi.fn() } }));
const { axios } = await import('@/library/_axios');
const { useRefHydration } = await import('./refHydration');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 910001(태스크)·910002(문서)는 삭제됨(응답에 없음), 910003은 살아 있어 제목이 바뀌었다
const HTML = '<p>'
  + '<span data-task-ref="true" data-task-id="910001" data-branch-id="3" class="task-ref">WV-1 지운 태스크</span> '
  + '<span data-doc-ref="true" data-page-id="910002" data-canvas-id="5" class="doc-ref">설계</span> '
  + '<span data-task-ref="true" data-task-id="910003" data-branch-id="3" class="task-ref">WV-3 옛 제목</span></p>';

let rerender = () => {};
function ReadView({ html }) {
  const ref = useRef(null);
  const [, setTick] = useState(0);
  rerender = () => setTick((n) => n + 1);
  useRefHydration(ref, [html]);
  return <div ref={ref} className="TaskDescReadonly" dangerouslySetInnerHTML={{ __html: html }} />;
}

let host;
let root;
beforeEach(() => {
  axios.post.mockReset();
  axios.get.mockReset();
  axios.post.mockResolvedValue({
    data: {
      status: true, issues: {}, pages: {}, users: {},
      tasks: { 910003: { display_id: 'WV-3', title: '새 제목', status: 'todo', status_label: 'To Do', status_color: null, status_category: 'todo' } },
    },
  });
  axios.get.mockImplementation(async (url) => ({ data: url === '/branches' ? { branches: [{ branch_id: 3 }] } : { canvases: [{ canvas_id: 5 }] } }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const view = () => [...host.querySelectorAll('[data-task-ref],[data-doc-ref]')].map((el) => (
  `${el.firstChild.nodeValue}${el.classList.contains('ref-chip--unresolved') ? ' [삭제 표시]' : ''}`
));
const EXPECTED = ['WV-1 지운 태스크 [삭제 표시]', '설계 [삭제 표시]', 'WV-3 새 제목'];

it('같은 HTML로 다시 그려져도 삭제 표시와 최신 제목이 남는다', async () => {
  await act(async () => root.render(<ReadView html={HTML} />));
  await vi.waitFor(() => expect(view()).toEqual(EXPECTED)); // /ref-status·멤버십 처리 뒤

  await act(async () => rerender()); // 부모가 다시 그린 것과 같다 — React가 innerHTML을 다시 넣는다
  await vi.waitFor(() => expect(view()).toEqual(EXPECTED));
  expect(axios.post).toHaveBeenCalledTimes(1); // 다시 반영은 캐시로 — 새 조회 없음
});
