import asyncio
import contextlib
import json
import os
import random
import sys
import time

import httpx
import websockets

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8000/api/v1")
WS_BASE_URL = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")
PLAYER_NAME = os.environ.get("PLAYER_NAME") or None
ACTION_INTERVAL_SECONDS = float(os.environ.get("ACTION_INTERVAL_SECONDS", "0.10"))
JUMP_OPTIONS = (0.10, 0.20, 0.30)
CURRENT_JUMP_CHANCE = 0.10
LOOP = os.environ.get("PLAYER_LOOP", "true").lower() in ("1", "true", "yes")


async def jump_now_and_then(ws, stats):
    """Roll for a jump every interval; the server runs the racer forward."""
    while True:
        await asyncio.sleep(ACTION_INTERVAL_SECONDS)
        if random.random() >= CURRENT_JUMP_CHANCE:
            continue
        await asyncio.wait_for(
            ws.send(json.dumps({"type": "action", "action": "jump"})), timeout=1.0
        )
        stats["jumps_sent"] += 1


async def join(http: httpx.AsyncClient):
    code_resp = await http.get(f"{BASE_URL}/code")
    code = code_resp.json()["code"]
    payload = {"code": code}
    if PLAYER_NAME:
        payload["name"] = PLAYER_NAME
    join_resp = await http.post(f"{BASE_URL}/player/join", json=payload)
    if join_resp.status_code != 200:
        raise RuntimeError(f"join failed ({join_resp.status_code}): {join_resp.text}")
    return join_resp.json()


def new_stats():
    return {
        "jumps_sent": 0,
        "world_count": 0,
        "first_world_at": None,
        "last_world_at": None,
        "max_gap": 0.0,
        "gap_total": 0.0,
        "gap_count": 0,
        "scenario": 0,
    }


def report(stats, elapsed):
    if stats["world_count"] < 2 or elapsed <= 0:
        print("world: no data")
        return
    hz = stats["gap_count"] / elapsed if stats["gap_count"] else 0
    avg_gap = stats["gap_total"] / stats["gap_count"] if stats["gap_count"] else 0
    print(
        f"world messages/s={hz:.1f} avg_gap={avg_gap * 1000:.1f}ms "
        f"max_gap={stats['max_gap'] * 1000:.1f}ms "
        f"jumps={stats['jumps_sent']} total={stats['world_count']}"
    )


async def play_once(http: httpx.AsyncClient):
    data = await join(http)
    client_id = data["client_id"]
    global CURRENT_JUMP_CHANCE
    CURRENT_JUMP_CHANCE = random.choice(JUMP_OPTIONS)
    print(
        f"joined name={data.get('name')} client_id={client_id} "
        f"status={data['status']} jump_chance={CURRENT_JUMP_CHANCE:.0%}",
        flush=True,
    )

    stats = new_stats()
    async with websockets.connect(
        f"{WS_BASE_URL}/player/ws/{client_id}", max_queue=None
    ) as ws:
        action_task = None
        started_at = None
        try:
            async for raw in ws:
                msg = json.loads(raw)
                if msg["type"] == "world":
                    now = time.monotonic()
                    previous = stats["last_world_at"]
                    if previous is not None:
                        gap = now - previous
                        stats["max_gap"] = max(stats["max_gap"], gap)
                        stats["gap_total"] += gap
                        stats["gap_count"] += 1
                    stats["last_world_at"] = now
                    stats["world_count"] += 1
                    if started_at is None:
                        started_at = now
                        print("game started", flush=True)
                elif msg["type"] == "game_started":
                    print("game_started event", flush=True)
                elif msg["type"] == "player_eliminated":
                    print(
                        f"eliminated player_id={msg.get('player_id')} "
                        f"name={msg.get('name')}",
                        flush=True,
                    )
                elif msg["type"] == "game_ended":
                    winner = msg.get("winner") or {}
                    print(
                        f"winner={winner.get('name')} id={winner.get('id')}",
                        flush=True,
                    )
                    if started_at is not None:
                        report(stats, time.monotonic() - started_at)
                    break

                if action_task is None and msg["type"] in (
                    "game_started",
                    "world",
                ):
                    action_task = asyncio.create_task(jump_now_and_then(ws, stats))
        finally:
            if action_task is not None:
                action_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await action_task


async def main():
    async with httpx.AsyncClient(timeout=10) as http:
        while True:
            failed = False
            try:
                await play_once(http)
            except Exception as exc:  # noqa: BLE001 - keep the bot alive
                print(f"error: {exc}", flush=True)
                failed = True
            if not LOOP:
                break
            # Joining a session that just ended is expected; back off quietly.
            await asyncio.sleep(2.0 if failed else 1.0)

    print("done")


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(main())
        sys.exit(0)
