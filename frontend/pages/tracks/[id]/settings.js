import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import TrackSettings from '@/components/Track/Settings/TrackSettings';

export default function TrackSettingsPage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('misc.pageTitles.trackSettings')}</title>
      </Head>
      <TrackSettings />
    </>
  );
}
