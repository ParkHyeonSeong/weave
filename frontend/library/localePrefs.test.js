import { describe, it, expect } from 'vitest';
import {
  normalizeLocale,
  canonicalTimeZone,
  normalizeLanguageRegion,
  detectLocale,
  detectLanguageRegion,
  mergeServerLanguageRegion,
  readLocaleMirror,
  writeLocaleMirror,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  FALLBACK_TIME_ZONE,
  COMPAT_LOCALE,
  COMPAT_TIME_ZONE,
  LOCALE_STORAGE_KEY,
  LEGACY_LANGUAGE_REGION_KEY,
} from '@/library/localePrefs';

describe('normalizeLocale', () => {
  it('en·ko만 통과시킨다', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('ko')).toBe('ko');
  });

  it('지원하지 않는 값은 null', () => {
    for (const bad of ['fr', 'ja', 'EN', 'ko-KR', '', null, undefined, 0, {}]) {
      expect(normalizeLocale(bad)).toBeNull();
    }
  });

  it('호환 기본값이 지원 집합 안에 있다', () => {
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
    expect(SUPPORTED_LOCALES).toContain(COMPAT_LOCALE);
  });
});

describe('canonicalTimeZone', () => {
  it('UTC를 명시적으로 허용한다 (Intl.supportedValuesOf에는 없다)', () => {
    expect(canonicalTimeZone('UTC')).toBe('UTC');
    expect(canonicalTimeZone('utc')).toBe('UTC');
    expect(canonicalTimeZone('Etc/UTC')).toBe('UTC');
    // 이 단정이 깨지면 UTC 전용 검증이 필요하다는 뜻 — 회귀 감시용
    expect(Intl.supportedValuesOf('timeZone')).not.toContain('UTC');
  });

  it('IANA ID를 canonical 형태로 돌려준다', () => {
    expect(canonicalTimeZone('Asia/Seoul')).toBe('Asia/Seoul');
    expect(canonicalTimeZone('asia/seoul')).toBe('Asia/Seoul');
    expect(canonicalTimeZone('America/New_York')).toBe('America/New_York');
    expect(canonicalTimeZone('America/Los_Angeles')).toBe('America/Los_Angeles');
  });

  it('약어·offset·존재하지 않는 zone은 거부한다', () => {
    for (const bad of ['KST', '+09:00', '-05:00', 'GMT+9', 'Asia/Bogus', '', '   ', null, 9]) {
      expect(canonicalTimeZone(bad)).toBeNull();
    }
  });

  it('별칭은 canonical IANA ID로 접힌다 (약어 자체는 저장되지 않는다)', () => {
    const est = canonicalTimeZone('EST');
    if (est !== null) expect(est).not.toBe('EST');
    const useastern = canonicalTimeZone('US/Eastern');
    if (useastern !== null) expect(useastern).toBe('America/New_York');
  });

  it('호환 기본 timezone이 유효하다', () => {
    expect(canonicalTimeZone(COMPAT_TIME_ZONE)).toBe(COMPAT_TIME_ZONE);
    expect(canonicalTimeZone(FALLBACK_TIME_ZONE)).toBe(FALLBACK_TIME_ZONE);
  });
});

describe('normalizeLanguageRegion', () => {
  it('둘 다 유효할 때만 통과', () => {
    expect(normalizeLanguageRegion({ locale: 'ko', time_zone: 'Asia/Seoul' }))
      .toEqual({ locale: 'ko', time_zone: 'Asia/Seoul' });
  });

  it('한쪽만 유효한 반쪽 상태는 거부한다', () => {
    expect(normalizeLanguageRegion({ locale: 'ko', time_zone: 'KST' })).toBeNull();
    expect(normalizeLanguageRegion({ locale: 'fr', time_zone: 'Asia/Seoul' })).toBeNull();
    expect(normalizeLanguageRegion({ locale: 'ko' })).toBeNull();
    expect(normalizeLanguageRegion({ time_zone: 'UTC' })).toBeNull();
  });

  it('객체가 아닌 값은 거부한다', () => {
    for (const bad of [null, undefined, 'ko', 42, ['ko', 'UTC']]) {
      expect(normalizeLanguageRegion(bad)).toBeNull();
    }
  });

  it('입력 timezone을 canonical로 정규화해서 돌려준다', () => {
    expect(normalizeLanguageRegion({ locale: 'en', time_zone: 'utc' }))
      .toEqual({ locale: 'en', time_zone: 'UTC' });
  });
});

describe('detectLocale — navigator.languages 우선순위대로 첫 지원 언어', () => {
  it('단일 태그', () => {
    expect(detectLocale(['ko'])).toBe('ko');
    expect(detectLocale(['ko-KR'])).toBe('ko');
    expect(detectLocale(['ko_KR'])).toBe('ko');
    expect(detectLocale(['KO-kr'])).toBe('ko');
    expect(detectLocale(['en-US'])).toBe('en');
    expect(detectLocale(['en'])).toBe('en');
    expect(detectLocale(['fr-FR'])).toBe('en');   // 지원 언어 없음 → en
    expect(detectLocale([])).toBe('en');
    expect(detectLocale(undefined)).toBe('en');
    expect(detectLocale('ko-KR')).toBe('ko');     // 문자열 하나도 허용
  });

  it('복수 목록은 순서가 우선순위다', () => {
    expect(detectLocale(['en-US', 'ko-KR'])).toBe('en');   // 첫 지원 언어 = en
    expect(detectLocale(['fr-FR', 'ko-KR'])).toBe('ko');   // fr 미지원 → 다음 ko
    expect(detectLocale(['ja-JP', 'ko-KR', 'en-US'])).toBe('ko');
    expect(detectLocale(['fr-FR', 'de-DE'])).toBe('en');   // 지원 언어 없음 → en
    expect(detectLocale(['ko-KR', 'en-US'])).toBe('ko');
  });

  it('ko로 시작하는 다른 언어 태그를 ko로 오인하지 않는다', () => {
    expect(detectLocale(['kok'])).toBe('en');              // Konkani
    expect(detectLocale(['kok', 'ko'])).toBe('ko');
  });

  it('감지 결과는 항상 유효한 language_region이다', () => {
    expect(normalizeLanguageRegion(detectLanguageRegion(['ko-KR']))).not.toBeNull();
    expect(normalizeLanguageRegion(detectLanguageRegion(['fr']))).not.toBeNull();
  });
});

describe('익명 표시 언어 미러 — locale 문자열만, 시간대는 절대 저장하지 않는다', () => {
  const makeStore = (init = {}) => {
    const m = new Map(Object.entries(init));
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: (k) => { m.delete(k); },
      dump: () => Object.fromEntries(m),
    };
  };

  it('쓰고 읽는다', () => {
    const store = makeStore();
    writeLocaleMirror('ko', store);
    expect(store.getItem(LOCALE_STORAGE_KEY)).toBe('ko');
    expect(readLocaleMirror(store)).toBe('ko');
  });

  it('잘못된 값은 쓰지도 읽지도 않는다', () => {
    const store = makeStore({ [LOCALE_STORAGE_KEY]: 'fr' });
    expect(readLocaleMirror(store)).toBeNull();
    writeLocaleMirror('fr', store);
    expect(store.getItem(LOCALE_STORAGE_KEY)).toBe('fr');   // 건드리지 않음
    expect(readLocaleMirror(store)).toBeNull();
  });

  it('레거시 객체 키에서 locale만 옮기고 시간대는 버린다', () => {
    const store = makeStore({
      [LEGACY_LANGUAGE_REGION_KEY]: JSON.stringify({ locale: 'en', time_zone: 'America/New_York' }),
    });
    expect(readLocaleMirror(store)).toBe('en');
    expect(store.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(store.getItem(LEGACY_LANGUAGE_REGION_KEY)).toBeNull();     // 시간대는 어디에도 남지 않는다
    expect(JSON.stringify(store.dump())).not.toContain('America/New_York');
  });

  it('손상된 레거시 값은 지우고 null', () => {
    const store = makeStore({ [LEGACY_LANGUAGE_REGION_KEY]: '{not json' });
    expect(readLocaleMirror(store)).toBeNull();
    expect(store.getItem(LEGACY_LANGUAGE_REGION_KEY)).toBeNull();
  });
});

describe('mergeServerLanguageRegion — 전이표', () => {
  const detected = { locale: 'en', time_zone: 'America/New_York' };
  const server = { locale: 'ko', time_zone: 'Asia/Seoul' };

  it('1) 미인증(skipped)·기기 언어 없음 → 감지값, 쓰기 없음, gate 없음', () => {
    expect(mergeServerLanguageRegion({
      loadStatus: 'skipped', serverValue: null, deviceLocale: null, detected,
    })).toEqual({ value: detected, localeMirrorWrite: null, showGate: false, nextConfirmed: null });
  });

  it('2) 미인증·기기 언어 있음 → 언어는 기기, 시간대는 감지', () => {
    expect(mergeServerLanguageRegion({
      loadStatus: 'skipped', serverValue: null, deviceLocale: 'ko', detected,
    })).toEqual({
      value: { locale: 'ko', time_zone: 'America/New_York' },
      localeMirrorWrite: null, showGate: false, nextConfirmed: null,
    });
  });

  it('3) loading 중에는 gate를 띄우지 않는다 (플리커 방지)', () => {
    expect(mergeServerLanguageRegion({
      loadStatus: 'loading', serverValue: null, deviceLocale: null, detected,
    }).showGate).toBe(false);
  });

  it('4) GET 성공 + 유효한 서버값 → 서버가 권위, 익명 표시 언어 갱신', () => {
    expect(mergeServerLanguageRegion({
      loadStatus: 'success', serverValue: server, deviceLocale: 'en', detected,
    })).toEqual({ value: server, localeMirrorWrite: 'ko', showGate: false, nextConfirmed: server });
  });

  it('4b) 서버 언어와 기기 언어가 같으면 미러를 다시 쓰지 않는다', () => {
    expect(mergeServerLanguageRegion({
      loadStatus: 'success', serverValue: server, deviceLocale: 'ko', detected,
    }).localeMirrorWrite).toBeNull();
  });

  it('5) GET 성공 + 서버값 없음 → gate. 기기값은 초안일 뿐, 서버 쓰기 없음', () => {
    const r = mergeServerLanguageRegion({
      loadStatus: 'success', serverValue: null, deviceLocale: 'ko', detected,
    });
    expect(r.showGate).toBe(true);
    expect(r.value).toEqual({ locale: 'ko', time_zone: 'America/New_York' });   // 시간대는 감지값
    expect(r.localeMirrorWrite).toBeNull();
    expect(r).not.toHaveProperty('serverWrite');
  });

  it('5b) 서버값이 손상됐으면 서버값 없음으로 취급한다 → gate', () => {
    expect(mergeServerLanguageRegion({
      loadStatus: 'success', serverValue: { locale: 'ko', time_zone: 'KST' }, deviceLocale: null, detected,
    }).showGate).toBe(true);
  });

  it('6) GET 실패 → 서버값 없다고 단정하지 않는다: 쓰기 없음, gate 없음', () => {
    expect(mergeServerLanguageRegion({
      loadStatus: 'error', serverValue: null, deviceLocale: 'ko', detected,
    })).toEqual({
      value: { locale: 'ko', time_zone: 'America/New_York' },
      localeMirrorWrite: null, showGate: false, nextConfirmed: null,
    });
  });

  it('7) 이전 계정의 시간대는 상속되지 않는다 — 서버 없는 다음 사용자는 감지 시간대를 본다', () => {
    // 이전 계정(서울)이 로그아웃한 기기: 기기에 남는 것은 언어뿐이다.
    const r = mergeServerLanguageRegion({
      loadStatus: 'success', serverValue: null, deviceLocale: 'ko',
      detected: { locale: 'en', time_zone: 'America/Los_Angeles' },
    });
    expect(r.value.time_zone).toBe('America/Los_Angeles');
    expect(r.showGate).toBe(true);
  });

  it('8) 다른 계정 로그인 → 그 계정의 서버값이 기기 언어를 이긴다', () => {
    const r = mergeServerLanguageRegion({
      loadStatus: 'success', serverValue: server, deviceLocale: 'en', detected,
    });
    expect(r.value).toEqual(server);
    expect(r.localeMirrorWrite).toBe('ko');
  });

  // 라우트 이동마다 UiPrefsProvider가 리마운트돼 loadStatus가 loading으로 돌아간다.
  // 확인된 계정 값이 있으면 그 동안 기기 감지값으로 튀지 않아야 한다.
  it('9) 확인된 계정 값이 있으면 loading·error 동안 그 값을 유지한다', () => {
    for (const loadStatus of ['loading', 'error']) {
      const r = mergeServerLanguageRegion({
        loadStatus, serverValue: null, deviceLocale: 'ko', detected, confirmed: server,
      });
      expect(r.value).toEqual(server);              // 감지 시간대(New York)로 되돌아가지 않는다
      expect(r.showGate).toBe(false);
      expect(r.localeMirrorWrite).toBeNull();
      expect(r.nextConfirmed).toEqual(server);      // 기억은 유지된다
    }
  });

  it('10) 로그아웃(skipped)은 확인된 계정 값을 버리고 기기 시간대로 돌아간다', () => {
    const r = mergeServerLanguageRegion({
      loadStatus: 'skipped', serverValue: null, deviceLocale: 'ko', detected, confirmed: server,
    });
    expect(r.value).toEqual({ locale: 'ko', time_zone: 'America/New_York' });
    expect(r.nextConfirmed).toBeNull();             // 다음 사용자에게 상속 금지
  });

  it('11) 서버 값이 사라진 성공 응답은 게이트를 열고 기억도 지운다', () => {
    const r = mergeServerLanguageRegion({
      loadStatus: 'success', serverValue: null, deviceLocale: 'ko', detected, confirmed: server,
    });
    expect(r.showGate).toBe(true);
    expect(r.value.time_zone).toBe('America/New_York');
    expect(r.nextConfirmed).toBeNull();
  });

  it('12) 손상된 confirmed는 없는 것으로 취급한다', () => {
    const r = mergeServerLanguageRegion({
      loadStatus: 'loading', serverValue: null, deviceLocale: null, detected,
      confirmed: { locale: 'ko', time_zone: 'KST' },
    });
    expect(r.value).toEqual(detected);
    expect(r.nextConfirmed).toBeNull();
  });

  it('감지값이 손상돼도 항상 유효한 값을 돌려준다', () => {
    const r = mergeServerLanguageRegion({
      loadStatus: 'skipped', serverValue: null, deviceLocale: null, detected: { locale: 'zz' },
    });
    expect(r.value).toEqual({ locale: DEFAULT_LOCALE, time_zone: FALLBACK_TIME_ZONE });
  });

  it('locale과 time_zone은 서로 추론되지 않는다', () => {
    const mixed = { locale: 'en', time_zone: 'Asia/Seoul' };
    expect(mergeServerLanguageRegion({
      loadStatus: 'success', serverValue: mixed, deviceLocale: null, detected,
    }).value).toEqual(mixed);
    const mixed2 = { locale: 'ko', time_zone: 'America/New_York' };
    expect(mergeServerLanguageRegion({
      loadStatus: 'success', serverValue: mixed2, deviceLocale: null, detected,
    }).value).toEqual(mixed2);
  });
});
