// @vitest-environment jsdom
//
// 하위태스크 인라인 상태 변경의 역순 완료(out-of-order PATCH) 회귀.
//
// 서로 다른 두 행을 빠르게 바꾸면 PATCH 완료 순서가 뒤집힐 수 있다. 먼저 끝난 쪽이
// 곧바로 상세를 재조회하면 아직 커밋되지 않은 다른 행이 옛 서버 값으로 되돌아오고,
// 늦게 끝난 쪽의 재조회는 순번(resyncSeq)에서 밀려 폐기돼 UI가 서버와 어긋난 채 남는다.
//
// 여기서는 PATCH를 게이트로 붙잡아 완료 순서를 결정적으로 뒤집고, 최종 UI가 서버와
// 일치하는지 본다. 게이트를 쓰므로 타이머·랜덤에 의존하지 않는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn() } }));
import { axios } from '@/library/_axios';
import useTaskDetail from '@/hooks/useTaskDetail';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BRANCH = 15;
const PARENT = 55;
const A = 58; // 하위 A — PATCH를 늦게 끝낸다
const B = 59; // 하위 B — PATCH를 먼저 끝낸다
const DETAIL_URL = `/branches/${BRANCH}/tasks/${PARENT}`;

let server;      // 커밋된 서버 상태 { [subtaskId]: status }
let patchGates;  // Map<subtaskId, { promise, resolve, body }>
let timeline;    // 실제 실행 순서 기록 (역순 재현 증거)
let hookApi;
let activeRoot;
let gateNextDetailGet;  // true면 다음 상세 GET 응답을 게이트에 걸어 둔다
let heldDetailGets;     // 보류 중인 상세 GET [{ resolve, task, returned }]
let inFlight;           // startChange로 시작해 둔 변경들

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const note = (event) => timeline.push(event);

// setTimeout(0) 몇 번 = axios mock(async) → await → setState 체인이 모두 소진될 때까지.
const flush = async () => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

function taskSnapshot() {
  return {
    task_id: PARENT,
    branch_id: BRANCH,
    title: '부모 태스크',
    status: 'in_progress',
    task_type: 'task',
    description: null,
    custom_fields: {},
    assignees: [],
    labels: [],
    subtasks: [
      { task_id: A, branch_id: BRANCH, display_id: 'QA-4', title: '하위 A', status: server[A], assignees: [] },
      { task_id: B, branch_id: BRANCH, display_id: 'QA-5', title: '하위 B', status: server[B], assignees: [] },
    ],
  };
}

function Probe() {
  hookApi = useTaskDetail(BRANCH, PARENT);
  return null;
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  activeRoot = createRoot(container);
  await act(async () => {
    activeRoot.render(<Probe />);
    await flush();
  });
}

// 한 행의 상태 변경을 시작한다 — PATCH가 게이트에 걸린 채로 돌아온다.
// 반환값이 promise를 **감싼 객체**인 이유: async 함수가 promise를 그대로 반환하면 채택돼
// "시작만 하고 계속 진행"이 불가능해진다. 개별 결과가 필요한 테스트만 .call을 쓴다.
async function startChange(id, status) {
  let call;
  await act(async () => {
    call = hookApi.updateSubtaskStatus(id, status);
    await flush();
  });
  inFlight.push(call);
  return { call };
}

// 다른 화면이 쏜 task:updated — origin 태그가 없어 이 훅이 재조회한다.
async function externalUpdate() {
  await act(async () => {
    window.dispatchEvent(new Event('task:updated'));
    await flush();
  });
}

// 시작해 둔 변경이 전부 끝날 때까지 기다린다.
async function settleAll() {
  await act(async () => {
    await Promise.all(inFlight);
    await flush();
  });
}

// 게이트를 열어 PATCH를 완료시킨다. ok면 그 시점에 서버도 커밋된다.
async function resolvePatch(id, { ok = true } = {}) {
  const gate = patchGates.get(id);
  if (ok) server[id] = gate.body.status;
  note({ step: `PATCH ${id} 완료(${ok ? 'ok' : 'fail'})`, serverAfter: { ...server } });
  await act(async () => {
    gate.resolve({
      data: ok
        ? { status: true }
        : { status: false, message: 'INVALID_STATUS', code: 'INVALID_STATUS', category: 'validation' },
    });
    await flush();
  });
}

// 보류해 둔 상세 GET을 반환시킨다. 스냅샷은 "요청 시점"에 굳었으므로,
// 그 사이 바뀐 낙관 상태는 이 응답에 담겨 있지 않다.
async function releaseDetailGet() {
  const held = heldDetailGets.shift();
  note({ step: 'GET 상세 반환', returned: held.returned });
  await act(async () => {
    held.resolve({ data: { status: true, task: held.task } });
    await flush();
  });
}

const uiStatuses = () => Object.fromEntries(
  (hookApi.task?.subtasks || []).map((s) => [s.task_id, s.status]),
);

const detailGets = () => timeline.filter((e) => e.step === 'GET 상세');

beforeEach(() => {
  vi.clearAllMocks();
  server = { [A]: 'todo', [B]: 'todo' };
  patchGates = new Map();
  timeline = [];
  hookApi = null;
  gateNextDetailGet = false;
  heldDetailGets = [];
  inFlight = [];

  axios.get.mockImplementation(async (url) => {
    if (url === DETAIL_URL) {
      // 스냅샷은 "요청 시점의 서버 상태" — 아직 커밋되지 않은 행은 옛 값으로 실려 나간다.
      const task = taskSnapshot();
      const returned = { [A]: task.subtasks[0].status, [B]: task.subtasks[1].status };
      note({ step: 'GET 상세', returned });
      if (gateNextDetailGet) {
        gateNextDetailGet = false;
        const gate = deferred();
        heldDetailGets.push({ resolve: gate.resolve, task, returned });
        return gate.promise; // 테스트가 반환시킬 때까지 대기
      }
      return { data: { status: true, task } };
    }
    return {
      data: {
        status: true, sprints: [], epics: [], members: [], labels: [], statuses: [], task_types: [],
      },
    };
  });

  axios.patch.mockImplementation((url, body) => {
    const id = Number(String(url).match(/\/tasks\/(\d+)$/)[1]);
    const gate = deferred();
    patchGates.set(id, { ...gate, body });
    note({ step: `PATCH ${id} 발행` });
    return gate.promise; // 테스트가 열어 줄 때까지 대기
  });
});

afterEach(async () => {
  if (activeRoot) {
    await act(async () => { activeRoot.unmount(); });
    activeRoot = null;
  }
  document.body.innerHTML = '';
});

describe('하위태스크 상태 — 역순 PATCH 완료', () => {
  it('먼저 끝난 B의 재조회가 아직 커밋 전인 A를 옛 값으로 되돌리지 않는다', async () => {
    await mount();
    expect(uiStatuses()).toEqual({ [A]: 'todo', [B]: 'todo' });

    // 1) A 행 변경 시작 — PATCH는 게이트에 걸려 지연된다
    await startChange(A, 'done');
    expect(uiStatuses()[A]).toBe('done'); // 낙관적 반영

    // 2) B 행 변경 시작 — A가 아직 진행 중인 상태에서
    await startChange(B, 'done');
    expect(uiStatuses()).toEqual({ [A]: 'done', [B]: 'done' });
    expect(patchGates.has(A) && patchGates.has(B)).toBe(true);

    // 3) B의 PATCH만 먼저 성공 — 서버는 B만 커밋(A는 아직 todo)
    await resolvePatch(B);
    expect(server).toEqual({ [A]: 'todo', [B]: 'done' });

    // 여기서 A가 'todo'로 되돌아가면 회귀다.
    // (이 시점에 나가는 재조회는 A=todo를 실어 오므로, 그 스냅샷이 그대로 적용되면 안 된다.)
    expect(uiStatuses()).toEqual({ [A]: 'done', [B]: 'done' });

    // 4) 이제 A의 PATCH 성공
    await resolvePatch(A);
    await settleAll();

    // 5) 최종 UI와 서버가 모두 A=done, B=done
    expect(server).toEqual({ [A]: 'done', [B]: 'done' });
    expect(uiStatuses()).toEqual({ [A]: 'done', [B]: 'done' });

    // 수렴 재조회는 두 커밋이 모두 끝난 뒤에 나가야 한다 — 마지막 GET이 본 서버 상태로 확인
    const last = detailGets().at(-1);
    expect(last.returned).toEqual({ [A]: 'done', [B]: 'done' });

    // 실제 실행 순서 고정: B 커밋과 A 커밋 사이에 상세 GET이 끼어들지 않는다.
    expect(timeline.map((e) => e.step)).toEqual([
      'GET 상세',        // 마운트
      `PATCH ${A} 발행`,
      `PATCH ${B} 발행`,
      `PATCH ${B} 완료(ok)`,
      `PATCH ${A} 완료(ok)`,
      'GET 상세',        // 수렴 — 두 커밋 이후 단 한 번
    ]);
  });

  it('A 커밋 전에 도착한 외부 재조회 스냅샷도 진행 중인 A를 덮지 않는다', async () => {
    await mount();

    await startChange(A, 'done');
    await startChange(B, 'done');

    await resolvePatch(B); // 서버: A=todo, B=done

    // 그 스냅샷에는 A=todo가 실려 있지만 진행 중인 A를 되돌리면 안 된다.
    await externalUpdate();
    expect(timeline.some((e) => e.step === 'GET 상세' && e.returned[A] === 'todo')).toBe(true);
    expect(uiStatuses()).toEqual({ [A]: 'done', [B]: 'done' });

    await resolvePatch(A);
    await settleAll();
    expect(uiStatuses()).toEqual({ [A]: 'done', [B]: 'done' });
    expect(server).toEqual({ [A]: 'done', [B]: 'done' });
  });

  // 오버레이 수명 회귀: 수렴 GET이 대기하는 동안 시작된 다른 행의 오버레이를
  // 그 GET의 뒷정리가 함께 지워 버리면, 그 행은 (a) 외부 재조회에 낙관 상태를 빼앗기고
  // (b) 오버레이가 비어 최종 수렴 GET조차 생기지 않아 서버와 어긋난 채 남는다.
  it('수렴 GET이 대기하는 동안 시작된 B의 오버레이를 그 GET이 삭제하지 않는다', async () => {
    await mount();

    // 1) A 상태 PATCH 성공
    await startChange(A, 'done');
    // 2) A의 수렴 상세 GET은 게이트로 보류
    gateNextDetailGet = true;
    await resolvePatch(A);
    expect(server).toEqual({ [A]: 'done', [B]: 'todo' });
    expect(heldDetailGets).toHaveLength(1);
    expect(heldDetailGets[0].returned).toEqual({ [A]: 'done', [B]: 'todo' });

    // 3) 그 GET이 대기 중일 때 B 상태 PATCH 시작
    await startChange(B, 'done');
    expect(uiStatuses()).toEqual({ [A]: 'done', [B]: 'done' });

    // 4) A의 수렴 GET을 먼저 반환 — 스냅샷에는 B=todo가 실려 있다
    await releaseDetailGet();
    expect(uiStatuses()).toEqual({ [A]: 'done', [B]: 'done' });

    // 5) B PATCH 커밋 전 외부 task:updated 재조회 (스냅샷 역시 B=todo)
    await externalUpdate();

    // 6) B는 계속 낙관 상태여야 한다
    //    (옛 구현은 4번의 전체 clear로 B 오버레이가 사라져 여기서 todo로 되돌아간다)
    expect(uiStatuses()).toEqual({ [A]: 'done', [B]: 'done' });

    // 7) B PATCH 성공 → 최종 UI·서버 일치 + authoritative GET으로 수렴
    await resolvePatch(B);
    await settleAll();
    expect(server).toEqual({ [A]: 'done', [B]: 'done' });
    expect(uiStatuses()).toEqual({ [A]: 'done', [B]: 'done' });
    //    옛 구현은 오버레이가 비어 수렴 GET 자체가 생기지 않아 마지막 GET이 B=todo로 남는다
    expect(detailGets().at(-1).returned).toEqual({ [A]: 'done', [B]: 'done' });
  });

  it('수렴 GET이 외부 재조회에 밀려 폐기돼도 committed 오버레이가 영구 잔존하지 않는다', async () => {
    await mount();

    await startChange(A, 'done');
    gateNextDetailGet = true;
    await resolvePatch(A); // 서버 A=done, 수렴 GET 보류

    // 수렴 GET이 대기하는 동안 외부 재조회가 순번을 가져간다 → 수렴 GET은 폐기된다
    await externalUpdate();
    await releaseDetailGet();
    await settleAll();
    expect(uiStatuses()[A]).toBe('done');

    // 이후 누군가 A를 되돌리면 그 값이 보여야 한다 — 오버레이가 남아 있으면 done으로 고정된다.
    server[A] = 'todo';
    await externalUpdate();
    expect(uiStatuses()[A]).toBe('todo');
  });

  it('실패한 행만 롤백하고 함께 진행 중이던 행은 유지한다', async () => {
    await mount();

    await startChange(A, 'done');
    const b = await startChange(B, 'done');

    await resolvePatch(B, { ok: false }); // 컨트롤러 검증 실패(200 + status:false)
    expect(await b.call).toEqual({ ok: false, code: 'INVALID_STATUS', category: 'validation' });
    expect(uiStatuses()).toEqual({ [A]: 'done', [B]: 'todo' }); // B만 원복, A는 유지

    await resolvePatch(A);
    await settleAll();
    expect(uiStatuses()).toEqual({ [A]: 'done', [B]: 'todo' });
    expect(server).toEqual({ [A]: 'done', [B]: 'todo' });
  });

  it('단일 변경은 자기 task:updated로 중복 GET을 내지 않는다 (마운트 1회 + 수렴 1회)', async () => {
    await mount();
    expect(detailGets()).toHaveLength(1); // 마운트

    await startChange(A, 'done');
    await resolvePatch(A);
    await settleAll();

    expect(detailGets()).toHaveLength(2); // 마운트 + 수렴 재조회, 자기 이벤트로 인한 3번째 없음
    expect(uiStatuses()[A]).toBe('done');
  });

});
