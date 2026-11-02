"""Input intent: the server runs every racer forward, the client only asks to jump."""

JUMP = "jump"
AUTO_RUN = 1.0


def is_jump(action: str) -> bool:
    return action == JUMP


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
