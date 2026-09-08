import { useTranslation } from 'react-i18next';

// 진행률(0~100)을 SVG 링으로. 시안 canvas-track.html의 ring SVG와 동일 형태.
// trackColor/textColor 기본값은 테마 토큰(--color-border-faint / --color-text)이라 라이트·다크를 따라간다. color는 stored-color 폴백이라 S7 소유.
export default function ProgressRing({
  value = 0,
  color = '#5E6AD2',
  size = 48,
  stroke = 5,
  // 호출부 2곳이 한 번도 안 넘긴다 → 라이트 값으로 고정돼 있었다.
  trackColor = 'var(--color-border-faint)',
  textColor = 'var(--color-text)',
}) {
  const { t } = useTranslation();
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - v / 100);
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: 'none' }} aria-label={t('home.progressRing.aria', { value: v })}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`} />
      <text x={cx} y={cx + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={textColor}>{v}%</text>
    </svg>
  );
}
