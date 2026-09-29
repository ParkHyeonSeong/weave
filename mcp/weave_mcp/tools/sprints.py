from typing import Any

from .._app import mcp, get_client, BranchRef


@mcp.tool
async def list_sprints(branch_id: BranchRef) -> Any:
    """List all sprints in a branch."""
    return await get_client().call_json("GET", f"/api/branches/{branch_id}/sprints")


@mcp.tool
async def create_sprint(
    branch_id: BranchRef,
    sprint_name: str,
    goal: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> Any:
    """Create a new sprint in a branch.

    Only sprint_name is required. Dates are ISO format YYYY-MM-DD.
    """
    body = {"sprint_name": sprint_name}
    body.update({
        k: v for k, v in {
            "goal": goal,
            "start_date": start_date,
            "end_date": end_date,
        }.items() if v is not None
    })
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/sprints", json=body
    )


@mcp.tool
async def update_sprint(
    branch_id: BranchRef,
    sprint_id: int,
    sprint_name: str | None = None,
    goal: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    status: str | None = None,
) -> Any:
    """Update fields of an existing sprint. All parameters are optional.

    Dates are ISO format YYYY-MM-DD.
    """
    body = {k: v for k, v in {
        "sprint_name": sprint_name,
        "goal": goal,
        "start_date": start_date,
        "end_date": end_date,
        "status": status,
    }.items() if v is not None}
    return await get_client().call_json(
        "PATCH", f"/api/branches/{branch_id}/sprints/{sprint_id}", json=body
    )


@mcp.tool
async def delete_sprint(branch_id: BranchRef, sprint_id: int) -> Any:
    """Delete a sprint from a branch."""
    return await get_client().call_json(
        "DELETE", f"/api/branches/{branch_id}/sprints/{sprint_id}"
    )


@mcp.tool
async def start_sprint(branch_id: BranchRef, sprint_id: int) -> Any:
    """Start a sprint in a branch."""
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/sprints/{sprint_id}/start"
    )


@mcp.tool
async def complete_sprint(
    branch_id: BranchRef,
    sprint_id: int,
    move_to: str = "backlog",
) -> Any:
    """Complete a sprint in a branch.

    move_to is where incomplete tasks go: "backlog" (default) or the destination
    sprint_id AS A STRING (e.g. "42", not the integer 42 — the backend expects a string).
    """
    return await get_client().call_json(
        "POST",
        f"/api/branches/{branch_id}/sprints/{sprint_id}/complete",
        json={"move_to": move_to},
    )


@mcp.tool
async def reorder_sprints(branch_id: BranchRef, sprint_ids: list[int]) -> Any:
    """Reorder a branch's sprints. sprint_ids is the full list in the desired order."""
    return await get_client().call_json(
        "POST", f"/api/branches/{branch_id}/sprints/reorder", json={"sprint_ids": sprint_ids}
    )


@mcp.tool
async def get_sprint_task_counts(branch_id: BranchRef, sprint_id: int) -> Any:
    """Get a sprint's task counts / progress summary without listing every task.

    done_count/incomplete_count count top-level tasks only; all_done_count/all_total_count
    include subtasks; my_count / my_incomplete_count are the tasks (incl. subtasks) assigned
    to the token's owner, total and not yet done/cancelled.
    all_in_progress_count / all_cancelled_count break the same subtask-inclusive set down by
    status category (all_done_count already includes the cancelled ones).
    """
    return await get_client().call_json(
        "GET", f"/api/branches/{branch_id}/sprints/{sprint_id}/task-counts"
    )
