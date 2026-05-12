CONDA_ENV ?= DAxolotl
PYTHON ?= conda run -n $(CONDA_ENV) python

.PHONY: install backend frontend dev lint format test test-backend test-frontend clean

install:
	pip install -e ".[dev]"
	cd frontend && npm install

backend:
	uvicorn daxolotl.main:app --reload --host 0.0.0.0 --port 8000 --app-dir backend

frontend:
	cd frontend && npm run dev

# Run backend + frontend concurrently. Ctrl-C kills both.
dev:
	@bash -c 'trap "kill 0" EXIT INT TERM; \
	  (uvicorn daxolotl.main:app --reload --host 0.0.0.0 --port 8000 --app-dir backend) & \
	  (cd frontend && npm run dev) & \
	  wait'

lint:
	ruff check backend
	ruff format --check backend
	cd frontend && npm run lint

format:
	ruff check --fix backend
	ruff format backend
	cd frontend && npm run format

test: test-backend test-frontend

test-backend:
	$(PYTHON) -m pytest

test-frontend:
	cd frontend && npm test

clean:
	rm -rf .pytest_cache .ruff_cache .mypy_cache
	find . -type d -name __pycache__ -exec rm -rf {} +
	rm -rf frontend/dist frontend/.vite
