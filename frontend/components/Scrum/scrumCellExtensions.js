// ScrumCell 확장 배열의 단일 진실원 (Yjs 제외 — 컴포넌트가 런타임에 덧붙임)
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import WeaveLink from '@/components/Canvas/extensions/WeaveLink';
import YUndoRedo from '@/components/Canvas/extensions/YUndoRedo';
import { checklistExtensions } from '@/components/Canvas/extensions/checklistExtension';
import TaskRefNode from '@/components/Canvas/extensions/TaskRefExtension';
import DocRefNode from '@/components/Canvas/extensions/DocRefExtension';
import MentionNode from '@/components/Canvas/extensions/MentionExtension';
import SlashCommandsExtension from '@/components/Canvas/extensions/SlashCommandsExtension';
import { BookmarkPasteExtension } from '@/components/Canvas/extensions/BookmarkPastePlugin';
import { RefPasteRefreshExtension } from '@/components/Canvas/extensions/RefPasteRefreshExtension';
import { mathExtensions } from '@/components/Canvas/extensions/mathExtensions';
import { createMarkdownPastePlugin } from '@/components/Canvas/extensions/MarkdownPastePlugin';

export function buildScrumCellExtensions({ placeholder, members } = {}) {
  return [
    StarterKit.configure({
      // undoRedo: v3 옵션명(구 history는 무효 no-op) — yUndoPlugin과의 이중 undo를 실제로 차단
      undoRedo: false, codeBlock: false, heading: false, blockquote: false, horizontalRule: false,
      link: false, // WeaveLink로 별도 등록(WEAVE-37 inclusive 분리) — StarterKit 번들 Link와 중복 방지
    }),
    WeaveLink.configure({
      openOnClick: false,
      autolink: false, // 기존 제품 동작 보존(스크럼 셀은 자동링크 없음) — inclusive는 이제 옵션과 무관
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    YUndoRedo, // undoRedo:false로 사라진 undo/redo 명령·Mod-z 키맵을 Yjs 인지 방식으로 복원
    Placeholder.configure({ placeholder: placeholder || '' }),
    ...checklistExtensions({ nested: false }),
    TaskRefNode,
    DocRefNode,
    MentionNode.configure({ members }),
    SlashCommandsExtension.configure({ enabled: ['/t', '/ta', '/d', '/m'] }),
    BookmarkPasteExtension,
    RefPasteRefreshExtension, // 붙여넣은 칩 상태를 서버 현재값으로 갱신
    ...mathExtensions(),
    Extension.create({
      name: 'markdownPaste',
      addProseMirrorPlugins() { return [createMarkdownPastePlugin()]; },
    }),
  ];
}
