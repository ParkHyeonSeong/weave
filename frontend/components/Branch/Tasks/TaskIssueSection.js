import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, MessageCircle, CircleDot, CheckCircle2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import { useDateFormat } from '@/hooks/useDateFormat';
import Avatar from '@/components/common/Avatar';
import NavLink from '@/components/common/NavLink';

export default function TaskIssueSection({ branchId, taskId, expanded = false }) {
  const { t } = useTranslation();
  const { formatRelative } = useDateFormat();
  const [issues, setIssues] = useState([]);

  const fetchIssues = async () => {
    if (!branchId || !taskId) return;
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskId}/issues`);
      if (res.data.status) {
        setIssues(res.data.issues);
      }
    } catch {}
  };

  useEffect(() => {
    fetchIssues();
  }, [branchId, taskId]);

  useEffect(() => {
    const handler = () => fetchIssues();
    window.addEventListener('issue:created', handler);
    window.addEventListener('issue:updated', handler);
    window.addEventListener('issue:deleted', handler);
    return () => {
      window.removeEventListener('issue:created', handler);
      window.removeEventListener('issue:updated', handler);
      window.removeEventListener('issue:deleted', handler);
    };
  }, [branchId, taskId]);

  const displayIssues = expanded ? issues : issues.slice(0, 5);
  const openCount = issues.filter((i) => i.status === 'open').length;
  const closedCount = issues.length - openCount;

  return (
    <div className="TaskIssueSection">
      <div className="TaskIssueSection__Header">
        <span className="TaskIssueSection__Label">
          {t('branchTasks.issue.sectionTitle')}
          {issues.length > 0 && (
            <span className="TaskIssueSection__Count">
              {closedCount > 0
                ? t('branchTasks.issue.countsWithClosed', { open: openCount, closed: closedCount })
                : t('branchTasks.issue.counts', { open: openCount })}
            </span>
          )}
        </span>
        <NavLink href={`/branch/${branchId}/task/${taskId}/issue/new`} className="TaskIssueSection__AddBtn">
          <Plus size={14} />
          {expanded && <span>{t('branchTasks.issue.new')}</span>}
        </NavLink>
      </div>

      {displayIssues.length === 0 ? (
        <div className="TaskIssueSection__Empty">{t('branchTasks.issue.empty')}</div>
      ) : (
        <div className="TaskIssueSection__List">
          {displayIssues.map((issue) => (
            <NavLink
              key={issue.issue_id}
              href={`/branch/${branchId}/task/${taskId}/issue/${issue.issue_id}`}
              className="TaskIssueSection__Item"
            >
              {issue.status === 'open'
                ? <CircleDot size={14} className="TaskIssueSection__StatusIcon TaskIssueSection__StatusIcon--open" />
                : <CheckCircle2 size={14} className="TaskIssueSection__StatusIcon TaskIssueSection__StatusIcon--closed" />
              }
              <div className="TaskIssueSection__ItemContent">
                <span className="TaskIssueSection__ItemTitle">{issue.title}</span>
                {expanded && (
                  <span className="TaskIssueSection__ItemMeta">
                    {t('branchTasks.issue.openedMeta', { id: issue.issue_id, when: formatRelative(issue.created_at) })}{' '}
                    <Avatar
                      name={issue.author_name}
                      userId={issue.created_by}
                      avatarUrl={issue.author_avatar_url}
                      avatarColor={issue.author_avatar_color}
                      size="xs"
                      className="TaskIssueSection__AuthorAvatar"
                    />
                    {issue.author_name}
                  </span>
                )}
              </div>
              {issue.comment_count > 0 && (
                <span className="TaskIssueSection__CommentCount">
                  <MessageCircle size={12} />
                  {issue.comment_count}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      )}

      {!expanded && issues.length > 5 && (
        <NavLink
          href={`/branch/${branchId}/task/${taskId}`}
          className="TaskIssueSection__More"
        >
          {t('branchTasks.issue.viewAll', { total: issues.length })}
        </NavLink>
      )}

    </div>
  );
}
