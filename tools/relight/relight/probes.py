"""Per-source bounce light on a coarse probe grid (spec 4.2).

Radiosity is linear in the direct light, so each source's bounce is solved on its own with a white
unit source; the browser multiplies by the source's colour and weight. The sun's bounce is not
carried here: sunbounce.py bakes it exactly per sun direction.
"""
from __future__ import annotations

import numpy as np


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
