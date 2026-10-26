"""브라우저 재저장 상한 U(C)와 A안 판정을 공유 픽스처로 검증한다 (설계 §5.8.3·§5.8.6).

픽스처: tests/fixtures/reserialize_growth_cases.json
- P/C/P_canvas/C_canvas: 백엔드 함수 출력 — 재생성:
  docker compose exec -T backend python -m tests.reserialize_fixture_gen
- B: 실제 편집기(jsdom)를 수정창처럼 열고(댓글=자동 포커스, 이슈·캔버스=포커스 1회) 아무것도
  고치지 않고 저장한 getHTML() 길이 — 재생성(프론트):
  cd frontend && REGEN_RESERIALIZE=1 npx vitest run library/reserializeGrowth.dom.test.js
"""
import json

import pytest

from library import ref_chip_ingress as rci
from library.html_markdown import markdown_to_html
from library.ref_chip_ingress import TRAILING_PARAGRAPH, reserialize_upper_bound
from tests.reserialize_fixture_gen import FIXTURE, _chips, build_outputs, padded

CASES = json.loads(FIXTURE.read_text(encoding='utf-8'))['cases']
IDS = [c['name'] for c in CASES]
TRAIL = len(TRAILING_PARAGRAPH)
# 편집기 → 그 편집기로 다시 저장되는 경로의 한도 (설계 §5.1 표)
EDITOR_LIMITS = {'comment': (10000,), 'issue': (10000, 50000), 'canvas': (300000,)}


def _html(outputs, editor, kind):
    return outputs[f'{kind}_canvas'] if editor == 'canvas' else outputs[kind]


def _decide(c_html, p_html, limit):
    """§5.8.3: U(C) ≤ L이면 칩 버전, 아니면 본문 전체를 기존 출력으로."""
    return ('C', c_html) if reserialize_upper_bound(c_html) <= limit else ('P', p_html)


def _case(name):
    return next(c for c in CASES if c['name'] == name)


def _at(case, editor, k):
    """패딩 k자를 넣은 본문: (C, P, B(C), B(P)). 문단 글자 1자는 C·P·B를 1자씩 늘린다(vitest가 확인)."""
    out = build_outputs(dict(case, markdown=padded(case['markdown'], k)))
    b = case['B'][editor]
    return _html(out, editor, 'C'), _html(out, editor, 'P'), b['C'] + k, b['P'] + k


@pytest.mark.parametrize('case', CASES, ids=IDS)
def test_fixture_fresh(case):
    assert build_outputs(case) == {k: case[k] for k in ('P', 'C', 'P_canvas', 'C_canvas')}


@pytest.mark.parametrize('case', CASES, ids=IDS)
def test_bound_is_sound(case):
    assert set(case['B']) == set(EDITOR_LIMITS)
    for editor, b in case['B'].items():
        assert reserialize_upper_bound(_html(case, editor, 'C')) >= b['C'], editor


@pytest.mark.parametrize('case', CASES, ids=IDS)
def test_contract_no_new_resave_failure(case):
    # 기존 방식으로 다시 저장할 수 있던 입력(B(P) ≤ L)은 새 방식 저장 결과도 B ≤ L
    for editor, b in case['B'].items():
        for limit in EDITOR_LIMITS[editor]:
            kind, _ = _decide(_html(case, editor, 'C'), _html(case, editor, 'P'), limit)
            if b['P'] <= limit:
                assert b[kind] <= limit, (editor, limit, kind)


def test_trailing_paragraph_counterexample():
    # 목록으로 끝나고 블록 줄바꿈이 적은 본문. 끝 빈 문단(7자)을 빼고 계산하면 U가 정확히 L이라
    # 당시 식은 칩을 고르지만, 댓글 수정창 자동 포커스 후 재저장은 L을 넘는다(독립 리뷰 반례).
    case, limit = _case('list_end_low_slack'), 10000
    base_c, _, _, _ = _at(case, 'comment', 0)
    k = limit - (reserialize_upper_bound(base_c) - TRAIL)
    c, p, b_c, b_p = _at(case, 'comment', k)
    assert reserialize_upper_bound(c) - TRAIL == limit
    assert b_c > limit
    kind, stored = _decide(c, p, limit)
    assert kind == 'P' and stored == markdown_to_html(padded(case['markdown'], k))
    assert b_p <= limit


@pytest.mark.parametrize('editor, limit', [('comment', 10000), ('issue', 50000), ('canvas', 300000)])
def test_resave_boundary_exact_and_plus_one(editor, limit):
    # 실제 재저장 길이가 정확히 L이면 저장 결과는 다시 저장된다(보수적 판정으로 P일 수 있음),
    # L+1이면 반드시 P로 저장된다.
    case = _case('chips_paragraph_pad')
    k = limit - case['B'][editor]['C']
    for extra in (0, 1):
        c, p, b_c, b_p = _at(case, editor, k + extra)
        assert b_c == limit + extra
        kind, _ = _decide(c, p, limit)
        if extra:
            assert kind == 'P'
        assert (b_c if kind == 'C' else b_p) <= limit


@pytest.mark.parametrize('name', ['raw_doc_links_80', 'raw_issue_links_40'])
async def test_raw_mode_cases_are_what_the_server_stores(name, monkeypatch):
    # 원문 모드 반례의 입력 P는 실제 저장 함수가 고른 결과다: 칩 버전은 댓글 한도(1만 자)를 넘어
    # 본문 전체가 기존 출력으로 저장된다(A안). 프론트는 이 P를 원문 모드로 열어 고치지 않고 저장해 본다
    # (frontend/library/reserializeGrowth.dom.test.js '원문 모드').
    case, limit = _case(name), 10000
    chips = _chips(case)

    async def lookup(targets, user_id, db):
        return chips
    monkeypatch.setattr(rci, '_resolve_chips', lookup)
    stored = await rci.ingest_rich_text(case['markdown'], user_id=1, db=None, limit=limit)
    assert stored == case['P'] == markdown_to_html(case['markdown'])
    assert case['B']['comment']['P'] <= limit < case['B']['comment']['C']


def test_inline_image_counterexample():
    # 독립 리뷰 Important 1 반례 모양: 칩 20 + 글 중간 이미지 4. 편집기는 이미지마다 문단을 쪼개
    # 칩 버전이 한도를 넘게 늘어난다 → U는 무한대, 본문 전체를 기존 출력(P)으로 저장해야 한다.
    case, limit = _case('inline_images_pad'), 10000
    k = limit + 15 - case['B']['comment']['C']   # 리뷰 실측처럼 칩 버전 재저장이 L+15가 되는 지점
    c, p, b_c, b_p = _at(case, 'comment', k)
    assert b_c == limit + 15
    assert reserialize_upper_bound(c) == float('inf')
    kind, stored = _decide(c, p, limit)
    assert kind == 'P' and stored == markdown_to_html(padded(case['markdown'], k))
    assert b_p <= limit
