from contextlib import suppress
import asyncio
import logging
import os
import time

from fastapi import WebSocket, WebSocketDisconnect

from game.config import START_X, START_Y

log = logging.getLogger("race.participant")
SEND_TIMEOUT_SECONDS = 1.0


class Participant:
    keep_on_detach = True
    close_on_finish = False

    def __init__(self, participant_id: str):
        self.participant_id = participant_id
        self.websocket: WebSocket | None = None

    def attach(self, websocket: WebSocket):
        self.websocket = websocket

    def detach(self):
        self.websocket = None

    async def send(self, message: dict):
        if not self.websocket:
            return
        started = time.monotonic()
        try:
            await asyncio.wait_for(
                self.websocket.send_json(message), timeout=SEND_TIMEOUT_SECONDS
            )
        except (WebSocketDisconnect, RuntimeError):
            self.websocket = None
            return
        except asyncio.TimeoutError:
            # A stalled reader must never freeze the simulation loop.
            log.warning("dropping stalled socket for %s", self.participant_id)
            self.websocket = None
            return
        if os.environ.get("RACE_DEBUG") == "1":
            elapsed = time.monotonic() - started
            if elapsed > 0.05:
                log.warning("slow send %.0fms to %s", elapsed * 1000, self.participant_id)

    async def close(self):
        if not self.websocket:
            return
        with suppress(WebSocketDisconnect, RuntimeError):
            await self.websocket.close(code=1000)
        self.websocket = None


class Player(Participant):
    keep_on_detach = True
    close_on_finish = False

    def __init__(self, participant_id: str, color: str, name: str = ""):
        super().__init__(participant_id)
        self.color = color
        self.name = name
        self.x = START_X
        self.y = START_Y
        self.finished = False
        self.direction = 0.0
        self.last_input_at = 0.0

    @property
    def position(self) -> tuple[float, float]:
        return (self.x, self.y)

    def move(self, position: tuple[float, float]):
        self.x, self.y = position


class Spectator(Participant):
    keep_on_detach = False
    close_on_finish = True


class ParticipantSet:
    def __init__(self, role: type[Participant]):
        self._role = role
        self._participants: dict[str, Participant] = {}

    def __len__(self) -> int:
        return len(self._participants)

    def __iter__(self):
        return iter(self._participants.values())

    def contains(self, participant_id: str) -> bool:
        return participant_id in self._participants

    def get(self, participant_id: str) -> Participant | None:
        return self._participants.get(participant_id)

    def add(self, participant_id: str, **kwargs) -> Participant:
        participant = self._role(participant_id, **kwargs)
        self._participants[participant_id] = participant
        return participant

    def attach(self, participant_id: str, websocket: WebSocket):
        participant = self._participants.get(participant_id)
        if participant:
            participant.attach(websocket)

    def detach(self, participant_id: str):
        participant = self._participants.get(participant_id)
        if not participant:
            return
        participant.detach()
        if not self._role.keep_on_detach:
            del self._participants[participant_id]

    async def send_all(self, message: dict):
        for participant in list(self._participants.values()):
            await participant.send(message)

    async def close_all(self):
        for participant in list(self._participants.values()):
            await participant.close()
        self._participants.clear()
