import { describe, it, expect } from 'vitest';
import {
  parseDateOnly,
  toDateOnly,
  todayInTimeZone,
  dateOnlyInTimeZone,
  addDaysToDateOnly,
  diffDateOnlyDays,
  formatTimestamp,
  formatTimestampYMD,
  formatTimestampTime,
  formatDateOnly,
  formatDateOnlyRange,
  formatDateOnlyShort,
  formatDateRange,
  formatRelative,
  formatMessageTime,
  formatNumber,
  isOverdue,
} from '@/library/formatDateTime';

describe('date-only 불변성', () => {
  // 이 스위트가 존재하는 이유: new Date('2026-09-07')은 UTC 자정 instant로 파싱돼
  // 음수 offset 지역에서 하루 전으로 렌더된다. 아래 단정이 그 회귀를 막는다.
  const EXTREMES = ['Pacific/Kiritimati', 'Pacific/Niue', 'Asia/Seoul', 'America/New_York', 'UTC'];

  it('formatDateOnly는 실행 환경 timezone과 무관하게 같은 날짜를 낸다', () => {
    for (const tz of EXTREMES) {
      // timeZone을 강제로 바꿀 수 없으므로, 대신 formatDateOnly가 tz 인자를 아예
      // 받지 않는다는 것과 결과가 입력 컴포넌트와 일치한다는 것을 단정한다.
      expect(formatDateOnly('2026-09-07', { locale: 'en' })).toBe('Sep 7, 2026');
      expect(formatDateOnly('2026-01-01', { locale: 'en' })).toBe('Jan 1, 2026');
      expect(formatDateOnly('2026-12-31', { locale: 'en' })).toBe('Dec 31, 2026');
      expect(tz).toBeTruthy();
    }
  });

  it('UTC+14와 UTC-11에서 같은 date-only가 같은 날짜로 읽힌다', () => {
    // date-only는 instant가 아니므로, 어떤 tz로 읽든 컴포넌트가 보존돼야 한다.
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Niue']) {
      const utcMidnight = Date.UTC(2026, 8, 7);
      // dateOnlyInTimeZone은 instant용이다 — date-only에 쓰면 밀린다는 것을 명시적으로 고정.
      const shifted = dateOnlyInTimeZone(new Date(utcMidnight), tz);
      expect(['2026-09-06', '2026-09-07', '2026-09-08']).toContain(shifted);
      // 반면 formatDateOnly는 절대 밀리지 않는다.
      expect(formatDateOnlyShort('2026-09-07', { locale: 'en' })).toBe('09/07');
    }
  });

  it('parseDateOnly / toDateOnly는 시각 부분을 무시한다', () => {
    expect(parseDateOnly('2026-09-07')).toEqual({ y: 2026, m: 9, d: 7 });
    expect(parseDateOnly('2026-09-07T23:30:00Z')).toEqual({ y: 2026, m: 9, d: 7 });
    expect(parseDateOnly('nope')).toBeNull();
    expect(parseDateOnly(null)).toBeNull();
    expect(toDateOnly('2026-09-07T23:30:00Z')).toBe('2026-09-07');
    expect(toDateOnly('')).toBe('');
  });

  it('addDaysToDateOnly는 문자열 계약을 유지한다', () => {
    expect(addDaysToDateOnly('2026-09-07', 7)).toBe('2026-09-14');
    expect(addDaysToDateOnly('2026-09-07', -3)).toBe('2026-09-04');
    expect(addDaysToDateOnly('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateOnly('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToDateOnly('bad', 1)).toBe('');
  });

  it('diffDateOnlyDays는 달력 일수를 세고 DST를 가로질러도 하루가 사라지지 않는다', () => {
    expect(diffDateOnlyDays('2026-09-07', '2026-09-07')).toBe(0);
    expect(diffDateOnlyDays('2026-09-07', '2026-09-10')).toBe(3);
    expect(diffDateOnlyDays('2026-09-10', '2026-09-07')).toBe(-3);
    expect(diffDateOnlyDays('2026-03-07', '2026-03-09')).toBe(2);   // NY DST 시작(3/8)을 가로지름
    expect(diffDateOnlyDays('2026-12-31', '2027-01-01')).toBe(1);
    expect(diffDateOnlyDays('bad', '2026-01-01')).toBeNull();
    expect(diffDateOnlyDays(null, '2026-01-01')).toBeNull();
  });

  it('스프린트 남은 일수 — 개인 tz의 오늘과 달력 차 (instant 차가 아니다)', () => {
    // NY 사용자, 실제 now = 9/6 21:00 EDT(= 9/7 01:00Z). end_date 9/7 → 오늘(9/6) 기준 1일 남음.
    // 옛 구현(new Date('2026-09-07') - now)은 UTC 자정 instant라 -1h → ceil → 0 을 냈다.
    const now = new Date('2026-09-07T01:00:00Z');
    const today = todayInTimeZone('America/New_York', now);
    expect(today).toBe('2026-09-06');
    expect(diffDateOnlyDays(today, '2026-09-07')).toBe(1);
  });

  it('ko locale에서도 date-only가 밀리지 않는다', () => {
    expect(formatDateOnlyShort('2026-01-01', { locale: 'ko' })).toContain('01');
    expect(formatDateOnly('2026-01-01', { locale: 'ko', options: { year: 'numeric', month: '2-digit', day: '2-digit' } }))
      .toMatch(/2026/);
  });

  it('formatDateRange는 문자열 슬라이스 계약을 유지한다', () => {
    expect(formatDateRange('2026-09-07', '2026-09-21')).toBe('2026.09.07 – 2026.09.21');
    expect(formatDateRange('2026-09-07', null)).toBe('2026.09.07 –');
    expect(formatDateRange(null, '2026-09-21')).toBe('– 2026.09.21');
    expect(formatDateRange(null, null)).toBe('');
  });
});

describe('timestamp — 개인 timezone 변환', () => {
  const instant = '2026-01-01T16:00:00Z';   // 서울 1/2 01:00, 뉴욕 1/1 11:00

  it('같은 UTC instant가 Asia/Seoul과 America/New_York에서 다르게 표시된다', () => {
    const seoul = formatTimestampYMD(instant, { timeZone: 'Asia/Seoul' });
    const ny = formatTimestampYMD(instant, { timeZone: 'America/New_York' });
    expect(seoul).toBe('2026-01-02');
    expect(ny).toBe('2026-01-01');
    expect(seoul).not.toBe(ny);
  });

  it('시각도 각 timezone의 벽시계를 따른다', () => {
    expect(formatTimestampTime(instant, { timeZone: 'Asia/Seoul' })).toBe('01:00');
    expect(formatTimestampTime(instant, { timeZone: 'America/New_York' })).toBe('11:00');
    expect(formatTimestampTime(instant, { timeZone: 'UTC' })).toBe('16:00');
  });

  it('formatTimestamp는 locale과 timezone을 함께 반영한다', () => {
    const en = formatTimestamp(instant, { locale: 'en', timeZone: 'America/New_York' });
    const ko = formatTimestamp(instant, { locale: 'ko', timeZone: 'Asia/Seoul' });
    expect(en).toMatch(/Jan/);
    expect(ko).toMatch(/1월|2026/);
  });

  it('잘못된 입력은 빈 문자열', () => {
    expect(formatTimestamp('', { timeZone: 'UTC' })).toBe('');
    expect(formatTimestamp('not-a-date', { timeZone: 'UTC' })).toBe('');
    expect(formatTimestampYMD(null, { timeZone: 'UTC' })).toBe('');
  });

  it('알 수 없는 timezone은 UTC로 폴백하고 throw 하지 않는다', () => {
    expect(() => formatTimestamp(instant, { timeZone: 'Nope/Nope' })).not.toThrow();
    expect(formatTimestampTime(instant, { timeZone: 'Nope/Nope' })).toBe('16:00');
  });
});

describe('DST 경계 — America/New_York', () => {
  it('DST 시작(3월 둘째 일요일) 전후로 벽시계가 1시간 이동한다', () => {
    // 2026-03-08 07:00Z = EST(-5) 02:00 직전 → 실제로는 01:59:59 EST 이후 03:00 EDT
    const before = '2026-03-08T06:00:00Z';   // EST 01:00
    const after = '2026-03-08T08:00:00Z';    // EDT 04:00
    expect(formatTimestampTime(before, { timeZone: 'America/New_York' })).toBe('01:00');
    expect(formatTimestampTime(after, { timeZone: 'America/New_York' })).toBe('04:00');
  });

  it('DST 전환일의 달력 날짜는 하나로 유지된다', () => {
    expect(dateOnlyInTimeZone('2026-03-08T06:00:00Z', 'America/New_York')).toBe('2026-03-08');
    expect(dateOnlyInTimeZone('2026-03-08T08:00:00Z', 'America/New_York')).toBe('2026-03-08');
  });

  it('고정 offset zone과 DST zone이 여름에 갈린다', () => {
    const july = '2026-07-01T16:00:00Z';
    expect(formatTimestampTime(july, { timeZone: 'America/New_York' })).toBe('12:00'); // EDT -4
    expect(formatTimestampTime('2026-01-01T16:00:00Z', { timeZone: 'America/New_York' })).toBe('11:00'); // EST -5
  });
});

describe('todayInTimeZone', () => {
  it('같은 instant라도 timezone에 따라 오늘이 다르다', () => {
    const now = new Date('2026-09-07T15:30:00Z');   // 서울 9/8 00:30, 뉴욕 9/7 11:30
    expect(todayInTimeZone('Asia/Seoul', now)).toBe('2026-09-08');
    expect(todayInTimeZone('America/New_York', now)).toBe('2026-09-07');
    expect(todayInTimeZone('UTC', now)).toBe('2026-09-07');
  });
});

describe('개인 연체(overdue) 계약', () => {
  // 마감 2026-09-07, 현재 UTC 2026-09-07T15:30Z → 서울은 이미 9/8, 뉴욕은 아직 9/7
  const now = new Date('2026-09-07T15:30:00Z');

  it('서울 사용자는 연체로, 뉴욕 사용자는 연체가 아닌 것으로 본다', () => {
    expect(isOverdue('2026-09-07', { timeZone: 'Asia/Seoul', now })).toBe(true);
    expect(isOverdue('2026-09-07', { timeZone: 'America/New_York', now })).toBe(false);
  });

  it('due today는 그 사용자의 하루가 끝나기 전까지 연체가 아니다', () => {
    const morning = new Date('2026-09-07T00:30:00Z');   // 서울 9/7 09:30
    expect(isOverdue('2026-09-07', { timeZone: 'Asia/Seoul', now: morning })).toBe(false);
  });

  it('완료·취소된 Task는 연체가 아니다', () => {
    expect(isOverdue('2026-09-01', { timeZone: 'Asia/Seoul', statusCategory: 'done', now })).toBe(false);
    expect(isOverdue('2026-09-01', { timeZone: 'Asia/Seoul', statusCategory: 'cancelled', now })).toBe(false);
    expect(isOverdue('2026-09-01', { timeZone: 'Asia/Seoul', statusCategory: 'in_progress', now })).toBe(true);
  });

  it('마감일이 없으면 연체가 아니다', () => {
    expect(isOverdue(null, { timeZone: 'Asia/Seoul', now })).toBe(false);
    expect(isOverdue('', { timeZone: 'Asia/Seoul', now })).toBe(false);
  });

  it('due_date는 timezone 변환되지 않는다 (문자열 비교)', () => {
    // UTC+14에서도 2026-09-07은 2026-09-07이다
    expect(isOverdue('2026-09-07', { timeZone: 'Pacific/Kiritimati', now: new Date('2026-09-07T00:00:00Z') }))
      .toBe(false);   // Kiritimati는 이미 9/7 14:00 → 아직 당일
  });
});

describe('상대 시간', () => {
  const now = new Date('2026-09-07T12:00:00Z');

  it('1분 미만은 just now', () => {
    expect(formatRelative('2026-09-07T11:59:30Z', { locale: 'en', timeZone: 'UTC', now }))
      .toBe('just now');
  });

  it('t가 주어지면 catalog 문구를 쓴다', () => {
    const t = (k) => ({ 'common.time.justNow': '방금', 'common.time.yesterday': '어제' }[k] || k);
    expect(formatRelative('2026-09-07T11:59:30Z', { locale: 'ko', timeZone: 'UTC', now, t }))
      .toBe('방금');
  });

  it('locale에 따라 단위 문구가 달라진다', () => {
    const en = formatRelative('2026-09-07T09:00:00Z', { locale: 'en', timeZone: 'UTC', now });
    const ko = formatRelative('2026-09-07T09:00:00Z', { locale: 'ko', timeZone: 'UTC', now });
    expect(en).toMatch(/hour/);
    expect(ko).toMatch(/시간/);
  });

  it('24시간을 넘긴 뒤의 yesterday는 개인 timezone의 달력 날짜로 갈린다', () => {
    const t = (k) => ({ 'common.time.yesterday': 'yesterday' }[k] || k);
    // now = UTC 9/7 12:00 (= 서울 9/7 21:00). 이 instant는 UTC로는 9/5, 서울로는 9/6.
    const iso = '2026-09-05T16:00:00Z';
    expect(formatRelative(iso, { locale: 'en', timeZone: 'Asia/Seoul', now, t })).toBe('yesterday');
    // UTC에서는 어제가 아니므로 경과 시간 사다리로 떨어진다(44h → '1 day ago').
    expect(formatRelative(iso, { locale: 'en', timeZone: 'UTC', now, t })).toBe('1 day ago');
  });

  it('24시간 미만은 달력 날짜와 무관하게 시 단위로 남는다 (기존 사다리 유지)', () => {
    const t = (k) => ({ 'common.time.yesterday': 'yesterday' }[k] || k);
    expect(formatRelative('2026-09-06T13:00:00Z', { locale: 'en', timeZone: 'Asia/Seoul', now, t }))
      .toBe('23 hours ago');
  });

  it('빈 입력은 빈 문자열', () => {
    expect(formatRelative('', { locale: 'en', timeZone: 'UTC' })).toBe('');
    expect(formatRelative('bad', { locale: 'en', timeZone: 'UTC' })).toBe('');
  });
});

describe('formatMessageTime', () => {
  const now = new Date('2026-09-07T12:00:00Z');

  it('같은 날이면 시각만', () => {
    expect(formatMessageTime('2026-09-07T09:05:00Z', { timeZone: 'UTC', now })).toBe('09:05');
  });

  it('다른 날이면 MM/DD HH:MM', () => {
    expect(formatMessageTime('2026-09-05T09:05:00Z', { timeZone: 'UTC', now })).toBe('09/05 09:05');
  });

  it('"오늘"은 개인 timezone 기준이다', () => {
    // UTC 9/7 12:00 = 서울 9/7 21:00 → 서울에서는 같은 날
    expect(formatMessageTime('2026-09-07T09:05:00Z', { timeZone: 'Asia/Seoul', now })).toBe('18:05');
    // UTC 9/6 20:00 = 서울 9/7 05:00 → 서울에서는 같은 날, UTC에서는 어제
    expect(formatMessageTime('2026-09-06T20:00:00Z', { timeZone: 'Asia/Seoul', now })).toBe('05:00');
    expect(formatMessageTime('2026-09-06T20:00:00Z', { timeZone: 'UTC', now })).toBe('09/06 20:00');
  });
});

describe('formatNumber', () => {
  it('locale별 그룹 구분자를 쓴다', () => {
    expect(formatNumber(1234567, { locale: 'en' })).toBe('1,234,567');
    expect(formatNumber(1234567, { locale: 'ko' })).toBe('1,234,567');
  });

  it('잘못된 입력은 빈 문자열', () => {
    expect(formatNumber(null, { locale: 'en' })).toBe('');
    expect(formatNumber('abc', { locale: 'en' })).toBe('');
  });
});

describe('formatDateOnlyRange — 공유 기간 표기', () => {
  it('date-only 범위를 locale 표기로 낸다 (시간대 변환 없음)', () => {
    expect(formatDateOnlyRange('2026-09-01', '2026-09-05', { locale: 'en' }))
      .toBe('Sep 1 – Sep 5');
    expect(formatDateOnlyRange('2026-09-01', '2026-09-05', { locale: 'ko' }))
      .toBe('9월 1일 – 9월 5일');
  });

  it('경계 날짜가 시간대에 따라 이동하지 않는다', () => {
    // 같은 문자열은 어떤 환경에서도 같은 날짜로 표시된다 — instant가 아니기 때문.
    expect(formatDateOnlyRange('2026-01-01', '2026-12-31', { locale: 'en' }))
      .toBe('Jan 1 – Dec 31');
  });

  it('한쪽만 있으면 그 쪽만 낸다', () => {
    expect(formatDateOnlyRange('2026-09-01', null, { locale: 'en' })).toBe('Sep 1');
    expect(formatDateOnlyRange(null, null, { locale: 'en' })).toBe('');
  });
});
