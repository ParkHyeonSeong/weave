import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';
import { X, Anchor } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function TrackEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, selected,
}) {
  const { t } = useTranslation();
  // sourceX < targetX: 정방향. 두 노드 가로 거리가 충분하면 표준 smoothstep,
  // 가깝거나 역방향이면 offset 크게 줘서 우회.
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const isBackward = dx < 80;
  const offset = isBackward ? 60 : 20;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    borderRadius: 14,
    offset,
  });

  // edge 방향에 따라 라벨을 선 옆으로 빼서 선이 라벨 위를 가로지르지 않게.
  // 가로 우세 → 위쪽으로, 세로 우세 → 오른쪽으로.
  const isHorizontalDominant = Math.abs(dx) >= Math.abs(dy);
  const labelOffsetX = isHorizontalDominant ? 0 : 20;
  const labelOffsetY = isHorizontalDominant ? -14 : 0;

  const isMaterialized = data?.materialized;
  const isRelates = data?.linkType === 'relates_to';

  const baseStroke = isRelates
    ? 'var(--color-text-tertiary)'
    : (isMaterialized ? 'var(--color-primary)' : 'var(--color-text-tertiary)');
  const strokeWidth = isMaterialized && !isRelates ? 2.2 : 1.6;
  const dasharray = isRelates ? '6 4' : (isMaterialized ? null : '4 5');

  return (
    <>
      {/* halo — 노드 위를 지나가도 선이 끊겨 보이지 않게 종이색으로 두껍게 깐다.
          예전엔 라이트 종이색 16진값을 그대로 박아둬서 다크에서 흰 테두리가
          남았다. --track-paper가 라이트/다크 양쪽에 있으므로 그걸 쓴다. */}
      <path
        d={edgePath}
        fill="none"
        stroke="var(--track-paper)"
        strokeWidth={strokeWidth + 5}
        strokeLinecap="round"
        className="TrackEdge__Halo"
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? 'var(--color-primary)' : baseStroke,
          strokeWidth: selected ? 2.6 : strokeWidth,
          strokeDasharray: dasharray,
          strokeLinecap: 'round',
        }}
        markerEnd={
          isRelates
            ? undefined
            : (isMaterialized ? 'url(#track-arrow-mat)' : 'url(#track-arrow)')
        }
      />
      <EdgeLabelRenderer>
        <div
          className={`TrackEdgeLabel ${selected ? 'TrackEdgeLabel--selected' : ''}`}
          // edge 방향에 따라 라벨을 선 옆으로 빼서 선이 라벨을 가리지 않게.
          style={{
            transform: `translate(-50%, -50%) translate(${labelX + labelOffsetX}px, ${labelY + labelOffsetY}px)`,
          }}
        >
          {isMaterialized && !isRelates && (
            <span className="TrackEdgeLabel__Badge" title={t('track.edge.materializedTitle')}>
              <Anchor size={9} />
              <span>{t('track.edge.dep')}</span>
            </span>
          )}
          {isRelates && (
            <span className="TrackEdgeLabel__Badge TrackEdgeLabel__Badge--rel">
              {t('track.edge.relates')}
            </span>
          )}
          {!isMaterialized && !isRelates && (
            <span className="TrackEdgeLabel__Badge TrackEdgeLabel__Badge--draft">
              {t('track.edge.draft')}
            </span>
          )}
          <button
            className="TrackEdgeLabel__DeleteBtn"
            onClick={(e) => {
              e.stopPropagation();
              data?.onDelete?.(data?.linkId);
            }}
            title={t('track.edge.deleteLink')}
          >
            <X size={10} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
