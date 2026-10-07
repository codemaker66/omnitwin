"""The sun's and the moon's bounce, baked per direction and factored (spec 4.3, amended 3 October: replaces the
area-scaled bounce and moonlight is a light source like the sun; amended 4 October: each window's power is factored out).

Radiosity is linear in the direct light, so the bounce of a white unit sun (or moon: the bounce is per unit irradiance
and only the direction matters) is fixed by where it lands. The bake follows the proof's own path (radiosity.patch_sun's
16 rays per patch through lt.trace_to_windows, then radiosity.radiosity and radiosity.probe_indirect) at every
wall-facing node of a 4-degree sun-direction grid over the sky band, the sun's and the moon's (windows.sun_nodes), split
by the window that lets each ray in, with that window's horizon gate left open: sum_w gate_w(s) B_w(s) is the proof's
gated bounce exactly. B_w switches on and off within a few degrees of sun direction, which no 4-degree interpolation can
follow, so it is factored: B_w(s) = P_w(s) R_w(s). P_w, the power the room's patches receive through window w
(window_power: the same 16 rays per patch, marched by the browser twin, with the glass transmission and the horizon
gate), is exact at every evaluation and never interpolated. R_w = B_w / P_w, the window's bounce per unit power, varies
smoothly. The eigen-decomposition of the unit fields at the nodes that have real power in the window (real_nodes) gives
K basis probe volumes on the 1 m probe grid (probes.coarse_grid at SPACING), and each node keeps K coefficients per
window, every other needed node copying the nearest real node of its window (fill_from_nearest, bake_table). For a
light the browser mixes the four surrounding nodes' coefficients bilinearly (windows.sun_corners), each window's scaled
by its exact power (coefficients), and folds the K volumes (bounce). The display's direct term is sum_w P_w x light
colour / floor area, and its floor bounce is the coefficients . floorMean (each volume's mean floor bounce, kept by the
bake).

The gate (GATE, the controller's ruling of 3 October), over held-out real suns, on the face-mean bounce luminance at the
valid 0.5 m probes where the exact bounce is non-zero: the pooled median |dlog2| is at most 0.25, and so is the median
of every sun whose mean bounce is at least 5% of the median sun's. Fainter suns are reported but do not decide: their
bounce is too faint to see, and a log error exaggerates small values.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import windows as W

GATE = {"median": 0.25, "brightShare": 0.05}
STEP = 4.0                                      # degrees between sun-direction nodes
SPACING = 1.0                                   # metres between the basis volumes' probes
OFFSETS = (-0.1875, -0.0625, 0.0625, 0.1875)    # radiosity.patch_sun's 4 x 4 sub-samples of a 0.5 m patch
LIFT = 0.02                                     # patch_sun's rays start 2 cm off the patch
REUSE_TOL = 1e-9                                # unit vectors this close in every component are the same direction


@dataclass(frozen=True)
class Table:
    coeffs: np.ndarray    # (rows, columns, 5, K) float32: each node's coefficients per window of R_w, its bounce per unit power
    az0: float            # compass azimuth of column 0 (degrees)
    el0: float            # elevation of row 0 (degrees)
    step: float           # degrees between nodes


@dataclass(frozen=True, eq=False)
class Patches:
    """The room's surface patches as the browser holds them, all float32: the proof's 16 sub-sample ray origins of every
    patch (patch_rays, sub-sample-major), the patch normals and the patch areas (m2)."""
    rays: np.ndarray       # (16 n, 3)
    normals: np.ndarray    # (n, 3)
    areas: np.ndarray      # (n,)

    @classmethod
    def from_arrays(cls, centres, normals, areas) -> "Patches":
        return cls(patch_rays(centres, normals).astype(np.float32), np.asarray(normals, np.float32), np.asarray(areas, np.float32))


def window_power(volumes, horizons, fresnel, patches: Patches, s, gated=True) -> np.ndarray:
    """(windows,) float64: P_w(s), the power the room's patches receive through window w, in m2 per unit sun irradiance,
    exact at the float32 sun: the patches' 16 sub-sample rays are marched by the browser twin (windows.
    sun_visibility_by_window: each ray belongs to the first window that claims it, transmittance times the glass
    transmission at |s_y|), summed in float32 in sub-sample order, divided by 16 (the patch's lit fraction), times
    max(N . s, 0), times the patch area, summed over the patches in float64: sum_p A_p lit_wp max(N_p . s, 0), the proof's
    own patch sun (radiosity.patch_sun, split by window). Zero for a window while the sun is below its horizon
    (windows.above_horizon, when gated) and for every window when the sun is behind the wall. P_w switches on and off
    within a few degrees of sun direction, so it is computed at every evaluation and never interpolated; ungated, it is
    what the nodes are normalised by (their horizon gates are open)."""
    vols = list(volumes.values()) if isinstance(volumes, dict) else list(volumes)
    s32 = np.asarray(s, np.float32)
    out = np.zeros(len(vols))
    if not float(s32[1]) < -W.MIN_DOWN:
        return out
    n = len(patches.areas)
    T = W.sun_visibility_by_window(vols, fresnel, patches.rays, s32)           # (windows, 16 n) float32
    lit = np.zeros((len(vols), n), np.float32)
    for k in range(len(OFFSETS) ** 2):
        lit += T[:, k * n:(k + 1) * n]
    cosine = np.clip(patches.normals.astype(np.float64) @ s32.astype(np.float64), 0.0, None)
    power = (patches.areas.astype(np.float64) * (lit / 16.0 * cosine)).sum(1)
    for w, vol in enumerate(vols):
        if not gated or W.above_horizon(horizons[w], s32, vol.x_bearing):
            out[w] = power[w]
    return out


def coefficients(table: Table, powers, az, el) -> np.ndarray:
    """(K,) float64: the basis volumes' weights for a sun at compass azimuth az and elevation el (degrees). In float64
    and this order (the browser's twin repeats it): for each of sun_corners' four nodes in its order, for each window
    W1..W5 whose exact power (window_power) is above zero, add (the node's weight times the window's power) times the
    node's coefficients for that window."""
    out = np.zeros(table.coeffs.shape[3:], np.float64)
    for j, i, weight in W.sun_corners(table.az0, table.el0, table.step, table.coeffs.shape[:2], az, el):
        for w in range(table.coeffs.shape[2]):
            if powers[w] > 0.0:
                out += (weight * float(powers[w])) * np.asarray(table.coeffs[j, i, w], np.float64)
    return out


def bounce(basis, coeffs) -> np.ndarray:
    """(M, 3, 6) float64: the bounce of a white unit sun, sum_k coeffs[k] basis[k], basis (K, M, 3, 6)."""
    return np.tensordot(np.asarray(coeffs, np.float64), np.asarray(basis, np.float64), axes=(0, 0))


def sun_bounce(table: Table, basis, volumes, horizons, fresnel, patches: Patches, x_bearing, s) -> np.ndarray:
    """(M, 3, 6) float64: the bounce of a white unit sun toward s (model frame) from the baked table and volumes, as the
    browser evaluates it: each window's exact power at the float32 sun (window_power: the patch rays marched, glass
    transmission and horizon gate), the sun's azimuth and elevation, the nodes' unit-field coefficients mixed bilinearly
    and scaled by those powers, the volumes folded. Zero when the sun is behind the wall."""
    s32 = np.asarray(s, np.float32)
    az, el = W.sun_az_el(s32, x_bearing)
    return bounce(basis, coefficients(table, window_power(volumes, horizons, fresnel, patches, s32), az, el))


REAL_FRACTION = 1e-4    # a node has real power in a window from this fraction of the window's median non-zero node power


def real_nodes(power, fraction=REAL_FRACTION) -> np.ndarray:
    """(rows, columns, windows) bool: where a node has real power in a window. power (rows, columns, windows) is each
    node's ungated entering power; a node is real in a window when its power is at least `fraction` of the median of
    that window's non-zero node powers (a window that never lights has no real node)."""
    power = np.asarray(power, np.float64)
    real = np.zeros(power.shape, bool)
    for w in range(power.shape[2]):
        lit = power[..., w] > 0.0
        if lit.any():
            real[..., w] = lit & (power[..., w] >= fraction * float(np.median(power[..., w][lit])))
    return real


def fill_from_nearest(real, values, where=None) -> np.ndarray:
    """A copy of values (rows, columns, ...) in which every node of `where` (default: every node) that is not `real`
    takes the value of the nearest real node. Nearest is by squared distance in grid-index space, (rows apart)^2 +
    (columns apart)^2, an integer, so there is no rounding; a tie goes to the first real node in row-major order
    (smaller row, then smaller column). A real node keeps its own value. Raises ValueError when no node is real."""
    real = np.asarray(real, bool)
    if not real.any():
        raise ValueError("no node has real power to copy from")
    out = np.array(values, copy=True)
    todo = ~real if where is None else (np.asarray(where, bool) & ~real)
    rj, ri = np.nonzero(real)                         # row-major order: argmin returns the first minimum
    for j, i in zip(*np.nonzero(todo)):
        m = int(np.argmin((rj - j) ** 2 + (ri - i) ** 2))
        out[j, i] = values[rj[m], ri[m]]
    return out


@dataclass(frozen=True, eq=False)
class Baked:
    coeffs: np.ndarray    # (rows, columns, windows, K) float32: the unit fields' coefficients, every needed node filled
    basis: np.ndarray     # (K, M, 3, 6) float16: the basis volumes, each scaled to its largest absolute value
    real: np.ndarray      # (rows, columns, windows) bool: where a node has real power (its coefficients are its own)
    lam: np.ndarray       # the unit fields' eigenvalues, descending, float64
    rank: int             # the number of eigenvalues above 1e-12 of the largest


def bake_table(fields, power, nodes, needed, valid, kmax, fraction=REAL_FRACTION) -> Baked:
    """The coefficient table and basis volumes of the unit fields R_w = B_w / P_w. fields (n, windows, M, 3, 6): each
    facing node's per-window bounce of a white unit sun (gates open); power (n, windows): each node's ungated window
    power P_w (window_power); nodes: n (row, column) pairs on the (rows, columns) `needed` grid; valid (M,): the probes
    the eigen-decomposition counts. The unit field of every real (node, window) pair (real_nodes at `fraction`) is
    one row of the decomposition; K = min(kmax, rank) volumes are scaled to their largest absolute value, held in
    float16, and each pair's coefficients are multiplied by that scale and held in float32. Every other needed node
    takes the coefficients of the nearest real node of its window (fill_from_nearest); nodes that are not needed stay
    zero."""
    power = np.asarray(power, np.float64)
    rows_n, cols_n = needed.shape
    windows = power.shape[1]
    grid = np.zeros((rows_n, cols_n, windows))
    for n, (j, i) in enumerate(nodes):
        grid[j, i] = power[n]
    real = real_nodes(grid, fraction)
    index = {(int(j), int(i)): n for n, (j, i) in enumerate(nodes)}
    pairs = [(index[(int(j), int(i))], w, int(j), int(i)) for j, i, w in zip(*np.nonzero(real))]
    shape = tuple(fields.shape[2:])
    rows = np.empty((len(pairs), int(np.prod(shape))), np.float32)
    for r, (n, w, _j, _i) in enumerate(pairs):
        rows[r] = (np.asarray(fields[n, w], np.float64).reshape(-1) / power[n, w]).astype(np.float32)
    V, lam = row_eigen(rows[:, np.repeat(np.asarray(valid, bool), int(np.prod(shape[1:])))])
    rank = int((lam > lam[0] * 1e-12).sum())
    k = min(kmax, rank)
    U = basis_volumes(rows, V, lam, k)
    C = node_coefficients(V, lam, k)
    scale = np.abs(U).max(0)
    coeffs = np.zeros((rows_n, cols_n, windows, k), np.float32)
    for r, (_n, w, j, i) in enumerate(pairs):
        coeffs[j, i, w] = (C[r] * scale).astype(np.float32)
    for w in range(windows):
        if real[..., w].any():
            coeffs[:, :, w] = fill_from_nearest(real[..., w], coeffs[:, :, w], needed)
    return Baked(coeffs, (U / scale).T.reshape((k,) + shape).astype(np.float16), real, lam, rank)


def log2_errors(rec, exact) -> np.ndarray:
    """|log2(rec / exact)| wherever exact > 0, inf where the reconstruction is not positive there."""
    rec, exact = np.asarray(rec, np.float64), np.asarray(exact, np.float64)
    lit = exact > 0
    d = np.full(int(lit.sum()), np.inf)
    ok = rec[lit] > 0
    d[ok] = np.abs(np.log2(rec[lit][ok]) - np.log2(exact[lit][ok]))
    return d


def gate(per_sun, brightness, pooled) -> dict:
    """GATE over held-out suns: per_sun (n,) each sun's median |dlog2|, brightness (n,) each sun's mean exact bounce,
    pooled every scored probe's |dlog2| over all suns."""
    per_sun = np.asarray(per_sun, np.float64)
    rel = np.asarray(brightness, np.float64) / float(np.median(brightness))
    bright, over = rel >= GATE["brightShare"], per_sun > GATE["median"]
    pooled_median = float(np.median(pooled))
    return {"pass": bool(pooled_median <= GATE["median"] and not (over & bright).any()), "pooledMedian": pooled_median,
            "brightSuns": int(bright.sum()), "brightOver": int((over & bright).sum()), "faintOver": int((over & ~bright).sum()),
            "worstBright": float(per_sun[bright].max()), "worst": float(per_sun.max()), "medianOfSuns": float(np.median(per_sun))}


MARGIN = 0.20    # K keeps this much room under the gate: the worst bright direction's median |dlog2| on the selection set (a fifth under 0.25), from K up


def choose_k(results) -> tuple[int, str]:
    """(K, rule) from the gate's result at each K (results[k - 1], from `gate`, on the selection set), the stable
    margin rule (the ruling of 7 October): the smallest K from which the gate passes and the worst bright direction is at
    most MARGIN at that K and at every larger K up to the last one tried ("margin"). A dip that rises above MARGIN again
    is luck, not a margin, so it is not taken. When no K is stable the smallest K that passes is kept
    ("smallestPassing"); when none passes, the last K ("none")."""
    n = len(results)
    stable = n + 1                                  # the smallest K of the unbroken run of good K that ends at the last one
    for k in range(n, 0, -1):
        if results[k - 1]["pass"] and results[k - 1]["worstBright"] <= MARGIN:
            stable = k
        else:
            break
    if stable <= n:
        return stable, "margin"
    for k, r in enumerate(results, 1):
        if r["pass"]:
            return k, "smallestPassing"
    return n, "none"


def reused(s, used) -> bool:
    """True when the unit vector s is one of the directions in `used` (unit vectors the same to REUSE_TOL in every
    component, which is float noise, not a nearby direction): the independent check must not score a direction the
    selection scored, nor a grid node, where the bilinear lookup is exact."""
    if len(used) == 0:
        return False
    return bool((np.abs(np.asarray(used, np.float64) - np.asarray(s, np.float64)).max(axis=1) <= REUSE_TOL).any())


def row_eigen(X, chunk=16384):
    """(V, lam): the eigenvectors (columns) and eigenvalues, descending and float64, of X X^T for rows X (n, columns),
    the SVD of the stacked fields in its row space (few rows, many columns)."""
    G = np.zeros((X.shape[0], X.shape[0]))
    for c0 in range(0, X.shape[1], chunk):
        Xc = np.asarray(X[:, c0:c0 + chunk], np.float64)
        G += Xc @ Xc.T
    lam, V = np.linalg.eigh(G)
    return V[:, ::-1].copy(), np.clip(lam[::-1], 0.0, None)


def basis_volumes(X, V, lam, K, chunk=16384) -> np.ndarray:
    """(columns, K) float64: the first K right singular vectors X^T V / sqrt(lam), for rows X over any columns (the
    SVD's own columns give orthonormal vectors; others extend them with the same combination of the rows)."""
    U = np.empty((X.shape[1], K))
    for c0 in range(0, X.shape[1], chunk):
        U[c0:c0 + chunk] = np.asarray(X[:, c0:c0 + chunk], np.float64).T @ V[:, :K] / np.sqrt(lam[:K])
    return U


def node_coefficients(V, lam, K) -> np.ndarray:
    """(rows, K) float64: each row's coefficients on the first K basis volumes, V sqrt(lam)."""
    return V[:, :K] * np.sqrt(lam[:K])


def trilinear_matrix(origin, spacing, shape, valid, points):
    """(points, probes) sparse: each point's trilinear weights on the grid (probe index (ix ny + iy) nz + iz), the cell
    clamped into the grid and the position into the cell (03_bases.trilinear_weights), corners at invalid probes
    dropped and the rest renormalised (a point with no valid corner gets none)."""
    import scipy.sparse as sp
    shape = np.asarray(shape, np.int64)
    f = (np.asarray(points, np.float64) - np.asarray(origin, np.float64)) / spacing
    i0 = np.clip(np.floor(f).astype(np.int64), 0, shape - 2)
    t = np.clip(f - i0, 0.0, 1.0)
    idx, wts = [], []
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                ii = ((i0[:, 0] + dx) * shape[1] + (i0[:, 1] + dy)) * shape[2] + (i0[:, 2] + dz)
                ww = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                idx.append(ii); wts.append(ww * np.asarray(valid, np.float64)[ii])
    idx, wts = np.stack(idx, 1), np.stack(wts, 1)
    total = wts.sum(1, keepdims=True)
    wts = np.where(total > 1e-6, wts / np.maximum(total, 1e-6), 0.0)
    return sp.csr_matrix((wts.ravel(), (np.repeat(np.arange(len(f)), 8), idx.ravel())), shape=(len(f), int(shape.prod())))


def patch_rays(P, N) -> np.ndarray:
    """(16 n, 3) float64: radiosity.patch_sun's ray origins, sub-sample-major (u over OFFSETS outer, v inner): each patch
    centre moved u, v along the two axes after its normal's dominant one, then LIFT along its normal."""
    P, N = np.asarray(P, np.float64), np.asarray(N, np.float64)
    ax = np.argmax(np.abs(N), 1)
    rows = np.arange(len(P))
    out = []
    for u in OFFSETS:
        for v in OFFSETS:
            off = np.zeros_like(P)
            off[rows, (ax + 1) % 3] = u
            off[rows, (ax + 2) % 3] = v
            out.append(P + off + N * LIFT)
    return np.concatenate(out)


def patch_sun_by_window(lt, occ, rays, normals, s, chunk=300_000) -> np.ndarray:
    """(5, patches) float64: radiosity.patch_sun's lit fraction x cosine, split by the window that claims each ray
    (lt.trace_to_windows), every horizon gate open, the glass transmission applied. rays: patch_rays as a float32 torch
    tensor. Gated by the proof's horizons (proof_gates) and summed over the windows, this is patch_sun exactly."""
    import torch
    s32 = torch.tensor(np.asarray(s), dtype=torch.float32)
    T = torch.zeros((5, rays.shape[0]), dtype=torch.float32)
    if float(s32[1]) < -W.MIN_DOWN:
        for a in range(0, rays.shape[0], chunk):
            Pc = rays[a:a + chunk]
            win, Tc = lt.trace_to_windows(occ, Pc, s32[None].expand(Pc.shape[0], 3).contiguous())
            for w in range(5):
                T[w, a:a + chunk] = torch.where(win == w, Tc, torch.zeros_like(Tc))
        T = T * lt.glass_t(abs(float(s32[1])))
    n = len(normals)
    T = T.numpy().reshape(5, len(OFFSETS) ** 2, n)
    acc = np.zeros((5, n), np.float32)
    for k in range(len(OFFSETS) ** 2):
        acc += T[:, k]
    return acc / 16.0 * np.clip(np.asarray(normals) @ np.asarray(s), 0, None)


def proof_gates(lt, s) -> np.ndarray:
    """(5,) bool: lt.sun_direct's own horizon test per window (elevation above lt.horizon_deg at the sun's bearing)."""
    import math
    import torch
    s32 = torch.tensor(np.asarray(s), dtype=torch.float32)
    if float(s32[1]) >= -W.MIN_DOWN:
        return np.zeros(5, bool)
    el = math.degrees(math.asin(float(s32[2])))
    az = float(lt.bearing_deg(s32[None])[0])
    return np.array([bool(el > lt.horizon_deg(torch.tensor([w]), torch.full((1,), az))[0]) for w in range(5)])
