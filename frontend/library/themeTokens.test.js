import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync, utimesSync, existsSync, mkdirSync, chmodSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join, sep, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { compile, compileString } from 'sass';
import postcss from 'postcss';
import * as SPEC from './s4Spec.mjs';
import * as EV from './s4Evaluator.mjs';
import * as CANON from './s4Canonicalize.mjs';
import * as PIX from './s4PixelDiff.mjs';
import * as PROM from './s4Promote.mjs';
import * as PROBE from './s4DomProbe.mjs';   // committed 측정 코드 — fingerprint 결속 확인용
import * as RUN from './s4CaptureRunner.mjs';   // committed 캡처 실행기
import * as CAP from '../scripts/s4-capture.mjs';   // committed 캡처 진입점(어댑터)
import * as AUDIT from '../scripts/s4-audit-candidate.mjs';   // privacy audit 부착 명령
import { execSync as __exec } from 'node:child_process';
import { PNG } from 'pngjs';                          // 픽셀 테스트용(ESM — require 금지)
import { execSync } from 'node:child_process';        // 기존 파일에 없으므로 신규 추가
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as PROJ from './s4Projection.mjs';             // compileString에 실제 파일 URL을 줘야 상대 @use가 풀린다
const sha256 = (x) => createHash('sha256').update(x).digest('hex');
const REPO = resolve(__dirname, '../..');   // BASE 소스를 git에서 읽을 때 사용
// 실제 PNG 바이트. evaluator가 pngjs로 진짜 decode하므로 헤더 흉내로는 통과하지 않는다.
const pngBytes = (w, h, tint = 0) => { const p = new PNG({ width: w, height: h });
  for (let i = 0; i < p.data.length; i += 4) { p.data[i] = tint; p.data[i + 1] = tint; p.data[i + 2] = tint; p.data[i + 3] = 255; }
  return PNG.sync.write(p); };   // createHash는 기존 import 재사용
// SURFACE_NAMES: **현재 target 23개** 이름 exact manifest(순서 포함) — spec과 독립 정의라야
// drift를 잡는다. 현재 계약은 surface 23 / coverage 54 / capture 23이고,
// `s4-shots/base/`의 PNG 24개는 **promotion 전 legacy baseline**이다(현재 target 아님).
// sourcepicker base surface는 canvas로 통합됐다(같은 화면·바이트 동일 PNG였다 — 실측).
// hover/focus/add-menu SourcePicker surface 6개는 서로 다른 상태이므로 유지한다.
const SURFACE_NAMES = ['canvas', 'canvas-toolbar-active', 'canvas-matpill-on',
  'sourcepicker-branch-hover', 'sourcepicker-group-hover', 'sourcepicker-task-hover',
  'sourcepicker-unparticipate-hover', 'sourcepicker-search-focus', 'sourcepicker-addmenu-open',
  'detail', 'detail-originlink-hover', 'detail-trackchip-hover', 'timeline',
  'timeline-lane-hover', 'timeline-lane-selected', 'tree', 'tree-row-hover', 'tree-row-selected',
  'bulkadd', 'createtrack', 'createtrack-visopt-active', 'settings-branches-edit',
  'settings-general-swatch'];

// ─────────────────────────────────────────────────────────────────────────────
// I1(18R) — **CSS 공백 전용 정규화**. CSS 스펙의 whitespace는 정확히 5종(space·tab·LF·FF·CR)이다.
// JS `\s`와 `String#trim()`은 NBSP(U+00A0)·EM SPACE(U+2003)·ZWNBSP(U+FEFF)·vertical tab(U+000B)까지
// 공백으로 취급하는데, 이들은 CSS에서 공백이 **아니다**(앞 셋은 ident 문자, U+000B는 아예 불법 문자).
// 그래서 기존 `/\s+/`·`trim()` 정규화는 브라우저가 "다른 셀렉터" 또는 "무효 선언(계산값 none)"으로
// 보는 입력을 게이트가 **canonical로 고쳐서 통과**시켰다 — 손실 정규화형 false-green.
// 18R 선재현 실측(현행 HEAD): 4종 공백 × (셀렉터 / box-shadow 값 / border 값) = **12/12 false-green**
// (`.X<NBSP>`가 rulesFound=1로 핀에 수집, `inset<NBSP>0 0 0 1px var(…)`가 canonical/visible=true).
// 이후 이 파일의 모든 CSS 텍스트 정규화는 아래 두 헬퍼만 쓴다(JS `\s`·`trim()` 직접 사용 금지).
const CSS_WS_CLASS = ' \\t\\n\\f\\r';
const CSS_WS_RE = new RegExp(`[${CSS_WS_CLASS}]+`, 'g');
const CSS_WS_EDGE_RE = new RegExp(`^[${CSS_WS_CLASS}]+|[${CSS_WS_CLASS}]+$`, 'g');
const cssTrim = (s) => String(s).replace(CSS_WS_EDGE_RE, '');
const normalizeCssWhitespace = (s) => cssTrim(String(s).replace(CSS_WS_RE, ' '));
// "JS는 공백으로 보지만 CSS는 아닌" 코드포인트 — postcss의 `rule.selectors`(list.comma)가 각 파트에
// **JS trim**을 적용하므로 이 문자가 셀렉터 경계에 있으면 우리 손에 닿기 전에 이미 삭제된다(파서
// 레벨 손실 정규화). 따라서 정규화만 고쳐선 부족하고, 이런 코드포인트를 포함한 셀렉터는 매칭
// 후보에서 통째로 배제한다(fail-closed — 실제로 다른 셀렉터를 같은 것으로 오인할 여지를 없앤다).
const JS_ONLY_WS_RE = new RegExp(`[^\\S${CSS_WS_CLASS}]`);
// ─────────────────────────────────────────────────────────────────────────────

// _themes.scss 계약: 컴파일 결과에 flat 블록 3개 —
//   [0] :root(라이트) [1] html[data-theme='dark'](다크) [2] :root(테마불변 별칭)
// [0]/[1]의 --키 집합이 다르면 한쪽 테마에서 반대 테마 값이 상속 누출된다.
const css = compile(resolve(__dirname, '../styles/_themes.scss')).css;
// ⚠️ sass 1.97은 attribute selector의 불필요한 따옴표를 제거한다: html[data-theme=dark]
//    (따옴표 필수 매칭이면 별칭 블록을 dark로 오인 — 리뷰 재현 [52,5]) — unquoted 허용 필수.
// I1(20R) — 토큰 identity 디코딩 단일화. 이전엔 라이트/다크/별칭 키 집합을 이 **raw 정규식**
// (extractTokenKeys)으로 뽑았는데, shape 검사·baseline 추출은 decodeCssIdentifier로 escape를 디코딩해
// 읽어서 **같은 토큰이 두 표현으로 갈렸다**: 별칭 블록의 `-\-color-bg`(실이름 --color-bg)는 raw 텍스트에
// `--`가 연속으로 안 남아 별칭 키에서 빠져 배타성 검사를 통과했다(라이트 재정의 침묵 오염 = false-green).
// 이제 light/dark/aliases는 아래 decodedThemeKeySets(structuralGate 3블록 + buildBlockValues 디코딩)로
// **단일 파생**되고 — shape·대칭·배타성·baseline이 전부 한 키 맵을 공유한다 — extractTokenKeys는 그
// false-green을 대조하는 **선재현 witness 전용**으로만 남는다(파생 경로 아님). 공백은 CSS 5종만 허용한다
// (I1(18R)) — `--color-bg<NBSP>:`는 별개 토큰이라 키에서 빠진다.
function extractTokenKeys(blockBody) {
  return new Set([...String(blockBody).matchAll(new RegExp(`--([a-z0-9-]+)[${CSS_WS_CLASS}]*:`, 'g'))].map((k) => k[1]));
}
// ⚠️ light/dark/aliases 파생은 structuralGate/buildBlockValues 정의 이후로 이동했다(decodedThemeKeySets,
//    아래 buildDarkValues 직후). 이 describe들은 전부 deferred it() 안에서 참조하므로 전방 선언이어도 안전.

describe('_themes.scss 토큰 대칭', () => {
  it('라이트/다크 블록이 존재하고 비어있지 않다', () => {
    expect(light?.size).toBeGreaterThan(30);
    expect(dark?.size).toBeGreaterThan(30);
  });
  it('라이트에만 있는 키가 없다', () => {
    expect([...light].filter((k) => !dark.has(k))).toEqual([]);
  });
  it('다크에만 있는 키가 없다', () => {
    expect([...dark].filter((k) => !light.has(k))).toEqual([]);
  });
});

// setA 원소 중 setB에도 있는 것들 — 별칭·라이트 키 교집합 판정(P1)과 그 synthetic 단위 검증이 공유.
function keyIntersection(setA, setB) {
  return [...setA].filter((k) => setB.has(k));
}

describe('별칭 블록(3번째) 키가 라이트·다크 블록과 배타적이다 (P1 — specificity 재선언 침묵 방지)', () => {
  // 별칭 블록은 라이트와 동일하게 ':root' 단독 셀렉터라 specificity가 같다 — 별칭이 라이트 키를
  // 재선언하면 파일 순서상 후행인 별칭 값이 라이트 실렌더를 조용히 덮어써도 아무 에러도 안 난다.
  // 위 대칭 검사는 라이트/다크만 비교해 이 경로를 못 잡는다 — 내부 리뷰 P1 지적. 별칭 키 집합과
  // 라이트/다크 키 집합의 교집합이 비어 있어야 함을 직접 단정한다(현행 별칭 5토큰 전부 배타 — 즉시 통과).
  // I1(20R): aliases/light/dark가 이제 shape·baseline과 **동일한 디코딩 AST 키 맵**(decodedThemeKeySets)이라
  // escaped 선행하이픈(`-\-color-bg`)이 별칭에서 라이트 토큰을 덮어써도 실이름으로 복원돼 교집합에 잡힌다
  // (아래 'I1(20R)' describe가 선재현↔RED 대조 — 옛 raw 정규식 파생은 이 escape를 놓쳐 통과했다).
  it('별칭 키 ∩ 라이트 키 = ∅', () => {
    expect(keyIntersection(aliases, light)).toEqual([]);
  });
  it('별칭 키 ∩ 다크 키 = ∅', () => {
    expect(keyIntersection(aliases, dark)).toEqual([]);
  });
});

describe('I1(20R) — 토큰 identity 디코딩 단일화 (escaped 별칭 재정의 선재현↔RED)', () => {
  // 선재현(옛 raw 정규식 파생): 별칭 블록의 `-\-color-bg: red`는 실이름 `--color-bg`(라이트 재정의, 별칭이
  // 후행 :root라 동일 specificity에서 침묵 승리)인데, 배타성 검사가 raw 정규식 키(extractTokenKeys)를 봐서
  // 별칭 집합에서 빠졌다 → keyIntersection(aliases, light) === [] → 통과(false-green). shape 검사는 블록
  // 내부 중복만 봐서 못 잡았고, **두 경로가 다른 키 표현**을 봤다. Fix: 디코딩 AST 키 맵(decodedThemeKeySets)
  // 하나를 shape·대칭·배타성·baseline이 공유 → 별칭에 실이름 color-bg가 복원돼 교집합이 비지 않는다(RED).
  const mkThemes = (escapedName) => `
    :root { --color-bg: #FFFFFF; --color-selected-indicator: transparent; --shadow-xs: 0 1px 2px rgba(0,0,0,0.04); }
    html[data-theme=dark] { --color-bg: #0E0F11; --color-selected-indicator: #6B7280; --shadow-xs: 0 1px 2px rgba(0,0,0,0.4); }
    :root { --color-alias-ok: 0; ${escapedName}: red; }
  `;
  // 실이름이 전부 --color-bg로 복원되는 4가지 escape 표현(선행하이픈·선행백슬래시·hex 이중하이픈·hex+리터럴).
  const ESCAPED_BG = ['-\\-color-bg', '\\--color-bg', '\\2d\\2d color-bg', '\\2d-color-bg'];
  it.each(ESCAPED_BG.map((n) => [n, n]))(
    '별칭 %s(실이름 --color-bg) 재정의: 디코딩 AST 키 맵이 라이트와 교집합으로 잡는다(배타성 단정이면 RED)',
    (_l, name) => {
      const { light: L, aliases: A } = decodedThemeKeySets(mkThemes(name));
      expect(A.has('color-bg'), '별칭 디코딩 키에 color-bg 복원').toBe(true);
      expect(keyIntersection(A, L)).toContain('color-bg'); // 실 배타성 단정(∩=∅)이면 RED로 떨어진다
    });
  it('선재현 witness(실경로 재현): 옛 경로 `Sass compile → raw 정규식(extractTokenKeys)`은 컴파일 후에도 `--`가 연속으로 안 남는 escape만 놓쳤다', () => {
    // M2(21R) 정정: 옛 경로는 **컴파일된** CSS에 raw 정규식을 걸었다(미컴파일 문자열이 아니다). Sass가
    // 선행하이픈 escape를 재직렬화하므로 실제 누락 여부는 compileString 출력으로만 판정할 수 있다.
    //   `-\-color-bg`·`-\2d color-bg` → 둘 다 `-\-color-bg`로 직렬화(리터럴 `--` 없음) → 옛 regex 놓침(진짜 구멍)
    //   `\2d\2d color-bg`·`\2d-color-bg` → `\--color-bg`로 직렬화(리터럴 `--color-bg` 포함) → 옛 regex 검출(구멍 아님)
    const compiledKeys = (escapedName) =>
      [...extractTokenKeys(compileString(`:root { --color-alias-ok: 0; ${escapedName}: red; }`).css)];
    // 실제 누락형만 — 컴파일 후 `-\-color-bg`라 옛 regex가 놓친다(이 두 형태가 옛 게이트의 false-green 지점).
    for (const name of ['-\\-color-bg', '-\\2d color-bg']) {
      expect(compiledKeys(name), name).not.toContain('color-bg');
    }
    // 대조: 컴파일 후 리터럴 `--color-bg`/`\--color-bg`가 남는 형태는 옛 regex도 검출했다(구멍 아님) —
    // 이전 witness가 `\2d\2d …`·`\2d-…`를 "누락형"으로 쓴 건 **미컴파일 문자열**에만 성립하던 오재현이었다.
    for (const name of ['\\2d\\2d color-bg', '\\2d-color-bg', '\\--color-bg', '--color-bg']) {
      expect(compiledKeys(name), name).toContain('color-bg');
    }
  });
  it('실 _themes.scss 파생은 디코딩 키 맵으로 배타성을 만족한다(별칭 ∩ 라이트·다크 = ∅)', () => {
    expect(keyIntersection(aliases, light)).toEqual([]);
    expect(keyIntersection(aliases, dark)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I1(21R) — **전체 테마 값 manifest(단일 원천)**. 20R까진 값 계약이 부분 baseline(코어 팔레트 +
// shadow-xs)에 머물러, 라이트·다크 `--track-paper`를 둘 다 `transparent`로 바꿔도 452/452 통과했다
// (외부 검수 격리 실증: track.scss 다수 배경이 소비하는 토큰이 투명해지는 **제품 UI 회귀**를 게이트가
// 놓침 — 게이트 결함이 아니라 진짜 회귀를 놓치는 것이라 실질적으로 중요). 부분 baseline을 증설하는
// 대신, buildBlockValues()가 읽는 **light/dark/alias 전체 토큰의 {key,value}**(컴파일 결과)를 이 상수
// 하나로 고정하고 기존 LIGHT_BASELINE·SHADOW_XS_BASELINE을 이 원천에서 **파생**시켜 중복 리터럴을 없앤다.
//   · 값은 결정적(핀 8곳 고정 컴파일 결과)이라 리터럴 상수로 둔다 — 새 토큰 추가/값 변경 시 이 manifest도
//     갱신해야 아래 무결성 describe가 통과한다(의도된 무결성 잠금). 현행 값 그대로 고정이라 452는 GREEN 유지.
//   · 별칭 블록은 var() 참조값(`var(--color-primary)` 등)이라 리터럴 색이 아니다 — manifest가 그 **참조
//     문자열**을 값으로 고정한다(디코딩 후 — buildBlockValues가 실이름 복원해 읽는다).
//   · 판정은 **값 기준**(컴파일 결과)이지 소스 기준이 아니다: Sass 표현만 바뀌고 컴파일 값이 같으면 GREEN
//     (예: `#{$_l-surface}` vs `#F9FAFB`) — buildBlockValues가 컴파일 출력을 읽으므로 자연 성립(아래 mutation).
// ─────────────────────────────────────────────────────────────────────────────
const THEME_VALUE_MANIFEST = {
  light: {
    'color-home-ink': '#252e4a',
    'color-home-muted': '#66708b',
    'color-home-card': '#f7f8ff',
    'color-home-line': 'rgba(55, 68, 116, .1)',
    'color-home-hover': 'rgba(67, 91, 169, .07)',
    'color-home-accent': '#5268bf',
    'color-home-control': 'rgba(255, 255, 255, .45)',
    'color-home-wallpaper': 'linear-gradient(145deg, #d4dafa 0%, #b9c5fc 42%, #657ed7 100%)',
    'shadow-home-card': '0 9px 28px rgba(37, 50, 113, .09), 0 1px 2px rgba(37, 50, 113, .04)',
    'color-home-icon-ink': '#fff',
    'color-home-icon-indigo': 'linear-gradient(145deg, #7b88ed, #5864c6)',
    'color-home-icon-green': 'linear-gradient(145deg, #66cda3, #289a76)',
    'color-home-icon-blue': 'linear-gradient(145deg, #72b9f4, #448ae0)',
    'color-home-icon-amber': 'linear-gradient(145deg, #edc578, #d89b47)',
    'color-home-backdrop': 'rgba(13, 22, 54, .32)',
    'shadow-home-icon': '0 5px 13px rgba(35, 53, 112, .16), inset 0 1px 0 rgba(255, 255, 255, .3)',
    'shadow-home-remove': '0 2px 7px rgba(14, 25, 70, .18)',
    'shadow-home-drag': '0 18px 24px rgba(19, 28, 67, .25)',
    'shadow-home-catalog': '0 28px 90px rgba(7, 16, 48, .25)',
    'color-bg': '#FFFFFF',
    'color-surface': '#F9FAFB',
    'color-surface-hover': '#F3F4F6',
    'color-primary': '#5E6AD2',
    'color-primary-hover': '#4F5BC0',
    'color-primary-subtle': 'rgba(94, 106, 210, 0.08)',
    'color-text': '#1C1C1C',
    'color-text-secondary': '#6B7280',
    'color-text-tertiary': '#6B7280',
    'color-text-inverse': '#FFFFFF',
    'color-border': '#E5E5E5',
    'color-border-hover': '#D1D5DB',
    'color-input-bg': '#FFFFFF',
    'color-input-border': '#E5E5E5',
    'color-input-border-hover': '#D1D5DB',
    'color-selected-indicator': 'transparent',
    'color-error': '#DC2626',
    'color-error-bg': '#FEF2F2',
    'color-success': '#16A34A',
    'color-success-bg': '#F0FDF4',
    'color-warning': '#D97706',
    'color-warning-bg': '#FFFBEB',
    'color-code-bg': '#F1F3F5',
    'color-code-text': '#EB5757',
    'color-code-block-bg': '#F6F8FA',
    'color-ref-doc': '#C2410C',
    'color-ref-doc-bg': '#FFF7ED',
    'color-ref-issue': '#8B5CF6',
    'color-ref-issue-bg': '#F5F3FF',
    'color-status-in-progress': '#1E40AF',
    'color-status-in-progress-bg': '#DBEAFE',
    'color-primary-strong': 'rgb(70.0844660194, 83.8669902913, 203.3155339806)',
    'color-primary-border-soft': 'rgb(233.5072815534, 235.109223301, 248.9927184466)',
    'color-primary-wash': 'rgb(230.85, 232.65, 248.25)',
    'color-error-strong': 'rgb(187.0333333333, 30.1666666667, 30.1666666667)',
    'color-warning-strong': 'rgb(187.2233183857, 102.6708520179, 5.1766816143)',
    'color-warning-ink': '#B45309',
    'color-warning-ink-deep': '#92400E',
    'color-warning-ink-strong': '#78350F',
    'color-surface-sunken': 'rgb(245.94, 247.45, 248.96)',
    'color-surface-raised': 'rgb(252.06, 252.55, 253.04)',
    'color-surface-overlay': '#FFFFFF',
    'color-bg-sunken': 'rgb(252.45, 252.45, 252.45)',
    'color-text-soft': 'rgb(114.25, 114.25, 114.25)',
    'color-border-faint': 'rgb(236.65, 236.65, 236.65)',
    'color-accent-scrum': '#16A34A',
    'color-accent-scrum-subtle': 'rgb(202.3113513514, 247.8886486486, 219.12)',
    'color-accent-scrum-wash': 'rgb(184.3372972973, 245.4627027027, 206.88)',
    'color-accent-scrum-border': 'rgb(103.4540540541, 234.5459459459, 151.8)',
    'color-accent-scrum-border-soft': 'rgb(148.3891891892, 240.6108108108, 182.4)',
    'color-accent-scrum-ring': 'rgba(22, 163, 74, 0.3)',
    'color-retro-try': '#2563EB',
    'color-retro-try-bg': 'rgb(251.8857142857, 252.7714285714, 254.7142857143)',
    'color-retro-try-border': 'rgb(195.8285714286, 212.6571428571, 249.5714285714)',
    'color-error-border-soft': 'rgb(245.5, 196.1, 196.1)',
    'color-backdrop': 'rgba(28, 28, 28, 0.32)',
    'shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.04)',
    'shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.06)',
    'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.08)',
    'shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.12)',
    'track-paper': '#F9FAFB',
    'track-card': '#FFFFFF',
    'track-paper-edge': '#F3F4F6',
    'track-ink-soft': '#4B5563',
    'track-border-soft': 'rgb(241.75, 241.75, 241.75)',
    'track-paper-raised': 'rgb(252.06, 252.55, 253.04)',
    'track-paper-raised-05': 'rgb(250.53, 251.275, 252.02)',
    'track-paper-sunken-1': 'rgb(245.94, 247.45, 248.96)',
    'track-paper-sunken-15': 'rgb(244.41, 246.175, 247.94)',
    'track-paper-sunken-2': 'rgb(242.88, 244.9, 246.92)',
  },
  dark: {
    'color-home-ink': '#edf0ff',
    'color-home-muted': '#b1bcdb',
    'color-home-card': '#242e4b',
    'color-home-line': 'rgba(210, 220, 255, .12)',
    'color-home-hover': 'rgba(188, 206, 255, .08)',
    'color-home-accent': '#b6c4ff',
    'color-home-control': 'rgba(206, 220, 255, .12)',
    'color-home-wallpaper': 'linear-gradient(145deg, #374777 0%, #293768 42%, #112253 100%)',
    'shadow-home-card': '0 9px 30px rgba(4, 9, 30, .15), 0 1px 2px rgba(0, 0, 0, .08)',
    'color-home-icon-ink': '#fff',
    'color-home-icon-indigo': 'linear-gradient(145deg, #7b88ed, #5864c6)',
    'color-home-icon-green': 'linear-gradient(145deg, #66cda3, #289a76)',
    'color-home-icon-blue': 'linear-gradient(145deg, #72b9f4, #448ae0)',
    'color-home-icon-amber': 'linear-gradient(145deg, #edc578, #d89b47)',
    'color-home-backdrop': 'rgba(13, 22, 54, .32)',
    'shadow-home-icon': '0 5px 13px rgba(35, 53, 112, .16), inset 0 1px 0 rgba(255, 255, 255, .3)',
    'shadow-home-remove': '0 2px 7px rgba(14, 25, 70, .18)',
    'shadow-home-drag': '0 18px 24px rgba(19, 28, 67, .25)',
    'shadow-home-catalog': '0 28px 90px rgba(7, 16, 48, .25)',
    'color-bg': '#0E0F11',
    'color-surface': '#17181C',
    'color-surface-hover': '#1E2025',
    'color-primary': '#7C8AEA',
    'color-primary-hover': '#8B98F0',
    'color-primary-subtle': 'rgba(124, 138, 234, 0.08)',
    'color-text': '#E6E8EB',
    'color-text-secondary': '#9CA3AF',
    'color-text-tertiary': '#828A99',
    'color-text-inverse': '#0E0F11',
    'color-border': '#26282E',
    'color-border-hover': '#33363E',
    'color-input-bg': '#17181C',
    'color-input-border': '#6B7280',
    'color-input-border-hover': '#7A8290',
    'color-selected-indicator': '#6B7280',
    'color-error': '#F0666B',
    'color-error-bg': '#2A1518',
    'color-success': '#4CC38A',
    'color-success-bg': '#12281C',
    'color-warning': '#E5A54B',
    'color-warning-bg': '#2A2110',
    'color-code-bg': '#1E2126',
    'color-code-text': '#F07178',
    'color-code-block-bg': '#14161A',
    'color-ref-doc': '#E8845A',
    'color-ref-doc-bg': '#2A1D12',
    'color-ref-issue': '#A78BFA',
    'color-ref-issue-bg': '#201A2E',
    'color-status-in-progress': '#7EA6F4',
    'color-status-in-progress-bg': '#14213B',
    'color-primary-strong': '#6D7BE0',
    'color-primary-border-soft': '#3A4160',
    'color-primary-wash': '#1E2340',
    'color-error-strong': '#E0575C',
    'color-warning-strong': '#D19335',
    'color-warning-ink': '#E5A54B',
    'color-warning-ink-deep': '#EDBB72',
    'color-warning-ink-strong': '#F3CD94',
    'color-surface-sunken': '#131418',
    'color-surface-raised': '#1B1D22',
    'color-surface-overlay': '#1B1D22',
    'color-bg-sunken': '#0B0C0E',
    'color-text-soft': '#8B93A1',
    'color-border-faint': '#2C2E35',
    'color-accent-scrum': '#4CC38A',
    'color-accent-scrum-subtle': '#12281C',
    'color-accent-scrum-wash': '#173524',
    'color-accent-scrum-border': '#3E7A5C',
    'color-accent-scrum-border-soft': '#2E5240',
    'color-accent-scrum-ring': 'rgba(76, 195, 138, 0.55)',
    'color-retro-try': '#7EA6F4',
    'color-retro-try-bg': '#14213B',
    'color-retro-try-border': '#34496E',
    'color-error-border-soft': '#A05259',
    'color-backdrop': 'rgba(0, 0, 0, 0.5)',
    'shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.4)',
    'shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.5)',
    'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.55)',
    'shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.65)',
    'track-paper': '#17181C',
    'track-card': '#1B1D22',
    'track-paper-edge': '#1E2025',
    'track-ink-soft': '#A8B0BC',
    'track-border-soft': '#2C2E35',
    'track-paper-raised': '#1B1D22',
    'track-paper-raised-05': '#191B1F',
    'track-paper-sunken-1': '#141518',
    'track-paper-sunken-15': '#121316',
    'track-paper-sunken-2': '#101114',
  },
  aliases: {
    'color-border-focus': 'var(--color-primary)',
    'shadow-focus': '0 0 0 3px var(--color-primary-subtle)',
    'track-ink': 'var(--color-text)',
    'track-ink-mute': 'var(--color-text-tertiary)',
    'track-border': 'var(--color-border)',
  },
};

// 라이트 무변화(핵심 수용 기준)의 코어 팔레트 뷰 — **manifest의 부분집합**(중복 리터럴 제거, 값은 위
// 단일 원천에서 파생). 파생 rgb() 토큰 앞의 원본 리터럴 팔레트만 골라 코어 팔레트 오타에 집중된 신호를
// 유지한다(전체 값 고정은 아래 '전체 테마 값 manifest' describe가 담당).
const LIGHT_BASELINE_KEYS = [
  'color-bg', 'color-surface', 'color-surface-hover',
  'color-primary', 'color-primary-hover', 'color-primary-subtle',
  'color-text', 'color-text-secondary', 'color-text-tertiary', 'color-text-inverse',
  'color-border', 'color-border-hover',
  'color-input-bg', 'color-input-border', 'color-input-border-hover',
  'color-selected-indicator',
  'color-error', 'color-error-bg', 'color-success', 'color-success-bg',
  'color-warning', 'color-warning-bg',
  'color-code-bg', 'color-code-text', 'color-code-block-bg',
  'color-ref-doc', 'color-ref-doc-bg', 'color-ref-issue', 'color-ref-issue-bg',
  'color-status-in-progress', 'color-status-in-progress-bg',
];
const LIGHT_BASELINE = Object.fromEntries(
  LIGHT_BASELINE_KEYS.map((k) => [k, THEME_VALUE_MANIFEST.light[k]]),
);

describe('라이트 값 무변화 — 컴파일된 :root 값이 현행 팔레트와 동일', () => {
  it('코어 30토큰 값 일치', () => {
    // I1(19R): 이전엔 raw css 정규식 + Object.fromEntries(후행 승리)로 읽어 라이트 블록의 중복·!important를
    // 못 봤다(cascade winner 미반영). 이제 shape contract가 강제된 buildLightValues(유일 선언 AST 값)로 읽는다.
    const values = buildLightValues(css);
    for (const [k, v] of Object.entries(LIGHT_BASELINE)) {
      expect(values[k], `--${k}`).toBe(v);
    }
  });
});

describe('브리지 커버리지 — _variables.scss가 참조하는 var는 전부 정의돼 있어야 한다', () => {
  // Task 5 플립 전에는 참조 0개라 공허 통과, 플립 후부터 실효.
  // _variables에 토큰이 추가되는데 _themes에 빠지면(예: warning-bg 사후 추가) 여기서 잡힌다.
  it('미정의 참조 없음', () => {
    const bridge = readFileSync(resolve(__dirname, '../styles/_variables.scss'), 'utf8');
    const refs = [...bridge.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]);
    const defined = new Set([...light, ...aliases]);
    expect([...new Set(refs)].filter((r) => !defined.has(r))).toEqual([]);
  });
});

describe('브리지 완전성 — 모든 $color-*/$shadow-* 선언이 동일명 var()여야 한다', () => {
  // 새 토큰이 리터럴로 추가되면(브리지 우회) 여기서 잡힌다 — warning-bg 사후 추가 재발 방지.
  it('리터럴 잔존 없음', () => {
    const bridge = readFileSync(resolve(__dirname, '../styles/_variables.scss'), 'utf8');
    // I1(18R): 값 비교 trim도 CSS 공백 전용 — `var(--color-x)<NBSP>`는 Sass가 NBSP를 포함한 별개
    // 문자열로 내보내 브리지가 조용히 깨지는데 JS trim은 정상으로 둔갑시켰다(같은 손실 정규화 클래스).
    const decls = [...bridge.matchAll(new RegExp(`^\\$((?:color|shadow)-[a-z0-9-]+)[${CSS_WS_CLASS}]*:[${CSS_WS_CLASS}]*([^;]+);`, 'gm'))];
    expect(decls.length).toBeGreaterThan(30);
    const bad = decls.filter((m) => cssTrim(m[2]) !== `var(--${m[1]})`)
      .map((m) => `${m[1]} = ${cssTrim(m[2])}`);
    expect(bad).toEqual([]);
  });
});

describe('사이트 SCSS의 sass 색함수 $변수 입력 금지 (컴파일 의존 재유입 차단)', () => {
  it('rgba($…)/color.adjust($…)/color.scale($…) 잔존 없음', () => {
    const stylesDir = resolve(__dirname, '../styles');
    const files = readdirSync(stylesDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.scss') && !f.endsWith('_themes.scss'));
    const offenders = [];
    for (const f of files) {
      readFileSync(resolve(stylesDir, f), 'utf8').split('\n').forEach((line, i) => {
        const code = line.split('//')[0]; // 주석 제외
        if (/(?:rgba|color\.adjust|color\.scale)\(\s*\$/.test(code)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('전 SCSS var(--…) 참조 커버리지', () => {
  // 테마 정의 ∪ 불변 별칭 ∪ 런타임 JS 주입 ∪ S5 이행 예정(context-menu 폴백 소비)만 허용.
  // --chip-color: TaskFilterBar 활성 필터 칩이 자기 색(원시 hex 또는 var(--color-*) 토큰)을 SCSS로
  //   넘기는 통로. JS 인라인 style(library/themePalette.js chipTintStyle)이 주입하고 taskList.scss
  //   `.TaskFilterBar__ActiveChip--tinted`가 color-mix로 소비한다 — 보호 접두가 아니라 선언 금지와 무관.
  // --et-*-dark 4개(S7 저장색): producer는 library/entityTint.js가 React 인라인 style로 내리는
  //   저장색 다크 값이고, consumer는 styles/components/common/storedColor.scss의 .Entity* 다크 규칙이다.
  //   _themes.scss 전역 토큰이 아니라 요소별 런타임 값이라 여기 등록한다(영구 — PENDING 아님).
  //   --et-fg-dark만 .EntityTint·.EntityInk 두 규칙에서 소비되므로 SCSS 참조는 5건, 고유 이름은 4개다.
  // --et-bg/-fg + --et-*-raised 6개(S7 raised 축): 같은 배지가 행 상태마다 다른 부모 위에 놓이는
  //   TaskListRow(selected·subtask) 때문에 산출을 두 벌 내리고 SCSS가 상태로 고른다.
  //   raised 변수가 없는 배지에서 무효 선언이 되지 않게 폴백으로 --et-bg/--et-fg를 쓰므로
  //   그 둘도 SCSS 참조가 생겼다. 셋 다 producer는 library/entityTint.js 인라인 style이다.
  const RUNTIME_INJECTED = [
    'branch-color', 'status-color', 'accent', 'sticky-header-h', 'chip-color',
    'et-bg-dark', 'et-fg-dark', 'et-bd-dark', 'et-solid-dark',
    'et-bg', 'et-fg',
    'et-bg-raised', 'et-fg-raised', 'et-bg-raised-dark', 'et-fg-raised-dark',
  ];
  // 예외는 경로+개수까지 고정 — 번지거나 늘어나면 즉시 검출, 이관(S4/S5)하면 목록·개수 갱신 신호.
  // S4 stage 3에서 track.scss 6건 이관 완료 — 미정의 var(--text-secondary/--text-tertiary)라
  //   폴백만 렌더되고 테마를 따라가지 않던 죽은 참조였고, 정의된 --color-text-* 토큰으로 교체했다.
  //   라이트 영향은 두 갈래다: tertiary 5건은 폴백 #9ca3af → --color-text-tertiary #6B7280 로
  //   **색이 바뀌는 교정**(allow #13~#17), secondary 1건(구 1207행)은 폴백이 이미 #6b7280이라
  //   **라이트 동치**이고 다크 추종만 복구된다. 사이트별 판정은 s4Spec CONVERSIONS에 있다.
  // S5 완료: context-menu.scss의 미정의 var 폴백 소비 2건을 정의 토큰으로 이행했다.
  const PENDING = {};
  it('미정의 var 참조 없음 (예외는 경로·개수 고정)', () => {
    const stylesDir = resolve(__dirname, '../styles');
    const defined = new Set([...light, ...aliases, ...RUNTIME_INJECTED]);
    const offenders = [];
    const seen = {}; // 예외 사용 실측 tally
    for (const f of readdirSync(stylesDir, { recursive: true }).map(String)
        .filter((f) => f.endsWith('.scss') && !f.endsWith('_themes.scss'))) {
      const src = readFileSync(resolve(stylesDir, f), 'utf8');
      const pendingFile = Object.keys(PENDING).find((sfx) => f.endsWith(sfx));
      for (const m of src.matchAll(/var\(--([a-z0-9-]+)/g)) {
        if (defined.has(m[1])) continue;
        if (pendingFile && PENDING[pendingFile][m[1]] != null) {
          seen[pendingFile] = seen[pendingFile] || {};
          seen[pendingFile][m[1]] = (seen[pendingFile][m[1]] || 0) + 1;
          continue;
        }
        offenders.push(`${f}: --${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(seen).toEqual(PENDING); // 개수가 줄어도(이관 완료) 알림 — 목록 갱신
  });
});

describe('AvatarStack__More는 text-secondary 단독을 쓰지 않는다 (S5 대비 회귀 차단)', () => {
  // 11px로 숨은 멤버 수(+N)를 전달하는 본문 텍스트다. var(--color-text-secondary) 단독이면
  // 라이트 computed가 #6B7280 on #F3F4F6 = 4.39로 4.5:1에 미달한다(실브라우저 실측).
  it('color가 text 쪽으로 보정된 color-mix다', () => {
    const src = readFileSync(resolve(__dirname, '../styles/components/common/avatar.scss'), 'utf8');
    const block = src.slice(src.indexOf('&__More'));
    const decl = block.match(new RegExp(`^[${CSS_WS_CLASS}]*color:[${CSS_WS_CLASS}]*([^;]+);`, 'm'));
    expect(decl, '.AvatarStack__More에 color 선언이 없다').toBeTruthy();
    expect(cssTrim(decl[1])).toBe('color-mix(in srgb, var(--color-text-secondary) 90%, var(--color-text))');
  });
});

describe('track 로컬 별칭 완전성 — $track-x는 동일명 var(--track-x)', () => {
  it('별칭 잔존/오기 없음', () => {
    const src = readFileSync(resolve(__dirname, '../styles/components/track/track.scss'), 'utf8');
    const decls = [...src.matchAll(new RegExp(`^\\$track-([a-z0-9-]+)[${CSS_WS_CLASS}]*:[${CSS_WS_CLASS}]*([^;]+);`, 'gm'))];
    expect(decls.length).toBe(7);
    const bad = decls.filter((m) => cssTrim(m[2]) !== `var(--track-${m[1]})`); // I1: CSS 공백 전용 trim
    expect(bad.map((m) => `track-${m[1]} = ${cssTrim(m[2])}`)).toEqual([]);
  });
});

const scssCompileCache = new Map();
function compiledSiteCss(relPath) {
  if (!scssCompileCache.has(relPath)) {
    scssCompileCache.set(relPath, compile(resolve(__dirname, '../styles', relPath)).css);
  }
  return scssCompileCache.get(relPath);
}

// postcss Rule#selectors(list.comma 기반)로 "최상위 콤마"만 분리한다. 이전 selector.split(',')는
// 무조건 모든 콤마를 끊어 `:is(.Decoy, .Target, .Other):hover`처럼 함수형 의사클래스 **안쪽**
// 콤마까지 쪼갰다 — 그러면 ".Target" 파트가 진짜 타겟과 완전 동일 문자열로 오매치된다(외부 검수
// 실증, o시나리오: 실제로는 :is(...):hover 전체가 하나의 셀렉터라 진짜 타겟과 다름). rule.selectors는
// postcss 자체 셀렉터 리스트 파서라 괄호 안 콤마를 보존해 이 오매치를 구조적으로 막는다.
// 각 파트는 공백 정규화 후 완전 동일 문자열로만 비교한다 — 부분/접두 매칭·의사클래스 연속
// (`:hover` 등)·자손 결합자 전부 불허(`SELECTOR:hover` != `SELECTOR`).
// I1(18R) — 공백 정규화를 CSS 공백 5종 전용으로 교체하고, 그 위에 파서-레벨 손실까지 막는 가드를 둔다.
// postcss `rule.selectors`는 내부적으로 각 콤마 파트에 **JS trim**을 걸어 NBSP/EM SPACE/ZWNBSP/VT를
// 경계에서 지운다 — 즉 `.X<NBSP>`가 `.X`로 도착한다. 정규화 함수만 고쳐도 이 손실은 남으므로,
// 셀렉터 원문에 CSS-비공백 JS-공백 코드포인트가 하나라도 있으면 매칭 자체를 거부한다(fail-closed).
function selectorMatches(rule, targetSelectors) {
  if (JS_ONLY_WS_RE.test(rule.selector)) return false;
  const targets = new Set(Array.isArray(targetSelectors) ? targetSelectors : [targetSelectors]);
  return rule.selectors.some((part) => targets.has(normalizeCssWhitespace(part)));
}

// target 셀렉터를 가진 "root 직속" 규칙만 postcss AST로 찾는다. rule.parent.type이 'root'가
// 아니면(즉 @media/@supports 등 안쪽이면) 애초에 후보에서 제외 — 외부 검수가 실증한 "@media 안
// 두 번째 이후 규칙이 최상위처럼 추출됨" 구멍을 이 한 줄이 구조적으로 닫는다. 매치가 0건이면
// "셀렉터 자체가 사라짐(@media 이동 포함)"과 "선언 불일치"를 구분해 호출부가 각각 다르게 보고한다.
// 동일 셀렉터로 반복되는 규칙(예: 승격핀 뒤에 다시 나오는 override 블록)은 전부 배열에 담아
// 반환한다 — 최종 유효값 판정(effectiveValue)이 문서 순서 그대로 cascade를 재현하려면 규칙
// 하나만 골라선 안 되고 매치되는 규칙 전부가 필요하다.
function findRootRules(root, targetSelectors) {
  const rules = [];
  root.walkRules((rule) => {
    if (rule.parent.type === 'root' && selectorMatches(rule, targetSelectors)) rules.push(rule);
  });
  return rules;
}

// 일치 규칙들(문서 순서)을 walkDecls로 훑어 prop별 "최종 유효 선언 하나"를 CSS cascade 규칙대로
// 합성하는 공용 리듀서. !important는 non-important를 무조건 이기고, 같은 중요도끼리는 후행이 이긴다
// (custom property도 일반 프로퍼티와 동일한 cascade 규칙을 따른다 — `--x: A !important; --x: B;`의
// 계산값은 여전히 A. 외부 검수 7라운드째 실증: darkValues가 이 규칙 없이 "무조건 후행 승리"만 쓰던
// 시절엔 `--color-selected-indicator: rgba(107,114,128,0) !important;` 뒤에 `#6B7280;`이 오는
// 케이스에서 브라우저는 투명인데 테스트는 #6B7280을 읽어 false-green을 냈다). predicate로 대상
// decl만 골라 effectiveValue(prop 화이트리스트)와 darkValues 수집(전체 --커스텀 프로퍼티) 양쪽이
// 이 로직을 공유한다 — 로직 중복·drift 방지. 반환값은 `{ [prop]: { value, important } }`.
//
// prop 정규화(Minor 2, 8라운드 외부 검수 실증) — 표준 CSS 프로퍼티명은 스펙상 ASCII
// case-insensitive라 `BORDER: none;` 뒤에 오는 `border: 1px solid red;`는 같은 프로퍼티의 후행
// 재정의여야 한다. 정규화 없이 decl.prop을 그대로 키로 쓰면 대소문자만 다른 두 선언이 서로 다른
// state 엔트리로 남아 override를 놓친다. 커스텀 프로퍼티(`--`로 시작)는 스펙상 case-sensitive이므로
// 그대로 보존한다(`--Foo`와 `--foo`는 별개 토큰). predicate는 (decl, normalizedProp) 둘 다 받는다 —
// 화이트리스트 비교(effectiveValue)도 정규화된 prop 기준이어야 대소문자 변형을 놓치지 않는다.
// 12R F5(내부 리뷰 실증, 12라운드 리뷰 실증분) — decodeCssIdentifier를 먼저 통과시킨 뒤 기존 로직을
// 적용한다. 이전엔 원문 decl.prop을 그대로 판정해 escaped 선언(`\--color-x`, `\42order` 등)이 cascade
// predicate·state 키·BORDER_PROP_RE 매칭에서 전부 미매치로 실종됐다(hasProtectedPrefix만 자체
// 디코딩해 이 구멍 밖이었다). decodeCssIdentifier는 이 파일 내 유일한 decode 지점으로 normalizeProp
// 진입부에 단일화돼 있다 — hasProtectedPrefix는 별도 입력(raw decl.prop)에 독립 호출하므로 이중
// 디코딩 경로가 아니다(멱등성은 아래 12R F5 synthetic이 직접 단정).
function normalizeProp(prop) {
  const decoded = decodeCssIdentifier(prop);
  return decoded.startsWith('--') ? decoded : decoded.toLowerCase();
}
function reduceEffectiveDecls(rules, predicate) {
  const state = {};
  rules.forEach((rule) => {
    rule.walkDecls((decl) => {
      const prop = normalizeProp(decl.prop);
      if (!predicate(decl, prop)) return;
      const cur = state[prop];
      if (cur && cur.important && !decl.important) return; // important가 후행 non-important를 이김
      // I1(18R): JS trim은 NBSP 등 CSS ident 문자를 값 경계에서 지워 `#6B7280<NBSP>`(브라우저에선
      // 무효 → 토큰 미적용)를 정상 hex로 둔갑시켰다 — CSS 공백 전용 trim으로 교체(fail-closed).
      state[prop] = { value: cssTrim(decl.value), important: !!decl.important };
    });
  });
  return state;
}

// 이전의 "일치 규칙 전체를 some()으로 훑어 하나라도 있으면 통과"식 판정은 뒤에 오는 override(승격핀
// 뒤 동일 selector의 `border: none`, indicator핀 뒤 `box-shadow: none` 등)를 놓치고 stale 값으로
// GREEN 처리했다(외부 검수 실증, l시나리오). 호출부는 "최종값 하나"만 검사해야 하며(some() 폐기),
// 여기 없는 prop은 그 selector 조합에서 한 번도 선언되지 않았다는 뜻이다.
function effectiveValue(rules, props) {
  return reduceEffectiveDecls(rules, (decl, prop) => props.has(prop));
}

// ─────────────────────────────────────────────────────────────────────────────
// 17R 아키텍처 전환 — **브라우저 시뮬레이터 → canonical 구조 게이트**(2층)
//
// 왜 전환하는가(외부 검수 진단, 전면 수용): 16라운드까지 이 파일은 CSS value grammar·deferred
// validation·shorthand cascade·!important·invalid-declaration fallback을 **자체 구현**하고 그 모델을
// **정답 판정기(oracle)** 로 삼았다. 그래서 모델이 틀려도 319개가 서로 일관되게 GREEN이 될 수 있었다 —
// 매 라운드 새 false-green이 나온 진짜 원인이다(env(--x)·if()·hypot·-webkit-link·RGB(1 2 3 4)·
// RGB(foo(1) 2 3)·color-mix 구분자 오용 전부 우회 실증). 15·16R의 "근본 대책"(whitelist 반전·fuzz)도
// 같은 모델 **안에서의** 반전이라 같은 방식으로 뚫렸다.
//
// 결론: 게이트가 브라우저를 흉내 내는 일을 중단한다.
//   · 층 1(구조 게이트) — PINNED selector의 **relevant 선언**(border 계열·border-image 계열·box-shadow·
//     all)은 **CANONICAL_DECLS와 구조적으로 정확히 일치할 때만** 통과한다. 그 외 모든 형태는 유효/무효/
//     미지를 **추론하지 않고 무조건 RED**. `env(--x)`든 `hypot()`든 `RGB(1 2 3 4)`든 canonical이 아니면
//     RED — 이 층에는 CSS 유효성 판단 코드 경로가 **존재하지 않는다**.
//   · 층 2(제한 evaluator) — 층 1을 통과한 canonical 선언 + CSS-wide 키워드(initial/unset/inherit/
//     revert/revert-layer)·`all`만 계산한다. **무효 CSS를 폐기하고 이전 핀을 살리는 fallback 동작은
//     제거**했다(정적 회귀 게이트에서 non-canonical CSS는 그 자체로 실패다) — "이전 유효 선언 부활"
//     클래스가 소멸한다.
//
// 결과(문구 축소, 18R): 이 게이트가 보장하는 것은 **"exact selector + 정적 styles 인벤토리 범위
// 내에서" canonical 외 전부 RED로 수렴한다**는 것뿐이다. 17R 주석의 "false-green이 원리적으로
// 불가능"은 과대 주장이었다 — 18R 선재현이 그 주석 아래에서 손실 정규화(I1)·과대 허용(I2)·이름
// 비대칭(I3)·inventory 누락(I4) 네 부류의 false-green을 실측했다. **범위 밖 = 명시 예외**이며
// 전수는 아래 "명시 예외 전수" describe가 단정과 함께 고정한다:
//   ① 셀렉터 동치성(`.a.b` 대 `.b.a`, `:is()` 표기 변형) — selector 의미론 모델 없음
//   ② 타 셀렉터·타 파일에서 오는 cascade(더 높은 specificity의 override)
//   ③ 로컬 custom property 재정의 — 핀 게이트 단독으론 GREEN, P4 보호 네임스페이스 스윕과의 **합성**에 의존
//   ④ JS 런타임 `CSS.registerProperty()` — 정적 styles 인벤토리 밖(@property at-rule은 I4로 폐쇄됨)
// false-RED는 늘지만 회귀 게이트로선 올바른 방향이다 — 실제 코드가 canonical을 벗어나면 개발자가
// 알아야 한다. 수렴 선언은 하지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

// 층 1 원자 — 전부 "정확한 리터럴 형태"만 인정하는 anchored whitelist. 부분 매칭·문자열 분해가 없으므로
// (전체 값 하나를 anchored 정규식으로 판정) 토크나이저 재구현이 필요 없고 우회할 틈도 없다.
//   · 길이: `0`(단위 없는 0) 또는 소수 포함 양수 + px|rem|em. 핀 실측은 `0`과 `1px`뿐 — 그 밖의 단위
//     (lh·dvw·cqw…)·부호·계산식(calc/min/clamp)·백분율은 전부 **비-canonical(RED)** 이다.
//   · 토큰 참조: 정확히 `var(--name)`. fallback(`var(--x, #ccc)`)·대문자 `VAR()`·escape·내부 공백은
//     전부 비-canonical(RED) — 값 쪽 escape 디코더·<dashed-ident> 모델이 통째로 불필요해진다.
//   · 스타일: 가시 border-style 키워드만. `none`/`hidden`은 의도적으로 canonical 밖(RED)이다.
const CANON_VISIBLE_BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'];
const CANON_LEN_SRC = '(?:0|[0-9]+(?:\\.[0-9]+)?(?:px|rem|em))';
const CANON_STYLE_SRC = `(?:${CANON_VISIBLE_BORDER_STYLES.join('|')})`;
// **needle 파서 전용** 매처(판정기 아님) — PINNED 표의 `needle: 'var(--token)'` 문자열에서 토큰 이름을
// 뽑는 데만 쓴다. 선언 값이 canonical인지 여부는 오직 CANONICAL_DECLS.re가 결정한다.
const CANON_VAR_REF_RE = /^var\(--([a-z0-9-]+)\)$/;

// ─── I2(18R) — box-shadow canonical을 **실측 전체 문자열**로 좁힌다 ─────────────────────────────
// 이전 형태는 opaque layer를 `var(--<아무 이름>)`으로, 전체 값을 "canonical 레이어의 임의 콤마 나열"로
// 허용하고, 최종 판정은 "기대 inset layer 하나 존재"만 봤다. 그 결과 참조 토큰의 **의미가 전혀
// 검증되지 않았다**(선재현 실측, 현행 HEAD):
//   · `var(--does-not-exist), inset 0 0 0 1px var(--color-selected-indicator)` → visible=true
//     (브라우저는 첫 레이어가 무효라 **선언 전체를 폐기** — 실렌더 box-shadow: none)
//   · `var(--shadow-md), inset …` → visible=true (핀이 쓰지 않는 토큰인데 통과)
//   · `_themes.scss`에서 `--shadow-xs: none`으로 바꾸면 실 CSS가 `none, inset …` = **계산값 none**인데
//     선언 문자열은 그대로라 296/296 GREEN
// 처방은 문법 모델 추가가 **아니라** 실측값으로 좁히기다. 넓은 패턴을 하나라도 남기면 whitelist가
// 다시 작은 CSS 문법이 되고, 그 문법의 오차가 곧 다음 라운드의 false-green이 된다.
//   · 허용 opaque layer: 정확히 `var(--shadow-xs)` 하나
//   · 허용 indicator layer: 정확히 `inset 0 0 0 1px var(--color-selected-indicator)` 하나
//   · 허용 전체 값: 위 두 레이어로 만들어지는 **실핀 2가지 전체 문자열**뿐(레이어 조합·순서 포함)
// `var(--shadow-xs)`가 opaque layer로 성립한다는 전제(=완전 그림자로 확장되는 유효 값)는 아래
// "--shadow-xs exact baseline" describe가 라이트·다크 값 자체를 고정해 지킨다 — 토큰 값이 `none`
// 이나 무효 값으로 바뀌면 그 describe가 RED가 된다.
const CANON_SHADOW_OPAQUE_LAYER = 'var(--shadow-xs)';
const CANON_SHADOW_INDICATOR_LAYER = 'inset 0 0 0 1px var(--color-selected-indicator)';
const CANON_SHADOW_VALUES = [
  CANON_SHADOW_INDICATOR_LAYER,                                          // .MyTasks__ScopeBtn--active
  `${CANON_SHADOW_OPAQUE_LAYER}, ${CANON_SHADOW_INDICATOR_LAYER}`,       // .HomeTabs__Tab.is-on
];
// 실측 값에 대응하는 레이어 모델(층 2 가시성 계산 입력). 상수이므로 매번 사본을 낸다.
const SHADOW_OPAQUE_LAYER_MODEL = () => ({ kind: 'opaque-var', token: 'shadow-xs' });
const SHADOW_INDICATOR_LAYER_MODEL = () =>
  ({ kind: 'inset', offsetX: 0, offsetY: 0, blur: 0, spread: 1, token: 'color-selected-indicator' });
// 리터럴 전체 문자열 → anchored exact 정규식(정규식 메타문자 이스케이프). 패턴 확장 여지 0.
const exactValueRe = (literal) => new RegExp(`^${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

// CANONICAL_DECLS — **핀 8곳의 실제 컴파일 값에서 도출**한 canonical 형태 집합이자 층 1의 **유일한
// 판정 테이블**이다. M1(18R): 이전엔 classifyRelevantDecl()이 이 배열을 조회하지 않고 별도 regex를
// 썼기 때문에 entry의 prop/re를 망가뜨려도 결과가 그대로였다 — 즉 "single source"라는 주석이 사실이
// 아니었다. 이제 classifier가 이 배열을 직접 dispatch한다(아래 mutation 테스트가 그 단일화를 증명).
// 각 항목의 `pins`가 도출 근거이고, 아래 "CANONICAL_DECLS 도출 근거 고정" describe가 실파일로 재검증한다.
// 여기 없는 형태는 전부 비-canonical이며 게이트는 그 유효성을 **판단하지 않는다**.
const CANONICAL_DECLS = [
  {
    id: 'border-shorthand',
    level: 'value', // 선언 값 전체가 이 형태여야 한다
    prop: 'border',
    form: 'border: <length> <visible-style> var(--<token>)',
    re: new RegExp(`^(${CANON_LEN_SRC}) (${CANON_STYLE_SRC}) var\\(--([a-z0-9-]+)\\)$`),
    build: (m) => ({ form: 'border', border: { width: parseFloat(m[1]), style: m[2], token: m[3] } }),
    // 근거(실측 컴파일 값, 전부 `1px solid var(--color-input-border)`). 색 자리 토큰은 층 2가
    // contract.token과 대조하므로(=핀별 기대 토큰) 임의 토큰이 통과하지 않는다.
    pins: ['.CanvasEditor', '.CanvasEditorToolbar__ColorSwatch', '.FilterBuilder__OpToggle',
      '.MyTasks__ScopeToggle', '.HomeTabs', '.BrowseBranches__JoinBtn--joined'],
  },
  {
    id: 'box-shadow-indicator-only',
    level: 'value',
    prop: 'box-shadow',
    form: CANON_SHADOW_VALUES[0], // 실측 전체 문자열(패턴 아님)
    re: exactValueRe(CANON_SHADOW_VALUES[0]),
    build: () => ({ form: 'box-shadow', layers: [SHADOW_INDICATOR_LAYER_MODEL()] }),
    pins: ['.MyTasks__ScopeBtn--active'],
  },
  {
    id: 'box-shadow-opaque-then-indicator',
    level: 'value',
    prop: 'box-shadow',
    form: CANON_SHADOW_VALUES[1], // 실측 전체 문자열(레이어 조합·순서 포함)
    re: exactValueRe(CANON_SHADOW_VALUES[1]),
    build: () => ({ form: 'box-shadow', layers: [SHADOW_OPAQUE_LAYER_MODEL(), SHADOW_INDICATOR_LAYER_MODEL()] }),
    pins: ['.HomeTabs__Tab.is-on'],
  },
];

// CSS-wide 키워드 — 층 2가 계산하는 유일한 non-canonical-form 입력. 정확히 소문자 단독일 때만 인정한다
// (명시 예외: `INITIAL` 같은 대문자 변형은 스펙상 유효하지만 여기선 비-canonical=RED로 fail-closed).
const CANON_CSS_WIDE_RE = /^(?:initial|inherit|unset|revert|revert-layer)$/;
const MODELED_RESET_KEYWORDS = new Set(['initial', 'unset']); // 비상속 속성이라 두 키워드는 동치
const BORDER_IMAGE_PROP_RE = /^border-image(?:-(?:source|slice|width|outset|repeat))?$/;

// relevant 선언 판정 — **프로퍼티 이름만** 본다(값 유효성 추론 없음). border로 시작하는 프로퍼티는
// 경계 무관이 확실한 것(radius/collapse/spacing)만 제외하고 전부 relevant다 — 논리 프로퍼티
// (border-inline-*/border-block-*)·border-image 계열·미지의 `border-*` 신설 프로퍼티까지 자동으로
// relevant에 들어와 canonical이 아니면 RED가 된다(15R "논리 프로퍼티 fail-closed" 계약의 일반화).
//
// 벤더 프리픽스 정규화(내부 리뷰 실증, 17R 이후) — 진입부에서 먼저 `-webkit-`/`-moz-`/`-ms-`/`-o-` 등
// (`/^-[a-z]+-/`)을 벗긴 뒤 판정한다. 벗기기 전엔 `-webkit-border-image`/`-webkit-box-shadow` 같은
// alias가 `prop.startsWith('border')`/`=== 'box-shadow'`에 안 걸려 relevant 밖으로 새 나갔다 —
// **층 1 자체가 무력화되는 수집 누락**(선언을 relevant로 못 보면 canonical 판정이 실행되지 않아
// 항상 GREEN). 커스텀 프로퍼티(`--foo`)는 두 번째 문자가 `-`라 `/^-[a-z]+-/`에 애초에 안 걸려 안전
// (deprefix 무영향). 호출부는 normalizeProp(decode → lowercase)을 먼저 거친 prop을 넘기므로 파이프라인
// 순서는 decode → lowercase → deprefix. 15R의 동명 아이디어(함수명용 VENDOR_PREFIX_RE/unprefixedFn,
// <image> 문법 판정용)가 17R 삭제분에 함께 사라졌던 것과 별개로, 여기는 **프로퍼티 이름**용이다.
const IRRELEVANT_BORDER_PROP_RE = /^border-(?:collapse|spacing)$|-radius$/;
const PROP_VENDOR_PREFIX_RE = /^-[a-z]+-/;
function isRelevantProp(prop) {
  const deprefixed = prop.replace(PROP_VENDOR_PREFIX_RE, '');
  if (deprefixed === 'box-shadow' || deprefixed === 'all') return true;
  if (!deprefixed.startsWith('border')) return false;
  return !IRRELEVANT_BORDER_PROP_RE.test(deprefixed);
}

// 값 정규화 — **CSS 공백**(5종) 축약/trim만 한다(소문자화·escape 디코딩·토큰 분해 전부 없음). 대소문자와
// escape가 canonical 판정에 그대로 노출되므로 `VAR(--x)`·`tr\61 nsparent` 류는 자동으로 RED다.
// I1(18R): 이전엔 JS `\s`/`trim()`이라 NBSP·EM SPACE·ZWNBSP·VT를 ASCII space로 **바꿔서** 통과시켰다.
function normalizeDeclValue(value) {
  return normalizeCssWhitespace(value);
}

// box-shadow canonical 값 → 레이어 모델 배열. 판정은 classifyRelevantDecl(=CANONICAL_DECLS dispatch)
// 하나로 단일화돼 있으므로 여기서 별도 분해·별도 정규식을 두지 않는다(M1: 판정 경로 이중화 금지).
function canonicalShadowLayers(value) {
  const cls = classifyRelevantDecl('box-shadow', value);
  return cls.syntax === 'canonical' && cls.form === 'box-shadow' ? cls.layers : null;
}

// 층 1 판정기 — relevant 선언 하나를 `canonical`(+form) 또는 `non-canonical`로 **이분**한다.
// 상태 모델(층 2 내부에서만 의미를 갖는다): syntax = canonical | non-canonical.
// non-canonical은 어느 분기에서든 RED이고 **어떤 부작용도 내지 않는다**(border-image reset 금지 포함 —
// 검수 finding 3의 `border: RGB(foo(1) 2 3)` 케이스가 이걸로 닫힌다).
//
// I3(18R) — **벤더 프리픽스 relevant 선언은 무조건 non-canonical**. 이전엔 isRelevantProp()만 deprefix해
// 수집하고 classifier에는 raw `-webkit-box-shadow`가 전달돼 **이름 비대칭**이 생겼다: `initial`/`unset`이
// CSS-wide canonical로 인정된 뒤 `prop === 'box-shadow'`에 미매치 → 마지막 분기에서 shadow가 아닌
// **border 셀을 초기화**해, 인디케이터 핀은 기존 shadow가 그대로 남아 GREEN이었다(선재현 실측:
// `-webkit-box-shadow: initial !important`·`-webkit-box-shadow: unset` 둘 다 visible=true).
// 실핀이 쓰지 않는 형태이므로 alias 의미를 계산할 이유가 없다 — 존재 자체를 RED로 접는다(fail-closed).
// M1(18R) — 아래 루프가 CANONICAL_DECLS를 **직접** dispatch하는 유일 판정 경로다. 배열 entry의
// prop/re를 훼손하면 판정 결과가 즉시 달라진다(= 배열이 진짜 single source임을 mutation으로 증명 가능).
function classifyRelevantDecl(prop, rawValue) {
  const value = normalizeDeclValue(rawValue);
  if (PROP_VENDOR_PREFIX_RE.test(prop)) return { syntax: 'non-canonical', prop, value };
  if (CANON_CSS_WIDE_RE.test(value)) return { syntax: 'canonical', form: 'css-wide', keyword: value, value };
  for (const entry of CANONICAL_DECLS) {
    if (entry.prop !== prop) continue;
    const m = entry.re.exec(value);
    if (m) return { syntax: 'canonical', id: entry.id, value, ...entry.build(m) };
  }
  return { syntax: 'non-canonical', prop, value };
}

// PINNED selector 규칙 수집. root 직속 규칙만 cascade에 참여시키고, **조건부 문맥(@media/@supports 등)
// 안의 동일 selector 규칙**은 별도로 반환한다 — 이전 구조는 이들을 조용히 무시했다(모델 불가를
// "없는 것"으로 취급 = 수집 누락 구멍). 이제 그 안에 relevant 선언이 하나라도 있으면 fail-closed RED다.
function collectPinnedRules(root, targetSelectors) {
  const rootRules = [];
  const conditionalRules = [];
  root.walkRules((rule) => {
    if (!selectorMatches(rule, targetSelectors)) return;
    (rule.parent.type === 'root' ? rootRules : conditionalRules).push(rule);
  });
  return { rootRules, conditionalRules };
}

// ─────────────────────────────────────────────────────────────────────────────
// 층 2 — 제한된 cascade evaluator. 다루는 입력은 canonical 선언 + CSS-wide 키워드·`all`뿐이라 범위가
// 극적으로 축소됐다. 모델링 대상은 선언 순서·!important·(canonical 폼 사이의) 도메인 관계뿐이다.
// **무효 CSS fallback(이전 핀 부활) 동작은 없다** — non-canonical이 하나라도 있으면 그 자체가 실패다.
// ─────────────────────────────────────────────────────────────────────────────
function evaluateCanonicalContract(rootRules, conditionalRules, contract) {
  const nonCanonical = [];
  const unmodelable = [];
  const border = { model: null, important: false }; // model=null → border initial(비가시)
  const shadow = { model: null, important: false }; // model=null → box-shadow initial(none)
  const applyCell = (cell, model, important) => {
    if (cell.important && !important) return; // important가 후행 non-important를 이김
    cell.model = model;
    cell.important = important;
  };

  conditionalRules.forEach((rule) => {
    rule.walkDecls((decl) => {
      if (!isRelevantProp(normalizeProp(decl.prop))) return;
      // 조건부 적용(뷰포트·기능 질의)은 정적 게이트가 계산할 수 없다 → 모델 불가로 표면화.
      unmodelable.push(`조건부 문맥 ${describeLocation(rule)} { ${decl.prop}: ${normalizeDeclValue(decl.value)} }`);
    });
  });

  rootRules.forEach((rule) => {
    rule.walkDecls((decl) => {
      const prop = normalizeProp(decl.prop); // escaped 식별자(\42order 등)는 여기서 실이름으로 복원된다
      if (!isRelevantProp(prop)) return;
      const cls = classifyRelevantDecl(prop, decl.value);
      const important = !!decl.important;
      if (cls.syntax === 'non-canonical') {
        nonCanonical.push(`${decl.prop}: ${cls.value}${important ? ' !important' : ''}`);
        return; // 부작용 금지 — 리셋도 설정도 하지 않는다
      }
      if (cls.form === 'border') { applyCell(border, cls.border, important); return; }
      if (cls.form === 'box-shadow') { applyCell(shadow, cls.layers, important); return; }
      // css-wide
      if (!MODELED_RESET_KEYWORDS.has(cls.keyword)) {
        unmodelable.push(`${decl.prop}: ${cls.keyword}`); // inherit/revert/revert-layer — 모델 불가(sticky)
        return;
      }
      if (prop === 'all') { applyCell(border, null, important); applyCell(shadow, null, important); return; }
      if (prop === 'box-shadow') { applyCell(shadow, null, important); return; }
      if (BORDER_IMAGE_PROP_RE.test(prop)) return; // border-image initial/unset = 도장 없음(경계 계약 무영향)
      applyCell(border, null, important); // 그 밖 border 계열 initial/unset
    });
  });

  const blocked = nonCanonical.length > 0 || unmodelable.length > 0;
  if (contract.kind === 'indicator') {
    const layers = shadow.model;
    const layer = layers ? layers.find((l) => l.kind === 'inset' && l.token === contract.token && l.spread > 0) : null;
    return { visible: !blocked && !!layer, nonCanonical, unmodelable, layers, layer };
  }
  const m = border.model;
  const visible = !blocked && !!m && m.width > 0 && m.token === contract.token;
  return { visible, nonCanonical, unmodelable, border: m };
}

// PINNED 본문과 모든 mutation synthetic이 통과하는 **단일 진입점**(계약 유지 — 13R I5).
function evaluatePinnedContract(cssText, selector, contract) {
  const root = postcss.parse(cssText);
  const { rootRules, conditionalRules } = collectPinnedRules(root, selector);
  if (rootRules.length === 0 && conditionalRules.length === 0) {
    return { visible: false, rulesFound: 0, reason: `${selector} 규칙(셀렉터 완전일치) 미발견` };
  }
  return { rulesFound: rootRules.length, ...evaluateCanonicalContract(rootRules, conditionalRules, contract) };
}
// synthetic 진입점 — SCSS는 PINNED과 동일하게 Sass compile을 거치고, Sass가 선-거부/선-접기 하는
// 벡터(명시 예외)는 raw CSS를 직접 태운다(P4 스윕이 raw .css도 훑으므로 실제 입력 경로다).
const evalBorderScss = (scss, token = 'color-input-border') =>
  evaluatePinnedContract(compileString(scss).css, '.X', { kind: 'border', token });
const evalIndicatorScss = (scss, token) =>
  evaluatePinnedContract(compileString(scss).css, '.X', { kind: 'indicator', token });
const evalBorderCss = (cssText, token = 'color-input-border') =>
  evaluatePinnedContract(cssText, '.X', { kind: 'border', token });
const evalIndicatorCss = (cssText, token) =>
  evaluatePinnedContract(cssText, '.X', { kind: 'indicator', token });
// needle(`var(--token)`)을 토큰명으로 바꾼다 — 별도 파서 없이 CANON_VAR_REF_RE 하나만 쓴다.
// ⚠️ 이 매처는 **needle 파싱 전용**이며 canonical 판정에는 관여하지 않는다(I2: 선언 값 쪽 opaque
// layer는 `var(--shadow-xs)` 정확일치뿐 — 여기의 일반형 `var(--name)`과 혼동 금지).
function canonicalNeedleToken(needle) {
  const m = CANON_VAR_REF_RE.exec(normalizeDeclValue(needle));
  if (!m) throw new Error(`PINNED needle이 canonical var(--token) 형태가 아님: ${needle}`);
  return m[1];
}

describe('컨트롤 보더/인디케이터 재분류 고정 — canonical 구조 게이트 (17R 아키텍처 전환)', () => {
  // 가변 fill 등으로 보더가 유일한 형상 단서인 컨트롤들 — 전수 재감사(2026-07-15)에서 승격 확정.
  // 대표: canvasEditor ColorSwatch(검정 프리셋이 다크 bg 대비 1.1:1이라 보더 없으면 소실).
  //
  // 6~16라운드에 걸쳐 이 핀 파이프라인이 닫아 온 우회들은 **이제 전부 층 1이 구조적으로 흡수**한다
  // (개별 grammar 판정을 없애고 "canonical이 아니면 RED"로 수렴시켰기 때문). 기록 목적의 대응표:
  //  ① `/* border: … */` 블록주석 — postcss Comment 노드라 walkDecls 미방문(유지).
  //  ② `--dead-border`/`border-radius`/`content:"border:…"` — isRelevantProp의 프로퍼티 이름 판정에서
  //     제외(값 유효성 추론 없음). 반대로 `border-*` 신설/논리 프로퍼티는 relevant로 들어와 RED가 된다.
  //  ③ `:hover`에만 남김 — selectorMatches의 완전 동일 문자열 비교(유지).
  //  ④ `@media` 안 규칙 — 이전엔 조용히 **무시**됐다(수집 누락). 이제 collectPinnedRules가 조건부 문맥
  //     규칙을 따로 모아 relevant 선언이 있으면 모델 불가(fail-closed RED)로 표면화한다.
  //  ⑤ 후행 override(`border:none`·`box-shadow:none`) — 층 2 cascade가 최종 셀 하나만 본다. 게다가
  //     `none`은 canonical이 아니므로 그 선언의 존재 자체가 RED다.
  //  ⑥ fallback 안 토큰 텍스트(`var(--a, var(--b))`) — canonical `var(--name)`은 fallback을 불허(RED).
  //  ⑦⑧⑨ 가시성(spread 0·width 0·style 없음·네 면 소실·calc width) — 층 2가 canonical 모델에서
  //     width>0 / spread>0 / 토큰 일치를 직접 계산하고, 그 밖의 형태는 애초에 canonical이 아니다.
  const PINNED = [
    { label: 'canvasEditor .CanvasEditor', file: 'components/canvas/canvasEditor.scss', selector: '.CanvasEditor', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'canvasEditor ColorSwatch(Toolbar)', file: 'components/canvas/canvasEditor.scss', selector: '.CanvasEditorToolbar__ColorSwatch', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'taskList FilterBuilder OpToggle', file: 'components/branch/taskList.scss', selector: '.FilterBuilder__OpToggle', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'myTasks ScopeToggle', file: 'components/myTasks/myTasks.scss', selector: '.MyTasks__ScopeToggle', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'home-shared HomeTabs', file: 'components/home/shared/home-shared.scss', selector: '.HomeTabs', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'browseBranches JoinBtn--joined', file: 'components/browse/browseBranches.scss', selector: '.BrowseBranches__JoinBtn--joined', kind: 'border', needle: 'var(--color-input-border)' },
    // 선택 상태 인디케이터(수정 1, SC 1.4.11) — active 셀렉터가 토큰을 실제로 소비하는지만 여기서 고정.
    // 다크 값 자체의 시맨틱(투명 회귀 방지)은 아래 별도 describe에서 대비비로 고정한다.
    { label: 'home-shared HomeTabs__Tab.is-on', file: 'components/home/shared/home-shared.scss', selector: '.HomeTabs__Tab.is-on', kind: 'indicator', needle: 'var(--color-selected-indicator)' },
    { label: 'myTasks ScopeBtn--active', file: 'components/myTasks/myTasks.scss', selector: '.MyTasks__ScopeBtn--active', kind: 'indicator', needle: 'var(--color-selected-indicator)' },
  ];
  it.each(PINNED)('$label 의 relevant 선언이 전부 canonical이고 기대 토큰이 시각적으로 유효하다', ({ file, selector, kind, needle }) => {
    const expectedToken = canonicalNeedleToken(needle);
    const res = evaluatePinnedContract(compiledSiteCss(file), selector, { kind, token: expectedToken });
    expect(res.rulesFound, `${selector} 규칙(root 직속·셀렉터 완전일치)을 컴파일된 ${file}에서 찾지 못함`).toBeGreaterThan(0);
    expect(
      res.visible,
      `${selector} ${kind} 계약 위반(기대 토큰 "${expectedToken}") — ${JSON.stringify(res)}`,
    ).toBe(true);
  });

  // CANONICAL_DECLS의 **도출 근거**를 실파일로 재검증한다 — 상수의 pins 목록이 실제 컴파일 값과
  // 어긋나면(핀이 canonical을 벗어나거나 상수가 낡으면) 여기서 즉시 드러난다.
  it('CANONICAL_DECLS 도출 근거 고정 — 핀 8곳의 relevant 선언이 전부 canonical로 분류된다', () => {
    const seen = [];
    for (const { selector, file } of PINNED) {
      const root = postcss.parse(compiledSiteCss(file));
      const { rootRules, conditionalRules } = collectPinnedRules(root, selector);
      expect(conditionalRules, `${selector}: 조건부 문맥(@media 등) 규칙이 새로 생김 — 모델 불가`).toEqual([]);
      rootRules.forEach((rule) => rule.walkDecls((decl) => {
        const prop = normalizeProp(decl.prop);
        if (!isRelevantProp(prop)) return;
        const cls = classifyRelevantDecl(prop, decl.value);
        expect(cls.syntax, `${selector} { ${decl.prop}: ${decl.value} }`).toBe('canonical');
        seen.push(`${selector}|${decl.prop}: ${cls.value}`);
      }));
    }
    // 실측 고정(도출 근거 스냅샷): border 핀 6곳 + 인디케이터 핀 2곳 = relevant 선언 정확히 8개.
    expect(seen).toEqual([
      '.CanvasEditor|border: 1px solid var(--color-input-border)',
      '.CanvasEditorToolbar__ColorSwatch|border: 1px solid var(--color-input-border)',
      '.FilterBuilder__OpToggle|border: 1px solid var(--color-input-border)',
      '.MyTasks__ScopeToggle|border: 1px solid var(--color-input-border)',
      '.HomeTabs|border: 1px solid var(--color-input-border)',
      '.BrowseBranches__JoinBtn--joined|border: 1px solid var(--color-input-border)',
      '.HomeTabs__Tab.is-on|box-shadow: var(--shadow-xs), inset 0 0 0 1px var(--color-selected-indicator)',
      '.MyTasks__ScopeBtn--active|box-shadow: inset 0 0 0 1px var(--color-selected-indicator)',
    ]);
  });

  it('CANONICAL_DECLS 항목별 근거(pins)가 비어 있지 않다 — 근거 없는 canonical 확장 금지', () => {
    expect(CANONICAL_DECLS).toHaveLength(3);
    for (const entry of CANONICAL_DECLS) {
      expect(entry.pins.length, entry.id).toBeGreaterThan(0);
      expect(typeof entry.form, entry.id).toBe('string');
    }
  });

  // M3(19R) — pins를 분류 결과에 **연결**한다(제거 대신 load-bearing화). 이전엔 pins가 순수 메타데이터라
  // 두 shadow entry의 pins를 서로 바꿔도 372 통과했다(=기능 없는 주석). 이제 각 핀 셀렉터의 relevant
  // 선언을 실제로 분류해 얻은 cls.id로 {id → [selector]} 맵을 역구성하고, CANONICAL_DECLS[].pins가 그것과
  // 정확히 일치함을 단정한다 — pins를 swap하면 여기서 RED가 난다.
  it('M3(19R): CANONICAL_DECLS[].pins ↔ 실제 분류 결과 정합 (핀 셀렉터의 cls.id = 그 셀렉터를 담은 entry.id, swap 시 RED)', () => {
    const selectorToId = {};
    for (const { selector, file } of PINNED) {
      const root = postcss.parse(compiledSiteCss(file));
      const { rootRules } = collectPinnedRules(root, selector);
      const ids = [];
      rootRules.forEach((rule) => rule.walkDecls((decl) => {
        const prop = normalizeProp(decl.prop);
        if (!isRelevantProp(prop)) return;
        const cls = classifyRelevantDecl(prop, decl.value);
        expect(cls.syntax, `${selector} { ${decl.prop}: ${decl.value} }`).toBe('canonical');
        ids.push(cls.id);
      }));
      expect(ids, `${selector}: relevant 선언 정확히 1개(도출 근거 describe가 보장)`).toHaveLength(1);
      selectorToId[selector] = ids[0];
    }
    // 분류 실측 → {id: [정렬된 selector]} 역구성
    const pinsFromClassification = {};
    for (const [selector, id] of Object.entries(selectorToId)) (pinsFromClassification[id] ||= []).push(selector);
    for (const id of Object.keys(pinsFromClassification)) pinsFromClassification[id].sort();
    // 메타데이터 → 동형
    const pinsFromMetadata = {};
    for (const entry of CANONICAL_DECLS) pinsFromMetadata[entry.id] = [...entry.pins].sort();
    expect(pinsFromClassification).toEqual(pinsFromMetadata);
  });
});

describe('핀 대상 컴포넌트 5파일 — 보호 토큰 네임스페이스 "선언" 전면 금지 (조상 스코프 오염 차단, 9라운드)', () => {
  // 위 PINNED가 이미 컴파일 중인 5파일(canvasEditor·taskList·myTasks·home-shared·browseBranches)은
  // var(--color-x) 같은 소비만 정상이다. `.Foo { --color-x: … }`처럼 어떤 selector에서든 보호
  // 네임스페이스를 재선언하면 그 조상 스코프 서브트리 전체의 캐스케이드 값을 오염시킨다 —
  // structuralGate와 동일한 판정(findProtectedDeclarations)을 컴파일된 사이트 CSS 전체에 적용해
  // 선언 자체의 존재를 금지한다(소비=var() 참조는 --접두 prop이 아니므로 애초에 안 걸린다).
  const PINNED_FILES = [
    'components/canvas/canvasEditor.scss',
    'components/branch/taskList.scss',
    'components/myTasks/myTasks.scss',
    'components/home/shared/home-shared.scss',
    'components/browse/browseBranches.scss',
  ];
  it.each(PINNED_FILES)('%s는 --color-/--track-/--shadow- 를 선언하지 않는다(소비만)', (file) => {
    const offenders = findProtectedDeclarations(compiledSiteCss(file));
    expect(offenders, `${file}에서 보호 토큰 선언 발견: ${offenders.join('; ')}`).toEqual([]);
  });
});

// .css 원문 정규화(Minor, 11라운드) — raw postcss 파싱은 escaped custom-property 이름
// (`--\63 olor-selected-indicator` = 유효 CSS, 실이름 --color-selected-indicator)을 리터럴 prop으로
// 남겨 hasProtectedPrefix(startsWith '--color-')를 우회시켰다(외부 검수 실증). Sass CSS-syntax 컴파일로
// 식별자 escape를 정규화한다 — 부분 hex 정규식·escape 수동 재구현 없이 파서에 위임한다. custom
// property는 스펙상 case-sensitive라 --Color-x는 그대로 보존되고(≠--color-x), var() 소비는 값이라 decl.prop
// 검사에 안 걸리며, `/* */` 블록주석은 Comment 노드로 분리돼 오검출되지 않는다. 컴파일 실패는 조용히
// 넘기지 않고 상위 sweepFileForProtectedDeclarations의 try/catch가 offender로 표면화해 RED로 떨어뜨린다.
function normalizeRawCss(source) {
  return compileString(String(source), { syntax: 'css' }).css;
}

// styles/ 아래 임의 파일(.scss는 컴파일, .css는 CSS-syntax 정규화)을 CSS 텍스트로 반환한다.
// scssCompileCache를 그대로 재사용해(relPath 키 공간이 겹치지 않으므로 안전) 핀 5파일과 캐시를
// 공유한다 — Important 1 수정 지시("컴파일 결과는 모듈 스코프 캐시(핀 5파일과 공유)로 1회만").
function siteCssText(relPath) {
  if (relPath.endsWith('.css')) {
    if (!scssCompileCache.has(relPath)) {
      scssCompileCache.set(relPath, normalizeRawCss(readFileSync(resolve(__dirname, '../styles', relPath), 'utf8')));
    }
    return scssCompileCache.get(relPath);
  }
  return compiledSiteCss(relPath);
}

// P4(Important 1, 외부 검수 10라운드) — 원문 스윕은 소스 정규식("같은 줄에서 이름:" 매칭) + .scss만
// 봐서 두 우회를 놓쳤다(외부 검수 실증): ① fonts.css(_app에서 _themes **뒤** import — 실측 확인,
// pages/_app.js: _themes.scss → globals.scss → fonts.css 순)에 보호 토큰 override를 넣어도 .css는
// 스윕 대상이 아니라 안 걸렸다. ② `--color-x`\n`: red;`처럼 콜론을 다음 줄로 보내면(유효 SCSS,
// 컴파일 결과는 동일) 같은-줄 정규식이 매치 실패했다. 컴파일(.scss) 또는 그대로(.css) → postcss AST
// walkDecls로 전환하면 원본 포맷(멀티라인·주석·중첩)과 무관하게 최종 선언만 보므로 두 우회 모두
// 구조적으로 막힌다 — findProtectedDeclarations(핀 5파일이 이미 쓰는 동일 판정 로직)를 styles/ 전체로
// 확장해 재사용한다(로직 중복·drift 방지). 고아 파일(_app 미import, 예: createIssue.scss)도 스윕
// 대상에 포함되지만 무해하다 — 선언 금지는 파일 로드 여부와 무관한 전역 계약이다. sass.compile
// 실패는 조용히 건너뛰지 않고(offender로 표면화) expect([]).toEqual([])를 RED로 떨어뜨린다.
// I1(24R): 같은 siteCssText(compile/normalize)→postcss AST 파이프라인에 property 하나(color-scheme) 금지를
// 더 얹는다 — findColorSchemeDeclarations(비-custom 전역 스위치)를 findProtectedDeclarations(보호 custom
// property)와 같은 텍스트에 병렬로 태워 offender를 합친다(새 파이프라인 없음).
function sweepFileForProtectedDeclarations(relPath) {
  try {
    const text = siteCssText(relPath);
    return [...findProtectedDeclarations(text), ...findColorSchemeDeclarations(text)].map((o) => `${relPath}: ${o}`);
  } catch (e) {
    return [`${relPath}: 컴파일/파싱 실패(FAIL로 표면화, 침묵 스킵 금지) — ${String((e && e.message) || e).split('\n')[0]}`];
  }
}

// P4 스윕 대상 판정(Important 2, 11라운드) — pure helper. 보호 토큰 선언 금지 계약의 대상 파일인가?
// 이전 필터는 `f.endsWith('_themes.scss')`로 예외를 걸어 루트 정본뿐 아니라 중첩 `components/example/
// _themes.scss`·접미 우연 일치 `components/rogue_themes.scss`까지 잘못 제외했다(외부 검수 실증). SCSS
// 예외는 루트 상대경로 exact '_themes.scss' **하나뿐**이어야 한다(endsWith 금지). .scss는 컴파일, .css는
// 정규화 후 AST 스윕 대상이며, 그 외 확장자는 대상이 아니다. 새 .scss/.css는 자동으로 포함된다.
function isProtectedSweepTarget(relPath) {
  if (relPath === '_themes.scss') return false; // 유일 예외: 토큰의 정본 거처(라이트/다크/별칭 3블록)
  return relPath.endsWith('.scss') || relPath.endsWith('.css');
}

describe('styles/ 전체 컴파일/AST 스윕 — 비핀 파일 보호 토큰 선언 금지 (P4, 컴파일 기반)', () => {
  const stylesDir = resolve(__dirname, '../styles');
  const allFiles = readdirSync(stylesDir, { recursive: true }).map(String);
  const targetFiles = allFiles.filter(isProtectedSweepTarget);

  // 확장자 커버리지를 "총개수 하한"으로 대체하지 않는다(Important 2) — 아래 exact 제외목록·역방향
  // 포함 단정이 실제 커버리지를 고정한다. 개수는 극단적 축소만 잡는 보조 신호로만 남긴다.
  it('스윕 대상 파일이 90개를 넘는다(극단 축소 보조 신호 — .scss 92 + .css 1 실측 기준)', () => {
    expect(targetFiles.length).toBeGreaterThan(90);
  });

  it('제외되는 .scss는 루트 정본 _themes.scss 하나뿐 (endsWith 우회 방지 — 중첩/접미 _themes.scss는 대상)', () => {
    const excludedScss = allFiles.filter((f) => f.endsWith('.scss') && !isProtectedSweepTarget(f));
    expect(excludedScss).toEqual(['_themes.scss']);
  });

  it('styles/**/*.css 전부가 스윕 대상에 포함된다 + fonts.css 직접 고정 (.css 분기 삭제 재발 검출)', () => {
    const allCss = allFiles.filter((f) => f.endsWith('.css'));
    expect(allCss.length, 'styles/ 아래 .css가 하나도 없다면 인벤토리 전제가 깨짐').toBeGreaterThan(0);
    for (const f of allCss) expect(targetFiles, `${f}가 스윕 대상에서 누락`).toContain(f);
    expect(targetFiles).toContain('fonts.css');
  });

  it('.css 분기를 뺀 대체 판정은 최소 하나의 .css를 놓친다 (누락 회귀를 역방향 포함 단정이 잡음을 확인)', () => {
    const withoutCssBranch = (relPath) => relPath !== '_themes.scss' && relPath.endsWith('.scss'); // .css 분기 제거 모사
    const mutated = allFiles.filter(withoutCssBranch);
    const allCss = allFiles.filter((f) => f.endsWith('.css'));
    expect(allCss.some((f) => !mutated.includes(f))).toBe(true);
  });

  // 적대적 자가 재검토(18R, inventory 누락 클래스 — I4와 동종) — isProtectedSweepTarget은 `.scss`/`.css`
  // **두 확장자만** 대상으로 삼는다. 그래서 styles/ 아래에 다른 스타일 확장자(`.sass` 들여쓰기 문법,
  // `.less`, `.pcss` 등)가 추가되면 10R에 fonts.css가 그랬던 것과 **정확히 같은 방식으로** 스윕 밖으로
  // 새 나간다(파일은 로드되는데 게이트는 못 본다). 확장자 화이트리스트를 열어두는 대신, styles/ 아래
  // 실제 확장자 인벤토리 자체를 고정한다 — 새 확장자가 등장하면 여기서 먼저 RED가 나고 개발자가
  // isProtectedSweepTarget 확장 여부를 의식적으로 결정하게 된다(silent 누락 → 명시 결정으로 전환).
  it('styles/ 아래 확장자 인벤토리 고정 — .scss/.css 외 확장자가 생기면 RED(스윕 밖 silent 누락 방지)', () => {
    const exts = new Set(allFiles.filter((f) => f.includes('.')).map((f) => f.slice(f.lastIndexOf('.'))));
    expect([...exts].sort()).toEqual(['.css', '.scss']);
  });

  it('.scss 전부(컴파일 후 AST)+.css 전부(정규화 후 파싱)가 --color-/--track-/--shadow-·color-scheme 를 선언하지 않는다 (I1 24R)', () => {
    const offenders = targetFiles.flatMap(sweepFileForProtectedDeclarations);
    expect(offenders, `보호 토큰/color-scheme 선언(또는 컴파일 실패) 발견: ${offenders.join('; ')}`).toEqual([]);
  });
});

describe('I1(24R) styles 전역 color-scheme 금지 선재현↔RED — P4 스윕 non-custom property 확장', () => {
  // 옛 P4 검출(findProtectedDeclarations)은 --color-/--track-/--shadow-만 봐서 color-scheme에 blind(선재현),
  // 신 검출(findColorSchemeDeclarations)이 디코딩+lowercase로 위치/selector/escape/case 무관 RED. 두 검출을
  // sweepFileForProtectedDeclarations가 같은 siteCssText에 병렬로 태운다(위 실 스윕 assertion이 실 파일 커버).
  const scssCss = (body) => compileString(body).css;   // .scss 경로(Sass 컴파일)
  const rawCss = (body) => normalizeRawCss(body);       // .css 경로(fonts.css식 css-syntax 정규화)
  const cases = {
    'fonts.css식 .css raw':         rawCss(':root{color-scheme:dark}'),
    '일반 SCSS(비-:root selector)':  scssCss('.Foo{color-scheme:dark}'),
    '@media 내부':                   rawCss('@media (min-width:0px){:root{color-scheme:dark}}'),
    'escaped(color-\\73 cheme)':     ':root{color-\\73 cheme:dark}', // raw — decoder가 실이름 복원
    'case 변형(COLOR-SCHEME)':       ':root{COLOR-SCHEME:dark}',      // raw — toLowerCase가 정규화(regular property는 대소문자 무시)
  };
  it.each(Object.entries(cases))('선재현: %s → findProtectedDeclarations blind(offender 0)', (_l, cssText) => {
    expect(findProtectedDeclarations(cssText)).toEqual([]);
  });
  it.each(Object.entries(cases))('RED: %s → findColorSchemeDeclarations offender>0', (_l, cssText) => {
    expect(findColorSchemeDeclarations(cssText).length).toBeGreaterThan(0);
  });
  it('escaped가 실 파이프라인(Sass css-syntax 정규화)에서도 리터럴 color-scheme로 접혀 잡힌다(디코더는 belt-and-suspenders)', () => {
    // 실 스윕은 siteCssText(Sass)를 거치므로 escape는 컴파일 시 리터럴로 정규화된다 — 정규화본도 RED.
    expect(findColorSchemeDeclarations(rawCss(':root{color-\\73 cheme:dark}')).length).toBeGreaterThan(0);
  });
  it('대조(false-positive 없음): color-scheme 없는 파일 — 보호 custom property 소비·color/background는 GREEN', () => {
    expect(findColorSchemeDeclarations(rawCss(':root{--color-bg:#fff}'))).toEqual([]);
    expect(findColorSchemeDeclarations(scssCss('.Foo{color:red;background:var(--color-bg)}'))).toEqual([]); // 'color'≠'color-scheme'
  });
  it('적대적 스코프 판단: color-scheme만 좁게 금지 — accent-color/forced-color-adjust는 컴포넌트 정당 사용이라 대상 아님', () => {
    // accent-color는 스타일에 input[type=checkbox] 등 9곳 정당 사용, forced-color-adjust는 레포 0 — 전역 금지 시 false-positive.
    expect(findColorSchemeDeclarations(rawCss('.Foo{accent-color:red;forced-color-adjust:none}'))).toEqual([]);
    expect(STYLES_FORBIDDEN_NONCUSTOM_PROPS).toEqual(['color-scheme']);
  });
});

// WCAG 2.x 상대휘도/대비비. hex 6자리와 rgb(a)(...) 둘 다 파싱한다(myTasks ScopeBtn--active의
// 반투명 배경 rgba(94, 106, 210, 0.1)를 합성색 계산에 그대로 써야 하므로 hex 전용으로는 부족하다).
// transparent 등 둘 다 아닌 값은 파싱 실패로 null → contrastRatio가 0을 반환해 아래 >=3 단정이
// RED가 된다(다크 인디케이터 투명 회귀 검출).
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
function parseColor(value) {
  // I1(18R, 적대적 자가 재검토에서 실측 발견): JS trim이면 `#6B7280<NBSP>`(브라우저에선 무효 값이라
  // 토큰이 적용되지 않는다)를 정상 hex로 둔갑시켜 대비 3.97로 통과했다 — CSS 공백 전용 trim으로 교체.
  const str = cssTrim(value);
  const hex = /^#([0-9a-fA-F]{6})$/.exec(str);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  // 엄격 CSS <number> 토큰만 허용(Important 1) — 느슨한 `[\d.]+`는 `1.`(trailing dot, CSS 불법 —
  // 브라우저는 이 선언을 폐기해 box-shadow가 none처럼 무효화된다)도 매치해 Number('1.')===1로
  // 정상 색상 취급했다(외부 검수 8라운드 실증). `\d+(?:\.\d+)?`(정수/소수)와 `\.\d+`(선행 점만) 두
  // 형태만 인정 — trailing dot·다중 소수점(`1.2.3`)·빈 채널은 전부 매치 실패로 null.
  // I1(18R, 적대적 자가 재검토): 구분자 공백도 CSS 5종만 허용한다. JS `\s*`는 `rgba(107,<NBSP>114,…)`
  // (브라우저는 무효 → 토큰 미적용)를 정상 색으로 파싱해 대비 단정을 통과시켰다 — 같은 과대 허용 클래스.
  const N = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
  const W = `[${CSS_WS_CLASS}]*`;
  const rgba = new RegExp(`^rgba?\\(${W}(${N})${W},${W}(${N})${W},${W}(${N})${W}(?:,${W}(${N})${W})?\\)$`).exec(str);
  if (rgba) {
    // 브라우저 의미론대로 clamp — a는 [0,1], RGB 채널은 [0,255]. clamp 없이 Number()만 쓰면
    // `rgba(60,60,60,10)`(a=10)처럼 스펙 밖 값이 합성 수학을 붕괴시킨다: compositeOver의
    // `a*fg + (1-a)*bg`가 a=10일 때 음의 계수(1-a=-9)로 bg를 반대 방향으로 끌어당겨 비현실적인
    // 합성색을 만들고, 그 결과로 나온 대비가 실제 렌더(clamp된 a=1, 즉 완전 불투명)보다 훨씬 높게
    // 나와 회귀를 놓쳤다(외부 검수 실증, s시나리오: 실대비 ≈1.5~1.7인데 미클램프 시 25~74로 통과).
    return {
      r: clamp(Number(rgba[1]), 0, 255),
      g: clamp(Number(rgba[2]), 0, 255),
      b: clamp(Number(rgba[3]), 0, 255),
      a: rgba[4] != null ? clamp(Number(rgba[4]), 0, 1) : 1,
    };
  }
  return null;
}
// fgValue/bgValue는 hex/rgba 문자열이거나 이미 파싱·합성된 {r,g,b} 객체(체인 합성용) 둘 다 허용 —
// 객체면 alpha 필드가 없다는 뜻이므로 불투명(a=1)으로 취급한다(ScopeToggle처럼 배경 자체가 이미
// 알파 합성 결과인 체인 케이스, compositeOver(indicator, scopeToggleAdjacent) 등).
function toRGBA(value) {
  if (value && typeof value === 'object' && 'r' in value) return { a: 1, ...value };
  return parseColor(value);
}
// 반투명 전경(fgValue)을 배경(bgValue) 위에 알파 합성한 불투명 rgb 결과. 파싱 실패면 null.
function compositeOver(fgValue, bgValue) {
  const fg = toRGBA(fgValue);
  const bg = toRGBA(bgValue);
  if (!fg || !bg) return null;
  const a = fg.a;
  return { r: a * fg.r + (1 - a) * bg.r, g: a * fg.g + (1 - a) * bg.g, b: a * fg.b + (1 - a) * bg.b };
}
function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
// colorA/colorB는 hex/rgba 문자열 또는 이미 파싱된 {r,g,b} 객체(합성색) 둘 다 허용.
// ⚠️ 알파를 파싱만 하고 무시한다 — rgba(…, 0)(완전 투명) 같은 값도 hex와 동일하게 취급해 오통과
// 시킨다(외부 검수 실증, k시나리오). 인디케이터처럼 알파가 있을 수 있는 전경색은 절대 이 함수에
// 직접 넣지 말고 반드시 아래 contrastOverBg로 배경 위에 먼저 합성한 뒤 그 결과를 넣을 것.
function contrastRatio(colorA, colorB) {
  const a = typeof colorA === 'string' ? parseColor(colorA) : colorA;
  const b = typeof colorB === 'string' ? parseColor(colorB) : colorB;
  if (!a || !b) return 0;
  const [lo, hi] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}
// 인디케이터(fg)를 인접 배경(bg) 위에 먼저 알파 합성한 뒤, 그 합성색과 배경 자체의 대비를 잰다.
// contrastRatio(fg, bg)를 직접 부르면 fg의 알파가 무시돼 rgba(107,114,128,0)(완전 투명)도 불투명
// hex와 동일한 대비로 통과했다 — 합성을 먼저 거치면 알파=0일 때 결과가 배경과 완전히 같아져
// 1:1이 되고, 아래 >=3 단정이 자연히 RED가 된다(외부 검수 실증, k시나리오).
function contrastOverBg(fgValue, bgValue) {
  const composited = compositeOver(fgValue, bgValue);
  if (!composited) return 0;
  return contrastRatio(composited, bgValue);
}

// M2(19R) — 모듈 스코프 승격(이전엔 다크 indicator describe 안의 지역 함수라 mutation으로 안 잠겼다).
// 최종 색값 해석: 리터럴(hex/rgba)이면 그대로, `var(--token)`이면 darkValuesMap으로 재귀 해석, 그 외는 null.
// var() 매치의 공백은 **CSS 5종 전용**이다(I1 손실 정규화 클래스) — 옛 `\s`/`trim()`으로 되돌리면 NBSP 등이
// 통과해 M2 직접 테스트가 RED가 된다. 순환 참조는 depth>5로 끊어 null(무한재귀 방지).
function resolveColorValue(value, darkValuesMap, depth = 0) {
  if (value == null || depth > 5) return null;
  if (parseColor(value)) return value;
  const m = new RegExp(`^var\\([${CSS_WS_CLASS}]*--([a-z0-9-]+)[${CSS_WS_CLASS}]*(?:,[\\s\\S]*)?\\)$`, 'i')
    .exec(cssTrim(value));
  if (!m) return null;
  const next = darkValuesMap[m[1]];
  if (next == null) return null;
  return resolveColorValue(next, darkValuesMap, depth + 1);
}

// 다크 셀렉터가 매칭 가능한 3가지 quote 변형(Sass 버전별 unquoted 출력 포함) — 파일 상단 주석 참고.
const DARK_SELECTORS = ['html[data-theme=dark]', "html[data-theme='dark']", 'html[data-theme="dark"]'];

// 보호 토큰 네임스페이스 — 이 접두사를 가진 custom property는 오직 flat 3블록(라이트/다크/별칭) 안에서만
// 선언될 수 있다. 어떤 selector·atrule로 감싸든(9라운드 이전에는 이 두 가지가 감시 목록 밖이라 통과했다)
// 이 세 블록 밖에서 나타나면 즉시 위반이다.
const PROTECTED_TOKEN_PREFIXES = ['--color-', '--track-', '--shadow-'];

// F1(12라운드) — 표준 CSS 식별자 escape 디코더. Sass는 내부 hex escape(--\63 olor-x)는 --color-x로
// 정규화하지만 **선행 하이픈**은 \- 형태로 재직렬화한다(\--color-x, -\-color-x, \2d -color-x→\--color-x,
// -\2d color-x→-\-color-x — 실측 확인). 이 escape 이름들은 전부 브라우저에서 --color-x로 해석되는 유효
// 선언인데 raw decl.prop이 startsWith('--color-')를 우회했다. 선행 escape 몇 개를 정규식으로 치환하는
// 접근은 leaky하므로(변종마다 뚫림) CSS Syntax Module의 escape 규칙대로 hex escape(\HH… 최대 6자리 +
// 선택 공백 1개)와 문자 escape(\X → X, 하이픈 포함)를 모두 해석해 의미 식별자를 복원한 뒤 접두를 검사한다.
// custom property는 스펙상 case-sensitive이므로 디코더는 대소문자를 보존한다(\43 →'C' → --Color-x 는
// 여전히 비보호). escape 없는 일반 prop(--color-x·border-color 등)은 그대로 반환(no-op)이라 무해하다.
function decodeCssIdentifier(ident) {
  const s = String(ident);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch !== '\\') { out += ch; i += 1; continue; }
    const next = s[i + 1];
    if (next === undefined) { out += '�'; break; } // 매달린 백슬래시 → U+FFFD(스펙)
    if (/[0-9a-fA-F]/.test(next)) {
      let hex = '';
      let j = i + 1;
      while (j < s.length && hex.length < 6 && /[0-9a-fA-F]/.test(s[j])) { hex += s[j]; j += 1; }
      if (j < s.length && /[ \t\n\f\r]/.test(s[j])) j += 1; // hex escape 뒤 공백 1개 소비
      const code = parseInt(hex, 16);
      out += (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) ? '�' : String.fromCodePoint(code);
      i = j;
    } else if (next === '\n' || next === '\f' || next === '\r') {
      i += 2; // 식별자 내 escaped newline은 방어적으로 무시
    } else {
      out += next; // 문자 escape: \X → X
      i += 2;
    }
  }
  return out;
}
function hasProtectedPrefix(prop) {
  const decoded = decodeCssIdentifier(prop);
  return PROTECTED_TOKEN_PREFIXES.some((p) => decoded.startsWith(p));
}

// I4(18R) — @property 등록 스윕. 이전까지 모든 스캔(findProtectedDeclarations·structuralGate·
// findUnprotectedDeclarations)은 **일반 declaration(decl.prop)만** 봤다. CSS `@property --color-x {
// syntax:"<color>"; inherits:false; initial-value:transparent; }`는 이름이 `atrule.params`에 있고 내부는
// syntax/inherits/initial-value라는 별개 디스크립터라 어느 스캔에도 잡히지 않았다(선재현 실측:
// offenders 0). 등록되면 그 토큰은 **더 이상 :root에서 상속되지 않고** initial-value를 쓰므로 자식
// 핀의 경계가 통째로 소실되는데 PINNED 선언 문자열은 그대로라 전 GREEN이다 — inventory 누락형
// false-green이다. 등록 **값**은 계산하지 않는다(문법 모델 추가 금지): 보호 접두 이름의 등록 자체를
// 금지한다. at-rule 이름도 escape/대소문자 변형(`@PROPERTY`, `@\70 roperty`)이 가능하므로 이 파일의
// 유일 디코더(decodeCssIdentifier)를 통과시킨 뒤 비교한다 — I3와 같은 "이름 비대칭" 재발 방지.
function findProtectedPropertyRegistrations(root) {
  const offenders = [];
  root.walkAtRules((atrule) => {
    if (decodeCssIdentifier(atrule.name).toLowerCase() !== 'property') return;
    const name = cssTrim(atrule.params);
    if (!hasProtectedPrefix(name)) return;
    offenders.push(`@property ${name}@${atrule.source?.start?.line}행(위치: ${describeLocation(atrule.parent)})`);
  });
  return offenders;
}

// FAIL 메시지에 위반 위치를 selector/atrule 체인(바깥→안, 예: `@media (min-width:0) > :root`)으로
// 이어붙인다 — 구조 게이트·컴포넌트 선언 금지 검사가 공유한다.
function describeLocation(node) {
  const parts = [];
  let cur = node;
  while (cur && cur.type !== 'root') {
    if (cur.type === 'rule') parts.unshift(cur.selector);
    else if (cur.type === 'atrule') parts.unshift(`@${cur.name}${cur.params ? ` ${cur.params}` : ''}`);
    cur = cur.parent;
  }
  return parts.join(' > ') || '(root)';
}

// 구조 계약(9라운드) — selector 문자열 열거(구 collectDarkSelectorRules)를 전면 폐기하고 _themes.scss의
// flat 3블록 계약을 postcss AST로 직접 강제한다. selector 열거 방식은 "감시할 selector 목록"을
// 유지하는 접근이었는데, 외부 검수가 그 목록 밖 selector로 두 가지 우회를 실증했다(둘 다 실렌더에서
// indicator 투명화를 일으키는데도 기존 방식으로는 37/37 GREEN이었다):
//  ① `@media (min-width:0){ :root { --color-selected-indicator: …0 !important } }` — `:root`는
//     DARK_SELECTORS 어떤 변형도 아니라서(선택자 문자열 자체가 다르다는 이유로) 다크 규칙으로
//     수집조차 안 됐다. 그런데 `:root`도 `html`에 적용되고 important가 승리하므로 실뷰포트에서는
//     이 규칙이 그대로 이긴다.
//  ② `@supports (display:block){ html[data-theme='dark']:root { …0 !important } }` — 이번엔 selector
//     문자열이 DARK_SELECTORS 어떤 변형과도 완전 동일 문자열이 아니라서(`:root` 접미가 붙어) 역시
//     안 걸렸다.
// 두 우회의 공통점은 "실렌더에서 이기는가"(root 직속 여부·important)와 무관하게 오직 "감시 목록에
// 있는 정확한 selector 문자열인가"만으로 판정했다는 것 — 그래서 selector 매칭 자체를 버리고, "보호
// 네임스페이스는 정해진 세 블록 밖 어디서도 선언될 수 없다"는 존재 자체 금지로 뒤집는다. selector가
// 무엇이든(`:root`든 `html[...]:root`든 그 무엇이든) 3블록 밖이면 무조건 FAIL — 우회 불가능한
// 화이트리스트(3블록만 예외)다.
function structuralGate(themesCss) {
  const root = postcss.parse(themesCss);
  const rootRules = [];
  root.walkRules((rule) => {
    if (rule.parent.type === 'root') rootRules.push(rule);
  });

  if (rootRules.length !== 3) {
    const where = rootRules
      .map((r) => `"${r.selector}"@${r.source?.start?.line}행`)
      .join(', ') || '(없음)';
    throw new Error(
      `_themes.scss 3블록 계약 위반: root 직속 규칙이 정확히 3개([라이트 :root, 다크 html[data-theme=dark], ` +
      `별칭 :root])여야 하는데 ${rootRules.length}개 발견 — ${where}`,
    );
  }

  const [lightRule, darkRule, aliasRule] = rootRules;
  // I1(18R): selectorMatches와 동일한 CSS 공백 전용 정규화 + 파서-레벨 JS trim 손실 가드를 적용한다.
  // `html[data-theme=dark]<NBSP>`가 JS trim으로 다크 블록으로 오인되던 경로를 fail-closed로 닫는다.
  const cssSafeSelector = (rule) =>
    (JS_ONLY_WS_RE.test(rule.selector) ? null : normalizeCssWhitespace(rule.selectors[0] ?? ''));
  const isPlainRoot = (rule) => rule.selectors.length === 1 && cssSafeSelector(rule) === ':root';
  const isDarkForm = (rule) =>
    rule.selectors.length === 1 && DARK_SELECTORS.includes(cssSafeSelector(rule));

  if (!isPlainRoot(lightRule)) {
    throw new Error(`_themes.scss 3블록 계약 위반: 1번째 블록(라이트)은 ':root' 단독이어야 하는데 "${lightRule.selector}"(${lightRule.source?.start?.line}행)`);
  }
  if (!isDarkForm(darkRule)) {
    throw new Error(`_themes.scss 3블록 계약 위반: 2번째 블록(다크)은 html[data-theme=dark] 계열(quote 무관) 단독이어야 하는데 "${darkRule.selector}"(${darkRule.source?.start?.line}행)`);
  }
  if (!isPlainRoot(aliasRule)) {
    throw new Error(`_themes.scss 3블록 계약 위반: 3번째 블록(별칭)은 ':root' 단독이어야 하는데 "${aliasRule.selector}"(${aliasRule.source?.start?.line}행)`);
  }

  // 보호 토큰 네임스페이스 선언 전수 검사 — "위 3개 rule 노드와 identity가 같은가"로만 판정한다
  // (selector 문자열 재비교가 아니다). @media/@supports 등으로 감싸 selector 텍스트를 3블록과 완전히
  // 동일하게(①) 또는 다르게(②) 만들어도 그 rule 노드는 3블록과 별개 객체이므로 절대 우회 불가 —
  // walkDecls는 @media/@supports 등 atrule 내부·다른 selector·중첩 무관 전수를 방문한다.
  const legitBlocks = new Set(rootRules);
  const offenders = [];
  root.walkDecls((decl) => {
    if (!hasProtectedPrefix(decl.prop)) return;
    const inLegitBlock = decl.parent.type === 'rule' && legitBlocks.has(decl.parent);
    if (inLegitBlock) return;
    offenders.push(`${decl.prop}@${decl.source?.start?.line}행(위치: ${describeLocation(decl.parent)})`);
  });
  // I4(18R): @property 등록은 3블록(rule 노드) 안에 있을 수 없는 at-rule이므로 발견 즉시 위반이다.
  offenders.push(...findProtectedPropertyRegistrations(root));
  if (offenders.length > 0) {
    throw new Error(
      `_themes.scss 3블록 계약 위반: 보호 토큰(${PROTECTED_TOKEN_PREFIXES.join('/')}) 선언/등록이 3블록 밖에서 ` +
      `발견됨 — ${offenders.join('; ')}`,
    );
  }

  // I1(19R) shape contract — cascade winner를 **계산**하는 대신 "cascade가 자명해지는 형태"만 통과시킨다.
  // 각 블록에서 보호 토큰은 정확히 1개 선언(2개 이상=중복 offender)이고 !important를 쓰지 않는다(offender).
  // 이 유일 선언의 AST 값이 곧 baseline이다(buildBlockValues). 선재현(수정 전 현행 HEAD): LIGHT_BASELINE은
  // Object.fromEntries(후행 승리), SHADOW_XS_BASELINE.light는 정규식 .exec(첫 매치), buildDarkValues는
  // 다크 블록만 봐서 — 라이트에 `--shadow-xs: none !important` 중복이나 indicator `transparent !important`
  // 중복을 주입해도 372/372 통과했다(Chrome 계산값과 baseline이 어긋나는 false-green). 중복·!important
  // 자체를 offender로 접으면 "cascade가 자명"해져 첫/후행/중요도 어느 것을 읽든 결과가 같아진다 —
  // 그래서 게이트가 브라우저 cascade를 재구현할 필요가 없다(17R가 폐기한 실패 모드로 되돌아가지 않는다).
  // "0개"는 여기서 잡지 않는다: 모든 토큰이 모든 블록에 있는 게 아니며, 특정 토큰의 부재는 baseline
  // 단정(undefined ≠ 기대 리터럴)이 RED로 잡는다. escaped 이름(`\--color-x`)도 decodeCssIdentifier로
  // 실이름 그룹핑해 중복을 세므로 I3식 이름 비대칭 우회가 불가능하다.
  const shapeOffenders = [];
  for (const [blockName, rule] of [['라이트', lightRule], ['다크', darkRule], ['별칭', aliasRule]]) {
    const byToken = new Map(); // 디코딩된 실이름 → [{ important, line }]
    rule.walkDecls((decl) => {
      if (!hasProtectedPrefix(decl.prop)) return;
      const name = decodeCssIdentifier(decl.prop);
      if (!byToken.has(name)) byToken.set(name, []);
      byToken.get(name).push({ important: !!decl.important, line: decl.source?.start?.line });
    });
    for (const [name, ds] of byToken) {
      if (ds.length > 1) shapeOffenders.push(`${blockName} 블록 ${name} 선언 ${ds.length}개(중복 — cascade 비자명, ${ds.map((d) => `${d.line}행`).join('·')})`);
      for (const d of ds) if (d.important) shapeOffenders.push(`${blockName} 블록 ${name} !important(${d.line}행 — cascade 비자명)`);
    }
  }
  if (shapeOffenders.length > 0) {
    throw new Error(`_themes.scss shape contract 위반(보호 토큰 블록당 1선언·!important 금지): ${shapeOffenders.join('; ')}`);
  }

  return { root, lightRule, darkRule, aliasRule };
}

// 핀 대상 컴포넌트(및 임의 사이트 파일)가 보호 네임스페이스를 "선언"하는지 전수 검사한다(9라운드).
// 이 파일들은 var(--color-x) 같은 소비만 정상이고, `.Foo { --color-x: … }`처럼 조상 스코프에
// 재선언하면 그 서브트리 전체의 캐스케이드 값을 오염시킨다 — 컴포넌트는 소비 전용 계약이다.
// I4(18R): 일반 declaration에 더해 @property 등록(atrule.params)도 같은 계약으로 금지한다.
function findProtectedDeclarations(cssText) {
  const root = postcss.parse(cssText);
  const offenders = [];
  root.walkDecls((decl) => {
    if (!hasProtectedPrefix(decl.prop)) return;
    offenders.push(`${decl.prop}@${decl.source?.start?.line}행(위치: ${describeLocation(decl.parent)})`);
  });
  offenders.push(...findProtectedPropertyRegistrations(root));
  return offenders;
}

// I1(24R) — styles 전역 color-scheme 금지. P4 스윕(findProtectedDeclarations)은 `--color-/--track-/--shadow-`
// 보호 **custom property**만 봤다. 그런데 `color-scheme`(non-custom, `--` 아님)는 :root의 네이티브 컨트롤·
// 스크롤바 라이트/다크를 통째로 바꾸는 전역 스위치이고 정본은 오직 `_themes.scss`(라이트/다크 블록)다.
// 격리 실증: `_themes.scss`보다 뒤 import되는 `fonts.css`(_app.js: _themes→globals→fonts 순)에
// `:root{color-scheme:dark!important}`를 넣어도 findProtectedDeclarations는 `--` 접두가 아니라 blind →
// 486 GREEN인데 라이트 화면 네이티브 컨트롤·스크롤바가 실제 dark로 강제되는 제품 회귀(selector 동치성/JS
// 런타임 예외 아님, 정적 styles 인벤토리 스코프 안). 기존 compile/normalize(siteCssText)→postcss AST
// 파이프라인을 **그대로 재사용**해(새 파이프라인 없음) `color-scheme` 선언을 위치·selector·중첩 무관 전면
// 금지한다. 이름 비교는 이 파일의 유일 디코더 decodeCssIdentifier(escape 복원)+toLowerCase 후 —
// escaped(`color-\73 cheme`)/case 변형(`COLOR-SCHEME`)까지 닫는다(regular property는 스펙상 대소문자 무시).
// 적대적 스코프 판단: 다른 테마성 non-custom property는 **함께 금지하지 않는다** — `accent-color`는 스타일에
// input[type=checkbox] 등 컴포넌트 스코프로 9곳 정당 사용(전역 금지 시 false-positive), `forced-color-adjust`는
// 레포 사용 0. color-scheme만이 `_themes`가 :root에서 소유하는 전역 네이티브-테마 스위치라 여기만 좁게 닫는다.
const STYLES_FORBIDDEN_NONCUSTOM_PROPS = ['color-scheme'];
function findColorSchemeDeclarations(cssText) {
  const root = postcss.parse(cssText);
  const offenders = [];
  root.walkDecls((decl) => {
    const name = decodeCssIdentifier(decl.prop).toLowerCase();
    if (!STYLES_FORBIDDEN_NONCUSTOM_PROPS.includes(name)) return;
    offenders.push(`${name} 선언 금지(styles 전역 — 정본은 _themes.scss)@${decl.source?.start?.line}행(위치: ${describeLocation(decl.parent)})`);
  });
  return offenders;
}

// P3(역방향, 내부 리뷰 지적) — 위 스캔들은 전부 "보호 접두가 3블록 '밖'에서 선언되면 안 된다"는
// 한 방향만 본다. 반대 방향(3블록 '안'에 PROTECTED_TOKEN_PREFIXES 밖의 새 토큰 패밀리가 섞여도
// 아무도 안 잡는다)은 열린 구멍이었다 — 예: 4번째 접두(예: --spacing-)가 도입돼 3블록에 추가돼도
// findProtectedDeclarations/structuralGate 무엇도 감지 못한다. rules는 postcss Rule 노드 배열
// (구조 게이트가 반환한 lightRule/darkRule/aliasRule 또는 synthetic 단일 rule)이고, 각 rule의
// decl을 훑어 '--'로 시작하지만 보호 접두 3종 어디에도 안 속하는 선언을 offenders로 모은다.
// color-scheme 같은 일반 프로퍼티는 '--' 접두가 아니므로 애초에 대상이 아니다.
// I1(13라운드) — decl.prop을 **정확히 한 번 디코딩한 지역 변수**로 custom-property 여부와 보호 접두를
// 모두 판정한다. 이전엔 raw `decl.prop.startsWith('--')`를 디코딩 전에 검사해, 선행 하이픈이 escape된
// 이름(`\--unprotected-x`·`-\-unprotected-x`·`\2d -unprotected-x`·`-\2d unprotected-x` — 전부 디코딩
// 결과 --unprotected-x)이 raw로는 `--`로 시작하지 않아 탈락 → 역방향 게이트가 새 비보호 토큰 패밀리를
// 놓쳤다(offender 0). 기존 케이스(--\75 nprotected-x)는 raw가 이미 --로 시작해 이 구멍을 미검증했다.
// offender 메시지는 원문(raw) decl.prop을 유지한다(기존 계약).
function findUnprotectedDeclarations(rules) {
  const offenders = [];
  for (const rule of rules) {
    rule.walkDecls((decl) => {
      const decoded = decodeCssIdentifier(decl.prop); // 정확히 한 번 디코딩
      if (!decoded.startsWith('--')) return; // 디코딩값으로 custom-property 판정
      if (!PROTECTED_TOKEN_PREFIXES.some((p) => decoded.startsWith(p))) offenders.push(`${decl.prop}@${decl.source?.start?.line}행`);
    });
  }
  return offenders;
}

// P2(내부 리뷰) → **I4(18R)에서 폐쇄**. `@property --color-x { … }` 등록 at-rule은 프로퍼티명이
// atrule.params에 있어 decl.prop 기반 스캔 셋 모두가 놓쳤다(선재현 offenders 0). 이제
// findProtectedPropertyRegistrations가 findProtectedDeclarations(핀 5파일·P4 styles/ 전체 스윕)와
// structuralGate 양쪽에 배선돼 있다. **남는 명시 예외**: JS 런타임 `CSS.registerProperty({name:
// '--color-x', …})`는 CSS 텍스트가 아니라 이 정적 게이트의 입력 인벤토리(styles/**/*.{scss,css}) **밖**
// 이다 — 아래 "명시 예외 전수" describe가 이 범위를 문서·단정으로 고정한다(현재 레포 사용처 0건).

// I1(19R) — 한 블록의 "유일 선언 AST 값" 맵. shape contract(structuralGate)가 보호 토큰 블록당 1선언·
// !important 금지를 이미 강제했으므로, cascade를 계산할 필요 없이 그 유일 선언의 값을 그대로 읽는다
// (17R가 폐기한 cascade 재구현으로 돌아가지 않는다). 이전 buildDarkValues는 reduceEffectiveDecls로
// cascade winner를 **계산**했는데, 그건 "다른 baseline이 cascade에 취약"하다는 진단의 정확한 대상이었다.
// prop 키는 "--" 접두를 뗀 형태(예: "color-bg"). decodeCssIdentifier로 escaped 이름을 실이름으로 복원해
// 읽는다(shape contract의 중복 그룹핑과 동일 경로). custom property가 아닌 선언(color-scheme 등)은 제외.
function buildBlockValues(rule) {
  const values = {};
  rule.walkDecls((decl) => {
    const name = decodeCssIdentifier(decl.prop);
    if (!name.startsWith('--')) return;
    values[name.slice(2)] = cssTrim(decl.value);
  });
  return values;
}
// 라이트/다크 블록 baseline — structuralGate가 shape contract를 강제하므로, 중복·!important가 있으면
// 여기 도달하기 전에 throw한다(= 잘못된 baseline을 읽지 않는다). LIGHT_BASELINE·SHADOW_XS_BASELINE·
// 다크 대비 단정 전부가 이 두 진입점을 공유한다(로직 중복·drift 방지).
function buildLightValues(themesCss) {
  return buildBlockValues(structuralGate(themesCss).lightRule);
}
function buildDarkValues(themesCss) {
  return buildBlockValues(structuralGate(themesCss).darkRule);
}

// I1(20R) — 디코딩 AST 키 맵(단일 원천). structuralGate가 3블록·shape를 강제한 뒤 각 블록의 custom
// property 키를 buildBlockValues(decodeCssIdentifier)로 실이름 복원해 수집한다 — shape·대칭·배타성·
// baseline이 전부 이 한 경로를 공유한다(raw 정규식 키 집합 파생 폐기). escaped 선행하이픈/hex escape가
// 라이트를 덮어써도 실이름으로 복원돼 배타성 교집합에 잡힌다(위 'I1(20R)' describe가 선재현↔RED 고정).
// 키는 buildBlockValues와 동일하게 `--` 접두를 뗀 형태(예: 'color-bg').
function decodedThemeKeySets(themesCss) {
  const { lightRule, darkRule, aliasRule } = structuralGate(themesCss);
  const keys = (rule) => new Set(Object.keys(buildBlockValues(rule)));
  return { light: keys(lightRule), dark: keys(darkRule), aliases: keys(aliasRule) };
}
// 실 _themes.scss 파생 — 이전 raw 정규식 `const [light,dark,aliases]`를 대체한다. 모든 소비처
// (대칭·배타성·브리지/var 커버리지)가 이 디코딩 집합을 쓴다. 실 파일엔 escape가 없어 값은 동일(GREEN 유지).
const { light, dark, aliases } = decodedThemeKeySets(css);

// ─────────────────────────────────────────────────────────────────────────────
// I1(22R) — color-scheme 구조 계약. 21R manifest(buildBlockValues)는 **custom property만** 수집해
// (디코딩값 `--` 시작 아닌 선언 제외) 같은 블록의 `color-scheme` 값이 무방비였다: 외부 검수 격리 실증에서
// `:root{color-scheme:light}` ↔ `html[data-theme=dark]{color-scheme:dark}` 값 swap이 461/461 통과했다
// (토큰 색은 유지되나 **네이티브 입력 컨트롤·스크롤바의 라이트/다크가 반대로 적용**되는 실제 제품 회귀).
// 브라우저 의미론 모델을 추가하지 않고(17R 교훈) 세 블록의 non-custom-property 선언을 **구조 계약**으로만
// 좁게 고정한다:
//   · light 블록: `color-scheme: light` 정확히 1개
//   · dark 블록 : `color-scheme: dark`  정확히 1개
//   · alias 블록: `color-scheme` 없음
//   · 그 외 — 중복·삭제(부재)·!important·color-scheme 아닌 다른 일반 선언 = RED
//     (테마 블록의 non-custom-property 선언은 color-scheme 외 등장 자체가 offender다).
// 값은 리터럴이라 디코딩/파싱 불요. 블록 3판정은 structuralGate를 **재사용**한다(새 블록 파서 없음).
// custom property(디코딩값 `--` 시작)는 manifest·shape contract가 담당하므로 여기선 손대지 않는다.
// structuralGate 본체에 넣지 않고 **인접 전용 단정**으로 둔다 — 다른 mutation describe의 합성 SCSS는
// color-scheme를 안 실어서, 게이트에 병합하면 그 describe들이 전부 throw로 깨진다(현행 461 계약 보존).
const COLOR_SCHEME_CONTRACT = [
  ['라이트', 'light'],
  ['다크', 'dark'],
  ['별칭', null], // color-scheme 금지
];
function colorSchemeOffenders(themesCss) {
  const { lightRule, darkRule, aliasRule } = structuralGate(themesCss);
  const rules = { 라이트: lightRule, 다크: darkRule, 별칭: aliasRule };
  const offenders = [];
  for (const [blockName, expected] of COLOR_SCHEME_CONTRACT) {
    const schemeDecls = [];
    rules[blockName].walkDecls((decl) => {
      const name = decodeCssIdentifier(decl.prop);
      if (name.startsWith('--')) return; // custom property는 manifest/shape가 담당
      if (name.toLowerCase() !== 'color-scheme') {
        offenders.push(`${blockName} 블록 비허용 일반 선언 ${decl.prop}@${decl.source?.start?.line}행`);
        return;
      }
      schemeDecls.push({ value: cssTrim(decl.value).toLowerCase(), important: !!decl.important, line: decl.source?.start?.line });
    });
    if (expected === null) {
      for (const d of schemeDecls) offenders.push(`${blockName} 블록 color-scheme 금지인데 존재(${d.line}행)`);
      continue;
    }
    if (schemeDecls.length === 0) offenders.push(`${blockName} 블록 color-scheme 누락(기대 ${expected})`);
    if (schemeDecls.length > 1) offenders.push(`${blockName} 블록 color-scheme 중복 ${schemeDecls.length}개(${schemeDecls.map((d) => `${d.line}행`).join('·')})`);
    for (const d of schemeDecls) {
      if (d.important) offenders.push(`${blockName} 블록 color-scheme !important(${d.line}행)`);
      if (d.value !== expected) offenders.push(`${blockName} 블록 color-scheme 값 오류: 기대 ${expected}, 실제 ${d.value}(${d.line}행)`);
    }
  }
  return offenders;
}

// ─────────────────────────────────────────────────────────────────────────────
// I1(23R) — root 노드 인벤토리 exact 고정. structuralGate는 root 직속 "rule 개수 3개"만 센다
// (walkRules + parent.type==='root' 필터). 그래서 at-rule(@media/@supports/@layer/@import/@font-face 등)이
// 3블록 앞/뒤/사이에 추가돼도 rootRules에 안 잡혀 통과했다 — 격리 실증: `_themes.scss` 끝에
// `@media (min-width:0px){ :root { color-scheme: dark } }`(항상-참 조건) 추가가 472/472 GREEN인데,
// 그 후행 `:root{color-scheme:dark}`가 **라이트 화면의 네이티브 컨트롤·스크롤바를 실제 dark로** 바꾸는
// 제품 회귀다(정적 _themes.scss 안·exact selector라 범위 밖 아님). selector 의미론 모델을 추가하지 않고
// (17R 교훈) **구조 인벤토리**로만 닫는다: comment 외 root.nodes가 정확히 [lightRule, darkRule, aliasRule]
// 세 identity와 **개수+동일성+순서**로 일치해야 한다. 3블록 판정은 structuralGate 재사용(새 파서 없음).
// colorSchemeOffenders와 같은 이유로 structuralGate 본체가 아닌 **인접 전용 단정**으로 둔다 — 게이트에
// 병합하면 3블록 밖 노드를 의도적으로 실어 특정 throw 메시지(/보호 토큰|3블록/ 등)를 단정하는 다른
// describe들이 깨진다(현행 472 계약 보존). structuralGate가 count/shape로 **먼저 throw**하는 mutation
// (4번째 rule 등)은 이 함수 진입 전에 이미 RED다. 같은 "count≠identity" 처방은 19R I2가 CORPUS를
// `length >= 90` count에서 순서 고정 exact manifest로 바꾼 것과 동일 계열이다.
// ─────────────────────────────────────────────────────────────────────────────
// postcss 노드 1개를 사람이 읽을 타입 라벨로. rootInventoryOffenders(root 직속)와 ruleChildTypeOffenders
// (블록 직속 자식)가 공유한다(로컬 중복 제거) — 둘 다 "이 위치에 있으면 안 되는 노드"를 지목한다.
function describeCssNode(n) {
  return n.type === 'rule' ? `rule ${n.selector}`
    : n.type === 'atrule' ? `@${n.name}${n.params ? ` ${n.params}` : ''}`
      : n.type === 'decl' ? `decl ${n.prop}` : n.type;
}
function rootInventoryOffenders(themesCss) {
  const { root, lightRule, darkRule, aliasRule } = structuralGate(themesCss);
  const expected = [lightRule, darkRule, aliasRule];
  const meaningful = root.nodes.filter((n) => n.type !== 'comment');
  const offenders = [];
  if (meaningful.length !== expected.length) {
    offenders.push(
      `root 직속 의미 노드 ${meaningful.length}개(기대 ${expected.length}, comment 제외): ` +
      meaningful.map((n) => `${describeCssNode(n)}@${n.source?.start?.line}행`).join(', '),
    );
  }
  meaningful.forEach((node, i) => {
    if (node !== expected[i]) {
      offenders.push(`root 인덱스 ${i} 노드가 3블록 identity와 불일치: ${describeCssNode(node)}@${node.source?.start?.line}행`);
    }
  });
  return offenders;
}

// ─────────────────────────────────────────────────────────────────────────────
// I2(24R) — rule→직접 자식 우주 고정. rootInventoryOffenders(23R)는 root **직속 노드**만 exact 고정한다.
// 그런데 colorSchemeOffenders·structuralGate shape·buildBlockValues는 전부 `rule.walkDecls()` **재귀**라
// 3블록 안 어딘가 중첩된 노드의 선언을 그 블록의 직접 선언처럼 집계했다. 격리 실증(raw/native-nesting CSS):
//   :root { --color-bg:#fff; @media (min-width:99999px) { color-scheme:light } }
// → root 3-rule 통과(중첩 @media는 top-level 노드가 아니라 rootInventoryOffenders도 못 봄)·재귀 walker상
//   color-scheme:light 1개 인정(colorSchemeOffenders GREEN)·shape/manifest 정상 — 그런데 media 불일치 시
//   라이트 root에 color-scheme 미적용(계약이 실제와 어긋나는 false-green). Sass 1.97.3 경유는 중첩 @media를
//   hoist해 top-level at-rule로 빼므로 rootInventoryOffenders(23R)가 RED로 잡지만(실측), **raw CSS(native
//   nesting)는 hoist 없이 중첩 유지**라 그 방어가 성립 안 한다(실측: 중첩 노드의 parent가 @media/nested-rule).
// 처방(브라우저 의미론 모델 추가 없이, 17R 교훈): 세 legit rule 각각에서 **comment 제외 직접 자식이 전부
// `decl`인지** 구조로 고정한다 — nested rule/nested at-rule(@media/@supports/@layer 등) 등장 = offender.
// 이로써 root(23R)→rule 자식 타입(24R)→decl 분할(19~22R)→값(21R) 귀납이 실제 코드와 일치하고, 위 세
// 재귀 walker가 중첩 노드를 직접 선언으로 오인할 여지 자체가 사라진다(그 재귀들의 공동 backstop).
// rootInventoryOffenders와 같은 이유로 structuralGate 본체가 아닌 **인접 전용 단정**으로 둔다 — 3블록 판정은
// structuralGate 재사용(새 파서 없음). structuralGate가 count/shape/보호토큰으로 **먼저 throw**하는 mutation은
// 이 함수 진입 전에 이미 RED다.
// ─────────────────────────────────────────────────────────────────────────────
function ruleChildTypeOffenders(themesCss) {
  const { lightRule, darkRule, aliasRule } = structuralGate(themesCss);
  const offenders = [];
  for (const [blockName, rule] of [['라이트', lightRule], ['다크', darkRule], ['별칭', aliasRule]]) {
    for (const child of rule.nodes) {
      if (child.type === 'comment') continue; // comment는 선언 아님 — cascade에 무영향이라 예외
      if (child.type !== 'decl') {
        offenders.push(`${blockName} 블록 직접 자식이 decl 아님(중첩 노드는 재귀 walker가 직접 선언으로 오인): ${describeCssNode(child)}@${child.source?.start?.line}행`);
      }
    }
  }
  return offenders;
}

describe('_themes.scss 구조 계약 — flat 3블록 강제 (selector 매칭→구조 게이트 전환, 9라운드)', () => {
  it('실 파일이 3블록 계약을 만족한다(형태·순서·보호 토큰 3블록 밖 배타성)', () => {
    expect(() => structuralGate(css)).not.toThrow();
  });
});

describe('3블록 내 모든 custom property는 보호 접두 3종 중 하나 (P3 — 역방향 완전성)', () => {
  it('라이트/다크/별칭 블록의 모든 --custom-property가 --color-/--track-/--shadow- 중 하나로 시작한다', () => {
    const { lightRule, darkRule, aliasRule } = structuralGate(css);
    const offenders = findUnprotectedDeclarations([lightRule, darkRule, aliasRule]);
    expect(
      offenders,
      `보호 접두 밖 토큰 발견 — 새 토큰 패밀리면 PROTECTED_TOKEN_PREFIXES에 추가하라: ${offenders.join('; ')}`,
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I2(18R) — canonical opaque layer가 참조하는 `--shadow-xs`의 **값 자체**를 exact baseline으로 고정한다.
// 층 1은 `var(--shadow-xs)`를 "완전 그림자로 확장되는 불투명 레이어"로 **전제**하고 통과시킨다. 그
// 전제는 토큰 값에 달려 있는데 이전엔 아무도 검사하지 않았다: `_themes.scss`에서 `--shadow-xs: none`
// 으로 바꾸면 실 CSS가 `box-shadow: none, inset …`이 되어 **Chrome 계산값이 none**(레이어 문법 위반으로
// 선언 전체 폐기)인데도 선언 문자열은 그대로라 296/296 GREEN이었다. LIGHT_BASELINE과 동일한 방식으로
// 라이트·다크 두 값을 리터럴 고정한다 — 값이 바뀌면(none·무효값·톤 변경) 여기서 즉시 RED다.
// ─────────────────────────────────────────────────────────────────────────────
// I1(21R): 리터럴 중복 제거 — THEME_VALUE_MANIFEST 단일 원천에서 파생(값 동일, GREEN 유지).
const SHADOW_XS_BASELINE = {
  light: THEME_VALUE_MANIFEST.light['shadow-xs'],
  dark: THEME_VALUE_MANIFEST.dark['shadow-xs'],
};
describe('--shadow-xs exact baseline (I2 — canonical opaque layer 전제 보호)', () => {
  it('canonical opaque layer는 정확히 var(--shadow-xs) 하나다(전제의 대상 고정)', () => {
    expect(CANON_SHADOW_OPAQUE_LAYER).toBe('var(--shadow-xs)');
  });
  it('라이트 값이 실측 리터럴과 일치 — none/무효값 치환 시 RED', () => {
    // I1(19R): .exec 첫 매치(선재현 우회 지점) 대신 shape 강제 유일 선언 경로(buildLightValues)로 읽는다.
    expect(buildLightValues(css)['shadow-xs']).toBe(SHADOW_XS_BASELINE.light);
  });
  it('다크 값이 실측 리터럴과 일치 — none/무효값 치환 시 RED', () => {
    expect(buildDarkValues(css)['shadow-xs']).toBe(SHADOW_XS_BASELINE.dark);
  });
  it('두 값 모두 파싱 가능한 그림자 값이다(빈 값·none류 회귀 이중 방어)', () => {
    for (const [k, v] of Object.entries(SHADOW_XS_BASELINE)) {
      expect(v, k).toMatch(/^0 1px 2px rgba\(0, 0, 0, 0\.[0-9]+\)$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I1(21R) — 전체 테마 값 manifest 검증 + 선재현↔RED mutation. buildBlockValues(shape 강제 유일 선언 값)를
// 3블록 전부에 적용해 {key,value} 전체를 THEME_VALUE_MANIFEST 단일 원천과 대조한다. LIGHT_BASELINE/
// SHADOW_XS_BASELINE은 이 manifest에서 파생되므로(위) 부분 baseline이 곧 이 원천의 부분집합이다.
// ─────────────────────────────────────────────────────────────────────────────
function themeValueManifest(themesCss) {
  const { lightRule, darkRule, aliasRule } = structuralGate(themesCss);
  return {
    light: buildBlockValues(lightRule),
    dark: buildBlockValues(darkRule),
    aliases: buildBlockValues(aliasRule),
  };
}

describe('전체 테마 값 manifest — light/dark/alias 전 토큰 {key,value} 단일 원천 고정 (I1 21R)', () => {
  const actual = themeValueManifest(css);
  it('실 _themes.scss 3블록 값 전체가 manifest와 정확히 일치한다 (deep-equal — 무결성 잠금)', () => {
    // toEqual은 키·값 양방향 exact 대조라 (a) 값 변경 (b) 토큰 추가/삭제 (c) manifest 미고정 토큰을 전부
    // 잡는다. 라이트·다크 `--track-paper` transparent 회귀가 여기서 RED가 된다(선재현: 부분 baseline은 통과).
    expect(actual).toEqual(THEME_VALUE_MANIFEST);
  });
  it('블록별 토큰 커버리지 — manifest가 buildBlockValues 키 집합을 정확히 덮는다 (미고정 토큰 0)', () => {
    // 적대적 자가 재검토: 값이 고정되지 않은 토큰이 하나라도 있으면 여기서 드러난다(대칭 커버리지 대조).
    // deep-equal(위)의 부분집합이지만 독립 신호로 남긴다 — 본 assertion이 약화돼도 3블록 키셋을 각각 지킨다.
    // 카디널리티는 하드코딩하지 않고 manifest(단일 원천)에서 파생 — 토큰 증감 시 손으로 동기화할 리터럴 없음.
    for (const block of ['light', 'dark', 'aliases']) {
      expect(Object.keys(actual[block]).sort(), block).toEqual(Object.keys(THEME_VALUE_MANIFEST[block]).sort());
    }
  });
  it('부분 baseline 뷰(LIGHT_BASELINE·SHADOW_XS_BASELINE)는 전체 manifest 키의 부분집합이다 (통합·중복 제거 확인)', () => {
    // 부분 baseline은 이제 manifest에서 파생되므로 리터럴 중복이 없다 — orphan 키(=undefined 파생) 0을 단정한다.
    const lightKeys = new Set(Object.keys(THEME_VALUE_MANIFEST.light));
    for (const k of LIGHT_BASELINE_KEYS) expect(lightKeys.has(k), k).toBe(true);
    expect(Object.values(LIGHT_BASELINE).every((v) => v !== undefined)).toBe(true);
    expect('shadow-xs' in THEME_VALUE_MANIFEST.light).toBe(true);
    expect('shadow-xs' in THEME_VALUE_MANIFEST.dark).toBe(true);
  });
});

describe('I1(21R) manifest 선재현↔RED mutation — 값 기준 무결성(소스 무관)', () => {
  // 합성 3블록 SCSS를 compileString→structuralGate→buildBlockValues로 **실제 컴파일 경로 그대로** 통과시켜
  // base manifest를 얻고, 각 mutation이 deep-equal(=무결성 게이트)에서 RED/GREEN으로 갈리는 지점을 고정한다.
  // `#{$_s}`(보간)와 `#F9FAFB`(리터럴)가 같은 값으로 컴파일되므로 "소스 표현만 다르면 GREEN"이 실증된다.
  const synth = (o = {}) => {
    const { tpL = '#{$_s}', tpD = '#17181C', aliasVal = 'var(--color-bg)', bgL = '#FFFFFF' } = o;
    return `$_s: #F9FAFB;
      :root { color-scheme: light; --color-bg: ${bgL}; --track-paper: ${tpL}; --shadow-xs: 0 1px 2px rgba(0,0,0,0.04); }
      html[data-theme='dark'] { --color-bg: #0E0F11; --track-paper: ${tpD}; --shadow-xs: 0 1px 2px rgba(0,0,0,0.4); }
      :root { --color-alias: ${aliasVal}; }`;
  };
  const manifestOf = (o) => themeValueManifest(compileString(synth(o)).css);
  const base = manifestOf();

  it('base 합성이 실 파이프라인(compile→structuralGate→buildBlockValues)을 통과한다', () => {
    expect(base.light['track-paper']).toBe('#F9FAFB');   // #{$_s} 보간 결과
    expect(base.dark['track-paper']).toBe('#17181C');
    expect(base.aliases['color-alias']).toBe('var(--color-bg)'); // 별칭 참조 문자열 그대로
  });
  it('① 라이트 값만 변경 → manifest deep-equal RED (다크는 격리)', () => {
    const mut = manifestOf({ tpL: '#EEEEEE' });
    expect(mut).not.toEqual(base);
    expect(mut.dark).toEqual(base.dark);
  });
  it('② 다크 값만 변경 → RED (라이트는 격리)', () => {
    const mut = manifestOf({ tpD: '#222222' });
    expect(mut).not.toEqual(base);
    expect(mut.light).toEqual(base.light);
  });
  it('③ 별칭(var 참조 문자열) 값만 변경 → RED', () => {
    const mut = manifestOf({ aliasVal: 'var(--color-surface)' });
    expect(mut).not.toEqual(base);
    expect(mut.aliases['color-alias']).toBe('var(--color-surface)');
  });
  it('④ --track-paper 양쪽 동일 오값(transparent) → RED (제품 회귀 — 부분 baseline은 GREEN이었다)', () => {
    const mut = manifestOf({ tpL: 'transparent', tpD: 'transparent' });
    expect(mut).not.toEqual(base);                       // ← 전체 manifest는 RED
    expect(mut.light['track-paper']).toBe('transparent');
    expect(mut.dark['track-paper']).toBe('transparent');
    // 선재현(왜 부분 baseline이 놓쳤나): (a) 키 대칭 통과(양 블록 동일 키셋) (b) LIGHT_BASELINE에 track-paper 없음.
    expect(Object.keys(mut.light).sort()).toEqual(Object.keys(base.light).sort()); // 옛 대칭 게이트 GREEN
    expect(LIGHT_BASELINE['track-paper']).toBeUndefined();                          // 옛 부분 baseline 미검사
    expect('track-paper' in THEME_VALUE_MANIFEST.light).toBe(true);                 // 이제 전체 manifest가 고정
    expect('track-paper' in THEME_VALUE_MANIFEST.dark).toBe(true);
  });
  it('⑤ Sass 표현만 변경·컴파일 값 동일 → GREEN (값 기준, 소스 무관)', () => {
    const mut = manifestOf({ tpL: '#F9FAFB' }); // `#{$_s}` → 리터럴, 둘 다 #F9FAFB로 컴파일
    expect(mut).toEqual(base);
  });
});

describe('color-scheme 구조 계약 — 세 블록 non-custom-property 선언 고정 (I1 22R)', () => {
  it('실 _themes.scss: light=color-scheme:light·dark=color-scheme:dark·alias=없음, 그 외 일반 선언 0 (offender 0)', () => {
    expect(colorSchemeOffenders(css)).toEqual([]);
  });
  it('적대적 재검토: 세 블록의 non-custom-property 선언은 color-scheme뿐이다(값 미검증 다른 일반 선언 부재)', () => {
    // 같은 클래스의 미래 회귀 방지 — 블록에 color-scheme 외 non-custom-property 선언이 실제로 있는지 확인.
    // 있으면 계약(COLOR_SCHEME_CONTRACT)에 포함해야 하지만, 현행 3블록엔 color-scheme 외 일반 선언이 없다.
    const { lightRule, darkRule, aliasRule } = structuralGate(css);
    const nonCustom = (rule) => {
      const out = [];
      rule.walkDecls((d) => { const n = decodeCssIdentifier(d.prop); if (!n.startsWith('--')) out.push(n.toLowerCase()); });
      return out;
    };
    expect(nonCustom(lightRule)).toEqual(['color-scheme']);
    expect(nonCustom(darkRule)).toEqual(['color-scheme']);
    expect(nonCustom(aliasRule)).toEqual([]);
  });
});

describe('I1(22R) color-scheme 선재현↔RED mutation — manifest 밖 non-custom-property 회귀', () => {
  // 합성 3블록 SCSS를 compileString→(structuralGate 재사용)→colorSchemeOffenders로 실제 컴파일 경로 그대로
  // 통과시켜, swap/delete/duplicate/!important 4형태가 값 manifest에는 안 보이고(선재현: 현행 461 통과 경로가
  // 무방비) color-scheme 계약에서만 RED로 갈리는 지점을 고정한다.
  const synth = (o = {}) => {
    const { lightScheme = 'color-scheme: light;', darkScheme = 'color-scheme: dark;', aliasScheme = '', lightExtra = '' } = o;
    return `:root { ${lightScheme} --color-bg: #FFFFFF; --shadow-xs: 0 1px 2px rgba(0,0,0,0.04); ${lightExtra} }
      html[data-theme='dark'] { ${darkScheme} --color-bg: #0E0F11; --shadow-xs: 0 1px 2px rgba(0,0,0,0.4); }
      :root { ${aliasScheme} --color-alias: var(--color-bg); }`;
  };
  const compiledOf = (o) => compileString(synth(o)).css;
  const offendersOf = (o) => colorSchemeOffenders(compiledOf(o));
  const baseCss = compiledOf();

  it('base 합성이 color-scheme 계약을 통과한다(offender 0)', () => {
    expect(offendersOf()).toEqual([]);
  });

  // 선재현(왜 현행 461이 무방비였나): swap은 custom property만 수집하는 값 manifest에 안 보인다.
  it('선재현: light↔dark swap이 값 manifest deep-equal에는 GREEN(buildBlockValues가 custom property만 수집)', () => {
    const swapped = compiledOf({ lightScheme: 'color-scheme: dark;', darkScheme: 'color-scheme: light;' });
    expect(themeValueManifest(swapped)).toEqual(themeValueManifest(baseCss)); // ← 옛 값 게이트 blind (false-green)
  });

  it('① swap(light↔dark 값) → color-scheme 계약 RED(양쪽 값 오류)', () => {
    const offs = offendersOf({ lightScheme: 'color-scheme: dark;', darkScheme: 'color-scheme: light;' });
    expect(offs.length).toBeGreaterThan(0);
    expect(offs.join(' ')).toMatch(/라이트 블록 color-scheme 값 오류/);
    expect(offs.join(' ')).toMatch(/다크 블록 color-scheme 값 오류/);
  });
  it('② delete(light color-scheme 삭제) → RED(누락)', () => {
    expect(offendersOf({ lightScheme: '' }).join(' ')).toMatch(/라이트 블록 color-scheme 누락/);
  });
  it('③ duplicate(light color-scheme 2개) → RED(중복)', () => {
    expect(offendersOf({ lightScheme: 'color-scheme: light; color-scheme: light;' }).join(' ')).toMatch(/라이트 블록 color-scheme 중복 2개/);
  });
  it('④ !important(light color-scheme !important) → RED', () => {
    expect(offendersOf({ lightScheme: 'color-scheme: light !important;' }).join(' ')).toMatch(/라이트 블록 color-scheme !important/);
  });
  it('⑤ alias 블록에 color-scheme 등장 → RED(별칭 금지)', () => {
    expect(offendersOf({ aliasScheme: 'color-scheme: dark;' }).join(' ')).toMatch(/별칭 블록 color-scheme 금지인데 존재/);
  });
  it('⑥ 테마 블록에 color-scheme 아닌 다른 일반 선언(accent-color) → RED(비허용 일반 선언)', () => {
    expect(offendersOf({ lightExtra: 'accent-color: red;' }).join(' ')).toMatch(/라이트 블록 비허용 일반 선언 accent-color/);
  });
});

describe('_themes.scss root 노드 인벤토리 exact — comment 외 root.nodes == [light,dark,alias] identity (I1 23R)', () => {
  it('실 _themes.scss: comment 외 root 직속 노드가 정확히 3블록 identity 세 개(개수+동일성+순서, offender 0)', () => {
    expect(rootInventoryOffenders(css)).toEqual([]);
  });
  it('적대적 재검토: 인벤토리는 개수가 아니라 세 rule identity(===)를 본다 (count-only 아님)', () => {
    // 개수(3)가 맞아도 다른 노드로 대체되면 identity 불일치로 잡힌다는 것을 실 파일에서 명시한다.
    const { root, lightRule, darkRule, aliasRule } = structuralGate(css);
    const meaningful = root.nodes.filter((n) => n.type !== 'comment');
    expect(meaningful.length).toBe(3);
    expect(meaningful[0]).toBe(lightRule); // 참조 동일(===)
    expect(meaningful[1]).toBe(darkRule);
    expect(meaningful[2]).toBe(aliasRule);
  });
});

describe('I1(23R) root 인벤토리 선재현↔RED mutation — at-rule/4번째/순서 (count-only 게이트가 놓친 구멍)', () => {
  const OK3 = `:root{--color-bg:#fff}html[data-theme='dark']{--color-bg:#000}:root{--color-alias:1}`;
  // 아래 5종은 rootRules 개수 3을 유지하고 3블록 밖 선언(color-scheme)도 보호 접두가 아니라
  // structuralGate가 **통과**한다(현행 count-only 게이트의 false-green). 인벤토리만 RED로 갈린다.
  const passesGateButExtraNode = {
    '@media 추가':    `${OK3}@media (min-width:0px){:root{color-scheme:dark}}`,
    '@supports 추가': `${OK3}@supports (display:block){:root{color-scheme:dark}}`,
    '@layer 추가':    `${OK3}@layer theme{:root{color-scheme:dark}}`,
    '@import 추가':   `${OK3}@import "x.css";`,
    '순서 뒤섞기(at-rule 선두)': `@media (min-width:0px){:root{color-scheme:dark}}${OK3}`,
  };
  it.each(Object.entries(passesGateButExtraNode))(
    '선재현: %s → structuralGate는 여전히 통과(count-only blind, false-green)',
    (_l, mutCss) => { expect(() => structuralGate(mutCss)).not.toThrow(); },
  );
  it.each(Object.entries(passesGateButExtraNode))(
    'RED: %s → rootInventoryOffenders offender>0(3블록 밖 노드 감지)',
    (_l, mutCss) => { expect(rootInventoryOffenders(mutCss).length).toBeGreaterThan(0); },
  );
  it('4번째 rule 추가 → structuralGate가 count(정확히 3개)로 먼저 throw(인벤토리 진입 전 RED)', () => {
    const mut = `${OK3}:root{color-scheme:dark}`;
    expect(() => structuralGate(mut)).toThrow(/정확히 3개|3블록/);
    expect(() => rootInventoryOffenders(mut)).toThrow(); // structuralGate throw를 전파
  });
  it('GREEN 대조: comment 추가(선두·말미·블록 사이)는 무의미 노드라 offender 0', () => {
    expect(rootInventoryOffenders(`/* lead */${OK3}`)).toEqual([]);
    expect(rootInventoryOffenders(`${OK3}/* tail */`)).toEqual([]);
    expect(rootInventoryOffenders(
      `:root{--color-bg:#fff}/* mid */html[data-theme='dark']{--color-bg:#000}:root{--color-alias:1}`,
    )).toEqual([]);
  });
});

describe('_themes.scss rule 직접 자식 타입 exact — 세 블록 직접 자식 전부 decl(comment 제외) (I2 24R)', () => {
  it('실 _themes.scss: 라이트/다크/별칭 블록 직접 자식에 nested rule/at-rule 없음(offender 0)', () => {
    expect(ruleChildTypeOffenders(css)).toEqual([]);
  });
  it('적대적 재검토: 세 블록 직접 자식은 comment를 빼면 전부 decl 타입이다(중첩 노드 부재)', () => {
    // 재귀 walkDecls가 직접 선언으로 오인할 수 있는 중첩 노드가 실제로 있는지 직접 자식 타입으로 확인한다.
    const { lightRule, darkRule, aliasRule } = structuralGate(css);
    const childTypes = (rule) => rule.nodes.filter((n) => n.type !== 'comment').map((n) => n.type);
    for (const rule of [lightRule, darkRule, aliasRule]) {
      expect(new Set(childTypes(rule))).toEqual(new Set(['decl']));
    }
  });
});

describe('I2(24R) rule 자식 우주 선재현↔RED mutation — 재귀 walkDecls 과잉 인정(raw native-nesting)', () => {
  // structuralGate/colorSchemeOffenders/rootInventoryOffenders는 전부 postcss.parse 직접(Sass 미경유)이라
  // native-nesting이 hoist 없이 중첩 유지된다 — 그 상태에서 옛 계약 전부 통과(선재현)↔ruleChildTypeOffenders만
  // RED로 갈리는 지점을 고정한다. light 블록은 **직접** color-scheme 없이 중첩 노드 안에만 color-scheme:light를
  // 실어, 재귀 walker가 그 nested 선언을 라이트의 직접 color-scheme로 오인(false-green)하는 것을 정확히 재현한다.
  const rawThemes = (lightNested) =>
    `:root{--color-bg:#fff;${lightNested}}` +
    `html[data-theme='dark']{color-scheme:dark;--color-bg:#000}` +
    `:root{--color-alias:1}`;
  const nestedNodes = {
    'nested @media(항상-참 min-width:0px)':     '@media (min-width:0px){color-scheme:light}',
    'nested @media(항상-거짓 min-width:99999px)': '@media (min-width:99999px){color-scheme:light}',
    'nested rule(.child)':                       '.child{color-scheme:light}',
    'nested @supports':                          '@supports (display:grid){color-scheme:light}',
  };
  it.each(Object.entries(nestedNodes))(
    '선재현: %s → structuralGate 통과 + rootInventoryOffenders 0 + colorSchemeOffenders 0(재귀 walker false-green)',
    (_l, nested) => {
      const raw = rawThemes(nested);
      expect(() => structuralGate(raw)).not.toThrow();          // 중첩 노드는 3블록 밖 top-level 노드가 아님
      expect(rootInventoryOffenders(raw)).toEqual([]);          // 23R 인벤토리는 top-level만 봐서 blind
      expect(colorSchemeOffenders(raw)).toEqual([]);            // 재귀 walkDecls가 nested color-scheme:light를 라이트 직접으로 오인
    },
  );
  it.each(Object.entries(nestedNodes))(
    'RED: %s → ruleChildTypeOffenders offender>0(라이트 블록 직접 자식에 non-decl)',
    (_l, nested) => {
      const offs = ruleChildTypeOffenders(rawThemes(nested));
      expect(offs.length).toBeGreaterThan(0);
      expect(offs.join(' ')).toMatch(/라이트 블록 직접 자식이 decl 아님/);
    },
  );
  it('브리프 격리 실증(항상-거짓 @media): 옛 전 계약 통과인데 media 불일치 시 라이트 color-scheme 미적용', () => {
    // colorSchemeOffenders는 nested color-scheme:light를 인정(계약 통과)하지만, min-width:99999px는 실뷰포트에서
    // 불일치라 라이트 root에 color-scheme가 실제로는 적용되지 않는다 — 계약↔실제 괴리를 ruleChildTypeOffenders가 닫는다.
    const raw = rawThemes('@media (min-width:99999px){color-scheme:light}');
    expect(colorSchemeOffenders(raw)).toEqual([]);              // 옛 계약 GREEN(false-green)
    expect(ruleChildTypeOffenders(raw).length).toBeGreaterThan(0); // 신 구조 계약 RED
  });
  it('GREEN 대조: comment는 선언 아님 — 직접 color-scheme:light + 블록내 comment는 offender 0', () => {
    const raw = `:root{--color-bg:#fff;/* c */color-scheme:light}` +
      `html[data-theme='dark']{color-scheme:dark;--color-bg:#000}` +
      `:root{--color-alias:1}`;
    expect(() => structuralGate(raw)).not.toThrow();
    expect(colorSchemeOffenders(raw)).toEqual([]);
    expect(ruleChildTypeOffenders(raw)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I1(19R) — baseline은 "유일 선언 AST 값"이다(shape contract). cascade winner를 계산하지 않는다.
// 선재현↔RED 대응표(각 mutation은 수정 전 현행 HEAD에서 372/372 통과 = false-green이었다):
//   (a) 라이트 --shadow-xs 뒤 `none !important` 중복 → SHADOW_XS_BASELINE.light가 .exec 첫 매치라 선행
//       '0 1px 2px…'를 읽어 통과(Chrome 계산값은 none). 이제 중복+important 둘 다 shape offender → throw.
//   (b) 라이트 indicator `transparent !important` 선행 중복 → LIGHT_BASELINE이 Object.fromEntries(후행
//       승리)라 후행 normal을 읽어 통과. 이제 중복+important shape offender → throw.
//   (c) 순서 반전(normal→important, important→normal) 양방향 → 어느 쪽도 중복이라 throw.
// ─────────────────────────────────────────────────────────────────────────────
describe('I1(19R) shape contract — 보호 토큰 블록당 1선언·!important 금지 (선재현↔RED)', () => {
  // 다크/별칭은 정상(각 1선언·important 없음)으로 고정하고 라이트 블록만 변형한다.
  const wrap = (lightBody) => `:root{${lightBody}}html[data-theme=dark]{--color-selected-indicator:#6B7280;--shadow-xs:0 1px 2px rgba(0,0,0,0.4)}:root{--color-b:3}`;
  const OK_LIGHT = '--color-selected-indicator:transparent;--shadow-xs:0 1px 2px rgba(0,0,0,0.04)';

  it('정상 형태(각 보호 토큰 1선언·!important 없음)는 통과하고 유일 선언 값을 읽는다', () => {
    const themes = wrap(OK_LIGHT);
    expect(() => structuralGate(themes)).not.toThrow();
    // 유일 선언 AST 값을 verbatim으로 읽는다(정규화·재포맷 없음 — 입력 그대로).
    expect(buildLightValues(themes)['shadow-xs']).toBe('0 1px 2px rgba(0,0,0,0.04)');
    expect(buildLightValues(themes)['color-selected-indicator']).toBe('transparent');
    expect(buildDarkValues(themes)['shadow-xs']).toBe('0 1px 2px rgba(0,0,0,0.4)');
  });

  it.each([
    ['(a) shadow-xs 뒤 none !important 중복', '--shadow-xs:0 1px 2px rgba(0,0,0,0.04);--shadow-xs:none !important'],
    ['(a\') shadow-xs 단순 중복(중요도 없이도 cascade 비자명)', '--shadow-xs:0 1px 2px rgba(0,0,0,0.04);--shadow-xs:0 2px 4px rgba(0,0,0,0.04)'],
    ['(b) indicator transparent !important 선행 중복', '--color-selected-indicator:transparent !important;--color-selected-indicator:transparent'],
    ['(b\') indicator 단일 !important', '--color-selected-indicator:transparent !important'],
    ['(c) 순서 normal→important', '--color-selected-indicator:transparent;--color-selected-indicator:red !important'],
    ['(c\') 순서 important→normal', '--color-selected-indicator:red !important;--color-selected-indicator:transparent'],
  ])('shape 위반 %s → structuralGate throw (선재현: 현행 HEAD baseline은 통과)', (_l, body) => {
    expect(() => structuralGate(wrap(body))).toThrow(/shape contract/);
  });

  it('baseline 빌더도 유일 선언 경로 — 라이트 중복 주입 시 buildLightValues가 값을 잘못 읽지 않고 throw', () => {
    const mutated = wrap('--color-bg:#FFFFFF;--shadow-xs:0 1px 2px rgba(0,0,0,0.04);--shadow-xs:none !important');
    expect(() => buildLightValues(mutated)).toThrow(/shape contract/);
  });

  it('escaped 이름 중복도 디코딩해 동일 토큰으로 그룹 — 우회 불가(I3식 이름 비대칭 방지)', () => {
    // raw `--shadow-xs`와 escaped `\--shadow-xs`(디코딩 결과 동일)는 같은 토큰 → 중복 offender.
    expect(() => structuralGate(wrap('--shadow-xs:0 1px 2px rgba(0,0,0,0.04);\\--shadow-xs:none'))).toThrow(/shape contract/);
  });

  it('실 _themes.scss는 shape contract를 만족한다(라이트/다크/별칭 전부 보호 토큰 1선언·!important 0)', () => {
    expect(() => structuralGate(css)).not.toThrow();
  });

  it('비보호 토큰(--x)은 shape contract 대상 아님 — 중복·!important 허용(대칭/역방향 게이트가 별도 처리)', () => {
    // structuralGate는 보호 접두(--color-/--track-/--shadow-)만 shape로 본다. --x 중복은 통과.
    const themes = `:root{--color-a:1;--x:A !important;--x:B}html[data-theme=dark]{--color-a:2}:root{--color-b:3}`;
    expect(() => structuralGate(themes)).not.toThrow();
  });
});

describe('다크 selected-indicator 값 시맨틱 고정 (SC 1.4.11 비텍스트 대비 3:1)', () => {
  // 9라운드: dark 블록의 존재·유일성·root-직속 여부·형태(selector 문자열)는 이제 structuralGate
  // (flat 3블록 계약, 파일 상단 참고)가 구조적으로 보장한다 — 위반 시 이 시점에 즉시 throw(위치
  // 포함 명시 메시지)한다. 구 collectDarkSelectorRules의 selector 열거 방식은 폐기됐다: 그 방식은
  // "감시할 selector 문자열 목록"에 의존해 목록 밖 selector(`:root`, `html[...]:root` 등)로 감싼
  // 우회를 놓쳤지만, structuralGate는 selector가 무엇이든 3블록 밖 보호 토큰 선언 자체를 금지하므로
  // 우회 불가능하다. I1(19R): darkRule "내부"의 중복 선언·!important는 이제 shape contract가 offender로
  // 접으므로(cascade가 자명), buildDarkValues는 cascade를 계산하지 않고 유일 선언 AST 값을 그대로 읽는다
  // (buildBlockValues). 7라운드째 문제였던 "다크 블록 내부 !important 개입"은 값 계산 이전에 structuralGate
  // throw로 막힌다. buildDarkValues는 대칭 구멍 B(아래 --color-input-border 대비 describe)와 공유하는 모듈 헬퍼다.
  const darkValues = buildDarkValues(css);

  // ScopeToggle 실제 인접 합성색 — .MyTasks__ScopeBtn--active의 background를 컴파일된 myTasks
  // CSS에서 postcss AST로 그대로 읽어(하드코딩 금지) 다크 surface 위에 알파 합성한다. bg·surface
  // 단독 대비만으로는 실제 렌더 결과보다 대비가 후하게 나와 회귀를 놓친다(외부 검수 실증: indicator
  // #5F6774일 때 bg 3.36·surface 3.11로 통과하지만 실제 합성색 #1E202E 대비는 2.83으로 실패).
  // 매치 규칙 [0]만 읽던 이전 코드는 같은 selector로 뒤에 다시 오는 override(예: `background:
  // rgba(94,106,210,.2);` 재정의)를 놓치고 stale 값으로 GREEN 처리했다(외부 검수 실증, n시나리오)
  // — effectiveValue로 매치 규칙 전부에 cascade를 적용한 최종값 하나만 쓴다.
  const myTasksRoot = postcss.parse(compiledSiteCss('components/myTasks/myTasks.scss'));
  const scopeBtnActiveRules = findRootRules(myTasksRoot, '.MyTasks__ScopeBtn--active');
  const scopeBgFinal = effectiveValue(scopeBtnActiveRules, new Set(['background']))['background']?.value ?? null;
  // resolveColorValue는 M2(19R)에서 모듈 스코프로 승격됐다(헬퍼 직접 테스트 대상 — 파일 상단 정의).
  // 최종값이 rgba/hex 리터럴이면 그대로, `var(--token)` 참조면 darkValues(shape 강제 유일 선언 값)로 재귀
  // 해석한다. 리터럴도 토큰 참조도 아닌(복합 표현식 등) 값은 null → 호출부 not.toBeNull()이 RED로 떨어뜨린다.
  const scopeBgResolved = resolveColorValue(scopeBgFinal, darkValues);
  const scopeToggleAdjacent = scopeBgResolved != null
    ? compositeOver(scopeBgResolved, darkValues['color-surface'])
    : null;

  // 4개 인접색 각각을 독립된 it()로 단정 — 하나로 합쳐 첫 실패에서 bail하면 이후 신호(특히
  // ScopeToggle 합성색)가 실행조차 안 돼 리포트에서 안 보인다. 분리해두면 어떤 인접색이
  // 얼마의 대비로 얼마나 못 미쳤는지 실패 로그에서 개별적으로 확인할 수 있다.
  const indicator = darkValues['color-selected-indicator'];
  it('vs bg 3:1 이상 — transparent 등으로 되돌리면 파싱 실패로 RED', () => {
    expect(contrastOverBg(indicator, darkValues['color-bg']), `indicator=${indicator}`).toBeGreaterThanOrEqual(3);
  });
  it('vs surface 3:1 이상', () => {
    expect(contrastOverBg(indicator, darkValues['color-surface']), `indicator=${indicator}`).toBeGreaterThanOrEqual(3);
  });
  it('vs surface-hover 3:1 이상', () => {
    expect(contrastOverBg(indicator, darkValues['color-surface-hover']), `indicator=${indicator}`).toBeGreaterThanOrEqual(3);
  });
  it('vs ScopeToggle 실제 합성색(반투명 active 배경 on 다크 surface) 3:1 이상', () => {
    expect(scopeToggleAdjacent, `ScopeToggle 배경 최종값 해석 실패: scopeBgFinal=${scopeBgFinal}`).not.toBeNull();
    expect(contrastOverBg(indicator, scopeToggleAdjacent), `indicator=${indicator} on scopeToggleAdjacent=${JSON.stringify(scopeToggleAdjacent)}`).toBeGreaterThanOrEqual(3);
  });
});

describe('다크 컨트롤 경계·accent 대비 고정(WCAG 1.4.3/1.4.11)', () => {
  // indicator(위 describe)만 대비 단정이 있었고 컨트롤 경계 토큰 자체(승격핀 6곳 중 5곳이 실제로
  // 소비하는 --color-input-border)는 무보호였다 — 다크 값을 --color-border(#26282E, 비-input 톤)로
  // 강등해도 대비 단정이 하나도 없어 전 테스트가 GREEN이었다(Task 6 "다크 대비 보정"의 존재 이유가
  // 무너지는 회귀). 알파 선합성 경로(compositeOver/contrastOverBg)를 그대로 재사용해 두 토큰 각각을
  // bg·surface·input-bg 3가지 배경과 3:1 이상으로 고정한다.
  const darkValues = buildDarkValues(css);
  const BG_TOKENS = ['color-bg', 'color-surface', 'color-input-bg'];
  const BORDER_TOKENS = ['color-input-border', 'color-input-border-hover'];
  for (const borderToken of BORDER_TOKENS) {
    for (const bgToken of BG_TOKENS) {
      it(`${borderToken} vs ${bgToken} 3:1 이상`, () => {
        expect(
          contrastOverBg(darkValues[borderToken], darkValues[bgToken]),
          `${borderToken}=${darkValues[borderToken]} vs ${bgToken}=${darkValues[bgToken]}`,
        ).toBeGreaterThanOrEqual(3);
      });
    }
  }

  // S3 scrum accent — 텍스트 4.5:1, 컨트롤 경계 3:1 (SC 1.4.3 / 1.4.11). 컨트롤 경계 토큰이
  // 무보호면 다크 강등이 침묵 통과하는 대칭 구멍 B와 동일 구조라 이 describe에 co-locate하고
  // 같은 알파 선합성 경로(contrastOverBg)를 재사용한다(새 describe·헬퍼 없음). 링은 반투명이라
  // contrastOverBg가 color-bg 위에 선합성한 결과로 잰다 — 불투명 원색으로 재지 않는다(14R 패턴).
  const SCRUM_DARK_CONTRAST = [
    ['color-accent-scrum', 'color-accent-scrum-subtle', 4.5], // 틴트 배경 위 accent 텍스트
    ['color-accent-scrum', 'color-input-bg', 4.5],            // 컨트롤 배경 위 accent 텍스트(Chip--on·TodayBtn·탭 on)
    ['color-accent-scrum', 'color-surface', 3],               // 보더/아이콘 vs 표면
    ['color-accent-scrum-border', 'color-surface', 3],        // hover 컨트롤 경계
    ['color-retro-try', 'color-retro-try-bg', 4.5],           // KPT try 헤더
    ['color-error-border-soft', 'color-surface', 3],          // LeaveBtn 컨트롤 경계
    ['color-error-border-soft', 'color-error-bg', 3],         // LeaveBtn hover 시 경계 유지
    ['color-accent-scrum-ring', 'color-bg', 3],               // focus ring 반투명 → bg 위 선합성 후 대비
    ['color-warning-ink', 'color-warning-bg', 4.5],
    ['color-warning-ink-deep', 'color-warning-bg', 4.5],
    ['color-warning-ink-strong', 'color-warning-bg', 4.5],
    ['color-warning', 'color-warning-bg', 3],
    ['color-text-inverse', 'color-primary', 4.5],
    ['color-text-inverse', 'color-primary-hover', 4.5],
    ['color-input-border-hover', 'track-border-soft', 3],
    ['color-accent-scrum', 'color-accent-scrum-wash', 4.5],            // dark-only
    ['color-accent-scrum-border', 'color-accent-scrum-subtle', 3],     // dark-only
  ];
  for (const [fg, bg, ratio] of SCRUM_DARK_CONTRAST) {
    it(`${fg} vs ${bg} ${ratio}:1 이상`, () => {
      expect(
        contrastOverBg(darkValues[fg], darkValues[bg]),
        `${fg}=${darkValues[fg]} vs ${bg}=${darkValues[bg]}`,
      ).toBeGreaterThanOrEqual(ratio);
    });
  }
});

// 게이트 자체 상설 검증 — 이전 라운드들은 각 결함을 "실파일을 임시로 훼손 → vitest 실행 → 복원"하는
// 수동 시뮬로만 검증했다(재현 스크립트가 안 남아 다음 라운드가 같은 결함을 다시 심어도 못 잡았다).
// 여기서는 postcss.parse한 합성 CSS 문자열로 헬퍼(parseColor/structuralGate/findProtectedDeclarations/
// reduceEffectiveDecls + 17R 신설 canonical 매처/층 2 evaluator)를 직접 단정해, 시뮬 재현 없이도 이후
// 라운드의 회귀를 상시 검출한다 — 8·9라운드 외부 검수 대응.
describe('게이트 자체 검증 (synthetic CSS)', () => {
  describe('parseColor — 엄격 CSS number (Important 1)', () => {
    it('trailing dot(1.)은 CSS 불법 number — null', () => {
      expect(parseColor('rgba(107,114,128,1.)')).toBeNull();
    });
    it('스펙 밖 alpha(10)는 파싱되고 clamp로 a=1', () => {
      expect(parseColor('rgba(60,60,60,10)')).toEqual({ r: 60, g: 60, b: 60, a: 1 });
    });
    it('leading dot(.5)은 유효 CSS number', () => {
      expect(parseColor('rgba(0,0,0,.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    });
    it('음수 채널은 애초에 정규식 매치 실패 — null', () => {
      expect(parseColor('rgba(-1,0,0,1)')).toBeNull();
    });
    it('다중 소수점(1.2.3)·빈 채널은 매치 실패 — null', () => {
      expect(parseColor('rgba(1.2.3,0,0,1)')).toBeNull();
      expect(parseColor('rgba(,0,0,1)')).toBeNull();
    });
  });

  describe('structuralGate — flat 3블록 계약 + 보호 토큰 3블록 밖 배타성 (Important, 9라운드)', () => {
    // 검수 실증 우회 ①·②는 둘 다 selector 열거(구 collectDarkSelectorRules)의 "감시 목록에 없는
    // selector"를 타고 들어왔다 — 아래 두 케이스는 그 정확한 재현이다. structuralGate는 selector
    // 문자열이 무엇이든 3블록 밖 보호 토큰 선언 자체를 금지하므로 두 우회 모두 FAIL해야 한다.
    it('정상 3블록이면 통과하고 darkRule을 반환한다', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
      `;
      const { darkRule } = structuralGate(cssText);
      expect(darkRule.selector).toBe(`html[data-theme='dark']`);
    });
    it('우회① media-:root — :root도 html에 적용되고 important가 승리하는데 선택자 목록 밖이라 놓쳤던 케이스, 이제 FAIL', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
        @media (min-width: 0px) {
          :root { --color-selected-indicator: rgba(0,0,0,0) !important; }
        }
      `;
      expect(() => structuralGate(cssText)).toThrow(/보호 토큰|3블록/);
    });
    it('우회② @supports dark:root — DARK_SELECTORS 어떤 변형과도 문자열이 달라 놓쳤던 케이스, 이제 FAIL', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
        @supports (display: block) {
          html[data-theme='dark']:root { --color-selected-indicator: rgba(0,0,0,0) !important; }
        }
      `;
      expect(() => structuralGate(cssText)).toThrow(/보호 토큰|3블록/);
    });
    it('4번째 root 블록이 있으면 블록 개수 불일치로 FAIL', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
        :root { --color-c: 4; }
      `;
      expect(() => structuralGate(cssText)).toThrow(/3블록/);
    });
    it('!important가 후행 non-important를 이긴다(다크 블록 내부 cascade, custom property도 동일 규칙)', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --x: A !important; --x: B; }
        :root { --color-b: 3; }
      `;
      const { darkRule } = structuralGate(cssText);
      const state = reduceEffectiveDecls([darkRule], (decl, prop) => prop.startsWith('--'));
      expect(state['--x'].value).toBe('A');
    });

    // synthetic 보충(concern 2, 내부 리뷰) — 순서/형태 오류 각 1건을 명시 FAIL로 단정한다.
    it('블록 순서가 뒤바뀌면(다크가 1번째) FAIL', () => {
      const cssText = `
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-a: 1; }
        :root { --color-b: 3; }
      `;
      expect(() => structuralGate(cssText)).toThrow(/1번째 블록\(라이트\)/);
    });
    it('블록이 다중 셀렉터(:root, .Sneak)면 단독 :root가 아니므로 FAIL', () => {
      const cssText = `
        :root, .Sneak { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
      `;
      expect(() => structuralGate(cssText)).toThrow(/1번째 블록\(라이트\)/);
    });
    it("2번째 블록이 html[data-theme='dark']:root 형태(:root 접미 오염)면 FAIL", () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark']:root { --color-a: 2; }
        :root { --color-b: 3; }
      `;
      expect(() => structuralGate(cssText)).toThrow(/2번째 블록\(다크\)/);
    });
  });

  describe('findProtectedDeclarations — 컴포넌트 보호 토큰 "선언" 금지 (9라운드)', () => {
    it('.Foo{--color-x:red} 처럼 조상 스코프 재선언은 FAIL 대상 목록에 잡힌다', () => {
      const offenders = findProtectedDeclarations('.Foo { --color-x: red; }');
      expect(offenders.length).toBe(1);
      expect(offenders[0]).toMatch(/--color-x/);
    });
    it('var() 참조로 소비만 하면 통과 — 빈 배열', () => {
      const offenders = findProtectedDeclarations('.Foo { border-color: var(--color-x); }');
      expect(offenders).toEqual([]);
    });
  });

  describe('P4 컴파일 기반 스윕 synthetic (Important 1, 10라운드) — 원문 정규식이 놓친 우회 재현', () => {
    // 실 레포는 위반 0건이라 실 스윕(위 "styles/ 전체 컴파일/AST 스윕")만으로는 FAIL 분기가 한 번도
    // 실행되지 않는다 — compileString(파일 I/O 없이 SCSS 문자열을 바로 컴파일)으로 합성 소스를 만들어
    // findProtectedDeclarations/sweepFileForProtectedDeclarations의 FAIL·엣지 경로를 직접 검증한다.
    it('멀티라인 선언(콜론이 다음 줄)도 컴파일 후 AST로 검출 — 원문 같은-줄 정규식은 이 케이스를 놓쳤다', () => {
      const cssText = compileString('.Foo {\n  --color-x\n    : red;\n}\n').css;
      expect(findProtectedDeclarations(cssText)).toHaveLength(1);
    });
    it('블록주석(/* --color-x: red; */) 내부 텍스트는 Comment 노드라 선언으로 오검출 안 함', () => {
      const cssText = compileString('.Foo {\n  /* --color-x: red; */\n  color: blue;\n}\n').css;
      expect(findProtectedDeclarations(cssText)).toEqual([]);
    });
    it('.css 파일(합성, fonts.css 우회 재현) — postcss.parse 직접으로도 보호 토큰 선언 검출', () => {
      const cssText = ':root { --color-selected-indicator: red; }';
      expect(findProtectedDeclarations(cssText)).toEqual(['--color-selected-indicator@1행(위치: :root)']);
    });
    it('소비(var(--color-x))는 선언이 아니므로 무시(기존 findProtectedDeclarations 계약 재확인)', () => {
      const cssText = compileString('.Foo { border-color: var(--color-x); }\n').css;
      expect(findProtectedDeclarations(cssText)).toEqual([]);
    });
    it('sweepFileForProtectedDeclarations — sass 컴파일 실패(존재하지 않는 파일)는 침묵 스킵 대신 offender로 표면화', () => {
      const offenders = sweepFileForProtectedDeclarations('__does-not-exist__.scss');
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toMatch(/__does-not-exist__\.scss: 컴파일\/파싱 실패/);
    });
  });

  describe('isProtectedSweepTarget — P4 스윕 대상 판정 (Important 2, 11라운드)', () => {
    it('루트 정본 _themes.scss(exact)만 예외 — false', () => {
      expect(isProtectedSweepTarget('_themes.scss')).toBe(false);
    });
    it('중첩 components/example/_themes.scss는 대상 — true (endsWith 우회 없음)', () => {
      expect(isProtectedSweepTarget('components/example/_themes.scss')).toBe(true);
    });
    it('접미 우연 일치 components/rogue_themes.scss도 대상 — true', () => {
      expect(isProtectedSweepTarget('components/rogue_themes.scss')).toBe(true);
    });
    it('fonts.css(.css 커버리지)도 대상 — true', () => {
      expect(isProtectedSweepTarget('fonts.css')).toBe(true);
    });
    it('비 scss/css(예: .js)는 대상 아님 — false', () => {
      expect(isProtectedSweepTarget('components/foo.js')).toBe(false);
    });
  });

  describe('normalizeRawCss — raw .css escaped custom-property 정규화 (Minor, 11라운드)', () => {
    // 원문 raw 파싱은 `--\63 olor-…`(유효 CSS, 실이름 --color-…)를 리터럴 prop으로 남겨 보호 접두 검사를
    // 우회시켰다. Sass CSS-syntax 컴파일로 식별자 escape를 정규화한 뒤 findProtectedDeclarations에 태운다.
    it('escaped 선언(--\\63 olor-…)이 정규화 후 실이름 --color-selected-indicator로 검출된다', () => {
      const norm = normalizeRawCss(':root { --\\63 olor-selected-indicator: red; }');
      const offenders = findProtectedDeclarations(norm);
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toMatch(/--color-selected-indicator/);
    });
    it('일반(비escape) 보호 선언도 그대로 검출', () => {
      expect(findProtectedDeclarations(normalizeRawCss(':root { --color-x: red; }'))).toHaveLength(1);
    });
    it('--Color-…(대문자)는 case-sensitive 유지 → 보호 접두(--color-) 아니므로 미검출(오검출 방지)', () => {
      expect(findProtectedDeclarations(normalizeRawCss(':root { --Color-x: red; }'))).toEqual([]);
    });
    it('블록주석 안 escaped 선언은 Comment 노드라 미검출', () => {
      expect(findProtectedDeclarations(normalizeRawCss('.Foo { /* --\\63 olor-x: red; */ color: blue; }'))).toEqual([]);
    });
    it('소비(var(--\\63 olor-x))는 선언이 아니라 값이므로 미검출', () => {
      expect(findProtectedDeclarations(normalizeRawCss('.Foo { border-color: var(--\\63 olor-x); }'))).toEqual([]);
    });
  });

  describe('keyIntersection — 별칭·라이트 교집합 판정 (P1 synthetic)', () => {
    it('별칭이 라이트 키를 재선언하면 교집합에 잡힌다(specificity 동일 → 후행 재선언이 침묵 오염)', () => {
      const lightKeys = new Set(['color-a', 'color-b']);
      const aliasKeys = new Set(['color-a', 'color-c']);
      expect(keyIntersection(aliasKeys, lightKeys)).toEqual(['color-a']);
    });
    it('배타적이면 빈 배열', () => {
      expect(keyIntersection(new Set(['color-c']), new Set(['color-a', 'color-b']))).toEqual([]);
    });
  });

  describe('findUnprotectedDeclarations — 보호 접두 역방향 판정 (P3 synthetic)', () => {
    it('보호 접두 밖 토큰(--brand-new)을 검출', () => {
      const root = postcss.parse(':root { --color-a: 1; --brand-new: 2; }');
      const offenders = findUnprotectedDeclarations([root.first]);
      expect(offenders).toEqual(['--brand-new@1행']);
    });
    it('보호 접두 3종만 있으면 빈 배열', () => {
      const root = postcss.parse(':root { --color-a: 1; --track-b: 2; --shadow-c: 3; }');
      expect(findUnprotectedDeclarations([root.first])).toEqual([]);
    });
    it('일반 프로퍼티(color-scheme 등)는 애초에 대상 아님', () => {
      const root = postcss.parse(':root { color-scheme: light; --color-a: 1; }');
      expect(findUnprotectedDeclarations([root.first])).toEqual([]);
    });
  });

  // ── 17R 전환: 아래 4개 describe는 폐기된 grammar 모델 헬퍼(outermostVarTokens·splitTopLevelLayers·
  //    assertVisibleInsetShadowLayer·synthesizeBorderSides 계열)의 단위 단정이었다. **계약 의미는
  //    보존하되** 판정 주체를 canonical 매처/층 2 evaluator로 이관한다 — 각 벡터가 "canonical이 아니라서
  //    RED"임을 그 자체 상태로 단정하므로 기존 계약(중첩 var 미수집·fallback 텍스트 오매치·spread 0
  //    비가시·네 면 소실 등)이 전부 같은 결론으로 유지된다.
  describe('canonical var 원자 — 구 outermostVarTokens/topLevelVarTokens 계약 이관(10~15R 벡터 보존)', () => {
    // 구 계약: "최상위 var()의 첫 인자만 수집, 중첩/fallback·유사 함수명은 미수집".
    // 신 계약: canonical 토큰 참조는 **정확히 `var(--name)`** 뿐이다 — 아래 변종은 전부 비-canonical.
    it.each([
      ['fallback + 중첩 var(10R r5)', 'var(--a, "(", var(--b))'],
      ['값 전체가 문자열', '"var(--x)"'],
      ['비ASCII 접두 함수명(λvar)', 'λvar(--x)'],
      ['식별자 접미 함수명(fakevar)', 'fakevar(--x)'],
      ['escaped 식별자 함수명(fake\\ var)', 'fake\\ var(--x)'],
      ['calc 안 var + 콤마 나열', 'calc(1px + var(--a)), var(--b)'],
      ['fallback 안 escape', 'var(--a, \\(, var(--b))'],
      ['문자열 밖 escaped quote', '\\" , var(--x)'],
      ['콤마 없는 잔여 인자(13R I2a)', 'var(--color-input-border garbage)'],
      ['fallback 있는 var(12R/13R GREEN이었음)', 'var(--x, #ccc)'],
      ['중첩 malformed fallback(14R I3)', 'var(--color-input-border, var(--bad garbage))'],
      ['정상 중첩 fallback(14R I3 대조, 이전 GREEN)', 'var(--color-input-border, var(--fallback))'],
      ['대문자 VAR()(14R I3에서 인정했던 형태)', 'VAR(--x)'],
      ['비ASCII dashed-ident(15R I4)', 'var(--é)'],
      ['언더스코어 dashed-ident(14R I3)', 'var(--_name)'],
      ['escape 포함 이름(15R I4)', 'var(--\\65 x)'],
    ])('%s 는 canonical 토큰 참조가 아니다 → border color 자리에서 RED', (_label, value) => {
      expect(CANON_VAR_REF_RE.test(normalizeDeclValue(value))).toBe(false);
      expect(classifyRelevantDecl('border', `1px solid ${value}`).syntax).toBe('non-canonical');
    });
    it('GREEN(무회귀): 정확한 var(--name)만 canonical 토큰 참조', () => {
      expect(canonicalNeedleToken('var(--color-input-border)')).toBe('color-input-border');
      expect(canonicalNeedleToken(' var(--color-selected-indicator) ')).toBe('color-selected-indicator');
      expect(() => canonicalNeedleToken('var(--x, #ccc)')).toThrow(/canonical/);
    });
  });

  describe('canonical box-shadow 레이어 분해 — 구 splitTopLevelLayers 계약 이관', () => {
    // 기대 갱신(18R I2): 이전엔 임의 토큰(`var(--x)`)도 canonical 레이어였다. 이제 허용 indicator
    // layer는 실측 전체 문자열 하나뿐이라 토큰 이름까지 고정된다.
    it('단일 레이어(핀 실측 전체 문자열)는 레이어 1개로 모델링', () => {
      const layers = canonicalShadowLayers(CANON_SHADOW_INDICATOR_LAYER);
      expect(layers).toHaveLength(1);
      expect(layers[0]).toEqual({ kind: 'inset', offsetX: 0, offsetY: 0, blur: 0, spread: 1, token: 'color-selected-indicator' });
    });
    it('임의 토큰 레이어(inset 0 0 0 1px var(--x))는 더 이상 canonical이 아니다 — 18R I2 축소', () => {
      expect(canonicalShadowLayers('inset 0 0 0 1px var(--x)')).toBeNull();
    });
    it('다중 그림자(HomeTabs 핀)는 최상위 콤마로만 분해 — var() 내부 콤마와 혼동 없음(fallback var는 애초에 canonical 아님)', () => {
      const layers = canonicalShadowLayers('var(--shadow-xs), inset 0 0 0 1px var(--color-selected-indicator)');
      expect(layers.map((l) => l.kind)).toEqual(['opaque-var', 'inset']);
      expect(layers[0].token).toBe('shadow-xs');
      expect(layers[1].token).toBe('color-selected-indicator');
    });
    it('canonical이 아닌 값은 분해 자체를 하지 않는다(null) — 조각이 canonical처럼 보이는 우회 차단', () => {
      expect(canonicalShadowLayers('foo(a, inset 0 0 0 1px var(--t))')).toBeNull();
      expect(canonicalShadowLayers('var(--shadow-xs) , junk')).toBeNull();
      expect(canonicalShadowLayers('none')).toBeNull();
    });
  });

  describe('canonical 인디케이터 가시성 — 구 assertVisibleInsetShadowLayer 계약 이관(10~13R 벡터 보존)', () => {
    const IND = 'color-selected-indicator';
    const ivis = (value) => evalIndicatorCss(`.X{box-shadow:${value}}`, IND).visible;
    it('정상 형태(핀 실측 전체 문자열)는 visible', () => {
      expect(ivis(CANON_SHADOW_INDICATOR_LAYER)).toBe(true);
    });
    // 기대 갱신(18R I2, GREEN→RED): `inset 0 0 0 2px var(--…)`는 층 2 가시성 계산상 spread>0이지만
    // **실핀에 없는 전체 문자열**이라 canonical 밖이다. "임의 길이·임의 레이어 조합 허용"이 곧 whitelist를
    // 작은 CSS 문법으로 되돌리는 경로였으므로(I2), 폭 변경도 개발자가 알아야 할 신호로 남긴다.
    it('실핀 밖 spread(2px)는 canonical 밖 — RED(18R I2 축소, 이전 GREEN)', () => {
      expect(ivis(`inset 0 0 0 2px var(--${IND})`)).toBe(false);
    });
    it.each([
      ['var(--t) 단독 레이어(치환 후 불법값이면 선언 무효화)', 'var(--color-selected-indicator)'],
      ['spread 0(렌더 폭 없음)', 'inset 0 0 0 0 var(--color-selected-indicator)'],
      ['inset 키워드 없음(outset 그림자)', '0 0 0 2px var(--color-selected-indicator)'],
      ['length 4개 미만(spread 없음)', 'inset 0 0 2px var(--color-selected-indicator)'],
      ['unitless 비영 spread(불법 CSS)', 'inset 0 0 0 5 var(--color-selected-indicator)'],
      ['1% spread(% 불허)', 'inset 0 0 0 1% var(--color-selected-indicator)'],
      ['negative blur', 'inset 0 0 -1px 1px var(--color-selected-indicator)'],
      ['length 5개(개수 초과)', 'inset 0 0 0 1px 2px var(--color-selected-indicator)'],
      ['stray word 잔여(junk)', 'inset 0 0 0 1px junk var(--color-selected-indicator)'],
      ['미지원 함수 잔여(calc)', 'inset 0 0 0 1px calc(2px) var(--color-selected-indicator)'],
      ['top-level slash div 잔여', 'inset 0 0 0 / 1px var(--color-selected-indicator)'],
    ])('RED: %s', (_label, value) => {
      expect(ivis(value)).toBe(false);
    });
    // 기대 갱신(18R I2): spread 0 레이어는 이제 canonical 판정 단계에서 이미 탈락한다(실측 문자열 밖).
    // 층 분리(canonical 판정 ≠ 가시성 계산)는 border 도메인에서 계속 단정된다(width 0은 canonical).
    it('spread 0은 canonical 밖(18R I2) — 판정 단계에서 이미 RED', () => {
      const cls = classifyRelevantDecl('box-shadow', `inset 0 0 0 0 var(--${IND})`);
      expect(cls.syntax).toBe('non-canonical');
      expect(ivis(`inset 0 0 0 0 var(--${IND})`)).toBe(false);
    });
    it('무회귀: 핀 실측 spread(1px) 형태는 계속 visible', () => {
      expect(ivis(`inset 0 0 0 1px var(--${IND})`)).toBe(true);
    });
    // 층 2 가시성 계산(spread>0)이 공허하지 않음을 유지 — CANONICAL_DECLS의 레이어 모델을 직접 단정한다.
    it('canonical indicator layer 모델의 spread는 1(>0) — 층 2 가시성 입력 고정', () => {
      expect(canonicalShadowLayers(CANON_SHADOW_INDICATOR_LAYER)[0].spread).toBeGreaterThan(0);
    });
  });

  describe('canonical border 가시성 + 구 4면 cascade 엔진 계약 이관(11R 대칭 구멍 A)', () => {
    const TOKEN = 'color-input-border';
    const V = 'var(--color-input-border)';
    it('canonical shorthand는 width>0·토큰 일치일 때만 가시(층 2 계산)', () => {
      expect(evalBorderScss(`.X{border:1px solid ${V}}`, TOKEN).visible).toBe(true);
      expect(evalBorderScss(`.X{border:0 solid ${V}}`, TOKEN).visible).toBe(false); // canonical이나 width 0
      expect(evalBorderScss(`.X{border:1px solid var(--color-border)}`, TOKEN).visible).toBe(false); // 다른 토큰
    });
    it('canonical 판정과 가시성 계산은 분리된 층이다 — width 0도 syntax는 canonical', () => {
      const cls = classifyRelevantDecl('border', `0 solid ${V}`);
      expect(cls.syntax).toBe('canonical');
      expect(cls.border).toEqual({ width: 0, style: 'solid', token: TOKEN });
    });
    it('비가시 style(none/hidden)은 canonical 밖 — 선언 존재 자체가 RED', () => {
      expect(classifyRelevantDecl('border', `1px none ${V}`).syntax).toBe('non-canonical');
      expect(classifyRelevantDecl('border', `1px hidden ${V}`).syntax).toBe('non-canonical');
    });
    it('여러 root 규칙(문서 순서)에 걸쳐도 relevant 선언 전수를 본다 — 후행 규칙의 비-canonical이 RED로 이긴다', () => {
      expect(evalBorderScss(`.X{border:1px solid ${V}} .X{border-bottom-width:0}`, TOKEN).visible).toBe(false);
    });
    it('border-radius/border-collapse/border-spacing은 relevant 아님(경계 무관) — 그 외 border-*는 relevant', () => {
      expect(isRelevantProp('border-radius')).toBe(false);
      expect(isRelevantProp('border-top-left-radius')).toBe(false);
      expect(isRelevantProp('border-collapse')).toBe(false);
      expect(isRelevantProp('border-spacing')).toBe(false);
      expect(isRelevantProp('border')).toBe(true);
      expect(isRelevantProp('border-width')).toBe(true);
      expect(isRelevantProp('border-image-source')).toBe(true);
      expect(isRelevantProp('border-inline-width')).toBe(true); // 논리 프로퍼티 fail-closed(15R 계약)
      expect(isRelevantProp('border-future-thing')).toBe(true); // 미지 border-* 도 relevant(fail-closed)
      expect(isRelevantProp('box-shadow')).toBe(true);
      expect(isRelevantProp('all')).toBe(true);
      expect(isRelevantProp('color')).toBe(false);
      expect(isRelevantProp('--dead-border')).toBe(false);
    });
    // 내부 리뷰 실증 — 벗기기 전엔 `-webkit-border-image`/`-webkit-box-shadow`가 startsWith('border')/
    // ===' box-shadow'에 안 걸려 relevant 밖으로 샜다(층 1 자체가 무력화되는 false-green). 커스텀
    // 프로퍼티(`--foo`)는 두 번째 문자가 `-`라 deprefix가 무영향임을 함께 고정한다.
    it('벤더 프리픽스(-webkit-/-moz-/-ms-/-o-)를 벗긴 뒤 판정 — alias도 relevant, 커스텀 프로퍼티는 무영향', () => {
      expect(isRelevantProp('-webkit-border-image')).toBe(true);
      expect(isRelevantProp('-webkit-box-shadow')).toBe(true);
      expect(isRelevantProp('-moz-box-shadow')).toBe(true);
      expect(isRelevantProp('-ms-border-radius')).toBe(false); // 벗겨도 radius는 여전히 경계 무관
      expect(isRelevantProp('-o-border-width')).toBe(true);
      expect(isRelevantProp('--webkit-color-x')).toBe(false); // 커스텀 프로퍼티(두 번째 문자 '-')는 deprefix 무영향
    });
    it('border-radius만 있으면 border 선언이 전무 → initial(비가시) RED', () => {
      expect(evalBorderScss('.X{border-radius:8px;border-collapse:collapse}', TOKEN).visible).toBe(false);
    });
    it('조건부 문맥(@media) 안 동일 셀렉터의 relevant 선언은 모델 불가로 표면화된다(구 수집 누락 폐쇄)', () => {
      const cssText = `.X{border:1px solid ${V}}@media (min-width:0px){.X{border:none}}`;
      const res = evalBorderCss(cssText, TOKEN);
      expect(res.visible).toBe(false);
      expect(res.unmodelable.join(' ')).toMatch(/조건부 문맥/);
    });
    it('조건부 문맥이라도 relevant 아닌 선언만 있으면 무해(과잉 RED 방지)', () => {
      const cssText = `.X{border:1px solid ${V}}@media (min-width:0px){.X{border-radius:4px}}`;
      expect(evalBorderCss(cssText, TOKEN).visible).toBe(true);
    });
  });

  describe('대칭 구멍 B synthetic — --color-input-border 다크 강등값이 대비 단정에 실제로 걸린다', () => {
    // 실 레포 현재 값(#6B7280 on #0E0F11 계열)은 위 실파일 describe에서 이미 GREEN으로 고정됐다 —
    // 여기서는 "만약 --color-border(비-input 톤, #26282E)로 강등되면 이 단정이 실제로 RED가 되는가"를
    // darkValues 재구성 없이 대비 함수를 직접 단정해 검증한다(합성 CSS로 강등값을 재현).
    it('강등값(#26282E, 일반 border 톤) vs 실제 다크 bg(#0E0F11)는 3:1 미만 — 대비 단정이 실제로 이 회귀를 잡는다', () => {
      const degraded = '#26282E';
      const darkBg = buildDarkValues(css)['color-bg'];
      expect(contrastOverBg(degraded, darkBg)).toBeLessThan(3);
    });
  });

  describe('reduceEffectiveDecls — prop 정규화 (Minor 2)', () => {
    it('일반 property는 case-insensitive 통합 — BORDER 뒤 border가 후행 승리', () => {
      const root = postcss.parse('.x { BORDER: none; border: 1px solid red; }');
      const state = reduceEffectiveDecls([root.first], () => true);
      expect(Object.keys(state)).toEqual(['border']);
      expect(state.border.value).toBe('1px solid red');
    });
    it('커스텀 프로퍼티는 case-sensitive 유지 — --Foo와 --foo는 별개 키', () => {
      const root = postcss.parse('.x { --Foo: A; --foo: B; }');
      const state = reduceEffectiveDecls([root.first], () => true);
      expect(state['--Foo'].value).toBe('A');
      expect(state['--foo'].value).toBe('B');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12라운드 회귀 게이트(보존분) — 식별자 디코더 계열은 이번 전환 대상이 아니다(핀 외 게이트). 보호 토큰
// 네임스페이스·cascade prop 정규화는 그대로 유지된다.
// ─────────────────────────────────────────────────────────────────────────────

describe('12R F1 — escaped 선행 하이픈 보호 토큰 우회 (표준 식별자 디코더)', () => {
  // Sass는 내부 hex(--\63 olor-x)는 --color-x로 정규화하지만 선행 하이픈은 \- 로 재직렬화한다
  // (\--color-x, -\-color-x, \2d -color-x→\--color-x, -\2d color-x→-\-color-x). 이 escape 이름들은
  // 전부 Chrome에서 --color-x로 해석되는 유효 선언인데 decl.prop raw가 startsWith('--color-')를
  // 우회했다 — 표준 CSS 식별자 디코더로 의미값을 복원해 검출한다. raw .css(normalizeRawCss) +
  // compiled .scss(compileString) 양쪽 P4 경로를 모두 검증한다.
  const rawDetect = (prop) => findProtectedDeclarations(normalizeRawCss(`:root { ${prop}: red; }`));
  const scssDetect = (prop) => findProtectedDeclarations(compileString(`.Foo { ${prop}: red; }`).css);
  it.each([
    ['\\--color-x'],
    ['-\\-color-x'],
    ['\\2d -color-x'],
    ['-\\2d color-x'],
  ])('raw .css: %s 는 실이름 --color-…로 검출된다(RED)', (prop) => {
    expect(rawDetect(prop)).toHaveLength(1);
  });
  it('compiled .scss 경로: \\--color-x 도 검출된다(RED)', () => {
    expect(scssDetect('\\--color-x')).toHaveLength(1);
  });
  it('기존 내부 hex(--\\63 olor-x)도 계속 검출(GREEN 유지)', () => {
    expect(rawDetect('--\\63 olor-x')).toHaveLength(1);
  });
  it('--Color-x(대문자)는 case-sensitive 비보호 → 미검출(GREEN 유지, 오검출 방지)', () => {
    expect(rawDetect('--Color-x')).toEqual([]);
  });
  it('escaped 대문자(-\\43 olor-x=-Color-x)도 case-sensitive 비보호 → 미검출(GREEN)', () => {
    // M2 주석 오기 정정 — 입력은 `-\43 olor-x`: 선행 `-` + \43(=0x43='C') + `olor-x` = **-Color-x**
    // (단일 하이픈, --Color-x 아님). custom property도 아니고 보호 접두도 아니라 미검출이 맞다.
    expect(rawDetect('-\\43 olor-x')).toEqual([]);
  });
  it('블록주석 안 escaped 이름은 Comment 노드라 미검출(GREEN)', () => {
    expect(findProtectedDeclarations(normalizeRawCss('.Foo { /* \\--color-x: red; */ color: blue; }'))).toEqual([]);
  });
  it('소비(var(\\--color-x))는 값이라 미검출(GREEN)', () => {
    expect(findProtectedDeclarations(normalizeRawCss('.Foo { border-color: var(\\--color-x); }'))).toEqual([]);
  });
});

// F1의 decodeCssIdentifier는 hasProtectedPrefix에만 배선되고 normalizeProp(cascade predicate·state 키)
// 에는 미적용이었다(내부 리뷰 실증, 12라운드) — escaped 선언이 reduceEffectiveDecls/핀 relevant 수집
// 양쪽에서 predicate 탈락으로 cascade에서 통째로 실종됐다. normalizeProp이 decodeCssIdentifier로 먼저
// 디코딩하도록 고치면 두 소비처(다크 cascade·핀 relevant 판정)가 한 번에 닫힌다.
// 17R 전환 후에도 이 배선은 **필수**다: escaped `\42order`가 relevant 판정을 우회하면 canonical 게이트
// 자체가 그 선언을 못 보고 지나친다(= canonical 매칭 우회 경로). 아래 세 번째 it이 그 폐쇄를 고정한다.
describe('12R F5 — normalizeProp CSS 식별자 디코더 선통과 (relevant 수집 우회 폐쇄)', () => {
  const escapedIndicatorThemes = `
    :root { --color-bg: #FFFFFF; --color-selected-indicator: transparent; }
    html[data-theme=dark] {
      --color-bg: #0E0F11;
      --color-selected-indicator: #6B7280;
      \\--color-selected-indicator: transparent;
    }
    :root { --color-alias-unused: 0; }
  `;

  it('19R 기대 갱신(cascade 계산→shape 위반): 다크 블록 escaped 중복(\\--color-selected-indicator)은 buildDarkValues가 값을 계산하기 전에 shape contract로 throw — escaped 이름도 디코딩해 동일 토큰으로 중복 카운트', () => {
    // 기대 갱신: 이전엔 buildDarkValues가 reduceEffectiveDecls로 후행 transparent를 cascade winner로 읽어
    // 회귀를 값으로 잡았다(=cascade 계산 의존). 19R shape contract는 보호 토큰 블록당 1선언을 강제하므로
    // 이 escaped 중복은 값 계산 이전에 구조 위반으로 접힌다(cascade 재구현 없이 더 강한 폐쇄). 디코더가
    // 중복 그룹핑에도 쓰이므로 raw `--color-selected-indicator`와 escaped `\--…`가 같은 토큰으로 묶인다.
    expect(() => buildDarkValues(escapedIndicatorThemes)).toThrow(/shape contract/);
    expect(() => structuralGate(escapedIndicatorThemes)).toThrow(/shape contract/);
  });

  it('normalizeProp 디코딩 계약 유지(cascade 레이어): reduceEffectiveDecls는 escaped prop(\\--color-x)을 실이름으로 디코딩해 동일 키로 통합한다 — effectiveValue 등 소비처가 여전히 escaped 선언을 놓치지 않는다', () => {
    // 12R-F5의 본래 관심사(normalizeProp가 decodeCssIdentifier를 선통과)는 reduceEffectiveDecls 층에서
    // 그대로 유지된다(effectiveValue·직접 소비처가 공유). _themes 층은 shape contract가 별도로 막는다.
    const root = postcss.parse('.x { --color-x: #6B7280; \\--color-x: transparent; }');
    const state = reduceEffectiveDecls([root.first], (decl, prop) => prop.startsWith('--'));
    expect(Object.keys(state)).toEqual(['--color-x']); // 두 선언이 같은 키로 통합
    expect(state['--color-x'].value).toBe('transparent'); // 후행 승리(cascade는 여전히 정확)
  });

  it('border: 후행 \\42order:none(디코딩=border)이 relevant 선언으로 수집돼 canonical 위반 RED가 된다', () => {
    const V = 'var(--color-input-border)';
    // 이 테스트는 normalizeProp의 **raw 식별자 디코딩**을 검증한다 — Sass는 escape를 선(先)정규화하므로
    // (\42order→Border) compileString을 태우면 decode 경로가 실행되지 않는다. 따라서 공용 evaluator를
    // 호출하되 cssText는 raw로 넣어 postcss.parse가 escape를 보존하게 한다.
    const res = evalBorderCss(`.X{border:1px solid ${V};\\42order:none}`);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/order: none/);
  });

  // 회귀 안전 확인(코드 변경과 무관 — hasProtectedPrefix가 이미 자체 디코딩) — P3 역방향도 escaped
  // 비보호 토큰을 놓치지 않는다.
  it('findUnprotectedDeclarations: escaped 비보호 토큰(--\\75 nprotected-x=--unprotected-x)도 검출', () => {
    const root = postcss.parse(':root { --color-a: 1; --\\75 nprotected-x: 2; }');
    const offenders = findUnprotectedDeclarations([root.first]);
    expect(offenders).toEqual(['--\\75 nprotected-x@1행']);
  });

  it('멱등성: decodeCssIdentifier/normalizeProp을 이미 디코딩된(또는 1회 디코딩된) 식별자에 재적용해도 무변화 — 이중 디코딩 지점 없음 보증', () => {
    const alreadyDecoded = ['--color-selected-indicator', 'border', 'border-top-color', '--Foo-Bar', 'all'];
    for (const ident of alreadyDecoded) {
      expect(decodeCssIdentifier(decodeCssIdentifier(ident))).toBe(decodeCssIdentifier(ident));
      expect(normalizeProp(normalizeProp(ident))).toBe(normalizeProp(ident));
    }
    // 현실 escape 패턴(leading-hyphen escape) 1회 디코딩 결과에는 백슬래시가 남지 않으므로 재통과해도
    // 무변화 — decode 지점이 정확히 한 곳(normalizeProp 진입부)이면 이중 호출 경로가 생겨도 안전하다.
    const onceDecoded = decodeCssIdentifier('\\--color-selected-indicator');
    expect(onceDecoded).toBe('--color-selected-indicator');
    expect(decodeCssIdentifier(onceDecoded)).toBe(onceDecoded);
  });

  // M2(13라운드) — **음성 mutation**: 이름에 \5c(백슬래시 자체의 hex escape)가 들어가면 1회 디코딩이
  // 리터럴 백슬래시를 낳아, **재디코딩하면 값이 달라진다**. 이는 "정확히 한 번만 디코딩"(단일 decode
  // 지점=normalizeProp 진입부) 계약을 고정한다.
  it('멱등성 음성 대조: \\5c(백슬래시 hex escape) 포함 이름은 1회≠2회 디코딩 — 단일 소비 계약 고정', () => {
    const once = decodeCssIdentifier('--color\\5c x'); // \5c → 리터럴 '\' , 뒤 공백 1개 소비
    expect(once).toBe('--color\\x'); // 리터럴 백슬래시 1개 남음
    expect(decodeCssIdentifier(once)).toBe('--colorx'); // 재디코딩: \x → x (백슬래시 소비) → 값 변함
    expect(decodeCssIdentifier(once)).not.toBe(once); // 비-멱등: 이 지점을 두 번 태우면 오독됨을 명시
  });
});

describe('13R I1 — findUnprotectedDeclarations 선행 하이픈 escape 역방향 검출', () => {
  // 디코딩 결과가 전부 --unprotected-x(비보호 custom property)인데 raw는 --로 시작하지 않아 놓쳤던 4종.
  it.each([
    ['\\--unprotected-x'],
    ['-\\-unprotected-x'],
    ['\\2d -unprotected-x'],
    ['-\\2d unprotected-x'],
  ])('선행 하이픈 escape %s 는 실이름 --unprotected-x로 검출된다(RED)', (prop) => {
    const root = postcss.parse(`:root { --color-a: 1; ${prop}: 2; }`);
    expect(findUnprotectedDeclarations([root.first])).toHaveLength(1);
  });
  it('기존 케이스(--\\75 nprotected-x, raw가 이미 --로 시작)도 계속 검출(GREEN 유지)', () => {
    const root = postcss.parse(':root { --color-a: 1; --\\75 nprotected-x: 2; }');
    expect(findUnprotectedDeclarations([root.first])).toEqual(['--\\75 nprotected-x@1행']);
  });
  it('보호 접두 3종만 있으면 escape 여부 무관 빈 배열(오검출 방지)', () => {
    const root = postcss.parse(':root { --color-a: 1; \\--track-b: 2; }'); // \--track-b = --track-b(보호)
    expect(findUnprotectedDeclarations([root.first])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11R~17R 회귀 벡터 코퍼스 — 6라운드에 걸쳐 축적된 mutation 벡터 전량을 **canonical 게이트 기대**로
// 이관한다(삭제 금지 원칙). 각 항목은 원 라운드 ID를 유지하고, 기대가 바뀐 것은 `note`에 갱신 사유를
// 병기한다. 기대 갱신의 유일한 원인은 아키텍처 전환 자체다:
//   · 구 모델의 "invalid(폐기) → **이전 유효 선언 fallback** → GREEN" 부류는 전부 RED가 된다.
//     정적 회귀 게이트에서 non-canonical CSS는 그 자체로 실패이고, 브라우저의 폐기 의미론을 흉내 내는
//     일(=false-green의 근원)을 중단했기 때문이다.
//   · 구 모델이 "유효 grammar"로 인정하던 non-canonical 형태(directional longhand 조립·border-width:0
//     복원·border-image:none 등)도 canonical 밖이므로 RED다(false-RED 방향 — 회귀 게이트로선 올바름).
// 반대로 **canonical + CSS-wide만으로 구성된 GREEN**(핀 실형태·`all:initial` 후 canonical box-shadow·
// `border-image:initial` 등)은 그대로 GREEN으로 남는다 — 층 2가 그 조합만 계산하기 때문이다.
// ─────────────────────────────────────────────────────────────────────────────
const CIB = 'color-input-border';
const IND = 'color-selected-indicator';
const V = 'var(--color-input-border)';
const IV = 'var(--color-selected-indicator)';
// 구 false-green의 단골 형태(M13 패턴): 활성 border-image + important 성분 longhand. 구 모델은 "무효
// shorthand가 border-image를 reset해 important longhand가 드러남"으로 GREEN을 냈다. 17R에선 성분
// longhand·border-image 모두 canonical 밖이라 어느 경로로도 GREEN이 될 수 없다.
const M13 = (candidate) => `.X{border-width:1px !important;border-style:solid !important;`
  + `border-color:${V} !important;border-image:url(a.png);border:${candidate}}`;

const CORPUS = [
  // ── 11R 대칭 구멍 A(border 4면 cascade) — RED 10종은 그대로 RED, GREEN 4종은 기대 갱신.
  { id: '11R-A1', kind: 'border', label: 'shorthand 후 border-width:0', src: `.X{border:1px solid ${V};border-width:0}`, visible: false },
  { id: '11R-A2', kind: 'border', label: 'shorthand 후 border-style:none', src: `.X{border:1px solid ${V};border-style:none}`, visible: false },
  { id: '11R-A3', kind: 'border', label: 'shorthand 후 border-color:transparent', src: `.X{border:1px solid ${V};border-color:transparent}`, visible: false },
  { id: '11R-A4', kind: 'border', label: 'border: calc(100% - 2px) solid var(…)', src: `.X{border:calc(100% - 2px) solid ${V}}`, visible: false },
  { id: '11R-A5', kind: 'border', label: 'border-width:0 !important', src: `.X{border:1px solid ${V};border-width:0 !important}`, visible: false },
  { id: '11R-A6', kind: 'border', label: 'border-width:0 !important 후 shorthand', src: `.X{border-width:0 !important;border:1px solid ${V}}`, visible: false },
  { id: '11R-A7', kind: 'border', label: 'directional border-left-width:0', src: `.X{border:1px solid ${V};border-left-width:0}`, visible: false },
  { id: '11R-A8', kind: 'border', label: '논리 프로퍼티 border-inline-width:0', src: `.X{border:1px solid ${V};border-inline-width:0}`, visible: false },
  { id: '11R-A9', kind: 'border', label: '`all: unset` 리셋(층 2가 계산: border initial → 비가시)', src: `.X{border:1px solid ${V};all:unset}`, visible: false },
  { id: '11R-A10', kind: 'border', label: 'border: 5 solid var(…)(unitless 비영 width)', src: `.X{border:5 solid ${V}}`, visible: false },
  { id: '11R-B1', kind: 'border', label: 'border-width:0 후 shorthand 복원', src: `.X{border-width:0;border:1px solid ${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): border-width는 canonical 폼이 아니다. 구 모델은 shorthand가 성분을 복원한다고 **계산**했지만, 전환 후 게이트는 non-canonical 선언의 의미를 추론하지 않는다(fail-closed).' },
  { id: '11R-B2', kind: 'border', label: 'shorthand !important 후 border-width:0(non-imp)', src: `.X{border:1px solid ${V} !important;border-width:0}`, visible: false,
    note: '기대 갱신(GREEN→RED): 동일 사유 — !important 우선순위 계산 이전에 border-width:0 자체가 canonical 밖이다.' },
  { id: '11R-B3', kind: 'border', label: 'directional 성분으로 4면 조립', src: `.X{border-width:1px;border-style:solid;border-color:${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): 성분 longhand 조립은 핀이 쓰지 않는 형태라 canonical 집합에 없다. 실제 핀이 이 형태로 바뀌면 개발자가 알아야 한다(게이트의 의도된 신호).' },
  { id: '11R-B4', kind: 'border', label: 'border-style 4값 확장(전면 solid)', src: `.X{border:1px solid ${V};border-style:solid solid solid solid}`, visible: false,
    note: '기대 갱신(GREEN→RED): border-style longhand는 canonical 밖.' },

  // ── 12R F2 wrapper 색함수(직접 var 아님) — 전부 RED 유지.
  { id: '12R-F2a', kind: 'border', label: 'color-mix 0% wrapper', src: `.X{border:1px solid color-mix(in srgb,${V} 0%,transparent)}`, visible: false },
  { id: '12R-F2b', kind: 'border', label: 'rgb(var) wrapper', src: `.X{border:1px solid rgb(${V})}`, visible: false },
  { id: '12R-F2c', kind: 'border', label: 'rgb(from var …/0) wrapper', src: `.X{border:1px solid rgb(from ${V} r g b / 0)}`, visible: false },
  { id: '12R-F2d', kind: 'indicator', label: 'inset 인디케이터 color-mix wrapper', src: `.X{box-shadow:inset 0 0 0 1px color-mix(in srgb,${IV} 0%,transparent)}`, visible: false },
  { id: '12R-F2-GREEN', kind: 'border', label: '직접 var(--expected)(핀 실형태)', src: `.X{border:1px solid ${V}}`, visible: true },

  // ── 12R F3 border-image 도장.
  { id: '12R-F3a', kind: 'border', label: 'border 뒤 투명 border-image', src: `.X{border:1px solid ${V};border-image:linear-gradient(transparent,transparent) 1}`, visible: false },
  { id: '12R-F3b', kind: 'border', label: 'border-image 뒤 winning border shorthand', src: `.X{border-image:linear-gradient(transparent,transparent) 1;border:1px solid ${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): 구 모델은 border shorthand의 border-image initial 리셋을 계산했다. 전환 후엔 border-image 선언(비 CSS-wide)이 존재하는 것 자체가 canonical 위반이다 — reset 부작용 모델이 통째로 사라졌다(finding 3 클래스 소멸).' },
  { id: '12R-F3c', kind: 'border', label: 'important border-image를 non-important border가 못 덮음', src: `.X{border-image:linear-gradient(transparent,transparent) 1 !important;border:1px solid ${V}}`, visible: false },
  { id: '12R-F3d', kind: 'border', label: 'border-image-source longhand(non-none)', src: `.X{border:1px solid ${V};border-image-source:linear-gradient(transparent,transparent)}`, visible: false },
  { id: '12R-F3e', kind: 'border', label: 'border-image-source:none(명시적)', src: `.X{border:1px solid ${V};border-image-source:none}`, visible: false,
    note: '기대 갱신(GREEN→RED): `none`은 CSS-wide 키워드가 아니라 border-image-source의 property별 값이다 — canonical 집합 밖이라 RED. 리셋 의도라면 `initial`/`unset`이 층 2의 모델 대상이다(12R-F3f 참고).' },
  { id: '12R-F3f', kind: 'border', label: 'border-image-source:initial(CSS-wide 리셋)', src: `.X{border:1px solid ${V};border-image-source:initial}`, visible: true },
  { id: '12R-F3g', kind: 'border', label: 'border-image-slice non-initial(명시 예외 A)', src: `.X{border:1px solid ${V};border-image-slice:5}`, visible: false },

  // ── 12R F4 border 문법 전 노드 소비 — 전부 RED 유지 + 폐기 fallback GREEN 갱신.
  { id: '12R-F4a', kind: 'border', label: '1% width', src: `.X{border:1% solid ${V}}`, visible: false },
  { id: '12R-F4b', kind: 'border', label: '1px/solid(slash div 잔여)', src: `.X{border:1px/solid ${V}}`, visible: false },
  { id: '12R-F4c', kind: 'border', label: '1px,solid(comma div 잔여)', src: `.X{border:1px,solid ${V}}`, visible: false },
  { id: '12R-F4d', kind: 'border', label: 'string junk 잔여', src: `.X{border:1px solid ${V} "junk"}`, visible: false },
  { id: '12R-F4e', kind: 'border', label: 'border-width comma 무효 → 구 모델은 이전 0으로 fallback', src: `.X{border-width:0;border-style:solid;border-color:${V};border-width:1px,1px}`, visible: false },
  { id: '12R-F4f', kind: 'border', label: '무효 border-width 뒤 유효 shorthand fallback', src: `.X{border:1px solid ${V};border-width:1px,1px}`, visible: false,
    note: '기대 갱신(GREEN→RED): 구 모델의 "무효 선언 폐기 → 이전 유효 선언 fallback" 동작을 제거했다. 층 2는 무효 CSS를 계산하지 않고, non-canonical 선언의 존재를 실패로 본다.' },

  // ── 13R I2 var 문법 / box-shadow 선언 전체 유효성.
  { id: '13R-I2a', kind: 'border', label: 'border color가 var(--x garbage)', src: `.X{border:1px solid var(--color-input-border garbage)}`, visible: false },
  { id: '13R-I2b1', kind: 'indicator', label: 'inset 중복', src: `.X{box-shadow:inset inset 0 0 0 1px ${IV}}`, visible: false },
  { id: '13R-I2b2', kind: 'indicator', label: 'color 2개(transparent + var)', src: `.X{box-shadow:inset 0 0 0 1px transparent ${IV}}`, visible: false },
  { id: '13R-I2b3', kind: 'indicator', label: '무효 형제 레이어(junk)', src: `.X{box-shadow:junk, inset 0 0 0 1px ${IV}}`, visible: false },
  { id: '13R-I2b-G1', kind: 'indicator', label: '유효 단일 inset 레이어(핀 실형태)', src: `.X{box-shadow:inset 0 0 0 1px ${IV}}`, visible: true },
  { id: '13R-I2b-G2', kind: 'indicator', label: '다중 그림자(HomeTabs 핀 실형태)', src: `.X{box-shadow:var(--shadow-xs), inset 0 0 0 1px ${IV}}`, visible: true },
  { id: '13R-I2b-G3', kind: 'indicator', label: '무효 box-shadow(junk) 후행 → 구 모델은 앞선 유효 선언 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:junk}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 동작 제거(층 2 재설계). junk 선언이 존재하는 것 자체가 실패다.' },

  // ── 13R I3 directional 잔여 노드.
  { id: '13R-I3a', kind: 'border', label: 'directional 잔여노드(1px "junk")', src: `.X{border-width:0;border-style:solid;border-color:${V};border-top-width:1px "junk";border-right-width:1px "junk";border-bottom-width:1px "junk";border-left-width:1px "junk"}`, visible: false },
  { id: '13R-I3b', kind: 'border', label: '잔여 없는 유효 directional(1px)', src: `.X{border-width:0;border-style:solid;border-color:${V};border-top-width:1px;border-right-width:1px;border-bottom-width:1px;border-left-width:1px}`, visible: false,
    note: '기대 갱신(GREEN→RED): directional 성분 longhand는 canonical 밖(11R-B3와 동일 사유).' },

  // ── 13R I4 border-image shorthand 양방향.
  { id: '13R-I4a', kind: 'border', label: 'border-image:none이 stale slice를 리셋', src: `.X{border:1px solid ${V};border-image-slice:5;border-image:none}`, visible: false,
    note: '기대 갱신(GREEN→RED): `none`·`5`가 모두 canonical 밖이다(12R-F3e와 동일 사유). CSS-wide `initial`판은 13R-I4c가 GREEN으로 유지한다.' },
  { id: '13R-I4b', kind: 'border', label: '무효 shorthand(border:junk)는 리셋 안 함', src: `.X{border-image:linear-gradient(transparent,transparent) 1;border-width:1px !important;border-style:solid !important;border-color:${V} !important;border:junk}`, visible: false },
  { id: '13R-I4c', kind: 'border', label: 'border-image:initial(CSS-wide 리셋)', src: `.X{border:1px solid ${V};border-image:initial}`, visible: true },

  // ── 13R 잔여1 deferred(var 포함 문법위반) — 구 모델의 3분기가 전부 하나로 수렴한다.
  { id: '13R-D1', kind: 'indicator', label: 'spread 자리 var(--zero) → deferred', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 var(--zero) ${IV}}`, visible: false },
  { id: '13R-D2', kind: 'border', label: 'width 자리 var(--w) → 슬롯 중복 deferred', src: `.X{border:1px solid ${V};border:var(--w) solid ${V}}`, visible: false },
  { id: '13R-D3', kind: 'indicator', label: 'var 없는 위반(length 5개) → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px 2px}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '13R-D4', kind: 'border', label: 'var 없는 위반(width 슬롯 중복) → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border:1px 2px solid}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '13R-D5', kind: 'indicator', label: 'well-formed 아닌 var만 포함한 위반 → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 var(--zero garbage)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거. well-formed 여부 판정 자체가 사라졌다.' },
  { id: '13R-D6', kind: 'border', label: 'well-formed 아닌 var만 포함한 border 위반', src: `.X{border:1px solid ${V};border:solid var(--w garbage)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },

  // ── 14R I1 border longhand 삼분(CSS-wide·named color·deferred).
  { id: '14R-I1a', kind: 'border', label: 'border-top-color: var(…) "junk"(deferred)', src: `.X{border:1px solid ${V};border-top-color:${V} "junk"}`, visible: false },
  { id: '14R-I1b', kind: 'border', label: 'border-style: initial', src: `.X{border:1px solid ${V};border-style:initial}`, visible: false },
  { id: '14R-I1c', kind: 'border', label: 'border-color: red(named color override)', src: `.X{border:1px solid ${V};border-color:red}`, visible: false },
  { id: '14R-I1d', kind: 'border', label: 'border-color: inherit(모델 불가)', src: `.X{border:1px solid ${V};border-color:inherit}`, visible: false },
  { id: '14R-I1e', kind: 'border', label: 'border-width: unset(CSS-wide 리셋 → border initial)', src: `.X{border:1px solid ${V};border-width:unset}`, visible: false,
    note: '기대 갱신(GREEN→RED): 층 2는 성분별 셀을 모델하지 않는다 — border 계열 CSS-wide 리셋은 경계 전체를 initial(비가시)로 접는다(의도적 과잉 안전, fail-closed).' },
  { id: '14R-I1f', kind: 'border', label: '잔여 없는 유효 directional(border-top-color: V)', src: `.X{border:1px solid ${V};border-top-color:${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): directional 성분 longhand는 canonical 밖(11R-B3 사유).' },
  { id: '14R-I1g', kind: 'border', label: 'var 없는 순수 문법위반(border-top-color: red blue) → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border-top-color:red blue}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '14R-I1h', kind: 'border', label: 'border: initial(shorthand 전체 CSS-wide)', src: `.X{border:1px solid ${V};border:initial}`, visible: false },

  // ── 14R I2 indicator CSS-wide·all·negative blur.
  { id: '14R-I2a', kind: 'indicator', label: 'box-shadow: initial', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:initial}`, visible: false },
  { id: '14R-I2b', kind: 'indicator', label: 'all: initial → box-shadow none', src: `.X{box-shadow:inset 0 0 0 1px ${IV};all:initial}`, visible: false },
  { id: '14R-I2c', kind: 'indicator', label: 'all: initial 후 canonical box-shadow가 이김(순서 대칭)', src: `.X{all:initial;box-shadow:inset 0 0 0 1px ${IV}}`, visible: true },
  { id: '14R-I2d', kind: 'indicator', label: 'all: initial !important 는 후행 non-important를 이김', src: `.X{all:initial !important;box-shadow:inset 0 0 0 1px ${IV}}`, visible: false },
  { id: '14R-I2e', kind: 'indicator', label: 'negative blur(var 없음) → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 -1px 1px #000}`, visible: false,
    note: '기대 갱신(GREEN→RED): 14R에서 브라우저 폐기 의미론에 맞춰 GREEN으로 정정했던 항목. 전환 후엔 브라우저 의미론 재현을 중단했으므로 non-canonical 존재 = RED.' },
  { id: '14R-I2f', kind: 'indicator', label: 'negative blur + well-formed var(deferred)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 -1px 1px ${IV}}`, visible: false },

  // ── 14R I3 재귀 var·색함수 문법·대문자 VAR.
  { id: '14R-I3a', kind: 'border', label: 'fallback 내부 malformed 중첩 var', src: `.X{border:1px solid var(--color-input-border, var(--bad garbage))}`, visible: false },
  { id: '14R-I3b', kind: 'border', label: 'fallback이 정상 var인 중첩(구 모델은 토큰 정상 수집)', src: `.X{border:1px solid var(--color-input-border, var(--fallback))}`, visible: false,
    note: '기대 갱신(GREEN→RED): canonical 토큰 참조는 fallback 없는 `var(--name)`뿐이다.' },
  { id: '14R-I3c', kind: 'indicator', label: 'rgb(from junk r g b) 형제 레이어', src: `.X{box-shadow:0 0 rgb(from junk r g b), inset 0 0 0 1px ${IV}}`, visible: false },
  { id: '14R-I3d', kind: 'border', label: '대문자 VAR()(구 모델은 유효 인정)', src: `.X{border:1px solid VAR(--color-input-border)}`, visible: false,
    note: '기대 갱신(암묵 GREEN→RED): 함수명 대소문자 정규화를 중단했다 — canonical은 소문자 `var(` 정확일치.' },

  // ── 14R I4 border-image 삼분 + CSS-wide.
  { id: '14R-I4a', kind: 'border', label: 'stale slice:5 후 border-image:initial', src: `.X{border:1px solid ${V};border-image-slice:5;border-image:initial}`, visible: false,
    note: '기대 갱신(GREEN→RED): `border-image-slice:5`가 canonical 밖이라 그 존재만으로 RED(후행 리셋 여부와 무관 — 상태 복구 모델 없음).' },
  { id: '14R-I4b', kind: 'border', label: 'border-image: junk 후 source:none', src: `.X{border:1px solid ${V};border-image-slice:5;border-image:junk;border-image-source:none}`, visible: false },
  { id: '14R-I4c', kind: 'border', label: 'border-image: inherit(모델 불가)', src: `.X{border:1px solid ${V};border-image:inherit}`, visible: false },

  // ── 14R I5 필수 전이 3형태 × border·indicator.
  { id: '14R-I5-1b', kind: 'border', label: '① 유효 → 후행 순수 문법위반(값 5개) → 구 모델은 fallback', src: `.X{border:1px solid ${V};border-color:red red red red red}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '14R-I5-1i', kind: 'indicator', label: '① indicator 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px 2px 3px}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '14R-I5-2b', kind: 'border', label: '② 유효 → 후행 deferred → fail-closed', src: `.X{border:1px solid ${V};border-color:${V} "junk"}`, visible: false },
  { id: '14R-I5-2i', kind: 'indicator', label: '② indicator deferred fail-closed', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 var(--zero) ${IV}}`, visible: false },
  { id: '14R-I5-3b', kind: 'border', label: '③ deferred 후 유효 winner가 이김', src: `.X{border:${V} "junk";border:1px solid ${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): 후행 canonical winner가 있어도 앞선 non-canonical 선언의 존재가 실패다(층 1은 순서 무관 전수 판정).' },
  { id: '14R-I5-3i', kind: 'indicator', label: '③ indicator deferred 후 유효 winner', src: `.X{box-shadow:inset 0 0 0 var(--zero) ${IV};box-shadow:inset 0 0 0 1px ${IV}}`, visible: false,
    note: '기대 갱신(GREEN→RED): 동일 사유.' },

  // ── 14R 잔여1 시스템 색.
  { id: '14R-R1a', kind: 'border', label: 'border-color: AccentColor', src: `.X{border:1px solid ${V};border-color:AccentColor}`, visible: false },
  { id: '14R-R1b', kind: 'indicator', label: 'box-shadow … ButtonText', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px ButtonText}`, visible: false },
  { id: '14R-R1c', kind: 'border', label: 'accentcolor(소문자)', src: `.X{border:1px solid ${V};border-color:accentcolor}`, visible: false },
  { id: '14R-R1d', kind: 'border', label: 'deprecated 시스템 색(ThreeDFace)', src: `.X{border:1px solid ${V};border-color:ThreeDFace}`, visible: false },
  { id: '14R-R1e', kind: 'border', label: '미지 ident(NotAColor) → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border-color:NotAColor}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거. "유효 색인가"를 판정하지 않으므로 AccentColor와 NotAColor가 동일하게 RED로 수렴한다 — 이 수렴 자체가 전환의 요지다.' },

  // ── 14R 잔여2 border-image longhand.
  { id: '14R-R2a', kind: 'border', label: 'border-image-source: junk → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border-image-source:junk}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '14R-R2b', kind: 'border', label: '이전 상태=활성 이미지일 때 junk', src: `.X{border:1px solid ${V};border-image-source:linear-gradient(red,blue);border-image-source:junk}`, visible: false },
  { id: '14R-R2c', kind: 'border', label: 'border-image-slice: var(--x)(deferred)', src: `.X{border:1px solid ${V};border-image-slice:var(--x)}`, visible: false },

  // ── 15R I1~I6(헤드리스 Chrome 대조 벡터).
  { id: '15R-M1', kind: 'border', label: 'all: var(--color-bg)(deferred)', src: `.X{border:1px solid ${V};all:var(--color-bg)}`, visible: false },
  { id: '15R-M2', kind: 'indicator', label: 'all: var(--color-bg)(indicator)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};all:var(--color-bg)}`, visible: false },
  { id: '15R-M3', kind: 'border', label: 'border-width: initial 1px(다값 CSS-wide)', src: `.X{border:0 solid ${V};border-width:initial 1px}`, visible: false },
  { id: '15R-M4', kind: 'border', label: 'border-style: initial solid → 구 모델은 선언 폐기 후 solid 유지', src: `.X{border:1px solid ${V};border-style:initial solid}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '15R-M5', kind: 'indicator', label: 'calc 포함 유효 shadow winner', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 calc(1px + 1vw) 1px #000}`, visible: false },
  { id: '15R-M6', kind: 'indicator', label: '인자 부족 색함수 rgb(from red) → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px rgb(from red)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거(색함수 arity 모델 삭제).' },
  { id: '15R-M6b', kind: 'border', label: 'border-color: color-mix(in srgb)(피연산자 부족)', src: `.X{border:1px solid ${V};border-color:color-mix(in srgb)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '15R-M7', kind: 'border', label: 'border-color: tr\\61 nsparent(escaped ident)', src: `.X{border:1px solid ${V};border-color:tr\\61 nsparent}`, visible: false },
  { id: '15R-M8', kind: 'indicator', label: 'box-shadow … r\\65 d(escaped ident)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px r\\65 d}`, visible: false },
  { id: '15R-M9', kind: 'border', label: 'border-color: var(--é) "junk"(비ASCII dashed-ident)', src: `.X{border:1px solid ${V};border-color:var(--é) "junk"}`, visible: false },
  { id: '15R-M10', kind: 'border', label: 'border-image: inherit 후 일반 longhand가 못 지움', src: `.X{border-image:inherit;border-width:1px;border-style:solid;border-color:${V}}`, visible: false },
  { id: '15R-M11', kind: 'border', label: 'border-image: inherit 후 border-image: none 복구', src: `.X{border:1px solid ${V};border-image:inherit;border-image:none}`, visible: false,
    note: '기대 갱신(GREEN→RED): 모델 불가(inherit/revert) 표시는 sticky다 — 후행 리셋으로 해제되지 않는다(의도적 과잉 안전). 게다가 `none`도 canonical 밖이다.' },
  { id: '15R-M12', kind: 'border', label: 'all: inherit 는 후행 longhand로 지워지지 않음', src: `.X{border:1px solid ${V};all:inherit;border-width:1px;border-style:solid;border-color:${V}}`, visible: false },
  { id: '15R-M13', kind: 'border', label: '확인 불가 shorthand(border: foo())는 border-image를 reset하지 않음', src: M13('foo()'), visible: false },
  { id: '15R-M14', kind: 'border', label: '-webkit-image-set 도 <image>로 성립(활성 도장)', src: `.X{border:1px solid ${V};border-image-source:-webkit-image-set("a.png" 1x)}`, visible: false },
  { id: '15R-M15', kind: 'border', label: 'border-image-slice: junk → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border-image-slice:junk}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거(border-image 성분 grammar 모델 삭제).' },
  { id: '15R-M16', kind: 'border', label: 'border-image-repeat: 3값(최대 2 초과)', src: `.X{border:1px solid ${V};border-image-repeat:stretch stretch stretch}`, visible: false,
    note: '기대 갱신(GREEN→RED): 동일 사유.' },
  { id: '15R-ADV1', kind: 'border', label: 'image 활성 상태는 후행 일반 longhand로 안 지워짐(역방향)', src: `.X{border-image-source:linear-gradient(red,blue);border-width:1px;border-style:solid;border-color:${V}}`, visible: false },
  { id: '15R-ADV2', kind: 'border', label: 'border shorthand(유효)가 image를 리셋(구 무회귀 계약)', src: `.X{border-image:inherit;border:1px solid ${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): border-image의 inherit은 모델 불가 sticky다. 구 모델은 shorthand의 리셋 부작용을 계산했지만 그 부작용 모델을 삭제했다.' },
  { id: '15R-EXC-A', kind: 'border', label: '명시 예외 A: source none이어도 non-initial slice면 RED', src: `.X{border:1px solid ${V};border-image-slice:5}`, visible: false },
  { id: '15R-EXC-B', kind: 'border', label: '명시 예외 B: outset:0px(단위만 다른 0)', src: `.X{border:1px solid ${V};border-image-outset:0px}`, visible: false },

  // ── 16R I1~I3 + 근본1.
  { id: '16R-I1a', kind: 'border', label: 'all: env(...)(substitution deferred)', src: `.X{border:1px solid ${V};all:env(safe-area-inset-top)}`, visible: false },
  { id: '16R-I1b', kind: 'indicator', label: 'all: env(...)(indicator)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};all:env(safe-area-inset-top)}`, visible: false },
  { id: '16R-I1c', kind: 'indicator', label: '후행 box-shadow에 env(length 자리)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 env(safe-area-inset-top,3px) 1px red}`, visible: false },
  { id: '16R-I2', kind: 'border', label: '무효 hex(#xyz) shorthand는 border-image를 reset하지 않음', src: M13('#xyz'), visible: false },
  { id: '16R-I3a', kind: 'border', label: '이중 슬래시 색함수는 reset하지 않음', src: M13('rgb(1 2 3 / / 1)'), visible: false },
  { id: '16R-I3b', kind: 'indicator', label: '이중 슬래시 색함수 후행 → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px hsl(0 50% 50% / / 1)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거(색함수 구분자 grammar 모델 삭제).' },
  { id: '16R-I3c', kind: 'border', label: '색 개수 초과 color-mix', src: M13('color-mix(in srgb, red, blue, green)'), visible: false },
  { id: '16R-I3d', kind: 'border', label: '유효 토큰 shorthand 무회귀(핀 실형태)', src: `.X{border:1px solid ${V}}`, visible: true },
];

describe('11R~17R 회귀 벡터 코퍼스 — canonical 게이트 기대로 이관(계약 보존)', () => {
  it.each(CORPUS)('$id $label', ({ kind, src, visible, token }) => {
    const t = token || (kind === 'border' ? CIB : IND);
    const res = kind === 'border' ? evalBorderScss(src, t) : evalIndicatorScss(src, t);
    expect(res.visible, JSON.stringify(res)).toBe(visible);
  });
  it(`코퍼스 규모 하한(현재 ${CORPUS.length}종) — 벡터 유실 방지`, () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(90);
  });
  it('코퍼스 GREEN은 canonical(+CSS-wide)만으로 구성된 것뿐이다 — GREEN 목록 고정', () => {
    expect(CORPUS.filter((c) => c.visible).map((c) => c.id)).toEqual([
      '12R-F2-GREEN', '12R-F3f', '13R-I2b-G1', '13R-I2b-G2', '13R-I4c', '14R-I2c', '16R-I3d',
    ]);
  });
  it('기대 갱신 항목은 전부 사유(note)를 병기한다', () => {
    const updated = CORPUS.filter((c) => c.note);
    expect(updated.length).toBeGreaterThanOrEqual(25);
    for (const c of updated) expect(c.note, c.id).toMatch(/기대 갱신/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I2(19R) — CORPUS "삭제 금지"를 실제로 보장한다. 이전엔 `CORPUS.length >= 90` count만 검사해서, 격리
// 사본에서 11R-A1 한 건을 삭제해도 113개가 여전히 >= 90이라 371/371 통과했다(RED 벡터라 GREEN ID 목록
// 에도 안 걸렸다 = 어디에도 안 잡힘). 처방: 114개 ID를 **순서까지** 고정한 exact manifest로 전체 인벤토리
// 비교 + ID uniqueness 단정(삭제 후 다른 ID 중복으로 개수 맞추는 우회 차단). 각 ID가 어느 라운드 계약
// 인지 그룹 주석으로 표기하고, 라운드별 개수도 고정한다. RED 벡터도 manifest에 포함되므로 삭제 시 걸린다.
// ─────────────────────────────────────────────────────────────────────────────
const CORPUS_MANIFEST = [
  // 11R 대칭 구멍 A(border 4면 cascade)/B (14)
  '11R-A1', '11R-A2', '11R-A3', '11R-A4', '11R-A5', '11R-A6', '11R-A7', '11R-A8', '11R-A9', '11R-A10',
  '11R-B1', '11R-B2', '11R-B3', '11R-B4',
  // 12R F2 색함수 wrapper / F3 border-image 도장 / F4 border 문법 전 노드 소비 (18)
  '12R-F2a', '12R-F2b', '12R-F2c', '12R-F2d', '12R-F2-GREEN',
  '12R-F3a', '12R-F3b', '12R-F3c', '12R-F3d', '12R-F3e', '12R-F3f', '12R-F3g',
  '12R-F4a', '12R-F4b', '12R-F4c', '12R-F4d', '12R-F4e', '12R-F4f',
  // 13R I2 var/box-shadow 유효성 / I3 directional 잔여 / I4 border-image 양방향 / D deferred (18)
  '13R-I2a', '13R-I2b1', '13R-I2b2', '13R-I2b3', '13R-I2b-G1', '13R-I2b-G2', '13R-I2b-G3',
  '13R-I3a', '13R-I3b',
  '13R-I4a', '13R-I4b', '13R-I4c',
  '13R-D1', '13R-D2', '13R-D3', '13R-D4', '13R-D5', '13R-D6',
  // 14R I1 longhand 삼분 / I2 indicator CSS-wide / I3 재귀 var / I4 border-image / I5 전이 / R1 시스템색 / R2 border-image longhand (35)
  '14R-I1a', '14R-I1b', '14R-I1c', '14R-I1d', '14R-I1e', '14R-I1f', '14R-I1g', '14R-I1h',
  '14R-I2a', '14R-I2b', '14R-I2c', '14R-I2d', '14R-I2e', '14R-I2f',
  '14R-I3a', '14R-I3b', '14R-I3c', '14R-I3d',
  '14R-I4a', '14R-I4b', '14R-I4c',
  '14R-I5-1b', '14R-I5-1i', '14R-I5-2b', '14R-I5-2i', '14R-I5-3b', '14R-I5-3i',
  '14R-R1a', '14R-R1b', '14R-R1c', '14R-R1d', '14R-R1e',
  '14R-R2a', '14R-R2b', '14R-R2c',
  // 15R M(헤드리스 Chrome 대조) / ADV(역방향) / EXC(명시 예외) (21)
  '15R-M1', '15R-M2', '15R-M3', '15R-M4', '15R-M5', '15R-M6', '15R-M6b', '15R-M7', '15R-M8', '15R-M9',
  '15R-M10', '15R-M11', '15R-M12', '15R-M13', '15R-M14', '15R-M15', '15R-M16',
  '15R-ADV1', '15R-ADV2', '15R-EXC-A', '15R-EXC-B',
  // 16R I1 env / I2 무효 hex / I3 색함수 구분자 (8)
  '16R-I1a', '16R-I1b', '16R-I1c', '16R-I2', '16R-I3a', '16R-I3b', '16R-I3c', '16R-I3d',
];
const CORPUS_ROUND_COUNTS = { '11R': 14, '12R': 18, '13R': 18, '14R': 35, '15R': 21, '16R': 8 };

describe('I2(19R) — CORPUS exact ordered manifest + uniqueness (삭제/중복 우회 폐쇄)', () => {
  it('manifest 자체가 114개·ID 중복 없음·라운드별 개수 고정', () => {
    expect(CORPUS_MANIFEST).toHaveLength(114);
    expect(new Set(CORPUS_MANIFEST).size).toBe(114);
    const byRound = {};
    for (const id of CORPUS_MANIFEST) { const r = id.match(/^(\d+R)/)[1]; byRound[r] = (byRound[r] || 0) + 1; }
    expect(byRound).toEqual(CORPUS_ROUND_COUNTS);
    expect(Object.values(CORPUS_ROUND_COUNTS).reduce((a, b) => a + b, 0)).toBe(114);
  });

  it('CORPUS 실제 ID 인벤토리 === manifest (순서 포함) — 삭제·재배치·추가 전부 RED', () => {
    // count만 보던 이전 게이트가 놓친 것을 여기서 잡는다: 배열 자체를 순서까지 비교한다.
    expect(CORPUS.map((c) => c.id)).toEqual(CORPUS_MANIFEST);
  });

  it('CORPUS ID uniqueness — 삭제 후 다른 ID 중복으로 개수 맞추는 우회 차단', () => {
    const ids = CORPUS.map((c) => c.id);
    const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(new Set(ids).size, `중복 ID: ${dups.join(', ')}`).toBe(ids.length);
  });

  it('선재현↔RED: 임의 1건(11R-A1) 삭제는 count-only(>=90)로는 못 잡지만 인벤토리·uniqueness가 잡는다', () => {
    const deleted = CORPUS.filter((c) => c.id !== '11R-A1').map((c) => c.id);
    // 선재현: 현행 HEAD의 `CORPUS.length >= 90`은 113개도 통과했다.
    expect(deleted.length).toBeGreaterThanOrEqual(90);
    // 인벤토리 비교는 삭제를 즉시 검출한다.
    expect(deleted).not.toEqual(CORPUS_MANIFEST);
    // 삭제 후 다른 ID를 중복해 개수(114)를 맞추는 우회도 uniqueness + 순서 비교가 잡는다.
    const deletedThenDup = [...deleted, '11R-A2'];
    expect(deletedThenDup).toHaveLength(114);
    expect(new Set(deletedThenDup).size).not.toBe(deletedThenDup.length); // uniqueness RED
    expect(deletedThenDup).not.toEqual(CORPUS_MANIFEST);                  // 순서 비교 RED
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I2(20R) — CORPUS **payload 무결성**. 위 manifest는 ID 존재·순서·uniqueness만 보장하고 각 entry의
// payload(kind/src/visible/token)는 안 봤다. 선재현(옛 게이트): 11R-A1의 ID를 유지한 채 src를 11R-A2와
// 동일 교체하면 border-width:0 벡터가 사실상 삭제(border-style:none 중복)되는데도 ID·순서·개수·GREEN
// 목록 전부 유지 → 통과(false-green). 처방: entry별 정규화 fingerprint(있는 필드만 {id,kind,src,token,
// visible}을 고정 필드순 결정적 직렬화 → SHA-256)를 상수로 고정한다. payload swap·visible 반전·src 변조가
// 해시 불일치로 RED. label/note는 서술 필드라 fingerprint에서 제외(의미 벡터만 잠근다). 새 벡터 추가 시
// CORPUS_FINGERPRINTS도 갱신해야 통과(무결성 잠금 — 그게 의도).
// ─────────────────────────────────────────────────────────────────────────────
const CORPUS_FP_FIELDS = ['id', 'kind', 'src', 'token', 'visible']; // 고정 필드순 = 결정적 직렬화
function corpusEntrySerialize(c) {
  const obj = {};
  for (const k of CORPUS_FP_FIELDS) if (c[k] !== undefined) obj[k] = c[k];
  return JSON.stringify(obj, CORPUS_FP_FIELDS); // replacer 배열 = 키 화이트리스트+순서(존재 필드만)
}
const corpusEntryFingerprint = (c) => createHash('sha256').update(corpusEntrySerialize(c)).digest('hex');

// entry별 payload SHA-256(고정 필드순 직렬화 도출). 새 벡터·payload 변경 시 이 상수도 갱신해야 통과.
const CORPUS_FINGERPRINTS = {
  // 11R
  '11R-A1': 'dc46a16329c15203b613a4afbd18022163234b2f52d56c08f052d844c21aac38',
  '11R-A2': '0d44e72d05066b97cde4bd6ad2bfb27990d53637ee8bafecdb6e71ba697992ba',
  '11R-A3': '3b04fa5dfa13e7ba79fe2ae9d1feeaacb3ca8f3c8296b780eda6632efb0b4bff',
  '11R-A4': '14fa936b488dd1f459e31e6322ed4b32acccb620227803f119bbef5b686c5f1b',
  '11R-A5': '5bd25d404602357564a1d4e54be763be1366dc3073e6a13eaea9bebd809720f3',
  '11R-A6': '8d271ecd31cb9856a848347380d837f54bc9d7b62fd7d9fe951293dc4bf497fe',
  '11R-A7': '4e6d059cdd3fcfbf8b59f4db5fb6db470168e444a6443d3fe9811511a5fb4476',
  '11R-A8': 'a389c137d9af006d375e3909f2403363576fcd668fdfcf1e127b2d8239c3b473',
  '11R-A9': '982dd362a14b752f5ebb82212377d928b272f6ed076ac72bd0857ff3f75e1ce9',
  '11R-A10': 'edc89a68d98805496c053dc4db8482a6aaa2c9a094a91fd23647829e894ed1b2',
  '11R-B1': '0352f268f483f47f6baa9c818a80bba353e53b0e2d2c68fe9fd2a5dc36523500',
  '11R-B2': '916220b5afe31ea3b20f104f964a515ec87eb46ce7da4b75240d608eff3c6db1',
  '11R-B3': '2b78d7e60802905b49a2cd5f3533c162ec710971eb289b229b81c9c92b35a58e',
  '11R-B4': '0a64188ebbf9ad056f16e4488c3a7fa6093dc77479498cbd7e8417eddee595f0',
  // 12R
  '12R-F2a': 'd4b2bbb64cfd8e5ffb0a760054582803adbba22dcb190ccc5fe9bce04417f995',
  '12R-F2b': 'b47e2ae1d797b43a882b4e667ccac1e5ab40990b9b2b5073411f10af60fa7586',
  '12R-F2c': '49c707d50d238f705a1bd329261ca5324346924cff53caf87fa2edc52d5a059c',
  '12R-F2d': '119a63ce8fa2a7adcd6e7223d6a88801353dbaee8fbc7d50270fbab2fa3e58f0',
  '12R-F2-GREEN': '85ad33943fec81e5ece2791c23ee00e611711587adc9594ae0d73023246f2b6a',
  '12R-F3a': '0cc930b2877c1935c4c7551640a7a22c5d79b66d76b9ba87d64e991da841a8e6',
  '12R-F3b': '76317d74865fb3b936a8cac48bf6a6e242335178944fed8c61bd1901aad2c190',
  '12R-F3c': '0313ff92d2f06ca2f588755ad521d3cfa6c7d7c8f093064ce23d3945d460deeb',
  '12R-F3d': '38c81bbd61aaefe4bfdc513d3e786345c8db2b8bb70323ab009801693b726bad',
  '12R-F3e': 'e460481bfb8bc68296cbed8d1956151e1376c6a3e39c5b0bf775aff29765e3ee',
  '12R-F3f': '67ea2c292fd3f04f42411897a972cf6bd22087acc696ccf1022ceb2e706b34d7',
  '12R-F3g': 'f315c4283ff02df4fd8fa60e5083fa78e69d7df75c3921c348f8f88f8e402c8c',
  '12R-F4a': '1c00016553c09834c2a1d437c100be63a82f3ca4f36b41edb23c7b978f36fe95',
  '12R-F4b': 'd3204f37b5633ed22f5564ee71d6c66a6198d4a8b6d9253b5194a05cd099c280',
  '12R-F4c': '215a13ff83eb9b94cfb0f3461a21c85151bcbef6e17e2b1cf78ba5a8da64ee07',
  '12R-F4d': '7fa2980bd7d6edbfa30d00ee50b64ef60885a39057379f2bb968c6f1cfe05eb8',
  '12R-F4e': 'd9126692e3837121f0ff29e8587ecdbfdae202dba37188a60c7dae185c2618d1',
  '12R-F4f': 'ff33787475cdda9ff5e8ca93451e3ca74312ef82bf94f320328f3ee428d7e63e',
  // 13R
  '13R-I2a': '17cb2a1e26c08d6c38c58b4a69dbbf934829101730b6b253b2c5224c9f255990',
  '13R-I2b1': 'f83e9975c6206bc146127fd71f98123c7277b81e87ac4d248b51963244d49163',
  '13R-I2b2': '626f6c66f57edb9babd9b5cb3390f46419c990394d90e62c0b1b32e733661a67',
  '13R-I2b3': 'ea87674585c3d2cad7625480f3c90146b1489baad19e0ec4421dc6d8ec461b4d',
  '13R-I2b-G1': 'e652719b5ca1bffa5235aeeb7def2925f6fb8f8b340d276ce88e81bb0f8e1fbd',
  '13R-I2b-G2': 'e24e7d730d67bd86eb8d50234ea84434b1041824bef70aaeed53d3250f3367a9',
  '13R-I2b-G3': 'bae92da0f6d2777c7797c59f51f14bfc10e0ff712e0056b6f84cc325bc1ee3bf',
  '13R-I3a': '42e5d4fbc8cba1f6c74d9ee721ca8b70c67272608836197ec105cd15022d3f94',
  '13R-I3b': '023e693a33e0a4a71cf91f7d2879363cfcbe63a556116d7300256f442255f053',
  '13R-I4a': 'ce7583886731d5ec507ecd38c0a6afb64267ff0d4fc1f566cc66577ea0970e79',
  '13R-I4b': 'd7bb7e3ad15cd87845168730af025750819fafe6f5d1da4df68696a88bef58c9',
  '13R-I4c': '976db31c02f37e7af54defc68e075895632540bca14d0b3ca369aebb76b13f7b',
  '13R-D1': 'af42d113e6e985088a251e5b273d9898eb25aaa9433db048df4ff5e6eae068ea',
  '13R-D2': 'bcfb08c087e7f74876a59049002a96e82591cc340211ce8073ec73ba1fdc42ce',
  '13R-D3': '54b9fe05a36e32edfae5dca406b312dd8301824d60a0b5fb4a12192625be0146',
  '13R-D4': '5a5322e201ef67e1bc4a506ec3c4b990e03dd0ef5154010ebe5ababe6c579b68',
  '13R-D5': 'ab003274f2a8f25964b0d8ba5e420c6102af98b048213ef80d3a2c0c8b30c4d5',
  '13R-D6': 'b81f48feee042aaab35650d69fb2fde790ae091746cbc040e15aed3f9943aa0d',
  // 14R
  '14R-I1a': '6084bfe477bc54f6d7d79178cd6f2ae81a0bb5b0158b6029d9ed5769e2fe9c9b',
  '14R-I1b': '65738176ea33f7fa586e16b3aca5dd26788aedfb92b2621e7b25f376529e893c',
  '14R-I1c': '35ecd33ba6b87d93d90f46ca5159ed210bd375004228622621dbfbef3945fd90',
  '14R-I1d': '52e9d12552d10d83b5d962d0fa92fc4ab4ebfe6c84ac0686e61695f515d5b101',
  '14R-I1e': '2d921233ff92e7988c3058dbc1fbb5a94e5567d95c4f60316b9bd9cb79f30d9e',
  '14R-I1f': 'b1c5999c5f1382361dfd34ac92e921b989076a715d0330e25d4ccc1647d6546a',
  '14R-I1g': '893fc0480b65397d266898e78d51dbe04622f3b3e4dd29b2bf5f1b6b7e962138',
  '14R-I1h': '714ff3c26f8af0331e4848e9ee7e90ce8e3b8c8d269fa25cad104026eec4abd5',
  '14R-I2a': '97b3aaf2ccaa75f64d2d42cf9c0aac0f00a55751e0b398588d5104fbda7b6e3f',
  '14R-I2b': '64f1cd69c8f770fedf2fec23c624c89761fb82cd184bd67b453f021d7d0df964',
  '14R-I2c': 'c7709e4bf0ef870634c7e84faaa528bbe22da749b51ed008fdb0a0684d06ab8c',
  '14R-I2d': 'af2fdeb540abf233627fd49ab559ae865097c1c5659da9aa71c4272e98f9e2dd',
  '14R-I2e': '7012acd165dbb61ee159f3c5cd7b3fb8ce8dc17fc99e8ddf4f9cf3cf1c1dfc53',
  '14R-I2f': '86f30d0dbbe8fabe888f378a9b5750ef82e8139eb09fc2ca12919203949b3aec',
  '14R-I3a': 'b397e5e700eb39ff98c9c4d5213a062ca746730beae0daf7a3d44a9206025fc0',
  '14R-I3b': '07931d9411b26c28d45c92095c06937f0b1598f866330b7741d37d11706b4e43',
  '14R-I3c': '763cb046273ab58fc11de5db8fceb2c8f0666fc6551dcf09be7e80e9a903abe3',
  '14R-I3d': '5e3df8ae8f5a73f7bcdd4c2a14cacc3e52ce12bcadb3d3c648504fbccbcc555c',
  '14R-I4a': 'e12ce021482ae3d20ad39ec533d1d54894a0a5a33be4b5273e1ef35d4ba55182',
  '14R-I4b': 'b2c6d254ab72c604777fe095d82e4f004879030cfbb8ff8e953880ee53255432',
  '14R-I4c': 'fde44249a5aa118e6564a1c604357eaec806def300a0e2edd700e3781e05d119',
  '14R-I5-1b': '1dcf9c99e6e50167756a0b900d444d7f04e2facb316e723d84a0537a86e6175a',
  '14R-I5-1i': '34936138f3f76cba7f1a431440f8407ec35b62cb6a95de59593fe801c0b3422e',
  '14R-I5-2b': 'a74c79a601e046fa868e13971a1b781e23db321efcb9b7f76423f9262b62f523',
  '14R-I5-2i': 'bcad33f3abb7770063b95eabaaaf46cc19350ab7cbb4666a76d35445fab372fc',
  '14R-I5-3b': '2c42dd570d958f4244067ff80d275893e329d17fb0637973d6c8732f12cc5958',
  '14R-I5-3i': '9effa78108f2827be66a6fdc20724716ad0261f923ec55a40ac4e0970b547ac1',
  '14R-R1a': 'f4702c05c1a32374e1f8b768548b6534f10ff4b2dbc8b847e72adce9b510db1d',
  '14R-R1b': '9bb661f41a2890735a8ad04a0429dae57b7463cee5496359b663d79e04f89ae1',
  '14R-R1c': '23aacb78f3a7edcb72d19967bda51c140abd1d17828d485f2b06ed749acd33d5',
  '14R-R1d': '5c7cc428d0e822555e244672ba10976b76dbd4a73642dd8af25d0c2a7404ca90',
  '14R-R1e': '089607391bfedab11aa6b9e8240e5f6e16d657fb5198bef2809d4009b02d4879',
  '14R-R2a': '1b3ea3fcc863e65d3de774e83a5202ef80e1d4d9b751e1a016a9753cee392fac',
  '14R-R2b': 'aeeb8a271ba072b919bcb4b901959d42413ac79c5a0cf37afb4202d8a0f36a23',
  '14R-R2c': '6736cd50108a328a62e7977581a2f21aaf85e545cbf2fd822e3efd03b787318f',
  // 15R
  '15R-M1': '862fb9a31af02451d9ed963db08cd31ac408bd2596c965a54dca6cb10784db82',
  '15R-M2': 'b9d6439c338ffd97fd44cddfe687dea6d1dcefb96af584ae9e718c1124026f5d',
  '15R-M3': 'aaee8e20316f003422ef50fc73ffeb41def897f200a384c7b6a7acb0337a2ab1',
  '15R-M4': 'e22b82b328ff1eda664659edec33fedbc5a6fb748069082d20e255c212752e8c',
  '15R-M5': '9a12f01f9fd70f8c9bb3fedc7f1e8df009705c049486466eb354a852c56d6b71',
  '15R-M6': '417ea19a9cb4d0325fff3fe5ff62b7c5b10129806178c8958dab9ac30c8d1d35',
  '15R-M6b': '61eeb97a8838a87809de3296b8f6c8ff9ed477434fe8e2e49030f4b33daae88e',
  '15R-M7': '637ea456acb94e65f6753dbe138de7b1a4762671b61fe084f80120d4f8e015a3',
  '15R-M8': 'f2d4741fbc50663b2d6ad9ec6524670be5faddd67ed0b9913a337753928e0005',
  '15R-M9': '6338a71bf1af7d9c67d82634f1bff0e5cf1720649c9bf702de8b071e85c562cf',
  '15R-M10': 'b29ee4b711cd368cccd855c5ae39d47ef5fca1c4cb19b407d0158fb66a4023dc',
  '15R-M11': '05d80260928a197b6797beefdbdb782702f8a31617a97d24e7312ff1b907a22f',
  '15R-M12': '846bc7cc0c46b37c88f311e699f73005342c111627c4be819805dfa3ded5ca08',
  '15R-M13': 'e1d2873a8d99cfc809b6cac59a0a264c844e3c9e73c19bdf282b8f5f80c79a6f',
  '15R-M14': 'ec62bd932e3620502803c8057d437f24da7b3a5250fa3ba4cbf708f00b7b65c3',
  '15R-M15': 'e1903df67fd98d486d43275849edb9d4cf8bd4e979bbfa0ee6d107155a40dfcb',
  '15R-M16': '824c1c4b107f5f53ab0019876c1151371ef902e0eebb5b953e8baa05d8c9ed4a',
  '15R-ADV1': 'fe336c9a24e0b031194adfe5cc765b12d3f05b75ddd8c58af7ea752d3dfa7ea8',
  '15R-ADV2': 'c79c0c8efdc7b421c9a6eb485c50aaa01ddf3e47be61f64a40f5e7caaa3ccdc1',
  '15R-EXC-A': 'c425f8ccaae0e92d38ae01e555fa6cd84dfb39f3155504c556560d9b3f20ffda',
  '15R-EXC-B': '06585dc0f356f6ce14772cc8baa85adf139ccf0f7fe70a4e5f88f3b374d162e5',
  // 16R
  '16R-I1a': '7f19672bfd2411431f3d73d46f721d1933d68941d149f5a94e832a9a0fd7065c',
  '16R-I1b': 'dbe56cf2cbb556863d77fefccb22ef84e25dfdbb1c22c80f1fca97ecc30cd650',
  '16R-I1c': '2c35678efda57dbb5e25b0befb047572f2dd34c47d92d6b49212fa6ac31e693f',
  '16R-I2': 'aa8e67f46aace26e55d560e1132e353cf528f6b6a59db4b8663e1ff229d96f23',
  '16R-I3a': '2a5567f381db64867ea8e381104ccc1525dc4cc79fa13fcd90d421959de48342',
  '16R-I3b': '28a790afe3f1f3d81d9f1d7c246c9b9e605928ef88764004fb6f2f1117f2361d',
  '16R-I3c': '0d2726797fa76f901cd56072a26769f309701f7b7b537da0bdbf7caa5fe1a8c3',
  '16R-I3d': '22e06f9c4562c01aadcc01228628ebd519c87ca36c607b3c4d9dad13a7f83eb6',
};

describe('I2(20R) — CORPUS entry별 payload fingerprint (swap/visible반전/src변조/token 폐쇄)', () => {
  it('fingerprint 맵 키 === manifest (누락·잉여 entry 없음)', () => {
    expect(Object.keys(CORPUS_FINGERPRINTS).sort()).toEqual([...CORPUS_MANIFEST].sort());
  });

  it('각 CORPUS entry의 payload fingerprint가 고정 상수와 일치한다 (src/kind/visible/token 변조 시 RED)', () => {
    for (const c of CORPUS) {
      expect(corpusEntryFingerprint(c), `${c.id} payload 변조(kind/src/visible/token) 또는 상수 미갱신`).toBe(CORPUS_FINGERPRINTS[c.id]);
    }
  });

  it('직렬화 결정성 — 필드 순서 무관·존재 필드만·label/note 제외', () => {
    const a = { id: 'X', kind: 'border', src: '.X{}', visible: false, token: 't', label: 'L', note: 'N' };
    const b = { note: 'DIFF', label: 'DIFF', token: 't', visible: false, src: '.X{}', kind: 'border', id: 'X' };
    expect(corpusEntrySerialize(a)).toBe(corpusEntrySerialize(b));       // 키 순서·label/note 무관
    expect(corpusEntrySerialize(a)).toBe('{"id":"X","kind":"border","src":".X{}","token":"t","visible":false}');
    // token 없는 entry는 필드가 빠진다(있는 필드만 직렬화).
    expect(corpusEntrySerialize({ id: 'Y', kind: 'border', src: '.Y{}', visible: true }))
      .toBe('{"id":"Y","kind":"border","src":".Y{}","visible":true}');
  });

  it('선재현↔RED: 11R-A1 ID 유지 + src를 11R-A2로 교체(payload swap) → manifest는 통과하지만 fingerprint 불일치', () => {
    const a1 = CORPUS.find((c) => c.id === '11R-A1');
    const a2 = CORPUS.find((c) => c.id === '11R-A2');
    const swapped = { ...a1, src: a2.src }; // ID·순서·개수 그대로, payload(src)만 오염
    // 선재현: ID 인벤토리는 그대로라 manifest·GREEN목록·uniqueness가 전부 통과한다(옛 게이트가 놓친 지점).
    const idsAfterSwap = CORPUS.map((c) => (c.id === '11R-A1' ? swapped.id : c.id));
    expect(idsAfterSwap).toEqual(CORPUS_MANIFEST);
    // fingerprint는 src 변조를 즉시 검출한다.
    expect(corpusEntryFingerprint(swapped)).not.toBe(CORPUS_FINGERPRINTS['11R-A1']);
  });

  it('선재현↔RED: visible 반전·token 변조도 fingerprint 불일치로 RED', () => {
    const green = CORPUS.find((c) => c.id === '12R-F2-GREEN'); // visible:true 벡터
    expect(corpusEntryFingerprint({ ...green, visible: false })).not.toBe(CORPUS_FINGERPRINTS['12R-F2-GREEN']);
    const ind = CORPUS.find((c) => c.id === '13R-I2b-G1');     // token 미설정(기본 IND)
    expect(corpusEntryFingerprint({ ...ind, token: 'color-border' })).not.toBe(CORPUS_FINGERPRINTS['13R-I2b-G1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17R 최소 회귀 벡터 상설화 — 외부 검수가 "모델이 정답 판정기라서" 뚫린다고 실증한 8종. 전환 **전**
// 이 8종은 전부 GREEN이었다(선재현 확인: 현행 HEAD 사본에 8 단정을 붙여 8/8 통과 = false-green 확정).
// 전환 후에는 canonical이 아니라는 이유 하나로 전부 RED다 — 개별 grammar 판정이 사라졌으므로 이 부류의
// 우회는 원리적으로 재발할 수 없다.
// 명시 예외: 8종 중 다수는 Sass가 컴파일 단계에서 선-거부(전역 rgb() 인자 검증 실패)하거나
// 선-상수접기(sqrt/hypot 등 CSS Values 4 수학 함수 채택)한다 — SCSS 경로로는 벡터가 원형 그대로 도달할
// 수 없다. 따라서 **raw CSS 텍스트**를 공용 evaluator에 직접 태운다(P4 스윕이 raw .css도 훑으므로 실제
// 입력 경로이며, 17R 이전 라운드도 동일 구조의 예외를 명시해 왔다).
// ─────────────────────────────────────────────────────────────────────────────
const R17_REGRESSION_VECTORS = [
  { id: 'V1', label: 'env(--x, initial) — custom env는 var-전용 deferred 검사에 안 걸려 폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};all:env(--x, initial)}` },
  { id: 'V2', label: 'if(style(--flag: true): initial; else: initial) — 조건 함수 미인식 → 폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};all:if(style(--flag: true): initial; else: initial)}` },
  { id: 'V3', label: 'hypot(3px, 1vw) — MATH_FUNCTIONS 미등재 길이 함수 → length 연속성 위반으로 폐기→핀 부활',
    kind: 'indicator', css: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 hypot(3px, 1vw) 1px red}` },
  { id: 'V4', label: '-webkit-link — 벤더 색 키워드 미등재 → 미지 ident=폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};border-color:-webkit-link}` },
  { id: 'V5', label: 'RGB(from light-dark(red, blue) r g b) — relative-color origin 미인식 → 폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};border-color:RGB(from light-dark(red, blue) r g b)}` },
  { id: 'V6', label: 'RGB(foo(1) 2 3) — known-fn 내부 미지 함수가 unsupported로 낙착해 border-image reset 부작용',
    kind: 'border', css: M13('RGB(foo(1) 2 3)') },
  { id: 'V7', label: 'RGB(1 2 3 4) — 채널 4개(슬래시 없음)를 arity 하한만 보고 valid 인정 → reset 부작용',
    kind: 'border', css: M13('RGB(1 2 3 4)') },
  { id: 'V8', label: 'color-mix 구분자 오용(in srgb red, blue) — 그룹 수 위반=폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};border-color:color-mix(in srgb red, blue)}` },
];
describe('17R 8 회귀 벡터 상설화 — 전환 전 false-green 8/8 → 전환 후 상설 RED', () => {
  it.each(R17_REGRESSION_VECTORS)('$id RED: $label', ({ kind, css: cssText }) => {
    const res = kind === 'border' ? evalBorderCss(cssText, CIB) : evalIndicatorCss(cssText, IND);
    expect(res.visible, JSON.stringify(res)).toBe(false);
    // RED의 **이유**까지 고정한다 — "우연히 다른 경로로 RED"가 아니라 canonical 위반으로 RED여야 한다.
    expect(res.nonCanonical.length + res.unmodelable.length, JSON.stringify(res)).toBeGreaterThan(0);
  });
  it('8종 전부 canonical 판정 자체가 non-canonical이다(값 유효성은 판단하지 않는다)', () => {
    expect(R17_REGRESSION_VECTORS).toHaveLength(8);
    // 적대적 재검토(I2와 동종 인벤토리 클래스): 8종 ID를 순서까지 고정 — 삭제/재배치 시 RED.
    expect(R17_REGRESSION_VECTORS.map((v) => v.id)).toEqual(['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8']);
    const values = [
      ['all', 'env(--x, initial)'],
      ['all', 'if(style(--flag: true): initial)'],
      ['box-shadow', 'inset 0 0 hypot(3px, 1vw) 1px red'],
      ['border-color', '-webkit-link'],
      ['border-color', 'RGB(from light-dark(red, blue) r g b)'],
      ['border', 'RGB(foo(1) 2 3)'],
      ['border', 'RGB(1 2 3 4)'],
      ['border-color', 'color-mix(in srgb red, blue)'],
    ];
    for (const [prop, value] of values) {
      expect(classifyRelevantDecl(prop, value), `${prop}: ${value}`).toEqual({ syntax: 'non-canonical', prop, value: normalizeDeclValue(value) });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fuzz oracle 재설계(검수 권장 4) — 이전 배터리는 `not.toBe('valid')`류라 invalid-discard와 unsupported를
// 뭉뚱그려 **상태 전이를 검증하지 못했다**(브라우저-유효 `-webkit-link`를 넣어도 전부 통과하는데 실제론
// false-green). 이제 벡터를 브라우저 기준으로 3분류하고, **기대 상태 그 자체**를 단정한다:
//   · PROVEN_INVALID        — 브라우저도 폐기하는 값
//   · PROVEN_VALID_UNMODELED— 브라우저에서 유효한데 우리가 모델하지 않는 값(이전 false-green의 원천)
//   · UNKNOWN               — 브라우저 판정을 우리가 확정할 수 없는 값
// 새 아키텍처의 요지는 **세 분류가 동일한 상태로 수렴**한다는 것이다(전부 non-canonical → RED). 분류
// 자체가 판정에 영향을 주지 않는다는 사실이 곧 "유효성 추론 없음"의 증거다.
// Sass compile 실패 벡터를 조용히 필터링하지 않는다 — 전 벡터를 raw CSS 경로로 태워 필터가 아예 없다.
// ─────────────────────────────────────────────────────────────────────────────
const PROVEN_INVALID = [
  '#xyz', '#12', '#12345', '#1234567', '#gggggg', '#',
  'rgb(1 2 3 / / 1)', 'rgb(1,,3)', 'hsl(0 50% 50% / / 1)', 'rgb(from red)',
  'color-mix(in srgb)', 'color-mix(in srgb, red, blue, green)', 'RGB(1 2 3 4)',
  '5xyz', '10flex', 'notacolor', 'inherits', 'initiall', 'url(x) url(y)', '"astring"',
];
const PROVEN_VALID_UNMODELED = [
  '-webkit-link', 'AccentColor', 'ButtonText', 'ThreeDFace', 'red', 'transparent', 'currentcolor',
  'light-dark(#fff, #000)', 'color-mix(in srgb, red, blue)', 'rgb(1 2 3)', 'rgb(1 2 3 / 0.5)',
  '#aabbccdd', '#abc', 'calc(1px + 1vw)', 'hypot(3px, 1vw)', 'env(safe-area-inset-top)',
  'attr(data-x)', 'var(--color-input-border, #ccc)', 'VAR(--color-input-border)', 'tr\\61 nsparent',
];
const UNKNOWN = [
  'zzz()', 'foobar()', 'qux(1, 2)', 'foo-bar-baz()', 'attrx(data-x)',
  'oklab4()', 'lch2(1 2 3)', 'color-contrast(red vs blue)', 'super-gradient(red, blue)',
  'if(style(--flag: true): initial)', 'env(--x, initial)', 'RGB(foo(1) 2 3)',
  '3quux', 'bluish', 'foo-bar-baz', ',,', '/ /',
];
const FUZZ_CLASSES = [
  ['PROVEN_INVALID', PROVEN_INVALID],
  ['PROVEN_VALID_UNMODELED', PROVEN_VALID_UNMODELED],
  ['UNKNOWN', UNKNOWN],
];
describe('17R fuzz oracle 3분류 — 세 분류가 동일 상태(non-canonical/RED)로 수렴한다', () => {
  it('배터리 규모 하한(각 분류 ≥ 15, 합계 ≥ 50)', () => {
    for (const [name, list] of FUZZ_CLASSES) expect(list.length, name).toBeGreaterThanOrEqual(15);
    expect(PROVEN_INVALID.length + PROVEN_VALID_UNMODELED.length + UNKNOWN.length).toBeGreaterThanOrEqual(50);
  });

  it.each(FUZZ_CLASSES)('%s — 층 1은 정확히 non-canonical 상태를 반환한다(네 배치 전부)', (_name, list) => {
    for (const U of list) {
      // 기대 상태 **그 자체**를 단정한다(not-valid가 아니라 정확한 상태 객체).
      expect(classifyRelevantDecl('border', `1px solid ${U}`).syntax, `border:${U}`).toBe('non-canonical');
      expect(classifyRelevantDecl('border', U).syntax, `border-value:${U}`).toBe('non-canonical');
      expect(classifyRelevantDecl('box-shadow', `inset 0 0 0 1px ${U}`).syntax, `bs-color:${U}`).toBe('non-canonical');
      expect(classifyRelevantDecl('all', U).syntax, `all:${U}`).toBe('non-canonical');
    }
  });

  it.each(FUZZ_CLASSES)('%s — cascade 시퀀스: 기존 GREEN → 후보 → RED, 후행 확정 override로도 복구 불가', (_name, list) => {
    for (const U of list) {
      // ① 기존 GREEN 뒤에 후보가 오면 RED
      expect(evalBorderCss(`.X{border:1px solid ${V};border-color:${U}}`, CIB).visible, `seq1:${U}`).toBe(false);
      // ② 후보 뒤에 **확정 canonical override**가 와도 RED(층 1은 순서 무관 전수 판정 — fallback 소멸)
      expect(evalBorderCss(`.X{border-color:${U};border:1px solid ${V}}`, CIB).visible, `seq2:${U}`).toBe(false);
      // ③ indicator 도메인 동일
      expect(evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:${U}}`, IND).visible, `seq3:${U}`).toBe(false);
    }
  });

  it.each(FUZZ_CLASSES)('%s — !important 조합에서도 동일 상태(중요도는 canonical 위반을 구제하지 못한다)', (_name, list) => {
    for (const U of list) {
      expect(evalBorderCss(`.X{border:1px solid ${V} !important;border-color:${U}}`, CIB).visible, `imp1:${U}`).toBe(false);
      expect(evalBorderCss(`.X{border:1px solid ${V};border-color:${U} !important}`, CIB).visible, `imp2:${U}`).toBe(false);
      expect(evalBorderCss(`.X{border-color:${U} !important;border:1px solid ${V} !important}`, CIB).visible, `imp3:${U}`).toBe(false);
    }
  });

  it('분류를 바꾸는 mutation은 판정을 바꾸지 못한다 — 세 분류의 상태 집합이 완전히 동일하다', () => {
    const stateOf = (U) => JSON.stringify([
      classifyRelevantDecl('border', `1px solid ${U}`).syntax,
      evalBorderCss(`.X{border:1px solid ${V};border-color:${U}}`, CIB).visible,
      evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:${U}}`, IND).visible,
    ]);
    const states = new Set([...PROVEN_INVALID, ...PROVEN_VALID_UNMODELED, ...UNKNOWN].map(stateOf));
    expect([...states]).toEqual([JSON.stringify(['non-canonical', false, false])]);
  });

  it('mutation 검출력 — 후보 자리에 canonical 폼이 오면 GREEN이 된다(위 RED 단정이 공허하지 않음)', () => {
    // 동일 위치·동일 구조에서 canonical만 GREEN을 낸다는 대조. 이 단정이 없으면 위 RED들은
    // "무엇을 넣어도 RED"인 공허한 게이트와 구분되지 않는다.
    expect(evalBorderCss(`.X{border:1px solid ${V}}`, CIB).visible).toBe(true);
    expect(evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV}}`, IND).visible).toBe(true);
    expect(evalBorderCss(`.X{border:1px solid ${V};border-color:zzz()}`, CIB).visible).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17R 적대적 자가 재검토 — **canonical 매칭 자체를 우회하는 경로**를 직접 단정한다(수집 누락·셀렉터
// 구멍·부작용 잔존·정규식 anchoring).
// ─────────────────────────────────────────────────────────────────────────────
describe('17R 적대적 자가 재검토 — canonical 매칭 우회 경로 폐쇄', () => {
  it('부작용 금지: 비-canonical 선언은 canonical 셀을 덮지 않으며, 그럼에도 RED다', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V};border:RGB(foo(1) 2 3)}`, CIB);
    expect(res.border).toEqual({ width: 1, style: 'solid', token: CIB }); // 앞선 canonical 셀 그대로
    expect(res.nonCanonical).toHaveLength(1);
    expect(res.visible).toBe(false); // 부작용은 없지만 존재 자체가 실패(fail-closed)
  });
  it('relevant 수집 누락 없음: escaped prop(\\62 ox-shadow=box-shadow)도 relevant로 복원돼 판정된다', () => {
    const res = evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV};\\62 ox-shadow:none}`, IND);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/ox-shadow: none/);
  });
  // 내부 리뷰 실증 — isRelevantProp이 `prop.startsWith('border')`/`=== 'box-shadow'`로만 판정하던 동안
  // `-webkit-border-image`/`-webkit-box-shadow` 같은 벤더 프리픽스 alias는 relevant 수집에서 아예
  // 빠졌다(=층 1이 그 선언을 못 보고 지나침 → canonical 위반 판정 자체가 실행 안 돼 항상 GREEN이었다).
  // Chrome/Safari 둘 다 이 alias를 지원하므로 실제 렌더는 도장/그림자 소멸인데 게이트는 GREEN — 상설
  // 회귀 벡터로 고정한다(styles/ 현재 사용 0건이라 latent이나, 15R VENDOR_PREFIX_RE/unprefixedFn이 17R
  // 삭제분에 함께 사라진 결과로 재발한 구멍이다).
  it('relevant 수집 누락 없음: 벤더 프리픽스 alias(-webkit-border-image)도 relevant로 복원돼 RED — 이전엔 미수집 false-green', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V};-webkit-border-image:url(a.png)}`, CIB);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/-webkit-border-image: url\(a\.png\)/);
  });
  it('relevant 수집 누락 없음: 벤더 프리픽스 alias(-webkit-box-shadow)도 relevant로 복원돼 RED — 이전엔 미수집 false-green', () => {
    const res = evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV};-webkit-box-shadow:none}`, IND);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/-webkit-box-shadow: none/);
  });
  it('relevant 수집 누락 없음: 대문자 프로퍼티(BORDER)도 normalizeProp로 통합돼 판정된다', () => {
    expect(evalBorderCss(`.X{border:1px solid ${V};BORDER-COLOR:red}`, CIB).visible).toBe(false);
  });
  it('중첩 규칙 안 선언도 walkDecls 전수 방문 — root 직속 규칙 내부의 어떤 선언도 놓치지 않는다', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V};border-style:dotted dotted}`, CIB);
    expect(res.nonCanonical).toHaveLength(1);
  });
  it('anchoring: canonical 정규식은 부분 매칭되지 않는다(접두/접미 잔여 거부)', () => {
    expect(classifyRelevantDecl('border', `1px solid ${V} extra`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('border', `x 1px solid ${V}`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('box-shadow', `inset 0 0 0 1px ${IV} extra`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('box-shadow', `junk, inset 0 0 0 1px ${IV}`).syntax).toBe('non-canonical');
  });
  it('canonical 폼은 프로퍼티에 묶여 있다 — 같은 문자열이라도 다른 프로퍼티에선 canonical이 아니다', () => {
    expect(classifyRelevantDecl('border', `inset 0 0 0 1px ${IV}`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('box-shadow', `1px solid ${V}`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('border-top', `1px solid ${V}`).syntax).toBe('non-canonical'); // 핀 미사용 형태
  });
  it('CSS-wide 인정은 값 전체가 소문자 단독일 때만(다값·대문자 변형 거부)', () => {
    expect(classifyRelevantDecl('all', 'initial').syntax).toBe('canonical');
    expect(classifyRelevantDecl('all', ' unset ').syntax).toBe('canonical'); // 공백 정규화만 허용
    expect(classifyRelevantDecl('all', 'INITIAL').syntax).toBe('non-canonical'); // 명시 예외(fail-closed)
    expect(classifyRelevantDecl('all', 'initial initial').syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('border-width', 'initial 1px').syntax).toBe('non-canonical');
  });
  it('모델 불가(inherit/revert)는 sticky — 후행 canonical이 있어도 RED', () => {
    expect(evalBorderCss(`.X{all:inherit;border:1px solid ${V}}`, CIB).visible).toBe(false);
    expect(evalBorderCss(`.X{border:1px solid ${V};border-color:revert}`, CIB).visible).toBe(false);
    expect(evalIndicatorCss(`.X{box-shadow:revert-layer;box-shadow:inset 0 0 0 1px ${IV}}`, IND).visible).toBe(false);
  });
  it('셀렉터 미발견은 GREEN이 아니다(rulesFound 0 → RED)', () => {
    expect(evalBorderCss('.Y{border:1px solid var(--color-input-border)}', CIB).visible).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 명시 예외 **전수**(문구 축소, 18R) — 이 게이트의 보장은 "exact selector + 정적 styles 인벤토리
// (styles/**/*.{scss,css}) 범위 내"로 한정된다. 아래 4건은 그 범위 **밖**이며 이번 라운드에서도 닫지
// 못했다. 각 항목은 "알려진 한계"를 단정으로 고정한 것이지 계약이 아니다 — 수렴 선언 금지.
// ─────────────────────────────────────────────────────────────────────────────
describe('명시 예외 전수 — 게이트 범위 밖 경로(알려진 한계 고정, 계약 아님)', () => {
  // ① 셀렉터 동치성. M2(18R) 정정: 이전 테스트는 `.X` 핀에 무관한 `.b.a` 규칙을 붙여 "순서만 다른
  //    동일 복합 셀렉터"를 전혀 재현하지 못했다(그냥 남남인 셀렉터라 GREEN은 당연). 실제 동치 예외는
  //    **`.a.b` 대 `.b.a`** — CSS 의미론상 같은 요소를 고르는데 문자열 비교로는 다른 셀렉터다.
  it('① 셀렉터 동치성: .a.b 핀에 대해 .b.a 의 override는 후보에 안 들어온다', () => {
    const cssText = `.a.b{border:1px solid ${V}}.b.a{border:none}`;
    const res = evaluatePinnedContract(cssText, '.a.b', { kind: 'border', token: CIB });
    expect(res.rulesFound).toBe(1); // `.b.a` 규칙은 수집되지 않았다
    expect(res.visible).toBe(true); // ← 알려진 한계(실렌더는 border:none)
    // 대조: 문자열이 같으면 정상 수집돼 RED가 된다(위 GREEN이 "아무거나 GREEN"이 아님을 확인).
    expect(evaluatePinnedContract(`.a.b{border:1px solid ${V}}.a.b{border:none}`, '.a.b',
      { kind: 'border', token: CIB }).visible).toBe(false);
  });
  it('② 타 셀렉터 cascade: 더 높은 specificity의 override는 범위 밖', () => {
    const cssText = `.X{border:1px solid ${V}}.Foo .X{border:none}`;
    expect(evalBorderCss(cssText, CIB).visible).toBe(true); // ← 알려진 한계
  });
  it('③ 로컬 custom property 재정의: 핀 게이트 단독으론 GREEN — 폐쇄는 P4 스윕과의 합성에 의존', () => {
    const cssText = `.X{border:1px solid ${V};--color-input-border:transparent}`;
    expect(evalBorderCss(cssText, CIB).visible).toBe(true); // ← 알려진 한계
    // 전체 스위트가 RED로 수렴하는 건 이 재정의 자체를 잡는 P4가 별도로 있기 때문(합성 의존).
    // P4가 약화되거나(대상 파일 판정 밖) 우회되면 이 구멍이 그대로 열린다.
    expect(findProtectedDeclarations(cssText).length).toBeGreaterThan(0);
  });
  it('④ JS 런타임 CSS 쓰기(registerProperty·style.setProperty·JSX inline style·동적 <style> 텍스트)는 정적 styles 인벤토리 밖 — @property at-rule만 폐쇄(I4), M1 스윕은 WRITE_RES 세 정규식의 lexical match만 0건 고정(semantic write 아님·줄바꿈/브래킷 형태는 미보장)', () => {
    // M1(18R→20R) 확장 기록: 예외④는 CSS.registerProperty **하나**가 아니라 런타임 생성 CSS/custom-property
    // 쓰기 **전체**다 — (a) el.style.setProperty('--color-x', …), (b) JSX `style={{ '--color-x': … }}`,
    // (c) 동적 <style> 텍스트 주입, (d) CSS.registerProperty. 이들은 styles/**/*.{scss,css}에 나타나지 않아
    // 이 정적 게이트의 입력 밖이다. CSS 텍스트 경로(@property)는 I4에서 닫혔지만 위 JS 경로는 열려 있다.
    expect(findProtectedDeclarations('@property --color-input-border{syntax:"<color>";inherits:false;initial-value:transparent}')
      .length).toBeGreaterThan(0);
    // .js 파일은 어떤 것도 스윕 대상이 아니다(styles 밖·확장자 밖 둘 다).
    expect(isProtectedSweepTarget('library/theme.js')).toBe(false);
    expect(isProtectedSweepTarget('components/Canvas/CanvasPageView.js')).toBe(false);
    // 단, 보호 토큰 이름을 향한 **WRITE_RES 세 정규식의 lexical match**만은 M1 인벤토리 스윕이 0건 고정한다
    // (아래 describe·semantic write 보장 아님). M1(20R→22R) 주장 범위: 완전 커버는 JS AST 스캔이 필요하고 그건 스코프
    // 밖이므로 — 줄바꿈된 setProperty(…\n '--color-x')·브래킷 접근(style['--color-x']=)은 정규식 증설로
    // 흉내내지 않고 **명시적 미보장**으로 남긴다(아래 describe가 그 미보장 경계를 단정으로 기록).
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M1(19R→22R) — 예외④ 보강: components/·pages/ JS에서 **WRITE_RES 세 정규식의 lexical match 0건**을
// 인벤토리로 잠근다. M1(22R) 문구 정직화(외부 검수 정정): 이 grep 스윕이 **보장**하는 것은 "semantic write
// (실제 런타임 CSS 쓰기)"가 아니라 정확히 "**현재 세 정규식(WRITE_RES)의 lexical form 매치**"뿐이다.
//   · **under-match(미보장)**: 유효한 런타임 쓰기라도 세 정규식의 lexical form을 벗어나면 못 잡는다(아래
//     '미보장 경계' it). 완전 커버는 JS AST 스캔을 요구하므로 스코프 밖(예외④와 동종).
//   · **over-match(false-positive)**: 반대로 실제 write가 아닌 **문자열·블록주석**(`const note='--color-x: docs'`
//     / `/* --color-x: docs */`)도 세 정규식에 걸린다 — 스윕이 lexical match이지 semantic write가 아니라는
//     계약의 정확한 성격이다(아래 'false-positive 경계' it이 단정으로 고정 — 현재 repo엔 그런 라인이 없어
//     실 스윕은 0건이지만 계약의 성격을 못박는다). 정규식 증설로 어느 쪽도 흉내내지 않는다.
// **명시적 미보장**(under-match) — 전부 유효한 런타임 쓰기이지만 세 정규식의 lexical form 밖이라 못 잡는
// 사례를 아래 '미보장 경계' it이 단정으로 고정한다:
//   · `setProperty (` — 함수명과 `(` 사이 공백(정규식은 `.setProperty(` 인접만)
//   · `setProperty(/*c*/'--x'` — `(` 뒤 블록주석(정규식은 `(` 뒤 즉시 따옴표만)
//   · `registerProperty?.({name:'--x'})` — optional chaining `?.`(정규식은 `registerProperty(` 인접만)
//   · `const u='https://x'; setProperty('--x',v)` — 문자열 내 `//`를 `line.split('//')[0]`가 잘라 놓침
//   · 줄바꿈된 setProperty(…\n '--x')·브래킷 접근(style['--x']=)·문자열 연결로 조립한 토큰 이름
// 이로써 스윕을 "완전 보호"로 오인하지 못하게 한다. 비보호 런타임 주입(--branch-color/--status-color/
// --accent/--sticky-header-h)은 보호 접두(--color-/--track-/--shadow-)가 아니라 자연히 제외된다.
// ─────────────────────────────────────────────────────────────────────────────
describe('M1(22R) — components/·pages/ JS WRITE_RES lexical match 0건 스윕 (예외④ 보강·주장 범위=세 정규식 lexical form, semantic write 아님)', () => {
  const repoRoot = resolve(__dirname, '..');
  const jsFiles = ['components', 'pages'].flatMap((d) => {
    const dir = resolve(repoRoot, d);
    return readdirSync(dir, { recursive: true }).map(String)
      .filter((f) => f.endsWith('.js')).map((f) => resolve(dir, f));
  });
  // WRITE_RES 세 정규식의 lexical form만 매치한다(semantic write 아님·소비 var(--color-x)는 제외). 세 형태:
  const WRITE_RES = [
    /--(?:color|track|shadow)-[a-z0-9-]+["'`]?\s*:/,             // 객체 키/CSS 선언: '--color-x': 또는 --color-x:
    /\.setProperty\(\s*["'`]--(?:color|track|shadow)-/,           // el.style.setProperty('--color-x', …)
    /registerProperty\(\s*\{[^}]*["'`]--(?:color|track|shadow)-/, // CSS.registerProperty({ name: '--color-x' })
  ];
  it('컴포넌트/페이지 JS가 충분히 수집된다(스윕 공허 방지)', () => {
    expect(jsFiles.length).toBeGreaterThan(100);
  });
  it('WRITE_RES 세 정규식의 lexical match가 components/·pages/ JS에 0건 (semantic write 주장 아님)', () => {
    const offenders = [];
    for (const f of jsFiles) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.split('//')[0]; // 라인 주석 제외
        if (WRITE_RES.some((re) => re.test(code))) offenders.push(`${f.replace(repoRoot + '/', '')}:${i + 1}`);
      });
    }
    expect(offenders, `WRITE_RES lexical match 발견(semantic write 보장 아님·런타임 주입은 게이트 밖 — 신설 시 명시 결정 필요): ${offenders.join('; ')}`).toEqual([]);
  });
  it('스윕 검출력(공허하지 않음): 합성 단일행 write는 잡고, read/비보호는 안 잡는다', () => {
    const writes = [
      `style={{ '--color-x': v }}`,
      `el.style.setProperty('--track-y', z)`,
      `CSS.registerProperty({ name: '--shadow-z' })`,
      '`--color-a: ${v}; border: 1px`',
    ];
    for (const s of writes) expect(WRITE_RES.some((re) => re.test(s)), s).toBe(true);
    const nonWrites = [
      'border: 1px solid var(--color-x)',                 // 소비(read)
      `el.style.setProperty('--sticky-header-h', h)`,     // 비보호 런타임 주입
      'var(--branch-color)',                              // 비보호 소비
    ];
    for (const s of nonWrites) expect(WRITE_RES.some((re) => re.test(s)), s).toBe(false);
  });
  it('미보장 경계(M1(21R) 명시 기록): 공백·블록주석·optional chaining·문자열 내 //·줄바꿈·브래킷·문자열 조립은 세 정규식 lexical form 밖이라 스윕이 **못 잡는다**', () => {
    // 아래는 전부 **유효한** 런타임 보호토큰 쓰기인데 세 정규식의 정확한 lexical form을 벗어나 미보장이다
    // (정규식 증설로 흉내내지 않음 — 완전 커버는 JS AST 스캔, 스코프 밖). 앞 4건은 M1(21R) 신규 고정.
    const UNGUARDED = [
      "el.style.setProperty ('--color-x', v)",         // ① 함수명과 '(' 사이 공백 — `.setProperty(` 인접만 매치
      "el.style.setProperty(/*c*/'--color-x', v)",     // ② '(' 뒤 블록주석 — `(` 뒤 즉시 따옴표만 매치
      "CSS.registerProperty?.({ name: '--color-x' })", // ③ optional chaining `?.` — `registerProperty(` 인접만 매치
      "const url = 'https://x'; el.style.setProperty('--color-x', v)", // ④ 문자열 내 `//` → split('//')[0]가 setProperty 앞에서 자름
      "el.style.setProperty(\n  '--color-x', v)",      // 줄바꿈된 setProperty(다음 줄에 토큰)
      "el.style['--color-x'] = v",                     // 브래킷 접근 대입(: 아님)
      "el.style.setProperty('--' + 'color-x', v)",     // 문자열 연결로 조립한 토큰 이름
    ];
    for (const s of UNGUARDED) {
      // 실제 스윕과 **동일한 파이프라인**(줄 분리 → line.split('//')[0] → WRITE_RES)으로 판정한다 — 문자열 내
      // // 사례가 //-스트립 때문에 미보장임을 faithfully 재현하려면 이 전처리가 필수다.
      const anyLineMatched = s.split('\n').some((line) => WRITE_RES.some((re) => re.test(line.split('//')[0])));
      expect(anyLineMatched, `미보장이어야 하는 형태가 잡혔다(주장 범위 재검토 필요): ${JSON.stringify(s)}`).toBe(false);
    }
    // 대조: 정확한 lexical form(공백/주석/`?.` 없는 인접 형태)은 잡힌다 — 위 미보장이 "아무거나 통과"가 아님을 확인.
    const GUARDED = [
      "el.style.setProperty('--color-x', v)",
      "CSS.registerProperty({ name: '--color-x' })",
      "style={{ '--color-x': v }}",
    ];
    for (const s of GUARDED) {
      expect(WRITE_RES.some((re) => re.test(s.split('//')[0])), s).toBe(true);
    }
  });
  it('false-positive 경계(M1(22R) 명시 기록): 실제 write가 아닌 문자열·블록주석도 WRITE_RES에 걸린다 — 스윕은 semantic write가 아니라 lexical match다', () => {
    // over-match 방향의 정직화: 아래는 **런타임 write가 아닌데도** 세 정규식에 매치되는 false-positive다.
    // 스윕이 semantic write를 보장하지 않고 오직 lexical form을 본다는 계약의 정확한 성격을 못박는다.
    // 현재 repo엔 이런 라인이 없어 실 스윕(위 0건 it)은 통과하지만, 이런 문자열/주석이 추가되면 write가
    // 아니어도 offender로 잡힌다(계약상 허용되는 오탐 — 정규식으로 배제하지 않는다).
    const FALSE_POSITIVES = [
      "const note = '--color-x: docs'",  // ① 문자열 리터럴 — CSS 선언이 아님
      "/* --color-x: docs */",           // ② 블록주석(라인주석 아님 → line.split('//')[0]이 못 벗긴다)
    ];
    for (const s of FALSE_POSITIVES) {
      // 실 스윕과 동일 파이프라인(line.split('//')[0] → WRITE_RES)으로 판정 — 블록주석이 //-스트립을 통과함을 재현.
      const matched = s.split('\n').some((line) => WRITE_RES.some((re) => re.test(line.split('//')[0])));
      expect(matched, `false-positive여야 하는 형태가 안 잡혔다(계약 성격 재검토 필요): ${JSON.stringify(s)}`).toBe(true);
    }
    // 대조: 라인주석(`//` 접두)은 line.split('//')[0]이 벗겨 잡히지 않는다 — false-positive가 "아무거나 매치"가 아님을 확인.
    expect(WRITE_RES.some((re) => re.test("// --color-x: docs".split('//')[0]))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18R 상설 회귀 벡터 — I1~I4 각각의 "선재현 실측(현행 HEAD에서 false-green)" ↔ "수정 후 RED"를 그대로
// 테스트로 굳힌다. 선재현 근거는 각 describe 머리주석에 실측값으로 기록돼 있다.
// ─────────────────────────────────────────────────────────────────────────────
// CSS가 공백으로 보지 않는(=ident 문자이거나 아예 불법인) JS-공백 코드포인트. 선재현에서 이 4종 각각이
// 셀렉터·box-shadow 값·border 값 3자리 모두에서 false-green이었다(12/12).
const NON_CSS_WS = {
  'NBSP U+00A0': '\u00A0',
  'EM SPACE U+2003': '\u2003',
  'ZWNBSP U+FEFF': '\uFEFF',
  'VERTICAL TAB U+000B': '\u000B',
};
// M2(19R) — **ECMAScript `\s` 전체 − CSS 공백 5종**의 완전 집합(20종). NON_CSS_WS(위 4종)는 대표 샘플일
// 뿐이라 U+2028/U+2029/U+202F/U+1680/U+2000–200A 등 미등재 문자가 회귀해도 못 잡았다. 이 완전 집합 +
// 완전성 단정으로 "JS_ONLY_WS_RE/NON_CSS_WS를 4종 전용으로 약화하면 RED"를 강제한다(실측 도출: BMP 스캔
// `/\s/.test(ch) && !CSS5.test(ch)`).
const JS_ONLY_WS_CODEPOINTS = [
  0x000B, 0x00A0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
  0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
];
const JS_ONLY_WS_CHARS = JS_ONLY_WS_CODEPOINTS.map((cp) => String.fromCodePoint(cp))
const hex4 = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

describe('I1(18R) — CSS 공백 전용 정규화(손실 정규화 폐쇄)', () => {
  it('CSS 공백 5종만 공백으로 취급한다(헬퍼 단위 계약)', () => {
    expect(normalizeCssWhitespace(' \t\n\f\r a \t\n\f\r ')).toBe('a');
    for (const [name, w] of Object.entries(NON_CSS_WS)) {
      expect(cssTrim(`a${w}`), name).toBe(`a${w}`);           // trim이 삼키지 않는다
      expect(normalizeCssWhitespace(`a${w}b`), name).toBe(`a${w}b`); // space로 바뀌지 않는다
      expect(JS_ONLY_WS_RE.test(w), name).toBe(true);
    }
    expect(JS_ONLY_WS_RE.test('.HomeTabs__Tab.is-on')).toBe(false); // 실핀 셀렉터는 무영향
  });

  it.each(Object.entries(NON_CSS_WS))('셀렉터 %s: 브라우저 기준 다른 셀렉터 → 핀에 수집되지 않는다(rulesFound 0)', (_name, w) => {
    // 선재현: 4종 전부 rulesFound=1(=`.X`로 오인해 PINNED 수집) → false-green의 진입점이었다.
    const res = evaluatePinnedContract(`.X${w}{border:1px solid ${V}}`, '.X', { kind: 'border', token: CIB });
    expect(res.rulesFound ?? 0).toBe(0);
    expect(res.visible).toBe(false);
  });

  it.each(Object.entries(NON_CSS_WS))('box-shadow 값 %s: 브라우저 계산값 none인데 canonical이었다 → non-canonical RED', (_name, w) => {
    const value = `inset${w}0 0 0 1px ${IV}`;
    expect(classifyRelevantDecl('box-shadow', value).syntax).toBe('non-canonical');
    expect(evalIndicatorCss(`.X{box-shadow:${value}}`, IND).visible).toBe(false);
  });

  it.each(Object.entries(NON_CSS_WS))('border 값 %s: 동일 — non-canonical RED', (_name, w) => {
    const value = `1px${w}solid ${V}`;
    expect(classifyRelevantDecl('border', value).syntax).toBe('non-canonical');
    expect(evalBorderCss(`.X{border:${value}}`, CIB).visible).toBe(false);
  });

  it('토큰 값 경계의 비-CSS 공백도 JS trim으로 지워지지 않는다 — 다크 대비 단정이 RED로 떨어진다', () => {
    // `--color-selected-indicator: #6B7280<NBSP>`는 브라우저에서 무효(토큰 미적용)인데 JS trim은
    // 정상 hex로 둔갑시켰다. 이제 파싱 실패 → contrastOverBg 0 → 3:1 단정 RED.
    const themes = `
      :root { --color-bg: #FFFFFF; --color-selected-indicator: transparent; }
      html[data-theme=dark] { --color-bg: #0E0F11; --color-selected-indicator: #6B7280\u00A0; }
      :root { --color-alias-unused: 0; }
    `;
    const darkValues = buildDarkValues(themes);
    expect(darkValues['color-selected-indicator']).toBe('#6B7280\u00A0');
    expect(contrastOverBg(darkValues['color-selected-indicator'], darkValues['color-bg'])).toBe(0);
  });

  it('parseColor도 CSS 공백 전용 — 값 경계·구분자 NBSP는 null(과대 허용 폐쇄, 자가 재검토 발견분)', () => {
    // 발견 경위: I1 수정 후에도 `#6B7280<NBSP>`의 다크 대비가 3.97로 통과했다 — parseColor가 여전히
    // JS trim을 쓰고 rgba 구분자를 `\s*`로 받고 있었다(같은 클래스의 잔존 인스턴스).
    expect(parseColor('#6B7280\u00A0')).toBeNull();                 // 값 경계
    expect(parseColor('rgba(107,\u00A0114,128,1)')).toBeNull();     // 구분자 NBSP
    expect(parseColor('rgba(107,\u2003114,128,1)')).toBeNull();     // 구분자 EM SPACE
    // CSS 공백은 그대로 허용(과잉 RED 방지)
    expect(parseColor('  #6B7280\t')).toEqual({ r: 107, g: 114, b: 128, a: 1 });
    expect(parseColor('rgba(107,\t114,\n128, 1)')).toEqual({ r: 107, g: 114, b: 128, a: 1 });
  });

  it('_themes.scss 블록 키 추출도 CSS 공백 전용 — `--color-bg<NBSP>:`는 별개 토큰이라 키에서 빠진다', () => {
    expect([...extractTokenKeys('--color-bg: #fff; --color-x : #000;')]).toEqual(['color-bg', 'color-x']);
    expect([...extractTokenKeys('--color-bg\u00A0: #fff;')]).toEqual([]); // 매치 실패 → 대칭 단정이 RED
  });

  it('structuralGate 블록 형태 판정도 CSS 공백 전용 — NBSP 붙은 다크 셀렉터는 다크로 인정되지 않는다', () => {
    const cssText = `:root{--color-a:1}html[data-theme='dark']\u00A0{--color-a:2}:root{--color-b:3}`;
    expect(() => structuralGate(cssText)).toThrow(/2번째 블록\(다크\)/);
    const lightNbsp = `:root\u00A0{--color-a:1}html[data-theme='dark']{--color-a:2}:root{--color-b:3}`;
    expect(() => structuralGate(lightNbsp)).toThrow(/1번째 블록\(라이트\)/);
  });
});

describe('M2(19R) — NON_CSS_WS 완전성(ECMAScript \\s − CSS 5종 20문자) + resolveColorValue 직접 테스트', () => {
  it('JS_ONLY_WS_CHARS는 "ECMAScript \\s 전체 − CSS 5종"의 완전 집합이다 (4종 약화 시 RED)', () => {
    // BMP 전체를 스캔해 "JS 공백이지만 CSS 공백은 아닌" 코드포인트 집합을 실측하고 fixture와 대조한다.
    const css5 = new RegExp(`[${CSS_WS_CLASS}]`);
    const computed = [];
    for (let cp = 0; cp <= 0xFFFF; cp++) {
      const ch = String.fromCharCode(cp);
      if (/\s/.test(ch) && !css5.test(ch)) computed.push(cp);
    }
    expect([...JS_ONLY_WS_CODEPOINTS].sort((a, b) => a - b)).toEqual(computed.sort((a, b) => a - b));
    expect(JS_ONLY_WS_CHARS).toHaveLength(20);
    // JS_ONLY_WS_RE가 전 문자를 매치하고 CSS 5종은 매치하지 않는다(정규식-fixture 정합).
    for (const ch of JS_ONLY_WS_CHARS) expect(JS_ONLY_WS_RE.test(ch), hex4(ch)).toBe(true);
    for (const ch of [' ', '\t', '\n', '\f', '\r']) expect(JS_ONLY_WS_RE.test(ch)).toBe(false);
    // 대표 4종(NON_CSS_WS)이 완전 집합의 부분집합인지도 확인(약화 감시).
    for (const w of Object.values(NON_CSS_WS)) expect(JS_ONLY_WS_CHARS).toContain(w);
  });

  it.each(JS_ONLY_WS_CHARS.map((w) => [hex4(w), w]))(
    '완전 집합 %s: 셀렉터(rulesFound 0)·box-shadow 값·border 값 3자리 모두 게이트가 공백으로 오정규화하지 않는다',
    (_n, w) => {
      expect(evaluatePinnedContract(`.X${w}{border:1px solid ${V}}`, '.X', { kind: 'border', token: CIB }).rulesFound ?? 0).toBe(0);
      expect(classifyRelevantDecl('box-shadow', `inset${w}0 0 0 1px ${IV}`).syntax).toBe('non-canonical');
      expect(classifyRelevantDecl('border', `1px${w}solid ${V}`).syntax).toBe('non-canonical');
    });

  // resolveColorValue — M2 승격 후 직접 테스트. 옛 `\s`/`trim()`으로 되돌리면 NBSP 케이스가 통과(RED).
  const dv = { 'color-x': '#6B7280', 'color-y': 'var(--color-x)', 'color-loop': 'var(--color-loop)' };
  it('리터럴 색(hex/rgba)은 그대로 반환', () => {
    expect(resolveColorValue('#6B7280', dv)).toBe('#6B7280');
    expect(resolveColorValue('rgba(1,2,3,0.5)', dv)).toBe('rgba(1,2,3,0.5)');
  });
  it('var(--token)은 darkValuesMap으로 재귀 해석(체인 포함)', () => {
    expect(resolveColorValue('var(--color-x)', dv)).toBe('#6B7280');
    expect(resolveColorValue('var(--color-y)', dv)).toBe('#6B7280'); // var→var→리터럴
  });
  it('var() 내부/경계의 CSS 공백은 허용(축약·trim 후 매치)', () => {
    expect(resolveColorValue('  var( --color-x ) \t', dv)).toBe('#6B7280');
  });
  it('NON_CSS_WS(NBSP/EM SPACE 등)는 var() 매치 실패 → null (옛 \\s/trim 회귀 잠금)', () => {
    expect(resolveColorValue('var( --color-x)', dv)).toBeNull();  // 여는 괄호 뒤 NBSP
    expect(resolveColorValue('var(--color-x )', dv)).toBeNull();  // 토큰 뒤 NBSP
    expect(resolveColorValue(' var(--color-x)', dv)).toBeNull();  // 값 경계 NBSP(trim 안 됨)
    expect(resolveColorValue('var(--color-x) ', dv)).toBeNull();  // 값 경계 EM SPACE
  });
  // M2(20R) — 20문자 완전 집합을 var() **앞·내부(괄호 뒤/토큰 뒤)·뒤** 위치로 매개변수화해 resolver에
  // 직접 연결한다. 이전엔 NBSP/EM SPACE 2종만 걸어 resolveColorValue의 공백 클래스를 U+1680 등으로
  // 약화해도(예: `[css-ws]`→`\s`) 이 describe가 못 잡았다 — 이제 20문자 전 위치가 null 단정이라 약화 시 RED.
  it.each(JS_ONLY_WS_CHARS.map((w) => [hex4(w), w]))(
    '완전 집합 %s: var() 앞·내부(여는 괄호 뒤/토큰 뒤)·뒤 4위치 모두 resolveColorValue가 null (resolver 연결 — 약화 시 RED)',
    (_n, w) => {
      const dvw = { 'color-x': '#6B7280' };
      expect(resolveColorValue(`${w}var(--color-x)`, dvw), 'var 앞(값 경계)').toBeNull();
      expect(resolveColorValue(`var(${w}--color-x)`, dvw), '여는 괄호 뒤(내부)').toBeNull();
      expect(resolveColorValue(`var(--color-x${w})`, dvw), '토큰 뒤(내부)').toBeNull();
      expect(resolveColorValue(`var(--color-x)${w}`, dvw), 'var 뒤(값 경계)').toBeNull();
    });
  it('대조(과잉 RED 방지): 동일 4위치의 CSS 공백 5종은 정상 해석 — 20문자 null 단정이 공허하지 않음', () => {
    const dvw = { 'color-x': '#6B7280' };
    for (const w of [' ', '\t', '\n', '\f', '\r']) {
      expect(resolveColorValue(`${w}var(--color-x)`, dvw), `앞 ${JSON.stringify(w)}`).toBe('#6B7280');
      expect(resolveColorValue(`var(${w}--color-x)`, dvw), `괄호 뒤 ${JSON.stringify(w)}`).toBe('#6B7280');
      expect(resolveColorValue(`var(--color-x${w})`, dvw), `토큰 뒤 ${JSON.stringify(w)}`).toBe('#6B7280');
      expect(resolveColorValue(`var(--color-x)${w}`, dvw), `뒤 ${JSON.stringify(w)}`).toBe('#6B7280');
    }
  });
  it('미정의 토큰·복합 표현식·null은 null(판정 불가 → 호출부 RED 유도)', () => {
    expect(resolveColorValue('var(--missing)', dv)).toBeNull();
    expect(resolveColorValue('calc(1px + 2px)', dv)).toBeNull();
    expect(resolveColorValue(null, dv)).toBeNull();
  });
  it('순환 참조는 depth 한계(>5)로 null(무한재귀 방지)', () => {
    expect(resolveColorValue('var(--color-loop)', dv)).toBeNull();
  });
});

describe('I2(18R) — canonical box-shadow를 실측 전체 문자열로 축소(과대 허용 폐쇄)', () => {
  it('허용 전체 값은 정확히 2가지 실측 문자열뿐 — 목록 고정', () => {
    expect(CANON_SHADOW_VALUES).toEqual([
      'inset 0 0 0 1px var(--color-selected-indicator)',
      'var(--shadow-xs), inset 0 0 0 1px var(--color-selected-indicator)',
    ]);
    // 이 2가지가 곧 핀 8곳 중 box-shadow 핀 2곳의 실측 값이다(아래 "도출 근거 고정" describe와 대응).
    expect(CANONICAL_DECLS.filter((e) => e.prop === 'box-shadow').map((e) => e.form)).toEqual(CANON_SHADOW_VALUES);
  });
  it('2가지 실측 문자열은 canonical + visible (무회귀)', () => {
    for (const value of CANON_SHADOW_VALUES) {
      expect(classifyRelevantDecl('box-shadow', value).syntax, value).toBe('canonical');
      expect(evalIndicatorCss(`.X{box-shadow:${value}}`, IND).visible, value).toBe(true);
    }
  });
  it.each([
    ['미정의 토큰 opaque layer(브라우저는 선언 전체 폐기)', `var(--does-not-exist), ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['다른 shadow 토큰(--shadow-md)', `var(--shadow-md), ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['다른 shadow 토큰(--shadow-lg)', `var(--shadow-lg), ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['보호 접두 밖 토큰', `var(--anything), ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['레이어 순서 반전', `${CANON_SHADOW_INDICATOR_LAYER}, ${CANON_SHADOW_OPAQUE_LAYER}`],
    ['opaque layer 중복', `${CANON_SHADOW_OPAQUE_LAYER}, ${CANON_SHADOW_OPAQUE_LAYER}, ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['indicator layer 중복', `${CANON_SHADOW_INDICATOR_LAYER}, ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['opaque layer 단독(인디케이터 소실)', CANON_SHADOW_OPAQUE_LAYER],
    ['indicator 토큰만 다름', 'inset 0 0 0 1px var(--color-border)'],
    ['spread만 다름(2px)', 'inset 0 0 0 2px var(--color-selected-indicator)'],
    ['offset만 다름(1px)', 'inset 1px 0 0 1px var(--color-selected-indicator)'],
    ['단위만 다름(0.0625rem)', 'inset 0 0 0 0.0625rem var(--color-selected-indicator)'],
    ['콤마 뒤 공백 없음', `${CANON_SHADOW_OPAQUE_LAYER},${CANON_SHADOW_INDICATOR_LAYER}`],
  ])('RED: %s', (_label, value) => {
    // 선재현: 앞 두 벡터는 현행 HEAD에서 visible=true(false-green)였다.
    expect(classifyRelevantDecl('box-shadow', value).syntax, value).toBe('non-canonical');
    expect(evalIndicatorCss(`.X{box-shadow:${value}}`, IND).visible, value).toBe(false);
  });
  it('opaque layer 자리에는 var(--shadow-xs) 정확일치만 — 일반 var(--name) 패턴은 판정에 쓰이지 않는다', () => {
    // CANON_VAR_REF_RE(needle 파서)는 var(--does-not-exist)를 여전히 매치한다 — 그러나 그 사실이
    // 선언 값 판정에 아무 영향을 주지 않는다는 것이 I2 축소의 요지다.
    expect(CANON_VAR_REF_RE.test('var(--does-not-exist)')).toBe(true);
    expect(classifyRelevantDecl('box-shadow', `var(--does-not-exist), ${CANON_SHADOW_INDICATOR_LAYER}`).syntax)
      .toBe('non-canonical');
  });
});

describe('I3(18R) — 벤더 프리픽스 relevant 선언은 전부 non-canonical(이름 비대칭 폐쇄)', () => {
  // 선재현: `-webkit-box-shadow: initial !important`·`-webkit-box-shadow: unset`이 인디케이터 핀에서
  // visible=true였다 — CSS-wide로 인정된 뒤 `prop === 'box-shadow'`에 미매치해 **border 셀**을 초기화하고
  // shadow 셀은 손대지 않았기 때문(relevance는 deprefix, evaluator는 raw 이름 = 비대칭).
  it.each([
    ['-webkit-box-shadow', 'initial'],
    ['-webkit-box-shadow', 'unset'],
    ['-webkit-box-shadow', 'inherit'],
    ['-webkit-box-shadow', 'none'],
    ['-moz-box-shadow', 'initial'],
    ['-moz-border-image', 'initial'],
    ['-webkit-border-image', 'unset'],
    ['-o-border-width', 'initial'],
    ['-ms-border-color', 'unset'],
    ['-webkit-box-shadow', 'inset 0 0 0 1px var(--color-selected-indicator)'], // 값이 canonical이어도 RED
    ['-webkit-border-image', 'url(a.png)'],
  ])('%s: %s 는 non-canonical', (prop, value) => {
    const cls = classifyRelevantDecl(prop, value);
    expect(cls).toEqual({ syntax: 'non-canonical', prop, value: normalizeDeclValue(value) });
  });

  it('인디케이터 핀: -webkit-box-shadow의 CSS-wide 리셋은 이제 RED (선재현 visible=true)', () => {
    for (const decl of ['-webkit-box-shadow:initial !important', '-webkit-box-shadow:unset', '-moz-border-image:initial']) {
      const res = evalIndicatorCss(`.X{box-shadow:${CANON_SHADOW_INDICATOR_LAYER};${decl}}`, IND);
      expect(res.visible, decl).toBe(false);
      expect(res.nonCanonical.length, decl).toBeGreaterThan(0); // border 셀 초기화 부작용이 아니라 canonical 위반으로 RED
    }
  });

  it('border 핀도 동일 — RED의 이유가 nonCanonical이다(부작용 경유 아님)', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V};-moz-border-image:initial}`, CIB);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/-moz-border-image: initial/);
    expect(res.border).toEqual({ width: 1, style: 'solid', token: CIB }); // 부작용 없음(셀 그대로)
  });

  it('수집(relevance)은 계속 deprefix한다 — 수집 누락(층 1 무력화)과 판정 거부는 별개 계약', () => {
    expect(isRelevantProp('-webkit-box-shadow')).toBe(true);
    expect(isRelevantProp('-moz-border-image')).toBe(true);
    expect(isRelevantProp('-ms-border-radius')).toBe(false);
    expect(isRelevantProp('--webkit-color-x')).toBe(false); // 커스텀 프로퍼티는 deprefix 무영향
  });

  it('프리픽스 없는 실핀 형태는 무회귀 GREEN', () => {
    expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_INDICATOR_LAYER).syntax).toBe('canonical');
    expect(classifyRelevantDecl('border', `1px solid ${V}`).syntax).toBe('canonical');
  });
});

describe('I4(18R) — @property 등록 스윕(inventory 누락 폐쇄)', () => {
  const AT = (name) => `@property ${name} { syntax: "<color>"; inherits: false; initial-value: transparent; }`;
  it.each([
    ['--color-input-border'],
    ['--color-selected-indicator'],
    ['--shadow-xs'],
    ['--track-x'],
  ])('보호 접두 등록 %s 는 offender (선재현: offenders 0)', (name) => {
    const offenders = findProtectedDeclarations(AT(name));
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatch(/@property/);
  });
  it('at-rule 이름 대문자 변형(@PROPERTY)도 동일하게 검출 — I3식 이름 비대칭 재발 방지', () => {
    expect(findProtectedDeclarations('@PROPERTY --color-x{syntax:"*";inherits:false}')).toHaveLength(1);
  });
  it('at-rule 이름 escape(@\\70 roperty)는 postcss가 파싱 거부 — P4 스윕이 offender로 표면화(fail-closed)', () => {
    // 디코더를 통과시켜도 도달할 수 없는 경로다: postcss.parse가 "At-rule without name"으로 throw한다.
    // 침묵 스킵이 아니라 sweepFileForProtectedDeclarations의 try/catch가 offender로 올려 RED가 된다.
    expect(() => findProtectedDeclarations('@\\70 roperty --color-x{syntax:"*";inherits:false}')).toThrow();
  });
  it('등록 이름 자체가 escape돼도 디코딩 후 검출', () => {
    expect(findProtectedDeclarations('@property \\--color-x{syntax:"*";inherits:false}')).toHaveLength(1);
    expect(findProtectedDeclarations('@property --\\63 olor-x{syntax:"*";inherits:false}')).toHaveLength(1);
  });
  it('@media 등으로 감싸도 walkAtRules 전수 방문으로 검출', () => {
    expect(findProtectedDeclarations(`@media (min-width:0){${AT('--color-x')}}`)).toHaveLength(1);
  });
  it('보호 접두 밖 이름(--brand-x)·대문자(--Color-x)는 미검출(오검출 방지)', () => {
    expect(findProtectedDeclarations(AT('--brand-x'))).toEqual([]);
    expect(findProtectedDeclarations(AT('--Color-x'))).toEqual([]);
  });
  it('다른 at-rule(@supports/@font-face)은 대상 아님', () => {
    expect(findProtectedDeclarations('@supports (display:block){.Foo{color:red}}')).toEqual([]);
    expect(findProtectedDeclarations('@font-face{font-family:X;src:url(a.woff2)}')).toEqual([]);
  });
  it('structuralGate도 @property 등록을 3블록 계약 위반으로 throw', () => {
    const cssText = `:root{--color-a:1}html[data-theme='dark']{--color-a:2}:root{--color-b:3}${AT('--color-input-border')}`;
    expect(() => structuralGate(cssText)).toThrow(/보호 토큰|3블록/);
  });
  it('P4 스윕 경로(sweepFileForProtectedDeclarations 판정 로직)와 동일 함수를 공유한다', () => {
    // findProtectedDeclarations가 단일 판정 지점이므로 styles/ 전체 스윕도 자동으로 @property를 본다.
    expect(findProtectedDeclarations(AT('--color-x')).length).toBeGreaterThan(0);
  });
  it('실 레포 styles/ 전체에 보호 접두 @property 등록이 없다(현행 0건 고정)', () => {
    const stylesDir = resolve(__dirname, '../styles');
    const offenders = readdirSync(stylesDir, { recursive: true }).map(String)
      .filter(isProtectedSweepTarget)
      .flatMap((f) => {
        try { return findProtectedPropertyRegistrations(postcss.parse(siteCssText(f))).map((o) => `${f}: ${o}`); }
        catch (e) { return [`${f}: 파싱 실패 — ${String((e && e.message) || e).split('\n')[0]}`]; }
      });
    expect(offenders).toEqual([]);
  });
});

describe('M1(18R) — classifyRelevantDecl이 CANONICAL_DECLS를 직접 dispatch한다(단일 정본 증명)', () => {
  // 이전 classifier는 배열을 조회하지 않고 별도 regex(CANON_BORDER_RE 등)를 썼다 — entry의 prop/re를
  // 훼손해도 판정이 그대로여서 "CANONICAL_DECLS가 정본"이라는 주석이 사실이 아니었다. 아래 mutation이
  // 판정 결과를 실제로 바꾼다는 것이 단일화의 증거다(mutation 후 반드시 원복).
  const withMutated = (id, patch, fn) => {
    const entry = CANONICAL_DECLS.find((e) => e.id === id);
    const backup = { ...entry };
    try { Object.assign(entry, patch); fn(); } finally { Object.assign(entry, backup); }
  };
  it('canonical 결과에 판정한 entry.id가 실려 나온다(추적 가능성)', () => {
    expect(classifyRelevantDecl('border', `1px solid ${V}`).id).toBe('border-shorthand');
    expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_VALUES[0]).id).toBe('box-shadow-indicator-only');
    expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_VALUES[1]).id).toBe('box-shadow-opaque-then-indicator');
  });
  it('entry.re 훼손 → border 판정이 canonical에서 non-canonical로 바뀐다', () => {
    expect(classifyRelevantDecl('border', `1px solid ${V}`).syntax).toBe('canonical');
    withMutated('border-shorthand', { re: /^__never__$/ }, () => {
      expect(classifyRelevantDecl('border', `1px solid ${V}`).syntax).toBe('non-canonical');
      expect(evalBorderCss(`.X{border:1px solid ${V}}`, CIB).visible).toBe(false);
    });
    expect(classifyRelevantDecl('border', `1px solid ${V}`).syntax).toBe('canonical'); // 원복 확인
  });
  it('entry.prop 훼손 → 같은 값이 더 이상 box-shadow에서 매치되지 않는다', () => {
    withMutated('box-shadow-indicator-only', { prop: '__never__' }, () => {
      expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_VALUES[0]).syntax).toBe('non-canonical');
    });
    expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_VALUES[0]).syntax).toBe('canonical');
  });
  it('entry.build 훼손 → 층 2 가시성 계산 입력(모델)이 바뀌어 GREEN이 무너진다', () => {
    withMutated('box-shadow-indicator-only', { build: () => ({ form: 'box-shadow', layers: [] }) }, () => {
      expect(evalIndicatorCss(`.X{box-shadow:${CANON_SHADOW_VALUES[0]}}`, IND).visible).toBe(false);
    });
    expect(evalIndicatorCss(`.X{box-shadow:${CANON_SHADOW_VALUES[0]}}`, IND).visible).toBe(true);
  });
  it('배열 항목 수·prop 커버리지 고정 — 근거 없는 확장 금지', () => {
    expect(CANONICAL_DECLS.map((e) => e.id)).toEqual([
      'border-shorthand', 'box-shadow-indicator-only', 'box-shadow-opaque-then-indicator',
    ]);
    expect([...new Set(CANONICAL_DECLS.map((e) => e.prop))]).toEqual(['border', 'box-shadow']);
    for (const e of CANONICAL_DECLS) expect(typeof e.build, e.id).toBe('function');
  });
});

describe('S4 cssColorLiterals', () => {
  it.each([
    ['url("a#fff")', []], ['url(data:image/svg+xml,%23fff)', []], ["'#fff'", []],
    ['0 0 0 1px rgba(0,0,0,0.12), 0 1px 2px #ABC', ['rgba(0,0,0,0.12)', '#ABC']],
    ['#5E6AD2F', ['#5E6AD2F']], ['foo#fffbar', []],
  ])('extract %s', (input, out) => expect(EV.extractColorLiterals(input)).toEqual(out));
});
describe('S4 normColor / resolveLight', () => {
  it.each([['#fff', '#ffffff'], ['#FFFFFF', '#ffffff'], ['rgba(28, 28, 28, 0.32)', 'rgba(28,28,28,0.32)'], ['#ABCD', '#aabbccdd']])
    ('norm %s', (a, b) => expect(EV.normColor(a)).toBe(b));
  it('resolve direct', () => expect(EV.resolveLight('--x', { '--x': '#E5E5E5' })).toBe('#E5E5E5'));
  it('resolve alias chain', () => expect(EV.resolveLight('--a', { '--a': 'var(--b)', '--b': 'var(--c)', '--c': '#6B7280' })).toBe('#6B7280'));
});
describe('S4 projectSource', () => {
  const src = ['a { color: #FFFFFF; }', 'b { border: 1px solid $track-border; }', 'c { background: rgba(94,106,210,0.1); }'].join('\n');
  const one = (o) => EV.projectSource(src, [o], [], '', 'T');
  it('lit', () => expect(one({ id: 'x', f: 'T', l: 1, k: 'lit', from: '#FFFFFF', to: 'var(--track-card)' }).projected).toContain('var(--track-card)'));
  it('txt', () => expect(one({ id: 'x', f: 'T', l: 2, k: 'txt', from: '$track-border', to: '$color-input-border' }).projected).toContain('$color-input-border'));
  it('tint alpha 보존', () => expect(one({ id: 'x', f: 'T', l: 3, k: 'tint', from: '94,106,210', to: 'color-mix(in srgb, var(--color-primary) {P}%, transparent)' }).projected).toContain('10%'));
  it('DUP_LINE', () => expect(EV.projectSource(src, [{ id: 'a', f: 'T', l: 1, k: 'lit', from: '#FFFFFF', to: 'x' }, { id: 'b', f: 'T', l: 1, k: 'lit', from: '#FFFFFF', to: 'y' }], [], '', 'T').errors.join()).toMatch(/DUP_LINE/));
  it('LIT_MATCH', () => expect(one({ id: 'x', f: 'T', l: 1, k: 'lit', from: '#000000', to: 'y' }).errors.join()).toMatch(/LIT_MATCH/));
  it('annotation 파일 필터', () => expect(EV.projectSource(src, [], [{ f: 'X', l: 1, marker: '[m]', anchor: 'color', text: '// [m]' }], '', 'T').projected).not.toContain('[m]'));
});
describe('S4 validateAnnotations', () => {
  const pre = ['a { color: #FFFFFF; }', 'a { color: #FFFFFF; }'].join('\n');   // 완전히 동일한 anchor 2줄
  const ann = [{ f: 'T', l: 2, marker: '[S4:T2]', anchor: '#FFFFFF', text: '// [S4:T2] note' }];
  const files = { T: { rel: 't' }, X: { rel: 'x' } };
  const ok = ['a { color: #FFFFFF; }', '// [S4:T2] note', 'a { color: #FFFFFF; }'].join('\n');
  const moved = ['// [S4:T2] note', 'a { color: #FFFFFF; }', 'a { color: #FFFFFF; }'].join('\n');  // 동일 anchor 이동
  it('정상 GREEN', () => expect(EV.validateAnnotations({ T: ok, X: '' }, { T: pre, X: '' }, ann, files)).toEqual([]));
  it('동일 anchor 이동 RED', () => expect(EV.validateAnnotations({ T: moved, X: '' }, { T: pre, X: '' }, ann, files).join()).toMatch(/ANN_OCCURRENCE/));
  it('타 파일 FOREIGN', () => expect(EV.validateAnnotations({ T: ok, X: '// [S4:T2] note' }, { T: pre, X: '' }, ann, files).join()).toMatch(/ANN_FOREIGN/));
  it('marker 중복', () => expect(EV.validateAnnotations({ T: ok, X: '' }, { T: pre, X: '' }, [...ann, ...ann], files).join()).toMatch(/ANN_MARKER_DUP/));
  it('개수 0 RED', () => expect(EV.validateAnnotations({ T: pre, X: '' }, { T: pre, X: '' }, ann, files).join()).toMatch(/ANN_COUNT/));
  it('text 변조 RED', () => expect(EV.validateAnnotations({ T: ok.replace('note', 'x'), X: '' }, { T: pre, X: '' }, ann, files).join()).toMatch(/ANN_TEXT|ANN_COUNT/));
});
describe('S4 dark structure', () => {
  const mk = (selector, extra = {}) => ({ file: 't', selector, property: 'color', declarationOccurrence: 0, atRules: [], important: false, value: 'red', ...extra });
  it('suffix 정상', () => expect(EV.validateDarkStructure([mk('.a'), mk(EV.DARK_PREFIX + ' .b')], ['t'], { t: 1 })).toEqual([]));
  it('darkish RED', () => expect(EV.validateDarkStructure([mk('.a'), mk('html[data-theme=darkish] .b')], ['t'], { t: 1 }).join()).toMatch(/DARK_FOREIGN_SELECTOR|DARK_COUNT/));
  it('comma branch prefix 제거 RED', () => expect(EV.validateDarkStructure([mk('.a'), mk(EV.DARK_PREFIX + ' .b, .c')], ['t'], { t: 1 }).join()).toMatch(/DARK_FOREIGN_SELECTOR/));
  it('count 불일치 RED', () => expect(EV.validateDarkStructure([mk('.a')], ['t'], { t: 1 }).join()).toMatch(/DARK_COUNT/));
  it('!important RED', () => expect(EV.validateDarkStructure([mk('.a'), mk(EV.DARK_PREFIX + ' .b', { important: true })], ['t'], { t: 1 }).join()).toMatch(/DARK_IMPORTANT/));
  it('@media RED', () => expect(EV.validateDarkStructure([mk('.a'), mk(EV.DARK_PREFIX + ' .b', { atRules: ['@media x'] })], ['t'], { t: 1 }).join()).toMatch(/DARK_ATRULE/));
});
describe('S4 contrast', () => {
  it.each([['#FFFFFF', 255], ['#fff', 255], ['#12345', null], ['#1234567', null]])('parse %s', (h, r) => {
    const c = EV.parseColorLiteral(h); expect(c === null ? null : c.r).toBe(r); });
  it('composite', () => expect(EV.compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 }).r).toBeCloseTo(127.5));
  it('ratio 흑백 21', () => expect(EV.contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 1));
  it('gradient worst-case', () => expect(EV.evaluateContrastCases([{ name: 'g', text: '--fg', min: 1, stack: [{ gradient: ['--a', '--b'] }] }],
    { '--fg': '#FFFFFF', '--a': '#000000', '--b': '#FFFFFF' }).results[0].ratio).toBeCloseTo(1, 1));
  it('실패 케이스', () => expect(EV.evaluateContrastCases([{ name: 'f', text: '--fg', min: 4.5, stack: [{ token: '--bg' }] }],
    { '--fg': '#777777', '--bg': '#888888' }).errors.join()).toMatch(/CONTRAST_FAIL/));
  it('mix 레이어', () => expect(EV.evaluateContrastCases([{ name: 'm', text: '--fg', min: 1, stack: [{ token: '--bg' }, { mix: '--ink', pct: 50 }] }],
    { '--fg': '#FFFFFF', '--bg': '#000000', '--ink': '#FFFFFF' }).results[0].ratio).toBeGreaterThan(1));
});
describe('S4 atoms / coverage / counts / fingerprint / canonicalize', () => {
  it('중첩 --blocked atom 포함', () => expect(EV.atomsFromSelectors([{ selector: '.TrackTimeline__Bar--blocked' }]).has('TrackTimeline__Bar--blocked')).toBe(true));
  it('축약 atom miss', () => expect(EV.atomsFromSelectors([{ selector: '.TrackHeader__ViewBtn--active' }]).has('TrackHeader__ViewBtn--activ')).toBe(false));
  it('coverage 정상', () => expect(EV.validateSmokeCoverage({ new: [], changed: [] }, [{ name: 'a', actions: [], requiredElements: [], coverageSelectors: [], darkReviewSelectors: [] }])).toEqual([]));
  it('mask로는 해소 불가', () => expect(EV.validateSmokeCoverage({ new: [{ selector: EV.DARK_PREFIX + ' .Zz' }], changed: [] },
    [{ name: 'a', actions: [], requiredElements: [], coverageSelectors: [], darkReviewSelectors: ['.Zz'] }]).join()).toMatch(/SMOKE_UNMAPPED/));
  it('observed로 해소', () => expect(EV.validateSmokeCoverage({ new: [{ selector: EV.DARK_PREFIX + ' .Zz' }], changed: [] },
    [{ name: 'a', actions: [], requiredElements: [], coverageSelectors: [{ selector: '.Zz' }], darkReviewSelectors: [] }])).toEqual([]));
  it('state 미증명 RED', () => expect(EV.validateSmokeCoverage({ new: [], changed: [] },
    [{ name: 'a', actions: [], requiredElements: [], coverageSelectors: [{ selector: '.b', state: 'hover' }], darkReviewSelectors: [] }]).join()).toMatch(/SURFACE_STATE_UNPROVEN/));
  it('surface 이름 중복 RED', () => expect(EV.validateSmokeCoverage({ new: [], changed: [] },
    [{ name: 'a', actions: [], requiredElements: [], coverageSelectors: [], darkReviewSelectors: [] }, { name: 'a', actions: [], requiredElements: [], coverageSelectors: [], darkReviewSelectors: [] }]).join()).toMatch(/SURFACE_NAME_DUP/));
  it('counts 불일치', () => expect(EV.validateCounts({ counts: { conversions: 1 }, changed: [] }, { conversions: 2 }).join()).toMatch(/conversions/));
  it('allowId 누락', () => expect(EV.validateCounts({ counts: { conversions: 1, changed: 0, new: 0, newRules: 0, residual: 0, raw: 0, processed: 0, allowBearing: 0 },
    changed: [] }, { conversions: 1, changedDecls: 0, newDecls: 0, newRules: 0, residual: 0, rawLiterals: 0, processedLiterals: 0, allowIds: 1 }).join()).toMatch(/allowId/));
  it('fingerprint BASE 민감', () => expect(EV.specFingerprint(SPEC, sha256)).not.toBe(EV.specFingerprint({ ...SPEC, BASE: 'zzz' }, sha256)));
  it('fingerprint surfaces 민감', () => expect(EV.specFingerprint(SPEC, sha256)).not.toBe(
    EV.specFingerprint({ ...SPEC, REQUIRED_SMOKE_SURFACES: SPEC.REQUIRED_SMOKE_SURFACES.slice(1) }, sha256)));
  it('canonicalize 순서 보존', () => expect(JSON.stringify(CANON.canonicalize([{ b: 1, a: 2 }, { a: 3 }]))).toBe('[{"a":2,"b":1},{"a":3}]'));
  it('배열 순서 변화 = 다른 해시', () => expect(CANON.bundleString([{ url: '/x', body: [1, 2] }])).not.toBe(CANON.bundleString([{ url: '/x', body: [2, 1] }])));
});
describe('S4 action resolver', () => {
  // 실제 구조의 대표 context — 러너가 쓰는 것과 같은 shape
  const CTX = { trackId: 42, normalItemTitle: 'Synthetic Item A', branchName: 'SB', epicName: 'SE',
    addMenuEpicLabel: 'Epic', scrumBoardId: 7, scrumInactivePreset: '#DC2626',
    settingsPreset: { editBranchIndex: 0, inactivePresetValue: '#16A34A' } };
  it('23 surface 전 액션이 미해결 0으로 치환', () => {
    const flat = EV.buildActionContext(CTX);
    const all = SPEC.REQUIRED_SMOKE_SURFACES.flatMap((s2) => EV.resolveActions(s2.actions, flat).errors);
    expect(all).toEqual([]);
  });
  it('치환 후 모든 nth가 0 이상 정수', () => {
    const flat = EV.buildActionContext(CTX);
    for (const s2 of SPEC.REQUIRED_SMOKE_SURFACES)
      for (const a of EV.resolveActions(s2.actions, flat).resolved)
        if (a.nth !== undefined) { expect(Number.isInteger(a.nth)).toBe(true); expect(a.nth).toBeGreaterThanOrEqual(0); }
  });
  it('치환 후 문자열 필드에 {...} 잔존 0', () => {
    const flat = EV.buildActionContext(CTX);
    for (const s2 of SPEC.REQUIRED_SMOKE_SURFACES)
      for (const a of EV.resolveActions(s2.actions, flat).resolved)
        for (const f of ['url', 'selector', 'hasText', 'key', 'value'])
          if (typeof a[f] === 'string') expect(a[f]).not.toMatch(/\{[A-Za-z0-9_]+\}/);
  });
  it('두 번째 branch(editBranchIndex=1)도 정상 치환', () => {
    const flat = EV.buildActionContext({ ...CTX, settingsPreset: { ...CTX.settingsPreset, editBranchIndex: 1 } });
    const st = SPEC.REQUIRED_SMOKE_SURFACES.find((x) => x.name === 'settings-branches-edit');
    const { resolved, errors } = EV.resolveActions(st.actions, flat);
    expect(errors).toEqual([]);
    const edit = resolved.find((a) => a.op === 'click' && a.selector.includes('IconBtn'));
    expect(edit.selector).toContain("title='Edit display name / color'");   // Remove 버튼과 섞이지 않는다
    expect(edit.nth).toBe(1);
    const sw = resolved.find((a) => a.op === 'click' && a.selector.includes('Swatch'));
    expect(sw.selector).toBe(".SettingsBranches__Swatch[aria-label='#16A34A']");
    expect(sw.nth).toBeUndefined();                                          // 순번이 아니라 값으로 지정
  });
  it('nested key 누락 → UNRESOLVED', () => {
    const bad = { ...CTX, settingsPreset: undefined };
    const errs = SPEC.REQUIRED_SMOKE_SURFACES.flatMap((s2) => EV.resolveActions(s2.actions, EV.buildActionContext(bad)).errors);
    expect(errs.join()).toMatch(/UNRESOLVED_PLACEHOLDER/);
  });
  it('nth placeholder 미해결 → UNRESOLVED(이전 false-green)', () => expect(
    EV.resolveActions([{ op: 'click', selector: '.X', nth: '{someMissingKey}' }], {}).errors.join()).toMatch(/UNRESOLVED_PLACEHOLDER/));
  it('nth 음수 → INVALID_NTH', () => expect(
    EV.resolveActions([{ op: 'click', selector: '.X', nth: '-1' }], {}).errors.join()).toMatch(/INVALID_NTH/));
  it('nth 소수 → INVALID_NTH', () => expect(
    EV.resolveActions([{ op: 'click', selector: '.X', nth: '1.5' }], {}).errors.join()).toMatch(/INVALID_NTH/));
});
describe('S4 privacy audit', () => {
  const NAMES = SPEC.REQUIRED_SMOKE_SURFACES.map((x) => x.captureName);
  const h = (i) => String(i).padStart(64, '0');
  const EXP = { captures: NAMES.map((c, i) => ({ captureName: c, sha256: h(i) })), contextSubjectSha256: h(99) };
  const ok = () => ({ scope: 'dedicated-synthetic-account-workspace', contextPass: true,
    contextSubjectSha256: h(99),
    captures: NAMES.map((c, i) => ({ captureName: c, sha256: h(i), pass: true, findings: [] })) });
  it('정상 → []', () => expect(EV.validatePrivacyAudit(ok(), EXP)).toEqual([]));
  it('누락', () => expect(EV.validatePrivacyAudit(undefined, EXP).join()).toMatch(/PRIVACY_AUDIT_MISSING/));
  it('scope 불일치', () => { const a = ok(); a.scope = 'single-track';
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_SCOPE/); });
  it('contextPass false', () => { const a = ok(); a.contextPass = false;
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_CONTEXT_FAIL/); });
  it('captures 타입 오류', () => { const a = ok(); a.captures = 'x';
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_CAPTURES_TYPE/); });
  it('22건(개수 부족)', () => { const a = ok(); a.captures.pop();
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_CAPTURE_COUNT|PRIVACY_AUDIT_CAPTURE_SET/); });
  it('중복 captureName', () => { const a = ok(); a.captures[1].captureName = a.captures[0].captureName;
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_CAPTURE_DUP/); });
  it('pass false', () => { const a = ok(); a.captures[2].pass = false;
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_FAIL/); });
  it('pass true + findings 존재(모순)', () => { const a = ok(); a.captures[3].findings = ['실사용자 이름 노출'];
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_FINDINGS_NONEMPTY/); });
  it('findings 누락·타입 오류', () => { const a = ok(); delete a.captures[4].findings; a.captures[5].findings = [1];
    const e = EV.validatePrivacyAudit(a, EXP).join();
    expect(e).toMatch(/PRIVACY_AUDIT_FINDINGS_TYPE/); expect(e).toMatch(/PRIVACY_AUDIT_FINDINGS_ITEM/); });
  // ── 감사 대상 바이트 결속(검수 Important)
  it('감사 후 PNG 교체 → SUBJECT_DRIFT', () => { const a = ok();
    const exp2 = { ...EXP, captures: EXP.captures.map((c, i) => (i === 6 ? { ...c, sha256: h(777) } : c)) };
    expect(EV.validatePrivacyAudit(a, exp2).join()).toMatch(/PRIVACY_AUDIT_SUBJECT_DRIFT/); });
  it('감사 후 context 필드 변경 → CONTEXT_SUBJECT_DRIFT', () =>
    expect(EV.validatePrivacyAudit(ok(), { ...EXP, contextSubjectSha256: h(1234) }).join())
      .toMatch(/PRIVACY_AUDIT_CONTEXT_SUBJECT_DRIFT/));
  it('capture sha 누락 → SUBJECT_DRIFT', () => { const a = ok(); delete a.captures[7].sha256;
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_SUBJECT_DRIFT/); });
});
describe('S4 smoke manifest', () => {
  it('surface 수 고정', () => expect(SPEC.REQUIRED_SMOKE_SURFACES.length).toBe(23));
  it('이름 exact manifest', () => expect(SPEC.REQUIRED_SMOKE_SURFACES.map((s) => s.name)).toEqual(SURFACE_NAMES));
  it('schema 필수 필드', () => SPEC.REQUIRED_SMOKE_SURFACES.forEach((s) => {
    expect(Array.isArray(s.actions)).toBe(true); expect(Array.isArray(s.coverageSelectors)).toBe(true);
    expect(Array.isArray(s.darkReviewSelectors)).toBe(true); expect(Array.isArray(s.requiredElements)).toBe(true);
    expect(typeof s.captureName).toBe('string'); }));
  it('상태 의존은 provenBy 보유', () => SPEC.REQUIRED_SMOKE_SURFACES.forEach((s) => s.coverageSelectors
    .filter((o) => o.state).forEach((o) => expect(s.actions[o.provenBy]).toBeDefined())));
});

describe('S4 pixel diff', () => {
  const mk = (w, h, fill) => { const p = new PNG({ width: w, height: h });
    for (let i = 0; i < p.data.length; i += 4) { p.data[i] = fill[0]; p.data[i+1] = fill[1]; p.data[i+2] = fill[2]; p.data[i+3] = 255; }
    return PNG.sync.write(p); };
  const withPixel = (w, h, fill, x, y, c) => { const p = PNG.sync.read(mk(w, h, fill));
    const i = (w * y + x) << 2; p.data[i] = c[0]; p.data[i+1] = c[1]; p.data[i+2] = c[2]; return PNG.sync.write(p); };
  it('동일 이미지 → diff 0', () => expect(PIX.diffPng(mk(8, 8, [255,255,255]), mk(8, 8, [255,255,255]), []).diff).toBe(0));
  it('1픽셀 차이 → diff 1', () => expect(PIX.diffPng(mk(8, 8, [255,255,255]), withPixel(8, 8, [255,255,255], 3, 3, [0,0,0]), []).diff).toBe(1));
  it('그 픽셀을 덮는 rect → diff 0', () => expect(PIX.diffPng(mk(8, 8, [255,255,255]),
    withPixel(8, 8, [255,255,255], 3, 3, [0,0,0]), [{ x: 2, y: 2, width: 3, height: 3 }]).diff).toBe(0));
  it('크기 불일치 → ok:false SIZE', () => { const r = PIX.diffPng(mk(8, 8, [255,255,255]), mk(9, 8, [255,255,255]), []);
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/SIZE/); });
});

// Task 2 Step 5가 출력한 sha256으로 이 값을 채운다(그 커밋 diff에 값이 드러나야 한다)
const S4_EXPECTED_SHA256 = '7dcb3ef6fb5d040f594e9d43872384545467fb199510a733ad4733524f132213';
describe('S4 fixture 동결', () => {
  it('상수가 64자리 hex이고 미교체 placeholder가 아님', () => {
    expect(S4_EXPECTED_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(S4_EXPECTED_SHA256).not.toBe('0'.repeat(64));
  });
  it('fixture 해시가 상수와 일치', () => {
    const raw = readFileSync(new URL('./__fixtures__/s4-expected.json', import.meta.url));
    expect(createHash('sha256').update(raw).digest('hex')).toBe(S4_EXPECTED_SHA256);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 마스크 계약 — allow 선언 → 마스크 정본 → 브라우저 좌표 → pixel diff 소비까지.
// 이전 판에서는 이 사슬의 각 고리가 서로를 검사하지 않아 (a) live allow #6의 마스크 누락
// (b) spec 밖 selector가 context에 유입 (c) border rect를 paint rect로 오인 (d) no-op validator
// 주입 (e) unknown surface 빈 비교가 전부 GREEN이었다. 아래는 그 폐쇄를 고정한다.
// ─────────────────────────────────────────────────────────────────────────────
// occurrence 생성기. **변환 전 border-box(bw, bh)를 받아 rect를 파생**한다 — rect를 직접 받으면
// width와 borderBox가 서로 무관해져서 두 파생 교차검증이 GREEN 대조군에서부터 깨진다.
// computed paint 문자열도 함께 붙인다(outset이 여기서 파생되므로 없으면 검증 자체가 불가능).
const S4_PAINT = {
  plain: { boxShadow: 'none', outlineStyle: 'none', outlineWidth: '0px', outlineOffset: '0px', filter: 'none' },
  ring: { boxShadow: 'rgb(0, 0, 0) 0px 0px 0px 3px', outlineStyle: 'none', outlineWidth: '0px', outlineOffset: '0px', filter: 'none' },
};
const S4_MK = (x, y, bw, bh, scale, outset, paint = S4_PAINT.plain) => {
  const width = bw * scale, height = bh * scale, d = outset * scale;
  return { x, y, width, height, borderBoxWidth: bw, borderBoxHeight: bh,
    transformScaleX: scale, transformScaleY: scale, scale, ...paint,
    paintRect: { x: x - d, y: y - d, width: width + 2 * d, height: height + 2 * d } };
};

// ── 단위 mutation 전용 독립 정본 ────────────────────────────────────────────
// 프로덕션 SPEC/fixture에서 파생하지 않는다. 파생하면 spec 자체의 좌표·property 오류가
// "정답"으로 함께 이동해 self-oracle이 된다(리뷰 지적). ID를 1,4로 비연속으로 둬서
// 연속 번호 가정(1..N)이 다시 들어오면 즉시 드러나게 한다.
// ── dataset 계약용 합성 world ───────────────────────────────────────────────
// **production manifest를 복사하지 않는다.** 복사 후 surfaceCount만 바꾸는 방식은
// (a) 계약 검사를 production 형태에 묶고 (b) 검사 대상 값으로 기대값을 만들어 자기증명이 된다.
//
// 손으로 적은 산술: n = surface 수
//   branches 1/1 · epics 1/1 · chat n/(n+1) · unread-count n/n · tracks/{trackId} 1/1
//   ambient notif-list 1/1 · dev pages-manifest n/n
//   backendUniqueUrl = 5 + 1 = 6
//   backendTuple     = 1+1+n+n+1 + 1 = 2n+4
//   semanticTuple    = (2n+4) + n     = 3n+4
// 각 category는 urlTemplate lexical order. branches/epics를 넣는 이유는 신원 대조 응답이
// dataset endpoint 집합과 **같은 원천**에서 나와야 하기 때문이다(production도 그렇다).
const dsManifest = (n) => ({
  schemaVersion: 1,
  evidence: {
    observedHead: '1'.repeat(40), observedSpecFingerprint: '2'.repeat(64),
    discoveryDigest: '3'.repeat(64),
    files: Object.fromEntries(EV.DISCOVERY_EVIDENCE_FILES.map((n, i) => [n, String(i).repeat(64).slice(0, 64)])),
    surfaceCount: n, semanticTupleCount: 3 * n + 4, backendTupleCount: 2 * n + 4, backendUniqueUrlCount: 6,
  },
  dataset: [
    { method: 'GET', urlTemplate: '{apiOrigin}/branches', reason: '브랜치 이름·색', observedSurfaceCount: 1, observedRequestCount: 1 },
    { method: 'GET', urlTemplate: '{apiOrigin}/branches/{bulkBranchId}/epics', reason: '에픽 목록', observedSurfaceCount: 1, observedRequestCount: 1 },
    { method: 'GET', urlTemplate: '{apiOrigin}/chat', reason: '헤더 채팅 뱃지', observedSurfaceCount: n, observedRequestCount: n + 1 },
    { method: 'GET', urlTemplate: '{apiOrigin}/notifications/unread-count', reason: '헤더 알림 뱃지', observedSurfaceCount: n, observedRequestCount: n },
    { method: 'GET', urlTemplate: '{apiOrigin}/tracks/{trackId}', reason: '트랙 본문', observedSurfaceCount: 1, observedRequestCount: 1 },
  ],
  ambient: [
    { method: 'GET', urlTemplate: '{apiOrigin}/notifications?limit=30', reason: '알림 목록은 픽셀에 없다', observedSurfaceCount: 1, observedRequestCount: 1 },
  ],
  dev: [
    { method: 'GET', urlTemplate: '{appOrigin}/_next/static/development/_devPagesManifest.json', reason: 'Next dev 런타임', observedSurfaceCount: n, observedRequestCount: n },
  ],
});
// 계약 테스트가 쓰는 고정 world(n=2). 생성기와 **손으로 적은 값**이 같은지는 별도 테스트가 본다.
const SYN_MANIFEST = {
  schemaVersion: 1,
  evidence: {
    observedHead: '1'.repeat(40), observedSpecFingerprint: '2'.repeat(64),
    discoveryDigest: '3'.repeat(64),
    files: Object.fromEntries(EV.DISCOVERY_EVIDENCE_FILES.map((n, i) => [n, String(i).repeat(64).slice(0, 64)])),
    surfaceCount: 2, semanticTupleCount: 10, backendTupleCount: 8, backendUniqueUrlCount: 6,
  },
  dataset: [
    { method: 'GET', urlTemplate: '{apiOrigin}/branches', reason: '브랜치 이름·색', observedSurfaceCount: 1, observedRequestCount: 1 },
    { method: 'GET', urlTemplate: '{apiOrigin}/branches/{bulkBranchId}/epics', reason: '에픽 목록', observedSurfaceCount: 1, observedRequestCount: 1 },
    { method: 'GET', urlTemplate: '{apiOrigin}/chat', reason: '헤더 채팅 뱃지', observedSurfaceCount: 2, observedRequestCount: 3 },
    { method: 'GET', urlTemplate: '{apiOrigin}/notifications/unread-count', reason: '헤더 알림 뱃지', observedSurfaceCount: 2, observedRequestCount: 2 },
    { method: 'GET', urlTemplate: '{apiOrigin}/tracks/{trackId}', reason: '트랙 본문', observedSurfaceCount: 1, observedRequestCount: 1 },
  ],
  ambient: [
    { method: 'GET', urlTemplate: '{apiOrigin}/notifications?limit=30', reason: '알림 목록은 픽셀에 없다', observedSurfaceCount: 1, observedRequestCount: 1 },
  ],
  dev: [
    { method: 'GET', urlTemplate: '{appOrigin}/_next/static/development/_devPagesManifest.json', reason: 'Next dev 런타임', observedSurfaceCount: 2, observedRequestCount: 2 },
  ],
};
const SYN_SURFACES = [
  { name: 'syn-a', captureName: 'syn-a.png', actions: [], requiredElements: [], coverageSelectors: [], darkReviewSelectors: [] },
  { name: 'syn-b', captureName: 'syn-b.png', actions: [], requiredElements: [], coverageSelectors: [], darkReviewSelectors: [] },
];
const SYN_SPEC = () => ({
  REQUIRED_SMOKE_SURFACES: SYN_SURFACES,
  SCENARIO_CANON: SPEC.SCENARIO_CANON, SCENARIO_CANON_KEYS: SPEC.SCENARIO_CANON_KEYS,
  EXPECTED_DATASET_MANIFEST: SYN_MANIFEST,
  DATASET_ENDPOINTS: SYN_MANIFEST.dataset.map((e) => e.urlTemplate),
  REVIEWED_CLASSIFICATION: reviewedOf(SYN_MANIFEST), PROVENANCE_BLOB_PATHS: SPEC.PROVENANCE_BLOB_PATHS,
  DATASET_VOLATILE_FIELDS: {}, DATASET_UNORDERED_PATHS: [],
});
const SYN_SC = () => ({ ...SPEC.SCENARIO_CANON });

// ── 무관 테스트(mask/raster/action/allow)를 위한 계약 충족 헬퍼 ──────────────
// 이 테스트들은 dataset 계약을 시험하지 않는다. 계약 검사가 전 승인 경로에 무조건 들어가므로
// **그 축을 계속 검사하려면** 계약을 만족시켜 놔야 한다. production 숫자를 흉내내지 않는다.
const reviewedOf = (man) => { const r = {};
  for (const cat of ['dataset', 'ambient', 'dev']) for (const e of man[cat]) r[e.urlTemplate] = cat;
  return r; };
const DS_SPEC = (s) => { const man = dsManifest((s.REQUIRED_SMOKE_SURFACES || []).length || 1);
  return { ...s, SCENARIO_CANON: SPEC.SCENARIO_CANON, SCENARIO_CANON_KEYS: SPEC.SCENARIO_CANON_KEYS,
    EXPECTED_DATASET_MANIFEST: man, DATASET_ENDPOINTS: man.dataset.map((e) => e.urlTemplate),
    REVIEWED_CLASSIFICATION: reviewedOf(man), PROVENANCE_BLOB_PATHS: SPEC.PROVENANCE_BLOB_PATHS,
    DATASET_VOLATILE_FIELDS: {}, DATASET_UNORDERED_PATHS: [] }; };
const DS_SC = () => ({ ...SPEC.SCENARIO_CANON });
// 실제 응답 형태를 따른다 — branches/epics는 신원 대조에 쓰이므로 진짜 필드명과 envelope를 쓴다.
const DS_RESPONSES = (n = 1) => {
  const sc = DS_SC();
  return dsManifest(n).dataset.map((t) => {
    const { url } = EV.resolveTemplate(t.urlTemplate, sc);
    let body = '{"status":true}';
    if (url === `${sc.apiOrigin}/branches`)
      body = JSON.stringify({ status: true, branches: [{ branch_id: sc.bulkBranchId, branch_name: sc.branchName }] });
    else if (url === `${sc.apiOrigin}/branches/${sc.bulkBranchId}/epics`)
      body = JSON.stringify({ status: true, epics: [{ epic_id: sc.bulkEpicId, epic_name: sc.epicName }] });
    return { url, status: 200, body };
  });
};
const DS_CTX = (c, n = 1) => {
  const responses = DS_RESPONSES(n);
  const out = { ...DS_SC(), ...c, datasetResponses: responses };
  if (out.provenance) out.provenance = { ...out.provenance,
    datasetDigest: EV.datasetDigest(responses, { DATASET_VOLATILE_FIELDS: {}, DATASET_UNORDERED_PATHS: [] }, sha256).digest };
  return out;
};

const UNIT_SPEC = DS_SPEC({
  BASE: 'unitbase',
  LIGHT_DIFF_MASKS: {
    1: { selector: '.UnitPlain', paintOutsetPx: 0 },
    4: { selector: '.UnitRing', paintOutsetPx: 3 },
  },
  // 래스터 계약은 이제 public 픽셀 비교 경로에서도 강제된다(viewport == raster == PNG 치수).
  // UNIT 세계는 200x200로 잠근다 — 1440x900 PNG를 테스트마다 만들면 5MB 버퍼가 반복된다.
  RASTER_CONTRACT: { width: 200, height: 200, dpr: 1, screenshotScale: 'css' },
  // (surface, selector)별 배율. .UnitPlain은 두 화면에 다 뜬다(모달 뒤 캔버스에 해당).
  ELEMENT_SCALES: {
    'unit-a': { '.UnitPlain': 1 },
    'unit-b': { '.UnitPlain': 1, '.UnitRing': 1.08 },
  },
  SELECTOR_SIZE_ENVELOPE: {
    '.UnitPlain': { minW: 20, maxW: 20, minH: 20, maxH: 20 },
    '.UnitRing': { minW: 20, maxW: 20, minH: 20, maxH: 20 },
  },
  // 손으로 센 값(countMaskedPixels로 만들지 않는다 — 검사 대상 함수로 기대치를 만들면 항진명제다):
  //   unit-a: .UnitPlain paintRect (100,100,20,20) -> x 100..120, y 100..120 = 20*20 = 400
  //   unit-b: .UnitPlain (150,20,20,20)  -> x 150..170, y 20..40 = 400
  //           .UnitRing  rect 21.6x21.6 @ (100,100), d = 3*1.08 = 3.24
  //                      paintRect (96.76, 96.76, 28.08, 28.08) -> floor 96 .. ceil 125(배타) = 29, 29*29 = 841
  //           두 사각형은 겹치지 않으므로 400 + 841 = 1241
  MASK_PIXEL_BUDGET: { 'unit-a': 400, 'unit-b': 1241 },
  REQUIRED_SMOKE_SURFACES: [
    { name: 'unit-a', captureName: 'unit-a.png', actions: [], requiredElements: [], coverageSelectors: [{ selector: '.UnitPlain' }], darkReviewSelectors: [] },
    { name: 'unit-b', captureName: 'unit-b.png', actions: [], requiredElements: [], coverageSelectors: [{ selector: '.UnitRing' }], darkReviewSelectors: [] },
  ],
  // evaluateConformance가 참조하는 최소 형태(내용은 단위 격리용 더미)
  FILES: { P: { rel: 'unit.scss', blob: 'x' }, R: { rel: 'unit-settings.scss', blob: 'y' } },
  DARK_DECL_COUNTS: { P: 0, R: 0 },
  COUNTS: { conversions: 2, changedDecls: 2, newDecls: 0, newRules: 0, residual: 0, rawLiterals: 0, processedLiterals: 0, allowIds: 2 },
  CONVERSIONS: [{ ident: { t: 'allow', id: 1 } }, { ident: { t: 'allow', id: 4 } }],
  ANNOTATIONS: [], OVERRIDES: {}, CONTRAST_CASES: [], CONTRAST_REFERENCE: {},
});
// ── UNIT 세계: 실제 declaration에 결속 ────────────────────────────────────
// 이전 판은 file/property를 문자열로만 분리하고 actualDecls를 비워둬서, ring의 property를
// box-shadow→background로 fixture·changed·actual map에서 함께 바꿰도 conformance가 clean이었다.
// 여기서는 선언 목록·expectedAfter·actual attribution 맵을 **각각 독립 리터럴**로 적어,
// 한 축만 어긋나면 공용 경로가 RED가 되게 한다.
const UNIT_DECLS = [
  { key: 'unit.scss||.UnitPlain|background|0', file: 'unit.scss', atRules: [], selector: '.UnitPlain',
    property: 'background', declarationOccurrence: 0, value: 'var(--u-plain)', important: false },
  { key: 'unit-settings.scss||.UnitRing|box-shadow|0', file: 'unit-settings.scss', atRules: [], selector: '.UnitRing',
    property: 'box-shadow', declarationOccurrence: 0, value: '0 0 0 3px var(--u-ring)', important: false },
];
// BASE 선언(변환 전) — before/beforeImportant 대조용 독립 리터럴
const UNIT_BASE_DECLS = [
  { key: 'unit.scss||.UnitPlain|background|0', file: 'unit.scss', atRules: [], selector: '.UnitPlain',
    property: 'background', declarationOccurrence: 0, value: '#111111', important: false },
  { key: 'unit-settings.scss||.UnitRing|box-shadow|0', file: 'unit-settings.scss', atRules: [], selector: '.UnitRing',
    property: 'box-shadow', declarationOccurrence: 0, value: '0 0 0 3px #222222', important: false },
];
// 독립 리터럴 — UNIT_DECLS에서 파생하지 않는다(파생하면 다시 self-oracle).
const UNIT_EXPECTED_AFTER = [
  { key: 'unit.scss||.UnitPlain|background|0', value: 'var(--u-plain)', important: false },
  { key: 'unit-settings.scss||.UnitRing|box-shadow|0', value: '0 0 0 3px var(--u-ring)', important: false },
];
const UNIT_ACTUAL_ALLOW_MAP = new Map([
  [1, 'unit.scss||.UnitPlain|background|0'],
  [4, 'unit-settings.scss||.UnitRing|box-shadow|0'],
]);
const U_KEY = (sel) => (sel === '.UnitPlain'
  ? 'unit.scss||.UnitPlain|background|0' : 'unit-settings.scss||.UnitRing|box-shadow|0');
const U_SHA = (n) => String(n).repeat(64).slice(0, 64);
const unitFixture = () => ({
  allowIdToKey: { 1: U_KEY('.UnitPlain'), 4: U_KEY('.UnitRing') },
  changed: [
    { key: U_KEY('.UnitPlain'), file: 'unit.scss', atRules: [], selector: '.UnitPlain', property: 'background',
      declarationOccurrence: 0, before: '#111111', after: 'var(--u-plain)',
      beforeImportant: false, afterImportant: false, evidence: ['allow'], allowIds: [1] },
    { key: U_KEY('.UnitRing'), file: 'unit-settings.scss', atRules: [], selector: '.UnitRing', property: 'box-shadow',
      declarationOccurrence: 0, before: '0 0 0 3px #222222', after: '0 0 0 3px var(--u-ring)',
      beforeImportant: false, afterImportant: false, evidence: ['allow'], allowIds: [4] },
  ],
  new: [], residual: [], expectedAfter: JSON.parse(JSON.stringify(UNIT_EXPECTED_AFTER)),
  counts: { conversions: 2, changed: 2, new: 0, newRules: 0, residual: 0, raw: 0, processed: 0, allowBearing: 2 },
  smoke: { contextSha256: U_SHA('a'), captures: [
    { captureName: 'unit-a.png', sha256: U_SHA('b') },
    { captureName: 'unit-b.png', sha256: U_SHA('c') } ] },
});
const U_OWNER = (sel) => UNIT_SPEC.REQUIRED_SMOKE_SURFACES.find((x) => x.coverageSelectors.some((o) => o.selector === sel)).name;
// full matrix: 2 surface × 2 live selector, 미발견은 []
// unit-a: .UnitPlain / unit-b: .UnitPlain(비소유 — 모달 뒤 캔버스에 해당) + .UnitRing
const unitCtx = () => DS_CTX({
  viewport: { width: 200, height: 200 },                       // RASTER_CONTRACT와 일치해야 한다
  capture: { type: 'png', scale: 'css', dpr: 1 },              // 캡처 조건도 계약 대상이다
  baseLightMaskRects: {
    'unit-a': { '.UnitPlain': [S4_MK(100, 100, 20, 20, 1, 0, S4_PAINT.plain)], '.UnitRing': [] },
    'unit-b': { '.UnitPlain': [S4_MK(150, 20, 20, 20, 1, 0, S4_PAINT.plain)],
      '.UnitRing': [S4_MK(100, 100, 20, 20, 1.08, 3, S4_PAINT.ring)] },
  },
}, 2);
// 재측정 결과 = 동결값에서 paintRect만 뺀 것(paintRect는 관측물이 아니라 파생물이다)
const unitObs = (ctx, surf) => Object.fromEntries(Object.values(UNIT_SPEC.LIGHT_DIFF_MASKS).map((m) => {
  const rects = (ctx.baseLightMaskRects[surf] || {})[m.selector] || [];
  return [m.selector, rects.map(({ paintRect, ...r }) => r)];
}));
const U_RING = '.UnitRing';

// ── diff 경로 하네스 ────────────────────────────────────────────────────────
// public API가 **raw 문자열만** 받으므로 테스트도 문자열을 만들어 넘긴다.
// fixture는 "승인된 산출물"을 흉내내어 contextRaw/BASE bytes의 해시를 담는다.
// 이건 self-oracle이 아니다 — 여기서 만드는 것은 **유효한 입력**이고, 불일치를 잡는다는 사실은
// 아래 DIFF_*_NOT_APPROVED RED 테스트가 따로 증명한다. 프로덕션에서 그 해시의 권위는
// 승인 경로(artifactsCore)가 fingerprint와 대조하는 데서 나온다.
const D_SHA = (v) => createHash('sha256').update(Buffer.isBuffer(v) ? v : Buffer.from(v)).digest('hex');
const D_W = 200, D_H = 200;
const D_IMG = (fill = [255, 255, 255]) => s4Png(D_W, D_H, fill);
const D_PX = (x, y) => { const p = PNG.sync.read(D_IMG());
  const i = (D_W * y + x) << 2; p.data[i] = 0; p.data[i + 1] = 0; p.data[i + 2] = 0; return PNG.sync.write(p); };
const D_FIXTURE_RAW = ({ contextRaw, baseBuf, spec, over }) => JSON.stringify({
  ...unitFixture(),
  // fixture ↔ spec 신뢰 루트. 이걸 채우지 않으면 DIFF_FINGERPRINT_DRIFT로 먼저 막힌다 —
  // 즉 "관대한 spec + 손수 만든 fixture" 조합이 구조적으로 불가능하다.
  fingerprint: EV.specFingerprint(spec, D_SHA),
  base: spec.BASE,
  smoke: {
    contextSha256: D_SHA(contextRaw),
    captures: spec.REQUIRED_SMOKE_SURFACES.map((x) => ({ captureName: x.captureName, sha256: D_SHA(baseBuf) })),
  },
  ...over,
});
const D_CALL = ({ ctx, spec = UNIT_SPEC, surfaceName = 'unit-b', observed, baseBuf, afterBuf,
  contextRawOver, fixtureRawOver, ...rest } = {}) => {
  const c = ctx || unitCtx();
  const base = baseBuf || D_IMG();
  const contextRaw = contextRawOver !== undefined ? contextRawOver : JSON.stringify(c);
  const fixtureRaw = fixtureRawOver !== undefined ? fixtureRawOver
    : D_FIXTURE_RAW({ contextRaw: JSON.stringify(c), baseBuf: base, spec });
  const obs = observed !== undefined ? observed : unitObs(c, surfaceName);
  return PIX.diffSurfaceLight({ baseBuf: base, afterBuf: afterBuf || base, spec, surfaceName,
    fixtureRaw, contextRaw, observedRaw: typeof obs === 'string' ? obs : JSON.stringify(obs), ...rest });
};

const s4Png = (w, h, fill) => { const p = new PNG({ width: w, height: h });
  for (let i = 0; i < p.data.length; i += 4) { p.data[i] = fill[0]; p.data[i+1] = fill[1]; p.data[i+2] = fill[2]; p.data[i+3] = 255; }
  return PNG.sync.write(p); };

describe('S4 마스크 정본 — allow ID 완전분할·selector 일치·coverage 소유', () => {
  const fx = unitFixture();
  it('allow ID 전체가 live — dead 예외 개념이 존재하지 않는다', () => {
    expect(SPEC.DEAD_ALLOW_IDS).toBeUndefined();
    expect(SPEC.DEAD_SELECTORS).toBeUndefined();
    const specIds = Object.keys(SPEC.LIGHT_DIFF_MASKS).map(Number).sort((a, b) => a - b);   // 프로덕션 정본 대조는 여기서만
    const convIds = [...new Set(SPEC.CONVERSIONS.filter((c) => c.ident.t === 'allow').map((c) => c.ident.id))].sort((a, b) => a - b);
    expect(specIds).toEqual(convIds);
  });
  it('정상 UNIT spec/fixture/context는 오류 0 (clean baseline)', () => expect(EV.validateMaskContract(fx, UNIT_SPEC, unitCtx())).toEqual([]));
  it('RED: live allow의 mask 삭제(ID 4)', () => {
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { ...UNIT_SPEC.LIGHT_DIFF_MASKS } }; delete spec.LIGHT_DIFF_MASKS[4];
    expect(EV.validateMaskContract(fx, spec, unitCtx()).join()).toMatch(/MASK_ID_UNCLASSIFIED 4/);
  });
  it('RED: mask selector가 선언 selector와 불일치', () => {
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { ...UNIT_SPEC.LIGHT_DIFF_MASKS, 4: { ...UNIT_SPEC.LIGHT_DIFF_MASKS[4], selector: '.Wrong' } } };
    expect(EV.validateMaskContract(fx, spec, unitCtx()).join()).toMatch(/MASK_SELECTOR_MISMATCH 4/);
  });
  it('RED: 비정규 ID 키 "01"은 "1"과 합쳐지지 않고 거부', () => {
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { ...UNIT_SPEC.LIGHT_DIFF_MASKS, '01': UNIT_SPEC.LIGHT_DIFF_MASKS[1] } };
    expect(EV.validateMaskContract(fx, spec, unitCtx()).join()).toMatch(/MASK_ID_NONCANONICAL/);
  });
});

describe('S4 마스크 좌표 계약 — context rect', () => {
  const fx = unitFixture();
  const bad = (mut) => { const c = unitCtx(); mut(c, U_OWNER(U_RING)); return EV.validateMaskContract(fx, UNIT_SPEC, c).join(); };
  it('RED: spec 밖 selector 유입', () => expect(bad((c, s) => { c.baseLightMaskRects[s]['.Bogus'] = [S4_MK(1, 1, 5, 5, 1, 0)]; })).toMatch(/MASK_FOREIGN_SELECTOR/));
  it('RED: manifest에 없는 surface 이름', () => expect(bad((c) => { c.baseLightMaskRects.NOPE = { [U_RING]: [S4_MK(1, 1, 5, 5, 1.08, 3)] }; })).toMatch(/MASK_UNKNOWN_SURFACE NOPE/));
  it('RED: selector 키 생략(미조사) — [] 과 구분된다', () =>
    expect(bad((c, s) => { delete c.baseLightMaskRects[s][U_RING]; })).toMatch(/MASK_SELECTOR_NOT_SCANNED .*UnitRing/));
  it('RED: surface 통째 누락(미조사)', () =>
    expect(bad((c, s) => { delete c.baseLightMaskRects[s]; })).toMatch(/MASK_SURFACE_NOT_SCANNED/));
  it('RED: 전 surface에서 occurrence 0 → 그 마스크는 관측된 적이 없다', () =>
    expect(bad((c) => { for (const s of Object.keys(c.baseLightMaskRects)) c.baseLightMaskRects[s][U_RING] = []; }))
      .toMatch(/MASK_RECT_ABSENT .*UnitRing/));
  it('GREEN: 조사했고 0건인 화면은 빈 배열로 정상 표현', () => {
    const c = unitCtx();
    expect(c.baseLightMaskRects['unit-a'][U_RING]).toEqual([]);
    expect(EV.validateMaskContract(fx, UNIT_SPEC, c)).toEqual([]);
  });
  it('행렬 완전성: UNIT 2 surface × live 2 키를 전부 보유', () => {
    const c = unitCtx();
    expect(Object.keys(c.baseLightMaskRects).sort()).toEqual(UNIT_SPEC.REQUIRED_SMOKE_SURFACES.map((x) => x.name).sort());
    for (const s of Object.keys(c.baseLightMaskRects))
      expect(Object.keys(c.baseLightMaskRects[s]).sort()).toEqual(Object.values(UNIT_SPEC.LIGHT_DIFF_MASKS).map((m) => m.selector).sort());
  });
  it('RED: paintRect 누락(= border rect만)', () => expect(bad((c, s) => { delete c.baseLightMaskRects[s][U_RING][0].paintRect; })).toMatch(/MASK_PAINT_MISSING/));
  it('RED: paintRect 과소 확장', () => expect(bad((c, s) => { c.baseLightMaskRects[s][U_RING][0].paintRect.width -= 2; })).toMatch(/MASK_PAINT_MISMATCH/));
  it('RED: scale과 paintRect 동시 확대(내부 일관이어도 spec 기대와 다름)', () => expect(bad((c, s) => {
    const r = c.baseLightMaskRects[s][U_RING][0]; r.scale = 3;
    r.paintRect = { x: r.x - 9, y: r.y - 9, width: r.width + 18, height: r.height + 18 };
  })).toMatch(/MASK_SCALE_UNEXPECTED/));
  it('RED: width 0 / NaN / viewport 밖', () => {
    expect(bad((c, s) => { c.baseLightMaskRects[s][U_RING][0].width = 0; })).toMatch(/MASK_RECT_DEGENERATE/);
    expect(bad((c, s) => { c.baseLightMaskRects[s][U_RING][0].x = NaN; })).toMatch(/MASK_RECT_NONFINITE/);
    // .UnitRing의 변경 property는 box-shadow다 — ring paint를 줘야 outset 3이 파생된다.
    expect(bad((c, s) => { c.baseLightMaskRects[s][U_RING][0] = S4_MK(1439, 899, 20, 20, 1.08, 3, S4_PAINT.ring); })).toMatch(/MASK_RECT_OUT_OF_VIEWPORT/);
  });
  it('GREEN: coverage owner가 아닌 surface의 정상 occurrence도 허용(모달 뒤 캔버스)', () => {
    // .UnitPlain의 coverage owner는 unit-a인데 unit-b에도 실제로 렌더된다. 기본 ctx가 이미 그 상태다.
    expect(U_OWNER('.UnitPlain')).toBe('unit-a');
    expect(unitCtx().baseLightMaskRects['unit-b']['.UnitPlain'].length).toBe(1);
    expect(EV.validateMaskContract(fx, UNIT_SPEC, unitCtx())).toEqual([]);
  });
});

describe('S4 pixel diff 소비 — raw snapshot만 받는 단일 경로', () => {
  it('GREEN 대조군: 정상 입력', () => {
    const r = D_CALL();
    expect(r.errors).toEqual([]); expect(r.diff).toBe(0); expect(r.ok).toBe(true);
  });
  it('validator를 주입할 수 없다(정적 결속) — 인자를 넘겨도 무시된다', () => {
    expect(D_CALL({ validateMaskContract: () => [] }).errors).toEqual([]);
    const forged = unitCtx();
    forged.baseLightMaskRects['unit-b'][U_RING][0].paintRect.width = 9999;
    expect(D_CALL({ ctx: forged, validateMaskContract: () => [] }).errors.join())
      .toMatch(/MASK_PAINT_MISMATCH/);
  });
  it('RED: 파싱된 객체는 아예 받지 않는다 — Proxy가 들어올 통로 자체가 없다', () => {
    const ctx = unitCtx();
    expect(PIX.diffSurfaceLight({ baseBuf: D_IMG(), afterBuf: D_IMG(), spec: UNIT_SPEC, surfaceName: 'unit-b',
      fixture: unitFixture(), context: ctx, observed: unitObs(ctx, 'unit-b') }).errors.join())
      .toMatch(/DIFF_FIXTURERAW_REQUIRED/);
    expect(D_CALL({ contextRawOver: { not: 'a string' } }).errors.join()).toMatch(/DIFF_CONTEXTRAW_REQUIRED/);
  });
  it('RED: 검증 중과 소비 시점에 다른 값을 주는 Proxy — 직렬화되어 무력화된다', () => {
    // 이전 판(객체 인자)에서는 이 공격이 errors=0 diff=0 ok=true 로 통했다.
    // 이제 문자열만 받으므로 Proxy를 JSON.stringify한 결과(= target의 정직한 값)만 들어온다.
    const ctx = unitCtx();
    const target = ctx.baseLightMaskRects['unit-b'][U_RING][0];
    const honest = { ...target.paintRect };
    let reads = 0;
    ctx.baseLightMaskRects['unit-b'][U_RING][0] = new Proxy(target, {
      get(t, k) { if (k !== 'paintRect') return t[k]; reads++; return reads > 1 ? { x: 0, y: 0, width: 3000, height: 3000 } : honest; },
    });
    const contextRaw = JSON.stringify(ctx);                       // 여기서 한 번만 읽힌다
    const r = D_CALL({ contextRawOver: contextRaw,
      fixtureRawOver: D_FIXTURE_RAW({ contextRaw, baseBuf: D_IMG(), spec: UNIT_SPEC }),
      observed: JSON.parse(contextRaw).baseLightMaskRects['unit-b'] && undefined,
      ctx: JSON.parse(contextRaw), afterBuf: D_PX(150, 150) });
    // 마스크 밖(150,150) 회귀가 그대로 검출된다 — 소비 시점 위조가 통하지 않는다
    expect(r.errors).toEqual([]); expect(r.diff).toBe(1); expect(r.ok).toBe(false);
  });
  it('RED: contextRaw가 승인된 해시와 다르다', () => {
    const c = unitCtx();
    const approved = JSON.stringify(c);
    const tampered = JSON.stringify({ ...c, injected: 1 });
    expect(D_CALL({ ctx: c, contextRawOver: tampered,
      fixtureRawOver: D_FIXTURE_RAW({ contextRaw: approved, baseBuf: D_IMG(), spec: UNIT_SPEC }) })
      .errors.join()).toMatch(/DIFF_CONTEXT_NOT_APPROVED/);
  });
  it('RED: BASE PNG가 승인된 바이트와 다르다', () => {
    const other = D_IMG([254, 255, 255]);
    expect(D_CALL({ baseBuf: other, fixtureRawOver: D_FIXTURE_RAW({ contextRaw: JSON.stringify(unitCtx()), baseBuf: D_IMG(), spec: UNIT_SPEC }) })
      .errors.join()).toMatch(/DIFF_BASE_NOT_APPROVED unit-b\.png/);
  });
  it('RED: 이 surface의 captureName이 fixture에 없다', () => {
    const contextRaw = JSON.stringify(unitCtx());
    const raw = JSON.parse(D_FIXTURE_RAW({ contextRaw, baseBuf: D_IMG(), spec: UNIT_SPEC }));
    raw.smoke.captures = raw.smoke.captures.filter((c) => c.captureName !== 'unit-b.png');
    expect(D_CALL({ fixtureRawOver: JSON.stringify(raw) }).errors.join()).toMatch(/DIFF_BASE_NOT_IN_FIXTURE unit-b\.png/);
  });
  it('RED: raster 계약 위반 — PNG 치수 / viewport / dpr / screenshotScale', () => {
    // PNG가 계약 치수가 아니면 거부한다. 이전 판은 40x40이든 3000x2000이든 errors=0 diff=0 ok=true였다.
    const small = s4Png(40, 40, [255, 255, 255]);
    expect(D_CALL({ baseBuf: small,
      fixtureRawOver: D_FIXTURE_RAW({ contextRaw: JSON.stringify(unitCtx()), baseBuf: small, spec: UNIT_SPEC }) })
      .errors.join()).toMatch(/RASTER_PNG_SIZE BASE 40x40 != 200x200/);
    expect(D_CALL({ afterBuf: s4Png(400, 400, [255, 255, 255]) }).errors.join())
      .toMatch(/RASTER_PNG_SIZE AFTER 400x400/);
    const badVp = unitCtx(); badVp.viewport = { width: 1440, height: 900 };
    expect(D_CALL({ ctx: badVp }).errors.join()).toMatch(/RASTER_CONTEXT_VIEWPORT 1440x900 != 200x200/);
    const noDpr = unitCtx(); delete noDpr.capture.dpr;
    expect(D_CALL({ ctx: noDpr }).errors.join()).toMatch(/RASTER_DPR undefined != 1/);
    const badScale = unitCtx(); badScale.capture.scale = 'device';
    expect(D_CALL({ ctx: badScale }).errors.join()).toMatch(/RASTER_SCREENSHOT_SCALE device != css/);
  });
  it('RED: PNG 바이트 손상은 decode 단계에서 거부된다', () => {
    const ok = D_IMG(); const broken = Buffer.from(ok); broken[Math.floor(broken.length / 2)] ^= 0xff;
    expect(D_CALL({ afterBuf: broken }).errors.join()).toMatch(/RASTER_PNG_DECODE AFTER/);
  });
  it('RED: observed 생략', () => expect(D_CALL({ observed: null }).errors.join()).toMatch(/OBSERVE_REQUIRED/));
  it('RED: selector 값이 배열이 아님 → KEY_MISSING', () => {
    const o = unitObs(unitCtx(), 'unit-b'); o[U_RING] = {};
    expect(D_CALL({ observed: o }).errors.join()).toMatch(/OBSERVE_KEY_MISSING/);
  });
  it('RED: 같은 개수인데 좌표 누락 [{}] → NONFINITE', () => {
    const o = unitObs(unitCtx(), 'unit-b'); o[U_RING] = [{}];
    expect(D_CALL({ observed: o }).errors.join()).toMatch(/OBSERVE_NONFINITE/);
  });
  it('RED: occurrence 개수 불일치', () => {
    const o = unitObs(unitCtx(), 'unit-b'); o[U_RING] = [];
    expect(D_CALL({ observed: o }).errors.join()).toMatch(/OBSERVE_COUNT/);
  });
  it('RED: 요소 이동(정규화 경계 초과)', () => {
    const o = unitObs(unitCtx(), 'unit-b');
    o[U_RING][0] = { ...o[U_RING][0], x: o[U_RING][0].x + 0.02 };
    expect(D_CALL({ observed: o }).errors.join()).toMatch(/OBSERVE_GEOMETRY/);
  });
  it('GREEN: 양자(1/64px) 미만 흔들림은 동일 좌표로 정규화', () => {
    const o = unitObs(unitCtx(), 'unit-b');
    o[U_RING][0] = { ...o[U_RING][0], x: o[U_RING][0].x + 0.005 };
    expect(D_CALL({ observed: o }).errors).toEqual([]);
  });
  it('RED: manifest에 없는 surface는 빈 비교로 통과하지 못한다', () =>
    expect(D_CALL({ surfaceName: 'NOPE', observed: {} }).errors.join()).toMatch(/SURFACE_UNKNOWN/));
  it('RED: context에 없는 surface', () => {
    const c = unitCtx(); const o = unitObs(c, 'unit-b'); delete c.baseLightMaskRects['unit-b'];
    expect(D_CALL({ ctx: c, observed: o }).errors.join()).toMatch(/SURFACE_NOT_IN_CONTEXT/);
  });
  it('GREEN: 그 화면에 live selector가 하나도 없어도 정상(전부 빈 배열, maskCount 0)', () => {
    const spec = { ...UNIT_SPEC, REQUIRED_SMOKE_SURFACES: [...UNIT_SPEC.REQUIRED_SMOKE_SURFACES,
      { name: 'unit-empty', captureName: 'unit-empty.png', actions: [], requiredElements: [], coverageSelectors: [], darkReviewSelectors: [] }],
      // surface를 추가하면 예산도 선언해야 한다 — 0건 화면의 예산은 0이다.
      MASK_PIXEL_BUDGET: { ...UNIT_SPEC.MASK_PIXEL_BUDGET, 'unit-empty': 0 } };
    const c = unitCtx();
    c.baseLightMaskRects['unit-empty'] = Object.fromEntries(Object.values(spec.LIGHT_DIFF_MASKS).map((m) => [m.selector, []]));
    const o = Object.fromEntries(Object.values(spec.LIGHT_DIFF_MASKS).map((m) => [m.selector, []]));
    const r = D_CALL({ ctx: c, spec, surfaceName: 'unit-empty', observed: o });
    expect(r.errors).toEqual([]); expect(r.maskCount).toBe(0);
  });
});

describe('S4 게이트 배선 — helper가 아니라 공용 경로가 잡는다', () => {
  const fx = unitFixture();
  // helper 직접 호출 테스트만 있으면 evaluateConformance에서 호출을 빼도 GREEN이다.
  // 배선 자체를 잠그기 위해 반드시 공용 conformance 경로로 단정한다.
  const conform = (spec) => EV.evaluateConformance(UNIT_DECLS, '', {}, spec, fx, UNIT_ACTUAL_ALLOW_MAP, UNIT_BASE_DECLS).join('\n');
  it('RED: 마스크 정본 위반도 evaluateConformance 경로에서 검출된다', () => {
    // evaluateConformance는 counts 등 다른 검사도 하지만, 여기서 잠그는 것은
    // "마스크 정본 위반이 helper 직접 호출이 아니라 **공용 경로**에서도 나오는가"다.
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { ...UNIT_SPEC.LIGHT_DIFF_MASKS } }; delete spec.LIGHT_DIFF_MASKS[4];
    expect(conform(spec)).toMatch(/MASK_ID_UNCLASSIFIED 4/);
    expect(conform(UNIT_SPEC)).not.toMatch(/MASK_ID_UNCLASSIFIED/);
  });
});

describe('S4 outset 파생 — 선언값이 아니라 변경 property의 computed 페인트에서 나온다', () => {
  const P = (over) => ({ boxShadow: 'none', outlineStyle: 'none', outlineWidth: '0px', outlineOffset: '0px', filter: 'none', ...over });
  it('괄호 안 콤마를 보존해 레이어를 나눈다', () => {
    expect(EV.splitTopLevel('rgba(0, 0, 0, 0.03) 0px 1px 2px 0px, rgb(1, 2, 3) 0px 0px 0px 3px'))
      .toEqual(['rgba(0, 0, 0, 0.03) 0px 1px 2px 0px', 'rgb(1, 2, 3) 0px 0px 0px 3px']);
  });
  it('border box 안에만 칠하는 property는 0', () => {
    for (const prop of ['background', 'background-color', 'color', 'border', 'border-color'])
      expect(EV.maxOutwardPaintPx(prop, P({ boxShadow: 'rgba(0, 0, 0, 0.5) 0px 40px 40px 40px' })))
        .toEqual({ px: 0, errors: [] });   // 그림자가 있어도 **변경된 것은 배경**이라 무관하다
  });
  it('box-shadow: spread·blur·offset에서 최대 외곽 거리를 뽑는다', () => {
    const f = (bs) => EV.maxOutwardPaintPx('box-shadow', P({ boxShadow: bs })).px;
    expect(f('none')).toBe(0);
    expect(f('rgb(255, 255, 255) 0px 0px 0px 2px, rgb(229, 229, 229) 0px 0px 0px 3px')).toBe(3);  // 실제 스와치
    expect(f('rgba(0, 0, 0, 0.03) 0px 1px 2px 0px')).toBe(3);                                     // blur 2 + dy 1
    expect(f('rgb(0, 0, 0) -5px 0px 0px 0px')).toBe(5);                                            // 음수 오프셋
    expect(f('rgb(0, 0, 0) 0px 0px 0px 9px inset')).toBe(0);                                       // inset은 안쪽
  });
  it('outline은 width+offset, filter는 drop-shadow', () => {
    expect(EV.maxOutwardPaintPx('outline', P({ outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '1px' })).px).toBe(3);
    expect(EV.maxOutwardPaintPx('outline', P({ outlineStyle: 'none', outlineWidth: '9px' })).px).toBe(0);
    // drop-shadow는 spread가 없다 — 길이 3개(dx dy blur). blur 4px는 실제로 4px 밖까지 칠한다.
    expect(EV.maxOutwardPaintPx('filter', P({ filter: 'drop-shadow(rgb(0, 0, 0) 0px 0px 4px)' })).px).toBe(4);
    expect(EV.maxOutwardPaintPx('filter', P({ filter: 'drop-shadow(rgb(0, 0, 0) 2px 0px 1px)' })).px).toBe(3);
    // box-shadow 형태(길이 4개)를 filter에 넣으면 0이 아니라 오류다
    expect(EV.maxOutwardPaintPx('filter', P({ filter: 'drop-shadow(rgb(0, 0, 0) 0px 0px 4px 4px)' })).errors.join())
      .toMatch(/SHADOW_LAYER_UNPARSEABLE/);
  });
  it('RED: 모델에 없는 property는 0으로 떨어지지 않고 오류다', () => {
    const r = EV.maxOutwardPaintPx('mystery-prop', P());
    expect(r.errors.join()).toMatch(/PAINT_PROPERTY_UNMODELED mystery-prop/);
    expect(Number.isFinite(r.px)).toBe(false);
  });
  it('RED: 파싱 불가한 shadow 레이어는 0이 아니라 오류다', () => {
    const r = EV.maxOutwardPaintPx('box-shadow', P({ boxShadow: 'rgb(0, 0, 0) 1px' }));
    expect(r.errors.join()).toMatch(/SHADOW_LAYER_UNPARSEABLE/);
    expect(Number.isFinite(r.px)).toBe(false);
  });
  it('filter가 drop-shadow가 아니면 모델 밖으로 신고한다', () => {
    expect(EV.maxOutwardPaintPx('filter', P({ filter: 'blur(4px)' })).errors.join()).toMatch(/PAINT_FILTER_UNMODELED/);
  });
});

describe('S4 마스크 픽셀 예산 — 겹침을 반영한 집합 크기', () => {
  it('겹치는 rect는 한 번만 센다(면적 합이 아니다)', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(EV.countMaskedPixels([a], 100, 100)).toBe(100);
    expect(EV.countMaskedPixels([a, a], 100, 100)).toBe(100);              // 면적 합이면 200
    expect(EV.countMaskedPixels([a, { x: 5, y: 0, width: 10, height: 10 }], 100, 100)).toBe(150);
  });
  it('fillRects와 같은 픽셀 규칙을 쓴다(경계 floor/ceil)', () => {
    const r = { x: 0.5, y: 0.5, width: 1, height: 1 };
    expect(EV.rectPixelBounds(r, 100, 100)).toEqual({ x0: 0, y0: 0, x1: 2, y1: 2 });
    const png = PNG.sync.read(s4Png(4, 4, [255, 255, 255]));
    PIX.fillRects(png, [r]);
    let black = 0;
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i] === 0) black++;
    expect(black).toBe(EV.countMaskedPixels([r], 4, 4));                   // 두 경로가 같은 픽셀 수
  });
  it('뷰포트 밖은 잘린다', () => {
    expect(EV.countMaskedPixels([{ x: -5, y: -5, width: 10, height: 10 }], 100, 100)).toBe(25);
  });
});

describe('S4 커밋된 캡처 실행기 — 세만틱은 러너가 소유하고 driver는 원시 동작만 한다', () => {
  // ── fake driver ────────────────────────────────────────────────────────────
  // 페이지 상태를 아주 단순한 모델로 흉내낸다: url → 보이는 selector 집합.
  // driver는 "상태를 만드는" 역할만 하고, 판정은 러너가 evaluate(ASSERT_SOURCE)로 한다.
  const mkDriver = (opts = {}) => {
    const st = { url: null, storage: { ...(opts.storage || {}) }, visible: new Set(), calls: [], viewport: null };
    const model = opts.model || {};
    const apply = () => { st.visible = new Set(model[st.url] || []); };
    const d = {
      state: st,
      async setViewport(w, h) { st.viewport = [w, h]; st.calls.push(['setViewport', w, h]); },
      async setStorage(k, v) { st.storage[k] = v; st.calls.push(['setStorage', k, v]); },
      async goto(u) { st.url = u; apply(); st.calls.push(['goto', u]); },
      async settle(sel, state) { st.calls.push(['settle', sel, state]); if (opts.settleThrows) throw new Error('settle timeout'); },
      async click(sel, nth, hasText) { st.calls.push(['click', sel, nth, hasText]);
        for (const s2 of (opts.clickAdds || {})[sel] || []) st.visible.add(s2);
        for (const s2 of (opts.clickRemoves || {})[sel] || []) st.visible.delete(s2); },
      async hover(sel, nth) { st.calls.push(['hover', sel, nth]); st.visible.add(`${sel}:hover`); },
      async evaluate(source, arg) {
        st.calls.push(['evaluate', source === PROBE.PROBE_SOURCE ? 'PROBE' : source === PROBE.ASSERT_SOURCE ? 'ASSERT' : 'OTHER']);
        if (opts.evaluate) { const r = opts.evaluate(source, arg, st); if (r !== undefined) return r; }
        if (source === RUN.READ_STORAGE_SOURCE)
          return Object.fromEntries(arg.map((k) => [k, { present: st.storage[k] !== undefined, value: st.storage[k] ?? null }]));
        if (source === PROBE.THEME_PROBE_SOURCE)
          return { dataTheme: opts.dataTheme === undefined ? st.storage.theme ?? null : opts.dataTheme,
            stored: st.storage.theme ?? null, colorScheme: '' };
        if (source === PROBE.RASTER_PROBE_SOURCE)
          return { innerWidth: st.viewport ? st.viewport[0] : 0, innerHeight: st.viewport ? st.viewport[1] : 0,
            dpr: opts.dpr === undefined ? 1 : opts.dpr, scrollX: 0, scrollY: 0, docScrollWidth: st.viewport ? st.viewport[0] : 0 };
        if (source === RUN.RESTORE_STORAGE_SOURCE) {
          for (const [k, v] of arg) { if (v && v.present) st.storage[k] = v.value; else delete st.storage[k]; }
          return true;
        }
        if (source === PROBE.ASSERT_SOURCE)
          return Object.fromEntries(arg.map((sel) => [sel, { count: st.visible.has(sel) ? 1 : 0, visible: st.visible.has(sel) ? 1 : 0 }]));
        if (source === PROBE.PROBE_SOURCE)
          return Object.fromEntries(arg.map((sel) => [sel, st.visible.has(sel) ? [{
            x: 10, y: 10, width: 20, height: 20, borderBoxWidth: 20, borderBoxHeight: 20,
            transformScaleX: 1, transformScaleY: 1, chainDepth: 2, skewCount: 0, nonFlatCount: 0, zoomCount: 0,
            offsetWidth: 20, offsetHeight: 20, display: 'block', boxSizing: 'border-box',
            cssWidth: '20px', cssHeight: '20px', padX: 0, padY: 0, brdX: 0, brdY: 0,
            boxShadow: 'none', outlineStyle: 'none', outlineWidth: '0px', outlineOffset: '0px', filter: 'none',
          }] : []]));
        throw new Error('unknown source');
      },
      async sleep(ms) { st.calls.push(['sleep', ms]); },
      async reload() { st.calls.push(['reload']); apply(); },
      // 실제 PNG를 돌려준다 — 러너가 IHDR을 decode해 래스터 계약과 대조하기 때문이다.
      async screenshot() { st.calls.push(['screenshot']);
        return opts.screenshot ? opts.screenshot(st) : s4Png(st.viewport ? st.viewport[0] : 200, st.viewport ? st.viewport[1] : 200, [250, 250, 250]); },
    };
    return d;
  };
  const SURF = {
    name: 'r-a', captureName: 'r-a.png', requiredElements: [], darkReviewSelectors: [],
    actions: [
      { op: 'setStorage', key: 'track:{id}:lastView', value: 'flow' },
      { op: 'goto', url: '/tracks/{id}' },
      { op: 'click', selector: '.Toggle', nth: 0 },
      { op: 'expectPresent', selector: '.Pill--on' },
    ],
    coverageSelectors: [{ selector: '.Pill--on', state: 'selected', provenBy: 2, produces: '.Pill--on' }],
  };
  const R200 = { width: 200, height: 200, dpr: 1, screenshotScale: 'css' };
  // 러너는 paintRect를 spec의 outset에서 파생한다 — 정본 없이는 fail-closed(RUN_NO_OUTSET).
  const SPEC_R = { LIGHT_DIFF_MASKS: { 1: { selector: '.Target', paintOutsetPx: 2 } } };
  const CTXIN = { trackId: 7 };
  const SELS = ['.Target'];
  const MODEL = { '/tracks/7': ['.Toggle', '.Target'] };
  const good = () => mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] } });

  it('실행 계획: placeholder를 해석하고 op/필드를 화이트리스트로 강제한다', () => {
    const { steps, errors } = RUN.planSurface(SURF, CTXIN);
    expect(errors).toEqual([]);
    expect(steps.map((s) => s.op)).toEqual(['setStorage', 'goto', 'click', 'expectPresent']);
    expect(steps[0].key).toBe('track:7:lastView');
    expect(steps[1].url).toBe('/tracks/7');
    expect(steps[2].postAssert.map((p) => p.why)).toEqual(['state:selected', 'produces']);
  });
  it('RED: 미해결 placeholder / 미지 op / 필드 누락 / 여분 필드', () => {
    expect(RUN.planSurface(SURF, {}).errors.join()).toMatch(/PLAN_UNRESOLVED_PLACEHOLDER/);
    expect(RUN.planSurface({ ...SURF, actions: [{ op: 'evalJs', code: '1' }] }, CTXIN).errors.join()).toMatch(/PLAN_UNKNOWN_OP r-a\[0\] evalJs/);
    expect(RUN.planSurface({ ...SURF, actions: [{ op: 'goto' }] }, CTXIN).errors.join()).toMatch(/PLAN_MISSING_FIELD r-a\[0\] goto\.url/);
    expect(RUN.planSurface({ ...SURF, actions: [{ op: 'goto', url: '/x', sneaky: 1 }] }, CTXIN).errors.join()).toMatch(/PLAN_EXTRA_FIELD/);
    expect(RUN.planSurface({ ...SURF, actions: [{ op: 'waitFor', selector: '.X', state: 'maybe' }] }, CTXIN).errors.join()).toMatch(/PLAN_BAD_STATE/);
  });
  it('GREEN: 정상 실행 — 로그·측정·PNG가 모두 나온다', async () => {
    const r = await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: good(), selectors: SELS,
      raster: R200, spec: SPEC_R });
    expect(r.errors).toEqual([]);
    expect(r.log.map((l) => [l.index, l.op])).toEqual([[0, 'setStorage'], [1, 'goto'], [2, 'click'], [3, 'expectPresent']]);
    expect(r.log[2].decided['.Pill--on']).toEqual({ count: 1, visible: 1 });   // 상태 증거가 기록된다
    expect(r.occurrences['.Target'].length).toBe(1);
    // paintRect는 검증기와 **같은 함수**로 파생돼 붙는다(outset 2 x scale 1)
    expect(r.occurrences['.Target'][0].paintRect)
      .toEqual(EV.derivePaintRect(r.occurrences['.Target'][0], 2));
    expect(r.occurrences['.Target'][0].paintRect.width).toBe(20 + 4);
    expect(EV.decodePngHeader(r.png)).toMatchObject({ ok: true, width: 200, height: 200 });
    expect(r.settled).toBe(true);                                              // 픽셀 정착 게이트 통과
  });
  it('RED: 거짓말하는 driver — settle이 즉시 resolve해도 postcondition은 통과하지 못한다', async () => {
    // click이 아무 상태도 만들지 않는 driver. settle은 성공한 척한다.
    const liar = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: {} });
    const r = await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: liar, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' });
    expect(r.errors.join()).toMatch(/RUN_STATE_UNPROVEN r-a\[2\] state:selected \.Pill--on count=0 visible=0/);
    expect(r.occurrences).toBeNull();                    // 측정까지 가지 않는다
  });
  it('RED: settle이 throw해도 러너가 최종 판정한다(도달했으면 GREEN)', async () => {
    const d = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] }, settleThrows: true });
    const r = await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' });
    expect(r.errors).toEqual([]);                        // settle 실패는 판정이 아니다
  });
  it('RED: expectAbsent는 실제로 사라졌는지 확인한다', async () => {
    const surface = { ...SURF, actions: [...SURF.actions, { op: 'expectAbsent', selector: '.Pill--on' }] };
    const r = await RUN.runSurface({ surface, rawContext: CTXIN, driver: good(), selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' });
    expect(r.errors.join()).toMatch(/RUN_POSTCONDITION_FAILED r-a\[4\] expectAbsent \.Pill--on count=1 visible=1/);
  });
  it('RED: driver가 assert 결과를 위조하면 형태 검증이 잡는다', async () => {
    const d = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] },
      evaluate: (src, arg) => (src === PROBE.ASSERT_SOURCE ? { '.Pill--on': { count: 1, visible: 9 } } : undefined) });
    const r = await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' });
    expect(r.errors.join()).toMatch(/RUN_ASSERT_INVALID .*ASSERT_VISIBLE_GT_COUNT/);
  });
  it('RED: driver가 probe 결과를 위조하면 probe 계약이 잡는다', async () => {
    const d = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] },
      evaluate: (src, arg) => (src === PROBE.PROBE_SOURCE ? { '.Target': [{ x: 1, y: 1, width: 1, height: 1 }] } : undefined) });
    const r = await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' });
    expect(r.errors.join()).toMatch(/RUN_PROBE_INVALID/);
  });
  it('RED: 빈 스크린샷', async () => {
    const d = good(); d.screenshot = async () => Buffer.alloc(0);
    const r = await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' });
    expect(r.errors.join()).toMatch(/RUN_SCREENSHOT_EMPTY/);
  });
  it('viewport를 래스터 계약으로 먼저 맞춘다', async () => {
    const d = good();
    await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d, selectors: SELS, raster: { width: 1440, height: 900, dpr: 1, screenshotScale: 'css' } });
    expect(d.state.calls[0]).toEqual(['setViewport', 1440, 900]);
  });
  it('theme·현재 view를 finally에서 복원한다(실패 경로에서도)', async () => {
    const spec = { REQUIRED_SMOKE_SURFACES: [SURF], RASTER_CONTRACT: R200, LIGHT_DIFF_MASKS: SPEC_R.LIGHT_DIFF_MASKS };
    const dir = mkdtempSync(join(tmpdir(), 's4-run-'));
    try {
      const d = mkDriver({ model: MODEL, storage: { theme: 'dark' }, clickAdds: { '.Toggle': ['.Pill--on'] } });
      const r = await RUN.runCapture({ spec, rawContext: CTXIN, driver: d, selectors: SELS, phase: 'light' });
      expect(r.errors).toEqual([]);
      expect(d.state.storage.theme).toBe('dark');                     // 복원됨
      expect(d.state.storage['track:7:lastView']).toBeUndefined();     // 원래 없었으므로 제거됨
      expect(r.context.prevTheme).toEqual({ present: true, value: 'dark' });
      expect(r.context.capture).toEqual({ type: 'png', scale: 'css', dpr: 1 });
      expect(r.context.viewport).toEqual({ width: 200, height: 200 });
      expect(Object.keys(r.context.actionLog)).toEqual(['r-a']);
      // **캡처는 아무것도 쓰지 않는다** — 쓰기는 postflight를 통과한 호출부의 몫이다.
      expect(existsSync(join(dir, 's4-shots', RUN.CANDIDATE_BUNDLE_DIR('light')))).toBe(false);
      expect(RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: dir, phase: 'light', contextRaw: r.contextRaw,
        pngByCaptureName: r.pngByCaptureName, expectedCaptureNames: r.expectedCaptureNames })).toEqual([]);
      expect(RUN.readCandidateBundle(dir, 'light').contextRaw).toBe(r.contextRaw);
      expect(EV.decodePngHeader(RUN.readCandidateBundle(dir, 'light').pngByName['r-a.png']))
        .toMatchObject({ ok: true, width: 200, height: 200 });
      expect(existsSync(join(dir, 's4-smoke-context.json'))).toBe(false);   // committed는 건드리지 않는다
      // 실패 경로에서도 복원된다
      const bad = mkDriver({ model: MODEL, storage: { theme: 'dark' }, clickAdds: {} });
      const r2 = await RUN.runCapture({ spec, rawContext: CTXIN, driver: bad, selectors: SELS, phase: 'light' });
      expect(r2.errors.join()).toMatch(/RUN_STATE_UNPROVEN/);
      expect(bad.state.storage.theme).toBe('dark');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('RED: dpr/viewport/스크롤을 페이지에서 실측해 대조한다(자기신고 폐쇄)', async () => {
    const d2 = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] }, dpr: 2 });
    expect((await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d2, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' }))
      .errors.join()).toMatch(/RUN_RASTER_DPR r-a 2 != 1/);
    const d3 = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] },
      evaluate: (src, a, st) => (src === PROBE.RASTER_PROBE_SOURCE
        ? { innerWidth: 800, innerHeight: 600, dpr: 1, scrollX: 0, scrollY: 0, docScrollWidth: 800 } : undefined) });
    expect((await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d3, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' }))
      .errors.join()).toMatch(/RUN_RASTER_VIEWPORT r-a 800x600 != 200x200/);
    const d4 = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] },
      evaluate: (src) => (src === PROBE.RASTER_PROBE_SOURCE
        ? { innerWidth: 200, innerHeight: 200, dpr: 1, scrollX: 0, scrollY: 40, docScrollWidth: 200 } : undefined) });
    expect((await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d4, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' }))
      .errors.join()).toMatch(/RUN_RASTER_SCROLLED r-a 0,40/);
  });
  it('RED: produces는 전이를 요구한다 — 이미 켜져 있었다면 그 action의 증거가 아니다', async () => {
    // .Pill--on이 처음부터 보이는 모델. 직후 검사만 하면 통과하지만 전이 검사는 잡는다.
    const d = mkDriver({ model: { '/tracks/7': ['.Toggle', '.Target', '.Pill--on'] }, storage: { theme: 'light' } });
    expect((await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' }))
      .errors.join()).toMatch(/RUN_NO_TRANSITION r-a\[2\] \.Pill--on before count=1/);
  });
  it('RED: manifest가 선언한 coverage 요소가 캡처 시점에 없으면 그 PNG는 증거가 아니다', async () => {
    const surface = { ...SURF, requiredElements: ['.MustExist'] };
    const d = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] } });
    expect((await RUN.runSurface({ surface, rawContext: CTXIN, driver: d, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' }))
      .errors.join()).toMatch(/RUN_COVERAGE_ABSENT r-a \.MustExist count=0/);
  });
  it('RED: 스크린샷이 래스터 계약과 다른 치수 / decode 불가', async () => {
    const d = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] },
      screenshot: () => s4Png(400, 400, [1, 2, 3]) });
    expect((await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' }))
      .errors.join()).toMatch(/RUN_SCREENSHOT_SIZE r-a 400x400 != 200x200/);
    const d2 = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] },
      screenshot: () => Buffer.from('not a png at all........') });
    expect((await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d2, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' }))
      .errors.join()).toMatch(/RUN_SCREENSHOT_DECODE r-a/);
  });
  it('RED: 픽셀이 정착하지 않으면 재현 가능한 증거가 아니다', async () => {
    let n = 0;
    const d = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] },
      screenshot: () => s4Png(200, 200, [n++, 0, 0]) });     // 매번 다른 픽셀
    expect((await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' }))
      .errors.join()).toMatch(/RUN_UNSTABLE_PIXELS r-a/);
  });
  it('RED: phase 없이는 캡처가 시작되지 않는다', async () => {
    const spec = { REQUIRED_SMOKE_SURFACES: [SURF], RASTER_CONTRACT: R200, LIGHT_DIFF_MASKS: SPEC_R.LIGHT_DIFF_MASKS };
    const d = good();
    const r = await RUN.runCapture({ spec, rawContext: CTXIN, driver: d, selectors: SELS, phase: undefined });
    expect(r.errors).toEqual(['RUN_PHASE_INVALID undefined']);
    expect(d.state.calls.length).toBe(0);                       // 브라우저를 건드리지도 않는다
  });
  it('phase를 실제로 적용하고 data-theme으로 확인한다', async () => {
    const spec = { REQUIRED_SMOKE_SURFACES: [SURF], RASTER_CONTRACT: R200, LIGHT_DIFF_MASKS: SPEC_R.LIGHT_DIFF_MASKS };
    const dir = mkdtempSync(join(tmpdir(), 's4-phase-'));
    try {
      const d = mkDriver({ model: MODEL, storage: { theme: 'dark' }, clickAdds: { '.Toggle': ['.Pill--on'] } });
      const r = await RUN.runCapture({ spec, rawContext: CTXIN, driver: d, selectors: SELS, phase: 'light' });
      expect(r.errors).toEqual([]);
      const ops = d.state.calls.map((c) => c[0]);
      // 원래 상태 읽기 → theme 설정 → reload → data-theme 확인
      // 원래 상태 읽기(storage) → 원래 data-theme 읽기 → theme 설정 → reload → 확인
      expect(ops.slice(0, 5)).toEqual(['evaluate', 'evaluate', 'setStorage', 'reload', 'evaluate']);
      expect(d.state.calls[2]).toEqual(['setStorage', 'theme', 'light']);
      expect(r.context.phase).toBe('light');
      expect(d.state.storage.theme).toBe('dark');                              // 원복
      expect(ops.filter((o) => o === 'reload').length).toBe(2);                 // 적용 1 + 복원 확인 1
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('RED: 테마가 적용되지 않으면 캡처하지 않는다', async () => {
    const spec = { REQUIRED_SMOKE_SURFACES: [SURF], RASTER_CONTRACT: R200, LIGHT_DIFF_MASKS: SPEC_R.LIGHT_DIFF_MASKS };
    // localStorage는 바뀌지만 문서에 반영되지 않는 상황(다크로 남은 브라우저)
    const d = mkDriver({ model: MODEL, storage: { theme: 'dark' }, clickAdds: { '.Toggle': ['.Pill--on'] }, dataTheme: 'dark' });
    const r = await RUN.runCapture({ spec, rawContext: CTXIN, driver: d, selectors: SELS, phase: 'light' });
    expect(r.errors.join()).toMatch(/RUN_THEME_NOT_APPLIED data-theme=dark != light/);
  });
  it('RED: 캡처 직전에 테마가 되돌아가면 잡는다', async () => {
    // runSurface는 캡처 직전에 테마를 한 번 재확인한다 — 그 시점에 되돌아가 있는 상황.
    const d = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] },
      evaluate: (src) => (src === PROBE.THEME_PROBE_SOURCE ? { dataTheme: 'dark', stored: 'light' } : undefined) });
    const r = await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' });
    expect(r.errors.join()).toMatch(/RUN_THEME_MISMATCH r-a data-theme=dark != light/);
  });
  it('RED: 캡처 직전에 상태가 사라지면 잡는다(액션 직후만 보면 놓친다)', async () => {
    // click 직후엔 있지만 캡처 직전엔 사라지는 상태.
    // .Pill--on 조회 순서: (1) 전이 사전 0건 → (2) 액션 직후 1건 → (3) 캡처 직전 재단정.
    const surface = { ...SURF, actions: SURF.actions.slice(0, 3) };   // 뒤의 expectPresent 제거
    let seen = 0;
    const d = mkDriver({ model: MODEL, storage: { theme: 'light' }, clickAdds: { '.Toggle': ['.Pill--on'] },
      evaluate: (src, arg) => {
        if (src !== PROBE.ASSERT_SOURCE || !arg.includes('.Pill--on')) return undefined;
        seen += 1;
        if (seen === 1) return { '.Pill--on': { count: 0, visible: 0 } };
        if (seen === 2) return { '.Pill--on': { count: 1, visible: 1 } };
        return { '.Pill--on': { count: 1, visible: 0 } };
      } });
    const r = await RUN.runSurface({ surface, rawContext: CTXIN, driver: d, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' });
    expect(r.errors.join()).toMatch(/RUN_STATE_LOST r-a \.Pill--on visible=0/);
  });
  it('RED: 정착 검사를 못 하는 driver는 캡처 자격이 없다(선택 아님)', async () => {
    const d = good(); delete d.sleep;
    const r = await RUN.runSurface({ surface: SURF, rawContext: CTXIN, driver: d, selectors: SELS, raster: R200, spec: SPEC_R, phase: 'light' });
    expect(r.errors.join()).toMatch(/RUN_DRIVER_NO_SLEEP/);
  });
  it('실행기 전체 바이트가 fingerprint 입력이다', () => {
    const realSha = (v) => createHash('sha256').update(v).digest('hex');
    const base = EV.specFingerprint(SPEC, realSha);
    const tampered = EV.specFingerprint(SPEC,
      (v) => (Buffer.isBuffer(v) && v.equals(RUN.RUNNER_MODULE_BYTES) ? 'TAMPERED_RUNNER' : realSha(v)));
    expect(tampered).not.toBe(base);
    expect(RUN.RUNNER_MODULE_BYTES.equals(readFileSync(RUN.RUNNER_MODULE_PATH))).toBe(true);
  });
  it('지원 op는 정확히 manifest가 쓰는 7개다', () => {
    expect(Object.keys(RUN.OP_SCHEMA).sort())
      .toEqual(['click', 'expectAbsent', 'expectPresent', 'goto', 'hover', 'setStorage', 'waitFor']);
    const used = new Set();
    for (const x of SPEC.REQUIRED_SMOKE_SURFACES) for (const a of x.actions) used.add(a.op);
    for (const op of used) expect(RUN.OP_SCHEMA[op]).toBeDefined();     // manifest가 쓰는 op는 전부 지원
  });
});

describe('S4 캡처 산출물 — phase 분리·exact set·atomic 교체', () => {
  const PNG_A = () => s4Png(4, 4, [1, 2, 3]);
  const PNG_B = () => s4Png(4, 4, [9, 9, 9]);
  it('phase마다 다른 context 파일·디렉터리를 쓴다(덮어쓰기 불가)', () => {
    expect(RUN.CANDIDATE_BUNDLE_DIR('light')).not.toBe(RUN.CANDIDATE_BUNDLE_DIR('dark'));
    expect(RUN.COMMITTED_SHOTS_DIR('light')).toBe('base');
    expect(RUN.COMMITTED_SHOTS_DIR('dark')).toBe('dark-review');
  });
  it('GREEN: light와 dark를 연달아 써도 서로를 덮지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 's4-cand-'));
    try {
      for (const [phase, png] of [['light', PNG_A()], ['dark', PNG_B()]])
        expect(RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: dir, phase, contextRaw: `{"phase":"${phase}"}`,
          pngByCaptureName: { 'a.png': png }, expectedCaptureNames: ['a.png'] })).toEqual([]);
      expect(JSON.parse(RUN.readCandidateBundle(dir, 'light').contextRaw).phase).toBe('light');
      expect(JSON.parse(RUN.readCandidateBundle(dir, 'dark').contextRaw).phase).toBe('dark');
      expect(RUN.readCandidateBundle(dir, 'light').pngByName['a.png'].equals(PNG_A())).toBe(true);
      expect(RUN.readCandidateBundle(dir, 'dark').pngByName['a.png'].equals(PNG_B())).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('RED: 파일명 집합이 기대와 다르면 아무것도 쓰지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 's4-cand-'));
    try {
      const e = RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: dir, phase: 'light', contextRaw: '{}',
        pngByCaptureName: { 'a.png': PNG_A() }, expectedCaptureNames: ['a.png', 'b.png'] });
      expect(e.join()).toMatch(/WRITE_CAPTURE_SET_MISMATCH .*missing=\[b\.png\]/);
      expect(existsSync(join(dir, 's4-shots', RUN.CANDIDATE_BUNDLE_DIR('light')))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('잔존 파일이 살아남지 않는다 — 디렉터리를 통째로 교체한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 's4-cand-'));
    try {
      RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: dir, phase: 'light', contextRaw: '{}',
        pngByCaptureName: { 'a.png': PNG_A(), 'stale.png': PNG_A() }, expectedCaptureNames: ['a.png', 'stale.png'] });
      RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: dir, phase: 'light', contextRaw: '{}',
        pngByCaptureName: { 'a.png': PNG_A() }, expectedCaptureNames: ['a.png'] });
      expect(Object.keys(RUN.readCandidateBundle(dir, 'light').pngByName)).toEqual(['a.png']);   // stale.png가 사라졌다
      // bundle에는 context.json이 함께 들어 있다 — PNG 집합만 본다.
      // bundle 디렉터리에는 content.json이 함께 들어 있다 — pointer를 따라 읽어 PNG만 본다.
      const rb = RUN.readCandidateBundle(dir, 'light');
      expect(rb.errors).toEqual([]);
      expect(Object.keys(rb.pngByName).sort()).toEqual(['a.png']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('RED: 승인 경로는 BASE context가 light phase임을 요구한다', () => {
    const errs = EV.validateCommittedArtifacts({
      committedFixtureRaw: JSON.stringify(unitFixture()), spec: UNIT_SPEC,
      contextRaw: JSON.stringify({ ...unitCtx(), phase: 'dark' }),
      sha256: (v) => createHash('sha256').update(v).digest('hex'), readPng: () => s4Png(4, 4, [0, 0, 0]),
    });
    expect(errs.join(' | ')).toMatch(/BASE_CONTEXT_PHASE dark != light/);
  });
});

// ── committed release bundle reader ─────────────────────────────────────────
// legacy `s4-smoke-context.json` / `s4-shots/base/` 직접 읽기를 대체한다.
// 정본은 **release pointer가 가리키는 불변 버전 디렉터리**다. 승격 전에는 release가 없고,
// 그 사실 자체가 계약이다 — 없는데 legacy 파일로 대신 통과시키면 게이트가 거짓말을 한다.
const FIXTURES_DIR = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const committedRelease = () => PROM.readRelease(FIXTURES_DIR);
// **상태는 세 갈래다.** `!!readRelease(...)`는 "없음"과 "깨짐"을 똑같이 false로 만들어
// malformed JSON·schema drift·symlink를 전부 조용히 skip시켰다(실증). 판정은 정본 함수가 한다.
const RELEASE_STATE = PROM.releaseGateState(PROM.readReleaseChecked(FIXTURES_DIR));
const HAS_RELEASE = RELEASE_STATE.mode === 'run';
const committedBundleAt = (dir, phase = 'light') => {
  const rel = PROM.readRelease(dir);
  if (!rel) return { absent: true, reason: 'NO_RELEASE' };
  const b = PROM.readCaptureBundle(dir, phase);
  if (b.errors.length) return { absent: true, reason: b.errors.join(' ') };
  // expected는 **release.expectedSha 경로**에서 읽고 SHA exact를 확인한다.
  const exp = PROM.readCommittedExpected(dir);
  if (exp.errors.length) return { absent: true, reason: exp.errors.join(' ') };
  return { absent: false, contextRaw: b.contextRaw, pngByName: b.pngByName,
    readPng: (n) => b.pngByName[n], fixtureRaw: exp.bytes };
};
const committedBundle = (phase = 'light') => committedBundleAt(FIXTURES_DIR, phase);

// ── privacy audit 부착 명령 ─────────────────────────────────────────────────
// **production topology를 그대로 만든다**: fixturesDir가 repoDir **안**이고,
// `__fixtures__/.gitignore`도 운영과 같은 바이트다. 서로 다른 temp root를 쓰면
// "승격이 자기 산출물로 스스로 dirty가 된다"는 실제 경로가 테스트에서 사라진다
// (실증: 그 topology에서 첫 승격이 PROMOTE_AUTHORITY_FAILED_LATE WORKTREE_DIRTY 5로 죽었다).
const FX_REL = 'frontend/library/__fixtures__';
const REPO_FILES = [...new Set([...CAP.HASHED_MODULES, ...CAP.GENERATOR_HASHED_MODULES])];
const tinyRepo = ({ fixturesSymlinkTo = null } = {}) => {
  const r = mkdtempSync(join(tmpdir(), 's4-repo-'));
  for (const rel of REPO_FILES) {
    mkdirSync(join(r, rel.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(join(r, rel), `// ${rel}\n`);
  }
  const fx = join(r, FX_REL);
  // fixturesSymlinkTo: canonical __fixtures__ 자리를 **밖을 가리키는 symlink**로 만든다.
  if (fixturesSymlinkTo) symlinkSync(fixturesSymlinkTo, fx);
  else mkdirSync(fx, { recursive: true });
  writeFileSync(join(fx, '.gitignore'),
    readFileSync(fileURLToPath(new URL('./__fixtures__/.gitignore', import.meta.url)), 'utf8'));
  execSync(`git -C ${r} init -q && git -C ${r} add -A && ` +
    `git -C ${r} -c user.email=t@t -c user.name=t commit -q -m x`, { stdio: 'ignore' });
  const head = execSync(`git -C ${r} rev-parse HEAD`, { encoding: 'utf8' }).trim();
  const blobs = Object.fromEntries(CAP.HASHED_MODULES.map((rel) => [rel,
    execSync(`git -C ${r} rev-parse HEAD:${rel}`, { encoding: 'utf8' }).trim()]));
  return { dir: r, head, blobs, fixturesDir: fx };
};
const dirtyOf = (repo) => PROM.worktreeDirtyEntries(repo.dir);

describe('S4 audit-candidate — 실제 바이트에서 계산하고 새 bundle을 발행한다', () => {
  const NAMES = () => SPEC.REQUIRED_SMOKE_SURFACES.map((x) => x.captureName);
  // **검토 대상 결속**: review는 자기가 무엇을 봤는지(phase·bundleName·context hash·PNG sha)
  // 스스로 말하고, 그 넷이 지금 candidate의 실제 바이트와 exact여야 한다.
  const BOUND = (over = {}) => ({ phase: 'light', bundleName: 'bundle-light-x',
    contextSubjectSha256: 'ctxsha',
    shaByName: Object.fromEntries(NAMES().map((n) => [n, `sha-${n}`])), ...over });
  const review = (over = {}, b = BOUND()) => ({ scope: AUDIT.AUDIT_SCOPE,
    phase: b.phase, bundleName: b.bundleName, contextSubjectSha256: b.contextSubjectSha256,
    captures: NAMES().map((n) => ({ captureName: n, sha256: b.shaByName[n], pass: true, findings: [] })), ...over });

  it('CLI 문법 — --phase/--review 정확히 두 쌍', () => {
    expect(AUDIT.parseAuditArgs(['--phase', 'light', '--review', 'r.json'])).toEqual({ phase: 'light', reviewPath: 'r.json' });
    for (const bad of [[], ['--phase', 'light'], ['--phase', 'sepia', '--review', 'r'], ['-p', 'light', '--review', 'r']])
      expect(AUDIT.parseAuditArgs(bad).error, JSON.stringify(bad)).toBeTruthy();
  });

  it('검토 결과는 exact 23개여야 한다', () => {
    expect(AUDIT.validateReview(review(), NAMES(), BOUND())).toEqual([]);
    const short = review(); short.captures.pop();
    expect(AUDIT.validateReview(short, NAMES(), BOUND()).join(' ')).toMatch(/REVIEW_CAPTURE_SET missing=/);
    const extra = review(); extra.captures.push({ captureName: 'ghost.png', sha256: 'x', pass: true, findings: [] });
    expect(AUDIT.validateReview(extra, NAMES(), BOUND()).join(' ')).toMatch(/REVIEW_CAPTURE_SET .*extra=\[ghost.png\]/);
    const dup = review(); dup.captures[1] = { ...dup.captures[0] };
    expect(AUDIT.validateReview(dup, NAMES(), BOUND()).join(' ')).toMatch(/REVIEW_CAPTURE_SET|REVIEW_CAPTURE_DUPLICATE/);
  });

  it('RED: pass:false / pass와 findings 모순 / scope 오류 / 여분 키', () => {
    const f = review(); f.captures[0].pass = false;
    expect(AUDIT.validateReview(f, NAMES(), BOUND()).join(' ')).toMatch(/REVIEW_NOT_PASSED/);
    const c = review(); c.captures[0].findings = ['face visible'];
    expect(AUDIT.validateReview(c, NAMES(), BOUND()).join(' ')).toMatch(/REVIEW_PASS_WITH_FINDINGS/);
    expect(AUDIT.validateReview(review({ scope: 'wrong' }), NAMES(), BOUND()).join(' ')).toMatch(/REVIEW_SCOPE/);
    expect(AUDIT.validateReview(review({ note: 'x' }), NAMES(), BOUND()).join(' ')).toMatch(/REVIEW_KEYS/);
    const ek = review(); ek.captures[0] = { ...ek.captures[0], extra: 1 };
    expect(AUDIT.validateReview(ek, NAMES(), BOUND()).join(' ')).toMatch(/REVIEW_ENTRY_KEYS/);
    expect(AUDIT.validateReview(null, NAMES(), BOUND())).toEqual(['REVIEW_SHAPE']);
  });

  it('RED: 검토 대상이 다르면(phase·bundle·context·PNG) 전부 잡힌다', () => {
    const b = BOUND();
    expect(AUDIT.validateReview(review({}, BOUND({ phase: 'dark' })), NAMES(), b).join(' '))
      .toMatch(/REVIEW_PHASE dark != light/);
    expect(AUDIT.validateReview(review({}, BOUND({ bundleName: 'bundle-light-OTHER' })), NAMES(), b).join(' '))
      .toMatch(/REVIEW_BUNDLE bundle-light-OTHER != bundle-light-x/);
    expect(AUDIT.validateReview(review({}, BOUND({ contextSubjectSha256: 'stale' })), NAMES(), b).join(' '))
      .toMatch(/REVIEW_CONTEXT_SUBJECT stale != ctxsha/);
    const png = review(); png.captures[3].sha256 = 'drifted';
    expect(AUDIT.validateReview(png, NAMES(), b).join(' ')).toMatch(/REVIEW_CAPTURE_SHA .* drifted != /);
  });

  it('SHA는 입력이 아니라 실제 PNG 바이트에서 계산한다', () => {
    const src = readFileSync(new URL('../scripts/s4-audit-candidate.mjs', import.meta.url), 'utf8');
    expect(src).toContain('shaByName[n] = sha256(bytes)');
    expect(src).toContain('CANON.canonicalize(subject)');
    // in-place 수정이 아니라 새 bundle 발행 + pointer CAS로 잠근다
    expect(src).toContain('writeCandidate({ fixturesDir, phase: cli.phase');
    expect(src).toContain('expectedCurrentBundleName: d.expectedCurrentBundleName');
    expect(src).toContain('expectedCurrentBundleName: candidate.bundleName');
    expect(src).not.toContain('CANDIDATE_CAS_ANY');
    expect(src).not.toMatch(/writeFileSync\([^)]*content\.json/);
    // capture authority 목록에 든다
    expect(CAP.HASHED_MODULES).toContain('frontend/scripts/s4-audit-candidate.mjs');
    // CLI 진입점은 argv만 넘긴다 — 실행 파일이 다른 루트를 가리키게 만들 수 없다.
    expect(src).toContain('main(process.argv.slice(2)).then');
    expect(src).not.toMatch(/main\(process\.argv[^)]*\),\s*\{/);
  });

  it('audit 부재는 승격에서 RED', () => {
    expect(EV.validatePrivacyAudit(undefined, { captures: [], contextSubjectSha256: 'x' }).length).toBeGreaterThan(0);
  });

  // ── auditDecision 행동 테스트 (순수 코어 · 파일을 쓰지 않는다) ───────────────
  // main은 운영 루트에 고정돼 있으므로 임시 topology로 돌릴 수 없다. 판정을 순수 코어로
  // 빼서 축별로 직접 돌린다 — "그래서 write 0인가"는 코어가 errors를 내면 main이
  // writeCandidate까지 가지 않는다는 소스 순서와 함께 성립한다.
  const A_SHA = (v) => createHash('sha256').update(v).digest('hex');
  const aFacts = (phase = 'light') => {
    const repo = tinyRepo();
    const fp = EV.specFingerprint(EV.snapshotSpec(SPEC).spec, A_SHA);
    const pngs = Object.fromEntries(NAMES().map((n, i) => [n, pngBytes(4, 3, i + 1)]));
    const subject = { phase, provenance: { headCommit: repo.head, blobs: repo.blobs, specFingerprint: fp } };
    const contextRaw = JSON.stringify(subject, null, 1);
    const bundleName = `bundle-${phase}-${RUN.bundleContentHash(contextRaw, pngs)}`;
    const rv = { scope: AUDIT.AUDIT_SCOPE, phase, bundleName,
      contextSubjectSha256: A_SHA(JSON.stringify(CANON.canonicalize(subject))),
      captures: NAMES().map((n) => ({ captureName: n, sha256: A_SHA(pngs[n]), pass: true, findings: [] })) };
    return { repo, pngs, subject, contextRaw, bundleName, review: rv, fp,
      candidate: { bundleName, contextRaw, pngByName: pngs },
      head: { errors: [], headCommit: repo.head, blobs: repo.blobs } };
  };
  const decide = (f, over = {}) => AUDIT.auditDecision({ phase: f.subject.phase, dirtyEntries: [],
    head: f.head, fingerprintNow: f.fp, candidate: f.candidate, review: f.review,
    captureNames: NAMES(), sha256: A_SHA, ...over });

  it('GREEN: 일치하는 review만 새 audit을 만든다', () => {
    const f = aFacts();
    try {
      const d = decide(f);
      expect(d.errors).toEqual([]);
      expect(d.privacyAudit.scope).toBe(AUDIT.AUDIT_SCOPE);
      expect(d.privacyAudit.captures).toHaveLength(NAMES().length);
      expect(d.expectedCurrentBundleName).toBe(f.bundleName);     // pointer CAS 기대값
      // 새 context는 원본 subject + audit이고, 원본 bundle 이름과 다르다(불변 발행).
      const ctx = JSON.parse(d.nextContextRaw);
      expect(ctx.phase).toBe('light');
      expect(RUN.bundleContentHash(d.nextContextRaw, f.pngs)).not.toBe(RUN.bundleContentHash(f.contextRaw, f.pngs));
    } finally { rmSync(f.repo.dir, { recursive: true, force: true }); }
  }, 30000);

  it('RED: light review를 dark에 쓰면 판정 거부', () => {
    const fl = aFacts('light'); const fd = aFacts('dark');
    try {
      const d = AUDIT.auditDecision({ phase: 'dark', dirtyEntries: [], head: fd.head,
        fingerprintNow: fd.fp, candidate: fd.candidate, review: fl.review,
        captureNames: NAMES(), sha256: A_SHA });
      expect(d.nextContextRaw).toBe(null);
      expect(d.errors.join(' ')).toMatch(/REVIEW_PHASE light != dark/);
      expect(d.errors.join(' ')).toMatch(/REVIEW_BUNDLE/);
    } finally { rmSync(fl.repo.dir, { recursive: true, force: true }); rmSync(fd.repo.dir, { recursive: true, force: true }); }
  }, 30000);

  it('RED: dirty/staged/untracked·HEAD 결속 실패·provenance·phase·stale bundle 전부 거부', () => {
    const f = aFacts();
    try {
      const cases = {
        untracked: { dirtyEntries: ['?? frontend/library/X.txt'] },
        staged: { dirtyEntries: ['A  frontend/library/Y.txt'] },
        modified: { dirtyEntries: [' M frontend/library/s4Spec.mjs'] },
        'head-binding': { head: { errors: ['WORKING_DIFFERS_FROM_HEAD frontend/library/s4Spec.mjs a != b'] } },
        'provenance-head': { head: { errors: [], headCommit: 'f'.repeat(40), blobs: f.repo.blobs } },
        'provenance-blobs': { head: { errors: [], headCommit: f.repo.head, blobs: { x: 'y' } } },
        fingerprint: { fingerprintNow: 'drifted' },
        phase: { phase: 'dark' },
        'stale-bundle': { candidate: { ...f.candidate, bundleName: 'bundle-light-OTHER' } },
      };
      const seen = {};
      for (const [label, over] of Object.entries(cases)) {
        const d = decide(f, over);
        expect(d.nextContextRaw, label).toBe(null);
        expect(d.privacyAudit, label).toBe(null);
        expect(d.errors.length, label).toBeGreaterThan(0);
        seen[label] = d.errors[0];
      }
      expect(seen.untracked).toMatch(/REPO_DIRTY/);
      expect(seen.staged).toMatch(/REPO_DIRTY/);
      expect(seen['head-binding']).toBe('HEAD_BINDING_FAILED');
      expect(seen['provenance-head']).toBe('CANDIDATE_PROVENANCE_MISMATCH');
      expect(seen.fingerprint).toBe('CANDIDATE_PROVENANCE_MISMATCH');
      expect(seen.phase).toMatch(/CANDIDATE_PHASE_MISMATCH light != dark/);
      expect(seen['stale-bundle']).toBe('REVIEW_INVALID');
    } finally { rmSync(f.repo.dir, { recursive: true, force: true }); }
  }, 30000);

  it('main은 authority 루트를 주입받지 않는다 — fake clean repoDir로도 write 0', async () => {
    // 운영 루트는 모듈 상수 하나뿐이다. 인자를 넣어도 무시되고, 실제 repo/fixtures가 쓰인다.
    const fake = tinyRepo();
    const out = [];
    try {
      const src = readFileSync(new URL('../scripts/s4-audit-candidate.mjs', import.meta.url), 'utf8');
      const sig = src.slice(src.indexOf('export async function main'), src.indexOf('{', src.indexOf('export async function main')));
      for (const banned of ['repoDir', 'fixturesDir']) expect(sig, banned).not.toContain(banned);
      expect(src).toContain('const repoDir = REPO_DIR;');
      expect(src).toContain('const fixturesDir = FIXTURES_DIR;');
      // 실제로 불러도 fake 루트가 쓰이지 않는다.
      const code = await AUDIT.main(['--phase', 'light', '--review', join(fake.dir, 'nope.json')],
        { log: (m) => out.push(m), err: (m) => out.push(m), repoDir: fake.dir, fixturesDir: fake.fixturesDir });
      expect(code).toBe(1);
      // fake 루트에는 아무것도 쓰지 않았고, 운영 fixtures에도 candidate가 생기지 않았다.
      expect(existsSync(join(fake.fixturesDir, 's4-candidates'))).toBe(false);
      expect(existsSync(join(AUDIT.FIXTURES_DIR, 's4-candidates'))).toBe(false);
    } finally { rmSync(fake.dir, { recursive: true, force: true }); }
  }, 30000);

  it('main은 코어가 거부하면 writeCandidate까지 가지 않는다 (소스 순서)', () => {
    const src = readFileSync(new URL('../scripts/s4-audit-candidate.mjs', import.meta.url), 'utf8');
    const m = src.slice(src.indexOf('export async function main'));
    expect(m.indexOf('auditDecision({')).toBeLessThan(m.indexOf('writeCandidate({'));
    expect(m.indexOf('AUDIT_REJECTED')).toBeLessThan(m.indexOf('writeCandidate({'));
    // 코어는 파일을 만지지 않는다.
    const core = src.slice(src.indexOf('export function auditDecision'), src.indexOf('export async function main'));
    for (const banned of ['writeFileSync', 'readFileSync', 'execSync', 'mkdirSync', 'rmSync'])
      expect(core, banned).not.toContain(banned);
  });

  it('RED: pointer CAS — lock 안에서 확인하므로 외부 사전 check로 대체되지 않는다', () => {
    const repo = tinyRepo(); const d = repo.fixturesDir;
    try {
      const p1 = pngBytes(2, 2, 5);
      expect(RUN.writeCandidate({ fixturesDir: d, phase: 'light', contextRaw: '{"x":0}',
        pngByCaptureName: { 'a.png': p1 }, expectedCaptureNames: ['a.png'],
        expectedCurrentBundleName: null })).toEqual([]);
      const cur = RUN.readCandidateBundle(d, 'light').bundleName;
      // 다른 값을 기대하면 발행되지 않는다.
      const e = RUN.writeCandidate({ fixturesDir: d, phase: 'light', contextRaw: '{"x":1}',
        pngByCaptureName: { 'a.png': pngBytes(2, 2, 7) }, expectedCaptureNames: ['a.png'],
        expectedCurrentBundleName: 'bundle-light-STALE' });
      expect(e.join(' ')).toMatch(/WRITE_POINTER_CAS .* != bundle-light-STALE/);
      expect(RUN.readCandidateBundle(d, 'light').bundleName).toBe(cur);
      // pointer가 이미 있는데 null(최초 발행)을 기대해도 막힌다.
      const e2 = RUN.writeCandidate({ fixturesDir: d, phase: 'light', contextRaw: '{"x":2}',
        pngByCaptureName: { 'a.png': pngBytes(2, 2, 8) }, expectedCaptureNames: ['a.png'],
        expectedCurrentBundleName: null });
      expect(e2.join(' ')).toMatch(/WRITE_POINTER_CAS/);
      // 기대값 자체를 빠뜨리면 fail-closed다 — 기본값이 곧 우회로이므로 기본값을 두지 않는다.
      const e3 = RUN.writeCandidate({ fixturesDir: d, phase: 'light', contextRaw: '{"x":3}',
        pngByCaptureName: { 'a.png': pngBytes(2, 2, 9) }, expectedCaptureNames: ['a.png'] });
      expect(e3).toEqual(['WRITE_CAS_EXPECTATION_REQUIRED']);
      // CAS 비교는 **lock 안, rename 직전**에 있다.
      const rsrc = readFileSync(new URL('./s4CaptureRunner.mjs', import.meta.url), 'utf8');
      const fn = rsrc.slice(rsrc.indexOf('export function writeCandidate'));
      expect(fn.indexOf('lockStillOurs()')).toBeLessThan(fn.indexOf('WRITE_POINTER_CAS'));
      expect(fn.indexOf('WRITE_POINTER_CAS')).toBeLessThan(fn.indexOf('renameSync(ptmp, pointer)'));
    } finally { rmSync(repo.dir, { recursive: true, force: true }); }
  }, 30000);
});

// ── s4-gen은 committed를 쓰지 않는다 ────────────────────────────────────────
describe('S4 generator — committed를 바꾸지 못한다', () => {
  it('--promote 인자는 파서 단계에서 거부된다', () => {
    expect(PROM.parseCliArgs(['--promote', 'a'.repeat(64), '--from', 'b'.repeat(64)]).error)
      .toMatch(/PROMOTE_MODE_REMOVED/);
  });
  it('generator 소스에 committed write 어휘가 없다', () => {
    const src = readFileSync(new URL('../scripts/s4-gen.mjs', import.meta.url), 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const banned of ['promoteStaged', 'stageBytes', 'promoteRelease', 's4-expected.json', '--promote'])
      expect(code, banned).not.toContain(banned);
  });
  it('공식 sink는 s4-promote-capture 하나다', () => {
    const repo = fileURLToPath(new URL('../..', import.meta.url));
    const hits = execSync(`grep -rln "promoteRelease(" ${join(repo, 'frontend/scripts')} ${join(repo, 'frontend/library')} || true`,
      { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map((p) => p.slice(p.indexOf('frontend/')))
      .filter((p) => !p.endsWith('.test.js'));                    // 테스트는 sink가 아니다
    expect(hits.sort()).toEqual(['frontend/library/s4Promote.mjs', 'frontend/scripts/s4-promote-capture.mjs']);
  });
});

// 실제 BASE 3파일을 컴파일해 선언을 얻는다. **두 곳(committed gate·positive baseline)이
// 같은 것을 쓴다** — baseDecls=[] 로는 canonical/dup 검사가 공허하다.
let BASE_DECLS_MEMO = null;
const sharedBaseDecls = () => {
  if (BASE_DECLS_MEMO) return BASE_DECLS_MEMO;
  const out = [];
  for (const k of Object.keys(SPEC.FILES)) {
    const rel = SPEC.FILES[k].rel;
    const src = execSync(`git -C ${REPO} show ${SPEC.BASE}:frontend/${rel}`, { encoding: 'utf8' });
    const css = compileString(src, { syntax: 'scss', url: pathToFileURL(resolve(__dirname, '..', rel)),
      loadPaths: [resolve(__dirname, '../styles')] }).css;
    out.push(...EV.collectDeclarations(postcss.parse(css), rel));
  }
  BASE_DECLS_MEMO = out;
  return out;
};

// ── authority 정본: 모듈 목록 단일화 + 실제 pinned blobs 대조 ─────────────────
describe('S4 promotion authority — 목록 정본화와 pinned blob 실대조', () => {
  it('capture/audit/promotion이 같은 목록 객체를 본다', () => {
    // 재수출이므로 **같은 객체**여야 한다. 복사본이면 한쪽만 바뀌는 드리프트가 가능해진다.
    expect(CAP.HASHED_MODULES).toBe(PROM.HASHED_MODULES);
    expect(CAP.DISCOVERY_HASHED_MODULES).toBe(PROM.DISCOVERY_HASHED_MODULES);
    expect(CAP.GENERATOR_HASHED_MODULES).toBe(PROM.GENERATOR_HASHED_MODULES);
    expect(PROM.HASHED_MODULES).toHaveLength(12);
    expect(PROM.DISCOVERY_HASHED_MODULES).toEqual([...SPEC.PROVENANCE_BLOB_PATHS]);
    // 목록이 얼어 있다 — 밖에서 push로 줄이거나 늘릴 수 없다.
    expect(Object.isFrozen(PROM.HASHED_MODULES)).toBe(true);
    expect(() => { PROM.HASHED_MODULES.push('x'); }).toThrow();
    // 스크립트가 자기 목록을 다시 정의하지 않는다.
    const csrc = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    expect(csrc).not.toContain('export const HASHED_MODULES = [');
    expect(csrc).not.toContain('export const DISCOVERY_HASHED_MODULES = [');
  });

  it('GREEN/RED: pinned blobs를 실제로 대조한다 (자기비교가 아니다)', () => {
    const repo = tinyRepo();
    try {
      // 대조군: 지금 repo 상태 = pinned → ok
      expect(PROM.promotionAuthority(repo.dir, repo.head, repo.blobs, null))
        .toEqual({ ok: true, errors: [] });
      // 한 파일의 pinned 값만 다르게 주면 **그 경로가 지목돼** RED가 된다.
      const bad = { ...repo.blobs, 'frontend/library/s4Spec.mjs': 'f'.repeat(40) };
      const r = PROM.promotionAuthority(repo.dir, repo.head, bad, null);
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/BLOBS_DIFFER frontend\/library\/s4Spec\.mjs/);
      // pinned에만 있는 경로도 잡는다.
      const extra = { ...repo.blobs, 'frontend/library/GHOST.mjs': 'a'.repeat(40) };
      expect(PROM.promotionAuthority(repo.dir, repo.head, extra, null).errors.join(' '))
        .toMatch(/BLOBS_EXTRA_PINNED frontend\/library\/GHOST\.mjs/);
      // HEAD 이동도 본다.
      expect(PROM.promotionAuthority(repo.dir, 'c'.repeat(40), repo.blobs, null).errors.join(' '))
        .toMatch(/HEAD_MOVED/);
      // 자기비교 코드가 남아 있지 않다(주석은 그 결함을 설명하므로 코드에서만 찾는다).
      const src = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
      const code = src.split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
      expect(code).not.toContain('startHead && h.blobs');
    } finally { rmSync(repo.dir, { recursive: true, force: true }); }
  }, 30000);

  it('allowance 없이는 어떤 dirty도 허용되지 않는다', () => {
    const repo = tinyRepo();
    try {
      writeFileSync(join(repo.dir, 'frontend/library/Z.txt'), 'z');
      const r = PROM.promotionAuthority(repo.dir, repo.head, repo.blobs, null);
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/WORKTREE_DIRTY 1: \?\? frontend\/library\/Z\.txt/);
    } finally { rmSync(repo.dir, { recursive: true, force: true }); }
  }, 30000);
});

// ── F5: committed release 상태 판정 · F7: generator authority ────────────────
describe('S4 release 상태 fail-closed — 깨진 release는 skip이 아니다', () => {
  const mk = () => { const d = mkdtempSync(join(tmpdir(), 's4-rel-'));
    mkdirSync(join(d, 's4-capture'), { recursive: true }); return d; };
  const put = (d, body) => writeFileSync(join(d, 's4-capture', 'release.json'), body);
  const state = (d) => PROM.releaseGateState(PROM.readReleaseChecked(d));

  it('absent만 skip이다', () => {
    const d = mk();
    try { expect(state(d)).toEqual({ mode: 'skip', errors: [] }); }
    finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('정상 release는 run이다', () => {
    const d = mk();
    try {
      put(d, JSON.stringify({ light: 'a'.repeat(64), dark: 'b'.repeat(64), expectedSha: 'c'.repeat(64) }));
      expect(state(d)).toEqual({ mode: 'run', errors: [] });
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it.each([
    ['malformed JSON', (d) => put(d, '{ not json'), /RELEASE_UNPARSEABLE/],
    ['schema drift(키 누락)', (d) => put(d, JSON.stringify({ light: 'a'.repeat(64), dark: 'b'.repeat(64) })), /RELEASE_KEYS/],
    ['schema drift(비-hex)', (d) => put(d, JSON.stringify({ light: 'zz', dark: 'yy', expectedSha: 'xx' })), /RELEASE_VALUE/],
    ['배열', (d) => put(d, '[]'), /RELEASE_SHAPE|RELEASE_KEYS/],
  ])('RED: %s는 fail이다 (skip 아님)', (_n, mutate, rx) => {
    const d = mk();
    try {
      mutate(d);
      const st = state(d);
      expect(st.mode).toBe('fail');
      expect(st.errors.join(' ')).toMatch(rx);
      // 이전 판의 판정식은 여기서 조용히 false(=skip)가 됐다.
      expect(!!PROM.readRelease(d)).toBe(false);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('RED: release.json이 외부 symlink여도 fail이다', () => {
    const d = mk(); const outside = mkdtempSync(join(tmpdir(), 's4-out-'));
    try {
      const ext = join(outside, 'release.json');
      writeFileSync(ext, JSON.stringify({ light: 'a'.repeat(64), dark: 'b'.repeat(64), expectedSha: 'c'.repeat(64) }));
      symlinkSync(ext, join(d, 's4-capture', 'release.json'));
      const st = state(d);
      expect(st.mode).toBe('fail');
      expect(st.errors.join(' ')).toMatch(/RELEASE_NODE_SYMLINK|RELEASE_NODE_ESCAPES/);
    } finally { rmSync(d, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
  });

  it('게이트가 light·dark 모두 validateCaptureBundle 전체를 부른다', () => {
    const src = readFileSync(new URL('./themeTokens.test.js', import.meta.url), 'utf8');
    const blk = src.slice(src.indexOf("describe('S4 커밋 산출물 게이트"));
    const gate = blk.slice(0, blk.indexOf('\ndescribe('));
    expect(gate).toContain('EV.validateCaptureBundle({');
    expect(gate).toContain("for (const ph of ['light', 'dark']) expect(runBundle(ph), ph).toEqual([])");
    // light 전용 fixture/mask/BASE 결속은 validateCommittedArtifacts에 남아 있다.
    expect(gate).toContain('EV.validateCommittedArtifacts({');
    expect(gate).toContain("const BUNDLE = () => committedBundle('light')");
  });

  it('게이트가 이 판정 함수를 실제로 쓴다', () => {
    const src = readFileSync(new URL('./themeTokens.test.js', import.meta.url), 'utf8');
    expect(src).toContain('PROM.releaseGateState(PROM.readReleaseChecked(FIXTURES_DIR))');
    expect(src).toContain("const HAS_RELEASE = RELEASE_STATE.mode === 'run'");
    // 금지 문자열은 **조립해서** 만든다 — 리터럴로 적으면 이 단정문 자체가 걸린다.
    expect(src).not.toContain(`const HAS_RELEASE = !${'!'}PROM.readRelease`);
  });
});

describe('S4 generator authority — 시작 commit 고정', () => {
  it('GREEN: 시작 commit 그대로면 ok', () => {
    const repo = tinyRepo();
    try { expect(PROM.generatorAuthority(repo.dir, repo.head)).toEqual({ ok: true, errors: [] }); }
    finally { rmSync(repo.dir, { recursive: true, force: true }); }
  }, 30000);

  it('RED: clean A → clean B checkout이면 write 0 (HEAD_MOVED)', () => {
    const repo = tinyRepo();
    const ex = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      const A = repo.head;
      writeFileSync(join(repo.dir, 'frontend/library/s4Spec.mjs'), '// B\n');
      ex(`git -C ${repo.dir} add -A && git -C ${repo.dir} -c user.email=t@t -c user.name=t commit -q -m B`);
      const B = ex(`git -C ${repo.dir} rev-parse HEAD`).trim();
      expect(B).not.toBe(A);
      // 워킹트리는 여전히 clean이다 — 이전 판의 게이트는 이것만 봤다.
      expect(PROM.worktreeDirtyEntries(repo.dir)).toEqual([]);
      const a = PROM.generatorAuthority(repo.dir, A);
      expect(a.ok).toBe(false);
      expect(a.errors.join(' ')).toMatch(new RegExp(`HEAD_MOVED ${A} -> ${B}`));
      // 시작 commit 기준 blob 드리프트도 함께 지목된다.
      expect(a.errors.join(' ')).toMatch(/GENERATOR_WORKING_DIFFERS_FROM_HEAD frontend\/library\/s4Spec\.mjs/);
      expect(a.errors.join(' ')).toMatch(/AUTHORITY_WORKING_DIFFERS_FROM_HEAD frontend\/library\/s4Spec\.mjs/);
    } finally { rmSync(repo.dir, { recursive: true, force: true }); }
  }, 30000);

  it('RED: dirty·잘못된 시작 commit도 막는다', () => {
    const repo = tinyRepo();
    try {
      expect(PROM.generatorAuthority(repo.dir, 'nothex').errors.join(' ')).toMatch(/START_COMMIT_REQUIRED/);
      writeFileSync(join(repo.dir, 'frontend/library/Z.txt'), 'z');
      const a = PROM.generatorAuthority(repo.dir, repo.head);
      expect(a.ok).toBe(false);
      expect(a.errors.join(' ')).toMatch(/WORKTREE_DIRTY 1: \?\? frontend\/library\/Z\.txt/);
    } finally { rmSync(repo.dir, { recursive: true, force: true }); }
  }, 30000);
});

// ── 픽셀 정착: 유한 재시도 ──────────────────────────────────────────────────
describe('S4 픽셀 정착 — 예산 안에서 연속 2장 동일, 미수렴은 fail-closed', () => {
  // 프레임 시퀀스를 그대로 재생하는 driver. 실제 브라우저 없이 정착 판정만 고정한다.
  const drv = (frames) => {
    let i = 0;
    return { sleep: async () => {}, screenshot: async () => frames[Math.min(i++, frames.length - 1)],
      evaluate: async () => [] };
  };
  const B = (t) => Buffer.from(t);

  it('GREEN: 첫 비교에서 바로 같으면 1회로 끝난다', async () => {
    const r = await RUN.settlePixels(drv([B('A')]), B('A'), 's');
    expect(r.settled).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.png.toString()).toBe('A');
  });

  it('GREEN: 흔들리다가 연속 2장이 같아지면 그 시점에 정착한다', async () => {
    // 첫 장 A → B, C, D, D  → 4번째 시도에서 D===D
    const r = await RUN.settlePixels(drv([B('B'), B('C'), B('D'), B('D')]), B('A'), 's');
    expect(r.settled).toBe(true);
    expect(r.attempts).toBe(4);
    // 산출물은 **정착한 마지막 장**이다 — 첫 장은 아직 전환 중이었을 수 있다.
    expect(r.png.toString()).toBe('D');
    expect(r.sizes).toHaveLength(5);
  });

  it('RED: 예산 안에 수렴하지 않으면 settled=false이고 마지막 두 장을 넘긴다', async () => {
    const alt = ['X', 'Y', 'X', 'Y', 'X', 'Y', 'X', 'Y', 'X', 'Y'].map(B);
    const r = await RUN.settlePixels(drv(alt), B('W'), 's', 1500, 300);
    expect(r.settled).toBe(false);
    expect(r.elapsedMs).toBe(1500);
    expect(r.attempts).toBe(5);                       // 1500 / 300
    expect(r.last.a.toString()).not.toBe(r.last.b.toString());
    expect(r.png).toBeUndefined();                    // 산출물을 만들지 않는다
  });

  it('RED: 스크린샷이 비면 즉시 실패한다', async () => {
    const r = await RUN.settlePixels(drv([null]), B('A'), 's');
    expect(r.settled).toBe(false);
  });

  it('예산·간격 상수와 배선', () => {
    expect(RUN.PIXEL_SETTLE_MS).toBe(300);
    expect(RUN.PIXEL_SETTLE_BUDGET_MS).toBeGreaterThanOrEqual(3000);
    expect(RUN.PIXEL_SETTLE_BUDGET_MS).toBeLessThanOrEqual(5000);
    const src = readFileSync(new URL('./s4CaptureRunner.mjs', import.meta.url), 'utf8');
    // runSurface가 이 루프를 쓰고, 실패 시 진단을 모은다.
    expect(src).toContain('const st = await settlePixels(driver, png, surface.name)');
    expect(src).toContain('RUN_UNSTABLE_PIXELS');
    expect(src).toContain('OVERFLOW_PROBE_SOURCE');
    // 정착 실패는 여전히 fail-closed다 — errors가 비지 않는다.
    const fn = src.slice(src.indexOf('const st = await settlePixels'), src.indexOf('\n// 산출물은 **candidate'));
    expect(fn).toContain('RUN_UNSTABLE_PIXELS');
    expect(fn.indexOf('if (!st.settled)')).toBeLessThan(fn.indexOf('RUN_UNSTABLE_PIXELS'));
  });

  it('diffBbox는 다른 픽셀의 경계 상자를 준다', () => {
    const a = pngBytes(8, 8, 1);
    const b = pngBytes(8, 8, 1);
    expect(RUN.diffBbox(a, b)).toEqual({ ok: true, pixels: 0, bbox: null });
    const c = pngBytes(8, 8, 2);
    const d = RUN.diffBbox(a, c);
    expect(d.ok).toBe(true);
    expect(d.pixels).toBeGreaterThan(0);
    expect(d.bbox).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    // 크기가 다르면 fail-closed
    expect(RUN.diffBbox(a, pngBytes(9, 8, 1)).ok).toBe(false);
  });

  it('--scan은 아무것도 쓰지 않는다 (모드 파싱과 sink 미호출)', () => {
    const ok = CAP.parseCaptureArgs(['--scan', 'timeline,tree', '--phase', 'dark'], SPEC);
    expect(ok.error).toBeUndefined();
    expect(ok.scanList).toEqual(['timeline', 'tree']);
    expect(CAP.parseCaptureArgs(['--scan', 'nope'], SPEC).error).toMatch(/UNKNOWN_SURFACE/);
    expect(CAP.parseCaptureArgs(['--scan', 'all'], SPEC).scanList).toHaveLength(SPEC.REQUIRED_SMOKE_SURFACES.length);
    const src = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    const blk = src.slice(src.indexOf('if (cli.scan) {'), src.indexOf('// ── phase capture는'));
    expect(blk).not.toContain('writeCandidate');
    expect(blk).not.toContain('runPhaseCaptureImpl');
    expect(blk).toContain('wrote: false');
  });
});

// ── projector BASE 소스의 pinned reader ─────────────────────────────────────
describe('S4 pinned source — projector Git 읽기가 환경을 상속하지 않는다', () => {
  const T = SPEC.FILES.T.rel;
  // alt repo: BASE 3파일을 복사하되 track.scss만 0.04 → 0.041, 그리고 branch `81ad606`.
  const altRepo = () => {
    const d = mkdtempSync(join(tmpdir(), 's4-alt-'));
    for (const k of Object.keys(SPEC.FILES)) {
      const { rel } = SPEC.FILES[k];
      const src = execSync(`git -C ${REPO} show ${SPEC.BASE}:frontend/${rel}`, { encoding: 'utf8' });
      mkdirSync(join(d, 'frontend', rel.split('/').slice(0, -1).join('/')), { recursive: true });
      writeFileSync(join(d, 'frontend', rel), k === 'T' ? src.replace(/0\.04\b/g, '0.041') : src);
    }
    execSync(`git -C ${d} init -q && git -C ${d} add -A && git -C ${d} ` +
      `-c user.email=t@t -c user.name=t commit -q -m alt`, { stdio: 'ignore' });
    execSync(`git -C ${d} branch ${SPEC.BASE}`, { stdio: 'ignore' });   // 축약 SHA와 같은 이름의 branch
    return d;
  };
  const withEnv = (alt, fn) => {
    const saved = {};
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE']) saved[k] = process.env[k];
    try {
      process.env.GIT_DIR = join(alt, '.git');
      process.env.GIT_WORK_TREE = alt;
      return fn();
    } finally {
      for (const k of ['GIT_DIR', 'GIT_WORK_TREE']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  };

  it('선재현 대조: 셸 방식은 alt repo의 변조본을 읽는다', () => {
    const alt = altRepo();
    try {
      const shell = (env) => execSync(`git -C ${REPO} show ${SPEC.BASE}:frontend/${T}`,
        { encoding: 'utf8', ...(env ? { env: { ...process.env, GIT_DIR: join(alt, '.git'), GIT_WORK_TREE: alt } } : {}) });
      expect(shell(false).includes('0.041')).toBe(false);
      expect(shell(true).includes('0.041')).toBe(true);            // 환경 상속 시 변조본
      expect(sha256(shell(false))).not.toBe(sha256(shell(true)));
      // alt의 OID는 정본 blob과 다르다 — pinned reader가 이것으로 막는다.
      expect(execSync(`git -C ${alt} rev-parse ${SPEC.BASE}:frontend/${T}`, { encoding: 'utf8' }).trim())
        .not.toBe(SPEC.FILES.T.blob);
    } finally { rmSync(alt, { recursive: true, force: true }); }
  }, 30000);

  it('GREEN: pinned reader는 GIT_DIR/GIT_WORK_TREE 변이에도 exact 동일 bytes', () => {
    const alt = altRepo();
    try {
      const read = () => PROM.readPinnedGitFile(REPO, SPEC.BASE, T, SPEC.FILES.T.blob);
      const base = read();
      expect(base.errors).toEqual([]);
      expect(base.oid).toBe(SPEC.FILES.T.blob);
      const mut = withEnv(alt, read);
      expect(mut.errors).toEqual([]);
      expect(sha256(mut.bytes)).toBe(sha256(base.bytes));          // exact 동일
      expect(mut.bytes.includes('0.041')).toBe(false);
    } finally { rmSync(alt, { recursive: true, force: true }); }
  }, 30000);

  it('GREEN: projector source와 serialized fixture SHA가 env 변이에도 동일', () => {
    const alt = altRepo();
    const require2 = createRequire(`${resolve(__dirname, '..')}/package.json`);
    const sass2 = require2('sass'); const postcss2 = require2('postcss');
    const FRONT = resolve(__dirname, '..');
    const BLOB_BY_REL = new Map(Object.values(SPEC.FILES).map((f) => [f.rel, f.blob]));
    const gitShow = (ref, rel) => {
      const r = PROM.readPinnedGitFile(REPO, ref, rel, BLOB_BY_REL.get(rel));
      if (r.errors.length) throw new Error(r.errors.join(' | '));
      return r.bytes;
    };
    const compileScss = (src, rel) => sass2.compileString(src,
      { syntax: 'scss', url: pathToFileURL(`${FRONT}/${rel}`), loadPaths: [`${FRONT}/styles`] }).css;
    const run = () => {
      const { pr, baseSources } = PROJ.buildProjection({ spec: SPEC, gitShow, compileScss,
        frontDir: FRONT, sass: sass2, postcss: postcss2 });
      expect(pr.errors).toEqual([]);
      const fingerprint = EV.specFingerprint(EV.snapshotSpec(SPEC).spec, sha256);
      const smoke = { contextSha256: 'a'.repeat(64), captures: [] };
      const { fixture } = PROJ.buildProjectedFixture({ spec: SPEC, pr, fingerprint, smoke });
      return { srcSha: sha256(Object.keys(baseSources).sort().map((k) => baseSources[k]).join('\0')),
        fixSha: sha256(EV.serializeFixture(fixture)) };
    };
    try {
      const base = run();
      const mut = withEnv(alt, run);
      expect(mut.srcSha).toBe(base.srcSha);                        // projector source 동일
      expect(mut.fixSha).toBe(base.fixSha);                        // serialized fixture 동일
    } finally { rmSync(alt, { recursive: true, force: true }); }
  }, 60000);

  it('RED: OID가 정본 blob과 다르면 fail-closed (bytes 없음)', () => {
    const alt = altRepo();
    try {
      // alt repo를 repoDir로 직접 지목해도 OID 대조에서 막힌다.
      const r = PROM.readPinnedGitFile(alt, SPEC.BASE, T, SPEC.FILES.T.blob);
      expect(r.bytes).toBe(null);
      expect(r.errors.join(' ')).toMatch(/PINNED_BLOB_MISMATCH/);
      // caller가 기대 blob을 alt 값으로 낮춰 잡아도 정본 spec 대조에서 막힌다.
      const altOid = execSync(`git -C ${alt} rev-parse ${SPEC.BASE}:frontend/${T}`, { encoding: 'utf8' }).trim();
      expect(PROM.readPinnedGitFile(alt, SPEC.BASE, T, altOid).errors.join(' ')).toMatch(/PINNED_BLOB_NOT_CANON/);
      // 형태 검증
      expect(PROM.readPinnedGitFile(REPO, 'zz', T, SPEC.FILES.T.blob).errors.join(' ')).toMatch(/PINNED_REF_FORMAT/);
      expect(PROM.readPinnedGitFile(REPO, SPEC.BASE, '../etc/passwd', SPEC.FILES.T.blob).errors.join(' '))
        .toMatch(/PINNED_REL_NONCANONICAL/);
      expect(PROM.readPinnedGitFile(REPO, SPEC.BASE, 'styles/other.scss', SPEC.FILES.T.blob).errors.join(' '))
        .toMatch(/PINNED_REL_NOT_IN_SPEC/);
    } finally { rmSync(alt, { recursive: true, force: true }); }
  }, 30000);

  // ── 검증과 읽기 사이 ref 이동(TOCTOU) ────────────────────────────────────
  // canonical commit과 bad commit을 둔 alt repo에서 `refs/heads/<BASE>`를 **검증 직후**
  // 옮긴다. 이전 판은 `rev-parse <ref>:<path>`로 확인한 뒤 `show <ref>:<path>`를 다시 돌려서
  // errors=[]·oid=canonical인데 bytes는 "/* BAD */"였다.
  const twoCommitAlt = () => {
    const d = mkdtempSync(join(tmpdir(), 's4-toc-'));
    for (const k of Object.keys(SPEC.FILES)) {
      const { rel } = SPEC.FILES[k];
      mkdirSync(join(d, 'frontend', rel.split('/').slice(0, -1).join('/')), { recursive: true });
      writeFileSync(join(d, 'frontend', rel),
        execSync(`git -C ${REPO} show ${SPEC.BASE}:frontend/${rel}`, { encoding: 'utf8' }));
    }
    const g = (c) => execSync(`git -C ${d} ${c}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    g('init -q'); g('add -A'); g('-c user.email=t@t -c user.name=t commit -q -m canonical');
    const good = g('rev-parse HEAD').trim();
    writeFileSync(join(d, 'frontend', T),
      `/* BAD */\n${execSync(`git -C ${REPO} show ${SPEC.BASE}:frontend/${T}`, { encoding: 'utf8' })}`);
    g('add -A'); g('-c user.email=t@t -c user.name=t commit -q -m bad');
    const bad = g('rev-parse HEAD').trim();
    g(`update-ref refs/heads/${SPEC.BASE} ${good}`);
    return { dir: d, good, bad, badBlob: g(`rev-parse ${bad}:frontend/${T}`).trim() };
  };
  const gitBlobHash = (buf) => createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`, 'utf8'), buf])).digest('hex');

  it('RED: 검증과 읽기 사이 ref가 canonical→bad로 움직여도 bad bytes를 돌려주지 않는다', () => {
    const alt = twoCommitAlt();
    const shim = mkdtempSync(join(tmpdir(), 's4-shim-'));
    const REAL = execSync('command -v git', { encoding: 'utf8' }).trim();
    const prevPath = process.env.PATH;
    try {
      expect(alt.badBlob).not.toBe(SPEC.FILES.T.blob);
      // rev-parse 1회차(=OID 검증) 직후 ref를 bad로 옮긴다.
      writeFileSync(join(shim, 'git'), `#!/bin/sh
if [ "$3" = "rev-parse" ]; then
  n=$(cat ${join(shim, 'c')} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${join(shim, 'c')}
  out=$(${REAL} "$@"); rc=$?
  if [ "$n" = "1" ]; then ${REAL} -C ${alt.dir} update-ref refs/heads/${SPEC.BASE} ${alt.bad}; fi
  printf '%s\n' "$out"; exit $rc
fi
exec ${REAL} "$@"
`);
      execSync(`chmod +x ${join(shim, 'git')}`);
      process.env.PATH = `${shim}:${prevPath}`;
      const r = PROM.readPinnedGitFile(alt.dir, SPEC.BASE, T, SPEC.FILES.T.blob);
      // ref가 실제로 움직였는지 먼저 확인한다(변이가 유효했다는 증거).
      expect(execSync(`git -C ${alt.dir} rev-parse refs/heads/${SPEC.BASE}`, { encoding: 'utf8' }).trim())
        .toBe(alt.bad);
      // 허용 결과는 둘 뿐이다: canonical bytes + errors=[] · 또는 fail-closed.
      if (r.errors.length === 0) {
        expect(r.bytes).not.toBeNull();
        const h = gitBlobHash(Buffer.from(r.bytes, 'utf8'));
        expect(h).toBe(SPEC.FILES.T.blob);          // 돌려준 바이트의 blob = 정본
        expect(h).toBe(r.oid);
        expect(h).not.toBe(alt.badBlob);
        expect(r.bytes.startsWith('/* BAD */')).toBe(false);
      } else {
        expect(r.bytes).toBeNull();                 // fail-closed면 bytes가 없다
      }
      // 어떤 경우에도 "bad bytes + errors=[]"는 불가능하다.
      expect(r.errors.length === 0 && r.bytes !== null
        && gitBlobHash(Buffer.from(r.bytes, 'utf8')) === alt.badBlob).toBe(false);
    } finally {
      process.env.PATH = prevPath;
      rmSync(alt.dir, { recursive: true, force: true });
      rmSync(shim, { recursive: true, force: true });
    }
  }, 30000);

  it('bytes는 검증된 oid로 읽고 해시를 재계산해 대조한다', () => {
    const src = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function readPinnedGitFile'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    // ref로 다시 읽지 않는다.
    expect(body).not.toContain("'show'");
    expect(body).toContain("gitArgv(['-C', repoDir, 'cat-file', 'blob', oid], 'buffer')");
    // 순서: OID 대조 → cat-file → 바이트 해시 재계산 대조
    expect(body.indexOf('PINNED_BLOB_MISMATCH')).toBeLessThan(body.indexOf("'cat-file'"));
    expect(body.indexOf("'cat-file'")).toBeLessThan(body.indexOf('PINNED_BYTES_HASH'));
    expect(body).toContain('PINNED_BYTES_BLOB');
    // 정상 경로의 해시 대조가 실제로 성립한다.
    const r = PROM.readPinnedGitFile(REPO, SPEC.BASE, T, SPEC.FILES.T.blob);
    expect(r.errors).toEqual([]);
    expect(gitBlobHash(Buffer.from(r.bytes, 'utf8'))).toBe(SPEC.FILES.T.blob);
    expect(r.oid).toBe(SPEC.FILES.T.blob);
  }, 30000);

  it('두 스크립트가 같은 helper를 쓰고, 셸 git 읽기가 남아 있지 않다', () => {
    for (const f of ['s4-gen.mjs', 's4-promote-capture.mjs']) {
      const src = readFileSync(new URL(`../scripts/${f}`, import.meta.url), 'utf8');
      expect(src, f).toContain('readPinnedGitFile(');
      expect(src, f).not.toContain('execSync(');                   // 셸 git 읽기 없음
      expect(src, f).not.toMatch(/git -C \$\{REPO\} show/);
      expect(src, f).not.toMatch(/git -C \$\{REPO\} rev-parse \$\{SPEC\.BASE\}/);
    }
    // generic runner는 export되지 않는다.
    const psrc = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
    expect(psrc).not.toContain('export function gitArgv');
    expect(psrc).not.toContain('export const gitAuthority');
  });
});

// ── promotion positive path (계약 완결 minimal world) ───────────────────────
describe('S4 promotion positive — 실제로 승격하고 release가 셋을 함께 가리킨다', () => {
  // **깨끗한 임시 repo를 repoDir로 쓴다.** authority는 모듈 내부 검사이고 우회 스위치가
  // 없으므로, 개발 중 dirty한 실제 repo로는 이 축을 시험할 수 없다. 게이트를 약화하는 대신
  // 게이트가 들여다볼 루트를 깨끗한 것으로 준다(fixturesDir과 같은 성격).
  const RASTER = { width: 40, height: 30, dpr: 1, screenshotScale: 'css' };
  // coverage/contrast/conversion을 빈 집합으로 둔다 — **승인 경로의 conformance까지**
  // 통과하는 계약 완결 world여야 공식 wrapper positive가 성립한다.
  const SURF = { name: 'p1', captureName: 'p1.png', actions: [], requiredElements: [],
    coverageSelectors: [], darkReviewSelectors: [] };
  // minimal world에 맞는 evidence를 **실제 Git OID**로 합성한다. 승격 모듈이 내부에서
  // resolver를 만들므로 blob은 진짜 값이어야 한다(스텁을 넣을 자리가 없다).
  const synFor = (spec, repo) => {
    const OBSERVED_HEAD = repo.head;
    const realBlobs = () => Object.fromEntries(SPEC.PROVENANCE_BLOB_PATHS.map((rel) => [rel, repo.blobs[rel]]));
    const names = spec.REQUIRED_SMOKE_SURFACES.map((x) => x.name);
    const n = names.length;
    const man = JSON.parse(JSON.stringify(dsManifest(n)));
    const sc = SPEC.SCENARIO_CANON;
    const tuples = [];
    for (const cat of ['dataset', 'ambient', 'dev']) for (const e of man[cat]) {
      const { url } = EV.resolveTemplate(e.urlTemplate, sc);
      const extra = e.observedRequestCount - e.observedSurfaceCount;
      names.slice(0, e.observedSurfaceCount).forEach((nm, i) =>
        tuples.push({ surface: nm, method: e.method, url, count: i < extra ? 2 : 1 }));
    }
    const lines = tuples.map((t) => `${t.surface} ${t.method} ${t.url} 200 ok x${t.count}`).sort();
    const digest = sha256(lines.join('\n'));
    const bySurface = Object.fromEntries(names.map((nm) => [nm, {}]));
    for (const t of tuples) bySurface[t.surface][`${t.method} ${t.url} 200`] = t.count;
    const blobs = realBlobs();
    const payload = { mode: 'discovery', eligibleForManifest: true,
      provenance: { headCommit: OBSERVED_HEAD, blobs,
        specFingerprint: man.evidence.observedSpecFingerprint, hookVersion: 2, bridgeProtocol: 's4-bridge/2' },
      surfaces: names, surfacesCompleted: n, repeats: 1, digest, endpoints: lines, bySurface };
    const out = JSON.stringify(payload, null, 1);
    const adapterLog = JSON.stringify(['hello', 'beginAttempt', 'endAttempt', 'shutdown', 'clean-exit']);
    const errText = 'bridge on 10098 — discovery\ndiscovery 완료 — 아무것도 쓰지 않았다.\n';
    const files = { 'runA.out': out, 'runB.out': out, 'runA.err': errText, 'runB.err': errText,
      'runA.code': '0\n', 'runB.code': '0\n', 'runA.adapter.json': adapterLog, 'runB.adapter.json': adapterLog };
    man.evidence = { ...man.evidence, observedHead: OBSERVED_HEAD, discoveryDigest: digest,
      files: Object.fromEntries(Object.keys(files).map((k) => [k, sha256(files[k])])) };
    const reviewed = {};
    for (const cat of ['dataset', 'ambient', 'dev']) for (const e of man[cat]) reviewed[e.urlTemplate] = cat;
    return { files, spec: { ...spec, EXPECTED_DATASET_MANIFEST: man, REVIEWED_CLASSIFICATION: reviewed,
      DATASET_ENDPOINTS: man.dataset.map((e) => e.urlTemplate) } };
  };
  const PNG = () => pngBytes(40, 30, 9);
  const prodResponses = (spec) => {
    const sc = SPEC.SCENARIO_CANON;
    return (spec || SPEC).DATASET_ENDPOINTS.map((t) => {
      const { url } = EV.resolveTemplate(t, sc);
      let body = '{"status":true}';
      if (url === `${sc.apiOrigin}/branches`)
        body = JSON.stringify({ status: true, branches: [{ branch_id: sc.bulkBranchId, branch_name: sc.branchName }] });
      else if (url === `${sc.apiOrigin}/branches/${sc.bulkBranchId}/epics`)
        body = JSON.stringify({ status: true, epics: [{ epic_id: sc.bulkEpicId, epic_name: sc.epicName }] });
      return { url, status: 200, body };
    });
  };
  // 승격이 요구하는 모든 계약을 만족하는 최소 spec.
  const P_SPEC = (repo) => synFor({ ...SPEC, REQUIRED_SMOKE_SURFACES: [SURF], RASTER_CONTRACT: RASTER,
    LIGHT_DIFF_MASKS: {}, ELEMENT_SCALES: { p1: {} }, MASK_PIXEL_BUDGET: { p1: 0 }, SELECTOR_SIZE_ENVELOPE: {},
    CONVERSIONS: [], CONTRAST_CASES: [], CONTRAST_REFERENCE: {}, ANNOTATIONS: [],
    COUNTS: { conversions: 0, changedDecls: 0, newDecls: 0, newRules: 0, residual: 0,
      rawLiterals: 0, processedLiterals: 0, allowIds: 0 },
    DARK_DECL_COUNTS: { T: 0, X: 0, S: 0 } }, repo);
  const ctxFor = (phase, spec, repo) => {
    const png = PNG();
    const responses = prodResponses(spec);
    const subject = {
      ...SPEC.SCENARIO_CANON, phase,
      viewport: { width: RASTER.width, height: RASTER.height },
      capture: { type: 'png', scale: RASTER.screenshotScale, dpr: RASTER.dpr },
      coverageEvidence: { p1: {} },
      actionLog: { p1: [] },
      baseLightMaskRects: { p1: {} },
      provenance: { headCommit: repo.head, blobs: repo.blobs,
        specFingerprint: EV.specFingerprint(EV.snapshotSpec(spec).spec, sha256),
        datasetDigest: EV.datasetDigest(responses, spec, sha256).digest },
      datasetResponses: responses,
      ...(phase === 'dark' ? { darkReview: { p1: {} } } : {}),
    };
    const privacyAudit = { scope: 'dedicated-synthetic-account-workspace', contextPass: true,
      contextSubjectSha256: sha256(JSON.stringify(CANON.canonicalize(subject))),
      captures: [{ captureName: 'p1.png', sha256: sha256(png), pass: true, findings: [] }] };
    return { raw: JSON.stringify({ ...subject, privacyAudit }, null, 1), png };
  };
  const world = (repoOpts = {}) => {
    const repo = tinyRepo(repoOpts);
    const d = repo.fixturesDir;                 // production topology: fixturesDir ⊂ repoDir
    const built = P_SPEC(repo);
    const spec = built.spec; const evidenceFiles = built.files;
    const cands = {};
    for (const phase of ['light', 'dark']) {
      const { raw, png } = ctxFor(phase, spec, repo);
      const e = RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase, contextRaw: raw,
        pngByCaptureName: { 'p1.png': png }, expectedCaptureNames: ['p1.png'] });
      expect(e, phase).toEqual([]);
      cands[phase] = RUN.readCandidateBundle(d, phase);
      expect(cands[phase].errors, phase).toEqual([]);
    }
    const light = JSON.parse(cands.light.contextRaw);
    const fixture = { base: spec.BASE, blobs: spec.FILES, fingerprint: light.provenance.specFingerprint,
      counts: { conversions: 0, changed: 0, new: 0, newRules: 0, residual: 0, raw: 0, processed: 0, allowBearing: 0 },
      allowIdToKey: {}, smoke: { contextSha256: sha256(cands.light.contextRaw),
        captures: [{ captureName: 'p1.png', sha256: sha256(cands.light.pngByName['p1.png']) }] },
      expectedAfter: [], changed: [], new: [], residual: [], contrast: [] };
    const expectedBytes = JSON.stringify(fixture, null, 1);
    return { d, spec, cands, expectedBytes, evidenceFiles, repo };
  };
  // hashedModules·startHead는 **넘기지 않는다** — 승격이 스스로 파생한다. over로 억지로
  // 넣어 보는 것 자체가 아래 우회 시도 테스트다.
  const promote = (w, over = {}) => PROM.promoteRelease({
    fixturesDir: w.d, spec: w.spec,
    provenanceRefs: { headCommit: w.repo.head, headBlobs: w.repo.blobs,
      specFingerprintNow: JSON.parse(w.cands.light.contextRaw).provenance.specFingerprint },
    fromRelease: PROM.readRelease(w.d), expectedBytes: w.expectedBytes, candidates: w.cands,
    discoveryEvidence: { files: w.evidenceFiles }, repoDir: w.repo.dir, ...over });
  const kill = (w, ...extra) => {
    rmSync(w.repo.dir, { recursive: true, force: true });
    for (const p of extra) rmSync(p, { recursive: true, force: true });
  };
  // 승격이 만들어야 하는 산출물 5건(=version 2×(context+png) + expected 1)의 repo 상대 경로.
  const outputsOf = (w, rel) => [
    `${FX_REL}/s4-capture/expected/${rel.expectedSha}.json`,
    ...['light', 'dark'].flatMap((p) => [`${FX_REL}/s4-capture/versions/${rel[p]}/context.json`,
      `${FX_REL}/s4-capture/versions/${rel[p]}/shots/p1.png`]),
  ].sort();

  it('GREEN 대조군: production topology에서 promoted:true · release가 셋을 함께 가리킨다', () => {
    const w = world();
    try {
      // 시작 시점 topology 자체를 단정한다 — fixturesDir가 repo 안이고 트리는 clean이다.
      expect(w.d.startsWith(w.repo.dir + '/')).toBe(true);
      expect(dirtyOf(w.repo)).toEqual([]);
      const r = promote(w);
      expect(r.errors).toEqual([]);
      expect(r.promoted).toBe(true);
      const rel = PROM.readRelease(w.d);
      expect(Object.keys(rel).sort()).toEqual(['dark', 'expectedSha', 'light']);
      expect(PROM.validateReleaseShape(rel)).toEqual([]);
      expect(rel.expectedSha).toBe(sha256(w.expectedBytes));
      for (const p of ['light', 'dark']) {
        const b = PROM.readCaptureBundle(w.d, p);
        expect(b.errors, p).toEqual([]);
        expect(b.contextRaw, p).toBe(w.cands[p].contextRaw);
      }
      const exp = PROM.readCommittedExpected(w.d);
      expect(exp.errors).toEqual([]);
      expect(exp.bytes).toBe(w.expectedBytes);          // committed bytes === 승인 bytes
      // 승격 뒤 워킹트리에 남는 것은 **release + 산출물 5건뿐**이다. 이 목록이 곧
      // late authority가 허용한 집합이고, 그 밖의 것이 있었다면 승격이 실패했어야 한다.
      expect(dirtyOf(w.repo).map((e) => e.slice(3)).sort())
        .toEqual([`${FX_REL}/s4-capture/release.json`, ...outputsOf(w, rel)].sort());
    } finally { kill(w); }
  }, 30000);

  // ── 승격 도중 개입을 만드는 결정론적 훅 ──────────────────────────────────────
  // late authority가 부르는 **두 번째 `git status`** 순간에 개입한다. PATH 앞에 git shim을
  // 두므로 제품 코드에 테스트용 seam을 만들지 않는다.
  const REAL_GIT = execSync('command -v git', { encoding: 'utf8' }).trim();
  const shimAt2 = (dir, body) => {
    writeFileSync(join(dir, 'git'), `#!/bin/sh
if [ "$3" = "status" ]; then
  n=$(cat ${join(dir, 'count')} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${join(dir, 'count')}
  if [ "$n" = "2" ]; then
${body}
  fi
fi
exec ${REAL_GIT} "$@"
`);
    execSync(`chmod +x ${join(dir, 'git')}`);
    const prev = process.env.PATH; process.env.PATH = `${dir}:${prev}`;
    return () => { process.env.PATH = prev; };
  };
  const nextOf = (w) => ({ expectedSha: sha256(w.expectedBytes),
    light: PROM.bundleDigest(w.cands.light.contextRaw, w.cands.light.pngByName),
    dark: PROM.bundleDigest(w.cands.dark.contextRaw, w.cands.dark.pngByName) });
  // 디스크에 실제로 남은 write 수를 센다 — "write 0"을 문장이 아니라 개수로 확인한다.
  const writeCounts = (w) => {
    const vroot = join(w.d, 's4-capture', 'versions');
    const eroot = join(w.d, 's4-capture', 'expected');
    const cnt = (p2) => (existsSync(p2) ? readdirSync(p2).filter((n) => !n.startsWith('.')).length : 0);
    return { versions: cnt(vroot), expected: cnt(eroot),
      release: existsSync(join(w.d, 's4-capture', 'release.json')) ? 1 : 0,
      candidates: ['light', 'dark'].filter((ph) => RUN.readCandidateBundle(w.d, ph).errors.length === 0).length };
  };

  // ── F1: late authority는 산출물의 **존재**까지 본다 ───────────────────────────
  it.each([
    ['context.json', (w, n) => join(w.d, 's4-capture', 'versions', n.light, 'context.json')],
    ['shots/p1.png', (w, n) => join(w.d, 's4-capture', 'versions', n.dark, 'shots', 'p1.png')],
    ['expected', (w, n) => PROM.expectedPath(w.d, n.expectedSha)],
  ])('RED: readback 뒤 %s가 사라지면 release write 0', (_label, pick) => {
    const w = world(); const sd = mkdtempSync(join(tmpdir(), 's4-shim-'));
    const n = nextOf(w);
    const off = shimAt2(sd, `    rm -f ${pick(w, n)}`);
    try {
      const r = promote(w);
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/PROMOTE_AUTHORITY_FAILED_LATE .*ALLOWED_MISSING/);
      expect(PROM.readRelease(w.d)).toBe(null);
      expect(writeCounts(w).release).toBe(0);
    } finally { off(); kill(w, sd); }
  }, 30000);

  // ── G1: late version shape ─────────────────────────────────────────────────
  it('RED: late authority 시점에 shots/EXTRA_EMPTY_DIR/가 생기면 release write 0', () => {
    const w = world(); const sd = mkdtempSync(join(tmpdir(), 's4-shim-'));
    const n = nextOf(w);
    // 빈 디렉터리는 git이 추적하지 않아 status에 잡히지 않는다 — shape 재검증만이 잡는다.
    const off = shimAt2(sd, `    mkdir -p ${join(w.d, 's4-capture', 'versions', n.light, 'shots', 'EXTRA_EMPTY_DIR')}`);
    try {
      const r = promote(w);
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/VERSION_NODE_NOT_FILE|VERSION_FILE_SET/);
      expect(PROM.readRelease(w.d)).toBe(null);
      expect(writeCounts(w).release).toBe(0);
    } finally { off(); kill(w, sd); }
  }, 30000);

  // ── G4: 승격 sink의 고정 루트 ───────────────────────────────────────────────
  it('RED: clean clone repoDir + 별도 fixturesDir이면 version/expected/release write 0', () => {
    const w = world();
    const alien = mkdtempSync(join(tmpdir(), 's4-alien-'));
    try {
      for (const ph of ['light', 'dark'])
        RUN.writeCandidate({ fixturesDir: alien, phase: ph, contextRaw: w.cands[ph].contextRaw,
          pngByCaptureName: w.cands[ph].pngByName, expectedCaptureNames: ['p1.png'],
          expectedCurrentBundleName: null });
      const cands2 = { light: RUN.readCandidateBundle(alien, 'light'), dark: RUN.readCandidateBundle(alien, 'dark') };
      const r = PROM.promoteRelease({ fixturesDir: alien, spec: w.spec,
        provenanceRefs: { headCommit: w.repo.head, headBlobs: w.repo.blobs,
          specFingerprintNow: JSON.parse(w.cands.light.contextRaw).provenance.specFingerprint },
        fromRelease: null, expectedBytes: w.expectedBytes, candidates: cands2,
        discoveryEvidence: { files: w.evidenceFiles }, repoDir: w.repo.dir });
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/PROMOTE_FIXTURES_ROOT/);
      const cnt = (p2) => (existsSync(p2) ? readdirSync(p2).filter((x) => !x.startsWith('.')).length : 0);
      expect(cnt(join(alien, 's4-capture', 'versions'))).toBe(0);
      expect(cnt(join(alien, 's4-capture', 'expected'))).toBe(0);
      expect(existsSync(join(alien, 's4-capture', 'release.json'))).toBe(false);
      // 정본 경로 자체가 없는 repoDir도 거부한다.
      const bare = mkdtempSync(join(tmpdir(), 's4-bare-'));
      expect(PROM.fixturesRootError(bare, w.d)).toMatch(/PROMOTE_FIXTURES_ROOT_ABSENT/);
      expect(PROM.fixturesRootError(w.repo.dir, w.d)).toBe(null);      // 정상 topology는 통과
      rmSync(bare, { recursive: true, force: true });
    } finally { rmSync(alien, { recursive: true, force: true }); kill(w); }
  }, 30000);

  it('RED: canonical __fixtures__가 외부 symlink면 outside write 0', () => {
    const outside = mkdtempSync(join(tmpdir(), 's4-out-'));
    writeFileSync(join(outside, 'KEEP.txt'), 'keep');
    // canonical 자리(frontend/library/__fixtures__)가 밖을 가리키는 symlink인 repo.
    // realpath만 비교하면 fixturesDir와 canonical의 realpath가 **둘 다 outside**라 통과했다.
    const w = world({ fixturesSymlinkTo: outside });
    try {
      expect(PROM.fixturesRootError(w.repo.dir, w.d)).toMatch(/PROMOTE_FIXTURES_ROOT_SYMLINK/);
      const r = promote(w);
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/PROMOTE_FIXTURES_ROOT_SYMLINK/);
      const cnt = (p2) => (existsSync(p2) ? readdirSync(p2).filter((x) => !x.startsWith('.')).length : 0);
      expect(cnt(join(outside, 's4-capture', 'versions'))).toBe(0);
      expect(cnt(join(outside, 's4-capture', 'expected'))).toBe(0);
      expect(existsSync(join(outside, 's4-capture', 'release.json'))).toBe(false);
      expect(readFileSync(join(outside, 'KEEP.txt'), 'utf8')).toBe('keep');   // 기존 파일 불변
    } finally { kill(w, outside); }
  }, 30000);

  it('GREEN: 실제 디렉터리 topology는 통과한다', () => {
    const w = world();
    try {
      expect(PROM.fixturesRootError(w.repo.dir, w.d)).toBe(null);
      expect(promote(w).promoted).toBe(true);
    } finally { kill(w); }
  }, 30000);

  // ── G5: 첫 release 이후 provenance 계보 ─────────────────────────────────────
  it('GREEN: capture A → artifact-only commit B 뒤에도 게이트가 성립한다', () => {
    const w = world();
    const ex = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      expect(promote(w).promoted).toBe(true);
      const A = w.repo.head;
      ex(`git -C ${w.repo.dir} add -A && git -C ${w.repo.dir} ` +
        `-c user.email=t@t -c user.name=t commit -q -m artifacts`);
      const B = ex(`git -C ${w.repo.dir} rev-parse HEAD`).trim();
      expect(B).not.toBe(A);
      const b = PROM.readCaptureBundle(w.d, 'light');
      const pv = JSON.parse(b.contextRaw).provenance;
      // 계보가 성립한다: 실재 commit · B의 ancestor · capture blob 일치 · 현재 blob 동일.
      const ln = PROM.provenanceLineage({ repoDir: w.repo.dir, captureCommit: pv.headCommit, recordedBlobs: pv.blobs });
      expect(ln.errors).toEqual([]);
      expect(ln.ok).toBe(true);
      expect(ln.headCommit).toBe(B);
      // 그 계보 위에서 bundle 검증이 GREEN이다.
      for (const ph of ['light', 'dark']) {
        const bb = PROM.readCaptureBundle(w.d, ph);
        expect(EV.validateCaptureBundle({ spec: w.spec, phase: ph, contextRaw: bb.contextRaw,
          pngByName: bb.pngByName,
          provenanceRefs: { headCommit: pv.headCommit, headBlobs: pv.blobs,
            specFingerprintNow: pv.specFingerprint } }), ph).toEqual([]);
      }
    } finally { kill(w); }
  }, 30000);

  it('RED: hashed module working file이 dirty면 계보가 성립하지 않는다', () => {
    const w = world();
    const ex = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const victim = join(w.repo.dir, 'frontend/library/s4Spec.mjs');
    const orig = readFileSync(victim, 'utf8');
    try {
      expect(promote(w).promoted).toBe(true);
      const pv = JSON.parse(PROM.readCaptureBundle(w.d, 'light').contextRaw).provenance;
      ex(`git -C ${w.repo.dir} add -A && git -C ${w.repo.dir} ` +
        `-c user.email=t@t -c user.name=t commit -q -m artifacts`);
      const ln = () => PROM.provenanceLineage({ repoDir: w.repo.dir, captureCommit: pv.headCommit, recordedBlobs: pv.blobs });
      expect(ln().errors).toEqual([]);                       // 대조군: clean이면 GREEN
      // (1) unstaged 수정
      writeFileSync(victim, '// DIRTY\n');
      const u = ln();
      expect(u.ok).toBe(false);
      expect(u.errors.join(' ')).toMatch(/LINEAGE_WORKING_BLOB WORKING_DIFFERS_FROM_HEAD frontend\/library\/s4Spec\.mjs/);
      // (2) staged 수정
      ex(`git -C ${w.repo.dir} add -A`);
      const st = ln();
      expect(st.ok).toBe(false);
      expect(st.errors.join(' ')).toMatch(/LINEAGE_WORKING_BLOB/);
      // 되돌리면 다시 GREEN — 전체 worktree clean을 요구하는 것이 아니라 HASHED_MODULES만 본다.
      writeFileSync(victim, orig);
      ex(`git -C ${w.repo.dir} add -A`);
      writeFileSync(join(w.repo.dir, 'frontend/library/UNRELATED.txt'), 'x');   // 무관한 dirty는 허용
      expect(ln().errors).toEqual([]);
      ex(`git -C ${w.repo.dir} add frontend/library/UNRELATED.txt`);            // staged여도 범위 밖
      expect(ln().errors).toEqual([]);
    } finally { kill(w); }
  }, 30000);

  it('RED: Git index 변조 — index-only 내용·staged deletion·mode 변경', () => {
    const w = world();
    const ex = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const VICTIM = 'frontend/library/s4Spec.mjs';
    const victim = join(w.repo.dir, VICTIM);
    try {
      expect(promote(w).promoted).toBe(true);
      const pv = JSON.parse(PROM.readCaptureBundle(w.d, 'light').contextRaw).provenance;
      ex(`git -C ${w.repo.dir} add -A && git -C ${w.repo.dir} ` +
        `-c user.email=t@t -c user.name=t commit -q -m artifacts`);
      const ln = () => PROM.provenanceLineage({ repoDir: w.repo.dir, captureCommit: pv.headCommit, recordedBlobs: pv.blobs });
      const orig = readFileSync(victim, 'utf8');
      expect(ln().errors).toEqual([]);                       // 대조군: index/working/HEAD 동일

      // (1) index-only 변조 — EVIL을 add한 뒤 working file만 HEAD 바이트로 되돌린다.
      writeFileSync(victim, '// EVIL\n');
      ex(`git -C ${w.repo.dir} add ${VICTIM}`);
      writeFileSync(victim, orig);
      const workingHash = ex(`git -C ${w.repo.dir} hash-object ${VICTIM}`).trim();
      const headBlob = ex(`git -C ${w.repo.dir} rev-parse HEAD:${VICTIM}`).trim();
      const indexBlob = ex(`git -C ${w.repo.dir} ls-files --stage -- ${VICTIM}`).trim().split(/\s+/)[1];
      expect(workingHash).toBe(headBlob);                    // working은 HEAD와 같다
      expect(indexBlob).not.toBe(headBlob);                  // index만 다르다
      expect(ex(`git -C ${w.repo.dir} status --porcelain -- ${VICTIM}`).trim()).toMatch(/^M/);
      const i1 = ln();
      expect(i1.ok).toBe(false);
      expect(i1.errors.join(' ')).toMatch(new RegExp(`LINEAGE_INDEX_BLOB ${VICTIM.replace(/[./]/g, '\\$&')}`));

      // (2) staged deletion
      ex(`git -C ${w.repo.dir} reset -q --hard`);
      expect(ln().errors).toEqual([]);
      ex(`git -C ${w.repo.dir} rm -q --cached ${VICTIM}`);
      const i2 = ln();
      expect(i2.ok).toBe(false);
      expect(i2.errors.join(' ')).toMatch(new RegExp(`LINEAGE_INDEX_MISSING ${VICTIM.replace(/[./]/g, '\\$&')}`));

      // (3) staged mode 변경(100644 → 100755)
      ex(`git -C ${w.repo.dir} reset -q --hard`);
      ex(`git -C ${w.repo.dir} update-index --chmod=+x ${VICTIM}`);
      expect(ex(`git -C ${w.repo.dir} ls-files --stage -- ${VICTIM}`).trim().split(/\s+/)[0]).toBe('100755');
      const i3 = ln();
      expect(i3.ok).toBe(false);
      expect(i3.errors.join(' ')).toMatch(/LINEAGE_INDEX_MODE .* 100755 != 100644/);
      expect(i3.errors.join(' ')).toMatch(/LINEAGE_INDEX_CAPTURE_MODE/);

      // 복구하면 다시 GREEN이고, HASHED_MODULES 밖의 staged 파일은 범위 밖이다.
      ex(`git -C ${w.repo.dir} update-index --chmod=-x ${VICTIM}`);
      writeFileSync(join(w.repo.dir, 'frontend/library/OTHER.txt'), 'o');
      ex(`git -C ${w.repo.dir} add frontend/library/OTHER.txt`);
      expect(ln().errors).toEqual([]);
    } finally { kill(w); }
  }, 30000);

  it('RED: GIT_* 환경으로 index/repo를 바꿔치기해도 우회 불가', () => {
    const w = world();
    const ex = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const VICTIM = 'frontend/library/s4Spec.mjs';
    const victim = join(w.repo.dir, VICTIM);
    const alt = tinyRepo();                       // 깨끗한 대체 repo(= 우회에 쓸 GIT_DIR/index)
    const cleanIndex = join(alt.dir, 'clean.index');
    const saved = {};
    const KEYS = ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY'];
    for (const k of KEYS) saved[k] = process.env[k];
    try {
      expect(promote(w).promoted).toBe(true);
      const pv = JSON.parse(PROM.readCaptureBundle(w.d, 'light').contextRaw).provenance;
      ex(`git -C ${w.repo.dir} add -A && git -C ${w.repo.dir} ` +
        `-c user.email=t@t -c user.name=t commit -q -m artifacts`);
      const ln = () => PROM.provenanceLineage({ repoDir: w.repo.dir, captureCommit: pv.headCommit, recordedBlobs: pv.blobs });
      expect(ln().errors).toEqual([]);                        // 대조군
      // clean 시점의 index 사본을 떠 둔 뒤, default index에만 EVIL을 stage한다.
      copyFileSync(join(w.repo.dir, '.git', 'index'), cleanIndex);
      const orig = readFileSync(victim, 'utf8');
      writeFileSync(victim, '// EVIL\n');
      ex(`git -C ${w.repo.dir} add ${VICTIM}`);
      writeFileSync(victim, orig);                            // working만 HEAD 바이트로 복원
      expect(ln().errors.join(' ')).toMatch(/LINEAGE_INDEX_BLOB/);
      // 어떤 GIT_* 선택자를 걸어도 default index/repo를 계속 본다.
      for (const [k, v] of [['GIT_INDEX_FILE', cleanIndex], ['GIT_DIR', join(alt.dir, '.git')],
        ['GIT_WORK_TREE', alt.dir], ['GIT_COMMON_DIR', join(alt.dir, '.git')],
        ['GIT_OBJECT_DIRECTORY', join(alt.dir, '.git', 'objects')]]) {
        process.env[k] = v;
        const r = ln();
        expect(r.ok, k).toBe(false);
        expect(r.errors.join(' '), k).toMatch(/LINEAGE_INDEX_BLOB/);
        delete process.env[k];
      }
      // authority 러너는 하나이고 GIT_* 를 제거한 환경에서만 돈다.
      const src = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
      expect(src).toContain("if (!k.startsWith('GIT_')) env[k] = v;");
      expect(src).toContain('env: authorityEnv()');
      const code = src.split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
      expect(code).not.toContain('execSync(');                 // 셸 문자열 러너 없음
      expect(code.match(/execFileSync\(/g)).toHaveLength(1);  // argv 러너 단 하나
      // 세 helper 어디에도 exec 주입 인자가 없다.
      expect(code).toContain('export function worktreeStatusEntries(repoDir) {');
      expect(code).toContain('export function worktreeDirtyEntries(repoDir) {');
      expect(code).toContain('export function headBlobBinding(repoDir, relPaths, pinnedCommit) {');
      // production 스크립트도 인자 없이 부른다.
      for (const f of ['s4-capture.mjs', 's4-audit-candidate.mjs', 's4-gen.mjs', 's4-promote-capture.mjs']) {
        const ss = readFileSync(new URL(`../scripts/${f}`, import.meta.url), 'utf8');
        expect(ss, f).not.toMatch(/worktree(Dirty|Status)Entries\([^)]+,/);
        expect(ss, f).not.toMatch(/headBlobBinding\([^)]*gitExec/);
      }
    } finally {
      for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      rmSync(alt.dir, { recursive: true, force: true });
      kill(w);
    }
  }, 30000);

  it('RED: GIT_* 환경에서도 production capture start/end authority가 dirty를 본다', () => {
    const repo = tinyRepo();
    const alt = tinyRepo();                        // 우회에 쓸 깨끗한 대체 repo
    const ex = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const VICTIM = 'frontend/library/s4Spec.mjs';
    const victim = join(repo.dir, VICTIM);
    const cleanIndex = join(alt.dir, 'clean.index');
    const KEYS = ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR'];
    const saved = {};
    for (const k of KEYS) saved[k] = process.env[k];
    try {
      copyFileSync(join(repo.dir, '.git', 'index'), cleanIndex);
      const orig = readFileSync(victim, 'utf8');
      writeFileSync(victim, '// EVIL\n');
      ex(`git -C ${repo.dir} add ${VICTIM}`);
      writeFileSync(victim, orig);                 // working === HEAD, index만 EVIL
      expect(ex(`git -C ${repo.dir} hash-object ${VICTIM}`).trim())
        .toBe(ex(`git -C ${repo.dir} rev-parse HEAD:${VICTIM}`).trim());

      // production capture가 쓰는 그 조합: worktreeDirtyEntries + headBlobBinding + phaseGateDecision
      const gate = (stage, pinned) => {
        const dirty = CAP.worktreeDirtyEntries(repo.dir);
        const head = PROM.headBlobBinding(repo.dir, CAP.HASHED_MODULES, pinned);
        return { dirty, g: CAP.phaseGateDecision({ stage, dirtyEntries: dirty, head, canonPaths: CAP.HASHED_MODULES }) };
      };
      const base = gate('start');
      expect(base.dirty.length).toBeGreaterThan(0);
      expect(base.g.ok).toBe(false);
      const head0 = PROM.headBlobBinding(repo.dir, CAP.HASHED_MODULES);
      for (const [k, v] of [['GIT_INDEX_FILE', cleanIndex], ['GIT_DIR', join(alt.dir, '.git')],
        ['GIT_WORK_TREE', alt.dir], ['GIT_COMMON_DIR', join(alt.dir, '.git')]]) {
        process.env[k] = v;
        const st = gate('start');
        const en = gate('end', head0.headCommit);
        expect(st.dirty.length, `${k} start`).toBeGreaterThan(0);
        expect(st.g.ok, `${k} start`).toBe(false);
        expect(en.g.ok, `${k} end`).toBe(false);
        // candidate write 0 — 게이트가 막았으므로 산출물 자체가 없다.
        expect(existsSync(join(repo.fixturesDir, 's4-candidates')), k).toBe(false);
        delete process.env[k];
      }
      // 복구하면 GREEN이고, HASHED_MODULES 밖 staged 파일은 범위 밖이다.
      ex(`git -C ${repo.dir} reset -q --hard`);
      expect(gate('start').g.ok).toBe(true);
      writeFileSync(join(repo.dir, 'frontend/library/OTHER.txt'), 'o');
      ex(`git -C ${repo.dir} add frontend/library/OTHER.txt`);
      expect(PROM.headBlobBinding(repo.dir, CAP.HASHED_MODULES).errors).toEqual([]);
    } finally {
      for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      rmSync(repo.dir, { recursive: true, force: true });
      rmSync(alt.dir, { recursive: true, force: true });
    }
  }, 30000);

  it('RED: hashed module을 바꾼 commit C / 비-ancestor commit', () => {
    const w = world();
    const ex = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      expect(promote(w).promoted).toBe(true);
      const pv = JSON.parse(PROM.readCaptureBundle(w.d, 'light').contextRaw).provenance;
      ex(`git -C ${w.repo.dir} add -A && git -C ${w.repo.dir} ` +
        `-c user.email=t@t -c user.name=t commit -q -m artifacts`);
      // (1) contract module을 바꾼 commit C → 현재 blob이 기록과 다르다.
      writeFileSync(join(w.repo.dir, 'frontend/library/s4Spec.mjs'), '// C\n');
      ex(`git -C ${w.repo.dir} add -A && git -C ${w.repo.dir} ` +
        `-c user.email=t@t -c user.name=t commit -q -m C`);
      const lnC = PROM.provenanceLineage({ repoDir: w.repo.dir, captureCommit: pv.headCommit, recordedBlobs: pv.blobs });
      expect(lnC.ok).toBe(false);
      expect(lnC.errors.join(' ')).toMatch(/LINEAGE_CURRENT_BLOB frontend\/library\/s4Spec\.mjs/);
      // (2) 비-ancestor commit — 다른 갈래에서 만든 commit을 capture로 신고한다.
      ex(`git -C ${w.repo.dir} checkout -q -b side ${pv.headCommit}`);
      writeFileSync(join(w.repo.dir, 'frontend/library/SIDE.txt'), 'side\n');
      ex(`git -C ${w.repo.dir} add -A && git -C ${w.repo.dir} ` +
        `-c user.email=t@t -c user.name=t commit -q -m side`);
      const side = ex(`git -C ${w.repo.dir} rev-parse HEAD`).trim();
      ex(`git -C ${w.repo.dir} checkout -q -`);
      const lnS = PROM.provenanceLineage({ repoDir: w.repo.dir, captureCommit: side, recordedBlobs: pv.blobs });
      expect(lnS.ok).toBe(false);
      expect(lnS.errors.join(' ')).toMatch(/LINEAGE_NOT_ANCESTOR/);
      // (3) 존재하지 않는 commit
      expect(PROM.provenanceLineage({ repoDir: w.repo.dir, captureCommit: 'f'.repeat(40), recordedBlobs: pv.blobs })
        .errors.join(' ')).toMatch(/LINEAGE_COMMIT_UNKNOWN/);
      expect(PROM.provenanceLineage({ repoDir: w.repo.dir, captureCommit: 'nothex', recordedBlobs: pv.blobs })
        .errors.join(' ')).toMatch(/LINEAGE_COMMIT_FORMAT/);
      // (4) 기록 blob 자체를 위조하면 capture 시점 대조에서 잡힌다.
      const forged = { ...pv.blobs, 'frontend/library/s4Promote.mjs': 'a'.repeat(40) };
      expect(PROM.provenanceLineage({ repoDir: w.repo.dir, captureCommit: pv.headCommit, recordedBlobs: forged })
        .errors.join(' ')).toMatch(/LINEAGE_CAPTURE_BLOB frontend\/library\/s4Promote\.mjs/);
    } finally { kill(w); }
  }, 30000);

  // ── G3: generator sink authority ────────────────────────────────────────────
  it('RED: serialize 중 clean A→B checkout이면 sink write 0, staging 파일 미생성', () => {
    const w = world();
    const ex = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const staging = join(w.d, PROM.STAGING_NAME);
    let wrote = 0;
    try {
      const A = w.repo.head;
      const light = JSON.parse(w.cands.light.contextRaw);
      const call = () => PROM.approveForPromotion({
        repoDir: w.repo.dir, evidenceFiles: w.evidenceFiles, spec: w.spec,
        fixture: JSON.parse(w.expectedBytes), contrastResults: [],
        actualDecls: [], actualRaw: {}, preAnnSources: {}, actualAllowIdToKey: new Map(),
        baseDecls: sharedBaseDecls(),
        contextRaw: w.cands.light.contextRaw, sha256,
        readPng: (n) => { const b = w.cands.light.pngByName[n];
          return b ? { bytes: b, width: 40, height: 30 } : { bytes: Buffer.alloc(0) }; },
        provenanceRefs: { headCommit: A, headBlobs: w.repo.blobs,
          specFingerprintNow: light.provenance.specFingerprint },
        // **serialize 도중** clean commit B로 이동한다 — 워킹트리는 계속 clean이다.
        serialize: (f) => {
          writeFileSync(join(w.repo.dir, 'frontend/library/NOTE.txt'), 'b\n');
          ex(`git -C ${w.repo.dir} add -A && git -C ${w.repo.dir} ` +
            `-c user.email=t@t -c user.name=t commit -q -m B`);
          return JSON.stringify(f, null, 1);
        },
        write: PROM.sinkWriter({ repoDir: w.repo.dir, startCommit: A,
          write: (bytes) => { wrote += 1; mkdirSync(w.d, { recursive: true }); writeFileSync(staging, bytes); } }),
      });
      // 승인 orchestration이 sink 예외를 삼키든 던지든 **write는 0**이어야 한다.
      let a = null, thrown = '';
      try { a = call(); } catch (e) { thrown = String((e && e.message) || e); }
      const said = thrown || (a ? a.errors.join(' ') : '');
      expect(a ? a.wrote : false).toBe(false);
      expect(said).toMatch(/GENERATOR_AUTHORITY_AT_SINK/);
      expect(said).toMatch(/HEAD_MOVED/);
      expect(wrote).toBe(0);                                   // 실제 write 콜백이 돌지 않았다
      expect(existsSync(staging)).toBe(false);                 // staging 파일 미생성
      // 대조군: HEAD가 그대로면 같은 sinkWriter가 정상 통과한다.
      let ok = 0;
      const nowHead = ex(`git -C ${w.repo.dir} rev-parse HEAD`).trim();
      PROM.sinkWriter({ repoDir: w.repo.dir, startCommit: nowHead, write: () => { ok += 1; } })('x');
      expect(ok).toBe(1);
    } finally { kill(w); }
  }, 30000);

  // ── F2: lock을 잃으면 아무것도 지우지 않는다 ─────────────────────────────────
  it('RED: A가 lock을 잃는 사이 B가 같은 digest로 승격 — B의 산출물이 보존된다', () => {
    const w = world(); const sd = mkdtempSync(join(tmpdir(), 's4-shim-'));
    const n = nextOf(w);
    const lock = join(w.d, '.s4-promote.lock');
    const relp = join(w.d, 's4-capture', 'release.json');
    // A가 version/expected를 만든 뒤 B가 lock을 인계받아 같은 digest로 release를 완성한다.
    const off = shimAt2(sd, `    rm -f ${lock}; printf 'B' > ${lock}
    printf '%s' '${JSON.stringify(n)}' > ${relp}`);
    try {
      const r = promote(w);
      expect(r.promoted).toBe(false);
      // A는 실패하되 **정리하지 않는다** — 그 파일들이 곧 B의 release 본체다.
      expect(PROM.readRelease(w.d)).toEqual(n);
      for (const ph of ['light', 'dark']) expect(PROM.readCaptureBundle(w.d, ph).errors, ph).toEqual([]);
      const exp = PROM.readCommittedExpected(w.d);
      expect(exp.errors).toEqual([]);
      expect(exp.bytes).toBe(w.expectedBytes);
      expect(writeCounts(w)).toMatchObject({ versions: 2, expected: 1, release: 1 });
      expect(readFileSync(lock, 'utf8')).toBe('B');       // 남의 lock을 지우지 않았다
    } finally { off(); kill(w, sd); }
  }, 30000);

  // ── F3: candidate CAS 구간이 잠긴다 ──────────────────────────────────────────
  it('RED: 승격 진행 중 writeCandidate A→B는 lock에 막힌다 (stale A 승격 불가)', () => {
    const w = world(); const sd = mkdtempSync(join(tmpdir(), 's4-shim-'));
    const outp = join(sd, 'writeres.json');
    const runner = fileURLToPath(new URL('./s4CaptureRunner.mjs', import.meta.url));
    writeFileSync(join(sd, 'hijack.mjs'),
      `import {writeCandidate,readCandidateBundle,CANDIDATE_CAS_ANY} from ${JSON.stringify(runner)};`
      + `import {writeFileSync} from 'node:fs';`
      + `const e=writeCandidate({fixturesDir:${JSON.stringify(w.d)},phase:'light',contextRaw:'HIJACK',`
      + `pngByCaptureName:{'p1.png':Buffer.from([1,2,3])},expectedCaptureNames:['p1.png'],`
      + `expectedCurrentBundleName:CANDIDATE_CAS_ANY});`
      + `writeFileSync(${JSON.stringify(outp)},JSON.stringify({e,ptr:readCandidateBundle(`
      + `${JSON.stringify(w.d)},'light').bundleName||null}));`);
    const off = shimAt2(sd, `    ${process.execPath} ${join(sd, 'hijack.mjs')} >/dev/null 2>&1 || true`);
    try {
      const before = RUN.readCandidateBundle(w.d, 'light').bundleName;
      const r = promote(w);
      // 승격은 정상 완료된다 — 가로채기가 막혔기 때문이다.
      expect(r.errors).toEqual([]);
      expect(r.promoted).toBe(true);
      const hij = JSON.parse(readFileSync(outp, 'utf8'));
      expect(hij.e.join(' ')).toMatch(/WRITE_LOCK_BUSY/);      // A→B 시도가 lock에 막혔다
      expect(hij.ptr).toBe(before);                            // pointer는 그대로였다
      expect(RUN.readCandidateBundle(w.d, 'light').bundleName).toBe(before);
    } finally { off(); kill(w, sd); }
  }, 30000);

  it('RED: candidate lock이 이미 잡혀 있으면 승격이 시작하지 않는다', () => {
    const w = world();
    const held = RUN.acquireCandidateLock(w.d, 'dark');
    try {
      expect(held.ok).toBe(true);
      const r = promote(w);
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/PROMOTE_CANDIDATE_LOCK_BUSY dark/);
      expect(writeCounts(w)).toMatchObject({ versions: 0, expected: 0, release: 0 });
      // light lock은 반납됐다 — 실패해도 남의 것을 잡아두지 않는다.
      const l = RUN.acquireCandidateLock(w.d, 'light');
      expect(l.ok).toBe(true); l.release();
    } finally { held.release(); kill(w); }
  }, 30000);

  // ── F6: light/dark 실산출물을 모두 checked reader로 연다 ──────────────────────
  it('GREEN/RED: 승격 뒤 light·dark 양쪽이 열리고, dark 변조는 잡힌다', () => {
    const w = world();
    try {
      expect(promote(w).promoted).toBe(true);
      const rel = PROM.readRelease(w.d);
      for (const ph of ['light', 'dark']) {
        const b = PROM.readCaptureBundle(w.d, ph);
        expect(b.errors, ph).toEqual([]);
        expect(Object.keys(b.pngByName).sort(), ph).toEqual(['p1.png']);
        expect(JSON.parse(b.contextRaw).phase, ph).toBe(ph);
        expect(b.digest, ph).toBe(rel[ph]);
      }
      // dark PNG 변조 → digest 재계산으로 잡힌다.
      const dpng = join(w.d, 's4-capture', 'versions', rel.dark, 'shots', 'p1.png');
      const orig = readFileSync(dpng);
      writeFileSync(dpng, pngBytes(40, 30, 3));
      expect(PROM.readCaptureBundle(w.d, 'dark').errors.join(' ')).toMatch(/VERSION_TAMPERED/);
      expect(PROM.readCaptureBundle(w.d, 'light').errors).toEqual([]);   // light는 무관하다
      writeFileSync(dpng, orig);
      // dark context 삭제 → file set에서 잡힌다.
      rmSync(join(w.d, 's4-capture', 'versions', rel.dark, 'context.json'));
      expect(PROM.readCaptureBundle(w.d, 'dark').errors.join(' ')).toMatch(/VERSION_FILE_SET/);
      // dark version 디렉터리 통째 삭제.
      rmSync(join(w.d, 's4-capture', 'versions', rel.dark), { recursive: true, force: true });
      expect(PROM.readCaptureBundle(w.d, 'dark').errors.join(' ')).toMatch(/VERSION_MISSING/);
      expect(committedBundleAt(w.d, 'dark').absent).toBe(true);
    } finally { kill(w); }
  }, 30000);

  // ── 실제 승인 wrapper부터 promoteRelease까지 실제 함수로 연결된 positive ──────
  it('공식 승인 wrapper(approveForPromotion) → promoteRelease 실제 연결 positive', () => {
    const w = world();
    try {
      // approveForPromotion은 evaluator의 승인 구현을 **정적으로** 부른다. 여기서는
      // 그 wrapper가 실제로 bytes를 만들어 내는지만 본다(주입 파라미터가 없다).
      let wrote = null;
      const light = JSON.parse(w.cands.light.contextRaw);
      const a = PROM.approveForPromotion({
        repoDir: w.repo.dir, evidenceFiles: w.evidenceFiles, spec: w.spec,
        fixture: JSON.parse(w.expectedBytes), contrastResults: [],
        actualDecls: [], actualRaw: {}, preAnnSources: {}, actualAllowIdToKey: new Map(),
        baseDecls: sharedBaseDecls(),
        contextRaw: w.cands.light.contextRaw, sha256,
        readPng: (n) => { const b = w.cands.light.pngByName[n];
          return b ? { bytes: b, width: 40, height: 30 } : { bytes: Buffer.alloc(0) }; },
        provenanceRefs: { headCommit: w.repo.head, headBlobs: w.repo.blobs,
          specFingerprintNow: light.provenance.specFingerprint },
        serialize: (f) => JSON.stringify(f, null, 1), write: (b) => { wrote = b; },
      });
      // 승인 경로가 evidence·candidate·conformance를 전부 통과했다.
      expect(a.errors).toEqual([]);
      expect(typeof wrote).toBe('string');
      // 그 bytes를 그대로 승격에 넣으면 실제로 승격된다.
      const r = promote({ ...w, expectedBytes: wrote });
      expect(r.errors).toEqual([]);
      expect(r.promoted).toBe(true);
      expect(PROM.readCommittedExpected(w.d).bytes).toBe(wrote);
    } finally { kill(w); }
  }, 30000);

  it('RED: candidate CAS — 승인 뒤 candidate가 바뀌면 write 0', () => {
    const w = world();
    try {
      const { raw, png } = ctxFor('light', w.spec, w.repo);
      RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: w.d, phase: 'light', contextRaw: `${raw} `,
        pngByCaptureName: { 'p1.png': png }, expectedCaptureNames: ['p1.png'] });
      const r = promote(w);
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/PROMOTE_CANDIDATE_CAS|PROMOTE_CANDIDATE_DIGEST_CAS/);
      expect(PROM.readRelease(w.d)).toBe(null);
    } finally { kill(w); }
  }, 30000);

  it('RED: lock busy — write 0, 남의 lock 보존', () => {
    const w = world();
    try {
      writeFileSync(join(w.d, '.s4-promote.lock'), 'FOREIGN');
      const r = promote(w);
      expect(r).toEqual({ errors: ['PROMOTE_LOCK_BUSY'], promoted: false });
      expect(PROM.readRelease(w.d)).toBe(null);
      expect(readFileSync(join(w.d, '.s4-promote.lock'), 'utf8')).toBe('FOREIGN');
    } finally { kill(w); }
  }, 30000);

  // ── late authority: 자기 산출물은 GREEN, 그 밖의 변화는 전부 RED ──────────────
  it('RED: 무관한 untracked 파일 — allowance 밖이라 write 0', () => {
    const w = world();
    try {
      writeFileSync(join(w.repo.dir, 'frontend/library/UNRELATED.txt'), 'x');
      const r = promote(w);
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/PROMOTE_AUTHORITY_FAILED .*WORKTREE_DIRTY/);
      expect(r.errors.join(' ')).toContain('UNRELATED.txt');
      expect(PROM.readRelease(w.d)).toBe(null);
      expect(existsSync(join(w.d, 's4-capture', 'expected'))).toBe(false);
    } finally { kill(w); }
  }, 30000);

  it('RED: tracked 모듈 수정 — working이 HEAD와 다르면 write 0', () => {
    const w = world();
    try {
      writeFileSync(join(w.repo.dir, 'frontend/library/s4Spec.mjs'), '// tampered\n');
      const r = promote(w);
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/WORKTREE_DIRTY|WORKING_DIFFERS_FROM_HEAD/);
      expect(PROM.readRelease(w.d)).toBe(null);
    } finally { kill(w); }
  }, 30000);

  it('RED: staged 변경 — 허용 경로에 staged로 올려도 write 0', () => {
    const w = world();
    try {
      // 산출물과 **같은 이름**을 미리 staged로 올린다. `??`가 아니므로 허용되지 않는다.
      const rel = { expectedSha: sha256(w.expectedBytes),
        light: PROM.bundleDigest(w.cands.light.contextRaw, w.cands.light.pngByName),
        dark: PROM.bundleDigest(w.cands.dark.contextRaw, w.cands.dark.pngByName) };
      const p = join(w.repo.dir, outputsOf(w, rel)[0]);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, 'staged');
      execSync(`git -C ${w.repo.dir} add -f ${p}`, { stdio: 'ignore' });
      const r = promote(w);
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/PROMOTE_AUTHORITY_FAILED .*WORKTREE_DIRTY/);
      expect(PROM.readRelease(w.d)).toBe(null);
    } finally { kill(w); }
  }, 30000);

  it('RED: 허용 경로에 이름만 맞는 다른 내용을 심어두면 write 0', () => {
    const w = world();
    try {
      const rel = { expectedSha: sha256(w.expectedBytes),
        light: PROM.bundleDigest(w.cands.light.contextRaw, w.cands.light.pngByName),
        dark: PROM.bundleDigest(w.cands.dark.contextRaw, w.cands.dark.pngByName) };
      const p = join(w.repo.dir, `${FX_REL}/s4-capture/versions/${rel.light}/context.json`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, 'NOT-THE-CONTEXT');
      const r = promote(w);
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/ALLOWED_CONTENT|PROMOTE_VERSION_TAMPERED|VERSION_FILE_SET/);
      expect(PROM.readRelease(w.d)).toBe(null);
    } finally { kill(w); }
  }, 30000);

  it('RED: provenanceRefs가 정본 HEAD와 다르면 write 0', () => {
    const w = world();
    try {
      const r = promote(w, { provenanceRefs: { headCommit: 'a'.repeat(40), headBlobs: w.repo.blobs,
        specFingerprintNow: JSON.parse(w.cands.light.contextRaw).provenance.specFingerprint } });
      expect(r.promoted).toBe(false);
      // 두 겹이 있다: bundle 검증(EVIDENCE_PROVENANCE_HEAD)과 승격의 정본 cross-check
      // (PROMOTE_PROVENANCE_HEAD). 어느 쪽이 먼저 잡든 write는 0이어야 한다.
      expect(r.errors.join(' ')).toMatch(/PROVENANCE_HEAD/);
      expect(PROM.readRelease(w.d)).toBe(null);
    } finally { kill(w); }
  }, 30000);

  it('RED: fake 승인 함수·축소 hashedModules·임의 startHead를 넣어도 우회 불가', () => {
    const w = world();
    try {
      writeFileSync(join(w.repo.dir, 'frontend/library/UNRELATED.txt'), 'x');
      // 세 우회 시도를 **한꺼번에** 넣는다. 전부 무시되고 authority는 그대로 막는다.
      const r = promote(w, { hashedModules: [], startHead: 'b'.repeat(40),
        approveAndWrite: () => ({ errors: [], wrote: true, bytes: '{}' }) });
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/WORKTREE_DIRTY/);
      expect(PROM.readRelease(w.d)).toBe(null);
      // approveForPromotion에도 승인 함수를 넣을 자리가 없다 — 넣어도 evaluator 구현이 돈다.
      let called = 0;
      const a = PROM.approveForPromotion({ repoDir: w.repo.dir, evidenceFiles: w.evidenceFiles,
        spec: w.spec, approveAndWrite: () => { called += 1; return { errors: [], wrote: true, bytes: 'X' }; },
        serialize: (f) => JSON.stringify(f), write: () => {} });
      expect(called).toBe(0);
      expect(a.wrote).toBe(false);                      // 진짜 승인기는 계약 미충족으로 막았다
    } finally { kill(w); }
  }, 30000);

  it('GREEN: 앞선 실패가 남긴 것이 없어 재시도가 시작부터 막히지 않는다', () => {
    const w = world();
    try {
      writeFileSync(join(w.repo.dir, 'frontend/library/UNRELATED.txt'), 'x');
      expect(promote(w).promoted).toBe(false);
      rmSync(join(w.repo.dir, 'frontend/library/UNRELATED.txt'));
      // 실패한 실행이 산출물을 남겼다면 여기서 START authority가 죽는다(선재현된 경로다).
      expect(dirtyOf(w.repo)).toEqual([]);
      const r = promote(w);
      expect(r.errors).toEqual([]);
      expect(r.promoted).toBe(true);
    } finally { kill(w); }
  }, 30000);

  it('RED: expected tamper — 정확한 이름으로 심어둬도 잡힌다', () => {
    const w = world();
    try {
      mkdirSync(join(w.d, 's4-capture', 'expected'), { recursive: true });
      writeFileSync(PROM.expectedPath(w.d, sha256(w.expectedBytes)), '{"tampered":1}');
      const r = promote(w);
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/ALLOWED_CONTENT|PROMOTE_EXPECTED_TAMPERED/);
      expect(PROM.readRelease(w.d)).toBe(null);
    } finally { kill(w); }
  }, 30000);

  it('RED: expected dir이 외부 symlink면 외부 write 0, pointer 불변', () => {
    const w = world(); const outside = mkdtempSync(join(tmpdir(), 's4-out-'));
    try {
      mkdirSync(join(w.d, 's4-capture'), { recursive: true });
      symlinkSync(outside, join(w.d, 's4-capture', 'expected'));
      const r = promote(w);
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/NODE_SYMLINK|NODE_ESCAPES|PATH_ESCAPES/);
      expect(readdirSync(outside)).toEqual([]);          // 밖에 아무것도 안 썼다
      expect(PROM.readRelease(w.d)).toBe(null);
    } finally { kill(w, outside); }
  }, 30000);

  // ── checked reader: release/version 노드 안전성 ──────────────────────────────
  it('RED: release.json이 외부 symlink면 읽기 자체가 막힌다 — 외부 read 0', () => {
    const w = world(); const outside = mkdtempSync(join(tmpdir(), 's4-out-'));
    try {
      expect(promote(w).promoted).toBe(true);
      const real = PROM.readRelease(w.d);
      const ext = join(outside, 'release.json');
      writeFileSync(ext, JSON.stringify(real, null, 1));
      rmSync(join(w.d, 's4-capture', 'release.json'));
      symlinkSync(ext, join(w.d, 's4-capture', 'release.json'));
      const c = PROM.readReleaseChecked(w.d);
      expect(c.errors.join(' ')).toMatch(/RELEASE_NODE_SYMLINK|RELEASE_NODE_ESCAPES/);
      expect(c.release).toBe(null);
      expect(PROM.readRelease(w.d)).toBe(null);
      // 같은 checked reader를 쓰는 두 경로가 함께 막힌다.
      expect(PROM.readCaptureBundle(w.d, 'light').errors.length).toBeGreaterThan(0);
      expect(PROM.readCommittedExpected(w.d).bytes).toBe(null);
    } finally { kill(w, outside); }
  }, 30000);

  it('RED: release digest에 traversal을 넣으면 스키마에서 먼저 막힌다', () => {
    const w = world();
    try {
      expect(promote(w).promoted).toBe(true);
      const rel = PROM.readRelease(w.d);
      writeFileSync(join(w.d, 's4-capture', 'release.json'),
        JSON.stringify({ ...rel, light: '../../../../etc' }, null, 1));
      expect(PROM.validateReleaseShape({ ...rel, light: '../../../../etc' }))
        .toEqual(['RELEASE_VALUE light ../../../../etc']);
      expect(PROM.readCaptureBundle(w.d, 'light').errors).toEqual(['RELEASE_VALUE light ../../../../etc']);
      expect(PROM.readCommittedExpected(w.d).errors).toEqual(['RELEASE_VALUE light ../../../../etc']);
    } finally { kill(w); }
  }, 30000);

  it('RED: version 안의 context/shots/PNG가 symlink면 controlled RED', () => {
    const w = world(); const outside = mkdtempSync(join(tmpdir(), 's4-out-'));
    try {
      expect(promote(w).promoted).toBe(true);
      const rel = PROM.readRelease(w.d);
      const vdir = join(w.d, 's4-capture', 'versions', rel.light);
      writeFileSync(join(outside, 'ctx'), w.cands.light.contextRaw);
      rmSync(join(vdir, 'context.json'));
      symlinkSync(join(outside, 'ctx'), join(vdir, 'context.json'));
      const v = PROM.readVersionChecked(w.d, rel.light);
      expect(v.errors.join(' ')).toMatch(/VERSION_NODE_SYMLINK/);
      // capture bundle 경로도 같은 reader를 쓰므로 같이 막힌다.
      expect(PROM.readCaptureBundle(w.d, 'light').errors.join(' ')).toMatch(/VERSION_NODE_SYMLINK/);
    } finally { kill(w, outside); }
  }, 30000);

  it('RED: version 디렉터리에 여분 파일이 있으면 file set에서 잡힌다', () => {
    const w = world();
    try {
      expect(promote(w).promoted).toBe(true);
      const rel = PROM.readRelease(w.d);
      writeFileSync(join(w.d, 's4-capture', 'versions', rel.dark, 'EXTRA'), 'x');
      expect(PROM.readVersionChecked(w.d, rel.dark).errors.join(' ')).toMatch(/VERSION_FILE_SET/);
      expect(PROM.readCaptureBundle(w.d, 'dark').errors.join(' ')).toMatch(/VERSION_FILE_SET/);
    } finally { kill(w); }
  }, 30000);

  // ── lock ownership ──────────────────────────────────────────────────────────
  it('RED: lock이 교체되면 pointer write 0이고 남의 lock을 지우지 않는다', () => {
    const w = world(); const shimDir = mkdtempSync(join(tmpdir(), 's4-git-'));
    const realGit = execSync('command -v git', { encoding: 'utf8' }).trim();
    const prevPath = process.env.PATH;
    try {
      // `git status`가 두 번째로 불리는 순간 = **late authority 시점**에 lock을 교체한다.
      // 이 시점 이후 promoteRelease는 pointer를 쓰기 직전에 소유권을 다시 본다.
      const cnt = join(shimDir, 'count');
      const lock = join(w.d, '.s4-promote.lock');
      writeFileSync(join(shimDir, 'git'), `#!/bin/sh
if [ "$3" = "status" ]; then
  n=$(cat ${cnt} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${cnt}
  if [ "$n" = "2" ]; then rm -f ${lock}; printf 'OTHER' > ${lock}; fi
fi
exec ${realGit} "$@"
`);
      execSync(`chmod +x ${join(shimDir, 'git')}`);
      process.env.PATH = `${shimDir}:${prevPath}`;
      const r = promote(w);
      expect(r.promoted).toBe(false);
      expect(r.errors).toEqual(['PROMOTE_LOCK_OWNERSHIP_LOST']);
      expect(PROM.readRelease(w.d)).toBe(null);
      // 남의 lock은 그대로 남아 있어야 한다 — 지우면 상호배제를 두 번 깬다.
      expect(readFileSync(lock, 'utf8')).toBe('OTHER');
    } finally { process.env.PATH = prevPath; kill(w, shimDir); }
  }, 30000);

  it('RED: pointer write 실패 — 이전 release+expected가 계속 선택된다', () => {
    const w = world();
    try {
      expect(promote(w).promoted).toBe(true);
      const first = PROM.readRelease(w.d);
      const firstExp = PROM.readCommittedExpected(w.d);
      // release.json을 디렉터리로 바꿔 다음 pointer write를 실패시킨다.
      rmSync(join(w.d, 's4-capture', 'release.json'));
      mkdirSync(join(w.d, 's4-capture', 'release.json'));
      const r = promote({ ...w, expectedBytes: `${w.expectedBytes} ` }, { fromRelease: null });
      expect(r.promoted).toBe(false);
      // pointer를 원복하면 이전 release+expected가 그대로 유효하다.
      rmSync(join(w.d, 's4-capture', 'release.json'), { recursive: true, force: true });
      writeFileSync(join(w.d, 's4-capture', 'release.json'), JSON.stringify(first, null, 1));
      expect(PROM.readRelease(w.d)).toEqual(first);
      expect(PROM.readCommittedExpected(w.d).bytes).toBe(firstExp.bytes);
    } finally { kill(w); }
  }, 30000);

  it('release가 있으면 committed reader가 실제로 읽는다 (skip 11개의 전제)', () => {
    const w = world();
    try {
      expect(promote(w).promoted).toBe(true);
      const b = committedBundleAt(w.d, 'light');
      expect(b.absent).toBe(false);
      expect(b.fixtureRaw).toBe(w.expectedBytes);
      expect(Object.keys(b.pngByName)).toEqual(['p1.png']);
      // dark도 같은 reader로 읽힌다.
      expect(committedBundleAt(w.d, 'dark').absent).toBe(false);
    } finally { kill(w); }
  }, 30000);

  // **non-skip clean baseline.** release가 커밋되기 전에도 "정상 산출물이면 오류 0"이
  // 행동으로 증명돼야 한다 — 그러지 않으면 committed gate의 정답이 검증되지 않은 채 남는다.
  it('실제 release에 대한 validateCommittedArtifacts clean baseline은 []', () => {
    const w = world();
    try {
      expect(promote(w).promoted).toBe(true);
      const b = committedBundleAt(w.d, 'light');
      expect(b.absent).toBe(false);
      const light = JSON.parse(b.contextRaw);
      const errs = EV.validateCommittedArtifacts({
        committedFixtureRaw: b.fixtureRaw, spec: w.spec, contextRaw: b.contextRaw, sha256,
        readPng: (n) => { const x = b.pngByName[n]; return x ? { bytes: x, width: 40, height: 30 } : null; },
        baseDecls: sharedBaseDecls(),
        provenanceRefs: { headCommit: w.repo.head, headBlobs: w.repo.blobs,
          specFingerprintNow: light.provenance.specFingerprint },
      });
      expect(errs).toEqual([]);
    } finally { kill(w); }
  }, 30000);
});

describe('S4 승격 활성 — 열려 있어도 계약 없이는 쓰지 않는다', () => {
  it('PROMOTION_ENABLED는 true지만 잘못된 인자로는 아무것도 쓰지 않는다', () => {
    expect(PROM.PROMOTION_ENABLED).toBe(true);
    const d = mkdtempSync(join(tmpdir(), 's4-hd-'));
    try {
      const r = PROM.promoteRelease({ fixturesDir: d, spec: {}, provenanceRefs: {}, fixture: {}, expectedBytes: '{}' });
      expect(r.promoted).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
      expect(readdirSync(d)).toEqual([]);                    // 디렉터리조차 만들지 않는다
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it('spec 누락은 즉시 fail-closed', () => {
    const d = mkdtempSync(join(tmpdir(), 's4-hd2-'));
    try {
      expect(PROM.promoteRelease({ fixturesDir: d, spec: null, provenanceRefs: {}, fixture: {}, expectedBytes: '{}' }))
        .toEqual({ errors: ['PROMOTE_SPEC_REQUIRED'], promoted: false });
      expect(readdirSync(d)).toEqual([]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it('repoDir 누락은 fail-closed — Git resolver를 만들 수 없다', () => {
    const d = mkdtempSync(join(tmpdir(), 's4-hd3-'));
    try {
      const r = PROM.promoteRelease({ fixturesDir: d, spec: SPEC, provenanceRefs: {}, fixture: {}, expectedBytes: '{}' });
      expect(r).toEqual({ errors: ['PROMOTE_REPO_DIR_REQUIRED'], promoted: false });
      expect(readdirSync(d)).toEqual([]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it('evidence 누락도 fail-closed', () => {
    const d = mkdtempSync(join(tmpdir(), 's4-hd4-'));
    try {
      const r = PROM.promoteRelease({ fixturesDir: d, spec: SPEC, provenanceRefs: {}, fixture: {},
        expectedBytes: '{}', repoDir: '/nonexistent-repo' });
      expect(r).toEqual({ errors: ['PROMOTE_EVIDENCE_REQUIRED'], promoted: false });
      expect(readdirSync(d)).toEqual([]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it('caller는 Git resolver를 주지 못한다 — 모듈이 스스로 해석한다', () => {
    const src = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function promoteRelease'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).not.toContain('discoveryEvidence.gitBlob');
    expect(body).toContain('promoteGitBlob(repoDir, canonPaths, ref, rel)');
    // 러너는 단일 argv 함수(gitAuthority)로 통일됐다 — 문자열 보간이 없다.
    expect(src).toContain("return gitAuthority(repoDir, 'rev-parse', `${ref}:${rel}`).trim();");
    expect(src).toContain('const gitAuthority = (repoDir, ...args) => gitArgv([');
  });
  it('spec은 진입 직후 정확히 한 번 동결된다', () => {
    const src = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function promoteRelease'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect((body.match(/snapshotSpec\(/g) || [])).toHaveLength(1);
    expect(body.indexOf('snapshotSpec(rawSpec)')).toBeLessThan(body.indexOf('verifyDiscoveryEvidence('));
    // 루트 getter가 조회마다 다른 값을 줘도 조회는 1회다.
    let reads = 0;
    const proxy = {};
    for (const k of Object.keys(SPEC)) {
      if (k === 'PROVENANCE_BLOB_PATHS') Object.defineProperty(proxy, k,
        { enumerable: true, get() { reads += 1; return SPEC[k]; } });
      else Object.defineProperty(proxy, k, { enumerable: true, value: SPEC[k] });
    }
    const d = mkdtempSync(join(tmpdir(), 's4-snap-'));
    try {
      PROM.promoteRelease({ fixturesDir: d, spec: proxy, provenanceRefs: {}, fixture: {},
        expectedBytes: '{}', repoDir: '/nonexistent-repo', discoveryEvidence: { files: {} } });
    } finally { rmSync(d, { recursive: true, force: true }); }
    expect(reads).toBe(1);
  });
  it('승격 CLI가 projector 경로에 배선돼 있다', () => {
    const src = readFileSync(new URL('../scripts/s4-promote-capture.mjs', import.meta.url), 'utf8');
    expect(src).not.toContain('PROMOTE_NOT_WIRED');
    expect(src).toContain('PROJ.buildProjection(');
    expect(src).toContain('PROJ.buildProjectedFixture(');
    expect(src).toContain('approveForPromotion({');
    // 승인 함수를 넘기지 않는다 — s4Promote가 evaluator 구현을 정적으로 부른다.
    expect(src).not.toContain('approveAndWrite');
    expect(src).toContain('approveForPromotion({');
    expect(src).toContain('promoteRelease({');
    expect(src).toContain('candidates: cands');
    // authority 입력을 넘기지 않는다 — 승격이 스스로 파생한다.
    expect(src).not.toContain('hashedModules:');
    expect(src).not.toContain('startHead:');

    expect(src).toContain('readCandidateBundle(fixturesDir, phase)');
    // projection을 복제하지 않는다 — 공유 모듈만 쓴다.
    expect(src).not.toContain('evaluateProjection(');
    expect(src).not.toContain('buildFixture({');
    // resolver를 넘기지 않는다.
    expect(src).not.toContain('gitBlob:');
  });
  it('생성기와 승격이 같은 projection 구현을 쓴다', () => {
    const gen = readFileSync(new URL('../scripts/s4-gen.mjs', import.meta.url), 'utf8');
    const pro = readFileSync(new URL('../scripts/s4-promote-capture.mjs', import.meta.url), 'utf8');
    for (const src of [gen, pro]) {
      expect(src).toContain("from '../library/s4Projection.mjs'");
      expect(src).toContain('PROJ.buildProjection(');
      expect(src).not.toContain('EV.evaluateProjection(');
    }
  });
});

// ── dataset 계약 ────────────────────────────────────────────────────────────
describe('S4 dataset 계약 — manifest가 단일 원천이고 파생이 유지된다', () => {
  // **합성 world를 쓴다.** production manifest를 복제해 시험하면 계약 검사가 production
  // 형태에 묶이고, 검사 대상 값으로 기대값을 만들게 된다.
  const SC = () => SYN_SC();
  const cloneMan = () => JSON.parse(JSON.stringify(SYN_MANIFEST));
  // manifest를 바꾸면 DATASET_ENDPOINTS도 **같이** 파생돼야 한다 — 실제 파생식을 그대로 쓴다.
  const specOf = (man) => ({ ...SYN_SPEC(), EXPECTED_DATASET_MANIFEST: man,
    DATASET_ENDPOINTS: (man && man.dataset ? man.dataset : []).map((e) => e.urlTemplate) });
  const run = (man, sc) => EV.validateDatasetContract(specOf(man), sc || SC());

  it('positive control — 합성 world와 production 둘 다 errors === []', () => {
    expect(EV.validateDatasetContract(SYN_SPEC(), SYN_SC())).toEqual([]);
    expect(EV.validateDatasetContract(SPEC, EV.buildActionContext(CAP.CAPTURE_SCENARIO))).toEqual([]);
    expect(SPEC.EXPECTED_DATASET_MANIFEST).not.toBe(null);
  });
  it('생성기 dsManifest(2)가 손으로 적은 SYN_MANIFEST와 같다', () => {
    // 산술을 두 번 적었으니 둘이 갈리면 어느 쪽이든 틀린 것이다.
    expect(dsManifest(2)).toEqual(SYN_MANIFEST);
  });
  it('production manifest의 category 크기는 커밋된 증거가 판정한다', () => {
    // 여기서는 사람이 검수한 숫자만 고정하고, 그것이 맞는지는 verifyDiscoveryEvidence가 본다.
    expect(SPEC.EXPECTED_DATASET_MANIFEST.dataset).toHaveLength(17);
    expect(SPEC.EXPECTED_DATASET_MANIFEST.ambient).toHaveLength(1);
    expect(SPEC.EXPECTED_DATASET_MANIFEST.dev).toHaveLength(2);
  });

  it('DATASET_ENDPOINTS는 manifest.dataset에서 파생된다', () => {
    expect(SPEC.DATASET_ENDPOINTS)
      .toEqual(SPEC.EXPECTED_DATASET_MANIFEST.dataset.map((e) => e.urlTemplate));
    // 소스에 두 번째 수기 배열이 없다 — 파생식 한 줄뿐이어야 한다.
    const src = readFileSync(new URL('./s4Spec.mjs', import.meta.url), 'utf8');
    expect(src).toContain('EXPECTED_DATASET_MANIFEST.dataset.map((entry) => entry.urlTemplate)');
    expect(src.match(/export const DATASET_ENDPOINTS/g)).toHaveLength(1);
  });

  it('RED: manifest가 null이면 계약이 성립하지 않는다', () => {
    expect(run(null)).toEqual(['DATASET_MANIFEST_NULL']);
    expect(EV.validateDatasetContract({}, SC())).toEqual(['DATASET_MANIFEST_NULL']);
  });

  it('RED: dataset entry 삭제 — evidence 파생 대조에서 죽는다', () => {
    const m = cloneMan(); m.dataset.splice(2, 1);
    const e = run(m).join(' ');
    expect(e).toMatch(/DATASET_EVIDENCE_COUNT backendUniqueUrlCount 6 != 5/);
    expect(e).toMatch(/DATASET_EVIDENCE_COUNT backendTupleCount/);
  });

  it('RED: ambient entry를 dataset으로 옮김', () => {
    const m = cloneMan();
    m.dataset.push(m.ambient.pop());
    m.dataset.sort((a, b) => (a.urlTemplate < b.urlTemplate ? -1 : 1));
    const e = run(m).join(' ');
    expect(e).toMatch(/DATASET_AMBIENT_IN_DATASET \{apiOrigin\}\/notifications\?limit=30/);
    expect(e).toMatch(/DATASET_AMBIENT_MISSING/);
  });

  it('RED: dev endpoint를 dataset으로 옮김', () => {
    const m = cloneMan();
    m.dataset.push(m.dev.pop());
    m.dataset.sort((a, b) => (a.urlTemplate < b.urlTemplate ? -1 : 1));
    const e = run(m).join(' ');
    // dev는 appOrigin이므로 dataset에 들어오면 origin 계약에서 죽는다.
    expect(e).toMatch(/DATASET_ORIGIN_MISMATCH dataset\[\d+\].*want \{apiOrigin\}/);
  });

  it('RED: category 간 교집합', () => {
    const m = cloneMan();
    m.ambient.push(JSON.parse(JSON.stringify(m.dataset[0])));
    expect(run(m).join(' ')).toMatch(/DATASET_TEMPLATE_DUPLICATE \{apiOrigin\}\/branches \(dataset, ambient\)/);
  });

  it('RED: category 내 중복 URL', () => {
    const m = cloneMan();
    m.dataset[1] = JSON.parse(JSON.stringify(m.dataset[0]));
    expect(run(m).join(' ')).toMatch(/DATASET_TEMPLATE_DUPLICATE \{apiOrigin\}\/branches \(dataset, dataset\)/);
  });

  it('RED: 헤더 뱃지 endpoint 삭제 — chat / unread-count', () => {
    for (const t of ['{apiOrigin}/chat', '{apiOrigin}/notifications/unread-count']) {
      const m = cloneMan();
      m.dataset = m.dataset.filter((e) => e.urlTemplate !== t);
      expect(run(m).join(' ')).toMatch(new RegExp(`DATASET_BADGE_ENDPOINT_MISSING ${t.replace(/[{}?/]/g, '\\$&')}`));
    }
  });

  it('RED: notification-list를 두 category에 중복', () => {
    const m = cloneMan();
    m.dataset.push(JSON.parse(JSON.stringify(m.ambient[0])));
    m.dataset.sort((a, b) => (a.urlTemplate < b.urlTemplate ? -1 : 1));
    const e = run(m).join(' ');
    expect(e).toMatch(/DATASET_TEMPLATE_DUPLICATE/);
    expect(e).toMatch(/DATASET_AMBIENT_IN_DATASET/);
  });

  it('RED: 상대 URL', () => {
    const m = cloneMan();
    m.dataset[0] = { ...m.dataset[0], urlTemplate: '/api/branches' };
    expect(run(m).join(' ')).toMatch(/DATASET_RELATIVE_URL dataset\[0\] \/api\/branches/);
  });

  it('RED: 잘못된 origin', () => {
    const m = cloneMan();
    m.dataset[0] = { ...m.dataset[0], urlTemplate: '{appOrigin}/branches' };
    expect(run(m).join(' ')).toMatch(/DATASET_ORIGIN_MISMATCH dataset\[0\].*want \{apiOrigin\}/);
    const m2 = cloneMan();
    m2.dev[0] = { ...m2.dev[0], urlTemplate: '{apiOrigin}/_next/static/development/_devMiddlewareManifest.json' };
    expect(run(m2).join(' ')).toMatch(/DATASET_ORIGIN_MISMATCH dev\[0\].*want \{appOrigin\}/);
  });

  it('RED: unresolved {bulkBranchId} — 시나리오에 값이 없으면 해석 실패', () => {
    const sc = { ...SC() }; delete sc.bulkBranchId;
    const e = EV.validateDatasetContract(SYN_SPEC(), sc).join(' ');
    expect(e).toMatch(/DATASET_SCENARIO_BULKBRANCHID_MISSING/);
    expect(e).toMatch(/DATASET_UNRESOLVED_PLACEHOLDER dataset\[\d+\] \{bulkBranchId\}/);
  });

  it('RED: bulkBranchId/bulkEpicId 누락은 각각 fail-closed', () => {
    for (const k of ['bulkBranchId', 'bulkEpicId']) {
      const sc = { ...SC() }; delete sc[k];
      expect(EV.validateDatasetContract(SYN_SPEC(), sc).join(' '))
        .toMatch(new RegExp(`DATASET_SCENARIO_${k.toUpperCase()}_MISSING`));
    }
    // 정수가 아니면 거부한다 — 문자열 '13'은 URL은 만들어지지만 계약상 ID가 아니다.
    expect(EV.validateDatasetContract(SYN_SPEC(), { ...SC(), bulkBranchId: '13' }).join(' '))
      .toMatch(/DATASET_SCENARIO_BULKBRANCHID_MISSING/);
  });

  it('RED: category 정렬이 깨지면 거부', () => {
    const m = cloneMan(); m.dataset.reverse();
    expect(run(m).join(' ')).toMatch(/DATASET_CATEGORY_UNSORTED dataset/);
  });

  it('RED: evidence SHA 형식 오류', () => {
    for (const k of ['observedSpecFingerprint', 'discoveryDigest']) {
      const m = cloneMan(); m.evidence[k] = 'deadbeef';
      expect(run(m).join(' ')).toMatch(new RegExp(`DATASET_EVIDENCE_SHA ${k}`));
    }
    // observedHead는 git commit(40 hex)이다 — 64 hex를 넣으면 거부해야 한다.
    const m2 = cloneMan(); m2.evidence.observedHead = 'a'.repeat(64);
    expect(run(m2).join(' ')).toMatch(/DATASET_EVIDENCE_COMMIT observedHead/);
  });

  it('RED: evidence count 변조 — 파생 대조라 사본이 틀리면 죽는다', () => {
    for (const k of ['surfaceCount', 'semanticTupleCount', 'backendTupleCount', 'backendUniqueUrlCount']) {
      const m = cloneMan(); m.evidence[k] = m.evidence[k] + 1;
      expect(run(m).join(' ')).toMatch(new RegExp(`DATASET_EVIDENCE_COUNT ${k}`));
    }
    // entry의 observed count를 바꾸면 evidence 합계와 어긋난다.
    const m2 = cloneMan(); m2.dataset[0].observedSurfaceCount += 1;
    const e = run(m2).join(' ');
    expect(e).toMatch(/DATASET_EVIDENCE_COUNT backendTupleCount/);
    expect(e).toMatch(/DATASET_EVIDENCE_COUNT semanticTupleCount/);
  });

  it('RED: unknown category / unknown field', () => {
    const m = cloneMan(); m.extra = [];
    expect(run(m).join(' ')).toMatch(/DATASET_MANIFEST_FIELDS/);
    const m2 = cloneMan(); delete m2.ambient;
    expect(run(m2).join(' ')).toMatch(/DATASET_MANIFEST_FIELDS|DATASET_CATEGORY_MISSING ambient/);
    const m2b = cloneMan(); m2b.ambient = 'not-an-array';
    expect(run(m2b).join(' ')).toMatch(/DATASET_CATEGORY_MISSING ambient/);   // throw하지 않는다
    const m3 = cloneMan(); m3.dataset[0] = { ...m3.dataset[0], note: 'x' };
    expect(run(m3).join(' ')).toMatch(/DATASET_ENTRY_FIELDS dataset\[0\]/);
    const m4 = cloneMan(); m4.evidence.extra = 1;
    expect(run(m4).join(' ')).toMatch(/DATASET_EVIDENCE_FIELDS/);
    const m5 = cloneMan(); m5.schemaVersion = 2;
    expect(run(m5).join(' ')).toMatch(/DATASET_MANIFEST_SCHEMA_VERSION 2/);
    const m6 = cloneMan(); m6.dataset[0] = { ...m6.dataset[0], method: 'POST' };
    expect(run(m6).join(' ')).toMatch(/DATASET_ENTRY_METHOD dataset\[0\] POST/);
  });

  it('RED: DATASET_ENDPOINTS를 manifest와 따로 변조하면 파생이 깨진 것으로 잡힌다', () => {
    const base = SYN_SPEC();
    const s = { ...base, DATASET_ENDPOINTS: [...base.DATASET_ENDPOINTS, '{apiOrigin}/extra'] };
    expect(EV.validateDatasetContract(s, SC()).join(' ')).toMatch(/DATASET_ENDPOINTS_NOT_DERIVED/);
    const s2 = { ...base, DATASET_ENDPOINTS: base.DATASET_ENDPOINTS.slice(0, 2) };
    expect(EV.validateDatasetContract(s2, SC()).join(' ')).toMatch(/DATASET_ENDPOINTS_NOT_DERIVED/);
    const s3 = { ...base, DATASET_ENDPOINTS: [...base.DATASET_ENDPOINTS].reverse() };
    expect(EV.validateDatasetContract(s3, SC()).join(' ')).toMatch(/DATASET_ENDPOINTS_NOT_DERIVED/);
  });

  it('RED: dataset이 0개면 계약이 아니다', () => {
    const m = cloneMan(); m.dataset = [];
    expect(run(m).join(' ')).toMatch(/DATASET_ENDPOINTS_EMPTY/);
  });

  it('manifest entry를 바꾸면 specFingerprint가 바뀐다', () => {
    const sha = (v) => createHash('sha256').update(v).digest('hex');
    const base = EV.specFingerprint(EV.snapshotSpec(SPEC).spec, sha);
    const pm = JSON.parse(JSON.stringify(SPEC.EXPECTED_DATASET_MANIFEST));
    pm.dataset[0].reason = `${pm.dataset[0].reason} (변경)`;
    const mutated = EV.specFingerprint(EV.snapshotSpec({ ...SPEC,
      EXPECTED_DATASET_MANIFEST: pm, DATASET_ENDPOINTS: pm.dataset.map((e) => e.urlTemplate) }).spec, sha);
    expect(mutated).not.toBe(base);
    expect(EV.FINGERPRINT_PAYLOAD_KEYS).toContain('expectedDatasetManifest');
  });
});

// ── 시나리오 ID/이름 결속 ────────────────────────────────────────────────────
describe('S4 시나리오 신원 — ID와 이름이 같은 대상을 가리킨다', () => {
  const SC = () => EV.buildActionContext(CAP.CAPTURE_SCENARIO);
  // 필드명은 라이브 응답에서 확인한 것이다: branches[].branch_id/branch_name,
  // epics[].epic_id/epic_name. 추측한 이름을 쓰면 계약이 아무것도 검사하지 않는다.
  const RESP = (over = {}) => {
    const sc = SC();
    const branches = over.branches !== undefined ? over.branches
      : [{ branch_id: 13, branch_name: '- Alpha', key: 'ALPHA' }];
    const epics = over.epics !== undefined ? over.epics
      : [{ epic_id: 7, epic_name: 'Alpha Epic', task_count: 1 }];
    const out = [];
    if (!over.dropBranches) out.push({ url: `${sc.apiOrigin}/branches`,
      status: over.branchStatus === undefined ? 200 : over.branchStatus, body: JSON.stringify({ status: true, branches }) });
    if (!over.dropEpics) out.push({ url: `${sc.apiOrigin}/branches/13/epics`,
      status: 200, body: JSON.stringify({ status: true, epics }) });
    return out;
  };

  it('positive control — 정본 시나리오와 실제 형태의 응답이면 errors === []', () => {
    expect(EV.validateScenarioIdentity(SC(), RESP())).toEqual([]);
  });

  it('RED: branch 이름 불일치', () => {
    const r = RESP({ branches: [{ branch_id: 13, branch_name: '- Beta' }] });
    expect(EV.validateScenarioIdentity(SC(), r).join(' '))
      .toMatch(/IDENTITY_NAME_MISMATCH branch branch_id=13 "- Beta" != "- Alpha"/);
  });

  it('RED: epic 이름 불일치', () => {
    const r = RESP({ epics: [{ epic_id: 7, epic_name: 'Beta Epic' }] });
    expect(EV.validateScenarioIdentity(SC(), r).join(' '))
      .toMatch(/IDENTITY_NAME_MISMATCH epic epic_id=7 "Beta Epic" != "Alpha Epic"/);
  });

  it('RED: 해당 ID의 엔트리 부재', () => {
    expect(EV.validateScenarioIdentity(SC(), RESP({ branches: [{ branch_id: 99, branch_name: '- Alpha' }] })).join(' '))
      .toMatch(/IDENTITY_ENTRY_ABSENT branch branch_id=13/);
    expect(EV.validateScenarioIdentity(SC(), RESP({ epics: [] })).join(' '))
      .toMatch(/IDENTITY_ENTRY_ABSENT epic epic_id=7/);
  });

  it('RED: ID 누락', () => {
    const sc = { ...SC() }; delete sc.bulkBranchId;
    expect(EV.validateScenarioIdentity(sc, RESP()).join(' ')).toMatch(/IDENTITY_ID_MISSING branch/);
    const sc2 = { ...SC() }; delete sc2.bulkEpicId;
    expect(EV.validateScenarioIdentity(sc2, RESP()).join(' ')).toMatch(/IDENTITY_ID_MISSING epic/);
  });

  it('RED: 응답 자체가 없거나 200이 아니거나 목록 키가 없다', () => {
    expect(EV.validateScenarioIdentity(SC(), RESP({ dropBranches: true })).join(' '))
      .toMatch(/IDENTITY_RESPONSE_MISSING .*\/branches/);
    expect(EV.validateScenarioIdentity(SC(), RESP({ branchStatus: 500 })).join(' '))
      .toMatch(/IDENTITY_RESPONSE_STATUS .*\/branches 500/);
    const sc = SC();
    const bad = [{ url: `${sc.apiOrigin}/branches`, status: 200, body: JSON.stringify({ status: true }) },
      { url: `${sc.apiOrigin}/branches/13/epics`, status: 200, body: 'not json' }];
    const e = EV.validateScenarioIdentity(sc, bad).join(' ');
    expect(e).toMatch(/IDENTITY_LIST_MISSING .*\/branches \.branches/);
    expect(e).toMatch(/IDENTITY_UNPARSEABLE .*\/epics/);
  });

  it('RED: 다른 branch의 epics를 봐도 통과하지 않는다 — URL이 ID로 결속된다', () => {
    const sc = SC();
    // epic 응답을 branch 99의 것으로 두면 13의 epics는 관찰되지 않은 것이다.
    const r = [...RESP({ dropEpics: true }),
      { url: `${sc.apiOrigin}/branches/99/epics`, status: 200,
        body: JSON.stringify({ status: true, epics: [{ epic_id: 7, epic_name: 'Alpha Epic' }] }) }];
    expect(EV.validateScenarioIdentity(sc, r).join(' '))
      .toMatch(/IDENTITY_RESPONSE_MISSING .*\/branches\/13\/epics/);
  });
});

// ── body/digest 계약 ────────────────────────────────────────────────────────
describe('S4 dataset digest — raw body가 identity를 결정한다', () => {
  const sha = (v) => createHash('sha256').update(v).digest('hex');
  const U = 'http://localhost:10001/api/tracks/5/items';
  const V = 'http://localhost:10001/api/branches';
  const R = (body, url = U, status = 200) => ({ url, status, body });
  const d = (rs) => EV.datasetDigest(rs, SPEC, sha);

  it('같은 raw responses → 같은 digest', () => {
    const a = d([R('{"items":[{"id":1,"t":"a"},{"id":2,"t":"b"}]}')]);
    const b = d([R('{"items":[{"id":1,"t":"a"},{"id":2,"t":"b"}]}')]);
    expect(a.errors).toEqual([]);
    expect(a.digest).toBe(b.digest);
    // 키 순서만 다른 동일 객체는 canonicalize되어 같은 digest여야 한다.
    expect(d([R('{"items":[{"t":"a","id":1},{"id":2,"t":"b"}]}')]).digest).toBe(a.digest);
  });

  it('body 한 글자 변경 → 다른 digest', () => {
    const a = d([R('{"items":[{"id":1,"t":"a"}]}')]);
    const b = d([R('{"items":[{"id":1,"t":"b"}]}')]);
    expect(a.digest).not.toBe(b.digest);
  });

  it('response array 순서 변경 → 기본적으로 다른 digest', () => {
    const a = d([R('{"items":[{"id":1},{"id":2}]}')]);
    const b = d([R('{"items":[{"id":2},{"id":1}]}')]);
    expect(a.digest).not.toBe(b.digest);
    // 이 성질은 예외 목록이 비어 있기 때문에 성립한다.
    expect(SPEC.DATASET_UNORDERED_PATHS).toEqual([]);
    expect(SPEC.DATASET_VOLATILE_FIELDS).toEqual({});
  });

  it('status != 200 → RED', () => {
    const r = d([R('{"items":[]}', U, 500)]);
    expect(r.digest).toBe(null);
    expect(r.errors.join(' ')).toMatch(/DATASET_STATUS .*items 500/);
    expect(d([R('{"items":[]}', U, 204)]).digest).toBe(null);
  });

  it('endpoint 누락/추가 → 다른 digest', () => {
    const both = d([R('{"a":1}', U), R('{"b":2}', V)]);
    expect(both.digest).not.toBe(d([R('{"a":1}', U)]).digest);
    expect(both.digest).not.toBe(d([R('{"a":1}', U), R('{"b":2}', V), R('{"c":3}', `${V}/x`)]).digest);
    // endpoint 간 순서는 정규화된다 — 같은 집합이면 같은 digest.
    expect(d([R('{"b":2}', V), R('{"a":1}', U)]).digest).toBe(both.digest);
  });

  it('manifest가 null/empty여도 empty digest로 통과하지 못한다', () => {
    // 빈 응답 배열은 digest가 나오지만, 계약 검증이 그것을 승인 경로에서 막는다.
    const empty = d([]);
    expect(empty.errors).toEqual([]);
    expect(empty.digest).toBe(sha(''));
    // 그 empty digest를 들고 와도 계약이 없으면 candidate/bundle/promotion이 거부한다.
    const nullSpec = { ...SPEC, EXPECTED_DATASET_MANIFEST: null, DATASET_ENDPOINTS: [] };
    expect(EV.validateDatasetContract(nullSpec, EV.buildActionContext(CAP.CAPTURE_SCENARIO)))
      .toEqual(['DATASET_MANIFEST_NULL']);
  });
});

// ── 관찰 canonicalization ───────────────────────────────────────────────────
describe('S4 관찰 canonicalization — 순서는 무시하고 내용은 본다', () => {
  const SC = () => EV.buildActionContext(CAP.CAPTURE_SCENARIO);
  // manifest가 신고한 대로의 관찰을 합성한다(실제 discovery 산출 형태: "METHOD url status" -> count).
  const build = () => {
    const sc = SC(), man = SPEC.EXPECTED_DATASET_MANIFEST;
    const all = [...man.dataset, ...man.ambient, ...man.dev];
    const names = SPEC.REQUIRED_SMOKE_SURFACES.map((x) => x.name);
    const out = {};
    for (const n of names) out[n] = {};
    for (const e of all) {
      const { url } = EV.resolveTemplate(e.urlTemplate, sc);
      // 정수로 분배한다. /api/tracks는 22 surface에 24요청이라 균등 분배가 불가능하다 —
      // 앞쪽 (요청-화면)개 화면에 2건, 나머지에 1건. 실제 관찰의 형태와 같다.
      const extra = e.observedRequestCount - e.observedSurfaceCount;
      names.slice(0, e.observedSurfaceCount).forEach((n, i) => {
        out[n][`${e.method} ${url} 200`] = i < extra ? 2 : 1;
      });
    }
    return out;
  };
  const reverseAll = (o) => {
    const out = {};
    for (const k of Object.keys(o).reverse()) out[k] = Object.fromEntries(Object.entries(o[k]).reverse());
    return out;
  };

  it('positive control — 합성 관찰이 manifest와 일치하면 errors === []', () => {
    expect(EV.validateDiscoveryObservation(build(), SPEC, SC())).toEqual([]);
  });

  it('순서를 역으로 주입해도 canonical 비교는 GREEN', () => {
    const fwd = build(), rev = reverseAll(fwd);
    expect(Object.keys(rev)).not.toEqual(Object.keys(fwd));      // 실제로 순서가 다르다
    expect(EV.validateDiscoveryObservation(rev, SPEC, SC())).toEqual([]);
    expect(EV.canonicalObservation(rev, SPEC.REQUIRED_SMOKE_SURFACES.map((x) => x.name)))
      .toEqual(EV.canonicalObservation(fwd, SPEC.REQUIRED_SMOKE_SURFACES.map((x) => x.name)));
  });

  it('RED: endpoint 누락 / 추가 / count 변경', () => {
    const sc = SC();
    const miss = build(); delete miss.canvas[`GET ${sc.apiOrigin}/tracks/5/items 200`];
    expect(EV.validateDiscoveryObservation(miss, SPEC, sc).join(' ')).toMatch(/OBSERVATION_SURFACE_COUNT .*\/items/);
    const extra = build(); extra.canvas[`GET ${sc.apiOrigin}/unknown 200`] = 1;
    expect(EV.validateDiscoveryObservation(extra, SPEC, sc).join(' ')).toMatch(/OBSERVATION_ENDPOINT_EXTRA GET .*\/unknown/);
    const cnt = build(); cnt.canvas[`GET ${sc.apiOrigin}/chat 200`] = 5;
    expect(EV.validateDiscoveryObservation(cnt, SPEC, sc).join(' ')).toMatch(/OBSERVATION_REQUEST_COUNT .*\/chat/);
    const gone = build();
    for (const n of Object.keys(gone)) delete gone[n][`GET ${sc.apiOrigin}/chat 200`];
    expect(EV.validateDiscoveryObservation(gone, SPEC, sc).join(' ')).toMatch(/OBSERVATION_ENDPOINT_MISSING GET .*\/chat/);
  });

  it('bySurface producer는 정렬하지 않는다 — 원문은 감사 증거다', () => {
    const src = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function surfaceEndpointMap'));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).not.toMatch(/\.sort\(/);
  });
});

// ── 배선: 계약 부재는 각 승인 경로에서 fail-closed ──────────────────────────
describe('S4 dataset 계약 배선 — source에서 sink까지 실제로 막는다', () => {
  const nullSpec = () => ({ ...SPEC, EXPECTED_DATASET_MANIFEST: null, DATASET_ENDPOINTS: [] });
  const CTX = () => ({ ...CAP.CAPTURE_SCENARIO, phase: 'light',
    viewport: { width: 1440, height: 900 }, datasetResponses: [] });

  it('validateCandidate — manifest가 null이면 거부', () => {
    // 실제 committed fixture를 쓴다. 빈 객체는 계약 검사 뒤의 다른 검증기가 먼저 터져
    // "무엇이 막았는지"가 흐려진다.
    const fx = JSON.parse(readFileSync(new URL('./__fixtures__/s4-expected.json', import.meta.url), 'utf8'));
    const e = EV.validateCandidate({ fixture: fx, spec: nullSpec(), context: CTX(), contrastResults: [] });
    expect(e.join(' ')).toMatch(/DATASET_MANIFEST_NULL/);
    // 정본 spec에서는 이 오류가 없다 — 계약 검사가 무조건 RED를 내는 게 아님을 함께 고정한다.
    const e2 = EV.validateCandidate({ fixture: fx, spec: SPEC, context: CTX(), contrastResults: [] });
    expect(e2.join(' ')).not.toMatch(/DATASET_MANIFEST_NULL/);
  });

  it('validateCaptureEvidence — 빈 DATASET_ENDPOINTS가 더 이상 조용히 통과하지 않는다', () => {
    // 이전 판은 `if (DATASET_ENDPOINTS.length)`로 감싸서 목록이 비면 dataset 증거가
    // 통째로 생략됐다. 계약 부재 자체가 실패여야 한다.
    // provenanceRefs를 빼도 계약 검사는 사라지지 않아야 한다 — 어떤 분기보다 앞이다.
    const e = EV.validateCaptureEvidence(nullSpec(), CTX(), null);
    expect(e.join(' ')).toMatch(/EVIDENCE_DATASET_MANIFEST_NULL/);
    expect(e).toContain('EVIDENCE_PROVENANCE_REFS_REQUIRED');
    const refs = { headCommit: 'a'.repeat(40), headBlobs: {}, specFingerprintNow: 'b'.repeat(64) };
    expect(EV.validateCaptureEvidence(nullSpec(), CTX(), refs).join(' ')).toMatch(/EVIDENCE_DATASET_MANIFEST_NULL/);
  });

  it('validateCaptureBundle — manifest가 null이면 거부', () => {
    const png = {};
    for (const s of SPEC.REQUIRED_SMOKE_SURFACES) png[s.captureName] = Buffer.from('');
    const e = EV.validateCaptureBundle({ spec: nullSpec(), phase: 'light',
      contextRaw: JSON.stringify(CTX()), pngByName: png, provenanceRefs: null });
    expect(e.join(' ')).toMatch(/DATASET_MANIFEST_NULL/);
  });

  it('phase capture는 브리지를 열기 전에 계약을 본다', () => {
    // discovery/canary는 계약 없이 endpoint를 찾는 용도이므로 이 게이트 뒤에 있으면 안 된다.
    const src = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    const gate = src.indexOf('DATASET_CONTRACT_FAILED');
    const bridge = src.indexOf('export async function capturePhaseCore');
    const discoveryReturn = src.indexOf('if (cli.discover || cli.canary) {');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(bridge);              // 브리지보다 앞
    expect(gate).toBeGreaterThan(discoveryReturn);  // discovery return보다 뒤
  });

  it('promotion 경로도 계약을 본다 — 지금은 disabled지만 배선은 존재한다', () => {
    expect(PROM.PROMOTION_ENABLED).toBe(true);
    const src = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function promoteRelease'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('validateDatasetContract');
    expect(body).toContain('validateScenarioIdentity');
    // bundle 검증보다 **앞**에 있다 — 호출 순서를 바꿔도 계약이 먼저다.
    expect(body.indexOf('validateDatasetContract')).toBeLessThan(body.indexOf('validateCaptureBundle'));
  });

  it('discovery/canary는 계약 없이도 동작한다 — endpoint를 찾는 용도다', () => {
    // parseCaptureArgs가 두 모드를 여전히 받아들이고, 계약 게이트가 그 앞을 막지 않는다.
    expect(CAP.parseCaptureArgs(['--discover'], SPEC).error).toBeUndefined();
    expect(CAP.parseCaptureArgs(['--canary', 'canvas', '--repeat', '2'], SPEC).error).toBeUndefined();
  });
});

// ── phase 수명주기 ──────────────────────────────────────────────────────────
describe('S4 phase 브리지 수명주기 — discovery와 같은 primitive를 쓴다', () => {
  const PORT = 10411;
  const HEAD = { headCommit: 'x'.repeat(40), blobs: {} };
  // 커밋된 어댑터의 dispatch 규칙을 그대로 모사한다: beginAttempt 전에는 page가 없다.
  // 이전 판은 phase가 lifecycle을 하나도 내보내지 않아 첫 RPC가 곧바로 NO_ACTIVE_ATTEMPT였다.
  const fakeAdapter = async ({ port, failAt, ackShutdown = true }) => {
    const seen = { methods: [], hasPage: false, shutdown: false, clean: false, noActive: [] };
    for (let i = 0; i < 4000; i += 1) {
      let cmd;
      try { cmd = await (await fetch(`http://127.0.0.1:${port}/next`)).json(); } catch (e) { break; }
      if (cmd.done) break;
      seen.methods.push(cmd.method);
      if (cmd.method === 'shutdown') {
        seen.shutdown = true;
        if (!ackShutdown) break;
      }
      let value = null; let error = null;
      const [a] = cmd.args;
      if (cmd.method === 'hello') value = { protocol: 's4-bridge/2', echo: a };
      else if (cmd.method === 'beginAttempt') { seen.hasPage = true; value = { ok: true, attempt: a }; }
      else if (cmd.method === 'endAttempt') { seen.hasPage = false; value = { ok: true, attempt: a }; }
      else if (cmd.method === 'shutdown') { seen.hasPage = false; value = { ok: true }; }
      else if (!seen.hasPage) { seen.noActive.push(cmd.method); error = 'NO_ACTIVE_ATTEMPT'; }
      else if (failAt && cmd.method === failAt) error = `FAKE_${failAt}_FAILED`;
      else if (cmd.method === 'evaluate') value = {};
      try {
        await fetch(`http://127.0.0.1:${port}/`, { method: 'POST',
          body: JSON.stringify({ id: cmd.id, value, error }), headers: { 'content-type': 'application/json' } });
      } catch (e) { break; }
      if (cmd.method === 'shutdown') { seen.clean = true; break; }
    }
    return seen;
  };
  const runPhase = async (opts = {}) => {
    const port = opts.port || PORT;
    const out = []; const errs = [];
    const cli = CAP.parseCaptureArgs(['--phase', 'light', '--port', String(port), '--timeoutMs', '3000'], SPEC);
    expect(cli.error).toBeUndefined();
    const dir = mkdtempSync(join(tmpdir(), 's4phase-'));
    const p = CAP.capturePhaseCore({ SPEC, cli, head: HEAD,
      log: (m) => out.push(m), err: (m) => errs.push(m) });
    await new Promise((r) => setTimeout(r, 200));
    const seen = await fakeAdapter({ port, ...opts });
    const core = await p;
    const wrote = existsSync(join(dir, RUN.CANDIDATE_ROOT));
    const files = existsSync(dir) ? readdirSync(dir) : [];
    rmSync(dir, { recursive: true, force: true });
    return { code: core.code, out, errs, seen, wrote, files };
  };

  it('첫 RPC가 NO_ACTIVE_ATTEMPT가 아니다 — hello → beginAttempt → … → endAttempt → shutdown', async () => {
    const r = await runPhase();
    const m = r.seen.methods;
    expect(m[0]).toBe('hello');
    expect(m[1]).toBe('beginAttempt');
    expect(m[m.length - 1]).toBe('shutdown');
    expect(m).toContain('endAttempt');
    expect(m.indexOf('endAttempt')).toBeLessThan(m.indexOf('shutdown'));
    // 핵심: page가 없는 상태에서 온 RPC가 **0건**이어야 한다.
    expect(r.seen.noActive).toEqual([]);
    expect(r.seen.clean).toBe(true);
  }, 30000);

  it('runner 실패 → controlled error, write 0회, TypeError 없음', async () => {
    // fake가 evaluate를 실패시키면 runCapture가 errors를 담아 돌아온다.
    const r = await runPhase({ port: PORT + 1, failAt: 'evaluate' });
    expect(r.code).toBe(1);
    const joined = r.errs.join(' ');
    expect(joined).toMatch(/CAPTURE FAILED|CAPTURE_CONTEXT_MISSING|CAPTURE_DATASET_MISSING/);
    // context=null인데 provenance를 만져 TypeError로 죽던 경로가 사라졌다(실증).
    expect(joined).not.toMatch(/Cannot read properties of null/);
    expect(joined).not.toMatch(/TypeError/);
    expect(r.wrote).toBe(false);
    expect(r.files).toEqual([]);
    // 실패해도 attempt는 닫고 shutdown까지 간다 — 어댑터 child context가 남지 않는다.
    expect(r.seen.methods).toContain('endAttempt');
    expect(r.seen.shutdown).toBe(true);
  }, 30000);

  it('shutdown 오류가 기존 primary 오류를 덮지 않는다', async () => {
    const r = await runPhase({ port: PORT + 2, failAt: 'evaluate', ackShutdown: false });
    expect(r.code).toBe(1);
    const joined = r.errs.join(' ');
    expect(joined).toMatch(/CAPTURE FAILED|CAPTURE_CONTEXT_MISSING|CAPTURE_DATASET_MISSING/);
    expect(joined).not.toMatch(/BRIDGE_SHUTDOWN_UNACKED/);
    expect(r.wrote).toBe(false);
  }, 30000);

  it('discovery와 phase가 같은 primitive를 쓴다 — 복제 구현이 없다', () => {
    const src = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    expect(src.match(/createBridgeDriver\(/g)).toHaveLength(2);   // 정의 1 + withBridge 1
    expect(src.match(/makeBridgeServer\(/g)).toHaveLength(2);
    expect(src.match(/dd\.hello\(BRIDGE_PROTOCOL\)/g) || []).toHaveLength(1);
    const phase = src.slice(src.indexOf('export async function capturePhaseCore'));
    expect(phase).toContain('withBridge(');
    expect(phase).toContain('withAttempt(');
  });

  it('errors를 dataset digest·provenance보다 먼저 본다', () => {
    const src = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export async function capturePhaseCore'));
    expect(fn.indexOf('CAPTURE FAILED')).toBeLessThan(fn.indexOf('datasetDigest('));
    expect(fn.indexOf('CAPTURE_CONTEXT_MISSING')).toBeLessThan(fn.indexOf('result.context.provenance.datasetDigest'));
  });
});

// ── 커밋된 discovery 증거 (독립 검증) ───────────────────────────────────────
describe('S4 discovery 증거 — 커밋된 raw 바이트가 manifest를 검증한다', () => {
  const DIR = new URL('./__fixtures__/s4-discovery-evidence/', import.meta.url);
  const REPO = fileURLToPath(new URL('../..', import.meta.url));
  const gitBlob = (ref, rel) => {
    try { return execSync(`git -C ${REPO} rev-parse ${ref}:${rel}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch (e) { return null; }
  };
  const load = () => Object.fromEntries(EV.DISCOVERY_EVIDENCE_FILES
    .map((n) => [n, readFileSync(new URL(n, DIR), 'utf8')]));
  const SC = () => EV.buildActionContext(CAP.CAPTURE_SCENARIO);
  const verify = (files, spec) => EV.verifyDiscoveryEvidence({
    files: files || load(), spec: spec || SPEC, scenario: SC(), sha256Hex: sha256, gitBlob });
  // payload 안의 endpoints 한 줄을 바꿔 raw 바이트를 재작성한다(= 실제 증거 위조).
  const mutate = (fn, which = 'runA.out') => {
    const f = load(); const p = JSON.parse(f[which]); fn(p);
    f[which] = JSON.stringify(p, null, 1);
    // 위조에 맞춰 manifest의 SHA도 갱신한다 — SHA만 어긋나서 RED가 나는 걸 피하고
    // **의미 축**이 잡히는지 본다.
    const man = JSON.parse(JSON.stringify(SPEC.EXPECTED_DATASET_MANIFEST));
    man.evidence.files = { ...man.evidence.files, [which]: sha256(f[which]) };
    return { f, spec: { ...SPEC, EXPECTED_DATASET_MANIFEST: man } };
  };

  it('positive control — 커밋된 증거는 errors === []', () => {
    expect(verify()).toEqual([]);
  });

  it('증거 파일이 실제로 커밋 경로에 있고 exit 0이며 8개 전부 결속된다', () => {
    const f = load();
    expect(Object.keys(f).sort()).toEqual([...EV.DISCOVERY_EVIDENCE_FILES].sort());
    expect(f['runA.code'].trim()).toBe('0');
    expect(f['runB.code'].trim()).toBe('0');
    for (const n of EV.DISCOVERY_EVIDENCE_FILES)
      expect(sha256(f[n]), n).toBe(SPEC.EXPECTED_DATASET_MANIFEST.evidence.files[n]);
  });

  it('RED: raw 바이트 drift — SHA가 어긋나면 잡힌다', () => {
    const f = load(); f['runA.out'] = `${f['runA.out']} `;
    expect(verify(f).join(' ')).toContain('EVIDENCE_FILE_SHA runA.out ');
    const g = load(); g['runA.adapter.json'] = '[]';
    expect(verify(g).join(' ')).toContain('EVIDENCE_FILE_SHA runA.adapter.json ');
    const h = load(); h['runA.code'] = '1';
    expect(verify(h).join(' ')).toContain('EVIDENCE_FILE_SHA runA.code ');
  });

  it('RED: ghost surface / unknown surface', () => {
    const { f, spec } = mutate((p) => { p.endpoints[0] = p.endpoints[0].replace(/^\S+/, 'ghost-surface'); });
    expect(verify(f, spec).join(' ')).toMatch(/EVIDENCE_UNKNOWN_SURFACE ghost-surface/);
  });

  it('RED: surface 간 endpoint 이동', () => {
    const { f, spec } = mutate((p) => {
      const i = p.endpoints.findIndex((x) => x.startsWith('canvas GET') && x.includes('/tracks/5/items'));
      p.endpoints[i] = p.endpoints[i].replace(/^canvas/, 'detail');
    });
    // canonical tuple 비교가 이동을 본다. (bySurface 교차대조는 detail이 이미 그 endpoint를
    // 가지고 있어 값이 같으므로 여기서는 발화하지 않는다 — count 변조 테스트가 그 축을 맡는다.)
    expect(verify(f, spec).join(' ')).toMatch(/EVIDENCE_TUPLE_ONLY_A|EVIDENCE_TUPLE_ONLY_B/);
    // 대상 surface에 없는 endpoint를 옮기면 교차대조도 함께 발화한다.
    const m2 = mutate((p) => {
      const i = p.endpoints.findIndex((x) => x.includes('/api/scrum ') || /\/api\/scrum \d/.test(x));
      if (i >= 0) p.endpoints[i] = p.endpoints[i].replace(/^\S+/, 'canvas');
    });
    expect(verify(m2.f, m2.spec).join(' ')).toMatch(/EVIDENCE_COUNT_CROSSCHECK|EVIDENCE_TUPLE_ONLY/);
  });

  it('RED: 200 → 500 과 ok true → false', () => {
    const a = mutate((p) => { p.endpoints[0] = p.endpoints[0].replace(' 200 ok ', ' 500 ok '); });
    expect(verify(a.f, a.spec).join(' ')).toMatch(/EVIDENCE_NON_200/);
    const b = mutate((p) => { p.endpoints[0] = p.endpoints[0].replace(' 200 ok ', ' 200 fail '); });
    expect(verify(b.f, b.spec).join(' ')).toMatch(/EVIDENCE_NOT_OK/);
  });

  it('RED: endpoint 누락 / 추가 / 임의의 안정 endpoint로 교체', () => {
    const a = mutate((p) => { p.endpoints = p.endpoints.filter((x) => !x.includes('/tracks/5/links')); });
    expect(verify(a.f, a.spec).join(' ')).toMatch(/EVIDENCE_TUPLE_ONLY_B|EVIDENCE_ENDPOINT_UNOBSERVED/);
    const b = mutate((p) => { p.endpoints.push('canvas GET http://localhost:10001/api/whatever 200 ok x1'); });
    expect(verify(b.f, b.spec).join(' ')).toMatch(/EVIDENCE_ENDPOINT_UNDECLARED GET .*\/whatever/);
    // 임의의 "안정적인" endpoint로 통째 교체해도 declared universe와 어긋난다.
    const c = mutate((p) => {
      p.endpoints = p.endpoints.map((x) => x.replace(/http:\/\/localhost:10001\/api\/\S+/, 'http://localhost:10001/api/stable'));
    });
    expect(verify(c.f, c.spec).join(' ')).toMatch(/EVIDENCE_ENDPOINT_UNDECLARED|EVIDENCE_ENDPOINT_UNOBSERVED/);
  });

  it('RED: count 변경 — bySurface 교차대조와 manifest 양쪽에서 잡힌다', () => {
    const { f, spec } = mutate((p) => {
      const i = p.endpoints.findIndex((x) => x.includes('/api/chat'));
      p.endpoints[i] = p.endpoints[i].replace(/x\d+$/, 'x9');
    });
    const e = verify(f, spec).join(' ');
    expect(e).toMatch(/EVIDENCE_COUNT_CROSSCHECK/);
    expect(e).toMatch(/EVIDENCE_MANIFEST_REQUEST_COUNT|EVIDENCE_SEMANTIC_TUPLE_COUNT|EVIDENCE_BACKEND_TUPLE_COUNT/);
  });

  it('RED: 상쇄된 count drift도 잡힌다 — 한쪽을 줄이고 다른 쪽을 늘려도', () => {
    const { f, spec } = mutate((p) => {
      const i = p.endpoints.findIndex((x) => x.startsWith('canvas GET') && x.includes('/api/chat'));
      const j = p.endpoints.findIndex((x) => x.startsWith('detail GET') && x.includes('/api/chat'));
      p.endpoints[i] = p.endpoints[i].replace(/x\d+$/, 'x1');
      p.endpoints[j] = p.endpoints[j].replace(/x\d+$/, 'x3');
    });
    // 총합은 그대로지만 surface별 값이 달라졌다 — canonical tuple 비교와 bySurface가 본다.
    const e = verify(f, spec).join(' ');
    expect(e).toMatch(/EVIDENCE_COUNT_CROSSCHECK|EVIDENCE_TUPLE_ONLY_A/);
  });

  it('RED: gitBlob 생략은 fail-closed다', () => {
    expect(EV.verifyDiscoveryEvidence({ files: load(), spec: SPEC, scenario: SC(), sha256Hex: sha256 }).join(' '))
      .toMatch(/EVIDENCE_GIT_RESOLVER_REQUIRED/);
  });

  it('RED: 임의의 실제 repo 파일 9개 + 올바른 OID도 거부된다', () => {
    // 개수만 세면 통과했다(실증). 경로 집합이 정본과 exact여야 한다.
    const other = execSync(`git -C ${REPO} ls-tree -r --name-only HEAD frontend/components/Layout`,
      { encoding: 'utf8' }).trim().split('\n').slice(0, 9);
    const { f, spec } = mutate((p) => {
      p.provenance.blobs = Object.fromEntries(other.map((r) => [r, gitBlob('HEAD', r) || 'a'.repeat(40)]));
    });
    const e = verify(f, spec).join(' ');
    expect(e).toMatch(/EVIDENCE_BLOB_PATH_EXTRA_A/);
    expect(e).toMatch(/EVIDENCE_BLOB_PATH_MISSING_A/);
  });

  it('RED: shell metacharacter 경로는 Git 호출 0회', () => {
    const { f, spec } = mutate((p) => { p.provenance.blobs = { 'a; touch /tmp/S4_PWNED': 'a'.repeat(40) }; });
    let calls = 0;
    const e = EV.verifyDiscoveryEvidence({ files: f, spec, scenario: SC(), sha256Hex: sha256,
      gitBlob: () => { calls += 1; return null; } });
    expect(calls).toBe(0);
    expect(e.join(' ')).toMatch(/EVIDENCE_BLOB_PATH_EXTRA_A a; touch/);
  });

  it('RED: wrong OID', () => {
    const { f, spec } = mutate((p) => {
      p.provenance.blobs = Object.fromEntries(Object.keys(p.provenance.blobs).map((k) => [k, 'b'.repeat(40)]));
    });
    expect(verify(f, spec).join(' ')).toMatch(/EVIDENCE_BLOB_OID/);
  });

  it('RED: Run A/B provenance·hash 불일치', () => {
    const a = mutate((p) => { p.provenance.headCommit = 'f'.repeat(40); }, 'runB.out');
    expect(verify(a.f, a.spec).join(' ')).toMatch(/EVIDENCE_HEAD_B|EVIDENCE_PROVENANCE_A_NE_B/);
    const b = mutate((p) => { p.digest = '0'.repeat(64); }, 'runB.out');
    expect(verify(b.f, b.spec).join(' ')).toMatch(/EVIDENCE_DIGEST_B/);
    const c = mutate((p) => { p.provenance.blobs = { only: 'a'.repeat(40) }; }, 'runA.out');
    expect(verify(c.f, c.spec).join(' ')).toMatch(/EVIDENCE_BLOB_PATH_EXTRA_A only/);
  });

  it('RED: mode / eligibleForManifest / surface 집합', () => {
    const a = mutate((p) => { p.mode = 'canary'; });
    expect(verify(a.f, a.spec).join(' ')).toMatch(/EVIDENCE_MODE_A canary/);
    const b = mutate((p) => { p.eligibleForManifest = false; });
    expect(verify(b.f, b.spec).join(' ')).toMatch(/EVIDENCE_ELIGIBLE_A false/);
    const c = mutate((p) => { p.surfaces = p.surfaces.slice(1); });
    expect(verify(c.f, c.spec).join(' ')).toMatch(/EVIDENCE_SURFACE_SET_A|EVIDENCE_SURFACES_COMPLETED_A/);
  });

  it('검증 경계는 canonicalize한다 — 순서만 다른 증거는 GREEN', () => {
    const f = load();
    const p = JSON.parse(f['runB.out']);
    p.endpoints = [...p.endpoints].reverse();
    p.bySurface = Object.fromEntries(Object.entries(p.bySurface).reverse()
      .map(([k, v]) => [k, Object.fromEntries(Object.entries(v).reverse())]));
    f['runB.out'] = JSON.stringify(p, null, 1);
    const man = JSON.parse(JSON.stringify(SPEC.EXPECTED_DATASET_MANIFEST));
    man.evidence.files = { ...man.evidence.files, 'runB.out': sha256(f['runB.out']) };
    expect(EV.verifyDiscoveryEvidence({ files: f, spec: { ...SPEC, EXPECTED_DATASET_MANIFEST: man },
      scenario: SC(), sha256Hex: sha256, gitBlob })).toEqual([]);
  });

  it('manifest 값으로 기대 관찰을 만들지 않는다 — 방향은 증거→manifest다', () => {
    const src = readFileSync(new URL('./s4Evaluator.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function verifyDiscoveryEvidence'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    // 관찰 tuple은 raw payload에서만 나온다.
    expect(body).toContain('discoveryTuples(A)');
    expect(body).not.toMatch(/observedRequestCount\s*\)\s*=>\s*\{[^}]*push/);
  });
});

// ── 계약 숫자 정본 ──────────────────────────────────────────────────────────
describe('S4 계약 숫자 — 주석·문구가 실행 값과 일치한다', () => {
  const S = SPEC.REQUIRED_SMOKE_SURFACES;
  const sum = (f) => S.reduce((a, x) => a + (f(x) || []).length, 0);
  it('기계 확인값 6종', () => {
    expect(S).toHaveLength(23);                                        // surfaces
    expect(sum((x) => x.coverageSelectors)).toBe(54);                  // coverage entries
    expect(sum((x) => x.requiredElements)).toBe(4);                    // required elements
    expect(sum((x) => x.actions)).toBe(94);                            // actions
    expect(new Set(S.map((x) => x.captureName)).size).toBe(23);        // target capture names
    expect(Object.keys(SPEC.LIGHT_DIFF_MASKS)).toHaveLength(15);       // allow IDs
  });
  it('legacy committed BASE PNG 24개는 현재 target 23과 구분된다', () => {
    const dir = new URL('./__fixtures__/s4-shots/base/', import.meta.url);
    const legacy = readdirSync(dir).filter((n) => n.endsWith('.png'));
    expect(legacy).toHaveLength(24);                                   // legacy, promotion pending
    expect(legacy.length).not.toBe(S.length);
    // 24 - 23 = 1: legacy에만 있고 현재 target에 없는 캡처가 정확히 1개다.
    const target = new Set(S.map((x) => x.captureName));
    expect(legacy.filter((n) => !target.has(n))).toEqual(['sourcepicker.png']);
  });
  it('활성 소스에 24를 target 숫자로 쓰는 문구가 남아 있지 않다', () => {
    for (const rel of ['./s4Spec.mjs', './s4Evaluator.mjs', './s4CaptureRunner.mjs', '../scripts/s4-capture.mjs']) {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
      for (const m of src.match(/^.*24 ?(?:surface|개 surface|개 캡처).*$/gm) || [])
        expect(m, `${rel}: ${m.trim()}`).toMatch(/legacy|promotion pending/);
    }
  });
});

// ── scenario 정본 + origin 파서 ─────────────────────────────────────────────
describe('S4 scenario 정본 — context가 단일 원천과 exact 일치한다', () => {
  const CTX = (over = {}) => ({ ...SPEC.SCENARIO_CANON, ...over });

  it('positive control — 정본 그대로면 errors === []', () => {
    expect(EV.validateScenarioCanon(SPEC, CTX())).toEqual([]);
    // capture script는 정본을 소비한다(별도로 적지 않는다).
    for (const k of SPEC.SCENARIO_CANON_KEYS)
      expect(CAP.CAPTURE_SCENARIO[k]).toBe(SPEC.SCENARIO_CANON[k]);
    const src = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    expect(src).toContain('...RAW_SPEC.SCENARIO_CANON');
  });

  it('RED: 8개 필드 각각의 불일치와 누락', () => {
    for (const k of SPEC.SCENARIO_CANON_KEYS) {
      const bad = typeof SPEC.SCENARIO_CANON[k] === 'number' ? 99 : 'zzz';
      expect(EV.validateScenarioCanon(SPEC, CTX({ [k]: bad })).join(' '))
        .toMatch(new RegExp(`SCENARIO_FIELD_MISMATCH ${k}`));
      const c = CTX(); delete c[k];
      expect(EV.validateScenarioCanon(SPEC, c).join(' '))
        .toMatch(new RegExp(`SCENARIO_FIELD_MISSING ${k}`));
    }
  });

  it('RED: ID는 양의 safe integer여야 한다', () => {
    for (const k of ['trackId', 'bulkBranchId', 'bulkEpicId', 'scrumBoardId']) {
      for (const v of ['5', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2, null])
        expect(EV.validateScenarioCanon(SPEC, CTX({ [k]: v })).join(' '), `${k}=${v}`)
          .toMatch(new RegExp(`SCENARIO_(ID_INVALID ${k}|FIELD_MISMATCH ${k})`));
    }
  });

  it('RED: origin 값 자체의 축 — scheme·userinfo·query·hash·경로·정규형', () => {
    const cases = [
      ['ftp://localhost:10001/api', /ORIGIN_SCHEME/],
      ['http://u:p@localhost:10001/api', /ORIGIN_USERINFO/],
      ['http://localhost:10001/api?x=1', /ORIGIN_SEARCH/],
      ['http://localhost:10001/api#f', /ORIGIN_HASH/],
      ['http://localhost:10001/api/../api', /ORIGIN_DOT_SEGMENT|ORIGIN_NOT_CANONICAL/],
      ['not a url', /ORIGIN_UNPARSEABLE/],
      ['', /ORIGIN_MISSING/],
    ];
    for (const [v, rx] of cases)
      expect(EV.validateOriginValue('apiOrigin', v, { allowBasePath: true }).join(' '), v).toMatch(rx);
    // appOrigin은 base path를 허용하지 않는다.
    expect(EV.validateOriginValue('appOrigin', 'http://localhost:10000/sub', { allowBasePath: false }).join(' '))
      .toMatch(/ORIGIN_UNEXPECTED_PATH/);
    expect(EV.validateOriginValue('appOrigin', 'http://localhost:10000', { allowBasePath: false })).toEqual([]);
  });

  it('RED: 해석된 URL의 origin·base path·경로 탈출', () => {
    const api = SPEC.SCENARIO_CANON.apiOrigin;
    expect(EV.validateResolvedUrl('t', 'http://evil.test/api/x', api).join(' ')).toMatch(/URL_ORIGIN/);
    expect(EV.validateResolvedUrl('t', 'http://localhost:10001/other/x', api).join(' ')).toMatch(/URL_BASE_PATH/);
    expect(EV.validateResolvedUrl('t', 'http://u:p@localhost:10001/api/x', api).join(' ')).toMatch(/URL_USERINFO/);
    expect(EV.validateResolvedUrl('t', `${api}/x`, api)).toEqual([]);
  });

  it('RED: scenario와 response를 **동시에** 위조해도 통과하지 못한다', () => {
    // ID와 이름을 함께 바꾸고 응답도 거기 맞추면 신원 검사만으로는 통과한다.
    const forged = { ...SPEC.SCENARIO_CANON, bulkBranchId: 77, branchName: '- Forged' };
    const resp = [
      { url: `${forged.apiOrigin}/branches`, status: 200,
        body: JSON.stringify({ status: true, branches: [{ branch_id: 77, branch_name: '- Forged' }] }) },
      { url: `${forged.apiOrigin}/branches/77/epics`, status: 200,
        body: JSON.stringify({ status: true, epics: [{ epic_id: 7, epic_name: 'Alpha Epic' }] }) }];
    expect(EV.validateScenarioIdentity(forged, resp)).toEqual([]);          // 신원만으로는 통과
    // 정본 대조가 그것을 막는다.
    const e = EV.validateScenarioCanon(SPEC, forged).join(' ');
    expect(e).toMatch(/SCENARIO_FIELD_MISMATCH bulkBranchId 77 != 13/);
    expect(e).toMatch(/SCENARIO_FIELD_MISMATCH branchName/);
  });

  it('RED: body envelope status:false는 신원 근거가 아니다', () => {
    // 이 API는 200으로도 실패를 돌려준다(실측: {status:false, code:"NEED_LOGIN"}).
    const sc = SPEC.SCENARIO_CANON;
    const resp = [
      { url: `${sc.apiOrigin}/branches`, status: 200,
        body: JSON.stringify({ status: false, message: 'NEED_LOGIN', branches: [{ branch_id: 13, branch_name: '- Alpha' }] }) },
      { url: `${sc.apiOrigin}/branches/13/epics`, status: 200,
        body: JSON.stringify({ status: true, epics: [{ epic_id: 7, epic_name: 'Alpha Epic' }] }) }];
    expect(EV.validateScenarioIdentity(sc, resp).join(' ')).toMatch(/IDENTITY_ENVELOPE .*\/branches status=false/);
  });

  it('RED: 서로 다른 템플릿이 같은 절대 URL로 해석되면 거부', () => {
    const man = JSON.parse(JSON.stringify(SYN_MANIFEST));
    man.dataset[4] = { ...man.dataset[4], urlTemplate: '{apiOrigin}/chat' };   // tracks/{trackId} → chat
    man.dataset.sort((a, b) => (a.urlTemplate < b.urlTemplate ? -1 : 1));
    const spec = { ...SYN_SPEC(), EXPECTED_DATASET_MANIFEST: man,
      DATASET_ENDPOINTS: man.dataset.map((e) => e.urlTemplate) };
    expect(EV.validateDatasetContract(spec, SYN_SC()).join(' '))
      .toMatch(/DATASET_TEMPLATE_DUPLICATE|DATASET_RESOLVED_DUPLICATE/);
  });
});

// ── candidate 원자성 ────────────────────────────────────────────────────────
describe('S4 candidate 원자성 — context와 PNG가 한 덩어리로 공개된다', () => {
  const PNG_X = () => Buffer.from('PNG-X');
  const PNG_Y = () => Buffer.from('PNG-Y');
  const mk = () => mkdtempSync(join(tmpdir(), 's4bundle-'));
  const snapshot = (d) => {
    const r = RUN.readCandidateBundle(d, 'light');
    if (r.errors.length) return null;
    return { ctx: sha256(r.contextRaw),
      pngs: Object.fromEntries(Object.keys(r.pngByName).sort().map((n) => [n, sha256(r.pngByName[n])])) };
  };
  const seed = (d) => {
    const e = RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase: 'light', contextRaw: 'OLD-CONTEXT',
      pngByCaptureName: { 'a.png': PNG_X() }, expectedCaptureNames: ['a.png'] });
    expect(e).toEqual([]);
    return snapshot(d);
  };
  const tempLeftovers = (d) => (existsSync(join(d, RUN.CANDIDATE_ROOT))
    ? readdirSync(join(d, RUN.CANDIDATE_ROOT)).filter((n) => n.startsWith('.')) : []);


  it('GREEN: context와 PNG가 같은 bundle에 함께 공개된다', () => {
    const d = mk();
    expect(RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase: 'light', contextRaw: 'CTX',
      pngByCaptureName: { 'a.png': PNG_X() }, expectedCaptureNames: ['a.png'] })).toEqual([]);
    const r = RUN.readCandidateBundle(d, 'light');
    expect(r.errors).toEqual([]);
    expect(r.contextRaw).toBe('CTX');
    expect(Object.keys(r.pngByName)).toEqual(['a.png']);
    expect(tempLeftovers(d)).toEqual([]);
    rmSync(d, { recursive: true, force: true });
  });

  it('RED: context write 실패(EISDIR) → 이전 bundle 전체가 byte-identical', () => {
    // 이전 판은 shots를 먼저 교체하고 context를 나중에 썼다 — 실패 시 새 PNG + 옛 context가
    // 남았다(실증). 이제는 temp에서 실패하므로 dest에 손대지 않는다.
    const d = mk(); const before = seed(d);
    // temp 안의 context 경로를 디렉터리로 만들 수는 없으므로, s4-shots를 읽기 전용으로 만들어
    // temp 생성 자체를 실패시킨다 — 어느 지점에서 실패해도 결과는 같아야 한다.
    const shotsRoot = join(d, RUN.CANDIDATE_ROOT);
    chmodSync(shotsRoot, 0o500);
    const e = RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase: 'light', contextRaw: 'NEW-CONTEXT',
      pngByCaptureName: { 'b.png': PNG_Y() }, expectedCaptureNames: ['b.png'] });
    chmodSync(shotsRoot, 0o700);
    expect(e.length).toBeGreaterThan(0);
    // 읽기전용 root에서는 lock 생성 자체가 막힌다 — 어느 쪽이든 publish 전 실패다.
    expect(e.join(' ')).toMatch(/WRITE_FAILED|WRITE_PUBLISH_FAILED|WRITE_LOCK_BUSY/);
    expect(snapshot(d)).toEqual(before);
    rmSync(d, { recursive: true, force: true });
  });

  it('RED: PNG 이름이 예약어/경로면 아무것도 쓰지 않는다', () => {
    const d = mk(); const before = seed(d);
    for (const bad of [{ [RUN.BUNDLE_CONTEXT_NAME]: PNG_Y() }, { 'a/b.png': PNG_Y() }, { '../x.png': PNG_Y() }]) {
      const e = RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase: 'light', contextRaw: 'N',
        pngByCaptureName: bad, expectedCaptureNames: Object.keys(bad) });
      expect(e.length).toBeGreaterThan(0);
    }
    expect(snapshot(d)).toEqual(before);
    expect(tempLeftovers(d)).toEqual([]);
    rmSync(d, { recursive: true, force: true });
  });

  it('RED: 캡처 집합 불일치면 이전 bundle 유지', () => {
    const d = mk(); const before = seed(d);
    const e = RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase: 'light', contextRaw: 'N',
      pngByCaptureName: { 'a.png': PNG_Y() }, expectedCaptureNames: ['a.png', 'b.png'] });
    expect(e.join(' ')).toMatch(/WRITE_CAPTURE_SET_MISMATCH/);
    expect(snapshot(d)).toEqual(before);
    rmSync(d, { recursive: true, force: true });
  });

  it('기존 bundle이 있어도 교체는 원자적이고 잔존 temp가 없다', () => {
    const d = mk(); seed(d);
    expect(RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase: 'light', contextRaw: 'CTX2',
      pngByCaptureName: { 'b.png': PNG_Y() }, expectedCaptureNames: ['b.png'] })).toEqual([]);
    const r = RUN.readCandidateBundle(d, 'light');
    expect(r.contextRaw).toBe('CTX2');
    expect(Object.keys(r.pngByName)).toEqual(['b.png']);       // 옛 a.png는 남지 않는다
    expect(tempLeftovers(d)).toEqual([]);
    rmSync(d, { recursive: true, force: true });
  });

  it('phase는 서로 다른 bundle이다', () => {
    const d = mk();
    RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase: 'light', contextRaw: 'L', pngByCaptureName: { 'a.png': PNG_X() }, expectedCaptureNames: ['a.png'] });
    RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase: 'dark', contextRaw: 'D', pngByCaptureName: { 'a.png': PNG_Y() }, expectedCaptureNames: ['a.png'] });
    expect(RUN.readCandidateBundle(d, 'light').contextRaw).toBe('L');
    expect(RUN.readCandidateBundle(d, 'dark').contextRaw).toBe('D');
    rmSync(d, { recursive: true, force: true });
  });

  it('bundle이 없거나 context가 빠지면 읽기가 실패한다', () => {
    const d = mk();
    expect(RUN.readCandidateBundle(d, 'light').errors.join(' ')).toMatch(/BUNDLE_MISSING/);
    seed(d);
    // pointer가 가리키는 디렉터리를 지우면 target missing이다.
    const name = readFileSync(join(d, RUN.CANDIDATE_ROOT, RUN.CANDIDATE_POINTER('light')), 'utf8').trim();
    rmSync(join(d, RUN.CANDIDATE_ROOT, name), { recursive: true, force: true });
    expect(RUN.readCandidateBundle(d, 'light').errors.join(' ')).toMatch(/BUNDLE_TARGET_MISSING/);
    rmSync(d, { recursive: true, force: true });
  });
});

// ── evidence가 승인 경로를 실제로 막는다 ────────────────────────────────────
describe('S4 evidence 배선 — 변조 시 public 승인에서 serialize/write 0회', () => {
  const DIR = new URL('./__fixtures__/s4-discovery-evidence/', import.meta.url);
  const REPO = fileURLToPath(new URL('../..', import.meta.url));
  const gitBlob = (ref, rel) => {
    try { return execSync(`git -C ${REPO} rev-parse ${ref}:${rel}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch (e) { return null; }
  };
  const load = () => Object.fromEntries(EV.DISCOVERY_EVIDENCE_FILES
    .map((n) => [n, readFileSync(new URL(n, DIR), 'utf8')]));
  // AW 세계에 **production evidence + production manifest**를 결합한다.
  // (AW의 합성 world는 계약 축을 시험하고, 여기서는 evidence 축만 본다.)
  const EV_SPEC = () => ({ ...AW_SPEC,
    EXPECTED_DATASET_MANIFEST: SPEC.EXPECTED_DATASET_MANIFEST,
    DATASET_ENDPOINTS: SPEC.DATASET_ENDPOINTS,
    REVIEWED_CLASSIFICATION: SPEC.REVIEWED_CLASSIFICATION,
    PROVENANCE_BLOB_PATHS: SPEC.PROVENANCE_BLOB_PATHS,
    REQUIRED_SMOKE_SURFACES: SPEC.REQUIRED_SMOKE_SURFACES });
  const call = (evidence, specOver) => {
    const c = { serialize: 0, write: 0 };
    const r = EV.approveAndWrite({
      fixture: AW_FIXTURE(), spec: specOver || AW_SPEC, contrastResults: [],
      actualDecls: UNIT_DECLS, actualRaw: '', preAnnSources: {},
      actualAllowIdToKey: UNIT_ACTUAL_ALLOW_MAP, baseDecls: UNIT_BASE_DECLS,
      provenanceRefs: { headCommit: 'unit', headBlobs: {}, specFingerprintNow: 'unit' },
      contextRaw: AW_CTX_RAW(), sha256, readPng: AW_READ_PNG,
      discoveryEvidence: evidence,
      serialize: () => { c.serialize += 1; return 'BYTES'; }, write: () => { c.write += 1; } });
    return { r, c };
  };
  // production manifest + production evidence로 부르면 evidence 단계는 통과해야 한다.
  const good = () => ({ files: load(), gitBlob });
  const mutated = (fn, which = 'runA.out') => {
    const f = load(); const p = JSON.parse(f[which]); fn(p);
    f[which] = JSON.stringify(p, null, 1);
    return { files: f, gitBlob };
  };

  it('evidence 단계가 다른 모든 단계보다 먼저다', () => {
    const { r, c } = call(null);
    expect(r.errors).toEqual(['APPROVE_EVIDENCE_REQUIRED']);
    expect(r.calls).toEqual({ candidate: 0, conformance: 0, artifacts: 0, evidence: 1 });
    expect(c).toEqual({ serialize: 0, write: 0 });
    expect(r.wrote).toBe(false);
  });

  it('production evidence + production manifest는 evidence 단계를 통과한다', () => {
    const { r } = call(good(), EV_SPEC());
    expect(r.calls.evidence).toBe(1);
    expect(r.errors.join(' ')).not.toMatch(/^EVIDENCE /);
    expect(r.calls.candidate).toBe(1);          // 다음 단계로 넘어갔다
  });

  const MUTATIONS = [
    ['B.bySurface={}', () => ({ files: { ...load(), 'runB.out': JSON.stringify({ ...JSON.parse(load()['runB.out']), bySurface: {} }, null, 1) }, gitBlob })],
    ['A.bySurface extra endpoint', () => mutated((p) => { p.bySurface.canvas['GET http://localhost:10001/api/ghost 200'] = 1; })],
    ['A/B endpoint + manifest 동시 변조, digest 유지', () => mutated((p) => {
      const i = p.endpoints.findIndex((x) => x.includes('/tracks/5/items'));
      p.endpoints[i] = p.endpoints[i].replace('/tracks/5/items', '/tracks/5/swapped');
    })],
    ['fake provenance blob 9개', () => mutated((p) => {
      p.provenance.blobs = Object.fromEntries(Object.keys(p.provenance.blobs).map((k) => [k, 'a'.repeat(40)]));
    })],
    ['stderr FATAL', () => ({ files: { ...load(), 'runA.err': 'FATAL: something broke\n' }, gitBlob })],
    ['adapter []', () => ({ files: { ...load(), 'runA.adapter.json': '[]' }, gitBlob })],
    ['evidence 파일 누락', () => { const f = load(); delete f['runB.out']; return { files: f, gitBlob }; }],
  ];
  it.each(MUTATIONS)('RED: %s → serialize/write 0회', (_name, build) => {
    const { r, c } = call(build(), EV_SPEC());
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.join(' ')).toMatch(/^EVIDENCE |APPROVE_EVIDENCE/);
    expect(r.calls).toEqual({ candidate: 0, conformance: 0, artifacts: 0, evidence: 1 });
    expect(c).toEqual({ serialize: 0, write: 0 });
    expect(r.wrote).toBe(false);
  });

  it('RED: /items를 dataset→ambient로 옮기면 검수 동결본과 어긋난다', () => {
    const man = JSON.parse(JSON.stringify(SPEC.EXPECTED_DATASET_MANIFEST));
    const i = man.dataset.findIndex((e) => e.urlTemplate.endsWith('/items'));
    man.ambient.push(man.dataset.splice(i, 1)[0]);
    man.ambient.sort((a, b) => (a.urlTemplate < b.urlTemplate ? -1 : 1));
    const spec = { ...EV_SPEC(), EXPECTED_DATASET_MANIFEST: man,
      DATASET_ENDPOINTS: man.dataset.map((e) => e.urlTemplate) };
    const { r, c } = call(good(), spec);
    expect(r.errors.join(' ')).toMatch(/EVIDENCE_REVIEWED_CATEGORY .*\/items.* manifest=ambient reviewed=dataset/);
    expect(c).toEqual({ serialize: 0, write: 0 });
    expect(r.calls.candidate).toBe(0);
  });

  it('s4-gen과 promotion 둘 다 evidence를 요구한다', () => {
    const gen = readFileSync(new URL('../scripts/s4-gen.mjs', import.meta.url), 'utf8');
    expect(gen).toContain('DISCOVERY_EVIDENCE_FAILED');
    expect(gen).toContain('discoveryEvidence: DISCOVERY_EVIDENCE');
    // projection보다 먼저다.
    expect(gen.indexOf('DISCOVERY_EVIDENCE_FAILED')).toBeLessThan(gen.indexOf('PROJ.buildProjection('));
    // promotion은 인자로 강제한다(행동 확인).
    const r = PROM.promoteRelease({ fixturesDir: '/tmp', spec: SPEC, provenanceRefs: {},
      fromRelease: null, fixture: {}, expectedBytes: '' });
    expect(r.promoted).toBe(false);
    expect(r.errors).toEqual(['PROMOTE_REPO_DIR_REQUIRED']);   // repoDir 없이는 resolver를 만들 수 없다
    expect(readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8'))
      .toContain('PROMOTE_EVIDENCE_REQUIRED');
  });
});

// ── phase 성공 통합 ─────────────────────────────────────────────────────────
describe('S4 phase positive — capturePhaseCore가 code=0에 도달한다', () => {
  const PORT = 10431;
  // **pure core를 시험한다.** 실제 writer는 REPO_DIR만 쓰므로 caller가 provenance 루트를
  // 바꿀 방법이 없다(그게 finding 4의 계약이다). 여기서는 core가 돌려준 메모리 결과를
  // 직접 writeCandidate에 넣어 write 축까지 확인한다.
  // committed runner 의미론을 충족하는 **최소 독립 world**. surface 1개, 액션 goto 1개.
  const SURF = { name: 'p1', captureName: 'p1.png', actions: [{ op: 'goto', url: '/x' }],
    requiredElements: ['.Req'], coverageSelectors: [{ selector: '.Cov' }], darkReviewSelectors: [] };
  // specFingerprint가 payload 키 전부를 읽으므로 정본 spec을 바탕으로 두고 **이 축에 쓰이는
  // 것만** 갈아끼운다. 빠진 키가 있으면 fingerprint 단계에서 죽는다(실증).
  const P_SPEC = () => ({ ...SPEC, ...DS_SPEC({ REQUIRED_SMOKE_SURFACES: [SURF] }),
    RASTER_CONTRACT: { width: 40, height: 30, dpr: 1, screenshotScale: 'css' },
    LIGHT_DIFF_MASKS: {}, ELEMENT_SCALES: {} });
  const PNG40 = () => pngBytes(40, 30, 7);
  // fake adapter: runner가 요구하는 원시 동작에만 응답한다(판정은 전부 커밋된 러너가 한다).
  const adapter = async ({ port, evalFor, W }) => {
    const seen = { methods: [], noActive: [], shutdown: false, clean: false };
    for (let i = 0; i < 3000; i += 1) {
      let cmd;
      try { cmd = await (await fetch(`http://127.0.0.1:${port}/next`)).json(); } catch (e) { break; }
      if (cmd.done) break;
      seen.methods.push(cmd.method);
      let value = null; let error = null;
      const [a, b] = cmd.args;
      if (cmd.method === 'hello') value = { protocol: 's4-bridge/2', echo: a };
      else if (cmd.method === 'beginAttempt') { seen.page = true; value = { ok: true, attempt: a }; }
      else if (cmd.method === 'endAttempt') { seen.page = false; value = { ok: true, attempt: a }; }
      else if (cmd.method === 'shutdown') { seen.shutdown = true; value = { ok: true }; }
      else if (!seen.page) { seen.noActive.push(cmd.method); error = 'NO_ACTIVE_ATTEMPT'; }
      else if (cmd.method === 'screenshot') value = PNG40().toString('base64');
      else if (cmd.method === 'setStorage') { W.store[a] = b; }
      else if (cmd.method === 'reload') { W.dataTheme = W.store.theme ?? null; }
      else if (cmd.method === 'evaluate') value = evalFor(a, b);
      try {
        await fetch(`http://127.0.0.1:${port}/`, { method: 'POST',
          body: JSON.stringify({ id: cmd.id, value, error }), headers: { 'content-type': 'application/json' } });
      } catch (e) { break; }
      if (cmd.method === 'shutdown') { seen.clean = true; break; }
    }
    return seen;
  };
  // 브라우저 상태를 흉내내는 최소 저장소 — 러너는 이전 상태를 읽고 되돌리는 것까지 요구한다.
  const world = () => ({ store: { theme: 'light', [`track:${DS_SC().trackId}:lastView`]: 'flow' }, dataTheme: 'light' });
  const makeEval = (W) => (src, arg) => {
    if (src === PROBE.ASSERT_SOURCE) return Object.fromEntries((arg || []).map((s2) => [s2, { count: 1, visible: 1 }]));
    if (src === PROBE.THEME_PROBE_SOURCE) return { dataTheme: W.dataTheme, stored: W.store.theme };
    if (src === PROBE.RASTER_PROBE_SOURCE) return { dpr: 1, innerWidth: 40, innerHeight: 30, scrollX: 0, scrollY: 0, docScrollWidth: 40 };
    if (src === PROBE.PSEUDO_PROBE_SOURCE) return {};
    if (src === RUN.READ_STORAGE_SOURCE)
      return Object.fromEntries((arg || []).map((k) => [k, { present: Object.prototype.hasOwnProperty.call(W.store, k), value: W.store[k] ?? null }]));
    if (src === RUN.RESTORE_STORAGE_SOURCE) {
      for (const [k, v] of (arg || [])) { if (v && v.present) W.store[k] = v.value; else delete W.store[k]; }
      W.dataTheme = W.store.theme ?? null;
      return { ok: true };
    }
    if (src === PROBE.DATASET_PROBE_SOURCE) return (arg || []).map((url) => {
      const sc = DS_SC();
      let body = '{"status":true}';
      if (url === `${sc.apiOrigin}/branches`) body = JSON.stringify({ status: true, branches: [{ branch_id: sc.bulkBranchId, branch_name: sc.branchName }] });
      else if (url === `${sc.apiOrigin}/branches/${sc.bulkBranchId}/epics`) body = JSON.stringify({ status: true, epics: [{ epic_id: sc.bulkEpicId, epic_name: sc.epicName }] });
      return { url, status: 200, body };
    });
    if (src === PROBE.PROBE_SOURCE) return Object.fromEntries((arg || []).map((s2) => [s2, []]));
    return {};
  };
  const run = async (over = {}) => {
    const port = over.port || PORT;
    const out = []; const errs = [];
    const cli = CAP.parseCaptureArgs(['--phase', 'light', '--port', String(port), '--timeoutMs', '4000'], SPEC);
    const dir = mkdtempSync(join(tmpdir(), 's4pos-'));
    const spec = over.spec || P_SPEC();
    const p = CAP.capturePhaseCore({ SPEC: spec, cli,
      head: { headCommit: 'a'.repeat(40), blobs: {} },
      log: (m) => out.push(m), err: (m) => errs.push(m) });
    await new Promise((r) => setTimeout(r, 200));
    const W = world();
    const seen = await adapter({ port, W, evalFor: over.makeEval ? over.makeEval(W) : makeEval(W) });
    const core = await p;
    let bundle = null;
    if (core.code === 0 && !over.skipWrite) {
      const w = RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: dir, phase: 'light',
        contextRaw: core.result.contextRaw, pngByCaptureName: core.result.pngByCaptureName,
        expectedCaptureNames: core.result.expectedCaptureNames });
      expect(w).toEqual([]);
      const rb = RUN.readCandidateBundle(dir, 'light');
      bundle = rb.errors.length ? null : rb;
    }
    const res = { code: core.code, out, errs, seen, bundle };
    rmSync(dir, { recursive: true, force: true });
    return res;
  };

  it('GREEN: code=0, candidate context와 PNG가 모두 완성된다', async () => {
    const r = await run();
    expect(r.errs.join(' ')).not.toMatch(/CAPTURE FAILED|WRITE FAILED|DATASET_|HEAD_BINDING/);
    expect(r.code).toBe(0);
    expect(r.seen.noActive).toEqual([]);
    expect(r.seen.clean).toBe(true);
    expect(r.bundle).not.toBe(null);
    expect(Object.keys(r.bundle.pngByName)).toEqual(['p1.png']);
    expect(EV.decodePngHeader(r.bundle.pngByName['p1.png']).ok).toBe(true);
    const ctx = JSON.parse(r.bundle.contextRaw);
    expect(ctx.phase).toBe('light');
    expect(ctx.provenance.datasetDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Array.isArray(ctx.datasetResponses)).toBe(true);
  }, 40000);

  it('RED: 항상 실패하는 runner mutant → code=1, bundle 없음', async () => {
    const r = await run({ port: PORT + 1,
      makeEval: (W) => { const base = makeEval(W);
        return (src, arg) => (src === PROBE.ASSERT_SOURCE
          ? Object.fromEntries((arg || []).map((s2) => [s2, { count: 0, visible: 0 }])) : base(src, arg)); } });
    expect(r.code).toBe(1);
    expect(r.errs.join(' ')).toMatch(/CAPTURE FAILED/);
    expect(r.bundle).toBe(null);
  }, 40000);

  it('RED: write를 생략하면 code=0이어도 bundle이 없다', async () => {
    const r = await run({ port: PORT + 2, skipWrite: true });
    expect(r.code).toBe(0);
    expect(r.bundle).toBe(null);          // GREEN 테스트가 요구하는 축이 실제로 살아 있다
  }, 40000);

  it('실제 writer는 REPO_DIR만 쓴다 — caller가 provenance 루트를 못 바꾼다', () => {
    const src = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('async function runPhaseCaptureImpl'));
    const body = fn.slice(0, fn.indexOf('\nif (process.argv'));
    expect(body).toContain('const repoDir = REPO_DIR;');
    expect(fn.slice(0, fn.indexOf('{'))).not.toContain('repoDir');   // 시그니처에 없다
    expect(body).toContain('writeCandidate({');
    // pure core는 아무것도 쓰지 않는다.
    const core = src.slice(src.indexOf('export async function capturePhaseCore'),
      src.indexOf('async function runPhaseCaptureImpl'));
    expect(core).not.toContain('writeCandidate');
  });
});

// ── candidate publish 실패 행렬 ─────────────────────────────────────────────
describe('S4 candidate publish — pointer 하나만 바뀌고 public 경로가 끊기지 않는다', () => {
  const mk = () => mkdtempSync(join(tmpdir(), 's4pub-'));
  const root = (d) => join(d, RUN.CANDIDATE_ROOT);
  const ptr = (d) => join(root(d), RUN.CANDIDATE_POINTER('light'));
  const put = (d, ctx, pngs) => RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase: 'light',
    contextRaw: ctx, pngByCaptureName: pngs, expectedCaptureNames: Object.keys(pngs) });
  const readable = (d) => { const r = RUN.readCandidateBundle(d, 'light'); return r.errors.length ? null : r; };

  it('교체는 pointer 한 번만 바꾼다 — 이전 bundle 디렉터리는 남는다', () => {
    const d = mk();
    expect(put(d, 'A', { 'a.png': Buffer.from('1') })).toEqual([]);
    const first = readFileSync(ptr(d), 'utf8').trim();
    expect(put(d, 'B', { 'b.png': Buffer.from('2') })).toEqual([]);
    const second = readFileSync(ptr(d), 'utf8').trim();
    expect(second).not.toBe(first);
    expect(existsSync(join(root(d), first))).toBe(true);      // 이전 것이 살아 있다
    expect(readable(d).contextRaw).toBe('B');
    rmSync(d, { recursive: true, force: true });
  });

  it('같은 내용은 같은 bundle을 가리킨다(content-addressed, immutable)', () => {
    const d = mk();
    put(d, 'A', { 'a.png': Buffer.from('1') });
    const n1 = readFileSync(ptr(d), 'utf8').trim();
    put(d, 'A', { 'a.png': Buffer.from('1') });
    expect(readFileSync(ptr(d), 'utf8').trim()).toBe(n1);
    rmSync(d, { recursive: true, force: true });
  });

  it('pointer rename 실패 → 이전 candidate가 계속 readable', () => {
    const d = mk();
    put(d, 'A', { 'a.png': Buffer.from('1') });
    const before = readable(d);
    // pointer 경로를 디렉터리로 만들어 rename을 실패시킨다.
    rmSync(ptr(d)); mkdirSync(ptr(d));
    const e = put(d, 'B', { 'b.png': Buffer.from('2') });
    expect(e.join(' ')).toMatch(/WRITE_POINTER_FAILED|WRITE_NODE_NOT_FILE/);
    rmSync(ptr(d), { recursive: true, force: true });
    writeFileSync(ptr(d), `${before.bundleName}\n`);
    expect(readable(d).contextRaw).toBe('A');                 // 내용은 그대로였다
    rmSync(d, { recursive: true, force: true });
  });

  it('publish 실패(권한) → pointer 불변, 이전 candidate readable', () => {
    const d = mk();
    put(d, 'A', { 'a.png': Buffer.from('1') });
    const before = readFileSync(ptr(d), 'utf8');
    chmodSync(root(d), 0o500);
    const e = put(d, 'B', { 'b.png': Buffer.from('2') });
    chmodSync(root(d), 0o700);
    expect(e.length).toBeGreaterThan(0);
    expect(e.join(' ')).not.toMatch(/COMMITTED_BUT/);
    expect(readFileSync(ptr(d), 'utf8')).toBe(before);
    expect(readable(d).contextRaw).toBe('A');
    rmSync(d, { recursive: true, force: true });
  });

  it('프로세스 중단 모사 — bundle만 있고 pointer가 안 바뀐 상태는 이전 것을 읽는다', () => {
    const d = mk();
    put(d, 'A', { 'a.png': Buffer.from('1') });
    const before = readFileSync(ptr(d), 'utf8').trim();
    // 새 bundle 디렉터리만 만들어 두고 pointer는 건드리지 않는다.
    const orphan = join(root(d), `bundle-light-${'f'.repeat(64)}`);
    mkdirSync(orphan, { recursive: true }); writeFileSync(join(orphan, RUN.BUNDLE_CONTEXT_NAME), 'B');
    expect(readFileSync(ptr(d), 'utf8').trim()).toBe(before);
    expect(readable(d).contextRaw).toBe('A');
    rmSync(d, { recursive: true, force: true });
  });

  it('pointer가 이상하거나 대상이 없으면 읽기 실패(조용히 통과하지 않는다)', () => {
    const d = mk();
    put(d, 'A', { 'a.png': Buffer.from('1') });
    writeFileSync(ptr(d), '../escape\n');
    expect(RUN.readCandidateBundle(d, 'light').errors.join(' ')).toMatch(/BUNDLE_POINTER_INVALID/);
    writeFileSync(ptr(d), 'bundle-light-deadbeef\n');
    expect(RUN.readCandidateBundle(d, 'light').errors.join(' ')).toMatch(/BUNDLE_TARGET_MISSING/);
    rmSync(d, { recursive: true, force: true });
  });

  it('bundle 내용이 변조되면 이름과 어긋난다', () => {
    const d = mk();
    put(d, 'A', { 'a.png': Buffer.from('1') });
    const name = readFileSync(ptr(d), 'utf8').trim();
    writeFileSync(join(root(d), name, RUN.BUNDLE_CONTEXT_NAME), 'TAMPERED');
    expect(RUN.readCandidateBundle(d, 'light').errors.join(' ')).toMatch(/BUNDLE_CONTENT_DRIFT/);
    rmSync(d, { recursive: true, force: true });
  });

  it('rollback 코드가 없다 — 되돌릴 것이 없는 설계다', () => {
    const src = readFileSync(new URL('./s4CaptureRunner.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function writeCandidate'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).not.toContain('parked');
    expect(body.match(/renameSync\(/g) || []).toHaveLength(2);   // bundle 공개 1 + pointer 1
  });
});

// ── spec 단일 스냅샷 ────────────────────────────────────────────────────────
describe('S4 spec 단일 스냅샷 — 루트 getter는 한 번만 조회된다', () => {
  it('getter가 조회마다 다른 manifest를 줘도 evidence와 downstream이 갈리지 않는다', () => {
    const se = synEvidence(AW_SPEC);
    let reads = 0;
    const tampered = JSON.parse(JSON.stringify(se.spec.EXPECTED_DATASET_MANIFEST));
    tampered.dataset[0].reason = 'TAMPERED';
    const proxy = {};
    for (const k of Object.keys(se.spec)) {
      if (k === 'EXPECTED_DATASET_MANIFEST') {
        Object.defineProperty(proxy, k, { enumerable: true, configurable: true,
          get() { reads += 1; return reads === 1 ? se.spec[k] : tampered; } });
      } else Object.defineProperty(proxy, k, { enumerable: true, configurable: true, value: se.spec[k] });
    }
    const c = { serialize: 0, write: 0 };
    EV.approveAndWrite({ fixture: AW_FIXTURE(), spec: proxy, contrastResults: [],
      discoveryEvidence: { files: se.files, gitBlob: se.gitBlob },
      actualDecls: UNIT_DECLS, actualRaw: '', preAnnSources: {},
      actualAllowIdToKey: UNIT_ACTUAL_ALLOW_MAP, baseDecls: UNIT_BASE_DECLS,
      provenanceRefs: { headCommit: 'unit', headBlobs: {}, specFingerprintNow: 'unit' },
      contextRaw: AW_CTX_RAW(), sha256, readPng: AW_READ_PNG,
      serialize: () => { c.serialize += 1; return 'B'; }, write: () => { c.write += 1; } });
    expect(reads).toBe(1);                       // 정확히 한 번만 조회된다
  });

  it('snapshotSpec은 진입 직후 한 번이고 evidence보다 앞이다', () => {
    const src = readFileSync(new URL('./s4Evaluator.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function approveAndWrite'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body.match(/snapshotSpec\(spec\)/g) || []).toHaveLength(1);
    expect(body.indexOf('snapshotSpec(spec)')).toBeLessThan(body.indexOf('verifyDiscoveryEvidence('));
  });
});

// ── phase mid-run dirty ─────────────────────────────────────────────────────
describe('S4 phase mid-run dirty — worktree가 더러워지면 write 0회', () => {
  const exec = (out) => () => out;
  it('tracked 수정·staged·untracked·rename·status 실패를 각각 잡는다', () => {
    const cases = [
      [' M frontend/styles/components/track/track.scss\0', /M frontend\/styles/],
      ['M  frontend/library/s4Spec.mjs\0', /M  frontend\/library/],
      ['?? frontend/newfile.js\0', /\?\? frontend\/newfile/],
      ['R  new/path.js\0old/path.js\0', /R {2}old\/path.js -> new\/path.js/],
    ];
    // 파싱 계약은 **순수 함수**로 본다 — exec 주입 지점을 만들지 않는다.
    const text = (es) => es.map((e2) => (e2.from ? `${e2.xy} ${e2.from} -> ${e2.path}` : `${e2.xy} ${e2.path}`)).join(' ');
    for (const [porcelain, rx] of cases) {
      const es = PROM.parsePorcelainZ(porcelain);
      expect(es.length, porcelain).toBeGreaterThan(0);
      expect(text(es)).toMatch(rx);
    }
    // git status 자체가 실패하면 fail-closed다 — git repo가 아닌 실제 경로로 확인한다.
    const notRepo = mkdtempSync(join(tmpdir(), 's4-notrepo-'));
    try {
      expect(CAP.worktreeDirtyEntries(notRepo).join(' ')).toMatch(/WORKTREE_STATUS_FAILED/);
    } finally { rmSync(notRepo, { recursive: true, force: true }); }
    // clean이면 빈 배열
    expect(PROM.parsePorcelainZ('')).toEqual([]);
    void exec;
  });

  it('writer는 캡처 후 postflight에서 worktree를 다시 본다', () => {
    const src = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('async function runPhaseCaptureImpl'));
    const body = fn.slice(0, fn.indexOf('\nif (process.argv'));
    // 게이트 문구는 phaseGateDecision이 만든다 — writer는 start/end 두 번 호출한다.
    // dirty 조기종료 1 + start 1 + end 1
    expect((body.match(/phaseGateDecision\(\{/g) || [])).toHaveLength(3);
    expect(body).toContain("stage: 'start'");
    expect(body).toContain("stage: 'end'");
    expect(body.indexOf("stage: 'end'")).toBeLessThan(body.indexOf('writeCandidate({'));
    expect(src).toContain('WORKTREE_DIRTIED_DURING_CAPTURE');
    // main은 phase 경로에서 worktree를 중복 검사하지 않는다(orchestrator 단독 소유).
    const mainFn = src.slice(src.indexOf('export async function main('), src.indexOf('export function phaseGateDecision'));
    expect(mainFn.indexOf('worktreeDirtyEntries(')).toBeGreaterThan(mainFn.indexOf('if (cli.discover || cli.canary)'));
  });

  it('public CLI 포트는 커밋된 어댑터와 일치한다', () => {
    expect(CAP.ADAPTER_PORT).toBe(10098);
    const adapter = readFileSync(new URL('../scripts/s4-adapter.playwright.js', import.meta.url), 'utf8');
    expect(adapter).toContain(`http://127.0.0.1:${CAP.ADAPTER_PORT}`);
    const src = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    expect(src).toContain('PORT_FIXED');
  });
});

// ── s4-gen Git 호출 경계 ────────────────────────────────────────────────────
describe('S4 generator Git 경계 — 문자열 보간이 없다', () => {
  it('execFileSync + argv 배열이고 ref/rel을 먼저 검증한다', () => {
    const src = readFileSync(new URL('../scripts/s4-gen.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('const gitBlobOid'), src.indexOf('const DISCOVERY_EVIDENCE'));
    expect(fn).toContain('execFileSync(');
    expect(fn).not.toMatch(/execSync\(`git/);
    expect(fn).toContain('GIT_REF_RX.test');
    expect(fn).toContain('CANON_PATHS.has');
    // 검증이 호출보다 앞이다.
    expect(fn.indexOf('CANON_PATHS.has')).toBeLessThan(fn.indexOf('execFileSync('));
  });
  it('evidence preflight가 projection보다 앞이고 실패 시 die한다', () => {
    const src = readFileSync(new URL('../scripts/s4-gen.mjs', import.meta.url), 'utf8');
    expect(src.indexOf('DISCOVERY_EVIDENCE_FAILED')).toBeLessThan(src.indexOf('PROJ.buildProjection('));
    expect(src).toContain('DISCOVERY_EVIDENCE_UNREADABLE');
  });
});

// ── candidate storage 강화 ──────────────────────────────────────────────────
describe('S4 candidate storage — 전용 ignored root, race 재검증, symlink 거부', () => {
  const mk = () => mkdtempSync(join(tmpdir(), 's4cs-'));
  const root = (d) => join(d, RUN.CANDIDATE_ROOT);
  const ptr = (d, ph = 'light') => join(root(d), RUN.CANDIDATE_POINTER(ph));
  const put = (d, ctx, pngs, ph = 'light') => RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase: ph,
    contextRaw: ctx, pngByCaptureName: pngs, expectedCaptureNames: Object.keys(pngs) });
  const P1 = () => ({ 'a.png': Buffer.from('1') });

  it('candidate root는 통째로 gitignore된다 — 이름 규칙이 바뀌어도', () => {
    const gi = readFileSync(new URL('./__fixtures__/.gitignore', import.meta.url), 'utf8');
    expect(gi).toContain(`${RUN.CANDIDATE_ROOT}/`);
    const repo = fileURLToPath(new URL('../..', import.meta.url));
    for (const rel of [`frontend/library/__fixtures__/${RUN.CANDIDATE_ROOT}/light.pointer`,
      `frontend/library/__fixtures__/${RUN.CANDIDATE_ROOT}/bundle-light-x/content.json`]) {
      const ignored = (() => {
        try { execSync(`git -C ${repo} check-ignore -q "${rel}"`, { stdio: 'ignore' }); return true; }
        catch (e) { return false; }
      })();
      expect(ignored, rel).toBe(true);
    }
  });

  it('writer-success ⇒ immediate-reader-success (상설 불변식)', () => {
    const d = mk();
    for (const [ctx, pngs] of [['A', P1()], ['B', { 'b.png': Buffer.from('2') }], ['A', P1()]]) {
      expect(put(d, ctx, pngs)).toEqual([]);
      const r = RUN.readCandidateBundle(d, 'light');
      expect(r.errors).toEqual([]);
      expect(r.contextRaw).toBe(ctx);
      expect(Object.keys(r.pngByName).sort()).toEqual(Object.keys(pngs).sort());
    }
    rmSync(d, { recursive: true, force: true });
  });

  it('light write 후 git status가 clean이고 dark가 시작 가능하다 (임시 repo)', () => {
    // **실제 repo에는 쓰지 않는다.** nested .gitignore를 복사한 임시 Git repo에서 같은 조건을
    // 만든다. 이전 판은 여기서 실제 fixtures에 LIGHT/DARK를 쓰고 root를 rmSync했다 —
    // 사용자의 기존 candidate가 있었다면 지워졌다.
    const d = mkdtempSync(join(tmpdir(), 's4gitrepo-'));
    const fx = join(d, 'frontend', 'library', '__fixtures__');
    mkdirSync(fx, { recursive: true });
    writeFileSync(join(fx, '.gitignore'),
      readFileSync(new URL('./__fixtures__/.gitignore', import.meta.url), 'utf8'));
    writeFileSync(join(fx, 'keep.txt'), 'x');
    execSync(`git -C ${d} init -q && git -C ${d} add -A && ` +
      `git -C ${d} -c user.email=t@t -c user.name=t commit -q -m init`, { stdio: 'ignore' });
    const status = () => execSync(`git -C ${d} status --porcelain -z --untracked-files=all`, { encoding: 'utf8' });
    expect(status()).toBe('');
    expect(put(fx, 'LIGHT', P1(), 'light')).toEqual([]);
    expect(status()).toBe('');                       // candidate가 worktree를 더럽히지 않는다
    expect(CAP.worktreeDirtyEntries(d)).toEqual([]);
    expect(put(fx, 'DARK', P1(), 'dark')).toEqual([]);
    expect(status()).toBe('');
    expect(RUN.readCandidateBundle(fx, 'light').contextRaw).toBe('LIGHT');
    expect(RUN.readCandidateBundle(fx, 'dark').contextRaw).toBe('DARK');
    rmSync(d, { recursive: true, force: true });
  });

  it('RED: preseed된 wrong/incomplete bundle은 pointer 전환 전에 잡힌다', () => {
    const d = mk();
    const hash = RUN.bundleContentHash('A', P1());
    const name = `bundle-light-${hash}`;
    mkdirSync(join(root(d), name), { recursive: true });
    writeFileSync(join(root(d), name, RUN.BUNDLE_CONTEXT_NAME), 'WRONG');   // 이름과 내용이 다르다
    writeFileSync(join(root(d), name, 'a.png'), '1');
    expect(put(d, 'A', P1()).join(' ')).toMatch(/WRITE_BUNDLE_HASH_MISMATCH/);
    expect(existsSync(ptr(d))).toBe(false);                                  // pointer는 안 생겼다
    // 불완전(파일 누락)
    rmSync(join(root(d), name, 'a.png'));
    expect(put(d, 'A', P1()).join(' ')).toMatch(/WRITE_BUNDLE_FILE_SET/);
    expect(existsSync(ptr(d))).toBe(false);
    rmSync(d, { recursive: true, force: true });
  });

  it('RED: symlink root / bundle / pointer / target-file / dotfile', () => {
    const d = mk(); const outside = mkdtempSync(join(tmpdir(), 's4out-'));
    // root가 symlink
    symlinkSync(outside, root(d));
    expect(put(d, 'A', P1()).join(' ')).toMatch(/WRITE_NODE_SYMLINK|WRITE_NODE_ESCAPES/);
    rmSync(root(d));
    // bundle이 symlink
    mkdirSync(root(d), { recursive: true });
    symlinkSync(outside, join(root(d), `bundle-light-${RUN.bundleContentHash('A', P1())}`));
    expect(put(d, 'A', P1()).join(' ')).toMatch(/WRITE_NODE_SYMLINK|WRITE_NODE_ESCAPES/);
    rmSync(join(root(d), `bundle-light-${RUN.bundleContentHash('A', P1())}`));
    // pointer가 디렉터리
    mkdirSync(ptr(d));
    expect(put(d, 'A', P1()).join(' ')).toMatch(/WRITE_NODE_NOT_FILE/);
    rmSync(ptr(d), { recursive: true, force: true });
    // 정상 기록 후 target을 파일로 바꾸면 읽기가 거부
    expect(put(d, 'A', P1())).toEqual([]);
    const nm = readFileSync(ptr(d), 'utf8').trim();
    rmSync(join(root(d), nm), { recursive: true, force: true });
    writeFileSync(join(root(d), nm), 'not a dir');
    expect(RUN.readCandidateBundle(d, 'light').errors.join(' ')).toMatch(/BUNDLE_NODE_NOT_DIR/);
    rmSync(join(root(d), nm)); mkdirSync(join(root(d), nm));
    writeFileSync(join(root(d), nm, RUN.BUNDLE_CONTEXT_NAME), 'A');
    writeFileSync(join(root(d), nm, 'a.png'), '1');
    writeFileSync(join(root(d), nm, '.hidden'), 'x');
    expect(RUN.readCandidateBundle(d, 'light').errors.join(' ')).toMatch(/BUNDLE_DOTFILE/);
    rmSync(d, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true });
  });

  it('RED: malformed 입력은 throw하지 않고 controlled error를 낸다', () => {
    const d = mk();
    for (const args of [
      { phase: 'nope', contextRaw: 'x', pngByCaptureName: P1(), expectedCaptureNames: ['a.png'] },
      { phase: 'light', contextRaw: 1, pngByCaptureName: P1(), expectedCaptureNames: ['a.png'] },
      { phase: 'light', contextRaw: 'x', pngByCaptureName: null, expectedCaptureNames: [] },
      { phase: 'light', contextRaw: 'x', pngByCaptureName: { '.dot.png': Buffer.from('1') }, expectedCaptureNames: ['.dot.png'] },
    ]) {
      let out = null;
      expect(() => { out = RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, ...args }); }).not.toThrow();
      expect(Array.isArray(out)).toBe(true);
      expect(out.length).toBeGreaterThan(0);
    }
    expect(RUN.readCandidateBundle(d, 'nope').errors.join(' ')).toMatch(/BUNDLE_PHASE_INVALID/);
    rmSync(d, { recursive: true, force: true });
  });
});

// ── provenance 정본 검증 ────────────────────────────────────────────────────
describe('S4 provenance 경로 정본 — 목록 자체를 먼저 검증한다', () => {
  const DIR = new URL('./__fixtures__/s4-discovery-evidence/', import.meta.url);
  const load = () => Object.fromEntries(EV.DISCOVERY_EVIDENCE_FILES.map((n) => [n, readFileSync(new URL(n, DIR), 'utf8')]));
  const run = (paths) => { let calls = 0;
    const e = EV.verifyDiscoveryEvidence({ files: load(), spec: { ...SPEC, PROVENANCE_BLOB_PATHS: paths },
      scenario: EV.buildActionContext(SPEC.SCENARIO_CANON), sha256Hex: sha256,
      gitBlob: () => { calls += 1; return null; } });
    return { e: e.join(' '), calls }; };
  const P = () => [...SPEC.PROVENANCE_BLOB_PATHS];

  it('RED: duplicate append / duplicate-replaces-one — Git 호출 0회', () => {
    const a = run([...P(), P()[0]]);
    expect(a.e).toMatch(/EVIDENCE_PROVENANCE_PATH_DUPLICATE/);
    expect(a.calls).toBe(0);
    const rep = P(); rep[1] = rep[0];
    const b = run(rep);
    expect(b.e).toMatch(/EVIDENCE_PROVENANCE_PATH_DUPLICATE/);
    expect(b.e).toMatch(/EVIDENCE_PROVENANCE_PATH_CARDINALITY 8 != 9/);
    expect(b.calls).toBe(0);
  });

  it('RED: 배열 아님 / 비문자열 / 비정규형 — Git 호출 0회', () => {
    for (const bad of ['x', null, [], [1, 2], ['/abs/path'], ['a/'], ['a//b'], ['a/../b'], ['a\\\\b'], ['  sp  ']]) {
      const r = run(bad);
      expect(r.e.length, JSON.stringify(bad)).toBeGreaterThan(0);
      expect(r.calls, JSON.stringify(bad)).toBe(0);
    }
  });

  it('RED: A/B 경로 집합에 오류가 있으면 Git 호출 0회', () => {
    const f = load();
    for (const which of ['runA.out', 'runB.out']) {
      const p = JSON.parse(f[which]);
      const blobs = { ...p.provenance.blobs }; delete blobs[Object.keys(blobs)[0]];
      p.provenance.blobs = blobs;
      const g = { ...f, [which]: JSON.stringify(p, null, 1) };
      const man = JSON.parse(JSON.stringify(SPEC.EXPECTED_DATASET_MANIFEST));
      man.evidence.files = { ...man.evidence.files, [which]: sha256(g[which]) };
      let calls = 0;
      const e = EV.verifyDiscoveryEvidence({ files: g, spec: { ...SPEC, EXPECTED_DATASET_MANIFEST: man },
        scenario: EV.buildActionContext(SPEC.SCENARIO_CANON), sha256Hex: sha256,
        gitBlob: () => { calls += 1; return null; } });
      expect(e.join(' '), which).toMatch(/EVIDENCE_BLOB_PATH_SET_INVALID/);
      expect(calls, which).toBe(0);
    }
  });

  it('정상 목록에서는 Git이 정확히 경로 수만큼 호출된다', () => {
    let calls = 0;
    EV.verifyDiscoveryEvidence({ files: load(), spec: SPEC,
      scenario: EV.buildActionContext(SPEC.SCENARIO_CANON), sha256Hex: sha256,
      gitBlob: (ref, rel) => { calls += 1; return null; } });
    expect(calls).toBe(SPEC.PROVENANCE_BLOB_PATHS.length);
  });
});

// (구 phase authority describe는 제거했다 — production sink가 non-exported가 되면서
//  exec 주입으로 시험할 수 없다. 그 축은 'S4 phase gate' describe의 순수 결정 함수와
//  실제 Git checkout 테스트가 대신 덮는다.)

// ── lifecycle 출력 순서 ─────────────────────────────────────────────────────
describe('S4 lifecycle 진단 — primary 다음에 나온다', () => {
  it('thrown primary + endAttempt 실패의 stderr 순서', async () => {
    const PORT = 10461;
    const errs = [];
    const cliX = CAP.parseCaptureArgs(['--canary', 'canvas', '--repeat', '2', '--port', String(PORT), '--timeoutMs', '1500'], SPEC);
    const p = CAP.withBridge({ cli: cliX, err: (m) => errs.push(m), label: 'unit' },
      async () => CAP.withAttempt(
        { beginAttempt: async () => ({ ok: true }), endAttempt: async () => { throw new Error('END_BOOM'); } },
        1, async () => { throw new Error('PRIMARY_THROWN'); }));
    // hello와 shutdown만 답하는 최소 어댑터.
    for (let i = 0; i < 40; i += 1) {
      let cmd = null;
      try { cmd = await (await fetch(`http://127.0.0.1:${PORT}/next`)).json(); } catch (e) { break; }
      if (cmd.done) break;
      const value = cmd.method === 'hello' ? { protocol: 's4-bridge/2' } : { ok: true };
      try {
        await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST',
          body: JSON.stringify({ id: cmd.id, value }), headers: { 'content-type': 'application/json' } });
      } catch (e) { break; }
      if (cmd.method === 'shutdown') break;
    }
    const r = await p;
    expect(r.code).toBe(1);
    const iPrimary = errs.findIndex((m) => m.includes('PRIMARY_THROWN'));
    const iLife = errs.findIndex((m) => m.includes('[lifecycle]') && m.includes('END_ATTEMPT_FAILED'));
    expect(iPrimary, errs.join(' | ')).toBeGreaterThanOrEqual(0);
    expect(iLife, errs.join(' | ')).toBeGreaterThan(iPrimary);   // primary가 먼저, lifecycle이 뒤
  }, 20000);
});

// ── candidate commit semantics ──────────────────────────────────────────────
describe('S4 candidate commit — lock · commit point · 입력 검증', () => {
  const mk = () => mkdtempSync(join(tmpdir(), 's4cc-'));
  const root = (d) => join(d, RUN.CANDIDATE_ROOT);
  const put = (d, ctx, pngs, ph = 'light') => RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase: ph,
    contextRaw: ctx, pngByCaptureName: pngs, expectedCaptureNames: Object.keys(pngs) });
  const P1 = () => ({ 'a.png': Buffer.from('1') });

  it('cooperative lock — 잡혀 있으면 쓰지 않는다', () => {
    const d = mk();
    mkdirSync(root(d), { recursive: true });
    writeFileSync(join(root(d), '.lock-light'), '');
    expect(put(d, 'A', P1()).join(' ')).toMatch(/WRITE_LOCK_BUSY/);
    expect(existsSync(join(root(d), RUN.CANDIDATE_POINTER('light')))).toBe(false);
    rmSync(join(root(d), '.lock-light'));
    expect(put(d, 'A', P1())).toEqual([]);                 // 해제되면 진행
    expect(existsSync(join(root(d), '.lock-light'))).toBe(false);   // 쓰고 나면 반납
    rmSync(d, { recursive: true, force: true });
  });

  it('bundle 검증은 pointer rename **전에** 끝난다', () => {
    const d = mk();
    const hash = RUN.bundleContentHash('A', P1());
    mkdirSync(join(root(d), `bundle-light-${hash}`), { recursive: true });
    writeFileSync(join(root(d), `bundle-light-${hash}`, RUN.BUNDLE_CONTEXT_NAME), 'WRONG');
    writeFileSync(join(root(d), `bundle-light-${hash}`, 'a.png'), '1');
    expect(put(d, 'A', P1()).join(' ')).toMatch(/WRITE_BUNDLE_HASH_MISMATCH/);
    expect(existsSync(join(root(d), RUN.CANDIDATE_POINTER('light')))).toBe(false);  // commit 전에 멈춤
    rmSync(d, { recursive: true, force: true });
  });

  it('commit point는 pointer rename이다 — 그 전 실패는 이전 pointer를 보존', () => {
    const d = mk();
    expect(put(d, 'A', P1())).toEqual([]);
    const before = readFileSync(join(root(d), RUN.CANDIDATE_POINTER('light')), 'utf8');
    chmodSync(root(d), 0o500);
    const e = put(d, 'B', { 'b.png': Buffer.from('2') });
    chmodSync(root(d), 0o700);
    expect(e.length).toBeGreaterThan(0);
    expect(e.join(' ')).not.toMatch(/COMMITTED_BUT/);      // publish되지 않은 실패다
    expect(readFileSync(join(root(d), RUN.CANDIDATE_POINTER('light')), 'utf8')).toBe(before);
    expect(RUN.readCandidateBundle(d, 'light').contextRaw).toBe('A');
    rmSync(d, { recursive: true, force: true });
    expect(RUN.COMMIT_POINT).toBe('pointer-rename');
  });

  it('commit 뒤 손상은 "publish되지 않음"이 아니라 별도 코드로 보고한다', () => {
    const src = readFileSync(new URL('./s4CaptureRunner.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function writeCandidate'));
    const body = fn.slice(0, fn.indexOf('\nexport function readCandidateBundle'));
    expect(body).toContain('WRITE_COMMITTED_BUT_UNREADABLE');
    expect(body).toContain('WRITE_COMMITTED_BUT_CONTEXT_MISMATCH');
    expect(body).not.toContain('WRITE_READBACK_');         // 옛 이름은 사라졌다
  });

  it('순차 writer는 last-writer-wins이고 이전 bundle은 남는다', () => {
    const d = mk();
    put(d, 'A', P1());
    const n1 = readFileSync(join(root(d), RUN.CANDIDATE_POINTER('light')), 'utf8').trim();
    put(d, 'B', { 'b.png': Buffer.from('2') });
    const n2 = readFileSync(join(root(d), RUN.CANDIDATE_POINTER('light')), 'utf8').trim();
    expect(n2).not.toBe(n1);
    expect(existsSync(join(root(d), n1))).toBe(true);       // 이전 bundle 존속
    expect(RUN.readCandidateBundle(d, 'light').contextRaw).toBe('B');   // last-writer-wins
    rmSync(d, { recursive: true, force: true });
  });

  it('RED: 입력 형태를 해시 전에 검증한다', () => {
    const d = mk();
    const bad = [
      [{ expectedCaptureNames: 'a.png' }, /WRITE_EXPECTED_NAMES_NOT_ARRAY/],
      [{ expectedCaptureNames: ['a.png', 'a.png'] }, /WRITE_EXPECTED_NAMES_DUPLICATE/],
      [{ expectedCaptureNames: [1] }, /WRITE_EXPECTED_NAMES_NOT_STRINGS/],
      [{ pngByCaptureName: [] }, /WRITE_PNGS_REQUIRED/],
      [{ pngByCaptureName: Object.assign(Object.create({ x: 1 }), { 'a.png': Buffer.from('1') }) }, /WRITE_PNGS_NOT_PLAIN/],
      [{ pngByCaptureName: { 'a.png': 'not bytes' } }, /WRITE_PNG_NOT_BYTES/],
    ];
    for (const [over, rx] of bad) {
      const args = { fixturesDir: d, phase: 'light', contextRaw: 'A',
        expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY,
        pngByCaptureName: P1(), expectedCaptureNames: ['a.png'], ...over };
      let out = null;
      expect(() => { out = RUN.writeCandidate(args); }).not.toThrow();
      expect(out.join(' '), JSON.stringify(Object.keys(over))).toMatch(rx);
    }
    expect(existsSync(root(d))).toBe(false);   // 아무것도 만들지 않았다
    rmSync(d, { recursive: true, force: true });
  });
});

// ── evidence 8파일 결속 ─────────────────────────────────────────────────────
describe('S4 evidence 파일 결속 — 8개 전부 바이트 해시로 묶인다', () => {
  const DIR = new URL('./__fixtures__/s4-discovery-evidence/', import.meta.url);
  const REPO = fileURLToPath(new URL('../..', import.meta.url));
  const gitBlob = (ref, rel) => {
    try { return execSync(`git -C ${REPO} rev-parse ${ref}:${rel}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch (e) { return null; }
  };
  const load = () => Object.fromEntries(EV.DISCOVERY_EVIDENCE_FILES.map((n) => [n, readFileSync(new URL(n, DIR), 'utf8')]));
  const verify = (files) => EV.verifyDiscoveryEvidence({ files, spec: SPEC,
    scenario: EV.buildActionContext(SPEC.SCENARIO_CANON), sha256Hex: sha256, gitBlob });

  it('manifest가 8파일 exact map을 갖고 fingerprint에 반영된다', () => {
    const ev = SPEC.EXPECTED_DATASET_MANIFEST.evidence;
    expect(Object.keys(ev.files).sort()).toEqual([...EV.DISCOVERY_EVIDENCE_FILES].sort());
    expect(Object.keys(ev.files)).toHaveLength(8);
    for (const v of Object.values(ev.files)) expect(v).toMatch(/^[0-9a-f]{64}$/);
    // manifest는 fingerprint payload에 들어 있으므로 map을 바꾸면 지문이 바뀐다.
    const man = JSON.parse(JSON.stringify(SPEC.EXPECTED_DATASET_MANIFEST));
    man.evidence.files['runA.err'] = 'f'.repeat(64);
    expect(EV.specFingerprint(EV.snapshotSpec({ ...SPEC, EXPECTED_DATASET_MANIFEST: man,
      DATASET_ENDPOINTS: man.dataset.map((e) => e.urlTemplate) }).spec, sha256))
      .not.toBe(EV.specFingerprint(EV.snapshotSpec(SPEC).spec, sha256));
  });

  it.each(EV.DISCOVERY_EVIDENCE_FILES)('RED: %s 1바이트 변이', (name) => {
    const f = load(); f[name] = `${f[name]} `;
    expect(verify(f).join(' ')).toContain(`EVIDENCE_FILE_SHA ${name} `);
  });

  it('RED: 파일 집합이 8이 아니면 거부(expected/actual 양쪽)', () => {
    const f = load(); delete f['runB.code'];
    expect(verify(f).join(' ')).toMatch(/EVIDENCE_FILE_MISSING runB.code/);
    const g = { ...load(), extra: 'x' };
    expect(verify(g).join(' ')).toMatch(/EVIDENCE_ACTUAL_FILE_SET/);
    const man = JSON.parse(JSON.stringify(SPEC.EXPECTED_DATASET_MANIFEST));
    delete man.evidence.files['runA.err'];
    expect(EV.verifyDiscoveryEvidence({ files: load(), spec: { ...SPEC, EXPECTED_DATASET_MANIFEST: man },
      scenario: EV.buildActionContext(SPEC.SCENARIO_CANON), sha256Hex: sha256, gitBlob }).join(' '))
      .toMatch(/EVIDENCE_EXPECTED_FILE_SET/);
  });

  it.each(EV.DISCOVERY_EVIDENCE_FILES)('RED: %s 변이 → 승인에서 serialize/write 0회', (name) => {
    const se = synEvidence(AW_SPEC);
    const files = { ...se.files }; files[name] = `${files[name]} `;
    const c = { serialize: 0, write: 0 };
    const r = EV.approveAndWrite({ fixture: AW_FIXTURE(), spec: se.spec, contrastResults: [],
      discoveryEvidence: { files, gitBlob: se.gitBlob },
      actualDecls: UNIT_DECLS, actualRaw: '', preAnnSources: {},
      actualAllowIdToKey: UNIT_ACTUAL_ALLOW_MAP, baseDecls: UNIT_BASE_DECLS,
      provenanceRefs: { headCommit: 'unit', headBlobs: {}, specFingerprintNow: 'unit' },
      contextRaw: AW_CTX_RAW(), sha256, readPng: AW_READ_PNG,
      serialize: () => { c.serialize += 1; return 'B'; }, write: () => { c.write += 1; } });
    expect(r.errors.join(' ')).toMatch(/EVIDENCE/);
    expect(c).toEqual({ serialize: 0, write: 0 });
    expect(r.wrote).toBe(false);
  });
});

// ── phase gate 순수 결정 ────────────────────────────────────────────────────
describe('S4 phase gate — 순수 결정 함수 + 실제 Git checkout', () => {
  const CANON = CAP.HASHED_MODULES;
  const C40 = 'c'.repeat(40);
  const OK_HEAD = { errors: [], headCommit: C40,
    blobs: Object.fromEntries(CANON.map((p, i) => [p, String(i).padStart(40, 'a')])) };
  const CASES = [
    ['tracked 수정', [' M frontend/styles/x.scss']],
    ['staged', ['M  frontend/library/s4Spec.mjs']],
    ['untracked', ['?? frontend/new.js']],
    ['rename', ['R  old.js -> new.js']],
    ['status 실패', ['WORKTREE_STATUS_FAILED git gone']],
  ];
  it.each(CASES)('start %s → 차단', (_n, dirty) => {
    const r = CAP.phaseGateDecision({ stage: 'start', dirtyEntries: dirty, head: OK_HEAD, canonPaths: CANON });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/WORKTREE_DIRTY/);
  });
  it.each(CASES)('end %s → 차단', (_n, dirty) => {
    const r = CAP.phaseGateDecision({ stage: 'end', dirtyEntries: dirty, head: OK_HEAD,
      pinnedBlobs: OK_HEAD.blobs, canonPaths: CANON, startCommit: C40, currentCommit: C40 });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/WORKTREE_DIRTIED_DURING_CAPTURE/);
  });
  it('HEAD drift는 start/end 각각 다른 코드로 차단', () => {
    expect(CAP.phaseGateDecision({ stage: 'start', dirtyEntries: [], canonPaths: CANON,
      head: { errors: ['WORKING_DIFFERS_FROM_HEAD x'], blobs: null } }).errors[0]).toMatch(/HEAD_BINDING_FAILED/);
    const drifted = { ...OK_HEAD, blobs: Object.fromEntries(CANON.map((p, i) => [p, String(i + 1).padStart(40, 'e')])) };
    expect(CAP.phaseGateDecision({ stage: 'end', dirtyEntries: [], head: drifted,
      pinnedBlobs: OK_HEAD.blobs, canonPaths: CANON, startCommit: C40, currentCommit: C40 }).errors[0])
      .toMatch(/HEAD_BINDING_DRIFTED_DURING_CAPTURE/);
  });
  it('clean + 결속 통과면 ok', () => {
    expect(CAP.phaseGateDecision({ stage: 'start', dirtyEntries: [], head: OK_HEAD, canonPaths: CANON }))
      .toEqual({ ok: true, errors: [] });
    expect(CAP.phaseGateDecision({ stage: 'end', dirtyEntries: [], head: OK_HEAD, pinnedBlobs: OK_HEAD.blobs,
      canonPaths: CANON, startCommit: C40, currentCommit: C40 })).toEqual({ ok: true, errors: [] });
  });
  it('malformed 입력도 controlled error', () => {
    expect(CAP.phaseGateDecision({ stage: 'start', dirtyEntries: null, head: OK_HEAD, canonPaths: CANON }).ok).toBe(false);
    expect(CAP.phaseGateDecision({ stage: 'start', dirtyEntries: [], head: null, canonPaths: CANON }).ok).toBe(false);
  });

  it('실제 Git checkout에서 5종이 모두 dirty로 잡힌다', () => {
    const d = mkdtempSync(join(tmpdir(), 's4gate-'));
    writeFileSync(join(d, 'a.txt'), 'x'); mkdirSync(join(d, 'sub'));
    writeFileSync(join(d, 'sub', 'b.txt'), 'y');
    execSync(`git -C ${d} init -q && git -C ${d} add -A && git -C ${d} -c user.email=t@t -c user.name=t commit -q -m i`, { stdio: 'ignore' });
    const dirty = () => CAP.worktreeDirtyEntries(d);
    expect(dirty()).toEqual([]);
    writeFileSync(join(d, 'a.txt'), 'changed');
    expect(dirty().join(' ')).toMatch(/ M a\.txt/);
    execSync(`git -C ${d} add a.txt`, { stdio: 'ignore' });
    expect(dirty().join(' ')).toMatch(/M {2}a\.txt/);
    execSync(`git -C ${d} checkout -q -- . && git -C ${d} reset -q`, { stdio: 'ignore' });
    writeFileSync(join(d, 'new.txt'), 'n');
    expect(dirty().join(' ')).toMatch(/\?\? new\.txt/);
    rmSync(join(d, 'new.txt'));
    execSync(`git -C ${d} mv sub/b.txt sub/c.txt`, { stdio: 'ignore' });
    expect(dirty().join(' ')).toMatch(/R {2}sub\/b\.txt -> sub\/c\.txt/);
    rmSync(d, { recursive: true, force: true });
  });

  it('production sink는 export되지 않는다 — main만 부른다', () => {
    expect(CAP.runPhaseCapture).toBeUndefined();
    const src = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    expect(src).toContain('async function runPhaseCaptureImpl(');
    expect(src).not.toContain('export async function runPhaseCaptureImpl');
    expect((src.match(/runPhaseCaptureImpl\(/g) || [])).toHaveLength(2);   // 정의 1 + main 호출 1
    // exec 주입 지점이 없다.
    const fn = src.slice(src.indexOf('async function runPhaseCaptureImpl'));
    expect(fn.slice(0, fn.indexOf('{'))).not.toContain('exec');
  });
});

// ── phase 시작 authority: 단일 관측 ────────────────────────────────────────
describe('S4 phase 시작 authority — worktree를 한 번만 읽는다', () => {
  it('dirty면 headBlobBinding을 부르지 않는다 (소스 구조 + 결정 함수)', () => {
    const src = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('async function runPhaseCaptureImpl'));
    const body = fn.slice(0, fn.indexOf('\nif (process.argv'));
    const start = body.slice(0, body.indexOf('capturePhaseCore('));
    // 시작 구간에서 worktreeDirtyEntries는 정확히 1회, dirty면 return이 먼저다.
    expect((start.match(/worktreeDirtyEntries\(/g) || [])).toHaveLength(1);
    expect(start.indexOf('return 1;')).toBeLessThan(start.indexOf('headBlobBinding('));
  });

  it('RED: head={errors:[],blobs:null,headCommit:null}은 통과하지 못한다', () => {
    const r = CAP.phaseGateDecision({ stage: 'start', dirtyEntries: [],
      head: { errors: [], blobs: null, headCommit: null }, canonPaths: CAP.HASHED_MODULES });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/GATE_HEAD_COMMIT_INVALID/);
  });

  it('RED: head 형태·commit·blobs 집합·OID를 fail-closed로 본다', () => {
    const P = CAP.HASHED_MODULES;
    const ok = { errors: [], headCommit: 'c'.repeat(40),
      blobs: Object.fromEntries(P.map((p, i) => [p, String(i).padStart(40, 'a')])) };
    const bad = [
      [{ head: null }, /GATE_HEAD_SHAPE/],
      [{ head: { errors: 'x' } }, /GATE_HEAD_SHAPE/],
      [{ head: { ...ok, headCommit: 'short' } }, /GATE_HEAD_COMMIT_INVALID/],
      [{ head: { ...ok, blobs: null } }, /GATE_HEAD_BLOBS_SHAPE/],
      [{ head: { ...ok, blobs: [] } }, /GATE_HEAD_BLOBS_SHAPE/],
      [{ head: { ...ok, blobs: { x: 'a'.repeat(40) } } }, /GATE_HEAD_BLOB_PATHS/],
      [{ head: { ...ok, blobs: Object.fromEntries(P.map((p) => [p, 'nothex'])) } }, /GATE_HEAD_BLOB_OID/],
      [{ canonPaths: [] }, /GATE_CANON_PATHS_MISSING/],
      [{ stage: 'begin' }, /GATE_STAGE_INVALID/],
      [{ dirtyEntries: null }, /GATE_DIRTY_SHAPE/],
    ];
    for (const [over, rx] of bad) {
      const r = CAP.phaseGateDecision({ stage: 'start', dirtyEntries: [], head: ok, canonPaths: P, ...over });
      expect(r.ok, JSON.stringify(Object.keys(over))).toBe(false);
      expect(r.errors.join(' '), JSON.stringify(Object.keys(over))).toMatch(rx);
    }
    expect(CAP.phaseGateDecision({ stage: 'start', dirtyEntries: [], head: ok, canonPaths: P }))
      .toEqual({ ok: true, errors: [] });
  });
});

// ── 캡처 중 HEAD 이동 ───────────────────────────────────────────────────────
describe('S4 HEAD 이동 — pinned blob만으로는 못 잡는다', () => {
  const P = () => CAP.HASHED_MODULES;
  const okHead = () => ({ errors: [], headCommit: 'a'.repeat(40),
    blobs: Object.fromEntries(P().map((p, i) => [p, String(i).padStart(40, 'b')])) });

  it('RED: 인프라 blob이 동일해도 HEAD가 움직였으면 차단', () => {
    const r = CAP.phaseGateDecision({ stage: 'end', dirtyEntries: [], head: okHead(),
      canonPaths: P(), pinnedBlobs: okHead().blobs,
      startCommit: 'a'.repeat(40), currentCommit: 'f'.repeat(40) });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/HEAD_MOVED_DURING_CAPTURE/);
  });
  it('GREEN 대조군: HEAD 동일이면 통과', () => {
    expect(CAP.phaseGateDecision({ stage: 'end', dirtyEntries: [], head: okHead(),
      canonPaths: P(), pinnedBlobs: okHead().blobs,
      startCommit: 'a'.repeat(40), currentCommit: 'a'.repeat(40) })).toEqual({ ok: true, errors: [] });
  });
  it('currentCommit 누락/형식 오류는 fail-closed', () => {
    for (const cc of [undefined, null, 'short', 123]) {
      const r = CAP.phaseGateDecision({ stage: 'end', dirtyEntries: [], head: okHead(),
        canonPaths: P(), pinnedBlobs: okHead().blobs, startCommit: 'a'.repeat(40), currentCommit: cc });
      expect(r.ok, String(cc)).toBe(false);
    }
  });

  it('실제 Git repo: 제품 파일만 바뀐 clean commit B로 옮겨도 HEAD_MOVED', () => {
    const d = mkdtempSync(join(tmpdir(), 's4head-'));
    for (const rel of CAP.HASHED_MODULES) {
      mkdirSync(join(d, rel.split('/').slice(0, -1).join('/')), { recursive: true });
      writeFileSync(join(d, rel), `// ${rel}\n`);
    }
    mkdirSync(join(d, 'frontend', 'styles'), { recursive: true });
    writeFileSync(join(d, 'frontend', 'styles', 'x.scss'), '.a{color:red}\n');
    const g = (c) => execSync(`git -C ${d} ${c}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    execSync(`git -C ${d} init -q && git -C ${d} add -A && git -C ${d} -c user.email=t@t -c user.name=t commit -q -m A`, { stdio: 'ignore' });
    const A = g('rev-parse HEAD').trim();
    const exec = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const head0 = PROM.headBlobBinding(d, CAP.HASHED_MODULES);
    expect(head0.errors).toEqual([]);
    // 캡처 중 제품 SCSS만 바꾼 clean commit B
    writeFileSync(join(d, 'frontend', 'styles', 'x.scss'), '.a{color:blue}\n');
    execSync(`git -C ${d} add -A && git -C ${d} -c user.email=t@t -c user.name=t commit -q -m B`, { stdio: 'ignore' });
    const B = g('rev-parse HEAD').trim();
    expect(B).not.toBe(A);
    expect(CAP.worktreeDirtyEntries(d)).toEqual([]);            // clean이다
    const head1 = PROM.headBlobBinding(d, CAP.HASHED_MODULES, A);
    expect(head1.errors).toEqual([]);                                  // 인프라 blob은 동일
    expect(JSON.stringify(head1.blobs)).toBe(JSON.stringify(head0.blobs));
    // pinned blob만 보면 통과한다 — 현재 HEAD를 독립적으로 봐야 잡힌다.
    const r = CAP.phaseGateDecision({ stage: 'end', dirtyEntries: [], head: head1,
      canonPaths: CAP.HASHED_MODULES, pinnedBlobs: head0.blobs, startCommit: A, currentCommit: B });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/HEAD_MOVED_DURING_CAPTURE/);
    // A 유지 대조군
    execSync(`git -C ${d} checkout -q ${A}`, { stdio: 'ignore' });
    expect(CAP.phaseGateDecision({ stage: 'end', dirtyEntries: [], head: head1,
      canonPaths: CAP.HASHED_MODULES, pinnedBlobs: head0.blobs, startCommit: A,
      currentCommit: g('rev-parse HEAD').trim() })).toEqual({ ok: true, errors: [] });
    rmSync(d, { recursive: true, force: true });
  }, 30000);
});

// ── generator authority ─────────────────────────────────────────────────────
describe('S4 generator authority — 자기 자신을 포함한 closure + clean 게이트', () => {
  it('GENERATOR_HASHED_MODULES는 s4-gen 진입점의 정적 closure이고 자신을 포함한다', () => {
    const repo = fileURLToPath(new URL('../..', import.meta.url));
    const cl = PROM.staticImportClosure([CAP.GENERATOR_ENTRY],
      (p) => { try { return readFileSync(join(repo, p), 'utf8'); } catch (e) { return null; } }, 'frontend');
    const got = [...(cl.paths || cl)].sort();
    expect(got).toEqual([...CAP.GENERATOR_HASHED_MODULES].sort());
    expect(CAP.GENERATOR_HASHED_MODULES).toContain(CAP.GENERATOR_ENTRY);
    // discovery provenance와 **다른 목록**이다.
    expect([...CAP.GENERATOR_HASHED_MODULES].sort())
      .not.toEqual([...SPEC.PROVENANCE_BLOB_PATHS].sort());
  });

  it('generator는 시작과 write 직전에 repo clean을 본다', () => {
    const src = readFileSync(new URL('../scripts/s4-gen.mjs', import.meta.url), 'utf8');
    // clean만 보는 게 아니라 **시작 commit에 못박은 authority**를 본다.
    expect(src).toContain("requireStartAuthority('AT_START')");
    expect(src).toContain("requireStartAuthority('BEFORE_WRITE')");
    expect(src).toContain('GENERATOR_HASHED_MODULES');
    expect(src).toContain('const START_COMMIT = START.headCommit');
    // provenance는 시작 commit 기준으로만 만든다.
    expect(src).toContain('headBlobBinding(REPO_DIR, HASHED_MODULES, START_COMMIT)');
    expect(src.indexOf("requireStartAuthority('AT_START')")).toBeLessThan(src.indexOf('PROJ.buildProjection('));
    expect(src.indexOf("requireStartAuthority('BEFORE_WRITE')")).toBeLessThan(src.indexOf('EV.approveAndWrite({'));
    // 옛 clean-only 게이트는 남아 있지 않다.
    expect(src).not.toContain('requireCleanRepo');
    // **sink 직전 게이트**: 실제 write 콜백을 sinkWriter가 감싼다 — mkdir/write보다 앞이다.
    expect(src).toContain('PROMOTE_IO.sinkWriter({');
    const sink = src.slice(src.indexOf('PROMOTE_IO.sinkWriter({'));
    expect(sink.indexOf('startCommit: START_COMMIT')).toBeLessThan(sink.indexOf('mkdirSync(FIXDIR'));
    expect(sink.indexOf('startCommit: START_COMMIT')).toBeLessThan(sink.indexOf('writeFileSync(candidatePath'));
    const sw = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
    const fn2 = sw.slice(sw.indexOf('export function sinkWriter'));
    expect(fn2.indexOf('generatorAuthority(repoDir, startCommit)')).toBeLessThan(fn2.indexOf('write(bytes)'));
  });

  it.each([
    ['dirty s4-gen', [' M frontend/scripts/s4-gen.mjs']],
    ['dirty evidence', [' M frontend/library/__fixtures__/s4-discovery-evidence/runA.out']],
    ['staged 변경', ['M  frontend/library/s4Spec.mjs']],
    ['untracked 변경', ['?? frontend/library/new.mjs']],
  ])('RED: %s → serialize/write 0회 (결정 함수)', (_n, dirty) => {
    // generator의 게이트는 worktreeDirtyEntries 결과가 비어야만 통과한다.
    expect(dirty.length).toBeGreaterThan(0);
    const r = CAP.phaseGateDecision({ stage: 'start', dirtyEntries: dirty,
      head: null, canonPaths: CAP.GENERATOR_HASHED_MODULES });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/WORKTREE_DIRTY/);
  });

  it('evidence 디렉터리 주장 범위 — 바이트 계약이다', () => {
    // "물리적으로 정확히 8개 파일"을 주장하지 않는다. 계약은 **주어진 8개 바이트**다.
    const src = readFileSync(new URL('./s4Evaluator.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function verifyDiscoveryEvidence'));
    expect(fn).toContain('EVIDENCE_ACTUAL_FILE_SET');
    expect(fn).not.toContain('readdirSync');        // 디렉터리를 열지 않는다 = 물리 주장 없음
  });
});

// ── lock ownership ──────────────────────────────────────────────────────────
describe('S4 candidate lock — ownership과 foreign lock', () => {
  const mk = () => mkdtempSync(join(tmpdir(), 's4lk-'));
  const root = (d) => join(d, RUN.CANDIDATE_ROOT);
  const lockOf = (d) => join(root(d), '.lock-light');
  const put = (d, ctx) => RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase: 'light', contextRaw: ctx,
    pngByCaptureName: { 'a.png': Buffer.from('1') }, expectedCaptureNames: ['a.png'] });

  it('RED: root가 outside symlink면 밖에 lock을 만들지 않는다', () => {
    const d = mk(); const outside = mkdtempSync(join(tmpdir(), 's4out-'));
    symlinkSync(outside, root(d));
    const e = put(d, 'A');
    expect(e.join(' ')).toMatch(/WRITE_NODE_SYMLINK|WRITE_NODE_ESCAPES/);
    expect(readdirSync(outside)).toEqual([]);          // 밖에 아무것도 안 생겼다
    rmSync(root(d)); rmSync(d, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true });
  });

  it('RED: foreign lock으로 교체되면 pointer를 쓰지 않고 그 lock을 지우지 않는다', () => {
    const d = mk();
    mkdirSync(root(d), { recursive: true });
    // writeCandidate 내부에서 lock을 잡은 뒤 교체되는 상황을 모사한다:
    // 먼저 정상 기록해 pointer를 만들고, 그 뒤 lock 파일을 다른 inode로 바꾼 상태에서 재기록.
    expect(put(d, 'A')).toEqual([]);
    const before = readFileSync(join(root(d), RUN.CANDIDATE_POINTER('light')), 'utf8');
    // foreign lock 선점 → WRITE_LOCK_BUSY, 그리고 그 lock은 살아남는다.
    writeFileSync(lockOf(d), 'FOREIGN');
    const e = put(d, 'B');
    expect(e.join(' ')).toMatch(/WRITE_LOCK_BUSY/);
    expect(existsSync(lockOf(d))).toBe(true);
    expect(readFileSync(lockOf(d), 'utf8')).toBe('FOREIGN');   // 남의 lock을 지우지 않았다
    expect(readFileSync(join(root(d), RUN.CANDIDATE_POINTER('light')), 'utf8')).toBe(before);
    rmSync(d, { recursive: true, force: true });
  });

  it('ownership 검사와 복구 절차가 코드에 있다', () => {
    const src = readFileSync(new URL('./s4CaptureRunner.mjs', import.meta.url), 'utf8');
    expect(src).toContain('WRITE_LOCK_OWNERSHIP_LOST');
    // lock 구현은 **acquireCandidateLock 하나**다 — 승격도 같은 것을 잡는다.
    expect(src).toContain('export function acquireCandidateLock');
    expect(src).toContain('fstatSync(fd)');
    expect(src).toContain('lockStillOurs()');
    expect(RUN.LOCK_RECOVERY).toEqual(['WRITE_LOCK_BUSY', 'WRITE_LOCK_OWNERSHIP_LOST', 'WRITE_COMMITTED_BUT']);
    // 자동 stale 회수가 없다 — mtime 기반 판단이 없어야 한다.
    const fn = src.slice(src.indexOf('export function writeCandidate'));
    expect(fn.slice(0, fn.indexOf('\nexport function readCandidateBundle'))).not.toContain('mtime');
    // commit 직전에 소유권을 본다.
    const body = fn.slice(0, fn.indexOf('\nexport function readCandidateBundle'));
    expect(body.indexOf('WRITE_LOCK_OWNERSHIP_LOST')).toBeLessThan(body.indexOf('commit point'));
  });

  it('containment 검증이 lock open보다 앞이다', () => {
    const src = readFileSync(new URL('./s4CaptureRunner.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function writeCandidate'));
    const body = fn.slice(0, fn.indexOf('\nexport function readCandidateBundle'));
    expect(body.indexOf('safeNode(fixturesDir, p2, k)')).toBeLessThan(body.indexOf('acquireCandidateLock(fixturesDir, phase)'));
    // lock 구현 자체도 root containment를 먼저 본다.
    const lk = src.slice(src.indexOf('export function acquireCandidateLock'));
    expect(lk.indexOf("safeNode(fixturesDir, root, 'dir')")).toBeLessThan(lk.indexOf("openSync(p, 'wx')"));
  });
});

// ── main → sink 행동 결속 ───────────────────────────────────────────────────
describe('S4 main→sink 호출 결속 — 우회 mutant는 RED', () => {
  // **범위: main이 production sink를 실제로 부르는가**뿐이다.
  // 복사본을 임시 위치에서 돌리므로 import.meta.url 기반 REPO_DIR도 임시 위치를 가리킨다 —
  // 이것은 실제 Weave clean-HEAD phase E2E 증거가 **아니다**. 그 증거는 checkpoint 뒤
  // clean-HEAD canary에서만 나온다.
  // 워킹트리가 더러운 개발 중이므로 code=1이 정상이고,
  // **어느 게이트가 받았는지**로 sink 도달 여부를 판정한다.
  // `if (false) runPhaseCaptureImpl(...)` mutant는 게이트 문구가 사라져 RED가 된다.
  const runMain = async (srcOverride) => {
    const real = fileURLToPath(new URL('../scripts/s4-capture.mjs', import.meta.url));
    const tmp = mkdtempSync(join(tmpdir(), 's4main-'));
    const copy = join(tmp, 's4-capture.mjs');
    let src = readFileSync(real, 'utf8');
    if (srcOverride) src = srcOverride(src);
    // 상대 import를 원본 위치 기준 절대경로로 바꿔 복사본이 그대로 돈다.
    const base = fileURLToPath(new URL('../scripts/', import.meta.url));
    src = src.replace(/from '(\.\.?\/[^']+)'/g, (m, rel) => `from '${pathToFileURL(resolve(base, rel)).href}'`);
    writeFileSync(copy, src);
    const M = await import(pathToFileURL(copy).href);
    const errs = [];
    const code = await M.main(['--phase', 'light'], { log: () => {}, err: (m) => errs.push(m) });
    rmSync(tmp, { recursive: true, force: true });
    return { code, errs: errs.join(' ') };
  };

  it('정상 main은 production 게이트를 통과해 첫 게이트에서 판정한다', async () => {
    const r = await runMain();
    expect(r.code).toBe(1);
    // 개발 중 워킹트리가 더럽다 — production 시작 게이트가 받았다는 증거.
    expect(r.errs).toMatch(/WORKTREE_DIRTY|HEAD_BINDING_FAILED/);
  }, 30000);

  it('RED: `if (false) runPhaseCaptureImpl(...)` mutant는 게이트에 도달하지 못한다', async () => {
    const r = await runMain((src) => src.replace(
      'return runPhaseCaptureImpl({ SPEC, cli, fixturesDir, log, err });',
      'if (false) { return runPhaseCaptureImpl({ SPEC, cli, fixturesDir, log, err }); } return 0;'));
    // 우회하면 게이트 문구가 하나도 안 나오고 code도 0이 된다 — 정상 경로와 명확히 다르다.
    expect(r.errs).not.toMatch(/WORKTREE_DIRTY|HEAD_BINDING_FAILED/);
    expect(r.code).toBe(0);
  }, 30000);

  it('RED: 시작 게이트를 삭제한 mutant는 다른 지점에서 죽는다', async () => {
    const r = await runMain((src) => src.replace(
      "  const dirty0 = worktreeDirtyEntries(repoDir);",
      '  const dirty0 = [];'));
    expect(r.errs).not.toMatch(/WORKTREE_DIRTY/);      // 시작 게이트가 사라졌다
    expect(r.code).toBe(1);                            // 그래도 HEAD 게이트가 받는다
    expect(r.errs).toMatch(/HEAD_BINDING_FAILED/);
  }, 30000);
});

describe('S4 브리지 통합 — 단일 브리지로 반복 attempt를 완주한다', () => {
  // **범위: 브리지 수명주기**다. main()이 아니라 runObservation()을 직접 호출한다.
  // HEAD pre/postflight는 여기서 검증하지 않는다. main()을 호출하는 테스트는
  // 'S4 main→sink 호출 결속' describe에 있지만 그것은 sink 호출 여부만 본다 —
  // 실제 clean-HEAD 카나리가 통합 경로의 증거다.
  // 이전 판은 반복마다 서버를 새로 만들어 두 번째 hello가 무기한 대기했다(실증).
  const PORT = 10197;
  const api = 'http://localhost:10001/api';
  // fake adapter — **커밋된 어댑터와 같은 종료 규약**을 따른다: shutdown 응답을 보낸 뒤
  // 곧바로 break한다. 연결 오류를 삼키지 않고 terminal로 보고해 종료 실패를 드러낸다.
  const fakeAdapter = async ({ requestsPerAttempt, stopAfterAttempt, ackShutdown = true }, port = PORT) => {
    const seen = { attempts: 0, ended: 0, shutdown: false, done: false, terminal: null, methods: [] };
    for (let i = 0; i < 4000; i += 1) {
      let cmd;
      try { cmd = await (await fetch(`http://127.0.0.1:${port}/next`)).json(); }
      catch (e) { seen.terminal = `POLL_FAILED ${String(e.message).slice(0, 40)}`; break; }
      if (cmd.done) { seen.done = true; break; }
      seen.methods.push(cmd.method);
      // shutdown 명령은 받았지만 응답하지 않고 떠난다(어댑터가 죽은 상황).
      if (cmd.method === 'shutdown' && !ackShutdown) { seen.shutdown = true; seen.terminal = 'NO_ACK'; break; }
      let value = null; const error = null;
      const [a] = cmd.args;
      if (cmd.method === 'hello') value = { protocol: 's4-bridge/2', echo: a };
      else if (cmd.method === 'beginAttempt') {
        seen.attempts += 1;
        if (stopAfterAttempt && seen.attempts > stopAfterAttempt) { seen.terminal = 'ADAPTER_LEFT'; break; }
        value = { ok: true, attempt: a };
      } else if (cmd.method === 'endAttempt') { seen.ended += 1; value = { ok: true }; }
      else if (cmd.method === 'shutdown') { seen.shutdown = true; value = { ok: true }; }
      else if (cmd.method === 'addInitScript') value = { ok: true, version: PROBE.NETWORK_HOOK_VERSION };
      else if (cmd.method === 'evaluate') {
        if (a === PROBE.NETWORK_IDLE_SOURCE) value = { installed: true, stale: false, idle: true, pending: 0 };
        else if (a === PROBE.NETWORK_DRAIN_SOURCE) value = { ok: true, installedAtReadyState: 'loading',
          entries: requestsPerAttempt(seen.attempts) };
        else if (a === PROBE.ASSERT_SOURCE) value = Object.fromEntries((cmd.args[1] || []).map((s2) => [s2, { count: 1, visible: 1 }]));
        else value = {};
      }
      try {
        await fetch(`http://127.0.0.1:${port}/`, { method: 'POST',
          body: JSON.stringify({ id: cmd.id, value, error }), headers: { 'content-type': 'application/json' } });
      } catch (e) { seen.terminal = `POST_FAILED ${String(e.message).slice(0, 40)}`; break; }
      // 커밋된 어댑터와 동일: shutdown 응답 직후 clean break.
      if (cmd.method === 'shutdown') { seen.clean = true; break; }
    }
    return seen;
  };
  // HEAD 게이트는 main에 남아 있다(워킹트리 clean일 때만 통과). 여기서는 게이트를 통과한
  // 뒤의 **브리지 수명주기**만 본다 — 게이트에 테스트용 우회를 만들지 않기 위한 분리다.
  const HEAD = { headCommit: 'x'.repeat(40), blobs: {} };
  const runObs = async (argv, adapterOpts, port) => {
    const out = []; const errs = [];
    const cli = CAP.parseCaptureArgs(argv, SPEC);
    expect(cli.error).toBeUndefined();
    const p = CAP.runObservation({ SPEC, cli, head: HEAD, log: (m) => out.push(m), err: (m) => errs.push(m) });
    await new Promise((r) => setTimeout(r, 250));
    const seen = await fakeAdapter(adapterOpts, port);
    const r = await p;
    return { code: r.code, payload: r.payload, out, errs, seen };
  };
  const GOOD = () => [{ method: 'GET', url: `${api}/tracks/5`, status: 200, ok: true }];

  it('attempt 2회를 한 브리지로 완주하고 shutdown까지 간다', async () => {
    const r = await runObs(['--canary', 'canvas', '--repeat', '2', '--port', String(PORT)],
      { requestsPerAttempt: GOOD }, PORT);
    expect(r.code).toBe(0);
    expect(r.seen.attempts).toBe(2);
    expect(r.seen.ended).toBe(2);
    expect(r.seen.shutdown).toBe(true);
    // 종료 실패를 삼키지 않는다 — 이전 판은 마지막 GET 오류를 catch해 false-green이었다.
    expect(r.seen.terminal).toBeNull();
    expect(r.seen.clean).toBe(true);
    const parsed = r.payload;
    expect(parsed.mode).toBe('canary');
    expect(parsed.eligibleForManifest).toBe(false);
    expect(parsed.repeats).toBe(2);
    expect(parsed.bySurface.canvas).toBeDefined();                 // surface 귀속 보존
    expect(parsed.endpoints[0]).toContain(`${api}/tracks/5`);
  }, 30000);

  it('RED: 두 실행 모두 요청 0건이면 GREEN이 아니다', async () => {
    const r = await runObs(['--canary', 'canvas', '--repeat', '2', '--port', String(PORT + 1)],
      { requestsPerAttempt: () => [] }, PORT + 1);
    expect(r.code).toBe(1);
    expect(r.errs.join(' ')).toMatch(/OBSERVE_NO_EVIDENCE[\s\S]*NO_REQUESTS_OBSERVED/);
  }, 30000);

  it('RED: backend API origin 성공 응답이 없으면 거부', async () => {
    const r = await runObs(['--canary', 'canvas', '--repeat', '2', '--port', String(PORT + 2)],
      { requestsPerAttempt: () => [{ method: 'GET', url: 'http://localhost:10000/_next/x.js', status: 200, ok: true }] }, PORT + 2);
    expect(r.code).toBe(1);
    expect(r.errs.join(' ')).toMatch(/NO_API_REQUESTS/);
  }, 30000);

  it('RED: 두 실행의 endpoint 집합이 다르면 drift로 거부', async () => {
    const r = await runObs(['--canary', 'canvas', '--repeat', '2', '--port', String(PORT + 3)],
      // 두 실행 모두 필수 route-load는 포함하고, **추가 요청만** 다르게 한다.
      { requestsPerAttempt: (n) => [
        { method: 'GET', url: `${api}/tracks/5`, status: 200, ok: true },
        { method: 'GET', url: `${api}/extra/${n}`, status: 200, ok: true },
      ] }, PORT + 3);
    expect(r.code).toBe(1);
    expect(r.errs.join(' ')).toMatch(/ENDPOINT_DRIFT_BETWEEN_RUNS run1 vs run2/);
  }, 30000);

  it('RED: 어댑터가 두 번째 attempt에서 사라지면 timeout으로 끝난다(무기한 대기 없음)', async () => {
    const r = await runObs(['--canary', 'canvas', '--repeat', '2', '--port', String(PORT + 4), '--timeoutMs', '1500'],
      { requestsPerAttempt: GOOD, stopAfterAttempt: 1 }, PORT + 4);
    expect(r.code).toBe(1);
    expect(r.errs.join(' ')).toMatch(/BRIDGE_RPC_TIMEOUT/);
  }, 30000);

  it('RED: drift가 shutdown 오류에 덮이지 않는다', async () => {
    // drift 판정이 shutdown finally **뒤에** 있으면, shutdown 무응답이 먼저 fatal을 세워
    // ENDPOINT_DRIFT_BETWEEN_RUNS가 통째로 사라진다(실증). drift가 primary failure다.
    const port = PORT + 7;
    const r = await runObs(['--canary', 'canvas', '--repeat', '2', '--port', String(port)], {
      requestsPerAttempt: (n) => (n === 1 ? GOOD()
        : [...GOOD(), { method: 'GET', url: `${api}/labels`, status: 200, ok: true }]),
      ackShutdown: false,
    }, port);
    expect(r.code).toBe(1);
    expect(r.errs.join(' ')).toMatch(/ENDPOINT_DRIFT_BETWEEN_RUNS run1 vs run2/);
    // 이미 실패 중인 경로에서 shutdown은 best-effort다 — 원래 오류를 덮어선 안 된다.
    expect(r.errs.join(' ')).not.toMatch(/BRIDGE_SHUTDOWN_UNACKED/);
    expect(r.seen.shutdown).toBe(true);
  }, 30000);

  it('RED: shutdown ACK가 없으면 성공하지 않는다', async () => {
    const port = PORT + 6;
    const errs = [];
    const cli = CAP.parseCaptureArgs(['--canary', 'canvas', '--repeat', '2', '--port', String(port), '--timeoutMs', '1200'], SPEC);
    const p = CAP.runObservation({ SPEC, cli, head: HEAD, log: () => {}, err: (m) => errs.push(m) });
    await new Promise((r) => setTimeout(r, 250));
    for (let i = 0; i < 500; i += 1) {
      let cmd;
      try { cmd = await (await fetch(`http://127.0.0.1:${port}/next`)).json(); } catch (e) { break; }
      if (cmd.done) break;
      if (cmd.method === 'shutdown') break;                       // 명령은 받되 응답하지 않는다
      let value = null; const [a] = cmd.args;
      if (cmd.method === 'hello') value = { protocol: 's4-bridge/2', echo: a };
      else if (/Attempt/.test(cmd.method)) value = { ok: true };
      else if (cmd.method === 'addInitScript') value = { ok: true, version: PROBE.NETWORK_HOOK_VERSION };
      else if (cmd.method === 'evaluate') {
        if (a === PROBE.NETWORK_IDLE_SOURCE) value = { installed: true, stale: false, idle: true, pending: 0 };
        else if (a === PROBE.NETWORK_DRAIN_SOURCE) value = { ok: true, installedAtReadyState: 'loading', entries: GOOD() };
        else if (a === PROBE.ASSERT_SOURCE) value = Object.fromEntries((cmd.args[1] || []).map((s2) => [s2, { count: 1, visible: 1 }]));
        else value = {};
      }
      try {
        await fetch(`http://127.0.0.1:${port}/`, { method: 'POST',
          body: JSON.stringify({ id: cmd.id, value }), headers: { 'content-type': 'application/json' } });
      } catch (e) { break; }
    }
    const r = await p;
    expect(r.code).toBe(1);
    expect(errs.join(' ')).toMatch(/BRIDGE_SHUTDOWN_UNACKED/);
  }, 30000);

  it('RED: protocol이 다른 어댑터는 거부된다', async () => {
    const port = PORT + 5;
    const out = []; const errs = [];
    const cli = CAP.parseCaptureArgs(['--canary', 'canvas', '--repeat', '2', '--port', String(port)], SPEC);
    const mainP = CAP.runObservation({ SPEC, cli, head: HEAD, log: (m) => out.push(m), err: (m) => errs.push(m) });
    await new Promise((r) => setTimeout(r, 250));
    const cmd = await (await fetch(`http://127.0.0.1:${port}/next`)).json();
    await fetch(`http://127.0.0.1:${port}/`, { method: 'POST',
      body: JSON.stringify({ id: cmd.id, value: { protocol: 's4-bridge/0' } }),
      headers: { 'content-type': 'application/json' } });
    expect((await mainP).code).toBe(1);
    expect(errs.join(' ')).toMatch(/BRIDGE_PROTOCOL_MISMATCH/);
  }, 30000);
});

describe('S4 관찰 계약 — canary·hook 버전·격리·재현성', () => {
  const capSrc = () => readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
  const adapterSrc = () => readFileSync(new URL('../scripts/s4-adapter.playwright.js', import.meta.url), 'utf8');

  it('strict CLI: 모드는 정확히 하나, canary는 2회 이상', () => {
    const t = (a) => CAP.parseCaptureArgs(a, SPEC);
    expect(t(['--canary', 'canvas', '--repeat', '2'])).toMatchObject({ canary: 'canvas', repeat: 2 });
    expect(t(['--canary', 'canvas']).error).toMatch(/REPEAT_RANGE/);       // 1회는 재현성 증거가 아니다
    expect(t(['--canary', 'canvas', '--repeat', '9']).error).toMatch(/REPEAT_RANGE/);
    expect(t(['--canary', 'nope', '--repeat', '2']).error).toMatch(/UNKNOWN_SURFACE nope/);
    expect(t(['--discover', '--canary', 'canvas']).error).toMatch(/EXACTLY_ONE_MODE/);
    expect(t([]).error).toMatch(/EXACTLY_ONE_MODE/);
    expect(t(['--phase', 'light', '--repeat', '2']).error).toMatch(/REPEAT_ONLY_WITH_CANARY/);
    expect(t(['--surface', 'canvas']).error).toMatch(/UNKNOWN_ARG/);
    expect(t(['--canary']).error).toMatch(/MISSING_VALUE/);
  });
  it('canary 결과는 manifest 근거로 쓸 수 없다고 출력에 박힌다', () => {
    expect(capSrc()).toContain('eligibleForManifest: !cli.canary');
  });
  it('hook은 버전을 확인한다 — 구버전 재사용을 최신인 양 쓰지 않는다', () => {
    const install = new Function(`return (${PROBE.NETWORK_INSTALL_SOURCE})`)();
    const g = globalThis;
    const saved = g.window;
    try {
      // 구버전 hook이 남아 있는 문서
      g.window = { __s4net: { version: 1 } };
      expect(install()).toMatchObject({ ok: false, reason: 'STALE_HOOK', version: 1, want: PROBE.NETWORK_HOOK_VERSION });
      // 같은 버전이면 재사용을 알린다
      g.window = { __s4net: { version: PROBE.NETWORK_HOOK_VERSION, documentId: 'd', installedAtReadyState: 'loading' } };
      expect(install()).toMatchObject({ ok: true, reused: true, documentId: 'd' });
    } finally { if (saved === undefined) delete g.window; else g.window = saved; }
  });
  it('drain/idle도 버전이 다르면 거부한다', () => {
    const drain = new Function(`return (${PROBE.NETWORK_DRAIN_SOURCE})`)();
    const idle = new Function(`return (${PROBE.NETWORK_IDLE_SOURCE})`)();
    const g = globalThis; const saved = g.window;
    try {
      g.window = {};
      expect(drain()).toMatchObject({ ok: false, reason: 'NOT_INSTALLED' });
      g.window = { __s4net: { version: 1, entries: [{ a: 1 }] } };
      expect(drain()).toMatchObject({ ok: false, reason: 'STALE_HOOK' });
      expect(g.window.__s4net.entries).toHaveLength(1);                    // 거부 시 비우지 않는다
      expect(idle(0)).toMatchObject({ stale: true, idle: false });
    } finally { if (saved === undefined) delete g.window; else g.window = saved; }
  });
  it('navigation-time 증거: 새 문서에서 loading 상태로 심겼는지 본다', () => {
    expect(capSrc()).toContain("drained.installedAtReadyState !== 'loading'");
    expect(capSrc()).toContain('HOOK_INSTALLED_TOO_LATE');
  });
  it('ACK는 실제 적용 결과다 — 예외를 삼키고 true를 주지 않는다', () => {
    expect(capSrc()).toContain('ack.version !== NETWORK_HOOK_VERSION');
    expect(adapterSrc()).toContain('value = await p.evaluate(new Function(`return (${a})`)());');
  });
  // 필수 route-load는 **{surface, method, url} triple**로 결속된다. 전역 method+URL 집합이면
  // 한 화면의 GET이 다른 화면 몫까지 충족한다(실증: canvas의 /tracks/5가 detail을 대신했다).
  // 표는 결속의 **세 축을 각각** 흔든다 — 축 하나라도 무시하는 구현은 여기서 죽는다.
  const RL_API = 'http://localhost:10001/api';
  const RL_SCEN = { trackId: 5, apiOrigin: RL_API };
  const RL_HIT = (surface, method, url, ok = true) => ({ surface, method, url, status: ok ? 200 : 500, ok });
  const RL_TRACK = `${RL_API}/tracks/5`;
  const RL_TABLE = [
    ['canvas 요청이 detail을 대체하지 못한다',
      [RL_HIT('canvas', 'GET', RL_TRACK), RL_HIT('detail', 'GET', `${RL_API}/auth/me`)],
      [`MISSING_ROUTE_LOAD detail GET ${RL_TRACK}`]],
    ['detail 요청이 canvas를 대체하지 못한다',
      [RL_HIT('detail', 'GET', RL_TRACK), RL_HIT('canvas', 'GET', `${RL_API}/auth/me`)],
      [`MISSING_ROUTE_LOAD canvas GET ${RL_TRACK}`]],
    ['같은 surface·URL이라도 POST는 GET을 충족하지 못한다',
      [RL_HIT('canvas', 'POST', RL_TRACK), RL_HIT('detail', 'GET', RL_TRACK)],
      [`MISSING_ROUTE_LOAD canvas GET ${RL_TRACK}`]],
    ['같은 surface·GET이라도 다른 URL은 충족하지 못한다',
      [RL_HIT('canvas', 'GET', `${RL_API}/tracks/6`), RL_HIT('detail', 'GET', RL_TRACK)],
      [`MISSING_ROUTE_LOAD canvas GET ${RL_TRACK}`]],
    ['실패한 요청(ok:false)은 충족하지 못한다',
      [RL_HIT('canvas', 'GET', RL_TRACK, false), RL_HIT('detail', 'GET', RL_TRACK)],
      [`MISSING_ROUTE_LOAD canvas GET ${RL_TRACK}`]],
    ['양쪽이 각자 정상 GET을 내면 통과한다',
      [RL_HIT('canvas', 'GET', RL_TRACK), RL_HIT('detail', 'GET', RL_TRACK)],
      []],
  ];
  const RL_REQ = () => ['canvas', 'detail']
    .map((n) => CAP.requiredRouteLoad(SPEC.REQUIRED_SMOKE_SURFACES.find((x) => x.name === n), RL_SCEN));

  it('requiredRouteLoad는 surface에 결속된 triple을 낸다', () => {
    expect(RL_REQ()).toEqual([
      { surface: 'canvas', method: 'GET', url: RL_TRACK },
      { surface: 'detail', method: 'GET', url: RL_TRACK },
    ]);
    // goto가 /tracks/{id}가 아닌 화면은 의무가 없다 — null이어야 한다.
    const noGoto = { name: 'x', actions: [{ op: 'reload' }] };
    expect(CAP.requiredRouteLoad(noGoto, RL_SCEN)).toBe(null);
  });

  it.each(RL_TABLE)('필수 route-load 결속: %s', (_name, observed, expected) => {
    // exact 배열이다 — 부분 정규식은 다른 오류가 섞여 들어와도 통과한다.
    expect(CAP.liveEvidenceErrors(observed, RL_API, ['canvas', 'detail'], RL_REQ())).toEqual(expected);
  });

  it('표는 triple의 세 축을 실제로 죽인다(mutation 검증)', () => {
    // 표가 통과만 시켜서는 계약이 잠기지 않는다. 축을 하나씩 무시하는 구현을 실제로 만들어
    // 표가 그것들을 **죽이는지** 확인한다. 죽이지 못하면 표가 약해진 것이다.
    const withSeen = (keys) => (observed, required) => {
      const seen = new Set(observed.filter((e) => e.ok).flatMap(keys));
      return required.filter(Boolean)
        .map((r) => `${r.surface} ${r.method} ${r.url}`)
        .filter((k) => !seen.has(k))
        .map((k) => `MISSING_ROUTE_LOAD ${k}`);
    };
    const MUTANTS = {
      // surface 축 무시: 어느 화면이 냈든 같은 method+URL이면 충족으로 본다(수정 전 동작).
      SURFACE_IGNORED: withSeen((e) => ['canvas', 'detail'].map((s2) => `${s2} ${e.method} ${e.url}`)),
      // method 축 무시: POST도 GET으로 친다.
      METHOD_IGNORED: withSeen((e) => [`${e.surface} GET ${e.url}`]),
      // url 축 무시: 같은 surface면 어떤 URL이든 충족으로 본다.
      URL_IGNORED: withSeen((e) => [`${e.surface} ${e.method} ${RL_TRACK}`]),
      // ok 축 무시: 실패한 요청도 충족으로 본다.
      OK_IGNORED: (observed, required) => withSeen((e) => [`${e.surface} ${e.method} ${e.url}`])(
        observed.map((e) => ({ ...e, ok: true })), required),
    };
    for (const [name, mutant] of Object.entries(MUTANTS)) {
      const killedBy = RL_TABLE.filter(([, observed, expected]) =>
        JSON.stringify(mutant(observed, RL_REQ())) !== JSON.stringify(expected)).map(([n]) => n);
      expect(killedBy.length, `${name}: 표가 죽이지 못한다`).toBeGreaterThan(0);
    }
    // 정상 구현은 표 전체를 통과한다 — 표가 무조건 RED를 내는 게 아님을 같이 고정한다.
    for (const [, observed, expected] of RL_TABLE)
      expect(CAP.liveEvidenceErrors(observed, RL_API, ['canvas', 'detail'], RL_REQ())).toEqual(expected);
  });
  it('반복 실행은 exact 일치해야 한다', () => {
    expect(capSrc()).toContain('ENDPOINT_DRIFT_BETWEEN_RUNS');
    const E = (over) => [{ surface: 'canvas', method: 'GET', url: '/a', status: 200, ok: true, ...over }];
    const a = CAP.canonicalEndpoints(E());
    expect(a.digest).toBe(CAP.canonicalEndpoints(E()).digest);
    expect(a.set[0]).toBe('canvas GET /a 200 ok x1');
    // surface·method·status·ok·횟수가 전부 남는다 — 하나라도 빠지면 교환·중복이 숨는다
    expect(CAP.canonicalEndpoints(E({ surface: 'detail' })).digest).not.toBe(a.digest);
    expect(CAP.canonicalEndpoints(E({ method: 'PATCH' })).digest).not.toBe(a.digest);
    expect(CAP.canonicalEndpoints(E({ status: 304, ok: false })).digest).not.toBe(a.digest);
    expect(CAP.canonicalEndpoints([...E(), ...E()]).digest).not.toBe(a.digest);   // 횟수
  });
  it('ok 기준이 fetch/XHR 동일하다(200-299)', () => {
    const src = PROBE.NETWORK_INSTALL_SOURCE;
    expect(src).toContain('function isOk(status) { return status >= 200 && status < 300; }');
    // 이전 판: fetch는 r.ok(200-299), XHR은 <400 — 같은 3xx가 채널에 따라 다르게 기록됐다.
    expect(src).not.toContain('record(method, url, r.status, r.ok)');
    expect(src).not.toContain('xhr.status < 400');
  });
  it('어댑터는 shutdown 응답 직후 clean break한다', () => {
    // 응답 후 다시 /next를 폴링하면 CLI가 이미 닫은 서버에 붙어 fetch failed로 죽는다(실증).
    const src = adapterSrc();
    expect(src).toContain("if (cmd.method === 'shutdown') { log.push('clean-exit'); break; }");
  });
  it('어댑터는 일회용 context에서 돌고 반드시 닫는다', () => {
    const src = adapterSrc();
    expect(src).toContain('browser.newContext({ storageState: childState })');
    expect(src).toContain('await ctx.close();');
    expect(src).toContain('WRONG_ORIGIN_FOR_STORAGE');          // 잘못된 origin 기록 방지
    expect(src).toContain('NO_BROWSER');                        // persistent context는 fail-closed
    // 전달받은 page를 직접 몰지 않는다
    for (const banned of ['page.setViewportSize', 'page.goto(', 'page.addInitScript'])
      expect(src).not.toContain(banned);
  });
  it('브리지 handshake로 붙은 어댑터를 확인한다', () => {
    expect(CAP.BRIDGE_PROTOCOL).toBe('s4-bridge/2');
    expect(CAP.BRIDGE_METHODS[0]).toBe('hello');
    expect(capSrc()).toContain('BRIDGE_PROTOCOL_MISMATCH');
    expect(adapterSrc()).toContain(`const PROTOCOL = '${CAP.BRIDGE_PROTOCOL}';`);
  });
  it('동적 로컬 import()는 금지 — closure가 놓치기 때문이다', () => {
    // staticImportClosure는 정적 그래프만 따라간다. 동적 로컬 import()가 생기면 그 모듈은
    // 결속 목록에서 조용히 빠진다 — 지금 없다는 사실을 상설로 고정한다.
    const repo = fileURLToPath(new URL('../../', import.meta.url));
    for (const rel of CAP.DISCOVERY_HASHED_MODULES) {
      if (rel.endsWith('.playwright.js')) continue;              // 어댑터는 브라우저 프로세스용
      const src = readFileSync(join(repo, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
      const dyn = [...src.matchAll(/\bimport\s*\(\s*['"`](\.[^'"`]+)['"`]/g)].map((m) => m[1]);
      expect({ rel, dyn }).toEqual({ rel, dyn: [] });
    }
  });
  it('handshake는 protocol 호환성만 증명한다(어댑터 identity가 아니다)', () => {
    // 브라우저 프로세스는 레포 파일을 해시할 수 없다 — identity는 HEAD blob 결속이 맡는다.
    const capSrc = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
    expect(capSrc).toContain('handshake는 **protocol 호환성만** 증명한다');
    expect(CAP.DISCOVERY_HASHED_MODULES).toContain('frontend/scripts/s4-adapter.playwright.js');
  });
  it('HEAD 목록은 정적 import closure와 exact 일치한다', () => {
    const repo = fileURLToPath(new URL('../../', import.meta.url));
    const read = (rel) => readFileSync(join(repo, rel), 'utf8');
    const closure = PROM.staticImportClosure([CAP.DISCOVERY_ENTRY], read);
    // 어댑터는 import되지 않으므로(브라우저 프로세스) 명시적으로 더한다.
    expect([...CAP.DISCOVERY_HASHED_MODULES].sort())
      .toEqual([...closure, 'frontend/scripts/s4-adapter.playwright.js'].sort());
    // 실증된 누락이 다시 들어오면 여기서 잡힌다
    expect(closure).toContain('frontend/library/cssColorLiterals.mjs');
  });
});

describe('S4 discovery-only — 관찰 전용 계약', () => {
  const capSrc = readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8');
  it('HEAD 결속이 캡처와 분리돼 있다(승격 CLI를 요구하지 않는다)', () => {
    expect(CAP.HASHED_MODULES).toEqual([...CAP.DISCOVERY_HASHED_MODULES,
      'frontend/library/s4Projection.mjs', 'frontend/scripts/s4-audit-candidate.mjs',
      'frontend/scripts/s4-promote-capture.mjs']);
    for (const rel of CAP.HASHED_MODULES)
      expect(existsSync(new URL(`../../${rel}`, import.meta.url))).toBe(true);
  });
  it('액션 의미론을 따로 구현하지 않는다 — 공용 executeSurfaceSteps를 쓴다', () => {
    expect(capSrc).toContain('executeSurfaceSteps({ surface, rawContext: CAPTURE_SCENARIO');
    for (const banned of ["step.op === 'setStorage'", "step.op === 'goto'", "step.op === 'click'"])
      expect(capSrc).not.toContain(banned);
  });
  it('오류를 삼키지 않는다 — 도달 못한 surface가 있으면 목록을 내지 않는다', () => {
    expect(capSrc).toContain('OBSERVE_INCOMPLETE');
    expect(capSrc).not.toContain('discovery는 실패해도 관찰을 계속한다');
  });
  it('종료 시점 HEAD 재검증과 provenance 출력이 있다', () => {
    expect(capSrc).toContain('HEAD_BINDING_DRIFTED_DURING_OBSERVE');
    for (const k of ['provenance:', 'surfacesCompleted:', 'endpoints:', 'hookVersion:', 'bridgeProtocol:'])
      expect(capSrc).toContain(k);
  });
  it('discovery는 산출물을 쓰지 않는다', () => {
    const code = capSrc.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
    for (const banned of ['node:fs', 'writeFileSync', 'mkdirSync']) expect(code).not.toContain(banned);
  });
  it('공용 실행기는 캡처와 같은 postcondition을 판정한다', async () => {
    const surface = { name: 'd1', captureName: 'd1.png', requiredElements: [], darkReviewSelectors: [],
      coverageSelectors: [], actions: [{ op: 'goto', url: '/x' }, { op: 'expectPresent', selector: '.Never' }] };
    const driver = {
      async setViewport() {}, async setStorage() {}, async goto() {}, async settle() {},
      async click() {}, async hover() {}, async sleep() {}, async reload() {}, async addInitScript() {},
      async evaluate(src, arg) {
        if (src === PROBE.ASSERT_SOURCE) return Object.fromEntries(arg.map((s2) => [s2, { count: 0, visible: 0 }]));
        return {};
      },
    };
    const r = await RUN.executeSurfaceSteps({ surface, rawContext: {}, driver, raster: null });
    expect(r.errors.join()).toMatch(/RUN_POSTCONDITION_FAILED d1\[1\] expectPresent \.Never/);
  });

  // 늦게 나타나는 상태를 모사하는 driver — settle이 불린 selector만 보이게 된다.
  const lateDriver = (opts = {}) => {
    const settled = new Set();
    return { settled,
      async setViewport() {}, async setStorage() {}, async goto() {}, async click() {}, async hover() {},
      async sleep() {}, async reload() {}, async addInitScript() {},
      async settle(sel) { if (opts.neverAppears) throw new Error('TIMEOUT'); settled.add(sel); },
      async evaluate(src, arg) {
        if (src === PROBE.ASSERT_SOURCE) return Object.fromEntries(arg.map((s2) =>
          [s2, settled.has(s2) ? { count: 1, visible: 1 } : { count: 0, visible: 0 }]));
        return {};
      } };
  };
  const LATE_SURFACE = {
    name: 'd2', captureName: 'd2.png', requiredElements: [], darkReviewSelectors: [],
    coverageSelectors: [{ selector: '.Late', state: 'selected', provenBy: 0 }],
    actions: [{ op: 'goto', url: '/x' }],
  };

  it('RED: postAssert는 action 직후가 아니라 상태가 나타난 뒤에 판정한다', async () => {
    // 실측 근거: goto가 domcontentloaded로 반환한 시점에는 헤더가 통째로 없고(버튼 0개),
    // ~100ms 뒤에 붙는다. 즉시 1회 판정이면 이 surface는 재현 불가능한 코인플립이 된다.
    const driver = lateDriver();
    const r = await RUN.executeSurfaceSteps({ surface: LATE_SURFACE, rawContext: {}, driver, raster: null });
    expect(r.errors).toEqual([]);
    expect(driver.settled.has('.Late')).toBe(true);
  });

  it('settle을 넣어도 끝내 안 나타나는 상태는 그대로 RED다', async () => {
    // settle은 힌트일 뿐 판정이 아니다 — 이게 깨지면 대기가 오류를 덮는 장치가 된다.
    const driver = lateDriver({ neverAppears: true });
    const r = await RUN.executeSurfaceSteps({ surface: LATE_SURFACE, rawContext: {}, driver, raster: null });
    expect(r.errors.join()).toMatch(/RUN_STATE_UNPROVEN d2\[0\] state:selected \.Late count=0 visible=0/);
  });
});

describe('S4 캡처 증거 계약 — 기록만으로는 통과하지 못한다', () => {
  const SURF = { name: 's1', captureName: 's1.png', actions: [], requiredElements: ['.Req'],
    coverageSelectors: [{ selector: '.Cov' }, { selector: '.Track::before', locator: { selector: '.Track', pseudo: '::before' } }],
    darkReviewSelectors: ['.Dark1'] };
  const SPEC_E = DS_SPEC({ REQUIRED_SMOKE_SURFACES: [SURF] });
  const lightCtx = () => DS_CTX({ phase: 'light',
    coverageEvidence: { s1: { '.Cov': { count: 1, visible: 1 }, '.Track::before': { count: 1, present: 1 }, '.Req': { count: 2, visible: 2 } } },
    provenance: { headCommit: 'abc', blobs: { 'x.mjs': 'b1' }, specFingerprint: 'fp' } });
  const REFS_E = { headCommit: 'abc', headBlobs: { 'x.mjs': 'b1' }, specFingerprintNow: 'fp' };
  const bad = (mut) => { const c = lightCtx(); mut(c); return EV.validateCaptureEvidence(SPEC_E, c, REFS_E).join(' | '); };

  it('GREEN 대조군', () => expect(EV.validateCaptureEvidence(SPEC_E, lightCtx(), REFS_E)).toEqual([]));
  it('RED: 대조 기준(HEAD·fingerprint·blobs)을 생략하면 fail-closed', () => {
    // 생략을 허용하면 provenance의 **존재만** 보는 것이라 아무 의미가 없다.
    expect(EV.validateCaptureEvidence(SPEC_E, lightCtx())).toEqual(['EVIDENCE_PROVENANCE_REFS_REQUIRED']);
    // 계약 검사는 refs 유무와 무관하게 먼저 돈다 — 정본 계약이면 여기서 오류가 없다.
    expect(EV.validateCaptureEvidence(SPEC_E, lightCtx(), { ...REFS_E, headCommit: undefined }).join())
      .toMatch(/EVIDENCE_PROVENANCE_REF_MISSING headCommit/);
  });
  it('RED: coverage 증거 삭제·집합 불일치·미관측', () => {
    expect(bad((c) => { delete c.coverageEvidence; })).toMatch(/EVIDENCE_COVERAGE_MISSING/);
    expect(bad((c) => { delete c.coverageEvidence.s1['.Req']; })).toMatch(/EVIDENCE_COVERAGE_KEYSET s1 missing=\[\.Req\]/);
    expect(bad((c) => { c.coverageEvidence.s1['.Cov'] = { count: 3, visible: 0 }; })).toMatch(/EVIDENCE_COVERAGE_UNSEEN s1 \.Cov 0/);
    expect(bad((c) => { c.coverageEvidence.s1['.Track::before'] = { count: 1, present: 0 }; })).toMatch(/EVIDENCE_COVERAGE_UNSEEN/);
    expect(bad((c) => { c.coverageEvidence.ghost = {}; })).toMatch(/EVIDENCE_COVERAGE_UNKNOWN_SURFACE ghost/);
  });
  it('RED: provenance 누락·불일치', () => {
    expect(bad((c) => { delete c.provenance; })).toMatch(/EVIDENCE_PROVENANCE_MISSING/);
    const c = lightCtx();
    expect(EV.validateCaptureEvidence(SPEC_E, c, { ...REFS_E, headCommit: 'zzz' }).join()).toMatch(/EVIDENCE_PROVENANCE_HEAD abc != zzz/);
    expect(EV.validateCaptureEvidence(SPEC_E, c, { ...REFS_E, specFingerprintNow: 'other' }).join()).toMatch(/EVIDENCE_PROVENANCE_FINGERPRINT/);
    expect(EV.validateCaptureEvidence(SPEC_E, c, { ...REFS_E, headBlobs: { 'x.mjs': 'DIFFERENT' } }).join()).toMatch(/EVIDENCE_PROVENANCE_BLOB x\.mjs/);
    expect(EV.validateCaptureEvidence(SPEC_E, c, { ...REFS_E, headBlobs: { 'x.mjs': 'b1', 'y.mjs': 'b2' } }).join()).toMatch(/EVIDENCE_PROVENANCE_BLOB_SET/);
  });
  it('darkReview는 dark phase에만 있고 전부 pass여야 한다', () => {
    expect(bad((c) => { c.darkReview = {}; })).toMatch(/EVIDENCE_DARK_REVIEW_IN_LIGHT/);
    const dark = { ...lightCtx(), phase: 'dark', darkReview: { s1: { '.Dark1': { count: 1, visible: 1, pass: true } } } };
    expect(EV.validateCaptureEvidence(SPEC_E, dark, REFS_E)).toEqual([]);
    expect(EV.validateCaptureEvidence(SPEC_E, { ...dark, darkReview: { s1: { '.Dark1': { count: 1, visible: 0, pass: false } } } }, REFS_E).join())
      .toMatch(/EVIDENCE_DARK_REVIEW_FAIL s1 \.Dark1/);
    expect(EV.validateCaptureEvidence(SPEC_E, { ...dark, darkReview: { s1: {} } }, REFS_E).join()).toMatch(/EVIDENCE_DARK_REVIEW_KEYSET s1 missing=\[\.Dark1\]/);
    expect(EV.validateCaptureEvidence(SPEC_E, { ...dark, darkReview: undefined }, REFS_E).join()).toMatch(/EVIDENCE_DARK_REVIEW_MISSING/);
  });
  it('phase가 없거나 이상하면 즉시 거부', () => {
    for (const p of [undefined, 'sepia', null])
      expect(EV.validateCaptureEvidence(SPEC_E, { ...lightCtx(), phase: p }, REFS_E)).toEqual([`EVIDENCE_PHASE_INVALID ${String(p)}`]);
  });
  it('승인 경로(artifactsCore)에 배선돼 있다 — release bundle 기준', () => {
    const b = committedBundle('light');
    if (b.absent) {
      // 승격 전이다. legacy 파일로 대신 통과시키지 않는다 — 없다는 사실을 그대로 고정한다.
      expect(b.reason).toMatch(/NO_RELEASE|CAPTURE_BUNDLE_MISSING/);
      return;
    }
    const errs = EV.validateCommittedArtifacts({
      committedFixtureRaw: b.fixtureRaw, spec: SPEC, contextRaw: b.contextRaw,
      sha256: (v) => createHash('sha256').update(v).digest('hex'), readPng: b.readPng,
      provenanceRefs: null });
    expect(errs).toEqual([]);            // 정상 release의 committed gate 정답
  });
});

describe('S4 HEAD 결속 — 캡처 시작 시점에 강제한다', () => {
  const REPO = fileURLToPath(new URL('../../', import.meta.url));
  const exec = (c) => __exec(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  it('tracked + working blob === HEAD blob 을 모두 본다', () => {
    // tracked 여부만 보면 로컬 수정본이 통과한다(LAYOUT_UNIT 1/64→1/8 후 재동결 시나리오).
    const clean = PROM.headBlobBinding(REPO, ['frontend/package.json']);
    expect(clean.errors).toEqual([]);
    expect(clean.headCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(clean.blobs['frontend/package.json']).toMatch(/^[0-9a-f]{40}$/);
    const missing = PROM.headBlobBinding(REPO, ['frontend/__definitely_not_tracked__.mjs']);
    expect(missing.errors.join()).toMatch(/HASH_OBJECT_FAILED|NOT_TRACKED_AT_HEAD/);
    expect(missing.blobs).toBeNull();
  });
  it('해시 입력 모듈 목록이 fingerprint 입력과 일치한다', () => {
    // 승격 CLI가 공유 projector 모듈을 쓰므로 그것도 캡처 provenance 목록에 든다.
    expect(CAP.HASHED_MODULES).toEqual([...CAP.DISCOVERY_HASHED_MODULES,
      'frontend/library/s4Projection.mjs', 'frontend/scripts/s4-audit-candidate.mjs',
      'frontend/scripts/s4-promote-capture.mjs']);
    expect(CAP.HASHED_MODULES.length).toBe(12);
  });
});

describe('S4 캡처 진입점 — core를 우회하는 어댑터를 막는다', () => {
  // 금지 대상은 **코드의 어휘**다. 주석에서 그 이름을 설명하는 것까지 막으면 계약을 문서화할 수 없다.
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  const src = () => stripComments(readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url), 'utf8'));
  it('산출물 쓰기 어휘가 없다 — 쓰기는 해시된 core의 writeCandidate에만 있다', () => {
    const t = src();
    for (const banned of ['node:fs', 'writeFileSync', 'mkdirSync', 'appendFileSync', 'createWriteStream'])
      expect(t).not.toContain(banned);
    expect(stripComments(readFileSync(new URL('./s4CaptureRunner.mjs', import.meta.url), 'utf8'))).toContain('writeFileSync');
  });
  it('세만틱을 재구현하지 않는다 — runCapture만 호출한다', () => {
    const t = src();
    expect(t).toContain('runCapture(');
    // 브라우저 주입 소스를 다시 정의하면 core와 갈라진다
    for (const banned of ['ASSERT_SOURCE =', 'PROBE_SOURCE =', 'THEME_PROBE_SOURCE =', 'querySelectorAll'])
      expect(t).not.toContain(banned);
    // 액션 해석·paintRect 파생도 core 몫이다
    for (const banned of ['resolveActions', 'derivePaintRect', 'normalizeOccurrence', 'expectPresent'])
      expect(t).not.toContain(banned);
  });
  it('브리지 method는 원시 동작 + attempt lifecycle뿐이다(selector 술어를 받는 primitive 없음)', () => {
    expect([...CAP.BRIDGE_METHODS].sort()).toEqual(['addInitScript', 'beginAttempt', 'click', 'endAttempt',
      'evaluate', 'goto', 'hello', 'hover', 'reload', 'screenshot', 'setStorage', 'setViewport',
      'settle', 'shutdown', 'sleep'].sort());
  });
  it('인자 문법이 엄격하다', () => {
    expect(CAP.parseCaptureArgs(['--phase', 'light'], SPEC))
      .toEqual({ phase: 'light', port: 10098, discover: false, canary: null, scan: null, repeat: 1, timeoutMs: CAP.RPC_TIMEOUT_MS });
    expect(CAP.parseCaptureArgs(['--phase', 'dark', '--port', '10099'], SPEC))
      .toEqual({ phase: 'dark', port: 10099, discover: false, canary: null, scan: null, repeat: 1, timeoutMs: CAP.RPC_TIMEOUT_MS });
    expect(CAP.parseCaptureArgs(['--discover'], SPEC))
      .toEqual({ phase: null, port: 10098, discover: true, canary: null, scan: null, repeat: 1, timeoutMs: CAP.RPC_TIMEOUT_MS });
    expect(CAP.parseCaptureArgs(['--discover', '--phase', 'light'], SPEC).error).toMatch(/EXACTLY_ONE_MODE/);
    expect(CAP.parseCaptureArgs([], SPEC).error).toMatch(/EXACTLY_ONE_MODE/);
    expect(CAP.parseCaptureArgs(['--phase', 'sepia'], SPEC).error).toMatch(/PHASE_REQUIRED/);
    expect(CAP.parseCaptureArgs(['--bogus', '1'], SPEC).error).toMatch(/UNKNOWN_ARG/);
    expect(CAP.parseCaptureArgs(['--phase', 'light', '--port', '80'], SPEC).error).toMatch(/BAD_PORT/);
  });
  it('어댑터 바이트가 fingerprint 입력이다', () => {
    const realSha = (v) => createHash('sha256').update(v).digest('hex');
    const tampered = EV.specFingerprint(SPEC,
      (v) => (Buffer.isBuffer(v) && v.equals(RUN.ADAPTER_MODULE_BYTES) ? 'TAMPERED_ADAPTER' : realSha(v)));
    expect(tampered).not.toBe(EV.specFingerprint(SPEC, realSha));
    expect(RUN.ADAPTER_MODULE_BYTES.equals(readFileSync(new URL('../scripts/s4-capture.mjs', import.meta.url)))).toBe(true);
  });
  it('브리지 driver는 판정하지 않고 응답만 기다린다', async () => {
    const { driver, state } = CAP.createBridgeDriver();
    const p = driver.evaluate('SRC', [1, 2]);
    expect(state.pending).toEqual({ id: 1, method: 'evaluate', args: ['SRC', [1, 2]] });
    expect(CAP.bridgeResolve(state, { id: 1, value: { ok: 1 } })).toBe(true);
    await expect(p).resolves.toEqual({ ok: 1 });
    const p2 = driver.goto('/x');
    CAP.bridgeResolve(state, { id: 2, error: 'nav failed' });
    await expect(p2).rejects.toThrow(/nav failed/);
  });
});

describe('S4 action log 계약 — 손으로 만든 context는 승인되지 않는다', () => {
  const SURF = {
    name: 'r-a', captureName: 'r-a.png', requiredElements: [], darkReviewSelectors: [],
    actions: [
      { op: 'goto', url: '/tracks/{id}' },
      { op: 'click', selector: '.Toggle', nth: 0 },
      { op: 'expectPresent', selector: '.Pill--on' },
      { op: 'expectAbsent', selector: '.Gone' },
    ],
    coverageSelectors: [{ selector: '.Pill--on', state: 'selected', provenBy: 1, produces: '.Pill--on' }],
  };
  const SPEC_A = DS_SPEC({ REQUIRED_SMOKE_SURFACES: [SURF] });
  const honest = () => ({
    trackId: 7,
    actionLog: { 'r-a': [
      { index: 0, op: 'goto', decided: null },
      { index: 1, op: 'click', selector: '.Toggle', decided: { '.Pill--on': { count: 1, visible: 1 } } },
      { index: 2, op: 'expectPresent', selector: '.Pill--on', decided: { count: 1, visible: 1 } },
      { index: 3, op: 'expectAbsent', selector: '.Gone', decided: { count: 0, visible: 0 } },
    ] },
  });
  const bad = (mut) => { const c = honest(); mut(c); return EV.validateActionLog(SPEC_A, c).join(' | '); };

  it('GREEN 대조군: 실행기가 남긴 정상 로그', () => expect(EV.validateActionLog(SPEC_A, honest())).toEqual([]));
  it('RED: actionLog 자체가 없다(= 실행기를 안 거친 context)', () =>
    expect(EV.validateActionLog(SPEC_A, { trackId: 7 })).toEqual(['ACTIONLOG_MISSING']));
  it('RED: surface 누락 / 미지 surface', () => {
    expect(bad((c) => { delete c.actionLog['r-a']; })).toMatch(/ACTIONLOG_SURFACE_MISSING r-a/);
    expect(bad((c) => { c.actionLog['ghost'] = []; })).toMatch(/ACTIONLOG_UNKNOWN_SURFACE ghost/);
  });
  it('RED: 길이·순서·op가 manifest와 다르다', () => {
    expect(bad((c) => { c.actionLog['r-a'].pop(); })).toMatch(/ACTIONLOG_LENGTH r-a 3!=4/);
    expect(bad((c) => { c.actionLog['r-a'][2].op = 'hover'; })).toMatch(/ACTIONLOG_OP r-a\[2\] hover != expectPresent/);
    expect(bad((c) => { c.actionLog['r-a'][2].index = 9; })).toMatch(/ACTIONLOG_INDEX r-a\[2\] 9/);
  });
  it('RED: 단정 op에 판정 기록이 없다', () =>
    expect(bad((c) => { c.actionLog['r-a'][2].decided = null; })).toMatch(/ACTIONLOG_NO_DECISION r-a\[2\] expectPresent/));
  it('RED: **완전한 형태의 위조 로그** — 판정이 op와 모순된다', () => {
    // 길이·순서·op를 모두 맞춘 채 숫자만 바꿔도 op의 의미와 모순되면 잡힌다.
    expect(bad((c) => { c.actionLog['r-a'][2].decided = { count: 0, visible: 0 }; }))
      .toMatch(/ACTIONLOG_DECISION_CONTRADICTS r-a\[2\] expectPresent visible=0/);
    expect(bad((c) => { c.actionLog['r-a'][3].decided = { count: 1, visible: 1 }; }))
      .toMatch(/ACTIONLOG_DECISION_CONTRADICTS r-a\[3\] expectAbsent visible=1/);
  });
  it('RED: manifest가 선언한 상태 증거가 기록되지 않았거나 실패했다', () => {
    expect(bad((c) => { c.actionLog['r-a'][1].decided = {}; })).toMatch(/ACTIONLOG_STATE_UNRECORDED r-a\[1\] state:selected/);
    expect(bad((c) => { c.actionLog['r-a'][1].decided = { '.Pill--on': { count: 1, visible: 0 } }; }))
      .toMatch(/ACTIONLOG_STATE_UNPROVEN r-a\[1\] state:selected \.Pill--on visible=0/);
  });
  it('RED: placeholder를 해석할 수 없는 context(trackId 누락)', () =>
    expect(bad((c) => { delete c.trackId; })).toMatch(/ACTIONLOG_PLAN_UNRESOLVED_PLACEHOLDER/));
  it('승인 경로(artifactsCore)에 배선돼 있다 — release bundle 기준', () => {
    const b = committedBundle('light');
    if (b.absent) { expect(b.reason).toMatch(/NO_RELEASE|CAPTURE_BUNDLE_MISSING/); return; }
    const errs = EV.validateCommittedArtifacts({
      committedFixtureRaw: b.fixtureRaw, spec: SPEC, contextRaw: b.contextRaw,
      sha256: (v) => createHash('sha256').update(v).digest('hex'), readPng: b.readPng,
      provenanceRefs: null });
    expect(errs).toEqual([]);            // 정상 release의 committed gate 정답
  });
  it('actionLog 계약은 helper 수준에서 상시 검증된다', () => {
    // release 유무와 무관하게 계약 자체는 돌아야 한다 — 위 배선 테스트가 비어 있을 때의 보완.
    expect(EV.validateActionLog(SPEC, { phase: 'light' }).join(' ')).toMatch(/ACTIONLOG_MISSING/);
  });
});

describe('S4 committed probe — 측정 코드의 계약', () => {
  const OCC = (over) => ({ x: 10, y: 20, width: 21.6, height: 21.6, borderBoxWidth: 20, borderBoxHeight: 20,
    transformScaleX: 1.08, transformScaleY: 1.08, chainDepth: 3, skewCount: 0, nonFlatCount: 0, zoomCount: 0,
    offsetWidth: 20, offsetHeight: 20, display: 'flex', boxSizing: 'border-box', cssWidth: '20px', cssHeight: '20px',
    padX: 0, padY: 0, brdX: 0, brdY: 0,
    boxShadow: 'none', outlineStyle: 'none', outlineWidth: '0px', outlineOffset: '0px', filter: 'none', ...over });
  const RES = (over) => ({ '.A': [OCC()], '.B': [], ...over });
  it('PROBE_SOURCE는 자기 요소만 재고 확장 rect를 만들지 않는다', () => {
    const src = PROBE.PROBE_SOURCE;
    expect(src).toContain('document.querySelectorAll(sel)');
    for (const banned of ['parentElement.getBoundingClientRect', 'closest(', 'offsetParent'])
      expect(src).not.toContain(banned);
    // 조상 체인은 **computed transform 문자열만** 읽는다(rect를 재지 않는다)
    expect(src).toContain('node.parentElement');
    expect(src).toContain('var ncs = getComputedStyle(node)');
    expect(src).toContain('mat(ncs.transform)');
    // 체인 순회 구간에 rect 측정이 들어오면 "자기 요소만" 계약이 깨진다
    const chain = src.slice(src.indexOf('while (node'), src.indexOf('list.push('));
    expect(chain).not.toContain('getBoundingClientRect');
  });
  it('GREEN: 정상 결과는 오류 0', () => expect(PROBE.validateProbeResult(RES(), ['.A', '.B'])).toEqual([]));
  it('RED: 키 누락 / 초과 / 배열 아님', () => {
    expect(PROBE.validateProbeResult({ '.A': [OCC()] }, ['.A', '.B']).join()).toMatch(/PROBE_SELECTOR_MISSING \.B/);
    expect(PROBE.validateProbeResult(RES({ '.C': [] }), ['.A', '.B']).join()).toMatch(/PROBE_SELECTOR_EXTRA \.C/);
    expect(PROBE.validateProbeResult({ '.A': {}, '.B': [] }, ['.A', '.B']).join()).toMatch(/PROBE_NOT_ARRAY \.A/);
    expect(PROBE.validateProbeResult(null, ['.A']).join()).toMatch(/PROBE_RESULT_SHAPE/);
  });
  it('RED: 측정 불가·모델 밖 좌표계는 통과하지 않는다', () => {
    const bad = (over, re) => expect(PROBE.validateProbeResult({ '.A': [OCC(over)] }, ['.A']).join()).toMatch(re);
    bad({ borderBoxWidth: NaN }, /PROBE_NONFINITE \.A\[0\] borderBoxWidth/);
    bad({ borderBoxWidth: 0 }, /PROBE_BORDERBOX_UNMEASURABLE/);
    bad({ width: 0 }, /PROBE_DEGENERATE/);
    bad({ transformScaleX: 0 }, /PROBE_BAD_SCALE/);
    bad({ skewCount: 1 }, /PROBE_SKEWED/);          // 회전·기울임
    bad({ nonFlatCount: 1 }, /PROBE_NON_AFFINE/);   // 3D
    bad({ zoomCount: 1 }, /PROBE_ZOOMED/);          // zoom은 좌표계를 바꾼다
    bad({ chainDepth: 0 }, /PROBE_CHAIN_EMPTY/);
    bad({ display: 42 }, /PROBE_NONSTRING \.A\[0\] display/);
  });
  it('두 파생 교차검증: 한쪽만 위조하면 걸린다', () => {
    expect(PROBE.crossCheckScale(OCC())).toEqual([]);
    expect(PROBE.crossCheckScale(OCC({ transformScaleX: 2, transformScaleY: 2 })).join()).toMatch(/SCALE_CROSSCHECK_X/);
    expect(PROBE.crossCheckScale(OCC({ width: 40 })).join()).toMatch(/SCALE_CROSSCHECK_X/);
    expect(PROBE.crossCheckScale(OCC({ transformScaleY: 1.2 })).join()).toMatch(/SCALE_ANISOTROPIC|SCALE_CROSSCHECK_Y/);
  });
  it('LayoutUnit(1/64) 만큼의 스냅 오차는 허용하고 그 이상은 아니다', () => {
    expect(PROBE.crossCheckScale(OCC({ width: 21.6 + 1 / 64 }))).toEqual([]);
    expect(PROBE.crossCheckScale(OCC({ width: 21.6 + 1 / 8 })).join()).toMatch(/SCALE_CROSSCHECK_X/);
  });
  it('normalizeOccurrence: 좌표는 1/64, 배율은 별도 격자로 양자화한다', () => {
    // 10.001 은 1/64 격자에서 640.064 → 640 으로 내려간다(10.0078125는 격자 중간값이라 부적절)
    const n = PROBE.normalizeOccurrence(OCC({ x: 10.001, transformScaleX: 0.5000004, transformScaleY: 0.5000004 }));
    expect(n.x).toBe(10);                          // 1/64 격자
    expect(PROBE.q(10.0078125 + 0.001)).toBe(10.015625);   // 중간값 바로 위는 올라간다
    expect(n.scale).toBe(0.5);                     // 1e-6 격자 — 0.5와 0.503을 붙이지 않는다
    expect(n.paintRect).toBeUndefined();           // paintRect는 관측물이 아니라 파생물이다
    expect(PROBE.qs(0.503)).toBe(0.503);
  });
});

describe('S4 마스크 위조 배터리 — 각 계약이 단독으로 물린다', () => {
  const fx = unitFixture();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const run = (mut) => {
    const ctx = unitCtx(); const spec = { ...UNIT_SPEC }; const f = clone(fx);
    mut({ ctx, spec, fx: f });
    return EV.validateMaskContract(f, spec, ctx).join(' | ');
  };
  const RING = (ctx) => ctx.baseLightMaskRects['unit-b'][U_RING][0];
  const PLAIN = (ctx) => ctx.baseLightMaskRects['unit-a']['.UnitPlain'][0];

  it('GREEN 대조군: 손대지 않으면 오류 0', () => expect(run(() => {})).toBe(''));

  it('M1 배율 단독 위조 → 정본 표와 불일치', () =>
    expect(run(({ ctx }) => { PLAIN(ctx).scale = 0.5; })).toMatch(/MASK_SCALE_UNEXPECTED unit-a \.UnitPlain 0\.5!=1/));

  it('M2 배율+paintRect 동시 위조(내부 정합) → 여전히 표와 불일치', () =>
    expect(run(({ ctx }) => {
      const r = RING(ctx); r.scale = 2.16; const d = 3 * 2.16;
      r.paintRect = { x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d };
    })).toMatch(/MASK_SCALE_UNEXPECTED/));

  it('M2b 배율+paintRect+정본 표까지 동시 위조 → 두 파생 교차검증만 남고, 그것이 잡는다', () =>
    expect(run(({ ctx, spec }) => {
      const r = RING(ctx); r.scale = 2.16; r.transformScaleX = 2.16; r.transformScaleY = 2.16;
      const d = 3 * 2.16;
      r.paintRect = { x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d };
      spec.ELEMENT_SCALES = { ...spec.ELEMENT_SCALES,
        'unit-b': { ...spec.ELEMENT_SCALES['unit-b'], [U_RING]: 2.16 } };
    })).toMatch(/MASK_SCALE_CROSSCHECK_X/));

  it('M3 전면 위조(배율·transform·rect·borderBox 전부 정합) → 정본 표가 잡는다', () =>
    expect(run(({ ctx }) => {
      const r = PLAIN(ctx);
      r.scale = 2; r.transformScaleX = 2; r.transformScaleY = 2;
      r.width = r.borderBoxWidth * 2; r.height = r.borderBoxHeight * 2;
      r.paintRect = { x: r.x, y: r.y, width: r.width, height: r.height };
    })).toMatch(/MASK_SCALE_UNEXPECTED/));

  it('M5 부모 요소 측정값 대입 → 크기 envelope가 잡는다', () =>
    expect(run(({ ctx, spec }) => {
      spec.SELECTOR_SIZE_ENVELOPE = { ...spec.SELECTOR_SIZE_ENVELOPE,
        '.UnitPlain': { minW: 20, maxW: 20, minH: 20, maxH: 20 } };
      const r = PLAIN(ctx);
      r.borderBoxWidth = 180; r.borderBoxHeight = 110;      // 부모 크기
      r.width = 180; r.height = 110;                        // 배율 1이므로 rect도 같다
      r.paintRect = { x: r.x, y: r.y, width: 180, height: 110 };
    })).toMatch(/MASK_ENVELOPE_VIOLATION unit-a \.UnitPlain 180x110/));

  it('M6 envelope 상한만 넓히기 → 극단 도달 조건이 잡는다', () =>
    expect(run(({ spec }) => {
      spec.SELECTOR_SIZE_ENVELOPE = { ...spec.SELECTOR_SIZE_ENVELOPE,
        '.UnitPlain': { minW: 20, maxW: 10000, minH: 20, maxH: 20 } };
    })).toMatch(/MASK_ENVELOPE_SLACK \.UnitPlain maxW 선언=10000 실측=20/));

  it('M7 outset 부풀리기(paintRect까지 정합) → 변경 property 파생이 잡는다', () =>
    expect(run(({ ctx, spec }) => {
      spec.LIGHT_DIFF_MASKS = { ...spec.LIGHT_DIFF_MASKS, 1: { selector: '.UnitPlain', paintOutsetPx: 8 } };
      for (const surf of ['unit-a', 'unit-b']) for (const r of ctx.baseLightMaskRects[surf]['.UnitPlain']) {
        const d = 8 * r.scale;
        r.paintRect = { x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d };
      }
    })).toMatch(/MASK_OUTSET_UNJUSTIFIED unit-\w \.UnitPlain 선언=8 파생=0 \(background\)/));

  it('M8 개별 계약을 모두 지키는 rect 추가 → 픽셀 예산만이 잡는다', () => {
    const out = run(({ ctx }) => {
      const r = clone(PLAIN(ctx));
      r.x = 10; r.y = 10;                                    // 겹치지 않고 뷰포트 안인 정상 위치
      r.paintRect = { x: r.x, y: r.y, width: r.width, height: r.height };
      ctx.baseLightMaskRects['unit-a']['.UnitPlain'].push(r);
    });
    expect(out).toMatch(/MASK_BUDGET_MISMATCH unit-a 800 != 400/);
    expect(out).not.toMatch(/MASK_SCALE|MASK_ENVELOPE|MASK_OUTSET|MASK_PAINT/);   // 다른 계약은 전부 통과
  });

  it('M9 예산 숫자 부풀리기', () =>
    expect(run(({ spec }) => { spec.MASK_PIXEL_BUDGET = { ...spec.MASK_PIXEL_BUDGET, 'unit-a': 999999 }; }))
      .toMatch(/MASK_BUDGET_MISMATCH unit-a 400 != 999999/));

  it('M10 셀 비우기(정본 표는 그대로) → 미사용 선언으로 잡는다', () =>
    expect(run(({ ctx }) => { ctx.baseLightMaskRects['unit-b']['.UnitPlain'] = []; }))
      .toMatch(/MASK_SCALE_UNUSED unit-b \.UnitPlain/));

  it('M11 표에 없는 셀에 occurrence 추가 → 미선언 셀로 잡는다', () =>
    expect(run(({ ctx, spec }) => {
      spec.ELEMENT_SCALES = { 'unit-a': { '.UnitPlain': 1 }, 'unit-b': { [U_RING]: 1.08 } };
    })).toMatch(/MASK_SCALE_UNDECLARED_CELL unit-b \.UnitPlain/));

  it('M12 변경 property를 모델 밖 값으로 바꿔치기 → outset 파생 자체가 거부된다', () =>
    expect(run(({ fx }) => { fx.allowIdToKey['1'] = fx.allowIdToKey['1'].replace('|background|', '|mystery-prop|'); }))
      .toMatch(/MASK_PAINT_PROPERTY_UNMODELED mystery-prop/));

  it('M13 오위치는 정적 계약으로는 잡히지 않는다 — 재측정 대조가 잡는다(설계 확인)', () => {
    // 픽셀 수가 보존되는 정수 이동을 고른다. 계약은 "그 요소가 어디 있어야 하는지"를 모른다.
    const moved = unitCtx();
    const r = moved.baseLightMaskRects['unit-a']['.UnitPlain'][0];
    r.x += 50; r.paintRect.x += 50;                          // 정수 이동 → 픽셀 수 보존, 뷰포트 안
    expect(EV.validateMaskContract(fx, UNIT_SPEC, moved)).toEqual([]);         // 정적 계약은 통과
    const honestObs = unitObs(unitCtx(), 'unit-a');
    expect(PIX.validateObserved(moved, 'unit-a', honestObs, UNIT_SPEC).join(' | '))
      .toMatch(/OBSERVE_GEOMETRY unit-a \.UnitPlain\[0\] x/);                  // 재측정 대조가 RED
    expect(PIX.validateObserved(unitCtx(), 'unit-a', honestObs, UNIT_SPEC)).toEqual([]);   // GREEN 대조군
  });
});

describe('S4 fingerprint 결속 — 새 정본 표와 측정 코드', () => {
  const realSha = (v) => createHash('sha256').update(v).digest('hex');
  const base = () => EV.specFingerprint(SPEC, realSha);
  it('probe 소스가 바뀌면 fingerprint가 흔들린다', () => {
    const tampered = EV.specFingerprint(SPEC, (v) => (v === PROBE.PROBE_SOURCE ? 'TAMPERED' : realSha(v)));
    expect(tampered).not.toBe(base());
  });
  it('probe 모듈 **전체 바이트**가 fingerprint 입력이다', () => {
    // PROBE_SOURCE만 해시하면 양자화 격자·정규화·거부 규칙·교차검증 엄격도가 잠기지 않는다.
    // 실측(수정 전): QUANT 64→32 변경이 fingerprint를 흔들지 못했다.
    const tampered = EV.specFingerprint(SPEC,
      (v) => (Buffer.isBuffer(v) && v.equals(PROBE.PROBE_MODULE_BYTES) ? 'TAMPERED_MODULE' : realSha(v)));
    expect(tampered).not.toBe(base());
  });
  it('PROBE_MODULE_BYTES는 디스크 원본과 같고 잠겨야 할 것들을 실제로 담고 있다', () => {
    expect(PROBE.PROBE_MODULE_BYTES.equals(readFileSync(PROBE.PROBE_MODULE_PATH))).toBe(true);
    const src = PROBE.PROBE_MODULE_BYTES.toString('utf8');
    for (const token of ['export const QUANT', 'export const SCALE_QUANT', 'export function normalizeOccurrence',
      'export function validateProbeResult', 'export function crossCheckScale', 'export const PROBE_SOURCE'])
      expect(src).toContain(token);
  });
  it('self-hash는 파일 바이트를 실제로 추적한다(임시 복사본으로 확인 — 실제 파일 불변)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 's4-probe-'));
    try {
      const orig = readFileSync(PROBE.PROBE_MODULE_PATH);
      const a = join(dir, 'a.mjs'); const b = join(dir, 'b.mjs');
      writeFileSync(a, orig);
      writeFileSync(b, orig.toString('utf8').replace('export const QUANT = 64;', 'export const QUANT = 32;'));
      const [MA, MB] = [await import(pathToFileURL(a).href), await import(pathToFileURL(b).href)];
      expect(MA.PROBE_MODULE_BYTES.equals(orig)).toBe(true);
      expect(MB.QUANT).toBe(32);                                        // 사본은 실제로 바뀌었다
      expect(MA.PROBE_SOURCE).toBe(MB.PROBE_SOURCE);                    // PROBE_SOURCE는 동일 — 이것만으론 못 잡는다
      expect(realSha(MA.PROBE_MODULE_BYTES)).not.toBe(realSha(MB.PROBE_MODULE_BYTES));   // 모듈 해시는 다르다
      expect(PROBE.QUANT).toBe(64);                                     // 실제 파일은 건드리지 않았다
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('ELEMENT_SCALES / SELECTOR_SIZE_ENVELOPE / MASK_PIXEL_BUDGET 변조가 각각 잡힌다', () => {
    const muts = [
      { ...SPEC, ELEMENT_SCALES: { ...SPEC.ELEMENT_SCALES, canvas: { ...SPEC.ELEMENT_SCALES.canvas, '.TrackNode__PrioFlag': 1 } } },
      { ...SPEC, SELECTOR_SIZE_ENVELOPE: { ...SPEC.SELECTOR_SIZE_ENVELOPE, '.TrackNode__PrioFlag': { minW: 1, maxW: 9999, minH: 1, maxH: 9999 } } },
      { ...SPEC, MASK_PIXEL_BUDGET: { ...SPEC.MASK_PIXEL_BUDGET, canvas: 1 } },
    ];
    for (const m of muts) expect(EV.specFingerprint(m, realSha)).not.toBe(base());
  });
  it('캔버스 배율은 1이 아니라 0.5로 동결돼 있다(실측)', () => {
    for (const sel of ['.TrackNode__PrioFlag', '.TrackNode--restricted', '.TrackNode__ParentChip', '.TrackNode__SubProgress'])
      expect(SPEC.ELEMENT_SCALES.canvas[sel]).toBe(0.5);
    expect(SPEC.ELEMENT_SCALES.canvas['.SourcePicker__BranchKey']).toBe(1);   // 같은 화면, 다른 좌표계
  });
  it('LIGHT_DIFF_MASKS에 selector 전역 배율(expectedScale)이 남아 있지 않다', () => {
    for (const [id, m] of Object.entries(SPEC.LIGHT_DIFF_MASKS)) expect(m.expectedScale).toBeUndefined();
  });
});

describe('S4 fingerprint 전수성 — 직렬화가 값 전체를 본다', () => {
  const realSha = (v) => createHash('sha256').update(v).digest('hex');
  it('payload 키 집합이 정본 목록과 exact 일치한다', () => {
    // 주석으로만 두면 payload가 조용히 좁아져도 아무도 모른다.
    expect(Object.keys(EV.specFingerprintPayload(SPEC, realSha)).sort())
      .toEqual([...EV.FINGERPRINT_PAYLOAD_KEYS].sort());
  });
  it('GREEN 대조군: 현재 SPEC은 plain JSON이고 fingerprint는 결정적 64자 hex', () => {
    expect(EV.specPlainJsonErrors(SPEC)).toEqual([]);
    const a = EV.specFingerprint(SPEC, realSha);
    expect(a).toBe(EV.specFingerprint(SPEC, realSha));       // 2회 호출 동일
    expect(a).toMatch(/^[0-9a-f]{64}$/);                     // 검사 대상 함수끼리 비교하는 것만이 아님
  });
  it('RED: 비열거 속성으로 필드를 숨기면 잡힌다', () => {
    // 실증된 회피: JSON.stringify는 비열거 속성을 건너뛰므로 payload를 넓혀도 못 막는다.
    const conv = JSON.parse(JSON.stringify(SPEC.CONVERSIONS));
    Object.defineProperty(conv[0], 'skipVerify', { value: true, enumerable: false });
    expect(JSON.parse(JSON.stringify(conv[0])).skipVerify).toBeUndefined();   // 직렬화에 안 보임
    expect(conv[0].skipVerify).toBe(true);                                    // 코드에는 보임
    const mut = { ...SPEC, CONVERSIONS: conv };
    expect(EV.specPlainJsonErrors(mut).join()).toMatch(/JSON_NON_ENUMERABLE/);
    // **해시를 돌려주지 않는다.** 이전 판은 오류 문자열을 해시했는데, 그러면 서로 다른
    // EVIL/SAFE 값이 같은 오류 문자열 → 같은 fingerprint가 됐다(실증). 거부는 중단이어야 한다.
    expect(() => EV.specFingerprint(mut, realSha)).toThrow(/SPEC_NOT_PLAIN/);
    expect(EV.snapshotSpec(mut).spec).toBeNull();
  });
  it('RED: 오류 문자열이 같은 서로 다른 spec이 같은 해시를 받지 않는다', () => {
    const mk = (val) => { const c = JSON.parse(JSON.stringify(SPEC.CONVERSIONS));
      delete c[0].to; Object.defineProperty(c[0], 'to', { value: val, enumerable: false, configurable: true });
      return { ...SPEC, CONVERSIONS: c }; };
    const safe = mk('SAFE'), evil = mk('EVIL');
    expect(safe.CONVERSIONS[0].to).toBe('SAFE');           // 소비값은 서로 다르다
    expect(evil.CONVERSIONS[0].to).toBe('EVIL');
    for (const sp of [safe, evil]) expect(() => EV.specFingerprint(sp, realSha)).toThrow(/SPEC_NOT_PLAIN/);
  });
  it('spec 스냅샷은 정확히 한 번 읽어 만들어진다 — 조회마다 달라지는 루트도 고정된다', () => {
    let n = 0;
    const full = SPEC.CONVERSIONS, short = SPEC.CONVERSIONS.slice(0, -1);
    // snapshotSpec은 **descriptor로** 한 번 읽는다. 그 다음 조회부터 다른 값을 준다.
    const proxied = new Proxy({ ...SPEC }, {
      getOwnPropertyDescriptor(t, k) {
        if (k !== 'CONVERSIONS') return Reflect.getOwnPropertyDescriptor(t, k);
        n += 1;
        return { value: n <= 1 ? full : short, enumerable: true, configurable: true, writable: true };
      },
      get(t, k) { if (k === 'CONVERSIONS') { n += 1; return n <= 1 ? full : short; } return t[k]; },
    });
    const snap = EV.snapshotSpec(proxied);
    expect(snap.errors).toEqual([]);
    expect(proxied.CONVERSIONS.length).toBe(short.length);   // 이후 조회는 달라진다
    expect(snap.spec.CONVERSIONS.length).toBe(full.length);  // 스냅샷은 그 한 번의 값으로 고정
    expect(Object.isFrozen(snap.spec)).toBe(true);           // 하류가 바꿀 수 없다
  });
  it('RED: toJSON / accessor / 심볼 키도 같은 부류다', () => {
    const withToJson = JSON.parse(JSON.stringify(SPEC.CONVERSIONS)); withToJson[0].toJSON = () => ({});
    const withGetter = JSON.parse(JSON.stringify(SPEC.CONVERSIONS));
    Object.defineProperty(withGetter[0], 'g', { get: () => 1, enumerable: true, configurable: true });
    const withSym = JSON.parse(JSON.stringify(SPEC.CONVERSIONS)); withSym[0][Symbol('h')] = 1;
    for (const conv of [withToJson, withGetter, withSym]) {
      const mut = { ...SPEC, CONVERSIONS: conv };
      expect(EV.specPlainJsonErrors(mut).length).toBeGreaterThan(0);
      expect(() => EV.specFingerprint(mut, realSha)).toThrow(/SPEC_NOT_PLAIN/);
    }
  });
  it('spec export 17개 전부가 fingerprint에 반영된다(타입 보존 변이 스윕)', () => {
    const base = EV.specFingerprint(SPEC, realSha);
    const mutate = (v) => {
      if (typeof v === 'string') return `${v}X`;
      if (typeof v === 'number') return v + 1;
      if (typeof v === 'boolean') return !v;
      if (v === null) return { pinned: 'X' };   // null → 값이 생기는 변이
      if (Array.isArray(v)) { if (!v.length) return ['X']; const c = v.slice(); c[0] = mutate(c[0]); return c; }
      if (v && typeof v === 'object') { const ks = Object.keys(v); if (!ks.length) return { zz: 'X' };
        return { ...v, [ks[0]]: mutate(v[ks[0]]) }; }
      return 'X';
    };
    const uncovered = Object.keys(SPEC).filter((k) => EV.specFingerprint({ ...SPEC, [k]: mutate(SPEC[k]) }, realSha) === base);
    expect(uncovered).toEqual([]);
  });
  it('키 순서만 바뀌면 fingerprint는 흔들리지 않는다(포매팅 정리는 재동결을 요구하지 않는다)', () => {
    const reordered = SPEC.REQUIRED_SMOKE_SURFACES.map((x) => {
      const { name, captureName, ...rest } = x;
      return { ...rest, captureName, name };                 // 키 순서만 뒤집는다
    });
    expect(JSON.stringify(reordered[0])).not.toBe(JSON.stringify(SPEC.REQUIRED_SMOKE_SURFACES[0]));
    expect(EV.specFingerprint({ ...SPEC, REQUIRED_SMOKE_SURFACES: reordered }, realSha))
      .toBe(EV.specFingerprint(SPEC, realSha));
  });
  it('PROBE_CONTRACT.export가 실제 주입되는 문자열에 결속돼 있다', () => {
    // module만 보면 두 번째 주입 소스를 만들어 러너가 그걸 쓰게 하고 export 이름은 그대로 둘 수 있다.
    const name = SPEC.PROBE_CONTRACT.export;
    expect(typeof PROBE[name]).toBe('string');
    expect(PROBE[name]).toBe(PROBE.PROBE_SOURCE);
    // 러너가 실제로 주입하는 소스와 동일해야 한다 — 러너 바이트에서 확인한다.
    const runnerSrc = RUN.RUNNER_MODULE_BYTES.toString('utf8');
    expect(runnerSrc).toContain('driver.evaluate(PROBE_SOURCE, selectors)');
    // 경로도 접미사가 아니라 디렉터리까지 맞는지 본다(구분자 정규화).
    const norm = (p2) => p2.split(sep).join('/');
    expect(norm(PROBE.PROBE_MODULE_PATH).endsWith(`/${SPEC.PROBE_CONTRACT.module}`)).toBe(true);
  });
  it('해시되는 모듈 바이트는 테스트 자기 위치에서 만든 경로로도 같다(자기신고 경로 배제)', () => {
    // 모듈이 신고한 PROBE_MODULE_PATH를 다시 읽으면 양변이 함께 틀려도 통과한다.
    expect(PROBE.PROBE_MODULE_BYTES.equals(readFileSync(new URL('./s4DomProbe.mjs', import.meta.url)))).toBe(true);
    expect(RUN.RUNNER_MODULE_BYTES.equals(readFileSync(new URL('./s4CaptureRunner.mjs', import.meta.url)))).toBe(true);
  });
});

describe('S4 도구 모듈은 앱 번들에 들어가지 않는다', () => {
  it('components/·pages/·hooks/의 어떤 파일도 s4* 도구 모듈을 import하지 않는다', () => {
    // 이 모듈들은 node:fs/node:crypto를 정적으로 쓴다. 앱 코드가 import하면 브라우저 번들이 깨진다.
    const roots = ['components', 'pages', 'hooks'];
    const offenders = [];
    const walk = (dirUrl) => {
      for (const ent of readdirSync(dirUrl, { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
        const child = new URL(`${ent.name}${ent.isDirectory() ? '/' : ''}`, dirUrl);
        if (ent.isDirectory()) { walk(child); continue; }
        if (!/\.(js|jsx|mjs|ts|tsx)$/.test(ent.name)) continue;
        const src = readFileSync(child, 'utf8');
        for (const m of src.matchAll(/from\s+['"]([^'"]*s4[A-Za-z]+\.mjs)['"]/g))
          offenders.push(`${ent.name} -> ${m[1]}`);
      }
    };
    for (const r of roots) { try { walk(new URL(`../${r}/`, import.meta.url)); } catch (e) { /* 없으면 통과 */ } }
    expect(offenders).toEqual([]);
  });
});

describe('S4 plain JSON 계약 — 검증과 소비가 같은 값을 본다', () => {
  it('JSON에서 나온 값은 통과한다', () => {
    expect(EV.plainJsonErrors(JSON.parse('{"a":[1,2,{"b":"c"}],"d":null,"e":true}'))).toEqual([]);
  });
  it('accessor / 심볼 키 / 비열거 / 이상한 prototype / 비유한수를 거부한다', () => {
    const acc = {}; Object.defineProperty(acc, 'x', { get: () => 1, enumerable: true, configurable: true });
    expect(EV.plainJsonErrors(acc).join()).toMatch(/JSON_ACCESSOR \$\.x/);
    const sym = { a: 1 }; sym[Symbol('s')] = 2;
    expect(EV.plainJsonErrors(sym).join()).toMatch(/JSON_SYMBOL_KEY/);
    const hidden = {}; Object.defineProperty(hidden, 'h', { value: 1, enumerable: false, configurable: true });
    expect(EV.plainJsonErrors(hidden).join()).toMatch(/JSON_NON_ENUMERABLE \$\.h/);
    expect(EV.plainJsonErrors(Object.assign(Object.create({ inherited: 1 }), { a: 1 })).join()).toMatch(/JSON_BAD_PROTO/);
    expect(EV.plainJsonErrors({ n: NaN }).join()).toMatch(/JSON_NONFINITE \$\.n/);
    expect(EV.plainJsonErrors({ f: () => 1 }).join()).toMatch(/JSON_BAD_TYPE \$\.f function/);
    expect(EV.plainJsonErrors({ u: undefined }).join()).toMatch(/JSON_BAD_TYPE \$\.u undefined/);
    const cyc = { a: {} }; cyc.a.back = cyc;
    expect(EV.plainJsonErrors(cyc).join()).toMatch(/JSON_CYCLE/);
  });
  it('정상 배열은 length를 문제 삼지 않는다', () => {
    expect(EV.plainJsonErrors({ list: [1, 2, 3] })).toEqual([]);
    const arr = [1]; arr.extra = 2;
    expect(EV.plainJsonErrors(arr).join()).toMatch(/JSON_ARRAY_EXTRA_KEY/);
  });
  it('accessor 검사는 살아있다 — 다만 public 경로의 방어는 raw 문자열 강제다', () => {
    // descriptor 기반 검사는 Object.defineProperty getter는 잡지만 **Proxy는 원리적으로 못 잡는다**
    // (getOwnPropertyDescriptor가 target으로 투과하므로 get 트랩이 보이지 않는다).
    const withGetter = { a: 1 };
    Object.defineProperty(withGetter, 'b', { get: () => 2, enumerable: true, configurable: true });
    expect(EV.plainJsonErrors(withGetter).join()).toMatch(/JSON_ACCESSOR/);
    let n = 0;
    const proxied = new Proxy({ b: 1 }, { get(t, k) { if (k === 'b') return ++n; return t[k]; } });
    expect(EV.plainJsonErrors(proxied)).toEqual([]);          // ← 못 잡는다. 그래서 문자열만 받는다.
    expect(proxied.b).not.toBe(proxied.b);                    // 읽을 때마다 값이 다르다
  });
});

describe('S4 public diffSurfaceLight — 마스크가 실제 픽셀 비교에 적용된다', () => {
  // unitCtx의 ring: border-box 20x20, scale 1.08 → rect 21.6x21.6 @ (100,100)
  //   d = outset 3 * 1.08 = 3.24 → paintRect x/y 96.76, w/h 28.08
  //   픽셀 범위 = floor(96.76)=96 .. ceil(124.84)=125(배타) → **96..124가 마스크, 125가 첫 바깥**
  // unit-b에는 .UnitPlain도 있다(150,20,20,20) → 150..170 x 20..40. maskCount는 2다.
  const run = (afterBuf) => D_CALL({ afterBuf });
  it('마스크 내부 1픽셀 차이 → diff 0 (허용된 라이트 변화)', () => {
    const r = run(D_PX(110, 110));
    expect(r.errors).toEqual([]); expect(r.maskCount).toBe(2); expect(r.diff).toBe(0); expect(r.ok).toBe(true);
  });
  it('마스크 외부 1픽셀 차이 → diff 1 (회귀 검출)', () => {
    const r = run(D_PX(60, 150));
    expect(r.errors).toEqual([]); expect(r.diff).toBe(1); expect(r.ok).toBe(false);
  });
  it('마스크 경계 양쪽을 고정한다: 124는 안, 125는 바깥', () => {
    expect(run(D_PX(124, 124)).diff).toBe(0);   // 마지막 마스크 픽셀
    expect(run(D_PX(125, 125)).diff).toBe(1);   // 첫 바깥 픽셀 — 회귀가 새어나오면 잡힌다
  });
  it('두 번째 마스크(.UnitPlain)도 실제로 적용된다', () => {
    expect(run(D_PX(155, 25)).diff).toBe(0);    // 150..170 x 20..40 안
    expect(run(D_PX(155, 45)).diff).toBe(1);    // y 45는 바깥
  });
});

describe('S4 observed 키 집합 — 누락·초과', () => {
  it('RED: live selector 키를 실제로 삭제 → OBSERVE_KEY_MISSING', () => {
    const o = unitObs(unitCtx(), 'unit-b'); delete o[U_RING];
    expect(D_CALL({ observed: o }).errors.join()).toMatch(/OBSERVE_KEY_MISSING .*UnitRing/);
  });
  it('RED: 정본에 없는 키 추가 → OBSERVE_EXTRA', () => {
    const o = unitObs(unitCtx(), 'unit-b'); o['.NotAMask'] = [];
    expect(D_CALL({ observed: o }).errors.join()).toMatch(/OBSERVE_EXTRA .*\.NotAMask/);
  });
});

describe('S4 allow ID 네 집합 exact equality — 비연속 집합과 단독 변조', () => {
  // 재번호화 대신 CONVERSIONS · LIGHT_DIFF_MASKS · allowIdToKey · changed[].allowIds
  // 네 집합의 sorted exact equality를 강제한다. ID가 비연속(1,4)이어도 정상이어야 한다.
  const C = () => UNIT_SPEC.COUNTS;
  const run = (fx, spec) => EV.validateCounts(fx, (spec || UNIT_SPEC).COUNTS, spec).join('|');
  it('GREEN: 비연속 집합(1,4) 정상', () => expect(run(unitFixture(), UNIT_SPEC)).toBe(''));
  it('GREEN: 프로덕션 비연속 집합도 개수·집합 정합', () => {
    const ids = [...new Set(SPEC.CONVERSIONS.filter((c) => c.ident.t === 'allow').map((c) => c.ident.id))].sort((a, b) => a - b);
    expect(ids).toEqual(Object.keys(SPEC.LIGHT_DIFF_MASKS).map(Number).sort((a, b) => a - b));
    expect(ids.length).toBe(SPEC.COUNTS.allowIds);
    expect(ids).not.toEqual(ids.map((_, i) => i + 1));            // 연속이 아님을 명시
  });
  it('RED: changed 단독 변조', () => {
    const fx = unitFixture(); fx.changed[1].allowIds = [9];
    expect(run(fx, UNIT_SPEC)).toMatch(/ALLOW_SET_CHANGED_VS_CONVERSIONS|ALLOW_SET_CHANGED_VS_MASKS|ALLOW_SET_CHANGED_VS_KEYMAP/);
  });
  it('RED: keyMap 단독 변조', () => {
    const fx = unitFixture(); fx.allowIdToKey = { 1: fx.allowIdToKey[1], 9: fx.allowIdToKey[4] };
    expect(run(fx, UNIT_SPEC)).toMatch(/ALLOW_SET_CHANGED_VS_KEYMAP/);
  });
  it('RED: CONVERSIONS 단독 변조', () => {
    const spec = { ...UNIT_SPEC, CONVERSIONS: [{ ident: { t: 'allow', id: 1 } }, { ident: { t: 'allow', id: 9 } }] };
    expect(run(unitFixture(), spec)).toMatch(/ALLOW_SET_CHANGED_VS_CONVERSIONS/);
  });
  it('RED: LIGHT_DIFF_MASKS 단독 변조', () => {
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { 1: UNIT_SPEC.LIGHT_DIFF_MASKS[1], 9: UNIT_SPEC.LIGHT_DIFF_MASKS[4] } };
    expect(run(unitFixture(), spec)).toMatch(/ALLOW_SET_CHANGED_VS_MASKS/);
  });
  it('RED: spec 미전달(배선 제거) → ALLOW_SET_SPEC_REQUIRED', () =>
    expect(EV.validateCounts(unitFixture(), C(), undefined).join('|')).toMatch(/ALLOW_SET_SPEC_REQUIRED/));
  it('배선 행동 고정: validateCandidate에 변이 spec을 주입하면 네 집합 오류가 나온다', () => {
    // 정규식으로 소스를 보면 호출을 지우고 같은 문자열을 주석에 남겨도 통과한다.
    // generator가 실제로 쓰는 순수 함수에 변이를 주입해 배선을 잠근다.
    const ctx = unitCtx();
    const results = [];
    expect(EV.validateCandidate({ fixture: unitFixture(), spec: UNIT_SPEC, context: ctx, contrastResults: results })).toEqual([]);
    const spec = { ...UNIT_SPEC, CONVERSIONS: [{ ident: { t: 'allow', id: 1 } }, { ident: { t: 'allow', id: 9 } }] };
    expect(EV.validateCandidate({ fixture: unitFixture(), spec, context: ctx, contrastResults: results }).join('|'))
      .toMatch(/ALLOW_SET_CHANGED_VS_CONVERSIONS/);
  });
  // validator를 주입할 수 없다 — 데이터와 순수 IO만 넘긴다.
  const IOSPY = () => { const c = { serialize: 0, write: 0, bytes: [] };
    return { c, serialize: () => { c.serialize++; return 'BYTES'; }, write: (b) => { c.write++; c.bytes.push(b); } }; };
  const U_CTX_RAW = () => JSON.stringify({ ...unitCtx(), capture: { type: 'png', scale: 'css', dpr: 1 },
    privacyAudit: { scope: 'dedicated-synthetic-account-workspace', contextPass: true, contextSubjectSha256: 'x', captures: [] } });
  const AW = (over = {}) => { const io = IOSPY();
    const se = synEvidence(over.spec || UNIT_SPEC);
    const r = EV.approveAndWrite({
      fixture: unitFixture(), contrastResults: [],
      discoveryEvidence: { files: se.files, gitBlob: se.gitBlob },
      actualDecls: UNIT_DECLS, actualRaw: '', preAnnSources: {},
      actualAllowIdToKey: UNIT_ACTUAL_ALLOW_MAP, baseDecls: UNIT_BASE_DECLS,
      provenanceRefs: { headCommit: 'unit', headBlobs: {}, specFingerprintNow: 'unit' },
      contextRaw: U_CTX_RAW(), sha256, readPng: () => ({ bytes: Buffer.from('p'), width: 1440, height: 900 }),
      serialize: io.serialize, write: io.write, ...over, spec: se.spec });
    return { r, c: io.c }; };
  it('validator 주입은 무시된다(정적 결속) — conformance/frozen 인자를 넘겨도 실제 validator가 돈다', () => {
    const { r, c } = AW({ conformance: () => [], frozen: () => [], validateCandidate: () => [] });
    // UNIT_SPEC에는 RASTER_CONTRACT·FILES blob이 없어 artifacts 단계에서 정상적으로 막힌다
    expect(r.wrote).toBe(false); expect(c).toEqual({ serialize: 0, write: 0, bytes: [] });
    expect(r.calls.artifacts).toBe(1);
  });
  it('candidate-only 오류 → conformance·artifacts 0회, write 0회', () => {
    const spec = { ...UNIT_SPEC, CONVERSIONS: [{ ident: { t: 'allow', id: 1 } }, { ident: { t: 'allow', id: 9 } }] };
    const { r, c } = AW({ spec });
    expect(r.errors.join('|')).toMatch(/ALLOW_SET_CHANGED_VS_CONVERSIONS/);
    expect(r.calls).toEqual({ candidate: 1, conformance: 0, artifacts: 0, evidence: 1 });
    expect(c).toEqual({ serialize: 0, write: 0, bytes: [] });
  });
  it('conformance-only 오류 → artifacts 0회, write 0회 (쓰기가 conformance보다 앞서지 않는다)', () => {
    const { r, c } = AW({ baseDecls: undefined });
    expect(r.errors.join('|')).toMatch(/BASE_DECLS_REQUIRED/);
    expect(r.calls).toEqual({ candidate: 1, conformance: 1, artifacts: 0, evidence: 1 });
    expect(c).toEqual({ serialize: 0, write: 0, bytes: [] });
  });
  it('artifacts-only 오류 → write 0회 (candidate·conformance는 통과)', () => {
    const { r, c } = AW({ readPng: () => ({ bytes: Buffer.from('p'), width: 2880, height: 1800 }) });
    expect(r.calls).toEqual({ candidate: 1, conformance: 1, artifacts: 1, evidence: 1 });
    expect(c).toEqual({ serialize: 0, write: 0, bytes: [] });
  });
  it('contextRaw가 파싱 불가면 candidate 단계에서 막힌다', () => {
    const { r, c } = AW({ contextRaw: '{ not json' });
    expect(r.errors.join('|')).toMatch(/CANDIDATE_CONTEXT_REQUIRED/);
    expect(r.calls).toEqual({ candidate: 1, conformance: 0, artifacts: 0, evidence: 1 });
    expect(c.write).toBe(0);
  });
  it('내부 validator 예외/비배열도 fail-closed (write 0회)', () => {
    // 빈 spec은 이제 evidence 게이트가 **먼저** 막는다(계약이 없다는 사실 자체가 실패다).
    // 어느 단계가 막든 write는 0회여야 한다 — 그게 이 테스트의 불변식이다.
    const { r, c } = AW({ spec: {} });
    expect(r.errors.join('|')).toMatch(/APPROVE_VALIDATOR_THREW|APPROVE_VALIDATOR_NONARRAY|EVIDENCE/);
    expect(c.write).toBe(0);
    expect(c.serialize).toBe(0);
    expect(r.wrote).toBe(false);
  });
  it('serialize/write 미주입은 APPROVE_IO_REQUIRED', () => {
    const r = EV.approveAndWrite({ fixture: unitFixture(), spec: UNIT_SPEC, contrastResults: [] });
    expect(r.errors).toEqual(['APPROVE_IO_REQUIRED']); expect(r.wrote).toBe(false);
  });
  it('보조 lint: 기본 실행은 staging에만 쓰고 committed 승격은 atomic rename', () => {
    // 행동 증거는 위 approveAndWrite 테스트들이고, 이건 보조 lint다.
    const src = readFileSync(new URL('../scripts/s4-gen.mjs', import.meta.url), 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).toMatch(/EV\.approveAndWrite\(/);
    // 승인 단계 validator를 개별 호출하지 않는다(승격 단계의 committed 검증은 예외로 허용)
    for (const fn of ['validateCounts', 'validateSmokeCoverage', 'validateMaskContract', 'validateContrastReference', 'validateCandidate', 'validateCandidateArtifacts'])
      expect(code).not.toMatch(new RegExp(`EV\\.${fn}\\(`));
    // **generator는 committed를 쓰지 않는다.** 승격 sink는 s4-promote-capture 하나뿐이다.
    expect(code).not.toMatch(/writeFileSync\([^)]*s4-expected\.json/);
    expect(code).not.toMatch(/PROMOTE_IO\.stageBytes\(/);
    expect(code).not.toMatch(/PROMOTE_IO\.promoteStaged\(/);
    expect(code).not.toMatch(/--promote/);
    expect(code).toContain('s4-promote-capture.mjs');
  });
  it('실제 산출물 바이트 불변 — generator RED 실행이 fixture를 건드리지 않는다', () => {
    const f = new URL('./__fixtures__/s4-expected.json', import.meta.url);
    const before = createHash('sha256').update(readFileSync(f)).digest('hex');
    const r = execSync('node scripts/s4-gen.mjs; echo "exit=$?"',
      { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(r).toMatch(/exit=1/);
    expect(createHash('sha256').update(readFileSync(f)).digest('hex')).toBe(before);
  });
});

describe('S4 공용 경로 clean baseline + 한 축 변이', () => {
  const conform = (fx, spec, decls, map) => EV.evaluateConformance(
    decls || UNIT_DECLS, '', {}, spec || UNIT_SPEC, fx, map || UNIT_ACTUAL_ALLOW_MAP, UNIT_BASE_DECLS);
  it('GREEN: 완결된 UNIT 입력은 evaluateConformance가 정확히 []', () =>
    expect(conform(unitFixture())).toEqual([]));
  it('RED: 마스크 정본 한 축 변이(ID 4 삭제)', () => {
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { ...UNIT_SPEC.LIGHT_DIFF_MASKS } }; delete spec.LIGHT_DIFF_MASKS[4];
    expect(conform(unitFixture(), spec).join('|')).toMatch(/MASK_ID_UNCLASSIFIED 4/);
  });
  it('RED: smoke 한 축 변이(capture 집합 불일치)', () => {
    const fx = unitFixture(); fx.smoke.captures.pop();
    expect(conform(fx).join('|')).toMatch(/SMOKE_CAPTURE_SET_MISMATCH/);
  });
  it('RED: residual 한 축 변이', () => {
    const fx = unitFixture(); fx.residual = [{ x: 1 }];
    expect(conform(fx).join('|')).toMatch(/RESIDUAL_MISMATCH/);
  });
});

describe('S4 contrast — dead 우회 폐쇄', () => {
  it('RED: case에 dead:true가 있으면 거부되고 실패도 함께 보고된다', () => {
    const spec = { ...UNIT_SPEC, CONTRAST_CASES: [
      { name: 'unit-1to1', text: '--u-fg', min: 4.5, dead: true, stack: [{ token: '--u-bg' }] }] };
    const vals = { '--u-fg': '#808080', '--u-bg': '#808080' };   // 대비 1:1
    const r = EV.evaluateContrastCases(spec.CONTRAST_CASES, vals);
    expect(r.errors.join('|')).toMatch(/CONTRAST_DEAD_FORBIDDEN unit-1to1/);
    expect(r.errors.join('|')).toMatch(/CONTRAST_FAIL unit-1to1/);
    expect(r.results[0].pass).toBe(false);
  });
  it('정본에 dead 필드가 남아 있지 않다', () =>
    expect(SPEC.CONTRAST_CASES.some((c) => 'dead' in c)).toBe(false));
});

describe('S4 fixture ↔ 실제 선언 결속', () => {
  // 표기(file/property)만 분리하고 실체와 결속하지 않으면, changed·allowIdToKey의 property를
  // 함께 바꿔치기해도 내부 일관이라 conformance가 clean이었다(리뷰 실증).
  const conform = (fx, decls, map) => EV.evaluateConformance(decls || UNIT_DECLS, '', {}, UNIT_SPEC, fx,
    map || UNIT_ACTUAL_ALLOW_MAP, UNIT_BASE_DECLS).join('|');
  it('GREEN: 정상 결속', () => expect(conform(unitFixture())).toBe(''));
  it('RED: changed·allowIdToKey의 property를 함께 변조(box-shadow → background)', () => {
    const wrong = 'unit-settings.scss||.UnitRing|background|0';
    const fx = unitFixture();
    fx.changed[1].key = wrong; fx.allowIdToKey[4] = wrong;
    expect(conform(fx, UNIT_DECLS, new Map([[1, UNIT_DECLS[0].key], [4, wrong]])))
      .toMatch(/CHANGED_KEY_NOT_IN_ACTUAL|ALLOW_KEY_NOT_IN_ACTUAL/);
  });
  it('RED: actual declaration 삭제', () =>
    expect(conform(unitFixture(), [UNIT_DECLS[0]])).toMatch(/CHANGED_KEY_NOT_IN_ACTUAL/));
  it('RED: changed.selector 단독 변조 (canonical key 재계산이 선점 검출)', () => {
    const fx = unitFixture(); fx.changed[1].selector = '.Other';
    expect(conform(fx)).toMatch(/CHANGED_KEY_NONCANONICAL|CHANGED_VS_ACTUAL/);
  });
});

describe('S4 contrast 참고치 집합 계약', () => {
  // result는 min·pass까지 case와 정합해야 한다(메타데이터 결속).
  const res = () => SPEC.CONTRAST_CASES.map((c) => ({ name: c.name, ratio: SPEC.CONTRAST_REFERENCE[c.name],
    min: c.min, pass: SPEC.CONTRAST_REFERENCE[c.name] >= c.min }));
  it('GREEN: 정본 case ↔ reference 이름 집합 exact', () =>
    expect(EV.validateContrastReference(SPEC.CONTRAST_CASES, SPEC.CONTRAST_REFERENCE, res())).toEqual([]));
  it('RED: case 1개 삭제', () => expect(EV.validateContrastReference(SPEC.CONTRAST_CASES.slice(1), SPEC.CONTRAST_REFERENCE, res().slice(1)).join('|'))
    .toMatch(/CONTRAST_REFERENCE_SET_MISMATCH/));
  it('RED: reference 1개 삭제', () => {
    const r = { ...SPEC.CONTRAST_REFERENCE }; delete r['TrackTree GroupKey hover'];
    expect(EV.validateContrastReference(SPEC.CONTRAST_CASES, r, res()).join('|')).toMatch(/CONTRAST_REFERENCE_SET_MISMATCH/);
  });
  it('RED: case 이름 중복', () => {
    const cs = [...SPEC.CONTRAST_CASES, SPEC.CONTRAST_CASES[0]];
    expect(EV.validateContrastReference(cs, SPEC.CONTRAST_REFERENCE, res()).join('|')).toMatch(/CONTRAST_CASE_NAME_DUP/);
  });
  it('RED: 결과 누락', () => expect(EV.validateContrastReference(SPEC.CONTRAST_CASES, SPEC.CONTRAST_REFERENCE, res().slice(1)).join('|'))
    .toMatch(/CONTRAST_RESULT_MISSING/));
  it('참고치가 fingerprint에 포함된다', () => {
    const mut = { ...SPEC, CONTRAST_REFERENCE: { ...SPEC.CONTRAST_REFERENCE, 'TrackTree GroupKey hover': 9.999 } };
    expect(EV.specFingerprint(mut, sha256)).not.toBe(EV.specFingerprint(SPEC, sha256));
  });
});

describe('S4 allow ID 타입·형식', () => {
  const C = () => UNIT_SPEC.COUNTS;
  it('RED: changed allowIds에 "04" 문자열', () => {
    const fx = unitFixture(); fx.changed[1].allowIds = ['04'];
    expect(EV.validateCounts(fx, C(), UNIT_SPEC).join('|')).toMatch(/ALLOW_ID_TYPE changed "04"/);
  });
  it('RED: allowIdToKey 키가 "04"', () => {
    const fx = unitFixture(); fx.allowIdToKey = { 1: fx.allowIdToKey[1], '04': fx.allowIdToKey[4] };
    expect(EV.validateCounts(fx, C(), UNIT_SPEC).join('|')).toMatch(/ALLOW_ID_KEY allowIdToKey "04"/);
  });
  it('RED: 비정수 ID', () => {
    const fx = unitFixture(); fx.changed[1].allowIds = [4.5];
    expect(EV.validateCounts(fx, C(), UNIT_SPEC).join('|')).toMatch(/ALLOW_ID_TYPE changed 4\.5/);
  });
  it('RED: mask 키가 "04"', () => {
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { 1: UNIT_SPEC.LIGHT_DIFF_MASKS[1], '04': UNIT_SPEC.LIGHT_DIFF_MASKS[4] } };
    expect(EV.validateCounts(unitFixture(), C(), spec).join('|')).toMatch(/ALLOW_ID_KEY LIGHT_DIFF_MASKS "04"/);
  });
});

describe('S4 선언 결속 — actual key canonical·changed 전체 schema·base 대조', () => {
  const conform = (over = {}) => EV.evaluateConformance(
    over.decls || UNIT_DECLS, '', {}, UNIT_SPEC, over.fx || unitFixture(),
    over.map || UNIT_ACTUAL_ALLOW_MAP, 'base' in over ? over.base : UNIT_BASE_DECLS).join('|');
  it('GREEN: 정상', () => expect(conform()).toBe(''));
  it('RED: actual declaration의 file만 변조 → key가 canonical과 불일치', () => {
    const decls = JSON.parse(JSON.stringify(UNIT_DECLS)); decls[1].file = 'evil.scss';
    expect(conform({ decls })).toMatch(/DECL_KEY_NONCANONICAL/);
  });
  it('RED: actual declaration의 atRules만 변조', () => {
    const decls = JSON.parse(JSON.stringify(UNIT_DECLS)); decls[1].atRules = ['@media x'];
    expect(conform({ decls })).toMatch(/DECL_KEY_NONCANONICAL/);
  });
  it('RED: actual declaration의 occurrence만 변조', () => {
    const decls = JSON.parse(JSON.stringify(UNIT_DECLS)); decls[1].declarationOccurrence = 8;
    expect(conform({ decls })).toMatch(/DECL_KEY_NONCANONICAL/);
  });
  it('RED: actual key 중복', () => {
    const decls = [...UNIT_DECLS, { ...UNIT_DECLS[0] }];
    expect(conform({ decls })).toMatch(/DECL_KEY_DUP/);
  });
  for (const f of ['file', 'property', 'declarationOccurrence']) {
    it(`RED: changed.${f} 단독 변조`, () => {
      const fx = unitFixture(); fx.changed[1][f] = f === 'declarationOccurrence' ? 7 : 'zz';
      expect(conform({ fx })).toMatch(/CHANGED_KEY_NONCANONICAL|CHANGED_VS_ACTUAL/);
    });
  }
  for (const [f, v] of [['after', 'zz'], ['afterImportant', true]]) {
    it(`RED: changed.${f} 단독 변조 (actual 대조)`, () => {
      const fx = unitFixture(); fx.changed[1][f] = v;
      expect(conform({ fx })).toMatch(new RegExp(`CHANGED_VS_ACTUAL .* ${f}`));
    });
  }
  for (const [f, v] of [['before', 'zz'], ['beforeImportant', true]]) {
    it(`RED: changed.${f} 단독 변조 (base 대조)`, () => {
      const fx = unitFixture(); fx.changed[1][f] = v;
      expect(conform({ fx })).toMatch(new RegExp(`CHANGED_VS_BASE .* ${f}`));
    });
  }
  it('RED: changed schema 필드 누락', () => {
    const fx = unitFixture(); delete fx.changed[1].beforeImportant;
    expect(conform({ fx })).toMatch(/CHANGED_SCHEMA_MISSING/);
  });
  it('RED: baseDecls 미전달은 fail-closed', () => expect(conform({ base: undefined })).toMatch(/BASE_DECLS_REQUIRED/));
  it('RED: actual·fixture·expected·map 동시 변이도 base 대조로 잡힌다', () => {
    // 모든 "after" 축을 일관되게 바꿔도 BASE는 못 바꾸므로 before 대조가 남는다.
    const decls = JSON.parse(JSON.stringify(UNIT_DECLS)); decls[1].value = 'HACKED';
    const fx = unitFixture(); fx.changed[1].after = 'HACKED';
    fx.expectedAfter[1].value = 'HACKED';
    expect(conform({ decls, fx })).toBe('');            // after 축만 보면 통과
    fx.changed[1].before = 'HACKED';                     // before까지 위조하면 base가 잡는다
    expect(conform({ decls, fx })).toMatch(/CHANGED_VS_BASE .* before/);
  });
});

describe('S4 contrast 숫자·스키마 fail-closed', () => {
  const vals = { '--a': '#000000', '--b': '#ffffff' };
  it('RED: min 누락', () => {
    const r = EV.evaluateContrastCases([{ name: 'n', text: '--a', stack: [{ token: '--b' }] }], vals);
    expect(r.errors.join('|')).toMatch(/CONTRAST_MIN_INVALID/);
  });
  it('RED: min <= 1', () => {
    const r = EV.evaluateContrastCases([{ name: 'n', text: '--a', min: 1, stack: [{ token: '--b' }] }], vals);
    expect(r.errors.join('|')).toMatch(/CONTRAST_MIN_INVALID/);
  });
  it('RED: mix.pct 누락/범위 초과', () => {
    for (const pct of [undefined, -1, 101, NaN]) {
      const r = EV.evaluateContrastCases([{ name: 'n', text: '--a', min: 4.5, stack: [{ token: '--b' }, { mix: '--a', pct }] }], vals);
      expect(r.errors.join('|')).toMatch(/CONTRAST_PCT_INVALID|CONTRAST_BASE/);
    }
  });
  it('RED: result ratio가 NaN/문자열/undefined면 드리프트 검사가 사라지지 않는다', () => {
    for (const ratio of [NaN, '6', undefined, Infinity]) {
      expect(EV.validateContrastReference([{ name: 'z' }], { z: 6 }, [{ name: 'z', ratio }]).join('|'))
        .toMatch(/CONTRAST_RESULT_RATIO_INVALID/);
    }
  });
  it('RED: reference 값이 비수치', () => expect(EV.validateContrastReference([{ name: 'z' }], { z: NaN }, [{ name: 'z', ratio: 6 }]).join('|'))
    .toMatch(/CONTRAST_REFERENCE_INVALID/));
  it('RED: tolerance가 비수치', () => expect(EV.validateContrastReference([{ name: 'z' }], { z: 6 }, [{ name: 'z', ratio: 6 }], NaN).join('|'))
    .toMatch(/CONTRAST_TOL_INVALID/));
});

describe('S4 candidate 승인 경로 — context 필수 + 축별 mutation', () => {
  const ok = () => ({ fixture: unitFixture(), spec: UNIT_SPEC, context: unitCtx(), contrastResults: [] });
  it('GREEN: 정상 candidate', () => expect(EV.validateCandidate(ok())).toEqual([]));
  it('RED: context 생략', () => expect(EV.validateCandidate({ ...ok(), context: undefined }).join('|')).toMatch(/CANDIDATE_CONTEXT_REQUIRED/));
  it('RED: context가 배열', () => expect(EV.validateCandidate({ ...ok(), context: [] }).join('|')).toMatch(/CANDIDATE_CONTEXT_REQUIRED/));
  it('RED: contrastResults 생략', () => expect(EV.validateCandidate({ ...ok(), contrastResults: undefined }).join('|')).toMatch(/CANDIDATE_CONTRAST_RESULTS_REQUIRED/));
  it('RED: counts 축', () => { const a = ok(); a.fixture.counts.changed = 9;
    expect(EV.validateCandidate(a).join('|')).toMatch(/changed 9!=2/); });
  it('RED: mask 축', () => { const a = ok(); delete a.context.baseLightMaskRects['unit-a'];
    expect(EV.validateCandidate(a).join('|')).toMatch(/MASK_SURFACE_NOT_SCANNED/); });
  it('RED: contrast 축', () => { const a = ok();
    a.spec = { ...UNIT_SPEC, CONTRAST_CASES: [{ name: 'q', min: 4.5 }], CONTRAST_REFERENCE: {} };
    expect(EV.validateCandidate(a).join('|')).toMatch(/CONTRAST_REFERENCE_SET_MISMATCH/); });
});

describe('S4 contrast result 메타데이터 결속', () => {
  const cases = [{ name: 'z', text: '--a', min: 4.5, stack: [{ token: '--b' }] }];
  const ref = { z: 6 };
  it('GREEN: min·pass가 case와 계산 결과에 일치', () =>
    expect(EV.validateContrastReference(cases, ref, [{ name: 'z', ratio: 6, min: 4.5, pass: true }])).toEqual([]));
  it('RED: result.min이 case.min과 다름', () =>
    expect(EV.validateContrastReference(cases, ref, [{ name: 'z', ratio: 6, min: 3, pass: true }]).join('|'))
      .toMatch(/CONTRAST_RESULT_MIN_MISMATCH/));
  it('RED: result.pass가 ratio>=min과 다름', () =>
    expect(EV.validateContrastReference(cases, ref, [{ name: 'z', ratio: 6, min: 4.5, pass: false }]).join('|'))
      .toMatch(/CONTRAST_RESULT_PASS_MISMATCH/));
  it('RED: 실패인데 pass:true로 위조', () =>
    expect(EV.validateContrastReference(cases, { z: 2 }, [{ name: 'z', ratio: 2, min: 4.5, pass: true }]).join('|'))
      .toMatch(/CONTRAST_RESULT_PASS_MISMATCH/));
  it('RED: reference ratio가 1..21 밖', () => {
    for (const v of [0.5, 22, -3])
      expect(EV.validateContrastReference(cases, { z: v }, [{ name: 'z', ratio: 6, min: 4.5, pass: true }]).join('|'))
        .toMatch(/CONTRAST_REFERENCE_INVALID/);
  });
  it('RED: tolerance 상한 0.3 초과', () =>
    expect(EV.validateContrastReference(cases, ref, [{ name: 'z', ratio: 6, min: 4.5, pass: true }], 0.5).join('|'))
      .toMatch(/CONTRAST_TOL_INVALID 0\.5/));
  it('정본 결과도 메타데이터까지 정합', () => {
    const res = SPEC.CONTRAST_CASES.map((c) => ({ name: c.name, ratio: SPEC.CONTRAST_REFERENCE[c.name],
      min: c.min, pass: SPEC.CONTRAST_REFERENCE[c.name] >= c.min }));
    expect(EV.validateContrastReference(SPEC.CONTRAST_CASES, SPEC.CONTRAST_REFERENCE, res)).toEqual([]);
  });
});

describe('S4 case.min 독립 검증', () => {
  const res = (min, pass) => [{ name: 'z', ratio: 6, min, pass }];
  it('RED: min undefined + result를 맞춰 넣어도 통과하지 않는다', () =>
    expect(EV.validateContrastReference([{ name: 'z', min: undefined }], { z: 6 }, res(undefined, false)).join('|'))
      .toMatch(/CONTRAST_CASE_MIN_INVALID/));
  it('RED: min <= 1 / min > 21 / 비수치', () => {
    for (const m of [1, 0, 25, '4.5', NaN])
      expect(EV.validateContrastReference([{ name: 'z', min: m }], { z: 6 }, res(m, 6 >= m)).join('|'))
        .toMatch(/CONTRAST_CASE_MIN_INVALID/);
  });
  it('GREEN: 정본 case 전부 유효 범위', () => {
    for (const c of SPEC.CONTRAST_CASES) {
      expect(typeof c.min).toBe('number');
      expect(c.min > 1 && c.min <= 21).toBe(true);
    }
  });
});

describe('S4 커밋 산출물 게이트 — 실제 fixture 원문·context 원문·PNG 바이트', () => {
  // **release가 없으면 이 게이트는 검증할 대상이 없다.** legacy 파일로 대신 통과시키지 않고
  // 아래 테스트들을 명시적으로 skip한다 — 첫 승격 이후 자동으로 살아난다.
  // **non-skip.** 실제 FIXTURES_DIR의 release 상태가 fail이면 여기서 RED다 — 건너뛰지 않는다.
  it('release 상태는 fail-closed다 — 깨진 release는 skip이 아니라 RED', () => {
    expect(RELEASE_STATE.mode === 'fail' ? RELEASE_STATE.errors : []).toEqual([]);
    expect(['skip', 'run']).toContain(RELEASE_STATE.mode);
    if (RELEASE_STATE.mode === 'run')
      expect(Object.keys(committedRelease()).sort()).toEqual(['dark', 'expectedSha', 'light']);
  });
  // **release bundle reader 기준**. legacy 직접 읽기를 쓰지 않는다.
  const BUNDLE = () => committedBundle('light');
  const fixRaw = () => { const b = BUNDLE(); return b.absent ? null : b.fixtureRaw; };
  const ctxRaw = () => { const b = BUNDLE(); return b.absent ? null : b.contextRaw; };
  const readPng = (name) => { const b = BUNDLE(); return b.absent ? null : b.readPng(name); };
  // 실제 BASE 3파일을 컴파일해 선언을 얻는다 — baseDecls=[] 로는 canonical/dup 검사가 공허하다.
  const realBaseDecls = sharedBaseDecls;
  const run = (over = {}) => EV.validateCommittedArtifacts({
    committedFixtureRaw: 'committedFixtureRaw' in over ? over.committedFixtureRaw : fixRaw(),
    spec: over.spec || SPEC,
    contextRaw: 'contextRaw' in over ? over.contextRaw : ctxRaw(),
    sha256, readPng: over.readPng || readPng,
    baseDecls: 'baseDecls' in over ? over.baseDecls : BASE_DECLS,
    provenanceRefs: 'provenanceRefs' in over ? over.provenanceRefs : REAL_REFS(),
  });
  const BASE_DECLS = realBaseDecls();
  // **정본 provenance를 계보로 결속한다.** `unit/{}/unit` 자리표시자는 provenance 계약을
  // 무력화하고, "기록 headCommit === 지금 HEAD"는 artifact-only commit 직후부터 영구 RED가
  // 된다(실증). 캡처 시점 commit을 계보(실재·ancestor·capture blob·현재 blob)로 검증한 뒤
  // **그 시점 값**을 기준으로 쓴다.
  let REFS_MEMO = null;
  const REAL_REFS = () => {
    if (REFS_MEMO) return REFS_MEMO;
    const pv = JSON.parse(ctxRaw()).provenance || {};
    REFS_MEMO = { headCommit: pv.headCommit, headBlobs: pv.blobs || {},
      specFingerprintNow: EV.specFingerprint(EV.snapshotSpec(SPEC).spec, sha256),
      lineage: PROM.provenanceLineage({ repoDir: REPO, captureCommit: pv.headCommit, recordedBlobs: pv.blobs }) };
    return REFS_MEMO;
  };
  it.skipIf(!HAS_RELEASE)('capture commit 계보가 성립한다 — 실재·ancestor·capture blob·현재 blob', () => {
    expect(REAL_REFS().lineage.errors).toEqual([]);
    expect(REAL_REFS().lineage.ok).toBe(true);
  });
  const mutFx = (f) => { const o = JSON.parse(fixRaw()); f(o); return JSON.stringify(o); };
  const mutCtx = (f) => { const o = JSON.parse(ctxRaw()); f(o); return JSON.stringify(o); };

  // **두 phase 모두** 연다. 이전 판은 light만 봐서 dark version이 통째로 사라져도 GREEN이었다(실증).
  it.skipIf(!HAS_RELEASE)('light·dark 양쪽 version이 checked reader로 열린다', () => {
    const want = SPEC.REQUIRED_SMOKE_SURFACES.map((x) => x.captureName).sort();
    const rel = committedRelease();
    for (const ph of ['light', 'dark']) {
      const b = PROM.readCaptureBundle(FIXTURES_DIR, ph);
      expect(b.errors, ph).toEqual([]);
      expect(Object.keys(b.pngByName).sort(), ph).toEqual(want);
      expect(b.digest, ph).toBe(rel[ph]);
      const ctx = JSON.parse(b.contextRaw);
      expect(ctx.phase, ph).toBe(ph);
      expect(ctx.privacyAudit, ph).toBeTruthy();
    }
    expect(rel.light).not.toBe(rel.dark);
  });
  // **두 phase 모두 validateCaptureBundle 전체를 돌린다.** 이전 판은 게이트에서 이 함수를
  // 한 번도 부르지 않았고(호출 0건), light만 fixture 결속으로 봤다.
  const bundleOf = (ph) => {
    const b = PROM.readCaptureBundle(FIXTURES_DIR, ph);
    return { contextRaw: b.contextRaw, pngByName: b.pngByName };
  };
  const runBundle = (ph, over = {}) => {
    const b = bundleOf(ph);
    return EV.validateCaptureBundle({ spec: SPEC, phase: ph,
      contextRaw: 'contextRaw' in over ? over.contextRaw : b.contextRaw,
      pngByName: over.pngByName || b.pngByName,
      provenanceRefs: over.provenanceRefs || REAL_REFS() });
  };
  const mutBundleCtx = (ph, f) => { const o = JSON.parse(bundleOf(ph).contextRaw); f(o); return JSON.stringify(o); };

  it.skipIf(!HAS_RELEASE)('light·dark 모두 validateCaptureBundle 전체가 GREEN', () => {
    for (const ph of ['light', 'dark']) expect(runBundle(ph), ph).toEqual([]);
  });
  it.skipIf(!HAS_RELEASE)('RED: malformed PNG (양 phase)', () => {
    for (const ph of ['light', 'dark']) {
      const b = bundleOf(ph);
      const n = Object.keys(b.pngByName)[0];
      expect(runBundle(ph, { pngByName: { ...b.pngByName, [n]: Buffer.from('not a png') } }).join('|'), ph)
        .toMatch(/PNG|RASTER/);
    }
  });
  it.skipIf(!HAS_RELEASE)('RED: 잘못된 raster (양 phase)', () => {
    for (const ph of ['light', 'dark']) {
      expect(runBundle(ph, { contextRaw: mutBundleCtx(ph, (o) => { o.viewport = { width: 2880, height: 1800 }; }) }).join('|'), ph)
        .toMatch(/RASTER_CONTEXT_VIEWPORT/);
      expect(runBundle(ph, { contextRaw: mutBundleCtx(ph, (o) => { o.capture = { ...o.capture, dpr: 2 }; }) }).join('|'), ph)
        .toMatch(/RASTER_DPR/);
    }
  });
  it.skipIf(!HAS_RELEASE)('RED: actionLog·coverage·darkReview·dataset·provenance 변조 (양 phase)', () => {
    const first = (o) => Object.keys(o)[0];
    for (const ph of ['light', 'dark']) {
      expect(runBundle(ph, { contextRaw: mutBundleCtx(ph, (o) => { o.actionLog[first(o.actionLog)] = []; }) }).join('|'), `${ph} actionLog`)
        .toMatch(/ACTION|LOG/);
      expect(runBundle(ph, { contextRaw: mutBundleCtx(ph, (o) => { o.coverageEvidence = {}; }) }).join('|'), `${ph} coverage`)
        .toMatch(/COVERAGE|SURFACE/);
      expect(runBundle(ph, { contextRaw: mutBundleCtx(ph, (o) => { o.datasetResponses = []; }) }).join('|'), `${ph} dataset`)
        .toMatch(/DATASET/);
      expect(runBundle(ph, { provenanceRefs: { ...REAL_REFS(), headCommit: 'f'.repeat(40) } }).join('|'), `${ph} provenance`)
        .toMatch(/EVIDENCE_PROVENANCE_HEAD/);
      expect(runBundle(ph, { contextRaw: mutBundleCtx(ph, (o) => { o.privacyAudit = undefined; }) }).join('|'), `${ph} privacy`)
        .toMatch(/PRIVACY_AUDIT/);
    }
    // darkReview는 dark 산출물에만 있는 축이다.
    expect(runBundle('dark', { contextRaw: mutBundleCtx('dark', (o) => { o.darkReview = {}; }) }).join('|'))
      .toMatch(/DARK_REVIEW|SURFACE/);
  });

  it.skipIf(!HAS_RELEASE)('dark raster·privacy도 정본과 대조된다', () => {
    const b = PROM.readCaptureBundle(FIXTURES_DIR, 'dark');
    const ctx = JSON.parse(b.contextRaw);
    expect(ctx.viewport).toEqual({ width: SPEC.RASTER_CONTRACT.width, height: SPEC.RASTER_CONTRACT.height });
    expect(ctx.capture).toMatchObject({ dpr: SPEC.RASTER_CONTRACT.dpr, scale: SPEC.RASTER_CONTRACT.screenshotScale });
    const { privacyAudit, ...subject } = ctx;
    expect(EV.validatePrivacyAudit(privacyAudit, {
      captures: SPEC.REQUIRED_SMOKE_SURFACES.map((x) => ({ captureName: x.captureName, sha256: sha256(b.pngByName[x.captureName]) })),
      contextSubjectSha256: sha256(JSON.stringify(CANON.canonicalize(subject))) })).toEqual([]);
  });
  it.skipIf(!HAS_RELEASE)('실제 BASE 선언이 비어 있지 않고 canonical·중복 0', () => {
    expect(BASE_DECLS.length).toBeGreaterThan(2000);
    for (const d of BASE_DECLS) expect(d.key).toBe(EV.declarationKey(d));
    expect(new Set(BASE_DECLS.map((d) => d.key)).size).toBe(BASE_DECLS.length);
  });
  it.skipIf(!HAS_RELEASE)('IO 미주입은 fail-closed', () =>
    expect(EV.validateCommittedArtifacts({ committedFixtureRaw: fixRaw(), spec: SPEC, contextRaw: ctxRaw() }))
      .toEqual(['ARTIFACTS_IO_REQUIRED']));
  it.skipIf(!HAS_RELEASE)('fixture 원문 미전달·파싱 불가는 fail-closed', () => {
    expect(EV.validateCommittedArtifacts({ spec: SPEC, contextRaw: ctxRaw(), sha256, readPng, baseDecls: BASE_DECLS , provenanceRefs: { headCommit: 'unit', headBlobs: {}, specFingerprintNow: 'unit' } }))
      .toEqual(['COMMITTED_FIXTURE_RAW_REQUIRED']);
    expect(run({ committedFixtureRaw: '{ nope' })).toEqual(['COMMITTED_FIXTURE_UNPARSEABLE']);
  });
  // **정상 정답은 오류 0이다.** 이전 판은 "지금 산출물은 stale이니 drift가 나야 한다"를
  // 기대값으로 굳혀 두었는데, 그러면 게이트가 통과해야 할 상태를 한 번도 확인하지 않는다.
  // (release 없이도 이 정답이 확인되도록 promotion positive에 non-skip baseline을 두었다.)
  it.skipIf(!HAS_RELEASE)('정상 committed 산출물은 오류 0', () => {
    expect(run()).toEqual([]);
  });
  it.skipIf(!HAS_RELEASE)('fingerprint drift는 검출된다', () => {
    expect(run({ provenanceRefs: { ...REAL_REFS(), specFingerprintNow: 'drifted' } }).join('|'))
      .toMatch(/FINGERPRINT/);
  });
  it.skipIf(!HAS_RELEASE)('blob 계약 exact — rel/extra/missing/blob 단독 변조', () => {
    expect(run({ committedFixtureRaw: mutFx((o) => { o.blobs.T.rel = 'evil.scss'; }) }).join('|')).toMatch(/FROZEN_BLOB_REL/);
    expect(run({ committedFixtureRaw: mutFx((o) => { o.blobs.EXTRA = { rel: 'x', blob: 'y' }; }) }).join('|')).toMatch(/FROZEN_BLOB_KEYSET/);
    expect(run({ committedFixtureRaw: mutFx((o) => { delete o.blobs.X; }) }).join('|')).toMatch(/FROZEN_BLOB_KEYSET|FROZEN_BLOB_MISSING/);
    expect(run({ committedFixtureRaw: mutFx((o) => { o.blobs.T.blob = 'zz'; }) }).join('|')).toMatch(/FROZEN_BLOB_SHA/);
  });
  it.skipIf(!HAS_RELEASE)('BASE 선언 계약 — 빈 배열·파일 누락·noncanonical·중복', () => {
    expect(run({ baseDecls: [] }).join('|')).toMatch(/FROZEN_BASE_DECLS_REQUIRED/);
    expect(run({ baseDecls: BASE_DECLS.filter((d) => !d.file.endsWith('tracksIndex.scss')) }).join('|')).toMatch(/FROZEN_BASE_FILE_ABSENT/);
    expect(run({ baseDecls: [{ ...BASE_DECLS[0], key: 'wrong' }, ...BASE_DECLS.slice(1)] }).join('|')).toMatch(/FROZEN_BASE_KEY_NONCANONICAL/);
    expect(run({ baseDecls: [...BASE_DECLS, { ...BASE_DECLS[0] }] }).join('|')).toMatch(/FROZEN_BASE_KEY_DUP/);
  });
  it.skipIf(!HAS_RELEASE)('raster 정본 대조 — context만/PNG만/둘 다/dpr/scale', () => {
    const big = () => pngBytes(2880, 1800);
    expect(run({ contextRaw: mutCtx((o) => { o.viewport = { width: 2880, height: 1800 }; }) }).join('|')).toMatch(/RASTER_CONTEXT_VIEWPORT/);
    expect(run({ readPng: big }).join('|')).toMatch(/RASTER_PNG_SIZE/);
    expect(run({ contextRaw: mutCtx((o) => { o.viewport = { width: 2880, height: 1800 }; }), readPng: big }).join('|')).toMatch(/RASTER_/);
    expect(run({ contextRaw: mutCtx((o) => { o.capture = { ...o.capture, dpr: 2 }; }) }).join('|')).toMatch(/RASTER_DPR/);
    expect(run({ contextRaw: mutCtx((o) => { o.capture = { ...o.capture, scale: 'device' }; }) }).join('|')).toMatch(/RASTER_SCREENSHOT_SCALE/);
  });
  it.skipIf(!HAS_RELEASE)('context 원문 단일 원천 — 임의 필드 추가는 privacy subject 재계산으로 검출', () =>
    expect(run({ contextRaw: mutCtx((o) => { o.__evil = 'x'; }) }).join('|')).toMatch(/PRIVACY_AUDIT_CONTEXT_SUBJECT_DRIFT/));
  it.skipIf(!HAS_RELEASE)('contextRaw 바이트 변조는 해시 drift로 검출', () =>
    expect(run({ contextRaw: `${ctxRaw()} ` }).join('|')).toMatch(/FROZEN_CONTEXT_SHA_DRIFT/));
  it.skipIf(!HAS_RELEASE)('PNG 바이트 drift 검출', () =>
    expect(run({ readPng: () => pngBytes(1440, 900, 7) }).join('|')).toMatch(/FROZEN_PNG_SHA_DRIFT/));
  it.skipIf(!HAS_RELEASE)('privacy audit 부재 검출', () =>
    expect(run({ contextRaw: mutCtx((o) => { delete o.privacyAudit; }) }).join('|')).toMatch(/FROZEN_PRIVACY_AUDIT_MISSING/));
});

// ─────────────────────────────────────────────────────────────────────────────
// 승인 경로 **정상 GREEN 대조군**. 지금까지의 orchestration 테스트는 전부 write 전에
// 실패하는 경로라, validator가 실수로 항상 오류를 내도 스위트가 GREEN일 수 있었다.
// 완결된 독립 UNIT 세계(spec·fixture·context·PNG·baseDecls)로 write까지 실제로 도달시킨다.
// ⚠️ fingerprint/해시는 UNIT_SPEC에서 계산해 넣는다 — 여기서 검증하려는 것은 "경로가 끝까지
//    도는가"이지 프로덕션 값의 정답성이 아니다(그건 committed 게이트가 실 산출물로 본다).
// ─────────────────────────────────────────────────────────────────────────────
// 합성 world에 맞는 **합성 discovery 증거**. approveAndWrite는 evidence preflight를 무조건
// 돌리므로, 계약과 무관한 축(allow 집합·raster·mask)을 시험하려면 그 spec에 정합한 증거가
// 필요하다. production 증거를 끌어다 쓰면 합성 manifest와 어긋나 축이 가려진다.
// digest는 producer와 **같은 식**으로 계산한다: `surface method url status ok xN` 정렬 후 sha256.
const synEvidence = (spec) => {
  // manifest가 없는 spec(고의로 망가뜨린 입력)에는 합성할 것이 없다 — 빈 증거를 준다.
  // 그러면 evidence 게이트가 먼저 fail-closed로 막고, 그것도 정당한 결과다.
  if (!spec || !spec.EXPECTED_DATASET_MANIFEST) return { files: {}, gitBlob: () => null, spec };
  const man = JSON.parse(JSON.stringify(spec.EXPECTED_DATASET_MANIFEST));
  const sc = DS_SC();
  const names = spec.REQUIRED_SMOKE_SURFACES.map((x) => x.name);
  const tuples = [];
  for (const cat of ['dataset', 'ambient', 'dev']) {
    for (const e of man[cat]) {
      const { url } = EV.resolveTemplate(e.urlTemplate, sc);
      const extra = e.observedRequestCount - e.observedSurfaceCount;
      names.slice(0, e.observedSurfaceCount).forEach((n, i) => {
        tuples.push({ surface: n, method: e.method, url, count: i < extra ? 2 : 1 });
      });
    }
  }
  const lines = tuples.map((t) => `${t.surface} ${t.method} ${t.url} 200 ok x${t.count}`).sort();
  const digest = sha256(lines.join('\n'));
  const bySurface = Object.fromEntries(names.map((n) => [n, {}]));
  for (const t of tuples) bySurface[t.surface][`${t.method} ${t.url} 200`] = t.count;
  const paths = spec.PROVENANCE_BLOB_PATHS || SPEC.PROVENANCE_BLOB_PATHS;
  const blobs = Object.fromEntries(paths.map((r, i) => [r, String(i).padStart(40, 'a')]));
  const payload = { mode: 'discovery', eligibleForManifest: true,
    provenance: { headCommit: man.evidence.observedHead, blobs,
      specFingerprint: man.evidence.observedSpecFingerprint, hookVersion: 2, bridgeProtocol: 's4-bridge/2' },
    surfaces: names, surfacesCompleted: names.length, repeats: 1,
    digest, endpoints: lines, bySurface };
  const out = JSON.stringify(payload, null, 1);
  const adapterLog = JSON.stringify(['hello', 'beginAttempt', 'endAttempt', 'shutdown', 'clean-exit']);
  const errText = 'bridge on 10098 — discovery\ndiscovery 완료 — 아무것도 쓰지 않았다.\n';
  const files = { 'runA.out': out, 'runB.out': out, 'runA.err': errText, 'runB.err': errText,
    'runA.code': '0\n', 'runB.code': '0\n', 'runA.adapter.json': adapterLog, 'runB.adapter.json': adapterLog };
  man.evidence = { ...man.evidence, discoveryDigest: digest,
    files: Object.fromEntries(Object.keys(files).map((n) => [n, sha256(files[n])])) };
  // 검수 동결본과 exact 대조되므로 합성 world의 분류도 함께 제공한다.
  const reviewed = {};
  for (const cat of ['dataset', 'ambient', 'dev']) for (const e of man[cat]) reviewed[e.urlTemplate] = cat;
  return { files, gitBlob: (ref, rel) => blobs[rel] ?? null,
    spec: { ...spec, EXPECTED_DATASET_MANIFEST: man, REVIEWED_CLASSIFICATION: reviewed,
      PROVENANCE_BLOB_PATHS: paths,
      DATASET_ENDPOINTS: man.dataset.map((e) => e.urlTemplate) } };
};

const AW_SPEC = {
  ...UNIT_SPEC,
  BASE: 'unitbase',
  FILES: { P: { rel: 'unit.scss', blob: 'blobP' }, R: { rel: 'unit-settings.scss', blob: 'blobR' } },
  // AW 세계는 승인 경로(approveAndWrite)를 보는 곳이고 자체 PNG가 1440x900이다.
  // UNIT 세계(200x200)와 **다른 래스터 계약을 갖는다** — 두 세계가 같은 상수를 공유하면
  // 한쪽 치수를 바꿀 때 다른 쪽이 조용히 따라간다.
  RASTER_CONTRACT: { width: 1440, height: 900, dpr: 1, screenshotScale: 'css' },
};
const AW_PNG = { 'unit-a.png': pngBytes(1440, 900, 1), 'unit-b.png': pngBytes(1440, 900, 2) };
const AW_READ_PNG = (n) => { if (!AW_PNG[n]) throw new Error(`no png ${n}`); return AW_PNG[n]; };
const AW_CTX_RAW = () => {
  // DS_CTX로 시나리오·dataset 응답·일치하는 provenance digest를 얹는다.
  // **subject를 해싱하기 전에** 얹어야 privacyAudit의 contextSubjectSha256이 맞는다.
  const subject = DS_CTX({
    viewport: { width: 1440, height: 900 },
    capture: { type: 'png', scale: 'css', dpr: 1 },
    // 실행기가 남기는 실행 기록. AW 세계의 surface는 actions가 비어 있으므로 로그도 빈 배열이다.
    phase: 'light',                                    // BASE는 라이트 캡처만 허용된다
    coverageEvidence: { 'unit-a': { '.UnitPlain': { count: 1, visible: 1 } },
      'unit-b': { '.UnitRing': { count: 1, visible: 1 } } },
    provenance: { headCommit: 'unit', blobs: {}, specFingerprint: 'unit' },
    actionLog: { 'unit-a': [], 'unit-b': [] },
    baseLightMaskRects: unitCtx().baseLightMaskRects,
  });
  const privacyAudit = {
    scope: 'dedicated-synthetic-account-workspace', contextPass: true,
    contextSubjectSha256: sha256(JSON.stringify(CANON.canonicalize(subject))),
    captures: Object.keys(AW_PNG).sort().map((n) => ({ captureName: n, sha256: sha256(AW_PNG[n]), pass: true, findings: [] })),
  };
  return JSON.stringify({ ...subject, privacyAudit });
};
// evidence preflight가 manifest.evidence의 SHA를 채우므로 spec의 fingerprint가 달라진다.
// fixture와 승인 경로가 **같은 spec**을 봐야 FROZEN_FINGERPRINT_DRIFT가 안 난다.
let __awSe = null;
const AW_SE = () => { if (!__awSe) __awSe = synEvidence(AW_SPEC); return __awSe; };
const AW_FIXTURE = () => {
  const raw = AW_CTX_RAW();
  return { ...unitFixture(),
    base: AW_SPEC.BASE,
    blobs: { P: { rel: 'unit.scss', blob: 'blobP' }, R: { rel: 'unit-settings.scss', blob: 'blobR' } },
    fingerprint: EV.specFingerprint(AW_SE().spec, sha256),
    smoke: { contextSha256: sha256(raw),
      captures: Object.keys(AW_PNG).sort().map((n) => ({ captureName: n, sha256: sha256(AW_PNG[n]) })) } };
};

describe('S4 승인 경로 정상 GREEN — write까지 실제로 도달한다', () => {
  const io = () => { const c = { serialize: 0, write: 0, bytes: [] };
    return { c, serialize: (fx) => { c.serialize++; return EV.serializeFixture(fx); }, write: (b) => { c.write++; c.bytes.push(b); } }; };
  const call = (over = {}) => { const spy = io();
    const se = over.spec ? synEvidence(over.spec) : AW_SE();
    const r = EV.approveAndWrite({
      fixture: AW_FIXTURE(), contrastResults: [],
      discoveryEvidence: { files: se.files, gitBlob: se.gitBlob },
      actualDecls: UNIT_DECLS, actualRaw: '', preAnnSources: {},
      actualAllowIdToKey: UNIT_ACTUAL_ALLOW_MAP, baseDecls: UNIT_BASE_DECLS,
      provenanceRefs: { headCommit: 'unit', headBlobs: {}, specFingerprintNow: 'unit' },
      contextRaw: AW_CTX_RAW(), sha256, readPng: AW_READ_PNG,
      serialize: spy.serialize, write: spy.write, ...over, spec: se.spec });
    return { r, c: spy.c }; };

  it('errors === [] · calls 3단계 모두 1 · serialize/write 정확히 1회 · 바이트 동일', () => {
    const { r, c } = call();
    expect(r.errors).toEqual([]);
    expect(r.wrote).toBe(true);
    expect(r.calls).toEqual({ candidate: 1, conformance: 1, artifacts: 1, evidence: 1 });
    expect(c.serialize).toBe(1); expect(c.write).toBe(1);
    expect(c.bytes).toHaveLength(1);
    expect(c.bytes[0]).toBe(r.bytes);                       // 검증한 bytes가 그대로 write로 간다
    expect(c.bytes[0]).toBe(EV.serializeFixture(AW_FIXTURE()));
  });
  it('같은 입력으로 validateCommittedArtifacts도 [] (정상 대조군)', () =>
    expect(EV.validateCommittedArtifacts({ committedFixtureRaw: JSON.stringify(AW_FIXTURE()),
      spec: AW_SE().spec, contextRaw: AW_CTX_RAW(), sha256, readPng: AW_READ_PNG, baseDecls: UNIT_BASE_DECLS , provenanceRefs: { headCommit: 'unit', headBlobs: {}, specFingerprintNow: 'unit' } })).toEqual([]));
  // 정상 대조군 위에서 한 축씩 변이 → RED, 그리고 write 0회
  it('RED: fingerprint 변조 → artifacts 단계, write 0회', () => {
    const fx = AW_FIXTURE(); fx.fingerprint = 'z'.repeat(64);
    const { r, c } = call({ fixture: fx });
    expect(r.errors.join('|')).toMatch(/FROZEN_FINGERPRINT_DRIFT/);
    expect(c).toEqual({ serialize: 0, write: 0, bytes: [] });
  });
  it('RED: PNG 바이트 변조 → write 0회', () => {
    const { r, c } = call({ readPng: () => pngBytes(1440, 900, 9) });
    expect(r.errors.join('|')).toMatch(/FROZEN_PNG_SHA_DRIFT/);
    expect(c.write).toBe(0);
  });
  it('RED: contextRaw 바이트 변조 → write 0회', () => {
    const { r, c } = call({ contextRaw: `${AW_CTX_RAW()} ` });
    expect(r.errors.join('|')).toMatch(/FROZEN_CONTEXT_SHA_DRIFT|PRIVACY_AUDIT_CONTEXT_SUBJECT_DRIFT/);
    expect(c.write).toBe(0);
  });
});

describe('S4 raster 계약이 fingerprint에 포함된다', () => {
  const base = () => EV.specFingerprint(SPEC, sha256);
  const mut = (patch) => EV.specFingerprint({ ...SPEC, RASTER_CONTRACT: { ...SPEC.RASTER_CONTRACT, ...patch } }, sha256);
  it('RASTER_CONTRACT 자체가 payload에 있다', () =>
    // undefined를 넣으면 non-plain이라 throw한다 — 키를 아예 빼서 payload 반영만 본다.
    expect(EV.specFingerprint((() => { const { RASTER_CONTRACT, ...rest } = { ...SPEC }; return rest; })(), sha256))
      .not.toBe(base()));
  for (const [field, value] of [['width', 2880], ['height', 1800], ['dpr', 2], ['screenshotScale', 'device']])
    it(`${field} 변이 → fingerprint 변화`, () => expect(mut({ [field]: value })).not.toBe(base()));
});

describe('S4 승격 트랜잭션 — expected 불변 결속과 candidate CAS', () => {
  const REPO = fileURLToPath(new URL('../..', import.meta.url));
  const HEAD_NOW = execSync(`git -C ${fileURLToPath(new URL('../..', import.meta.url))} rev-parse HEAD`,
    { encoding: 'utf8' }).trim();
  // 최소 합성 world: candidate snapshot 두 개 + evidence + spec.
  // production dataset 계약을 만족하는 최소 context — 그래야 postflight/CAS 단계까지 간다.
  const prodResponses = (spec) => {
    const sc = SPEC.SCENARIO_CANON;
    return (spec || SPEC).DATASET_ENDPOINTS.map((t) => {
      const { url } = EV.resolveTemplate(t, sc);
      let body = '{"status":true}';
      if (url === `${sc.apiOrigin}/branches`)
        body = JSON.stringify({ status: true, branches: [{ branch_id: sc.bulkBranchId, branch_name: sc.branchName }] });
      else if (url === `${sc.apiOrigin}/branches/${sc.bulkBranchId}/epics`)
        body = JSON.stringify({ status: true, epics: [{ epic_id: sc.bulkEpicId, epic_name: sc.epicName }] });
      return { url, status: 200, body };
    });
  };
  const synWorld = (extra = {}) => {
    const d = mkdtempSync(join(tmpdir(), 's4-tx-'));
    const png = { 'a.png': Buffer.from('P') };
    const mk = (phase, tag) => {
      const ctx = JSON.stringify({ ...SPEC.SCENARIO_CANON, phase, datasetResponses: prodResponses(), ...tag });
      const e = RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: d, phase, contextRaw: ctx,
        pngByCaptureName: png, expectedCaptureNames: ['a.png'] });
      expect(e).toEqual([]);
      return RUN.readCandidateBundle(d, phase);
    };
    return { d, cands: { light: mk('light', extra.light || {}), dark: mk('dark', extra.dark || {}) } };
  };
  const EVID = () => ({ files: Object.fromEntries(EV.DISCOVERY_EVIDENCE_FILES
    .map((n) => [n, readFileSync(new URL(`./__fixtures__/s4-discovery-evidence/${n}`, import.meta.url), 'utf8')])) });
  const call = (w, over = {}) => PROM.promoteRelease({
    fixturesDir: w.d, spec: SPEC, provenanceRefs: { headCommit: 'a'.repeat(40), headBlobs: {}, specFingerprintNow: 'f' },
    fromRelease: PROM.readRelease(w.d), expectedBytes: '{"canonical":1}',
    candidates: w.cands, discoveryEvidence: EVID(), repoDir: REPO,
    hashedModules: CAP.HASHED_MODULES, startHead: HEAD_NOW, ...over });

  it('fixture를 따로 받지 않는다 — expectedBytes가 유일한 입력이다', () => {
    const src = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function promoteRelease'));
    const sig = fn.slice(0, fn.indexOf(')'));
    expect(sig).not.toMatch(/\bfixture\b/);
    expect(fn).toContain('JSON.parse(expectedBytes)');
  });

  it('expectedBytes가 JSON이 아니면 RED, write 0', () => {
    const w = synWorld();
    try {
      const r = call(w, { expectedBytes: 'not json' });
      expect(r.promoted).toBe(false);
      expect(r.errors.join(' ')).toMatch(/PROMOTE_EXPECTED_BYTES_UNPARSEABLE/);
      expect(PROM.readRelease(w.d)).toBe(null);
    } finally { rmSync(w.d, { recursive: true, force: true }); }
  });

  it('authority 인자 누락은 write 0 — 콜백 주입 지점이 없다', () => {
    const w = synWorld();
    try {
      // **hashedModules·startHead는 파라미터가 아니다.** 넣어도 무시되고, 승격은 자기가
      // 파생한 값으로 authority를 본다(여기 synWorld의 repoDir는 git repo가 아니므로 막힌다).
      for (const over of [{ hashedModules: [] }, { startHead: 'f'.repeat(40) }, {}]) {
        const r = call(w, over);
        expect(r.promoted, JSON.stringify(Object.keys(over))).toBe(false);
        expect(r.errors.length, JSON.stringify(Object.keys(over))).toBeGreaterThan(0);
      }
      expect(PROM.readRelease(w.d)).toBe(null);
      expect(existsSync(join(w.d, 's4-capture', 'expected'))).toBe(false);   // expected도 안 만든다
      // 주입 가능한 postflight/모듈목록/startHead 인자가 없다.
      const src = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
      const fn = src.slice(src.indexOf('export function promoteRelease'));
      const sig = fn.slice(0, fn.indexOf('{'));
      for (const banned of ['postflight', 'hashedModules', 'startHead', 'approveAndWrite'])
        expect(sig, banned).not.toContain(banned);
      expect(fn).toContain('promotionAuthority(repoDir, startHead, pinnedBlobs, allowance)');
      expect(fn).toContain('headBlobBinding(repoDir, HASHED_MODULES)');
      // late authority → version shape 재검증 → lock ownership → pointer write 순서.
      const at = (t) => fn.indexOf(t);
      expect(at('PROMOTE_AUTHORITY_FAILED_LATE')).toBeLessThan(at('PROMOTE_LATE_'));
      expect(at('PROMOTE_LATE_')).toBeLessThan(at('PROMOTE_LOCK_OWNERSHIP_LOST'));
      expect(at('PROMOTE_LOCK_OWNERSHIP_LOST')).toBeLessThan(at('atomicWrite(releasePath(fixturesDir)'));
      // 쓰는 루트는 고정이다.
      expect(fn).toContain('fixturesRootError(repoDir, fixturesDir)');
    } finally { rmSync(w.d, { recursive: true, force: true }); }
  });

  it('candidate snapshot 누락·형태오류는 write 0', () => {
    const w = synWorld();
    try {
      expect(call(w, { candidates: undefined }).errors).toEqual(['PROMOTE_CANDIDATES_REQUIRED']);
      expect(call(w, { candidates: { light: w.cands.light } }).errors.join(' '))
        .toMatch(/PROMOTE_CANDIDATE_SNAPSHOT_INVALID dark/);
      expect(PROM.readRelease(w.d)).toBe(null);
    } finally { rmSync(w.d, { recursive: true, force: true }); }
  });

  it('CAS: fixture 생성 뒤 candidate가 A→B로 교체되면 write 0', () => {
    const w = synWorld();
    try {
      // CLI가 읽은 snapshot은 그대로 두고 디스크의 candidate만 바꾼다.
      RUN.writeCandidate({ expectedCurrentBundleName: RUN.CANDIDATE_CAS_ANY, fixturesDir: w.d, phase: 'light',
        contextRaw: JSON.stringify({ ...SPEC.SCENARIO_CANON, phase: 'light', datasetResponses: prodResponses(), B: 1 }),
        pngByCaptureName: { 'a.png': Buffer.from('P') }, expectedCaptureNames: ['a.png'] });
      const r = call(w);
      expect(r.promoted).toBe(false);
      expect(PROM.readRelease(w.d)).toBe(null);
      // CAS는 lock 안, pointer write 앞에 있다.
      const src = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
      const fn = src.slice(src.indexOf('export function promoteRelease'));
      expect(fn.indexOf('PROMOTE_CANDIDATE_CAS')).toBeGreaterThan(fn.indexOf('withLock(fixturesDir'));
      expect(fn.indexOf('PROMOTE_CANDIDATE_CAS')).toBeLessThan(fn.indexOf('releasePath(fixturesDir)'));
    } finally { rmSync(w.d, { recursive: true, force: true }); }
  });

  it('lock이 잡혀 있으면 write 0이고 남의 lock을 지우지 않는다', () => {
    const w = synWorld();
    try {
      writeFileSync(join(w.d, '.s4-promote.lock'), 'FOREIGN');
      const r = call(w);
      expect(r.promoted).toBe(false);
      expect(readFileSync(join(w.d, '.s4-promote.lock'), 'utf8')).toBe('FOREIGN');
      expect(PROM.readRelease(w.d)).toBe(null);
    } finally { rmSync(w.d, { recursive: true, force: true }); }
  });

  it('expected는 content-addressed 불변 경로에 있고 release가 그것을 고른다', () => {
    const src = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
    expect(src).toContain("export const EXPECTED_DIR = 'expected';");
    expect(src).toContain('export const expectedPath = (fixturesDir, sha256hex)');
    expect(src).toContain('export function readCommittedExpected');
    // 전역 s4-expected.json 직접 write가 정본 경로에서 사라졌다.
    const fn = src.slice(src.indexOf('export function promoteRelease'));
    expect(fn).not.toContain('LEGACY_COMMITTED_NAME');
    // pointer는 expected 검증 **뒤에** 쓴다.
    expect(fn.indexOf('PROMOTE_EXPECTED_TAMPERED')).toBeLessThan(fn.indexOf('releasePath(fixturesDir)'));
  });

  it('release reader는 expectedSha 경로에서 읽고 SHA exact를 확인한다', () => {
    const d = mkdtempSync(join(tmpdir(), 's4-exp-'));
    try {
      expect(PROM.readCommittedExpected(d).errors).toEqual(['EXPECTED_NO_RELEASE']);
      const bytes = '{"x":1}';
      const s = sha256(bytes);
      mkdirSync(join(d, 's4-capture', 'expected'), { recursive: true });
      writeFileSync(join(d, 's4-capture', 'release.json'),
        JSON.stringify({ light: '1'.repeat(64), dark: '2'.repeat(64), expectedSha: s }));
      expect(PROM.readCommittedExpected(d).errors.join(' ')).toMatch(/EXPECTED_ARTIFACT_MISSING/);
      writeFileSync(PROM.expectedPath(d, s), bytes);
      expect(PROM.readCommittedExpected(d)).toMatchObject({ errors: [], bytes, expectedSha: s });
      // 이름은 그대로 두고 내용만 바꾸면 SHA exact에서 잡힌다.
      writeFileSync(PROM.expectedPath(d, s), '{"tampered":1}');
      expect(PROM.readCommittedExpected(d).errors.join(' ')).toMatch(/EXPECTED_SHA_MISMATCH/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('pointer write 실패 시 이전 release+expected가 계속 선택된다', () => {
    const d = mkdtempSync(join(tmpdir(), 's4-ptr-'));
    try {
      const oldBytes = '{"old":1}'; const oldSha = sha256(oldBytes);
      mkdirSync(join(d, 's4-capture', 'expected'), { recursive: true });
      writeFileSync(PROM.expectedPath(d, oldSha), oldBytes);
      writeFileSync(join(d, 's4-capture', 'release.json'),
        JSON.stringify({ light: '3'.repeat(64), dark: '4'.repeat(64), expectedSha: oldSha }));
      // 새 expected가 orphan으로 존재해도 활성 정본은 이전 것이다.
      const newBytes = '{"new":1}'; writeFileSync(PROM.expectedPath(d, sha256(newBytes)), newBytes);
      const got = PROM.readCommittedExpected(d);
      expect(got.errors).toEqual([]);
      expect(got.bytes).toBe(oldBytes);
      expect(got.expectedSha).toBe(oldSha);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('S4 CLI 문법 — s4-gen에 승격 모드가 없다', () => {
  it('인자 없음만 허용된다', () => expect(PROM.parseCliArgs([])).toEqual({ mode: 'stage' }));
  it.each([['--promote', 'a'.repeat(64), '--from', 'b'.repeat(64)], ['--bogus'], ['--promote']])(
    'RED: %s — 승격 모드는 제거됐다', (...argv) => {
      const r = PROM.parseCliArgs(argv.flat());
      expect(r.mode).toBeUndefined();
      expect(r.error).toMatch(/PROMOTE_MODE_REMOVED/);
    });
  it('RED: argv가 배열이 아니면 거부', () => expect(PROM.parseCliArgs('x').error).toBe('ARGV_REQUIRED'));
  it('독립 sink가 제거됐다 — stageBytes/promoteStaged 없음', () => {
    expect(PROM.stageBytes).toBeUndefined();
    expect(PROM.promoteStaged).toBeUndefined();
    const gen = readFileSync(new URL('../scripts/s4-gen.mjs', import.meta.url), 'utf8');
    expect(gen).not.toContain('promoteStaged');
    expect(gen).not.toContain('stageBytes');
    expect(gen).not.toContain("--promote");
    // s4-gen은 committed를 쓰지 않는다.
    expect(gen).not.toContain('COMMITTED_NAME');
    expect(gen).not.toContain("'s4-expected.json'");
  });
});

describe('S4 malformed PNG — 실제 decode만 통과', () => {
  const good = () => { const p = new PNG({ width: 8, height: 5 });
    for (let i = 0; i < p.data.length; i += 4) { p.data[i + 3] = 255; } return PNG.sync.write(p); };
  it('GREEN: 정상 PNG는 바이트에서 치수를 파생', () =>
    // depth/colorType/interlace도 함께 돌려준다 — pixelmatch의 픽셀 해석을 바꿀 수 있는 축들이라
    // validatePngRaster가 이 값들로 계약을 강제한다.
    expect(EV.decodePngHeader(good()))
      .toEqual({ ok: true, width: 8, height: 5, depth: 8, colorType: 6, interlace: false }));
  it('RED: IHDR만 있는 33바이트(헤더 흉내)', () => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(1440, 16); b.writeUInt32BE(900, 20);
    expect(EV.decodePngHeader(b).ok).toBe(false);
    expect(EV.decodePngHeader(b).reason).toMatch(/PNG_DECODE_FAILED/);
  });
  it('RED: CRC 손상', () => { const b = Buffer.from(good()); b[29] ^= 0xff;   // IHDR CRC 영역
    expect(EV.decodePngHeader(b).ok).toBe(false); });
  it('RED: truncation(IEND 제거)', () => { const b = good().slice(0, good().length - 12);
    expect(EV.decodePngHeader(b).ok).toBe(false); });
  it('RED: signature 손상 / 빈 입력', () => {
    const b = Buffer.from(good()); b[1] = 0x00;
    expect(EV.decodePngHeader(b).ok).toBe(false);
    expect(EV.decodePngHeader(Buffer.alloc(0))).toEqual({ ok: false, reason: 'PNG_EMPTY' });
  });
});

describe('S4 lock — 자동 회수 없음(fail-closed)', () => {
  // lock 동작은 promoteRelease 경로에서 계속 검증된다(승격 하드 비활성과 무관한 유일한 경로).
  const png = (f) => s4Png(4, 4, [f, 0, 0]);
  it('lock이 있으면 항상 거부한다 — 시간 기반 회수 없음', () => {
    const d = mkdtempSync(join(tmpdir(), 's4-lock-'));
    try {
      writeFileSync(join(d, '.s4-promote.lock'), 'FOREIGN');
      // 시간 기반 회수가 없다는 것이 계약이다 — lock 파일은 그대로 남는다.
      expect(existsSync(join(d, '.s4-promote.lock'))).toBe(true);
      // 오래된 mtime으로도 탈취되지 않는다(파일은 그대로 남는다)
      utimesSync(join(d, '.s4-promote.lock'), new Date(0), new Date(0));
      expect(existsSync(join(d, '.s4-promote.lock'))).toBe(true);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it('withLock의 시간 기반 회수 코드가 존재하지 않는다', () => {
    // 이전 판은 mtime이 오래되면 stale로 보고 unlink했고, 소유자가 살아 있어도 탈취됐다.
    const src = readFileSync(new URL('./s4Promote.mjs', import.meta.url), 'utf8');
    expect(src).toContain('PROMOTE_LOCK_BUSY');
    // 주석은 그 결함을 **설명**하므로 코드에서만 찾는다.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
    // unlinkSync(lock)은 **자기 lock 해제**(finally)라 정상이다. 금지 대상은 시간 기반 회수뿐이다.
    for (const banned of ['nowMs', 'staleMs', 'mtimeMs', 'atimeMs', 'ctimeMs', 'Date.now'])
      expect(code).not.toContain(banned);
    // 소유권 판정은 **dev/ino**여야 한다 — 이름만 보면 교체된 lock을 우리 것으로 오인한다.
    expect(code).toContain('fstatSync(fd)');
    expect(code).toContain('st.dev}:${st.ino}');
    expect(code).toContain('if (ours) try { unlinkSync(lock)');
    expect(code).toContain('finally');
    void png;
  });
});

describe('S4 PNG corruption을 public 경로에 고정', () => {
  // helper 직접 호출만으로는 artifactsCore가 decoder를 빠뜨려도 GREEN이다.
  // corrupt PNG에 맞춰 fixture capture SHA·privacy subject SHA·context SHA를 **재결속**한 뒤
  // public 경로에서 RASTER_PNG_DECODE가 나오고 단순 hash drift는 0인지 확인한다.
  const CORRUPT = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(CORRUPT, 0);
  CORRUPT.writeUInt32BE(13, 8); CORRUPT.write('IHDR', 12);
  CORRUPT.writeUInt32BE(1440, 16); CORRUPT.writeUInt32BE(900, 20);

  const world = (pngFor) => {
    const pngs = { 'unit-a.png': pngFor('unit-a.png'), 'unit-b.png': pngFor('unit-b.png') };
    const subject = DS_CTX({ viewport: { width: 1440, height: 900 }, capture: { type: 'png', scale: 'css', dpr: 1 },
      phase: 'light',                                    // BASE는 라이트 캡처만 허용된다
    coverageEvidence: { 'unit-a': { '.UnitPlain': { count: 1, visible: 1 } },
      'unit-b': { '.UnitRing': { count: 1, visible: 1 } } },
    provenance: { headCommit: 'unit', blobs: {}, specFingerprint: 'unit' },
    actionLog: { 'unit-a': [], 'unit-b': [] },          // 실행기 기록(이 세계의 surface는 actions가 없다)
      baseLightMaskRects: unitCtx().baseLightMaskRects }, 2);
    const privacyAudit = { scope: 'dedicated-synthetic-account-workspace', contextPass: true,
      contextSubjectSha256: sha256(JSON.stringify(CANON.canonicalize(subject))),
      captures: Object.keys(pngs).sort().map((n) => ({ captureName: n, sha256: sha256(pngs[n]), pass: true, findings: [] })) };
    const contextRaw = JSON.stringify({ ...subject, privacyAudit });
    const fixture = { ...unitFixture(), base: AW_SPEC.BASE,
      blobs: { P: { rel: 'unit.scss', blob: 'blobP' }, R: { rel: 'unit-settings.scss', blob: 'blobR' } },
      fingerprint: EV.specFingerprint(AW_SE().spec, sha256),
      smoke: { contextSha256: sha256(contextRaw),
        captures: Object.keys(pngs).sort().map((n) => ({ captureName: n, sha256: sha256(pngs[n]) })) } };
    return { pngs, contextRaw, fixture, readPng: (n) => pngs[n] };
  };

  it('정상 PNG 세계는 committed 경로가 []', () => {
    const w = world(() => pngBytes(1440, 900, 3));
    expect(EV.validateCommittedArtifacts({ committedFixtureRaw: JSON.stringify(w.fixture), spec: AW_SE().spec,
      contextRaw: w.contextRaw, sha256, readPng: w.readPng, baseDecls: UNIT_BASE_DECLS , provenanceRefs: { headCommit: 'unit', headBlobs: {}, specFingerprintNow: 'unit' } })).toEqual([]);
  });
  it('corrupt PNG + 해시 재결속 → RASTER_PNG_DECODE 이고 SHA drift는 0', () => {
    const w = world(() => CORRUPT);
    const errs = EV.validateCommittedArtifacts({ committedFixtureRaw: JSON.stringify(w.fixture), spec: AW_SE().spec,
      contextRaw: w.contextRaw, sha256, readPng: w.readPng, baseDecls: UNIT_BASE_DECLS , provenanceRefs: { headCommit: 'unit', headBlobs: {}, specFingerprintNow: 'unit' } });
    expect(errs.filter((e) => /RASTER_PNG_DECODE/.test(e)).length).toBe(2);      // 두 capture 모두
    expect(errs.filter((e) => /FROZEN_PNG_SHA_DRIFT/.test(e)).length).toBe(0);   // 해시는 맞춰놨다
  });
  it('같은 corruption에서 approveAndWrite는 write 0회', () => {
    const w = world(() => CORRUPT);
    const c = { serialize: 0, write: 0 };
    const r = EV.approveAndWrite({
      fixture: w.fixture, spec: AW_SE().spec, contrastResults: [],
      discoveryEvidence: { files: AW_SE().files, gitBlob: AW_SE().gitBlob },
      actualDecls: UNIT_DECLS, actualRaw: '', preAnnSources: {},
      actualAllowIdToKey: UNIT_ACTUAL_ALLOW_MAP, baseDecls: UNIT_BASE_DECLS,
      provenanceRefs: { headCommit: 'unit', headBlobs: {}, specFingerprintNow: 'unit' },
      contextRaw: w.contextRaw, sha256, readPng: w.readPng,
      serialize: () => { c.serialize++; return 'B'; }, write: () => { c.write++; } });
    expect(r.errors.join('|')).toMatch(/RASTER_PNG_DECODE/);
    expect(r.wrote).toBe(false);
    expect(c).toEqual({ serialize: 0, write: 0 });
  });
});
