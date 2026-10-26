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

    async def on_join(self, session: GameSession, client_id: str, name: str | None = None) -> GameState | None:
        session.register_player(client_id, name)
        await session.broadcast(messages.player_joined(session.player_count))
        return None


class WaitingState(StateBehavior):
    state = GameState.WAITING

    async def on_join(self, session: GameSession, client_id: str, name: str | None = None) -> GameState | None:
        await super().on_join(session, client_id, name)
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
        session.mark_game_started()
        await session.broadcast(messages.game_started(GAME_DURATION_SECONDS))
        await session.broadcast(messages.world(session.players_state()))
        session.start_game_loop()

    async def run(self, session: GameSession) -> GameState | None:
        try:
            await asyncio.wait_for(session.finished.wait(), timeout=GAME_DURATION_SECONDS)
        except asyncio.TimeoutError:
            if session.winner is None:
                await session.end_game()
        return None


class EndedState(StateBehavior):
    state = GameState.ENDED

    async def enter(self, session: GameSession) -> None:
        pass


STATES: dict[GameState, StateBehavior] = {
    behavior.state: behavior
    for behavior in (WaitingState(), CountdownState(), PlayingState(), EndedState())
}
