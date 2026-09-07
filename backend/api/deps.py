from starlette.requests import HTTPConnection

from game.gamemanager import GameManager


def get_manager(connection: HTTPConnection) -> GameManager:
    return connection.app.state.manager
