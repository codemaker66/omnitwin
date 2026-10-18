"""Writes a room's survey views from its config: the wall elevation tiles (views-walls.json)
and, when the config has survey.ceilingView, the view up at the ceiling (views-ceiling.json),
for tools/grand-hall-survey/render.mjs.

Usage: python -X utf8 -I room-views.py <room.json> <out-dir> [--overwrite]

Files are written with LF line ends, as committed. An existing file is left alone unless its
bytes already match (reported as unchanged) or --overwrite is given. Prints each file's SHA-256.
"""
import argparse
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roomlib  # noqa: E402


def write(path, data, overwrite):
    digest = hashlib.sha256(data).hexdigest()
    if os.path.exists(path):
        with open(path, "rb") as f:
            old = f.read()
        if old == data:
            return digest, "unchanged"
        if not overwrite:
            sys.exit(f"{path} exists with different bytes; pass --overwrite to replace it")
    with open(path, "wb") as f:
        f.write(data)
    return digest, "written"


def main():
    ap = argparse.ArgumentParser(description="Survey views from a surveyed-room config.")
    ap.add_argument("room", help="<slug>.room.json")
    ap.add_argument("out_dir", help="folder the views files are written to")
    ap.add_argument("--overwrite", action="store_true", help="replace existing files that differ")
    args = ap.parse_args()
    room = roomlib.load(args.room)
    os.makedirs(args.out_dir, exist_ok=True)
    survey = room["survey"]
    outputs = [(survey["wallViews"].get("file", "views-walls.json"), roomlib.wall_views_bytes(room))]
    if "ceilingView" in survey:
        outputs.append((survey["ceilingView"].get("file", "views-ceiling.json"), roomlib.ceiling_view_bytes(room)))
    for name, data in outputs:
        digest, status = write(os.path.join(args.out_dir, name), data, args.overwrite)
        print(f"{digest}  {name}  ({len(data)} bytes, {status})")
    views = roomlib.wall_views(room)
    walls = sorted({v["wall"] for v in views})
    print(f"{len(views)} wall tiles on {len(walls)} walls: {', '.join(walls)}")


if __name__ == "__main__":
    main()
