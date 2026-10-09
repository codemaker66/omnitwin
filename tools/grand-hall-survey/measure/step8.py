import os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
def components(mask):
    """4-connected components (pure numpy/python BFS on a boolean grid)."""
    H, W = mask.shape
    labels = np.zeros((H, W), np.int32)
    n = 0
    for r0 in range(H):
        row = mask[r0]
        for c0 in np.nonzero(row & (labels[r0] == 0))[0]:
            if labels[r0, c0]: continue
            n += 1
            stack = [(r0, c0)]
            labels[r0, c0] = n
            while stack:
                r, c = stack.pop()
                for rr, cc in ((r+1,c),(r-1,c),(r,c+1),(r,c-1)):
                    if 0 <= rr < H and 0 <= cc < W and mask[rr, cc] and not labels[rr, cc]:
                        labels[rr, cc] = n
                        stack.append((rr, cc))
    return labels, n
def openings(name, thresh=-0.22, min_px=4000):
    off = np.load(f'analysis/off-{name}.npy')
    along = np.load(f'analysis/along-{name}.npy')
    z = np.load(f'analysis/z-{name}.npy')
    valid = ~np.isnan(off)
    # unknown pixels (no geometry = open doorway into far space) also count as openings
    mask = (valid & (off < thresh))
    lab, n = components(mask)
    out = []
    for k in range(1, n + 1):
        m = lab == k
        if m.sum() < min_px: continue
        a = along[m]; zz = z[m]
        a0, a1 = np.percentile(a, [0.5, 99.5]); z0, z1 = np.percentile(zz, [0.5, 99.5])
        depth = -np.nanmedian(off[m])
        # top profile: per column max z (for arch fitting)
        cols = np.unique(np.nonzero(m)[1])
        prof = []
        for c in cols[::4]:
            rows = np.nonzero(m[:, c])[0]
            prof.append((float(np.nanmedian(along[rows, c])), float(np.nanmax(z[rows, c]))))
        out.append(dict(a0=a0, a1=a1, z0=z0, z1=z1, depth=depth, n=int(m.sum()), prof=prof))
    out.sort(key=lambda o: o['a0'])
    print(f'== {name}: {len(out)} openings')
    for o in out:
        w = o['a1'] - o['a0']
        print(f"  along {o['a0']:.3f}..{o['a1']:.3f} (w {w:.3f}, c {(o['a0']+o['a1'])/2:.3f})  h {o['z0']:.3f}..{o['z1']:.3f}  depth {o['depth']:.2f}  px {o['n']}")
        # arch fit: points in the top 1.6 m of the profile
        pr = np.array(o['prof'])
        top = pr[pr[:, 1] > o['z1'] - 1.6]
        if len(top) > 10 and w > 2.0:
            A = np.c_[2 * top[:, 0], 2 * top[:, 1], np.ones(len(top))]
            bvec = top[:, 0] ** 2 + top[:, 1] ** 2
            sol, *_ = np.linalg.lstsq(A, bvec, rcond=None)
            cx, cz, k0 = sol
            R = np.sqrt(k0 + cx ** 2 + cz ** 2)
            print(f"     arch fit: centre along {cx:.3f}, springing h {cz:.3f}, radius {R:.3f}")
    return out
if __name__ == "__main__":
    import json
    if __name__ != "__main__":
        pass
    res = {}
    for name in ['elev-window', 'elev-door', 'elev-fire', 'elev-end']:
        res[name] = openings(name)
    json.dump({k: [{kk: vv for kk, vv in o.items() if kk != 'prof'} for o in v] for k, v in res.items()}, open('analysis/openings.json', 'w'), indent=1)
