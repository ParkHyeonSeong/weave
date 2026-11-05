import { memo, useEffect, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import ScrumCellToolbar from './ScrumCellToolbar';
import LinkHoverPopover from '@/components/shared/LinkHoverPopover';
import { useEditorRefHydration } from '@/library/refHydration';
import { buildScrumCellExtensions } from './scrumCellExtensions';
import { buildMarkdownExtensions } from '@/library/markdownCodec';
import { MarkdownClipboardExtension } from '@/components/Canvas/extensions/MarkdownClipboardExtension';
import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';

// ydoc/provider가 준비된 뒤에만 마운트 (wrapper)
// memo: 칸을 품은 화면(하루 카드·한 주 칸·회고)은 문서가 바뀔 때마다 다시 그려진다 — props(문서·키·문구·멤버·
// 안정된 onEditor)가 같으면 편집기 트리까지 내려가지 않는다.
function ScrumCell(props) {
  if (!props.ydoc) return <div className="ScrumCell ScrumCell--loading" />;
  return <ScrumCellInner {...props} />;
}

export default memo(ScrumCell);

function ScrumCellInner({ ydoc, fragmentKey, placeholder, members, editable = true, onEditor }) {
  const extensions = useMemo(() => {
    const fragment = ydoc.getXmlFragment(fragmentKey);
    const Yjs = Extension.create({
      name: 'yjs',
      addProseMirrorPlugins() { return [ySyncPlugin(fragment), yUndoPlugin()]; },
    });
    return buildMarkdownExtensions([
      ...buildScrumCellExtensions({ placeholder, members }),
      MarkdownClipboardExtension,
      Yjs,
    ]);
    // members는 보드 세션 내 정적(멤버는 셀 렌더 전 이미 로드됨)이라 deps에서 의도적으로
    // 제외 — 추가하면 멤버 목록 참조가 바뀔 때마다 에디터/ yjs 바인딩이 재생성되어 churn 발생.
  }, [ydoc, fragmentKey]);

  // [ydoc, fragmentKey] deps → 바인딩이 바뀌면 에디터를 진짜로 재생성(setOptions가
  // ProseMirror 플러그인을 재빌드하지 않아 옛 fragment에 붙는 잠재 버그를 구조적으로 차단)
  const editor = useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, immediatelyRender: false, extensions }, [ydoc, fragmentKey]);

  // 칩 하이드레이션: 마운트 직후(yjs 초기 동기화 대기) + 탭 내 태스크 변경 시
  useEditorRefHydration(editor, 1000);

  // 요약(읽기 전용) ↔ 편집 전환. useEditor 옵션/deps는 그대로 두고 인스턴스에 직접 적용 —
  // 마운트 뒤 prop이 바뀌어도, 바인딩 변경으로 에디터가 새로 만들어져도 다시 적용된다.
  // 값이 바뀔 때만, update 이벤트 없이 바꾼다(emitUpdate=false) — 문서는 그대로인데 update가 나가면
  // 그것을 '사용자가 고침'으로 듣는 쪽(하루 카드의 가져오기 안내 띠)이 잘못 닫힌다.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  // 호출부가 이 칸의 편집기를 직접 쓸 수 있게 알린다(언마운트·재바인딩 때는 null).
  // onEditor는 안정된 함수(useState setter·useCallback)여야 한다.
  useEffect(() => {
    if (!editor || !onEditor) return undefined;
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  if (!editor) return <div className="ScrumCell ScrumCell--loading" />;
  return (
    <>
      <EditorContent editor={editor} className="ScrumCell" />
      <ScrumCellToolbar editor={editor} />
      {/* 읽기 전용(요약) 칸에서는 팝오버의 편집·링크 해제가 문서를 바꾸므로 그리지 않는다 */}
      {editable && <LinkHoverPopover editor={editor} />}
    </>
  );
}
