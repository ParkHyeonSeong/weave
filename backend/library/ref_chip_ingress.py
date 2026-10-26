"""MCP·API 마크다운의 Weave 내부 링크를 ref 칩으로 저장한다.

설계: docs/superpowers/specs/2026-10-22-ref-link-chip-ingress-design.md
- 순수 변환(markdown_to_html/ensure_html)은 그대로 두고, 같은 markdown-it 토큰을 다시
  렌더하면서 이 Weave를 가리키는 링크(태스크·이슈·문서)만 칩 HTML로 바꾼다.
- 칩 HTML은 프론트 renderHTML 원문(TaskRefExtension/IssueRefExtension/DocRefExtension)과
  같은 속성·순서·이스케이프다. 편집기는 다시 저장할 때 배지 style만 rgba()로 정규화해 늘리므로
  (jsdom·크롬 공통 실측) 그 증가분은 재저장 상한 U에 더한다.
- 길이 제한이 있는 경로는 브라우저 재저장 상한 U(C)가 제한 이하일 때만 칩 버전을 저장하고,
  아니면 본문 전체를 기존 출력(일반 링크) 그대로 저장한다(A안, §5.8).
"""
import math
import re
from html.parser import HTMLParser
from urllib.parse import urlsplit

from markdown_it.token import Token

import config
from core.model import canvas_page as page_model
from core.model import task as task_model
from core.model import task_issue as issue_model
from library import origins
from library.html_markdown import (
    ensure_html, is_html, markdown_to_html, parse_markdown_tokens, render_markdown_tokens,
)
from library.html_sanitize import sanitize_html

# ---------------------------------------------------------------------------
# 주소 판정 (§5.2) — 경로가 정확히 일치할 때만, 쿼리·조각·뒤 경로가 붙으면 일반 링크
# ---------------------------------------------------------------------------

# id는 DB int32 — 범위 밖 id 링크 하나로 저장 전체가 실패하지 않게 10자리·int32 이내만 칩 후보로 본다.
_ID = r'(\d{1,10})'
_INT32_MAX = 2147483647
_ISSUE_PATH = re.compile(rf'/branch/{_ID}/task/{_ID}/issue/{_ID}')
_TASK_PATH = re.compile(rf'/branch/{_ID}/task/{_ID}')
_DOC_PATH = re.compile(rf'/canvas/{_ID}/{_ID}')


def _is_internal_origin(scheme: str, netloc: str) -> bool:
    origin = f'{scheme}://{netloc}'.lower()
    frontend = (config.FRONTEND_URL or '').lower()
    if frontend and origin == frontend:
        return True
    return origins.is_allowed_origin(origin)


def match_ref_href(href: str):
    """href가 이 Weave의 태스크·이슈·문서를 정확히 가리키면 ('task', B, T) / ('issue', B, T, I) /
    ('doc', C, P), 아니면 None. 상대 경로 또는 FRONTEND_URL·허용 출처(origins.py)만 내부로 본다."""
    if not href or '?' in href or '#' in href:
        return None
    try:
        parts = urlsplit(href)
    except ValueError:
        return None
    if parts.netloc:
        if parts.scheme not in ('http', 'https') or not _is_internal_origin(parts.scheme, parts.netloc):
            return None
    elif parts.scheme or not href.startswith('/'):
        return None
    for kind, pattern in (('issue', _ISSUE_PATH), ('task', _TASK_PATH), ('doc', _DOC_PATH)):
        m = pattern.fullmatch(parts.path)
        if m:
            ids = tuple(int(g) for g in m.groups())
            return (kind, *ids) if max(ids) <= _INT32_MAX else None
    return None


# ---------------------------------------------------------------------------
# 칩 HTML (§5.4) — renderHTML 원문과 같은 속성 순서·값·이스케이프
# ---------------------------------------------------------------------------

def _esc_attr(value) -> str:
    # 브라우저 직렬화 규칙 중 가장 긴 형태(최신 HTML 표준은 속성의 < >도 이스케이프) —
    # 어느 브라우저에서 다시 저장해도 칩 문자열이 늘지 않게 한다.
    return (str(value).replace('&', '&amp;').replace('"', '&quot;')
            .replace('<', '&lt;').replace('>', '&gt;').replace('\xa0', '&nbsp;'))


def _esc_text(value) -> str:
    return (str(value).replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('\xa0', '&nbsp;'))


def _attrs(pairs) -> str:
    return ''.join(f' {name}="{_esc_attr(value)}"' for name, value in pairs)


def _format_status_key(key: str) -> str:
    # TaskRefExtension.js formatStatusKey와 동일: snake_case → Title Case (ASCII \b\w)
    return re.sub(r'\b\w', lambda m: m.group(0).upper(), key.replace('_', ' '), flags=re.ASCII)


def build_task_chip(info: dict) -> str:
    # 빈 값은 프론트 strAttr 기본값과 같게 채운다(재파싱 후 직렬화가 같은 문자열이 되도록).
    status = info.get('status') or 'todo'
    priority = info.get('priority') or 'medium'
    display_id = info.get('display_id') or ''
    title = info.get('title') or ''
    status_label = info.get('status_label') or ''
    status_color = info.get('status_color') or ''
    status_category = info.get('status_category') or ''
    label = status_label or _format_status_key(status)
    category = status_category or status
    badge = [('class', f'ref-chip__badge ref-chip__badge--{category}'), ('data-ref-badge', 'true')]
    if status_color:
        badge.append(('style', f'background-color: {status_color}20; color: {status_color}'))
    head = _attrs([
        ('data-task-ref', 'true'), ('data-task-id', info['task_id']), ('data-branch-id', info['branch_id']),
        ('data-display-id', display_id), ('data-title', title), ('data-status', status),
        ('data-priority', priority), ('data-status-label', status_label),
        ('data-status-color', status_color), ('data-status-category', status_category),
        ('class', 'task-ref'),
    ])
    return (f'<span{head}>{_esc_text(f"{display_id} {title}")}'
            f'<span{_attrs(badge)}>{_esc_text(label)}</span></span>')


def build_issue_chip(info: dict) -> str:
    status = info.get('status') or 'open'
    display_id = info.get('display_id') or ''
    title = info.get('title') or ''
    label = 'Open' if status == 'open' else 'Closed'
    head = _attrs([
        ('data-issue-ref', 'true'), ('data-issue-id', info['issue_id']), ('data-task-id', info['task_id']),
        ('data-branch-id', info['branch_id']), ('data-display-id', display_id), ('data-title', title),
        ('data-status', status), ('class', 'issue-ref'),
    ])
    badge = _attrs([('class', f'ref-chip__badge ref-chip__badge--{status}'), ('data-ref-badge', 'true')])
    return f'<span{head}>{_esc_text(f"{display_id} {title}")}<span{badge}>{label}</span></span>'


def build_doc_chip(info: dict) -> str:
    title = info.get('title') or ''
    head = _attrs([
        ('data-doc-ref', 'true'), ('data-page-id', info['page_id']), ('data-canvas-id', info['canvas_id']),
        ('data-title', title), ('data-canvas-name', info.get('canvas_name') or ''), ('class', 'doc-ref'),
    ])
    return f'<span{head}>{_esc_text(title)}</span>'


# ---------------------------------------------------------------------------
# 토큰 치환 — 링크 전체(link_open..link_close)를 칩 하나로 바꾼다. 오토링크는 대상 아님.
# ---------------------------------------------------------------------------

def _ref_links(children):
    """inline children에서 (link_open 위치, link_close 위치, 대상) 목록."""
    out = []
    for i, tok in enumerate(children):
        if tok.type != 'link_open' or tok.markup == 'autolink':
            continue
        target = match_ref_href(tok.attrGet('href') or '')
        if target is None:
            continue
        close = next((j for j in range(i + 1, len(children)) if children[j].type == 'link_close'), None)
        if close is not None:
            out.append((i, close, target))
    return out


def collect_ref_targets(md: str) -> set:
    targets = set()
    for tok in parse_markdown_tokens(md):
        if tok.type == 'inline' and tok.children:
            targets.update(target for _, _, target in _ref_links(tok.children))
    return targets


def render_with_chips(md: str, chips: dict) -> tuple:
    """chips(대상 → 칩 HTML)에 있는 링크만 칩으로 바꿔 렌더한다. 반환 (html, 바꾼 링크 수)."""
    tokens = parse_markdown_tokens(md)
    count = 0
    for tok in tokens:
        if tok.type != 'inline' or not tok.children:
            continue
        kids = tok.children
        replace = {start: (end, chips[target]) for start, end, target in _ref_links(kids) if target in chips}
        if not replace:
            continue
        out, i = [], 0
        while i < len(kids):
            if i in replace:
                end, chip = replace[i]
                html_tok = Token('html_inline', '', 0)
                html_tok.content = chip
                out.append(html_tok)
                count += 1
                i = end + 1
                continue
            out.append(kids[i])
            i += 1
        tok.children = out
    return render_markdown_tokens(tokens), count


# ---------------------------------------------------------------------------
# 브라우저 재저장 상한 U (§5.8.4) — 늘어나는 원인을 모두 더하고, 줄어드는 원인은 빼지 않는다.
# ---------------------------------------------------------------------------

LINK_ATTRS = ' target="_blank" rel="noopener noreferrer"'   # 세 편집기 WeaveLink 공통(실측 +42)
TRAILING_PARAGRAPH = '<p></p>'                               # TrailingNode가 끝에 붙이는 빈 문단
_LI_WRAP = len('<p></p>')
_QUOTE_WRAP = len('<p></p>')   # 빈 인용에도 문단이 생긴다
_NBSP_GROWTH = len('&nbsp;') - 1
_ATTR_ANGLE_GROWTH = len('&lt;') - 1   # 속성 안 < > — 최신 브라우저는 이스케이프한다
_MARK_TAG_LEN = {'strong': 17, 'em': 9, 's': 7, 'code': 13}
_CELL_GROWTH = len(' colspan="1" rowspan="1"') + len('<p></p>')
_COL = '<col style="min-width: 25px;">'
_UNKNOWN_CHIP_STYLE_ALLOWANCE = 80
_KNOWN_TAGS = frozenset({
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 's', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'a', 'img', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div', 'input',
})
_VOID_TAGS = frozenset({'img', 'hr', 'br', 'input'})


class _Node:
    __slots__ = ('tag', 'attrs', 'parent', 'children')

    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent, self.children = tag, attrs, parent, []


class _TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _Node('#root', {}, None)
        self.cur = self.root
        self.unknown = False
        self.attr_angles = 0

    def handle_starttag(self, tag, attrs):
        if tag not in _KNOWN_TAGS:
            self.unknown = True
        values = {name: (value or '') for name, value in attrs}
        self.attr_angles += sum(v.count('<') + v.count('>') for v in values.values())
        node = _Node(tag, values, self.cur)
        self.cur.children.append(node)
        if tag not in _VOID_TAGS:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID_TAGS:
            self.cur = self.cur.parent

    def handle_endtag(self, tag):
        node = self.cur
        while node is not self.root and node.tag != tag:
            node = node.parent
        if node is not self.root:
            self.cur = node.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def _is_chip(node) -> bool:
    return node.tag == 'span' and any(
        k in node.attrs for k in ('data-task-ref', 'data-issue-ref', 'data-doc-ref'))


def _is_atom(node) -> bool:
    return _is_chip(node) or node.tag in ('br', 'img') or (
        node.tag == 'span' and node.attrs.get('data-type') == 'inline-math')


def _leaves(node) -> int:
    """서식 요소 안의 조각 수(텍스트 노드 + 원자 노드). 직렬화가 서식 태그를 다시 열 수 있는 상한."""
    count = 0
    for child in node.children:
        if isinstance(child, str):
            count += 1 if child else 0
        elif _is_atom(child):
            count += 1
        else:
            count += _leaves(child)
    return count


def _is_standalone_image(img) -> bool:
    """최상위 문단에 이미지만 있는 경우(<p><img></p>) — 편집기가 <p></p><img>로 옮겨도 늘지 않는다."""
    parent = img.parent
    return (parent is not None and parent.tag == 'p' and parent.parent is not None
            and parent.parent.tag == '#root'
            and all(c is img or (isinstance(c, str) and not c.strip()) for c in parent.children))


def _chip_style_allowance(chip) -> int:
    """편집기가 다시 저장할 때 배지 style이 rgba()로 정규화되며 칩이 늘어나는 길이
    (2026-10-22 실측: jsdom·크롬 모두 `#9CA3AF20` → `rgba(156, 163, 175, 0.125)`)."""
    badge = next((c for c in chip.children if isinstance(c, _Node) and 'data-ref-badge' in c.attrs), None)
    style = badge.attrs.get('style') if badge else ''
    if not style:
        return 0
    color = chip.attrs.get('data-status-color') or ''
    if not re.fullmatch(r'#[0-9A-Fa-f]{6}', color):
        return _UNKNOWN_CHIP_STYLE_ALLOWANCE
    r, g, b = (int(color[i:i + 2], 16) for i in (1, 3, 5))
    normalized = f'background-color: rgba({r}, {g}, {b}, 0.125); color: rgb({r}, {g}, {b});'
    return max(0, len(normalized) - len(style))


def _link_open_len(node) -> int:
    href = _esc_attr(node.attrs.get('href', ''))
    title = f' title="{_esc_attr(node.attrs["title"])}"' if 'title' in node.attrs else ''
    return len(f'<a{LINK_ATTRS} href="{href}"{title}>')


def _growth(node) -> int:
    total = 0
    for child in node.children:
        if isinstance(child, str):
            continue
        if _is_chip(child):
            total += _chip_style_allowance(child)
            continue  # 칩 내부로는 내려가지 않는다
        tag = child.tag
        if tag == 'a':
            total += len(LINK_ATTRS) + max(0, _leaves(child) - 1) * (_link_open_len(child) + len('</a>'))
        elif tag in _MARK_TAG_LEN:
            total += max(0, _leaves(child) - 1) * _MARK_TAG_LEN[tag]
        elif tag == 'li':
            total += _LI_WRAP
        elif tag == 'blockquote':
            total += _QUOTE_WRAP
        elif tag == 'img' and not _is_standalone_image(child):
            return math.inf   # 블록 이미지가 글 중간·목록·제목·인용을 쪼갠다 — 칩 버전을 쓰지 않음
        elif tag == 'table':
            first_row = next(_iter_tag(child, 'tr'), None)
            cols = sum(1 for c in first_row.children
                       if isinstance(c, _Node) and c.tag in ('th', 'td')) if first_row else 0
            total += (len(f' style="min-width: {25 * cols}px;"') + len('<colgroup></colgroup>')
                      + cols * len(_COL))
        elif tag in ('th', 'td'):
            total += _CELL_GROWTH
        total += _growth(child)
    return total


def _iter_tag(node, tag):
    for child in node.children:
        if isinstance(child, _Node):
            if child.tag == tag:
                yield child
            yield from _iter_tag(child, tag)


def reserialize_upper_bound(html: str):
    """html을 브라우저 편집기에서 열어(자동 포커스 후) 수정 없이 저장할 때 길이의 상한.
    모르는 태그가 있으면 math.inf(= 칩 버전을 쓰지 않음)."""
    html = html or ''
    tree = _TreeBuilder()
    tree.feed(html)
    tree.close()
    if tree.unknown:
        return math.inf
    return (len(html) + _growth(tree.root) + _NBSP_GROWTH * html.count('\xa0')
            + _ATTR_ANGLE_GROWTH * tree.attr_angles + len(TRAILING_PARAGRAPH))


# ---------------------------------------------------------------------------
# 저장 경로 진입점 (§5.1·§5.3·§5.8.3)
# ---------------------------------------------------------------------------

async def _resolve_chips(targets: set, user_id: int, db) -> dict:
    """대상별 칩 HTML. 쓰는 사람이 멤버이고 주소 속 id 관계가 실제와 맞는 대상만(종류별 조회 1회)."""
    task_ids = sorted({t[2] for t in targets if t[0] == 'task'})
    issue_ids = sorted({t[3] for t in targets if t[0] == 'issue'})
    page_ids = sorted({t[2] for t in targets if t[0] == 'doc'})
    tasks = await task_model.find_chip_refs(task_ids, user_id, db) if task_ids else {}
    issues = await issue_model.find_chip_refs(issue_ids, user_id, db) if issue_ids else {}
    pages = await page_model.find_chip_refs(page_ids, user_id, db) if page_ids else {}
    chips = {}
    for target in targets:
        kind = target[0]
        if kind == 'task':
            info = tasks.get(target[2])
            if info and info['branch_id'] == target[1]:
                chips[target] = build_task_chip(info)
        elif kind == 'issue':
            info = issues.get(target[3])
            if info and info['branch_id'] == target[1] and info['task_id'] == target[2]:
                chips[target] = build_issue_chip(info)
        else:
            info = pages.get(target[2])
            if info and info['canvas_id'] == target[1]:
                chips[target] = build_doc_chip(info)
    return chips


async def ingest_rich_text(text, *, user_id: int, db, limit: int | None = None, sanitize: bool = False):
    """리치 텍스트 저장 진입점. 기존 `ensure_html`(캔버스는 `sanitize_html(ensure_html(...))`)을 대체한다.

    HTML·빈 값은 지금과 같다. 마크다운이면 이 Weave를 가리키는 링크를 칩으로 바꾼 버전(C)과
    기존 출력(P)을 만들고, limit이 있으면 브라우저 재저장 상한 U(C) ≤ limit일 때만 C를 고른다.
    아니면 본문 전체를 P로 저장한다(A안 — 일부만 칩으로 만들지 않음)."""
    def finish(html):
        return sanitize_html(html) if sanitize else html

    if not text or is_html(text):
        return finish(ensure_html(text))
    plain = markdown_to_html(text)
    targets = collect_ref_targets(text)
    chips = await _resolve_chips(targets, user_id, db) if targets else {}
    if not chips:
        return finish(plain)
    with_chips, _ = render_with_chips(text, chips)
    with_chips = finish(with_chips)
    if limit is None or reserialize_upper_bound(with_chips) <= limit:
        return with_chips
    return finish(plain)
