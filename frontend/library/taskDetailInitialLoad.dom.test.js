// @vitest-environment jsdom
//
// 상세 최초 로드가 백그라운드 재조회에 추월돼 빈 패널로 굳는 회귀.
//
// 최초 상세 GET은 순번(seq)을 claim한다 — 태스크를 갈아탄 뒤 도착한 옛 응답이 새 태스크를
// 덮지 못하게 하기 위해서다. 그런데 그 사이 외부 task:updated가 오면 리스너의 background
// resync가 순번을 가져가 **최초 GET이 폐기**되고, 그 background 조회마저 실패하면 silent라
// setError도 setTask도 하지 않는다. 결과는 loading=false / task=null / error=null —
// 닫기 버튼만 남은 빈 패널이 복구 수단 없이 영구히 남는다.
//
// 게이트로 최초 GET을 붙잡아 이 순서를 결정적으로 재현한다(타이머·랜덤 없음).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
import { axios } from '@/library/_axios';
import useTaskDetail from '@/hooks/useTaskDetail';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BRANCH = 15;
const DETAIL_RE = new RegExp(`^/branches/${BRANCH}/tasks/(\\d+)$`);

let hookApi;
let activeRoot;
let detailGetCount;
let gateNextDetailGet;   // true면 다음 상세 GET 응답을 게이트에 걸어 둔다
let heldDetailGets;      // 보류 중인 상세 GET
let failDetailGets;      // true면 이후 상세 GET은 네트워크 오류
let serverTitle;         // 태스크별 현재 서버 값 { [taskId]: string }
let heldPatches;         // 보류 중인 PATCH [{ resolve, url }]
let heldPosts;           // 보류 중인 POST [{ resolve, url }]
let broadcasts;          // 관측된 task:updated 수

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

const taskOf = (id) => ({
  task_id: id,
  branch_id: BRANCH,
  title: serverTitle[id],
  status: 'todo',
  task_type: 'task',
  description: null,
  custom_fields: {},
  assignees: [],
  labels: [],
  subtasks: [],
});

function Probe({ taskId }) {
  hookApi = useTaskDetail(BRANCH, taskId);
  return null;
}

async function mount(taskId) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  activeRoot = createRoot(container);
  await act(async () => {
    activeRoot.render(<Probe taskId={taskId} />);
    await flush();
  });
}

async function switchTo(taskId) {
  await act(async () => {
    activeRoot.render(<Probe taskId={taskId} />);
    await flush();
  });
}

async function externalUpdate() {
  await act(async () => {
    window.dispatchEvent(new Event('task:updated'));
    await flush();
  });
}

async function releaseDetailGet(index = 0) {
  const [held] = heldDetailGets.splice(index, 1);
  await act(async () => {
    held.resolve({ data: { status: true, task: held.task } });
    await flush();
  });
}

// 보류해 둔 상세 GET을 네트워크 오류로 끝낸다.
async function failHeldDetailGet(index = 0) {
  const [held] = heldDetailGets.splice(index, 1);
  await act(async () => {
    held.reject(new Error('network'));
    await flush();
  });
}

// 보류해 둔 PATCH를 성공시킨다.
async function resolvePatch(index = 0) {
  const [held] = heldPatches.splice(index, 1);
  await act(async () => {
    held.resolve({ data: { status: true } });
    await flush();
  });
}

// 보류해 둔 POST를 성공시킨다.
async function resolvePost(data, index = 0) {
  const [held] = heldPosts.splice(index, 1);
  await act(async () => {
    held.resolve({ data: { status: true, ...data } });
    await flush();
  });
}

const countBroadcast = () => { broadcasts += 1; };

// 금지 상태: 로딩도 끝났고 보여 줄 task도 없는데 에러조차 없는 빈 패널.
const deadPanel = () => hookApi.loading === false && !hookApi.task && !hookApi.error;

beforeEach(() => {
  vi.clearAllMocks();
  hookApi = null;
  detailGetCount = 0;
  gateNextDetailGet = false;
  heldDetailGets = [];
  failDetailGets = false;
  serverTitle = { 55: '태스크 55', 56: '태스크 56' };
  heldPatches = [];
  heldPosts = [];
  broadcasts = 0;
  window.addEventListener('task:updated', countBroadcast);

  axios.patch.mockImplementation((url) => {
    const gate = deferred();
    heldPatches.push({ resolve: gate.resolve, url: String(url) });
    return gate.promise; // 테스트가 열어 줄 때까지 대기
  });

  axios.post.mockImplementation((url) => {
    const gate = deferred();
    heldPosts.push({ resolve: gate.resolve, url: String(url) });
    return gate.promise;
  });

  axios.get.mockImplementation(async (url) => {
    const m = String(url).match(DETAIL_RE);
    if (m) {
      detailGetCount += 1;
      if (failDetailGets) throw new Error('network');
      const task = taskOf(Number(m[1]));
      if (gateNextDetailGet) {
        gateNextDetailGet = false;
        const gate = deferred();
        // 스냅샷은 "요청 시점"에 굳는다 — 보류 중 서버가 바뀌어도 이 응답엔 안 담긴다.
        heldDetailGets.push({ resolve: gate.resolve, reject: gate.reject, task });
        return gate.promise;
      }
      return { data: { status: true, task } };
    }
    return {
      data: {
        status: true, sprints: [], epics: [], members: [], labels: [], statuses: [], task_types: [],
      },
    };
  });
});

afterEach(async () => {
  window.removeEventListener('task:updated', countBroadcast);
  if (activeRoot) {
    await act(async () => { activeRoot.unmount(); });
    activeRoot = null;
  }
  document.body.innerHTML = '';
});

describe('상세 최초 로드', () => {
  it('최초 GET이 진행 중이면 외부 task:updated가 그것을 추월하지 않는다', async () => {
    gateNextDetailGet = true;
    await mount(55);
    expect(hookApi.task).toBeNull();
    expect(detailGetCount).toBe(1);

    // 최초 GET이 아직 대기 중인데 다른 화면이 task:updated를 쏜다.
    // 이 시점의 background 조회는 실패하도록 둔다 — 그래도 빈 패널로 굳으면 안 된다.
    failDetailGets = true;
    await externalUpdate();
    expect(detailGetCount).toBe(1); // background 재조회가 최초 GET을 추월하지 않았다

    failDetailGets = false;
    await releaseDetailGet();

    expect(hookApi.task?.task_id).toBe(55);
    expect(hookApi.loading).toBe(false);
    expect(hookApi.error).toBeNull();
    expect(deadPanel()).toBe(false);
  });

  it('최초 GET 자체가 실패하면 빈 패널이 아니라 명시적 error로 끝난다', async () => {
    failDetailGets = true;
    await mount(55);

    expect(hookApi.task).toBeNull();
    expect(hookApi.error).toBe('NETWORK_ERROR');
    expect(hookApi.loading).toBe(false);
    expect(deadPanel()).toBe(false);
  });

  it('이전 태스크 요청의 실패는 새 태스크의 error를 설정하지 못한다', async () => {
    await mount(55);
    expect(hookApi.task?.task_id).toBe(55);

    // A(55)의 background silent 재조회를 보류시킨다.
    gateNextDetailGet = true;
    await externalUpdate();
    expect(heldDetailGets).toHaveLength(1);

    // 그 상태로 B(56)로 전환 — B의 최초 GET도 보류시킨다.
    gateNextDetailGet = true;
    await switchTo(56);
    expect(heldDetailGets).toHaveLength(2);
    expect(hookApi.task).toBeNull();

    // A의 요청이 뒤늦게 실패한다 — 이미 떠난 화면의 요청이라 B의 error를 만들면 안 된다.
    await failHeldDetailGet(0);

    // B의 최초 GET 성공
    await releaseDetailGet(0);

    expect(hookApi.task?.task_id).toBe(56);
    expect(hookApi.error).toBeNull();
    expect(hookApi.loading).toBe(false);
    expect(deadPanel()).toBe(false);
  });

  it('최초 GET 중 온 task:updated는 버려지지 않고 정리 후 한 번 수렴한다', async () => {
    gateNextDetailGet = true;
    await mount(55);
    expect(detailGetCount).toBe(1);

    // 최초 GET은 이미 옛 스냅샷을 잡았다. 그 사이 서버가 바뀌고 알림이 온다.
    serverTitle[55] = '태스크 55 (변경됨)';
    await externalUpdate();
    expect(detailGetCount).toBe(1); // 최초 GET을 추월하지 않는다

    // 최초 응답(옛 스냅샷) 정리 → 적어 둔 재조회가 한 번 실행돼 최신으로 수렴한다.
    await releaseDetailGet();

    expect(detailGetCount).toBe(2);
    expect(hookApi.task?.title).toBe('태스크 55 (변경됨)');
    expect(hookApi.error).toBeNull();
    expect(deadPanel()).toBe(false);
  });

  // 요청 소유권: fetchTask가 "후속 GET을 실행하는 시점의 현재 화면"을 owner로 잡으면,
  // A에서 시작한 저장의 콜백이 B 전환 뒤 후속 GET을 내며 B 세대를 자기 소유권으로 캡처해
  // A 응답이 B 화면을 갈아치운다. owner는 콜백이 만들어진 원래 태스크에 결속돼야 한다.
  it('B로 이동한 뒤 끝난 A의 저장이 B 화면을 A 데이터로 바꾸지 않는다', async () => {
    await mount(55);
    expect(hookApi.task?.task_id).toBe(55);

    // A에서 저장 시작 — PATCH는 게이트에 걸린 채로 둔다.
    let mutation;
    await act(async () => {
      mutation = hookApi.updateField('title', 'changed');
      await flush();
    });
    expect(heldPatches).toHaveLength(1);
    expect(heldPatches[0].url).toContain('/tasks/55');

    // PATCH가 끝나기 전에 B로 이동하고, B 상세는 정상 로드된다.
    await switchTo(56);
    expect(hookApi.task?.task_id).toBe(56);

    // 이제 A의 PATCH가 성공하고 A 시점의 콜백이 후속 상세 GET을 실행한다.
    await resolvePatch();
    await act(async () => { await mutation; await flush(); });

    expect(hookApi.task?.task_id).toBe(56);
    expect(hookApi.error).toBeNull();
    expect(hookApi.loading).toBe(false);
    expect(deadPanel()).toBe(false);
  });

  // TaskSubtaskSection.submit() → onChanged=refreshTask 경로의 소유권.
  it('B로 이동한 뒤 실행된 옛 refreshTask가 B 화면을 덮지 않는다', async () => {
    await mount(55);
    const staleRefresh = hookApi.refreshTask; // A 렌더가 만든 참조

    await switchTo(56);
    expect(hookApi.task?.task_id).toBe(56);

    const getsBefore = detailGetCount;
    const broadcastsBefore = broadcasts;
    await act(async () => { await staleRefresh(); await flush(); });

    expect(hookApi.task?.task_id).toBe(56);   // A 응답이 적용되면 안 된다
    expect(hookApi.error).toBeNull();
    expect(deadPanel()).toBe(false);
    // 성공 변경을 다른 화면에 알리는 broadcast는 유지된다.
    expect(broadcasts).toBe(broadcastsBefore + 1);
    // 자기 이벤트로 인한 중복 상세 GET은 없다.
    expect(detailGetCount).toBe(getsBefore);
  });

  // 순번(seq)이 훅 전역이면, 떠난 화면의 콜백은 GET을 내지 않더라도 **순번을 올리는 것만으로**
  // 현재 화면의 진행 중인 요청을 supersede시킨다. owner 검사는 fetchTask 안에 있어 너무 늦다.
  it('stale refreshTask가 진행 중인 B 최초 GET을 폐기하지 않는다', async () => {
    await mount(55);
    const staleRefresh = hookApi.refreshTask; // A 렌더가 만든 참조

    // B로 이동 — B의 최초 상세 GET은 응답 대기 상태로 둔다.
    gateNextDetailGet = true;
    await switchTo(56);
    expect(heldDetailGets).toHaveLength(1);
    expect(hookApi.task).toBeNull();

    const getsBefore = detailGetCount;
    const broadcastsBefore = broadcasts;
    await act(async () => { await staleRefresh(); await flush(); });

    expect(detailGetCount).toBe(getsBefore);            // A 상세 GET은 발행되지 않는다
    expect(broadcasts).toBe(broadcastsBefore + 1);      // 전역 알림은 정확히 한 번 유지

    // B의 최초 GET이 돌아온다 — stale A가 올린 순번에 밀려 폐기되면 안 된다.
    await releaseDetailGet();

    expect(hookApi.task?.task_id).toBe(56);
    expect(hookApi.loading).toBe(false);
    expect(hookApi.error).toBeNull();
    expect(deadPanel()).toBe(false);
  });

  // createLabel은 POST → fetchOptions → PATCH 여러 await 뒤에 직접 순번을 claim한다.
  // A에서 시작한 이 작업이 B 전환 후에 그 지점에 도달해도 B 요청을 무효화하면 안 된다.
  it('await 이후에 순번을 claim하는 stale 작업이 B 요청을 무효화하지 않는다', async () => {
    await mount(55);

    let mutation;
    await act(async () => {
      mutation = hookApi.createLabel('새 라벨', '#5E6AD2');
      await flush();
    });
    expect(heldPosts).toHaveLength(1);
    expect(heldPosts[0].url).toContain('/labels');

    // 라벨 POST가 끝나기 전에 B로 이동하고, B 최초 GET은 보류시킨다.
    gateNextDetailGet = true;
    await switchTo(56);
    expect(heldDetailGets).toHaveLength(1);

    // A 작업을 후속 상세 동기화 지점(늦은 순번 claim)까지 진행시킨다.
    await resolvePost({ label_id: 9 });
    expect(heldPatches).toHaveLength(1);
    expect(heldPatches[0].url).toContain('/tasks/55');
    await resolvePatch();
    await act(async () => { await mutation; await flush(); });

    // 이제 B의 최초 GET이 돌아온다.
    await releaseDetailGet();

    expect(hookApi.task?.task_id).toBe(56);
    expect(hookApi.error).toBeNull();
    expect(hookApi.loading).toBe(false);
    expect(deadPanel()).toBe(false);
  });

  it('태스크를 갈아탄 뒤 도착한 옛 응답은 새 태스크를 덮지 않는다', async () => {
    gateNextDetailGet = true;
    await mount(55);          // 55의 최초 GET 보류
    expect(hookApi.task).toBeNull();

    await switchTo(56);       // 56은 즉시 로드
    expect(hookApi.task?.task_id).toBe(56);

    await releaseDetailGet(); // 뒤늦게 도착한 55 응답
    expect(hookApi.task?.task_id).toBe(56);
    expect(deadPanel()).toBe(false);
  });
});
