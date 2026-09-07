from contextlib import suppress
import random

from fastapi import WebSocket, WebSocketDisconnect

from game.config import GRID_SIZE


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
        try:
            await self.websocket.send_json(message)
        except WebSocketDisconnect:
            self.websocket = None

    async def close(self):
        if not self.websocket:
            return
        with suppress(WebSocketDisconnect, RuntimeError):
            await self.websocket.close(code=1000)
        self.websocket = None


class Player(Participant):
    keep_on_detach = True
    close_on_finish = False

    def __init__(self, participant_id: str, color: str):
        super().__init__(participant_id)
        self.color = color
        self.x = random.randrange(GRID_SIZE)
        self.y = random.randrange(GRID_SIZE)

    @property
    def position(self) -> tuple[int, int]:
        return (self.x, self.y)

    def move(self, position: tuple[int, int]):
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
