## What changed and why

## How it was tested
- [ ] `make test-backend`
- [ ] `make test-frontend`
- [ ] `make test-mcp`
- [ ] `make check-docs` (when docs, dependencies or MCP tools changed)
- [ ] checked in the browser (what, where):

## Checklist
- [ ] New behaviour has tests
- [ ] Database change → Alembic migration added
- [ ] Config, dependency or user-visible change → docs updated (`README.md` + `README.ko.md`, `DEPLOY.md` + `DEPLOY.en.md`, `.env.example`, `THIRD-PARTY-LICENSES.md`, `mcp/README.md`)
- [ ] User-facing text added to both `frontend/library/i18n/en.js` and `ko.js`
