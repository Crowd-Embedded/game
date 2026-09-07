# AGENTS.md

## Commands

- Run server: `uvicorn main:app --reload --host 0.0.0.0 --port 8000`
- Lint: `ruff check .`
- Format: `ruff format .`

## Conventions

- Python 3 with FastAPI + uvicorn
- All Python deps in `requirements.txt`
- Setup: `python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
- Game codes are 4 uppercase letters
- POST /api/v1/player/join accepts `{"code": "..."}`, returns client_id
- POST /api/v1/spectator/join returns spectator_id
- WS /api/v1/player/ws/{client_id} receives JSON events: countdown_started, game_started, world, game_ended
- WS /api/v1/player/ws/{client_id} accepts `{"type": "action", "action": "left|right|up|down"}` during play
- WS /api/v1/spectator/ws/{spectator_id} receives state, countdown_started, game_started, world, game_ended, player_joined
- Players spawn at a random cell on a 10x10 grid and cannot move outside it
- First joiner starts a 5s countdown, max 10 players, game lasts 10s
- New game code generated automatically when current game ends