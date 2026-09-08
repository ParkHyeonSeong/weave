import { THEME_STORAGE_KEY, THEME_MIRROR_EVENT } from '@/library/theme';

// 클라이언트에 남은 이전 계정의 흔적을 지운다. 로그아웃 계열 세 경로가 전부 이 함수를 탄다
// (Header 로그아웃 · Command Palette 로그아웃 · auth-expired) — L1·L2·L3.
// 세 경로가 각자 같은 세 줄을 복제하고 있었고 그중 하나는 이미 대상이 어긋나 있었다.
// ⚠️ 워크스페이스 설정 캐시(workspaceSettings.js의 WORKSPACE_SETTINGS_KEY)는 **여기서
//    지우지 않는다.** 그건 세션이 아니라 워크스페이스 상태이고, L3(auth-expired)는 원래
//    지우지 않는다. L1·L2는 각자 clearWorkspaceSettingsCache()를 자기 줄로 부른다.
// ⚠️ 익명 표시 언어(localStorage['locale'])도 지우지 않는다 — 로그인 화면이 마지막 언어로 뜨게
//    하는 기기 편의값이고 시간대는 애초에 기기에 저장되지 않는다(이전 계정 상속 금지).
export function clearClientSession() {
  try { sessionStorage.removeItem('profile'); } catch {}
  try { sessionStorage.removeItem('avatar_url'); } catch {}
  // 공유 브라우저에서 이전 계정의 테마 취향이 로그인 화면까지 남지 않게 한다.
  // 미러가 없으면 normalizeMode가 'system'을 돌려주고, 해석은 플래그에 따라 갈린다:
  //   * SYSTEM_ENABLED=true (현재, S10 공개 후): 미러 삭제 후 OS 추종 — OS가 다크면 로그인 화면도 다크
  //   * SYSTEM_ENABLED=false (킬스위치와 별개의 되돌림 경로): 미러 삭제 후 light
  // 보장하는 것은 "앞 계정의 선택이 남지 않는다" 하나뿐이다.
  try { localStorage.removeItem(THEME_STORAGE_KEY); } catch {}
  // 같은 탭에는 storage 이벤트가 오지 않는다 — 살아 있는 ThemeProvider에 직접 알려
  // React mode도 즉시 미러를 다시 읽게 한다(안 하면 로그인 화면이 이전 계정 테마로 남는다).
  try { window.dispatchEvent(new Event(THEME_MIRROR_EVENT)); } catch {}
}
