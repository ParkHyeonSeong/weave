import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  Plus, ChevronRight, ChevronDown,
  FileText, FileCode, Folder, FolderOpen, FolderPlus, MoreHorizontal,
  Trash2, Pencil, Copy, Link, FolderInput,
} from 'lucide-react';
import ConfirmModal from '@/components/modal/ConfirmModal';
import PageMoveModal from '@/components/modal/PageMoveModal';
import useContextMenu from '@/components/common/useContextMenu';
import ContextMenu from '@/components/common/ContextMenu';
import useInlineRename from '@/components/common/useInlineRename';
import { buildSpaceMenu } from './spaceMenu';
import { showToast } from '@/components/Layout/Toast';
import {
  DndContext, closestCenter, pointerWithin, PointerSensor, useSensor, useSensors,
  DragOverlay, useDraggable, useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { axios } from '@/library/_axios';
import EntityIcon from '@/components/common/EntityIcon';
import NavLink from '@/components/common/NavLink';

// 트리 렌더 재귀의 조상 page_id 집합 기본값 (parent_page_id 순환 시 무한 재귀 방지용)
const EMPTY_ANCESTORS = [];

// 포인터가 아이템 위에 있으면 pointerWithin, 아이템 사이(갭)이면 closestCenter 폴백
const treeCollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length > 0) return pointer;
  return closestCenter(args);
};

export default function SidebarCanvases({ onCreateCanvas, savedOrder, onOrderChange, hidden = [], onHide, onUnhide }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [canvases, setCanvases] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [pages, setPages] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [activeItem, setActiveItem] = useState(null);
  // 드롭 위치 인디케이터: { targetId, position: 'before'|'after'|'inside' }
  const [dropIndicator, setDropIndicator] = useState(null);
  const dropIndicatorRef = useRef(null);
  // 인라인 생성: { canvasId, type: 'document'|'folder' }
  const [inlineCreate, setInlineCreate] = useState(null);
  const [inlineTitle, setInlineTitle] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // 드래그 중 실제 포인터 위치 추적
  const pointerRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const handlePointerMove = (e) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, []);

  const fetchCanvases = async () => {
    try {
      const res = await axios.get('/canvases');
      if (res.data.status) setCanvases(res.data.canvases);
    } catch {}
  };

  const fetchPages = useCallback(async (canvasId) => {
    try {
      const res = await axios.get(`/canvases/${canvasId}/pages`);
      if (res.data.status) setPages(res.data.pages);
    } catch {}
  }, []);

  useEffect(() => { fetchCanvases(); }, []);

  useEffect(() => {
    const handleRefresh = () => fetchCanvases();
    window.addEventListener('canvas:created', handleRefresh);
    return () => window.removeEventListener('canvas:created', handleRefresh);
  }, []);

  useEffect(() => {
    const handlePageChange = () => {
      if (expandedId) fetchPages(expandedId);
    };
    window.addEventListener('canvas:page_created', handlePageChange);
    window.addEventListener('canvas:page_deleted', handlePageChange);
    window.addEventListener('canvas:page_updated', handlePageChange);
    return () => {
      window.removeEventListener('canvas:page_created', handlePageChange);
      window.removeEventListener('canvas:page_deleted', handlePageChange);
      window.removeEventListener('canvas:page_updated', handlePageChange);
    };
  }, [expandedId, fetchPages]);

  useEffect(() => {
    if (!expandedId) { setPages([]); return; }
    fetchPages(expandedId);
  }, [expandedId, fetchPages]);

  useEffect(() => {
    const { canvasId } = router.query;
    if (canvasId) setExpandedId(Number(canvasId));
  }, [router.query.canvasId]);

  const toggleExpand = (canvasId) => {
    setExpandedId((prev) => (prev === canvasId ? null : canvasId));
  };

  const toggleFolder = (pageId) => {
    setExpandedFolders((prev) => ({ ...prev, [pageId]: !prev[pageId] }));
  };

  const getChildren = (parentId) => {
    return pages
      .filter((p) => p.parent_page_id === parentId && p.type !== 'overview')
      .sort((a, b) => a.position - b.position);
  };

  // 자기 자신의 하위 폴더로 이동 방지
  const isDescendantOf = useCallback((parentId, targetId) => {
    let current = pages.find((p) => p.page_id === targetId);
    // visited: parent_page_id 데이터에 순환(cycle)이 있어도 무한 루프 방지
    const visited = new Set();
    while (current) {
      if (current.page_id === parentId) return true;
      if (visited.has(current.page_id)) break;
      visited.add(current.page_id);
      if (!current.parent_page_id) break;
      current = pages.find((p) => p.page_id === current.parent_page_id);
    }
    return false;
  }, [pages]);

  // 인디케이터 업데이트 (ref + state 동기화, 변경 없으면 리렌더 스킵)
  const updateIndicator = useCallback((value) => {
    dropIndicatorRef.current = value;
    setDropIndicator((prev) => {
      if (!value && !prev) return prev;
      if (prev?.targetId === value?.targetId && prev?.position === value?.position) return prev;
      return value;
    });
  }, []);

  // DnD
  const handleDragStart = (event) => {
    const item = pages.find((p) => p.page_id === event.active.id);
    setActiveItem(item || null);
    updateIndicator(null);
  };

  // onDragMove: 포인터가 움직일 때마다 호출 (onDragOver는 over가 바뀔 때만 호출되므로 부적합)
  const handleDragMove = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      updateIndicator(null);
      return;
    }

    const overPage = pages.find((p) => p.page_id === over.id);
    if (!overPage || overPage.type === 'overview') {
      updateIndicator(null);
      return;
    }

    // 자기 하위에 넣으려는 경우 차단
    if (isDescendantOf(active.id, over.id)) {
      updateIndicator(null);
      return;
    }

    // 실제 포인터 Y 위치로 판단
    const pointerY = pointerRef.current.y;
    const overRect = over.rect;
    const relativeY = pointerY - overRect.top;
    const ratio = Math.max(0, Math.min(1, relativeY / overRect.height));

    let position;
    let targetId = over.id;
    if (overPage.type === 'folder') {
      // 폴더: 상단 20% = before, 하단 20% = after, 가운데 60% = inside
      if (ratio < 0.2) position = 'before';
      else if (ratio > 0.8) position = 'after';
      else position = 'inside';
    } else {
      // 문서: 상단 30% = before, 하단 70% = after (아래로 드래그 시 after 도달 용이)
      if (ratio < 0.3) position = 'before';
      else position = 'after';
    }

    // 자기 부모 폴더가 over로 잡히는 경우: 이미 그 폴더 안에 있으므로
    // 'inside'(끝으로 점프) / 'after'(자식 영역 오감지) 차단, 'before'만 허용(폴더 밖으로 빼기)
    const draggedPage = pages.find((p) => p.page_id === active.id);
    if (draggedPage && draggedPage.parent_page_id === over.id && position !== 'before') {
      updateIndicator(null);
      return;
    }

    // "after X"를 "before (다음 형제)"로 정규화
    // → 같은 삽입 지점이 항상 동일한 아이템에 표시되어 경계에서 선 깜빡임 방지
    if (position === 'after') {
      const siblings = getChildren(overPage.parent_page_id)
        .filter((s) => s.page_id !== active.id);
      const idx = siblings.findIndex((s) => s.page_id === over.id);
      if (idx >= 0 && idx < siblings.length - 1) {
        targetId = siblings[idx + 1].page_id;
        position = 'before';
      }
    }

    updateIndicator({ targetId, position });
  };

  const handleDragEnd = async (event) => {
    // ref에서 읽어야 최신 값 보장 (state는 렌더 사이클 때문에 스테일할 수 있음)
    const indicator = dropIndicatorRef.current;
    setActiveItem(null);
    updateIndicator(null);

    const { active } = event;
    if (!indicator || !active) return;

    const draggedPage = pages.find((p) => p.page_id === active.id);
    if (!draggedPage || draggedPage.type === 'overview') return;

    const targetPage = pages.find((p) => p.page_id === indicator.targetId);
    if (!targetPage) return;

    let targetParent, newPosition;

    if (indicator.position === 'inside') {
      // 폴더 안에 넣기 (마지막 위치)
      targetParent = indicator.targetId;
      const siblings = getChildren(targetParent)
        .filter((s) => s.page_id !== active.id);
      newPosition = siblings.length;
    } else {
      // before/after - 같은 부모 내 위치 조정
      targetParent = targetPage.parent_page_id;
      const siblings = getChildren(targetParent)
        .filter((s) => s.page_id !== active.id);
      const overIndex = siblings.findIndex((s) => s.page_id === indicator.targetId);
      newPosition = indicator.position === 'before' ? overIndex : overIndex + 1;
    }

    try {
      await axios.patch(
        `/canvases/${expandedId}/pages/${active.id}/move`,
        { parent_page_id: targetParent, position: newPosition },
      );
      fetchPages(expandedId);
    } catch {}
  };

  const handleDragCancel = () => {
    setActiveItem(null);
    updateIndicator(null);
  };

  // Document/Typst 즉시 생성 → 편집 모드로 이동
  const handleQuickCreate = async (canvasId, type, parentPageId = null) => {
    try {
      const body = { title: 'Untitled', type };
      if (parentPageId) body.parent_page_id = parentPageId;
      const res = await axios.post(`/canvases/${canvasId}/pages`, body);
      if (res.data.status) {
        setExpandedId(canvasId);
        if (parentPageId) setExpandedFolders((prev) => ({ ...prev, [parentPageId]: true }));
        fetchPages(canvasId);
        window.dispatchEvent(new CustomEvent('canvas:page_created'));
        router.push(`/canvas/${canvasId}/${res.data.page_id}?edit=1`);
      }
    } catch {}
  };

  // 인라인 생성 핸들러 (폴더용)
  const handleInlineCreate = async () => {
    if (!inlineTitle.trim() || !inlineCreate) return;
    try {
      const body = {
        title: inlineTitle.trim(),
        type: inlineCreate.type,
      };
      if (inlineCreate.parentPageId) body.parent_page_id = inlineCreate.parentPageId;
      const res = await axios.post(`/canvases/${inlineCreate.canvasId}/pages`, body);
      if (res.data.status) {
        setInlineTitle('');
        setInlineCreate(null);
        fetchPages(inlineCreate.canvasId);
        window.dispatchEvent(new CustomEvent('canvas:page_created'));
        if (inlineCreate.type === 'document' || inlineCreate.type === 'typst') {
          router.push(`/canvas/${inlineCreate.canvasId}/${res.data.page_id}`);
        }
      }
    } catch {}
  };

  // 폴더 내 아이템 추가
  const startFolderInlineCreate = (canvasId, parentPageId, type) => {
    setExpandedFolders((prev) => ({ ...prev, [parentPageId]: true }));
    setInlineCreate({ canvasId, type, parentPageId });
    setInlineTitle('');
  };

  const handleInlineKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') handleInlineCreate();
    if (e.key === 'Escape') { setInlineCreate(null); setInlineTitle(''); }
  };

  // 페이지 삭제
  const [deleteTarget, setDeleteTarget] = useState(null);

  const requestDeletePage = (canvasId, page) => {
    setDeleteTarget({ canvasId, pageId: page.page_id, title: page.title, isFolder: page.type === 'folder' });
  };

  const executeDeletePage = async () => {
    if (!deleteTarget) return;
    try {
      const res = await axios.delete(`/canvases/${deleteTarget.canvasId}/pages/${deleteTarget.pageId}`);
      if (res.data.status) {
        window.dispatchEvent(new CustomEvent('canvas:page_deleted'));
        if (String(router.query.pageId) === String(deleteTarget.pageId)) {
          const overview = pages.find((p) => p.type === 'overview');
          if (overview) router.push(`/canvas/${deleteTarget.canvasId}/${overview.page_id}`);
          else router.push(`/canvas/${deleteTarget.canvasId}`);
        }
      }
    } catch {}
    setDeleteTarget(null);
  };

  // 이름변경
  const [renamingPage, setRenamingPage] = useState(null); // { canvasId, pageId, title }

  const requestRenamePage = (canvasId, page) => {
    setRenamingPage({ canvasId, pageId: page.page_id, title: page.title });
  };

  const executeRenamePage = async (newTitle) => {
    if (!renamingPage || !newTitle.trim()) { setRenamingPage(null); return; }
    try {
      await axios.patch(`/canvases/${renamingPage.canvasId}/pages/${renamingPage.pageId}`, { title: newTitle.trim() });
      window.dispatchEvent(new CustomEvent('canvas:page_updated'));
      fetchPages(renamingPage.canvasId);
    } catch {}
    setRenamingPage(null);
  };

  // 복제
  const handleCopyPage = async (canvasId, page) => {
    try {
      const res = await axios.post(`/canvases/${canvasId}/pages/${page.page_id}/copy`, {});
      if (res.data.status) {
        window.dispatchEvent(new CustomEvent('canvas:page_created'));
        fetchPages(canvasId);
      }
    } catch {}
  };

  // 링크 복사
  const handleCopyLink = (canvasId, page) => {
    const url = `${window.location.origin}/canvas/${canvasId}/${page.page_id}`;
    navigator.clipboard.writeText(url).catch(() => {});
  };

  // 이동
  const [moveTarget, setMoveTarget] = useState(null); // { canvasId, page }

  const requestMovePage = (canvasId, page) => {
    setMoveTarget({ canvasId, page });
  };

  const executeMovePage = async (targetParentId) => {
    if (!moveTarget) return;
    const { canvasId, page } = moveTarget;
    try {
      const siblings = pages.filter((p) =>
        targetParentId ? p.parent_page_id === targetParentId : !p.parent_page_id
      );
      await axios.patch(`/canvases/${canvasId}/pages/${page.page_id}/move`, {
        parent_page_id: targetParentId,
        position: siblings.length,
      });
      window.dispatchEvent(new CustomEvent('canvas:page_updated'));
      fetchPages(canvasId);
    } catch {}
    setMoveTarget(null);
  };

  // 우클릭 컨텍스트 메뉴
  const [contextMenu, setContextMenu] = useState(null); // { x, y, canvasId, page }

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  // 캔버스 목록 DnD
  const [activeCanvas, setActiveCanvas] = useState(null);
  const [showHidden, setShowHidden] = useState(false);
  const canvasSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // 저장된 순서에 따라 캔버스 정렬
  const sortedCanvases = useMemo(() => {
    if (!savedOrder || savedOrder.length === 0) return canvases;
    const orderMap = {};
    savedOrder.forEach((id, idx) => { orderMap[id] = idx; });
    return [...canvases].sort((a, b) => {
      const aIdx = orderMap[a.canvas_id] ?? 9999;
      const bIdx = orderMap[b.canvas_id] ?? 9999;
      return aIdx - bIdx;
    });
  }, [canvases, savedOrder]);

  const hiddenSet = useMemo(() => new Set(hidden || []), [hidden]);
  const visibleCanvases = useMemo(() => sortedCanvases.filter((c) => !hiddenSet.has(c.canvas_id)), [sortedCanvases, hiddenSet]);
  const hiddenCanvases = useMemo(() => sortedCanvases.filter((c) => hiddenSet.has(c.canvas_id)), [sortedCanvases, hiddenSet]);

  const canvasSortableIds = visibleCanvases.map((c) => c.canvas_id);

  const handleCanvasDragStart = (event) => {
    const item = visibleCanvases.find((c) => c.canvas_id === event.active.id);
    setActiveCanvas(item || null);
  };

  const handleCanvasDragEnd = (event) => {
    setActiveCanvas(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleCanvases.findIndex((c) => c.canvas_id === active.id);
    const newIndex = visibleCanvases.findIndex((c) => c.canvas_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(visibleCanvases, oldIndex, newIndex);
    const newOrder = reordered.map((c) => c.canvas_id);
    onOrderChange(newOrder);
  };

  // 캔버스 row 공용 컨텍스트 메뉴 (우클릭 + ⋯ 버튼 공용)
  const ctx = useContextMenu();
  const [leaveTarget, setLeaveTarget] = useState(null); // { id, name } | null
  const renameCanvas = useInlineRename(async (id, name) => {
    try {
      await axios.patch(`/canvases/${id}`, { canvas_name: name });
      fetchCanvases();
      window.dispatchEvent(new Event('canvas:created'));
    } catch {}
  });

  const openCanvasMenu = (e, canvas) => {
    const detailPath = `/canvas/${canvas.canvas_id}`;
    ctx.open(e, buildSpaceMenu(
      {
        appType: 'canvas',
        id: canvas.canvas_id,
        name: canvas.canvas_name,
        role: canvas.my_role,
        isHidden: hiddenSet.has(canvas.canvas_id),
      },
      {
        open: () => { setExpandedId(canvas.canvas_id); router.push(detailPath); },
        openNewTab: () => window.open(detailPath, '_blank'),
        settings: () => router.push(`${detailPath}/settings`),
        rename: () => renameCanvas.start(canvas.canvas_id, canvas.canvas_name),
        members: () => router.push(`${detailPath}/settings`),
        toggleHide: () => (hiddenSet.has(canvas.canvas_id) ? onUnhide(canvas.canvas_id) : onHide(canvas.canvas_id)),
        addDoc: () => handleQuickCreate(canvas.canvas_id, 'document'),
        addTypst: () => handleQuickCreate(canvas.canvas_id, 'typst'),
        addFolder: () => {
          setExpandedId(canvas.canvas_id);
          setInlineCreate({ canvasId: canvas.canvas_id, type: 'folder' });
          setInlineTitle('');
        },
        archive: async () => {
          try {
            const res = await axios.delete(`/canvases/${canvas.canvas_id}`);
            if (res.data.status) {
              window.dispatchEvent(new Event('canvas:created'));
              fetchCanvases();
              showToast(t('sidebar.archived', { name: canvas.canvas_name }));
            } else {
              showToast(t('sidebar.archiveFailed'), 'error');
            }
          } catch {}
        },
        leave: () => setLeaveTarget({ id: canvas.canvas_id, name: canvas.canvas_name }),
      }, t));
  };

  const rootChildren = getChildren(null);

  return (
    <>
      <div className="Sidebar__SectionHeader">
        <span className="Sidebar__SectionLabel">{t('layout.sections.canvases')}</span>
      </div>

      <div className="Sidebar__Branches">
        {sortedCanvases.length === 0 ? (
          <div className="Sidebar__Empty">
            {t('layout.empty.canvases')}<br />{t('layout.empty.createHint')}
          </div>
        ) : (
          <>
          <DndContext
            sensors={canvasSensors}
            collisionDetection={closestCenter}
            onDragStart={handleCanvasDragStart}
            onDragEnd={handleCanvasDragEnd}
          >
            <SortableContext items={canvasSortableIds} strategy={verticalListSortingStrategy}>
              {visibleCanvases.map((canvas) => (
            <div key={canvas.canvas_id}>
              <CanvasRow
                canvas={canvas}
                isActive={router.query.canvasId == canvas.canvas_id && !router.query.pageId}
                isExpanded={expandedId === canvas.canvas_id}
                onToggle={() => {
                  toggleExpand(canvas.canvas_id);
                  router.push(`/canvas/${canvas.canvas_id}`);
                }}
                onAddDocument={() => handleQuickCreate(canvas.canvas_id, 'document')}
                onAddFolder={() => {
                  setExpandedId(canvas.canvas_id);
                  setInlineCreate({ canvasId: canvas.canvas_id, type: 'folder' });
                  setInlineTitle('');
                }}
                onAddTypst={() => handleQuickCreate(canvas.canvas_id, 'typst')}
                onMenu={openCanvasMenu}
                rename={renameCanvas}
              />

              {expandedId === canvas.canvas_id && (
                <div className="Sidebar__PageList">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={treeCollisionDetection}
                    onDragStart={handleDragStart}
                    onDragMove={handleDragMove}
                    onDragEnd={handleDragEnd}
                    onDragCancel={handleDragCancel}
                  >
                    {rootChildren.map((page) => (
                      <SidebarPageItem
                        key={page.page_id}
                        page={page}
                        canvasId={canvas.canvas_id}
                        depth={0}
                        ancestorIds={EMPTY_ANCESTORS}
                        expandedFolders={expandedFolders}
                        toggleFolder={toggleFolder}
                        getChildren={getChildren}
                        router={router}
                        onFolderAdd={startFolderInlineCreate}
                        onQuickCreate={handleQuickCreate}
                        onDeletePage={requestDeletePage}
                        onRenamePage={requestRenamePage}
                        onCopyPage={handleCopyPage}
                        onCopyLink={handleCopyLink}
                        onMovePage={requestMovePage}
                        renamingPage={renamingPage}
                        onRenameSubmit={executeRenamePage}
                        onRenameCancel={() => setRenamingPage(null)}
                        onContextMenu={setContextMenu}
                        inlineCreate={inlineCreate}
                        inlineTitle={inlineTitle}
                        setInlineTitle={setInlineTitle}
                        handleInlineKeyDown={handleInlineKeyDown}
                        setInlineCreate={setInlineCreate}
                        dropIndicator={dropIndicator}
                      />
                    ))}

                    <DragOverlay dropAnimation={null}>
                      {activeItem && (
                        <div className="Sidebar__PageItem Sidebar__PageItem--dragging">
                          {activeItem.type === 'folder'
                            ? <Folder size={13} className="Sidebar__PageIcon" />
                            : activeItem.type === 'typst'
                              ? <FileCode size={13} className="Sidebar__PageIcon" />
                              : <FileText size={13} className="Sidebar__PageIcon" />}
                          <span className="Sidebar__BranchName">{activeItem.title}</span>
                        </div>
                      )}
                    </DragOverlay>
                  </DndContext>

                  {/* 인라인 생성 입력 (루트 레벨만, 폴더 안 생성은 SidebarPageItem에서 처리) */}
                  {inlineCreate && inlineCreate.canvasId === canvas.canvas_id && !inlineCreate.parentPageId && (
                    <div className="Sidebar__PageItem Sidebar__PageItem--input">
                      {inlineCreate.type === 'folder'
                        ? <Folder size={13} className="Sidebar__PageIcon" />
                        : inlineCreate.type === 'typst'
                          ? <FileCode size={13} className="Sidebar__PageIcon" />
                          : <FileText size={13} className="Sidebar__PageIcon" />}
                      <input
                        autoFocus
                        className="Sidebar__InlineInput"
                        value={inlineTitle}
                        onChange={(e) => setInlineTitle(e.target.value)}
                        onKeyDown={handleInlineKeyDown}
                        onBlur={() => { if (!inlineTitle.trim()) { setInlineCreate(null); setInlineTitle(''); } }}
                        placeholder={inlineCreate.type === 'folder' ? t('layout.canvasTree.folderNamePlaceholder') : inlineCreate.type === 'typst' ? t('layout.canvasTree.typstTitlePlaceholder') : t('layout.canvasTree.documentTitlePlaceholder')}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
              ))}
            </SortableContext>

            <DragOverlay>
              {activeCanvas && (
                <div className="Sidebar__BranchItem Sidebar__BranchItem--dragging">
                  <EntityIcon
                    icon={activeCanvas.icon}
                    color={activeCanvas.color}
                    size={14}
                    entityType="canvas"
                  />
                  <span className="Sidebar__BranchName">{activeCanvas.canvas_name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {hiddenCanvases.length > 0 && (
            <>
              <button className="Sidebar__HiddenToggle" onClick={() => setShowHidden((s) => !s)}>
                {showHidden ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t('sidebar.hiddenItems', { count: hiddenCanvases.length })}
              </button>
              {showHidden && hiddenCanvases.map((canvas) => (
                <div
                  key={canvas.canvas_id}
                  className="Sidebar__BranchRow Sidebar__BranchRow--hidden"
                  onContextMenu={(e) => openCanvasMenu(e, canvas)}
                >
                  <NavLink href={`/canvas/${canvas.canvas_id}`} className="Sidebar__BranchItem">
                    <EntityIcon icon={canvas.icon} color={canvas.color} size={14} entityType="canvas" />
                    <span className="Sidebar__BranchName">{canvas.canvas_name}</span>
                  </NavLink>
                  <button className="Sidebar__UnhideBtn" onClick={() => onUnhide(canvas.canvas_id)}>{t('sidebar.unhide')}</button>
                </div>
              ))}
            </>
          )}
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={executeDeletePage}
        title={t(deleteTarget?.isFolder ? 'layout.canvasTree.deleteFolderTitle' : 'layout.canvasTree.deletePageTitle')}
        message={t(deleteTarget?.isFolder ? 'canvasSidebar.deleteFolderConfirm' : 'canvasSidebar.deletePageConfirm',
          { title: deleteTarget?.title ?? '' })}
        confirmLabel={t('common.actions.delete')}
        variant="danger"
      />

      <PageMoveModal
        isOpen={!!moveTarget}
        onClose={() => setMoveTarget(null)}
        onConfirm={executeMovePage}
        pages={pages}
        currentPageId={moveTarget?.page.page_id}
        canvasName={canvases.find((c) => c.canvas_id === moveTarget?.canvasId)?.canvas_name}
      />

      {/* 우클릭 컨텍스트 메뉴 */}
      {contextMenu && (
        <div
          className="Sidebar__ContextMenu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="Sidebar__AddMenuItem" onClick={() => {
            requestRenamePage(contextMenu.canvasId, contextMenu.page);
            setContextMenu(null);
          }}>
            <Pencil size={13} /> {t('spaceMenu.rename')}
          </button>
          {contextMenu.page.type !== 'folder' && (
            <button className="Sidebar__AddMenuItem" onClick={() => {
              handleCopyPage(contextMenu.canvasId, contextMenu.page);
              setContextMenu(null);
            }}>
              <Copy size={13} /> {t('layout.canvasTree.duplicate')}
            </button>
          )}
          <button className="Sidebar__AddMenuItem" onClick={() => {
            handleCopyLink(contextMenu.canvasId, contextMenu.page);
            setContextMenu(null);
          }}>
            <Link size={13} /> {t('layout.canvasTree.copyLink')}
          </button>
          <button className="Sidebar__AddMenuItem" onClick={() => {
            requestMovePage(contextMenu.canvasId, contextMenu.page);
            setContextMenu(null);
          }}>
            <FolderInput size={13} /> {t('layout.canvasTree.move')}
          </button>
          <div className="Sidebar__AddMenuDivider" />
          <button className="Sidebar__AddMenuItem Sidebar__AddMenuItem--danger" onClick={() => {
            requestDeletePage(contextMenu.canvasId, contextMenu.page);
            setContextMenu(null);
          }}>
            <Trash2 size={13} /> {t('common.actions.delete')}
          </button>
        </div>
      )}

      {/* 캔버스 row 공용 컨텍스트 메뉴 */}
      <ContextMenu {...ctx.props} />

      {/* 캔버스 나가기 확인 (페이지 삭제 ConfirmModal과 별개 상태) */}
      <ConfirmModal
        isOpen={!!leaveTarget}
        onClose={() => setLeaveTarget(null)}
        onConfirm={async () => {
          const target = leaveTarget;
          setLeaveTarget(null);
          try {
            const res = await axios.post(`/canvases/${target.id}/leave`);
            if (res.data.status) {
              window.dispatchEvent(new Event('canvas:created'));
              fetchCanvases();
            } else {
              showToast(t('sidebar.leaveFailed'), 'error');
            }
          } catch {}
        }}
        title={t('sidebar.leaveCanvasTitle')}
        message={t('sidebar.leaveConfirm', { name: leaveTarget?.name ?? '' })}
        confirmLabel={t('sidebar.leave')}
        variant="danger"
      />
    </>
  );
}

// 캔버스 제목 row + 호버 시 더보기/+ 버튼
function CanvasRow({ canvas, isActive, isExpanded, onToggle, onAddDocument, onAddFolder, onAddTypst, onMenu, rename }) {
  const { t } = useTranslation();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addMenuPos, setAddMenuPos] = useState(null);
  const addMenuRef = useRef(null);
  const addBtnRef = useRef(null);

  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: canvas.canvas_id });

  const editing = rename.editingId === canvas.canvas_id;

  // 외부 클릭 또는 스크롤 시 추가 메뉴 닫기
  useEffect(() => {
    if (!showAddMenu) return;
    const handleClick = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) setShowAddMenu(false);
    };
    const handleScroll = () => setShowAddMenu(false);
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [showAddMenu]);

  const rowStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={rowStyle}
      className={`Sidebar__BranchRow ${isActive ? 'Sidebar__BranchRow--active' : ''}`}
      onContextMenu={(e) => onMenu(e, canvas)}
    >
      <button
        className={`Sidebar__BranchItem ${isActive ? 'Sidebar__BranchItem--active' : ''}`}
        onClick={() => { if (!editing) onToggle(); }}
        {...attributes}
        {...listeners}
      >
        <span className="Sidebar__ExpandIcon">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <EntityIcon
          icon={canvas.icon}
          color={canvas.color}
          size={14}
          entityType="canvas"
        />
        {editing
          ? <input className="Sidebar__RenameInput" {...rename.inputProps} />
          : <span className="Sidebar__BranchName">{canvas.canvas_name}</span>}
      </button>

      <div className="Sidebar__BranchActions">
        {/* 더보기 메뉴 (공용 컨텍스트 메뉴 오픈) */}
        <button
          className="Sidebar__BranchAddBtn"
          onClick={(e) => { e.stopPropagation(); onMenu(e, canvas); }}
          title={t('common.actions.more')}
          aria-label={t('common.actions.more')}
        >
          <MoreHorizontal size={13} />
        </button>

        {/* 추가 메뉴 */}
        <div ref={addMenuRef}>
          <button
            ref={addBtnRef}
            className="Sidebar__BranchAddBtn"
            onClick={(e) => {
              e.stopPropagation();
              if (!showAddMenu && addBtnRef.current) {
                const rect = addBtnRef.current.getBoundingClientRect();
                const top = Math.min(rect.top, window.innerHeight - 140);
                setAddMenuPos({ top, left: rect.right + 4 });
              }
              setShowAddMenu(!showAddMenu);
            }}
            title={t('layout.canvasTree.add')}
          >
            <Plus size={13} />
          </button>
          {showAddMenu && addMenuPos && (
            <div className="Sidebar__FixedMenu" style={{ top: addMenuPos.top, left: addMenuPos.left }}>
              <button className="Sidebar__AddMenuItem" onClick={() => { setShowAddMenu(false); onAddDocument(); }}>
                <FileText size={13} />
                {t('layout.canvasTree.document')}
              </button>
              <button className="Sidebar__AddMenuItem" onClick={() => { setShowAddMenu(false); onAddTypst(); }}>
                <FileCode size={13} />
                {t('layout.canvasTree.typstDocument')}
              </button>
              <button className="Sidebar__AddMenuItem" onClick={() => { setShowAddMenu(false); onAddFolder(); }}>
                <FolderPlus size={13} />
                {t('layout.canvasTree.folder')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SidebarPageItem({
  page, canvasId, depth, ancestorIds, expandedFolders, toggleFolder, getChildren, router,
  onFolderAdd, onQuickCreate, onDeletePage,
  onRenamePage, onCopyPage, onCopyLink, onMovePage,
  renamingPage, onRenameSubmit, onRenameCancel,
  onContextMenu,
  inlineCreate, inlineTitle, setInlineTitle, handleInlineKeyDown, setInlineCreate,
  dropIndicator,
}) {
  const { t } = useTranslation();
  const {
    attributes, listeners, setNodeRef: setDragRef, isDragging,
  } = useDraggable({ id: page.page_id });
  // 드래그 중인 아이템은 droppable 해제 → 자기 자신이 over 타겟이 되는 것 방지
  const { setNodeRef: setDropRef } = useDroppable({ id: page.page_id, disabled: isDragging });
  const setNodeRef = useCallback((node) => { setDragRef(node); setDropRef(node); }, [setDragRef, setDropRef]);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [renameTitle, setRenameTitle] = useState('');
  const menuRef = useRef(null);
  const moreBtnRef = useRef(null);

  const isFolder = page.type === 'folder';
  const isExpanded = expandedFolders[page.page_id];
  // parent_page_id 데이터에 순환이 있어도 무한 재귀를 막기 위해
  // 현재 렌더 경로의 조상(또는 자기 자신)인 페이지는 자식으로 다시 그리지 않음
  const children = isFolder
    ? getChildren(page.page_id).filter(
        (c) => c.page_id !== page.page_id && !ancestorIds.includes(c.page_id),
      )
    : [];
  // 자식 렌더에 넘길 조상 집합 (자기 자신 포함)
  const childAncestorIds = useMemo(
    () => [...ancestorIds, page.page_id],
    [ancestorIds, page.page_id],
  );
  const isRenaming = renamingPage?.pageId === page.page_id;

  // 이름변경 모드 진입 시 title 세팅
  useEffect(() => {
    if (isRenaming) setRenameTitle(page.title);
  }, [isRenaming, page.title]);

  // 메뉴 외부 클릭 또는 스크롤 시 닫기
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    };
    const handleScroll = () => setShowMenu(false);
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [showMenu]);

  // 이름변경 키 핸들러
  const handleRenameKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') onRenameSubmit(renameTitle);
    if (e.key === 'Escape') onRenameCancel();
  };

  // 우클릭 핸들러
  const handleContextMenu = (e) => {
    if (page.type === 'overview') return;
    e.preventDefault();
    e.stopPropagation();
    const menuW = 170, menuH = 220;
    const x = Math.min(e.clientX, window.innerWidth - menuW);
    const y = Math.min(e.clientY, window.innerHeight - menuH);
    onContextMenu({ x, y, canvasId, page });
  };

  // 이 폴더 안에 인라인 생성 중인지
  const isInlineInThisFolder = inlineCreate
    && inlineCreate.parentPageId === page.page_id
    && inlineCreate.canvasId === canvasId;

  // 더보기 메뉴 내용 (폴더/문서 공용)
  const renderMenuItems = () => (
    <>
      {/* 폴더인 경우 추가 메뉴 */}
      {isFolder && (
        <>
          <button className="Sidebar__AddMenuItem" onClick={() => {
            setShowMenu(false);
            onQuickCreate(canvasId, 'document', page.page_id);
          }}>
            <FileText size={13} /> {t('layout.canvasTree.document')}
          </button>
          <button className="Sidebar__AddMenuItem" onClick={() => {
            setShowMenu(false);
            onQuickCreate(canvasId, 'typst', page.page_id);
          }}>
            <FileCode size={13} /> {t('layout.canvasTree.typstDocument')}
          </button>
          <button className="Sidebar__AddMenuItem" onClick={() => {
            setShowMenu(false);
            onFolderAdd(canvasId, page.page_id, 'folder');
          }}>
            <FolderPlus size={13} /> {t('layout.canvasTree.folder')}
          </button>
          <div className="Sidebar__AddMenuDivider" />
        </>
      )}
      <button className="Sidebar__AddMenuItem" onClick={() => {
        setShowMenu(false);
        onRenamePage(canvasId, page);
      }}>
        <Pencil size={13} /> {t('spaceMenu.rename')}
      </button>
      {!isFolder && (
        <button className="Sidebar__AddMenuItem" onClick={() => {
          setShowMenu(false);
          onCopyPage(canvasId, page);
        }}>
          <Copy size={13} /> {t('layout.canvasTree.duplicate')}
        </button>
      )}
      <button className="Sidebar__AddMenuItem" onClick={() => {
        setShowMenu(false);
        onCopyLink(canvasId, page);
      }}>
        <Link size={13} /> {t('layout.canvasTree.copyLink')}
      </button>
      <button className="Sidebar__AddMenuItem" onClick={() => {
        setShowMenu(false);
        onMovePage(canvasId, page);
      }}>
        <FolderInput size={13} /> {t('layout.canvasTree.move')}
      </button>
      <div className="Sidebar__AddMenuDivider" />
      <button className="Sidebar__AddMenuItem Sidebar__AddMenuItem--danger" onClick={() => {
        setShowMenu(false);
        onDeletePage(canvasId, page);
      }}>
        <Trash2 size={13} /> {t('common.actions.delete')}
      </button>
    </>
  );

  // 드롭 인디케이터 상태
  const isDropBefore = dropIndicator?.targetId === page.page_id && dropIndicator?.position === 'before';
  const isDropAfter = dropIndicator?.targetId === page.page_id && dropIndicator?.position === 'after';
  const isDropInside = dropIndicator?.targetId === page.page_id && dropIndicator?.position === 'inside';

  const pageRowClass = [
    'Sidebar__PageRow',
    router.query.pageId == page.page_id && 'Sidebar__PageRow--active',
    isDropBefore && 'Sidebar__PageRow--dropBefore',
    isDropAfter && 'Sidebar__PageRow--dropAfter',
    isDropInside && 'Sidebar__PageRow--dropInside',
  ].filter(Boolean).join(' ');

  return (
    <>
      <div
        className={pageRowClass}
        style={{ paddingLeft: `${40 + depth * 14}px` }}
        onContextMenu={handleContextMenu}
      >
        <button
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          style={{ opacity: isDragging ? 0.3 : 1 }}
          className="Sidebar__PageItem Sidebar__PageItem--inRow"
          onClick={() => isFolder ? toggleFolder(page.page_id) : router.push(`/canvas/${canvasId}/${page.page_id}`)}
        >
          {isFolder && (
            <span className="Sidebar__ExpandIcon">
              {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </span>
          )}
          {isFolder
            ? (isExpanded ? <FolderOpen size={13} className="Sidebar__PageIcon" /> : <Folder size={13} className="Sidebar__PageIcon" />)
            : page.type === 'typst'
              ? <FileCode size={13} className="Sidebar__PageIcon" />
              : <FileText size={13} className="Sidebar__PageIcon" />}
          {isRenaming ? (
            <input
              autoFocus
              className="Sidebar__InlineInput"
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={() => onRenameSubmit(renameTitle)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="Sidebar__BranchName">{page.title}</span>
          )}
        </button>

        {page.type !== 'overview' && !isRenaming && (
          <div className="Sidebar__PageActions" ref={menuRef}>
            <button
              ref={moreBtnRef}
              className="Sidebar__PageMoreBtn"
              onClick={(e) => {
                e.stopPropagation();
                if (!showMenu && moreBtnRef.current) {
                  const rect = moreBtnRef.current.getBoundingClientRect();
                  const menuH = isFolder ? 280 : 220;
                  const top = Math.min(rect.top, window.innerHeight - menuH);
                  setMenuPos({ top, left: rect.right + 4 });
                }
                setShowMenu(!showMenu);
              }}
              title={t('common.actions.more')}
            >
              <MoreHorizontal size={12} />
            </button>
            {showMenu && menuPos && (
              <div className="Sidebar__FixedMenu" style={{ top: menuPos.top, left: menuPos.left }}>
                {renderMenuItems()}
              </div>
            )}
          </div>
        )}
      </div>

      {isFolder && isExpanded && (
        <>
          {children.map((child) => (
            <SidebarPageItem
              key={child.page_id}
              page={child}
              canvasId={canvasId}
              depth={depth + 1}
              ancestorIds={childAncestorIds}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              getChildren={getChildren}
              router={router}
              onFolderAdd={onFolderAdd}
              onQuickCreate={onQuickCreate}
              onDeletePage={onDeletePage}
              onRenamePage={onRenamePage}
              onCopyPage={onCopyPage}
              onCopyLink={onCopyLink}
              onMovePage={onMovePage}
              renamingPage={renamingPage}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onContextMenu={onContextMenu}
              inlineCreate={inlineCreate}
              inlineTitle={inlineTitle}
              setInlineTitle={setInlineTitle}
              handleInlineKeyDown={handleInlineKeyDown}
              setInlineCreate={setInlineCreate}
              dropIndicator={dropIndicator}
            />
          ))}
          {/* 폴더 내 인라인 생성 입력 */}
          {isInlineInThisFolder && (
            <div className="Sidebar__PageItem Sidebar__PageItem--input" style={{ paddingLeft: `${40 + (depth + 1) * 14}px` }}>
              {inlineCreate.type === 'folder'
                ? <Folder size={13} className="Sidebar__PageIcon" />
                : inlineCreate.type === 'typst'
                  ? <FileCode size={13} className="Sidebar__PageIcon" />
                  : <FileText size={13} className="Sidebar__PageIcon" />}
              <input
                autoFocus
                className="Sidebar__InlineInput"
                value={inlineTitle}
                onChange={(e) => setInlineTitle(e.target.value)}
                onKeyDown={handleInlineKeyDown}
                onBlur={() => { if (!inlineTitle.trim()) { setInlineCreate(null); setInlineTitle(''); } }}
                placeholder={inlineCreate.type === 'folder' ? t('layout.canvasTree.folderNamePlaceholder') : inlineCreate.type === 'typst' ? t('layout.canvasTree.typstTitlePlaceholder') : t('layout.canvasTree.documentTitlePlaceholder')}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
