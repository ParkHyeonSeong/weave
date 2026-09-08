import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import { MessageSquare } from 'lucide-react';
import useResyncOnVisible from '@/hooks/useResyncOnVisible';
import { sumChatUnread } from '@/library/chatUnread';

export default function UnreadMessages() {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChat();
  }, []);

  const fetchChat = async () => {
    try {
      const res = await axios.get('/chat');
      if (res.data.status) {
        const unread = res.data.rooms.filter(r => r.unread_count > 0);
        setRooms(unread);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  // 새 메시지(chat:new_message)·방 읽음(chat:unread_changed)·탭 복귀 시 재조회.
  // 마운트-only였던 stale 문제 해소(헤더 뱃지와 같은 패턴, 공용 훅 재사용).
  useResyncOnVisible(fetchChat, ['chat:new_message', 'chat:unread_changed']);

  const openRoom = (roomId) => {
    window.dispatchEvent(new CustomEvent('chat:open_room', { detail: roomId }));
  };

  const totalUnread = sumChatUnread(rooms);

  if (loading) {
    return (
      <div className="Widget">
        <div className="Widget__Header">
          <MessageSquare size={16} />
          <span className="Widget__Title">{t('home.widgets.messages.title')}</span>
        </div>
        <div className="Widget__Body">
          <div className="Widget__Empty">{t('common.state.loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="Widget">
      <div className="Widget__Header">
        <MessageSquare size={16} />
        <span className="Widget__Title">{t('home.widgets.messages.title')}</span>
      </div>
      <div className="Widget__Body">
        {rooms.length === 0 ? (
          <div className="Widget__Empty">{t('home.widgets.messages.empty')}</div>
        ) : (
          <>
            <div className="UnreadMessages__Total">{totalUnread}</div>
            <div className="UnreadMessages__Rooms">
              {rooms.map((room) => (
                <div
                  key={room.room_id}
                  className="UnreadMessages__Room"
                  onClick={() => openRoom(room.room_id)}
                >
                  <span className="UnreadMessages__RoomName">{room.room_name}</span>
                  <span className="UnreadMessages__Badge">{room.unread_count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
