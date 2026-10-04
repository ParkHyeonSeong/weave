"""통합 ui_prefs(per-user 뷰 상태) 모델 테스트."""
from copy import deepcopy

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


@pytest.fixture
def home_canvas():
    return {
        "version": 1,
        "items": ["widget:recent", "app:branch"],
        "layouts": {
            "wide": {"columns": 17, "placements": {
                "widget:recent": {"x": 0, "y": 0, "w": 17, "h": 64},
                "app:branch": {"x": 0, "y": 64, "w": 1, "h": 1},
            }},
            "compact": {"columns": 4, "placements": {
                "widget:recent": {"x": 0, "y": 0, "w": 4, "h": 2},
                "app:branch": {"x": 0, "y": 2, "w": 1, "h": 1},
            }},
        },
    }


def test_home_canvas_v1_accepts_more_than_eight_columns_and_tall_widgets(home_canvas):
    from routers.schema.profile import UpdateUiPrefs
    assert UpdateUiPrefs(home_canvas=home_canvas).model_dump(exclude_none=True) == {
        "home_canvas": home_canvas,
    }


def test_home_canvas_v1_accepts_empty_home(home_canvas):
    from routers.schema.profile import UpdateUiPrefs
    home_canvas["items"] = []
    for base in home_canvas["layouts"].values():
        base["placements"] = {}
    assert UpdateUiPrefs(home_canvas=home_canvas).model_dump(exclude_none=True) == {
        "home_canvas": home_canvas,
    }


@pytest.mark.parametrize("path,value", [
    (("version",), 2),
    (("version",), True),
    (("version",), 1.0),
    (("version",), "1"),
    (("items",), ["widget:recent", "app:branch", "app:branch"]),
    (("items",), ["unknown", "app:branch"]),
    (("items",), [42]),
    (("items",), []),
    (("extra",), True),
    (("layouts", "mobile"), {"columns": 4, "placements": {}}),
    (("layouts", "wide", "extra"), True),
    (("layouts", "wide", "columns"), 3),
    (("layouts", "wide", "columns"), True),
    (("layouts", "wide", "columns"), 17.5),
    (("layouts", "wide", "columns"), "17"),
    (("layouts", "wide", "columns"), 9007199254740992),
    (("layouts", "wide", "placements", "unknown"), {"x": 1, "y": 64, "w": 1, "h": 1}),
    (("layouts", "wide", "placements", "widget:recent", "extra"), True),
    (("layouts", "wide", "placements", "widget:recent", "x"), True),
    (("layouts", "wide", "placements", "widget:recent", "x"), 0.5),
    (("layouts", "wide", "placements", "widget:recent", "x"), "0"),
    (("layouts", "wide", "placements", "widget:recent", "x"), -1),
    (("layouts", "wide", "placements", "widget:recent", "x"), 9007199254740992),
    (("layouts", "wide", "placements", "widget:recent", "y"), -1),
    (("layouts", "wide", "placements", "widget:recent", "y"), True),
    (("layouts", "wide", "placements", "widget:recent", "y"), 9007199254740991),
    (("layouts", "wide", "placements", "widget:recent", "w"), 0),
    (("layouts", "wide", "placements", "widget:recent", "w"), 3),
    (("layouts", "wide", "placements", "widget:recent", "w"), True),
    (("layouts", "wide", "placements", "widget:recent", "w"), 9007199254740992),
    (("layouts", "wide", "placements", "widget:recent", "h"), 0),
    (("layouts", "wide", "placements", "widget:recent", "h"), 1),
    (("layouts", "wide", "placements", "widget:recent", "h"), True),
    (("layouts", "wide", "placements", "widget:recent", "h"), 2.5),
    (("layouts", "wide", "placements", "widget:recent", "h"), "2"),
    (("layouts", "wide", "placements", "widget:recent", "h"), 9007199254740992),
    (("layouts", "wide", "placements", "app:branch", "w"), 2),
    (("layouts", "wide", "placements", "app:branch", "h"), 2),
    (("layouts", "wide", "placements", "app:branch", "x"), 17),
    (("layouts", "wide", "placements", "app:branch", "y"), 63),
    (("layouts", "compact", "placements", "app:branch", "y"), 1),
])
def test_home_canvas_v1_rejects_invalid_payloads(home_canvas, path, value):
    from routers.schema.profile import UpdateUiPrefs
    payload = deepcopy(home_canvas)
    target = payload
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(ValidationError):
        UpdateUiPrefs(home_canvas=payload)


@pytest.mark.parametrize("path", [
    ("version",), ("items",), ("layouts",),
    ("layouts", "wide"), ("layouts", "compact"),
    ("layouts", "wide", "columns"),
    ("layouts", "wide", "placements"),
    ("layouts", "wide", "placements", "app:branch"),
    ("layouts", "compact", "placements", "app:branch"),
])
def test_home_canvas_v1_requires_complete_snapshots(home_canvas, path):
    from routers.schema.profile import UpdateUiPrefs
    target = home_canvas
    for key in path[:-1]:
        target = target[key]
    del target[path[-1]]
    with pytest.raises(ValidationError):
        UpdateUiPrefs(home_canvas=home_canvas)


@pytest.mark.parametrize("widget,minimum_width", [
    ("widget:scrum", 2), ("widget:mytasks", 4), ("widget:recent", 4),
    ("widget:starred", 4), ("widget:sprints", 2), ("widget:messages", 2),
])
def test_home_canvas_v1_enforces_each_widget_minimum(home_canvas, widget, minimum_width):
    from routers.schema.profile import UpdateUiPrefs
    home_canvas["items"] = [widget]
    for base in home_canvas["layouts"].values():
        base["placements"] = {widget: {"x": 0, "y": 0, "w": minimum_width, "h": 2}}
    assert UpdateUiPrefs(home_canvas=home_canvas).model_dump(exclude_none=True) == {
        "home_canvas": home_canvas,
    }
    home_canvas["layouts"]["compact"]["placements"][widget]["w"] = minimum_width - 1
    with pytest.raises(ValidationError):
        UpdateUiPrefs(home_canvas=home_canvas)


def test_home_canvas_v1_keeps_safe_integer_edges(home_canvas):
    from routers.schema.profile import UpdateUiPrefs
    home_canvas["layouts"]["wide"] = {"columns": 9007199254740991, "placements": {
        "widget:recent": {"x": 0, "y": 0, "w": 17, "h": 64},
        "app:branch": {"x": 9007199254740990, "y": 9007199254740990, "w": 1, "h": 1},
    }}
    assert UpdateUiPrefs(home_canvas=home_canvas).model_dump(exclude_none=True) == {
        "home_canvas": home_canvas,
    }
    home_canvas["layouts"]["wide"]["placements"]["app:branch"]["x"] += 1
    with pytest.raises(ValidationError):
        UpdateUiPrefs(home_canvas=home_canvas)


async def _make_user(db, email):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": "u"})
    return row.scalar_one()


async def test_ui_prefs_roundtrip_and_namespace_merge(db_session, home_canvas):
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

    from routers.schema.profile import UpdateUiPrefs
    patch = UpdateUiPrefs(home_canvas=home_canvas).model_dump(exclude_none=True)
    await user_model.update_ui_prefs(uid, patch, db_session)
    positioned = await user_model.get_ui_prefs(uid, db_session)
    assert positioned == {**resized, "home_canvas": home_canvas}

    await user_model.update_ui_prefs(uid, {"comment_sort": "oldest"}, db_session)
    merged = await user_model.get_ui_prefs(uid, db_session)
    assert merged == {**positioned, "comment_sort": "oldest"}

    empty = deepcopy(home_canvas)
    empty["items"] = []
    for base in empty["layouts"].values():
        base["placements"] = {}
    await user_model.update_ui_prefs(
        uid, UpdateUiPrefs(home_canvas=empty).model_dump(exclude_none=True), db_session,
    )
    assert await user_model.get_ui_prefs(uid, db_session) == {**merged, "home_canvas": empty}


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
