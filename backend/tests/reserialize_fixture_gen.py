"""재직렬화 공유 픽스처(tests/fixtures/reserialize_growth_cases.json)의 서버 출력을 다시 만든다.

각 사례의 markdown과 chips(대상 → 조회 결과)로 P(기존 출력)·C(칩 출력)와 캔버스용 정화본을 채운다.
실행: docker compose exec -T backend python -m tests.reserialize_fixture_gen
B(브라우저 재저장 길이)는 프론트에서 채운다:
  cd frontend && REGEN_RESERIALIZE=1 npx vitest run library/reserializeGrowth.dom.test.js
"""
import json
from pathlib import Path

from library.html_markdown import markdown_to_html
from library.html_sanitize import sanitize_html
from library.ref_chip_ingress import build_doc_chip, build_issue_chip, build_task_chip, render_with_chips

FIXTURE = Path(__file__).parent / 'fixtures' / 'reserialize_growth_cases.json'
PAD_TOKEN = 'Zpadz'   # 경계 사례에서 문단 글자를 끼워 넣는 자리(백엔드·프론트 공통)

_BUILDERS = {'task': build_task_chip, 'issue': build_issue_chip, 'doc': build_doc_chip}


def padded(md: str, k: int) -> str:
    return md.replace(PAD_TOKEN, PAD_TOKEN + 'a' * k, 1) if k else md


def _chips(case: dict) -> dict:
    chips = {}
    for key, info in case.get('chips', {}).items():
        kind, *ids = key.split(':')
        chips[(kind, *map(int, ids))] = _BUILDERS[kind](info)
    return chips


def build_outputs(case: dict) -> dict:
    md = case['markdown']
    plain = markdown_to_html(md)
    with_chips, _ = render_with_chips(md, _chips(case))
    return {'P': plain, 'C': with_chips,
            'P_canvas': sanitize_html(plain), 'C_canvas': sanitize_html(with_chips)}


def main():
    data = json.loads(FIXTURE.read_text(encoding='utf-8'))
    for case in data['cases']:
        case.update(build_outputs(case))
        case.setdefault('B', {})
    FIXTURE.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
