// 하위태스크 진행도/펼침 순수 헬퍼. React 의존 없음 → vitest(node)로 단위 테스트.
// progress 형태는 백엔드 계약과 동일: { done: <int>, total: <int> }.

/**
 * 하위태스크 행 + 브랜치 workflow status에서 진행도를 계산한다.
 *
 * 백엔드 attach_subtasks(core/model/task.py)와 같은 규칙:
 *  - category === 'cancelled' 는 분자·분모 모두 제외
 *  - category === 'done' 만 완료로 셈
 *  - 매핑에 없는 status(삭제된 커스텀 상태 등)는 분모에만 포함 — 백엔드의
 *    LEFT JOIN 결과 category=None 이 `!= 'cancelled'` 로 통과하는 것과 동일
 *
 * 상세 화면은 백엔드가 붙여주지 않는(=누락되거나 낡을 수 있는) task.subtask_progress
 * 대신 현재 task.subtasks를 원천으로 이 함수를 쓴다. 낙관적으로 갱신된 행이 그대로
 * 반영되므로 섹션 카운트·진행바·제목 배지가 같은 렌더에서 함께 움직인다.
 *
 * workflowStatuses가 아직 로드되지 않았으면 모든 행이 "알 수 없음"으로 분류돼
 * 잘못된 0/N을 잠깐 보여주게 된다. 그래서 계산 불가를 null로 알리고, 호출부는
 * null이면 진행도 UI를 감춘다.
 *
 * @param {Array<{status: string}>} subtasks
 * @param {Array<{key: string, category: string}>} workflowStatuses
 * @returns {{done: number, total: number} | null} 준비 전이면 null
 */
export function progressFromRows(subtasks, workflowStatuses) {
  if (!Array.isArray(workflowStatuses) || workflowStatuses.length === 0) return null;
  const categoryOf = {};
  workflowStatuses.forEach((ws) => { categoryOf[ws.key] = ws.category; });
  let done = 0;
  let total = 0;
  (subtasks || []).forEach((s) => {
    const category = categoryOf[s.status];
    if (category === 'cancelled') return; // 분자·분모 모두 제외
    total += 1;
    if (category === 'done') done += 1;
  });
  return { done, total };
}

export function progressLabel(progress) {
  if (!progress || !progress.total) return '';
  return `${progress.done}/${progress.total}`;
}

export function progressPercent(progress) {
  if (!progress || !progress.total) return 0;
  const pct = (progress.done / progress.total) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function isParentExpanded(expandedSet, taskId) {
  return !!expandedSet && expandedSet.has(taskId);
}
