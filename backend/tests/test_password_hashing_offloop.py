"""bcrypt 계산은 워커 스레드에서 돈다 — 워커 1개에서 누가 로그인·가입·비밀번호 변경을 하는 동안에도
이벤트 루프(다른 사람의 API 응답·실시간 편집 전달)가 멈추지 않는다.

가짜 bcrypt가 스레드 이벤트를 기다리게 해 순서를 고정한다. 루프에서 직접 불리면 그 기다림 동안 루프가
멈춰 다른 콜백이 돌지 못하고, 스레드에서 불리면 기다리는 동안에도 돈다(실제 bcrypt도 계산 중 GIL을 놓는다).
"""
import asyncio
import threading
from types import SimpleNamespace

import bcrypt
from fastapi import Response

from core.controller import auth as auth_controller
from core.model import user as user_model
from library import crypto


class SlowBcrypt:
    """release가 설정될 때까지(최대 2초) 부른 스레드를 붙잡는 가짜 bcrypt 함수."""
    def __init__(self, result):
        self.result = result
        self.args = None
        self.started = threading.Event()
        self.release = threading.Event()

    def __call__(self, *args):
        self.args = args
        self.started.set()
        self.release.wait(2)
        return self.result


async def _loop_ran_during(fake, task):
    """가짜 bcrypt가 도는 동안 루프가 다른 콜백을 돌렸는지. 루프에서 직접 불렸다면 가짜가 끝날 때까지 이
    코루틴이 재개되지 못하고, 재개됐을 때는 task가 이미 끝나 있다."""
    for _ in range(100):
        if fake.started.is_set():
            break
        await asyncio.sleep(0.01)
    ran = asyncio.Event()
    asyncio.get_running_loop().call_soon(ran.set)
    await asyncio.wait_for(ran.wait(), 1)
    return fake.started.is_set() and not task.done()


async def test_check_password_does_not_block_event_loop(monkeypatch):
    fake = SlowBcrypt(result=True)
    monkeypatch.setattr(bcrypt, "checkpw", fake)
    task = asyncio.create_task(crypto.check_password("pw", b"stored"))
    try:
        assert await _loop_ran_during(fake, task)
    finally:
        fake.release.set()
    assert await task is True
    assert fake.args == (b"pw", b"stored")


async def test_hash_password_async_does_not_block_event_loop(monkeypatch):
    fake = SlowBcrypt(result=b"$2b$12$hash")
    monkeypatch.setattr(bcrypt, "hashpw", fake)
    task = asyncio.create_task(crypto.hash_password_async("pw12345678"))
    try:
        assert await _loop_ran_during(fake, task)
    finally:
        fake.release.set()
    assert await task == b"$2b$12$hash"
    assert fake.args[0] == b"pw12345678"


async def test_login_does_not_block_event_loop(monkeypatch):
    # 없는 계정 경로 — DB 없이도 더미 해시로 bcrypt를 한 번 돈다(SEC-13-C)
    async def no_user(email, db):
        return None
    monkeypatch.setattr(user_model, "find_by_email", no_user)
    fake = SlowBcrypt(result=False)
    monkeypatch.setattr(bcrypt, "checkpw", fake)
    body = SimpleNamespace(email="ghost@test.local", password="wrongpass1")
    req = SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))
    task = asyncio.create_task(auth_controller.login(body, req, Response(), None))
    try:
        assert await _loop_ran_during(fake, task)
    finally:
        fake.release.set()
    assert await task == {"status": False, "message": "INVALID_CREDENTIALS"}
    assert fake.args[1] == auth_controller._DUMMY_HASH
