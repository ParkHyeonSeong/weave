import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import ForceChangePassword from '@/components/Auth/ForceChangePassword';

export default function ChangePasswordPage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('pageTitles.changePassword')}</title>
        <meta name="description" content={t('misc.meta.changePassword')} />
      </Head>
      <ForceChangePassword />
    </>
  );
}
