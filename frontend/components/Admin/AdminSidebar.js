import { useRouter } from 'next/router';
import { ArrowLeft, Users, Blocks, Globe2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function AdminSidebar() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <aside className="AdminSidebar">
      <div className="AdminSidebar__Inner">
        <div className="AdminSidebar__Header">
          <button className="AdminSidebar__BackBtn" onClick={() => router.push('/')}>
            <ArrowLeft size={16} />
          </button>
          <span className="AdminSidebar__Title">{t('authAdmin.adminSettings')}</span>
        </div>

        <nav className="AdminSidebar__Menu">
          <button
            className={`AdminSidebar__MenuItem ${router.pathname === '/admin' ? 'AdminSidebar__MenuItem--active' : ''}`}
            onClick={() => router.push('/admin')}
          >
            <Users size={16} className="AdminSidebar__MenuIcon" />
            {t('authAdmin.nav.members')}
          </button>
          <button
            className={`AdminSidebar__MenuItem ${router.pathname === '/admin/integrations' ? 'AdminSidebar__MenuItem--active' : ''}`}
            onClick={() => router.push('/admin/integrations')}
          >
            <Blocks size={16} className="AdminSidebar__MenuIcon" />
            {t('authAdmin.nav.integrations')}
          </button>
          <button
            className={`AdminSidebar__MenuItem ${router.pathname === '/admin/workspace' ? 'AdminSidebar__MenuItem--active' : ''}`}
            onClick={() => router.push('/admin/workspace')}
          >
            <Globe2 size={16} className="AdminSidebar__MenuIcon" />
            {t('authAdmin.nav.workspace')}
          </button>
        </nav>
      </div>
    </aside>
  );
}
