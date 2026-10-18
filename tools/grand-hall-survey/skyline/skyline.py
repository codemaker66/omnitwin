"""Skyline (horizon) profiles from the city DSM, cast from points on the Grand Hall's window wall.

A profile is, for each true azimuth from 11.0 to 191.5 degrees in 0.5 degree
steps (the half of the sky the window wall faces), the highest elevation angle
of the DSM seen from one point: rays march 3 to 600 m out (step 0.25 m + 0.4 %
of the distance), read the DSM bilinearly and allow for the earth's curvature
(drop d^2 / 2R, R = 6371 km; no refraction). Samples inside the hall's own
cornice zone are ignored (see FAC_O below): the strip less than 1.25 m in
front of the facade plane, along the hall's own street frontage only. A ray
that never leaves it returns NaN.

The window openings are read from hall-spec.ts, not restated here. The facade
frame (FAC_O, FAC_N, FAC_U), the frontage's extent (FAC_U_RANGE) and the frame
bearing (102.96 degrees grid) are constants of the Trades Hall facade fit to
the same DSM (the promo-film pipeline's spec/facade/facade.json:
frames.facade.origin_local, d_axis_local and u_axis_local, and the two ends of
frontage.line_wall_face_local, 30.6 m apart); they are not read at run time.

Library for final.py. Run directly, it is a diagnostic: it checks the grid's
orientation against the dome crown and prints each window's centre profile.

Usage: python3 skyline.py <dsm-dir> [--hall-spec <hall-spec.ts>] [--raw <file.json>]
"""
import argparse
import json
import math
import re
from pathlib import Path

import numpy as np
from scipy.ndimage import map_coordinates

REPO = Path(__file__).resolve().parents[3]
HALL_SPEC = REPO / "packages" / "web" / "src" / "components" / "grand-hall" / "hall-spec.ts"

G = 6000
RES = 0.5
HALF = 1500
EARTH_R = 6371000.0
GRID_MINUS_TRUE = 1.861   # grid bearing = true bearing + 1.861


def load_dsm(dsm_dir):
    """heights_50cm.f32 from fetch_dsm.py: row 0 = south, column 0 = west, metres above 10.7 m ODN."""
    dsm_dir = Path(dsm_dir)
    meta = json.loads((dsm_dir / "meta.json").read_text(encoding="utf-8"))
    if (meta["grid"], meta["res"], meta["sizeM"] / 2, meta["originE"], meta["originN"]) != (G, RES, HALF, 259329.0, 665183.0):
        raise SystemExit(f"{dsm_dir}: not the fetch_dsm.py grid")
    return np.fromfile(dsm_dir / "heights_50cm.f32", dtype="<f4").reshape(G, G)


def read_openings(hall_spec=HALL_SPEC):
    """The window wall's five openings from hall-spec.ts, in planner x (centre) and heights above the floor."""
    src = Path(hall_spec).read_text(encoding="utf8")
    length = float(re.search(r'HALL_LENGTH = ([\d.]+)', src).group(1))
    half_l = length / 2
    cx = float(re.search(r'centre: \[([\d.]+), (-?[\d.]+)\] as const', src).group(1))
    openings = []
    for m in re.finditer(r'\{ id: "([\w-]+)", kind: "(arched-window|window)", wall: "window", centre: windowU\((-?[\d.]+)\), width: ([\d.]+), sill: ([\d.]+), head: ([\d.]+) \}', src):
        id_, kind, sx, w, sill, head = m.groups()
        sx, w, sill, head = float(sx), float(w), float(sill), float(head)
        u = half_l + cx - sx           # windowU()
        x = -half_l + u                # window wall: origin x = -HALF_L, tangent +x
        top = head + w / 2 if kind == "arched-window" else head
        openings.append(dict(id=id_, kind=kind, centreX=x, width=w, sill=sill, top=top))
    if len(openings) != 5:
        raise SystemExit(f"{hall_spec}: expected the window wall's 5 openings, found {len(openings)}")
    return openings


# ---- frame mapping (planner frame -> DSM local metres E, N from E259329 N665183)
HALL0 = np.array([3.0, 8.0])


def ub(b):
    b = math.radians(b)
    return np.array([math.sin(b), math.cos(b)])


PZN = ub(102.96)   # planner -z -> grid bearing 102.96 (unit E, N)
PX = ub(192.96)    # planner +x
Z_OUT = -5.915     # planner z of the window wall's outer face
FLOOR_DSM = -0.30 + 3.79   # DSM height of the hall floor


def planner_to_local(x, z):
    return HALL0 + x * PX + (-z) * PZN


# ---- sampling
def bilinear(H, xs, ys):
    r = (ys + HALF) / RES - 0.5
    c = (xs + HALF) / RES - 0.5
    return map_coordinates(H, [r.ravel(), c.ravel()], order=1, mode="nearest").reshape(xs.shape)


D0 = 3.0
DMAX = 600.0
ds = [D0]
while ds[-1] < DMAX:
    ds.append(ds[-1] + 0.25 + 0.004 * ds[-1])
ds = np.array(ds)
AZ = np.arange(11.0, 191.5 + 1e-9, 0.5)   # true azimuth
FAC_O = np.array([10.0, 6.406])            # facade frame origin, local (E, N)
FAC_N = np.array([0.975, -0.224])          # facade outward normal (grid)
FAC_U = np.array([0.224, 0.975])           # along the frontage, towards grid north
FAC_U_RANGE = (-15.305, 15.304)            # the frontage's wall-face ends, facade u (m)
D_CUT = 1.25   # variant B: ignore samples inside the hall's facade/cornice zone (facade d < 1.25 m, u on the frontage)


def skyline(H, p0, z_eye, az_true=AZ, return_blocker=False, facade_mask=True):
    g = np.radians(az_true + GRID_MINUS_TRUE)
    dirs = np.stack([np.sin(g), np.cos(g)], 1)   # (na, 2)
    xs = p0[0] + dirs[:, 0:1] * ds[None, :]
    ys = p0[1] + dirs[:, 1:2] * ds[None, :]
    h = bilinear(H, xs, ys)
    if facade_mask:
        dfac = (xs - FAC_O[0]) * FAC_N[0] + (ys - FAC_O[1]) * FAC_N[1]
        ufac = (xs - FAC_O[0]) * FAC_U[0] + (ys - FAC_O[1]) * FAC_U[1]
        own = (dfac < D_CUT) & (ufac >= FAC_U_RANGE[0]) & (ufac <= FAC_U_RANGE[1])
        h = np.where(own, -1e4, h)
    el = np.degrees(np.arctan2(h - z_eye - ds[None, :] ** 2 / (2 * EARTH_R), ds[None, :]))
    k = el.argmax(1)
    e = el[np.arange(len(az_true)), k]
    if facade_mask:
        e = np.where(own.all(1), np.nan, e)   # ray never leaves the hall's own facade zone
    if return_blocker:
        return e, ds[k], h[np.arange(len(az_true)), k]
    return e


def main():
    ap = argparse.ArgumentParser(description="Grid orientation check and per-window centre skylines (diagnostic).")
    ap.add_argument("dsm_dir", type=Path, help="directory holding heights_50cm.f32 and meta.json (fetch_dsm.py)")
    ap.add_argument("--hall-spec", type=Path, default=HALL_SPEC, help="hall-spec.ts (default: the repo's own)")
    ap.add_argument("--raw", type=Path, help="also write the 3x3 sample profiles to this JSON file")
    args = ap.parse_args()
    H = load_dsm(args.dsm_dir)
    openings = read_openings(args.hall_spec)
    for o in openings:
        print(o)
    print("steps", len(ds), "last", ds[-1])

    def cell(x, y):
        return int(round((y + HALF) / RES - 0.5)), int(round((x + HALF) / RES - 0.5))

    r, c = cell(3.0, 8.0)

    def mx(rr, cc):
        return float(H[rr - 2:rr + 3, cc - 2:cc + 3].max())

    print("orientation (crown 24.187 expected within +-1 m of local (3,8)):")
    print(" as documented (row0=S,col0=W): max", mx(r, c))
    print(" flip N:", mx(G - 1 - r, c), " flip E:", mx(r, G - 1 - c), " both:", mx(G - 1 - r, G - 1 - c))
    out = dict(windows=[], combined={})
    prof_centre = {}
    for o in openings:
        h = o["top"] - o["sill"]
        ys = [o["sill"] + f * h for f in (0.2, 0.5, 0.8)]
        xs = [o["centreX"] + f * o["width"] for f in (-0.3, 0.0, 0.3)]     # 20/50/80 % of width
        samp = []
        for yy in ys:
            row = []
            for xx in xs:
                p0 = planner_to_local(xx, Z_OUT)
                ze = FLOOR_DSM + yy
                row.append(np.round(skyline(H, p0, ze), 2).tolist())
            samp.append(row)
        # centre point with blocker info
        p0 = planner_to_local(o["centreX"], Z_OUT)
        ze = FLOOR_DSM + ys[1]
        e, bd, bh = skyline(H, p0, ze, return_blocker=True)
        prof_centre[o["id"]] = e
        out["windows"].append(dict(id=o["id"], kind=o["kind"], centreX=round(o["centreX"], 4), width=o["width"],
                                   sillAboveFloor=o["sill"], topAboveFloor=round(o["top"], 3),
                                   localOriginENm=[round(float(v), 3) for v in p0], eyeHeightDsmM=round(ze, 3),
                                   sampleHeightsAboveFloorM=[round(v, 3) for v in ys], samplePlannerX=[round(v, 3) for v in xs],
                                   samples=samp, centreBlockerDistanceM=np.round(bd, 1).tolist(),
                                   centreBlockerHeightDsmM=np.round(bh, 1).tolist()))
    out["combined"] = {o["id"]: np.round(prof_centre[o["id"]], 1).tolist() for o in openings}
    out["azimuthsTrueDeg"] = AZ.tolist()
    if args.raw:
        # NaN (rays that never leave the cornice zone) is written as JSON NaN.
        args.raw.write_text(json.dumps(dict(out=out)), encoding="utf-8")
    for o in openings:
        e = np.array(out["combined"][o["id"]])
        print(o["id"], "min %.1f at az %.1f; max %.1f at az %.1f" % (np.nanmin(e), AZ[np.nanargmin(e)], np.nanmax(e), AZ[np.nanargmax(e)]))
        for a in (11, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100, 105, 110, 120, 130, 140, 150, 160, 170, 180, 190):
            print("  az%3d %.1f" % (a, e[int(round((a - 11) / 0.5))]), end="")
        print()


if __name__ == "__main__":
    main()
