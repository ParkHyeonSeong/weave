from datetime import date

from fastmcp import Client

from weave_mcp import _app
from weave_mcp.tools import scrum as scrum_tools


def _fixed_today(d):
    """_workspace_today는 async다(workspace timezone을 서버에서 읽는다)."""
    async def _today():
        return d
    return _today


async def test_list_scrum_boards(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_scrum_boards", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum")


async def test_get_scrum_board(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_scrum_board", {"board_id": 4})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/4")


async def test_get_scrum_home_cards(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_scrum_home_cards", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/home-cards")


async def test_get_scrum_week_explicit(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_scrum_week", {"board_id": 4, "iso_year": 2026, "iso_week": 25})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/4/weeks/2026/25/cells")


async def test_get_scrum_week_defaults_to_today(fake_client, monkeypatch):
    monkeypatch.setattr(scrum_tools, "_workspace_today", _fixed_today(date(2026, 6, 15)))  # ISO 2026-W25
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_scrum_week", {"board_id": 4})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/4/weeks/2026/25/cells")


async def test_write_scrum_daily_today_monday(fake_client, monkeypatch):
    monkeypatch.setattr(scrum_tools, "_workspace_today", _fixed_today(date(2026, 6, 15)))  # 월요일 → day 0
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("write_scrum_daily", {"board_id": 4, "text": "로그인 수정"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/scrum/4/weeks/2026/25/cells",
        json={"day": 0, "row": "plan", "text": "로그인 수정", "mode": "replace"})


async def test_write_scrum_daily_weekend_errors(fake_client, monkeypatch):
    monkeypatch.setattr(scrum_tools, "_workspace_today", _fixed_today(date(2026, 6, 13)))  # 토요일
    async with Client(_app.mcp) as client:
        res = await client.call_tool("write_scrum_daily", {"board_id": 4, "text": "x"})
    fake_client.call_json.assert_not_awaited()
    err = res.data["error"]
    assert err["code"] == "WEEKEND_NO_CELL"
    assert err["category"] == "validation"
    assert err["retryable"] is False


async def test_write_scrum_daily_explicit_day(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("write_scrum_daily",
            {"board_id": 4, "text": "메모", "row": "gap", "day": 2,
             "mode": "append", "iso_year": 2026, "iso_week": 25})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/scrum/4/weeks/2026/25/cells",
        json={"day": 2, "row": "gap", "text": "메모", "mode": "append"})


async def test_get_current_retro(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_current_retro", {"board_id": 4})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/4/retros/current")


async def test_get_scrum_retro_cells(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_scrum_retro_cells", {"board_id": 4, "retro_id": 9})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/4/retros/9/cells")


async def test_write_scrum_retro(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("write_scrum_retro",
            {"board_id": 4, "retro_id": 9, "key": "keep", "text": "좋았던 점"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/scrum/4/retros/9/cells",
        json={"key": "keep", "text": "좋았던 점", "mode": "replace"})


async def test_list_scrum_retros(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_scrum_retros", {"board_id": 4})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/scrum/4/retros")


# ---------------------------------------------------------------------------
# workspace timezone 계약 — 기본 주차/요일은 개인 시간대가 아니라 workspace를 따른다
# ---------------------------------------------------------------------------

async def test_workspace_time_zone_read_from_setup_status(fake_client, monkeypatch):
    monkeypatch.setattr(scrum_tools, "_workspace_tz_cache", None)
    fake_client.call_json.return_value = {
        "status": True, "initialized": True, "time_zone": "America/New_York"}
    assert await scrum_tools._workspace_time_zone() == "America/New_York"
    fake_client.call_json.assert_awaited_once_with("GET", "/api/setup/status")


async def test_workspace_time_zone_old_server_without_field_uses_compat(fake_client, monkeypatch):
    """구버전 서버의 **성공** 응답에 time_zone이 없을 때만 Asia/Seoul 호환값을 쓴다."""
    monkeypatch.setattr(scrum_tools, "_workspace_tz_cache", None)
    fake_client.call_json.return_value = {"status": True, "initialized": True}
    assert await scrum_tools._workspace_time_zone() == "Asia/Seoul"


async def test_workspace_time_zone_failure_raises_and_is_not_cached(fake_client, monkeypatch):
    """네트워크 오류·오류 봉투는 호환값으로 추측하지 않고 예외로 올리며 캐시하지 않는다."""
    import pytest
    monkeypatch.setattr(scrum_tools, "_workspace_tz_cache", None)
    fake_client.call_json.side_effect = RuntimeError("backend restarting")
    with pytest.raises(scrum_tools.WorkspaceTimeZoneUnavailable):
        await scrum_tools._workspace_time_zone()
    assert scrum_tools._workspace_tz_cache is None

    fake_client.call_json.side_effect = None
    fake_client.call_json.return_value = {"error": {"category": "server", "message": "boom"}}
    with pytest.raises(scrum_tools.WorkspaceTimeZoneUnavailable):
        await scrum_tools._workspace_time_zone()
    assert scrum_tools._workspace_tz_cache is None

    # 다음 호출이 실제 값을 받아 오면 그때 캐시된다(성공만 캐시)
    fake_client.call_json.return_value = {"status": True, "time_zone": "America/New_York"}
    assert await scrum_tools._workspace_time_zone() == "America/New_York"
    assert scrum_tools._workspace_tz_cache == "America/New_York"


async def test_workspace_time_zone_unloadable_zone_raises(fake_client, monkeypatch):
    """ZoneInfo를 로드할 수 없으면(tzdata 없는 호스트 등) 예외 — 폴백 추측 없음."""
    import pytest
    monkeypatch.setattr(scrum_tools, "_workspace_tz_cache", None)
    fake_client.call_json.return_value = {"status": True, "time_zone": "Not/AZone"}
    with pytest.raises(scrum_tools.WorkspaceTimeZoneUnavailable):
        await scrum_tools._workspace_time_zone()
    assert scrum_tools._workspace_tz_cache is None


async def test_workspace_time_zone_is_cached(fake_client, monkeypatch):
    monkeypatch.setattr(scrum_tools, "_workspace_tz_cache", None)
    fake_client.call_json.return_value = {"status": True, "time_zone": "Europe/Paris"}
    assert await scrum_tools._workspace_time_zone() == "Europe/Paris"
    assert await scrum_tools._workspace_time_zone() == "Europe/Paris"
    assert fake_client.call_json.await_count == 1


async def test_default_week_uses_workspace_timezone(fake_client, monkeypatch):
    """같은 instant라도 workspace timezone이 다르면 기본 ISO week가 갈린다."""
    from datetime import datetime, timezone as _tz

    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 1, 1, 16, 0, tzinfo=_tz.utc).astimezone(tz)

    monkeypatch.setattr(scrum_tools, "datetime", _FrozenDatetime)

    monkeypatch.setattr(scrum_tools, "_workspace_tz_cache", "Asia/Seoul")
    assert (await scrum_tools._workspace_today()).isoformat() == "2026-01-02"

    monkeypatch.setattr(scrum_tools, "_workspace_tz_cache", "America/New_York")
    assert (await scrum_tools._workspace_today()).isoformat() == "2026-01-01"


async def test_get_scrum_week_fails_closed_when_timezone_unknown(fake_client, monkeypatch):
    """기본 주차가 필요한데 workspace timezone 조회가 실패하면 retryable 오류를 돌려주고
    Scrum 읽기/생성 요청을 하나도 보내지 않는다."""
    monkeypatch.setattr(scrum_tools, "_workspace_tz_cache", None)
    fake_client.call_json.side_effect = RuntimeError("network down")
    async with Client(_app.mcp) as client:
        res = await client.call_tool("get_scrum_week", {"board_id": 4})
    err = res.data["error"]
    assert err["code"] == "WORKSPACE_TZ_UNAVAILABLE"
    assert err["category"] == "network"
    assert err["retryable"] is True
    # setup/status 조회 1회뿐 — /api/scrum/ 경로는 호출되지 않았다
    assert fake_client.call_json.await_count == 1
    assert all("/api/scrum/" not in str(c.args) for c in fake_client.call_json.await_args_list)


async def test_write_scrum_daily_fails_closed_when_timezone_unknown(fake_client, monkeypatch):
    """기본 요일/주차가 필요한 쓰기는 timezone을 모르면 아무 요청도 보내지 않는다."""
    monkeypatch.setattr(scrum_tools, "_workspace_tz_cache", None)
    fake_client.call_json.return_value = {"error": {"category": "server", "message": "boom"}}
    async with Client(_app.mcp) as client:
        res = await client.call_tool("write_scrum_daily", {"board_id": 4, "text": "x"})
    err = res.data["error"]
    assert err["code"] == "WORKSPACE_TZ_UNAVAILABLE"
    assert err["retryable"] is True
    assert fake_client.call_json.await_count == 1
    assert all("PATCH" not in str(c.args) for c in fake_client.call_json.await_args_list)


async def test_workspace_time_zone_uninitialized_new_server_is_not_compat(fake_client, monkeypatch):
    """setup 전의 **새** 서버(initialized=False, time_zone 없음)는 구버전 compat(Asia/Seoul) 대상이
    아니다 — 확정 불가로 올리고 캐시하지 않는다."""
    import pytest
    monkeypatch.setattr(scrum_tools, "_workspace_tz_cache", None)
    fake_client.call_json.return_value = {"status": True, "initialized": False}
    with pytest.raises(scrum_tools.WorkspaceTimeZoneUnavailable):
        await scrum_tools._workspace_time_zone()
    assert scrum_tools._workspace_tz_cache is None


async def test_get_scrum_week_token_not_set_returns_auth_error_unchanged(fake_client, monkeypatch):
    """WEAVE_API_TOKEN 미설정 같은 영구 auth 오류는 retryable network 오류로 둔갑하지 않고
    그 봉투 그대로 돌아온다. Scrum 요청은 역시 하나도 보내지 않는다."""
    monkeypatch.setattr(scrum_tools, "_workspace_tz_cache", None)
    from weave_mcp import errors as E
    # client.call_json이 토큰 미설정 시 돌려주는 봉투와 같은 모양
    fake_client.call_json.return_value = E.make_error(
        "auth", code=E.TOKEN_NOT_SET, message="WEAVE_API_TOKEN is not set")
    async with Client(_app.mcp) as client:
        res = await client.call_tool("get_scrum_week", {"board_id": 4})
    err = res.data["error"]
    assert err["code"] == "TOKEN_NOT_SET"
    assert err["category"] == "auth"
    assert err["retryable"] is False
    assert fake_client.call_json.await_count == 1
    assert all("/api/scrum/" not in str(c.args) for c in fake_client.call_json.await_args_list)
    assert scrum_tools._workspace_tz_cache is None


async def test_write_scrum_daily_does_not_fetch_when_all_args_given(fake_client, monkeypatch):
    """세 값을 모두 명시하면 timezone을 조회하지 않고(실패 상태여도) 그대로 실행한다."""
    monkeypatch.setattr(scrum_tools, "_workspace_tz_cache", None)
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("write_scrum_daily",
            {"board_id": 4, "text": "x", "day": 0, "iso_year": 2026, "iso_week": 25})
    assert fake_client.call_json.await_count == 1
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/scrum/4/weeks/2026/25/cells",
        json={"day": 0, "row": "plan", "text": "x", "mode": "replace"})
