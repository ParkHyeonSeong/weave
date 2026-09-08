import Document, { Html, Head, Main, NextScript } from "next/document";

// SEC-22: Pages Router에서 nonce 기반 CSP를 쓰려면 _document가 미들웨어가 심은 x-nonce를
// 읽어 Head/NextScript에 전달해야 한다. 그래야 Next가 주입하는 스크립트(__NEXT_DATA__·런타임·
// 청크 부트스트랩)에 nonce가 붙어 script-src 'nonce-…'(unsafe-inline 없음)에서 실행된다.
// (⚠️ custom Document의 getInitialProps는 정적 최적화(ASO)를 끄지 **않는다** — 판정은 페이지
// 컴포넌트의 데이터 훅 기준. 정적 프리렌더에선 ctx.req가 없어 nonce가 빈 문자열로 박제되므로,
// nonce는 동적 렌더 시에만 유효하고 실행형 인라인 스크립트는 넣지 말 것 — /theme-boot.js 참조.)
class MyDocument extends Document {
  static async getInitialProps(ctx) {
    const initialProps = await Document.getInitialProps(ctx);
    const nonce = ctx.req?.headers?.["x-nonce"] || "";
    return { ...initialProps, nonce };
  }

  render() {
    const { nonce } = this.props;
    return (
      <Html lang="en">
        <Head nonce={nonce}>
          {/* theme-color는 부트스트랩보다 앞 — 스크립트가 첫 페인트 전에 attr+meta를 함께 동기한다. */}
          <meta name="theme-color" content="#FFFFFF" />
          {/* 테마 부트스트랩 — 외부 parser-blocking 파일(script-src 'self' 통과).
              인라인+nonce는 ASO 정적 HTML에서 nonce가 비어 prod CSP에 차단되므로 금지. */}
          <script src="/theme-boot.js" />
          {/* 언어 부트스트랩 — 첫 페인트 전에 <html lang>을 확정한다. 같은 CSP 제약(인라인 금지)이
              적용되므로 theme-boot.js와 동일하게 외부 파일이다. 생성원은 library/localePrefs.js의
              buildLocaleBootstrapScript()이고 i18nCatalog.test.js가 parity를 강제한다.
              lang 기본값은 아래 <Html lang>이고, 이 스크립트가 기기 값으로 교정한다. */}
          <script src="/locale-boot.js" />
          <meta charSet="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
          <meta name="robots" content="noindex, nofollow" />
          {/* 초기 locale을 알 수 없는 정적 문서다 — 언어에 묶이는 설명 대신 제품 이름만 둔다.
              실제 설명은 각 페이지가 <Head>에서 현재 언어(t)로 덮어쓴다(misc.meta.*). */}
          <meta name="description" content="Weave" />
          <link rel="icon" type="image/svg+xml" href="/icons/weave_square.svg" />
          <link rel="manifest" href="/manifest.json" />
          <link rel="apple-touch-icon" href="/icons/weave-192.png" />
        </Head>
        <body>
          <Main />
          <NextScript nonce={nonce} />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
