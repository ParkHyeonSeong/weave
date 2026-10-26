// @vitest-environment jsdom
// 서버가 저장한 HTML(P: 일반 링크, C: ref 칩)을 실제 편집기로 수정창처럼 열어 아무것도 고치지 않고
// 저장할 때의 길이(B)를 공유 픽스처에 고정한다. 백엔드는 같은 픽스처로 상한 U(C) ≥ B를 검증한다.
// 설계: docs/superpowers/specs/2026-10-22-ref-link-chip-ingress-design.md §5.8.1·§5.8.6
//
// 재생성: REGEN_RESERIALIZE=1 npx vitest run library/reserializeGrowth.dom.test.js
// (P/C는 백엔드에서: docker compose exec -T backend python -m tests.reserialize_fixture_gen)
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor } from '@tiptap/core';
import { ChangeSet, EditorState, Text, Transaction } from '@codemirror/state';
import { history, isolateHistory, moveLineDown, moveLineUp, redo, undo, undoDepth } from '@codemirror/commands';
import { buildCommentEditorExtensions } from '@/components/Branch/Tasks/commentEditorExtensions';
import { buildIssueEditorExtensions } from '@/components/Branch/Tasks/issueEditorExtensions';
import { buildTaskDescriptionExtensions } from '@/components/Branch/Tasks/taskDescriptionExtensions';
import { buildCanvasEditorExtensions } from '@/components/Canvas/canvasEditorExtensions';
import { MarkdownClipboardExtension } from '@/components/Canvas/extensions/MarkdownClipboardExtension';
import { buildMarkdownExtensions, htmlToMarkdown } from '@/library/markdownCodec';
import { enterRawState, parseRawToHtml } from '@/library/rawMode';
import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';

const FIXTURE = resolve(__dirname, '../../backend/tests/fixtures/reserialize_growth_cases.json');
const data = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const REGEN = process.env.REGEN_RESERIALIZE === '1';
const PAD_TOKEN = 'Zpadz';
const tick = () => new Promise((r) => setTimeout(r, 0));

// 각 경로의 실제 수정 화면과 같은 방식으로 연다. 댓글은 CommentItem → CommentEditor autofocus,
// 이슈·캔버스는 자동 포커스가 없어 첫 클릭과 같은 포커스 트랜잭션 1회. 생성 직후 길이만 재지 않는다.
const EDITORS = {
  comment: { build: () => buildCommentEditorExtensions({ branchId: 10 }), autofocus: true },
  issue: { build: () => buildIssueEditorExtensions({ branchId: 10 }), autofocus: false },
  canvas: { build: () => buildCanvasEditorExtensions({ canvasId: 5 }), autofocus: false },
};

async function resavedHtml(editorKey, html) {
  const { build, autofocus } = EDITORS[editorKey];
  const editor = new Editor({ element: document.createElement('div'), extensions: build(), content: html, autofocus });
  await tick();
  await tick();
  if (!autofocus) editor.commands.focus('end');
  const out = editor.getHTML();
  editor.destroy();
  return out;
}

const source = (c, ed, kind) => (ed === 'canvas' ? c[`${kind}_canvas`] : c[kind]);

describe('재직렬화 공유 픽스처: 수정창 흐름(자동 포커스 후, 수정 없음)', () => {
  for (const c of data.cases) {
    it(`B 길이 = 실제 편집기 재저장 길이: ${c.name}`, async () => {
      const measured = {};
      for (const ed of Object.keys(EDITORS)) {
        measured[ed] = {
          P: (await resavedHtml(ed, source(c, ed, 'P'))).length,
          C: (await resavedHtml(ed, source(c, ed, 'C'))).length,
        };
      }
      if (REGEN) {
        c.B = measured;
        return;
      }
      expect(measured).toEqual(c.B);
    });
  }

  it('패딩 글자 1자는 재저장 길이를 1자 늘린다(백엔드 경계 사례 계산의 전제)', async () => {
    const padded = data.cases.filter((c) => c.markdown.includes(PAD_TOKEN));
    expect(padded.length).toBeGreaterThan(0);
    for (const c of padded) {
      for (const ed of Object.keys(EDITORS)) {
        for (const kind of ['P', 'C']) {
          const html = source(c, ed, kind);
          const base = (await resavedHtml(ed, html)).length;
          const more = (await resavedHtml(ed, html.replace(PAD_TOKEN, PAD_TOKEN + 'a'.repeat(37)))).length;
          expect(more, `${c.name}/${ed}/${kind}`).toBe(base + 37);
        }
      }
    }
  });

  afterAll(() => {
    if (REGEN) writeFileSync(FIXTURE, `${JSON.stringify(data, null, 1)}\n`);
  });
});

// 원문(raw) 모드가 있는 세 편집기 — CommentEditor·IssueEditor·TaskDescriptionEditor와 같은 확장 배열.
// limit: 그 편집기로 저장하는 경로 중 가장 작은 서버 한도(댓글·이슈 댓글 1만 자, 태스크 설명은 한도 없음).
const RAW_EDITORS = {
  comment: { build: () => buildCommentEditorExtensions({ branchId: 10 }), autofocus: true, limit: 10000 },
  issue: { build: () => buildIssueEditorExtensions({ branchId: 10 }), autofocus: false, limit: 10000 },
  description: { build: () => buildTaskDescriptionExtensions({ branchId: 10 }), autofocus: false, limit: null },
};
const rawExtensions = (base) => buildMarkdownExtensions([...base, MarkdownClipboardExtension]);
// 이번 칩 변경 전의 편집기: 이슈·문서 칩이 없어 그 링크는 원문 왕복 뒤에도 일반 링크였다.
const withoutIssueDocChips = (base) => base.filter((e) => !['issueRef', 'docRef'].includes(e.name));
const count = (s, re) => (s.match(re) || []).length;

// 수정창처럼 열고 원문 모드로 바꾼 뒤 (a) 원문 그대로 저장, (b) 일반 모드로 돌아와 저장. rich = 원문 모드 전 일반 모드 저장 HTML.
// (a)는 useRawMode.parseCurrentRaw, (b)는 exitRaw의 setContent 뒤 getHTML과 같은 경로다.
// edit는 원문 고치기(기본: 그대로) — 글자만 돌려주면 편집 기록이 없는 경우, editMany처럼 { text, changes }를 돌려주면
// 원문 편집기(CodeMirror)가 넘기는 편집 기록까지 있는 경우다.
async function rawSaves(ext, html, autofocus, { keep = true, edit = (md) => md } = {}) {
  const editor = new Editor({
    element: document.createElement('div'), coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS,
    extensions: ext, content: html, autofocus,
  });
  await tick();
  await tick();
  if (!autofocus) editor.commands.focus('end');
  const rich = editor.getHTML();
  const { markdown, rawLinks } = enterRawState(editor);
  const edited = edit(markdown);
  const { text, changes } = typeof edited === 'string' ? { text: edited, changes: null } : edited;
  const raw = keep ? parseRawToHtml(text, ext, rawLinks, changes) : parseRawToHtml(text, ext);
  editor.commands.setContent(raw, { emitUpdate: true });
  const normal = editor.getHTML();
  editor.destroy();
  return { rich, markdown, rawLinks, raw, normal };
}

// 원문 편집기에서 한 번에 한 편집(원래 원문 기준 위치)을 한 것처럼 글자와 편집 기록(ChangeSet)을 만든다
function editMany(md, specs) {
  const changes = ChangeSet.of(specs, md.length);
  return { text: changes.apply(Text.of(md.split('\n'))).toString(), changes };
}

// 여러 번 차례로 편집(각 단계는 그때 글자 기준 위치) — useRawMode처럼 편집 기록을 단계마다 따로 넘긴다(실행 취소 흉내용)
function editSteps(md, steps) {
  let text = md;
  const changes = [];
  for (const step of steps) {
    const next = ChangeSet.of(step(text), text.length);
    text = next.apply(Text.of(text.split('\n'))).toString();
    changes.push(next);
  }
  return { text, changes };
}

// 원문 편집기(CodeMirror)에서 실행 취소 기록과 함께 차례로 고친다 — RawMarkdownEditor처럼 글자가 바뀔 때마다 편집 기록 하나
// ({ changes, userEvent } — 조작 종류도 함께).
// actions: (지금 글자) => 편집 명세(한 번의 실행 취소 단위) | { edit, userEvent }(지우기·입력이 이어지면 한 번에 취소된다)
//   | 'undo' | 'redo' | { run: CodeMirror 명령 }(Alt+↑/↓ = moveLineUp/Down) | { cursor: (문서) => 자리 }
//   | { select: (문서) => [시작, 끝] }
//   | 'cut' | 'copy' | 'paste' — 선택 없는 줄 단위(@codemirror/view copiedRange·doPaste처럼 [줄 시작, 줄 끝+1)을 지우고 줄 글자만
//     복사, 붙일 때는 커서 줄 시작에 '줄 글자 + 줄바꿈', 선택이 있으면 그 선택을 줄 글자로 바꾼다). 복사는 글자를 바꾸지 않아
//     조작 종류만 남긴다(RawMarkdownEditor처럼)
//   | 'quickCut' — 'cut'과 같되 앞뒤 실행 취소 묶음을 끊지 않는다(0.5초 안에 이어 자르면 CodeMirror가 한 묶음으로 합친다)
// 묶음 시간(newGroupDelay)을 넉넉히 둬 시계와 무관하게 이어진 지우기·입력이 한 묶음이 된다(isolateHistory는 그대로 따로 끊는다)
// 편집 기록에는 실행 취소 깊이도 남긴다(RawMarkdownEditor처럼 — 실행 취소 묶음을 따라가는 데 쓴다)
function editInRaw(md, actions) {
  let state = EditorState.create({ doc: md, extensions: [history({ newGroupDelay: 60000 })] });
  const changes = [];
  let clip = '';
  const dispatch = (tr) => {
    state = tr.state;
    if (tr.docChanged) changes.push({ changes: tr.changes, userEvent: tr.annotation(Transaction.userEvent), depth: undoDepth(state) });
  };
  const cursorLine = () => state.doc.lineAt(state.selection.main.head);
  for (const action of actions) {
    if (action === 'undo' || action === 'redo') {
      expect((action === 'undo' ? undo : redo)({ state, dispatch }), `${action} 기록`).toBe(true);
      continue;
    }
    if (action === 'cut' || action === 'quickCut' || action === 'copy') {
      const l = cursorLine();
      clip = l.text;
      // 잘라내기·붙여넣기는 사람이 손을 떼고 하는 조작이라 앞뒤 편집과 실행 취소 묶음을 따로 둔다('quickCut'은 끊지 않는다)
      const cut = { changes: { from: l.from, to: Math.min(state.doc.length, l.to + 1) }, userEvent: 'delete.cut' };
      if (action === 'cut') dispatch(state.update({ ...cut, annotations: isolateHistory.of('full') }));
      else if (action === 'quickCut') dispatch(state.update(cut));
      else changes.push({ changes: null, userEvent: 'copy' });
      continue;
    }
    if (action === 'paste') {
      const { from, to, empty } = state.selection.main;
      const change = empty ? { from: cursorLine().from, insert: `${clip}\n` } : { from, to, insert: clip };
      dispatch(state.update({ changes: change, userEvent: 'input.paste', annotations: isolateHistory.of('full') }));
      continue;
    }
    if (action.select) {
      const [anchor, head] = action.select(state.doc);
      dispatch(state.update({ selection: { anchor, head } }));
      continue;
    }
    if (action.run) {
      expect(action.run({ state, dispatch }), '명령').toBe(true);
      continue;
    }
    if (action.cursor) {
      dispatch(state.update({ selection: { anchor: action.cursor(state.doc) } }));
      continue;
    }
    const { edit, userEvent } = typeof action === 'function' ? { edit: action } : action;
    const doc = state.doc.toString();
    dispatch(state.update(userEvent ? { changes: edit(doc), userEvent } : { changes: edit(doc), annotations: isolateHistory.of('full') }));
  }
  return { text: state.doc.toString(), changes };
}

// 같은 제목·같은 주소의 칩과 일반 링크 — 일반 링크가 브라우저 주소 기준 절대 주소면 md 원문이 글자까지 같다.
const SAME_RAW = {
  doc: {
    total: 80, path: '/canvas/5/77', label: '설계',
    chip: '<span data-doc-ref="true" data-page-id="77" data-canvas-id="5" data-title="설계" data-canvas-name="제품" class="doc-ref">설계</span>',
  },
  issue: {
    total: 40, path: '/branch/10/task/1031/issue/7', label: 'PRO-220 재현',
    chip: '<span data-issue-ref="true" data-issue-id="7" data-task-id="1031" data-branch-id="10" data-display-id="PRO-220" '
      + 'data-title="재현" data-status="open" class="issue-ref">PRO-220 재현'
      + '<span class="ref-chip__badge ref-chip__badge--open" data-ref-badge="true">Open</span></span>',
  },
};
const sameRawLink = ({ path, label }) => `<a href="${window.location.origin}${path}">${label}</a>`;

// 앞에서부터 칩과 일반 링크를 순서대로 — 칩은 대상 id와 제목, 일반 링크는 주소와 글자
function linkSequence(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  return [...t.content.querySelectorAll('[data-doc-ref],[data-issue-ref],[data-task-ref],a[href]')].map((el) => (
    el.tagName === 'A'
      ? `link ${el.getAttribute('href')} ${el.textContent}`
      : `chip ${['branch', 'task', 'issue', 'canvas', 'page'].map((k) => el.getAttribute(`data-${k}-id`) ?? '-').join('/')} ${el.getAttribute('data-title')}`
  ));
}

describe('원문 모드: 서버가 일반 링크로 저장한 본문(A안)을 고치지 않고 저장', () => {
  // raw_structured_links: 머리글·목록(중첩)·인용·굵게 안·같은 출처 절대 주소·서식 있는 라벨의 일반 링크와 태스크 링크, 끝에 번호 목록.
  // 블록 내용이 남았는지도 따로 본다 — 양쪽(지금·변경 전)이 똑같이 비면 비교만으로는 아무것도 확인하지 못한다
  // (번호 목록 뒤 블록이 비던 문제 자체는 아래 '번호 목록·callout 뒤 내용' 묶음이 본다).
  const KEEPS = { raw_structured_links: ['머리글', '같은 출처 절대 주소', '인용 ', '<em>기울임</em>', '번호'] };
  for (const name of ['raw_doc_links_80', 'raw_issue_links_40', 'raw_structured_links']) {
    for (const [ed, { build, autofocus, limit }] of Object.entries(RAW_EDITORS)) {
      it(`${name}/${ed}: 원문 저장과 일반 모드 복귀 후 저장이 변경 전과 같고 한도 안이다`, async () => {
        const { P } = data.cases.find((x) => x.name === name);
        const now = await rawSaves(rawExtensions(build()), P, autofocus);
        const before = await rawSaves(rawExtensions(withoutIssueDocChips(build())), P, autofocus, { keep: false });
        if (limit) {
          expect(now.raw.length, '원문 저장').toBeLessThanOrEqual(limit);
          expect(now.normal.length, '원문 → 일반 모드 → 저장').toBeLessThanOrEqual(limit);
        }
        expect(count(now.raw, /data-(issue|doc)-ref=/g), '이슈·문서 칩 없음').toBe(0);
        for (const text of KEEPS[name] || []) expect(now.raw, `내용 유지: ${text}`).toContain(text);
        expect(now.raw).toBe(before.raw);
        expect(now.normal).toBe(before.normal);
      });
    }
  }

  it('칩은 칩으로, 일반 링크는 일반 링크로 돌아오고 Copy as Markdown은 그대로다(원문에서 새로 쓴 링크는 칩)', async () => {
    const pick = (n) => data.cases.find((x) => x.name === n);
    // 서버 칩(태스크·이슈·문서, 정상 길이) + 서버가 일반 링크로 저장한 이슈 40·문서 80
    const html = pick('issue_doc_list').C + pick('raw_issue_links_40').P + pick('raw_doc_links_80').P;
    for (const [ed, { build, autofocus }] of Object.entries(RAW_EDITORS)) {
      const ext = rawExtensions(build());
      const now = await rawSaves(ext, html, autofocus);
      for (const out of [now.raw, now.normal]) {
        expect(count(out, /data-task-ref="true"/g), ed).toBe(1);
        expect(count(out, /data-issue-ref="true"/g), ed).toBe(1);
        expect(count(out, /data-doc-ref="true"/g), ed).toBe(1);
        expect(count(out, /<a [^>]*href="\/branch\/10\/task\/1031\/issue\/7"/g), ed).toBe(40);
        expect(count(out, /<a [^>]*href="\/canvas\/5\/77"/g), ed).toBe(80);
        expect(htmlToMarkdown(out, ext), ed).toBe(htmlToMarkdown(html, ext));
      }
      const typed = parseRawToHtml(`${now.markdown}\n\n[새 문서](/canvas/5/78)`, ext, now.rawLinks);
      expect(count(typed, /data-doc-ref="true" data-page-id="78"/g), ed).toBe(1);
      expect(count(typed, /<a [^>]*href="\/canvas\/5\/77"/g), ed).toBe(80);
    }
  });
});

describe('원문 모드: 같은 제목·같은 주소의 칩과 일반 링크가 섞인 본문', () => {
  for (const [kind, m] of Object.entries(SAME_RAW)) {
    const html = `<p>${m.chip} ${Array(m.total - 1).fill(sameRawLink(m)).join(' ')}</p>`;
    for (const [ed, { build, autofocus, limit }] of Object.entries(RAW_EDITORS)) {
      it(`${kind} 칩 1 + 같은 원문의 일반 링크 ${m.total - 1}/${ed}: 원문 저장·일반 모드 복귀 후 저장 모두 개수·대상·순서가 그대로다`, async () => {
        const now = await rawSaves(rawExtensions(build()), html, autofocus);
        for (const [label, out] of [['원문 저장', now.raw], ['원문 → 일반 모드 → 저장', now.normal]]) {
          expect(count(out, /data-(doc|issue)-ref=/g), `${label} 칩`).toBe(1);
          expect(count(out, /<a /g), `${label} 일반 링크`).toBe(m.total - 1);
          if (limit) expect(out.length, `${label} 길이`).toBeLessThanOrEqual(limit);
          expect(linkSequence(out), label).toEqual(linkSequence(now.rich));
        }
      });
    }
  }

  it('칩이 사이사이 섞여도(목록 안 포함), 주변 문장만 고쳐도 자리마다 칩·일반 링크가 그대로다', async () => {
    const link = sameRawLink(SAME_RAW.doc);
    const chip = SAME_RAW.doc.chip;
    const html = `<p>${[link, chip, link, link, chip, link].join(' ')}</p><ul><li><p>${chip} 목록 ${link}</p></li></ul>`;
    const edit = (md) => `앞에 쓴 글\n\n${md.replace(') [', ') 사이에 쓴 글 [')}\n\n뒤에 쓴 글`;
    for (const [ed, { build, autofocus }] of Object.entries(RAW_EDITORS)) {
      for (const opts of [{}, { edit }]) {
        const now = await rawSaves(rawExtensions(build()), html, autofocus, opts);
        for (const out of [now.raw, now.normal]) {
          expect(linkSequence(out), ed).toEqual(linkSequence(now.rich));
          if (opts.edit) expect(out, ed).toContain('사이에 쓴 글');
        }
      }
    }
  });

  it('앞쪽에 짝 없는 [ (인라인 코드·코드 블록·앞 문단)가 있어도 자리마다 칩·일반 링크가 그대로다', async () => {
    const link = sameRawLink(SAME_RAW.doc);
    const chip = SAME_RAW.doc.chip;
    const bodies = [
      `<p><code>[</code> ${chip} ${link}</p>`,
      `<p>범위 [0, 1)</p><p>${chip} ${link} ${link}</p>`,
      `<pre><code>s.startsWith('[')</code></pre><p>${link} ${chip}</p>`,
      `<p>범위 [0, 1)</p><p>${link} ${link}</p>`, // 일반 링크만(A안 모양)
    ];
    for (const [ed, { build, autofocus }] of Object.entries(RAW_EDITORS)) {
      for (const html of bodies) {
        const now = await rawSaves(rawExtensions(build()), html, autofocus);
        for (const out of [now.raw, now.normal]) expect(linkSequence(out), `${ed} ${html.slice(0, 30)}`).toEqual(linkSequence(now.rich));
      }
    }
  });

  it('일반 링크 글자에 짝 없는 [가 있어도 변경 전 원문 왕복과 같다(칩이 생기지 않는다)', async () => {
    const html = `<p><a href="${window.location.origin}/canvas/5/77">[WIP 설계</a> 끝</p>`;
    for (const [ed, { build, autofocus }] of Object.entries(RAW_EDITORS)) {
      const now = await rawSaves(rawExtensions(build()), html, autofocus);
      const before = await rawSaves(rawExtensions(withoutIssueDocChips(build())), html, autofocus, { keep: false });
      expect(count(now.raw, /data-doc-ref=/g), ed).toBe(0);
      expect(now.raw, ed).toBe(before.raw);
    }
  });
});

describe('원문 모드: 같은 링크를 넣고 지워도 나머지 칩·일반 링크의 형태가 그대로다', () => {
  for (const [kind, m] of Object.entries(SAME_RAW)) {
    const link = sameRawLink(m);
    const typed = `[${m.label}](${window.location.origin}${m.path})`; // 원문에 새로 쓰는 같은 링크
    const [CHIP] = linkSequence(`<p>${m.chip}</p>`);
    const [LINK] = linkSequence(`<p>${link}</p>`);
    // 첫 줄 = 칩, 둘째 줄 = 같은 제목·주소의 일반 링크 → md: "<칩 원문>\n\n<링크 원문>"(두 원문은 글자까지 같다)
    const html = `<p>${m.chip}</p><p>${link}</p>`;
    const gap = (md) => md.indexOf('\n\n');
    const SCENARIOS = [
      ['첫 줄(칩) 삭제', (md) => editMany(md, [{ from: 0, to: gap(md) + 2 }]), [LINK]],
      ['둘째 줄(일반 링크) 삭제', (md) => editMany(md, [{ from: gap(md), to: md.length }]), [CHIP]],
      ['맨 앞에 같은 링크 추가(새 링크는 칩)', (md) => editMany(md, [{ from: 0, insert: `${typed}\n\n` }]), [CHIP, CHIP, LINK]],
      ['가운데에 같은 링크 추가', (md) => editMany(md, [{ from: gap(md), insert: `\n\n${typed}` }]), [CHIP, CHIP, LINK]],
      ['맨 끝에 같은 링크 추가', (md) => editMany(md, [{ from: md.length, insert: `\n\n${typed}` }]), [CHIP, LINK, CHIP]],
      ['주변 문장만 수정', (md) => editMany(md, [{ from: 0, insert: '앞 문장\n\n' }, { from: md.length, insert: ' 덧붙임' }]), [CHIP, LINK]],
      ['수정 없음', (md) => editMany(md, []), [CHIP, LINK]],
    ];
    for (const [name, edit, expected] of SCENARIOS) {
      it(`${kind}: ${name} — 세 편집기 모두 원문 저장·일반 모드 복귀 후 저장이 같다`, async () => {
        for (const [ed, { build, autofocus }] of Object.entries(RAW_EDITORS)) {
          const now = await rawSaves(rawExtensions(build()), html, autofocus, { edit });
          expect(linkSequence(now.raw), `${ed} 원문 저장`).toEqual(expected);
          expect(linkSequence(now.normal), `${ed} 원문 → 일반 모드`).toEqual(expected);
        }
      });
    }
  }

  it('지웠다가 실행 취소로 같은 자리에 되살린 링크는 원래 형태다(둘째 줄·첫 줄)', async () => {
    const m = SAME_RAW.doc;
    const [CHIP] = linkSequence(`<p>${m.chip}</p>`);
    const [LINK] = linkSequence(`<p>${sameRawLink(m)}</p>`);
    const html = `<p>${m.chip}</p><p>${sameRawLink(m)}</p>`;
    const undoOf = (range) => (md) => {
      const [from, to] = range(md);
      const removed = md.slice(from, to);
      return editSteps(md, [() => [{ from, to }], () => [{ from, insert: removed }]]);
    };
    const cases = [
      ['둘째 줄 삭제 → 실행 취소', undoOf((md) => [md.indexOf('\n\n'), md.length])],
      ['첫 줄 삭제 → 실행 취소', undoOf((md) => [0, md.indexOf('\n\n') + 2])],
      ['둘째 줄 삭제 → 실행 취소 → 뒤에 글 덧붙임', (md) => {
        const from = md.indexOf('\n\n');
        const removed = md.slice(from);
        return editSteps(md, [() => [{ from, to: md.length }], () => [{ from, insert: removed }], (t) => [{ from: t.length, insert: ' 덧붙임' }]]);
      }],
    ];
    for (const [name, edit] of cases) {
      for (const [ed, { build, autofocus }] of Object.entries(RAW_EDITORS)) {
        const now = await rawSaves(rawExtensions(build()), html, autofocus, { edit });
        expect(linkSequence(now.raw), `${ed} ${name}`).toEqual([CHIP, LINK]);
        expect(linkSequence(now.normal), `${ed} ${name} → 일반 모드`).toEqual([CHIP, LINK]);
      }
    }
  });

  it('A안 긴 본문(일반 링크 80): 전부 지웠다가 실행 취소하고 글을 덧붙여도 일반 링크 80개 그대로·한도 안', async () => {
    const { P } = data.cases.find((x) => x.name === 'raw_doc_links_80');
    const now = await rawSaves(rawExtensions(RAW_EDITORS.comment.build()), P, true, {
      edit: (md) => editSteps(md, [() => [{ from: 0, to: md.length }], () => [{ from: 0, insert: md }], (t) => [{ from: t.length, insert: ' 덧붙임' }]]),
    });
    for (const out of [now.raw, now.normal]) {
      expect(count(out, /data-doc-ref=/g)).toBe(0);
      expect(count(out, /<a /g)).toBe(80);
      expect(out).toContain('덧붙임');
      expect(out.length).toBeLessThanOrEqual(10000);
    }
  });

  it('실행 취소 전에 다른 편집을 했어도 실행 취소로 되살린 칩·일반 링크는 제 형태·제 순서다(문서·이슈, 세 편집기)', async () => {
    const all = (t) => ({ from: 0, to: t.length });
    for (const [kind, m] of Object.entries(SAME_RAW)) {
      const [CHIP] = linkSequence(`<p>${m.chip}</p>`);
      const [LINK] = linkSequence(`<p>${sameRawLink(m)}</p>`);
      const typed = `[${m.label}](${window.location.origin}${m.path})`;
      const html = `<p>${m.chip}</p><p>${sameRawLink(m)}</p>`;
      // 둘째 줄(일반 링크)을 끝에서부터 한 글자씩 지운다 — 이어진 지우기는 실행 취소 한 번에 함께 돌아온다
      const backspace = { edit: (t) => ({ from: t.length - 1, to: t.length }), userEvent: 'delete.backward' };
      const backspaces = (md) => Array.from({ length: md.length - md.indexOf('\n\n') }, () => backspace);
      const typeX = { edit: (t) => ({ from: t.length, insert: 'x' }), userEvent: 'input.type' };
      const cases = [
        ['맨 앞에 "새 문장"과 빈 줄 → 전체 삭제 → 실행 취소', () => [() => ({ from: 0, insert: '새 문장\n\n' }), all, 'undo'], [CHIP, LINK], '새 문장'],
        ['맨 앞에 같은 링크와 빈 줄 → 전체 삭제 → 실행 취소(새 링크는 칩)', () => [() => ({ from: 0, insert: `${typed}\n\n` }), all, 'undo'], [CHIP, CHIP, LINK]],
        ['전체 삭제 → 다른 글 입력 → 실행 취소 두 번', () => [all, () => ({ from: 0, insert: '다른 글' }), 'undo', 'undo'], [CHIP, LINK]],
        ['맨 앞에 "새 문장" → 일반 링크 줄을 한 글자씩 지움 → 실행 취소', (md) => [() => ({ from: 0, insert: '새 문장\n\n' }), ...backspaces(md), 'undo'], [CHIP, LINK], '새 문장'],
        // 한 묶음 안에서 지우고 쓰고 지운다 — 실행 취소는 쓰고 지운 x 없이 원래 글 두 글자만 되돌린다
        ['일반 링크 끝에서 지우기 → x 입력 → 지우기 두 번 → 실행 취소', () => [backspace, typeX, backspace, backspace, 'undo'], [CHIP, LINK]],
      ];
      for (const [name, actions, expected, text] of cases) {
        for (const [ed, { build, autofocus }] of Object.entries(RAW_EDITORS)) {
          const now = await rawSaves(rawExtensions(build()), html, autofocus, { edit: (md) => editInRaw(md, actions(md)) });
          for (const [where, out] of [['원문 저장', now.raw], ['원문 → 일반 모드', now.normal]]) {
            expect(linkSequence(out), `${kind} ${ed} ${name} — ${where}`).toEqual(expected);
            if (text) expect(out, `${kind} ${ed} ${name} — ${where}`).toContain(text);
          }
        }
      }
    }
  });

  it('선택 없이 마지막 줄을 잘라(Cmd+X) 같은 자리에 붙여도(Cmd+V), 이어서 실행 취소를 두 번 해도 그 줄의 칩·일반 링크가 제 형태다(A안 한 문단 본문 포함)', async () => {
    // CodeMirror 줄 단위 잘라내기·붙여넣기(@codemirror/view copiedRange·doPaste): 선택이 없으면 [줄 시작, 줄 끝+1)을 지우고
    // 줄 글자만 복사하며, 붙일 때는 커서 줄 시작에 '줄 글자 + 줄바꿈'을 넣는다 — 마지막 줄은 지운 글보다 줄바꿈 하나가 길다.
    // 실행 취소 두 번 = 붙여넣기 취소(그 줄과 붙인 줄바꿈을 한 번에 지움) → 잘라내기 취소(원래 줄만 다시 넣음)
    const FLOWS = [['붙여넣기', []], ['붙여넣기 → 실행 취소 두 번', ['undo', 'undo']]];
    const cutPasteLast = (md, tail) => {
      const last = md.slice(md.lastIndexOf('\n') + 1);
      return [
        { edit: (t) => ({ from: t.length - last.length, to: t.length }), userEvent: 'delete.cut' },
        { edit: (t) => ({ from: t.length, insert: `${last}\n` }), userEvent: 'input.paste' },
        ...tail,
      ];
    };
    const edit = (tail) => (md) => {
      const out = editInRaw(md, cutPasteLast(md, tail));
      if (tail.length) expect(out.text, '실행 취소 두 번 뒤 원문은 진입 때와 같다').toBe(md);
      return out;
    };
    for (const [flow, tail] of FLOWS) {
      for (const [kind, m] of Object.entries(SAME_RAW)) {
        const [CHIP] = linkSequence(`<p>${m.chip}</p>`);
        const [LINK] = linkSequence(`<p>${sameRawLink(m)}</p>`);
        const html = `<p>${m.chip}</p><p>${sameRawLink(m)}</p>`; // 마지막 줄 = 일반 링크
        for (const [ed, { build, autofocus }] of Object.entries(RAW_EDITORS)) {
          const now = await rawSaves(rawExtensions(build()), html, autofocus, { edit: edit(tail) });
          expect(linkSequence(now.raw), `${flow} ${kind} ${ed} 원문 저장`).toEqual([CHIP, LINK]);
          expect(linkSequence(now.normal), `${flow} ${kind} ${ed} 원문 → 일반 모드`).toEqual([CHIP, LINK]);
        }
      }
      for (const [name, chipAttr, total] of [['raw_doc_links_80', /data-doc-ref=/g, 80], ['raw_issue_links_40', /data-issue-ref=/g, 40]]) {
        const { P } = data.cases.find((x) => x.name === name);
        for (const ed of ['comment', 'issue']) {
          const { build, autofocus, limit } = RAW_EDITORS[ed];
          const now = await rawSaves(rawExtensions(build()), P, autofocus, { edit: edit(tail) });
          for (const [where, out] of [['원문 저장', now.raw], ['원문 → 일반 모드', now.normal]]) {
            const at = `${flow} ${name} ${ed} ${where}`;
            expect(count(out, chipAttr), `${at}: 칩`).toBe(0);
            expect(count(out, /<a /g), `${at}: 일반 링크`).toBe(total);
            expect(out.length, `${at}: 길이`).toBeLessThanOrEqual(limit);
          }
        }
      }
    }
  });

  it('같은 본문 안에서 줄을 옮겨도(Alt+↑/↓, 잘라 다른 자리에 붙이기, 실행 취소·다시 실행) 칩·일반 링크가 제 형태다(문서·이슈, 세 편집기)', async () => {
    const at = (n) => ({ cursor: (doc) => doc.line(n < 0 ? doc.lines + 1 + n : n).from }); // 줄 번호 1부터, -1 = 마지막 줄
    const end = { cursor: (doc) => doc.length };
    const newLine = [end, { edit: (t) => ({ from: t.length, insert: '\n' }), userEvent: 'input.type' }, end];
    const up = (n) => Array(n).fill({ run: moveLineUp });
    const down = (n) => Array(n).fill({ run: moveLineDown });
    // 첫 줄 끝에서 Backspace(이어 누르면 한 번에 취소되는 지우기)
    const backspaceAtFirstLineEnd = { edit: (t) => ({ from: t.indexOf('\n') - 1, to: t.indexOf('\n') }), userEvent: 'delete.backward' };
    for (const [kind, m] of Object.entries(SAME_RAW)) {
      const [CHIP] = linkSequence(`<p>${m.chip}</p>`);
      const [LINK] = linkSequence(`<p>${sameRawLink(m)}</p>`);
      // 원문 다섯 줄: 칩, 빈 줄, 일반 문장, 빈 줄, 같은 대상의 일반 링크(반대 배치는 일반 링크가 첫 줄, 칩이 끝 줄)
      const three = `<p>${m.chip}</p><p>일반 문장</p><p>${sameRawLink(m)}</p>`;
      const reversed = `<p>${sameRawLink(m)}</p><p>일반 문장</p><p>${m.chip}</p>`;
      const cases = [
        ['일반 링크 줄 Alt+↑로 맨 앞에', three, [at(-1), ...up(4)], [LINK, CHIP]],
        ['일반 링크 줄 Alt+↑로 가운데에', three, [at(-1), ...up(2)], [CHIP, LINK]],
        ['반대 배치에서 칩 줄 Alt+↑로 맨 앞에(일반 링크 줄이 밀린다)', reversed, [at(-1), ...up(4)], [CHIP, LINK]],
        ['문장 줄 Alt+↓로 맨 뒤에(일반 링크 줄이 밀린다)', three, [at(3), ...down(2)], [CHIP, LINK]],
        ['칩 줄 Alt+↓로 맨 뒤에', three, [at(1), ...down(4)], [LINK, CHIP]],
        ['일반 링크 줄 잘라 맨 앞에 붙이기', three, [at(-1), 'cut', at(1), 'paste'], [LINK, CHIP]],
        ['일반 링크 줄 잘라 가운데에 붙이기', three, [at(-1), 'cut', at(3), 'paste'], [CHIP, LINK]],
        ['칩 줄 잘라 맨 뒤에 붙이기', three, [at(1), 'cut', ...newLine, 'paste'], [LINK, CHIP]],
        ['Alt+↑ 네 번 → 실행 취소 네 번', three, [at(-1), ...up(4), 'undo', 'undo', 'undo', 'undo'], [CHIP, LINK]],
        ['Alt+↑ 네 번 → 실행 취소 네 번 → 다시 실행 네 번', three, [at(-1), ...up(4), 'undo', 'undo', 'undo', 'undo', 'redo', 'redo', 'redo', 'redo'], [LINK, CHIP]],
        ['잘라 맨 앞에 붙이기 → 실행 취소 두 번', three, [at(-1), 'cut', at(1), 'paste', 'undo', 'undo'], [CHIP, LINK]],
        ['잘라 맨 앞에 붙이기 → 실행 취소 두 번 → 다시 실행 두 번', three, [at(-1), 'cut', at(1), 'paste', 'undo', 'undo', 'redo', 'redo'], [LINK, CHIP]],
        // 새로 추가한 링크는 기존 규칙(칩)
        ['일반 링크 줄 복사해 맨 앞에 붙이기(새 링크는 칩)', three, [at(-1), 'copy', at(1), 'paste'], [CHIP, CHIP, LINK]],
        ['잘라 맨 앞에 붙인 뒤 맨 뒤에 한 번 더(두 번째는 새 링크라 칩)', three, [at(-1), 'cut', at(1), 'paste', ...newLine, 'paste'], [LINK, CHIP, CHIP]],
        ['일반 링크 줄을 잘라 지운 뒤 같은 글의 칩 줄을 복사해 붙이기(복사본은 칩)', three, [at(-1), 'cut', at(1), 'copy', ...newLine, 'paste'], [CHIP, CHIP]],
        // 옮기기 전에 그 줄 안을 고친 기록(이어 지운 두 글자)도 줄과 함께 옮겨져 실행 취소로 되살아난다
        ['일반 링크 끝 두 글자 지움 → 아래 줄 Alt+↑(링크 줄이 밀림) → 실행 취소 두 번', reversed,
          [{ cursor: (doc) => doc.line(1).to }, backspaceAtFirstLineEnd, backspaceAtFirstLineEnd, at(2), ...up(1), 'undo', 'undo'], [LINK, CHIP]],
        ['일반 링크 끝 두 글자 지움 → 그 줄 잘라 다른 자리에 붙이기 → 실행 취소 세 번', reversed,
          [{ cursor: (doc) => doc.line(1).to }, backspaceAtFirstLineEnd, backspaceAtFirstLineEnd, at(1), 'cut', at(-1), 'paste', 'undo', 'undo', 'undo'], [LINK, CHIP]],
        // 잘라 둔 줄을 다른 곳의 선택 위에 붙이기(줄바꿈 없이 들어간다)
        ['첫 줄(일반 링크) 잘라 문장 줄을 선택해 그 위에 붙이기', reversed, [at(1), 'cut', { select: (doc) => [doc.line(2).from, doc.line(2).to] }, 'paste'], [LINK, CHIP]],
        // 잘라 둔 칩 줄 자리 바로 위로 Alt+↓ — 같은 조작에서 옮긴 일반 링크 줄이 먼저다
        ['칩 줄 잘라 둔 뒤 빈 줄 Alt+↓(일반 링크 줄이 위로 밀림)', `<p>${m.chip}</p><p>${sameRawLink(m)}</p>`, [at(1), 'cut', at(1), ...down(1)], [LINK]],
        // 빠른 연속 조작(한 실행 취소 묶음): 첫 줄에서 이어 잘라내기 두 번 → 마지막 줄에 붙이기(둘째 줄만 옮겨진다) → 실행 취소
        ...[[CHIP, LINK], [LINK, CHIP]].flatMap(([a, b]) => {
          const two = `<p>${a === CHIP ? m.chip : sameRawLink(m)}<br>${a === CHIP ? sameRawLink(m) : m.chip}<br>일반 문장<br>끝 문장</p>`;
          const cuts = [at(1), 'quickCut', 'quickCut', end, 'paste'];
          return [
            [`${a === CHIP ? '칩' : '일반 링크'} 줄부터 이어 잘라내기 두 번 → 마지막 줄에 붙이기 → 실행 취소 두 번`, two, [...cuts, 'undo', 'undo'], [a, b]],
            [`${a === CHIP ? '칩' : '일반 링크'} 줄부터 이어 잘라내기 두 번 → 붙이기 → 실행 취소 두 번 → 다시 실행 두 번`, two, [...cuts, 'undo', 'undo', 'redo', 'redo'], [b]],
          ];
        }),
        // 줄 끝 커서로 Alt+↑ → 바로 그 줄 끝에 입력(한 묶음) → 실행 취소 → 다시 실행 — 링크 글자·주소는 고치지 않는다
        ['칩 줄 끝에서 Alt+↑ → 바로 줄 끝에 입력 → 실행 취소 → 다시 실행(일반 링크 줄이 밀린다)', `<p>${sameRawLink(m)}<br>${m.chip}<br>일반 문장</p>`,
          [{ cursor: (doc) => doc.line(2).to }, ...up(1), { edit: (t) => ({ from: t.indexOf('\n'), insert: ' 추가' }), userEvent: 'input.type' }, 'undo', 'redo'], [CHIP, LINK]],
        ['칩 줄 맨 앞에서 Alt+↓ → 바로 줄 맨 앞에 입력 → 실행 취소(일반 링크 줄이 밀린다)', `<p>${m.chip}<br>${sameRawLink(m)}<br>일반 문장</p>`,
          [at(1), ...down(1), { edit: (t) => ({ from: t.indexOf('\n') + 1, insert: '앞글 ' }), userEvent: 'input.type' }, 'undo'], [CHIP, LINK]],
        // 같은 자리에 붙이기: 잘라 그대로 되붙이면 원래 형태, 남은 칩 줄을 새로 복사해 그 자리에 붙이면 복사본(칩) — 원문 글자는 둘 다 같다
        ['일반 링크 줄 잘라 그 자리에 그대로 되붙이기', `<p>${sameRawLink(m)}<br>${m.chip}<br>일반 문장</p>`, [at(1), 'cut', at(1), 'paste'], [LINK, CHIP]],
        ['일반 링크 줄 잘라낸 뒤 칩 줄을 새로 복사해 그 자리에 붙이기(복사본은 칩)', `<p>${sameRawLink(m)}<br>${m.chip}<br>일반 문장</p>`,
          [at(1), 'cut', at(1), 'copy', at(1), 'paste'], [CHIP, CHIP]],
      ];
      for (const [name, html, actions, expected] of cases) {
        for (const [ed, { build, autofocus }] of Object.entries(RAW_EDITORS)) {
          const now = await rawSaves(rawExtensions(build()), html, autofocus, { edit: (md) => editInRaw(md, actions) });
          expect(linkSequence(now.raw), `${kind} ${ed} ${name} — 원문 저장`).toEqual(expected);
          expect(linkSequence(now.normal), `${kind} ${ed} ${name} — 원문 → 일반 모드`).toEqual(expected);
        }
      }
    }
    // A안 긴 본문(한 줄): 문장 줄을 Alt+↑로 링크 줄 위에 / 링크 줄을 잘라 문장 위에 — 링크 줄이 옮겨진다
    const flows = [
      ['문장 줄 Alt+↑ 두 번', [end, { edit: (t) => ({ from: t.length, insert: '\n\n새 문장' }), userEvent: 'input.type' }, end, ...up(2)]],
      ['링크 줄 잘라 문장 위에 붙이기', [{ edit: () => ({ from: 0, insert: '새 문장\n\n' }), userEvent: 'input.type' }, at(-1), 'cut', at(1), 'paste']],
    ];
    for (const [name, chipAttr, total] of [['raw_doc_links_80', /data-doc-ref=/g, 80], ['raw_issue_links_40', /data-issue-ref=/g, 40]]) {
      const { P } = data.cases.find((x) => x.name === name);
      for (const [flow, actions] of flows) {
        for (const ed of ['comment', 'issue']) {
          const { build, autofocus, limit } = RAW_EDITORS[ed];
          const now = await rawSaves(rawExtensions(build()), P, autofocus, { edit: (md) => editInRaw(md, actions) });
          for (const [where, out] of [['원문 저장', now.raw], ['원문 → 일반 모드', now.normal]]) {
            const label = `${name} ${flow} ${ed} ${where}`;
            expect(count(out, chipAttr), `${label}: 칩`).toBe(0);
            expect(count(out, /<a /g), `${label}: 일반 링크`).toBe(total);
            expect(out, label).toContain('새 문장');
            expect(out.length, `${label}: 길이`).toBeLessThanOrEqual(limit);
          }
        }
      }
      // 링크 줄과 문장 줄을 이어 잘라(한 묶음) 문장 하나만 끝으로 옮긴 뒤 실행 취소 두 번 — 링크 줄은 제자리, 문장 줄은 옮겨 갔다 돌아온다
      const inner = P.replace(/^<p>|<\/p>\s*$/g, '');
      for (const [where, html] of [['링크 줄이 첫 줄', `<p>${inner}<br>일반 문장<br>둘째 문장<br>끝 문장</p>`], ['링크 줄이 둘째 줄', `<p>일반 문장<br>${inner}<br>둘째 문장<br>끝 문장</p>`]]) {
        for (const ed of ['comment', 'issue']) {
          const { build, autofocus, limit } = RAW_EDITORS[ed];
          const now = await rawSaves(rawExtensions(build()), html, autofocus, { edit: (md) => editInRaw(md, [at(1), 'quickCut', 'quickCut', end, 'paste', 'undo', 'undo']) });
          for (const [save, out] of [['원문 저장', now.raw], ['원문 → 일반 모드', now.normal]]) {
            const label = `${name} ${where} 이어 잘라내기 두 번 → 붙이기 → 실행 취소 두 번 ${ed} ${save}`;
            expect(count(out, chipAttr), `${label}: 칩`).toBe(0);
            expect(count(out, /<a /g), `${label}: 일반 링크`).toBe(total);
            expect(out.length, `${label}: 길이`).toBeLessThanOrEqual(limit);
          }
        }
      }
    }
  });

  it('A안 긴 본문(문서 링크 80·이슈 링크 40): 맨 앞에 "새 문장"을 넣고 전체 삭제 → 실행 취소해도 일반 링크 그대로·한도 안', async () => {
    const actions = [() => ({ from: 0, insert: '새 문장\n\n' }), (t) => ({ from: 0, to: t.length }), 'undo'];
    for (const [name, chipAttr, total] of [['raw_doc_links_80', /data-doc-ref=/g, 80], ['raw_issue_links_40', /data-issue-ref=/g, 40]]) {
      const { P } = data.cases.find((x) => x.name === name);
      for (const [ed, { build, autofocus, limit }] of Object.entries(RAW_EDITORS)) {
        const now = await rawSaves(rawExtensions(build()), P, autofocus, { edit: (md) => editInRaw(md, actions) });
        for (const [where, out] of [['원문 저장', now.raw], ['원문 → 일반 모드', now.normal]]) {
          const at = `${name} ${ed} ${where}`;
          expect(count(out, chipAttr), `${at}: 칩`).toBe(0);
          expect(count(out, /<a /g), `${at}: 일반 링크`).toBe(total);
          expect(out, at).toContain('새 문장');
          if (limit) expect(out.length, `${at}: 길이`).toBeLessThanOrEqual(limit);
        }
      }
    }
  });

  it('남은 링크 바로 앞에 짝 없는 [를 입력해도(주변 문장 수정) 그 글과 각 링크의 형태가 그대로다', async () => {
    const m = SAME_RAW.doc;
    const [CHIP] = linkSequence(`<p>${m.chip}</p>`);
    const [LINK] = linkSequence(`<p>${sameRawLink(m)}</p>`);
    const html = `<p>${sameRawLink(m)}</p><p>${m.chip}</p>`; // 첫 줄 일반 링크, 둘째 줄 칩
    for (const [ed, { build, autofocus }] of Object.entries(RAW_EDITORS)) {
      const now = await rawSaves(rawExtensions(build()), html, autofocus, { edit: (md) => editMany(md, [{ from: 0, insert: '범위 [0, 1) ' }]) });
      for (const out of [now.raw, now.normal]) {
        expect(out, ed).toContain('범위 [0, 1) ');
        expect(linkSequence(out), ed).toEqual([LINK, CHIP]);
      }
    }
  });

  it('긴 혼합 본문(칩 1 + 같은 원문의 일반 링크 79)에서 칩 줄을 지우면 일반 링크 79개가 그대로 남고 한도 안이다', async () => {
    const m = SAME_RAW.doc;
    const html = `<p>${m.chip}</p><p>${Array(79).fill(sameRawLink(m)).join(' ')}</p>`;
    const now = await rawSaves(rawExtensions(RAW_EDITORS.comment.build()), html, true, {
      edit: (md) => editMany(md, [{ from: 0, to: md.indexOf('\n\n') + 2 }]),
    });
    for (const out of [now.raw, now.normal]) {
      expect(count(out, /data-doc-ref=/g)).toBe(0);
      expect(count(out, /<a /g)).toBe(79);
      expect(out.length).toBeLessThanOrEqual(10000);
    }
  });
});

describe('원문 모드: 번호 목록·callout 뒤 내용이 원문 왕복 뒤에도 남는다', () => {
  const CASES = [
    {
      name: '번호 목록 + 문단', editors: ['comment', 'issue', 'description'],
      html: '<ol><li><p>실험 결과 확인</p></li></ol><p>금요일까지 보고서를 보내 주세요.</p>',
      keeps: ['실험 결과 확인', '금요일까지 보고서를 보내 주세요.'],
    },
    {
      name: '번호 목록 + 인용 + 문단', editors: ['comment', 'issue', 'description'],
      html: '<ol><li><p>첫 단계</p></li><li><p>둘째 단계</p></li></ol><blockquote><p>인용한 문장</p></blockquote><p>마지막 문단입니다.</p>',
      keeps: ['둘째 단계', '인용한 문장', '마지막 문단입니다.'],
    },
    // callout·체크리스트는 이슈·태스크 설명 편집기에만 있다(댓글 편집기에는 없음)
    {
      name: 'callout + 문단', editors: ['issue', 'description'],
      html: '<div data-callout="info" class="callout"><p>안내 내용</p></div><p>callout 뒤 문단입니다.</p>',
      keeps: ['안내 내용', 'callout 뒤 문단입니다.'],
    },
    {
      name: '체크리스트 + 문단', editors: ['issue', 'description'],
      html: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>할 일</p></li></ul><p>체크리스트 뒤 문단입니다.</p>',
      keeps: ['할 일', '체크리스트 뒤 문단입니다.'],
    },
  ];
  for (const { name, editors, html, keeps } of CASES) {
    for (const ed of editors) {
      it(`${name}/${ed}: 원문 저장·일반 모드 복귀 후 저장 모두 일반 모드와 같다`, async () => {
        const { build, autofocus } = RAW_EDITORS[ed];
        const now = await rawSaves(rawExtensions(build()), html, autofocus);
        for (const out of [now.raw, now.normal]) {
          for (const text of keeps) expect(out, `${ed} 내용 유지: ${text}`).toContain(text);
          expect(out, ed).toBe(now.rich);
        }
      });
    }
  }

  it('원문에 직접 쓴 체크리스트 문법 뒤 문단도 남는다(댓글 편집기는 체크리스트가 없어 글머리 목록이 된다)', () => {
    for (const [ed, { build }] of Object.entries(RAW_EDITORS)) {
      const out = parseRawToHtml('- [ ] 할 일\n\n다음 문단', rawExtensions(build()));
      expect(out, ed).toContain('할 일');
      expect(out, ed).toContain('<p>다음 문단</p>');
    }
  });
});

describe('서버 칩 HTML = 편집기 renderHTML', () => {
  it('특수문자 제목 칩도 편집기가 다시 직렬화한 결과가 같다(jsdom 직렬화끼리 비교)', async () => {
    const c = data.cases.find((x) => x.name === 'chip_parity');
    // 편집기는 renderHTML이 넣은 배지 style을 rgba()로 정규화해 직렬화한다(jsdom·크롬 공통 실측, 그 증가분은
    // 서버 상한 U에 포함). 파싱만 한 style은 원문이라 양쪽 style을 CSSOM으로 맞춘 뒤 나머지를 그대로 비교한다.
    const canonical = (html) => {
      const t = document.createElement('template');
      t.innerHTML = html;
      t.content.querySelectorAll('[style]').forEach((el) => el.setAttribute('style', el.style.cssText));
      return t.innerHTML;
    };
    for (const ed of Object.keys(EDITORS)) {
      const html = source(c, ed, 'C').replace(/\n$/, '');
      const { build } = EDITORS[ed];
      const editor = new Editor({ element: document.createElement('div'), extensions: build(), content: html });
      expect(canonical(editor.getHTML()), ed).toBe(canonical(html));
      editor.destroy();
    }
  });
});
