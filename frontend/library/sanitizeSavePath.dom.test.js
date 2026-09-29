// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

// vi.mock 팩토리는 호이스팅되므로 픽스처/캡처 배열은 vi.hoisted로 만든다.
const { EDITOR_OUT, dynProps } = vi.hoisted(() => ({
  EDITOR_OUT:
    '<p><span style="color: rgb(220, 38, 38);">red</span>'
    + '<mark data-color="#FEF08A" style="background-color: rgb(254, 240, 138); color: inherit;">hl</mark></p>'
    + '<p></p>'                                   // ← hook 없이도 sanitizeHtml이 <p><br></p>로 바꾼다
    + '<ul data-type="taskList"><li data-checked="true"><label><input type="checkbox" checked>'
    + '<span></span></label><div><p>done</p></div></li></ul>',
  dynProps: [],
}));

vi.mock('@/library/_axios', () => ({
  axios: {
    get: vi.fn((url) => Promise.resolve({ data: globalThis.__GET(url) })),
    post: vi.fn(() => Promise.resolve({ data: { status: true, comment: { comment_id: 1 } } })),
    patch: vi.fn(() => Promise.resolve({ data: { status: true } })),
    delete: vi.fn(() => Promise.resolve({ data: { status: true } })),
  },
  // Avatar.js:15가 렌더 중에 부른다 — 빠지면 TaskIssueDetail 마운트가 통째로 깨진다(실측).
  getBaseURL: () => '',
  getWsBaseURL: () => '',
  refreshAccessToken: async () => null,
}));
vi.mock('next/router', () => ({ useRouter: () => globalThis.__ROUTER }));
// 편집기 본체(yjs·wasm)는 로드하지 않는다 — onHtmlChange prop만 잡으면 저장 핸들러에 닿는다.
vi.mock('next/dynamic', () => ({
  default: () => function DynamicStub(props) { dynProps.push(props); return null; },
}));
vi.mock('@/library/useCollabProvider', () => ({
  default: (cid, pid) => ({ ydoc: cid && pid ? {} : null, provider: cid && pid ? {} : null,
                            status: 'connected', connectedUsers: [],
                            // 연결·전달 확인됨 — 닫기가 묻지 않고 저장 경로만 탄다
                            connection: 'connected', pending: false,
                            deliveryRef: { current: { connection: 'connected', pending: false } } }),
}));
vi.mock('@/library/typstCompiler', () => ({ compileToSvg: async () => '', downloadPdf: async () => {} }));
vi.mock('@/components/Branch/Tasks/IssueEditor', async () => {
  const { forwardRef, useImperativeHandle, useEffect } = await import('react');
  return { default: forwardRef((props, ref) => {
    useImperativeHandle(ref, () => ({
      getHTML: () => EDITOR_OUT, isEmpty: () => false, clearContent() {}, focus() {},
    }));
    useEffect(() => { props.onChange?.(false); }, []);   // composer 제출 버튼 disabled 해제
    return null;
  }) };
});

import { axios } from '@/library/_axios';
import CanvasOverview from '@/components/Canvas/CanvasOverview';
import CanvasPageView from '@/components/Canvas/CanvasPageView';
import TaskIssueDetail from '@/components/Branch/Tasks/TaskIssueDetail';
import CreateIssuePage from '@/components/Branch/Tasks/CreateIssuePage';
import useTaskComments from '@/hooks/useTaskComments';
import useAnnotations from '@/hooks/useAnnotations';
import useTaskDetail from '@/hooks/useTaskDetail';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom에 없다 — 없으면 CanvasPageView 마운트가 "ResizeObserver is not defined"로 깨진다(실측).
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

let root;
const mount = async (el) => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(el); });
};
const tick = () => act(async () => {});
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
const menuItem = (t) => [...document.querySelectorAll('.IssueDetail__MenuDropdown .IssueDetail__MenuItem')]
  .find((b) => b.textContent.includes(t));
// 훅은 반드시 렌더 중에 호출한다. JSX children의 IIFE(`<>{(() => hook())()}</>`)로 부르면
// element 생성 시점에 실행돼 dispatcher가 null이다 — 실측: "Invalid hook call …
// TypeError: Cannot read properties of null (reading 'useState')".
const probe = async (hook) => {
  let api;
  function Probe() { api = hook(); return null; }
  await mount(<Probe />);
  return api;
};
function issueSetup(comments = []) {
  globalThis.__ROUTER = { query: { id: '7', taskId: '42', issueId: '5' }, push() {} };
  globalThis.__GET = (u) => (u === '/branches/7/tasks/42/issues/5' ? { status: true,
    issue: { issue_id: 5, title: 'T', body: '<p>old</p>', status: 'open', created_by: 1,
             author_name: 'me', created_at: '2026-01-01T00:00:00Z' },
    comments, timeline: comments.map((c) => ({ kind: 'comment', ...c })) } : { status: false });
  sessionStorage.setItem('profile', JSON.stringify({ user_id: 1, username: 'me' }));
}
function canvasSetup(query) {
  globalThis.__ROUTER = { query, push() {} };
  globalThis.__GET = (u) => ({
    '/canvases/3': { status: true, canvas: { canvas_name: 'C', my_role: 'admin' } },
    '/canvases/3/pages': { status: true, pages: [{ page_id: 9, type: query.pageId ? 'doc' : 'overview', title: 'P' }] },
    '/canvases/3/pages/9': { status: true, page: { page_id: 9, type: query.pageId ? 'doc' : 'overview', title: 'P', content: '<p>old</p>' } },
  }[u] || { status: false });
}
// Canvas는 한 컴포넌트에 content 저장 호출부가 **둘**이다 — 디바운스 writer와 Close writer.
// 하나의 drive로 묶으면 Close만 변형한 mutation이 살아남는다(실측 13/13 PASS). 반드시 분리한다.
const canvasEnterEdit = async (El, query) => {
  canvasSetup(query);
  await mount(<El />);
  await click(btn('Edit'));
  await act(async () => { dynProps.find((p) => p.onHtmlChange).onHtmlChange(EDITOR_OUT); });
};
// 디바운스 writer — 실측 5000ms(4900ms 진행 시 저장 호출 0건, 5200ms에서 1건).
// 실시간 대기로 바꾸면 스위트가 +10.35s 늘어난다(실측 5184ms+5166ms) → fake timer 유지.
const canvasDriveDebounce = async (El, query) => {
  await canvasEnterEdit(El, query);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });   // 디바운스 만료
};
// Close writer — **타이머를 전혀 진행시키지 않는다.** handleCloseEdit이 axios.patch를 직접
// await한 뒤에야 clearTimeout하므로, 디바운스 5초가 오기 전에 저장이 나간다.
// 이 행이 "5초 이전에도 payload가 sanitize되지 않는다"를 고정한다(실측 drive 14~15ms).
const canvasDriveClose = async (El, query) => {
  await canvasEnterEdit(El, query);
  await click(btn('Close'));    // 실측: 두 컴포넌트 모두 유일 매치이며 handleCloseEdit에 걸린다
  await tick();
};

const SINKS = [
  { name: 'CanvasOverview content (디바운스)', url: '/canvases/3/pages/9', key: 'content',
    drive: () => canvasDriveDebounce(CanvasOverview, { canvasId: '3' }) },
  { name: 'CanvasOverview content (Close)',    url: '/canvases/3/pages/9', key: 'content',
    drive: () => canvasDriveClose(CanvasOverview, { canvasId: '3' }) },
  { name: 'CanvasPageView content (디바운스)', url: '/canvases/3/pages/9', key: 'content',
    drive: () => canvasDriveDebounce(CanvasPageView, { canvasId: '3', pageId: '9' }) },
  { name: 'CanvasPageView content (Close)',    url: '/canvases/3/pages/9', key: 'content',
    drive: () => canvasDriveClose(CanvasPageView, { canvasId: '3', pageId: '9' }) },
  { name: 'TaskIssueDetail body',     url: '/branches/7/tasks/42/issues/5', key: 'body',
    drive: async () => { issueSetup(); await mount(<TaskIssueDetail />);
      await click(document.querySelector('.IssueDetail__MenuBtn'));
      await click(menuItem('Edit'));
      await click(document.querySelector('.IssueDetail__SaveBtn')); await tick(); } },
  { name: 'TaskIssueDetail 댓글 작성', url: '/branches/7/tasks/42/issues/5/comments', key: 'content',
    drive: async () => { issueSetup(); await mount(<TaskIssueDetail />);
      await click(btn('Comment')); await tick(); } },
  { name: 'TaskIssueDetail 댓글 수정', url: '/branches/7/tasks/42/issues/5/comments/8', key: 'content',
    drive: async () => {
      issueSetup([{ comment_id: 8, author_id: 1, author_name: 'me', content: '<p>c</p>',
                    created_at: '2026-01-01T00:00:00Z' }]);
      await mount(<TaskIssueDetail />);
      const m = document.querySelectorAll('.IssueDetail__MenuBtn');
      await click(m[m.length - 1]); await click(menuItem('Edit'));
      await click(document.querySelector('.IssueDetail__SaveBtn')); await tick(); } },
  { name: 'TaskIssueDetail 닫기+댓글', url: '/branches/7/tasks/42/issues/5/close', key: 'comment',
    drive: async () => { issueSetup(); await mount(<TaskIssueDetail />);
      await click(btn('Close with comment')); await tick(); } },
  { name: 'CreateIssuePage body',     url: '/branches/7/tasks/42/issues', key: 'body',
    drive: async () => {
      globalThis.__ROUTER = { query: { id: '7', taskId: '42' }, push() {}, replace() {} };
      await mount(<CreateIssuePage />);
      const input = document.querySelector('input');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'T');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await click(btn('Create')); await tick(); } },
  { name: 'task 댓글 작성',           url: '/branches/7/tasks/42/comments', key: 'content',
    drive: async () => { globalThis.__GET = () => ({ status: true, comments: [] });
      const api = await probe(() => useTaskComments(7, 42, 'asc'));
      await act(async () => { await api.createComment(EDITOR_OUT, null); }); } },
  { name: 'task 댓글 수정',           url: '/branches/7/tasks/42/comments/1', key: 'content',
    drive: async () => { globalThis.__GET = () => ({ status: true, comments: [] });
      const api = await probe(() => useTaskComments(7, 42, 'asc'));
      await act(async () => { await api.updateComment(1, EDITOR_OUT); }); } },
  { name: 'annotation 작성',          url: '/canvases/3/pages/9/annotations', key: 'content',
    drive: async () => { globalThis.__GET = () => ({ status: true, annotations: [] });
      const api = await probe(() => useAnnotations(3, 9));
      await act(async () => { await api.createAnnotation({ selected_text: 's', content: EDITOR_OUT }); }); } },
  { name: 'annotation 답글 작성',     url: '/canvases/3/pages/9/annotations/4/replies', key: 'content',
    drive: async () => { globalThis.__GET = () => ({ status: true, annotations: [] });
      const api = await probe(() => useAnnotations(3, 9));
      await act(async () => { await api.createReply(4, EDITOR_OUT); }); } },
  { name: 'annotation 답글 수정',     url: '/canvases/3/pages/9/annotations/4/replies/6', key: 'content',
    drive: async () => { globalThis.__GET = () => ({ status: true, annotations: [] });
      const api = await probe(() => useAnnotations(3, 9));
      await act(async () => { await api.updateReply(4, 6, EDITOR_OUT); }); } },
  { name: 'task description',         url: '/branches/7/tasks/42', key: 'description',
    drive: async () => {
      globalThis.__GET = (u) => (u === '/branches/7/tasks/42'
        ? { status: true, task: { task_id: 42, description: '<p>old</p>', task_type: null } }
        : { status: true, sprints: [], epics: [], members: [], labels: [], statuses: [], task_types: [] });
      const api = await probe(() => useTaskDetail(7, 42));
      await act(async () => { await api.updateField('description', EDITOR_OUT); }); } },
];

describe('저장 경로는 편집기 산출을 그대로 보낸다 (물리 저장 호출부 15곳 전수)', () => {
  beforeEach(() => { vi.clearAllMocks(); dynProps.length = 0;
                     vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); if (root) { act(() => root.unmount()); root = null; } });

  it.each(SINKS)('$name — payload가 편집기 산출과 바이트 동일하다', async (sink) => {
    await sink.drive();
    const writes = [...axios.post.mock.calls, ...axios.patch.mock.calls]
      .filter(([, body]) => body && sink.key in body);
    expect(writes.length, '저장 호출이 없다').toBeGreaterThan(0);
    for (const [url, body] of writes) {
      expect(url).toBe(sink.url);
      expect(body[sink.key]).toBe(EDITOR_OUT);          // 정규화·치환 0
      expect(body[sink.key]).not.toContain('wv-tc-');
      expect(body[sink.key]).not.toContain('wv-hl-');
    }
  });
});
