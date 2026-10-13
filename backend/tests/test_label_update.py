"""라벨 이름·색 수정(PATCH /branches/{id}/labels/{label_id}) — 중복 이름 응답과 수정 범위.

예전 동작: 같은 브랜치의 다른 라벨과 같은 이름으로 바꾸면 UNIQUE(branch_id, label_name) 위반이
잡히지 않아 500이었다. 이제 savepoint 안에서 수정해 LABEL_ALREADY_EXISTS(conflict)로 돌려주고,
요청 트랜잭션은 살려 둔다. 수정은 label_id를 유지하므로 태스크 연결(task_label)이 그대로다.
보낸 필드만 바뀐다는 기존 동작(이름만·색만·둘 다)도 함께 고정한다.

입력 검증(공백·길이·HEX)은 편집 화면이 서버·DB와 같은 규칙으로 막고 바뀐 필드만 보낸다.
API 자체의 검증 강화는 MCP update_label 동작을 바꾸므로 이 변경에 넣지 않는다.

Style: 컨트롤러 직접 호출 + raw INSERT 시딩 + 롤백 격리 db_session(test_controller_task_subresource_label.py 패턴).
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import label as label_ctrl
from routers.schema.label import LabelUpdate


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name, key):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_label(db, branch_id, name, color="#0D9488"):
    row = await db.execute(text("""
        INSERT INTO label (branch_id, label_name, color) VALUES (:b, :n, :c) RETURNING label_id
    """), {"b": branch_id, "n": name, "c": color})
    return row.scalar_one()


async def _make_task(db, branch_id, created_by, title="T"):
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, 1, :t, 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "t": title, "u": created_by})
    return res.scalar_one()


async def _label(db, label_id):
    row = await db.execute(text("SELECT label_name, color FROM label WHERE label_id = :l"), {"l": label_id})
    return dict(row.one()._mapping)


async def _seed(db, tag):
    owner = await _make_user(db, f"lbl_up_{tag}@t.test", f"lbl_up_{tag}")
    branch = await _make_branch(db, owner, f"LblUp{tag}", f"LU{tag}")
    await _add_member(db, branch, owner, "admin")
    ux = await _make_label(db, branch, "UX 개선", "#0D9488")
    fe = await _make_label(db, branch, "Frontend", "#5E6AD2")
    return owner, branch, ux, fe


async def test_duplicate_name_in_branch_returns_label_already_exists(db_session):
    owner, branch, ux, fe = await _seed(db_session, "1")

    res = await label_ctrl.update(ux, LabelUpdate(label_name="Frontend"), branch, _req(owner), db_session)

    assert res["status"] is False
    assert res["code"] == "LABEL_ALREADY_EXISTS"
    assert res["category"] == "conflict"
    # savepoint가 위반을 가뒀다 — 바깥 트랜잭션이 살아 있어 이어지는 조회가 되고, 두 라벨 모두 그대로다
    assert await _label(db_session, ux) == {"label_name": "UX 개선", "color": "#0D9488"}
    assert await _label(db_session, fe) == {"label_name": "Frontend", "color": "#5E6AD2"}


async def test_rename_only_keeps_color_and_task_link(db_session):
    owner, branch, ux, _ = await _seed(db_session, "2")
    task = await _make_task(db_session, branch, owner)
    await db_session.execute(text("INSERT INTO task_label (task_id, label_id) VALUES (:t, :l)"), {"t": task, "l": ux})

    res = await label_ctrl.update(ux, LabelUpdate(label_name="사용성 개선"), branch, _req(owner), db_session)

    assert res == {"status": True}
    assert await _label(db_session, ux) == {"label_name": "사용성 개선", "color": "#0D9488"}
    linked = await db_session.execute(text("SELECT label_id FROM task_label WHERE task_id = :t"), {"t": task})
    assert [r[0] for r in linked] == [ux]   # 같은 label_id — 연결 그대로


async def test_color_only_keeps_name(db_session):
    owner, branch, ux, _ = await _seed(db_session, "3")
    res = await label_ctrl.update(ux, LabelUpdate(color="#2563EB"), branch, _req(owner), db_session)
    assert res == {"status": True}
    assert await _label(db_session, ux) == {"label_name": "UX 개선", "color": "#2563EB"}


async def test_rename_and_recolor_together(db_session):
    owner, branch, ux, _ = await _seed(db_session, "4")
    res = await label_ctrl.update(ux, LabelUpdate(label_name="사용성", color="#DC2626"), branch, _req(owner), db_session)
    assert res == {"status": True}
    assert await _label(db_session, ux) == {"label_name": "사용성", "color": "#DC2626"}


async def test_duplicate_check_is_case_sensitive_and_branch_scoped(db_session):
    owner, branch, ux, _ = await _seed(db_session, "5")
    _, other_branch, _, _ = await _seed(db_session, "6")
    await _make_label(db_session, other_branch, "사용성 개선")

    # 대소문자만 다르면 다른 이름이다(DB UNIQUE와 같다)
    assert (await label_ctrl.update(ux, LabelUpdate(label_name="frontend"), branch, _req(owner), db_session))["status"] is True
    # 다른 브랜치에 같은 이름이 있어도 된다
    assert (await label_ctrl.update(ux, LabelUpdate(label_name="사용성 개선"), branch, _req(owner), db_session))["status"] is True
