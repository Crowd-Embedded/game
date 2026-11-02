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
- WS /api/v1/player/ws/{client_id} receives JSON events: countdown_started, game_started, world, player_eliminated, game_ended
- WS /api/v1/player/ws/{client_id} accepts `{"type": "action", "action": "jump"}` during play
- WS /api/v1/spectator/ws/{spectator_id} receives state, countdown_started, game_started, world, game_ended, player_joined
- One spectator socket survives session rotation: it is re-attached to the new session automatically

## Simulation

- The server is authoritative: every racer runs forward on its own at `PLAYER_SPEED`, the only input is `jump` (`game/actions.py`)
- Jumping is vertical only for now: `JUMP_VELOCITY` up, `JUMP_GRAVITY` down, no stacking mid-air; a jump pays a small `JUMP_BOOST` to forward speed while airborne, so timing decides the race
- 60 Hz fixed timestep (`TICK_RATE`), world snapshots broadcast at 30 Hz (`SNAPSHOT_RATE`, an exact tick multiple)
- With auto-run nobody spreads out, so the camera kill line is dormant until something can slow a racer down
- A race ends when the winning Player has landed past `FINISH_X` (+40 px), when only one un-eliminated player remains, or at `GAME_DURATION_SECONDS`. Crossing the line only marks a Player `finished`; jumping is then ignored even if a client sends it
- The chase camera is also the kill line (dormant under auto-run): any player more than `CAMERA_DISTANCE` behind the leader is eliminated — frozen, ignored by `apply_action`, flagged `eliminated` in `players_state()`, and announced with `player_eliminated`
- `world` carries `catch_up_distance` so the spectator display never keeps a second copy of that constant
- Winning is decided on the server; `game_ended` carries `{id, name, color}` for the winner

## Layout

- `game/config.py` — tunables (speed, track length, rates, names, colours)
- `game/gamesession.py` — tick loop, movement, finish detection, broadcast
- `game/states.py` — WAITING / COUNTDOWN / PLAYING behaviour
- `game/gamemanager.py` — session rotation and the result window
- `api/` — HTTP join endpoints and the player/spectator WebSockets
