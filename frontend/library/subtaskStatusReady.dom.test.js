// @vitest-environment jsdom
//
// 하위태스크 인라인 상태 셀렉트의 "워크플로 상태 미로딩" 가드 회귀.
//
// 상세 GET은 브랜치 옵션(workflow-statuses 포함) 6요청보다 먼저 오는 게 보통이라,
// 하위태스크 행이 그려진 뒤에도 workflowStatuses가 잠깐 빈 배열인 창이 있다. 그 창에서
// 셀렉트가 눌리면 DEFAULT_STATUS_FALLBACK의 하드코딩 키('todo'/'done'…)로 PATCH가 나가,
// 커스텀 상태만 쓰는 브랜치에서는 INVALID_STATUS로 실패하고 롤백된다.
// 진행도는 progressFromRows의 null 게이팅으로 이미 막혀 있는데 셀렉트만 열려 있었다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({
  axios: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  getBaseURL: () => '',
}));
import TaskSubtaskSection from '@/components/Branch/Tasks/TaskSubtaskSection';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SUB = 58;
// 브랜치가 커스텀 상태만 쓰는 경우 — 폴백 키('todo'/'done')는 이 브랜치에 존재하지 않는다.
const CUSTOM_STATUSES = [
  { key: 'drafting', label: 'Drafting', color: '#9CA3AF', category: 'todo' },
  { key: 'shipped', label: 'Shipped', color: '#16A34A', category: 'done' },
];
const SUBTASKS = [
  { task_id: SUB, branch_id: 15, display_id: 'QA-4', title: '하위 A', status: 'drafting', assignees: [] },
];

let activeRoot;
let container;
let onStatusChange;

const flush = async () => {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

async function render(workflowStatuses) {
  await act(async () => {
    activeRoot.render(
      <TaskSubtaskSection
        branchId={15}
        taskId={55}
        subtasks={SUBTASKS}
        progress={workflowStatuses.length > 0 ? { done: 0, total: 1 } : null}
        workflowStatuses={workflowStatuses}
        onStatusChange={onStatusChange}
      />,
    );
    await flush();
  });
}

const trigger = () => container.querySelector('.CustomSelect__Trigger');
const dropdown = () => document.querySelector('.CustomSelect__Dropdown');

async function click(el) {
  await act(async () => { el.click(); await flush(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  onStatusChange = vi.fn(async () => ({ ok: true }));
  container = document.createElement('div');
  document.body.appendChild(container);
  activeRoot = createRoot(container);
});

afterEach(async () => {
  if (activeRoot) {
    await act(async () => { activeRoot.unmount(); });
    activeRoot = null;
  }
  document.body.innerHTML = '';
});

describe('하위태스크 상태 셀렉트 — workflowStatuses 미로딩 가드', () => {
  it('상태 미로딩이면 셀렉트가 비활성이고 열리지도 않는다', async () => {
    await render([]);

    expect(trigger()).not.toBeNull();          // 표시는 유지된다(폴백은 표시 전용)
    expect(trigger().disabled).toBe(true);

    await click(trigger());
    expect(dropdown()).toBeNull();             // 폴백 키 목록이 열리면 안 된다
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('상태 미로딩 중에는 어떤 경로로도 PATCH가 나가지 않는다', async () => {
    await render([]);

    // disabled 속성을 강제로 풀어도(=속성 우회) 내부 가드가 변경을 막아야 한다.
    await act(async () => { trigger().disabled = false; await flush(); });
    await click(trigger());

    expect(dropdown()).toBeNull();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('상태가 로드되면 같은 클릭이 브랜치 실제 상태로 변경된다', async () => {
    await render(CUSTOM_STATUSES);

    expect(trigger().disabled).toBe(false);
    await click(trigger());

    const options = [...dropdown().querySelectorAll('.CustomSelect__Option')].map((o) => o.textContent.trim());
    expect(options).toEqual(['Drafting', 'Shipped']); // 폴백이 아니라 브랜치 상태

    await click([...dropdown().querySelectorAll('.CustomSelect__Option')].find((o) => o.textContent.trim() === 'Shipped'));
    expect(onStatusChange).toHaveBeenCalledWith(SUB, 'shipped');
  });
});
