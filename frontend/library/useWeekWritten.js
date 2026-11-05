import { useMemo } from 'react';
import useYDocRevision from '@/library/useYDocRevision';
import { cellHasContent, weekCellKey } from '@/library/scrumCellContent';
import { WEEKDAYS } from '@/library/scrumViewModel';

// 사람마다 이번 주 월~금 칸에 썼는지 — Map<userId, { plan: boolean[5], gap: boolean[5] }>(plan = 할 일, gap = 리캡).
// 하루 보기·한 주 보기가 같이 쓴다. 문서가 바뀔 때마다(useYDocRevision) 다시 센다.
// synced(주간 문서의 첫 동기화)도 의존성이다 — 값 자체는 쓰지 않지만, 없으면 동기화로 다시 그릴 때
// (문서 변경 신호는 다음 프레임에 온다) 동기화 전에 센 값을 한 프레임 보인다.
export default function useWeekWritten(ydoc, members, synced) {
  const revision = useYDocRevision(ydoc);
  return useMemo(() => new Map(members.map((m) => [m.user_id, {
    plan: WEEKDAYS.map((d) => cellHasContent(ydoc, weekCellKey(m.user_id, d, 'plan'))),
    gap: WEEKDAYS.map((d) => cellHasContent(ydoc, weekCellKey(m.user_id, d, 'gap'))),
  }])), [revision, synced, ydoc, members]);
}
