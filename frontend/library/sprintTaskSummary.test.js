import { describe, it, expect } from 'vitest';
import { summarizeSprintTasks } from './sprintTaskSummary.js';

// 상태 key는 브랜치마다 사용자 정의이고 category 4값만 고정이다 — key ≠ category인 상태를 섞는다.
const WORKFLOW = [
  { key: 'todo', category: 'todo' },
  { key: 'review', category: 'in_progress' },
  { key: 'in_progress', category: 'in_progress' },
  { key: 'done', category: 'done' },
  { key: 'wontfix', category: 'cancelled' },
];
const task = (status, subtasks = []) => ({ status, subtasks });
const percents = (progress) => progress.segments.map((s) => s.percent);

describe('summarizeSprintTasks', () => {
  it('상위 태스크를 category로 나눠 센다 (key ≠ category 포함)', () => {
    const s = summarizeSprintTasks(
      [task('done'), task('wontfix'), task('review'), task('in_progress'), task('todo')],
      WORKFLOW,
    );
    expect(s.total).toBe(5);
    expect(s.topLevel.counts).toEqual({ done: 1, cancelled: 1, inProgress: 2, todo: 1 });
    expect(percents(s.topLevel)).toEqual([20, 20, 40]);
  });

  it('하위태스크는 topLevel에 안 들어가고 withSubtasks에만 들어간다', () => {
    const s = summarizeSprintTasks(
      [task('review', [{ status: 'done' }, { status: 'done' }, { status: 'todo' }]), task('todo')],
      WORKFLOW,
    );
    expect(s.total).toBe(2);
    expect(s.subtaskCount).toBe(3);
    expect(s.topLevel.counts).toEqual({ done: 0, cancelled: 0, inProgress: 1, todo: 1 });
    expect(s.withSubtasks.counts).toEqual({ done: 2, cancelled: 0, inProgress: 1, todo: 2 });
  });

  it('알 수 없는 status key는 할 일로 센다', () => {
    const s = summarizeSprintTasks([task('ghost', [{ status: 'ghost' }]), task('done')], WORKFLOW);
    expect(s.topLevel.counts).toEqual({ done: 1, cancelled: 0, inProgress: 0, todo: 1 });
    expect(s.withSubtasks.counts).toEqual({ done: 1, cancelled: 0, inProgress: 0, todo: 2 });
  });

  it('workflowStatuses가 비면 분류 없이 개수만 준다', () => {
    const s = summarizeSprintTasks([task('done', [{ status: 'done' }])], []);
    expect(s).toEqual({ total: 1, subtaskCount: 1, topLevel: null, withSubtasks: null });
  });

  it('태스크가 없으면 0으로 채운다', () => {
    const s = summarizeSprintTasks([], WORKFLOW);
    expect(s.total).toBe(0);
    expect(s.subtaskCount).toBe(0);
    expect(s.topLevel.counts).toEqual({ done: 0, cancelled: 0, inProgress: 0, todo: 0 });
    expect(percents(s.topLevel)).toEqual([0, 0, 0]);
  });

  it('null·undefined 입력과 subtasks 키가 없는 태스크도 안전하다', () => {
    expect(summarizeSprintTasks(undefined, undefined))
      .toEqual({ total: 0, subtaskCount: 0, topLevel: null, withSubtasks: null });
    const s = summarizeSprintTasks([{ status: 'done' }], WORKFLOW);
    expect(s.subtaskCount).toBe(0);
    expect(s.withSubtasks.counts).toEqual({ done: 1, cancelled: 0, inProgress: 0, todo: 0 });
  });
});
