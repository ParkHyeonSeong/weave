import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemePreference } from '@/library/theme';
import { THEME_ICONS } from '@/components/common/themeIcons';

// WAI-ARIA radiogroup: 화살표로 이동하면 즉시 선택된다(탭 이동과 다르다).
// roving tabindex — 그룹 전체가 탭 정지 하나만 갖도록 선택 항목만 tabIndex 0.
//
// enabled가 false면 아무 것도 렌더하지 않는다. 킬스위치가 켜졌거나 공개 플래그를 되돌린
// 상태에서는 사용자가 이 설정을 볼 수 없어야 한다 — 고른 값과 보이는 값이 갈리면 안 된다.
//
// 저장 중(pending)에는 DOM disabled를 쓰지 않는다 — 포커스된 요소가 disabled가 되면
// 브라우저가 즉시 blur해 키보드 포커스가 body로 날아가고 roving tabindex가 깨진다.
// 표시는 aria-disabled, 차단은 핸들러 가드로 한다.
export default function AppearanceSection() {
  const { t } = useTranslation();
  const { enabled, mode, options, choose, pending, error } = useThemePreference();
  const refs = useRef({});

  if (!enabled) return null;

  const idx = Math.max(0, options.findIndex((o) => o.value === mode));

  const select = (option) => {
    refs.current[option.value]?.focus();   // 포커스가 선택을 따라가야 roving tabindex가 성립
    choose(option.value);
  };
  const move = (delta) => select(options[(idx + delta + options.length) % options.length]);

  const onKeyDown = (e) => {
    if (pending) return;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowLeft':  case 'ArrowUp':   e.preventDefault(); move(-1); break;
      case 'Home':       e.preventDefault(); select(options[0]); break;
      case 'End':        e.preventDefault(); select(options[options.length - 1]); break;
      case ' ': case 'Enter': e.preventDefault(); choose(e.currentTarget.dataset.value); break;
      default: break;
    }
  };

  return (
    <div className="Profile__Section">
      <h2 className="Profile__SectionTitle" id="appearance-label">{t('profile.appearance')}</h2>
      <div className="Appearance__Group" role="radiogroup"
           aria-labelledby="appearance-label" aria-describedby="appearance-hint">
        {options.map((o) => {
          const Icon = THEME_ICONS[o.value];
          const selected = o.value === mode;
          return (
            <button
              key={o.value} type="button" role="radio" data-value={o.value}
              aria-checked={selected} aria-label={`${t(o.labelKey)} — ${t(o.hintKey)}`}
              tabIndex={selected ? 0 : -1} aria-disabled={pending || undefined}
              ref={(el) => { refs.current[o.value] = el; }}
              className={`Appearance__Option${selected ? ' Appearance__Option--selected' : ''}`}
              onClick={() => { if (!pending) choose(o.value); }} onKeyDown={onKeyDown}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="Appearance__OptionLabel">{t(o.labelKey)}</span>
              <span className="Appearance__OptionHint">{t(o.hintKey)}</span>
            </button>
          );
        })}
      </div>
      <p className="Appearance__Hint" id="appearance-hint">{t('theme.hint')}</p>
      {error && <p className="Appearance__Error" role="alert">{error}</p>}
    </div>
  );
}
