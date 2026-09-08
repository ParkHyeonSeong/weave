import { describe, it, expect } from 'vitest';
import { ddayBadge } from '@/library/dueBadge';

// ddayBadge(dueIso, today): 둘 다 'YYYY-MM-DD' 달력 날짜. Date를 만들지 않으므로 실행 환경
// timezone·DST와 무관하다. today는 호출부가 개인 timezone의 오늘로 넘긴다.
describe('ddayBadge', () => {
  const today = '2026-09-07';

  it('오늘 → soon/D-day', () => {
    expect(ddayBadge('2026-09-07', today)).toEqual({ cls: 'soon', text: 'D-day' });
  });

  it('1~2일 → soon', () => {
    expect(ddayBadge('2026-09-08', today)).toEqual({ cls: 'soon', text: 'D-1' });
    expect(ddayBadge('2026-09-09', today)).toEqual({ cls: 'soon', text: 'D-2' });
  });

  it('3일+ → calm (경계 D-3)', () => {
    expect(ddayBadge('2026-09-10', today)).toEqual({ cls: 'calm', text: 'D-3' });
    expect(ddayBadge('2026-10-07', today)).toEqual({ cls: 'calm', text: 'D-30' });
  });

  it('지남 → over/D+', () => {
    expect(ddayBadge('2026-09-06', today)).toEqual({ cls: 'over', text: 'D+1' });
    expect(ddayBadge('2026-08-31', today)).toEqual({ cls: 'over', text: 'D+7' });
  });

  it('마감 없음/잘못된 입력 → none', () => {
    expect(ddayBadge(null, today)).toEqual({ cls: 'none', text: '—' });
    expect(ddayBadge('', today)).toEqual({ cls: 'none', text: '—' });
    expect(ddayBadge('bad', today)).toEqual({ cls: 'none', text: '—' });
    expect(ddayBadge('2026-09-07', null)).toEqual({ cls: 'none', text: '—' });
  });

  it('시각이 붙은 값도 날짜부분만 본다', () => {
    expect(ddayBadge('2026-09-08T23:59:00Z', '2026-09-07T01:00:00Z')).toEqual({ cls: 'soon', text: 'D-1' });
  });

  it('DST 경계(America/New_York 2026-03-08)를 가로질러도 하루가 사라지지 않는다', () => {
    expect(ddayBadge('2026-03-09', '2026-03-07')).toEqual({ cls: 'soon', text: 'D-2' });
  });
});
