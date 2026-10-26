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
- Spectator display only — does not join as a player

## Rendering

- Side-view race on a `<canvas>`: scenic parallax background, a road, and round racer blobs
- `world` messages arrive at 30 Hz; the render loop interpolates between the last two snapshots about 100 ms behind the newest one
- Racers are drawn in vertical lanes so identical positions never hide a player; the name tag goes above the top lane and below the others
- The finish line only appears once the leader is past ~55% of the track, and the background stops scrolling then; the gate itself glides in from the right edge (650 ms smoothstep) instead of popping into place
- Parallax layers scroll with the leader's position, so the landscape answers to actual progress
- Add `?debug=1` to log received message types and the frame rate to the console
