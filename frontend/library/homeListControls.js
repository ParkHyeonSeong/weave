// 앱 홈 목록 가공(숨김→필터→검색→정렬)과 필터 헬퍼. 순수 함수만 — React 의존 없음.

const numOr = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const dateMs = (v) => {
  if (!v) return null;
  const ms = new Date(v).getTime();
  return Number.isNaN(ms) ? null : ms;
};

// 정렬 비교함수 팩토리 (null은 항상 마지막).
export const byTextAsc = (field) => (a, b) =>
  String(a[field] ?? '').localeCompare(String(b[field] ?? ''), 'ko');

export const byNumberDesc = (field) => (a, b) => {
  const x = numOr(a[field]);
  const y = numOr(b[field]);
  if (x === y) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return y - x;
};

export const byDateDesc = (field) => (a, b) => {
  const x = dateMs(a[field]);
  const y = dateMs(b[field]);
  if (x === y) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return y - x;
};

// 모든 앱 공통 "내 역할" 필터 그룹. (track은 owner/editor/viewer, 나머지 admin/member)
// 라벨은 catalog(common.roleFilter.*)에서 오므로 호출부가 t를 넘겨 만든다 — 각 앱 홈의
// buildXControls(t) 안에서 useMemo([t])로 호출돼 언어가 바뀔 때만 다시 만들어진다.
export function roleGroup(t) {
  return {
    key: 'role',
    label: t('common.roleFilter.label'),
    // NOTE: options[0] must be the "all / no-filter" 기본값 (initialFilters/countActiveFilters가 이를 기준으로 함)
    options: [
      { value: 'all', label: t('common.roleFilter.all'), test: () => true },
      { value: 'owner', label: t('common.roleFilter.owner'), test: (it) => ['admin', 'owner'].includes(it.my_role) },
      { value: 'member', label: t('common.roleFilter.member'), test: (it) => !!it.my_role && !['admin', 'owner'].includes(it.my_role) },
    ],
  };
}

export function initialFilters(filterConfig) {
  const f = {};
  for (const g of filterConfig.groups) f[g.key] = g.options[0].value;
  if (filterConfig.showHidden) f.showHidden = false;
  return f;
}

export const resetFilters = initialFilters;

export function countActiveFilters(filters, filterConfig) {
  let n = 0;
  for (const g of filterConfig.groups) {
    const val = filters[g.key] ?? g.options[0].value;
    if (val !== g.options[0].value) n += 1;
  }
  if (filterConfig.showHidden && filters.showHidden) n += 1;
  return n;
}

export function applyFilters(items, filters, filterConfig) {
  return items.filter((it) =>
    filterConfig.groups.every((g) => {
      const val = filters[g.key] ?? g.options[0].value;
      const opt = g.options.find((o) => o.value === val) || g.options[0];
      return opt.test(it);
    }),
  );
}

export function processHomeList({
  items, isHidden, hiddenApp, idField,
  filters, filterConfig, query, queryFields, sortKey, sortOptions,
}) {
  let out = Array.isArray(items) ? items : [];
  if (!filters.showHidden) {
    out = out.filter((it) => !isHidden(hiddenApp, it[idField]));
  }
  out = applyFilters(out, filters, filterConfig);
  const q = (query || '').trim().toLowerCase();
  if (q) {
    out = out.filter((it) => queryFields.some((f) => String(it[f] ?? '').toLowerCase().includes(q)));
  }
  const opt = sortOptions.find((o) => o.key === sortKey) || sortOptions[0];
  return [...out].sort(opt.compare);
}
