import base64
import os

import httpx
import pytest
from fastmcp import Client

from weave_mcp import _app, errors as E
from weave_mcp.tools.images import _UPLOAD_TIMEOUT

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 16
GIF = b"GIF89a" + b"\x00" * 16
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 8
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'


async def _call(name, args):
    async with Client(_app.mcp) as client:
        return await client.call_tool(name, args)


# --- get_image --------------------------------------------------------------------

@pytest.mark.parametrize("data, mime", [
    (PNG, "image/png"), (JPEG, "image/jpeg"), (GIF, "image/gif"), (WEBP, "image/webp"),
])
async def test_get_image_returns_the_image(fake_client, data, mime):
    fake_client.call_bytes.return_value = httpx.Response(200, content=data)
    result = await _call("get_image", {"url": "/api/uploads/canvas/c3_900f0f857cfa.png"})
    fake_client.call_bytes.assert_awaited_once_with("GET", "/api/uploads/canvas/c3_900f0f857cfa.png")
    [item] = result.content
    assert item.type == "image" and item.mimeType == mime
    assert base64.b64decode(item.data) == data


async def test_get_image_accepts_a_full_url_on_this_server(fake_client, monkeypatch):
    monkeypatch.setenv("WEAVE_BASE_URL", "https://weave.test")
    fake_client.call_bytes.return_value = httpx.Response(200, content=PNG)
    await _call("get_image", {"url": "https://weave.test/api/uploads/task/t5_abc.png"})
    fake_client.call_bytes.assert_awaited_once_with("GET", "/api/uploads/task/t5_abc.png")


@pytest.mark.parametrize("url", [
    "https://evil.test/api/uploads/task/t5_abc.png",          # another host would get the token
    "https://weave.test.evil.test/api/uploads/task/t5_abc.png",
    "http://weave.test/api/uploads/task/t5_abc.png",          # same host, other scheme
    "//evil.test/api/uploads/task/t5_abc.png",
    "/api/uploads/task/t5_abc.png?x=1",
    "/api/uploads/../branches",
    "/api/uploads/task/..",
    "/api/uploads/t5_abc.png",
    "/api/branches/5",
    "uploads/task/t5_abc.png",
    "http://[abc/api/uploads/task/t5_abc.png",                # urlsplit raises ValueError
    "",
])
async def test_get_image_rejects_anything_but_a_weave_upload_address(fake_client, monkeypatch, url):
    monkeypatch.setenv("WEAVE_BASE_URL", "https://weave.test")
    result = await _call("get_image", {"url": url})
    fake_client.call_bytes.assert_not_awaited()
    assert result.structured_content["error"]["code"] == E.INVALID_IMAGE_URL
    assert result.structured_content["error"]["category"] == "validation"


async def test_get_image_passes_server_errors_through(fake_client):
    # a non-member gets 404 from the uploads route, same as a missing file
    fake_client.call_bytes.return_value = E.make_error("not_found", http_status=404)
    result = await _call("get_image", {"url": "/api/uploads/canvas/c9_x.png"})
    assert result.structured_content["error"]["category"] == "not_found"


async def test_get_image_rejects_non_images(fake_client):
    fake_client.call_bytes.return_value = httpx.Response(200, content=SVG)
    result = await _call("get_image", {"url": "/api/uploads/branch-icons/1_ab.svg"})
    assert result.structured_content["error"]["code"] == E.UNSUPPORTED_IMAGE_TYPE
    assert result.structured_content["error"]["category"] == "validation"


# --- upload_canvas_image / upload_branch_image -------------------------------------

@pytest.mark.parametrize("tool, args, endpoint", [
    ("upload_canvas_image", {"canvas_id": 3}, "/api/canvases/3/pages/upload-image"),
    ("upload_branch_image", {"branch_id": 5}, "/api/branches/5/tasks/upload-image"),
])
async def test_upload_posts_the_file(fake_client, tmp_path, tool, args, endpoint):
    shot = tmp_path / "shot.png"
    shot.write_bytes(PNG)
    fake_client.call_json.return_value = {"status": True, "url": "/api/uploads/x/y.png"}
    result = await _call(tool, {**args, "file_path": str(shot)})
    fake_client.call_json.assert_awaited_once_with(
        "POST", endpoint, files={"file": ("shot.png", PNG, "image/png")}, timeout=_UPLOAD_TIMEOUT,
    )
    assert result.structured_content == {"status": True, "url": "/api/uploads/x/y.png"}


async def test_upload_expands_home(fake_client, tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / "a.jpg").write_bytes(JPEG)
    fake_client.call_json.return_value = {"status": True, "url": "/api/uploads/canvas/c3_a.jpg"}
    await _call("upload_canvas_image", {"canvas_id": 3, "file_path": "~/a.jpg"})
    assert fake_client.call_json.await_args.kwargs["files"] == {"file": ("a.jpg", JPEG, "image/jpeg")}


async def test_upload_needs_an_existing_absolute_file(fake_client, tmp_path, monkeypatch):
    (tmp_path / "shot.png").write_bytes(PNG)
    monkeypatch.chdir(tmp_path)  # the relative path below exists — only "not absolute" rejects it
    for bad in ("shot.png", str(tmp_path / "missing.png"), str(tmp_path)):
        result = await _call("upload_canvas_image", {"canvas_id": 3, "file_path": bad})
        assert result.structured_content["error"]["code"] == E.LOCAL_FILE_NOT_FOUND, bad
        assert result.structured_content["error"]["category"] == "not_found"
    fake_client.call_json.assert_not_awaited()


async def test_upload_refuses_files_over_10mb_without_sending_them(fake_client, tmp_path):
    big = tmp_path / "big.png"
    with open(big, "wb") as f:
        f.truncate(10 * 1024 * 1024 + 1)
    result = await _call("upload_branch_image", {"branch_id": 5, "file_path": str(big)})
    fake_client.call_json.assert_not_awaited()
    assert result.structured_content["error"]["code"] == E.LOCAL_FILE_TOO_LARGE
    assert result.structured_content["error"]["category"] == "validation"


async def test_upload_refuses_non_images_without_sending_them(fake_client, tmp_path):
    secret = tmp_path / "credentials.png"
    secret.write_bytes(b"[default]\naws_secret_access_key = x\n")
    result = await _call("upload_canvas_image", {"canvas_id": 3, "file_path": str(secret)})
    fake_client.call_json.assert_not_awaited()
    assert result.structured_content["error"]["code"] == E.UNSUPPORTED_IMAGE_TYPE
    assert result.structured_content["error"]["category"] == "validation"


async def test_upload_passes_backend_rejections_through(fake_client, tmp_path):
    misnamed = tmp_path / "shot.jpg"  # PNG bytes under a .jpg name — the server checks they match
    misnamed.write_bytes(PNG)
    fake_client.call_json.return_value = E.make_error("validation", code="INVALID_FILE_CONTENT")
    result = await _call("upload_canvas_image", {"canvas_id": 3, "file_path": str(misnamed)})
    assert fake_client.call_json.await_args.kwargs["files"] == {"file": ("shot.jpg", PNG, "image/png")}
    assert result.structured_content["error"]["code"] == "INVALID_FILE_CONTENT"


async def test_upload_branch_image_accepts_a_branch_key(fake_client, tmp_path):
    shot = tmp_path / "shot.png"
    shot.write_bytes(PNG)
    fake_client.call_json.side_effect = [
        {"status": True, "branches": [{"branch_id": 7, "key": "WV", "branch_name": "Weave"}]},
        {"status": True, "url": "/api/uploads/task/t7_abc.png"},
    ]
    await _call("upload_branch_image", {"branch_id": "WV", "file_path": str(shot)})
    assert fake_client.call_json.await_args_list[1].args == ("POST", "/api/branches/7/tasks/upload-image")


async def test_upload_unreadable_file_is_an_error_not_a_crash(fake_client, tmp_path):
    locked = tmp_path / "locked.png"
    locked.write_bytes(PNG)
    locked.chmod(0)
    try:
        if os.access(locked, os.R_OK):
            pytest.skip("this user can read a mode-000 file (root)")
        result = await _call("upload_canvas_image", {"canvas_id": 3, "file_path": str(locked)})
    finally:
        locked.chmod(0o600)
    fake_client.call_json.assert_not_awaited()
    assert result.structured_content["error"]["code"] == E.LOCAL_FILE_NOT_FOUND
