import { axios } from '@/library/_axios';
import { requestNotificationPermission } from '@/library/notification';

/**
 * Base64 URL 문자열을 Uint8Array로 변환
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}

/**
 * ArrayBuffer를 Base64 문자열로 변환
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 이 페이지에서 서버 등록(POST /push/subscribe)까지 끝난 구독의 endpoint. 브라우저 구독만 있고 서버 등록이 실패한
// 기기는 연결됨이 아니다(getPushState가 다시 연결을 안내한다). 메모리에만 둔다 — 새로고침하면 비지만 로드 때
// Layout이 다시 등록하고, getPushState는 진행 중인 등록(registering)이 끝난 뒤에 판단한다.
let registeredEndpoint = null;
let registering = null;
// 로그아웃(unsubscribeFromPush)이 시작될 때마다 올린다. 그 전에 시작된 등록은 이후 단계를 하지 않고, 그사이 만들거나
// 찾은 브라우저 구독을 지운다 — 로그아웃이 구독을 확인한 뒤에 생긴 구독이 이전 계정으로 서버에 등록되거나 남지 않게.
let generation = 0;

// 로그아웃이 시작된 뒤에 이어진 등록을 끝낸다: 그 구독을 이 기기에서 지우고 실패로 돌려준다
function dropStale(subscription) {
  subscription?.unsubscribe().catch((e) => console.warn('Push unsubscribe failed:', e));
  return false;
}

async function register(gen) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  const stale = () => gen !== generation;

  try {
    const registration = await navigator.serviceWorker.ready;

    // VAPID 공개키 가져오기
    const res = await axios.get('/push/vapid-key');
    if (!res.data.status || !res.data.vapid_key) return false;

    const applicationServerKey = urlBase64ToUint8Array(res.data.vapid_key);

    // 기존 구독 확인 또는 새로 구독
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription && !stale()) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }
    if (stale()) return dropStale(subscription);

    // 서버에 구독 정보 전송
    const p256dh = arrayBufferToBase64(subscription.getKey('p256dh'));
    const auth = arrayBufferToBase64(subscription.getKey('auth'));

    const saved = await axios.post('/push/subscribe', {
      endpoint: subscription.endpoint,
      p256dh,
      auth,
    });
    if (stale()) return dropStale(subscription);
    registeredEndpoint = saved.data?.status ? subscription.endpoint : null;
    return !!saved.data?.status;
  } catch (e) {
    // Push 구독 실패 시 서비스 중단 없이 무시
    console.warn('Push subscription failed:', e);
    return false;
  }
}

/**
 * Push 알림 구독 등록
 * - VAPID 공개키를 서버에서 가져오고
 * - PushManager로 구독 생성 후
 * - 서버에 구독 정보 전송
 * 권한은 묻지 않는다 — granted가 아니면 곧바로 끝난다(권한 요청은 enablePush가 클릭 안에서 한다).
 * 시작한 뒤 로그아웃이 시작되면 서버에 등록하지 않고, 그사이 만든 브라우저 구독을 지운다.
 * @returns {Promise<boolean>} 서버 등록까지 끝났으면 true
 */
export function subscribeToPush() {
  const run = register(generation);
  const settled = () => { if (registering === run) registering = null; };
  registering = run;
  run.then(settled, settled);
  return run;
}

/**
 * "이 기기에서 알림 켜기" 버튼: 권한 요청 → 구독.
 * ⚠️ 클릭 핸들러에서 앞에 await 없이 바로 부른다. Safari·iOS 홈 화면 앱·Firefox는 사용자 동작 안에서
 *    시작된 권한 요청만 받아 주는데, requestPermission은 이 함수의 첫 await보다 앞에서 동기로 불린다.
 * @returns {Promise<boolean>} 서버 등록까지 끝났으면 true
 */
export async function enablePush() {
  await requestNotificationPermission();   // 'default'일 때만 창을 띄운다
  return subscribeToPush();
}

/**
 * 이 기기의 푸시 상태(종 드롭다운 안내용).
 * - 'unsupported': Web Push를 못 쓰는 브라우저이거나 서비스워커 등록이 없다 → 안내하지 않는다
 *   (등록이 없으면 subscribeToPush가 serviceWorker.ready에서 끝나지 않아 켜기 버튼이 굳는다)
 * - 'default' | 'denied': 알림 권한 그대로
 * - 'subscribed' | 'unsubscribed': 권한은 허용 — 이 브라우저 구독이 이 페이지에서 서버 등록까지 끝났는지.
 *   브라우저 구독만 있고 서버 등록이 실패했으면 'unsubscribed'다(다시 연결 버튼이 남는다).
 */
export async function getPushState() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return 'unsupported';
    if (Notification.permission !== 'granted') return Notification.permission;
    await registering;   // 진행 중인 등록(로드 때 자동 등록 등)의 결과로 판단한다
    const subscription = await registration.pushManager.getSubscription();
    return subscription && subscription.endpoint === registeredEndpoint ? 'subscribed' : 'unsubscribed';
  } catch {
    return 'unsupported';
  }
}

/**
 * 이 기기의 Push 구독 해제 (로그아웃 시 호출).
 * - 서버 행 삭제(DELETE /push/unsubscribe)는 로그인이 필요하다 → 호출부는 이 함수를 기다린 뒤에
 *   /auth/logout을 보낸다. 인증이 이미 끊긴 auth-expired 경로는 { server: false }로 브라우저 쪽만 끊는다
 *   (남은 서버 행은 다음 발송 때 푸시 서비스가 404/410을 돌려주면 notification_service가 지운다).
 * - 브라우저 구독 해제가 "이 기기로 더 오지 않게" 하는 실제 보장이라 서버 삭제 성공 여부와 무관하게 먼저
 *   시작한다. 끝나기를 기다리지는 않는다 — 브라우저(Firefox 등)가 푸시 서버 응답을 수 초 기다릴 수 있어,
 *   기다리면 로그아웃이 그만큼 늦어진다.
 * - navigator.serviceWorker.ready는 쓰지 않는다: 활성 서비스워커가 없으면 영원히 끝나지 않아 로그아웃이 멈춘다.
 * - 시작하자마자(첫 await 전) 진행 중인 등록을 무효로 한다 — 아래 확인 뒤에 생기는 구독은 그 등록이 스스로 지운다.
 */
export async function unsubscribeFromPush({ server = true } = {}) {
  generation += 1;
  registeredEndpoint = null;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  let subscription = null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    subscription = registration ? await registration.pushManager.getSubscription() : null;
  } catch (e) {
    console.warn('Push unsubscribe failed:', e);
    return;
  }
  if (!subscription) return;

  subscription.unsubscribe().catch((e) => console.warn('Push unsubscribe failed:', e));
  if (!server) return;
  try {
    await axios.delete('/push/unsubscribe', {
      data: { endpoint: subscription.endpoint },
      timeout: 5000,   // 로그아웃이 이 정리 요청 때문에 멈추지 않게 상한을 둔다
    });
  } catch (e) {
    console.warn('Push unsubscribe failed:', e);
  }
}
