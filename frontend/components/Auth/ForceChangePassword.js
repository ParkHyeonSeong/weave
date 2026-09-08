import { useState } from 'react';
import { useRouter } from 'next/router';
import { Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getReturnToFromQuery } from '@/library/authRedirect';
import Alert from '@/components/modal/Alert';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useTranslation } from 'react-i18next';


export default function ForceChangePassword() {
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

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
      const res = await axios.post('/profile/force-change-password', {
        new_password: newPassword,
        confirm_password: confirmPassword,
      });

      if (res.data.status) {
        // sessionStorage에서 must_change_password 플래그 제거
        const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
        delete profile.must_change_password;
        sessionStorage.setItem('profile', JSON.stringify(profile));
        router.replace(getReturnToFromQuery(router.query));
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('auth.unexpectedError');
        showAlert(t('common.state.error'), msg);
      }
    } catch {
      showAlert(t('common.state.error'), t('auth.unexpectedError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ChangePassword">
      <div className="ChangePassword__Card">
        <div className="ChangePassword__Header">
          <h1 className="ChangePassword__Logo">Weave</h1>
          <p className="ChangePassword__Subtitle">
            {t('authAdmin.password.forceSubtitle')}
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
              : t('authAdmin.password.changeSubmit')
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
