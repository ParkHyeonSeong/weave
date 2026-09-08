import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { axios } from '@/library/_axios';
import DatePicker from '@/components/common/DatePicker';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useTranslation } from 'react-i18next';

const COLORS = ['#5E6AD2', '#2563EB', '#DC2626', '#16A34A', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4'];

export default function EpicModal({ branchId, epic, onClose }) {
  const { t } = useTranslation();
  const isEdit = !!epic;

  const [epicName, setEpicName] = useState(epic?.epic_name || '');
  const [description, setDescription] = useState(epic?.description || '');
  const [status, setStatus] = useState(epic?.status || 'todo');
  const [color, setColor] = useState(epic?.color || '#5E6AD2');
  const [startDate, setStartDate] = useState(epic?.start_date || '');
  const [dueDate, setDueDate] = useState(epic?.due_date || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [workflowStatuses, setWorkflowStatuses] = useState([]);

  useEffect(() => {
    const fetchStatuses = async () => {
      try {
        const res = await axios.get(`/branches/${branchId}/workflow-statuses`);
        if (res.data.status) setWorkflowStatuses(res.data.statuses);
      } catch {}
    };
    fetchStatuses();
  }, [branchId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!epicName.trim() || loading) return;

    setError('');
    setLoading(true);
    try {
      const payload = {
        epic_name: epicName.trim(),
        description: description.trim() || null,
        status,
        color,
        start_date: startDate || null,
        due_date: dueDate || null,
      };

      let res;
      if (isEdit) {
        res = await axios.patch(`/branches/${branchId}/epics/${epic.epic_id}`, payload);
      } else {
        res = await axios.post(`/branches/${branchId}/epics`, payload);
      }

      if (res.data.status) {
        window.dispatchEvent(new Event('epic:updated'));
        onClose();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('modal.epic.saveFailed');
        setError(msg);
      }
    } catch {
      setError(t('modal.epic.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || loading) return;
    setLoading(true);
    try {
      const res = await axios.delete(`/branches/${branchId}/epics/${epic.epic_id}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('epic:updated'));
        onClose();
      }
    } catch {
      setError(t('modal.epic.deleteFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="EpicModal__Backdrop" onClick={onClose}>
      <form className="EpicModal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="EpicModal__Header">
          <h2 className="EpicModal__Title">{isEdit ? t('modal.epic.editTitle') : t('modal.epic.newTitle')}</h2>
          <button type="button" className="EpicModal__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="EpicModal__Body">
          {/* 이름 */}
          <div className="EpicModal__Field">
            <label className="EpicModal__Label">{t('modal.fields.name')}</label>
            <input
              className="EpicModal__Input"
              type="text"
              placeholder={t('modal.epic.namePlaceholder')}
              value={epicName}
              onChange={(e) => setEpicName(e.target.value)}
              autoFocus
              required
            />
          </div>

          {/* 설명 */}
          <div className="EpicModal__Field">
            <label className="EpicModal__Label">{t('modal.fields.description')}</label>
            <textarea
              className="EpicModal__Textarea"
              placeholder={t('modal.epic.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* 상태 + 색상 */}
          <div className="EpicModal__Row">
            <div className="EpicModal__Field EpicModal__Field--half">
              <label className="EpicModal__Label">{t('modal.fields.status')}</label>
              <select className="EpicModal__Select" value={status} onChange={(e) => setStatus(e.target.value)}>
                {workflowStatuses.length > 0 ? (
                  workflowStatuses.map((ws) => (
                    <option key={ws.key} value={ws.key}>{ws.label}</option>
                  ))
                ) : (
                  <>
                    <option value="todo">{t('modal.epic.statusTodo')}</option>
                    <option value="in_progress">{t('modal.epic.statusInProgress')}</option>
                    <option value="done">{t('modal.epic.statusDone')}</option>
                  </>
                )}
              </select>
            </div>
            <div className="EpicModal__Field EpicModal__Field--half">
              <label className="EpicModal__Label">{t('modal.fields.color')}</label>
              <div className="EpicModal__Colors">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`EpicModal__ColorBtn ${color === c ? 'EpicModal__ColorBtn--selected' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* 날짜 */}
          <div className="EpicModal__Row">
            <div className="EpicModal__Field EpicModal__Field--half">
              <label className="EpicModal__Label">{t('modal.fields.startDate')}</label>
              <DatePicker
                value={startDate || null}
                onChange={(val) => setStartDate(val || '')}
                max={dueDate || null}
              />
            </div>
            <div className="EpicModal__Field EpicModal__Field--half">
              <label className="EpicModal__Label">{t('modal.fields.dueDate')}</label>
              <DatePicker
                value={dueDate || null}
                onChange={(val) => setDueDate(val || '')}
                min={startDate || null}
              />
            </div>
          </div>

          {error && <div className="EpicModal__Error">{error}</div>}
        </div>

        <div className="EpicModal__Footer">
          {isEdit && (
            <button type="button" className="EpicModal__DeleteBtn" onClick={handleDelete} disabled={loading}>
              {t('common.actions.delete')}
            </button>
          )}
          <div className="EpicModal__FooterRight">
            <button type="button" className="EpicModal__CancelBtn" onClick={onClose}>
              {t('common.actions.cancel')}
            </button>
            <button type="submit" className="EpicModal__SubmitBtn" disabled={!epicName.trim() || loading}>
              {loading ? t('common.state.saving') : isEdit ? t('modal.update') : t('common.actions.create')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
