import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import BrowseBranches from '@/components/Browse/BrowseBranches';

export default function Browse() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('pageTitles.browse')}</title>
      </Head>
      <BrowseBranches />
    </>
  );
}
