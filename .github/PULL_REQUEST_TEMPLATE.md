## What changed and why

## How it was tested
- [ ] backend: `docker compose exec -T backend python -m pytest tests/ -q`
- [ ] frontend: `(cd frontend && npm test)`
- [ ] mcp: `(cd mcp && .venv/bin/pytest)`
- [ ] checked in the browser (what, where):

## Checklist
- [ ] New behaviour has tests
- [ ] Database change → Alembic migration added
- [ ] Config, dependency or user-visible change → docs updated (`README.md` + `README.ko.md`, `.env.example`, `THIRD-PARTY-LICENSES.md`, `mcp/README.md`)
- [ ] User-facing text added to both `frontend/library/i18n/en.js` and `ko.js`
