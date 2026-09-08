import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import { UserPlus, X, Search, LogOut } from 'lucide-react';
import CustomSelect from '@/components/common/CustomSelect';
import Avatar from '@/components/common/Avatar';
import { showToast } from '@/components/Layout/Toast';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

const roleOptions = (t) => [
  { value: 'member', label: t('scrum.members.roleMember') },
  { value: 'admin', label: t('scrum.members.roleAdmin') },
];

function readMyUserId() {
  try {
    const p = JSON.parse(sessionStorage.getItem('profile') || '{}');
    return p.user_id || null;
  } catch { return null; }
}

/**
 * 멤버 관리 본문 (모달 셸 없이 재사용 가능).
 * - ScrumMembersModal: 모달 백드롭/헤더/닫기 안에서 이걸 감쌈
 * - ScrumSettings Members 탭: 셸 없이 직접 렌더
 * props:
 *  - boardId
 *  - myRole ('admin' | 'member')
 *  - onChanged: 멤버 변경 후 부모 보드 갱신 콜백
 *  - onLeave: (선택) 보드 나간 뒤 처리. 미지정 시 router.push('/scrum')
 */
export default function ScrumMembersPanel({ boardId, myRole, onChanged, onLeave }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmRemove, setConfirmRemove] = useState(null); // { user_id, username }

  const [showInvite, setShowInvite] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);
  const inviteRef = useRef(null);

  const myUserId = readMyUserId();
  const isAdmin = myRole === 'admin';

  const fetchMembers = useCallback(async () => {
    if (!boardId) return;
    try {
      const res = await axios.get(`/scrum/${boardId}/members`);
      if (res.data.status) setMembers(res.data.members);
    } catch {}
    setLoading(false);
  }, [boardId]);

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
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await axios.get(
          `/scrum/${boardId}/members/search?q=${encodeURIComponent(value)}`,
        );
        if (res.data.status) setSearchResults(res.data.users);
      } catch {}
      setSearching(false);
    }, 300);
  };

  const afterMutation = useCallback(async () => {
    await fetchMembers();
    if (onChanged) onChanged();
  }, [fetchMembers, onChanged]);

  const handleInvite = async (userId) => {
    try {
      const res = await axios.post(`/scrum/${boardId}/members`, {
        user_id: userId, role: 'member',
      });
      if (res.data.status) {
        setSearchResults((prev) => prev.filter((u) => u.user_id !== userId));
        await afterMutation();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('scrum.members.inviteFailed');
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('scrum.members.inviteFailed'), 'error');
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      const res = await axios.patch(`/scrum/${boardId}/members/${userId}`, {
        role: newRole,
      });
      if (res.data.status) await afterMutation();
      else {
        const err = getError(res.data);
        const fallback = err.code === 'LAST_ADMIN'
          ? t('scrum.members.lastAdminRoleFailed')
          : t('scrum.members.roleChangeFailed');
        const msg = errorText(err.code, err.category) ?? fallback;
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('scrum.members.roleChangeFailed'), 'error');
    }
  };

  const handleRemove = async (userId) => {
    try {
      const res = await axios.delete(`/scrum/${boardId}/members/${userId}`);
      if (res.data.status) {
        await afterMutation();
      } else {
        const err = getError(res.data);
        const fallback = err.code === 'LAST_ADMIN'
          ? t('scrum.members.lastAdminRemoveFailed')
          : t('scrum.members.removeFailed');
        const msg = errorText(err.code, err.category) ?? fallback;
        showToast(msg, 'error');
      }
    } catch {
      showToast(t('scrum.members.removeFailed'), 'error');
    }
    setConfirmRemove(null);
  };

  const handleLeave = async () => {
    if (!myUserId) return;
    if (!window.confirm(t('scrum.members.leaveConfirm'))) return;
    try {
      const res = await axios.delete(`/scrum/${boardId}/members/${myUserId}`);
      if (res.data.status) {
        if (onLeave) onLeave();
        else router.push('/scrum');
      } else {
        const err = getError(res.data);
        if (err.code === 'LAST_ADMIN') {
          alert(errorText(err.code, err.category) ?? t('scrum.members.assignAnotherAdmin'));
        } else {
          const msg = errorText(err.code, err.category) ?? t('sidebar.leaveFailed');
          showToast(msg, 'error');
        }
      }
    } catch {
      showToast(t('sidebar.leaveFailed'), 'error');
    }
  };

  const adminCount = members.filter((m) => m.role === 'admin').length;
  const myRow = members.find((m) => m.user_id === myUserId);

  return (
    <>
      <div className="ScrumMembers__Body">
        {isAdmin && (
          <div className="ScrumMembers__Actions" ref={inviteRef}>
            <button
              type="button"
              className="ScrumMembers__InviteBtn"
              onClick={() => setShowInvite((v) => !v)}
            >
              <UserPlus size={14} />
              {t('scrum.members.invite')}
            </button>

            {showInvite && (
              <div className="ScrumMembers__InviteDropdown">
                <div className="ScrumMembers__SearchWrap">
                  <Search size={14} className="ScrumMembers__SearchIcon" />
                  <input
                    className="ScrumMembers__SearchInput"
                    placeholder={t('scrum.members.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="ScrumMembers__SearchResults">
                  {searching && (
                    <div className="ScrumMembers__SearchEmpty">{t('scrum.members.searching')}</div>
                  )}
                  {!searching && searchQuery && searchResults.length === 0 && (
                    <div className="ScrumMembers__SearchEmpty">{t('scrum.members.noResults')}</div>
                  )}
                  {searchResults.map((u) => (
                    <button
                      key={u.user_id}
                      type="button"
                      className="ScrumMembers__SearchItem"
                      onClick={() => handleInvite(u.user_id)}
                    >
                      <Avatar user={u} size={30} className="ScrumMembers__SearchItemAvatar" />
                      <div className="ScrumMembers__SearchItemInfo">
                        <span className="ScrumMembers__SearchItemName">{u.username}</span>
                        <span className="ScrumMembers__SearchItemEmail">{u.email}</span>
                      </div>
                      <UserPlus size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="ScrumMembers__Loading">{t('common.state.loading')}</div>
        ) : (
          <div className="ScrumMembers__List">
            {members.map((member) => {
              const isSelf = member.user_id === myUserId;
              const isLastAdminRow = member.role === 'admin' && adminCount <= 1;
              // 마지막 admin row는 누구에게도 변경/제거 불가 (백엔드 가드와 일치)
              const canManage = isAdmin && !isLastAdminRow;
              return (
                <div key={member.user_id} className="ScrumMembers__Row">
                  <Avatar user={member} size={30} className="ScrumMembers__Avatar" />
                  <div className="ScrumMembers__Info">
                    <span className="ScrumMembers__Name">
                      <span className="ScrumMembers__NameText">{member.username}</span>
                      {isSelf && <em className="ScrumMembers__You">{t('scrum.you')}</em>}
                    </span>
                    <span className="ScrumMembers__Email">{member.email}</span>
                  </div>
                  <span className="ScrumMembers__RoleCol">
                    {canManage ? (
                      <CustomSelect
                        value={member.role}
                        options={roleOptions(t)}
                        onChange={(val) => handleRoleChange(member.user_id, val)}
                        size="sm"
                      />
                    ) : (
                      <span
                        className="ScrumMembers__RoleBadge"
                        title={isLastAdminRow ? t('scrum.members.lastAdminRoleLocked') : ''}
                      >
                        {member.role}
                      </span>
                    )}
                  </span>
                  {isAdmin && (
                    <span className="ScrumMembers__ActionCol">
                      {canManage && (
                        confirmRemove?.user_id === member.user_id ? (
                          <span className="ScrumMembers__ConfirmInline">
                            <button
                              type="button"
                              className="ScrumMembers__ConfirmYes"
                              onClick={() => handleRemove(member.user_id)}
                            >
                              {t('common.actions.remove')}
                            </button>
                            <button
                              type="button"
                              className="ScrumMembers__ConfirmNo"
                              onClick={() => setConfirmRemove(null)}
                            >
                              {t('common.actions.cancel')}
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="ScrumMembers__RemoveBtn"
                            onClick={() => setConfirmRemove({
                              user_id: member.user_id,
                              username: member.username,
                            })}
                            title={t('scrum.members.removeTitle')}
                          >
                            <X size={14} />
                          </button>
                        )
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {myRow && (
        <footer className="ScrumMembers__Foot">
          <button
            type="button"
            className="ScrumMembers__LeaveBtn"
            onClick={handleLeave}
          >
            <LogOut size={14} />
            {t('scrum.members.leaveBoard')}
          </button>
        </footer>
      )}
    </>
  );
}
