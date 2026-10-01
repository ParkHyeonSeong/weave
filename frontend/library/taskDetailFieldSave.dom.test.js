// @vitest-environment jsdom
//
// 상세 패널·풀페이지에서 필드를 바꿀 때마다 본문이 통째로 다시 그려지던 회귀(TD-01).
//
// updateField가 PATCH 뒤 silent 없는 fetchTask()를 불러 loading=true가 됐고, 패널은 loading이면
// 본문 전체를 언마운트했다(풀페이지는 화면 전체를 로딩 문구로 교체). 그래서 스크롤이 맨 위로
// 튀고 쓰던 댓글 초안이 사라졌다. 저장 거절(200 + status:false)·네트워크 오류도 안내 없이
// 버려졌다. 이제 담당자·라벨과 같은 규약(즉시 반영 → PATCH → 조용한 재동기화)을 따르고,
// 실패는 값을 되돌린 뒤 토스트로 알린다. 커스텀 필드는 단일 키 API로 그 키만 저장한다.
//
// PATCH와 재동기화 GET을 게이트로 붙잡아 순서를 결정적으로 재현한다(타이머·랜덤 없음).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn() } }));
import { axios } from '@/library/_axios';
import useTaskDetail from '@/hooks/useTaskDetail';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BRANCH = 15;
const TASK = 55;
const DETAIL_URL = `/branches/${BRANCH}/tasks/${TASK}`;

let hookApi;
let root;
let server;            // 커밋된 서버 값
let heldPatches;       // 보류 중인 PATCH [{ url, body, resolve, reject }]
let gateNextDetailGet; // true면 다음 상세 GET 응답을 게이트에 걸어 둔다
let heldDetailGets;    // 보류 중인 상세 GET
let inFlight;          // 시작해 둔 저장들
let toasts;            // 관측된 토스트 { message, type }
let broadcasts;        // 관측된 task:updated 수

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

const snapshot = () => ({
  task_id: TASK,
  branch_id: BRANCH,
  title: server.title,
  status: 'todo',
  priority: server.priority,
  task_type: 'task',
  description: null,
  start_date: server.start_date,
  due_date: server.due_date,
  custom_fields: { ...server.custom_fields },
  assignees: server.assignees.main ? [{ user_id: server.assignees.main, role: 'main', username: 'kim' }] : [],
  labels: server.label_ids.map((id) => ({ label_id: id, label_name: 'bug' })),
  subtasks: [],
});

function Probe() {
  hookApi = useTaskDetail(BRANCH, TASK);
  return null;
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Probe />);
    await flush();
  });
}

// 저장을 시작만 한다 — PATCH는 게이트에 걸린 채로 돌아온다.
async function start(fn) {
  await act(async () => {
    inFlight.push(fn());
    await flush();
  });
}

// 보류해 둔 PATCH를 성공시킨다 — 그 시점에 서버도 커밋된다.
async function commitPatch(index = 0) {
  const [held] = heldPatches.splice(index, 1);
  if (held.url.endsWith('/custom-fields')) {
    server.custom_fields[String(held.body.field_id)] = held.body.value;
  } else {
    Object.assign(server, held.body);
  }
  await act(async () => {
    held.resolve({ data: { status: true } });
    await flush();
  });
}

// 보류해 둔 PATCH를 컨트롤러 거절(200 + status:false)로 끝낸다 — 서버는 그대로다.
async function rejectPatch(data, index = 0) {
  const [held] = heldPatches.splice(index, 1);
  await act(async () => {
    held.resolve({ data });
    await flush();
  });
}

// 보류해 둔 PATCH를 네트워크 오류로 끝낸다.
async function failPatch(index = 0) {
  const [held] = heldPatches.splice(index, 1);
  await act(async () => {
    held.reject(new Error('Network Error'));
    await flush();
  });
}

async function releaseDetailGet() {
  const held = heldDetailGets.shift();
  await act(async () => {
    held.resolve({ data: { status: true, task: held.task } });
    await flush();
  });
}

async function settleAll() {
  await act(async () => {
    await Promise.all(inFlight);
    await flush();
  });
}

const onToast = (e) => { toasts.push({ message: e.detail.message, type: e.detail.type }); };
const countBroadcast = () => { broadcasts += 1; };

beforeEach(() => {
  vi.clearAllMocks();
  hookApi = null;
  server = {
    title: '원래 제목',
    priority: 'medium',
    start_date: '2026-10-01',
    due_date: '2026-10-10',
    custom_fields: { 12: 'keep', 13: 'old' },
    label_ids: [],                         // 라벨·담당자는 저장 PATCH 본문 모양 그대로 둔다
    assignees: { main: null, sub: [] },
  };
  heldPatches = [];
  gateNextDetailGet = false;
  heldDetailGets = [];
  inFlight = [];
  toasts = [];
  broadcasts = 0;
  window.addEventListener('toast', onToast);
  window.addEventListener('task:updated', countBroadcast);

  axios.patch.mockImplementation((url, body) => {
    const gate = deferred();
    heldPatches.push({ url: String(url), body, resolve: gate.resolve, reject: gate.reject });
    return gate.promise; // 테스트가 열어 줄 때까지 대기
  });

  axios.get.mockImplementation(async (url) => {
    if (url === DETAIL_URL) {
      const task = snapshot(); // 스냅샷은 요청 시점에 굳는다
      if (gateNextDetailGet) {
        gateNextDetailGet = false;
        const gate = deferred();
        heldDetailGets.push({ resolve: gate.resolve, task });
        return gate.promise;
      }
      return { data: { status: true, task } };
    }
    return {
      data: {
        status: true, sprints: [], epics: [], statuses: [], task_types: [],
        members: [{ user_id: 3, username: 'kim' }], labels: [{ label_id: 7, label_name: 'bug' }],
      },
    };
  });
});

afterEach(async () => {
  window.removeEventListener('toast', onToast);
  window.removeEventListener('task:updated', countBroadcast);
  if (root) {
    await act(async () => { root.unmount(); });
    root = null;
  }
  document.body.innerHTML = '';
});

describe('필드 저장 — 본문을 다시 그리지 않는다', () => {
  it('저장 뒤 재동기화가 진행되는 동안에도 loading이 켜지지 않는다 (패널 본문·풀페이지 유지)', async () => {
    await mount();
    expect(hookApi.loading).toBe(false);

    await start(() => hookApi.updateField('priority', 'high'));
    gateNextDetailGet = true;
    await commitPatch(); // 서버 커밋 → 뒤따르는 재동기화 GET은 보류
    expect(heldDetailGets).toHaveLength(1);

    // loading이 켜지면 패널은 본문 전체를 언마운트하고 풀페이지는 로딩 화면으로 바뀐다.
    expect(hookApi.loading).toBe(false);
    expect(hookApi.task).not.toBeNull();
    expect(hookApi.error).toBeNull();

    await releaseDetailGet();
    await settleAll();
    expect(hookApi.loading).toBe(false);
    expect(hookApi.task.priority).toBe('high');
    expect(broadcasts).toBe(1); // 다른 화면(목록·보드·활동) 갱신 알림은 유지
    expect(toasts).toEqual([]);
  });

  it('바꾼 값이 PATCH 응답을 기다리지 않고 즉시 반영된다', async () => {
    await mount();
    await start(() => hookApi.updateField('priority', 'high'));
    expect(heldPatches).toHaveLength(1);
    expect(heldPatches[0].body).toEqual({ priority: 'high' });
    expect(hookApi.task.priority).toBe('high');

    await commitPatch();
    await settleAll();
    expect(hookApi.task.priority).toBe('high');
    expect(server.priority).toBe('high');
  });
});

describe('필드 저장 실패 — 값을 되돌리고 토스트로 알린다', () => {
  it('컨트롤러 거절(200 + status:false)이면 원래 값으로 돌아가고 코드 문구로 알린다', async () => {
    await mount();
    await start(() => hookApi.updateField('due_date', '2026-09-01'));
    expect(hookApi.task.due_date).toBe('2026-09-01');

    await rejectPatch({
      status: false, message: 'INVALID_DATE_RANGE', code: 'INVALID_DATE_RANGE', category: 'validation',
    });
    await settleAll();

    expect(hookApi.task.due_date).toBe('2026-10-10');
    expect(toasts).toEqual([{ message: 'Please check your input.', type: 'error' }]);
    expect(broadcasts).toBe(0); // 실패는 다른 화면에 변경을 알리지 않는다
    expect(hookApi.loading).toBe(false);
  });

  it('네트워크 오류면 원래 값으로 돌아가고 재시도 안내로 알린다', async () => {
    await mount();
    await start(() => hookApi.updateField('title', '새 제목'));
    expect(hookApi.task.title).toBe('새 제목');

    await failPatch();
    await settleAll();

    expect(hookApi.task.title).toBe('원래 제목');
    expect(toasts).toEqual([{ message: 'Could not save the change. Please try again shortly.', type: 'error' }]);
    expect(broadcasts).toBe(0);
  });

  it('실패한 저장의 되돌리기가 그 사이 같은 필드에 들어간 새 변경을 덮지 않는다', async () => {
    await mount();
    await start(() => hookApi.updateField('priority', 'high'));
    await start(() => hookApi.updateField('priority', 'urgent'));
    expect(hookApi.task.priority).toBe('urgent');

    await rejectPatch({ status: false, code: 'NOT_ALLOWED', message: 'NOT_ALLOWED' }, 0); // 첫 저장 거절
    expect(hookApi.task.priority).toBe('urgent'); // 새 변경은 그대로

    await commitPatch(0); // 둘째 저장 커밋
    await settleAll();
    expect(server.priority).toBe('urgent');
    expect(hookApi.task.priority).toBe('urgent');
    expect(toasts).toEqual([{ message: 'That action is not allowed.', type: 'error' }]);
  });
});

describe('연속 저장 — 먼저 끝난 저장의 재조회가 진행 중인 변경을 덮지 않는다', () => {
  it('우선순위 저장 중 마감일을 바꿔 그쪽 저장·재조회가 먼저 끝나도 우선순위는 새 값이고, 다 끝나면 서버 최종값과 같다', async () => {
    await mount();
    await start(() => hookApi.updateField('priority', 'high'));
    await start(() => hookApi.updateField('due_date', '2026-10-20'));

    await commitPatch(1); // 마감일이 먼저 커밋 — 그 재조회는 우선순위가 커밋되기 전 스냅샷을 받는다
    expect(server.priority).toBe('medium');
    expect(hookApi.task.priority).toBe('high');
    expect(hookApi.task.due_date).toBe('2026-10-20');

    await commitPatch(0);
    await settleAll();
    expect(hookApi.task).toMatchObject({ priority: 'high', due_date: '2026-10-20' });
    expect(hookApi.task).toMatchObject({ priority: server.priority, due_date: server.due_date });
    expect(toasts).toEqual([]);
  });

  it('제목 저장 중 커스텀 필드를 바꿔도 같다 — 제목이 원래 값으로 돌아가지 않는다', async () => {
    await mount();
    await start(() => hookApi.updateField('title', '새 제목'));
    await start(() => hookApi.updateCustomField(13, 'new'));

    await commitPatch(1);
    expect(hookApi.task.title).toBe('새 제목');
    expect(hookApi.task.custom_fields).toEqual({ 12: 'keep', 13: 'new' });

    await commitPatch(0);
    await settleAll();
    expect(hookApi.task.title).toBe(server.title);
    expect(hookApi.task.custom_fields).toEqual(server.custom_fields);
  });

  it('먼저 시작한 저장이 거절되면 그 값만 되돌아가고, 다른 저장의 값은 서버 최종값으로 남는다', async () => {
    await mount();
    await start(() => hookApi.updateField('priority', 'high'));
    await start(() => hookApi.updateField('due_date', '2026-10-20'));

    await commitPatch(1);
    await rejectPatch({ status: false, code: 'NOT_ALLOWED', message: 'NOT_ALLOWED' }, 0);
    await settleAll();
    expect(hookApi.task).toMatchObject({ priority: 'medium', due_date: '2026-10-20' });
    expect(hookApi.task).toMatchObject({ priority: server.priority, due_date: server.due_date });
    expect(toasts).toEqual([{ message: 'That action is not allowed.', type: 'error' }]);
  });
});

// 우선순위 저장과 라벨·주담당자 저장이 겹칠 때. 각 PATCH가 끝나면 그 저장의 재조회도 곧바로 끝난다 — 먼저 끝난
// 저장의 재조회 스냅샷에는 아직 다른 저장의 변경이 없다. 시작 순서 2가지 × 완료 순서 2가지 모두 저장이 끝나면
// 화면이 서버 값과 같아야 한다.
const OTHER_SAVES = {
  라벨: {
    start: () => hookApi.toggleLabel(7),
    body: { label_ids: [7] },
    committed: () => expect(server.label_ids).toEqual([7]),
    shownMatchesServer: () => expect(hookApi.task.labels.map((l) => l.label_id)).toEqual(server.label_ids),
  },
  주담당자: {
    start: () => hookApi.updateAssignees(3, []),
    body: { assignees: { main: 3, sub: [] } },
    committed: () => expect(server.assignees).toEqual({ main: 3, sub: [] }),
    shownMatchesServer: () => expect(hookApi.task.assignees.map((a) => [a.user_id, a.role]))
      .toEqual([[server.assignees.main, 'main']]),
  },
};

describe.each(Object.keys(OTHER_SAVES))('우선순위 저장과 %s 저장이 겹쳐도 — 모든 저장이 끝나면 화면이 서버와 같다', (other) => {
  const PRIORITY = '우선순위';
  it.each([
    [PRIORITY, PRIORITY],
    [PRIORITY, other],
    [other, PRIORITY],
    [other, other],
  ])('%s 먼저 시작 · %s 먼저 완료', async (startsFirst, finishesFirst) => {
    const saves = {
      [PRIORITY]: { start: () => hookApi.updateField('priority', 'high'), body: { priority: 'high' } },
      [other]: OTHER_SAVES[other],
    };
    await mount();
    await start(saves[startsFirst].start);
    await start(saves[startsFirst === PRIORITY ? other : PRIORITY].start);
    expect(heldPatches).toHaveLength(2);

    const first = heldPatches.findIndex((h) => JSON.stringify(h.body) === JSON.stringify(saves[finishesFirst].body));
    await commitPatch(first); // 이 저장의 PATCH와 그 재조회가 먼저 끝난다
    await commitPatch(0);     // 남은 저장의 PATCH와 그 재조회
    await settleAll();

    expect(server.priority).toBe('high');
    OTHER_SAVES[other].committed();
    expect(hookApi.task.priority).toBe(server.priority);
    OTHER_SAVES[other].shownMatchesServer();
    expect(toasts).toEqual([]);
  });
});

describe('커스텀 필드 저장 — 그 키 하나만 단일 키 API로', () => {
  it('다른 키를 보내지 않고 즉시 반영하며, loading 없이 서버와 수렴한다', async () => {
    await mount();
    await start(() => hookApi.updateCustomField(13, 'new'));

    expect(heldPatches).toHaveLength(1);
    expect(heldPatches[0].url).toBe(`${DETAIL_URL}/custom-fields`);
    expect(heldPatches[0].body).toEqual({ field_id: 13, value: 'new' });
    expect(hookApi.task.custom_fields).toEqual({ 12: 'keep', 13: 'new' });

    await commitPatch();
    await settleAll();
    expect(server.custom_fields).toEqual({ 12: 'keep', 13: 'new' });
    expect(hookApi.task.custom_fields).toEqual({ 12: 'keep', 13: 'new' });
    expect(hookApi.loading).toBe(false);
    expect(broadcasts).toBe(1);
  });

  it('거절되면 그 키만 되돌리고, 코드가 없어도 빈 문구가 아닌 폴백으로 알린다', async () => {
    await mount();
    await start(() => hookApi.updateCustomField(13, 'bad'));
    expect(hookApi.task.custom_fields).toEqual({ 12: 'keep', 13: 'bad' });

    await rejectPatch({ status: false });
    await settleAll();

    expect(hookApi.task.custom_fields).toEqual({ 12: 'keep', 13: 'old' });
    expect(toasts).toEqual([{ message: 'Could not save the change.', type: 'error' }]);
    expect(broadcasts).toBe(0);
  });
});
