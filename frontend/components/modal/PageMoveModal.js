import { useState, useEffect, useMemo } from 'react';
import { X, Folder, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// 페이지 이동 대상 폴더 선택 모달
export default function PageMoveModal({ isOpen, onClose, onConfirm, pages, currentPageId, canvasName }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(null); // null = root
  const [expanded, setExpanded] = useState({});

  // 모달 열릴 때 상태 리셋
  useEffect(() => {
    if (isOpen) {
      setSelected(null);
      setExpanded({});
    }
  }, [isOpen]);

  // 현재 페이지와 그 하위 page_id 수집 (순환 방지)
  const disabledIds = useMemo(() => {
    const ids = new Set();
    if (!currentPageId || !pages) return ids;
    ids.add(currentPageId);
    const collect = (parentId) => {
      pages.filter((p) => p.parent_page_id === parentId).forEach((p) => {
        // 이미 수집된 노드는 재방문하지 않음 → parent_page_id 순환 시 무한 재귀 방지
        if (ids.has(p.page_id)) return;
        ids.add(p.page_id);
        collect(p.page_id);
      });
    };
    collect(currentPageId);
    return ids;
  }, [pages, currentPageId]);

  if (!isOpen) return null;

  const folders = pages.filter((p) => p.type === 'folder');

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const renderFolder = (folder, depth = 0, ancestorIds = []) => {
    const isDisabled = disabledIds.has(folder.page_id);
    const isExpand = expanded[folder.page_id];
    // parent_page_id 순환 시 무한 재귀를 막기 위해 조상(또는 자기 자신) 폴더는 자식으로 제외
    const childFolders = folders.filter(
      (f) => f.parent_page_id === folder.page_id
        && f.page_id !== folder.page_id
        && !ancestorIds.includes(f.page_id),
    );
    const childAncestorIds = [...ancestorIds, folder.page_id];

    return (
      <div key={folder.page_id}>
        <button
          className={`PageMoveModal__Item ${selected === folder.page_id ? 'PageMoveModal__Item--selected' : ''} ${isDisabled ? 'PageMoveModal__Item--disabled' : ''}`}
          style={{ paddingLeft: `${16 + depth * 20}px` }}
          onClick={() => {
            if (isDisabled) return;
            setSelected(folder.page_id);
          }}
          disabled={isDisabled}
        >
          {childFolders.length > 0 ? (
            <span className="PageMoveModal__Expand" onClick={(e) => { e.stopPropagation(); toggleExpand(folder.page_id); }}>
              {isExpand ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          ) : (
            <span className="PageMoveModal__Expand" />
          )}
          {isExpand ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span>{folder.title}</span>
        </button>
        {isExpand && childFolders.map((child) => renderFolder(child, depth + 1, childAncestorIds))}
      </div>
    );
  };

  const rootFolders = folders.filter((f) => !f.parent_page_id);

  return (
    <div className="PageMoveModal__Backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="PageMoveModal">
        <div className="PageMoveModal__Header">
          <h3 className="PageMoveModal__Title">{t('modal.pageMove.title')}</h3>
          <button className="PageMoveModal__CloseBtn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="PageMoveModal__Body">
          {/* Root 옵션 */}
          <button
            className={`PageMoveModal__Item ${selected === null ? 'PageMoveModal__Item--selected' : ''}`}
            style={{ paddingLeft: '16px' }}
            onClick={() => setSelected(null)}
          >
            <span className="PageMoveModal__Expand" />
            <Folder size={14} />
            <span>{canvasName || t('modal.pageMove.canvasRoot')}</span>
          </button>
          {rootFolders.map((folder) => renderFolder(folder, 1))}
        </div>
        <div className="PageMoveModal__Footer">
          <button className="PageMoveModal__CancelBtn" onClick={onClose}>{t('common.actions.cancel')}</button>
          <button className="PageMoveModal__ConfirmBtn" onClick={() => onConfirm(selected)}>{t('modal.pageMove.move')}</button>
        </div>
      </div>
    </div>
  );
}
