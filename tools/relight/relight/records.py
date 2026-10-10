"""Per-splat records: the finest level from the light model's tables, coarser levels by transfer."""
from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

from . import codec


def flags_for(cls, iso, reach, chand_id, centre_ids, cove, fixture, pane):
    """Model classes (0 interior, 1 embrasure, 2 exterior, 3 chandelier bulb, 4 dome lamp) to record flags."""
    c = np.asarray(cls).astype(np.uint8).copy()
    c[np.asarray(fixture) & (c <= 1)] = codec.CLASS_CH_FIXTURE
    c[np.asarray(cove)] = codec.CLASS_COVE
    c[np.asarray(pane)] = codec.CLASS_HIDDEN
    f = c.astype(np.uint8)
    f |= np.where(np.asarray(iso), codec.FLAG_ISO, 0).astype(np.uint8)
    f |= np.where(np.asarray(reach), codec.FLAG_SUN, 0).astype(np.uint8)
    centre = np.isin(np.asarray(chand_id), centre_ids) & np.isin(c, [codec.CLASS_CH_EMITTER, codec.CLASS_CH_FIXTURE])
    f |= np.where(centre, codec.FLAG_CH_CENTRE, 0).astype(np.uint8)
    return f


def transfer(src_pos, src_values, dst_pos, k=8, tree=None):
    """Inverse-distance blend of the k nearest source splats' values (for the coarser levels). tree: the cKDTree of
    src_pos (float64), built once by a caller that transfers many chunks or tiles from the same source; built here when
    None (fix round 1, M4: the same tree, so the same neighbours)."""
    tree = cKDTree(np.asarray(src_pos, np.float64)) if tree is None else tree
    d, i = tree.query(np.asarray(dst_pos, np.float64), k=k)
    return _blend(np.asarray(src_values), d, i, k)


def _blend(v, d, i, k):
    if k == 1:
        return v[i]
    w = 1.0 / np.maximum(d, 1e-4)
    w /= w.sum(1, keepdims=True)
    return (v[i] * w[..., None]).sum(1)


def transfer_nearest(src_values, dst_pos, k, tree):
    """(transfer(..., k, tree), the index of each destination's nearest source splat) from one k-neighbour query (k >= 2;
    fix round 1, M4: a coarser tile is transferred once). The nearest is the query's first neighbour where it is strictly
    nearer than the second; where they tie it is a k=1 query's answer, because a k=1 and a k>1 query may order tied
    neighbours differently (measured: 18 of the hall's 5,467,354 coarser splats). So both values are exactly those of
    transfer(k) and transfer(k=1) on the same tree."""
    if k < 2:
        raise ValueError("transfer_nearest needs k >= 2")
    P = np.asarray(dst_pos, np.float64)
    d, i = tree.query(P, k=k)
    near = i[:, 0].copy()
    tied = np.nonzero(d[:, 0] == d[:, 1])[0]
    if tied.size:
        near[tied] = tree.query(P[tied], k=1)[1]
    return _blend(np.asarray(src_values), d, i, k), near


# Covers and toggles (R1c, amendment A3). tools/skins (R1c Task 5) writes, in its geometry folder, covers.npz (each skin's
# frame and its relief envelope on 5 cm cells: wmin, wmax along the normal, NaN where it covers nothing) and toggles.json
# (axis-aligned E57 boxes: the toggleable objects, and the objects that must stay splats).
COVER_BELOW = 0.10      # a splat up to 10 cm behind the envelope's floor (wmin) is covered,
COVER_ABOVE = 0.03      # and up to 3 cm in front of its top (wmax),
COVER_SIGMA = 0.05      # plus twice its own largest scale, at most 5 cm.


def cover_test(pos, sigma_max, covers):
    """Each splat's wall group if a skin's envelope holds it (the cell under its centre, its depth within
    [wmin - 0.10, wmax + 0.03 + min(2 sigma_max, 0.05)]), else -1. covers: covers.npz as a dict."""
    P = np.asarray(pos, np.float64)
    smax = np.asarray(sigma_max, np.float64)
    out = np.full(len(P), -1, np.int64)
    cell = float(covers["cell"])
    wmin_all, wmax_all = np.asarray(covers["wmin"], np.float64), np.asarray(covers["wmax"], np.float64)
    for s in range(len(covers["ids"])):
        fr = np.asarray(covers["frames"][s], np.float64)
        o, u, v, n = fr[0:3], fr[3:6], fr[6:9], fr[9:12]
        rows, cols = (int(x) for x in covers["shapes"][s])
        off = int(covers["offsets"][s])
        D = P - o
        a, b, w = D @ u, D @ v, D @ n
        c = np.floor(a / cell).astype(np.int64)
        r = np.floor(b / cell).astype(np.int64)
        inside = (c >= 0) & (c < cols) & (r >= 0) & (r < rows) & (out < 0)
        if not inside.any():
            continue
        idx = off + r[inside] * cols + c[inside]
        lo = wmin_all[idx] - COVER_BELOW
        hi = wmax_all[idx] + COVER_ABOVE + np.minimum(2 * smax[inside], COVER_SIGMA)
        ok = np.isfinite(lo) & np.isfinite(hi) & (w[inside] >= lo) & (w[inside] <= hi)
        out[np.flatnonzero(inside)[ok]] = int(covers["groups"][s])
    return out


def in_boxes(pos, boxes):
    """Index of the first axis-aligned box (lo, hi) holding each splat, else -1."""
    P = np.asarray(pos, np.float64)
    out = np.full(len(P), -1, np.int64)
    for k, (lo, hi) in enumerate(boxes):
        hit = np.all((P > np.asarray(lo)) & (P < np.asarray(hi)), 1) & (out < 0)
        out[hit] = k
    return out


def apply_covers(flags, pos, sigma_max, covers, keep_boxes):
    """Class 7 for every interior splat a skin's envelope holds, unless a keep or toggle box holds it (the object stays a splat)."""
    group = cover_test(pos, sigma_max, covers)
    target = (group >= 0) & (in_boxes(pos, keep_boxes) < 0)
    out = np.asarray(flags, np.uint8).copy()
    out[target] = codec.cover_flags(out[target], group[target])
    return out


def apply_toggles(flags, pos, toggle_boxes):
    """toggle_boxes: [(lo, hi, toggle)]: the toggle of the first box holding each splat (class 7 excepted)."""
    k = in_boxes(pos, [(lo, hi) for lo, hi, _t in toggle_boxes])
    out = np.asarray(flags, np.uint8).copy()
    hit = k >= 0
    if hit.any():
        toggles = np.array([t for _lo, _hi, t in toggle_boxes], np.int64)
        out[hit] = codec.toggle_flags(out[hit], toggles[k[hit]])
    return out


def load_skin_inputs(geometry_dir):
    """tools/skins' geometry (R1c Task 5): covers.npz, and toggles.json's toggle boxes and keep boxes."""
    import json, os
    with np.load(os.path.join(geometry_dir, "covers.npz")) as z:
        covers = {k: z[k] for k in z.files}
    with open(os.path.join(geometry_dir, "toggles.json"), encoding="utf-8") as f:
        t = json.load(f)
    toggles = [(np.asarray(b["lo"], np.float64), np.asarray(b["hi"], np.float64), int(b["bit"])) for b in t["toggles"]]
    keep = [(np.asarray(b["lo"], np.float64), np.asarray(b["hi"], np.float64)) for b in t["keep"]] + [(lo, hi) for lo, hi, _t in toggles]
    return covers, toggles, keep
