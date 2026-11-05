import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceDateFormat } from '@/hooks/useDateFormat';
import useWeekWritten from '@/library/useWeekWritten';
import { WEEKDAY_KEYS } from '@/library/scrumViewModel';

// 하루 보기의 요일 선택 버튼 5개 — 요일·날짜·오늘 배지·그날 할 일을 쓴 사람 수(n/N)와 막대.
// memo: 보드뷰는 접속자(presence)가 바뀔 때마다 다시 그려지므로 props가 같으면 건너뛴다.
// 수는 문서가 바뀔 때마다(useWeekWritten) 다시 센다. synced(주간 문서의 첫 동기화) 전에는 막대 채움을 그리지 않고
// 수는 자리만 지킨 채 숨긴다(.is-pending = visibility:hidden, aria-hidden) — 빈 문서로 센 0/N을 사실처럼 보이지 않으면서
// 동기화 순간 버튼 높이가 바뀌지 않게.
function ScrumDaySelector({ ydoc, members, dates, selectedDay, todayIdx, synced, onSelect }) {
  const { t } = useTranslation();
  const { formatDateOnly } = useWorkspaceDateFormat();
  const status = useWeekWritten(ydoc, members, synced);
  const written = dates.map((_, d) => members.filter((m) => status.get(m.user_id).plan[d]).length);
  const total = members.length;

  return (
    <div className="ScrumDaySelector" role="group" aria-label={t('scrum.day.selectorLabel')}>
      {dates.map((day, d) => {
        const pct = total ? Math.round((written[d] / total) * 100) : 0;
        return (
          <button
            key={day.date}
            type="button"
            className="ScrumDaySelector__Day"
            aria-pressed={d === selectedDay}
            onClick={() => onSelect(d)}
          >
            <span className="ScrumDaySelector__Top">
              <span className="ScrumDaySelector__Wd">{t(WEEKDAY_KEYS[d])}</span>
              <span className="ScrumDaySelector__Date">
                {formatDateOnly(day.date, { month: 'numeric', day: 'numeric' })}
              </span>
              {d === todayIdx && <span className="ScrumDaySelector__Today">{t('common.time.today')}</span>}
            </span>
            <span className="ScrumDaySelector__Progress">
              <span className="ScrumDaySelector__Bar" aria-hidden="true">
                {synced && <span className="ScrumDaySelector__Fill" style={{ width: `${pct}%` }} />}
              </span>
              <span className={`ScrumDaySelector__Count${synced ? '' : ' is-pending'}`} aria-hidden={synced ? undefined : true}>
                {t('scrum.day.writtenOf', { count: written[d], total })}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default memo(ScrumDaySelector);
