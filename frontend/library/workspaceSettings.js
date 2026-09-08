// 워크스페이스 설정(/setup/status)의 단일 공유 소스.
//
// 이전에는 _app.js의 인증 게이트와 Header가 각자 /setup/status를 호출하고, 초기화 여부만
// sessionStorage에 'app_initialized' boolean으로 캐시했다. workspace time_zone이 생기면서
// 그 구조로는 (a) 같은 응답을 두 번 받고 (b) boolean 캐시에는 timezone을 담을 수 없어
// Scrum이 세 번째 호출을 하게 된다. 여기서 응답 전체를 한 번만 받아 나눠 쓴다.
//
// workspace time_zone은 **공용 기간 전용**이다 — Scrum의 오늘·현재 ISO week·회고 기간.
// 개인 timestamp 표시나 개인 연체 계산에는 쓰지 않는다(그건 language_region.time_zone).
//
// ⚠️ 실패는 **fail-closed**다. 조회가 실패하면(네트워크·HTTP 오류) status가 'error'가 되고
//    timeZone은 null이다 — 절대 호환값(Asia/Seoul)으로 대체하지 않는다. 실패를 호환값으로
//    덮으면 서울이 아닌 워크스페이스에서 잘못된 주차 행(scrum_week)이 조용히 생성된다.
//    호환값은 **성공한 응답에 time_zone이 없을 때**(마이그레이션 064 이전 서버)만 쓴다 —
//    그건 "서버가 시간대를 모른다"가 아니라 "그 서버는 KST로 동작했다"는 확정 정보다.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

import { axios } from '@/library/_axios';
import { COMPAT_TIME_ZONE, canonicalTimeZone } from '@/library/localePrefs';

export const WORKSPACE_SETTINGS_KEY = 'workspace_settings';
// 같은 탭 통지. Provider는 appReady 게이트 밖에 상주해 언마운트되지 않으므로,
// 캐시를 지운 쪽(Setup 완료·로그아웃)이 이 이벤트로 재조회를 시켜야 한다 — 아니면
// Setup 직후 세션에서 Header가 워크스페이스 이름을 못 보고 Scrum이 방금 고른
// workspace 시간대 대신 호환값을 쓴다.
export const WORKSPACE_SETTINGS_INVALIDATE_EVENT = 'weave:workspace-settings-invalidate';

// 인플라이트 요청 공유 — 같은 틱에 여러 소비자가 불러도 네트워크는 1회.
let inflight = null;

function readCache() {
  try {
    const raw = sessionStorage.getItem(WORKSPACE_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(settings) {
  try {
    sessionStorage.setItem(WORKSPACE_SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* private 모드 등 — 무시 */ }
}

export function clearWorkspaceSettingsCache() {
  inflight = null;
  try { sessionStorage.removeItem(WORKSPACE_SETTINGS_KEY); } catch {}
  try { window.dispatchEvent(new Event(WORKSPACE_SETTINGS_INVALIDATE_EVENT)); } catch {}
}

/**
 * 캐시된 설정(없으면 null). 동기 경로(인증 게이트 첫 판정)용.
 * 초기화 완료(initialized=true) 응답만 캐시하므로, 미초기화 서버에서는 항상 null이다.
 */
export function readWorkspaceSettings() {
  return readCache();
}

/**
 * /setup/status를 1회 호출하고 결과를 캐시한다. 캐시가 있으면 네트워크를 타지 않는다.
 * 실패하면 throw — 호출부가 실패를 실패로 다루게 한다(호환값으로 위장하지 않는다).
 */
export async function fetchWorkspaceSettings({ force = false } = {}) {
  if (!force) {
    const cached = readCache();
    if (cached) return cached;
    if (inflight) return inflight;
  }
  inflight = (async () => {
    try {
      const res = await axios.get('/setup/status');
      const data = res.data || {};
      // 구버전 서버(마이그레이션 064 이전)는 time_zone 필드 자체가 없다 → 호환값.
      // **성공 응답이면서 필드가 없을 때만** 적용되는 폴백이다(위 fail-closed 주석 참고).
      // 필드가 있는데 무효한 IANA ID면 확정 불가 → throw (호환값으로 위장하지 않는다).
      const timeZone = data.time_zone == null ? COMPAT_TIME_ZONE : canonicalTimeZone(data.time_zone);
      if (!timeZone) throw new Error(`invalid workspace time_zone: ${String(data.time_zone)}`);
      const settings = {
        initialized: !!data.initialized,
        workspace_name: data.workspace_name || '',
        time_zone: timeZone,
      };
      // 미초기화 응답은 캐시하지 않는다 — setup을 마치면 값이 바뀌어야 한다.
      if (settings.initialized) writeCache(settings);
      return settings;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const WorkspaceSettingsContext = createContext(null);

const EMPTY = { initialized: false, workspace_name: '', time_zone: null };

// Provider 밖(테스트·스토리 등)에서 훅이 불렸을 때의 기본값. 'loading'이라 소비자는
// 게이트를 열지 않는다 — Provider가 없는데 timezone을 확정한 척하면 안 된다.
const NO_PROVIDER = {
  status: 'loading',
  initialized: false,
  workspaceName: '',
  timeZone: null,
  loaded: false,
  refresh: () => {},
};

export function WorkspaceSettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => readCache() || EMPTY);
  // 캐시가 있으면 곧바로 'success'다 — 이미 확정된 값을 다시 'loading'으로 되돌리면
  // Scrum이 매 마운트마다 로딩 화면을 깜빡인다.
  const [status, setStatus] = useState(() => (readCache() ? 'success' : 'loading'));
  // 응답 경합 가드. 이벤트/refresh로 여러 조회가 겹칠 때 늦게 온 낡은 응답이
  // 최신 상태를 덮지 않도록 시퀀스가 일치할 때만 반영한다(언마운트도 이 값으로 무효화).
  const seqRef = useRef(0);

  const load = useCallback(({ force = false } = {}) => {
    const seq = ++seqRef.current;
    // 캐시 히트는 네트워크를 타지 않으므로 loading으로 되돌리지 않는다.
    // force(=refresh())는 실제 재조회이므로 항상 loading → success/error를 거친다.
    if (force || !readCache()) setStatus('loading');
    fetchWorkspaceSettings({ force })
      .then((s) => {
        if (seqRef.current !== seq) return;
        setSettings(s);
        setStatus('success');
      })
      .catch(() => {
        if (seqRef.current !== seq) return;
        // 실패는 실패로 남긴다 — 이전 성공값도 버려 timezone이 새어 나가지 않게 한다.
        setSettings(EMPTY);
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    load();
    // 캐시 무효화(Setup 완료·로그아웃) → 다시 조회. 미초기화 응답은 캐시되지 않으므로
    // Setup 직후의 재조회가 workspace_name·time_zone이 담긴 최신 응답을 받는다.
    const onInvalidate = () => load();
    window.addEventListener(WORKSPACE_SETTINGS_INVALIDATE_EVENT, onInvalidate);
    return () => {
      seqRef.current += 1;   // 인플라이트 응답 무효화
      window.removeEventListener(WORKSPACE_SETTINGS_INVALIDATE_EVENT, onInvalidate);
    };
  }, [load]);

  // 사용자 재시도용. 캐시가 있어도 실제로 서버에 다시 물어본다.
  const refresh = useCallback(() => load({ force: true }), [load]);

  const value = useMemo(() => {
    const ok = status === 'success';
    return {
      status,                                   // 'loading' | 'success' | 'error'
      initialized: ok ? settings.initialized : false,
      workspaceName: ok ? (settings.workspace_name || '') : '',
      // 공용 기간 전용 timezone. 확정 전(로딩·실패)에는 null이다 — 소비자가 호환값을
      // 자기 쪽에서 되살리면 fail-closed 계약이 깨진다.
      timeZone: ok ? (settings.time_zone || COMPAT_TIME_ZONE) : null,
      // @deprecated status를 쓸 것. 조회가 끝났는지(성공/실패 무관)만 알려준다.
      loaded: status !== 'loading',
      refresh,
    };
  }, [settings, status, refresh]);

  return (
    <WorkspaceSettingsContext.Provider value={value}>{children}</WorkspaceSettingsContext.Provider>
  );
}

export function useWorkspaceSettings() {
  return useContext(WorkspaceSettingsContext) || NO_PROVIDER;
}
