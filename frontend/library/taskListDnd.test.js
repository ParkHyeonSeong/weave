import { describe, it, expect } from 'vitest';
import { closestCorners } from '@dnd-kit/core';
import {
  BACKLOG_SORTABLE_ID,
  sprintSortableId,
  isSprintSortableId,
  closestSprintToPointer,
  taskListCollisionDetection,
} from './taskListDnd.js';

const box = (top, height) => ({ top, bottom: top + height, left: 0, right: 800, width: 800, height });
// 작업 탭 배치를 줄인 모양(카드 사이 16px):
// 활성 A = 헤더 74 + 행 3개, 예정 B = 헤더 48 + 행 2개, 접힌 C = 헤더뿐, 그 아래 백로그(헤더 44 + 행 1개).
// 카드(sortable-sprint-*·sortable-backlog)와 본문(sprint-*·backlog)·행(숫자)이 한 DndContext에 같이 있다.
const LAYOUT = {
  'sortable-sprint-1': box(0, 194),
  'sprint-1': box(75, 119),
  101: box(75, 40),
  102: box(115, 40),
  103: box(155, 39),
  'sortable-sprint-2': box(210, 128),
  'sprint-2': box(259, 79),
  201: box(259, 40),
  202: box(299, 39),
  'sortable-sprint-3': box(354, 49),
  'sortable-backlog': box(419, 124),
  backlog: box(463, 80),
  901: box(463, 40),
};
// 지금까지 같은 id의 본문에 덮여 후보에 없던 카드들
const CARD_IDS = ['sortable-sprint-1', 'sortable-sprint-2', 'sortable-sprint-3', BACKLOG_SORTABLE_ID];
const IDS = Object.keys(LAYOUT);
const rects = new Map(Object.entries(LAYOUT));
const containers = (ids) => ids.map((id) => ({ id }));
const args = (activeId, y, extra = {}) => ({
  active: { id: activeId },
  collisionRect: box(y - 24, 49),
  droppableRects: rects,
  droppableContainers: containers(IDS),
  pointerCoordinates: { x: 400, y },
  ...extra,
});
const firstId = (collisions) => collisions[0]?.id;

describe('스프린트 카드 id', () => {
  it('본문 droppable(sprint-<id>)·백로그·태스크 id와 겹치지 않는다', () => {
    expect(sprintSortableId(7)).toBe('sortable-sprint-7');
    expect(isSprintSortableId('sortable-sprint-7')).toBe(true);
    expect(isSprintSortableId('sprint-7')).toBe(false);
    expect(isSprintSortableId('backlog')).toBe(false);
    expect(isSprintSortableId(BACKLOG_SORTABLE_ID)).toBe(false);
    expect(isSprintSortableId(7)).toBe(false);
  });
});

describe('스프린트를 끌 때', () => {
  it('포인터가 다른 스프린트의 태스크 행 위에 있어도 그 스프린트 카드로 판정하고, 카드만 후보로 본다', () => {
    const result = taskListCollisionDetection(args('sortable-sprint-3', 130));
    expect(firstId(result)).toBe('sortable-sprint-1');
    expect(result.map((c) => c.id)).toEqual(['sortable-sprint-1', 'sortable-sprint-2', 'sortable-sprint-3']);
  });

  it('접힌 스프린트(헤더만 있는 카드)도 대상이 된다', () => {
    expect(firstId(taskListCollisionDetection(args('sortable-sprint-2', 370)))).toBe('sortable-sprint-3');
  });

  it('카드 사이 간격은 가까운 카드, 목록 위·아래 바깥은 맨 앞·맨 뒤 카드다', () => {
    // A 아래 끝 194 · B 위 끝 210 → 간격 가운데 202
    expect(firstId(taskListCollisionDetection(args('sortable-sprint-3', 198)))).toBe('sortable-sprint-1');
    expect(firstId(taskListCollisionDetection(args('sortable-sprint-3', 206)))).toBe('sortable-sprint-2');
    expect(firstId(taskListCollisionDetection(args('sortable-sprint-3', -40)))).toBe('sortable-sprint-1');
    expect(firstId(taskListCollisionDetection(args('sortable-sprint-1', 500)))).toBe('sortable-sprint-3');
  });

  it('포인터 좌표가 없으면 끄는 사각형의 세로 가운데로 판정한다', () => {
    // 위 끝(330)은 B 안이지만 가운데(350)는 C 쪽(B 아래 끝 338 · C 위 끝 354)이다
    const result = closestSprintToPointer({
      ...args('sortable-sprint-3', 0),
      droppableContainers: containers(['sortable-sprint-1', 'sortable-sprint-2', 'sortable-sprint-3']),
      pointerCoordinates: null,
      collisionRect: box(330, 40),
    });
    expect(firstId(result)).toBe('sortable-sprint-3');
  });

  it('크기를 재지 못한 카드는 건너뛴다', () => {
    const result = closestSprintToPointer({
      ...args('sortable-sprint-3', 130),
      droppableContainers: containers(['sortable-sprint-9', 'sortable-sprint-2']),
    });
    expect(result.map((c) => c.id)).toEqual(['sortable-sprint-2']);
  });
});

describe('태스크를 끌 때', () => {
  it('스프린트·백로그 카드를 뺀 기존 후보(행·본문·백로그 본문)로 closestCorners 판정을 그대로 한다', () => {
    // 접힌 C 카드·백로그 카드와 같은 자리·크기의 사각형 — 카드가 후보에 남아 있으면 그 카드가 1등이 된다
    for (const card of ['sortable-sprint-3', BACKLOG_SORTABLE_ID]) {
      const rect = LAYOUT[card];
      const a = args('201', rect.top + 24, { collisionRect: rect });
      const withoutCards = { ...a, droppableContainers: containers(IDS.filter((id) => !CARD_IDS.includes(id))) };
      expect(taskListCollisionDetection(a)).toEqual(closestCorners(withoutCards));
      expect(firstId(closestCorners(a))).toBe(card);
    }
  });
});
