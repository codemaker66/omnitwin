"""Direct light of the nine sources on the floor skin's grid, at 5 cm texels, normal +z (the model frame's up).

The light maps cover the floor skin's grid (floor-skin.json, schema venviewer.floor-skin.v1): light-map texel (c, r)
is the block of skin texels around skin column (c + 0.5) widthPx / w and row (r + 0.5) heightPx / h, mapped to the
capture frame as lib/floor-skin.ts maps them (origin + uAxis col + vAxis row, the inverse of captureToMaskMatrix within
the skin's plane), moved to the model frame (e57) and lifted 2 cm above the skin's fitted plane. Row 0 is the skin's
row 0, the first PNG row. texelToModel maps (col, row, 0, 1) to exactly these points.
"""
from __future__ import annotations

import numpy as np

AFFINE_TOLERANCE = 1e-9   # metres: texel_to_model must reproduce every point to this


def floor_grid(floor_manifest, texel):
    """Texel counts and size of the floor at `texel` metres over the floor skin's grid extent."""
    g = floor_manifest["grid"]
    width_m, height_m = g["widthPx"] * g["texelM"], g["heightPx"] * g["texelM"]
    return {"w": int(round(width_m / texel)), "h": int(round(height_m / texel)), "width": width_m, "height": height_m}


def capture_centres(floor_manifest, grid):
    """(h, w, 3) float64 capture-frame centres of the light-map texels, row 0 first: origin + uAxis col + vAxis row at
    skin column (c + 0.5) widthPx / w and row (r + 0.5) heightPx / h."""
    g = floor_manifest["grid"]
    origin, u, v = (np.asarray(g[k], np.float64) for k in ("origin", "uAxis", "vAxis"))
    cols = (np.arange(grid["w"]) + 0.5) * (g["widthPx"] / grid["w"])
    rows = (np.arange(grid["h"]) + 0.5) * (g["heightPx"] / grid["h"])
    return origin + cols[None, :, None] * u + rows[:, None, None] * v


def model_plane(floor_manifest, capture_from_model):
    """The skin's fitted plane in the model frame: (n, d) with n . p = d. The manifest's plane is n_c . p = d_c with
    n_c normalised (captureToMaskMatrix's signed distance n_c . p - d_c); a capture point is R p + t for the model point
    p, where capture_from_model = [[R, t], [0, 1]] (common.T_JE), so n = R^T n_c and d = d_c - n_c . t."""
    n_c = np.asarray(floor_manifest["plane"]["normal"], np.float64)
    n_c = n_c / np.linalg.norm(n_c)
    T = np.asarray(capture_from_model, np.float64)
    return T[:3, :3].T @ n_c, float(floor_manifest["plane"]["d"]) - float(n_c @ T[:3, 3])


def lift_to_plane(points, plane, lift):
    """points (..., 3) with z set to the plane's height at their x, y plus `lift` metres."""
    n, d = plane
    out = np.array(points, np.float64)
    out[..., 2] = (d - n[0] * out[..., 0] - n[1] * out[..., 1]) / n[2] + lift
    return out


def texel_to_model(points):
    """(4, 4) row-major matrix taking a texel centre's (col, row, 0, 1) to its point in `points` (h, w, 3): columns
    0 and 1 are the steps along a row and down the rows, column 3 is texel (0, 0) and column 2 is 0. Raises ValueError
    unless it reproduces every point within AFFINE_TOLERANCE."""
    P = np.asarray(points, np.float64)
    h, w = P.shape[:2]
    if h < 2 or w < 2:
        raise ValueError("texel_to_model needs at least 2 x 2 texels")
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = P[0, 1] - P[0, 0], P[1, 0] - P[0, 0], 0.0, P[0, 0]
    rows, cols = np.meshgrid(np.arange(h, dtype=np.float64), np.arange(w, dtype=np.float64), indexing="ij")
    mapped = M[:3, 0] * cols[..., None] + M[:3, 1] * rows[..., None] + M[:3, 3]
    worst = float(np.abs(mapped - P).max())
    if not worst <= AFFINE_TOLERANCE:
        raise ValueError(f"the texel centres are not an affine grid: {worst:.3g} m off")
    return M


def patch_direct(lt, trilinear_weights, volume, house, box, q, normals, chunk=20_000):
    """The proof's patch direct light (proof/03_bases.py, the block that fills Pw, Pch, Pdome and Pcove before
    patches.npz is saved) at points q (M, 3), model frame, with normals (M, 3) (not isotropic). Returns
    {"E_win": (M, 20), "E_ch": (M, 2), "E_dome": (M,), "E_cove": (M,)} float32, as patches.npz holds them.
    Window light: the probe volume's window cubes (volume: cubes (probes, 20, 6), origin, shape, keep) trilinear at q
    clamped into the hall box (x0 + 0.02 .. x1 - 0.02, y0 + 0.02 .. y1 - 0.02, floor + 0.02 .. 9.8). Chandeliers (end
    four summed, centre) and the dome ring are unit point lights from q (rmin 0.30; the ring seen only through the dome
    opening); the cove is the proof's upward line source. lt and trilinear_weights are the proof's (lt.py, 03_bases.py)."""
    import torch
    x0, x1, y0, y1, floor_z = box
    q = np.asarray(q, np.float64)
    m = len(q)
    out = {"E_win": np.zeros((m, 20), np.float32), "E_ch": np.zeros((m, 2), np.float32),
           "E_dome": np.zeros(m, np.float32), "E_cove": np.zeros(m, np.float32)}
    keep = np.asarray(volume["keep"]).astype(np.float32)
    ring = np.asarray(house["ring"])
    for a in range(0, m, chunk):
        qa = q[a:a + chunk]
        npt = torch.from_numpy(np.asarray(normals[a:a + chunk], np.float64)).float()
        isop = torch.zeros(len(qa), dtype=torch.bool)
        qq = np.c_[np.clip(qa[:, 0], x0 + 0.02, x1 - 0.02), np.clip(qa[:, 1], y0 + 0.02, y1 - 0.02),
                   np.clip(qa[:, 2], floor_z + 0.02, 9.8)]
        idx, w, _ok = trilinear_weights(qq, volume["origin"], volume["shape"], keep)
        cube = (torch.from_numpy(volume["cubes"][idx].astype(np.float32)) * torch.from_numpy(w)[..., None, None]).sum(1)
        out["E_win"][a:a + chunk] = lt.cube_eval(cube, npt, isop).numpy()
        qc = torch.from_numpy(qa).float()
        e = lt.cube_eval(lt.point_cubes(qc, house["chandeliers"], rmin=0.30), npt, isop).numpy()
        out["E_ch"][a:a + chunk] = np.stack([e[:, [0, 1, 3, 4]].sum(1), e[:, 2]], 1)
        if len(ring):
            lit = lt.point_cubes(qc, ring, rmin=0.30) * lt.dome_visible(qc, ring, house["dome_c"])[..., None]
            out["E_dome"][a:a + chunk] = lt.cube_eval(lit, npt, isop).sum(1).numpy()
        out["E_cove"][a:a + chunk] = lt.cube_eval(lt.cove_cubes(qa), npt, isop).numpy()
    return out
