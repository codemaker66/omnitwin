"""A robust line through each wall face (plan sections at five heights, 1 cm samples, Tukey IRLS at 2 cm,
two passes: within 5 cm of the believed offset, then within 4 cm of the first line).

The lower section is read 0.45-1.05 m above its floor: clear of the skirting (1-3 cm proud to 0.3 m) and
below the west wall's dado rail (the wall above 1.2 m lies 0.16 m further back). The upper section is read
0.5-1.5 m above its own floor. Faces under a window sill or under the upper floor's edge take lower bands.

    python -X utf8 05_wall_fits.py"""
import json
import numpy as np
from ralib import OUT, room_mesh, band_points, fit_line, FLOOR_LO, FLOOR_UP

LO = [FLOOR_LO + h for h in (0.45, 0.60, 0.75, 0.90, 1.05)]
UP = [FLOOR_UP + h for h in (0.50, 0.75, 1.00, 1.25, 1.50)]
SILL = [FLOOR_LO + h for h in (0.34, 0.38, 0.42, 0.46)]          # under the street windows' boards
RISE = [FLOOR_LO + h for h in (0.15, 0.25, 0.35, 0.45, 0.52)]    # under the upper floor's edge
HIGH = [FLOOR_UP + h for h in (1.80, 1.90, 2.00, 2.10)]          # above the upper west wall's casing
DADO = [FLOOR_LO + h for h in (1.35, 1.6, 1.9, 2.2, 2.5)]        # the lower west wall above its dado rail

# name: (axis the face is across: 0 = X, 1 = Y; believed offset; runs along the other axis; levels)
FACES = {
    # lower section, counter-clockwise from the south-west corner
    "street_w": (1, -10.928, [(-5.90, -5.78), (-3.42, -3.00)], LO),
    "street_w_below_sill": (1, -10.90, [(-5.3, -3.2)], SILL),
    "glass_w": (1, -11.319, [(-5.65, -3.55)], LO),
    "pier_w_west": (0, -2.828, [(-10.70, -8.66)], LO),
    "pier_w_north": (1, -8.097, [(-2.76, -1.83)], LO),
    "pier_w_east": (0, -1.736, [(-10.24, -8.60)], LO),
    "street_c_west": (1, -10.286, [(-1.72, -1.58)], LO),
    "recess_west": (0, -1.557, [(-11.33, -10.34)], LO),
    "glass_c": (1, -11.419, [(-1.50, 1.15)], LO),
    "recess_east": (0, 1.233, [(-11.32, -10.30)], LO),
    "street_c_east": (1, -10.261, [(1.26, 1.70)], LO),
    "pier_e_west": (0, 1.727, [(-10.20, -8.65)], LO),
    "pier_e_north": (1, -8.097, [(1.73, 2.67)], LO),
    "pier_e_east": (0, 2.772, [(-10.20, -8.25)], LO),
    "street_e_below_sill": (1, -10.684, [(2.9, 4.8)], SILL),
    "glass_e": (1, -11.124, [(2.9, 5.0)], LO),
    "se_west": (0, 5.064, [(-10.72, -10.00)], LO),
    "se_return": (1, -9.957, [(5.12, 6.52)], LO),
    "east_south": (0, 6.564, [(-9.90, -6.62)], LO),
    "east_jog": (1, -6.565, [(6.27, 6.54)], LO),
    "east_mid": (0, 6.245, [(-6.52, -5.88)], LO),
    "door_south": (1, -5.817, [(5.42, 6.18)], LO),
    "door_face": (0, 5.265, [(-5.78, -5.56), (-4.10, -3.90)], LO),
    "door_face_lintel": (0, 5.265, [(-5.45, -4.25)], [FLOOR_LO + h for h in (2.08, 2.12)]),
    "door_reveal_south": (1, -5.512, [(5.45, 6.10)], LO),
    "door_reveal_north": (1, -4.172, [(5.45, 6.08)], LO),
    "door_north": (1, -3.865, [(5.40, 6.12)], LO),
    "east_north": (0, 6.245, [(-3.80, -3.32)], LO),
    "ne_south": (1, -3.278, [(5.44, 6.19)], LO),
    "ne_east": (0, 5.300, [(-3.23, -1.53)], LO),
    "back_east": (1, -1.485, [(2.84, 5.25)], LO),
    "pilaster_east": (1, -1.577, [(1.79, 2.67)], LO),
    "alcove_east_corner": (0, 1.61, [(-1.42, -1.20)], LO),
    "alcove_east_mirror": (0, 1.655, [(-0.95, 0.05)], LO),
    "arch_wall_east": (1, 0.384, [(1.17, 1.40)], [FLOOR_LO + h for h in (0.75, 0.90, 1.05, 1.5, 1.8)]),
    "arch_wall_west": (1, 0.384, [(-1.70, -1.29)], [FLOOR_LO + h for h in (0.75, 0.90, 1.05, 1.5, 1.8)]),
    "top_riser": (1, 0.38, [(-1.15, 1.05)], RISE),
    "arch_jamb_west_lining": (0, -1.25, [(0.42, 0.66)], UP),
    "arch_jamb_east_lining": (0, 1.13, [(0.42, 0.62)], UP),
    "alcove_west_corner": (0, -1.805, [(-1.42, -1.02)], LO),
    "alcove_west_mirror": (0, -1.736, [(-0.90, 0.30)], LO),
    "block_south": (1, -1.577, [(-2.77, -1.89)], LO),
    "block_west": (0, -2.895, [(-1.38, 0.56)], LO),
    "lift_head_wall": (1, 0.021, [(-4.55, -4.18)], LO),
    "lift_head_riser": (1, -0.03, [(-3.72, -2.98)], RISE),
    "lift_gate_south": (1, -1.62, [(-3.95, -3.05)], LO),
    "pier_w_cap_west": (0, -2.895, [(-8.48, -8.25)], LO),
    "pier_e_cap_west": (0, 1.63, [(-8.44, -8.22)], LO),
    "lift_west": (0, -4.574, [(-1.44, -0.02)], LO),
    "bay_south_west": (1, -1.485, [(-4.74, -4.60)], LO),
    "door_wall_west": (0, -4.768, [(-2.15, -1.54)], LO),
    "nw_step": (1, -3.278, [(-6.02, -4.80)], LO),
    "west": (0, -5.922, [(-10.3, -3.34)], LO),
    "west_above_dado": (0, -6.082, [(-10.3, -3.34)], DADO),
    # upper section
    "arch_jamb_east": (0, 1.233, [(0.68, 1.19)], UP),
    "east": (0, 0.110, [(5.10, 6.50), (8.75, 9.85)], UP),
    "east_corridor_side": (0, 0.305, [(4.25, 6.50)], UP),
    "east_leaf": (0, -0.108, [(3.13, 4.95)], UP),
    "north": (1, 11.29, [(-5.20, 1.60)], UP),
    "west_north": (0, -5.490, [(5.90, 11.25)], HIGH),
    "west_casing": (0, -5.236, [(8.25, 11.25)], UP),
    "west_return": (1, 5.76, [(-5.40, -4.12)], UP),
    "lobby_west": (0, -4.070, [(0.10, 2.95)], UP),
    "west_south": (0, -4.000, [(5.06, 5.70)], UP),
    "west_leaf": (0, -3.80, [(3.10, 4.98)], UP),
    "lobby_south": (1, 1.455, [(-3.02, -1.46)], UP),
    "block_east_up": (0, -1.345, [(0.71, 1.39)], UP),
    "block_west_up": (0, -3.072, [(0.72, 1.36)], UP),
    "landing_west": (0, -4.070, [(0.10, 1.40)], UP),
    "curve_tail_north": (0, 0.06, [(2.45, 2.97)], UP),
    "curve_tail_south": (1, 1.27, [(0.95, 1.21)], UP),
    "east_north_end": (0, 0.14, [(8.78, 9.85)], UP),
    "east_door_pier": (0, -0.05, [(8.45, 8.70)], [FLOOR_UP + h for h in (1.0, 1.25, 1.5)]),
    "nook_end": (0, 1.66, [(10.93, 11.20)], [FLOOR_UP + h for h in (1.8, 1.9, 2.0)]),
    "nook_south_tail": (1, 10.88, [(1.25, 1.62)], [FLOOR_UP + h for h in (1.25, 1.5, 1.8)]),
}

if __name__ == "__main__":
    M = room_mesh()
    cache = {}
    out = {}
    print("face                    axis   offset    angle   support/level   rms mm  inliers   run")
    for name, (axis, off, runs, levels) in FACES.items():
        key = tuple(levels)
        if key not in cache:
            cache[key] = band_points(M, levels)
        pts, nrm, zz, ln = cache[key]
        o = 1 - axis
        mr = np.zeros(len(pts), bool)
        for lo, hi in runs:
            mr |= (pts[:, o] > lo) & (pts[:, o] < hi)
        mr &= np.abs(nrm[:, axis]) > np.cos(np.radians(20))
        m = mr & (np.abs(pts[:, axis] - off) < 0.05)
        if m.sum() < 10:
            print("%-22s  too few points (%d)" % (name, m.sum()))
            continue
        f = fit_line(pts[m, o], pts[m, axis], ln[m])
        # second pass: points within 4 cm of the first line, so a wall off the axis keeps its far ends
        m = mr & (np.abs(pts[:, axis] - (f["offset_at_mid"] + f["slope"] * (pts[:, o] - f["s_mid"]))) < 0.04)
        f = fit_line(pts[m, o], pts[m, axis], ln[m])
        f.update(axis=axis, support=float(ln[m].sum() / len(levels)), levels=[round(float(v), 3) for v in levels])
        out[name] = f
        print("%-22s  %s  %8.3f  %+6.2f   %6.2f m      %5.1f    %.2f    %.2f..%.2f" % (
            name, "XY"[axis], f["offset_at_mid"], f["angle_deg"], f["support"], f["rms_mm"], f["inliers"], f["s0"], f["s1"]))
    json.dump(out, open(OUT + "/scripts/wall_fits.json", "w"), indent=1)
