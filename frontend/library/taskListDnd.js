import { closestCorners, pointerWithin } from '@dnd-kit/core';

// 작업 탭 목록(TaskList)의 끌기 판정.
// 스프린트 카드(정렬용 sortable)는 본문 droppable(`sprint-<id>`·'backlog')과 다른 id를 쓴다 —
// 같은 id로 두 번 등록하면 나중에 등록한 본문이 카드를 덮어써, 카드 전체(헤더 포함) 판정과
// 접힌 스프린트의 판정 영역이 사라진다.
// 접힌 섹션의 헤더 놓는 자리는 끄는 사각형이 아니라 포인터 기준으로 고른다(아래 taskListCollisionDetection).
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

// 원래 접힌 섹션(접혔거나 이번 끌기에서 임시로 펼친)의 헤더 = 그 섹션 맨 위 자리. 본문 컨테이너 id로 풀린다.
// 'sprint-'로 시작하면 TaskList의 본문 분기(overId.startsWith('sprint-'))가 Number('header…') = NaN을 만든다.
const HEADER_DROP_PREFIX = 'header-';
export const headerDropId = (containerId) => `${HEADER_DROP_PREFIX}${containerId}`;
export const containerOfHeaderDrop = (id) =>
  (typeof id === 'string' && id.startsWith(HEADER_DROP_PREFIX) ? id.slice(HEADER_DROP_PREFIX.length) : null);

// 접힌 헤더에 이만큼 머무르면 이번 끌기 동안만 펼친다(2026-11-02 사용자 결정)
export const HOVER_EXPAND_MS = 600;

// 스프린트를 끌 땐 스프린트 카드만, 태스크를 끌 땐 카드(스프린트·백로그)를 뺀 기존 후보
// (행·스프린트 본문·백로그 본문)로 판정한다.
export function taskListCollisionDetection(args) {
  if (isSprintSortableId(args.active.id)) {
    return closestSprintToPointer({ ...args, droppableContainers: args.droppableContainers.filter((c) => isSprintSortableId(c.id)) });
  }
  // 태스크를 끌 때: 헤더 자리는 포인터가 그 사각형 안일 때만 고른다 — 끄는 사각형은 잡은 위치에 따라
  // 포인터 위아래로 뻗어, 사각형으로 재면 경계 근처에서 이웃 헤더가 이긴다. 밖이면 헤더·카드를 뺀 기존 판정이다.
  const headers = args.droppableContainers.filter((c) => containerOfHeaderDrop(c.id) !== null);
  const inHeader = pointerWithin({ ...args, droppableContainers: headers });
  if (inHeader.length > 0) return inHeader;
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => !isCardId(c.id) && containerOfHeaderDrop(c.id) === null),
  });
}
