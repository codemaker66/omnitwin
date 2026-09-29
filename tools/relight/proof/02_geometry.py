"""Geometry for light transport, derived from the captured splats themselves.

* class per splat: 0 interior receiver, 1 embrasure receiver (curtains, columns, reveals, bars),
  2 exterior (env skybox + anything beyond the glass), 3 chandelier emitter, 4 dome-ring emitter
* smoothed normal per splat: PCA of opacity-weighted splat centres in a 24 cm neighbourhood
  (8 cm voxels, 3x3x3), oriented toward the hall's interior "spine"; flagged unreliable when the
  neighbourhood is not planar (ornament, chandeliers, fabric folds) -> those use isotropic irradiance
* window occupancy grid (3 cm) of the embrasures from the embrasure splats: the measured window
  cookie (glazing bars, curtains and their tie-backs, columns, reveals). Empty panes = transparent.

Output work/geom.npz
"""
import time
import numpy as np
from common import *

VOX = 0.08
OCC_RES = 0.03
OCC_LO = np.array([X0 - 0.15, Y0 - 1.95, 0.25])
OCC_HI = np.array([X1 + 0.15, Y0 + 0.12, 5.85])
CHANDELIERS = np.array([[2.24, -7.66, 4.28], [2.24, -2.42, 4.24], [8.90, -5.00, 4.82],
                        [15.50, -7.68, 4.28], [15.47, -2.33, 4.30]])
DOME_C = np.array([8.80, -4.95])


def voxel_pca(p, w):
    key3 = np.floor(p / VOX).astype(np.int64)
    off = key3.min(0) - 2
    k = key3 - off
    dims = k.max(0) + 3
    lin = (k[:, 0] * dims[1] + k[:, 1]) * dims[2] + k[:, 2]
    uk, inv = np.unique(lin, return_inverse=True)
    V = len(uk)
    S = np.zeros((V, 10))
    q = p - (off + 0.5) * VOX  # shift for numerical range
    cols = [w, w * q[:, 0], w * q[:, 1], w * q[:, 2], w * q[:, 0] ** 2, w * q[:, 0] * q[:, 1], w * q[:, 0] * q[:, 2],
            w * q[:, 1] ** 2, w * q[:, 1] * q[:, 2], w * q[:, 2] ** 2]
    for j, c in enumerate(cols):
        S[:, j] = np.bincount(inv, c, V)
    ux = uk // (dims[1] * dims[2]); uy = (uk // dims[2]) % dims[1]; uz = uk % dims[2]
    T = np.zeros_like(S)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                nk = ((ux + dx) * dims[1] + (uy + dy)) * dims[2] + (uz + dz)
                j = np.searchsorted(uk, nk)
                j = np.clip(j, 0, V - 1)
                hit = uk[j] == nk
                T[hit] += S[j[hit]]
    W = np.maximum(T[:, 0], 1e-9)
    m = T[:, 1:4] / W[:, None]
    C = np.empty((V, 3, 3))
    C[:, 0, 0] = T[:, 4] / W - m[:, 0] ** 2; C[:, 0, 1] = C[:, 1, 0] = T[:, 5] / W - m[:, 0] * m[:, 1]
    C[:, 0, 2] = C[:, 2, 0] = T[:, 6] / W - m[:, 0] * m[:, 2]; C[:, 1, 1] = T[:, 7] / W - m[:, 1] ** 2
    C[:, 1, 2] = C[:, 2, 1] = T[:, 8] / W - m[:, 1] * m[:, 2]; C[:, 2, 2] = T[:, 9] / W - m[:, 2] ** 2
    ev, evec = np.linalg.eigh(C)
    n = evec[:, :, 0]
    planar = 1.0 - ev[:, 0] / np.maximum(ev[:, 1], 1e-12)
    return n[inv].astype(np.float32), planar[inv].astype(np.float32), T[inv, 0].astype(np.float32)


def main():
    t0 = time.time()
    d = np.load(f"{WORK}/splats.npz")
    p = d["pos"].astype(np.float64); opa = d["opa"].astype(np.float32); rgb = d["rgb"]; tile = d["tile"]
    lin = srgb_to_linear(rgb / 255.0).astype(np.float32)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    N = len(p)
    cls = np.zeros(N, np.uint8)
    # --- exterior: env skybox, beyond the glass, or far outside the hall box
    ext = tile == 0
    ext |= p[:, 1] < Y0 - 1.3
    for x0, x1, dg, z0, z1, kind in WINDOWS.values():
        inx = (p[:, 0] > x0 - 0.25) & (p[:, 0] < x1 + 0.25)
        ext |= inx & (p[:, 1] < Y0 - dg - 0.20) & (p[:, 2] > z0 - 0.3) & (p[:, 2] < z1 + 0.3)
    far = (p[:, 0] < X0 - 1.5) | (p[:, 0] > X1 + 1.5) | (p[:, 1] > Y1 + 1.5) | (p[:, 2] > 11) | (p[:, 2] < -1.5)
    ext |= far
    # --- embrasures
    emb = np.zeros(N, bool)
    for x0, x1, dg, z0, z1, kind in WINDOWS.values():
        emb |= (p[:, 0] > x0 - 0.2) & (p[:, 0] < x1 + 0.2) & (p[:, 1] > Y0 - dg - 0.20) & (p[:, 1] < Y0 + 0.08) \
            & (p[:, 2] > z0 - 0.35) & (p[:, 2] < z1 + 0.25)
    emb &= ~ext
    cls[emb] = 1
    cls[ext] = 2
    # --- emitters: chandelier bulbs/crystals and dome ring lights (bright splats in the fixture volumes)
    chand_id = np.full(N, -1, np.int8)
    for i, c in enumerate(CHANDELIERS):
        r = np.hypot(p[:, 0] - c[0], p[:, 1] - c[1])
        zlo, zhi, rad = (c[2] - 0.75, c[2] + 1.45, 1.0) if i == 2 else (c[2] - 0.6, c[2] + 0.75, 0.75)
        inside = (r < rad) & (p[:, 2] > zlo) & (p[:, 2] < zhi) & (cls == 0)
        chand_id[inside] = i
    em_ch = (chand_id >= 0) & (lum > 0.30)
    cls[em_ch] = 3
    rd = np.hypot(p[:, 0] - DOME_C[0], p[:, 1] - DOME_C[1])
    em_dome = (cls == 0) & (p[:, 2] > 6.85) & (p[:, 2] < 7.6) & (rd > 2.3) & (rd < 3.6) & (lum > 0.55)
    cls[em_dome] = 4
    print("classes", np.bincount(cls, minlength=5), f"{time.time() - t0:.1f}s", flush=True)

    # --- smoothed normals
    m = (opa > 0.05) & (cls != 2)
    n_s = np.zeros((N, 3), np.float32); planar = np.zeros(N, np.float32); wsum = np.zeros(N, np.float32)
    n_s[m], planar[m], wsum[m] = voxel_pca(p[m], opa[m].astype(np.float64))
    print("voxel pca done", f"{time.time() - t0:.1f}s", flush=True)
    # orient toward the interior spine box
    lo = np.array([X0 + 1.5, Y0 + 1.5, 1.0]); hi = np.array([X1 - 1.5, Y1 - 1.5, 5.5])
    v = np.clip(p, lo, hi) - p
    vn = np.linalg.norm(v, axis=1)
    v = v / np.maximum(vn, 1e-6)[:, None]
    dots = np.einsum("ij,ij->i", n_s, v)
    n_s *= np.where(dots < 0, -1.0, 1.0)[:, None].astype(np.float32)
    reliable = (planar > 0.75) & (np.abs(dots) > 0.25) & (vn > 0.3) & (wsum > 3.0) & (cls == 0)
    # the per-splat raw normal, oriented the same way, as a fallback diagnostic
    n_raw = d["nrm"].astype(np.float32)
    n_raw *= np.where(np.einsum("ij,ij->i", n_raw, v) < 0, -1.0, 1.0)[:, None].astype(np.float32)
    print("reliable normals", reliable.mean().round(3), "of all;", reliable[cls == 0].mean().round(3), "of interior", flush=True)

    # --- embrasure occupancy (soft alpha per 3 cm cell)
    dims = np.ceil((OCC_HI - OCC_LO) / OCC_RES).astype(int)
    occ_log = np.zeros(int(np.prod(dims)), np.float32)   # sum of log(1-alpha)
    e = (cls == 1) & (opa > 0.02)
    ijk = np.floor((p[e] - OCC_LO) / OCC_RES).astype(np.int64)
    ok = np.all((ijk >= 0) & (ijk < dims), 1)
    ijk = ijk[ok]; a = np.clip(opa[e][ok], 0, 0.995)
    li = (ijk[:, 0] * dims[1] + ijk[:, 1]) * dims[2] + ijk[:, 2]
    occ_log += np.bincount(li, np.log1p(-a), len(occ_log)).astype(np.float32)
    alpha = (1.0 - np.exp(occ_log)).reshape(dims)
    # splats are extended Gaussians (median max-scale ~1-5 cm): close the sampling gaps by a 3x3x3 max
    from scipy.ndimage import maximum_filter
    alpha = maximum_filter(alpha, size=3).astype(np.float16)
    print("occupancy", dims, "cells >0.5:", int((alpha > 0.5).sum()), f"{time.time() - t0:.1f}s", flush=True)

    np.savez(f"{WORK}/geom.npz", cls=cls, chand_id=chand_id, n_s=n_s.astype(np.float16), n_raw=n_raw.astype(np.float16),
             planar=planar.astype(np.float16), reliable=reliable, occ=alpha, occ_lo=OCC_LO, occ_res=np.array(OCC_RES),
             chandeliers=CHANDELIERS, dome_c=DOME_C, lum=lum.astype(np.float16))
    print("saved", f"{time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
