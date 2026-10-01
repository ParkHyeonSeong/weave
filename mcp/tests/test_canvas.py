from fastmcp import Client

from weave_mcp import _app


async def test_list_canvases(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("list_canvases", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/canvases")


async def test_get_canvas_home_stats(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_canvas_home_stats", {})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/canvases/home-stats")


async def test_get_canvas_page_tree(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_canvas_page_tree", {"canvas_id": 1})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/canvases/1/pages")


async def test_get_canvas_page(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_canvas_page", {"canvas_id": 1, "page_id": 2})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/canvases/1/pages/2", params={})


async def test_create_canvas_page(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("create_canvas_page", {"canvas_id": 1, "title": "Doc"})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/canvases/1/pages", json={"title": "Doc"}
    )


async def test_update_canvas_page(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_canvas_page",
            {"canvas_id": 1, "page_id": 2, "title": "New Title"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/canvases/1/pages/2", json={"title": "New Title"}
    )


async def test_update_canvas_page_content_never_sends_editor_origin(fake_client):
    # origin='editor'는 웹 공동편집기의 자기 저장 표지다 — 에이전트 쓰기는 편집 중 거절·공동편집 상태 초기화 규칙을 따른다
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("update_canvas_page", {"canvas_id": 1, "page_id": 2, "content": "# AI"})
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/canvases/1/pages/2", json={"content": "# AI"}
    )


async def test_update_canvas_page_documents_being_edited_rejection():
    # 편집 중인 페이지에 content를 쓰면 PAGE_BEING_EDITED로 거절된다는 것을 에이전트가 도구 설명에서 알 수 있어야 한다
    async with Client(_app.mcp) as client:
        tools = {t.name: t for t in await client.list_tools()}
    description = tools["update_canvas_page"].description or ""
    assert "PAGE_BEING_EDITED" in description
    assert "nothing is changed" in description


async def test_create_canvas_page_with_type(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_canvas_page",
            {"canvas_id": 1, "title": "Specs", "type": "folder"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/canvases/1/pages", json={"title": "Specs", "type": "folder"}
    )


async def test_create_canvas(fake_client):
    fake_client.call_json.return_value = {"status": True, "canvas_id": 9}
    async with Client(_app.mcp) as client:
        await client.call_tool("create_canvas", {"canvas_name": "Docs", "key": "DOC"})
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/canvases",
        json={"canvas_name": "Docs", "key": "DOC", "visibility": "private"},
    )


async def test_get_canvas(fake_client):
    fake_client.call_json.return_value = {"canvas_id": 1}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_canvas", {"canvas_id": 1})
    fake_client.call_json.assert_awaited_once_with("GET", "/api/canvases/1")


async def test_update_canvas(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_canvas", {"canvas_id": 1, "canvas_name": "Renamed"}
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/canvases/1", json={"canvas_name": "Renamed"}
    )


async def test_delete_canvas(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("delete_canvas", {"canvas_id": 1})
    fake_client.call_json.assert_awaited_once_with("DELETE", "/api/canvases/1")


async def test_move_canvas_page_to_parent(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "move_canvas_page",
            {"canvas_id": 1, "page_id": 2, "position": 0, "parent_page_id": 5},
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/canvases/1/pages/2/move",
        json={"position": 0, "parent_page_id": 5},
    )


async def test_move_canvas_page_to_top(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "move_canvas_page", {"canvas_id": 1, "page_id": 2, "position": 3}
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/canvases/1/pages/2/move", json={"position": 3}
    )


async def test_delete_canvas_page(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("delete_canvas_page", {"canvas_id": 1, "page_id": 2})
    fake_client.call_json.assert_awaited_once_with("DELETE", "/api/canvases/1/pages/2")


async def test_list_canvas_annotations_with_status(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "list_canvas_annotations",
            {"canvas_id": 1, "page_id": 2, "status": "open"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/canvases/1/pages/2/annotations", params={"status": "open"}
    )


async def test_create_canvas_annotation(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "create_canvas_annotation",
            {"canvas_id": 1, "page_id": 2, "quoted_text": "foo", "content": "<p>hi</p>"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/canvases/1/pages/2/annotations",
        json={"quoted_text": "foo", "content": "<p>hi</p>"},
    )


async def test_update_canvas_annotation(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "update_canvas_annotation",
            {"canvas_id": 1, "page_id": 2, "annotation_id": 7, "status": "resolved"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "PATCH", "/api/canvases/1/pages/2/annotations/7", json={"status": "resolved"}
    )


async def test_add_canvas_annotation_reply(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool(
            "add_canvas_annotation_reply",
            {"canvas_id": 1, "page_id": 2, "annotation_id": 7, "content": "<p>ok</p>"},
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/canvases/1/pages/2/annotations/7/replies",
        json={"content": "<p>ok</p>"},
    )
