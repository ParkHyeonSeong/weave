import { describe, it, expect } from 'vitest';
import { COLOR_CATEGORIES, COLOR_EXCEPTIONS, findException } from './colorExceptions.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Parser as AcornParser } from 'acorn';   // devDep — 추가 설치 없음
import acornJsx from 'acorn-jsx';
import { ROOT, hitsFor, sweepFile } from './literalColorSweep.js';
import { TEXT_COLORS, HIGHLIGHT_COLORS, CELL_BG_COLORS } from './tiptapColorMap.js';

const REQUIRED_KEYS = ['file', 'selector', 'prop', 'value', 'category', 'reason'];

describe('colorExceptions — 분류 체계 계약', () => {
  it('분류는 정확히 8종이고 이름이 고정이다', () => {
    expect(COLOR_CATEGORIES).toEqual([
      'theme-dependent', 'fixed-on-color', 'overlay-scrim',
      'print-paper', 'palette-source', 'stored-color', 'third-party', 'dead',
    ]);
  });

  it('theme-dependent는 레지스트리에 등록될 수 없다 (이행 대상이지 예외가 아니다)', () => {
    const bad = COLOR_EXCEPTIONS.filter((e) => e.category === 'theme-dependent');
    expect(bad.map((e) => `${e.file}:${e.prop}:${e.value}`)).toEqual([]);
  });
});

describe('colorExceptions — 항목 shape 계약', () => {
  it('모든 항목이 6키를 갖고 여분 키가 없다', () => {
    const bad = COLOR_EXCEPTIONS.filter(
      (e) => Object.keys(e).sort().join(',') !== [...REQUIRED_KEYS].sort().join(','),
    );
    expect(bad.map((e) => `${e.file}:${e.value}:[${Object.keys(e).join(',')}]`)).toEqual([]);
  });

  it('모든 항목이 유효한 category를 갖는다', () => {
    // 유효 집합 = COLOR_CATEGORIES 8종. 단 theme-dependent는 위 describe가 별도로 원천 차단한다.
    const bad = COLOR_EXCEPTIONS.filter((e) => !COLOR_CATEGORIES.includes(e.category));
    expect(bad.map((e) => `${e.file}: ${e.category}`)).toEqual([]);
  });

  it('reason은 20자 이상이다 (왜 토큰을 쓸 수 없는가를 적는다)', () => {
    const bad = COLOR_EXCEPTIONS.filter((e) => typeof e.reason !== 'string' || e.reason.trim().length < 20);
    expect(bad.map((e) => `${e.file}:${e.value} reason=${JSON.stringify(e.reason)}`)).toEqual([]);
  });

  it('file은 frontend/ 기준 상대경로이고 실재한다', async () => {
    const { existsSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const bad = COLOR_EXCEPTIONS.filter(
      (e) => e.file.startsWith('/') || e.file.startsWith('frontend/') || !existsSync(resolve(here, '..', e.file)),
    );
    expect(bad.map((e) => e.file)).toEqual([]);
  });

  it('selector는 스윕이 그 소스에서 실제로 만들어내는 형태여야 한다', () => {
    // 스캐너의 구조적 소스는 넷이다: postcss decl(.scss/.css) · HTML <style> 블록과
    // style="…" 속성(.html) · JSX style={{…}} 객체(.js/.jsx) · SVG/HTML 색 속성.
    // ⚠️ 예전 계약은 ".scss/.css만 selector를 갖는다"였는데, 그건 HTML <style>·JSX [style]
    //    소스가 생기기 전 이야기다. 그대로 두면 offline.html의 `:root`와 JSX의 `[style]`이
    //    형식 위반으로 뜬다 — 둘 다 스캐너가 정말로 그렇게 내는 값이다.
    const bad = COLOR_EXCEPTIONS.filter((e) => {
      const s = e.selector;
      if (e.file.endsWith('.scss') || e.file.endsWith('.css')) return typeof s !== 'string' || !s;
      if (e.file.endsWith('.html')) return s !== null && (typeof s !== 'string' || !s);
      if (/\.jsx?$/.test(e.file)) return s !== null && s !== '[style]';
      return s !== null;   // svg·json 등은 색 속성이라 selector가 없다
    });
    expect(bad.map((e) => `${e.file}: selector=${JSON.stringify(e.selector)}`)).toEqual([]);
  });

  it('중복 튜플은 허용되며, 그 개수가 곧 소비 예산이다', () => {
    // ⚠️ 교차 계약 D2. 유일성을 단정하지 **않는다**.
    // S9의 literalColorSweep은 consume-once 매칭이다 — 같은 (file, selector, prop, value)가
    // 소스에 N번 나오면 레지스트리에도 N개 있어야 한다. 유일성을 강제하면 S9가 RED가 된다.
    // 이 테스트는 "중복이 있어도 통과"를 명시적으로 고정해 다음 사람이 유일성 단정을 되살리지 못하게 한다.
    const budget = new Map();
    for (const e of COLOR_EXCEPTIONS) {
      const k = JSON.stringify([e.file, e.selector, e.prop, e.value]);
      budget.set(k, (budget.get(k) || 0) + 1);
    }
    expect([...budget.values()].reduce((a, b) => a + b, 0)).toBe(COLOR_EXCEPTIONS.length);
    expect([...budget.values()].every((n) => n >= 1)).toBe(true);
  });
});

describe('colorExceptions — findException 조회', () => {
  it('등록되지 않은 튜플은 undefined를 돌려준다', () => {
    expect(findException('styles/__nope__.scss', '.X', 'color', '#ABCDEF')).toBeUndefined();
  });

  it('등록된 튜플은 그 항목을 돌려준다 (합성 항목으로 조회 규약만 검증)', () => {
    const probe = COLOR_EXCEPTIONS[0];
    if (!probe) return;   // Task 1 시점엔 비어 있다 — Task 4 이후 실효
    expect(findException(probe.file, probe.selector, probe.prop, probe.value)).toBe(probe);
  });
});

// S7이 소유를 주장하는 파일과, 그 파일에서 S7이 **등록하지 않는** hit의 판별식.
// CanvasEditorToolbar의 콜아웃 아이콘 4건은 S9 Task 7 소유다(§15-2 B6).
const S7_FILES = [
  'styles/components/common/storedColor.scss',
  'library/tiptapColorMap.js',
  'components/Canvas/CanvasEditorToolbar.js',
  'library/colorContrast.js',
  'library/entityTint.js',
];
// S9 Task 7로 넘겼던 네 튜플은 **이행이 끝나 비었다**(콜아웃 아이콘 → 상태 토큰).
// 면제 예산이 0이므로 이제 툴바에 인라인 색이 하나라도 생기면 곧바로 미등록 hit으로 드러난다.
// ⛔ 여기에 값을 다시 채우지 마라 — 채우는 순간 그 색은 등록도 이행도 없이 통과한다.
// ⛔ `selector !== null`을 통째로 제외하는 우회도 금지다 — 새 인라인 색이 조용히 빠져나간다.
const TOOLBAR = 'components/Canvas/CanvasEditorToolbar.js';
const S9_DEFERRED = [];
const tupleKey = (h) => `${h.file}|${h.selector ?? '-'}|${h.prop ?? '-'}|${h.value}`;

// hits를 (S7이 등록할 것, S9로 넘긴 것)으로 가른다. 면제 예산은 튜플당 1회뿐이다.
function partitionS7(hits) {
  const budget = new Map();
  for (const d of S9_DEFERRED) budget.set(tupleKey(d), (budget.get(tupleKey(d)) || 0) + 1);
  const s7 = [];
  const deferred = [];
  for (const h of hits) {
    const k = tupleKey(h);
    if ((budget.get(k) || 0) > 0) { budget.set(k, budget.get(k) - 1); deferred.push(h); }
    else s7.push(h);
  }
  return { s7, deferred, unusedBudget: [...budget].filter(([, n]) => n > 0).map(([k]) => k) };
}

// ⚠️ key에 category를 **포함**한다. (file, selector, prop, value)만 보면 분류를 바꿔도
//    GREEN이라 "근거를 구분한다"는 계약이 기계로 지켜지지 않는다.
const key = (e) => `${e.file}|${e.selector ?? '-'}|${e.prop ?? '-'}|${e.value}|${e.category}`;
const bag = (arr) => arr.reduce((m, e) => m.set(key(e), (m.get(key(e)) || 0) + 1), new Map());

// 파일/역할별 기대 분류 — Step 4a의 분류 규칙과 같은 정본이다.
const LIGHT_PALETTE = new Set([...TEXT_COLORS, ...HIGHLIGHT_COLORS, ...CELL_BG_COLORS]);
const expectedCategory = (h) => {
  if (h.file === 'styles/components/common/storedColor.scss') return 'stored-color';
  if (h.file === 'library/colorContrast.js') return 'fixed-on-color';
  if (h.file === 'library/entityTint.js') return 'palette-source';
  if (h.file === 'components/Canvas/CanvasEditorToolbar.js') return 'palette-source';
  // tiptapColorMap.js — 라이트 팔레트 리터럴과 TEXT_INK_BASE는 원천, 산출값은 저장색 대응
  if (h.prop === 'TEXT_INK_BASE') return 'palette-source';
  return LIGHT_PALETTE.has(h.value.toUpperCase()) ? 'palette-source' : 'stored-color';
};
const CATEGORY_TOTALS = { 'stored-color': 86, 'palette-source': 85, 'fixed-on-color': 4 };

describe('S7 예외가 스윕 hit와 정확히 일치한다', () => {
  const hits = S7_FILES.flatMap((rel) =>
    partitionS7(hitsFor(rel, readFileSync(resolve(ROOT, rel), 'utf8'))).s7);
  const registered = COLOR_EXCEPTIONS.filter((e) => S7_FILES.includes(e.file));

  it('hit multiset === 등록 multiset — 누락 0 · 잉여 0 · multiplicity 차 0 · category exact', () => {
    const H = bag(hits.map((h) => ({ ...h, category: expectedCategory(h) })));
    const R = bag(registered);
    const missing = [...H].filter(([k, n]) => (R.get(k) || 0) < n)
      .map(([k, n]) => `${k}  (hit ${n} > 등록 ${R.get(k) || 0})`);
    const extra = [...R].filter(([k, n]) => (H.get(k) || 0) < n)
      .map(([k, n]) => `${k}  (등록 ${n} > hit ${H.get(k) || 0})`);
    expect(missing, '미등록 hit').toEqual([]);
    expect(extra, '죽은 예외').toEqual([]);
    expect(registered).toHaveLength(hits.length);   // multiplicity 총합까지 일치
  });

  it.each(S7_FILES)('%s: over === [] · dead === []', (rel) => {
    const r = sweepFile(rel, readFileSync(resolve(ROOT, rel), 'utf8'));
    const over = rel === TOOLBAR
      ? partitionS7(r.overHits).s7.map((h) => `${h.file}:${h.line} | ${h.value}`)   // 콜아웃 4건만 S9 몫
      : r.over;
    expect(over).toEqual([]);
    expect(r.dead).toEqual([]);
  });

  it('category 분포가 정본과 exact다', () => {
    const dist = registered.reduce((m, e) => ({ ...m, [e.category]: (m[e.category] || 0) + 1 }), {});
    expect(dist).toEqual(CATEGORY_TOTALS);          // stored-color 86 · palette-source 85 · fixed-on-color 4
    // palette-source 75 → 79: entityTint.js 표면 프로파일이 2값 → 6출현으로 늘었다(2026-08-31 blocker correction).
    // palette-source 79 → 85: surface-overlay·track-header·task-list-raised 3프로파일 6출현 추가
    //   (2026-08-31 최종 surface correction — 팝업 idle·헤더 그라데이션 하단·선택/하위 행).
    expect(registered).toHaveLength(175);   // 169 → 175: 위 palette-source 증가분
  });

  it('스윕이 읽는 단일 export에 S7 항목이 들어 있다', () => {
    // 별도 배열만 export하고 COLOR_EXCEPTIONS에 합치지 않으면 여기서 0이 된다
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.some((e) => e.category === 'stored-color')).toBe(true);
    expect(registered.some((e) => e.category === 'palette-source')).toBe(true);
    expect(registered.some((e) => e.category === 'fixed-on-color')).toBe(true);
    expect(COLOR_EXCEPTIONS.some((e) => e.category === 'theme-dependent')).toBe(false);
  });
});

describe('S9 이관 4건은 consume-once로만 면제된다', () => {
  const toolbarSrc = readFileSync(resolve(ROOT, TOOLBAR), 'utf8');
  const bag = (arr) => arr.reduce((m, e) => m.set(tupleKey(e), (m.get(tupleKey(e)) || 0) + 1), new Map());
  // 변형된 소스에서 "등록되지 않은 S7 hit"을 센다. 제품 파일은 디스크에서 건드리지 않는다.
  const unregisteredS7 = (src) => {
    const { s7 } = partitionS7(hitsFor(TOOLBAR, src));
    const R = bag(COLOR_EXCEPTIONS.filter((e) => e.file === TOOLBAR));
    const H = bag(s7);
    return [...H].filter(([k, n]) => (R.get(k) || 0) < n).map(([k, n]) => `${k} (hit ${n} > 등록 ${R.get(k) || 0})`);
  };

  // ✅ S9 Task 7에서 콜아웃 아이콘 4건을 토큰으로 이행했다 → 면제는 **4 → 0**이 된다.
  //    이제 툴바에 남는 것은 팔레트 상수 26건(S7 palette-source)뿐이고, 이관 예산은 비어야 한다.
  //    ⛔ 이 단정을 4로 되돌리지 마라 — 되돌리면 리터럴이 다시 들어와도 초록이 된다.
  it('이행이 끝나 deferred가 0건이다 (면제 예산이 소진되지 않고 사라졌다)', () => {
    const { deferred, unusedBudget } = partitionS7(hitsFor(TOOLBAR, toolbarSrc));
    expect(deferred, '아직 이관 대상 인라인 색이 남아 있다').toHaveLength(0);
    expect(unusedBudget, '면제 예산이 남아 있다 — S9_DEFERRED를 비워야 한다').toEqual([]);
  });

  it('S9 이관 4건은 colorExceptions.js에 등록하지 않는다', () => {
    for (const d of S9_DEFERRED) {
      expect(COLOR_EXCEPTIONS.some((e) => tupleKey(e) === tupleKey(d)), `${d.value}가 등록돼 있다`).toBe(false);
    }
  });

  it('현재 소스는 미등록 S7 hit이 0건이다 (대조군)', () => {
    expect(unregisteredS7(toolbarSrc)).toEqual([]);
  });

  it('새 인라인 색(#ABCDEF)을 추가하면 RED다', () => {
    const mutated = `${toolbarSrc}\nconst __probe = <i style={{ color: '#ABCDEF' }} />;\n`;
    expect(mutated).not.toBe(toolbarSrc);
    const { deferred } = partitionS7(hitsFor(TOOLBAR, mutated));
    expect(deferred).toHaveLength(0);                       // 면제는 이제 0건이다
    expect(unregisteredS7(mutated)).toHaveLength(1);        // 새 색이 그대로 드러난다
    expect(unregisteredS7(mutated)[0]).toContain('#ABCDEF');
  });

  it('이행했던 색을 되돌려 넣어도 RED다 (면제가 사라졌으므로 되돌림이 드러난다)', () => {
    const mutated = `${toolbarSrc}\nconst __dup = <i style={{ color: '#DC2626' }} />;\n`;
    expect(mutated).not.toBe(toolbarSrc);
    const { deferred } = partitionS7(hitsFor(TOOLBAR, mutated));
    expect(deferred).toHaveLength(0);                       // 면제 예산이 0이라 아무것도 빠져나가지 못한다
    const missing = unregisteredS7(mutated);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('#DC2626');
    expect(missing[0]).toContain('[style]');
  });
});

// ── Canvas 콜아웃 아이콘: 종류 ↔ 상태 토큰 exact 결속 (S9 Task 7) ──────────────
// 네 콜아웃은 의미 상태색이라 토큰이 정답이다. 값만 보면 Info와 Error를 맞바꿔도,
// style을 통째로 지워도 통과한다 — **콜아웃 종류와 토큰의 짝**을 직접 건다.
describe('Canvas 콜아웃 아이콘이 상태 토큰과 정확히 짝지어진다', () => {
  const CALLOUT = {
    info:    { icon: 'Info',          token: 'var(--color-status-in-progress)' },
    warning: { icon: 'AlertTriangle', token: 'var(--color-warning)' },
    success: { icon: 'CheckCircle2',  token: 'var(--color-success)' },
    error:   { icon: 'XCircle',       token: 'var(--color-error)' },
  };
  const src = readFileSync(resolve(ROOT, TOOLBAR), 'utf8');
  const parse = (text) => AcornParser.extend(acornJsx())
    .parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
  const walk = (n, fn) => {
    if (!n || typeof n.type !== 'string') return;
    fn(n);
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn));
      else if (v && typeof v.type === 'string') walk(v, fn);
    }
  };
  const jsxName = (n) => (n && n.type === 'JSXIdentifier' ? n.name : null);

  // ── 콜아웃 메뉴를 앵커로 잡는다 ────────────────────────────────────────────
  // ⛔ 파일 전체에서 button을 긁지 않는다. 죽은 button(`{false && <button …/>}`)을 하나 더 두면
  //    정상 배선이 섞여 들어와 위장이 통과한다(실측). `openDropdown === 'callout' && (…)`가
  //    실제로 렌더하는 메뉴의 **직접 자식 button**만 계약 대상이다.
  const calloutMenu = (ast) => {
    let menu = null;
    walk(ast, (n) => {
      if (n.type !== 'LogicalExpression' || n.operator !== '&&') return;
      const l = n.left;
      const isGuard = l.type === 'BinaryExpression' && l.operator === '==='
        && l.left.type === 'Identifier' && l.left.name === 'openDropdown'
        && l.right.type === 'Literal' && l.right.value === 'callout';
      if (!isGuard) return;
      let r = n.right;
      while (r && r.type === 'JSXExpressionContainer') r = r.expression;
      if (r && r.type === 'JSXElement') menu = r;
    });
    return menu;
  };

  // 함수 스코프에서 아이콘 이름을 가리는 선언(예: `const Info = XCircle`)을 모은다.
  // ⚠️ import 바인딩만 보면 함수 안 재선언으로 <Info>가 다른 컴포넌트를 렌더해도 통과한다(실측).
  const shadowedNames = (ast) => {
    const out = new Set();
    for (const n of ast.body) {                      // 최상위 선언은 import가 정본이므로 제외
      if (n.type === 'VariableDeclaration') for (const d of n.declarations)
        if (d.id.type === 'Identifier') out.add(`__top__${d.id.name}`);
    }
    walk(ast, (n) => {
      const inFn = n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression'
        || n.type === 'ArrowFunctionExpression';
      if (inFn) {
        for (const prm of n.params) walk(prm, (m) => { if (m.type === 'Identifier') out.add(m.name); });
        walk(n.body, (m) => {
          if (m.type !== 'VariableDeclarator' || m.id.type !== 'Identifier') return;
          out.add(m.id.name);
        });
      }
    });
    return out;
  };

  const menuButtons = (text) => {
    const ast = parse(text);
    const menu = calloutMenu(ast);
    const shadow = shadowedNames(ast);
    if (!menu) return { buttons: [], shadow, menuFound: false };
    const buttons = menu.children
      .filter((c) => c.type === 'JSXElement' && jsxName(c.openingElement.name) === 'button')
      .map((b) => {
        const calls = [];
        for (const a of b.openingElement.attributes) {
          if (a.type !== 'JSXAttribute' || jsxName(a.name) !== 'onClick') continue;
          walk(a.value, (m) => {
            if (m.type !== 'CallExpression') return;
            const isTC = (m.callee.type === 'MemberExpression' && m.callee.property.name === 'toggleCallout')
              || (m.callee.type === 'Identifier' && m.callee.name === 'toggleCallout');
            if (!isTC) return;
            const arg = m.arguments[0];
            calls.push(arg && arg.type === 'Literal' ? arg.value : null);
          });
        }
        const icons = b.children.filter((c) => c.type === 'JSXElement').map((c) => {
          const name = jsxName(c.openingElement.name);
          let token = null;
          for (const a of c.openingElement.attributes) {
            if (a.type !== 'JSXAttribute' || jsxName(a.name) !== 'style') continue;
            walk(a.value, (m) => {
              if (m.type === 'Property' && m.key.type === 'Identifier' && m.key.name === 'color'
                && m.value.type === 'Literal' && typeof m.value.value === 'string') token = m.value.value;
            });
          }
          return { icon: name, token, shadowed: shadow.has(name) };
        });
        return { calls, icons };
      });
    return { buttons, shadow, menuFound: true };
  };

  const wiringFor = (text, kind) => {
    const { buttons } = menuButtons(text);
    const hit = buttons.filter((b) => b.calls.length === 1 && b.calls[0] === kind);
    if (hit.length !== 1 || hit[0].icons.length !== 1) return null;
    const { icon, token, shadowed } = hit[0].icons[0];
    return shadowed ? { icon, token, shadowed: true } : { icon, token };
  };

  it('콜아웃 메뉴의 직접 자식 button이 정확히 4개이고 각 onClick의 toggleCallout이 정확히 1개다', () => {
    const { buttons, menuFound } = menuButtons(src);
    expect(menuFound, "openDropdown === 'callout' 메뉴를 못 찾았다").toBe(true);
    expect(buttons, '메뉴의 직접 자식 button 수').toHaveLength(4);
    for (const b of buttons) {
      expect(b.calls, 'onClick의 toggleCallout 호출 수는 1이어야 한다').toHaveLength(1);
      expect(typeof b.calls[0], 'kind는 문자열 리터럴이어야 한다').toBe('string');
      expect(b.icons, 'button의 직접 자식 아이콘 수').toHaveLength(1);
    }
    expect(buttons.map((b) => b.calls[0]).sort()).toEqual(Object.keys(CALLOUT).sort());
  });

  it('네 종류가 각각 지정된 아이콘·토큰과 exact로 짝지어져 있다', () => {
    const actual = {};
    for (const kind of Object.keys(CALLOUT)) actual[kind] = wiringFor(src, kind);
    expect(actual).toEqual(CALLOUT);
  });

  it('(a) 조건식으로 kind를 위장하면 RED다 (toggleCallout 호출이 2개가 된다)', () => {
    const mutated = src.replace(
      "onClick={() => { editor.chain().focus().toggleCallout('info').run(); closeDropdown(); }}>",
      "onClick={() => { false && editor.chain().focus().toggleCallout('info');"
      + " editor.chain().focus().toggleCallout('error').run(); closeDropdown(); }}>");
    expect(mutated, '위장 앵커를 못 찾았다').not.toBe(src);
    const bad = menuButtons(mutated).buttons.filter((b) => b.calls.length !== 1);
    expect(bad, 'toggleCallout 호출이 2개인 button을 못 잡았다').toHaveLength(1);
    expect(wiringFor(mutated, 'info'), '위장된 info는 확정되지 않아야 한다').toBeNull();
  });

  it('(b) 함수 내부 const Info = XCircle 로 가리면 RED다', () => {
    const anchor = 'export default function CanvasEditorToolbar(';
    const i = src.indexOf(anchor);
    const j = src.indexOf('\n', src.indexOf('{', i));
    const mutated = `${src.slice(0, j + 1)}  const Info = XCircle;\n${src.slice(j + 1)}`;
    expect(mutated, 'shadow 앵커를 못 찾았다').not.toBe(src);
    expect(menuButtons(mutated).shadow.has('Info'), 'shadow 선언을 못 봤다').toBe(true);
    expect(wiringFor(mutated, 'info')).toEqual({ icon: 'Info', token: CALLOUT.info.token, shadowed: true });
    expect(wiringFor(mutated, 'info')).not.toEqual(CALLOUT.info);
  });

  it('(c) 죽은 전체 button으로 정상 배선을 위장하면 RED다', () => {
    // 라벨은 catalog(t)로 옮겨졌다 — 앵커도 현재 소스 형태를 따른다.
    const real = `            <button className="CanvasEditorToolbar__DropdownItem"
              onClick={() => { editor.chain().focus().toggleCallout('info').run(); closeDropdown(); }}>
              <Info size={14} style={{ color: 'var(--color-status-in-progress)' }} /> {t('canvas.editor.calloutInfo')}
            </button>`;
    const mutated = src.replace(real, `            {false && (\n${real}\n            )}
            <button className="CanvasEditorToolbar__DropdownItem"
              onClick={() => { editor.chain().focus().toggleCallout('info').run(); closeDropdown(); }}>
              <XCircle size={14} style={{ color: 'var(--color-error)' }} /> {t('canvas.editor.calloutInfo')}
            </button>`);
    expect(mutated, '위장 앵커를 못 찾았다').not.toBe(src);
    // 죽은 button은 JSXExpressionContainer 안이라 직접 자식이 아니다 → 메뉴 자식은 여전히 4개,
    // 그중 info 자리는 실제로 렌더되는 XCircle/error다.
    expect(menuButtons(mutated).buttons, '직접 자식만 세야 한다').toHaveLength(4);
    expect(wiringFor(mutated, 'info')).toEqual({ icon: 'XCircle', token: 'var(--color-error)' });
    expect(wiringFor(mutated, 'info')).not.toEqual(CALLOUT.info);
  });

  it('토큰을 서로 맞바꾸면 RED다 (Info ↔ Error)', () => {
    const mutated = src
      .replace("<Info size={14} style={{ color: 'var(--color-status-in-progress)' }} />",
               "<Info size={14} style={{ color: 'var(--color-error)' }} />")
      .replace("<XCircle size={14} style={{ color: 'var(--color-error)' }} />",
               "<XCircle size={14} style={{ color: 'var(--color-status-in-progress)' }} />");
    expect(mutated, '맞바꿈 앵커를 못 찾았다').not.toBe(src);
    expect(wiringFor(mutated, 'info').token).toBe('var(--color-error)');
    expect(wiringFor(mutated, 'error').token).toBe('var(--color-status-in-progress)');
  });

  it('style 배선을 지우면 RED다', () => {
    for (const kind of Object.keys(CALLOUT)) {
      const { icon, token } = CALLOUT[kind];
      const mutated = src.replace(` style={{ color: '${token}' }}`, '');
      expect(mutated, `${kind} style 앵커를 못 찾았다`).not.toBe(src);
      expect(wiringFor(mutated, kind).token, `${icon}의 style이 사라졌는데 통과했다`).toBeNull();
    }
  });

  it('아이콘 컴포넌트를 바꿔도 RED다', () => {
    const mutated = src.replace("<Info size={14} style={{ color: 'var(--color-status-in-progress)' }} />",
                                "<Bell size={14} style={{ color: 'var(--color-status-in-progress)' }} />");
    expect(mutated).not.toBe(src);
    expect(wiringFor(mutated, 'info').icon).toBe('Bell');
  });

  const localBindings = (text) => {
    const out = {};
    for (const n of parse(text).body) {
      if (n.type !== 'ImportDeclaration' || n.source.value !== 'lucide-react') continue;
      for (const s of n.specifiers) if (s.type === 'ImportSpecifier') out[s.local.name] = s.imported.name;
    }
    return out;
  };

  it('아이콘의 local 이름이 lucide의 imported 이름과 같다 (별칭 위장 금지)', () => {
    const bound = localBindings(src);
    for (const [kind, { icon }] of Object.entries(CALLOUT)) {
      expect(bound[icon], `${kind}의 아이콘 ${icon}이 lucide-react에서 import되지 않았다`).toBeTruthy();
      expect(bound[icon], `${kind}: <${icon}>이 실제로는 ${bound[icon]}을 렌더한다`).toBe(icon);
    }
  });

  it('별칭 위장(XCircle as Info)은 RED다', () => {
    const mutated = src.replace('  Info, AlertTriangle, CheckCircle2, XCircle,',
                                '  XCircle as Info, AlertTriangle, CheckCircle2, XCircle,');
    expect(mutated, '별칭 앵커를 못 찾았다').not.toBe(src);
    expect(localBindings(mutated).Info).toBe('XCircle');
  });
});
