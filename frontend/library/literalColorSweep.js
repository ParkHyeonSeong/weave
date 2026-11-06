// 색 리터럴 exact hit identity 스윕. 매칭 계약은 계획 index 「exact hit identity 스윕 계약」이 정본이다.
// "리터럴 0건"을 목표로 삼지 않는다 — 고정 표면 위 대비색·스크림·종이 모사·저장색·
// 서드파티 색은 리터럴이 정답이고, 그런 색은 전부 colorExceptions.js에 등록된다.
//
// named color는 **값 위치가 구조적으로 확정된 다섯 자리에서만** 본다: postcss decl 값 /
// SVG·HTML 색 속성 / HTML의 style="…" 속성 / JSX의 style={{…}} 객체.
// 자유 텍스트에서 보면 tan·plum·gold가 대량 오탐이 되므로 거기서는 hex·rgb만 본다.
// 그 자리 안에서도 **색을 받을 수 있는 property일 때만** 본다(propTakesColor) — 아니면
// content의 문자열이나 animation-name의 이름이 색으로 오인된다. hex·rgb는 property 무관이다.
//
// ⚠️ **어휘적(lexical) 매치이지 의미적(semantic) 보장이 아니다.** 문자열로 조립한 색
// ('#' + hex), 계산된 색, style={외부변수}는 named color를 놓친다. 주장 범위의 한계다.
//
// ⚠️ **테스트 전용 모듈이다.** jsdom·sass·acorn을 import하므로 제품 코드에서 import하면
// 앱 번들에 새어 들어간다. literalColorSweep.test.js가 금지 단정으로 막는다.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileString } from 'sass';
import postcss from 'postcss';
import { JSDOM } from 'jsdom';
import { Parser as AcornParser } from 'acorn';   // devDep ^8.18.0 — 추가 설치 없음
import acornJsx from 'acorn-jsx';                // devDep ^5.3.2 — 추가 설치 없음
import { COLOR_EXCEPTIONS, THIRD_PARTY_OWNED, PRIOR_SLICE_DEFERRED } from './colorExceptions.js';
import { COLOR_CLASSIFIED } from './colorClassified.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── 리터럴 형태 ───────────────────────────────────────────────────────────────
// hex는 8→6→3 순서여야 가장 긴 것이 이긴다. 경계는 \b가 아니라 (?![0-9a-fA-F])다 —
// rg의 \b는 유니코드 인식이라 hex 뒤에 한글이 오면 놓친다. rgb(var(--x))는 첫 인자가
// 숫자가 아니라 자연히 제외된다.
// ⚠️ %23도 '#'와 **정확히 같은 경계 규칙**을 쓴다. %23은 색 전용 접두가 아니어서
//    (실측 9건 중 색은 1건, 6건이 %23n = SVG filter id 참조로 스윕 대상 파일에 실재),
//    '%23[0-9a-fA-F]{3,8}' 같은 경계 없는 수량자를 쓰면 존재하지 않는 색이 over로 뜬다.
const LITERAL_SOURCE = [
  '#[0-9a-fA-F]{8}(?![0-9a-fA-F])',
  '#[0-9a-fA-F]{6}(?![0-9a-fA-F])',
  '#[0-9a-fA-F]{3}(?![0-9a-fA-F])',
  '%23[0-9a-fA-F]{8}(?![0-9a-fA-F])',
  '%23[0-9a-fA-F]{6}(?![0-9a-fA-F])',
  '%23[0-9a-fA-F]{3}(?![0-9a-fA-F])',
  '\\b(?:rgba?|hsla?)\\(\\s*[0-9.][^)]*\\)',
].join('|');
export const LITERAL_RE = new RegExp(LITERAL_SOURCE);
const literalMatcher = () => new RegExp(LITERAL_SOURCE, 'g');

// ── named color 오라클 ────────────────────────────────────────────────────────
// 148색을 손으로 적지 않는다. jsdom의 CSSStyleDeclaration이 색 값을 검증한다:
// 유효한 색은 round-trip하고 무효 토큰은 빈 문자열이 된다(px/solid/Roboto/nowrap 확인).
const CSS_WIDE = new Set([
  'currentcolor', 'transparent', 'inherit', 'initial', 'unset', 'revert', 'revert-layer',
]);
// jsdom은 CSS **시스템 색**까지 유효한 색으로 받아들인다(`isNamedColor('background') === true`).
// 시스템 색은 명세상 색이지만 **저작된 named color가 아니고**, 하필 CSS에서 가장 흔한 단어들과
// 겹친다(background·menu·window·canvas·field·mark·highlight). 그래서 **오라클을 둘로 가른다**:
// `isNamedColor`는 저작된 named color만 인정하고, 시스템 색은 `isSystemColor`가 따로 맡는다.
// ⚠️ **둘 다 색으로 센다 — 단, `propTakesColor`를 통과한 색 자리에서만.** 시스템 색을 통째로
//    빼면 `color: CanvasText`·`background: Canvas`가 **네 경로 전부**(CSS 선언·HTML `style`
//    속성·JSX `style` 객체·SVG 색 속성) hit 0이 된다(실측). 오탐을 막는 것은 blanket skip이
//    아니라 prop 게이트다 — 실측(HEAD `99d1d09`): prop 게이트를 끄면 레포 hit **868**, 켜면
//    **696**이고 그 차 **172건이 전부 `transition : background` 한 종류**다(다른 prop·다른
//    시스템 색 **0건**). 즉 blanket skip은 172 억제에 **0 기여**하면서 진짜 색만 가린다.
//    시스템 색을 허용해도 레포 수치는 한 자리도 안 움직인다(`targets 412 | hits 696 | named 23`,
//    hit 문자열 차집합 양방향 0 — 아래 재실측 참조).
// CSS Color 4 §6(19) + §6.2 deprecated CSS2 System Colors(23)의 **닫힌 집합** 42개라 적는다
// — 148색 하드코딩을 피한 오라클의 취지는 그대로다(이건 두 오라클을 가르는 경계 목록이다).
const SYSTEM_COLORS = new Set([
  'accentcolor', 'accentcolortext', 'activetext', 'buttonborder', 'buttonface',
  'buttontext', 'canvas', 'canvastext', 'field', 'fieldtext', 'graytext', 'highlight',
  'highlighttext', 'linktext', 'mark', 'marktext', 'selecteditem', 'selecteditemtext',
  'visitedtext',
  'activeborder', 'activecaption', 'appworkspace', 'background', 'buttonhighlight',
  'buttonshadow', 'captiontext', 'inactiveborder', 'inactivecaption',
  'inactivecaptiontext', 'infobackground', 'infotext', 'menu', 'menutext', 'scrollbar',
  'threeddarkshadow', 'threedface', 'threedhighlight', 'threedlightshadow',
  'threedshadow', 'window', 'windowframe', 'windowtext',
]);
// 시스템 색은 닫힌 42개 집합이므로 jsdom을 거치지 않는다(대소문자 무시). isNamedColor와
// **교집합이 없다** — 위 SYSTEM_COLORS가 isNamedColor의 거부 목록이기도 하기 때문이다.
export const isSystemColor = (t) => SYSTEM_COLORS.has(String(t).toLowerCase());
let probeEl = null;
const namedCache = new Map();
export function isNamedColor(token) {
  if (namedCache.has(token)) return namedCache.get(token);
  if (!probeEl) probeEl = new JSDOM('<i></i>').window.document.querySelector('i');
  probeEl.style.color = '';
  probeEl.style.color = token;
  const out = probeEl.style.color;
  const lower = out.toLowerCase();
  const ok = out !== '' && !CSS_WIDE.has(lower) && !SYSTEM_COLORS.has(lower)
    && !LITERAL_RE.test(token);
  namedCache.set(token, ok);
  return ok;
}

// ── 값 문자열에서 hit 뽑기 ────────────────────────────────────────────────────
const IDENT_RE = /[A-Za-z][A-Za-z0-9-]*/g;

function literalsIn(value) {
  const out = [];
  for (const m of value.matchAll(literalMatcher()))
    out.push({ value: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

// ── property 문맥 게이트 (named color·시스템 색 전용) ─────────────────────────
// isNamedColor/isSystemColor는 **토큰이 색인지**만 알 뿐 **그 자리가 색 자리인지**는 모른다.
// 그래서 property를 함께 본다. **이 게이트가 시스템 색 오탐 172건을 혼자 막는다**(실측:
// 게이트 OFF 868 → ON 696, 차 172 전부 `transition : background`). property를 함께 본다.
// 실측(합성 4케이스 전부 hit): `content: "white"`(문자열 리터럴)·
// `animation-name: red`(@keyframes 이름)·`font-family: Tomato`(글꼴 이름)·
// `grid-area: gold`(그리드 영역 이름). 이것들은 **색이 아니라서** colorExceptions.js의
// 등록 가능 7분류 중 어디에도 넣을 수 없다 — 해소할 수단이 없는 RED가 된다.
// ⚠️ 제한은 **named color·시스템 색 경로에만** 건다. hex·rgb 리터럴은 property와 무관하게 계속
//    잡는다(literalsIn은 이 게이트를 통과하지 않는다) — content 안에 적힌 hex도 색이다.
// ⚠️ 커스텀 property(`--x: white`)는 **색의 원천**이므로 언제나 색 자리로 본다.
//    토큰 정의처 styles/_themes.scss는 STRUCTURAL_EXCLUSIONS가 파일 단위로 따로 뺀다.
// longhand는 `*-color`로 받고(color·background-color·caret-color·stop-color…), 색이 들어갈
// 수 있는 shorthand·paint property만 닫힌 목록으로 적는다. SVG 색 속성(fill·stroke)도 여기 있다.
// `border-image`/`mask-border` 계열과 `-webkit-text-stroke`는 gradient로 **실제 색을 받으므로**
// 함께 적는다 — 빠지면 `border-image: linear-gradient(red, blue) 1`의 색을 통째로 놓친다.
// 실측: 이 게이트를 넣어도 레포 전체 hit 총량 696과 named hit(white×18 · black×5)이 그대로다.
const COLOR_SHORTHANDS = new Set([
  'background', 'background-image', 'border', 'border-top', 'border-right',
  'border-bottom', 'border-left', 'border-block', 'border-block-start',
  'border-block-end', 'border-inline', 'border-inline-start', 'border-inline-end',
  'border-image', 'border-image-source', 'outline', 'column-rule', 'text-decoration',
  'text-emphasis', 'box-shadow', 'text-shadow', 'filter', 'backdrop-filter', 'mask',
  'mask-image', 'mask-border', 'mask-border-source', 'list-style', 'list-style-image',
  'caret', 'text-stroke', 'fill', 'stroke',
]);
function propTakesColor(prop) {
  if (!prop) return false;
  const p = String(prop).trim().toLowerCase();
  if (p.startsWith('--')) return true;                      // 커스텀 property = 색 원천
  const bare = p.replace(/^-(?:webkit|moz|ms|o)-/, '');     // 벤더 접두 제거
  return bare.endsWith('color') || COLOR_SHORTHANDS.has(bare);
}

// ── 값 안의 비-색 문맥 게이트 (named color·시스템 색 전용) ────────────────────
// 색 자리인 property 안에도 **색 자리가 아닌 구간**이 있다: `url(...)`의 내용은 파일
// 경로나 URL fragment id이고(`background-image: url("/icons/white.svg")`·`mask-image: url(#black)`),
// 따옴표 문자열은 산문이며, 주석은 값이 아니다. 반대로 `linear-gradient(...)` 같은 **paint
// 함수의 인자는 진짜 색**이므로 마스킹하지 않는다(함수 이름 자체는 뒤가 `(`라 원래 걸러진다).
// ⚠️ hex·rgb는 이 마스킹을 통과하지 않는다 — literalsIn이 따로 돌므로 url 안의 data-URI 색
//    (`%23` 접두)과 `content` 안에 적힌 hex는 문맥과 무관하게 계속 잡힌다.
//
// ⚠️ **한 줄 정규식으로는 못 한다 — CSS의 escape(`\)`·`\"`) 때문이다.** `[^)]*`류는
//    `url(foo\)white.svg)`에서 이스케이프된 `)`를 진짜 닫는 괄호로 읽어 마스크가 조기
//    종료되고 `white`가 샌다(실측: 그 값 하나로 `background-image` named hit 1건 오탐,
//    CSS 선언·HTML `style` 속성·JSX `style` 객체 **세 경로 전부**). 그래서 왼쪽에서
//    오른쪽으로 한 번 훑는 **escape-aware 스캐너**를 쓴다. 단일 패스라서 문자열 안의
//    `/*`가 주석으로, 주석 안의 따옴표가 문자열로 오인되지 않는다.
// ⚠️ **함수 이름 자체도 escape될 수 있다.** `u\72l(`·`\75 rl(`은 둘 다 `url(`이다(`\72`=r,
//    `\75`=u, hex escape 뒤 공백 한 개는 **escape의 종결자**라 이름의 일부다). 문자 그대로의
//    `url(`만 찾으면 마스크가 아예 안 걸려 안의 파일 이름이 색으로 샌다 — 실측 오탐 각 1건,
//    raw CSS·HTML `style`·JSX `style` **세 경로 전부**. ⚠️ **SCSS는 이 결함을 가린다**:
//    sass가 `u\72l(`를 `url(`로 **디코드**해 컴파일 결과가 이미 정상이다(compileString 실측).
// ⚠️ **CSS의 줄바꿈은 LF·CR·FF 셋이고 CRLF는 두 글자가 한 줄바꿈이다.** 문자열 안의
//    `\`+줄바꿈은 continuation이라, `\`+CRLF를 두 글자만 삼키면 남은 LF가 문자열을 끝내
//    뒤가 샌다 — 실측: `--x: "a\⟨CRLF⟩white"`가 SCSS·CSS·HTML·JSX **네 경로 전부** 오탐 1건.
// ⚠️ 파서 선택은 실측으로 정했다: `postcss-value-parser`는 **package-lock.json에 항목이
//    없다**(`next/dist/compiled/` 안에 번들된 사본뿐이라 `require.resolve`가 실패한다) —
//    없는 것을 새로 설치하지 않는다. `css-tree`·`@csstools/css-tokenizer`는 resolve되지만
//    jsdom 쪽 **전이 의존**일 뿐 package.json에 없어서, 선언 없는 의존을 lockfile dedupe
//    한 번에 잃는다. 선언된 devDep `postcss`의 내부 토크나이저(`postcss/lib/tokenize`)는
//    exports에 있어 resolve되지만 **이 문제를 풀지 못한다**(실측): `u\72l(white.svg)`를
//    `word(u) word(\72) word(l) brackets((white.svg))`로 쪼개 escape된 이름을 복원하지 않고,
//    `url(`과 `linear-gradient(`를 **둘 다 brackets로** 내어 구분해 주지도 않는다. 남는
//    선택지는 스캐너 하나다. 아래 5규칙이 이 게이트에 필요한 전부이고, **지원 범위는 딱
//    거기까지다** — S9 계획 「스캐너가 지원하는 문법과 한계」 표가 경계를 적어 둔다.
//    (1) 주석 `/*…*/`은 escape가 없다 — 첫 `*/`에서 끝난다.
//    (2) escape는 세 가지뿐이다: `\`+줄바꿈(문자열 전용 continuation, CRLF는 3글자) ·
//        `\`+hex 1~6자리(+종결 공백 1개) · `\`+한 글자. `escapeLen` 하나가 셋을 다 센다.
//    (3) 문자열은 escape를 인식하며 닫는 따옴표까지고, 미종료면 **줄바꿈 앞**에서 끝난다
//        (bad-string). 그 뒤는 문자열 밖이라 색으로 본다.
//    (4) identifier는 escape를 **디코드하며** 읽는다. 디코드 결과가 `url`이고 바로 뒤가
//        `(`일 때만 url 토큰이다 — `myu\72l(`도 `100url(`도 아니다(ident 경계·dimension).
//    (5) url 토큰은 공백 뒤가 따옴표면 함수+문자열, 아니면 unquoted url 토큰이다.
//        어느 쪽이든 **escape를 인식하며** 첫 닫는 `)`까지가 구간이다 — 값 끝까지가 아니다
//        (아니면 `url(a.svg), linear-gradient(white, black)`의 색까지 먹는다).
// ⚠️ 주석 분기는 postcss 경로에서는 **도달하지 않는다**(실측: postcss가 `decl.value`에서
//    주석을 지운다 — `color: /* white */ var(--x)`의 `decl.value`는 `var(--x)`뿐이다).
//    살아 있는 곳은 원문 문자열을 그대로 보는 **JSX `style` 객체 값**이다. 지우지 마라.
//    ⚠️ 이 주석들에 hex를 쓰지 마라 — 이 모듈 자신도 스윕 대상이라 그대로 over가 된다.
// ── escape-aware 스캐너의 원자들 ──────────────────────────────────────────────
// CSS의 줄바꿈은 LF·CR·FF 셋이고 CRLF는 **두 글자가 한 줄바꿈**이다(css-syntax-3 §3.3).
// ident 문자는 ASCII 말고 비ASCII도 포함한다 — 정규식에 코드포인트 escape를 적는 대신
// 함수로 둔다(이 파일 자신이 스윕 대상이라 리터럴을 최소로 유지한다).
const ASCII_IDENT_RE = /[A-Za-z0-9_-]/;
const NEWLINE_RE = /[\n\r\f]/;
const WS_RE = /[ \t\n\r\f]/;
const HEX_RE = /[0-9a-fA-F]/;
const nonAscii = (ch) => !!ch && ch.codePointAt(0) > 0x7f;
const isIdentChar = (ch) => !!ch && (ASCII_IDENT_RE.test(ch) || nonAscii(ch));
const isIdentStart = (ch) => !!ch && (/[A-Za-z_-]/.test(ch) || nonAscii(ch));   // 숫자는 못 연다

// value[i]의 `\`가 삼키는 길이(백슬래시 포함). 0이면 그 자리는 escape가 아니다.
//   `\` + 줄바꿈  : **문자열 안에서만** 유효한 continuation. CRLF는 3을 준다 — 2를 주면
//                  남은 LF가 문자열을 끝내 뒤가 샌다(실측: `--x:"a\⟨CRLF⟩white"`의 white 오탐).
//                  ident 안에서는 escape가 아니므로 inIdent가 0을 준다.
//   `\` + hex 1~6 : 코드포인트 escape. **뒤의 공백 한 개는 escape의 종결자**라 함께 삼킨다
//                  (`\75 rl` = `url`). CRLF 종결자도 한 개로 센다.
//   그 밖         : 다음 한 글자를 그대로 삼킨다(`\)` · `\"`).
function escapeLen(value, i, { inIdent = false } = {}) {
  const n = value.length;
  if (value[i] !== '\\') return 0;
  if (i + 1 >= n) return inIdent ? 0 : 1;                  // 값 끝의 홑 백슬래시
  const next = value[i + 1];
  if (NEWLINE_RE.test(next)) {
    if (inIdent) return 0;
    return next === '\r' && value[i + 2] === '\n' ? 3 : 2;
  }
  if (!HEX_RE.test(next)) return 2;
  let j = i + 1, digits = 0;
  while (j < n && digits < 6 && HEX_RE.test(value[j])) { j += 1; digits += 1; }
  if (j < n && WS_RE.test(value[j])) j += (value[j] === '\r' && value[j + 1] === '\n') ? 2 : 1;
  return j - i;
}

// value[i]에서 시작하는 identifier를 **escape를 디코드하며** 읽어 `{ end, name }`을 준다.
// 색 이름 판정에는 쓰지 않는다 — `url(`이라는 **함수 이름**을 escape 너머로 알아보려는 것이다
// (`u\72l(`·`\75 rl(`은 둘 다 `url(`이다). 코드포인트가 0·서로게이트·범위 밖이면 U+FFFD다.
function readIdent(value, i) {
  const n = value.length;
  let j = i, name = '';
  while (j < n) {
    const ch = value[j];
    if (ch === '\\') {
      const len = escapeLen(value, j, { inIdent: true });
      if (len === 0) break;
      const hex = value.slice(j + 1, j + len).match(/^[0-9a-fA-F]{1,6}/);
      if (hex) {
        const cp = parseInt(hex[0], 16);
        const bad = cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff);
        name += String.fromCodePoint(bad ? 0xfffd : cp);
      } else name += value[j + 1];
      j += len; continue;
    }
    if (!isIdentChar(ch)) break;
    name += ch; j += 1;
  }
  return j > i ? { end: j, name } : null;
}

// value[i]가 따옴표일 때 그 문자열 토큰의 끝(배타적)을 준다.
function endOfString(value, i) {
  const q = value[i];
  const n = value.length;
  let j = i + 1;
  while (j < n) {
    const esc = escapeLen(value, j);           // `\` + LF/CR/FF/CRLF continuation도 여기서 삼킨다
    if (esc) { j += esc; continue; }
    const ch = value[j];
    if (ch === q) return j + 1;
    if (NEWLINE_RE.test(ch)) return j;         // 미종료 문자열은 줄바꿈 앞에서 끝난다(bad-string)
    j += 1;
  }
  return j;
}

function nonColorCtx(value) {
  const out = [];
  const n = value.length;
  let i = 0;
  while (i < n) {
    const ch = value[i];
    if (ch === '/' && value[i + 1] === '*') {                  // (1) 주석
      const close = value.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      out.push({ start: i, end }); i = end; continue;
    }
    if (ch === '"' || ch === "'") {                            // (2) 문자열
      const end = endOfString(value, i);
      out.push({ start: i, end }); i = end; continue;
    }
    if ((ch === '\\' || isIdentStart(ch)) && !isIdentChar(value[i - 1])) {   // (3) identifier
      const id = readIdent(value, i);
      if (id && id.name.toLowerCase() === 'url' && value[id.end] === '(') {  // url() 토큰
        let j = id.end + 1;
        while (j < n && WS_RE.test(value[j])) j += 1;
        if (value[j] === '"' || value[j] === "'") j = endOfString(value, j);
        while (j < n) {
          const esc = escapeLen(value, j);
          if (esc) { j += esc; continue; }
          if (value[j] === ')') { j += 1; break; }
          j += 1;
        }
        const end = Math.min(j, n);
        out.push({ start: i, end }); i = end; continue;
      }
      if (id) { i = id.end; continue; }        // url이 아닌 ident는 통째로 지나간다
    }
    i += escapeLen(value, i) || 1;                             // 값 최상위의 escape
  }
  return out;
}

function namedIn(value, skipRanges, prop) {
  if (!propTakesColor(prop)) return [];
  const skips = [...skipRanges, ...nonColorCtx(value)];
  const out = [];
  for (const m of value.matchAll(IDENT_RE)) {
    const s = m.index, e = s + m[0].length;
    if (value[e] === '(') continue;                                    // 함수명
    if (value.slice(Math.max(0, s - 2), s) === '--') continue;         // var(--x)
    if (skips.some((r) => s < r.end && e > r.start)) continue;         // 리터럴·비색 문맥 내부
    if (isNamedColor(m[0]) || isSystemColor(m[0])) out.push({ value: m[0] });
  }
  return out;
}

// ── CSS 경로 ─────────────────────────────────────────────────────────────────
function selectorPath(node) {
  const parts = [];
  for (let n = node.parent; n && n.type !== 'root'; n = n.parent) {
    if (n.type === 'rule') parts.unshift(n.selector.replace(/\s+/g, ' ').trim());
    else if (n.type === 'atrule') parts.unshift(`@${n.name} ${n.params}`.trim());
  }
  return parts.length ? parts.join(' | ') : null;
}

function hitsFromCss(cssText, file, lineOffset = 0) {
  const hits = [];
  postcss.parse(cssText, { from: undefined }).walkDecls((decl) => {
    const selector = selectorPath(decl);
    const line = (decl.source?.start?.line ?? 0) + lineOffset;
    const lits = literalsIn(decl.value);
    for (const l of lits) hits.push({ file, selector, prop: decl.prop, value: l.value, line });
    for (const n of namedIn(decl.value, lits, decl.prop))
      hits.push({ file, selector, prop: decl.prop, value: n.value, line });
  });
  return hits;
}

// ── HTML/SVG 색 속성 ──────────────────────────────────────────────────────────
const COLOR_ATTR_RE =
  /\b(fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*(["'])(.*?)\2/gi;
const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const INLINE_STYLE_RE = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi;
const mask = (text, start, end) =>
  text.slice(0, start) + text.slice(start, end).replace(/[^\n]/g, ' ') + text.slice(end);
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

// ── JSX style={{…}} 객체 ─────────────────────────────────────────────────────
// 자유 텍스트가 못 보는 named color를 오탐 없이 잡는 유일한 자리다. 값 노드 구간을
// 돌려주므로 호출부가 그 구간을 마스킹해 자유 텍스트 경로와 중복 계상하지 않는다.
// 값이 조건·기본값·상수 템플릿으로 갈라져도 갈래를 전부 본다. 반대로 값이 의미로만
// 정해지는 형태(외부 변수·멤버 접근·호출·연결·보간)와 style={변수}는 **명시적 비목표**다.
const JsxParser = AcornParser.extend(acornJsx());
const toKebab = (key) =>
  key.startsWith('--') ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function walkAst(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walkAst(c, fn));
    else if (v && typeof v.type === 'string') walkAst(v, fn);
  }
}

// property 값에서 **정적으로 확정되는 문자열 노드**만 재귀로 모은다. 값이 조건/기본값으로
// 갈라져도 색은 소스에 박혀 있으므로 갈래를 전부 주장 대상으로 삼는다.
//   ConditionalExpression → consequent·alternate 둘 다 (어느 쪽이 골라지든 그 색은 렌더된다)
//   LogicalExpression     → left·right 둘 다 (`a || '<색리터럴>'`의 폴백이 실제로 렌더된다)
//   TemplateLiteral       → expressions가 0개일 때만 = 상수 문자열과 동치
// 그 밖(Identifier·MemberExpression·CallExpression·BinaryExpression·보간 TemplateLiteral)은
// **명시적 비목표**다. 근거는 아래 hitsFromJsxStyle 주석.
function staticStringNodes(node, out = []) {
  if (!node || typeof node.type !== 'string') return out;
  if (node.type === 'Literal') {
    if (typeof node.value === 'string') out.push({ node, text: node.value });
    return out;
  }
  if (node.type === 'TemplateLiteral') {
    if (node.expressions.length === 0 && node.quasis.length === 1)
      out.push({ node, text: node.quasis[0].value.cooked ?? '' });
    return out;
  }
  if (node.type === 'ConditionalExpression')
    return staticStringNodes(node.alternate, staticStringNodes(node.consequent, out));
  if (node.type === 'LogicalExpression')
    return staticStringNodes(node.right, staticStringNodes(node.left, out));
  return out;
}

// style={{…}}에서 (prop, 값) 쌍을 뽑는다. 값 노드 구간을 spans로 돌려주므로 호출부가
// 그 구간을 마스킹해 자유 텍스트 경로와 중복 계상하지 않는다.
//
// ⚠️ **의미적 해석은 비목표다(fail-closed 아님).** 값이 외부 변수·멤버 접근·함수 호출·
// 문자열 연결·보간 템플릿이면 색이 소스에 없거나(런타임/DB 유래) 어휘적으로 조립되므로
// 이 스윕의 명제("소스에 박힌 색 리터럴은 전부 분류되어 있다")의 대상이 아니다.
// 이런 값을 미해석이라고 fail-closed하면 실측 204개 property 값(색 관련 prop만 좁혀도 76개)이
// 전부 미분류로 떠서, 예외 레지스트리가 `width: nameColWidth`·`zIndex: 100`·`color: label.color`
// 같은 항목으로 뒤덮인다 — 게다가 DB 유래 색은 tuple로 고정될 값 자체가 없다.
// style={변수} / style={cond ? {…} : {…}} 컨테이너도 같은 이유로 자유 텍스트에 맡긴다.
function hitsFromJsxStyle(text, file) {
  let ast;
  try {
    ast = JsxParser.parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (err) {
    // 조용히 넘기면 그 파일이 스윕에서 통째로 사라진다 — 구멍을 숨기지 않는다.
    throw new Error(`JS/JSX 파싱 실패: ${file}\n${err.message}`);
  }
  const hits = [], spans = [];
  walkAst(ast, (n) => {
    if (n.type !== 'JSXAttribute' || n.name?.name !== 'style') return;
    const ex = n.value?.type === 'JSXExpressionContainer' ? n.value.expression : null;
    if (!ex || ex.type !== 'ObjectExpression') return;
    for (const p of ex.properties) {
      if (p.type !== 'Property') continue;
      const key = p.key.type === 'Identifier' ? p.key.name
                : p.key.type === 'Literal' ? String(p.key.value) : null;
      if (!key) continue;
      const prop = toKebab(key);
      for (const { node, text: value } of staticStringNodes(p.value)) {
        const line = lineAt(text, node.start);
        const lits = literalsIn(value);
        for (const l of lits) hits.push({ file, selector: '[style]', prop, value: l.value, line });
        for (const n2 of namedIn(value, lits, prop))
          hits.push({ file, selector: '[style]', prop, value: n2.value, line });
        spans.push([node.start, node.end]);
      }
    }
  });
  return { hits, spans };
}

// ── 자유 텍스트 경로 ──────────────────────────────────────────────────────────
// prop = 값 바로 앞의 최근접 식별자(속성명/객체키/변수명). 400자 창의 마지막 토큰.
function nearestProp(text, index) {
  const win = text.slice(Math.max(0, index - 400), index);
  const ids = win.match(/[A-Za-z_$][\w$]*(?:-[\w$]+)*/g);
  return ids && ids.length ? ids[ids.length - 1] : null;
}

function hitsFromText(text, file) {
  const hits = [];
  for (const m of text.matchAll(literalMatcher()))
    hits.push({ file, selector: null, prop: nearestProp(text, m.index),
                value: m[0], line: lineAt(text, m.index) });
  return hits;
}

// ── 파일 종류별 디스패치 ──────────────────────────────────────────────────────
export function hitsFor(relPath, text) {
  if (relPath.endsWith('.scss')) {
    let css;
    try {
      css = compileString(text, {
        url: pathToFileURL(resolve(ROOT, relPath)),
        loadPaths: [resolve(ROOT, 'styles')],
      }).css;
    } catch (err) {
      throw new Error(`SCSS 컴파일 실패: ${relPath}\n${err.message}`);
    }
    return hitsFromCss(css, relPath);
  }
  if (relPath.endsWith('.css')) return hitsFromCss(text, relPath);

  if (relPath.endsWith('.html') || relPath.endsWith('.svg')) {
    const hits = [];
    let rest = text;
    // ① <style> 블록은 postcss로 — 진짜 (selector, prop, value)를 얻는다
    for (const m of text.matchAll(STYLE_BLOCK_RE)) {
      const inner = m[1];
      const innerStart = m.index + m[0].indexOf(inner);
      hits.push(...hitsFromCss(inner, relPath, lineAt(text, innerStart) - 1));
      rest = mask(rest, m.index, m.index + m[0].length);
    }
    // ② 색 속성 — selector=null, prop=속성명
    for (const m of rest.matchAll(COLOR_ATTR_RE)) {
      const prop = m[1].toLowerCase(), value = m[3];
      const lits = literalsIn(value);
      const line = lineAt(text, m.index);
      for (const l of lits) hits.push({ file: relPath, selector: null, prop, value: l.value, line });
      for (const n of namedIn(value, lits, prop))
        hits.push({ file: relPath, selector: null, prop, value: n.value, line });
      rest = mask(rest, m.index, m.index + m[0].length);
    }
    // ③ 인라인 style="…" — 선언 본문을 x{…}로 감싸 postcss에 먹인다.
    //    자유 텍스트는 named color를 안 보므로 color:white가 여기서만 잡힌다.
    for (const m of rest.matchAll(INLINE_STYLE_RE)) {
      hits.push(...hitsFromCss(`x{${m[2]}}`, relPath, 0)
        .map((h) => ({ ...h, selector: '[style]', line: lineAt(text, m.index) })));
      rest = mask(rest, m.index, m.index + m[0].length);
    }
    // ④ 나머지 텍스트(data-URI 등)
    hits.push(...hitsFromText(rest, relPath));
    return hits;
  }

  if (/\.jsx?$/.test(relPath)) {
    // ⑤ style={{…}} 객체 → 값 구간을 마스킹한 뒤 자유 텍스트 (중복 계상 방지)
    const { hits: styleHits, spans } = hitsFromJsxStyle(text, relPath);
    let rest = text;
    for (const [s, e] of spans) rest = mask(rest, s, e);
    return [...styleHits, ...hitsFromText(rest, relPath)];
  }

  return hitsFromText(text, relPath);   // .json 그 외
}

// ── 스윕 대상 ─────────────────────────────────────────────────────────────────
// 런타임에 실제로 번들되는 디렉터리를 전부 센다. hooks/·lib/이 빠져 있으면 그 아래에서
// 색 리터럴이 생기거나 스윕 모듈을 import해도 게이트가 침묵한다(실측: 런타임 9파일 누락).
export const SWEEP_ROOTS = ['styles', 'components', 'pages', 'library', 'public', 'hooks', 'lib'];

// Next가 인식하는 **루트 직속 런타임 진입점**. 디렉터리가 아니라 파일이라 SWEEP_ROOTS와 축이
// 다르다(SWEEP_ROOTS는 `${root}/` 접두로 단정되므로 여기 섞으면 그 단정이 깨진다).
// middleware만 보면 같은 코드를 proxy·instrumentation으로 옮겨 담는 순간 게이트가 침묵한다.
export const ROOT_RUNTIME_ENTRYPOINTS = ['middleware', 'proxy', 'instrumentation', 'instrumentation-client'];
// Next는 이 진입점들을 프로젝트 루트뿐 아니라 `src/` 아래에서도 인식한다. 루트만 보면
// src/ 레이아웃으로 옮기는 순간 게이트가 침묵한다(실측 반례: src/proxy.js는 SWEEP_ROOTS에
// 없어 열거되지 않았다).
export const ROOT_RUNTIME_LOCATIONS = ['', 'src/'];
const SUPPORTED_ENTRY_EXT = ['.js', '.jsx'];
// ⚠️ 이 스캐너는 TS를 파싱하지 못한다(acorn + acorn-jsx만 쓴다). .ts/.tsx 진입점이 생기면
//    조용히 건너뛰지 말고 **목록으로 드러낸다** — 조용한 제외는 "감시 중"이라는 주장을
//    거짓으로 만든다. literalColorSweep.test.js가 이 목록이 비어 있음을 단정해 fail-closed 한다.
const UNSUPPORTED_ENTRY_EXT = ['.ts', '.tsx'];
const existsRel = (rel) => { try { readFileSync(resolve(ROOT, rel)); return true; } catch { return false; } };
const entryPaths = (exts) => ROOT_RUNTIME_LOCATIONS.flatMap((loc) =>
  ROOT_RUNTIME_ENTRYPOINTS.flatMap((base) => exts.map((ext) => `${loc}${base}${ext}`)));

/** 파싱 가능한 진입점 후보 전 조합(위치 × 이름 × 확장자). 파일 존재와 무관하다. */
export const rootRuntimeCandidates = () => entryPaths(SUPPORTED_ENTRY_EXT);

/** 존재하지만 이 스캐너가 파싱하지 못하는 진입점. 비어 있지 않으면 테스트가 fail-closed 한다. */
export function unsupportedRootEntrypoints({ exists = existsRel } = {}) {
  return entryPaths(UNSUPPORTED_ENTRY_EXT).filter(exists);
}
const rootRuntimeFiles = () => rootRuntimeCandidates().filter(existsRel);
const EXT_RE = /\.(scss|css|js|jsx|html|svg|json)$/;
// ⚠️ tiptapCanonical.baseline.json은 **테스트 산출물**이다(소비처: tiptapStoredColor.dom.test.js
//    단 1곳). 구성상 저장 HTML의 색 문자열로만 이뤄져 있어 스윕하면 픽스처 내용만큼 자기참조
//    hit이 생긴다(실측 64). STRUCTURAL_EXCLUSIONS(정의처·정본 자신, 길이 3 고정)와는 축이
//    다르므로 여기서 **exact 경로 하나만** 뺀다 — `*.baseline.json` 같은 광역 패턴은 앞으로
//    생길 다른 baseline의 진짜 색까지 통째로 가리므로 쓰지 않는다.
const SKIP_RE = /(?:\.test\.js$|\.test\.jsx$|__fixtures__\/|__snapshots__\/|^public\/fonts\/|^public\/wasm\/|^public\/assets\/|^library\/tiptapCanonical\.baseline\.json$)/;

// 튜플 등록이 자기모순이거나 자기참조인 파일만 **파일 단위로** 제외한다.
// 테스트가 길이를 3으로 고정하므로 네 번째 항목은 테스트를 고의로 고쳐야 들어온다.
export const STRUCTURAL_EXCLUSIONS = [
  {
    file: 'styles/_themes.scss',
    reason: '토큰의 정의처. 스윕의 명제는 "소비처가 var()를 쓰는가"이므로 정의처를 소비처로 취급하면 129개 리터럴에 129개 예외를 다는 자기모순이 된다. themeTokens.test.js도 같은 이유로 이 파일 하나만 제외한다.',
  },
  {
    file: 'library/colorExceptions.js',
    reason: '예외 레지스트리 자신. 구성상 모든 예외의 value 문자열을 포함하므로 자기 자신을 스윕하면 항목 수만큼 자기참조 hit이 생긴다.',
  },
  {
    file: 'library/colorClassified.js',
    reason: '분류 정본 자신. colorExceptions.js와 같은 이유다 — 구성상 모든 theme-dependent 선언의 value 문자열을 포함하므로 자기 자신을 스윕하면 항목 수만큼 자기참조 hit이 생긴다.',
  },
];
const EXCLUDED = new Set(STRUCTURAL_EXCLUSIONS.map((e) => e.file));

// ── S8 인계: 서드파티 소유 파일 제외 (STRUCTURAL_EXCLUSIONS와 **다른 축**) ──────────
// S8이 `colorExceptions.js`에 `THIRD_PARTY_OWNED` 5항목을 등록했다. 그 중 **경로 기준
// 두 종류만** 스윕 대상에서 뺀다 — `styles/vendor/` 아래와 `node_modules/` 아래.
// 근거(실측): `styles/vendor/highlight-themes.scss`는 `meta.load-css`로 highlight.js의
// github/github-dark CSS를 컴파일 타임에 인라인하므로, 컴파일 산출 CSS에 라이브러리 팔레트
// **36개 리터럴**이 그대로 나타난다(github/github-dark 팔레트 hex). 이것들은 우리 소스에 한
// 글자도 없고 라이브러리 패치 버전마다 바뀌므로, 튜플로 등록하면 업그레이드마다 게이트가
// 깨진다 — 그 깨짐은 "우리 코드에 리터럴이 생겼다"는 신호가 아니라 소음이다.
//
// ⚠️ 나머지 3항목(`library/editorTheme.js`·`components/Canvas/extensions/mermaidConfig.js`·
//    `components/common/IconPicker.js`)은 **문서 기록 전용이며 스윕 대상에 그대로 남는다.**
//    지금 리터럴이 0건이라 제외가 불필요하고, 제외하면 나중에 그 파일에 생길 진짜 리터럴을
//    놓친다. 경로 접두 두 개로만 판정하는 이유가 이것이다 — 파일 목록을 그대로 쓰면 안 된다.
//
// ⚠️ `THIRD_PARTY_OWNED`를 `CLASSIFIED_POOL`에 **넣지 않는다.** 소비 풀에 넣으면 튜플
//    (file, selector, prop, value)이 없는 항목이라 아무 hit도 소비하지 못해 전부 dead가 되고,
//    설령 튜플을 붙여도 라이브러리 버전마다 dead/over가 번갈아 뜬다. 축이 다르다:
//    CLASSIFIED_POOL은 "이 튜플은 분류됐다", THIRD_PARTY_EXCLUDED는 "이 파일은 우리 것이 아니다".
const THIRD_PARTY_PREFIXES = ['styles/vendor/', 'node_modules/'];
export const THIRD_PARTY_EXCLUDED = THIRD_PARTY_OWNED
  .map((e) => e.file)
  .filter((f) => THIRD_PARTY_PREFIXES.some((pre) => f.startsWith(pre)));
const THIRD_PARTY_EXCLUDED_SET = new Set(THIRD_PARTY_EXCLUDED);

/**
 * 수집 판정의 **단일 술어**. 두 제외 축과 확장자·SKIP 규칙을 한곳에서 결정한다.
 * 테스트가 파일을 만들지 않고도 "이 경로가 제외되는가"를 직접 물을 수 있게 export한다
 * (그래야 광역 패턴으로 넓혔을 때 합성 경로로 RED를 낼 수 있다).
 */
export function isSweepTarget(rel) {
  if (!EXT_RE.test(rel) || SKIP_RE.test(rel)) return false;
  if (EXCLUDED.has(rel)) return false;                   // 정의처·정본 자신
  if (THIRD_PARTY_EXCLUDED_SET.has(rel)) return false;   // S8 인계 — vendor/node_modules만
  return true;
}

export function collectSweepTargets() {
  const out = [];
  for (const root of SWEEP_ROOTS) {
    let entries;
    try { entries = readdirSync(resolve(ROOT, root), { recursive: true }).map(String); }
    catch { continue; }
    for (const f of entries) {
      const rel = `${root}/${f.split('\\').join('/')}`;
      if (isSweepTarget(rel)) out.push(rel);
    }
  }
  for (const rel of rootRuntimeFiles()) if (isSweepTarget(rel)) out.push(rel);
  return out.sort();
}

// ── consume-once 대조 ─────────────────────────────────────────────────────────
const fmtHit = (h) =>
  `${h.file}:${h.line ?? '?'} | ${h.selector ?? '-'} | ${h.prop ?? '-'} | ${h.value}`;
const fmtEntry = (e) =>
  `${e.file} | ${e.selector ?? '-'} | ${e.prop ?? '-'} | ${e.value} (${e.category})`;
const sameTuple = (e, h) =>
  e.file === h.file && (e.selector ?? null) === (h.selector ?? null)
  && (e.prop ?? null) === (h.prop ?? null) && e.value === h.value;

// COLOR_EXCEPTIONS(리터럴이 정답인 7분류)와 COLOR_CLASSIFIED(theme-dependent — 다크 짝이
// 이미 있어 예외로 등록할 수 없는 선언)는 **같은 정본의 두 면**이다. 스윕의 명제는
// "소스에 박힌 색 리터럴은 전부 분류되어 있다"이지 "전부 예외다"가 아니다.
// COLOR_CLASSIFIED는 같은 튜플의 반복을 count로 접어 두므로 여기서 펼쳐 소비 예산을 만든다.
// ⚠️ THIRD_PARTY_OWNED는 여기 **들어오지 않는다**(위 THIRD_PARTY_EXCLUDED 주석 참조).
//    import은 `colorExceptions.js`에서 COLOR_EXCEPTIONS와 함께 가져오되 풀에는 섞지 않는다.
// ⛔ PRIOR_SLICE_DEFERRED는 **소비 풀에 들어가지 않는다.** 유예는 분류가 아니다 —
//    풀에 넣으면 선행 슬라이스의 미결 색이 소비되어 over가 0이 되고, "다 끝났다"가 된다.
//    그건 이름만 다른 allowlist다. 유예는 `sweepRepo().deferred`라는 **별도 결과 채널**로만
//    드러나고 완료 판정(over)에는 아무 영향을 주지 않는다. 소유 슬라이스가 닫아야 over가 준다.
export const CLASSIFIED_POOL = [
  ...COLOR_EXCEPTIONS,
  ...COLOR_CLASSIFIED.flatMap((e) => Array.from({ length: e.count }, () => e)),
];

// overHits/deadEntries는 문자열 over/dead와 **같은 사건의 구조화 형태**다. S6의 범위별
// 대조가 라벨을 붙이려면 줄번호가 섞인 문자열을 되파싱하지 않고 튜플을 그대로 봐야 한다.
function consume(pool, hits) {
  const over = [], overHits = [];
  for (const h of hits) {
    const slot = pool.find((p) => !p.used && sameTuple(p.e, h));
    if (slot) slot.used = true;
    else { over.push(fmtHit(h)); overHits.push(h); }
  }
  return { over, overHits };
}
const deadOf = (pool) => pool.filter((p) => !p.used).map((p) => p.e);

/** 단일 파일 대조. text를 인자로 받으므로 디스크를 건드리지 않고 mutation 검증에 쓸 수 있다. */
export function sweepFile(relPath, text) {
  const hits = hitsFor(relPath, text);
  const pool = CLASSIFIED_POOL.filter((e) => e.file === relPath).map((e) => ({ e, used: false }));
  const { over, overHits } = consume(pool, hits);
  const deadEntries = deadOf(pool);
  return { file: relPath, hits: hits.length, over, overHits,
           dead: deadEntries.map((e) => `${fmtEntry(e)} — 미소비 분류/예외`), deadEntries };
}

/** 레포 전체 대조. over(미분류 색)와 dead(미소비 분류/예외)를 함께 낸다. */
export function sweepRepo({ read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8') } = {}) {
  const pool = CLASSIFIED_POOL.map((e) => ({ e, used: false }));
  const targets = collectSweepTargets();
  const over = [], overHits = [];
  let hitCount = 0;
  for (const rel of targets) {
    const hits = hitsFor(rel, read(rel));
    hitCount += hits.length;
    const r = consume(pool, hits);
    over.push(...r.over); overHits.push(...r.overHits);
  }
  const deadEntries = deadOf(pool);
  // ── 유예 채널 ───────────────────────────────────────────────────────────────
  // over 중 "누가 닫을지가 이미 정해진" 것들을 **표시만** 한다. over에서 빼지 않는다 —
  // 빼는 순간 완료 판정이 거짓이 된다. 이 채널은 보고용이고, 게이트는 여전히 over로 낸다.
  //
  // ⚠️ **소속(membership) 판정이 아니라 consume-once 예산이다.** 같은 튜플이 소스에 N번
  //    나오면 원장에도 N개 있어야 하고, N+1번째 출현은 유예로 흡수되지 않는다. 소속으로 재면
  //    기존 유예 튜플을 복사해 붙인 **새 출현이 무제한 흡수**되어 "소유자 미상 0"이 거짓이 된다
  //    (실측: 유예와 같은 튜플을 한 줄 더 넣으면 over 75 / deferred 75 로 같이 늘어 통과).
  //    CLASSIFIED_POOL의 consume()과 같은 슬롯 규약을 쓴다.
  const deferredPool = PRIOR_SLICE_DEFERRED.map((e) => ({ e, used: false }));
  const deferred = [];
  for (const h of overHits) {
    const slot = deferredPool.find((s) => !s.used && sameTuple(s.e, h));
    if (slot) { slot.used = true; deferred.push(h); }
  }
  const deferredByOwner = {};
  for (const s of deferredPool) {
    if (!s.used) continue;
    const o = s.e.owner || '(owner 미상)';
    deferredByOwner[o] = (deferredByOwner[o] || 0) + 1;
  }
  // 소비되지 않은 유예 = 원장은 남았다고 하는데 소스에는 없다(이행됐거나 파일이 사라졌다).
  // dead와 같은 성격이지만 축이 달라 따로 낸다 — 원장이 조용히 낡는 것을 막는다.
  const deferredUnused = deferredPool.filter((s) => !s.used).map((s) => `${fmtEntry(s.e)} — 미소비 유예`);
  // ── 완료 판정의 정본 ─────────────────────────────────────────────────────────
  // 사용자 결정(S9): 완료 기준은 "전역 over 0"이 아니라 **"신규·무소유 over 0 + 선행 debt 73 exact"**다.
  // 선행 슬라이스가 소유한 73건은 공식 deferred debt로 남기고, S9는 자기가 만든 색만 책임진다.
  // ⚠️ unownedOver는 over에서 유예를 **consume-once로** 차감한 나머지다. 소속 판정이 아니라
  //    슬롯이라 같은 튜플의 N+1번째 출현은 여기 그대로 드러난다.
  const deferredSet = new Set(deferred);
  const unownedOverHits = overHits.filter((h) => !deferredSet.has(h));
  const unownedOver = unownedOverHits.map(fmtHit);
  return { deferred, deferredByOwner, deferredUnused, unownedOver, unownedOverHits, over, overHits, deadEntries,
           dead: deadEntries.map((e) => `${fmtEntry(e)} — 미소비 분류/예외`),
           hitCount, fileCount: targets.length };
}
