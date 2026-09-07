import { describe, it, expect } from 'vitest';
import {
  progressFromRows, progressLabel, progressPercent, isParentExpanded,
} from './subtaskProgress.js';

// 브랜치 기본 4상태 + 커스텀 상태(리뷰=진행 중, 배포완료=done) — 상태 key가 아니라
// category로 판정한다는 계약을 커스텀 key로 못박는다.
const STATUSES = [
  { key: 'todo', category: 'todo' },
  { key: 'in_progress', category: 'in_progress' },
  { key: 'in_review', category: 'in_progress' },
  { key: 'shipped', category: 'done' },
  { key: 'done', category: 'done' },
  { key: 'cancelled', category: 'cancelled' },
];

describe('progressFromRows', () => {
  it('커스텀 status라도 category=done이면 완료로 센다', () => {
    const rows = [{ status: 'shipped' }, { status: 'done' }, { status: 'in_review' }];
    expect(progressFromRows(rows, STATUSES)).toEqual({ done: 2, total: 3 });
  });

  it('cancelled는 분자·분모 모두에서 제외한다', () => {
    const rows = [{ status: 'done' }, { status: 'cancelled' }, { status: 'todo' }];
    expect(progressFromRows(rows, STATUSES)).toEqual({ done: 1, total: 2 });
  });

  it('전부 cancelled면 total 0', () => {
    const rows = [{ status: 'cancelled' }, { status: 'cancelled' }];
    expect(progressFromRows(rows, STATUSES)).toEqual({ done: 0, total: 0 });
  });

  it('done과 진행 중이 섞이면 done만 센다', () => {
    const rows = [
      { status: 'done' }, { status: 'in_progress' }, { status: 'todo' },
      { status: 'shipped' }, { status: 'in_review' },
    ];
    expect(progressFromRows(rows, STATUSES)).toEqual({ done: 2, total: 5 });
  });

  it('알 수 없는 status는 total에만 포함(백엔드 LEFT JOIN category=None과 동일)', () => {
    const rows = [{ status: 'done' }, { status: 'ghost_status' }];
    expect(progressFromRows(rows, STATUSES)).toEqual({ done: 1, total: 2 });
  });

  it('빈 rows → 0/0', () => {
    expect(progressFromRows([], STATUSES)).toEqual({ done: 0, total: 0 });
    expect(progressFromRows(null, STATUSES)).toEqual({ done: 0, total: 0 });
    expect(progressFromRows(undefined, STATUSES)).toEqual({ done: 0, total: 0 });
  });

  it('workflowStatuses 미로딩이면 null — 잘못된 0/N을 보여주지 않는다', () => {
    const rows = [{ status: 'done' }, { status: 'todo' }];
    expect(progressFromRows(rows, [])).toBeNull();
    expect(progressFromRows(rows, null)).toBeNull();
    expect(progressFromRows(rows, undefined)).toBeNull();
  });
});

describe('progressLabel', () => {
  it('done/total 문자열', () => {
    expect(progressLabel({ done: 2, total: 5 })).toBe('2/5');
  });
  it('하위 없음(total 0) → 빈 문자열', () => {
    expect(progressLabel({ done: 0, total: 0 })).toBe('');
    expect(progressLabel(null)).toBe('');
    expect(progressLabel(undefined)).toBe('');
  });
});

describe('progressPercent', () => {
  it('반올림된 퍼센트', () => {
    expect(progressPercent({ done: 1, total: 3 })).toBe(33);
    expect(progressPercent({ done: 3, total: 4 })).toBe(75);
  });
  it('total 0 → 0 (0 나눗셈 방지)', () => {
    expect(progressPercent({ done: 0, total: 0 })).toBe(0);
    expect(progressPercent(null)).toBe(0);
  });
  it('진행도 미준비(null)도 0', () => {
    expect(progressPercent(progressFromRows([{ status: 'done' }], []))).toBe(0);
  });
  it('0..100 클램프', () => {
    expect(progressPercent({ done: 5, total: 4 })).toBe(100);
  });
});

describe('isParentExpanded', () => {
  it('Set에 포함된 parent id만 true', () => {
    const s = new Set([10, 20]);
    expect(isParentExpanded(s, 10)).toBe(true);
    expect(isParentExpanded(s, 99)).toBe(false);
    expect(isParentExpanded(null, 10)).toBe(false);
  });
});
