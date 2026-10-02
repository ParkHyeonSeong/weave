"""통합 ui_prefs(per-user 뷰 상태) 모델 테스트."""
import pytest
from pydantic import ValidationError
from sqlalchemy import text

from core.model import user as user_model


def test_update_ui_prefs_preserves_mixed_home_layout_and_empty_home():
    from routers.schema.profile import UpdateUiPrefs
    for layout in (["app:canvas", "widget:recent", "app:branch"], []):
        assert UpdateUiPrefs(home_layout=layout).model_dump(exclude_none=True) == {"home_layout": layout}


def test_update_ui_prefs_rejects_invalid_home_items():
    from routers.schema.profile import UpdateUiPrefs
    for layout in (["unknown"], ["app:canvas", "app:canvas"], [42]):
        with pytest.raises(ValidationError):
            UpdateUiPrefs(home_layout=layout)


def test_update_ui_prefs_keeps_widget_sizes_without_a_height_preset_limit():
    from routers.schema.profile import UpdateUiPrefs
    sizes = {"widget:recent": {"columns": 8, "rows": 64}}
    assert UpdateUiPrefs(home_sizes=sizes).model_dump(exclude_none=True) == {"home_sizes": sizes}
    assert UpdateUiPrefs(home_sizes={}).model_dump(exclude_none=True) == {"home_sizes": {}}


@pytest.mark.parametrize("sizes", [
    {"app:canvas": {"columns": 4, "rows": 2}},
    {"unknown": {"columns": 4, "rows": 2}},
    {"widget:recent": {"columns": 2, "rows": 2}},
    {"widget:scrum": {"columns": 9, "rows": 2}},
    {"widget:scrum": {"columns": 2, "rows": 0}},
    {"widget:scrum": {"columns": 2, "rows": 2.5}},
    {"widget:scrum": {"columns": True, "rows": 2}},
])
def test_update_ui_prefs_validates_widget_size_bounds(sizes):
    from routers.schema.profile import UpdateUiPrefs
    with pytest.raises(ValidationError):
        UpdateUiPrefs(home_sizes=sizes)


async def _make_user(db, email):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": "u"})
    return row.scalar_one()


async def test_ui_prefs_roundtrip_and_namespace_merge(db_session):
    uid = await _make_user(db_session, "uiprefs1@test.local")
    assert await user_model.get_ui_prefs(uid, db_session) is None

    # sidebar_order 저장
    await user_model.update_ui_prefs(uid, {"sidebar_order": {"branches": [3, 1, 2]}}, db_session)
    got = await user_model.get_ui_prefs(uid, db_session)
    assert got["sidebar_order"]["branches"] == [3, 1, 2]

    # hidden만 PATCH해도 sidebar_order 보존(DB 원자적 top-level 병합)
    await user_model.update_ui_prefs(uid, {"hidden": {"branches": [2]}}, db_session)
    got2 = await user_model.get_ui_prefs(uid, db_session)
    assert got2["sidebar_order"]["branches"] == [3, 1, 2]
    assert got2["hidden"]["branches"] == [2]

    await user_model.update_ui_prefs(uid, {"home_layout": ["widget:recent", "app:canvas"], "theme": "dark"}, db_session)
    await user_model.update_ui_prefs(uid, {"home_sizes": {"widget:recent": {"columns": 8, "rows": 64}}}, db_session)
    resized = await user_model.get_ui_prefs(uid, db_session)
    assert resized["home_sizes"]["widget:recent"] == {"columns": 8, "rows": 64}
    assert resized["home_layout"] == ["widget:recent", "app:canvas"]
    assert resized["theme"] == "dark"
    assert resized["hidden"] == {"branches": [2]}


def test_update_ui_prefs_schema_allows_home_controls():
    from routers.schema.profile import UpdateUiPrefs
    body = UpdateUiPrefs(home_controls={"branch": {"sort": "progress", "view": "list"}})
    patch = body.model_dump(exclude_none=True)
    assert patch == {"home_controls": {"branch": {"sort": "progress", "view": "list"}}}


def test_update_ui_prefs_schema_allows_saved_view_pins():
    from routers.schema.profile import UpdateUiPrefs
    body = UpdateUiPrefs(saved_view_pins={"7": [1, 2], "global": [5]})
    patch = body.model_dump(exclude_none=True)
    assert patch == {"saved_view_pins": {"7": [1, 2], "global": [5]}}


async def test_ui_prefs_saved_view_pins_merge(db_session):
    uid = await _make_user(db_session, "uiprefs_pins@test.local")
    await user_model.update_ui_prefs(uid, {"sidebar_order": {"branches": [1]}}, db_session)
    await user_model.update_ui_prefs(uid, {"saved_view_pins": {"7": [1, 2]}}, db_session)
    got = await user_model.get_ui_prefs(uid, db_session)
    assert got["saved_view_pins"]["7"] == [1, 2]
    assert got["sidebar_order"]["branches"] == [1]  # 기존 네임스페이스 보존


def test_update_ui_prefs_schema_allows_comment_sort():
    from routers.schema.profile import UpdateUiPrefs
    body = UpdateUiPrefs(comment_sort="newest")
    assert body.model_dump(exclude_none=True) == {"comment_sort": "newest"}


def test_update_ui_prefs_schema_rejects_invalid_comment_sort():
    from routers.schema.profile import UpdateUiPrefs
    with pytest.raises(ValidationError):
        UpdateUiPrefs(comment_sort="popular")


def test_update_ui_prefs_schema_allows_editor_raw_mode():
    from routers.schema.profile import UpdateUiPrefs
    body = UpdateUiPrefs(editor_raw_mode=True)
    assert body.model_dump(exclude_none=True) == {"editor_raw_mode": True}
    # False도 exclude_none에 남아야 한다 (off 저장 가능)
    body_off = UpdateUiPrefs(editor_raw_mode=False)
    assert body_off.model_dump(exclude_none=True) == {"editor_raw_mode": False}


def test_update_ui_prefs_schema_rejects_non_bool_editor_raw_mode():
    from routers.schema.profile import UpdateUiPrefs
    with pytest.raises(ValidationError):
        UpdateUiPrefs(editor_raw_mode="always")


def test_update_ui_prefs_schema_allows_theme():
    from routers.schema.profile import UpdateUiPrefs
    for v in ("light", "dark", "system"):
        body = UpdateUiPrefs(theme=v)
        assert body.model_dump(exclude_none=True) == {"theme": v}


def test_update_ui_prefs_schema_rejects_invalid_theme():
    from routers.schema.profile import UpdateUiPrefs
    with pytest.raises(ValidationError):
        UpdateUiPrefs(theme="midnight")


async def test_ui_prefs_theme_survives_other_namespace_patch(db_session):
    uid = await _make_user(db_session, "uiprefs_theme@test.local")
    await user_model.update_ui_prefs(uid, {"theme": "dark"}, db_session)
    await user_model.update_ui_prefs(uid, {"comment_sort": "oldest"}, db_session)
    got = await user_model.get_ui_prefs(uid, db_session)
    assert got["theme"] == "dark"          # 타 네임스페이스 PATCH에도 보존
    assert got["comment_sort"] == "oldest"
