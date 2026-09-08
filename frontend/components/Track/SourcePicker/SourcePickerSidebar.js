import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ChevronDown, ChevronRight, GripVertical, Plus, Filter, Calendar, Zap, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import EntityIcon from '@/components/common/EntityIcon';

const PICKER_DATA_MIME = 'application/x-track-source';
const SEARCH_DEBOUNCE_MS = 200;

// task + subtasks를 평탄화 (카운트용)
const flattenTasks = (tasks) => tasks.flatMap((t) => [t, ...(t.subtasks || [])]);

// 트리: branch → sprints[] + epics[] → tasks[]. 검색은 task title 클라이언트 필터.
export default function SourcePickerSidebar({
  trackId, onBulkAdd, onUnparticipateBranch, reloadKey,
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openBranches, setOpenBranches] = useState(() => new Set());
  const [openGroups, setOpenGroups] = useState(() => new Set());  // 'sprint:N' | 'epic:N'
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef(null);

  const fetchTree = useCallback(async () => {
    if (!trackId) return;
    setLoading(true);
    try {
      const res = await axios.get(`/tracks/${trackId}/sidebar-tree`);
      if (res.data.status) {
        const fresh = res.data.tree;
        setTree(fresh);
        // 새로 등장한 branch/group은 expanded, 사라진 키는 prune (사용자 collapse 의도는 유지)
        const validBranchIds = new Set(fresh.map((b) => b.branch_id));
        const validGroupKeys = new Set();
        fresh.forEach((b) => {
          b.sprints.forEach((s) => validGroupKeys.add(`sprint:${s.sprint_id}`));
          b.epics.forEach((e) => validGroupKeys.add(`epic:${e.epic_id}`));
        });
        setOpenBranches((prev) => {
          const next = new Set([...prev].filter((id) => validBranchIds.has(id)));
          fresh.forEach((b) => { if (!prev.has(b.branch_id)) next.add(b.branch_id); });
          return next;
        });
        setOpenGroups((prev) => {
          const next = new Set([...prev].filter((k) => validGroupKeys.has(k)));
          validGroupKeys.forEach((k) => { if (!prev.has(k)) next.add(k); });
          return next;
        });
      }
    } catch {}
    setLoading(false);
  }, [trackId]);

  useEffect(() => { fetchTree(); }, [fetchTree, reloadKey]);

  // 외부 클릭 시 menu 닫기
  useEffect(() => {
    if (!addMenuOpen) return;
    const handler = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addMenuOpen]);

  // 검색은 task title client-side filter. 디바운싱은 input typing rate에 의존.
  const debouncedQ = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const filteredTree = useMemo(() => {
    if (!debouncedQ.trim()) return tree;
    const needle = debouncedQ.toLowerCase();
    const matchTask = (task) =>
      task.title.toLowerCase().includes(needle)
      || task.display_id.toLowerCase().includes(needle);
    // 부모 매칭 → 하위 전부 유지. 하위만 매칭 → 부모를 컨텍스트로 강등(dim, 드래그 억제).
    const filterTasks = (list) => list
      .map((task) => {
        const matchedSubs = (task.subtasks || []).filter(matchTask);
        if (matchTask(task)) return task;
        if (matchedSubs.length > 0) return { ...task, subtasks: matchedSubs, contextOnly: true };
        return null;
      })
      .filter(Boolean);
    return tree.map((b) => ({
      ...b,
      sprints: b.sprints
        .map((s) => ({ ...s, tasks: filterTasks(s.tasks) }))
        .filter((s) => s.tasks.length > 0),
      epics: b.epics
        .map((e) => ({ ...e, tasks: filterTasks(e.tasks) }))
        .filter((e) => e.tasks.length > 0),
    })).filter((b) => b.sprints.length > 0 || b.epics.length > 0);
  }, [tree, debouncedQ]);

  const toggleBranch = (id) => {
    setOpenBranches((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const toggleGroup = (key) => {
    setOpenGroups((p) => {
      const n = new Set(p);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  const handleDragStart = (e, task) => {
    e.dataTransfer.setData(PICKER_DATA_MIME, JSON.stringify({
      task_id: task.task_id,
      display_id: task.display_id,
      title: task.title,
      status: task.status,
      branch_id: task.branch_id,
    }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const totalAccessible = filteredTree.reduce(
    (sum, b) => sum + b.sprints.reduce((s, sp) => s + flattenTasks(sp.tasks).length, 0)
                    + b.epics.reduce((s, ep) => s + flattenTasks(ep.tasks).length, 0),
    0,
  );
  const totalNew = filteredTree.reduce(
    (sum, b) =>
      sum
      + b.sprints.reduce((s, sp) => s + flattenTasks(sp.tasks).filter((task) => !task.in_track && !task.contextOnly).length, 0)
      + b.epics.reduce((s, ep) => s + flattenTasks(ep.tasks).filter((task) => !task.in_track && !task.contextOnly).length, 0),
    0,
  );

  return (
    <aside className="SourcePicker">
      <div className="SourcePicker__Head">
        <span className="SourcePicker__HeadLabel">{t('trackSettings.sourcePicker.sources')}</span>
        <div className="SourcePicker__HeadActions" ref={addMenuRef}>
          <button
            className={`SourcePicker__AddBtn ${addMenuOpen ? 'SourcePicker__AddBtn--open' : ''}`}
            onClick={() => setAddMenuOpen((p) => !p)}
            title={t('trackSettings.sourcePicker.bulkAdd')}
          >
            <Plus size={12} />
            <span>{t('trackSettings.sourcePicker.addBy')}</span>
            <ChevronDown size={11} className="SourcePicker__AddCaret" />
          </button>
          {addMenuOpen && (
            <div className="SourcePicker__AddMenu" role="menu">
              <button
                className="SourcePicker__AddMenuItem"
                onClick={() => { setAddMenuOpen(false); onBulkAdd?.('epic'); }}
              >
                <Zap size={13} />
                <div className="SourcePicker__AddMenuText">
                  <span className="SourcePicker__AddMenuLabel">{t('trackSettings.sourcePicker.epic')}</span>
                  <span className="SourcePicker__AddMenuHint">{t('trackSettings.sourcePicker.epicHint')}</span>
                </div>
              </button>
              <button
                className="SourcePicker__AddMenuItem"
                onClick={() => { setAddMenuOpen(false); onBulkAdd?.('sprint'); }}
              >
                <Calendar size={13} />
                <div className="SourcePicker__AddMenuText">
                  <span className="SourcePicker__AddMenuLabel">{t('trackSettings.sourcePicker.sprint')}</span>
                  <span className="SourcePicker__AddMenuHint">{t('trackSettings.sourcePicker.sprintHint')}</span>
                </div>
              </button>
              <button
                className="SourcePicker__AddMenuItem"
                onClick={() => { setAddMenuOpen(false); onBulkAdd?.('filter'); }}
              >
                <Filter size={13} />
                <div className="SourcePicker__AddMenuText">
                  <span className="SourcePicker__AddMenuLabel">{t('trackSettings.sourcePicker.filter')}</span>
                  <span className="SourcePicker__AddMenuHint">{t('trackSettings.sourcePicker.filterHint')}</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="SourcePicker__SearchWrap">
        <Search size={14} className="SourcePicker__SearchIcon" />
        <input
          type="text"
          className="SourcePicker__SearchInput"
          placeholder={t('trackSettings.sourcePicker.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="SourcePicker__Tree">
        {loading && tree.length === 0 && (
          <div className="SourcePicker__Empty">{t('common.state.loading')}</div>
        )}
        {!loading && tree.length === 0 && (
          <div className="SourcePicker__Empty">
            <div className="SourcePicker__EmptyTitle">{t('trackSettings.sourcePicker.emptyTitle')}</div>
            <div className="SourcePicker__EmptyHint">
              {t('trackSettings.sourcePicker.emptyHintBefore')}{' '}
              <strong>{t('trackSettings.sourcePicker.addBy')}</strong>
              {t('trackSettings.sourcePicker.emptyHintAfter')}
            </div>
          </div>
        )}
        {!loading && tree.length > 0 && filteredTree.length === 0 && (
          <div className="SourcePicker__Empty">
            {t('trackSettings.sourcePicker.noMatches', { query })}
          </div>
        )}

        {filteredTree.map((branch) => {
          const branchOpen = openBranches.has(branch.branch_id);
          return (
            <div key={branch.branch_id} className="SourcePicker__Branch">
              <div
                className="SourcePicker__BranchRow"
                onClick={() => toggleBranch(branch.branch_id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleBranch(branch.branch_id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className="SourcePicker__Chevron">
                  {branchOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
                <EntityIcon
                  icon={branch.branch_icon}
                  color={branch.branch_color}
                  size={14}
                  entityType="branch"
                />
                <span className="SourcePicker__BranchName">{branch.branch_name}</span>
                <span className="SourcePicker__BranchKey">{branch.branch_key}</span>
                {onUnparticipateBranch && (
                  <button
                    className="SourcePicker__BranchUnparticipate"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnparticipateBranch(branch.branch_id, branch.branch_name);
                    }}
                    title={t('trackSettings.sourcePicker.unparticipateTitle')}
                    aria-label={t('trackSettings.branches.removeConfirmTitle')}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>

              {branchOpen && (
                <>
                  {branch.sprints.map((sprint) => (
                    <ScopeGroup
                      key={`sprint:${sprint.sprint_id}`}
                      groupKey={`sprint:${sprint.sprint_id}`}
                      icon={<Calendar size={11} />}
                      title={sprint.sprint_name}
                      hint={sprint.status === 'active' ? t('trackSettings.sourcePicker.activeHint') : null}
                      tasks={sprint.tasks}
                      branchColor={branch.branch_color}
                      isOpen={openGroups.has(`sprint:${sprint.sprint_id}`)}
                      onToggle={() => toggleGroup(`sprint:${sprint.sprint_id}`)}
                      onDragStart={handleDragStart}
                    />
                  ))}
                  {branch.epics.map((epic) => (
                    <ScopeGroup
                      key={`epic:${epic.epic_id}`}
                      groupKey={`epic:${epic.epic_id}`}
                      icon={<Zap size={11} style={{ color: epic.color }} />}
                      title={epic.epic_name}
                      tasks={epic.tasks}
                      branchColor={branch.branch_color}
                      isOpen={openGroups.has(`epic:${epic.epic_id}`)}
                      onToggle={() => toggleGroup(`epic:${epic.epic_id}`)}
                      onDragStart={handleDragStart}
                    />
                  ))}
                </>
              )}
            </div>
          );
        })}
      </div>

      {totalAccessible > 0 && (
        <div className="SourcePicker__Foot">
          <span className="SourcePicker__FootHint">
            {t('trackSettings.sourcePicker.draggableCount', { newCount: totalNew, total: totalAccessible })}
          </span>
        </div>
      )}
    </aside>
  );
}

function ScopeGroup({ groupKey, icon, title, hint, tasks, branchColor, isOpen, onToggle, onDragStart }) {
  return (
    <div className="SourcePicker__Group">
      <div
        className="SourcePicker__GroupRow"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
        }}
        role="button"
        tabIndex={0}
      >
        <span className="SourcePicker__Chevron">
          {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className="SourcePicker__GroupIcon">{icon}</span>
        <span className="SourcePicker__GroupTitle">{title}</span>
        {hint && <span className="SourcePicker__GroupHint">{hint}</span>}
        <span className="SourcePicker__GroupCount">{flattenTasks(tasks).length}</span>
      </div>
      {isOpen && tasks.map((task) => (
        <Fragment key={task.task_id}>
          <TaskRow
            task={task} branchColor={branchColor}
            contextOnly={task.contextOnly} onDragStart={onDragStart}
          />
          {(task.subtasks || []).map((sub) => (
            <TaskRow
              key={sub.task_id} task={sub} branchColor={branchColor}
              depth={1} onDragStart={onDragStart}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function TaskRow({ task, branchColor, depth = 0, contextOnly = false, onDragStart }) {
  const { t } = useTranslation();
  const draggable = !task.in_track && !contextOnly;
  const rowTitle = contextOnly
    ? t('trackSettings.sourcePicker.rowContextParent')
    : task.in_track
      ? t('trackSettings.sourcePicker.rowAlreadyOnCanvas')
      : t('trackSettings.sourcePicker.rowDragToAdd');
  return (
    <div
      className={[
        'SourcePicker__Task',
        task.in_track ? 'SourcePicker__Task--used' : '',
        depth > 0 ? 'SourcePicker__Task--sub' : '',
        contextOnly ? 'SourcePicker__Task--context' : '',
      ].filter(Boolean).join(' ')}
      draggable={draggable}
      onDragStart={(e) => draggable && onDragStart(e, task)}
      title={rowTitle}
    >
      {!contextOnly && (
        <span className="SourcePicker__TaskGrip"><GripVertical size={11} /></span>
      )}
      <span className="SourcePicker__TaskBranchBar" style={{ background: branchColor }} />
      <span className="SourcePicker__TaskId">{task.display_id}</span>
      <span className="SourcePicker__TaskTitle">{task.title}</span>
      {task.in_track && <span className="SourcePicker__TaskBadge">{t('trackSettings.sourcePicker.onCanvas')}</span>}
    </div>
  );
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return v;
}

export { PICKER_DATA_MIME };
