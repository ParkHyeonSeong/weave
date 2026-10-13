import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { X, Trash2, Plus, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { entityBorderStyle, entityTintStyle } from '@/library/entityTint';
import LabelEditPopover from '@/components/common/LabelEditPopover';

const PRESET_COLORS = [
  '#5E6AD2', '#DC2626', '#F59E0B', '#16A34A', '#2563EB',
  '#8B5CF6', '#EC4899', '#0891B2', '#C2410C', '#4F46E5',
  '#059669', '#D97706', '#7C3AED', '#DB2777', '#0D9488',
  '#9333EA',
];

function getRandomColor() {
  return PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
}

// 편집 열기 버튼의 마우스 누름이 행의 부착(onMouseDown)으로 번지지 않게 막는다
const stopMouseDown = (e) => { e.preventDefault(); e.stopPropagation(); };

/**
 * onUpdateLabel(labelId, changes) → Promise<{ ok } | { ok:false, code, category, network }>
 * 편집은 부착·해제·삭제와 다른 버튼에서만 열린다 — 칩의 이름 버튼(할당된 라벨), 목록의 점·연필(미할당 라벨).
 */
export default function LabelTagInput({ assignedLabels = [], allLabels = [], onToggle, onCreate, onDelete, onUpdateLabel }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);   // { label, returnFocus } — 편집창이 열린 라벨(연 순간의 값)
  const editingRef = useRef(null);                 // 지금 열린 편집창 — 늦게 온 닫기·완료가 다른 편집창을 건드리지 않게 비교한다
  const savingRef = useRef(false);                 // 저장 응답을 기다리는 중 — 그동안은 편집 대상을 바꾸지 않는다
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
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

  // returnFocus = 편집을 연 버튼. 목록에서 열었으면 목록이 닫혀 버튼이 사라지므로 null(입력칸으로 돌아온다).
  // 저장 응답을 기다리는 동안에는 다른 라벨(칩·연필)을 눌러도 편집 대상을 바꾸지 않는다 — 초안·저장 대상·
  // 늦게 온 응답이 서로 다른 라벨에 섞이지 않게(편집창은 그동안 '적용 중…'으로 남아 있다).
  const openEditor = (label, returnFocus) => {
    if (savingRef.current) return;
    setOpen(false);
    setQuery('');
    const session = { label, returnFocus };
    editingRef.current = session;
    setEditing(session);
  };

  // session = 닫으려는 편집창(연 순간의 값). 이미 닫혔거나 다른 편집창으로 바뀌었으면 아무것도 하지 않는다.
  const closeEditor = (session, reason) => {
    if (editingRef.current !== session) return;
    editingRef.current = null;
    // 저장을 기다리는 사이 사용자가 다른 곳(댓글 입력기 등)으로 옮겨 갔다면 포커스를 빼앗지 않는다 —
    // 편집창이 사라지기 전에, 포커스가 아직 편집창 안이거나 문서에 있는지 본다
    const active = document.activeElement;
    const focusInEditor = !active || active === document.body || !!active.closest?.('.LabelEditPopover');
    setEditing(null);
    if (reason === 'outside' || !focusInEditor) return;   // 다른 곳을 눌러 닫혔으면 그 자리의 포커스를 둔다
    requestAnimationFrame(() => {
      const back = session.returnFocus;
      const target = back?.isConnected ? back : inputRef.current;
      target?.focus({ preventScroll: true });
    });
  };

  // 저장 대상은 그 편집창이 연 라벨이다(누른 순간의 값)
  const applyEdit = async (session, changes) => {
    savingRef.current = true;
    try {
      return await onUpdateLabel(session.label.label_id, changes);
    } finally {
      savingRef.current = false;
    }
  };
  const onEditorApply = useCallback((changes) => applyEdit(editing, changes), [editing, onUpdateLabel]);
  const onEditorClose = useCallback((reason) => closeEditor(editing, reason), [editing]);

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
              <button
                type="button"
                className="LabelTagInput__ChipEdit"
                onClick={(e) => { e.stopPropagation(); openEditor(label, e.currentTarget); }}
                title={t('common.labelEdit.title')}
                aria-label={t('common.labelEdit.editAria', { name: label.label_name })}
              >
                {label.label_name}
              </button>
              <button
                type="button"
                className={`LabelTagInput__ChipRemove${chipTint?.['--et-on'] ? ' EntityInk' : ''}`}
                onClick={(e) => { e.stopPropagation(); onToggle(label.label_id); }}
                aria-label={t('common.labelEdit.removeAria', { name: label.label_name })}
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
              <span
                className="LabelTagInput__OptionDot"
                style={{ backgroundColor: label.color }}
                aria-hidden="true"
                onMouseDown={stopMouseDown}
                onClick={(e) => { e.stopPropagation(); openEditor(label, null); }}
              />
              <span className="LabelTagInput__OptionName">{label.label_name}</span>
              <button
                type="button"
                className="LabelTagInput__OptionEdit"
                onMouseDown={stopMouseDown}
                onClick={(e) => { e.stopPropagation(); openEditor(label, null); }}
                title={t('common.labelEdit.title')}
                aria-label={t('common.labelEdit.editAria', { name: label.label_name })}
              >
                <Pencil size={12} />
              </button>
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

      {editing && onUpdateLabel && (
        <LabelEditPopover
          // 라벨마다 새 편집창 — 앞 라벨의 초안을 다른 라벨로 가져가지 않는다
          key={editing.label.label_id}
          label={editing.label}
          labels={allLabels}
          presets={PRESET_COLORS}
          anchorRef={wrapRef}
          onApply={onEditorApply}
          onClose={onEditorClose}
        />
      )}
    </div>
  );
}
