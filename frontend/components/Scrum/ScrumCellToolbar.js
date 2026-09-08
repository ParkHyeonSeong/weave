import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Bold, Italic, Strikethrough, ListChecks, List, Link as LinkIcon } from 'lucide-react';
import { promptSetLink } from '@/library/editorLink';

const TBtn = ({ active, onClick, title, children }) => (
  <button
    type="button"
    className={`ScrumCellToolbar__Btn ${active ? 'is-active' : ''}`}
    title={title}
    onMouseDown={(e) => e.preventDefault()} // 클릭 시 에디터 blur 방지 → 툴바 유지
    onClick={onClick}
  >
    {children}
  </button>
);

// 스크럼 셀 포커스 시 칸 위에 뜨는 미니 서식 툴바.
// TableBubbleMenu와 동일하게 getBoundingClientRect + fixed 로 그리드 클리핑을 피한다.
export default function ScrumCellToolbar({ editor }) {
  const { t } = useTranslation();
  const [pos, setPos] = useState(null);
  const [, force] = useState(0);
  const toolbarRef = useRef(null);

  const update = useCallback(() => {
    if (!editor || !editor.isFocused) { setPos(null); return; }
    const rect = editor.view.dom.getBoundingClientRect();
    setPos({ left: rect.left, top: rect.top });
    force((n) => n + 1); // isActive 상태 갱신용 리렌더
  }, [editor]);

  useEffect(() => {
    if (!editor) return undefined;
    const onFocus = () => update();
    const onBlur = () => setTimeout(() => { if (!editor.isFocused) setPos(null); }, 0);
    editor.on('focus', onFocus);
    editor.on('blur', onBlur);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      editor.off('focus', onFocus);
      editor.off('blur', onBlur);
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor, update]);

  // 우측 클램프: 툴바 실측 폭(offsetWidth, 하드코딩 아님)이 렌더 후에만 알려지므로
  // useLayoutEffect로 페인트 전에 좌표를 한 번 더 보정한다 — 금요일 등 우측 컬럼
  // 셀에서 left=rect.left(에디터 좌측)가 뷰포트 우측을 넘어가지 않게 막는다.
  useLayoutEffect(() => {
    if (!pos || !toolbarRef.current) return;
    const width = toolbarRef.current.offsetWidth;
    const maxLeft = window.innerWidth - width - 8;
    if (pos.left > maxLeft) {
      setPos({ ...pos, left: maxLeft });
    }
  }, [pos]);

  if (!pos || !editor) return null;

  return (
    <div
      className="ScrumCellToolbar"
      ref={toolbarRef}
      style={{ position: 'fixed', left: `${pos.left}px`, top: `${Math.max(8, pos.top - 38)}px`, zIndex: 600 }}
    >
      <TBtn title={t('scrum.cellToolbar.bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={14} /></TBtn>
      <TBtn title={t('scrum.cellToolbar.italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} /></TBtn>
      <TBtn title={t('scrum.cellToolbar.strike')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={14} /></TBtn>
      <span className="ScrumCellToolbar__Sep" />
      <TBtn title={t('scrum.cellToolbar.checklist')} active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={14} /></TBtn>
      <TBtn title={t('scrum.cellToolbar.bulletList')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={14} /></TBtn>
      <TBtn
        title={t('scrum.cellToolbar.link')}
        active={editor.isActive('link')}
        onClick={() => promptSetLink(editor)}
      ><LinkIcon size={14} /></TBtn>
    </div>
  );
}
