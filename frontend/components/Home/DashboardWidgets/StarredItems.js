import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import { Star, FileText } from 'lucide-react';
import { useUiPrefs } from '@/library/UiPrefsContext';
import NavLink from '@/components/common/NavLink';

export default function StarredItems() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const { isHidden } = useUiPrefs();

  useEffect(() => {
    fetchStarred();
  }, []);

  const fetchStarred = async () => {
    try {
      const res = await axios.get('/stars', { params: { limit: 20 } });
      if (res.data.status) {
        setItems(res.data.items);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };



  const visibleItems = items.filter((it) =>
    it.type === 'task'
      ? !isHidden('branches', it.branch_id)
      : !isHidden('canvases', it.canvas_id)
  );

  if (loading) {
    return (
      <div className="Widget StarredItems">
        <div className="Widget__Header">
          <Star size={16} />
          <span className="Widget__Title">{t('home.widgets.starred.title')}</span>
        </div>
        <div className="Widget__Body">
          <div className="Widget__Empty">{t('common.state.loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="Widget StarredItems">
      <div className="Widget__Header">
        <Star size={16} />
        <span className="Widget__Title">{t('home.widgets.starred.title')}</span>
      </div>
      <div className="Widget__Body">
        {visibleItems.length === 0 ? (
          <div className="Widget__Empty">{t('home.widgets.starred.empty')}</div>
        ) : (
          <div className="StarredItems__List">
            {visibleItems.map((item) => {
              const href = item.type === 'task'
                ? `/branch/${item.branch_id}/task/${item.task_id}`
                : `/canvas/${item.canvas_id}/${item.page_id}`;
              return (
                <NavLink
                  key={`${item.type}-${item.type === 'task' ? item.task_id : item.page_id}`}
                  href={href}
                  className="StarredItems__Item"
                >
                  {item.type === 'task' ? (
                    <div
                      className="StarredItems__StatusDot"
                      style={item.status_color
                        ? (item.status_category === 'todo'
                          ? { border: `1.5px solid ${item.status_color}`, background: 'transparent' }
                          : { backgroundColor: item.status_color })
                        : undefined}
                    />
                  ) : (
                    <FileText size={12} className="StarredItems__DocIcon" />
                  )}
                  <span className="StarredItems__TaskId">
                    {item.type === 'task' ? item.display_number : item.canvas_name}
                  </span>
                  <span className="StarredItems__TaskTitle">{item.title}</span>
                </NavLink>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
