# 2D Game

Multiplayer 2D game monorepo with three components:

- **`backend/`** — FastAPI game server (Python). Runs the Game Lifecycle, accepts Player and Spectator WebSocket connections.
- **`frontend/`** — Spectator display (vanilla HTML + JS). Connects as a read-only observer via WebSocket.
- **`client/`** — Player CLI client (Python). Joins games and prints events to the terminal.

## Quick start

### Docker

```bash
docker compose up --build
# Spectator display: http://localhost:3000
```

Then run the player client (Terminal):

```bash
cd client
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
python main.py
```

`docker compose up` also starts two scripted players (`client1`, `client2`) so a race
starts on its own; watch them with `docker compose logs -f client1 client2`.

### Manual

```bash
# Terminal 1 — start the backend
cd backend
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 — open the spectator display
cd frontend && python3 -m http.server 3000
# Open http://localhost:3000

# Terminal 3 — join as a player
cd client
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
python main.py
```

## How it works

A Game Session cycles through WAITING → COUNTDOWN → PLAYING → ENDED. Players join with a 4-letter Game Code fetched via HTTP and race left-to-right along a Track; the first Player to reach the Finish Line wins, capped by the time limit. The winner is shown for a few seconds, then a new code is generated for the next session. Spectators keep one socket and follow the rotation, so the display never has to reconnect.

See [`CONTEXT.md`](CONTEXT.md) for the domain glossary.