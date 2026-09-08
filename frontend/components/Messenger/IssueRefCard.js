import { useTranslation } from 'react-i18next';
import { X, CircleDot } from 'lucide-react';
import NavLink from '@/components/common/NavLink';

const STATUS_KEYS = {
  open: 'messenger.issueStatus.open',
  closed: 'messenger.issueStatus.closed',
};

export default function IssueRefCard({ issueRef, removable, onRemove }) {
  const { t } = useTranslation();
  if (!issueRef) return null;

  // 클릭 가능(전송된 메시지)일 때만 링크. compose 프리뷰(removable)는 이동 안 함.
  const navUrl = !removable && issueRef.branch_id && issueRef.task_id && issueRef.issue_id
    ? `/branch/${issueRef.branch_id}/task/${issueRef.task_id}/issue/${issueRef.issue_id}`
    : null;

  const content = (
    <>
      <div className="IssueRefCard__Header">
        <CircleDot size={12} className="IssueRefCard__Icon" />
        <span className="IssueRefCard__DisplayId">{issueRef.display_id}</span>
        <span className={`IssueRefCard__Status IssueRefCard__Status--${issueRef.status}`}>
          {STATUS_KEYS[issueRef.status] ? t(STATUS_KEYS[issueRef.status]) : issueRef.status}
        </span>
        {removable && (
          <button className="IssueRefCard__Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
            <X size={12} />
          </button>
        )}
      </div>
      <div className="IssueRefCard__Title">{issueRef.title}</div>
    </>
  );

  if (navUrl) {
    return <NavLink className="IssueRefCard IssueRefCard--clickable" href={navUrl}>{content}</NavLink>;
  }
  return <div className="IssueRefCard">{content}</div>;
}
