from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import router
from game.gamemanager import GameManager


@asynccontextmanager
async def lifespan(app: FastAPI):
    manager = GameManager()
    app.state.manager = manager
    manager.prepare_next_game()
    yield


app = FastAPI(title="2D Game Backend", lifespan=lifespan)
app.include_router(router, prefix="/api/v1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
