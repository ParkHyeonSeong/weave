// @vitest-environment jsdom
//
// 휴대폰 화면 키보드에는 Cmd/Ctrl+Enter·Esc가 없다. 태스크 댓글·답글·수정 입력기는
// 눈에 보이는 [등록]/[취소] 버튼으로도 끝낼 수 있어야 하고(단축키는 그대로 동작),
// 등록이 실패하면 콘솔이 아니라 입력기 아래에 이유를 보이고 초안을 남겨야 한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChangeSet, EditorState, Text } from '@codemirror/state';
import { history, isolateHistory, undo } from '@codemirror/commands';

const { PREFS, RAW } = vi.hoisted(() => ({
  // 선호 로드 완료 상태 — TaskCommentSection은 로드 전에는 댓글 fetch를 미룬다
  PREFS: { prefs: {}, loaded: true, setNamespace: () => {} },
  RAW: { props: null }, // 원문 편집기가 받은 props — 키 입력은 onChange(글자, 편집 기록)로 흉내 낸다
}));

vi.mock('@/library/_axios', () => ({
  axios: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getBaseURL: () => '',
}));
vi.mock('@/library/UiPrefsContext', () => ({ useUiPrefs: () => PREFS }));
// raw 편집기 본체(CodeMirror 동적 로드)는 필요 없다 — raw 제출은 진입 때 직렬화된 텍스트로 확인한다
vi.mock('@/components/common/RawMarkdownEditor', () => ({ default: (props) => { RAW.props = props; return null; } }));

import { axios } from '@/library/_axios';
import i18next from '@/library/i18n';
import CommentEditor from '@/components/Branch/Tasks/CommentEditor';
import TaskCommentSection from '@/components/Branch/Tasks/TaskCommentSection';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom의 Range에는 레이아웃 API가 없다. autoFocus 편집기의 지연 focus(rAF 뒤 scrollIntoView)가
// prosemirror-view coordsAtPos→singleRect에서 range.getClientRects()를 부르다 uncaught TypeError를
// 내므로(부하가 걸린 전체 실행에서만 보이던 오류) 빈 사각형을 돌려주는 스텁을 둔다.
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = function () { return []; };
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = function () { return new DOMRect(); };

const BASE = '/branches/7/tasks/42/comments';
const ME = { user_id: 1, username: 'Me', avatar_url: null };
const KIM = { user_id: 2, username: 'Kim', avatar_url: null };
const comment = (id, author, content) => ({
  comment_id: id, parent_comment_id: null, content, is_edited: false, is_deleted: false,
  created_at: `2026-09-0${id % 9 + 1}T00:00:00Z`, updated_at: `2026-09-0${id % 9 + 1}T00:00:00Z`,
  author, mentioned_user_ids: [],
});
const COMMENTS = [comment(10, KIM, '<p>원댓글</p>'), comment(20, ME, '<p>내 댓글</p>')];

// 백엔드 silent-200 실패 본문(core/errors.py error_response 형태)
const fail = (code, category) => ({ data: { status: false, message: code, code, category, retryable: false } });

// 답글·수정 편집기는 autoFocus로 뜬다. TipTap은 마운트 뒤 setTimeout(0)에서 focus를 걸고,
// 그 안에서 rAF로 view.focus()+scrollIntoView를 부른다(@tiptap/core Editor.ts, commands/focus.ts).
// 그 프레임이 테스트 도중에 오는지는 부하에 따라 달라지므로, 정리 전에 한 태스크+한 프레임을
// 흘려 열린 편집기가 늘 이 경로를 끝까지 타게 한다(단일 파일 실행과 전체 실행을 같게 만든다).
const settleAutofocus = () =>
  act(() => new Promise((resolve) => { setTimeout(() => requestAnimationFrame(() => resolve()), 0); }));

let root = null;
beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.clearAllMocks();
  await i18next.changeLanguage('ko');
});
afterEach(async () => {
  if (root) {
    await settleAutofocus();
    await act(async () => root.unmount());
    root = null;
  }
  await i18next.changeLanguage('en');
});

async function render(el) {
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(el); });
}
const flush = () => act(async () => {});
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const buttonIn = (scope, text) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text) ?? null;
const pmIn = (scope) => scope.querySelector('.ProseMirror');
const ctrlEnter = () => new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });

// 원문 편집기(RawMarkdownEditor)처럼 실행 취소 기록이 있는 CodeMirror 상태에서 고친다 — 글자가 바뀔 때마다 onChange(글자, 편집 기록).
// 맨 앞에 prefix → 전체 선택 삭제 → 실행 취소(삭제만 취소). typed = 삭제 직전 글자, restored = 실행 취소 뒤 글자
async function prefixDeleteUndo(prefix) {
  let state = EditorState.create({ doc: RAW.props.value, extensions: [history()] });
  const dispatch = (tr) => {
    state = tr.state;
    if (tr.docChanged) RAW.props.onChange(state.doc.toString(), tr.changes);
  };
  let typed = null;
  await act(async () => {
    dispatch(state.update({ changes: { from: 0, insert: prefix }, annotations: isolateHistory.of('full') }));
    typed = state.doc.toString();
    dispatch(state.update({ changes: { from: 0, to: state.doc.length }, annotations: isolateHistory.of('full') }));
    undo({ state, dispatch });
  });
  return { typed, restored: state.doc.toString() };
}

describe('CommentEditor — 화면의 [등록]/[취소] 버튼', () => {
  it('최상위 입력기에는 [등록]만 있고, 누르면 현재 내용을 제출한다', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    await render(<CommentEditor initialContent="<p>안녕</p>" onSubmit={onSubmit} />);
    const box = document.querySelector('.CommentEditor');
    expect(buttonIn(box, '취소')).toBeNull();
    const submit = buttonIn(box, '등록');
    expect(submit).not.toBeNull();
    await click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toBe('<p>안녕</p>');
  });

  it('빈 입력기에서 [등록]은 아무것도 보내지 않는다', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    await render(<CommentEditor onSubmit={onSubmit} />);
    const submit = buttonIn(document.querySelector('.CommentEditor'), '등록');
    expect(submit).not.toBeNull();
    await click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('답글·수정 입력기(onCancel 있음)에는 [취소]가 있고, 누르면 onCancel을 부른다', async () => {
    const onCancel = vi.fn();
    await render(<CommentEditor initialContent="<p>안녕</p>" onSubmit={vi.fn()} onCancel={onCancel} />);
    const cancel = buttonIn(document.querySelector('.CommentEditor'), '취소');
    expect(cancel).not.toBeNull();
    await click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('raw(markdown) 모드에서도 [등록]이 같은 내용을 제출한다', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    await render(<CommentEditor initialContent="<p>안녕</p>" onSubmit={onSubmit} />);
    const box = document.querySelector('.CommentEditor');
    await click(box.querySelector('.CommentEditor__RawToggle'));
    const submit = buttonIn(box, '등록');
    expect(submit).not.toBeNull();
    await click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toBe('<p>안녕</p>');
  });

  // 서버가 칩 버전이 1만 자를 넘어 본문 전체를 일반 링크로 저장한 댓글(A안). P는 실제 저장 함수의 결과다
  // (backend tests/test_reserialize_bound.py::test_raw_mode_cases_are_what_the_server_stores).
  const SERVER_CASES = JSON.parse(readFileSync(
    resolve(__dirname, '../../backend/tests/fixtures/reserialize_growth_cases.json'), 'utf8')).cases;
  for (const name of ['raw_doc_links_80', 'raw_issue_links_40']) {
    it(`수정 중 원문 모드로 바꿔 고치지 않고 [등록]해도, 원문 → 일반 모드 후 [등록]해도 1만 자 안이다: ${name}`, async () => {
      const { P } = SERVER_CASES.find((c) => c.name === name);
      for (const backToRich of [false, true]) {
        const onSubmit = vi.fn(() => Promise.resolve());
        await render(<CommentEditor initialContent={P} branchId={10} autoFocus onSubmit={onSubmit} onCancel={vi.fn()} />);
        const box = document.querySelector('.CommentEditor');
        await click(box.querySelector('.CommentEditor__RawToggle'));
        if (backToRich) await click(box.querySelector('.CommentEditor__RawToggle'));
        await click(buttonIn(box, '등록'));
        expect(onSubmit, `backToRich=${backToRich}`).toHaveBeenCalledTimes(1);
        const html = onSubmit.mock.calls[0][0];
        expect(html.length, `backToRich=${backToRich}`).toBeLessThanOrEqual(10000);
        expect(html, `backToRich=${backToRich}`).not.toMatch(/data-(issue|doc)-ref/);
        await settleAutofocus();
        await act(async () => root.unmount());
        root = null;
      }
    });

    it(`원문에서 맨 앞에 "새 문장"을 넣고 전체 삭제 → 실행 취소한 뒤 [등록]해도(원문 → 일반 모드 후도) 일반 링크 그대로·1만 자 안이다: ${name}`, async () => {
      const { P } = SERVER_CASES.find((c) => c.name === name);
      const links = (P.match(/<a /g) || []).length;
      for (const backToRich of [false, true]) {
        const onSubmit = vi.fn(() => Promise.resolve());
        await render(<CommentEditor initialContent={P} branchId={10} autoFocus onSubmit={onSubmit} onCancel={vi.fn()} />);
        const box = document.querySelector('.CommentEditor');
        await click(box.querySelector('.CommentEditor__RawToggle'));
        await prefixDeleteUndo('새 문장\n\n');
        if (backToRich) await click(box.querySelector('.CommentEditor__RawToggle'));
        await click(buttonIn(box, '등록'));
        const html = onSubmit.mock.calls[0][0];
        const at = `backToRich=${backToRich}`;
        expect(html, at).not.toMatch(/data-(issue|doc)-ref/);
        expect((html.match(/<a /g) || []).length, at).toBe(links);
        expect(html, at).toContain('새 문장');
        expect(html.length, at).toBeLessThanOrEqual(10000);
        await settleAutofocus();
        await act(async () => root.unmount());
        root = null;
      }
    });
  }

  it('같은 문서의 칩 1개와 같은 제목·주소의 일반 링크 79개: 원문 저장·원문 → 일반 모드·원문 자동 진입 모두 그대로 저장된다', async () => {
    const chip = '<span data-doc-ref="true" data-page-id="77" data-canvas-id="5" data-title="설계" data-canvas-name="제품" class="doc-ref">설계</span>';
    const link = `<a href="${window.location.origin}/canvas/5/77">설계</a>`;
    const content = `<p>${chip} ${Array(79).fill(link).join(' ')}</p>`;
    try {
      for (const mode of ['raw', 'rawThenRich', 'auto']) {
        PREFS.prefs = mode === 'auto' ? { editor_raw_mode: true } : {};
        const onSubmit = vi.fn(() => Promise.resolve());
        await render(<CommentEditor initialContent={content} branchId={10} autoFocus onSubmit={onSubmit} onCancel={vi.fn()} />);
        const box = document.querySelector('.CommentEditor');
        if (mode !== 'auto') await click(box.querySelector('.CommentEditor__RawToggle'));
        expect(box.querySelector('.CommentEditor__RawToggle--active'), `${mode}: 원문 모드`).not.toBeNull();
        if (mode === 'rawThenRich') await click(box.querySelector('.CommentEditor__RawToggle'));
        await click(buttonIn(box, '등록'));
        const html = onSubmit.mock.calls[0][0];
        expect((html.match(/data-doc-ref=/g) || []).length, `${mode}: 칩`).toBe(1);
        expect((html.match(/<a [^>]*href="[^"]*\/canvas\/5\/77"/g) || []).length, `${mode}: 일반 링크`).toBe(79);
        expect(html.indexOf('data-doc-ref'), `${mode}: 칩이 맨 앞`).toBeLessThan(html.indexOf('<a '));
        expect(html.length, `${mode}: 길이`).toBeLessThanOrEqual(10000);
        await settleAutofocus();
        await act(async () => root.unmount());
        root = null;
      }
    } finally {
      PREFS.prefs = {};
    }
  });

  it('같은 문서의 칩 줄과 일반 링크 줄: 원문에서 칩 줄을 지우거나 맨 앞에 같은 링크를 넣고 [등록]해도 나머지는 제 형태다', async () => {
    const chip = '<span data-doc-ref="true" data-page-id="77" data-canvas-id="5" data-title="설계" data-canvas-name="제품" class="doc-ref">설계</span>';
    const href = `${window.location.origin}/canvas/5/77`;
    const content = `<p>${chip}</p><p><a href="${href}">설계</a></p>`;
    // 원문 편집기의 키 입력 = 바뀐 글자 + 편집 기록(ChangeSet)
    const type = (spec) => act(async () => {
      const md = RAW.props.value;
      const changes = ChangeSet.of([spec(md)], md.length);
      RAW.props.onChange(changes.apply(Text.of(md.split('\n'))).toString(), changes);
    });
    const seq = (html) => [...html.matchAll(/<span data-doc-ref=|<a /g)].map((m) => (m[0].startsWith('<a') ? 'L' : 'C')).join('');
    const cases = [
      ['첫 줄(칩) 삭제', (md) => ({ from: 0, to: md.indexOf('\n\n') + 2 }), 'L'],
      ['맨 앞에 같은 링크 추가', () => ({ from: 0, insert: `[설계](${href})\n\n` }), 'CCL'],
    ];
    for (const [name, spec, expected] of cases) {
      const onSubmit = vi.fn(() => Promise.resolve());
      await render(<CommentEditor initialContent={content} branchId={10} autoFocus onSubmit={onSubmit} onCancel={vi.fn()} />);
      const box = document.querySelector('.CommentEditor');
      await click(box.querySelector('.CommentEditor__RawToggle'));
      await type(spec);
      await click(buttonIn(box, '등록'));
      expect(seq(onSubmit.mock.calls[0][0]), name).toBe(expected);
      await settleAutofocus();
      await act(async () => root.unmount());
      root = null;
    }
  });

  it('원문에서 맨 앞에 글을 넣고 전체 삭제 → 실행 취소한 뒤 [등록]해도 되살린 칩·일반 링크가 제 형태다', async () => {
    const chip = '<span data-doc-ref="true" data-page-id="77" data-canvas-id="5" data-title="설계" data-canvas-name="제품" class="doc-ref">설계</span>';
    const href = `${window.location.origin}/canvas/5/77`;
    const content = `<p>${chip}</p><p><a href="${href}">설계</a></p>`;
    const seq = (html) => [...html.matchAll(/<span data-doc-ref=|<a /g)].map((m) => (m[0].startsWith('<a') ? 'L' : 'C')).join('');
    const cases = [
      ['맨 앞에 "새 문장"과 빈 줄', '새 문장\n\n', 'CL'],
      ['맨 앞에 같은 링크와 빈 줄(새 링크는 칩)', `[설계](${href})\n\n`, 'CCL'],
    ];
    for (const [name, prefix, expected] of cases) {
      const onSubmit = vi.fn(() => Promise.resolve());
      await render(<CommentEditor initialContent={content} branchId={10} autoFocus onSubmit={onSubmit} onCancel={vi.fn()} />);
      const box = document.querySelector('.CommentEditor');
      await click(box.querySelector('.CommentEditor__RawToggle'));
      const { typed, restored } = await prefixDeleteUndo(prefix);
      expect(restored, `${name}: 삭제만 취소`).toBe(typed);
      await click(buttonIn(box, '등록'));
      const html = onSubmit.mock.calls[0][0];
      expect(seq(html), name).toBe(expected);
      if (!prefix.startsWith('[')) expect(html, name).toContain('새 문장');
      await settleAutofocus();
      await act(async () => root.unmount());
      root = null;
    }
  });

  it('영문 locale에서는 Submit/Cancel로 보인다', async () => {
    await i18next.changeLanguage('en');
    await render(<CommentEditor initialContent="<p>hi</p>" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const box = document.querySelector('.CommentEditor');
    expect(buttonIn(box, 'Submit')).not.toBeNull();
    expect(buttonIn(box, 'Cancel')).not.toBeNull();
  });

  it('Cmd/Ctrl+Enter 단축키는 그대로 제출한다', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    await render(<CommentEditor initialContent="<p>안녕</p>" onSubmit={onSubmit} />);
    await act(async () => { pmIn(document).dispatchEvent(ctrlEnter()); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toBe('<p>안녕</p>');
  });

  it('raw(markdown) 모드의 Cmd/Ctrl+Enter도 그대로 제출한다', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    await render(<CommentEditor initialContent="<p>안녕</p>" onSubmit={onSubmit} />);
    const box = document.querySelector('.CommentEditor');
    await click(box.querySelector('.CommentEditor__RawToggle'));
    // raw 편집기를 감싼 캡처 래퍼 — CodeMirror보다 먼저 단축키를 잡는 지점
    const rawWrapper = box.firstElementChild;
    await act(async () => { rawWrapper.dispatchEvent(ctrlEnter()); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toBe('<p>안녕</p>');
  });

  it('제출이 거절되면 입력기 아래에 이유를 보이고 초안과 [등록]을 되살린다', async () => {
    const onSubmit = vi.fn(() => Promise.reject(
      Object.assign(new Error('NOT_BRANCH_MEMBER'), { code: 'NOT_BRANCH_MEMBER', category: 'forbidden' }),
    ));
    await render(<CommentEditor initialContent="<p>안녕</p>" onSubmit={onSubmit} />);
    const box = document.querySelector('.CommentEditor');
    const submit = buttonIn(box, '등록');
    expect(submit).not.toBeNull();
    await click(submit);
    await flush();
    expect(box.textContent).toContain('이 브랜치의 멤버가 아니에요.');
    expect(pmIn(box).editor.getHTML()).toBe('<p>안녕</p>');
    expect(buttonIn(box, '등록').disabled).toBe(false);
  });

  it('제출 중에는 [등록]·[취소]가 잠기고, [취소]를 눌러도 닫히지 않는다', async () => {
    let resolveSubmit;
    const onSubmit = vi.fn(() => new Promise((r) => { resolveSubmit = r; }));
    const onCancel = vi.fn();
    await render(<CommentEditor initialContent="<p>안녕</p>" onSubmit={onSubmit} onCancel={onCancel} />);
    const box = document.querySelector('.CommentEditor');
    await click(buttonIn(box, '등록'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(buttonIn(box, '등록').disabled).toBe(true);
    expect(buttonIn(box, '취소').disabled).toBe(true);
    await click(buttonIn(box, '취소'));
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => { resolveSubmit(); });
    expect(buttonIn(box, '취소').disabled).toBe(false);
  });

  it('코드 매핑이 없는 실패(네트워크 등)는 일반 안내 문구로 보인다', async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error('Network Error')));
    await render(<CommentEditor initialContent="<p>안녕</p>" onSubmit={onSubmit} />);
    const box = document.querySelector('.CommentEditor');
    await act(async () => { pmIn(box).dispatchEvent(ctrlEnter()); });
    await flush();
    expect(box.textContent).toContain('댓글을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  });
});

describe('TaskCommentSection — 등록 실패가 화면에 보이고 초안이 남는다', () => {
  beforeEach(() => {
    axios.get.mockResolvedValue({ data: { status: true, comments: COMMENTS } });
  });
  const mount = () => render(
    <TaskCommentSection branchId={7} taskId={42} members={[]} currentUserId={ME.user_id} />,
  );

  it('최상위 댓글: 서버가 거절하면 입력기 아래에 이유가 보이고 초안이 남는다', async () => {
    axios.post.mockResolvedValue(fail('TASK_NOT_FOUND', 'not_found'));
    await mount();
    const composer = document.querySelector('.TaskCommentSection__Composer');
    await act(async () => { pmIn(composer).editor.commands.setContent('<p>새 댓글</p>'); });
    // 수정 전에도 있던 단축키 경로로 제출 — 실패가 콘솔에만 남던 결함을 고정한다
    await act(async () => { pmIn(composer).dispatchEvent(ctrlEnter()); });
    await flush();
    expect(axios.post).toHaveBeenCalledWith(BASE, { content: '<p>새 댓글</p>', parent_comment_id: null });
    expect(composer.textContent).toContain('대상을 찾을 수 없어요.');
    expect(pmIn(composer).editor.getHTML()).toBe('<p>새 댓글</p>');
  });

  it('최상위 댓글: 분류가 아닌 코드별 문구를 보이고, 다시 [등록]하면 이전 문구를 지운다', async () => {
    // NOT_BRANCH_MEMBER는 errors.*에 문구가 있다 — 훅이 code를 빠뜨리면 분류(forbidden) 문구로 떨어진다
    axios.post.mockResolvedValueOnce(fail('NOT_BRANCH_MEMBER', 'forbidden'));
    await mount();
    const composer = document.querySelector('.TaskCommentSection__Composer');
    await act(async () => { pmIn(composer).editor.commands.setContent('<p>새 댓글</p>'); });
    await click(buttonIn(composer, '등록'));
    await flush();
    expect(composer.textContent).toContain('이 브랜치의 멤버가 아니에요.');
    expect(composer.textContent).not.toContain('권한이 없어요.');

    // 재시도: 응답을 기다리는 동안 이전 실패 문구는 지워지고 [등록]은 잠긴다
    let resolvePost;
    axios.post.mockReturnValueOnce(new Promise((r) => { resolvePost = r; }));
    await click(buttonIn(composer, '등록'));
    expect(composer.textContent).not.toContain('이 브랜치의 멤버가 아니에요.');
    expect(buttonIn(composer, '등록').disabled).toBe(true);
    await act(async () => { resolvePost({ data: { status: true, comment: { comment_id: 32 } } }); });
    await flush();
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(pmIn(composer).editor.isEmpty).toBe(true);
  });

  it('최상위 댓글: [등록]으로 성공하면 입력기가 비워진다', async () => {
    axios.post.mockResolvedValue({ data: { status: true, comment: { comment_id: 30 } } });
    await mount();
    const composer = document.querySelector('.TaskCommentSection__Composer');
    await act(async () => { pmIn(composer).editor.commands.setContent('<p>새 댓글</p>'); });
    const submit = buttonIn(composer, '등록');
    expect(submit).not.toBeNull();
    await click(submit);
    await flush();
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(pmIn(composer).editor.isEmpty).toBe(true);
  });

  it('답글: 서버가 거절하면 답글 입력기가 닫히지 않고 이유를 보인다', async () => {
    axios.post.mockResolvedValue(fail('PARENT_DELETED', 'conflict'));
    await mount();
    const item = document.getElementById('comment-10');
    await click(item.querySelector('button[title="답글"]'));
    const composer = item.querySelector('.CommentItem__ReplyComposer');
    expect(composer).not.toBeNull();
    await act(async () => { pmIn(composer).dispatchEvent(ctrlEnter()); });
    await flush();
    expect(axios.post).toHaveBeenCalledWith(BASE, expect.objectContaining({ parent_comment_id: 10 }));
    const still = item.querySelector('.CommentItem__ReplyComposer');
    expect(still).not.toBeNull();
    expect(still.textContent).toContain('이미 처리됐거나 충돌이 있어요.');
  });

  it('답글: [취소]로 닫고, [등록]으로 성공하면 입력기가 닫힌다', async () => {
    axios.post.mockResolvedValue({ data: { status: true, comment: { comment_id: 31 } } });
    await mount();
    const item = document.getElementById('comment-10');
    await click(item.querySelector('button[title="답글"]'));
    const cancel = buttonIn(item.querySelector('.CommentItem__ReplyComposer'), '취소');
    expect(cancel).not.toBeNull();
    await click(cancel);
    expect(item.querySelector('.CommentItem__ReplyComposer')).toBeNull();

    await click(item.querySelector('button[title="답글"]'));
    await click(buttonIn(item.querySelector('.CommentItem__ReplyComposer'), '등록'));
    await flush();
    expect(axios.post).toHaveBeenCalledWith(BASE, expect.objectContaining({ parent_comment_id: 10 }));
    expect(item.querySelector('.CommentItem__ReplyComposer')).toBeNull();
  });

  it('수정: [취소]로 편집을 닫고, [등록]으로 저장하면 편집이 닫힌다', async () => {
    axios.patch.mockResolvedValue({ data: { status: true, comment: { comment_id: 20 } } });
    await mount();
    const item = document.getElementById('comment-20');
    await click(item.querySelector('button[title="수정"]'));
    const cancel = buttonIn(item, '취소');
    expect(cancel).not.toBeNull();
    await click(cancel);
    expect(pmIn(item)).toBeNull();

    await click(item.querySelector('button[title="수정"]'));
    await click(buttonIn(item, '등록'));
    await flush();
    expect(axios.patch).toHaveBeenCalledWith(`${BASE}/20`, { content: '<p>내 댓글</p>' });
    expect(pmIn(item)).toBeNull();
  });

  it('수정: 서버가 거절하면 편집기가 남고 이유를 보인다', async () => {
    axios.patch.mockResolvedValue(fail('NOT_AUTHOR', 'forbidden'));
    await mount();
    const item = document.getElementById('comment-20');
    await click(item.querySelector('button[title="수정"]'));
    await act(async () => { pmIn(item).dispatchEvent(ctrlEnter()); });
    await flush();
    expect(axios.patch).toHaveBeenCalledTimes(1);
    expect(pmIn(item)).not.toBeNull();
    expect(item.textContent).toContain('권한이 없어요.');
  });
});
