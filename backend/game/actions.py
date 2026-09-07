from game.config import GRID_SIZE

DIRECTIONS = {
    "left": (-1, 0),
    "right": (1, 0),
    "up": (0, -1),
    "down": (0, 1),
}


def moved(position: tuple[int, int], action: str) -> tuple[int, int] | None:
    delta = DIRECTIONS.get(action)
    if delta is None:
        return None
    x, y = position
    new_x, new_y = x + delta[0], y + delta[1]
    if 0 <= new_x < GRID_SIZE and 0 <= new_y < GRID_SIZE:
        return (new_x, new_y)
    return None
