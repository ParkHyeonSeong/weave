.PHONY: up up-build down restart build logs logs-backend logs-frontend logs-db ps health \
        shell-backend shell-frontend db-shell \
        prod prod-build prod-down prod-logs prod-ps \
        generate-vapid prod-generate-vapid \
        test test-backend test-frontend test-mcp check-docs \
        clean clean-all reset help

# -- Primary commands ------------------------------------------------------

up:                    ## Start all services
	docker compose up -d

up-build:              ## Build and start all services (renews node_modules volume)
	docker compose up -d --build --renew-anon-volumes

down:                  ## Stop all services
	docker compose down

restart:               ## Restart all services (does NOT re-read .env — use `make up` for that)
	docker compose restart

build:                 ## Build all images
	docker compose build

# -- Logs ------------------------------------------------------------------

logs:                  ## Tail logs for all services
	docker compose logs -f

logs-backend:          ## Tail backend logs
	docker compose logs -f backend

logs-frontend:         ## Tail frontend logs
	docker compose logs -f frontend

logs-db:               ## Tail database logs
	docker compose logs -f db

# -- Status ----------------------------------------------------------------

ps:                    ## Show running services
	docker compose ps

health:                ## Check health of all services
	@docker compose ps --format "table {{.Name}}\t{{.Status}}"

# -- Shell access ----------------------------------------------------------

shell-backend:         ## Open shell in backend container
	docker compose exec backend bash

shell-frontend:        ## Open shell in frontend container
	docker compose exec frontend sh

db-shell:              ## Open psql shell
	docker compose exec db psql -U weave -d weave

# -- Tests -----------------------------------------------------------------
# The backend image ships runtime dependencies only, so pytest is installed into the
# running container on first use (again after the container is re-created). It is
# installed by name: `pip install ".[dev]"` fails inside the runtime container because
# /app has several top-level packages (flat-layout).
test-backend:          ## Run backend tests inside the container (installs pytest there on first use)
	docker compose exec -T backend sh -c '{ python -c "import pytest, pytest_asyncio" 2>/dev/null || pip install -q pytest pytest-asyncio; } && python -m pytest tests/ -q'

# Frontend tests run on the host: a few parity tests read backend/ sources and call git,
# neither of which exists in the frontend container. `npm ci` runs when the lockfile is
# newer than npm's own install stamp (node_modules/.package-lock.json), so a pulled
# dependency bump is picked up instead of testing against a stale node_modules.
test-frontend:         ## Run frontend tests on the host (Node 22; npm ci when package-lock.json changed)
	cd frontend && if [ ! node_modules/.package-lock.json -nt package-lock.json ]; then npm ci --legacy-peer-deps; fi && npm test

# Same idea for the MCP venv: reinstall when pyproject.toml is newer than the install stamp.
test-mcp:              ## Run MCP server tests (creates/refreshes mcp/.venv when pyproject.toml changed)
	cd mcp && if [ ! .venv/.installed -nt pyproject.toml ]; then python3 -m venv .venv && .venv/bin/pip install -q -e ".[dev]" && touch .venv/.installed; fi && .venv/bin/pytest -q

test: test-backend test-frontend test-mcp  ## Run all three test suites (make -j3 test runs them in parallel)

check-docs:            ## Check that the docs match the code (MCP tool list, licenses, en/ko structure, links)
	@python3 scripts/check_docs.py

# -- Production ------------------------------------------------------------

PROD_COMPOSE = docker compose --env-file .env.production -f docker-compose.prod.yml

prod:                  ## Start production services (re-creates containers whose config changed)
	$(PROD_COMPOSE) up -d

prod-build:            ## Build and start production services
	$(PROD_COMPOSE) up -d --build

prod-down:             ## Stop production services
	$(PROD_COMPOSE) down

prod-logs:             ## Tail production logs
	$(PROD_COMPOSE) logs -f

prod-ps:               ## Show production service status
	$(PROD_COMPOSE) ps

# -- Utilities -------------------------------------------------------------

# The key script runs inside the backend container (py_vapid lives there) and is piped
# over stdin, so it does not have to exist in the image.
generate-vapid:        ## Generate VAPID key pair for Web Push (dev stack must be running)
	@docker compose exec -T backend python < scripts/generate-vapid-keys.py
	@echo "Add the above values to .env, then run: make up"

prod-generate-vapid:   ## Generate VAPID key pair on the production stack
	@$(PROD_COMPOSE) exec -T backend python < scripts/generate-vapid-keys.py
	@echo "Add the above values to .env.production, then run: make prod"

# -- Cleanup ---------------------------------------------------------------

clean:                 ## Stop services and remove volumes
	docker compose down -v

clean-all:             ## Stop services, remove volumes and images
	docker compose down -v --rmi local

reset:                 ## Full reset: remove everything and rebuild from scratch
	docker compose down -v --rmi local
	docker compose up -d --build

# -- Help ------------------------------------------------------------------

help:                  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
