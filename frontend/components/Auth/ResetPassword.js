import { useState } from 'react';
import { useRouter } from 'next/router';
import { Lock, Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import { LOGIN_PATH } from '@/library/authRedirect';
import Alert from '@/components/modal/Alert';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useTranslation } from 'react-i18next';


export default function ResetPassword({ token }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Alert 상태
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const showAlert = (title, message) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertOpen(true);
  };

  // 토큰 없음 → 유효하지 않은 링크 안내
  if (!token) {
    return (
      <div className="ChangePassword">
        <div className="ChangePassword__Card">
          <div className="ChangePassword__Header">
            <h1 className="ChangePassword__Logo">Weave</h1>
            <p className="ChangePassword__Subtitle">
              {t('authAdmin.reset.invalidLink')}
            </p>
          </div>
          <button
            type="button"
            className="ChangePassword__SubmitBtn"
            onClick={() => router.replace(LOGIN_PATH)}
          >
            {t('authAdmin.reset.goToSignIn')}
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    if (newPassword.length < 8) {
      showAlert(t('auth.inputError'), t('errors.PASSWORD_TOO_SHORT'));
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert(t('auth.inputError'), t('auth.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post('/auth/reset-password', {
        token,
        new_password: newPassword,
      });

      if (res.data.status) {
        setDone(true);
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('errors.INVALID_OR_EXPIRED_TOKEN');
        showAlert(t('common.state.error'), msg);
      }
    } catch {
      showAlert(t('common.state.error'), t('auth.unexpectedError'));
    } finally {
      setLoading(false);
    }
  };

  // 변경 완료 화면
  if (done) {
    return (
      <div className="ChangePassword">
        <div className="ChangePassword__Card">
          <div className="ChangePassword__Header">
            <CheckCircle2 size={32} style={{ color: 'var(--color-success)', marginBottom: 8 }} />
            <h1 className="ChangePassword__Logo">{t('authAdmin.reset.doneTitle')}</h1>
            <p className="ChangePassword__Subtitle">
              {t('authAdmin.reset.doneSubtitle')}
            </p>
          </div>
          <button
            type="button"
            className="ChangePassword__SubmitBtn"
            onClick={() => router.replace(LOGIN_PATH)}
          >
            {t('authAdmin.reset.goToSignIn')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ChangePassword">
      <div className="ChangePassword__Card">
        <div className="ChangePassword__Header">
          <h1 className="ChangePassword__Logo">Weave</h1>
          <p className="ChangePassword__Subtitle">
            {t('authAdmin.reset.subtitle')}
          </p>
        </div>

        <form className="ChangePassword__Form" onSubmit={handleSubmit} onKeyDown={(e) => {
          if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
        }}>
          <div className="ChangePassword__Field">
            <label className="ChangePassword__Label" htmlFor="newPassword">{t('authAdmin.password.newPassword')}</label>
            <div className="ChangePassword__InputWrap">
              <Lock size={16} className="ChangePassword__InputIcon" />
              <input
                id="newPassword"
                type={showPassword ? 'text' : 'password'}
                className="ChangePassword__Input"
                placeholder={t('authAdmin.password.minLengthPlaceholder')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                required
              />
              <button
                type="button"
                className="ChangePassword__TogglePassword"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="ChangePassword__Field">
            <label className="ChangePassword__Label" htmlFor="confirmPassword">{t('auth.confirmPassword')}</label>
            <div className="ChangePassword__InputWrap">
              <Lock size={16} className="ChangePassword__InputIcon" />
              <input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                className="ChangePassword__Input"
                placeholder={t('auth.confirmPasswordPlaceholder')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          <button type="submit" className="ChangePassword__SubmitBtn" disabled={loading}>
            {loading
              ? <Loader2 size={18} className="ChangePassword__Spinner" />
              : t('authAdmin.reset.submit')
            }
          </button>
        </form>
      </div>

      <Alert
        isOpen={alertOpen}
        title={alertTitle}
        contents={alertMessage}
        onClose={() => setAlertOpen(false)}
      />
    </div>
  );
}
