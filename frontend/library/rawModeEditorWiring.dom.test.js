// @vitest-environment jsdom
// 원문 모드의 링크 자리 따라가기는 원문 편집기(CodeMirror)가 넘기는 편집 기록(ChangeSet)에 기댄다.
// 세 편집기가 그 기록을 useRawMode까지 그대로 넘기는지 실제 컴포넌트로 확인한다(댓글 편집기는
// taskCommentComposer.dom.test.js). IssueEditor가 기록을 버리면 이슈 본문·이슈 댓글에서 같은 링크를
// 지우거나 넣을 때 나머지 칩·일반 링크의 형태가 밀린다.
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ChangeSet, EditorState, Text } from '@codemirror/state';
import { history, isolateHistory, undo } from '@codemirror/commands';

const { PREFS, RAW } = vi.hoisted(() => ({
  PREFS: { prefs: {}, loaded: true, setNamespace: () => {} },
  RAW: { props: null }, // 원문 편집기가 받은 props — 키 입력은 onChange(글자, 편집 기록)로 흉내 낸다
}));
vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) }, getBaseURL: () => '' }));
vi.mock('@/library/UiPrefsContext', () => ({ useUiPrefs: () => PREFS }));
vi.mock('@/components/common/RawMarkdownEditor', () => ({ default: (props) => { RAW.props = props; return null; } }));

import i18next from '@/library/i18n';
import IssueEditor from '@/components/Branch/Tasks/IssueEditor';
import TaskDescriptionEditor from '@/components/Branch/Tasks/TaskDescriptionEditor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 첫 줄 = 문서 칩, 둘째 줄 = 같은 제목·주소의 일반 링크
const CHIP = '<span data-doc-ref="true" data-page-id="77" data-canvas-id="5" data-title="설계" data-canvas-name="제품" class="doc-ref">설계</span>';
const CONTENT = () => `<p>${CHIP}</p><p><a href="${window.location.origin}/canvas/5/77">설계</a></p>`;
const seq = (html) => [...html.matchAll(/<span data-doc-ref=|<a /g)].map((m) => (m[0].startsWith('<a') ? 'L' : 'C')).join('');
const deleteFirstLine = () => act(async () => {
  const md = RAW.props.value;
  const changes = ChangeSet.of([{ from: 0, to: md.indexOf('\n\n') + 2 }], md.length);
  RAW.props.onChange(changes.apply(Text.of(md.split('\n'))).toString(), changes);
});
const rawToggle = () => document.querySelector('button[title="Markdown 소스로 편집"]');

let root;
beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  RAW.props = null;
  await i18next.changeLanguage('ko');
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  await i18next.changeLanguage('en');
});

it('IssueEditor: 원문에서 첫 줄(칩)을 지우고 저장하면 남은 일반 링크는 일반 링크다', async () => {
  const ref = createRef();
  await act(async () => root.render(<IssueEditor ref={ref} content={CONTENT()} rawModeEnabled branchId={10} />));
  await act(async () => rawToggle().dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(RAW.props, '원문 모드').not.toBeNull();
  await deleteFirstLine();
  expect(seq(ref.current.getHTML())).toBe('L');
});

// 같은 링크를 앞에 넣는 경우라 편집 기록이 끊기면(순서 기준 대비책) C L C가 되어 배선 누락도 잡는다
it('IssueEditor: 원문에서 맨 앞에 같은 링크를 넣고 전체 삭제 → 실행 취소하면 새 링크는 칩, 되살린 칩·일반 링크는 제 형태다', async () => {
  const ref = createRef();
  await act(async () => root.render(<IssueEditor ref={ref} content={CONTENT()} rawModeEnabled branchId={10} />));
  await act(async () => rawToggle().dispatchEvent(new MouseEvent('click', { bubbles: true })));
  // 원문 편집기처럼 실행 취소 기록이 있는 CodeMirror 상태에서 글자가 바뀔 때마다 onChange(글자, 편집 기록)
  let state = EditorState.create({ doc: RAW.props.value, extensions: [history()] });
  const dispatch = (tr) => {
    state = tr.state;
    if (tr.docChanged) RAW.props.onChange(state.doc.toString(), tr.changes);
  };
  await act(async () => {
    dispatch(state.update({ changes: { from: 0, insert: `[설계](${window.location.origin}/canvas/5/77)\n\n` }, annotations: isolateHistory.of('full') }));
    dispatch(state.update({ changes: { from: 0, to: state.doc.length }, annotations: isolateHistory.of('full') }));
    undo({ state, dispatch });
  });
  expect(seq(ref.current.getHTML())).toBe('CCL');
});

it('TaskDescriptionEditor: 원문에서 첫 줄(칩)을 지우고 blur 저장하면 남은 일반 링크는 일반 링크다', async () => {
  const onSave = vi.fn();
  await act(async () => root.render(<TaskDescriptionEditor content={CONTENT()} onSave={onSave} branchId={10} />));
  await act(async () => rawToggle().dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(RAW.props, '원문 모드').not.toBeNull();
  await deleteFirstLine();
  await act(async () => RAW.props.onBlur());
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(seq(onSave.mock.calls[0][0])).toBe('L');
});
