import { useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { Lock, Globe, AlertTriangle, Check } from 'lucide-react';
import { axios } from '@/library/_axios';
import { showToast } from '@/components/Layout/Toast';
import { COLOR_PRESETS, DEFAULT_COLORS } from '@/library/entityAppearance';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

const CADENCES = [
  { v: 'weekly', labelKey: 'scrum.cadence.weekly' },
  { v: 'biweekly', labelKey: 'scrum.cadence.biweekly' },
  { v: 'every_n_weeks', labelKey: 'scrum.cadence.everyNWeeks' },
  { v: 'monthly', labelKey: 'scrum.cadence.monthly' },
  { v: 'manual', labelKey: 'scrum.cadence.manual' },
];
const WEEKDAYS = [['0', 'scrum.grid.mon'], ['1', 'scrum.grid.tue'], ['2', 'scrum.grid.wed'], ['3', 'scrum.grid.thu'], ['4', 'scrum.grid.fri']];
const DEFAULT_SCRUM_COLOR = DEFAULT_COLORS.scrum;

export default function ScrumSettingsGeneral({ board, boardId, isAdmin, onUpdated }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState(board.name || '');
  const [color, setColor] = useState(board.color || DEFAULT_SCRUM_COLOR);
  const [visibility, setVisibility] = useState(board.visibility || 'private');
  const [cadence, setCadence] = useState(board.retro_cadence || 'weekly');
  const [intervalWeeks, setIntervalWeeks] = useState(board.retro_interval_weeks ?? 3);
  const [anchorWeekday, setAnchorWeekday] = useState(board.retro_anchor_weekday ?? 4);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const nameValid = name.trim().length > 0 && name.length <= 300;
  const intervalValid = cadence !== 'every_n_weeks'
    || (Number(intervalWeeks) >= 2 && Number(intervalWeeks) <= 12);

  const dirty =
    name !== (board.name || '')
    || color !== (board.color || DEFAULT_SCRUM_COLOR)
    || visibility !== (board.visibility || 'private')
    || cadence !== (board.retro_cadence || 'weekly')
    || Number(anchorWeekday) !== (board.retro_anchor_weekday ?? 4)
    || (cadence === 'every_n_weeks'
        && Number(intervalWeeks) !== (board.retro_interval_weeks ?? 3));

  const canSave = isAdmin && dirty && nameValid && intervalValid && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await axios.patch(`/scrum/${boardId}`, {
        name: name.trim(),
        color,
        visibility,
        retro_cadence: cadence,
        retro_interval_weeks: cadence === 'every_n_weeks' ? Number(intervalWeeks) : null,
        retro_anchor_weekday: Number(anchorWeekday),
      });
      if (res.data.status) {
        setSaved(true);
        onUpdated?.();
        window.dispatchEvent(new Event('scrum:updated'));
        setTimeout(() => setSaved(false), 2000);
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('scrum.settings.saveFailed');
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('scrum.settings.saveFailed'), 'error');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (deleteInput !== board.name || deleting) return;
    setDeleting(true);
    try {
      const res = await axios.delete(`/scrum/${boardId}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('scrum:updated'));
        router.replace('/scrum');
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('sidebar.archiveFailed');
        showToast(msg, 'error');
        setDeleting(false);
      }
    } catch {
      showToast(t('sidebar.archiveFailed'), 'error');
      setDeleting(false);
    }
  };

  return (
    <div className="SettingsGeneral">
      {/* Board Name */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('scrum.settings.teamName')}</label>
        <input
          className="SettingsGeneral__Input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isAdmin}
          maxLength={300}
        />
        {!nameValid && name.length === 0 && isAdmin && (
          <span className="SettingsGeneral__Error">{t('scrum.settings.nameRequired')}</span>
        )}
      </div>

      {/* Color */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('scrum.settings.color')}</label>
        <div className="SettingsGeneral__ColorRow">
          <div className="SettingsGeneral__Swatches">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`SettingsGeneral__Swatch ${color === c ? 'SettingsGeneral__Swatch--active' : ''}`}
                style={{ background: c }}
                onClick={() => isAdmin && setColor(c)}
                disabled={!isAdmin}
                aria-label={t('scrum.settings.colorAria', { color: c })}
              >
                {color === c && <Check size={13} color="#fff" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Visibility */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('scrum.settings.visibility')}</label>
        <div className="SettingsGeneral__VisibilityGroup">
          <button
            type="button"
            className={`SettingsGeneral__VisibilityBtn ${visibility === 'private' ? 'SettingsGeneral__VisibilityBtn--active' : ''}`}
            onClick={() => isAdmin && setVisibility('private')}
            disabled={!isAdmin}
          >
            <Lock size={14} />
            {t('scrum.settings.visibilityPrivate')}
          </button>
          <button
            type="button"
            className={`SettingsGeneral__VisibilityBtn ${visibility === 'public' ? 'SettingsGeneral__VisibilityBtn--active' : ''}`}
            onClick={() => isAdmin && setVisibility('public')}
            disabled={!isAdmin}
          >
            <Globe size={14} />
            {t('scrum.settings.visibilityPublic')}
          </button>
        </div>
        <span className="SettingsGeneral__Hint">
          {visibility === 'private'
            ? t('scrum.settings.visibilityPrivateHint')
            : t('scrum.settings.visibilityPublicHint')}
        </span>
      </div>

      {/* Retro cadence */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('scrum.settings.retroCadence')}</label>
        <div className="Scrum__ChipRow">
          {CADENCES.map((c) => (
            <button
              key={c.v}
              type="button"
              className={`Scrum__Chip ${cadence === c.v ? 'Scrum__Chip--on' : ''}`}
              onClick={() => isAdmin && setCadence(c.v)}
              disabled={!isAdmin}
            >
              {t(c.labelKey)}
            </button>
          ))}
        </div>
        {cadence === 'every_n_weeks' && (
          <input
            type="number"
            min={2}
            max={12}
            className="SettingsGeneral__Input"
            style={{ marginTop: 8, maxWidth: 120 }}
            value={intervalWeeks}
            onChange={(e) => setIntervalWeeks(e.target.value)}
            disabled={!isAdmin}
          />
        )}
      </div>

      {/* Anchor weekday */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('scrum.settings.anchorWeekday')}</label>
        <div className="Scrum__ChipRow">
          {WEEKDAYS.map(([v, labelKey]) => (
            <button
              key={v}
              type="button"
              className={`Scrum__Chip ${String(anchorWeekday) === v ? 'Scrum__Chip--on' : ''}`}
              onClick={() => isAdmin && setAnchorWeekday(Number(v))}
              disabled={!isAdmin}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Retro template (read-only — only KPT exists) */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">{t('scrum.settings.retroTemplate')}</label>
        <input
          className="SettingsGeneral__Input SettingsGeneral__Input--readonly"
          value="KPT"
          readOnly
          disabled
        />
        <span className="SettingsGeneral__Hint">{t('scrum.settings.retroTemplateHint')}</span>
      </div>

      {/* Save */}
      {isAdmin && (
        <div className="SettingsGeneral__Actions">
          <button
            className="SettingsGeneral__SaveBtn"
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? t('common.state.saving') : saved ? t('scrum.settings.saved') : t('scrum.settings.saveChanges')}
          </button>
        </div>
      )}

      {/* Danger Zone */}
      {isAdmin && (
        <div className="SettingsGeneral__Danger">
          <div className="SettingsGeneral__DangerHeader">
            <AlertTriangle size={16} />
            <span>{t('scrum.settings.dangerZone')}</span>
          </div>

          {!showDeleteConfirm ? (
            <div className="SettingsGeneral__DangerRow">
              <div className="SettingsGeneral__DangerInfo">
                <span className="SettingsGeneral__DangerTitle">{t('scrum.settings.archiveBoard')}</span>
                <span className="SettingsGeneral__DangerDesc">
                  {t('scrum.settings.archiveBoardDesc')}
                </span>
              </div>
              <button
                className="SettingsGeneral__DeleteBtn"
                onClick={() => setShowDeleteConfirm(true)}
              >
                {t('scrum.settings.archiveBoard')}
              </button>
            </div>
          ) : (
            <div className="SettingsGeneral__DeleteConfirm">
              <p className="SettingsGeneral__DeleteWarning">
                {t('scrum.settings.archiveWarningPrefix')}{' '}
                <strong>{board.name}</strong>{t('scrum.settings.archiveWarningSuffix')}
              </p>
              <input
                className="SettingsGeneral__Input"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={board.name}
              />
              <div className="SettingsGeneral__DeleteActions">
                <button
                  className="SettingsGeneral__DeleteConfirmBtn"
                  disabled={deleteInput !== board.name || deleting}
                  onClick={handleDelete}
                >
                  {deleting ? t('scrum.settings.archiving') : t('scrum.settings.archiveConfirm')}
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
