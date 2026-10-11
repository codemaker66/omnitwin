"""Per-source bounce light on a coarse probe grid (spec 4.2).

Radiosity is linear in the direct light, so each source's bounce is solved on its own with a white
unit source; the browser multiplies by the source's colour and weight. The sun's bounce is not
carried here: sunbounce.py bakes it exactly per sun direction.

The bake's grids (Task 4d, amended 11 October) are box_grid and box_valid: they cover the probes' lookup box, the
proof's own (z up to 9.8 m), so the dome and the space above the flat ceiling read probes where they are, and the walls'
and the floor's planes are valid. coarse_grid and valid_mask are Task 4's first grids (z to the flat ceiling, the low
faces invalid), kept for the tests of the lookup's rule.
"""
from __future__ import annotations

import numpy as np

GRID_TOLERANCE = 1e-9    # metres: a probe on a wall or on the floor counts as inside


def coarse_grid(hall, spacing):
    lo = np.array([hall["x0"], hall["y0"], hall["floorZ"]], np.float64)
    hi = np.array([hall["x1"], hall["y1"], hall["ceilingZ"]], np.float64)
    shape = np.floor((hi - lo) / spacing + 1e-9).astype(np.int64) + 1
    axes = [lo[i] + np.arange(shape[i]) * spacing for i in range(3)]
    X, Y, Z = np.meshgrid(*axes, indexing="ij")
    return np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1), shape, lo


def valid_mask(P, hall, inset=0.02):
    return ((P[:, 0] >= hall["x0"] + inset) & (P[:, 0] <= hall["x1"] - inset)
            & (P[:, 1] >= hall["y0"] + inset) & (P[:, 1] <= hall["y1"] - inset)
            & (P[:, 2] >= hall["floorZ"] + inset) & (P[:, 2] <= hall["ceilingZ"] - inset))


def box_grid(hall, spacing, top):
    """(P (M, 3), shape, origin): the probe grid over the probes' lookup box (Task 4d). Planes every `spacing` from the
    hall box's low corner (x0, y0, floorZ), as coarse_grid lays them: in x and y up to the box's far walls, in z up to
    the first plane at or above `top` (the lookup's top: store.Probes.lookup clamps z to 9.8 m), so every position the
    lookup reads lies between two of its planes. Probe (ix ny + iy) nz + iz."""
    lo = np.array([hall["x0"], hall["y0"], hall["floorZ"]], np.float64)
    far = np.array([hall["x1"], hall["y1"]], np.float64)
    nxy = np.floor((far - lo[:2]) / spacing + 1e-9).astype(np.int64) + 1
    nz = int(np.ceil((float(top) - lo[2]) / spacing - 1e-9)) + 1
    shape = np.array([nxy[0], nxy[1], nz], np.int64)
    axes = [lo[i] + np.arange(shape[i]) * spacing for i in range(3)]
    X, Y, Z = np.meshgrid(*axes, indexing="ij")
    return np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1), shape, lo


def box_valid(P, hall):
    """(M,) bool: the probes inside the hall box's walls and on or above its floor (Task 4d), the walls' and the floor's
    own planes and every plane above the flat ceiling included, so a read near a wall, on the floor or in the dome finds
    its corners where it is."""
    P = np.asarray(P, np.float64)
    t = GRID_TOLERANCE
    return ((P[:, 0] >= hall["x0"] - t) & (P[:, 0] <= hall["x1"] + t) & (P[:, 1] >= hall["y0"] - t)
            & (P[:, 1] <= hall["y1"] + t) & (P[:, 2] >= hall["floorZ"] - t))


def patch_direct_by_source(patches, sky_w):
    """(P, 9) direct light per patch; each window combines its facade and sky bands with the capture's sky_w."""
    cols = [np.asarray(patches["E_win"][:, 4 * w:4 * w + 4], np.float64) @ sky_w for w in range(5)]
    cols += [patches["E_cove"], patches["E_ch"][:, 0], patches["E_ch"][:, 1], patches["E_dome"]]
    return np.stack([np.asarray(c, np.float64) for c in cols], 1).astype(np.float32)


def bounce_probes(radiosity_mod, patches, rho, sky_w, probe_points):
    """(M, 9, 3, 6) indirect ambient cubes per source at the probe points (white unit sources)."""
    F = radiosity_mod.form_factors(patches["P"], patches["N"], patches["A"], patches["opening"])
    Edir = patch_direct_by_source(patches, sky_w)
    B = radiosity_mod.radiosity(F, rho, Edir)                        # (P, 9, 3)
    return radiosity_mod.probe_indirect(probe_points, patches, B).numpy().astype(np.float32)


def cube_luminance(cubes, lumw):
    """(..., 3, 6) ambient cubes -> (...,) float64: the luminance (weights lumw) of the six faces' mean, lt.cube_eval's
    value for an isotropic receiver."""
    return np.asarray(cubes, np.float64).mean(-1) @ np.asarray(lumw, np.float64)
