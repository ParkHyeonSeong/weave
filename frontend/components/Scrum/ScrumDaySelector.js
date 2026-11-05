import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceDateFormat } from '@/hooks/useDateFormat';
import { WEEKDAY_KEYS } from '@/library/scrumViewModel';

// 하루 보기의 요일 선택 버튼 5개 — 요일·날짜·오늘 배지만 보여준다.
// memo: 보드뷰는 접속자(presence)가 바뀔 때마다 다시 그려지므로 props가 같으면 건너뛴다.
function ScrumDaySelector({ dates, selectedDay, todayIdx, onSelect }) {
  const { t } = useTranslation();
  const { formatDateOnly } = useWorkspaceDateFormat();

  return (
    <div className="ScrumDaySelector" role="group" aria-label={t('scrum.day.selectorLabel')}>
      {dates.map((day, d) => (
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
        </button>
      ))}
    </div>
  );
}

export default memo(ScrumDaySelector);
