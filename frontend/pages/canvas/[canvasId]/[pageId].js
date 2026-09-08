import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import CanvasPageView from '@/components/Canvas/CanvasPageView';
import RefPanelPageLayout from '@/components/shared/RefPanelPageLayout';

export default function CanvasPageRoute() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('misc.pageTitles.canvasPage')}</title>
      </Head>
      {/* 읽기 모드 칩은 window 이벤트를 안 쏘므로 onRefClick으로 직접 전달 */}
      <RefPanelPageLayout>
        {(setPreviewRef) => <CanvasPageView onRefClick={setPreviewRef} />}
      </RefPanelPageLayout>
    </>
  );
}
