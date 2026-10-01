import { useState, useRef, useEffect } from 'react';
import { X, Check, RotateCcw, Trash2, MoreHorizontal, MessageSquare, Pencil } from 'lucide-react';
import { sanitizeHtml } from '@/library/sanitize';
import { useRefHydration } from '@/library/refHydration';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useTranslation } from 'react-i18next';
import Avatar from '@/components/common/Avatar';
import ConfirmModal from '@/components/modal/ConfirmModal';
import IssueEditor from '@/components/Branch/Tasks/IssueEditor';


export default function AnnotationSidebar({
  canvasId, // 입력창 @멘션 후보 범위(이 캔버스 멤버)
  annotations,
  isOpen,
  onClose,
  onResolve,
  onReopen,
  onDelete,
  onCreateReply,
  onUpdateReply,
  onDeleteReply,
  activeAnnotationId,
  revealKey = 0, // 바뀔 때마다 활성 스레드를 다시 옮겨 보여 준다(같은 댓글 알림을 다시 눌렀을 때)
  onAnnotationSelect,
  // 새 코멘트 작성 모드
  newAnnotationData,
  onSubmitNewAnnotation,
  onCancelNewAnnotation,
}) {
  const { t } = useTranslation();
  const { formatRelative } = useDateFormat();
  const [tab, setTab] = useState('open');
  const [replyingTo, setReplyingTo] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [editingReplyId, setEditingReplyId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // 삭제 확인 중인 스레드
  const newCommentRef = useRef(null);
  const replyEditorRef = useRef(null);
  const editReplyRef = useRef(null);
  const sidebarRef = useRef(null);
  const scrolledToRef = useRef(null); // 마지막으로 옮겨 보여 준 활성 스레드

  const myProfile = typeof window !== 'undefined'
    ? JSON.parse(sessionStorage.getItem('profile') || '{}')
    : {};

  const filtered = annotations.filter((a) =>
    tab === 'open' ? a.status === 'open' : a.status === 'resolved'
  );

  const openCount = annotations.filter((a) => a.status === 'open').length;
  const resolvedCount = annotations.filter((a) => a.status === 'resolved').length;

  // 새 코멘트 작성 모드 진입 시 탭 전환 + 스크롤
  useEffect(() => {
    if (newAnnotationData) {
      setTab('open');
    }
  }, [newAnnotationData]);

  // readonly 답글의 ref 칩 하이드레이션 (최신 제목·상태 + 탭 내 변경 이벤트)
  useRefHydration(sidebarRef, [annotations, tab, isOpen], isOpen);

  // 활성 스레드(본문 앵커·카드 클릭, 댓글 알림 링크)를 옮겨 보여준다. 다른 탭에 있으면 그 탭으로 바꾸고, 목록이 아직
  // 없거나 패널이 닫혀 있으면 준비된 뒤에 스크롤한다. 요청(스레드·revealKey)마다 한 번만 — 그 뒤엔 사용자가 탭을
  // 자유롭게 옮기고, 목록 갱신만으로는 다시 끌려가지 않는다.
  useEffect(() => {
    if (!activeAnnotationId) {
      scrolledToRef.current = null;
      return;
    }
    const request = `${activeAnnotationId}:${revealKey}`;
    if (scrolledToRef.current === request) return;
    const target = annotations.find((a) => a.annotation_id === activeAnnotationId);
    if (!target) return;
    if (target.status !== tab) {
      setTab(target.status);
      return;
    }
    const card = sidebarRef.current?.querySelector(`[data-annotation-id="${activeAnnotationId}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    scrolledToRef.current = request;
  }, [activeAnnotationId, revealKey, annotations, tab, isOpen]);

  const handleSubmitNew = async () => {
    if (!newCommentRef.current || newCommentRef.current.isEmpty()) return;
    const html = newCommentRef.current.getHTML();
    if (onSubmitNewAnnotation) {
      await onSubmitNewAnnotation(html);
    }
  };

  const handleSubmitReply = async (annotationId) => {
    if (!replyEditorRef.current || replyEditorRef.current.isEmpty()) return;
    const html = replyEditorRef.current.getHTML();
    await onCreateReply(annotationId, html);
    replyEditorRef.current.clearContent();
    setReplyingTo(null);
  };

  const handleSubmitEdit = async (annotationId, replyId) => {
    if (!editReplyRef.current || editReplyRef.current.isEmpty()) return;
    const html = editReplyRef.current.getHTML();
    // 실패하면(이유는 onUpdateReply가 알린다) 편집창과 고친 내용을 그대로 둔다
    if (!(await onUpdateReply(annotationId, replyId, html))) return;
    // 성공해도 응답을 기다리는 사이 이어서 고쳤거나 다른 답글 편집으로 옮겼으면 그 편집창은 닫지 않는다 — 닫으면
    // 아직 저장하지 않은 새 내용이 사라진다
    if (editReplyRef.current?.getHTML() !== html) return;
    setEditingReplyId((current) => (current === replyId ? null : current));
  };

  const handleConfirmDelete = () => {
    const id = deleteTarget?.annotation_id;
    setDeleteTarget(null);
    if (id) onDelete(id);
  };

  if (!isOpen) return null;

  return (
    <>
    <div className="AnnotationSidebar">
      <div className="AnnotationSidebar__Header">
        <h3 className="AnnotationSidebar__Title">{t('canvas.annotations.title')}</h3>
        <button className="AnnotationSidebar__Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="AnnotationSidebar__Tabs">
        <button
          className={`AnnotationSidebar__Tab${tab === 'open' ? ' AnnotationSidebar__Tab--active' : ''}`}
          onClick={() => setTab('open')}
        >
          {t('canvas.annotations.tabOpen', { count: openCount })}
        </button>
        <button
          className={`AnnotationSidebar__Tab${tab === 'resolved' ? ' AnnotationSidebar__Tab--active' : ''}`}
          onClick={() => setTab('resolved')}
        >
          {t('canvas.annotations.tabResolved', { count: resolvedCount })}
        </button>
      </div>

      <div className="AnnotationSidebar__List" ref={sidebarRef}>
        {/* 새 코멘트 작성 폼 */}
        {newAnnotationData && tab === 'open' && (
          <div className="AnnotationSidebar__Card AnnotationSidebar__Card--new">
            <div className="AnnotationSidebar__Quote">
              "{newAnnotationData.quoted_text.length > 80
                ? newAnnotationData.quoted_text.slice(0, 80) + '...'
                : newAnnotationData.quoted_text}"
            </div>
            <div className="AnnotationSidebar__NewEditor">
              <IssueEditor ref={newCommentRef} placeholder={t('canvas.annotations.commentPlaceholder')} minHeight={80} canvasId={canvasId} />
              <div className="AnnotationSidebar__NewActions">
                <button
                  className="AnnotationSidebar__Btn AnnotationSidebar__Btn--secondary"
                  onClick={onCancelNewAnnotation}
                >
                  {t('common.actions.cancel')}
                </button>
                <button
                  className="AnnotationSidebar__Btn AnnotationSidebar__Btn--primary"
                  onClick={handleSubmitNew}
                >
                  {t('canvas.annotations.submit')}
                </button>
              </div>
            </div>
          </div>
        )}

        {filtered.length === 0 && !newAnnotationData && (
          <div className="AnnotationSidebar__Empty">
            <MessageSquare size={24} />
            <span>{tab === 'open' ? t('canvas.annotations.emptyOpen') : t('canvas.annotations.emptyResolved')}</span>
          </div>
        )}

        {filtered.map((ann) => (
          <div
            key={ann.annotation_id}
            className={`AnnotationSidebar__Card${
              activeAnnotationId === ann.annotation_id ? ' AnnotationSidebar__Card--active' : ''
            }`}
            data-annotation-id={ann.annotation_id}
            onClick={() => onAnnotationSelect?.(ann.annotation_id)}
          >
            {/* 인용 텍스트 */}
            <div className="AnnotationSidebar__Quote">
              "{ann.quoted_text.length > 80
                ? ann.quoted_text.slice(0, 80) + '...'
                : ann.quoted_text}"
            </div>

            {/* 답글들 */}
            <div className="AnnotationSidebar__Replies">
              {(ann.replies || []).map((reply) => (
                <div key={reply.reply_id} className="AnnotationSidebar__Reply">
                  <div className="AnnotationSidebar__ReplyHeader">
                    <Avatar user={reply} size="sm" />
                    <span className="AnnotationSidebar__AuthorName">{reply.author_name}</span>
                    <span className="AnnotationSidebar__Time">{formatRelative(reply.created_at)}</span>

                    {reply.author_id === myProfile.user_id && (
                      <div className="AnnotationSidebar__ReplyMenu">
                        <button
                          className="AnnotationSidebar__MenuBtn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(menuOpenId === reply.reply_id ? null : reply.reply_id);
                          }}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {menuOpenId === reply.reply_id && (
                          <div className="AnnotationSidebar__MenuDropdown">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingReplyId(reply.reply_id);
                                setMenuOpenId(null);
                              }}
                            >
                              <Pencil size={12} /> {t('common.actions.edit')}
                            </button>
                            <button
                              className="AnnotationSidebar__MenuItem--danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteReply(ann.annotation_id, reply.reply_id);
                                setMenuOpenId(null);
                              }}
                            >
                              <Trash2 size={12} /> {t('common.actions.delete')}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {editingReplyId === reply.reply_id ? (
                    <div>
                      <IssueEditor ref={editReplyRef} content={reply.content} placeholder={t('canvas.annotations.replyPlaceholder')} minHeight={60} canvasId={canvasId} />
                      <div className="AnnotationSidebar__NewActions">
                        <button
                          className="AnnotationSidebar__Btn AnnotationSidebar__Btn--secondary"
                          onClick={(e) => { e.stopPropagation(); setEditingReplyId(null); }}
                        >
                          {t('common.actions.cancel')}
                        </button>
                        <button
                          className="AnnotationSidebar__Btn AnnotationSidebar__Btn--primary"
                          onClick={(e) => { e.stopPropagation(); handleSubmitEdit(ann.annotation_id, reply.reply_id); }}
                        >
                          {t('common.actions.save')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="AnnotationSidebar__ReplyContent"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(reply.content) }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* 하단 액션 */}
            <div className="AnnotationSidebar__CardActions">
              {replyingTo === ann.annotation_id ? (
                <div className="AnnotationSidebar__ReplyEditor">
                  <IssueEditor ref={replyEditorRef} placeholder={t('canvas.annotations.replyPlaceholder')} minHeight={60} canvasId={canvasId} />
                  <div className="AnnotationSidebar__NewActions">
                    <button
                      className="AnnotationSidebar__Btn AnnotationSidebar__Btn--secondary"
                      onClick={(e) => { e.stopPropagation(); setReplyingTo(null); }}
                    >
                      {t('common.actions.cancel')}
                    </button>
                    <button
                      className="AnnotationSidebar__Btn AnnotationSidebar__Btn--primary"
                      onClick={(e) => { e.stopPropagation(); handleSubmitReply(ann.annotation_id); }}
                    >
                      {t('canvas.annotations.reply')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="AnnotationSidebar__ActionBtns">
                  <button
                    className="AnnotationSidebar__ActionBtn"
                    onClick={(e) => { e.stopPropagation(); setReplyingTo(ann.annotation_id); }}
                  >
                    {t('canvas.annotations.reply')}
                  </button>
                  {ann.status === 'open' ? (
                    <button
                      className="AnnotationSidebar__ActionBtn AnnotationSidebar__ActionBtn--resolve"
                      onClick={(e) => { e.stopPropagation(); onResolve(ann.annotation_id); }}
                      title={t('canvas.annotations.resolve')}
                    >
                      <Check size={14} /> {t('canvas.annotations.resolve')}
                    </button>
                  ) : (
                    <button
                      className="AnnotationSidebar__ActionBtn"
                      onClick={(e) => { e.stopPropagation(); onReopen(ann.annotation_id); }}
                      title={t('canvas.annotations.reopen')}
                    >
                      <RotateCcw size={14} /> {t('canvas.annotations.reopen')}
                    </button>
                  )}
                  {ann.created_by === myProfile.user_id && (
                    <button
                      className="AnnotationSidebar__ActionBtn AnnotationSidebar__ActionBtn--danger"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(ann); }}
                      title={t('common.actions.delete')}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>

      {/* 사이드바(z-index 쌓임 맥락) 밖 형제로 그려 문서 삭제 확인과 같은 층에 뜬다 */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={t('canvas.annotations.deleteThreadTitle')}
        message={t('canvas.annotations.deleteThreadConfirm', { count: deleteTarget?.replies?.length ?? 0 })}
        confirmLabel={t('common.actions.delete')}
        variant="danger"
      />
    </>
  );
}
