#!/usr/bin/env python3
"""Minimal external SimArena brain. Requires: pip install websockets"""

import asyncio
import json
import sys
from datetime import datetime, timezone

import websockets


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def choose_action(observation: dict) -> dict:
    """Replace this hold-position policy with model inference."""
    positions = observation.get("jointPositions", [])
    return {"jointPositions": positions, "gripper": 0.0}


async def run(url: str) -> None:
    async with websockets.connect(url, max_size=1_048_576) as socket:
        await socket.send(json.dumps({
            "type": "hello",
            "protocolVersion": "1.0",
            "client": {"name": "python-example-brain", "version": "0.1.0"},
            "capabilities": ["joint_position"],
        }))

        async for raw in socket:
            message = json.loads(raw)
            if message["type"] == "observation":
                await socket.send(json.dumps({
                    "type": "action",
                    "protocolVersion": "1.0",
                    "episodeId": message["episodeId"],
                    "stepId": message["stepId"],
                    "timestamp": now(),
                    "action": choose_action(message["observation"]),
                }))
            elif message["type"] == "episode_result":
                print("episode complete:", message)
            elif message["type"] == "error":
                print("protocol error:", message, file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {sys.argv[0]} WS_URL")
    asyncio.run(run(sys.argv[1]))
