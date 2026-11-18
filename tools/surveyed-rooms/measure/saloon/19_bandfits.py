import sys, json; sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from bandlib import *
WALLS = [
    ("front", 1, +1, [(-5.45, -3.6), (-3.3, -0.75), (0.62, 1.30)], {"ped": 1.51, "band": 1.48, "pan": 1.47, "pla": 1.445}),
    ("rear", 1, -1, [(-5.45, 1.30)], {"ped": 13.625, "band": 13.645, "pan": 13.661, "pla": 13.667}),
    ("fireMain", 0, +1, [(3.85, 6.45), (8.65, 11.35)], {"ped": -5.778, "band": -5.80, "pan": -5.804, "pla": -5.825}),
    ("fireSouthEnd", 0, +1, [(1.65, 3.05)], {"ped": -5.498, "band": -5.57, "pan": -5.575, "pla": -5.588}),
    ("fireNorthEnd", 0, +1, [(12.05, 13.55)], {"ped": -5.50, "band": -5.60, "pan": -5.611, "pla": -5.628}),
    ("winPiers", 0, -1, [(3.80, 3.98), (5.9, 6.55), (8.45, 9.12), (11.02, 11.3)], {"ped": 1.567, "band": 1.665, "pan": 1.668, "pla": 1.694}),
    ("winSouthEnd", 0, -1, [(3.0, 3.68)], {"ped": 1.341, "band": 1.40, "pan": 1.429, "pla": 1.47}),
    ("winNorthEnd", 0, -1, [(11.38, 11.88), (12.15, 13.4)], {"ped": 1.333, "band": 1.42, "pan": 1.453, "pla": 1.464}),
]
BANDS = {"pedestal 0.3-1.0": ("ped", np.arange(0.3, 1.001, 0.05)), "task band 1.0-1.6": ("band", np.arange(1.0, 1.601, 0.05)),
         "panelling 1.6-2.8": ("pan", np.arange(1.6, 2.801, 0.05)), "plaster 3.4-5.2": ("pla", np.arange(3.4, 5.201, 0.1))}
res = {}
for bname, (key, lv) in BANDS.items():
    P, N, Z, W = band_points(lv)
    print("==", bname)
    for wid, axis, sgn, rngs, guess in WALLS:
        f = fit_line(P, N, Z, W, axis, sgn, guess[key], rngs, tol=0.05 if key != "band" else 0.08)
        if f is None: print(f"   {wid}: no fit"); continue
        res.setdefault(wid, {})[bname] = f
        print(f"   {wid:13s} {'XY'[axis]}={f['offset_at_mid']:.4f} (axis-parallel {f['offset_axis_parallel']:.4f}) angle {f['angle_deg']:+.3f} deg support {f['support_m']:.2f} m inliers {f['inlier_share']:.2f} rms {f['rms_mm']:.1f} mm p95 {f['p95_abs_mm']:.0f} mm")
json.dump(res, open(OUT + "/scripts/band_fits.json", "w"), indent=1)
