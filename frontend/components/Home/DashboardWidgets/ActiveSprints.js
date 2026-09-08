import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import { Zap } from 'lucide-react';
import { useUiPrefs } from '@/library/UiPrefsContext';

export default function ActiveSprints() {
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
                done: countRes.data.done_count,
                total: countRes.data.done_count + countRes.data.incomplete_count,
              });
            }
          }
        }
      }
      setSprints(allSprints);
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
    <div className="Widget">
      <div className="Widget__Header">
        <Zap size={16} />
        <span className="Widget__Title">{t('home.widgets.activeSprints.title')}</span>
      </div>
      <div className="Widget__Body">
        {visibleSprints.length === 0 ? (
          <div className="Widget__Empty">{t('home.widgets.activeSprints.empty')}</div>
        ) : (
          visibleSprints.map((sprint) => {
            const percent = sprint.total > 0 ? Math.round((sprint.done / sprint.total) * 100) : 0;
            return (
              <div key={sprint.sprint_id} className="ActiveSprints__Item">
                <div className="ActiveSprints__SprintInfo">
                  <div>
                    <div className="ActiveSprints__SprintName">{sprint.sprint_name}</div>
                    <div className="ActiveSprints__SprintBranch">{sprint.branch_name}</div>
                  </div>
                  <span className="ActiveSprints__SprintCount">
                    {sprint.done} / {sprint.total}
                  </span>
                </div>
                <div className="ActiveSprints__ProgressBar">
                  <div
                    className="ActiveSprints__ProgressFill"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
