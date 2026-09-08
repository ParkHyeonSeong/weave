// 마감일(date-only) → D-day 뱃지 분류. 통계 드릴인 팝오버 행에서 사용.
// 경계: 지남(over) / 0~2일 임박(soon) / 3일+ 여유(calm) / 없음(none).
//
// ⚠️ 날짜 계약: due_date도 today도 **달력 날짜 'YYYY-MM-DD'** 다. Date를 만들지 않는다 —
//    new Date('YYYY-MM-DD')는 UTC 자정 instant라 음수 offset(미주)에서 하루가 밀리고,
//    setHours(0,0,0,0)로 잡은 로컬 자정과 섞이면 DST 경계에서 D-day가 하루 어긋난다.
//    today는 호출부가 useDateFormat().today()(개인 timezone의 오늘)로 넘긴다.
import { diffDateOnlyDays, toDateOnly } from './formatDateTime';

const NONE = { cls: 'none', text: '—' };

export function ddayBadge(dueIso, today) {
  const days = diffDateOnlyDays(toDateOnly(today), toDateOnly(dueIso));
  if (days == null) return NONE;
  if (days < 0) return { cls: 'over', text: `D+${-days}` };
  if (days <= 2) return { cls: 'soon', text: days === 0 ? 'D-day' : `D-${days}` };
  return { cls: 'calm', text: `D-${days}` };
}
