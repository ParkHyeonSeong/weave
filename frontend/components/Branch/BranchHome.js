import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Inbox, Clock, AlarmClock, Activity, GitBranch } from 'lucide-react';
import { axios } from '@/library/_axios';
import HomeHero from '@/components/Home/shared/HomeHero';
import StatTiles from '@/components/Home/shared/StatTiles';
import StatDrilldownPopover from '@/components/Home/shared/StatDrilldownPopover';
import RefPanelHost, { useRefPreview } from '@/components/shared/RefPanelHost';
import ContinueStrip from '@/components/Home/shared/ContinueStrip';
import HomeToolbar from '@/components/Home/shared/HomeToolbar';
import HomeSkeleton from '@/components/Home/shared/HomeSkeleton';
import HomeEmptyState from '@/components/Home/shared/HomeEmptyState';
import ProgressRing from '@/components/Home/shared/ProgressRing';
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

const getMyName = () => {
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    return profile.username || '';
  } catch {
    return '';
  }
};

const createBranch = () => window.dispatchEvent(new CustomEvent('layout:create-branch'));
const openCommandPalette = () => window.dispatchEvent(new CustomEvent('layout:open-search'));

// 라벨이 언어에 따라 바뀌므로 t를 받는 빌더로 둔다. 호출부에서 useMemo로 정체성을 고정한다
// (useHomeListControls가 config를 useMemo deps로 쓴다).
const buildBranchControls = (t) => ({
  appKey: 'branch',
  hiddenApp: 'branches',
  idField: 'branch_id',
  queryFields: ['branch_name', 'key'],
  defaultView: 'grid',
  sortOptions: [
    { key: 'name', label: t('branch.home.sort.name'), compare: byTextAsc('branch_name') },
    { key: 'created', label: t('branch.home.sort.created'), compare: byDateDesc('created_at') },
    { key: 'progress', label: t('branch.home.sort.progress'), compare: byNumberDesc('progress_percent') },
    { key: 'tasks', label: t('branch.home.sort.tasks'), compare: byNumberDesc('active_task_count') },
  ],
  filterConfig: {
    groups: [
      roleGroup(t),
      {
        key: 'sprint', label: t('branch.home.filter.sprint'), options: [
          { value: 'all', label: t('branch.home.filter.all'), test: () => true },
          { value: 'yes', label: t('branch.home.filter.hasActive'), test: (it) => (it.active_sprint_count || 0) > 0 },
          { value: 'no', label: t('branch.home.filter.none'), test: (it) => (it.active_sprint_count || 0) === 0 },
        ],
      },
    ],
    showHidden: true,
  },
});

export default function BranchHome() {
  const { t } = useTranslation();
  const { formatRelative } = useDateFormat();
  const router = useRouter();
  const { isHidden, hide, unhide } = useUiPrefs();
  const ctx = useContextMenu();
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [branches, setBranches] = useState([]);
  const branchControls = useMemo(() => buildBranchControls(t), [t]);
  const { processed, view, query, toolbarProps } = useHomeListControls(branchControls, branches);
  const [recentTasks, setRecentTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState('');
  const [activeBucket, setActiveBucket] = useState(null);
  const [previewRef, setPreviewRef] = useRefPreview();

  const fetchBranches = async () => {
    try {
      const res = await axios.get('/branches');
      if (res.data.status) setBranches(res.data.branches);
    } catch {}
  };

  const fetchRecentTasks = async () => {
    try {
      const res = await axios.get('/recent-views', { params: { type: 'task', limit: 5 } });
      if (res.data.status) setRecentTasks(res.data.items);
    } catch {}
  };

  const fetchStats = async () => {
    try {
      const res = await axios.get('/branches/home-stats');
      if (res.data.status) setStats(res.data);
    } catch {}
  };

  useEffect(() => {
    setMe(getMyName());
    (async () => {
      await Promise.all([fetchBranches(), fetchRecentTasks(), fetchStats()]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const handleRefresh = () => fetchBranches();
    window.addEventListener('branch:created', handleRefresh);
    return () => window.removeEventListener('branch:created', handleRefresh);
  }, []);

  useEffect(() => {
    // task:updated만 구독(기존 BoardView/TaskList/MyTasks 컨벤션). 삭제도 taskMenu가
    // task:updated를 함께 발행하므로 여기서 잡힌다. task:deleted는 패널 닫기 전용이라
    // 같이 듣지 않는다 — 삭제 1회에 새로고침이 중복 실행되는 것 방지.
    const refresh = () => { fetchStats(); fetchBranches(); fetchRecentTasks(); };
    window.addEventListener('task:updated', refresh);
    return () => window.removeEventListener('task:updated', refresh);
  }, []);

  const onTileClick = (bucket) => setActiveBucket((cur) => (cur === bucket ? null : bucket));
  const openTaskFromDrill = ({ branchId, taskId }) => {
    setActiveBucket(null);
    window.dispatchEvent(new CustomEvent('canvas:ref_click', {
      detail: { type: 'task', data: { branchId, taskId } },
    }));
  };
  const openSprintFromDrill = ({ branchId }) => {
    setActiveBucket(null);
    router.push(`/branch/${branchId}?tab=board`);  // 스프린트 드릴인 → 보드 탭(스프린트가 보이는 컨텍스트)
  };

  const openCardMenu = (e, b) => {
    const id = b.branch_id;
    const detailPath = `/branch/${id}`;
    const settingsPath = `${detailPath}?tab=settings`;
    ctx.open(e, buildSpaceMenu(
      {
        appType: 'branch',
        id,
        name: b.branch_name,
        role: b.my_role,
        isHidden: isHidden('branches', id),
      },
      {
        open: () => router.push(detailPath),
        openNewTab: () => window.open(detailPath, '_blank'),
        settings: () => router.push(settingsPath),
        rename: () => router.push(settingsPath),
        members: () => router.push(settingsPath),
        toggleHide: () => (isHidden('branches', id) ? unhide('branches', id) : hide('branches', id)),
        archive: async () => {
          try {
            const res = await axios.delete(`/branches/${id}`);
            if (res.data.status) {
              fetchBranches();
              window.dispatchEvent(new Event('branch:created'));
              showToast(t('sidebar.archived', { name: b.branch_name }));
            } else {
              showToast(t('sidebar.archiveFailed'), 'error');
            }
          } catch {}
        },
        leave: () => setLeaveTarget({ id, name: b.branch_name }),
      }, t));
  };

  return (
    <>
    <div className="HomeMain">
      <HomeHero
        greeting={me ? t('branch.home.greetingNamed', { name: me }) : t('branch.home.greeting')}
        summary={stats && (
          <>
            {t('branch.home.summaryDueThisWeek')} <b>{stats.due_this_week_count}</b>
            {' · '}{t('branch.home.summaryInProgress')}{' '}
            <b>{stats.in_progress_count}</b>
            {' · '}{t('branch.home.summaryActiveSprints')}{' '}
            <b>{stats.active_sprint_count}</b>
          </>
        )}
        actions={
          <>
            <button className="HBtn HBtn--sm" onClick={openCommandPalette}>
              {t('branch.home.quickJump')}
            </button>
            <button className="HBtn HBtn--sm" onClick={() => router.push('/branch/archive')}>
              {t('branch.home.archiveBox')}
            </button>
            <button className="HBtn HBtn--pri HBtn--sm" onClick={createBranch}>
              {t('branch.home.newBranch')}
            </button>
          </>
        }
      />

      <StatTiles
        loading={!stats}
        activeBucket={activeBucket}
        onTileClick={onTileClick}
        renderPopover={(bucket) => (
          <StatDrilldownPopover
            bucket={bucket}
            onClose={() => setActiveBucket(null)}
            onOpenTask={openTaskFromDrill}
            onOpenSprint={openSprintFromDrill}
          />
        )}
        tiles={stats ? [
          { icon: <Inbox size={16} />, label: t('branch.home.stats.open'), value: stats.open_count, tone: 'primary', bucket: 'open' },
          { icon: <Clock size={16} />, label: t('branch.home.stats.inProgress'), value: stats.in_progress_count, tone: 'inprog', bucket: 'in_progress' },
          { icon: <AlarmClock size={16} />, label: t('branch.home.stats.dueThisWeek'), value: stats.due_this_week_count, tone: 'error', bucket: 'due_this_week' },
          { icon: <Activity size={16} />, label: t('branch.home.stats.activeSprints'), value: stats.active_sprint_count, tone: 'success', bucket: 'active_sprint' },
        ] : []}
      />

      <ContinueStrip
        title={t('branch.home.continueTitle')}
        onMore={() => router.push('/my-tasks')}
        loading={loading}
        items={recentTasks.map((it) => ({
          title: it.title,
          dotColor: it.status_color,
          meta: `${it.display_number} · ${formatRelative(it.viewed_at)}`,
          href: `/branch/${it.branch_id}/task/${it.task_id}`,
        }))}
        emptyText={t('branch.home.continueEmpty')}
      />

      <div className="HomeDivider" />

      <HomeToolbar
        count={t('branch.home.branchCount', { count: processed.length })}
        placeholder={t('branch.home.searchPlaceholder')}
        {...toolbarProps}
      />

      {loading ? (
        <HomeSkeleton variant="cards" />
      ) : processed.length === 0 ? (
        <HomeEmptyState
          icon={<GitBranch size={26} />}
          title={branches.length === 0
            ? t('branch.home.empty.noBranches')
            : (query.trim() ? t('branch.home.empty.noResults') : t('branch.home.empty.noneVisible'))}
          desc={
            branches.length === 0
              ? t('branch.home.empty.noBranchesDesc')
              : t('branch.home.empty.noResultsDesc', { query })
          }
          ctaLabel={branches.length === 0 ? t('branch.home.newBranch') : undefined}
          onCta={createBranch}
        />
      ) : (
        <div className={view === 'list' ? 'HList' : 'HGrid'}>
          {processed.map((b) => (
            <AppCard
              key={b.branch_id}
              accent={b.color}
              href={`/branch/${b.branch_id}`}
              onContextMenu={(e) => openCardMenu(e, b)}
            >
              <div className="HCard__Top">
                <div className="HCard__TopText">
                  <div className="HCard__Title">{b.branch_name}</div>
                  <div className="HCard__Desc">{b.description}</div>
                </div>
                {b.progress_percent !== null && (
                  <ProgressRing value={b.progress_percent} color={b.color} />
                )}
              </div>
              <div className="HCard__Foot">
                <span className={`HChip ${b.progress_percent !== null ? 'HChip--sprint' : 'HChip--muted'}`}>
                  {b.progress_percent !== null
                    ? t('branch.home.sprintChip', {
                      sprint: b.active_sprint_count === 1
                        ? b.active_sprint_name
                        : t('branch.home.sprintCount', { count: b.active_sprint_count }),
                      count: b.sprint_task_total,
                    })
                    : t('branch.home.noSprintChip', { count: b.active_task_count })}
                </span>
                <AvatarSet members={b.members || []} />
              </div>
            </AppCard>
          ))}
        </div>
      )}
    </div>

      <ContextMenu {...ctx.props} />
      {previewRef && (
        <div className="BranchHome__RefPanel">
          <RefPanelHost
            previewRef={previewRef}
            onClose={() => { setPreviewRef(null); fetchRecentTasks(); }}
            onChangeRef={setPreviewRef}
          />
        </div>
      )}
      <ConfirmModal
        isOpen={!!leaveTarget}
        onClose={() => setLeaveTarget(null)}
        onConfirm={async () => {
          const target = leaveTarget;
          setLeaveTarget(null);
          try {
            const res = await axios.post(`/branches/${target.id}/leave`);
            if (res.data.status) {
              fetchBranches();
              window.dispatchEvent(new Event('branch:created'));
            } else {
              showToast(t('sidebar.leaveFailed'), 'error');
            }
          } catch {}
        }}
        title={t('sidebar.leaveBranchTitle')}
        message={t('sidebar.leaveConfirm', { name: leaveTarget?.name })}
        confirmLabel={t('sidebar.leave')}
        variant="danger"
      />
    </>
  );
}
