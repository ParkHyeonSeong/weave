import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { UserPlus, X, Search, LogOut } from 'lucide-react';
import CustomSelect from '@/components/common/CustomSelect';
import Avatar from '@/components/common/Avatar';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { useTranslation } from 'react-i18next';

export default function SettingsMembers({ branchId, isAdmin }) {
  const { t } = useTranslation();
  const router = useRouter();
  const roleOptions = [
    { value: 'admin', label: t('branch2.members.roleAdmin') },
    { value: 'member', label: t('branch2.members.roleMember') },
  ];
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
  }, [branchId]);

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
      const res = await axios.get(`/branches/${branchId}/members`);
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
        const res = await axios.get(`/branches/${branchId}/members/search?q=${encodeURIComponent(value)}`);
        if (res.data.status) setSearchResults(res.data.users);
      } catch {}
      setSearching(false);
    }, 300);
  };

  // 멤버 초대
  const handleInvite = async (userId) => {
    try {
      const res = await axios.post(`/branches/${branchId}/members`, { user_id: userId, role: 'member' });
      if (res.data.status) {
        fetchMembers();
        // 검색 결과에서 제거
        setSearchResults((prev) => prev.filter((u) => u.user_id !== userId));
      }
    } catch {}
  };

  // 역할 변경
  const handleRoleChange = async (userId, newRole) => {
    try {
      const res = await axios.patch(`/branches/${branchId}/members/${userId}`, { role: newRole });
      if (res.data.status) fetchMembers();
    } catch {}
  };

  // 멤버 제거
  const handleRemove = async (userId) => {
    try {
      const res = await axios.delete(`/branches/${branchId}/members/${userId}`);
      if (res.data.status) fetchMembers();
    } catch {}
  };

  // 나가기
  const handleLeave = async () => {
    setShowLeaveConfirm(false);
    try {
      const res = await axios.post(`/branches/${branchId}/leave`);
      if (res.data.status) {
        router.push('/');
      }
    } catch {}
  };

  const isLastAdmin = isAdmin && members.filter((m) => m.role === 'admin').length <= 1;

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
            {t('branch2.members.inviteMember')}
          </button>

          {showInvite && (
            <div className="SettingsMembers__InviteDropdown">
              <div className="SettingsMembers__SearchWrap">
                <Search size={14} className="SettingsMembers__SearchIcon" />
                <input
                  className="SettingsMembers__SearchInput"
                  placeholder={t('branch2.members.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="SettingsMembers__SearchResults">
                {searching && (
                  <div className="SettingsMembers__SearchEmpty">{t('branch2.members.searching')}</div>
                )}
                {!searching && searchQuery && searchResults.length === 0 && (
                  <div className="SettingsMembers__SearchEmpty">{t('branch2.members.noUsersFound')}</div>
                )}
                {searchResults.map((user) => (
                  <button
                    key={user.user_id}
                    className="SettingsMembers__SearchItem"
                    onClick={() => handleInvite(user.user_id)}
                  >
                    <Avatar user={user} size="sm" />
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
          <span className="SettingsMembers__Col SettingsMembers__Col--name">{t('auth.name')}</span>
          <span className="SettingsMembers__Col SettingsMembers__Col--email">{t('auth.email')}</span>
          <span className="SettingsMembers__Col SettingsMembers__Col--role">{t('branch2.members.roleColumn')}</span>
          {isAdmin && <span className="SettingsMembers__Col SettingsMembers__Col--action" />}
        </div>
        {members.map((member) => (
          <div key={member.user_id} className="SettingsMembers__Row">
            <span className="SettingsMembers__Col SettingsMembers__Col--name">
              <Avatar user={member} size={28} />
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
                  title={t('branch2.members.removeMember')}
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
          title={isLastAdmin ? t('branch2.members.lastAdminCannotLeave') : ''}
        >
          <LogOut size={14} />
          {t('sidebar.leaveBranchTitle')}
        </button>
      </div>

      <ConfirmModal
        isOpen={showLeaveConfirm}
        onClose={() => setShowLeaveConfirm(false)}
        onConfirm={handleLeave}
        title={t('sidebar.leaveBranchTitle')}
        message={t('branch2.members.leaveConfirmMessage')}
        confirmLabel={t('sidebar.leave')}
        variant="danger"
      />
    </div>
  );
}
