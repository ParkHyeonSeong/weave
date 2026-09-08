import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import Login from '@/components/Auth/Login';

export default function LoginPage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('auth.signInTitle')}</title>
        <meta name="description" content={t('auth.signInDescription')} />
      </Head>
      <Login />
    </>
  );
}
