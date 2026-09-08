import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import ScrumCell from './ScrumCell';
import Avatar from '@/components/common/Avatar';
import { weekDates } from '@/library/isoWeek';

const WD = ['scrum.grid.mon', 'scrum.grid.tue', 'scrum.grid.wed', 'scrum.grid.thu', 'scrum.grid.fri'];
const ROWS = [['plan', 'scrum.grid.rowPlan'], ['gap', 'scrum.grid.rowRecap']];

// memo: props(ydoc/members/isoYear/isoWeek)가 안정적이라, 보드뷰의 presence
// (connectedUsers) 갱신 re-render가 N×10 셀 트리로 전파되지 않게 차단.
function ScrumWeekGrid({ ydoc, members, isoYear, isoWeek }) {
  const { t } = useTranslation();
  const dates = weekDates(isoYear, isoWeek);
  return (
    <div className="ScrumGrid">
      <div className="ScrumGrid__Row ScrumGrid__Row--head">
        <div className="ScrumGrid__Corner" />
        {WD.map((w, i) => (
          <div key={w} className="ScrumGrid__ColHead">
            <span className="ScrumGrid__Wd">{t(w)}</span>
            <span className="ScrumGrid__Date">{dates[i].month}/{dates[i].day}</span>
          </div>
        ))}
      </div>
      {members.map((m) => (
        <div key={m.user_id} className="ScrumGrid__Person">
          <div className="ScrumGrid__PersonHead">
            <Avatar user={m} size="xs" className="ScrumGrid__Avatar" />
            <span className="ScrumGrid__PersonName">{m.username}</span>
          </div>
          {ROWS.map(([rowKey, rowLabelKey]) => (
            <div key={rowKey} className="ScrumGrid__Row">
              <div className="ScrumGrid__RowLabel">{t(rowLabelKey)}</div>
              {WD.map((_, dayIdx) => (
                <div key={dayIdx} className="ScrumGrid__CellWrap">
                  <ScrumCell
                    ydoc={ydoc}
                    fragmentKey={`${m.user_id}:${dayIdx}:${rowKey}`}
                    placeholder=""
                    members={members}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default memo(ScrumWeekGrid);
