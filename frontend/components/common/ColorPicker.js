import { useTranslation } from 'react-i18next';

import { COLOR_PRESETS, DEFAULT_COLORS, HEX_RE } from '@/library/entityAppearance';

// presets: 팔레트 색 목록. 생략하면 엔티티 외관 공용 팔레트(COLOR_PRESETS) — 라벨 편집은 라벨 팔레트를 넘긴다.
export default function ColorPicker({
  value,
  onChange,
  disabled = false,
  presets = COLOR_PRESETS,
}) {
  const { t } = useTranslation();
  const hex = (value || '').toLowerCase();
  const isValid = HEX_RE.test(hex);

  return (
    <div className="ColorPicker">
      <div className="ColorPicker__Swatches">
        {presets.map((preset) => {
          const active = hex === preset.toLowerCase();
          return (
            <button
              key={preset}
              type="button"
              className={`ColorPicker__Swatch${active ? ' ColorPicker__Swatch--active' : ''}`}
              style={{ background: preset }}
              onClick={() => !disabled && onChange(preset)}
              disabled={disabled}
              aria-label={preset}
            />
          );
        })}
      </div>
      <div className="ColorPicker__Custom">
        <input
          type="text"
          className={`ColorPicker__HexInput${isValid ? '' : ' ColorPicker__HexInput--error'}`}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          maxLength={7}
          placeholder="#RRGGBB"
        />
        <input
          type="color"
          className="ColorPicker__NativePicker"
          value={isValid ? value : DEFAULT_COLORS.branch}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={t('common.colorPicker.pickColor')}
        />
      </div>
      {!isValid && !disabled && (
        <span className="ColorPicker__Error">{t('common.colorPicker.invalidHex')}</span>
      )}
    </div>
  );
}
