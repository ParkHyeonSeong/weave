// 상태 **카테고리**·우선순위 색의 단일 원천. **CSS 토큰 이름만** 돌려주고 hex는 돌려주지 않는다
// — hex를 돌려주면 컴포넌트가 다시 테마를 못 따라가는 값을 인라인 style에 박게 된다.
// library/ 아래여야 vitest.config.mjs:22의 include('library/**/*.test.js')에 걸린다.
// environment가 'node'이므로 DOM·React 의존을 넣지 말 것.
//
// ⛔ 상태 **key**로 색을 고르는 API를 만들지 마라. key는 브랜치별 사용자 정의(^[a-z][a-z0-9_]{0,49}$,
//    workflow_status.py:16)이고 색은 DB workflow_status.color가 authority다 — 렌더는 S7 소유.
//    코드 상수로 매핑 가능한 것은 고정 열거인 **category** 4개뿐이다.

export const FALLBACK_TOKEN = '--color-text-secondary';

// backend/routers/schema/workflow_status.py:23 validator가 강제하는 4값. 이 4개가 전부다.
export const STATUS_CATEGORY_TOKENS = {
  todo:        '--color-text-secondary',
  in_progress: '--color-status-in-progress',
  done:        '--color-success',
  cancelled:   '--color-error',
};

// backend/routers/schema/task.py:53 validator가 강제하는 4값.
export const PRIORITY_TOKENS = {
  urgent: '--color-error',
  high:   '--color-warning',
  // medium은 --color-primary(브랜드색)다. **의미색이 아니다.**
  // 6개 컴포넌트가 전부 라이트 --color-primary 값을 쓰고 있어 현행 유지가 라이트 동치다.
  // 의미색(예: --color-status-in-progress)으로 바꾸는 것은 별도 결정 사항이며 이 슬라이스 범위 밖.
  medium: '--color-primary',
  low:    '--color-text-tertiary',
};

export function tokenVar(name) {
  return `var(${name})`;
}

export function statusCategoryVar(category) {
  return tokenVar(STATUS_CATEGORY_TOKENS[category] || FALLBACK_TOKEN);
}

export function priorityVar(priority) {
  return tokenVar(PRIORITY_TOKENS[priority] || FALLBACK_TOKEN);
}

// 우선순위 색과 **텍스트 ink는 다른 축이다.** 위 PRIORITY_TOKENS는 테두리·식별 표시에 쓰는
// 우선순위 색이고, 같은 값을 글자에 그대로 쓰면 표면에 따라 대비가 무너진다.
// 실측: --color-warning을 흰 Track 카드 위 글자로 쓰면 3.19:1로 WCAG AA(4.5) 미달이다.
// high만 한 단계 어두운 잉크(--color-warning-ink → 5.02:1)로 갈고 나머지는 같다.
// (값은 여기 적지 않는다 — 이 파일도 색 스윕 대상이라 주석의 hex가 hit이 된다.)
// ⛔ 이 매핑을 PRIORITY_TOKENS로 되돌리지 마라 — 테두리가 어두워지고 high 텍스트가 다시 미달이 된다.
export const PRIORITY_INK_TOKENS = {
  urgent: PRIORITY_TOKENS.urgent,
  high:   '--color-warning-ink',
  medium: PRIORITY_TOKENS.medium,
  low:    PRIORITY_TOKENS.low,
};

export function priorityInkVar(priority) {
  return tokenVar(PRIORITY_INK_TOKENS[priority] || FALLBACK_TOKEN);
}

// workflowStatuses가 **빈 배열일 때만** 쓰는 폴백. 서버가 상태를 내려주면 이건 절대 안 쓰인다.
// 순서·key는 시드(backend/core/model/workflow_status.py:97-100)와 같게 둔다.
// 라벨은 모듈 상수라 t를 쓸 수 없으므로 카탈로그 **키**만 두고, 렌더 시점에 defaultStatusOptions(t)가 푼다.
export const DEFAULT_STATUS_FALLBACK = [
  { value: 'todo',        labelKey: 'branch.statusCategory.todo',       color: statusCategoryVar('todo') },
  { value: 'in_progress', labelKey: 'branch.statusCategory.inProgress', color: statusCategoryVar('in_progress') },
  { value: 'done',        labelKey: 'branch.statusCategory.done',       color: statusCategoryVar('done') },
  { value: 'cancelled',   labelKey: 'branch.statusCategory.cancelled',  color: statusCategoryVar('cancelled') },
];

/** 폴백 상태 목록을 현재 언어로 푼 형태({value,label,color})로 돌려준다. */
export function defaultStatusOptions(t) {
  return DEFAULT_STATUS_FALLBACK.map((s) => ({ value: s.value, label: t(s.labelKey), color: s.color }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 색 위에 얹는 **알파 틴트**의 단일 원천.
//
// ⛔ 색 문자열에 알파 접미사를 이어 붙이지 마라 (`color + '15'`). 이 색은 두 종류가 섞여 들어온다:
//    ① DB 저장색(라벨·에픽·워크플로 상태) = 원시 `#RRGGBB`
//    ② 위 priorityVar()/statusCategoryVar()가 돌려주는 토큰 참조 = `var(--color-error)`
//    ②에 '15'를 붙이면 `var(--color-error)15`가 되는데, var()를 포함한 선언은 계산값 시점에
//    치환된 뒤 문법 검사를 받으므로 이건 **무효 선언**이 된다(IACVT). background-color는 상속되지
//    않는 속성이라 unset=initial=transparent로 떨어져 **틴트가 통째로 사라진다**
//    (실측: computed background-color가 완전 투명으로 떨어진다).
//
// 그래서 JS는 색을 **가공하지 않고** 커스텀 프로퍼티로 실어 보내기만 하고, 틴트는 SCSS가
// color-mix로 만든다(레포 관용구 `color-mix(in srgb, <색> N%, transparent)`).
// 소비처: styles/components/branch/taskList.scss `.TaskFilterBar__ActiveChip--tinted`.

export const CHIP_COLOR_VAR = '--chip-color';

// 0x15 / 0xFF × 100 — 옛 8자리 hex 알파 `#RRGGBB15`(=21/255)의 시각 의미를 퍼센트로 옮긴 값.
// srgb에서 `color-mix(in srgb, C p%, transparent)`는 premultiplied 합성이라 결과가 정확히
// "C를 알파 p/100으로 칠한 것"과 같다 — 그래서 이 수만 맞으면 옛 렌더와 동치다.
// ⚠️ SCSS의 color-mix 퍼센트와 **같은 수**여야 한다(themePalette.test.js가 두 값을 대조한다).
export const CHIP_TINT_PERCENT = 8.235294;

// 활성 필터 칩의 인라인 style. 색이 없으면 style 자체를 달지 않는다(기존 `{}`와 렌더 동치).
export function chipTintStyle(color) {
  return color ? { [CHIP_COLOR_VAR]: color } : undefined;
}
