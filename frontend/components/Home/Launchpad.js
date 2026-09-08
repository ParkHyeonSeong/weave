import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GitBranch, FileEdit, Workflow, Compass, CalendarCheck } from 'lucide-react';
import { APP_HOME } from '@/library/appContext';
import NavLink from '@/components/common/NavLink';
import { DEFAULT_COLORS } from '@/library/entityAppearance';
import { useUiPrefs } from '@/library/UiPrefsContext';

// key 기반 앱 레지스트리. 정렬 가능한 앱 타일만 여기에 둔다(browse 제외).
const APP_REGISTRY = {
  scrum:  { key: 'scrum',  label: 'Scrum',  subKey: 'home.launchpad.scrumSub',  Icon: CalendarCheck, color: DEFAULT_COLORS.scrum,  path: APP_HOME.scrum },
  track:  { key: 'track',  label: 'Track',  subKey: 'home.launchpad.trackSub',  Icon: Workflow,      color: DEFAULT_COLORS.track,  path: APP_HOME.track },
  branch: { key: 'branch', label: 'Branch', subKey: 'home.launchpad.branchSub', Icon: GitBranch,     color: DEFAULT_COLORS.branch, path: APP_HOME.branch },
  canvas: { key: 'canvas', label: 'Canvas', subKey: 'home.launchpad.canvasSub', Icon: FileEdit,      color: DEFAULT_COLORS.canvas, path: APP_HOME.canvas },
};

// 기본 순서: daily(scrum) → track → branch → canvas
const DEFAULT_ORDER = ['scrum', 'track', 'branch', 'canvas'];

// browse는 앱이 아닌 부가 진입점 → 정렬 대상에서 제외하고 항상 마지막 고정.
const BROWSE_TILE = { key: 'browse', labelKey: 'home.launchpad.browseLabel', subKey: 'home.launchpad.browseSub', Icon: Compass, color: '#F59E0B', path: '/browse' };

// 저장본을 기본 순서와 머지: 알 수 없는 key는 버리고, 기본 순서에 있는데 저장본에 없는 key는
// 뒤에 자동 추가(향후 새 앱 추가 시 자동 노출). 값 없으면 기본 순서.
function normalizeOrder(saved) {
  if (Array.isArray(saved)) {
    const known = saved.filter((k) => APP_REGISTRY[k]);
    const missing = DEFAULT_ORDER.filter((k) => !known.includes(k));
    return [...known, ...missing];
  }
  return [...DEFAULT_ORDER];
}

function TileBody({ app }) {
  const { t } = useTranslation();
  const Icon = app.Icon;
  return (
    <>
      <span className="Launchpad__Icon" style={{ background: app.color }}>
        {/* 배지 슬롯(향후): <span className="Launchpad__Badge" /> */}
        <Icon size={30} color="#fff" strokeWidth={2} />
      </span>
      <span className="Launchpad__Name">{app.labelKey ? t(app.labelKey) : app.label}</span>
      <span className="Launchpad__Sub">{t(app.subKey)}</span>
    </>
  );
}

function SortableTile({ app }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: app.key });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <NavLink
      ref={setNodeRef}
      href={app.path}
      style={style}
      className="Launchpad__Tile Launchpad__Tile--sortable"
      {...attributes}
      {...listeners}
    >
      <TileBody app={app} />
    </NavLink>
  );
}

export default function Launchpad() {
  const { prefs, setNamespace } = useUiPrefs();
  const order = useMemo(() => normalizeOrder(prefs.launchpad_order), [prefs.launchpad_order]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(active.id);
    const newIndex = order.indexOf(over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setNamespace('launchpad_order', arrayMove(order, oldIndex, newIndex));
  };

  return (
    <div className="Launchpad">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          {order.map((key) => {
            const app = APP_REGISTRY[key];
            return (
              <SortableTile key={app.key} app={app} />
            );
          })}
        </SortableContext>
      </DndContext>
      <NavLink href={BROWSE_TILE.path} className="Launchpad__Tile">
        <TileBody app={BROWSE_TILE} />
      </NavLink>
    </div>
  );
}
