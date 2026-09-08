import { useState } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { getErrorCode } from '@/library/errorCode';
import { Globe, Lock, AlertTriangle, Upload } from 'lucide-react';
import JiraMigrationModal from './JiraMigrationModal';
import AppearanceSection from '@/components/common/AppearanceSection';
import { DEFAULT_COLORS } from '@/library/entityAppearance';
import { useTranslation } from 'react-i18next';

export default function SettingsGeneral({ branchId, branch, isAdmin, onUpdated }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [branchName, setBranchName] = useState(branch?.branch_name || '');
  const [key, setKey] = useState(branch?.key || '');
  const [keyError, setKeyError] = useState('');
  const [description, setDescription] = useState(branch?.description || '');
  const [visibility, setVisibility] = useState(branch?.visibility || 'private');
  const [color, setColor] = useState(branch?.color || DEFAULT_COLORS.branch);
  const [icon, setIcon] = useState(branch?.icon || null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showJiraMigration, setShowJiraMigration] = useState(false);

  const handleKeyChange = (v) => {
    const upper = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setKey(upper);
    if (upper && !/^[A-Z][A-Z0-9]{1,9}$/.test(upper)) {
      setKeyError(t('branch2.general.keyFormatError'));
    } else {
      setKeyError('');
    }
  };

  const handleSave = async () => {
    if (!branchName.trim() || !key.trim() || keyError || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await axios.patch(`/branches/${branchId}`, {
        branch_name: branchName.trim(),
        key: key.trim(),
        description: description.trim() || null,
        visibility,
        color,
        icon,
      });
      if (res.data.status) {
        setSaved(true);
        if (onUpdated) onUpdated();
        window.dispatchEvent(new Event('branch:created'));
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
        entityType="branch"
        entityId={branchId}
        disabled={!isAdmin}
        onChange={({ icon: newIcon, color: newColor }) => {
          setIcon(newIcon);
          setColor(newColor);
        }}
      />

      {/* Branch Name */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('branch2.general.branchName')}</label>
        <input
          className="SettingsGeneral__Input"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          disabled={!isAdmin}
        />
      </div>

      {/* Key */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('branch2.general.key')}</label>
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
            {t('branch2.general.keyChangeHint', { oldKey: branch?.key || '', newKey: key || '?' })}
          </span>
        )}
      </div>

      {/* Description */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('branch2.general.description')}</label>
        <textarea
          className="SettingsGeneral__Textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={t('branch2.general.descriptionPlaceholder')}
          disabled={!isAdmin}
        />
      </div>

      {/* Visibility */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('branch2.general.visibility')}</label>
        <div className="SettingsGeneral__VisibilityGroup">
          <button
            type="button"
            className={`SettingsGeneral__VisibilityBtn ${visibility === 'private' ? 'SettingsGeneral__VisibilityBtn--active' : ''}`}
            onClick={() => isAdmin && setVisibility('private')}
            disabled={!isAdmin}
          >
            <Lock size={14} />
            {t('branch2.general.visibilityPrivate')}
          </button>
          <button
            type="button"
            className={`SettingsGeneral__VisibilityBtn ${visibility === 'public' ? 'SettingsGeneral__VisibilityBtn--active' : ''}`}
            onClick={() => isAdmin && setVisibility('public')}
            disabled={!isAdmin}
          >
            <Globe size={14} />
            {t('branch2.general.visibilityPublic')}
          </button>
        </div>
        <span className="SettingsGeneral__Hint">
          {visibility === 'private'
            ? t('branch2.general.privateHint')
            : t('branch2.general.publicHint')}
        </span>
      </div>

      {/* 저장 버튼 */}
      {isAdmin && (
        <div className="SettingsGeneral__Actions">
          <button
            className="SettingsGeneral__SaveBtn"
            onClick={handleSave}
            disabled={!branchName.trim() || !key.trim() || keyError || saving}
          >
            {saving ? t('common.state.saving') : saved ? t('branch2.saved') : t('branch2.saveChanges')}
          </button>
        </div>
      )}

      {/* Import from Jira */}
      {isAdmin && (
        <div className="SettingsGeneral__Actions">
          <button
            className="SettingsGeneral__ImportBtn"
            onClick={() => setShowJiraMigration(true)}
          >
            <Upload size={14} />
            {t('branch2.general.importFromJira')}
          </button>
        </div>
      )}

      {/* Danger Zone */}
      {isAdmin && (
        <div className="SettingsGeneral__Danger">
          <div className="SettingsGeneral__DangerHeader">
            <AlertTriangle size={16} />
            <span>{t('branch2.general.dangerZone')}</span>
          </div>

          {!showDeleteConfirm ? (
            <div className="SettingsGeneral__DangerRow">
              <div className="SettingsGeneral__DangerInfo">
                <span className="SettingsGeneral__DangerTitle">{t('branch2.general.archiveTitle')}</span>
                <span className="SettingsGeneral__DangerDesc">
                  {t('branch2.general.archiveDesc')}
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
                {t('branch2.general.archiveConfirmLead')}{' '}
                <strong>{branch?.key}</strong>
                {t('branch2.general.archiveConfirmTail')}
              </p>
              <input
                className="SettingsGeneral__Input"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={branch?.key}
              />
              <div className="SettingsGeneral__DeleteActions">
                <button
                  className="SettingsGeneral__DeleteConfirmBtn"
                  disabled={deleteInput !== branch?.key || deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      const res = await axios.delete(`/branches/${branchId}`);
                      if (res.data.status) {
                        window.dispatchEvent(new Event('branch:created'));
                        router.replace('/');
                      }
                    } catch {}
                    setDeleting(false);
                  }}
                >
                  {deleting ? t('branch2.general.archiving') : t('spaceMenu.archive')}
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
      {showJiraMigration && (
        <JiraMigrationModal
          branchId={branchId}
          onClose={() => setShowJiraMigration(false)}
        />
      )}
    </div>
  );
}
