import { useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { Mail, Lock, User, Eye, EyeOff, Loader2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import { buildChangePasswordPath, getReturnToFromQuery } from '@/library/authRedirect';
import Alert from '@/components/modal/Alert';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useTranslation } from 'react-i18next';
import LocaleMenu from '@/components/common/LocaleMenu';


export default function Login() {
  const router = useRouter();
  const { t } = useTranslation();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [loading, setLoading] = useState(false);

  // 폼 상태
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordInputRef = useRef(null);

  // Alert 상태
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  // 로그인 실패 알림 여부 (모달 닫힘 시 password 초기화/포커스 처리용)
  const [isLoginFailure, setIsLoginFailure] = useState(false);

  const showAlert = (title, message, loginFailure = false) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setIsLoginFailure(loginFailure);
    setAlertOpen(true);
  };

  const handleAlertClose = () => {
    setAlertOpen(false);
    if (isLoginFailure) {
      setPassword('');
      // 모달 언마운트 후 포커스 이동 (requestAnimationFrame으로 DOM 업데이트 후 실행)
      requestAnimationFrame(() => {
        passwordInputRef.current?.focus();
      });
      setIsLoginFailure(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    // 회원가입 검증
    if (mode === 'register') {
      if (!username.trim()) {
        showAlert(t('auth.inputError'), t('auth.enterName'));
        return;
      }
      if (password !== confirmPassword) {
        showAlert(t('auth.inputError'), t('auth.passwordMismatch'));
        return;
      }
      if (password.length < 8) {
        showAlert(t('auth.inputError'), t('errors.PASSWORD_TOO_SHORT'));
        return;
      }
    }

    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const payload = mode === 'login'
        ? { email, password }
        : { email, password, username };

      const response = await axios.post(endpoint, payload);

      if (response.data.status) {
        // 회원가입: 이메일 열거 방지를 위해 신규/기존을 구별하지 않는 중립 응답.
        // 가입은 자동로그인하지 않으므로(쿠키/프로필 없음) 로그인 화면으로 안내한다.
        if (mode === 'register') {
          showAlert(
            t('authAdmin.login.registrationSubmittedTitle'),
            t('authAdmin.login.registrationSubmittedMessage')
          );
          setMode('login');
          return;
        }
        sessionStorage.setItem('profile', JSON.stringify(response.data.profile));
        if (response.data.profile.avatar_url) {
          sessionStorage.setItem('avatar_url', response.data.profile.avatar_url);
        } else {
          // 이전 세션 사용자의 사진이 남아 다른 계정에 노출되는 것 방지
          sessionStorage.removeItem('avatar_url');
        }

        const returnTo = getReturnToFromQuery(router.query);

        // 비밀번호 변경 강제
        if (response.data.profile.must_change_password) {
          router.replace(buildChangePasswordPath(returnTo));
          return;
        }
        router.replace(returnTo);
      } else {
        const isLoginAttempt = mode === 'login';
        const err = getError(response.data);
        const msg = errorText(err.code, err.category) ?? response.data.message ?? t('common.state.error');
        showAlert(t('common.state.error'), msg, isLoginAttempt);
      }
    } catch (error) {
      showAlert(t('common.state.error'), t('auth.unexpectedError'), mode === 'login');
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setConfirmPassword('');
    setUsername('');
  };

  return (
    <div className="Login">
      {/* 카드와 언어 선택은 하나의 세로 스택이다 — 언어 선택이 카드 옆에 떠 있으면
          "이 폼의 설정"인지 "화면 전역 설정"인지 읽히지 않고, 좁은 화면에서 카드를 밀어낸다. */}
      <div className="Login__Shell">
        <div className="Login__Card">
          <div className="Login__Header">
            <h1 className="Login__Logo">Weave</h1>
            <p className="Login__Subtitle">
              {mode === 'login' ? t('auth.signInSubtitle') : t('auth.signUpSubtitle')}
            </p>
          </div>

          <form className="Login__Form" onSubmit={handleSubmit} onKeyDown={(e) => {
            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
          }}>
            {mode === 'register' && (
              <div className="Login__Field">
                <label className="Login__Label" htmlFor="username">{t('auth.name')}</label>
                <div className="Login__InputWrap">
                  <User size={16} className="Login__InputIcon" />
                  <input
                    id="username"
                    type="text"
                    className="Login__Input"
                    placeholder={t('auth.namePlaceholder')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="name"
                  />
                </div>
              </div>
            )}

            <div className="Login__Field">
              <label className="Login__Label" htmlFor="email">{t('auth.email')}</label>
              <div className="Login__InputWrap">
                <Mail size={16} className="Login__InputIcon" />
                <input
                  id="email"
                  type="email"
                  className="Login__Input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="Login__Field">
              <label className="Login__Label" htmlFor="password">{t('auth.password')}</label>
              <div className="Login__InputWrap">
                <Lock size={16} className="Login__InputIcon" />
                <input
                  id="password"
                  ref={passwordInputRef}
                  type={showPassword ? 'text' : 'password'}
                  className="Login__Input"
                  placeholder={t('auth.passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
                <button
                  type="button"
                  className="Login__TogglePassword"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div className="Login__Field">
                <label className="Login__Label" htmlFor="confirmPassword">{t('auth.confirmPassword')}</label>
                <div className="Login__InputWrap">
                  <Lock size={16} className="Login__InputIcon" />
                  <input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    className="Login__Input"
                    placeholder={t('auth.confirmPasswordPlaceholder')}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>
            )}

            <button type="submit" className="Login__SubmitBtn" disabled={loading}>
              {loading
                ? <Loader2 size={18} className="Login__Spinner" />
                : mode === 'login' ? t('auth.signIn') : t('auth.createAccount')
              }
            </button>
          </form>

          <div className="Login__Footer">
            <span className="Login__FooterText">
              {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}
            </span>
            <button className="Login__FooterLink" onClick={toggleMode}>
              {mode === 'login' ? t('auth.signUp') : t('auth.signIn')}
            </button>
          </div>
        </div>

        {/* 카드 바로 아래 가운데. 팝오버는 trigger 아래로 열려 카드를 덮지 않는다. */}
        <div className="Login__LocaleBar">
          <LocaleMenu />
        </div>
      </div>

      <Alert
        isOpen={alertOpen}
        title={alertTitle}
        contents={alertMessage}
        onClose={handleAlertClose}
      />
    </div>
  );
}
