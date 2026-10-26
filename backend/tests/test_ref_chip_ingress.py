"""MCP·API 마크다운의 Weave 링크 → ref 칩 변환 코어 (DB 없는 순수 단위 테스트).

설계: docs/superpowers/specs/2026-10-22-ref-link-chip-ingress-design.md §5.2·§5.4·§5.8.4
"""
import json
import math
from pathlib import Path

import pytest

import config
from library import origins
from library import ref_chip_ingress as rci
from library.html_markdown import (
    markdown_to_html, parse_markdown_tokens, render_markdown_tokens,
)

FIXTURE = Path(__file__).parent / 'fixtures' / 'markdown_codec_cases.json'

TASK_INFO = {
    'task_id': 1031, 'branch_id': 10, 'display_id': 'PRO-220', 'title': '새 실험',
    'status': 'todo', 'priority': 'medium', 'status_label': 'To Do',
    'status_color': '#9CA3AF', 'status_category': 'todo',
}


def _cases():
    data = json.loads(FIXTURE.read_text(encoding='utf-8'))
    return data if isinstance(data, list) else data['cases']


# --- 토큰 렌더 = 순수 변환 (기존 계약 보존) -------------------------------------

def test_render_tokens_equals_markdown_to_html():
    for case in _cases():
        md = case.get('markdown')
        if md is None:
            continue
        assert render_markdown_tokens(parse_markdown_tokens(md)) == markdown_to_html(md), case['name']


# --- 주소 판정 (§5.2) -----------------------------------------------------------

@pytest.mark.parametrize('href, expected', [
    ('/branch/10/task/1031', ('task', 10, 1031)),
    ('/branch/10/task/1031/issue/7', ('issue', 10, 1031, 7)),
    ('/canvas/5/77', ('doc', 5, 77)),
    ('/branch/10/task/1031?comment_id=1', None),
    ('/branch/10/task/1031#x', None),
    ('/branch/10/task/1031/', None),
    ('/branch/10/task/1031/edit', None),
    ('//evil.com/branch/1/task/1', None),
    ('https://evil.com/branch/1/task/1', None),
    ('mailto:a@b.c', None),
    ('branch/1/task/1', None),
    ('', None),
])
def test_match_ref_href_relative_and_rejections(monkeypatch, href, expected):
    monkeypatch.setattr(config, 'FRONTEND_URL', '')
    monkeypatch.setattr(origins, 'ALLOWED_ORIGIN_LIST', ['https://weave.standigm.com'])
    assert rci.match_ref_href(href) == expected


def test_match_ref_href_frontend_url(monkeypatch):
    monkeypatch.setattr(config, 'FRONTEND_URL', 'https://weave.test')
    monkeypatch.setattr(origins, 'ALLOWED_ORIGIN_LIST', ['https://other.example'])
    assert rci.match_ref_href('https://weave.test/branch/1/task/2') == ('task', 1, 2)
    assert rci.match_ref_href('HTTPS://WEAVE.TEST/branch/1/task/2') == ('task', 1, 2)
    assert rci.match_ref_href('https://weave.test.evil/branch/1/task/2') is None


def test_match_ref_href_allowed_origins(monkeypatch):
    monkeypatch.setattr(config, 'FRONTEND_URL', '')
    monkeypatch.setattr(origins, 'ALLOWED_ORIGIN_LIST', ['https://weave.standigm.com'])
    assert rci.match_ref_href('https://weave.standigm.com/branch/10/task/1031') == ('task', 10, 1031)
    assert rci.match_ref_href('https://weave.standigm.com:8443/branch/10/task/1031') is None
    assert rci.match_ref_href('http://weave.standigm.com/branch/10/task/1031') is None


# --- 칩 HTML (§5.4: renderHTML 원문과 같은 문자열) ------------------------------

def test_build_task_chip_exact():
    assert rci.build_task_chip(TASK_INFO) == (
        '<span data-task-ref="true" data-task-id="1031" data-branch-id="10" '
        'data-display-id="PRO-220" data-title="새 실험" data-status="todo" '
        'data-priority="medium" data-status-label="To Do" data-status-color="#9CA3AF" '
        'data-status-category="todo" class="task-ref">PRO-220 새 실험'
        '<span class="ref-chip__badge ref-chip__badge--todo" data-ref-badge="true" '
        'style="background-color: #9CA3AF20; color: #9CA3AF">To Do</span></span>'
    )


def test_build_task_chip_fallbacks():
    info = dict(TASK_INFO, status='in_progress', status_label=None, status_color=None,
                status_category=None)
    chip = rci.build_task_chip(info)
    assert 'data-status-label="" data-status-color="" data-status-category=""' in chip
    assert '<span class="ref-chip__badge ref-chip__badge--in_progress" data-ref-badge="true">In Progress</span>' in chip
    assert 'style=' not in chip


def test_chip_escaping_matches_dom_serialization():
    info = dict(TASK_INFO, display_id='PRO-1', title='a "b" & <c> d')
    chip = rci.build_task_chip(info)
    # 속성: & " < > NBSP (최신 브라우저 기준 가장 긴 형태 — 재저장 때 칩이 늘지 않게)
    assert 'data-title="a &quot;b&quot; &amp; &lt;c&gt;&nbsp;d"' in chip
    # 텍스트: & < > NBSP (따옴표는 그대로)
    assert '>PRO-1 a "b" &amp; &lt;c&gt;&nbsp;d<span' in chip


def test_build_issue_chip_exact():
    info = {'issue_id': 7, 'task_id': 1031, 'branch_id': 10, 'display_id': 'PRO-220',
            'title': '재현', 'status': 'open'}
    assert rci.build_issue_chip(info) == (
        '<span data-issue-ref="true" data-issue-id="7" data-task-id="1031" data-branch-id="10" '
        'data-display-id="PRO-220" data-title="재현" data-status="open" class="issue-ref">PRO-220 재현'
        '<span class="ref-chip__badge ref-chip__badge--open" data-ref-badge="true">Open</span></span>'
    )
    assert '>Closed</span>' in rci.build_issue_chip(dict(info, status='closed'))


def test_build_doc_chip_exact():
    info = {'page_id': 77, 'canvas_id': 5, 'title': '설계', 'canvas_name': '제품'}
    assert rci.build_doc_chip(info) == (
        '<span data-doc-ref="true" data-page-id="77" data-canvas-id="5" data-title="설계" '
        'data-canvas-name="제품" class="doc-ref">설계</span>'
    )


# --- 토큰 치환 -------------------------------------------------------------------

def test_render_with_chips_replaces_whole_link():
    md = 'a [**x** y](/branch/10/task/1031) b [z](https://github.com)'
    html, count = rci.render_with_chips(md, {('task', 10, 1031): 'CHIP'})
    assert count == 1
    assert html == markdown_to_html(md).replace(
        '<a href="/branch/10/task/1031"><strong>x</strong> y</a>', 'CHIP')
    assert '<a href="https://github.com">z</a>' in html


def test_render_with_chips_empty_label_repeat_and_reference():
    html, count = rci.render_with_chips('[](/branch/10/task/1031)', {('task', 10, 1031): 'C'})
    assert (html, count) == ('<p>C</p>\n', 1)
    html, count = rci.render_with_chips(
        '[a](/branch/10/task/1031) [b](/branch/10/task/1031)', {('task', 10, 1031): 'C'})
    assert (html, count) == ('<p>C C</p>\n', 2)
    html, count = rci.render_with_chips('[x][r]\n\n[r]: /branch/10/task/1031', {('task', 10, 1031): 'C'})
    assert (html, count) == ('<p>C</p>\n', 1)


def test_render_with_chips_leaves_unresolved_and_autolinks():
    md = '[x](/branch/10/task/9)'
    assert rci.render_with_chips(md, {}) == (markdown_to_html(md), 0)
    # 오토링크는 대상이 아니다(§5.2) — 순수 마크다운으로 직접 넘겨도 칩으로 바꾸지 않는다.
    auto = '<http://localhost:3000/branch/10/task/1031>'
    assert rci.render_with_chips(auto, {('task', 10, 1031): 'C'}) == (markdown_to_html(auto), 0)


def test_collect_ref_targets(monkeypatch):
    monkeypatch.setattr(config, 'FRONTEND_URL', '')
    md = ('[a](/branch/10/task/1031) [b](/branch/10/task/1031/issue/7) [c](/canvas/5/77) '
          '[d](/branch/10/task/1?comment_id=2) [e](https://github.com)')
    assert rci.collect_ref_targets(md) == {
        ('task', 10, 1031), ('issue', 10, 1031, 7), ('doc', 5, 77)}


# --- 재저장 상한 U (§5.8.4) --------------------------------------------------------

TRAIL = len('<p></p>')


def test_upper_bound_base_trailing_paragraph():
    html = '<p>x</p>\n'
    assert rci.reserialize_upper_bound(html) == len(html) + TRAIL


def test_upper_bound_link_li_nbsp():
    link = '<p><a href="/x">y</a></p>\n'
    assert rci.reserialize_upper_bound(link) == len(link) + 42 + TRAIL
    li = '<ul>\n<li>a</li>\n</ul>\n'
    assert rci.reserialize_upper_bound(li) == len(li) + 7 + TRAIL
    nbsp = '<p>a b</p>\n'
    assert rci.reserialize_upper_bound(nbsp) == len(nbsp) + 5 + TRAIL


def test_upper_bound_mark_split():
    html = '<p><em>a <strong>b</strong> c</em></p>\n'
    assert rci.reserialize_upper_bound(html) == len(html) + 2 * 9 + TRAIL
    link = '<p><a href="/x">a <em>b</em></a></p>\n'
    reopen = len('<a target="_blank" rel="noopener noreferrer" href="/x">') + 4
    assert rci.reserialize_upper_bound(link) == len(link) + 42 + reopen + TRAIL


def test_upper_bound_table():
    html = ('<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody>\n'
            '<tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody>\n</table>\n')
    table = (len(' style="min-width: 50px;"') + len('<colgroup></colgroup>')
             + 2 * len('<col style="min-width: 25px;">'))
    cells = 4 * (len(' colspan="1" rowspan="1"') + 7)
    assert rci.reserialize_upper_bound(html) == len(html) + table + cells + TRAIL


def test_upper_bound_chip_style_allowance():
    html = '<p>' + rci.build_task_chip(TASK_INFO) + '</p>\n'
    assert rci.reserialize_upper_bound(html) == len(html) + 29 + TRAIL
    compact = html.replace('background-color: #9CA3AF20; color: #9CA3AF',
                           'background-color:#9CA3AF20;color:#9CA3AF')
    assert rci.reserialize_upper_bound(compact) == len(compact) + 32 + TRAIL


def test_upper_bound_unknown_tag_is_infinite():
    assert rci.reserialize_upper_bound('<p><iframe src="x"></iframe></p>') == math.inf


# --- 독립 리뷰 Important 1·2 (2026-10-22) ------------------------------------------

def test_upper_bound_image_rules():
    # 편집기에서 이미지는 블록이라, 글 중간 이미지는 감싼 블록을 쪼개 길어진다(리뷰 실측 B=10,015>L).
    # 최상위 문단에 이미지만 있으면 늘지 않는다(<p><img></p> → <p></p><img>).
    alone = '<p><img src="https://a.com/x.png" alt="x"></p>\n'
    assert rci.reserialize_upper_bound(alone) == len(alone) + TRAIL
    for html in (
        '<p>a <img src="https://a.com/x.png" alt="x"> b</p>\n',
        '<h2>제목 <img src="https://a.com/x.png" alt="x"></h2>\n',
        '<ol>\n<li><img src="https://a.com/x.png" alt="x"> 항목</li>\n</ol>\n',
        '<blockquote>\n<p><img src="https://a.com/x.png" alt="x"></p>\n</blockquote>\n',
        '<p><a href="/x"><img src="https://a.com/x.png" alt="x"></a></p>\n',
    ):
        assert rci.reserialize_upper_bound(html) == math.inf, html


def test_upper_bound_blockquote_gets_paragraph():
    # 빈 인용 → <blockquote><p></p></blockquote> (인용마다 문단 하나가 생길 수 있다)
    html = '<blockquote>\n</blockquote>\n'
    assert rci.reserialize_upper_bound(html) == len(html) + 7 + TRAIL


@pytest.mark.parametrize('href', [
    '/branch/1/task/3000000000',
    '/branch/3000000000/task/1',
    '/branch/1/task/1/issue/99999999999',
    '/canvas/1/2147483648',
    '/branch/1/task/' + '9' * 5000,
], ids=['task_over_int32', 'branch_over_int32', 'issue_11_digits', 'page_int32_plus_1', 'task_5000_digits'])
def test_match_ref_href_rejects_out_of_range_ids(href):
    # DB id는 int32 — 범위 밖 id 링크 하나로 저장 전체가 500이 되면 안 된다(그 링크만 일반 링크로).
    assert rci.match_ref_href(href) is None


def test_match_ref_href_accepts_int32_max():
    assert rci.match_ref_href('/branch/1/task/2147483647') == ('task', 1, 2147483647)
