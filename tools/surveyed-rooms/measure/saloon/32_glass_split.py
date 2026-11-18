"""Where each bay's glass changes plane, and how deep each plane sits, on the twin's mesh
(added 18 October 2026, after the config's `glass.planes[0].below` was flagged as unmeasured).

Rays along E57 +X from inside the room (X 1.2) into each bay, across the glazed width
(|dY| <= 0.75, inside the 0.81 sash half-width, every 3 cm) and up the window (planner v 3.0 to
4.3 in 5 mm rows). A hit's depth behind the wall face (X 1.669) is assigned to the nearer of the
config's two planes when it lies within 0.05 m of one. Per row, the share on the upper plane;
the split is the row boundary that misassigns the fewest rows (ties: the middle of the tied
range). Then each plane's median depth over height bands clear of the transom.

Run after 01-31 (it needs only the decoded mesh); writes <out>/glass-split.json.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, load_mesh  # noqa: E402

FACE_X, FLOOR_Z = 1.669, 0.002            # the window wall's face (E57 X) and the floor (config)
PLANES = (0.546, 0.596)                   # the config's planes, behind the face
CONFIG_SPLIT = 3.52
BAYS = {"window-front": 4.926, "window-centre": 7.499, "window-rear": 10.075}
TOL = 0.05

P, I, _ = load_mesh()
A, B, C = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
lo = np.minimum(np.minimum(A, B), C)
hi = np.maximum(np.maximum(A, B), C)
sel = (hi[:, 0] > FACE_X - 0.05) & (lo[:, 0] < FACE_X + 0.9) & (hi[:, 2] > 1.0) & (lo[:, 2] < 5.5)
A, B, C, lo, hi = A[sel], B[sel], C[sel], lo[sel], hi[sel]
E1, E2 = B - A, C - A


def depth_at(y, z, x0=1.2):
    """Depth behind the face of the first surface along +X from (x0, y, z), or nan."""
    m = (lo[:, 1] <= y) & (hi[:, 1] >= y) & (lo[:, 2] <= z) & (hi[:, 2] >= z) & (hi[:, 0] >= x0)
    idx = np.nonzero(m)[0]
    if len(idx) == 0:
        return np.nan
    d = np.array([1.0, 0.0, 0.0])
    o = np.array([x0, y, z])
    e1, e2, a = E1[idx], E2[idx], A[idx]
    p = np.cross(d, e2)
    det = (e1 * p).sum(1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    s = o - a
    u = (s * p).sum(1) * inv
    q = np.cross(s, e1)
    v = (q @ d) * inv
    t = (e2 * q).sum(1) * inv
    hit = ok & (u >= -1e-9) & (v >= -1e-9) & (u + v <= 1 + 1e-9) & (t > 1e-6)
    return x0 + float(np.min(np.where(hit, t, np.inf))) - FACE_X if hit.any() else np.nan


def split(yc):
    rows = np.round(np.arange(3.0, 4.3, 0.005), 4)
    offsets = np.arange(-0.75, 0.7501, 0.03)
    share, used = [], []
    for v in rows:
        depth = np.array([depth_at(yc + dy, FLOOR_Z + v) for dy in offsets])
        on = (np.abs(depth - PLANES[0]) < TOL) | (np.abs(depth - PLANES[1]) < TOL)
        upper = on & (np.abs(depth - PLANES[1]) < np.abs(depth - PLANES[0]))
        used.append(int(on.sum()) >= 10)
        share.append(upper.sum() / max(int(on.sum()), 1))
    used, vote = np.array(used), np.array(share) >= 0.5
    best, best_err = [], None
    for k in range(1, len(rows)):
        s = (rows[k - 1] + rows[k]) / 2
        err = int((vote & used & (rows < s)).sum() + (~vote & used & (rows > s)).sum())
        if best_err is None or err < best_err:
            best, best_err = [s], err
        elif err == best_err:
            best.append(s)
    return dict(split=round(float(np.mean([best[0], best[-1]])), 4), tied=[round(float(best[0]), 4), round(float(best[-1]), 4)],
                misassignedRows=best_err, rows=int(used.sum()),
                ramp=[round(float(v), 3) for v, f in zip(rows, share) if 0.05 < f < 0.95])


def plane_depth(yc, v0, v1):
    d = np.array([depth_at(yc + dy, FLOOR_Z + v) for v in np.arange(v0, v1, 0.02) for dy in np.arange(-0.75, 0.7501, 0.05)])
    d = d[np.isfinite(d)]
    return dict(band=[v0, v1], n=int(len(d)), median=round(float(np.median(d)), 4),
                p10=round(float(np.percentile(d, 10)), 4), p90=round(float(np.percentile(d, 90)), 4))


out = {}
for bay, yc in BAYS.items():
    out[bay] = dict(split=split(yc), lower=plane_depth(yc, 2.4, 3.35), upper=plane_depth(yc, 3.65, 4.45))
    s = out[bay]["split"]
    print(f"{bay}: plane changes at v {s['split']:.3f} (config {CONFIG_SPLIT}), {s['misassignedRows']} of {s['rows']} rows "
          f"misassigned; mixed rows {s['ramp'][:1]}..{s['ramp'][-1:]}; lower {out[bay]['lower']['median']:.3f}, "
          f"upper {out[bay]['upper']['median']:.3f} (config {PLANES})")
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "glass-split.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(dict(configSplit=CONFIG_SPLIT, configPlanes=PLANES, bays=out), f, indent=1)
