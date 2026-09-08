import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, CircleDot } from 'lucide-react';
import { axios } from '@/library/_axios';

const STATUS_KEYS = {
  open: 'messenger.issueStatus.open',
  closed: 'messenger.issueStatus.closed',
};

export default function IssueSearchPopup({ keyword, onSelect, onClose }) {
  const { t } = useTranslation();
  const [issues, setIssues] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get('/chat/issue-search', {
          params: { q: keyword },
        });
        if (res.data.status) {
          setIssues(res.data.issues);
          setActiveIdx(0);
        }
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [keyword]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((prev) => Math.min(prev + 1, issues.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (issues[activeIdx]) onSelect(issues[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [issues, activeIdx, onSelect, onClose]);

  return (
    <div className="IssueSearchPopup">
      <div className="IssueSearchPopup__Header">
        <Search size={12} />
        {t('messenger.search.issueHeader')}
      </div>
      <ul className="IssueSearchPopup__List">
        {loading && <li className="IssueSearchPopup__Empty">{t('messenger.search.searching')}</li>}
        {!loading && issues.length === 0 && (
          <li className="IssueSearchPopup__Empty">{t('messenger.search.noIssues')}</li>
        )}
        {!loading && issues.map((issue, idx) => (
          <li
            key={issue.issue_id}
            className={`IssueSearchPopup__Item ${idx === activeIdx ? 'IssueSearchPopup__Item--active' : ''}`}
            onClick={() => onSelect(issue)}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <CircleDot size={12} className="IssueSearchPopup__ItemIcon" />
            <span className="IssueSearchPopup__ItemTitle">{issue.title}</span>
            <span className="IssueSearchPopup__ItemTask">{issue.display_id}</span>
            <span className={`IssueSearchPopup__ItemStatus IssueSearchPopup__ItemStatus--${issue.status}`}>
              {STATUS_KEYS[issue.status] ? t(STATUS_KEYS[issue.status]) : issue.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
