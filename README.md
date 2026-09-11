<p align="center">
  <img src="frontend/public/icons/weave_square.svg" alt="Weave" width="80" />
</p>

<h1 align="center">Weave</h1>

<p align="center">
  Self-hosted project management, documentation, chat and weekly scrum in one web app.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a>
</p>

---

## What is Weave?

Weave is a web application you run on your own server as a single Docker Compose stack. A team signs in to one place to plan work, write documents, chat, and keep a weekly scrum. It is organised into five apps that share the same users, notifications and search:

| App | What it is |
|---|---|
| **Branch** | A project. Holds tasks, a board, sprints, epics and the project's own settings (statuses, task types, labels, custom fields). |
| **Canvas** | A documentation space. Pages that several people can edit at the same time. |
| **Track** | A cross-project view. Pulls tasks from several Branches into one timeline or dependency graph. |
| **Schedule** | A calendar for a Branch. Events can be linked to tasks, and sprints are drawn on it. |
| **Scrum** | A weekly board. Each member writes a short daily-scrum note; the team writes a retrospective on a schedule you choose. |

Around them: a **Messenger** for direct and group chat, a **Home** page with widgets, an optional in-app **AI assistant**, and an optional **MCP server** so tools like Claude can read and change things in Weave.

## Features

### Branch (tasks)
- Kanban board, list and timeline (epics over weeks, months or quarters) views, plus a flow view of task dependencies
- Sprints (start, complete, carry over unfinished work), epics, labels, priorities
- Statuses, task types and custom fields defined per Branch
- Dependencies between tasks (blocking / relates-to), also across Branches
- Subtasks (one level below a task) and issues (a bug or sub-issue thread under a task)
- Threaded comments and a full activity history on every task; task descriptions, issues and comments can be edited as raw markdown
- Filters that can be saved as views; a personal "My Tasks" page across all Branches
- GitHub: write `WV-123` in a pull request and the task's status follows the PR (see [GitHub App integration](#github-app-integration))
- Import a project from a Jira CSV export

### Canvas (docs)
- Real-time co-editing with presence, based on Yjs (CRDT)
- Rich text with tables, code blocks, math (KaTeX), Mermaid diagrams, callouts and images; paste a URL to get a preview card
- Typst documents with PDF export
- Markdown both ways: paste markdown into a page, copy any page as markdown
- Inline references to tasks, docs and issues with hover previews; comment threads anchored to selected text
- Nested pages with drag-and-drop ordering and per-page history

### Track
- Flow (dependency graph), Timeline (Gantt grouped by Branch) and Tree (outline by due date) views
- Add tasks in bulk by epic, sprint or filter; subtasks come along with their parent

### Schedule
- Calendar per Branch with sprint bars; link events to tasks

### Scrum
- Weekly grid — one cell per member per weekday — for daily-scrum notes
- Retrospectives (Keep / Problem / Try) created weekly, every N weeks, monthly, or by hand

### Messenger
- Direct and group chat with history, `@mentions`, file attachments, read receipts and presence
- Attach tasks, docs and issues with `/` commands; pop the chat out into a floating window

### Everywhere
- Light, dark or system theme
- English and Korean interface; a time zone per user, plus a workspace time zone for shared dates such as the scrum week
- Notifications in the app, and as Web Push when the browser is closed
- `⌘K` command palette to jump to or create anything; stars and recent items
- Home page with widgets (My Tasks, active sprints, recent, starred) whose layout is saved per user
- Public or private Branches and Canvases; browse and join the public ones
- Archive instead of delete in every app; archived items can be restored or permanently deleted from the archive page
- Installable as a PWA; usable on phone-width screens

### AI assistant (optional)
- In-app chat with streaming answers that knows your current tasks
- Anthropic or OpenAI, configured by an admin; the API key is stored encrypted

### Administration
- First-run setup wizard: workspace name, admin account, registration policy (open or approval-based)
- Approve or reject sign-ups, assign roles, send password resets
- Workspace time zone; integrations for the AI provider, SMTP and the GitHub App

## Quick Start

You need [Docker](https://docs.docker.com/get-docker/) (Engine 24+ with Compose v2). Nothing else is installed on your machine — Node and Python run inside the containers.

```bash
git clone https://github.com/ParkHyeonSeong/weave.git
cd weave
cp .env.example .env
make up-build        # builds the images, starts everything, runs DB migrations
```

Open [http://localhost:3000](http://localhost:3000) and follow the setup wizard to create the workspace and the first admin account.

Optional — background push notifications:

```bash
make generate-vapid  # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
# paste them into .env, then re-create the containers so they pick the values up:
make up
```

Everyday commands:

```bash
make up            # start
make down          # stop
make logs          # tail all logs (also: make logs-backend / logs-frontend / logs-db)
make db-shell      # psql into the database
make clean         # stop and delete all data (volumes)
make help          # list every target
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/api/docs — development only (`DEBUG=true`) |
| PostgreSQL | localhost:5432 |

Ports are set in `.env`. That file also says which values the development stack actually reads: the database credentials, `DEBUG` and `LOG_LEVEL` are fixed inside `docker-compose.yml` and only matter in production.

## Production deployment

On a real server the stack is different: it opens **one HTTP port on localhost** (`EXPOSE_PORT`, default 13000), `DEBUG` is off, and the backend refuses to start without real secrets. HTTPS is handled by an nginx on the host in front of it, with a certificate from certbot.

```bash
cp .env.production.example .env.production
# set POSTGRES_PASSWORD (+ DATABASE_URL), JWT_SECRET_KEY, ENCRYPT_KEY, ALLOWED_ORIGINS, NEXT_PUBLIC_API_URL
make prod-build      # build and start; listens on http://127.0.0.1:13000
```

Then put the host nginx in front of it and get a certificate. The step-by-step guide — the nginx block, `certbot`, updates, push notifications — is [DEPLOY.en.md](DEPLOY.en.md) (한국어: [DEPLOY.md](DEPLOY.md)); the finished nginx config looks like [nginx/host-nginx.conf.example](nginx/host-nginx.conf.example).

Minimum: 2 CPU cores, 2 GB RAM, 10 GB disk, Docker 24+.

What is on by default:

- The backend fails to start in production if `JWT_SECRET_KEY`, `ENCRYPT_KEY` or the database password is missing or still the example placeholder
- Rate limits on login, registration and the expensive endpoints; CORS restricted to `ALLOWED_ORIGINS`
- User-submitted HTML is sanitised server-side; uploads are checked by content, not file extension
- URL previews resolve DNS and block private or internal addresses (SSRF)
- SMTP and AI credentials are encrypted at rest; GitHub webhooks are signature-checked
- Security headers are set by the Nginx container, and a per-request Content-Security-Policy by the Next.js middleware

## GitHub App integration

Optional. When on, Weave receives pull-request webhooks from a GitHub App and links PRs to tasks.

- Mention a task in the PR title, body or branch name as `<branch key>-<number>`, e.g. `WV-123`.
- PR opened / reopened / ready for review → the task moves to the Branch's *in progress* status.
- PR merged → *done*. PR closed without merge → back to *todo*, unless another open PR is still linked.
- Branch admins can also add repository links and link PR URLs by hand from a task.

Setup:

1. Create a GitHub App for your organisation with permissions **Metadata: read**, **Pull requests: read**, **Contents: read**, subscribed to **Pull request** events.
2. Set its webhook URL to `https://<your-weave-host>/api/github/webhook`.
3. Put the App ID, webhook secret and private key into `.env` / `.env.production`. The key is the PEM file as one base64 line:

```bash
base64 -w0 your-app.private-key.pem                 # Linux
base64 -i your-app.private-key.pem | tr -d '\n'     # macOS
```

```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=<base64 PEM>
GITHUB_WEBHOOK_SECRET=<webhook secret>
```

Leave all three empty to keep the integration off; webhook requests are then rejected and the backend logs a warning at startup.

## Weave MCP Server

[`mcp/`](mcp/) contains an [MCP](https://modelcontextprotocol.io) server that lets an AI client such as Claude work in Weave — read and change tasks, sprints, epics, issues, docs, tracks, scrum boards and more — through Weave's REST API. It runs locally over stdio and authenticates with a Personal Access Token you create in your profile. No backend changes are needed.

With [`uv`](https://docs.astral.sh/uv/) installed, add this to your MCP client's `.mcp.json`:

```jsonc
{
  "mcpServers": {
    "weave": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/ParkHyeonSeong/weave#subdirectory=mcp", "weave-mcp"],
      "env": {
        "WEAVE_BASE_URL": "https://weave.example.com",
        "WEAVE_API_TOKEN": "wv_your_token_here"
      }
    }
  }
}
```

The tool list (184 tools), the auth model and local development notes are in [mcp/README.md](mcp/README.md).

## Development

```
backend/    FastAPI app, SQLAlchemy models, Alembic migrations, pytest suite
frontend/   Next.js (Pages Router) app, SCSS, vitest suite
mcp/        MCP server (FastMCP) with its own pytest suite
nginx/      Nginx config for the production container, plus a host-proxy example
```

The development stack (`make up-build`) mounts `backend/` and `frontend/` into the containers with hot reload, so edits show up without a rebuild. Run `make up-build` again after changing dependencies.

Running the tests:

```bash
make test-backend    # pytest inside the backend container (installs pytest there on first use)
make test-frontend   # vitest on the host — needs Node 22 (a few parity tests read backend sources and call git, which the container lacks)
make test-mcp        # pytest in mcp/.venv (created, and refreshed when pyproject.toml changes)
make check-docs      # docs ↔ code drift: MCP tool list, licenses, en/ko structure, links
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and the pull-request checklist, and [frontend/README.md](frontend/README.md) (Korean) for frontend details.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (Pages Router), React 19, SCSS, TipTap 3, Yjs, CodeMirror 6, dnd-kit, React Flow, i18next |
| Editor extras | KaTeX + MathJax (math), Mermaid (diagrams), Typst (documents / PDF), marked + `@tiptap/markdown` (markdown) |
| Backend | Python 3.13, FastAPI, SQLAlchemy (async), Alembic, pycrdt (Yjs server) |
| Database | PostgreSQL 17 |
| Auth | JWT in httpOnly cookies (short-lived access + refresh), bcrypt; Personal Access Tokens for the MCP server |
| Real-time | WebSocket for chat, notifications and collaborative editing |
| Notifications | In-app + Web Push (VAPID) |
| Integrations | GitHub App webhooks, Jira CSV import, Anthropic / OpenAI |
| Infra | Docker Compose, Nginx (production); Node 22 and Python 3.13 images |

## License

[MIT](LICENSE). Third-party licenses are listed in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
