# 2D Game Client

Simple Python client that connects to the game backend as a player.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python main.py
```

## What it does

- Fetches the current game code
- Joins the game
- Connects to the WebSocket
- Prints all received messages
- Once the game starts, runs on its own (the server drives it) and rolls for a jump every 0.10s with a 10% chance
- Exits when the game ends

## Lint & Format

```bash
ruff check .
ruff format .
```