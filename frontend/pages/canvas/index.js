import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import CanvasHome from '@/components/Canvas/CanvasHome';

export default function CanvasIndex() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('misc.pageTitles.canvas')}</title>
      </Head>
      <CanvasHome />
    </>
  );
}
