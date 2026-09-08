import { useState, useEffect } from 'react';
import { X, Workflow, Globe, Lock, Check } from 'lucide-react';
import { axios } from '@/library/_axios';
import { useUiPrefs } from '@/library/UiPrefsContext';
import EntityIcon from '@/components/common/EntityIcon';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useTranslation } from 'react-i18next';

const COLOR_PRESETS = [
  '#5E6AD2', '#10B981', '#F59E0B', '#9333EA',
  '#EC4899', '#0EA5E9', '#DC2626', '#6B7280',
];

export default function CreateTrack({ onClose, onCreated }) {
  const { t } = useTranslation();
  const [trackName, setTrackName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#5E6AD2');
  const [visibility, setVisibility] = useState('private');
  const [branches, setBranches] = useState([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [error, setError] = useState('');
  const { isHidden } = useUiPrefs();

  // 가입된 branch 목록 로드
  useEffect(() => {
    let alive = true;
    axios.get('/branches')
      .then((res) => {
        if (!alive) return;
        if (res.data.status) setBranches(res.data.branches);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingBranches(false); });
    return () => { alive = false; };
  }, []);

  // ESC 닫기
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const toggleBranch = (branchId) => {
    setSelectedBranchIds((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId); else next.add(branchId);
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!trackName.trim() || loading) return;
    setError('');
    setLoading(true);
    try {
      const res = await axios.post('/tracks', {
        track_name: trackName.trim(),
        description: description.trim() || null,
        color,
        visibility,
        default_view: 'flow',
        participating_branch_ids: [...selectedBranchIds],
      });
      if (res.data.status) {
        window.dispatchEvent(new Event('track:created'));
        onCreated(res.data.track_id);
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('modal.createTrack.createFailed');
        setError(msg);
      }
    } catch (err) {
      setError(err?.response?.data?.detail?.[0]?.msg || t('modal.createTrack.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  const visibleBranches = branches.filter((b) => !isHidden('branches', b.branch_id));

  return (
    <div className="CreateTrack__Backdrop" onClick={onClose}>
      <form
        className="CreateTrack"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header className="CreateTrack__Head">
          <div className="CreateTrack__Title">
            <Workflow size={16} />
            <span>{t('modal.createTrack.title')}</span>
          </div>
          <button type="button" className="CreateTrack__Close" onClick={onClose} aria-label={t('common.actions.close')}>
            <X size={16} />
          </button>
        </header>

        <div className="CreateTrack__Body">
          {/* 이름 */}
          <label className="CreateTrack__Field">
            <span className="CreateTrack__Label">{t('modal.fields.name')}</span>
            <input
              type="text"
              className="CreateTrack__Input"
              value={trackName}
              onChange={(e) => setTrackName(e.target.value)}
              placeholder={t('modal.createTrack.namePlaceholder')}
              maxLength={300}
              autoFocus
            />
          </label>

          {/* 설명 */}
          <label className="CreateTrack__Field">
            <span className="CreateTrack__Label">{t('modal.fields.description')} <span className="CreateTrack__LabelOpt">{t('modal.optional')}</span></span>
            <textarea
              className="CreateTrack__Textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('modal.createTrack.descriptionPlaceholder')}
              rows={2}
            />
          </label>

          {/* 색상 */}
          <div className="CreateTrack__Field">
            <span className="CreateTrack__Label">{t('modal.fields.color')}</span>
            <div className="CreateTrack__Colors">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`CreateTrack__Color ${color === c ? 'CreateTrack__Color--active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={t('modal.colorOption', { color: c })}
                >
                  {color === c && <Check size={12} />}
                </button>
              ))}
            </div>
          </div>

          {/* 가시성 */}
          <div className="CreateTrack__Field">
            <span className="CreateTrack__Label">{t('modal.visibility.label')}</span>
            <div className="CreateTrack__VisGroup">
              <button
                type="button"
                className={`CreateTrack__VisOpt ${visibility === 'private' ? 'CreateTrack__VisOpt--active' : ''}`}
                onClick={() => setVisibility('private')}
              >
                <Lock size={13} />
                <div className="CreateTrack__VisText">
                  <span className="CreateTrack__VisName">{t('modal.visibility.private')}</span>
                  <span className="CreateTrack__VisHint">{t('modal.createTrack.privateHint')}</span>
                </div>
              </button>
              <button
                type="button"
                className={`CreateTrack__VisOpt ${visibility === 'public' ? 'CreateTrack__VisOpt--active' : ''}`}
                onClick={() => setVisibility('public')}
              >
                <Globe size={13} />
                <div className="CreateTrack__VisText">
                  <span className="CreateTrack__VisName">{t('modal.visibility.public')}</span>
                  <span className="CreateTrack__VisHint">{t('modal.createTrack.publicHint')}</span>
                </div>
              </button>
            </div>
          </div>

          {/* 참여 branch */}
          <div className="CreateTrack__Field">
            <span className="CreateTrack__Label">
              {t('modal.createTrack.participatingBranches')} <span className="CreateTrack__LabelOpt">{t('modal.optional')}</span>
            </span>
            {loadingBranches ? (
              <div className="CreateTrack__BranchesLoading">{t('modal.createTrack.loadingBranches')}</div>
            ) : visibleBranches.length === 0 ? (
              <div className="CreateTrack__BranchesEmpty">{t('modal.createTrack.noBranches')}</div>
            ) : (
              <div className="CreateTrack__Branches">
                {visibleBranches.map((b) => {
                  const checked = selectedBranchIds.has(b.branch_id);
                  return (
                    <button
                      key={b.branch_id}
                      type="button"
                      className={`CreateTrack__Branch ${checked ? 'CreateTrack__Branch--checked' : ''}`}
                      onClick={() => toggleBranch(b.branch_id)}
                      style={{ '--branch-color': b.color || '#5E6AD2' }}
                    >
                      <span className="CreateTrack__BranchMark">
                        {checked && <Check size={11} />}
                      </span>
                      <EntityIcon
                        icon={b.icon}
                        color={b.color}
                        size={14}
                        entityType="branch"
                      />
                      <span className="CreateTrack__BranchName">{b.branch_name}</span>
                      <span className="CreateTrack__BranchKey">{b.key}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && <div className="CreateTrack__Error">{error}</div>}
        </div>

        <footer className="CreateTrack__Foot">
          <button
            type="button"
            className="CreateTrack__Btn CreateTrack__Btn--ghost"
            onClick={onClose}
          >
            {t('common.actions.cancel')}
          </button>
          <button
            type="submit"
            className="CreateTrack__Btn CreateTrack__Btn--primary"
            disabled={!trackName.trim() || loading}
          >
            {loading ? t('modal.creating') : t('modal.createTrack.submit')}
          </button>
        </footer>
      </form>
    </div>
  );
}
