/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@xyflow/react', '@xyflow/system'],
  devIndicators: false,
  allowedDevOrigins: ['127.0.0.1'],
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
