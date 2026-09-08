import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AdminLayout from '@/components/Admin/AdminLayout';
import { axios } from '@/library/_axios';
import { Blocks, Bot, Mail } from 'lucide-react';
import Alert from '@/components/modal/Alert';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

export default function IntegrationsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // AI Config 상태
  const [aiProvider, setAiProvider] = useState('anthropic');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiKeyPlaceholder, setAiKeyPlaceholder] = useState('');
  const [aiSaving, setAiSaving] = useState(false);

  // SMTP Config 상태
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpPasswordPlaceholder, setSmtpPasswordPlaceholder] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [senderName, setSenderName] = useState('');
  const [useTls, setUseTls] = useState(true);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);

  // Alert 상태
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const showAlert = (title, message) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertOpen(true);
  };

  useEffect(() => {
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      if (profile.role !== 'admin') {
        router.replace('/');
        return;
      }
    } catch {
      router.replace('/');
      return;
    }
    fetchAiConfig();
    fetchSmtpConfig();
  }, []);

  const fetchAiConfig = async () => {
    try {
      const res = await axios.get('/ai/config');
      if (res.data.status && res.data.config) {
        const cfg = res.data.config;
        setAiProvider(cfg.provider || 'anthropic');
        setAiModel(cfg.model || '');
        if (cfg.api_key) {
          setAiApiKey('');
          setAiKeyPlaceholder(cfg.api_key);
        }
      }
    } catch {
      // Config not set yet
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAiConfig = async () => {
    if (!aiApiKey && !aiKeyPlaceholder) {
      showAlert(t('common.state.error'), t('authAdmin.integrations.enterApiKey'));
      return;
    }
    setAiSaving(true);
    try {
      const defaultModel = aiProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o';
      const body = { provider: aiProvider, model: aiModel || defaultModel };
      if (aiApiKey) {
        body.api_key = aiApiKey;
      }
      const res = await axios.put('/ai/config', body);
      if (res.data.status) {
        showAlert(t('authAdmin.success'), t('authAdmin.integrations.aiSaved'));
        fetchAiConfig();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('authAdmin.integrations.saveFailed');
        showAlert(t('common.state.error'), msg);
      }
    } catch {
      showAlert(t('common.state.error'), t('authAdmin.integrations.aiSaveFailed'));
    } finally {
      setAiSaving(false);
    }
  };

  const fetchSmtpConfig = async () => {
    try {
      const res = await axios.get('/admin/smtp-config');
      if (res.data.status && res.data.config) {
        const cfg = res.data.config;
        setSmtpHost(cfg.smtp_host || '');
        setSmtpPort(String(cfg.smtp_port || 587));
        setSmtpUser(cfg.smtp_user || '');
        setSenderEmail(cfg.sender_email || '');
        setSenderName(cfg.sender_name || '');
        setUseTls(cfg.use_tls !== false);
        if (cfg.smtp_password) {
          setSmtpPassword('');
          setSmtpPasswordPlaceholder(cfg.smtp_password);
        }
      }
    } catch {
      // Config not set yet
    }
  };

  const handleSaveSmtpConfig = async () => {
    if (!smtpHost || !smtpUser || !senderEmail) {
      showAlert(t('common.state.error'), t('authAdmin.integrations.fillRequired'));
      return;
    }
    if (!smtpPassword && !smtpPasswordPlaceholder) {
      showAlert(t('common.state.error'), t('authAdmin.integrations.enterSmtpPassword'));
      return;
    }
    setSmtpSaving(true);
    try {
      const body = {
        smtp_host: smtpHost,
        smtp_port: parseInt(smtpPort) || 587,
        smtp_user: smtpUser,
        sender_email: senderEmail,
        sender_name: senderName,
        use_tls: useTls,
      };
      if (smtpPassword) {
        body.smtp_password = smtpPassword;
      }
      const res = await axios.put('/admin/smtp-config', body);
      if (res.data.status) {
        showAlert(t('authAdmin.success'), t('authAdmin.integrations.smtpSaved'));
        fetchSmtpConfig();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('authAdmin.integrations.saveFailed');
        showAlert(t('common.state.error'), msg);
      }
    } catch {
      showAlert(t('common.state.error'), t('authAdmin.integrations.smtpSaveFailed'));
    } finally {
      setSmtpSaving(false);
    }
  };

  const handleTestSmtp = async () => {
    setSmtpTesting(true);
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      const res = await axios.post('/admin/smtp-config/test', {
        test_email: profile.email || senderEmail,
      });
      if (res.data.status) {
        showAlert(t('authAdmin.success'), t('authAdmin.integrations.testEmailSent', { email: profile.email || senderEmail }));
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('authAdmin.integrations.testEmailFailed');
        showAlert(t('common.state.error'), msg);
      }
    } catch {
      showAlert(t('common.state.error'), t('authAdmin.integrations.testEmailFailed'));
    } finally {
      setSmtpTesting(false);
    }
  };

  if (loading) return null;

  return (
    <AdminLayout>
      <Head>
        <title>{t('pageTitles.integrations')}</title>
      </Head>
      <div className="Admin">
        <div className="Admin__Header">
          <Blocks size={20} />
          <h1 className="Admin__Title">{t('authAdmin.integrations.title')}</h1>
        </div>

        <div className="Admin__Section">
          <div className="Admin__SectionHeader">
            <h2 className="Admin__SectionTitle">
              <Bot size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
              {t('authAdmin.integrations.aiTitle')}
            </h2>
          </div>
          <p className="Admin__Description">
            {t('authAdmin.integrations.aiDesc')}
          </p>

          <div className="Admin__Form">
            <div className="Admin__Field">
              <label className="Admin__Label">{t('authAdmin.integrations.provider')}</label>
              <select
                className="Admin__Select"
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">{t('authAdmin.integrations.apiKey')}</label>
              <input
                className="Admin__Input"
                type="password"
                value={aiApiKey}
                placeholder={aiKeyPlaceholder || t('authAdmin.integrations.apiKeyPlaceholder')}
                onChange={(e) => setAiApiKey(e.target.value)}
                onFocus={() => setAiApiKey('')}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">{t('authAdmin.integrations.model')}</label>
              <input
                className="Admin__Input"
                type="text"
                value={aiModel}
                placeholder={aiProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'}
                onChange={(e) => setAiModel(e.target.value)}
              />
            </div>

            <button
              className="Admin__SaveBtn"
              onClick={handleSaveAiConfig}
              disabled={aiSaving}
            >
              {aiSaving ? t('common.state.saving') : t('authAdmin.integrations.saveConfig')}
            </button>
          </div>
        </div>
        <div className="Admin__Section">
          <div className="Admin__SectionHeader">
            <h2 className="Admin__SectionTitle">
              <Mail size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
              {t('authAdmin.integrations.smtpTitle')}
            </h2>
          </div>
          <p className="Admin__Description">
            {t('authAdmin.integrations.smtpDesc')}
          </p>

          <div className="Admin__Form">
            <div className="Admin__Field">
              <label className="Admin__Label">{t('authAdmin.integrations.smtpHost')}</label>
              <input
                className="Admin__Input"
                type="text"
                value={smtpHost}
                placeholder="smtp.gmail.com"
                onChange={(e) => setSmtpHost(e.target.value)}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">{t('authAdmin.integrations.smtpPort')}</label>
              <input
                className="Admin__Input"
                type="number"
                value={smtpPort}
                placeholder="587"
                onChange={(e) => setSmtpPort(e.target.value)}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">{t('authAdmin.integrations.smtpUser')}</label>
              <input
                className="Admin__Input"
                type="text"
                value={smtpUser}
                placeholder="your-email@example.com"
                onChange={(e) => setSmtpUser(e.target.value)}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">{t('authAdmin.integrations.smtpPassword')}</label>
              <input
                className="Admin__Input"
                type="password"
                value={smtpPassword}
                placeholder={smtpPasswordPlaceholder || t('authAdmin.integrations.smtpPasswordPlaceholder')}
                onChange={(e) => setSmtpPassword(e.target.value)}
                onFocus={() => setSmtpPassword('')}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">{t('authAdmin.integrations.senderEmail')}</label>
              <input
                className="Admin__Input"
                type="email"
                value={senderEmail}
                placeholder="no-reply@example.com"
                onChange={(e) => setSenderEmail(e.target.value)}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">{t('authAdmin.integrations.senderName')}</label>
              <input
                className="Admin__Input"
                type="text"
                value={senderName}
                placeholder="Weave"
                onChange={(e) => setSenderName(e.target.value)}
              />
            </div>

            <label className="Admin__CheckboxLabel">
              <input
                type="checkbox"
                checked={useTls}
                onChange={(e) => setUseTls(e.target.checked)}
              />
              {t('authAdmin.integrations.useTls')}
            </label>

            <div className="Admin__BtnRow">
              <button
                className="Admin__SaveBtn"
                onClick={handleSaveSmtpConfig}
                disabled={smtpSaving}
              >
                {smtpSaving ? t('common.state.saving') : t('authAdmin.integrations.saveConfig')}
              </button>
              <button
                className="Admin__TestBtn"
                onClick={handleTestSmtp}
                disabled={smtpTesting}
              >
                {smtpTesting ? t('authAdmin.integrations.sending') : t('authAdmin.integrations.sendTestEmail')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <Alert
        isOpen={alertOpen}
        title={alertTitle}
        contents={alertMessage}
        onClose={() => setAlertOpen(false)}
      />
    </AdminLayout>
  );
}
