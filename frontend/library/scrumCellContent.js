// Scrum 칸(Yjs XmlFragment)에 실제로 쓴 내용이 있는지 판정하는 순수 함수.
// ⚠️ backend/library/scrum_cells.py의 cell_has_content와 같은 기준을 유지한다:
//    글자(공백 제외)가 있거나 칩/멘션 노드가 있으면 "작성함".
import * as Y from 'yjs';

// 글자 없이 칩만 있어도 작성한 칸이다. TipTap 노드명(scrum_cells.py의 _CHIP_RE와 같은 목록).
export const CHIP_NODE_NAMES = ['taskRef', 'docRef', 'issueRef', 'mention'];

// Y.XmlText#toString()은 서식(굵게 등) 구간을 "<bold>…</bold>" 태그로 감싸 돌려준다.
// 서식이 걸린 공백이 글자로 잡히지 않도록 delta의 글자만 모은다.
function plainText(xmlText) {
  return xmlText
    .toDelta()
    .map((part) => (typeof part.insert === 'string' ? part.insert : ''))
    .join('');
}

// Y.XmlElement도 Y.XmlFragment라서 하위 노드를 같은 함수로 재귀한다.
export function fragmentHasContent(fragment) {
  if (!fragment) return false;
  return fragment.toArray().some((node) => {
    if (node instanceof Y.XmlText) return plainText(node).trim() !== '';
    if (node instanceof Y.XmlElement) {
      return CHIP_NODE_NAMES.includes(node.nodeName) || fragmentHasContent(node);
    }
    return false;
  });
}

// 같은 기준을 ProseMirror JSON(yXmlFragmentToProsemirrorJSON 결과·그 일부)에 적용한다 — 전날 할 일 가져오기가
// 끝난 항목을 뺀 뒤 넣을 것이 남았는지 볼 때 쓴다. JSON의 text 노드는 서식(marks)과 글자가 따로라 글자만 본다.
export function jsonHasContent(node) {
  if (!node) return false;
  if (node.type === 'text') return Boolean(node.text?.trim());
  return CHIP_NODE_NAMES.includes(node.type) || (node.content || []).some(jsonHasContent);
}

export function cellHasContent(ydoc, key) {
  return ydoc ? fragmentHasContent(ydoc.getXmlFragment(key)) : false;
}

// 칸의 fragment 키. 백엔드 cells API·MCP·홈 '오늘 미작성' 카드가 같은 형식에 의존한다.
export function weekCellKey(userId, dayIdx, row) {
  return `${userId}:${dayIdx}:${row}`;       // row: 'plan' | 'gap'
}

export function retroCellKey(userId, col) {
  return `${userId}:${col}`;                 // col: 'keep' | 'problem' | 'try'
}
