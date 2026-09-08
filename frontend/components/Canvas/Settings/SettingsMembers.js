import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import { UserPlus, X, Search, LogOut } from 'lucide-react';
import CustomSelect from '@/components/common/CustomSelect';
import ConfirmModal from '@/components/modal/ConfirmModal';
import Avatar from '@/components/common/Avatar';

const ROLE_OPTION_KEYS = [
  { value: 'admin', labelKey: 'canvasExt.members.roleAdmin' },
  { value: 'member', labelKey: 'canvasExt.members.roleMember' },
];

export default function SettingsMembers({ canvasId, isAdmin }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // 초대 검색
  const [showInvite, setShowInvite] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);
  const inviteRef = useRef(null);

  useEffect(() => {
    fetchMembers();
  }, [canvasId]);

  // 외부 클릭으로 초대 드롭다운 닫기
  useEffect(() => {
    if (!showInvite) return;
    const handleClick = (e) => {
      if (inviteRef.current && !inviteRef.current.contains(e.target)) {
        setShowInvite(false);
        setSearchQuery('');
        setSearchResults([]);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showInvite]);

  const fetchMembers = async () => {
    try {
      const res = await axios.get(`/canvases/${canvasId}/members`);
      if (res.data.status) setMembers(res.data.members);
    } catch {}
    setLoading(false);
  };

  // 검색 (debounce)
  const handleSearchChange = (value) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await axios.get(`/canvases/${canvasId}/members/search?q=${encodeURIComponent(value)}`);
        if (res.data.status) setSearchResults(res.data.users);
      } catch {}
      setSearching(false);
    }, 300);
  };

  // 멤버 초대
  const handleInvite = async (userId) => {
    try {
      const res = await axios.post(`/canvases/${canvasId}/members`, { user_id: userId, role: 'member' });
      if (res.data.status) {
        fetchMembers();
        setSearchResults((prev) => prev.filter((u) => u.user_id !== userId));
      }
    } catch {}
  };

  // 역할 변경
  const handleRoleChange = async (userId, newRole) => {
    try {
      const res = await axios.patch(`/canvases/${canvasId}/members/${userId}`, { role: newRole });
      if (res.data.status) fetchMembers();
    } catch {}
  };

  // 멤버 제거
  const handleRemove = async (userId) => {
    try {
      const res = await axios.delete(`/canvases/${canvasId}/members/${userId}`);
      if (res.data.status) fetchMembers();
    } catch {}
  };

  // 나가기
  const handleLeave = async () => {
    setShowLeaveConfirm(false);
    try {
      const res = await axios.post(`/canvases/${canvasId}/leave`);
      if (res.data.status) {
        router.push('/');
      }
    } catch {}
  };

  const isLastAdmin = isAdmin && members.filter((m) => m.role === 'admin').length <= 1;
  const roleOptions = ROLE_OPTION_KEYS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }));

  if (loading) return null;

  return (
    <div className="SettingsMembers">
      {/* 헤더 */}
      {isAdmin && (
        <div className="SettingsMembers__Actions" ref={inviteRef}>
          <button
            className="SettingsMembers__InviteBtn"
            onClick={() => setShowInvite(!showInvite)}
          >
            <UserPlus size={14} />
            {t('canvasExt.members.invite')}
          </button>

          {showInvite && (
            <div className="SettingsMembers__InviteDropdown">
              <div className="SettingsMembers__SearchWrap">
                <Search size={14} className="SettingsMembers__SearchIcon" />
                <input
                  className="SettingsMembers__SearchInput"
                  placeholder={t('canvasExt.members.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="SettingsMembers__SearchResults">
                {searching && (
                  <div className="SettingsMembers__SearchEmpty">{t('canvasExt.searching')}</div>
                )}
                {!searching && searchQuery && searchResults.length === 0 && (
                  <div className="SettingsMembers__SearchEmpty">{t('canvasExt.members.noUsers')}</div>
                )}
                {searchResults.map((user) => (
                  <button
                    key={user.user_id}
                    className="SettingsMembers__SearchItem"
                    onClick={() => handleInvite(user.user_id)}
                  >
                    <div className="SettingsMembers__SearchItemInfo">
                      <span className="SettingsMembers__SearchItemName">{user.username}</span>
                      <span className="SettingsMembers__SearchItemEmail">{user.email}</span>
                    </div>
                    <UserPlus size={14} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 멤버 테이블 */}
      <div className="SettingsMembers__Table">
        <div className="SettingsMembers__TableHeader">
          <span className="SettingsMembers__Col SettingsMembers__Col--name">{t('canvasExt.members.colName')}</span>
          <span className="SettingsMembers__Col SettingsMembers__Col--email">{t('canvasExt.members.colEmail')}</span>
          <span className="SettingsMembers__Col SettingsMembers__Col--role">{t('canvasExt.members.colRole')}</span>
          {isAdmin && <span className="SettingsMembers__Col SettingsMembers__Col--action" />}
        </div>
        {members.map((member) => (
          <div key={member.user_id} className="SettingsMembers__Row">
            <span className="SettingsMembers__Col SettingsMembers__Col--name">
              <Avatar user={member} size="sm" />
              {member.username}
            </span>
            <span className="SettingsMembers__Col SettingsMembers__Col--email">
              {member.email}
            </span>
            <span className="SettingsMembers__Col SettingsMembers__Col--role">
              {isAdmin ? (
                <CustomSelect
                  value={member.role}
                  options={roleOptions}
                  onChange={(val) => handleRoleChange(member.user_id, val)}
                  size="sm"
                />
              ) : (
                <span className="SettingsMembers__RoleBadge">{member.role}</span>
              )}
            </span>
            {isAdmin && (
              <span className="SettingsMembers__Col SettingsMembers__Col--action">
                <button
                  className="SettingsMembers__RemoveBtn"
                  onClick={() => handleRemove(member.user_id)}
                  title={t('canvasExt.members.removeMember')}
                >
                  <X size={14} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      {/* 나가기 */}
      <div className="SettingsMembers__LeaveWrap">
        <button
          className="SettingsMembers__LeaveBtn"
          onClick={() => setShowLeaveConfirm(true)}
          disabled={isLastAdmin}
          title={isLastAdmin ? t('canvasExt.members.lastAdminTooltip') : ''}
        >
          <LogOut size={14} />
          {t('sidebar.leaveCanvasTitle')}
        </button>
      </div>

      <ConfirmModal
        isOpen={showLeaveConfirm}
        onClose={() => setShowLeaveConfirm(false)}
        onConfirm={handleLeave}
        title={t('sidebar.leaveCanvasTitle')}
        message={t('canvasExt.members.leaveConfirm')}
        confirmLabel={t('sidebar.leave')}
        variant="danger"
      />
    </div>
  );
}
