import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import { SearchX } from 'lucide-react';
import ErrorPage from '@/components/Layout/ErrorPage';
import NavLink from '@/components/common/NavLink';

// Next 기본 404는 영문 고정("This page could not be found")이라 언어 설정을 따르지 않는다.
// 커스텀 페이지를 두면 _app의 LocaleProvider 아래에서 렌더돼 현재 언어로 나온다.
export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('pageTitles.notFound')}</title>
      </Head>
      <ErrorPage
        icon={SearchX}
        code="404"
        title={t('errorPages.notFound.title')}
        message={t('errorPages.notFound.message')}
      >
        <NavLink href="/" className="ErrorPage__Button">
          {t('errorPages.goHome')}
        </NavLink>
      </ErrorPage>
    </>
  );
}
