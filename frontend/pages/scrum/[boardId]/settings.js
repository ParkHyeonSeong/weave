import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import ScrumSettings from '@/components/Scrum/Settings/ScrumSettings';

export default function ScrumSettingsPage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('pageTitles.scrumSettings')}</title>
      </Head>
      <ScrumSettings />
    </>
  );
}
