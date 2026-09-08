"""공용 기간(workspace timezone)과 개인 파생 상태(개인 timezone)의 경계 계약.

이 두 가지가 섞이면 나는 사고:
  · 공용 기간에 개인 timezone을 쓰면 같은 board 구성원이 서로 다른 scrum_week row를 만든다.
  · 개인 파생 상태에 workspace timezone을 쓰면 뉴욕 사용자가 자기 하루가 끝나기 전에
    연체 표시를 본다.
"""
import datetime
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import branch as branch_ctrl
from core.controller import scrum_home as home_ctrl
from core.controller import sprint as sprint_ctrl
from core.controller import task as task_ctrl
from core.controller import track as track_ctrl
from core.model import branch as branch_model
from core.model import track as track_model
from core.model import workspace as workspace_model
from library.time_context import personal_today, workspace_today


def _req(user_id):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


async def _make_user(db, email, username, ui_prefs=None):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, ui_prefs)
        VALUES (:e, :p, :u, 'active', CAST(:prefs AS jsonb)) RETURNING user_id
    """), {"e": email, "p": b"x", "u": username, "prefs": ui_prefs})
    return row.scalar_one()


async def _set_workspace_tz(db, tz):
    await db.execute(text("DELETE FROM workspace_settings WHERE setting_id = 1"))
    admin = await _make_user(db, f"wsadmin-{tz.replace('/', '-')}@test.local", "wsadmin")
    await workspace_model.create_settings('W', 'private', admin, db, time_zone=tz)
    return admin


# ---------------------------------------------------------------------------
# 공용 기간 — workspace timezone
# ---------------------------------------------------------------------------

async def test_scrum_today_follows_workspace_not_the_viewer(db_session):
    """같은 instant·같은 board를 서울 사용자와 뉴욕 사용자가 봐도 '오늘'이 하나여야 한다."""
    await _set_workspace_tz(db_session, 'Asia/Seoul')
    seoul_user = await _make_user(
        db_session, 'ws-seoul@test.local', 'seoul',
        '{"language_region": {"locale": "ko", "time_zone": "Asia/Seoul"}}')
    ny_user = await _make_user(
        db_session, 'ws-ny@test.local', 'ny',
        '{"language_region": {"locale": "en", "time_zone": "America/New_York"}}')

    now = datetime.datetime(2026, 9, 7, 15, 30, tzinfo=datetime.timezone.utc)
    shared = await workspace_today(db_session, now)
    assert shared == datetime.date(2026, 9, 8)          # 서울 기준

    # 개인 timezone은 각자 다르지만, 공용 기간은 둘 다 workspace 값을 쓴다.
    assert await personal_today(seoul_user, db_session, now) == datetime.date(2026, 9, 8)
    assert await personal_today(ny_user, db_session, now) == datetime.date(2026, 9, 7)
    assert await workspace_today(db_session, now) == shared


async def test_workspace_iso_week_identity_is_shared(db_session):
    """scrum_week의 (iso_year, iso_week)는 workspace timezone에서만 파생된다."""
    await _set_workspace_tz(db_session, 'Asia/Seoul')
    # 2026-01-01T16:00Z → 서울 1/2(금, ISO 2026-W01), 뉴욕 1/1(목, ISO 2026-W01)
    now = datetime.datetime(2026, 1, 1, 16, 0, tzinfo=datetime.timezone.utc)
    y, w, _ = (await workspace_today(db_session, now)).isocalendar()
    assert (y, w) == (2026, 1)

    await _set_workspace_tz(db_session, 'America/New_York')
    y2, w2, _ = (await workspace_today(db_session, now)).isocalendar()
    assert (y2, w2) == (2026, 1)
    # 날짜 자체는 갈린다 — 이것이 workspace 설정이 필요한 이유다.
    assert await workspace_today(db_session, now) == datetime.date(2026, 1, 1)


async def test_workspace_today_handles_dst_region(db_session):
    """America/New_York DST 경계에서도 달력 날짜가 정확하다(고정 offset이 아님)."""
    await _set_workspace_tz(db_session, 'America/New_York')
    # DST 시작 직전/직후 (2026-03-08)
    before = datetime.datetime(2026, 3, 8, 6, 0, tzinfo=datetime.timezone.utc)   # EST 01:00
    after = datetime.datetime(2026, 3, 8, 8, 0, tzinfo=datetime.timezone.utc)    # EDT 04:00
    assert await workspace_today(db_session, before) == datetime.date(2026, 3, 8)
    assert await workspace_today(db_session, after) == datetime.date(2026, 3, 8)
    # 여름(EDT -4)과 겨울(EST -5)에 UTC 03:30이 서로 다른 날에 속한다
    summer = datetime.datetime(2026, 7, 2, 3, 30, tzinfo=datetime.timezone.utc)
    winter = datetime.datetime(2026, 1, 2, 3, 30, tzinfo=datetime.timezone.utc)
    assert await workspace_today(db_session, summer) == datetime.date(2026, 7, 1)  # EDT 23:30
    assert await workspace_today(db_session, winter) == datetime.date(2026, 1, 1)  # EST 22:30


async def test_scrum_home_cards_use_workspace_today(db_session, monkeypatch):
    """home_cards가 개인 timezone이 아니라 **workspace_today**의 값을 collect_cards에 넘긴다.

    보드가 없는 뷰어로는 결과가 항상 []라 personal_today로 되돌려도 통과해 버리므로,
    workspace_today를 sentinel 날짜로 바꿔 끼우고 collect_cards가 정확히 그 값을 받는지 본다.
    """
    await _set_workspace_tz(db_session, 'Asia/Seoul')
    viewer = await _make_user(
        db_session, 'home-ny@test.local', 'home-ny',
        '{"language_region": {"locale": "en", "time_zone": "America/New_York"}}')

    sentinel = datetime.date(2031, 1, 1)
    received = {}

    async def fake_workspace_today(db, now=None):
        return sentinel

    async def fake_collect_cards(user_id, today, db):
        received['user_id'] = user_id
        received['today'] = today
        return {'status': True, 'today_pending': [], 'retro_due': []}

    monkeypatch.setattr(home_ctrl, 'workspace_today', fake_workspace_today)
    monkeypatch.setattr(home_ctrl, 'collect_cards', fake_collect_cards)

    res = await home_ctrl.home_cards(_req(viewer), db_session)
    assert res['status'] is True
    assert received == {'user_id': viewer, 'today': sentinel}
    # 개인 tz(뉴욕)의 오늘이 아니라는 것도 명시적으로 고정
    assert received['today'] != await personal_today(viewer, db_session)


# ---------------------------------------------------------------------------
# 개인 파생 상태 — $today
# ---------------------------------------------------------------------------

async def test_saved_filter_today_uses_requesting_users_timezone(db_session):
    """$today는 서버 로컬이 아니라 요청자의 개인 timezone 기준이다."""
    await _set_workspace_tz(db_session, 'Asia/Seoul')
    ny_user = await _make_user(
        db_session, 'q-ny@test.local', 'q-ny',
        '{"language_region": {"locale": "en", "time_zone": "America/New_York"}}')
    seoul_user = await _make_user(
        db_session, 'q-seoul@test.local', 'q-seoul',
        '{"language_region": {"locale": "ko", "time_zone": "Asia/Seoul"}}')

    now = datetime.datetime(2026, 9, 7, 15, 30, tzinfo=datetime.timezone.utc)
    assert await personal_today(ny_user, db_session, now) == datetime.date(2026, 9, 7)
    assert await personal_today(seoul_user, db_session, now) == datetime.date(2026, 9, 8)


async def test_task_query_builds_ctx_from_personal_today(db_session, monkeypatch):
    """query_cross_branch가 ctx['today']에 개인 timezone의 오늘을 넣는지 실제 경로로 확인."""
    await _set_workspace_tz(db_session, 'Asia/Seoul')
    ny_user = await _make_user(
        db_session, 'ctx-ny@test.local', 'ctx-ny',
        '{"language_region": {"locale": "en", "time_zone": "America/New_York"}}')

    captured = {}

    async def fake_query(branch_ids, spec, sort, group_by, limit, offset, ctx, db):
        captured.update(ctx)
        return {'items': [], 'total': 0, 'groups': None}

    async def fake_member_branch_ids(user_id, db):
        return {1}

    monkeypatch.setattr('core.model.task.query', fake_query)
    monkeypatch.setattr('core.model.branch_member.member_branch_ids', fake_member_branch_ids)

    body = SimpleNamespace(scope='my', filter=None, group_by=None, sort=None,
                           saved_view_id=None, limit=50, offset=0, page=1, page_size=50)
    res = await task_ctrl.query_cross_branch(body, _req(ny_user), db_session)
    assert res['status'] is True
    assert captured['user_id'] == ny_user
    assert captured['today'] == await personal_today(ny_user, db_session)


async def test_personal_today_falls_back_to_workspace_for_users_without_preference(db_session):
    """개인 설정이 없는 사용자는 workspace timezone을 쓴다(UTC로 떨어지지 않는다)."""
    await _set_workspace_tz(db_session, 'America/Los_Angeles')
    plain = await _make_user(db_session, 'q-plain@test.local', 'q-plain')
    now = datetime.datetime(2026, 9, 7, 3, 30, tzinfo=datetime.timezone.utc)   # LA 9/6 20:30
    assert await personal_today(plain, db_session, now) == datetime.date(2026, 9, 6)


# ---------------------------------------------------------------------------
# 홈 KPI seed helpers — '이번 주 마감'은 개인 파생 상태다
# ---------------------------------------------------------------------------

async def _make_branch(db, created_by, key):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('TZ', :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"k": key, "u": created_by})
    bid = row.scalar_one()
    # category 가 없으면 home_stats 가 'done' 으로 취급해 집계에서 빠진다 → todo 상태만 심는다.
    await db.execute(text("""
        INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order)
        VALUES (:b, 'todo', 'To Do', '#9CA3AF', 'todo', 0)
    """), {"b": bid})
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, 'owner')
    """), {"b": bid, "u": created_by})
    return bid


async def _make_task(db, branch_id, created_by, due_date=None, sprint_id=None):
    dn = (await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})).scalar_one()
    row = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, due_date, sprint_id, created_by)
        VALUES (:b, :dn, :t, 'todo', :d, :sp, :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": f"tz task {dn}", "d": due_date,
           "sp": sprint_id, "u": created_by})
    return row.scalar_one()


# UTC/서울은 이미 2026-09-08, 뉴욕은 아직 2026-09-07인 순간 (뉴욕 9/7 23:00 EDT)
BOUNDARY_NOW = datetime.datetime(2026, 9, 8, 3, 0, tzinfo=datetime.timezone.utc)


async def test_branch_home_due_this_week_follows_the_viewers_timezone(db_session):
    """UTC 날짜는 9/8이지만 뉴욕은 아직 9/7 — 9/7 마감 태스크는 뉴욕 사용자에게 '오늘 마감'이다.

    카드 숫자(home_stats)와 드릴다운 목록(home_stat_items)이 **같은 today**를 써야 1:1로 맞는다.
    """
    await _set_workspace_tz(db_session, 'Asia/Seoul')
    ny_user = await _make_user(
        db_session, 'bhome-ny@test.local', 'bhome-ny',
        '{"language_region": {"locale": "en", "time_zone": "America/New_York"}}')
    bid = await _make_branch(db_session, ny_user, 'TZB')
    await _make_task(db_session, bid, ny_user, due_date=datetime.date(2026, 9, 7))

    personal = await personal_today(ny_user, db_session, BOUNDARY_NOW)
    shared = await workspace_today(db_session, BOUNDARY_NOW)
    assert personal == datetime.date(2026, 9, 7)
    assert shared == datetime.date(2026, 9, 8)      # 서버/DB의 CURRENT_DATE(UTC)와 같은 날

    stats = await branch_model.home_stats(ny_user, personal, db_session)
    items = await branch_model.home_stat_items(ny_user, 'due_this_week', 20, personal, db_session)
    assert stats['due_this_week_count'] == 1
    assert items['total_count'] == 1                # 카드 = 목록
    assert items['items'][0]['due_date'] == '2026-09-07'

    # 회귀 지점: workspace/UTC 날짜로 세면 '어제'가 되어 카드에서도 목록에서도 사라진다.
    stale = await branch_model.home_stats(ny_user, shared, db_session)
    stale_items = await branch_model.home_stat_items(ny_user, 'due_this_week', 20, shared, db_session)
    assert stale['due_this_week_count'] == 0
    assert stale_items['total_count'] == 0


async def test_branch_home_controller_passes_personal_today_to_card_and_drilldown(db_session, monkeypatch):
    """컨트롤러가 오늘을 계산해 모델에 명시 인자로 넘긴다 — 카드와 드릴다운이 같은 값을 받는다."""
    sentinel = datetime.date(2031, 3, 4)
    seen = {}

    async def fake_personal_today(user_id, db, now=None):
        return sentinel

    async def fake_home_stats(user_id, today, db):
        seen['stats'] = today
        return {'due_this_week_count': 0}

    async def fake_home_stat_items(user_id, bucket, limit, today, db):
        seen['items'] = today
        return {'total_count': 0, 'items': []}

    monkeypatch.setattr(branch_ctrl, 'personal_today', fake_personal_today)
    monkeypatch.setattr(branch_model, 'home_stats', fake_home_stats)
    monkeypatch.setattr(branch_model, 'home_stat_items', fake_home_stat_items)

    assert (await branch_ctrl.get_home_stats(_req(7), db_session))['status'] is True
    assert (await branch_ctrl.get_home_stats_items(
        _req(7), 'due_this_week', 20, db_session))['status'] is True
    assert seen == {'stats': sentinel, 'items': sentinel}


async def test_track_home_due_this_week_follows_the_viewers_timezone(db_session, monkeypatch):
    """Track 홈도 Branch 홈과 같은 정책 — 개인 timezone의 오늘로 센다."""
    await _set_workspace_tz(db_session, 'Asia/Seoul')
    ny_user = await _make_user(
        db_session, 'thome-ny@test.local', 'thome-ny',
        '{"language_region": {"locale": "en", "time_zone": "America/New_York"}}')
    bid = await _make_branch(db_session, ny_user, 'TZT')
    task_id = await _make_task(db_session, bid, ny_user, due_date=datetime.date(2026, 9, 7))
    tid = (await db_session.execute(text("""
        INSERT INTO track (track_name, description, color, visibility, default_view, created_by)
        VALUES ('TZ Track', 'desc', '#0D9488', 'private', 'flow', :u) RETURNING track_id
    """), {"u": ny_user})).scalar_one()
    await db_session.execute(text("""
        INSERT INTO track_member (track_id, user_id, role) VALUES (:t, :u, 'owner')
    """), {"t": tid, "u": ny_user})
    await db_session.execute(text("""
        INSERT INTO track_item (track_id, source_type, source_task_id, position_x, position_y)
        VALUES (:t, 'task', :task, 0, 0)
    """), {"t": tid, "task": task_id})

    personal = await personal_today(ny_user, db_session, BOUNDARY_NOW)
    shared = await workspace_today(db_session, BOUNDARY_NOW)
    assert (personal, shared) == (datetime.date(2026, 9, 7), datetime.date(2026, 9, 8))

    assert (await track_model.home_stats(ny_user, personal, db_session))['due_this_week_count'] == 1
    assert (await track_model.home_stats(ny_user, shared, db_session))['due_this_week_count'] == 0

    # 컨트롤러가 개인 오늘을 넘기는지도 고정한다.
    seen = {}

    async def fake_personal_today(user_id, db, now=None):
        return personal

    async def fake_home_stats(user_id, today, db):
        seen['today'] = today
        return {'due_this_week_count': 0}

    monkeypatch.setattr(track_ctrl, 'personal_today', fake_personal_today)
    monkeypatch.setattr(track_model, 'home_stats', fake_home_stats)
    assert (await track_ctrl.get_home_stats(_req(ny_user), db_session))['status'] is True
    assert seen['today'] == personal


# ---------------------------------------------------------------------------
# 공유 저장 날짜 — sprint 시작·완료
# ---------------------------------------------------------------------------

async def test_sprint_start_and_complete_store_workspace_today(db_session, monkeypatch):
    """비어 있는 start_date/end_date는 서버 로컬 날짜가 아니라 workspace 오늘로 채워진다."""
    await _set_workspace_tz(db_session, 'America/New_York')
    user = await _make_user(db_session, 'sprint-tz@test.local', 'sprint-tz')
    bid = await _make_branch(db_session, user, 'TZS')
    sprint_id = (await db_session.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, goal, created_by, status)
        VALUES (:b, 'S', 'g', :u, 'future') RETURNING sprint_id
    """), {"b": bid, "u": user})).scalar_one()
    await _make_task(db_session, bid, user, sprint_id=sprint_id)   # 태스크가 없으면 시작 불가

    sentinel = datetime.date(2031, 5, 6)

    async def fake_workspace_today(db, now=None):
        return sentinel

    monkeypatch.setattr(sprint_ctrl, 'workspace_today', fake_workspace_today)

    assert (await sprint_ctrl.start(sprint_id, bid, _req(user), db_session))['status'] is True
    started = (await db_session.execute(
        text("SELECT start_date FROM sprint WHERE sprint_id = :s"), {"s": sprint_id})).scalar_one()
    assert started == sentinel

    res = await sprint_ctrl.complete(
        sprint_id, SimpleNamespace(move_to=None), bid, _req(user), db_session)
    assert res['status'] is True
    ended = (await db_session.execute(
        text("SELECT end_date FROM sprint WHERE sprint_id = :s"), {"s": sprint_id})).scalar_one()
    assert ended == sentinel


# ---------------------------------------------------------------------------
# 워크스페이스 시간대 변경 — 관리자 전용 · 앞으로의 기준만 바꾼다
# ---------------------------------------------------------------------------

async def test_workspace_time_zone_change_applies_forward_only(db_session):
    """관리자가 공용 시간대를 바꾸면 **앞으로의** workspace 오늘만 바뀐다.

    이미 저장된 date-only 값(스프린트 시작·종료일)은 소급 변환하지 않는다 —
    변환하면 지난 스프린트·주차 문서가 다른 날짜로 이동해 버린다.
    """
    from core.controller import admin as admin_ctrl
    from routers.schema import admin as admin_schema

    await _set_workspace_tz(db_session, 'Asia/Seoul')
    admin = await _make_user(db_session, 'wstz-admin@test.local', 'wstz-admin')
    bid = await _make_branch(db_session, admin, 'TZW')
    sprint_id = (await db_session.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, goal, created_by, status, start_date, end_date)
        VALUES (:b, 'S', 'g', :u, 'closed', DATE '2026-09-01', DATE '2026-09-05')
        RETURNING sprint_id
    """), {"b": bid, "u": admin})).scalar_one()

    now = datetime.datetime(2026, 9, 8, 3, 0, tzinfo=datetime.timezone.utc)
    assert await workspace_today(db_session, now) == datetime.date(2026, 9, 8)     # 서울

    body = admin_schema.UpdateWorkspaceTimeZone(time_zone='America/New_York')
    res = await admin_ctrl.update_workspace_time_zone(body, _req(admin), db_session)
    assert res['status'] is True and res['time_zone'] == 'America/New_York'

    # 앞으로의 공용 오늘은 새 시간대를 따른다
    assert await workspace_today(db_session, now) == datetime.date(2026, 9, 7)

    # 이미 저장된 date-only 값은 그대로다
    row = (await db_session.execute(text(
        "SELECT start_date, end_date FROM sprint WHERE sprint_id = :s"), {"s": sprint_id})).fetchone()
    assert row.start_date == datetime.date(2026, 9, 1)
    assert row.end_date == datetime.date(2026, 9, 5)


def test_workspace_time_zone_rejects_invalid_zone():
    """저장 값은 canonical IANA ID뿐이다 — 임의 문자열은 스키마에서 막힌다."""
    import pytest
    from pydantic import ValidationError
    from routers.schema import admin as admin_schema

    assert admin_schema.UpdateWorkspaceTimeZone(time_zone='America/New_York').time_zone \
        == 'America/New_York'
    for bad in ('KST', 'GMT+9', '', 'Not/AZone'):
        with pytest.raises(ValidationError):
            admin_schema.UpdateWorkspaceTimeZone(time_zone=bad)


def test_workspace_time_zone_routes_require_admin():
    """조회·변경 모두 관리자 전용이다(일반 멤버가 공용 기준을 바꿀 수 없다)."""
    from routers import admin as admin_router

    def dep_names(route):
        names = []
        for d in getattr(route, 'dependencies', []):
            names.append(getattr(getattr(d, 'dependency', None), '__name__', ''))
        return names

    routes = {(r.path, tuple(sorted(r.methods))): dep_names(r)
              for r in admin_router.router.routes if hasattr(r, 'methods')}
    assert 'require_admin' in routes[('/workspace', ('GET',))]
    assert 'require_admin' in routes[('/workspace/time-zone', ('PATCH',))]
