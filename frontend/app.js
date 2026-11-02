const API_HOST = window.RACE_API_HOST || 'http://localhost:8000';
const BASE_URL = `${API_HOST}/api/v1`;
const WS_BASE_URL = `${API_HOST.replace(/^http/, 'ws')}/api/v1`;

// Render this far behind the newest snapshot so jitter never shows.
const INTERP_DELAY_MS = 100;

// Chase-camera projection. All of this is world pixels; project() turns them
// into screen pixels.
const DEFAULT_CAMERA_DISTANCE = 100; // fallback until catch_up_distance arrives
const HORIZON_FRACTION = 0.46; // where the ground meets the sky
const NEAR_DEPTH = 48; // closest depth still on screen, at the bottom edge
const DRAW_DISTANCE = 780; // depth at which the haze swallows the road
const ROAD_HALF_WIDTH = 56;
const LANE_SPAN = 10; // world px between lane centres
const PLAYER_RADIUS = 4.2; // world px
const DASH_SPAN = 44;
const DASH_LENGTH = 20;
const POST_SPAN = 72;
const GROUND_BAND = 46;
const GATE_FADE_FROM = 75; // the gate's posts dissolve below this depth
const GATE_FADE_SPAN = 55;
const ENDED_DISTANCE = 70; // camera closes in on the winner so they frame low
const CAMERA_EASE_MS = 160;

const codeDisplay = null;
const stateDisplay = document.getElementById('state-display');
const timerDisplay = document.getElementById('timer');
const playerCountDisplay = document.getElementById('player-count');
const joinInfo = document.getElementById('join-info');
const joinCode = document.getElementById('join-code');
const connectionStatus = document.getElementById('connection-status');
const worldCanvas = document.getElementById('world');
const worldCtx = worldCanvas.getContext('2d');
const legendDiv = document.getElementById('legend');
const winnerBanner = document.getElementById('winner-banner');
const stageHint = document.getElementById('stage-hint');

const VIEW = { w: 800, h: 450 };
const snapshots = [];
const camera = {
  x: -DEFAULT_CAMERA_DISTANCE,
  distance: DEFAULT_CAMERA_DISTANCE,
  lens: 1,
};
let focal = 700;
let latestWorld = null;
let currentState = 'disconnected';
let countdownInterval = null;
let gameTimerInterval = null;
let winner = null;
let lastFrameTime = 0;
let currentCode = null;
let fpsSamples = [];
const debug = new URLSearchParams(location.search).has('debug');

/* ---------------- connection ---------------- */

function setState(state) {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (gameTimerInterval && state !== 'playing') {
    clearInterval(gameTimerInterval);
    gameTimerInterval = null;
  }
  currentState = state;
  stateDisplay.className = `state-pill ${state}`;

  switch (state) {
    case 'waiting':
      stateDisplay.textContent = 'Waiting for players';
      break;
    case 'countdown':
      stateDisplay.textContent = 'Starting';
      break;
    case 'playing':
      stateDisplay.textContent = 'Race on';
      break;
    case 'ended':
      stateDisplay.textContent = 'Race ended';
      break;
    default:
      stateDisplay.textContent = 'Connecting';
      break;
  }
  updateStageHint();
}

function updateStageHint() {
  if (!stageHint) return;
  if (currentState === 'waiting') {
    stageHint.textContent = 'Waiting for players to join';
  } else if (currentState === 'countdown') {
    stageHint.textContent = 'Get ready';
  } else if (currentState === 'ended') {
    stageHint.textContent = '';
  } else {
    stageHint.textContent = '';
  }
}

function setPlayerCount(count, max) {
  playerCountDisplay.textContent = `Players ${count}/${max}`;
}

function setTimer(seconds, urgent) {
  timerDisplay.textContent = `${seconds}s`;
  timerDisplay.classList.remove('hidden');
  timerDisplay.classList.toggle('urgent', Boolean(urgent) && seconds <= 10);
}

function startCountdown(seconds) {
  let remaining = seconds;
  setTimer(remaining, false);
  countdownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      timerDisplay.classList.add('hidden');
      return;
    }
    setTimer(remaining, false);
  }, 1000);
}

function startGameTimer(seconds) {
  if (gameTimerInterval) {
    clearInterval(gameTimerInterval);
    gameTimerInterval = null;
  }
  let remaining = seconds;
  setTimer(remaining, false);
  gameTimerInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(gameTimerInterval);
      gameTimerInterval = null;
      setTimer(0, false);
      return;
    }
    setTimer(remaining, true);
  }, 1000);
}

function showWinner(banner) {
  winner = banner;
  if (!banner) {
    winnerBanner.classList.add('hidden');
    return;
  }
  winnerBanner.innerHTML = `WINNER<span class="winner-name" style="color:${banner.color || '#00ff88'}">${banner.name || 'Unknown'}</span><span class="winner-sub">New race starting…</span>`;
  winnerBanner.classList.remove('hidden');
}

function hideWinner() {
  winner = null;
  winnerBanner.classList.add('hidden');
}

/* ---------------- world snapshots ---------------- */

function resetWorld() {
  snapshots.length = 0;
  latestWorld = null;
  updateLegend([]);
}

function pushWorld(data) {
  const now = performance.now();
  snapshots.push({ t: now, data });
  while (snapshots.length > 30) snapshots.shift();
  latestWorld = data;

  updateLegend(data.players || []);
}

function sampleWorld(time) {
  if (!snapshots.length) return latestWorld;
  if (time <= snapshots[0].t) return snapshots[0].data;

  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const a = snapshots[i];
    if (a.t > time) continue;
    const b = snapshots[i + 1];
    if (!b) return a.data;
    const span = b.t - a.t;
    const alpha = span > 0 ? Math.min(1, (time - a.t) / span) : 1;
    return blendWorld(a.data, b.data, alpha);
  }
  return snapshots[0].data;
}

function blendWorld(a, b, alpha) {
  const prev = new Map((a.players || []).map((p) => [p.id, p]));
  const players = (b.players || []).map((pb) => {
    const pa = prev.get(pb.id);
    if (!pa) return pb;
    return {
      ...pb,
      x: pa.x + (pb.x - pa.x) * alpha,
      y: pa.y + (pb.y - pa.y) * alpha,
    };
  });
  return { ...b, players };
}

/* ---------------- legend ---------------- */

function updateLegend(players) {
  if (!legendDiv) return;
  if (!players.length) {
    legendDiv.innerHTML = '<span class="legend-empty">No players yet</span>';
    return;
  }
  const ordered = [...players].sort((a, b) => (b.x || 0) - (a.x || 0));
  legendDiv.innerHTML = ordered
    .map((p, index) => {
      const classes = ['chip'];
      if (p.finished) classes.push('finished');
      if (p.eliminated) classes.push('out');
      const tag = p.eliminated ? '<span class="chip-tag">out</span>' : '';
      const name = escapeHtml(p.name || p.id.slice(0, 8));
      return `<span class="${classes.join(' ')}"><span class="chip-rank">${index + 1}</span><span class="chip-dot" style="background:${p.color}"></span>${name}${tag}</span>`;
    })
    .join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

/* ---------------- canvas ---------------- */

function resizeCanvas() {
  const rect = worldCanvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  worldCanvas.width = Math.max(1, Math.round(rect.width * ratio));
  worldCanvas.height = Math.max(1, Math.round(rect.height * ratio));
  worldCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  VIEW.w = rect.width;
  VIEW.h = rect.height;
  // Vertical field of view: every depth relationship is expressed in canvas heights.
  focal = VIEW.h * 1.55;
}

function horizon() {
  return VIEW.h * HORIZON_FRACTION;
}

// Chase-camera projection: a world x and a lateral offset become a screen
// point plus the scale that keeps a sprite honest at that depth.
function project(worldX, lateral) {
  const depth = Math.max(1e-3, worldX - camera.x);
  const scale = (focal * camera.lens) / depth;
  const rise = (NEAR_DEPTH * camera.lens) / depth;
  return {
    x: VIEW.w / 2 + lateral * scale,
    y: horizon() + (VIEW.h - horizon()) * rise,
    scale,
    depth,
  };
}

function depthFade(depth) {
  return Math.max(0, Math.min(1, (DRAW_DISTANCE - depth) / (DRAW_DISTANCE * 0.3)));
}

function repeat(offset, span, fn) {
  const start = -span - (offset % span);
  for (let x = start; x < VIEW.w + span; x += span) {
    fn(x);
  }
}

/* ---------------- scenery ---------------- */

function drawSky() {
  const w = VIEW.w;
  const h = VIEW.h;
  const ground = horizon();
  const sky = worldCtx.createLinearGradient(0, 0, 0, ground);
  sky.addColorStop(0, '#78c8e8');
  sky.addColorStop(1, '#c8edf9');
  worldCtx.fillStyle = sky;
  worldCtx.fillRect(0, 0, w, ground);

  // sun
  worldCtx.fillStyle = '#ffe066';
  worldCtx.beginPath();
  worldCtx.arc(w * 0.78, h * 0.14, Math.max(14, h * 0.07), 0, Math.PI * 2);
  worldCtx.fill();

  // haze band hugging the horizon
  worldCtx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  worldCtx.fillRect(0, ground - h * 0.035, w, h * 0.035);
}

function drawClouds(scrollX) {
  const h = VIEW.h;
  const y = h * 0.14;
  worldCtx.fillStyle = 'rgba(255,255,255,0.92)';
  repeat(scrollX * 0.12, 360, (x) => {
    const cy = y + Math.sin(x * 0.01) * 8;
    worldCtx.beginPath();
    worldCtx.arc(x, cy, h * 0.045, 0, Math.PI * 2);
    worldCtx.arc(x + h * 0.04, cy - h * 0.02, h * 0.055, 0, Math.PI * 2);
    worldCtx.arc(x + h * 0.09, cy, h * 0.04, 0, Math.PI * 2);
    worldCtx.fill();
  });
}

function drawFarMountains(scrollX) {
  const h = VIEW.h;
  const baseY = horizon();
  worldCtx.fillStyle = '#7fa8c9';
  repeat(scrollX * 0.2, 300, (x) => {
    worldCtx.beginPath();
    worldCtx.moveTo(x, baseY);
    worldCtx.lineTo(x + 150, baseY - h * 0.2);
    worldCtx.lineTo(x + 300, baseY);
    worldCtx.closePath();
    worldCtx.fill();
  });
}

function drawHills(scrollX) {
  const h = VIEW.h;
  const baseY = horizon();
  worldCtx.fillStyle = '#4f9a5c';
  repeat(scrollX * 0.35, 240, (x) => {
    worldCtx.beginPath();
    worldCtx.moveTo(x, baseY);
    worldCtx.quadraticCurveTo(x + 60, baseY - h * 0.14, x + 120, baseY);
    worldCtx.quadraticCurveTo(x + 180, baseY - h * 0.09, x + 240, baseY);
    worldCtx.closePath();
    worldCtx.fill();
  });
}

function drawTrees(scrollX) {
  const h = VIEW.h;
  const baseY = horizon();
  repeat(scrollX * 0.5, 150, (x) => {
    const trunkH = h * 0.045;
    const canopy = h * 0.065;
    worldCtx.fillStyle = '#3d7a48';
    worldCtx.fillRect(x + 10, baseY - trunkH, 5, trunkH);
    worldCtx.beginPath();
    worldCtx.moveTo(x, baseY - trunkH);
    worldCtx.lineTo(x + 12, baseY - trunkH - canopy * 2);
    worldCtx.lineTo(x + 25, baseY - trunkH);
    worldCtx.closePath();
    worldCtx.fill();
  });
}

function drawGround() {
  const top = horizon();
  worldCtx.fillStyle = '#6dbf6f';
  worldCtx.fillRect(0, top, VIEW.w, VIEW.h - top);

  // Mown bands: horizontal strips that stream towards the viewer with the camera.
  worldCtx.fillStyle = 'rgba(255, 255, 255, 0.055)';
  const bandStart = Math.floor(camera.x / GROUND_BAND) * GROUND_BAND;
  for (let x = bandStart; x < camera.x + DRAW_DISTANCE; x += GROUND_BAND) {
    const a = project(x, 0);
    const b = project(x + GROUND_BAND / 2, 0);
    const top0 = Math.max(top, Math.min(a.y, b.y));
    const bottom0 = Math.min(VIEW.h, Math.max(a.y, b.y));
    if (bottom0 - top0 < 0.5) continue;
    worldCtx.fillRect(0, top0, VIEW.w, bottom0 - top0);
  }
}

/* ---------------- road ---------------- */

function laneOf(index, count) {
  return (index - (count - 1) / 2) * LANE_SPAN;
}

function laneBoundaries(count) {
  const boundaries = [];
  for (let i = 0; i < count - 1; i += 1) {
    boundaries.push((i + 1 - count / 2) * LANE_SPAN);
  }
  return boundaries;
}

function drawRoad() {
  const near = project(camera.x + NEAR_DEPTH * 0.8, 0);
  const far = project(camera.x + DRAW_DISTANCE, 0);
  const nearHalf = ROAD_HALF_WIDTH * near.scale;
  const farHalf = ROAD_HALF_WIDTH * far.scale;
  const bottom = Math.max(VIEW.h * 1.4, near.y);
  const centre = VIEW.w / 2;

  worldCtx.beginPath();
  worldCtx.moveTo(centre - farHalf, far.y);
  worldCtx.lineTo(centre + farHalf, far.y);
  worldCtx.lineTo(centre + nearHalf, bottom);
  worldCtx.lineTo(centre - nearHalf, bottom);
  worldCtx.closePath();
  const tarmac = worldCtx.createLinearGradient(0, horizon(), 0, VIEW.h);
  tarmac.addColorStop(0, '#6b4630');
  tarmac.addColorStop(1, '#a9744c');
  worldCtx.fillStyle = tarmac;
  worldCtx.fill();

  // painted edges
  worldCtx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
  worldCtx.lineWidth = 2;
  for (const side of [-1, 1]) {
    const a = project(camera.x + NEAR_DEPTH * 0.8, side * (ROAD_HALF_WIDTH - 2));
    const b = project(camera.x + DRAW_DISTANCE, side * (ROAD_HALF_WIDTH - 2));
    worldCtx.beginPath();
    worldCtx.moveTo(a.x, a.y);
    worldCtx.lineTo(b.x, b.y);
    worldCtx.stroke();
  }
}

function drawMarkings(count) {
  const farEdge = camera.x + DRAW_DISTANCE;

  // lane dividers, so the highway reads as lanes from the first frame
  worldCtx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  worldCtx.lineWidth = 2;
  laneBoundaries(count).forEach((lateral) => {
    const a = project(camera.x + NEAR_DEPTH * 0.9, lateral);
    const b = project(farEdge, lateral);
    worldCtx.beginPath();
    worldCtx.moveTo(a.x, a.y);
    worldCtx.lineTo(b.x, b.y);
    worldCtx.stroke();
  });

  // centre dashes, streaming towards the viewer
  const dashStart = Math.floor(camera.x / DASH_SPAN) * DASH_SPAN;
  for (let x = dashStart; x <= farEdge; x += DASH_SPAN) {
    if (x + DASH_LENGTH - camera.x < NEAR_DEPTH * 0.8) continue;
    const a = project(x, 0);
    const b = project(x + DASH_LENGTH, 0);
    worldCtx.beginPath();
    worldCtx.strokeStyle = 'rgba(255, 236, 179, 0.85)';
    worldCtx.lineWidth = Math.max(1, 1.6 * a.scale);
    worldCtx.moveTo(a.x, a.y);
    worldCtx.lineTo(b.x, b.y);
    worldCtx.stroke();
  }

  // roadside posts
  const postStart = Math.floor(camera.x / POST_SPAN) * POST_SPAN;
  for (let x = postStart; x <= farEdge; x += POST_SPAN) {
    for (const side of [-1, 1]) {
      const base = project(x, side * (ROAD_HALF_WIDTH + 5));
      const alpha = depthFade(base.depth);
      if (base.depth < NEAR_DEPTH * 0.9 || base.depth > 420 || alpha <= 0.02) continue;
      const height = Math.max(2, 10 * base.scale);
      const width = Math.max(1, 1.8 * base.scale);
      worldCtx.fillStyle = `rgba(244, 246, 248, ${alpha * 0.9})`;
      worldCtx.fillRect(base.x - width / 2, base.y - height, width, height);
      worldCtx.fillStyle = `rgba(255, 77, 94, ${alpha * 0.9})`;
      worldCtx.fillRect(base.x - width / 2, base.y - height, width, height * 0.32);
    }
  }
}

function drawCheckeredBand(x0, x1, columns, rows, alpha) {
  if (alpha <= 0.02) return;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const latA = -ROAD_HALF_WIDTH + (2 * ROAD_HALF_WIDTH * col) / columns;
      const latB = -ROAD_HALF_WIDTH + (2 * ROAD_HALF_WIDTH * (col + 1)) / columns;
      const xA = x0 + ((x1 - x0) * row) / rows;
      const xB = x0 + ((x1 - x0) * (row + 1)) / rows;
      const a = project(xA, latA);
      const b = project(xA, latB);
      const c = project(xB, latB);
      const d = project(xB, latA);
      if (Math.min(a.depth, b.depth, c.depth, d.depth) < NEAR_DEPTH * 0.7) continue;
      worldCtx.beginPath();
      worldCtx.moveTo(a.x, a.y);
      worldCtx.lineTo(b.x, b.y);
      worldCtx.lineTo(c.x, c.y);
      worldCtx.lineTo(d.x, d.y);
      worldCtx.closePath();
      worldCtx.fillStyle =
        (row + col) % 2 === 0
          ? `rgba(255, 255, 255, ${alpha})`
          : `rgba(18, 24, 31, ${alpha})`;
      worldCtx.fill();
    }
  }
}

function drawStartLine() {
  const depth = 0 - camera.x;
  // It slides under the lens as the pack leaves, so fade it out on the way past.
  const alpha = 0.9 * Math.max(0, Math.min(1, (depth - 60) / 100));
  drawCheckeredBand(0, 11, 12, 3, alpha);
}

function drawFinish(finishX) {
  const depth = finishX - camera.x;
  if (depth < NEAR_DEPTH || depth > DRAW_DISTANCE) return;
  const alpha = depthFade(depth);

  drawCheckeredBand(finishX, finishX + 10, 10, 2, alpha);

  // Once the camera is level with the gate we are passing under it; the posts
  // would throw two clipped bars against the screen edges, so they dissolve on
  // the way in and only the checkered line remains underfoot.
  const gateAlpha = alpha * Math.min(1, Math.max(0, (depth - GATE_FADE_FROM) / GATE_FADE_SPAN));
  if (gateAlpha <= 0.02) return;

  for (const side of [-1, 1]) {
    const base = project(finishX, side * (ROAD_HALF_WIDTH + 6));
    const height = 34 * base.scale;
    const width = Math.max(2, 3 * base.scale);
    worldCtx.fillStyle = `rgba(244, 246, 248, ${gateAlpha})`;
    worldCtx.fillRect(base.x - width / 2, base.y - height, width, height);
    worldCtx.fillStyle = `rgba(255, 77, 94, ${gateAlpha})`;
    worldCtx.fillRect(base.x - width / 2, base.y - height, width, height * 0.18);
  }

  const sign = project(finishX, 0);
  const size = Math.max(8, Math.min(26, 12 * sign.scale));
  worldCtx.font = `600 ${size}px Inter, sans-serif`;
  worldCtx.textAlign = 'center';
  worldCtx.fillStyle = `rgba(18, 24, 31, ${gateAlpha})`;
  const signY = Math.max(size * 1.15, sign.y - 34 * sign.scale - size * 0.6);
  worldCtx.fillText('FINISH', sign.x, signY);
}

function drawHaze() {
  const top = horizon();
  const bottom = top + VIEW.h * 0.06;
  const fog = worldCtx.createLinearGradient(0, top, 0, bottom);
  fog.addColorStop(0, 'rgba(200, 237, 249, 0.8)');
  fog.addColorStop(1, 'rgba(200, 237, 249, 0)');
  worldCtx.fillStyle = fog;
  worldCtx.fillRect(0, top, VIEW.w, bottom - top);
}

/* ---------------- racers ---------------- */

function drawRacer(player, index, count, now, delta) {
  const at = project(player.x || 0, laneOf(index, count));
  const radius = PLAYER_RADIUS * at.scale;
  if (at.depth < NEAR_DEPTH * 0.6 || at.y - radius > VIEW.h * 1.08) return;

  const speedFactor = Math.min(1, Math.abs(delta) / 5);
  const direction = delta >= 0 ? 1 : -1;
  const bob = Math.sin(now / 160 + index) * radius * 0.12;

  // Trail: behind is nearer the lens, so the ghosts sit lower and larger.
  if (speedFactor > 0.08 && !player.finished) {
    for (let i = 3; i >= 1; i -= 1) {
      const ghost = project(
        (player.x || 0) - direction * i * PLAYER_RADIUS * 1.5,
        laneOf(index, count)
      );
      if (ghost.depth < NEAR_DEPTH * 0.6) continue;
      worldCtx.beginPath();
      worldCtx.arc(
        ghost.x,
        ghost.y + bob,
        PLAYER_RADIUS * ghost.scale * (1 - i * 0.12),
        0,
        Math.PI * 2
      );
      worldCtx.fillStyle = hexToRgba(player.color, 0.1 * (4 - i));
      worldCtx.fill();
    }
  }

  // shadow
  worldCtx.beginPath();
  worldCtx.ellipse(at.x, at.y + radius * 0.86, radius * 1.05, radius * 0.3, 0, 0, Math.PI * 2);
  worldCtx.fillStyle = 'rgba(20, 24, 28, 0.26)';
  worldCtx.fill();

  // body: seen from behind, so it stretches into the screen with speed
  worldCtx.save();
  worldCtx.translate(at.x, at.y + bob);
  worldCtx.scale(1 - speedFactor * 0.07, 1 + speedFactor * 0.11);
  const gradient = worldCtx.createRadialGradient(
    -radius * 0.35,
    -radius * 0.4,
    radius * 0.15,
    0,
    0,
    radius
  );
  gradient.addColorStop(0, lighten(player.color, 0.45));
  gradient.addColorStop(0.55, player.color);
  gradient.addColorStop(1, shade(player.color, 0.25));
  worldCtx.beginPath();
  worldCtx.arc(0, 0, radius, 0, Math.PI * 2);
  worldCtx.fillStyle = gradient;
  worldCtx.fill();
  worldCtx.lineWidth = Math.max(1.2, radius * 0.1);
  worldCtx.strokeStyle = 'rgba(12, 16, 20, 0.75)';
  worldCtx.stroke();

  // sun-side rim light
  worldCtx.beginPath();
  worldCtx.arc(0, 0, radius * 0.86, -Math.PI * 0.85, -Math.PI * 0.35);
  worldCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  worldCtx.lineWidth = Math.max(1, radius * 0.13);
  worldCtx.stroke();
  worldCtx.restore();

  if (player.finished) {
    worldCtx.beginPath();
    worldCtx.arc(at.x, at.y + bob, radius * 1.2, 0, Math.PI * 2);
    worldCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    worldCtx.lineWidth = Math.max(2, radius * 0.1);
    worldCtx.stroke();
  }
}

function drawLeaderCrown(player, index, count) {
  const at = project(player.x || 0, laneOf(index, count));
  const radius = PLAYER_RADIUS * at.scale;
  if (at.depth < NEAR_DEPTH * 0.6) return;
  const size = Math.max(5, radius * 0.55);
  const y = at.y - radius * 1.15;
  worldCtx.beginPath();
  worldCtx.moveTo(at.x, y);
  worldCtx.lineTo(at.x + size, y - size);
  worldCtx.lineTo(at.x - size, y - size);
  worldCtx.closePath();
  worldCtx.fillStyle = '#ffcc00';
  worldCtx.fill();
  worldCtx.lineWidth = Math.max(1.2, size * 0.14);
  worldCtx.strokeStyle = 'rgba(12, 16, 20, 0.7)';
  worldCtx.stroke();
}

function drawSpeedLines(player, index, count, speedFactor) {
  if (speedFactor < 0.45) return;
  const at = project(player.x || 0, laneOf(index, count));
  const radius = PLAYER_RADIUS * at.scale;
  if (at.depth < NEAR_DEPTH * 0.6) return;
  worldCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  worldCtx.lineWidth = Math.max(1, radius * 0.07);
  worldCtx.lineCap = 'round';
  for (let i = 0; i < 4; i += 1) {
    const spread = (i - 1.5) * radius * 0.8;
    const from = at.y + radius * 1.05;
    const to = from + radius * (1.1 + 0.25 * i);
    worldCtx.beginPath();
    worldCtx.moveTo(at.x + spread, from);
    worldCtx.lineTo(at.x + spread * 1.4, to);
    worldCtx.stroke();
  }
  worldCtx.lineCap = 'butt';
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const int = parseInt(full, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lighten(hex, amount) {
  return adjust(hex, amount);
}

function shade(hex, amount) {
  return adjust(hex, -amount);
}

function adjust(hex, amount) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const int = parseInt(full, 16);
  const channel = (value) => {
    const next = amount >= 0 ? value + (255 - value) * amount : value * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(next)));
  };
  const r = channel((int >> 16) & 255);
  const g = channel((int >> 8) & 255);
  const b = channel(int & 255);
  return `rgb(${r}, ${g}, ${b})`;
}

/* ---------------- the shot ---------------- */

function draw(world, now, dt) {
  worldCtx.clearRect(0, 0, VIEW.w, VIEW.h);

  const players = (world && world.players) || [];
  const finishX = (world && world.finish_x) || 500;
  const travelled = players.reduce((max, p) => Math.max(max, p.x || 0), 0);
  const ended = currentState === 'ended' && players.length > 0;

  // The camera rides CAMERA_DISTANCE behind the leader, or parks behind the
  // start line while there is nobody to follow.
  const wanted = (world && world.catch_up_distance) || DEFAULT_CAMERA_DISTANCE;
  const targetDistance = ended ? Math.min(wanted, ENDED_DISTANCE) : wanted;
  camera.distance += (targetDistance - camera.distance) * Math.min(1, dt / CAMERA_EASE_MS);
  camera.x = (players.length ? travelled : 0) - camera.distance;

  const ahead = sampleWorld(now - INTERP_DELAY_MS - 70);
  const prevX = new Map(((ahead && ahead.players) || []).map((p) => [p.id, p.x || 0]));
  let fastest = 0;
  players.forEach((player) => {
    const before = prevX.get(player.id);
    if (before !== undefined) fastest = Math.max(fastest, Math.abs((player.x || 0) - before));
  });
  const speedFactor = Math.min(1, fastest / 5);
  camera.lens = 1 - 0.05 * speedFactor;

  drawSky();
  drawClouds(camera.x);
  drawFarMountains(camera.x);
  drawHills(camera.x);
  drawTrees(camera.x);
  drawGround();
  drawRoad();
  drawMarkings(players.length);
  drawStartLine();
  drawFinish(finishX);
  drawHaze();

  // Far lanes first, so the nearest racer always wins an overlap.
  const order = players
    .map((player, index) => ({ player, index }))
    .sort((a, b) => (b.player.x || 0) - (a.player.x || 0));
  order.forEach(({ player, index }) => {
    const before = prevX.get(player.id);
    const delta = before === undefined ? 0 : (player.x || 0) - before;
    drawRacer(player, index, players.length, now, delta);
  });

  if (players.length > 1) {
    const leaderIndex = players.reduce(
      (best, p, i) => ((p.x || 0) > (players[best].x || 0) ? i : best),
      0
    );
    const leader = players[leaderIndex];
    if ((leader.x || 0) > 4) {
      drawLeaderCrown(leader, leaderIndex, players.length);
      drawSpeedLines(leader, leaderIndex, players.length, speedFactor);
    }
  }
}

/* ---------------- frame loop ---------------- */

function frame(now) {
  requestAnimationFrame(frame);

  const dt = lastFrameTime ? now - lastFrameTime : 16;
  lastFrameTime = now;
  if (debug) {
    fpsSamples.push(dt);
    if (fpsSamples.length > 120) {
      const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
      fpsSamples = [];
      console.log(`fps=${(1000 / avg).toFixed(1)} snapshots=${snapshots.length}`);
    }
  }

  const world = sampleWorld(now - INTERP_DELAY_MS);
  draw(world, now, dt);
}

/* ---------------- websocket ---------------- */

async function connect() {
  setState('disconnected');
  connectionStatus.textContent = 'offline';
  connectionStatus.className = 'connection-status disconnected';

  try {
    const resp = await fetch(`${BASE_URL}/spectator/join`, { method: 'POST' });
    if (!resp.ok) throw new Error('spectator join failed');
    const { spectator_id } = await resp.json();
    const ws = new WebSocket(`${WS_BASE_URL}/spectator/ws/${spectator_id}`);

    ws.onopen = () => {
      connectionStatus.textContent = 'live';
      connectionStatus.className = 'connection-status connected';
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (debug) {
        console.log(
          `msg ${msg.type} state=${msg.state ?? '-'} players=${msg.player_count ?? (msg.players ? msg.players.length : '-')}`
        );
      }

      switch (msg.type) {
        case 'state': {
          const newSession = Boolean(msg.code) && msg.code !== currentCode;
          if (newSession) {
            currentCode = msg.code;
            // Drop the finished race so nobody lingers at the old finish line.
            resetWorld();
            hideWinner();
          }
          setPlayerCount(msg.player_count, msg.max_players);
          if (msg.state === 'waiting') {
            setState('waiting');
            joinCode.textContent = msg.code;
            joinInfo.classList.remove('hidden');
          } else {
            setState(msg.state);
            joinInfo.classList.add('hidden');
          }
          break;
        }
        case 'countdown_started':
          setState('countdown');
          startCountdown(msg.time_remaining);
          hideWinner();
          break;
        case 'game_started':
          setState('playing');
          joinInfo.classList.add('hidden');
          hideWinner();
          if (msg.time_remaining !== undefined) {
            startGameTimer(msg.time_remaining);
          }
          break;
        case 'world':
          pushWorld(msg);
          break;
        case 'game_ended':
          if (gameTimerInterval) {
            clearInterval(gameTimerInterval);
            gameTimerInterval = null;
          }
          timerDisplay.classList.add('hidden');
          setState('ended');
          joinInfo.classList.add('hidden');
          showWinner(msg.winner);
          break;
        case 'player_joined':
          setPlayerCount(msg.player_count, 10);
          if (currentState === 'waiting') {
            setState('waiting');
          }
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      connectionStatus.textContent = 'offline';
      connectionStatus.className = 'connection-status disconnected';
      setState('disconnected');
      setTimeout(connect, 2000);
    };

    ws.onerror = () => ws.close();
  } catch {
    setTimeout(connect, 2000);
  }
}

/* ---------------- boot ---------------- */

resizeCanvas();
window.addEventListener('resize', resizeCanvas);
requestAnimationFrame(frame);
updateLegend([]);
connect();
