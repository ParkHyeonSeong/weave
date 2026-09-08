import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import CreateIssuePage from '@/components/Branch/Tasks/CreateIssuePage';

export default function NewIssuePage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('pageTitles.newIssue')}</title>
      </Head>
      <CreateIssuePage />
    </>
  );
}
