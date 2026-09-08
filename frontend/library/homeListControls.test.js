import { describe, it, expect } from 'vitest';
import {
  byTextAsc, byNumberDesc, byDateDesc, roleGroup,
  initialFilters, resetFilters, countActiveFilters, applyFilters, processHomeList,
} from './homeListControls.js';

// ROLE_GROUP은 라벨을 catalog에서 받는 팩토리 roleGroup(t)가 됐다 — 여기서는 identity t로
// 만들어 라벨이 키 문자열('common.roleFilter.*')인 그룹으로 헬퍼 계약만 검증한다.
const ROLE_GROUP = roleGroup((k) => k);

describe('comparators', () => {
  it('byTextAsc: 한글 오름차순', () => {
    const arr = [{ n: '다' }, { n: '가' }, { n: '나' }].sort(byTextAsc('n'));
    expect(arr.map((x) => x.n)).toEqual(['가', '나', '다']);
  });
  it('byNumberDesc: 내림차순, null 마지막', () => {
    const arr = [{ v: 3 }, { v: null }, { v: 10 }, { v: 1 }].sort(byNumberDesc('v'));
    expect(arr.map((x) => x.v)).toEqual([10, 3, 1, null]);
  });
  it('byDateDesc: 최신 먼저, null 마지막', () => {
    const arr = [{ d: '2026-01-01' }, { d: null }, { d: '2026-06-01' }].sort(byDateDesc('d'));
    expect(arr.map((x) => x.d)).toEqual(['2026-06-01', '2026-01-01', null]);
  });
  it('byNumberDesc: 빈 문자열도 마지막', () => {
    const arr = [{ v: '' }, { v: 5 }, { v: 2 }].sort(byNumberDesc('v'));
    expect(arr.map((x) => x.v)).toEqual([5, 2, '']);
  });
  it('byDateDesc: 잘못된 날짜 문자열은 마지막', () => {
    const arr = [{ d: 'garbage' }, { d: '2026-01-01' }, { d: '2026-06-01' }].sort(byDateDesc('d'));
    expect(arr.map((x) => x.d)).toEqual(['2026-06-01', '2026-01-01', 'garbage']);
  });
});

describe('ROLE_GROUP', () => {
  const test = (v) => ROLE_GROUP.options.find((o) => o.value === v).test;
  it('owner = admin/owner', () => {
    expect(test('owner')({ my_role: 'admin' })).toBe(true);
    expect(test('owner')({ my_role: 'owner' })).toBe(true);
    expect(test('owner')({ my_role: 'editor' })).toBe(false);
  });
  it('member = non-null non-owner', () => {
    expect(test('member')({ my_role: 'editor' })).toBe(true);
    expect(test('member')({ my_role: 'admin' })).toBe(false);
    expect(test('member')({ my_role: null })).toBe(false);
  });
});

describe('filter helpers', () => {
  const cfg = {
    groups: [ROLE_GROUP, {
      key: 'sprint', label: '스프린트', options: [
        { value: 'all', label: '전체', test: () => true },
        { value: 'yes', label: '있음', test: (it) => it.active_sprint_count > 0 },
      ],
    }],
    showHidden: true,
  };
  it('initialFilters: 각 그룹 첫 옵션 + showHidden false', () => {
    expect(initialFilters(cfg)).toEqual({ role: 'all', sprint: 'all', showHidden: false });
  });
  it('countActiveFilters: 기본 아닌 그룹 + showHidden', () => {
    expect(countActiveFilters({ role: 'all', sprint: 'all', showHidden: false }, cfg)).toBe(0);
    expect(countActiveFilters({ role: 'owner', sprint: 'all', showHidden: false }, cfg)).toBe(1);
    expect(countActiveFilters({ role: 'owner', sprint: 'yes', showHidden: true }, cfg)).toBe(3);
  });
  it('resetFilters = initialFilters', () => {
    expect(resetFilters(cfg)).toEqual(initialFilters(cfg));
  });
  it('applyFilters: 모든 그룹 AND', () => {
    const items = [
      { my_role: 'admin', active_sprint_count: 1 },
      { my_role: 'editor', active_sprint_count: 0 },
    ];
    const out = applyFilters(items, { role: 'owner', sprint: 'yes' }, cfg);
    expect(out).toHaveLength(1);
    expect(out[0].my_role).toBe('admin');
  });
});

describe('processHomeList', () => {
  const cfg = { groups: [ROLE_GROUP], showHidden: true };
  const base = {
    isHidden: (app, id) => id === 99,
    hiddenApp: 'branches', idField: 'branch_id',
    filterConfig: cfg, queryFields: ['branch_name'],
    sortOptions: [{ key: 'name', label: '이름순', compare: byTextAsc('branch_name') }],
    sortKey: 'name',
  };
  const items = [
    { branch_id: 1, branch_name: '다', my_role: 'admin' },
    { branch_id: 2, branch_name: '가', my_role: 'member' },
    { branch_id: 99, branch_name: '숨김', my_role: 'admin' },
  ];
  it('숨김 제외 + 이름 정렬', () => {
    const out = processHomeList({ ...base, items, filters: { role: 'all', showHidden: false }, query: '' });
    expect(out.map((x) => x.branch_name)).toEqual(['가', '다']);
  });
  it('showHidden true면 숨김 포함', () => {
    const out = processHomeList({ ...base, items, filters: { role: 'all', showHidden: true }, query: '' });
    expect(out).toHaveLength(3);
  });
  it('query는 queryFields로 필터', () => {
    const out = processHomeList({ ...base, items, filters: { role: 'all', showHidden: false }, query: '가' });
    expect(out.map((x) => x.branch_name)).toEqual(['가']);
  });
  it('role 필터 적용', () => {
    const out = processHomeList({ ...base, items, filters: { role: 'member', showHidden: false }, query: '' });
    expect(out.map((x) => x.branch_name)).toEqual(['가']);
  });
});
