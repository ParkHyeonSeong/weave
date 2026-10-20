// 여러 줄로 접힌 태스크 칩 위로 ↑ / Shift+↑ 를 누를 때만 커서 이동을 보정한다.
//
// 칩 NodeView(TaskRefExtension)는 contenteditable=false 인라인 span이라, 긴 칩이 줄바꿈되면 칩 조각만 있는 줄에는
// 커서가 설 자리가 없다. ProseMirror는 텍스트 선택의 위아래 이동을 브라우저 기본 동작에 맡기는데
// (prosemirror-view selectVertically), Chrome(155 실측)은 그런 줄로 올라가지 못하면 커서를 편집 영역 맨 앞으로
// 보내거나 제자리에 둔다. Shift+↑ 도 같은 이유로 맨 위까지 선택된다.
// 그래서 '같은 문단 안에서 커서 바로 윗줄이 태스크 칩 조각만으로 채워진' 경우에만 그 칩 앞으로 커서(head)를 옮기고,
// 그 밖의 경우는 모두 브라우저 기본 이동에 맡긴다. 칩 DOM·외형·저장 형식은 건드리지 않는다.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

const isTaskChip = (node) => node?.type.name === 'taskRef';

/**
 * 커서 바로 윗줄이 태스크 칩 조각만으로 이루어졌으면 옮겨 갈 칩 앞 위치를, 아니면 null(기본 이동)을 돌려준다.
 * 후보는 그 줄에서 시작하는 칩이고, 칩 앞 자리가 커서 가로 위치에 가장 가까운 칩을 고른다(같은 거리면 앞 칩).
 * 그런 칩이 없으면(위에서 이어진 칩 조각뿐) 그 칩 앞으로 간다.
 * @param {{top:number,bottom:number,left:number,chipStart:number|null}[]} items
 *   커서가 있는 문단의 인라인 조각 화면 사각형. chipStart: 태스크 칩 조각이면 그 칩 앞 위치, 다른 내용이면 null
 * @param {{top:number,bottom:number,left:number}} caret 커서 사각형
 * @returns {number|null}
 */
export function pickArrowUpTarget(items, caret) {
  const mid = (caret.top + caret.bottom) / 2;
  const above = items.filter((r) => r.bottom <= mid - 2 && r.bottom > r.top + 1);
  if (!above.length) return null; // 문단 첫 줄 — 기본 이동
  const lineBottom = Math.max(...above.map((r) => r.bottom));
  const lineTop = Math.min(...above.filter((r) => r.bottom >= lineBottom - 2).map((r) => r.top));
  const line = above.filter((r) => (r.top + r.bottom) / 2 >= lineTop - 1);
  if (line.some((r) => r.chipStart == null)) return null; // 윗줄에 커서 자리(글자 등)가 있음 — 기본 이동
  // 윗줄보다 위에서 시작한 칩(윗줄엔 끝·가운데 조각만 있음)은 후보에서 뺀다 — 고르면 그 칩 앞으로 두 줄 이상 건너뛴다
  const startedAbove = new Set(above.filter((r) => !line.includes(r)).map((r) => r.chipStart));
  const starts = line.filter((r) => !startedAbove.has(r.chipStart));
  if (!starts.length) return line[0].chipStart; // 윗줄이 위에서 이어진 칩 조각뿐 — 그 칩 앞
  // 윗줄에 있는 칩 앞 자리(조각 왼쪽 끝) 중 커서 가로 위치에 가장 가까운 곳(같은 거리면 앞 칩)
  const dist = (r) => Math.abs(r.left - caret.left);
  return starts.reduce((best, r) => (dist(r) < dist(best) ? r : best)).chipStart;
}

// 커서가 있는 문단의 인라인 노드마다 화면 사각형을 모은다(줄바꿈된 칩은 줄마다 사각형이 하나씩 나온다).
function measureTextblock(view, $head) {
  const items = [];
  const start = $head.start();
  let range = null; // DOM Range는 만들수록 이후 DOM 갱신이 느려져 호출마다 하나만 쓴다
  $head.parent.forEach((child, offset) => {
    const pos = start + offset;
    const dom = view.nodeDOM(pos);
    if (!dom) return;
    let rects;
    if (dom.nodeType === 3) {
      if (!range) range = document.createRange();
      range.selectNodeContents(dom);
      rects = range.getClientRects();
    } else {
      rects = dom.getClientRects();
    }
    const chipStart = isTaskChip(child) ? pos : null;
    for (const r of rects) items.push({ top: r.top, bottom: r.bottom, left: r.left, chipStart });
  });
  return items;
}

export const TaskRefArrowUp = Extension.create({
  name: 'taskRefArrowUp',
  // 기본(100)보다 낮게 둔다: 멘션·슬래시 팝업처럼 ↑ 를 먼저 써야 하는 플러그인이 항상 앞서 처리하게 한다.
  // 같은 우선순위면 Tiptap은 빌더 목록의 뒤쪽 확장을 먼저 실행해 화면마다 순서가 달라진다.
  priority: 50,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('taskRefArrowUp'),
        props: {
          handleKeyDown(view, event) {
            if (event.key !== 'ArrowUp' || event.altKey || event.ctrlKey || event.metaKey) return false;
            if (event.isComposing || view.composing || !view.editable) return false;
            const sel = view.state.selection;
            if (!(sel instanceof TextSelection)) return false;
            // 범위 선택에서 Shift 없는 ↑ 는 브라우저 기본 처리(선택 한쪽 끝에서 한 줄 위)를 그대로 둔다 —
            // 보정하면 선택 방향(정방향·역방향)에 따라 결과가 달라지고 현재 동작도 바뀐다.
            if (!sel.empty && !event.shiftKey) return false;
            const { $head } = sel;
            if (!$head.parent.children.some(isTaskChip)) return false; // 칩 없는 문단은 측정 없이 기본 이동
            const caret = view.coordsAtPos($head.pos, isTaskChip($head.nodeBefore) ? -1 : 1);
            const target = pickArrowUpTarget(measureTextblock(view, $head), caret);
            if (target == null) return false;
            const anchor = event.shiftKey ? sel.anchor : target;
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, target)).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
