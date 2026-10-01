from typing import Any

from .._app import mcp, get_client, BranchRef
from .._format import format_params


@mcp.tool
async def list_canvas_members(canvas_id: int) -> Any:
    """List a canvas's members (user_id, name, role).

    Resolve a person's name to the user_id needed by the member-write tools.
    """
    return await get_client().call_json("GET", f"/api/canvases/{canvas_id}/members")


@mcp.tool
async def search_canvas_non_members(canvas_id: int, q: str = "") -> Any:
    """Search users who are NOT yet members of a canvas (candidates to invite).

    q matches name/email.
    """
    return await get_client().call_json(
        "GET", f"/api/canvases/{canvas_id}/members/search", params={"q": q}
    )


@mcp.tool
async def add_canvas_member(canvas_id: int, user_id: int, role: str = "member") -> Any:
    """Add (invite) a user to a canvas. role is "admin" or "member" (default).

    Resolve user_id via search_canvas_non_members(canvas_id). Admin-only.
    """
    return await get_client().call_json(
        "POST", f"/api/canvases/{canvas_id}/members",
        json={"user_id": user_id, "role": role},
    )


@mcp.tool
async def update_canvas_member_role(canvas_id: int, user_id: int, role: str) -> Any:
    """Change a canvas member's role. role is "admin" or "member". Admin-only."""
    return await get_client().call_json(
        "PATCH", f"/api/canvases/{canvas_id}/members/{user_id}", json={"role": role}
    )


@mcp.tool
async def remove_canvas_member(canvas_id: int, user_id: int) -> Any:
    """Remove a member from a canvas. Admin-only."""
    return await get_client().call_json(
        "DELETE", f"/api/canvases/{canvas_id}/members/{user_id}"
    )


@mcp.tool
async def list_canvases() -> Any:
    """List all canvases available to the current user.

    Each canvas includes page_count, last_edited_at and a preview of its
    contributors.
    """
    return await get_client().call_json("GET", "/api/canvases")


@mcp.tool
async def get_canvas_home_stats() -> Any:
    """Get Canvas home KPI aggregates across accessible canvases.

    Returns total_docs, edited_this_week and starred_count.
    """
    return await get_client().call_json("GET", "/api/canvases/home-stats")


@mcp.tool
async def create_canvas(
    canvas_name: str,
    key: str,
    description: str | None = None,
    visibility: str = "private",
    branch_id: BranchRef | None = None,
) -> Any:
    """Create a new canvas (docs workspace).

    key is REQUIRED: 2-10 uppercase letters/numbers starting with a letter
    (uppercased server-side; duplicate keys are rejected). visibility is "private"
    (default) or "public". branch_id optionally ties the canvas to a branch (you
    must be a member of it). An intro overview page is created automatically.
    """
    body = {"canvas_name": canvas_name, "key": key, "visibility": visibility}
    body.update({
        k: v for k, v in {"description": description, "branch_id": branch_id}.items()
        if v is not None
    })
    return await get_client().call_json("POST", "/api/canvases", json=body)


@mcp.tool
async def get_canvas(canvas_id: int) -> Any:
    """Get a single canvas's metadata/detail."""
    return await get_client().call_json("GET", f"/api/canvases/{canvas_id}")


@mcp.tool
async def update_canvas(
    canvas_id: int,
    canvas_name: str | None = None,
    key: str | None = None,
    description: str | None = None,
    visibility: str | None = None,
    color: str | None = None,
    icon: str | None = None,
) -> Any:
    """Update canvas metadata; only provided fields change.

    key (if set) must be 2-10 uppercase alnum starting with a letter; visibility is
    "public"/"private"; color is #RRGGBB hex; icon is a "lucide:"/"emoji:"/"image:"
    prefixed string or a bare lucide name.
    """
    body = {k: v for k, v in {
        "canvas_name": canvas_name,
        "key": key,
        "description": description,
        "visibility": visibility,
        "color": color,
        "icon": icon,
    }.items() if v is not None}
    return await get_client().call_json("PATCH", f"/api/canvases/{canvas_id}", json=body)


@mcp.tool
async def delete_canvas(canvas_id: int) -> Any:
    """Archive (soft-delete) a canvas. Reversible via restore_canvas. Admin-only."""
    return await get_client().call_json("DELETE", f"/api/canvases/{canvas_id}")


@mcp.tool
async def restore_canvas(canvas_id: int) -> Any:
    """Restore an archived canvas (see list_archived_canvases). Admin-only."""
    return await get_client().call_json("POST", f"/api/canvases/{canvas_id}/restore")


@mcp.tool
async def leave_canvas(canvas_id: int) -> Any:
    """Leave a canvas (remove yourself as a member); any member may leave.

    May return a category=business rejection (e.g. LAST_ADMIN / LAST_OWNER) if you are the canvas's last admin.
    """
    return await get_client().call_json("POST", f"/api/canvases/{canvas_id}/leave")


@mcp.tool
async def join_canvas(canvas_id: int) -> Any:
    """Join a public canvas as a member (discover candidates via list_public_canvases)."""
    return await get_client().call_json("POST", f"/api/canvases/{canvas_id}/join")


@mcp.tool
async def list_archived_canvases() -> Any:
    """List your archived canvases (candidates for restore_canvas)."""
    return await get_client().call_json("GET", "/api/canvases/archived")


@mcp.tool
async def list_public_canvases() -> Any:
    """List public canvases you can discover and join (see join_canvas)."""
    return await get_client().call_json("GET", "/api/canvases/public")


@mcp.tool
async def get_canvas_page_tree(canvas_id: int) -> Any:
    """Get the full page tree (hierarchy) for a canvas."""
    return await get_client().call_json(
        "GET", f"/api/canvases/{canvas_id}/pages"
    )


@mcp.tool
async def get_canvas_page(canvas_id: int, page_id: int, format: str = "html") -> Any:
    """Get a single canvas page including its content.

    format: "html" (default) or "markdown" — the page content is returned
    converted to that format.
    """
    return await get_client().call_json(
        "GET", f"/api/canvases/{canvas_id}/pages/{page_id}", params=format_params(format)
    )


@mcp.tool
async def create_canvas_page(
    canvas_id: int,
    title: str,
    content: str | None = None,
    parent_page_id: int | None = None,
    type: str | None = None,
) -> Any:
    """Create a new page in a canvas.

    Only title is required. content sets the initial page body (max 300k chars);
    accepts markdown or HTML, and strings without HTML tags are treated as markdown.
    parent_page_id nests the new page under an existing page. type is one of
    "document" (default), "folder", or "typst".
    """
    body = {"title": title}
    body.update({
        k: v for k, v in {
            "content": content,
            "parent_page_id": parent_page_id,
            "type": type,
        }.items() if v is not None
    })
    return await get_client().call_json(
        "POST", f"/api/canvases/{canvas_id}/pages", json=body
    )


@mcp.tool
async def update_canvas_page(
    canvas_id: int,
    page_id: int,
    title: str | None = None,
    content: str | None = None,
    wide_mode: bool | None = None,
) -> Any:
    """Update a canvas page's title, content, or wide_mode layout.

    WARNING: providing `content` replaces the entire page body (max 300k chars) —
    partial updates are not supported; pass the full desired content. content accepts
    markdown or HTML; strings without HTML tags are treated as markdown. To change a
    page's parent or order use move_canvas_page instead.

    While someone has the page open in the web editor, a `content` update is rejected
    with code PAGE_BEING_EDITED (category "conflict") and nothing is changed — not even
    a title/wide_mode passed in the same call. Retry after they close the editor, or tell
    the user. Updates without `content` are never blocked. When nobody is editing, the
    next editor session starts from the content you wrote.
    """
    body = {k: v for k, v in {
        "title": title,
        "content": content,
        "wide_mode": wide_mode,
    }.items() if v is not None}
    return await get_client().call_json(
        "PATCH", f"/api/canvases/{canvas_id}/pages/{page_id}", json=body
    )


@mcp.tool
async def move_canvas_page(
    canvas_id: int,
    page_id: int,
    position: int,
    parent_page_id: int | None = None,
) -> Any:
    """Move/reorder a page in the canvas tree.

    position (REQUIRED integer) is the order index within the new parent.
    parent_page_id is the new parent; omit it to move the page to the top level.
    This is the only way to change a page's parent (update_canvas_page cannot).
    """
    body = {"position": position}
    body.update({
        k: v for k, v in {"parent_page_id": parent_page_id}.items() if v is not None
    })
    return await get_client().call_json(
        "PATCH", f"/api/canvases/{canvas_id}/pages/{page_id}/move", json=body
    )


@mcp.tool
async def delete_canvas_page(canvas_id: int, page_id: int) -> Any:
    """Delete a page from a canvas. There is no per-page restore, so use with care."""
    return await get_client().call_json(
        "DELETE", f"/api/canvases/{canvas_id}/pages/{page_id}"
    )


@mcp.tool
async def list_canvas_annotations(
    canvas_id: int,
    page_id: int,
    status: str | None = None,
) -> Any:
    """List annotation threads (inline comments anchored to text) on a canvas page.

    status optionally filters by "open" or "resolved".
    """
    params = {k: v for k, v in {"status": status}.items() if v is not None}
    return await get_client().call_json(
        "GET",
        f"/api/canvases/{canvas_id}/pages/{page_id}/annotations",
        params=params,
    )


@mcp.tool
async def create_canvas_annotation(
    canvas_id: int,
    page_id: int,
    quoted_text: str,
    content: str,
    prefix_context: str | None = None,
    suffix_context: str | None = None,
    anchor_node_path: str | None = None,
    anchor_offset: int | None = None,
    anchor_length: int | None = None,
) -> Any:
    """Create an inline comment thread anchored to quoted text on a page.

    quoted_text (the highlighted text, max 2000 chars) and content (the first
    comment, non-empty HTML, max 10000 chars) are required. The anchor_* fields
    pin the highlight to an exact location when known.
    """
    body = {"quoted_text": quoted_text, "content": content}
    body.update({k: v for k, v in {
        "prefix_context": prefix_context,
        "suffix_context": suffix_context,
        "anchor_node_path": anchor_node_path,
        "anchor_offset": anchor_offset,
        "anchor_length": anchor_length,
    }.items() if v is not None})
    return await get_client().call_json(
        "POST",
        f"/api/canvases/{canvas_id}/pages/{page_id}/annotations",
        json=body,
    )


@mcp.tool
async def update_canvas_annotation(
    canvas_id: int,
    page_id: int,
    annotation_id: int,
    status: str,
) -> Any:
    """Resolve or reopen an annotation thread. status must be "open" or "resolved"."""
    return await get_client().call_json(
        "PATCH",
        f"/api/canvases/{canvas_id}/pages/{page_id}/annotations/{annotation_id}",
        json={"status": status},
    )


@mcp.tool
async def add_canvas_annotation_reply(
    canvas_id: int,
    page_id: int,
    annotation_id: int,
    content: str,
) -> Any:
    """Add a reply to an annotation thread. content is non-empty HTML (max 10000 chars)."""
    return await get_client().call_json(
        "POST",
        f"/api/canvases/{canvas_id}/pages/{page_id}/annotations/{annotation_id}/replies",
        json={"content": content},
    )
