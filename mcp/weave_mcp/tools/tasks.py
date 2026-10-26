from typing import Any

from .._app import mcp, get_client, BranchRef, UserRef
from .._format import format_params
from .._pagination import paginate


@mcp.tool
async def get_task(branch_id: BranchRef, task_id: int, format: str = "html") -> Any:
    """Get full details of a single task within a branch.

    format: "html" (default) or "markdown" — rich-text fields (description)
    are returned converted to that format under the same field names.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks/{task_id}", params=format_params(format)
    )


@mcp.tool
async def create_task(
    branch_id: BranchRef,
    title: str,
    description: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    task_type: str | None = None,
    due_date: str | None = None,
    start_date: str | None = None,
    sprint_id: int | None = None,
    epic_id: int | None = None,
    parent_task_id: int | None = None,
    assignee_main: UserRef | None = None,
    assignee_sub: list[UserRef] | None = None,
    label_ids: list[int] | None = None,
    custom_fields: dict | None = None,
) -> Any:
    """Create a new task in a branch.

    Only title is required. priority is low/medium/high/urgent (default medium).
    status and task_type accept the branch's key (case-insensitive) or display
    label; omit them to use the branch defaults. Invalid values fail with the
    valid set (valid_statuses/valid_task_types) in the error — no pre-check
    needed. The response echoes the applied values as applied_status /
    applied_task_type. Dates are ISO YYYY-MM-DD. assignee_main/assignee_sub
    accept a user id, an exact username, an email, or "me" (ambiguous matches
    fail; digit-only strings are ids). parent_task_id makes this a subtask;
    custom_fields keys come from list_task_types. description accepts markdown or
    HTML; strings without HTML tags are treated as markdown.
    Links to this Weave's tasks, issues and docs written as markdown links
    become live chips showing the real ID/title (the link text is ignored).
    """
    body = {"title": title}
    body.update({
        k: v for k, v in {
            "description": description, "priority": priority, "status": status,
            "task_type": task_type, "due_date": due_date, "start_date": start_date,
            "sprint_id": sprint_id, "epic_id": epic_id, "parent_task_id": parent_task_id,
            "label_ids": label_ids, "custom_fields": custom_fields,
        }.items() if v is not None
    })
    assignees = {
        k: v for k, v in {"main": assignee_main, "sub": assignee_sub}.items()
        if v is not None
    }
    if assignees:
        body["assignees"] = assignees
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/tasks", json=body
    )


@mcp.tool
async def add_task_comment(branch_id: BranchRef, task_id: int, content: str) -> Any:
    """Add a comment to a task. content accepts markdown or HTML; strings without
    HTML tags are treated as markdown.
    Links to this Weave's tasks, issues and docs written as markdown links
    become live chips showing the real ID/title (the link text is ignored).
    If converting would make the content too long to re-save in the browser,
    all links are kept as plain links."""
    return await get_client().call_json(
        "POST",
        f"/api/branches/{branch_id}/tasks/{task_id}/comments",
        json={"content": content},
    )


@mcp.tool
async def list_branch_tasks(
    branch_id: BranchRef,
    sprint_id: int | None = None,
    limit: int | None = None,
    offset: int | None = None,
) -> Any:
    """List all tasks in a branch, optionally filtered by sprint.

    This tool only narrows by sprint. For complex filtering (by status / assignee /
    label / priority / dates / custom fields, AND/OR/NOT trees, sorting, or grouping)
    use query_tasks(branch_id=...) instead.

    Paginated client-side: returns the first `limit` tasks (default 50) from `offset`,
    plus a "pagination" summary (total/returned/has_more). Page with offset for the rest.
    """
    params = {k: v for k, v in {"sprint_id": sprint_id}.items() if v is not None}
    result = await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks", params=params
    )
    return paginate(result, "tasks", limit=limit, offset=offset)


@mcp.tool
async def update_task(
    branch_id: BranchRef,
    task_id: int,
    title: str | None = None,
    description: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    task_type: str | None = None,
    sprint_id: int | None = None,
    epic_id: int | None = None,
    start_date: str | None = None,
    due_date: str | None = None,
    assignee_main: UserRef | None = None,
    assignee_sub: list[UserRef] | None = None,
    label_ids: list[int] | None = None,
    custom_fields: dict | None = None,
    parent_task_id: int | None = None,
    promote_to_top: bool = False,
    dry_run: bool = False,
) -> Any:
    """Update fields of an existing task. All parameters are optional; only the ones
    you pass change.

    description accepts markdown or HTML; strings without HTML tags are treated as markdown.
    Links to this Weave's tasks, issues and docs written as markdown links
    become live chips showing the real ID/title (the link text is ignored).
    status/task_type accept the branch's key (case-insensitive) or display label;
    invalid values fail with the valid set in the error. assignee_main/assignee_sub
    accept a user id, an exact username, an email, or "me" (ambiguous matches fail).
    Dates are ISO.
    NOTE: assignees REPLACE the whole set — pass assignee_main and assignee_sub together,
    since providing only one clears the other. label_ids and custom_fields are likewise
    REPLACE, not merge: pass the complete desired list/object (e.g. label_ids=[] clears all
    labels), not just the ones to add.
    To ADD or REMOVE just one item without touching the rest, use the granular tools
    instead: add_task_label/remove_task_label, add_task_assignee/remove_task_assignee,
    set_task_custom_field. Pass dry_run=True to preview the added/removed/final diff
    WITHOUT writing (all validation still runs).
    Side effect: when this task is a top-level task and its main assignee actually
    changes to a user, subtasks whose main equals the previous main (or have no main)
    follow to the new main; subtasks with a different main are left alone. Unassigning
    the main and sub-only changes do not propagate. dry_run never propagates.
    To re-parent (make this a subtask of another task) pass parent_task_id with that
    task's id. To promote it to a top-level task, pass promote_to_top=True (this sends
    parent_task_id=null). Leaving both out keeps the current parent unchanged.
    promote_to_top takes precedence: if both promote_to_top=True and a parent_task_id
    are given, the task is promoted (parent_task_id=null is sent).
    """
    if promote_to_top:
        parent_value = None  # explicit null → backend promotes (model_fields_set includes it)
    elif parent_task_id is not None:
        parent_value = parent_task_id
    else:
        parent_value = "__omit__"  # sentinel: leave unchanged
    body = {k: v for k, v in {
        "title": title,
        "description": description,
        "status": status,
        "priority": priority,
        "task_type": task_type,
        "sprint_id": sprint_id,
        "epic_id": epic_id,
        "start_date": start_date,
        "due_date": due_date,
        "label_ids": label_ids,
        "custom_fields": custom_fields,
    }.items() if v is not None}
    if parent_value != "__omit__":
        body["parent_task_id"] = parent_value
    assignees = {
        k: v for k, v in {"main": assignee_main, "sub": assignee_sub}.items()
        if v is not None
    }
    if assignees:
        body["assignees"] = assignees
    if dry_run:
        body["dry_run"] = True
    return await get_client().call_json(
        "PATCH", f"/api/branches/{branch_id}/tasks/{task_id}", json=body
    )


@mcp.tool
async def reorder_tasks(
    branch_id: BranchRef,
    task_ids: list[int],
    sprint_id: int | None = None,
    after_task_id: int | None = None,
) -> Any:
    """Reorder tasks and/or move them between sprints (or to the backlog).

    task_ids is the ordered block of tasks to place. sprint_id is the destination
    sprint; omit it to move them to the backlog. after_task_id positions the block
    right after that task; omit it to insert at the top.
    """
    body = {"task_ids": task_ids}
    body.update({
        k: v for k, v in {"sprint_id": sprint_id, "after_task_id": after_task_id}.items()
        if v is not None
    })
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/tasks/reorder", json=body
    )


@mcp.tool
async def delete_task(branch_id: BranchRef, task_id: int) -> Any:
    """Delete a task from a branch."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/tasks/{task_id}"
    )


@mcp.tool
async def list_task_comments(
    branch_id: BranchRef, task_id: int, order: str = "asc", format: str = "html"
) -> Any:
    """List all comments on a task.

    order: "asc" (default, oldest first) or "desc" (newest first) by created_at.
    Replies reference their root via parent_comment_id regardless of order.
    format: "html" (default) or "markdown" — each comment's content is returned
    converted to that format.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks/{task_id}/comments",
        params=format_params(format, order=order)
    )


@mcp.tool
async def update_task_comment(
    branch_id: BranchRef,
    task_id: int,
    comment_id: int,
    content: str,
) -> Any:
    """Update the content of an existing task comment. content accepts markdown or
    HTML; strings without HTML tags are treated as markdown.
    Links to this Weave's tasks, issues and docs written as markdown links
    become live chips showing the real ID/title (the link text is ignored).
    If converting would make the content too long to re-save in the browser,
    all links are kept as plain links."""
    return await get_client().call_json(
        "PATCH",
        f"/api/branches/{branch_id}/tasks/{task_id}/comments/{comment_id}",
        json={"content": content},
    )


@mcp.tool
async def delete_task_comment(branch_id: BranchRef, task_id: int, comment_id: int) -> Any:
    """Delete a comment from a task."""
    return await get_client().call_json(
        "DELETE",
        f"/api/branches/{branch_id}/tasks/{task_id}/comments/{comment_id}",
    )


@mcp.tool
async def list_archived_tasks(
    branch_id: BranchRef,
    limit: int | None = None,
    offset: int | None = None,
) -> Any:
    """List a branch's archived (done/cancelled) tasks.

    list_branch_tasks excludes terminal tasks, so this is the way to see what was
    completed (e.g. "what shipped last sprint").

    Paginated client-side: returns the first `limit` tasks (default 50) from `offset`,
    plus a "pagination" summary (total/returned/has_more). Page with offset for the rest.
    """
    result = await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks/archive"
    )
    return paginate(result, "tasks", limit=limit, offset=offset)


@mcp.tool
async def list_task_pages(branch_id: BranchRef, task_id: int) -> Any:
    """List the canvas pages (docs) linked to a task.

    Each entry includes the link's own id (link_id), which unlink_task_page needs.
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/tasks/{task_id}/pages"
    )


@mcp.tool
async def link_task_page(branch_id: BranchRef, task_id: int, page_id: int) -> Any:
    """Link a canvas page (doc) to a task. page_id comes from Canvas tools or search_docs."""
    return await get_client().call_json(
        "POST",
        f"/api/branches/{branch_id}/tasks/{task_id}/pages",
        json={"page_id": page_id},
    )


@mcp.tool
async def search_task_pages(branch_id: BranchRef, task_id: int, q: str) -> Any:
    """Search canvas pages that can be linked to a task (typeahead). q must be non-empty."""
    return await get_client().call_json(
        "GET",
        f"/api/branches/{branch_id}/tasks/{task_id}/pages/search",
        params={"q": q},
    )


@mcp.tool
async def unlink_task_page(branch_id: BranchRef, task_id: int, link_id: int) -> Any:
    """Remove a task↔page link. link_id is the link's id from list_task_pages (not the page_id)."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/tasks/{task_id}/pages/{link_id}"
    )


@mcp.tool
async def query_tasks(
    filter: dict | None = None,
    branch_id: BranchRef | None = None,
    scope: str = "my",
    group_by: str | None = None,
    sort: list | None = None,
    limit: int | None = None,
    offset: int | None = None,
    saved_view_id: int | None = None,
) -> Any:
    """Query tasks with a structured FilterSpec (boolean tree).

    FilterSpec shape:
      group: {"type":"group","op":"AND"|"OR","negate":false,"children":[...]}
      cond:  {"type":"cond","field":"<key>","op":"<op>","value":<v>,"negate":false}
    fields: status, status_category, priority, task_type, label, epic, sprint,
      assignee ("$me"; for unassigned use op "is_empty"), created_by, due_date, start_date, created_at,
      updated_at, text, has_subtasks, is_top_level, cf:<custom_field_id>.
    ops: eq, in, is_empty, lt/lte/gt/gte, between, contains. Use negate for NOT.
    date tokens: "$today", "$today+7d". sort: [{"field","dir":"asc|desc"}].
    group_by (server-aggregated 'groups'): status/priority/task_type/epic/sprint only;
    other values return groups=null (assignee/label grouping is UI-side). This also
    applies when a saved view's group_by is assignee/label: items come back, groups=null.
    saved_view_id: load a saved view's filter/group_by/sort on the server (filter/group_by/
      sort args are ignored). Get ids from list_saved_views. A branch-scoped view requires a
      matching branch_id; a personal (global) view works only cross-branch (no branch_id).
      If that personal view has a saved cross-branch scope (my/all), it overrides the `scope`
      arg too — `scope` is only a fallback when the view has none.
    With branch_id → that branch only (custom fields allowed). Without branch_id →
    cross-branch over your member branches; scope "my" (assigned to you) or "all".
    """
    # 서버가 limit/offset을 직접 받는다(page 산술 없음 → offset 배수 제약·이중 페이지네이션 문제 없음).
    # 결과는 서버 응답을 그대로 반환한다(paginate() 재절단 금지).
    body: dict = {
        "filter": filter,
        "group_by": group_by,
        "sort": sort or [],
        "limit": min(limit, 200) if limit else 50,
        "offset": offset or 0,
    }
    if saved_view_id is not None:
        body["saved_view_id"] = saved_view_id
    if branch_id is not None:
        return await get_client().call_json(
            "POST", f"/api/branches/{branch_id}/tasks/query", json=body)
    body["scope"] = scope
    return await get_client().call_json("POST", "/api/tasks/query", json=body)


@mcp.tool
async def list_saved_views(scope_branch_id: int | None = None) -> Any:
    """List saved task views accessible to you. Without scope_branch_id → your personal
    (global) views; with it → that branch's views you can see (yours + branch-shared).
    Each view's view_id can be passed to query_tasks(saved_view_id=...)."""
    params = {"scope_branch_id": scope_branch_id} if scope_branch_id is not None else {}
    return await get_client().call_json("GET", "/api/saved-views", params=params)


@mcp.tool
async def add_task_label(branch_id: BranchRef, task_id: int, label_id: int) -> Any:
    """Add one label to a task, keeping existing labels (no replace).

    Use this instead of update_task(label_ids=...) when you only want to ADD a
    label — update_task replaces the whole set. label_id from list_labels(branch_id).
    """
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/tasks/{task_id}/labels",
        json={"label_id": label_id},
    )


@mcp.tool
async def remove_task_label(branch_id: BranchRef, task_id: int, label_id: int) -> Any:
    """Remove one label from a task, keeping the others."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/tasks/{task_id}/labels/{label_id}",
    )


@mcp.tool
async def add_task_assignee(branch_id: BranchRef, task_id: int, user_id: UserRef, role: str = "sub") -> Any:
    """Add one assignee to a task without replacing the rest. role is "sub" (default) or "main".
    user_id accepts a user id, an exact username, an email, or "me".

    Use this instead of update_task(assignee_*) when you only want to ADD someone —
    update_task replaces the whole assignee set. role="main" replaces the current main;
    adding role="sub" to the current main is rejected.
    Setting role="main" on a top-level task also moves subtasks whose main was the
    previous main (or had none) to the new main; subtasks with a different main are
    left alone.
    """
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/tasks/{task_id}/assignees",
        json={"user_id": user_id, "role": role},
    )


@mcp.tool
async def remove_task_assignee(branch_id: BranchRef, task_id: int, user_id: UserRef) -> Any:
    """Remove one assignee (main or sub) from a task, keeping the others.
    user_id accepts a user id, an exact username, an email, or "me"."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/tasks/{task_id}/assignees/{user_id}",
    )


@mcp.tool
async def set_task_custom_field(branch_id: BranchRef, task_id: int, field_id: int,
                                value: str | int | float | bool | None = None) -> Any:
    """Set ONE custom field value on a task, preserving the others (per-key merge).

    Use this instead of update_task(custom_fields=...) when you only want to change
    one field — update_task replaces the whole custom_fields object. value=null clears
    the field. field_id from list_custom_fields; value type must match the field
    (number->number, checkbox->bool, date->"YYYY-MM-DD", select->an option, text/url->string).
    """
    return await get_client().call_json(
        "PATCH", f"/api/branches/{branch_id}/tasks/{task_id}/custom-fields",
        json={"field_id": field_id, "value": value},
    )
