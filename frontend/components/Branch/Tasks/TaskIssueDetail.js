import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/router';
import { ArrowLeft, CircleDot, MoreHorizontal, Pencil, Copy, Trash2, XCircle, CheckCircle2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import { ensureRenderableHtml } from '@/library/ensureHtml';
import { sanitizeHtml } from '@/library/sanitize';
import { useRefHydration } from '@/library/refHydration';
import { useMathHydration } from '@/library/mathRender';
import Avatar from '@/components/common/Avatar';
import IssueEditor from './IssueEditor';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { buildIssueEditorExtensions } from './issueEditorExtensions';
import { copyAsMarkdown } from '@/library/copyMarkdown';
import { useDateFormat } from '@/hooks/useDateFormat';

export default function TaskIssueDetail() {
  const { t } = useTranslation();
  const { formatTimestamp, formatRelative } = useDateFormat();
  const router = useRouter();
  const { id: branchId, taskId, issueId } = router.query;

  const [issue, setIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [composerEmpty, setComposerEmpty] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 제목/본문 편집
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [editingBody, setEditingBody] = useState(false);

  // 댓글 편집
  const [editingCommentId, setEditingCommentId] = useState(null);

  // 메뉴
  const [openMenuId, setOpenMenuId] = useState(null);

  // 삭제 확인
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 에디터 refs
  const bodyEditorRef = useRef(null);
  const commentEditorRef = useRef(null);
  const newCommentRef = useRef(null);

  // readonly 본문·댓글의 ref 칩 하이드레이션 (최신 제목·상태 + 탭 내 변경 이벤트)
  // 편집 취소 시 readonly가 stale 스냅샷으로 재마운트되므로 편집 플래그도 deps에 포함
  const timelineRef = useRef(null);
  useRefHydration(timelineRef, [issue?.body, comments, editingBody, editingCommentId]);
  useMathHydration(timelineRef, [issue?.body, comments, editingBody, editingCommentId]);

  const myProfile = typeof window !== 'undefined'
    ? JSON.parse(sessionStorage.getItem('profile') || '{}')
    : {};

  // IssueEditor.getHTML()은 raw 파싱 실패(방어) 시 throw한다 — 4개 호출부(전환/본문/댓글
  // 추가/댓글 수정) 공용으로 여기서 흡수해 null 반환. 호출부는 null이면 저장/전송하지 않는다
  // (RawModeBadge가 이미 편집기 안에서 실패를 안내하므로 여기선 조용히 중단).
  const safeGetHTML = (ref) => {
    try {
      return ref.current?.getHTML() || '';
    } catch {
      return null;
    }
  };

  const fetchIssue = async () => {
    if (!branchId || !taskId || !issueId) return;
    setLoading(true);
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskId}/issues/${issueId}`);
      if (res.data.status) {
        setIssue(res.data.issue);
        setComments(res.data.comments || []);
        setTimeline(res.data.timeline || []);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchIssue();
  }, [branchId, taskId, issueId]);

  // 상태 전환 (+선택 댓글) — close/reopen 공통
  const transition = async (kind) => {            // kind: 'close' | 'reopen'
    if (submitting) return;
    // 클릭 시점에 에디터를 직접 읽어 composerEmpty stale state 리스크 제거
    const isEmpty = newCommentRef.current?.isEmpty() ?? true;
    let html = null;
    if (!isEmpty) {
      html = safeGetHTML(newCommentRef);
      if (html === null) return; // 파싱 실패 — 전환도 댓글도 진행하지 않음
    }
    setSubmitting(true);
    try {
      const res = await axios.post(
        `/branches/${branchId}/tasks/${taskId}/issues/${issueId}/${kind}`,
        html ? { comment: html } : {}
      );
      if (res.data.status) {
        newCommentRef.current?.clearContent();
        setComposerEmpty(true);
        fetchIssue();
        window.dispatchEvent(new Event('issue:updated'));
      }
    } catch {}
    setSubmitting(false);
  };

  // 제목 저장
  const saveTitle = async () => {
    if (!titleValue.trim() || titleValue.trim() === issue.title) {
      setEditingTitle(false);
      return;
    }
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${taskId}/issues/${issueId}`, {
        title: titleValue.trim(),
      });
      if (res.data.status) {
        setIssue((prev) => ({ ...prev, title: titleValue.trim() }));
        window.dispatchEvent(new Event('issue:updated'));
      }
    } catch {}
    setEditingTitle(false);
  };

  // 본문 저장
  const saveBody = async () => {
    const isEmpty = bodyEditorRef.current?.isEmpty();
    let html = '';
    if (!isEmpty) {
      html = safeGetHTML(bodyEditorRef);
      if (html === null) return; // 파싱 실패 — 편집 상태 유지(저장 안 함)
    }
    const val = isEmpty ? null : html;
    if (val === (issue.body || null)) {
      setEditingBody(false);
      return;
    }
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${taskId}/issues/${issueId}`, {
        body: val,
      });
      if (res.data.status) {
        setIssue((prev) => ({ ...prev, body: val, updated_at: new Date().toISOString() }));
      }
    } catch {}
    setEditingBody(false);
  };

  // 댓글 추가
  const handleAddComment = async () => {
    const isEmpty = newCommentRef.current?.isEmpty();
    if (isEmpty || submitting) return;
    const html = safeGetHTML(newCommentRef);
    if (html === null) return; // 파싱 실패 — 제출하지 않음
    setSubmitting(true);
    try {
      const res = await axios.post(`/branches/${branchId}/tasks/${taskId}/issues/${issueId}/comments`, {
        content: html,
      });
      if (res.data.status) {
        newCommentRef.current?.clearContent();
        setComposerEmpty(true);
        fetchIssue();
      }
    } catch {}
    setSubmitting(false);
  };

  // 댓글 수정
  const saveComment = async (commentId) => {
    const isEmpty = commentEditorRef.current?.isEmpty();
    if (isEmpty) return;
    const html = safeGetHTML(commentEditorRef);
    if (html === null) return; // 파싱 실패 — 편집 상태 유지(저장 안 함)
    try {
      const res = await axios.patch(
        `/branches/${branchId}/tasks/${taskId}/issues/${issueId}/comments/${commentId}`,
        { content: html }
      );
      if (res.data.status) {
        setComments((prev) =>
          prev.map((c) => c.comment_id === commentId
            ? { ...c, content: html, updated_at: new Date().toISOString() }
            : c
          )
        );
        setTimeline((prev) => prev.map((item) => (item.kind === 'comment' && item.comment_id === commentId) ? { ...item, content: html, updated_at: new Date().toISOString() } : item));
      }
    } catch {}
    setEditingCommentId(null);
  };

  // 댓글 삭제
  const deleteComment = async (commentId) => {
    try {
      const res = await axios.delete(
        `/branches/${branchId}/tasks/${taskId}/issues/${issueId}/comments/${commentId}`
      );
      if (res.data.status) {
        setComments((prev) => prev.filter((c) => c.comment_id !== commentId));
        setTimeline((prev) => prev.filter((item) => !(item.kind === 'comment' && item.comment_id === commentId)));
      }
    } catch {}
  };

  // 본문/댓글을 markdown으로 복사 — 읽기 뷰 렌더(:337,:412)와 동일하게 ensureRenderableHtml 폴백 적용
  const handleCopyMarkdown = (html) => {
    if (!html) return;
    copyAsMarkdown(html, buildIssueEditorExtensions());
  };

  // 이슈 삭제
  const deleteIssue = async () => {
    setShowDeleteConfirm(false);
    try {
      const res = await axios.delete(`/branches/${branchId}/tasks/${taskId}/issues/${issueId}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('issue:deleted'));
        router.push(`/branch/${branchId}/task/${taskId}`);
      }
    } catch {}
  };

  if (loading || !issue) {
    return <div className="IssueDetail"><div className="IssueDetail__Loading">{t('common.state.loading')}</div></div>;
  }

  const isAuthor = myProfile.user_id === issue.created_by;

  // 상대시간은 공용 formatter 하나(useDateFormat().formatRelative)로 통일한다 —
  // 단위 문구는 Intl.RelativeTimeFormat이 locale에 맞게 내고, '어제'만 개인 시간대의
  // 달력 날짜로 판정한다. 여기서 사다리를 다시 구현하면 화면마다 경계가 달라진다.
  const formatDate = (dateStr) => formatRelative(dateStr);

  const isEdited = (item) => item.updated_at && item.updated_at !== item.created_at;

  return (
    <div className="IssueDetail">
      {/* 헤더 */}
      <div className="IssueDetail__Header">
        <button
          className="IssueDetail__BackBtn"
          onClick={() => router.push(`/branch/${branchId}/task/${taskId}`)}
        >
          <ArrowLeft size={16} />
          {t('branchTasks.issue.backToTask')}
        </button>
      </div>

      {/* 제목 + 이슈 번호 */}
      <div className="IssueDetail__TitleArea">
        {editingTitle ? (
          <div className="IssueDetail__TitleEdit">
            <input
              className="IssueDetail__TitleInput"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
              autoFocus
            />
            <div className="IssueDetail__TitleEditActions">
              <button className="IssueDetail__TitleSaveBtn" onClick={saveTitle}>{t('common.actions.save')}</button>
              <button className="IssueDetail__TitleCancelBtn" onClick={() => setEditingTitle(false)}>{t('common.actions.cancel')}</button>
            </div>
          </div>
        ) : (
          <div className="IssueDetail__TitleRow">
            <h1 className="IssueDetail__Title">
              {issue.title}
              <span className="IssueDetail__IssueNumber">#{issue.issue_id}</span>
            </h1>
            {isAuthor && (
              <button
                className="IssueDetail__TitleEditBtn"
                onClick={() => { setTitleValue(issue.title); setEditingTitle(true); }}
              >
                {t('common.actions.edit')}
              </button>
            )}
          </div>
        )}

        {/* 상태 뱃지 + 메타 */}
        <div className="IssueDetail__Meta">
          <span className={`IssueDetail__StatusBadge IssueDetail__StatusBadge--${issue.status}`}>
            {issue.status === 'open' ? <CircleDot size={14} /> : <CheckCircle2 size={14} />}
            {issue.status === 'open' ? t('branchTasks.issue.open') : t('branchTasks.issue.closed')}
          </span>
          <span className="IssueDetail__MetaText">
            <strong>{issue.author_name}</strong>{' '}
            {t('branchTasks.issue.openedThisIssue', { when: formatDate(issue.created_at) })}
            {' '}&middot; {t('branchTasks.issue.commentCount', { count: comments.length })}
          </span>
        </div>
      </div>

      <div className="IssueDetail__Divider" />

      {/* 타임라인: 본문 + 댓글 */}
      <div className="IssueDetail__Timeline" ref={timelineRef}>
        {/* 본문 카드 (OP) */}
        <div className="IssueDetail__TimelineItem">
          <Avatar
            name={issue.author_name}
            userId={issue.created_by}
            avatarUrl={issue.author_avatar_url}
            avatarColor={issue.author_avatar_color}
            size="md"
            className="IssueDetail__Avatar"
          />
          <div className={`IssueDetail__Card IssueDetail__Card--op`}>
            <div className="IssueDetail__CardHeader">
              <span className="IssueDetail__CardAuthor">{issue.author_name}</span>
              <span className="IssueDetail__CardTime">
                {formatDate(issue.created_at)}
                {isEdited(issue) && <span className="IssueDetail__Edited"> &middot; {t('branchTasks.issue.edited')}</span>}
              </span>
              <span className="IssueDetail__OpBadge">{t('branchTasks.issue.authorBadge')}</span>
              {(isAuthor || issue.body) && (
                <DropdownMenu
                  id="issue-body"
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                  onCopyMarkdown={issue.body ? () => handleCopyMarkdown(issue.body) : undefined}
                  onEdit={isAuthor ? () => setEditingBody(true) : undefined}
                  onDelete={isAuthor ? () => setShowDeleteConfirm(true) : undefined}
                  deleteLabel={t('branchTasks.issue.deleteIssue')}
                />
              )}
            </div>
            {editingBody ? (
              <div className="IssueDetail__CardEditBody">
                <IssueEditor
                  ref={bodyEditorRef}
                  rawModeEnabled
                  content={issue.body || ''}
                  placeholder={t('branchTasks.issue.bodyPlaceholder')}
                  minHeight={150}
                  branchId={branchId}
                />
                <div className="IssueDetail__CardEditActions">
                  <button className="IssueDetail__SaveBtn" onClick={saveBody}>{t('branchTasks.issue.update')}</button>
                  <button className="IssueDetail__CancelBtn" onClick={() => setEditingBody(false)}>{t('common.actions.cancel')}</button>
                </div>
              </div>
            ) : (
              <div className={`IssueDetail__CardBody ${!issue.body ? 'IssueDetail__CardBody--empty' : ''}`}>
                {issue.body ? (
                  <div className="TaskDescReadonly" dangerouslySetInnerHTML={{ __html: sanitizeHtml(ensureRenderableHtml(issue.body)) }} />
                ) : (
                  isAuthor ? t('branchTasks.issue.noDescriptionAuthor') : t('branchTasks.issue.noDescription')
                )}
              </div>
            )}
          </div>
        </div>

        {/* 타임라인: 댓글 + 상태 이벤트 (백엔드 정렬) */}
        {timeline.map((item) => {
          if (item.kind === 'event') {
            return (
              <div key={`ev-${item.event_id}`} className="IssueDetail__EventRow">
                {item.event_type === 'closed'
                  ? <XCircle size={14} className="IssueDetail__EventIcon IssueDetail__EventIcon--closed" />
                  : <CircleDot size={14} className="IssueDetail__EventIcon IssueDetail__EventIcon--reopened" />}
                <span className="IssueDetail__EventText">
                  <strong>{item.actor_name}</strong>{' '}
                  {item.event_type === 'closed' ? t('branchTasks.issue.eventClosed') : t('branchTasks.issue.eventReopened')}
                  {' '}&middot; {formatDate(item.created_at)}
                </span>
              </div>
            );
          }
          const comment = item;
          const isCommentAuthor = myProfile.user_id === comment.author_id;
          const isEditingThis = editingCommentId === comment.comment_id;
          const isIssueAuthor = comment.author_id === issue.created_by;
          return (
            <div key={`c-${comment.comment_id}`} className="IssueDetail__TimelineItem">
              <Avatar
                name={comment.author_name}
                userId={comment.author_id}
                avatarUrl={comment.author_avatar_url}
                avatarColor={comment.author_avatar_color}
                size="md"
                className="IssueDetail__Avatar"
              />
              <div className="IssueDetail__Card">
                <div className="IssueDetail__CardHeader">
                  <span className="IssueDetail__CardAuthor">{comment.author_name}</span>
                  <span className="IssueDetail__CardTime">
                    {formatDate(comment.created_at)}
                    {isEdited(comment) && <span className="IssueDetail__Edited"> &middot; {t('branchTasks.issue.edited')}</span>}
                  </span>
                  {isIssueAuthor && <span className="IssueDetail__OpBadge">{t('branchTasks.issue.authorBadge')}</span>}
                  {!isEditingThis && (
                    <DropdownMenu
                      id={`comment-${comment.comment_id}`}
                      openMenuId={openMenuId}
                      setOpenMenuId={setOpenMenuId}
                      onCopyMarkdown={() => handleCopyMarkdown(comment.content)}
                      onEdit={isCommentAuthor ? () => setEditingCommentId(comment.comment_id) : undefined}
                      onDelete={isCommentAuthor ? () => deleteComment(comment.comment_id) : undefined}
                      deleteLabel={t('common.actions.delete')}
                    />
                  )}
                </div>
                {isEditingThis ? (
                  <div className="IssueDetail__CardEditBody">
                    <IssueEditor
                      ref={commentEditorRef}
                      rawModeEnabled
                      content={comment.content}
                      placeholder={t('branchTasks.issue.editCommentPlaceholder')}
                      minHeight={100}
                      branchId={branchId}
                    />
                    <div className="IssueDetail__CardEditActions">
                      <button className="IssueDetail__SaveBtn" onClick={() => saveComment(comment.comment_id)}>{t('branchTasks.issue.update')}</button>
                      <button className="IssueDetail__CancelBtn" onClick={() => setEditingCommentId(null)}>{t('common.actions.cancel')}</button>
                    </div>
                  </div>
                ) : (
                  <div className="IssueDetail__CardBody">
                    <div className="TaskDescReadonly" dangerouslySetInnerHTML={{ __html: sanitizeHtml(ensureRenderableHtml(comment.content)) }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 상태 토글 + 댓글 입력 */}
      <div className="IssueDetail__ReplyArea">
        <Avatar
          user={myProfile}
          size={28}
          className="IssueDetail__Avatar IssueDetail__Avatar--sm"
        />
        <div className={`IssueDetail__ReplyForm${submitting ? ' IssueDetail__ReplyForm--submitting' : ''}`}>
          <IssueEditor
            ref={newCommentRef}
            rawModeEnabled
            placeholder={t('branchTasks.issue.commentPlaceholder')}
            minHeight={100}
            branchId={branchId}
            onChange={(empty) => setComposerEmpty(empty)}
          />
          <div className="IssueDetail__ReplyActions">
            <button
              type="button"
              className={`IssueDetail__StatusToggle IssueDetail__StatusToggle--${issue.status === 'open' ? 'close' : 'reopen'}`}
              onClick={() => transition(issue.status === 'open' ? 'close' : 'reopen')}
              disabled={submitting}
            >
              {issue.status === 'open' ? <XCircle size={14} /> : <CircleDot size={14} />}
              {issue.status === 'open'
                ? (composerEmpty ? t('branchTasks.issue.closeIssue') : t('branchTasks.issue.closeWithComment'))
                : (composerEmpty ? t('branchTasks.issue.reopenIssue') : t('branchTasks.issue.commentAndReopen'))}
            </button>
            <button
              type="button"
              className="IssueDetail__ReplySubmit"
              onClick={handleAddComment}
              disabled={submitting || composerEmpty}
            >
              {submitting ? t('branchTasks.issue.commenting') : t('branchTasks.issue.comment')}
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={deleteIssue}
        title={t('branchTasks.issue.deleteTitle')}
        message={t('branchTasks.issue.deleteConfirm', { title: issue.title })}
        confirmLabel={t('common.actions.delete')}
        variant="danger"
      />
    </div>
  );
}

// --- 드롭다운 메뉴 ---
function DropdownMenu({ id, openMenuId, setOpenMenuId, onCopyMarkdown, onEdit, onDelete, deleteLabel }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const isOpen = openMenuId === id;

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpenMenuId(null);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  return (
    <div className="IssueDetail__MenuWrap" ref={ref}>
      <button
        className="IssueDetail__MenuBtn"
        onClick={() => setOpenMenuId(isOpen ? null : id)}
      >
        <MoreHorizontal size={14} />
      </button>
      {isOpen && (
        <div className="IssueDetail__MenuDropdown">
          {onCopyMarkdown && (
            <button
              className="IssueDetail__MenuItem"
              onClick={() => { setOpenMenuId(null); onCopyMarkdown(); }}
            >
              <Copy size={12} />
              {t('branchTasks.copyAsMarkdown')}
            </button>
          )}
          {onEdit && (
            <button
              className="IssueDetail__MenuItem"
              onClick={() => { setOpenMenuId(null); onEdit(); }}
            >
              <Pencil size={12} />
              {t('common.actions.edit')}
            </button>
          )}
          {onDelete && (
            <button
              className="IssueDetail__MenuItem IssueDetail__MenuItem--danger"
              onClick={() => { setOpenMenuId(null); onDelete(); }}
            >
              <Trash2 size={12} />
              {deleteLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
