// 작업 목록 탭 스프린트 섹션 헤더의 태스크 요약. React·DOM 의존 없음 → vitest(node).
//
// 기본 단위는 섹션에 보이는 행 = 상위 태스크다(하위는 부모 행 안에 접혀 있다).
// withSubtasks는 상위 + 그 하위 전부다. 백엔드 task-counts의 all_* 집합과 범위가 같아서
// 활성 스프린트에서는 홈 "진행 중 스프린트" 위젯과 같은 수가 나온다.
// 상태는 workflow_status.category 4값으로 묶는다(key는 브랜치별 사용자 정의라 묶음 기준이 못 된다).
// 막대 분할은 홈 위젯과 같은 sprintProgressSegments에 맡긴다.
import { sprintProgressSegments } from './sprintProgress';

function emptyTally() {
  return { total: 0, closed: 0, inProgress: 0, cancelled: 0 };
}

// 할 일과 알 수 없는 key는 따로 세지 않는다 — total에서 나머지를 빼면 할 일이 된다.
function addTask(tally, task, categoryOf) {
  const category = categoryOf.get(task.status);
  tally.total += 1;
  if (category === 'done' || category === 'cancelled') tally.closed += 1;
  if (category === 'cancelled') tally.cancelled += 1;
  if (category === 'in_progress') tally.inProgress += 1;
}

// sprintProgressSegments 입력 규약: done = 닫힘(done + cancelled)
function toProgress({ total, closed, inProgress, cancelled }) {
  return sprintProgressSegments({ total, done: closed, in_progress: inProgress, cancelled });
}

/**
 * @param {Array<{status: string, subtasks?: Array<{status: string}>}>} tasks 필터 전 상위 태스크
 * @param {Array<{key: string, category: string}>} workflowStatuses
 * @returns {{
 *   total: number,
 *   subtaskCount: number,
 *   topLevel: null | ReturnType<typeof sprintProgressSegments>,
 *   withSubtasks: null | ReturnType<typeof sprintProgressSegments>,
 * }} total = 상위 태스크 수(보이는 행 수), subtaskCount = 그 하위 수.
 *    workflowStatuses가 비면 분류 근거가 없어 topLevel·withSubtasks는 null이다.
 */
export function summarizeSprintTasks(tasks, workflowStatuses) {
  const list = tasks || [];
  const subtaskCount = list.reduce((n, task) => n + (task.subtasks?.length || 0), 0);
  if (!workflowStatuses?.length) {
    return { total: list.length, subtaskCount, topLevel: null, withSubtasks: null };
  }

  const categoryOf = new Map(workflowStatuses.map((s) => [s.key, s.category]));
  const top = emptyTally();
  const all = emptyTally();
  list.forEach((task) => {
    addTask(top, task, categoryOf);
    addTask(all, task, categoryOf);
    (task.subtasks || []).forEach((sub) => addTask(all, sub, categoryOf));
  });
  return { total: list.length, subtaskCount, topLevel: toProgress(top), withSubtasks: toProgress(all) };
}
