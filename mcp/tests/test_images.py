import base64

import httpx
import pytest
from fastmcp import Client

from weave_mcp import _app, errors as E

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
