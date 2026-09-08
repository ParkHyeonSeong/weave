import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import en from '@/library/i18n/en';
import ko from '@/library/i18n/ko';
import { buildLocaleBootstrapScript, DEFAULT_LOCALE, detectLocale } from '@/library/localePrefs';

// 번역 문장마다 테스트하지 않는다. 여기서 잡는 것은 **구조적 결함**뿐이다:
// 누락 키, 빈 값, interpolation placeholder 불일치.
// 의미 반전과 문체는 사람이 본다(파괴적 행동/권한/비밀번호 문구는 수동 검토 대상).

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const flatEn = flatten(en);
const flatKo = flatten(ko);

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
function placeholders(value) {
  return new Set([...String(value).matchAll(PLACEHOLDER)].map((m) => m[1]));
}

describe('catalog key parity', () => {
  it('en과 ko의 키 집합이 정확히 같다', () => {
    const enKeys = Object.keys(flatEn).sort();
    const koKeys = Object.keys(flatKo).sort();
    const missingInKo = enKeys.filter((k) => !(k in flatKo));
    const missingInEn = koKeys.filter((k) => !(k in flatEn));
    expect(missingInKo, 'ko에 없는 키').toEqual([]);
    expect(missingInEn, 'en에 없는 키').toEqual([]);
  });

  it('모든 값이 비어 있지 않은 문자열이다', () => {
    for (const [name, flat] of [['en', flatEn], ['ko', flatKo]]) {
      const bad = Object.entries(flat)
        .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
        .map(([k]) => k);
      expect(bad, `${name}의 빈/비문자열 값`).toEqual([]);
    }
  });

  it('interpolation placeholder 집합이 두 언어에서 같다', () => {
    const mismatched = [];
    for (const key of Object.keys(flatEn)) {
      const a = placeholders(flatEn[key]);
      const b = placeholders(flatKo[key] ?? '');
      if (a.size !== b.size || [...a].some((p) => !b.has(p))) {
        mismatched.push(`${key}: en={${[...a]}} ko={${[...b]}}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('errorCategories가 백엔드 category 집합을 덮는다', () => {
    // core/errors.py의 category 값들 — 프런트 폴백이 비면 raw 코드가 노출된다.
    for (const c of ['auth', 'forbidden', 'not_found', 'validation', 'conflict',
      'rate_limited', 'server']) {
      expect(flatEn[`errorCategories.${c}`], `en/${c}`).toBeTruthy();
      expect(flatKo[`errorCategories.${c}`], `ko/${c}`).toBeTruthy();
    }
  });

  it('첫 선택 화면의 병기 문구는 양쪽 catalog에서 동일하다', () => {
    // 아직 언어를 고르지 않은 사용자가 읽는 화면이라, 어느 locale로 렌더되든
    // 두 언어가 함께 보여야 한다.
    for (const key of ['languageRegion.gateTitle', 'languageRegion.gateTitleAlt',
      'languageRegion.detectedHint', 'languageRegion.detectedHintAlt',
      'languageRegion.bilingualLanguage', 'languageRegion.bilingualTimeZone']) {
      expect(flatKo[key], key).toBe(flatEn[key]);
    }
  });
});

describe('locale-boot.js parity', () => {
  // theme-boot.js와 같은 규율: 생성원(buildLocaleBootstrapScript)과 배포 파일이
  // 갈리면 첫 페인트의 <html lang>과 런타임이 어긋난다.
  const file = readFileSync(
    path.join(process.cwd(), 'public', 'locale-boot.js'), 'utf8',
  );

  it('public/locale-boot.js가 생성원과 바이트 단위로 같다', () => {
    expect(file).toBe(buildLocaleBootstrapScript());
  });

  it('인라인이 아니라 자족 IIFE다 (CSP: 인라인 script 금지)', () => {
    expect(file.startsWith('(function(){')).toBe(true);
    expect(file.trim().endsWith('})();')).toBe(true);
  });

  // 부트스트랩을 격리된 navigator/localStorage로 실행해 <html lang> 결론만 본다.
  // stored는 { [key]: value } 맵이다(키별로 다른 값을 돌려줘야 'locale' vs 레거시 키를 구분한다).
  const run = (languages, stored = {}) => {
    const list = Array.isArray(languages) ? languages : (languages ? [languages] : []);
    const navigator = { languages: list, language: list[0] || '' };
    const localStorage = { getItem: (k) => (k in stored ? stored[k] : null) };
    const documentElement = { lang: '' };
    // eslint-disable-next-line no-new-func
    new Function('navigator', 'localStorage', 'document', file)(
      navigator, localStorage, { documentElement },
    );
    return documentElement.lang;
  };

  it('부트스트랩 감지 규칙이 런타임 detectLocale과 같은 결론을 낸다 (단일·복수 목록)', () => {
    const cases = [
      ['ko'], ['ko-KR'], ['ko_KR'], ['KO-kr'], ['en-US'], ['fr-FR'], ['kok'], [''], [],
      ['en-US', 'ko-KR'], ['fr-FR', 'ko-KR'], ['ja-JP', 'ko-KR', 'en-US'], ['fr-FR', 'de-DE'],
      ['ko-KR', 'en-US'], ['kok', 'ko'], ['de', 'en-GB', 'ko'],
    ];
    for (const langs of cases) {
      expect(run(langs, {}), `detect ${JSON.stringify(langs)}`).toBe(detectLocale(langs));
    }
    // 명시 기대값(규칙 자체가 뒤집히지 않았는지)
    expect(run(['en-US', 'ko-KR'])).toBe('en');
    expect(run(['fr-FR', 'ko-KR'])).toBe('ko');
    expect(run(['fr-FR', 'de-DE'])).toBe('en');
  });

  it('navigator.languages가 비어 있으면 navigator.language로 떨어진다', () => {
    const navigator = { languages: [], language: 'ko-KR' };
    const localStorage = { getItem: () => null };
    const documentElement = { lang: '' };
    // eslint-disable-next-line no-new-func
    new Function('navigator', 'localStorage', 'document', file)(navigator, localStorage, { documentElement });
    expect(documentElement.lang).toBe('ko');
  });

  it('저장된 익명 표시 언어가 감지값을 이긴다 (레거시 객체 키도 읽기만 한다)', () => {
    expect(run(['ko-KR'], { locale: 'en' })).toBe('en');
    expect(run(['en-US'], { locale: 'ko' })).toBe('ko');
    expect(run(['ko-KR'], { language_region: JSON.stringify({ locale: 'en', time_zone: 'UTC' }) })).toBe('en');
    // 'locale' 키가 우선한다
    expect(run(['ko-KR'], { locale: 'ko', language_region: JSON.stringify({ locale: 'en' }) })).toBe('ko');
    // 손상된 저장값은 무시하고 감지로 떨어진다
    expect(run(['en-US'], { locale: 'fr' })).toBe('en');
    expect(run(['en-US'], { language_region: '{not json' })).toBe('en');
    expect(run(['ko-KR'], { language_region: JSON.stringify({ locale: 'fr' }) })).toBe('ko');
    expect(run(['fr-FR'], { language_region: JSON.stringify({ locale: 'fr' }) })).toBe(DEFAULT_LOCALE);
  });

  it('storage 예외에도 죽지 않는다', () => {
    const navigator = { languages: ['ko-KR'], language: 'ko-KR' };
    const localStorage = { getItem: () => { throw new Error('blocked'); } };
    const documentElement = { lang: '' };
    expect(() => {
      // eslint-disable-next-line no-new-func
      new Function('navigator', 'localStorage', 'document', file)(
        navigator, localStorage, { documentElement },
      );
    }).not.toThrow();
    expect(documentElement.lang).toBe('ko');
  });
});
