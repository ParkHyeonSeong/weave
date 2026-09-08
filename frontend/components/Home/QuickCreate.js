import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, GitBranch, FileEdit, Workflow, CalendarCheck } from 'lucide-react';

const ITEMS = [
  { key: 'branch', labelKey: 'home.quickCreate.newBranch', event: 'layout:create-branch', Icon: GitBranch },
  { key: 'canvas', labelKey: 'home.quickCreate.newCanvas', event: 'layout:create-canvas', Icon: FileEdit },
  { key: 'track',  labelKey: 'home.quickCreate.newTrack',  event: 'layout:create-track',  Icon: Workflow },
  { key: 'scrum',  labelKey: 'home.quickCreate.newScrum',  event: 'layout:create-scrum',  Icon: CalendarCheck },
];

export default function QuickCreate() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const create = (event) => { setOpen(false); window.dispatchEvent(new Event(event)); };

  return (
    <div className="QuickCreate" ref={ref}>
      <button className="QuickCreate__Btn" onClick={() => setOpen((p) => !p)}>
        <Plus size={16} /> {t('common.actions.create')}
      </button>
      {open && (
        <div className="QuickCreate__Menu">
          {ITEMS.map((it) => {
            const Icon = it.Icon;
            return (
              <button key={it.key} className="QuickCreate__Item" onClick={() => create(it.event)}>
                <Icon size={15} /> {t(it.labelKey)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
