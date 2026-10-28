import { useImperativeHandle, forwardRef, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent } from '@tiptap/react';
import CanvasEditorToolbar from '@/components/Canvas/CanvasEditorToolbar';
import { useEditorRefHydration } from '@/library/refHydration';
import { buildIssueEditorExtensions } from './issueEditorExtensions';
import { buildMarkdownExtensions } from '@/library/markdownCodec';
import { MarkdownClipboardExtension } from '@/components/Canvas/extensions/MarkdownClipboardExtension';
import RawMarkdownEditor from '@/components/common/RawMarkdownEditor';
import RawModeBadge from '@/components/common/RawModeBadge';
import { useRawMode, htmlForSave } from '@/library/rawMode';
import { forgetRawAutoChipCut } from '@/components/Canvas/extensions/rawAutoChip';
import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';

// rawLimit: 이 편집기로 저장하는 경로의 서버 한도(library/contentLimits.js) — 원문 모드 A안 판정에 쓴다(없으면 판정 없음)
const IssueEditor = forwardRef(({ content, placeholder, minHeight = 150, branchId, canvasId, onChange, rawModeEnabled = false, rawLimit = null }, ref) => {
  const { t } = useTranslation();
  const richRef = useRef(null); // 원문 모드 동안 숨겨 두는 일반 모드 편집기 영역
  const extensions = useMemo(
    () => buildMarkdownExtensions([...buildIssueEditorExtensions({ placeholder, branchId, canvasId }), MarkdownClipboardExtension]),
    [placeholder, branchId, canvasId]
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
  } = useRawMode(editor, extensions, rawModeEnabled, { limit: rawLimit });

  useImperativeHandle(ref, () => ({
    getHTML: () => {
      if (isRawRef.current) {
        const res = parseCurrentRaw();
        // 방어: 파싱 실패는 throw 전파 — 호출부(CreateIssuePage:22-40의 try/catch 등)가
        // 저장을 차단한다. ''를 돌려주면 본문이 조용히 비워진다.
        if (!res.ok) throw new Error('raw markdown parse failed');
        return res.html || '';
      }
      return editor ? htmlForSave(editor, rawLimit) : ''; // 일반 모드 저장도 같은 편집에서 원문이 만든 칩은 A안
    },
    isEmpty: () => (isRawRef.current ? isRawEmpty() : (editor?.isEmpty ?? true)),
    clearContent: () => {
      if (isRawRef.current) resetRaw('');
      else editor?.commands.clearContent();
      forgetRawAutoChipCut(editor); // 저장이 끝나 비운 입력창 — 그 전에 잘라 둔 칩의 표시를 다음 글에 잇지 않는다
    },
    focus: () => { if (!isRawRef.current) editor?.commands.focus(); }, // raw면 no-op (CodeMirror 클릭 포커스)
  }), [editor, isRawRef, parseCurrentRaw, isRawEmpty, resetRaw, rawLimit]);

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
          onChange={(text, changes, userEvent, depth) => { handleRawChange(text, changes, userEvent, depth); onChange?.(isRawEmpty()); }}
          placeholder={t('branchTasks.rawEditor.markdownPlaceholder', { placeholder: placeholder || t('branchTasks.rawEditor.defaultPlaceholder') })}
          hiddenRef={richRef}
        />
      )}
      <div ref={richRef} style={{ display: isRaw ? 'none' : undefined }}>
        <EditorContent editor={editor} className="TaskDescEditor__Content" style={{ minHeight }} />
      </div>
    </div>
  );
});

IssueEditor.displayName = 'IssueEditor';
export default IssueEditor;
