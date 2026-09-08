import { useState } from 'react';
import { X, Globe, Lock } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getErrorCode } from '@/library/errorCode';
import { useTranslation } from 'react-i18next';

export default function CreateCanvas({ onClose }) {
  const { t } = useTranslation();
  const [canvasName, setCanvasName] = useState('');
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
    if (!canvasName.trim() || key.length < 2 || loading) return;

    setError('');
    setLoading(true);
    try {
      const res = await axios.post('/canvases', {
        canvas_name: canvasName.trim(),
        key: key.trim(),
        description: description.trim() || null,
        visibility,
      });
      if (res.data.status) {
        // Sidebar 목록 갱신 이벤트
        window.dispatchEvent(new Event('canvas:created'));
        onClose();
      } else if (getErrorCode(res.data) === 'KEY_ALREADY_EXISTS') {
        setError(t('errors.KEY_ALREADY_EXISTS'));
      }
    } catch {
      setError(t('modal.createCanvas.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="CreateCanvas__Backdrop" onClick={onClose}>
      <form className="CreateCanvas" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="CreateCanvas__Header">
          <h2 className="CreateCanvas__Title">{t('modal.createCanvas.title')}</h2>
          <button type="button" className="CreateCanvas__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="CreateCanvas__Body">
          <div className="CreateCanvas__Field">
            <label className="CreateCanvas__Label">{t('modal.createCanvas.nameLabel')}</label>
            <input
              className="CreateCanvas__Input"
              type="text"
              placeholder={t('modal.createCanvas.namePlaceholder')}
              value={canvasName}
              onChange={(e) => setCanvasName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="CreateCanvas__Field">
            <label className="CreateCanvas__Label">{t('modal.fields.key')}</label>
            <input
              className="CreateCanvas__Input CreateCanvas__Input--key"
              type="text"
              placeholder={t('modal.createCanvas.keyPlaceholder')}
              value={key}
              onChange={handleKeyChange}
            />
            <span className="CreateCanvas__Hint">
              {t('modal.createCanvas.keyHint')}
            </span>
          </div>

          <div className="CreateCanvas__Field">
            <label className="CreateCanvas__Label">{t('modal.fields.description')}</label>
            <textarea
              className="CreateCanvas__Textarea"
              placeholder={t('modal.createCanvas.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="CreateCanvas__Field">
            <label className="CreateCanvas__Label">{t('modal.visibility.label')}</label>
            <div className="CreateCanvas__VisibilityGroup">
              <button
                type="button"
                className={`CreateCanvas__VisibilityBtn ${visibility === 'private' ? 'CreateCanvas__VisibilityBtn--active' : ''}`}
                onClick={() => setVisibility('private')}
              >
                <Lock size={14} />
                {t('modal.visibility.private')}
              </button>
              <button
                type="button"
                className={`CreateCanvas__VisibilityBtn ${visibility === 'public' ? 'CreateCanvas__VisibilityBtn--active' : ''}`}
                onClick={() => setVisibility('public')}
              >
                <Globe size={14} />
                {t('modal.visibility.public')}
              </button>
            </div>
            <span className="CreateCanvas__Hint">
              {visibility === 'private'
                ? t('modal.createCanvas.privateHint')
                : t('modal.createCanvas.publicHint')}
            </span>
          </div>

          {error && <div className="CreateCanvas__Error">{error}</div>}
        </div>

        <div className="CreateCanvas__Footer">
          <button type="button" className="CreateCanvas__CancelBtn" onClick={onClose}>
            {t('common.actions.cancel')}
          </button>
          <button
            type="submit"
            className="CreateCanvas__SubmitBtn"
            disabled={!canvasName.trim() || key.length < 2 || loading}
          >
            {loading ? t('modal.creating') : t('common.actions.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
