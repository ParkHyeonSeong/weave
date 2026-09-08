import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useTheme } from '@/library/theme';
import TaskNode from './TaskNode';
import DeletableEdge from './DeletableEdge';
import { useTranslation } from 'react-i18next';

const nodeTypes = { task: TaskNode };
const edgeTypes = { deletable: DeletableEdge };

// 엣지 스타일
const EDGE_STYLES = {
  finish_to_start: {
    type: 'smoothstep',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      // color 미지정 시 라이브러리 기본 marker 색이 새어 나온다(@xyflow/react 12.10.1
      // dist/esm/index.js:3586 defaultMarkerColor). 반드시 명시한다.
      color: 'var(--color-text-secondary)',
    },
    style: { strokeWidth: 2, stroke: 'var(--color-text-secondary)' },
  },
  relates_to: {
    type: 'smoothstep',
    style: { strokeWidth: 2, stroke: 'var(--color-text-tertiary)', strokeDasharray: '6 4' },
  },
};

export default function FlowCanvas({
  branchId, epicId, tasks, dependencies, flowPositions,
  workflowStatuses, onSelectTask, onDataChange,
}) {
  const { t } = useTranslation();
  const saveTimerRef = useRef(null);
  const deleteEdgeRef = useRef(null);
  const [edgeType, setEdgeType] = useState('finish_to_start');
  const { resolved } = useTheme();

  // 태스크 -> 노드 변환
  const initialNodes = useMemo(() => {
    return tasks.map((task, idx) => {
      const pos = flowPositions?.[String(task.task_id)];
      const ws = workflowStatuses.find((w) => w.key === task.status);
      return {
        id: String(task.task_id),
        type: 'task',
        position: pos || { x: (idx % 4) * 260 + 40, y: Math.floor(idx / 4) * 160 + 40 },
        data: {
          displayId: task.display_id,
          title: task.title,
          taskType: task.task_type,
          statusColor: ws?.color || '#9CA3AF',
          statusLabel: ws?.label || '',
          dueDate: task.due_date || null,
          assignee: task.assignees?.[0] || null,
        },
      };
    });
  }, [tasks, flowPositions, workflowStatuses]);

  // 의존관계 -> 엣지 변환
  const initialEdges = useMemo(() => {
    return dependencies.map((dep) => {
      const baseStyle = EDGE_STYLES[dep.dep_type] || EDGE_STYLES.finish_to_start;
      return {
        id: `dep-${dep.dependency_id}`,
        source: String(dep.source_task_id),
        target: String(dep.target_task_id),
        ...baseStyle,
        type: 'deletable',
        data: {
          dependencyId: dep.dependency_id,
          depType: dep.dep_type,
          onDelete: (edgeId, depId) => deleteEdgeRef.current?.(edgeId, depId),
        },
      };
    });
  }, [dependencies]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // 엣지 삭제 (ref로 stale closure 방지)
  const handleDeleteEdge = useCallback(async (edgeId, dependencyId) => {
    if (!dependencyId) return;
    try {
      const res = await axios.delete(`/branches/${branchId}/dependencies/${dependencyId}`);
      if (res.data.status) {
        setEdges((eds) => eds.filter((e) => e.id !== edgeId));
        if (onDataChange) onDataChange();
      }
    } catch {}
  }, [branchId, setEdges, onDataChange]);
  deleteEdgeRef.current = handleDeleteEdge;

  // props 변경 시 edges 동기화 (백그라운드 refetch 반영)
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // props 변경 시 nodes 동기화 (로컬 위치 보존, data만 업데이트)
  useEffect(() => {
    setNodes((currentNodes) => {
      const posMap = new Map(currentNodes.map((n) => [n.id, n.position]));
      return initialNodes.map((newNode) => {
        const pos = posMap.get(newNode.id);
        return pos ? { ...newNode, position: pos } : newNode;
      });
    });
  }, [initialNodes, setNodes]);

  // saveTimer cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // 노드 위치 저장 (debounce)
  const savePositions = useCallback((updatedNodes) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const positions = {};
      updatedNodes.forEach((n) => {
        positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      });
      try {
        await axios.patch(`/branches/${branchId}/epics/${epicId}`, {
          flow_positions: positions,
        });
      } catch {}
    }, 500);
  }, [branchId, epicId]);

  const handleNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    // 드래그 종료 시 위치 저장
    const hasDrag = changes.some((c) => c.type === 'position' && !c.dragging);
    if (hasDrag) {
      setNodes((nds) => {
        savePositions(nds);
        return nds;
      });
    }
  }, [onNodesChange, savePositions, setNodes]);

  // 노드 연결 -> 의존관계 생성
  const handleConnect = useCallback(async (connection) => {
    try {
      const res = await axios.post(`/branches/${branchId}/dependencies`, {
        source_task_id: Number(connection.source),
        target_task_id: Number(connection.target),
        dep_type: edgeType,
      });
      if (res.data.status) {
        const newEdge = {
          id: `dep-${res.data.dependency_id}`,
          source: connection.source,
          target: connection.target,
          ...EDGE_STYLES[edgeType],
          type: 'deletable',
          data: {
            dependencyId: res.data.dependency_id,
            depType: edgeType,
            onDelete: (edgeId, depId) => deleteEdgeRef.current?.(edgeId, depId),
          },
        };
        setEdges((eds) => addEdge(newEdge, eds));
        if (onDataChange) onDataChange();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? (err.code === 'CIRCULAR_DEPENDENCY' ? t('branch.flow.circularDependency') : t('branch.flow.createDependencyFailed'));
        window.dispatchEvent(new CustomEvent('toast', { detail: { message: msg } }));
      }
    } catch {}
  }, [branchId, edgeType, setEdges, onDataChange, t]);

  // 노드 더블클릭 -> 태스크 상세
  const handleNodeDoubleClick = useCallback((_event, node) => {
    const task = tasks.find((item) => String(item.task_id) === node.id);
    if (task && onSelectTask) onSelectTask(task);
  }, [tasks, onSelectTask]);

  return (
    <div className="EpicFlow__Canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodeDoubleClick={handleNodeDoubleClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        colorMode={resolved}
      >
        <Background gap={20} size={1} color="var(--color-border)" />
        <Controls showInteractive={false} />
        <Panel position="top-right" className="FlowToolbar">
          <div className="FlowToolbar__EdgeType">
            <button
              className={`FlowToolbar__Btn ${edgeType === 'finish_to_start' ? 'FlowToolbar__Btn--active' : ''}`}
              onClick={() => setEdgeType('finish_to_start')}
              title={t('branch.flow.edgeFinishToStart')}
            >
              <svg width="20" height="12" viewBox="0 0 20 12"><line x1="0" y1="6" x2="14" y2="6" stroke="currentColor" strokeWidth="2"/><polygon points="14,2 20,6 14,10" fill="currentColor"/></svg>
            </button>
            <button
              className={`FlowToolbar__Btn ${edgeType === 'relates_to' ? 'FlowToolbar__Btn--active' : ''}`}
              onClick={() => setEdgeType('relates_to')}
              title={t('branch.flow.edgeRelatesTo')}
            >
              <svg width="20" height="12" viewBox="0 0 20 12"><line x1="0" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3"/></svg>
            </button>
          </div>
          <div className="FlowToolbar__Legend">
            <div className="FlowToolbar__LegendItem">
              <svg width="24" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="var(--color-text-secondary)" strokeWidth="2"/><polygon points="18,1 24,4 18,7" fill="var(--color-text-secondary)"/></svg>
              <span>{t('branch.flow.legendBlocks')}</span>
            </div>
            <div className="FlowToolbar__LegendItem">
              <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeDasharray="4 3"/></svg>
              <span>{t('branch.flow.legendRelated')}</span>
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
