import { describe, it, expect } from 'vitest';
import { addDaysToDateOnly, isOverdue, todayInTimeZone } from '@/library/formatDateTime';

// 프런트 My Tasks의 연체 표시와 백엔드 saved filter의 $today가 **같은 날짜 계약**을 써야
// 한다. 아니면 같은 Task가 목록에서는 연체인데 필터에는 안 걸리는(또는 반대) 상태가 된다.
//
// 계약(양쪽 공통):
//   · 오늘 = 요청/조회 사용자의 **개인 timezone**에서의 달력 날짜 (YYYY-MM-DD)
//   · due_date는 date-only이고 timezone 변환하지 않는다
//   · 연체 = due_date < 오늘 (문자열 비교). due today는 연체가 아니다
//   · $today+Nd = 오늘 문자열에 N일을 더한 달력 날짜
//
// 백엔드 쪽 같은 계약은 backend/tests/test_timezone_contracts.py가 고정한다.

const AT = (iso) => new Date(iso);

describe('개인 timezone의 오늘 — 프런트/백엔드 공통 정의', () => {
  it('같은 instant에서 timezone마다 오늘이 갈린다', () => {
    const now = AT('2026-09-07T15:30:00Z');
    expect(todayInTimeZone('Asia/Seoul', now)).toBe('2026-09-08');
    expect(todayInTimeZone('America/New_York', now)).toBe('2026-09-07');
    expect(todayInTimeZone('America/Los_Angeles', now)).toBe('2026-09-07');
    expect(todayInTimeZone('UTC', now)).toBe('2026-09-07');
  });

  it('$today±Nd는 달력 날짜 산술이다 (DST에도 하루가 사라지지 않는다)', () => {
    // America/New_York DST 시작일(2026-03-08)을 가로지른다
    const today = todayInTimeZone('America/New_York', AT('2026-03-07T18:00:00Z'));
    expect(today).toBe('2026-03-07');
    expect(addDaysToDateOnly(today, 1)).toBe('2026-03-08');
    expect(addDaysToDateOnly(today, 2)).toBe('2026-03-09');
    expect(addDaysToDateOnly(today, 7)).toBe('2026-03-14');
    expect(addDaysToDateOnly(today, -3)).toBe('2026-03-04');
  });
});

describe('연체 경계 — due today는 그 사용자의 하루가 끝날 때까지 연체가 아니다', () => {
  const cases = [
    // [설명, timezone, now(UTC), due_date, 기대]
    ['서울: 마감일 당일 아침', 'Asia/Seoul', '2026-09-07T00:30:00Z', '2026-09-07', false],
    ['서울: 마감일 당일 밤(아직 그 날)', 'Asia/Seoul', '2026-09-07T14:30:00Z', '2026-09-07', false],
    ['서울: 자정 넘김 → 연체', 'Asia/Seoul', '2026-09-07T15:30:00Z', '2026-09-07', true],
    ['뉴욕: 같은 instant지만 아직 당일', 'America/New_York', '2026-09-07T15:30:00Z', '2026-09-07', false],
    ['뉴욕: 다음 날 새벽 → 연체', 'America/New_York', '2026-09-08T05:30:00Z', '2026-09-07', true],
    ['UTC: 하루 전 마감 → 연체', 'UTC', '2026-09-07T00:00:00Z', '2026-09-06', true],
  ];

  for (const [name, tz, now, due, want] of cases) {
    it(name, () => {
      expect(isOverdue(due, { timeZone: tz, now: AT(now) })).toBe(want);
    });
  }

  it('프런트 연체 판정과 "due_date < $today" 가 같은 결론을 낸다', () => {
    // 백엔드 filter_builder는 due_date < ctx['today'] 로 SQL을 만든다.
    // 여기서 같은 비교를 문자열로 재현해 두 경로가 갈리지 않음을 고정한다.
    for (const tz of ['Asia/Seoul', 'America/New_York', 'UTC', 'Pacific/Kiritimati']) {
      for (const nowIso of ['2026-09-07T00:00:00Z', '2026-09-07T15:30:00Z', '2026-09-07T23:59:00Z']) {
        const today = todayInTimeZone(tz, AT(nowIso));
        for (const due of ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08']) {
          const frontend = isOverdue(due, { timeZone: tz, now: AT(nowIso) });
          const backendEquivalent = due < today;      // $today 필터의 의미
          expect(frontend, `${tz} ${nowIso} due=${due}`).toBe(backendEquivalent);
        }
      }
    }
  });

  it('완료·취소는 어떤 timezone에서도 연체가 아니다', () => {
    for (const tz of ['Asia/Seoul', 'America/New_York']) {
      for (const cat of ['done', 'cancelled']) {
        expect(isOverdue('2020-01-01', { timeZone: tz, statusCategory: cat })).toBe(false);
      }
    }
  });

  it('연체는 저장되지 않는 파생값이다 — 같은 Task를 두 사용자가 다르게 볼 수 있다', () => {
    const now = AT('2026-09-07T15:30:00Z');
    const due = '2026-09-07';
    expect(isOverdue(due, { timeZone: 'Asia/Seoul', now })).toBe(true);
    expect(isOverdue(due, { timeZone: 'America/New_York', now })).toBe(false);
  });
});
