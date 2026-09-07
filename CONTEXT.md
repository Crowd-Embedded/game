# 2D Game

A multiplayer 2D game where players join via code, play in timed sessions, and spectators watch live.

## Language

**Game Session**:
A single round of play: players join during WAITING, countdown starts when 2+ players have joined, PLAYING runs for a fixed duration, then the session ends.
_Avoid_: Game, round, match

**Player**:
A connected participant in a Game Session, identified by a client_id and linked to a WebSocket for receiving game events.
_Avoid_: User, client, member

**Spectator**:
A read-only observer connected to a Game Session via WebSocket. Spectators see the same events as Players but cannot participate.
_Avoid_: Observer, viewer, watcher

**Game State**:
The current phase of a Game Session: WAITING (open for join), COUNTDOWN (about to start), PLAYING (in progress).
_Avoid_: Status, phase, stage

**Game Code**:
An 4-letter uppercase string that Players use to join the current Game Session. A new code is generated when each session ends.
_Avoid_: Join code, room code, password, token

**Game Event**:
An outbound message sent to Players and Spectators describing a change in Game State or Game Session membership.
_Avoid_: message, packet, notification

**Game Lifecycle**:
The orchestration of Game Session creation and rotation (generating a new Game Code after each session ends).
_Avoid_: Lobby, matchmaking, coordinator