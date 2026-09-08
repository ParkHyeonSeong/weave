import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Loader } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import Avatar from '@/components/common/Avatar';
import CustomSelect from '@/components/common/CustomSelect';
import { progressLabel, progressPercent } from '@/library/subtaskProgress';
import { defaultStatusOptions } from '@/library/themePalette';

/**
 * 상세 패널/풀페이지의 Subtasks 섹션.
 *
 * 행에서 바로 상태를 바꿀 수 있다(WEAVE-40) — 하위태스크로 들어갔다 돌아오지 않고
 * 부모를 연 채로 여러 개를 연속 처리하기 위해서다. 상태 저장은 부모가 내려준
 * onStatusChange(=useTaskDetail.updateSubtaskStatus)에 위임한다. 섹션이 자체
 * 오버레이를 들고 있으면 행만 바뀌고 부모의 제목 배지는 이전 값을 보여주므로,
 * 낙관적 상태는 부모의 task.subtasks 한 곳에만 둔다.
 *
 * 이 섹션의 로컬 상태(pending·에러·입력)는 태스크마다 새것이어야 한다. 호출부가
 * key={`${branchId}:${task_id}`}로 리마운트시키므로 여기서 따로 초기화하지 않는다 —
 * 상태가 늘어도 갱신해야 할 리셋 목록이 없다.
 *
 * @param {{done:number,total:number}|null|undefined} progress
 *   부모가 task.subtasks로 계산한 진행도. null = workflowStatuses 미로딩(계산 불가)이라
 *   진행도 UI를 감춘다 — 잘못된 0/N을 잠깐 보여주지 않기 위해서다.
 */
export default function TaskSubtaskSection({
  branchId, taskId, subtasks = [], progress, workflowStatuses = [], taskTypes = [],
  defaultTaskType, onSelectTask, onChanged, onStatusChange,
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [pendingIds, setPendingIds] = useState(() => new Set());

  // 상세 GET이 브랜치 옵션 6요청보다 먼저 오는 게 보통이라, 행이 그려진 뒤에도
  // workflowStatuses가 잠깐 빈 창이 있다. 그 사이 폴백 키('todo'…)로 PATCH가 나가면
  // 커스텀 상태만 쓰는 브랜치에서 INVALID_STATUS로 실패한다 — 그래서 폴백은 **표시 전용**이고
  // (category가 없어 진행도 계산에도 넘기지 않는다) 쓰기는 상태가 로드된 뒤에만 연다.
  const statusesReady = workflowStatuses.length > 0;
  const statusOptions = statusesReady
    ? workflowStatuses.map((ws) => ({ value: ws.key, label: ws.label, color: ws.color }))
    : defaultStatusOptions(t);
  const statusColor = (key) => statusOptions.find((o) => o.value === key)?.color || '#9CA3AF';

  const showProgress = !!progress && progress.total > 0;

  const changeStatus = async (subtask, nextStatus) => {
    if (!onStatusChange) return;
    if (!statusesReady) return; // 셀렉트도 비활성이지만, 이 브랜치에 없는 키가 실리지 않게 여기서도 막는다
    if (nextStatus === subtask.status || pendingIds.has(subtask.task_id)) return; // 같은 행 중복 제출 차단
    setPendingIds((prev) => new Set(prev).add(subtask.task_id));
    setStatusError('');
    const res = await onStatusChange(subtask.task_id, nextStatus);
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(subtask.task_id);
      return next;
    });
    if (res && !res.ok) {
      // 컨트롤러 검증 실패는 200 + {status:false} (silent-200 계약) — 부모가 코드를 넘겨준다
      setStatusError(
        errorText(res.code, res.category)
        ?? t('branchTasks.subtasks.statusChangeFailed'),
      );
    }
  };

  const closeAddForm = () => {
    setAdding(false);
    setTitle('');
    setCreateError('');
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setCreateError('');
    try {
      const res = await axios.post(`/branches/${branchId}/tasks`, {
        title: trimmed,
        parent_task_id: taskId,
        // taskTypes 로딩 전(빈 배열)엔 undefined로 빠지므로, 부모 태스크의 task_type(항상 유효)로 fallback
        task_type: taskTypes?.[0]?.type_key ?? defaultTaskType,
      });
      if (res.data.status) {
        setTitle('');
        setAdding(false);
        setCreateError('');
        // 재조회 + 외부 알림은 onChanged(=useTaskDetail.refreshTask) 한 경로로만 —
        // 여기서 task:updated를 직접 쏘면 부모 훅의 리스너가 받아 GET이 두 번 나간다.
        onChanged?.();
      } else {
        // 컨트롤러 검증 실패는 200 + {status:false} (silent-200 계약). 호출부에서 확인.
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('branchTasks.subtasks.createFailed');
        setCreateError(msg);
      }
    } catch {
      setCreateError(t('branchTasks.subtasks.createFailedRetry'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="TaskSubtaskSection">
      <div className="TaskSubtaskSection__Header">
        <span className="TaskSubtaskSection__Label">
          {t('branchTasks.subtasks.title')}
          {showProgress && (
            <span className="TaskSubtaskSection__Count">{progressLabel(progress)}</span>
          )}
        </span>
        <button
          type="button"
          className="TaskSubtaskSection__AddBtn"
          onClick={() => (adding ? closeAddForm() : setAdding(true))}
          aria-label={t('branchTasks.subtasks.add')}
        >
          <Plus size={14} />
        </button>
      </div>

      {showProgress && (
        <div
          className="TaskSubtaskSection__Progress"
          role="progressbar"
          aria-label={t('branchTasks.subtasks.progressAria')}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
        >
          <span
            className="TaskSubtaskSection__ProgressFill"
            style={{ width: `${progressPercent(progress)}%` }}
          />
        </div>
      )}

      {subtasks.length === 0 && !adding ? (
        <div className="TaskSubtaskSection__Empty">{t('branchTasks.subtasks.empty')}</div>
      ) : (
        <div className="TaskSubtaskSection__List">
          {subtasks.map((st) => {
            const pending = pendingIds.has(st.task_id);
            const main = (st.assignees || []).find((a) => a.role === 'main');
            return (
              <div
                key={st.task_id}
                className={`TaskSubtaskSection__Item ${pending ? 'TaskSubtaskSection__Item--pending' : ''}`}
              >
                <button
                  type="button"
                  className="TaskSubtaskSection__ItemOpen"
                  aria-label={t('branchTasks.subtasks.openAria', { id: st.display_id, title: st.title })}
                  onClick={() => onSelectTask?.({ task_id: st.task_id, branch_id: st.branch_id, title: st.title })}
                >
                  {pending ? (
                    <Loader size={12} className="TaskSubtaskSection__Spinner" aria-hidden="true" />
                  ) : (
                    <span
                      className="TaskSubtaskSection__Dot"
                      style={{ backgroundColor: statusColor(st.status) }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="TaskSubtaskSection__ItemId">{st.display_id}</span>
                  <span className="TaskSubtaskSection__ItemTitle">{st.title}</span>
                </button>
                <CustomSelect
                  className="TaskSubtaskSection__StatusSelect"
                  value={st.status}
                  options={statusOptions}
                  size="sm"
                  ariaLabel={t('branchTasks.subtasks.statusAria', { id: st.display_id })}
                  disabled={pending || !statusesReady}
                  onChange={(val) => changeStatus(st, val)}
                />
                {main && (
                  <Avatar
                    name={main.username}
                    userId={main.user_id}
                    avatarUrl={main.avatar_url}
                    avatarColor={main.avatar_color}
                    size="xs"
                    className="TaskSubtaskSection__Assignee"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 상태 변경 오류는 추가 폼과 무관하게 항상 보인다 */}
      {statusError && (
        <div className="TaskSubtaskSection__Error" role="status" aria-live="polite">{statusError}</div>
      )}

      {adding && (
        <form
          className="TaskSubtaskSection__AddForm"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <input
            className="TaskSubtaskSection__AddInput"
            value={title}
            autoFocus
            placeholder={t('branchTasks.subtasks.titlePlaceholder')}
            aria-label={t('branchTasks.subtasks.titleAria')}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') closeAddForm(); }}
          />
          <button type="submit" className="TaskSubtaskSection__AddSubmit" disabled={busy || !title.trim()}>
            {t('common.actions.add')}
          </button>
          <button type="button" className="TaskSubtaskSection__AddCancel" onClick={closeAddForm} aria-label={t('common.actions.cancel')}>
            <X size={14} />
          </button>
        </form>
      )}
      {createError && (
        <div className="TaskSubtaskSection__Error" role="status" aria-live="polite">{createError}</div>
      )}
    </div>
  );
}
