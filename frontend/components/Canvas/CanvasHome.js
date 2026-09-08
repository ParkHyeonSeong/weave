import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { FileText, FileEdit, Star } from 'lucide-react';
import { axios } from '@/library/_axios';
import EntityIcon from '@/components/common/EntityIcon';
import HomeHero from '@/components/Home/shared/HomeHero';
import StatTiles from '@/components/Home/shared/StatTiles';
import ContinueStrip from '@/components/Home/shared/ContinueStrip';
import HomeToolbar from '@/components/Home/shared/HomeToolbar';
import HomeSkeleton from '@/components/Home/shared/HomeSkeleton';
import HomeEmptyState from '@/components/Home/shared/HomeEmptyState';
import AppCard, { AvatarSet } from '@/components/Home/shared/AppCard';
import { useUiPrefs } from '@/library/UiPrefsContext';
import useHomeListControls from '@/library/useHomeListControls';
import { byTextAsc, byNumberDesc, byDateDesc, roleGroup } from '@/library/homeListControls';
import useContextMenu from '@/components/common/useContextMenu';
import ContextMenu from '@/components/common/ContextMenu';
import { buildSpaceMenu } from '@/components/Layout/spaceMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { showToast } from '@/components/Layout/Toast';
import { useTranslation } from 'react-i18next';
import { useDateFormat } from '@/hooks/useDateFormat';

const DEFAULT_DOC_COLOR = '#16A34A';

const getMyName = () => {
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    return profile.username || '';
  } catch {
    return '';
  }
};

// Low-alpha tint of a #RRGGBB hex for the icon box background.
const tintOf = (hex) => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return 'rgba(94,106,210,.10)';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},.12)`;
};

const createCanvas = () => window.dispatchEvent(new CustomEvent('layout:create-canvas'));
const openCommandPalette = () => window.dispatchEvent(new CustomEvent('layout:open-search'));

const buildCanvasControls = (t) => ({
  appKey: 'canvas',
  hiddenApp: 'canvases',
  idField: 'canvas_id',
  queryFields: ['canvas_name'],
  defaultView: 'grid',
  sortOptions: [
    { key: 'edited', label: t('canvas.home.sortEdited'), compare: byDateDesc('last_edited_at') },
    { key: 'name', label: t('canvas.home.sortName'), compare: byTextAsc('canvas_name') },
    { key: 'created', label: t('canvas.home.sortCreated'), compare: byDateDesc('created_at') },
    { key: 'pages', label: t('canvas.home.sortPages'), compare: byNumberDesc('page_count') },
  ],
  filterConfig: {
    groups: [
      roleGroup(t),
      {
        key: 'link', label: t('canvas.home.filterLinkLabel'), options: [
          { value: 'all', label: t('canvas.home.filterLinkAll'), test: () => true },
          { value: 'linked', label: t('canvas.home.filterLinkLinked'), test: (it) => it.branch_id != null },
          { value: 'standalone', label: t('canvas.home.filterLinkStandalone'), test: (it) => it.branch_id == null },
        ],
      },
    ],
    showHidden: true,
  },
});

export default function CanvasHome() {
  const { t } = useTranslation();
  const { formatRelative } = useDateFormat();
  const router = useRouter();
  const { isHidden, hide, unhide } = useUiPrefs();
  const ctx = useContextMenu();
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [canvases, setCanvases] = useState([]);
  const canvasControls = useMemo(() => buildCanvasControls(t), [t]);
  const { processed, view, query, toolbarProps } = useHomeListControls(canvasControls, canvases);
  const [recentDocs, setRecentDocs] = useState([]);
  const [starredDocs, setStarredDocs] = useState([]);
  const [stats, setStats] = useState(null);
  const [activeTab, setActiveTab] = useState('recent');
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState('');

  const fetchCanvases = async () => {
    try {
      const res = await axios.get('/canvases');
      if (res.data.status) setCanvases(res.data.canvases);
    } catch {}
  };

  const fetchWidgetData = async () => {
    try {
      const [recentRes, starRes] = await Promise.all([
        axios.get('/recent-views', { params: { type: 'doc', limit: 8 } }),
        axios.get('/stars', { params: { type: 'doc', limit: 8 } }),
      ]);
      if (recentRes.data.status) setRecentDocs(recentRes.data.items);
      if (starRes.data.status) setStarredDocs(starRes.data.items);
    } catch {}
  };

  const fetchStats = async () => {
    try {
      const res = await axios.get('/canvases/home-stats');
      if (res.data.status) setStats(res.data);
    } catch {}
  };

  useEffect(() => {
    setMe(getMyName());
    (async () => {
      await Promise.all([fetchCanvases(), fetchWidgetData(), fetchStats()]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const handleRefresh = () => fetchCanvases();
    window.addEventListener('canvas:created', handleRefresh);
    return () => window.removeEventListener('canvas:created', handleRefresh);
  }, []);

  const openCardMenu = (e, c) => {
    const id = c.canvas_id;
    const detailPath = `/canvas/${id}`;
    const settingsPath = `${detailPath}/settings`;
    ctx.open(e, buildSpaceMenu(
      {
        appType: 'canvas',
        id,
        name: c.canvas_name,
        role: c.my_role,
        isHidden: isHidden('canvases', id),
      },
      {
        open: () => router.push(detailPath),
        openNewTab: () => window.open(detailPath, '_blank'),
        settings: () => router.push(settingsPath),
        rename: () => router.push(settingsPath),
        members: () => router.push(settingsPath),
        toggleHide: () => (isHidden('canvases', id) ? unhide('canvases', id) : hide('canvases', id)),
        archive: async () => {
          try {
            const res = await axios.delete(`/canvases/${id}`);
            if (res.data.status) {
              fetchCanvases();
              window.dispatchEvent(new Event('canvas:created'));
              showToast(t('sidebar.archived', { name: c.canvas_name }));
            } else {
              showToast(t('sidebar.archiveFailed'), 'error');
            }
          } catch {}
        },
        leave: () => setLeaveTarget({ id, name: c.canvas_name }),
      }, t));
  };

  const stripDocs = activeTab === 'starred' ? starredDocs : recentDocs;
  const stripItems = stripDocs.map((it) => ({
    title: it.title,
    dotColor: it.color || DEFAULT_DOC_COLOR,
    meta: `${it.canvas_name} · ${formatRelative(it.viewed_at || it.starred_at)}`,
    href: `/canvas/${it.canvas_id}/${it.page_id}`,
  }));

  return (
    <>
    <div className="HomeMain">
      <HomeHero
        greeting={me ? t('canvas.home.greeting', { name: me }) : t('canvas.home.greetingAnonymous')}
        summary={stats && (
          <>
            {t('canvas.home.summaryEdited')} <b>{stats.edited_this_week}</b> · {t('canvas.home.summaryStarred')}{' '}
            <b>{stats.starred_count}</b>
          </>
        )}
        actions={
          <>
            <button className="HBtn HBtn--sm" onClick={openCommandPalette}>
              {t('canvas.home.quickJump')}
            </button>
            <button className="HBtn HBtn--sm" onClick={() => router.push('/canvas/archive')}>
              {t('canvas.home.archive')}
            </button>
            <button className="HBtn HBtn--pri HBtn--sm" onClick={createCanvas}>
              {t('canvas.home.newDoc')}
            </button>
          </>
        }
      />

      <StatTiles
        loading={!stats}
        tiles={stats ? [
          { icon: <FileText size={16} />, label: t('canvas.home.statTotalDocs'), value: stats.total_docs, tone: 'doc' },
          { icon: <FileEdit size={16} />, label: t('canvas.home.statEditedThisWeek'), value: stats.edited_this_week, tone: 'primary' },
          { icon: <Star size={16} />, label: t('canvas.home.statStarredDocs'), value: stats.starred_count, tone: 'warn' },
        ] : []}
      />

      <ContinueStrip
        title={t('canvas.home.continueTitle')}
        tabs={[
          { key: 'recent', label: t('canvas.home.tabRecent') },
          { key: 'starred', label: t('canvas.home.tabStarred') },
        ]}
        activeTab={activeTab}
        onTab={setActiveTab}
        loading={loading}
        items={stripItems}
        emptyText={activeTab === 'starred' ? t('canvas.home.emptyStarred') : t('canvas.home.emptyRecent')}
      />

      <div className="HomeDivider" />

      <HomeToolbar
        count={t('canvas.home.canvasCount', { count: processed.length })}
        placeholder={t('canvas.home.searchPlaceholder')}
        {...toolbarProps}
      />

      {loading ? (
        <HomeSkeleton variant="cards" />
      ) : processed.length === 0 ? (
        <HomeEmptyState
          icon={<FileText size={26} />}
          title={canvases.length === 0 ? t('canvas.home.emptyTitle') : (query.trim() ? t('canvas.home.emptyNoResults') : t('canvas.home.emptyNoneToShow'))}
          desc={
            canvases.length === 0
              ? t('canvas.home.emptyDesc')
              : t('canvas.home.emptyQueryDesc', { query })
          }
          ctaLabel={canvases.length === 0 ? t('canvas.home.emptyCta') : undefined}
          onCta={createCanvas}
        />
      ) : (
        <div className={view === 'list' ? 'HList' : 'HGrid'}>
          {processed.map((c) => (
            <AppCard
              key={c.canvas_id}
              accent={c.color}
              href={`/canvas/${c.canvas_id}`}
              onContextMenu={(e) => openCardMenu(e, c)}
            >
              <div className="HCard__Top">
                <div className="HCard__IconBox" style={{ background: tintOf(c.color) }}>
                  <EntityIcon icon={c.icon} color={c.color} size={24} entityType="canvas" />
                </div>
                <div>
                  <div className="HCard__Title">{c.canvas_name}</div>
                  <div className="HCard__Desc">{c.description}</div>
                </div>
              </div>
              <div className="HCard__Foot">
                <span className="HChip HChip--doc">{t('canvas.home.pageCount', { count: c.page_count ?? 0 })}</span>
                <AvatarSet members={c.contributors || []} />
              </div>
              {c.last_edited_at && (
                <div className="CanvasHome__Edited">
                  {t('canvas.home.editedAgo', { time: formatRelative(c.last_edited_at) })}
                </div>
              )}
            </AppCard>
          ))}
        </div>
      )}
    </div>

      <ContextMenu {...ctx.props} />
      <ConfirmModal
        isOpen={!!leaveTarget}
        onClose={() => setLeaveTarget(null)}
        onConfirm={async () => {
          const target = leaveTarget;
          setLeaveTarget(null);
          try {
            const res = await axios.post(`/canvases/${target.id}/leave`);
            if (res.data.status) {
              fetchCanvases();
              window.dispatchEvent(new Event('canvas:created'));
            } else {
              showToast(t('sidebar.leaveFailed'), 'error');
            }
          } catch {}
        }}
        title={t('sidebar.leaveCanvasTitle')}
        message={t('sidebar.leaveConfirm', { name: leaveTarget?.name })}
        confirmLabel={t('sidebar.leave')}
        variant="danger"
      />
    </>
  );
}
