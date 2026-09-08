import { useTranslation } from 'react-i18next';

import { COLOR_PRESETS, DEFAULT_COLORS, HEX_RE } from '@/library/entityAppearance';

export default function ColorPicker({
  value,
  onChange,
  disabled = false,
}) {
  const { t } = useTranslation();
  const hex = (value || '').toLowerCase();
  const isValid = HEX_RE.test(hex);

  return (
    <div className="ColorPicker">
      <div className="ColorPicker__Swatches">
        {COLOR_PRESETS.map((preset) => {
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
