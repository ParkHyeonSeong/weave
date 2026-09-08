import { useState, useEffect, useRef } from 'react';
import { User, Mail, Lock, Eye, EyeOff, Camera, Trash2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import Alert from '@/components/modal/Alert';
import ProfileTokens from '@/components/Profile/ProfileTokens';
import AppearanceSection from '@/components/Profile/AppearanceSection';
import LanguageRegionSection from '@/components/Profile/LanguageRegionSection';
import { useTranslation } from 'react-i18next';
import Avatar from '@/components/common/Avatar';
import { AVATAR_COLORS } from '@/library/userAvatar';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

// sessionStorage의 profile 객체에 변경분을 병합하고 헤더 동기화 이벤트 발생
function syncProfileSession(patch) {
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    sessionStorage.setItem('profile', JSON.stringify({ ...profile, ...patch }));
  } catch {}
  window.dispatchEvent(new CustomEvent('profile:updated'));
}

export default function Profile() {
  const { t } = useTranslation();
  // 프로필 정보
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [userId, setUserId] = useState(null);
  const [avatarColor, setAvatarColor] = useState(null);
  const [colorSaving, setColorSaving] = useState(false);
  const [avatarDeleting, setAvatarDeleting] = useState(false);
  const [loading, setLoading] = useState(true);

  // 이름 변경
  const [newUsername, setNewUsername] = useState('');
  const [usernameSaving, setUsernameSaving] = useState(false);

  // 비밀번호 변경
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  // 아바타 업로드
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Alert
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const showAlert = (title, message) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertOpen(true);
  };

  // 프로필 로드
  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await axios.get('/profile/me');
      if (res.data.status) {
        const user = res.data.user;
        setEmail(user.email);
        setUsername(user.username);
        setNewUsername(user.username);
        setAvatarUrl(user.avatar_url || '');
        setUserId(user.user_id ?? null);
        setAvatarColor(user.avatar_color || null);
        if (user.avatar_url) {
          sessionStorage.setItem('avatar_url', user.avatar_url);
        }
      }
    } catch {
      showAlert(t('account.alerts.error'), t('account.profile.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 이름 변경
  const handleUsernameSubmit = async (e) => {
    e.preventDefault();
    if (usernameSaving) return;
    if (!newUsername.trim()) {
      showAlert(t('account.alerts.error'), t('account.profile.nameRequired'));
      return;
    }
    if (newUsername === username) return;

    setUsernameSaving(true);
    try {
      const res = await axios.patch('/profile/username', { username: newUsername });
      if (res.data.status) {
        sessionStorage.setItem('profile', JSON.stringify(res.data.profile));
        setUsername(newUsername);
        window.dispatchEvent(new CustomEvent('profile:updated'));
        showAlert(t('account.alerts.success'), t('account.profile.nameUpdated'));
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('account.profile.nameUpdateFailed');
        showAlert(t('account.alerts.error'), msg);
      }
    } catch {
      showAlert(t('account.alerts.error'), t('account.profile.nameUpdateFailed'));
    } finally {
      setUsernameSaving(false);
    }
  };

  // 비밀번호 변경
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (passwordSaving) return;
    if (!currentPassword) {
      showAlert(t('account.alerts.error'), t('account.password.currentRequired'));
      return;
    }
    if (newPassword.length < 8) {
      showAlert(t('account.alerts.error'), t('account.password.tooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert(t('account.alerts.error'), t('auth.passwordMismatch'));
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await axios.patch('/profile/password', {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      if (res.data.status) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        showAlert(t('account.alerts.success'), t('account.password.updated'));
      } else {
        const err = getError(res.data);
        let fallback = t('account.password.updateFailed');
        if (err.code === 'INVALID_CURRENT_PASSWORD') fallback = t('account.password.currentIncorrect');
        else if (err.code === 'PASSWORD_MISMATCH') fallback = t('account.password.newMismatch');
        const msg = errorText(err.code, err.category) ?? fallback;
        showAlert(t('account.alerts.error'), msg);
      }
    } catch {
      showAlert(t('account.alerts.error'), t('account.password.updateFailed'));
    } finally {
      setPasswordSaving(false);
    }
  };

  // 아바타 업로드
  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      showAlert(t('account.alerts.error'), t('account.avatar.invalidType'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showAlert(t('account.alerts.error'), t('account.avatar.tooLarge'));
      return;
    }

    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post('/profile/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data.status) {
        setAvatarUrl(res.data.avatar_url);
        sessionStorage.setItem('avatar_url', res.data.avatar_url);
        window.dispatchEvent(new CustomEvent('profile:updated'));
        showAlert(t('account.alerts.success'), t('account.avatar.updated'));
      } else {
        const err = getError(res.data);
        let fallback = t('account.avatar.uploadFailed');
        if (err.code === 'INVALID_FILE_TYPE') fallback = t('account.avatar.invalidTypeShort');
        else if (err.code === 'FILE_TOO_LARGE') fallback = t('account.avatar.tooLarge');
        const msg = errorText(err.code, err.category) ?? fallback;
        showAlert(t('account.alerts.error'), msg);
      }
    } catch {
      showAlert(t('account.alerts.error'), t('account.avatar.uploadFailed'));
    } finally {
      setAvatarUploading(false);
      e.target.value = '';
    }
  };

  // 아바타 사진 제거
  const handleAvatarDelete = async () => {
    if (avatarDeleting) return;
    setAvatarDeleting(true);
    try {
      const res = await axios.delete('/profile/avatar');
      if (res.data.status) {
        setAvatarUrl('');
        sessionStorage.removeItem('avatar_url');
        // avatar_url은 별도 sessionStorage 키 — 이벤트로 헤더만 갱신
        window.dispatchEvent(new CustomEvent('profile:updated'));
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('account.avatar.removeFailed');
        showAlert(t('account.alerts.error'), msg);
      }
    } catch {
      showAlert(t('account.alerts.error'), t('account.avatar.removeFailed'));
    } finally {
      setAvatarDeleting(false);
    }
  };

  // 아바타 색상 선택 (null = 자동 해시 색)
  const handleColorSelect = async (color) => {
    if (colorSaving || color === avatarColor) return;
    setColorSaving(true);
    const prev = avatarColor;
    setAvatarColor(color); // 즉시 미리보기 반영
    try {
      const res = await axios.patch('/profile/avatar-color', { color });
      if (res.data.status) {
        const saved = res.data.avatar_color ?? null;
        setAvatarColor(saved);
        syncProfileSession({ avatar_color: saved });
      } else {
        setAvatarColor(prev);
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('account.avatar.colorUpdateFailed');
        showAlert(t('account.alerts.error'), msg);
      }
    } catch {
      setAvatarColor(prev);
      showAlert(t('account.alerts.error'), t('account.avatar.colorUpdateFailed'));
    } finally {
      setColorSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="Profile">
      <h1 className="Profile__Title">{t('account.profile.title')}</h1>

      {/* 아바타 섹션 */}
      <div className="Profile__Section">
        <h2 className="Profile__SectionTitle">{t('profile.avatar')}</h2>
        <div className="Profile__AvatarArea">
          <div className="Profile__AvatarPreview" onClick={handleAvatarClick}>
            <Avatar
              name={username}
              userId={userId}
              avatarUrl={avatarUrl}
              avatarColor={avatarColor}
              size={80}
              className="Profile__AvatarMain"
            />
            <div className="Profile__AvatarOverlay">
              {avatarUploading ? (
                <span className="Profile__AvatarSpinner" />
              ) : (
                <Camera size={20} />
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleAvatarChange}
            hidden
          />
          <div className="Profile__AvatarSide">
            <p className="Profile__AvatarHint">{t('account.avatar.uploadHint')}</p>
            {avatarUrl && (
              <button
                type="button"
                className="Profile__AvatarRemoveBtn"
                onClick={handleAvatarDelete}
                disabled={avatarDeleting}
              >
                <Trash2 size={13} />
                {avatarDeleting ? t('account.avatar.removing') : t('account.avatar.removePhoto')}
              </button>
            )}
            <div className="Profile__ColorLabel">{t('account.avatar.colorLabel')}</div>
            <div className="Profile__ColorRow">
              <button
                type="button"
                className={`Profile__ColorAuto ${avatarColor == null ? 'Profile__ColorAuto--selected' : ''}`}
                title={t('account.avatar.autoColorTitle')}
                onClick={() => handleColorSelect(null)}
              >
                {t('account.avatar.auto')}
              </button>
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`Profile__ColorSwatch ${avatarColor === c ? 'Profile__ColorSwatch--selected' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => handleColorSelect(c)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 이름 변경 섹션 */}
      <div className="Profile__Section">
        <h2 className="Profile__SectionTitle">{t('profile.name')}</h2>
        <form className="Profile__Form" onSubmit={handleUsernameSubmit}>
          <div className="Profile__Field">
            <label className="Profile__Label">{t('auth.email')}</label>
            <div className="Profile__InputWrap">
              <Mail size={16} className="Profile__InputIcon" />
              <input className="Profile__Input Profile__Input--disabled" value={email} disabled />
            </div>
          </div>
          <div className="Profile__Field">
            <label className="Profile__Label">{t('auth.name')}</label>
            <div className="Profile__InputWrap">
              <User size={16} className="Profile__InputIcon" />
              <input
                className="Profile__Input"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder={t('auth.namePlaceholder')}
              />
            </div>
          </div>
          <button
            type="submit"
            className="Profile__SaveBtn"
            disabled={usernameSaving || newUsername === username}
          >
            {usernameSaving ? t('common.state.saving') : t('account.profile.saveName')}
          </button>
        </form>
      </div>

      {/* 표시 설정 섹션 — 공개 플래그 뒤에서만 DOM을 만든다 */}
      <AppearanceSection />

      <LanguageRegionSection />

      {/* 비밀번호 변경 섹션 */}
      <div className="Profile__Section">
        <h2 className="Profile__SectionTitle">{t('profile.changePassword')}</h2>
        <form className="Profile__Form" onSubmit={handlePasswordSubmit}>
          <div className="Profile__Field">
            <label className="Profile__Label">{t('account.password.currentLabel')}</label>
            <div className="Profile__InputWrap">
              <Lock size={16} className="Profile__InputIcon" />
              <input
                className="Profile__Input"
                type={showCurrentPw ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t('account.password.currentPlaceholder')}
              />
              <button
                type="button"
                className="Profile__TogglePassword"
                onClick={() => setShowCurrentPw((prev) => !prev)}
              >
                {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="Profile__Field">
            <label className="Profile__Label">{t('account.password.newLabel')}</label>
            <div className="Profile__InputWrap">
              <Lock size={16} className="Profile__InputIcon" />
              <input
                className="Profile__Input"
                type={showNewPw ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('account.password.newPlaceholder')}
              />
              <button
                type="button"
                className="Profile__TogglePassword"
                onClick={() => setShowNewPw((prev) => !prev)}
              >
                {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="Profile__Field">
            <label className="Profile__Label">{t('account.password.confirmLabel')}</label>
            <div className="Profile__InputWrap">
              <Lock size={16} className="Profile__InputIcon" />
              <input
                className="Profile__Input"
                type={showNewPw ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('account.password.confirmPlaceholder')}
              />
            </div>
          </div>
          <button
            type="submit"
            className="Profile__SaveBtn"
            disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
          >
            {passwordSaving ? t('common.state.saving') : t('profile.changePassword')}
          </button>
        </form>
      </div>

      <ProfileTokens showAlert={showAlert} />

      <Alert isOpen={alertOpen} title={alertTitle} contents={alertMessage} onClose={() => setAlertOpen(false)} />
    </div>
  );
}
