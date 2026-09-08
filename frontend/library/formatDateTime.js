// locale + 개인 time_zone을 받는 순수 날짜/시각 포맷터. React 의존 없음(테스트가 직접 호출).
// 호출부는 보통 hooks/useDateFormat.js를 통해 현재 사용자 설정이 바인딩된 버전을 쓴다.
//
// ── 세 종류를 절대 섞지 않는다 ──────────────────────────────────────────────
//  1) timestamp : UTC instant. 저장은 TIMESTAMPTZ, 표시는 개인 time_zone으로 변환.
//  2) date-only : 'YYYY-MM-DD' 달력 날짜. timezone 변환 금지 — 문자열/컴포넌트로만 다룬다.
//                 new Date('2026-09-07')은 **UTC 자정 instant**로 파싱되므로
//                 음수 offset(미주)에서 하루 전으로 렌더된다. 이 파일은 그 경로를 쓰지 않는다.
//  3) 개인 파생  : "오늘"·연체. 개인 time_zone에서 계산한 오늘(YYYY-MM-DD)과 date-only를
//                 **문자열로** 비교한다.
// ─────────────────────────────────────────────────────────────────────────────

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function parseDateOnly(value) {
  if (!value) return null;
  const m = DATE_ONLY_RE.exec(String(value));
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** date-only 문자열의 날짜부분만 취한다 ('2026-09-07T00:00:00Z' → '2026-09-07'). */
export function toDateOnly(value) {
  const m = DATE_ONLY_RE.exec(String(value ?? ''));
  return m ? m[0] : '';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 주어진 timezone에서의 "오늘" (YYYY-MM-DD).
 * formatToParts를 쓰는 이유: locale에 따라 문자열 조립 순서가 달라지는 것을 피한다.
 */
export function todayInTimeZone(timeZone, now = new Date()) {
  return dateOnlyInTimeZone(now, timeZone);
}

/** 특정 instant가 주어진 timezone에서 속하는 달력 날짜 (YYYY-MM-DD). */
export function dateOnlyInTimeZone(instant, timeZone) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
  }
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 두 date-only 사이의 달력 일수(b - a). 컴포넌트 산술이라 timezone과 무관. 잘못된 입력은 null. */
export function diffDateOnlyDays(a, b) {
  const pa = parseDateOnly(a);
  const pb = parseDateOnly(b);
  if (!pa || !pb) return null;
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

/** date-only 문자열에 일수를 더한다. 문자열 계약 유지 — timezone과 무관. */
export function addDaysToDateOnly(dateStr, days) {
  const p = parseDateOnly(dateStr);
  if (!p) return '';
  // UTC로만 산술하고 UTC로만 다시 읽는다 — 로컬 tz가 개입할 여지가 없다.
  const t = Date.UTC(p.y, p.m - 1, p.d) + days * 86400000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// ---------------------------------------------------------------------------
// 표시 포맷터
// ---------------------------------------------------------------------------

const BCP47 = { en: 'en-US', ko: 'ko-KR' };
export function bcp47(locale) {
  return BCP47[locale] || BCP47.en;
}

function fmt(locale, timeZone, options) {
  try {
    return new Intl.DateTimeFormat(bcp47(locale), { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat(bcp47(locale), { ...options, timeZone: 'UTC' });
  }
}

/** timestamp → 개인 timezone의 날짜+시각. */
export function formatTimestamp(iso, { locale = 'en', timeZone = 'UTC', options } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return fmt(locale, timeZone, options || {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

/** timestamp → 개인 timezone의 날짜만 (YYYY-MM-DD 고정 표기). */
export function formatTimestampYMD(iso, { timeZone = 'UTC' } = {}) {
  if (!iso) return '';
  return dateOnlyInTimeZone(iso, timeZone);
}

/** timestamp → 개인 timezone의 시각만 (HH:MM). */
export function formatTimestampTime(iso, { locale = 'en', timeZone = 'UTC' } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return fmt(locale, timeZone, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/**
 * date-only → 표시 문자열. **절대 timezone 변환하지 않는다.**
 * 컴포넌트(y/m/d)를 그대로 Intl에 넘기기 위해 UTC 자정 Date를 만들고 timeZone:'UTC'로 읽는다 —
 * 들어간 y/m/d와 나오는 y/m/d가 항상 같다(UTC+14, UTC-11 어디서 실행하든).
 */
export function formatDateOnly(dateStr, { locale = 'en', options } = {}) {
  const p = parseDateOnly(dateStr);
  if (!p) return '';
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
  return new Intl.DateTimeFormat(bcp47(locale), {
    ...(options || { year: 'numeric', month: 'short', day: 'numeric' }),
    timeZone: 'UTC',
  }).format(d);
}

/** date-only → 'MM/DD' 류 짧은 표기 (목록 셀용). timezone 변환 없음. */
export function formatDateOnlyShort(dateStr, { locale = 'en' } = {}) {
  return formatDateOnly(dateStr, { locale, options: { month: '2-digit', day: '2-digit' } });
}

/**
 * date-only 짧은 범위 — 'Sep 1 – Sep 5' / '9월 1일 – 9월 5일'.
 * 공유 기간(Scrum 주·회고)처럼 **날짜 자체는 그대로 두고 표기만 locale에 맞춰야** 하는 자리에 쓴다.
 * 월/일을 손으로 이어 붙이면(m/d) 어떤 locale에서도 어색하고 순서가 틀린다.
 */
export function formatDateOnlyRange(start, end, { locale = 'en' } = {}) {
  const options = { month: 'short', day: 'numeric' };
  const fs = formatDateOnly(start, { locale, options });
  const fe = formatDateOnly(end, { locale, options });
  if (fs && fe) return `${fs} – ${fe}`;
  return fs || fe || '';
}

/** 날짜 범위 — 'YYYY.MM.DD – YYYY.MM.DD'. 문자열 슬라이스라 timezone 무관(기존 계약 유지). */
export function formatDateRange(start, end) {
  const one = (s) => {
    const p = parseDateOnly(s);
    return p ? `${p.y}.${pad2(p.m)}.${pad2(p.d)}` : '';
  };
  const fs = one(start);
  const fe = one(end);
  if (fs && fe) return `${fs} – ${fe}`;
  if (fs) return `${fs} –`;
  if (fe) return `– ${fe}`;
  return '';
}

export function formatNumber(value, { locale = 'en', options } = {}) {
  if (value == null || Number.isNaN(Number(value))) return '';
  try {
    return new Intl.NumberFormat(bcp47(locale), options).format(Number(value));
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// 상대 시간
// ---------------------------------------------------------------------------
//
// 단위 수치는 Intl.RelativeTimeFormat이 locale에 맞게 렌더한다('3 days ago' / '3일 전').
// 'just now'·'yesterday'만 catalog 키로 뺀다 — RelativeTimeFormat이 표현하지 못하는 문구다.
// t가 없으면 영어로 폴백해 이 모듈이 i18n 없이도 동작한다(테스트/부트 경로).
const RELATIVE_FALLBACK = { justNow: 'just now', yesterday: 'yesterday' };

export function formatRelative(iso, { locale = 'en', timeZone = 'UTC', t, now } = {}) {
  if (!iso) return '';
  const then = new Date(iso);
  const thenMs = then.getTime();
  if (Number.isNaN(thenMs)) return '';
  const nowDate = now ? new Date(now) : new Date();
  const diffSec = (nowDate.getTime() - thenMs) / 1000;

  const label = (key) => (t ? t(`common.time.${key}`) : RELATIVE_FALLBACK[key]);
  const rtf = (value, unit) => {
    try {
      return new Intl.RelativeTimeFormat(bcp47(locale), { numeric: 'always' }).format(value, unit);
    } catch {
      return `${Math.abs(value)}${unit[0]} ago`;
    }
  };

  if (diffSec < 60) return label('justNow');
  if (diffSec < 3600) return rtf(-Math.floor(diffSec / 60), 'minute');
  if (diffSec < 86400) return rtf(-Math.floor(diffSec / 3600), 'hour');

  // 24시간을 넘긴 뒤의 'yesterday' 판정은 경과 시간이 아니라 **개인 timezone의 달력 날짜**로
  // 한다(기존 formatTime.formatRelative의 사다리 순서를 그대로 유지). 그래서 같은 instant가
  // Asia/Seoul에서는 'yesterday', UTC에서는 '2 days ago'가 될 수 있다 — 의도된 동작이다.
  const todayStr = dateOnlyInTimeZone(nowDate, timeZone);
  const thenStr = dateOnlyInTimeZone(then, timeZone);
  if (thenStr === addDaysToDateOnly(todayStr, -1)) return label('yesterday');

  if (diffSec < 604800) return rtf(-Math.floor(diffSec / 86400), 'day');
  if (diffSec < 2592000) return rtf(-Math.floor(diffSec / 604800), 'week');
  if (diffSec < 31536000) return rtf(-Math.floor(diffSec / 2592000), 'month');
  return formatDateOnly(thenStr, { locale });
}

/** 메신저/헤더용 짧은 시각 — 오늘이면 HH:MM, 아니면 MM/DD HH:MM. 개인 timezone 기준. */
export function formatMessageTime(iso, { locale = 'en', timeZone = 'UTC', now } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = formatTimestampTime(iso, { locale, timeZone });
  const todayStr = dateOnlyInTimeZone(now ? new Date(now) : new Date(), timeZone);
  const dayStr = dateOnlyInTimeZone(d, timeZone);
  if (dayStr === todayStr) return time;
  const p = parseDateOnly(dayStr);
  return p ? `${pad2(p.m)}/${pad2(p.d)} ${time}` : time;
}

// ---------------------------------------------------------------------------
// 개인 파생 상태 — 연체
// ---------------------------------------------------------------------------
//
// 계약(§9):
//   · 완료/취소가 아닌 Task만 대상
//   · due_date 문자열은 timezone 변환하지 않는다
//   · 사용자 개인 timezone의 오늘(YYYY-MM-DD)과 **문자열 비교**한다
//   · due_date < today 일 때만 연체. due today는 그 사용자의 하루가 끝날 때까지 연체가 아니다
//   · 저장하지 않는다 — viewer별 파생 표시일 뿐이다
const TERMINAL_CATEGORIES = new Set(['done', 'cancelled']);

export function isOverdue(dueDate, { timeZone = 'UTC', statusCategory, now } = {}) {
  const due = toDateOnly(dueDate);
  if (!due) return false;
  if (TERMINAL_CATEGORIES.has(statusCategory)) return false;
  return due < todayInTimeZone(timeZone, now ? new Date(now) : new Date());
}
