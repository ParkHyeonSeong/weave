import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, GitBranch, FileEdit, Workflow, CalendarCheck, ChevronDown, Check, FileText } from 'lucide-react';
import { axios } from '@/library/_axios';
import { useUiPrefs } from '@/library/UiPrefsContext';
import { getAppContext, APP_HOME } from '@/library/appContext';
import { DEFAULT_COLORS } from '@/library/entityAppearance';
import NavLink from '@/components/common/NavLink';

// 라벨은 catalog 키로 둔다 — 모듈 상수는 언어 변경을 못 따라가므로 렌더 시점에 t로 푼다.
const APPS = [
  { key: 'home',   labelKey: 'layout.appSwitcher.apps.home',   Icon: LayoutDashboard, color: '#64748b',             path: '/' },
  { key: 'branch', labelKey: 'layout.appSwitcher.apps.branch', Icon: GitBranch,       color: DEFAULT_COLORS.branch, path: APP_HOME.branch },
  { key: 'canvas', labelKey: 'layout.appSwitcher.apps.canvas', Icon: FileEdit,        color: DEFAULT_COLORS.canvas, path: APP_HOME.canvas },
  { key: 'track',  labelKey: 'layout.appSwitcher.apps.track',  Icon: Workflow,        color: DEFAULT_COLORS.track,  path: APP_HOME.track },
  { key: 'scrum',  labelKey: 'layout.appSwitcher.apps.scrum',  Icon: CalendarCheck,   color: DEFAULT_COLORS.scrum,  path: APP_HOME.scrum },
];

export default function AppSwitcher() {
  const { t } = useTranslation();
  const router = useRouter();
  const currentKey = getAppContext(router.pathname) || 'home';
  const current = APPS.find((a) => a.key === currentKey) || APPS[0];
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState([]);
  const { isHidden } = useUiPrefs();
  const ref = useRef(null);

  // 드롭다운이 열릴 때만 최근 항목 로드
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    axios.get('/recent-views', { params: { limit: 5 } })
      .then((res) => { if (!cancelled && res.data.status) setRecent(res.data.items || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  // 외부 클릭 시 닫기 (Header의 기존 드롭다운 패턴과 동일)
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);



  const visibleRecent = recent.filter((it) =>
    it.type === 'task'
      ? !isHidden('branches', it.branch_id)
      : !isHidden('canvases', it.canvas_id)
  );

  const CurIcon = current.Icon;

  return (
    <div className="AppSwitcher" ref={ref}>
      <button
        className="AppSwitcher__Trigger"
        onClick={() => setOpen((p) => !p)}
        title={t('layout.appSwitcher.switchApp')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="AppSwitcher__TrigIcon" style={{ color: current.color }}>
          <CurIcon size={15} strokeWidth={2.2} />
        </span>
        <span className="AppSwitcher__TrigLabel">{t(current.labelKey)}</span>
        <ChevronDown size={14} className="AppSwitcher__Chevron" />
      </button>

      {open && (
        <div className="AppSwitcher__Menu">
          <div className="AppSwitcher__Label">{t('layout.appSwitcher.switchApp')}</div>
          {APPS.map((app) => {
            const Icon = app.Icon;
            const active = app.key === currentKey;
            return (
              <NavLink
                key={app.key}
                href={app.path}
                className={`AppSwitcher__Item ${active ? 'AppSwitcher__Item--active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <span className="AppSwitcher__ItemIcon" style={{ color: app.color }}>
                  <Icon size={16} strokeWidth={2.2} />
                </span>
                <span className="AppSwitcher__ItemLabel">{t(app.labelKey)}</span>
                {active && <Check size={14} className="AppSwitcher__ItemCheck" />}
              </NavLink>
            );
          })}

          {visibleRecent.length > 0 && (
            <>
              <div className="AppSwitcher__Divider" />
              <div className="AppSwitcher__Label">{t('layout.appSwitcher.recent')}</div>
              {visibleRecent.map((item) => {
                const href = item.type === 'task'
                  ? `/branch/${item.branch_id}/task/${item.task_id}`
                  : `/canvas/${item.canvas_id}/${item.page_id}`;
                return (
                  <NavLink
                    key={`${item.type}-${item.type === 'task' ? item.task_id : item.page_id}`}
                    href={href}
                    className="AppSwitcher__Recent"
                    onClick={() => setOpen(false)}
                  >
                    {item.type === 'task' ? (
                      <span
                        className="AppSwitcher__RecentDot"
                        style={item.status_color ? { background: item.status_color } : undefined}
                      />
                    ) : (
                      <FileText size={13} className="AppSwitcher__RecentDocIcon" />
                    )}
                    <span className="AppSwitcher__RecentTitle">{item.title}</span>
                  </NavLink>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
