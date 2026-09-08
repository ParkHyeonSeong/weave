import { useTranslation } from 'react-i18next';

// 슬래시 커맨드 목록 UI(표시 전용). 위치 지정은 호출자(에디터 팝업/메신저 래퍼)가 담당.
export default function SlashCommandMenu({ commands, activeIndex = 0, onSelect, onHover, className = '' }) {
  const { t } = useTranslation();
  if (!commands || commands.length === 0) return null;
  return (
    <div className={`SlashCommandMenu ${className}`.trim()}>
      <div className="SlashCommandMenu__Header">{t('canvasExt.slash.header')}</div>
      <ul className="SlashCommandMenu__List">
        {commands.map((c, idx) => (
          <li
            key={c.cmd}
            className={`SlashCommandMenu__Item ${idx === activeIndex ? 'SlashCommandMenu__Item--active' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); onSelect(c); }}
            onMouseEnter={() => onHover && onHover(idx)}
          >
            <span className="SlashCommandMenu__Cmd">{c.cmd}</span>
            <span className="SlashCommandMenu__Desc">{t(c.labelKey)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
