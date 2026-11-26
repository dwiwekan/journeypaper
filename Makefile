NODE ?= node
PORT ?= 8000
API_PORT ?= 8080
ENV ?= .env

# Server commands run inside server/.venv. PYTHONPATH is cleared so packages
# installed elsewhere on this machine (for example ROS) cannot leak in.
VENV = server/.venv
PY = env -u PYTHONPATH $(CURDIR)/$(VENV)/bin/python
LOAD_ENV = set -a; . $(CURDIR)/$(ENV); set +a;

.PHONY: web check test test-web test-server venv db-up db-down migrate migrate-prod set-passwords set-passwords-prod check-exposure dev

# Serve the front-end at http://localhost:$(PORT)
web:
	cd web && python3 -m http.server $(PORT)

# Static checks: syntax, imports, layering, CSS order, English comments
check:
	$(NODE) --expose-internals scripts/check-web.mjs

# Unit tests for the DOM-free front-end modules (Node 20+)
test-web: check
	$(NODE) --test tests/web/

# Server tests. Needs the local database: make db-up
test-server:
	$(LOAD_ENV) cd server && $(PY) -m pytest -q

# Everything
test: test-web test-server

# Create server/.venv with the pinned dependencies
venv:
	python3 -m venv $(VENV)
	env -u PYTHONPATH $(VENV)/bin/pip install -q --upgrade pip
	env -u PYTHONPATH $(VENV)/bin/pip install -q -r server/requirements-dev.txt

# Local Postgres 17 on localhost:5433
db-up:
	docker compose up -d --wait db

db-down:
	docker compose down

# Apply migrations to the database in $(ENV) (default .env, the local one)
migrate:
	$(LOAD_ENV) cd server && $(PY) -m alembic upgrade head

# Apply migrations to Supabase, using .env.prod
migrate-prod:
	$(MAKE) migrate ENV=.env.prod

# Set the journey_app and journey_backup passwords from $(ENV). Never prints them.
set-passwords:
	$(LOAD_ENV) cd server && $(PY) -m scripts.set_role_password journey_app JOURNEY_APP_PASSWORD && $(PY) -m scripts.set_role_password journey_backup JOURNEY_BACKUP_PASSWORD

set-passwords-prod:
	$(MAKE) set-passwords ENV=.env.prod

# Check with the publishable key that Supabase exposes no table and sign-up is closed
check-exposure:
	bash scripts/check-supabase-exposure.sh

# Run the API with reload on http://localhost:$(API_PORT)
dev:
	$(LOAD_ENV) cd server && $(PY) -m uvicorn app.main:create_app --factory --reload --port $(API_PORT)
