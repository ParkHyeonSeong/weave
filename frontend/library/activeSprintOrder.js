// Home 활성 스프린트 위젯 정렬:
// 내 태스크가 있는 스프린트 먼저 → 각 묶음 안에서 마감일 임박순(없으면 뒤) → 동률은 기존 순서(sort는 stable).
// end_date는 'YYYY-MM-DD' 문자열이라 문자열 비교로 날짜 순서가 된다.
const NO_END_DATE = '9999-12-31';

export function sortActiveSprints(sprints) {
  return [...sprints].sort((a, b) =>
    (b.my_count > 0) - (a.my_count > 0)
    || (a.end_date || NO_END_DATE).localeCompare(b.end_date || NO_END_DATE));
}
