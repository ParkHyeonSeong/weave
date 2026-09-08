import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { compile } from 'sass';
import postcss from 'postcss';
import TaskFilterBar from '@/components/Branch/TaskFilterBar';
import { STATUS_CATEGORY_TOKENS, PRIORITY_TOKENS, DEFAULT_STATUS_FALLBACK, defaultStatusOptions, tokenVar, statusCategoryVar, priorityVar, FALLBACK_TOKEN, CHIP_COLOR_VAR, CHIP_TINT_PERCENT, chipTintStyle, PRIORITY_INK_TOKENS, priorityInkVar } from './themePalette.js';
import { entityBorderStyle, entityTintStyle } from './entityTint.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('themePalette — 토큰 이름만 돌려준다(hex 금지)', () => {
  it('tokenVar는 토큰 이름을 var() 참조로 감싼다', () => {
    expect(tokenVar('--color-success')).toBe('var(--color-success)');
  });

  it('STATUS_CATEGORY_TOKENS/PRIORITY_TOKENS의 값은 전부 --color- 접두 토큰 이름이다', () => {
    for (const [k, v] of Object.entries({ ...STATUS_CATEGORY_TOKENS, ...PRIORITY_TOKENS })) {
      expect(v, k).toMatch(/^--color-[a-z0-9-]+$/);
    }
  });

  it('모듈이 hex 리터럴을 export하지 않는다 (DEFAULT_STATUS_FALLBACK 포함)', () => {
    const json = JSON.stringify({ STATUS_CATEGORY_TOKENS, PRIORITY_TOKENS, DEFAULT_STATUS_FALLBACK });
    expect(json).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});

describe('themePalette — 백엔드 열거와 키가 정확히 일치한다', () => {
  it('STATUS_CATEGORY_TOKENS 키는 정확히 4개이고 workflow_status validator와 같다', () => {
    // backend/routers/schema/workflow_status.py:23 — ('todo','in_progress','done','cancelled')
    expect(Object.keys(STATUS_CATEGORY_TOKENS).sort())
      .toEqual(['cancelled', 'done', 'in_progress', 'todo']);
  });

  it('백엔드 validator 소스에서 직접 읽은 튜플과 대조한다 (계약 드리프트 감지)', () => {
    const src = readFileSync(resolve(here, '../../backend/routers/schema/workflow_status.py'), 'utf8');
    const m = src.match(/if v not in \(([^)]*)\):/);
    expect(m, 'workflow_status.py의 category validator를 찾지 못했다').not.toBeNull();
    const backend = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(Object.keys(STATUS_CATEGORY_TOKENS).sort()).toEqual(backend);
  });

  it('PRIORITY_TOKENS 키는 백엔드 task validator와 같다', () => {
    // backend/routers/schema/task.py:53 — ('low','medium','high','urgent')
    const src = readFileSync(resolve(here, '../../backend/routers/schema/task.py'), 'utf8');
    const m = src.match(/if v not in \('low'[^)]*\):/);
    expect(m, 'task.py의 priority validator를 찾지 못했다').not.toBeNull();
    const backend = [...m[0].matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort();
    expect(Object.keys(PRIORITY_TOKENS).sort()).toEqual(backend);
  });

  it('blocked는 상태로 실재하지 않으므로 키에 없다', () => {
    expect('blocked' in STATUS_CATEGORY_TOKENS).toBe(false);
  });
});

describe('themePalette — 조회와 폴백', () => {
  it('알려진 카테고리를 var() 참조로 돌려준다', () => {
    expect(statusCategoryVar('done')).toBe('var(--color-success)');
    expect(statusCategoryVar('in_progress')).toBe('var(--color-status-in-progress)');
    expect(statusCategoryVar('cancelled')).toBe('var(--color-error)');
  });

  it('미지 카테고리·우선순위는 text-secondary로 폴백한다', () => {
    expect(FALLBACK_TOKEN).toBe('--color-text-secondary');
    for (const v of ['nope', undefined, null, '', 0]) {
      expect(statusCategoryVar(v)).toBe('var(--color-text-secondary)');
      expect(priorityVar(v)).toBe('var(--color-text-secondary)');
    }
  });

  it('priorityVar는 4값을 각각 돌려준다', () => {
    expect(priorityVar('urgent')).toBe('var(--color-error)');
    expect(priorityVar('high')).toBe('var(--color-warning)');
    expect(priorityVar('medium')).toBe('var(--color-primary)');   // 브랜드색(의미색 아님) — 현행 유지
    expect(priorityVar('low')).toBe('var(--color-text-tertiary)');
  });
});

describe('themePalette — DEFAULT_STATUS_FALLBACK', () => {
  it('시드 4개와 같은 순서·key이고 라벨은 카탈로그 키, color는 var() 참조다', () => {
    // backend/core/model/workflow_status.py:97-100 seed_defaults.
    // 라벨은 모듈 상수라 t를 쓸 수 없어 **키**만 두고 defaultStatusOptions(t)가 렌더 시점에 푼다.
    expect(DEFAULT_STATUS_FALLBACK).toEqual([
      { value: 'todo',        labelKey: 'branch.statusCategory.todo',       color: 'var(--color-text-secondary)' },
      { value: 'in_progress', labelKey: 'branch.statusCategory.inProgress', color: 'var(--color-status-in-progress)' },
      { value: 'done',        labelKey: 'branch.statusCategory.done',       color: 'var(--color-success)' },
      { value: 'cancelled',   labelKey: 'branch.statusCategory.cancelled',  color: 'var(--color-error)' },
    ]);
  });

  it('defaultStatusOptions(t)가 현재 언어 라벨로 푼다', () => {
    const options = defaultStatusOptions((key) => `<${key}>`);
    expect(options).toEqual([
      { value: 'todo',        label: '<branch.statusCategory.todo>',       color: 'var(--color-text-secondary)' },
      { value: 'in_progress', label: '<branch.statusCategory.inProgress>', color: 'var(--color-status-in-progress)' },
      { value: 'done',        label: '<branch.statusCategory.done>',       color: 'var(--color-success)' },
      { value: 'cancelled',   label: '<branch.statusCategory.cancelled>',  color: 'var(--color-error)' },
    ]);
  });
});

describe('themePalette — 참조 토큰이 _themes.scss :root에 실재한다', () => {
  it('참조 토큰 중 :root 미정의가 0건이다', () => {
    const src = readFileSync(resolve(here, '../styles/_themes.scss'), 'utf8');
    const root = src.match(/:root\s*\{([\s\S]*?)\n\}/);
    expect(root, '_themes.scss의 :root 블록을 찾지 못했다').not.toBeNull();
    const defined = new Set(root[1].match(/--[a-z0-9-]+(?=\s*:)/g) || []);
    const referenced = [...new Set([
      ...Object.values(STATUS_CATEGORY_TOKENS),
      ...Object.values(PRIORITY_TOKENS),
      FALLBACK_TOKEN,
    ])];
    expect(referenced.filter((t) => !defined.has(t))).toEqual([]);
  });
});

describe('themePalette 소비 — 우선순위 옵션 배열에 hex가 남아 있지 않다', () => {
  const FILES = [
    'components/Branch/Tasks/TaskListRow.js',
    'components/Branch/Tasks/TaskDetailPanel.js',
    'components/Branch/Tasks/TaskFullPage.js',
    'components/Branch/TaskFilterBar.js',
    'components/MyTasks/MyTasksView.js',
    'components/Branch/FilterBuilder.js',
  ];

  // ⚠️ 스코프는 **우선순위 옵션 배열 블록**뿐이다. 파일 전역이 아니다.
  //    이 6파일에는 사용자/서버 **저장색 폴백**(에픽 색·타입 색의 `?? 기본값`)이 남는다.
  //    그것들은 S7 stored-color 후속 소유이고 이 슬라이스가 손대지 않는다.
  //    ⚠️ 정정(S9 Task 7): 에픽 'None' 옵션은 저장색 폴백이 **아니라** "에픽 없음"을 뜻하는
  //    앱 중립색이라 S9가 --color-text-secondary로 이행했다. 더 이상 S7 소유가 아니다.
  //    파일 전역 hex를 금지하면 S7 이전까지 영구 RED가 되어 회귀 감시가 아니라 방해가 된다.
  //
  // 블록 경계 = `value: 'urgent'` 줄 ~ `value: 'low'` 줄(양끝 포함).
  // 6파일 모두 이 두 앵커가 정확히 1회씩만 나온다(계획 Task 7 실측표).
  const priorityBlock = (f) => {
    const lines = readFileSync(resolve(here, '..', f), 'utf8').split('\n');
    const hits = (re) => lines.reduce((a, l, i) => (re.test(l) ? [...a, i] : a), []);
    const s = hits(/value:\s*'urgent'/);
    const e = hits(/value:\s*'low'/);
    expect(s.length, `${f}: value: 'urgent' 앵커가 1회가 아니다`).toBe(1);
    expect(e.length, `${f}: value: 'low' 앵커가 1회가 아니다`).toBe(1);
    expect(e[0], `${f}: 앵커 순서가 뒤집혔다`).toBeGreaterThan(s[0]);
    return lines.slice(s[0], e[0] + 1).join('\n');
  };

  it('6파일의 우선순위 옵션 블록에 hex 리터럴이 없다', () => {
    const offenders = [];
    for (const f of FILES) {
      for (const m of priorityBlock(f).match(/#[0-9a-fA-F]{3,8}\b/g) || []) offenders.push(`${f}: ${m}`);
    }
    expect(offenders).toEqual([]);
  });

  it('6파일의 우선순위 옵션 블록이 priorityVar를 4회 호출한다', () => {
    const bad = [];
    for (const f of FILES) {
      const n = (priorityBlock(f).match(/priorityVar\(/g) || []).length;
      if (n !== 4) bad.push(`${f}: priorityVar ${n}회`);
    }
    expect(bad).toEqual([]);
  });

  it('지정 6파일이 themePalette를 import한다', () => {
    const missing = FILES.filter(
      (f) => !readFileSync(resolve(here, '..', f), 'utf8').includes('themePalette'),
    );
    expect(missing).toEqual([]);
  });
});

describe('cancelled 카테고리 커버리지 — 4카테고리를 다루는 곳이 3개만 열거하지 않는다', () => {
  const JS_FILES = [
    'components/Branch/FilterBuilder.js',
    'components/Branch/Epics/EpicDetailPanel.js',
    'components/Branch/Tasks/TaskFullPage.js',
    'components/Track/BulkAddModal.js',
  ];
  const SCSS_FILES = [
    'styles/components/branch/taskList.scss',
    'styles/components/myTasks/myTasks.scss',
  ];

  it('JS: in_progress를 열거하는 파일은 cancelled도 열거한다', () => {
    const bad = JS_FILES.filter((f) => {
      const src = readFileSync(resolve(here, '..', f), 'utf8');
      return src.includes("'in_progress'") && !src.includes("'cancelled'");
    });
    expect(bad).toEqual([]);
  });

  it('SCSS: &--in_progress 상태 modifier가 있는 파일은 &--cancelled도 갖는다', () => {
    const bad = SCSS_FILES.filter((f) => {
      const src = readFileSync(resolve(here, '..', f), 'utf8');
      return src.includes('&--in_progress') && !src.includes('&--cancelled');
    });
    expect(bad).toEqual([]);
  });

  it('canceled(l 1개) 오타가 없다', () => {
    const bad = [...JS_FILES, ...SCSS_FILES].filter((f) =>
      /\bcanceled\b/.test(readFileSync(resolve(here, '..', f), 'utf8')),
    );
    expect(bad).toEqual([]);
  });
});

describe('themePalette 소비 — TaskListRow 상태 폴백이 공용 상수로 통합됐다', () => {
  const F = 'components/Branch/Tasks/TaskListRow.js';
  const src = () => readFileSync(resolve(here, '..', F), 'utf8');

  it('workflowStatuses가 비었을 때 공용 폴백을 현재 언어로 푼다', () => {
    expect(src()).toMatch(/import \{[^}]*defaultStatusOptions[^}]*\} from '@\/library\/themePalette'/);
    expect(src()).toMatch(/:\s*defaultStatusOptions\(t\);/);
  });

  it('로컬 상태 옵션 상수를 다시 만들지 않는다', () => {
    // 통합 전 로컬 상수(DEFAULT_STATUS_OPTIONS, hex 4색)가 부활하면 RED.
    expect(src()).not.toMatch(/DEFAULT_STATUS_OPTIONS/);
    expect(src()).not.toMatch(/label:\s*'In Progress'/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 활성 필터 칩 틴트 — 저장색(#RRGGBB)과 토큰 참조(var(--color-*)) 양쪽에서 유효해야 한다
//
// 선재현(수정 전 HEAD): TaskFilterBar가 `backgroundColor: chip.color + '15'`로 알파를 이어 붙였다.
//   priority 칩의 chip.color는 priorityVar()가 돌려주는 토큰 참조라 결과가
//   `background-color: var(--color-error)15` — var() 치환 후 문법 검사에서 탈락하는 무효 선언이다.
//   background-color는 상속되지 않으므로 unset=initial=transparent가 되어 틴트가 사라진다
//   (실브라우저 실측 computed rgba(0, 0, 0, 0) / SSR 실측 아래 렌더 문자열과 일치).
//   statusKeys·labelIds·epicIds 칩은 chip.color가 DB 저장 hex라 같은 코드에서 계속 동작했다
//   — 그래서 회귀 감시는 **두 경로를 모두** 렌더해서 확인한다.
//
// ⚠️ 옵션 배열만 보는 검사로는 이 결함을 못 잡는다(옵션 배열의 color는 정상 토큰이다).
//    아래는 @testing-library 없이 react-dom/server로 **실제 TaskFilterBar를 렌더**해
//    브라우저에 실제로 나가는 style 속성 문자열을 직접 검사한다.
// ═════════════════════════════════════════════════════════════════════════════

// 완결된 CSS 색 값만 허용하는 **앵커** 검사. `var(--color-error)15`처럼 참조 뒤에 무언가
// 이어 붙은 값은 여기서 탈락한다(= 되돌리기 mutation의 RED 지점).
const COMPLETE_COLOR_VALUE = /^(?:#[0-9a-fA-F]{3,8}|var\(--[a-z0-9-]+\))$/;

function parseInlineStyle(attr) {
  const out = {};
  for (const part of String(attr).split(';')) {
    if (!part) continue;
    const i = part.indexOf(':');
    expect(i, `선언에 콜론이 없다: ${part}`).toBeGreaterThan(0);
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const BASE_PROPS = {
  members: [],
  searchQuery: '',
  onSearchChange: () => {},
  selectedUserIds: new Set(),
  onToggleUser: () => {},
  onToggleFilter: () => {},
  onClearFilters: () => {},
};

// 실제 컴포넌트를 SSR로 렌더하고 활성 칩 span + 제거 버튼의 class/style을 그대로 뽑는다.
// 정규식이 마크업 모양에 엄격한 것은 의도다 — 칩 렌더 구조가 바뀌면 chips.length 단정에서 RED가 된다.
// 제거 버튼도 supported 저장색에서 EntityInk가 **추가로** 붙으므로 클래스를 통째로 캡처한다.
// 부모·버튼 양쪽의 실제 클래스를 결과에 담아 각 상태에서 exact 단정을 건다.
const CHIP_RE = new RegExp(
  '<span class="(TaskFilterBar__ActiveChip[^"]*)"( style="([^"]*)")?>([^<]*)'
  + '<button type="button" class="(TaskFilterBar__ActiveChipRemove[^"]*)"( style="([^"]*)")?>',
  'g',
);

function renderChips(props) {
  const html = renderToStaticMarkup(<TaskFilterBar {...BASE_PROPS} {...props} />);
  return [...html.matchAll(CHIP_RE)].map((m) => ({
    classes: m[1].split(' ').filter(Boolean),
    styleAttr: m[3],            // 속성 자체가 없으면 undefined
    label: m[4],
    removeClasses: m[5].split(' ').filter(Boolean),
    removeStyleAttr: m[7],
  }));
}

describe('활성 필터 칩 — 실제 TaskFilterBar 렌더가 유효한 CSS만 내보낸다 (finding 1 회귀)', () => {
  it('우선순위 칩(토큰 색)의 인라인 style 값이 전부 완결된 CSS 색이다', () => {
    const chips = renderChips({ filters: { priorities: new Set(['urgent']) } });
    expect(chips.map((c) => c.label)).toEqual(['Urgent']);
    const decls = parseInlineStyle(chips[0].styleAttr);
    expect(Object.keys(decls).length).toBeGreaterThan(0);
    for (const [prop, value] of Object.entries(decls)) {
      // 되돌리면 background-color: var(--color-error)15 가 되어 여기서 RED.
      expect(value, `${prop}: ${value}`).toMatch(COMPLETE_COLOR_VALUE);
    }
  });

  it('style 속성 어디에도 var() 참조 뒤에 이어 붙은 문자가 없다', () => {
    const chips = renderChips({
      filters: { priorities: new Set(['urgent', 'high', 'medium', 'low']) },
    });
    expect(chips).toHaveLength(4);
    for (const c of chips) {
      // `var(--x)15` → `)1` 매치 → RED. 정상은 `)` 뒤가 `;` 또는 문자열 끝뿐이다.
      expect(`${c.styleAttr};`, c.label).not.toMatch(/\)[^;]/);
      expect(`${c.removeStyleAttr};`, `${c.label} remove`).not.toMatch(/\)[^;]/);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // S7 하이브리드 계약 (호출표 9·10행, 2026-08-26 A안) — 네 상태를 SSR 행동으로 고정한다.
  //   ① 토큰 참조 var(--color-*)  → 기존 --chip-color 경로 exact 보존, Entity* 없음
  //   ② supported #RRGGBB        → entityTint 경로, --et-* + Entity* 클래스
  //   ③ passthrough(red·#1a6)    → 기존 --chip-color 경로, Entity* 없음
  //   ④ blank                    → style 없음, tint/Entity 클래스 없음
  // ②를 ①·③으로 되돌리면(또는 그 반대로) 각 상태의 exact 단정이 RED가 된다.
  // ═══════════════════════════════════════════════════════════════════════════

  it('상태 ① 우선순위 토큰 4종 — --chip-color 경로 exact 보존, Entity* 없음', () => {
    const chips = renderChips({
      filters: { priorities: new Set(['urgent', 'high', 'medium', 'low']) },
    });
    expect(chips.map((c) => c.label)).toEqual(['Urgent', 'High', 'Medium', 'Low']);
    const expected = ['urgent', 'high', 'medium', 'low'].map((p) => priorityVar(p));
    chips.forEach((c, i) => {
      // 부모·버튼 클래스를 exact로 잡는다 — Entity*가 하나라도 새어 들어오면 RED.
      expect(c.classes, c.label).toEqual(['TaskFilterBar__ActiveChip', 'TaskFilterBar__ActiveChip--tinted']);
      expect(c.removeClasses, c.label).toEqual(['TaskFilterBar__ActiveChipRemove']);
      expect(parseInlineStyle(c.styleAttr)).toEqual({ [CHIP_COLOR_VAR]: expected[i] });
      expect(parseInlineStyle(c.removeStyleAttr)).toEqual({ color: expected[i] });
      expect(c.styleAttr, c.label).not.toContain('--et-');
    });
  });

  it('상태 ② DB 저장색(원시 hex) — EntityTint/EntityBorder/EntityInk + --et-* (--chip-color 없음)', () => {
    const chips = renderChips({
      filters: {
        statusKeys: new Set(['done']),
        labelIds: new Set([7]),
        epicIds: new Set([3]),
      },
      workflowStatuses: [{ key: 'done', label: 'Done', color: '#16A34A' }],
      labels: [{ label_id: 7, label_name: 'bug', color: '#DC2626' }],
      epics: [{ epic_id: 3, epic_name: 'Alpha', color: '#5E6AD2' }],
    });
    expect(chips.map((c) => c.label)).toEqual(['Done', 'bug', 'Alpha']);
    ['#16A34A', '#DC2626', '#5E6AD2'].forEach((hex, i) => {
      const c = chips[i];
      expect(c.classes, hex).toEqual(['TaskFilterBar__ActiveChip', 'EntityTint', 'EntityBorder']);
      expect(c.removeClasses, hex).toEqual(['TaskFilterBar__ActiveChipRemove', 'EntityInk']);
      // 정본 인자 { from: 8, alpha: '15' } / entityBorderStyle(색) 을 그대로 재현한 기대값.
      // from을 바꾸거나 entityBorderStyle을 빠뜨리면 여기가 RED다.
      const tint = entityTintStyle(hex, { from: 8, alpha: '15' });
      const bd = entityBorderStyle(hex);
      expect(parseInlineStyle(c.styleAttr), hex).toEqual({
        '--et-on': '1',
        '--et-bg': tint['--et-bg'],
        '--et-fg': tint['--et-fg'],
        '--et-bg-dark': tint['--et-bg-dark'],
        '--et-fg-dark': tint['--et-fg-dark'],
        background: 'var(--et-bg)',
        color: 'var(--et-fg)',
        '--et-bd': bd['--et-bd'],
        '--et-bd-dark': bd['--et-bd-dark'],
        'border-color': 'var(--et-bd)',
      });
      // 제거 버튼은 부모 칩이 내려놓은 --et-fg를 상속으로 쓴다.
      expect(parseInlineStyle(c.removeStyleAttr), hex).toEqual({ color: 'var(--et-fg)' });
      // 이 상태에서는 옛 통로가 남으면 안 된다.
      expect(c.styleAttr, hex).not.toContain(CHIP_COLOR_VAR);
      expect(c.classes, hex).not.toContain('TaskFilterBar__ActiveChip--tinted');
      // 두 테마 값이 실제로 갈렸는지 — 같은 값이면 다크 보정이 없는 것이다.
      expect(tint['--et-bg'], hex).not.toBe(tint['--et-bg-dark']);
    });
  });

  it.each([['red'], ['#1a6']])(
    '상태 ③ passthrough %s — 기존 --chip-color 경로 유지, Entity*도 --et-*도 없다', (raw) => {
      const chips = renderChips({
        filters: { labelIds: new Set([7]) },
        labels: [{ label_id: 7, label_name: 'bug', color: raw }],
      });
      expect(chips).toHaveLength(1);
      const c = chips[0];
      expect(c.classes).toEqual(['TaskFilterBar__ActiveChip', 'TaskFilterBar__ActiveChip--tinted']);
      expect(c.removeClasses).toEqual(['TaskFilterBar__ActiveChipRemove']);
      expect(parseInlineStyle(c.styleAttr)).toEqual({ [CHIP_COLOR_VAR]: raw });
      expect(parseInlineStyle(c.removeStyleAttr)).toEqual({ color: raw });
      // passthrough 결과(`red15` 등)를 이 표면에 렌더하면 여기가 RED다.
      expect(c.styleAttr).not.toContain('--et-');
      expect(c.styleAttr).not.toContain('background');
    });

  it('상태 ④ 색 없는 칩(Type) — style도 tint/Entity 클래스도 달지 않는다', () => {
    const chips = renderChips({
      filters: { typeKeys: new Set(['task']) },
      taskTypes: [{ type_key: 'task', type_name: 'Task' }],
    });
    expect(chips.map((c) => c.label)).toEqual(['Task']);
    expect(chips[0].styleAttr).toBeUndefined();
    expect(chips[0].classes).toEqual(['TaskFilterBar__ActiveChip']);
    expect(chips[0].removeClasses).toEqual(['TaskFilterBar__ActiveChipRemove']);
    expect(chips[0].removeStyleAttr).toBeUndefined();
  });

  // 회귀: blank 판정을 `chip.color ?` truthiness로 하면 공백 문자열과 비문자열이 여기서 샌다.
  // entityTintStyle은 이 값들에 undefined(=blank)를 돌려주는데 truthiness는 true라
  // --tinted 클래스와 `--chip-color:'  '`(무효 선언)가 붙는다. 판정은 storedTint 존재 여부 하나뿐이다.
  it.each([['공백만', '  '], ['탭·개행', '\t\n'], ['비문자열 42', 42], ['빈 문자열', ''], ['null', null]])(
    '상태 ④ blank(%s) — style도 tint/Entity 클래스도 달지 않는다', (_name, bad) => {
      const chips = renderChips({
        filters: { labelIds: new Set([7]) },
        labels: [{ label_id: 7, label_name: 'bug', color: bad }],
      });
      expect(chips).toHaveLength(1);
      expect(chips[0].classes).toEqual(['TaskFilterBar__ActiveChip']);
      expect(chips[0].styleAttr).toBeUndefined();
      expect(chips[0].removeClasses).toEqual(['TaskFilterBar__ActiveChipRemove']);
      expect(chips[0].removeStyleAttr).toBeUndefined();
    });

  it('제거 버튼의 color는 네 상태 전부에서 완결된 CSS 색이다', () => {
    const tokenChip = renderChips({ filters: { priorities: new Set(['urgent']) } })[0];
    expect(parseInlineStyle(tokenChip.removeStyleAttr)).toEqual({ color: priorityVar('urgent') });
    expect(parseInlineStyle(tokenChip.removeStyleAttr).color).toMatch(COMPLETE_COLOR_VALUE);

    // supported 저장색은 부모가 내려놓은 --et-fg를 상속으로 쓴다(원색 직접 지정 아님) —
    // 그래야 다크에서 storedColor.scss의 .EntityInk가 --et-fg-dark로 덮을 수 있다.
    const hexChip = renderChips({
      filters: { statusKeys: new Set(['done']) },
      workflowStatuses: [{ key: 'done', label: 'Done', color: '#16A34A' }],
    })[0];
    expect(parseInlineStyle(hexChip.removeStyleAttr)).toEqual({ color: 'var(--et-fg)' });
    expect(parseInlineStyle(hexChip.removeStyleAttr).color).toMatch(COMPLETE_COLOR_VALUE);
    expect(hexChip.removeClasses).toContain('EntityInk');

    // passthrough는 오늘처럼 원 색 그대로.
    const passChip = renderChips({
      filters: { labelIds: new Set([7]) },
      labels: [{ label_id: 7, label_name: 'bug', color: 'red' }],
    })[0];
    expect(parseInlineStyle(passChip.removeStyleAttr)).toEqual({ color: 'red' });
    expect(passChip.removeClasses).toEqual(['TaskFilterBar__ActiveChipRemove']);

    // 색 없는 칩은 제거 버튼에도 style이 붙지 않는다.
    const plain = renderChips({
      filters: { typeKeys: new Set(['task']) },
      taskTypes: [{ type_key: 'task', type_name: 'Task' }],
    })[0];
    expect(plain.removeStyleAttr).toBeUndefined();
  });

  it('TaskFilterBar 소스가 칩 색에 문자열을 이어 붙이지 않는다', () => {
    const src = readFileSync(resolve(here, '../components/Branch/TaskFilterBar.js'), 'utf8');
    const code = src.split('\n').map((l) => l.split('//')[0]).join('\n'); // 주석 제외
    expect(code).not.toMatch(/chip\.color\s*\+/);
    expect(code).toContain('chipTintStyle(chip.color)');
  });
});

describe('chipTintStyle — 색을 가공하지 않고 커스텀 프로퍼티로만 넘긴다', () => {
  it('색을 그대로 --chip-color에 싣는다(토큰·hex 불문)', () => {
    expect(chipTintStyle('var(--color-error)')).toEqual({ '--chip-color': 'var(--color-error)' });
    expect(chipTintStyle('#16A34A')).toEqual({ '--chip-color': '#16A34A' });
  });

  it('색이 없으면 style을 만들지 않는다', () => {
    for (const v of [undefined, null, '', 0]) expect(chipTintStyle(v)).toBeUndefined();
  });

  it('CHIP_COLOR_VAR는 보호 접두(--color-/--track-/--shadow-)가 아니다', () => {
    // 보호 네임스페이스를 컴포넌트가 주입하면 themeTokens.test.js의 P4 선언 금지 계약과 충돌한다.
    expect(CHIP_COLOR_VAR).toBe('--chip-color');
    expect(CHIP_COLOR_VAR).not.toMatch(/^--(?:color|track|shadow)-/);
  });
});

describe('칩 틴트 SCSS 계약 — 0x15 알파를 color-mix로 보존한다', () => {
  const compiled = compile(resolve(here, '../styles/components/branch/taskList.scss')).css;
  const ruleOf = (selector) => {
    const found = [];
    postcss.parse(compiled).walkRules((r) => {
      if (r.selectors.some((p) => p.trim() === selector)) found.push(r);
    });
    expect(found.length, `${selector} 규칙이 정확히 1개가 아니다`).toBe(1);
    return found[0];
  };
  const declsOf = (selector) => {
    const out = {};
    ruleOf(selector).walkDecls((d) => { out[d.prop] = d.value; });
    return out;
  };

  it('--tinted 규칙이 테두리·글자·배경을 전부 --chip-color에서 파생한다', () => {
    const d = declsOf('.TaskFilterBar__ActiveChip--tinted');
    expect(d['border-color']).toBe('var(--chip-color)');
    expect(d.color).toBe('var(--chip-color)');
    expect(d['background-color']).toBe(
      `color-mix(in srgb, var(--chip-color) ${CHIP_TINT_PERCENT}%, transparent)`,
    );
  });

  it('틴트 퍼센트가 옛 8자리 hex 알파 0x15(=21/255)와 같은 값이다', () => {
    // #RRGGBB15 → 알파 21/255 = 0.0823529411…  → 8.235294…%
    expect(CHIP_TINT_PERCENT).toBeCloseTo((0x15 / 0xff) * 100, 5);
    const m = declsOf('.TaskFilterBar__ActiveChip--tinted')['background-color']
      .match(/color-mix\(in srgb, var\(--chip-color\) ([0-9.]+)%, transparent\)/);
    expect(m, 'background-color가 레포 관용구 color-mix(in srgb, <색> N%, transparent) 형태가 아니다').not.toBeNull();
    expect(Number(m[1])).toBe(CHIP_TINT_PERCENT);   // JS 상수와 SCSS가 같은 수여야 한다
  });

  it('--tinted가 base 칩 규칙보다 뒤에 와서 border-color를 이긴다(동일 specificity)', () => {
    // base는 `border: 1px solid var(--color-border)` 축약이라 순서가 뒤집히면 테두리 색이 죽는다.
    expect(ruleOf('.TaskFilterBar__ActiveChip').source.start.offset)
      .toBeLessThan(ruleOf('.TaskFilterBar__ActiveChip--tinted').source.start.offset);
  });
});

// ── Track 우선순위: 테두리색과 텍스트 ink를 분리한다 (S9 pre-commit correction) ──
// 우선순위 색(--color-*)은 **테두리·식별용**이고, 같은 값을 텍스트에 그대로 쓰면 카드 표면에서
// 대비가 무너진다. 실측: --color-warning(#D97706)을 흰 카드 위 글자로 쓰면 3.19:1로 AA 미달이다.
// 그래서 ink는 별도 매핑(--color-warning-ink)을 쓰고, 테두리는 원래 우선순위 색을 유지한다.
describe('우선순위 ink는 Track 카드 표면에서 AA를 넘는다', () => {
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const relLum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // ⚠️ TrackTree helper와 규율을 통일한다 — 색 파싱이 조용히 NaN이면 비교가 false라 통과하고,
  //    반올림 뒤에 비교하면 4.4951이 4.5로 올라가 미달이 통과한다.
  const hexFinite = (v) => {
    const a = hex(v);
    expect(a.every(Number.isFinite), `색을 파싱하지 못했다: ${v}`).toBe(true);
    return a;
  };
  const rawRatio = (a, b) => {
    const [l1, l2] = [relLum(hexFinite(a)), relLum(hexFinite(b))];
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const ratio = (a, b) => Math.round(rawRatio(a, b) * 100) / 100;
  // ⚠️ 값을 손으로 적지 않는다 — _themes.scss를 컴파일해 읽는다. 스냅샷을 박아 두면 팔레트가
  //    바뀌어도 테스트가 옛 값으로 초록을 유지한다(드리프트 무감지).
  const THEMES = { light: {}, dark: {} };
  postcss.parse(compile(resolve(here, '..', 'styles/_themes.scss')).css).walkRules((rule) => {
    const dark = /\[data-theme=['"]?dark['"]?\]/.test(rule.selector);
    rule.walkDecls((d) => { if (d.prop.startsWith('--')) THEMES[dark ? 'dark' : 'light'][d.prop] = d.value.trim(); });
  });
  // 배지가 실제로 놓이는 표면 = --track-card (TrackDetail 패널의 PrioPill)
  const CARD = { light: THEMES.light['--track-card'], dark: THEMES.dark['--track-card'] };

  it('ink 매핑이 우선순위 색 매핑과 별개다 (high만 갈린다)', () => {
    expect(Object.keys(PRIORITY_INK_TOKENS).sort()).toEqual(Object.keys(PRIORITY_TOKENS).sort());
    expect(PRIORITY_INK_TOKENS.high, 'high 텍스트는 --color-warning-ink를 쓴다').toBe('--color-warning-ink');
    expect(PRIORITY_INK_TOKENS.high).not.toBe(PRIORITY_TOKENS.high);
    for (const k of ['urgent', 'medium', 'low'])
      expect(PRIORITY_INK_TOKENS[k], `${k}는 우선순위 색을 그대로 쓴다`).toBe(PRIORITY_TOKENS[k]);
  });

  it('네 우선순위 텍스트가 라이트·다크 모두 4.5 이상이다', () => {
    const bad = [];
    for (const [prio, tok] of Object.entries(PRIORITY_INK_TOKENS)) {
      for (const theme of ['light', 'dark']) {
        const ink = THEMES[theme][tok];
        expect(ink, `${tok}이 ${theme} 팔레트에 없다`).toBeTruthy();
        const raw = rawRatio(ink, CARD[theme]);            // 반올림 전에 비교한다
        if (raw < 4.5) bad.push(`${prio}/${theme}: ${tok} ${ink} on ${CARD[theme]} = ${Math.round(raw * 1000) / 1000}`);
      }
    }
    expect(bad, `Track 카드 표면에서 AA 미달:\n${bad.join('\n')}`).toEqual([]);
  });

  it('테두리는 우선순위 색을 유지한다 (ink로 갈아끼우지 않는다)', () => {
    expect(priorityVar('high')).toBe('var(--color-warning)');
    expect(priorityInkVar('high')).toBe('var(--color-warning-ink)');
  });

  // ⚠️ Track의 우선순위 텍스트 표면은 **둘**이다: TrackDetail 패널의 PrioPill(위 단정)과
  //    TrackTree의 Priority 컬럼(track.scss). 후자는 토큰 매핑을 쓰지 않고 SCSS가 직접 색을 칠한다.
  //
  // ⛔ 원시 track.scss를 정규식으로 읽지 마라. 주석에 정답 선언을 남기고 실제 선언을 되돌리면
  //    `indexOf('&--urgent {')`가 **주석을 먼저** 집어 위장이 통과한다(실측: 저대비 복귀가 초록).
  //    Sass로 컴파일하면 주석은 사라지고 실제로 캐스케이드에 나가는 선언만 남는다.
  // ⛔ prop별로 **마지막 값만** 접지 마라. 잘못된 `color: … !important`를 앞에 두고 정답 선언을
  //    뒤에 두면 마지막 값만 보는 수집기는 통과하지만 실제 캐스케이드는 !important가 이긴다(실측).
  //    선언을 전부 배열로 모으고 개수·important까지 단정한다.
  const trackRules = (() => {
    const css = compile(resolve(here, '..', 'styles/components/track/track.scss')).css;
    const byMod = {};
    postcss.parse(css).walkRules((rule) => {
      for (const sel of rule.selectors) {
        const m = sel.match(/\.TrackTree__Priority--(urgent|high|medium|low)$/);
        if (!m) continue;
        const bag = (byMod[m[1]] ||= { rules: 0, decls: [] });
        bag.rules += 1;
        rule.walkDecls((d) => bag.decls.push({
          prop: d.prop, value: d.value.trim(), important: Boolean(d.important),
        }));
      }
    });
    return byMod;
  })();
  const BG_PROPS = new Set(['background', 'background-color', 'background-image']);
  const onlyDecl = (mod, pred, label) => {
    const hits = trackRules[mod].decls.filter(pred);
    expect(hits, `${mod}: ${label} 선언은 정확히 1개여야 한다`).toHaveLength(1);
    expect(hits[0].important, `${mod}: ${label}에 !important가 붙었다`).toBe(false);
    return hits[0].value;
  };

  it('TrackTree Priority의 실제 컴파일된 선언이 개수·important까지 exact다', () => {
    const EXPECT = {
      urgent: { bg: 'var(--color-error-bg)',                                       ink: 'var(--color-error-strong)' },
      high:   { bg: 'var(--color-warning-bg)',                                     ink: 'var(--color-warning-ink)' },
      medium: { bg: 'color-mix(in srgb, var(--color-primary) 8%, transparent)',    ink: 'var(--color-primary-hover)' },
      low:    { bg: 'color-mix(in srgb, var(--track-ink-soft) 16%, transparent)',  ink: 'var(--track-ink-soft)' },
    };
    expect(Object.keys(trackRules).sort()).toEqual(Object.keys(EXPECT).sort());
    for (const [mod, want] of Object.entries(EXPECT)) {
      // 규칙 수까지 건다 — 뒤에 오버라이드 규칙이 붙으면 앞 선언만 보고 통과할 수 있다.
      expect(trackRules[mod].rules, `${mod} 규칙 수`).toBe(1);
      expect(onlyDecl(mod, (d) => BG_PROPS.has(d.prop), 'background 계열')).toBe(want.bg);
      expect(onlyDecl(mod, (d) => d.prop === 'color', 'color')).toBe(want.ink);
      expect(trackRules[mod].decls.some((d) => d.important), `${mod}에 !important 선언이 있다`).toBe(false);
    }
  });

  it('잘못된 !important 선언을 앞에 두면 RED다', () => {
    // 컴파일 결과를 흉내내지 않고, 수집기가 무엇을 보는지 직접 건다.
    const poisoned = [
      { prop: 'color', value: 'var(--color-primary)', important: true },
      { prop: 'background', value: 'var(--color-error-bg)', important: false },
      { prop: 'color', value: 'var(--color-error-strong)', important: false },
    ];
    const hits = poisoned.filter((d) => d.prop === 'color');
    expect(hits, 'color 선언이 2개면 계약 위반이다').toHaveLength(2);
    expect(hits.some((d) => d.important), '!important를 못 봤다').toBe(true);
  });

  it('TrackTree Priority 컬럼이 네 우선순위 × 양 테마 × 행 3상태에서 4.5 이상이다', () => {
    const px = (v) => {
      const a = String(v).startsWith('#')
        ? [1, 3, 5].map((i) => parseInt(String(v).slice(i, i + 2), 16))
        : String(v).match(/[\d.]+/g).slice(0, 3).map(Number);
      // ⚠️ 색 파싱이 조용히 NaN이 되면 대비가 NaN이 되고 `< 4.5` 비교가 false라 통과한다.
      expect(a.every(Number.isFinite), `색을 파싱하지 못했다: ${v}`).toBe(true);
      return a;
    };
    const mix = (fg, pct, bg) => px(fg).map((c, i) => c * (pct / 100) + px(bg)[i] * (1 - pct / 100));
    const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const RL = (a) => 0.2126 * lin(a[0]) + 0.7152 * lin(a[1]) + 0.0722 * lin(a[2]);
    const rawRatio = (a, b) => (Math.max(RL(px(a)), RL(px(b))) + 0.05) / (Math.min(RL(px(a)), RL(px(b))) + 0.05);
    const tokenOf = (expr, M) => {
      const v = String(expr).match(/var\((--[a-z0-9-]+)\)/i);
      expect(v, `토큰 참조가 아니다: ${expr}`).toBeTruthy();
      const val = M[v[1]];
      expect(val, `${v[1]}이 팔레트에 없다`).toBeTruthy();
      return val;
    };
    const bad = [];
    const declOf = (mod) => ({
      background: trackRules[mod].decls.filter((d) => BG_PROPS.has(d.prop)).slice(-1)[0].value,
      color: trackRules[mod].decls.filter((d) => d.prop === 'color').slice(-1)[0].value,
    });
    for (const mod of Object.keys(trackRules)) {
      const decl = declOf(mod);
      for (const theme of ['light', 'dark']) {
        const M = THEMES[theme];
        const rows = {
          base: px(M['--track-card']),
          hover: mix(M['--color-primary'], 2.5, M['--track-paper']),
          selected: mix(M['--color-primary'], 6, M['--track-paper']),
        };
        const pct = (decl.background.match(/(\d+(?:\.\d+)?)%/) || [])[1];   // color-mix면 행이 비친다
        for (const [state, rowBg] of Object.entries(rows)) {
          const surface = pct ? mix(tokenOf(decl.background, M), Number(pct), rowBg) : px(tokenOf(decl.background, M));
          // ⚠️ **반올림 전에** 비교한다. 4.4951을 4.5로 반올림해 통과시키지 않는다.
          const raw = rawRatio(tokenOf(decl.color, M), surface);
          if (raw < 4.5) bad.push(`${mod}/${theme}/${state} = ${Math.round(raw * 1000) / 1000}`);
        }
      }
    }
    expect(bad, `TrackTree Priority 컬럼 AA 미달:\n${bad.join('\n')}`).toEqual([]);
  });
});
