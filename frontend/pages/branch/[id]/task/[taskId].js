import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import TaskFullPage from '@/components/Branch/Tasks/TaskFullPage';
import RefPanelPageLayout from '@/components/shared/RefPanelPageLayout';

export default function TaskPage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('pageTitles.task')}</title>
      </Head>
      <RefPanelPageLayout>
        <TaskFullPage />
      </RefPanelPageLayout>
    </>
  );
}
