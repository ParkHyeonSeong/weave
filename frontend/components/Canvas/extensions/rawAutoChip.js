// 같은 편집 동안만 쓰는 칩 표시: 원문 모드가 새로 칩으로 만든 링크에, 그 링크를 원문에 쓴 그대로(`[글](주소)`)를 단다
// (library/rawMode.js — 일반 모드로 돌아갈 때 단다). 칩을 다시 원문으로 쓰거나(renderMarkdown) A안으로 일반 링크로 되돌릴 때
// 이 원문을 그대로 써서, 칩을 거치며 주소가 화면 주소 붙은 절대 주소로 길어지지 않게 한다.
// 저장 HTML에는 쓰지도 읽지도 않는다 — 서버에 저장된 뒤 다시 연 칩과 일반 모드에서 직접 넣은 칩(/t·붙여넣기)은 늘 표시가 없다.
// 같은 편집기 안에서 잘라 옮길 때만 표시를 잇는다: 잘라낼 때 표시를 이 편집기 메모리에 맡기고 클립보드에 그 잘라내기의 표지를
// 함께 싣는다. 이 편집기에 붙일 때 표지가 맞으면 맡긴 표시를 같은 순서의 칩에 되돌린다 — 다른 편집기·다른 앱에서 온 칩, 표지가
// 사라진 클립보드(그사이 다른 복사), 복사해 붙인 칩은 표시가 없다.
// 원문 편집기가 있는 세 편집기(태스크 설명·댓글·이슈)만 쓴다 — 캔버스·스크럼(협업 문서)은 칩 속성을 그대로 저장하므로 넣지 않는다.
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';

export const RAW_AUTO_CHIP = 'rawAutoChip';
const CHIP_TYPES = ['taskRef', 'issueRef', 'docRef'];
const CHIP_ID = { taskRef: 'taskId', issueRef: 'issueId', docRef: 'pageId' };
const CUT_MARK_TYPE = 'application/x-weave-rich-cut'; // 브라우저만 읽는 사용자 정의 종류 — 다른 앱에는 보이지 않는다
const FORGET_CUT = 'rawAutoChipForgetCut';

// 저장이 끝나 입력창을 비울 때(편집기를 다시 만들지 않는 화면 — 이슈 새 댓글) 맡겨 둔 잘라내기 표시를 버린다 — 다음 글에 붙이는
// 칩은 일반 모드에서 넣은 칩이다
export function forgetRawAutoChipCut(editor) {
  if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(FORGET_CUT, true));
}

// 조각 안 칩들(문서 순서)의 [종류, id, 표시]
function chipMarks(fragment) {
  const marks = [];
  fragment.descendants((node) => {
    if (CHIP_ID[node.type.name]) marks.push([node.type.name, node.attrs[CHIP_ID[node.type.name]], node.attrs[RAW_AUTO_CHIP]]);
  });
  return marks;
}

// 붙일 조각의 칩에 맡긴 표시를 같은 순서로 되돌린다 — 칩 수·종류·id가 하나라도 다르면 되돌리지 않는다(null)
function withChipMarks(slice, marks) {
  let i = 0;
  let ok = true;
  const map = (fragment) => {
    const nodes = [];
    fragment.forEach((node) => {
      if (CHIP_ID[node.type.name]) {
        const m = marks[i++];
        if (!m || m[0] !== node.type.name || m[1] !== node.attrs[CHIP_ID[node.type.name]]) ok = false;
        nodes.push(m ? node.type.create({ ...node.attrs, [RAW_AUTO_CHIP]: m[2] }, node.content, node.marks) : node);
      } else {
        nodes.push(node.content.size ? node.copy(map(node.content)) : node);
      }
    });
    return Fragment.fromArray(nodes);
  };
  const content = map(slice.content);
  return ok && i === marks.length ? new Slice(content, slice.openStart, slice.openEnd) : null;
}

export const RawAutoChipAttribute = Extension.create({
  name: 'rawAutoChipAttribute',
  addGlobalAttributes() {
    return [{
      types: CHIP_TYPES,
      attributes: { [RAW_AUTO_CHIP]: { default: null, rendered: false, keepOnSplit: false, parseHTML: () => null } },
    }];
  },
  addProseMirrorPlugins() {
    let lastCut = null; // 이 편집기가 마지막으로 잘라 클립보드에 둔 칩들: { mark, chips }
    let cutting = null; // 잘라내는 중: 잘라 낼 칩들(ProseMirror 기본 잘라내기 처리 전에 잡는다)
    let pasting = null; // 붙여넣는 중: 클립보드에 실린 표지
    return [new Plugin({
      appendTransaction: (trs) => {
        if (trs.some((tr) => tr.getMeta(FORGET_CUT))) lastCut = null;
        return null;
      },
      props: {
        handleDOMEvents: {
          cut: (view) => { cutting = chipMarks(view.state.selection.content().content); return false; },
          paste: (view, event) => { pasting = event.clipboardData?.getData(CUT_MARK_TYPE) || null; return false; },
        },
        transformPasted: (slice) => {
          const mark = pasting;
          pasting = null;
          if (!mark || mark !== lastCut?.mark) return slice;
          return withChipMarks(slice, lastCut.chips) || slice;
        },
      },
      // 표지는 ProseMirror가 클립보드를 채운 뒤에 더한다 — 기본 처리가 clearData 뒤 text/html·text/plain만 쓰므로, 같은 편집기에
      // 나중에 단 리스너(버블, 이벤트가 끝나기 전)로 받는다. 원문이 만든 칩이 없으면 표지를 싣지 않는다
      view: (view) => {
        const onCut = (event) => {
          const chips = cutting;
          cutting = null;
          if (!chips?.some((c) => c[2]) || !event.defaultPrevented || !event.clipboardData) return;
          const mark = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
          try {
            event.clipboardData.setData(CUT_MARK_TYPE, mark);
            lastCut = { mark, chips };
          } catch {
            lastCut = null;
          }
        };
        view.dom.addEventListener('cut', onCut);
        return { destroy: () => view.dom.removeEventListener('cut', onCut) };
      },
    })];
  },
});
