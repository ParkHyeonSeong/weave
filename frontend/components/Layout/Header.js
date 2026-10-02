import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { Search, Bell, Settings, Shield, AtSign, UserPlus, AlertCircle, MessageSquare, CheckCircle2, CircleDot, Menu, User, LogOut, Reply } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDateFormat } from '@/hooks/useDateFormat';
import { notificationText } from '@/library/serverMessages';
import { clearWorkspaceSettingsCache, useWorkspaceSettings } from '@/library/workspaceSettings';
import { LOGIN_PATH } from '@/library/authRedirect';
import AppSwitcher from './AppSwitcher';
import Avatar from '@/components/common/Avatar';
import NavLink from '@/components/common/NavLink';
import ThemeToggleButton from '@/components/Layout/ThemeToggleButton';
import { clearClientSession } from '@/library/sessionCleanup';
import { enablePush, getPushState, unsubscribeFromPush } from '@/library/pushSubscription';

// 키는 백엔드가 notify()에 넘기는 type 그대로다(예: task_status — core/service/task_transition.py).
const NOTI_ICONS = {
  mention: AtSign,
  chat_mention: AtSign,
  comment_reply: Reply,
  task_assigned: UserPlus,
  issue_created: AlertCircle,
  issue_comment: MessageSquare,
  issue_closed: CheckCircle2,
  issue_reopened: CircleDot,
  task_status: CheckCircle2,
};

// 알림 타입 → 색 그룹(스캔용) + 짧은 한글 라벨. 그룹 색은 SCSS의
// .Header__NotiChip--{group}가 입힌다(멘션=primary·태스크=success·이슈=warning).
// 매핑에 없는 타입은 칩을 그리지 않는다.
// label은 catalog 키다. 본문도 payload가 있으면 현재 언어로 다시 렌더한다
// (library/serverMessages.js — 구버전 행만 서버가 저장한 문장을 폴백으로 쓴다).
const NOTI_TYPE_META = {
  mention:             { group: 'mention', labelKey: 'notifications.types.mention' },
  chat_mention:        { group: 'mention', labelKey: 'notifications.types.mention' },
  comment_reply:       { group: 'task',    labelKey: 'notifications.types.reply' },
  task_assigned:       { group: 'task',    labelKey: 'notifications.types.assigned' },
  task_status:         { group: 'task',    labelKey: 'notifications.types.status' },
  issue_created:       { group: 'issue',   labelKey: 'notifications.types.issue' },
  issue_comment:       { group: 'issue',   labelKey: 'notifications.types.comment' },
  issue_closed:        { group: 'issue',   labelKey: 'notifications.types.closed' },
  issue_reopened:      { group: 'issue',   labelKey: 'notifications.types.reopened' },
};

export default function Header({ isMobile, isHome = false, hasSidebar = false, onToggleSidebar, onSearchClick, notifications = [], unreadCount = 0, chatUnreadCount = 0, onChatClick, onClearNotifications, onMarkAllRead, onReadNotification, onNotiClick }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { formatMessageTime } = useDateFormat();
  // 워크스페이스 이름은 공유 Provider에서 온다 — 예전엔 이 컴포넌트가 /setup/status를
  // 따로 호출해 _app.js의 같은 호출과 중복됐다.
  const { workspaceName } = useWorkspaceSettings();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [userId, setUserId] = useState(null);
  const [avatarColor, setAvatarColor] = useState(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showNotiMenu, setShowNotiMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [notiFilterUnread, setNotiFilterUnread] = useState(false);
  // 이 기기의 푸시 상태(getPushState). 종 드롭다운을 열 때마다 다시 읽는다 — 브라우저 설정이나
  // 다른 탭에서 바뀔 수 있다. null은 아직 모름이고, 'subscribed'·'unsupported'면 안내를 그리지 않는다.
  const [pushState, setPushState] = useState(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushFailed, setPushFailed] = useState(false);
  const settingsRef = useRef(null);
  const notiRef = useRef(null);
  const userMenuRef = useRef(null);

  useEffect(() => {
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      setUsername(profile.username || '');
      setRole(profile.role || '');
      setAvatarUrl(sessionStorage.getItem('avatar_url') || '');
      setUserId(profile.user_id ?? null);
      setAvatarColor(profile.avatar_color ?? null);
    } catch {}

  }, []);

  // 프로필 변경 시 헤더 갱신
  useEffect(() => {
    const handleProfileUpdate = () => {
      try {
        const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
        setUsername(profile.username || '');
        setAvatarUrl(sessionStorage.getItem('avatar_url') || '');
        setUserId(profile.user_id ?? null);
        setAvatarColor(profile.avatar_color ?? null);
      } catch {}
    };
    window.addEventListener('profile:updated', handleProfileUpdate);
    return () => window.removeEventListener('profile:updated', handleProfileUpdate);
  }, []);

  // 클릭 외부 감지로 드롭다운 닫기
  useEffect(() => {
    if (!showSettingsMenu && !showNotiMenu && !showUserMenu) return;
    const handleClickOutside = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettingsMenu(false);
      }
      if (notiRef.current && !notiRef.current.contains(e.target)) {
        setShowNotiMenu(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSettingsMenu, showNotiMenu, showUserMenu]);

  useEffect(() => {
    if (!showNotiMenu) return;
    let alive = true;
    getPushState().then((state) => { if (alive) setPushState(state); });
    return () => { alive = false; };
  }, [showNotiMenu]);

  // ⚠️ enablePush()보다 앞에 await를 두지 않는다 — 권한 창은 클릭 안에서 시작된 요청에만 뜬다.
  const handleEnablePush = async () => {
    setPushBusy(true);
    setPushFailed(false);
    const ok = await enablePush();
    if (ok) {
      setPushState('subscribed');
    } else {
      // 권한은 허용됐는데 연결에 실패했으면 다시 시도할 수 있게 남긴다.
      // 권한 창을 닫기만 했거나(default) 차단했으면(denied) 실패가 아니다 — 그 상태 안내로 돌아간다.
      const next = await getPushState();
      const granted = next === 'subscribed' || next === 'unsubscribed';
      setPushState(granted ? 'unsubscribed' : next);
      setPushFailed(granted);
    }
    setPushBusy(false);
  };

  // 로그아웃: 이 기기 푸시 구독 해제 → 서버 세션(쿠키+refresh 토큰) 폐기 → JS 세션 상태 정리 → 로그인으로.
  // 푸시 구독의 서버 삭제는 로그인이 필요해 /auth/logout보다 먼저 끝나야 한다(안 하면 이 기기에 이전
  // 계정의 알림이 계속 뜬다). 실패는 unsubscribeFromPush가 삼키므로 로그아웃은 항상 계속된다.
  const handleLogout = async () => {
    setShowUserMenu(false);
    await unsubscribeFromPush();
    try {
      const { axios } = await import('@/library/_axios');
      await axios.post('/auth/logout');
    } catch {
      // 쿠키 폐기는 서버 책임이라 네트워크 실패해도 클라이언트는 계속 정리한다
    }
    clearClientSession();
    clearWorkspaceSettingsCache();
    // returnTo 미전달: 로그아웃 후 다시 보호 페이지로 복귀시키지 않는다
    router.replace(LOGIN_PATH);
  };

  // 알림 클릭 시 읽음 처리 + 해당 페이지로 이동
  const handleNotiClick = (noti) => {
    if (!noti.is_read && onReadNotification) {
      onReadNotification(noti.notification_id);
    }
    if (onNotiClick) {
      onNotiClick(noti);
    }
    if (noti.link) {
      router.push(noti.link);
    }
    setShowNotiMenu(false);
  };

  // 안읽음 필터: 토글 라벨 수는 "지금 로드된 목록"의 미읽음 기준(전역 unreadCount는
  // 30개 한도를 넘는 경우 필터 결과와 어긋날 수 있어, 실제 보일 것과 일치시킨다).
  const unreadNotis = notifications.filter((n) => !n.is_read);
  const notiUnreadInList = unreadNotis.length;
  const visibleNotis = notiFilterUnread ? unreadNotis : notifications;

  // 알림 행 내부(아바타/아이콘 + 본문)는 link 유무와 무관하게 동일 → 한 곳에서 그린다.
  const renderNotiInner = (noti) => {
    const Icon = NOTI_ICONS[noti.type] || Bell;
    const typeMeta = NOTI_TYPE_META[noti.type];
    return (
      <>
        {noti.actor_id ? (
          <div className="Header__NotiAvatar">
            <Avatar
              user={{
                name: noti.actor_name,
                id: noti.actor_id,
                avatar_url: noti.actor_avatar_url,
                avatar_color: noti.actor_avatar_color,
              }}
              size="sm"
            />
            <span className="Header__NotiTypeBadge">
              <Icon size={10} />
            </span>
          </div>
        ) : (
          // 행위자 없는 시스템 알림은 타입 아이콘을 메인 그래픽으로
          <div className="Header__NotiIcon">
            <Icon size={14} />
          </div>
        )}
        <div className="Header__NotiBody">
          <div className="Header__NotiItemTop">
            <span className="Header__NotiSenderWrap">
              <span className="Header__NotiSender">{noti.actor_name || t('layout.header.systemActor')}</span>
              {typeMeta && (
                <span className={`Header__NotiChip Header__NotiChip--${typeMeta.group}`}>
                  {t(typeMeta.labelKey)}
                </span>
              )}
            </span>
            <span className="Header__NotiTime">{formatMessageTime(noti.created_at)}</span>
          </div>
          <span className="Header__NotiContent">{notificationText(noti, t)}</span>
        </div>
      </>
    );
  };

  // 이 기기 알림 안내 줄: 권한 전(default)엔 켜기, 허용했지만 구독이 없으면 다시 연결,
  // 차단(denied)이면 브라우저 설정 안내. 구독돼 있거나 지원하지 않으면 그리지 않는다.
  const renderPushRow = () => {
    if (pushState === 'denied') {
      return (
        <div className="Header__NotiPush">
          <span className="Header__NotiPushText">{t('layout.header.push.blockedHint')}</span>
        </div>
      );
    }
    if (pushState !== 'default' && pushState !== 'unsubscribed') return null;
    const isDefault = pushState === 'default';
    return (
      <div className="Header__NotiPush">
        <span className="Header__NotiPushText">
          {t(isDefault ? 'layout.header.push.enableHint' : 'layout.header.push.reconnectHint')}
        </span>
        <button
          type="button"
          className="Header__NotiPushBtn"
          onClick={handleEnablePush}
          disabled={pushBusy}
        >
          {t(isDefault ? 'layout.header.push.enable' : 'layout.header.push.reconnect')}
        </button>
        {pushFailed && (
          <span className="Header__NotiPushError" role="alert">{t('layout.header.push.failed')}</span>
        )}
      </div>
    );
  };
  const pushRow = renderPushRow();

  // link가 있으면 네비게이션(NavLink), 없으면 사이드이펙트 전용 버튼. 내부는 공통.
  const renderNotiItem = (noti) => {
    const itemClass = `Header__NotiItem ${!noti.is_read ? 'Header__NotiItem--unread' : ''}`;
    if (noti.link) {
      return (
        <NavLink
          key={noti.notification_id}
          href={noti.link}
          className={itemClass}
          onClick={() => {
            if (!noti.is_read && onReadNotification) {
              onReadNotification(noti.notification_id);
            }
            if (onNotiClick) {
              onNotiClick(noti);
            }
            setShowNotiMenu(false);
          }}
        >
          {renderNotiInner(noti)}
        </NavLink>
      );
    }
    return (
      <button
        key={noti.notification_id}
        className={itemClass}
        onClick={() => handleNotiClick(noti)}
      >
        {renderNotiInner(noti)}
      </button>
    );
  };

  return (
    <header className={`Header ${isMobile ? 'Header--mobile' : ''}`}>
      <div className="Header__Left">
        {/* 모바일: 햄버거 메뉴 */}
        {isMobile && hasSidebar && (
          <button className="Header__IconBtn" onClick={onToggleSidebar} title={t('common.actions.menu')}>
            <Menu size={20} />
          </button>
        )}
        <NavLink href="/" className="Header__Logo">
          <img src="/icons/weave_square.svg" alt="Weave" className="Header__LogoIcon" />
          {!isMobile && <span className="Header__LogoText">Weave</span>}
          {!isMobile && workspaceName && (
            <>
              <span className="Header__Separator">/</span>
              <span className="Header__WorkspaceName">{workspaceName}</span>
            </>
          )}
        </NavLink>
        {!isHome && <><span className="Header__Separator">/</span><AppSwitcher /></>}
      </div>

      <div className="Header__Center">
        <button className="Header__SearchBtn" onClick={onSearchClick}>
          <Search size={14} className="Header__SearchIcon" />
          {!isMobile && <span className="Header__SearchText">{t('layout.header.search')}</span>}
          {!isMobile && <kbd className="Header__SearchShortcut">Cmd+K</kbd>}
        </button>
      </div>

      <div className="Header__Right">
        {isHome && <div id="home-controls" />}
        <ThemeToggleButton />
        <button
          className="Header__IconBtn"
          title={t('layout.panels.messenger')}
          onClick={onChatClick}
        >
          <MessageSquare size={18} />
          {chatUnreadCount > 0 && (
            <span className="Header__NotiBadge">
              {chatUnreadCount > 999 ? '999+' : chatUnreadCount}
            </span>
          )}
        </button>
        <div className="Header__NotiWrap" ref={notiRef}>
          <button
            className="Header__IconBtn"
            title={t('layout.header.notifications')}
            onClick={() => setShowNotiMenu((prev) => !prev)}
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="Header__NotiBadge">
                {unreadCount > 999 ? '999+' : unreadCount}
              </span>
            )}
          </button>
          {showNotiMenu && (
            <div className="Header__NotiMenu">
              <div className="Header__NotiHeader">
                <span className="Header__NotiTitle">{t('layout.header.notifications')}</span>
                <div className="Header__NotiActions">
                  {unreadCount > 0 && (
                    <button className="Header__NotiMarkAll" onClick={onMarkAllRead}>
                      {t('layout.header.markAllRead')}
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button className="Header__NotiClear" onClick={onClearNotifications}>
                      {t('layout.header.clearAll')}
                    </button>
                  )}
                </div>
              </div>
              {pushRow}
              {notifications.length > 0 && (
                <div className="Header__NotiFilter">
                  <button
                    className={`Header__NotiFilterBtn ${!notiFilterUnread ? 'Header__NotiFilterBtn--active' : ''}`}
                    onClick={() => setNotiFilterUnread(false)}
                  >
                    {t('layout.header.filterAll')}
                  </button>
                  <button
                    className={`Header__NotiFilterBtn ${notiFilterUnread ? 'Header__NotiFilterBtn--active' : ''}`}
                    onClick={() => setNotiFilterUnread(true)}
                  >
                    {t('layout.header.filterUnread')}{notiUnreadInList > 0 ? ` ${notiUnreadInList}` : ''}
                  </button>
                </div>
              )}
              <div className={`Header__NotiList ${pushRow ? 'Header__NotiList--withPush' : ''}`}>
                {notifications.length === 0 ? (
                  <div className="Header__NotiEmpty">{t('layout.header.noNotifications')}</div>
                ) : visibleNotis.length === 0 ? (
                  <div className="Header__NotiEmpty">{t('layout.header.noUnreadNotifications')}</div>
                ) : (
                  visibleNotis.map(renderNotiItem)
                )}
              </div>
            </div>
          )}
        </div>
        {/* 관리자 설정: 글로벌 admin 권한 보유자에게만 노출 (비관리자에겐 버튼 자체를 숨김) */}
        {role === 'admin' && (
          <div className="Header__SettingsWrap" ref={settingsRef}>
            <button
              className="Header__IconBtn"
              title={t('spaceMenu.settings')}
              onClick={() => setShowSettingsMenu((prev) => !prev)}
            >
              <Settings size={18} />
            </button>
            {showSettingsMenu && (
              <div className="Header__SettingsMenu">
                <NavLink
                  href="/admin"
                  className="Header__SettingsItem"
                  onClick={() => { setShowSettingsMenu(false); }}
                >
                  <Shield size={15} />
                  <span>{t('layout.header.adminSettings')}</span>
                </NavLink>
              </div>
            )}
          </div>
        )}
        <div className="Header__UserWrap" ref={userMenuRef}>
          <button
            type="button"
            className="Header__Avatar"
            onClick={() => setShowUserMenu((prev) => !prev)}
            title={username || t('auth.myAccount')}
          >
            <Avatar
              name={username}
              userId={userId}
              avatarUrl={avatarUrl}
              avatarColor={avatarColor}
              size={28}
            />
          </button>
          {showUserMenu && (
            <div className="Header__SettingsMenu">
              <NavLink
                href="/profile"
                className="Header__SettingsItem"
                onClick={() => { setShowUserMenu(false); }}
              >
                <User size={15} />
                <span>{t('auth.profileSettings')}</span>
              </NavLink>
              <button
                className="Header__SettingsItem Header__SettingsItem--danger"
                onClick={handleLogout}
              >
                <LogOut size={15} />
                <span>{t('auth.signOut')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
