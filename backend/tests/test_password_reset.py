"""SEC-07: admin reset → 일회용·만료 재설정 토큰/링크 (평문 비밀번호 노출 제거)."""
import asyncio
import importlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import bcrypt
import pytest
from sqlalchemy import text

from config import PASSWORD_RESET_TOKEN_EXPIRE_HOURS
from core.controller import admin as admin_controller
from core.controller import auth as auth_controller
from core.errors import Category, ErrorCode
from core.model import password_reset_token as prt_model
from core.model import smtp_config as smtp_config_model
from library import crypto, origins, smtp_client


async def _make_user(db, email="reset-user@test.local", password="oldpass123"):
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, :u, 'active', 'member') RETURNING user_id
    """), {"e": email, "p": pw_hash, "u": "resetuser"})
    return row.scalar_one()


async def _make_admin(db, email="reset-admin@test.local"):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, :u, 'active', 'admin') RETURNING user_id
    """), {"e": email, "p": b"x", "u": "resetadmin"})
    return row.scalar_one()


def _req(user_id, origin=None, host=None):
    headers = {k: v for k, v in (("origin", origin), ("host", host)) if v}
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id}), headers=headers)


def _reset_body(token, new_password):
    return SimpleNamespace(token=token, new_password=new_password)


# ── admin reset: 평문 비밀번호 노출 제거 ───────────────────────────────────

async def test_admin_reset_returns_no_plaintext_password(db_session):
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session)
    body = SimpleNamespace(new_password=None)
    res = await admin_controller.reset_user_password(uid, body, _req(admin_id), db_session)
    assert res["status"] is True
    # 평문 비밀번호 필드는 응답에서 완전히 사라져야 한다
    assert "temporary_password" not in res
    # SMTP 미설정이므로 reset_token(원문) 또는 reset_link가 관리자에게 반환된다
    assert ("reset_token" in res) or ("reset_link" in res)


async def test_admin_reset_stores_hash_not_plaintext(db_session):
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session)
    body = SimpleNamespace(new_password=None)
    res = await admin_controller.reset_user_password(uid, body, _req(admin_id), db_session)
    raw = res["reset_token"]
    row = await db_session.execute(text("""
        SELECT token_hash, user_id, used_at FROM password_reset_token WHERE user_id = :uid
    """), {"uid": uid})
    rec = row.fetchone()
    assert rec is not None
    # 평문이 아니라 해시로 저장되어야 한다
    assert rec.token_hash != raw
    assert rec.token_hash == crypto.hash_token(raw)
    assert rec.used_at is None


async def test_admin_cannot_reset_own_password(db_session):
    admin_id = await _make_admin(db_session)
    body = SimpleNamespace(new_password=None)
    res = await admin_controller.reset_user_password(admin_id, body, _req(admin_id), db_session)
    assert res["status"] is False
    assert res["message"] == "CANNOT_RESET_OWN_PASSWORD"


# ── 소비: 유효 토큰으로 새 비번 설정 ───────────────────────────────────────

async def test_consume_valid_token_changes_password(db_session):
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session, email="consume@test.local")
    reset = await admin_controller.reset_user_password(
        uid, SimpleNamespace(new_password=None), _req(admin_id), db_session)
    raw = reset["reset_token"]

    out = await auth_controller.reset_password(_reset_body(raw, "brandnew99"), db_session)
    assert out["status"] is True

    # 비밀번호가 실제로 변경되어 로그인 가능해야 한다
    user = await db_session.execute(
        text('SELECT password FROM "user" WHERE user_id = :uid'), {"uid": uid})
    stored = user.scalar_one()
    if isinstance(stored, memoryview):
        stored = bytes(stored)
    assert bcrypt.checkpw(b"brandnew99", stored)
    assert not bcrypt.checkpw(b"oldpass123", stored)

    # 토큰이 used 처리되어야 한다
    rec = await db_session.execute(
        text("SELECT used_at FROM password_reset_token WHERE user_id = :uid"), {"uid": uid})
    assert rec.scalar_one() is not None


async def test_consume_single_use_rejects_reuse(db_session):
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session, email="reuse@test.local")
    reset = await admin_controller.reset_user_password(
        uid, SimpleNamespace(new_password=None), _req(admin_id), db_session)
    raw = reset["reset_token"]

    first = await auth_controller.reset_password(_reset_body(raw, "firstpass1"), db_session)
    assert first["status"] is True
    second = await auth_controller.reset_password(_reset_body(raw, "secondpass2"), db_session)
    assert second["status"] is False
    assert second["message"] == "INVALID_OR_EXPIRED_TOKEN"


async def test_consume_expired_token_rejected(db_session):
    uid = await _make_user(db_session, email="expired@test.local")
    raw = "rst_" + "expiredtokenvalue"
    token_hash = crypto.hash_token(raw)
    expired = datetime.now(timezone.utc) - timedelta(hours=1)
    await prt_model.create(token_hash, uid, expired, db_session)

    out = await auth_controller.reset_password(_reset_body(raw, "whatever12"), db_session)
    assert out["status"] is False
    assert out["message"] == "INVALID_OR_EXPIRED_TOKEN"


async def test_consume_unknown_token_rejected(db_session):
    out = await auth_controller.reset_password(
        _reset_body("rst_does_not_exist", "whatever12"), db_session)
    assert out["status"] is False
    assert out["message"] == "INVALID_OR_EXPIRED_TOKEN"


async def test_consume_weak_password_rejected(db_session):
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session, email="weak@test.local")
    reset = await admin_controller.reset_user_password(
        uid, SimpleNamespace(new_password=None), _req(admin_id), db_session)
    raw = reset["reset_token"]

    out = await auth_controller.reset_password(_reset_body(raw, "12345"), db_session)
    assert out["status"] is False
    assert out["message"] == "PASSWORD_TOO_SHORT"
    # 약한 비번 거부 시 토큰은 소비되지 않아야 한다
    rec = await db_session.execute(
        text("SELECT used_at FROM password_reset_token WHERE user_id = :uid"), {"uid": uid})
    assert rec.scalar_one() is None


# ── OB-01: 운영 재설정 메일 링크(절대 주소) + 발송 결과 확인 ─────────────────
# 운영 조건: FRONTEND_URL은 컨테이너에 전달되지 않고(docker-compose.prod.yml), ALLOWED_ORIGINS만 있다.

PROD_ORIGIN = "https://weave.example.com"
H = PASSWORD_RESET_TOKEN_EXPIRE_HOURS


@pytest.fixture
def prod_origins(monkeypatch):
    monkeypatch.setattr(admin_controller, "FRONTEND_URL", "")
    monkeypatch.setattr(origins, "ALLOWED_ORIGIN_LIST", [PROD_ORIGIN])
    monkeypatch.setattr(origins, "DEBUG", False)


async def _configure_smtp(db, admin_id):
    await smtp_config_model.upsert_config(
        smtp_host="smtp.test.local", smtp_port=587, smtp_user="mailer",
        smtp_password="smtp-secret", sender_email="noreply@test.local",
        sender_name="Weave", use_tls=True, updated_by=admin_id, db=db)


def _fake_send(monkeypatch, result=None, delay=0.0):
    """smtp_client.send_email 대역. 호출을 기록하고 result를 돌려준다(delay초 뒤)."""
    outbox = []

    async def send_email(config, to_list, subject, body_html):
        outbox.append({"to": to_list, "html": body_html})
        if delay:
            await asyncio.sleep(delay)
        return result or {"status": True, "message": "Email sent successfully"}

    monkeypatch.setattr(smtp_client, "send_email", send_email)
    return outbox


async def test_reset_email_button_links_to_allowed_request_origin(db_session, prod_origins, monkeypatch):
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session)
    await _configure_smtp(db_session, admin_id)
    outbox = _fake_send(monkeypatch)

    res = await admin_controller.reset_user_password(
        uid, SimpleNamespace(new_password=None), _req(admin_id, PROD_ORIGIN), db_session)

    # 발송이 끝난 뒤에 응답한다. 메일로 간 링크는 관리자에게 돌려주지 않는다.
    assert res == {"status": True, "email_sent": True, "expires_hours": H}
    assert len(outbox) == 1
    assert outbox[0]["to"] == ["reset-user@test.local"]
    # 메일 버튼은 메일 앱에서 열리는 절대 주소여야 한다
    assert f'href="{PROD_ORIGIN}/auth/reset?token=rst_' in outbox[0]["html"]


@pytest.mark.parametrize("origin,host", [
    # Origin 권한부와 Host가 같아도(WS의 동일 출처 규칙이면 허용) 허용 목록 밖이면 쓰지 않는다
    ("https://evil.example", "evil.example"),
    (None, None),
], ids=["same-origin-evil", "no-origin"])
async def test_reset_link_falls_back_to_first_allowed_origin(db_session, prod_origins, origin, host):
    # 허용 목록 밖 Origin(또는 Origin 없음)은 링크 주소로 쓰지 않는다 — 토큰이 외부 주소에 실리지 않게.
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session)

    res = await admin_controller.reset_user_password(
        uid, SimpleNamespace(new_password=None), _req(admin_id, origin, host), db_session)

    assert res["email_sent"] is False
    assert res["reset_link"] == f"{PROD_ORIGIN}/auth/reset?token={res['reset_token']}"
    assert res["expires_hours"] == H
    assert "email_error" not in res  # SMTP 미설정은 발송 실패가 아니다


async def test_frontend_url_still_takes_precedence(db_session, prod_origins, monkeypatch):
    monkeypatch.setattr(admin_controller, "FRONTEND_URL", "https://app.example.com")
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session)

    res = await admin_controller.reset_user_password(
        uid, SimpleNamespace(new_password=None), _req(admin_id, PROD_ORIGIN), db_session)

    assert res["reset_link"] == f"https://app.example.com/auth/reset?token={res['reset_token']}"


async def test_reset_email_failure_returns_reason_and_copyable_link(db_session, prod_origins, monkeypatch):
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session)
    await _configure_smtp(db_session, admin_id)
    outbox = _fake_send(monkeypatch, result={"status": False, "message": "(535, b'auth failed')"})

    res = await admin_controller.reset_user_password(
        uid, SimpleNamespace(new_password=None), _req(admin_id, PROD_ORIGIN), db_session)

    assert len(outbox) == 1
    assert res["status"] is True
    assert res["email_sent"] is False
    assert res["email_error"] == "SMTP_SEND_FAILED"
    assert res["reset_link"] == f"{PROD_ORIGIN}/auth/reset?token={res['reset_token']}"
    assert res["expires_hours"] == H
    # 돌려준 링크의 토큰은 실제로 저장된 토큰이다(관리자가 대신 전달하면 동작한다)
    row = await db_session.execute(
        text("SELECT token_hash FROM password_reset_token WHERE user_id = :uid"), {"uid": uid})
    assert row.scalar_one() == crypto.hash_token(res["reset_token"])


async def test_reset_email_unexpected_error_still_returns_link(db_session, prod_origins, monkeypatch):
    # 발송 중 예상 밖 예외도 발송 실패로 보고 링크를 돌려준다(500이면 토큰이 롤백돼 링크도 사라진다).
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session)
    await _configure_smtp(db_session, admin_id)

    async def broken_send(*args, **kwargs):
        raise RuntimeError("smtp client bug")

    monkeypatch.setattr(smtp_client, "send_email", broken_send)

    res = await admin_controller.reset_user_password(
        uid, SimpleNamespace(new_password=None), _req(admin_id, PROD_ORIGIN), db_session)

    assert res["email_sent"] is False
    assert res["email_error"] == "SMTP_SEND_FAILED"
    assert res["reset_link"] == f"{PROD_ORIGIN}/auth/reset?token={res['reset_token']}"


async def test_reset_email_timeout_returns_reason_and_copyable_link(db_session, prod_origins, monkeypatch):
    monkeypatch.setattr(admin_controller, "RESET_EMAIL_TIMEOUT_SECONDS", 0.05, raising=False)
    admin_id = await _make_admin(db_session)
    uid = await _make_user(db_session)
    await _configure_smtp(db_session, admin_id)
    _fake_send(monkeypatch, delay=1.0)  # 메일 서버가 응답하지 않는 상황

    res = await admin_controller.reset_user_password(
        uid, SimpleNamespace(new_password=None), _req(admin_id, PROD_ORIGIN), db_session)

    assert res["email_sent"] is False
    assert res["email_error"] == "SMTP_TIMEOUT"
    assert res["reset_link"] == f"{PROD_ORIGIN}/auth/reset?token={res['reset_token']}"
    assert res["expires_hours"] == H


def test_email_error_codes_are_registered():
    registered = {m.value: m for m in ErrorCode}
    for code in ("SMTP_SEND_FAILED", "SMTP_TIMEOUT"):
        assert code in registered
        assert registered[code].category is Category.SERVER


# ── 배포 전 검사(scripts/prod-reset-link-check.sh)와 실제 링크 ─────────────────────
# 운영 compose처럼 ALLOWED_ORIGINS 원문을 환경변수로 두고 library.origins를 다시 읽어(목록 파싱까지 실제 코드),
# 가짜 토큰으로 만든 링크의 주소가 검사 스크립트가 출력하는 주소(fixture의 link_base)와 같은지 본다.
# 같은 fixture로 frontend/library/prodResetLinkCheck.test.js가 스크립트의 통과·실패를 확인한다.
RESET_LINK_CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "reset_link_origin_cases.json").read_text(encoding="utf-8"))
FAKE_TOKEN = "rst_fake-token-for-test"


@pytest.fixture
def prod_env(monkeypatch):
    def apply(allowed_origins, frontend_url=None):
        monkeypatch.delenv("FRONTEND_PORT", raising=False)  # 운영 compose는 넘기지 않는다 → 기본 3000
        if allowed_origins is None:
            monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
        else:
            monkeypatch.setenv("ALLOWED_ORIGINS", allowed_origins)
        importlib.reload(origins)
        monkeypatch.setattr(origins, "DEBUG", False)
        # config.py처럼 끝 슬래시를 뗀 값. 운영 compose는 FRONTEND_URL을 넘기지 않는다(None → 빈 값).
        monkeypatch.setattr(admin_controller, "FRONTEND_URL", (frontend_url or "").rstrip("/"))
    yield apply
    monkeypatch.undo()
    importlib.reload(origins)  # 원래 환경변수로 모듈 상태를 되돌린다


@pytest.mark.parametrize("case", RESET_LINK_CASES, ids=[c["name"] for c in RESET_LINK_CASES])
def test_reset_link_uses_the_address_the_deploy_check_reports(prod_env, case):
    prod_env(case["allowed_origins"], case["frontend_url"])

    # Origin이 없거나 허용 목록 밖이면 이 주소로 만든다 — 메일 버튼이 실제로 가리킬 주소
    link = admin_controller._build_reset_link(FAKE_TOKEN, _req(1))

    assert link == f"{case['link_base']}/auth/reset?token={FAKE_TOKEN}"


def test_any_allowed_origin_can_become_the_reset_link(prod_env):
    # 관리자 브라우저가 둘째 항목 주소에 있으면 그 항목으로 링크를 만든다 — 검사가 첫 항목만 보면 안 되는 이유
    prod_env("https://weave.acme.co.kr,http://localhost:3000")

    link = admin_controller._build_reset_link(FAKE_TOKEN, _req(1, "http://localhost:3000"))

    assert link == f"http://localhost:3000/auth/reset?token={FAKE_TOKEN}"
