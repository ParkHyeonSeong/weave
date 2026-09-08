import { useCallback, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getAppContext } from '@/library/appContext';
import { useUiPrefs } from '@/library/UiPrefsContext';
import SidebarBranches from './SidebarBranches';
import SidebarCanvases from './SidebarCanvases';
import SidebarTracks from './SidebarTracks';
import SidebarScrums from './SidebarScrums';

export default function Sidebar({ isMobile, width, onResizeStart, onCreateBranch, onCreateCanvas, onCreateTrack, onCreateScrum, onClose }) {
  const { t } = useTranslation();
  const router = useRouter();
  const activeApp = getAppContext(router.pathname);
  const { prefs, setNamespace, hide, unhide } = useUiPrefs();
  const sidebarOrder = prefs.sidebar_order;
  const hidden = prefs.hidden || {};

  // 순서 변경 핸들러 (네임스페이스 통째 교체 → 낙관적 업데이트 + 서버 저장)
  const handleOrderChange = useCallback((key, ids) => {
    setNamespace('sidebar_order', { ...(prefs.sidebar_order || {}), [key]: ids });
  }, [prefs.sidebar_order, setNamespace]);

  // 현재 브랜치의 고정한 뷰 (per-user 핀 + 서버 뷰 목록 매핑, 삭제된 뷰는 제외)
  const branchId = activeApp === 'branch' ? router.query.id : null;
  const [branchViews, setBranchViews] = useState([]);
  const loadBranchViews = useCallback(() => {
    if (!branchId) { setBranchViews([]); return Promise.resolve(); }
    return axios.get('/saved-views', { params: { scope_branch_id: branchId } })
      .then((res) => setBranchViews(res.data?.status ? (res.data.views || []) : []))
      .catch(() => setBranchViews([]));
  }, [branchId]);
  useEffect(() => { loadBranchViews(); }, [loadBranchViews]);
  // 뷰 저장/삭제 시 핀 목록 동기화(TaskList가 발행)
  useEffect(() => {
    const h = () => loadBranchViews();
    window.addEventListener('saved-views:changed', h);
    return () => window.removeEventListener('saved-views:changed', h);
  }, [loadBranchViews]);
  const pinnedViews = useMemo(() => {
    const ids = (branchId && prefs.saved_view_pins?.[String(branchId)]) || [];
    const map = new Map(branchViews.map((v) => [v.view_id, v]));
    return ids.map((vid) => map.get(vid)).filter(Boolean);
  }, [branchId, prefs.saved_view_pins, branchViews]);

  return (
    <aside
      className={`Sidebar ${isMobile ? 'Sidebar--mobile' : ''}`}
      style={isMobile ? undefined : { width }}
    >
      <div className="Sidebar__Inner">
        {/* 모바일: 닫기 버튼 */}
        {isMobile && (
          <div className="Sidebar__MobileHeader">
            <span className="Sidebar__MobileTitle">{t('common.actions.menu')}</span>
            <button className="Sidebar__CloseBtn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        )}

        {/* 현재 앱의 콘텐츠 섹션만 렌더 (Layout이 앱 컨텍스트에서만 Sidebar를 렌더함) */}
        {activeApp === 'branch' && (
          <SidebarBranches
            onCreateBranch={onCreateBranch}
            savedOrder={sidebarOrder?.branches}
            onOrderChange={(ids) => handleOrderChange('branches', ids)}
            hidden={hidden.branches}
            onHide={(id) => hide('branches', id)}
            onUnhide={(id) => unhide('branches', id)}
            pinnedViews={pinnedViews}
            currentBranchId={branchId}
          />
        )}
        {activeApp === 'canvas' && (
          <SidebarCanvases
            onCreateCanvas={onCreateCanvas}
            savedOrder={sidebarOrder?.canvases}
            onOrderChange={(ids) => handleOrderChange('canvases', ids)}
            hidden={hidden.canvases}
            onHide={(id) => hide('canvases', id)}
            onUnhide={(id) => unhide('canvases', id)}
          />
        )}
        {activeApp === 'track' && (
          <SidebarTracks
            onCreateTrack={onCreateTrack}
            savedOrder={sidebarOrder?.tracks}
            onOrderChange={(ids) => handleOrderChange('tracks', ids)}
            hidden={hidden.tracks}
            onHide={(id) => hide('tracks', id)}
            onUnhide={(id) => unhide('tracks', id)}
          />
        )}
        {activeApp === 'scrum' && (
          <SidebarScrums
            onCreateScrum={onCreateScrum}
            savedOrder={sidebarOrder?.scrums}
            onOrderChange={(ids) => handleOrderChange('scrums', ids)}
            hidden={hidden.scrums}
            onHide={(id) => hide('scrums', id)}
            onUnhide={(id) => unhide('scrums', id)}
          />
        )}
      </div>

      {/* 리사이즈 핸들 (모바일에서 숨김) */}
      {!isMobile && (
        <div
          className="Sidebar__ResizeHandle"
          onMouseDown={onResizeStart}
        />
      )}
    </aside>
  );
}
