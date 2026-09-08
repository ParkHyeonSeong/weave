import { describe, it, expect, afterAll } from 'vitest';
import { errorText } from './errorText.js';
import i18next from './i18n/index.js';

// errorText의 계약은 그대로다: (code, category) → 문구 또는 null.
// 바뀐 것은 문구의 출처뿐 — 이제 현재 locale의 catalog에서 나온다.
const withLocale = (lng, fn) => { i18next.changeLanguage(lng); fn(); };

afterAll(() => i18next.changeLanguage('en'));

describe('errorText — 코드/카테고리 해석', () => {
  it('매핑된 코드 → 문구', () => {
    withLocale('ko', () => {
      expect(errorText('KEY_ALREADY_EXISTS')).toBe('이미 사용 중인 키예요.');
      expect(errorText('SELF_LINK')).toBe('자기 자신과 연결할 수 없어요.');
      expect(errorText('LAST_ADMIN')).toContain('마지막 관리자');
      expect(errorText('INVALID_CREDENTIALS')).toBe('이메일 또는 비밀번호가 올바르지 않아요.');
    });
  });

  it('매핑 없는 코드 + category → category 폴백', () => {
    withLocale('ko', () => {
      expect(errorText('SOME_NEW_FORBIDDEN_CODE', 'forbidden')).toBe('권한이 없어요.');
      expect(errorText('SOME_VALIDATION', 'validation')).toBe('입력값을 확인해 주세요.');
    });
  });

  it('코드 매핑이 우선(둘 다 있으면 코드 문구)', () => {
    withLocale('ko', () => {
      expect(errorText('NOT_BRANCH_MEMBER', 'forbidden')).toBe('이 브랜치의 멤버가 아니에요.');
    });
  });

  it('매핑도 category도 없으면 null(호출부 폴백)', () => {
    // ⚠️ i18next.t는 키가 없으면 **키 문자열**을 돌려준다. exists() 확인 없이 t()만 쓰면
    // 화면에 'errors.TOTALLY_UNKNOWN'이 찍히고 호출부 폴백이 죽는다.
    for (const lng of ['en', 'ko']) {
      withLocale(lng, () => {
        expect(errorText('TOTALLY_UNKNOWN')).toBe(null);
        expect(errorText(null)).toBe(null);
        expect(errorText(undefined, undefined)).toBe(null);
        expect(errorText('TOTALLY_UNKNOWN', 'no_such_category')).toBe(null);
      });
    }
  });
});

describe('errorText — locale을 따른다', () => {
  it('같은 코드가 en/ko에서 각 언어로 나온다', () => {
    withLocale('en', () => {
      expect(errorText('INVALID_CREDENTIALS')).toBe('That email or password is incorrect.');
      expect(errorText('SOME_CODE', 'forbidden')).toBe('You do not have permission.');
    });
    withLocale('ko', () => {
      expect(errorText('INVALID_CREDENTIALS')).toBe('이메일 또는 비밀번호가 올바르지 않아요.');
      expect(errorText('SOME_CODE', 'forbidden')).toBe('권한이 없어요.');
    });
  });

  it('파괴적·보안 문구는 두 언어 모두 비어 있지 않다', () => {
    // 의미 반전은 사람이 봐야 하지만, **빈 번역**은 여기서 잡는다.
    const critical = [
      'LAST_ADMIN', 'LAST_OWNER', 'CANNOT_RESET_OWN_PASSWORD', 'CANNOT_CHANGE_OWN_ROLE',
      'INVALID_CURRENT_PASSWORD', 'PASSWORD_MISMATCH', 'PASSWORD_TOO_SHORT',
      'ACCOUNT_INACTIVE', 'ACCOUNT_REJECTED', 'INVALID_OR_EXPIRED_TOKEN', 'STATUS_IN_USE',
    ];
    for (const lng of ['en', 'ko']) {
      withLocale(lng, () => {
        for (const code of critical) {
          const text = errorText(code);
          expect(text, `${lng}/${code}`).toBeTruthy();
          expect(text.trim().length, `${lng}/${code}`).toBeGreaterThan(0);
        }
      });
    }
  });
});
