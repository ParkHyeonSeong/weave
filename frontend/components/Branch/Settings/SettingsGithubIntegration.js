import { useState, useEffect } from 'react';
import { Github, Plus, Power, Trash2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getErrorCode } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useTranslation } from 'react-i18next';

export default function SettingsGithubIntegration({ branchId, isAdmin }) {
  const { t } = useTranslation();
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [repo, setRepo] = useState('');
  const [installationId, setInstallationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const fetchIntegrations = async () => {
    if (!branchId) { setLoading(false); return; }
    try {
      const res = await axios.get(`/branches/${branchId}/github`);
      if (res.data.status) setIntegrations(res.data.integrations || []);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchIntegrations(); }, [branchId]);

  const handleConnect = async () => {
    const repoName = repo.trim();
    const instId = installationId.trim();
    if (!repoName || !instId || saving) return;
    setSaving(true);
    setErr('');
    try {
      const res = await axios.post(`/branches/${branchId}/github`, {
        repo_full_name: repoName,
        installation_id: Number(instId),
      });
      if (res.data.status) {
        setRepo('');
        setInstallationId('');
        setShowAdd(false);
        await fetchIntegrations();
      } else {
        const code = getErrorCode(res.data);
        setErr(errorText(code, res.data.category) || t('branch2.github.connectFailed'));
      }
    } catch {
      setErr(t('branch2.github.connectFailed'));
    }
    setSaving(false);
  };

  const handleToggle = async (integration) => {
    try {
      const res = await axios.patch(
        `/branches/${branchId}/github/${integration.integration_id}`,
        { enabled: !integration.enabled },
      );
      if (res.data.status) await fetchIntegrations();
    } catch {}
  };

  const handleDisconnect = async (integration) => {
    try {
      const res = await axios.delete(
        `/branches/${branchId}/github/${integration.integration_id}`,
      );
      if (res.data.status) await fetchIntegrations();
    } catch {}
  };

  if (loading) {
    return <div className="SettingsGithub__Empty">{t('common.state.loading')}</div>;
  }

  return (
    <div className="SettingsGithub">
      <div className="SettingsGithub__Intro">
        <Github size={16} />
        <span>
          {t('branch2.github.introBefore')}{' '}
          <code>{t('branch2.github.introCode')}</code>{' '}
          {t('branch2.github.introAfter')}
        </span>
      </div>

      {integrations.length === 0 ? (
        <div className="SettingsGithub__Empty">{t('branch2.github.noRepos')}</div>
      ) : (
        <div className="SettingsGithub__List">
          {integrations.map((it) => (
            <div key={it.integration_id} className="SettingsGithub__Item">
              <div className="SettingsGithub__ItemInfo">
                <span className="SettingsGithub__Repo">{it.repo_full_name}</span>
                <span className="SettingsGithub__InstId">{t('branch2.github.installationId', { id: it.installation_id })}</span>
              </div>
              <span
                className={`SettingsGithub__State ${it.enabled ? 'SettingsGithub__State--on' : 'SettingsGithub__State--off'}`}
              >
                {it.enabled ? t('branch2.github.enabled') : t('branch2.github.disabled')}
              </span>
              {isAdmin && (
                <div className="SettingsGithub__ItemActions">
                  <button
                    className="SettingsGithub__ActionBtn"
                    onClick={() => handleToggle(it)}
                    title={it.enabled ? t('branch2.github.disable') : t('branch2.github.enable')}
                  >
                    <Power size={14} />
                  </button>
                  <button
                    className="SettingsGithub__ActionBtn SettingsGithub__ActionBtn--danger"
                    onClick={() => handleDisconnect(it)}
                    title={t('branch2.github.disconnect')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        showAdd ? (
          <div className="SettingsGithub__AddForm">
            <input
              className="SettingsGithub__Input"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="org/repo"
            />
            <input
              className="SettingsGithub__Input"
              value={installationId}
              onChange={(e) => setInstallationId(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder={t('branch2.github.installationIdPlaceholder')}
              inputMode="numeric"
            />
            <a
              className="SettingsGithub__Hint"
              href="https://github.com/settings/installations"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('branch2.github.installationIdHint')}
            </a>
            {err && <span className="SettingsGithub__Error">{err}</span>}
            <div className="SettingsGithub__AddActions">
              <button
                className="SettingsGithub__SubmitBtn"
                onClick={handleConnect}
                disabled={!repo.trim() || !installationId.trim() || saving}
              >
                {saving ? t('branch2.github.connecting') : t('branch2.github.connect')}
              </button>
              <button
                className="SettingsGithub__CancelBtn"
                onClick={() => { setShowAdd(false); setErr(''); }}
              >
                {t('common.actions.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button className="SettingsGithub__AddBtn" onClick={() => setShowAdd(true)}>
            <Plus size={14} />
            {t('branch2.github.connectRepository')}
          </button>
        )
      )}
    </div>
  );
}
