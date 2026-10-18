"""Shared loaders for the Saloon measurement pass (E57 frame, Z up, metres)."""
import json
import struct
import numpy as np

import os

# The work directory: the twin's manifest.json, mesh/dollhouse.glb and pano512/
# (tools/grand-hall-survey/fetch_inputs.py), and the decoded mesh under mesh/
# (positions.f32, indices.u32, chunks.u16 from tools/grand-hall-survey/dump-mesh.mjs).
ROOT = os.environ.get("ROOMS_SURVEY_WORK", "work")
OUT = os.environ.get("SALOON_MEASURE_OUT", ROOT + "/saloon-measure")
MESH = ROOT + "/mesh/"
GLB = ROOT + "/dollhouse.glb"
MANIFEST = ROOT + "/manifest.json"
PANO = ROOT + "/pano512/"

# Proposed planner frame (research plan, section 1): x = 7.565 - Y, y = Z - floorZ, z = -2.065 - X
PLANNER_CENTRE = (-2.065, 7.565)


def load_mesh():
    P = np.fromfile(MESH + "positions.f32", dtype=np.float32).reshape(-1, 3).astype(np.float64)
    I = np.fromfile(MESH + "indices.u32", dtype=np.uint32).reshape(-1, 3).astype(np.int64)
    C = np.fromfile(MESH + "chunks.u16", dtype=np.uint16)
    return P, I, C


def tri_geometry(P, I):
    a, b, c = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
    n = np.cross(b - a, c - a)
    area2 = np.linalg.norm(n, axis=1)
    nn = n / np.maximum(area2, 1e-12)[:, None]
    cen = (a + b + c) / 3
    return a, b, c, nn, area2 / 2, cen


def load_manifest():
    return json.load(open(MANIFEST, encoding="utf8"))


def stations():
    m = load_manifest()
    out = {}
    for n in m["nodes"]:
        out[int(n["id"][5:])] = dict(id=n["id"], t=np.array(n["pose"]["t"], float),
                                    q=np.array(n["pose"]["q"], float), exposure=n["exposure"])
    return out, m


def glb_json():
    b = open(GLB, "rb").read()
    cl, ct = struct.unpack("<II", b[12:20])
    return json.loads(b[20:20 + cl]), b


def to_planner(X, Y, Z=None, floor=0.0):
    """E57 -> proposed Saloon planner frame."""
    x = PLANNER_CENTRE[1] - np.asarray(Y)
    z = PLANNER_CENTRE[0] - np.asarray(X)
    if Z is None:
        return x, z
    return x, np.asarray(Z) - floor, z


def slice_segments(a, b, c, z0):
    """Segments where triangles cross the horizontal plane Z = z0.
    Returns (M,2,2) XY endpoints and the triangle index of each."""
    za, zb, zc = a[:, 2] - z0, b[:, 2] - z0, c[:, 2] - z0
    s = np.sign(np.stack([za, zb, zc], 1))
    idx = np.nonzero((s.min(1) < 0) & (s.max(1) > 0))[0]
    A, B, Cc = a[idx], b[idx], c[idx]
    ZA, ZB, ZC = za[idx], zb[idx], zc[idx]
    segs = np.zeros((len(idx), 2, 2))
    cnt = np.zeros(len(idx), int)
    for (P0, P1, z0_, z1_) in ((A, B, ZA, ZB), (B, Cc, ZB, ZC), (Cc, A, ZC, ZA)):
        m = (np.sign(z0_) * np.sign(z1_)) < 0
        t = z0_[m] / (z0_[m] - z1_[m])
        q = P0[m, :2] + (P1[m, :2] - P0[m, :2]) * t[:, None]
        rows = np.nonzero(m)[0]
        for k in (0, 1):
            sel = cnt[rows] == k
            segs[rows[sel], k] = q[sel]
            cnt[rows[sel]] += 1
            rows, q = rows[~sel], q[~sel]
    ok = cnt == 2
    return segs[ok], idx[ok]
