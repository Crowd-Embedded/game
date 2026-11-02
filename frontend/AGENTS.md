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

- Chase camera on a `<canvas>`: the lens rides `CAMERA_DISTANCE` behind the leader and looks down a perspective highway, so the leader always sits at the same screen depth and racers behind it are nearer, lower and bigger
- Everything is canvas 2-D — `project(worldX, lateral)` is the single projection seam (focal length, depth, sprite scale); there is no 3-D library and no build step
- The sunny palette stays: sun, clouds, mountains, hills and trees above the horizon, grass and a fanned road below; the landscape scrolls with the camera, so it answers to actual progress
- The Finish gate is a real world object drawn at `finish_x`: it fades in as it enters `DRAW_DISTANCE` and grows as the pack closes. There is no reveal trigger, no gate glide-in, and the scenery never freezes
- Racers keep their array-index lane, spread across `LANE_SPAN`, and the first-place racer carries a crown; identity lives in the legend chips only — no name tags on the canvas, and an eliminated chip dims and reads "out"
- A jumping racer is lifted by `y * at.scale`, so the arc grows with the sprite; the shadow stays on the road and shrinks as the racer rises
- `catch_up_distance` arrives in every `world` message and drives the camera, so the display never invents its own idea of where the kill line is
- `world` messages arrive at 30 Hz; the render loop interpolates between the last two snapshots about 100 ms behind the newest one
- Add `?debug=1` to log received message types and the frame rate to the console
