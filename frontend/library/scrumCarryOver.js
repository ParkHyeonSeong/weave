// 전날 할 일 가져오기 — 끝난 항목 빼기 (스펙 §6.4·§8).
// 입력은 y-prosemirror의 yXmlFragmentToProsemirrorJSON 결과({ type: 'doc', content })다.
// 상태 조회(네트워크)는 refHydration의 resolveTaskCategories 몫이고, 여기는 JSON만 다루는 순수 함수다.

// 태스크 상태 분류(status_category) 중 '끝난' 것
export const FINISHED_CATEGORIES = new Set(['done', 'cancelled']);

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
const ITEM_TYPES = new Set(['listItem', 'taskItem']);

// taskRef 칩의 태스크 id. 숫자여야 하지만 방어적으로 Number()로 받고 0/NaN은 없는 것으로 본다.
const taskIdOf = (chip) => Number(chip?.attrs?.taskId) || null;

// 문서 순서대로, 중복 없이 (Set이 넣은 순서를 지킨다)
export function collectTaskIds(doc) {
  const ids = new Set();
  const walk = (node) => {
    if (node.type === 'taskRef') {
      const id = taskIdOf(node);
      if (id) ids.add(id);
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return [...ids];
}

// 항목의 첫 문단이 (공백뿐인 글자를 빼고) 태스크 칩 하나뿐이면 그 칩, 아니면 null
function soleTaskChip(item) {
  const first = item.content?.[0];
  if (first?.type !== 'paragraph') return null;
  const inline = (first.content || []).filter((node) => !(node.type === 'text' && !node.text?.trim()));
  return inline.length === 1 && inline[0].type === 'taskRef' ? inline[0] : null;
}

function isFinished(item, categoryById) {
  if (item.type === 'taskItem' && item.attrs?.checked === true) return true;
  const id = taskIdOf(soleTaskChip(item));
  return Boolean(id) && FINISHED_CATEGORIES.has(categoryById[String(id)]);
}

// 끝난 목록 항목을 뺀 새 문서와 뺀 항목 수(중첩 포함)를 돌려준다. 입력은 바뀌지 않는다.
// categoryById에 없는 id(삭제·권한 밖)는 끝나지 않은 것으로 본다.
export function stripFinishedItems(doc, categoryById) {
  const root = structuredClone(doc); // 아래는 복사본만 만진다 — 돌려주는 JSON도 입력과 객체를 공유하지 않는다
  let removed = 0;

  // 목록은 항목을 걸러 내고 비게 되면 통째로 뺀다. 목록이 아닌 블록(문단 등)은 그대로.
  function pruneBlocks(blocks) {
    return (blocks || []).flatMap((block) => {
      if (!LIST_TYPES.has(block.type)) return [block];
      const items = (block.content || []).flatMap(pruneItem);
      return items.length ? [{ ...block, content: items }] : [];
    });
  }

  // 하위 목록을 먼저 걸러 낸 뒤, 끝난 항목이면서 남은 하위 항목이 없을 때만 뺀다(하위가 고아가 되지 않게).
  function pruneItem(item) {
    if (!ITEM_TYPES.has(item.type)) return [item];
    const content = pruneBlocks(item.content);
    if (!content.some((block) => LIST_TYPES.has(block.type)) && isFinished(item, categoryById)) {
      removed += 1;
      return [];
    }
    return [{ ...item, content }];
  }

  return { doc: { ...root, content: pruneBlocks(root.content) }, removed };
}
