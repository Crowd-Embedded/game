from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from game import messages
from game.config import (
    COUNTDOWN_SECONDS,
    GAME_DURATION_SECONDS,
    MIN_PLAYERS_TO_START,
)
from game.gamestate import GameState

if TYPE_CHECKING:
    from game.gamesession import GameSession


class StateBehavior:
    state: GameState

    async def enter(self, session: GameSession) -> None:
        pass

    async def run(self, session: GameSession) -> GameState | None:
        return None

    async def on_join(self, session: GameSession, client_id: str) -> GameState | None:
        session.register_player(client_id)
        await session.broadcast(messages.player_joined(session.player_count))
        return None


class WaitingState(StateBehavior):
    state = GameState.WAITING

    async def on_join(self, session: GameSession, client_id: str) -> GameState | None:
        await super().on_join(session, client_id)
        if session.player_count >= MIN_PLAYERS_TO_START:
            return GameState.COUNTDOWN
        return None


class CountdownState(StateBehavior):
    state = GameState.COUNTDOWN

    async def enter(self, session: GameSession) -> None:
        session.mark_countdown_started()
        await session.broadcast(messages.countdown_started(COUNTDOWN_SECONDS))

    async def run(self, session: GameSession) -> GameState | None:
        await asyncio.sleep(COUNTDOWN_SECONDS)
        return GameState.PLAYING


class PlayingState(StateBehavior):
    state = GameState.PLAYING

    async def enter(self, session: GameSession) -> None:
        await session.broadcast(messages.game_started())
        await session.broadcast(messages.world(session.players_state()))

    async def run(self, session: GameSession) -> GameState | None:
        await asyncio.sleep(GAME_DURATION_SECONDS)
        return None


STATES: dict[GameState, StateBehavior] = {
    behavior.state: behavior
    for behavior in (WaitingState(), CountdownState(), PlayingState())
}
