import { useState, useEffect, useCallback } from 'react';
import { axios } from '@/library/_axios';
import { Workflow } from 'lucide-react';
import FlowCanvas from './FlowCanvas';
import { useTranslation } from 'react-i18next';

export default function EpicFlow({ branchId, workflowStatuses, onSelectTask }) {
  const { t } = useTranslation();
  const [epics, setEpics] = useState([]);
  const [selectedEpicId, setSelectedEpicId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [dependencies, setDependencies] = useState([]);
  const [flowPositions, setFlowPositions] = useState({});
  const [initialLoading, setInitialLoading] = useState(false);

  // 에픽 목록 로드
  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`/branches/${branchId}/epics`);
        if (res.data.status) {
          const filtered = res.data.epics.filter((e) => e.status !== 'done');
          setEpics(filtered);
          if (filtered.length > 0 && !selectedEpicId) {
            setSelectedEpicId(filtered[0].epic_id);
          }
        }
      } catch {}
    };
    load();
  }, [branchId]);

  // 에픽 선택 시 데이터 로드
  useEffect(() => {
    if (!selectedEpicId) return;
    fetchFlowData(true);
  }, [selectedEpicId]);

  const fetchFlowData = useCallback(async (isInitial = false) => {
    // 최초 로드 시에만 loading 표시 (FlowCanvas unmount 방지)
    if (isInitial) setInitialLoading(true);
    try {
      const [taskRes, depRes, epicRes] = await Promise.all([
        axios.get(`/branches/${branchId}/epics/${selectedEpicId}/tasks`),
        axios.get(`/branches/${branchId}/dependencies/epic/${selectedEpicId}`),
        axios.get(`/branches/${branchId}/epics/${selectedEpicId}`),
      ]);
      if (taskRes.data.status) setTasks(taskRes.data.tasks);
      if (depRes.data.status) setDependencies(depRes.data.dependencies);
      if (epicRes.data.status) {
        setFlowPositions(epicRes.data.epic?.flow_positions || {});
      }
    } catch {}
    if (isInitial) setInitialLoading(false);
  }, [branchId, selectedEpicId]);

  return (
    <div className="EpicFlow">
      {/* 사이드바 */}
      <div className="EpicFlow__Sidebar">
        {epics.map((epic) => (
          <button
            key={epic.epic_id}
            className={`EpicFlow__EpicItem ${epic.epic_id === selectedEpicId ? 'EpicFlow__EpicItem--active' : ''}`}
            onClick={() => setSelectedEpicId(epic.epic_id)}
          >
            <span
              className="EpicFlow__EpicDot"
              style={{ backgroundColor: epic.color || '#5E6AD2' }}
            />
            <span className="EpicFlow__EpicName">{epic.epic_name}</span>
            <span className="EpicFlow__TaskCount">{epic.task_count}</span>
          </button>
        ))}
        {epics.length === 0 && (
          <div className="EpicFlow__SidebarEmpty">{t('branch.flow.noEpics')}</div>
        )}
      </div>

      {/* 컨텐츠 */}
      <div className="EpicFlow__Content">
        {!selectedEpicId ? (
          <div className="EpicFlow__Empty">
            <Workflow size={40} strokeWidth={1} />
            <p>{t('branch.flow.selectEpic')}</p>
          </div>
        ) : initialLoading ? (
          <div className="EpicFlow__Empty">
            <p>{t('common.state.loading')}</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="EpicFlow__Empty">
            <Workflow size={40} strokeWidth={1} />
            <p>{t('branch.epics.noTasksInEpic')}</p>
            <span className="EpicFlow__EmptySub">{t('branch.flow.addTasksHint')}</span>
          </div>
        ) : (
          <FlowCanvas
            key={selectedEpicId}
            branchId={branchId}
            epicId={selectedEpicId}
            tasks={tasks}
            dependencies={dependencies}
            flowPositions={flowPositions}
            workflowStatuses={workflowStatuses}
            onSelectTask={onSelectTask}
            onDataChange={() => fetchFlowData(false)}
          />
        )}
      </div>
    </div>
  );
}
