from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .. import errors as E
from .._app import mcp, get_client

# Scrum의 '오늘'/ISO week는 board 구성원 전원이 공유하는 값이므로 **workspace timezone**으로
# 계산한다(개인 시간대가 아니다). 그래야 MCP가 만드는 주차 행이 웹 UI·백엔드와 같은
# (board_id, iso_year, iso_week)를 가리킨다.
#
# ⚠️ fail-closed: workspace timezone을 확정할 수 없으면(조회 실패·오류 응답·ZoneInfo 로드 불가)
#    기본 주차/요일을 **추측하지 않는다**. 도구는 retryable 오류를 돌려주고 Scrum 읽기/생성/쓰기
#    요청을 하나도 보내지 않는다 — 잘못된 공유 주차 행이 생기는 것보다 재시도가 싸다.
#    유일한 폴백은 "성공 응답인데 time_zone 필드가 없는 구버전 서버(마이그레이션 064 이전)"
#    → 그 서버의 기존 동작인 Asia/Seoul이다. 네트워크 오류에는 절대 쓰지 않는다.
#    workspace timezone은 setup 이후 바뀌지 않으므로(변경 API가 없다) **성공한 조회만** 캐시한다.
_COMPAT_TIME_ZONE = "Asia/Seoul"
_workspace_tz_cache: str | None = None


class WorkspaceTimeZoneUnavailable(Exception):
    """workspace timezone을 확정할 수 없다 — 호출 도구가 retryable 오류로 바꾼다.

    envelope: 조회가 **인증 오류 봉투**(예: WEAVE_API_TOKEN 미설정)로 끝났으면 그 봉투를 그대로
    싣는다 — 영구 auth 오류를 "재시도하면 된다"는 network 오류로 둔갑시키지 않기 위해서다.
    """

    def __init__(self, reason: str, envelope: dict | None = None):
        super().__init__(reason)
        self.envelope = envelope


def _tz_unavailable_error(exc: "WorkspaceTimeZoneUnavailable"):
    if exc.envelope is not None:
        return exc.envelope
    reason = str(exc)
    return E.make_error(
        "network", code=E.WORKSPACE_TZ_UNAVAILABLE, retryable=True,
        message=("워크스페이스 시간대를 확인하지 못해 기본 주차/요일을 정할 수 없습니다. "
                 "잠시 후 다시 시도하거나 iso_year·iso_week(·day)를 직접 지정하세요. "
                 f"원인: {reason}"),
    )


async def _workspace_time_zone() -> str:
    """워크스페이스 공용 timezone(IANA ID). /api/setup/status를 재사용한다(미인증 엔드포인트).

    성공 시에만 캐시한다. 실패는 WorkspaceTimeZoneUnavailable로 올린다(추측 폴백 없음).
    """
    global _workspace_tz_cache
    if _workspace_tz_cache is not None:
        return _workspace_tz_cache
    try:
        status = await get_client().call_json("GET", "/api/setup/status")
    except Exception as exc:  # 네트워크/클라이언트 예외
        raise WorkspaceTimeZoneUnavailable(f"setup status request failed: {exc}") from exc
    if isinstance(status, dict) and isinstance(status.get("error"), dict) \
            and status["error"].get("category") == "auth":
        # 토큰 미설정 같은 영구 auth 오류는 그 봉투를 그대로 돌려준다(재시도로 풀리지 않는다).
        raise WorkspaceTimeZoneUnavailable("setup status returned an auth error", envelope=status)
    if not isinstance(status, dict) or "error" in status or status.get("status") is False:
        raise WorkspaceTimeZoneUnavailable("setup status returned an error")
    if status.get("initialized") is False:
        # 아직 setup 전인 **새** 서버 — 구버전 compat 대상이 아니다(캐시하면 프로세스 내내 잘못 남는다).
        raise WorkspaceTimeZoneUnavailable("workspace is not initialized yet")
    tz = status.get("time_zone")
    if tz is None:
        # 구버전 서버(064 이전)의 **성공** 응답 — 그 서버의 기존 동작(KST)을 따른다.
        tz = _COMPAT_TIME_ZONE
    if not isinstance(tz, str) or not tz:
        raise WorkspaceTimeZoneUnavailable("setup status has an invalid time_zone")
    try:
        ZoneInfo(tz)          # 로드 가능한 IANA ID인지 확인 (tzdata 없는 호스트면 여기서 실패)
    except Exception as exc:
        raise WorkspaceTimeZoneUnavailable(f"time zone {tz!r} cannot be loaded: {exc}") from exc
    _workspace_tz_cache = tz
    return tz


async def _workspace_today():
    """workspace timezone 기준 오늘 (테스트에서 monkeypatch 가능하도록 모듈 함수로 노출).

    확정할 수 없으면 WorkspaceTimeZoneUnavailable을 올린다 — 브라우저/서버 로컬 시계로 대체하지 않는다.
    """
    tz = await _workspace_time_zone()
    try:
        zone = ZoneInfo(tz)
    except Exception as exc:
        raise WorkspaceTimeZoneUnavailable(f"time zone {tz!r} cannot be loaded: {exc}") from exc
    return datetime.now(timezone.utc).astimezone(zone).date()


@mcp.tool
async def list_scrum_boards() -> Any:
    """List the Scrum boards (weekly daily-scrum + retrospective) you belong to.

    Call first to get a board_id for the other Scrum tools.
    """
    return await get_client().call_json("GET", "/api/scrum")


@mcp.tool
async def get_scrum_board(board_id: int) -> Any:
    """Get a Scrum board's metadata: config, members, and your role.

    Note: the daily-scrum cells and retro KPT cards are real-time collaborative
    (Yjs over WebSocket) and are NOT returned here — only board metadata is
    reachable over REST.
    """
    return await get_client().call_json("GET", f"/api/scrum/{board_id}")


@mcp.tool
async def get_scrum_home_cards() -> Any:
    """Get cross-board Scrum home cards (e.g. today's unwritten daily-scrum, due retros)."""
    return await get_client().call_json("GET", "/api/scrum/home-cards")


@mcp.tool
async def create_scrum_board(
    name: str,
    icon: str | None = None,
    color: str | None = None,
    visibility: str | None = None,
    retro_cadence: str | None = None,
    retro_interval_weeks: int | None = None,
    retro_template: str | None = None,
    retro_anchor_weekday: int | None = None,
) -> Any:
    """Create a new Scrum board (weekly daily-scrum + retro); you become its admin.

    Only name is required. color is #RRGGBB hex (default #16A34A). visibility is
    "private" (default) or "public". retro_cadence is "weekly" (default), "biweekly",
    "every_n_weeks", "monthly", or "manual"; retro_interval_weeks sets N for
    "every_n_weeks". retro_template is "kpt". retro_anchor_weekday is 0..4 (Mon..Fri,
    default 4=Fri) — the day a retro period closes. Omitted fields take server defaults.
    """
    body = {"name": name}
    body.update({k: v for k, v in {
        "icon": icon,
        "color": color,
        "visibility": visibility,
        "retro_cadence": retro_cadence,
        "retro_interval_weeks": retro_interval_weeks,
        "retro_template": retro_template,
        "retro_anchor_weekday": retro_anchor_weekday,
    }.items() if v is not None})
    return await get_client().call_json("POST", "/api/scrum", json=body)


@mcp.tool
async def update_scrum_board(
    board_id: int,
    name: str | None = None,
    icon: str | None = None,
    color: str | None = None,
    visibility: str | None = None,
    retro_cadence: str | None = None,
    retro_interval_weeks: int | None = None,
    retro_template: str | None = None,
    retro_anchor_weekday: int | None = None,
) -> Any:
    """Update a Scrum board's config; only provided fields change. Admin-only.

    Same field rules/enums as create_scrum_board (cadence, template, 0..4 weekday).
    """
    body = {k: v for k, v in {
        "name": name,
        "icon": icon,
        "color": color,
        "visibility": visibility,
        "retro_cadence": retro_cadence,
        "retro_interval_weeks": retro_interval_weeks,
        "retro_template": retro_template,
        "retro_anchor_weekday": retro_anchor_weekday,
    }.items() if v is not None}
    return await get_client().call_json("PATCH", f"/api/scrum/{board_id}", json=body)


@mcp.tool
async def delete_scrum_board(board_id: int) -> Any:
    """Archive (soft-delete) a Scrum board. Reversible via restore_scrum_board. Admin-only."""
    return await get_client().call_json("DELETE", f"/api/scrum/{board_id}")


@mcp.tool
async def restore_scrum_board(board_id: int) -> Any:
    """Restore an archived Scrum board (see list_archived_scrum_boards). Admin-only."""
    return await get_client().call_json("POST", f"/api/scrum/{board_id}/restore")


@mcp.tool
async def leave_scrum_board(board_id: int) -> Any:
    """Leave a Scrum board (remove yourself as a member); any member may leave.

    May return a category=business rejection (e.g. LAST_ADMIN / LAST_OWNER) if you are the board's last admin.
    """
    return await get_client().call_json("POST", f"/api/scrum/{board_id}/leave")


@mcp.tool
async def list_archived_scrum_boards() -> Any:
    """List your archived Scrum boards (candidates for restore_scrum_board)."""
    return await get_client().call_json("GET", "/api/scrum/archived")


@mcp.tool
async def get_scrum_week(board_id: int, iso_year: int | None = None,
                         iso_week: int | None = None) -> Any:
    """Read a weekly daily-scrum grid's cells (per member × weekday × plan/gap) as plain text.

    iso_year/iso_week default to the current ISO week in the **workspace time zone**
    (the shared boundary every board member sees). Returns the week meta plus a
    `cells` map keyed by "{user_id}:{day 0-4 Mon-Fri}:{plan|gap}".
    """
    if iso_year is None or iso_week is None:
        try:
            y, w, _ = (await _workspace_today()).isocalendar()
        except WorkspaceTimeZoneUnavailable as exc:
            return _tz_unavailable_error(exc)          # 어떤 Scrum 요청도 보내지 않는다
        iso_year, iso_week = y, w
    return await get_client().call_json(
        "GET", f"/api/scrum/{board_id}/weeks/{iso_year}/{iso_week}/cells")


@mcp.tool
async def write_scrum_daily(board_id: int, text: str, row: str = "plan",
                            day: int | None = None, mode: str = "replace",
                            iso_year: int | None = None, iso_week: int | None = None) -> Any:
    """Write YOUR OWN daily-scrum cell (the token owner's row).

    Defaults to today in the **workspace time zone** (the shared boundary every board
    member sees): row='plan' (To Do; 'gap' = Recap), day = today's weekday
    (0=Mon..4=Fri), current ISO week. mode='replace' (default) overwrites the cell;
    'append' adds a paragraph. Empty text with replace clears the cell. Weekends have no
    cell — specify day (0-4) explicitly for a weekend write. v1 is plain text only.
    """
    # workspace timezone 조회는 실제로 기본값이 필요할 때만 한다 — 세 인자가 모두 주어지면
    # 서버를 한 번도 더 부르지 않는다.
    if iso_year is None or iso_week is None or day is None:
        try:
            y, w, wd = (await _workspace_today()).isocalendar()  # wd: 1=Mon..7=Sun
        except WorkspaceTimeZoneUnavailable as exc:
            return _tz_unavailable_error(exc)          # 쓰기 요청을 보내지 않는다
        if iso_year is None:
            iso_year = y
        if iso_week is None:
            iso_week = w
        if day is None:
            if wd >= 6:
                return E.make_error(
                    "validation", code=E.WEEKEND_NO_CELL,
                    message="주말에는 데일리스크럼 셀이 없습니다. day(0=Mon..4=Fri)를 지정하세요.")
            day = wd - 1
    body = {"day": day, "row": row, "text": text, "mode": mode}
    return await get_client().call_json(
        "PATCH", f"/api/scrum/{board_id}/weeks/{iso_year}/{iso_week}/cells", json=body)


@mcp.tool
async def get_current_retro(board_id: int) -> Any:
    """Get-or-create the current period's retrospective doc (returns retro_id and period).

    For boards with a 'manual' retro cadence, retro is null (no auto retro). Use the
    returned retro_id with get_scrum_retro_cells / write_scrum_retro.
    """
    return await get_client().call_json("GET", f"/api/scrum/{board_id}/retros/current")


@mcp.tool
async def get_scrum_retro_cells(board_id: int, retro_id: int) -> Any:
    """Read a retrospective's KPT cells (per member × keep/problem/try) as plain text.

    Returns a `cells` map keyed by "{user_id}:{keep|problem|try}".
    """
    return await get_client().call_json(
        "GET", f"/api/scrum/{board_id}/retros/{retro_id}/cells")


@mcp.tool
async def write_scrum_retro(board_id: int, retro_id: int, key: str, text: str,
                            mode: str = "replace") -> Any:
    """Write YOUR OWN retrospective KPT cell (the token owner's row).

    key is 'keep', 'problem', or 'try'. mode='replace' (default) overwrites; 'append'
    adds a paragraph; empty text with replace clears the cell. v1 is plain text only.
    """
    body = {"key": key, "text": text, "mode": mode}
    return await get_client().call_json(
        "PATCH", f"/api/scrum/{board_id}/retros/{retro_id}/cells", json=body)


@mcp.tool
async def list_scrum_retros(board_id: int) -> Any:
    """List a board's past retrospectives (newest first)."""
    return await get_client().call_json("GET", f"/api/scrum/{board_id}/retros")


@mcp.tool
async def list_scrum_members(board_id: int) -> Any:
    """List a Scrum board's members (user_id, name, role).

    Resolve a person's name to the user_id needed by the member-write tools.
    (get_scrum_board also embeds the member list.)
    """
    return await get_client().call_json("GET", f"/api/scrum/{board_id}/members")


@mcp.tool
async def search_scrum_non_members(board_id: int, q: str = "") -> Any:
    """Search users who are NOT yet members of a Scrum board (candidates to invite).

    q matches name/email.
    """
    return await get_client().call_json(
        "GET", f"/api/scrum/{board_id}/members/search", params={"q": q}
    )


@mcp.tool
async def add_scrum_member(board_id: int, user_id: int, role: str = "member") -> Any:
    """Add (invite) a user to a Scrum board. role is "admin" or "member" (default).

    Resolve user_id via search_scrum_non_members(board_id). Admin-only.
    """
    return await get_client().call_json(
        "POST", f"/api/scrum/{board_id}/members",
        json={"user_id": user_id, "role": role},
    )


@mcp.tool
async def update_scrum_member_role(board_id: int, user_id: int, role: str) -> Any:
    """Change a Scrum board member's role. role is "admin" or "member". Admin-only."""
    return await get_client().call_json(
        "PATCH", f"/api/scrum/{board_id}/members/{user_id}", json={"role": role}
    )


@mcp.tool
async def remove_scrum_member(board_id: int, user_id: int) -> Any:
    """Remove a member from a Scrum board. Admin-only."""
    return await get_client().call_json(
        "DELETE", f"/api/scrum/{board_id}/members/{user_id}"
    )
