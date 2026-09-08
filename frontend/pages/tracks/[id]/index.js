import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import TrackDetail from '@/components/Track/TrackDetail';

export default function TrackPage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('pageTitles.track')}</title>
      </Head>
      <TrackDetail />
    </>
  );
}
