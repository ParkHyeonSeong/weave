import { useRef } from 'react';

import { SUPPORTED_LOCALES } from '@/library/localePrefs';

// 언어 이름은 **그 언어 자체로** 적는다(English / 한국어). 아직 언어를 고르지 않은 사용자가
// 읽어야 하는 유일한 항목이라, 현재 locale로 번역하면 못 읽는 사람이 생긴다.
// 국기 아이콘은 쓰지 않는다 — 언어는 국가가 아니다.
export const LANGUAGE_NAMES = { en: 'English', ko: '한국어' };

/**
 * 언어 선택 radiogroup 한 벌 — 로그인 메뉴 · 최초 선택 게이트 · Setup · Profile이 공유한다.
 *
 * role="radio"를 붙였으면 WAI-ARIA radiogroup 규약을 실제로 구현해야 한다(테마의
 * AppearanceSection과 같은 계약): roving tabindex(선택 항목만 tabIndex 0) + 방향키로
 * 이동하면 즉시 선택 + Home/End. 역할만 radio로 두고 방향키가 없으면 키보드 사용자가
 * 두 번째 언어에 아예 닿지 못한다.
 *
 * onChange(code, source) — source는 'activate'(클릭·Enter·Space) 또는 'move'(방향키).
 * 팝오버 안에서 쓰는 호출부는 'activate'에서만 닫는다. 방향키 이동에서 닫아버리면
 * 키보드로는 목록을 훑을 수 없다.
 */
export default function LanguageOptions({
  value,
  onChange,
  disabled = false,
  className = '',
  ariaLabelledBy,
  ariaLabel,
  onEscape,
  optionRefs,
}) {
  const localRefs = useRef({});
  const refs = optionRefs || localRefs;
  const idx = Math.max(0, SUPPORTED_LOCALES.indexOf(value));

  const move = (delta) => {
    const next = SUPPORTED_LOCALES[
      (idx + delta + SUPPORTED_LOCALES.length) % SUPPORTED_LOCALES.length
    ];
    // 포커스가 선택을 따라가야 roving tabindex가 성립한다.
    refs.current[next]?.focus();
    if (!disabled) onChange(next, 'move');
  };

  const onKeyDown = (e) => {
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowLeft': case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Home': e.preventDefault(); move(-idx); break;
      case 'End': e.preventDefault(); move(SUPPORTED_LOCALES.length - 1 - idx); break;
      case 'Escape': if (onEscape) { e.preventDefault(); onEscape(); } break;
      default: break;
    }
  };

  return (
    <div
      className={`LanguageRegion__Options ${className}`.trim()}
      role="radiogroup"
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabel}
    >
      {SUPPORTED_LOCALES.map((code) => {
        const selected = value === code;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled || undefined}
            tabIndex={selected ? 0 : -1}
            ref={(el) => { refs.current[code] = el; }}
            className={`LanguageRegion__Option${selected ? ' LanguageRegion__Option--selected' : ''}`}
            onClick={() => { if (!disabled) onChange(code, 'activate'); }}
            onKeyDown={onKeyDown}
          >
            {LANGUAGE_NAMES[code]}
          </button>
        );
      })}
    </div>
  );
}
