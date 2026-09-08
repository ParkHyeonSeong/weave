import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import TaskIssueDetail from '@/components/Branch/Tasks/TaskIssueDetail';
import RefPanelPageLayout from '@/components/shared/RefPanelPageLayout';

export default function IssuePage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('misc.pageTitles.issue')}</title>
      </Head>
      <RefPanelPageLayout>
        <TaskIssueDetail />
      </RefPanelPageLayout>
    </>
  );
}
