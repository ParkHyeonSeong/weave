import { Marked } from 'marked';

// Weave 공용 markdown dialect (WEAVE-36/37). **최종 단일 구현**(9차 리뷰: 이전 walkTokens
// 방식은 폐기 — MarkdownManager는 lexer만 쓰고 parse/walkTokens를 안 거치므로 미실행).
// 핵심: bare URL/email 자동링크 제거(backend commonmark 정렬) + 빈 라벨 링크 폴백 +
// 무효 중첩 링크 언랩을, tokenizer를 끄지 않고(긴 bare email O(n²) 방지, 7차 실측 100k
// 2.1초→1ms) lexer 산출 토큰트리에 normalizeWeaveTokens를 적용해 처리한다.

// 단일 링크 토큰 정규화(dialect + 빈 라벨) — Task 4·5 통합(7차 리뷰). true 반환 = 이 노드를
// text로 강등했으니 자식 재귀 불필요. inLink = 다른 링크 안(중첩).
export function normalizeWeaveTokenNode(t, inLink) {
  if (t.type !== 'link') return false;
  // (Task 4) bare URL/email autolink(raw가 대괄호·꺾쇠로 시작 안 함) → 평문. dialect 통일 +
  //          tokenizer 무력화 대신 여기서 처리해 perf 정상(7차: 100k 1ms).
  if (t.raw && t.raw[0] !== '[' && t.raw[0] !== '<') { t.type = 'text'; t.text = t.raw; t.tokens = undefined; return true; }
  // (Task 5) 중첩 링크 → 원문 텍스트로 언랩(무효 중첩 <a> 방지, inner 원문 보존 — tokens 비움 필수).
  if (inLink) { t.type = 'text'; t.text = t.raw; t.tokens = undefined; return true; }
  // (Task 5) 빈 라벨: href 있으면 href를 라벨로, href도 비면([]) 원문 리터럴로 강등.
  if (!(t.tokens && t.tokens.length)) {
    if (t.href) { t.tokens = [{ type: 'text', raw: t.href, text: t.href }]; return false; }
    t.type = 'text'; t.text = t.raw; t.tokens = undefined; return true;
  }
  return false;
}

// 트리 재귀(ancestry-aware) — table 셀·list items 모두 순회.
// ⚠️ `t.tokens || t.items` 금지: t.tokens가 빈 배열([])이면 truthy라 items를 건너뛴다(9차 P1).
// tokens/items를 각각 재귀한다(marked 토큰은 둘 중 하나만 실질 보유 — walk(undefined)는 no-op).
export function normalizeWeaveTokens(tokens, inLink = false) {
  if (!tokens) return tokens;
  for (const t of tokens) {
    if (t.type === 'link') {
      if (normalizeWeaveTokenNode(t, inLink)) continue;   // text로 강등됨
      normalizeWeaveTokens(t.tokens, true);
    } else if (t.type === 'table') {
      (t.header || []).forEach((c) => normalizeWeaveTokens(c.tokens, inLink));
      (t.rows || []).forEach((r) => r.forEach((c) => normalizeWeaveTokens(c.tokens, inLink)));
    } else {
      normalizeWeaveTokens(t.tokens, inLink);
      normalizeWeaveTokens(t.items, inLink);
    }
  }
  return tokens;
}

// 렌더 진입점 — markdownMath.markdownToHtml이 .parse() 대신 이 경로를 쓰도록 교체.
// createWeaveMarked의 md.lexer가 이미 정규화하므로 여기서 재정규화하지 않는다(이중 방지).
export function weaveMarkedToHtml(marked, src) {
  return marked.parser(marked.lexer(src));
}

// 인스턴스 전용 Lexer subclass + md.lexer 래핑(10차 리뷰). MarkdownManager는 self로
// `new this.markedInstance.Lexer()`(dist:111·125·179)를 만들어 리스트를 재토큰화하므로
// (this.lexer.inlineTokens dist:392), 인스턴스의 Lexer 자체를 정규화 subclass로 바꾸면
// TipTap Markdown.configure의 별도 manager(dist:966)가 자동으로 정규화된다. markdownCodec의
// manager는 manager.lexer를 지금 토큰화 중인 렉서 래퍼로 바꿔 그 래퍼가 같은 정규화를 한다
// (markdownCodec.createManager). md.Lexer는 인스턴스 간 공유(9차)라 own-property로 shadow하면
// 격리된다(md2·detectMarked 무오염 — 실측). inlineTokens(src, tokens)는 accumulator 인자를
// mutate/반환하므로 **...args로 전량 보존**한다(10차 P1).
export function createWeaveMarked() {
  const md = new Marked({ breaks: true });
  const rawLexer = md.lexer.bind(md);
  // ⚠️ md.parse()는 이 shadow를 호출하지 않는다(12차 실측) — 이 shadow는 MarkdownManager의
  //    top-level 호출(this.markedInstance.lexer, dist:291·379)과 weaveMarkedToHtml 전용.
  md.lexer = (...args) => normalizeWeaveTokens(rawLexer(...args), false);
  const BaseLexer = md.Lexer;
  md.Lexer = class WeaveLexer extends BaseLexer {
    // TipTap MarkdownManager는 `new markedInstance.Lexer()`를 **인자 없이** 호출한다(dist:111)
    // → constructor가 없으면 인스턴스 defaults(breaks:true·custom tokenizer)를 잃는다
    // (11차 실측: no-arg 생성 시 breaks=false). 기본값으로 md.defaults를 주입.
    constructor(options = md.defaults) { super(options); }
    // inlineTokens만 오버라이드한다. blockTokens 오버라이드는 두지 않는다 — 블록 레벨은 래핑된
    // md.lexer(dist:291·379)가 토큰 트리 전체를 정규화한다. 번호 목록·체크리스트·callout 토크나이저의
    // 헬퍼와 리스트 재토큰화(dist:392)는 markdownCodec.js createManager가 지금 토큰화 중인 렉서로
    // 돌리고, 그쪽 인라인 결과도 같은 정규화를 거친다.
    inlineTokens(...args) { return normalizeWeaveTokens(super.inlineTokens(...args), false); }
  };
  return md;
}
