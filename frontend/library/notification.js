/**
 * 알림 사운드 재생 (Web Audio API)
 */
let audioCtx = null;

export function playNotificationSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1046, audioCtx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.25);
  } catch (e) {
    // AudioContext not supported or user hasn't interacted yet
  }
}

/**
 * 브라우저 알림 요청 및 발송
 */
export async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

/**
 * 브라우저 알림 표시. **문구는 호출부가 현재 언어로 만들어 넘긴다** —
 * 이 모듈은 React 밖이라 t를 쓸 수 없고, 여기에 영어 폴백을 두면 한국어 사용자가
 * 영어 알림을 받는다(chatMessagePreview가 폴백을 담당한다).
 */
export function showNotification(senderName, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    // 탭이 포커스되어 있으면 알림 안 보냄
    if (document.hasFocus()) return;

    const notification = new Notification('Weave', {
      body: `${senderName}: ${body || ''}`,
      icon: '/icons/weave_square.svg',
      tag: `weave-chat-${Date.now()}`,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}

/**
 * 채팅 알림 한 줄의 본문. 사용자가 입력한 내용이 있으면 **그대로** 쓰고(번역·변형 금지),
 * 없을 때만 무엇이 왔는지 알려주는 현재 언어 폴백을 쓴다.
 *
 * ws_chat은 텍스트 없이 ref·첨부만 있는 메시지도 정상으로 받으므로, 폴백이 없으면
 * 본문이 빈 알림("Ann: ")이 뜬다. 서버의 오프라인 Web Push도 같은 구분을 쓴다
 * (backend/library/notification_service.chat_fallback_key).
 */
export function chatMessagePreview(message, t) {
  const content = message?.content;
  if (content) return content;
  if (message?.task_ref) return t('layout.chatNotification.sharedTask');
  if (message?.doc_ref) return t('layout.chatNotification.sharedDocument');
  if (message?.issue_ref) return t('layout.chatNotification.sharedIssue');
  if (message?.attachments?.length) return t('layout.chatNotification.sharedAttachment');
  return t('layout.chatNotification.newMessage');
}
