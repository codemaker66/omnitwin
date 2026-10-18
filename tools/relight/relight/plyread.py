"""The photo-trained hall's splats as the light model's per-splat tables (T-639 re-aim, 18 October 2026).

The pano lane's trainer writes a standard 3DGS PLY (train.export_ply): float32, binary little endian, in HallFrame (the
old vendor tiles' frame), with x y z nx ny nz f_dc_0..2 f_rest_0..44 opacity scale_0..2 rot_0..3, where opacity is a
logit, the scales are logs and rot is a unit quaternion (w, x, y, z). The day state's base colour is f_dc; the evening
state's is a separate (N, 3) float32 array (evening_f_dc.npy) over the same splats. Colour is display sRGB, as the
vendor tiles' was (train.py: the room colour is C0 dc + 0.5, converted to linear only for the floor reflection layer).

tables() returns what proof/01_extract.py wrote for the vendor tiles, element for element: pos (N, 3) f32 in the E57
frame, nrm (N, 3) f16 the unit axis of the smallest scale (sign arbitrary), scl (N, 3) f16 sorted scales in metres, opa
(N,) f16, rgb (N, 3) u8 the stored DC colour as the product packs it, tile (N,) u8 (0: one master), and rgb_eve (N, 3)
u8 for the evening state when its file is given. The file is memory-mapped and read in chunks."""
from __future__ import annotations

import os

import numpy as np

SH_C0 = 0.28209479177387814
FIELDS = (["x", "y", "z", "nx", "ny", "nz"] + ["f_dc_%d" % i for i in range(3)] + ["f_rest_%d" % i for i in range(45)]
          + ["opacity"] + ["scale_%d" % i for i in range(3)] + ["rot_%d" % i for i in range(4)])


def header(path) -> tuple[int, list[str], int]:
    """(vertex count, property names, data offset) of a binary little-endian PLY of float32 properties; refuses another
    layout or a file whose size is not the header's count times its row."""
    with open(path, "rb") as f:
        raw = b""
        while not raw.endswith(b"end_header\n"):
            chunk = f.read(1)
            if not chunk or len(raw) > 65536:
                raise ValueError(f"{path}: no PLY header")
            raw += chunk
    lines = raw.decode("ascii").splitlines()
    if lines[0] != "ply" or lines[1] != "format binary_little_endian 1.0":
        raise ValueError(f"{path}: not a binary little-endian PLY")
    n, names = None, []
    for line in lines[2:]:
        parts = line.split()
        if parts[:2] == ["element", "vertex"]:
            n = int(parts[2])
        elif parts[:1] == ["property"]:
            if parts[1] != "float":
                raise ValueError(f"{path}: property {parts[-1]} is {parts[1]}, not float")
            names.append(parts[2])
        elif parts[:1] == ["element"]:
            raise ValueError(f"{path}: a second element ({parts[1]})")
    if n is None:
        raise ValueError(f"{path}: no vertex element")
    if os.path.getsize(path) != len(raw) + n * len(names) * 4:
        raise ValueError(f"{path}: {os.path.getsize(path)} bytes, not {len(raw)} + {n} x {len(names)} x 4")
    return n, names, len(raw)


def _rotations(q_xyzw):
    """(n, 3, 3), columns the local axes: sog-floor-census.quat_to_rot's formula, quaternion (x, y, z, w)."""
    x, y, z, w = q_xyzw[:, 0], q_xyzw[:, 1], q_xyzw[:, 2], q_xyzw[:, 3]
    R = np.empty((q_xyzw.shape[0], 3, 3), dtype=np.float64)
    R[:, 0, 0] = 1 - 2 * (y * y + z * z); R[:, 0, 1] = 2 * (x * y - z * w);     R[:, 0, 2] = 2 * (x * z + y * w)
    R[:, 1, 0] = 2 * (x * y + z * w);     R[:, 1, 1] = 1 - 2 * (x * x + z * z); R[:, 1, 2] = 2 * (y * z - x * w)
    R[:, 2, 0] = 2 * (x * z - y * w);     R[:, 2, 1] = 2 * (y * z + x * w);     R[:, 2, 2] = 1 - 2 * (x * x + y * y)
    return R


def _stored(dc):
    """The product's stored colour: (0.5 + C0 dc) x 255, rounded and clamped (proof/01_extract.py)."""
    return np.clip(np.round((0.5 + SH_C0 * np.asarray(dc, np.float64)) * 255.0), 0, 255).astype(np.uint8)


def tables(path, transform, evening_dc=None, chunk=1_000_000) -> dict:
    """The per-splat tables of the PLY at `path` (see the module docstring); transform is T_json_from_e57 (4 x 4), so
    E57 = (P - t) R as 01_extract applies it; evening_dc the evening base colour's .npy (same splat count) or None."""
    n, names, offset = header(path)
    missing = [f for f in FIELDS if f not in names]
    if missing:
        raise ValueError(f"{path}: missing properties {missing[:5]}")
    col = {nm: i for i, nm in enumerate(names)}
    rows = np.memmap(path, dtype="<f4", mode="r", offset=offset, shape=(n, len(names)))
    eve = None
    if evening_dc is not None:
        eve = np.load(evening_dc, mmap_mode="r")
        if eve.shape != (n, 3):
            raise ValueError(f"{evening_dc}: shape {eve.shape}, not ({n}, 3)")
    T = np.asarray(transform, np.float64)
    R_je, t_je = T[:3, :3], T[:3, 3]
    out = {"pos": np.empty((n, 3), np.float32), "nrm": np.empty((n, 3), np.float16), "scl": np.empty((n, 3), np.float16),
           "opa": np.empty(n, np.float16), "rgb": np.empty((n, 3), np.uint8), "tile": np.zeros(n, np.uint8)}
    if eve is not None:
        out["rgb_eve"] = np.empty((n, 3), np.uint8)
    xyz = [col[k] for k in ("x", "y", "z")]
    dc = [col["f_dc_%d" % i] for i in range(3)]
    sc = [col["scale_%d" % i] for i in range(3)]
    rot = [col["rot_%d" % i] for i in (1, 2, 3, 0)]                       # (w, x, y, z) -> (x, y, z, w)
    for a in range(0, n, chunk):
        b = min(n, a + chunk)
        r = np.asarray(rows[a:b], np.float64)
        scales = np.exp(r[:, sc])
        q = r[:, rot]
        q /= np.linalg.norm(q, axis=1, keepdims=True)
        Rm = _rotations(q)
        k = np.argmin(scales, axis=1)
        nrm_j = Rm[np.arange(b - a), :, k]
        out["pos"][a:b] = ((r[:, xyz] - t_je) @ R_je).astype(np.float32)
        out["nrm"][a:b] = (nrm_j @ R_je).astype(np.float16)
        out["scl"][a:b] = np.sort(scales, axis=1).astype(np.float16)
        out["opa"][a:b] = (1.0 / (1.0 + np.exp(-r[:, col["opacity"]]))).astype(np.float16)
        out["rgb"][a:b] = _stored(r[:, dc])
        if eve is not None:
            out["rgb_eve"][a:b] = _stored(eve[a:b])
    return out
