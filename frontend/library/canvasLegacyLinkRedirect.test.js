// 예전 문서 본문 멘션 알림 링크 /canvas/{c}/page/{p}(backend canvas_page.py가 만들던 모양)는 프론트에 라우트가 없어
// 404였다. 이미 저장된 알림과 이미 전달된 Web Push가 그 링크를 그대로 열므로, next.config 리다이렉트로 문서 라우트
// /canvas/{c}/{p}(pages/canvas/[canvasId]/[pageId].js)에 보낸다. Next가 redirects의 source를 맞출 때 쓰는 매처
// (getPathMatch)와 destination 치환(path-to-regexp compile)으로 실제 결과를 확인한다.
import { describe, it, expect } from 'vitest';
import { checkCustomRoutes } from 'next/dist/lib/load-custom-routes';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { compile } from 'next/dist/compiled/path-to-regexp';
import nextConfig from '@/next.config.mjs';

const loadRedirects = async () => (nextConfig.redirects ? nextConfig.redirects() : []);

async function redirectFor(pathname) {
  for (const rule of await loadRedirects()) {
    const params = getPathMatch(rule.source)(pathname);
    if (params) return { to: compile(rule.destination)(params), permanent: rule.permanent };
  }
  return null;
}

describe('예전 문서 멘션 알림 링크', () => {
  it('/canvas/{c}/page/{p}를 문서 라우트 /canvas/{c}/{p}로 보낸다(임시 리다이렉트)', async () => {
    expect(await redirectFor('/canvas/12/page/34')).toEqual({ to: '/canvas/12/34', permanent: false });
  });

  it('문서·캔버스 홈·설정·보관함 경로는 건드리지 않는다', async () => {
    for (const p of ['/canvas/12/34', '/canvas/12', '/canvas/12/settings', '/canvas/12/page', '/canvas/archive']) {
      expect(await redirectFor(p), p).toBeNull();
    }
  });

  it('Next가 받아들이는 리다이렉트 형식이다', async () => {
    const rules = await loadRedirects();
    expect(() => checkCustomRoutes(rules, 'redirect')).not.toThrow();
  });
});
