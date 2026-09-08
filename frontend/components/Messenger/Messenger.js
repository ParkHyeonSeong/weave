import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Users, PanelLeftClose, PanelLeftOpen, X, ExternalLink } from 'lucide-react';
import MessengerChatList from './MessengerChatList';
import MessengerUserList from './MessengerUserList';
import MessengerChatRoom from './MessengerChatRoom';
import MessengerNewChat from './MessengerNewChat';

const SPLIT_THRESHOLD = 560;

export default function Messenger({ wsRef, activeRoomRef, panelWidth, isMobile, isPip, onPopOut }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('chats');
  const [activeRoomId, setActiveRoomId] = useState(() => {
    try {
      const saved = sessionStorage.getItem('chat_active_room');
      return saved ? Number(saved) : null;
    } catch { return null; }
  });
  const [showNewChat, setShowNewChat] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return sessionStorage.getItem('chat_sidebar_collapsed') === 'true'; }
    catch { return false; }
  });

  const isSplitView = !isMobile && panelWidth >= SPLIT_THRESHOLD;

  // 채팅방 진입
  const handleOpenRoom = (roomId) => {
    setActiveRoomId(roomId);
    setShowNewChat(false);
  };

  // 채팅방에서 목록으로 복귀
  const handleBack = () => {
    setActiveRoomId(null);
    setShowNewChat(false);
  };

  // 현재 열린 방 ID를 Layout에 공유 + sessionStorage 저장
  useEffect(() => {
    if (activeRoomRef) activeRoomRef.current = activeRoomId;
    try {
      if (activeRoomId) sessionStorage.setItem('chat_active_room', String(activeRoomId));
      else sessionStorage.removeItem('chat_active_room');
    } catch {}
    return () => { if (activeRoomRef) activeRoomRef.current = null; };
  }, [activeRoomId]);

  // 사이드바 접힘 상태 저장
  useEffect(() => {
    try { sessionStorage.setItem('chat_sidebar_collapsed', sidebarCollapsed ? 'true' : 'false'); }
    catch {}
  }, [sidebarCollapsed]);

  // 알림 클릭 -> 해당 채팅방으로 이동
  useEffect(() => {
    const handleOpenFromNoti = (e) => handleOpenRoom(e.detail);
    window.addEventListener('chat:open_room', handleOpenFromNoti);
    return () => window.removeEventListener('chat:open_room', handleOpenFromNoti);
  }, []);

  // 새 채팅 compose 화면 열기
  const handleNewChat = () => {
    setShowNewChat(true);
    setActiveRoomId(null);
  };

  // 목록 패널 (탭 + 컨텐츠)
  const listPanel = (
    <div className="Messenger__ListPanel">
      <div className="Messenger__Tabs">
        <button
          className={`Messenger__Tab ${activeTab === 'chats' ? 'Messenger__Tab--active' : ''}`}
          onClick={() => setActiveTab('chats')}
        >
          <MessageSquare size={14} />
          {t('messenger.tabs.chats')}
        </button>
        <button
          className={`Messenger__Tab ${activeTab === 'users' ? 'Messenger__Tab--active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <Users size={14} />
          {t('messenger.tabs.users')}
        </button>
        {onPopOut && (
          <button
            className="Messenger__PopOutBtn"
            onClick={onPopOut}
            title={t('messenger.popOut')}
          >
            <ExternalLink size={14} />
          </button>
        )}
      </div>
      <div className="Messenger__Content">
        {activeTab === 'chats' ? (
          <MessengerChatList onOpenRoom={handleOpenRoom} onNewChat={handleNewChat} activeRoomId={activeRoomId} />
        ) : (
          <MessengerUserList onOpenRoom={handleOpenRoom} />
        )}
      </div>
    </div>
  );

  // --- Split view (넓은 패널) ---
  if (isSplitView) {
    return (
      <div className={`Messenger Messenger--split ${sidebarCollapsed ? 'Messenger--collapsed' : ''}`} style={{ width: panelWidth }}>
        {!sidebarCollapsed && listPanel}
        <div className="Messenger__RoomPanel">
          {showNewChat ? (
            <MessengerNewChat
              wsRef={wsRef}
              onBack={handleBack}
              onOpenRoom={handleOpenRoom}
            />
          ) : activeRoomId ? (
            <MessengerChatRoom
              roomId={activeRoomId}
              wsRef={wsRef}
              onBack={handleBack}
              hideback
              headerLeft={
                <button
                  className="MessengerChatRoom__CollapseBtn"
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  title={sidebarCollapsed ? t('messenger.showSidebar') : t('messenger.hideSidebar')}
                >
                  {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
                </button>
              }
              headerRight={
                <button
                  className="MessengerChatRoom__CloseBtn"
                  onClick={handleBack}
                  title={t('messenger.closeChat')}
                >
                  <X size={14} />
                </button>
              }
            />
          ) : (
            <div className="Messenger__RoomEmpty">
              <button
                className="Messenger__CollapseBtn"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                title={sidebarCollapsed ? t('messenger.showSidebar') : t('messenger.hideSidebar')}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
              </button>
              {t('messenger.selectConversation')}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Narrow view (기존 동작: 뷰 전환) ---
  const mobileClass = isMobile ? ' Messenger--mobile' : '';
  const pipClass = isPip ? ' Messenger--pip' : '';
  const narrowStyle = isMobile || isPip ? undefined : { width: panelWidth };

  if (activeRoomId) {
    return (
      <div className={`Messenger${mobileClass}${pipClass}`} style={narrowStyle}>
        <MessengerChatRoom
          roomId={activeRoomId}
          wsRef={wsRef}
          onBack={handleBack}
        />
      </div>
    );
  }

  if (showNewChat) {
    return (
      <div className={`Messenger${mobileClass}${pipClass}`} style={narrowStyle}>
        <MessengerNewChat
          wsRef={wsRef}
          onBack={handleBack}
          onOpenRoom={handleOpenRoom}
        />
      </div>
    );
  }

  return (
    <div className={`Messenger${mobileClass}${pipClass}`} style={narrowStyle}>
      {listPanel}
    </div>
  );
}
