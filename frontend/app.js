const API_HOST = window.RACE_API_HOST || 'http://localhost:8000';
const BASE_URL = `${API_HOST}/api/v1`;
const WS_BASE_URL = `${API_HOST.replace(/^http/, 'ws')}/api/v1`;

// Render this far behind the newest snapshot so jitter never shows.
const INTERP_DELAY_MS = 100;
const FINISH_ENTER_MS = 650;
const ROAD_CENTER = 0.845;
const HORIZON = 0.58;

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
let latestWorld = null;
let currentState = 'disconnected';
let countdownInterval = null;
let gameTimerInterval = null;
let finishVisible = false;
let finishEnter = 0; // 0 = still off the right edge, 1 = parked at the line
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
  finishVisible = false;
  finishEnter = 0;
  updateLegend([]);
}

function pushWorld(data) {
  const now = performance.now();
  snapshots.push({ t: now, data });
  while (snapshots.length > 30) snapshots.shift();
  latestWorld = data;

  const anyFinished = (data.players || []).some((p) => p.finished);
  const leader = leaderX(data);
  if (anyFinished || leader > (data.track_length || 500) * 0.55) {
    if (!finishVisible) finishEnter = 0;
    finishVisible = true;
  }

  updateLegend(data.players || []);
}

function leaderX(world) {
  if (!world || !world.players || !world.players.length) return 0;
  return world.players.reduce((max, p) => Math.max(max, p.x || 0), 0);
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
      const done = p.finished ? ' finished' : '';
      const name = escapeHtml(p.name || p.id.slice(0, 8));
      return `<span class="chip${done}"><span class="chip-rank">${index + 1}</span><span class="chip-dot" style="background:${p.color}"></span>${name}</span>`;
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
}

function worldToScreen(x, track) {
  const padLeft = VIEW.w * 0.04;
  const padRight = VIEW.w * 0.07;
  const usable = VIEW.w - padLeft - padRight;
  return padLeft + (Math.max(0, Math.min(track, x)) / track) * usable;
}

function repeat(offset, span, fn) {
  const start = -span - (offset % span);
  for (let x = start; x < VIEW.w + span; x += span) {
    fn(x);
  }
}

function drawSky() {
  const w = VIEW.w;
  const h = VIEW.h;
  const horizon = h * HORIZON;
  worldCtx.fillStyle = '#8fd4ee';
  worldCtx.fillRect(0, 0, w, horizon);

  // sun
  worldCtx.fillStyle = '#ffe066';
  worldCtx.beginPath();
  worldCtx.arc(w * 0.78, h * 0.16, Math.max(14, h * 0.07), 0, Math.PI * 2);
  worldCtx.fill();

  // distant haze band
  worldCtx.fillStyle = '#b9e3f4';
  worldCtx.fillRect(0, horizon - h * 0.06, w, h * 0.06);
}

function drawClouds(scrollX) {
  const h = VIEW.h;
  const y = h * 0.2;
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
  const baseY = h * HORIZON;
  worldCtx.fillStyle = '#7fa8c9';
  repeat(scrollX * 0.28, 300, (x) => {
    worldCtx.beginPath();
    worldCtx.moveTo(x, baseY);
    worldCtx.lineTo(x + 150, baseY - h * 0.26);
    worldCtx.lineTo(x + 300, baseY);
    worldCtx.closePath();
    worldCtx.fill();
  });
}

function drawHills(scrollX) {
  const h = VIEW.h;
  const baseY = h * HORIZON;
  worldCtx.fillStyle = '#4f9a5c';
  repeat(scrollX * 0.5, 240, (x) => {
    worldCtx.beginPath();
    worldCtx.moveTo(x, baseY);
    worldCtx.quadraticCurveTo(x + 60, baseY - h * 0.16, x + 120, baseY);
    worldCtx.quadraticCurveTo(x + 180, baseY - h * 0.1, x + 240, baseY);
    worldCtx.closePath();
    worldCtx.fill();
  });
}

function drawTrees(scrollX) {
  const h = VIEW.h;
  const baseY = h * HORIZON - h * 0.005;
  repeat(scrollX * 0.68, 150, (x) => {
    const trunkH = h * 0.05;
    const canopy = h * 0.075;
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
  const h = VIEW.h;
  worldCtx.fillStyle = '#6dbf6f';
  worldCtx.fillRect(0, h * HORIZON, VIEW.w, h - h * HORIZON);
}

function drawRoad(scrollX) {
  const h = VIEW.h;
  const top = h * 0.76;
  const bottom = h * 0.95;

  worldCtx.fillStyle = '#8b5a3c';
  worldCtx.fillRect(0, top, VIEW.w, bottom - top);
  worldCtx.fillStyle = '#a9744c';
  worldCtx.fillRect(0, top, VIEW.w, h * 0.02);

  // dashed centre line
  worldCtx.fillStyle = 'rgba(255, 236, 179, 0.85)';
  repeat(scrollX * 1.0, 70, (x) => {
    worldCtx.fillRect(x, (top + bottom) / 2 - 2, 34, 4);
  });

  // roadside posts
  repeat(scrollX * 1.0, 110, (x) => {
    worldCtx.fillStyle = '#f4f6f8';
    worldCtx.fillRect(x, top - h * 0.045, 3, h * 0.045);
    worldCtx.fillStyle = '#ff4d5e';
    worldCtx.fillRect(x, top - h * 0.045, 3, h * 0.014);
  });
}

function drawFinish(track) {
  if (!finishVisible) return;
  const h = VIEW.h;
  const top = h * 0.76;
  const bottom = h * 0.95;
  const width = Math.max(6, VIEW.w * 0.012);

  // Slide the gate in from off-screen instead of letting it blink into place.
  const restX = worldToScreen(track, track);
  const eased = finishEnter * finishEnter * (3 - 2 * finishEnter); // smoothstep
  const x = VIEW.w + width + (restX - VIEW.w - width) * eased;

  const rows = 10;
  const cell = (bottom - top) / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      worldCtx.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#12181f';
      worldCtx.fillRect(x - width / 2 + col * (width / 2), top + row * cell, width / 2, cell);
    }
  }

  // The sign fades up once the gate is nearly parked.
  worldCtx.globalAlpha = Math.max(0, Math.min(1, (finishEnter - 0.55) / 0.45));
  worldCtx.fillStyle = '#12181f';
  worldCtx.font = '600 13px Inter, sans-serif';
  worldCtx.textAlign = 'center';
  worldCtx.fillText('FINISH', x, top - h * 0.145);
  worldCtx.globalAlpha = 1;
}

function drawStart() {
  const h = VIEW.h;
  const top = h * 0.76;
  const bottom = h * 0.95;
  worldCtx.fillStyle = 'rgba(255,255,255,0.55)';
  worldCtx.fillRect(worldToScreen(0, 1), top, 2, bottom - top);
}

function drawPlayer(player, now, index, track, speed, laneY, radius, tagBelow) {
  const h = VIEW.h;
  const x = worldToScreen(player.x || 0, track);
  const baseY = laneY + Math.sin(now / 160 + index) * 2;
  const direction = speed >= 0 ? 1 : -1;
  const speedFactor = Math.min(1, Math.abs(speed) / 0.25);

  // motion trail
  if (speedFactor > 0.05 && !player.finished) {
    for (let i = 3; i >= 1; i -= 1) {
      worldCtx.beginPath();
      worldCtx.arc(x - direction * i * radius * 0.55, baseY, radius * (1 - i * 0.12), 0, Math.PI * 2);
      worldCtx.fillStyle = hexToRgba(player.color, 0.08 * (4 - i));
      worldCtx.fill();
    }
  }

  // shadow
  worldCtx.beginPath();
  worldCtx.ellipse(x, baseY + radius * 0.92, radius * 0.95, radius * 0.32, 0, 0, Math.PI * 2);
  worldCtx.fillStyle = 'rgba(20, 24, 28, 0.28)';
  worldCtx.fill();

  // body with squash & stretch
  const stretch = 1 + speedFactor * 0.12;
  const squash = 1 - speedFactor * 0.08;
  worldCtx.save();
  worldCtx.translate(x, baseY);
  worldCtx.scale(stretch, squash);
  const gradient = worldCtx.createRadialGradient(-radius * 0.35, -radius * 0.4, radius * 0.15, 0, 0, radius);
  gradient.addColorStop(0, lighten(player.color, 0.45));
  gradient.addColorStop(0.55, player.color);
  gradient.addColorStop(1, shade(player.color, 0.25));
  worldCtx.beginPath();
  worldCtx.arc(0, 0, radius, 0, Math.PI * 2);
  worldCtx.fillStyle = gradient;
  worldCtx.fill();
  worldCtx.lineWidth = Math.max(1.5, radius * 0.09);
  worldCtx.strokeStyle = 'rgba(12, 16, 20, 0.75)';
  worldCtx.stroke();

  // eyes
  const eyeR = radius * 0.19;
  const eyeX = direction * radius * 0.16;
  const eyeY = -radius * 0.16;
  worldCtx.fillStyle = '#0c1014';
  worldCtx.beginPath();
  worldCtx.arc(eyeX - radius * 0.22, eyeY, eyeR, 0, Math.PI * 2);
  worldCtx.arc(eyeX + radius * 0.22, eyeY, eyeR, 0, Math.PI * 2);
  worldCtx.fill();
  worldCtx.fillStyle = '#ffffff';
  worldCtx.beginPath();
  worldCtx.arc(eyeX - radius * 0.19, eyeY - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2);
  worldCtx.arc(eyeX + radius * 0.25, eyeY - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2);
  worldCtx.fill();
  worldCtx.restore();

  // name tag: above the top lane, below the others, so tags never sit on a blob
  const label = player.name || player.id.slice(0, 8);
  const tagY = Math.max(14, Math.min(VIEW.h - 8, baseY + (tagBelow ? 1 : -1) * radius * 1.75));
  worldCtx.font = '600 12px Inter, sans-serif';
  worldCtx.textAlign = 'center';
  worldCtx.lineWidth = 3;
  worldCtx.strokeStyle = 'rgba(10, 14, 18, 0.85)';
  worldCtx.strokeText(label, x, tagY);
  worldCtx.fillStyle = player.finished ? '#00ff88' : '#ffffff';
  worldCtx.fillText(label, x, tagY);

  // finishing flourish: a ring marks who already crossed the line
  if (player.finished) {
    worldCtx.beginPath();
    worldCtx.arc(x, baseY, radius * 1.22, 0, Math.PI * 2);
    worldCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    worldCtx.lineWidth = Math.max(2, radius * 0.09);
    worldCtx.stroke();
  }
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

function drawIdleScene() {
  worldCtx.clearRect(0, 0, VIEW.w, VIEW.h);
  drawSky();
  drawClouds(0);
  drawFarMountains(0);
  drawHills(0);
  drawTrees(0);
  drawGround();
  drawRoad(0);
  drawStart();
}

function draw(world, now) {
  worldCtx.clearRect(0, 0, VIEW.w, VIEW.h);
  if (!world) {
    drawIdleScene();
    return;
  }

  const track = world.track_length || 500;
  const leader = leaderX(world);
  // Freeze the landscape once the finish line is in view: only the blobs move.
  const scrollX = finishVisible ? track * 0.55 : leader;

  drawSky();
  drawClouds(scrollX);
  drawFarMountains(scrollX);
  drawHills(scrollX);
  drawTrees(scrollX);
  drawGround();
  drawRoad(scrollX);
  drawStart();
  drawFinish(track);

  const ahead = sampleWorld(now - INTERP_DELAY_MS - 70) || world;
  const prevX = new Map((ahead.players || []).map((p) => [p.id, p.x || 0]));

  const players = world.players || [];
  const count = Math.max(1, players.length);
  // Modest lanes keep every racer visible; labels alternate above/below.
  const band = VIEW.h * 0.24;
  const radius = Math.max(9, Math.min(30, VIEW.h * 0.05, band / (count * 2.2)));
  const laneGap = count > 1 ? Math.min(radius * 2.6, band / (count - 1)) : 0;
  const laneCenter = VIEW.h * ROAD_CENTER;

  players.forEach((player, index) => {
    const before = prevX.get(player.id);
    const delta = before === undefined ? 0 : (player.x || 0) - before;
    const lane = index - (count - 1) / 2;
    drawPlayer(player, now, index, track, delta, laneCenter + lane * laneGap, radius, lane > 0);
  });
}

/* ---------------- frame loop ---------------- */

function frame(now) {
  requestAnimationFrame(frame);

  const dt = lastFrameTime ? now - lastFrameTime : 16;
  lastFrameTime = now;
  if (finishVisible && finishEnter < 1) {
    finishEnter = Math.min(1, finishEnter + dt / FINISH_ENTER_MS);
  }
  if (debug) {
    fpsSamples.push(dt);
    if (fpsSamples.length > 120) {
      const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
      fpsSamples = [];
      console.log(`fps=${(1000 / avg).toFixed(1)} snapshots=${snapshots.length}`);
    }
  }

  const world = sampleWorld(now - INTERP_DELAY_MS);
  draw(world, now);
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
            finishVisible = false;
            finishEnter = 0;
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
          finishVisible = false;
          finishEnter = 0;
          hideWinner();
          break;
        case 'game_started':
          setState('playing');
          joinInfo.classList.add('hidden');
          finishVisible = false;
          finishEnter = 0;
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
