// 에러 코드 → 사용자 노출 문구의 단일 출처.
//
// 기존엔 컴포넌트마다 인라인 ternary/객체로 code→문구를 흩어 매핑했고, 같은 코드에
// 영어/한국어가 뒤섞이고 문구도 제각각이었다(예: NOT_BRANCH_MEMBER 4종, FILE_TOO_LARGE 3종).
// 여기로 통합해 한 곳에서 일관된 문구를 제공한다.
//
// 문구 자체는 library/i18n/{en,ko}.js의 errors.* / errorCategories.*로 옮겼다.
// **호출 시그니처는 그대로다** — errorText(code, category) → 문구 또는 null.
// 소비자(30여 곳)는 손대지 않아도 현재 locale의 문구를 받는다.
//
// React 밖(theme.js의 useThemePreference 등)에서도 불리므로 훅이 아니라 i18next 인스턴스를
// 직접 읽는다. 언어 변경은 i18next.changeLanguage가 즉시 반영하므로 다음 호출부터 새 언어다.
//
// 문구에 컨텍스트별 수치(예: 파일 2MB vs 10MB)가 필요한 호출부는 인라인으로 직접 처리한다(여긴 일반형).
import i18next from '@/library/i18n';

export function errorText(code, category = null) {
  if (code) {
    const key = `errors.${code}`;
    // exists()로 확인해야 한다 — t()는 키가 없으면 키 문자열을 그대로 돌려주므로
    // "매핑 없음 → null" 계약이 깨지고 화면에 'errors.FOO'가 찍힌다.
    if (i18next.exists(key)) return i18next.t(key);
  }
  if (category) {
    const key = `errorCategories.${category}`;
    if (i18next.exists(key)) return i18next.t(key);
  }
  return null;
}
