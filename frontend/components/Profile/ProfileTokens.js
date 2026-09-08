import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Key, Copy, Check, Trash2, Plus } from 'lucide-react';
import { axios } from '@/library/_axios';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useDateFormat } from '@/hooks/useDateFormat';

// 라벨은 카탈로그 키로만 두고 렌더 시점에 t()로 푼다.
const EXPIRY_OPTIONS = [
  { labelKey: 'account.tokens.expiry.days30', value: 30 },
  { labelKey: 'account.tokens.expiry.days90', value: 90 },
  { labelKey: 'account.tokens.expiry.days365', value: 365 },
  { labelKey: 'account.tokens.expiry.never', value: '' },
];

export default function ProfileTokens({ showAlert }) {
  const { t } = useTranslation();
  // 토큰 생성/만료 시각은 timestamp — 개인 timezone의 달력 날짜로 표시한다.
  const { formatTimestampYMD } = useDateFormat();
  const formatDate = (iso) => formatTimestampYMD(iso) || '—';
  const [tokens, setTokens] = useState([]);

  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [creating, setCreating] = useState(false);

  const [newToken, setNewToken] = useState(''); // raw token, shown once
  const [copied, setCopied] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState(null);

  useEffect(() => {
    fetchTokens();
  }, []);

  const fetchTokens = async () => {
    try {
      const res = await axios.get('/profile/tokens');
      if (res.data.status) setTokens(res.data.tokens);
    } catch {
      showAlert(t('account.alerts.error'), t('account.tokens.loadFailed'));
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (creating) return;
    if (!name.trim()) {
      showAlert(t('account.alerts.error'), t('account.tokens.nameRequired'));
      return;
    }
    setCreating(true);
    try {
      const body = { name: name.trim() };
      if (expiresInDays !== '') body.expires_in_days = expiresInDays;
      const res = await axios.post('/profile/tokens', body);
      if (res.data.status) {
        setNewToken(res.data.token);
        setCopied(false);
        setName('');
        fetchTokens();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('account.tokens.createFailed');
        showAlert(t('account.alerts.error'), msg);
      }
    } catch {
      showAlert(t('account.alerts.error'), t('account.tokens.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
    } catch {
      showAlert(t('account.alerts.error'), t('account.tokens.copyFailed'));
    }
  };

  const handleRevoke = async () => {
    const target = revokeTarget;
    setRevokeTarget(null);
    if (!target) return;
    try {
      const res = await axios.delete(`/profile/tokens/${target.pat_id}`);
      if (res.data.status) {
        setTokens((prev) => prev.filter((token) => token.pat_id !== target.pat_id));
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('account.tokens.revokeFailed');
        showAlert(t('account.alerts.error'), msg);
        fetchTokens();
      }
    } catch {
      showAlert(t('account.alerts.error'), t('account.tokens.revokeFailed'));
    }
  };

  return (
    <div className="Profile__Section">
      <h2 className="Profile__SectionTitle">{t('account.tokens.title')}</h2>
      <p className="Profile__TokenIntro">
        {t('account.tokens.intro')}
      </p>

      {newToken && (
        <div className="Profile__TokenReveal">
          <p className="Profile__TokenRevealWarn">
            {t('account.tokens.revealWarning')}
          </p>
          <div className="Profile__TokenRevealRow">
            <code className="Profile__TokenValue">{newToken}</code>
            <button type="button" className="Profile__TokenCopyBtn" onClick={handleCopy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? t('account.tokens.copied') : t('account.tokens.copy')}
            </button>
          </div>
          <button type="button" className="Profile__TokenDismiss" onClick={() => setNewToken('')}>
            {t('account.tokens.done')}
          </button>
        </div>
      )}

      <form className="Profile__Form" onSubmit={handleCreate}>
        <div className="Profile__Field">
          <label className="Profile__Label">{t('account.tokens.nameLabel')}</label>
          <div className="Profile__InputWrap">
            <Key size={16} className="Profile__InputIcon" />
            <input
              className="Profile__Input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('account.tokens.namePlaceholder')}
              maxLength={100}
            />
          </div>
        </div>
        <div className="Profile__Field">
          <label className="Profile__Label">{t('account.tokens.expiresLabel')}</label>
          <select
            className="Profile__Input"
            value={expiresInDays}
            onChange={(e) => {
              const v = e.target.value;
              setExpiresInDays(v === '' ? '' : Number(v));
            }}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.labelKey} value={o.value}>{t(o.labelKey)}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="Profile__SaveBtn" disabled={creating || !name.trim()}>
          <Plus size={16} />
          {creating ? t('account.tokens.creating') : t('account.tokens.create')}
        </button>
      </form>

      {tokens.length > 0 && (
        <div className="Profile__TokenList">
          {tokens.map((token) => (
            <div key={token.pat_id} className="Profile__TokenItem">
              <div className="Profile__TokenItemMain">
                <span className="Profile__TokenName">{token.name}</span>
                <code className="Profile__TokenPrefix">{token.token_prefix}…</code>
              </div>
              <div className="Profile__TokenMeta">
                <span>{t('account.tokens.created', { date: formatDate(token.created_at) })}</span>
                <span>{t('account.tokens.lastUsed', { date: formatDate(token.last_used_at) })}</span>
                <span>
                  {token.expires_at
                    ? t('account.tokens.expiresAt', { date: formatDate(token.expires_at) })
                    : t('account.tokens.noExpiry')}
                </span>
              </div>
              <button
                type="button"
                className="Profile__TokenRevokeBtn"
                onClick={() => setRevokeTarget(token)}
              >
                <Trash2 size={16} />
                {t('account.tokens.revoke')}
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={!!revokeTarget}
        title={t('account.tokens.revokeTitle')}
        message={revokeTarget ? t('account.tokens.revokeConfirm', { name: revokeTarget.name }) : ''}
        confirmLabel={t('account.tokens.revoke')}
        variant="danger"
        onConfirm={handleRevoke}
        onClose={() => setRevokeTarget(null)}
      />
    </div>
  );
}
