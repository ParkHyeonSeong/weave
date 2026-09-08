import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/router';
import { ArrowLeft } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import IssueEditor from './IssueEditor';

export default function CreateIssuePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id: branchId, taskId } = router.query;

  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const editorRef = useRef(null);

  const handleSubmit = async () => {
    if (!title.trim() || loading) return;

    setError('');
    setLoading(true);
    try {
      const html = editorRef.current?.getHTML() || '';
      const isEmpty = editorRef.current?.isEmpty();
      const res = await axios.post(`/branches/${branchId}/tasks/${taskId}/issues`, {
        title: title.trim(),
        body: isEmpty ? null : html,
      });
      if (res.data.status) {
        window.dispatchEvent(new Event('issue:created'));
        router.replace(`/branch/${branchId}/task/${taskId}/issue/${res.data.issue_id}`);
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('branchTasks.createIssue.failed');
        setError(msg);
      }
    } catch {
      setError(t('branchTasks.createIssue.failedRetry'));
    } finally {
      setLoading(false);
    }
  };

  if (!branchId || !taskId) return null;

  return (
    <div className="CreateIssuePage">
      <div className="CreateIssuePage__Header">
        <button
          className="CreateIssuePage__BackBtn"
          onClick={() => router.push(`/branch/${branchId}/task/${taskId}`)}
        >
          <ArrowLeft size={16} />
          {t('branchTasks.issue.backToTask')}
        </button>
      </div>

      <h1 className="CreateIssuePage__Title">{t('branchTasks.createIssue.heading')}</h1>

      <div className="CreateIssuePage__Field">
        <label className="CreateIssuePage__Label">{t('branchTasks.createIssue.titleLabel')}</label>
        <input
          className="CreateIssuePage__Input"
          type="text"
          placeholder={t('branchTasks.createIssue.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          autoFocus
        />
      </div>

      <div className="CreateIssuePage__Field">
        <label className="CreateIssuePage__Label">{t('branchTasks.createIssue.descriptionLabel')}</label>
        <IssueEditor
          ref={editorRef}
          rawModeEnabled
          placeholder={t('branchTasks.issue.bodyPlaceholder')}
          minHeight={200}
          branchId={branchId}
        />
      </div>

      {error && <div className="CreateIssuePage__Error">{error}</div>}

      <div className="CreateIssuePage__Footer">
        <button
          className="CreateIssuePage__CancelBtn"
          onClick={() => router.push(`/branch/${branchId}/task/${taskId}`)}
        >
          {t('common.actions.cancel')}
        </button>
        <button
          className="CreateIssuePage__SubmitBtn"
          onClick={handleSubmit}
          disabled={!title.trim() || loading}
        >
          {loading ? t('branchTasks.createIssue.submitting') : t('branchTasks.createIssue.submit')}
        </button>
      </div>
    </div>
  );
}
