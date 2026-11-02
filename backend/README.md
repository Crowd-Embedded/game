# 2D Game Backend

FastAPI backend with WebSocket support for a multiplayer 2D game.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/v1/code` | GET | Returns current join code |
| `/api/v1/player/join` | POST | Join a game with `{"code": "..."}` |
| `/api/v1/spectator/join` | POST | Register as a spectator, returns `spectator_id` |
| `/api/v1/player/ws/{client_id}` | WS | Player events; accepts `action` messages to move along the Track |
| `/api/v1/spectator/ws/{spectator_id}` | WS | WebSocket for receiving spectator game events |

Players start at the start line and run right along a 1000 px Track on their own. The only
input is `{"type": "action", "action": "jump"}`; the server integrates the run and the jump,
broadcasting a `world` snapshot of all positions (including `y`, the jump height) at 30 Hz.

A chase camera trails the leader by `CAMERA_DISTANCE`; any Player further behind than
that is eliminated (`player_eliminated`, plus an `eliminated` flag in every `world`
snapshot). A race ends at the Finish Line, when a single Player is left, or at the time
limit.

## Lint & Format

```bash
ruff check .
ruff format .
```