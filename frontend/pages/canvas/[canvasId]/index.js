import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import CanvasOverview from '@/components/Canvas/CanvasOverview';

export default function CanvasOverviewPage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('misc.pageTitles.canvas')}</title>
      </Head>
      <CanvasOverview />
    </>
  );
}
