import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import Avatar from '@/components/common/Avatar';
import MessengerComposer from './MessengerComposer';
import { showToast } from '@/components/Layout/Toast';
import { buildSendMessage } from '@/library/messengerCompose';

export default function MessengerNewChat({ wsRef, onBack, onOpenRoom }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');

  let myUserId = 0;
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    myUserId = profile.user_id || 0;
  } catch {}

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await axios.get('/chat/users');
        if (res.data.status) {
          setUsers(res.data.users.filter((u) => u.user_id !== myUserId));
        }
      } catch {}
    };
    fetchUsers();
  }, []);

  const toggleUser = (user) => {
    setSelected((prev) => {
      const exists = prev.find((u) => u.user_id === user.user_id);
      if (exists) return prev.filter((u) => u.user_id !== user.user_id);
      return [...prev, user];
    });
    setSearch('');
  };

  const removeUser = (userId) => {
    setSelected((prev) => prev.filter((u) => u.user_id !== userId));
  };

  const filteredUsers = users.filter((u) => {
    if (selected.find((s) => s.user_id === u.user_id)) return false;
    if (!search) return true;
    return u.username.toLowerCase().includes(search.toLowerCase()) ||
           u.email.toLowerCase().includes(search.toLowerCase());
  });

  // composer 전송: 방 생성 → 원본 첨부 업로드 → 첫 메시지 전송 → 방 오픈
  const handleComposerSubmit = async (payload) => {
    if (selected.length === 0) return false;
    try {
      const memberIds = selected.map((u) => u.user_id);
      const isDm = memberIds.length === 1;
      const res = await axios.post('/chat', {
        room_type: isDm ? 'dm' : 'group',
        room_name: isDm ? null : selected.map((u) => u.username).join(', '),
        member_ids: memberIds,
      });
      if (!res.data.status) { showToast(t('messenger.newChat.createRoomFailed'), 'error'); return false; }
      const roomId = res.data.room_id;

      // 원본(uploaded:false) 첨부를 새 방에 업로드
      const uploaded = [];
      for (const a of payload.attachments) {
        const fd = new FormData();
        fd.append('file', a.file);
        const up = await axios.post(`/chat/upload?room_id=${roomId}`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (!up.data.status) { showToast(t('messenger.newChat.imageUploadFailed'), 'error'); return false; }
        uploaded.push({ url: up.data.url, file_name: up.data.file_name, file_type: up.data.file_type, file_size: up.data.file_size });
      }

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(buildSendMessage(roomId, payload, uploaded)));
      }
      onOpenRoom(roomId);
      return true;
    } catch {
      showToast(t('messenger.newChat.sendFailed'), 'error');
      return false;
    }
  };

  return (
    <div className="MessengerNewChat">
      <div className="MessengerNewChat__Header">
        <button className="MessengerNewChat__BackBtn" onClick={onBack}>
          <ArrowLeft size={16} />
        </button>
        <span className="MessengerNewChat__Title">{t('messenger.chatList.newChat')}</span>
      </div>

      <div className="MessengerNewChat__To">
        <span className="MessengerNewChat__ToLabel">{t('messenger.newChat.toLabel')}</span>
        <div className="MessengerNewChat__ToField">
          {selected.map((user) => (
            <span key={user.user_id} className="MessengerNewChat__Chip">
              {user.username}
              <button
                className="MessengerNewChat__ChipRemove"
                onClick={() => removeUser(user.user_id)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={selected.length === 0 ? t('messenger.userList.searchPlaceholder') : ''}
            className="MessengerNewChat__SearchInput"
          />
        </div>
      </div>

      <div className="MessengerNewChat__UserList">
        {filteredUsers.map((user) => (
          <button
            key={user.user_id}
            className="MessengerNewChat__UserItem"
            onClick={() => toggleUser(user)}
          >
            <Avatar user={user} size={28} className="MessengerNewChat__Avatar" />
            <div className="MessengerNewChat__UserInfo">
              <span className="MessengerNewChat__UserName">{user.username}</span>
              <span className="MessengerNewChat__UserEmail">{user.email}</span>
            </div>
          </button>
        ))}
      </div>

      <MessengerComposer
        roomId={null}
        members={selected}
        disabled={selected.length === 0}
        selfDrop
        onSubmit={handleComposerSubmit}
      />
    </div>
  );
}
