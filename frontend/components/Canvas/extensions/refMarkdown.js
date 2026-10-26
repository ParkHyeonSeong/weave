// 칩(taskRef/issueRef/docRef) ↔ 내부 URL 링크 md 변환 공용 헬퍼 (스펙 §3.2)
// 내부 경로 판별은 BookmarkPastePlugin의 단일 정규식을 재사용한다 (중복 정의 금지).
import { ISSUE_PATH, TASK_PATH, DOC_PATH } from './BookmarkPastePlugin';

export { ISSUE_PATH, TASK_PATH, DOC_PATH };

// SSR/headless(node 테스트)에서는 상대경로로 직렬화된다
export function internalOrigin() {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

// md 링크 텍스트 문법을 깨는 문자 이스케이프
export function escapeLinkText(text) {
  return String(text ?? '').replace(/([\\[\]])/g, '\\$1');
}

function unescapeLinkText(text) {
  return String(text ?? '').replace(/\\([\\[\]])/g, '$1');
}

// src 선두의 md 링크가 내부 경로면 { raw, text, pathname } 반환, 아니면 null.
// 상대경로(/시작)는 그대로, 절대 URL은 same-origin일 때만 내부로 취급.
export function matchInternalLink(src) {
  const m = /^\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)/.exec(src);
  if (!m) return null;
  const pathname = internalPathname(m[2]);
  return pathname ? { raw: m[0], text: unescapeLinkText(m[1]), pathname } : null;
}

// 원문 모드 상태(rawMode.js). md에서는 같은 제목·주소의 칩과 일반 링크가 글자까지 같아 원문만으로는 구분할 수 없다.
// 그래서 진입 때 이슈·문서 칩 토큰이 노드가 되는 순서대로(문서 순서, 최종 토큰마다 한 번 — 목록 항목처럼 같은 글을
// 두 번 토큰화하는 경로가 있어 토크나이저가 아니라 여기서 센다) 각 원문의 형태('chip' | 'plain')를 적고,
// 다시 읽을 때 같은 순서로 하나씩 꺼내 'plain'이면 그 자리를 일반 링크로 읽는다.
let rawLinkForms = null; // 다시 읽는 동안: Map<md 원문, ('chip' | 'plain')[]>
let rawLinkRecorder = null; // 진입 때 순서를 적는 동안: (토큰) => void
let readingPlain = false; // 그 자리를 일반 링크로 읽는 동안 — 이슈·문서 칩 토크나이저가 쉰다(칩이 없던 때와 같은 조건)

export function withRawLinkForms(forms, fn) {
  const prev = rawLinkForms;
  rawLinkForms = forms?.size ? new Map([...forms].map(([raw, list]) => [raw, [...list]])) : null;
  try {
    return fn();
  } finally {
    rawLinkForms = prev;
  }
}

export function withRawLinkRecorder(recorder, fn) {
  const prev = rawLinkRecorder;
  rawLinkRecorder = recorder;
  try {
    return fn();
  } finally {
    rawLinkRecorder = prev;
  }
}

export const issueDocChipsPaused = () => readingPlain;

// 이슈·문서 칩 토크나이저 몫: 진입 때 일반 링크였던 적 있는 원문이면 그 자리를 일반 링크로 읽은 토큰도 붙인다
export function withPlainLinkTokens(token, helper) {
  if (!rawLinkForms?.get(token.raw)?.includes('plain')) return token;
  const prev = readingPlain;
  readingPlain = true;
  try {
    return { ...token, plainTokens: helper.inlineTokens(token.raw) };
  } finally {
    readingPlain = prev;
  }
}

// 이슈·문서 칩 parseMarkdown 몫: 이 원문의 다음 자리가 진입 때 일반 링크였으면 일반 링크 노드, 아니면 null(칩)
export function plainLinkNodes(token, h) {
  rawLinkRecorder?.(token);
  const form = rawLinkForms?.get(token.raw)?.shift();
  return form === 'plain' && token.plainTokens ? h.parseInline(token.plainTokens) : null;
}

// 링크 주소가 이 Weave의 내부 경로면 그 경로, 아니면 null
export function internalPathname(href) {
  if (href.startsWith('/')) return href;
  try {
    const url = new URL(href);
    const origin = internalOrigin();
    return origin && url.origin === origin ? url.pathname : null;
  } catch {
    return null;
  }
}

// 'WV-12 로그인 버그' → { displayId: 'WV-12', title: '로그인 버그' } — 접두 없으면 displayId ''.
// task/issue 공통 display_id 형식은 `{branch_key}-{number}` (backend task_issue.py:82 실측).
export function splitRefLinkText(text) {
  const m = /^([A-Za-z][A-Za-z0-9_]*-\d+)\s+([\s\S]+)$/.exec(text);
  if (m) return { displayId: m[1], title: m[2] };
  return { displayId: '', title: text };
}

// { displayId: 'WV-12', title: '로그인 버그' } → 'WV-12 로그인 버그' (이스케이프 포함) — splitRefLinkText의 역함수.
// taskRef/issueRef가 renderMarkdown 링크 텍스트를 만들 때 공유한다.
export function formatRefLabel(displayId, title) {
  return escapeLinkText([displayId, title].filter(Boolean).join(' '));
}

// md 링크 목적지(destination) 문법을 깨는 괄호를 percent-encode (CommonMark 관례).
// @tiptap/extension-link 공식 renderMarkdown은 href를 그대로 삽입하고(dist 실측),
// unbalanced ')'는 marked·markdown-it 양쪽에서 링크를 조기 종료시켜 href 절단을
// 일으킨다. %28/%29는 양쪽 파서 모두 href로 보존해 왕복 안정·멱등(실측).
// backend/library/html_markdown.py _esc_link_url과 동일 규칙(계약) — 링크 목적지를
// 만드는 renderMarkdown은 전부 이 헬퍼를 거친다(bookmark + 칩 3종).
export function encodeMarkdownUrl(url) {
  return String(url ?? '').replace(/\(/g, '%28').replace(/\)/g, '%29');
}
