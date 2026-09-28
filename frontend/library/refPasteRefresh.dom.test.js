// @vitest-environment jsdom
// 붙여넣은 ref 칩(taskRef/issueRef)이 복사 시점 스냅샷이 아니라 서버의 현재 상태로 갱신되는지 —
// 실제 등록 체인(스크럼 셀·캔버스 빌더 + markdown 코덱 + Yjs sync/undo)으로 검증한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Editor, Extension } from '@tiptap/core';
import { ySyncPlugin, yUndoPlugin, yUndoPluginKey } from 'y-prosemirror';
import { axios } from '@/library/_axios';
import { buildScrumCellExtensions } from '@/components/Scrum/scrumCellExtensions';
import { buildCanvasEditorExtensions } from '@/components/Canvas/canvasEditorExtensions';
import { buildMarkdownExtensions } from '@/library/markdownCodec';
import { MarkdownClipboardExtension } from '@/components/Canvas/extensions/MarkdownClipboardExtension';
import { WEAVE_CORE_EXTENSION_OPTIONS } from './editorCoreOptions';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), post: vi.fn() } }));

const flush = () => new Promise((r) => setTimeout(r, 0));
const raf = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// 어제 칸에서 복사해 온 칩 — 넣던 날의 '진행 중' 스냅샷을 들고 있다
const STALE_TASK = '<span data-task-ref="true" data-task-id="5" data-branch-id="1" data-display-id="WV-5" data-title="옛 제목" data-status="in_progress" data-status-label="진행 중" data-status-color="#3B82F6" data-status-category="in_progress"></span>';
const STALE_ISSUE = '<span data-issue-ref="true" data-issue-id="9" data-task-id="5" data-branch-id="1" data-display-id="WV-5" data-title="이슈 옛 제목" data-status="open"></span>';
const FRESH_TASK = { display_id: 'WV-5', title: '새 제목', status: 'done', status_label: '완료', status_color: '#16A34A', status_category: 'done' };
const refStatus = (tasks = {}, issues = {}) => ({ data: { status: true, tasks, issues, pages: {}, users: {} } });

const scrum = () => buildScrumCellExtensions({ members: [] });
const canvas = () => buildCanvasEditorExtensions({});

let disposers = [];
beforeEach(() => { axios.post.mockReset(); });
afterEach(() => {
  const errors = [];
  for (const d of disposers) { try { d(); } catch (e) { errors.push(e); } }
  disposers = [];
  document.body.innerHTML = '';
  if (errors.length) throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'teardown 실패');
});

// 프로덕션 배선(ScrumCell·CanvasCollabEditor)과 같은 구성: 빌더 + md 코덱 + 클립보드 + Yjs sync/undo
function makeYEditor(build) {
  const ydoc = new Y.Doc();
  const editor = new Editor({
    coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS,
    extensions: buildMarkdownExtensions([
      ...build(),
      MarkdownClipboardExtension,
      Extension.create({
        name: 'yjsHarness',
        addProseMirrorPlugins() { return [ySyncPlugin(ydoc.getXmlFragment('default')), yUndoPlugin()]; },
      }),
    ]),
  });
  document.body.appendChild(editor.view.dom);
  disposers.push(() => { if (!editor.isDestroyed) editor.destroy(); }, () => ydoc.destroy());
  return editor;
}

// Cmd+C와 같은 경로: 소스 에디터 문서를 PM 클립보드 HTML로 직렬화한다(칩 attrs가 data-*로 실린다)
function copyHtml(build, html) {
  const src = new Editor({
    coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS,
    extensions: buildMarkdownExtensions([...build(), MarkdownClipboardExtension]),
    content: html,
  });
  disposers.push(() => src.destroy());
  return src.view.serializeForClipboard(src.state.doc.slice(0, src.state.doc.content.size)).dom.innerHTML;
}

const pasteEvent = ({ html = '' }) => ({
  clipboardData: { getData: (type) => (type === 'text/html' ? html : '') },
  preventDefault() {},
});
const pasteHtml = (editor, html) => editor.view.pasteHTML(html, pasteEvent({ html }));

const refAttrs = (editor, type) => {
  const out = [];
  editor.state.doc.descendants((n) => { if (n.type.name === type) out.push(n.attrs); });
  return out;
};

describe('붙여넣은 칩을 서버 현재 상태로 갱신', () => {
  it('스크럼 셀: 다른 칸에서 복사한 칩이 현재 상태·제목으로 바뀐다', async () => {
    axios.post.mockResolvedValue(refStatus({ 5: FRESH_TASK }));
    const editor = makeYEditor(scrum);
    pasteHtml(editor, copyHtml(scrum, `<p>${STALE_TASK}</p>`));
    expect(refAttrs(editor, 'taskRef')[0].status).toBe('in_progress'); // 붙는 순간은 스냅샷
    await flush();
    expect(axios.post).toHaveBeenCalledWith('/ref-status', { task_ids: [5], issue_ids: [] });
    expect(refAttrs(editor, 'taskRef')[0]).toMatchObject({
      status: 'done', statusLabel: '완료', statusColor: '#16A34A', statusCategory: 'done', title: '새 제목', displayId: 'WV-5',
    });
  });

  it('갱신은 undo 이력에 남지 않는다 — 응답이 늦어도 Cmd+Z 한 번에 붙여넣기 전체가 취소된다', async () => {
    let respond;
    axios.post.mockReturnValue(new Promise((r) => { respond = r; }));
    const editor = makeYEditor(scrum);
    editor.view.focus();
    await raf();
    const before = editor.getHTML();
    pasteHtml(editor, copyHtml(scrum, `<p>${STALE_TASK}</p>`));
    await flush();
    // 응답이 undo 캡처 창(500ms)보다 늦게 온 상황 — 캡처를 끊고 나서 응답한다
    yUndoPluginKey.getState(editor.state).undoManager.stopCapturing();
    respond(refStatus({ 5: FRESH_TASK }));
    await flush();
    expect(refAttrs(editor, 'taskRef')[0].status).toBe('done');
    editor.commands.undo();
    await raf();
    expect(refAttrs(editor, 'taskRef')).toEqual([]);
    expect(editor.getHTML()).toBe(before);
  });

  it('칩이 없는 붙여넣기는 조회하지 않는다', async () => {
    const editor = makeYEditor(scrum);
    pasteHtml(editor, '<p>그냥 글</p>');
    await flush();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('응답에 없는 칩(권한 밖·삭제)과 조회 실패는 스냅샷을 그대로 둔다', async () => {
    const editor = makeYEditor(scrum);
    axios.post.mockResolvedValueOnce(refStatus({}));
    pasteHtml(editor, copyHtml(scrum, `<p>${STALE_TASK}</p>`));
    await flush();
    axios.post.mockRejectedValueOnce(new Error('network'));
    pasteHtml(editor, copyHtml(scrum, `<p>${STALE_TASK}</p>`));
    await flush();
    expect(refAttrs(editor, 'taskRef').map((a) => a.status)).toEqual(['in_progress', 'in_progress']);
  });

  it('응답 전에 에디터가 닫히면 닫힌 에디터를 건드리지 않는다', async () => {
    let respond;
    axios.post.mockReturnValue(new Promise((r) => { respond = r; }));
    const editor = makeYEditor(scrum);
    pasteHtml(editor, copyHtml(scrum, `<p>${STALE_TASK}</p>`));
    const dispatch = vi.spyOn(editor.view, 'dispatch');
    editor.destroy();
    respond(refStatus({ 5: FRESH_TASK }));
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('캔버스: 태스크·이슈 칩을 함께 갱신한다', async () => {
    axios.post.mockResolvedValue(refStatus({ 5: FRESH_TASK }, { 9: { title: '이슈 새 제목', status: 'closed' } }));
    const editor = makeYEditor(canvas);
    pasteHtml(editor, copyHtml(canvas, `<p>${STALE_TASK} ${STALE_ISSUE}</p>`));
    await flush();
    expect(axios.post).toHaveBeenCalledWith('/ref-status', { task_ids: [5], issue_ids: [9] });
    expect(refAttrs(editor, 'taskRef')[0].status).toBe('done');
    expect(refAttrs(editor, 'issueRef')[0]).toMatchObject({ status: 'closed', title: '이슈 새 제목' });
  });
});
