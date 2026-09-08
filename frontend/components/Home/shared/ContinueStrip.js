// title, onMore, tabs?: [{key,label}], activeTab, onTab, items: [{title, dotColor, meta, onClick}], loading
import { useTranslation } from 'react-i18next';
import NavLink from '@/components/common/NavLink';
export default function ContinueStrip({
  title,
  onMore,
  tabs,
  activeTab,
  onTab = () => {},
  items = [],
  loading = false,
  emptyText,
}) {
  const { t } = useTranslation();

  return (
    <section className="ContinueStrip">
      <div className="HomeSecHead">
        <span className="HomeSecHead__Title">{title}</span>
        {tabs && (
          <div className="HomeTabs">
            {tabs.map(t => (
              <button
                key={t.key}
                className={`HomeTabs__Tab${t.key === activeTab ? ' is-on' : ''}`}
                onClick={() => onTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {onMore && (
          <button className="HomeSecHead__More" onClick={onMore}>
            {t('home.continueStrip.viewAll')}
          </button>
        )}
      </div>
      {loading ? (
        <div className="ContinueStrip__Grid">
          {[0, 1, 2].map(i => <div key={i} className="HRecentCard HRecentCard--skeleton" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="ContinueStrip__Empty">{emptyText ?? t('home.continueStrip.empty')}</div>
      ) : (
        <div className="ContinueStrip__Grid">
          {items.map((it, i) => {
            if (it.href) {
              return (
                <NavLink key={i} href={it.href} className="HRecentCard">
                  <div className="HRecentCard__Title">{it.title}</div>
                  <div className="HRecentCard__Meta">
                    <span className="HDot" style={{ background: it.dotColor }} />
                    {it.meta}
                  </div>
                </NavLink>
              );
            }
            return (
              <button key={i} className="HRecentCard" onClick={it.onClick}>
                <div className="HRecentCard__Title">{it.title}</div>
                <div className="HRecentCard__Meta">
                  <span className="HDot" style={{ background: it.dotColor }} />
                  {it.meta}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
