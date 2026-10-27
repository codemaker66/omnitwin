"""Lit windows, shopfronts and signs across Glassford Street, placed on the city model for the Grand Hall at night.

What the Grand Hall's windows look onto at night is the frontage across Glassford Street and the length of Garth
Street (facade-survey.json, "sight"). The city model carries their massing but no openings, so through the glass
they read as dark blocks. This bake places the openings our own panoramas show on those walls, so the planner can
light them:

Inputs
  facade-survey.json             the openings, shopfronts and signs, each read from our public 8K panoramas
                                 rectified onto its wall (the survey says which stations, at what resolution)
  merchant-city-v2.bin / .json   the published city model (build_context.py), whose walls carry them

Steps
  1. each feature is a rectangle on its wall: u along the wall (x for a wall of constant z, z for one of constant
     x), h above the pavement (y = ground_y + h)
  2. its depth from the model: a grid of rays over the rectangle, at most sample_m apart and at least 3 x 3 (the
     LiDAR walls jog between samples further apart), each from 4 m in front of the wall's survey
     plane straight at it, against the model's triangles. Every ray must meet the model within depth_tolerance_m of
     the plane, at least facing_share of them on a surface facing the street (normal within 45 degrees of the
     wall's: the LiDAR walls jog by a few centimetres), and the hits may spread at most spread_m (a band of the
     model set back above a window's head drops it); a feature that fails is left out and listed under "dropped"
     with the reason. Its quad stands offset_m in front of the frontmost hit, so the model's own face never
     covers it. A sign or shopfront longer than segment_m follows the wall's jogs in pieces (id:1, id:2, ...),
     each placed so, each carrying its span (where it starts along the whole, and the whole's length) so the
     planner draws one sign across them. The model's wall steps at its 3 m band edges, so a sign or shopfront
     whose top crosses one keeps the part below it if that is at least clip_keep of it (each piece listed under
     "clipped")
  3. a shopfront or a lit door also lights the pavement in front of it: a quad on the model's ground (a ray down
     spill_probe_m in front of the feature), spill_reach_m deep and spill_widen_m wider each side
  4. a blind window (rendered or stoned over, as the panoramas show) is surveyed but never lit: listed, not placed
  5. each feature carries two numbers from a hash of its id (SHA-256), seed and variant, both in [0, 1): the
     planner lights a window when its seed is under the night look's share for its use, and the variant chooses
     its curtains or blinds and, on a lit office floor, the odd room left dark, so a look changes how many are
     lit, never which come first. An office's seed is its floor's (the id up to the window's position: offices
     light a floor at a time); a home's, a shop's or a sign's is its own
  6. write facade-lights-v1.json: every quad as a centre and two half-extent vectors (along the wall and up it, or
     along and out across the pavement for a spill), millimetre rounded, with the survey's provenance

Usage
  python bake_facade_lights.py <out-dir> [--survey facade-survey.json] [--model-dir ...] [--check]
  --check  bakes again into a temporary folder and asserts byte-identical output
Requires numpy.
"""
# The docstring above is copied into the published JSON as "method"; keep it in step with the code.
import argparse
import hashlib
import json
import re
import struct
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
DEFAULT_SURVEY = HERE / "facade-survey.json"
DEFAULT_MODEL_DIR = REPO / "packages/web/public/rooms/grand-hall/context-2020-lidar"
MODEL_NAME = "merchant-city-v2"
OUT_FILE = "facade-lights-v1.json"

P = dict(
    probe_m=4.0, depth_tolerance_m=1.0, spread_m=0.45, offset_m=0.03, facing_cos=0.7071, facing_share=0.66, near_m=12.0,
    spill_reach_m=3.5, spill_widen_m=0.6, spill_probe_m=1.5, spill_lift_m=0.02, grid=3, sample_m=0.4, segment_m=1.1, clip_keep=0.6,
)
KINDS = ("window", "shop", "door", "sign")
USES = ("office", "home", "blind")
LIGHTS = ("office", "home", "pub", "bar", "glass-green", "sign-teal", "sign-violet", "sign-green")


def parse_args():
    ap = argparse.ArgumentParser(description="Lit openings across Glassford Street for the city model (facade lights v1).")
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--survey", type=Path, default=DEFAULT_SURVEY)
    ap.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    ap.add_argument("--check", action="store_true")
    return ap.parse_args()


def sha256(path, text=False):
    """A file's SHA-256; a text file's with its line ends as Git stores them (LF), so a Windows checkout agrees."""
    data = Path(path).read_bytes()
    return hashlib.sha256(data.replace(b"\r\n", b"\n") if text else data).hexdigest()


def unit_hash(text):
    """A number in [0, 1) from a string, the same on every machine."""
    return int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:6], "big") / float(1 << 48)


def load_model(model_dir):
    blob = (Path(model_dir) / f"{MODEL_NAME}.bin").read_bytes()
    if blob[:4] != b"VVCX":
        raise SystemExit("not a city model")
    _, nv, ni = struct.unpack("<III", blob[4:16])
    verts = np.frombuffer(blob, "<i2", nv * 3, 16).reshape(-1, 3).astype(np.float64) / 100
    idx = np.frombuffer(blob, "<u4", ni, 16 + nv * 6).reshape(-1, 3).astype(np.int64)
    meta = json.loads((Path(model_dir) / f"{MODEL_NAME}.json").read_text(encoding="utf-8"))
    return verts[idx], meta


def cast(tris, origins, dirs):
    """Nearest hit (distance, triangle index) of each ray against the triangles; inf / -1 where none."""
    v0, e1, e2 = tris[:, 0], tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    best = np.full(len(dirs), np.inf)
    which = np.full(len(dirs), -1)
    for i, (o, d) in enumerate(zip(origins, dirs)):
        p = np.cross(d, e2)
        det = np.einsum("mk,mk->m", p, e1)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        tv = o - v0
        u = np.einsum("mk,mk->m", tv, p) * inv
        q = np.cross(tv, e1)
        v = (q @ d) * inv
        t = np.einsum("mk,mk->m", q, e2) * inv
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-6)
        if hit.any():
            t = np.where(hit, t, np.inf)
            j = int(np.argmin(t))
            best[i], which[i] = t[j], j
    return best, which


def near(centres, pts, radius):
    """Indices of the triangles whose centres lie within radius m (in plan) of the points' box."""
    lo, hi = pts[:, [0, 2]].min(0) - radius, pts[:, [0, 2]].max(0) + radius
    return np.nonzero((centres[:, 0] >= lo[0]) & (centres[:, 0] <= hi[0]) & (centres[:, 1] >= lo[1]) & (centres[:, 1] <= hi[1]))[0]


def wall_frame(wall):
    """The wall's along (u), up and outward unit vectors, and its plane's point at u = 0, y = 0 (planner)."""
    nx, nz = wall["normal"]
    normal = np.array([nx, 0.0, nz], dtype=np.float64)
    if wall["plane"]["axis"] == "z":
        along, origin = np.array([1.0, 0.0, 0.0]), np.array([0.0, 0.0, wall["plane"]["value"]])
    else:
        along, origin = np.array([0.0, 0.0, 1.0]), np.array([wall["plane"]["value"], 0.0, 0.0])
    if abs(float(along @ normal)) > 1e-9 or abs(np.hypot(nx, nz) - 1) > 1e-9:
        raise SystemExit(f"wall {wall['id']}: its normal must be a unit vector across its plane")
    return along, np.array([0.0, 1.0, 0.0]), normal, origin


def seed_key(feature):
    """What a feature's seed hashes: an office window's floor (its id up to its position), else its own id."""
    if feature.get("use") == "office":
        floor = re.match(r"^([a-z0-9-]+:f\d+)-[xz]", feature["id"])
        if floor is None:
            raise SystemExit(f"feature {feature['id']}: an office window's id names its floor (building:fN-x... or -z...)")
        return floor.group(1)
    return feature["id"]


def r3(v):
    return [round(float(c), 3) + 0.0 for c in v]


def place(tris, tn, centres, origin, along, up, normal, ground_y, u, h):
    """A rectangle's distance in front of its wall's survey plane (offset_m clear of the model's frontmost hit), or
    why the model cannot carry it."""
    (u0, u1), (h0, h1) = u, h
    nu = max(P["grid"], int(np.ceil((u1 - u0) / P["sample_m"])))
    nh = max(P["grid"], int(np.ceil((h1 - h0) / P["sample_m"])))
    us, hs = np.linspace(u0, u1, nu + 2)[1:-1], np.linspace(h0, h1, nh + 2)[1:-1]
    pts = np.array([origin + along * uu + up * (ground_y + hh) for hh in hs for uu in us])
    sel = near(centres, pts, P["near_m"])
    t, w = cast(tris[sel], pts + normal * P["probe_m"], np.tile(-normal, (len(pts), 1)))
    if not np.isfinite(t).all():
        return None, "no wall behind it"
    facing = tn[sel][w] @ normal
    depth = P["probe_m"] - t
    if float((facing >= P["facing_cos"]).mean()) < P["facing_share"]:
        return None, "the model's surface there does not face the street"
    if (np.abs(depth) > P["depth_tolerance_m"]).any():
        return None, f"the model's wall lies {float(np.max(np.abs(depth))):.2f} m from the survey's plane"
    if float(depth.max() - depth.min()) > P["spread_m"]:
        return None, f"the model's wall steps {float(depth.max() - depth.min()):.2f} m across it"
    return float(depth.max()) + P["offset_m"], None


def bake(survey_path, model_dir):
    survey = json.loads(Path(survey_path).read_text(encoding="utf-8"))
    tris, meta = load_model(model_dir)
    ground_y = meta["parameters"]["ground_y"]
    centres = tris.mean(1)[:, [0, 2]]
    tn = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    tn /= np.maximum(np.linalg.norm(tn, axis=1, keepdims=True), 1e-12)
    walls = {w["id"]: w for w in survey["walls"]}
    lights, dropped, blind, clipped, ids = [], [], [], [], set()
    for f in survey["features"]:
        fid = f["id"]
        if fid in ids:
            raise SystemExit(f"feature {fid} twice")
        ids.add(fid)
        if f["kind"] not in KINDS or f["light"] not in LIGHTS or (f["kind"] == "window") != ("use" in f):
            raise SystemExit(f"feature {fid}: kind {f['kind']}, light {f['light']}")
        if f["kind"] == "window" and f["use"] not in USES:
            raise SystemExit(f"feature {fid}: use {f['use']}")
        if f["wall"] not in walls:
            raise SystemExit(f"feature {fid}: no wall {f['wall']}")
        if f.get("use") == "blind":
            blind.append(fid)
            continue
        along, up, normal, origin = wall_frame(walls[f["wall"]])
        (u0, u1), (h0, h1) = f["u"], f["h"]
        if not (u0 < u1 and 0 <= h0 < h1):
            raise SystemExit(f"feature {fid}: an empty rectangle")
        # A long sign or shopfront follows the wall's jogs in pieces; a window is one piece.
        pieces = 1 if f["kind"] == "window" else max(1, int(np.ceil((u1 - u0) / P["segment_m"])))
        seed = round(unit_hash(f"{seed_key(f)}:seed"), 4)
        # The model's wall steps at its 3 m band edges: a sign or shopfront whose top crosses one keeps the part
        # below it, if that is most of it, so all its pieces end level.
        ph1 = h1
        if f["kind"] != "window":
            edges = [level - ground_y for level in band_levels(meta) if h0 + P["clip_keep"] * (h1 - h0) <= level - ground_y < h1]
            if edges:
                ph1 = max(edges) - 0.005
        fronts = []
        for k in range(pieces):
            pid = fid if pieces == 1 else f"{fid}:{k + 1}"
            pu0, pu1 = u0 + (u1 - u0) * k / pieces, u0 + (u1 - u0) * (k + 1) / pieces
            front, reason = place(tris, tn, centres, origin, along, up, normal, ground_y, (pu0, pu1), (h0, ph1))
            if reason is None and ph1 < h1:
                clipped.append({"id": pid, "top": round(ph1, 3)})
            if reason is not None:
                dropped.append({"id": pid, "reason": reason})
                continue
            fronts.append(front)
            centre = origin + along * ((pu0 + pu1) / 2) + up * (ground_y + (h0 + ph1) / 2) + normal * front
            lights.append({
                "id": pid, "kind": f["kind"], "light": f["light"], **({"use": f["use"]} if f["kind"] == "window" else {}),
                "seed": seed, "variant": round(unit_hash(f"{pid}:variant"), 4),
                "centre": r3(centre), "along": r3(along * (pu1 - pu0) / 2), "up": r3(up * (ph1 - h0) / 2),
                "span": [round(pu0 - u0, 3) + 0.0, round(u1 - u0, 3) + 0.0],
            })
        if f["kind"] in ("shop", "door") and fronts:
            front = max(fronts)
            mid_u = (u0 + u1) / 2
            probe = origin + along * mid_u + normal * (front + P["spill_probe_m"]) + up * (ground_y + 2.0)
            gsel = near(centres, probe[None], P["near_m"])
            gt, _ = cast(tris[gsel], probe[None], np.array([[0.0, -1.0, 0.0]]))
            floor_y = float(probe[1] - gt[0]) if np.isfinite(gt[0]) else ground_y
            reach = P["spill_reach_m"]
            spill = origin + along * mid_u + normal * (front + reach / 2)
            spill[1] = floor_y + P["spill_lift_m"]
            lights.append({
                "id": f"{fid}:spill", "kind": "spill", "light": f["light"], "seed": seed, "variant": round(unit_hash(f"{fid}:variant"), 4),
                "centre": r3(spill), "along": r3(along * ((u1 - u0) / 2 + P["spill_widen_m"])), "up": r3(normal * reach / 2),
                "span": [0.0, round(u1 - u0 + 2 * P["spill_widen_m"], 3)],
            })
    return survey, lights, dropped, blind, clipped


def band_levels(meta):
    """The heights (planner y) at which the model's bands step: its anchor plus whole multiples of its spacing."""
    spacing, anchor = meta["parameters"]["spacing"], meta["parameters"]["level_anchor_y"]
    return [anchor + spacing * k for k in range(-2, 12)]


def write(out_dir, survey_path, model_dir):
    survey, lights, dropped, blind, clipped = bake(survey_path, model_dir)
    counts = {kind: sum(1 for l in lights if l["kind"] == kind) for kind in ("window", "shop", "door", "sign", "spill")}
    out = {
        "schema": "venviewer.facade-lights.v1",
        "title": "Lit windows, shopfronts and signs across Glassford Street and along Garth Street, on the city model, for the Grand Hall at night",
        "frame": "the planner hall frame of merchant-city-v2.json (metres, y up)",
        "licence": survey["licence"],
        "method": __doc__.strip(),
        "parameters": P,
        "inputs": {
            "survey": {"file": Path(survey_path).name, "sha256": sha256(survey_path, text=True)},
            "model": {"file": f"{MODEL_NAME}.bin", "sha256": sha256(Path(model_dir) / f"{MODEL_NAME}.bin")},
        },
        "counts": {**counts, "lights": len(lights), "dropped": len(dropped), "blind": len(blind), "clipped": len(clipped)},
        "dropped": dropped,
        "blind": blind,
        "clipped": clipped,
        "lights": lights,
    }
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / OUT_FILE).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return out


def main():
    args = parse_args()
    out = write(args.out_dir, args.survey, args.model_dir)
    print(json.dumps(out["counts"]), file=sys.stderr)
    for d in out["dropped"]:
        print(f"dropped {d['id']}: {d['reason']}", file=sys.stderr)
    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, args.survey, args.model_dir)
            if (Path(tmp) / OUT_FILE).read_bytes() != (Path(args.out_dir) / OUT_FILE).read_bytes():
                raise SystemExit("the bake is not byte-identical run to run")
        print("check: byte-identical", file=sys.stderr)


if __name__ == "__main__":
    main()
