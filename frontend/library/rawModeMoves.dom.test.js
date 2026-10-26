// @vitest-environment jsdom
// 같은 본문 안에서 줄을 옮겨도(Alt+↑/↓, 잘라 다른 자리에 붙이기, 그 뒤 실행 취소·다시 실행) 칩은 칩, 일반 링크는 일반 링크다.
// 실제 원문 편집기(RawMarkdownEditor = CodeMirror)를 띄워 확인한다 — Alt+↑/↓·실행 취소·다시 실행은 편집기 키맵이 부르는
// CodeMirror 명령을, 잘라내기·복사·붙여넣기는 CodeMirror의 cut/copy/paste 처리기(클립보드 이벤트)를 그대로 써서,
// 원문 편집기가 넘기는 편집 기록이 useRawMode를 거쳐 저장까지 가는 경로를 쓴다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorSelection, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { deleteCharBackward, moveLineDown, moveLineUp, redo, undo } from '@codemirror/commands';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { PREFS } = vi.hoisted(() => ({ PREFS: { prefs: {}, loaded: true, setNamespace: () => {} } }));
vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) }, getBaseURL: () => '' }));
vi.mock('@/library/UiPrefsContext', () => ({ useUiPrefs: () => PREFS }));

import i18next from '@/library/i18n';
import CommentEditor from '@/components/Branch/Tasks/CommentEditor';
import IssueEditor from '@/components/Branch/Tasks/IssueEditor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom의 Range에는 레이아웃 API가 없다(편집기 측정·스크롤이 부른다)
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = function () { return []; };
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = function () { return new DOMRect(); };

const SERVER_CASES = JSON.parse(readFileSync(resolve(__dirname, '../../backend/tests/fixtures/reserialize_growth_cases.json'), 'utf8')).cases;
// 같은 제목·같은 주소의 칩과 일반 링크(브라우저 주소 기준 절대 주소라 md 원문이 글자까지 같다)
const KIND = {
  doc: {
    chip: '<span data-doc-ref="true" data-page-id="77" data-canvas-id="5" data-title="설계" data-canvas-name="제품" class="doc-ref">설계</span>',
    link: () => `<a href="${window.location.origin}/canvas/5/77">설계</a>`,
    attr: /data-doc-ref=/g,
  },
  issue: {
    chip: '<span data-issue-ref="true" data-issue-id="7" data-task-id="1031" data-branch-id="10" data-display-id="PRO-220" '
      + 'data-title="재현" data-status="open" class="issue-ref">PRO-220 재현'
      + '<span class="ref-chip__badge ref-chip__badge--open" data-ref-badge="true">Open</span></span>',
    link: () => `<a href="${window.location.origin}/branch/10/task/1031/issue/7">PRO-220 재현</a>`,
    attr: /data-issue-ref=/g,
  },
};
// 첫째 줄 칩, 둘째 줄 일반 문장, 셋째 줄 같은 대상의 일반 링크 → 원문 다섯 줄: 칩, 빈 줄, 문장, 빈 줄, 링크
const three = (k) => `<p>${KIND[k].chip}</p><p>일반 문장</p><p>${KIND[k].link()}</p>`;
const reversed = (k) => `<p>${KIND[k].link()}</p><p>일반 문장</p><p>${KIND[k].chip}</p>`; // 일반 링크가 첫 줄, 칩이 끝 줄
// 칩(C)·일반 링크(L) 순서와, 그 둘과 일반 문장(S)의 글 순서
const seq = (html) => [...html.matchAll(/<span data-(?:doc|issue)-ref=|<a /g)].map((m) => (m[0].startsWith('<a') ? 'L' : 'C')).join('');
const order = (html) => [...html.matchAll(/<span data-(?:doc|issue)-ref=|<a |일반 문장|새 문장/g)]
  .map((m) => (m[0].startsWith('<a') ? 'L' : m[0].startsWith('<span') ? 'C' : 'S')).join('');
const count = (s, re) => (s.match(re) || []).length;

let root = null;
beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  PREFS.prefs = {};
  await i18next.changeLanguage('ko');
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  PREFS.prefs = {};
  await i18next.changeLanguage('en');
});
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

// 원문 편집기는 CodeMirror를 동적 import로 띄운다 — 뷰가 생길 때까지 기다린다
async function rawView() {
  let view = null;
  await vi.waitFor(() => {
    view = EditorView.findFromDOM(document.querySelector('.cm-editor') || document.body);
    expect(view, '원문 편집기').toBeTruthy();
  });
  return view;
}
// CodeMirror cut/copy/paste 처리기에 줄 클립보드(실제 브라우저의 event.clipboardData 자리)
const clip = { text: '' };
const clipboardEvent = (type) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => clip.text, setData: (_t, v) => { clip.text = v; }, clearData: () => { clip.text = ''; } },
  });
  return event;
};
// CodeMirror cut/copy 처리기는 화면 선택이 편집기 안에 있을 때만 동작한다(실제 브라우저에서는 커서를 둔 편집기 안) —
// jsdom에는 포커스·선택 동기화가 없어 화면 선택을 편집기 안에 직접 둔다
const selectionInside = (view) => {
  const range = document.createRange();
  range.setStart(view.contentDOM, 0);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  view.observer.readSelectionRange();
};
const line = (view, n) => view.state.doc.line(n < 0 ? view.state.doc.lines + 1 + n : n); // 1부터, -1 = 마지막 줄
const cursor = (view, n) => view.dispatch({ selection: EditorSelection.cursor(line(view, n).from) });
const repeat = (n, fn) => () => { for (let i = 0; i < n; i += 1) fn(); };
// 조작 묶음 — 각 단계는 사용자가 하는 한 동작(키 한 번·잘라내기 한 번…)
const KEYS = (view) => ({
  up: (n) => repeat(n, () => moveLineUp(view)),
  down: (n) => repeat(n, () => moveLineDown(view)),
  undo: (n) => repeat(n, () => undo(view)),
  redo: (n) => repeat(n, () => redo(view)),
  cut: () => { selectionInside(view); view.contentDOM.dispatchEvent(clipboardEvent('cut')); }, // 선택이 없으면 줄 단위
  copy: () => { selectionInside(view); view.contentDOM.dispatchEvent(clipboardEvent('copy')); },
  paste: () => view.contentDOM.dispatchEvent(clipboardEvent('paste')),
  at: (n) => () => cursor(view, n),
  lineEnd: (n) => () => view.dispatch({ selection: EditorSelection.cursor(line(view, n).to) }),
  selectLine: (n) => () => view.dispatch({ selection: EditorSelection.range(line(view, n).from, line(view, n).to) }),
  backspace: () => deleteCharBackward(view),
  end: () => view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) }),
  type: (text) => () => view.dispatch(view.state.replaceSelection(text), { annotations: Transaction.userEvent.of('input.type') }),
  // 한글 입력기 조합: 커서 앞 n글자를 바꿔 넣는다(첫 조합은 compose.start, 그 뒤 조합은 앞 묶음에 늘 이어진다)
  compose: (text, n, first = false) => () => {
    const at = view.state.selection.main.head;
    view.dispatch({ changes: { from: at - n, to: at, insert: text }, selection: { anchor: at - n + text.length }, userEvent: first ? 'input.type.compose.start' : 'input.type.compose' });
  },
});

async function commentSave(content, steps, { back = false } = {}) {
  const onSubmit = vi.fn(() => Promise.resolve());
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<CommentEditor initialContent={content} branchId={10} autoFocus onSubmit={onSubmit} onCancel={vi.fn()} />); });
  const box = document.querySelector('.CommentEditor');
  if (!PREFS.prefs.editor_raw_mode) await click(box.querySelector('.CommentEditor__RawToggle'));
  expect(box.querySelector('.CommentEditor__RawToggle--active'), '원문 모드').not.toBeNull();
  const view = await rawView();
  const original = view.state.doc.toString();
  await act(async () => { for (const step of steps(KEYS(view))) step(); });
  const raw = view.state.doc.toString();
  if (back) await click(box.querySelector('.CommentEditor__RawToggle')); // 일반 모드로 돌아와 저장
  await click([...box.querySelectorAll('button')].find((b) => b.textContent.trim() === '등록'));
  await act(async () => root.unmount());
  root = null;
  return { html: onSubmit.mock.calls[0][0], raw, original };
}

describe('태스크 댓글(CommentEditor): 같은 본문 안에서 줄을 옮겨도 칩·일반 링크가 제 형태다', () => {
  for (const kind of ['doc', 'issue']) {
    const CASES = [
      // [이름, 본문, 조작, 칩·링크 순서, 글 순서]
      ['일반 링크 줄을 Alt+↑로 맨 앞에(칩 줄이 아래로 밀린다)', three(kind), (k) => [k.at(-1), k.up(4)], 'LC', 'LCS'],
      ['일반 링크 줄을 Alt+↑로 가운데(문장 앞)에', three(kind), (k) => [k.at(-1), k.up(2)], 'CL', 'CLS'],
      ['칩 줄을 Alt+↑로 맨 앞에(일반 링크 줄이 아래로 밀린다)', `<p>${KIND[kind].link()}</p><p>일반 문장</p><p>${KIND[kind].chip}</p>`, (k) => [k.at(-1), k.up(4)], 'CL', 'CLS'],
      ['문장 줄을 Alt+↓로 맨 뒤에(일반 링크 줄이 위로 밀린다)', three(kind), (k) => [k.at(3), k.down(2)], 'CL', 'CLS'],
      ['칩 줄을 Alt+↓로 맨 뒤에', three(kind), (k) => [k.at(1), k.down(4)], 'LC', 'SLC'],
      ['일반 링크 줄을 잘라 맨 앞에 붙이기', three(kind), (k) => [k.at(-1), k.cut, k.at(1), k.paste], 'LC', 'LCS'],
      ['일반 링크 줄을 잘라 가운데(문장 앞)에 붙이기', three(kind), (k) => [k.at(-1), k.cut, k.at(3), k.paste], 'CL', 'CLS'],
      ['칩 줄을 잘라 맨 뒤에 붙이기', three(kind), (k) => [k.at(1), k.cut, k.end, k.type('\n'), k.paste], 'LC', 'SLC'],
      ['Alt+↑ 네 번 → 실행 취소 네 번(원래대로)', three(kind), (k) => [k.at(-1), k.up(4), k.undo(4)], 'CL', 'CSL'],
      ['Alt+↑ 네 번 → 실행 취소 네 번 → 다시 실행 네 번', three(kind), (k) => [k.at(-1), k.up(4), k.undo(4), k.redo(4)], 'LC', 'LCS'],
      ['잘라 맨 앞에 붙이기 → 실행 취소 두 번(원래대로)', three(kind), (k) => [k.at(-1), k.cut, k.at(1), k.paste, k.undo(2)], 'CL', 'CSL'],
      ['잘라 맨 앞에 붙이기 → 실행 취소 두 번 → 다시 실행 두 번', three(kind), (k) => [k.at(-1), k.cut, k.at(1), k.paste, k.undo(2), k.redo(2)], 'LC', 'LCS'],
      // 새로 추가한 링크는 기존 규칙(칩) — 옮긴 줄과 섞이지 않는다
      ['일반 링크 줄을 복사해 맨 앞에 붙이기(새 링크는 칩)', three(kind), (k) => [k.at(-1), k.copy, k.at(1), k.paste], 'CCL', 'CCSL'],
      ['잘라 맨 앞에 붙인 뒤 맨 뒤에 한 번 더 붙이기(두 번째는 새 링크라 칩)', three(kind), (k) => [k.at(-1), k.cut, k.at(1), k.paste, k.end, k.type('\n'), k.paste], 'LCC', 'LCSC'],
      ['일반 링크 줄을 잘라 지운 뒤 같은 글의 칩 줄을 복사해 붙이기(복사본은 칩)', three(kind), (k) => [k.at(-1), k.cut, k.at(1), k.copy, k.end, k.type('\n'), k.paste], 'CC', 'CSC'],
      // 옮기기 전에 그 줄 안을 고친 기록(이어 지운 두 글자)도 줄과 함께 옮겨져 실행 취소로 되살아난다
      ['일반 링크 끝 두 글자 지움 → 아래 줄 Alt+↑(링크 줄이 밀림) → 실행 취소 두 번', reversed(kind), (k) => [k.lineEnd(1), k.backspace, k.backspace, k.at(2), k.up(1), k.undo(2)], 'LC', 'LSC'],
      ['첫 줄(일반 링크) 잘라 문장 줄을 선택해 그 위에 붙이기', reversed(kind), (k) => [k.at(1), k.cut, k.selectLine(2), k.paste], 'LC', 'LC'],
    ];
    for (const [name, content, steps, expected, textOrder] of CASES) {
      it(`${kind}: ${name}`, async () => {
        for (const back of [false, true]) {
          const { html } = await commentSave(content, steps, { back });
          const at = `${back ? '일반 모드로 돌아와 저장' : '원문에서 저장'}`;
          expect(seq(html), at).toBe(expected);
          expect(order(html), `${at} — 글 순서`).toBe(textOrder);
        }
      });
    }
  }

  it('원문 모드 자동 진입에서도 같다(Alt+↑로 맨 앞에, 잘라 맨 앞에 붙이기)', async () => {
    PREFS.prefs = { editor_raw_mode: true };
    const up = await commentSave(three('doc'), (k) => [k.at(-1), k.up(4)]);
    expect(seq(up.html)).toBe('LC');
    const cut = await commentSave(three('issue'), (k) => [k.at(-1), k.cut, k.at(1), k.paste]);
    expect(seq(cut.html)).toBe('LC');
  });

  it('A안 긴 본문: 문장 줄을 Alt+↑로 링크 줄 위로 올리거나 링크 줄을 잘라 문장 위에 붙여도 일반 링크 그대로·1만 자 안', async () => {
    for (const [name, attr, total] of [['raw_doc_links_80', KIND.doc.attr, 80], ['raw_issue_links_40', KIND.issue.attr, 40]]) {
      const { P } = SERVER_CASES.find((c) => c.name === name);
      const flows = [
        ['문장 줄 Alt+↑ 두 번', (k) => [k.end, k.type('\n\n새 문장'), k.up(2)]],
        ['링크 줄 잘라 문장 위에 붙이기', (k) => [k.at(1), k.type('새 문장\n\n'), k.at(-1), k.cut, k.at(1), k.paste]],
      ];
      for (const [flow, steps] of flows) {
        for (const back of [false, true]) {
          const { html } = await commentSave(P, steps, { back });
          const at = `${name} ${flow} ${back ? '일반 모드 복귀' : '원문 저장'}`;
          expect(count(html, attr), `${at}: 칩`).toBe(0);
          expect(count(html, /<a /g), `${at}: 일반 링크`).toBe(total);
          expect(html, at).toContain('새 문장');
          expect(html.length, `${at}: 길이`).toBeLessThanOrEqual(10000);
        }
      }
    }
  });
});

// 0.5초 안에 이어 한 조작은 CodeMirror 기본 실행 취소 묶음 하나가 된다(잘라내기 두 번, Alt+↑ 직후 입력) — 테스트는 기다리지
// 않고 묶음도 끄지 않는다. 실행 취소 한 번이 묶음 안 여러 조작이 지운 글을 한꺼번에 되돌려도 각 링크가 제 형태다.
// Shift+Enter(<br>)로 줄을 바꾼 한 문단: 첫 줄·둘째 줄은 같은 제목·주소의 칩과 일반 링크, 셋째 줄 일반 문장, 넷째 줄 끝 문장
const twoLines = (k, first) => {
  const [a, b] = first === 'C' ? [KIND[k].chip, KIND[k].link()] : [KIND[k].link(), KIND[k].chip];
  return `<p>${a}<br>${b}<br>일반 문장<br>끝 문장</p>`;
};
const adjacent = (k) => `<p>${KIND[k].link()}<br>${KIND[k].chip}<br>일반 문장</p>`; // 일반 링크 줄, 칩 줄, 문장
const korean = (k) => [k.compose('ㅊ', 0, true), k.compose('추', 1), k.compose('춪', 1), k.compose('추가', 1)];

describe('태스크 댓글(CommentEditor): 빠른 연속 조작(실행 취소 한 묶음) 뒤 실행 취소·다시 실행해도 칩·일반 링크가 제 형태다', () => {
  const twoCut = (k) => [k.at(1), k.cut, k.cut, k.end, k.paste]; // 첫 줄에서 커서 이동 없이 잘라내기 두 번 → 마지막 줄에 붙이기
  for (const kind of ['doc', 'issue']) {
    for (const first of ['C', 'L']) {
      const other = first === 'C' ? 'L' : 'C';
      const CASES = [
        // [이름, 조작, 칩·링크 순서, 원문이 진입 때와 같아야 하는지]
        ['잘라내기 두 번 → 마지막 줄에 붙이기 → 실행 취소 두 번', (k) => [...twoCut(k), k.undo(2)], first + other, true],
        ['… → 실행 취소 두 번 → 다시 실행 두 번(옮긴 둘째 줄만 남는다)', (k) => [...twoCut(k), k.undo(2), k.redo(2)], other, false],
        ['… → 한 번 더 붙이기(복사본) → 실행 취소 세 번', (k) => [...twoCut(k), k.paste, k.undo(3)], first + other, true],
      ];
      for (const [name, steps, expected, restored] of CASES) {
        it(`${kind} ${first}${other}: ${name}`, async () => {
          for (const back of [false, true]) {
            const out = await commentSave(twoLines(kind, first), steps, { back });
            const at = back ? '일반 모드로 돌아와 저장' : '원문에서 저장';
            if (restored) expect(out.raw, `${at} — 원문`).toBe(out.original);
            expect(seq(out.html), at).toBe(expected);
          }
        });
      }
    }
    // 커서를 줄 끝에 두고 Alt+↑ → 바로 그 줄 끝에 입력(Alt+↑와 한 묶음) — 링크 글자·주소는 고치지 않는다
    const ALT = [
      ['칩 줄 끝에서 Alt+↑ → 바로 줄 끝에 입력 → 실행 취소', adjacent(kind), (k) => [k.lineEnd(2), k.up(1), k.type(' 추가'), k.undo(1)], 'LC'],
      ['칩 줄 끝에서 Alt+↑ → 바로 줄 끝에 입력 → 실행 취소 → 다시 실행', adjacent(kind), (k) => [k.lineEnd(2), k.up(1), k.type(' 추가'), k.undo(1), k.redo(1)], 'CL'],
      ['칩 줄 끝에서 Alt+↑ → 바로 한글 조합 입력 → 실행 취소 → 다시 실행', adjacent(kind), (k) => [k.lineEnd(2), k.up(1), ...korean(k), k.undo(1), k.redo(1)], 'CL'],
      ['문장 줄 끝에서 Alt+↑(일반 링크 줄이 밀린다) → 바로 줄 끝에 입력 → 실행 취소 → 다시 실행', `<p>${KIND[kind].link()}<br>일반 문장<br>끝 문장</p>`,
        (k) => [k.lineEnd(2), k.up(1), k.type(' 추가'), k.undo(1), k.redo(1)], 'L'],
      ['칩 줄 끝에서 Alt+↑ 두 번 → 바로 줄 끝에 입력 → 실행 취소 두 번 → 다시 실행 두 번', `<p>${KIND[kind].link()}<br>일반 문장<br>${KIND[kind].chip}</p>`,
        (k) => [k.lineEnd(3), k.up(2), k.type(' 추가'), k.undo(2), k.redo(2)], 'CL'],
      ['칩 줄 맨 앞에서 Alt+↓(일반 링크 줄이 밀린다) → 바로 줄 맨 앞에 입력 → 실행 취소', `<p>${KIND[kind].chip}<br>${KIND[kind].link()}<br>일반 문장</p>`,
        (k) => [k.at(1), k.down(1), k.type('앞글 '), k.undo(1)], 'CL'],
    ];
    for (const [name, content, steps, expected] of ALT) {
      it(`${kind}: ${name}`, async () => {
        for (const back of [false, true]) {
          const out = await commentSave(content, steps, { back });
          expect(seq(out.html), back ? '일반 모드로 돌아와 저장' : '원문에서 저장').toBe(expected);
        }
      });
    }
  }

  // 바뀐 글이 없는 실행 취소 묶음(커서를 옮겨 x 입력 → 바로 지우기, 한글을 조합했다 지우기)도 CodeMirror 실행 취소 한 번을 쓴다 —
  // 그 실행 취소는 글자를 바꾸지 않아도 따라가야 다음 실행 취소가 어긋나지 않는다
  const stray = (k) => [k.end, k.type('x'), k.backspace];
  const strayKo = (k) => [k.end, k.compose('ㅁ', 0, true), k.compose('', 1)];
  it('바뀐 글이 없는 실행 취소 묶음(입력 → 바로 지우기)이 끼어도 각 링크가 제 형태다', async () => {
    for (const kind of ['doc', 'issue']) {
      for (const first of ['C', 'L']) {
        const other = first === 'C' ? 'L' : 'C';
        const flows = [
          ['잘라내기 두 번 → 붙이기 → x 입력·지우기 → 실행 취소 세 번', (k) => [...twoCut(k), ...stray(k), k.undo(3)]],
          ['잘라내기 두 번 → 붙이기 → 한글 조합했다 지우기 → 실행 취소 세 번', (k) => [...twoCut(k), ...strayKo(k), k.undo(3)]],
          ['잘라내기 두 번 → x 입력·지우기 → 붙이기 → 실행 취소 세 번', (k) => [k.at(1), k.cut, k.cut, ...stray(k), k.paste, k.undo(3)]],
          ['끝에 입력 → 잘라내기 두 번 → 붙이기 → 실행 취소 두 번 → x 입력·지우기 → 실행 취소 두 번',
            (k) => [k.end, k.type(' z'), ...twoCut(k), k.undo(2), ...stray(k), k.undo(2)]],
        ];
        for (const [name, steps] of flows) {
          const out = await commentSave(twoLines(kind, first), steps);
          expect(out.raw, `${kind} ${first}${other} ${name} — 원문`).toBe(out.original);
          expect(seq(out.html), `${kind} ${first}${other} ${name}`).toBe(first + other);
        }
      }
      const alt = await commentSave(adjacent(kind), (k) => [k.lineEnd(2), k.up(1), k.type(' 추가'), ...stray(k), k.undo(2), k.redo(1)]);
      expect(seq(alt.html), `${kind} Alt+↑ 직후 입력 → x 입력·지우기 → 실행 취소 두 번 → 다시 실행`).toBe('CL');
    }
  });

  // 클립보드는 실행 취소되지 않는다 — 잘라낸 줄이 실행 취소로 제자리에 돌아온 뒤(또는 복사한 뒤) 붙인 글은 복사본이라 새 링크(칩)
  it('잘라내기·붙여넣기를 실행 취소한 뒤 붙인 글은 복사본이다(새 링크는 칩)', async () => {
    for (const kind of ['doc', 'issue']) {
      const L1 = await commentSave(three(kind), (k) => [k.at(-1), k.cut, k.at(1), k.paste, k.at(1), k.copy, k.undo(1), k.end, k.type('\n'), k.paste]);
      expect(seq(L1.html), `${kind} 잘라 맨 앞에 붙이기 → 그 줄 복사 → 실행 취소 → 끝에 붙이기`).toBe('CC');
      const steps = (k) => [k.at(1), k.cut, k.at(1), k.cut, k.undo(1), k.end, k.type('\n'), k.paste];
      const L2 = await commentSave(adjacent(kind), steps);
      expect(seq(L2.html), `${kind} 일반 링크 줄 잘라내기 → 칩 줄 잘라내기 → 실행 취소 → 끝에 붙이기`).toBe('CC');
      const L3 = await commentSave(`<p>${KIND[kind].chip}<br>${KIND[kind].link()}<br>일반 문장</p>`, steps);
      expect(seq(L3.html), `${kind} 칩 줄 잘라내기 → 일반 링크 줄 잘라내기 → 실행 취소 → 끝에 붙이기`).toBe('LC');
    }
  });

  it('되돌린 뒤 상관없는 입력·실행 취소를 더 해도 링크 형태가 같다', async () => {
    const body = `<p>${KIND.doc.link()}<br>${KIND.doc.chip}<br>일반 문장<br>끝 문장</p>`;
    const head = (k) => [k.at(1), k.cut, k.selectLine(2), k.paste, k.undo(1)]; // 잘라 둔 줄을 문장 줄 선택 위에 붙였다 실행 취소
    const tail = (k) => [k.at(1), k.copy, k.at(1), k.paste];
    const plain = await commentSave(body, (k) => [...head(k), ...tail(k)]);
    const more = await commentSave(body, (k) => [...head(k), k.end, k.type(' a'), k.lineEnd(2), k.type(' b'), k.undo(1), ...tail(k)]);
    expect(seq(more.html)).toBe(seq(plain.html));
  });

  it('원문 모드 자동 진입에서도 같다(잘라내기 두 번 → 붙이기 → 실행 취소 두 번, Alt+↑ 직후 입력 → 실행 취소 → 다시 실행)', async () => {
    PREFS.prefs = { editor_raw_mode: true };
    const cut = await commentSave(twoLines('doc', 'L'), (k) => [...twoCut(k), k.undo(2)]);
    expect(cut.raw).toBe(cut.original);
    expect(seq(cut.html)).toBe('LC');
    const alt = await commentSave(adjacent('issue'), (k) => [k.lineEnd(2), k.up(1), k.type(' 추가'), k.undo(1), k.redo(1)]);
    expect(seq(alt.html)).toBe('CL');
  });

  it('A안 긴 본문: 링크 줄과 문장 줄을 이어 잘라 문장 하나만 끝으로 옮긴 뒤 실행 취소 두 번 — 일반 링크 그대로·1만 자 안', async () => {
    for (const [name, attr, total] of [['raw_doc_links_80', KIND.doc.attr, 80], ['raw_issue_links_40', KIND.issue.attr, 40]]) {
      const { P } = SERVER_CASES.find((c) => c.name === name);
      const inner = P.replace(/^<p>|<\/p>\s*$/g, '');
      const bodies = [
        ['링크 줄이 첫 줄', `<p>${inner}<br>일반 문장<br>둘째 문장<br>끝 문장</p>`],
        ['링크 줄이 둘째 줄', `<p>일반 문장<br>${inner}<br>둘째 문장<br>끝 문장</p>`],
      ];
      for (const [where, content] of bodies) {
        for (const back of [false, true]) {
          const out = await commentSave(content, (k) => [...twoCut(k), k.undo(2)], { back });
          const at = `${name} ${where} ${back ? '일반 모드 복귀' : '원문 저장'}`;
          expect(out.raw, `${at}: 원문`).toBe(out.original);
          expect(count(out.html, attr), `${at}: 칩`).toBe(0);
          expect(count(out.html, /<a /g), `${at}: 일반 링크`).toBe(total);
          expect(out.html.length, `${at}: 길이`).toBeLessThanOrEqual(10000);
        }
      }
    }
  });
});

// 같은 자리에 붙이기: 잘라낸 줄을 그대로 되붙이면 원래 형태, 그 사이 남은 줄을 새로 복사해 붙이면 복사본(새 링크 → 칩). 같은 제목·주소라
// 두 경우 모두 원문 글자가 진입 때와 같다 — 글자가 아니라 잘라내기·복사 조작으로 가른다
const sameSpotBody = (k) => `<p>${KIND[k].link()}<br>${KIND[k].chip}<br>일반 문장</p>`; // 일반 링크 줄, 같은 글의 칩 줄, 문장
const keepPaste = (k) => [k.at(1), k.cut, k.at(1), k.paste]; // 일반 링크 줄 잘라내기 → 그 자리에 그대로 붙이기
const copyPaste = (k) => [k.at(1), k.cut, k.at(1), k.copy, k.at(1), k.paste]; // … → 남은 칩 줄 복사 → 그 자리에 붙이기

describe('태스크 댓글(CommentEditor): 같은 자리에 붙이기 — 잘라 그대로 되붙이면 원래 형태, 새로 복사해 붙이면 칩', () => {
  for (const kind of ['doc', 'issue']) {
    it(`${kind}: 원문에서 저장·일반 모드로 돌아와 저장`, async () => {
      for (const back of [false, true]) {
        const at = back ? '일반 모드로 돌아와 저장' : '원문에서 저장';
        const kept = await commentSave(sameSpotBody(kind), keepPaste, { back });
        expect(kept.raw, `${at} 그대로 되붙이기 — 원문`).toBe(kept.original);
        expect(seq(kept.html), `${at} 그대로 되붙이기`).toBe('LC');
        const copied = await commentSave(sameSpotBody(kind), copyPaste, { back });
        expect(copied.raw, `${at} 새로 복사해 붙이기 — 원문(글자는 같다)`).toBe(copied.original);
        expect(seq(copied.html), `${at} 새로 복사해 붙이기`).toBe('CC');
      }
    });
    it(`${kind}: 실행 취소·다시 실행`, async () => {
      const save = async (steps) => seq((await commentSave(sameSpotBody(kind), steps)).html);
      expect(await save((k) => [...copyPaste(k), k.undo(1)]), '복사해 붙이기 → 실행 취소(잘라 둔 상태)').toBe('C');
      expect(await save((k) => [...copyPaste(k), k.undo(2)]), '… → 실행 취소 두 번(원래대로)').toBe('LC');
      expect(await save((k) => [...copyPaste(k), k.undo(2), k.redo(2)]), '… → 다시 실행 두 번(복사본)').toBe('CC');
      expect(await save((k) => [...keepPaste(k), k.undo(2), k.redo(2)]), '그대로 되붙이기 → 실행 취소 두 번 → 다시 실행 두 번').toBe('LC');
    });
  }

  it('원문 모드 자동 진입에서도 같다', async () => {
    PREFS.prefs = { editor_raw_mode: true };
    expect(seq((await commentSave(sameSpotBody('doc'), copyPaste)).html)).toBe('CC');
    expect(seq((await commentSave(sameSpotBody('issue'), keepPaste)).html)).toBe('LC');
  });

  it('A안 긴 본문: 일반 링크 줄을 잘라 그대로 되붙여도 일반 링크 그대로·1만 자 안', async () => {
    for (const [name, attr, total] of [['raw_doc_links_80', KIND.doc.attr, 80], ['raw_issue_links_40', KIND.issue.attr, 40]]) {
      const { P } = SERVER_CASES.find((c) => c.name === name);
      const content = `<p>${P.replace(/^<p>|<\/p>\s*$/g, '')}<br>일반 문장</p>`;
      for (const back of [false, true]) {
        const out = await commentSave(content, keepPaste, { back });
        const at = `${name} ${back ? '일반 모드 복귀' : '원문 저장'}`;
        expect(out.raw, `${at}: 원문`).toBe(out.original);
        expect(count(out.html, attr), `${at}: 칩`).toBe(0);
        expect(count(out.html, /<a /g), `${at}: 일반 링크`).toBe(total);
        expect(out.html.length, `${at}: 길이`).toBeLessThanOrEqual(10000);
      }
    }
  });
});

describe('이슈 댓글(IssueEditor): 같은 본문 안에서 줄을 옮겨도 칩·일반 링크가 제 형태다', () => {
  async function issueHtml(content, steps) {
    const ref = createRef();
    root = createRoot(document.getElementById('root'));
    await act(async () => { root.render(<IssueEditor ref={ref} content={content} rawModeEnabled branchId={10} />); });
    await click(document.querySelector('button[title="Markdown 소스로 편집"]'));
    const view = await rawView();
    await act(async () => { for (const step of steps(KEYS(view))) step(); });
    const html = ref.current.getHTML();
    await act(async () => root.unmount());
    root = null;
    return html;
  }
  for (const kind of ['doc', 'issue']) {
    it(`${kind}: Alt+↑로 맨 앞에 · 칩 줄 Alt+↓로 맨 뒤에 · 잘라 맨 앞에 붙이기 → 실행 취소 → 다시 실행`, async () => {
      expect(seq(await issueHtml(three(kind), (k) => [k.at(-1), k.up(4)]))).toBe('LC');
      expect(seq(await issueHtml(three(kind), (k) => [k.at(1), k.down(4)]))).toBe('LC');
      expect(seq(await issueHtml(three(kind), (k) => [k.at(-1), k.cut, k.at(1), k.paste]))).toBe('LC');
      expect(seq(await issueHtml(three(kind), (k) => [k.at(-1), k.cut, k.at(1), k.paste, k.undo(2)]))).toBe('CL');
      expect(seq(await issueHtml(three(kind), (k) => [k.at(-1), k.cut, k.at(1), k.paste, k.undo(2), k.redo(2)]))).toBe('LC');
    });
    it(`${kind}: 빠른 연속 조작 — 잘라내기 두 번 → 붙이기 → 실행 취소 두 번, Alt+↑ 직후 줄 끝에 입력 → 실행 취소 → 다시 실행`, async () => {
      for (const first of ['C', 'L']) {
        const other = first === 'C' ? 'L' : 'C';
        expect(seq(await issueHtml(twoLines(kind, first), (k) => [k.at(1), k.cut, k.cut, k.end, k.paste, k.undo(2)])), first).toBe(first + other);
      }
      expect(seq(await issueHtml(adjacent(kind), (k) => [k.lineEnd(2), k.up(1), k.type(' 추가'), k.undo(1), k.redo(1)]))).toBe('CL');
    });
    it(`${kind}: 같은 자리에 붙이기 — 잘라 그대로 되붙이면 원래 형태, 새로 복사해 붙이면 칩`, async () => {
      expect(seq(await issueHtml(sameSpotBody(kind), keepPaste)), '그대로 되붙이기').toBe('LC');
      expect(seq(await issueHtml(sameSpotBody(kind), copyPaste)), '새로 복사해 붙이기').toBe('CC');
    });
  }
});

// 원문 모드로 바꿀 때 숨겨지는 일반 모드 편집기에 문서 선택(커서)이 남으면, 새로 뜬 원문 편집기(CodeMirror)가 그 선택을 마지막 화면
// 선택으로 기억한다. 그러면 Chrome에서 원문 편집기를 처음 클릭한 직후 Alt+↓로 줄을 빈 줄 아래로 옮길 때 커서가 옮긴 줄을 따라가지
// 못하고 이전 줄로 돌아간다(태스크 댓글은 일반 모드 편집기에 자동 포커스라 늘 남는다). 그 되돌아감은 Chrome의 선택 처리에서만 일어나
// 실제 Chrome으로 확인하고, 여기서는 원인(숨겨진 편집기에 남은 선택)과 실제 키 입력의 줄 이동·커서·저장을 확인한다
const selectionInRich = () => {
  const s = document.getSelection();
  return s.rangeCount > 0 && [...document.querySelectorAll('.ProseMirror')].some((pm) => pm.contains(s.anchorNode));
};
const press = (view, key, mods = {}) => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
  key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, keyCode: { ArrowDown: 40, ArrowUp: 38 }[key] ?? key.toUpperCase().charCodeAt(0),
  bubbles: true, cancelable: true, ...mods,
}));
const cursorLine = (view) => view.state.doc.lineAt(view.state.selection.main.head).number;
const domCursorLine = (view) => {
  const s = document.getSelection();
  return [...view.contentDOM.querySelectorAll('.cm-line')].findIndex((l) => l.contains(s.focusNode)) + 1;
};
const paraBody = '<p>첫째 줄</p><p>둘째 줄</p><p>셋째 줄</p>'; // 문단 셋(Enter) — 원문에서 줄 사이에 빈 줄
const linesBody = '<p>첫째 줄<br>둘째 줄<br>셋째 줄</p>'; // Shift+Enter로 붙여 쓴 세 줄
const paraLinks = (k) => `<p>${KIND[k].chip}</p><p>${KIND[k].link()}</p><p>일반 문장</p>`; // 문단: 칩, 같은 제목·주소 일반 링크, 문장

describe('원문 모드 Alt+↓ 연속: 커서가 옮긴 줄을 따라간다', () => {
  it('태스크 댓글(CommentEditor, 일반 모드 편집기 자동 포커스): 원문 모드로 바꾸면 숨겨진 일반 모드 편집기에 선택이 남지 않는다', async () => {
    root = createRoot(document.getElementById('root'));
    await act(async () => { root.render(<CommentEditor initialContent={paraBody} branchId={10} autoFocus onSubmit={vi.fn()} onCancel={vi.fn()} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); // 일반 모드 편집기 자동 포커스
    expect(selectionInRich(), '원문 모드로 바꾸기 전 — 일반 모드 편집기에 커서').toBe(true);
    await click(document.querySelector('.CommentEditor__RawToggle'));
    await rawView();
    expect(selectionInRich(), '원문 모드로 바꾼 뒤').toBe(false);
  });

  it('이슈 댓글(IssueEditor): 일반 모드 편집기를 먼저 눌러 둔 뒤 원문 모드로 바꿔도 선택이 남지 않는다', async () => {
    const ref = createRef();
    root = createRoot(document.getElementById('root'));
    await act(async () => { root.render(<IssueEditor ref={ref} content={paraBody} rawModeEnabled branchId={10} />); });
    await act(async () => { ref.current.focus(); await new Promise((r) => setTimeout(r, 20)); });
    expect(selectionInRich(), '원문 모드로 바꾸기 전 — 일반 모드 편집기에 커서').toBe(true);
    await click(document.querySelector('button[title="Markdown 소스로 편집"]'));
    await rawView();
    expect(selectionInRich(), '원문 모드로 바꾼 뒤').toBe(false);
  });

  // 편집을 열기 전에 누른 글자(편집 창 밖 읽던 글)의 커서도 페이지에 남는다 — 원문 편집기가 그 선택을 기억하면 같은 문제다
  // (Chrome 실측: 이슈 댓글 수동 전환, 원문 모드로 바로 열리는 태스크·이슈 댓글)
  const outsideText = () => {
    const p = document.createElement('p');
    p.textContent = '읽던 글';
    document.body.appendChild(p);
    return p.firstChild;
  };
  const remembered = (view) => view.observer.selectionRange.focusNode; // CodeMirror가 기억한 마지막 화면 선택

  it('이슈 댓글: 편집을 열기 전에 누른 글자의 커서가 남아 있어도 원문 편집기는 그 선택을 기억하지 않는다', async () => {
    const ref = createRef();
    root = createRoot(document.getElementById('root'));
    await act(async () => { root.render(<IssueEditor ref={ref} content={paraBody} rawModeEnabled branchId={10} />); });
    document.getSelection().collapse(outsideText(), 2);
    await click(document.querySelector('button[title="Markdown 소스로 편집"]'));
    const view = await rawView();
    expect(document.getSelection().rangeCount, '편집기 밖에 남은 커서').toBe(0);
    expect(remembered(view), '원문 편집기가 기억한 선택').toBeNull();
  });

  it('태스크 댓글: 원문 모드로 바로 열려도(저장된 원문 모드) 앞서 누른 글자의 커서를 기억하지 않는다', async () => {
    PREFS.prefs = { editor_raw_mode: true };
    document.getSelection().collapse(outsideText(), 2);
    root = createRoot(document.getElementById('root'));
    await act(async () => { root.render(<CommentEditor initialContent={paraBody} branchId={10} autoFocus onSubmit={vi.fn()} onCancel={vi.fn()} />); });
    const view = await rawView();
    expect(document.querySelector('.CommentEditor__RawToggle--active'), '원문 모드').not.toBeNull();
    expect(remembered(view), '원문 편집기가 기억한 선택').toBeNull();
  });

  it('다른 곳에 잡아 둔 범위 선택(복사하려던 글)은 원문 모드로 바꿔도 그대로 둔다', async () => {
    const ref = createRef();
    root = createRoot(document.getElementById('root'));
    await act(async () => { root.render(<IssueEditor ref={ref} content={paraBody} rawModeEnabled branchId={10} />); });
    const text = outsideText();
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 2);
    document.getSelection().removeAllRanges();
    document.getSelection().addRange(range);
    await click(document.querySelector('button[title="Markdown 소스로 편집"]'));
    await rawView();
    expect(document.getSelection().toString()).toBe('읽던');
  });

  // 원문 편집기 첫 줄을 클릭한 것처럼(실제 Chrome의 순서): 포커스 → 포커스 때 브라우저가 화면 선택을 편집기 맨 앞에 둔다 →
  // CodeMirror 포인터 선택(select.pointer)
  const clickFirstLine = (view) => {
    view.contentDOM.focus();
    const first = view.contentDOM.querySelector('.cm-line');
    document.getSelection().collapse(first.firstChild || first, 0);
    view.dispatch({ selection: EditorSelection.cursor(0), userEvent: 'select.pointer' });
  };
  // 실제 키 입력(keydown → CodeMirror 키맵)을 차례로 보내고, 키마다 줄과 커서 줄(편집기 상태, 화면 선택)을 적는다
  const pressKeys = (view, keys) => keys.map((k) => {
    if (k === 'down' || k === 'up') press(view, k === 'down' ? 'ArrowDown' : 'ArrowUp', { altKey: true });
    else if (k === 'undo') press(view, 'z', { ctrlKey: true });
    else if (k === 'redo') press(view, 'y', { ctrlKey: true }); // jsdom은 macOS가 아니라 CodeMirror 다시 실행 키가 Mod-y(맥은 Cmd+Shift+Z)
    return { lines: view.state.doc.toString().split('\n').map((l) => l.trim()), cursor: cursorLine(view), dom: domCursorLine(view) };
  });
  // 첫 줄 맨 앞에 커서를 한 번 두고 이어 누른다 — 그 사이 커서를 다시 놓지 않는다
  async function pressInComment(content, keys, { back = false } = {}) {
    const onSubmit = vi.fn(() => Promise.resolve());
    root = createRoot(document.getElementById('root'));
    await act(async () => { root.render(<CommentEditor initialContent={content} branchId={10} autoFocus onSubmit={onSubmit} onCancel={vi.fn()} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); // 편집 창이 열리며 일반 모드 편집기에 자동 포커스 — 그 뒤 원문 토글
    const box = document.querySelector('.CommentEditor');
    await click(box.querySelector('.CommentEditor__RawToggle'));
    const view = await rawView();
    const trail = [];
    await act(async () => {
      clickFirstLine(view);
      trail.push(...pressKeys(view, keys));
    });
    if (back) await click(box.querySelector('.CommentEditor__RawToggle')); // 일반 모드로 돌아와 저장
    await click([...box.querySelectorAll('button')].find((b) => b.textContent.trim() === '등록'));
    await act(async () => root.unmount());
    root = null;
    return { trail, html: onSubmit.mock.calls[0][0] };
  }
  const textOrder = (html) => [...html.matchAll(/첫째 줄|둘째 줄|셋째 줄/g)].map((m) => m[0]).join(' / ');

  it('문단 세 줄: Alt+↓ 두 번이면 첫째 줄이 계속 내려가고 커서가 따라간다 → Alt+↑ 두 번이면 제자리(원문 저장·일반 모드 저장)', async () => {
    for (const back of [false, true]) {
      const at = back ? '일반 모드로 돌아와 저장' : '원문에서 저장';
      const down = await pressInComment(paraBody, ['down', 'down'], { back });
      expect(down.trail.map((s) => s.lines.join('/')), at).toEqual(['/첫째 줄/둘째 줄//셋째 줄', '/둘째 줄/첫째 줄//셋째 줄']);
      expect(down.trail.map((s) => [s.cursor, s.dom]), `${at} — 커서 줄(편집기 상태, 화면 선택)`).toEqual([[2, 2], [3, 3]]);
      expect(textOrder(down.html), `${at} — 저장된 순서`).toBe('둘째 줄 / 첫째 줄 / 셋째 줄');
      const back2 = await pressInComment(paraBody, ['down', 'down', 'up', 'up'], { back });
      expect(back2.trail.map((s) => s.cursor), `${at} — Alt+↑ 두 번`).toEqual([2, 3, 2, 1]);
      expect(textOrder(back2.html), `${at} — 제자리`).toBe('첫째 줄 / 둘째 줄 / 셋째 줄');
    }
  });

  it('Shift+Enter로 붙여 쓴 세 줄: 둘째 줄 / 첫째 줄 / 셋째 줄 → 둘째 줄 / 셋째 줄 / 첫째 줄, 커서는 계속 첫째 줄', async () => {
    const { trail, html } = await pressInComment(linesBody, ['down', 'down']);
    expect(trail.map((s) => s.lines.join('/'))).toEqual(['둘째 줄/첫째 줄/셋째 줄', '둘째 줄/셋째 줄/첫째 줄']);
    expect(trail.map((s) => [s.cursor, s.dom])).toEqual([[2, 2], [3, 3]]);
    expect(textOrder(html)).toBe('둘째 줄 / 셋째 줄 / 첫째 줄');
  });

  for (const kind of ['doc', 'issue']) {
    it(`${kind}: 칩 줄을 Alt+↓ 두 번(같은 제목·주소 일반 링크 줄 아래로) → 실행 취소 두 번 → 다시 실행 두 번 — 커서·칩·일반 링크 형태`, async () => {
      for (const back of [false, true]) {
        const at = back ? '일반 모드로 돌아와 저장' : '원문에서 저장';
        const moved = await pressInComment(paraLinks(kind), ['down', 'down'], { back });
        expect(moved.trail.map((s) => [s.cursor, s.dom]), at).toEqual([[2, 2], [3, 3]]);
        expect(seq(moved.html), `${at} — 일반 링크 · 칩`).toBe('LC');
        const undone = await pressInComment(paraLinks(kind), ['down', 'down', 'undo', 'undo', 'redo', 'redo'], { back });
        expect(undone.trail.map((s) => s.cursor), `${at} — 실행 취소·다시 실행의 커서 줄`).toEqual([2, 3, 2, 1, 2, 3]);
        expect(seq(undone.html), `${at} — 다시 실행 뒤`).toBe('LC');
      }
    });
  }

  // 원문 편집기가 뜬 뒤 편집기 밖 다른 본문 글자를 누르면 화면 선택이 그 글자로 가고(selectionchange), CodeMirror는 포커스가 없어도
  // 그 선택을 기억한다. 그 뒤 원문 편집기 첫 줄을 누르면(mousedown) CodeMirror가 포커스하고, 포커스 때 Chrome이 화면 선택을 편집기 맨
  // 앞에 둔 뒤 포인터 선택이 들어온다. 기억한 선택이 편집기 밖이면 이 포인터 선택에서 화면 선택을 다시 읽지 않아 "포커스 직후 0.2초 안
  // 편집기 맨 앞 선택은 브라우저 포커스 부작용" 판단(lastFocusTime)이 남고, Chrome에서는 클릭 직후 Alt+↓로 빈 줄을 넘길 때 밀려난 화면
  // 선택을 그 부작용으로 보고 커서를 1줄로 되돌린다. jsdom은 줄을 옮길 때 화면 선택을 밀어내지 않아 그 되돌림은 실제 Chrome으로
  // 확인하고, 여기서는 클릭 뒤 그 판단이 남지 않는지와 실제 키 입력의 줄 이동·커서·저장을 확인한다.
  describe('원문 편집기가 뜬 뒤 편집기 밖 글자를 눌렀다 돌아와도 Alt+↓ 커서가 옮긴 줄을 따라간다', () => {
    const clickOutsideText = () => {
      document.getSelection().collapse(outsideText(), 2);
      document.dispatchEvent(new Event('selectionchange')); // 실제 브라우저가 보내는 선택 변경 알림
    };
    const rememberedOutside = (view) => {
      const n = remembered(view);
      return !!n && !view.dom.contains(n);
    };
    // 원문 편집기 첫 줄을 마우스로 누른다 — CodeMirror의 실제 mousedown 처리를 쓰고, jsdom에 없는 것만 채운다:
    // 좌표 → 위치(레이아웃이 없다: 첫 줄 맨 앞), 포커스 때 화면 선택을 편집기 맨 앞에 두는 Chrome 동작
    const clickFirstLineWithMouse = (view) => {
      const first = view.contentDOM.querySelector('.cm-line');
      view.posAndSideAtCoords = () => ({ pos: 0, assoc: 1 });
      view.contentDOM.focus = function (options) {
        HTMLElement.prototype.focus.call(this, options);
        document.getSelection().collapse(first.firstChild || first, 0);
      };
      try {
        first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: 5, clientY: 5 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: 5, clientY: 5 }));
      } finally {
        delete view.posAndSideAtCoords;
        delete view.contentDOM.focus;
      }
    };
    const focusJudgmentLeft = (view) => view.inputState.lastFocusTime > 0;

    // surface: 'task'(태스크 댓글 CommentEditor) | 'issue'(이슈 댓글 IssueEditor), auto: 저장된 원문 모드로 바로 열림
    async function clickAwayThenMove(surface, content, keys, { auto = false, back = false, away = true } = {}) {
      if (auto) PREFS.prefs = { editor_raw_mode: true };
      const onSubmit = vi.fn(() => Promise.resolve());
      const ref = createRef();
      root = createRoot(document.getElementById('root'));
      await act(async () => {
        root.render(surface === 'task'
          ? <CommentEditor initialContent={content} branchId={10} autoFocus onSubmit={onSubmit} onCancel={vi.fn()} />
          : <IssueEditor ref={ref} content={content} rawModeEnabled branchId={10} />);
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); // 태스크 댓글은 편집 창이 열리며 일반 모드 편집기에 자동 포커스(이슈 편집기는 없음)
      const rawOn = surface === 'task' ? '.CommentEditor__RawToggle' : 'button[title="Markdown 소스로 편집"]';
      const rawOff = surface === 'task' ? '.CommentEditor__RawToggle' : 'button[title="Rich text 편집으로 전환"]';
      if (!auto) await click(document.querySelector(rawOn));
      const view = await rawView();
      if (away) await act(async () => { clickOutsideText(); });
      const before = rememberedOutside(view); // 원문 편집기가 편집기 밖 선택을 기억한 상태(이번 흐름의 조건)
      let left = null;
      const trail = [];
      await act(async () => {
        clickFirstLineWithMouse(view);
        left = focusJudgmentLeft(view);
        trail.push(...pressKeys(view, keys));
      });
      if (back) await click(document.querySelector(rawOff)); // 일반 모드로 돌아와 저장
      let html;
      if (surface === 'task') {
        await click([...document.querySelectorAll('.CommentEditor button')].find((b) => b.textContent.trim() === '등록'));
        html = onSubmit.mock.calls[0][0];
      } else html = ref.current.getHTML();
      await act(async () => root.unmount());
      root = null;
      return { before, left, trail, html };
    }

    for (const surface of ['task', 'issue']) {
      const name = surface === 'task' ? '태스크 댓글' : '이슈 댓글';
      for (const auto of [false, true]) {
        it(`${name}(${auto ? '원문 모드로 바로 열림' : '원문 모드로 수동 전환'}): 밖 글자 → 첫 줄 클릭 → Alt+↓ 두 번 — 커서가 따라가고 옮긴 순서로 저장`, async () => {
          for (const back of auto ? [false] : [false, true]) {
            const at = back ? '일반 모드로 돌아와 저장' : '원문에서 저장';
            const r = await clickAwayThenMove(surface, paraBody, ['down', 'down'], { auto, back });
            expect(r.before, `${at} — 클릭 전 원문 편집기가 편집기 밖 선택을 기억`).toBe(true);
            expect(r.left, `${at} — 클릭 뒤 "포커스 직후 맨 앞 선택 무시" 판단이 남지 않음`).toBe(false);
            expect(r.trail.map((s) => s.lines.join('/')), at).toEqual(['/첫째 줄/둘째 줄//셋째 줄', '/둘째 줄/첫째 줄//셋째 줄']);
            expect(r.trail.map((s) => [s.cursor, s.dom]), `${at} — 커서 줄(편집기 상태, 화면 선택)`).toEqual([[2, 2], [3, 3]]);
            expect(textOrder(r.html), `${at} — 저장된 순서`).toBe('둘째 줄 / 첫째 줄 / 셋째 줄');
          }
        });
      }
    }

    it('대조: 편집기 밖을 누르지 않고 바로 첫 줄을 누르면(기존 정상 경로) 판단이 남지 않는다', async () => {
      for (const surface of ['task', 'issue']) {
        const r = await clickAwayThenMove(surface, paraBody, ['down', 'down'], { away: false });
        expect(r.before, surface).toBe(false);
        expect(r.left, surface).toBe(false);
        expect(r.trail.map((s) => [s.cursor, s.dom]), surface).toEqual([[2, 2], [3, 3]]);
      }
    });

    for (const kind of ['doc', 'issue']) {
      it(`${kind}: 밖 글자 → 칩 줄 클릭 → Alt+↓ 두 번 → 실행 취소 두 번 → 다시 실행 두 번 — 커서·칩·일반 링크 형태(태스크 댓글)`, async () => {
        const r = await clickAwayThenMove('task', paraLinks(kind), ['down', 'down', 'undo', 'undo', 'redo', 'redo']);
        expect(r.before, '클릭 전 원문 편집기가 편집기 밖 선택을 기억').toBe(true);
        expect(r.left, '클릭 뒤 판단이 남지 않음').toBe(false);
        expect(r.trail.map((s) => s.cursor), '실행 취소·다시 실행의 커서 줄').toEqual([2, 3, 2, 1, 2, 3]);
        expect(seq(r.html), '다시 실행 뒤 일반 링크 · 칩').toBe('LC');
      });
    }
  });
});
