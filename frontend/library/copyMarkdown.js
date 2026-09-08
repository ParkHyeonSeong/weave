// "Copy as Markdown" 클립보드 핸들러 — Task/Issue/Comment/Canvas 읽기 뷰 6표면 공용 (S1.3).
// 각 호출부는 자신의 소스 HTML과 표면별 codec 빌더(buildXExtensions())만 넘긴다 —
// ensureRenderableHtml 경유·빌더 페어링은 호출부 책임으로 남긴다.
import i18next from '@/library/i18n';
import { showToast } from '@/components/Layout/Toast';
import { htmlToMarkdown } from './markdownCodec';
import { ensureRenderableHtml } from './ensureHtml';

export async function copyAsMarkdown(html, extensions) {
  try {
    const md = htmlToMarkdown(ensureRenderableHtml(html) || '', extensions);
    await navigator.clipboard.writeText(md);
    showToast(i18next.t('common.copyMarkdown.copied'));
  } catch {
    showToast(i18next.t('common.copyMarkdown.failed'), 'error');
  }
}
