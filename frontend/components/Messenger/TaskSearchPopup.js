import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ListTodo } from 'lucide-react';
import { axios } from '@/library/_axios';
import { entityTintStyle } from '@/library/entityTint';

const formatStatusKey = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function TaskSearchPopup({ keyword, mode, onSelect, onClose }) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  // 디바운스 검색
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get('/chat/task-search', {
          params: { q: keyword, mode },
        });
        if (res.data.status) {
          setTasks(res.data.tasks);
          setActiveIdx(0);
        }
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [keyword, mode]);

  // 키보드 네비게이션 (부모 textarea에서 호출)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((prev) => Math.min(prev + 1, tasks.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (tasks[activeIdx]) onSelect(tasks[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tasks, activeIdx, onSelect, onClose]);

  return (
    <div className="TaskSearchPopup">
      <div className="TaskSearchPopup__Header">
        <Search size={12} />
        {mode === 'my' ? t('messenger.search.myTasksHeader') : t('messenger.search.allTasksHeader')}
      </div>
      <ul className="TaskSearchPopup__List">
        {loading && <li className="TaskSearchPopup__Empty">{t('messenger.search.searching')}</li>}
        {!loading && tasks.length === 0 && (
          <li className="TaskSearchPopup__Empty">{t('messenger.search.noTasks')}</li>
        )}
        {!loading && tasks.map((task, idx) => (
          <li
            key={task.task_id}
            className={`TaskSearchPopup__Item ${idx === activeIdx ? 'TaskSearchPopup__Item--active' : ''}`}
            onClick={() => onSelect(task)}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <ListTodo size={12} className="TaskSearchPopup__ItemIcon" />
            <span className="TaskSearchPopup__ItemId">{task.display_id}</span>
            <span className="TaskSearchPopup__ItemTitle">{task.title}</span>
            {(() => {
              // 저장색이 없거나 지원 밖이면 EntityTint 없이 category 클래스가 배경·글자색을 준다.
              // 팝업이 --color-surface-overlay 위에 떠 있다. 선택 안 한 항목의 부모가 그 표면이고
              // 다크에서 --color-surface보다 밝아 default로 계산하면 idle에서 31색 중 17색이 미달이었다.
              const tint = entityTintStyle(task.status_color, { alpha: '20', surface: 'surface-overlay' });
              return (
                <span
                  className={`TaskSearchPopup__ItemStatus TaskSearchPopup__ItemStatus--${task.status_category || task.status}${tint?.['--et-on'] ? ' EntityTint' : ''}`}
                  style={tint}
                >
                  {task.status_label || formatStatusKey(task.status)}
                </span>
              );
            })()}
            {(() => {
              const main = (task.assignees || []).find((a) => a.role === 'main');
              return main ? <span className="TaskSearchPopup__ItemAssignee">{main.username}</span> : null;
            })()}
          </li>
        ))}
      </ul>
    </div>
  );
}
