import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import ResetPassword from '@/components/Auth/ResetPassword';

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const router = useRouter();

  // router.isReady 이전에는 query가 비어 있으므로 토큰 판정을 보류한다.
  if (!router.isReady) return null;

  const { token } = router.query;
  const tokenValue = Array.isArray(token) ? token[0] : token;

  return (
    <>
      <Head>
        <title>{t('pageTitles.resetPassword')}</title>
        <meta name="description" content={t('misc.meta.resetPassword')} />
      </Head>
      <ResetPassword token={tokenValue || ''} />
    </>
  );
}
