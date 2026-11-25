import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
meta = json.load(open(OUT + "/scripts/elev_meta.json"))
def load(name):
    d = np.load(OUT + f"/scripts/elev_{name}_depth.npy"); mt = meta[name]
    return d, mt
def hprof(name, v, step=0.04, u0=None, u1=None, band=0.04):
    d, mt = load(name); r = mt["res"]
    row0 = int((mt["vrange"][1] - (v + band / 2)) / r); row1 = int((mt["vrange"][1] - (v - band / 2)) / r) + 1
    seg = np.nanmedian(d[row0:row1], axis=0)
    us = mt["urange"][0] + (np.arange(d.shape[1]) + 0.5) * r
    out = []
    for u in np.arange(u0 if u0 is not None else mt["urange"][0], u1 if u1 is not None else mt["urange"][1], step):
        k = int((u - mt["urange"][0]) / r)
        val = seg[k] if 0 <= k < len(seg) else np.nan
        out.append(f"{u:+.2f}:{'  --' if np.isnan(val) else f'{val*100:+4.0f}'}")
    return out
def vprof(name, u, step=0.05, v0=-0.05, v1=6.0, band=0.04):
    d, mt = load(name); r = mt["res"]
    c0 = int((u - band / 2 - mt["urange"][0]) / r); c1 = int((u + band / 2 - mt["urange"][0]) / r) + 1
    seg = np.nanmedian(d[:, c0:c1], axis=1)
    out = []
    for v in np.arange(v0, v1, step):
        k = int((mt["vrange"][1] - v) / r)
        val = seg[k] if 0 <= k < len(seg) else np.nan
        out.append(f"{v:.2f}:{'  --' if np.isnan(val) else f'{val*100:+4.0f}'}")
    return out
if __name__ == "__main__":
    name = sys.argv[1]; kind = sys.argv[2]; at = float(sys.argv[3])
    args = [float(x) for x in sys.argv[4:]]
    res = hprof(name, at, *args) if kind == "h" else vprof(name, at, *args)
    for i in range(0, len(res), 10): print("  ".join(res[i:i + 10]))
