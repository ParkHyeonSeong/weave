import { useState, useRef, useEffect, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DropdownPortal from './DropdownPortal';

/**
 * CustomSelect - 네이티브 select 대체 커스텀 드롭다운
 *
 * 드롭다운 내용은 DropdownPortal을 통해 document.body에 포털된다(overflow:hidden 조상에
 * 클리핑되지 않도록). 트리거는 제자리에 남는다.
 *
 * @param {string|number|null} value - 현재 선택된 값
 * @param {Array<{value: string|number, label: string, icon?: React.Element, color?: string}>} options
 * @param {(value: string|number|null) => void} onChange
 * @param {string} [placeholder] - 미지정 시 공용 'Select…' 문구
 * @param {string} [size='md'] - 'sm' | 'md'
 * @param {string} [className='']
 * @param {string} [ariaLabel] - 화면에 보이는 라벨이 없는 셀렉트(목록 행 안 등)의 접근 가능한 이름
 * @param {boolean} [disabled=false] - 저장 중 등 일시적으로 조작을 막을 때
 * @param {boolean} [returnFocusOnEscape=false] - Esc로 목록을 닫을 때 포커스를 트리거로 돌린다(키보드로 쓰는 창 안 목록용)
 * @param {boolean} [returnFocusOnSelect=false] - 항목을 골라 목록을 닫을 때 포커스를 트리거로 돌린다 — 항목과 함께 포커스가 사라지지 않게(키보드로 쓰는 창 안 목록용)
 */
export default function CustomSelect({
  value, options, onChange, placeholder, size = 'md', className = '',
  hideArrow = false, ariaLabel, disabled = false, returnFocusOnEscape = false, returnFocusOnSelect = false,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null); // 트리거
  const triggerRef = useRef(null); // 트리거 버튼(목록을 닫은 뒤 포커스 복귀용)
  const dropdownRef = useRef(null); // 포털된 드롭다운
  const listId = useId(); // 트리거의 aria-controls — 포털된 목록을 찾아갈 수 있게(모달의 Tab 순환 등)

  // 외부 클릭 감지 (트리거 + 포털된 드롭다운 둘 다 "내부"로 취급)
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return; // 포털 내부 클릭은 외부 아님
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Escape 키 — 목록만 닫는다. 목록이 떠 있었으면 preventDefault로 '처리됨'을 알려 바깥 창(모달 등)이
  // 같은 Esc로 함께 닫히지 않게 한다.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key !== 'Escape') return;
      const shown = !!dropdownRef.current;
      setOpen(false);
      if (!shown) return;
      e.preventDefault();
      if (returnFocusOnEscape) triggerRef.current?.focus();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, returnFocusOnEscape]);

  const placeholderText = placeholder ?? t('common.select.placeholder');
  const selected = options.find((o) => String(o.value) === String(value));

  const handleSelect = (opt) => {
    onChange(opt.value);
    setOpen(false);
    if (returnFocusOnSelect) triggerRef.current?.focus();
  };

  const handleTriggerClick = (e) => {
    e.stopPropagation();
    setOpen((prev) => !prev);
  };

  // disabled로 바뀌는 순간 열려 있던 드롭다운이 남지 않도록 렌더 시점에도 닫힌 것으로 취급
  const isOpen = open && !disabled;

  return (
    <div
      ref={ref}
      className={`CustomSelect CustomSelect--${size} ${isOpen ? 'CustomSelect--open' : ''} ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 트리거 */}
      <button
        ref={triggerRef}
        type="button"
        className="CustomSelect__Trigger"
        onClick={handleTriggerClick}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        disabled={disabled}
      >
        <span className="CustomSelect__Value">
          {selected ? (
            <>
              {selected.icon && <span className="CustomSelect__Icon">{selected.icon}</span>}
              {selected.color && (
                <span
                  className="CustomSelect__Dot"
                  style={{ backgroundColor: selected.color }}
                />
              )}
              <span>{selected.label}</span>
            </>
          ) : (
            <span className="CustomSelect__Placeholder">{placeholderText}</span>
          )}
        </span>
        {!hideArrow && <ChevronDown size={size === 'sm' ? 12 : 14} className="CustomSelect__Arrow" />}
      </button>

      {/* 드롭다운 (body 포털) — 루트 밖에 렌더되므로 size 모디파이어를 드롭다운에 직접 부여 */}
      <DropdownPortal anchorRef={ref} open={isOpen} dropdownRef={dropdownRef}>
        <div id={listId} className={`CustomSelect__Dropdown CustomSelect__Dropdown--${size}`}>
          {options.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              className={`CustomSelect__Option ${String(opt.value) === String(value) ? 'CustomSelect__Option--selected' : ''}`}
              onClick={() => handleSelect(opt)}
            >
              {opt.icon && <span className="CustomSelect__Icon">{opt.icon}</span>}
              {opt.color && (
                <span
                  className="CustomSelect__Dot"
                  style={{ backgroundColor: opt.color }}
                />
              )}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </DropdownPortal>
    </div>
  );
}
