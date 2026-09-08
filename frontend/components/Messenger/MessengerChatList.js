import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { axios } from '@/library/_axios';
import { useDateFormat } from '@/hooks/useDateFormat';
import Avatar from '@/components/common/Avatar';

export default function MessengerChatList({ onOpenRoom, onNewChat, activeRoomId }) {
  const { t } = useTranslation();
  const { formatMessageTime } = useDateFormat();
  const [rooms, setRooms] = useState([]);
  const [onlineSet, setOnlineSet] = useState(new Set());

  const fetchRooms = async () => {
    try {
      const res = await axios.get('/chat');
      if (res.data.status) {
        setRooms(res.data.rooms);
      }
    } catch {}
  };

  useEffect(() => {
    fetchRooms();
    // 초기 온라인 목록
    const fetchOnline = async () => {
      try {
        const res = await axios.get('/chat/online');
        if (res.data.status) {
          setOnlineSet(new Set(res.data.user_ids));
        }
      } catch {}
    };
    fetchOnline();
  }, []);

  // 새 메시지 수신 시 목록 갱신
  useEffect(() => {
    const handleNewMessage = () => fetchRooms();
    window.addEventListener('chat:new_message', handleNewMessage);
    return () => window.removeEventListener('chat:new_message', handleNewMessage);
  }, []);

  // presence 이벤트 실시간 반영
  useEffect(() => {
    const handlePresence = (e) => {
      const { user_id, status } = e.detail;
      setOnlineSet((prev) => {
        const next = new Set(prev);
        if (status === 'online') next.add(user_id);
        else next.delete(user_id);
        return next;
      });
    };
    window.addEventListener('chat:presence', handlePresence);
    return () => window.removeEventListener('chat:presence', handlePresence);
  }, []);

  // 미리보기용 마크다운 문법 제거
  const stripMarkdown = (text) => {
    if (!text) return '';
    return text
      .replace(/```[\s\S]*?```/g, '[code]')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\n/g, ' ');
  };

  return (
    <div className="MessengerChatList">
      <div className="MessengerChatList__Header">
        <span className="MessengerChatList__Title">{t('messenger.chatList.title')}</span>
        <button className="MessengerChatList__NewChatBtn" onClick={onNewChat}>
          <Plus size={14} />
          {t('messenger.chatList.newChat')}
        </button>
      </div>

      <div className="MessengerChatList__Items">
        {rooms.length === 0 ? (
          <div className="MessengerChatList__Empty">
            {t('messenger.chatList.empty')}
          </div>
        ) : (
          rooms.map((room) => (
            <button
              key={room.room_id}
              className={`MessengerChatList__Item ${activeRoomId === room.room_id ? 'MessengerChatList__Item--active' : ''}`}
              onClick={() => onOpenRoom(room.room_id)}
            >
              <div className="MessengerChatList__ItemAvatar">
                <Avatar
                  user={{
                    name: room.dm_partner_name || room.room_name,
                    id: room.dm_partner_id,
                    avatar_url: room.dm_partner_avatar_url,
                    avatar_color: room.dm_partner_avatar_color,
                  }}
                  size="sm"
                />
                {room.dm_partner_id && onlineSet.has(room.dm_partner_id) && (
                  <span className="MessengerChatList__Online" />
                )}
              </div>
              <div className="MessengerChatList__ItemInfo">
                <div className="MessengerChatList__ItemTop">
                  <span className="MessengerChatList__ItemName">
                    {room.dm_partner_name || room.room_name || t('messenger.chatList.directMessage')}
                  </span>
                  {room.last_message_at && (
                    <span className="MessengerChatList__ItemTime">
                      {formatMessageTime(room.last_message_at)}
                    </span>
                  )}
                </div>
                <div className="MessengerChatList__ItemBottom">
                  {room.last_message && (
                    <span className="MessengerChatList__ItemPreview">
                      {stripMarkdown(room.last_message)}
                    </span>
                  )}
                  {room.unread_count > 0 && (
                    <span className="MessengerChatList__Badge">
                      {room.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
