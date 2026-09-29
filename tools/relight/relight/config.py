"""The bake's configuration: every input path and room constant in one JSON file."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

SCHEMA = "venviewer.relight-config.v1"
PATH_KEYS = ("splats", "canonicalFrame", "audit", "panoramas", "horizon", "proofWork", "work", "out", "evidence", "floorSkin", "bundle", "repo")
ROOM_KEYS = ("slug", "site", "hallE57", "windows", "finestTiles", "manifestTranslation", "probeSpacing", "floorTexel", "transferNeighbours")
OUTPUT_KEYS = ("work", "out", "evidence")


@dataclass(frozen=True)
class Config:
    paths: dict[str, str]
    room: dict[str, Any]


def load(path: str) -> Config:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if data.get("schema") != SCHEMA:
        raise ValueError(f"config schema must be {SCHEMA}")
    paths, room = data.get("paths", {}), data.get("room", {})
    missing = [k for k in PATH_KEYS if k not in paths] + [k for k in ROOM_KEYS if k not in room]
    if missing:
        raise ValueError("config is missing: " + ", ".join(missing))
    for key in OUTPUT_KEYS:
        if not paths[key].upper().startswith("D:/"):
            raise ValueError(f"{key} must be on D: (C: fills up; see the plan's constraints)")
    if sorted(room["windows"]) != ["W1", "W2", "W3", "W4", "W5"]:
        raise ValueError("the Grand Hall has windows W1..W5")
    return Config(paths=dict(paths), room=dict(room))
