// CanvasCollabEditor 확장 배열의 단일 진실원.
// 컴포넌트는 여기에 Yjs 확장(런타임 ydoc/provider 필요)만 덧붙인다.
// headless 소비자(md 코덱 S1 Copy-as-Markdown·스키마 스윕 테스트)도 이 배열을 쓴다.
import { Extension } from '@tiptap/core';
import i18next from '@/library/i18n';
import StarterKit from '@tiptap/starter-kit';
import WeaveLink from './extensions/WeaveLink';
import YUndoRedo from './extensions/YUndoRedo';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { common, createLowlight } from 'lowlight';
import { TableCellWithBgColor, TableHeaderWithBgColor } from './extensions/TableCellExtension';
import { checklistExtensions } from './extensions/checklistExtension';
import { mathExtensions } from './extensions/mathExtensions';
import CalloutExtension from './extensions/CalloutExtension';
import TaskRefNode from './extensions/TaskRefExtension';
import MentionNode from './extensions/MentionExtension';
import DocRefNode from './extensions/DocRefExtension';
import IssueRefNode from './extensions/IssueRefExtension';
import SlashCommandsExtension from './extensions/SlashCommandsExtension';
import { ResizableImage } from './extensions/ResizableImageExtension';
import { createImageUploadPlugin } from './extensions/ImageUploadPlugin';
import BookmarkNode from './extensions/BookmarkExtension';
import { BookmarkPasteExtension } from './extensions/BookmarkPastePlugin';
import { createMarkdownPastePlugin } from './extensions/MarkdownPastePlugin';
import MermaidExtension from './extensions/MermaidExtension';

const lowlight = createLowlight(common);

export function buildCanvasEditorExtensions({ canvasId } = {}) {
  const ext = [
    StarterKit.configure({
      codeBlock: false,
      // undoRedo: v3 옵션명(구 history는 무효 no-op) — yUndoPlugin(CanvasCollabEditor)과의 이중 undo 차단
      undoRedo: false,
      link: false, // WeaveLink로 별도 등록(WEAVE-37 inclusive 분리) — StarterKit 번들 Link와 중복 방지
    }),
    WeaveLink.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    YUndoRedo, // undoRedo:false로 사라진 undo/redo 명령·Mod-z 키맵을 Yjs 인지 방식으로 복원
    ResizableImage,
    Placeholder.configure({ placeholder: () => i18next.t('canvas.editor.placeholder') }),
    CodeBlockLowlight.configure({ lowlight }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCellWithBgColor,
    TableHeaderWithBgColor,
    TextAlign.configure({ types: ['heading', 'paragraph', 'image'] }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    ...checklistExtensions({ nested: true }),
    CalloutExtension,
    TaskRefNode,
    MentionNode.configure({ canvasId }),
    DocRefNode,
    IssueRefNode,
    SlashCommandsExtension.configure({ enabled: ['/t', '/ta', '/d', '/i', '/m'] }),
    BookmarkNode,
    BookmarkPasteExtension,
    Extension.create({
      name: 'markdownPaste',
      addProseMirrorPlugins() { return [createMarkdownPastePlugin()]; },
    }),
    ...mathExtensions(),
    MermaidExtension,
  ];
  if (canvasId) {
    ext.push(Extension.create({
      name: 'imageUpload',
      addProseMirrorPlugins() { return [createImageUploadPlugin({ canvasId })]; },
    }));
  }
  return ext;
}
