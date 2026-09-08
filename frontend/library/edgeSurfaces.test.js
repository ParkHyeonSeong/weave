import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';
import postcss from 'postcss';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

// _themes.scss의 다크 블록에서 토큰 값을 실제 컴파일로 뽑는다.
// offline.html은 이 파일을 import 할 수 없어 값을 복제하므로, 복제본이 원본과
// 어긋나는 것을 막는 유일한 장치가 이 대조다.
function darkTokens() {
  const css = compile(resolve(ROOT, 'styles/_themes.scss')).css;
  const out = {};
  postcss.parse(css).walkRules((rule) => {
    if (!/\[data-theme=['"]?dark['"]?\]/.test(rule.selector)) return;
    rule.walkDecls((d) => { if (d.prop.startsWith('--')) out[d.prop] = d.value.trim(); });
  });
  return out;
}

// dark 미디어 블록의 본문만 중괄호 카운트로 잘라낸다. 정규식으로는 안쪽 .icon 규칙
// 때문에 틀린다(아래 drift 가드 주석과 같은 이유). 카운트는 base64/url()에 중괄호가 없어 안전하다.
function darkMediaBody(html) {
  const at = html.search(/@media\s*\(prefers-color-scheme:\s*dark\)/);
  if (at < 0) return null;
  const open = html.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0, i = open;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return depth === 0 ? html.slice(open + 1, i) : null;
}
const LIGHT_URI = /<img[^>]*class="icon"[^>]*src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/;
const DARK_URI = /\.icon\s*\{[^}]*content:\s*url\(\s*["']?data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)["']?\s*\)/;

describe('offline.html — CSP-safe Retry', () => {
  const html = read('public/offline.html');

  it('인라인 이벤트 핸들러가 0건이다 (script-src에 unsafe-inline이 없어 실행되지 않는다)', () => {
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('Retry가 href="" 앵커다 (document.URL 재탐색 = 원래 가려던 주소)', () => {
    expect(html).toMatch(/<a[^>]*class="retry"[^>]*href=""[^>]*>/);
  });

  it('<script> 태그가 없다 (캐시된 nonce는 설치 시점의 죽은 값이라 원리적으로 불가)', () => {
    expect(html).not.toMatch(/<script\b/i);
  });
});

describe('offline.html — 테마 대응', () => {
  const html = read('public/offline.html');

  it('prefers-color-scheme dark 블록이 있다 (여기만 OS 기준 — 의도된 예외)', () => {
    expect(html).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
  });

  it('color-scheme을 선언해 폼/스크롤바 기본색도 따라온다', () => {
    expect(html).toMatch(/color-scheme:\s*light dark/);
  });

  it('다크 값이 _themes.scss 다크 팔레트의 복제본과 일치한다 (drift 가드)', () => {
    const t = darkTokens();
    // dark 미디어의 :root 블록 본문만 뽑는다. 미디어 블록 전체를 중괄호 균형으로 잡으려
    // 하면 안쪽 .icon 규칙 때문에 정규식이 틀린다 — :root 한 겹만 본다.
    const media = html.match(/@media\s*\(prefers-color-scheme:\s*dark\)[\s\S]*?:root\s*\{([\s\S]*?)\}/);
    expect(media, 'dark 미디어의 :root 블록을 못 찾았다').toBeTruthy();
    const block = media[1];
    for (const [cssVar, token] of [
      ['--off-bg', '--color-bg'],
      ['--off-text', '--color-text'],
      ['--off-muted', '--color-text-secondary'],
      ['--off-accent', '--color-primary'],
      ['--off-accent-hover', '--color-primary-hover'],
      ['--off-accent-ink', '--color-text-inverse'],
    ]) {
      const m = block.match(new RegExp(`${cssVar}:\\s*([^;]+);`));
      expect(m, `${cssVar}가 dark 블록에 없다`).toBeTruthy();
      expect(m[1].trim().toUpperCase(), `${cssVar} != ${token}`).toBe(t[token].toUpperCase());
    }
  });
});

describe('offline.html — 오프라인 자산', () => {
  const html = read('public/offline.html');

  it('빌드 자리표시자가 남아 있지 않다 (⟪…⟫ 0건)', () => {
    expect(html, 'LIGHT 자리표시자 잔존').not.toContain('⟪LIGHT_B64⟫');
    expect(html, 'DARK 자리표시자 잔존').not.toContain('⟪DARK_B64⟫');
    expect(html.match(/⟪[^⟫]*⟫/g) ?? [], '치환되지 않은 자리표시자').toEqual([]);
  });

  // 길이 검사는 증거가 못 된다 — 두 SVG의 base64는 둘 다 908자이고 앞 194자가 같다.
  // decode해서 원본 바이트와 대조하는 것만이 light/dark 뒤바뀜·위조를 잡는다.
  it('light data URI가 icons/weave_square.svg 바이트와 정확히 같다', () => {
    const m = html.match(LIGHT_URI);
    expect(m, '<img class="icon">의 base64 data URI를 못 찾았다').toBeTruthy();
    const bytes = Buffer.from(m[1], 'base64');
    expect(bytes.toString('base64'), 'light base64가 정규 인코딩이 아니다').toBe(m[1]);
    expect(bytes.equals(readFileSync(resolve(ROOT, 'public/icons/weave_square.svg'))),
      'light 로고가 weave_square.svg와 다르다').toBe(true);
  });

  it('dark data URI가 dark 미디어 안에 있고 icons/weave_square_dark.svg 바이트와 정확히 같다', () => {
    const body = darkMediaBody(html);
    expect(body, 'prefers-color-scheme: dark 미디어 블록을 못 찾았다').toBeTruthy();
    const m = body.match(DARK_URI);
    expect(m, 'dark 미디어 안의 .icon content: url(data:…)를 못 찾았다').toBeTruthy();
    const bytes = Buffer.from(m[1], 'base64');
    expect(bytes.toString('base64'), 'dark base64가 정규 인코딩이 아니다').toBe(m[1]);
    expect(bytes.equals(readFileSync(resolve(ROOT, 'public/icons/weave_square_dark.svg'))),
      'dark 로고가 weave_square_dark.svg와 다르다').toBe(true);
  });

  it('네트워크를 타는 서브리소스 참조가 0건이다', () => {
    expect(html).not.toMatch(/(?:src|href)="\/(?!\s)/);   // href="" 는 통과, href="/…" 는 실패
    expect(html).not.toMatch(/<link\b[^>]*rel=["']stylesheet/i);
  });
});

describe('sw.js — 캐시 갱신 경로', () => {
  const sw = read('public/sw.js');

  // ⚠️ 종결 따옴표를 넣지 않는다. CACHE_NAME은 'weave-offline-v2-<sha8>' 형태라
  //    /…-v(\d+)'/ 로 잡으면 매치에 실패한다.
  it('CACHE_NAME이 v2 이상이다', () => {
    const m = sw.match(/const CACHE_NAME = 'weave-offline-v(\d+)/);
    expect(m, "CACHE_NAME 선언을 못 찾았다").toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(2);
  });

  // 버전 단정은 단조 래칫이라 offline.html을 몇 번 고쳐도 통과한다.
  // 캐시 이름을 본문 해시에 결속해야 "본문만 고치고 sw.js를 안 올렸다"가 RED가 된다.
  // install은 /sw.js의 바이트 변경으로만 발화하고 캐시 쓰기는 install 안에만 있으므로,
  // 그 실수는 기존 설치자에게 영구 no-op이 된다.
  it('CACHE_NAME이 offline.html 콘텐츠 해시와 결속돼 있다', () => {
    const want = createHash('sha256')
      .update(read('public/offline.html'), 'utf8').digest('hex').slice(0, 8);
    const m = sw.match(/const CACHE_NAME = 'weave-offline-v(\d+)-([0-9a-f]{8})';/);
    expect(m, "CACHE_NAME이 'weave-offline-v<N>-<sha8>' 형태가 아니다").toBeTruthy();
    expect(m[2], `offline.html이 바뀌었는데 sw.js의 CACHE_NAME을 안 올렸다 (기대 ${want})`).toBe(want);
  });

  it('skipWaiting + clients.claim이 살아 있다 (새로고침 1회로 반영되는 근거)', () => {
    expect(sw).toMatch(/self\.skipWaiting\(\)/);
    expect(sw).toMatch(/self\.clients\.claim\(\)/);
  });

  it('activate가 CACHE_NAME 아닌 캐시를 지운다', () => {
    expect(sw).toMatch(/keys\.filter\(\(k\) => k !== CACHE_NAME\)/);
  });

  it('offline.html이 프리캐시 대상이다', () => {
    expect(sw).toMatch(/OFFLINE_URL = '\/offline\.html'/);
    expect(sw).toMatch(/cache\.add\(OFFLINE_URL\)/);
  });

  it('caches.match 미스 시 Response.error()로 방어한다 (respondWith(undefined) 금지)', () => {
    expect(sw).toMatch(/Response\.error\(\)/);
    expect(sw).toMatch(/await caches\.match\(OFFLINE_URL\)/);
  });

  it('navigation 전용 전략을 유지한다 (서브리소스 가로채기로 확대하지 않는다)', () => {
    expect(sw).toMatch(/event\.request\.mode === 'navigate'/);
  });
});

describe('ErrorBoundary — 색이 토큰으로 내려갔다', () => {
  // 두 import 테스트가 같은 추출기를 쓴다. 따옴표 종류·앞뒤 공백·선택적 세미콜론을
  // 모두 인식해야 한쪽만 보는 사각(단일따옴표로 끼워 넣기 등)이 생기지 않는다.
  const stylesImports = (app) =>
    [...app.matchAll(/^\s*import\s+["'](@\/styles\/[^"']+)["'];?\s*$/gm)].map((m) => m[1]);

  it('JSX에 색 리터럴이 0건이다 (class component라 useTheme을 못 쓴다)', () => {
    const src = read('components/Layout/ErrorBoundary.js');
    const hits = [...src.matchAll(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/g)].map((m) => m[0]);
    expect(hits).toEqual([]);
  });

  it('DOM 구조와 요소별 배선이 유지된다 (요소 추가·제거 없이 className만 붙인다)', () => {
    const src = read('components/Layout/ErrorBoundary.js');
    expect((src.match(/<div\b/g) || []).length).toBe(1);
    expect((src.match(/<h2\b/g) || []).length).toBe(1);
    expect((src.match(/<p\b/g) || []).length).toBe(1);
    expect((src.match(/<button\b/g) || []).length).toBe(1);
    expect((src.match(/<AlertTriangle\b/g) || []).length).toBe(1);

    // 요소 수만 세면 className이 통째로 빠져도 통과한다 — 요소별 배선을 exact로 고정한다.
    expect(src, '루트 div의 className').toContain('<div className="ErrorBoundary">');
    expect(src, 'h2의 className').toContain('<h2 className="ErrorBoundary__Title">');
    expect(src, 'p의 className').toContain('<p className="ErrorBoundary__Message">');

    // 버튼은 여는 태그를 통째로 뽑아 공백만 정규화한 뒤 exact 비교한다. 파일 어딘가에
    // className·onClick 문자열이 있기만 하면 통과하는 검사로는 (a) 그 둘이 정말 이
    // button에 붙었는지 (b) disabled 같은 prop이 새로 끼어 새로고침을 막는지 못 본다.
    // (?:=>|[^>]) — onClick 화살표의 '>'에서 태그가 잘리지 않게 한다.
    const btnTags = src.match(/<button\b(?:=>|[^>])*?>/g) || [];
    expect(btnTags.length, 'button 여는 태그는 정확히 하나여야 한다').toBe(1);
    const btn = btnTags[0].replace(/\s+/g, ' ');
    expect(btn, 'className이 바로 이 button에 결속').toContain('className="ErrorBoundary__Button"');
    expect(btn, 'reload onClick이 바로 이 button에 결속').toContain('onClick={() => window.location.reload()}');
    expect(btn, 'button에 임의 prop이 추가됐다').toBe('<button className="ErrorBoundary__Button" onClick={() => window.location.reload()} >');

    // 사용자가 읽는 문구는 "그 요소 안에" 있어야 한다. 파일 어딘가에 같은 문자열이
    // 있기만 하면 통과하는 검사로는 태그·class만 남기고 문구를 지운 빈 오류 화면을 못 잡는다.
    const flat = src.replace(/\s+/g, ' ');
    // 문구는 catalog(t)로 옮겨졌다 — 요소 안에 t() 호출이 그대로 있어야 한다(빈 오류 화면 방지).
    expect(flat, 'h2 제목 문구').toContain('<h2 className="ErrorBoundary__Title"> {t(\'common.state.error\')} </h2>');
    expect(flat, 'p 안내 문구').toContain('<p className="ErrorBoundary__Message"> {t(\'layout.errorBoundary.message\')} </p>');
    expect(flat, 'button 라벨').toContain('<button className="ErrorBoundary__Button" onClick={() => window.location.reload()} > {t(\'layout.errorBoundary.refresh\')} </button>');

    // 아이콘은 태그 전체를 exact 비교한다. prop이 하나라도 늘면 깨진다 —
    // color="red"·color="var(--color-warning)"는 hex 리터럴 검사로 잡히지 않는다.
    const icon = src.match(/<AlertTriangle\b[^>]*\/>/);
    expect(icon, 'AlertTriangle 자기닫힘 태그를 못 찾았다').toBeTruthy();
    expect(icon[0]).toBe('<AlertTriangle className="ErrorBoundary__Icon" size={48} />');
  });

  it('버튼은 React 합성 이벤트를 유지한다 (offline.html과 달리 CSP에 안 걸린다)', () => {
    const src = read('components/Layout/ErrorBoundary.js');
    expect(src).toMatch(/onClick=\{\(\) => window\.location\.reload\(\)\}/);
  });

  it('전용 SCSS가 리터럴 없이 토큰만 쓰고 그 토큰이 제자리에 붙어 있다', () => {
    const scss = read('styles/components/layout/errorBoundary.scss');
    const hits = [...scss.matchAll(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|\b(?:rgba?|hsla?)\(\s*[0-9.]/g)].map((m) => m[0]);
    expect(hits).toEqual([]);

    // toContain(`var(--token)`)만으로는 그 토큰이 "어느 선택자의 어느 속성에" 붙었는지 못 본다.
    // 배경/전경을 맞바꾸거나 hover·focus 규칙을 통째로 지워도 통과한다 — 실제 컴파일
    // 결과에서 selector → property → token을 exact로 결속한다.
    const css = compile(resolve(ROOT, 'styles/components/layout/errorBoundary.scss')).css;
    const decl = {};
    postcss.parse(css).walkRules((rule) => {
      const bag = (decl[rule.selector] ||= {});
      rule.walkDecls((d) => { bag[d.prop] = d.value.trim(); });
    });
    const at = (sel, prop) => decl[sel]?.[prop];

    // 값만 보면 "추가된" 선언은 그대로 통과한다 — pointer-events: none이면 새로고침
    // 버튼이 눌리지 않고 display: none이면 화면이 통째로 사라지는데도 GREEN이다.
    // 규칙 집합과 selector별 property 이름 집합까지 exact로 못박아 승인 안 된 선언을 막는다.
    expect(Object.keys(decl).sort(), '규칙(selector) 집합').toEqual([
      '.ErrorBoundary',
      '.ErrorBoundary__Button',
      '.ErrorBoundary__Button:focus-visible',
      '.ErrorBoundary__Button:hover',
      '.ErrorBoundary__Icon',
      '.ErrorBoundary__Message',
      '.ErrorBoundary__Title',
    ]);
    for (const [sel, want] of [
      ['.ErrorBoundary', ['align-items', 'background', 'color', 'display', 'flex-direction',
                          'font-family', 'gap', 'justify-content', 'min-height', 'padding', 'text-align']],
      ['.ErrorBoundary__Icon', ['color', 'flex-shrink']],
      ['.ErrorBoundary__Title', ['color', 'font-size', 'font-weight']],
      ['.ErrorBoundary__Message', ['font-size', 'max-width']],
      ['.ErrorBoundary__Button', ['background', 'border', 'border-radius', 'color',
                                  'cursor', 'font-size', 'font-weight', 'padding']],
      ['.ErrorBoundary__Button:hover', ['background']],
      ['.ErrorBoundary__Button:focus-visible', ['outline', 'outline-offset']],
    ]) {
      expect(Object.keys(decl[sel] ?? {}).sort(), `${sel} 선언 집합`).toEqual(want);
    }

    expect(at('.ErrorBoundary', 'background'), '화면 배경').toBe('var(--color-bg)');
    expect(at('.ErrorBoundary', 'color'), '설명 텍스트(상속 기본색)').toBe('var(--color-text-secondary)');
    expect(at('.ErrorBoundary__Icon', 'color'), '경고 아이콘(currentColor 상속)').toBe('var(--color-warning)');
    expect(at('.ErrorBoundary__Title', 'color'), '제목').toBe('var(--color-text)');
    expect(at('.ErrorBoundary__Button', 'background'), '버튼 기본 배경').toBe('var(--color-primary)');
    expect(at('.ErrorBoundary__Button', 'color'), '버튼 글자').toBe('var(--color-text-inverse)');
    expect(at('.ErrorBoundary__Button:hover', 'background'), 'hover 배경').toBe('var(--color-primary-hover)');
    expect(at('.ErrorBoundary__Button:focus-visible', 'outline'), 'focus-visible 링').toBe('2px solid var(--color-border-focus)');
    expect(at('.ErrorBoundary__Button:focus-visible', 'outline-offset'), 'focus-visible 링 offset').toBe('2px');

    // 색만 지키면 전체 화면 중앙 정렬·간격·버튼 조작성이 통째로 사라져도 통과한다.
    // 사용자가 실제로 보는 레이아웃과 버튼의 클릭 가능성을 같은 강도로 고정한다.
    // 기대값은 추측이 아니라 정상 컴파일 결과에서 그대로 옮긴 것이다.
    for (const [sel, prop, want, why] of [
      ['.ErrorBoundary', 'display', 'flex', '중앙 정렬 레이아웃'],
      ['.ErrorBoundary', 'flex-direction', 'column', '아이콘→제목→설명→버튼 세로 배치'],
      ['.ErrorBoundary', 'align-items', 'center', '가로 중앙'],
      ['.ErrorBoundary', 'justify-content', 'center', '세로 중앙'],
      ['.ErrorBoundary', 'min-height', '100vh', '전체 화면 높이'],
      ['.ErrorBoundary', 'gap', '16px', '요소 간격'],
      ['.ErrorBoundary', 'padding', '40px 24px', '좁은 화면 여백'],
      ['.ErrorBoundary', 'text-align', 'center', '문구 가운데 정렬'],
      ['.ErrorBoundary', 'font-family', 'inherit', '앱 서체 상속'],
      ['.ErrorBoundary__Icon', 'flex-shrink', '0', '아이콘 찌그러짐 방지'],
      ['.ErrorBoundary__Title', 'font-size', '18px', '제목 크기'],
      ['.ErrorBoundary__Title', 'font-weight', '600', '제목 굵기'],
      ['.ErrorBoundary__Message', 'font-size', '14px', '설명 크기'],
      ['.ErrorBoundary__Message', 'max-width', '480px', '설명 줄길이 제한'],
      ['.ErrorBoundary__Button', 'padding', '8px 20px', '버튼 클릭 영역'],
      ['.ErrorBoundary__Button', 'border', 'none', '버튼 기본 테두리 제거'],
      ['.ErrorBoundary__Button', 'border-radius', '8px', '버튼 모서리'],
      ['.ErrorBoundary__Button', 'font-size', '14px', '버튼 글자 크기'],
      ['.ErrorBoundary__Button', 'font-weight', '500', '버튼 글자 굵기'],
      ['.ErrorBoundary__Button', 'cursor', 'pointer', '버튼 클릭 가능 신호'],
    ]) {
      expect(at(sel, prop), `${sel} { ${prop} } — ${why}`).toBe(want);
    }
  });

  it('_app.js가 errorBoundary.scss를 정확히 1회 로드한다 (이 레포의 SCSS 진입은 _app.js flat import)', () => {
    const app = read('pages/_app.js');
    expect(app).toContain('@/styles/components/layout/errorBoundary.scss');
    // 중복 import는 캐스케이드 순서를 두 곳에서 결정하게 만든다 — 각각 정확히 1회여야 한다.
    const specs = stylesImports(app);
    const count = (spec) => specs.filter((s) => s === spec).length;
    expect(count('@/styles/components/layout/errorBoundary.scss'), 'errorBoundary.scss import 횟수').toBe(1);
    expect(count('@/styles/components/common/storedColor.scss'), 'storedColor.scss import 횟수').toBe(1);
  });

  // 교차 계약 D3: storedColor.scss(S7)가 항상 마지막 styles import다.
  // errorBoundary.scss는 그 바로 앞에 온다 — 순서가 어긋나면 cascade 우선순위가 뒤집힌다.
  it('errorBoundary.scss가 storedColor.scss(S7) 바로 앞이다 (교차 계약 D3)', () => {
    const app = read('pages/_app.js');
    const eb = app.indexOf('@/styles/components/layout/errorBoundary.scss');
    const sc = app.indexOf('storedColor.scss');
    expect(eb, 'errorBoundary.scss import 없음').toBeGreaterThan(-1);
    expect(sc, 'storedColor.scss import 없음 — S7 미완료 신호다. 선행 조건을 다시 확인하라.').toBeGreaterThan(-1);
    expect(eb).toBeLessThan(sc);

    // 상대 순서만으로는 둘 사이에 다른 styles import가 끼어드는 것을 못 막는다.
    // 실제 @/styles import 줄만 뽑아 마지막 두 항목을 exact로 고정한다.
    const specs = stylesImports(app);
    expect(specs.slice(-2)).toEqual([
      '@/styles/components/layout/errorBoundary.scss',
      '@/styles/components/common/storedColor.scss',
    ]);
  });
});
