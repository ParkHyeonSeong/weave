/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@xyflow/react', '@xyflow/system'],
  devIndicators: false,
  allowedDevOrigins: ['127.0.0.1'],
  // Next 16.4부터 기본으로 켜진 공유 런타임은 운영 빌드 페이지마다 인라인 부트스트랩 <script>를 넣는다. 정적 프리렌더
  // 페이지는 nonce가 빈 값으로 박제되므로(pages/_document.js) 그 스크립트가 CSP(unsafe-inline 없음)에 막혀 앱이 빈
  // 화면으로 멈춘다 — 공유 런타임을 꺼서 16.2처럼 외부 청크 스크립트만으로 시작하게 한다. 업스트림이 이 플래그를 없앨
  // 예정이라 Next를 올릴 때마다 운영 빌드를 브라우저에서 다시 확인할 것.
  experimental: { turbopackSharedRuntime: false },
  // Turbopack: .wasm 파일 처리 시 생성되는 loader가 'wbg' 모듈을 참조하므로 stub으로 대체
  turbopack: {
    resolveAlias: {
      wbg: './lib/wbg-stub.js',
    },
  },
  webpack: (config) => {
    config.resolve.alias.wbg = false;
    return config;
  },
  async redirects() {
    return [
      {
        // 예전 문서 본문 멘션 알림 링크(라우트가 없어 404였다). 이미 저장된 알림·전달된 Web Push를 문서 라우트로 보낸다
        source: '/canvas/:canvasId/page/:pageId',
        destination: '/canvas/:canvasId/:pageId',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL || 'http://backend:8000';
    return [
      {
        source: '/api/uploads/:path*',
        destination: `${apiUrl}/api/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
