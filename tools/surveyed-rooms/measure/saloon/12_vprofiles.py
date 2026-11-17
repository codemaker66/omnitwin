import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import numpy as np
from common import *
meta = json.load(open(OUT + "/scripts/elev_meta.json"))
REF = {"window_+X": ("X", 1.665, -1), "fireplace_-X": ("X", -5.80, +1), "front_-Y": ("Y", 1.48, +1), "rear_+Y": ("Y", 13.645, -1)}
SECTIONS = {  # along-wall world ranges (Y for X walls, X for Y walls)
    "window_+X": [("southEnd", [(3.15, 3.65)]), ("centralPiers", [(3.75, 3.95), (6.0, 6.5), (8.5, 9.05), (11.05, 11.3)]), ("northEnd", [(11.4, 11.85)])],
    "fireplace_-X": [("southEnd", [(2.75, 3.6)]), ("main", [(3.8, 6.5), (8.6, 11.3)]), ("northEnd", [(11.5, 12.0)])],
    "front_-Y": [("main", [(-5.4, -4.9), (-3.0, -1.2), (0.9, 1.3)])],
    "rear_+Y": [("main", [(-5.4, 1.3)])],
}
out = {}
for name, secs in SECTIONS.items():
    d = np.load(OUT + f"/scripts/elev_{name}_depth.npy"); mt = meta[name]; r = mt["res"]
    sgn = mt["right"][0] + mt["right"][1]
    us = mt["urange"][0] + (np.arange(d.shape[1]) + 0.5) * r; world = us * sgn
    vs = mt["vrange"][1] - (np.arange(d.shape[0]) + 0.5) * r
    ax, ref, s_out = REF[name]
    for sname, rngs in secs:
        cols = np.zeros(len(world), bool)
        for a_, b_ in rngs: cols |= (world > a_) & (world < b_)
        prof = np.nanmedian(d[:, cols], axis=1)
        coord = ref - s_out * prof * (-1) if False else ref + (prof if (ax == "X" and s_out == 1) or (ax == "Y" and s_out == 1) else -prof)
        # coord: world X or Y of the surface at each height
        rows = [(round(float(v), 2), None if np.isnan(c) else round(float(c), 3)) for v, c in zip(vs, coord)]
        out[f"{name}:{sname}"] = rows
        pr = [f"{v:.1f}:{'--' if c is None else f'{c:.3f}'}" for v, c in rows[::-5][::-1] if v >= 0]
        print(f"{name}:{sname} ({ax} of surface by height)")
        for i in range(0, len(pr), 10): print("   " + "  ".join(pr[i:i + 10]))
json.dump(out, open(OUT + "/scripts/vprofiles.json", "w"))
