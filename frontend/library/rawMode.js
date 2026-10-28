import { useState, useEffect, useCallback, useRef } from 'react';
import { getHTMLFromFragment } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { docToMarkdown, getMarkdownManager, markdownToEditorHtml, findUnsupportedFormatting } from '@/library/markdownCodec';
import {
  DOC_PATH, ISSUE_PATH, TASK_PATH, encodeMarkdownUrl, internalPathname, withRawLinkForms, withRawLinkRecorder,
} from '@/components/Canvas/extensions/refMarkdown';
import { RAW_AUTO_CHIP } from '@/components/Canvas/extensions/rawAutoChip';
import { useUiPrefs } from '@/library/UiPrefsContext';
import { hydrateEditor } from '@/library/refHydration';
import { slashCommandPluginKey, SLASH_OFF } from '@/components/Canvas/extensions/SlashCommandsExtension';
import { taskRefPluginKey } from '@/components/Canvas/extensions/TaskRefExtension';
import { REF_OFF } from '@/components/Canvas/extensions/refSuggestion';
import { mathEditPluginKey, MATH_EDIT_OFF } from '@/components/Canvas/extensions/MathEditExtension';
import { mentionPluginKey, MENTION_OFF } from '@/components/Canvas/extensions/MentionExtension';
import i18next from '@/library/i18n';

// raw 진입 시 열려 있는 제안 팝업(슬래시 메뉴/taskRef 검색/수식 편집/멘션)을 닫는다.
// 이 플러그인들은 view.update()에서만 팝업을 destroy하는데, update()는 tr이
// 실제로 dispatch돼야 불린다 — enterRaw()는 React state만 바꿔 EditorContent를
// 숨길 뿐 tr을 전혀 내지 않으므로, 열려 있던 팝업(document.body에 직접 붙는 DOM)이
// 고아로 남아 raw CodeMirror 위에 계속 떠 있는다(실측·스크린샷으로 확인된 버그).
// 표면마다 등록 확장이 다를 수 있어 getState()로 방어 체크한다.
// (export는 rawMode.dom.test.js의 팝업 생명주기 검증용 — 실사용 진입점은 enterRaw뿐)
const POPUP_PLUGINS = [
  [slashCommandPluginKey, SLASH_OFF],
  [taskRefPluginKey, REF_OFF],
  [mathEditPluginKey, MATH_EDIT_OFF],
  [mentionPluginKey, MENTION_OFF],
];

export function closeEditorPopups(editor) {
  const st = editor.state;
  let tr = null;
  for (const [pluginKey, offMeta] of POPUP_PLUGINS) {
    if (pluginKey.getState(st)?.active) {
      tr = (tr || st.tr).setMeta(pluginKey, offMeta);
    }
  }
  if (tr) editor.view.dispatch(tr);
}

// findUnsupportedFormatting 키 → 사용자 표시 라벨의 catalog 키 (모르는 키는 키 그대로 노출)
// underline은 ++text++로 무손실 왕복해 flag되지 않으므로 라벨도 없다 (markdownCodec.js 참조)
const UNSUPPORTED_LABEL_KEYS = {
  color: 'misc.rawMode.unsupported.color',
  highlightColor: 'misc.rawMode.unsupported.highlightColor',
  textAlign: 'misc.rawMode.unsupported.textAlign',
  imageWidth: 'misc.rawMode.unsupported.imageWidth',
  cellBackground: 'misc.rawMode.unsupported.cellBackground',
};

// 손실 경고 배지 문구. 경고 없으면 null.
// React 밖에서도 불릴 수 있어 훅이 아니라 i18next 인스턴스를 직접 읽는다(errorText.js와 같은 규약).
export function formatUnsupportedWarning(keys) {
  if (!keys || keys.length === 0) return null;
  const labels = keys.map((k) => (UNSUPPORTED_LABEL_KEYS[k] ? i18next.t(UNSUPPORTED_LABEL_KEYS[k]) : k));
  return i18next.t('misc.rawMode.unsupportedWarning', { items: labels.join(', ') });
}

// md에서는 칩과 일반 링크가 똑같이 [글](경로)라 다시 읽으면 내부 링크는 모두 칩이 되고, 같은 제목·같은 주소면
// 원문이 글자까지 같아 원문만으로는 구분할 수도 없다. 그래서 진입 때 태스크·이슈·문서 링크마다 md에서 차지하는 자리와
// 형태(칩·일반 링크)를 적어 두고, 저장·복귀 때 원문 편집기의 편집 기록으로 그 자리를 따라가 그대로 남은 링크만
// 원래 형태로 되돌린다(같은 링크를 넣거나 지워도 나머지는 제 형태). 새로 쓴 링크는 지금처럼 칩이 된다.
// 이 세 편집기(태스크 설명·댓글·이슈)에는 전에 이슈·문서 칩이 없어 그 일반 링크는 원문 왕복 뒤에도 일반 링크였다.
// 태스크 링크도 같은 규칙이다 — 진입 때 일반 링크면 일반 링크 그대로, 새로 쓴 링크는 칩.
// 같은 편집에서 원문이 만든 칩(일반 모드로 돌아갈 때 RAW_AUTO_CHIP에 원문에 쓴 링크 원문을 단다)은 다시 들어와도 'new'로 적고, 원문에도
// 처음 쓴 그대로 보인다 — 기존 칩으로 굳지 않고, 칩을 거치며 주소가 길어지지도 않는다.
const MARK_BASE = 9e15; // 순번 표지 — 실제 id(32비트 정수 이내)와 겹치지 않는 안전한 정수
const MARKER_URL = {
  task: (n) => `/branch/0/task/${MARK_BASE + n}`,
  issue: (n) => `/branch/0/task/0/issue/${MARK_BASE + n}`,
  doc: (n) => `/canvas/0/${MARK_BASE + n}`,
};
const markerUrl = (kind, n) => MARKER_URL[kind](n);
const markOf = (token) => {
  const id = token.issueId ?? token.pageId ?? token.taskId;
  return id >= MARK_BASE ? id - MARK_BASE : -1;
};
const CHIP_KEY = { taskRef: ['task', 'taskId'], issueRef: ['issue', 'issueId'], docRef: ['doc', 'pageId'] };

// 진입: md에서 태스크·이슈·문서 링크(칩·일반 링크)가 차지하는 자리 [{ from, to, raw, kind, form }].
// 칩의 id와 일반 링크의 주소만 순번 표지로 바꾼 문서 사본을 다시 읽을 때와 같은 파서로 읽어, 표지로 각 링크를 찾는다 —
// 주소 말고는 글자가 같아 코드·블록·괄호 처리까지 같은 자리에서 같은 토큰이 나온다.
function refLinks(editor, markdown) {
  const entries = []; // 순번 → { form, kind, mark(사본의 글자), real(원문의 글자) }
  const kindOf = (href) => {
    const pathname = internalPathname(href || '');
    if (pathname && ISSUE_PATH.test(pathname)) return 'issue';
    if (pathname && TASK_PATH.test(pathname)) return 'task';
    return pathname && DOC_PATH.test(pathname) ? 'doc' : null;
  };
  const visit = (node) => {
    if (CHIP_KEY[node.type]) {
      const [kind, key] = CHIP_KEY[node.type];
      const k = entries.length;
      const written = node.attrs?.[RAW_AUTO_CHIP]; // 같은 편집에서 원문이 만든 칩은 원문에 쓴 그대로 직렬화된다 — 그 주소 자리에 표지를 둔다
      if (written) {
        const url = /\]\(([^)\s]+)\)$/.exec(written);
        entries.push({ form: 'new', kind, mark: markerUrl(kind, k), real: url[1] });
        return { ...node, attrs: { ...node.attrs, [RAW_AUTO_CHIP]: `${written.slice(0, url.index + 2)}${markerUrl(kind, k)})` } };
      }
      entries.push({ form: 'chip', kind, mark: String(MARK_BASE + k), real: String(node.attrs?.[key]) });
      return { ...node, attrs: { ...node.attrs, [key]: MARK_BASE + k } };
    }
    if (!node.content) return node;
    let prev = null; // 바로 앞 글자 마디의 링크 — 속성이 같으면 같은 링크(한 순번)
    const content = node.content.map((child) => {
      const link = child.type === 'text' ? child.marks?.find((mk) => mk.type === 'link') : null;
      const kind = link && kindOf(link.attrs?.href);
      if (!kind) {
        prev = null;
        return visit(child);
      }
      if (!prev || JSON.stringify(prev.attrs) !== JSON.stringify(link.attrs)) {
        const k = entries.length;
        entries.push({ form: 'plain', kind, mark: markerUrl(kind, k), real: encodeMarkdownUrl(link.attrs.href) });
      }
      prev = link;
      const href = entries[entries.length - 1].mark;
      return { ...child, marks: child.marks.map((mk) => (mk === link ? { ...mk, attrs: { ...mk.attrs, href } } : mk)) };
    });
    return { ...node, content };
  };
  const manager = getMarkdownManager(editor.extensionManager.extensions);
  const copy = manager.serialize(visit(editor.getJSON()));
  // 사본의 위치 → 원문 위치: 앞쪽 표지들의 길이 차를 뺀다
  const at = entries.map((e) => copy.indexOf(e.mark));
  const toSource = (pos) => entries.reduce((p, e, k) => (at[k] >= 0 && at[k] < pos ? p - (e.mark.length - e.real.length) : p), pos);
  const items = [];
  withRawLinkRecorder((token) => {
    const k = markOf(token);
    const e = entries[k];
    if (!e || at[k] < 0) return;
    const offset = token.raw.lastIndexOf(e.mark); // 링크 원문 안에서 표지 자리
    const raw = token.raw.slice(0, offset) + e.real + token.raw.slice(offset + e.mark.length);
    const from = toSource(at[k] - offset);
    if (markdown.slice(from, from + raw.length) === raw) items.push({ from, to: from + raw.length, raw, kind: e.kind, form: e.form });
  }, () => manager.parse(copy));
  return items;
}

// 저장·복귀: 진입 원문의 글자마다 출처(진입 원문의 자리, 새로 쓴 글은 -1)를 달고 편집 기록을 한 단계씩 따라가, 진입 때 링크의
// 글자가 지금 원문에 빠짐없이 차례로 붙어 남은 링크를 찾는다. 지운 글은 지운 자리에 무덤으로 남겨 두고, 다시 들어온 글이 지운 글이면
// 되살려 출처를 잇는다 — 같은 자리(실행 취소·같은 자리에 다시 입력)는 늘, 다른 자리는 옮긴 경우만(Alt+↑/↓, 실행 취소·다시 실행 —
// 원문 편집기가 넘기는 조작 종류로 안다). 붙여넣기는 같은 자리여도 클립보드 출처로만 — 잘라 둔 줄 그대로면 되살리고, 복사해 붙이거나
// 새로 쓴 글은 새 글(새 링크는 칩)이다 — 복사가 있었으면 그 뒤 붙여넣은 글은 잘라 둔 줄이 아니라 복사본이다(잘라 둔 자리에 붙여도).
// 편집 기록을 하나로 이어 붙이면 '앞에 글 넣기 → 전체 삭제 → 실행 취소'가 한 구간 교체로 뭉쳐 되살린 링크가 새 링크처럼 보였다.
// 실행 취소·다시 실행은 CodeMirror 실행 취소 묶음을 그대로 따라간다(원문 편집기가 거래마다 실행 취소 깊이를 넘길 때): 0.5초 안에
// 이어 한 조작(잘라내기 두 번, 줄 이동 직후 입력)은 한 묶음이라 실행 취소 한 번이 여러 조작을 한꺼번에 되돌린다 — 실행 취소는 그
// 묶음 직전, 다시 실행은 그 실행 취소 직전의 글자 출처 상태로 그대로 되돌린다(CodeMirror가 글자를 그때와 똑같이 되돌리므로 맞출
// 필요가 없다). 깊이를 모르면 자리·글자로 맞춘다.
// 편집 기록이 없으면 원문이 진입 때와 같을 때만 그 자리 그대로, 기록이 지금 원문과 맞지 않으면 null.
// 원문 편집기는 { changes, userEvent, depth }를 넘긴다(depth = 그 뒤 실행 취소 깊이, 복사는 changes 없이 userEvent 'copy'만),
// ChangeSet만 넘기면 조작 종류 모름
const stepOf = (edit) => (edit && typeof edit === 'object' && 'userEvent' in edit ? edit : { changes: edit, userEvent: '' });
const textOf = (group) => group.map((r) => r.text).join('');

// 실행 취소 묶음 따라가기 계획: 깊이가 그대로인 편집은 앞 묶음에 이어지고(늘거나 줄면 새 묶음), 실행 취소는 맨 위 묶음을, 다시
// 실행은 마지막 실행 취소를 되돌린다(CodeMirror history와 같은 차례). snap = 상태를 찍어 둘 단계(그 단계 직전), back = 실행 취소·
// 다시 실행 단계 → 되돌아갈 사진의 단계. 깊이가 없거나 차례가 CodeMirror와 맞지 않으면 null(따라가지 않는다)
function historyPlan(edits) {
  const snap = new Set();
  const back = new Map();
  const done = []; // 묶음마다 첫 편집 단계
  const undone = []; // 실행 취소마다 [그 묶음 첫 편집 단계, 그 실행 취소 단계]
  let depth = 0;
  for (let i = 0; i < edits.length; i += 1) {
    const { changes, userEvent = '', depth: after } = stepOf(edits[i]);
    if (!changes) continue;
    if (typeof after !== 'number') return null;
    if (userEvent === 'undo') {
      const start = done.pop();
      if (start === undefined || after !== depth - 1) return null;
      if (!changes.empty) { // 바뀐 글이 없는 묶음(입력했다 바로 지움)은 되돌릴 것도 다시 실행할 몫도 없다(CodeMirror와 같이)
        snap.add(start);
        back.set(i, start);
        undone.push([start, i]);
      }
    } else if (userEvent === 'redo') {
      const last = undone.pop();
      if (!last || after > depth + 1) return null;
      snap.add(last[1]);
      back.set(i, last[1]);
      done.push(last[0]);
    } else {
      if (after !== depth || !done.length) done.push(i);
      undone.length = 0;
    }
    depth = after;
  }
  return { snap, back };
}

function survivingLinks(md, { source, items }, edits) {
  if (!edits?.length) return md === source ? items : null;
  let runs = [{ text: source, src: 0, live: true, tomb: null, gone: false }]; // gone: runs에서 빠졌다(나뉘거나 상태를 되돌려) — 모든 run이 같은 모양이게 처음부터 둔다
  let graves = []; // 무덤(한 번에 지운 글), 만든 차례대로
  let lastCut = null; // 마지막 잘라내기로 지운 글 — 아직 지운 채로 붙여넣어지면 옮긴 것이다
  let length = source.length;
  // 위치 찾기는 지난번 자리에서 앞뒤로 이어 간다(편집은 대개 한곳에 몰린다): runs[0..ci)에 살아 있는 글자 cat개
  let ci = 0;
  let cat = 0;
  // 살아 있는 글자 pos개 바로 뒤 run 자리(그 자리 무덤들 앞) — run 한가운데면 나눈다
  const boundary = (pos) => {
    let i = ci;
    let at = cat;
    while (i > 0 && (at > pos || (at === pos && !runs[i - 1].live))) {
      i -= 1;
      if (runs[i].live) at -= runs[i].text.length;
    }
    while (at < pos) {
      const r = runs[i];
      if (r.live) {
        if (pos < at + r.text.length) {
          const k = pos - at;
          runs.splice(i, 1, { ...r, text: r.text.slice(0, k) }, { ...r, text: r.text.slice(k), src: r.src < 0 ? -1 : r.src + k });
          r.gone = true; // 둘로 나뉘어 runs에서 빠졌다(이 run을 적어 둔 무덤 목록은 더 쓰지 않는다)
          at = pos;
        } else {
          at += r.text.length;
        }
      }
      i += 1;
    }
    ci = i;
    cat = at;
    return i;
  };
  // 무덤 안 run을 둘로(옮긴 줄의 줄바꿈 떼기) — 무덤·마지막 잘라내기 목록도 맞춘다. 목록은 새로 만든다(찍어 둔 상태 사진이 옛 목록을
  // 쓴다). 목록이 바뀐 무덤은 처음 목록(original)과 함께 적어 두고 사진마다 그 무덤들의 목록을 담는다
  const changed = [];
  const splitDead = (r, k) => {
    const parts = [{ ...r, text: r.text.slice(0, k) }, { ...r, text: r.text.slice(k), src: r.src < 0 ? -1 : r.src + k }];
    const swap = (list) => list.flatMap((x) => (x === r ? parts : [x]));
    const j = runs.indexOf(r);
    if (j >= 0) runs.splice(j, 1, ...parts);
    const g = r.tomb;
    if (g) {
      if (!g.original) {
        g.original = g.runs;
        changed.push(g);
      }
      g.runs = swap(g.runs);
    }
    if (lastCut?.includes(r)) lastCut = swap(lastCut);
    r.gone = true;
    ci = 0;
    cat = 0;
    return parts;
  };
  const valid = (g) => g.runs.every((r) => !r.live && !r.gone && r.tomb === g);
  // 실행 취소 묶음 경계(단계 at 직전)의 상태 사진: run 목록과 run마다 살았는지·무덤·글자(새로 쓴 글은 이어 쓰며 자란다), 무덤 목록과
  // 목록이 바뀐 무덤들의 목록, 마지막 잘라내기
  const take = (at) => {
    const n = runs.length;
    const live = new Array(n);
    const tomb = new Array(n);
    const text = new Array(n);
    for (let i = 0; i < n; i += 1) {
      live[i] = runs[i].live;
      tomb[i] = runs[i].tomb;
      text[i] = runs[i].text;
    }
    return { at, runs: runs.slice(), live, tomb, text, graves: graves.slice(), lists: changed.map((g) => g.runs), lastCut };
  };
  const restore = (shot) => {
    for (const r of runs) r.gone = true; // 사진에 없는 run(그 뒤 생기거나 나뉜 run)은 빠진다
    runs = shot.runs.slice();
    for (let i = 0; i < runs.length; i += 1) {
      const r = runs[i];
      r.live = shot.live[i];
      r.tomb = shot.tomb[i];
      r.text = shot.text[i];
      r.gone = false;
    }
    graves = shot.graves.slice();
    changed.forEach((g, i) => { g.runs = i < shot.lists.length ? shot.lists[i] : g.original; }); // 사진 뒤에 처음 바뀐 무덤은 처음 목록
    // 클립보드는 실행 취소되지 않는다 — 사진 뒤에 자르거나 복사했으면 클립보드 글은 이 상태에서 잘라 둔 줄이 아니다(붙이면 복사본)
    lastCut = clipAt >= shot.at ? null : shot.lastCut;
    ci = 0;
    cat = 0;
  };

  // 같은 자리: 그 자리 무덤 묶음을 최근 것부터 이어 모아 들어온 글과 똑같은 첫 묶음 — 이어서 지운 글은 실행 취소 한 번에 함께
  // 돌아오고, 실행 취소로 지운 글(다시 실행 몫)처럼 더 최근 묶음이 맞지 않으면 건너뛴다. 한 실행 취소 묶음 안에서 쓰고 지운 글(새로
  // 쓴 글만 지운 묶음)은 돌아오지 않으므로 빼고도 맞춰 보고, 묶음 안의 새로 쓴 글을 빼고 원래 글만으로도 맞춰 본다(같은 자리 잘라 붙인
  // 뒤 실행 취소 두 번). 선택 없이 마지막 줄을 잘라(Cmd+X) 붙이면 붙인 글 끝에 줄바꿈이 하나 더 붙는다(CodeMirror 줄 단위 붙여넣기).
  const sameSpot = (start, gapEnd, text) => {
    if (gapEnd === start) return null;
    const gap = runs.slice(start, gapEnd);
    const order = new Map(gap.map((r, i) => [r, i]));
    const tombs = [...new Set(gap.map((r) => r.tomb))]
      .filter((t) => t.runs.every((r) => r.tomb === t && order.has(r)))
      .sort((a, b) => b.serial - a.serial);
    const kept = tombs.filter((t) => t.runs.some((r) => r.src >= 0));
    const match = (want, pool, sourceOnly) => {
      const own = (r) => !sourceOnly || r.src >= 0;
      const sizes = pool.map((t) => t.runs.reduce((n, r) => (own(r) ? n + r.text.length : n), 0));
      for (let s = 0; s < pool.length; s += 1) {
        let size = 0;
        let e = s;
        while (e < pool.length && size < want.length) size += sizes[e++];
        if (size !== want.length) continue;
        const found = pool.slice(s, e).flatMap((t) => t.runs.filter(own)).sort((a, b) => order.get(a) - order.get(b));
        if (textOf(found) === want) return found;
      }
      return null;
    };
    const cutLine = text.length > 1 && text.endsWith('\n') ? text.slice(0, -1) : null;
    for (const want of [text, cutLine]) {
      const found = want && (match(want, tombs, false) || match(want, kept, false) || match(want, kept, true));
      if (found) return { group: found, before: '', after: want === text ? '' : '\n' };
    }
    return null;
  };
  // 묶음 끝('end')이나 앞('start')의 줄바꿈 한 글자를 떼어 낸 나머지(떼기 전에 나머지를 먼저 잡는다 — splitDead가 묶음 목록도 바꾼다)
  const dropNewline = (group, side) => {
    if (side === 'end') {
      const head = group.slice(0, -1);
      const last = group[group.length - 1];
      return last.text.length > 1 ? [...head, splitDead(last, last.text.length - 1)[0]] : head;
    }
    const tail = group.slice(1);
    return group[0].text.length > 1 ? [splitDead(group[0], 1)[1], ...tail] : tail;
  };
  // 다른 자리로 옮긴 글인지 — 지운 글 묶음(문서 차례)과 들어온 글을 맞춘다. 같은 글, 끝 줄바꿈 하나 더(마지막 줄을 잘라 줄 단위로
  // 붙이기), 끝 줄바꿈 없이(잘라 둔 줄을 선택 위에 붙이기), 줄바꿈 자리만 바뀐 줄(Alt+↑ 'N\n'→'\nN', Alt+↓ '\nN'→'N\n'),
  // 원래 글만(붙인 줄바꿈 없이)
  const fit = (group, text) => {
    const all = textOf(group);
    if (all === text) return { group, before: '', after: '' };
    if (`${all}\n` === text) return { group, before: '', after: '\n' };
    if (all.length > 1 && all.endsWith('\n')) {
      if (text === all.slice(0, -1)) return { group: dropNewline(group, 'end'), before: '', after: '' };
      if (text === `\n${all.slice(0, -1)}`) return { group: dropNewline(group, 'end'), before: '\n', after: '' };
    }
    if (all.length > 1 && all.startsWith('\n') && text === `${all.slice(1)}\n`) {
      return { group: dropNewline(group, 'start'), before: '', after: '\n' };
    }
    const src = group.filter((r) => r.src >= 0);
    if (src.length && src.length < group.length) {
      if (textOf(src) === text) return { group: src, before: '', after: '' };
      if (`${textOf(src)}\n` === text) return { group: src, before: '', after: '\n' };
    }
    return null;
  };
  const firstFit = (groups, text) => {
    for (const group of groups) {
      const hit = fit(group, text);
      if (hit) return hit;
    }
    return null;
  };
  const fresh = (text) => ({ text, src: -1, live: true, tomb: null, gone: false });
  // 되살리기: 같은 자리면 그대로 살리고(붙는 줄바꿈은 그 자리 무덤들 뒤 — 줄 끝에서 먼저 지운 글을 떼어 놓지 않게), 다른 자리면
  // 지금 자리로 옮긴다. 옮길 때는 묶음 사이와 바로 뒤에 붙어 있던 다른 무덤(그 줄 안을 먼저 고친 기록)도 차례 그대로 함께 옮긴다
  // — 실행 취소로 그 고친 글이 줄과 함께 제자리에 돌아오게
  const revive = ({ group, before, after }, pos, inPlace, gapEnd) => {
    if (inPlace) {
      group.forEach((r) => Object.assign(r, { live: true, tomb: null }));
      if (after) runs.splice(gapEnd, 0, fresh(after));
      return;
    }
    const owner = group[0].tomb;
    const inGroup = new Set(group);
    const at = group.map((r) => runs.indexOf(r));
    const first = Math.min(...at);
    let last = Math.max(...at);
    while (last + 1 < runs.length && !runs[last + 1].live && runs[last + 1].tomb !== owner) last += 1;
    const moving = runs.slice(first, last + 1).filter((r) => inGroup.has(r) || (!r.live && r.tomb !== owner));
    const set = new Set(moving);
    runs = runs.filter((r) => !set.has(r));
    ci = 0;
    cat = 0;
    group.forEach((r) => Object.assign(r, { live: true, tomb: null }));
    const start = boundary(pos);
    let end = start;
    while (end < runs.length && !runs[end].live) end += 1;
    runs.splice(end, 0, ...(before ? [fresh(before)] : []), ...moving, ...(after ? [fresh(after)] : []));
  };

  const plan = edits.some((e) => e?.userEvent === 'undo' || e?.userEvent === 'redo') ? historyPlan(edits) : null; // 실행 취소가 없으면 따라갈 것도 없다
  const shots = new Map();
  let settled = null; // 실행 취소·다시 실행으로 되돌린 뒤 아직 아무것도 바뀌지 않은 상태 — 그 사진 그대로다
  let clipAt = -1; // 마지막으로 자르거나 복사한 단계
  for (let step = 0; step < edits.length; step += 1) {
    const { changes, userEvent = '' } = stepOf(edits[step]);
    if (!changes) {
      if (userEvent === 'copy') {
        lastCut = null;
        clipAt = step;
        settled = null;
      }
      continue;
    }
    if (changes.length !== length) return null;
    if (plan?.snap.has(step)) shots.set(step, settled || take(step));
    if (plan?.back.has(step)) { // 실행 취소·다시 실행: 그 묶음 직전(다시 실행은 그 실행 취소 직전) 상태로
      settled = shots.get(plan.back.get(step));
      restore(settled);
      length = changes.newLength;
      continue;
    }
    settled = null;
    const undoRedo = userEvent === 'undo' || userEvent === 'redo';
    const list = [];
    changes.iterChanges((fromA, toA, fromB, toB, inserted) => list.push([fromA, toA, fromB, inserted.toString()]));
    // 지우기 먼저(뒤쪽부터 — 앞쪽 위치가 그대로), 그다음 넣기(앞쪽부터, 새 원문 위치) — 같은 조작 안에서 옮긴 줄을 맞출 수 있다
    const born = [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const [fromA, toA] = list[i];
      if (toA === fromA) continue;
      const start = boundary(fromA);
      const end = boundary(toA);
      const killed = runs.slice(start, end).filter((r) => r.live);
      ci = start;
      cat = fromA;
      if (killed.length) {
        const grave = { serial: graves.length + 1, runs: killed, original: null };
        killed.forEach((r) => Object.assign(r, { live: false, tomb: grave }));
        graves.push(grave);
        born.push(grave);
      }
    }
    if (/^delete\.cut/.test(userEvent)) {
      lastCut = born.length === 1 ? [...born[0].runs] : null;
      clipAt = step;
    }
    for (const [, , fromB, text] of list) {
      if (!text) continue;
      const start = boundary(fromB);
      let gapEnd = start;
      while (gapEnd < runs.length && !runs[gapEnd].live) gapEnd += 1;
      // 다른 자리에서 되살리는 건 옮긴 경우만: Alt+↑/↓·실행 취소·다시 실행은 같은 조작에서 지운 글이 먼저(그 자리에 같은 글의
      // 다른 무덤 — 잘라 둔 줄 — 이 있어도), 그다음 같은 자리, 실행 취소·다시 실행은 마지막으로 최근에 지운 글(잘라 다른 자리에 붙인
      // 줄을 되돌릴 때). 붙여넣기는 같은 자리 맞추기 없이 클립보드 출처로만: 아직 지운 채인 마지막 잘라내기면 그 줄(같은 자리든 다른
      // 자리든), 그 뒤 복사했으면 새 글 — 같은 글자가 같은 자리에 들어왔다는 것만으로 복사본을 지운 일반 링크로 되살리지 않는다
      const paste = /^input\.paste/.test(userEvent);
      const pasted = paste && lastCut?.length && lastCut.every((r) => !r.live && !r.gone) ? [lastCut] : [];
      const earlier = () => graves.filter((g) => !born.includes(g) && valid(g)).reverse().map((g) => g.runs);
      const sameStep = userEvent === 'move.line' || undoRedo ? firstFit(born.filter(valid).map((g) => g.runs), text) : null;
      const same = !sameStep && !paste && sameSpot(start, gapEnd, text);
      const moved = sameStep || (!same && (firstFit(pasted, text) || (undoRedo && firstFit(earlier(), text))));
      if (same || moved) {
        revive(same || moved, fromB, !!same, gapEnd);
      } else if (gapEnd === start && runs[start - 1]?.live && runs[start - 1].src === -1) {
        runs[start - 1].text += text; // 바로 앞이 새로 쓴 글이면 이어 붙인다(타자마다 run이 늘지 않게)
        cat += text.length;
      } else {
        runs.splice(gapEnd, 0, fresh(text));
      }
    }
    length = changes.newLength;
  }
  const live = runs.filter((r) => r.live);
  if (textOf(live) !== md) return null;
  const posOf = new Int32Array(source.length).fill(-1); // 진입 원문 자리 → 지금 원문 자리
  let at = 0;
  for (const r of live) {
    if (r.src >= 0) for (let i = 0; i < r.text.length; i += 1) posOf[r.src + i] = at + i;
    at += r.text.length;
  }
  return items.flatMap((l) => {
    const from = posOf[l.from];
    for (let i = 0; i < l.raw.length; i += 1) if (from < 0 || posOf[l.from + i] !== from + i) return [];
    return [{ ...l, from, to: from + l.raw.length }];
  });
}

// 남은 링크의 주소만 표지로 바꾼 사본을 같은 파서로 읽어, 칩 토큰 자리마다 형태를 정한다(표지가 없으면 새 링크 'new' — 보통은 칩)
function linkFormsAt(md, extensions, survivors) {
  let copy = md;
  survivors.map((l, i) => [l, i]).sort(([a], [b]) => b.from - a.from).forEach(([l, i]) => {
    const urlFrom = l.from + l.raw.lastIndexOf('](') + 2; // 우리가 찾은 링크 주소에는 '](' 가 없다
    copy = copy.slice(0, urlFrom) + markerUrl(l.kind, i) + copy.slice(l.to - 1);
  });
  const forms = new Map();
  withRawLinkRecorder((token) => {
    const i = markOf(token);
    const l = survivors[i];
    // 형태는 실제 토큰 원문에 단다 — 앞에 짝 없는 '['가 생기면 토큰이 링크보다 길어진다. 표지 주소만 원래 주소로 되돌린다
    let raw = token.raw;
    if (l) {
      const mark = markerUrl(l.kind, i);
      const at = raw.lastIndexOf(mark);
      raw = raw.slice(0, at) + l.raw.slice(l.raw.lastIndexOf('](') + 2, -1) + raw.slice(at + mark.length);
    }
    forms.set(raw, [...(forms.get(raw) || []), l ? l.form : 'new']);
  }, () => getMarkdownManager(extensions).parse(copy));
  return forms;
}

// 편집 기록을 못 쓸 때(방어): 진입 때 나온 순서대로 형태를 준다(같은 링크를 넣고 지우면 밀릴 수 있다)
function linkFormsInOrder(items) {
  const forms = new Map();
  items.forEach((l) => forms.set(l.raw, [...(forms.get(l.raw) || []), l.form]));
  return forms;
}

// WYSIWYG → raw 진입: 현재 doc의 markdown + md 미표현 서식 경고 키 + 태스크·이슈·문서 링크 자리(parseRawToHtml에 넘긴다)
export function enterRawState(editor) {
  const markdown = docToMarkdown(editor);
  return {
    markdown,
    warnings: findUnsupportedFormatting(editor.getJSON()), // 계약: JSONContent (PM Node 아님 — S0.2 §)
    rawLinks: { source: markdown, items: refLinks(editor, markdown) },
  };
}

// 저장할 HTML이 넘을 수 있는 가장 긴 길이 — 서버 한도 검사(파이썬 글자 수 = 코드 포인트)와, 원문 편집기가 만든 HTML을 일반 모드로
// 돌아와 저장하거나 저장 뒤 수정창으로 다시 열어 그대로 저장할 때(마지막 최상위 블록이 문단이 아니면 TrailingNode가 빈 문단을 붙인다).
// 원문 편집기가 만든 HTML은 이미 편집기 직렬화라 그 밖의 재저장 증가가 없다(reserializeGrowth.dom.test.js가 고정)
const TRAILING_PARAGRAPH = '<p></p>';
const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
export function resaveLength(html) {
  const codePoints = html.length - (html.match(SURROGATE_PAIR) || []).length;
  return codePoints + (/<\/p>$/.test(html) ? 0 : TRAILING_PARAGRAPH.length);
}

// raw → 에디터 HTML. 공백뿐이면 null (기존 editor.isEmpty → onSave(null) 시맨틱).
// rawLinks: 진입 때 enterRawState가 적어 둔 링크 자리, edits: 그 뒤 원문 편집 기록 — 편집 순서대로 담은 배열(이어 붙이지 않는다),
// 각 단계는 원문 편집기가 넘기는 { changes: ChangeSet, userEvent, depth(그 뒤 실행 취소 깊이) } 또는 ChangeSet만(조작 종류 모름
// — 다른 자리로 옮긴 줄은 모른다). ChangeSet 하나만 넘기면 한 단계, 없으면 null.
// limit(서버 한도, 없으면 null): A안 — 원문에서 새로 칩이 된 링크(진입 때 칩이 아니었던 자리) 때문에 한도를 넘으면 본문 전체에서 그 칩
// 변환을 거둬 일반 링크로 둔다(일부만 칩으로 두지 않고, 진입 때 칩·일반 링크는 그대로). 일반 링크로도 넘으면 서버가 지금처럼 거절하고,
// 일반 모드로 돌아갈 때는 이 결과가 편집기에 들어가 줄이면 일반 링크 기준으로 저장된다.
// 돌려주는 autoChips: 결과의 칩마다(문서 순서) 이번 원문 읽기가 새로 만든 칩이면 그 링크를 원문에 쓴 그대로, 아니면 null —
// 일반 모드로 돌아갈 때 표시로 단다(exitRaw)
export function parseRaw(md, extensions, rawLinks, edits = null, { limit = null } = {}) {
  if (!md || !md.trim()) return null;
  let forms = null;
  if (rawLinks?.items.length) {
    const survivors = survivingLinks(md, rawLinks, edits && [].concat(edits));
    forms = survivors ? linkFormsAt(md, extensions, survivors) : linkFormsInOrder(rawLinks.items);
  }
  const read = (keepNewPlain) => {
    const autoChips = [];
    const html = withRawLinkForms(forms, () => markdownToEditorHtml(md, extensions), { keepNewPlain, onChip: (written) => autoChips.push(written) });
    return { html, autoChips };
  };
  const normal = read(false);
  return limit == null || resaveLength(normal.html) <= limit ? normal : read(true);
}

export const parseRawToHtml = (...args) => parseRaw(...args)?.html ?? null;

// 일반 모드로 돌아갈 때: 이번 원문 읽기가 새로 만든 칩에 같은 편집 동안의 표시를 단다(같은 거래 — 실행 취소·다시 실행이 함께 따라간다).
// 칩 수가 읽은 결과와 다르면(방어) 아무 칩에도 달지 않는다 — 기존 칩을 새 칩으로 잘못 보지 않는 쪽
function markRawAutoChips(tr, autoChips) {
  if (!autoChips?.some(Boolean)) return;
  const chips = [];
  tr.doc.descendants((node, pos) => { if (RAW_AUTO_CHIP in node.attrs) chips.push(pos); });
  if (chips.length !== autoChips.length) return;
  chips.forEach((pos, i) => { if (autoChips[i]) tr.setNodeAttribute(pos, RAW_AUTO_CHIP, autoChips[i]); });
}

// 일반 모드 저장(A안): 같은 편집에서 원문이 만든 칩(표시) 때문에 한도를 넘으면 그 칩을 본문 단위로 일반 링크로 바꾼 HTML을 돌려준다.
// 그 칩의 원문(원문에 쓴 그대로)을 원문 대체 읽기와 같은 파서로 일반 링크로 읽어 넣는다(원문에서 저장한 결과와 같은 HTML). 표시 없는 칩 — 저장된 뒤
// 다시 연 칩, 일반 모드에서 넣은 칩 — 은 건드리지 않고, 편집기 문서도 바꾸지 않는다
export function htmlForSave(editor, limit) {
  const html = editor.getHTML();
  if (limit == null || resaveLength(html) <= limit) return html;
  const autos = [];
  editor.state.doc.descendants((node, pos) => { if (node.attrs[RAW_AUTO_CHIP]) autos.push([node, pos]); });
  if (!autos.length) return html;
  const manager = getMarkdownManager(editor.extensionManager.extensions);
  const link = editor.schema.marks.link;
  const tr = editor.state.tr;
  for (const [node, pos] of autos.reverse()) { // 뒤에서부터 — 앞 칩 자리가 밀리지 않는다
    const md = manager.serialize({ type: 'doc', content: [{ type: 'paragraph', content: [node.toJSON()] }] });
    const read = withRawLinkForms(null, () => manager.parse(md), { keepNewPlain: true });
    const inline = Fragment.fromJSON(editor.schema, read.content?.[0]?.content || []);
    if (!inline.size) continue;
    tr.replaceWith(pos, pos + node.nodeSize, inline);
    // 일반 모드에서 칩에 준 서식(굵게·기울임 등)은 그 일반 링크 글자에도 그대로 — 링크를 밀어내는 서식(코드)은 링크(주소)를 지키려고 뺀다
    for (const mark of node.marks) if (mark.type !== link && !mark.type.excludes(link)) tr.addMark(pos, pos + inline.size, mark);
  }
  return getHTMLFromFragment(tr.doc.content, editor.schema);
}

// prefill(답글 자동 멘션 등) 콘텐츠를 갖고 뜨는 에디터 인스턴스는 선호가 raw여도
// rich로 시작해야 한다 — enterRaw의 md 직렬화가 멘션 칩을 @평문으로 강등하고
// (mention은 md 복원 토크나이저가 없음) 제출 시 data-mention이 사라져 mention
// 알림이 소실되기 때문. 수동 토글은 명시적 선택이라 허용(억제하지 않음).
export function shouldAutoEnterRaw(prefs, autoEnter = true) {
  return autoEnter && prefs?.editor_raw_mode === true;
}

// 비협업 3표면(task 설명·issue·댓글) 공용 raw 모드 훅.
// - editor: TipTap Editor (준비 전 null 허용)
// - extensions: 해당 표면 useEditor에 넘긴 것과 같은 배열
// - enabled: false면 자동 진입·토글 비활성 (IssueEditor를 공유하는 AnnotationSidebar 제외용)
// - options.autoEnter: false면 선호가 raw여도 자동 진입만 스킵 (수동 토글은 그대로 허용;
//   답글 prefill처럼 raw 왕복 시 콘텐츠가 손실되는 인스턴스용 — CommentItem.js 참조)
// - options.limit: 이 편집기로 저장하는 경로의 서버 한도(library/contentLimits.js, 없으면 null) — 원문 저장·복귀의 A안 판정
export function useRawMode(editor, extensions, enabled = true, { autoEnter = true, limit = null } = {}) {
  const { prefs, loaded, setNamespace } = useUiPrefs();
  const [isRaw, setIsRaw] = useState(false);
  const isRawRef = useRef(false);
  const [rawText, setRawText] = useState('');
  const rawTextRef = useRef('');
  const rawLinksRef = useRef(null); // 진입 때 적어 둔 태스크·이슈·문서 링크 자리(enterRawState) — 저장·복귀 파싱에 넘긴다
  const editsRef = useRef([]); // 그 뒤 원문 편집 기록(ChangeSet 또는 { changes, userEvent, depth }, 편집 순서대로) — 링크 자리를 따라가는 데 쓴다
  // RawMarkdownEditor는 value를 마운트 초기값으로만 쓰는 uncontrolled —
  // session을 key로 넘겨 enterRaw/resetRaw마다 강제 리마운트한다.
  const [session, setSession] = useState(0);
  const [warnings, setWarnings] = useState([]);
  const [parseError, setParseError] = useState(false);

  // 키 입력마다 ref만 갱신한다 — rawText(state)는 RawMarkdownEditor의 마운트
  // 초기값으로만 읽히는 uncontrolled 값이라, 타이핑 중 갱신해도 그 값을 아무도
  // 읽지 않고 표면 전체의 리렌더만 유발한다. state는 enterRaw/resetRaw(세션
  // 경계, 곧 리마운트)에서만 맞춰준다.
  const handleRawChange = useCallback((text, changes, userEvent, depth) => {
    rawTextRef.current = text;
    if (changes) editsRef.current.push(userEvent || depth !== undefined ? { changes, userEvent, depth } : changes);
    else if (userEvent) editsRef.current.push({ changes: null, userEvent }); // 복사 — 글자는 그대로
  }, []);

  // raw 세션 텍스트 교체 + 강제 리마운트 (imperative clearContent용)
  const resetRaw = useCallback((text = '') => {
    rawTextRef.current = text;
    rawLinksRef.current = null;
    editsRef.current = [];
    setRawText(text);
    setSession((s) => s + 1);
  }, []);

  const enterRaw = useCallback(() => {
    if (!editor || editor.isDestroyed || isRawRef.current) return;
    closeEditorPopups(editor);
    const { markdown, warnings: warn, rawLinks } = enterRawState(editor);
    rawTextRef.current = markdown;
    rawLinksRef.current = rawLinks;
    editsRef.current = [];
    setRawText(markdown);
    setWarnings(warn);
    setParseError(false);
    setSession((s) => s + 1);
    // ref를 상태보다 먼저 — EditorContent가 숨겨지며 나는 tiptap blur가
    // 표면의 blur-저장 가드(isRawRef 체크)에 걸리도록 동기 세팅.
    isRawRef.current = true;
    setIsRaw(true);
  }, [editor]);

  // 저장/복귀 공용 파싱. 실패 시 parseError 배지 on — 저장 차단은 호출부 책임.
  const parseCurrentRaw = useCallback(() => {
    try {
      const read = parseRaw(rawTextRef.current, extensions, rawLinksRef.current, editsRef.current, { limit });
      setParseError(false);
      return { ok: true, html: read?.html ?? null, autoChips: read?.autoChips ?? [] };
    } catch (err) {
      console.error('raw markdown parse failed', err);
      setParseError(true);
      return { ok: false, html: null, autoChips: [] };
    }
  }, [extensions, limit]);

  const exitRaw = useCallback(() => {
    if (!editor || editor.isDestroyed || !isRawRef.current) return;
    const res = parseCurrentRaw();
    if (!res.ok) return; // 파싱 실패(방어) — raw 유지 + 배지, 사용자 텍스트 보존
    // 이번 원문 읽기가 새로 만든 칩에 같은 편집 동안의 표시를 setContent와 같은 거래에서 단다(실행 취소·다시 실행이 함께 따라간다)
    editor.chain().setContent(res.html || '', { emitUpdate: true }).command(({ tr }) => { markRawAutoChips(tr, res.autoChips); return true; }).run();
    isRawRef.current = false;
    setIsRaw(false);
    setWarnings([]);
    // md 링크에서 복원된 칩을 최신 제목·상태로 재해석 (fire-and-forget)
    hydrateEditor(editor);
  }, [editor, parseCurrentRaw]);

  const toggleRaw = useCallback(() => {
    if (!enabled) return;
    const wantRaw = !isRawRef.current;
    if (wantRaw) enterRaw(); else exitRaw();
    // 전환이 실제로 일어났을 때만 선호 기록 (exitRaw 파싱 실패 시 미기록)
    if (isRawRef.current === wantRaw) setNamespace('editor_raw_mode', wantRaw);
  }, [enabled, enterRaw, exitRaw, setNamespace]);

  const isRawEmpty = useCallback(() => rawTextRef.current.trim() === '', []);

  // ui_prefs 선호 자동 진입 — 에디터 준비 + prefs 로드 후 1회 (prefill 인스턴스는 억제)
  const autoRef = useRef(false);
  useEffect(() => {
    if (!enabled || autoRef.current || !editor || !loaded) return;
    autoRef.current = true;
    if (shouldAutoEnterRaw(prefs, autoEnter)) enterRaw();
  }, [enabled, autoEnter, editor, loaded, prefs.editor_raw_mode, enterRaw]);

  return {
    isRaw, isRawRef, rawText, session, warnings, parseError,
    handleRawChange, toggleRaw, parseCurrentRaw, isRawEmpty, resetRaw,
  };
}
