import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent } from '@tiptap/react';
import { taskRefPluginKey } from '@/components/Canvas/extensions/TaskRefExtension';
import { slashCommandPluginKey } from '@/components/Canvas/extensions/SlashCommandsExtension';
import { mathEditPluginKey } from '@/components/Canvas/extensions/mathExtensions';
import CanvasEditorToolbar from '@/components/Canvas/CanvasEditorToolbar';
import { useEditorRefHydration } from '@/library/refHydration';
import { buildTaskDescriptionExtensions } from './taskDescriptionExtensions';
import { buildMarkdownExtensions } from '@/library/markdownCodec';
import { MarkdownClipboardExtension } from '@/components/Canvas/extensions/MarkdownClipboardExtension';
import RawMarkdownEditor from '@/components/common/RawMarkdownEditor';
import RawModeBadge from '@/components/common/RawModeBadge';
import { useRawMode } from '@/library/rawMode';
import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';

export default function TaskDescriptionEditor({ content, onSave, branchId }) {
  const { t } = useTranslation();
  const savedRef = useRef(false);

  const extensions = useMemo(
    () => buildMarkdownExtensions([...buildTaskDescriptionExtensions({ branchId }), MarkdownClipboardExtension]),
    [branchId]
  );

  const editor = useEditor({
    coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS,
    immediatelyRender: false,
    extensions,
    content: content || '',
  });

  // 칩 하이드레이션: 마운트 직후 + 탭 내 태스크 변경 시
  useEditorRefHydration(editor);

  const {
    isRaw, isRawRef, rawText, session, warnings, parseError,
    handleRawChange, toggleRaw, parseCurrentRaw,
  } = useRawMode(editor, extensions);

  // blur 시 저장
  useEffect(() => {
    if (!editor) return;

    const handleBlur = () => {
      // raw 전환으로 EditorContent가 숨겨질 때의 blur — 저장은 raw 쪽 blur가 담당
      if (isRawRef.current) return;
      // 슬래시 메뉴/ref 검색 팝업이 열려 있는 동안의 blur는 팝업 input으로의
      // 포커스 이동이다 — 저장/종료 트리거가 아님. 팝업이 닫히면 에디터로
      // 포커스가 돌아오고, 이후의 진짜 blur에서 저장된다.
      const st = editor.state;
      if (
        taskRefPluginKey.getState(st)?.active ||
        slashCommandPluginKey.getState(st)?.active ||
        mathEditPluginKey.getState(st)?.active
      ) return;
      if (savedRef.current) return;
      savedRef.current = true;
      if (editor.isEmpty) {
        onSave(null);
      } else {
        onSave(editor.getHTML());
      }
    };

    editor.on('blur', handleBlur);
    return () => editor.off('blur', handleBlur);
  }, [editor, onSave]);

  // 외부 클릭으로 팝업이 dismiss되면 포커스가 에디터로 돌아오지 않아 blur 저장이
  // 영영 안 일어난다. 팝업 활성→비활성 전환을 감지해, 한 틱 뒤에도 에디터가
  // 포커스를 못 받았으면(=Esc/칩 선택이 아닌 dismiss) 바깥 클릭과 동일하게 저장한다.
  useEffect(() => {
    if (!editor) return;
    let wasRefActive = false;
    const handleTransaction = ({ editor: ed }) => {
      const st = ed.state;
      const refActive =
        taskRefPluginKey.getState(st)?.active ||
        slashCommandPluginKey.getState(st)?.active ||
        mathEditPluginKey.getState(st)?.active;
      // exitRaw()의 setContent(전체 doc 교체)도 이 핸들러를 동기 통과한다 — 그때는
      // isRawRef.current가 아직 true(exitRaw가 setContent 다음 줄에서 false로
      // 내림)라 여기서 걸러진다. setTimeout 안의 isRawRef.current는 실행 시점엔
      // 이미 false로 내려가 있어 무력하므로, 예약 여부를 여기서 동기적으로 가른다.
      if (wasRefActive && !refActive && !isRawRef.current) {
        setTimeout(() => {
          if (editor.isDestroyed || editor.isFocused || savedRef.current || isRawRef.current) return;
          savedRef.current = true;
          onSave(editor.isEmpty ? null : editor.getHTML());
        }, 0);
      }
      wasRefActive = !!refActive;
    };
    editor.on('transaction', handleTransaction);
    return () => editor.off('transaction', handleTransaction);
  }, [editor, onSave]);

  // raw 상태 blur → parse → onSave(html). 기존 blur 자동저장 시맨틱 유지.
  const handleRawBlur = useCallback(() => {
    // exitRaw로 CodeMirror가 언마운트될 때 EditorView.destroy()가 focus 중이던
    // contentDOM에 blur()를 걸어(@codemirror/view 실측) 이 핸들러가 다시 불린다 —
    // exitRaw는 이미 isRawRef.current를 동기적으로 false로 내려놓으므로, 그 시점엔
    // 라운드트립일 뿐 저장 대상이 아니다(exitRaw는 setContent만, 저장 안 함).
    if (!isRawRef.current) return;
    if (savedRef.current) return;
    const res = parseCurrentRaw();
    if (!res.ok) return; // 파싱 실패(방어) — 저장 차단, RawModeBadge가 표시, raw 텍스트 보존
    savedRef.current = true;
    onSave(res.html); // null = 빈 문서 (기존 editor.isEmpty → onSave(null)과 동일)
  }, [parseCurrentRaw, onSave]);

  if (!editor) return null;

  return (
    <div className="TaskDescEditor">
      <CanvasEditorToolbar
        editor={editor}
        rawModeEnabled
        rawModeActive={isRaw}
        onToggleRawMode={toggleRaw}
      />
      {isRaw && <RawModeBadge warnings={warnings} parseError={parseError} />}
      {isRaw && (
        <RawMarkdownEditor
          key={session}
          value={rawText}
          onChange={handleRawChange}
          onBlur={handleRawBlur}
          placeholder={t('branchTasks.rawEditor.markdownPlaceholder', { placeholder: t('branchTasks.detail.addDescription') })}
        />
      )}
      <div style={{ display: isRaw ? 'none' : undefined }}>
        <EditorContent editor={editor} className="TaskDescEditor__Content" />
      </div>
    </div>
  );
}
