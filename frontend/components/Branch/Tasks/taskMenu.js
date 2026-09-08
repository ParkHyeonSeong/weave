import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/router';
import { ArrowRight, Maximize2, Link2, Trash2, ArrowUpToLine, FolderInput } from 'lucide-react';
import { axios } from '@/library/_axios';
import useContextMenu from '@/components/common/useContextMenu';
import { showToast } from '@/components/Layout/Toast';
import { taskDeleteMessage } from '@/library/taskDeleteMessage';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

/**
 * 태스크 행/카드 공용 우클릭 메뉴 훅. 리스트·보드 뷰가 같이 쓴다.
 *
 * 사용:
 *   const menu = useTaskContextMenu({ branchId, onSelectTask });
 *   행/카드: onContextMenu={(e) => menu.openMenu(e, task)}
 *   렌더: <ContextMenu {...menu.menuProps} /> + ConfirmModal(menu.confirmTask 기반)
 *         + ParentPickerPopup(menu.parentPicker 기반)
 */
// errorText가 코드를 못 찾을 때만 쓰는 폴백 — 문구는 errors.* catalog와 같은 출처를 본다.
const PARENT_REJECT_KEY = {
  PARENT_NOT_TOP_LEVEL: 'errors.PARENT_NOT_TOP_LEVEL',
  TARGET_HAS_SUBTASKS: 'errors.TARGET_HAS_SUBTASKS',
};

export default function useTaskContextMenu({ branchId, onSelectTask }) {
  const { t } = useTranslation();
  const router = useRouter();
  const ctx = useContextMenu();
  const { open } = ctx;
  const [confirmTask, setConfirmTask] = useState(null);
  const [parentPicker, setParentPicker] = useState(null); // { task } | null

  const patchParent = useCallback(async (task, parentTaskId) => {
    try {
      const res = await axios.patch(
        `/branches/${branchId}/tasks/${task.task_id}`,
        { parent_task_id: parentTaskId },
      );
      if (res.data?.status) {
        window.dispatchEvent(new Event('task:updated'));
        showToast(parentTaskId === null ? t('branchTasks.menu.promoted') : t('branchTasks.menu.movedUnder'));
      } else {
        const err = getError(res.data);
        const fallbackKey = PARENT_REJECT_KEY[err.code];
        const msg = errorText(err.code, err.category)
          ?? (fallbackKey ? t(fallbackKey) : null)
          ?? t('branchTasks.menu.moveFailed');
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('branchTasks.menu.moveFailedRetry'), 'error');
    }
  }, [branchId, t]);

  const openMenu = useCallback((e, task) => {
    const path = `/branch/${branchId}/task/${task.task_id}`;
    const isSubtask = !!task.parent_task_id;
    const hasSubtasks = (task.subtasks?.length || 0) > 0;
    const items = [
      { id: 'open', group: 'open', icon: ArrowRight, label: t('spaceMenu.open'), onSelect: () => onSelectTask?.(task) },
      { id: 'open-full', group: 'open', icon: Maximize2, label: t('branchTasks.openFullPage'), onSelect: () => router.push(path) },
    ];
    if (isSubtask) {
      items.push({
        id: 'promote', group: 'organize', icon: ArrowUpToLine, label: t('branchTasks.menu.promote'),
        onSelect: () => patchParent(task, null),
      });
    } else if (!hasSubtasks) {
      // 하위를 가진 태스크는 하위가 될 수 없음(1단계 불변식)
      items.push({
        id: 'move-under', group: 'organize', icon: FolderInput, label: t('branchTasks.menu.moveUnder'),
        onSelect: () => setParentPicker({ task }),
      });
    }
    items.push(
      {
        id: 'copy-link', group: 'share', icon: Link2, label: t('branchTasks.menu.copyLink'),
        onSelect: () => {
          navigator.clipboard.writeText(`${window.location.origin}${path}`)
            .then(() => showToast(t('branchTasks.menu.linkCopied')))
            .catch(() => {});
        },
      },
      { id: 'delete', group: 'danger', icon: Trash2, variant: 'danger', label: t('common.actions.delete'), onSelect: () => setConfirmTask(task) },
    );
    open(e, items);
  }, [branchId, onSelectTask, router, open, patchParent, t]);

  const handlePickParent = useCallback((parentTask) => {
    const source = parentPicker?.task;
    setParentPicker(null);
    if (source && parentTask) patchParent(source, parentTask.task_id);
  }, [parentPicker, patchParent]);

  const closeParentPicker = useCallback(() => setParentPicker(null), []);

  const handleConfirmDelete = useCallback(async () => {
    const task = confirmTask;
    setConfirmTask(null);
    if (!task) return;
    try {
      const res = await axios.delete(`/branches/${branchId}/tasks/${task.task_id}`);
      if (res.data?.status) {
        window.dispatchEvent(new Event('task:updated'));
        // 상세 패널이 이 태스크를 열고 있으면 닫도록 알림 (BranchDetail이 수신)
        window.dispatchEvent(new CustomEvent('task:deleted', { detail: { taskId: task.task_id } }));
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('branchTasks.menu.deleteFailed');
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('branchTasks.menu.deleteFailedRetry'), 'error');
    }
  }, [branchId, confirmTask, t]);

  const clearConfirm = useCallback(() => setConfirmTask(null), []);

  const confirmTitle = t('branchTasks.deleteTaskTitle');
  const confirmMessage = confirmTask
    ? taskDeleteMessage(confirmTask, {
      prefix: t('branchTasks.menu.deleteConfirmPrefix', { id: confirmTask.display_id ?? '' }),
      t,
    })
    : '';

  return {
    openMenu,
    menuProps: ctx.props,
    confirmTask,
    confirmTitle,
    confirmMessage,
    clearConfirm,
    handleConfirmDelete,
    parentPicker,
    closeParentPicker,
    handlePickParent,
  };
}
