import { describe, it, expect } from 'vitest';
import {
  todayDayIndex,
  isWeekday,
  initialSelectedDay,
  weekColumnTemplate,
  retroDeadline,
} from './scrumViewModel.js';

describe('todayDayIndex', () => {
  it('월~금은 0~4', () => {
    expect(todayDayIndex('2026-11-02')).toBe(0);   // 월
    expect(todayDayIndex('2026-11-03')).toBe(1);
    expect(todayDayIndex('2026-11-04')).toBe(2);   // 수
    expect(todayDayIndex('2026-11-05')).toBe(3);
    expect(todayDayIndex('2026-11-06')).toBe(4);   // 금
  });

  it('토·일은 금요일(4)', () => {
    expect(todayDayIndex('2026-11-07')).toBe(4);   // 토 → 금
    expect(todayDayIndex('2026-11-08')).toBe(4);   // 일 → 금
  });

  it('날짜를 읽을 수 없으면 0(NaN을 돌려주지 않는다)', () => {
    expect(todayDayIndex(null)).toBe(0);
    expect(todayDayIndex('')).toBe(0);
    expect(todayDayIndex('not-a-date')).toBe(0);
  });
});

// 보드의 '오늘' 표시는 평일에만 — 주말에는 금요일을 고르되(todayDayIndex) '오늘'이라 하지 않는다.
describe('isWeekday', () => {
  it('월~금은 true, 토·일은 false', () => {
    for (const d of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']) {
      expect(isWeekday(d), d).toBe(true);
    }
    expect(isWeekday('2026-11-07')).toBe(false);   // 토
    expect(isWeekday('2026-11-08')).toBe(false);   // 일
  });

  it('연말·연초도 달력 요일 그대로(2027-01-01 금, 2026-12-27 일)', () => {
    expect(isWeekday('2027-01-01')).toBe(true);
    expect(isWeekday('2026-12-27')).toBe(false);
  });

  it('날짜를 읽을 수 없으면 false', () => {
    expect(isWeekday(null)).toBe(false);
    expect(isWeekday('')).toBe(false);
    expect(isWeekday('not-a-date')).toBe(false);
  });
});

describe('initialSelectedDay', () => {
  it('오늘이 그 ISO 주이면 오늘의 요일', () => {
    expect(initialSelectedDay('2026-11-04', 2026, 45)).toBe(2);   // 2026-11-02(월)은 ISO 2026-W45
  });

  it('이번 주의 토·일이면 금요일', () => {
    expect(initialSelectedDay('2026-11-08', 2026, 45)).toBe(4);   // 일요일도 W45
  });

  it('다른 주이면 월요일', () => {
    expect(initialSelectedDay('2026-11-04', 2026, 44)).toBe(0);
  });

  it('오늘을 모르면(null) 월요일', () => {
    expect(initialSelectedDay(null, 2026, 45)).toBe(0);
  });

  it('ISO 연도도 맞아야 이번 주', () => {
    expect(initialSelectedDay('2026-11-04', 2025, 45)).toBe(0);   // 주 번호만 같고 연도가 다름
    expect(initialSelectedDay('2027-01-01', 2026, 53)).toBe(4);   // 2027-01-01(금)은 ISO 2026-W53
    expect(initialSelectedDay('2027-01-01', 2027, 1)).toBe(0);
  });
});

describe('weekColumnTemplate', () => {
  it('넓게 보는 요일 > 내용 있는 요일 > 그 밖', () => {
    expect(weekColumnTemplate(2, [true, true, true, false, false])).toBe(
      '84px minmax(110px, 1fr) minmax(110px, 1fr) minmax(240px, 2.3fr) minmax(72px, 0.55fr) minmax(72px, 0.55fr)');
  });

  it('금요일을 넓게 보면 마지막 열이 넓다', () => {
    expect(weekColumnTemplate(4, [true, false, false, false, false])).toBe(
      '84px minmax(110px, 1fr) minmax(72px, 0.55fr) minmax(72px, 0.55fr) minmax(72px, 0.55fr) minmax(240px, 2.3fr)');
  });

  it('라벨 열 폭을 바꿀 수 있다', () => {
    expect(weekColumnTemplate(0, [false, false, false, false, false], 120)).toBe(
      '120px minmax(240px, 2.3fr) minmax(72px, 0.55fr) minmax(72px, 0.55fr) minmax(72px, 0.55fr) minmax(72px, 0.55fr)');
  });
});

describe('retroDeadline', () => {
  it('마감 전이면 남은 일수', () => {
    expect(retroDeadline('2026-11-06', '2026-11-04', true)).toEqual({ kind: 'remaining', days: 2 });
  });

  it('마감일이 오늘이면 today', () => {
    expect(retroDeadline('2026-11-06', '2026-11-06', true)).toEqual({ kind: 'today' });
  });

  it('마감이 지났으면 passed', () => {
    expect(retroDeadline('2026-11-06', '2026-11-07', true)).toEqual({ kind: 'passed' });
  });

  it('달 경계를 넘어도 달력 날짜 차이로 센다', () => {
    expect(retroDeadline('2026-11-02', '2026-10-30', true)).toEqual({ kind: 'remaining', days: 3 });
  });

  it('현재 회고가 아니면 null', () => {
    expect(retroDeadline('2026-11-06', '2026-11-04', false)).toBeNull();
  });

  it('날짜가 없으면 null', () => {
    expect(retroDeadline('2026-11-06', null, true)).toBeNull();
    expect(retroDeadline(null, '2026-11-04', true)).toBeNull();
  });
});
