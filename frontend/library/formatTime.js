// ⚠️ 이행 shim. 새 코드는 hooks/useDateFormat.js의 useDateFormat()을 쓴다.
//
// 이 파일의 함수들은 locale/timezone 인자를 받지 않으므로 **브라우저 기본 timezone**과
// 영어 문구로 동작한다. 개인 time_zone 설정을 따르지 않는다는 뜻이다.
// library/formatDateTime.js의 순수 함수에 위임하되 기본값만 채워 주므로,
// 아직 마이그레이션되지 않은 호출부가 깨지지 않는다.
//
// formatSprintRange만은 예외적으로 처음부터 올바랐다(문자열 슬라이스 → timezone 무관).
// 그대로 formatDateRange에 위임한다.
import {
  formatDateRange,
  formatMessageTime as formatMessageTimeTz,
  formatRelative as formatRelativeTz,
  formatTimestamp,
  formatTimestampYMD,
} from '@/library/formatDateTime';

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** @deprecated useDateFormat().formatMessageTime — 개인 timezone을 따르지 않는다. */
export function formatMessageTime(dateStr) {
  return formatMessageTimeTz(dateStr, { locale: 'en', timeZone: browserTimeZone() });
}

/** @deprecated useDateFormat().formatTimestampYMD — 개인 timezone을 따르지 않는다. */
export function formatYMD(iso) {
  return formatTimestampYMD(iso, { timeZone: browserTimeZone() });
}

/** @deprecated useDateFormat().formatTimestamp — 개인 timezone을 따르지 않는다. */
export function formatDateTime(iso) {
  return formatTimestamp(iso, { locale: 'en', timeZone: browserTimeZone() });
}

/** @deprecated useDateFormat().formatRelative — 개인 timezone·locale을 따르지 않는다. */
export function formatRelative(iso) {
  return formatRelativeTz(iso, { locale: 'en', timeZone: browserTimeZone() });
}

/** date-only 범위. timezone 무관이라 이행 대상이 아니다 — formatDateRange의 별칭. */
export const formatSprintRange = formatDateRange;
