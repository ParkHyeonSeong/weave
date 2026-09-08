import { useTranslation } from 'react-i18next';
import { X, ListTodo } from 'lucide-react';
import NavLink from '@/components/common/NavLink';
import { entityTintStyle } from '@/library/entityTint';

// snake_case key를 Title Case로 변환 (fallback용)
const formatStatusKey = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const PRIORITY_KEYS = {
  low: 'messenger.priority.low',
  medium: 'messenger.priority.medium',
  high: 'messenger.priority.high',
  urgent: 'messenger.priority.urgent',
};

export default function TaskRefCard({ taskRef, removable, onRemove }) {
  const { t } = useTranslation();
  if (!taskRef) return null;

  // 클릭 가능(전송된 메시지 안의 칩)일 때만 링크. compose 프리뷰(removable)는 Remove 버튼만 있고 이동 안 함.
  const navUrl = !removable && taskRef.branch_id
    ? `/branch/${taskRef.branch_id}/task/${taskRef.task_id}`
    : null;

  const content = (
    <>
      <div className="TaskRefCard__Header">
        <ListTodo size={12} className="TaskRefCard__Icon" />
        <span className="TaskRefCard__DisplayId">{taskRef.display_id}</span>
        <span className={`TaskRefCard__Priority TaskRefCard__Priority--${taskRef.priority}`}>
          {PRIORITY_KEYS[taskRef.priority] ? t(PRIORITY_KEYS[taskRef.priority]) : taskRef.priority}
        </span>
        {removable && (
          <button className="TaskRefCard__Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
            <X size={12} />
          </button>
        )}
      </div>
      <div className="TaskRefCard__Title">{taskRef.title}</div>
      <div className="TaskRefCard__Footer">
        {(() => {
          // 저장색이 없거나 지원 밖이면 EntityTint 없이 category 클래스가 배경·글자색을 준다.
          const tint = entityTintStyle(taskRef.status_color, { alpha: '20' });
          return (
            <span
              className={`TaskRefCard__Status TaskRefCard__Status--${taskRef.status_category || taskRef.status}${tint?.['--et-on'] ? ' EntityTint' : ''}`}
              style={tint}
            >
              {taskRef.status_label || formatStatusKey(taskRef.status)}
            </span>
          );
        })()}
        {(() => {
          const main = (taskRef.assignees || []).find((a) => a.role === 'main');
          return main ? <span className="TaskRefCard__Assignee">{main.username}</span> : null;
        })()}
      </div>
    </>
  );

  if (navUrl) {
    return <NavLink className="TaskRefCard TaskRefCard--clickable" href={navUrl}>{content}</NavLink>;
  }
  return <div className="TaskRefCard">{content}</div>;
}
