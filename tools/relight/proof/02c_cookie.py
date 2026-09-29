"""Window cookie = LiDAR solids (curtains, columns, reveals, sills; 02b_occ_e57.py) with the glass
layer removed (the Pro3 LiDAR returns off the panes) + the glazing bars and fanlight tracery taken
from the splats at the glass depth (opacity > 0.3; the panes themselves hold only faint haze).

Output work/occ_cookie.npz (same grid and fields as occ_e57.npz)
"""
import numpy as np
from common import *


def main():
    g = np.load(f"{WORK}/occ_e57.npz")
    occ = g["occ"].astype(np.float32); lo = g["occ_lo"]; res = float(g["occ_res"])
    dims = np.array(occ.shape)
    cx = lo[0] + (np.arange(dims[0]) + 0.5) * res
    cy = lo[1] + (np.arange(dims[1]) + 0.5) * res
    cz = lo[2] + (np.arange(dims[2]) + 0.5) * res
    depth = Y0 - cy
    removed = 0
    for x0, x1, dg, z0, z1, kind in WINDOWS.values():
        ix = np.where((cx > x0 + 0.03) & (cx < x1 - 0.03))[0]
        iz = np.where((cz > z0 + 0.03) & (cz < z1 - 0.03))[0]
        iy = np.where((depth > dg - 0.07) & (depth < dg + 0.12))[0]
        sub = occ[np.ix_(ix, iy, iz)]
        removed += int((sub > 0).sum())
        occ[np.ix_(ix, iy, iz)] = 0.0
    # glazing bars from the splats
    d = np.load(f"{WORK}/splats.npz")
    p = d["pos"].astype(np.float64); o = d["opa"].astype(np.float32)
    add = np.zeros(len(p), bool)
    for x0, x1, dg, z0, z1, kind in WINDOWS.values():
        add |= (p[:, 0] > x0 - 0.05) & (p[:, 0] < x1 + 0.05) & (p[:, 2] > z0 - 0.05) & (p[:, 2] < z1 + 0.05) \
            & (np.abs((Y0 - p[:, 1]) - dg) < 0.06) & (o > 0.3)
    q = p[add]
    ijk = np.floor((q - lo) / res).astype(np.int64)
    ok = np.all((ijk >= 0) & (ijk < dims), 1)
    ijk = ijk[ok]; a = o[add][ok]
    occ_log = np.log1p(-np.clip(occ, 0, 0.995))
    np.add.at(occ_log, (ijk[:, 0], ijk[:, 1], ijk[:, 2]), np.log1p(-np.clip(a, 0, 0.95)))
    occ = 1.0 - np.exp(occ_log)
    np.savez(f"{WORK}/occ_cookie.npz", occ=occ.astype(np.float16), occ_lo=lo, occ_res=np.array(res))
    print("glass-layer cells cleared", removed, "bar splats added", int(ok.sum()))


if __name__ == "__main__":
    main()
