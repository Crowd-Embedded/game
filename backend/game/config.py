import random

MAX_PLAYERS = 10
MIN_PLAYERS_TO_START = 2
COUNTDOWN_SECONDS = 5
GAME_DURATION_SECONDS = 60
TRACK_LENGTH = 500
FINISH_X = 500
START_X = 0
START_Y = 0
PLAYER_SPEED = 120.0  # pixels per second while holding a direction
INPUT_TIMEOUT_SECONDS = 0.35  # a held key expires if no repeat arrives
RESULT_SECONDS = 6  # how long the winner is shown before the next race
TICK_RATE = 60  # Hz
TICK_INTERVAL = 1.0 / TICK_RATE
SNAPSHOT_RATE = 30  # Hz, world broadcasts per second
PLAYER_COLORS = [
    "#00ff88",
    "#00ccff",
    "#ffaa00",
    "#ff4444",
    "#cc44ff",
    "#ff66cc",
    "#44ff66",
    "#ffff44",
    "#44aaff",
    "#ff8844",
]

ADJECTIVES = [
    "Swift",
    "Bold",
    "Rapid",
    "Brave",
    "Quick",
    "Sharp",
    "Wild",
    "Cool",
    "Fast",
    "Bright",
]
NOUNS = [
    "Fox",
    "Wolf",
    "Hawk",
    "Bear",
    "Lion",
    "Tiger",
    "Racer",
    "Bolt",
    "Dash",
    "Storm",
]


def generate_name() -> str:
    return f"{random.choice(ADJECTIVES)}{random.choice(NOUNS)}"
