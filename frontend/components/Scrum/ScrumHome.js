import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import { CalendarCheck, Users } from 'lucide-react';
import { axios } from '@/library/_axios';
import HomeHero from '@/components/Home/shared/HomeHero';
import StatTiles from '@/components/Home/shared/StatTiles';
import HomeToolbar from '@/components/Home/shared/HomeToolbar';
import HomeSkeleton from '@/components/Home/shared/HomeSkeleton';
import HomeEmptyState from '@/components/Home/shared/HomeEmptyState';
import AppCard from '@/components/Home/shared/AppCard';
import CreateScrumBoard from '@/components/modal/CreateScrumBoard';
import { useUiPrefs } from '@/library/UiPrefsContext';
import useHomeListControls from '@/library/useHomeListControls';
import { byTextAsc, byNumberDesc, byDateDesc, roleGroup } from '@/library/homeListControls';
import useContextMenu from '@/components/common/useContextMenu';
import ContextMenu from '@/components/common/ContextMenu';
import { buildSpaceMenu } from '@/components/Layout/spaceMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { showToast } from '@/components/Layout/Toast';
import { useTranslation } from 'react-i18next';

const getMyName = () => {
  try { return JSON.parse(sessionStorage.getItem('profile') || '{}').username || ''; } catch { return ''; }
};
const CADENCE_KEYS = {
  weekly: 'scrum.cadence.weekly',
  biweekly: 'scrum.cadence.biweekly',
  every_n_weeks: 'scrum.cadence.nWeeks',
  monthly: 'scrum.cadence.monthly',
  manual: 'scrum.cadence.manual',
};
const cadenceLabel = (t, value) => (CADENCE_KEYS[value] ? t(CADENCE_KEYS[value]) : value);

const buildScrumControls = (t) => ({
  appKey: 'scrum',
  hiddenApp: 'scrums',
  idField: 'board_id',
  queryFields: ['name'],
  defaultView: 'grid',
  sortOptions: [
    { key: 'updated', label: t('scrum.home.sortUpdated'), compare: byDateDesc('updated_at') },
    { key: 'name', label: t('scrum.home.sortName'), compare: byTextAsc('name') },
    { key: 'created', label: t('scrum.home.sortCreated'), compare: byDateDesc('created_at') },
    { key: 'members', label: t('scrum.home.sortMembers'), compare: byNumberDesc('member_count') },
  ],
  filterConfig: {
    groups: [
      roleGroup(t),
      {
        key: 'cadence', label: t('scrum.home.filterCadence'), options: [
          { value: 'all', label: t('scrum.home.filterAll'), test: () => true },
          { value: 'weekly', label: t('scrum.cadence.weekly'), test: (it) => it.retro_cadence === 'weekly' },
          { value: 'biweekly', label: t('scrum.cadence.biweekly'), test: (it) => it.retro_cadence === 'biweekly' },
          { value: 'every_n_weeks', label: t('scrum.cadence.nWeeks'), test: (it) => it.retro_cadence === 'every_n_weeks' },
          { value: 'monthly', label: t('scrum.cadence.monthly'), test: (it) => it.retro_cadence === 'monthly' },
          { value: 'manual', label: t('scrum.cadence.manual'), test: (it) => it.retro_cadence === 'manual' },
        ],
      },
    ],
    showHidden: true,
  },
});

export default function ScrumHome() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isHidden, hide, unhide } = useUiPrefs();
  const ctx = useContextMenu();
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [boards, setBoards] = useState([]);
  // 라벨이 t에 의존 → 언어 전환 시에만 정체성이 바뀌도록 memo (useHomeListControls가 config 정체성에 의존)
  const scrumControls = useMemo(() => buildScrumControls(t), [t]);
  const { processed, view, query, toolbarProps } = useHomeListControls(scrumControls, boards);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [me, setMe] = useState('');

  const fetchBoards = useCallback(async () => {
    try { const res = await axios.get('/scrum'); if (res.data.status) setBoards(res.data.boards); } catch {}
  }, []);

  useEffect(() => {
    setMe(getMyName());
    (async () => { await fetchBoards(); setLoading(false); })();
  }, [fetchBoards]);

  const handleCreated = useCallback((boardId) => {
    setShowCreate(false);
    if (boardId) router.push(`/scrum/${boardId}`);
  }, [router]);

  const memberTotal = useMemo(() => boards.reduce((s, b) => s + (b.member_count || 0), 0), [boards]);

  const openCardMenu = (e, b) => {
    const id = b.board_id;
    const detailPath = `/scrum/${id}`;
    const settingsPath = `${detailPath}/settings`;
    ctx.open(e, buildSpaceMenu(
      {
        appType: 'scrum',
        id,
        name: b.name,
        role: b.my_role,
        isHidden: isHidden('scrums', id),
      },
      {
        open: () => router.push(detailPath),
        openNewTab: () => window.open(detailPath, '_blank'),
        settings: () => router.push(settingsPath),
        rename: () => router.push(settingsPath),
        members: () => router.push(settingsPath),
        toggleHide: () => (isHidden('scrums', id) ? unhide('scrums', id) : hide('scrums', id)),
        archive: async () => {
          try {
            const res = await axios.delete(`/scrum/${id}`);
            if (res.data.status) {
              fetchBoards();
              window.dispatchEvent(new Event('scrum:updated'));
              showToast(t('sidebar.archived', { name: b.name }));
            } else {
              showToast(t('sidebar.archiveFailed'), 'error');
            }
          } catch {}
        },
        leave: () => setLeaveTarget({ id, name: b.name }),
      }, t));
  };

  return (
    <>
    <div className="HomeMain">
      <HomeHero
        greeting={me ? t('scrum.home.greeting', { name: me }) : t('scrum.home.greetingAnon')}
        summary={<>{t('scrum.home.summaryLabel')} <b>{boards.length}</b>{t('scrum.home.summaryUnit', { count: boards.length })}</>}
        actions={(
          <>
            <button className="HBtn HBtn--sm" onClick={() => router.push('/scrum/archive')}>🗄 {t('scrum.home.archive')}</button>
            <button className="HBtn HBtn--pri HBtn--sm" onClick={() => setShowCreate(true)}>＋ {t('scrum.home.newBoard')}</button>
          </>
        )}
      />
      <StatTiles
        loading={loading}
        tiles={[
          { icon: <CalendarCheck size={16} />, label: t('scrum.home.statBoards'), value: boards.length, tone: 'scrum' },
          { icon: <Users size={16} />, label: t('scrum.home.statMembers'), value: memberTotal, tone: 'primary' },
        ]}
      />
      <div className="HomeDivider" />
      <HomeToolbar
        count={t('scrum.home.boardCount', { count: processed.length })}
        placeholder={t('scrum.home.searchPlaceholder')}
        {...toolbarProps}
      />
      {loading ? (
        <HomeSkeleton variant="cards" />
      ) : processed.length === 0 ? (
        <HomeEmptyState
          icon={<CalendarCheck size={26} />}
          title={boards.length === 0 ? t('scrum.home.emptyTitle') : (query.trim() ? t('scrum.home.noResultsTitle') : t('scrum.home.noVisibleTitle'))}
          desc={boards.length === 0 ? t('scrum.home.emptyDesc') : (query.trim() ? t('scrum.home.noResultsDesc', { query }) : t('scrum.home.noVisibleDesc'))}
          ctaLabel={boards.length === 0 ? `＋ ${t('scrum.home.newBoard')}` : undefined}
          onCta={() => setShowCreate(true)}
        />
      ) : (
        <div className={view === 'list' ? 'HList' : 'HGrid'}>
          {processed.map((b) => (
            <AppCard key={b.board_id} accent={b.color} href={`/scrum/${b.board_id}`} onContextMenu={(e) => openCardMenu(e, b)}>
              <div className="HCard__Top">
                <div>
                  <div className="HCard__Title">{b.name}</div>
                  <div className="HCard__Desc">{t('scrum.home.cardRetro', { cadence: cadenceLabel(t, b.retro_cadence) })}</div>
                </div>
              </div>
              <div className="HCard__Foot">
                <span className="HChip HChip--muted">{t('scrum.home.cardMembers', { count: b.member_count || 0 })}</span>
              </div>
            </AppCard>
          ))}
        </div>
      )}
      {showCreate && <CreateScrumBoard onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
    </div>

      <ContextMenu {...ctx.props} />
      <ConfirmModal
        isOpen={!!leaveTarget}
        onClose={() => setLeaveTarget(null)}
        onConfirm={async () => {
          const target = leaveTarget;
          setLeaveTarget(null);
          try {
            const res = await axios.post(`/scrum/${target.id}/leave`);
            if (res.data.status) {
              fetchBoards();
              window.dispatchEvent(new Event('scrum:updated'));
            } else {
              showToast(t('sidebar.leaveFailed'), 'error');
            }
          } catch {}
        }}
        title={t('sidebar.leaveScrumTitle')}
        message={t('sidebar.leaveConfirm', { name: leaveTarget?.name })}
        confirmLabel={t('sidebar.leave')}
        variant="danger"
      />
    </>
  );
}
