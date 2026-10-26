import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from api.deps import get_manager
from game.gamemanager import GameManager
from game.gamesession import GameSession
from game.messages import SessionSnapshot, spectator_init

router = APIRouter()


@router.post("/spectator/join")
async def spectator_join(manager: GameManager = Depends(get_manager)):
    if manager.current_game is None:
        raise HTTPException(400, "No game active")
    # The id is bound to a session when the WebSocket attaches, so a socket that
    # never connects never leaves a ghost spectator behind.
    return {"spectator_id": str(uuid.uuid4())}


async def _send_init(websocket: WebSocket, session: GameSession, spectator_id: str):
    session.attach_spectator(spectator_id, websocket)
    for message in spectator_init(SessionSnapshot.of(session)):
        await websocket.send_json(message)


async def _watch_disconnect(websocket: WebSocket, disconnected: asyncio.Event):
    """Single receive loop: never cancelled, so the ASGI channel stays sane."""
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        disconnected.set()


@router.websocket("/spectator/ws/{spectator_id}")
async def spectator_endpoint(
    websocket: WebSocket,
    spectator_id: str,
    manager: GameManager = Depends(get_manager),
):
    """One long-lived socket that follows the game across session rotations."""
    await websocket.accept()

    disconnected = asyncio.Event()
    receive_task = asyncio.create_task(_watch_disconnect(websocket, disconnected))
    session: GameSession | None = None
    try:
        while not disconnected.is_set():
            current = manager.current_game
            if current is not None and current is not session:
                if session is not None:
                    session.detach_spectator(spectator_id)
                session = current
                if not disconnected.is_set():
                    await _send_init(websocket, session, spectator_id)

            rotation = asyncio.create_task(manager.wait_for_rotation())
            closed = asyncio.create_task(disconnected.wait())
            done, pending = await asyncio.wait(
                {rotation, closed}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
    except WebSocketDisconnect:
        pass
    finally:
        disconnected.set()
        if session is not None:
            session.detach_spectator(spectator_id)
        if not receive_task.done():
            receive_task.cancel()
