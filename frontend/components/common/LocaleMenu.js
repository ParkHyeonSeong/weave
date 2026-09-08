import { useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '@/library/locale';
import LanguageOptions, { LANGUAGE_NAMES } from '@/components/common/LanguageOptions';

// 로그인·설치 화면의 작은 상시 진입점 — **언어만** 고른다.
//
// 로그인 전에는 계정을 모르므로 시간대를 고르게 하지 않는다. 시간대는 로그인 후 서버 값
// (없으면 최초 선택 게이트)에서 정해지며, 이 기기에 남기지 않는다 — 공유 브라우저에서
// 이전 계정의 시간대가 다음 계정에 상속되는 것을 막기 위해서다.
// 여기서 고른 언어는 익명 표시 언어(localStorage['locale'])로만 저장된다.
//
// placement='below'(기본): trigger 바로 아래에 가운데로 붙는다. 로그인 카드 아래에 있는
// 자리라 아래로 열어야 카드를 덮지 않는다(수정 전에는 오른쪽 정렬로 열려 카드를 가렸다).
// 'right'는 화면 위쪽 우측에 놓이는 trigger용 변형이다.
export default function LocaleMenu({ className = '', placement = 'below' }) {
  const { t } = useTranslation();
  const { locale, commitLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef({});

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // 열리면 현재 언어 항목으로 포커스를 옮긴다 — 키보드 사용자가 곧바로 방향키를 쓸 수 있어야 한다.
  // locale은 의도적으로 deps에 넣지 않는다(방향키 이동은 LanguageOptions가 이미 포커스를 옮긴다).
  useEffect(() => {
    if (open) optionRefs.current[locale]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();     // 팝오버를 닫으면 포커스는 trigger로 돌아온다
  };

  return (
    <div
      className={`LanguageRegionMenu ${className}`.trim()}
      data-placement={placement}
      ref={rootRef}
    >
      <button
        type="button"
        ref={triggerRef}
        className="LanguageRegionMenu__Trigger"
        aria-expanded={open}
        aria-controls="locale-menu-popover"
        aria-label={t('languageRegion.languageLabel')}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); close(); } }}
      >
        <Globe size={14} aria-hidden="true" />
        <span>{LANGUAGE_NAMES[locale] || locale}</span>
      </button>

      {open && (
        <div
          id="locale-menu-popover"
          className={`LanguageRegionMenu__Popover LanguageRegionMenu__Popover--${placement}`}
        >
          <span className="LanguageRegion__Label" id="locale-menu-label">
            {t('languageRegion.bilingualLanguage')}
          </span>
          <LanguageOptions
            value={locale}
            optionRefs={optionRefs}
            className="LanguageRegion__Options--segmented"
            ariaLabelledBy="locale-menu-label"
            onEscape={close}
            onChange={(code, source) => {
              commitLocale(code);
              // 방향키 이동으로는 닫지 않는다 — 열어 둔 채로 언어가 즉시 바뀌는 것을 보여준다.
              if (source === 'activate') close();
            }}
          />
          <p className="LanguageRegion__Help">{t('languageRegion.anonymousTimeZoneNote')}</p>
        </div>
      )}
    </div>
  );
}
