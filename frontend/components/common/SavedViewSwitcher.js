import { useState, useRef, useEffect } from 'react';
import { Bookmark, ChevronDown, Plus, Pin, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// 저장된 뷰 스위처(드롭다운 + 저장 팝오버). Branch TaskList와 MyTasks가 공유.
// pinnedViewIds/onTogglePin은 선택(사이드바 핀이 있는 TaskList만 전달; MyTasks는 미사용).
export default function SavedViewSwitcher({
  savedViews = [], activeViewId = null,
  onApplyView, onSaveView, onUpdateView, onDeleteView,
  pinnedViewIds = [], onTogglePin,
}) {
  const { t } = useTranslation();
  const [viewsOpen, setViewsOpen] = useState(false);
  const viewsRef = useRef(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const saveRef = useRef(null);

  useEffect(() => {
    if (!viewsOpen) return;
    const handleClick = (e) => {
      if (viewsRef.current && !viewsRef.current.contains(e.target)) setViewsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [viewsOpen]);
  useEffect(() => {
    if (!saveOpen) return;
    const handleClick = (e) => {
      if (saveRef.current && !saveRef.current.contains(e.target)) setSaveOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [saveOpen]);

  if (!onApplyView) return null;

  const activeView = savedViews.find((v) => v.view_id === activeViewId) || null;
  const submitSave = () => {
    const n = saveName.trim();
    if (!n) return;
    onSaveView(n);
    setSaveName('');
    setSaveOpen(false);
  };

  return (
    <div className="SavedViewSwitcher" ref={viewsRef}>
      <button
        type="button"
        className={`SavedViewSwitcher__Btn ${activeViewId ? 'SavedViewSwitcher__Btn--active' : ''}`}
        onClick={() => setViewsOpen((p) => !p)}
        title={t('common.savedViews.menuTitle')}
      >
        <Bookmark size={13} />
        {activeView ? activeView.name : t('common.savedViews.buttonLabel')}
        <ChevronDown size={11} />
      </button>
      {viewsOpen && (
        <div className="SavedViewSwitcher__Menu">
          {savedViews.length === 0 ? (
            <div className="SavedViewSwitcher__Empty">{t('common.savedViews.empty')}</div>
          ) : (
            savedViews.map((v) => (
              <div
                key={v.view_id}
                className={`SavedViewSwitcher__Row ${v.view_id === activeViewId ? 'SavedViewSwitcher__Row--active' : ''}`}
              >
                <button
                  type="button"
                  className="SavedViewSwitcher__Apply"
                  onClick={() => { onApplyView(v.view_id); setViewsOpen(false); }}
                >
                  {v.name}
                  {!v.is_owner && <span className="SavedViewSwitcher__Shared">{t('common.savedViews.shared')}</span>}
                </button>
                {onTogglePin && (
                  <button
                    type="button"
                    className={`SavedViewSwitcher__Pin ${pinnedViewIds.includes(v.view_id) ? 'SavedViewSwitcher__Pin--on' : ''}`}
                    onClick={() => onTogglePin(v.view_id)}
                    title={pinnedViewIds.includes(v.view_id)
                      ? t('common.savedViews.unpinFromSidebar')
                      : t('common.savedViews.pinToSidebar')}
                  >
                    <Pin size={12} />
                  </button>
                )}
                {v.is_owner && (
                  <>
                    <button
                      type="button"
                      className="SavedViewSwitcher__Edit"
                      onClick={() => onUpdateView(v.view_id)}
                      title={t('common.savedViews.overwriteWithCurrentFilters')}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="SavedViewSwitcher__Delete"
                      onClick={() => onDeleteView(v.view_id)}
                      title={t('common.actions.delete')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
      <div className="SavedViewSwitcher__Save" ref={saveRef}>
        <button
          type="button"
          className="SavedViewSwitcher__SaveBtn"
          onClick={() => setSaveOpen((p) => !p)}
          title={t('common.savedViews.saveCurrentFilters')}
        >
          <Plus size={12} />
          {t('common.actions.save')}
        </button>
        {saveOpen && (
          <div className="SavedViewSwitcher__SavePopover">
            <input
              className="SavedViewSwitcher__SaveInput"
              placeholder={t('common.savedViews.namePlaceholder')}
              value={saveName}
              autoFocus
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitSave(); }}
            />
            <button
              type="button"
              className="SavedViewSwitcher__SaveConfirm"
              disabled={!saveName.trim()}
              onClick={submitSave}
            >
              {t('common.actions.save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
