"""Embrasure occupancy (window cookie) from the Matterport E57 LiDAR (49 Grand Hall scans, read-only
grids from the 24 Sep audit): curtains, columns, glazing bars, reveals and sills as solid 3 cm cells.
The splat embrasure layer is unsuitable as an occluder: the training filled the clipped-white panes
with low-opacity haze, which would make the windows opaque.

Output work/occ_e57.npz  occ (X,Y,Z) f16 alpha, occ_lo, occ_res (same grid as geom.npz)
"""
import time
import numpy as np
from common import *

RES = 0.03
LO = np.array([X0 - 0.15, Y0 - 1.95, 0.25])
HI = np.array([X1 + 0.15, Y0 + 0.12, 5.85])


def main():
    t0 = time.time()
    dims = np.ceil((HI - LO) / RES).astype(int)
    cnt = np.zeros(int(np.prod(dims)), np.int32)
    for i in range(49):
        d = np.load(f"{AUDIT}/e57grid/s{i:02d}.npz")
        xyz = d["xyz"].reshape(-1, 3)
        ok = np.isfinite(xyz[:, 0])
        p = xyz[ok]
        m = np.all((p > LO) & (p < HI), 1) & (p[:, 1] < Y0 + 0.10)
        inwin = np.zeros(len(p), bool)
        for x0, x1, dg, z0, z1, kind in WINDOWS.values():
            inwin |= (p[:, 0] > x0 - 0.35) & (p[:, 0] < x1 + 0.35) & (p[:, 1] > Y0 - dg - 0.35)
        p = p[m & inwin]
        ijk = np.floor((p - LO) / RES).astype(np.int64)
        lin = (ijk[:, 0] * dims[1] + ijk[:, 1]) * dims[2] + ijk[:, 2]
        cnt += np.bincount(lin, minlength=len(cnt)).astype(np.int32)
        print(i, len(p), f"{time.time() - t0:.1f}s", flush=True)
    cnt = cnt.reshape(dims)
    alpha = np.clip(cnt / 4.0, 0, 1).astype(np.float16)     # >= 4 returns: solid
    np.savez(f"{WORK}/occ_e57.npz", occ=alpha, occ_lo=LO, occ_res=np.array(RES), cnt=np.minimum(cnt, 65535).astype(np.uint16))
    print("occupied cells", int((alpha >= 1).sum()), "partial", int(((alpha > 0) & (alpha < 1)).sum()), f"{time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
