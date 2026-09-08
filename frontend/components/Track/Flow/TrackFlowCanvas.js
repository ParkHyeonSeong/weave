import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowRight, Minus, Anchor } from 'lucide-react';
import { useTheme } from '@/library/theme';
import CrossBranchTaskNode from './CrossBranchTaskNode';
import RestrictedNode from './RestrictedNode';
import TrackEdge from './TrackEdge';
import { PICKER_DATA_MIME } from '../SourcePicker/SourcePickerSidebar';
import { useTranslation } from 'react-i18next';

const nodeTypes = { task: CrossBranchTaskNode, restricted: RestrictedNode };
const edgeTypes = { track: TrackEdge };

function buildNodes(items, branchById, workflowStatuses, onItemDelete) {
  return items.map((it) => {
    if (it.restricted) {
      return {
        id: String(it.item_id),
        type: 'restricted',
        position: it.position,
        data: { hint: it.restricted_hint, itemId: it.item_id, onDelete: onItemDelete },
      };
    }
    const branch = branchById[it.branch_id] || {};
    const ws = workflowStatuses[it.status] || {};
    return {
      id: String(it.item_id),
      type: 'task',
      position: it.position,
      data: {
        itemId: it.item_id,
        displayId: it.display_id,
        title: it.title,
        status: it.status,
        statusLabel: ws.label || it.status,
        statusColor: ws.color || '#9CA3AF',
        priority: it.priority,
        branchKey: branch.key || '?',
        branchName: branch.name || '?',
        branchColor: branch.color || '#9CA3AF',
        branchIcon: branch.icon || null,
        assignees: it.assignees || [],
        dueDate: it.due_date,
        otherTracksCount: (it.other_tracks || []).length,
        parent: it.parent || null,
        subtaskTotal: it.subtask_total || 0,
        subtaskDone: it.subtask_done || 0,
        onDelete: onItemDelete,
      },
    };
  });
}

// 두 노드의 상대 위치로 가장 자연스러운 source/target handle 선택
function pickHandles(srcPos, tgtPos) {
  if (!srcPos || !tgtPos) return { sourceHandle: 'r-out', targetHandle: 'l-in' };
  const dx = tgtPos.x - srcPos.x;
  const dy = tgtPos.y - srcPos.y;

  // 가로 거리가 충분히 크면 → 가로 라우팅 (right → left or left → right)
  if (Math.abs(dx) > Math.abs(dy) * 0.8) {
    if (dx >= 0) return { sourceHandle: 'r-out', targetHandle: 'l-in' };
    // 역방향 — 위/아래로 우회
    return dy >= 0
      ? { sourceHandle: 'b-out', targetHandle: 't-in' }
      : { sourceHandle: 't-out', targetHandle: 'b-in' };
  }
  // 세로 우세 → 위아래 라우팅
  return dy >= 0
    ? { sourceHandle: 'b-out', targetHandle: 't-in' }
    : { sourceHandle: 't-out', targetHandle: 'b-in' };
}

function buildEdges(links, items, onDelete) {
  const posById = new Map(items.map((it) => [it.item_id, it.position]));
  return links.map((l) => {
    const handles = pickHandles(posById.get(l.source_item_id), posById.get(l.target_item_id));
    return {
      id: `link-${l.link_id}`,
      source: String(l.source_item_id),
      target: String(l.target_item_id),
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      type: 'track',
      data: {
        linkId: l.link_id,
        linkType: l.link_type,
        materialized: l.materialized,
        onDelete,
      },
      selectable: true,
    };
  });
}

function CanvasInner({
  items, links, branchById, workflowStatuses,
  selectedItemId, edgeType, materializeOnCreate,
  onSelectItem, onSourceDrop, onItemPositionChange,
  onLinkCreate, onLinkDelete, onItemDelete,
  onEdgeTypeChange, onMaterializeChange,
}) {
  const { t } = useTranslation();
  const wrapperRef = useRef(null);
  const { screenToFlowPosition } = useReactFlow();
  const { resolved } = useTheme();

  const initialNodes = useMemo(
    () => buildNodes(items, branchById, workflowStatuses, onItemDelete),
    [items, branchById, workflowStatuses, onItemDelete]
  );
  const initialEdges = useMemo(
    () => buildEdges(links, items, onLinkDelete),
    [links, items, onLinkDelete]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // sync nodes (preserve local drag positions when state changes externally)
  useEffect(() => {
    setNodes((current) => {
      const posMap = new Map(current.map((n) => [n.id, n.position]));
      return initialNodes.map((n) => {
        const localPos = posMap.get(n.id);
        return localPos ? { ...n, position: localPos } : n;
      });
    });
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // 선택 표시
  useEffect(() => {
    setNodes((prev) => prev.map((n) => ({
      ...n,
      selected: selectedItemId !== null && n.id === String(selectedItemId),
    })));
  }, [selectedItemId, setNodes]);

  const handleNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    // drag 종료 시점만 ( dragging === false ). drag 중 매 frame에 발화시키면
    // items state가 매번 변경되며 initialNodes useMemo가 재계산되고 setNodes로
    // reactflow 내부 drag state가 덮어써져 drag 자체가 끊김.
    changes.forEach((c) => {
      if (c.type === 'position' && c.dragging === false && c.position) {
        onItemPositionChange(Number(c.id), c.position);
      }
    });
  }, [onNodesChange, onItemPositionChange]);

  const handleConnect = useCallback((connection) => {
    onLinkCreate(Number(connection.source), Number(connection.target));
  }, [onLinkCreate]);

  const handleNodeClick = useCallback((_, node) => {
    onSelectItem(Number(node.id));
  }, [onSelectItem]);

  const handlePaneClick = useCallback(() => {
    onSelectItem(null);
  }, [onSelectItem]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(PICKER_DATA_MIME);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      onSourceDrop(payload, position);
    } catch {}
  }, [onSourceDrop, screenToFlowPosition]);

  const handleKeyDown = useCallback((e) => {
    if ((e.key === 'Backspace' || e.key === 'Delete')) {
      if (selectedItemId && document.activeElement === document.body) {
        e.preventDefault();
        onItemDelete(selectedItemId);
      }
    }
  }, [selectedItemId, onItemDelete]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="TrackCanvas" ref={wrapperRef} onDragOver={handleDragOver} onDrop={handleDrop}>
      <svg className="TrackCanvas__Defs" aria-hidden>
        <defs>
          {/* currentColor는 이 <svg>의 조상 .Track의 color(=--track-ink=--color-text)로
              풀린다. 엣지 선 색과 무관하므로 화살촉에 토큰을 직접 준다. */}
          <marker
            id="track-arrow"
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            markerWidth="9"
            markerHeight="9"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 11 6 L 0 12 z" fill="var(--color-text-tertiary)" />
          </marker>
          <marker
            id="track-arrow-mat"
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            markerWidth="9"
            markerHeight="9"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 11 6 L 0 12 z" fill="var(--color-primary)" />
          </marker>
        </defs>
      </svg>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        defaultEdgeOptions={{ type: 'track' }}
        colorMode={resolved}
      >
        <Background
          variant={BackgroundVariant.Cross}
          gap={36}
          size={8}
          color="var(--track-border-soft)"
          className="TrackCanvas__Bg"
        />
        <div className="TrackCanvas__Vignette" />
        <Controls showInteractive={false} position="bottom-right" />

        <Panel position="top-right" className="TrackCanvas__Toolbar">
          <div className="TrackCanvas__ToolbarGroup">
            <span className="TrackCanvas__ToolbarCaption">{t('track.canvas.edgeCaption')}</span>
            <button
              className={`TrackCanvas__ToolbarBtn ${edgeType === 'flow_to' ? 'TrackCanvas__ToolbarBtn--active' : ''}`}
              onClick={() => onEdgeTypeChange('flow_to')}
              title={t('track.canvas.edgeFlowTitle')}
            >
              <ArrowRight size={13} />
            </button>
            <button
              className={`TrackCanvas__ToolbarBtn ${edgeType === 'relates_to' ? 'TrackCanvas__ToolbarBtn--active' : ''}`}
              onClick={() => onEdgeTypeChange('relates_to')}
              title={t('track.canvas.edgeRelatesTitle')}
            >
              <Minus size={13} />
            </button>
          </div>
          <div className="TrackCanvas__ToolbarDivider" />
          <button
            className={`TrackCanvas__MatToggle ${materializeOnCreate ? 'TrackCanvas__MatToggle--on' : ''}`}
            onClick={() => onMaterializeChange(!materializeOnCreate)}
            disabled={edgeType !== 'flow_to'}
            title={t('track.canvas.materializeTitle')}
          >
            <Anchor size={11} />
            <span>{t('track.canvas.materialize')}</span>
            <span className={`TrackCanvas__MatPill ${materializeOnCreate ? 'TrackCanvas__MatPill--on' : ''}`}>
              {materializeOnCreate ? t('track.canvas.on') : t('track.canvas.off')}
            </span>
          </button>
        </Panel>

        <Panel position="top-left" className="TrackCanvas__Legend">
          <div className="TrackCanvas__LegendRow">
            <svg width="36" height="6" viewBox="0 0 36 6">
              <line x1="0" y1="3" x2="30" y2="3" stroke="var(--color-primary)" strokeWidth="2.2" />
              <polygon points="30,0 36,3 30,6" fill="var(--color-primary)" />
            </svg>
            <span>{t('track.canvas.legendDep')}</span>
          </div>
          <div className="TrackCanvas__LegendRow">
            <svg width="36" height="6" viewBox="0 0 36 6">
              <line x1="0" y1="3" x2="30" y2="3" stroke="var(--color-text-tertiary)" strokeWidth="1.6" strokeDasharray="4 5" />
              <polygon points="30,0 36,3 30,6" fill="var(--color-text-tertiary)" />
            </svg>
            <span>{t('track.canvas.legendDraft')}</span>
          </div>
          <div className="TrackCanvas__LegendRow">
            <svg width="36" height="6" viewBox="0 0 36 6">
              <line x1="0" y1="3" x2="36" y2="3" stroke="var(--color-text-tertiary)" strokeWidth="1.6" strokeDasharray="6 4" />
            </svg>
            <span>{t('track.canvas.legendRelates')}</span>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export default function TrackFlowCanvas(props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
