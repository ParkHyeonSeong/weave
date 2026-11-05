// @vitest-environment jsdom
// useCollabSynced — 협업 문서(y-websocket)가 그 provider로 첫 동기화를 마쳤는지. 스크럼 화면은 이 값이 true일 때만
// 작성 여부 판단(n/N·작성 전·아직 안 쓴 사람)을 그린다. 여기서는 훅이 일부러 지키는 성질을 고정한다:
// provider마다 따로 보고, 한 번 true가 되면 그 provider에서는 재연결(sync false) 뒤에도 true로 남는다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import useCollabSynced from '@/library/useCollabSynced';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// y-websocket provider 흉내 — synced와 'sync' 이벤트만 쓴다(useCollabEditBase 테스트와 같은 모양).
// emitSync(false)는 재연결: 연결이 끊기면 y-websocket이 synced를 false로 되돌리고 sync(false)를 보낸다.
function makeProvider(synced) {
  const handlers = new Set();
  const provider = {
    synced,
    handlers,
    on: (event, fn) => { if (event === 'sync') handlers.add(fn); },
    off: (event, fn) => { if (event === 'sync') handlers.delete(fn); },
    emitSync(value = true) { provider.synced = value; [...handlers].forEach((fn) => fn(value)); },
  };
  return provider;
}

let root;
let synced;
function Probe({ provider }) { synced = useCollabSynced(provider); return null; }
const render = (provider) => act(() => { root.render(<Probe provider={provider} />); });

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  synced = undefined;
});
afterEach(() => { act(() => root.unmount()); });

describe('useCollabSynced', () => {
  it('첫 동기화 전에는 false, sync 뒤에는 true — 재연결로 sync(false)가 와도 true로 남는다', () => {
    const provider = makeProvider(false);
    render(provider);
    expect(synced).toBe(false);

    act(() => { provider.emitSync(); });
    expect(synced).toBe(true);

    // 이미 받은 문서로 센 값은 그대로 의미가 있다 — 연결 상태는 CollabStatusBadge가 알린다
    act(() => { provider.emitSync(false); });
    expect(synced).toBe(true);
    act(() => { provider.emitSync(); });
    expect(synced).toBe(true);
  });

  it('이미 동기화된 provider는 바로 true, 새 provider(다른 주·회고 문서)는 그 provider가 동기화될 때까지 false', () => {
    const first = makeProvider(true);
    render(first);
    expect(synced).toBe(true);

    const second = makeProvider(false);
    render(second);
    expect(synced).toBe(false);          // 앞 provider의 값을 쓰지 않는다
    act(() => { first.emitSync(); });    // 앞 provider의 신호도 듣지 않는다
    expect(synced).toBe(false);

    act(() => { second.emitSync(); });
    expect(synced).toBe(true);
  });

  it('provider가 없으면 false, provider가 바뀌거나 사라지면 앞 provider의 sync 구독을 푼다', () => {
    render(null);
    expect(synced).toBe(false);

    const provider = makeProvider(false);
    render(provider);
    expect(provider.handlers.size).toBe(1);
    render(null);
    expect(synced).toBe(false);
    expect(provider.handlers.size).toBe(0);
  });
});
