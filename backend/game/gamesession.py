import asyncio
import time

from fastapi import WebSocket

from game import actions, messages
from game.config import COUNTDOWN_SECONDS, MAX_PLAYERS, PLAYER_COLORS
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
        self._game_task: asyncio.Task | None = None
        self.finished = asyncio.Event()

    @property
    def state(self) -> GameState:
        return self._state

    @property
    def player_count(self) -> int:
        return len(self._players)

    def full(self) -> bool:
        return self.player_count >= MAX_PLAYERS

    def has_player(self, client_id: str) -> bool:
        return self._players.contains(client_id)

    async def add_player(self, client_id: str) -> None:
        async with self._join_lock:
            next_state = await self._states[self._state].on_join(self, client_id)
            if next_state is not None:
                await self._enter(next_state)

    async def _enter(self, state: GameState):
        self._state = state
        await self._states[state].enter(self)
        if state is GameState.COUNTDOWN and self._game_task is None:
            self._game_task = asyncio.create_task(self._run())

    async def _run(self):
        while self._state in (GameState.COUNTDOWN, GameState.PLAYING):
            next_state = await self._states[self._state].run(self)
            if next_state is None:
                break
            await self._enter(next_state)
        self.finished.set()

    def register_player(self, client_id: str) -> Player:
        color = PLAYER_COLORS[len(self._players) % len(PLAYER_COLORS)]
        return self._players.add(client_id, color=color)

    def attach_player(self, client_id: str, websocket: WebSocket):
        self._players.attach(client_id, websocket)

    def detach_player(self, client_id: str):
        self._players.detach(client_id)

    def register_spectator(self, spectator_id: str) -> Spectator:
        return self._spectators.add(spectator_id)

    def attach_spectator(self, spectator_id: str, websocket: WebSocket):
        self._spectators.attach(spectator_id, websocket)

    def detach_spectator(self, spectator_id: str):
        self._spectators.detach(spectator_id)

    def players_state(self) -> list[dict]:
        return [
            {
                "id": player.participant_id,
                "x": player.x,
                "y": player.y,
                "color": player.color,
            }
            for player in self._players
        ]

    async def apply_action(self, client_id: str, action: str) -> None:
        if self._state is not GameState.PLAYING:
            return
        player = self._players.get(client_id)
        if player is None:
            return
        position = actions.moved(player.position, action)
        if position is None:
            return
        player.move(position)
        await self.broadcast(messages.world(self.players_state()))

    def mark_countdown_started(self):
        self._countdown_started_at = self._clock()

    def remaining_countdown(self) -> int:
        if self._countdown_started_at is None:
            return COUNTDOWN_SECONDS
        elapsed = self._clock() - self._countdown_started_at
        return max(0, COUNTDOWN_SECONDS - int(elapsed))

    async def finish(self):
        await self.broadcast(messages.game_ended())
        await self._spectators.close_all()

    async def broadcast(self, message: dict):
        for participant in list(self._players) + list(self._spectators):
            await participant.send(message)
