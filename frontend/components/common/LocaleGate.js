import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLanguageRegionPreference, useLocale } from '@/library/locale';
import LanguageRegionFields from '@/components/common/LanguageRegionFields';

// 최초 선택 화면. **route를 바꾸지 않는다** — 오버레이로만 뜨므로 사용자가 가려던 URL과
// returnTo 쿼리가 그대로 보존된다.
//
// 언제 뜨는가(library/localePrefs.js mergeServerLanguageRegion):
//   인증된 GET이 성공했고(loadStatus === 'success') 서버에 language_region이 없을 때.
//   · 공개 Login 화면은 loadStatus가 'skipped'이라 절대 뜨지 않는다 — 로그인을 막지 않는다.
//   · GET 실패('error')에도 뜨지 않는다 — 서버 값이 없다고 단정할 수 없다.
//   · 마이그레이션 064로 백필된 기존 사용자와 Setup에서 저장된 첫 관리자는 서버 값이 있어 뜨지 않는다.
//
// 초안은 익명 표시 언어(있으면) + **감지된** 시간대다. 기기값은 초안일 뿐이며,
// Continue를 눌러 서버 저장이 성공해야만 게이트가 닫힌다. 자동 저장 경로는 없다.
export default function LocaleGate() {
  const { t } = useTranslation();
  const { gateOpen, detected, locale } = useLocale();
  const { choose, previewLocale, pending, error } = useLanguageRegionPreference();
  const [draft, setDraft] = useState({ locale, time_zone: detected.time_zone });

  useEffect(() => {
    if (gateOpen) setDraft({ locale, time_zone: detected.time_zone });
    // 열리는 순간의 초안만 잡는다 — 이후 locale 변화는 사용자의 미리보기 자체다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateOpen, detected.time_zone]);

  if (!gateOpen) return null;

  const onChange = (next) => {
    setDraft(next);
    // 라디오를 누르면 게이트 뒤 화면과 버튼 문구가 즉시 그 언어로 바뀐다(저장은 Continue에서).
    if (next.locale !== draft.locale) previewLocale(next.locale);
  };

  return (
    <div className="LocaleGate" role="dialog" aria-modal="true" aria-labelledby="locale-gate-title">
      <div className="LocaleGate__Panel">
        <h1 className="LocaleGate__Brand">Weave</h1>
        {/* 아직 언어를 고르지 않은 사용자가 읽는 화면이라 제목을 양쪽 언어로 병기한다. */}
        <h2 className="LocaleGate__Title" id="locale-gate-title">
          {t('languageRegion.gateTitle')}
          <span className="LocaleGate__TitleAlt">{t('languageRegion.gateTitleAlt')}</span>
        </h2>

        <LanguageRegionFields
          value={draft}
          onChange={onChange}
          disabled={pending}
          idPrefix="locale-gate"
          bilingualLabels
        />

        {error && <p className="LocaleGate__Error" role="alert">{error}</p>}

        <button
          type="button"
          className="LocaleGate__Submit"
          disabled={pending}
          onClick={() => choose(draft, { closeGate: true })}
        >
          {pending ? t('common.state.saving') : t('common.actions.continue')}
        </button>
      </div>
    </div>
  );
}
