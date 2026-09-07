# 2D Game Frontend — Spectator Display

Plain HTML + JS spectator display for the multiplayer 2D game backend.

## Setup

No setup needed — just a static file server:

```bash
python3 -m http.server 3000
```

Open `http://localhost:3000` in a browser.

The backend must be running on `localhost:8000`.

## What it shows

- Current game code (4 uppercase letters)
- Number of connected players
- Game state: waiting, countdown, playing, ended
- Live 10x10 grid with players as colored dots during play
- On game end: the new game code so players can join the next round