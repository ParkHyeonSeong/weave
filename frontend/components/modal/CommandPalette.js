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
import { unsubscribeFromPush } from '@/library/pushSubscription';
import { clearWorkspaceSettingsCache } from '@/library/workspaceSettings';
import { useUiPrefs } from '@/library/UiPrefsContext';
import Avatar from '@/components/common/Avatar';
import EntityIcon from '@/components/common/EntityIcon';
import { useTranslation } from 'react-i18next';

// --- Command 모드 액션 ---
// label/group은 키만 들고 있고 렌더 시 t()로 푼다 — 모듈 상수는 언어 변경에 반응하지 않는다.
const ACTIONS = [
  { id: 'nav-dashboard', labelKey: 'modal.palette.actions.dashboard', icon: Home, groupKey: 'modal.palette.groups.navigation', route: '/' },
  { id: 'nav-my-tasks', labelKey: 'modal.palette.actions.myTasks', icon: ListTodo, groupKey: 'modal.palette.groups.navigation', route: '/my-tasks' },
  { id: 'nav-browse', labelKey: 'modal.palette.actions.browse', icon: Compass, groupKey: 'modal.palette.groups.navigation', route: '/browse' },
  { id: 'nav-profile', labelKey: 'modal.palette.actions.profile', icon: User, groupKey: 'modal.palette.groups.navigation', route: '/profile' },
  // 헤더 관리자 메뉴처럼 관리자에게만 — 비관리자는 /admin이 '/'로 돌려보낸다.
  { id: 'nav-admin', labelKey: 'modal.palette.actions.admin', icon: Settings, groupKey: 'modal.palette.groups.navigation', route: '/admin', adminOnly: true },
  { id: 'create-branch', labelKey: 'modal.palette.actions.createBranch', icon: Plus, groupKey: 'modal.palette.groups.actions' },
  { id: 'create-canvas', labelKey: 'modal.palette.actions.createCanvas', icon: Plus, groupKey: 'modal.palette.groups.actions' },
  // 홈 '+ 만들기'(QuickCreate)와 같은 목록 — Layout이 layout:create-* 이벤트로 모달을 연다.
  { id: 'create-track', labelKey: 'modal.palette.actions.createTrack', icon: Plus, groupKey: 'modal.palette.groups.actions' },
  { id: 'create-scrum', labelKey: 'modal.palette.actions.createScrum', icon: Plus, groupKey: 'modal.palette.groups.actions' },
  { id: 'logout', labelKey: 'auth.signOut', icon: LogOut, groupKey: 'modal.palette.groups.account' },
];

// --- 공간 ---
// 사이드바·앱 홈이 쓰는 목록 API(내가 멤버이고 아카이브되지 않은 공간)를 그대로 쓴다.
// hiddenKey는 개인 숨김(ui_prefs.hidden)의 네임스페이스, path는 공간 홈 경로.
const SPACE_SOURCES = [
  { kind: 'branch', url: '/branches', listKey: 'branches', idKey: 'branch_id', nameKey: 'branch_name', hiddenKey: 'branches', path: '/branch' },
  { kind: 'canvas', url: '/canvases', listKey: 'canvases', idKey: 'canvas_id', nameKey: 'canvas_name', hiddenKey: 'canvases', path: '/canvas' },
  { kind: 'track', url: '/tracks', listKey: 'tracks', idKey: 'track_id', nameKey: 'track_name', hiddenKey: 'tracks', path: '/tracks' },
  { kind: 'scrum', url: '/scrum', listKey: 'boards', idKey: 'board_id', nameKey: 'name', hiddenKey: 'scrums', path: '/scrum' },
];

const EMPTY_RESULTS = { tasks: [], docs: [], issues: [] };

// 헤더 관리자 메뉴·/admin 가드와 같은 출처(로그인 때 심는 sessionStorage profile)로 판단한다.
function readIsAdmin() {
  try { return JSON.parse(sessionStorage.getItem('profile') || '{}').role === 'admin'; }
  catch { return false; }
}

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
  const [isAdmin] = useState(readIsAdmin);

  // 최근 항목
  const [recentItems, setRecentItems] = useState([]);

  // 내 공간(브랜치·캔버스·트랙·스크럼) — 검색어로 클라이언트에서 거른다
  const [spaces, setSpaces] = useState([]);

  // 검색 결과
  const [searchResults, setSearchResults] = useState(EMPTY_RESULTS);
  const [searching, setSearching] = useState(false);

  const isSearchMode = query.trim().length >= 2;

  // 마운트 시 인풋 포커스 + 최근 항목·공간 fetch
  useEffect(() => {
    inputRef.current?.focus();
    fetchRecent();
    fetchSpaces();
  }, []);

  const fetchRecent = async () => {
    try {
      const res = await axios.get('/recent-views', { params: { limit: 5 } });
      if (res.data.status) setRecentItems(res.data.items || []);
    } catch {}
  };

  // 한 목록이 실패해도 나머지 공간은 보여 준다.
  const fetchSpaces = async () => {
    const lists = await Promise.all(SPACE_SOURCES.map((src) => axios.get(src.url)
      .then((res) => (res.data.status ? res.data[src.listKey] || [] : []).map((s) => ({
        kind: src.kind,
        id: s[src.idKey],
        name: s[src.nameKey] || '',
        key: s.key || null,
        icon: s.icon,
        color: s.color,
        hiddenKey: src.hiddenKey,
        href: `${src.path}/${s[src.idKey]}`,
      })))
      .catch(() => [])));
    setSpaces(lists.flat());
  };

  // 검색 모드: 디바운스 API 호출
  useEffect(() => {
    if (!isSearchMode) {
      setSearchResults(EMPTY_RESULTS);
      setSearching(false);
      return;
    }

    // 이전 검색어의 결과는 바로 비우고, 검색어가 바뀐 뒤 도착한 옛 응답은 버린다 —
    // Enter가 지금 검색어가 아닌 결과(예: 'WV-12'를 쳤는데 'WV-1'의 결과)를 열지 않게.
    let stale = false;
    setSearchResults(EMPTY_RESULTS);
    setSearching(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const q = query.trim();
        const [tasksRes, docsRes, issuesRes] = await Promise.all([
          axios.get('/chat/task-search', { params: { q, mode: 'all' } }),
          axios.get('/chat/doc-search', { params: { q } }),
          axios.get('/chat/issue-search', { params: { q } }),
        ]);
        if (stale) return;
        // 결과는 명령·공간 뒤에 붙으므로 앞 항목의 번호가 바뀌지 않는다 — 응답 전에 고른 선택을 유지한다.
        setSearchResults({
          tasks: tasksRes.data.status ? tasksRes.data.tasks || [] : [],
          docs: docsRes.data.status ? docsRes.data.docs || [] : [],
          issues: issuesRes.data.status ? issuesRes.data.issues || [] : [],
        });
      } catch {}
      if (!stale) setSearching(false);
    }, 300);

    return () => { stale = true; clearTimeout(timerRef.current); };
  }, [query]);

  // --- flat items 리스트 생성 ---
  const { groups, flatItems } = useMemo(() => {
    const taskVisible = (x) => !isHidden('branches', x.branch_id);
    const docVisible = (x) => !isHidden('canvases', x.canvas_id);
    if (isSearchMode) {
      const q = query.trim().toLowerCase();
      return buildSearchGroups({
        spaces: spaces.filter((s) => !isHidden(s.hiddenKey, s.id)
          && (s.name.toLowerCase().includes(q) || (s.key || '').toLowerCase().includes(q))),
        tasks: searchResults.tasks.filter(taskVisible),
        docs: searchResults.docs.filter(docVisible),
        issues: searchResults.issues.filter(taskVisible),
      }, query, isAdmin, t);
    }
    const visibleRecent = recentItems.filter((r) =>
      r.type === 'task' ? taskVisible(r) : docVisible(r)
    );
    return buildCommandGroups(visibleRecent, query, isAdmin, t);
  }, [isSearchMode, searchResults, spaces, recentItems, query, isHidden, isAdmin, t]);

  // 키보드 네비게이션
  const handleKeyDown = (e) => {
    // 한글 조합을 끝내는 Enter가 맨 위 명령 실행으로 새지 않게 (레포 컨벤션, useRefSearchPopup과 같음)
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      // 목록이 빈 동안(검색 응답 전) 눌러도 -1로 내려가지 않게 0에서 멈춘다.
      setActiveIndex((prev) => Math.max(0, Math.min(prev + 1, flatItems.length - 1)));
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
    if (item.type === 'space') return item.data.href;
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
      case 'create-track':
        onClose();
        window.dispatchEvent(new Event('layout:create-track'));
        break;
      case 'create-scrum':
        onClose();
        window.dispatchEvent(new Event('layout:create-scrum'));
        break;
      case 'logout':
        // 이 기기 푸시 구독의 서버 삭제는 로그인이 필요하다 → /auth/logout은 그 뒤에 보낸다(Header와 같은
        // 순서). 화면 정리·이동은 지금처럼 네트워크를 기다리지 않는다.
        unsubscribeFromPush()
          .then(() => axios.post('/auth/logout'))
          .catch(() => {});
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
          {/* 명령·공간은 검색 응답을 기다리지 않고 바로 보인다 — 로딩 문구는 그 아래에 붙는다. */}
          {groups.map((group) => (
            <div key={group.label} className="CommandPalette__Group">
              <div className="CommandPalette__GroupLabel">{group.label}</div>
              {group.items.map((item) => {
                // Navigation items: recent-task, recent-doc, space, search-task, search-doc, search-issue
                // Action items with routes: nav-dashboard, nav-my-tasks, nav-browse, nav-profile, nav-admin
                // Command actions (create, logout): stay as button
                const href = getItemHref(item);

                if (!href) {
                  // 네비게이션이 아닌 항목 (create-*, logout)
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
          ))}
          {searching ? (
            <div className="CommandPalette__Loading">{t('modal.palette.searching')}</div>
          ) : flatItems.length === 0 && (
            <div className="CommandPalette__Empty">{t('modal.palette.noResults')}</div>
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
    case 'space':
      return (
        <>
          <EntityIcon
            icon={item.data.icon}
            color={item.data.color}
            size={14}
            entityType={item.data.kind}
            className="CommandPalette__ItemIcon"
          />
          <span className="CommandPalette__ItemLabel">{item.data.name}</span>
          {item.data.key && <span className="CommandPalette__ItemId">{item.data.key}</span>}
          <span className="CommandPalette__ItemMeta">{t(`layout.appSwitcher.apps.${item.data.kind}`)}</span>
        </>
      );
    default:
      return null;
  }
}

// --- Command 모드 그룹 빌드 ---
function buildCommandGroups(recentItems, query, isAdmin, t) {
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
  const q = query.trim().toLowerCase();
  const localized = ACTIONS
    .filter((a) => !a.adminOnly || isAdmin)
    .map((a) => ({ ...a, label: t(a.labelKey), group: t(a.groupKey) }));
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
// 순서: 맞는 명령 → 공간 → 태스크 → 문서 → 이슈. 명령·공간은 클라이언트에서 거르므로
// 검색 응답 전에도 보이고, 검색 결과는 그 뒤에 붙어 앞 항목의 번호를 바꾸지 않는다.
function buildSearchGroups(results, query, isAdmin, t) {
  const { groups, flatItems } = buildCommandGroups([], query, isAdmin, t);
  let flatIndex = flatItems.length;

  if (results.spaces.length > 0) {
    const items = results.spaces.map((s) => {
      const item = { type: 'space', key: `space-${s.kind}-${s.id}`, data: s, flatIndex: flatIndex++ };
      flatItems.push(item);
      return item;
    });
    groups.push({ label: t('modal.palette.groups.spaces'), items });
  }

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

  return { groups, flatItems };
}
