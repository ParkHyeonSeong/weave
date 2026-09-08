import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import HomeView from '@/components/Home/HomeView';

export default function Home() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>Weave</title>
        <meta name="description" content={t('misc.meta.home')} />
      </Head>
      <HomeView />
    </>
  );
}
