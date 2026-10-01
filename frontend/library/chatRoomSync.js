/**
 * 채팅방을 사용자가 실제로 보고 있는지. 방이 그려진 문서가 보이는 탭이고 그 창에 포커스가 있을 때만 참이다.
 * 메신저를 PiP 창에 띄웠다면 메인 문서가 아니라 PiP 창의 문서를 넘긴다(포커스는 창마다 따로다).
 *
 * 거짓이면 열어 둔 방이라도 새 메시지를 읽음 처리하지 않고(MessengerChatRoom),
 * 다른 방처럼 토스트·소리·OS 알림·배지를 띄운다(Layout). 두 곳이 같은 판단을 써야 배지가 어긋나지 않는다.
 */
export function isChatViewing(doc) {
  if (!doc) return false;
  return doc.visibilityState === 'visible' && doc.hasFocus();
}

/**
 * 재연결 뒤 다시 받은 최신 페이지(오래된 것 → 최신)를 지금 목록에 합친다.
 * - 놓친 메시지가 없으면 지금 목록을 그대로 돌려준다(다시 그리지 않아 스크롤도 그대로다).
 * - 재연결 직후 WebSocket으로 먼저 붙은 메시지가 있을 수 있어 message_id 순으로 다시 세운다.
 * - 받은 페이지가 지금 목록과 한 건도 겹치지 않으면 그 사이가 비었을 수 있다 → 방을 새로 연 것처럼 받은 페이지로 바꾼다.
 */
export function mergeMissedMessages(prev, fetched) {
  const known = new Set(prev.map((m) => m.message_id));
  const missed = fetched.filter((m) => !known.has(m.message_id));
  if (missed.length === 0) return prev;
  if (missed.length === fetched.length) return fetched;
  return [...prev, ...missed].sort((a, b) => a.message_id - b.message_id);
}
