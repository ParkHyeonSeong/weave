import { useState, useEffect, useCallback } from 'react';
// useMemo는 위 import 줄에 합치지 않는다 — library/literalColorSweep.test.js가 그 줄을
// 정확한 문자열 앵커로 쓴다.
import { useMemo } from 'react';
import { useRouter } from 'next/router';
import { Workflow, GitBranch, Clock, AlarmClock } from 'lucide-react';
import { axios } from '@/library/_axios';
import HomeHero from '@/components/Home/shared/HomeHero';
import StatTiles from '@/components/Home/shared/StatTiles';
import HomeToolbar from '@/components/Home/shared/HomeToolbar';
import HomeSkeleton from '@/components/Home/shared/HomeSkeleton';
import HomeEmptyState from '@/components/Home/shared/HomeEmptyState';
import ProgressRing from '@/components/Home/shared/ProgressRing';
import { useUiPrefs } from '@/library/UiPrefsContext';
import useHomeListControls from '@/library/useHomeListControls';
import { byTextAsc, byNumberDesc, byDateDesc, roleGroup } from '@/library/homeListControls';
import AppCard from '@/components/Home/shared/AppCard';
import CreateTrack from '@/components/modal/CreateTrack';
import useContextMenu from '@/components/common/useContextMenu';
import ContextMenu from '@/components/common/ContextMenu';
import { buildSpaceMenu } from '@/components/Layout/spaceMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { showToast } from '@/components/Layout/Toast';
import { useTranslation } from 'react-i18next';

const getMyName = () => {
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    return profile.username || '';
  } catch {
    return '';
  }
};

const openCommandPalette = () => window.dispatchEvent(new CustomEvent('layout:open-search'));

// key/value는 저장되는 식별자라 그대로 두고, 라벨만 카탈로그 키로 렌더 시점에 푼다.
const TRACK_CONTROLS = {
  appKey: 'track',
  hiddenApp: 'tracks',
  idField: 'track_id',
  queryFields: ['track_name'],
  defaultView: 'grid',
  sortOptions: [
    { key: 'updated', labelKey: 'track.home.sortUpdated', compare: byDateDesc('updated_at') },
    { key: 'progress', labelKey: 'track.home.sortProgress', compare: byNumberDesc('progress_percent') },
    { key: 'name', labelKey: 'track.home.sortName', compare: byTextAsc('track_name') },
    { key: 'branches', labelKey: 'track.home.sortBranches', compare: byNumberDesc('branch_count') },
  ],
  filterConfig: {
    // 역할 필터 그룹(roleGroup(t))은 t가 필요해 모듈 스코프에 둘 수 없다 — buildTrackControls가 앞에 붙인다.
    groups: [
      {
        key: 'status', labelKey: 'track.home.filterStatus', options: [
          { value: 'all', labelKey: 'track.home.filterAll', test: () => true },
          { value: 'active', labelKey: 'track.home.filterActive', test: (it) => (it.progress_percent ?? 0) < 100 },
          { value: 'done', labelKey: 'track.home.filterDone', test: (it) => it.progress_percent === 100 },
        ],
      },
    ],
    showHidden: true,
  },
};

// 렌더 시점에 t로 라벨을 푼다. 공용 역할 필터(roleGroup)는 다른 앱 홈과 같은 자리(맨 앞)에 붙인다.
const buildTrackControls = (t) => ({
  ...TRACK_CONTROLS,
  sortOptions: TRACK_CONTROLS.sortOptions.map((o) => ({ ...o, label: t(o.labelKey) })),
  filterConfig: {
    ...TRACK_CONTROLS.filterConfig,
    groups: [roleGroup(t), ...TRACK_CONTROLS.filterConfig.groups].map((g) => (g.labelKey
      ? {
        ...g,
        label: t(g.labelKey),
        options: g.options.map((o) => ({ ...o, label: t(o.labelKey) })),
      }
      : g)),
  },
});

export default function TrackHome() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isHidden, hide, unhide } = useUiPrefs();
  const ctx = useContextMenu();
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [tracks, setTracks] = useState([]);
  const controls = useMemo(() => buildTrackControls(t), [t]);
  const { processed, view, query, toolbarProps } = useHomeListControls(controls, tracks);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [me, setMe] = useState('');

  const fetchTracks = useCallback(async () => {
    try {
      const res = await axios.get('/tracks');
      if (res.data.status) setTracks(res.data.tracks);
    } catch {}
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await axios.get('/tracks/home-stats');
      if (res.data.status) setStats(res.data);
    } catch {}
  }, []);

  useEffect(() => {
    setMe(getMyName());
    (async () => {
      await Promise.all([fetchTracks(), fetchStats()]);
      setLoading(false);
    })();
  }, [fetchTracks, fetchStats]);

  const handleCreated = useCallback((trackId) => {
    setShowCreate(false);
    if (trackId) router.push(`/tracks/${trackId}`);
  }, [router]);

  const openCardMenu = (e, track) => {
    const id = track.track_id;
    const detailPath = `/tracks/${id}`;
    const settingsPath = `${detailPath}/settings`;
    ctx.open(e, buildSpaceMenu(
      {
        appType: 'track',
        id,
        name: track.track_name,
        role: track.my_role,
        isHidden: isHidden('tracks', id),
      },
      {
        open: () => router.push(detailPath),
        openNewTab: () => window.open(detailPath, '_blank'),
        settings: () => router.push(settingsPath),
        rename: () => router.push(settingsPath),
        members: () => router.push(settingsPath),
        toggleHide: () => (isHidden('tracks', id) ? unhide('tracks', id) : hide('tracks', id)),
        archive: async () => {
          try {
            const res = await axios.delete(`/tracks/${id}`);
            if (res.data.status) {
              fetchTracks();
              window.dispatchEvent(new Event('track:updated'));
              showToast(t('sidebar.archived', { name: track.track_name }));
            } else {
              showToast(t('sidebar.archiveFailed'), 'error');
            }
          } catch {}
        },
        leave: () => setLeaveTarget({ id, name: track.track_name }),
      }, t));
  };

  return (
    <>
    <div className="HomeMain">
      <HomeHero
        greeting={me
          ? <>{t('track.home.greeting', { name: me })} 👋</>
          : <>{t('track.home.greetingAnonymous')} 👋</>}
        summary={stats && (
          <>
            {t('track.home.summaryInProgress')} <b>{stats.in_progress_task_count}</b> ·{' '}
            {t('track.home.summaryDueThisWeek')} <b>{stats.due_this_week_count}</b>
          </>
        )}
        actions={
          <>
            <button className="HBtn HBtn--sm" onClick={openCommandPalette}>
              ⌘K {t('track.home.quickJump')}
            </button>
            <button className="HBtn HBtn--sm" onClick={() => router.push('/tracks/archive')}>
              🗄 {t('track.home.archive')}
            </button>
            <button className="HBtn HBtn--pri HBtn--sm" onClick={() => setShowCreate(true)}>
              ＋ {t('track.home.newTrack')}
            </button>
          </>
        }
      />

      <StatTiles
        loading={!stats}
        tiles={stats ? [
          { icon: <Workflow size={16} />, label: t('track.home.statActiveTracks'), value: stats.active_track_count, tone: 'track' },
          { icon: <GitBranch size={16} />, label: t('track.home.statConnectedBranches'), value: stats.connected_branch_count, tone: 'primary' },
          { icon: <Clock size={16} />, label: t('track.home.statInProgressTasks'), value: stats.in_progress_task_count, tone: 'inprog' },
          { icon: <AlarmClock size={16} />, label: t('track.home.statDueThisWeek'), value: stats.due_this_week_count, tone: 'error' },
        ] : []}
      />

      <div className="HomeDivider" />

      <HomeToolbar
        count={t('track.home.trackCount', { n: processed.length })}
        placeholder={t('track.home.searchPlaceholder')}
        {...toolbarProps}
      />

      {loading ? (
        <HomeSkeleton variant="cards" />
      ) : processed.length === 0 ? (
        <HomeEmptyState
          icon={<Workflow size={26} />}
          title={tracks.length === 0
            ? t('track.home.emptyTitle')
            : (query.trim() ? t('track.home.noResultsTitle') : t('track.home.nothingToShowTitle'))}
          desc={
            tracks.length === 0
              ? t('track.home.emptyDesc')
              : t('track.home.noResultsDesc', { query })
          }
          ctaLabel={tracks.length === 0 ? `＋ ${t('track.home.newTrack')}` : undefined}
          onCta={() => setShowCreate(true)}
        />
      ) : (
        <div className={view === 'list' ? 'HList' : 'HGrid'}>
          {processed.map((tr) => (
            <AppCard
              key={tr.track_id}
              accent={tr.color}
              href={`/tracks/${tr.track_id}`}
              onContextMenu={(e) => openCardMenu(e, tr)}
            >
              <div className="HCard__Top">
                <div className="HCard__TopText">
                  <div className="HCard__Title">{tr.track_name}</div>
                  <div className="HCard__Desc">{tr.description}</div>
                </div>
                <ProgressRing value={tr.progress_percent} color={tr.color} />
              </div>
              <div className="HCard__Linked">
                {(tr.branches || []).map((br, i) => (
                  <span key={i} className="HCard__LChip">
                    <span className="HDot" style={{ background: br.color }} />
                    {br.name}
                  </span>
                ))}
                {tr.branch_count > (tr.branches?.length || 0) && (
                  <span className="HCard__LChip">
                    +{tr.branch_count - (tr.branches?.length || 0)}
                  </span>
                )}
              </div>
              <div className="HCard__Foot">
                <span className="HChip HChip--muted">
                  {t('track.home.taskCount', { n: tr.item_count || 0 })}
                </span>
              </div>
            </AppCard>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTrack
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
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
            const res = await axios.post(`/tracks/${target.id}/leave`);
            if (res.data.status) {
              fetchTracks();
              window.dispatchEvent(new Event('track:updated'));
            } else {
              showToast(t('sidebar.leaveFailed'), 'error');
            }
          } catch {}
        }}
        title={t('sidebar.leaveTrackTitle')}
        message={t('sidebar.leaveConfirm', { name: leaveTarget?.name })}
        confirmLabel={t('sidebar.leave')}
        variant="danger"
      />
    </>
  );
}
