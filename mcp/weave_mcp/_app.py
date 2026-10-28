from fastmcp import FastMCP

from .client import WeaveClient
from ._branch_ref import BranchRef  # re-exported for tool annotations
from ._user_ref import UserRef  # re-exported for tool annotations

INSTRUCTIONS = """\
Weave is a project-management app with 5 sub-apps: Branch (PM/tasks), Canvas (docs),
Track (cross-branch workflows), Schedule (calendar), and Scrum (weekly boards). These
tools drive it over Weave's REST API, acting as the token's owner.

Getting oriented:
- get_current_user() resolves "me"/"my" (the account the token acts as).
- Most tools need a branch_id. Pass either the numeric id OR the branch key of a branch
  you're a member of (e.g. branch_id="WV") — the key is resolved automatically. Use
  list_branches() to discover those branches. (Exception: to join a public branch you're
  not in yet, pass join_branch a numeric id from list_public_branches.) Likewise
  list_canvases(), list_tracks(), and list_scrum_boards() are the entry points for those apps.
- To find something when you don't have its id, use search_tasks / search_docs /
  search_issues instead of listing every branch.

Before creating or updating tasks:
- status and task_type accept the branch's key (case-insensitive) or display label;
  omit them on create to use the branch's defaults. Invalid values fail with the
  valid set in the error (valid_statuses / valid_task_types), so a pre-check via
  list_workflow_statuses(branch_id) / list_task_types(branch_id) is only needed
  for exploration.
- assignee and participant params (assignee_main/assignee_sub, add/remove_task_assignee
  user_id, participant_ids) accept a user id, an exact username, an email, or "me" —
  resolved against the branch's member list (ambiguous matches fail with candidates;
  digit-only strings are treated as ids). Other user_id params (member management etc.)
  still take numeric ids from list_branch_members(branch_id).

Images:
- Content shows an embedded image only as its address (<img src="/api/uploads/..."> or
  ![alt](/api/uploads/...)). Opening it needs your login, so call get_image(address) to
  see the image.
- To add one, upload a local file with upload_canvas_image (canvas document pages,
  annotations) or upload_branch_image (task descriptions, comments, issues), then embed
  the returned url as ![short description](url) — or <img src="url" alt="..."> where the
  content is HTML (annotations always are). Only members of that canvas/branch can see
  the image, so upload where it will be shown.
- Don't inline base64 (data:) images; they are dropped or lost on the next edit. Scrum
  cells and descriptions/goals are plain text and can't show images.

Conventions: ids are integers and dates are ISO YYYY-MM-DD. Every tool returns the
API's JSON on success, or {"error": {...}} on failure — a nested object with
"category" (one of auth, forbidden, not_found, validation, conflict, rate_limited,
network, server, business), "code" (the canonical error code, may be null), "message",
"http_status", "retryable" (true only for network/server/rate_limited), and optional
"retry_after"/"detail". Treat any top-level "error" key as failure, never success — a
successful result never carries a top-level "error" field. category="auth" means the
token is dead — stop and surface it; "forbidden" means the token is fine but the action
isn't allowed."""

mcp = FastMCP("weave", instructions=INSTRUCTIONS)

from ._middleware import WeaveDriftGuard, BranchRefResolver, UserRefResolver  # noqa: E402
mcp.add_middleware(WeaveDriftGuard())       # outermost — validates/absorbs everything below
mcp.add_middleware(BranchRefResolver())     # inner — rewrites branch_id before the tool
mcp.add_middleware(UserRefResolver())       # innermost — rewrites user refs (branch_id already numeric)

_client: WeaveClient | None = None


def get_client() -> WeaveClient:
    global _client
    if _client is None:
        _client = WeaveClient()
    return _client
