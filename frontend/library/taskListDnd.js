import { closestCorners } from '@dnd-kit/core';

// 작업 탭 목록(TaskList)의 끌기 판정.
// 스프린트 카드(정렬용 sortable)는 본문 droppable(`sprint-<id>`·'backlog')과 다른 id를 쓴다 —
// 같은 id로 두 번 등록하면 나중에 등록한 본문이 카드를 덮어써, 카드 전체(헤더 포함) 판정과
// 접힌 스프린트의 판정 영역이 사라진다.
const SPRINT_SORTABLE_PREFIX = 'sortable-sprint-';
// 백로그 섹션도 같은 컴포넌트라 useSortable을 부른다. 끌 수는 없지만 useSortable의 boolean disabled는
// 끌기만 막아서 판정 영역으로는 등록된다 — 그래서 아래 판정에서 카드처럼 뺀다.
export const BACKLOG_SORTABLE_ID = 'sortable-backlog';

export const sprintSortableId = (sprintId) => `${SPRINT_SORTABLE_PREFIX}${sprintId}`;
export const isSprintSortableId = (id) => typeof id === 'string' && id.startsWith(SPRINT_SORTABLE_PREFIX);

// 스프린트를 끌 때: 포인터 세로 위치에 가장 가까운 카드(안이면 0, 사이·바깥이면 가까운 모서리까지).
// 끄는 카드 크기와 상관없이 포인터가 있는 카드가 대상이라, 행 크기 후보에 밀리거나 간격에서 튀지 않는다.
export function closestSprintToPointer({ droppableContainers, droppableRects, pointerCoordinates, collisionRect }) {
  const y = pointerCoordinates ? pointerCoordinates.y : collisionRect.top + collisionRect.height / 2;
  const collisions = [];
  for (const droppableContainer of droppableContainers) {
    const rect = droppableRects.get(droppableContainer.id);
    if (!rect) continue;
    const value = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    collisions.push({ id: droppableContainer.id, data: { droppableContainer, value } });
  }
  return collisions.sort((a, b) => a.data.value - b.data.value);
}

const isCardId = (id) => isSprintSortableId(id) || id === BACKLOG_SORTABLE_ID;

// 스프린트를 끌 땐 스프린트 카드만, 태스크를 끌 땐 카드(스프린트·백로그)를 뺀 기존 후보
// (행·스프린트 본문·백로그 본문)로 판정한다.
export function taskListCollisionDetection(args) {
  const sprintDrag = isSprintSortableId(args.active.id);
  const droppableContainers = args.droppableContainers.filter((c) => (sprintDrag ? isSprintSortableId(c.id) : !isCardId(c.id)));
  return sprintDrag
    ? closestSprintToPointer({ ...args, droppableContainers })
    : closestCorners({ ...args, droppableContainers });
}
