"""MCP 읽기 4도구 format 파라미터 전달 + 쓰기 도구 md ingress docstring 계약."""
from fastmcp import Client

from weave_mcp import _app


async def test_get_task_format_markdown(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_task", {"branch_id": 3, "task_id": 5, "format": "markdown"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/3/tasks/5", params={"format": "markdown"})


async def test_get_task_default_omits_format(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_task", {"branch_id": 3, "task_id": 5})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/3/tasks/5", params={})


async def test_list_task_comments_format_merges_with_order(fake_client):
    fake_client.call_json.return_value = []
    async with Client(_app.mcp) as client:
        await client.call_tool("list_task_comments",
                               {"branch_id": 3, "task_id": 5, "format": "markdown"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/3/tasks/5/comments",
        params={"order": "asc", "format": "markdown"})


async def test_get_task_issue_format(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_task_issue",
                               {"branch_id": 1, "task_id": 2, "issue_id": 3, "format": "markdown"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/branches/1/tasks/2/issues/3", params={"format": "markdown"})


async def test_get_canvas_page_format(fake_client):
    fake_client.call_json.return_value = {"status": True}
    async with Client(_app.mcp) as client:
        await client.call_tool("get_canvas_page",
                               {"canvas_id": 1, "page_id": 2, "format": "markdown"})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/canvases/1/pages/2", params={"format": "markdown"})


async def test_docstring_contract():
    async with Client(_app.mcp) as client:
        tools = {t.name: t for t in await client.list_tools()}
    # 쓰기 도구: md-or-HTML ingress 계약 명문화
    writers = ["create_task", "update_task", "add_task_comment", "update_task_comment",
               "create_task_issue", "update_task_issue", "add_issue_comment",
               "update_issue_comment", "close_task_issue", "reopen_task_issue",
               "create_canvas_page", "update_canvas_page"]
    for name in writers:
        assert "treated as markdown" in (tools[name].description or ""), name
        # Weave 링크 → ref 칩 저장 (설계 2026-10-22 ref-link-chip-ingress §5.6)
        assert "become live chips" in (tools[name].description or ""), name
    # 길이 한도가 있는 쓰기(태스크 설명 제외): A안 — 길어지면 본문 전체를 일반 링크로
    for name in writers:
        if name in ("create_task", "update_task"):
            continue
        assert "kept as plain links" in (tools[name].description or ""), name
    # 읽기 도구: format 파라미터 문서화
    for name in ["get_task", "list_task_comments", "get_task_issue", "get_canvas_page"]:
        assert '"markdown"' in (tools[name].description or ""), name
