# AGENTS.md

## Commands

- Run server: `python3 -m http.server 3000`
- Open: `http://localhost:3000`

## Conventions

- Plain HTML + vanilla JS, no frameworks or build tools
- Three files: `index.html`, `styles.css`, `app.js`
- Joins as a spectator: POST `/api/v1/spectator/join`, then WS `/api/v1/spectator/ws/{spectator_id}`
- Backend must be running on port 8000
- CORS is handled by the backend (allow all origins in dev)
- Auto-reconnects on disconnect (2s delay)
- Renders the 10x10 grid and player dots on a `<canvas>` from `world` messages
- Spectator display only — does not join as a player