import { useTranslation } from 'react-i18next';
import { collabStatusKey } from '@/library/collabDelivery';

// 실시간 협업 문서(스크럼 주간·회고, 캔버스 편집)의 연결·전달 안내. 연결돼 있고 서버 적용이 확인되지 않은 편집이 없으면
// 아무것도 그리지 않는다. "저장됨"은 말하지 않는다 — DB 저장 시점은 브라우저가 알 수 없다(library/collabDelivery.js).
export default function CollabStatusBadge({ connection, pending }) {
  const { t } = useTranslation();
  const key = collabStatusKey(connection, pending);
  if (!key) return null;
  const warn = pending || connection === 'reconnecting';
  return (
    <span className={`CollabStatusBadge${warn ? ' CollabStatusBadge--warn' : ''}`} role="status" aria-live="polite">
      {t(key)}
    </span>
  );
}
