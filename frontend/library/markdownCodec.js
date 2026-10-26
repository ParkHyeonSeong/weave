// Raw markdown 코덱 — 전 표면 공용 단일 진실원 (WEAVE-36 스펙 §3.1/§3.2, S0)
//
// 설계 메모(전부 3.20.1 dist 실측 기반):
// - 표면(extensions 배열)마다 격리된 marked 인스턴스를 주입한다. 전역 marked를 쓰면
//   (1) setOptions(breaks)가 전역 오염되고 (2) 한 표면이 등록한 커스텀 토크나이저
//   (mermaid/칩)가 다른 표면의 파싱에 흘러들어 "핸들러 없는 토큰 → 무음 드롭"이 생긴다.
//   격리 시 스키마에 없는 문법은 표준 md로 자연 강등된다(예: 댓글의 ```mermaid → codeBlock).
// - breaks: true는 markdownMath.js의 new Marked({ breaks: true })와 dialect 일치 조건.
// - MarkdownManager의 중첩 토크나이즈 헬퍼·리스트 재토큰화가 쓰는 this.lexer는 지금 토큰화 중인
//   렉서로 돌린다(createManager 주석 — 번호 목록·체크리스트·callout 뒤 블록이 비던 문제).
import { generateHTML, generateJSON } from '@tiptap/core';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import { createWeaveMarked, normalizeWeaveTokens } from './markedFactory';

const managerCache = new WeakMap();

// 이중 장착 방어(계약): buildMarkdownExtensions로 이미 래핑된 배열이 다시 들어와도
// 안전하도록 모든 진입점이 @tiptap/markdown 확장(name 'markdown')을 제거하고 쓴다.
// (S1 클립보드·S3 raw 모드는 에디터의 래핑된 extensions를 그대로 넘긴다.)
function stripMarkdownExtension(extensions) {
  return extensions.filter((e) => e?.name !== 'markdown');
}

function createManager(extensions) {
  // createWeaveMarked: md.Lexer가 정규화 subclass(bare URL de-link·빈 라벨 폴백)다. 이 manager의 리스트 재토큰화
  // (this.lexer.inlineTokens dist:392)는 아래 manager.lexer 래퍼를 거쳐 같은 정규화를 받는다.
  const md = createWeaveMarked();
  const manager = new MarkdownManager({ marked: md, extensions: stripMarkdownExtension(extensions) });
  // 커스텀 토크나이저(번호 목록·체크리스트·callout)의 중첩 토큰화 헬퍼와 리스트 재토큰화가 manager.lexer를 쓴다
  // (dist:190-196·392). 따로 만든 렉서로 돌리면 marked가 공유 토크나이저의 lexer를 그쪽으로 바꿔 둔 채 돌아와
  // 뒤 블록의 인라인 작업이 처리되지 않는 큐로 들어가고, 번호 목록 뒤 문단·인용이 빈 문단이 된다.
  // 업스트림 3.21.0처럼 지금 토큰화 중인 렉서(공유 토크나이저가 가리킴)를 쓴다. 인라인 결과는 지금처럼 정규화한다
  // (최상위 렉서는 기본 Lexer라 WeaveLexer.inlineTokens의 정규화를 여기서 대신 한다 — 두 번 해도 같다).
  // 공유 토크나이저를 만든다. 첫 파싱 전 호출은 이 렉서가 받는다(marked는 파싱 뒤 tokenizer.lexer를 되돌리지 않아
  // 그 뒤로는 마지막에 쓴 렉서를 가리킨다).
  const fallback = new md.Lexer(md.defaults);
  const active = () => md.defaults.tokenizer?.lexer || fallback;
  manager.lexer = {
    inlineTokens: (src) => normalizeWeaveTokens(active().inlineTokens(src), false),
    blockTokens: (src) => active().blockTokens(src),
  };
  return manager;
}

// extensions 배열 "identity" 기준 캐시 — 호출부는 배열을 메모이즈해 넘길 것.
// (매 호출 새 배열이면 매니저가 매번 재생성될 뿐 동작은 동일하다.)
export function getMarkdownManager(extensions) {
  let manager = managerCache.get(extensions);
  if (!manager) {
    manager = createManager(extensions);
    managerCache.set(extensions, manager);
  }
  return manager;
}

// 에디터용: 기존 extensions에 @tiptap/markdown 확장을 덧붙인다.
// contentType: 'markdown' 파싱과 editor.getMarkdown()/editor.markdown이 활성화된다(S3 raw 모드용).
export function buildMarkdownExtensions(extensions) {
  // createWeaveMarked: TipTap Markdown.configure의 별도 manager(editor.markdown, contentType md)도
  // new markedInstance.Lexer()로 정규화 subclass를 받아 dialect·빈 라벨 폴백이 적용된다.
  return [...extensions, Markdown.configure({ marked: createWeaveMarked() })];
}

// raw 모드·전체 직렬화: 에디터 현재 문서 → markdown
export function docToMarkdown(editor) {
  return getMarkdownManager(editor.extensionManager.extensions).serialize(editor.getJSON());
}

// 선택 복사: ProseMirror Slice → markdown (S1 clipboardTextSerializer용)
export function sliceToMarkdown(editor, slice) {
  const content = slice.content.toJSON() || [];
  const { nodes } = editor.schema;
  // 문단 중간 선택은 최상위에 인라인/텍스트 노드가 나온다 — serializer는 블록을 기대하므로 감싼다
  const blocks = [];
  let inlineRun = [];
  const flush = () => {
    if (inlineRun.length) {
      blocks.push({ type: 'paragraph', content: inlineRun });
      inlineRun = [];
    }
  };
  for (const node of content) {
    if (nodes[node.type]?.isBlock) {
      flush();
      blocks.push(node);
    } else {
      inlineRun.push(node);
    }
  }
  flush();
  return getMarkdownManager(editor.extensionManager.extensions).serialize({ type: 'doc', content: blocks });
}

// 읽기 뷰 headless 변환: 저장 HTML → markdown (S1 Copy as Markdown용)
export function htmlToMarkdown(html, extensions) {
  if (!html) return '';
  return getMarkdownManager(extensions).serialize(generateJSON(html, stripMarkdownExtension(extensions)));
}

// raw 복귀/왕복: markdown → 에디터 HTML
export function markdownToEditorHtml(md, extensions) {
  if (!md) return '';
  return generateHTML(getMarkdownManager(extensions).parse(md), stripMarkdownExtension(extensions));
}

// md에 표현이 없어 직렬화 시 단순화되는 서식 수집 — raw 토글 경고 배지용 (스펙 §4.4).
// doc은 editor.getJSON() 형태의 JSONContent.
export function findUnsupportedFormatting(doc) {
  const found = new Set();
  const visit = (node) => {
    if (!node) return;
    for (const mark of node.marks || []) {
      // underline은 여기서 플래그하지 않는다: @tiptap/extension-underline이 자체
      // markdown 확장(++text++)으로 무손실 왕복한다(실측: markdown_codec_cases.json
      // "underline-nonstandard" 픽스처, roundtrip 포함). 다른 서식과 달리 색상 등
      // 속성이 아니라 마크 존재만으로 무조건 플래그하던 것은 오탐이었다.
      if (mark.type === 'textStyle' && mark.attrs?.color) found.add('color');
      if (mark.type === 'highlight' && mark.attrs?.color) found.add('highlightColor');
    }
    if (node.type === 'image' && node.attrs?.width != null) found.add('imageWidth');
    if (node.attrs?.textAlign && node.attrs.textAlign !== 'left') found.add('textAlign');
    if ((node.type === 'tableCell' || node.type === 'tableHeader') && node.attrs?.backgroundColor) {
      found.add('cellBackground');
    }
    (node.content || []).forEach(visit);
  };
  visit(doc);
  return [...found];
}
