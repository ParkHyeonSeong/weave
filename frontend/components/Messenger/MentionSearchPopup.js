import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { axios } from '@/library/_axios';
import Avatar from '@/components/common/Avatar';

export default function MentionSearchPopup({ keyword, roomId, members, onSelect, onClose }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    // roomId 없고 members가 주어지면(새 채팅) 선택된 수신자를 로컬 필터
    if (!roomId && Array.isArray(members)) {
      const kw = (keyword || '').toLowerCase();
      const filtered = members.filter((u) =>
        !kw || u.username?.toLowerCase().includes(kw) || u.email?.toLowerCase().includes(kw)
      );
      setUsers(filtered);
      setActiveIdx(0);
      setLoading(false);
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = { q: keyword || '' };
        if (roomId) params.room_id = roomId;
        const res = await axios.get('/chat/mention-search', { params });
        if (res.data.status) {
          setUsers(res.data.users);
          setActiveIdx(0);
        }
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [keyword, roomId, members]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((prev) => Math.min(prev + 1, users.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (users[activeIdx]) onSelect(users[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [users, activeIdx, onSelect, onClose]);

  return (
    <div className="MentionSearchPopup">
      <div className="MentionSearchPopup__Header">
        <Search size={12} />
        {t('messenger.search.mentionHeader')}
      </div>
      <ul className="MentionSearchPopup__List">
        {loading && <li className="MentionSearchPopup__Empty">{t('messenger.search.searching')}</li>}
        {!loading && users.length === 0 && (
          <li className="MentionSearchPopup__Empty">{t('messenger.search.noUsers')}</li>
        )}
        {!loading && users.map((user, idx) => (
          <li
            key={user.user_id}
            className={`MentionSearchPopup__Item ${idx === activeIdx ? 'MentionSearchPopup__Item--active' : ''}`}
            onClick={() => onSelect(user)}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <Avatar user={user} size="xs" className="MentionSearchPopup__ItemAvatar" />
            <span className="MentionSearchPopup__ItemName">{user.username}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
