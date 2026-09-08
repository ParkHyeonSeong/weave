import { useState, useEffect, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
import CanvasEditorToolbar from './CanvasEditorToolbar';
import TableBubbleMenu from './TableBubbleMenu';
import LinkHoverPopover from '@/components/shared/LinkHoverPopover';
import { useDateFormat } from '@/hooks/useDateFormat';
import { getBaseURL } from '@/library/_axios';
import { buildAvatarDOM } from '@/library/userAvatar';
import { useEditorRefHydration } from '@/library/refHydration';
import { buildCanvasEditorExtensions } from './canvasEditorExtensions';
import { buildMarkdownExtensions } from '@/library/markdownCodec';
import { MarkdownClipboardExtension } from './extensions/MarkdownClipboardExtension';
import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';

const MAX_PLAIN_TEXT_LENGTH = 60000;

// Wrapper: ydoc/provider가 준비되면 Inner를 마운트
export default function CanvasCollabEditor(props) {
  if (!props.ydoc || !props.provider) return null;
  return <CollabEditorInner {...props} />;
}

// Inner: ydoc/provider가 항상 존재하는 상태에서 hooks 호출
function CollabEditorInner({
  ydoc,
  provider,
  canvasId,
  initialContent,
  hasExistingYjsState,
  onHtmlChange,
}) {
  const [charCount, setCharCount] = useState(0);
  // 글자 수 표기도 사용자 언어를 따른다(브라우저 기본 locale이 아니라).
  const { formatNumber } = useDateFormat();
  const isOverLimit = charCount > MAX_PLAIN_TEXT_LENGTH;

  const extensions = useMemo(() => {
    const fragment = ydoc.getXmlFragment('default');

    // 커스텀 커서 빌더: 볼드 캐럿 + 공용 아바타(buildAvatarDOM)
    const cursorBuilder = (user) => {
      const cursor = document.createElement('span');
      cursor.classList.add('collaboration-cursor__caret');
      cursor.style.borderColor = user.color;

      const avatar = buildAvatarDOM(user, getBaseURL());
      avatar.classList.add('collaboration-cursor__avatar');
      cursor.appendChild(avatar);

      return cursor;
    };

    // y-prosemirror 플러그인을 직접 사용 (TipTap wrapper 버전 불일치 회피)
    const YjsExtension = Extension.create({
      name: 'yjs',
      addProseMirrorPlugins() {
        return [
          ySyncPlugin(fragment),
          yCursorPlugin(provider.awareness, { cursorBuilder }),
          yUndoPlugin(),
        ];
      },
    });

    return buildMarkdownExtensions([
      ...buildCanvasEditorExtensions({ canvasId }),
      MarkdownClipboardExtension,
      YjsExtension,
    ]);
  }, [ydoc, provider, canvasId]);

  const editor = useEditor({
    coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS,
    immediatelyRender: false,
    extensions,
    onUpdate: ({ editor }) => {
      setCharCount(editor.getText().length);
      if (onHtmlChange) {
        onHtmlChange(editor.getHTML());
      }
    },
  });

  // 기존 HTML content를 Yjs doc에 로드 (yjs_state가 없는 기존 페이지용)
  useEffect(() => {
    if (!editor || !initialContent || hasExistingYjsState) return;
    const fragment = ydoc.getXmlFragment('default');
    if (fragment.length === 0) {
      editor.commands.setContent(initialContent);
    }
  }, [editor, initialContent, hasExistingYjsState, ydoc]);

  // 칩 하이드레이션: 마운트 직후(yjs 초기 동기화 대기) + 탭 내 태스크 변경 시
  useEditorRefHydration(editor, 1000);

  if (!editor) return null;

  return (
    <div className="CanvasEditor">
      <CanvasEditorToolbar editor={editor} />
      <TableBubbleMenu editor={editor} />
      <LinkHoverPopover editor={editor} />
      <EditorContent editor={editor} className="CanvasEditor__Content" />
      <div className={`CanvasEditor__Counter ${isOverLimit ? 'CanvasEditor__Counter--over' : ''}`}>
        {formatNumber(charCount)} / {formatNumber(MAX_PLAIN_TEXT_LENGTH)}
      </div>
    </div>
  );
}
