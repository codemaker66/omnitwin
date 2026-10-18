import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
meta = json.load(open(OUT + "/scripts/elev_meta.json"))
def row(name, v, band=0.06):
    d = np.load(OUT + f"/scripts/elev_{name}_depth.npy"); mt = meta[name]; r = mt["res"]
    r0 = int((mt["vrange"][1] - (v + band / 2)) / r); r1 = int((mt["vrange"][1] - (v - band / 2)) / r) + 1
    seg = np.nanmedian(d[r0:r1], axis=0)
    us = mt["urange"][0] + (np.arange(d.shape[1]) + 0.5) * r
    sgn = mt["right"][0] + mt["right"][1]
    return us * sgn, seg
def crossing(world, seg, lo, hi, level):
    m = (world > lo) & (world < hi)
    w, s = world[m], seg[m]
    o = np.argsort(w); w, s = w[o], s[o]
    for i in range(len(w) - 1):
        if np.isfinite(s[i]) and np.isfinite(s[i + 1]) and (s[i] - level) * (s[i + 1] - level) <= 0 and s[i] != s[i + 1]:
            return float(w[i] + (level - s[i]) / (s[i + 1] - s[i]) * (w[i + 1] - w[i]))
    return None
out = {}
for v in (2.2, 4.0):
    W, S = row("window_+X", v)
    # window wall: ends are ~+0.20..+0.24 proud of the pier line (depth ref 1.665): crossing at half step
    out[f"window_south_step_v{v}"] = crossing(W, S, 3.3, 4.0, 0.11)
    out[f"window_north_step_v{v}"] = crossing(W, S, 11.1, 11.7, 0.11)
    W, S = row("fireplace_-X", v)
    out[f"fire_south_step_v{v}"] = crossing(W, S, 3.3, 4.0, 0.11)
    out[f"fire_north_step_v{v}"] = crossing(W, S, 11.2, 11.8, 0.11)
for k, val in out.items(): print(k, None if val is None else round(val, 3))
json.dump(out, open(OUT + "/scripts/steps.json", "w"), indent=1)
