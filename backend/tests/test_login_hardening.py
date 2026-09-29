"""SEC-13-B/C: 로그인 비번-먼저 재구조 — 계정 열거 방지 + 타이밍 사이드채널 방지.

- 비밀번호가 틀리거나 계정이 없으면 존재/상태를 구분할 수 없는 단일 INVALID_CREDENTIALS.
- 계정 상태(pending/rejected/inactive)는 비밀번호가 맞은 뒤에만 공개.
- 존재하지 않는 이메일에도 더미 해시로 bcrypt를 항상 수행(타이밍 차단).
"""
from types import SimpleNamespace

import bcrypt
from fastapi import Response
from sqlalchemy import text

from core.controller import auth as auth_controller
from core.model import user as user_model


def _body(email, password):
    return SimpleNamespace(email=email, password=password)


def _req():
    # _get_client_ip는 헤더(.get) → request.client.host 순으로 본다
    return SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))


async def _seed(db, email, password="correctpass1", status="active"):
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES (:e, :p, :u, :s, 'member') RETURNING user_id
    """), {"e": email, "p": pw_hash, "u": "loginuser", "s": status})
    return row.scalar_one()


async def _login(db, email, password):
    return await auth_controller.login(_body(email, password), _req(), Response(), db)


# ── 정상 동작 보존 ─────────────────────────────────────────────────────────

async def test_active_correct_password_succeeds(db_session):
    await _seed(db_session, "active@test.local")
    res = await _login(db_session, "active@test.local", "correctpass1")
    assert res["status"] is True
    assert res["profile"]["email"] == "active@test.local"


async def test_active_wrong_password_invalid(db_session):
    await _seed(db_session, "active2@test.local")
    res = await _login(db_session, "active2@test.local", "wrongpass99")
    assert res["status"] is False
    assert res["message"] == "INVALID_CREDENTIALS"


# ── 비번이 맞은 뒤에만 상태 공개 ───────────────────────────────────────────

async def test_pending_correct_reveals_status(db_session):
    await _seed(db_session, "pending@test.local", status="pending")
    res = await _login(db_session, "pending@test.local", "correctpass1")
    assert res["status"] is False
    assert res["message"] == "ACCOUNT_PENDING"


async def test_rejected_correct_reveals_status(db_session):
    await _seed(db_session, "rejected@test.local", status="rejected")
    res = await _login(db_session, "rejected@test.local", "correctpass1")
    assert res["status"] is False
    assert res["message"] == "ACCOUNT_REJECTED"


async def test_inactive_correct_reveals_status(db_session):
    await _seed(db_session, "inactive@test.local", status="inactive")
    res = await _login(db_session, "inactive@test.local", "correctpass1")
    assert res["status"] is False
    assert res["message"] == "ACCOUNT_INACTIVE"


# ── SEC-13-B: 비번 틀리면 상태·존재 비노출 ─────────────────────────────────

async def test_pending_wrong_password_does_not_leak_status(db_session):
    await _seed(db_session, "pending2@test.local", status="pending")
    res = await _login(db_session, "pending2@test.local", "wrongpass99")
    # 비번이 틀리면 ACCOUNT_PENDING이 아니라 통일된 INVALID_CREDENTIALS
    assert res["status"] is False
    assert res["message"] == "INVALID_CREDENTIALS"


async def test_nonexistent_email_invalid(db_session):
    res = await _login(db_session, "ghost@test.local", "whatever1")
    assert res["status"] is False
    assert res["message"] == "INVALID_CREDENTIALS"


async def test_existing_wrong_equals_nonexistent(db_session):
    # 계정 열거 차단: 존재+오답 응답과 미존재 응답이 완전히 동일해야 한다
    await _seed(db_session, "enum@test.local")
    existing_wrong = await _login(db_session, "enum@test.local", "wrongpass99")
    nonexistent = await _login(db_session, "ghost-enum@test.local", "wrongpass99")
    assert existing_wrong == nonexistent == {"status": False, "message": "INVALID_CREDENTIALS"}


# ── SEC-13-C: 존재하지 않는 이메일에도 bcrypt 수행(타이밍 차단) ────────────

async def test_bcrypt_runs_even_for_nonexistent_email(db_session, monkeypatch):
    calls = []
    real_checkpw = bcrypt.checkpw

    def spy(pw, h):
        calls.append(h)
        return real_checkpw(pw, h)

    # crypto.check_password가 워커 스레드에서 부르는 모듈 함수를 바꾼다(auth.py는 bcrypt를 import하지 않는다)
    monkeypatch.setattr(bcrypt, "checkpw", spy)
    res = await _login(db_session, "ghost2@test.local", "whatever1")
    assert res["message"] == "INVALID_CREDENTIALS"
    # 없는 계정에도 bcrypt가 정확히 1회, 더미 해시로 수행돼야 한다
    assert len(calls) == 1
    assert calls[0] == auth_controller._DUMMY_HASH


async def test_nonexistent_with_dummy_seed_string_still_invalid(db_session):
    # 더미 해시의 평문을 비밀번호로 보내 checkpw가 매칭되더라도, 계정이 없으면
    # `not user` 가드가 막아 인증되지 않는다.
    res = await _login(db_session, "ghost3@test.local", "_dummy_never_matches_")
    assert res["status"] is False
    assert res["message"] == "INVALID_CREDENTIALS"


# ── must_change_password 흐름 보존 ────────────────────────────────────────

async def test_must_change_password_preserved(db_session):
    uid = await _seed(db_session, "mustchange@test.local")
    await user_model.set_must_change_password(uid, True, db_session)
    res = await _login(db_session, "mustchange@test.local", "correctpass1")
    assert res["status"] is True
    assert res["profile"]["must_change_password"] is True
