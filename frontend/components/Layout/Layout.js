import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { getAppContext } from '@/library/appContext';
import { createPortal } from 'react-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import Footer from './Footer';
import Messenger from '@/components/Messenger/Messenger';
import CreateBranch from '@/components/modal/CreateBranch';
import CreateCanvas from '@/components/modal/CreateCanvas';
import CreateTrack from '@/components/modal/CreateTrack';
import CreateScrumBoard from '@/components/modal/CreateScrumBoard';
import CommandPalette from '@/components/modal/CommandPalette';
import { requestNotificationPermission, showNotification, playNotificationSound } from '@/library/notification';
import { subscribeToPush } from '@/library/pushSubscription';
import { getWsBaseURL, refreshAccessToken } from '@/library/_axios';
import { sumChatUnread } from '@/library/chatUnread';
import useResyncOnVisible from '@/hooks/useResyncOnVisible';
import { showToast } from './Toast';
import useMobile from '@/hooks/useMobile';
import usePictureInPicture from '@/hooks/usePictureInPicture';

const MESSENGER_MIN_WIDTH = 280;
const MESSENGER_DEFAULT_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_DEFAULT_WIDTH = 240;
// 드래그 클램프(handleSidebarResizeStart의 innerWidth/3, handleResizeStart의 innerWidth*0.5)와
// 동일한 한계를 복원/리사이즈 시에도 재사용하기 위한 상수+헬퍼.
const SIDEBAR_MAX_RATIO = 1 / 3;
const MESSENGER_MAX_RATIO = 0.5;

function clampPanelWidth(value, fallback, min, maxRatio) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const max = Math.floor(window.innerWidth * maxRatio);
  return Math.min(Math.max(n, min), max);
}

export default function Layout({ children }) {
  const { isMobile } = useMobile();
  const router = useRouter();
  const inApp = !!getAppContext(router.pathname);
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [showCreateCanvas, setShowCreateCanvas] = useState(false);
  const [showCreateTrack, setShowCreateTrack] = useState(false);
  const [showCreateScrum, setShowCreateScrum] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try { return sessionStorage.getItem('sidebar_collapsed') === 'true'; }
    catch { return false; }
  });
  const [isMessengerCollapsed, setIsMessengerCollapsed] = useState(() => {
    try {
      return sessionStorage.getItem('messenger_open') !== 'true';
    } catch { return true; }
  });
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [messengerWidth, setMessengerWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('messenger_width');
      return saved
        ? clampPanelWidth(saved, MESSENGER_DEFAULT_WIDTH, MESSENGER_MIN_WIDTH, MESSENGER_MAX_RATIO)
        : MESSENGER_DEFAULT_WIDTH;
    }
    return MESSENGER_DEFAULT_WIDTH;
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sidebar_width');
      return saved
        ? clampPanelWidth(saved, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_RATIO)
        : SIDEBAR_DEFAULT_WIDTH;
    }
    return SIDEBAR_DEFAULT_WIDTH;
  });
  const isResizingRef = useRef(false);
  const wsRef = useRef(null);
  const activeRoomRef = useRef(null);
  const refreshingRef = useRef(false);
  const rerunRef = useRef(false);
  const { isSupported: isPipSupported, isPipActive, portalContainer: pipContainer, openPip, closePip } = usePictureInPicture();

  // 알림/채팅 unread 카운트를 서버 권위 스냅샷으로 재동기화 (마운트·재연결·탭복귀 공용).
  // - allSettled: 한 요청이 실패해도 나머지 카운트는 반영(재동기화 목적상 부분 성공 허용).
  // - refreshingRef + rerunRef(루프): 동시 1건만 실행하고, 페치 도중 들어온 트리거는
  //   루프로 1회 더 드레인(onopen+visibility 동시 발화 등 유실 방지 → 최신 상태로 수렴).
  const refreshCounts = useCallback(async () => {
    if (refreshingRef.current) { rerunRef.current = true; return; }
    refreshingRef.current = true;
    try {
      const { axios } = await import('@/library/_axios');
      const ok = (res) => res.status === 'fulfilled' && res.value.data.status;
      do {
        rerunRef.current = false;
        const [listRes, countRes, chatRes] = await Promise.allSettled([
          axios.get('/notifications?limit=30'),
          axios.get('/notifications/unread-count'),
          axios.get('/chat'),
        ]);
        if (ok(listRes)) setNotifications(listRes.value.data.notifications);
        if (ok(countRes)) setUnreadCount(countRes.value.data.count);
        if (ok(chatRes)) setChatUnreadCount(sumChatUnread(chatRes.value.data.rooms));
      } while (rerunRef.current);  // 페치 동안 새 트리거가 왔으면 한 번 더
    } catch {}
    finally { refreshingRef.current = false; }
  }, []);

  // 모바일 진입 시 사이드바/메신저 자동 닫기
  useEffect(() => {
    if (isMobile) {
      setIsSidebarCollapsed(true);
      setIsMessengerCollapsed(true);
    }
  }, [isMobile]);

  // 사이드바 접힘 상태 저장 (모바일에서는 저장하지 않음)
  useEffect(() => {
    if (isMobile) return;
    try { sessionStorage.setItem('sidebar_collapsed', isSidebarCollapsed ? 'true' : 'false'); }
    catch {}
  }, [isSidebarCollapsed, isMobile]);

  // 메신저 열림 상태 저장 (모바일에서는 저장하지 않음)
  useEffect(() => {
    if (isMobile) return;
    try {
      sessionStorage.setItem('messenger_open', isMessengerCollapsed ? 'false' : 'true');
    } catch {}
  }, [isMessengerCollapsed, isMobile]);

  // 사이드바 리사이즈 드래그 핸들러
  const handleSidebarResizeStart = useCallback((e) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    let latestWidth = startWidth;

    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;
      const maxWidth = Math.floor(window.innerWidth / 3);
      const delta = e.clientX - startX;
      latestWidth = Math.min(maxWidth, Math.max(SIDEBAR_MIN_WIDTH, startWidth + delta));
      setSidebarWidth(latestWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('sidebar_width', String(latestWidth));
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  // 메신저 패널 리사이즈 드래그 핸들러
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = messengerWidth;

    let latestMsgWidth = startWidth;

    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;
      const maxWidth = Math.floor(window.innerWidth * 0.5);
      const delta = startX - e.clientX;
      latestMsgWidth = Math.min(maxWidth, Math.max(MESSENGER_MIN_WIDTH, startWidth + delta));
      setMessengerWidth(latestMsgWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('messenger_width', String(latestMsgWidth));
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [messengerWidth]);

  // 창 리사이즈 시 "저장된 선호 폭"을 현재 뷰포트 한계로 재클램프 (드래그 중에는 드래그 핸들러가 자체 클램프하므로 제외).
  // 라이브 state가 아니라 localStorage 선호값에서 재계산해야 축소→복귀가 양방향으로 동작한다
  // (state 기준이면 축소 때 줄어든 값이 그대로 남아 창을 되돌려도 회복 안 됨).
  // 드래그 핸들러가 매 드래그 결과를 localStorage에 쓰므로 저장값 = 사용자의 최신 선호.
  useEffect(() => {
    const resyncWidth = (storageKey, min, maxRatio, setWidth) => {
      let pref = null;
      try { pref = localStorage.getItem(storageKey); } catch {}
      setWidth((w) => clampPanelWidth(pref || w, w, min, maxRatio));
    };
    const handleWindowResize = () => {
      if (isResizingRef.current) return;
      resyncWidth('sidebar_width', SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_RATIO, setSidebarWidth);
      resyncWidth('messenger_width', MESSENGER_MIN_WIDTH, MESSENGER_MAX_RATIO, setMessengerWidth);
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  // 글로벌 단축키
  useEffect(() => {
    const handleKeyDown = (e) => {
      // input/textarea/contenteditable 편집 중에는 글로벌 단축키 무시
      // (스크럼/Canvas 에디터의 Cmd+B 볼드 등과 충돌 방지)
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'b') {
        e.preventDefault();
        if (inApp) setIsSidebarCollapsed((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        setIsMessengerCollapsed((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [inApp]);

  // CommandPalette에서 Branch 생성 요청 수신
  useEffect(() => {
    const handleCreate = () => setShowCreateBranch(true);
    window.addEventListener('palette:create-branch', handleCreate);
    return () => window.removeEventListener('palette:create-branch', handleCreate);
  }, []);

  // BranchHome에서 Branch 생성 요청 수신
  useEffect(() => {
    const handleCreate = () => setShowCreateBranch(true);
    window.addEventListener('layout:create-branch', handleCreate);
    return () => window.removeEventListener('layout:create-branch', handleCreate);
  }, []);

  // CanvasHome에서 Canvas 생성 요청 수신
  useEffect(() => {
    const handleCreate = () => setShowCreateCanvas(true);
    window.addEventListener('layout:create-canvas', handleCreate);
    return () => window.removeEventListener('layout:create-canvas', handleCreate);
  }, []);

  // QuickCreate에서 Track 생성 요청 수신
  useEffect(() => {
    const handleCreate = () => setShowCreateTrack(true);
    window.addEventListener('layout:create-track', handleCreate);
    return () => window.removeEventListener('layout:create-track', handleCreate);
  }, []);

  // ScrumHome에서 Scrum 보드 생성 요청 수신
  useEffect(() => {
    const handleCreate = () => setShowCreateScrum(true);
    window.addEventListener('layout:create-scrum', handleCreate);
    return () => window.removeEventListener('layout:create-scrum', handleCreate);
  }, []);

  // 앱 홈에서 커맨드 팔레트 열기 요청 수신 (⌘K 빠른 이동 버튼)
  useEffect(() => {
    const handleOpen = () => setShowPalette(true);
    window.addEventListener('layout:open-search', handleOpen);
    return () => window.removeEventListener('layout:open-search', handleOpen);
  }, []);

  // 마운트 시 1회 로드 + 채팅 unread 갱신 이벤트 구독
  useEffect(() => {
    refreshCounts();

    // 채팅 unread만 가볍게 재조회 (방 열람/메시지 시 발화 — 빈도가 높아 풀 조회는 피함)
    const handleChatUnread = () => {
      import('@/library/_axios').then(({ axios }) => {
        axios.get('/chat').then((res) => {
          if (res.data.status) setChatUnreadCount(sumChatUnread(res.data.rooms));
        }).catch(() => {});
      });
    };
    window.addEventListener('chat:unread_changed', handleChatUnread);
    return () => window.removeEventListener('chat:unread_changed', handleChatUnread);
  }, [refreshCounts]);

  // WebSocket 연결 관리
  useEffect(() => {
    let profile = {};
    try {
      profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    } catch {}
    if (!profile.user_id) return;

    requestNotificationPermission().then(() => subscribeToPush());

    // WebSocket URL: axios base URL 기반으로 생성
    const wsUrl = `${getWsBaseURL()}/api/ws/chat`;

    let reconnectTimer = null;
    let alive = true;

    const connect = () => {
      if (!alive) return;

      // 기존 연결 정리 (재연결 루프 방지)
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }

      const ws = new WebSocket(wsUrl);

      // 최초 연결/재연결 모두에서 카운트를 서버값으로 재동기화한다.
      // 끊겨 있던 동안 Web Push로만 도착해 누락된 뱃지 증가분을 여기서 보정.
      ws.onopen = () => { refreshCounts(); };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // 컴포넌트에 전달용 커스텀 이벤트
          window.dispatchEvent(new CustomEvent('chat:ws_message', { detail: data }));

          if (data.type === 'presence') {
            window.dispatchEvent(new CustomEvent('chat:presence', { detail: data }));
          }

          if (data.type === 'notification') {
            // 영구 알림 실시간 수신
            setNotifications((prev) => {
              if (prev.some((n) => n.notification_id === data.notification.notification_id)) return prev;
              return [data.notification, ...prev].slice(0, 50);
            });
            setUnreadCount(data.unread_count);
            showNotification('Weave', data.notification.title);
            showToast(data.notification.title, 'info');
            playNotificationSound();
          }

          if (data.type === 'new_message') {
            // 채팅 목록 갱신용
            window.dispatchEvent(new CustomEvent('chat:new_message', { detail: data }));

            // 내가 보낸 메시지가 아닐 때
            if (data.message.sender_id !== profile.user_id) {
              // 현재 해당 채팅방에 들어와있으면 알림 생략
              const isViewingRoom = activeRoomRef.current === data.room_id;

              if (!isViewingRoom) {
                setChatUnreadCount((prev) => prev + 1);
                // Chrome 알림
                const notiContent = data.message.content
                  || (data.message.task_ref ? 'Shared a task' : null)
                  || (data.message.doc_ref ? 'Shared a document' : null)
                  || (data.message.issue_ref ? 'Shared an issue' : null)
                  || '';
                showNotification(
                  data.message.sender_name || 'New Message',
                  notiContent,
                  data.message
                );
                showToast(`${data.message.sender_name || 'Someone'}: ${notiContent}`, 'info');
                playNotificationSound();
              }
            }
          }

          if (data.type === 'task_updated') {
            // GitHub 전이/원격 변경 → ref 칩·리스트·보드 캐시 무효화 + 열린 패널 재조회 트리거.
            // task:updated는 멱등 re-fetch라 self-skip 없이 모든 멤버(본인 다른 탭 포함) 갱신.
            // (탭 안에서 스스로 변경을 낸 쪽은 이미 재동기화했으므로 detail.origin을 달아
            //  자기 리스너만 건너뛴다 — useTaskDetail. WS 발 이벤트는 원격이라 태그하지 않는다.)
            window.dispatchEvent(new Event('task:updated'));
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!alive) return;
        // 끊김 원인이 access 토큰 만료(SEC-29)인 경우가 많으므로 첫 끊김부터 토큰 갱신을
        // 트리거한다. 단 갱신 완료를 재연결의 전제로 삼지 않는다: /auth/refresh에 10s
        // timeout이 있어도(_axios) 갱신을 기다리면 그만큼 재연결이 늦어진다.
        // → 갱신은 fire-and-forget(쿨다운/in-flight 통합이 폭주를 막음), 재연결 타이머는
        //   항상 독립적으로 3초 뒤에 건다. 갱신은 보통 3초 내 끝나 다음 connect가 새 쿠키를 쓴다.
        refreshAccessToken().catch(() => {});
        reconnectTimer = setTimeout(connect, 3000);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [refreshCounts]);

  // 탭 복귀 시 카운트 재동기화 (백그라운드에서 freeze/discard된 동안 놓친 알림 보정)
  useResyncOnVisible(refreshCounts);

  // 모바일에서 사이드바/메신저 열릴 때 backdrop 클릭으로 닫기
  const handleBackdropClick = useCallback(() => {
    setIsSidebarCollapsed(true);
  }, []);
  const handleMessengerBackdropClick = useCallback(() => {
    setIsMessengerCollapsed(true);
  }, []);

  return (
    <div className={`Layout ${isMobile ? 'Layout--mobile' : ''}`}>
      <Header
        isMobile={isMobile}
        hasSidebar={inApp}
        onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
        onSearchClick={() => setShowPalette(true)}
        notifications={notifications}
        unreadCount={unreadCount}
        chatUnreadCount={chatUnreadCount}
        onChatClick={() => setIsMessengerCollapsed((prev) => !prev)}
        onClearNotifications={async () => {
          try {
            const { axios } = await import('@/library/_axios');
            await axios.delete('/notifications');
            setNotifications([]);
            setUnreadCount(0);
          } catch {}
        }}
        onMarkAllRead={async () => {
          try {
            const { axios } = await import('@/library/_axios');
            await axios.patch('/notifications/read-all');
            setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
            setUnreadCount(0);
          } catch {}
        }}
        onReadNotification={async (notificationId) => {
          try {
            const { axios } = await import('@/library/_axios');
            await axios.patch(`/notifications/${notificationId}/read`);
            setNotifications((prev) =>
              prev.map((n) => n.notification_id === notificationId ? { ...n, is_read: true } : n)
            );
            setUnreadCount((prev) => Math.max(0, prev - 1));
          } catch {}
        }}
        onNotiClick={(noti) => {
          if (noti.link) {
            // link가 있으면 해당 페이지로 이동 (router.push는 Header에서 처리)
          } else if (noti.entity_type === 'chat_room') {
            setIsMessengerCollapsed(false);
            window.dispatchEvent(new CustomEvent('chat:open_room', { detail: noti.entity_id }));
          }
        }}
      />
      <div className="Layout__Body">
        {/* 모바일: 사이드바 backdrop */}
        {isMobile && inApp && !isSidebarCollapsed && (
          <div className="Layout__Backdrop" onClick={handleBackdropClick} />
        )}
        {inApp && !isSidebarCollapsed && (
          <Sidebar
            isMobile={isMobile}
            width={isMobile ? undefined : sidebarWidth}
            onResizeStart={isMobile ? undefined : handleSidebarResizeStart}
            onCreateBranch={() => setShowCreateBranch(true)}
            onCreateCanvas={() => setShowCreateCanvas(true)}
            onCreateTrack={() => setShowCreateTrack(true)}
            onCreateScrum={() => setShowCreateScrum(true)}
            onClose={() => setIsSidebarCollapsed(true)}
          />
        )}
        <main className="Layout__Content">
          {children}
        </main>
        {/* 모바일: 메신저 backdrop */}
        {isMobile && !isMessengerCollapsed && (
          <div className="Layout__Backdrop" onClick={handleMessengerBackdropClick} />
        )}
        {!isMessengerCollapsed && !isPipActive && (
          <>
            {!isMobile && (
              <div
                className="Layout__ResizeHandle"
                onMouseDown={handleResizeStart}
              />
            )}
            <Messenger
              wsRef={wsRef}
              activeRoomRef={activeRoomRef}
              panelWidth={isMobile ? undefined : messengerWidth}
              isMobile={isMobile}
              onPopOut={isPipSupported && !isMobile ? openPip : undefined}
            />
          </>
        )}
        {/* PiP: createPortal로 별도 윈도우에 렌더링 */}
        {isPipActive && pipContainer && createPortal(
          <Messenger
            wsRef={wsRef}
            activeRoomRef={activeRoomRef}
            isMobile={false}
            isPip
          />,
          pipContainer
        )}
      </div>
      <Footer
        isMobile={isMobile}
        hasSidebar={inApp}
        isSidebarCollapsed={isSidebarCollapsed}
        isMessengerCollapsed={isMessengerCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
        onToggleMessenger={() => setIsMessengerCollapsed((prev) => !prev)}
      />

      {showCreateBranch && (
        <CreateBranch onClose={() => setShowCreateBranch(false)} />
      )}
      {showCreateTrack && (
        <CreateTrack
          onClose={() => setShowCreateTrack(false)}
          onCreated={() => setShowCreateTrack(false)}
        />
      )}
      {showCreateCanvas && (
        <CreateCanvas onClose={() => setShowCreateCanvas(false)} />
      )}
      {showCreateScrum && (
        <CreateScrumBoard
          onClose={() => setShowCreateScrum(false)}
          onCreated={() => setShowCreateScrum(false)}
        />
      )}
      {showPalette && (
        <CommandPalette onClose={() => setShowPalette(false)} />
      )}
    </div>
  );
}
