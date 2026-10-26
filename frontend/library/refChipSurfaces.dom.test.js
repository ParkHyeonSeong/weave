// @vitest-environment jsdom
// 태스크 설명·댓글·이슈 편집기가 서버가 저장한 이슈·문서 칩을 보존하는지
// (설계 docs/superpowers/specs/2026-10-22-ref-link-chip-ingress-design.md §5.7).
// 노드가 없으면 칩이 평문으로 깨지고 배지 글자("Open")가 제목에 붙어 저장된다.
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { htmlToMarkdown } from './markdownCodec';
import { buildTaskDescriptionExtensions } from '@/components/Branch/Tasks/taskDescriptionExtensions';
import { buildCommentEditorExtensions } from '@/components/Branch/Tasks/commentEditorExtensions';
import { buildIssueEditorExtensions } from '@/components/Branch/Tasks/issueEditorExtensions';

const ISSUE_CHIP = '<span data-issue-ref="true" data-issue-id="7" data-task-id="1031" data-branch-id="10" '
  + 'data-display-id="PRO-220" data-title="재현" data-status="open" class="issue-ref">PRO-220 재현'
  + '<span class="ref-chip__badge ref-chip__badge--open" data-ref-badge="true">Open</span></span>';
const DOC_CHIP = '<span data-doc-ref="true" data-page-id="77" data-canvas-id="5" data-title="설계" '
  + 'data-canvas-name="제품" class="doc-ref">설계</span>';
const HTML = `<p>이슈 ${ISSUE_CHIP} 문서 ${DOC_CHIP} 끝</p>`;

const SURFACES = [
  ['taskDescription', () => buildTaskDescriptionExtensions({ branchId: 10 })],
  ['comment', () => buildCommentEditorExtensions({ branchId: 10 })],
  ['issue', () => buildIssueEditorExtensions({ branchId: 10 })],
];
const tick = () => new Promise((r) => setTimeout(r, 0));

let editor;
afterEach(() => { editor?.destroy(); editor = undefined; });

describe.each(SURFACES)('%s 편집기: 이슈·문서 칩', (_name, build) => {
  it('수정창처럼 열고 자동 포커스 후 그대로 저장해도 칩이 남는다', async () => {
    editor = new Editor({ element: document.createElement('div'), extensions: build(), content: HTML, autofocus: true });
    await tick(); await tick();
    const html = editor.getHTML();
    expect(html).toContain('data-issue-ref="true" data-issue-id="7" data-task-id="1031" data-branch-id="10"');
    expect(html).toContain('data-doc-ref="true" data-page-id="77" data-canvas-id="5"');
    expect(html).not.toContain('재현Open');
  });

  it('Copy as Markdown(htmlToMarkdown)이 이슈·문서 칩을 링크로 낸다', () => {
    const md = htmlToMarkdown(HTML, build());
    expect(md).toMatch(/\[PRO-220 재현\]\([^)]*\/branch\/10\/task\/1031\/issue\/7\)/);
    expect(md).toMatch(/\[설계\]\([^)]*\/canvas\/5\/77\)/);
  });
});
