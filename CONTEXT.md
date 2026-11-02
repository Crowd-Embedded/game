# 2D Game

A multiplayer 2D game where players join via code, play in timed sessions, and spectators watch live.

## Language

**Game Session**:
A single round of play: players join during WAITING, countdown starts when 2+ players have joined, PLAYING runs until the winning Player has landed past the Finish Line, until only one Player remains un-eliminated, or until the time limit, then the result is shown before the session ends.
_Avoid_: Game, round, match

**Track**:
The horizontal course Players race along, measured in pixels from the start line to the Finish Line. Racers run forward on their own; a Player never steers. A Player's `y` is height above the Track, non-zero only while jumping.
_Avoid_: Course, map, level, field

**Finish Line**:
The position on the Track where a race ends; the first Player to reach it wins.
_Avoid_: Goal, end, goal line

**Jump**:
The only input in a race. A jump carries a Player off the Track for a moment and pays a small forward boost while airborne, so its timing is what separates the pack. Jumps do not stack.
_Avoid_: Leap, hop, boost

**Eliminated**:
A Player who has fallen more than the chase-camera distance behind the leader. Eliminated Players freeze in place, can no longer win, and are no longer drawn, because the camera has left them behind.
_Avoid_: Out, dead, disqualified, DNF

**Player**:
A connected participant in a Game Session, identified by a client_id and linked to a WebSocket for receiving game events.
_Avoid_: User, client, member

**Spectator**:
A read-only observer connected to a Game Session via WebSocket. Spectators see the same events as Players but cannot participate.
_Avoid_: Observer, viewer, watcher

**Game State**:
The current phase of a Game Session: WAITING (open for join), COUNTDOWN (about to start), PLAYING (in progress), ENDED (result shown before the next session).
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