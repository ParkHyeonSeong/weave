// 저장색 대비 계약의 **정본 코퍼스** (S7 계획 「변경 A — 임의 저장색」 상수표).
// colorContrast.test.js와 entityTint.test.js가 같은 31색을 봐야 해서 공유 픽스처로 뺐다.
// 극단값(표면과 동일한 색·순흑·순백)이 반드시 들어간다 — 사다리 소진 폴백을 밟는 입력이다.
// ⚠️ vitest include는 `library/**/*.test.js`라 이 파일은 테스트로 수집되지 않는다.

export const EXTREMES = ['#000000', '#FFFFFF', '#000080', '#FFFF00', '#0E0F11', '#F9FAFB', '#808080'];
export const PRIORITY = ['#DC2626', '#F59E0B', '#5E6AD2', '#9CA3AF'];              // TaskListRow 등 6컴포넌트 공통
export const STATUS_SEED = ['#9CA3AF', '#2563EB', '#16A34A', '#DC2626'];           // backend/core/model/workflow_status.py:94-101
export const LABEL_PRESET = [                                                      // components/common/LabelTagInput.js:5-10
  '#5E6AD2', '#DC2626', '#F59E0B', '#16A34A', '#2563EB',
  '#8B5CF6', '#EC4899', '#0891B2', '#C2410C', '#4F46E5',
  '#059669', '#D97706', '#7C3AED', '#DB2777', '#0D9488', '#9333EA',
];
export const ENTITY_PRESET = ['#5E6AD2', '#16A34A', '#DC2626', '#F59E0B', '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280'];
export const AVATAR = [                                                            // library/userAvatar.js:8-21
  '#5E6AD2', '#059669', '#B45309', '#9333EA', '#BE185D', '#0369A1',
  '#DC2626', '#0D9488', '#A16207', '#7C3AED', '#DB2777', '#475569',
];

export const CORPUS = [...new Set([
  ...EXTREMES, ...PRIORITY, ...STATUS_SEED, ...LABEL_PRESET, ...ENTITY_PRESET, ...AVATAR,
])];

// ── 표면 프로파일 원장 ────────────────────────────────────────────────────────
// 배지가 놓이는 **실제 도색 부모**는 한 종류가 아니다. 역할마다 부모가 다르므로
// `entityTintStyle`의 기준 표면도 역할별로 갈린다(`ENTITY_SURFACE_PROFILES`).
//
// 아래는 각 프로파일의 배지가 실제로 얹히는 부모 전체다 — entityTintStyle 호출부 17곳(15파일)에서
// 최근접 도색 조상을 추적하고 브라우저에서 computed 값으로 실측해 얻었다.
// ⚠️ 반투명 배경·그라데이션은 **선언명이 아니라 실제로 칠해지는 색**을 적는다.
//    선언명만 보면 --selected가 "primary-subtle"로 보이지만 실제 부모는 그것을 아래 표면에
//    합성한 색이고, 그라데이션은 부모가 하나가 아니라 구간이다.
//
//   default          : 일반 배지(라벨·상태·필터칩·라벨입력칩 등) — --color-bg / --color-surface
//   track-card       : TrackTree 상태 배지 — 컨테이너 --track-paper, 행 --track-card.
//                      ⚠️ 다크에서 --track-card가 --color-surface보다 **밝다**.
//   task-ref         : Task ref 칩 **안쪽** 상태 배지 — 부모가 페이지 표면이 아니라
//                      칩 자신의 배경(--color-primary-subtle을 그 아래 표면에 합성한 색)이다.
//   surface-overlay  : 떠 있는 표면 위 배지 — 메신저 Task 검색 팝업의 idle 항목.
//   track-header     : Track 헤더 참여 칩 — 부모가 세로 그라데이션 **구간**이다.
//   task-list-raised : TaskListRow 중 행이 자기 배경을 칠하는 상태(selected·subtask)의 라벨.
//
// ⛔ "라이트 실제 표면은 두 개뿐"이라고 적지 마라 — 그것은 default 프로파일에만 참이다.
// ⛔ 값이 같다고 프로파일을 합치지 마라(surface-overlay·track-header는 오늘만 같다).
export const SURFACE_PARENTS = {
  default: {
    light: [['--color-bg', '#FFFFFF'], ['--color-surface', '#F9FAFB']],
    dark: [['--color-bg', '#0E0F11'], ['--color-surface', '#17181C']],
  },
  // ⚠️ 행은 4상태다. hover·selected는 --color-primary를 **--track-paper 위에** 합성한 색이라
  //    (행의 --track-card 배경을 대체한다) 라이트에서는 가장 어둡고 다크에서는 가장 밝다.
  //    즉 양 테마 모두 **selected(6%)가 최악**이다 — 브라우저 실측으로 확인했다.
  'track-card': {
    light: [
      ['--track-paper (컨테이너)', '#F9FAFB'], ['--track-card (행)', '#FFFFFF'],
      ['행 hover = primary 2.5% over paper', '#F5F6FA'],
      ['행 selected = primary 6% over paper', '#F0F1F9'],
    ],
    dark: [
      ['--track-paper (컨테이너)', '#17181C'], ['--track-card (행)', '#1B1D22'],
      ['행 hover = primary 2.5% over paper', '#1A1B21'],
      ['행 selected = primary 6% over paper', '#1D1F28'],
    ],
  },
  // ⚠️ **표 셀 안에서는 칩 배경을 불투명으로 굳힌다.** 셀은 임의 배경색(팔레트 8색·selectedCell)을
  //    가질 수 있는데 칩 기본 배경이 반투명이라 셀 색이 부모에 섞이기 때문이다.
  //    canvasEditor·canvasPageView·canvasOverview·refPreviewPanel의 `th, td .task-ref`가
  //    `color-mix(in srgb, var(--color-primary) 8%, var(--color-surface))`를 쓰고,
  //    그 산출은 아래 첫 항목(라이트) / 첫 항목(다크)과 **같은 색**이다 —
  //    그래서 셀색마다 프로파일을 늘리지 않아도 이 원장이 그대로 덮는다.
  'task-ref': {
    light: [
      ['primary-subtle over --color-surface (= 표 셀 안 불투명값)', '#EDEEF8'],
      ['primary-subtle over --color-bg', '#F2F3FB'],
    ],
    dark: [
      ['primary-subtle over --color-surface (= 표 셀 안 불투명값)', '#1F212C'],
      ['primary-subtle over --track-card', '#232632'],
    ],
  },
  // 떠 있는 표면 위 배지(메신저 Task 검색 팝업의 항목 상태 배지).
  // idle은 팝업 자신의 --color-surface-overlay, hover·active만 --color-surface로 내려온다.
  // ⚠️ 다크에서 overlay(#1B1D22)가 --color-surface(#17181C)보다 **밝다** — 그래서 idle이 최악이다.
  'surface-overlay': {
    light: [
      ['--color-surface-overlay (idle)', '#FFFFFF'],
      ['--color-surface (hover·active)', '#F9FAFB'],
    ],
    dark: [
      ['--color-surface-overlay (idle)', '#1B1D22'],
      ['--color-surface (hover·active)', '#17181C'],
    ],
  },
  // Track 헤더 참여 칩. 헤더 배경은 단색이 아니라 **세로 그라데이션**이라
  // 부모가 구간 전체다 — 양 끝을 적고 프로파일은 그중 최악을 고른다.
  // ⚠️ 종전 원장은 위쪽 끝(--track-paper)만 적어 "부모 = --color-surface"라 결론냈고
  //    아래쪽 끝(다크 최악)을 놓쳤다. 라이트 raised 값은 color.adjust 파생이라 소스에 hex가 없다.
  'track-header': {
    light: [
      ['--track-paper (그라데이션 0%)', '#F9FAFB'],
      ['--track-paper-raised (그라데이션 100%)', '#FCFDFD'],
    ],
    dark: [
      ['--track-paper (그라데이션 0%)', '#17181C'],
      ['--track-paper-raised (그라데이션 100%)', '#1B1D22'],
    ],
  },
  // TaskListRow 중 **행이 자기 배경을 칠하는** 상태. normal·hover는 여기 없다(default가 맡는다).
  // ⚠️ --subtask가 --selected보다 뒤에 선언돼 선택된 하위행 배경도 --color-surface-raised다.
  'task-list-raised': {
    light: [
      ['selected = primary-subtle over --color-surface', '#EDEEF8'],
      ['subtask = --color-surface-raised', '#FCFDFD'],
    ],
    dark: [
      ['selected = primary-subtle over --color-surface', '#1F212C'],
      ['subtask = --color-surface-raised', '#1B1D22'],
    ],
  },
};

// default 프로파일의 라이트 부모 — 기존 이름 유지(호출부 호환).
export const LIGHT_SURFACES = SURFACE_PARENTS.default.light;

// 틴트 호출부가 실제로 쓰는 사다리 진입점은 이 둘뿐이다(S7 계획 §5 실측).
export const LIGHT_ENTRIES = [8, 12];
