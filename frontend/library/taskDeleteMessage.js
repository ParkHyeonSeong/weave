import i18next from '@/library/i18n';

/**
 * 태스크 삭제 cascade 경고 메시지 공용 헬퍼.
 *
 * cascade 삭제는 cancelled 포함 모든 하위를 지우지만 subtask_progress.total은
 * cancelled를 제외하므로, 개수는 반드시 전체 자식 배열(task.subtasks)에서만 센다.
 * subtask_progress로 폴백하면 cancelled 만큼 적게 세서 경고가 누락된다.
 */
export function subtaskCount(task) {
  return Array.isArray(task?.subtasks) ? task.subtasks.length : 0;
}

/**
 * @param {object} task - subtasks 전체 배열을 가진 태스크
 * @param {{ prefix: string, t?: Function }} opts - 호출부별 확인 문구 + 번역 함수(useTranslation의 t)
 * @returns {string} prefix + (하위가 있으면) cascade 경고
 *
 * t를 넘기면 그 t로, 없으면 i18next 인스턴스로 현재 언어의 cascade 경고(branchTasks.deleteCascade)를
 * 붙인다 — 어느 경로든 하드코딩 언어가 새지 않는다(errorText.js와 같은 규약).
 */
export function taskDeleteMessage(task, { prefix, t }) {
  const n = subtaskCount(task);
  if (n > 0) {
    const translate = t || ((key, opts) => i18next.t(key, opts));
    const cascade = translate('branchTasks.deleteCascade', { count: n });
    return `${prefix} ${cascade}`;
  }
  return prefix;
}
