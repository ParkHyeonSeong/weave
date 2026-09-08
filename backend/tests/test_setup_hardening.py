"""B-1: Weave setup 엔드포인트 하드닝 회귀 테스트.

커버:
- CFG-02-001 경합(TOCTOU): workspace_settings 싱글톤(setting_id=1 PK + CHECK) INSERT가
  권위적 가드. 두 번째 초기화는 ALREADY_INITIALIZED로 거부되고 500이 아니며, 관리자
  user가 중복 생성되지 않는다.
- CFG-02-002: /setup/initialize 라우트에 @limiter.limit 데코레이터가 적용돼 있다.
- CFG-02-004: GET /setup/status는 초기화 전 워크스페이스 메타데이터를 노출하지 않는다.

테스트는 기존 컨트롤러 직접호출 스타일(test_controller_*.py)을 따른다. db_session 픽스처는
외부 트랜잭션 안에서 돌고 끝에 롤백되어 격리된다.
"""
from types import SimpleNamespace

import pytest
from fastapi import Response
from sqlalchemy import text

from core.controller import setup as setup_controller
from core.model import user as user_model
from core.model import workspace as workspace_model
from routers.schema.profile import LanguageRegion


def _req():
    # initialize 컨트롤러는 request를 사용하지 않지만 시그니처상 필요
    return SimpleNamespace(state=SimpleNamespace(payload={}))


def _body(email="admin@test.local", username="admin", workspace="Acme",
          policy="private", password="pw-secret-1234", time_zone="Asia/Seoul",
          language_region=None):
    # time_zone은 SetupInitialize의 필드다(생략 시 스키마가 Asia/Seoul을 채운다).
    # language_region은 첫 관리자의 개인 설정(선택) — LanguageRegion 인스턴스 또는 None.
    return SimpleNamespace(
        email=email, username=username, workspace_name=workspace,
        registration_policy=policy, password=password, time_zone=time_zone,
        language_region=language_region,
    )


async def _count_admins(db):
    row = await db.execute(text(
        "SELECT COUNT(*) FROM \"user\" WHERE role = 'admin' AND deleted_at IS NULL"
    ))
    return row.scalar_one()


# ---------------------------------------------------------------------------
# ① 최초 initialize 성공 -> 관리자 생성 + initialized=true
# ---------------------------------------------------------------------------

async def test_first_initialize_succeeds_and_creates_admin(db_session):
    res = await setup_controller.initialize(_body(), _req(), Response(), db_session)
    assert res["status"] is True
    assert res["profile"]["role"] == "admin"
    assert res["profile"]["email"] == "admin@test.local"

    # 워크스페이스 설정(싱글톤)이 실제로 생성됨
    status = await setup_controller.check_initialized(db_session)
    assert status["initialized"] is True
    assert status["workspace_name"] == "Acme"

    assert await _count_admins(db_session) == 1


# ---------------------------------------------------------------------------
# ② 두 번째 initialize는 거부(ALREADY_INITIALIZED, 500 아님) + 관리자 추가 생성 안 됨
# ---------------------------------------------------------------------------

async def test_second_initialize_rejected_fast_path(db_session):
    """이미 settings가 존재하면 컨트롤러가 사전확인에서 깔끔히 차단(500 아님)."""
    first = await setup_controller.initialize(_body(), _req(), Response(), db_session)
    assert first["status"] is True
    admins_after_first = await _count_admins(db_session)

    second = await setup_controller.initialize(
        _body(email="other@test.local", username="other"),
        _req(), Response(), db_session,
    )
    assert second == {"status": False, "message": "ALREADY_INITIALIZED"}
    # 두 번째 관리자가 생성되지 않음
    assert await _count_admins(db_session) == admins_after_first == 1


async def test_settings_singleton_blocks_duplicate_insert(db_session):
    """경합 가드의 DB 레벨 증명: 두 번째 create_settings는 PK 충돌로 행을 삽입하지 못하고
    (rowcount 0 -> False) 예외(500)를 던지지 않는다. TOCTOU에서 사전확인을 둘 다 통과해도
    실제 단일 소유권은 이 INSERT 결과가 결정한다."""
    # 관리자 user 1명 (FK initialized_by 충족용)
    uid = await db_session.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES ('a@test.local', :p, 'a', 'active', 'admin') RETURNING user_id
    """), {"p": b"x"})
    admin_id = uid.scalar_one()

    won_first = await workspace_model.create_settings(
        workspace_name="W1", registration_policy="private",
        admin_user_id=admin_id, db=db_session,
    )
    assert won_first is True  # 첫 INSERT 성공

    won_second = await workspace_model.create_settings(
        workspace_name="W2", registration_policy="public",
        admin_user_id=admin_id, db=db_session,
    )
    assert won_second is False  # 두 번째는 싱글톤 충돌로 무효 (예외 아님)

    # 설정 행은 정확히 1개, 최초 값 유지(가로채기 방지)
    row = await db_session.execute(text(
        "SELECT COUNT(*), MAX(workspace_name) FROM workspace_settings"
    ))
    count, name = row.fetchone()
    assert count == 1
    assert name == "W1"


# ---------------------------------------------------------------------------
# ③ status 노출 축소 (CFG-02-004)
# ---------------------------------------------------------------------------

async def test_status_hides_metadata_before_init(db_session):
    res = await setup_controller.check_initialized(db_session)
    assert res == {"status": True, "initialized": False}
    # 민감 메타데이터 키가 아예 없어야 함
    assert "workspace_name" not in res
    assert "registration_policy" not in res


async def test_status_exposes_metadata_after_init(db_session):
    await setup_controller.initialize(_body(workspace="Globex", policy="public"),
                                      _req(), Response(), db_session)
    res = await setup_controller.check_initialized(db_session)
    assert res["status"] is True
    assert res["initialized"] is True
    assert res["workspace_name"] == "Globex"
    assert res["registration_policy"] == "public"
    # 공용 기간 계산의 단일 소스 — 프런트가 이 값 하나만 읽는다(Header·Scrum 중복 조회 금지)
    assert res["time_zone"] == "Asia/Seoul"


async def test_initialize_persists_chosen_workspace_time_zone(db_session):
    """신규 서버: 관리자가 Setup에서 고른 workspace timezone이 그대로 저장된다."""
    await setup_controller.initialize(_body(time_zone="America/New_York"),
                                      _req(), Response(), db_session)
    assert await workspace_model.get_time_zone(db_session) == "America/New_York"
    res = await setup_controller.check_initialized(db_session)
    assert res["time_zone"] == "America/New_York"


# ---------------------------------------------------------------------------
# 레이트리밋 데코레이터 존재 확인 (CFG-02-002, 코드 레벨)
# ---------------------------------------------------------------------------

def test_initialize_route_has_rate_limit():
    """/setup/initialize 라우트에 slowapi limiter(3/minute) 데코레이터가 적용돼 있어야 한다."""
    import routers.setup  # noqa: F401 -- 데코레이터 등록 보장
    from library.rate_limiter import limiter

    key = "routers.setup.initialize"
    assert key in limiter._route_limits, "initialize에 @limiter.limit 미적용"
    limits = limiter._route_limits[key]
    assert limits, "initialize에 등록된 레이트리밋이 없음"
    # 3 per 1 minute 로 등록돼 있어야 함
    assert any("3 per 1 minute" in str(getattr(lim, "limit", lim)) for lim in limits)


async def test_initialize_saves_first_admin_language_region_in_same_transaction(db_session):
    """첫 관리자의 개인 언어·시간대는 initialize 요청에 실려 관리자 생성과 함께 저장된다.
    workspace time_zone(공용)과는 별개 값이어야 한다."""
    body = _body(time_zone="America/New_York",
                 language_region=LanguageRegion(locale="en", time_zone="Asia/Seoul"))
    res = await setup_controller.initialize(body, _req(), Response(), db_session)
    assert res["status"] is True
    uid = res["profile"]["user_id"]
    assert await user_model.get_language_region(uid, db_session) == {
        "locale": "en", "time_zone": "Asia/Seoul"}
    assert await workspace_model.get_time_zone(db_session) == "America/New_York"


async def test_initialize_without_language_region_leaves_prefs_empty(db_session):
    """구 클라이언트(필드 생략)는 개인 설정 없이 생성된다 → 첫 로그인 게이트에서 직접 고른다."""
    res = await setup_controller.initialize(_body(), _req(), Response(), db_session)
    uid = res["profile"]["user_id"]
    assert await user_model.get_language_region(uid, db_session) is None
