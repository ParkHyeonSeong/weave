import { useTranslation } from 'react-i18next';

import LanguageOptions, { LANGUAGE_NAMES } from '@/components/common/LanguageOptions';
import TimeZoneSelect from '@/components/common/TimeZoneSelect';

// 언어 + 개인 시간대 입력 한 벌. 첫 선택 화면(LocaleGate) · Setup Wizard가 공유한다
// (Profile은 같은 부품을 설정 행 레이아웃으로 직접 배치한다).
// 저장은 호출부 책임 — 이 컴포넌트는 controlled 입력만 제공한다.
//
// 언어 이름·radiogroup 키보드 동작은 LanguageOptions 하나로 모았다. 여기서 재수출하는 것은
// 기존 호출부(import { LANGUAGE_NAMES } from '.../LanguageRegionFields')를 깨지 않기 위해서다.
export { LANGUAGE_NAMES };

export default function LanguageRegionFields({
  value,
  onChange,
  disabled = false,
  idPrefix = 'language-region',
  bilingualLabels = false,
}) {
  const { t } = useTranslation();
  const languageId = `${idPrefix}-language`;
  const timeZoneId = `${idPrefix}-timezone`;

  const setLocale = (locale) => onChange({ ...value, locale });
  const setTimeZone = (time_zone) => onChange({ ...value, time_zone });

  return (
    <div className="LanguageRegion">
      <div className="LanguageRegion__Field">
        {/* 게이트 패널이 이미 "Choose your language / 언어를 선택하세요"를 제목으로 쓴다.
            여기서 같은 문구를 되풀이하지 않고 짧은 병기 라벨만 보여준다. */}
        <span className="LanguageRegion__Label" id={languageId}>
          {t(bilingualLabels ? 'languageRegion.bilingualLanguage' : 'languageRegion.languageLabel')}
        </span>
        <LanguageOptions
          value={value.locale}
          onChange={setLocale}
          disabled={disabled}
          ariaLabelledBy={languageId}
        />
      </div>

      <div className="LanguageRegion__Field">
        <label className="LanguageRegion__Label" htmlFor={timeZoneId}>
          {t(bilingualLabels ? 'languageRegion.bilingualTimeZone' : 'languageRegion.timeZoneLabel')}
        </label>
        <TimeZoneSelect
          id={timeZoneId}
          value={value.time_zone}
          onChange={setTimeZone}
          disabled={disabled}
        />
        <p className="LanguageRegion__Help">
          {bilingualLabels ? (
            <>
              {t('languageRegion.detectedHint')}
              <span className="LanguageRegion__HelpAlt">{t('languageRegion.detectedHintAlt')}</span>
            </>
          ) : t('languageRegion.timeZoneHelp')}
        </p>
      </div>
    </div>
  );
}
