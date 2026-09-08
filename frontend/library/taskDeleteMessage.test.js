import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import i18next from './i18n';
import { subtaskCount, taskDeleteMessage } from './taskDeleteMessage.js';

describe('subtaskCount', () => {
  it('subtasks 배열 길이를 센다 (cancelled 포함)', () => {
    expect(subtaskCount({ subtasks: [{}, {}, {}] })).toBe(3);
  });
  it('subtasks 없으면 0', () => {
    expect(subtaskCount({})).toBe(0);
    expect(subtaskCount(null)).toBe(0);
    expect(subtaskCount(undefined)).toBe(0);
  });
  it('subtask_progress.total로 폴백하지 않는다 (cancelled 누락 방지)', () => {
    // subtasks 배열이 없으면 progress.total이 있어도 0 — 경고 미표시
    expect(subtaskCount({ subtask_progress: { done: 1, total: 5 } })).toBe(0);
  });
  it('subtasks가 progress.total보다 클 때 subtasks 길이를 쓴다', () => {
    // cancelled 2개 포함 → subtasks 5, progress.total 3. cascade 기준은 5.
    expect(subtaskCount({
      subtasks: [{}, {}, {}, {}, {}],
      subtask_progress: { done: 1, total: 3 },
    })).toBe(5);
  });
});

describe('taskDeleteMessage', () => {
  // 언어별 기대 문구는 카탈로그(branchTasks.deleteCascade_*)에서 온다 — 하드코딩 언어가 없다는 계약.
  const original = i18next.language;
  beforeAll(async () => { await i18next.changeLanguage('en'); });
  afterAll(async () => { await i18next.changeLanguage(original); });

  it('하위 있으면 cascade 경고를 prefix 뒤에 붙인다 (t 없으면 i18next 현재 언어)', () => {
    expect(taskDeleteMessage(
      { subtasks: [{}, {}] },
      { prefix: 'Delete X-1?' },
    )).toBe('Delete X-1? Its 2 subtasks will also be deleted.');
  });
  it('t를 넘기면 그 t로 현재 언어의 cascade 경고를 붙인다', () => {
    const calls = [];
    const t = (key, opts) => { calls.push([key, opts]); return `<${key}:${opts.count}>`; };
    expect(taskDeleteMessage({ subtasks: [{}] }, { prefix: 'P', t }))
      .toBe('P <branchTasks.deleteCascade:1>');
    expect(calls).toEqual([['branchTasks.deleteCascade', { count: 1 }]]);
  });
  it('언어를 ko로 바꾸면 t 없이도 한국어 문구가 붙는다 (한국어 하드코딩 fallback 없음)', async () => {
    await i18next.changeLanguage('ko');
    try {
      expect(taskDeleteMessage(
        { subtasks: [{}, {}] },
        { prefix: 'X-1 태스크를 삭제하시겠습니까?' },
      )).toBe('X-1 태스크를 삭제하시겠습니까? 하위태스크 2개도 함께 삭제됩니다.');
    } finally {
      await i18next.changeLanguage('en');
    }
  });
  it('하위 없으면 prefix만 반환', () => {
    expect(taskDeleteMessage(
      { subtasks: [] },
      { prefix: 'Delete X-1?' },
    )).toBe('Delete X-1?');
  });
  it('subtask_progress.total만 있고 subtasks 없으면 경고 미표시 (폴백 금지)', () => {
    expect(taskDeleteMessage(
      { subtask_progress: { done: 0, total: 4 } },
      { prefix: 'Delete "AB-3 - title"? This cannot be undone.' },
    )).toBe('Delete "AB-3 - title"? This cannot be undone.');
  });
});
