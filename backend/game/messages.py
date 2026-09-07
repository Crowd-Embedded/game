from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from game.config import GRID_SIZE, MAX_PLAYERS
from game.gamestate import GameState

if TYPE_CHECKING:
    from game.gamesession import GameSession


def player_joined(player_count: int) -> dict:
    return {"type": "player_joined", "player_count": player_count}


def countdown_started(time_remaining: int) -> dict:
    return {"type": "countdown_started", "time_remaining": time_remaining}


def game_started() -> dict:
    return {"type": "game_started"}


def game_ended() -> dict:
    return {"type": "game_ended"}


def world(players: list[dict]) -> dict:
    return {"type": "world", "size": GRID_SIZE, "players": players}


def state(code: str, game_state: GameState, player_count: int) -> dict:
    return {
        "type": "state",
        "code": code,
        "state": game_state.value,
        "player_count": player_count,
        "max_players": MAX_PLAYERS,
    }


@dataclass(frozen=True)
class SessionSnapshot:
    code: str
    state: GameState
    player_count: int
    countdown_remaining: int
    players: tuple[dict, ...]

    @classmethod
    def of(cls, session: GameSession) -> SessionSnapshot:
        return cls(
            code=session.code,
            state=session.state,
            player_count=session.player_count,
            countdown_remaining=session.remaining_countdown(),
            players=tuple(session.players_state()),
        )


def player_init(snapshot: SessionSnapshot) -> list[dict]:
    if snapshot.state == GameState.COUNTDOWN:
        return [countdown_started(snapshot.countdown_remaining)]
    if snapshot.state == GameState.PLAYING:
        return [game_started(), world(list(snapshot.players))]
    return []


def spectator_init(snapshot: SessionSnapshot) -> list[dict]:
    messages = [state(snapshot.code, snapshot.state, snapshot.player_count)]
    if snapshot.state == GameState.COUNTDOWN:
        messages.append(countdown_started(snapshot.countdown_remaining))
    if snapshot.state == GameState.PLAYING:
        messages.append(world(list(snapshot.players)))
    return messages
