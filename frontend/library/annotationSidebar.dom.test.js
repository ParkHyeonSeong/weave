// @vitest-environment jsdom
// 문서 댓글 사이드바(AnnotationSidebar). 실제 IssueEditor(TipTap)를 그대로 마운트한다.
// ① 새 댓글·답글·답글 수정 입력창의 @ 팝업은 그 캔버스의 멤버를 찾는다 — 범위 없이 만들어 "사용자를 찾을 수 없음"만 떴다.
// ② 내 답글은 ⋯ → 수정으로 그 자리에서 고쳐 저장한다. 저장이 실패하면 편집창과 입력을 그대로 둔다.
// ③ 스레드 삭제(휴지통)는 확인을 받은 뒤에만 지운다.
// ④ 지정된 스레드(댓글 알림 링크 등)가 다른 탭에 있거나 목록이 늦게 와도 그 탭으로 옮겨 카드로 스크롤한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({
  axios: {
    get: vi.fn(async (url) => (url === '/chat/mention-search'
      ? { data: { status: true, users: [{ user_id: 2, username: 'kim' }] } }
      : { data: { status: false } })),
    post: vi.fn(async () => ({ data: { status: false } })),
  },
  getBaseURL: () => '',
}));

import '@/library/i18n';
import { axios } from '@/library/_axios';
import AnnotationSidebar from '@/components/Canvas/AnnotationSidebar';
import { mentionPluginKey } from '@/components/Canvas/extensions/MentionExtension';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ME = 1;
const KIM = 2;
const reply = (id, author, content) => ({
  reply_id: id, author_id: author, author_name: author === ME ? 'me' : 'kim', content,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
});
const thread = (id, status, replies) => ({
  annotation_id: id, status, created_by: replies[0].author_id, quoted_text: `quote ${id}`, replies,
});
const OPEN_MINE = thread(41, 'open', [reply(501, ME, '<p>typo</p>'), reply(502, KIM, '<p>other</p>')]);
const RESOLVED = thread(42, 'resolved', [reply(503, KIM, '<p>done</p>')]);

let root;
let props;
let scrolled;

function render(overrides = {}) {
  props = {
    canvasId: 3,
    annotations: [OPEN_MINE, RESOLVED],
    isOpen: true,
    onClose: vi.fn(),
    onResolve: vi.fn(),
    onReopen: vi.fn(),
    onDelete: vi.fn(),
    onCreateReply: vi.fn(async () => 900),
    onUpdateReply: vi.fn(async () => true),
    onDeleteReply: vi.fn(),
    activeAnnotationId: null,
    onAnnotationSelect: vi.fn(),
    newAnnotationData: null,
    onSubmitNewAnnotation: vi.fn(),
    onCancelNewAnnotation: vi.fn(),
    ...props,
    ...overrides,
  };
  return act(async () => { root.render(<AnnotationSidebar {...props} />); });
}

const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const btn = (text, scope = document) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const card = (id) => document.querySelector(`.AnnotationSidebar__Card[data-annotation-id="${id}"]`);
const activeTab = () => document.querySelector('.AnnotationSidebar__Tab--active')?.textContent;
const editorIn = (sel) => document.querySelector(`${sel} .ProseMirror`)?.editor;

// @를 친 상태(멘션 팝업 활성)로 만들고 검색 디바운스(300ms)를 넘긴다
async function typeAt(editor) {
  editor.view.coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 });   // jsdom엔 레이아웃이 없다
  await act(async () => {
    editor.view.dispatch(editor.state.tr.setMeta(mentionPluginKey, { active: true, keyword: '', from: 1 }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

// ⋯는 내 답글(501)에만 있다 — 열어서 수정을 누른다
async function openEditOnMyReply() {
  const menuBtn = document.querySelector('.AnnotationSidebar__MenuBtn');
  const replyEl = menuBtn.closest('.AnnotationSidebar__Reply');
  await click(menuBtn);
  await click(btn('Edit', replyEl));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  props = {};
  scrolled = [];
  Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this); };
  sessionStorage.setItem('profile', JSON.stringify({ user_id: ME, username: 'me' }));
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('입력창의 @ 멘션은 이 캔버스 멤버를 찾는다', () => {
  it.each([
    ['새 댓글', async () => {
      await render({ newAnnotationData: { quoted_text: 'quote new' } });
      return editorIn('.AnnotationSidebar__NewEditor');
    }],
    ['답글', async () => {
      await render();
      await click(btn('Reply', card(41)));
      return editorIn('.AnnotationSidebar__ReplyEditor');
    }],
    ['내 답글 수정', async () => {
      await render();
      await openEditOnMyReply();
      return editorIn('.AnnotationSidebar__Reply');
    }],
  ])('%s', async (_name, openComposer) => {
    const editor = await openComposer();
    expect(editor).toBeTruthy();
    await typeAt(editor);
    expect(axios.get).toHaveBeenCalledWith('/chat/mention-search', { params: { q: '', canvas_id: 3 } });
    const items = [...document.querySelectorAll('.MentionPopup__ItemName')].map((n) => n.textContent);
    expect(items).toEqual(['kim']);
  });
});

describe('내 답글 수정', () => {
  it('⋯는 내 답글에만 있고, 수정 → 저장하면 고친 HTML로 onUpdateReply를 부르고 편집창을 닫는다', async () => {
    await render();
    expect(document.querySelectorAll('.AnnotationSidebar__MenuBtn')).toHaveLength(1);   // KIM의 답글엔 없다
    await openEditOnMyReply();
    const editor = editorIn('.AnnotationSidebar__Reply');
    expect(editor.getHTML()).toBe('<p>typo</p>');                                       // 원래 내용으로 시작
    await act(async () => { editor.commands.setContent('<p>fixed</p>'); });
    await click(btn('Save', card(41)));
    expect(props.onUpdateReply).toHaveBeenCalledWith(41, 501, '<p>fixed</p>');
    expect(editorIn('.AnnotationSidebar__Reply')).toBeUndefined();
  });

  it('저장이 실패하면 편집창과 고친 내용을 그대로 둔다', async () => {
    await render({ onUpdateReply: vi.fn(async () => false) });
    await openEditOnMyReply();
    await act(async () => { editorIn('.AnnotationSidebar__Reply').commands.setContent('<p>fixed</p>'); });
    await click(btn('Save', card(41)));
    expect(props.onUpdateReply).toHaveBeenCalledTimes(1);
    expect(editorIn('.AnnotationSidebar__Reply')?.getHTML()).toBe('<p>fixed</p>');
  });

  // 저장 응답을 붙잡아 두는 onUpdateReply — 응답 전에 사용자가 이어서 움직인다
  const heldSave = () => {
    const held = {};
    held.fn = vi.fn(() => new Promise((resolve) => { held.finish = resolve; }));
    return held;
  };

  it('저장 요청 중 이어서 고친 내용은 앞 저장의 성공 응답에 닫혀 사라지지 않는다', async () => {
    const save = heldSave();
    await render({ onUpdateReply: save.fn });
    await openEditOnMyReply();
    const editor = editorIn('.AnnotationSidebar__Reply');
    await act(async () => { editor.commands.setContent('<p>fixed</p>'); });
    await click(btn('Save', card(41)));
    await act(async () => { editor.commands.setContent('<p>fixed more</p>'); });
    await act(async () => { save.finish(true); });
    expect(editorIn('.AnnotationSidebar__Reply')?.getHTML()).toBe('<p>fixed more</p>');
  });

  it('저장 요청 중 다른 답글 편집으로 옮기면 앞 저장의 성공 응답이 그 편집창을 닫지 않는다', async () => {
    const save = heldSave();
    const TWO_MINE = thread(43, 'open', [reply(504, ME, '<p>first</p>'), reply(505, ME, '<p>second</p>')]);
    await render({ annotations: [TWO_MINE], onUpdateReply: save.fn });
    const editReply = async (text) => {
      const replyEl = [...document.querySelectorAll('.AnnotationSidebar__Reply')].find((r) => r.textContent.includes(text));
      await click(replyEl.querySelector('.AnnotationSidebar__MenuBtn'));
      await click(btn('Edit', replyEl));
    };
    await editReply('first');
    await act(async () => { editorIn('.AnnotationSidebar__Reply').commands.setContent('<p>first!</p>'); });
    await click(btn('Save', card(43)));
    await editReply('second');
    await act(async () => { editorIn('.AnnotationSidebar__Reply').commands.setContent('<p>second draft</p>'); });
    await act(async () => { save.finish(true); });
    expect(editorIn('.AnnotationSidebar__Reply')?.getHTML()).toBe('<p>second draft</p>');
  });

  it('취소하면 저장하지 않고 원래 내용을 보인다', async () => {
    await render();
    await openEditOnMyReply();
    await click(btn('Cancel', card(41)));
    expect(props.onUpdateReply).not.toHaveBeenCalled();
    expect(editorIn('.AnnotationSidebar__Reply')).toBeUndefined();
    expect(card(41).querySelector('.AnnotationSidebar__ReplyContent').innerHTML).toBe('<p>typo</p>');
  });
});

describe('스레드 삭제는 확인을 받는다', () => {
  const trash = () => card(41).querySelector('.AnnotationSidebar__ActionBtn--danger');

  it('휴지통만으로는 지우지 않고, 확인 창에서 삭제를 눌러야 onDelete를 부른다', async () => {
    await render();
    await click(trash());
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(document.querySelector('.ConfirmModal__Message').textContent).toContain('2 comments');
    await click(document.querySelector('.ConfirmModal__ConfirmBtn'));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledWith(41);
    expect(document.querySelector('.ConfirmModal')).toBeNull();
  });

  it('취소하면 지우지 않는다', async () => {
    await render();
    await click(trash());
    await click(document.querySelector('.ConfirmModal__CancelBtn'));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(document.querySelector('.ConfirmModal')).toBeNull();
  });
});

describe('지정된 스레드로 옮겨 보여준다', () => {
  it('해결된 스레드면 해결됨 탭으로 바꾸고 그 카드로 스크롤한다', async () => {
    await render({ activeAnnotationId: 42 });
    expect(activeTab()).toContain('Resolved');
    expect(card(42).classList.contains('AnnotationSidebar__Card--active')).toBe(true);
    expect(scrolled).toContain(card(42));
  });

  it('목록이 늦게 도착해도 도착한 뒤 그 카드로 스크롤한다', async () => {
    await render({ annotations: [], activeAnnotationId: 41 });
    expect(scrolled).toHaveLength(0);
    await render({ annotations: [OPEN_MINE, RESOLVED] });
    expect(scrolled).toContain(card(41));
  });

  it('옮긴 뒤에는 사용자가 다른 탭으로 자유롭게 옮긴다', async () => {
    await render({ activeAnnotationId: 42 });
    await click(btn('Open (1)'));
    expect(activeTab()).toContain('Open');
    await render({ annotations: [OPEN_MINE, { ...RESOLVED }] });   // 목록 갱신(WS 등)에도 다시 끌려가지 않는다
    expect(activeTab()).toContain('Open');
  });
});
