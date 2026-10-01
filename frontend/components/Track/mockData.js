// Mock 데이터 - Track 프로토타입용
// 백엔드 연결 전 UI 시연을 위한 정적 데이터

import { priorityVar, priorityInkVar } from '@/library/themePalette';
export const TRACK = {
  track_id: 1,
  track_name: 'Q3 결제 출시 준비',
  description: 'PG사 연동부터 출시 검증까지 — 도메인을 가로지르는 전체 흐름',
  color: '#5E6AD2',
  default_view: 'flow',
  created_at: '2026-04-12',
  member_count: 4,
  // Track 생성 시 선택된 참여 branch들. SourcePicker는 이 branch들만 노출.
  participating_branch_ids: [1, 2, 3, 4],
};

export const BRANCHES = [
  { branch_id: 1, key: 'BE', name: 'Backend', color: '#5E6AD2' },
  { branch_id: 2, key: 'FE', name: 'Frontend', color: '#10B981' },
  { branch_id: 3, key: 'DS', name: 'Design', color: '#F59E0B' },
  { branch_id: 4, key: 'LG', name: 'Legal', color: '#9333EA' },
  // 아래는 Track에 참여 안 한 branch들 (SourcePicker에서 "+ Add branch" 시 추가 가능)
  { branch_id: 5, key: 'MK', name: 'Marketing', color: '#EC4899' },
  { branch_id: 6, key: 'OPS', name: 'DevOps', color: '#0EA5E9' },
];

export const MEMBERS = [
  { user_id: 1, username: '박현성', initial: '박', color: '#5E6AD2', role: 'owner' },
  { user_id: 2, username: '김지수', initial: '김', color: '#F59E0B', role: 'editor' },
  { user_id: 3, username: '이도현', initial: '이', color: '#10B981', role: 'editor' },
  { user_id: 4, username: 'Sarah Kim', initial: 'S', color: '#9333EA', role: 'editor' },
];

// 우선순위는 사용자가 색을 고르는 축이 아니라 앱이 정한 의미 등급이다 —
// themePalette.js의 PRIORITY_TOKENS를 단일 원천으로 재사용한다(중복 매핑 금지).
// ⛔ 여기서 나온 값은 `var(--x)` 토큰 참조다. 알파 접미(`color + '40'`)를 붙이면
//    `var(--x)40`이 되어 IACVT로 선언이 통째로 무효가 된다 — entityBorderStyle이
//    토큰 참조를 color-mix로 처리하도록 되어 있으니 그 경로를 그대로 쓴다.
// `color`는 **테두리·식별용** 우선순위 색, `ink`는 **텍스트용**이다. 둘은 다른 축이다 —
// high를 같은 값으로 쓰면 흰 Track 카드 위 글자가 3.19:1로 AA 미달이다(themePalette.js 참조).
export const PRIORITIES = {
  urgent: { label: 'Urgent', color: priorityVar('urgent'), ink: priorityInkVar('urgent') },
  high: { label: 'High', color: priorityVar('high'), ink: priorityInkVar('high') },
  medium: { label: 'Medium', color: priorityVar('medium'), ink: priorityInkVar('medium') },
  low: { label: 'Low', color: priorityVar('low'), ink: priorityInkVar('low') },
};

// 캔버스에 이미 떨궈진 item들
export const ITEMS = [
  {
    item_id: 1, source_type: 'task', task_id: 101, branch_id: 3,
    display_id: 'DS-12', title: '결제 화면 와이어프레임',
    status: 'done', priority: 'high',
    assignees: [{ user_id: 2, username: '김지수', color: '#F59E0B', initial: '김' }],
    start_date: '2026-05-08', due_date: '2026-05-22',
    description: '체크아웃 페이지부터 결제 완료까지의 전체 화면 흐름을 와이어프레임으로 정리. PG사 결제 모듈 호출 시점 분기 명확화.',
    position: { x: 40, y: 40 },
    other_tracks: [{ track_id: 2, track_name: '디자인 시스템 v2' }],
  },
  {
    item_id: 2, source_type: 'task', task_id: 102, branch_id: 3,
    display_id: 'DS-15', title: '결제 페이지 비주얼 디자인',
    status: 'in_progress', priority: 'high',
    assignees: [{ user_id: 2, username: '김지수', color: '#F59E0B', initial: '김' }],
    start_date: '2026-05-20', due_date: '2026-06-03',
    description: '와이어프레임 기반으로 비주얼 디자인 완성. 다크/라이트 모드 둘 다.',
    position: { x: 360, y: 40 },
    other_tracks: [],
  },
  {
    item_id: 3, source_type: 'task', task_id: 201, branch_id: 1,
    display_id: 'BE-42', title: 'PG사 OAuth 토큰 발급',
    status: 'in_progress', priority: 'urgent',
    assignees: [{ user_id: 1, username: '박현성', color: '#5E6AD2', initial: '박' }],
    start_date: '2026-05-18', due_date: '2026-06-05',
    description: 'TossPayments OAuth 인증 토큰 발급 및 자동 갱신 로직 구현.',
    position: { x: 40, y: 240 },
    other_tracks: [{ track_id: 3, track_name: 'PG사 마이그레이션' }],
  },
  {
    item_id: 4, source_type: 'task', task_id: 202, branch_id: 1,
    display_id: 'BE-43', title: '결제 요청/응답 처리',
    status: 'todo', priority: 'high',
    assignees: [{ user_id: 1, username: '박현성', color: '#5E6AD2', initial: '박' }],
    start_date: '2026-06-05', due_date: '2026-06-15',
    description: '결제 요청 payload 생성, 응답 파싱, 실패 케이스 분류 및 재시도 로직.',
    position: { x: 360, y: 240 },
    other_tracks: [],
  },
  {
    item_id: 5, source_type: 'task', task_id: 203, branch_id: 1,
    display_id: 'BE-47', title: 'Webhook 멱등성 처리',
    status: 'todo', priority: 'medium',
    assignees: [{ user_id: 1, username: '박현성', color: '#5E6AD2', initial: '박' }],
    start_date: '2026-06-15', due_date: '2026-06-22',
    description: 'PG사 결제 완료 webhook 수신 시 중복 방지 — idempotency key 기반.',
    position: { x: 680, y: 240 },
    other_tracks: [],
  },
  {
    item_id: 6, source_type: 'task', task_id: 301, branch_id: 2,
    display_id: 'FE-78', title: '체크아웃 UI 구현',
    status: 'todo', priority: 'high',
    assignees: [{ user_id: 3, username: '이도현', color: '#10B981', initial: '이' }],
    start_date: '2026-06-08', due_date: '2026-06-28',
    description: '디자인 시안 기반 체크아웃 페이지 React 구현 — 상품/금액/결제수단 분리.',
    position: { x: 360, y: 440 },
    other_tracks: [],
  },
  {
    item_id: 7, source_type: 'task', task_id: 302, branch_id: 2,
    display_id: 'FE-82', title: '결제 완료/실패 페이지',
    status: 'todo', priority: 'medium',
    assignees: [{ user_id: 3, username: '이도현', color: '#10B981', initial: '이' }],
    start_date: '2026-06-25', due_date: '2026-07-02',
    description: '결제 성공/실패에 따른 후처리 페이지.',
    position: { x: 680, y: 440 },
    other_tracks: [],
  },
  {
    item_id: 8, source_type: 'task', task_id: 401, branch_id: 4,
    display_id: 'LG-7', title: '결제 약관 법무 검토',
    status: 'blocked', priority: 'urgent',
    assignees: [{ user_id: 4, username: 'Sarah Kim', color: '#9333EA', initial: 'S' }],
    start_date: '2026-05-15', due_date: '2026-05-30',
    description: '약관 5조 환불 규정 외부 자문 의뢰 — 응답 대기 중.',
    position: { x: 40, y: 440 },
    other_tracks: [],
  },
  {
    item_id: 9, source_type: 'task', task_id: 999, branch_id: null,
    restricted: true,
    restricted_hint: 'Internal Audit 브랜치',
    position: { x: 1000, y: 240 },
  },
  {
    item_id: 10, source_type: 'task', task_id: 303, branch_id: 2,
    display_id: 'FE-85', title: '결제 출시 QA 시나리오',
    status: 'review', priority: 'high',
    assignees: [{ user_id: 3, username: '이도현', color: '#10B981', initial: '이' }],
    start_date: '2026-06-30', due_date: '2026-07-10',
    description: '엣지 케이스 QA 시나리오 작성 (실패/타임아웃/중복/환불).',
    position: { x: 1000, y: 440 },
    other_tracks: [],
  },
];

export const LINKS = [
  { link_id: 1, source_item_id: 1, target_item_id: 2, link_type: 'flow_to', materialized: true },
  { link_id: 2, source_item_id: 2, target_item_id: 6, link_type: 'flow_to', materialized: true },
  { link_id: 3, source_item_id: 3, target_item_id: 4, link_type: 'flow_to', materialized: true },
  { link_id: 4, source_item_id: 4, target_item_id: 5, link_type: 'flow_to', materialized: false },
  { link_id: 5, source_item_id: 4, target_item_id: 6, link_type: 'flow_to', materialized: true },
  { link_id: 6, source_item_id: 8, target_item_id: 6, link_type: 'relates_to', materialized: false },
  { link_id: 7, source_item_id: 6, target_item_id: 7, link_type: 'flow_to', materialized: true },
  { link_id: 8, source_item_id: 7, target_item_id: 10, link_type: 'flow_to', materialized: false },
];

// SourcePicker — 캔버스에 아직 안 들어간 task들 (브랜치별 트리)
export const SOURCE_TREE = [
  {
    branch_id: 1, key: 'BE', name: 'Backend', color: '#5E6AD2',
    epics: [
      {
        epic_id: 11, name: '결제 API', color: '#5E6AD2',
        tasks: [
          { task_id: 204, display_id: 'BE-50', title: '결제 환불 API', status: 'todo' },
          { task_id: 205, display_id: 'BE-51', title: '결제 내역 조회 API', status: 'todo' },
        ],
      },
      {
        epic_id: 12, name: '로그·모니터링', color: '#10B981',
        tasks: [
          { task_id: 220, display_id: 'BE-62', title: '결제 이벤트 로깅', status: 'todo' },
          { task_id: 221, display_id: 'BE-63', title: 'PG사 응답 지연 알림', status: 'todo' },
        ],
      },
    ],
  },
  {
    branch_id: 2, key: 'FE', name: 'Frontend', color: '#10B981',
    epics: [
      {
        epic_id: 21, name: '체크아웃', color: '#10B981',
        tasks: [
          { task_id: 304, display_id: 'FE-89', title: '결제수단 선택 컴포넌트', status: 'todo' },
          { task_id: 305, display_id: 'FE-91', title: '쿠폰 적용 UI', status: 'todo' },
        ],
      },
    ],
  },
  {
    branch_id: 3, key: 'DS', name: 'Design', color: '#F59E0B',
    epics: [
      {
        epic_id: 31, name: '결제 비주얼', color: '#F59E0B',
        tasks: [
          { task_id: 103, display_id: 'DS-18', title: '결제수단 아이콘 세트', status: 'in_progress' },
        ],
      },
      {
        epic_id: 32, name: '에러 일러스트', color: '#9333EA',
        tasks: [
          { task_id: 104, display_id: 'DS-22', title: '결제 실패 일러스트', status: 'todo' },
        ],
      },
    ],
  },
  {
    branch_id: 4, key: 'LG', name: 'Legal', color: '#9333EA',
    epics: [
      {
        epic_id: 41, name: '컴플라이언스', color: '#9333EA',
        tasks: [
          { task_id: 402, display_id: 'LG-9', title: '개인정보 처리방침 개정', status: 'review' },
        ],
      },
    ],
  },
];

// 캔버스에 들어가있는 item들의 branch별 분포 (헤더 weave bar용)
export function getBranchDistribution(items, branches) {
  const counts = {};
  items.forEach((it) => {
    if (it.restricted) return;
    counts[it.branch_id] = (counts[it.branch_id] || 0) + 1;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return branches
    .filter((b) => counts[b.branch_id])
    .map((b) => ({
      branch_id: b.branch_id,
      key: b.key,
      name: b.name,
      color: b.color,
      count: counts[b.branch_id],
      ratio: counts[b.branch_id] / total,
    }));
}
