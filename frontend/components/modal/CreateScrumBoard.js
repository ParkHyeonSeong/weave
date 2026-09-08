import { useState, useEffect } from 'react';
import { X, CalendarCheck, Globe, Lock, Check } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useTranslation } from 'react-i18next';

const COLOR_PRESETS = ['#16A34A', '#5E6AD2', '#10B981', '#F59E0B', '#9333EA', '#EC4899', '#0EA5E9', '#DC2626'];
// label은 렌더 시 t()로 푼다 — 모듈 상수는 언어 변경에 반응하지 않는다.
const CADENCES = [
  { v: 'weekly', k: 'weekly' }, { v: 'biweekly', k: 'biweekly' },
  { v: 'every_n_weeks', k: 'everyNWeeks' }, { v: 'monthly', k: 'monthly' },
  { v: 'manual', k: 'manual' },
];
const WEEKDAYS = [['0', 'mon'], ['1', 'tue'], ['2', 'wed'], ['3', 'thu'], ['4', 'fri']];

export default function CreateScrumBoard({ onClose, onCreated }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#16A34A');
  const [visibility, setVisibility] = useState('private');
  const [cadence, setCadence] = useState('weekly');
  const [intervalWeeks, setIntervalWeeks] = useState(3);
  const [anchorWeekday, setAnchorWeekday] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || loading) return;
    setError(''); setLoading(true);
    try {
      const res = await axios.post('/scrum', {
        name: name.trim(),
        color,
        visibility,
        retro_cadence: cadence,
        retro_interval_weeks: cadence === 'every_n_weeks' ? Number(intervalWeeks) : null,
        retro_template: 'kpt',
        retro_anchor_weekday: Number(anchorWeekday),
      });
      if (res.data.status) {
        window.dispatchEvent(new Event('scrum:created'));
        onCreated(res.data.board_id);
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('modal.createScrum.createFailed');
        setError(msg);
      }
    } catch (err) {
      setError(err?.response?.data?.detail?.[0]?.msg || t('modal.createScrum.createFailed'));
    } finally { setLoading(false); }
  };

  return (
    <div className="CreateTrack__Backdrop" onClick={onClose}>
      <form className="CreateTrack" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <header className="CreateTrack__Head">
          <div className="CreateTrack__Title"><CalendarCheck size={16} /><span>{t('modal.createScrum.title')}</span></div>
          <button type="button" className="CreateTrack__Close" onClick={onClose} aria-label={t('common.actions.close')}><X size={16} /></button>
        </header>
        <div className="CreateTrack__Body">
          <label className="CreateTrack__Field">
            <span className="CreateTrack__Label">{t('modal.createScrum.teamName')}</span>
            <input type="text" className="CreateTrack__Input" value={name}
              onChange={(e) => setName(e.target.value)} placeholder={t('modal.createScrum.teamNamePlaceholder')} maxLength={300} autoFocus />
          </label>
          <div className="CreateTrack__Field">
            <span className="CreateTrack__Label">{t('modal.fields.color')}</span>
            <div className="CreateTrack__Colors">
              {COLOR_PRESETS.map((c) => (
                <button key={c} type="button"
                  className={`CreateTrack__Color ${color === c ? 'CreateTrack__Color--active' : ''}`}
                  style={{ background: c }} onClick={() => setColor(c)} aria-label={t('modal.colorOption', { color: c })}>
                  {color === c && <Check size={12} />}
                </button>
              ))}
            </div>
          </div>
          <div className="CreateTrack__Field">
            <span className="CreateTrack__Label">{t('modal.createScrum.retroCadence')}</span>
            <div className="Scrum__ChipRow">
              {CADENCES.map((c) => (
                <button key={c.v} type="button"
                  className={`Scrum__Chip ${cadence === c.v ? 'Scrum__Chip--on' : ''}`}
                  onClick={() => setCadence(c.v)}>{t(`modal.createScrum.cadences.${c.k}`)}</button>
              ))}
            </div>
            {cadence === 'every_n_weeks' && (
              <input type="number" min={2} max={12} className="CreateTrack__Input" style={{ marginTop: 8, maxWidth: 120 }}
                value={intervalWeeks} onChange={(e) => setIntervalWeeks(e.target.value)} />
            )}
          </div>
          <div className="CreateTrack__Field">
            <span className="CreateTrack__Label">{t('modal.createScrum.anchorWeekday')}</span>
            <div className="Scrum__ChipRow">
              {WEEKDAYS.map(([v, k]) => (
                <button key={v} type="button"
                  className={`Scrum__Chip ${String(anchorWeekday) === v ? 'Scrum__Chip--on' : ''}`}
                  onClick={() => setAnchorWeekday(Number(v))}>{t(`modal.createScrum.weekdays.${k}`)}</button>
              ))}
            </div>
          </div>
          <div className="CreateTrack__Field">
            <span className="CreateTrack__Label">{t('modal.visibility.label')}</span>
            <div className="CreateTrack__VisGroup">
              <button type="button" className={`CreateTrack__VisOpt ${visibility === 'private' ? 'CreateTrack__VisOpt--active' : ''}`} onClick={() => setVisibility('private')}>
                <Lock size={13} /><div className="CreateTrack__VisText"><span className="CreateTrack__VisName">{t('modal.visibility.private')}</span><span className="CreateTrack__VisHint">{t('modal.createScrum.privateHint')}</span></div>
              </button>
              <button type="button" className={`CreateTrack__VisOpt ${visibility === 'public' ? 'CreateTrack__VisOpt--active' : ''}`} onClick={() => setVisibility('public')}>
                <Globe size={13} /><div className="CreateTrack__VisText"><span className="CreateTrack__VisName">{t('modal.visibility.public')}</span><span className="CreateTrack__VisHint">{t('modal.createScrum.publicHint')}</span></div>
              </button>
            </div>
          </div>
          {error && <div className="CreateTrack__Error">{error}</div>}
        </div>
        <footer className="CreateTrack__Foot">
          <button type="button" className="CreateTrack__Btn CreateTrack__Btn--ghost" onClick={onClose}>{t('common.actions.cancel')}</button>
          <button type="submit" className="CreateTrack__Btn CreateTrack__Btn--primary" disabled={!name.trim() || loading}>
            {loading ? t('modal.creating') : t('modal.createScrum.submit')}
          </button>
        </footer>
      </form>
    </div>
  );
}
