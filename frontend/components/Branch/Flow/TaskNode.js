import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import Avatar from '@/components/common/Avatar';
import { useDateFormat } from '@/hooks/useDateFormat';

function TaskNode({ data }) {
  const { displayId, title, statusColor, statusLabel, taskType, dueDate, assignee } = data;
  // dueDate는 date-only다 — timezone 변환 없이 컴포넌트 그대로 표시한다.
  const { formatDateOnlyShort } = useDateFormat();

  return (
    <div className="TaskNode__Card">
      <Handle type="target" position={Position.Left} className="TaskNode__Handle" />
      <div className="TaskNode__Header">
        <TaskTypeIcon type={taskType} size={13} />
        <span className="TaskNode__DisplayId">{displayId}</span>
      </div>
      <div className="TaskNode__Title">{title}</div>
      <div className="TaskNode__Footer">
        <span className="TaskNode__StatusDot" style={{ backgroundColor: statusColor }} />
        <span className="TaskNode__StatusLabel">{statusLabel}</span>
        {(dueDate || assignee) && (
          <div className="TaskNode__FooterRight">
            {dueDate && (
              <span className="TaskNode__DueDate">
                {formatDateOnlyShort(dueDate)}
              </span>
            )}
            {assignee && (
              <Avatar user={assignee} size={20} className="TaskNode__Avatar" />
            )}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="TaskNode__Handle" />
    </div>
  );
}

export default memo(TaskNode);
