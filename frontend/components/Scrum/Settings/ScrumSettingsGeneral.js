import { useState, useId } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { Lock, Globe, AlertTriangle, Check, Archive } from 'lucide-react';
import { axios } from '@/library/_axios';
import { showToast } from '@/components/Layout/Toast';
import { COLOR_PRESETS, DEFAULT_COLORS } from '@/library/entityAppearance';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { WEEKDAY_KEYS } from '@/library/scrumViewModel';

const CADENCES = [
  { v: 'weekly', labelKey: 'scrum.cadence.weekly' },
  { v: 'biweekly', labelKey: 'scrum.cadence.biweekly' },
  { v: 'every_n_weeks', labelKey: 'scrum.cadence.everyNWeeks' },
  { v: 'monthly', labelKey: 'scrum.cadence.monthly' },
  { v: 'manual', labelKey: 'scrum.cadence.manual' },
];
const VISIBILITIES = [
  { v: 'private', labelKey: 'scrum.settings.visibilityPrivate', Icon: Lock },
  { v: 'public', labelKey: 'scrum.settings.visibilityPublic', Icon: Globe },
];
const DEFAULT_SCRUM_COLOR = DEFAULT_COLORS.scrum;

// 보드 설정 '일반' 탭 — 카드 세 장(보드 정보·공개 범위·회고) + 저장 + 위험 구역.
// 고르는 칸은 보드 툴바와 같은 회색 세그먼트(.ScrumSegment). 관리자가 아니면 모두 읽기 전용(disabled).
// 세로 배치는 부모 .ScrumSettings__Content가 맡는다(멤버 탭 카드와 같은 묶음).
export default function ScrumSettingsGeneral({ board, boardId, isAdmin, onUpdated }) {
  const { t } = useTranslation();
  const router = useRouter();
  const ids = useId();
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
    <>
      <section className="ScrumSettings__Card">
        <h2 className="ScrumSettings__CardTitle">{t('scrum.settings.sectionBoard')}</h2>
        <div className="ScrumSettings__CardBody">
          <div className="ScrumSettings__Field">
            <label className="ScrumSettings__Label" htmlFor={`${ids}-name`}>{t('scrum.settings.teamName')}</label>
            <input
              id={`${ids}-name`}
              className="ScrumSettings__Input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isAdmin}
              maxLength={300}
            />
            {!nameValid && name.length === 0 && isAdmin && (
              <span className="ScrumSettings__Error">{t('scrum.settings.nameRequired')}</span>
            )}
          </div>

          <div className="ScrumSettings__Field">
            <span className="ScrumSettings__Label" id={`${ids}-color`}>{t('scrum.settings.color')}</span>
            <div className="ScrumSettings__Swatches" role="group" aria-labelledby={`${ids}-color`}>
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="ScrumSettings__Swatch"
                  style={{ background: c }}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  disabled={!isAdmin}
                  aria-label={t('scrum.settings.colorAria', { color: c })}
                >
                  {color === c && <Check size={13} color="#fff" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="ScrumSettings__Card">
        <h2 className="ScrumSettings__CardTitle">{t('scrum.settings.visibility')}</h2>
        <div className="ScrumSettings__CardBody">
          <div className="ScrumSettings__Field">
            <div className="ScrumSegment" role="group" aria-label={t('scrum.settings.visibility')}>
              {VISIBILITIES.map(({ v, labelKey, Icon }) => (
                <button
                  key={v}
                  type="button"
                  className="ScrumSegment__Btn"
                  aria-pressed={visibility === v}
                  onClick={() => setVisibility(v)}
                  disabled={!isAdmin}
                >
                  <Icon size={14} />
                  {t(labelKey)}
                </button>
              ))}
            </div>
            <span className="ScrumSettings__Hint">
              {visibility === 'private'
                ? t('scrum.settings.visibilityPrivateHint')
                : t('scrum.settings.visibilityPublicHint')}
            </span>
          </div>
        </div>
      </section>

      <section className="ScrumSettings__Card">
        <h2 className="ScrumSettings__CardTitle">{t('scrum.settings.sectionRetro')}</h2>
        <div className="ScrumSettings__CardBody">
          <div className="ScrumSettings__Field">
            <span className="ScrumSettings__Label" id={`${ids}-cadence`}>{t('scrum.settings.retroCadence')}</span>
            <div className="ScrumSegment" role="group" aria-labelledby={`${ids}-cadence`}>
              {CADENCES.map((c) => (
                <button
                  key={c.v}
                  type="button"
                  className="ScrumSegment__Btn"
                  aria-pressed={cadence === c.v}
                  onClick={() => setCadence(c.v)}
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
                className="ScrumSettings__Input ScrumSettings__Input--number"
                value={intervalWeeks}
                onChange={(e) => setIntervalWeeks(e.target.value)}
                disabled={!isAdmin}
                aria-label={t('scrum.cadence.everyNWeeks')}
              />
            )}
          </div>

          <div className="ScrumSettings__Field">
            <span className="ScrumSettings__Label" id={`${ids}-weekday`}>{t('scrum.settings.anchorWeekday')}</span>
            <div className="ScrumSegment ScrumSettings__Days" role="group" aria-labelledby={`${ids}-weekday`}>
              {WEEKDAY_KEYS.map((labelKey, d) => (
                <button
                  key={labelKey}
                  type="button"
                  className="ScrumSegment__Btn"
                  aria-pressed={Number(anchorWeekday) === d}
                  onClick={() => setAnchorWeekday(d)}
                  disabled={!isAdmin}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="ScrumSettings__Field">
            <span className="ScrumSettings__Label">{t('scrum.settings.retroTemplate')}</span>
            {/* 고를 수 있는 템플릿이 KPT 하나뿐이라 입력칸 대신 표시만 한다 */}
            <div className="ScrumSettings__ReadOnly">
              <span className="ScrumSettings__Chip">KPT</span>
              <span className="ScrumSettings__Hint">{t('scrum.settings.retroTemplateHint')}</span>
            </div>
          </div>
        </div>
      </section>

      {isAdmin && (
        <div className="ScrumSettings__SaveRow">
          <button
            type="button"
            className="ScrumSettings__SaveBtn"
            onClick={handleSave}
            disabled={!canSave}
          >
            <Check size={15} />
            {saving ? t('common.state.saving') : saved ? t('scrum.settings.saved') : t('scrum.settings.saveChanges')}
          </button>
        </div>
      )}

      {isAdmin && (
        <section className="ScrumSettings__Card ScrumSettings__Card--danger">
          <h2 className="ScrumSettings__CardTitle">
            <AlertTriangle size={16} />
            {t('scrum.settings.dangerZone')}
          </h2>

          {!showDeleteConfirm ? (
            <div className="ScrumSettings__DangerRow">
              <div className="ScrumSettings__DangerText">
                <p className="ScrumSettings__DangerTitle">{t('scrum.settings.archiveBoard')}</p>
                <p className="ScrumSettings__DangerDesc">{t('scrum.settings.archiveBoardDesc')}</p>
              </div>
              <button
                type="button"
                className="ScrumSettings__DangerBtn"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Archive size={15} />
                {t('scrum.settings.archiveBoard')}
              </button>
            </div>
          ) : (
            <div className="ScrumSettings__DangerConfirm">
              <p className="ScrumSettings__DangerDesc">
                {t('scrum.settings.archiveWarningPrefix')}{' '}
                <strong>{board.name}</strong>{t('scrum.settings.archiveWarningSuffix')}
              </p>
              <input
                className="ScrumSettings__Input"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={board.name}
                aria-label={t('scrum.settings.archiveBoard')}
              />
              <div className="ScrumSettings__DangerActions">
                <button
                  type="button"
                  className="ScrumSettings__DangerConfirmBtn"
                  disabled={deleteInput !== board.name || deleting}
                  onClick={handleDelete}
                >
                  {deleting ? t('scrum.settings.archiving') : t('scrum.settings.archiveConfirm')}
                </button>
                <button
                  type="button"
                  className="ScrumSettings__CancelBtn"
                  onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                >
                  {t('common.actions.cancel')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
