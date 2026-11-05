// Scrum 화면이 쓰는 순수 계산 함수 (요일·열 폭·회고 마감).
// 오늘은 항상 workspace 기준 'YYYY-MM-DD' 문자열로 받는다 — 브라우저 시계·개인 시간대를 쓰지 않는다.
import { isoWeekOfDateOnly } from './isoWeek.js';
import { parseDateOnly, diffDateOnlyDays } from './formatDateTime.js';

// 보드 요일 칸 번호(월~금 = 0~4)와 요일 이름 i18n 키 — 짧은 이름(월)·긴 이름(월요일).
export const WEEKDAYS = [0, 1, 2, 3, 4];
export const WEEKDAY_KEYS = ['scrum.grid.mon', 'scrum.grid.tue', 'scrum.grid.wed', 'scrum.grid.thu', 'scrum.grid.fri'];
export const WEEKDAY_LONG_KEYS = ['scrum.grid.monLong', 'scrum.grid.tueLong', 'scrum.grid.wedLong', 'scrum.grid.thuLong', 'scrum.grid.friLong'];

// 보드 요일 칸 번호: 월~금 0~4, 토·일은 금요일(4).
// Date.UTC로 해석하므로 실행 환경의 시간대가 요일을 바꾸지 않는다.
export function todayDayIndex(todayStr) {
  const p = parseDateOnly(todayStr);
  if (!p) return 0;                          // 오늘을 모르면 NaN 대신 월요일
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();   // 0(일)~6(토)
  return dow === 0 || dow === 6 ? 4 : dow - 1;
}

// 오늘이 평일(월~금)인가. 보드의 '오늘' 표시는 평일에만 붙는다 —
// 주말에는 금요일을 고르지만(todayDayIndex) 그날을 '오늘'이라 하지 않는다.
export function isWeekday(todayStr) {
  const p = parseDateOnly(todayStr);
  if (!p) return false;
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();   // 0(일)~6(토)
  return dow >= 1 && dow <= 5;
}

// 주를 열 때 처음 선택할 요일: 오늘이 그 ISO 주(연도·주 번호 모두)면 오늘, 아니면 월요일.
export function initialSelectedDay(todayStr, isoYear, isoWeek) {
  const current = isoWeekOfDateOnly(todayStr);   // 오늘을 모르면 null → 월요일
  if (!current || current.isoYear !== isoYear || current.isoWeek !== isoWeek) return 0;
  return todayDayIndex(todayStr);
}

// 한 주 보기의 열 폭: 라벨 열 + 월~금 5열.
// 넓게 보는 요일 > 내용이 있는 요일 > 비어 있는 요일 순으로 넓다.
export function weekColumnTemplate(focusDay, dayHasContent, labelWidth = 84) {
  const days = Array.from({ length: 5 }, (_, i) => {
    if (i === focusDay) return 'minmax(240px, 2.3fr)';
    if (dayHasContent?.[i]) return 'minmax(110px, 1fr)';
    return 'minmax(72px, 0.55fr)';
  });
  return [`${labelWidth}px`, ...days].join(' ');
}

// 회고 마감 표시용 값. 현재 회고가 아니거나 날짜를 모르면 null.
// 일수는 마감일 - 오늘의 달력 날짜 차이다.
export function retroDeadline(periodEnd, todayStr, isCurrent) {
  if (!isCurrent) return null;
  const days = diffDateOnlyDays(todayStr, periodEnd);
  if (days === null) return null;
  if (days > 0) return { kind: 'remaining', days };
  if (days === 0) return { kind: 'today' };
  return { kind: 'passed' };
}
