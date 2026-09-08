// ISO-8601 주 계산 유틸 (월요일 시작)
export function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;            // 1(월)~7(일)
  d.setUTCDate(d.getUTCDate() + 4 - day);     // 해당 주 목요일
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { isoYear: d.getUTCFullYear(), isoWeek: week };
}

export function isoWeekToMonday(isoYear, isoWeek) {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (isoWeek - 1) * 7);
  return monday;             // 그 주 월요일(UTC)
}

export function addWeeks(isoYear, isoWeek, delta) {
  const monday = isoWeekToMonday(isoYear, isoWeek);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return getISOWeek(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
}

export function weekDates(isoYear, isoWeek) {
  const monday = isoWeekToMonday(isoYear, isoWeek);
  return Array.from({ length: 5 }, (_, i) => {           // 월~금
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  });
}

// ⚠️ 공용 기간 계약: Scrum의 "이번 주"는 board 구성원 전원이 같은 값을 봐야 하므로
// **workspace timezone**의 오늘에서 파생한다. 브라우저 기본 timezone이나 개인 시간대를
// 쓰면 서울/뉴욕 구성원이 서로 다른 scrum_week(board_id, iso_year, iso_week) 행을 만든다.
//
// todayStr은 'YYYY-MM-DD' (useWorkspaceDateFormat().today()). 컴포넌트로만 다루므로
// timezone 변환이 개입하지 않는다.
export function isoWeekOfDateOnly(todayStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(todayStr || ''));
  // ⚠️ fail-closed: workspace의 오늘을 모르면(null) 브라우저 시계로 대체하지 않고 null을 준다.
  //    호출부(ScrumBoardView)가 null이면 주차 get_or_create를 보류한다.
  if (!m) return null;
  return getISOWeek(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** @deprecated 브라우저 기본 timezone을 쓴다 — 공용 기간에는 isoWeekOfDateOnly를 쓸 것. */
export function currentISOWeek() {
  return getISOWeek(new Date());
}
