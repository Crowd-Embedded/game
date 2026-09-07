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
| `/api/v1/player/ws/{client_id}` | WS | Player events; accepts `action` messages to move on the grid |
| `/api/v1/spectator/ws/{spectator_id}` | WS | WebSocket for receiving spectator game events |

Players spawn at a random cell on a 10x10 grid. During play they send
`{"type": "action", "action": "left" | "right" | "up" | "down"}` and the server
broadcasts a `world` snapshot of all player positions after each move.

## Lint & Format

```bash
ruff check .
ruff format .
```