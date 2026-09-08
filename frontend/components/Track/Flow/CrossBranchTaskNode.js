import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { CalendarDays, Layers, X, ListTree } from 'lucide-react';
import EntityIcon from '@/components/common/EntityIcon';
import Avatar from '@/components/common/Avatar';
import { entityTintStyle } from '@/library/entityTint';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useTranslation } from 'react-i18next';

// dueDate는 date-only다 — new Date('YYYY-MM-DD')는 UTC 자정 instant라 음수 offset(미주)에서
// 하루 전으로 렌더된다. 표시는 useDateFormat().formatDateOnly로만.
const DUE_OPTS = { month: 'numeric', day: 'numeric' };

const CrossBranchTaskNode = memo(function CrossBranchTaskNode({ data, selected }) {
  const { t } = useTranslation();
  const { formatDateOnly } = useDateFormat();
  const {
    displayId, title, status, statusLabel, statusColor,
    priority, branchKey, branchName, branchColor, branchIcon,
    assignees, dueDate, otherTracksCount,
    parent, subtaskTotal, subtaskDone,
    itemId, onDelete,
  } = data;

  // ⚠️ 노드 배경이 --track-card라 배지 부모도 그것이다 — track-card 프로파일(TrackTree·TrackDetail과 동일).
  const branchTint = entityTintStyle(branchColor, { from: 8, alpha: '14', surface: 'track-card' });

  return (
    <div
      className={`TrackNode ${selected ? 'TrackNode--selected' : ''}`}
      style={{ '--branch-color': branchColor }}
    >
      <span className="TrackNode__BranchBand" />
      <span className="TrackNode__BranchGlow" />

      {onDelete && (
        <button
          className="TrackNode__DeleteBtn"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(itemId);
          }}
          title={t('track.actions.removeFromTrack')}
          aria-label={t('track.actions.removeFromTrack')}
        >
          <X size={11} />
        </button>
      )}

      <div className="TrackNode__Header">
        <span
          className={`TrackNode__BranchChip${branchTint?.['--et-on'] ? ' EntityTint' : ''}`}
          style={branchTint}
        >
          <EntityIcon
            icon={branchIcon}
            color={branchColor}
            size={14}
            entityType="branch"
          />
          {branchKey}
        </span>
        <span className="TrackNode__DisplayId">{displayId}</span>
        {priority === 'urgent' && (
          <span className="TrackNode__PrioFlag">!</span>
        )}
      </div>

      <div className="TrackNode__Title">{title}</div>

      {parent && (
        <div className="TrackNode__ParentChip" title={parent.title}>
          └ {parent.display_id}
        </div>
      )}

      <div className="TrackNode__Footer">
        <span className="TrackNode__Status">
          <span className="TrackNode__StatusDot" style={{ background: statusColor }} />
          <span className="TrackNode__StatusLabel">{statusLabel}</span>
        </span>
        {subtaskTotal > 0 && (
          <span
            className="TrackNode__SubProgress"
            title={t('track.node.subtaskProgress', { done: subtaskDone, total: subtaskTotal })}
          >
            <ListTree size={10} />
            {subtaskDone}/{subtaskTotal}
          </span>
        )}
        <span className="TrackNode__Spacer" />
        {dueDate && (
          <span className="TrackNode__Due">
            <CalendarDays size={11} />
            {formatDateOnly(dueDate, DUE_OPTS)}
          </span>
        )}
        {assignees && assignees.length > 0 && (
          <Avatar
            className="TrackNode__Avatar"
            user={assignees[0]}
            size={19}
          />
        )}
      </div>

      {otherTracksCount > 0 && (
        <div className="TrackNode__OtherTracks">
          <Layers size={10} />
          <span>{t('track.node.alsoIn', { n: otherTracksCount })}</span>
        </div>
      )}

      {/* 4방향 핸들. id로 구분해서 edge가 가까운 면 골라 쓰게 */}
      <Handle id="l-in"  type="target" position={Position.Left}   className="TrackNode__Handle TrackNode__Handle--left" />
      <Handle id="r-out" type="source" position={Position.Right}  className="TrackNode__Handle TrackNode__Handle--right" />
      <Handle id="t-in"  type="target" position={Position.Top}    className="TrackNode__Handle TrackNode__Handle--top" />
      <Handle id="t-out" type="source" position={Position.Top}    className="TrackNode__Handle TrackNode__Handle--top-out" />
      <Handle id="b-in"  type="target" position={Position.Bottom} className="TrackNode__Handle TrackNode__Handle--bottom" />
      <Handle id="b-out" type="source" position={Position.Bottom} className="TrackNode__Handle TrackNode__Handle--bottom-out" />
    </div>
  );
});

export default CrossBranchTaskNode;
