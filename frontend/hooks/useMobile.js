import { useState, useEffect } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';

// 모바일 뷰포트 감지 훅
// 첫 값부터 실제 뷰포트를 쓴다(사용처 Layout은 _app의 appReady 뒤에만 그려져 SSR 불일치가 없다).
// false로 시작하면 휴대폰에서 마운트 직후 false→true 전환이 한 번 더 생기고, 그때 Layout의
// '모바일 진입 시 자동 닫기'가 마운트 때 연 메신저(채팅 푸시 주소 ?chat=)를 다시 접는다.
export default function useMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(MOBILE_QUERY)?.matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    setIsMobile(mql.matches);

    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return { isMobile };
}
