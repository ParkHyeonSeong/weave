// IssueEditor 확장 배열의 단일 진실원 (headless 소비: md 코덱·스키마 스윕)
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Highlight from '@tiptap/extension-highlight';
import { checklistExtensions } from '@/components/Canvas/extensions/checklistExtension';
import { common, createLowlight } from 'lowlight';
import CalloutExtension from '@/components/Canvas/extensions/CalloutExtension';
import TaskRefNode from '@/components/Canvas/extensions/TaskRefExtension';
import MentionNode from '@/components/Canvas/extensions/MentionExtension';
import SlashCommandsExtension from '@/components/Canvas/extensions/SlashCommandsExtension';
import { ResizableImage } from '@/components/Canvas/extensions/ResizableImageExtension';
import { createImageUploadPlugin } from '@/components/Canvas/extensions/ImageUploadPlugin';
import { createMarkdownPastePlugin } from '@/components/Canvas/extensions/MarkdownPastePlugin';
import { BookmarkPasteExtension } from '@/components/Canvas/extensions/BookmarkPastePlugin';
import MermaidExtension from '@/components/Canvas/extensions/MermaidExtension';
import { mathExtensions } from '@/components/Canvas/extensions/mathExtensions';
import WeaveLink from '@/components/Canvas/extensions/WeaveLink';

const lowlight = createLowlight(common);

const makeBaseExtensions = (placeholder) => [
  StarterKit.configure({
    codeBlock: false,
    link: false, // WeaveLink로 별도 등록(WEAVE-37 inclusive 분리) — StarterKit 번들 Link와 중복 방지
  }),
  WeaveLink.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
  Placeholder.configure({ placeholder: placeholder || 'Write something...' }),
  CodeBlockLowlight.configure({ lowlight }),
  Highlight.configure({ multicolor: true }),
  ...checklistExtensions({ nested: true }),
  CalloutExtension,
  TaskRefNode,
  SlashCommandsExtension.configure({ enabled: ['/t', '/ta', '/m'] }),
  ResizableImage,
  MermaidExtension,
  ...mathExtensions(),
];

// canvasId: 문서 댓글(AnnotationSidebar)처럼 브랜치 밖에서 쓸 때의 멘션 후보 범위(그 캔버스 멤버)
export function buildIssueEditorExtensions({ placeholder, branchId, canvasId } = {}) {
  const ext = makeBaseExtensions(placeholder);
  ext.push(MentionNode.configure({ branchId, canvasId }));
  ext.push(BookmarkPasteExtension);
  ext.push(Extension.create({
    name: 'markdownPaste',
    addProseMirrorPlugins() { return [createMarkdownPastePlugin()]; },
  }));
  if (branchId) {
    ext.push(Extension.create({
      name: 'imageUpload',
      addProseMirrorPlugins() { return [createImageUploadPlugin({ branchId })]; },
    }));
  }
  return ext;
}
