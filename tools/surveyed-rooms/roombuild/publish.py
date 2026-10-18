"""The build's record (build/survey.json) and publishing.

survey.json says what the published files are: the config they were built from (its SHA-256),
the tools' commit and the meshoptimizer that simplified each GHR1 file, the inputs taken from
another work directory, each wall's strip in the atlas and its relief id, the encodings, the
ceiling's extent and orientation, the glazing per opening and what the scan said about it, and
every file's size and hash. It always goes to build/; for a room whose survey.outputs.manifest
names it, it is published too. The Grand Hall publishes exactly its nine files, so `git diff` on
its folder stays empty.

publish() refuses (before copying anything) when the scan disagrees with a window's glass
(build/glass.json) or a relief was meshed with another checkout's meshoptimizer.
"""
import hashlib
import json
import os
import shutil
import subprocess

from . import atlas as atlas_step
from .legacy import ROOMS

SCHEMA_VERSION = 1


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def output_files(room):
    """Published file names, in a fixed order."""
    o = room.survey["outputs"]
    names = [f["file"] for f in o["walls"]] + [o["relief"]]
    names += [f["file"] for f in o.get("ceiling", [])]
    names += [f["file"] for d in room.cfg["ceiling"].get("domes", []) for f in o.get("domes", {}).get(d["id"], [])]
    names += [f["file"] for f in o.get("floor", [])]
    if o.get("ceilingRelief"):
        names.append(o["ceilingRelief"])
    return names


def tools_state():
    repo = os.path.dirname(os.path.dirname(ROOMS))
    try:
        commit = subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "-C", repo, "status", "--porcelain", "--", "tools"], capture_output=True, text=True, check=True).stdout.strip()
        return dict(commit=commit, dirty=bool(dirty))
    except (OSError, subprocess.CalledProcessError):
        return dict(commit=None, dirty=None)


def _json(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def glass_scan():
    """What the windows step's scan check found (build/glass.json), or None before that step."""
    record = _json("build/glass.json")
    if record is None:
        return None
    return dict(disagreements=record.get("disagreements", []),
                openings={oid: r["scan"] for oid, r in record["openings"].items() if "scan" in r})


def node_records():
    """Which meshoptimizer simplified each GHR1 file (relief-mesh-room.mjs's records)."""
    return {name: rec for name in ("walls", "ceiling") if (rec := _json(f"build/relief-{name}.node.json")) is not None}


def publish_problems(record):
    out = [f"glass: {line}" for line in (record.get("glassScan") or {}).get("disagreements", [])]
    out += [f"relief {name}: meshed with SURVEYED_ROOMS_NODE_ROOT={rec['nodeRoot']}"
            for name, rec in record["tools"]["relief"].items() if rec.get("nodeRoot")]
    return out


def survey_record(room):
    lay = atlas_step.layout(room)
    rel = room.survey["relief"]
    x0, x1, z0, z1 = room.bbox()
    files = {}
    for name in output_files(room):
        path = os.path.join("proj", name)
        if os.path.exists(path):
            files[name] = dict(bytes=os.path.getsize(path), sha256=sha256(path))
    record = dict(
        schemaVersion=SCHEMA_VERSION, slug=room.cfg["slug"], revision=room.survey["publish"].get("revision"),
        captured=room.cfg["source"]["captured"], configSha256=room.sha256, methodRevision=room.revision,
        tools=dict(tools_state(), relief=node_records()),
        linkedInputs=_json("build/linked.json") or {},
        glassScan=glass_scan(),
        atlas=dict(size=[lay["width"], lay["height"]], ppm=lay["ppm"], vRange=lay["vRange"], row=lay["row"],
                   alpha="255 - 127 * glass", packing=lay["packing"]),
        walls=[dict(id=s["wall"]["id"], reliefId=room.relief_id(s["wall"]), length=s["wall"]["length"],
                    atlas=[s["x"], s["y"], s["w"], lay["row"]]) for s in lay["strips"]],
        relief=dict(container=rel["container"], file=room.survey["outputs"]["relief"], ppm=rel["ppm"],
                    vRange=rel["vRange"], depthRange=rel["depthRange"], simplifyError=rel["simplifyError"],
                    order=[room.relief_id(w) for w in room.relief_order()]),
        ceiling=dict(extent=dict(x=[x0, x1], z=[z0, z1]), orientation="columns planner +x, rows from planner +z",
                     files=[f["file"] for f in room.survey["outputs"].get("ceiling", [])]),
        openings=[dict(id=o["id"], wall=o["wall"], glazing=o["glazing"],
                       planes=o.get("glass", {}).get("planes"), frostedBelow=o.get("glass", {}).get("frostedBelow"))
                  for o in room.cfg["openings"] if o["kind"] == "window" and o["glazing"] != "none"],
        files=files,
    )
    cr = room.survey.get("ceilingRelief")
    if cr:
        record["ceiling"]["relief"] = dict(file=room.survey["outputs"]["ceilingRelief"], id=cr["id"], ppm=cr["ppm"],
                                           reference=room.cfg["ceiling"]["height"], heightRange=cr["heightRange"],
                                           convention="u = planner x, v = planner z, y = reference - depth")
    return record


def write_record(room):
    record = survey_record(room)
    os.makedirs("build", exist_ok=True)
    with open("build/survey.json", "w", encoding="utf-8", newline="\n") as f:
        json.dump(record, f, indent=1)
        f.write("\n")
    return record


def publish(room, dest):
    """Copies the outputs (and survey.json when the config publishes one) to dest."""
    record = write_record(room)
    problems = publish_problems(record)
    if problems:
        raise SystemExit("publish refused (nothing copied):\n" + "\n".join(f"  - {p}" for p in problems))
    os.makedirs(dest, exist_ok=True)
    copied = []
    for name in output_files(room):
        shutil.copyfile(os.path.join("proj", name), os.path.join(dest, name))
        copied.append(name)
    manifest = room.survey["outputs"].get("manifest")
    if manifest:
        shutil.copyfile("build/survey.json", os.path.join(dest, manifest))
        copied.append(manifest)
    for name in copied:
        print(sha256(os.path.join(dest, name))[:16], name)
    return record
