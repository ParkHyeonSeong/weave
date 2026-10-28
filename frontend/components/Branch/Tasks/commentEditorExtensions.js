// CommentEditor 확장 배열의 단일 진실원 (headless 소비: md 코덱·스키마 스윕)
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import MentionNode from '@/components/Canvas/extensions/MentionExtension';
import TaskRefNode from '@/components/Canvas/extensions/TaskRefExtension';
import IssueRefNode from '@/components/Canvas/extensions/IssueRefExtension';
import DocRefNode from '@/components/Canvas/extensions/DocRefExtension';
import { RawAutoChipAttribute } from '@/components/Canvas/extensions/rawAutoChip';
import { ResizableImage } from '@/components/Canvas/extensions/ResizableImageExtension';
import { createImageUploadPlugin } from '@/components/Canvas/extensions/ImageUploadPlugin';
import SlashCommandsExtension from '@/components/Canvas/extensions/SlashCommandsExtension';
import { BookmarkPasteExtension } from '@/components/Canvas/extensions/BookmarkPastePlugin';
import { mathExtensions } from '@/components/Canvas/extensions/mathExtensions';
import { createMarkdownPastePlugin } from '@/components/Canvas/extensions/MarkdownPastePlugin';
import WeaveLink from '@/components/Canvas/extensions/WeaveLink';

const lowlight = createLowlight(common);

export function buildCommentEditorExtensions({ placeholder = 'Add a comment...', branchId } = {}) {
  const ext = [
    StarterKit.configure({
      codeBlock: false,
      link: false, // WeaveLink로 별도 등록(WEAVE-37 inclusive 분리) — StarterKit 번들 Link와 중복 방지
    }),
    WeaveLink.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
    Placeholder.configure({ placeholder }),
    CodeBlockLowlight.configure({ lowlight }),
    MentionNode.configure({ branchId }),
    TaskRefNode,
    IssueRefNode, // 서버가 저장한 이슈·문서 칩 보존(슬래시 명령은 추가 안 함)
    DocRefNode,
    RawAutoChipAttribute, // 같은 편집 동안 원문이 만든 칩 표시(저장 HTML에는 없음) — 원문 모드 A안
    SlashCommandsExtension.configure({ enabled: ['/t', '/ta', '/m'] }),
    ResizableImage,
    BookmarkPasteExtension,
    ...mathExtensions(),
    Extension.create({
      name: 'markdownPaste',
      addProseMirrorPlugins() { return [createMarkdownPastePlugin()]; },
    }),
  ];
  if (branchId) {
    ext.push(Extension.create({
      name: 'imageUpload',
      addProseMirrorPlugins() { return [createImageUploadPlugin({ branchId })]; },
    }));
  }
  return ext;
}
