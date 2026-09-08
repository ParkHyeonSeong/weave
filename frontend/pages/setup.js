import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import SetupWizard from '@/components/Setup/SetupWizard';

export default function SetupPage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('setup.pageTitle')}</title>
        <meta name="description" content={t('setup.pageDescription')} />
      </Head>
      <SetupWizard />
    </>
  );
}
