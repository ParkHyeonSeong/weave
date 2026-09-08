import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import Profile from '@/components/Profile/Profile';

export default function ProfilePage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('pageTitles.profile')}</title>
      </Head>
      <Profile />
    </>
  );
}
