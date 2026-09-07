# AGENTS.md

## Repository structure

Monorepo with three components: `backend/`, `frontend/`, `client/`. Each has its own `AGENTS.md` and `README.md` with component-specific commands and conventions.

## Lint & Format

```bash
cd backend && ruff check . && ruff format .
cd client && ruff check . && ruff format .
```

## Setup

Each component uses a Python venv:

```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
cd client && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
```

The frontend needs no setup — just a static file server.

Alternatively, backend + frontend can be started with Docker:

```bash
docker compose up --build
```

## Domain language

See [`CONTEXT.md`](CONTEXT.md) for exact term definitions. Key terms: Game Session, Player, Spectator, Game State, Game Code, Game Lifecycle.