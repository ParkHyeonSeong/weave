import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import CanvasSettings from '@/components/Canvas/Settings/CanvasSettings';

export default function CanvasSettingsPage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('misc.pageTitles.canvasSettings')}</title>
      </Head>
      <CanvasSettings />
    </>
  );
}
