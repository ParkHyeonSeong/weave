import { describe, it, expect } from 'vitest';
import { sprintProgressSegments } from './sprintProgress.js';

// 입력은 위젯 sprint 객체와 같은 키: done = all_done_count(= done + cancelled).
const percents = (r) => r.segments.map((s) => s.percent);

describe('sprintProgressSegments', () => {
  it('섞인 상태: done(취소 제외) → cancelled → in_progress 순서로 나누고 나머지는 todo', () => {
    const r = sprintProgressSegments({ total: 10, done: 6, in_progress: 3, cancelled: 1 });
    expect(r.counts).toEqual({ done: 5, cancelled: 1, inProgress: 3, todo: 1 });
    expect(r.segments.map((s) => s.category)).toEqual(['done', 'cancelled', 'in_progress']);
    expect(percents(r)).toEqual([50, 10, 30]);
  });

  it('나눠떨어지지 않는 비율도 반올림하지 않는다', () => {
    const r = sprintProgressSegments({ total: 13, done: 6, in_progress: 3, cancelled: 1 });
    expect(r.counts).toEqual({ done: 5, cancelled: 1, inProgress: 3, todo: 4 });
    expect(r.segments[0].percent).toBeCloseTo((5 / 13) * 100, 10);
  });

  it('total=0이면 모든 비율 0', () => {
    const r = sprintProgressSegments({ total: 0, done: 0, in_progress: 0, cancelled: 0 });
    expect(r.counts).toEqual({ done: 0, cancelled: 0, inProgress: 0, todo: 0 });
    expect(percents(r)).toEqual([0, 0, 0]);
  });

  it('전부 done이면 done 100%', () => {
    const r = sprintProgressSegments({ total: 4, done: 4, in_progress: 0, cancelled: 0 });
    expect(percents(r)).toEqual([100, 0, 0]);
  });

  it('전부 cancelled면 done 0 · cancelled 100%', () => {
    const r = sprintProgressSegments({ total: 3, done: 3, in_progress: 0, cancelled: 3 });
    expect(r.counts).toEqual({ done: 0, cancelled: 3, inProgress: 0, todo: 0 });
    expect(percents(r)).toEqual([0, 100, 0]);
  });

  it('새 필드가 없는 응답(구 백엔드)은 취소·진행 중 0으로 보고 완료만 칠한다', () => {
    const r = sprintProgressSegments({ total: 4, done: 1 });
    expect(r.counts).toEqual({ done: 1, cancelled: 0, inProgress: 0, todo: 3 });
    expect(percents(r)).toEqual([25, 0, 0]);
  });
});
