from enum import StrEnum


class GameState(StrEnum):
    WAITING = "waiting"
    COUNTDOWN = "countdown"
    PLAYING = "playing"
    ENDED = "ended"
