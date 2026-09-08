import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import BranchHome from '@/components/Branch/BranchHome';

export default function BranchIndex() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('pageTitles.branch')}</title>
      </Head>
      <BranchHome />
    </>
  );
}
