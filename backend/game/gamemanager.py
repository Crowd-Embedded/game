import asyncio
import random
import string
import time
from collections.abc import Callable

from game.gamestate import GameState
from game.gamesession import GameSession
from game.states import StateBehavior


def generate_code() -> str:
    return "".join(random.choices(string.ascii_uppercase, k=4))


class GameManager:
    def __init__(
        self,
        states: dict[GameState, StateBehavior] | None = None,
        clock: Callable[[], float] = time.monotonic,
        code_source: Callable[[], str] = generate_code,
    ):
        self._states = states
        self._clock = clock
        self._code_source = code_source
        self.current_game: GameSession | None = None
        self.current_code: str | None = None

    def prepare_next_game(self):
        self._rotate()

    def _rotate(self) -> GameSession:
        self.current_code = self._code_source()
        self.current_game = GameSession(self.current_code, self._states, self._clock)
        asyncio.create_task(self._retire(self.current_game))
        return self.current_game

    async def _retire(self, session: GameSession):
        await session.finished.wait()
        self._rotate()
        await session.finish()

    def get_session_for_client(self, client_id: str) -> GameSession | None:
        if self.current_game and self.current_game.has_player(client_id):
            return self.current_game
        return None
