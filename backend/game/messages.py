from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from game.config import FINISH_X, MAX_PLAYERS, TRACK_LENGTH
from game.gamestate import GameState

if TYPE_CHECKING:
    from game.gamesession import GameSession


def player_joined(player_count: int) -> dict:
    return {"type": "player_joined", "player_count": player_count}


def countdown_started(time_remaining: int) -> dict:
    return {"type": "countdown_started", "time_remaining": time_remaining}


def game_started(time_remaining: int | None = None) -> dict:
    msg = {"type": "game_started"}
    if time_remaining is not None:
        msg["time_remaining"] = time_remaining
    return msg


def game_ended(winner: dict | None = None) -> dict:
    msg = {"type": "game_ended"}
    if winner is not None:
        msg["winner"] = winner
    return msg


import time


def world(players: list[dict]) -> dict:
    return {
        "type": "world",
        "track_length": TRACK_LENGTH,
        "finish_x": FINISH_X,
        "players": players,
        "t": time.time(),
    }


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
    game_time_remaining: int | None = None
    winner: dict | None = None

    @classmethod
    def of(cls, session: GameSession) -> SessionSnapshot:
        return cls(
            code=session.code,
            state=session.state,
            player_count=session.player_count,
            countdown_remaining=session.remaining_countdown(),
            players=tuple(session.players_state()),
            game_time_remaining=session.remaining_game_time(),
            winner=session.winner,
        )


def player_init(snapshot: SessionSnapshot) -> list[dict]:
    if snapshot.state == GameState.COUNTDOWN:
        return [countdown_started(snapshot.countdown_remaining)]
    if snapshot.state == GameState.PLAYING:
        msgs = []
        if snapshot.game_time_remaining is not None:
            msgs.append(game_started(snapshot.game_time_remaining))
        else:
            msgs.append(game_started())
        msgs.append(world(list(snapshot.players)))
        return msgs
    return []


def spectator_init(snapshot: SessionSnapshot) -> list[dict]:
    messages = [state(snapshot.code, snapshot.state, snapshot.player_count)]
    if snapshot.state == GameState.COUNTDOWN:
        messages.append(countdown_started(snapshot.countdown_remaining))
    if snapshot.state == GameState.PLAYING:
        if snapshot.game_time_remaining is not None:
            messages.append(game_started(snapshot.game_time_remaining))
        else:
            messages.append(game_started())
        messages.append(world(list(snapshot.players)))
    if snapshot.state == GameState.ENDED:
        # A spectator arriving during the result window should still see the finish.
        if snapshot.players:
            messages.append(world(list(snapshot.players)))
        messages.append(game_ended(snapshot.winner))
    return messages
