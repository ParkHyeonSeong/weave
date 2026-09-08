import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpFromLine, ArrowDownFromLine,
  ArrowLeftFromLine, ArrowRightFromLine,
  TableRowsSplit, TableColumnsSplit, Trash2,
} from 'lucide-react';

const Btn = ({ onClick, children, title, danger }) => (
  <button
    type="button"
    className={`TableBubbleMenu__Btn ${danger ? 'TableBubbleMenu__Btn--danger' : ''}`}
    onClick={onClick}
    title={title}
  >
    {children}
  </button>
);

// 포커스된 셀 아래 중앙에 표시되는 행/열 조작 툴바
export default function TableBubbleMenu({ editor }) {
  const { t } = useTranslation();
  const [pos, setPos] = useState(null);

  const updatePosition = useCallback(() => {
    if (!editor) return;
    const isInTable = editor.isActive('tableCell') || editor.isActive('tableHeader');
    if (!isInTable) { setPos(null); return; }

    // 현재 포커스된 셀(td/th) DOM 요소 찾기
    const { $from } = editor.state.selection;
    let depth = $from.depth;
    while (depth > 0) {
      const nodeName = $from.node(depth).type.name;
      if (nodeName === 'tableCell' || nodeName === 'tableHeader') {
        const cellDom = editor.view.nodeDOM($from.before(depth));
        if (cellDom) {
          const editorEl = editor.view.dom.closest('.CanvasEditor');
          const editorRect = editorEl?.getBoundingClientRect();
          const cellRect = cellDom.getBoundingClientRect();
          if (editorRect) {
            setPos({
              top: cellRect.bottom - editorRect.top + 4,
              left: cellRect.left - editorRect.left + cellRect.width / 2,
            });
          }
        }
        return;
      }
      depth--;
    }
    setPos(null);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.on('transaction', updatePosition);
    return () => {
      editor.off('transaction', updatePosition);
    };
  }, [editor, updatePosition]);

  if (!pos) return null;

  return (
    <div
      className="TableBubbleMenu"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Btn onClick={() => editor.chain().focus().addRowBefore().run()} title={t('canvas.table.addRowAbove')}>
        <ArrowUpFromLine size={14} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().addRowAfter().run()} title={t('canvas.table.addRowBelow')}>
        <ArrowDownFromLine size={14} />
      </Btn>
      <div className="TableBubbleMenu__Sep" />
      <Btn onClick={() => editor.chain().focus().addColumnBefore().run()} title={t('canvas.table.addColumnBefore')}>
        <ArrowLeftFromLine size={14} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().addColumnAfter().run()} title={t('canvas.table.addColumnAfter')}>
        <ArrowRightFromLine size={14} />
      </Btn>
      <div className="TableBubbleMenu__Sep" />
      <Btn onClick={() => editor.chain().focus().deleteRow().run()} title={t('canvas.table.deleteRow')} danger>
        <TableRowsSplit size={14} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().deleteColumn().run()} title={t('canvas.table.deleteColumn')} danger>
        <TableColumnsSplit size={14} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().deleteTable().run()} title={t('canvas.table.deleteTable')} danger>
        <Trash2 size={14} />
      </Btn>
    </div>
  );
}
