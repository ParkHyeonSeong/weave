import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import { Clock, FileText } from 'lucide-react';
import { useUiPrefs } from '@/library/UiPrefsContext';
import NavLink from '@/components/common/NavLink';

export default function RecentItems() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const { isHidden } = useUiPrefs();

  useEffect(() => {
    fetchRecent();
  }, []);

  const fetchRecent = async () => {
    try {
      const res = await axios.get('/recent-views', { params: { limit: 20 } });
      if (res.data.status) {
        setItems(res.data.items);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const getRelativeTime = (dateStr) => {
    const now = new Date();
    const date = new Date(dateStr);
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return t('common.time.justNow');
    if (diff < 3600) return t('home.relativeTime.minutesAgo', { value: Math.floor(diff / 60) });
    if (diff < 86400) return t('home.relativeTime.hoursAgo', { value: Math.floor(diff / 3600) });
    if (diff < 172800) return t('common.time.yesterday');
    return t('home.relativeTime.daysAgo', { value: Math.floor(diff / 86400) });
  };



  const visibleItems = items.filter((it) =>
    it.type === 'task'
      ? !isHidden('branches', it.branch_id)
      : !isHidden('canvases', it.canvas_id)
  );

  if (loading) {
    return (
      <div className="Widget RecentItems">
        <div className="Widget__Header">
          <Clock size={16} />
          <span className="Widget__Title">{t('home.widgets.recent.title')}</span>
        </div>
        <div className="Widget__Body">
          <div className="Widget__Empty">{t('common.state.loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="Widget RecentItems">
      <div className="Widget__Header">
        <Clock size={16} />
        <span className="Widget__Title">{t('home.widgets.recent.title')}</span>
      </div>
      <div className="Widget__Body">
        {visibleItems.length === 0 ? (
          <div className="Widget__Empty">{t('home.widgets.recent.empty')}</div>
        ) : (
          <div className="RecentItems__List">
            {visibleItems.map((item) => {
              const href = item.type === 'task'
                ? `/branch/${item.branch_id}/task/${item.task_id}`
                : `/canvas/${item.canvas_id}/${item.page_id}`;
              return (
                <NavLink
                  key={`${item.type}-${item.type === 'task' ? item.task_id : item.page_id}`}
                  href={href}
                  className="RecentItems__Item"
                >
                  {item.type === 'task' ? (
                    <div
                      className="RecentItems__StatusDot"
                      style={item.status_color
                        ? (item.status_category === 'todo'
                          ? { border: `1.5px solid ${item.status_color}`, background: 'transparent' }
                          : { backgroundColor: item.status_color })
                        : undefined}
                    />
                  ) : (
                    <FileText size={12} className="RecentItems__DocIcon" />
                  )}
                  <span className="RecentItems__TaskId">
                    {item.type === 'task' ? item.display_number : item.canvas_name}
                  </span>
                  <span className="RecentItems__TaskTitle">{item.title}</span>
                  <span className="RecentItems__TaskTime">
                    {getRelativeTime(item.viewed_at)}
                  </span>
                </NavLink>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
