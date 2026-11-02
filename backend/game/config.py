import random

MAX_PLAYERS = 6
MIN_PLAYERS_TO_START = 2
COUNTDOWN_SECONDS = 5
GAME_DURATION_SECONDS = 60
TRACK_LENGTH = 1000
FINISH_X = 1000
START_X = 0
START_Y = 0
PLAYER_SPEED = 120.0  # every racer runs forward at this speed on its own
JUMP_VELOCITY = 60.0  # upward speed of a jump, pixels per second
JUMP_GRAVITY = 140.0  # pulls a jumping racer back down
JUMP_BOOST = 0.0  # reserved: a future powerup may grant airborne speed; jumping alone must not help
OBSTACLE_SLOW_FACTOR = 0.4  # speed multiplier while slowed by a crate
OBSTACLE_SLOW_SECONDS = 0.6  # how long a crate slows a racer
# The chase camera trails the leader by this many pixels; anything it leaves
# behind is eliminated from the race.
CAMERA_DISTANCE = 100.0
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
