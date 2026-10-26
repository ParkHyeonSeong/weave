// @vitest-environment jsdom
// 칩 갱신 조회를 /ref-status의 종류별 200개 제한 안으로 나눠 묻는다
// (설계 docs/superpowers/specs/2026-10-22-ref-link-chip-ingress-design.md §5.9).
// 201개를 한 번에 보내면 서버가 요청 전체를 거절해 본문의 칩이 하나도 갱신되지 않았다.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/library/_axios', () => ({ axios: { post: vi.fn(), get: vi.fn() } }));

const { axios } = await import('@/library/_axios');
const { hydrateEditor } = await import('./refHydration');

let nextId = 100000; // 모듈 캐시(30초 TTL)를 피하려고 테스트마다 다른 id를 쓴다
const ids = (n) => Array.from({ length: n }, () => nextId++);

function mountTaskChips(taskIds) {
  const root = document.createElement('div');
  root.innerHTML = taskIds.map((id) => (
    `<span data-task-ref="true" data-task-id="${id}" data-branch-id="10" data-display-id="OLD-${id}">`
    + `OLD-${id} 옛 제목<span class="ref-chip__badge" data-ref-badge="true">To Do</span></span>`
  )).join(' ');
  document.body.appendChild(root);
  return root;
}

const fakeEditor = (root) => ({ isDestroyed: false, view: { dom: root } });
const okResponse = (body) => ({
  data: {
    status: true,
    tasks: Object.fromEntries(body.task_ids.map((id) => [String(id), {
      status: 'done', title: `새 제목 ${id}`, display_id: `NEW-${id}`,
      status_label: 'Done', status_color: '#16A34A', status_category: 'done',
    }])),
    issues: {}, pages: {}, users: {},
  },
});
const chipText = (root, id) => root.querySelector(`[data-task-id="${id}"]`).firstChild.nodeValue;

beforeEach(() => {
  axios.post.mockReset();
  axios.get.mockReset();
  axios.post.mockImplementation(async (_url, body) => okResponse(body));
  axios.get.mockResolvedValue({ data: { branches: [{ branch_id: 10 }], canvases: [] } });
});

describe('/ref-status 200개 분할 조회', () => {
  it('같은 종류 200개는 요청 1회', async () => {
    const list = ids(200);
    await hydrateEditor(fakeEditor(mountTaskChips(list)));
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][1].task_ids).toHaveLength(200);
  });

  it('같은 종류 201개는 요청 2회(200+1)로 나눠 모두 갱신한다', async () => {
    const list = ids(201);
    const root = mountTaskChips(list);
    await hydrateEditor(fakeEditor(root));
    expect(axios.post.mock.calls.map((c) => c[1].task_ids.length)).toEqual([200, 1]);
    for (const id of list) expect(chipText(root, id)).toBe(`NEW-${id} 새 제목 ${id}`);
  });

  it('여러 종류가 섞여도 요청마다 종류별 200개 이하', async () => {
    const list = ids(201);
    const root = mountTaskChips(list);
    root.insertAdjacentHTML('beforeend', ids(5).map((p) => (
      `<span data-doc-ref="true" data-page-id="${p}" data-canvas-id="5">문서</span>`)).join(''));
    await hydrateEditor(fakeEditor(root));
    for (const [, body] of axios.post.mock.calls) {
      for (const key of ['task_ids', 'issue_ids', 'page_ids', 'user_ids']) {
        expect(body[key].length).toBeLessThanOrEqual(200);
      }
    }
    const asked = axios.post.mock.calls.flatMap((c) => c[1].task_ids);
    expect(new Set(asked)).toEqual(new Set(list));
  });

  it('한 묶음이 실패하면 성공 묶음만 갱신하고, 실패 묶음 칩은 저장된 모습 그대로 둔다', async () => {
    const list = ids(201);
    const root = mountTaskChips(list);
    axios.post.mockImplementation(async (_url, body) => {
      if (body.task_ids.length === 1) throw new Error('network');
      return okResponse(body);
    });
    await hydrateEditor(fakeEditor(root));
    expect(chipText(root, list[0])).toBe(`NEW-${list[0]} 새 제목 ${list[0]}`);
    const failed = root.querySelector(`[data-task-id="${list[200]}"]`);
    expect(failed.firstChild.nodeValue).toBe(`OLD-${list[200]} 옛 제목`);
    expect(failed.classList.contains('ref-chip--unresolved')).toBe(false); // 삭제로 오표기하지 않음
  });

  it('동시에 마운트된 두 표면은 같은 미스를 중복 요청하지 않는다', async () => {
    const list = ids(201);
    await Promise.all([hydrateEditor(fakeEditor(mountTaskChips(list))), hydrateEditor(fakeEditor(mountTaskChips(list)))]);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
