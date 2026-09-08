import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import { Pencil, X, RotateCcw, Info } from 'lucide-react';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { showToast } from '@/components/Layout/Toast';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { COLOR_PRESETS, HEX_RE, DEFAULT_TRACK_COLOR } from './constants';
import EntityIcon from '@/components/common/EntityIcon';

export default function SettingsBranches({ trackId, isEditor }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);  // { branch_id, display_name }

  const fetchBranches = useCallback(async () => {
    if (!trackId) return;
    try {
      const res = await axios.get(`/tracks/${trackId}/branches`);
      if (res.data.status) setBranches(res.data.branches);
    } catch {}
    setLoading(false);
  }, [trackId]);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  const startEdit = (branch) => {
    setEditingId(branch.branch_id);
    setDraftName(branch.display_name_override || '');
    setDraftColor(branch.color_override || branch.branch_real_color || DEFAULT_TRACK_COLOR);
  };
  const cancelEdit = () => { setEditingId(null); };

  const saveEdit = async (branch) => {
    const trimmedName = draftName.trim();
    const namePayload = trimmedName ? trimmedName : null;
    const colorPayload =
      !draftColor || draftColor === branch.branch_real_color ? null : draftColor;

    if (colorPayload && !HEX_RE.test(colorPayload)) {
      showToast(t('trackSettings.branches.invalidHex'), 'error');
      return;
    }
    try {
      const res = await axios.patch(
        `/tracks/${trackId}/branches/${branch.branch_id}`,
        { display_name_override: namePayload, color_override: colorPayload },
      );
      if (res.data.status) {
        fetchBranches();
        setEditingId(null);
        window.dispatchEvent(new Event('track:updated'));
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('trackSettings.branches.saveFailed');
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('trackSettings.branches.saveFailed'), 'error');
    }
  };

  const resetOverrides = async (branch) => {
    try {
      const res = await axios.patch(
        `/tracks/${trackId}/branches/${branch.branch_id}`,
        { display_name_override: null, color_override: null },
      );
      if (res.data.status) {
        fetchBranches();
        setEditingId(null);
        window.dispatchEvent(new Event('track:updated'));
      }
    } catch {
      showToast(t('trackSettings.branches.resetFailed'), 'error');
    }
  };

  const removeBranch = async (branchId) => {
    try {
      const res = await axios.delete(`/tracks/${trackId}/branches/${branchId}`);
      if (res.data.status) {
        fetchBranches();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('trackSettings.branches.removeFailed');
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('trackSettings.branches.removeFailed'), 'error');
    }
    setConfirmRemove(null);
  };

  if (loading) return null;

  return (
    <div className="SettingsBranches">
      <div className="SettingsBranches__Banner">
        <Info size={14} />
        <div>
          <strong>{t('trackSettings.branches.bannerHeadline')}</strong>{' '}
          {t('trackSettings.branches.bannerBody')}
        </div>
      </div>

      {branches.length === 0 ? (
        <div className="SettingsBranches__Empty">
          <div className="SettingsBranches__EmptyTitle">{t('trackSettings.branches.emptyTitle')}</div>
          <div className="SettingsBranches__EmptyHint">
            {t('trackSettings.branches.emptyHintBefore')}{' '}
            <strong>{t('trackSettings.branches.emptyHintAction')}</strong>
            {t('trackSettings.branches.emptyHintAfter')}
          </div>
          <button
            className="SettingsBranches__EmptyBtn"
            onClick={() => router.push(`/tracks/${trackId}`)}
          >
            {t('trackSettings.backToTrack')}
          </button>
        </div>
      ) : (
        <ul className="SettingsBranches__List">
          {branches.map((b) => {
            const editing = editingId === b.branch_id;
            const overridden = !!(b.display_name_override || b.color_override);
            return (
              <li key={b.branch_id} className="SettingsBranches__Card">
                <div className="SettingsBranches__CardMain">
                  <EntityIcon
                    icon={b.icon}
                    color={b.color_override || b.branch_real_color || b.color}
                    size={14}
                    entityType="branch"
                  />
                  <div className="SettingsBranches__Names">
                    <span className="SettingsBranches__Name">{b.display_name}</span>
                    <span className="SettingsBranches__Sub">
                      {b.branch_key}
                      {overridden && (
                        <em className="SettingsBranches__OverrideMark">
                          {t('trackSettings.branches.overridden')}
                        </em>
                      )}
                    </span>
                  </div>
                  {isEditor && !editing && (
                    <div className="SettingsBranches__Actions">
                      <button
                        className="SettingsBranches__IconBtn"
                        onClick={() => startEdit(b)}
                        title={t('trackSettings.branches.editTitle')}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className="SettingsBranches__IconBtn SettingsBranches__IconBtn--danger"
                        onClick={() => setConfirmRemove({
                          branch_id: b.branch_id,
                          display_name: b.display_name,
                        })}
                        title={t('trackSettings.branches.removeTitle')}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {editing && (
                  <div className="SettingsBranches__Edit">
                    <label className="SettingsBranches__EditField">
                      <span className="SettingsBranches__EditLabel">
                        {t('trackSettings.branches.displayNameLabel')}
                      </span>
                      <input
                        className="SettingsBranches__EditInput"
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        placeholder={b.branch_real_name}
                        maxLength={300}
                      />
                    </label>
                    <label className="SettingsBranches__EditField">
                      <span className="SettingsBranches__EditLabel">
                        {t('trackSettings.branches.colorLabel')}
                      </span>
                      <div className="SettingsBranches__ColorRow">
                        <div className="SettingsBranches__Swatches">
                          {COLOR_PRESETS.map((p) => (
                            <button
                              key={p}
                              type="button"
                              className={`SettingsBranches__Swatch ${draftColor.toLowerCase() === p.toLowerCase() ? 'SettingsBranches__Swatch--active' : ''}`}
                              style={{ background: p }}
                              onClick={() => setDraftColor(p)}
                              aria-label={p}
                            />
                          ))}
                        </div>
                        <input
                          className="SettingsBranches__HexInput"
                          value={draftColor}
                          onChange={(e) => setDraftColor(e.target.value)}
                          maxLength={7}
                          placeholder="#RRGGBB"
                        />
                      </div>
                    </label>
                    <div className="SettingsBranches__EditActions">
                      {overridden && (
                        <button
                          className="SettingsBranches__ResetBtn"
                          onClick={() => resetOverrides(b)}
                          title={t('trackSettings.branches.resetTitle')}
                        >
                          <RotateCcw size={12} /> {t('trackSettings.branches.reset')}
                        </button>
                      )}
                      <span style={{ flex: 1 }} />
                      <button
                        className="SettingsBranches__CancelBtn"
                        onClick={cancelEdit}
                      >
                        {t('common.actions.cancel')}
                      </button>
                      <button
                        className="SettingsBranches__SaveBtn"
                        onClick={() => saveEdit(b)}
                      >
                        {t('common.actions.save')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmModal
        isOpen={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => confirmRemove && removeBranch(confirmRemove.branch_id)}
        title={t('trackSettings.branches.removeConfirmTitle')}
        message={
          confirmRemove
            ? t('trackSettings.branches.removeConfirmMessage', { name: confirmRemove.display_name })
            : ''
        }
        confirmLabel={t('common.actions.remove')}
        variant="danger"
      />
    </div>
  );
}
