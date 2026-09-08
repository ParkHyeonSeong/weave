import { useState } from 'react';
import { X, Copy, Check, Mail, Link2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useTranslation, Trans } from 'react-i18next';

export default function ResetPassword({ user, onClose }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 결과 상태
  const [emailSent, setEmailSent] = useState(false);
  const [resetLink, setResetLink] = useState('');
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setError('');
    setLoading(true);
    try {
      const res = await axios.post(`/admin/users/${user.user_id}/reset-password`, {});
      if (res.data.status) {
        if (res.data.email_sent) {
          setEmailSent(true);
        } else {
          // 상대경로면 현재 origin을 붙여 절대 URL로 만든다.
          const link = res.data.reset_link || '';
          const absolute = /^https?:\/\//i.test(link)
            ? link
            : `${window.location.origin}${link}`;
          setResetLink(absolute);
        }
      } else {
        const err = getError(res.data);
        let fallback = t('modal.resetPassword.failed');
        if (err.code === 'CANNOT_RESET_OWN_PASSWORD') fallback = t('errors.CANNOT_RESET_OWN_PASSWORD');
        else if (err.code === 'USER_NOT_FOUND') fallback = t('errors.USER_NOT_FOUND');
        setError(errorText(err.code, err.category) ?? fallback);
      }
    } catch {
      setError(t('modal.resetPassword.failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(resetLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const textarea = document.createElement('textarea');
      textarea.value = resetLink;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 이메일 발송 완료 화면
  if (emailSent) {
    return (
      <div className="ResetPassword__Backdrop" onClick={onClose}>
        <div className="ResetPassword" onClick={(e) => e.stopPropagation()}>
          <div className="ResetPassword__Header">
            <h2 className="ResetPassword__Title">{t('modal.resetPassword.doneTitle')}</h2>
            <button type="button" className="ResetPassword__CloseBtn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div className="ResetPassword__Body">
            <div className="ResetPassword__EmailSent">
              <Mail size={32} style={{ color: 'var(--color-primary)', marginBottom: 12 }} />
              <p className="ResetPassword__Description">
                {t('modal.resetPassword.emailSentTo')}<br />
                <strong>{user.email}</strong>
              </p>
              <p className="ResetPassword__Notice">
                {t('modal.resetPassword.linkNotice')}
              </p>
            </div>
          </div>

          <div className="ResetPassword__Footer">
            <button type="button" className="ResetPassword__SubmitBtn" onClick={onClose}>
              {t('modal.done')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 재설정 링크 결과 화면 (SMTP 미설정/발송 실패 시 관리자에게 링크 전달)
  if (resetLink) {
    return (
      <div className="ResetPassword__Backdrop" onClick={onClose}>
        <div className="ResetPassword" onClick={(e) => e.stopPropagation()}>
          <div className="ResetPassword__Header">
            <h2 className="ResetPassword__Title">{t('modal.resetPassword.doneTitle')}</h2>
            <button type="button" className="ResetPassword__CloseBtn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div className="ResetPassword__Body">
            <p className="ResetPassword__Description">
              <Trans
                i18nKey="modal.resetPassword.linkFor"
                values={{ name: user.username }}
                components={{ b: <strong /> }}
              />
            </p>
            <div className="ResetPassword__LinkDisplay">
              <Link2 size={16} className="ResetPassword__LinkIcon" />
              <span className="ResetPassword__LinkText">{resetLink}</span>
              <button
                type="button"
                className="ResetPassword__CopyBtn"
                onClick={handleCopy}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t('modal.resetPassword.copied') : t('modal.resetPassword.copy')}
              </button>
            </div>
            <p className="ResetPassword__Notice">
              {t('modal.resetPassword.shareNotice')}
            </p>
          </div>

          <div className="ResetPassword__Footer">
            <button type="button" className="ResetPassword__SubmitBtn" onClick={onClose}>
              {t('modal.done')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 비밀번호 초기화 확인 화면
  return (
    <div className="ResetPassword__Backdrop" onClick={onClose}>
      <form className="ResetPassword" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="ResetPassword__Header">
          <h2 className="ResetPassword__Title">{t('modal.resetPassword.title')}</h2>
          <button type="button" className="ResetPassword__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="ResetPassword__Body">
          <p className="ResetPassword__Description">
            <Trans
              i18nKey="modal.resetPassword.confirmFor"
              values={{ name: user.username, email: user.email }}
              components={{ b: <strong /> }}
            />
          </p>
          <p className="ResetPassword__Notice">
            {t('modal.resetPassword.confirmNotice')}
          </p>

          {error && <div className="ResetPassword__Error">{error}</div>}
        </div>

        <div className="ResetPassword__Footer">
          <button type="button" className="ResetPassword__CancelBtn" onClick={onClose}>
            {t('common.actions.cancel')}
          </button>
          <button
            type="submit"
            className="ResetPassword__SubmitBtn"
            disabled={loading}
          >
            {loading ? t('modal.resetPassword.resetting') : t('modal.resetPassword.title')}
          </button>
        </div>
      </form>
    </div>
  );
}
