import { useState } from 'react';
import { X } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useTranslation } from 'react-i18next';

export default function CreateIssue({ branchId, taskId, onClose }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || loading) return;

    setError('');
    setLoading(true);
    try {
      const res = await axios.post(`/branches/${branchId}/tasks/${taskId}/issues`, {
        title: title.trim(),
        body: body.trim() || null,
      });
      if (res.data.status) {
        window.dispatchEvent(new Event('issue:created'));
        onClose();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('modal.createIssue.createFailed');
        setError(msg);
      }
    } catch {
      setError(t('modal.createIssue.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="CreateIssue__Backdrop" onClick={onClose}>
      <form className="CreateIssue" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="CreateIssue__Header">
          <h2 className="CreateIssue__Title">{t('modal.createIssue.title')}</h2>
          <button type="button" className="CreateIssue__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="CreateIssue__Body">
          <div className="CreateIssue__Field">
            <label className="CreateIssue__Label">{t('modal.fields.title')}</label>
            <input
              className="CreateIssue__Input"
              type="text"
              placeholder={t('modal.createIssue.titlePlaceholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="CreateIssue__Field">
            <label className="CreateIssue__Label">{t('modal.fields.description')}</label>
            <textarea
              className="CreateIssue__Textarea"
              placeholder={t('modal.createIssue.descriptionPlaceholder')}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
            />
          </div>

          {error && <div className="CreateIssue__Error">{error}</div>}
        </div>

        <div className="CreateIssue__Footer">
          <button type="button" className="CreateIssue__CancelBtn" onClick={onClose}>
            {t('common.actions.cancel')}
          </button>
          <button type="submit" className="CreateIssue__SubmitBtn" disabled={!title.trim() || loading}>
            {loading ? t('modal.creating') : t('common.actions.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
