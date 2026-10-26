# AGENTS.md

## Commands

- Run: `python main.py`
- Lint: `ruff check .`
- Format: `ruff format .`

## Conventions

- Python 3 with httpx + websockets
- All Python deps in `requirements.txt`
- Setup: `python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
- Connects to `BACKEND_URL` (default `http://localhost:8000/api/v1`)
- Joins via POST `/player/join` with `{"code": ..., "name": ...}` using the optional `PLAYER_NAME`
- While racing, holds "right": sends `{"type": "action", "action": "right"}` every `ACTION_INTERVAL_SECONDS` (default 0.10)
- Logs world-message rate and gaps once a race ends, so throughput can be checked from container logs
- With `PLAYER_LOOP=true` it rejoins after each session (2s backoff on a rejected join) to keep races running unattended
