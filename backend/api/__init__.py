from fastapi import APIRouter, Depends

from api.deps import get_manager
from api.player import router as player_router
from api.spectator import router as spectator_router
from game.gamemanager import GameManager

router = APIRouter()


@router.get("/code")
async def get_code(manager: GameManager = Depends(get_manager)):
    return {"code": manager.current_code}


@router.get("/debug/state")
async def debug_state(manager: GameManager = Depends(get_manager)):
    """Dev-only view of the live session, handy when iterating on game feel."""
    session = manager.current_game
    if session is None:
        return {"code": manager.current_code, "state": None}
    return {
        "code": manager.current_code,
        "state": session.state.value,
        "players": session.player_count,
        "spectators": len(session.spectators),
        "winner": session.winner,
        "game_task_done": session.game_task_done,
        "tick_task_done": session.tick_task_done,
        "positions": [
            {"name": p["name"], "x": round(p["x"], 1)} for p in session.players_state()
        ],
    }


router.include_router(player_router)
router.include_router(spectator_router)

__all__ = ["router"]
