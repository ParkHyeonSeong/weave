// @vitest-environment jsdom
//
// useTaskDetail.updateLabel — 예전에는 실패를 삼키고 아무것도 돌려주지 않아, 편집창이 성공·실패를
// 구분할 수 없었다. 이제 결과를 돌려준다: 성공이면 브랜치 라벨 목록과 이 태스크를 다시 받은 뒤 { ok:true },
// 다른 화면에는 task:updated 1회. 컨트롤러 거절(200 + status:false)·HTTP 오류·통신 실패는 재조회·알림 없이
// { ok:false, code, category, network }.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn() } }));
import { axios } from '@/library/_axios';
import useTaskDetail from '@/hooks/useTaskDetail';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BRANCH = 18;
const TASK = 175;
let hookApi;
let root;
let server;
let events;
const countEvent = () => { events += 1; };

function Probe() {
  hookApi = useTaskDetail(BRANCH, TASK);
  return null;
}

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => { setTimeout(r, 0); });
};

function respond(url) {
  if (url === `/branches/${BRANCH}/tasks/${TASK}`) {
    return { data: { status: true, task: { task_id: TASK, task_type: 'task', labels: server.labels.filter((l) => l.assigned), subtasks: [] } } };
  }
  if (url === `/branches/${BRANCH}/labels`) return { data: { status: true, labels: server.labels } };
  const key = url.split('/').pop().replace(/-/g, '_');
  return { data: { status: true, [key === 'workflow_statuses' ? 'statuses' : key]: [] } };
}

beforeEach(async () => {
  vi.clearAllMocks();
  server = {
    labels: [
      { label_id: 33, label_name: 'Frontend', color: '#5E6AD2', assigned: true },
      { label_id: 32, label_name: 'UX 개선', color: '#0D9488', assigned: true },
    ],
  };
  events = 0;
  window.addEventListener('task:updated', countEvent);
  axios.get.mockImplementation(async (url) => respond(url));
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<Probe />); await flush(); });
  events = 0;
  axios.get.mockClear();
});
afterEach(async () => {
  window.removeEventListener('task:updated', countEvent);
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe('updateLabel 결과 계약', () => {
  it('성공: 라벨 목록·태스크를 다시 받은 뒤 { ok:true }, task:updated 1회, label_id 그대로 새 이름', async () => {
    axios.patch.mockImplementation(async (url, body) => {
      const lbl = server.labels.find((l) => l.label_id === 32);
      Object.assign(lbl, body);
      return { data: { status: true } };
    });
    let result;
    await act(async () => { result = await hookApi.updateLabel(32, { label_name: '사용성 개선' }); await flush(); });
    expect(result).toEqual({ ok: true });
    expect(axios.patch).toHaveBeenCalledWith(`/branches/${BRANCH}/labels/32`, { label_name: '사용성 개선' });
    const urls = axios.get.mock.calls.map(([u]) => u);
    expect(urls).toContain(`/branches/${BRANCH}/labels`);
    expect(urls).toContain(`/branches/${BRANCH}/tasks/${TASK}`);
    expect(events).toBe(1);
    expect(hookApi.task.labels.find((l) => l.label_id === 32).label_name).toBe('사용성 개선');
    expect(hookApi.labels.find((l) => l.label_id === 32).label_name).toBe('사용성 개선');
  });

  it('컨트롤러 거절: 코드·분류를 돌려주고 재조회·알림이 없다', async () => {
    axios.patch.mockResolvedValue({ data: { status: false, message: 'LABEL_ALREADY_EXISTS', code: 'LABEL_ALREADY_EXISTS', category: 'conflict', retryable: false } });
    let result;
    await act(async () => { result = await hookApi.updateLabel(32, { label_name: 'Frontend' }); await flush(); });
    expect(result).toEqual({ ok: false, code: 'LABEL_ALREADY_EXISTS', category: 'conflict', network: false });
    expect(axios.get).not.toHaveBeenCalled();
    expect(events).toBe(0);
  });

  it('통신 실패(응답 없음)는 network', async () => {
    axios.patch.mockRejectedValue(new Error('Network Error'));
    let result;
    await act(async () => { result = await hookApi.updateLabel(32, { color: '#DC2626' }); });
    expect(result).toEqual({ ok: false, code: null, category: null, network: true });
    expect(events).toBe(0);
  });

  it('HTTP 500은 서버 분류', async () => {
    axios.patch.mockRejectedValue({ response: { status: 500, data: { status: false, code: 'INTERNAL_SERVER_ERROR', category: 'server' } } });
    let result;
    await act(async () => { result = await hookApi.updateLabel(32, { color: '#DC2626' }); });
    expect(result).toMatchObject({ ok: false, category: 'server', network: false });
  });
});
