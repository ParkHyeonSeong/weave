import { useState, useEffect, useCallback } from 'react';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import i18next from '@/library/i18n';
import { showToast } from '@/components/Layout/Toast';

export default function useAnnotations(canvasId, pageId) {
  const [annotations, setAnnotations] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAnnotations = useCallback(async () => {
    if (!canvasId || !pageId) return;
    try {
      const res = await axios.get(`/canvases/${canvasId}/pages/${pageId}/annotations`);
      if (res.data.status) {
        setAnnotations(res.data.annotations);
      }
    } catch {}
    setLoading(false);
  }, [canvasId, pageId]);

  useEffect(() => {
    setLoading(true);
    fetchAnnotations();
  }, [fetchAnnotations]);

  // WebSocket 실시간 업데이트 수신
  useEffect(() => {
    if (!canvasId || !pageId) return;
    const handler = (e) => {
      const data = e.detail;
      if (data.type === 'canvas_annotation' && String(data.page_id) === String(pageId)) {
        fetchAnnotations();
      }
    };
    window.addEventListener('chat:ws_message', handler);
    return () => window.removeEventListener('chat:ws_message', handler);
  }, [canvasId, pageId, fetchAnnotations]);

  const createAnnotation = useCallback(async (data) => {
    if (!canvasId || !pageId) return null;
    try {
      const res = await axios.post(`/canvases/${canvasId}/pages/${pageId}/annotations`, data);
      if (res.data.status) {
        await fetchAnnotations();
        return res.data.annotation_id;
      }
    } catch {}
    return null;
  }, [canvasId, pageId, fetchAnnotations]);

  const resolveAnnotation = useCallback(async (annotationId) => {
    try {
      const res = await axios.patch(
        `/canvases/${canvasId}/pages/${pageId}/annotations/${annotationId}`,
        { status: 'resolved' }
      );
      if (res.data.status) {
        setAnnotations((prev) =>
          prev.map((a) => a.annotation_id === annotationId
            ? { ...a, status: 'resolved' }
            : a
          )
        );
      }
    } catch {}
  }, [canvasId, pageId]);

  const reopenAnnotation = useCallback(async (annotationId) => {
    try {
      const res = await axios.patch(
        `/canvases/${canvasId}/pages/${pageId}/annotations/${annotationId}`,
        { status: 'open' }
      );
      if (res.data.status) {
        setAnnotations((prev) =>
          prev.map((a) => a.annotation_id === annotationId
            ? { ...a, status: 'open', resolved_by: null, resolved_at: null }
            : a
          )
        );
      }
    } catch {}
  }, [canvasId, pageId]);

  const deleteAnnotation = useCallback(async (annotationId) => {
    try {
      const res = await axios.delete(
        `/canvases/${canvasId}/pages/${pageId}/annotations/${annotationId}`
      );
      if (res.data.status) {
        setAnnotations((prev) => prev.filter((a) => a.annotation_id !== annotationId));
      }
    } catch {}
  }, [canvasId, pageId]);

  const createReply = useCallback(async (annotationId, content) => {
    try {
      const res = await axios.post(
        `/canvases/${canvasId}/pages/${pageId}/annotations/${annotationId}/replies`,
        { content }
      );
      if (res.data.status) {
        await fetchAnnotations();
        return res.data.reply_id;
      }
    } catch {}
    return null;
  }, [canvasId, pageId, fetchAnnotations]);

  // 성공하면 true. 실패하면 이유를 토스트로 알리고 false — 사이드바는 편집창과 고친 내용을 그대로 둔다
  const updateReply = useCallback(async (annotationId, replyId, content) => {
    let failure = null;
    try {
      const res = await axios.patch(
        `/canvases/${canvasId}/pages/${pageId}/annotations/${annotationId}/replies/${replyId}`,
        { content }
      );
      if (res.data.status) {
        await fetchAnnotations();
        return true;
      }
      failure = getError(res.data);
    } catch {}
    showToast(errorText(failure?.code, failure?.category) ?? i18next.t('canvas.annotations.editFailed'), 'error');
    return false;
  }, [canvasId, pageId, fetchAnnotations]);

  const deleteReply = useCallback(async (annotationId, replyId) => {
    try {
      const res = await axios.delete(
        `/canvases/${canvasId}/pages/${pageId}/annotations/${annotationId}/replies/${replyId}`
      );
      if (res.data.status) {
        await fetchAnnotations();
      }
    } catch {}
  }, [canvasId, pageId, fetchAnnotations]);

  return {
    annotations,
    loading,
    fetchAnnotations,
    createAnnotation,
    resolveAnnotation,
    reopenAnnotation,
    deleteAnnotation,
    createReply,
    updateReply,
    deleteReply,
  };
}
