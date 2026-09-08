import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { Zap, ListTodo, Columns3, Workflow, CalendarDays, Archive, Settings } from 'lucide-react';
import TaskList from './Tasks/TaskList';
import BoardView from './Board/BoardView';
import EpicTimeline from './Epics/EpicTimeline';
import ArchiveList from './Archive/ArchiveList';
import TaskDetailPanel from './Tasks/TaskDetailPanel';
import EpicDetailPanel from './Epics/EpicDetailPanel';
import EpicFlow from './Flow/EpicFlow';
import BranchSettings from './Settings/BranchSettings';
import BranchSchedule from './Schedule/BranchSchedule';
import EntityIcon from '@/components/common/EntityIcon';
import EntityAppearancePopover from '@/components/common/EntityAppearancePopover';
import RefPanelHost, { useRefPreview } from '@/components/shared/RefPanelHost';
import { useTranslation } from 'react-i18next';

const TABS = [
  { key: 'epics', labelKey: 'branch.tabs.epics', icon: Zap },
  { key: 'tasks', labelKey: 'branch.tabs.tasks', icon: ListTodo },
  { key: 'board', labelKey: 'branch.tabs.board', icon: Columns3 },
  { key: 'flow', labelKey: 'branch.tabs.flow', icon: Workflow },
  { key: 'schedule', labelKey: 'branch.tabs.schedule', icon: CalendarDays },
  { key: 'archive', labelKey: 'branch.tabs.archive', icon: Archive },
  { key: 'settings', labelKey: 'branch.tabs.settings', icon: Settings },
];

export default function BranchDetail() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = router.query;
  const [branch, setBranch] = useState(null);
  const validTabs = TABS.map((tab) => tab.key);
  const queryTab = router.query.tab;
  const [activeTab, setActiveTab] = useState(
    validTabs.includes(queryTab) ? queryTab : 'tasks'
  );
  const [loading, setLoading] = useState(true);

  // Task type 설정
  const [taskTypes, setTaskTypes] = useState([]);
  const [workflowStatuses, setWorkflowStatuses] = useState([]);

  // 오른쪽 패널
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedEpic, setSelectedEpic] = useState(null);

  // ?view= 딥링크로 저장된 뷰 1회 적용 (사이드바 핀 클릭 등)
  const [applyViewId, setApplyViewId] = useState(null);

  // 에디터(설명·댓글) 안 칩 클릭 → 작업 패널 왼쪽에 참조 패널
  const [previewRef, setPreviewRef] = useRefPreview();

  // 작업 패널과 같은 task를 가리키는 칩은 무시 — 같은 task의 편집 패널이
  // 두 벌 마운트되면 서로의 변경을 덮어쓰는 경합이 생긴다
  useEffect(() => {
    if (previewRef?.type === 'task' && selectedTask?.task_id === Number(previewRef.data.taskId)) {
      setPreviewRef(null);
    }
  }, [previewRef, selectedTask, setPreviewRef]);

  // Header appearance popover
  const iconRef = useRef(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const isAdmin = branch?.my_role === 'admin';

  useEffect(() => {
    if (!id) return;
    fetchBranch();
    fetchTaskTypes();
    fetchWorkflowStatuses();
  }, [id]);

  // workflow:updated 이벤트 수신
  useEffect(() => {
    const handler = () => fetchWorkflowStatuses();
    window.addEventListener('workflow:updated', handler);
    return () => window.removeEventListener('workflow:updated', handler);
  }, [id]);

  // tasktype:updated 이벤트 수신
  useEffect(() => {
    const handler = () => fetchTaskTypes();
    window.addEventListener('tasktype:updated', handler);
    return () => window.removeEventListener('tasktype:updated', handler);
  }, [id]);

  // branch:created 이벤트 수신 (헤더 appearance/일반 설정 변경 반영)
  useEffect(() => {
    if (!id) return;
    const handler = () => fetchBranch();
    window.addEventListener('branch:created', handler);
    return () => window.removeEventListener('branch:created', handler);
  }, [id]);

  // 우클릭 메뉴 등 외부에서 태스크 삭제 시, 그 태스크가 패널에 열려있으면 닫기
  useEffect(() => {
    const onTaskDeleted = (e) => {
      const deletedId = e.detail?.taskId;
      if (deletedId == null) return;
      setSelectedTask((prev) => (prev && prev.task_id === deletedId ? null : prev));
    };
    window.addEventListener('task:deleted', onTaskDeleted);
    return () => window.removeEventListener('task:deleted', onTaskDeleted);
  }, []);

  // URL query tab 동기화
  useEffect(() => {
    if (queryTab && validTabs.includes(queryTab) && queryTab !== activeTab) {
      setActiveTab(queryTab);
    }
  }, [queryTab]);

  // 쿼리 파라미터로 태스크 상세 패널 열기 (채팅 카드 클릭 등)
  useEffect(() => {
    const taskId = router.query.task;
    if (taskId && branch) {
      handleTabChange('tasks');
      setSelectedTask({ task_id: Number(taskId) });
      router.replace(`/branch/${id}?tab=tasks`, undefined, { shallow: true });
    }
  }, [router.query.task, branch]);

  // 쿼리 파라미터로 저장된 뷰 적용 (사이드바 핀 클릭). 즉시 쿼리 제거하고 applyViewId state로 TaskList에 전달.
  useEffect(() => {
    const viewId = router.query.view;
    if (viewId && branch) {
      handleTabChange('tasks');
      setApplyViewId(Number(viewId));
      router.replace(`/branch/${id}?tab=tasks`, undefined, { shallow: true });
    }
  }, [router.query.view, branch]);

  // 탭 전환 시 패널 닫기 (참조 패널도 함께 — 칩 발원지가 닫히는데 고아로 남기지 않음)
  useEffect(() => {
    setSelectedTask(null);
    setSelectedEpic(null);
    setPreviewRef(null);
  }, [activeTab]);

  const fetchBranch = async () => {
    try {
      const res = await axios.get(`/branches/${id}`);
      if (res.data.status) {
        setBranch(res.data.branch);
      } else {
        router.replace('/');
      }
    } catch {
      router.replace('/');
    } finally {
      setLoading(false);
    }
  };

  const fetchTaskTypes = async () => {
    try {
      const res = await axios.get(`/branches/${id}/task-types`);
      if (res.data.status) setTaskTypes(res.data.task_types);
    } catch {}
  };

  const fetchWorkflowStatuses = async () => {
    try {
      const res = await axios.get(`/branches/${id}/workflow-statuses`);
      if (res.data.status) setWorkflowStatuses(res.data.statuses);
    } catch {}
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    router.replace(`/branch/${id}?tab=${tab}`, undefined, { shallow: true });
  };

  // 패널은 브랜치를 옮겨도 그대로 유지된다(같은 라우트 컴포넌트). 그래서 패널이
  // 자기 태스크/에픽의 브랜치로 조회하도록, 선택 시점에 소속 브랜치를 박아둔다.
  // 목록 행에는 branch_id가 없으므로(=현재 브랜치) 현재 branch.branch_id로 보강하고,
  // 패널 내부 체이닝(부모/하위/칩)은 칩이 직접 branch_id를 실어 보낸다.
  const handleSelectEpic = (epic) => {
    setSelectedTask(null);
    setSelectedEpic({ ...epic, branch_id: epic.branch_id ?? branch?.branch_id });
  };

  const handleSelectTask = (task) => {
    setSelectedEpic(null);
    setSelectedTask({ ...task, branch_id: task.branch_id ?? branch?.branch_id });
  };

  // 에픽 패널에서 태스크 클릭 -> 태스크탭 + 상세패널 열기
  const handleEpicTaskClick = (task) => {
    setSelectedEpic(null);
    setActiveTab('tasks');
    router.replace(`/branch/${id}?tab=tasks`, undefined, { shallow: true });
    // activeTab 변경 후 cleanup이 먼저 실행되므로 다음 틱에서 설정
    setTimeout(() => setSelectedTask({ ...task, branch_id: task.branch_id ?? branch?.branch_id }), 0);
  };

  const panelOpen = selectedTask || selectedEpic;

  if (loading || !branch) return null;

  // 패널이 가리키는 태스크/에픽의 브랜치. 현재 브랜치와 다르면(브랜치 이동 후 잔존)
  // 그 브랜치로 조회하고, 현재 브랜치 전용 메타(key·taskTypes·statuses)는 넘기지 않아
  // 패널이 자기 브랜치 데이터를 직접 받도록 한다(useTaskDetail가 항상 자체 fetch).
  const taskBranchId = selectedTask ? (selectedTask.branch_id ?? branch.branch_id) : null;
  const taskSameBranch = taskBranchId === branch.branch_id;
  const epicBranchId = selectedEpic ? (selectedEpic.branch_id ?? branch.branch_id) : null;
  const epicSameBranch = epicBranchId === branch.branch_id;

  return (
    <div className={`BranchDetail ${panelOpen ? 'BranchDetail--panel-open' : ''}`}>
      <div className={`BranchDetail__Main ${activeTab === 'flow' ? 'BranchDetail__Main--flow' : ''}`}>
        {/* 헤더 */}
        <div className="BranchDetail__Header">
          <span ref={iconRef} style={{ display: 'inline-flex' }}>
            <EntityIcon
              icon={branch.icon}
              color={branch.color}
              size={24}
              entityType="branch"
              onClick={isAdmin ? () => setPopoverOpen(true) : undefined}
              title={isAdmin ? t('branch.editAppearanceTooltip') : undefined}
            />
          </span>
          <EntityAppearancePopover
            anchorRef={iconRef}
            isOpen={popoverOpen}
            onClose={() => setPopoverOpen(false)}
            entityType="branch"
            entityId={branch.branch_id}
            initialIcon={branch.icon}
            initialColor={branch.color}
          />
          <h1 className="BranchDetail__Name">{branch.branch_name}</h1>
          <span className="BranchDetail__Key">{branch.key}</span>
        </div>

        {/* 탭 */}
        <div className="BranchDetail__Tabs">
          {TABS.map(({ key, labelKey, icon: Icon }) => (
            <button
              key={key}
              className={`BranchDetail__Tab ${activeTab === key ? 'BranchDetail__Tab--active' : ''}`}
              onClick={() => handleTabChange(key)}
            >
              <Icon size={15} />
              {t(labelKey)}
            </button>
          ))}
        </div>

        {/* 탭 콘텐츠 */}
        <div className="BranchDetail__Content">
          {activeTab === 'tasks' && (
            <TaskList
              branchId={branch.branch_id}
              branchKey={branch.key}
              taskTypes={taskTypes}
              workflowStatuses={workflowStatuses}
              onSelectTask={handleSelectTask}
              applyViewId={applyViewId}
              onViewApplied={() => setApplyViewId(null)}
            />
          )}
          {activeTab === 'epics' && (
            <EpicTimeline
              branchId={branch.branch_id}
              onSelectEpic={handleSelectEpic}
            />
          )}
          {activeTab === 'board' && (
            <BoardView
              branchId={branch.branch_id}
              branchKey={branch.key}
              taskTypes={taskTypes}
              workflowStatuses={workflowStatuses}
              onSelectTask={handleSelectTask}
            />
          )}
          {activeTab === 'flow' && (
            <EpicFlow
              branchId={branch.branch_id}
              workflowStatuses={workflowStatuses}
              onSelectTask={handleSelectTask}
            />
          )}
          {activeTab === 'schedule' && (
            <BranchSchedule branchId={branch.branch_id} />
          )}
          {activeTab === 'archive' && (
            <ArchiveList
              branchId={branch.branch_id}
              branchKey={branch.key}
              taskTypes={taskTypes}
              workflowStatuses={workflowStatuses}
              onSelectTask={handleSelectTask}
            />
          )}
          {activeTab === 'settings' && (
            <BranchSettings
              branchId={branch.branch_id}
              branch={branch}
              myRole={branch.my_role}
              onBranchUpdated={fetchBranch}
            />
          )}
        </div>
      </div>

      {/* 인라인 칩 클릭 참조 패널 — 편집 상태를 보존한 채 옆에서 확인.
          previewRef 가드는 빈 fixed 래퍼(좁은 화면에서 그림자 줄)를 막는 용도. */}
      {previewRef && (
        <div className="BranchDetail__RefPanel">
          <RefPanelHost
            previewRef={previewRef}
            onClose={() => setPreviewRef(null)}
            onChangeRef={setPreviewRef}
          />
        </div>
      )}

      {/* Task 상세 패널 */}
      {selectedTask && (
        <TaskDetailPanel
          key={`${taskBranchId}-${selectedTask.task_id}`}
          branchId={taskBranchId}
          branchKey={taskSameBranch ? branch.key : undefined}
          taskTypes={taskSameBranch ? taskTypes : undefined}
          workflowStatuses={taskSameBranch ? workflowStatuses : undefined}
          taskSummary={selectedTask}
          onClose={() => setSelectedTask(null)}
          onSelectTask={handleSelectTask}
        />
      )}

      {/* Epic 상세 패널 */}
      {selectedEpic && (
        <EpicDetailPanel
          key={`${epicBranchId}-${selectedEpic.epic_id}`}
          branchId={epicBranchId}
          workflowStatuses={epicSameBranch ? workflowStatuses : undefined}
          epicSummary={selectedEpic}
          onClose={() => setSelectedEpic(null)}
          onSelectTask={handleEpicTaskClick}
        />
      )}
    </div>
  );
}
