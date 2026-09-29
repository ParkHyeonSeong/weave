import * as Y from 'yjs';

// y-websocket(y-protocols) sync 메시지: [0=sync, 0=step1 | 1=step2 | 2=update, varuint(본문 길이), 본문]
const MSG_SYNC = 0;
const SYNC_STEP1 = 0;
const WS_OPEN = 1;

/** 이 문서의 sync step 1(상태 벡터) 메시지 — 서버는 이 메시지에 step 2 → step 1 순서로 답한다. */
export function encodeSyncStep1(doc) {
  const sv = Y.encodeStateVector(doc);
  const head = [MSG_SYNC, SYNC_STEP1];
  let n = sv.length;
  while (n > 0x7f) { head.push((n & 0x7f) | 0x80); n >>>= 7; }
  head.push(n);
  const msg = new Uint8Array(head.length + sv.length);
  msg.set(head);
  msg.set(sv, head.length);
  return msg;
}

function isServerStep1(data) {
  if (!data || typeof data.byteLength !== 'number' || data.byteLength < 2) return false;   // binaryType 'arraybuffer'
  const head = new Uint8Array(data, 0, 2);
  return head[0] === MSG_SYNC && head[1] === SYNC_STEP1;
}

/** 안내 문구 키. 연결돼 있고 서버 적용이 확인되지 않은 편집이 없으면 null(안내 없음). pending은 "보내지 못함"이 아니라
 * "서버 적용을 아직 확인하지 못함"이다(보냈지만 답을 못 받은 경우도 포함) — 문구도 미전송으로 단정하지 않는다. */
export function collabStatusKey(connection, pending) {
  if (pending) return connection === 'connected' ? 'collab.status.confirming' : 'collab.status.unconfirmed';
  if (connection === 'connecting') return 'collab.status.connecting';
  if (connection === 'reconnecting') return 'collab.status.reconnecting';
  return null;
}

/**
 * y-websocket provider의 연결 상태와 "서버 적용이 확인되지 않은 로컬 편집"(pending)을 onChange({ connection, pending })로
 * 알리고, pending인 동안 탭 닫기·새로고침(beforeunload)을 막는다. 리스너는 추적기마다 따로 가진다 — 한 화면에 추적기가
 * 둘일 수 있고(스크럼 주간 보드 + 회고), 같은 함수를 공유하면 브라우저가 한 번만 등록해 한쪽의 정리·확인 완료가 다른
 * 쪽의 경고까지 지운다. 무엇으로 판단하는가:
 * - connection은 provider 'status'다. 'connected'는 소켓이 열렸다는 뜻뿐이다. 한 번 연결된 뒤 끊기면 'reconnecting'.
 * - 'sync'(true)는 쓰지 않는다. 서버 문서를 받았다는 뜻일 뿐이다. 서버(backend ws_collab_manager._handle_sync)는
 *   step 1에 step 2 → step 1 순서로 답하므로, 'sync'가 켜진 순간 끊긴 동안의 편집은 아직 전송 전이다.
 * - 끊긴 동안(처음 연결 전 포함)과 이 소켓에서 서버 step 1을 받기 전의 편집이 pending이다. y-websocket은 서버 step 1에
 *   답하는 step 2로 그 편집을 한꺼번에 보낸다. 그 직후 확인용 step 1을 보내 그 답(서버 step 1)을 받으면, 서버가 연결마다
 *   메시지를 순서대로 처리하므로 앞서 보낸 편집이 서버 문서에 적용됐다 → pending 해제.
 * - 서버 step 1을 받은 연결에서 소켓이 열려 있는(OPEN) 동안의 편집은 y-websocket이 곧바로 보내므로 pending으로 치지
 *   않는다(지금과 같은 보장이다. 소켓은 열려 보이는데 네트워크가 조용히 끊긴 경우는 y-websocket이 30초 무수신으로 끊을
 *   때까지 알 수 없다). 소켓이 닫히는 중(CLOSING)이면 y-websocket이 편집을 보내지 않고 버리므로 pending이다.
 * - DB 저장은 알 수 없다(서버가 30초 debounce·마지막 퇴장·종료 때 저장한다). 이 상태를 "저장됨"으로 쓰지 않는다.
 * @returns {() => void} detach — provider.destroy() 전에 부른다
 */
export function attachCollabDelivery(provider, doc, onChange) {
  let everConnected = provider.wsconnected;
  let connection = provider.wsconnected ? 'connected' : 'connecting';
  let pending = false;
  let socket = null;
  let steady = false;    // 이 소켓에서 서버 step 1을 받았다 — 밀린 편집은 y-websocket이 이미 보냈다
  let probing = false;   // 확인용 step 1을 보냈고 그 답(서버 step 1)을 기다린다
  let detached = false;
  let emitted = null;
  // 이 추적기만의 리스너(공유하지 않는다 — 위 설명)
  const blockUnload = (event) => {
    event.preventDefault();
    event.returnValue = true;   // Chrome·Edge 119 이전은 returnValue가 있어야 확인 창을 띄운다
  };

  const emit = () => {
    if (detached || (emitted && emitted.connection === connection && emitted.pending === pending)) return;
    emitted = { connection, pending };
    onChange(emitted);
  };
  const setPending = (next) => {
    if (pending === next) return;
    pending = next;
    if (pending) window.addEventListener('beforeunload', blockUnload);
    else window.removeEventListener('beforeunload', blockUnload);
    emit();
  };

  // 브라우저는 먼저 설정된 onmessage(y-websocket)를 뒤에 붙인 이 리스너보다 먼저 부른다 — 서버 step 1이면
  // y-websocket이 step 2 답(밀린 편집)을 이미 보낸 뒤다.
  const onMessage = (event) => {
    if (event.target !== socket || !isServerStep1(event.data)) return;
    if (probing) { probing = false; setPending(false); return; }
    if (steady) return;
    steady = true;
    if (pending && socket.readyState === WS_OPEN) {
      probing = true;
      socket.send(encodeSyncStep1(doc));
    }
  };
  const watch = (ws) => {
    if (!ws || ws === socket) return;
    socket?.removeEventListener('message', onMessage);
    socket = ws;
    steady = false;
    probing = false;
    ws.addEventListener('message', onMessage);
  };
  const onStatus = ({ status }) => {
    if (status === 'connected') { everConnected = true; connection = 'connected'; }
    else connection = everConnected ? 'reconnecting' : 'connecting';
    if (status === 'connecting') watch(provider.ws);   // setupWS는 새 소켓을 만든 직후 'connecting'을 알린다
    emit();
  };
  const onClose = () => { steady = false; probing = false; };   // 답을 못 받은 확인 요청은 무효 — pending은 그대로
  const onUpdate = (_update, origin) => {
    if (origin === provider) return;   // 서버(또는 같은 브라우저의 다른 탭)에서 온 갱신
    // 서버 close 프레임을 받은 뒤 close 이벤트 전(CLOSING)에는 steady여도 y-websocket이 보내지 않는다(OPEN일 때만 보낸다)
    if (!steady || socket?.readyState !== WS_OPEN) setPending(true);
  };

  watch(provider.ws);   // 훅은 connect: true로 만들어 생성자가 이미 소켓을 열기 시작했다(첫 'connecting'은 지나갔다)
  provider.on('status', onStatus);
  provider.on('connection-close', onClose);
  doc.on('update', onUpdate);
  emit();

  return () => {
    detached = true;
    provider.off('status', onStatus);
    provider.off('connection-close', onClose);
    doc.off('update', onUpdate);
    socket?.removeEventListener('message', onMessage);
    window.removeEventListener('beforeunload', blockUnload);
  };
}
