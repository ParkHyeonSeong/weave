import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLanguageRegionPreference } from '@/library/locale';
import { sameLanguageRegion } from '@/library/localePrefs';
import LanguageOptions from '@/components/common/LanguageOptions';
import TimeZoneSelect from '@/components/common/TimeZoneSelect';

// Profile의 개인 언어·시간대 섹션. AppearanceSection(테마)과 같은 자리·같은 계약이다.
//
// 레이아웃: 제목 → 한 줄 설명 → 설정 행 두 개(라벨 | 컨트롤) → 보조 문구 → 저장.
// 데스크톱에서는 라벨과 컨트롤이 한 행으로 정렬되고 모바일에서는 세로로 쌓인다(SCSS).
//
// locale과 time_zone은 각각 고를 수 있지만 **한 번에** 저장한다 — language_region 객체
// 하나가 통째로 성공하거나 통째로 롤백된다. 저장 실패 시 되돌림 권위는 UiPrefsContext의
// CAS 롤백 하나뿐이고, 그 결과가 LocaleServerSync를 통해 화면으로 돌아온다.
export default function LanguageRegionSection() {
  const { t } = useTranslation();
  const { value, choose, pending, error } = useLanguageRegionPreference();
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);

  // 서버 채택·롤백으로 확정값이 바뀌면 초안을 맞춘다(다른 기기에서 바꾼 값이 따라온다).
  useEffect(() => { setDraft(value); }, [value]);

  const dirty = !sameLanguageRegion(draft, value);

  // 초안을 건드리면 이전 저장 결과 표시는 걷는다 — "저장됨"이 지금 상태를 오해시키면 안 된다.
  const setLocale = (locale) => { setSaved(false); setDraft((d) => ({ ...d, locale })); };
  const setTimeZone = (time_zone) => { setSaved(false); setDraft((d) => ({ ...d, time_zone })); };

  const save = async () => {
    setSaved(false);
    if (await choose(draft)) setSaved(true);
  };

  const languageId = 'profile-language-region-language';
  const timeZoneId = 'profile-language-region-timezone';

  return (
    <div className="Profile__Section">
      <h2 className="Profile__SectionTitle">{t('languageRegion.sectionTitle')}</h2>
      <p className="LanguageRegion__SectionHint">{t('languageRegion.sectionHint')}</p>

      <div className="LanguageRegion__Rows">
        <div className="LanguageRegion__Row">
          <span className="LanguageRegion__RowLabel" id={languageId}>
            {t('languageRegion.languageLabel')}
          </span>
          <div className="LanguageRegion__RowControl">
            <LanguageOptions
              value={draft.locale}
              onChange={setLocale}
              disabled={pending}
              className="LanguageRegion__Options--segmented"
              ariaLabelledBy={languageId}
            />
          </div>
        </div>

        <div className="LanguageRegion__Row">
          <label className="LanguageRegion__RowLabel" htmlFor={timeZoneId}>
            {t('languageRegion.timeZoneLabel')}
          </label>
          <div className="LanguageRegion__RowControl">
            <TimeZoneSelect
              id={timeZoneId}
              value={draft.time_zone}
              onChange={setTimeZone}
              disabled={pending}
            />
          </div>
        </div>
      </div>

      {/* 개인 시간대와 워크스페이스 시간대의 차이는 한 문장으로만 말한다. */}
      <p className="LanguageRegion__Note">{t('languageRegion.scopeNote')}</p>

      <div className="LanguageRegion__Actions">
        <button
          type="button"
          className="Profile__SaveBtn"
          disabled={pending || !dirty}
          onClick={save}
        >
          {pending ? t('common.state.saving') : t('common.actions.save')}
        </button>
        {/* 성공은 모달로 막지 않고 버튼 옆 짧은 문구로 알린다. 실패 문구는 role=alert. */}
        {error && (
          <span className="LanguageRegion__Status LanguageRegion__Status--error" role="alert">
            {error}
          </span>
        )}
        {!error && saved && !dirty && (
          <span className="LanguageRegion__Status LanguageRegion__Status--saved" role="status">
            {t('common.state.saved')}
          </span>
        )}
      </div>
    </div>
  );
}
