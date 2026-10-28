"""Images in Weave content — see an embedded image, or upload one to embed.

Content tools return an image only as its address (/api/uploads/...), and opening that
address needs the token, which never leaves this server. get_image fetches it with the
token; the upload tools post a local file to the backend's own upload endpoints.
"""
import os
import re
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastmcp.utilities.types import Image

from .. import errors as E
from .._app import mcp, get_client, BranchRef
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

# backend canvas_upload.py / task_upload.py MAX_FILE_SIZE
_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
# A 10MB file can outlast the client's default 10s write timeout on a slow link.
_UPLOAD_TIMEOUT = httpx.Timeout(connect=5.0, read=60.0, write=60.0, pool=5.0)


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


async def _upload(endpoint: str, file_path: str) -> Any:
    path = os.path.expanduser((file_path or "").strip())
    if not os.path.isabs(path) or not os.path.isfile(path):
        return E.make_error(
            "not_found", code=E.LOCAL_FILE_NOT_FOUND,
            message=f"no file at {file_path!r} — pass the absolute path of an image file on this computer",
        )
    try:
        with open(path, "rb") as f:
            data = f.read(_UPLOAD_MAX_BYTES + 1)
    except OSError as exc:
        return E.make_error(
            "not_found", code=E.LOCAL_FILE_NOT_FOUND,
            message=f"can't read {file_path!r}: {exc.strerror or exc}",
        )
    if len(data) > _UPLOAD_MAX_BYTES:
        return E.make_error(
            "validation", code=E.LOCAL_FILE_TOO_LARGE,
            message="images can be at most 10MB",
        )
    # A file whose header has no PNG/JPEG/GIF/WebP signature is refused before anything is
    # sent (the server rejects it too, but only after the whole upload). This checks the
    # header only; it doesn't decode the image.
    fmt = _image_format(data)
    if fmt is None:
        return E.make_error(
            "validation", code=E.UNSUPPORTED_IMAGE_TYPE,
            message="only PNG, JPEG, GIF and WebP files can be uploaded",
        )
    return await get_client().call_json(
        "POST", endpoint, files={"file": (os.path.basename(path), data, f"image/{fmt}")},
        timeout=_UPLOAD_TIMEOUT,
    )


@mcp.tool
async def upload_canvas_image(canvas_id: int, file_path: str) -> Any:
    """Upload an image file from this computer to use in this canvas's document pages or annotations.

    file_path is the absolute path of a PNG, JPEG, GIF or WebP file (max 10MB). Returns
    {"status": true, "url": "/api/uploads/canvas/..."}. Then put the image in content:
    ![short description](url) in the markdown for create_canvas_page / update_canvas_page,
    or <img src="url" alt="short description"> in the HTML for create_canvas_annotation /
    add_canvas_annotation_reply. Only members of this canvas can see it, so for task,
    comment or issue content use upload_branch_image instead.
    """
    return await _upload(f"/api/canvases/{canvas_id}/pages/upload-image", file_path)


@mcp.tool
async def upload_branch_image(branch_id: BranchRef, file_path: str) -> Any:
    """Upload an image file from this computer to use in this branch's tasks, comments and issues.

    file_path is the absolute path of a PNG, JPEG, GIF or WebP file (max 10MB). Returns
    {"status": true, "url": "/api/uploads/task/..."}. Then put ![short description](url) in
    the markdown for create_task / update_task (description), add_task_comment /
    update_task_comment, create_task_issue / update_task_issue (body), add_issue_comment /
    update_issue_comment, or close_task_issue / reopen_task_issue (comment). Only members
    of this branch can see it, so for canvas pages use upload_canvas_image instead.
    """
    return await _upload(f"/api/branches/{branch_id}/tasks/upload-image", file_path)
