"""Images in Weave content — see an embedded image.

Content tools return an image only as its address (/api/uploads/...), and opening that
address needs the token, which never leaves this server. get_image fetches it with the
token.
"""
import re
from typing import Any
from urllib.parse import urlsplit

from fastmcp.utilities.types import Image

from .. import errors as E
from .._app import mcp, get_client
from ..config import get_settings

# backend/routers/uploads.py serves /api/uploads/{subdir}/{filename}. A segment may not
# start with "." so "." / ".." can't climb out of /api/uploads on the server.
_SEGMENT = r"[A-Za-z0-9_-][A-Za-z0-9._-]*"
_UPLOAD_PATH = re.compile(rf"^/api/uploads/{_SEGMENT}/{_SEGMENT}$")

# Same signatures as backend/library/file_validator.py.
_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpeg"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
)

def _upload_path(url: str) -> str | None:
    """The /api/uploads/... path of an image address, or None if it isn't one on this
    Weave server. httpx sends the token to whatever host an absolute URL names, so an
    address on any other host must never reach the client."""
    url = (url or "").strip()
    if not url.startswith("/"):
        try:
            parts, base = urlsplit(url), urlsplit(get_settings().base_url)
        except ValueError:  # e.g. an unclosed IPv6 bracket
            return None
        if (parts.scheme, parts.netloc) != (base.scheme, base.netloc) or parts.query or parts.fragment:
            return None
        url = parts.path
    return url if _UPLOAD_PATH.match(url) else None


def _image_format(data: bytes) -> str | None:
    for signature, fmt in _SIGNATURES:
        if data.startswith(signature):
            return fmt
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


@mcp.tool
async def get_image(url: str) -> Any:
    """See an image embedded in Weave content.

    Content from get_canvas_page, get_task, list_task_comments, get_task_issue,
    list_canvas_annotations and list_track_items shows an image only as its address:
    <img src="/api/uploads/..."> in HTML or ![alt](/api/uploads/...) in markdown. Opening
    that address needs your Weave login, so pass it here to get the image itself.

    url is the address exactly as it appears in the content (a full URL on this Weave
    server also works). Only Weave upload addresses are accepted; images hosted on other
    sites are not fetched here. You can see an image only if you're a member of the branch
    or canvas it was uploaded to (otherwise category="not_found"). PNG, JPEG, GIF and WebP
    come back as images; anything else fails with UNSUPPORTED_IMAGE_TYPE.
    """
    path = _upload_path(url)
    if path is None:
        return E.make_error(
            "validation", code=E.INVALID_IMAGE_URL,
            message="not a Weave image address — pass the /api/uploads/... src from the content",
        )
    resp = await get_client().call_bytes("GET", path)
    if isinstance(resp, dict):
        return resp
    fmt = _image_format(resp.content)
    if fmt is None:
        return E.make_error(
            "validation", code=E.UNSUPPORTED_IMAGE_TYPE,
            message="only PNG, JPEG, GIF and WebP images can be shown",
        )
    return Image(data=resp.content, format=fmt)
