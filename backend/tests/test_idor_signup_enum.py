"""B-2 (SEC-13-A): 회원가입 이메일 열거 방지 — 중립 응답 회귀 테스트.

위협: register가 이미 가입된 이메일에 EMAIL_ALREADY_EXISTS를 돌려주면 공격자가
이메일 목록을 던져 등록 계정을 전수 확인(열거)할 수 있다. 또한 public 모드에서
신규 이메일만 자동로그인(profile+쿠키)을 받으면 그 응답 차이 자체가 열거 신호다.

방어(이 테스트가 고정):
- private 모드: 신규/기존 이메일 모두 동일한 중립 응답(REGISTRATION_PENDING).
  기존 이메일이면 사용자를 추가로 생성하지 않는다.
- public 모드: 신규/기존 모두 동일한 중립 응답(REGISTRATION_SUCCESS, profile/쿠키 없음).
  신규는 active 계정을 생성하지만 자동로그인은 하지 않는다(쿠키 미발급).
- happy path: 신규 가입 후 그 자격증명으로 로그인이 성공한다.

기존 컨트롤러 직접호출 스타일(test_controller_*.py / test_setup_hardening.py)을 따른다.
db_session 픽스처는 외부 트랜잭션 안에서 돌고 끝에 롤백되어 격리된다.
"""
from types import SimpleNamespace

import pytest
from fastapi import Response
from sqlalchemy import text

from core.controller import auth as auth_controller
from core.model import workspace as workspace_model


def _req():
    return SimpleNamespace(
        state=SimpleNamespace(payload={}),
        headers={},
        client=SimpleNamespace(host="127.0.0.1"),
    )


def _body(email, password="pw-secret-1234", username="newbie"):
    return SimpleNamespace(email=email, password=password, username=username)


async def _init_workspace(db, policy):
    """워크스페이스 싱글톤 초기화(register 사전조건). 관리자 user 1명도 만든다."""
    uid = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES ('admin@test.local', :p, 'admin', 'active', 'admin') RETURNING user_id
    """), {"p": b"x"})
    admin_id = uid.scalar_one()
    won = await workspace_model.create_settings(
        workspace_name="Acme", registration_policy=policy,
        admin_user_id=admin_id, db=db,
    )
    assert won is True


async def _count_users(db, email):
    row = await db.execute(text(
        'SELECT COUNT(*) FROM "user" WHERE email = :e AND deleted_at IS NULL'
    ), {"e": email})
    return row.scalar_one()


async def _seed_user(db, email, status="active", password=b"existinghash"):
    await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, 'existing', :s)
    """), {"e": email, "p": password, "s": status})


# ---------------------------------------------------------------------------
# private 모드 — 신규 vs 기존 응답이 구별 불가능 + 기존은 추가 생성 안 됨
# ---------------------------------------------------------------------------

async def test_private_new_and_existing_responses_identical(db_session):
    await _init_workspace(db_session, "private")
    await _seed_user(db_session, "existing@test.local", status="active")

    res_new = await auth_controller.register(
        _body("brandnew@test.local"), _req(), Response(), db_session)
    res_existing = await auth_controller.register(
        _body("existing@test.local"), _req(), Response(), db_session)

    # 외부에서 구별 불가능: 응답 dict가 완전히 동일
    assert res_new == res_existing
    assert res_new == {"status": True, "pending": True, "message": "REGISTRATION_PENDING"}
    # 어느 쪽도 profile/쿠키 누설 없음
    assert "profile" not in res_new


async def test_private_existing_email_creates_no_user(db_session):
    await _init_workspace(db_session, "private")
    await _seed_user(db_session, "existing@test.local", status="active")
    before = await _count_users(db_session, "existing@test.local")

    await auth_controller.register(
        _body("existing@test.local"), _req(), Response(), db_session)

    # 기존 이메일에 대해 중복 user가 추가로 생기지 않음
    assert await _count_users(db_session, "existing@test.local") == before == 1


async def test_private_new_email_creates_pending_user(db_session):
    await _init_workspace(db_session, "private")
    await auth_controller.register(
        _body("brandnew@test.local"), _req(), Response(), db_session)

    row = await db_session.execute(text(
        'SELECT status FROM "user" WHERE email = :e'
    ), {"e": "brandnew@test.local"})
    assert row.scalar_one() == "pending"


# ---------------------------------------------------------------------------
# public 모드 — 신규 vs 기존 응답 구별 불가 + 자동로그인 제거(쿠키/profile 없음)
# ---------------------------------------------------------------------------

async def test_public_new_and_existing_responses_identical(db_session):
    await _init_workspace(db_session, "public")
    await _seed_user(db_session, "existing@test.local", status="active")

    resp_new = Response()
    resp_existing = Response()
    res_new = await auth_controller.register(
        _body("brandnew@test.local"), _req(), resp_new, db_session)
    res_existing = await auth_controller.register(
        _body("existing@test.local"), _req(), resp_existing, db_session)

    # 응답 dict 동일
    assert res_new == res_existing
    assert res_new == {"status": True, "message": "REGISTRATION_SUCCESS"}
    # 자동로그인 제거: profile 없음 + 어느 쪽도 인증 쿠키를 내려주지 않음(열거 신호 제거)
    assert "profile" not in res_new
    assert "set-cookie" not in {k.lower() for k in resp_new.headers.keys()}
    assert "set-cookie" not in {k.lower() for k in resp_existing.headers.keys()}


async def test_public_new_email_creates_active_user_existing_does_not(db_session):
    await _init_workspace(db_session, "public")
    await _seed_user(db_session, "existing@test.local", status="active")
    before_existing = await _count_users(db_session, "existing@test.local")

    await auth_controller.register(
        _body("brandnew@test.local"), _req(), Response(), db_session)
    await auth_controller.register(
        _body("existing@test.local"), _req(), Response(), db_session)

    # 신규는 active 계정 생성
    row = await db_session.execute(text(
        'SELECT status FROM "user" WHERE email = :e'
    ), {"e": "brandnew@test.local"})
    assert row.scalar_one() == "active"
    # 기존은 추가 생성 없음
    assert await _count_users(db_session, "existing@test.local") == before_existing == 1


# ---------------------------------------------------------------------------
# happy path — public 신규 가입 후 그 자격증명으로 로그인 성공
# ---------------------------------------------------------------------------

async def test_public_signup_then_login_succeeds(db_session):
    await _init_workspace(db_session, "public")
    body = _body("happy@test.local", password="correcthorse-1")

    reg = await auth_controller.register(body, _req(), Response(), db_session)
    assert reg["status"] is True
    assert "profile" not in reg  # 가입 단계에선 로그인 안 됨

    login_resp = Response()
    login = await auth_controller.login(body, _req(), login_resp, db_session)
    assert login["status"] is True
    assert login["profile"]["email"] == "happy@test.local"
    # 로그인 단계에서 비로소 인증 쿠키 발급
    assert "set-cookie" in {k.lower() for k in login_resp.headers.keys()}


# ---------------------------------------------------------------------------
# 타이밍: 이메일 존재 여부와 무관하게 bcrypt 해싱이 항상 수행되는지(코드 레벨)
# ---------------------------------------------------------------------------

async def test_bcrypt_hash_runs_regardless_of_email_existence(db_session, monkeypatch):
    await _init_workspace(db_session, "public")
    await _seed_user(db_session, "existing@test.local", status="active")

    calls = {"n": 0}
    import bcrypt   # crypto.hash_password_async가 워커 스레드에서 부르는 모듈 함수(auth.py는 bcrypt를 import하지 않는다)
    real_hashpw = bcrypt.hashpw

    def counting_hashpw(pw, salt):
        calls["n"] += 1
        return real_hashpw(pw, salt)

    monkeypatch.setattr(bcrypt, "hashpw", counting_hashpw)

    await auth_controller.register(
        _body("existing@test.local"), _req(), Response(), db_session)
    # 기존 이메일이라도(=계정 생성 안 함) 해싱은 수행되어 타이밍 차이를 없앤다
    assert calls["n"] == 1
