# Contributing to Weave

This page covers how the repository is laid out, how to run and test it, and what a pull request should contain. The product overview and setup are in [README.md](README.md) (English) / [README.ko.md](README.ko.md) (Korean).

## Running it

`make up-build` from the repository root starts the whole stack with hot reload (README → Quick Start). `backend/` and `frontend/` are mounted into the containers, so code edits apply immediately. Run `make up-build` again after changing dependencies — it rebuilds the images and refreshes the `node_modules` volume.

```
backend/    FastAPI app, SQLAlchemy models, Alembic migrations, pytest suite
frontend/   Next.js (Pages Router) app, SCSS, vitest suite   → frontend/README.md (Korean)
mcp/        MCP server (FastMCP) with its own pytest suite    → mcp/README.md
nginx/      Nginx config for the production container, plus a host-proxy example
```

## Tests

Run the suite for whatever you touched:

```bash
docker compose exec -T backend python -m pytest tests/ -q     # backend
(cd frontend && npm test)                                      # frontend (vitest), on the host
(cd mcp && .venv/bin/pytest)                                   # mcp
```

One-time setup for each:

- **backend** — the image has runtime dependencies only: `docker compose exec -T backend pip install pytest pytest-asyncio`. Repeat after the container is re-created (`make up-build`).
- **frontend** — Node 22 on the host, then `cd frontend && npm ci --legacy-peer-deps`. Run the suite on the host: a few parity tests read backend sources and call `git`, which the frontend container does not have.
- **mcp** — `cd mcp && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"`. Always call `.venv/bin/pytest` explicitly — a bare `pytest` can resolve to a system Python that does not have `fastmcp`.

New behaviour comes with a test next to the existing ones: `backend/tests/`, a `*.test.js` beside the frontend module, `mcp/tests/`.

## Conventions

- **Commits** — `feat:`, `fix:`, `chore:`, `test:`, `docs:` prefix, without a scope in parentheses. Write a body that says what the problem was and how the change fixes it; a subject line alone is not enough. Korean or English is fine (the history is mostly Korean).
- **Database changes** — go through an Alembic migration in `backend/migrations/versions/` (numbered, e.g. `066_...py`). Migrations run automatically when the backend container starts.
- **Archive is a soft delete** — any new query that lists tasks, docs or issues must filter `is_archived = FALSE`.
- **SCSS** — do not use the global `darken()` / `lighten()` / `saturate()` functions (deprecated in Dart Sass). Use the `sass:color` module: `@use 'sass:color';` then `color.adjust($c, $lightness: -8%)`. Colours come from the CSS variables in `frontend/styles/_themes.scss` so that light and dark themes both work.
- **Frontend error messages** — API errors are rendered through the shared helpers in `frontend/library/` (`getErrorCode` / `getError` / `errorText`), not through ad-hoc message maps in components.
- **User-facing text** — goes through i18n: add the key to both `frontend/library/i18n/en.js` and `ko.js`.
- **MCP tools** — when a REST endpoint should be reachable from AI clients, add a tool in `mcp/weave_mcp/tools/` and a line in `mcp/README.md`. A parameter that takes a branch must be named `branch_id` so that branch keys such as `"WV"` resolve.

## Pull requests

1. Branch from `main` and keep the change focused on one thing.
2. Make sure the relevant test suite passes, and add tests for new behaviour.
3. If you changed configuration, dependencies or user-visible behaviour, update the docs that describe it: `README.md` and `README.ko.md`, `.env.example` / `.env.production.example`, `THIRD-PARTY-LICENSES.md`, `mcp/README.md`.
4. Describe what changed and why. The pull-request template asks which test commands you ran.
