import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import BranchDetail from '@/components/Branch/BranchDetail';

export default function BranchPage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('pageTitles.branch')}</title>
      </Head>
      <BranchDetail />
    </>
  );
}
