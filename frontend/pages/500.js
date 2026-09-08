import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import { ServerCrash } from 'lucide-react';
import ErrorPage from '@/components/Layout/ErrorPage';
import NavLink from '@/components/common/NavLink';

// Next 기본 500은 영문 고정("Internal Server Error")이다. 이 화면은 서버가 요청을 끝내지
// 못했을 때 뜨므로 조회를 하지 않는다 — 카탈로그는 번들에 정적으로 들어 있어 서버 없이 렌더된다.
export default function ServerErrorPage() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('pageTitles.serverError')}</title>
      </Head>
      <ErrorPage
        icon={ServerCrash}
        code="500"
        title={t('errorPages.serverError.title')}
        message={t('errorPages.serverError.message')}
      >
        <button
          type="button"
          className="ErrorPage__Button"
          onClick={() => window.location.reload()}
        >
          {t('errorPages.retry')}
        </button>
        <NavLink href="/" className="ErrorPage__Link">
          {t('errorPages.goHome')}
        </NavLink>
      </ErrorPage>
    </>
  );
}
