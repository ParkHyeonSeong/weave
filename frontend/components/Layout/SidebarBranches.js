import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Plus, ChevronRight, ChevronDown, Bookmark } from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { axios } from '@/library/_axios';
import EntityIcon from '@/components/common/EntityIcon';
import SidebarItemActions from './SidebarItemActions';
import NavLink from '@/components/common/NavLink';
import useContextMenu from '@/components/common/useContextMenu';
import ContextMenu from '@/components/common/ContextMenu';
import useInlineRename from '@/components/common/useInlineRename';
import { buildSpaceMenu } from './spaceMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { showToast } from '@/components/Layout/Toast';

function SortableBranchItem({ branch, isActive, onMenu, rename }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: branch.branch_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const editing = rename.editingId === branch.branch_id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`Sidebar__BranchRow ${isActive ? 'Sidebar__BranchRow--active' : ''}`}
      onContextMenu={(e) => onMenu(e, branch)}
    >
      {!editing ? (
        <NavLink
          href={`/branch/${branch.branch_id}`}
          className={`Sidebar__BranchItem ${isActive ? 'Sidebar__BranchItem--active' : ''}`}
          {...attributes}
          {...listeners}
        >
        <EntityIcon
          icon={branch.icon}
          color={branch.color}
          size={14}
          entityType="branch"
        />
        <span className="Sidebar__BranchName">{branch.branch_name}</span>
        </NavLink>
      ) : (
        <button
          className={`Sidebar__BranchItem ${isActive ? 'Sidebar__BranchItem--active' : ''}`}
          {...attributes}
          {...listeners}
        >
          <input className="Sidebar__RenameInput" {...rename.inputProps} />
        </button>
      )}
      <div className="Sidebar__BranchActions">
        <SidebarItemActions onMenu={(e) => onMenu(e, branch)} />
      </div>
    </div>
  );
}

export default function SidebarBranches({ onCreateBranch, savedOrder, onOrderChange, hidden = [], onHide, onUnhide, pinnedViews = [], currentBranchId }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [branches, setBranches] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [showHidden, setShowHidden] = useState(false);

  const ctx = useContextMenu();
  const [leaveTarget, setLeaveTarget] = useState(null); // { id, name } | null
  const rename = useInlineRename(async (id, name) => {
    try {
      await axios.patch(`/branches/${id}`, { branch_name: name });
      fetchBranches();
      window.dispatchEvent(new Event('branch:created'));
    } catch {}
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const fetchBranches = async () => {
    try {
      const res = await axios.get('/branches');
      if (res.data.status) {
        setBranches(res.data.branches);
      }
    } catch {}
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  // CreateBranch 모달에서 생성 후 목록 갱신
  useEffect(() => {
    const handleRefresh = () => fetchBranches();
    window.addEventListener('branch:created', handleRefresh);
    return () => window.removeEventListener('branch:created', handleRefresh);
  }, []);

  // 저장된 순서에 따라 정렬
  const sortedBranches = useMemo(() => {
    if (!savedOrder || savedOrder.length === 0) return branches;
    const orderMap = {};
    savedOrder.forEach((id, idx) => { orderMap[id] = idx; });
    return [...branches].sort((a, b) => {
      const aIdx = orderMap[a.branch_id] ?? 9999;
      const bIdx = orderMap[b.branch_id] ?? 9999;
      return aIdx - bIdx;
    });
  }, [branches, savedOrder]);

  // 숨김 분리: 보이는 것만 정렬 대상, 숨긴 것은 토글 섹션으로
  const hiddenSet = useMemo(() => new Set(hidden || []), [hidden]);
  const visibleBranches = useMemo(() => sortedBranches.filter((b) => !hiddenSet.has(b.branch_id)), [sortedBranches, hiddenSet]);
  const hiddenBranches = useMemo(() => sortedBranches.filter((b) => hiddenSet.has(b.branch_id)), [sortedBranches, hiddenSet]);

  const sortableIds = visibleBranches.map((b) => b.branch_id);

  const openMenu = (e, branch) => {
    const detailPath = `/branch/${branch.branch_id}`;
    ctx.open(e, buildSpaceMenu(
      {
        appType: 'branch',
        id: branch.branch_id,
        name: branch.branch_name,
        role: branch.my_role,
        isHidden: hiddenSet.has(branch.branch_id),
      },
      {
        open: () => router.push(detailPath),
        openNewTab: () => window.open(detailPath, '_blank'),
        settings: () => router.push(`${detailPath}?tab=settings`),
        rename: () => rename.start(branch.branch_id, branch.branch_name),
        members: () => router.push(`${detailPath}?tab=settings`),
        toggleHide: () => (hiddenSet.has(branch.branch_id) ? onUnhide(branch.branch_id) : onHide(branch.branch_id)),
        archive: async () => {
          try {
            const res = await axios.delete(`/branches/${branch.branch_id}`);
            if (res.data.status) {
              window.dispatchEvent(new Event('branch:created'));
              fetchBranches();
              // Toast(showToast)는 액션 버튼을 지원하지 않아 undo 없이 성공 알림만 표시.
              showToast(t('sidebar.archived', { name: branch.branch_name }));
            } else {
              showToast(t('sidebar.archiveFailed'), 'error');
            }
          } catch {}
        },
        leave: () => setLeaveTarget({ id: branch.branch_id, name: branch.branch_name }),
      }, t));
  };

  const handleDragStart = (event) => {
    const item = visibleBranches.find((b) => b.branch_id === event.active.id);
    setActiveItem(item || null);
  };

  const handleDragEnd = (event) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = visibleBranches.findIndex((b) => b.branch_id === active.id);
    const newIndex = visibleBranches.findIndex((b) => b.branch_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(visibleBranches, oldIndex, newIndex);
    const newOrder = reordered.map((b) => b.branch_id);
    onOrderChange(newOrder);
  };

  return (
    <>
      <div className="Sidebar__SectionHeader">
        <span className="Sidebar__SectionLabel">{t('layout.sections.branches')}</span>
        <button className="Sidebar__SectionAddBtn" onClick={onCreateBranch} title={t('layout.sections.createBranch')}>
          <Plus size={14} />
        </button>
      </div>

      <div className="Sidebar__Branches">
        {sortedBranches.length === 0 ? (
          <div className="Sidebar__Empty">
            {t('layout.empty.branches')}<br />{t('layout.empty.createHint')}
          </div>
        ) : (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                {visibleBranches.map((branch) => (
                  <SortableBranchItem
                    key={branch.branch_id}
                    branch={branch}
                    isActive={router.query.id == branch.branch_id}
                    onMenu={openMenu}
                    rename={rename}
                  />
                ))}
              </SortableContext>

              <DragOverlay>
                {activeItem && (
                  <div className="Sidebar__BranchItem Sidebar__BranchItem--dragging">
                    <EntityIcon
                      icon={activeItem.icon}
                      color={activeItem.color}
                      size={14}
                      entityType="branch"
                    />
                    <span className="Sidebar__BranchName">{activeItem.branch_name}</span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>

            {hiddenBranches.length > 0 && (
              <>
                <button className="Sidebar__HiddenToggle" onClick={() => setShowHidden((s) => !s)}>
                  {showHidden ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {t('sidebar.hiddenItems', { count: hiddenBranches.length })}
                </button>
                {showHidden && hiddenBranches.map((branch) => (
                  <div
                    key={branch.branch_id}
                    className="Sidebar__BranchRow Sidebar__BranchRow--hidden"
                    onContextMenu={(e) => openMenu(e, branch)}
                  >
                    <NavLink href={`/branch/${branch.branch_id}`} className="Sidebar__BranchItem">
                      <EntityIcon icon={branch.icon} color={branch.color} size={14} entityType="branch" />
                      <span className="Sidebar__BranchName">{branch.branch_name}</span>
                    </NavLink>
                    <button className="Sidebar__UnhideBtn" onClick={() => onUnhide(branch.branch_id)}>{t('sidebar.unhide')}</button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* 현재 브랜치의 고정한 뷰 (클릭 → ?view= 딥링크로 적용) */}
      {pinnedViews.length > 0 && (
        <div className="Sidebar__PinnedViews">
          <div className="Sidebar__SubSectionLabel">{t('sidebar.pinnedViews')}</div>
          {pinnedViews.map((v) => (
            <button
              key={v.view_id}
              type="button"
              className="Sidebar__PinnedView"
              onClick={() => router.push(`/branch/${currentBranchId}?tab=tasks&view=${v.view_id}`)}
              title={v.name}
            >
              <Bookmark size={12} />
              <span className="Sidebar__BranchName">{v.name}</span>
            </button>
          ))}
        </div>
      )}

      <ContextMenu {...ctx.props} />
      <ConfirmModal
        isOpen={!!leaveTarget}
        onClose={() => setLeaveTarget(null)}
        onConfirm={async () => {
          const target = leaveTarget;
          setLeaveTarget(null);
          try {
            const res = await axios.post(`/branches/${target.id}/leave`);
            if (res.data.status) {
              window.dispatchEvent(new Event('branch:created'));
              fetchBranches();
            } else {
              showToast(t('sidebar.leaveFailed'), 'error');
            }
          } catch {}
        }}
        title={t('sidebar.leaveBranchTitle')}
        message={t('sidebar.leaveConfirm', { name: leaveTarget?.name ?? '' })}
        confirmLabel={t('sidebar.leave')}
        variant="danger"
      />
    </>
  );
}
