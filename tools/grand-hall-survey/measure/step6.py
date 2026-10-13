import os, sys, json, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from buffers import load
FLOOR = 0.045
def bands(name, xcols, axis):
    v, P = load(name)
    img = np.asarray(Image.open(f'out/{name}.png').convert('RGB')).astype(float)
    H, W = img.shape[:2]
    h_per_row = None
    # z of each row from the position buffer (median over valid pixels)
    Zrow = np.array([np.nanmedian(np.where(P[r, :, 3] > 0.5, P[r, :, 2], np.nan)) if (P[r, :, 3] > 0.5).any() else np.nan for r in range(H)])
    # world coordinate along the wall for each column
    Xcol = np.array([np.nanmedian(np.where(P[:, c, 3] > 0.5, P[:, c, axis], np.nan)) if (P[:, c, 3] > 0.5).any() else np.nan for c in range(W)])
    cols = [int(np.nanargmin(np.abs(Xcol - x))) for x in xcols]
    prof = np.median(img[:, cols, :], axis=1)
    lum = prof @ np.array([0.299, 0.587, 0.114])
    print(f'== {name} columns at', [round(Xcol[c], 2) for c in cols])
    prev = None
    for r in range(0, H, 4):
        if np.isnan(Zrow[r]): continue
        h = Zrow[r] - FLOOR
        if h < -0.1 or h > 7.0: continue
        c = prof[r].astype(int)
        if prev is None or np.abs(c - prev).sum() > 40:
            print(f'  h {h:5.2f}  rgb {tuple(c)}  lum {lum[r]:.0f}')
            prev = c
bands('elev-door', [2.0, 2.6, 4.6, 12.5, 13.2, 14.9], 0)
bands('elev-window', [5.6, 6.2, 11.4, 12.0], 0)
