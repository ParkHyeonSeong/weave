import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import TrackHeader from './TrackHeader';
import SourcePickerSidebar from './SourcePicker/SourcePickerSidebar';
import TrackFlowCanvas from './Flow/TrackFlowCanvas';
import TrackTimeline from './Timeline/TrackTimeline';
import TrackTree from './Tree/TrackTree';
import TrackItemDetail from './Detail/TrackItemDetail';
import BulkAddModal from './BulkAddModal';
import { showToast } from '@/components/Layout/Toast';
import { getErrorCode, getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { WORKFLOW_STATUSES, getBranchDistribution } from './mockData';
import { useTranslation } from 'react-i18next';

// 서버 hydrated item → 컴포넌트가 기대하는 형태로 정규화
function normalizeItem(raw) {
  const base = {
    item_id: raw.item_id,
    source_type: raw.source_type,
    position: { x: raw.position_x || 0, y: raw.position_y || 0 },
    layer_id: raw.layer_id,
    virtual_parent_id: raw.virtual_parent_id,
  };
  if (raw.restricted === true) {
    return { ...base, restricted: true, restricted_hint: raw.restricted_hint };
  }
  return {
    ...base,
    restricted: false,
    task_id: raw.task_id,
    branch_id: raw.branch_id,
    branch_key: raw.branch_key,
    branch_color: raw.branch_color,
    branch_name: raw.branch_name,
    display_id: raw.display_id,
    title: raw.title,
    status: raw.status,
    status_label: raw.status_label,
    status_color: raw.status_color,
    status_category: raw.status_category,
    priority: raw.priority,
    start_date: raw.start_date,
    due_date: raw.due_date,
    assignees: (raw.assignees || []).map((a) => ({
      user_id: a.user_id,
      username: a.username,
      avatar_url: a.avatar_url,
      avatar_color: a.avatar_color,
      role: a.role,
    })),
    description: raw.description || '',
    other_tracks: raw.other_tracks || [],
    parent: raw.parent || null,
    subtask_total: raw.subtask_total || 0,
    subtask_done: raw.subtask_done || 0,
  };
}

export default function TrackDetail() {
  const { t } = useTranslation();
  const router = useRouter();
  // router.isReady 전까지 query.id는 undefined — 첫 렌더에서 NaN 만들어지지 않게 가드
  const trackId = router.isReady ? Number(router.query.id) : null;

  const [track, setTrack] = useState(null);
  const [participatingBranches, setParticipatingBranches] = useState([]);
  const [members, setMembers] = useState([]);
  const [allBranches, setAllBranches] = useState([]); // BulkAddModal branch dropdown용
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [items, setItems] = useState([]);
  const [links, setLinks] = useState([]);

  const [selectedItemId, setSelectedItemId] = useState(null);
  // viewMode 초기값은 'flow'. trackId 결정 후 localStorage에서 복원.
  const [viewMode, setViewMode] = useState('flow');
  const [edgeType, setEdgeType] = useState('flow_to');
  const [materializeOnCreate, setMaterializeOnCreate] = useState(true);
  const [bulkAddMode, setBulkAddMode] = useState(null);  // null | 'epic' | 'sprint' | 'filter'

  // debounced position save용 ref
  const positionSaveTimer = useRef(null);
  const pendingPositions = useRef(new Map());

  // SourcePicker 재조회 트리거: items add/remove마다 +1
  const [sourceReloadKey, setSourceReloadKey] = useState(0);

  // -- 초기 로드 -----------------------------------------------------------
  const fetchTrack = useCallback(async () => {
    if (!router.isReady || !trackId) return;
    try {
      const [trackRes, membersRes, branchesRes, itemsRes, linksRes] = await Promise.all([
        axios.get(`/tracks/${trackId}`),
        axios.get(`/tracks/${trackId}/members`),
        axios.get('/branches'),
        axios.get(`/tracks/${trackId}/items`),
        axios.get(`/tracks/${trackId}/links`),
      ]);
      if (trackRes.data.status) {
        setTrack(trackRes.data.track);
        setParticipatingBranches(trackRes.data.track.participating_branches || []);
      } else {
        setNotFound(true);
      }
      if (membersRes.data.status) setMembers(membersRes.data.members);
      if (branchesRes.data.status) setAllBranches(branchesRes.data.branches);
      if (itemsRes.data.status) {
        setItems(itemsRes.data.items.map(normalizeItem));
      }
      if (linksRes.data.status) setLinks(linksRes.data.links);
    } catch {
      setNotFound(true);
    }
    setLoading(false);
  }, [router.isReady, trackId]);

  useEffect(() => {
    fetchTrack();
  }, [fetchTrack]);

  // track:updated 이벤트 수신 (헤더 appearance/일반 설정 변경 반영)
  useEffect(() => {
    if (!trackId) return;
    const handler = () => fetchTrack();
    window.addEventListener('track:updated', handler);
    return () => window.removeEventListener('track:updated', handler);
  }, [trackId, fetchTrack]);

  // task:updated 수신 — Branch에서 하위 전환/승격 등 task 변경 시 items·트리 재동기화.
  // (같은 탭 이벤트 — Branch 목록들의 기존 구독과 동일 패턴)
  useEffect(() => {
    if (!trackId) return;
    const handler = () => {
      fetchTrack();
      setSourceReloadKey((k) => k + 1);
    };
    window.addEventListener('task:updated', handler);
    return () => window.removeEventListener('task:updated', handler);
  }, [trackId, fetchTrack]);

  // trackId가 결정되면 마지막으로 본 view를 localStorage에서 복원
  useEffect(() => {
    if (!trackId) return;
    try {
      const saved = localStorage.getItem(`track:${trackId}:lastView`);
      if (saved === 'flow' || saved === 'timeline' || saved === 'tree') {
        setViewMode(saved);
      }
    } catch {}
  }, [trackId]);

  const handleViewModeChange = useCallback((next) => {
    setViewMode(next);
    if (!trackId) return;
    try { localStorage.setItem(`track:${trackId}:lastView`, next); } catch {}
  }, [trackId]);

  const handleOpenSettings = useCallback(() => {
    if (trackId) router.push(`/tracks/${trackId}/settings`);
  }, [router, trackId]);

  // 마운트 해제 시 pending position 즉시 flush 안 함 (다음 fetch에서 서버 상태로 덮어씀)
  useEffect(() => () => {
    if (positionSaveTimer.current) clearTimeout(positionSaveTimer.current);
  }, []);

  // -- 파생 상태 ----------------------------------------------------------
  const selectedItem = useMemo(
    () => items.find((it) => it.item_id === selectedItemId) || null,
    [items, selectedItemId]
  );

  // participating branches를 한 형태(branch_id/name/key/color/icon)로 정규화 — 여러 곳에서 재사용
  const normalizedBranches = useMemo(
    () => participatingBranches.map((b) => ({
      branch_id: b.branch_id,
      name: b.display_name,
      key: b.branch_key,
      color: b.color,
      icon: b.icon,
    })),
    [participatingBranches]
  );

  // Bulk add는 branch를 participating으로 합류시키지 않으므로 canvas에 non-participating
  // branch task가 있을 수 있음. 그 경우 item이 갖고 있는 branch_* 필드로 fallback.
  const branchById = useMemo(() => {
    const map = {};
    normalizedBranches.forEach((b) => { map[b.branch_id] = b; });
    items.forEach((it) => {
      if (it.restricted || !it.branch_id || map[it.branch_id]) return;
      map[it.branch_id] = {
        branch_id: it.branch_id,
        name: it.branch_name || t('track.detail.unknownBranch'),
        key: it.branch_key || '?',
        color: it.branch_color || '#9CA3AF',
        icon: it.branch_icon || null,
      };
    });
    return map;
  }, [normalizedBranches, items, t]);

  const distribution = useMemo(
    () => getBranchDistribution(items, normalizedBranches),
    [items, normalizedBranches]
  );

  const membersForHeader = useMemo(
    () => members.map((m) => ({
      user_id: m.user_id,
      username: m.username,
      avatar_url: m.avatar_url,
      avatar_color: m.avatar_color,
      role: m.role,
    })),
    [members]
  );

  const itemsByBranchId = useMemo(() => {
    const m = new Map();
    items.forEach((it) => {
      if (it.restricted || !it.branch_id) return;
      m.set(it.branch_id, (m.get(it.branch_id) || 0) + 1);
    });
    return m;
  }, [items]);

  // -- Branch unparticipate (sidebar X 버튼) --------------------------------
  const handleUnparticipateBranch = useCallback(async (branchId, branchName) => {
    const itemCount = itemsByBranchId.get(branchId) || 0;
    const msg = itemCount > 0
      ? t('track.detail.unparticipateWithItems', { name: branchName, items: itemCount })
      : t('track.detail.unparticipateConfirm', { name: branchName });
    if (!window.confirm(msg)) return;
    try {
      const res = await axios.delete(`/tracks/${trackId}/branches/${branchId}`);
      if (!res.data?.status) {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('track.detail.removeBranchFailed');
        showToast(msg, 'error');
        return;
      }
      const [branchesRes, itemsRes, linksRes] = await Promise.all([
        axios.get(`/tracks/${trackId}/branches`),
        axios.get(`/tracks/${trackId}/items`),
        axios.get(`/tracks/${trackId}/links`),
      ]);
      if (branchesRes.data.status) setParticipatingBranches(branchesRes.data.branches);
      if (itemsRes.data.status) setItems(itemsRes.data.items.map(normalizeItem));
      if (linksRes.data.status) setLinks(linksRes.data.links);
      setSourceReloadKey((k) => k + 1);
    } catch {
      showToast(t('track.detail.removeBranchFailed'), 'error');
    }
  }, [trackId, itemsByBranchId, t]);

  // -- Items handlers -----------------------------------------------------

  // 동시 drop 시 응답이 뒤바뀌어 잘못된 item이 선택될 수 있음 → 시리얼화
  const dropQueueRef = useRef(Promise.resolve());

  const handleSourceDrop = useCallback((sourceItem, dropPosition) => {
    const next = dropQueueRef.current.then(async () => {
      try {
        const res = await axios.post(`/tracks/${trackId}/items`, {
          source_task_id: sourceItem.task_id,
          position_x: dropPosition.x,
          position_y: dropPosition.y,
        });
        if (!res.data.status) {
          const err = getError(res.data);
          const msg = errorText(err.code, err.category) ?? t('track.detail.addTaskFailed');
          window.dispatchEvent(new CustomEvent('toast', {
            detail: {
              message: msg,
              type: 'error',
            },
          }));
          return;
        }
        // 새 item을 fetch하기 전에 임시로 추가하면 race(즉시 drag) 위험.
        // 응답으로 받은 item_id 만으로 selection만 잡고, items 자체는 권위 있는 GET으로 교체.
        const [itemsRes, branchesRes] = await Promise.all([
          axios.get(`/tracks/${trackId}/items`),
          axios.get(`/tracks/${trackId}/branches`),
        ]);
        if (itemsRes.data.status) setItems(itemsRes.data.items.map(normalizeItem));
        if (branchesRes.data.status) setParticipatingBranches(branchesRes.data.branches);
        setSelectedItemId(res.data.item_id);
        setSourceReloadKey((k) => k + 1);
      } catch {}
    });
    dropQueueRef.current = next;
  }, [trackId, t]);

  const flushPositionsNow = useCallback(async () => {
    if (pendingPositions.current.size === 0) return;
    const positions = Array.from(pendingPositions.current.entries()).map(
      ([item_id, pos]) => ({ item_id, position_x: pos.x, position_y: pos.y })
    );
    pendingPositions.current.clear();
    try {
      await axios.patch(`/tracks/${trackId}/items/positions`, { positions });
    } catch {}
  }, [trackId]);

  const handleItemPositionChange = useCallback((itemId, position) => {
    // 낙관적 갱신
    setItems((prev) => prev.map((it) =>
      it.item_id === itemId ? { ...it, position } : it
    ));
    // 누적 후 debounced 저장
    pendingPositions.current.set(itemId, position);
    if (positionSaveTimer.current) clearTimeout(positionSaveTimer.current);
    positionSaveTimer.current = setTimeout(flushPositionsNow, 500);
  }, [flushPositionsNow]);

  const handleItemDelete = useCallback(async (itemId) => {
    // 낙관적 제거 + 실패 시 rollback을 위해 직전 상태 보관
    let snapshot;
    setItems((prev) => {
      snapshot = prev;
      return prev.filter((it) => it.item_id !== itemId);
    });
    if (selectedItemId === itemId) setSelectedItemId(null);
    try {
      const res = await axios.delete(`/tracks/${trackId}/items/${itemId}`);
      if (!res.data?.status) throw new Error(getErrorCode(res.data) ?? 'DELETE_FAILED');
      setSourceReloadKey((k) => k + 1);
    } catch (err) {
      // 롤백 + 사용자 알림
      if (snapshot) setItems(snapshot);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: t('track.detail.deleteItemFailed'), type: 'error' },
      }));
    }
  }, [trackId, selectedItemId, t]);

  const handleLinkCreate = useCallback(async (sourceItemId, targetItemId) => {
    if (sourceItemId === targetItemId) return;
    // 같은 페어 이미 있으면 skip (canvas onConnect는 reactflow가 자체 처리)
    const exists = links.some((l) =>
      l.source_item_id === sourceItemId
      && l.target_item_id === targetItemId
      && l.link_type === edgeType
    );
    if (exists) return;

    try {
      const res = await axios.post(`/tracks/${trackId}/links`, {
        source_item_id: sourceItemId,
        target_item_id: targetItemId,
        link_type: edgeType,
        materialize: edgeType === 'flow_to' ? materializeOnCreate : false,
      });
      if (!res.data.status) {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('track.detail.selfLinkFailed');
        window.dispatchEvent(new CustomEvent('toast', {
          detail: {
            message: msg,
            type: 'error',
          },
        }));
        return;
      }
      // 권위 있는 상태 재로드
      const linksRes = await axios.get(`/tracks/${trackId}/links`);
      if (linksRes.data.status) setLinks(linksRes.data.links);
      // materialize 요청했는데 서버에서 skip된 경우 사유별 안내
      if (materializeOnCreate && edgeType === 'flow_to' && !res.data.materialized && res.data.created) {
        const reasonKey = {
          CIRCULAR: 'track.detail.materializeSkipCircular',
          BRANCH_PERMISSION: 'track.detail.materializeSkipPermission',
          NOT_TASK_REF: 'track.detail.materializeSkipNotTask',
        }[res.data.skip_reason] || 'track.detail.materializeSkipDefault';
        const reasonText = t(reasonKey);
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: reasonText, type: 'info' },
        }));
      }
    } catch {}
  }, [trackId, links, edgeType, materializeOnCreate, t]);

  const handleLinkDelete = useCallback(async (linkId) => {
    let snapshot;
    setLinks((prev) => {
      snapshot = prev;
      return prev.filter((l) => l.link_id !== linkId);
    });
    try {
      const res = await axios.delete(`/tracks/${trackId}/links/${linkId}`);
      if (!res.data?.status) throw new Error(getErrorCode(res.data) ?? 'DELETE_FAILED');
    } catch {
      if (snapshot) setLinks(snapshot);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: t('track.detail.deleteLinkFailed'), type: 'error' },
      }));
    }
  }, [trackId, t]);

  // -- 렌더 ----------------------------------------------------------------
  if (loading) {
    return <div className="Track Track--loading">{t('common.state.loading')}</div>;
  }
  if (notFound || !track) {
    return (
      <div className="Track Track--notfound">
        <div className="Track__NotFoundTitle">{t('track.detail.notFound')}</div>
        <button className="Track__NotFoundBack" onClick={() => router.push('/tracks')}>
          ← {t('track.detail.backToTracks')}
        </button>
      </div>
    );
  }

  // BulkAddModal에 넘길 branch 전체 (사용자가 가입한 모든 branch)
  const allBranchesForModal = allBranches.map((b) => ({
    branch_id: b.branch_id,
    name: b.branch_name,
    key: b.key,
    color: b.color || '#5E6AD2',
  }));

  return (
    <div className="Track">
      <TrackHeader
        track={{
          track_id: track.track_id,
          track_name: track.track_name,
          description: track.description,
          color: track.color,
          icon: track.icon,
          my_role: track.my_role,
        }}
        members={membersForHeader}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        distribution={distribution}
        totalItems={items.filter((i) => !i.restricted).length}
        totalLinks={links.length}
        participatingBranches={normalizedBranches}
        onOpenSettings={handleOpenSettings}
      />

      <div className="Track__Body">
        <SourcePickerSidebar
          trackId={trackId}
          onBulkAdd={(mode) => setBulkAddMode(mode)}
          onUnparticipateBranch={handleUnparticipateBranch}
          reloadKey={sourceReloadKey}
        />

        <div className="Track__CanvasWrap">
          {viewMode === 'flow' && (
            <TrackFlowCanvas
              items={items}
              links={links}
              branchById={branchById}
              workflowStatuses={WORKFLOW_STATUSES}
              selectedItemId={selectedItemId}
              edgeType={edgeType}
              materializeOnCreate={materializeOnCreate}
              onSelectItem={setSelectedItemId}
              onSourceDrop={handleSourceDrop}
              onItemPositionChange={handleItemPositionChange}
              onLinkCreate={handleLinkCreate}
              onLinkDelete={handleLinkDelete}
              onItemDelete={handleItemDelete}
              onEdgeTypeChange={setEdgeType}
              onMaterializeChange={setMaterializeOnCreate}
            />
          )}
          {viewMode === 'timeline' && (
            <TrackTimeline
              items={items}
              links={links}
              branchById={branchById}
              workflowStatuses={WORKFLOW_STATUSES}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
            />
          )}
          {viewMode === 'tree' && (
            <TrackTree
              items={items}
              links={links}
              branchById={branchById}
              workflowStatuses={WORKFLOW_STATUSES}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
            />
          )}
        </div>

        <TrackItemDetail
          item={selectedItem}
          branch={selectedItem && !selectedItem.restricted ? branchById[selectedItem.branch_id] : null}
          workflowStatuses={WORKFLOW_STATUSES}
          onClose={() => setSelectedItemId(null)}
          onRemove={handleItemDelete}
        />
      </div>

      {bulkAddMode && (
        <BulkAddModal
          mode={bulkAddMode}
          trackId={trackId}
          allBranches={allBranchesForModal}
          onClose={() => setBulkAddMode(null)}
          onAdded={async () => {
            setBulkAddMode(null);
            // Bulk add는 branch 자동 합류 + scope marker — items와 branches 모두 refetch
            try {
              const [itemsRes, branchesRes] = await Promise.all([
                axios.get(`/tracks/${trackId}/items`),
                axios.get(`/tracks/${trackId}/branches`),
              ]);
              if (itemsRes.data.status) setItems(itemsRes.data.items.map(normalizeItem));
              if (branchesRes.data.status) setParticipatingBranches(branchesRes.data.branches);
              setSourceReloadKey((k) => k + 1);
            } catch {}
          }}
        />
      )}
    </div>
  );
}
