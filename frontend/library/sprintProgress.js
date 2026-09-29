// 홈 Active Sprints 위젯의 상태 카테고리별 분할 진행 바 계산. React·DOM 의존 없음 → vitest(node).
// 입력 키는 위젯의 sprint 객체와 같고, 값은 task-counts 응답(하위태스크 포함 all_* 집합)이다:
//   total = all_total_count, done = all_done_count(= done + cancelled, "닫힘"),
//   in_progress = all_in_progress_count, cancelled = all_cancelled_count.
// 네 값은 백엔드 한 쿼리의 같은 집합에서 세므로 cancelled ≤ done, done + in_progress ≤ total이 보장된다.
// 바는 왼쪽부터 done(취소 제외) → cancelled → in_progress 순으로 칠하고, 남은 회색 트랙이 todo다.
// segment.category는 themePalette.statusCategoryVar()의 키와 같다.

/**
 * @param {{total?: number, done?: number, in_progress?: number, cancelled?: number}} sprint
 * @returns {{
 *   counts: {done: number, cancelled: number, inProgress: number, todo: number},
 *   segments: Array<{category: 'done'|'cancelled'|'in_progress', percent: number}>,
 * }} percent는 반올림하지 않은 0~100 값
 */
export function sprintProgressSegments({ total = 0, done = 0, in_progress = 0, cancelled = 0 }) {
  const counts = {
    done: done - cancelled,
    cancelled,
    inProgress: in_progress,
    todo: total - done - in_progress,
  };
  const percent = (n) => (total > 0 ? (n / total) * 100 : 0);
  const segments = [
    ['done', counts.done],
    ['cancelled', cancelled],
    ['in_progress', in_progress],
  ].map(([category, n]) => ({ category, percent: percent(n) }));
  return { counts, segments };
}
