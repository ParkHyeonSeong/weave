import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import TrackHome from '@/components/Track/TrackHome';

export default function TracksIndex() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('misc.pageTitles.tracks')}</title>
      </Head>
      <TrackHome />
    </>
  );
}
