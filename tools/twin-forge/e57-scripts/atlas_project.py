"""Read every viewpoint's floor out of the shared Floor Atlas.

THE END OF THE DONOR LOTTERY. Until now each panorama repaired its own
tripod hole by begging its neighbours: different donors per node, different
quality per node, a dead centre wherever the lottery lost, and no guarantee
that two viewpoints standing on the same floor agreed about it. This module
inverts that. The atlas is fused ONCE from every photograph ever taken of
the floor (floor_atlas.py); each node then simply READS ITS OWN NADIR OUT
OF IT.

What that buys, and why it is a category change rather than a better patch:
  * quality stops being per-node luck and becomes a property of the BUILDING
    — improve the atlas once, every viewpoint improves;
  * two nodes sampling the same floor patch necessarily get the same pixels,
    so walking between viewpoints cannot reveal a seam;
  * coverage is inherited honestly: floor nobody photographed arrives
    FLAGGED, and the caller is told, rather than being handed an invention.

Geometry is inherited, never re-derived: rays and pixel mapping come from
nadir_fill (pinned to extract_equirect_v2 by tests/test_nadir_vs_extractor),
and the metric grid from floor_atlas.AtlasGrid.
"""

from __future__ import annotations

import numpy as np

import nadir_fill as nf


def sample_pano_at_floor_point(
    pano: np.ndarray, C: np.ndarray, wx: float, wy: float, z_floor: float
) -> np.ndarray:
    """The colour a panorama shows for one world floor point. Used to prove
    two viewpoints agree about shared floor."""
    C = np.asarray(C, dtype=np.float64)
    d = np.array([wx - C[0], wy - C[1], z_floor - C[2]], dtype=np.float64)
    h, w = np.asarray(pano).shape[:2]
    rows, cols = nf.dirs_to_pixels(d[None, :], w, h)
    return nf.sample_equirect(pano, rows, cols)[0]


def fill_nadir_from_atlas(
    pano: np.ndarray,
    C: np.ndarray,
    atlas: np.ndarray,
    counts: np.ndarray,
    grid,
    z_floor: float,
    hole_mask: np.ndarray | None = None,
    detect_kwargs: dict | None = None,
    view_size: int = 1024,
    half_fov_deg: float = 40.0,
    blend: bool = True,
    min_looks: int = 1,
) -> tuple[np.ndarray, dict]:
    """Replace a panorama's nadir hole with pixels read from the atlas.

    hole_mask is in EQUIRECT space (H, W). If omitted, the smear is detected
    with nadir_fill's detector on a straight-down view. Returns
    (filled pano float32, report).

    The report never flatters: atlas_covered_frac and uncovered_px say how
    much of the hole the atlas could actually answer for, and
    mean_looks_behind_fill says how many real photographs stand behind the
    pixels that were written.
    """
    img = np.asarray(pano, dtype=np.float32)
    C = np.asarray(C, dtype=np.float64)
    eq_h, eq_w = img.shape[:2]

    if hole_mask is None:
        dirs = nf.gnomonic_nadir_dirs(view_size, half_fov_deg)
        view = nf.render_view(img, dirs)
        hole_view = nf.detect_smear_view(view, **(detect_kwargs or {}))
        band0 = max(int(eq_h * (180.0 - half_fov_deg) / 180.0) - 2, 0)
        gd = nf.equirect_grid_dirs(eq_w, eq_h, band0, eq_h - band0)
        rows_v, cols_v, inside = nf.dirs_to_gnomonic_pixels(
            gd, view_size, half_fov_deg
        )
        mm = np.zeros((eq_h - band0, eq_w), dtype=np.float32)
        hv = hole_view.astype(np.float32)[..., None]
        mm[inside] = nf.sample_image(hv, rows_v[inside], cols_v[inside])[..., 0]
        hole_mask = np.zeros((eq_h, eq_w), dtype=bool)
        hole_mask[band0:] = mm > 0.5
    hole_mask = np.asarray(hole_mask, dtype=bool)

    ys, xs = np.nonzero(hole_mask)
    report: dict = {
        "hole_px": int(ys.size),
        "written_px": 0,
        "uncovered_px": 0,
        "atlas_covered_frac": 0.0,
        "mean_looks_behind_fill": 0.0,
    }
    if ys.size == 0:
        return img.copy(), report

    # equirect pixel -> world ray -> floor point -> atlas pixel
    row0 = int(ys.min())
    band = nf.equirect_grid_dirs(eq_w, eq_h, row0, eq_h - row0)
    d = band[ys - row0, xs]
    del band
    dz = d[:, 2]
    downward = dz < -1e-9
    t = np.zeros(ys.size, dtype=np.float64)
    t[downward] = (z_floor - C[2]) / dz[downward]
    P = C[None, :] + t[:, None] * d
    px = (P[:, 0] - grid.origin_xy[0]) / grid.metres_per_px - 0.5
    py = (P[:, 1] - grid.origin_xy[1]) / grid.metres_per_px - 0.5

    inside_grid = (
        downward
        & (px >= 0) & (px <= grid.width - 1)
        & (py >= 0) & (py <= grid.height - 1)
    )
    looks = np.zeros(ys.size, dtype=np.float32)
    if np.any(inside_grid):
        li = counts[
            np.clip(np.round(py[inside_grid]).astype(np.int64), 0, grid.height - 1),
            np.clip(np.round(px[inside_grid]).astype(np.int64), 0, grid.width - 1),
        ]
        looks[inside_grid] = li
    ok = inside_grid & (looks >= min_looks)

    filled = img.copy()
    if np.any(ok):
        vals = nf.sample_image(
            np.asarray(atlas, dtype=np.float32), py[ok], px[ok]
        )
        filled[ys[ok], xs[ok]] = vals
        report["mean_looks_behind_fill"] = float(looks[ok].mean())
    report["written_px"] = int(ok.sum())
    report["uncovered_px"] = int((~ok).sum())
    report["atlas_covered_frac"] = float(ok.mean())

    if blend and np.any(ok):
        # Pin the patch to THIS pano's own exposure at the boundary. The atlas
        # is a building-wide average; a node standing in a light pool must not
        # suddenly show the building's mean floor. Gradients come from the
        # atlas, absolute level from the node — the same discipline the
        # per-node fill used, now with a far better source.
        written = np.zeros_like(hole_mask)
        written[ys[ok], xs[ok]] = True
        r0, r1 = int(ys.min()), int(ys.max()) + 1
        c0, c1 = int(xs.min()), int(xs.max()) + 1
        sub_t = img[r0:r1, c0:c1]
        sub_s = filled[r0:r1, c0:c1]
        sub_m = written[r0:r1, c0:c1]
        if sub_m.any():
            blended = nf.poisson_blend_into_hole(sub_t, sub_s, sub_m)
            filled[r0:r1, c0:c1] = blended.astype(np.float32)

    return filled, report
