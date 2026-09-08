import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { axios } from '@/library/_axios';
import Avatar from '@/components/common/Avatar';

export default function MessengerUserList({ onOpenRoom }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [onlineSet, setOnlineSet] = useState(new Set());

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await axios.get('/chat/users');
        if (res.data.status) {
          setUsers(res.data.users);
        }
      } catch {}
    };
    const fetchOnline = async () => {
      try {
        const res = await axios.get('/chat/online');
        if (res.data.status) {
          setOnlineSet(new Set(res.data.user_ids));
        }
      } catch {}
    };
    fetchUsers();
    fetchOnline();
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

  // DM 시작
  const handleStartDM = async (targetUserId) => {
    try {
      const res = await axios.post('/chat', {
        room_type: 'dm',
        member_ids: [targetUserId],
      });
      if (res.data.status) {
        onOpenRoom(res.data.room_id);
      }
    } catch {}
  };

  // 현재 로그인 사용자 제외
  let myUserId = 0;
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    myUserId = profile.user_id || 0;
  } catch {}

  const keyword = search.toLowerCase();
  const filteredUsers = users
    .filter((u) => u.user_id !== myUserId)
    .filter((u) => !keyword || u.username.toLowerCase().includes(keyword) || u.email.toLowerCase().includes(keyword))
    .sort((a, b) => {
      const aOnline = onlineSet.has(a.user_id) ? 0 : 1;
      const bOnline = onlineSet.has(b.user_id) ? 0 : 1;
      return aOnline - bOnline;
    });

  return (
    <div className="MessengerUserList">
      <div className="MessengerUserList__Header">
        <span className="MessengerUserList__Title">{t('messenger.tabs.users')}</span>
      </div>
      <div className="MessengerUserList__Search">
        <Search size={14} className="MessengerUserList__SearchIcon" />
        <input
          className="MessengerUserList__SearchInput"
          type="text"
          placeholder={t('messenger.userList.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="MessengerUserList__Items">
        {filteredUsers.length === 0 ? (
          <div className="MessengerUserList__Empty">{t('messenger.userList.empty')}</div>
        ) : filteredUsers.map((user) => (
            <button
              key={user.user_id}
              className="MessengerUserList__Item"
              onClick={() => handleStartDM(user.user_id)}
            >
              <div className="MessengerUserList__AvatarWrap">
                <Avatar user={user} size="md" />
                {onlineSet.has(user.user_id) && (
                  <span className="MessengerUserList__Online" />
                )}
              </div>
              <div className="MessengerUserList__Info">
                <span className="MessengerUserList__Name">{user.username}</span>
                <span className="MessengerUserList__Email">{user.email}</span>
              </div>
            </button>
          ))
        }
      </div>
    </div>
  );
}
