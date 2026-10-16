"""Per-source bounce light on a coarse probe grid (spec 4.2).

Radiosity is linear in the direct light, so each source's bounce is solved on its own with a white
unit source; the browser multiplies by the source's colour and weight. The sun's bounce is not
carried here: sunbounce.py bakes it exactly per sun direction.

The bake's grids (Task 4d, amended 11 October) are box_grid and box_valid: they cover the probes' lookup box, the
proof's own (z up to 9.8 m), so the dome and the space above the flat ceiling read probes where they are, every probe
valid, with their planes off the walls and the floor (variant B, the ruling of 13 October: box_origin). coarse_grid and
valid_mask are Task 4's first grids (z to the flat ceiling, the low faces invalid), kept for the tests of the lookup's
rule and for the bands of the sky basis's K rule.
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


PROOF_PLANE_Z = 0.1      # metres: the proof's lowest kept probe plane (03_bases.probe_grid: z from -0.1 every 0.2 m)


def box_origin(hall, base):
    """(3,) the grids' origin off the surfaces (Task 4d variant B, the ruling of 13 October): in x and y the hall box's
    extent over whole `base` steps leaves a remainder, split evenly between the two walls (0.065 m in the Grand Hall at
    0.5 m), and z is the proof's lowest kept plane (0.08 m above the Grand Hall's floor). A probe on a surface, or a few
    centimetres from one, reads the sky bodies' bounce where it is spatially sharp (task-4d-report.md, the A/B)."""
    if not float(hall["floorZ"]) < PROOF_PLANE_Z:
        raise ValueError(f"the floor at {hall['floorZ']} m is not below the proof's lowest probe plane {PROOF_PLANE_Z} m")
    lo = np.array([hall["x0"], hall["y0"]], np.float64)
    extent = np.array([hall["x1"], hall["y1"]], np.float64) - lo
    margin = (extent - base * np.floor(extent / base + 1e-9)) / 2
    return np.array([*(lo + margin), PROOF_PLANE_Z], np.float64)


def box_grid(hall, spacing, top, base):
    """(P (M, 3), shape, origin): the probe grid over the probes' lookup box (Task 4d). Planes every `spacing` from
    box_origin(hall, base), off the surfaces: in x and y up to the box's far walls, in z up to the first plane at or
    above `top` (the lookup's top: store.Probes.lookup clamps z to 9.8 m). A position the lookup reads between a wall or
    the floor and the outermost plane reads that plane (reference.trilinear clamps the fraction to [0, 1]). Both grids
    take the 0.5 m grid's spacing as `base`, so the 1 m grid's planes are the 0.5 m grid's even planes. Probe
    (ix ny + iy) nz + iz."""
    lo = box_origin(hall, base)
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
