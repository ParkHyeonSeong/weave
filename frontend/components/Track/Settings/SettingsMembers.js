import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import { UserPlus, X, Search, LogOut } from 'lucide-react';
import CustomSelect from '@/components/common/CustomSelect';
import ConfirmModal from '@/components/modal/ConfirmModal';
import Avatar from '@/components/common/Avatar';
import { showToast } from '@/components/Layout/Toast';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

const ROLE_VALUES = ['viewer', 'editor', 'owner'];

function readMyUserId() {
  try {
    const p = JSON.parse(sessionStorage.getItem('profile') || '{}');
    return p.user_id || null;
  } catch { return null; }
}

export default function SettingsMembers({ trackId, isOwner }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);  // { user_id, username }

  const [showInvite, setShowInvite] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);
  const inviteRef = useRef(null);

  const myUserId = readMyUserId();

  const roleOptions = useMemo(
    () => ROLE_VALUES.map((value) => ({ value, label: t(`trackSettings.members.roles.${value}`) })),
    [t],
  );

  const fetchMembers = useCallback(async () => {
    if (!trackId) return;
    try {
      const res = await axios.get(`/tracks/${trackId}/members`);
      if (res.data.status) setMembers(res.data.members);
    } catch {}
    setLoading(false);
  }, [trackId]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

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
        const res = await axios.get(
          `/tracks/${trackId}/members/search?q=${encodeURIComponent(value)}`,
        );
        if (res.data.status) setSearchResults(res.data.users);
      } catch {}
      setSearching(false);
    }, 300);
  };

  const handleInvite = async (userId) => {
    try {
      const res = await axios.post(`/tracks/${trackId}/members`, {
        user_id: userId, role: 'editor',
      });
      if (res.data.status) {
        fetchMembers();
        setSearchResults((prev) => prev.filter((u) => u.user_id !== userId));
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('trackSettings.members.inviteFailed');
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('trackSettings.members.inviteFailed'), 'error');
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      const res = await axios.patch(`/tracks/${trackId}/members/${userId}`, {
        role: newRole,
      });
      if (res.data.status) fetchMembers();
      else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('trackSettings.members.lastOwnerDemoteFailed');
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('trackSettings.members.roleChangeFailed'), 'error');
    }
  };

  const handleRemove = async (userId) => {
    try {
      const res = await axios.delete(`/tracks/${trackId}/members/${userId}`);
      if (res.data.status) {
        fetchMembers();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('trackSettings.members.lastOwnerRemoveFailed');
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('trackSettings.members.removeFailed'), 'error');
    }
    setConfirmRemove(null);
  };

  const handleLeave = async () => {
    setShowLeaveConfirm(false);
    if (!myUserId) return;
    try {
      const res = await axios.delete(`/tracks/${trackId}/members/${myUserId}`);
      if (res.data.status) {
        router.replace('/tracks');
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('trackSettings.members.lastOwnerLeaveFailed');
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('sidebar.leaveFailed'), 'error');
    }
  };

  const ownerCount = members.filter((m) => m.role === 'owner').length;
  const myRow = members.find((m) => m.user_id === myUserId);
  const isLastOwnerSelf = myRow?.role === 'owner' && ownerCount <= 1;

  if (loading) return null;

  return (
    <div className="SettingsMembers">
      {isOwner && (
        <div className="SettingsMembers__Actions" ref={inviteRef}>
          <button
            className="SettingsMembers__InviteBtn"
            onClick={() => setShowInvite((v) => !v)}
          >
            <UserPlus size={14} />
            {t('trackSettings.members.inviteMember')}
          </button>

          {showInvite && (
            <div className="SettingsMembers__InviteDropdown">
              <div className="SettingsMembers__SearchWrap">
                <Search size={14} className="SettingsMembers__SearchIcon" />
                <input
                  className="SettingsMembers__SearchInput"
                  placeholder={t('trackSettings.members.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="SettingsMembers__SearchResults">
                {searching && (
                  <div className="SettingsMembers__SearchEmpty">{t('trackSettings.members.searching')}</div>
                )}
                {!searching && searchQuery && searchResults.length === 0 && (
                  <div className="SettingsMembers__SearchEmpty">{t('trackSettings.members.noUsersFound')}</div>
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

      <div className="SettingsMembers__Table">
        <div className="SettingsMembers__TableHeader">
          <span className="SettingsMembers__Col SettingsMembers__Col--name">{t('trackSettings.members.colName')}</span>
          <span className="SettingsMembers__Col SettingsMembers__Col--email">{t('trackSettings.members.colEmail')}</span>
          <span className="SettingsMembers__Col SettingsMembers__Col--role">{t('trackSettings.members.colRole')}</span>
          {isOwner && <span className="SettingsMembers__Col SettingsMembers__Col--action" />}
        </div>
        {members.map((member) => {
          const isSelf = member.user_id === myUserId;
          const isLastOwnerRow = member.role === 'owner' && ownerCount <= 1;
          // 마지막 owner row는 누구에게도 변경/제거 불가 (백엔드 가드와 일치)
          const canManage = isOwner && !isLastOwnerRow;
          return (
            <div key={member.user_id} className="SettingsMembers__Row">
              <span className="SettingsMembers__Col SettingsMembers__Col--name">
                <Avatar user={member} size={28} />
                {member.username}
                {isSelf && <em className="SettingsMembers__YouBadge">{t('trackSettings.members.you')}</em>}
              </span>
              <span className="SettingsMembers__Col SettingsMembers__Col--email">
                {member.email}
              </span>
              <span className="SettingsMembers__Col SettingsMembers__Col--role">
                {canManage ? (
                  <CustomSelect
                    value={member.role}
                    options={roleOptions}
                    onChange={(val) => handleRoleChange(member.user_id, val)}
                    size="sm"
                  />
                ) : (
                  <span
                    className="SettingsMembers__RoleBadge"
                    title={isLastOwnerRow ? t('trackSettings.members.lastOwnerLocked') : ''}
                  >
                    {member.role}
                  </span>
                )}
              </span>
              {isOwner && (
                <span className="SettingsMembers__Col SettingsMembers__Col--action">
                  {canManage ? (
                    <button
                      className="SettingsMembers__RemoveBtn"
                      onClick={() => setConfirmRemove({
                        user_id: member.user_id,
                        username: member.username,
                      })}
                      title={t('trackSettings.members.removeMember')}
                    >
                      <X size={14} />
                    </button>
                  ) : (
                    <span />
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {myRow && (
        <div className="SettingsMembers__LeaveWrap">
          <button
            className="SettingsMembers__LeaveBtn"
            onClick={() => setShowLeaveConfirm(true)}
            disabled={isLastOwnerSelf}
            title={isLastOwnerSelf ? t('trackSettings.members.assignAnotherOwnerFirst') : ''}
          >
            <LogOut size={14} />
            {t('sidebar.leaveTrackTitle')}
          </button>
        </div>
      )}

      <ConfirmModal
        isOpen={showLeaveConfirm}
        onClose={() => setShowLeaveConfirm(false)}
        onConfirm={handleLeave}
        title={t('sidebar.leaveTrackTitle')}
        message={t('trackSettings.members.leaveConfirm')}
        confirmLabel={t('sidebar.leave')}
        variant="danger"
      />

      <ConfirmModal
        isOpen={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => confirmRemove && handleRemove(confirmRemove.user_id)}
        title={t('trackSettings.members.removeMember')}
        message={confirmRemove ? t('trackSettings.members.removeConfirm', { name: confirmRemove.username }) : ''}
        confirmLabel={t('common.actions.remove')}
        variant="danger"
      />
    </div>
  );
}
