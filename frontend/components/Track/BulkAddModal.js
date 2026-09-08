import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { X, Zap, Calendar, Filter } from 'lucide-react';
import { axios } from '@/library/_axios';
import { resolveBranchChange } from '@/library/bulkAddBranch';
import CustomSelect from '@/components/common/CustomSelect';
import { useTranslation } from 'react-i18next';

// mode: 'epic' | 'sprint' | 'filter'
// value는 API가 쓰는 enum이라 그대로 두고, 라벨만 카탈로그 키로 해석한다.
const MODE_META = {
  epic: { labelKey: 'track.bulkAdd.modeEpic', icon: Zap },
  sprint: { labelKey: 'track.bulkAdd.modeSprint', icon: Calendar },
  filter: { labelKey: 'track.bulkAdd.modeFilter', icon: Filter },
};

const STATUS_CATEGORIES = [
  { value: '', labelKey: 'track.statusCategory.any' },
  { value: 'todo', labelKey: 'track.statusCategory.todo' },
  { value: 'in_progress', labelKey: 'track.statusCategory.inProgress' },
  { value: 'done', labelKey: 'track.statusCategory.done' },
  { value: 'cancelled', labelKey: 'track.statusCategory.cancelled' },
];

const PRIORITIES = [
  { value: '', labelKey: 'track.priority.any' },
  { value: 'urgent', labelKey: 'track.priority.urgent' },
  { value: 'high', labelKey: 'track.priority.high' },
  { value: 'medium', labelKey: 'track.priority.medium' },
  { value: 'low', labelKey: 'track.priority.low' },
];

const toIntOrNull = (v) => (v == null ? null : Number(v));

export default function BulkAddModal({
  mode, trackId, allBranches = [], onClose, onAdded,
}) {
  const { t } = useTranslation();
  const meta = MODE_META[mode];
  const statusOptions = useMemo(
    () => STATUS_CATEGORIES.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t]
  );
  const priorityOptions = useMemo(
    () => PRIORITIES.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t]
  );

  // CustomSelect용 {value, label, color?} 형태로 변환.
  // 사용자가 가입한 모든 branch가 선택지 — bulk add 시 backend가 track에 자동 합류.
  const branchOptions = useMemo(
    () => allBranches.map((b) => ({
      value: b.branch_id,
      label: b.name || b.branch_name,
      color: b.color,
    })),
    [allBranches]
  );

  const [branchId, setBranchId] = useState(
    branchOptions.length === 1 ? branchOptions[0].value : null
  );
  const [epics, setEpics] = useState([]);
  const [epicId, setEpicId] = useState(null);
  const [sprints, setSprints] = useState([]);
  const [sprintId, setSprintId] = useState(null);
  const [filterStatusCat, setFilterStatusCat] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [tasks, setTasks] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const epicOptions = useMemo(
    () => epics.map((ep) => ({
      value: ep.epic_id,
      label: `${ep.epic_name} (${ep.task_count || 0})`,
      color: ep.color,
    })),
    [epics]
  );
  const sprintOptions = useMemo(
    () => sprints.map((sp) => ({
      value: sp.sprint_id,
      label: sp.status === 'active'
        ? `${sp.sprint_name}  · active`
        : sp.sprint_name,
    })),
    [sprints]
  );
  // 빠른 필터 변경 시 늦게 도착한 응답이 새 결과를 덮어쓰지 않도록 sequence id 가드
  const fetchSeqRef = useRef(0);

  // ESC 닫기
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Epic / Sprint 모드: branch 선택 시 목록 로드
  useEffect(() => {
    if (mode === 'epic' && branchId) {
      setLoading(true);
      axios.get(`/branches/${branchId}/epics`)
        .then((res) => { if (res.data.status) setEpics(res.data.epics); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
    if (mode === 'sprint' && branchId) {
      setLoading(true);
      axios.get(`/branches/${branchId}/sprints`)
        .then((res) => { if (res.data.status) setSprints(res.data.sprints); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [mode, branchId]);

  // 모든 모드가 /tracks/{id}/sources 사용 — in_track / branch_color / done 제외 일관 보장.
  // fetchSeqRef로 stale 응답 가드.
  const fetchTasks = useCallback(async () => {
    const mySeq = ++fetchSeqRef.current;
    setLoading(true);
    const params = {
      limit: 200,
      include_non_participating: 'true',
    };
    if (branchId) params.branch_id = branchId;
    if (mode === 'epic' && epicId) {
      params.epic_id = epicId;
      params.exclude_done = 'true';
    } else if (mode === 'sprint' && sprintId) {
      params.sprint_id = sprintId;
      // Branch 자체 동작과 동일 — active sprint면 done까지 보여줌 (회고/이월 판단용)
      const selectedSprint = sprints.find((s) => s.sprint_id === sprintId);
      if (selectedSprint?.status !== 'active') params.exclude_done = 'true';
    } else if (mode === 'filter') {
      // Filter 모드는 status 선택을 사용자가 직접 — done 강제 제외 안 함
      if (filterStatusCat) params.status_category = filterStatusCat;
      if (filterPriority) params.priority = filterPriority;
    }
    try {
      const res = await axios.get(`/tracks/${trackId}/sources`, { params });
      if (mySeq !== fetchSeqRef.current) return;
      setTasks(res?.data?.status ? (res.data.tasks || []) : []);
    } catch {
      if (mySeq === fetchSeqRef.current) setTasks([]);
    }
    if (mySeq === fetchSeqRef.current) setLoading(false);
  }, [mode, trackId, branchId, epicId, sprintId, sprints, filterStatusCat, filterPriority]);

  useEffect(() => {
    setTasks([]);
    setSelectedIds(new Set());
    if (mode === 'epic' && epicId) fetchTasks();
    else if (mode === 'sprint' && sprintId) fetchTasks();
    else if (mode === 'filter' && branchId) fetchTasks();
  }, [mode, epicId, sprintId, branchId, filterStatusCat, filterPriority, fetchTasks]);

  // 서버는 sprint/epic 모드에서 상위 row에 subtasks[]를 동봉 — 선택/카운트는 평탄화 기준.
  const flatTasks = useMemo(
    () => tasks.flatMap((t) => [t, ...(t.subtasks || [])]),
    [tasks]
  );

  // 결과 받아왔을 때 in_track 아닌 task 자동 선택 — 사용자가 빨리 적용하게
  useEffect(() => {
    if (flatTasks.length === 0) return;
    const next = new Set();
    flatTasks.forEach((t) => {
      if (!t.in_track) next.add(t.task_id);
    });
    setSelectedIds(next);
  }, [flatTasks]);

  const toggleTask = (taskId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleAll = () => {
    const addable = flatTasks.filter((t) => !t.in_track);
    if (selectedIds.size === addable.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(addable.map((t) => t.task_id)));
    }
  };

  const addableTasks = useMemo(() => flatTasks.filter((t) => !t.in_track), [flatTasks]);
  const allSelected = addableTasks.length > 0 && selectedIds.size === addableTasks.length;

  const handleSubmit = async () => {
    if (selectedIds.size === 0 || submitting) return;
    setSubmitting(true);
    const body = { source_task_ids: [...selectedIds] };
    if (mode === 'sprint' && sprintId) {
      body.scope_mode = 'sprint';
      body.scope_id = sprintId;
    } else if (mode === 'epic' && epicId) {
      body.scope_mode = 'epic';
      body.scope_id = epicId;
    } else if (mode === 'filter') {
      body.scope_mode = 'filter';
    }
    try {
      const res = await axios.post(`/tracks/${trackId}/items/bulk`, body);
      if (res.data.status) {
        onAdded(res.data.added);
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('track.bulkAdd.addFailed');
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: msg, type: 'error' },
        }));
      }
    } catch {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: t('track.bulkAdd.addFailed'), type: 'error' },
      }));
    } finally {
      setSubmitting(false);
    }
  };

  const Icon = meta.icon;

  return (
    <div className="BulkAdd__Backdrop" onClick={onClose}>
      <div className="BulkAdd" onClick={(e) => e.stopPropagation()}>
        <header className="BulkAdd__Head">
          <div className="BulkAdd__Title">
            <Icon size={16} />
            <span>{t(meta.labelKey)}</span>
          </div>
          <button className="BulkAdd__Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        {/* 조건 영역 */}
        <div className="BulkAdd__Filters">
          <div className="BulkAdd__Field">
            <span className="BulkAdd__FieldLabel">{t('track.fields.branch')}</span>
            <CustomSelect
              value={branchId}
              options={branchOptions}
              placeholder={t('track.bulkAdd.selectBranch')}
              className="BulkAdd__SelectControl"
              onChange={(v) => {
                // 같은 branch 재선택은 no-op — 초기화를 그대로 태우면 epics/sprints를 비우는데
                // 재조회 effect는 [mode, branchId] 의존이라 값이 안 바뀌면 다시 안 돈다. 그 결과
                // Epic/Sprint 드롭다운이 영구 공란이 된다(branch가 1개면 자동 선택돼 복구 불가).
                const { changed, branchId: next } = resolveBranchChange(branchId, v);
                if (!changed) return;
                setBranchId(next);
                setEpicId(null);
                setSprintId(null);
                setEpics([]);
                setSprints([]);
              }}
            />
          </div>

          {mode === 'epic' && branchId && (
            <div className="BulkAdd__Field">
              <span className="BulkAdd__FieldLabel">{t('track.fields.epic')}</span>
              <CustomSelect
                value={epicId}
                options={epicOptions}
                placeholder={t('track.bulkAdd.selectEpic')}
                className="BulkAdd__SelectControl"
                onChange={(v) => setEpicId(toIntOrNull(v))}
              />
            </div>
          )}

          {mode === 'sprint' && branchId && (
            <div className="BulkAdd__Field">
              <span className="BulkAdd__FieldLabel">{t('track.fields.sprint')}</span>
              <CustomSelect
                value={sprintId}
                options={sprintOptions}
                placeholder={t('track.bulkAdd.selectSprint')}
                className="BulkAdd__SelectControl"
                onChange={(v) => setSprintId(toIntOrNull(v))}
              />
            </div>
          )}

          {mode === 'filter' && (
            <>
              <div className="BulkAdd__Field">
                <span className="BulkAdd__FieldLabel">{t('track.fields.status')}</span>
                <CustomSelect
                  value={filterStatusCat}
                  options={statusOptions}
                  className="BulkAdd__SelectControl"
                  onChange={setFilterStatusCat}
                />
              </div>
              <div className="BulkAdd__Field">
                <span className="BulkAdd__FieldLabel">{t('track.fields.priority')}</span>
                <CustomSelect
                  value={filterPriority}
                  options={priorityOptions}
                  className="BulkAdd__SelectControl"
                  onChange={setFilterPriority}
                />
              </div>
            </>
          )}
        </div>

        {/* 결과 영역 */}
        <div className="BulkAdd__Results">
          {loading && <div className="BulkAdd__Empty">{t('common.state.loading')}</div>}
          {!loading && tasks.length === 0 && (
            <div className="BulkAdd__Empty">
              {mode === 'epic' && !epicId && <>{t('track.bulkAdd.pickEpic')}</>}
              {mode === 'sprint' && !sprintId && <>{t('track.bulkAdd.pickSprint')}</>}
              {mode === 'filter' && !branchId && <>{t('track.bulkAdd.pickBranchAndFilters')}</>}
              {((mode === 'epic' && epicId) ||
                (mode === 'sprint' && sprintId) ||
                (mode === 'filter' && branchId)) && <>{t('track.bulkAdd.noMatchingTasks')}</>}
            </div>
          )}
          {!loading && tasks.length > 0 && (
            <>
              <div className="BulkAdd__SelectAll">
                <label>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                  <span>
                    {t('track.bulkAdd.selectedCount', {
                      selected: selectedIds.size,
                      total: addableTasks.length,
                    })}
                    {flatTasks.length - addableTasks.length > 0 && (
                      <em> · {t('track.bulkAdd.alreadyOnCanvas', {
                        count: flatTasks.length - addableTasks.length,
                      })}</em>
                    )}
                  </span>
                </label>
              </div>
              <ul className="BulkAdd__TaskList">
                {tasks.flatMap((t) => {
                  const renderRow = (row, isSub) => {
                    const checked = selectedIds.has(row.task_id);
                    return (
                      <li key={row.task_id}>
                        <label className={[
                          'BulkAdd__Task',
                          row.in_track ? 'BulkAdd__Task--used' : '',
                          isSub ? 'BulkAdd__Task--sub' : '',
                        ].filter(Boolean).join(' ')}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTask(row.task_id)}
                            disabled={row.in_track}
                          />
                          <span
                            className="BulkAdd__TaskBranchBar"
                            style={{ background: row.branch_color || t.branch_color || '#9CA3AF' }}
                          />
                          <span className="BulkAdd__TaskId">
                            {row.branch_key}-{row.display_number}
                          </span>
                          <span className="BulkAdd__TaskTitle">{row.title}</span>
                          {!isSub && row.parent_display_id && (
                            <span className="BulkAdd__TaskParentChip" title={row.parent_title}>
                              └ {row.parent_display_id}
                            </span>
                          )}
                          {row.in_track && (
                            <span className="BulkAdd__TaskBadge">{t('track.bulkAdd.onCanvas')}</span>
                          )}
                        </label>
                      </li>
                    );
                  };
                  return [
                    renderRow(t, false),
                    ...(t.subtasks || []).map((s) => renderRow(s, true)),
                  ];
                })}
              </ul>
            </>
          )}
        </div>

        <footer className="BulkAdd__Foot">
          <button className="BulkAdd__Btn BulkAdd__Btn--ghost" onClick={onClose}>
            {t('common.actions.cancel')}
          </button>
          <button
            className="BulkAdd__Btn BulkAdd__Btn--primary"
            onClick={handleSubmit}
            disabled={selectedIds.size === 0 || submitting}
          >
            {submitting
              ? t('track.bulkAdd.adding')
              : (selectedIds.size > 0
                ? t('track.bulkAdd.addWithCount', { n: selectedIds.size })
                : t('common.actions.add'))}
          </button>
        </footer>
      </div>
    </div>
  );
}
