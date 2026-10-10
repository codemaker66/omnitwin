"""The skins' light (R1c, amendment A4): R1a's floor light model at every light texel of every skin (its `lightTexel`:
5 cm, 2 cm on the frieze; the nine sources' direct light, white and unit, the windows with the capture's sky weights, at
the texel's centre 2 cm in front of its bay plane with the height field's normal), packed as R1a records with the skins'
own ranges; each skin's share of sun-reachable texels on its 2 cm sun grid; and relight package v2's skins section built
from them."""
from __future__ import annotations

import gzip, hashlib, json, os, posixpath

import numpy as np

from . import codec

VISIBILITY = {"toggles": {"clutter": 1, "cabinet": 2}, "defaultHidden": 1}   # the loose clutter hidden, the cabinet shown


def skin_light_grids(path):
    """tools/skins' light-grids.json (R1c Task 5), each skin with its light texels' normals loaded."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    root = os.path.dirname(path)
    out = []
    for e in data["skins"]:
        w, h = (int(v) for v in e["size"])
        normals = np.load(os.path.join(root, e["normals"])).astype(np.float64)
        if normals.shape != (h, w, 3):
            raise ValueError(f"{e['id']}: normals {normals.shape}, expected {(h, w, 3)}")
        sun = e.get("sun")
        out.append({"id": e["id"], "group": int(e["group"]), "lightTexel": float(e["lightTexel"]), "size": (w, h),
                    "texelToModel": np.asarray(e["texelToModel"], np.float64).reshape(4, 4), "normals": normals,
                    "sun": None if sun is None else {"size": tuple(int(v) for v in sun["size"]),
                                                    "texelToModel": np.asarray(sun["texelToModel"], np.float64).reshape(4, 4)}})
    return out


def grid_points(M, size):
    """Every texel's centre, M @ (column, row, 0, 1), row-major."""
    w, h = size
    rows, cols = np.meshgrid(np.arange(h, dtype=np.float64), np.arange(w, dtype=np.float64), indexing="ij")
    return (M[:3, 0] * cols[..., None] + M[:3, 1] * rows[..., None] + M[:3, 3]).reshape(-1, 3)


def pack_skin_records(D, normals, ranges):
    return codec.pack_records(D, normals, np.full(len(D), codec.CLASS_INTERIOR, np.uint8), ranges)


def skins_section(skin_light_dir, skin_package_dir, groups):
    """Relight package v2's `skins` section and its files ({relative path: gzip bytes}) from the skin-light output and the
    skin package (whose manifest it pins by SHA-256)."""
    with open(os.path.join(skin_light_dir, "index.json"), encoding="utf-8") as f:
        index = json.load(f)
    with open(os.path.join(skin_package_dir, "manifest.json"), "rb") as f:
        manifest_bytes = f.read()
    package = posixpath.join(*os.path.normpath(skin_package_dir).replace("\\", "/").split("/")[-2:])
    if not package.startswith("skins/"):
        raise ValueError(f"{skin_package_dir} is not a skins/<version> folder")
    entries, files = [], {}
    for s in index["skins"]:
        with open(os.path.join(skin_light_dir, f"{s['id']}.records"), "rb") as f:
            data = f.read()
        w, h = s["size"]
        if len(data) != w * h * codec.RECORD_BYTES:
            raise ValueError(f"{s['id']}: {len(data)} bytes for {w} x {h} light texels")
        gz = gzip.compress(data, compresslevel=9, mtime=0)
        rel = posixpath.join("skins", f"{s['id']}.light.gz")
        files[rel] = gz
        M = np.asarray(s["texelToModel"], np.float64).reshape(4, 4)
        n = np.cross(M[:3, 1], M[:3, 0])
        n = n / np.linalg.norm(n)
        entries.append({"id": s["id"], "group": int(s["group"]), "size": [int(w), int(h)], "texelToModel": [float(x) for x in M.ravel()],
                        "normal": [float(x) for x in n], "file": rel, "sha256": hashlib.sha256(gz).hexdigest(), "bytes": len(gz),
                        "sun": s["sun"]})
    section = {"package": package, "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
               "encoding": [[float(lo), float(hi)] for lo, hi in index["ranges"]], "groups": list(groups), "entries": entries}
    return section, files
