import i18next from '@/library/i18n';
import { useEffect } from 'react';
import { axios } from '@/library/_axios';
import { attachRefChipAuxNav } from '@/library/refUrl';
import { entityTintStyle } from '@/library/entityTint';

// 인라인 ref 칩(taskRef/docRef/issueRef/mention) 라이브 하이드레이션.
// 칩 attrs는 삽입 시점 스냅샷(폴백)이고, 표면이 마운트될 때마다 /ref-status로
// 최신 제목·상태를 받아 DOM을 패치한다 (컨플루언스 Smart Link 모델).
// 응답에 없는 ID는 삭제일 수도, 권한 밖(비멤버 branch/canvas)일 수도 있으므로
// 칩의 branch/canvas id를 내 멤버십과 대조해 '삭제 확정'만 표기한다.

const TTL_MS = 30_000;
const cache = new Map(); // 'tasks:1' → { data, at }

// 내가 멤버인 브랜치/캔버스 id 집합 — '삭제 확정' 판정용 (TTL 공유).
// /ref-status batch 쿼리와 동일한 멤버십 스코프(branch_member/canvas_member INNER JOIN)라
// "멤버인 곳의 칩이 응답에서 누락 = 삭제"가 성립한다. 누락 칩이 있을 때만 lazy fetch.
let membershipsAt = 0;
let myBranchIds = null; // Set<string>
let myCanvasIds = null;
let membershipPromise = null; // in-flight 가드 — 동시 마운트 시 중복 fetch 방지

async function ensureMemberships() {
  if (myBranchIds && Date.now() - membershipsAt < TTL_MS) return;
  if (!membershipPromise) {
    membershipPromise = (async () => {
      try {
        const [br, cv] = await Promise.all([
          axios.get('/branches').catch(() => null),
          axios.get('/canvases').catch(() => null),
        ]);
        // 요청 실패 시 빈 집합 → 전부 '권한 밖' 취급(정상 표시) — 오표기보다 미표기가 안전
        myBranchIds = new Set((br?.data?.branches || []).map((b) => String(b.branch_id)));
        myCanvasIds = new Set((cv?.data?.canvases || []).map((c) => String(c.canvas_id)));
        membershipsAt = Date.now();
      } finally {
        membershipPromise = null;
      }
    })();
  }
  return membershipPromise;
}

function cacheGet(kind, id) {
  const key = `${kind}:${id}`;
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(kind, map) {
  const at = Date.now();
  Object.entries(map || {}).forEach(([id, data]) => cache.set(`${kind}:${id}`, { data, at }));
}

// root(DOM) 안의 칩들에서 종류별 ID 수집
function collectRefIds(root) {
  const ids = { task_ids: new Set(), issue_ids: new Set(), page_ids: new Set(), user_ids: new Set() };
  root.querySelectorAll('[data-task-ref]').forEach((el) => {
    const id = Number(el.getAttribute('data-task-id'));
    if (id) ids.task_ids.add(id);
  });
  root.querySelectorAll('[data-issue-ref]').forEach((el) => {
    const id = Number(el.getAttribute('data-issue-id'));
    if (id) ids.issue_ids.add(id);
  });
  root.querySelectorAll('[data-doc-ref]').forEach((el) => {
    const id = Number(el.getAttribute('data-page-id'));
    if (id) ids.page_ids.add(id);
  });
  root.querySelectorAll('[data-mention]').forEach((el) => {
    const id = Number(el.getAttribute('data-user-id'));
    if (id) ids.user_ids.add(id);
  });
  return ids;
}

// /ref-status single-flight — readonly 표면 N개 동시 마운트나 이벤트 무효화 직후
// 캐시가 비어 N발의 POST가 나가던 것을, 진행 중 요청을 먼저 기다렸다가
// 캐시를 다시 본 뒤 남은 miss만 새로 요청해 1~2발로 수렴시킨다.
let inflightFetch = null;

// 캐시 미스만 골라 배치 요청 → { tasks, issues, pages, users } (캐시 병합본)
async function resolveRefs(ids) {
  const want = {
    tasks: [...ids.task_ids], issues: [...ids.issue_ids],
    pages: [...ids.page_ids], users: [...ids.user_ids],
  };
  const out = { tasks: {}, issues: {}, pages: {}, users: {} };
  const collectMiss = () => {
    const miss = { task_ids: [], issue_ids: [], page_ids: [], user_ids: [] };
    const pick = (kind, list, missKey) => {
      list.forEach((id) => {
        const hit = cacheGet(kind, id);
        if (hit) out[kind][id] = hit;
        else miss[missKey].push(id);
      });
    };
    pick('tasks', want.tasks, 'task_ids');
    pick('issues', want.issues, 'issue_ids');
    pick('pages', want.pages, 'page_ids');
    pick('users', want.users, 'user_ids');
    return miss;
  };
  const hasMiss = (m) => m.task_ids.length || m.issue_ids.length || m.page_ids.length || m.user_ids.length;

  let miss = collectMiss();
  while (hasMiss(miss) && inflightFetch) {
    await inflightFetch.catch(() => {});
    miss = collectMiss();
  }
  if (hasMiss(miss)) {
    const req = axios.post('/ref-status', miss).finally(() => {
      if (inflightFetch === req) inflightFetch = null;
    });
    inflightFetch = req;
    const res = await req;
    if (res.data.status) {
      ['tasks', 'issues', 'pages', 'users'].forEach((kind) => {
        cacheSet(kind, res.data[kind]);
        Object.assign(out[kind], res.data[kind]);
      });
    }
  }
  return out;
}

// 칩 첫 텍스트 노드 교체 (displayId·title 갱신)
function setChipText(el, text) {
  if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) {
    el.firstChild.nodeValue = text;
  }
}

// 서버 응답 값이 className에 그대로 보간되므로 화이트리스트로 방어
const SAFE_CATEGORIES = new Set(['todo', 'in_progress', 'done', 'cancelled', 'open', 'closed']);

function setBadge(el, { category, label, color }) {
  el.querySelector('[data-ref-badge]')?.remove();
  const badge = document.createElement('span');
  const safeCategory = SAFE_CATEGORIES.has(category) ? category : 'todo';
  badge.className = `ref-chip__badge ref-chip__badge--${safeCategory}`;
  badge.textContent = label;
  // 배지 부모는 페이지 표면이 아니라 **ref 칩 자신의 배경**이다(--color-primary-subtle 합성).
  // 라이브 편집 경로(TaskRefExtension.addNodeView)와 같은 프로파일 — 어긋나면 두 경로 색이 갈린다.
  // Issue ref는 color:null로 들어와 tint가 undefined라 이 프로파일에 영향받지 않는다.
  const tint = entityTintStyle(color, { alpha: '20', surface: 'task-ref' });
  if (tint) {
    // 커스텀 프로퍼티는 존재하는 것만 내린다. passthrough 객체에는 `--et-*`가 아예 없어
    // 이 루프가 0회 돌고, CSSOM은 커스텀 프로퍼티를 항상 받아주므로 조용한 실패가 없다.
    for (const [k, v] of Object.entries(tint)) {
      if (k.startsWith('--')) badge.style.setProperty(k, v);
    }
    // 일반 선언은 supported·passthrough 둘 다 적용한다.
    badge.style.background = tint.background;   // themed 'var(--et-bg)' / passthrough `${color}20`
    badge.style.color = tint.color;             // themed 'var(--et-fg)' / passthrough 원 색
  }
  // ⛔ `if (tint)` 안에서 무조건 add 하면 passthrough 배지에도 EntityTint가 붙어
  //    다크에서 `var(--et-bg-dark, transparent)`가 이기고 오늘 살아 있던 색이 지워진다.
  //    판정은 --et-on 하나뿐이다. add가 아니라 toggle인 이유는 재하이드레이션 때문이다 —
  //    저장색이 지원 → 지원 밖으로 바뀐 배지에서 add만 쓰면 클래스가 남는다.
  badge.classList.toggle('EntityTint', !!tint?.['--et-on']);
  badge.setAttribute('data-ref-badge', 'true');
  el.appendChild(badge);
}

// 이슈 상태 라벨은 에디터 노드뷰(extensions/IssueRefExtension.js)와 같은 catalog 키를 쓴다 —
// 읽기 경로와 편집 경로가 같은 언어로 보여야 한다. React 밖이라 i18next 인스턴스를 직접 읽는다.
const issueLabel = (status) => {
  const key = `canvasExt.issueStatus.${status}`;
  return i18next.exists(key) ? i18next.t(key) : status;
};

// 미해석 칩 툴팁 카탈로그 키 — 문구는 현재 언어로 풀고, 우리가 쓴 title임은 data 속성으로 표시한다
// (언어가 바뀌어도 '우리 것만 제거' 판정이 문자열 비교에 묶이지 않게).
const DELETED_ITEM_TITLE = 'canvasExt.refChip.deletedItem';
const DELETED_DOC_TITLE = 'canvasExt.refChip.deletedDoc';
const GONE_USER_TITLE = 'canvasExt.refChip.goneUser';
const UNRESOLVED_TITLE_ATTR = 'data-ref-unresolved-title';

// 삭제 확정 칩 표기 토글. 캐시 만료 후 재해석에서 다시 살아나면 표기를 걷는다
// (title은 우리가 쓴 것만 제거 — doc 칩의 경로 툴팁 등은 보존).
function setUnresolved(el, unresolved, tooltipKey) {
  el.classList.toggle('ref-chip--unresolved', unresolved);
  if (unresolved) {
    el.title = i18next.t(tooltipKey);
    el.setAttribute(UNRESOLVED_TITLE_ATTR, 'true');
  } else if (el.hasAttribute(UNRESOLVED_TITLE_ATTR)) {
    el.removeAttribute('title');
    el.removeAttribute(UNRESOLVED_TITLE_ATTR);
  }
}

// 해석 결과를 root 안 칩 DOM에 반영 (data-* 속성도 갱신해 클릭/배지 재주입이 fresh 값을 읽게).
// 누락 칩은 멤버십과 대조해 '삭제 확정'(멤버인 곳)만 표기하고 권한 밖은 정상 모양 유지
// — 멤버십은 누락이 실제로 있을 때만 lazy fetch 하므로 async.
async function applyToDom(root, { tasks, issues, pages, users }) {
  if (!root.isConnected) return;
  const missingByBranch = []; // 누락 task/issue 칩 — data-branch-id 멤버십으로 판정
  const missingByCanvas = []; // 누락 doc 칩 — data-canvas-id 멤버십으로 판정
  root.querySelectorAll('[data-task-ref]').forEach((el) => {
    const info = tasks[el.getAttribute('data-task-id')];
    if (!info) {
      missingByBranch.push(el);
      return;
    }
    setUnresolved(el, false);
    setChipText(el, `${info.display_id} ${info.title}`);
    el.setAttribute('data-display-id', info.display_id);
    el.setAttribute('data-title', info.title);
    el.setAttribute('data-status', info.status);
    el.setAttribute('data-status-label', info.status_label || '');
    el.setAttribute('data-status-color', info.status_color || '');
    el.setAttribute('data-status-category', info.status_category || '');
    setBadge(el, {
      category: info.status_category || info.status,
      label: info.status_label || info.status,
      color: info.status_color,
    });
  });
  root.querySelectorAll('[data-issue-ref]').forEach((el) => {
    const info = issues[el.getAttribute('data-issue-id')];
    if (!info) {
      missingByBranch.push(el);
      return;
    }
    setUnresolved(el, false);
    const displayId = el.getAttribute('data-display-id') || '';
    setChipText(el, `${displayId} ${info.title}`);
    el.setAttribute('data-title', info.title);
    el.setAttribute('data-status', info.status);
    setBadge(el, { category: info.status, label: issueLabel(info.status), color: null });
  });
  root.querySelectorAll('[data-doc-ref]').forEach((el) => {
    const info = pages[el.getAttribute('data-page-id')];
    if (!info) {
      missingByCanvas.push(el);
      return;
    }
    setUnresolved(el, false);
    setChipText(el, info.title);
    el.setAttribute('data-title', info.title);
    el.setAttribute('data-canvas-name', info.canvas_name);
    el.title = `${info.canvas_name} > ${info.title}`;
  });
  root.querySelectorAll('[data-mention]').forEach((el) => {
    const info = users[el.getAttribute('data-user-id')];
    // mention은 권한 개념이 없으므로 누락 = 탈퇴/비활성 확정
    setUnresolved(el, !info, GONE_USER_TITLE);
    if (!info) return;
    setChipText(el, `@${info.username}`);
    el.setAttribute('data-username', info.username);
  });

  if (!missingByBranch.length && !missingByCanvas.length) return;
  await ensureMemberships();
  if (!root.isConnected) return;
  missingByBranch.forEach((el) => {
    // 멤버 브랜치의 누락 = 삭제 확정. 비멤버(또는 branch id 미상)는 권한 밖 → 정상 모양
    const deleted = myBranchIds.has(el.getAttribute('data-branch-id'));
    setUnresolved(el, deleted, DELETED_ITEM_TITLE);
  });
  missingByCanvas.forEach((el) => {
    // 멤버 캔버스의 누락 = 삭제 또는 보관 (batch_titles가 is_archived 페이지 제외)
    const deleted = myCanvasIds.has(el.getAttribute('data-canvas-id'));
    setUnresolved(el, deleted, DELETED_DOC_TITLE);
  });
}

// readonly 표면용: root 안의 칩 전부 해석·패치
async function hydrateDom(root) {
  if (!root) return;
  const ids = collectRefIds(root);
  if (!ids.task_ids.size && !ids.issue_ids.size && !ids.page_ids.size && !ids.user_ids.size) return;
  try {
    const data = await resolveRefs(ids);
    if (root.isConnected) await applyToDom(root, data);
  } catch {}
}

// 에디터 표면용: NodeView DOM을 같은 패처로 패치
export async function hydrateEditor(editor) {
  if (!editor || editor.isDestroyed) return;
  return hydrateDom(editor.view.dom);
}

// task:updated 등 이벤트 구동 재해석 시 TTL 캐시가 stale을 되돌려주지 않게 비운다.
// 멤버십 캐시도 함께 비워 브랜치 탈퇴 직후 30초간 '삭제 확정' 오표기를 막는다.
function invalidateRefCache() {
  cache.clear();
  myBranchIds = null;
  myCanvasIds = null;
  membershipsAt = 0;
}

// task:updated/issue:updated 모듈 단일 리스너 — 표면 N개가 각자 리스너를 달아
// 이벤트당 N회 invalidate+hydrate 하던 것을 invalidate 1회 + 구독자 알림으로 수렴.
// 훅 useEffect 안에서만 호출되므로 window 접근은 클라이언트에서만 일어난다.
const refreshSubscribers = new Set();
let listenersBound = false;

function subscribeRefresh(fn) {
  refreshSubscribers.add(fn);
  if (!listenersBound) {
    listenersBound = true;
    const onUpdate = () => {
      invalidateRefCache(); // 구독자 수와 무관하게 1회만
      refreshSubscribers.forEach((f) => f());
    };
    window.addEventListener('task:updated', onUpdate);
    window.addEventListener('issue:updated', onUpdate);
  }
  return () => refreshSubscribers.delete(fn);
}

// readonly 표면용 훅: 콘텐츠 변경 시 + task/issue 변경 이벤트 시 하이드레이션.
// deps는 호출부가 콘텐츠 의존성을 그대로 넘긴다.
// 주의: deps는 렌더 간 길이가 변하지 않는 고정 길이 배열이어야 한다(React hooks 규칙
// — spread로 useEffect deps에 들어가므로 길이가 변하면 훅 규칙 위반).
export function useRefHydration(ref, deps, enabled = true) {
  useEffect(() => {
    if (!enabled || !ref.current) return;
    hydrateDom(ref.current);
    // 칩 가운데/ctrl·cmd 클릭 → 전체 페이지를 새 탭으로 (칩은 <span>이라 네이티브 새 탭 불가)
    const detachAuxNav = attachRefChipAuxNav(ref.current);
    const unsubscribe = subscribeRefresh(() => {
      if (ref.current) hydrateDom(ref.current);
    });
    return () => {
      detachAuxNav();
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}

// 에디터(TipTap) 표면용 훅. collab(yjs) 에디터는 초기 동기화 대기용 delay를 준다.
export function useEditorRefHydration(editor, delay = 0) {
  useEffect(() => {
    if (!editor) return;
    const t = setTimeout(() => hydrateEditor(editor), delay);
    // 칩 가운데/ctrl·cmd 클릭 → 새 탭. 좌클릭(=NodeView 기본 동작인 태스크/문서 패널 열기)은 그대로 둔다.
    const detachAuxNav = attachRefChipAuxNav(editor.view?.dom);
    const unsubscribe = subscribeRefresh(() => hydrateEditor(editor));
    return () => {
      clearTimeout(t);
      detachAuxNav();
      unsubscribe();
    };
  }, [editor, delay]);
}

// fetch 전 즉시 표시용: 칩의 data-* 스냅샷 attrs로 배지를 주입한다
// (CanvasPageView/CanvasOverview 공용 — 구 인라인 구현 2벌 대체)
export function applyFallbackBadges(root) {
  if (!root) return;
  root.querySelectorAll('[data-task-ref]').forEach((el) => {
    const status = el.getAttribute('data-status') || 'todo';
    setBadge(el, {
      category: el.getAttribute('data-status-category') || status,
      label: el.getAttribute('data-status-label') || status,
      color: el.getAttribute('data-status-color') || null,
    });
  });
  root.querySelectorAll('[data-issue-ref]').forEach((el) => {
    const status = el.getAttribute('data-status') || 'open';
    setBadge(el, { category: status, label: issueLabel(status), color: null });
  });
}
