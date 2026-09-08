import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  Search, GitBranch, LogOut, Plus, Home, ListTodo, FileText,
  Compass, User, CircleDot, Clock, Settings, PanelLeft,
} from 'lucide-react';
import { axios } from '@/library/_axios';
import NavLink from '@/components/common/NavLink';
import { LOGIN_PATH } from '@/library/authRedirect';
import { clearClientSession } from '@/library/sessionCleanup';
import { clearWorkspaceSettingsCache } from '@/library/workspaceSettings';
import { useUiPrefs } from '@/library/UiPrefsContext';
import Avatar from '@/components/common/Avatar';
import { useTranslation } from 'react-i18next';

// --- Command 모드 액션 ---
// label/group은 키만 들고 있고 렌더 시 t()로 푼다 — 모듈 상수는 언어 변경에 반응하지 않는다.
const ACTIONS = [
  { id: 'nav-dashboard', labelKey: 'modal.palette.actions.dashboard', icon: Home, groupKey: 'modal.palette.groups.navigation', route: '/' },
  { id: 'nav-my-tasks', labelKey: 'modal.palette.actions.myTasks', icon: ListTodo, groupKey: 'modal.palette.groups.navigation', route: '/my-tasks' },
  { id: 'nav-browse', labelKey: 'modal.palette.actions.browse', icon: Compass, groupKey: 'modal.palette.groups.navigation', route: '/browse' },
  { id: 'nav-profile', labelKey: 'modal.palette.actions.profile', icon: User, groupKey: 'modal.palette.groups.navigation', route: '/profile' },
  { id: 'nav-admin', labelKey: 'modal.palette.actions.admin', icon: Settings, groupKey: 'modal.palette.groups.navigation', route: '/admin' },
  { id: 'create-branch', labelKey: 'modal.palette.actions.createBranch', icon: Plus, groupKey: 'modal.palette.groups.actions' },
  { id: 'create-canvas', labelKey: 'modal.palette.actions.createCanvas', icon: Plus, groupKey: 'modal.palette.groups.actions' },
  { id: 'logout', labelKey: 'auth.signOut', icon: LogOut, groupKey: 'modal.palette.groups.account' },
];

const formatStatusKey = (key) => key?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '';

export default function CommandPalette({ onClose }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { isHidden } = useUiPrefs();
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const listRef = useRef(null);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // 최근 항목
  const [recentItems, setRecentItems] = useState([]);

  // 검색 결과
  const [searchResults, setSearchResults] = useState({ tasks: [], docs: [], issues: [], members: [] });
  const [searching, setSearching] = useState(false);

  const isSearchMode = query.trim().length >= 2;

  // 마운트 시 인풋 포커스 + 최근 항목 fetch
  useEffect(() => {
    inputRef.current?.focus();
    fetchRecent();
  }, []);

  const fetchRecent = async () => {
    try {
      const res = await axios.get('/recent-views', { params: { limit: 5 } });
      if (res.data.status) setRecentItems(res.data.items || []);
    } catch {}
  };

  // 검색 모드: 디바운스 API 호출
  useEffect(() => {
    if (!isSearchMode) {
      setSearchResults({ tasks: [], docs: [], issues: [], members: [] });
      setSearching(false);
      return;
    }

    setSearching(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const q = query.trim();
        const [tasksRes, docsRes, issuesRes, membersRes] = await Promise.all([
          axios.get('/chat/task-search', { params: { q, mode: 'all' } }),
          axios.get('/chat/doc-search', { params: { q } }),
          axios.get('/chat/issue-search', { params: { q } }),
          axios.get('/chat/mention-search', { params: { q } }),
        ]);
        setSearchResults({
          tasks: tasksRes.data.status ? tasksRes.data.tasks || [] : [],
          docs: docsRes.data.status ? docsRes.data.docs || [] : [],
          issues: issuesRes.data.status ? issuesRes.data.issues || [] : [],
          members: membersRes.data.status ? membersRes.data.users || [] : [],
        });
        setActiveIndex(0);
      } catch {}
      setSearching(false);
    }, 300);

    return () => clearTimeout(timerRef.current);
  }, [query]);

  // --- flat items 리스트 생성 ---
  const { groups, flatItems } = useMemo(() => {
    const taskVisible = (x) => !isHidden('branches', x.branch_id);
    const docVisible = (x) => !isHidden('canvases', x.canvas_id);
    if (isSearchMode) {
      return buildSearchGroups({
        ...searchResults,
        tasks: searchResults.tasks.filter(taskVisible),
        docs: searchResults.docs.filter(docVisible),
        issues: searchResults.issues.filter(taskVisible),
      }, t);
    }
    const visibleRecent = recentItems.filter((r) =>
      r.type === 'task' ? taskVisible(r) : docVisible(r)
    );
    return buildCommandGroups(visibleRecent, query, t);
  }, [isSearchMode, searchResults, recentItems, query, isHidden, t]);

  // 키보드 네비게이션
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && flatItems[activeIndex]) {
      e.preventDefault();
      executeItem(flatItems[activeIndex]);
    }
  };

  // nav 항목의 목적지 URL. 렌더의 NavLink와 키보드 Enter가 같은 소스를 쓰도록 공유한다.
  const getItemHref = (item) => {
    if (item.type === 'recent-task' || item.type === 'search-task') {
      return `/branch/${item.data.branch_id}/task/${item.data.task_id}`;
    }
    if (item.type === 'recent-doc' || item.type === 'search-doc') {
      return `/canvas/${item.data.canvas_id}/${item.data.page_id}`;
    }
    if (item.type === 'search-issue') {
      return `/branch/${item.data.branch_id}/task/${item.data.task_id}/issue/${item.data.issue_id}`;
    }
    if (item.type === 'action' && item.data.route) return item.data.route;
    return null;
  };

  // 아이템 실행: 마우스 클릭은 NavLink가, 키보드 Enter는 여기서 라우팅한다.
  const executeItem = (item) => {
    const href = getItemHref(item);
    if (href) {
      onClose();
      router.push(href);
      return;
    }
    if (item.type === 'action') executeAction(item);
    // search-member: v1 표시만
  };

  const executeAction = (item) => {
    const action = item.data;
    if (action.route) {
      onClose();
      router.push(action.route);
      return;
    }
    switch (action.id) {
      case 'create-branch':
        onClose();
        window.dispatchEvent(new Event('palette:create-branch'));
        break;
      case 'create-canvas':
        onClose();
        window.dispatchEvent(new Event('layout:create-canvas'));
        break;
      case 'logout':
        axios.post('/auth/logout').catch(() => {});
        clearClientSession();
        clearWorkspaceSettingsCache();
        // returnTo 미전달: 로그아웃 후 다시 보호 페이지로 복귀시키지 않는다
        router.replace(LOGIN_PATH);
        onClose();
        break;
    }
  };

  // 활성 아이템 스크롤
  useEffect(() => {
    const activeEl = listRef.current?.querySelector('.CommandPalette__Item--active');
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div className="CommandPalette__Backdrop" onClick={onClose}>
      <div className="CommandPalette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="CommandPalette__InputWrap">
          <Search size={16} className="CommandPalette__SearchIcon" />
          <input
            ref={inputRef}
            className="CommandPalette__Input"
            type="text"
            placeholder={t('modal.palette.placeholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
          />
          <kbd className="CommandPalette__Shortcut">ESC</kbd>
        </div>

        <div className="CommandPalette__List" ref={listRef}>
          {searching ? (
            <div className="CommandPalette__Loading">{t('modal.palette.searching')}</div>
          ) : flatItems.length === 0 ? (
            <div className="CommandPalette__Empty">{t('modal.palette.noResults')}</div>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="CommandPalette__Group">
                <div className="CommandPalette__GroupLabel">{group.label}</div>
                {group.items.map((item) => {
                  // Navigation items: recent-task, recent-doc, search-task, search-doc, search-issue
                  // Action items with routes: nav-dashboard, nav-my-tasks, nav-browse, nav-profile, nav-admin
                  // Command actions (create, logout): stay as button
                  const href = getItemHref(item);

                  if (!href) {
                    // 네비게이션이 아닌 항목 (create-branch, create-canvas, logout, search-member)
                    return (
                      <button
                        key={item.key}
                        className={`CommandPalette__Item ${item.flatIndex === activeIndex ? 'CommandPalette__Item--active' : ''}`}
                        onClick={() => executeItem(item)}
                        onMouseEnter={() => setActiveIndex(item.flatIndex)}
                      >
                        {renderItem(item, t)}
                      </button>
                    );
                  }

                  return (
                    <NavLink
                      key={item.key}
                      href={href}
                      className={`CommandPalette__Item ${item.flatIndex === activeIndex ? 'CommandPalette__Item--active' : ''}`}
                      onClick={onClose}
                      onMouseEnter={() => setActiveIndex(item.flatIndex)}
                    >
                      {renderItem(item, t)}
                    </NavLink>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// --- 아이템 렌더링 ---
// t는 호출부가 넘긴다 — 컴포넌트가 아니라 순수 렌더 헬퍼라 훅을 쓸 수 없다.
function renderItem(item, t) {
  switch (item.type) {
    case 'action': {
      const Icon = item.data.icon;
      return (
        <>
          <Icon size={16} className="CommandPalette__ItemIcon" />
          <span className="CommandPalette__ItemLabel">{item.data.label}</span>
        </>
      );
    }
    case 'recent-task':
      return (
        <>
          <div className="CommandPalette__StatusDot" style={item.data.status_color ? { background: item.data.status_color } : undefined} />
          <span className="CommandPalette__ItemId">{item.data.display_number}</span>
          <span className="CommandPalette__ItemLabel">{item.data.title}</span>
        </>
      );
    case 'recent-doc':
      return (
        <>
          <FileText size={14} className="CommandPalette__ItemIcon" />
          <span className="CommandPalette__ItemLabel">{item.data.title}</span>
          <span className="CommandPalette__ItemMeta">{item.data.canvas_name}</span>
        </>
      );
    case 'search-task': {
      const main = (item.data.assignees || []).find((a) => a.role === 'main');
      return (
        <>
          <ListTodo size={14} className="CommandPalette__ItemIcon" />
          <span className="CommandPalette__ItemId">{item.data.display_id}</span>
          <span className="CommandPalette__ItemLabel">{item.data.title}</span>
          <span
            className="CommandPalette__ItemMeta"
            style={item.data.status_color ? { color: item.data.status_color } : undefined}
          >
            {item.data.status_label || formatStatusKey(item.data.status)}
          </span>
          {main && (
            <span className="CommandPalette__ItemMeta CommandPalette__ItemAssignee">
              <Avatar user={main} size="xs" />
              {main.username}
            </span>
          )}
        </>
      );
    }
    case 'search-doc':
      return (
        <>
          <FileText size={14} className="CommandPalette__ItemIcon" />
          <span className="CommandPalette__ItemLabel">{item.data.title}</span>
          <span className="CommandPalette__ItemMeta">{item.data.canvas_name}</span>
        </>
      );
    case 'search-issue':
      return (
        <>
          <CircleDot size={14} className="CommandPalette__ItemIcon" />
          <span className="CommandPalette__ItemLabel">{item.data.title}</span>
          <span className={`CommandPalette__StatusBadge CommandPalette__StatusBadge--${item.data.status}`}>
            {item.data.status === 'open' ? t('modal.palette.issueOpen') : t('modal.palette.issueClosed')}
          </span>
          <span className="CommandPalette__ItemId">{item.data.display_id}</span>
        </>
      );
    case 'search-member':
      return (
        <>
          <Avatar user={item.data} size="sm" />
          <span className="CommandPalette__ItemLabel">{item.data.username}</span>
          <span className="CommandPalette__ItemMeta">{item.data.email}</span>
        </>
      );
    default:
      return null;
  }
}

// --- Command 모드 그룹 빌드 ---
function buildCommandGroups(recentItems, query, t) {
  const groups = [];
  const flatItems = [];
  let flatIndex = 0;

  // 최근 항목 (쿼리 없을 때만)
  if (!query && recentItems.length > 0) {
    const items = recentItems.map((r) => {
      const type = r.type === 'task' ? 'recent-task' : 'recent-doc';
      const key = `recent-${r.type}-${r.type === 'task' ? r.task_id : r.page_id}`;
      const item = { type, key, data: r, flatIndex: flatIndex++ };
      flatItems.push(item);
      return item;
    });
    groups.push({ label: t('modal.palette.groups.recent'), items });
  }

  // 액션 필터링 (번역된 label로 매칭한다 — 사용자가 보는 문구가 곧 검색 대상)
  const q = query.toLowerCase();
  const localized = ACTIONS.map((a) => ({ ...a, label: t(a.labelKey), group: t(a.groupKey) }));
  const filtered = q
    ? localized.filter((a) => a.label.toLowerCase().includes(q))
    : localized;

  // 그룹별 분류
  const actionGroups = {};
  filtered.forEach((action) => {
    if (!actionGroups[action.group]) actionGroups[action.group] = [];
    const item = { type: 'action', key: `action-${action.id}`, data: action, flatIndex: flatIndex++ };
    actionGroups[action.group].push(item);
    flatItems.push(item);
  });

  Object.entries(actionGroups).forEach(([label, items]) => {
    groups.push({ label, items });
  });

  return { groups, flatItems };
}

// --- Search 모드 그룹 빌드 ---
function buildSearchGroups(results, t) {
  const groups = [];
  const flatItems = [];
  let flatIndex = 0;

  if (results.tasks.length > 0) {
    const items = results.tasks.map((t) => {
      const item = { type: 'search-task', key: `task-${t.task_id}`, data: t, flatIndex: flatIndex++ };
      flatItems.push(item);
      return item;
    });
    groups.push({ label: t('modal.palette.groups.tasks'), items });
  }

  if (results.docs.length > 0) {
    const items = results.docs.map((d) => {
      const item = { type: 'search-doc', key: `doc-${d.page_id}`, data: d, flatIndex: flatIndex++ };
      flatItems.push(item);
      return item;
    });
    groups.push({ label: t('modal.palette.groups.documents'), items });
  }

  if (results.issues.length > 0) {
    const items = results.issues.map((i) => {
      const item = { type: 'search-issue', key: `issue-${i.issue_id}`, data: i, flatIndex: flatIndex++ };
      flatItems.push(item);
      return item;
    });
    groups.push({ label: t('modal.palette.groups.issues'), items });
  }

  if (results.members.length > 0) {
    const items = results.members.map((m) => {
      const item = { type: 'search-member', key: `member-${m.user_id}`, data: m, flatIndex: flatIndex++ };
      flatItems.push(item);
      return item;
    });
    groups.push({ label: t('modal.palette.groups.members'), items });
  }

  return { groups, flatItems };
}
