import { useState } from 'react';
import { X } from 'lucide-react';
import { axios } from '@/library/_axios';
import DatePicker from '@/components/common/DatePicker';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useTranslation } from 'react-i18next';

export default function SprintModal({ branchId, sprint, onClose }) {
  const { t } = useTranslation();
  const isEdit = !!sprint?.sprint_id;

  const [sprintName, setSprintName] = useState(sprint?.sprint_name || '');
  const [goal, setGoal] = useState(sprint?.goal || '');
  const [startDate, setStartDate] = useState(sprint?.start_date || '');
  const [endDate, setEndDate] = useState(sprint?.end_date || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!sprintName.trim() || loading) return;

    setError('');
    setLoading(true);
    try {
      const payload = {
        sprint_name: sprintName.trim(),
        goal: goal.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
      };

      let res;
      if (isEdit) {
        res = await axios.patch(`/branches/${branchId}/sprints/${sprint.sprint_id}`, payload);
      } else {
        res = await axios.post(`/branches/${branchId}/sprints`, payload);
      }

      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
        onClose();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('modal.sprint.saveFailed');
        setError(msg);
      }
    } catch {
      setError(t('modal.sprint.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || loading) return;
    setLoading(true);
    try {
      const res = await axios.delete(`/branches/${branchId}/sprints/${sprint.sprint_id}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
        onClose();
      }
    } catch {
      setError(t('modal.sprint.deleteFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="SprintModal__Backdrop" onClick={onClose}>
      <form className="SprintModal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="SprintModal__Header">
          <h2 className="SprintModal__Title">{isEdit ? t('modal.sprint.editTitle') : t('modal.sprint.newTitle')}</h2>
          <button type="button" className="SprintModal__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="SprintModal__Body">
          <div className="SprintModal__Field">
            <label className="SprintModal__Label">{t('modal.sprint.nameLabel')}</label>
            <input
              className="SprintModal__Input"
              type="text"
              placeholder={t('modal.sprint.namePlaceholder')}
              value={sprintName}
              onChange={(e) => setSprintName(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="SprintModal__Field">
            <label className="SprintModal__Label">{t('modal.fields.goal')}</label>
            <textarea
              className="SprintModal__Textarea"
              placeholder={t('modal.sprint.goalPlaceholder')}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
            />
          </div>

          <div className="SprintModal__Row">
            <div className="SprintModal__Field SprintModal__Field--half">
              <label className="SprintModal__Label">{t('modal.fields.startDate')}</label>
              <DatePicker
                value={startDate || null}
                onChange={(val) => setStartDate(val || '')}
                max={endDate || null}
              />
            </div>
            <div className="SprintModal__Field SprintModal__Field--half">
              <label className="SprintModal__Label">{t('modal.fields.endDate')}</label>
              <DatePicker
                value={endDate || null}
                onChange={(val) => setEndDate(val || '')}
                min={startDate || null}
              />
            </div>
          </div>

          {error && <div className="SprintModal__Error">{error}</div>}
        </div>

        <div className="SprintModal__Footer">
          {isEdit && (
            <button type="button" className="SprintModal__DeleteBtn" onClick={handleDelete} disabled={loading}>
              {t('common.actions.delete')}
            </button>
          )}
          <div className="SprintModal__FooterRight">
            <button type="button" className="SprintModal__CancelBtn" onClick={onClose}>
              {t('common.actions.cancel')}
            </button>
            <button type="submit" className="SprintModal__SubmitBtn" disabled={!sprintName.trim() || loading}>
              {loading ? t('common.state.saving') : isEdit ? t('modal.update') : t('common.actions.create')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
