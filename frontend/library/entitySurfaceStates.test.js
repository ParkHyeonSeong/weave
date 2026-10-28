import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileString } from 'sass';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import { entityTintStyle, ENTITY_SURFACE_PROFILES } from './entityTint.js';
import { contrastRatio, mixSrgb, rgbToHex, relativeLuminance, BADGE_MIN, TEXT_MIN } from './colorContrast.js';
import { CORPUS } from './__fixtures__/storedColorCorpus.js';
import { tokenOf, tokenOver, rawTokenOf } from './__fixtures__/compiledThemeTokens.js';
import { TIPTAP_COLOR_MAP } from './tiptapColorMap.js';

// ═══════════════════════════════════════════════════════════════════════════
// 배지가 **실제로 얹히는 부모**는 호출부 하나당 하나가 아니다 — 행·항목의 상태마다 다르고,
// 표 셀처럼 **사용자가 부모 색을 고르는** 자리도 있다.
//
// 네 가지를 한 파일에서 물린다. 하나라도 빠지면 계약이 공허해진다:
//   ① 호출부 소스가 그 옵션을 실제로 넘기는가   (AST 호출 원장 18곳 exact)
//   ② 그 상태에서 **CSS가 실제로 이기는 배경**이 무엇인가 (컴파일 산출 캐스케이드)
//   ③ 그 배경 위에서 산출이 서는가              (코퍼스 전건)
//   ④ 그 부모가 임의 색·조상 opacity로 새지 않는가 (표 셀 · --context)
//
// ⛔ 부모색을 hex 상수로 적지 마라. 부모는 **컴파일된 SCSS의 이기는 background 선언**을
//    읽어 _themes.scss 토큰으로 해석한다. 상수표를 따로 두면 SCSS가 바뀌어도 계약이 안 움직인다.
// ⛔ 선택자를 `includes()`로 재지 마라. `.TaskListRow--selected`가 `--selectedX`에도 걸린다.
// ═══════════════════════════════════════════════════════════════════════════

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(here, '..');
const stylesDir = resolve(frontendDir, 'styles');
const srcOf = (rel) => readFileSync(resolve(frontendDir, rel), 'utf8');

// ─── 컴파일 산출 도구 ───────────────────────────────────────────────────────
// ⚠️ `url`을 반드시 넘긴다 — 컴포넌트 SCSS는 `@use '../../variables'`처럼 **자기 위치 기준**
//    상대 경로를 쓰는데, compileString은 url이 없으면 그 기준점을 몰라 해석에 실패한다.
const compileScss = (rel) => {
  const abs = resolve(stylesDir, rel);
  return compileString(readFileSync(abs, 'utf8'), { url: pathToFileURL(abs), loadPaths: [stylesDir] }).css;
};
const rulesOf = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m, i) => ({ i, sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
const selParts = (sel) => sel.split(',').map((p) => p.trim().replace(/\s+/g, ' ')).filter(Boolean);
// 선언 경계를 지킨다 — `background`가 `background-color`의 접두라 정확히 끊어 읽는다.
const declOf = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};
const hasDecl = (body, prop) => declOf(body, prop) !== null;
const specOne = (sel) => [
  (sel.match(/#[\w-]/g) || []).length,
  (sel.match(/\.[\w-]|\[|:[a-z-]+\(?/gi) || []).length,
  (sel.match(/(^|[\s>+~])[a-z]/gi) || []).length,
];
const cmpSpec = (a, b) => { for (let k = 0; k < 3; k++) if (a[k] !== b[k]) return a[k] > b[k] ? 1 : -1; return 0; };

// ─── 캐스케이드 시뮬레이터 ─────────────────────────────────────────────────
// 요소 자신을 겨냥하는 선택자는 **자손 결합자가 없는 단일 compound**뿐이다.
// (`.TaskListRow--context:hover .TaskListRow__Id`는 자식 규칙이라 행 배경의 후보가 아니다.)
const isCompound = (p) => !/[\s>+~]/.test(p);
const classesOf = (p) => [...p.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
// `::before` 같은 pseudo-element도 여기 잡히지만, 활성 pseudo 집합에 없으므로 자동 탈락한다.
const pseudosOf = (p) => [...p.matchAll(/:([a-z-]+)/g)].map((m) => m[1]);

/** 클래스 집합 + 활성 pseudo에서 `prop`을 **이기는** 선언. 명시도 → 동률이면 선언 순서. */
function winningDecl(rules, prop, classes, pseudos) {
  const cls = new Set(classes);
  const ps = new Set(pseudos);
  let best = null;
  for (const r of rules) {
    if (!hasDecl(r.body, prop)) continue;
    for (const part of selParts(r.sel)) {
      if (!isCompound(part)) continue;
      if (!classesOf(part).every((c) => cls.has(c))) continue;
      if (!pseudosOf(part).every((p) => ps.has(p))) continue;
      const spec = specOne(part);
      const c = best ? cmpSpec(spec, best.spec) : 1;
      if (c > 0 || (c === 0 && r.i >= best.i)) best = { spec, i: r.i, sel: part, decl: declOf(r.body, prop) };
    }
  }
  return best;
}

// 토큰 배경 선언 → 실제 칠해지는 hex. 반투명 토큰은 그 아래 색 위에 합성한다.
const VAR_RE = /^var\(--([\w-]+)\)$/;
const MIX_RE = /^color-mix\(in srgb,\s*var\(--([\w-]+)\)\s*([\d.]+)%,\s*var\(--([\w-]+)\)\s*\)$/;
const OPAQUE_TOKEN = /^(#[0-9A-Fa-f]{3,8}|rgb\([^)]*\))$/;
function resolveBgToHex(theme, decl, under) {
  const d = String(decl).trim();
  if (d === 'transparent' || d === 'none') return under;
  // 토큰이 아니라 **박아 넣은 색**도 받는다 — 그래야 그런 회귀가 파싱 오류가 아니라
  // 「그 부모 위에서 코퍼스가 미달」이라는 제 의미의 RED로 드러난다.
  if (/^#[0-9A-Fa-f]{6}$/.test(d)) return d.toUpperCase();
  const rgb = d.match(/^rgb\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*\)$/);
  if (rgb) return rgbToHex([+rgb[1], +rgb[2], +rgb[3]]);
  const v = d.match(VAR_RE);
  if (v) {
    const raw = rawTokenOf(theme, v[1]);
    return OPAQUE_TOKEN.test(raw) ? tokenOf(theme, v[1]) : tokenOver(theme, v[1], under);
  }
  const m = d.match(MIX_RE);
  if (m) {
    for (const name of [m[1], m[3]]) {
      const raw = rawTokenOf(theme, name);
      if (!OPAQUE_TOKEN.test(raw)) throw new Error(`--${name}(${theme})가 불투명이 아니다: ${raw}`);
    }
    return mixSrgb(tokenOf(theme, m[1]), tokenOf(theme, m[3]), Number(m[2]));
  }
  throw new Error(`해석 못 하는 background 선언: ${decl}`);
}

/** 조상→요소 체인에서 실제 부모색을 만든다. 아래(base)부터 위로 합성한다. */
function resolveParentHex(theme, rules, chain, base) {
  const decls = chain.map((s) => winningDecl(rules, 'background', s.classes, s.pseudos || []));
  let cur = base(theme);
  for (const d of decls) if (d) cur = resolveBgToHex(theme, d.decl, cur);
  return cur;
}

// ── 호출부 × 상태 원장 ──────────────────────────────────────────────────────
// `call`은 호출부 소스에 **문자 그대로** 있어야 하는 문자열이고, `opts`는 그 호출의 인자다.
// `chain`은 조상→요소 순서의 상태(클래스 + 활성 pseudo)이고, 부모색은 그 체인에 대해
// **컴파일 CSS가 이기는 background**를 풀어서 얻는다 — 여기에 hex 상수는 없다.
//
// variant = 그 상태에서 CSS가 고르는 변수쌍.
//   'base'   → --et-bg / --et-fg               (다크 --et-bg-dark / --et-fg-dark)
//   'raised' → --et-bg-raised / --et-fg-raised (다크 --et-bg-raised-dark / --et-fg-raised-dark)
//
// ⚠️ 행 상태 3종은 **전부 명시도 (0,2,0)로 동률**이다:
//      `.TaskListRow:hover` · `.TaskListRow--selected:hover` · `.TaskListRow--context:hover`
//    (클래스 1 + pseudo-class 1). 동률이므로 **선언 순서**가 승자를 정한다 —
//    `--selected:hover`가 `:hover`보다 뒤에 있어 선택 배경이 hover를 이긴다.
//    ⛔ 예전 주석의 `(0,3,0)`은 틀렸다. `--context:hover`에 background를 다시 넣으면
//       그게 가장 뒤라 **선택 표시가 hover 중에 사라진다**(이번 correction의 RED).
const ROW = 'TaskListRow';
const rowState = (extra, pseudos = []) => ({ classes: [ROW, ...extra], pseudos });
// 행이 자기 배경을 안 칠하면 목록 표면이 그대로 보인다. --color-surface로 잡는 것은
// 보수적 선택이다(라이트에서 --color-bg보다 어두워 최악을 덮는다).
const listBase = (t) => tokenOf(t, 'color-surface');

const CALL_SITES = [
  {
    name: 'TaskListRow__Label (태스크 목록 라벨)',
    file: 'components/Branch/Tasks/TaskListRow.js',
    call: "entityTintStyle(label.color, { alpha: '20', raisedSurface: 'task-list-raised' })",
    opts: { alpha: '20', raisedSurface: 'task-list-raised' },
    scss: 'components/branch/taskList.scss',
    base: listBase,
    states: [
      ['normal', [rowState([])], 'base'],
      ['hover', [rowState([], ['hover'])], 'base'],
      ['selected', [rowState(['TaskListRow--selected'])], 'raised'],
      ['selected:hover', [rowState(['TaskListRow--selected'], ['hover'])], 'raised'],
      // ⚠️ --subtask가 --selected보다 뒤에 선언돼 **선택된 하위행도 raised 배경**이다.
      ['subtask', [rowState(['TaskListRow--subtask'])], 'raised'],
      ['subtask:selected', [rowState(['TaskListRow--selected', 'TaskListRow--subtask'])], 'raised'],
      // ⚠️ `:hover`(0,2,0)가 `--subtask`(0,1,0)를 이겨 하위행 hover 배경은 목록 표면이다.
      ['subtask:hover', [rowState(['TaskListRow--subtask'], ['hover'])], 'raised'],
      ['subtask:selected:hover', [rowState(['TaskListRow--selected', 'TaskListRow--subtask'], ['hover'])], 'raised'],
      // 필터 맥락 행. --context는 배경을 칠하지 않으므로 아래 조합이 일반 행과 같아야 한다.
      ['context', [rowState(['TaskListRow--context'])], 'base'],
      ['context:hover', [rowState(['TaskListRow--context'], ['hover'])], 'base'],
      // ⛔ 이번 correction의 핵심 반례 — 맥락 행도 클릭하면 선택된다.
      ['context:selected', [rowState(['TaskListRow--context', 'TaskListRow--selected'])], 'raised'],
      ['context:selected:hover', [rowState(['TaskListRow--context', 'TaskListRow--selected'], ['hover'])], 'raised'],
      ['context:subtask:selected:hover',
        [rowState(['TaskListRow--context', 'TaskListRow--selected', 'TaskListRow--subtask'], ['hover'])], 'raised'],
    ],
  },
  {
    name: 'TaskSearchPopup__ItemStatus (메신저 태스크 검색)',
    file: 'components/Messenger/TaskSearchPopup.js',
    call: "entityTintStyle(task.status_color, { alpha: '20', surface: 'surface-overlay' })",
    opts: { alpha: '20', surface: 'surface-overlay' },
    scss: 'components/messenger/taskSearchPopup.scss',
    // 팝업 컨테이너가 실제로 칠하므로 항목이 배경을 안 칠하면 그 색이 부모다.
    base: (t) => tokenOf(t, 'color-bg'),
    states: [
      // idle 항목은 자기 배경이 없어 팝업(--color-surface-overlay)이 그대로 보인다.
      ['idle', [{ classes: ['TaskSearchPopup'] }, { classes: ['TaskSearchPopup__Item'] }], 'base'],
      ['hover', [{ classes: ['TaskSearchPopup'] }, { classes: ['TaskSearchPopup__Item'], pseudos: ['hover'] }], 'base'],
      ['active', [{ classes: ['TaskSearchPopup'] }, { classes: ['TaskSearchPopup__Item', 'TaskSearchPopup__Item--active'] }], 'base'],
    ],
  },
];

// TrackHeader는 부모가 **단색 선언이 아니라 세로 그라데이션 구간**이라 위 시뮬레이터가
// 다루는 형태가 아니다. 구간 양 끝을 토큰에서 직접 잡고 아래에서 전 구간을 표본으로 훑는다.
const trackPaper = (t) => tokenOf(t, 'track-paper');
const trackPaperRaised = (t) => tokenOf(t, 'track-paper-raised');
const TRACK_HEADER = {
  name: 'TrackHeader__ParticipatingChip (Track 헤더 참여 칩)',
  file: 'components/Track/TrackHeader.js',
  call: "entityTintStyle(b.color, { from: 8, alpha: '14', surface: 'track-header' })",
  opts: { from: 8, alpha: '14', surface: 'track-header' },
  ends: [['gradient 0%', trackPaper], ['gradient 100%', trackPaperRaised]],
};

const KEYS = {
  base: { light: ['--et-bg', '--et-fg'], dark: ['--et-bg-dark', '--et-fg-dark'] },
  raised: {
    light: ['--et-bg-raised', '--et-fg-raised'],
    dark: ['--et-bg-raised-dark', '--et-fg-raised-dark'],
  },
};

// 한 상태의 미달 목록. 부모 hex를 인자로 받아 변이 검증에도 그대로 쓴다.
function badgeFailures(parent, opts, variant, theme) {
  const [bgKey] = KEYS[variant][theme];
  const bad = [];
  for (const c of CORPUS) {
    const v = entityTintStyle(c, opts)[bgKey];
    const r = contrastRatio(v, parent);
    if (r === null || r < BADGE_MIN) bad.push(`${c}→${v} (${r === null ? '변수없음' : r.toFixed(4)})`);
  }
  return bad;
}

// ① 호출부 결속 ─────────────────────────────────────────────────────────────
describe('호출부 소스가 이 옵션을 실제로 넘긴다', () => {
  it.each([...CALL_SITES, TRACK_HEADER].map((s) => [s.name, s]))('%s', (_n, site) => {
    expect(srcOf(site.file), `${site.file}에 이 호출이 없다`).toContain(site.call);
  });
});

// ①-b 제품 호출 18곳 exact 원장 (AST) ───────────────────────────────────────
// ⛔ 문자열/정규식 스캐너를 쓰지 마라 — 주석·문자열 리터럴에 같은 텍스트가 있으면 호출로 오인한다.
//    acorn(+acorn-jsx)으로 파싱해 **import 바인딩을 호출하는 CallExpression만** 센다.
const JsxParser = Parser.extend(jsx());
const PRODUCT_ROOTS = ['components', 'library', 'pages'];
const SKIP_DIRS = new Set(['node_modules', '.next', '__fixtures__']);

function walkAst(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walkAst(n, fn); return; }
  if (typeof node.type === 'string') fn(node);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end') continue;
    walkAst(node[k], fn);
  }
}

/** 이 소스에서 `entityTintStyle` **호출**만 뽑는다(로컬 별칭까지 추적). */
function callsInSource(src) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const bindings = new Set();
  walkAst(ast, (n) => {
    if (n.type !== 'ImportDeclaration') return;
    for (const s of n.specifiers) {
      if (s.type === 'ImportSpecifier' && s.imported.name === 'entityTintStyle') bindings.add(s.local.name);
    }
  });
  if (!bindings.size) return [];
  const out = [];
  walkAst(ast, (n) => {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && bindings.has(n.callee.name)) {
      out.push({ line: n.loc.start.line, text: src.slice(n.start, n.end).replace(/\s+/g, ' ') });
    }
  });
  return out;
}

function walkJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkJs(full, out);
    else if (/\.jsx?$/.test(name) && !/\.test\.js$/.test(name)) out.push(full);
  }
  return out;
}

const inventoryOf = (files) =>
  files.flatMap(([rel, src]) => callsInSource(src).map((c) => `${rel}\t${c.text}`));

const bagOf = (a) => a.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map());
function diffInventory(actual, expected) {
  const A = bagOf(actual);
  const E = bagOf(expected);
  return {
    missing: [...E].filter(([k, n]) => (A.get(k) || 0) < n).map(([k]) => k),
    extra: [...A].filter(([k, n]) => (E.get(k) || 0) < n).map(([k]) => k),
  };
}

// ⛔ 이 표를 코드에 맞춰 늘리지 마라. 호출을 하나 더 만들었다면 그 배지의 **부모가 무엇인지**
//    먼저 정하고 위 CALL_SITES 상태표에 올린 뒤 여기에 적는다.
const EXPECTED_CALLS = [
  ["components/Branch/Archive/ArchiveList.js", "entityTintStyle(label.color, { alpha: '20' })"],
  ["components/Branch/Board/BoardCard.js", "entityTintStyle(label.color, { alpha: '20' })"],
  ["components/Branch/TaskFilterBar.js", "entityTintStyle(chip.color, { from: 8, alpha: '15' })"],
  ["components/Branch/Tasks/TaskListRow.js", "entityTintStyle(label.color, { alpha: '20', raisedSurface: 'task-list-raised' })"],
  ["components/Canvas/extensions/TaskRefExtension.js", "entityTintStyle(node.attrs.statusColor, { alpha: '20', surface: 'task-ref' })"],
  ["components/Canvas/extensions/TaskRefPopup.js", "entityTintStyle(task.status_color, { alpha: '20' })"],
  ["components/Messenger/TaskRefCard.js", "entityTintStyle(taskRef.status_color, { alpha: '20' })"],
  ["components/Messenger/TaskSearchPopup.js", "entityTintStyle(task.status_color, { alpha: '20', surface: 'surface-overlay' })"],
  ["components/MyTasks/MyTasksView.js", "entityTintStyle(label.color, { alpha: '20' })"],
  ["components/MyTasks/MyTasksView.js", "entityTintStyle(task.status_color, { alpha: '20' })"],
  ["components/Track/Detail/TrackItemDetail.js", "entityTintStyle(branch.color, { from: 8, alpha: '14', surface: 'track-card' })"],
  ["components/Track/Detail/TrackItemDetail.js", "entityTintStyle(ws.color, { from: 8, alpha: '14', surface: 'track-card' })"],
  ["components/Track/Flow/CrossBranchTaskNode.js", "entityTintStyle(branchColor, { from: 8, alpha: '14', surface: 'track-card' })"],
  ["components/Track/TrackHeader.js", "entityTintStyle(b.color, { from: 8, alpha: '14', surface: 'track-header' })"],
  ["components/Track/Tree/TrackTree.js", "entityTintStyle(ws.color, { from: 8, alpha: '14', surface: 'track-card' })"],
  // ⚠️ 라벨 입력 칩. 종전 원장이 이 호출을 빠뜨려 16으로 셌다.
  ["components/common/LabelTagInput.js", "entityTintStyle(label.color, { alpha: '20' })"],
  // 라벨 편집창 미리보기 칩. 부모 = 미리보기 타일이고 그 바탕을 default 프로파일 값(양 테마 --color-surface)으로
  // 칠하므로 default 그대로다. 테마별 산출값을 인라인으로 직접 고르고 EntityTint 클래스는 붙이지 않는다.
  ["components/common/LabelEditPopover.js", "entityTintStyle(color, { alpha: '20' })"],
  ["library/refHydration.js", "entityTintStyle(color, { alpha: '20', surface: 'task-ref' })"],
].map(([f, c]) => `${f}\t${c}`);

describe('entityTintStyle 제품 호출 원장 — 18곳/16파일 exact (AST)', () => {
  const realFiles = PRODUCT_ROOTS
    .flatMap((r) => walkJs(resolve(frontendDir, r)))
    .filter((f) => f !== resolve(frontendDir, 'library/entityTint.js'))
    .map((f) => [relative(frontendDir, f), readFileSync(f, 'utf8')]);
  const actual = inventoryOf(realFiles);

  it('호출 18곳 · 파일 16개다', () => {
    expect(EXPECTED_CALLS).toHaveLength(18);
    expect(actual, `실제 호출:\n${actual.join('\n')}`).toHaveLength(18);
    expect(new Set(actual.map((k) => k.split('\t')[0])).size).toBe(16);
  });

  it('누락 0 · 잉여 0 — (파일, 호출문) multiset이 exact다', () => {
    expect(diffInventory(actual, EXPECTED_CALLS)).toEqual({ missing: [], extra: [] });
  });

  const mutate = (rel, from, to) => realFiles.map(([r, s]) => [r, r === rel ? s.replace(from, to) : s]);
  const LTI = 'components/common/LabelTagInput.js';
  const LTI_CALL = "entityTintStyle(label.color, { alpha: '20' })";

  // ⛔ 이 케이스가 문자열 스캐너와 AST를 가르는 지점이다 — 호출은 사라졌는데 같은 문자열은 남는다.
  it('변이 — 호출을 지우고 같은 문자열을 상수로 남기면 RED (문자열 스캐너는 통과한다)', () => {
    const mutated = mutate(LTI, `const chipTint = ${LTI_CALL};`,
      `const chipTint = null; const note = ${JSON.stringify(LTI_CALL)};`);
    expect(mutated.find(([r]) => r === LTI)[1], '변이가 적용되지 않았다').toContain('const note =');
    const d = diffInventory(inventoryOf(mutated), EXPECTED_CALLS);
    expect(d.missing).toEqual([`${LTI}\t${LTI_CALL}`]);
    expect(d.extra).toEqual([]);
  });

  it('변이 — 호출이 1곳 늘면 extra로 RED', () => {
    const synthetic = [...realFiles, ['components/__synthetic__.js',
      `import { entityTintStyle } from '@/library/entityTint';\nconst t = entityTintStyle(x.color, { alpha: '20' });\n`]];
    const d = diffInventory(inventoryOf(synthetic), EXPECTED_CALLS);
    expect(d.extra).toEqual(["components/__synthetic__.js\tentityTintStyle(x.color, { alpha: '20' })"]);
    expect(d.missing).toEqual([]);
  });

  it('변이 — 옵션만 바뀌어도 RED', () => {
    const d = diffInventory(inventoryOf(mutate('library/refHydration.js',
      "{ alpha: '20', surface: 'task-ref' }", "{ alpha: '20' }")), EXPECTED_CALLS);
    expect(d.missing).toEqual(["library/refHydration.js\tentityTintStyle(color, { alpha: '20', surface: 'task-ref' })"]);
    expect(d.extra).toEqual(["library/refHydration.js\tentityTintStyle(color, { alpha: '20' })"]);
  });

  it('주석·문자열·import는 호출로 세지 않고, 로컬 별칭 호출은 센다', () => {
    const noise = `import { entityTintStyle as tint } from '@/library/entityTint';
// entityTintStyle(fake.color, { alpha: '20' })
const s = "entityTintStyle(fake.color, { alpha: '20' })";
const real = tint(a.color, { alpha: '20' });\n`;
    expect(inventoryOf([['components/__synthetic__.js', noise]]))
      .toEqual(["components/__synthetic__.js\ttint(a.color, { alpha: '20' })"]);
  });
});

// ② 상태별 이기는 배경 = 부모 ───────────────────────────────────────────────
describe('행/항목 상태의 부모는 컴파일 CSS가 이기는 background다', () => {
  for (const site of CALL_SITES) {
    const rules = rulesOf(compileScss(site.scss));
    for (const [state, chain, variant] of site.states) {
      for (const theme of ['light', 'dark']) {
        it(`${site.name} · ${state} · ${theme}`, () => {
          const parent = resolveParentHex(theme, rules, chain, site.base);
          expect(parent, `${state} 부모를 못 풀었다`).toMatch(/^#[0-9A-F]{6}$/);
          const bad = badgeFailures(parent, site.opts, variant, theme);
          expect(bad, `부모 ${parent} 위 미달 ${bad.length}/${CORPUS.length}: ${bad.slice(0, 4).join(', ')}`)
            .toEqual([]);
        });
      }
    }
  }
});

describe('글자가 자기 배경에서 TEXT_MIN을 만족한다', () => {
  for (const site of [...CALL_SITES, TRACK_HEADER]) {
    const variants = site.states ? [...new Set(site.states.map(([, , v]) => v))] : ['base'];
    for (const variant of variants) {
      for (const theme of ['light', 'dark']) {
        it(`${site.name} · ${variant} · ${theme}`, () => {
          const [bgKey, fgKey] = KEYS[variant][theme];
          const bad = [];
          for (const c of CORPUS) {
            const s = entityTintStyle(c, site.opts);
            const r = contrastRatio(s[fgKey], s[bgKey]);
            if (r === null || r < TEXT_MIN) bad.push(`${c} (${r === null ? '변수없음' : r.toFixed(4)})`);
          }
          expect(bad, `TEXT_MIN 미달 ${bad.length}/${CORPUS.length}`).toEqual([]);
        });
      }
    }
  }
});

// 검출력 — 부모를 실패값으로 바꾸면 반드시 RED다(계약이 부모에 실제로 매여 있음을 보인다).
describe('부모 변조는 RED다', () => {
  const FAIL_PARENT = '#333437';
  it.each([
    ['TaskSearch idle (surface-overlay)', { alpha: '20', surface: 'surface-overlay' }, 'base'],
    ['TaskList subtask (task-list-raised)', { alpha: '20', raisedSurface: 'task-list-raised' }, 'raised'],
  ])('%s 부모를 #333437로 바꾸면 미달이 생긴다', (_n, opts, variant) => {
    const bad = ['light', 'dark'].flatMap((t) => badgeFailures(FAIL_PARENT, opts, variant, t));
    expect(bad.length, `#333437에서도 전건 통과하면 계약이 부모에 안 매여 있다`).toBeGreaterThan(0);
  });
});

// 명시도 사실 자체를 고정한다 — 이번 회귀의 원인이 여기였다.
describe('행 상태 선택자의 명시도·순서 계약', () => {
  const rules = rulesOf(compileScss('components/branch/taskList.scss'));
  const find = (part) => rules.find((r) => selParts(r.sel).includes(part) && hasDecl(r.body, 'background'));

  it('`:hover`와 `--selected:hover`는 둘 다 (0,2,0)이고, 선택 규칙이 뒤에 와서 이긴다', () => {
    expect(specOne('.TaskListRow:hover')).toEqual([0, 2, 0]);
    expect(specOne('.TaskListRow--selected:hover')).toEqual([0, 2, 0]);
    const h = find('.TaskListRow:hover');
    const s = find('.TaskListRow--selected:hover');
    expect(h && s, '두 규칙을 모두 찾아야 한다').toBeTruthy();
    expect(s.i, '--selected:hover가 :hover보다 뒤에 선언돼야 한다').toBeGreaterThan(h.i);
  });

  // ⛔ 이번 correction의 반례. --context:hover가 background를 가지면 (0,2,0) 동률에
  //    **가장 뒤**라 선택 배경을 덮어 선택 표시가 hover 중에 사라진다.
  it('--context:hover는 background를 선언하지 않는다', () => {
    const ctx = find('.TaskListRow--context:hover');
    expect(ctx, `.TaskListRow--context:hover가 background를 선언한다(${ctx && ctx.decl})`
      + ' — 비선택 hover는 .TaskListRow:hover가 이미 같은 표면을 준다').toBeUndefined();
  });

  it('선택된 맥락 행은 hover 중에도 선택 배경을 유지한다', () => {
    for (const pseudos of [[], ['hover']]) {
      const w = winningDecl(rules, 'background',
        [ROW, 'TaskListRow--context', 'TaskListRow--selected'], pseudos);
      expect(w && w.decl, `context+selected${pseudos.length ? ':hover' : ''} 승자`)
        .toBe('var(--color-primary-subtle)');
    }
  });
});

// 그라데이션은 끝점만이 아니라 **전 구간**이 안전해야 한다.
describe('TrackHeader 그라데이션 — 구간 전체에서 BADGE_MIN이 선다', () => {
  const lerp = (a, b, t) => {
    const A = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const B = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return rgbToHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t));
  };
  it.each(['light', 'dark'])('%s — 0%%~100%% 21개 표본 전건', (theme) => {
    const [from, to] = TRACK_HEADER.ends.map(([, f]) => f(theme));
    const bad = [];
    for (let i = 0; i <= 20; i++) {
      const parent = lerp(from, to, i / 20);
      if (badgeFailures(parent, TRACK_HEADER.opts, 'base', theme).length) bad.push(`${i * 5}%`);
    }
    expect(bad, `그라데이션 미달 구간: ${bad.join(', ')}`).toEqual([]);
  });
});

// raisedSurface를 안 준 호출부는 raised 변수를 **내지 않는다**.
describe('raised 축은 요청한 호출부에만 실린다', () => {
  it('raisedSurface 생략 시 --et-*-raised가 아예 없다', () => {
    expect(Object.keys(entityTintStyle('#16A34A', { alpha: '20' })).filter((k) => k.includes('raised'))).toEqual([]);
  });
  it('raisedSurface를 주면 네 변수가 모두 붙는다', () => {
    const s = entityTintStyle('#16A34A', { alpha: '20', raisedSurface: 'task-list-raised' });
    expect(Object.keys(s).filter((k) => k.includes('raised')).sort())
      .toEqual(['--et-bg-raised', '--et-bg-raised-dark', '--et-fg-raised', '--et-fg-raised-dark']);
  });
  it('blank·passthrough는 raisedSurface를 줘도 --et-*가 하나도 없다', () => {
    expect(entityTintStyle('', { raisedSurface: 'task-list-raised' })).toBeUndefined();
    expect(entityTintStyle('   ', { raisedSurface: 'task-list-raised' })).toBeUndefined();
    expect(Object.keys(entityTintStyle('#1a6f', { alpha: '20', raisedSurface: 'task-list-raised' })).sort())
      .toEqual(['background', 'color']);
  });
  it('모르는 raisedSurface 이름은 조용히 접히지 않고 던진다', () => {
    expect(() => entityTintStyle('#16A34A', { raisedSurface: 'nope' })).toThrow(/unknown entity surface profile/);
    expect(() => entityTintStyle('', { raisedSurface: 'nope' })).toThrow();
    expect(() => entityTintStyle('#1a6f', { raisedSurface: 'nope' })).toThrow();
  });
});

// ③ 상태별 변수쌍을 고르는 주체는 SCSS다 ────────────────────────────────────
describe('storedColor.scss — raised 행 규칙이 기본 규칙을 이긴다', () => {
  const rules = rulesOf(compileScss('components/common/storedColor.scss'));
  const LIGHT_RAISED = ['.TaskListRow--selected .EntityTint', '.TaskListRow--subtask .EntityTint'];
  const DARK_RAISED = LIGHT_RAISED.map((s) => `html[data-theme=dark] ${s}`);
  const DARK_BASE = 'html[data-theme=dark] .EntityTint';
  const ruleWithPart = (part) => rules.filter((r) => selParts(r.sel).includes(part));

  it.each([...LIGHT_RAISED, ...DARK_RAISED, DARK_BASE])('선택자 %s가 컴파일 산출에 정확히 있다', (part) => {
    expect(ruleWithPart(part).length, '정확 일치 규칙 없음 (접미 변이는 여기서 걸린다)').toBeGreaterThan(0);
  });

  it('raised 규칙은 --et-*-raised를 쓰고 폴백이 있다', () => {
    for (const part of [...LIGHT_RAISED, ...DARK_RAISED]) {
      for (const r of ruleWithPart(part)) {
        expect(r.body, `${part} 배경`).toMatch(/var\(--et-bg-raised(-dark)?,\s*var\(--et-bg(-dark)?\)\)/);
        expect(r.body, `${part} 글자`).toMatch(/var\(--et-fg-raised(-dark)?,\s*var\(--et-fg(-dark)?\)\)/);
        expect((r.body.match(/!important/g) || []).length, `${part} !important 2건`).toBe(2);
      }
    }
  });

  it('다크 raised 규칙이 다크 기본 .EntityTint 규칙을 이긴다', () => {
    const base = ruleWithPart(DARK_BASE)[0];
    const raised = ruleWithPart(DARK_RAISED[0])[0];
    const c = cmpSpec(specOne(DARK_RAISED[0]), specOne(DARK_BASE));
    expect(c > 0 || (c === 0 && raised.i > base.i)).toBe(true);
  });

  it('라이트 raised 규칙은 인라인 background:var(--et-bg)를 !important로 이긴다', () => {
    const light = ruleWithPart(LIGHT_RAISED[0])[0];
    expect(light.body).toMatch(/background:[^;]*!important/);
    expect(light.body).toMatch(/color:[^;]*!important/);
  });

  it.each([['.TaskListRow--selectedX'], ['.TaskListRow--subtask2']])('접미 변이 %s는 정확 일치에서 걸린다', (mutant) => {
    expect(selParts(`${mutant} .EntityTint`).some((p) => LIGHT_RAISED.includes(p))).toBe(false);
  });
});

// ④-1 필터 맥락 행 — 핵심 요소는 자기도 조상도 흐려지지 않는다 ──────────────
// `opacity`는 **자손 전체**를 배경과 합성한다. 그래서 핵심 요소 자신뿐 아니라 그 **조상**에
// opacity가 붙어도 계약이 무너진다(예: `__TitleWrap`은 `__Title`·`__ContextTag`의 조상).
// ⛔ 그래서 blacklist가 아니라 **허용 목록 exact**로 잠근다 — 조상 관계를 따로 모델링하지
//    않아도, 목록에 없는 선택자가 흐림을 받는 순간 RED다.
const CONTEXT_ROW = '.TaskListRow--context';
const CONTEXT_MUTED_ALLOWED = [
  '.TaskListRow__TypeIcon',
  '.TaskListRow__Id',
  '.TaskListRow__Badge',
  '.TaskListRow__Issues',
  '.TaskListRow__Progress',
  '.TaskListRow__Cell',
  '.TaskListRow__AssigneeWrap',
];
// 이 요소들은 자기도 조상도 흐려지면 안 된다(제목·저장색 배지·맥락 태그).
const CONTEXT_CORE = ['.TaskListRow__Title', '.TaskListRow__ContextTag', '.TaskListRow__Labels',
  '.TaskListRow__Label', '.EntityTint'];
// 핵심 요소의 조상(제품 JSX 구조). 아래 「조상 결속」이 소스와 대조해 stale를 막는다.
const CONTEXT_CORE_ANCESTORS = ['.TaskListRow__TitleWrap'];

/** --context 아래에서 opacity를 받는 (조상 접두, 대상) 쌍을 모은다. */
function contextOpacityTargets(css) {
  const out = [];
  for (const r of rulesOf(css)) {
    if (!hasDecl(r.body, 'opacity')) continue;
    for (const part of selParts(r.sel)) {
      const m = part.match(/^\.TaskListRow--context(:[a-z-]+)?(?:\s+(.+))?$/);
      if (!m) continue;
      out.push({ target: m[2] ? m[2].trim() : '(행 자신)', value: declOf(r.body, 'opacity') });
    }
  }
  return out;
}

describe('TaskListRow--context — 핵심 요소는 자기도 조상도 흐려지지 않는다', () => {
  const css = compileScss('components/branch/taskList.scss');
  const targets = contextOpacityTargets(css);

  it('흐림 대상이 허용 목록과 exact다 (행 자신·핵심·핵심의 조상은 들어올 수 없다)', () => {
    expect([...new Set(targets.map((t) => t.target))].sort()).toEqual([...CONTEXT_MUTED_ALLOWED].sort());
  });

  it('허용 목록에 핵심 요소도 그 조상도 없다', () => {
    for (const bad of [...CONTEXT_CORE, ...CONTEXT_CORE_ANCESTORS]) {
      expect(CONTEXT_MUTED_ALLOWED, `${bad}은 흐림 대상이 될 수 없다`).not.toContain(bad);
    }
  });

  it('맥락 신호는 실제로 걸려 있다 — idle과 hover 두 단계', () => {
    expect(new Set(targets.map((t) => t.value)).size, '흐림 단계가 2종이어야 한다').toBe(2);
  });

  it('맥락 행도 클릭·선택이 살아 있다 — pointer-events/display를 죽이지 않는다', () => {
    for (const r of rulesOf(css)) {
      for (const part of selParts(r.sel)) {
        if (!part.startsWith(CONTEXT_ROW)) continue;
        expect(declOf(r.body, 'pointer-events'), part).not.toBe('none');
        expect(declOf(r.body, 'display'), part).not.toBe('none');
      }
    }
  });

  // 조상 목록이 stale이면 위 계약이 헐거워진다 — 제품 JSX와 대조해 고정한다.
  it('조상 결속 — __TitleWrap이 __Title·__ContextTag를 감싼다', () => {
    const src = srcOf('components/Branch/Tasks/TaskListRow.js');
    const wrap = src.indexOf('TaskListRow__TitleWrap');
    expect(wrap, '__TitleWrap을 못 찾았다').toBeGreaterThan(0);
    const after = src.slice(wrap);
    const close = after.indexOf('TaskListRow__Labels');
    expect(after.slice(0, close)).toContain('TaskListRow__Title');
    expect(after.slice(0, close)).toContain('TaskListRow__ContextTag');
  });

  // 검출력 — 행 자신 · 핵심 · 핵심의 조상 어디에 흐림이 붙어도 RED다.
  const BASE = `
.TaskListRow {
  &--context {
    .TaskListRow__TypeIcon, .TaskListRow__Id, .TaskListRow__Badge, .TaskListRow__Issues,
    .TaskListRow__Progress, .TaskListRow__Cell, .TaskListRow__AssigneeWrap { opacity: 0.55; }
    &:hover {
      .TaskListRow__TypeIcon, .TaskListRow__Id, .TaskListRow__Badge, .TaskListRow__Issues,
      .TaskListRow__Progress, .TaskListRow__Cell, .TaskListRow__AssigneeWrap { opacity: 0.78; }
    }
  }
}`;
  const targetsOf = (scss) => [...new Set(contextOpacityTargets(compileString(scss).css).map((t) => t.target))].sort();
  it.each([
    ['정상(변이 없음)', BASE, true],
    ['행 자신 opacity 복귀', BASE.replace('&--context {', '&--context { opacity: 0.5;'), false],
    ['핵심(__Title)에 직접 흐림', BASE.replace('.TaskListRow__TypeIcon,', '.TaskListRow__Title, .TaskListRow__TypeIcon,'), false],
    ['핵심의 조상(__TitleWrap)에 흐림', BASE.replace('.TaskListRow__TypeIcon,', '.TaskListRow__TitleWrap, .TaskListRow__TypeIcon,'), false],
    ['저장색 배지(.EntityTint)에 흐림', BASE.replace('.TaskListRow__TypeIcon,', '.EntityTint, .TaskListRow__TypeIcon,'), false],
    ['맥락 태그(__ContextTag)에 흐림', BASE.replace('.TaskListRow__TypeIcon,', '.TaskListRow__ContextTag, .TaskListRow__TypeIcon,'), false],
  ])('변이 %s', (_n, scss, shouldPass) => {
    const ok = JSON.stringify(targetsOf(scss)) === JSON.stringify([...CONTEXT_MUTED_ALLOWED].sort());
    expect(ok).toBe(shouldPass);
  });
});

// ④-2 표 셀 안 Task ref — 칩 표면을 불투명으로 굳혀 셀 색을 차단한다 ─────────
// 표 셀은 임의 배경(팔레트 8색 · selectedCell)을 가질 수 있는데 `.task-ref`의 기본 배경은
// **반투명** --color-primary-subtle이라 셀 색과 합성된다. 그러면 칩 **안쪽** 배지의 부모가
// 셀 색에 좌우돼 `task-ref` 프로파일이 가정한 부모와 어긋난다
// (수정 전 실측: pink 셀 위 상태 배지 라이트 1.0026 · 다크 1.0030, 전건 538건 미달).
// ⛔ 셀색마다 프로파일을 추가하지 마라. ⛔ `.doc-ref`·`.issue-ref`로 넓히지 마라.
const TABLE_CHIP = [
  {
    name: 'Canvas 편집기 (라이브 TipTap)',
    file: 'components/canvas/canvasEditor.scss',
    cell: ['.CanvasEditor__Content .tiptap table th .task-ref', '.CanvasEditor__Content .tiptap table td .task-ref'],
    base: '.CanvasEditor__Content .tiptap .task-ref',
  },
  {
    name: 'Canvas 읽기 표면',
    file: 'components/canvas/canvasPageView.scss',
    cell: ['.CanvasPageView__Content table th .task-ref', '.CanvasPageView__Content table td .task-ref'],
    base: '.CanvasPageView__Content .task-ref',
  },
  {
    // ⚠️ 개요도 읽기 표면이다 — CanvasOverview.js가 `.task-ref`를 붙이고 applyFallbackBadges로
    //    **같은 task-ref 프로파일** 배지를 심는다(:97-98, :140).
    name: 'Canvas 개요 (읽기)',
    file: 'components/canvas/canvasOverview.scss',
    cell: ['.CanvasOverview__OverviewContent table th .task-ref', '.CanvasOverview__OverviewContent table td .task-ref'],
    base: '.CanvasOverview__OverviewContent .task-ref',
  },
  {
    // 문서 미리보기는 캔버스 본문(색칠된 표 셀 포함)을 그대로 보이고 이슈 미리보기와 같은 본문 규칙을 쓴다 —
    // useRefHydration(refHydration.setBadge)이 같은 task-ref 프로파일 배지를 심는다
    name: 'Ref 미리보기 (문서·이슈)',
    file: 'components/canvas/refPreviewPanel.scss',
    cell: ['.RefPreviewPanel__HtmlContent table th .task-ref', '.RefPreviewPanel__HtmlContent table td .task-ref'],
    base: '.RefPreviewPanel__HtmlContent .task-ref',
  },
];

// `.task-ref`에 배경을 주는 표면 원장. **닫혀 있다는 것 자체가 계약**이다.
//   cellColorCapable — Canvas 본문 3종과 그 본문을 그대로 보이는 문서 미리보기(refPreviewPanel). 셀 배경색은 Canvas 전용
//     기능이다(툴바가 `hasExtension('table')`로 게이트되고 Table 확장을 싣는 에디터는 Canvas뿐).
//   noTables — 스크럼·댓글·태스크 설명/이슈. Table 확장을 안 실어 표 자체가 없다.
const CHIP_BG_SURFACES = {
  cellColorCapable: ['canvasEditor', 'canvasOverview', 'canvasPageView', 'refPreviewPanel'],
  noTables: ['scrum', 'taskComment', 'taskDetailPanel'],
};
const ALL_CHIP_BG = [...CHIP_BG_SURFACES.cellColorCapable, ...CHIP_BG_SURFACES.noTables].sort();

const CELL_BGS = TIPTAP_COLOR_MAP.filter((m) => m.kind === 'cell');
const TASK_REF_OPTS = { alpha: '20', surface: 'task-ref' };
// 대비만으로는 부모 토큰 변조를 못 잡는다 — 원색 primary를 부모로 써도 배지가 near-white라
// BADGE_MIN은 통과한다. 진짜 계약은 "부모가 `task-ref` 프로파일이 **덮는 범위 안**"이다.
const TASK_REF_PROFILE = ENTITY_SURFACE_PROFILES['task-ref'];
const withinProfile = (theme, parent) => (theme === 'light'
  ? relativeLuminance(parent) >= relativeLuminance(TASK_REF_PROFILE.light)
  : relativeLuminance(parent) <= relativeLuminance(TASK_REF_PROFILE.dark));

describe.each(TABLE_CHIP.map((t) => [t.name, t]))('표 셀 안 Task ref — %s', (_n, surf) => {
  const rules = rulesOf(compileScss(surf.file));
  const cellRule = rules.find((r) => {
    const p = selParts(r.sel);
    return p.length === surf.cell.length && surf.cell.every((x) => p.includes(x)) && hasDecl(r.body, 'background');
  });

  it('th·td 안 .task-ref만 겨냥한 background 규칙이 있다 (doc-ref·issue-ref 불포함)', () => {
    expect(cellRule, `찾는 선택자:\n${surf.cell.join('\n')}`).toBeTruthy();
    expect(selParts(cellRule.sel).sort()).toEqual([...surf.cell].sort());
    expect(cellRule.sel).not.toContain('doc-ref');
    expect(cellRule.sel).not.toContain('issue-ref');
  });

  it('셀 규칙이 기본 .task-ref 규칙을 특이도로 이긴다 — 선언 순서에 기대지 않는다', () => {
    const base = rules.find((r) => selParts(r.sel).includes(surf.base) && hasDecl(r.body, 'background'));
    expect(base, `기본 규칙 ${surf.base}`).toBeTruthy();
    expect(declOf(base.body, 'background'), '기본 칩 배경은 반투명 토큰 그대로여야 한다(표 밖 픽셀 불변)')
      .toBe('var(--color-primary-subtle)');
    for (const part of surf.cell) expect(cmpSpec(specOne(part), specOne(surf.base)), part).toBe(1);
  });

  it.each(['light', 'dark'])('%s — 칩 표면이 셀 색과 무관한 불투명 합성이고 프로파일 범위 안이다', (theme) => {
    const parent = resolveBgToHex(theme, declOf(cellRule.body, 'background'), null);
    expect(parent).toMatch(/^#[0-9A-F]{6}$/);
    expect(withinProfile(theme, parent),
      `부모 ${parent}가 task-ref 프로파일(${TASK_REF_PROFILE[theme]}) 범위 밖이다`).toBe(true);
    for (const m of CELL_BGS) {
      const hex = theme === 'light' ? m.light : m.dark;
      expect(declOf(cellRule.body, 'background')).not.toContain(hex);
      expect(declOf(cellRule.body, 'background')).not.toContain(hex.toLowerCase());
    }
  });

  it.each(['light', 'dark'])('%s — 그 부모 위에서 코퍼스 31색이 BADGE_MIN·TEXT_MIN을 만족한다', (theme) => {
    const parent = resolveBgToHex(theme, declOf(cellRule.body, 'background'), null);
    const [bgKey, fgKey] = KEYS.base[theme];
    const bad = [];
    for (const c of CORPUS) {
      const s = entityTintStyle(c, TASK_REF_OPTS);
      const rb = contrastRatio(s[bgKey], parent);
      const rt = contrastRatio(s[fgKey], s[bgKey]);
      if (rb === null || rb < BADGE_MIN) bad.push(`${c} badge=${rb === null ? 'null' : rb.toFixed(4)}`);
      if (rt === null || rt < TEXT_MIN) bad.push(`${c} text=${rt === null ? 'null' : rt.toFixed(4)}`);
    }
    expect(bad, `부모 ${parent} 위 미달 ${bad.length}: ${bad.slice(0, 4).join(', ')}`).toEqual([]);
  });
});

describe('`.task-ref`에 배경을 주는 표면 원장이 닫혀 있다', () => {
  it('styles/ 전수 스윕 — 원장에 없는 새 표면이 생기면 RED', () => {
    const found = [];
    const walkScss = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walkScss(full); continue; }
        if (!name.endsWith('.scss') || name.startsWith('_')) continue;
        let css;
        try { css = compileScss(relative(stylesDir, full)); } catch { continue; }
        const paints = rulesOf(css).some((r) =>
          selParts(r.sel).some((p) => p.endsWith('.task-ref')) && hasDecl(r.body, 'background'));
        if (paints) found.push(name.replace('.scss', ''));
      }
    };
    walkScss(stylesDir);
    expect([...new Set(found)].sort(),
      '새 표면이 생겼다 — 셀 배경색 표를 렌더할 수 있으면 TABLE_CHIP에, 아니면 noTables에 올려라')
      .toEqual(ALL_CHIP_BG);
  });

  it('셀 배경색이 가능한 표면은 모두 TABLE_CHIP에 올라 있다', () => {
    expect(TABLE_CHIP.map((t) => t.file.split('/').pop().replace('.scss', '')).sort())
      .toEqual([...CHIP_BG_SURFACES.cellColorCapable].sort());
  });

  it('셀 배경 팔레트는 Table 확장이 있을 때만 나오고, 비-Canvas 에디터는 Table을 안 싣는다', () => {
    const toolbar = srcOf('components/Canvas/CanvasEditorToolbar.js');
    const at = toolbar.indexOf("setCellAttribute('backgroundColor'");
    expect(at, '셀 배경 명령을 못 찾았다').toBeGreaterThan(0);
    expect(toolbar.lastIndexOf("hasExtension('table')", at), 'hasExtension(table) 게이트 밖이다').toBeGreaterThan(0);
    expect(srcOf('components/Branch/Tasks/taskDescriptionExtensions.js')).not.toMatch(/extension-table/);
  });
});

describe('표 셀 안 Task ref — 부모 토큰·비율 변조는 RED다', () => {
  const REAL = declOf(
    rulesOf(compileScss(TABLE_CHIP[0].file)).find((r) => {
      const p = selParts(r.sel);
      return p.length === 2 && TABLE_CHIP[0].cell.every((x) => p.includes(x)) && hasDecl(r.body, 'background');
    })?.body ?? '', 'background',
  );
  const failsFor = (decl) => {
    const bad = [];
    for (const theme of ['light', 'dark']) {
      let parent;
      try { parent = resolveBgToHex(theme, decl, null); } catch (e) { bad.push(`${theme}: ${e.message}`); continue; }
      if (!withinProfile(theme, parent)) bad.push(`${theme}: 부모 ${parent}가 프로파일 범위 밖`);
      bad.push(...badgeFailures(parent, TASK_REF_OPTS, 'base', theme).map((x) => `${theme}/${x}`));
    }
    return bad;
  };

  it('정본 식은 미달 0', () => {
    expect(REAL).toBeTruthy();
    expect(failsFor(REAL)).toEqual([]);
  });

  it.each([
    ['비율 변조 8% → 20%', 'color-mix(in srgb, var(--color-primary) 20%, var(--color-surface))'],
    ['부모 토큰 변조 --color-surface → --color-primary', 'color-mix(in srgb, var(--color-primary) 8%, var(--color-primary))'],
    ['반투명 토큰 사용(셀 색이 다시 샌다)', 'color-mix(in srgb, var(--color-primary-subtle) 8%, var(--color-surface))'],
  ])('변이 %s는 RED다', (_n, decl) => {
    expect(failsFor(decl).length).toBeGreaterThan(0);
  });
});
