import asyncio
import os
import time

from fastapi import WebSocket

from game import actions, messages
from game.config import (
    COUNTDOWN_SECONDS,
    FINISH_X,
    GAME_DURATION_SECONDS,
    INPUT_TIMEOUT_SECONDS,
    MAX_PLAYERS,
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
        if player is None or player.finished:
            return
        direction = actions.direction_for(action)
        if direction is None:
            return
        player.direction = direction
        player.last_input_at = self._clock()

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
        while self._state == GameState.PLAYING and self._winner is None:
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

            self._step_players(dt, now)
            if self._winner is not None:
                break

            if ticks % snapshot_every == 0:
                snapshots_sent += 1
                send_started = self._clock()
                await self.broadcast(messages.world(self.players_state()))
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

    def _step_players(self, dt: float, now: float):
        for player in self._players:
            if player.finished:
                continue
            if player.direction and now - player.last_input_at > INPUT_TIMEOUT_SECONDS:
                player.direction = 0.0
            if not player.direction:
                continue
            x, y = actions.moved(
                player.position,
                player.direction,
                dt,
                PLAYER_SPEED,
                START_X,
                FINISH_X,
            )
            player.move((x, y))
            if player.x >= FINISH_X:
                player.finished = True
                player.direction = 0.0
                self._winner = {
                    "id": player.participant_id,
                    "name": player.name,
                    "color": player.color,
                }
                asyncio.create_task(self._finish_race())
                break

    async def _finish_race(self):
        """Send the final world frame plus the result, then end the session."""
        await self.broadcast(messages.world(self.players_state()))
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
