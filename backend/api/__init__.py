from fastapi import APIRouter, Depends

from api.deps import get_manager
from api.player import router as player_router
from api.spectator import router as spectator_router
from game.gamemanager import GameManager

router = APIRouter()


@router.get("/code")
async def get_code(manager: GameManager = Depends(get_manager)):
    return {"code": manager.current_code}


router.include_router(player_router)
router.include_router(spectator_router)

__all__ = ["router"]
