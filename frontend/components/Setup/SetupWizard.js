import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Building2, Users, Shield, Mail, Lock, User, Globe,
  Eye, EyeOff, Loader2, ArrowRight, ArrowLeft, Check
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import Alert from '@/components/modal/Alert';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useLanguageRegionPreference } from '@/library/locale';
import { normalizeLanguageRegion } from '@/library/localePrefs';
import { COMPAT_TIME_ZONE, detectTimeZone } from '@/library/localePrefs';
import { clearWorkspaceSettingsCache } from '@/library/workspaceSettings';
import LanguageRegionFields from '@/components/common/LanguageRegionFields';
import TimeZoneSelect from '@/components/common/TimeZoneSelect';

// Step 1이 개인 언어·시간대인 이유: 첫 관리자는 나머지 설치 화면을 읽기 전에 자기 언어를
// 골라야 한다. workspace 시간대는 **별개 설정**이라 Step 2(워크스페이스)에 둔다 —
// 두 값을 한 화면에 섞으면 사용자가 같은 설정으로 오해한다.
const TOTAL_STEPS = 4;

export default function SetupWizard() {
  const router = useRouter();
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: 개인 언어·시간대 (이 관리자 계정의 설정 — workspace 설정이 아니다)
  // 초안 = 익명 표시 언어(있으면) + 감지된 시간대. 라디오를 누르면 위저드 문구가 즉시 그 언어로
  // 미리 보이고(저장 없음), Next에서 언어만 익명 표시 언어로 확정한다. 시간대는 기기에 남기지
  // 않고 initialize 요청에 실어 관리자 계정과 같은 트랜잭션으로 저장한다.
  const { value: languageRegion, choose: chooseLanguageRegion, previewLocale } = useLanguageRegionPreference();
  const [languageDraft, setLanguageDraft] = useState(languageRegion);
  const [languageTouched, setLanguageTouched] = useState(false);
  useEffect(() => { if (!languageTouched) setLanguageDraft(languageRegion); }, [languageRegion, languageTouched]);
  const onLanguageDraftChange = (next) => {
    setLanguageTouched(true);
    setLanguageDraft(next);
    if (next.locale !== languageDraft.locale) previewLocale(next.locale);
  };

  // Step 2: 워크스페이스 (이름 + 공용 시간대)
  const [workspaceName, setWorkspaceName] = useState('');
  // 감지값을 **제안**하되 자동 확정하지 않는다 — 관리자가 이 화면에서 명시적으로 확인한다.
  const [detectedTimeZone] = useState(() => detectTimeZone());
  const [workspaceTimeZone, setWorkspaceTimeZone] = useState(() => detectTimeZone() || COMPAT_TIME_ZONE);

  // Step 3: 등록 정책
  const [registrationPolicy, setRegistrationPolicy] = useState('private');

  // Step 4: 관리자 계정
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Alert
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const showAlert = (title, message) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertOpen(true);
  };

  const handleNext = () => {
    if (step === 1) {
      // 언어만 익명 표시 언어로 확정한다(미인증이라 서버 쓰기 없음). 개인 language_region 전체는
      // 마지막 단계의 initialize 요청에 실려 관리자 생성과 같은 트랜잭션으로 저장된다.
      chooseLanguageRegion(languageDraft);
      setStep(step + 1);
      return;
    }
    if (step === 2 && !workspaceName.trim()) {
      showAlert(t('auth.inputError'), t('setup.enterWorkspaceName'));
      return;
    }
    setStep(step + 1);
  };

  const handleBack = () => {
    setStep(step - 1);
  };

  const handleSubmit = async () => {
    if (!username.trim()) {
      showAlert(t('auth.inputError'), t('auth.enterName'));
      return;
    }
    if (!email.trim()) {
      showAlert(t('auth.inputError'), t('setup.enterEmail'));
      return;
    }
    if (password.length < 8) {
      showAlert(t('auth.inputError'), t('errors.PASSWORD_TOO_SHORT'));
      return;
    }
    if (password !== confirmPassword) {
      showAlert(t('auth.inputError'), t('auth.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post('/setup/initialize', {
        workspace_name: workspaceName,
        registration_policy: registrationPolicy,
        email,
        password,
        username,
        time_zone: workspaceTimeZone,
        // 첫 관리자의 개인 언어·시간대 — 관리자 생성과 같은 트랜잭션에서 user.ui_prefs에 저장된다.
        // 설치 뒤 비동기 승격에 기대지 않는다.
        language_region: normalizeLanguageRegion(languageDraft),
      });

      if (res.data.status) {
        sessionStorage.setItem('profile', JSON.stringify(res.data.profile));
        // 방금 초기화됐으므로 이전(미초기화) 응답 캐시를 버린다 — 다음 조회가
        // workspace_name과 time_zone이 담긴 최신 응답을 받는다.
        clearWorkspaceSettingsCache();
        router.push('/');
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('auth.unexpectedError');
        showAlert(t('common.state.error'), msg);
      }
    } catch (error) {
      showAlert(t('common.state.error'), t('auth.unexpectedError'));
    } finally {
      setLoading(false);
    }
  };

  const stepLabel = (s) => {
    if (s === 1) return t('setup.stepLanguage');
    if (s === 2) return t('setup.stepWorkspace');
    if (s === 3) return t('setup.stepPolicy');
    return t('setup.stepAdmin');
  };

  const stepClass = (s) => {
    let cls = 'Setup__Step';
    if (s === step) cls += ' Setup__Step--active';
    if (s < step) cls += ' Setup__Step--done';
    return cls;
  };

  return (
    <div className="Setup">
      <div className="Setup__Card">
        <div className="Setup__Header">
          <h1 className="Setup__Logo">Weave</h1>
          <p className="Setup__Subtitle">{t('setup.heading')}</p>
        </div>

        {/* 스텝 인디케이터 */}
        <div className="Setup__Steps">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className={stepClass(s)}>
              <div className="Setup__StepCircle">
                {s < step ? <Check size={14} /> : s}
              </div>
              <span className="Setup__StepLabel">{stepLabel(s)}</span>
            </div>
          ))}
        </div>

        <form onSubmit={(e) => {
          e.preventDefault();
          if (step < TOTAL_STEPS) handleNext();
          else handleSubmit();
        }}>
          {/* Step 1: 개인 언어·시간대 — 첫 관리자가 나머지 화면을 읽기 전에 고른다 */}
          {step === 1 && (
            <div className="Setup__Content">
              <div className="Setup__ContentHeader">
                <Globe size={20} className="Setup__ContentIcon" />
                <h2 className="Setup__ContentTitle">
                  {t('languageRegion.gateTitle')}
                  <span className="Setup__ContentTitleAlt">{t('languageRegion.gateTitleAlt')}</span>
                </h2>
              </div>
              <p className="Setup__ContentDesc">{t('setup.yourLanguageAndRegion')}</p>
              <LanguageRegionFields
                value={languageDraft}
                onChange={onLanguageDraftChange}
                idPrefix="setup-language-region"
                bilingualLabels
              />
            </div>
          )}

          {/* Step 2: 워크스페이스 이름 + 공용 시간대 */}
          {step === 2 && (
            <div className="Setup__Content">
              <div className="Setup__ContentHeader">
                <Building2 size={20} className="Setup__ContentIcon" />
                <h2 className="Setup__ContentTitle">{t('setup.workspaceName')}</h2>
              </div>
              <p className="Setup__ContentDesc">{t('setup.workspaceNameDesc')}</p>
              <div className="Setup__Field">
                <div className="Setup__InputWrap">
                  <Building2 size={16} className="Setup__InputIcon" />
                  <input
                    type="text"
                    className="Setup__Input"
                    placeholder={t('setup.workspaceNamePlaceholder')}
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              {/* 개인 시간대와 **별개**임을 이 자리에서 분명히 말한다. */}
              <div className="Setup__Field WorkspaceTimeZone">
                <label className="Setup__Label" htmlFor="setup-workspace-tz">
                  {t('workspaceTimeZone.label')}
                </label>
                <TimeZoneSelect
                  id="setup-workspace-tz"
                  value={workspaceTimeZone}
                  onChange={setWorkspaceTimeZone}
                />
                <p className="WorkspaceTimeZone__Help">{t('workspaceTimeZone.help')}</p>
                <p className="WorkspaceTimeZone__Distinction">{t('workspaceTimeZone.distinction')}</p>
                {detectedTimeZone && (
                  <p className="WorkspaceTimeZone__Detected">
                    {t('workspaceTimeZone.detected', { timeZone: detectedTimeZone })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 3: 등록 정책 */}
          {step === 3 && (
            <div className="Setup__Content">
              <div className="Setup__ContentHeader">
                <Users size={20} className="Setup__ContentIcon" />
                <h2 className="Setup__ContentTitle">{t('setup.registrationPolicy')}</h2>
              </div>
              <p className="Setup__ContentDesc">{t('setup.registrationPolicyDesc')}</p>
              <div className="Setup__PolicyCards">
                <button
                  type="button"
                  className={`Setup__PolicyCard ${registrationPolicy === 'public' ? 'Setup__PolicyCard--active' : ''}`}
                  onClick={() => setRegistrationPolicy('public')}
                >
                  <Users size={24} className="Setup__PolicyIcon" />
                  <strong className="Setup__PolicyTitle">{t('setup.policyPublic')}</strong>
                  <p className="Setup__PolicyDesc">{t('setup.policyPublicHint')}</p>
                </button>
                <button
                  type="button"
                  className={`Setup__PolicyCard ${registrationPolicy === 'private' ? 'Setup__PolicyCard--active' : ''}`}
                  onClick={() => setRegistrationPolicy('private')}
                >
                  <Shield size={24} className="Setup__PolicyIcon" />
                  <strong className="Setup__PolicyTitle">{t('setup.policyPrivate')}</strong>
                  <p className="Setup__PolicyDesc">{t('setup.policyPrivateHint')}</p>
                </button>
              </div>
            </div>
          )}

          {/* Step 4: 관리자 계정 */}
          {step === 4 && (
            <div className="Setup__Content">
              <div className="Setup__ContentHeader">
                <Shield size={20} className="Setup__ContentIcon" />
                <h2 className="Setup__ContentTitle">{t('setup.adminAccount')}</h2>
              </div>
              <p className="Setup__ContentDesc">{t('setup.adminAccountDesc')}</p>
              <div className="Setup__Form">
                <div className="Setup__Field">
                  <label className="Setup__Label" htmlFor="setup-username">{t('auth.name')}</label>
                  <div className="Setup__InputWrap">
                    <User size={16} className="Setup__InputIcon" />
                    <input
                      id="setup-username"
                      type="text"
                      className="Setup__Input"
                      placeholder={t('auth.namePlaceholder')}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="name"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="Setup__Field">
                  <label className="Setup__Label" htmlFor="setup-email">{t('auth.email')}</label>
                  <div className="Setup__InputWrap">
                    <Mail size={16} className="Setup__InputIcon" />
                    <input
                      id="setup-email"
                      type="email"
                      className="Setup__Input"
                      placeholder="admin@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="Setup__Field">
                  <label className="Setup__Label" htmlFor="setup-password">{t('auth.password')}</label>
                  <div className="Setup__InputWrap">
                    <Lock size={16} className="Setup__InputIcon" />
                    <input
                      id="setup-password"
                      type={showPassword ? 'text' : 'password'}
                      className="Setup__Input"
                      placeholder={t('setup.passwordPlaceholder')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="Setup__TogglePassword"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="Setup__Field">
                  <label className="Setup__Label" htmlFor="setup-confirm">{t('auth.confirmPassword')}</label>
                  <div className="Setup__InputWrap">
                    <Lock size={16} className="Setup__InputIcon" />
                    <input
                      id="setup-confirm"
                      type={showPassword ? 'text' : 'password'}
                      className="Setup__Input"
                      placeholder={t('auth.confirmPasswordPlaceholder')}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 하단 버튼 */}
          <div className="Setup__Actions">
            {step > 1 && (
              <button type="button" className="Setup__BackBtn" onClick={handleBack}>
                <ArrowLeft size={16} /> {t('common.actions.back')}
              </button>
            )}
            <div className="Setup__ActionsSpacer" />
            {step < TOTAL_STEPS ? (
              <button type="submit" className="Setup__NextBtn">
                {t('common.actions.next')} <ArrowRight size={16} />
              </button>
            ) : (
              <button type="submit" className="Setup__SubmitBtn" disabled={loading}>
                {loading ? <Loader2 size={18} className="Setup__Spinner" /> : t('setup.complete')}
              </button>
            )}
          </div>
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
