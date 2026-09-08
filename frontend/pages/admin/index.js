import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AdminLayout from '@/components/Admin/AdminLayout';
import { axios } from '@/library/_axios';
import { Shield, UserCheck, UserX, UserPlus, KeyRound, Ban, CircleCheck, Trash2 } from 'lucide-react';
import Alert from '@/components/modal/Alert';
import AddMember from '@/components/modal/AddMember';
import ResetPassword from '@/components/modal/ResetPassword';
import ConfirmModal from '@/components/modal/ConfirmModal';
import Avatar from '@/components/common/Avatar';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { useDateFormat } from '@/hooks/useDateFormat';

export default function AdminPage() {
  const { t } = useTranslation();
  const { formatTimestamp } = useDateFormat();
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myUserId, setMyUserId] = useState(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Alert 상태
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const showAlert = (title, message) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertOpen(true);
  };

  // 권한 확인 + 사용자 목록 로드
  useEffect(() => {
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      if (profile.role !== 'admin') {
        router.replace('/');
        return;
      }
      setMyUserId(profile.user_id);
    } catch {
      router.replace('/');
      return;
    }
    fetchUsers();
  }, []);

  // 멤버 추가 후 목록 갱신
  useEffect(() => {
    const handleRefresh = () => fetchUsers();
    window.addEventListener('member:created', handleRefresh);
    return () => window.removeEventListener('member:created', handleRefresh);
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await axios.get('/admin/users');
      if (res.data.status) {
        setUsers(res.data.users);
      }
    } catch {
      showAlert(t('common.state.error'), t('authAdmin.members.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (userId) => {
    try {
      const res = await axios.patch(`/admin/users/${userId}/status`, { status: 'active' });
      if (res.data.status) {
        fetchUsers();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('authAdmin.members.approveFailed');
        showAlert(t('common.state.error'), msg);
      }
    } catch {
      showAlert(t('common.state.error'), t('authAdmin.members.approveFailed'));
    }
  };

  const handleReject = async (userId) => {
    try {
      const res = await axios.patch(`/admin/users/${userId}/status`, { status: 'rejected' });
      if (res.data.status) {
        fetchUsers();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('authAdmin.members.rejectFailed');
        showAlert(t('common.state.error'), msg);
      }
    } catch {
      showAlert(t('common.state.error'), t('authAdmin.members.rejectFailed'));
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      const res = await axios.patch(`/admin/users/${userId}/role`, { role: newRole });
      if (res.data.status) {
        fetchUsers();
      } else {
        const err = getError(res.data);
        let fallback = t('authAdmin.members.roleChangeFailed');
        if (err.code === 'CANNOT_CHANGE_OWN_ROLE') fallback = t('errors.CANNOT_CHANGE_OWN_ROLE');
        else if (err.code === 'USER_NOT_FOUND') fallback = t('errors.USER_NOT_FOUND');
        const msg = errorText(err.code, err.category) ?? fallback;
        showAlert(t('common.state.error'), msg);
      }
    } catch {
      showAlert(t('common.state.error'), t('authAdmin.members.roleChangeFailed'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await axios.delete(`/admin/users/${deleteTarget.user_id}`);
      if (res.data.status) {
        fetchUsers();
        setDeleteTarget(null);
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('authAdmin.members.deleteFailed');
        showAlert(t('common.state.error'), msg);
      }
    } catch {
      showAlert(t('common.state.error'), t('authAdmin.members.deleteFailed'));
    }
  };

  const handleToggleStatus = async (userId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
      const res = await axios.patch(`/admin/users/${userId}/status`, { status: newStatus });
      if (res.data.status) {
        fetchUsers();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('authAdmin.members.statusUpdateFailed');
        showAlert(t('common.state.error'), msg);
      }
    } catch {
      showAlert(t('common.state.error'), t('authAdmin.members.statusUpdateFailed'));
    }
  };

  const pendingUsers = users.filter(u => u.status === 'pending');
  const activeUsers = users.filter(u => u.status !== 'pending');

  const getStatusClass = (status) => {
    switch (status) {
      case 'active': return 'Admin__Badge--active';
      case 'pending': return 'Admin__Badge--pending';
      case 'rejected': return 'Admin__Badge--rejected';
      case 'inactive': return 'Admin__Badge--inactive';
      default: return '';
    }
  };

  // 서버 enum(role·status)의 표시 라벨. 매핑이 없는 값은 원문 그대로 보여준다.
  const roleLabel = (role) => t(`authAdmin.roles.${role}`, { defaultValue: role });
  const statusLabel = (status) => t(`authAdmin.status.${status}`, { defaultValue: status });

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    // 가입 시각은 timestamp — 개인 timezone의 달력 날짜로 표시한다.
    return formatTimestamp(dateStr, { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  if (loading) return null;

  return (
    <AdminLayout>
      <Head>
        <title>{t('authAdmin.pageTitle')}</title>
      </Head>
      <div className="Admin">
        <div className="Admin__Header">
          <Shield size={20} />
          <h1 className="Admin__Title">{t('authAdmin.adminSettings')}</h1>
        </div>

        <div className="Admin__Section">
          <div className="Admin__SectionHeader">
            <h2 className="Admin__SectionTitle">{t('authAdmin.members.sectionTitle')}</h2>
            <button className="Admin__AddBtn" onClick={() => setShowAddMember(true)}>
              <UserPlus size={14} />
              {t('authAdmin.members.addMember')}
            </button>
          </div>

          {/* 승인 대기 섹션 */}
          {pendingUsers.length > 0 && (
            <div className="Admin__Subsection">
              <h3 className="Admin__SubsectionTitle">
                {t('authAdmin.members.pendingApproval', { count: pendingUsers.length })}
              </h3>
              <div className="Admin__TableWrap">
                <table className="Admin__Table">
                <thead>
                  <tr>
                    <th>{t('authAdmin.members.columns.name')}</th>
                    <th>{t('authAdmin.members.columns.email')}</th>
                    <th>{t('authAdmin.members.columns.registered')}</th>
                    <th>{t('authAdmin.members.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingUsers.map(user => (
                    <tr key={user.user_id}>
                      <td>
                        <div className="Admin__NameCell">
                          <Avatar user={user} size="sm" />
                          {user.username}
                        </div>
                      </td>
                      <td>{user.email}</td>
                      <td>{formatDate(user.created_at)}</td>
                      <td className="Admin__Actions">
                        <button
                          className="Admin__ApproveBtn"
                          onClick={() => handleApprove(user.user_id)}
                        >
                          <UserCheck size={14} />
                          {t('authAdmin.members.approve')}
                        </button>
                        <button
                          className="Admin__RejectBtn"
                          onClick={() => handleReject(user.user_id)}
                        >
                          <UserX size={14} />
                          {t('authAdmin.members.reject')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 전체 멤버 섹션 */}
          <div className="Admin__Subsection">
            <h3 className="Admin__SubsectionTitle">{t('authAdmin.members.allMembers', { count: activeUsers.length })}</h3>
            <div className="Admin__TableWrap">
              <table className="Admin__Table">
              <thead>
                <tr>
                  <th>{t('authAdmin.members.columns.name')}</th>
                  <th>{t('authAdmin.members.columns.email')}</th>
                  <th>{t('authAdmin.members.columns.role')}</th>
                  <th>{t('authAdmin.members.columns.status')}</th>
                  <th>{t('authAdmin.members.columns.joined')}</th>
                  <th>{t('authAdmin.members.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {activeUsers.map(user => {
                  const isSelf = user.user_id === myUserId;
                  return (
                    <tr key={user.user_id}>
                      <td>
                        <div className="Admin__NameCell">
                          <Avatar user={user} size="sm" />
                          {user.username}
                        </div>
                      </td>
                      <td>{user.email}</td>
                      <td>
                        {isSelf ? (
                          <span className="Admin__RoleText">{roleLabel(user.role)}</span>
                        ) : (
                          <select
                            className="Admin__RoleSelect"
                            value={user.role}
                            onChange={(e) => handleRoleChange(user.user_id, e.target.value)}
                          >
                            <option value="member">{t('authAdmin.roles.member')}</option>
                            <option value="admin">{t('authAdmin.roles.admin')}</option>
                          </select>
                        )}
                      </td>
                      <td>
                        <span className={`Admin__Badge ${getStatusClass(user.status)}`}>
                          {statusLabel(user.status)}
                        </span>
                      </td>
                      <td>{formatDate(user.created_at)}</td>
                      <td className="Admin__Actions">
                        {!isSelf && (
                          <>
                            {(user.status === 'active' || user.status === 'inactive') && (
                              <button
                                className={user.status === 'active' ? 'Admin__DeactivateBtn' : 'Admin__ActivateBtn'}
                                onClick={() => handleToggleStatus(user.user_id, user.status)}
                                title={user.status === 'active' ? t('authAdmin.members.deactivate') : t('authAdmin.members.activate')}
                              >
                                {user.status === 'active' ? <Ban size={14} /> : <CircleCheck size={14} />}
                                {user.status === 'active' ? t('authAdmin.members.deactivate') : t('authAdmin.members.activate')}
                              </button>
                            )}
                            <button
                              className="Admin__ResetBtn"
                              onClick={() => setResetTarget(user)}
                              title={t('authAdmin.members.resetPasswordTitle')}
                            >
                              <KeyRound size={14} />
                              {t('authAdmin.members.reset')}
                            </button>
                            <button
                              className="Admin__DeleteBtn"
                              onClick={() => setDeleteTarget(user)}
                              title={t('common.actions.delete')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showAddMember && (
        <AddMember onClose={() => setShowAddMember(false)} />
      )}

      {resetTarget && (
        <ResetPassword user={resetTarget} onClose={() => setResetTarget(null)} />
      )}

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('authAdmin.members.deleteTitle')}
        message={t('authAdmin.members.deleteConfirm', { name: deleteTarget?.username })}
        confirmLabel={t('common.actions.delete')}
        variant="danger"
      />

      <Alert
        isOpen={alertOpen}
        title={alertTitle}
        contents={alertMessage}
        onClose={() => setAlertOpen(false)}
      />
    </AdminLayout>
  );
}
