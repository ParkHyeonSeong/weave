// 협업 WS가 닫힐 때의 토큰 갱신·재연결 간격. 서버가 내려갔거나 입장이 거절되면 실패가 곧바로 돌아오는데, 그때도
// y-websocket의 지수 backoff(0.1초 → 최대 2.5초) 수준으로만 다시 시도해야 한다(쉬지 않는 재시도 = 요청 폭주).
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

vi.mock('@/library/_axios', () => ({ refreshAccessToken: vi.fn() }));
import { refreshAccessToken } from '@/library/_axios';
import { attachWsTokenRefresh } from '@/library/wsTokenRefresh';

let created = 0;
class RefusedSocket {          // 서버 다운·입장 거절: 곧바로 error → close
  constructor() {
    created++; this.readyState = 0; this.OPEN = 1;
    setTimeout(() => { this.readyState = 3; this.onerror?.({}); this.onclose?.({ code: 1006 }); }, 1);
  }
  send() {} close() {}
}
class ExpiringSocket {         // 첫 소켓만 열린 뒤 서버가 4002(토큰 만료 선제 종료)로 닫는다
  constructor() {
    created++; const first = created === 1; this.readyState = 0; this.OPEN = 1;
    setTimeout(() => {
      this.readyState = 1; this.onopen?.();
      if (first) setTimeout(() => { this.readyState = 3; this.onclose?.({ code: 4002 }); }, 50);
    }, 1);
  }
  send() {} close() {}
}
class TwiceExpiringSocket {    // 처음 두 소켓이 열린 뒤 4002로 닫힌다(토큰 만료가 되풀이되는 긴 세션)
  constructor() {
    created++; const n = created; this.readyState = 0; this.OPEN = 1;
    setTimeout(() => {
      this.readyState = 1; this.onopen?.();
      if (n <= 2) setTimeout(() => { this.readyState = 3; this.onclose?.({ code: 4002 }); }, 50);
    }, 1);
  }
  send() {} close() {}
}

let cleanup = null;
afterEach(() => { cleanup?.(); cleanup = null; created = 0; vi.useRealTimers(); refreshAccessToken.mockReset(); });

function start(Socket) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider('ws://test', 'room', doc, { WebSocketPolyfill: Socket, disableBc: true, connect: false });
  const detach = attachWsTokenRefresh(provider);
  provider.connect();
  cleanup = () => { detach(); provider.destroy(); doc.destroy(); };
  return provider;
}

describe('attachWsTokenRefresh 재연결 간격', () => {
  it.each([
    ['서버가 내려가 갱신도 실패', () => Promise.reject(new Error('Network Error'))],
    ['서버는 살아 있고 입장만 거절(갱신은 성공 또는 쿨다운)', () => Promise.resolve()],
  ])('%s: 3초 동안 연결 시도가 y-websocket backoff 수준(≤ 6회)', async (_label, refresh) => {
    vi.useFakeTimers();
    refreshAccessToken.mockImplementation(refresh);
    start(RefusedSocket);
    await vi.advanceTimersByTimeAsync(3000);
    expect(created).toBeLessThanOrEqual(6);
    expect(refreshAccessToken.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('토큰 만료 선제 종료(4002) 뒤에는 갱신을 한 번 하고 다시 연결한다', async () => {
    vi.useFakeTimers();
    refreshAccessToken.mockResolvedValue(undefined);
    const provider = start(ExpiringSocket);
    await vi.advanceTimersByTimeAsync(300);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(created).toBe(2);
    expect(provider.wsconnected).toBe(true);
  });

  it('선제 종료가 되풀이돼도 매번 갱신하고 다시 연결한다', async () => {
    vi.useFakeTimers();
    refreshAccessToken.mockResolvedValue(undefined);
    const provider = start(TwiceExpiringSocket);
    await vi.advanceTimersByTimeAsync(600);
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
    expect(created).toBe(3);
    expect(provider.wsconnected).toBe(true);
  });

  it('detach 뒤에는 예약된 재연결을 하지 않는다', async () => {
    vi.useFakeTimers();
    refreshAccessToken.mockRejectedValue(new Error('Network Error'));
    start(RefusedSocket);
    await vi.advanceTimersByTimeAsync(5);
    cleanup(); cleanup = null;
    const before = created;
    await vi.advanceTimersByTimeAsync(3000);
    expect(created).toBe(before);
  });
});
