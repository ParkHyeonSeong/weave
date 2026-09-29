// @vitest-environment jsdom
// 협업 문서의 연결·전달 상태 추적(collabDelivery)을 실제 y-websocket 3.0.0과, 서버(backend ws_collab_manager
// ._handle_sync)와 같은 순서로 답하는 가짜 소켓으로 확인한다. 핵심 사실: 'sync'(true)는 서버 문서를 받았다는 뜻일
// 뿐이다. 끊긴 동안의 편집은 그 뒤 서버 step 1에 대한 답으로 전송되고, 확인용 step 1의 답을 받아야 서버 적용이 확인된다.
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { attachCollabDelivery, collabStatusKey, encodeSyncStep1 } from '@/library/collabDelivery';

function readVarUint(b, o) {
  let r = 0; let s = 0;
  for (;;) { const x = b[o++]; r |= (x & 0x7f) << s; if (x < 0x80) return [r, o]; s += 7; }
}
function frame(type, payload) {             // [0=sync, type, varuint(길이), 본문]
  const head = [0, type]; let n = payload.length;
  while (n > 0x7f) { head.push((n & 0x7f) | 0x80); n >>>= 7; }
  head.push(n);
  const out = new Uint8Array(head.length + payload.length); out.set(head); out.set(payload, head.length);
  return out;
}
const syncBody = (b) => { const [len, off] = readVarUint(b, 2); return b.subarray(off, off + len); };

let sockets = [];
// 브라우저 WebSocket처럼 onmessage(y-websocket이 설정) 뒤에 addEventListener 리스너가 돈다.
class FakeSocket extends EventTarget {
  constructor() { super(); this.readyState = 0; this.OPEN = 1; this.sent = []; sockets.push(this); }
  send(data) { this.sent.push(new Uint8Array(data)); }
  close() {}
  fire(type, props = {}) { const ev = Object.assign(new Event(type), props); this[`on${type}`]?.(ev); this.dispatchEvent(ev); }
  open() { this.readyState = 1; this.fire('open'); }
  receive(bytes) { this.fire('message', { data: bytes.slice().buffer }); }
  drop() { this.readyState = 3; this.fire('close', { code: 1006 }); }
  takeSync() { const out = this.sent.filter((b) => b[0] === 0); this.sent = []; return out; }   // awareness(1)는 버린다
}
// 서버가 그 소켓에서 받은 메시지를 순서대로 처리: step 1 → step 2 다음 step 1로 답, step 2·update → 적용
function serverProcess(serverDoc, sock) {
  for (const b of sock.takeSync()) {
    if (b[1] === 0) {
      sock.receive(frame(1, Y.encodeStateAsUpdate(serverDoc, syncBody(b))));
      sock.receive(frame(0, Y.encodeStateVector(serverDoc)));
    } else Y.applyUpdate(serverDoc, syncBody(b));
  }
}
const unloadBlocked = () => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; };

let cleanups = [];
afterEach(() => { cleanups.forEach((f) => f()); cleanups = []; sockets = []; vi.useRealTimers(); });

function setup({ connect = false } = {}) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider('ws://test', 'room', doc, { WebSocketPolyfill: FakeSocket, disableBc: true, connect });
  const states = [];
  const detach = attachCollabDelivery(provider, doc, (s) => states.push(s));
  cleanups.push(() => { detach(); provider.destroy(); doc.destroy(); });
  return { doc, provider, detach, states, last: () => states[states.length - 1], sock: () => sockets[sockets.length - 1] };
}

describe('y-websocket·서버 순서(추적기의 전제)', () => {
  it("재연결 뒤 'sync'(true)가 켜지는 순간 끊긴 동안의 편집은 아직 서버에 없다", () => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider('ws://test', 'room', doc, { WebSocketPolyfill: FakeSocket, disableBc: true, connect: false });
    cleanups.push(() => { provider.destroy(); doc.destroy(); });
    const server = new Y.Doc(); server.getText('t').insert(0, 'server;');
    doc.getText('t').insert(0, 'OFFLINE;');
    let serverAtSync = null;
    provider.on('sync', (v) => { if (v) serverAtSync = server.getText('t').toString(); });
    provider.connect(); sockets[sockets.length - 1].open();
    serverProcess(server, sockets[sockets.length - 1]);      // step 1 → (step 2 → sync) → step 1 → y-websocket이 step 2로 답
    expect(serverAtSync).toBe('server;');
    serverProcess(server, sockets[sockets.length - 1]);      // 그 step 2를 서버가 적용
    expect(server.getText('t').toString()).toContain('OFFLINE;');
  });
});

describe('attachCollabDelivery', () => {
  it('끊긴 동안(연결 전)의 편집은 pending이고 탭 닫기·새로고침을 막는다', () => {
    const t = setup();
    expect(t.last()).toEqual({ connection: 'connecting', pending: false });
    expect(unloadBlocked()).toBe(false);
    t.doc.getText('t').insert(0, 'OFFLINE;');
    expect(t.last()).toEqual({ connection: 'connecting', pending: true });
    expect(unloadBlocked()).toBe(true);
  });

  it('연결돼 있다가 끊긴 직후(새 소켓을 만들기 전)의 편집도 pending이다', () => {
    const t = setup();
    const server = new Y.Doc();
    t.provider.connect(); const s = t.sock(); s.open();
    serverProcess(server, s);                           // 서버 step 1까지 받은 연결
    s.drop();                                           // 끊김 — y-websocket은 0.1초 뒤에 새 소켓을 만든다
    t.doc.getText('t').insert(0, 'after-drop');
    expect(t.last()).toEqual({ connection: 'reconnecting', pending: true });
    expect(unloadBlocked()).toBe(true);
  });

  it('재연결 뒤 sync가 켜져도, 밀린 편집을 보낸 뒤에도 pending — 확인용 step 1의 답을 받아야 풀린다', () => {
    const t = setup();
    const server = new Y.Doc(); server.getText('t').insert(0, 'server;');
    t.doc.getText('t').insert(0, 'OFFLINE;');
    t.provider.connect();
    const s = t.sock(); s.open();
    expect(t.last()).toEqual({ connection: 'connected', pending: true });

    const [clientStep1] = s.takeSync();
    s.receive(frame(1, Y.encodeStateAsUpdate(server, syncBody(clientStep1))));   // 서버 step 2 → sync(true)
    expect(t.provider.synced).toBe(true);
    expect(t.last().pending).toBe(true);

    s.receive(frame(0, Y.encodeStateVector(server)));   // 서버 step 1 → y-websocket의 step 2 답, 이어서 확인 요청
    const [reply, probe] = s.takeSync();
    expect([reply[1], probe[1]]).toEqual([1, 0]);
    expect(Array.from(syncBody(probe))).toEqual(Array.from(Y.encodeStateVector(t.doc)));
    expect(t.last().pending).toBe(true);                // 보냈지만 서버 적용은 아직 모른다
    expect(unloadBlocked()).toBe(true);

    Y.applyUpdate(server, syncBody(reply));             // 서버는 연결마다 순서대로: 편집 적용 → 확인 요청에 답
    s.receive(frame(1, Y.encodeStateAsUpdate(server, syncBody(probe))));
    s.receive(frame(0, Y.encodeStateVector(server)));
    expect(t.last()).toEqual({ connection: 'connected', pending: false });
    expect(unloadBlocked()).toBe(false);
    expect(server.getText('t').toString()).toContain('OFFLINE;');
  });

  it('서버 step 1까지 받은 연결에서의 편집은 즉시 전송되고 pending·확인 요청이 없다', () => {
    const t = setup();
    const server = new Y.Doc();
    t.provider.connect(); const s = t.sock(); s.open();
    serverProcess(server, s);
    s.takeSync();                                       // y-websocket의 step 2 답(보낼 편집 없음)
    t.doc.getText('t').insert(0, 'live');
    expect(s.takeSync().map((b) => b[1])).toEqual([2]); // update 한 건뿐
    expect(t.last()).toEqual({ connection: 'connected', pending: false });
    expect(unloadBlocked()).toBe(false);
  });

  it('확인 요청의 답을 받기 전에 끊기면 pending이 남고, 다시 연결해 확인해야 풀린다', async () => {
    vi.useFakeTimers();
    const t = setup();
    const server = new Y.Doc();
    t.doc.getText('t').insert(0, 'OFFLINE;');
    t.provider.connect(); let s = t.sock(); s.open();
    const [clientStep1] = s.takeSync();
    s.receive(frame(1, Y.encodeStateAsUpdate(server, syncBody(clientStep1))));
    s.receive(frame(0, Y.encodeStateVector(server)));   // 밀린 편집 + 확인 요청을 보냈다
    s.drop();                                           // 서버가 처리하기 전에 끊김(1009·네트워크 단절 등)
    expect(t.last()).toEqual({ connection: 'reconnecting', pending: true });
    expect(unloadBlocked()).toBe(true);

    await vi.advanceTimersByTimeAsync(200);             // y-websocket backoff(0.1초) 뒤 새 소켓
    s = t.sock(); s.open();
    serverProcess(server, s);                           // step 1 → 답 → 밀린 편집 + 확인 요청
    serverProcess(server, s);                           // 편집 적용 → 확인 요청에 답
    expect(t.last()).toEqual({ connection: 'connected', pending: false });
    expect(server.getText('t').toString()).toBe('OFFLINE;');
  });

  it('서버 step 1까지 받은 연결이어도 소켓이 닫히는 중(CLOSING, close 이벤트 전)의 편집은 pending — close 뒤·재연결 전에도 탭 닫기를 막고, 재연결해 확인받으면 풀린다', async () => {
    vi.useFakeTimers();
    const t = setup();
    const server = new Y.Doc();
    t.provider.connect(); let s = t.sock(); s.open();
    serverProcess(server, s);                           // 정상 연결·동기화(서버 step 1까지)
    s.takeSync();                                       // y-websocket의 step 2 답(보낼 편집 없음)
    s.readyState = 2;                                   // 서버 close 프레임을 받았다 — close 이벤트는 아직이다
    t.doc.getText('t').insert(0, 'closing;');
    expect(s.takeSync()).toEqual([]);                   // y-websocket은 OPEN이 아니면 보내지 않고 버린다
    expect(t.last()).toEqual({ connection: 'connected', pending: true });
    expect(unloadBlocked()).toBe(true);

    s.drop();                                           // close 이벤트
    expect(t.last()).toEqual({ connection: 'reconnecting', pending: true });
    expect(unloadBlocked()).toBe(true);                 // 재연결 전에 탭을 닫으려 해도 막는다

    await vi.advanceTimersByTimeAsync(200);             // y-websocket backoff(0.1초) 뒤 새 소켓
    s = t.sock(); s.open();
    serverProcess(server, s);                           // step 1 → 답 → 버려졌던 편집 + 확인 요청
    serverProcess(server, s);                           // 편집 적용 → 확인 요청에 답
    expect(t.last()).toEqual({ connection: 'connected', pending: false });
    expect(unloadBlocked()).toBe(false);
    expect(server.getText('t').toString()).toBe('closing;');
  });

  it('닫히는 중(CLOSING)에 온 서버·다른 탭 갱신(origin=provider)도 pending을 만들지 않는다', () => {
    const t = setup();
    const server = new Y.Doc();
    t.provider.connect(); const s = t.sock(); s.open();
    serverProcess(server, s);
    s.readyState = 2;
    const other = new Y.Doc(); other.getText('t').insert(0, 'remote');
    Y.applyUpdate(t.doc, Y.encodeStateAsUpdate(other), t.provider);
    expect(t.last()).toEqual({ connection: 'connected', pending: false });
    expect(unloadBlocked()).toBe(false);
  });

  it('서버·다른 탭에서 온 갱신(origin=provider)은 pending을 만들지 않는다', () => {
    const t = setup();
    const other = new Y.Doc(); other.getText('t').insert(0, 'remote');
    Y.applyUpdate(t.doc, Y.encodeStateAsUpdate(other), t.provider);
    expect(t.last().pending).toBe(false);
  });

  it('처음은 connecting, 한 번 연결된 뒤 끊기면 reconnecting', () => {
    const t = setup();
    t.provider.connect(); t.sock().open();
    expect(t.last().connection).toBe('connected');
    t.sock().drop();
    expect(t.last().connection).toBe('reconnecting');
  });

  it('생성자가 이미 연결을 시작한 provider(훅의 connect: true)에 붙여도 그 소켓을 추적한다', () => {
    const t = setup({ connect: true });
    t.doc.getText('t').insert(0, 'x');
    expect(t.last().pending).toBe(true);
    const server = new Y.Doc(); const s = t.sock(); s.open();
    serverProcess(server, s);
    serverProcess(server, s);
    expect(t.last()).toEqual({ connection: 'connected', pending: false });
  });

  it('추적기가 둘일 때(주간 보드 + 회고) 깨끗한 쪽을 정리해도 다른 쪽의 탭 닫기 경고는 남는다', () => {
    const week = setup(); const retro = setup();
    week.doc.getText('t').insert(0, 'WEEK-OFFLINE');     // 주간 보드에만 확인 안 된 입력
    expect(unloadBlocked()).toBe(true);
    retro.detach();                                       // 회고 탭을 떠나 회고 추적기를 정리
    expect(unloadBlocked()).toBe(true);
    week.detach();
    expect(unloadBlocked()).toBe(false);
  });

  it('추적기가 둘일 때 한쪽의 확인 완료가 다른 쪽의 탭 닫기 경고를 지우지 않는다', () => {
    const week = setup(); const retro = setup();
    week.doc.getText('t').insert(0, 'WEEK-OFFLINE');
    retro.doc.getText('t').insert(0, 'RETRO-OFFLINE');
    const server = new Y.Doc();
    retro.provider.connect(); const s = retro.sock(); s.open();
    serverProcess(server, s);                             // 밀린 입력 + 확인 요청
    serverProcess(server, s);                             // 확인 → 회고만 풀린다
    expect(retro.last().pending).toBe(false);
    expect(week.last().pending).toBe(true);
    expect(unloadBlocked()).toBe(true);                   // 주간 보드 경고는 남아야 한다
  });

  it('detach하면 탭 닫기 차단을 거두고 더 알리지 않는다', () => {
    const t = setup();
    t.doc.getText('t').insert(0, 'x');
    expect(unloadBlocked()).toBe(true);
    t.detach();
    const n = t.states.length;
    t.doc.getText('t').insert(0, 'y');
    expect(unloadBlocked()).toBe(false);
    expect(t.states.length).toBe(n);
  });
});

describe('collabStatusKey — 안내 문구 키', () => {
  it.each([
    ['connected', false, null],
    ['connecting', false, 'collab.status.connecting'],
    ['reconnecting', false, 'collab.status.reconnecting'],
    ['connecting', true, 'collab.status.unconfirmed'],
    ['reconnecting', true, 'collab.status.unconfirmed'],
    ['connected', true, 'collab.status.confirming'],
  ])('%s, pending=%s → %s', (connection, pending, key) => {
    expect(collabStatusKey(connection, pending)).toBe(key);
  });
});

it('encodeSyncStep1은 [sync, step1, 길이, 상태 벡터]다', () => {
  const doc = new Y.Doc(); doc.getText('t').insert(0, 'abc');
  const msg = encodeSyncStep1(doc);
  expect([msg[0], msg[1]]).toEqual([0, 0]);
  expect(Array.from(syncBody(msg))).toEqual(Array.from(Y.encodeStateVector(doc)));
});
