import uuid

from fastapi import APIRouter, Depends, HTTPException, WebSocket

from api._shared import _handle_ws, _WsAdapter
from api.deps import get_manager
from game.gamemanager import GameManager
from game.gamesession import GameSession
from game.messages import SessionSnapshot, spectator_init

router = APIRouter()


async def _send_spectator_init(ws: WebSocket, session: GameSession, spectator_id: str):
    session.attach_spectator(spectator_id, ws)
    for message in spectator_init(SessionSnapshot.of(session)):
        await ws.send_json(message)


async def _cleanup_spectator(ws: WebSocket, session: GameSession, spectator_id: str):
    session.detach_spectator(spectator_id)


@router.post("/spectator/join")
async def spectator_join(manager: GameManager = Depends(get_manager)):
    session = manager.current_game
    if not session:
        raise HTTPException(400, "No game active")
    spectator_id = str(uuid.uuid4())
    session.register_spectator(spectator_id)
    return {"spectator_id": spectator_id}


@router.websocket("/spectator/ws/{spectator_id}")
async def spectator_endpoint(
    websocket: WebSocket,
    spectator_id: str,
    manager: GameManager = Depends(get_manager),
):
    await _handle_ws(
        websocket,
        _WsAdapter(
            lookup=lambda: manager.current_game,
            send_init=lambda ws, s: _send_spectator_init(ws, s, spectator_id),
            cleanup=lambda ws, s: _cleanup_spectator(ws, s, spectator_id),
            error_message="No game active",
        ),
    )
