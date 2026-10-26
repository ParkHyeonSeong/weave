from typing import Any

from .._app import mcp, get_client, BranchRef
from .._format import format_params


@mcp.tool
async def list_task_issues(branch_id: BranchRef, task_id: int) -> Any:
    """List all issues linked to a task."""
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks/{task_id}/issues"
    )


@mcp.tool
async def get_task_issue(branch_id: BranchRef, task_id: int, issue_id: int, format: str = "html") -> Any:
    """Get full details of a single issue linked to a task.

    format: "html" (default) or "markdown" — rich-text fields (issue body and
    comments) are returned converted to that format.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks/{task_id}/issues/{issue_id}",
        params=format_params(format)
    )


@mcp.tool
async def create_task_issue(
    branch_id: BranchRef,
    task_id: int,
    title: str,
    body: str | None = None,
) -> Any:
    """Create a new issue linked to a task. title is required; body is optional —
    markdown or HTML; strings without HTML tags are treated as markdown.
    Links to this Weave's tasks, issues and docs written as markdown links
    become live chips showing the real ID/title (the link text is ignored).
    If converting would make the content too long to re-save in the browser,
    all links are kept as plain links."""
    payload = {"title": title}
    payload.update({k: v for k, v in {"body": body}.items() if v is not None})
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/tasks/{task_id}/issues", json=payload
    )


@mcp.tool
async def update_task_issue(
    branch_id: BranchRef,
    task_id: int,
    issue_id: int,
    title: str | None = None,
    body: str | None = None,
    status: str | None = None,
) -> Any:
    """Update fields of an existing task issue. All parameters are optional. body is
    markdown or HTML; strings without HTML tags are treated as markdown.
    Links to this Weave's tasks, issues and docs written as markdown links
    become live chips showing the real ID/title (the link text is ignored).
    If converting would make the content too long to re-save in the browser,
    all links are kept as plain links."""
    payload = {k: v for k, v in {
        "title": title,
        "body": body,
        "status": status,
    }.items() if v is not None}
    return await get_client().call_json(
        "PATCH",
        f"/api/branches/{branch_id}/tasks/{task_id}/issues/{issue_id}",
        json=payload,
    )


@mcp.tool
async def delete_task_issue(branch_id: BranchRef, task_id: int, issue_id: int) -> Any:
    """Delete an issue linked to a task."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/tasks/{task_id}/issues/{issue_id}"
    )


@mcp.tool
async def add_issue_comment(
    branch_id: BranchRef, task_id: int, issue_id: int, content: str
) -> Any:
    """Add a comment to a task issue. content is non-empty markdown or HTML (max
    10000 chars); strings without HTML tags are treated as markdown.
    Links to this Weave's tasks, issues and docs written as markdown links
    become live chips showing the real ID/title (the link text is ignored).
    If converting would make the content too long to re-save in the browser,
    all links are kept as plain links.

    To read an issue's comments, use get_task_issue — they are embedded in the detail
    (there is no separate comment-list endpoint).
    """
    return await get_client().call_json(
        "POST",
        f"/api/branches/{branch_id}/tasks/{task_id}/issues/{issue_id}/comments",
        json={"content": content},
    )


@mcp.tool
async def update_issue_comment(
    branch_id: BranchRef, task_id: int, issue_id: int, comment_id: int, content: str
) -> Any:
    """Edit an existing issue comment. content is non-empty markdown or HTML (max
    10000 chars); strings without HTML tags are treated as markdown.
    Links to this Weave's tasks, issues and docs written as markdown links
    become live chips showing the real ID/title (the link text is ignored).
    If converting would make the content too long to re-save in the browser,
    all links are kept as plain links."""
    return await get_client().call_json(
        "PATCH",
        f"/api/branches/{branch_id}/tasks/{task_id}/issues/{issue_id}/comments/{comment_id}",
        json={"content": content},
    )


@mcp.tool
async def delete_issue_comment(
    branch_id: BranchRef, task_id: int, issue_id: int, comment_id: int
) -> Any:
    """Delete a single comment from a task issue."""
    return await get_client().call_json(
        "DELETE",
        f"/api/branches/{branch_id}/tasks/{task_id}/issues/{issue_id}/comments/{comment_id}",
    )


@mcp.tool
async def close_task_issue(
    branch_id: BranchRef, task_id: int, issue_id: int, comment: str | None = None
) -> Any:
    """Close a task issue. Optionally post a comment in the same action (GitHub-style
    close-with-comment). comment is non-empty markdown or HTML (max 10000 chars) when
    given; strings without HTML tags are treated as markdown.
    Links to this Weave's tasks, issues and docs written as markdown links
    become live chips showing the real ID/title (the link text is ignored).
    If converting would make the content too long to re-save in the browser,
    all links are kept as plain links."""
    payload = {} if comment is None else {"comment": comment}
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/tasks/{task_id}/issues/{issue_id}/close",
        json=payload,
    )


@mcp.tool
async def reopen_task_issue(
    branch_id: BranchRef, task_id: int, issue_id: int, comment: str | None = None
) -> Any:
    """Reopen a closed task issue. Optionally post a comment in the same action.
    comment is non-empty markdown or HTML (max 10000 chars) when given; strings
    without HTML tags are treated as markdown.
    Links to this Weave's tasks, issues and docs written as markdown links
    become live chips showing the real ID/title (the link text is ignored).
    If converting would make the content too long to re-save in the browser,
    all links are kept as plain links."""
    payload = {} if comment is None else {"comment": comment}
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/tasks/{task_id}/issues/{issue_id}/reopen",
        json=payload,
    )
