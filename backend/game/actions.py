"""Input intent: the server integrates movement, the client only holds a key."""

DIRECTIONS = {
    "left": -1.0,
    "right": 1.0,
    "stop": 0.0,
    "noop": None,
}


def direction_for(action: str) -> float | None:
    """Return the held direction for an action, or None if it is not a direction."""
    return DIRECTIONS.get(action)


def moved(
    position: tuple[float, float],
    direction: float,
    dt: float,
    speed: float,
    min_x: float,
    max_x: float,
) -> tuple[float, float]:
    x, y = position
    new_x = min(max_x, max(min_x, x + direction * speed * dt))
    return (new_x, y)
