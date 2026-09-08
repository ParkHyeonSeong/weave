import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { entityBorderStyle, entityTintStyle } from '@/library/entityTint';

const PRESET_COLORS = [
  '#5E6AD2', '#DC2626', '#F59E0B', '#16A34A', '#2563EB',
  '#8B5CF6', '#EC4899', '#0891B2', '#C2410C', '#4F46E5',
  '#059669', '#D97706', '#7C3AED', '#DB2777', '#0D9488',
  '#9333EA',
];

function getRandomColor() {
  return PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
}

export default function LabelTagInput({ assignedLabels = [], allLabels = [], onToggle, onCreate, onDelete, onUpdateColor }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [colorPickerLabelId, setColorPickerLabelId] = useState(null);
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        // 포탈로 렌더된 팔레트 내부 클릭은 무시
        const picker = document.getElementById('label-color-picker-portal');
        if (picker && picker.contains(e.target)) return;
        setOpen(false);
        setQuery('');
        setColorPickerLabelId(null);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const assignedIds = useMemo(() => new Set(assignedLabels.map((l) => l.label_id)), [assignedLabels]);

  // 미할당 라벨 중 검색어 필터
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allLabels
      .filter((l) => !assignedIds.has(l.label_id))
      .filter((l) => !q || l.label_name.toLowerCase().includes(q));
  }, [allLabels, assignedIds, query]);

  // 정확히 같은 이름의 라벨이 이미 존재하는지
  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q && allLabels.some((l) => l.label_name.toLowerCase() === q);
  }, [allLabels, query]);

  const showCreate = query.trim() && !exactMatch;

  const handleSelect = (labelId) => {
    onToggle(labelId);
    setQuery('');
    setColorPickerLabelId(null);
    inputRef.current?.focus();
  };

  const handleCreate = () => {
    if (!query.trim()) return;
    onCreate(query.trim(), getRandomColor());
    setQuery('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length === 1) {
        handleSelect(filtered[0].label_id);
      } else if (showCreate) {
        handleCreate();
      }
    }
    // Backspace로 마지막 라벨 해제
    if (e.key === 'Backspace' && !query && assignedLabels.length > 0) {
      onToggle(assignedLabels[assignedLabels.length - 1].label_id);
    }
  };

  const openColorPicker = useCallback((labelId, dotEl) => {
    if (colorPickerLabelId === labelId) {
      setColorPickerLabelId(null);
      return;
    }
    const rect = dotEl.getBoundingClientRect();
    setPickerPos({ top: rect.bottom + 4, left: rect.left });
    setColorPickerLabelId(labelId);
  }, [colorPickerLabelId]);

  const handleColorChange = (labelId, color) => {
    if (onUpdateColor) onUpdateColor(labelId, color);
    setColorPickerLabelId(null);
  };

  // 현재 색상 팔레트 대상 라벨
  const pickerLabel = colorPickerLabelId
    ? allLabels.find((l) => l.label_id === colorPickerLabelId)
    : null;

  return (
    <div className="LabelTagInput" ref={wrapRef}>
      <div className="LabelTagInput__Chips" onClick={() => inputRef.current?.focus()}>
        {assignedLabels.map((label) => {
          const chipTint = entityTintStyle(label.color, { alpha: '20' });
          const chipBd = entityBorderStyle(label.color);
          return (
            <span
              key={label.label_id}
              className={`LabelTagInput__Chip${chipTint?.['--et-on'] ? ' EntityTint EntityBorder' : ''}`}
              style={{ ...chipTint, ...chipBd }}
            >
              {label.label_name}
              <button
                type="button"
                className={`LabelTagInput__ChipRemove${chipTint?.['--et-on'] ? ' EntityInk' : ''}`}
                onClick={(e) => { e.stopPropagation(); onToggle(label.label_id); }}
                // 배경이 칩의 틴트라 부모가 내려놓은 --et-fg를 상속으로 쓴다.
                // passthrough면 변수가 없어 치환 실패(initial)이므로 원 색을 그대로 쓴다.
                style={{ color: chipTint?.['--et-on'] ? 'var(--et-fg)' : label.color }}
              >
                <X size={10} />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          className="LabelTagInput__Input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={assignedLabels.length === 0 ? t('common.labelInput.placeholder') : ''}
        />
      </div>

      {open && (filtered.length > 0 || showCreate) && (
        <div className="LabelTagInput__Dropdown">
          {filtered.map((label) => (
            <div
              key={label.label_id}
              className="LabelTagInput__Option"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(label.label_id); }}
            >
              <button
                type="button"
                className="LabelTagInput__OptionDot"
                style={{ backgroundColor: label.color }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openColorPicker(label.label_id, e.currentTarget);
                }}
              />
              <span className="LabelTagInput__OptionName">{label.label_name}</span>
              <button
                type="button"
                className="LabelTagInput__OptionDelete"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(label.label_id);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {showCreate && (
            <>
              {filtered.length > 0 && <div className="LabelTagInput__Divider" />}
              <div
                className="LabelTagInput__Option LabelTagInput__Option--create"
                onMouseDown={(e) => { e.preventDefault(); handleCreate(); }}
              >
                <Plus size={12} />
                <span>{t('common.labelInput.create', { name: query.trim() })}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* 색상 팔레트 — portal로 body에 렌더 */}
      {colorPickerLabelId && pickerLabel && createPortal(
        <div
          id="label-color-picker-portal"
          className="LabelTagInput__ColorPicker"
          style={{ top: pickerPos.top, left: pickerPos.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`LabelTagInput__ColorSwatch ${c === pickerLabel.color ? 'LabelTagInput__ColorSwatch--active' : ''}`}
              style={{ backgroundColor: c }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleColorChange(pickerLabel.label_id, c);
              }}
            />
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
