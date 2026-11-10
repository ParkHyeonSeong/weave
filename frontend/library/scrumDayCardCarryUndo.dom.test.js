// @vitest-environment jsdom
//
// 전날 할 일 가져오기의 실행 취소 단위 — 실제 ScrumCell(TipTap + y-prosemirror)과 Y.Doc 위에서 본다.
// Yjs UndoManager는 0.5초 안의 변경을 한 묶음으로 합친다. 가져오기가 바로 앞 편집(칸 내용 지우기)과
// 묶이면 '되돌리기'가 지운 내용까지 되살린다 — 가져오기만 걷어 내 가져오기 직전(빈 칸)으로 돌아가야 한다.
// 네트워크(태스크 상태 조회·칩 하이드레이션)만 가짜로 두고, 편집기·실행 취소·Y.Doc은 실제 코드를 쓴다.
import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { fragmentHasContent } from '@/library/scrumCellContent';
import { resolveTaskCategories } from '@/library/refHydration';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'ko' } }),
}));
vi.mock('@/library/_axios', () => ({ getBaseURL: () => '', axios: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/library/refHydration', async (importOriginal) => ({
  ...(await importOriginal()),
  useEditorRefHydration: () => {},
  resolveTaskCategories: vi.fn(async () => ({ categoryById: {}, failed: false })),
  hydrateEditor: vi.fn(),
}));

import ScrumDayCard from '@/components/Scrum/ScrumDayCard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom의 Range에는 레이아웃 API가 없다 — 가져오기의 focus('end')가 미루어 부르는 scrollIntoView가
// prosemirror-view coordsAtPos→singleRect에서 range.getClientRects()를 불러 uncaught TypeError를 낸다.
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = function () { return []; };
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = function () { return new DOMRect(); };

const ME = { user_id: 7, username: '박현성' };
const YESTERDAY = '7:1:plan';
const TODAY = '7:2:plan';

// 연결되지 않은 Y 타입은 읽을 수 없으므로, 부모에 먼저 붙인 뒤 자식을 채운다.
function write(doc, key, text) {
  const fragment = doc.getXmlFragment(key);
  const p = new Y.XmlElement('paragraph');
  fragment.insert(fragment.length, [p]);
  p.insert(0, [new Y.XmlText(text)]);
}

let root;
let container;
let doc;

function renderCard(props = {}) {
  act(() => {
    root.render(
      <ScrumDayCard ydoc={doc} member={ME} members={[ME]} isMe dayIdx={2} open synced onToggle={() => {}} {...props} />,
    );
  });
}
// y-prosemirror는 칸의 첫 내용을 다음 매크로태스크에 그린다 — 편집기 생성과 첫 렌더를 기다린다
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const planEditor = () => container.querySelector('.ScrumDayCard__Pane--plan .ProseMirror')?.editor;
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const todayInDoc = () => doc.getXmlFragment(TODAY).toString();

beforeEach(() => {
  resolveTaskCategories.mockResolvedValue({ categoryById: {}, failed: false });
  doc = new Y.Doc();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

it('월요일에 지난주 금요일의 서식·미완료 항목을 가져오고 되돌려도 원본은 유지된다', async () => {
  const friday = new Y.Doc();
  const fragment = friday.getXmlFragment('7:4:plan');
  const list = new Y.XmlElement('taskList');
  fragment.insert(0, [list]);
  for (const [checked, text] of [[true, '완료한 일'], [false, '계속할 일']]) {
    const item = new Y.XmlElement('taskItem');
    list.insert(list.length, [item]);
    item.setAttribute('checked', checked);
    const paragraph = new Y.XmlElement('paragraph');
    item.insert(0, [paragraph]);
    const value = new Y.XmlText();
    paragraph.insert(0, [value]);
    value.insert(0, text, { bold: {} });
  }
  const taskList = new Y.XmlElement('bulletList');
  fragment.insert(fragment.length, [taskList]);
  for (const taskId of [11, 12]) {
    const item = new Y.XmlElement('listItem');
    taskList.insert(taskList.length, [item]);
    const p = new Y.XmlElement('paragraph');
    item.insert(0, [p]);
    const chip = new Y.XmlElement('taskRef');
    p.insert(0, [chip]);
    chip.setAttribute('taskId', taskId);
    chip.setAttribute('label', `TEST-${taskId}`);
  }
  resolveTaskCategories.mockResolvedValue({ categoryById: { 11: 'done', 12: 'in_progress' }, failed: false });
  const original = fragment.toString();
  const previousFriday = { status: 'ready', doc: yXmlFragmentToProsemirrorJSON(fragment), dateLabel: '11/6' };
  renderCard({ dayIdx: 0, previousFriday });
  await settle();
  expect(button('scrum.carry.button')).toBeDefined();
  await act(async () => button('scrum.carry.button').click());
  await settle();
  const editor = planEditor();
  expect(editor.getText()).toContain('계속할 일');
  expect(editor.getText()).not.toContain('완료한 일');
  const imported = editor.getJSON();
  expect(JSON.stringify(imported)).toContain('"bold"');
  expect(JSON.stringify(imported)).toContain('"taskId":12');
  expect(JSON.stringify(imported)).not.toContain('"taskId":11');
  expect(container.textContent).toContain('scrum.carry.doneRemoved');
  expect(fragment.toString()).toBe(original);
  await act(async () => button('scrum.carry.undo').click());
  expect(fragmentHasContent(doc.getXmlFragment('7:0:plan'))).toBe(false);
  expect(fragment.toString()).toBe(original);
  friday.destroy();
});

afterEach(() => {
  act(() => { root.unmount(); });
  document.body.innerHTML = '';
  doc.destroy();
});

it('오늘 내용을 지운 직후 가져온 것을 되돌리면 가져오기 직전의 빈 칸이 된다(지운 내용은 되살아나지 않는다)', async () => {
  write(doc, YESTERDAY, '어제 할 일');
  write(doc, TODAY, '오늘 쓴 내용');
  renderCard();
  await settle();
  await settle();
  const editor = planEditor();
  expect(editor.getText()).toBe('오늘 쓴 내용');

  // 사용자가 칸 내용을 모두 지운다 — 편집기 트랜잭션이라 Y.Doc에 반영되고 실행 취소에 기록된다
  act(() => { editor.chain().focus().selectAll().deleteSelection().run(); });
  renderCard();   // 하루 보기가 문서 변경으로 카드를 다시 그리는 것과 같다
  expect(fragmentHasContent(doc.getXmlFragment(TODAY))).toBe(false);

  // 0.5초가 지나기 전에 곧바로 가져온다
  await act(async () => { button('scrum.carry.button').click(); });
  await settle();
  expect(editor.getText()).toBe('어제 할 일');
  expect(todayInDoc()).toContain('어제 할 일');

  // 안내 띠의 '되돌리기' → 가져오기 직전의 빈 칸 (편집기와 Y.Doc 모두)
  await act(async () => { button('scrum.carry.undo').click(); });
  expect(editor.getText()).toBe('');
  expect(fragmentHasContent(doc.getXmlFragment(TODAY))).toBe(false);
  expect(todayInDoc()).not.toContain('오늘 쓴 내용');
  expect(todayInDoc()).not.toContain('어제 할 일');

  // 지우기는 따로 남은 단계다 — 한 번 더 되돌리면 지우기 전 내용이 돌아온다
  act(() => { editor.commands.undo(); });
  expect(editor.getText()).toBe('오늘 쓴 내용');
  expect(todayInDoc()).toContain('오늘 쓴 내용');
});
