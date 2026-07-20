"""Multi-view nadir tripod-hole fill — geometry core.

Each E57 sweep has a blind cone at nadir where the tripod occluded the
scanner, leaving a smeared blob on the floor of the equirect. The floor a
sweep hides is seen cleanly by its neighbours, so we reproject it back.

This module is the PURE geometry the fill stands on — no image I/O, no E57,
no bundle — so it is unit-testable in isolation (see
tests/test_nadir_geometry.py). The raster convention is IDENTICAL to
extract_equirect_v2.world_equirect_band_dirs, and MUST stay identical or a
reprojected pixel lands in the wrong place:

    World frame, Z-up.  row 0 = zenith (+Z), last row = nadir (-Z).
    el = pi/2 - (row + 0.5)/h * pi      az = (col + 0.5)/w * 2*pi
    dir = (cos_el*cos_az, cos_el*sin_az, sin_el)

Every sweep's equirect is world-ORIENTED but centred at that sweep's own
scanner, so reprojecting a world point P into a donor sweep centred at
C_donor is pure translation: the ray is simply (P - C_donor).
"""

from __future__ import annotations

import numpy as np

TWO_PI = 2.0 * np.pi


def equirect_pixel_to_world_dir(row: float, col: float, w: int, h: int) -> np.ndarray:
    """Pixel (row, col) -> unit world direction. Inverse of
    world_dir_to_equirect_pixel; matches world_equirect_band_dirs."""
    el = np.pi / 2.0 - (row + 0.5) / h * np.pi
    az = (col + 0.5) / w * TWO_PI
    cos_el = np.cos(el)
    return np.array(
        [cos_el * np.cos(az), cos_el * np.sin(az), np.sin(el)], dtype=np.float64
    )


def world_dir_to_equirect_pixel(d: np.ndarray, w: int, h: int) -> tuple[float, float]:
    """Unit (or any non-zero) world direction -> continuous (row, col).
    row/col are fractional; the caller samples with interpolation."""
    d = np.asarray(d, dtype=np.float64)
    n = np.linalg.norm(d)
    if n < 1e-12:
        raise ValueError("zero-length direction")
    d = d / n
    el = np.arcsin(np.clip(d[2], -1.0, 1.0))
    az = np.arctan2(d[1], d[0]) % TWO_PI
    row = (np.pi / 2.0 - el) / np.pi * h - 0.5
    col = az / TWO_PI * w - 0.5
    return float(row), float(col)


def ray_floor_intersection(
    C: np.ndarray, d: np.ndarray, z_floor: float
) -> np.ndarray | None:
    """World point where ray (origin C, direction d) meets the plane
    z = z_floor, or None if the ray points up/parallel or the hit is behind
    the origin. Only downward rays (d_z < 0) from above the floor hit."""
    C = np.asarray(C, dtype=np.float64)
    d = np.asarray(d, dtype=np.float64)
    dz = d[2]
    if dz >= 0.0:
        return None
    t = (z_floor - C[2]) / dz
    if t <= 0.0:
        return None
    return C + t * d


def reproject_point_to_pixel(
    P: np.ndarray, C_donor: np.ndarray, w: int, h: int
) -> tuple[float, float]:
    """Pixel in a donor sweep (centred at C_donor) that looks at world point
    P. Pure translation because donor equirects are world-oriented."""
    return world_dir_to_equirect_pixel(np.asarray(P) - np.asarray(C_donor), w, h)


def donor_horizontal_offset(P: np.ndarray, C_donor: np.ndarray) -> float:
    """Horizontal distance from the donor's own ground point to P. If this is
    below the tripod radius, P sits under the donor's OWN blind cone and the
    donor must be rejected."""
    P = np.asarray(P, dtype=np.float64)
    C = np.asarray(C_donor, dtype=np.float64)
    return float(np.hypot(P[0] - C[0], P[1] - C[1]))


def donor_weight(
    P: np.ndarray,
    C_donor: np.ndarray,
    incidence_power: float = 2.0,
    dist_power: float = 2.0,
) -> float:
    """Blend weight for a donor's view of floor point P. Rewards head-on
    (looking straight down, least foreshortened) and near (more texels per
    metre) views; 0 for a horizontal or coincident donor."""
    v = np.asarray(P, dtype=np.float64) - np.asarray(C_donor, dtype=np.float64)
    dist = float(np.linalg.norm(v))
    if dist < 1e-9:
        return 0.0
    overhead = max(0.0, -v[2] / dist)  # 1 = straight down, 0 = horizontal
    return (overhead ** incidence_power) / (dist ** dist_power)


# ---------------------------------------------------------------------------
# Vectorized mappings (bulk twins of the scalar functions above)
# ---------------------------------------------------------------------------


def dirs_to_pixels(dirs: np.ndarray, w: int, h: int) -> tuple[np.ndarray, np.ndarray]:
    """Vectorized world_dir_to_equirect_pixel. dirs (..., 3) -> (rows, cols)
    float64 arrays of the leading shape."""
    d = np.asarray(dirs, dtype=np.float64)
    n = np.linalg.norm(d, axis=-1)
    n = np.where(n < 1e-12, 1.0, n)
    dx, dy, dz = d[..., 0] / n, d[..., 1] / n, d[..., 2] / n
    el = np.arcsin(np.clip(dz, -1.0, 1.0))
    az = np.arctan2(dy, dx) % TWO_PI
    rows = (np.pi / 2.0 - el) / np.pi * h - 0.5
    cols = az / TWO_PI * w - 0.5
    return rows, cols


def equirect_grid_dirs(w: int, h: int, row0: int, nrows: int) -> np.ndarray:
    """(nrows, w, 3) float64 ray grid for equirect rows row0..row0+nrows —
    same formula as the extractor's world_equirect_band_dirs (pinned to it by
    tests/test_nadir_vs_extractor.py through the scalar mapping)."""
    el = np.pi / 2.0 - (np.arange(row0, row0 + nrows) + 0.5) / h * np.pi
    az = (np.arange(w) + 0.5) / w * TWO_PI
    cos_el = np.cos(el)[:, None]
    return np.stack(
        [
            cos_el * np.cos(az)[None, :],
            cos_el * np.sin(az)[None, :],
            np.broadcast_to(np.sin(el)[:, None], (nrows, w)),
        ],
        axis=2,
    )


def sample_equirect(img: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
    """Bilinear sample of an equirect raster at fractional (rows, cols).
    Columns wrap (azimuth seam); rows clamp (poles). img (H, W, C), any
    dtype — corners are gathered first and only the gathered values are
    converted, so uint8 sources (e.g. 8192 supersampled panos) are never
    copied wholesale to float."""
    im = np.asarray(img)
    h, w = im.shape[:2]
    r = np.clip(np.asarray(rows, dtype=np.float64), 0.0, h - 1.0)
    c = np.asarray(cols, dtype=np.float64) % w
    r0 = np.floor(r).astype(np.int64)
    c0 = np.floor(c).astype(np.int64)
    fr = (r - r0)[..., None].astype(np.float32)
    fc = (c - c0)[..., None].astype(np.float32)
    r1 = np.minimum(r0 + 1, h - 1)
    c1 = (c0 + 1) % w
    v00 = im[r0, c0].astype(np.float32)
    v01 = im[r0, c1].astype(np.float32)
    v10 = im[r1, c0].astype(np.float32)
    v11 = im[r1, c1].astype(np.float32)
    top = v00 * (1 - fc) + v01 * fc
    bot = v10 * (1 - fc) + v11 * fc
    return top * (1 - fr) + bot * fr


def sample_image(img: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
    """Plain bilinear sample (clamped, no wrap) — for gnomonic views."""
    im = np.asarray(img)
    h, w = im.shape[:2]
    r = np.clip(np.asarray(rows, dtype=np.float64), 0.0, h - 1.0)
    c = np.clip(np.asarray(cols, dtype=np.float64), 0.0, w - 1.0)
    r0 = np.floor(r).astype(np.int64)
    c0 = np.floor(c).astype(np.int64)
    fr = (r - r0)[..., None].astype(np.float32)
    fc = (c - c0)[..., None].astype(np.float32)
    r1 = np.minimum(r0 + 1, h - 1)
    c1 = np.minimum(c0 + 1, w - 1)
    v00 = im[r0, c0].astype(np.float32)
    v01 = im[r0, c1].astype(np.float32)
    v10 = im[r1, c0].astype(np.float32)
    v11 = im[r1, c1].astype(np.float32)
    top = v00 * (1 - fc) + v01 * fc
    bot = v10 * (1 - fc) + v11 * fc
    return top * (1 - fr) + bot * fr


# ---------------------------------------------------------------------------
# Gnomonic nadir view — the compact working space for detection/fill/blend.
# In the equirect the tripod hole smears across the entire bottom rows; in a
# straight-down perspective view it is a small disc. Convention: image col →
# world +X, image row → world +Y, optical axis = -Z (looking at the floor).
# ---------------------------------------------------------------------------


def gnomonic_nadir_dirs(size: int, half_fov_deg: float) -> np.ndarray:
    s = np.tan(np.radians(half_fov_deg))
    u = ((np.arange(size) + 0.5) / size * 2.0 - 1.0) * s
    gx = np.broadcast_to(u[None, :], (size, size))
    gy = np.broadcast_to(u[:, None], (size, size))
    d = np.stack([gx, gy, -np.ones((size, size))], axis=-1)
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def dirs_to_gnomonic_pixels(
    dirs: np.ndarray, size: int, half_fov_deg: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Inverse of gnomonic_nadir_dirs: world dirs -> (rows, cols, inside)."""
    s = np.tan(np.radians(half_fov_deg))
    d = np.asarray(dirs, dtype=np.float64)
    dz = d[..., 2]
    down = dz < -1e-9
    safe = np.where(down, -dz, 1.0)
    gx = d[..., 0] / safe
    gy = d[..., 1] / safe
    cols = (gx / s * 0.5 + 0.5) * size - 0.5
    rows = (gy / s * 0.5 + 0.5) * size - 0.5
    inside = down & (rows >= 0) & (rows <= size - 1) & (cols >= 0) & (cols <= size - 1)
    return rows, cols, inside


def render_view(img: np.ndarray, dirs: np.ndarray) -> np.ndarray:
    """Sample an equirect along arbitrary world dirs (a perspective render)."""
    h, w = np.asarray(img).shape[:2]
    rows, cols = dirs_to_pixels(dirs, w, h)
    return sample_equirect(img, rows, cols)


class VoxelOccluder:
    """Voxelized mesh for donor-visibility tests, in E57 world metres.

    The planar-floor model assumes every donor can see every floor point —
    false in cabinet slots (scan_000). Built from mesh triangles (e.g. the
    co-registered dollhouse GLB, which shares the E57 Z-up frame per
    twin-basis.ts): surfaces are sampled at half-voxel pitch into a boolean
    grid; a donor→point segment is BLOCKED when any interior sample lands in
    an occupied voxel. Segment ends are skipped so the floor plane itself and
    the donor's own housing never self-occlude. Deterministic, no deps."""

    def __init__(self, grid: np.ndarray, origin: np.ndarray, voxel: float):
        self.grid = grid
        self.origin = np.asarray(origin, dtype=np.float64)
        self.voxel = float(voxel)

    @classmethod
    def from_triangles(
        cls, tris: np.ndarray, voxel: float = 0.10, max_subdiv: int = 48
    ) -> "VoxelOccluder":
        tris = np.asarray(tris, dtype=np.float64)
        bmin = tris.min(axis=(0, 1)) - voxel
        bmax = tris.max(axis=(0, 1)) + voxel
        shape = tuple(np.ceil((bmax - bmin) / voxel).astype(np.int64) + 1)
        grid = np.zeros(shape, dtype=bool)
        edges = np.stack(
            [
                np.linalg.norm(tris[:, 1] - tris[:, 0], axis=1),
                np.linalg.norm(tris[:, 2] - tris[:, 1], axis=1),
                np.linalg.norm(tris[:, 0] - tris[:, 2], axis=1),
            ],
            axis=1,
        ).max(axis=1)
        k = np.clip(
            np.ceil(edges / (voxel * 0.5)).astype(np.int64), 1, max_subdiv
        )
        for kk in np.unique(k):
            sub = tris[k == kk]
            ii, jj = np.meshgrid(
                np.arange(kk + 1), np.arange(kk + 1), indexing="ij"
            )
            keep = (ii + jj) <= kk
            u = (ii[keep] / kk)[None, :, None]
            v = (jj[keep] / kk)[None, :, None]
            pts = (
                sub[:, None, 0] * (1.0 - u - v)
                + sub[:, None, 1] * u
                + sub[:, None, 2] * v
            ).reshape(-1, 3)
            idx = np.floor((pts - bmin[None, :]) / voxel).astype(np.int64)
            np.clip(idx, 0, np.asarray(shape)[None, :] - 1, out=idx)
            grid[idx[:, 0], idx[:, 1], idx[:, 2]] = True
        return cls(grid, bmin, voxel)

    def blocked(
        self,
        C: np.ndarray,
        P: np.ndarray,
        near_skip: float = 0.35,
        far_skip: float = 0.12,
        z_exempt_below: float | None = None,
    ) -> np.ndarray:
        """(M,) bool: is the open segment C→P[i] interrupted by the mesh?

        z_exempt_below: ignore voxel hits BELOW this world z. The mesh
        contains the floor surface itself, and rays to floor points graze
        along it — far_skip trims path LENGTH, not height, so without this a
        shallow ray is false-blocked by the very floor it is looking at.
        Pass z_floor + ~0.3 m: skirting-height clutter can't hide the floor
        from a tripod-height donor anyway."""
        C = np.asarray(C, dtype=np.float64)
        P = np.asarray(P, dtype=np.float64)
        m_total = P.shape[0]
        if m_total == 0:
            return np.zeros(0, dtype=bool)
        # Chunked march: the full rays×steps lattice at once can spike
        # hundreds of MB (batch workers OOMed on it); slabs bound the peak.
        hit = np.zeros(m_total, dtype=bool)
        chunk = 4096
        gshape = np.asarray(self.grid.shape)[None, None, :]
        step = self.voxel * 0.7
        for c0 in range(0, m_total, chunk):
            Pc = P[c0 : c0 + chunk]
            v = Pc - C[None, :]
            L = np.linalg.norm(v, axis=1)
            span = L - near_skip - far_skip
            top = float(np.nanmax(span, initial=0.0))
            if top <= 0:
                continue
            n = int(np.clip(np.ceil(top / step), 1, 4096))
            s = np.linspace(0.0, 1.0, n, dtype=np.float64)[None, :]
            tt = near_skip + s * np.maximum(span, 0.0)[:, None]
            valid = (span[:, None] > 0) & (tt <= (L[:, None] - far_skip))
            unit = v / np.maximum(L, 1e-12)[:, None]
            pts = C[None, None, :] + unit[:, None, :] * tt[..., None]
            idx = np.floor(
                (pts - self.origin[None, None, :]) / self.voxel
            ).astype(np.int64)
            inb = valid & np.all((idx >= 0) & (idx < gshape), axis=2)
            if z_exempt_below is not None:
                inb &= pts[..., 2] >= z_exempt_below
            if np.any(inb):
                gi = idx[inb]
                occ = self.grid[gi[:, 0], gi[:, 1], gi[:, 2]]
                rows = np.broadcast_to(
                    np.arange(Pc.shape[0])[:, None], inb.shape
                )[inb]
                hit[c0 : c0 + chunk] = (
                    np.bincount(rows[occ], minlength=Pc.shape[0]) > 0
                )
        return hit


def detect_smear_view(
    view: np.ndarray,
    std_window: int = 9,
    rel_thresh: float = 0.35,
    abs_floor: float = 1.2,
    abs_cap: float = 6.0,
    grow_px: int = 2,
    chroma_k: float = 6.0,
) -> np.ndarray:
    """Find the tripod smear in a nadir gnomonic view: the blur has far less
    local texture than the real floor. Local-std threshold (relative to the
    view's own texture level), keep the connected component containing the
    nadir point (the exact view centre), close + grow slightly.

    chroma_k adds the second capture artifact: tripod-PAD blobs (purple
    rubber feet) that sit just outside the smear — flat enough to pass a
    variance test but chromatically alien. Pixels whose blurred chroma sits
    more than chroma_k robust sigmas from the surrounding floor's, within
    the smear's neighbourhood, are unioned into the mask. 0 disables."""
    from scipy import ndimage

    v = np.asarray(view, dtype=np.float32)
    lum = v @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    mean = ndimage.uniform_filter(lum, std_window)
    mean_sq = ndimage.uniform_filter(lum * lum, std_window)
    std = np.sqrt(np.maximum(mean_sq - mean * mean, 0.0))
    texture = float(np.median(std[std > 0.5])) if np.any(std > 0.5) else 1.0
    thresh = float(np.clip(rel_thresh * texture, abs_floor, abs_cap))
    raw = std < thresh
    labels, _n = ndimage.label(raw)
    size = labels.shape[0]
    centre_label = labels[size // 2, size // 2]
    if centre_label == 0:
        # centre pixel escaped the mask (noise); search a small window
        win = labels[size // 2 - 6 : size // 2 + 7, size // 2 - 6 : size // 2 + 7]
        vals = win[win > 0]
        if vals.size == 0:
            return np.zeros_like(raw)
        centre_label = int(np.bincount(vals).argmax())
    mask = labels == centre_label
    mask = ndimage.binary_closing(mask, iterations=3)
    mask = ndimage.binary_fill_holes(mask)

    if chroma_k > 0 and np.any(mask):
        # Tripod-pad stage: the pads are FLAT (so they are already connected
        # components of the low-variance `raw` mask, just not the nadir one)
        # and chromatically alien. Judge each flat component near the smear
        # by the ABSOLUTE chroma distance of its median from the surrounding
        # floor's median — per-component medians are immune to a mixed ring
        # (blond floor + dark cabinet) that inflates MAD-style thresholds.
        blur = ndimage.gaussian_filter(v, (2.0, 2.0, 0.0))
        blum = blur @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        cb = blur[..., 2] - blum
        cr = blur[..., 0] - blum
        ring = ndimage.binary_dilation(mask, iterations=14) & ~ndimage.binary_dilation(
            mask, iterations=3
        )
        if int(ring.sum()) >= 200:
            mcb = float(np.median(cb[ring]))
            mcr = float(np.median(cr[ring]))
            radius_px = int(np.clip(np.sqrt(mask.sum() / np.pi) * 0.9, 8, 120))
            neigh = ndimage.binary_dilation(mask, iterations=radius_px)
            cand = raw & neigh & ~mask
            labs, n_comp = ndimage.label(cand)
            added = False
            for lab in range(1, n_comp + 1):
                comp = labs == lab
                area = int(comp.sum())
                # The std window erodes a flat blob's rim by ~window/2 before
                # it reaches `raw`, so small pads survive only as cores:
                # accept small cores, then dilate the accepted component back
                # out by the half-window to recover the true blob extent.
                if area < 12 or area > int(mask.sum()) * 0.8:
                    continue
                d_med = float(
                    np.hypot(
                        np.median(cb[comp]) - mcb, np.median(cr[comp]) - mcr
                    )
                )
                if d_med > chroma_k * 2.0:  # absolute chroma units (~12+)
                    mask = mask | ndimage.binary_dilation(
                        comp, iterations=max(1, std_window // 2)
                    )
                    added = True
            # Cool-blob stage: the real tripod pads are blurry (never flat
            # enough for `raw`) but COOL — blue ABOVE luminance in a scene
            # where wood floor and mahogany are both warm (blue well below).
            # Any cool component near the smear is a capture artifact here;
            # a venue with genuinely blue floor decor would set chroma_k=0.
            cool = (cb > chroma_k) & neigh & ~mask
            labs2, n2 = ndimage.label(cool)
            for lab in range(1, n2 + 1):
                comp = labs2 == lab
                if int(comp.sum()) >= 12:
                    mask = mask | ndimage.binary_dilation(
                        comp, iterations=max(1, std_window // 2)
                    )
                    added = True
            # Smear-LIKE detached lobes (the scan_045 entry-node failure):
            # the smear can arrive SPLIT by a texture band or threshold —
            # fragments that connect to nothing, wood-coloured (both chroma
            # stages blind), but flat and matching the central smear's
            # colour. Guards against eating real floor sheen: must be
            # DEEPLY flat (< 0.6x the base threshold), inside the tripod
            # zone, and no bigger than the central smear itself.
            ref = np.median(blur[mask], axis=0)
            deep_flat = std < (thresh * 0.6)
            # Wider zone than the chroma stages: tripod junk scatters to
            # ~2.5x the smear radius (the chroma neigh stops too close —
            # that near-miss was exactly the 0.22-coverage failure mode).
            neigh_lobe = ndimage.binary_dilation(
                mask, iterations=int(np.clip(radius_px * 2.5, 30, 300))
            )
            lobes = deep_flat & neigh_lobe & ~mask
            labs3, n3 = ndimage.label(lobes)
            cap = int(mask.sum()) * 1.2
            for lab in range(1, n3 + 1):
                comp = labs3 == lab
                area = int(comp.sum())
                if area < 12 or area > cap:
                    continue
                col_d = float(np.linalg.norm(np.median(blur[comp], axis=0) - ref))
                if col_d < 26.0:
                    mask = mask | ndimage.binary_dilation(
                        comp, iterations=max(1, std_window // 2)
                    )
                    added = True
            if added:
                mask = ndimage.binary_closing(mask, iterations=3)
                mask = ndimage.binary_fill_holes(mask)

    if grow_px > 0:
        mask = ndimage.binary_dilation(mask, iterations=grow_px)
    return mask


def poisson_blend_into_hole(
    target: np.ndarray, source: np.ndarray, hole: np.ndarray, max_px: int = 400_000
) -> np.ndarray:
    """Gradient-domain composite: keep the SOURCE's gradients inside the hole
    but pin the boundary to the TARGET (Dirichlet), killing any residual
    exposure/white-balance step. 5-point Laplacian, sparse direct solve.

    Above max_px unknowns (the 8192 tier), the solve runs on a strided
    downscale and only its CORRECTION field (solution minus source) is
    upsampled — legitimate because Poisson's contribution is inherently
    low-frequency; the full-resolution grain rides in from the source."""
    from scipy import sparse
    from scipy.sparse.linalg import spsolve

    tgt = np.asarray(target, dtype=np.float64)
    src = np.asarray(source, dtype=np.float64)
    hole = np.asarray(hole, dtype=bool)
    h, w = hole.shape
    idx = -np.ones((h, w), dtype=np.int64)
    ys, xs = np.nonzero(hole)
    n = ys.size
    if n == 0:
        return tgt.copy()
    if n > max_px:
        from scipy import ndimage as _ndi

        f = int(np.ceil(np.sqrt(n / max_px)))
        out_ds = poisson_blend_into_hole(
            tgt[::f, ::f], src[::f, ::f], hole[::f, ::f], max_px
        )
        corr_ds = out_ds - src[::f, ::f]
        corr = np.repeat(np.repeat(corr_ds, f, axis=0), f, axis=1)[:h, :w]
        if corr.shape[0] < h or corr.shape[1] < w:
            corr = np.pad(
                corr,
                ((0, h - corr.shape[0]), (0, w - corr.shape[1]), (0, 0)),
                mode="edge",
            )
        corr = _ndi.gaussian_filter(corr, (float(f), float(f), 0.0))
        out = tgt.copy()
        out[ys, xs] = src[ys, xs] + corr[ys, xs]
        return out
    idx[ys, xs] = np.arange(n)

    out = tgt.copy()
    rows_l, cols_l, vals = [], [], []
    rhs_base = np.zeros((n, tgt.shape[2]), dtype=np.float64)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        ny = np.clip(ys + dy, 0, h - 1)
        nx = np.clip(xs + dx, 0, w - 1)
        rhs_base += src[ys, xs] - src[ny, nx]  # source gradient (Laplacian)
        nb = idx[ny, nx]
        inside = nb >= 0
        rows_l.append(np.nonzero(inside)[0])
        cols_l.append(nb[inside])
        vals.append(-np.ones(int(inside.sum())))
        outside = ~inside
        rhs_base[outside] += tgt[ny[outside], nx[outside]]  # Dirichlet boundary
    diag = sparse.coo_matrix(
        (np.full(n, 4.0), (np.arange(n), np.arange(n))), shape=(n, n)
    )
    off = sparse.coo_matrix(
        (np.concatenate(vals), (np.concatenate(rows_l), np.concatenate(cols_l))),
        shape=(n, n),
    )
    A = (diag + off).tocsr()
    for ch in range(tgt.shape[2]):
        out[ys, xs, ch] = spsolve(A, rhs_base[:, ch])
    return out


def synthesize_pattern_core(
    view: np.ndarray,
    core: np.ndarray,
    band: np.ndarray,
    patch: int = 24,
    overlap: int = 8,
    candidates: int = 220,
    seed: int = 0,
) -> np.ndarray:
    """Rebuild a low-texture CORE from real patches of the same floor's BAND.

    Quilting-lite (Efros–Freeman lineage): raster-scan the core in
    overlapping tiles; each tile takes the band patch whose pixels best match
    the tile's already-known context (ring pixels + previously laid tiles),
    cross-faded over the overlap. Every synthesized pixel is a verbatim crop
    of THIS floor's visible texture — nothing invented — and a fixed seed
    makes the result reproducible. Pixels outside `core` are never touched."""
    rng = np.random.default_rng(seed)
    v_full = np.asarray(view, dtype=np.float32)
    core = np.asarray(core, dtype=bool)
    band = np.asarray(band, dtype=bool)
    h, w = core.shape
    # Quilt the HIGH-PASS layer only: patches carry grain and edges, while
    # the composite's own low frequencies (sheen field, donor lighting) stay
    # in place — pasting full pixels checkered real floors, because each
    # patch dragged its source region's brightness across the sheen.
    from scipy import ndimage as _ndi

    low = _ndi.gaussian_filter(v_full, (6.0, 6.0, 0.0))
    v = v_full - low
    out = v.copy()

    # Candidate windows fully inside the band (integral-image window sums).
    ii = np.pad(band.astype(np.int64), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    full = (
        ii[patch:, patch:] - ii[:-patch, patch:] - ii[patch:, :-patch]
        + ii[:-patch, :-patch]
    ) == patch * patch
    cand_pos = np.argwhere(full)
    if cand_pos.shape[0] == 0 or int(core.sum()) == 0:
        return out
    if cand_pos.shape[0] > candidates:
        cand_pos = cand_pos[
            rng.choice(cand_pos.shape[0], size=candidates, replace=False)
        ]
    cands = np.stack(
        [v[r : r + patch, c : c + patch] for r, c in cand_pos]
    )  # (K, p, p, 3)

    known = ~core  # grows as tiles are laid
    ys, xs = np.nonzero(core)
    r0, r1 = int(ys.min()), int(ys.max())
    c0, c1 = int(xs.min()), int(xs.max())
    step = patch - overlap
    ramp = np.minimum(np.arange(1, patch + 1), overlap) / float(overlap)
    fade_r = np.minimum.outer(ramp, np.ones(patch))
    fade_c = np.minimum.outer(np.ones(patch), ramp)
    fade = np.minimum(fade_r, fade_c).astype(np.float32)[..., None]

    for tr in range(max(r0 - overlap, 0), r1 + 1, step):
        for tc in range(max(c0 - overlap, 0), c1 + 1, step):
            er, ec = min(tr + patch, h), min(tc + patch, w)
            sr, sc = er - patch, ec - patch
            tile_core = core[sr:er, sc:ec]
            if not tile_core.any():
                continue
            win = out[sr:er, sc:ec]
            ctx = known[sr:er, sc:ec]
            if ctx.any():
                diff = cands - win[None]
                scores = (diff * diff).sum(axis=3)[:, ctx].sum(axis=1)
                best = int(np.argmin(scores))
            else:  # interior tile with no context yet — deterministic pick
                best = int(rng.integers(0, cands.shape[0]))
            chosen = cands[best]
            write = tile_core & ~ctx
            blendz = tile_core & ctx
            win[write] = chosen[write]
            if blendz.any():
                t = fade[..., 0][blendz][..., None]
                win[blendz] = win[blendz] * (1.0 - t) + chosen[blendz] * t
            out[sr:er, sc:ec] = win
            known[sr:er, sc:ec] |= tile_core
    result = v_full.copy()
    result[core] = low[core] + out[core]
    return result


def fill_nadir_hole(
    target_img: np.ndarray,
    C_target: np.ndarray,
    donors: list[tuple[np.ndarray, np.ndarray]],
    z_floor: float,
    hole_mask_eq: np.ndarray | None = None,
    tripod_radius: float = 0.45,
    cone_feather_m: float = 0.15,
    view_size: int = 640,
    half_fov_deg: float = 58.0,
    detect_kwargs: dict | None = None,
    composite_mode: str = "best",
    grain_match: bool = True,
    grain_gain_cap: float = 2.2,
    sheen_field: bool = True,
    occluder: "VoxelOccluder | None" = None,
    z_exempt_m: float = 0.30,
    core_synthesis: bool = False,
) -> tuple[np.ndarray, dict]:
    """Fill the target sweep's nadir tripod hole from neighbouring sweeps.

    Pipeline (all in the gnomonic nadir view, then written back):
      1. render the target's straight-down view;
      2. hole mask: caller-supplied (resampled) or detected from the smear;
      3. every hole pixel's ray -> floor point P (z = z_floor);
      4. each donor: reproject P, reject P under the donor's own tripod cone
         (hard inside tripod_radius, feathered over cone_feather_m) or above
         its horizon; bilinear-sample its equirect;
      5. per-donor exposure gain solved on the ring around the hole (median
         target/donor ratio per channel — the JPGs are unharmonized);
      6. robust blend: per-pixel weighted median luminance gates out
         occluded/inconsistent donors (MAD gate), then incidence/distance-
         weighted average of the survivors;
      7. Poisson boundary blend pins the composite to the target's own ring;
      8. write back ONLY the hole pixels of the equirect.

    Returns (filled equirect float32, report dict). Never silent: the report
    counts cone rejections, occlusion rejections, and synthesized (donor-less)
    pixels."""
    from scipy import ndimage

    # Keep the target's own dtype: a uint8 8192 pano forced to float32 costs
    # 400 MB (plus the same again for the output copy) — the OOM that killed
    # the first batch. Samplers gather-then-convert, so uint8 works
    # throughout; only the written hole pixels round-trip through float.
    tgt = np.asarray(target_img)
    C_t = np.asarray(C_target, dtype=np.float64)
    eq_h, eq_w = tgt.shape[:2]

    dirs = gnomonic_nadir_dirs(view_size, half_fov_deg)
    view = render_view(tgt, dirs)

    if hole_mask_eq is not None:
        vr, vc = dirs_to_pixels(dirs, eq_w, eq_h)
        m = sample_equirect(
            np.asarray(hole_mask_eq, dtype=np.float32)[..., None] * 255.0, vr, vc
        )[..., 0]
        hole_view = m > 127.0
    else:
        hole_view = detect_smear_view(view, **(detect_kwargs or {}))

    dz = dirs[..., 2]
    hole_view &= dz < -1e-9
    ys, xs = np.nonzero(hole_view)
    n_hole = ys.size
    report: dict = {
        "hole_px_view": int(n_hole),
        "cone_rejected_px": 0,
        "occlusion_rejected_px": 0,
        "synthesized_px": 0,
        "donors": [],
    }
    if n_hole == 0:
        report["hole_px_eq"] = 0
        return tgt.copy(), report

    # Floor points for hole pixels and for the gain-estimation ring.
    def floor_points(mask):
        yy, xx = np.nonzero(mask)
        dd = dirs[yy, xx]
        t = (z_floor - C_t[2]) / dd[:, 2]
        return C_t[None, :] + t[:, None] * dd, yy, xx

    P_hole, _, _ = floor_points(hole_view)
    ring = ndimage.binary_dilation(hole_view, iterations=8) & ~ndimage.binary_dilation(
        hole_view, iterations=2
    )
    ring &= dz < -1e-9
    P_ring, ry, rx = floor_points(ring)
    ring_vals = view[ry, rx]
    if occluder is not None:
        # TARGET-side mesh test: ring pixels whose own ray is interrupted
        # (cabinet bases in a slot) do not show floor — they would poison
        # the exposure gains, the grain reference, and the sheen field.
        floor_seen = ~occluder.blocked(
            C_t, P_ring, z_exempt_below=z_floor + z_exempt_m
        )
        P_ring, ry, rx = P_ring[floor_seen], ry[floor_seen], rx[floor_seen]
        ring_vals = ring_vals[floor_seen]
        ring = np.zeros_like(ring)
        ring[ry, rx] = True
        report["ring_px_floor_seen"] = int(floor_seen.sum())
        report["ring_px_dropped_by_mesh"] = int(np.count_nonzero(~floor_seen))

    n_donors = len(donors)
    samples = np.zeros((n_hole, n_donors, 3), dtype=np.float32)
    weights = np.zeros((n_hole, n_donors), dtype=np.float32)
    donor_gains: list[np.ndarray] = []

    # Mesh visibility, evaluated per donor on a coarse cell lattice (the
    # boundary is smooth at cabinet scale) and upsampled to view pixels.
    donor_blk: list[np.ndarray | None] = [None] * n_donors
    vis_cells = None
    if occluder is not None:
        fs = max(1, int(np.ceil(view_size / 224)))
        cell = dirs[::fs, ::fs]
        cdz = cell[..., 2]
        cdown = cdz < -1e-9
        ct = (z_floor - C_t[2]) / np.where(cdown, cdz, -1.0)
        P_cell = C_t[None, None, :] + ct[..., None] * cell
        vis_cells = (P_cell, cdown, fs)
        report["mesh_occluded_px"] = 0

    for di, (dimg, C_d) in enumerate(donors):
        dimg = np.asarray(dimg)  # any dtype; samplers gather-then-convert
        C_d = np.asarray(C_d, dtype=np.float64)
        v = P_hole - C_d[None, :]
        dist = np.linalg.norm(v, axis=1)
        off = np.hypot(v[:, 0], v[:, 1])
        looking_down = v[:, 2] < -0.05
        outside_cone = off > tripod_radius
        ok = looking_down & outside_cone & (dist > 1e-6)
        report["cone_rejected_px"] += int(np.count_nonzero(looking_down & ~outside_cone))

        occ_hit_count = 0
        if vis_cells is not None:
            P_cell, cdown, fs = vis_cells
            blk_small = np.zeros(cdown.shape, dtype=bool)
            blk_small[cdown] = occluder.blocked(
                C_d, P_cell[cdown], z_exempt_below=z_floor + z_exempt_m
            )
            blk = np.repeat(np.repeat(blk_small, fs, axis=0), fs, axis=1)[
                :view_size, :view_size
            ]
            donor_blk[di] = blk
            occ_hit = blk[ys, xs] & ok
            occ_hit_count = int(occ_hit.sum())
            ok &= ~occ_hit
            report["mesh_occluded_px"] += occ_hit_count

        rows, cols = dirs_to_pixels(v[ok], dimg.shape[1], dimg.shape[0])
        samp = sample_equirect(dimg, rows, cols)

        # Exposure gain per channel from the ring (median target/donor ratio).
        vr_ = P_ring - C_d[None, :]
        okr = (vr_[:, 2] < -0.05) & (np.hypot(vr_[:, 0], vr_[:, 1]) > tripod_radius)
        if donor_blk[di] is not None:
            okr &= ~donor_blk[di][ry, rx]
        gain = np.ones(3, dtype=np.float32)
        if int(okr.sum()) >= 50:
            rr, rc = dirs_to_pixels(vr_[okr], dimg.shape[1], dimg.shape[0])
            dsamp = sample_equirect(dimg, rr, rc)
            ratio = ring_vals[okr] / np.maximum(dsamp, 1e-3)
            gain = np.clip(np.median(ratio, axis=0), 0.5, 2.0).astype(np.float32)

        overhead = np.clip(-v[ok, 2] / dist[ok], 0.0, 1.0)
        feather = np.clip((off[ok] - tripod_radius) / cone_feather_m, 0.0, 1.0)
        w_ok = (overhead**2) / np.maximum(dist[ok] ** 2, 1e-6) * feather

        samples[ok, di] = samp * gain[None, :]
        weights[ok, di] = w_ok.astype(np.float32)
        donor_gains.append(gain)
        report["donors"].append(
            {
                "gain": [round(float(g), 4) for g in gain],
                "usable_px": int(ok.sum()),
                "cone_overlap_px": int(np.count_nonzero(looking_down & ~outside_cone)),
                "mesh_occluded_px": occ_hit_count,
            }
        )

    # Robust occlusion gate: donors disagreeing with the per-pixel weighted
    # median luminance by > max(12, ~3 sigma via MAD) are dropped (chair
    # legs, glints) — only enforced where >= 3 donors cover the pixel.
    lum = samples @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    wpos = weights > 0
    n_valid = wpos.sum(axis=1)
    # Vectorized weighted median across the donor axis (k is small; the
    # hole can be ~1e6 px at the 8192 tier — no Python-level loop).
    order = np.argsort(np.where(wpos, lum, np.inf), axis=1)
    w_sorted = np.take_along_axis(np.where(wpos, weights, 0.0), order, axis=1)
    l_sorted = np.take_along_axis(lum, order, axis=1)
    cw = np.cumsum(w_sorted, axis=1)
    total = cw[:, -1:]
    med_idx = np.argmax(cw >= total * 0.5, axis=1)
    med = l_sorted[np.arange(n_hole), med_idx]
    med = np.where(total[:, 0] > 0, med, 0.0).astype(np.float32)
    dev = np.abs(lum - med[:, None])
    mad = float(np.median(dev[wpos])) if np.any(wpos) else 0.0
    gate = max(12.0, 3.0 * 1.4826 * mad)
    occluded = wpos & (dev > gate) & (n_valid[:, None] >= 3)
    report["occlusion_rejected_px"] = int(occluded.sum())
    weights = np.where(occluded, 0.0, weights)

    wsum = weights.sum(axis=1)
    covered = wsum > 1e-9
    blended = np.zeros((n_hole, 3), dtype=np.float32)
    report["composite_mode"] = composite_mode
    if composite_mode == "average":
        blended[covered] = (
            (samples[covered] * weights[covered][..., None]).sum(axis=1)
            / wsum[covered][:, None]
        )
    elif composite_mode == "best":
        # Best-donor compositing: averaging N donors whose fine grain is
        # decorrelated (sub-texel pose/z error) keeps the aligned plank
        # edges but averages the grain away — the "ghost disc". Instead,
        # every pixel takes ONE donor's sample: donors ranked by total
        # usable weight, each pixel served by the best-ranked donor that
        # survived its cone/occlusion gates. The Poisson step then sews
        # any donor-switch boundaries at the gradient level.
        order = np.argsort(-weights.sum(axis=0))
        w_ord = weights[:, order]
        s_ord = samples[:, order]
        choice = np.argmax(w_ord > 0, axis=1)
        blended = s_ord[np.arange(n_hole), choice]
        share = np.bincount(order[choice[covered]], minlength=n_donors)
        for di in range(n_donors):
            report["donors"][di]["primary_share"] = round(
                float(share[di]) / max(int(covered.sum()), 1), 4
            )
    else:
        raise ValueError(f"unknown composite_mode: {composite_mode}")
    report["synthesized_px"] = int(np.count_nonzero(~covered))
    if np.any(~covered) and np.any(covered):
        # Donor-less pixels: seed from the nearest covered hole pixel's blend;
        # the Poisson step then diffuses them smoothly. Logged, never silent.
        cov_map = np.zeros(hole_view.shape, dtype=bool)
        cov_map[ys[covered], xs[covered]] = True
        _, (iy, ix) = ndimage.distance_transform_edt(~cov_map, return_indices=True)
        val_map = np.zeros(hole_view.shape + (3,), dtype=np.float32)
        val_map[ys[covered], xs[covered]] = blended[covered]
        ysn, xsn = ys[~covered], xs[~covered]
        blended[~covered] = val_map[iy[ysn, xsn], ix[ysn, xsn]]

    source = view.copy()
    source[ys, xs] = blended
    if composite_mode == "best":
        # Multiband: a single donor carries the truest GRAIN (averaging
        # decorrelated donors blurs it) but the donor ensemble carries the
        # truest LIGHTING (per-donor sheen/exposure error averages out).
        # Take low frequencies from the weighted average, high from the
        # best donor, and let Poisson integrate the combined field.
        avg = blended.copy()
        avg[covered] = (
            (samples[covered] * weights[covered][..., None]).sum(axis=1)
            / wsum[covered][:, None]
        )
        src_avg = view.copy()
        src_avg[ys, xs] = avg
        lp_best = ndimage.gaussian_filter(source, (2.5, 2.5, 0.0))
        lp_avg = ndimage.gaussian_filter(src_avg, (2.5, 2.5, 0.0))
        source = lp_avg + (source - lp_best)

    if sheen_field and donor_gains:
        # Harmonic sheen field: a scalar gain per donor can't track the
        # target's spatially varying floor sheen (view-dependent, unseeable
        # from donor positions). Measure the target/donor-prediction RATIO
        # per channel on the band just outside the hole — where both are
        # known — and extend it harmonically (Laplace, zero-gradient
        # source) across the hole. Multiplying it in removes the smooth
        # "mopped patch" tone without touching grain.
        ring2 = ndimage.binary_dilation(hole_view, iterations=4) & ~hole_view
        ring2 &= dz < -1e-9
        P_r2, r2y, r2x = floor_points(ring2)
        if occluder is not None and r2y.size:
            keep2 = ~occluder.blocked(
                C_t, P_r2, z_exempt_below=z_floor + z_exempt_m
            )
            P_r2, r2y, r2x = P_r2[keep2], r2y[keep2], r2x[keep2]
        if r2y.size >= 100:
            acc_r = np.zeros((r2y.size, 3), dtype=np.float32)
            w_r = np.zeros(r2y.size, dtype=np.float32)
            for di, (dimg, C_d) in enumerate(donors):
                dimg = np.asarray(dimg)
                C_d = np.asarray(C_d, dtype=np.float64)
                v2 = P_r2 - C_d[None, :]
                dist2 = np.linalg.norm(v2, axis=1)
                off2 = np.hypot(v2[:, 0], v2[:, 1])
                ok2 = (v2[:, 2] < -0.05) & (off2 > tripod_radius) & (dist2 > 1e-6)
                if donor_blk[di] is not None:
                    ok2 &= ~donor_blk[di][r2y, r2x]
                if not np.any(ok2):
                    continue
                rr2, cc2 = dirs_to_pixels(v2[ok2], dimg.shape[1], dimg.shape[0])
                s2 = sample_equirect(dimg, rr2, cc2) * donor_gains[di][None, :]
                ov2 = np.clip(-v2[ok2, 2] / dist2[ok2], 0.0, 1.0)
                w2 = (ov2**2) / np.maximum(dist2[ok2] ** 2, 1e-6)
                acc_r[ok2] += w2[:, None].astype(np.float32) * s2
                w_r[ok2] += w2.astype(np.float32)
            good2 = w_r > 1e-9
            if int(good2.sum()) >= 100:
                pred = acc_r[good2] / w_r[good2][:, None]
                raw = np.zeros_like(view)
                sup = np.zeros(view.shape[:2], dtype=np.float32)
                raw[r2y[good2], r2x[good2]] = np.clip(
                    view[r2y[good2], r2x[good2]] / np.maximum(pred, 1e-3),
                    0.7,
                    1.4,
                )
                sup[r2y[good2], r2x[good2]] = 1.0
                # Sheen is smooth by definition — support-weighted blur of the
                # measured ratios keeps grain noise out of the Dirichlet ring.
                num = ndimage.gaussian_filter(raw, (4.0, 4.0, 0.0))
                den = ndimage.gaussian_filter(sup, 4.0)[..., None]
                ratio_map = np.ones_like(view)
                smoothed = num / np.maximum(den, 1e-6)
                ring_px = sup > 0
                ratio_map[ring_px] = smoothed[ring_px]
                u = poisson_blend_into_hole(
                    ratio_map, np.ones_like(ratio_map), hole_view
                ).astype(np.float32)
                source[ys, xs] = source[ys, xs] * u[ys, xs]
                report["sheen_field"] = {
                    "min": round(float(u[ys, xs].min()), 3),
                    "max": round(float(u[ys, xs].max()), 3),
                }
    view_out = poisson_blend_into_hole(view, source, hole_view).astype(np.float32)

    if core_synthesis and int(ring.sum()) >= 200:
        # Pattern-core synthesis — CONTENT stage, deliberately before the
        # grain calibration: where donors were too oblique or soft to carry
        # texture (herringbone/gloss centres from the live walk), rebuild
        # the weak core from the floor's OWN visible texture; the closed
        # grain loop below then calibrates the synthesized pixels through
        # the same delivery resample as everything else. Detection is
        # objective: local high-frequency energy far below the ring's.
        lpc = ndimage.gaussian_filter(view_out, (2.5, 2.5, 0.0))
        lumc = (view_out - lpc) @ np.array(
            [0.2126, 0.7152, 0.0722], dtype=np.float32
        )
        loc = ndimage.uniform_filter(np.abs(lumc), 15)
        ring_level = float(np.median(loc[ring]))
        weak = hole_view & (loc < 0.55 * max(ring_level, 1e-6))
        # Geometric cap: synthesis exists for the CORE (donors too oblique at
        # the tripod point), not the whole hole. Uncapped, real sweeps
        # re-quilted ~1M px and locked into visible repetition.
        off_img = np.full(hole_view.shape, np.inf, dtype=np.float32)
        off_img[ys, xs] = np.hypot(
            P_hole[:, 0] - C_t[0], P_hole[:, 1] - C_t[1]
        ).astype(np.float32)
        weak &= off_img < tripod_radius * 2.2
        weak = ndimage.binary_opening(weak, iterations=2)
        lbl, nlb = ndimage.label(weak)
        if nlb:
            sizes = np.bincount(lbl.ravel())
            sizes[0] = 0
            weak = sizes[lbl] > 300
        core_px = int(weak.sum())
        report["core_synthesized_px"] = 0
        if core_px >= 400:
            band_src = (
                ndimage.binary_dilation(weak, iterations=70)
                & ~ndimage.binary_dilation(weak, iterations=3)
                & (dz < -1e-9)
                & (loc >= 0.8 * ring_level)
            )
            if int(band_src.sum()) >= 24 * 24 * 20:
                view_out = synthesize_pattern_core(
                    view_out, weak, band_src, seed=0
                )
                report["core_synthesized_px"] = core_px

    if grain_match and int(ring.sum()) >= 200:
        # Ring-matched grain: donors are sampled obliquely from metres away,
        # so their reprojection is inherently softer than the target's own
        # nadir pixels. Split the composite into low-pass + detail and scale
        # ONLY the detail layer (real reprojected signal, nothing invented)
        # until the hole's grain contrast matches the surrounding ring's.
        # Feathered over 4 px so the boundary contrast stays continuous.
        lp = ndimage.gaussian_filter(view_out, (2.5, 2.5, 0.0))
        detail = view_out - lp
        lum_w = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        lumd = detail @ lum_w
        s_ring = float(lumd[ring].std())
        s_hole = float(lumd[hole_view].std())
        g = float(np.clip(s_ring / max(s_hole, 1e-6), 1.0, grain_gain_cap))
        ramp = np.clip(ndimage.distance_transform_edt(hole_view) / 6.0, 0.0, 1.0)
        boost = detail * (g - 1.0) * ramp[..., None]
        # Locally mean-free: adding texture contrast must not shift local
        # luminance, or the boundary bands read as a faint step.
        boost -= ndimage.gaussian_filter(boost, (4.0, 4.0, 0.0))
        view_out = view_out + boost
        report["grain_gain"] = round(g, 3)
        report["grain_detail_std"] = {
            "ring": round(s_ring, 3),
            "hole_before": round(s_hole, 3),
        }

    # ---- write back only the equirect hole pixels -------------------------
    if hole_mask_eq is not None:
        eq_mask = np.asarray(hole_mask_eq, dtype=bool)
    else:
        # Derive the equirect mask by projecting the bottom band into the
        # view and sampling the detected hole mask.
        band0 = int(eq_h * (180.0 - half_fov_deg) / 180.0) - 2
        eq_mask = np.zeros((eq_h, eq_w), dtype=bool)
        gd = equirect_grid_dirs(eq_w, eq_h, band0, eq_h - band0)
        grows, gcols, ginside = dirs_to_gnomonic_pixels(gd, view_size, half_fov_deg)
        mm = np.zeros((eq_h - band0, eq_w), dtype=np.float32)
        hv = hole_view.astype(np.float32)[..., None]
        mm[ginside] = sample_image(hv, grows[ginside], gcols[ginside])[..., 0]
        eq_mask[band0:] = mm > 0.5

    ery, erx = np.nonzero(eq_mask)
    row0 = int(ery.min()) if ery.size else 0
    band = equirect_grid_dirs(eq_w, eq_h, row0, eq_h - row0)  # band-limited:
    ed = band[ery - row0, erx]  # full grid at 8192 would be ~800 MB
    del band
    grows, gcols, ginside = dirs_to_gnomonic_pixels(ed, view_size, half_fov_deg)
    take = ginside
    filled = tgt.copy()

    def write_back(v):
        vals = sample_image(v.astype(np.float32), grows[take], gcols[take])
        if filled.dtype == np.uint8:
            vals = np.clip(np.rint(vals), 0, 255).astype(np.uint8)
        filled[ery[take], erx[take]] = vals

    write_back(view_out)

    if grain_match and int(ring.sum()) >= 200:
        # Closed-loop residual: the view→equirect→view resample softens the
        # matched grain back down. Measure on the DELIVERED pixels (re-render
        # the filled equirect exactly as a viewer would) and correct once.
        fv = render_view(filled, dirs)
        lp2 = ndimage.gaussian_filter(fv, (2.5, 2.5, 0.0))
        lumd2 = (fv - lp2) @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        s_ring2 = float(lumd2[ring].std())
        s_hole2 = float(lumd2[hole_view].std())
        residual = float(np.clip(s_ring2 / max(s_hole2, 1e-6), 1.0, 1.6))
        report["grain_residual_gain"] = round(residual, 3)
        if residual > 1.02:
            lp3 = ndimage.gaussian_filter(view_out, (2.5, 2.5, 0.0))
            detail3 = view_out - lp3
            ramp3 = np.clip(
                ndimage.distance_transform_edt(hole_view) / 6.0, 0.0, 1.0
            )
            boost3 = detail3 * (residual - 1.0) * ramp3[..., None]
            boost3 -= ndimage.gaussian_filter(boost3, (4.0, 4.0, 0.0))
            view_out = view_out + boost3
            write_back(view_out)

    report["hole_px_eq"] = int(np.count_nonzero(eq_mask))
    report["eq_px_written"] = int(np.count_nonzero(take))
    return filled, report
