import { useImperativeHandle, forwardRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent } from '@tiptap/react';
import CanvasEditorToolbar from '@/components/Canvas/CanvasEditorToolbar';
import { useEditorRefHydration } from '@/library/refHydration';
import { buildIssueEditorExtensions } from './issueEditorExtensions';
import { buildMarkdownExtensions } from '@/library/markdownCodec';
import { MarkdownClipboardExtension } from '@/components/Canvas/extensions/MarkdownClipboardExtension';
import RawMarkdownEditor from '@/components/common/RawMarkdownEditor';
import RawModeBadge from '@/components/common/RawModeBadge';
import { useRawMode } from '@/library/rawMode';
import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';

const IssueEditor = forwardRef(({ content, placeholder, minHeight = 150, branchId, onChange, rawModeEnabled = false }, ref) => {
  const { t } = useTranslation();
  const extensions = useMemo(
    () => buildMarkdownExtensions([...buildIssueEditorExtensions({ placeholder, branchId }), MarkdownClipboardExtension]),
    [placeholder, branchId]
  );

  const editor = useEditor({
    coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS,
    immediatelyRender: false,
    extensions,
    content: content || '',
    onUpdate: ({ editor }) => onChange?.(editor.isEmpty),
  });

  // 칩 하이드레이션: 마운트 직후 + 탭 내 태스크 변경 시
  useEditorRefHydration(editor);

  const {
    isRaw, isRawRef, rawText, session, warnings, parseError,
    handleRawChange, toggleRaw, parseCurrentRaw, isRawEmpty, resetRaw,
  } = useRawMode(editor, extensions, rawModeEnabled);

  useImperativeHandle(ref, () => ({
    getHTML: () => {
      if (isRawRef.current) {
        const res = parseCurrentRaw();
        // 방어: 파싱 실패는 throw 전파 — 호출부(CreateIssuePage:22-40의 try/catch 등)가
        // 저장을 차단한다. ''를 돌려주면 본문이 조용히 비워진다.
        if (!res.ok) throw new Error('raw markdown parse failed');
        return res.html || '';
      }
      return editor?.getHTML() || '';
    },
    isEmpty: () => (isRawRef.current ? isRawEmpty() : (editor?.isEmpty ?? true)),
    clearContent: () => {
      if (isRawRef.current) resetRaw('');
      else editor?.commands.clearContent();
    },
    focus: () => { if (!isRawRef.current) editor?.commands.focus(); }, // raw면 no-op (CodeMirror 클릭 포커스)
  }), [editor, isRawRef, parseCurrentRaw, isRawEmpty, resetRaw]);

  if (!editor) return null;

  return (
    <div className="TaskDescEditor">
      <CanvasEditorToolbar
        editor={editor}
        rawModeEnabled={rawModeEnabled}
        rawModeActive={isRaw}
        onToggleRawMode={toggleRaw}
      />
      {isRaw && <RawModeBadge warnings={warnings} parseError={parseError} />}
      {isRaw && (
        <RawMarkdownEditor
          key={session}
          value={rawText}
          onChange={(text) => { handleRawChange(text); onChange?.(isRawEmpty()); }}
          placeholder={t('branchTasks.rawEditor.markdownPlaceholder', { placeholder: placeholder || t('branchTasks.rawEditor.defaultPlaceholder') })}
        />
      )}
      <div style={{ display: isRaw ? 'none' : undefined }}>
        <EditorContent editor={editor} className="TaskDescEditor__Content" style={{ minHeight }} />
      </div>
    </div>
  );
});

IssueEditor.displayName = 'IssueEditor';
export default IssueEditor;
