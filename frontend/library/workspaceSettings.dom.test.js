// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn() } }));
import { axios } from '@/library/_axios';

import {
  WorkspaceSettingsProvider,
  useWorkspaceSettings,
  clearWorkspaceSettingsCache,
  WORKSPACE_SETTINGS_KEY,
} from '@/library/workspaceSettings';
import { useWorkspaceDateFormat } from '@/hooks/useDateFormat';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot = null;
let seen = null;
let api = null;

function Probe() {
  const ws = useWorkspaceSettings();
  const wd = useWorkspaceDateFormat();
  seen = { status: ws.status, timeZone: ws.timeZone, workspaceName: ws.workspaceName, today: wd.today(), wdStatus: wd.status };
  api = ws;
  return null;
}

async function mount() {
  activeRoot = createRoot(document.getElementById('root'));
  await act(async () => {
    activeRoot.render(<WorkspaceSettingsProvider><Probe /></WorkspaceSettingsProvider>);
  });
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  clearWorkspaceSettingsCache();
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(async () => { if (activeRoot) { await act(async () => activeRoot.unmount()); activeRoot = null; } });

describe('WorkspaceSettingsProvider — fail-closed', () => {
  it('조회 실패 → status error, timezone null, 캐시 없음, 공용 today는 null', async () => {
    axios.get.mockRejectedValue(new Error('network'));
    await mount();
    expect(seen.status).toBe('error');
    expect(seen.timeZone).toBeNull();
    expect(seen.today).toBeNull();
    expect(seen.wdStatus).toBe('error');
    expect(sessionStorage.getItem(WORKSPACE_SETTINGS_KEY)).toBeNull();
  });

  it('성공 응답에 time_zone이 없는 구버전 서버만 Asia/Seoul 호환값을 쓴다', async () => {
    axios.get.mockResolvedValue({ data: { status: true, initialized: true, workspace_name: 'Old' } });
    await mount();
    expect(seen.status).toBe('success');
    expect(seen.timeZone).toBe('Asia/Seoul');
    expect(seen.workspaceName).toBe('Old');
    expect(seen.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('성공 응답이어도 time_zone이 무효한 IANA ID면 호환값 없이 error (필드 부재와 구분)', async () => {
    axios.get.mockResolvedValue({ data: { status: true, initialized: true, workspace_name: 'W', time_zone: 'Not/AZone' } });
    await mount();
    expect(seen.status).toBe('error');
    expect(seen.timeZone).toBeNull();
    expect(seen.today).toBeNull();
    expect(sessionStorage.getItem(WORKSPACE_SETTINGS_KEY)).toBeNull();
  });

  it('성공 응답의 time_zone을 쓰고 캐시한다', async () => {
    axios.get.mockResolvedValue({ data: { status: true, initialized: true, workspace_name: 'W', time_zone: 'America/New_York' } });
    await mount();
    expect(seen.status).toBe('success');
    expect(seen.timeZone).toBe('America/New_York');
    expect(JSON.parse(sessionStorage.getItem(WORKSPACE_SETTINGS_KEY)).time_zone).toBe('America/New_York');
  });

  it('무효화 이벤트/refresh 후 다시 조회한다 (실패 → 성공 전이)', async () => {
    axios.get.mockRejectedValueOnce(new Error('down'));
    await mount();
    expect(seen.status).toBe('error');

    axios.get.mockResolvedValue({ data: { status: true, initialized: true, workspace_name: 'W', time_zone: 'Europe/Paris' } });
    await act(async () => { api.refresh(); });
    await act(async () => {});
    expect(seen.status).toBe('success');
    expect(seen.timeZone).toBe('Europe/Paris');
    expect(axios.get).toHaveBeenCalledTimes(2);

    // 캐시 무효화(Setup 완료·로그아웃) → 재조회
    axios.get.mockResolvedValue({ data: { status: true, initialized: true, workspace_name: 'W2', time_zone: 'Asia/Tokyo' } });
    await act(async () => { clearWorkspaceSettingsCache(); });
    await act(async () => {});
    expect(seen.timeZone).toBe('Asia/Tokyo');
    expect(seen.workspaceName).toBe('W2');
  });

  it('미초기화 응답은 캐시하지 않는다', async () => {
    axios.get.mockResolvedValue({ data: { status: true, initialized: false } });
    await mount();
    expect(seen.status).toBe('success');
    expect(sessionStorage.getItem(WORKSPACE_SETTINGS_KEY)).toBeNull();
  });
});
