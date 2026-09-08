import TaskSummary from './DashboardWidgets/TaskSummary';
import RecentItems from './DashboardWidgets/RecentItems';
import StarredItems from './DashboardWidgets/StarredItems';
import ActiveSprints from './DashboardWidgets/ActiveSprints';
import UnreadMessages from './DashboardWidgets/UnreadMessages';

// key → 위젯 메타. Component는 self-contained(자체 fetch, props 없음).
export const WIDGET_REGISTRY = {
  mytasks: { labelKey: 'home.widgetRegistry.mytasks', Component: TaskSummary },
  recent:  { labelKey: 'home.widgetRegistry.recent', Component: RecentItems },
  starred: { labelKey: 'home.widgetRegistry.starred', Component: StarredItems },
  sprints: { labelKey: 'home.widgetRegistry.sprints', Component: ActiveSprints },
  messages: { labelKey: 'home.widgetRegistry.messages', Component: UnreadMessages },
};

// 카탈로그(편집 모드)에서 보여줄 순서
export const WIDGET_ORDER = ['mytasks', 'recent', 'starred', 'sprints', 'messages'];

// 신규 사용자 기본 활성 위젯(순서대로)
export const DEFAULT_ENABLED = ['mytasks', 'recent', 'starred'];
