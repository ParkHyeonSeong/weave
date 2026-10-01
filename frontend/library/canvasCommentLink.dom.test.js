// @vitest-environment jsdom
// 문서 댓글 알림 링크 /canvas/{c}/{p}?comment={스레드ID}(backend canvas_annotation.py)를 열면 문서와 함께 댓글 패널이
// 그 스레드를 띄운다 — 예전엔 문서만 열리고 패널은 닫혀 있어 스레드를 직접 찾아야 했다. 쿼리는 처리한 뒤 URL에서 지워,
// 그 문서를 보고 있다가 같은 알림을 다시 눌러도 다시 동작한다. 답글 수정은 실제 useAnnotations 훅(PATCH → 목록 재조회)을
// 거친다. 렌더 하네스는 canvasCollabStatus.dom.test.js와 같다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({
  axios: {
    get: vi.fn((url) => Promise.resolve({ data: globalThis.__GET(url) })),
    patch: vi.fn(() => Promise.resolve({ data: { status: true } })),
    post: vi.fn(() => Promise.resolve({ data: { status: false } })),
    delete: vi.fn(() => Promise.resolve({ data: { status: true } })),
  },
  getBaseURL: () => '',
  getWsBaseURL: () => '',
  refreshAccessToken: async () => null,
}));
vi.mock('next/router', () => ({ useRouter: () => globalThis.__ROUTER }));
vi.mock('next/dynamic', () => ({ default: () => function DynamicStub() { return null; } }));
vi.mock('@/library/useCollabProvider', () => ({
  default: () => ({
    ydoc: null, provider: null, status: 'connected', connectedUsers: [], connection: 'connected', pending: false,
    deliveryRef: { current: { connection: 'connected', pending: false } },
  }),
}));
vi.mock('@/library/typstCompiler', () => ({ compileToSvg: async () => '', downloadPdf: async () => {} }));

import i18next from '@/library/i18n';
import { axios } from '@/library/_axios';
import { errorText } from '@/library/errorText';
import CanvasPageView from '@/components/Canvas/CanvasPageView';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const ME = 1;
const reply = (id, author, content) => ({
  reply_id: id, author_id: author, author_name: author === ME ? 'me' : 'kim', content,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
});
const OPEN_MINE = { annotation_id: 41, status: 'open', created_by: ME, quoted_text: 'q41', replies: [reply(501, ME, '<p>typo</p>')] };
const RESOLVED = { annotation_id: 42, status: 'resolved', created_by: 2, quoted_text: 'q42', replies: [reply(502, 2, '<p>done</p>')] };

let root;
let router;
let threads;

async function mount(query) {
  router = { query, push: vi.fn(), replace: vi.fn() };
  globalThis.__ROUTER = router;
  await act(async () => { root.render(<CanvasPageView />); });
}

// 그 문서를 보고 있는 채로 URL 쿼리만 바뀐 상황 — Next는 같은 페이지 컴포넌트를 새 query로 다시 그린다
async function navigate(query) {
  router = { ...router, query };
  globalThis.__ROUTER = router;
  await act(async () => { root.render(<CanvasPageView />); });
}

const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const btn = (text, scope = document) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const sidebar = () => document.querySelector('.AnnotationSidebar');
const activeCard = () => document.querySelector('.AnnotationSidebar__Card--active')?.dataset.annotationId ?? null;
const editReplyEditor = () => document.querySelector('.AnnotationSidebar__Reply .ProseMirror')?.editor;

async function editMyReply(html) {
  const menuBtn = document.querySelector('.AnnotationSidebar__MenuBtn');   // ⋯는 내 답글에만 있다
  await click(menuBtn);
  await click(btn('Edit', menuBtn.closest('.AnnotationSidebar__Reply')));
  await act(async () => { editReplyEditor().commands.setContent(html); });
  await click(btn('Save', sidebar()));
}

beforeEach(() => {
  vi.clearAllMocks();
  threads = [OPEN_MINE, RESOLVED];
  globalThis.__GET = (u) => ({
    '/canvases/3/pages/9': { status: true, page: { page_id: 9, type: 'document', title: 'P', content: '<p>body</p>' } },
    '/canvases/3/pages/9/annotations': { status: true, annotations: threads },
  }[u] || { status: false });
  Element.prototype.scrollIntoView = () => {};
  sessionStorage.setItem('profile', JSON.stringify({ user_id: ME, username: 'me' }));
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('댓글 알림 링크(?comment=스레드ID)', () => {
  it('문서를 열면서 댓글 패널을 열고 그 스레드를 활성화한 뒤(해결됨 탭이어도) 쿼리를 지운다', async () => {
    await mount({ canvasId: '3', pageId: '9', comment: '42' });
    expect(sidebar()).not.toBeNull();
    expect(activeCard()).toBe('42');
    expect(router.replace).toHaveBeenCalledWith('/canvas/3/9', undefined, { shallow: true });
  });

  it('해결된 스레드 알림으로 옮겨진 뒤 열림 탭으로 바꿨어도, 같은 알림을 다시 누르면 그 스레드를 다시 보여 준다', async () => {
    const activeTab = () => document.querySelector('.AnnotationSidebar__Tab--active')?.textContent;
    const shownCard = (id) => document.querySelector(`.AnnotationSidebar__Card[data-annotation-id="${id}"]`);
    await mount({ canvasId: '3', pageId: '9', comment: '42' });
    await navigate({ canvasId: '3', pageId: '9' });                 // 처리한 쿼리를 지운 주소
    expect(activeTab()).toContain('Resolved');
    await click(btn('Open (1)'));
    expect(shownCard(42)).toBeNull();
    await navigate({ canvasId: '3', pageId: '9', comment: '42' });  // 같은 알림을 다시 누른다
    expect(activeTab()).toContain('Resolved');
    expect(shownCard(42)).not.toBeNull();
    expect(activeCard()).toBe('42');
  });

  it('그 문서를 보고 있을 때 알림을 눌러도 패널을 열고 그 스레드를 띄운다', async () => {
    await mount({ canvasId: '3', pageId: '9' });
    expect(sidebar()).toBeNull();                       // 쿼리가 없으면 패널은 닫힌 채 시작한다
    await navigate({ canvasId: '3', pageId: '9', comment: '41' });
    expect(sidebar()).not.toBeNull();
    expect(activeCard()).toBe('41');
  });
});

describe('답글 수정(useAnnotations 경유)', () => {
  it('저장하면 PATCH하고 목록을 다시 읽어 고친 내용을 보이며 편집창을 닫는다', async () => {
    await mount({ canvasId: '3', pageId: '9', comment: '41' });
    threads = [{ ...OPEN_MINE, replies: [reply(501, ME, '<p>fixed</p>')] }, RESOLVED];   // 서버 반영 후 목록
    await editMyReply('<p>fixed</p>');
    expect(axios.patch).toHaveBeenCalledWith('/canvases/3/pages/9/annotations/41/replies/501', { content: '<p>fixed</p>' });
    expect(editReplyEditor()).toBeUndefined();
    expect(document.querySelector('.AnnotationSidebar__ReplyContent').innerHTML).toBe('<p>fixed</p>');
  });

  it.each([
    ['서버가 거절하면(status:false)', () => axios.patch.mockResolvedValueOnce({
      data: { status: false, code: 'REPLY_NOT_FOUND', category: 'not_found' },
    }), () => errorText('REPLY_NOT_FOUND', 'not_found')],
    ['네트워크가 실패하면', () => axios.patch.mockRejectedValueOnce(new Error('offline')),
      () => i18next.t('canvas.annotations.editFailed')],
  ])('%s 편집창과 고친 내용을 두고 이유를 토스트로 알린다', async (_name, failOnce, expectedMessage) => {
    const toasts = [];
    const onToast = (e) => toasts.push(e.detail);
    window.addEventListener('toast', onToast);
    try {
      await mount({ canvasId: '3', pageId: '9', comment: '41' });
      failOnce();
      await editMyReply('<p>fixed</p>');
      expect(editReplyEditor()?.getHTML()).toBe('<p>fixed</p>');
      expect(toasts).toEqual([expect.objectContaining({ type: 'error', message: expectedMessage() })]);
      expect(expectedMessage()).toBeTruthy();
    } finally {
      window.removeEventListener('toast', onToast);
    }
  });
});
