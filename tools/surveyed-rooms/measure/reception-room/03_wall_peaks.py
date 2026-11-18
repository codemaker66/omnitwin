"""Where the walls are: plan sections of the near-vertical faces at five heights in the plain wall band
(0.6-1.8 m above the floor, between the skirting and the cove ledge), sampled every centimetre, then for
each of the four inward normals the offsets that hold at least 0.4 m of wall per level, and the runs
along the wall each offset covers."""
import numpy as np
from rlib import OUT, FLOOR_Z, room_mesh, band_points

M = room_mesh()
LEVELS = [FLOOR_Z + h for h in (0.6, 0.9, 1.2, 1.5, 1.8)]
P, N, Z, L = band_points(M, LEVELS)
np.savez(OUT + "/scripts/wallpoints.npz", P=P, N=N, Z=Z, L=L)
print("points", len(P), "wall length per level %.1f m" % (L.sum() / len(LEVELS)))
keep = (P[:, 0] > 10.3) & (P[:, 0] < 22.0) & (P[:, 1] > 0.5) & (P[:, 1] < 15.0)
P, N, Z, L = P[keep], N[keep], Z[keep], L[keep]
# the mesh's normals may point either way: report both senses, by which side the room lies on
for axis, name in ((0, "X"), (1, "Y")):
    o = 1 - axis
    m = np.abs(N[:, axis]) > 0.94
    t, s, w = P[m, axis], P[m, o], L[m] / len(LEVELS)
    bins = np.arange(t.min() - 0.005, t.max() + 0.01, 0.01)
    h, e = np.histogram(t, bins=bins, weights=w)
    sm = np.convolve(h, np.ones(3), "same")
    print("\nfaces across %s (offset: metres of wall per level within +-1.5 cm; runs along %s)" % (name, "Y" if axis == 0 else "X"))
    for k in np.argsort(-sm):
        if sm[k] < 0.4:
            break
        if sm[k] < sm[max(0, k - 3):k + 4].max():
            continue
        off = e[k] + 0.005
        mm = np.abs(t - off) < 0.02
        occ = np.zeros(int(np.ceil((s[mm].max() - s[mm].min()) / 0.05)) + 1)
        np.add.at(occ, ((s[mm] - s[mm].min()) / 0.05).astype(int), w[mm])
        on = occ > 0.02
        runs, i = [], 0
        while i < len(on):
            if on[i]:
                j = i
                while j + 1 < len(on) and (on[j + 1] or (j + 2 < len(on) and on[j + 2])):
                    j += 1
                if (j - i + 1) * 0.05 >= 0.15:
                    runs.append("%.2f..%.2f" % (s[mm].min() + i * 0.05, s[mm].min() + (j + 1) * 0.05))
                i = j + 1
            else:
                i += 1
        print("  %s %7.3f  %5.2f m   %s" % (name, off, sm[k], "  ".join(runs)))
