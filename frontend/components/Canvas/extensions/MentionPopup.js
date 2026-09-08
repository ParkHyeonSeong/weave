import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import Avatar from '@/components/common/Avatar';

const MentionPopup = forwardRef(({ keyword, branchId, roomId, canvasId, members, onSelect, onClose }, ref) => {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const listRef = useRef(null); // 활성 항목 스크롤 추적용 ul

  useImperativeHandle(ref, () => ({}));

  useEffect(() => {
    // 로컬 멤버 목록(스크럼 등)이 주어지면 API 없이 클라이언트에서 필터
    if (Array.isArray(members)) {
      const kw = (keyword || '').toLowerCase();
      setUsers(members.filter((u) => (u.username || '').toLowerCase().includes(kw)).slice(0, 10));
      setActiveIdx(0);
      return undefined;
    }
    // 범위(방/브랜치/캔버스)가 없으면 전체 사용자 열거를 피하기 위해 검색하지 않는다
    if (!roomId && !branchId && !canvasId) {
      setUsers([]);
      return undefined;
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = { q: keyword || '' };
        if (roomId) params.room_id = roomId;
        else if (branchId) params.branch_id = branchId;
        else if (canvasId) params.canvas_id = canvasId;
        const res = await axios.get('/chat/mention-search', { params });
        if (res.data.status) {
          setUsers(res.data.users);
          setActiveIdx(0);
        }
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [keyword, branchId, roomId, canvasId, members]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((prev) => Math.min(prev + 1, users.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (users[activeIdx]) onSelect(users[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [users, activeIdx, onSelect, onClose]);

  // 방향키로 옮긴 활성 항목을 overflow 리스트의 가시영역으로 따라가게 한다.
  useEffect(() => {
    listRef.current?.children[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, users]);

  return (
    <div className="MentionPopup">
      <div className="MentionPopup__Header">
        <Search size={12} />
        {t('canvasExt.mention.header')}
      </div>
      <ul className="MentionPopup__List" ref={listRef}>
        {loading && <li className="MentionPopup__Empty">{t('canvasExt.searching')}</li>}
        {!loading && users.length === 0 && (
          <li className="MentionPopup__Empty">{t('canvasExt.mention.noUsers')}</li>
        )}
        {!loading && users.map((user, idx) => (
          <li
            key={user.user_id}
            className={`MentionPopup__Item ${idx === activeIdx ? 'MentionPopup__Item--active' : ''}`}
            onClick={() => onSelect(user)}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <Avatar user={user} size="xs" className="MentionPopup__ItemIcon" />
            <span className="MentionPopup__ItemName">{user.username}</span>
          </li>
        ))}
      </ul>
    </div>
  );
});

MentionPopup.displayName = 'MentionPopup';

export default MentionPopup;
