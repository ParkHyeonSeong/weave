import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent } from '@tiptap/react';
import { CodeXml } from 'lucide-react';
import { useEditorRefHydration } from '@/library/refHydration';
import { buildCommentEditorExtensions } from './commentEditorExtensions';
import { buildMarkdownExtensions } from '@/library/markdownCodec';
import { MarkdownClipboardExtension } from '@/components/Canvas/extensions/MarkdownClipboardExtension';
import RawMarkdownEditor from '@/components/common/RawMarkdownEditor';
import RawModeBadge from '@/components/common/RawModeBadge';
import { useRawMode } from '@/library/rawMode';
import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';

/**
 * Lightweight TipTap editor for task comments.
 *
 * Props:
 *   - initialContent: string (HTML)
 *   - placeholder: string
 *   - branchId: number (enables image upload)
 *   - autoFocus: bool
 *   - rawAutoEnter: bool (default true) — false skips raw-mode auto-entry from ui_prefs
 *     for this instance (manual toggle still allowed); see CommentItem.js reply prefill
 *   - onSubmit(html): called on Cmd/Ctrl+Enter; receives current HTML
 *   - onCancel(): called on Esc
 */
export default function CommentEditor({
  initialContent = '',
  placeholder,
  branchId,
  autoFocus = false,
  rawAutoEnter = true,
  onSubmit,
  onCancel,
}) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('branchTasks.commentEditor.placeholder');
  // keep latest callbacks in refs so the editor's keydown handler always sees current values
  const submitRef = useRef(onSubmit);
  const cancelRef = useRef(onCancel);
  const editorRef = useRef(null);
  // 제출 중 가드: keydown 연타는 리렌더보다 빠르므로 ref가 진실원천, state는 표시용
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { submitRef.current = onSubmit; }, [onSubmit]);
  useEffect(() => { cancelRef.current = onCancel; }, [onCancel]);

  const extensions = useMemo(
    () => buildMarkdownExtensions([...buildCommentEditorExtensions({ placeholder: resolvedPlaceholder, branchId }), MarkdownClipboardExtension]),
    [resolvedPlaceholder, branchId]
  );

  // 제출 공용 경로 — WYSIWYG(handleKeyDown)과 raw(Cmd+Enter) 양쪽이 사용.
  // 가드/복구 시맨틱은 기존 인라인 로직 그대로 (submittingRef가 진실원천).
  const submitHtml = useCallback((html) => {
    const ed = editorRef.current;
    if (submittingRef.current || html == null) return;
    submittingRef.current = true;
    setSubmitting(true);
    if (ed && !ed.isDestroyed) ed.setEditable(false);
    const finish = () => {
      submittingRef.current = false;
      // 성공 시 부모가 remount/close로 에디터를 unmount함 → destroyed면 no-op
      if (ed && !ed.isDestroyed) {
        ed.setEditable(true);
        setSubmitting(false);
      }
    };
    try {
      Promise.resolve(submitRef.current?.(html)).finally(finish);
    } catch {
      // onSubmit이 동기 throw해도 가드가 잠기지 않게 즉시 복구
      finish();
    }
  }, []);
  const submitHtmlRef = useRef(submitHtml);
  useEffect(() => { submitHtmlRef.current = submitHtml; }, [submitHtml]);

  const editor = useEditor({
    coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS,
    immediatelyRender: false,
    extensions,
    content: initialContent,
    autofocus: autoFocus,
    editorProps: {
      handleKeyDown(_view, event) {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          const ed = editorRef.current;
          if (!ed || ed.isEmpty) return true;
          submitHtmlRef.current(ed.getHTML());
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!submittingRef.current) cancelRef.current?.();
          return true;
        }
        return false;
      },
    },
  }, [extensions]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // 칩 하이드레이션: 마운트 직후 + 탭 내 태스크 변경 시
  useEditorRefHydration(editor);

  const {
    isRaw, rawText, session, warnings, parseError,
    handleRawChange, toggleRaw, parseCurrentRaw, isRawEmpty,
  } = useRawMode(editor, extensions, true, { autoEnter: rawAutoEnter });

  // raw 모드 Cmd+Enter/Esc — CodeMirror defaultKeymap의 Mod-Enter(빈 줄 삽입)보다
  // 먼저 잡아야 하므로 조상 캡처 단계에서 가로챈다(캡처는 대상 리스너보다 선행).
  const handleRawKeyDown = (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      if (isRawEmpty()) return; // 기존 ed.isEmpty 차단과 동일
      const res = parseCurrentRaw();
      if (!res.ok || res.html == null) return; // 파싱 실패(방어) — 제출 차단 + 배지
      submitHtml(res.html);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!submittingRef.current) cancelRef.current?.();
    }
  };

  if (!editor) return null;
  return (
    <div className={`CommentEditor${submitting ? ' CommentEditor--submitting' : ''}`}>
      {isRaw && <RawModeBadge warnings={warnings} parseError={parseError} />}
      {isRaw && (
        <div onKeyDownCapture={handleRawKeyDown}>
          <RawMarkdownEditor
            key={session}
            value={rawText}
            onChange={handleRawChange}
            placeholder={t('branchTasks.rawEditor.markdownPlaceholder', { placeholder: resolvedPlaceholder })}
          />
        </div>
      )}
      <div style={{ display: isRaw ? 'none' : undefined }}>
        <EditorContent editor={editor} />
      </div>
      <div className="CommentEditor__Hint">
        <span>{submitting ? t('branchTasks.commentEditor.submitting') : t('branchTasks.commentEditor.hint')}</span>
        <button
          type="button"
          className={`CommentEditor__RawToggle${isRaw ? ' CommentEditor__RawToggle--active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleRaw}
          title={isRaw ? t('branchTasks.rawEditor.switchToRichText') : t('branchTasks.rawEditor.switchToMarkdown')}
        >
          <CodeXml size={12} />
        </button>
      </div>
    </div>
  );
}
