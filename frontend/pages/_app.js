import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import {
  appShellFlags,
  buildChangePasswordPath,
  buildLoginPath,
  getReturnToFromQuery,
  LOGIN_PATH,
  PUBLIC_PATHS,
  SETUP_PATH,
} from '@/library/authRedirect';
import Layout from '@/components/Layout/Layout';
import ErrorBoundary from '@/components/Layout/ErrorBoundary';
import Toast from '@/components/Layout/Toast';
import { UiPrefsProvider } from '@/library/UiPrefsContext';
import { ThemeProvider, ThemeServerSync } from '@/library/theme';
import { LocaleProvider, LocaleServerSync } from '@/library/locale';
import LocaleGate from '@/components/common/LocaleGate';
import {
  WorkspaceSettingsProvider,
  fetchWorkspaceSettings,
  readWorkspaceSettings,
} from '@/library/workspaceSettings';
import LightboxProvider from '@/components/common/LightboxProvider';
import "@/styles/_themes.scss";
import "@/styles/globals.scss";
import "@/styles/fonts.css";
import "@/styles/components/auth/login.scss";
import "@/styles/components/modal/alert.scss";
import "@/styles/components/setup/setup.scss";
import "@/styles/components/layout/layout.scss";
import "@/styles/components/layout/header.scss";
import "@/styles/components/layout/appSwitcher.scss";
import "@/styles/components/layout/sidebar.scss";
import "@/styles/components/modal/commandPalette.scss";
import "@/styles/components/modal/createBranch.scss";
import "@/styles/components/layout/footer.scss";
import "@/styles/components/messenger/messenger.scss";
import "@/styles/components/messenger/messengerChatList.scss";
import "@/styles/components/messenger/messengerUserList.scss";
import "@/styles/components/messenger/messengerChatRoom.scss";
import "@/styles/components/messenger/messengerNewChat.scss";
import "@/styles/components/messenger/taskSearchPopup.scss";
import "@/styles/components/canvas/slashCommandMenu.scss";
import "@/styles/components/messenger/taskRefCard.scss";
import "@/styles/components/messenger/docSearchPopup.scss";
import "@/styles/components/messenger/docRefCard.scss";
import "@/styles/components/messenger/issueSearchPopup.scss";
import "@/styles/components/messenger/issueRefCard.scss";
import "@/styles/components/admin/admin.scss";
import "@/styles/components/admin/adminSidebar.scss";
import "@/styles/components/modal/addMember.scss";
import "@/styles/components/modal/resetPassword.scss";
import "@/styles/components/auth/changePassword.scss";
import "@/styles/components/branch/branchDetail.scss";
import "@/styles/components/branch/taskList.scss";
import "@/styles/components/modal/sprintModal.scss";
import "@/styles/components/modal/confirmModal.scss";
import "@/styles/components/branch/boardView.scss";
import "@/styles/components/branch/archiveList.scss";
import "@/styles/components/branch/epicTimeline.scss";
import "@/styles/components/modal/epicModal.scss";
import "@/styles/components/branch/taskDetailPanel.scss";
import "@/styles/components/profile/profile.scss";
import "@/styles/components/common/savedViewSwitcher.scss";
import "@/styles/components/common/customSelect.scss";
import "@/styles/components/common/datePicker.scss";
import "@/styles/components/common/labelTagInput.scss";
import "@/styles/components/common/multiSelect.scss";
import "@/styles/components/common/entityAppearance.scss";
import "@/styles/components/common/avatar.scss";
import "@/styles/components/common/languageRegion.scss";
import "@/styles/components/common/context-menu.scss";
import "@/styles/components/common/rawMarkdownEditor.scss";
import "@/styles/components/branch/branchSettings.scss";
import "@/styles/components/branch/settingsGithub.scss";
import "@/styles/components/browse/browseBranches.scss";
import "@/styles/components/home/launchpad.scss";
import "@/styles/components/home/archive-view.scss";
import "@/styles/components/home/widget-zone.scss";
import "@/styles/components/home/dashboard.scss";
import "@/styles/components/home/widget.scss";
import "@/styles/components/modal/createCanvas.scss";
import "@/styles/components/branch/branchHome.scss";
import "@/styles/components/canvas/canvasHome.scss";
import "@/styles/components/canvas/canvasOverview.scss";
import "@/styles/components/canvas/canvasPageView.scss";
import "@/styles/components/canvas/canvasEditor.scss";
import "katex/dist/katex.min.css";
import "@/styles/vendor/highlight-themes.scss";
import "@/styles/components/canvas/canvasCollabEditor.scss";
import "@/styles/components/canvas/canvasSettings.scss";
import "@/styles/components/canvas/refPreviewPanel.scss";
import "@/styles/components/canvas/typstEditor.scss";
import "@/styles/components/canvas/annotation.scss";
import "@/styles/components/branch/taskFullPage.scss";
import "@/styles/components/branch/taskIssueSection.scss";
import "@/styles/components/branch/taskGithubRefSection.scss";
import "@/styles/components/branch/taskSubtaskSection.scss";
import "@/styles/components/branch/taskComment.scss";
import "@/styles/components/branch/taskIssueDetail.scss";
import "@/styles/components/branch/createIssuePage.scss";
import "@/styles/components/myTasks/myTasks.scss";
import "@/styles/components/layout/toast.scss";
import "@/styles/components/home/ai-chat.scss";
import "@/styles/components/home/shared/home-shared.scss";
import "@/styles/components/branch/epicFlow.scss";
import "@/styles/components/branch/branchSchedule.scss";
import "@/styles/components/modal/scheduleEventModal.scss";
import "@/styles/components/modal/jiraMigrationModal.scss";
import "@/styles/components/modal/pageMoveModal.scss";
import "@/styles/components/common/activityTimeline.scss";
import "@/styles/components/track/track.scss";
import "@/styles/components/track/tracksIndex.scss";
import "@/styles/components/track/trackSettings.scss";
import "@/styles/components/scrum/scrum.scss";
import "@/styles/components/shared/refPanelPageLayout.scss";
import "@/styles/components/shared/linkHoverPopover.scss";
import "@/styles/components/common/lightbox.scss";
import "@/styles/components/layout/errorPage.scss";
import "@/styles/components/layout/errorBoundary.scss";
// 저장색 다크 보정은 캐스케이드 최후단이어야 한다 — 항상 마지막 @/styles import로 둔다.
import "@/styles/components/common/storedColor.scss";

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);

  // 인증 게이트는 route 템플릿(pathname) 기준으로만 재평가한다. asPath를 deps에 넣으면 쿼리/해시/
  // shallow 라우팅(탭 전환 등)마다 게이트가 다시 돌아 불필요하다. 리다이렉트에 쓰는 asPath는
  // pathname 변경으로 게이트가 도는 시점의 값(같은 렌더)이라 returnTo가 정확히 잡힌다.
  useEffect(() => {
    if (!router.isReady) return;
    checkAppState();
  }, [router.isReady, router.pathname]);

  const checkAppState = async () => {
    setAppReady(false);

    // 초기화 여부: 워크스페이스 설정 공유 캐시 우선, 없을 때만 API 호출.
    // (workspaceSettings가 응답 전체를 캐시하므로 Header·Scrum이 같은 값을 재조회하지 않는다.)
    let initialized = !!readWorkspaceSettings()?.initialized;
    if (!initialized) {
      try {
        initialized = (await fetchWorkspaceSettings()).initialized;
      } catch {
        // API 실패 시: 프로필 캐시 없으면 로그인으로
        if (!sessionStorage.getItem('profile') && router.pathname !== '/auth/login') {
          router.replace(buildLoginPath(router.asPath));
          return;
        }
        setAppReady(true);
        return;
      }
    }

    // 인증 상태 확인: 캐시된 프로필 우선, 없으면 쿠키 기반 서버 확인
    let isLoggedIn = !!sessionStorage.getItem('profile');
    if (!isLoggedIn && !PUBLIC_PATHS.includes(router.pathname)) {
      try {
        const res = await axios.get('/auth/me');
        if (res.data.status) {
          sessionStorage.setItem('profile', JSON.stringify(res.data.profile));
          isLoggedIn = true;
        }
      } catch {}
    }

    if (!initialized) {
      // 미초기화 상태: /setup 외 모든 경로 차단
      if (router.pathname !== '/setup') {
        router.replace(SETUP_PATH);
        return;
      }
    } else if (router.pathname === '/setup') {
      // 초기화 완료 후 /setup 접근 차단
      router.replace(isLoggedIn ? '/' : LOGIN_PATH);
      return;
    } else if (!isLoggedIn && !PUBLIC_PATHS.includes(router.pathname)) {
      // 미인증 + 비공개 경로
      router.replace(buildLoginPath(router.asPath));
      return;
    }

    // 비밀번호 변경 강제 체크
    if (isLoggedIn) {
      try {
        const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
        if (profile.must_change_password && router.pathname !== '/auth/change-password') {
          const returnTo = router.pathname === '/auth/login'
            ? getReturnToFromQuery(router.query)
            : router.asPath;
          router.replace(buildChangePasswordPath(returnTo));
          return;
        }
      } catch {}
    }

    if (isLoggedIn && router.pathname === '/auth/login') {
      // 인증 상태에서 로그인 페이지 접근
      router.replace(getReturnToFromQuery(router.query));
      return;
    }

    setAppReady(true);
  };

  // Service Worker 등록 (PWA)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js');
    }
  }, []);

  // auth:expired 이벤트 수신 (axios 인터셉터에서 발송)
  useEffect(() => {
    const handleExpired = () => {
      sessionStorage.removeItem('profile');
      sessionStorage.removeItem('avatar_url');
      router.replace(buildLoginPath(router.asPath));
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, [router, router.asPath]);

  const hasSession = typeof window !== 'undefined' && !!sessionStorage.getItem('profile');
  // 레이아웃·prefs 조회 판정 단일 소스 — fetch는 인증 상태 단독 기준 (경로 항 금지 — 위 (b)).
  const { needsLayout, prefsFetchEnabled } = appShellFlags(router.pathname, hasSession);

  // ThemeProvider·LocaleProvider는 appReady 게이트 "밖" — 게이트가 라우트마다 트리를
  // 리셋해도 테마·언어 상태와 리스너는 상주한다. LocaleProvider가 밖에 있어야 로그인/설치
  // 화면에도 선택한 언어가 적용된다.
  return (
    <ThemeProvider>
      <LocaleProvider>
        <WorkspaceSettingsProvider>
          {appReady && (
            <ErrorBoundary>
              <LightboxProvider>
                {/* key: fetch 가능성 경계에서 Provider 리마운트 → 로그인/계정 전환 시 prefs 재조회 */}
                <UiPrefsProvider key={prefsFetchEnabled ? 'auth' : 'anon'} fetchEnabled={prefsFetchEnabled}>
                  <ThemeServerSync />
                  {/* 서버 스냅샷 → LocaleProvider 브리지. 첫 선택 화면은 loadStatus가 필요해
                      UiPrefsProvider 안에 있어야 한다(Provider 경계를 위해 인증 구조를 바꾸지 않는다). */}
                  <LocaleServerSync />
                  <LocaleGate />
                  {needsLayout
                    ? <Layout><Component {...pageProps} /></Layout>
                    : <Component {...pageProps} />}
                </UiPrefsProvider>
                <Toast />
              </LightboxProvider>
            </ErrorBoundary>
          )}
        </WorkspaceSettingsProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
