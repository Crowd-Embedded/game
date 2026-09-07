import asyncio
import contextlib
import json
import random
import sys

import httpx
import websockets

BASE_URL = "http://localhost:8000/api/v1"
ACTIONS = ["left", "right", "up", "down", "noop"]
ACTION_INTERVAL_SECONDS = 0.20


async def send_actions(ws):
    while True:
        await asyncio.sleep(ACTION_INTERVAL_SECONDS)
        action = random.choice(ACTIONS)
        await ws.send(json.dumps({"type": "action", "action": action}))


async def main():
    async with httpx.AsyncClient() as http:
        code_resp = await http.get(f"{BASE_URL}/code")
        code = code_resp.json()["code"]
        print(f"code: {code}")

        join_resp = await http.post(
            f"{BASE_URL}/player/join",
            json={"code": code},
        )
        if join_resp.status_code != 200:
            print(f"join failed: {join_resp.text}")
            sys.exit(1)

        data = join_resp.json()
        client_id = data["client_id"]
        print(f"joined: client_id={client_id} status={data['status']}")

    async with websockets.connect(
        f"ws://localhost:8000/api/v1/player/ws/{client_id}"
    ) as ws:
        action_task = None
        try:
            async for raw in ws:
                msg = json.loads(raw)
                print(f"ws: {json.dumps(msg)}")
                if msg["type"] == "game_started" and action_task is None:
                    action_task = asyncio.create_task(send_actions(ws))
                elif msg["type"] == "game_ended":
                    break
        finally:
            if action_task is not None:
                action_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await action_task

    print("done")


if __name__ == "__main__":
    asyncio.run(main())
