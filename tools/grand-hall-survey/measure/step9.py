import os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
def doors(name, lo, hi):
    off = np.load(f'analysis/off-{name}.npy'); along = np.load(f'analysis/along-{name}.npy'); z = np.load(f'analysis/z-{name}.npy')
    H, W = off.shape
    # column coordinate from rows where geometry exists
    col_a = np.nanmedian(np.where(np.isnan(off), np.nan, along), axis=0)
    # per column: fraction of rows in h 0.4..1.8 that are open (nan) or recessed > 0.12
    zrow = np.nanmedian(np.where(np.isnan(off), np.nan, z), axis=1)
    rows = np.nonzero((zrow > 0.4) & (zrow < 1.8))[0]
    sub = off[rows]
    open_frac = np.mean(np.isnan(sub) | (sub < -0.12), axis=0)
    runs = []; cur = None
    for c in range(W):
        if open_frac[c] > 0.6:
            if cur is None: cur = [c, c]
            else: cur[1] = c
        elif cur is not None:
            runs.append(cur); cur = None
    if cur is not None: runs.append(cur)
    print(f'== {name}')
    for c0, c1 in runs:
        if c1 - c0 < 40: continue
        a0, a1 = col_a[c0], col_a[c1]
        if np.isnan(a0) or np.isnan(a1):
            # fall back to neighbours
            a0 = np.nanmedian(col_a[max(0,c0-5):c0]) ; a1 = np.nanmedian(col_a[c1+1:c1+6])
        lo_a, hi_a = min(a0, a1), max(a0, a1)
        if hi_a < lo or lo_a > hi: continue
        # head height: lowest row above 1.8 where the opening closes, over the run's central columns
        cc = np.arange(c0 + (c1-c0)//4, c1 - (c1-c0)//4)
        colmask = np.isnan(off[:, cc]) | (off[:, cc] < -0.12)
        frac_row = colmask.mean(axis=1)
        open_rows = np.nonzero(frac_row > 0.6)[0]
        zt = np.nanmax(zrow[open_rows]) if len(open_rows) else np.nan
        print(f'  along {lo_a:.3f}..{hi_a:.3f} (w {hi_a-lo_a:.3f}, c {(lo_a+hi_a)/2:.3f}) head h {zt:.3f}')
doors('elev-door', -1.8, 19.4)
doors('elev-fire', -10.3, 0.4)
doors('elev-end', -10.3, 0.4)
