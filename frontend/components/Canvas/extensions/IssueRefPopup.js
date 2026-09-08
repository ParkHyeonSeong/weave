import { Search, CircleDot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRefSearchPopup } from './useRefSearchPopup';

const STATUS_LABEL_KEYS = { open: 'canvasExt.issueStatus.open', closed: 'canvasExt.issueStatus.closed' };

export default function IssueRefPopup({ onSelect, onClose, onDismiss, onBack }) {
  const { t } = useTranslation();
  const {
    keyword, setKeyword, items: issues, activeIdx, setActiveIdx, loading,
    inputRef, listRef, finish, handleKeyDown, handleBlur,
  } = useRefSearchPopup({
    url: '/chat/issue-search',
    pickItems: (data) => data.issues,
    onSelect, onClose, onDismiss, onBack,
  });

  return (
    <div className="IssueRefPopup">
      <div className="IssueRefPopup__Header">
        <Search size={12} />
        {t('canvasExt.refPopup.issuesHeader')}
      </div>
      <div className="IssueRefPopup__Search">
        <input
          ref={inputRef}
          value={keyword}
          placeholder={t('canvasExt.refPopup.searchIssues')}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />
      </div>
      <ul className="IssueRefPopup__List" ref={listRef}>
        {loading && <li className="IssueRefPopup__Empty">{t('canvasExt.searching')}</li>}
        {!loading && issues.length === 0 && (
          <li className="IssueRefPopup__Empty">{t('canvasExt.refPopup.noIssues')}</li>
        )}
        {!loading && issues.map((issue, idx) => (
          <li
            key={issue.issue_id}
            className={`IssueRefPopup__Item ${idx === activeIdx ? 'IssueRefPopup__Item--active' : ''}`}
            onClick={() => finish(() => onSelect(issue))}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <CircleDot size={12} className="IssueRefPopup__ItemIcon" />
            <span className="IssueRefPopup__ItemId">{issue.display_id}</span>
            <span className="IssueRefPopup__ItemTitle">{issue.title}</span>
            <span className={`IssueRefPopup__ItemStatus IssueRefPopup__ItemStatus--${issue.status}`}>
              {STATUS_LABEL_KEYS[issue.status] ? t(STATUS_LABEL_KEYS[issue.status]) : issue.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
