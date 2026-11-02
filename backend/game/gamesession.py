import asyncio
import os
import time

from fastapi import WebSocket

from game import actions, messages
from game.config import (
    CAMERA_DISTANCE,
    COUNTDOWN_SECONDS,
    FINISH_X,
    GAME_DURATION_SECONDS,
    JUMP_GRAVITY,
    JUMP_VELOCITY,
    MAX_PLAYERS,
    OBSTACLE_SLOW_FACTOR,
    OBSTACLE_SLOW_SECONDS,
    PLAYER_COLORS,
    PLAYER_SPEED,
    SNAPSHOT_RATE,
    TICK_RATE,
    START_X,
    TICK_INTERVAL,
    generate_name,
)
from game.gamestate import GameState
from game.participant import ParticipantSet, Player, Spectator
from game.states import STATES, StateBehavior


class GameSession:
    def __init__(
        self,
        code: str,
        states: dict[GameState, StateBehavior] | None = None,
        clock=time.monotonic,
    ):
        self.code = code
        self._states = STATES if states is None else states
        self._clock = clock
        self._players = ParticipantSet(Player)
        self._spectators = ParticipantSet(Spectator)
        self._join_lock = asyncio.Lock()
        self._state = GameState.WAITING
        self._countdown_started_at: float | None = None
        self._game_started_at: float | None = None
        self._game_task: asyncio.Task | None = None
        self._tick_task: asyncio.Task | None = None
        self.finished = asyncio.Event()
        self._winner: dict | None = None
        self._finishing: bool = False
        self._obstacles: list[list[int]] = []

    def prepare_obstacles(self) -> None:
        import random

        count = 4
        lanes = max(1, self.player_count)
        self._obstacles = []
        for _ in range(lanes):
            positions: set[int] = set()
            attempts = 0
            while len(positions) < count and attempts < 400:
                attempts += 1
                x = random.randint(100, 900)
                if all(abs(x - p) >= 60 for p in positions):
                    positions.add(x)
            self._obstacles.append(sorted(positions))

    @property
    def obstacles(self) -> list[list[int]]:
        return self._obstacles

    @property
    def state(self) -> GameState:
        return self._state

    @property
    def player_count(self) -> int:
        return len(self._players)

    @property
    def spectators(self) -> ParticipantSet:
        return self._spectators

    @property
    def winner(self) -> dict | None:
        return self._winner

    @property
    def game_task_done(self) -> bool | None:
        return self._game_task.done() if self._game_task else None

    @property
    def tick_task_done(self) -> bool | None:
        return self._tick_task.done() if self._tick_task else None

    def full(self) -> bool:
        return self.player_count >= MAX_PLAYERS

    def has_player(self, client_id: str) -> bool:
        return self._players.contains(client_id)

    async def add_player(self, client_id: str, name: str | None = None) -> Player:
        async with self._join_lock:
            next_state = await self._states[self._state].on_join(self, client_id, name)
            if next_state is not None:
                await self._enter(next_state)
            player = self._players.get(client_id)
            return player

    async def _enter(self, state: GameState):
        self._state = state
        if os.environ.get("RACE_DEBUG") == "1":
            print(f"[perf] state={state.value} code={self.code}", flush=True)
        await self._states[state].enter(self)
        if state is GameState.COUNTDOWN and self._game_task is None:
            self._game_task = asyncio.create_task(self._run())

    async def _run(self):
        try:
            while self._state in (GameState.COUNTDOWN, GameState.PLAYING):
                next_state = await self._states[self._state].run(self)
                if next_state is None:
                    break
                await self._enter(next_state)
        except Exception:  # noqa: BLE001 - never leave a session stuck mid-lifecycle
            import logging

            logging.getLogger("race.session").exception("state machine failed")
        finally:
            self.finished.set()

    def register_player(self, client_id: str, name: str | None = None) -> Player:
        color = PLAYER_COLORS[len(self._players) % len(PLAYER_COLORS)]
        if not name:
            name = generate_name()
        return self._players.add(client_id, color=color, name=name)

    def attach_player(self, client_id: str, websocket: WebSocket):
        self._players.attach(client_id, websocket)

    def detach_player(self, client_id: str):
        self._players.detach(client_id)

    def attach_spectator(self, spectator_id: str, websocket: WebSocket):
        # A spectator follows sessions, so it may arrive before this session knows it.
        participant = self._spectators.get(spectator_id)
        if participant is None:
            participant = self._spectators.add(spectator_id)
        participant.attach(websocket)

    def detach_spectator(self, spectator_id: str):
        self._spectators.detach(spectator_id)

    def players_state(self) -> list[dict]:
        result = []
        for player in self._players:
            result.append(
                {
                    "id": player.participant_id,
                    "name": getattr(player, "name", ""),
                    "x": player.x,
                    "y": player.y,
                    "color": player.color,
                    "finished": getattr(player, "finished", False),
                    "eliminated": getattr(player, "eliminated", False),
                    "slow": getattr(player, "slow_timer", 0.0) > 0,
                }
            )
        return result

    async def apply_action(self, client_id: str, action: str) -> None:
        """Record input intent. Movement happens in the fixed-timestep loop."""
        if self._state is not GameState.PLAYING:
            return
        if self._winner is not None:
            return
        player = self._players.get(client_id)
        if player is None or player.finished or player.eliminated:
            return
        if not actions.is_jump(action):
            return
        if player.y > 0 or player.vy > 0:
            return  # already in the air; a jump cannot stack
        player.vy = JUMP_VELOCITY

    def start_game_loop(self):
        if self._tick_task is None or self._tick_task.done():
            self._tick_task = asyncio.create_task(self._game_loop())

    async def _game_loop(self):
        """Fixed-timestep simulation; snapshots go out on an exact tick multiple."""
        snapshot_every = max(1, round(TICK_RATE / SNAPSHOT_RATE))
        now = self._clock()
        last = now
        next_tick = now + TICK_INTERVAL
        debug = os.environ.get("RACE_DEBUG") == "1"
        ticks = 0
        snapshots_sent = 0
        loop_started = now
        report_at = now + 2.0
        iter_time = 0.0
        send_time = 0.0
        while self._state == GameState.PLAYING:
            delay = next_tick - self._clock()
            if delay > 0:
                await asyncio.sleep(delay)
            now = self._clock()
            # Clamp dt so a stalled loop cannot teleport players.
            dt = min(now - last, 0.25)
            last = now
            next_tick += TICK_INTERVAL
            if next_tick < now:
                next_tick = now + TICK_INTERVAL
            ticks += 1

            dropped = self._step_players(dt)
            for player in dropped:
                await self.broadcast(
                    messages.player_eliminated(player.participant_id, player.name)
                )
            if self._winner is not None:
                # Keep simulating so the winner can land past the finish line.
                pass
            if dropped:
                standing = [p for p in self._players if not p.eliminated and not p.finished]
                if len(standing) == 1:
                    # Everyone else fell out of frame: the last one standing wins.
                    last = standing[0]
                    if self._winner is None:
                        self._winner = {
                            "id": last.participant_id,
                            "name": last.name,
                            "color": last.color,
                        }

            if ticks % snapshot_every == 0:
                snapshots_sent += 1
                send_started = self._clock()
                await self.broadcast(messages.world(self.players_state(), self._obstacles))
                send_time += self._clock() - send_started

            iter_time += self._clock() - now

            if debug:
                held = self._clock() - now
                if held > 0.1:
                    leader_x = max((p["x"] for p in self.players_state()), default=0.0)
                    print(
                        f"[perf] stall {held * 1000:.0f}ms at x={leader_x:.0f}",
                        flush=True,
                    )

            if debug and now >= report_at:
                window = 2.0
                print(
                    f"[perf] tick_hz={ticks / window:.1f} "
                    f"snapshot_hz={snapshots_sent / window:.1f} "
                    f"iter_ms={iter_time / max(1, ticks) * 1000:.2f} "
                    f"send_ms={send_time / max(1, snapshots_sent) * 1000:.2f} "
                    f"players={self.player_count} "
                    f"spectators={len(self._spectators)}",
                    flush=True,
                )
                ticks = 0
                snapshots_sent = 0
                iter_time = 0.0
                send_time = 0.0
                report_at = now + window

        if debug:
            elapsed = max(1e-6, now - loop_started)
            print(
                f"[perf] race_end ticks={ticks + (0)} snapshot_hz={snapshots_sent / elapsed:.1f} "
                f"duration={elapsed:.2f}s",
                flush=True,
            )

    def _step_players(self, dt: float) -> list[Player]:
        for lane, player in enumerate(self._players):
            if player.eliminated:
                continue
            if player.finished:
                # Already crossed: keep running a little past the line and
                # finish the jump, but accept no new jumps (apply_action guards).
                speed = PLAYER_SPEED
                if player.slow_timer > 0:
                    speed *= OBSTACLE_SLOW_FACTOR
                    player.slow_timer = max(0.0, player.slow_timer - dt)
                x, _ = actions.moved(
                    player.position,
                    actions.AUTO_RUN,
                    dt,
                    speed,
                    START_X,
                    FINISH_X + 60,
                )
                player.move((x, self._stepped_height(player, dt)))
                continue
            # Tick down any active slow effect.
            if player.slow_timer > 0:
                player.slow_timer = max(0.0, player.slow_timer - dt)
            speed = PLAYER_SPEED
            if player.slow_timer > 0:
                speed *= OBSTACLE_SLOW_FACTOR
            old_x = player.x
            x, _ = actions.moved(
                player.position,
                actions.AUTO_RUN,
                dt,
                speed,
                START_X,
                FINISH_X,
            )
            # Obstacle collision: crossing a crate in this lane while
            # grounded slows you down; jumping over it is free.
            lane_obstacles = (
                self._obstacles[lane] if lane < len(self._obstacles) else []
            )
            grounded = player.y <= 2.0
            for i, ox in enumerate(lane_obstacles):
                if i in player.hit_obstacles:
                    continue
                if old_x < ox <= x or (x >= ox and old_x < ox):
                    player.hit_obstacles.add(i)
                    if grounded:
                        player.slow_timer = OBSTACLE_SLOW_SECONDS
            player.move((x, self._stepped_height(player, dt)))
            if player.x >= FINISH_X:
                player.finished = True
                if self._winner is None:
                    self._winner = {
                        "id": player.participant_id,
                        "name": player.name,
                        "color": player.color,
                    }
        # End the race once the winner is on the ground past the finish line.
        if self._winner is not None and not self._finishing:
            winner = self._players.get(self._winner["id"])
            if (
                winner is not None
                and winner.finished
                and winner.y <= 0
                and winner.x >= FINISH_X + 40
            ):
                self._finishing = True
                asyncio.create_task(self._finish_race())
        return [] if self._winner is not None else self._drop_laggards()

    def _stepped_height(self, player: Player, dt: float) -> float:
        """Integrate one tick of jump physics; 0 is the ground."""
        if player.y <= 0 and player.vy <= 0:
            return 0.0
        player.vy -= JUMP_GRAVITY * dt
        y = player.y + player.vy * dt
        if y <= 0:
            player.vy = 0.0
            return 0.0
        return y

    def _drop_laggards(self) -> list[Player]:
        """Eliminate everyone the chase camera has left behind."""
        standing = [
            player
            for player in self._players
            if not player.eliminated and not player.finished
        ]
        if len(standing) <= 1:
            return []
        cut = max(player.x for player in standing) - CAMERA_DISTANCE
        dropped = [player for player in standing if player.x < cut]
        for player in dropped:
            player.eliminated = True
        return dropped

    async def _finish_race(self):
        """Send the final world frame plus the result, then end the session."""
        await self.broadcast(messages.world(self.players_state(), self._obstacles))
        await self.end_game()

    async def end_game(self):
        if self._state != GameState.PLAYING:
            return
        if self._tick_task and not self._tick_task.done():
            self._tick_task.cancel()
        self._state = GameState.ENDED
        await self.broadcast(messages.game_ended(self._winner))
        self.finished.set()

    def mark_countdown_started(self):
        self._countdown_started_at = self._clock()

    def mark_game_started(self):
        self._game_started_at = self._clock()

    def remaining_countdown(self) -> int:
        if self._countdown_started_at is None:
            return COUNTDOWN_SECONDS
        elapsed = self._clock() - self._countdown_started_at
        return max(0, COUNTDOWN_SECONDS - int(elapsed))

    def remaining_game_time(self) -> int:
        if self._game_started_at is None:
            return GAME_DURATION_SECONDS
        elapsed = self._clock() - self._game_started_at
        return max(0, GAME_DURATION_SECONDS - int(elapsed))

    async def finish(self):
        # game_ended is already broadcast by end_game(); here we only release sockets.
        await self._players.close_all()

    async def broadcast(self, message: dict):
        """Fan out concurrently so one slow socket cannot stall the tick."""
        recipients = list(self._players) + list(self._spectators)
        if not recipients:
            return
        await asyncio.gather(
            *(participant.send(message) for participant in recipients),
            return_exceptions=True,
        )
