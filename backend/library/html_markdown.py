"""HTML ↔ Markdown 변환기 (WEAVE-36 S2).

egress(html_to_markdown): markdownify 기반 + Weave 커스텀 노드 규칙 —
  ref 칩→내부 URL 링크, mention→@username 평문, data-latex→$..$/$$..$$,
  mermaid data-source→펜스, callout→`:::callout {type=".."}` 디렉티브(공백·따옴표 포함 — JS 실측 기준),
  bookmark→[title||url](url) 한 줄(제목 공백 시 url 폴백 — JS와 동일), 미커버 태그→텍스트 강등.
  이 외 markdownify 기본값과 JS(golden fixture) 사이 실측 드리프트를 메운 규칙
  (전부 test_markdown_codec_parity.py로 강제): li 내부 문단은 tight list로 좁힘,
  taskItem li→`- [ ]`/`- [x]`, GFM 테이블 컬럼 패딩, `<u>`→`++..++`, `<mark>`→`==..==`,
  `<pre><code class="language-x">`→펜스 info string.
ingress(markdown_to_html): markdown-it-py(commonmark)+GFM(table/strikethrough/
  tasklists). breaks=True 필수 — frontend `new Marked({breaks:true})`
  (markdownMath.js:64)와 dialect 일치. 수식은 dollarmath로 frontend와 동일한
  data-latex span/div 마크업을 출력한다.

frontend 대응물은 frontend/library/markdownCodec.js — 양쪽 dialect는
backend/tests/fixtures/markdown_codec_cases.json golden fixture로 강제된다
(test_markdown_codec_parity.py). 한쪽만 고치는 변경 금지.

라이브러리 실측 편차(설치판: markdownify 1.2.3 / markdown-it-py 4.2.0 /
mdit-py-plugins 0.6.1) — 상세는 .superpowers/sdd/task-S2.1-report.md:
  - markdownify 1.x는 convert_fn(node, text, parent_tags=parent_tags)처럼
    parent_tags를 "키워드 인자"로 넘긴다. 브리프가 제안한 `*args`만으로는
    흡수되지 않아(TypeError: unexpected keyword argument) `*args, **kwargs`로
    변경했다 (0.x의 위치 인자 convert_as_inline도 함께 흡수).
  - dollarmath_plugin 토큰명(math_inline/math_inline_double/math_block)과
    옵션명(allow_space/allow_digits/double_inline)은 브리프 그대로 실측 일치.
"""
import re

from markdown_it import MarkdownIt
from markdown_it.token import Token  # [](url) 빈 라벨 폴백 core rule (WEAVE-37, JS엔 state.Token 있으나 py엔 없음)
from markdownify import MarkdownConverter, abstract_inline_conversion, chomp
from mdit_py_plugins.dollarmath import dollarmath_plugin
from mdit_py_plugins.tasklists import tasklists_plugin

import config

# frontend ensureHtml.js:7과 동일 정규식 (계약)
_HTML_TAG_RE = re.compile(r'<[a-z][\s\S]*>', re.I)


def _base_url() -> str:
    """칩 링크의 base. FRONTEND_URL 설정 시 절대 URL, 아니면 상대경로
    (admin.py 재설정 링크와 동일 관례). 호출 시점 조회 — 테스트 monkeypatch 가능."""
    return config.FRONTEND_URL or ''


# frontend refMarkdown.js:13-15 escapeLinkText와 동일(단일 패스, 동일 문자셋) —
# md 링크 텍스트 문법을 깨는 \ [ ]를 백슬래시 escape. 미적용 시 unbalanced
# bracket title이 링크 문법을 닫아버려 markdown_to_html 왕복에서 링크가 소실된다.
_LINK_TEXT_ESC_RE = re.compile(r'([\\\[\]])')


def _esc_link_text(text) -> str:
    return _LINK_TEXT_ESC_RE.sub(r'\\\1', str(text if text is not None else ''))


def _esc_link_url(url) -> str:
    """frontend refMarkdown.js encodeMarkdownUrl과 동일 규칙(계약) — md 링크
    목적지의 괄호를 %28/%29로 percent-encode. unbalanced ')'는 markdown-it·
    marked 양쪽에서 링크를 조기 종료시켜 href 절단을 일으킨다(실측). 멱등."""
    return str(url or '').replace('(', '%28').replace(')', '%29')


def _chip_link(label: str, path: str) -> str:
    """[esc(label)](base_url + path) — ref 칩 3종(task/issue/doc) 공용 링크 조립."""
    return f"[{_esc_link_text(label)}]({_esc_link_url(_base_url() + path)})"


# ---------------------------------------------------------------------------
# egress: HTML → Markdown
# ---------------------------------------------------------------------------

class _WeaveConverter(MarkdownConverter):
    # markdownify 0.x는 (el, text, convert_as_inline) 위치 인자, 1.x는
    # (el, text, parent_tags=parent_tags) 키워드 인자로 넘긴다 — *args와
    # **kwargs를 함께 받아 양쪽 버전을 흡수한다.

    def convert_span(self, el, text, *args, **kwargs):
        if el.get('data-task-ref'):
            # JS formatRefLabel(refMarkdown.js:53-55)과 동일 — 라벨 전체 escape
            label = f"{el.get('data-display-id', '')} {el.get('data-title', '')}".strip()
            return _chip_link(label, f"/branch/{el.get('data-branch-id')}/task/{el.get('data-task-id')}")
        if el.get('data-issue-ref'):
            label = f"{el.get('data-display-id', '')} {el.get('data-title', '')}".strip()
            return _chip_link(label, f"/branch/{el.get('data-branch-id')}"
                               f"/task/{el.get('data-task-id')}/issue/{el.get('data-issue-id')}")
        if el.get('data-doc-ref'):
            return _chip_link(el.get('data-title', ''),
                               f"/canvas/{el.get('data-canvas-id')}/{el.get('data-page-id')}")
        if el.get('data-mention'):
            return f"@{el.get('data-username', '')}"
        if el.get('data-type') == 'inline-math':
            return f"${el.get('data-latex', '')}$"
        if el.get('data-ref-badge'):
            return ''   # 칩 내부 상태 배지 — 링크 강등 시 소거
        return text

    def convert_div(self, el, text, *args, **kwargs):
        if el.get('data-type') == 'block-math':
            return f"\n$$\n{el.get('data-latex', '')}\n$$\n\n"
        if el.get('data-mermaid') is not None:
            return f"\n```mermaid\n{el.get('data-source', '')}\n```\n\n"
        if el.get('data-callout'):
            # canonical = JS createBlockMarkdownSpec 실측 출력(공백·따옴표·빈 줄 — S0.3에서 확정)
            return f'\n:::callout {{type="{el.get("data-callout")}"}}\n\n{text.strip()}\n\n:::\n\n'
        if el.get('data-bookmark') is not None:
            # JS 폴백(BookmarkExtension.js:39)과 동일 — title 공백 시 url을 라벨로.
            label = el.get('data-title') or el.get('data-url', '')
            return f"\n[{_esc_link_text(label)}]({_esc_link_url(el.get('data-url', ''))})\n\n"
        return text  # 미커버 div — 텍스트 강등

    def convert_a(self, el, text, parent_tags):
        # 기본 markdownify convert_a의 _noformat 가드·chomp를 **그대로 보존**하고(8차 P1:
        # 누락 시 <code><a>y</a></code>가 'y'가 아니라 '[y](url)'로 오염), autolink 축약만
        # 덮어쓴다. 축약(<url>)은 egress→ingress 재왕복에서 is_html 오판으로 raw 저장되므로
        # (7차 실측) text==href여도 **항상 명시적 [label](url)**. href 괄호는 _esc_link_url,
        # title은 backslash-먼저 escape(frontend WeaveLink와 동일).
        if '_noformat' in parent_tags:
            return text
        prefix, suffix, text = chomp(text)
        if not text:
            return ''
        href = el.get('href')
        if not href:
            return text
        dest = _esc_link_url(href)
        title = el.get('title')
        if title:
            t = title.replace('\\', '\\\\').replace('"', '\\"')
            return f'{prefix}[{text}]({dest} "{t}"){suffix}'
        return f'{prefix}[{text}]({dest}){suffix}'
    # 주의(5·7차): 라벨 text의 [·] escape는 markdownify가 text를 이미 처리한 뒤라 여기서
    # 재escape는 이중이 될 수 있어 두지 않는다 — 라벨 특수문자 왕복은 frontend와 함께 D3 한계.

    # markdownify 기본값은 제목·표 칸 안의 이미지를 alt 글자로 바꾼다 — 편집기로 올린 이미지는
    # alt가 비어 있어 주소까지 통째로 사라졌다. JS(표 칸 실측: ![](src) 유지)처럼 어디서든 이미지로 쓴다.
    def convert_img(self, el, text, parent_tags):
        return super().convert_img(el, text, parent_tags - {'_inline'})

    # Tiptap 리스트 아이템은 항상 자식을 <p>로 감싼다. markdownify 기본값은
    # p를 앞뒤 빈 줄(\n\n)로 감싸 li 안에 중첩 리스트가 있으면 그 사이에
    # 빈 줄이 끼어든다 — JS(@tiptap/markdown, tight list)는 빈 줄 없이
    # 붙여 렌더링(golden fixture 실측: bullet-list-nested). li 내부의
    # p만 단일 개행으로 좁힌다.
    def convert_p(self, el, text, *args, **kwargs):
        parent_tags = kwargs.get('parent_tags') or (args[0] if args else set())
        if '_inline' in parent_tags:
            return ' ' + text.strip(' \t\r\n') + ' '
        text = text.strip(' \t\r\n')
        if not text:
            return ''
        if 'li' in parent_tags:
            return text + '\n'
        return '\n\n%s\n\n' % text

    # taskList 노드(data-type="taskItem" + data-checked) → GFM `- [ ]`/`- [x]`.
    # markdownify는 checkbox 마크업을 모르므로 기본 bullet 뒤에 박스를 꽂아준다.
    def convert_li(self, el, text, *args, **kwargs):
        result = super().convert_li(el, text, *args, **kwargs)
        if el.get('data-type') == 'taskItem':
            box = '[x] ' if el.get('data-checked') == 'true' else '[ ] '
            m = re.match(r'^(\s*(?:[-*+]|\d+\.)\s)', result)
            if m:
                result = result[:m.end()] + box + result[m.end():]
        return result

    # GFM 테이블 — markdownify 기본(convert_td/tr이 셀을 '|' 구분 텍스트로
    # 이어붙임)은 셀 안 리터럴 `|`("a|b" 텍스트, 인라인 코드 등)와 구분자를
    # 사후에 분간할 수 없어, 렌더 텍스트 재분할 방식은 유령 컬럼을 만든다.
    # → 셀 markdown을 태그에 스태시해 두고(convert_th/td) 행 조립은
    # convert_table이 DOM(tr/th·td) 구조 기준으로 직접 수행한다.
    # dialect는 JS(@tiptap/markdown) 실측(golden fixture: table-gfm,
    # table-pipe-in-cell): 컬럼별 최대 폭(문자수, 최소 3) 좌측정렬 패딩,
    # 리터럴 `|`는 escape하지 않음 — JS도 raw로 내보내며 그 md의 재파싱이
    # 셀을 쪼개는 lossy함까지 양쪽 동일한 계약.
    def convert_th(self, el, text, *args, **kwargs):
        # 셀 markdown 스태시 — 자식이 부모보다 먼저 변환되므로(process_tag
        # bottom-up) convert_table 시점엔 항상 채워져 있다. soup 트리는
        # convert() 호출마다 새로 만들어져 상태 누수 없음.
        el._weave_cell = text.strip().replace('\n', ' ')
        return ''

    convert_td = convert_th

    def convert_tr(self, el, text, *args, **kwargs):
        return ''  # 행 조립은 convert_table에서 DOM 기준으로 수행

    def convert_table(self, el, text, *args, **kwargs):
        # 에디터 스키마엔 중첩 테이블이 없어 el.find_all('tr')로 충분.
        rows, header_flags = [], []
        for tr in el.find_all('tr'):
            cells = tr.find_all(['td', 'th'], recursive=False)
            if not cells:
                continue
            row = []
            for cell in cells:
                row.append(getattr(cell, '_weave_cell', ''))
                colspan = cell.get('colspan', '')
                span = max(1, min(1000, int(colspan))) if str(colspan).isdigit() else 1
                row.extend([''] * (span - 1))  # colspan>1 → 빈 셀 (stock convert_td와 동일)
            rows.append(row)
            header_flags.append(all(c.name == 'th' for c in cells))
        if not rows:
            return ''
        ncols = max(len(r) for r in rows)
        widths = [3] * ncols
        for row in rows:
            for c, cell in enumerate(row):
                widths[c] = max(widths[c], len(cell))

        def fmt(row):
            cells = row + [''] * (ncols - len(row))
            return '|' + '|'.join(f' {cells[c].ljust(widths[c])} ' for c in range(ncols)) + '|'

        sep = '|' + '|'.join(' ' + '-' * w + ' ' for w in widths) + '|'
        if header_flags[0]:
            lines = [fmt(rows[0]), sep] + [fmt(r) for r in rows[1:]]
        else:
            # 헤더 없는 표 — stock markdownify(table_infer_header=False)처럼 빈 헤더행
            lines = [fmt([''] * ncols), sep] + [fmt(r) for r in rows]
        # JS 산출물은 테이블 앞뒤 개행 1개씩을 남긴다(문서 경계에서도 — 다른
        # 블록의 이중개행과 달리 전역 strip 대상이 아님). NUL 보초로 감싸
        # html_to_markdown()의 strip()을 통과시킨 뒤 최종 제거한다.
        return _TABLE_GUARD + '\n' + '\n'.join(lines) + '\n' + _TABLE_GUARD

    # 비표준 마크(에디터 커스텀 확장) — JS 직렬화 문법과 동일(golden fixture 실측).
    convert_u = abstract_inline_conversion(lambda self: '++')
    convert_mark = abstract_inline_conversion(lambda self: '==')


_TABLE_GUARD = '\x00'


def _code_language(el):
    # <pre><code class="language-js"> → 펜스 info string "js" (Prism/highlight.js 관례).
    code_el = el.find('code')
    if not code_el:
        return ''
    for cls in code_el.get('class') or []:
        if cls.startswith('language-'):
            return cls[len('language-'):]
    return ''


# bullets/heading 스타일은 golden fixture(S0의 JS 코덱 출력)가 최종 심판 —
# fixture 불일치 시 여기 옵션을 fixture에 맞춰 조정한다 (코드가 아니라 옵션으로).
_CONVERTER_OPTIONS = dict(
    heading_style='atx', bullets='-', strong_em_symbol='*',
    code_language_callback=_code_language,
)


# egress 전용 HTML 판별 — is_html(<[a-z][\s\S]*>)은 markdown autolink
# <https://example.com>·<user@example.com>까지 HTML로 오판해 markdownify가
# 통째로 삭제한다(실측). 이전엔 "문서 시작에 anchored된 태그 정규식"으로
# 걸렀으나 양방향으로 깨졌다(실측):
#  (a) `hello <strong>bold</strong>` — ingress ensure_html(is_html=True)이
#      유효 HTML로 저장하는데, 루트 태그로 시작하지 않아 raw markdown으로
#      오판 → format=markdown 응답에 HTML이 그대로 반환(계약 위반).
#  (b) `    <p>literal</p>` — 표준 md 4칸 들여쓰기 코드블록인데 선두 \s*가
#      들여쓰기를 삼켜 HTML로 오판 → markdownify가 코드블록을 축약·파괴.
# 대신 commonmark 파서로 실제 파싱해 html_block/html_inline 토큰 존재
# 여부로 판별한다 — CommonMark 스펙이 정의하는 "진짜 HTML 컨텍스트"만
# 인정하므로 autolink·인라인 코드 속 `<p>`·```html``` 펜스 예제·들여쓰기
# 코드블록은 전부 걸러지고, 텍스트 어디에 있든 실제 HTML 태그는 인식된다.
# html_inline은 inline 토큰의 children 안에 있어 children까지 스캔해야
# 한다. is_html 자체는 ingress(§3.4)·frontend ensureHtml과 공유하는
# 계약이라 여기서 바꾸지 않는다(동일 오판의 ingress 정렬은 후속).
#
# 토큰 타입만으로는 부족하다(실측) — CommonMark는 HTML 주석·DOCTYPE·PI·CDATA도
# 전부 html_block/html_inline으로 파싱하는데, 이들만 있거나 이들 **내부에** 태그
# 예제가 박혀 있을 뿐인 입력은 legacy raw markdown으로 보고 _is_html_for_egress=
# False(원문 보존)여야 한다 — 단, 특수 구문이 닫힌 *뒤에* 같은 토큰 안에서 진짜
# 태그가 이어지면(`<!-- note --> <p>x</p>`처럼) _is_html_for_egress=True다.
# (ingress의 is_html은 별개 — 태그 예제가 특수 구문 안에 있어도 letter-tag
# search라 True를 돌려준다. 예: is_html('<!-- <p>x</p> -->')==True.) 처음엔 토큰 타입 매치에
# 더해 content가 is_html과 동일한 letter-tag 정규식(_HTML_TAG_RE)에 매치할
# 때만 HTML로 인정했으나, 이 문자열 search는 주석/CDATA/PI **안에** 박힌 태그
# 예제까지 real tag로 오판한다(실측):
#  `<!-- example <p>literal</p> -->` → ''(통째 삭제), `hello <!-- <p>literal</p> -->`
#  → 'hello'(주석 뒤 통째 삭제), `<![CDATA[<p>literal</p>]]>` → '<p>literal</p>'
#  (CDATA 래퍼가 벗겨짐), `<?pi <p>literal</p>?>` → 'pi <pliteral?>'(훼손).
# html.parser.HTMLParser 이벤트로 대체했던 두 번째 시도도 깨졌다(실측) —
# HTMLParser와 CommonMark는 주석/PI 종료 규칙이 다르다:
#  `<?pi data > example <p>literal</p> ?>` — CommonMark는 `?>`까지 통째로 PI인데
#  HTMLParser는 첫 `>`에서 PI를 끝내 내부 `<p>`를 real tag로 오판·훼손한다.
#  `<!-- note --!> <p>literal</p> -->` — CommonMark는 마지막 `-->`까지 주석인데
#  HTMLParser는 `--!>`도 주석 종료로 인정해 뒤의 `<p>`를 real tag로 오판한다.
# 대신 content를 같은 commonmark 파서(_EGRESS_HTML_DETECTOR)의 parseInline()
# 으로 재토큰화한다 — CommonMark inline 토크나이저는 주석/PI/CDATA/decl 같은
# 특수 구문 하나를 통째로 한 html_inline 토큰으로 만든다(관련 특수 구문의
# 종료 경계가 블록 파서와 동일한 CommonMark 규칙). 그래서 각 html_inline 토큰의 content가
# opening/startend 태그로 시작하는지(`<[a-zA-Z]` 접두)만 보면 특수 구문 내부에
# 박힌 태그 예제는 그 토큰 content가 `<!`/`<?`/`</`로 시작해 자연히 배제되고,
# 특수 구문이 닫힌 뒤에 이어지는 진짜 태그는 별도 html_inline 토큰으로 쪼개져
# 나와 정상 인식된다. is_html 자체는 ingress(§3.4)·frontend ensureHtml과
# 공유하는 계약이라 여기서 바꾸지 않는다(동일 오판의 ingress 정렬은 후속) —
# _HTML_TAG_RE는 그 계약을 위해 그대로 유지한다.
_EGRESS_HTML_DETECTOR = MarkdownIt('commonmark', {'html': True})

_OPENING_TAG_RE = re.compile(r'<[a-zA-Z]')


def _content_has_real_tag(content: str) -> bool:
    """content를 commonmark inline 문법(parseInline)으로 재토큰화해, opening/
    startend 태그로 시작하는 html_inline 토큰이 하나라도 있으면 True."""
    for block in _EGRESS_HTML_DETECTOR.parseInline(content):
        if block.type != 'inline' or not block.children:
            continue
        for child in block.children:
            if child.type == 'html_inline' and _OPENING_TAG_RE.match(child.content):
                return True
    return False


def _is_html_for_egress(text: str) -> bool:
    for token in _EGRESS_HTML_DETECTOR.parse(text):
        if token.type == 'html_block' and _content_has_real_tag(token.content):
            return True
        if token.type == 'inline' and token.children:
            for child in token.children:
                if child.type == 'html_inline' and _content_has_real_tag(child.content):
                    return True
    return False


def html_to_markdown(html: str) -> str:
    r"""HTML → markdown. 실제 HTML 태그가 없는 입력은 변환 없이 원문 그대로
    반환한다 — ingress 픽스 이전에 저장된 legacy raw markdown/plain text를
    markdownify에 통과시키면 `**`→`\*\*` escape·빈 줄 접힘으로 오염되고,
    markdown autolink(<https://...>)는 통째로 삭제되기 때문. 판별은 autolink와
    본문 속 태그 예제를 오판하는 is_html이 아니라, markdown-it의
    html_block/html_inline 토큰 감지(_is_html_for_egress)를 쓴다.
    """
    if not html:
        return ''
    if not _is_html_for_egress(html):
        return html
    # U+0000은 HTML 무효 문자(파서 단계에서 U+FFFD 치환/드롭 대상) — 입력에서
    # 선제 제거해 아래 _TABLE_GUARD 보초와 절대 충돌하지 않게 한다.
    html = html.replace(_TABLE_GUARD, '')
    md = _WeaveConverter(**_CONVERTER_OPTIONS).convert(html).strip()
    # blockquote 안 테이블은 보초 줄이 '> \x00'로 프리픽스된다 — JS 실측은
    # 빈 '>' 줄이므로 공백까지 함께 걷어낸다. 문서 경계 보초는 두 번째 replace.
    return md.replace('> ' + _TABLE_GUARD, '>').replace(_TABLE_GUARD, '')


# ---------------------------------------------------------------------------
# ingress: Markdown → HTML
# ---------------------------------------------------------------------------

def _esc_attr(s: str) -> str:
    # frontend markdownMath.js escapeAttr와 동일 (data-latex 속성값)
    return (s.replace('&', '&amp;').replace('<', '&lt;')
             .replace('>', '&gt;').replace('"', '&quot;'))


def _render_inline_math(self, tokens, idx, options, env):
    return f'<span data-type="inline-math" data-latex="{_esc_attr(tokens[idx].content)}"></span>'


def _render_block_math(self, tokens, idx, options, env):
    return f'<div data-type="block-math" data-latex="{_esc_attr(tokens[idx].content.strip())}"></div>\n'


def _build_parser() -> MarkdownIt:
    md = (MarkdownIt('commonmark', {'breaks': True, 'html': False, 'xhtmlOut': False})
          .enable('table')
          .enable('strikethrough'))
    md.use(tasklists_plugin)
    # allow_space=False/allow_digits=False — frontend 인라인 가드와 동일
    # (여닫는 $ 안쪽 공백 금지, 닫는 $ 뒤 숫자 금지). double_inline=True —
    # 문단 중간 $$..$$도 인라인 (markdownMath.js inline tokenizer와 동일).
    md.use(dollarmath_plugin, allow_space=False, allow_digits=False, double_inline=True)
    md.add_render_rule('math_inline', _render_inline_math)
    md.add_render_rule('math_inline_double', _render_inline_math)
    md.add_render_rule('math_block', _render_block_math)

    def _empty_link_label(state):
        # [](url) → markdown-it은 빈 <a></a>를 렌더해 라벨/URL이 무음 소실된다(WEAVE-37).
        # link_open 직후가 link_close면: href 있음 → href를 라벨 텍스트로 주입,
        # href도 빈 []() → 빈 <a href="">가 남지 않게 쌍 자체를 제거.
        # in-place insert/del은 최악 O(n²)이므로 새 리스트를 한 번에 조립한다(8차 보완).
        for token in state.tokens:
            if token.type != 'inline' or not token.children:
                continue
            kids = token.children
            out = []
            i = 0
            n = len(kids)
            while i < n:
                t = kids[i]
                if t.type == 'link_open' and i + 1 < n and kids[i + 1].type == 'link_close':
                    href = t.attrGet('href') or ''
                    if href:
                        text_tok = Token('text', '', 0)
                        text_tok.content = href
                        out.extend([t, text_tok, kids[i + 1]])
                    # href 비면 쌍을 통째로 버림(out에 아무것도 안 넣음)
                    i += 2
                    continue
                out.append(t)
                i += 1
            token.children = out
    md.core.ruler.push('weave_empty_link_label', _empty_link_label)
    return md


_PARSER = _build_parser()


def markdown_to_html(md: str) -> str:
    if not md:
        return ''
    return _PARSER.render(md)


def parse_markdown_tokens(md: str) -> list:
    """markdown_to_html과 같은 파서·설정으로 토큰만 만든다(ref 칩 변환 등 토큰 후처리용).
    render_markdown_tokens(parse_markdown_tokens(md)) == markdown_to_html(md)."""
    return _PARSER.parse(md or '')


def render_markdown_tokens(tokens: list) -> str:
    """parse_markdown_tokens 결과를 markdown_to_html과 같은 렌더러로 HTML로 만든다."""
    return _PARSER.renderer.render(tokens, _PARSER.options, {})


def is_html(text: str) -> bool:
    return bool(text) and bool(_HTML_TAG_RE.search(text))


def ensure_html(text: str) -> str:
    """HTML이면 그대로, 태그가 없으면 markdown으로 간주해 변환 (§3.4 휴리스틱)."""
    if not text or is_html(text):
        return text
    return markdown_to_html(text)
