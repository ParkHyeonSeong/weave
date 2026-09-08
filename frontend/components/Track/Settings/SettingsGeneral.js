import { useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { Lock, Globe, AlertTriangle } from 'lucide-react';
import { axios } from '@/library/_axios';
import { showToast } from '@/components/Layout/Toast';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import AppearanceSection from '@/components/common/AppearanceSection';
import { HEX_RE, DEFAULT_TRACK_COLOR } from './constants';

export default function SettingsGeneral({ trackId, track, isOwner, onUpdated }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [trackName, setTrackName] = useState(track.track_name || '');
  const [description, setDescription] = useState(track.description || '');
  const [color, setColor] = useState(track.color || DEFAULT_TRACK_COLOR);
  const [icon, setIcon] = useState(track.icon || null);
  const [visibility, setVisibility] = useState(track.visibility || 'private');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const colorValid = HEX_RE.test(color);
  const nameValid = trackName.trim().length > 0 && trackName.length <= 300;
  const dirty =
    trackName !== (track.track_name || '')
    || description !== (track.description || '')
    || color !== (track.color || DEFAULT_TRACK_COLOR)
    || icon !== (track.icon || null)
    || visibility !== (track.visibility || 'private');

  const canSave = isOwner && dirty && nameValid && colorValid && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await axios.patch(`/tracks/${trackId}`, {
        track_name: trackName.trim(),
        description: description.trim() || null,
        color,
        icon,
        visibility,
      });
      if (res.data.status) {
        setSaved(true);
        onUpdated?.();
        window.dispatchEvent(new Event('track:updated'));
        setTimeout(() => setSaved(false), 2000);
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('trackSettings.general.saveFailed');
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('trackSettings.general.saveFailed'), 'error');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (deleteInput !== track.track_name || deleting) return;
    setDeleting(true);
    try {
      const res = await axios.delete(`/tracks/${trackId}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('track:updated'));
        router.replace('/tracks');
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('trackSettings.general.deleteFailed');
        showToast(msg, 'error');
        setDeleting(false);
      }
    } catch {
      showToast(t('trackSettings.general.deleteFailed'), 'error');
      setDeleting(false);
    }
  };

  return (
    <div className="SettingsGeneral">
      {/* Track Name */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('trackSettings.general.trackName')}</label>
        <input
          className="SettingsGeneral__Input"
          value={trackName}
          onChange={(e) => setTrackName(e.target.value)}
          disabled={!isOwner}
          maxLength={300}
        />
        {!nameValid && trackName.length === 0 && isOwner && (
          <span className="SettingsGeneral__Error">{t('trackSettings.general.nameRequired')}</span>
        )}
      </div>

      {/* Description */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('trackSettings.general.description')}</label>
        <textarea
          className="SettingsGeneral__Textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={t('trackSettings.general.descriptionPlaceholder')}
          disabled={!isOwner}
        />
      </div>

      {/* Appearance */}
      <AppearanceSection
        icon={icon}
        color={color}
        entityType="track"
        entityId={trackId}
        disabled={!isOwner}
        onChange={({ icon: newIcon, color: newColor }) => {
          setIcon(newIcon);
          setColor(newColor);
        }}
      />

      {/* Visibility */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('trackSettings.general.visibility')}</label>
        <div className="SettingsGeneral__VisibilityGroup">
          <button
            type="button"
            className={`SettingsGeneral__VisibilityBtn ${visibility === 'private' ? 'SettingsGeneral__VisibilityBtn--active' : ''}`}
            onClick={() => isOwner && setVisibility('private')}
            disabled={!isOwner}
          >
            <Lock size={14} />
            {t('trackSettings.general.private')}
          </button>
          <button
            type="button"
            className={`SettingsGeneral__VisibilityBtn ${visibility === 'public' ? 'SettingsGeneral__VisibilityBtn--active' : ''}`}
            onClick={() => isOwner && setVisibility('public')}
            disabled={!isOwner}
          >
            <Globe size={14} />
            {t('trackSettings.general.public')}
          </button>
        </div>
        <span className="SettingsGeneral__Hint">
          {visibility === 'private'
            ? t('trackSettings.general.privateHint')
            : t('trackSettings.general.publicHint')}
        </span>
      </div>

      {/* Save */}
      {isOwner && (
        <div className="SettingsGeneral__Actions">
          <button
            className="SettingsGeneral__SaveBtn"
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving
              ? t('common.state.saving')
              : saved ? t('trackSettings.general.saved') : t('trackSettings.general.saveChanges')}
          </button>
        </div>
      )}

      {/* Danger Zone */}
      {isOwner && (
        <div className="SettingsGeneral__Danger">
          <div className="SettingsGeneral__DangerHeader">
            <AlertTriangle size={16} />
            <span>{t('trackSettings.general.dangerZone')}</span>
          </div>

          {!showDeleteConfirm ? (
            <div className="SettingsGeneral__DangerRow">
              <div className="SettingsGeneral__DangerInfo">
                <span className="SettingsGeneral__DangerTitle">{t('trackSettings.general.archiveTitle')}</span>
                <span className="SettingsGeneral__DangerDesc">
                  {t('trackSettings.general.archiveDesc')}
                </span>
              </div>
              <button
                className="SettingsGeneral__DeleteBtn"
                onClick={() => setShowDeleteConfirm(true)}
              >
                {t('spaceMenu.archive')}
              </button>
            </div>
          ) : (
            <div className="SettingsGeneral__DeleteConfirm">
              <p className="SettingsGeneral__DeleteWarning">
                {t('trackSettings.general.archiveConfirmBefore')}{' '}
                <strong>{track.track_name}</strong>{t('trackSettings.general.archiveConfirmAfter')}
              </p>
              <input
                className="SettingsGeneral__Input"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={track.track_name}
              />
              <div className="SettingsGeneral__DeleteActions">
                <button
                  className="SettingsGeneral__DeleteConfirmBtn"
                  disabled={deleteInput !== track.track_name || deleting}
                  onClick={handleDelete}
                >
                  {deleting ? t('trackSettings.general.archiving') : t('spaceMenu.archive')}
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
