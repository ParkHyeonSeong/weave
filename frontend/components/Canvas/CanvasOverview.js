import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import dynamic from 'next/dynamic';
import { Pencil, X, Wifi, WifiOff, Loader, Copy } from 'lucide-react';
import { axios } from '@/library/_axios';
import useCollabProvider from '@/library/useCollabProvider';
import { sanitizeHtml } from '@/library/sanitize';
import { applyFallbackBadges, useRefHydration } from '@/library/refHydration';
import { useMathHydration } from '@/library/mathRender';
import PresenceBar from './PresenceBar';
import EntityIcon from '@/components/common/EntityIcon';
import EntityAppearancePopover from '@/components/common/EntityAppearancePopover';
import { copyAsMarkdown } from '@/library/copyMarkdown';
import { buildCanvasEditorExtensions } from './canvasEditorExtensions';

const CanvasCollabEditor = dynamic(() => import('./CanvasCollabEditor'), { ssr: false });

export default function CanvasOverview() {
  const { t } = useTranslation();
  const router = useRouter();
  const { canvasId } = router.query;
  const [canvas, setCanvas] = useState(null);
  const [overview, setOverview] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [user, setUser] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const htmlRef = useRef('');
  const contentTimerRef = useRef(null);
  const contentRef = useRef(null);

  // Header appearance popover
  const iconRef = useRef(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const isAdmin = canvas?.my_role === 'admin';

  useEffect(() => {
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      if (profile.user_id) setUser(profile);
    } catch {}
  }, []);

  const fetchCanvas = async () => {
    try {
      const res = await axios.get(`/canvases/${canvasId}`);
      if (res.data.status) setCanvas(res.data.canvas);
    } catch {}
  };

  const fetchOverview = useCallback(async () => {
    if (!canvasId) return;
    try {
      const res = await axios.get(`/canvases/${canvasId}/pages`);
      if (res.data.status) {
        const ov = res.data.pages.find((p) => p.type === 'overview');
        if (ov) {
          const detail = await axios.get(`/canvases/${canvasId}/pages/${ov.page_id}`);
          if (detail.data.status) {
            setOverview(detail.data.page);
          }
        }
      }
    } catch {}
  }, [canvasId]);

  useEffect(() => {
    if (!canvasId) return;
    fetchCanvas();
    fetchOverview();
  }, [canvasId, fetchOverview]);

  // canvas:created 이벤트 수신 (헤더 appearance/일반 설정 변경 반영)
  useEffect(() => {
    if (!canvasId) return;
    const handler = () => fetchCanvas();
    window.addEventListener('canvas:created', handler);
    return () => window.removeEventListener('canvas:created', handler);
  }, [canvasId]);

  // Edit 모드일 때만 WebSocket 연결
  const { ydoc, provider, status, connectedUsers } = useCollabProvider(
    isEditing && canvasId ? Number(canvasId) : null,
    isEditing && overview?.page_id ? overview.page_id : null,
    isEditing ? user : null
  );

  useEffect(() => {
    if (!isEditing) return;
    if (status === 'disconnected') setSaveStatus('offline');
    else if (status === 'connected') setSaveStatus('saved');
  }, [status, isEditing]);

  // 읽기 모드에서 레퍼런스 클릭 핸들러 (task, doc, issue)
  useEffect(() => {
    if (isEditing || !contentRef.current) return;
    const handlers = [];

    contentRef.current.querySelectorAll('[data-task-ref]').forEach((el) => {
      el.classList.add('task-ref');
      el.style.cursor = 'pointer';
      const handler = () => {
        const branchId = el.getAttribute('data-branch-id');
        const taskId = el.getAttribute('data-task-id');
        if (branchId && taskId) router.push(`/branch/${branchId}/task/${taskId}`);
      };
      el.addEventListener('click', handler);
      handlers.push({ el, handler });
    });

    contentRef.current.querySelectorAll('[data-doc-ref]').forEach((el) => {
      el.classList.add('doc-ref');
      el.style.cursor = 'pointer';
      const handler = () => {
        const cId = el.getAttribute('data-canvas-id');
        const pId = el.getAttribute('data-page-id');
        if (cId && pId) router.push(`/canvas/${cId}/${pId}`);
      };
      el.addEventListener('click', handler);
      handlers.push({ el, handler });
    });

    contentRef.current.querySelectorAll('[data-issue-ref]').forEach((el) => {
      el.classList.add('issue-ref');
      el.style.cursor = 'pointer';
      const handler = () => {
        const branchId = el.getAttribute('data-branch-id');
        const taskId = el.getAttribute('data-task-id');
        const issueId = el.getAttribute('data-issue-id');
        if (branchId && taskId && issueId) router.push(`/branch/${branchId}/task/${taskId}/issue/${issueId}`);
      };
      el.addEventListener('click', handler);
      handlers.push({ el, handler });
    });

    return () => handlers.forEach(({ el, handler }) => el.removeEventListener('click', handler));
  }, [isEditing, overview?.content, router]);

  // 읽기 모드에서 ref 칩 폴백 뱃지 주입 (data-* 스냅샷으로 fetch 전 즉시 표시)
  useEffect(() => {
    if (isEditing || !contentRef.current) return;
    applyFallbackBadges(contentRef.current);
  }, [isEditing, overview?.content]);

  // 배치 API로 최신 제목·상태 하이드레이션 + 탭 내 태스크/이슈 변경 이벤트 갱신
  useRefHydration(contentRef, [isEditing, overview?.content], !isEditing);
  useMathHydration(contentRef, [isEditing, overview?.content], !isEditing);

  const handleHtmlChange = (html) => {
    htmlRef.current = html;
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    contentTimerRef.current = setTimeout(async () => {
      if (!overview) return;
      setSaveStatus('saving');
      try {
        await axios.patch(`/canvases/${canvasId}/pages/${overview.page_id}`, {
          content: htmlRef.current,
        });
        setSaveStatus('saved');
      } catch {
        setSaveStatus('offline');
      }
    }, 5000);
  };

  // overview 본문(저장 HTML)을 markdown으로 클립보드 복사 — CanvasPageView와 동일 패턴
  const handleCopyMarkdown = () => copyAsMarkdown(overview.content, buildCanvasEditorExtensions());

  const handleCloseEdit = async () => {
    if (htmlRef.current) {
      try {
        await axios.patch(`/canvases/${canvasId}/pages/${overview.page_id}`, {
          content: htmlRef.current,
        });
      } catch {}
    }
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    htmlRef.current = '';
    setIsEditing(false);
    fetchOverview();
  };

  useEffect(() => {
    return () => {
      if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    };
  }, []);

  if (!canvas) return null;

  return (
    <div className="CanvasOverview">
      <div className="CanvasOverview__Header">
        <div className="CanvasOverview__TitleRow">
          <span ref={iconRef} style={{ display: 'inline-flex' }}>
            <EntityIcon
              icon={canvas.icon}
              color={canvas.color}
              size={24}
              entityType="canvas"
              onClick={isAdmin ? () => setPopoverOpen(true) : undefined}
              title={isAdmin ? t('canvas.overview.editAppearance') : undefined}
            />
          </span>
          <EntityAppearancePopover
            anchorRef={iconRef}
            isOpen={popoverOpen}
            onClose={() => setPopoverOpen(false)}
            entityType="canvas"
            entityId={canvas.canvas_id}
            initialIcon={canvas.icon}
            initialColor={canvas.color}
          />
          <h2 className="CanvasOverview__Name">{canvas.canvas_name}</h2>
        </div>
        {canvas.description && (
          <p className="CanvasOverview__Desc">{canvas.description}</p>
        )}
      </div>

      {overview && (
        <div className="CanvasOverview__Overview">
          <div className="CanvasOverview__OverviewTopBar">
            {isEditing ? (
              <>
                <div className="CanvasOverview__StatusGroup">
                  <span className={`CanvasOverview__Status CanvasOverview__Status--${status}`}>
                    {status === 'connected' ? <Wifi size={14} /> :
                     status === 'connecting' ? <Loader size={14} className="CanvasOverview__StatusSpin" /> :
                     <WifiOff size={14} />}
                  </span>
                  <span className="CanvasOverview__SaveStatus">
                    {saveStatus === 'saved' ? t('canvas.status.saved') : saveStatus === 'saving' ? t('common.state.saving') : t('canvas.status.offline')}
                  </span>
                </div>
                <div className="CanvasOverview__OverviewActions">
                  <PresenceBar users={connectedUsers} currentUserId={user?.user_id} />
                  <button className="CanvasOverview__OverviewBtn" onClick={handleCloseEdit}>
                    <X size={15} />
                    {t('common.actions.close')}
                  </button>
                </div>
              </>
            ) : (
              <>
                {overview.content ? (
                  <button className="CanvasOverview__OverviewBtn" onClick={handleCopyMarkdown}>
                    <Copy size={15} />
                    {t('canvas.copyAsMarkdown')}
                  </button>
                ) : (
                  <div />
                )}
                <button className="CanvasOverview__OverviewBtn" onClick={() => setIsEditing(true)}>
                  <Pencil size={15} />
                  {t('common.actions.edit')}
                </button>
              </>
            )}
          </div>

          <div className="CanvasOverview__OverviewBody">
            {isEditing ? (
              ydoc && provider ? (
                <CanvasCollabEditor
                  ydoc={ydoc}
                  provider={provider}
                  canvasId={Number(canvasId)}
                  initialContent={overview.content || ''}
                  hasExistingYjsState={!!overview.yjs_state}
                  onHtmlChange={handleHtmlChange}
                />
              ) : (
                <div className="CanvasOverview__Loading">{t('canvas.connecting')}</div>
              )
            ) : (
              <>
                <div
                  ref={contentRef}
                  className="CanvasOverview__OverviewContent"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(overview.content) || '<p></p>',
                  }}
                />
                {/* 빈 콘텐츠 안내는 __html 밖의 별도 요소 — 번역 문구를 raw HTML로 흘리지 않는다. */}
                {!overview.content?.trim() && (
                  <p className="CanvasOverview__EmptyHint">{t('canvas.emptyContent')}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
