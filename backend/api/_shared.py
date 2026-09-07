from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import WebSocket, WebSocketDisconnect

from game.gamesession import GameSession


@dataclass
class _WsAdapter:
    lookup: Callable[[], GameSession | None]
    send_init: Callable[[WebSocket, GameSession], Awaitable[None]]
    cleanup: Callable[[WebSocket, GameSession], Awaitable[None]]
    error_message: str = "No game active"
    on_message: Callable[[GameSession, str], Awaitable[None]] | None = None


async def _handle_ws(websocket: WebSocket, adapter: _WsAdapter):
    await websocket.accept()
    session = adapter.lookup()
    if not session:
        await websocket.send_json({"type": "error", "message": adapter.error_message})
        await websocket.close(code=4000)
        return
    await adapter.send_init(websocket, session)
    try:
        while True:
            raw = await websocket.receive_text()
            if adapter.on_message is not None:
                await adapter.on_message(session, raw)
    except WebSocketDisconnect:
        await adapter.cleanup(websocket, session)
