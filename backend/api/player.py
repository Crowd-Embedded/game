import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from pydantic import BaseModel

from api._shared import _handle_ws, _WsAdapter
from api.deps import get_manager
from game.gamemanager import GameManager
from game.gamesession import GameSession
from game.gamestate import GameState
from game.messages import SessionSnapshot, player_init

router = APIRouter()


class JoinRequest(BaseModel):
    code: str
    name: str | None = None


async def _send_player_init(ws: WebSocket, session: GameSession, client_id: str):
    session.attach_player(client_id, ws)
    for message in player_init(SessionSnapshot.of(session)):
        await ws.send_json(message)


async def _cleanup_player(ws: WebSocket, session: GameSession, client_id: str):
    session.detach_player(client_id)


async def _handle_player_message(session: GameSession, client_id: str, raw: str):
    try:
        message = json.loads(raw)
    except json.JSONDecodeError:
        return
    if message.get("type") == "action":
        await session.apply_action(client_id, message.get("action"))


@router.post("/player/join")
async def join(req: JoinRequest, manager: GameManager = Depends(get_manager)):
    code = req.code.upper().strip()
    if not manager.current_game or code != manager.current_code:
        raise HTTPException(400, "Invalid or expired code")

    session = manager.current_game

    if session.state not in (GameState.WAITING, GameState.COUNTDOWN):
        raise HTTPException(400, "Game already in progress or ended")

    if session.full():
        raise HTTPException(400, "Game is full")

    client_id = str(uuid.uuid4())
    player = await session.add_player(client_id, name=req.name)

    return {
        "client_id": client_id,
        "status": session.state.value,
        "time_remaining": session.remaining_countdown(),
        "name": getattr(player, "name", "") if player else "",
    }


@router.websocket("/player/ws/{client_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    client_id: str,
    manager: GameManager = Depends(get_manager),
):
    await _handle_ws(
        websocket,
        _WsAdapter(
            lookup=lambda: manager.get_session_for_client(client_id),
            send_init=lambda ws, s: _send_player_init(ws, s, client_id),
            cleanup=lambda ws, s: _cleanup_player(ws, s, client_id),
            error_message="Invalid client_id",
            on_message=lambda s, raw: _handle_player_message(s, client_id, raw),
        ),
    )
