import axios from 'axios';
import { getErrorCode } from '@/library/errorCode';
import { clearClientSession } from '@/library/sessionCleanup';

let isAuthExpiredDispatched = false;

function dispatchAuthExpired() {
  if (isAuthExpiredDispatched) return;
  isAuthExpiredDispatched = true;
  clearClientSession();
  // 세션이 끝난 기기에 이전 계정의 푸시가 계속 뜨지 않게 이 기기 구독도 끊는다. 인증이 이미 없어
  // DELETE /push/unsubscribe는 못 부르므로 브라우저 쪽만 해제한다(server: false).
  // 동적 import: pushSubscription이 이 모듈을 import하므로 정적 import는 순환이 된다.
  import('@/library/pushSubscription')
    .then(({ unsubscribeFromPush }) => unsubscribeFromPush({ server: false }))
    .catch(() => {});
  window.dispatchEvent(new CustomEvent('auth:expired'));
  setTimeout(() => { isAuthExpiredDispatched = false; }, 3000);
}

const handleResponseFulfilled = (response) => {
  if (getErrorCode(response.data) === 'NEED_LOGIN') dispatchAuthExpired();
  return response;
};

// 단기 access 토큰(SEC-29) 만료로 401이 오면 refresh 쿠키로 1회 갱신 후 원요청을 재시도한다.
// 동시 다발 401은 단일 in-flight refresh로 합쳐 refresh 폭주를 막는다.
const REFRESH_LOCK = 'weave-token-refresh';
const REFRESH_TS_KEY = 'weave_last_refresh_at';  // 탭 간 공유(localStorage)
const REFRESH_COOLDOWN_MS = 5000;

let refreshPromise = null;  // 같은 탭 내 동시 호출 병합

function lastRefreshAt() {
  try { return Number(localStorage.getItem(REFRESH_TS_KEY)) || 0; } catch { return 0; }
}
function markRefreshed() {
  try { localStorage.setItem(REFRESH_TS_KEY, String(Date.now())); } catch {}
}

// 실제 refresh 1회 실행(쿨다운 내면 생략). 락 안에서만 호출된다.
async function doRefreshOnce() {
  // 다른 탭이 방금(쿨다운 내) 회전했으면 쿠키가 이미 신선 → 재갱신 생략(회전 토큰 중복 소비 방지).
  if (Date.now() - lastRefreshAt() <= REFRESH_COOLDOWN_MS) return;
  const r = await api.post('/auth/refresh', null, { _skipAuthRetry: true, timeout: 10000 });
  markRefreshed();
  return r;
}

// 브라우저 전역 single-flight: Web Locks로 한 번에 한 탭만 refresh한다.
// 단일사용·회전 refresh 토큰을 여러 탭이 동시 소비해 한쪽이 NEED_LOGIN으로 튕기는 레이스를 차단.
// 같은 탭 내 동시 401은 refreshPromise로, 탭 간은 락+공유 쿨다운으로 합친다.
// timeout 10s: refresh가 멈춰 락을 영구 점유해 다른 탭 인증까지 막는 걸 방지(실패 시 정상 로그아웃).
function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(REFRESH_LOCK, doRefreshOnce);
    }
    return doRefreshOnce();  // Web Locks 미지원 폴백(in-tab 쿨다운만)
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

const handleResponseRejected = async (error) => {
  const original = error.config;
  const status = error.response?.status;
  const url = original?.url || '';
  // refresh/login 자체 실패나 이미 재시도한 요청은 갱신 대상 아님(무한루프 방지)
  const retryable = status === 401 && original && !original._retried
    && !original._skipAuthRetry
    && !url.includes('/auth/refresh') && !url.includes('/auth/login');

  if (retryable) {
    original._retried = true;
    try {
      await refreshAccessToken();
      return api(original);  // 새 access 쿠키로 원요청 재시도
    } catch (_) {
      dispatchAuthExpired();
      return Promise.reject(error);
    }
  }
  if (status === 401) dispatchAuthExpired();
  return Promise.reject(error);
};

// API URL 동적 생성: LAN IP 접근 시에도 같은 호스트로 요청
function getBaseURL() {
  if (typeof window === 'undefined') return process.env.NEXT_PUBLIC_API_URL || '';
  const envUrl = process.env.NEXT_PUBLIC_API_URL || '';
  try {
    const parsed = new URL(envUrl);
    // 프로덕션 (포트 명시 없음): URL 그대로 사용
    if (!parsed.port) return envUrl;
    // 개발 (포트 명시): 브라우저의 현재 hostname 사용 (LAN IP 대응)
    return `${parsed.protocol}//${window.location.hostname}:${parsed.port}`;
  } catch {
    return envUrl;
  }
}

// WebSocket base URL 생성 (HTTP URL -> WS URL 변환)
function getWsBaseURL() {
  const base = getBaseURL();
  if (!base) {
    // 프로덕션: same-origin, 프로토콜만 변환
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${wsProtocol}://${window.location.host}`;
  }
  return base.replace(/^http/, 'ws');
}

const api = axios.create({
  baseURL: `${getBaseURL()}/api`,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

api.interceptors.response.use(handleResponseFulfilled, handleResponseRejected);

// WebSocket 재연결 등 axios 밖에서도 access 토큰을 선제 갱신할 수 있게 노출(쿨다운 공유).
export { api as axios, getBaseURL, getWsBaseURL, refreshAccessToken };
