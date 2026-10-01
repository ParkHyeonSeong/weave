// @vitest-environment jsdom
// CV-02: MCP·REST로 고친 문서가 편집을 여는 순간 옛 내용으로 덮이지 않게 하는 편집 화면 쪽 계약.
// - 공동편집기의 자기 저장(5초 자동 저장·닫기 저장)은 origin: 'editor'를 함께 보낸다. 서버는 이 표지가 없는 본문 쓰기를
//   편집기 밖 쓰기로 보고, 편집 중이면 거절하고 아니면 공동편집 상태(yjs_state)를 비운다.
// - 편집기는 협업 방 동기화가 끝난 뒤 다시 읽은 페이지(content·yjs_state)로 연다. 읽기 화면 때 받은 페이지로 열면 그사이
//   외부 쓰기로 비워진 방에 옛 content를 채우거나(yjs_state 없음) 빈 문서를 저장해(yjs_state 있음) 그 쓰기를 덮는다.
//   방에 들어가기 전에 읽으면 읽기와 입장 사이의 외부 쓰기를 놓치므로, 읽기는 동기화 뒤에 한다.
// 렌더 하네스는 canvasCollabStatus.dom.test.js와 같다(편집기 본체는 next/dynamic 스텁이 props만 잡는다).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

// 협업 훅 모의가 돌려주는 provider — 테스트가 emitSync()로 방 동기화 완료를 흉내 낸다(y-websocket의 'sync' 이벤트).
const { dynProps, fakeProvider } = vi.hoisted(() => {
  const handlers = new Set();
  const provider = {
    synced: false,
    on: (event, fn) => { if (event === 'sync') handlers.add(fn); },
    off: (event, fn) => { if (event === 'sync') handlers.delete(fn); },
    emitSync() { provider.synced = true; [...handlers].forEach((fn) => fn(true)); },
    reset() { provider.synced = false; handlers.clear(); },
  };
  return { dynProps: [], fakeProvider: provider };
});
vi.mock('@/library/_axios', () => ({
  axios: {
    get: vi.fn((url) => Promise.resolve({ data: globalThis.__GET(url) })),
    patch: vi.fn(() => Promise.resolve({ data: { status: true } })),
    post: vi.fn(() => Promise.resolve({ data: { status: true } })),
    delete: vi.fn(() => Promise.resolve({ data: { status: true } })),
  },
  getBaseURL: () => '',
  getWsBaseURL: () => '',
  refreshAccessToken: async () => null,
}));
vi.mock('next/router', () => ({ useRouter: () => globalThis.__ROUTER }));
vi.mock('next/dynamic', () => ({ default: () => function DynamicStub(props) { dynProps.push(props); return null; } }));
vi.mock('@/library/useCollabProvider', () => ({
  default: (cid, pid) => ({
    ydoc: cid && pid ? {} : null, provider: cid && pid ? fakeProvider : null, status: 'connected',
    connectedUsers: [], connection: 'connected', pending: false,
    deliveryRef: { current: { connection: 'connected', pending: false } },
  }),
}));
vi.mock('@/library/typstCompiler', () => ({ compileToSvg: async () => ({ svg: null, errors: [] }), downloadPdf: async () => {} }));

import { axios } from '@/library/_axios';
import CanvasOverview from '@/components/Canvas/CanvasOverview';
import CanvasPageView from '@/components/Canvas/CanvasPageView';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const PAGE_URL = '/canvases/3/pages/9';
let root;
let serverPage;   // GET PAGE_URL이 돌려주는 서버의 현재 페이지 — 테스트 중에 바꾸면 외부 쓰기를 흉내 낸다
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
const editorProps = () => dynProps.filter((p) => 'initialContent' in p).at(-1);
const change = (html) => act(async () => {
  const p = editorProps();
  (p.onHtmlChange || p.onContentChange)(html);
});
const pageGets = () => axios.get.mock.calls.filter(([u]) => u === PAGE_URL).length;
const syncRoom = () => act(async () => { fakeProvider.emitSync(); });

async function mount(View, query, type) {
  globalThis.__ROUTER = { query, push() {}, replace() {} };
  serverPage = { page_id: 9, type, title: 'P', content: '<p>old</p>', yjs_state: true };
  globalThis.__GET = (u) => ({
    '/canvases/3': { status: true, canvas: { canvas_name: 'C', my_role: 'admin' } },
    '/canvases/3/pages': { status: true, pages: [{ page_id: 9, type, title: 'P' }] },
    [PAGE_URL]: { status: true, page: serverPage },
  }[u] || { status: false });
  sessionStorage.setItem('profile', JSON.stringify({ user_id: 1, username: 'me' }));
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<View />); });
}

const VIEWS = [
  ['CanvasPageView(문서)', CanvasPageView, { canvasId: '3', pageId: '9' }, 'document', '.CanvasPageView__Loading'],
  ['CanvasPageView(Typst)', CanvasPageView, { canvasId: '3', pageId: '9' }, 'typst', '.CanvasPageView__Loading'],
  ['CanvasOverview', CanvasOverview, { canvasId: '3' }, 'overview', '.CanvasOverview__Loading'],
];

beforeEach(() => {
  vi.clearAllMocks(); dynProps.length = 0; fakeProvider.reset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  if (root) { act(() => root.unmount()); root = null; }
});

describe.each(VIEWS)('%s', (_name, View, query, type, loadingSel) => {
  it('편집기는 협업 방 동기화 뒤에 다시 읽은 페이지로 연다 — 읽기 화면 뒤의 외부 쓰기를 옛 내용으로 덮지 않는다', async () => {
    await mount(View, query, type);
    const readsBeforeEdit = pageGets();
    await click(btn('Edit'));
    expect(editorProps()).toBeUndefined();            // 방 동기화 전에는 편집기를 띄우지 않는다
    expect(document.querySelector(loadingSel)).not.toBeNull();
    expect(pageGets()).toBe(readsBeforeEdit);         // 방에 들어가기 전에는 다시 읽지 않는다
    // 읽기 화면을 띄운 뒤 MCP가 본문을 바꿨다 — 서버는 content를 바꾸고 yjs_state를 비웠다
    serverPage = { ...serverPage, content: '<p>AI</p>', yjs_state: false };
    await syncRoom();
    expect(pageGets()).toBe(readsBeforeEdit + 1);
    expect(editorProps()).toMatchObject({ initialContent: '<p>AI</p>', hasExistingYjsState: false });
  });

  it('동기화 뒤 다시 읽기가 실패하면 연결 중에 멈추지 않고 편집을 닫는다 — 다시 열면 새로 읽은 본문으로 연다', async () => {
    await mount(View, query, type);
    const toasts = [];
    const onToast = (e) => toasts.push(e.detail);
    window.addEventListener('toast', onToast);
    const get = axios.get.getMockImplementation();
    axios.get.mockImplementation((u) => (u === PAGE_URL ? Promise.reject(new Error('Network Error')) : get(u)));
    try {
      await click(btn('Edit'));
      await syncRoom();                                          // 방 동기화는 됐지만 기준본을 다시 읽지 못했다
      expect(editorProps()).toBeUndefined();
      expect(document.querySelector(loadingSel)).toBeNull();     // '연결 중'에 멈추지 않는다
      expect(btn('Edit')).toBeDefined();                         // 읽기 화면으로 돌아와 다시 열 수 있다
      expect(toasts).toEqual([expect.objectContaining({ type: 'error', message: expect.any(String) })]);
      expect(axios.patch).not.toHaveBeenCalled();                // 본문을 건드리지 않는다
    } finally {
      window.removeEventListener('toast', onToast);
      axios.get.mockImplementation(get);
    }
    serverPage = { ...serverPage, content: '<p>AI</p>', yjs_state: false };
    fakeProvider.reset();                                        // 다시 열면 새 편집 세션이 동기화된다
    await click(btn('Edit'));
    await syncRoom();
    expect(editorProps()).toMatchObject({ initialContent: '<p>AI</p>', hasExistingYjsState: false });
  });

  it('자동 저장과 닫기 저장은 편집기 저장 표지(origin: editor)를 함께 보낸다', async () => {
    await mount(View, query, type);
    await click(btn('Edit'));
    await syncRoom();
    await change('<p>a</p>');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });   // 5초 자동 저장
    await change('<p>ab</p>');
    await click(btn('Close'));                                            // 닫기 저장
    expect(axios.patch.mock.calls).toEqual([
      [PAGE_URL, { content: '<p>a</p>', origin: 'editor' }],
      [PAGE_URL, { content: '<p>ab</p>', origin: 'editor' }],
    ]);
  });
});
