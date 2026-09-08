import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '@/library/locale';
import { useWorkspaceSettings } from '@/library/workspaceSettings';
import * as F from '@/library/formatDateTime';

/**
 * 현재 사용자의 locale + **개인** time_zone이 바인딩된 포맷터 묶음.
 *
 * 호출부는 `formatTimestamp(iso)`처럼 인자 하나만 넘기면 된다 — locale/timezone을 매번
 * 넘겨 다니면 한 곳만 빠뜨려도 그 화면이 브라우저 기본 timezone으로 돌아간다.
 *
 * ⚠️ 여기 담긴 timezone은 **개인** 시간대다. Scrum의 오늘·현재 ISO week·회고 기간처럼
 *    구성원이 공유해야 하는 값에는 쓰지 말고 useWorkspaceDateFormat()을 쓴다.
 */
export function useDateFormat() {
  const { locale, timeZone } = useLocale();
  const { t } = useTranslation();

  return useMemo(() => ({
    locale,
    timeZone,

    // timestamp — UTC instant를 개인 시간대의 벽시계로
    formatTimestamp: (iso, options) => F.formatTimestamp(iso, { locale, timeZone, options }),
    formatTimestampYMD: (iso) => F.formatTimestampYMD(iso, { timeZone }),
    formatTimestampTime: (iso) => F.formatTimestampTime(iso, { locale, timeZone }),
    formatMessageTime: (iso) => F.formatMessageTime(iso, { locale, timeZone }),
    formatRelative: (iso) => F.formatRelative(iso, { locale, timeZone, t }),

    // date-only — timezone 변환 없음
    formatDateOnly: (dateStr, options) => F.formatDateOnly(dateStr, { locale, options }),
    formatDateOnlyShort: (dateStr) => F.formatDateOnlyShort(dateStr, { locale }),
    formatDateRange: F.formatDateRange,
    formatDateOnlyRange: (start, end) => F.formatDateOnlyRange(start, end, { locale }),

    formatNumber: (value, options) => F.formatNumber(value, { locale, options }),

    // 개인 파생 상태
    today: () => F.todayInTimeZone(timeZone),
    isOverdue: (dueDate, statusCategory) => F.isOverdue(dueDate, { timeZone, statusCategory }),
    // date-only까지 남은 달력 일수(개인 tz의 오늘 기준). 시각이 없는 날짜라 instant 차로 구하지 않는다.
    daysUntil: (dateStr) => F.diffDateOnlyDays(F.todayInTimeZone(timeZone), dateStr),
  }), [locale, timeZone, t]);
}

/**
 * **공용 기간** 전용 — workspace time_zone이 바인딩된다.
 * Scrum의 오늘, 현재 ISO week, 데일리 기본 day, 회고 기간에만 쓴다.
 *
 * ⚠️ fail-closed 계약: workspace 설정 조회가 아직 안 끝났거나(status 'loading') 실패하면
 *    (status 'error') timeZone은 null이고 **today()는 null을 돌려준다**. 브라우저 기본
 *    timezone으로 조용히 대체하지 않는다 — 그러면 서울이 아닌 워크스페이스에서 구성원마다
 *    다른 "오늘"·다른 ISO week가 나와 잘못된 scrum_week 행이 생긴다.
 *
 * 반환: { status, locale, timeZone, today, formatDateOnly, formatDateRange }
 *   status   'loading' | 'success' | 'error' — 소비자는 이 값으로 게이트해야 한다.
 *   timeZone status === 'success'일 때만 IANA ID, 그 외에는 null.
 *   today()  status === 'success'일 때만 'YYYY-MM-DD', 그 외에는 null.
 */
export function useWorkspaceDateFormat() {
  const { locale } = useLocale();
  const { status, timeZone } = useWorkspaceSettings();

  return useMemo(() => {
    const ok = status === 'success' && !!timeZone;
    return {
      status,
      locale,
      timeZone: ok ? timeZone : null,
      today: () => (ok ? F.todayInTimeZone(timeZone) : null),
      // date-only 포맷은 timezone 변환이 없다(문자열 → 문자열) — status와 무관하게 쓴다.
      formatDateOnly: (dateStr, options) => F.formatDateOnly(dateStr, { locale, options }),
      formatDateRange: F.formatDateRange,
      formatDateOnlyRange: (start, end) => F.formatDateOnlyRange(start, end, { locale }),
    };
  }, [locale, status, timeZone]);
}
