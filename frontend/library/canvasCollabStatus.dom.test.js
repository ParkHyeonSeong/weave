// @vitest-environment jsdom
// 캔버스 페이지·개요 편집 상단 문구와 닫기. 연결됐다는 이유만으로 "Saved"를 보이지 않는다. 바뀐 순간부터 마지막 변경의
// 저장(PATCH)이 끝날 때까지 "Saving…", 연결이 끊겼거나 전송 확인 전이면 저장 상태 대신 연결 안내를 보인다. 서버 적용이
// 확인되지 않은 입력이 있으면 닫기(버튼·⌘S) 전에 묻고, 닫기 저장을 기다리는 사이 상황이 바뀌면 문서를 파기하기 직전에
// 최신 상태로 다시 묻는다. 렌더 하네스는 sanitizeSavePath.dom.test.js와 같다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

// 협업 훅 모의가 읽는 상태 — 테스트가 바꾸면 useSyncExternalStore로 다시 렌더된다(재연결 같은 전환을 흉내 낸다).
// deliveryRef는 훅이 돌려주는 최신값 ref처럼 set 즉시(렌더를 기다리지 않고) 바뀐다.
// provider는 이미 방 동기화를 마친 y-websocket처럼 둔다 — 편집기는 동기화 뒤 다시 읽은 페이지로 열린다(useCollabEditBase).
// 렌더마다 같은 객체여야 한다(편집 세션마다 하나).
const { dynProps, collabStore, SYNCED_PROVIDER } = vi.hoisted(() => {
  let value = {};
  const listeners = new Set();
  const deliveryRef = { current: { connection: 'connected', pending: false } };
  return {
    dynProps: [],
    SYNCED_PROVIDER: { synced: true, on() {}, off() {} },
    collabStore: {
      deliveryRef,
      get: () => value,
      set: (next) => {
        value = next;
        deliveryRef.current = { connection: next.connection ?? 'connected', pending: !!next.pending };
        listeners.forEach((l) => l());
      },
      subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    },
  };
});
vi.mock('@/library/_axios', () => ({
  axios: {
    get: vi.fn((url) => Promise.resolve({ data: globalThis.__GET(url) })),
    patch: vi.fn(() => Promise.resolve({ data: { status: true } })),
    post: vi.fn(() => Promise.resolve({ data: { status: true } })),
    delete: vi.fn(() => Promise.resolve({ data: { status: true } })),
  },
  getBaseURL: () => '',
  getWsBaseURL: () => '',
  refreshAccessToken: async () => null,
}));
vi.mock('next/router', () => ({ useRouter: () => globalThis.__ROUTER }));
vi.mock('next/dynamic', () => ({ default: () => function DynamicStub(props) { dynProps.push(props); return null; } }));
vi.mock('@/library/useCollabProvider', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    default: (cid, pid) => {
      const collab = useSyncExternalStore(collabStore.subscribe, collabStore.get);
      return { ydoc: cid && pid ? {} : null, provider: cid && pid ? SYNCED_PROVIDER : null, status: 'connected',
               connectedUsers: [], ...collab, deliveryRef: collabStore.deliveryRef };
    },
  };
});
vi.mock('@/library/typstCompiler', () => ({ compileToSvg: async () => '', downloadPdf: async () => {} }));

import { axios } from '@/library/_axios';
import CanvasOverview from '@/components/Canvas/CanvasOverview';
import CanvasPageView from '@/components/Canvas/CanvasPageView';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

let root;
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t));
const statusText = (sel) => document.querySelector(sel)?.textContent ?? null;
const change = (html) => act(async () => { dynProps.filter((p) => p.onHtmlChange).at(-1).onHtmlChange(html); });
const wait5s = () => act(async () => { await vi.advanceTimersByTimeAsync(5000); });
const savedContents = () => axios.patch.mock.calls.map(([, body]) => body.content);
const clickClose = () => click(btn('Close'));
const pressCmdS = () => act(async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
});

const VIEWS = [
  ['CanvasPageView', CanvasPageView, { canvasId: '3', pageId: '9' }, '.CanvasPageView__StatusGroup',
    [['닫기 버튼', clickClose], ['⌘S', pressCmdS]]],
  ['CanvasOverview', CanvasOverview, { canvasId: '3' }, '.CanvasOverview__StatusGroup', [['닫기 버튼', clickClose]]],
];
const DELIVERED = { connection: 'connected', pending: false };

async function enterEdit(View, query, collab = DELIVERED) {
  collabStore.set(collab);
  globalThis.__ROUTER = { query, push() {}, replace() {} };
  const type = query.pageId ? 'doc' : 'overview';
  globalThis.__GET = (u) => ({
    '/canvases/3': { status: true, canvas: { canvas_name: 'C', my_role: 'admin' } },
    '/canvases/3/pages': { status: true, pages: [{ page_id: 9, type, title: 'P' }] },
    '/canvases/3/pages/9': { status: true, page: { page_id: 9, type, title: 'P', content: '<p>old</p>' } },
  }[u] || { status: false });
  sessionStorage.setItem('profile', JSON.stringify({ user_id: 1, username: 'me' }));
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<View />); });
  await click(btn('Edit'));
}

beforeEach(() => { vi.clearAllMocks(); dynProps.length = 0; vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  if (root) { act(() => root.unmount()); root = null; }
});

describe.each(VIEWS)('%s 편집 상단 문구', (_name, View, query, sel, closePaths) => {
  it('바뀐 순간부터 저장이 끝날 때까지 "Saving…", 끝나면 "Saved"', async () => {
    await enterEdit(View, query);
    await change('<p>a</p>');
    expect(statusText(sel)).toContain('Saving…');
    await wait5s();
    expect(statusText(sel)).toContain('Saved');
  });

  it('앞 저장이 늦게 끝나도 그사이 새 변경이 있으면 "Saved"로 바꾸지 않는다', async () => {
    let finishFirst;
    axios.patch.mockImplementationOnce(() => new Promise((r) => { finishFirst = () => r({ data: { status: true } }); }));
    await enterEdit(View, query);
    await change('<p>a</p>');
    await wait5s();                                   // 첫 PATCH 진행 중
    await change('<p>ab</p>');                        // 새 변경(5초 뒤 저장 예정)
    await act(async () => { finishFirst(); });
    expect(statusText(sel)).toContain('Saving…');
    await wait5s();
    expect(statusText(sel)).toContain('Saved');
  });

  it('다시 연결됐다는 이유로, 끝나지 않은 저장을 "Saved"로 바꾸지 않는다', async () => {
    let finish;
    axios.patch.mockImplementationOnce(() => new Promise((r) => { finish = () => r({ data: { status: true } }); }));
    await enterEdit(View, query, { status: 'disconnected', connection: 'reconnecting', pending: false });
    await change('<p>a</p>');
    await wait5s();                                   // PATCH 진행 중
    await act(async () => { collabStore.set({ status: 'connected', ...DELIVERED }); });   // 재연결
    expect(statusText(sel)).toContain('Saving…');
    await act(async () => { finish(); });
    expect(statusText(sel)).toContain('Saved');
  });

  it('저장이 실패하면 "Offline"이 아니라 "Couldn\'t save"', async () => {
    axios.patch.mockRejectedValueOnce(new Error('500'));
    await enterEdit(View, query);
    await change('<p>a</p>');
    await wait5s();
    expect(statusText(sel)).toContain("Couldn't save");
  });

  it.each([
    [{ connection: 'reconnecting', pending: false }, 'Connection lost · Reconnecting…'],
    [{ connection: 'reconnecting', pending: true }, 'Changes not yet confirmed · Keep this page open until it reconnects'],
    [{ connection: 'connected', pending: true }, 'Confirming your changes…'],
    [{ connection: 'connecting', pending: false }, 'Connecting…'],
  ])('%o이면 저장 상태 대신 연결 안내 — "Saved"를 보이지 않는다', async (collab, text) => {
    await enterEdit(View, query, collab);
    expect(statusText(sel)).toContain(text);
    expect(statusText(sel)).not.toContain('Saved');
  });

  it('서버 적용이 확인되지 않은 입력이 있으면 닫기 전에 묻고, 취소하면 닫지도 저장하지도 않는다(다시 닫을 때 한 번만 묻는다)', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await enterEdit(View, query, { connection: 'reconnecting', pending: true });
    await change('<p>a</p>');
    await click(btn('Close'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(axios.patch).not.toHaveBeenCalled();
    expect(statusText(sel)).not.toBeNull();           // 아직 편집 중
    confirm.mockReturnValue(true);
    await click(btn('Close'));
    expect(statusText(sel)).toBeNull();               // 닫힘
    expect(confirm).toHaveBeenCalledTimes(2);         // 그사이 새 입력이 없으면 파기 직전에 또 묻지 않는다
  });

  it('확인 안 된 입력이 없으면 묻지 않고 닫는다', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    await enterEdit(View, query);
    await click(btn('Close'));
    expect(confirm).not.toHaveBeenCalled();
    expect(statusText(sel)).toBeNull();
  });

  it.each(closePaths)('%s: 닫기 저장을 기다리는 사이 연결이 끊기고 새 입력이 생기면, 문서를 파기하기 직전에 다시 묻고 취소하면 편집기와 새 입력이 남는다', async (_path, close) => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    let finishFirst;
    axios.patch.mockImplementationOnce(() => new Promise((r) => { finishFirst = () => r({ data: { status: true } }); }));
    await enterEdit(View, query);                     // 연결됨·확인 안 된 입력 없음
    await change('<p>a</p>');
    await close();                                    // 시작 때는 물을 것이 없다 → 첫 PATCH가 gate에서 멈춘다
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => { collabStore.set({ status: 'disconnected', connection: 'reconnecting', pending: true }); });
    await change('<p>ab</p>');                        // 끊긴 동안 새 입력
    await act(async () => { finishFirst(); });
    await act(async () => {});
    expect(confirm).toHaveBeenCalledTimes(1);         // 파기 직전, 최신 상태로 다시 물었다
    expect(statusText(sel)).not.toBeNull();           // 취소 → 편집기가 남는다
    expect(savedContents()).toEqual(['<p>a</p>', '<p>ab</p>']);   // 기다리는 사이 바뀐 내용도 저장했다
    await wait5s();                                   // 새 입력의 저장 예약(debounce)과 버퍼도 그대로다
    expect(savedContents()).toEqual(['<p>a</p>', '<p>ab</p>', '<p>ab</p>']);
  });

  it.each(closePaths)('%s: 닫기 저장 중 생긴 확인 안 된 새 입력을 알고도 닫으면 그 내용까지 저장하고 닫는다', async (_path, close) => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    let finishFirst;
    axios.patch.mockImplementationOnce(() => new Promise((r) => { finishFirst = () => r({ data: { status: true } }); }));
    await enterEdit(View, query);
    await change('<p>a</p>');
    await close();
    await act(async () => { collabStore.set({ status: 'disconnected', connection: 'reconnecting', pending: true }); });
    await change('<p>ab</p>');
    await act(async () => { finishFirst(); });
    await act(async () => {});
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(statusText(sel)).toBeNull();               // 닫힘
    expect(savedContents()).toEqual(['<p>a</p>', '<p>ab</p>']);
  });

  // 다시 편집할 때의 문구는 지난 세션의 닫기 저장 결과에서 시작한다. 편집기가 들어올 때 onHtmlChange를 부르지 않으면
  // (Typst 편집기, 이 모의 편집기) 새 입력 전까지 문구가 바뀌지 않으므로 지난 세션의 "Saving…"이 남으면 안 된다.
  it('저장 예약이 끝나기 전에 닫았다가 다시 편집하면 지난 세션의 "Saving…"이 남지 않는다', async () => {
    await enterEdit(View, query);
    await change('<p>a</p>');
    expect(statusText(sel)).toContain('Saving…');
    await clickClose();                               // 5초 전에 닫기 — 닫기 저장 성공
    expect(statusText(sel)).toBeNull();
    await click(btn('Edit'));
    expect(statusText(sel)).toContain('Saved');
  });

  it('앞 저장이 실패했어도 닫기 저장이 성공했으면 다시 편집할 때 "Couldn\'t save"가 남지 않는다', async () => {
    axios.patch.mockRejectedValueOnce(new Error('500'));
    await enterEdit(View, query);
    await change('<p>a</p>');
    await wait5s();
    expect(statusText(sel)).toContain("Couldn't save");
    await clickClose();                               // 닫기 저장 성공
    await click(btn('Edit'));
    expect(statusText(sel)).toContain('Saved');
  });

  it('닫기 저장이 실패했으면 다시 편집할 때 "Couldn\'t save"', async () => {
    await enterEdit(View, query);
    await change('<p>a</p>');
    axios.patch.mockRejectedValueOnce(new Error('500'));
    await clickClose();                               // 닫기 저장 실패 — 확인 안 된 입력이 없으니 그대로 닫힌다
    expect(statusText(sel)).toBeNull();
    await click(btn('Edit'));
    expect(statusText(sel)).toContain("Couldn't save");
  });

  it('저장이 실패한 뒤 수정 없이 편집을 열었다 닫으면 저장 요청이 없고 "Couldn\'t save"가 그대로다 — 실제 저장이 성공해야 "Saved"', async () => {
    await enterEdit(View, query);
    await change('<p>a</p>');
    axios.patch.mockRejectedValueOnce(new Error('500'));
    await clickClose();                               // 닫기 저장 실패
    await click(btn('Edit'));
    expect(statusText(sel)).toContain("Couldn't save");
    const patches = axios.patch.mock.calls.length;
    await clickClose();                               // 수정 없이 닫기 — 저장 시도 없음
    expect(axios.patch.mock.calls.length).toBe(patches);
    await click(btn('Edit'));
    expect(statusText(sel)).toContain("Couldn't save");
    expect(axios.patch.mock.calls.length).toBe(patches);
    await change('<p>ab</p>');                        // 이번엔 고치고 닫는다 — 닫기 저장 성공
    await clickClose();
    expect(axios.patch.mock.calls.length).toBe(patches + 1);
    await click(btn('Edit'));
    expect(statusText(sel)).toContain('Saved');
  });

  it('닫기 전에 날아간 저장이 다음 편집 중에 늦게 끝나도 문구를 덮지 않는다', async () => {
    let failLate;
    axios.patch.mockImplementationOnce(() => new Promise((_, reject) => { failLate = () => reject(new Error('500')); }));
    await enterEdit(View, query);
    await change('<p>a</p>');
    await wait5s();                                   // 저장 예약의 PATCH가 진행 중
    await clickClose();                               // 닫기 저장(두 번째 PATCH)은 성공
    await click(btn('Edit'));
    await act(async () => { failLate(); });           // 지난 세션의 PATCH가 이제야 실패
    expect(statusText(sel)).toContain('Saved');
  });

  it('파기 직전 확인에서 취소하면 저장 문구를 건드리지 않는다 — 새 입력의 저장이 끝나기 전에는 "Saved"가 아니다', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    let finishFirst;
    axios.patch.mockImplementationOnce(() => new Promise((r) => { finishFirst = () => r({ data: { status: true } }); }));
    await enterEdit(View, query);
    await change('<p>a</p>');
    await clickClose();
    await act(async () => { collabStore.set({ status: 'disconnected', connection: 'reconnecting', pending: true }); });
    await change('<p>ab</p>');
    await act(async () => { finishFirst(); });
    await act(async () => {});
    expect(confirm).toHaveBeenCalledTimes(1);         // 파기 직전에 물었고 취소했다
    await act(async () => { collabStore.set({ status: 'connected', ...DELIVERED }); });   // 다시 연결·전달 확인
    expect(statusText(sel)).toContain('Saving…');     // 새 입력의 저장 예약이 아직 남아 있다
    await wait5s();
    expect(statusText(sel)).toContain('Saved');
  });
});
