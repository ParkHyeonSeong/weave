import { useTranslation } from 'react-i18next';
import Launchpad from './Launchpad';
import QuickCreate from './QuickCreate';
import WidgetZone from './WidgetZone';
import ScrumHomeCards from './ScrumHomeCards';

export default function HomeView() {
  const { t } = useTranslation();

  return (
    <div className="HomeView">
      <div className="HomeView__Top">
        <div className="HomeView__Greeting">
          <h2 className="HomeView__Hello">{t('home.view.greeting')}</h2>
          <p className="HomeView__Sub">{t('home.view.greetingSub')}</p>
        </div>
        <QuickCreate />
      </div>

      <ScrumHomeCards />

      <Launchpad />

      <WidgetZone />
    </div>
  );
}
