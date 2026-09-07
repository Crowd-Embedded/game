# AGENTS.md

## Commands

- Run: `python main.py`
- Lint: `ruff check .`
- Format: `ruff format .`

## Conventions

- Python 3 with httpx + websockets
- All Python deps in `requirements.txt`
- Setup: `python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
- Connects to `localhost:8000` by default
- After `game_started`, sends a random action (`left`/`right`/`up`/`down`/`noop`) every 0.20s
- Exits gracefully when `game_ended` is received