# Weave MCP Server

Exposes Weave project-management tools (tasks, sprints, epics, issues, docs, and more) to
Claude sessions over MCP (stdio). Talks to Weave's REST API only — the Weave backend is not
modified. Each tool acts as the token's owner; `?` marks optional arguments.

## Tools (184)

> The authoritative, always-current description of each tool is its docstring in
> `weave_mcp/tools/*.py` (that's what the model reads). This list is the human-readable overview.

**Branches & your work**
- `get_current_user()` — the account this token acts as (user_id, email, username, role); resolves "me"/"my"
- `list_branches()` — list branches (projects); usually optional — any `branch_id` argument also accepts a member branch's key directly (e.g. `branch_id="WV"`; a public branch you haven't joined still needs its numeric id)
- `get_branch(branch_id)` — one branch's detail incl. your role
- `create_branch(branch_name, key, description?, visibility?)` — `key`: 2-10 uppercase, starts with a letter
- `update_branch(branch_id, branch_name?, key?, description?, visibility?, color?, icon?)` · `delete_branch(branch_id)` (archive) · `restore_branch(branch_id)` · `leave_branch(branch_id)` · `join_branch(branch_id)` · `list_archived_branches()` · `list_public_branches()` — container lifecycle (update/delete/restore admin-only)
- `list_branch_members(branch_id)` · `search_branch_non_members(branch_id, q?)` — resolve names → user ids
- `add_branch_member(branch_id, user_id, role?)` · `update_branch_member_role(branch_id, user_id, role)` · `remove_branch_member(branch_id, user_id)` — `role`: admin | member; invite/role-change/remove (admin-only)
- `get_branch_home_stats()` — open / in-progress / due-this-week / active-sprint counts across your branches
- `list_my_tasks(status?, priority?, branch_id?, status_category?, sort_by?, limit?, offset?)` — your assigned tasks across branches

> **Branch references**: tools that take `branch_id` accept either a numeric id or a member branch key such as `"WV"`. Keys are validated as ASCII branch keys (`^[A-Za-z][A-Za-z0-9]{1,9}$`) and normalized to uppercase before lookup. Non-ASCII lookalikes and non-ASCII decimal digits are rejected instead of being coerced.

> **Pagination**: the unbounded list/search tools (`list_my_tasks`, `list_branch_tasks`, `list_archived_tasks`,
> `list_epic_tasks`, `list_track_items`, `search_tasks`/`docs`/`issues`) page client-side — they return the first
> `limit` rows (default 50) from `offset` plus a `pagination` summary (`total`/`returned`/`has_more`/`size_capped`),
> and auto-shrink a page that would overflow the MCP token limit (so `returned` can be < `limit` — use `has_more`,
> not `returned`, to tell whether more remain). Page with `offset`, or narrow with filters.

**Search** (keyword lookup — find ids without listing everything; `query` capped at 100 chars)
- `search_tasks(query, scope?, limit?, offset?)` — `scope`: "my" (default) | "all"
- `search_docs(query, limit?, offset?)` · `search_issues(query, limit?, offset?)`

**Activity & recent** (read-only history/context)
- `list_task_activity(branch_id, task_id, limit?, offset?)` · `list_branch_activity(branch_id, limit?, offset?)` — who changed what (server-paginated, default 20/30)
- `list_canvas_activity(canvas_id, limit?, offset?)` · `list_canvas_page_activity(canvas_id, page_id, limit?, offset?)`
- `list_recent_views(limit?, item_type?)` — what you recently viewed (default 10, max 30)
- `batch_ref_status(task_ids?, issue_ids?, page_ids?, user_ids?)` — resolve many refs → titles/statuses/usernames in one call

**Tasks**
- `list_branch_tasks(branch_id, sprint_id?, limit?, offset?)` — all tasks in a branch
- `query_tasks(filter?, branch_id?, scope?, group_by?, sort?, limit?, offset?, saved_view_id?)` — structured query with a FilterSpec (boolean tree of conditions on status, priority, assignee, labels, epic/sprint, dates with `$today±Nd`, text, custom fields); with `branch_id` → that branch only, without → cross-branch (`scope`: my | all); `group_by` aggregates server-side for status/priority/task_type/epic/sprint; `saved_view_id` loads a saved view's filter/group/sort instead of the args
- `list_saved_views(scope_branch_id?)` — saved task views you can use: your personal (cross-branch) views by default, or a branch's views with `scope_branch_id`; pass a `view_id` to `query_tasks(saved_view_id=...)`
- `get_task(branch_id, task_id, format?)` — full task detail; `format`: html (default) | markdown — rich-text fields (description) converted
- `create_task(branch_id, title, description?, priority?, status?, task_type?, due_date?, start_date?, sprint_id?, epic_id?, parent_task_id?, assignee_main?, assignee_sub?, label_ids?, custom_fields?)` — create a task
- `update_task(branch_id, task_id, title?, description?, status?, priority?, task_type?, sprint_id?, epic_id?, start_date?, due_date?, assignee_main?, assignee_sub?, label_ids?, custom_fields?, dry_run?)` — update a task (label/assignee/custom_fields는 REPLACE; 하나만 추가/제거하려면 아래 전용 도구. dry_run=true면 쓰기 없이 변경 diff만 반환)
- `add_task_label(branch_id, task_id, label_id)` · `remove_task_label(branch_id, task_id, label_id)` — 기존 라벨 유지한 채 단일 라벨 추가/제거
- `add_task_assignee(branch_id, task_id, user_id, role?)` · `remove_task_assignee(branch_id, task_id, user_id)` — 담당자 단일 추가/제거 (role='main'은 기존 main 교체)
- `set_task_custom_field(branch_id, task_id, field_id, value?)` — custom field 한 키만 병합(value=null이면 clear), 나머지 보존
- `reorder_tasks(branch_id, task_ids, sprint_id?, after_task_id?)` — reorder / move tasks between sprints (omit `sprint_id` for backlog)
- `list_archived_tasks(branch_id, limit?, offset?)` — done/cancelled tasks (excluded from `list_branch_tasks`)
- `delete_task(branch_id, task_id)` — delete a task
- `list_task_pages(branch_id, task_id)` · `link_task_page(branch_id, task_id, page_id)` · `search_task_pages(branch_id, task_id, q)` · `unlink_task_page(branch_id, task_id, link_id)` — task ↔ Canvas page links

**Task comments**
- `list_task_comments(branch_id, task_id, order?, format?)` — `order`: asc (default, oldest first) | desc; `format`: html (default) | markdown
- `add_task_comment(branch_id, task_id, content)`
- `update_task_comment(branch_id, task_id, comment_id, content)`
- `delete_task_comment(branch_id, task_id, comment_id)`

**Issues** (sub-issues under a task)
- `list_task_issues(branch_id, task_id)` · `get_task_issue(branch_id, task_id, issue_id, format?)` — `format`: html (default) | markdown (issue body and comments)
- `create_task_issue(branch_id, task_id, title, body?)`
- `update_task_issue(branch_id, task_id, issue_id, title?, body?, status?)`
- `delete_task_issue(branch_id, task_id, issue_id)`
- `close_task_issue(branch_id, task_id, issue_id, comment?)` · `reopen_task_issue(branch_id, task_id, issue_id, comment?)` — GitHub-style close/reopen, optionally post a comment in the same action
- `add_issue_comment(branch_id, task_id, issue_id, content)` · `update_issue_comment(..., comment_id, content)` · `delete_issue_comment(..., comment_id)` — comments are read via `get_task_issue`

**Dependencies**
- `list_task_dependencies(branch_id, task_id)` · `list_epic_dependencies(branch_id, epic_id)` — epic-level dependency graph
- `create_dependency(branch_id, source_task_id, target_task_id, dep_type?)` — `dep_type`: finish_to_start | relates_to
- `delete_dependency(branch_id, dependency_id)`

**Sprints**
- `list_sprints(branch_id)`
- `create_sprint(branch_id, sprint_name, goal?, start_date?, end_date?)`
- `update_sprint(branch_id, sprint_id, sprint_name?, goal?, start_date?, end_date?, status?)`
- `delete_sprint(branch_id, sprint_id)` · `start_sprint(branch_id, sprint_id)` · `reorder_sprints(branch_id, sprint_ids)`
- `complete_sprint(branch_id, sprint_id, move_to?)` — `move_to`: "backlog" or a sprint id
- `get_sprint_task_counts(branch_id, sprint_id)` — progress summary without listing tasks

**Epics**
- `list_epics(branch_id)` · `get_epic(branch_id, epic_id)`
- `create_epic(branch_id, epic_name, description?, status?, color?, start_date?, due_date?)`
- `update_epic(branch_id, epic_id, epic_name?, description?, status?, color?, start_date?, due_date?)`
- `delete_epic(branch_id, epic_id)` · `list_epic_tasks(branch_id, epic_id, limit?, offset?)` · `reorder_epics(branch_id, epic_ids)`

**Branch config** (the valid values for task fields; status/type writes are admin-only)
- `list_labels(branch_id)` · `list_workflow_statuses(branch_id)` · `list_task_types(branch_id)`
- `create_label(branch_id, label_name, color?)` · `update_label(branch_id, label_id, label_name?, color?)` · `delete_label(branch_id, label_id)`
- `create_workflow_status(branch_id, key, label, category, color?)` · `update_workflow_status(branch_id, status_id, label?, color?, category?, is_default?)` · `delete_workflow_status(branch_id, status_id)` · `reorder_workflow_statuses(branch_id, items)`
- `create_task_type(branch_id, type_key, type_name, icon?, color?)` · `update_task_type(branch_id, type_id, type_name?, icon?, color?)` · `delete_task_type(branch_id, type_id)`
- `list_custom_fields(branch_id, type_id)` · `create_custom_field(branch_id, type_id, field_name, field_type, field_options?, is_required?)` · `update_custom_field(branch_id, type_id, field_id, field_name?, field_type?, field_options?, is_required?)` · `delete_custom_field(branch_id, type_id, field_id)` · `reorder_custom_fields(branch_id, type_id, items)`

**Canvas (docs)**
- `list_canvases()` · `get_canvas(canvas_id)` · `get_canvas_home_stats()` — total-docs / edited-this-week / starred counts
- `list_canvas_members(canvas_id)` · `search_canvas_non_members(canvas_id, q?)` · `add_canvas_member(canvas_id, user_id, role?)` · `update_canvas_member_role(canvas_id, user_id, role)` · `remove_canvas_member(canvas_id, user_id)` — `role`: admin | member (admin-only)
- `create_canvas(canvas_name, key, description?, visibility?, branch_id?)` — `key`: 2-10 uppercase, starts with a letter
- `update_canvas(canvas_id, canvas_name?, key?, description?, visibility?, color?, icon?)` · `delete_canvas(canvas_id)` (archive) · `restore_canvas(canvas_id)` · `leave_canvas(canvas_id)` · `join_canvas(canvas_id)` · `list_archived_canvases()` · `list_public_canvases()`
- `get_canvas_page_tree(canvas_id)` · `get_canvas_page(canvas_id, page_id, format?)` — `format`: html (default) | markdown (page content)
- `create_canvas_page(canvas_id, title, content?, parent_page_id?, type?)` — `type`: document | folder | typst
- `update_canvas_page(canvas_id, page_id, title?, content?, wide_mode?)` — `content` replaces the whole page body
- `move_canvas_page(canvas_id, page_id, position, parent_page_id?)` · `delete_canvas_page(canvas_id, page_id)`
- `list_canvas_annotations(canvas_id, page_id, status?)` — inline comment threads; `status`: open | resolved
- `create_canvas_annotation(canvas_id, page_id, quoted_text, content, ...anchors?)`
- `update_canvas_annotation(canvas_id, page_id, annotation_id, status)` (resolve/reopen) · `add_canvas_annotation_reply(canvas_id, page_id, annotation_id, content)`

**Tracks** (cross-branch workflows)
- `list_tracks()` — your tracks, each with `progress_percent`, item/branch/member counts and a linked-branch preview
- `list_track_members(track_id)` · `search_track_non_members(track_id, q?)` · `add_track_member(track_id, user_id, role?)` · `update_track_member_role(track_id, user_id, role)` · `remove_track_member(track_id, user_id)` — `role`: viewer | editor | owner (owner-only)
- `get_track(track_id)` · `get_track_home_stats()` — active-track / connected-branch / in-progress / due-this-week counts
- `create_track(track_name, description?, color?, icon?, visibility?, default_view?, participating_branch_ids?)` — `default_view`: flow | timeline | tree
- `update_track(track_id, track_name?, description?, color?, icon?, visibility?, default_view?)` · `delete_track(track_id)` (archive) · `restore_track(track_id)` · `leave_track(track_id)` · `list_archived_tracks()`
- `list_track_branches(track_id)` · `add_track_branch(track_id, branch_id)` · `remove_track_branch(track_id, branch_id)`
- `search_track_sources(track_id, q?, branch_id?, sprint_id?, epic_id?, status?, priority?, exclude_done?, limit?)` — find candidate `source_task_id`s
- `list_track_items(track_id, limit?, offset?)` · `add_track_item(track_id, source_task_id, position_x?, position_y?)`
- `add_track_items_bulk(track_id, source_task_ids, scope_mode?, scope_id?)` — `scope_mode`: sprint | epic | filter (`scope_id` required for sprint/epic)
- `delete_track_item(track_id, item_id)`
- `list_track_links(track_id)` · `add_track_link(track_id, source_item_id, target_item_id, link_type?, materialize?)` — `link_type`: flow_to | relates_to
- `delete_track_link(track_id, link_id)`

**Notifications & stars**
- `list_notifications(limit?, offset?)` · `get_unread_notification_count()` · `mark_notification_read(notification_id)` · `mark_all_notifications_read()`
- `list_starred(item_type?, limit?)` · `toggle_star(item_type, item_id)` · `check_starred(item_type, item_id)` — `item_type`: task | doc

**Schedule** (branch calendar)
- `list_schedule_events(branch_id, range_start, range_end)` — `range_start`/`range_end` are required ISO dates
- `list_calendar_tasks(branch_id, range_start, range_end)` · `list_calendar_epics(branch_id, range_start, range_end)` — due-dated tasks/epics for calendar display
- `create_schedule_event(branch_id, title, start_date, end_date?, description?, color?, participant_ids?)`
- `update_schedule_event(branch_id, event_id, title?, start_date?, end_date?, description?, color?, participant_ids?)`
- `delete_schedule_event(branch_id, event_id)`
- `list_event_tasks(branch_id, event_id)` · `link_event_task(branch_id, event_id, task_id)` · `search_event_tasks(branch_id, event_id, q)` · `unlink_event_task(branch_id, event_id, link_id)` — event ↔ task links

**Scrum** (weekly daily-scrum + retro boards)
- `list_scrum_boards()` — call first to get a `board_id`
- `get_scrum_board(board_id)` — board metadata (config/members/your role)
- `create_scrum_board(name, icon?, color?, visibility?, retro_cadence?, retro_interval_weeks?, retro_template?, retro_anchor_weekday?)` — `retro_cadence`: weekly | biweekly | every_n_weeks | monthly | manual; `retro_anchor_weekday`: 0-4 (Mon-Fri)
- `update_scrum_board(board_id, ...same fields)` · `delete_scrum_board(board_id)` (archive) · `restore_scrum_board(board_id)` · `leave_scrum_board(board_id)` · `list_archived_scrum_boards()` — board lifecycle (create/update/delete/restore admin-only; `leave` removes yourself)
- `get_scrum_home_cards()` — cross-board cards (today's unwritten daily-scrum, due retros)
- `get_scrum_week(board_id, iso_year?, iso_week?)` — read the weekly daily-scrum grid cells (per member × weekday × plan/gap) as plain text; defaults to the current ISO week in the workspace time zone
- `write_scrum_daily(board_id, text, row?, day?, mode?, iso_year?, iso_week?)` — write YOUR OWN daily-scrum cell; defaults to today's `plan` cell in the workspace time zone, `mode` replace/append, weekends need an explicit `day` (0=Mon..4=Fri)
- `get_current_retro(board_id)` — get-or-create the current period's retrospective doc (`retro_id`); null for 'manual' cadence boards
- `get_scrum_retro_cells(board_id, retro_id)` — read the retro KPT cells (per member × keep/problem/try) as plain text
- `write_scrum_retro(board_id, retro_id, key, text, mode?)` — write YOUR OWN retro KPT cell (`key` = keep/problem/try)
- `list_scrum_retros(board_id)` — past retrospectives, newest first
- `list_scrum_members(board_id)` · `search_scrum_non_members(board_id, q?)` · `add_scrum_member(board_id, user_id, role?)` · `update_scrum_member_role(board_id, user_id, role)` · `remove_scrum_member(board_id, user_id)` — `role`: admin | member (admin-only)

> Live editing of daily-scrum/retro cells still flows over Yjs/WebSocket; these tools read a snapshot and write your own cells over REST (writes broadcast to anyone with the board open).

## Use it (recommended — no clone needed)

Requires [`uv`](https://docs.astral.sh/uv/). Add this to your MCP client's `.mcp.json` and restart it:

```jsonc
{
  "mcpServers": {
    "weave": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/ParkHyeonSeong/weave#subdirectory=mcp", "weave-mcp"],
      "env": {
        "WEAVE_BASE_URL": "https://weave.example.com",
        "WEAVE_API_TOKEN": "${WEAVE_API_TOKEN}"
      }
    }
  }
}
```

`uvx` fetches and runs the server in an isolated environment — no clone, no venv, no `.env` file. Credentials come from the `env` block. Create a Personal Access Token in Weave (Profile → Personal Access Tokens), then put it in `WEAVE_API_TOKEN` — here, or in your shell env referenced via `${WEAVE_API_TOKEN}`.

## Local development

For working on the server itself:

1. `cp mcp/.env.example mcp/.env` and fill in `WEAVE_BASE_URL` and `WEAVE_API_TOKEN`.
2. `python3 -m venv mcp/.venv && mcp/.venv/bin/pip install -e "./mcp[dev]"`
3. Register it in the repo-root `.mcp.json` (git-ignored, so it stays local to your machine):
   ```json
   "weave": { "command": "mcp/.venv/bin/weave-mcp" }
   ```
   Then restart your MCP client to pick it up.

## Test
```bash
mcp/.venv/bin/python -m pytest mcp/tests -v
```

## Auth model
The client sends a Weave Personal Access Token as an `Authorization: Bearer` header on every
request. Tokens are long-lived and revocable (revoke in the Weave UI), so there is no login,
cookie, or session refresh. An invalid/revoked/expired token returns a 401, surfaced as
`{"error": {"category": "auth", ...}}` (distinct from a forbidden resource, whose
`"category"` is `"forbidden"`). The `"retryable"` field is `false` for auth — stop and
surface the error rather than retrying. The token lives only in `WEAVE_API_TOKEN`
(env / git-ignored `mcp/.env`).
