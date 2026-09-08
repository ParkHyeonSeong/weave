import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatUnsupportedWarning } from '@/library/rawMode';

// raw 토글 진입 시 손실 경고 / 파싱 실패(방어) 인라인 배지 — 무음 드롭 금지 원칙
export default function RawModeBadge({ warnings, parseError }) {
  const { t } = useTranslation();
  const warnText = formatUnsupportedWarning(warnings);
  if (!parseError && !warnText) return null;
  return (
    <div className={`RawModeBadge${parseError ? ' RawModeBadge--error' : ''}`}>
      <AlertTriangle size={12} />
      <span>
        {parseError
          ? t('common.rawMode.parseError')
          : warnText}
      </span>
    </div>
  );
}
