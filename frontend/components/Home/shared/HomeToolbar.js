import { Search, ArrowUpDown, SlidersHorizontal, LayoutGrid, List, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import HomeMenu from './HomeMenu';
import { countActiveFilters, resetFilters } from '@/library/homeListControls';

// sortOptions/filterConfig가 없으면 해당 드롭다운은 렌더하지 않는다(점진 배선 안전).
export default function HomeToolbar({
  count,
  query,
  onQuery = () => {},
  placeholder,
  sortOptions = null,
  sortKey = null,
  onSortKey = () => {},
  filterConfig = null,
  filters = {},
  onFilters = () => {},
  view = 'grid',
  onView = () => {},
}) {
  const { t } = useTranslation();
  const searchPlaceholder = placeholder ?? t('home.toolbar.searchPlaceholder');
  const currentSort = sortOptions ? (sortOptions.find((o) => o.key === sortKey) || sortOptions[0]) : null;
  const activeCount = filterConfig ? countActiveFilters(filters, filterConfig) : 0;

  return (
    <div className="HomeToolbar">
      <span className="HomeToolbar__Count">{count}</span>
      <div className="HomeToolbar__Search">
        <Search size={15} />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
        />
      </div>

      {sortOptions && (
        <HomeMenu
          className="HPill"
          label={<><ArrowUpDown size={13} />{currentSort?.label}</>}
        >
          {(close) => (
            <ul className="HomeMenu__List">
              {sortOptions.map((o) => (
                <li key={o.key}>
                  <button
                    type="button"
                    className={`HomeMenu__Item ${o.key === sortKey ? 'is-on' : ''}`}
                    onClick={() => { onSortKey(o.key); close(); }}
                  >
                    {o.label}
                    {o.key === sortKey && <Check size={13} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </HomeMenu>
      )}

      {filterConfig && (
        <HomeMenu
          className="HPill"
          align="right"
          label={<><SlidersHorizontal size={13} />{t('home.toolbar.filter')}</>}
          badge={activeCount || null}
        >
          {(close) => (
            <div className="HomeMenu__Filters">
              {filterConfig.groups.map((g) => {
                const val = filters[g.key] ?? g.options[0].value;
                return (
                  <div className="HomeMenu__Group" key={g.key}>
                    <div className="HomeMenu__GroupLabel">{g.label}</div>
                    {g.options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        className={`HomeMenu__Item ${val === o.value ? 'is-on' : ''}`}
                        onClick={() => onFilters({ ...filters, [g.key]: o.value })}
                      >
                        {o.label}
                        {val === o.value && <Check size={13} />}
                      </button>
                    ))}
                  </div>
                );
              })}
              {filterConfig.showHidden && (
                <label className="HomeMenu__Toggle">
                  <input
                    type="checkbox"
                    checked={!!filters.showHidden}
                    onChange={(e) => onFilters({ ...filters, showHidden: e.target.checked })}
                  />
                  {t('home.toolbar.showHidden')}
                </label>
              )}
              <button
                type="button"
                className="HomeMenu__Reset"
                onClick={() => { onFilters(resetFilters(filterConfig)); close(); }}
              >
                {t('home.toolbar.resetFilters')}
              </button>
            </div>
          )}
        </HomeMenu>
      )}

      <div className="HomeToolbar__View">
        <button
          className={view === 'grid' ? 'is-on' : ''}
          onClick={() => onView('grid')}
          aria-label={t('home.toolbar.gridView')}
        >
          <LayoutGrid size={14} />
        </button>
        <button
          className={view === 'list' ? 'is-on' : ''}
          onClick={() => onView('list')}
          aria-label={t('home.toolbar.listView')}
        >
          <List size={14} />
        </button>
      </div>
    </div>
  );
}
