import { useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import { Globe, Lock, AlertTriangle } from 'lucide-react';
import AppearanceSection from '@/components/common/AppearanceSection';
import { DEFAULT_COLORS } from '@/library/entityAppearance';
import { getErrorCode } from '@/library/errorCode';

export default function SettingsGeneral({ canvasId, canvas, isAdmin, onUpdated }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [canvasName, setCanvasName] = useState(canvas?.canvas_name || '');
  const [key, setKey] = useState(canvas?.key || '');
  const [keyError, setKeyError] = useState('');
  const [description, setDescription] = useState(canvas?.description || '');
  const [visibility, setVisibility] = useState(canvas?.visibility || 'private');
  const [color, setColor] = useState(canvas?.color || DEFAULT_COLORS.canvas);
  const [icon, setIcon] = useState(canvas?.icon || null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleKeyChange = (v) => {
    const upper = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setKey(upper);
    if (upper && !/^[A-Z][A-Z0-9]{1,9}$/.test(upper)) {
      setKeyError(t('canvasExt.settings.keyRule'));
    } else {
      setKeyError('');
    }
  };

  const handleSave = async () => {
    if (!canvasName.trim() || !key.trim() || keyError || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await axios.patch(`/canvases/${canvasId}`, {
        canvas_name: canvasName.trim(),
        key: key.trim(),
        description: description.trim() || null,
        visibility,
        color,
        icon,
      });
      if (res.data.status) {
        setSaved(true);
        if (onUpdated) onUpdated();
        window.dispatchEvent(new Event('canvas:created'));
        setTimeout(() => setSaved(false), 2000);
      } else if (getErrorCode(res.data) === 'KEY_ALREADY_EXISTS') {
        setKeyError(t('errors.KEY_ALREADY_EXISTS'));
      }
    } catch {}
    setSaving(false);
  };

  return (
    <div className="SettingsGeneral">
      {/* Appearance */}
      <AppearanceSection
        icon={icon}
        color={color}
        entityType="canvas"
        entityId={canvasId}
        disabled={!isAdmin}
        onChange={({ icon: newIcon, color: newColor }) => {
          setIcon(newIcon);
          setColor(newColor);
        }}
      />

      {/* Canvas Name */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('canvasExt.settings.canvasName')}</label>
        <input
          className="SettingsGeneral__Input"
          value={canvasName}
          onChange={(e) => setCanvasName(e.target.value)}
          disabled={!isAdmin}
        />
      </div>

      {/* Key */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('canvasExt.settings.key')}</label>
        <input
          className={`SettingsGeneral__Input ${!isAdmin ? 'SettingsGeneral__Input--readonly' : ''}`}
          value={key}
          onChange={(e) => handleKeyChange(e.target.value)}
          disabled={!isAdmin}
          maxLength={10}
        />
        {keyError && <span className="SettingsGeneral__Error">{keyError}</span>}
        {isAdmin && !keyError && (
          <span className="SettingsGeneral__Hint">
            {t('canvasExt.settings.keyRule')}
          </span>
        )}
      </div>

      {/* Description */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('canvasExt.settings.description')}</label>
        <textarea
          className="SettingsGeneral__Textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={t('canvasExt.settings.descriptionPlaceholder')}
          disabled={!isAdmin}
        />
      </div>

      {/* Visibility */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('canvasExt.settings.visibility')}</label>
        <div className="SettingsGeneral__VisibilityGroup">
          <button
            type="button"
            className={`SettingsGeneral__VisibilityBtn ${visibility === 'private' ? 'SettingsGeneral__VisibilityBtn--active' : ''}`}
            onClick={() => isAdmin && setVisibility('private')}
            disabled={!isAdmin}
          >
            <Lock size={14} />
            {t('canvasExt.settings.private')}
          </button>
          <button
            type="button"
            className={`SettingsGeneral__VisibilityBtn ${visibility === 'public' ? 'SettingsGeneral__VisibilityBtn--active' : ''}`}
            onClick={() => isAdmin && setVisibility('public')}
            disabled={!isAdmin}
          >
            <Globe size={14} />
            {t('canvasExt.settings.public')}
          </button>
        </div>
        <span className="SettingsGeneral__Hint">
          {visibility === 'private'
            ? t('canvasExt.settings.privateHint')
            : t('canvasExt.settings.publicHint')}
        </span>
      </div>

      {/* 저장 버튼 */}
      {isAdmin && (
        <div className="SettingsGeneral__Actions">
          <button
            className="SettingsGeneral__SaveBtn"
            onClick={handleSave}
            disabled={!canvasName.trim() || !key.trim() || keyError || saving}
          >
            {saving ? t('common.state.saving') : saved ? t('canvasExt.settings.saved') : t('canvasExt.settings.saveChanges')}
          </button>
        </div>
      )}

      {/* Danger Zone */}
      {isAdmin && (
        <div className="SettingsGeneral__Danger">
          <div className="SettingsGeneral__DangerHeader">
            <AlertTriangle size={16} />
            <span>{t('canvasExt.settings.dangerZone')}</span>
          </div>

          {!showDeleteConfirm ? (
            <div className="SettingsGeneral__DangerRow">
              <div className="SettingsGeneral__DangerInfo">
                <span className="SettingsGeneral__DangerTitle">{t('canvasExt.settings.archiveTitle')}</span>
                <span className="SettingsGeneral__DangerDesc">
                  {t('canvasExt.settings.archiveDesc')}
                </span>
              </div>
              <button
                className="SettingsGeneral__DeleteBtn"
                onClick={() => setShowDeleteConfirm(true)}
              >
                {t('canvasExt.settings.archive')}
              </button>
            </div>
          ) : (
            <div className="SettingsGeneral__DeleteConfirm">
              <p className="SettingsGeneral__DeleteWarning">
                {t('canvasExt.settings.archiveConfirmIntro')} <strong>{canvas?.key}</strong> {t('canvasExt.settings.archiveConfirmOutro')}
              </p>
              <input
                className="SettingsGeneral__Input"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={canvas?.key}
              />
              <div className="SettingsGeneral__DeleteActions">
                <button
                  className="SettingsGeneral__DeleteConfirmBtn"
                  disabled={deleteInput !== canvas?.key || deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      const res = await axios.delete(`/canvases/${canvasId}`);
                      if (res.data.status) {
                        window.dispatchEvent(new Event('canvas:created'));
                        router.replace('/canvas');
                      }
                    } catch {}
                    setDeleting(false);
                  }}
                >
                  {deleting ? t('canvasExt.settings.archiving') : t('canvasExt.settings.archive')}
                </button>
                <button
                  className="SettingsGeneral__CancelBtn"
                  onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                >
                  {t('common.actions.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
