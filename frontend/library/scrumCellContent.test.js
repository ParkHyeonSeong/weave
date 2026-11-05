import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import {
  CHIP_NODE_NAMES,
  fragmentHasContent,
  jsonHasContent,
  cellHasContent,
  weekCellKey,
  retroCellKey,
} from './scrumCellContent.js';

// 연결되지 않은 Y 타입은 읽을 수 없으므로, 부모에 먼저 붙인 뒤 자식을 채운다.
function attach(parent, node) {
  parent.insert(parent.length, [node]);
  return node;
}
const paragraph = (parent) => attach(parent, new Y.XmlElement('paragraph'));
const text = (parent, s) => attach(parent, new Y.XmlText(s));
const newFragment = () => new Y.Doc().getXmlFragment('1:0:plan');

describe('fragmentHasContent', () => {
  it('빈 fragment·공백 문단은 false', () => {
    const frag = newFragment();
    expect(fragmentHasContent(frag)).toBe(false);   // 아무것도 없음
    const p = paragraph(frag);
    expect(fragmentHasContent(frag)).toBe(false);   // 빈 문단
    text(p, '  \n\t ');
    expect(fragmentHasContent(frag)).toBe(false);   // 공백만
  });

  it('글자가 있는 문단은 true', () => {
    const frag = newFragment();
    text(paragraph(frag), '로그인 버그 수정');
    expect(fragmentHasContent(frag)).toBe(true);
  });

  it('글자 없이 taskRef 칩만 있어도 true', () => {
    const frag = newFragment();
    attach(paragraph(frag), new Y.XmlElement('taskRef'));
    expect(fragmentHasContent(frag)).toBe(true);
  });

  it('mention만 있어도 true', () => {
    const frag = newFragment();
    attach(paragraph(frag), new Y.XmlElement('mention'));
    expect(fragmentHasContent(frag)).toBe(true);
  });

  it('docRef·issueRef도 칩으로 본다', () => {
    for (const name of ['docRef', 'issueRef']) {
      const frag = newFragment();
      attach(paragraph(frag), new Y.XmlElement(name));
      expect(fragmentHasContent(frag)).toBe(true);
    }
  });

  it('칩이 아닌 인라인 노드(hardBreak)만 있으면 false', () => {
    const frag = newFragment();
    attach(paragraph(frag), new Y.XmlElement('hardBreak'));
    expect(fragmentHasContent(frag)).toBe(false);
  });

  it('목록 안쪽 깊은 글자도 찾는다', () => {
    const frag = newFragment();
    const list = attach(frag, new Y.XmlElement('bulletList'));
    const item = attach(list, new Y.XmlElement('listItem'));
    text(paragraph(item), '깊은 글자');
    expect(fragmentHasContent(frag)).toBe(true);
  });

  it('목록 안쪽 깊은 칩도 찾는다', () => {
    const frag = newFragment();
    const list = attach(frag, new Y.XmlElement('bulletList'));
    const item = attach(list, new Y.XmlElement('listItem'));
    attach(paragraph(item), new Y.XmlElement('taskRef'));
    expect(fragmentHasContent(frag)).toBe(true);
  });

  // Y.XmlText#toString()은 서식 구간을 "<bold>   </bold>"처럼 태그로 감싸 돌려준다.
  // 서식이 걸린 공백이 "작성함"으로 잡히면 안 된다(백엔드는 태그를 떼고 판정).
  it('서식(굵게)이 걸린 공백만 있으면 false, 글자가 있으면 true', () => {
    const frag = newFragment();
    const p = paragraph(frag);
    text(p, '   ').format(0, 3, { bold: {} });
    expect(fragmentHasContent(frag)).toBe(false);
    text(p, '굵은 글자').format(0, 5, { bold: {} });
    expect(fragmentHasContent(frag)).toBe(true);
  });

  it('null/undefined는 false', () => {
    expect(fragmentHasContent(null)).toBe(false);
    expect(fragmentHasContent(undefined)).toBe(false);
  });
});

// 전날 할 일 가져오기는 칸(Y.XmlFragment)을 ProseMirror JSON으로 바꾼 뒤 끝난 항목을 빼고 "넣을 게 남았는지"를 JSON으로 본다.
// 그 판정(jsonHasContent)이 칸 작성 판정(fragmentHasContent)과 같은 내용에 같은 답을 내야, 빈 칸 판정과 가져오기 판정이 어긋나지 않는다.
describe('jsonHasContent — fragmentHasContent와 같은 기준', () => {
  const cases = [
    ['빈 칸', () => {}, false],
    ['빈 문단', (frag) => { paragraph(frag); }, false],
    ['공백만', (frag) => { text(paragraph(frag), '  \n\t '); }, false],
    ['서식(굵게)이 걸린 공백만', (frag) => { text(paragraph(frag), '   ').format(0, 3, { bold: {} }); }, false],
    ['칩 아닌 인라인 노드(hardBreak)만', (frag) => { attach(paragraph(frag), new Y.XmlElement('hardBreak')); }, false],
    ['글자', (frag) => { text(paragraph(frag), '로그인 버그 수정'); }, true],
    ['굵은 글자', (frag) => { text(paragraph(frag), '굵은 글자').format(0, 5, { bold: {} }); }, true],
    ['taskRef 칩만', (frag) => { attach(paragraph(frag), new Y.XmlElement('taskRef')); }, true],
    ['mention만', (frag) => { attach(paragraph(frag), new Y.XmlElement('mention')); }, true],
    ['목록 안쪽 깊은 칩', (frag) => {
      const item = attach(attach(frag, new Y.XmlElement('bulletList')), new Y.XmlElement('listItem'));
      attach(paragraph(item), new Y.XmlElement('docRef'));
    }, true],
  ];

  it.each(cases)('%s', (_, fill, expected) => {
    const frag = newFragment();
    fill(frag);
    expect(fragmentHasContent(frag)).toBe(expected);
    expect(jsonHasContent(yXmlFragmentToProsemirrorJSON(frag))).toBe(expected);
  });

  it('null/undefined는 false', () => {
    expect(jsonHasContent(null)).toBe(false);
    expect(jsonHasContent(undefined)).toBe(false);
  });
});

describe('cellHasContent', () => {
  it('ydoc이 없으면 false', () => {
    expect(cellHasContent(null, '1:0:plan')).toBe(false);
    expect(cellHasContent(undefined, '1:0:plan')).toBe(false);
  });

  it('ydoc의 해당 키 fragment를 본다', () => {
    const doc = new Y.Doc();
    text(paragraph(doc.getXmlFragment('1:0:plan')), '로그인 버그 수정');
    expect(cellHasContent(doc, '1:0:plan')).toBe(true);
    expect(cellHasContent(doc, '1:1:plan')).toBe(false);   // 안 쓴 칸
  });
});

describe('CHIP_NODE_NAMES', () => {
  // backend/library/scrum_cells.py의 _CHIP_RE와 같은 목록
  it('칩 노드 이름', () => {
    expect(CHIP_NODE_NAMES).toEqual(['taskRef', 'docRef', 'issueRef', 'mention']);
  });
});

describe('셀 키', () => {
  it('키 형식', () => {
    expect(weekCellKey(7, 2, 'gap')).toBe('7:2:gap');
    expect(weekCellKey(7, 0, 'plan')).toBe('7:0:plan');
    expect(retroCellKey(7, 'try')).toBe('7:try');
  });
});
