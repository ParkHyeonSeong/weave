import { useState } from 'react';
import { X, Globe, Lock } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getErrorCode } from '@/library/errorCode';
import { useTranslation } from 'react-i18next';

export default function CreateBranch({ onClose }) {
  const { t } = useTranslation();
  const [branchName, setBranchName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Key 입력: 대문자 영문 + 숫자만 허용, 최대 10자
  const handleKeyChange = (e) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    setKey(value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!branchName.trim() || key.length < 2 || loading) return;

    setError('');
    setLoading(true);
    try {
      const res = await axios.post('/branches', {
        branch_name: branchName.trim(),
        key: key.trim(),
        description: description.trim() || null,
        visibility,
      });
      if (res.data.status) {
        // Sidebar 목록 갱신 이벤트
        window.dispatchEvent(new Event('branch:created'));
        onClose();
      } else if (getErrorCode(res.data) === 'KEY_ALREADY_EXISTS') {
        setError(t('errors.KEY_ALREADY_EXISTS'));
      }
    } catch {
      setError(t('modal.createBranch.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="CreateBranch__Backdrop" onClick={onClose}>
      <form className="CreateBranch" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="CreateBranch__Header">
          <h2 className="CreateBranch__Title">{t('modal.createBranch.title')}</h2>
          <button type="button" className="CreateBranch__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="CreateBranch__Body">
          <div className="CreateBranch__Field">
            <label className="CreateBranch__Label">{t('modal.createBranch.nameLabel')}</label>
            <input
              className="CreateBranch__Input"
              type="text"
              placeholder={t('modal.createBranch.namePlaceholder')}
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="CreateBranch__Field">
            <label className="CreateBranch__Label">{t('modal.fields.key')}</label>
            <input
              className="CreateBranch__Input CreateBranch__Input--key"
              type="text"
              placeholder={t('modal.createBranch.keyPlaceholder')}
              value={key}
              onChange={handleKeyChange}
            />
            <span className="CreateBranch__Hint">
              {t('modal.createBranch.keyHint', { key: key || '___' })}
            </span>
          </div>

          <div className="CreateBranch__Field">
            <label className="CreateBranch__Label">{t('modal.fields.description')}</label>
            <textarea
              className="CreateBranch__Textarea"
              placeholder={t('modal.createBranch.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="CreateBranch__Field">
            <label className="CreateBranch__Label">{t('modal.visibility.label')}</label>
            <div className="CreateBranch__VisibilityGroup">
              <button
                type="button"
                className={`CreateBranch__VisibilityBtn ${visibility === 'private' ? 'CreateBranch__VisibilityBtn--active' : ''}`}
                onClick={() => setVisibility('private')}
              >
                <Lock size={14} />
                {t('modal.visibility.private')}
              </button>
              <button
                type="button"
                className={`CreateBranch__VisibilityBtn ${visibility === 'public' ? 'CreateBranch__VisibilityBtn--active' : ''}`}
                onClick={() => setVisibility('public')}
              >
                <Globe size={14} />
                {t('modal.visibility.public')}
              </button>
            </div>
            <span className="CreateBranch__Hint">
              {visibility === 'private'
                ? t('modal.createBranch.privateHint')
                : t('modal.createBranch.publicHint')}
            </span>
          </div>

          {error && <div className="CreateBranch__Error">{error}</div>}
        </div>

        <div className="CreateBranch__Footer">
          <button type="button" className="CreateBranch__CancelBtn" onClick={onClose}>
            {t('common.actions.cancel')}
          </button>
          <button
            type="submit"
            className="CreateBranch__SubmitBtn"
            disabled={!branchName.trim() || key.length < 2 || loading}
          >
            {loading ? t('modal.creating') : t('common.actions.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
