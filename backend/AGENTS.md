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
- POST /api/v1/player/join accepts `{"code": "..."}` plus an optional `"name"`; a random name is generated when it is absent and returned with the `client_id`
- POST /api/v1/spectator/join returns spectator_id
- GET /api/v1/debug/state returns the live session (state, players, positions) — dev only
- WS /api/v1/player/ws/{client_id} receives JSON events: countdown_started, game_started, world, game_ended
- WS /api/v1/player/ws/{client_id} accepts `{"type": "action", "action": "left|right|stop|noop"}` during play
- WS /api/v1/spectator/ws/{spectator_id} receives state, countdown_started, game_started, world, game_ended, player_joined
- One spectator socket survives session rotation: it is re-attached to the new session automatically

## Simulation

- The server is authoritative: clients send held-direction input, the server integrates position (`game/actions.py`)
- 60 Hz fixed timestep (`TICK_RATE`), world snapshots broadcast at 30 Hz (`SNAPSHOT_RATE`, an exact tick multiple)
- Input expires after `INPUT_TIMEOUT_SECONDS` without a repeat, so a dropped key stops the player
- A race ends when a player's `x` reaches `FINISH_X`, or at `GAME_DURATION_SECONDS`
- Winning is decided on the server; `game_ended` carries `{id, name, color}` for the winner

## Layout

- `game/config.py` — tunables (speed, track length, rates, names, colours)
- `game/gamesession.py` — tick loop, movement, finish detection, broadcast
- `game/states.py` — WAITING / COUNTDOWN / PLAYING behaviour
- `game/gamemanager.py` — session rotation and the result window
- `api/` — HTTP join endpoints and the player/spectator WebSockets
