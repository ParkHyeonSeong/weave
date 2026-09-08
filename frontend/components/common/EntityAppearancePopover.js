import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import ColorPicker from './ColorPicker';
import IconPicker from './IconPicker';
import EntityIcon from './EntityIcon';
import { DEFAULT_COLORS, HEX_RE } from '@/library/entityAppearance';

const ENTITY_CONFIG = {
  branch: { url: (id) => `/branches/${id}`, event: 'branch:created' },
  track:  { url: (id) => `/tracks/${id}`,   event: 'track:updated' },
  canvas: { url: (id) => `/canvases/${id}`, event: 'canvas:created' },
};

export default function EntityAppearancePopover({
  anchorRef,             // ref to the EntityIcon element clicked
  isOpen,
  onClose,
  entityType,            // 'branch' | 'track' | 'canvas'
  entityId,
  initialIcon,
  initialColor,
}) {
  const { t } = useTranslation();
  const [icon, setIcon] = useState(initialIcon ?? null);
  const [color, setColor] = useState(initialColor || DEFAULT_COLORS[entityType] || DEFAULT_COLORS.branch);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const popoverRef = useRef(null);

  // Re-sync state when modal opens or initial values change.
  useEffect(() => {
    if (!isOpen) return;
    setIcon(initialIcon ?? null);
    setColor(initialColor || DEFAULT_COLORS[entityType] || DEFAULT_COLORS.branch);
  }, [isOpen, initialIcon, initialColor, entityType]);

  // Position the popover relative to the anchor element.
  useEffect(() => {
    if (!isOpen || !anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const popoverWidth = 320;
    const popoverHeight = 260;
    setPos({
      top: Math.min(rect.bottom + 8, window.innerHeight - popoverHeight - 8),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8)),
    });
  }, [isOpen, anchorRef]);

  // Close on outside click.
  useEffect(() => {
    if (!isOpen) return;
    const handle = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        // Ignore clicks inside the IconPicker modal (mounted at body but covers screen)
        if (e.target.closest('.IconPicker__Backdrop')) return;
        onClose();
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const canSave = HEX_RE.test(color || '');

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const { url, event } = ENTITY_CONFIG[entityType];
      const res = await axios.patch(url(entityId), { color, icon });
      if (res.data.status) {
        window.dispatchEvent(new Event(event));
        onClose();
      }
    } catch {
      // PATCH 실패 — 그대로 두기 (사용자가 다시 시도 가능)
    }
    setSaving(false);
  };

  return (
    <>
      <div
        ref={popoverRef}
        className="EntityAppearancePopover"
        style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 900 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="EntityAppearancePopover__Row">
          <EntityIcon icon={icon} color={color} size={32} entityType={entityType} />
          <button
            type="button"
            className="EntityAppearancePopover__IconBtn"
            onClick={() => setIconPickerOpen(true)}
          >
            {icon ? t('common.appearance.changeIcon') : t('common.appearance.chooseIcon')}
          </button>
        </div>

        <ColorPicker value={color} onChange={setColor} />

        <div className="EntityAppearancePopover__Actions">
          <button type="button" onClick={onClose}>{t('common.actions.cancel')}</button>
          <button
            type="button"
            className="EntityAppearancePopover__BtnPrimary"
            onClick={handleSave}
            disabled={!canSave || saving}
          >
            {saving ? t('common.state.saving') : t('common.actions.save')}
          </button>
        </div>
      </div>

      <IconPicker
        isOpen={iconPickerOpen}
        onClose={() => setIconPickerOpen(false)}
        value={icon}
        color={color}
        entityType={entityType}
        entityId={entityId}
        onChange={(newIcon) => setIcon(newIcon)}
      />
    </>
  );
}
