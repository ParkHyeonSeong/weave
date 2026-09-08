import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, GitPullRequest, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getErrorCode } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

// PR state → 표시 라벨 키. 문구는 렌더 시 t()로 해석한다.
const STATE_LABEL_KEY = {
  open: 'branchTasks.github.state.open',
  merged: 'branchTasks.github.state.merged',
  closed: 'branchTasks.github.state.closed',
  draft: 'branchTasks.github.state.draft',
};

export default function TaskGithubRefSection({ branchId, taskId }) {
  const { t } = useTranslation();
  const [refs, setRefs] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [url, setUrl] = useState('');
  const [linking, setLinking] = useState(false);
  const [err, setErr] = useState('');

  const fetchRefs = useCallback(async () => {
    if (!branchId || !taskId) return;
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskId}/github-refs`);
      if (res.data.status) setRefs(res.data.refs || []);
    } catch {}
  }, [branchId, taskId]);

  useEffect(() => {
    fetchRefs();
    // GitHub webhook이 PR ref를 upsert하고 broadcast → Layout이 task:updated emit.
    // 같은 taskId면 이 컴포넌트는 remount되지 않으므로 직접 수신해 ref 목록을 재조회한다.
    // (안 그러면 자동 연결돼도 "No linked pull requests"가 그대로 남는다 — 핵심 피드백 누락.)
    const onTaskUpdated = () => { fetchRefs(); };
    window.addEventListener('task:updated', onTaskUpdated);
    return () => window.removeEventListener('task:updated', onTaskUpdated);
  }, [fetchRefs]);

  const handleLink = async () => {
    const value = url.trim();
    if (!value || linking) return;
    setLinking(true);
    setErr('');
    try {
      const res = await axios.post(
        `/branches/${branchId}/tasks/${taskId}/github-refs`,
        { html_url: value },
      );
      if (res.data.status) {
        setUrl('');
        setShowAdd(false);
        await fetchRefs();
      } else {
        const code = getErrorCode(res.data);
        setErr(errorText(code, res.data.category) || t('branchTasks.github.linkFailed'));
      }
    } catch {
      setErr(t('branchTasks.github.linkFailed'));
    }
    setLinking(false);
  };

  const handleUnlink = async (e, refId) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const res = await axios.delete(
        `/branches/${branchId}/tasks/${taskId}/github-refs/${refId}`,
      );
      if (res.data.status) await fetchRefs();
    } catch {}
  };

  return (
    <div className="TaskGithubRefSection">
      <div className="TaskGithubRefSection__Header">
        <span className="TaskGithubRefSection__Label">{t('branchTasks.github.pullRequests')}</span>
        <button
          className="TaskGithubRefSection__AddBtn"
          onClick={() => { setShowAdd((v) => !v); setErr(''); }}
        >
          <Plus size={14} />
        </button>
      </div>

      {showAdd && (
        <div className="TaskGithubRefSection__AddForm">
          <input
            className="TaskGithubRefSection__Input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/org/repo/pull/123"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleLink(); }}
          />
          {err && <span className="TaskGithubRefSection__Error">{err}</span>}
          <div className="TaskGithubRefSection__AddActions">
            <button
              className="TaskGithubRefSection__SubmitBtn"
              onClick={handleLink}
              disabled={!url.trim() || linking}
            >
              {linking ? t('branchTasks.github.linking') : t('branchTasks.github.link')}
            </button>
            <button
              className="TaskGithubRefSection__CancelBtn"
              onClick={() => { setShowAdd(false); setErr(''); }}
            >
              {t('common.actions.cancel')}
            </button>
          </div>
        </div>
      )}

      {refs.length === 0 && !showAdd ? (
        <div className="TaskGithubRefSection__Empty">{t('branchTasks.github.empty')}</div>
      ) : (
        <div className="TaskGithubRefSection__List">
          {refs.map((r) => (
            <div key={r.ref_id} className="TaskGithubRefSection__Item">
              <a
                className="TaskGithubRefSection__ItemOverlay"
                href={typeof r.html_url === 'string' && r.html_url.startsWith('https://') ? r.html_url : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={r.title || t('branchTasks.github.prAria', { number: r.ref_number })}
              />
              <GitPullRequest size={14} className="TaskGithubRefSection__Icon" />
              <span className="TaskGithubRefSection__PrTitle">
                {r.title || `#${r.ref_number}`}
              </span>
              {r.ref_number != null && (
                <span className="TaskGithubRefSection__PrNumber">#{r.ref_number}</span>
              )}
              {r.state && (
                <span
                  className={`TaskGithubRefSection__State TaskGithubRefSection__State--${r.state}`}
                >
                  {STATE_LABEL_KEY[r.state] ? t(STATE_LABEL_KEY[r.state]) : r.state}
                </span>
              )}
              <button
                className="TaskGithubRefSection__UnlinkBtn"
                onClick={(e) => handleUnlink(e, r.ref_id)}
                title={t('branchTasks.github.unlink')}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
