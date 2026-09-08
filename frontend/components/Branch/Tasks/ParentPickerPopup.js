import { useTranslation } from 'react-i18next';
import { Search, ListTodo } from 'lucide-react';
import { useRefSearchPopup } from '@/components/Canvas/extensions/useRefSearchPopup';

// 상위로 이동할 부모 태스크를 고르는 검색 팝업. taskMenu가 호스팅한다.
export default function ParentPickerPopup({ branchId, sourceTask, onPick, onClose }) {
  const { t } = useTranslation();
  const {
    keyword, setKeyword, items, activeIdx, setActiveIdx, loading,
    inputRef, listRef, finish, handleKeyDown, handleBlur,
  } = useRefSearchPopup({
    url: '/chat/task-search',
    params: { mode: 'all' },
    // 같은 브랜치 + 자기 자신 + 이미 하위인 태스크 제외 (1단계 불변식은 서버 검증)
    pickItems: (data) => (data.tasks || []).filter(
      (t) => t.branch_id === branchId
        && t.task_id !== sourceTask?.task_id
        && t.parent_task_id === null,
    ),
    onSelect: onPick,
    onClose,
    onDismiss: onClose,
    onBack: onClose,
  });

  return (
    <div className="ParentPickerPopup" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ParentPickerPopup__Header">
        <Search size={12} />
        {t('branchTasks.parentPicker.title')}
      </div>
      <div className="ParentPickerPopup__Search">
        <input
          ref={inputRef}
          value={keyword}
          placeholder={t('branchTasks.parentPicker.searchPlaceholder')}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />
      </div>
      <ul className="ParentPickerPopup__List" ref={listRef}>
        {loading && <li className="ParentPickerPopup__Empty">{t('branchTasks.parentPicker.searching')}</li>}
        {!loading && items.length === 0 && (
          <li className="ParentPickerPopup__Empty">{t('branchTasks.parentPicker.noTasks')}</li>
        )}
        {!loading && items.map((task, idx) => (
          <li
            key={task.task_id}
            className={`ParentPickerPopup__Item ${idx === activeIdx ? 'ParentPickerPopup__Item--active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => finish(() => onPick(task))}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <ListTodo size={12} className="ParentPickerPopup__ItemIcon" />
            <span className="ParentPickerPopup__ItemId">{task.display_id}</span>
            <span className="ParentPickerPopup__ItemTitle">{task.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
