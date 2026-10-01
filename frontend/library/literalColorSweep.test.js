import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Parser as AcornParser } from 'acorn';   // devDep ^8.18.0 — 추가 설치 없음
import acornJsx from 'acorn-jsx';                // devDep ^5.3.2 — 추가 설치 없음
import {
  LITERAL_RE, isNamedColor, isSystemColor, hitsFor, sweepFile, sweepRepo,
  collectSweepTargets, STRUCTURAL_EXCLUSIONS, THIRD_PARTY_EXCLUDED,
  CLASSIFIED_POOL, SWEEP_ROOTS, ROOT,
  isSweepTarget, ROOT_RUNTIME_ENTRYPOINTS, ROOT_RUNTIME_LOCATIONS,
  rootRuntimeCandidates, unsupportedRootEntrypoints,
} from './literalColorSweep.js';
import { COLOR_EXCEPTIONS, THIRD_PARTY_OWNED, PRIOR_SLICE_DEFERRED } from './colorExceptions.js';
import { COLOR_CLASSIFIED } from './colorClassified.js';

const readRepo = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');   // 읽기 전용

// theme-dependent 등록 금지 단정은 S5의 colorExceptions.test.js가 소유한다.
// 여기서는 중복하지 않고 "등록 가능한 7개"(8분류 − theme-dependent)만 인정한다.
const CATEGORIES = new Set([
  'fixed-on-color', 'overlay-scrim', 'print-paper',
  'palette-source', 'stored-color', 'third-party', 'dead',
]);

describe('LITERAL_RE — 형태별 검출력', () => {
  const vals = (text) => [...text.matchAll(new RegExp(LITERAL_RE.source, 'g'))].map((m) => m[0]);

  it('hex 3/6/8자리를 가장 긴 것부터 잡는다', () => {
    expect(vals('a:#fff; b:#16A34A; c:#16A34A20;')).toEqual(['#fff', '#16A34A', '#16A34A20']);
  });

  it('hex 뒤에 한글이 와도 잡는다 (rg의 \\b는 유니코드 인식이라 놓친다 — index 「인벤토리 총계」)', () => {
    expect(vals('--x: #0E0F11; // 배경')).toEqual(['#0E0F11']);
    expect(vals('#5E6AD2브랜드')).toEqual(['#5E6AD2']);
  });

  it('rgb/rgba/hsl/hsla의 숫자 인자형을 통째로 잡는다', () => {
    expect(vals('a:rgb(1, 2, 3); b:rgba(0, 0, 0, 0.5); c:hsl(1, 2%, 3%); d:hsla(1, 2%, 3%, .5);'))
      .toEqual(['rgb(1, 2, 3)', 'rgba(0, 0, 0, 0.5)', 'hsl(1, 2%, 3%)', 'hsla(1, 2%, 3%, .5)']);
  });

  it('토큰 경유 형태는 안 잡는다', () => {
    expect(vals('color: var(--color-text); fill: currentColor; background: rgb(var(--rgb-primary));'))
      .toEqual([]);
  });

  it('data-URI의 %23 인코딩 hex를 잡는다', () => {
    expect(vals("url(\"data:image/svg+xml,%3Csvg fill='%23FF0000'%3E\")")).toEqual(['%23FF0000']);
  });

  // 실측 %23 9건 중 색은 1건, 6건이 %23n(SVG filter id, track.scss:38,2769에 실재),
  // 2건이 %23comments(authRedirect.test.js:40,42). 경계 없는 {3,8}은 이것들을 오검출한다.
  it('%23 뒤가 색이 아니면 안 잡는다', () => {
    expect(vals("url(\"data:image/svg+xml,%3Crect filter='url(%23n)'/%3E\")")).toEqual([]);
    expect(vals('/auth/login?returnTo=%2Fbranch%2F1%3Ftask%3D2%23comments')).toEqual([]);
    expect(vals('%23abcd %23abcde %23abcdefa')).toEqual([]);   // 4·5·7자리는 색이 아니다
  });
});

describe('isNamedColor — jsdom CSSOM 오라클', () => {
  it('CSS named color를 인정한다', () => {
    for (const c of ['white', 'black', 'tan', 'plum', 'rebeccapurple', 'gold'])
      expect(isNamedColor(c), c).toBe(true);
  });
  it('색이 아닌 CSS 키워드를 거부한다', () => {
    for (const c of ['solid', 'none', 'nowrap', 'inherit', 'currentColor', 'transparent',
                     'px', 'Roboto', 'BlinkMacSystemFont', 'notacolor'])
      expect(isNamedColor(c), c).toBe(false);
  });
  // 시스템 색은 명세상 색이지만 **저작된 named color가 아니다** — 이 오라클은 저작된 색만
  // 인정하고, 시스템 색을 색으로 세는 일은 `isSystemColor`가 맡는다(아래 describe).
  it('CSS 시스템 색을 named color로 세지 않는다', () => {
    for (const c of ['background', 'menu', 'window', 'canvas', 'field', 'mark',
                     'highlight', 'graytext', 'buttonface', 'accentcolor', 'linktext'])
      expect(isNamedColor(c), c).toBe(false);
  });
});

// CSS 시스템 색은 **색을 받는 property 안에서만** 색이다. 전부 빼면 `color: CanvasText`·
// `background: Canvas`가 통째로 안 보이고(실측: CSS 선언·HTML `style` 속성·JSX `style` 객체·
// SVG 색 속성 **네 경로 전부** hit 0), 전부 넣으면 `transition: background`가 오탐이 된다.
// 후자를 막는 것은 blanket skip이 **아니라** `propTakesColor`다 — 실측(HEAD `99d1d09`):
// prop 게이트를 끄면 레포 hit 868, 켜면 696이고 그 차 **172건이 전부 `transition : background`**
// 한 종류다(다른 prop·다른 시스템 색 **0건**). 그래서 blanket skip은 오탐을 막는 데 기여하지
// 않으면서 진짜 색만 못 보게 한다.
describe('isSystemColor — CSS 시스템 색은 색 자리에서만 색이다', () => {
  it('닫힌 42개 집합이고 named color 오라클과 겹치지 않는다', () => {
    for (const c of ['CanvasText', 'Canvas', 'ButtonFace', 'LinkText', 'GrayText', 'Background', 'Menu'])
      expect([isSystemColor(c), isNamedColor(c)], c).toEqual([true, false]);
    for (const c of ['white', 'black', 'tan', 'gold', 'solid', 'none', 'px', 'notacolor', '#fff'])
      expect(isSystemColor(c), c).toBe(false);
  });

  it('색 property의 시스템 색은 hit이다 — CSS · HTML style · JSX style · SVG 속성', () => {
    const c = (rel, src) => hitsFor(rel, src).map((h) => [h.prop, h.value]);
    expect(c('styles/components/__synthetic__.scss',
      '.A { color: CanvasText; background: Canvas; border: 1px solid ButtonBorder; }'))
      .toEqual([['color', 'CanvasText'], ['background', 'Canvas'], ['border', 'ButtonBorder']]);
    expect(c('public/__synthetic__.html', '<div style="color:CanvasText;background:Canvas">x</div>'))
      .toEqual([['color', 'CanvasText'], ['background', 'Canvas']]);
    expect(c('components/__synthetic__.jsx', "const A = () => <b style={{ color: 'CanvasText' }} />;"))
      .toEqual([['color', 'CanvasText']]);
    expect(c('public/icons/__synthetic__.svg', '<svg><rect fill="CanvasText"/></svg>'))
      .toEqual([['fill', 'CanvasText']]);
  });

  it('색 자리가 아니면 시스템 색도 hit이 아니다 — 172건을 막는 것은 prop 게이트다', () => {
    expect(hitsFor('styles/components/__synthetic__.scss',
      '.A { transition: background .15s; transition-property: background; will-change: background; }\n'
      + '.B::after { content: "Canvas"; }\n'
      + '.C { animation-name: highlight; mask-image: url(#canvas); }')).toEqual([]);
    expect(hitsFor('public/__synthetic__.html',
      '<div style="transition:background .15s">x</div>')).toEqual([]);
    expect(hitsFor('components/__synthetic__.jsx',
      "const A = () => <b style={{ transition: 'background .15s' }} />;")).toEqual([]);
  });

  // 코퍼스 전건 — `transition`은 색을 받지 않으므로 S5~S8 이행 후에도 영원히 0이다.
  // COLOR_SHORTHANDS에 transition류를 넣거나 propTakesColor를 느슨하게 만들면 여기서 RED가 난다.
  it('코퍼스 전건 — prop이 정확히 transition인 hit은 0건이다(172건 오탐 회귀 차단)', () => {
    const bad = [];
    for (const rel of collectSweepTargets())
      for (const h of hitsFor(rel, readRepo(rel)))
        if (String(h.prop) === 'transition')
          bad.push(`${h.file}:${h.line} | ${h.prop} | ${h.value}`);
    expect(bad, 'transition 선언이 색 hit을 냈다 — prop 게이트가 뚫렸다').toEqual([]);
  });
});

describe('hitsFor — 튜플 추출', () => {
  it('SCSS는 컴파일된 CSS의 (selector, prop, value)를 준다', () => {
    const hits = hitsFor('styles/components/__synthetic__.scss',
      '.A { color: #5E6AD2; .B { border-color: rgba(0,0,0,.5); } }');
    expect(hits.map((h) => [h.selector, h.prop, h.value])).toEqual([
      ['.A', 'color', '#5E6AD2'],
      ['.A .B', 'border-color', 'rgba(0, 0, 0, 0.5)'],   // sass가 rgba를 정규화한다
    ]);
  });

  it('at-rule 조상을 selector 경로에 포함해 미디어쿼리 간 충돌을 막는다', () => {
    const hits = hitsFor('styles/components/__synthetic__.scss',
      '.A { color: #fff; } @media (max-width: 768px) { .A { color: #fff; } }');
    expect(hits.map((h) => h.selector))
      .toEqual(['.A', '@media (max-width: 768px) | .A']);
  });

  it('SCSS/CSS의 named color를 값 위치에서만 잡는다', () => {
    const hits = hitsFor('styles/components/__synthetic__.scss',
      '.A { color: white; border: 2px solid white; font-family: Roboto, sans-serif; display: flex; }');
    expect(hits.map((h) => [h.prop, h.value]))
      .toEqual([['color', 'white'], ['border', 'white']]);
  });

  // named color는 **색을 받을 수 있는 property**에서만 본다. 아래 값들은 색이 아니라서
  // colorExceptions.js의 등록 가능 7분류 중 어디에도 넣을 수 없다 — 잡히면 해소 수단이 없는 RED다.
  it('색 자리가 아닌 property의 named color는 잡지 않는다', () => {
    const src = '.A::after { content: "white"; }\n'
      + '.B { animation-name: red; font-family: Tomato, sans-serif; grid-area: gold; }';
    expect(hitsFor('styles/components/__synthetic__.scss', src)).toEqual([]);
  });

  it('그 제한은 named color에만 걸린다 — hex/rgb는 property와 무관하게 잡는다', () => {
    expect(hitsFor('styles/components/__synthetic__.scss', '.A::after { content: "#ABCDEF"; }')
      .map((h) => [h.prop, h.value])).toEqual([['content', '#ABCDEF']]);
  });

  // 색 자리인 property 안에도 색 자리가 아닌 구간이 있다(url()의 내용 = 파일 이름·fragment id).
  // 반대로 paint 함수의 인자는 진짜 색이라, `border-image`처럼 색을 받는 property가 목록에서
  // 빠지면 그 색을 통째로 놓친다. 세 경로(CSS 선언 · HTML style 속성 · JSX style 객체) 같은 계약이다.
  it('url()·따옴표·주석은 색 자리가 아니고 paint 함수 인자는 색이다 — 세 경로 모두', () => {
    const c = (rel, src) => hitsFor(rel, src).map((h) => [h.prop, h.value]);
    const SYN = 'styles/components/__synthetic__.scss';
    expect(c(SYN, '.A { background-image: url("/icons/white.svg"); mask-image: url(#black); }')).toEqual([]);
    expect(c(SYN, '.A { color: /* white */ red; }')).toEqual([['color', 'red']]);
    expect(c(SYN, '.A { border-image: linear-gradient(red, blue) 1; background: linear-gradient(white, black); }'))
      .toEqual([['border-image', 'red'], ['border-image', 'blue'],
                ['background', 'white'], ['background', 'black']]);
    expect(c('public/__synthetic__.html',
      '<div style=\'background-image:url("/icons/white.svg");border-image:linear-gradient(red, blue) 1\'>x</div>'))
      .toEqual([['border-image', 'red'], ['border-image', 'blue']]);
    expect(c('components/__synthetic__.jsx',
      "const A = () => <b style={{ maskImage: 'url(#black)', background: 'linear-gradient(white, black)' }} />;"))
      .toEqual([['background', 'white'], ['background', 'black']]);
  });

  // 위 게이트는 **escape-aware 스캐너**여야만 성립한다. 한 줄 정규식(`[^)]*`)은 CSS escape를
  // 모르므로 `url(foo\)white.svg)`에서 마스크가 조기 종료돼 `white`가 샌다 — 실측으로 세 경로
  // 전부에서 오탐 1건씩 났다. 반대로 마스킹이 과하면(예: url 토큰을 값 끝까지 먹으면) 뒤따르는
  // gradient의 **진짜 색이 사라진다.** 두 방향을 같은 it에서 함께 못 박는다.
  it('CSS escape를 인식한다 — 마스크가 조기 종료되지도, 값 끝까지 번지지도 않는다', () => {
    const c = (rel, src) => hitsFor(rel, src).map((h) => [h.prop, h.value]);
    const SYN = 'styles/components/__synthetic__.scss';
    const HTM = 'public/__synthetic__.html';
    const JSX = 'components/__synthetic__.jsx';

    // ① escape된 `)`가 url 토큰을 끝내지 않는다 — 세 경로
    expect(c(SYN, String.raw`.A { background-image: url(foo\)white.svg); }`)).toEqual([]);
    expect(c(HTM, String.raw`<div style="background-image:url(foo\)white.svg)">x</div>`)).toEqual([]);
    expect(c(JSX, "const A = () => <b style={{ backgroundImage: 'url(foo\\\\)white.svg)' }} />;")).toEqual([]);
    // escape된 따옴표도 문자열을 끝내지 않는다 — ⚠️ **SCSS 한 줄로는 이 분기를 못 지킨다.**
    //    sass가 `url("a\")white.svg")`를 `url('a\")white.svg')`로 **따옴표를 정규화**해
    //    바깥 구분자가 `'`가 되고 안의 `\"`는 구분자가 아니게 된다(실측: sass.compileString).
    //    그래서 escape 분기를 지워도 SCSS 경로는 그대로 `[]`다 — 살아남는 mutation이 된다.
    //    원문을 그대로 보는 **raw 텍스트 두 경로**(HTML `style` 속성 · JSX `style` 객체)를
    //    함께 적어야 분기가 지켜진다: 지우면 둘 다 `[['background-image','white']]` 오탐(실측).
    expect(c(SYN, String.raw`.A { background-image: url("a\")white.svg"); }`)).toEqual([]);
    expect(c(HTM, String.raw`<div style='background-image:url("a\")white.svg")'>x</div>`)).toEqual([]);
    expect(c(JSX, String.raw`const A = () => <b style={{ backgroundImage: 'url("a\\")white.svg")' }} />;`))
      .toEqual([]);

    // ② 과잉 마스킹 금지 — url 토큰은 첫 닫는 `)`에서 끝나고 뒤의 gradient 색은 살아남는다
    const AFTER_URL = [['background', 'white'], ['background', 'black']];
    expect(c(SYN, '.A { background: url(a.svg) no-repeat, linear-gradient(white, black); }')).toEqual(AFTER_URL);
    expect(c(HTM, '<div style="background:url(a.svg) no-repeat, linear-gradient(white, black)">x</div>')).toEqual(AFTER_URL);
    expect(c(JSX, "const A = () => <b style={{ background: 'url(a.svg) no-repeat, linear-gradient(white, black)' }} />;"))
      .toEqual(AFTER_URL);
    expect(c(SYN, String.raw`.A { background: url(foo\)white.svg), linear-gradient(red, blue); }`))
      .toEqual([['background', 'red'], ['background', 'blue']]);

    // ③ 단일 패스라서 문자열 안의 `/*`도, 주석 안의 따옴표도 서로를 열지 않는다
    expect(c(SYN, `.A { --x: "/* q"; color: red; }`)).toEqual([['color', 'red']]);
    expect(c(SYN, `.A { color: /* it's white */ red; }`)).toEqual([['color', 'red']]);

    // ④ hex는 이 마스킹을 통과하지 않는다 — escape된 url 안의 %23도 그대로 잡힌다
    expect(c(SYN, String.raw`.A { background-image: url(/x/%23ABCDEF\)white.svg); }`))
      .toEqual([['background-image', '%23ABCDEF']]);
    // 주석 게이트가 살아 있는 유일한 경로(JSX 원문 문자열)에서도 hex는 문맥 무관이다
    expect(c(JSX, "const A = () => <b style={{ color: '/* #ABCDEF */ var(--x)' }} />;"))
      .toEqual([['color', '#ABCDEF']]);
    expect(c(JSX, "const A = () => <b style={{ color: '/* white */ var(--x)' }} />;")).toEqual([]);

    // ⑤ `border-image`가 COLOR_SHORTHANDS에서 빠지면 그 색이 통째로 사라진다. 위 it이 CSS·HTML을
    //    보므로 여기서 JSX 몫만 채워, 되돌림 mutation이 세 경로 전부에서 RED가 되게 한다.
    expect(c(JSX, "const A = () => <b style={{ borderImage: 'linear-gradient(red, blue) 1' }} />;"))
      .toEqual([['border-image', 'red'], ['border-image', 'blue']]);
  });

  // 위 it은 `url(`이 **문자 그대로 적혀 있고** 줄바꿈이 LF일 때만 성립한다. CSS는 함수 이름까지
  // escape할 수 있고(`u\72l(`·`\75 rl(`은 둘 다 `url(`이다), 문자열 안의 `\`+줄바꿈은
  // continuation이라 **CRLF를 한 줄바꿈으로 세야** 한다. 셋 다 실측으로 샜다(선재현):
  //   `background-image: u\72l(white.svg)`  → white 오탐 1 (CSS·HTML·JSX)
  //   `background-image: \75 rl(white.svg)` → white 오탐 1 (CSS·HTML·JSX)
  //   `--x: "a\⟨CRLF⟩white"`                → white 오탐 1 (SCSS·CSS·HTML·JSX)
  // ⚠️ **SCSS는 앞의 두 케이스를 못 지킨다** — sass가 `u\72l(`를 `url(`로 **디코드해서** 원문의
  //    결함을 가린다(실측: compileString → `background-image: url(white.svg)`). escape 인식을
  //    지워도 SCSS 경로는 `[]`로 남는 **생존 mutation**이 된다. 그래서 원문을 그대로 보는 세
  //    경로(raw CSS · HTML `style` 속성 · JSX `style` 객체)로 못 박는다. CRLF 케이스는 sass가
  //    원문을 보존하므로 SCSS까지 네 경로 전부 단정한다.
  it('escape된 함수 이름과 줄 continuation도 인식한다 — 마스크가 문자 그대로의 url(에 매이지 않는다', () => {
    const c = (rel, src) => hitsFor(rel, src).map((h) => [h.prop, h.value]);
    const SYN = 'styles/components/__synthetic__.scss';
    const CSS = 'styles/__synthetic__.css';
    const HTM = 'public/__synthetic__.html';
    const JSX = 'components/__synthetic__.jsx';
    const CRLF = '\r\n';   // 원문에 진짜 CR+LF를 넣는다 — 이 케이스의 전부다

    // ① escape된 함수 이름도 url 토큰이다 (`\72`=r, `\75`=u, 종결 공백은 escape의 일부)
    expect(c(CSS, String.raw`.A { background-image: u\72l(white.svg); }`)).toEqual([]);
    expect(c(HTM, String.raw`<div style="background-image:u\72l(white.svg)">x</div>`)).toEqual([]);
    expect(c(JSX, String.raw`const A = () => <b style={{ backgroundImage: 'u\\72l(white.svg)' }} />;`))
      .toEqual([]);
    expect(c(CSS, String.raw`.A { background-image: \75 rl(white.svg); }`)).toEqual([]);
    expect(c(HTM, String.raw`<div style="background-image:\75 rl(white.svg)">x</div>`)).toEqual([]);
    expect(c(JSX, String.raw`const A = () => <b style={{ backgroundImage: '\\75 rl(white.svg)' }} />;`))
      .toEqual([]);

    // ② 그래도 과잉 마스킹은 아니다 — escape된 이름의 url도 첫 `)`에서 끝나고 뒤 색은 살아남는다
    const AFTER_URL = [['background', 'white'], ['background', 'black']];
    expect(c(CSS, String.raw`.A { background: u\72l(a.svg),linear-gradient(white,black); }`))
      .toEqual(AFTER_URL);
    expect(c(HTM, String.raw`<div style="background:\75 rl(a.svg),linear-gradient(white,black)">x</div>`))
      .toEqual(AFTER_URL);
    expect(c(JSX, String.raw`const A = () => <b style={{ background: 'u\\72l(a.svg),linear-gradient(white,black)' }} />;`))
      .toEqual(AFTER_URL);

    // ③ `\` + 줄바꿈은 문자열을 잇는다(continuation). CRLF는 **두 글자가 한 줄바꿈**이라
    //    2글자만 삼키면 남은 LF가 문자열을 끝내 뒤가 샌다 — 네 경로 전부.
    expect(c(SYN, `.A { --x: "a\\${CRLF}white"; }`)).toEqual([]);
    expect(c(CSS, `.A { --x: "a\\${CRLF}white"; }`)).toEqual([]);
    expect(c(HTM, `<div style='--x: "a\\${CRLF}white"'>x</div>`)).toEqual([]);
    expect(c(JSX, String.raw`const A = () => <b style={{ '--x': '"a\\\r\nwhite"' }} />;`)).toEqual([]);
    // CR 단독·FF 단독 continuation도 같은 규칙이다
    expect(c(CSS, `.A { --x: "a\\\rwhite"; }`)).toEqual([]);
    expect(c(CSS, `.A { --x: "a\\\fwhite"; }`)).toEqual([]);

    // ④ 반대로 **escape 없는** 줄바꿈은 문자열을 끝낸다(bad-string) — CSS의 줄바꿈은 LF·CR·FF
    //    셋이므로 CR/FF 뒤의 색은 문자열 밖이라 그대로 잡힌다. ③과 짝이 되어 CRLF 계산을 고정한다.
    //    ⚠️ SCSS는 여기서 **컴파일 자체가 실패**한다(sass: 미종료 문자열) — 세 경로만 본다.
    expect(c(CSS, `.A { --x: "a\rwhite"; }`)).toEqual([['--x', 'white']]);
    expect(c(HTM, `<div style='--x: "a\rwhite"'>x</div>`)).toEqual([['--x', 'white']]);
    expect(c(JSX, String.raw`const A = () => <b style={{ '--x': '"a\fwhite"' }} />;`))
      .toEqual([['--x', 'white']]);

    // ⑤ 경계 — escape를 읽는다고 아무 ident나 url이 되지는 않는다(ident 경계는 그대로다)
    expect(c(CSS, String.raw`.A { background-image: U\52L(white.svg); }`)).toEqual([]);   // 대문자
    expect(c(CSS, String.raw`.A { background-image: myu\72l(white.svg); }`))
      .toEqual([['background-image', 'white']]);                                          // myurl( ≠ url(
    expect(c(CSS, '.A { background-image: 100url(white.svg); }'))
      .toEqual([['background-image', 'white']]);                                          // 숫자 뒤는 dimension
  });

  it('커스텀 property는 색의 원천이므로 언제나 색 자리다', () => {
    expect(hitsFor('styles/components/__synthetic__.scss', '.A { --x: white; --y: #ABCDEF; }')
      .map((h) => [h.prop, h.value])).toEqual([['--x', 'white'], ['--y', '#ABCDEF']]);
  });

  it('style 객체·인라인 style·SVG 속성에도 같은 property 문맥이 적용된다', () => {
    expect(hitsFor('components/__synthetic__.jsx',
      "const A = () => <b style={{ animationName: 'red', color: 'white' }} />;")
      .map((h) => [h.prop, h.value])).toEqual([['color', 'white']]);
    expect(hitsFor('public/__synthetic__.html', '<div style="content:\'white\';color:white">x</div>')
      .map((h) => [h.prop, h.value])).toEqual([['color', 'white']]);
  });

  it('HTML은 <style> 블록을 postcss로, 나머지를 텍스트로 본다', () => {
    const hits = hitsFor('public/__synthetic__.html',
      '<style>.r { background: #6366F1; color: white; }</style><svg><rect fill="#000001"/></svg>');
    expect(hits.map((h) => [h.selector, h.prop, h.value])).toEqual([
      ['.r', 'background', '#6366F1'],
      ['.r', 'color', 'white'],
      [null, 'fill', '#000001'],
    ]);
  });

  it('SVG는 색 속성명을 prop으로 준다', () => {
    const hits = hitsFor('public/icons/__synthetic__.svg',
      '<svg><rect fill="white"/><line stroke="black"/><path d="M1 2 3z" fill="#ABCDEF"/></svg>');
    expect(hits.map((h) => [h.prop, h.value]))
      .toEqual([['fill', 'white'], ['stroke', 'black'], ['fill', '#ABCDEF']]);
  });

  it('JS는 selector=null, prop=값 앞 최근접 식별자다', () => {
    const hits = hitsFor('components/__synthetic__.js',
      "const M = { light: '#FFFFFF', dark: '#0E0F11' };\nconst A = [{ key: 'home', color: '#64748b' }];");
    expect(hits.map((h) => [h.selector, h.prop, h.value])).toEqual([
      [null, 'light', '#FFFFFF'],
      [null, 'dark', '#0E0F11'],
      [null, 'color', '#64748b'],
    ]);
  });

  it('JS 자유 텍스트의 named color는 잡지 않는다 (어휘적 오탐 — 주장 범위 밖)', () => {
    expect(hitsFor('components/__synthetic__.js', "const label = 'white';")).toEqual([]);
  });

  // ── 구조적 소스 2개: 자유 텍스트가 못 잡는 named color를 오탐 없이 잡는다 ──
  it('HTML의 style="…" 인라인 속성을 postcss로 파싱한다', () => {
    const hits = hitsFor('public/__synthetic__.html',
      '<div style="color:white;background:#6366F1">x</div>');
    expect(hits.map((h) => [h.selector, h.prop, h.value])).toEqual([
      ['[style]', 'color', 'white'],
      ['[style]', 'background', '#6366F1'],
    ]);
  });

  it('JSX의 style={{…}} 객체를 AST로 읽는다 — 키는 kebab-case, 값은 조건·기본값·상수 템플릿까지', () => {
    const src = "const A = () => (<div>"
      + "<b style={{ color: 'white', backgroundColor: '#6366F1' }} />"
      + "<i style={{ color: active ? 'white' : 'black' }} />"
      + "<u style={{ color: x || 'white' }} />"
      + "<s style={{ color: `white` }} />"
      + "</div>);";
    expect(hitsFor('components/__synthetic__.jsx', src).map((h) => [h.selector, h.prop, h.value])).toEqual([
      ['[style]', 'color', 'white'],
      ['[style]', 'background-color', '#6366F1'],   // camelCase → kebab
      ['[style]', 'color', 'white'], ['[style]', 'color', 'black'],   // 조건식 양 갈래
      ['[style]', 'color', 'white'],                                  // 논리식 폴백
      ['[style]', 'color', 'white'],                                  // 보간 없는 템플릿
    ]);
  });

  it('CSS custom property 키는 kebab 변환하지 않는다', () => {
    expect(hitsFor('components/__synthetic__.jsx', "const A = () => <b style={{ '--x': '#ABCDEF' }} />;")
      .map((h) => [h.selector, h.prop, h.value])).toEqual([['[style]', '--x', '#ABCDEF']]);
  });

  it('style 객체 값을 마스킹해 자유 텍스트 경로와 중복 계상하지 않는다', () => {
    expect(hitsFor('components/__synthetic__.js', "const A = () => <b style={{ color: '#ABCDEF' }} />;")
      .map((h) => [h.selector, h.prop, h.value])).toEqual([['[style]', 'color', '#ABCDEF']]);
  });

  it('의미로만 알 수 있는 값은 비목표다 (fail-closed 아님) — style={변수}는 자유 텍스트가 받는다', () => {
    // 실측: style 객체 property 288개 중 204개가 이 부류(색 관련 prop만 76개)이고
    // 전부 런타임/DB 유래라, fail-closed하면 해소 불가능한 RED만 늘어난다.
    expect(hitsFor('components/__synthetic__.jsx',
      "const A = () => (<div><b style={{ color: label.color }} /><i style={{ color: `${a}white` }} /></div>);")).toEqual([]);
    expect(hitsFor('components/__synthetic__.jsx',
      "const s = { color: '#ABCDEF' };\nconst A = () => <b style={s} />;")
      .map((h) => [h.selector, h.prop, h.value])).toEqual([[null, 'color', '#ABCDEF']]);
  });

  it('프로덕션 JS/JSX 전체가 파싱된다 (파서가 이 코드베이스 문법을 다 받는다)', () => {
    // 실측: 수집되는 JS/JSX 310개(프로덕션 309 + 스위퍼 자신), 파싱 실패 0.
    // 하나라도 throw하면 스윕이 그 파일을 통째로 못 보므로 조용한 구멍이 된다.
    const targets = collectSweepTargets().filter((t) => /\.jsx?$/.test(t));
    expect(targets.length).toBeGreaterThan(250);
    for (const rel of targets) expect(() => hitsFor(rel, readRepo(rel)), rel).not.toThrow();
  });
});

describe('sweepFile — 단일 파일 대조', () => {
  it('레지스트리에 없는 파일은 1건만 있어도 over다', () => {
    const r = sweepFile('components/__synthetic__.js', "const c = '#ABCDEF';");
    expect(r.over.length).toBe(1);
    expect(r.over[0]).toContain('#ABCDEF');
  });
  it('색이 없으면 over가 비어 있다', () => {
    expect(sweepFile('components/__synthetic__.js', 'const c = var1;').over).toEqual([]);
  });
});

// ── S8 인계 계약 검증 (S9 착수 시 반드시 함께 켠다) ────────────────────────────
// 이 describe가 없으면 vendor 36 hit이 그대로 over로 떠 G6이 구조적으로 불가능하다.
// **mutation 조건** — 아래 넷은 전부 RED가 되어야 한다. 하나라도 GREEN이면 계약이 새고 있다:
//   (M1) THIRD_PARTY_PREFIXES에 'components/'나 'library/'를 추가한다
//        → 'editorTheme.js/mermaidConfig.js/IconPicker.js는 계속 스윕 대상' 테스트가 RED
//   (M2) CLASSIFIED_POOL에 ...THIRD_PARTY_OWNED를 섞는다
//        → 'THIRD_PARTY_OWNED가 CLASSIFIED_POOL에 없다' 테스트가 RED
//   (M3) THIRD_PARTY_EXCLUDED 필터를 지우고 THIRD_PARTY_OWNED.map(e=>e.file) 전체를 제외한다
//        → (M1)과 같은 테스트가 RED
//   (M4) styles/vendor/highlight-themes.scss를 STRUCTURAL_EXCLUSIONS에 4번째로 넣는다
//        → 'STRUCTURAL_EXCLUSIONS — 정확히 3개'가 RED (축을 섞지 말라는 안전장치)
describe('THIRD_PARTY_EXCLUDED — S8 인계, vendor/node_modules 경로만', () => {
  it('제외 집합은 styles/vendor/ 또는 node_modules/ 접두 경로뿐이다', () => {
    expect(THIRD_PARTY_EXCLUDED.length).toBeGreaterThan(0);
    for (const f of THIRD_PARTY_EXCLUDED) {
      expect(/^(styles\/vendor\/|node_modules\/)/.test(f), f).toBe(true);
    }
    // S8 시점의 실측 exact 집합 — 항목이 늘면 의도적으로 갱신하게 만든다
    expect([...THIRD_PARTY_EXCLUDED].sort()).toEqual([
      'node_modules/katex/dist/katex.min.css',
      'styles/vendor/highlight-themes.scss',
    ]);
  });

  it('editorTheme.js·mermaidConfig.js·IconPicker.js는 계속 스윕 대상이다', () => {
    const targets = new Set(collectSweepTargets());
    for (const f of ['library/editorTheme.js',
                     'components/Canvas/extensions/mermaidConfig.js',
                     'components/common/IconPicker.js']) {
      expect(targets.has(f), f).toBe(true);          // 제외되면 RED (M1/M3)
      expect(THIRD_PARTY_EXCLUDED, f).not.toContain(f);
    }
  });

  it('vendor SCSS는 스윕 대상에서 빠진다 (컴파일 인라인 36 hit 차단)', () => {
    expect(new Set(collectSweepTargets()).has('styles/vendor/highlight-themes.scss')).toBe(false);
  });

  it('THIRD_PARTY_OWNED는 CLASSIFIED_POOL에 들어가지 않는다 (축 분리)', () => {
    const ownedFiles = new Set(THIRD_PARTY_OWNED.map((e) => e.file));
    // 소비 풀의 어떤 항목도 THIRD_PARTY_OWNED 객체와 동일 참조가 아니다
    for (const e of CLASSIFIED_POOL) expect(THIRD_PARTY_OWNED).not.toContain(e);
    // 소비 풀에는 vendor/node_modules 경로 항목이 애초에 없다
    for (const e of CLASSIFIED_POOL) {
      expect(/^(styles\/vendor\/|node_modules\/)/.test(e.file), e.file).toBe(false);
    }
    expect(ownedFiles.size).toBe(5);
  });

  it('STRUCTURAL_EXCLUSIONS와 THIRD_PARTY_EXCLUDED는 서로소다 (축을 섞지 않는다)', () => {
    const structural = new Set(STRUCTURAL_EXCLUSIONS.map((e) => e.file));
    for (const f of THIRD_PARTY_EXCLUDED) expect(structural.has(f), f).toBe(false);
  });
});

describe('STRUCTURAL_EXCLUSIONS — 정확히 3개', () => {
  it('개수가 3으로 고정된다 (네 번째는 이 테스트를 고쳐야만 들어온다)', () => {
    expect(STRUCTURAL_EXCLUSIONS.length).toBe(3);
  });
  it('정의처와 두 정본 자신만 제외된다', () => {
    expect(STRUCTURAL_EXCLUSIONS.map((e) => e.file).sort())
      .toEqual(['library/colorClassified.js', 'library/colorExceptions.js', 'styles/_themes.scss']);
  });
  it('각 항목에 20자 이상 사유가 있다', () => {
    for (const e of STRUCTURAL_EXCLUSIONS) expect(e.reason.length, e.file).toBeGreaterThan(20);
  });
  it('제외 파일은 스윕 대상에 없다', () => {
    const targets = new Set(collectSweepTargets());
    for (const e of STRUCTURAL_EXCLUSIONS) expect(targets.has(e.file), e.file).toBe(false);
  });
});

describe('COLOR_EXCEPTIONS — 레지스트리 규율', () => {
  it('모든 항목이 6키 shape를 지킨다', () => {
    for (const e of COLOR_EXCEPTIONS) {
      expect(Object.keys(e).sort()).toEqual(
        ['category', 'file', 'prop', 'reason', 'selector', 'value'],
      );
    }
  });
  it('category가 등록 가능한 7분류 안이다 (8분류 − theme-dependent)', () => {
    for (const e of COLOR_EXCEPTIONS) expect(CATEGORIES.has(e.category), `${e.file} ${e.value} ${e.category}`).toBe(true);
  });
  it('reason이 20자 이상이다 (왜 토큰을 쓸 수 없는가)', () => {
    for (const e of COLOR_EXCEPTIONS)
      expect(e.reason.length, `${e.file} ${e.value}`).toBeGreaterThanOrEqual(20);
  });
  it('value가 비어 있지 않다', () => {
    for (const e of COLOR_EXCEPTIONS) expect(e.value, e.file).toBeTruthy();
  });
  // ⚠️ 튜플 유일성은 단정하지 않는다 — 같은 (file,selector,prop,value)가 여러 번 나오는
  //    것은 정상이고(예: public/next.svg의 fill=#000 2건) 개수가 곧 소비 예산이다(index 「exact hit identity 스윕 계약」).
  //    S5의 colorExceptions.test.js도 유일성을 단정하지 않으므로 충돌하지 않는다.
});

// COLOR_EXCEPTIONS의 자매 규율. 두 정본의 category 집합이 **서로소**인 것이 분류명 위조를
// 막는 유일한 기계적 장치다 — theme-dependent를 7분류로 둔갑시키거나 그 반대를 하면 RED다.
describe('COLOR_CLASSIFIED — 분류 정본 규율', () => {
  it('모든 항목이 6키 shape를 지킨다', () => {
    for (const e of COLOR_CLASSIFIED)
      expect(Object.keys(e).sort()).toEqual(['category', 'count', 'file', 'prop', 'selector', 'value']);
  });
  it('category가 theme-dependent 뿐이다 (등록 금지 분류의 유일한 거처)', () => {
    for (const e of COLOR_CLASSIFIED)
      expect(e.category, `${e.file} ${e.value}`).toBe('theme-dependent');
  });
  it('count가 1 이상 정수다 (개수가 곧 소비 예산이다)', () => {
    for (const e of COLOR_CLASSIFIED)
      expect(Number.isInteger(e.count) && e.count >= 1, `${e.file} ${e.value} ${e.count}`).toBe(true);
  });
  it('같은 튜플이 두 정본에 동시에 있지 않다 (CATEGORY_CONFLICT)', () => {
    const K = (e) => [e.file, e.selector ?? '-', e.prop ?? '-', e.value].join('|');
    const ex = new Set(COLOR_EXCEPTIONS.map(K));
    for (const e of COLOR_CLASSIFIED) expect(ex.has(K(e)), K(e)).toBe(false);
  });
});

describe('실 레포 스윕', () => {
  it('스윕이 공허하지 않다 (대상 파일이 충분히 수집된다)', () => {
    const targets = collectSweepTargets();
    expect(targets.length).toBeGreaterThan(300);
    for (const root of SWEEP_ROOTS)
      expect(targets.some((t) => t.startsWith(`${root}/`)), `${root} 미수집`).toBe(true);
    expect(targets.some((t) => t.endsWith('.scss')), '.scss 미수집').toBe(true);
    expect(targets.some((t) => t.endsWith('.js')), '.js 미수집').toBe(true);
    expect(targets.some((t) => t.endsWith('.svg')), '.svg 미수집').toBe(true);
    expect(targets.some((t) => t.endsWith('.html')), '.html 미수집').toBe(true);
    expect(targets.some((t) => t.endsWith('.json')), '.json 미수집').toBe(true);
  });

  it('실제로 색을 세고 있다 (hit 총량 하한)', () => {
    expect(sweepRepo().hitCount).toBeGreaterThan(100);
  });

  // ── S9 완료 기준 (사용자 결정) ────────────────────────────────────────────────
  // "전역 over 0"이 아니라 **"신규·무소유 over 0 + 선행 debt 74 exact"**다.
  // 선행 슬라이스가 소유한 74건은 공식 deferred debt로 남기고 S9는 자기 색만 책임진다.
  // ⛔ 이 계약은 debt를 **exact 74로 못박아** 성립한다 — 숫자를 늘려 새 색을 밀어 넣지 마라.
  //    debt를 줄이는 유일한 길은 소유 슬라이스가 실제로 이행/등록하고 이 수를 함께 내리는 것이다.
  const DEBT_BY_OWNER = {
    'S7 후속': 26,
    'S6 Flow': 4,
    'S6/S7 Track': 9,
    'S6 엔티티 팔레트': 12,
    'S6 아바타 팔레트': 13,
    S3: 10,
  };
  const DEBT_TOTAL = Object.values(DEBT_BY_OWNER).reduce((a, b) => a + b, 0);   // 74

  it('신규·무소유 색이 0건이다 (S9 완료 기준)', () => {
    const { unownedOver, deferredByOwner } = sweepRepo();
    const owners = Object.entries(deferredByOwner).map(([o, n]) => `${o}: ${n}`).join(' · ');
    expect(unownedOver, `소유자 없는 색 리터럴 ${unownedOver.length}건 (선행 debt owner별 — ${owners}):\n`
      + unownedOver.join('\n')).toEqual([]);
  });

  it('선행 debt가 정확히 74건이고 owner별 수량이 고정이다', () => {
    const { over, deferred, deferredByOwner } = sweepRepo();
    expect(PRIOR_SLICE_DEFERRED, '원장 항목 수').toHaveLength(DEBT_TOTAL);
    expect(deferred, '실제 소비된 유예 수').toHaveLength(DEBT_TOTAL);
    expect(over, 'raw over는 debt를 그대로 안고 있어야 한다').toHaveLength(DEBT_TOTAL);
    expect(deferredByOwner).toEqual(DEBT_BY_OWNER);
  });

  it('debt 원장 항목의 shape 규율 (owner 필수 · reason 필수 · category 금지)', () => {
    const noOwner = PRIOR_SLICE_DEFERRED.filter((e) => typeof e.owner !== 'string' || !e.owner.trim());
    const noReason = PRIOR_SLICE_DEFERRED.filter((e) => typeof e.reason !== 'string' || !e.reason.trim());
    // ⛔ category를 붙이면 "리터럴이 정답"이라는 선언이 되어 유예가 예외로 둔갑한다.
    const hasCategory = PRIOR_SLICE_DEFERRED.filter((e) => 'category' in e);
    expect(noOwner.map((e) => e.file), 'owner 미상').toEqual([]);
    expect(noReason.map((e) => e.file), '빈 reason').toEqual([]);
    expect(hasCategory.map((e) => e.file), 'category가 붙은 유예').toEqual([]);
    const owners = [...new Set(PRIOR_SLICE_DEFERRED.map((e) => e.owner))].sort();
    expect(owners).toEqual(Object.keys(DEBT_BY_OWNER).sort());
  });

  it('미소비 유예가 0건이다 (원장이 소스보다 낡지 않았다)', () => {
    const { deferredUnused } = sweepRepo();
    expect(deferredUnused, `이행됐거나 사라진 유예 ${deferredUnused.length}건:\n${deferredUnused.join('\n')}`)
      .toEqual([]);
  });

  // ⛔ 유예를 소비 풀에 섞으면 74건이 그대로 남은 채 완료 게이트가 초록이 된다(실측: pool 425→499,
  //    over 74→0). 그건 이름만 다른 allowlist다. 형제 축(THIRD_PARTY_OWNED)과 같은 강도로 못박는다.
  it('PRIOR_SLICE_DEFERRED는 CLASSIFIED_POOL에 들어가지 않는다 (축 분리)', () => {
    const key = (e) => `${e.file}|${e.selector ?? '-'}|${e.prop ?? '-'}|${e.value}`;
    for (const e of PRIOR_SLICE_DEFERRED)
      expect(CLASSIFIED_POOL.includes(e), `${key(e)}가 소비 풀에 있다`).toBe(false);
    // 참조 동일성만 보면 복사본 혼입을 놓친다 — 튜플 교집합도 0이어야 한다.
    const poolKeys = new Set(CLASSIFIED_POOL.map(key));
    const overlap = PRIOR_SLICE_DEFERRED.map(key).filter((k) => poolKeys.has(k));
    expect(overlap, `유예 튜플이 소비 풀에도 등록돼 있다:\n${overlap.join('\n')}`).toEqual([]);
  });

  it('유예는 consume-once 예산이다 (같은 튜플의 추가 출현을 흡수하지 않는다)', () => {
    // 유예와 **같은 튜플**을 한 번 더 만들면 over는 늘고 deferred는 그대로여야 한다.
    const target = PRIOR_SLICE_DEFERRED.find((e) => /\.jsx?$/.test(e.file) && e.selector === null);
    expect(target, '테스트할 유예 튜플이 없다').toBeTruthy();
    const inject = (rel) => (rel === target.file
      ? `${readRepo(rel)}\nconst __dupProbe = { ${target.prop}: '${target.value}' };\n`
      : readRepo(rel));
    const base = sweepRepo();
    const dup = sweepRepo({ read: inject });
    expect(dup.over.length, 'over가 늘지 않았다').toBe(base.over.length + 1);
    expect(dup.deferred.length, '유예가 추가 출현을 흡수했다').toBe(base.deferred.length);
    expect(dup.unownedOver, '신규 복사본이 무소유로 드러나야 한다').toHaveLength(1);
  });

  it('죽은 예외가 0건이다 (파일이 사라졌거나 리터럴이 이미 없다)', () => {
    const { dead } = sweepRepo();
    expect(dead, `미소비 예외 ${dead.length}건:\n${dead.join('\n')}`).toEqual([]);
  });
});

describe('검출력 증명 — 메모리 내 mutation (제품 파일을 건드리지 않는다)', () => {
  const bump = (v) => {
    const i = v.startsWith('%23') ? 3 : 1;
    const d = v[i];
    const next = d.toUpperCase() === 'F' ? '0' : (parseInt(d, 16) + 1).toString(16).toUpperCase();
    return v.slice(0, i) + next + v.slice(i + 1);
  };

  it('같은 길이 hex로 바꾸면 RED가 된다 (same-count 치환도 잡는다)', () => {
    const targets = COLOR_EXCEPTIONS.filter((e) => /^#[0-9a-fA-F]{3,8}$/.test(e.value));
    expect(targets.length, 'hex 형태 예외가 하나도 없다 — 증명 코퍼스가 비었다').toBeGreaterThan(4);

    const files = new Set();
    let proven = 0;
    for (const e of targets.slice(0, 12)) {
      const src = readRepo(e.file);                        // 읽기만 한다
      if (!src.includes(e.value)) continue;
      const mutated = src.replace(e.value, bump(e.value)); // 문자열만 변형
      const over = sweepFile(e.file, mutated).over;
      expect(over.length, `${e.file}의 ${e.value} 변형을 못 잡았다`).toBeGreaterThan(0);
      files.add(e.file); proven++;
    }
    expect(proven, '증명된 항목 수').toBeGreaterThanOrEqual(5);
    expect(files.size, '증명이 한두 파일에 몰려 있다').toBeGreaterThanOrEqual(3);
  });

  // 구조적 소스 2개가 없으면 아래 두 mutation은 **조용히 통과한다** — 자유 텍스트 경로가
  // named color를 안 보기 때문이다. 실측(Step 3): 두 mutation 모두 새 소스에서만 잡혔다.
  // 주입 전후의 over **multiset 차이**만 본다. `over.length === 1`로 쓰면 그 파일에 아직
  // 미분류 색이 남아 있는 동안(Task 7 미이행) 계약이 기준선에 끌려다닌다 — mutation이
  // 무엇을 새로 만들었는지가 이 테스트의 명제이지, 파일이 이미 깨끗한지가 아니다.
  const injectedDelta = (rel, mutate) => {
    const before = sweepFile(rel, readRepo(rel)).over;
    const src = readRepo(rel);
    const mutated = mutate(src);
    expect(mutated, `${rel} 변이 앵커를 못 찾았다`).not.toBe(src);
    const after = sweepFile(rel, mutated).over;
    const bag = new Map();
    for (const o of before) bag.set(o, (bag.get(o) || 0) + 1);
    const delta = [];
    for (const o of after) {
      const n = bag.get(o) || 0;
      if (n > 0) bag.set(o, n - 1); else delta.push(o);
    }
    return delta;
  };

  it("HTML에 style=\"color:white\"를 넣으면 RED가 된다", () => {
    const delta = injectedDelta('public/offline.html', (s) =>
      s.replace('<div class="container">', '<div class="container" style="color:white">'));
    expect(delta.length, `주입 1건만 늘어야 한다: ${delta.join(' / ')}`).toBe(1);
    expect(delta[0]).toContain('[style]');
    expect(delta[0]).toContain('white');
  });

  it("JSX에 style={{ color: 'white' }}를 넣으면 RED가 된다", () => {
    const delta = injectedDelta('components/Layout/ErrorBoundary.js', (s) =>
      s.replace('<h2', "<h2 style={{ color: 'white' }}"));
    expect(delta.length, `주입 1건만 늘어야 한다: ${delta.join(' / ')}`).toBe(1);
    expect(delta[0]).toContain('white');
  });

  it('합성 문자열에서도 잡는다', () => {
    expect(sweepFile('components/__synthetic__.js', "const c='#ABCDEF'").over.length).toBe(1);
    expect(sweepFile('styles/components/__synthetic__.scss', '.X { color: #ABCDEF; }').over.length).toBe(1);
    expect(sweepFile('public/__synthetic__.svg', '<rect fill="tan"/>').over.length).toBe(1);
  });
});

describe('스윕 모듈이 앱 번들에 새지 않는다', () => {
  // 스윕 모듈 자신은 제품 코드가 아니다 — 헤더 주석이 제 이름을 적고 있다.
  // STRUCTURAL_EXCLUSIONS로 빼지 않는다: 자기 스윕의 색 hit은 실측 0건이라 대상에서 뺄 이유가
  // 없고 그 목록은 길이 3으로 고정돼 있다. 자기참조는 이 단정의 필터에서만 배제한다.
  const SWEEP_MODULE = 'library/literalColorSweep.js';
  const SWEEP_ABS = resolve(ROOT, SWEEP_MODULE);

  // ⚠️ 부분문자열 검사(`src.includes('literalColorSweep')`)를 쓰지 않는다. 그러면 **설명 주석이
  //    모듈 이름을 언급한 것만으로** 번들 누수로 오인한다(실측: entityTint.js:41의 주석 1건).
  //    금지하려는 것은 "이름을 말하는 것"이 아니라 "실제로 그래프에 끌어들이는 것"이므로
  //    module specifier를 AST에서 뽑아 importer 기준으로 resolve한 결과로만 판정한다.
  const JsxParser = AcornParser.extend(acornJsx());
  const parse = (src) =>
    JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true });

  const walk = (node, fn) => {
    if (!node || typeof node.type !== 'string') return;
    fn(node);
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn));
      else if (v && typeof v.type === 'string') walk(v, fn);
    }
  };

  // 정적으로 확정된 specifier만 모은다.
  // ⚠️ 지원 범위: 문자열 Literal · TemplateLiteral · `+` 문자열 결합 · 그리고 이들로
  //    초기화된 **최상위 const 식별자**까지 상수 폴딩한다. 이 셋을 안 접으면
  //    `import('./literalColorSweep' + '.js')` 한 줄로 게이트를 조용히 지나간다(실측 false-green).
  // ⚠️ 여전히 **지원 밖**: 런타임에만 값이 정해지는 경로(함수 인자·let 재대입·계산된 속성).
  //    어휘적 한계이며, 그 경우는 이 단정이 아니라 코드리뷰가 막는다.
  // ⚠️ `require(...)`는 **callee 이름만** 본다. 지역 변수로 require를 가린 경우(shadow)도
  //    위반으로 센다 — 번들 누수는 실수 한 번이면 되돌리기 비싼 쪽이라 보수적으로 잡는 것이
  //    의도다. 오탐이 실제로 생기면 그때 shadow 스코프 판정을 넣는다.
  const specifiersOf = (src) => {
    const out = [];
    const ast = parse(src);

    // 최상위 `const X = <정적 문자열>` 바인딩을 먼저 모아 식별자도 접을 수 있게 한다.
    const consts = new Map();
    // allowIdent = 이 specifier가 **모듈 최상위**에 있는가. 중첩 함수·블록 안이면 같은 이름이
    // 다시 선언됐을 수 있어 최상위 값이 그 import와 무관하다 — 접지 않고 지원 밖으로 보낸다.
    const fold = (n, seen = new Set(), allowIdent = true) => {
      if (!n) return null;
      if (n.type === 'Literal') return typeof n.value === 'string' ? n.value : null;
      if (n.type === 'TemplateLiteral') {
        let s = '';
        for (let i = 0; i < n.quasis.length; i += 1) {
          s += n.quasis[i].value.cooked;
          if (i < n.expressions.length) {
            const e = fold(n.expressions[i], seen, allowIdent);
            if (e === null) return null;
            s += e;
          }
        }
        return s;
      }
      if (n.type === 'BinaryExpression' && n.operator === '+') {
        const l = fold(n.left, seen, allowIdent), r = fold(n.right, seen, allowIdent);
        return l === null || r === null ? null : l + r;
      }
      if (n.type === 'Identifier') {
        if (!allowIdent) return null;                               // 중첩 스코프 → 판정하지 않는다
        if (seen.has(n.name) || !consts.has(n.name)) return null;   // 순환·미해결은 포기
        return fold(consts.get(n.name), new Set([...seen, n.name]), allowIdent);
      }
      return null;
    };
    // ⚠️ **Program 본문만** 훑는다. 전체 AST를 walk하면 중첩 함수·블록의 동명 const가
    //    Map을 마지막 쓰기로 덮어써 판정이 양방향으로 뒤집힌다(실측: 위험한 최상위 바인딩을
    //    놓치거나, 안전한 최상위 바인딩을 오탐한다). import specifier는 모듈 최상위에서만
    //    의미가 있으므로 계약도 "최상위 const"가 맞다 — 어휘 스코프 전체 구현은 과잉이다.
    for (const n of ast.body) {
      if (n.type !== 'VariableDeclaration' || n.kind !== 'const') continue;
      for (const d of n.declarations)
        if (d.id && d.id.type === 'Identifier' && d.init) consts.set(d.id.name, d.init);
    }
    const lit = (n, topLevel) => fold(n, new Set(), topLevel);

    // 동적 import()/require()의 specifier가 접히지 않으면 **지원 밖**으로 모은다.
    // "못 접었으니 안전"으로 넘기면 지역 변수를 거친 위험 경로가 조용히 지나간다.
    // (정적 import/export ... from은 명세상 문자열 리터럴만 올 수 있어 여기 해당 없다.)
    const unsupported = [];
    const noteIfUnfoldable = (n, topLevel) => {
      if (n && fold(n, new Set(), topLevel) === null) unsupported.push(src.slice(n.start, n.end));
    };

    // 스코프를 만드는 노드에 들어가면 topLevel이 꺾인다. 완전한 스코프 해석이 아니라
    // "최상위인가 아닌가" 한 비트만 본다 — 그 이상은 이 게이트의 주장 범위가 아니다.
    const SCOPED = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
      'BlockStatement', 'ClassBody', 'ForStatement', 'ForOfStatement', 'ForInStatement',
      'WhileStatement', 'DoWhileStatement', 'SwitchStatement', 'CatchClause', 'StaticBlock']);
    const walkScoped = (node, topLevel, fn) => {
      if (!node || typeof node.type !== 'string') return;
      fn(node, topLevel);
      const inner = topLevel && !SCOPED.has(node.type);
      for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
        const v = node[k];
        if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walkScoped(c, inner, fn));
        else if (v && typeof v.type === 'string') walkScoped(v, inner, fn);
      }
    };
    walkScoped(ast, true, (n, topLevel) => {
      if (n.type === 'ImportDeclaration'                       // static + side-effect import
       || n.type === 'ExportNamedDeclaration'                  // re-export (source가 있을 때만)
       || n.type === 'ExportAllDeclaration') {                 // export * from
        const v = lit(n.source, true); if (v) out.push(v);
      } else if (n.type === 'ImportExpression') {              // dynamic import('…')
        const v = lit(n.source, topLevel); if (v) out.push(v); else noteIfUnfoldable(n.source, topLevel);
      } else if (n.type === 'CallExpression'                   // require('…')
              && n.callee.type === 'Identifier' && n.callee.name === 'require') {
        const a = n.arguments[0];
        const v = lit(a, topLevel); if (v) out.push(v); else noteIfUnfoldable(a, topLevel);
      }
    });
    return { specs: out, unsupported };
  };
  const unsupportedDynamicSpecifiers = (src) => specifiersOf(src).unsupported;

  // importer 위치 기준 resolve. '@/'는 vitest.config.mjs의 alias(= frontend 루트)와 같다.
  // 확장자 생략도 같은 모듈이므로 후보에 넣는다. bare specifier는 우리 모듈이 아니다.
  const resolvesToSweep = (importerRel, rawSpec) => {
    // 번들러는 `?raw`·`?url`·`#frag`를 붙여도 같은 모듈을 끌어온다. suffix를 떼고 pathname으로
    // 판정하지 않으면 './literalColorSweep.js?raw' 한 줄로 게이트를 우회할 수 있다.
    const spec = rawSpec.split('?')[0].split('#')[0];
    if (!spec) return false;
    let base;
    if (spec.startsWith('@/')) base = resolve(ROOT, spec.slice(2));
    else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(ROOT, dirname(importerRel), spec);
    else return false;
    return [base, `${base}.js`, `${base}.jsx`].includes(SWEEP_ABS);
  };

  const importsSweep = (importerRel, src) =>
    specifiersOf(src).specs.some((s) => resolvesToSweep(importerRel, s));

  it('제품 코드에서 literalColorSweep을 import하지 않는다 (jsdom을 끌고 들어간다)', () => {
    const bad = collectSweepTargets()
      .filter((rel) => rel !== SWEEP_MODULE && /\.jsx?$/.test(rel))
      .filter((rel) => importsSweep(rel, readRepo(rel)));
    expect(bad, `제품 코드가 스윕 모듈을 import한다:\n${bad.join('\n')}`).toEqual([]);
  });

  it('이름 언급이 아니라 실제 module specifier만 잡는다 (메모리 내 회귀)', () => {
    const F = 'library/entityTint.js';   // importer 위치 — 상대경로 해석 기준
    // 통과해야 하는 것: 이름을 말하기만 하는 코드
    const green = [
      ['주석 언급', '// literalColorSweep이 주석의 hex도 hit로 잡는다\nexport const a = 1;'],
      ['블록 주석', '/* see literalColorSweep.js */\nexport const a = 1;'],
      ['일반 문자열', "export const doc = 'literalColorSweep.js는 테스트 전용이다';"],
      ['유사 이름 모듈', "import x from './literalColorSweeper.js';"],
      ['유사 이름 모듈 2', "import x from './literalColorSweepHelper.js';"],
      ['다른 라이브러리', "import postcss from 'postcss';"],
    ];
    for (const [label, src] of green)
      expect(importsSweep(F, src), `${label}은 누수가 아니다`).toBe(false);

    // 잡아야 하는 것: 실제로 모듈 그래프에 끌어들이는 다섯 형태 (경로 표기 변주 포함)
    const red = [
      ['static import', "import { sweepRepo } from './literalColorSweep.js';"],
      ['side-effect import', "import './literalColorSweep.js';"],
      ['re-export', "export { sweepRepo } from './literalColorSweep.js';"],
      ['export *', "export * from './literalColorSweep.js';"],
      ['dynamic import', "const m = await import('./literalColorSweep.js');"],
      ['require', "const m = require('./literalColorSweep.js');"],
      ['@ alias', "import { sweepRepo } from '@/library/literalColorSweep';"],
      ['확장자 생략', "import { sweepRepo } from './literalColorSweep';"],
      ['상위 경로', "import { sweepRepo } from '../library/literalColorSweep.js';"],
      ['?query suffix', "import { sweepRepo } from './literalColorSweep.js?raw';"],
      ['#fragment suffix', "import { sweepRepo } from './literalColorSweep.js#frag';"],
      ['표현식 없는 template', "const m = await import(`./literalColorSweep.js`);"],
      // 표현식이 든 동적 import — 상수 폴딩이 없으면 조용히 통과한다(실측 false-green).
      ['상수 결합 import', "const m = await import('./literalColorSweep' + '.js');"],
      ['상수 template import', "const MOD = 'literalColorSweep';\nconst m = await import(`./${MOD}.js`);"],
      ['상수 결합 require', "const m = require('./literalColor' + 'Sweep.js');"],
    ];
    for (const [label, src] of red)
      expect(importsSweep(F, src), `${label}을 못 잡았다`).toBe(true);
  });

  it('지역 식별자에 기댄 동적 specifier는 안전 추측 없이 unsupported로 fail-closed 한다', () => {
    const F = 'library/entityTint.js';
    // 지역 const는 최상위가 아니라 폴딩 대상이 아니다. 그렇다고 "못 접었으니 안전"으로
    // 넘기면 위험한 경로가 조용히 지나간다 — 안전/위험 **양쪽 모두** 지원 밖으로 보고한다.
    const dangerousLocal = 'function f() { const MOD = \'literalColorSweep\'; return import(`./${MOD}.js`); }';
    const safeLocal      = 'function f() { const MOD = \'safeModule\'; return import(`./${MOD}.js`); }';
    for (const [label, src] of [['위험한 지역 const', dangerousLocal], ['안전한 지역 const', safeLocal]]) {
      expect(unsupportedDynamicSpecifiers(src).length, `${label}을 지원 밖으로 보고하지 않았다`).toBe(1);
      // 지원 밖이므로 "누수 아님"으로 단정하지 않는다 — 판정 자체를 하지 않는 것이 계약이다.
      expect(importsSweep(F, src), `${label}은 해석된 specifier가 없어야 한다`).toBe(false);
    }
    // 접히는 형태는 지원 밖이 아니다.
    for (const src of ["const m = await import('./x.js');",
                       'const m = await import(`./x.js`);',
                       "const m = await import('./x' + '.js');",
                       "const MOD = 'x';\nconst m = await import(`./${MOD}.js`);"])
      expect(unsupportedDynamicSpecifiers(src), `접히는 형태를 지원 밖으로 오분류: ${src}`).toEqual([]);
  });

  it('중첩 스코프의 식별자는 최상위 const로 접지 않고 unsupported로 보낸다 (양방향)', () => {
    const F = 'library/entityTint.js';
    // ⚠️ 중첩 함수가 같은 이름을 다시 선언하면 최상위 값은 **그 import와 무관하다**.
    //    최상위 값으로 접으면 두 방향 모두 틀린다 — 완전한 scope resolver 대신
    //    "중첩 스코프 식별자는 판정하지 않는다"로 fail-closed 한다.
    const dangerousShadow = [                     // 최상위는 안전, 중첩이 위험
      "const MOD = 'safeModule';",
      "function f() { const MOD = 'literalColorSweep'; return import(`./${MOD}.js`); }",
    ].join('\n');
    const reverseShadow = [                       // 최상위가 위험, 중첩은 안전
      "const MOD = 'literalColorSweep';",
      "function f() { const MOD = 'safeModule'; return import(`./${MOD}.js`); }",
    ].join('\n');
    const dangerousShadowRequire = [
      "const MOD = 'safeModule';",
      "function f() { const MOD = 'literalColorSweep'; return require('./' + MOD + '.js'); }",
    ].join('\n');
    const blockShadow = [
      "const MOD = 'safeModule';",
      "{ const MOD = 'literalColorSweep'; import(`./${MOD}.js`); }",
    ].join('\n');

    for (const [label, src] of [['위험한 local shadow import', dangerousShadow],
                                ['반대 방향 shadow', reverseShadow],
                                ['위험한 local shadow require', dangerousShadowRequire],
                                ['블록 스코프 shadow', blockShadow]]) {
      expect(unsupportedDynamicSpecifiers(src).length, `${label}을 지원 밖으로 보고하지 않았다`).toBe(1);
      expect(importsSweep(F, src), `${label}을 최상위 값으로 접어 판정했다`).toBe(false);
    }

    // 회귀 가드: **최상위**에서 최상위 const를 쓰는 것은 여전히 접힌다.
    const topLevel = "const MOD = 'literalColorSweep';\nconst m = await import(`./${MOD}.js`);";
    expect(unsupportedDynamicSpecifiers(topLevel), '최상위 폴딩이 깨졌다').toEqual([]);
    expect(importsSweep(F, topLevel), '최상위 위험 import를 놓쳤다').toBe(true);
  });

  it('제품 트리에 지원 밖 동적 specifier가 0건이다', () => {
    const bad = collectSweepTargets()
      .filter((rel) => rel !== SWEEP_MODULE && /\.jsx?$/.test(rel))
      .flatMap((rel) => unsupportedDynamicSpecifiers(readRepo(rel)).map((s) => `${rel}: ${s}`));
    expect(bad, `정적으로 해석할 수 없는 동적 import/require가 있다 — 이 스윕은 그 경로의 `
      + `번들 누수를 보증하지 못한다:\n${bad.join('\n')}`).toEqual([]);
  });

  it('(a) 위험한 최상위 const가 중첩 스코프의 동명 const에 가려지지 않는다', () => {
    const F = 'library/entityTint.js';
    const shadowedDangerous = [
      "const MOD = 'literalColorSweep';",
      'function unrelated() { const MOD = \'safeModule\'; return MOD; }',
      'const m = await import(`./${MOD}.js`);',
    ].join('\n');
    expect(importsSweep(F, shadowedDangerous),
      '중첩 스코프의 동명 const가 최상위 위험 바인딩을 덮었다 (누수를 놓친다)').toBe(true);
  });

  it('(b) 안전한 최상위 const가 중첩 스코프의 위험한 동명 const로 오탐되지 않는다', () => {
    const F = 'library/entityTint.js';
    const shadowedSafe = [
      "const MOD = 'safeModule';",
      'function unrelated() { const MOD = \'literalColorSweep\'; return MOD; }',
      'const m = await import(`./${MOD}.js`);',
    ].join('\n');
    expect(importsSweep(F, shadowedSafe),
      '중첩 스코프의 동명 const가 최상위 안전 바인딩을 덮었다 (오탐)').toBe(false);

    // 블록 스코프도 같다 — 최상위가 아니면 수집하지 않는다.
    const blockScoped = [
      "const MOD = 'safeModule';",
      "{ const MOD = 'literalColorSweep'; }",
      'const m = await import(`./${MOD}.js`);',
    ].join('\n');
    expect(importsSweep(F, blockScoped), '블록 스코프 동명 const 오탐').toBe(false);
  });

  it('런타임 디렉터리(hooks·lib·middleware)도 검사 범위 안이다', () => {
    // 이 셋이 collectSweepTargets에 없으면 아래 주입은 조용히 통과한다 — 범위부터 고정한다.
    const targets = collectSweepTargets();
    expect(targets.filter((t) => t.startsWith('hooks/')).length, 'hooks/ 미수집').toBeGreaterThan(0);
    expect(targets.filter((t) => t.startsWith('lib/')).length, 'lib/ 미수집').toBeGreaterThan(0);
    expect(targets.includes('middleware.js'), 'middleware.js 미수집').toBe(true);

    // 각 위치에서 상대 깊이가 달라 resolve 경로도 다르다. 하나씩 주입해 RED를 확인한다.
    const injections = [
      ['hooks/useStar.js', "import { sweepRepo } from '../library/literalColorSweep.js';"],
      ['lib/wbg-stub.js', "import { sweepRepo } from '../library/literalColorSweep.js';"],
      ['middleware.js', "import { sweepRepo } from './library/literalColorSweep.js';"],
    ];
    for (const [importer, src] of injections)
      expect(importsSweep(importer, src), `${importer} 주입을 못 잡았다`).toBe(true);

    // 대조군: 같은 위치에서 이름만 언급하는 것은 누수가 아니다.
    for (const [importer] of injections)
      expect(importsSweep(importer, '// literalColorSweep은 테스트 전용이다\n'), `${importer} 주석 오탐`).toBe(false);
  });

  it('Next 루트 런타임 진입점을 전부 감시하고, 지원 밖 확장자는 fail-closed다', () => {
    // middleware만 보면 proxy·instrumentation으로 옮겨 담는 순간 게이트가 침묵한다.
    expect(ROOT_RUNTIME_ENTRYPOINTS.slice().sort())
      .toEqual(['instrumentation', 'instrumentation-client', 'middleware', 'proxy']);

    // 실재하는 진입점은 스윕 대상이어야 한다.
    const targets = collectSweepTargets();
    expect(targets.includes('middleware.js'), 'middleware.js 미수집').toBe(true);

    // ⚠️ .ts/.tsx 진입점은 EXT_RE 밖이라 스캐너가 파싱할 수 없다. 조용히 건너뛰면
    //    "감시 중"이라는 주장이 거짓이 되므로, 존재하면 목록으로 드러내 fail-closed 한다.
    expect(unsupportedRootEntrypoints(), 'TS/TSX 루트 진입점은 이 스윕이 파싱하지 못한다 — '
      + '지원을 넓히거나 진입점을 JS로 유지하라(조용한 제외 금지)').toEqual([]);
  });

  it('진입점 감시는 루트와 src/ 양쪽 × 이름 × 확장자 전 조합을 덮는다 (파일 존재와 무관)', () => {
    // 파일이 실재하는지에 기대지 않는다 — 조합을 직접 만들어 판정만 묻는다.
    expect(ROOT_RUNTIME_LOCATIONS.slice().sort()).toEqual(['', 'src/']);

    const candidates = rootRuntimeCandidates();
    for (const loc of ROOT_RUNTIME_LOCATIONS)
      for (const base of ROOT_RUNTIME_ENTRYPOINTS)
        for (const ext of ['.js', '.jsx']) {
          const rel = `${loc}${base}${ext}`;
          expect(candidates, `${rel} 후보 누락`).toContain(rel);
          expect(isSweepTarget(rel), `${rel}이 수집 판정에서 빠진다`).toBe(true);
        }
    expect(candidates.length, '조합 수').toBe(ROOT_RUNTIME_LOCATIONS.length * ROOT_RUNTIME_ENTRYPOINTS.length * 2);

    // .ts/.tsx는 파싱 불가라 수집 대상이 아니고, 존재하면 fail-closed 목록에 뜬다.
    const unsupported = unsupportedRootEntrypoints({ exists: () => true });
    for (const loc of ROOT_RUNTIME_LOCATIONS)
      for (const base of ROOT_RUNTIME_ENTRYPOINTS)
        for (const ext of ['.ts', '.tsx']) {
          const rel = `${loc}${base}${ext}`;
          expect(isSweepTarget(rel), `${rel}은 파싱 불가라 수집 대상이 아니다`).toBe(false);
          expect(unsupported, `${rel}이 fail-closed 목록에서 빠진다`).toContain(rel);
        }
    expect(unsupported.length, 'fail-closed 조합 수').toBe(ROOT_RUNTIME_LOCATIONS.length * ROOT_RUNTIME_ENTRYPOINTS.length * 2);
  });
});

describe('tiptapCanonical.baseline.json — 테스트 산출물 exact 제외', () => {
  const BASELINE = 'library/tiptapCanonical.baseline.json';

  it('스윕 대상에서 빠진다 (STRUCTURAL_EXCLUSIONS가 아니라 SKIP_RE의 exact 경로다)', () => {
    expect(collectSweepTargets().includes(BASELINE)).toBe(false);
    expect(STRUCTURAL_EXCLUSIONS.map((e) => e.file), '구조적 제외 축을 늘리지 않는다')
      .not.toContain(BASELINE);
  });

  it('스캐너 자체는 여전히 이 파일의 색을 본다 (제외는 수집 단계일 뿐 검출력 손실이 아니다)', () => {
    expect(hitsFor(BASELINE, readRepo(BASELINE)).length).toBe(64);
  });

  it('다른 일반 JSON의 색 리터럴은 계속 수집된다 (광역 *.baseline.json 제외가 아니다)', () => {
    expect(collectSweepTargets().includes('public/manifest.json'), 'manifest.json이 빠졌다').toBe(true);
    expect(hitsFor('public/manifest.json', readRepo('public/manifest.json')).length).toBe(2);
  });

  it('제외는 이 한 경로뿐이다 — 다른 baseline 경로는 수집 판정을 통과한다', () => {
    // OR 우회 없이 수집 판정 자체를 직접 묻는다. 광역 `*.baseline.json`으로 넓히면
    // 아래 세 경로가 false가 되어 이 단정이 RED가 된다.
    expect(isSweepTarget(BASELINE), '이 파일만 제외 대상이다').toBe(false);
    for (const other of ['library/other.baseline.json',
                         'components/Track/track.baseline.json',
                         'library/tiptapCanonical.baseline.v2.json']) {
      expect(isSweepTarget(other), `${other}까지 가리면 광역 제외다`).toBe(true);
    }
  });
});


// ── mockData의 dead 판정을 소비자 부재로 강제한다 ─────────────────────────────
// 원장은 TRACK·BRANCHES·MEMBERS·ITEMS·SOURCE_TREE 30건을 `dead`(렌더되지 않음)로 등록했다.
// 그 판정은 **"제품에 소비자가 0건"**이라는 사실에 기대므로, 소비자가 생기면 RED가 나야 한다.
// ⛔ 범용 dataflow 분석기를 만들지 않는다 — mockData를 가리키는 import/export/require만 보는
//    좁은 인벤토리다. 대신 `read` 주입으로 **실제 소스 변이**를 태워 계약을 증명한다.
describe('mockData dead export에 제품 소비자가 없다', () => {
  const MOCK = 'components/Track/mockData.js';
  const DEAD = ['TRACK', 'BRANCHES', 'MEMBERS', 'ITEMS', 'SOURCE_TREE'];
  const ALLOWED = [
    { file: 'components/Track/Detail/TrackItemDetail.js', names: ['PRIORITIES'] },
    // 상태는 서버 status_label/status_color/status_category로 그린다 — mock 상태표(WORKFLOW_STATUSES)는 없어졌다.
    { file: 'components/Track/TrackDetail.js', names: ['getBranchDistribution'] },
  ];
  const MOCK_ABS = resolve(ROOT, MOCK);
  const parse = (text) => AcornParser.extend(acornJsx())
    .parse(text, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true });
  const walkAll = (n, fn) => {
    if (!n || typeof n.type !== 'string') return;
    fn(n);
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walkAll(c, fn));
      else if (v && typeof v.type === 'string') walkAll(v, fn);
    }
  };
  const pointsToMock = (importerRel, spec) => {
    if (typeof spec !== 'string') return false;
    const s = spec.split('?')[0].split('#')[0];
    let base;
    if (s.startsWith('@/')) base = resolve(ROOT, s.slice(2));
    else if (s.startsWith('./') || s.startsWith('../')) base = resolve(ROOT, dirname(importerRel), s);
    else return false;
    return [base, `${base}.js`, `${base}.jsx`].includes(MOCK_ABS);
  };

  // `read`를 주입하면 메모리 소스로 같은 판정을 돌릴 수 있다 — 실제 변이를 태우기 위한 seam이다.
  const inventory = ({ read = readRepo } = {}) => {
    const consumers = [];
    const unresolved = [];
    for (const rel of collectSweepTargets()) {
      if (!/\.jsx?$/.test(rel) || rel === MOCK) continue;
      const text = read(rel);
      let ast;
      // ⛔ 파싱 실패를 continue로 삼키면 그 파일의 소비를 못 본다 → unresolved로 드러낸다.
      try { ast = parse(text); } catch (e) { unresolved.push(`${rel}: parse 실패 (${e.message})`); continue; }
      for (const n of ast.body) {
        // import … from · export … from · export * from — 모두 모듈 그래프에 끌어들인다
        const isFrom = n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration'
          || n.type === 'ExportAllDeclaration';
        if (!isFrom || !n.source) continue;
        if (!pointsToMock(rel, n.source.value)) continue;
        if (n.type === 'ExportAllDeclaration') {
          unresolved.push(`${rel}: export * from (재수출 심볼 확정 불가)`); continue;
        }
        const names = [];
        for (const s of n.specifiers ?? []) {
          if (s.type === 'ImportSpecifier') names.push(s.imported.name);
          else if (s.type === 'ExportSpecifier') names.push(s.local.name);   // export { TRACK as LIVE } from …
          else unresolved.push(`${rel}: ${s.type} (소비 심볼 확정 불가)`);
        }
        if (names.length) consumers.push({ file: rel, names: names.sort() });
      }
      walkAll(ast, (m) => {
        if (m.type === 'ImportExpression') {
          const lit = m.source && m.source.type === 'Literal' ? m.source.value : null;
          if (lit === null || pointsToMock(rel, lit)) unresolved.push(`${rel}: dynamic import (소비 심볼 확정 불가)`);
        } else if (m.type === 'CallExpression' && m.callee.type === 'Identifier' && m.callee.name === 'require') {
          const a = m.arguments[0];
          const lit = a && a.type === 'Literal' ? a.value : null;
          if (lit === null || pointsToMock(rel, lit)) unresolved.push(`${rel}: require() (소비 심볼 확정 불가)`);
        }
      });
    }
    return { consumers: consumers.sort((a, b) => a.file.localeCompare(b.file)), unresolved };
  };
  const deadUsed = (inv) => inv.consumers.flatMap((c) => c.names.map((n) => `${c.file}: ${n}`))
    .filter((s) => DEAD.some((d) => s.endsWith(`: ${d}`)));

  // 실제 파일은 건드리지 않고, 그 파일의 소스만 메모리에서 바꿔 읽게 한다.
  const TH = 'components/Track/TrackHome.js';
  const withSource = (rel, mutate) => {
    const original = readRepo(rel);
    const mutated = mutate(original);
    expect(mutated, `${rel} 변이 앵커를 못 찾았다`).not.toBe(original);
    return { read: (f) => (f === rel ? mutated : readRepo(f)) };
  };

  it('소비 심볼을 확정할 수 없는 mockData import가 없다 (fail-closed)', () => {
    expect(inventory().unresolved).toEqual([]);
  });

  it('허용된 소비 경로가 정확히 그 둘뿐이다', () => {
    expect(inventory().consumers).toEqual(ALLOWED);
  });

  it('dead로 등록한 다섯 export의 제품 소비자가 0건이다', () => {
    const used = deadUsed(inventory());
    expect(used, `dead 등록이 거짓이 된다 — 소비자가 생겼다:\n${used.join('\n')}`).toEqual([]);
  });

  it('(a) TrackHome이 TRACK을 named import해 렌더하면 RED다', () => {
    const inv = inventory(withSource(TH, (s) => s
      .replace("import useHomeListControls from '@/library/useHomeListControls';",
               "import useHomeListControls from '@/library/useHomeListControls';\nimport { TRACK } from './mockData';")
      .replace('<StatTiles', '<div style={{ color: TRACK.color }} />\n      <StatTiles')));
    expect(inv.consumers).not.toEqual(ALLOWED);
    expect(deadUsed(inv)).toEqual([`${TH}: TRACK`]);
  });

  it('(b) dead symbol 재수출(export { TRACK as LIVE } from)도 소비자로 드러난다', () => {
    const inv = inventory(withSource(TH, (s) => `${s}\nexport { TRACK as LIVE } from './mockData';\n`));
    expect(deadUsed(inv), '재수출을 못 잡았다').toEqual([`${TH}: TRACK`]);
  });

  it('(c) require() 소비는 심볼 확정 불가라 unresolved로 드러난다', () => {
    const inv = inventory(withSource(TH, (s) => s
      .replace("import { useState, useEffect, useCallback } from 'react';",
               "import { useState, useEffect, useCallback } from 'react';\nconst __m = require('./mockData');")));
    expect(inv.unresolved, 'require 소비를 못 잡았다').toEqual([`${TH}: require() (소비 심볼 확정 불가)`]);
  });

  it('namespace·default·동적 import도 unresolved로 드러난다', () => {
    for (const [label, line, want] of [
      ['namespace', "import * as mock from './mockData';", `${TH}: ImportNamespaceSpecifier (소비 심볼 확정 불가)`],
      ['default',   "import mock from './mockData';",      `${TH}: ImportDefaultSpecifier (소비 심볼 확정 불가)`],
      ['dynamic',   "const p = import('./mockData');",     `${TH}: dynamic import (소비 심볼 확정 불가)`],
    ]) {
      const inv = inventory(withSource(TH, (s) => s
        .replace("import { useState, useEffect, useCallback } from 'react';",
                 `import { useState, useEffect, useCallback } from 'react';\n${line}`)));
      expect(inv.unresolved, `${label}을 못 잡았다`).toEqual([want]);
    }
  });

  it('파싱 실패는 삼키지 않고 unresolved로 드러난다', () => {
    const inv = inventory(withSource(TH, (s) => `${s}\nconst broken = (;\n`));
    expect(inv.unresolved).toHaveLength(1);
    expect(inv.unresolved[0]).toContain(`${TH}: parse 실패`);
  });
});
