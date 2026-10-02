import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import { Zap } from 'lucide-react';
import { useUiPrefs } from '@/library/UiPrefsContext';
import { sortActiveSprints } from '@/library/activeSprintOrder';
import { formatSprintRange } from '@/library/formatTime';
import { sprintProgressSegments } from '@/library/sprintProgress';
import { statusCategoryVar } from '@/library/themePalette';
import NavLink from '@/components/common/NavLink';

export default function ActiveSprints({ compact = false, maxItems = compact ? 1 : undefined }) {
  const { t } = useTranslation();
  const [sprints, setSprints] = useState([]);
  const [loading, setLoading] = useState(true);
  const { isHidden } = useUiPrefs();

  useEffect(() => {
    fetchSprints();
  }, []);

  const fetchSprints = async () => {
    try {
      const branchRes = await axios.get('/branches');
      if (!branchRes.data.status) return;
      const branches = branchRes.data.branches;

      const allSprints = [];
      for (const branch of branches) {
        const sprintRes = await axios.get(`/branches/${branch.branch_id}/sprints`);
        if (sprintRes.data.status) {
          const activeSprints = sprintRes.data.sprints.filter(s => s.status === 'active');
          for (const sprint of activeSprints) {
            const countRes = await axios.get(`/branches/${branch.branch_id}/sprints/${sprint.sprint_id}/task-counts`);
            if (countRes.data.status) {
              allSprints.push({
                ...sprint,
                branch_id: branch.branch_id,
                branch_name: branch.branch_name,
                branch_key: branch.key,
                done: countRes.data.all_done_count,
                total: countRes.data.all_total_count,
                in_progress: countRes.data.all_in_progress_count,
                cancelled: countRes.data.all_cancelled_count,
                my_count: countRes.data.my_count,
                my_incomplete_count: countRes.data.my_incomplete_count,
              });
            }
          }
        }
      }
      setSprints(sortActiveSprints(allSprints));
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const visibleSprints = sprints.filter((s) => !isHidden('branches', s.branch_id));

  if (loading) {
    return (
      <div className="Widget">
        <div className="Widget__Header">
          <Zap size={16} />
          <span className="Widget__Title">{t('home.widgets.activeSprints.title')}</span>
        </div>
        <div className="Widget__Body">
          <div className="Widget__Empty">{t('common.state.loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`Widget${compact ? ' HomeSprint' : ''}`}>
      <div className="Widget__Header">
        <Zap size={16} />
        <span className="Widget__Title">{t('home.widgets.activeSprints.title')}</span>
      </div>
      <div className="Widget__Body">
        {visibleSprints.length === 0 ? (
          <div className="Widget__Empty">{t('home.widgets.activeSprints.empty')}</div>
        ) : (
          visibleSprints.slice(0, maxItems).map((sprint) => {
            // 바는 카테고리별로 나눠 칠하고, 오른쪽 x / y는 닫힘(done+cancelled) / 전체
            const { counts, segments } = sprintProgressSegments(sprint);
            const breakdown = t('home.widgets.activeSprints.progressBreakdown', counts);
            return (
              // 클릭 → 그 브랜치 보드 탭에서 이 스프린트 탭을 선택한 상태로 연다(BranchDetail ?sprint=)
              <NavLink
                key={sprint.sprint_id}
                href={`/branch/${sprint.branch_id}?tab=board&sprint=${sprint.sprint_id}`}
                className="ActiveSprints__Item"
              >
                <div className="ActiveSprints__SprintInfo">
                  <div>
                    <div className="ActiveSprints__SprintName">{sprint.sprint_name}</div>
                    <div className="ActiveSprints__SprintMeta">
                      <span className="ActiveSprints__SprintBranch">
                        {sprint.branch_name}
                        {(sprint.start_date || sprint.end_date) && ` · ${formatSprintRange(sprint.start_date, sprint.end_date)}`}
                      </span>
                      {sprint.my_count > 0 && (
                        <span className="HChip HChip--mine">
                          {t('home.widgets.activeSprints.myTasks', { count: sprint.my_count })}
                          {' · '}{t('home.widgets.activeSprints.myTasksLeft', { count: sprint.my_incomplete_count })}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="ActiveSprints__SprintCount">
                    {sprint.done} / {sprint.total}
                  </span>
                </div>
                <div
                  className="ActiveSprints__ProgressBar"
                  role="img"
                  aria-label={breakdown}
                  title={breakdown}
                >
                  {segments.map((seg) => (
                    <div
                      key={seg.category}
                      className="ActiveSprints__ProgressSegment"
                      style={{ width: `${seg.percent}%`, background: statusCategoryVar(seg.category) }}
                    />
                  ))}
                </div>
              </NavLink>
            );
          })
        )}
      </div>
    </div>
  );
}
