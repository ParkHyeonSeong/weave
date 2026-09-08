import { useState } from 'react';
import BoardCard from './BoardCard';
import { useTranslation } from 'react-i18next';

export default function BoardColumn({ status, label, color, tasks, taskTypes, onCardClick, onCardContextMenu, onStatusChange }) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const taskId = Number(e.dataTransfer.getData('text/plain'));
    if (taskId) {
      onStatusChange(taskId, status);
    }
  };

  return (
    <div className={`BoardColumn ${dragOver ? 'BoardColumn--drag-over' : ''}`}>
      <div className="BoardColumn__Header">
        <span className="BoardColumn__Dot" style={color ? { backgroundColor: color } : undefined} />
        <span className="BoardColumn__Label">{label}</span>
        <span className="BoardColumn__Count">{tasks.length}</span>
      </div>

      <div
        className="BoardColumn__Body"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {tasks.map((task) => (
          <BoardCard
            key={task.task_id}
            task={task}
            taskTypes={taskTypes}
            onClick={() => onCardClick(task)}
            onContextMenu={(e) => onCardContextMenu?.(e, task)}
          />
        ))}
        {tasks.length === 0 && (
          <div className="BoardColumn__Empty">{t('branch.board.noTasks')}</div>
        )}
      </div>
    </div>
  );
}
