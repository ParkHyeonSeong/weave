import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { X, ExternalLink, ArrowRight, Loader } from 'lucide-react';
import { axios } from '@/library/_axios';
import { sanitizeHtml } from '@/library/sanitize';
import { useRefHydration } from '@/library/refHydration';
import { useMathHydration } from '@/library/mathRender';

export default function RefPreviewPanel({ refType, refData, onClose }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const bodyRef = useRef(null);

  // refData를 안정적인 키로 변환 (객체 참조 비교 문제 방지)
  const refKey = JSON.stringify({ refType, ...refData });

  useEffect(() => {
    setData(null);
    setLoading(true);
    let cancelled = false;

    const fetchData = async () => {
      try {
        let res;
        if (refType === 'doc') {
          res = await axios.get(`/canvases/${refData.canvasId}/pages/${refData.pageId}`);
          if (!cancelled && res.data.status) setData(res.data.page);
        } else if (refType === 'issue') {
          res = await axios.get(`/branches/${refData.branchId}/tasks/${refData.taskId}/issues/${refData.issueId}`);
          if (!cancelled && res.data.status) setData(res.data.issue);
        }
      } catch {}
      if (!cancelled) setLoading(false);
    };

    fetchData();
    return () => { cancelled = true; };
  }, [refKey]);

  // 프리뷰 본문의 ref 칩 하이드레이션 (최신 제목·상태 + 탭 내 변경 이벤트)
  useRefHydration(bodyRef, [data]);
  useMathHydration(bodyRef, [data]);

  const getNavigateUrl = () => {
    if (refType === 'doc') return `/canvas/${refData.canvasId}/${refData.pageId}`;
    if (refType === 'issue') return `/branch/${refData.branchId}/task/${refData.taskId}/issue/${refData.issueId}`;
    return '/';
  };

  const handleNavigate = () => {
    router.push(getNavigateUrl());
  };

  const handleOpenNewTab = () => {
    window.open(getNavigateUrl(), '_blank');
  };

  // task 칩은 RefPanelHost에서 TaskDetailPanel로 라우팅됨 — 이 패널은 doc/issue 전용
  const typeLabels = { doc: t('canvas.refPreview.typeDoc'), issue: t('canvas.refPreview.typeIssue') };

  return (
    <div className="RefPreviewPanel">
      <div className="RefPreviewPanel__Header">
        <span className="RefPreviewPanel__TypeLabel">{typeLabels[refType] || t('canvas.refPreview.typeFallback')}</span>
        <div className="RefPreviewPanel__HeaderRight">
          <button className="RefPreviewPanel__HeaderBtn" onClick={handleOpenNewTab} title={t('spaceMenu.openNewTab')}>
            <ExternalLink size={14} />
          </button>
          <button className="RefPreviewPanel__HeaderBtn" onClick={handleNavigate} title={t('canvas.refPreview.navigate')}>
            <ArrowRight size={14} />
          </button>
          <button className="RefPreviewPanel__HeaderBtn" onClick={onClose} title={t('common.actions.close')}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="RefPreviewPanel__Body" ref={bodyRef}>
        {loading ? (
          <div className="RefPreviewPanel__Loading">
            <Loader size={20} className="RefPreviewPanel__Spinner" />
          </div>
        ) : !data ? (
          <div className="RefPreviewPanel__Empty">{t('canvas.refPreview.loadFailed')}</div>
        ) : (
          <>
            {refType === 'doc' && <DocPreview page={data} />}
            {refType === 'issue' && <IssuePreview issue={data} />}
          </>
        )}
      </div>
    </div>
  );
}

function DocPreview({ page }) {
  return (
    <div className="RefPreviewPanel__Content">
      <h3 className="RefPreviewPanel__Title">{page.title}</h3>

      {page.content && (
        <div
          className="RefPreviewPanel__HtmlContent RefPreviewPanel__HtmlContent--doc ProseMirror"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(page.content) }}
        />
      )}
    </div>
  );
}

function IssuePreview({ issue }) {
  const { t } = useTranslation();
  const statusLabel = issue.status === 'open' ? t('canvas.refPreview.issueOpen') : t('canvas.refPreview.issueClosed');

  return (
    <div className="RefPreviewPanel__Content">
      <div className="RefPreviewPanel__TitleRow">
        <span className={`RefPreviewPanel__Badge RefPreviewPanel__Badge--${issue.status}`}>
          {statusLabel}
        </span>
      </div>
      <h3 className="RefPreviewPanel__Title">{issue.title}</h3>

      {issue.description && (
        <div className="RefPreviewPanel__Section">
          <span className="RefPreviewPanel__SectionTitle">{t('canvas.refPreview.description')}</span>
          <div
            className="RefPreviewPanel__HtmlContent"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(issue.description) }}
          />
        </div>
      )}
    </div>
  );
}
