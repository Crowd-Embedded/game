const BASE_URL = 'http://localhost:8000/api/v1';
const WS_BASE_URL = 'ws://localhost:8000/api/v1';

const codeDisplay = document.getElementById('code-display');
const stateDisplay = document.getElementById('state-display');
const timerDisplay = document.getElementById('timer');
const playerCountDisplay = document.getElementById('player-count');
const joinInfo = document.getElementById('join-info');
const joinCode = document.getElementById('join-code');
const connectionStatus = document.getElementById('connection-status');
const worldCanvas = document.getElementById('world');
const worldCtx = worldCanvas.getContext('2d');

let currentState = 'disconnected';
let countdownInterval = null;
let worldState = null;

function setState(state, extra) {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  currentState = state;
  stateDisplay.className = state;
  timerDisplay.classList.add('hidden');
  timerDisplay.textContent = '';
  joinInfo.classList.add('hidden');
  worldCanvas.classList.add('hidden');

  switch (state) {
    case 'waiting':
      if (extra && extra.player_count > 0) {
        stateDisplay.textContent = 'Waiting for more players...';
      } else {
        stateDisplay.textContent = 'Waiting for players...';
      }
      codeDisplay.classList.remove('hidden');
      break;
    case 'countdown':
      stateDisplay.textContent = 'Game starting!';
      break;
    case 'playing':
      stateDisplay.textContent = 'GAME IN PROGRESS';
      codeDisplay.classList.add('hidden');
      joinInfo.classList.add('hidden');
      break;
    case 'ended':
      stateDisplay.textContent = 'Game ended!';
      codeDisplay.classList.add('hidden');
      if (extra && extra.new_code) {
        joinInfo.classList.remove('hidden');
        joinCode.textContent = extra.new_code;
      }
      break;
    case 'disconnected':
      stateDisplay.textContent = 'Connecting...';
      codeDisplay.classList.add('hidden');
      break;
  }
}

function setCode(code) {
  codeDisplay.textContent = code;
  codeDisplay.classList.remove('hidden');
  joinInfo.classList.remove('hidden');
  joinCode.textContent = code;
}

function setPlayerCount(count, max) {
  playerCountDisplay.textContent = `Players: ${count} / ${max}`;
}

function setTimer(seconds) {
  timerDisplay.textContent = seconds;
  timerDisplay.classList.remove('hidden');
}

function drawWorld() {
  const size = worldState.size;
  const cell = worldCanvas.width / size;
  worldCtx.clearRect(0, 0, worldCanvas.width, worldCanvas.height);

  worldCtx.strokeStyle = '#333';
  worldCtx.lineWidth = 1;
  for (let i = 0; i <= size; i++) {
    const p = i * cell;
    worldCtx.beginPath();
    worldCtx.moveTo(p, 0);
    worldCtx.lineTo(p, worldCanvas.height);
    worldCtx.stroke();
    worldCtx.beginPath();
    worldCtx.moveTo(0, p);
    worldCtx.lineTo(worldCanvas.width, p);
    worldCtx.stroke();
  }

  for (const player of worldState.players) {
    worldCtx.beginPath();
    worldCtx.arc(
      (player.x + 0.5) * cell,
      (player.y + 0.5) * cell,
      cell * 0.35,
      0,
      Math.PI * 2
    );
    worldCtx.fillStyle = player.color;
    worldCtx.fill();
  }
}

function startCountdown(seconds) {
  let remaining = seconds;
  setTimer(remaining);
  countdownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      return;
    }
    setTimer(remaining);
  }, 1000);
}

async function showEnded() {
  setState('ended');
  try {
    const resp = await fetch(`${BASE_URL}/code`);
    if (!resp.ok) return;
    const { code } = await resp.json();
    if (code) setState('ended', { new_code: code });
  } catch {
    // leave the ended state without a code; reconnect will refresh it
  }
}

function updateConnectionStatus(connected) {
  connectionStatus.textContent = connected ? 'connected' : 'disconnected';
  connectionStatus.className = connected ? 'connected' : 'disconnected';
}

async function connect() {
  setState('disconnected');
  updateConnectionStatus(false);

  try {
    const resp = await fetch(`${BASE_URL}/spectator/join`, { method: 'POST' });
    if (!resp.ok) throw new Error('spectator join failed');
    const { spectator_id } = await resp.json();
    const ws = new WebSocket(`${WS_BASE_URL}/spectator/ws/${spectator_id}`);
    let reconnectTimer = null;

    ws.onopen = () => {
      updateConnectionStatus(true);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'state':
          setCode(msg.code);
          setPlayerCount(msg.player_count, msg.max_players);
          setState(msg.state, { player_count: msg.player_count });
          break;
        case 'countdown_started':
          setState('countdown');
          startCountdown(msg.time_remaining);
          break;
        case 'game_started':
          setState('playing');
          break;
        case 'world':
          worldState = msg;
          worldCanvas.classList.remove('hidden');
          drawWorld();
          break;
        case 'game_ended':
          showEnded();
          break;
        case 'player_joined':
          setPlayerCount(msg.player_count, 10);
          if (currentState === 'waiting') {
            setState('waiting', { player_count: msg.player_count });
          }
          break;
      }
    };

    ws.onclose = () => {
      updateConnectionStatus(false);
      setState('disconnected');
      reconnectTimer = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  } catch {
    setTimeout(connect, 2000);
  }
}

connect();