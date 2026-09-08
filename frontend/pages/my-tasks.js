import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import MyTasksView from '@/components/MyTasks/MyTasksView';

export default function MyTasks() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('pageTitles.myTasks')}</title>
      </Head>
      <MyTasksView />
    </>
  );
}
