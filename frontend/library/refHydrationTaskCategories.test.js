// 스크럼 '전날 할 일 가져오기'가 쓰는 태스크 상태 분류 조회 — 칩 하이드레이션의 /ref-status 해석(캐시·single-flight)을 감싼 export.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { axios } from '@/library/_axios';
import { resolveTaskCategories } from './refHydration';

vi.mock('@/library/_axios', () => ({ axios: { post: vi.fn(), get: vi.fn() } }));

// 모듈 캐시(30초 TTL)가 테스트 사이에 남으므로 테스트마다 다른 id를 쓴다.
const refStatus = (tasks = {}) => ({ data: { status: true, tasks, issues: {}, pages: {}, users: {} } });

beforeEach(() => {
  axios.post.mockReset();
  axios.get.mockReset();
});

describe('resolveTaskCategories', () => {
  it('응답의 status_category를 id별로 모은다', async () => {
    axios.post.mockResolvedValueOnce(refStatus({ 9101: { status_category: 'done', status: 'done' } }));
    const result = await resolveTaskCategories([9101]);
    expect(result).toEqual({ categoryById: { 9101: 'done' }, failed: false });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith('/ref-status', { task_ids: [9101], issue_ids: [], page_ids: [], user_ids: [] });
  });

  it('요청이 실패하면 failed: true', async () => {
    axios.post.mockRejectedValueOnce(new Error('offline'));
    const result = await resolveTaskCategories([9102]);
    expect(result).toEqual({ categoryById: {}, failed: true });
  });

  it('빈 배열이면 요청하지 않는다', async () => {
    const result = await resolveTaskCategories([]);
    expect(result).toEqual({ categoryById: {}, failed: false });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('여러 id를 한 번에 묻고, 같은 id가 겹쳐도 한 번만 싣는다', async () => {
    axios.post.mockResolvedValueOnce(refStatus({
      9111: { status_category: 'done', status: 'done' },
      9112: { status_category: 'in_progress', status: 'review' },
    }));
    const result = await resolveTaskCategories([9111, 9112, 9111]);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][1].task_ids).toEqual([9111, 9112]);
    expect(result).toEqual({ categoryById: { 9111: 'done', 9112: 'in_progress' }, failed: false });
  });

  it('응답에 없는 id(삭제·권한 밖)는 분류 없이 빠지고 failed는 아니다', async () => {
    axios.post.mockResolvedValueOnce(refStatus({ 9121: { status_category: 'cancelled', status: 'dropped' } }));
    const result = await resolveTaskCategories([9121, 9122]);
    expect(result).toEqual({ categoryById: { 9121: 'cancelled' }, failed: false });
  });

  it('status_category가 없으면 status로 대신한다', async () => {
    axios.post.mockResolvedValueOnce(refStatus({ 9131: { status: 'done' }, 9132: {} }));
    const result = await resolveTaskCategories([9131, 9132]);
    expect(result.categoryById).toEqual({ 9131: 'done' });
    expect(Object.keys(result.categoryById)).toEqual(['9131']); // 분류가 전혀 없는 9132는 undefined 키로도 남지 않는다
  });

  it('서버가 status: false로 답해도 실패로 본다', async () => {
    axios.post.mockResolvedValueOnce({ data: { status: false } });
    const result = await resolveTaskCategories([9141]);
    expect(result).toEqual({ categoryById: {}, failed: true });
  });

  it('칩 하이드레이션과 같은 캐시를 써서 같은 id를 다시 묻지 않는다', async () => {
    axios.post.mockResolvedValueOnce(refStatus({ 9151: { status_category: 'done', status: 'done' } }));
    await resolveTaskCategories([9151, 9152]);
    const again = await resolveTaskCategories([9151, 9152]); // 9152는 응답에 없어 '누락'으로 기억된다
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(again).toEqual({ categoryById: { 9151: 'done' }, failed: false });
  });

  it('일부 묶음만 실패하면 받은 분류는 담고 failed: true', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => 200000 + i); // 서버 한도 200개씩 → 200 + 1
    axios.post.mockImplementation(async (_url, body) => {
      if (body.task_ids.length === 1) throw new Error('network');
      return refStatus(Object.fromEntries(body.task_ids.map((id) => [id, { status_category: 'done', status: 'done' }])));
    });
    const result = await resolveTaskCategories(ids);
    expect(result.failed).toBe(true);
    expect(Object.keys(result.categoryById)).toHaveLength(200);
    expect(result.categoryById[ids[0]]).toBe('done');
    expect(result.categoryById[ids[200]]).toBeUndefined();
  });
});
