import { describe, it, expect } from 'vitest';
import { avatarInitials, userColor, AVATAR_COLORS, avatarMarkup } from './userAvatar.js';
import { contrastRatio, TEXT_MIN } from './colorContrast.js';

describe('avatarInitials', () => {
  const cases = [
    // 영문 단일 토큰 -> 앞 2글자
    ['henry', 'HE'],
    ['hanna', 'HA'],
    ['scrumu1', 'SC'],
    ['j', 'J'],
    // 영문 공백/구분자 -> 첫+끝 토큰
    ['Henry Kim', 'HK'],
    ['henry.kim', 'HK'],
    ['min_su', 'MS'],
    ['ada-lovelace', 'AL'],
    // 이메일 -> @앞부분
    ['henry@x.com', 'HE'],
    // 기호/숫자 시작
    ['123kim', 'KI'],
    ['🚀rocket', 'RO'],
    ['123', '12'],
    // 한글 -> 성 제외 이름(최대 2자)
    ['김철수', '철수'],
    ['김영희', '영희'],
    ['박현성', '현성'],
    ['이건우', '건우'],
    ['남궁민수', '민수'],
    ['김 철수', '철수'],
    ['이건', '이건'],
    // 빈 값
    ['', ''],
    ['   ', ''],
    [null, ''],
    [undefined, ''],
  ];
  it.each(cases)('avatarInitials(%j) === %j', (input, expected) => {
    expect(avatarInitials(input)).toBe(expected);
  });
});

describe('userColor', () => {
  it('12색 팔레트', () => {
    expect(AVATAR_COLORS).toHaveLength(12);
  });
  it('user_id를 안정적으로 같은 색에 매핑', () => {
    expect(userColor(3)).toBe(userColor(3));
  });
  it('서로 다른 id는 더 넓은 팔레트로 분산(1과 8이 더이상 동일 색 아님)', () => {
    expect(userColor(1)).not.toBe(userColor(8));
  });
  it('null id -> 중립 회색', () => {
    expect(userColor(null)).toBe('#9CA3AF');
  });
  it('유효한 override는 그대로 사용', () => {
    expect(userColor(3, '#DC2626')).toBe('#DC2626');
  });
  it('팔레트에 없는 override는 무시', () => {
    expect(userColor(3, '#000000')).toBe(userColor(3));
  });
});

describe('avatarMarkup', () => {
  it('사진 있으면 src에 baseUrl 접두', () => {
    const m = avatarMarkup({ username: '김철수', user_id: 3, avatar_url: '/api/uploads/avatars/a.png' }, 'http://h');
    expect(m.src).toBe('http://h/api/uploads/avatars/a.png');
    expect(m.initials).toBe('철수');
  });
  it('사진 없으면 src=null, 색/이니셜 계산', () => {
    const m = avatarMarkup({ username: 'henry', user_id: 1 });
    expect(m.src).toBeNull();
    expect(m.initials).toBe('HE');
    expect(typeof m.color).toBe('string');
  });
  it('다양한 필드명 수용(name/color/author_id)', () => {
    const m = avatarMarkup({ name: 'Ada Lovelace', author_id: 9, color: '#DC2626' });
    expect(m.initials).toBe('AL');
    expect(m.color).toBe('#DC2626');
    expect(m.title).toBe('Ada Lovelace');
  });
});

// 화면에 칠하는 색(avatarMarkup.color) — 흰 이니셜이 읽히도록 대비가 낮은 두 팔레트색만 진하게 칠한다.
// 저장·전송 쪽(AVATAR_COLORS 자리, user_id 배정, 프로필 저장값, awareness 색)은 그대로다.
describe('avatarMarkup — 화면 표시색', () => {
  it('팔레트 12색 모두 화면에 칠하는 색은 흰 이니셜과 4.5:1 이상이다', () => {
    for (const c of AVATAR_COLORS) {
      const shown = avatarMarkup({ username: 'a', avatar_color: c }).color;
      expect(contrastRatio('#FFFFFF', shown), `${c} → ${shown}`).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it.each([
    ['자동 배정 user_id 1(#059669 자리)', { username: 'a', user_id: 1 }, '#047857'],
    ['자동 배정 user_id 7(#0D9488 자리)', { username: 'a', user_id: 7 }, '#0F766E'],
    ['직접 고른 저장값 #059669', { username: 'a', user_id: 3, avatar_color: '#059669' }, '#047857'],
    ['직접 고른 저장값 #0D9488', { username: 'a', user_id: 3, avatar_color: '#0D9488' }, '#0F766E'],
    ['협업 awareness 모양(name·color)', { name: 'a', userId: 5, color: '#059669', avatar_color: null }, '#047857'],
    ['팔레트 밖 저장값은 지금처럼 무시하고 user_id 색', { username: 'a', user_id: 1, avatar_color: '#123456' }, '#047857'],
  ])('%s → 진한 표시색', (_, user, shown) => {
    expect(avatarMarkup(user).color).toBe(shown);
  });

  it('나머지 10색과 id 없는 사용자의 회색은 저장값 그대로 칠한다', () => {
    const unchanged = ['#5E6AD2', '#B45309', '#9333EA', '#BE185D', '#0369A1', '#DC2626', '#A16207', '#7C3AED', '#DB2777', '#475569'];
    for (const c of unchanged) expect(avatarMarkup({ username: 'a', avatar_color: c }).color).toBe(c);
    expect(avatarMarkup({ username: 'a' }).color).toBe('#9CA3AF');
  });

  it('저장·전송 쪽 값은 그대로다 — 팔레트 자리, user_id 배정, 허용 판정(대소문자 구분)', () => {
    expect(AVATAR_COLORS[1]).toBe('#059669');
    expect(AVATAR_COLORS[7]).toBe('#0D9488');
    expect(userColor(1)).toBe('#059669');   // awareness color·백엔드 user_color와 같은 값
    expect(userColor(7)).toBe('#0D9488');
    expect(userColor(3, '#0D9488')).toBe('#0D9488');
    expect(userColor(3, '#0d9488')).toBe(userColor(3));   // 소문자는 지금처럼 팔레트 밖
  });
});
