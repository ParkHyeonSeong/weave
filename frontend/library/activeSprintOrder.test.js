import { describe, it, expect } from 'vitest';
import { sortActiveSprints } from './activeSprintOrder';

const ids = (list) => list.map((s) => s.sprint_id);

describe('sortActiveSprints — 내 스프린트 먼저, 마감일 임박순', () => {
  it('내 태스크가 있는 스프린트가 마감일과 무관하게 위로 온다', () => {
    const out = sortActiveSprints([
      { sprint_id: 1, my_count: 0, end_date: '2026-01-01' },
      { sprint_id: 2, my_count: 3, end_date: '2026-09-01' },
    ]);
    expect(ids(out)).toEqual([2, 1]);
  });

  it('두 묶음 모두 마감일 임박순, 마감일 없는 스프린트는 묶음 맨 뒤', () => {
    const out = sortActiveSprints([
      { sprint_id: 1, my_count: 1, end_date: null },
      { sprint_id: 2, my_count: 1, end_date: '2026-09-10' },
      { sprint_id: 3, my_count: 2, end_date: '2026-08-01' },
      { sprint_id: 4, my_count: 0, end_date: '2026-09-02' },
      { sprint_id: 5, my_count: 0, end_date: null },
      { sprint_id: 6, my_count: 0, end_date: '2026-07-15' },
    ]);
    expect(ids(out)).toEqual([3, 2, 1, 6, 4, 5]);
  });

  it('마감일이 같으면 기존 순서를 유지하고 입력 배열은 바꾸지 않는다', () => {
    const input = [
      { sprint_id: 1, my_count: 0, end_date: '2026-09-01' },
      { sprint_id: 2, my_count: 0, end_date: '2026-09-01' },
    ];
    expect(ids(sortActiveSprints(input))).toEqual([1, 2]);
    expect(ids(input)).toEqual([1, 2]);
  });
});
