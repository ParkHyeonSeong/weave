import { useState, useEffect, useCallback } from 'react';
import { axios } from '@/library/_axios';
import { getErrorCode, getError } from '@/library/errorCode';

/**
 * Task 댓글 데이터 hook.
 * - 마운트/order 변경 시 자동 fetch (unmount race guard 포함)
 * - create/update/delete 후 단순 refetch (optimistic 아님)
 * - order: 'asc' | 'desc' | null — 서버 정렬 방향. null이면 (선호 로드 전) fetch를 미룬다.
 *   렌더 순서의 최종 결정은 library/taskCommentTree.buildTree.
 */
export default function useTaskComments(branchId, taskId, order = 'asc') {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const base = branchId && taskId
    ? `/branches/${branchId}/tasks/${taskId}/comments`
    : null;

  // mount-time auto-fetch with unmount cancel guard
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!base || order == null) return;
      setLoading(true);
      try {
        const res = await axios.get(base, { params: { order } });
        if (cancelled) return;
        if (res.data?.status) {
          setComments(res.data.comments || []);
          setError(null);
        } else {
          setError(getErrorCode(res.data) ?? 'FETCH_FAILED');
        }
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || 'FETCH_ERROR');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [base, order]);

  // explicit refetch — callers can call this after external changes
  const fetchComments = useCallback(async () => {
    if (!base || order == null) return;
    setLoading(true);
    try {
      const res = await axios.get(base, { params: { order } });
      if (res.data?.status) {
        setComments(res.data.comments || []);
        setError(null);
      } else {
        setError(getErrorCode(res.data) ?? 'FETCH_FAILED');
      }
    } catch (e) {
      setError(e?.message || 'FETCH_ERROR');
    } finally {
      setLoading(false);
    }
  }, [base, order]);

  // private helper: run a mutator fn, validate response, then refetch
  // 실패는 코드(message·code)와 분류(category)를 실어 던진다 — 입력기가 errorText(code, category)로 푼다
  const _mutate = useCallback(async (fn, fallback) => {
    if (!base) throw new Error('NO_TASK');
    const res = await fn();
    if (!res.data?.status) {
      const { code, category } = getError(res.data);
      throw Object.assign(new Error(code ?? fallback), { code: code ?? fallback, category });
    }
    await fetchComments();
    return res.data;
  }, [base, fetchComments]);

  const createComment = useCallback(
    (content, parentCommentId = null) =>
      _mutate(
        () => axios.post(base, { content, parent_comment_id: parentCommentId }),
        'CREATE_FAILED',
      ).then((d) => d.comment),
    [_mutate, base],
  );

  const updateComment = useCallback(
    (commentId, content) =>
      _mutate(
        () => axios.patch(`${base}/${commentId}`, { content }),
        'UPDATE_FAILED',
      ).then((d) => d.comment),
    [_mutate, base],
  );

  const deleteComment = useCallback(
    (commentId) =>
      _mutate(
        () => axios.delete(`${base}/${commentId}`),
        'DELETE_FAILED',
      ).then(() => true),
    [_mutate, base],
  );

  return {
    comments,
    loading,
    error,
    refetch: fetchComments,
    createComment,
    updateComment,
    deleteComment,
  };
}
