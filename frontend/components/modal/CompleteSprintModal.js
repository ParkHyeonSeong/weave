import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useTranslation } from 'react-i18next';

export default function CompleteSprintModal({ branchId, sprint, sprints, onClose }) {
  const { t } = useTranslation();
  const [moveTo, setMoveTo] = useState('backlog');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    fetchCounts();
  }, []);

  const fetchCounts = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/sprints/${sprint.sprint_id}/task-counts`);
      if (res.data.status) {
        setCounts({ done: res.data.done_count, incomplete: res.data.incomplete_count });
      }
    } catch {}
  };

  const handleComplete = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`/branches/${branchId}/sprints/${sprint.sprint_id}/complete`, {
        move_to: moveTo,
      });
      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
        onClose();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('modal.completeSprint.failed');
        setError(msg);
      }
    } catch {
      setError(t('modal.completeSprint.failed'));
    } finally {
      setLoading(false);
    }
  };

  // 이동 대상 sprint 목록 (active + future)
  const targetSprints = sprints || [];

  return (
    <div className="SprintModal__Backdrop" onClick={onClose}>
      <div className="CompleteSprintModal" onClick={(e) => e.stopPropagation()}>
        <div className="CompleteSprintModal__Header">
          <h2 className="CompleteSprintModal__Title">{t('modal.completeSprint.title', { name: sprint.sprint_name })}</h2>
          <button type="button" className="SprintModal__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="CompleteSprintModal__Body">
          {/* Task 수 표시 */}
          {counts && (
            <div className="CompleteSprintModal__Counts">
              <div className="CompleteSprintModal__CountItem">
                <span className="CompleteSprintModal__CountNum CompleteSprintModal__CountNum--done">
                  {counts.done}
                </span>
                <span className="CompleteSprintModal__CountLabel">{t('modal.completeSprint.completedCount')}</span>
              </div>
              <div className="CompleteSprintModal__CountItem">
                <span className="CompleteSprintModal__CountNum CompleteSprintModal__CountNum--incomplete">
                  {counts.incomplete}
                </span>
                <span className="CompleteSprintModal__CountLabel">{t('modal.completeSprint.incompleteCount')}</span>
              </div>
            </div>
          )}

          {/* 미완료 task 이동 옵션 */}
          {counts && counts.incomplete > 0 && (
            <div className="CompleteSprintModal__MoveSection">
              <label className="SprintModal__Label">
                {t('modal.completeSprint.moveLabel', { count: counts.incomplete })}
              </label>
              <select
                className="SprintModal__Select"
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
              >
                <option value="backlog">{t('modal.completeSprint.backlog')}</option>
                {targetSprints.map((s) => (
                  <option key={s.sprint_id} value={String(s.sprint_id)}>
                    {s.sprint_name}{s.status === 'active' ? t('modal.completeSprint.activeSuffix') : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <div className="SprintModal__Error">{error}</div>}
        </div>

        <div className="CompleteSprintModal__Footer">
          <button type="button" className="SprintModal__CancelBtn" onClick={onClose}>
            {t('common.actions.cancel')}
          </button>
          <button
            type="button"
            className="CompleteSprintModal__CompleteBtn"
            onClick={handleComplete}
            disabled={loading}
          >
            {loading ? t('modal.completeSprint.completing') : t('modal.completeSprint.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
