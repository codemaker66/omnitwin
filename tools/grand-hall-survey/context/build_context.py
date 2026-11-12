"""Architect's contour model of the city around Trades Hall, from the Scottish LiDAR Phase 5 DSM only.

Pipeline (all in this file, no OSM):
  1. crop the 50 cm DSM around the hall centre, 3x3 median (drops single-cell LiDAR spikes, poles, chimneys)
  2. planner height y = DSM + 0.30 - 3.79; inside the clamp radius y = min(y, 0) (section at the hall floor)
  3. quantise to terrace bands (levels anchored at the hall floor, every SPACING m; band 0 = ground disc)
  4. connected area filter on the band image (max-tree opening = drop small blobs, min-tree = fill small
     holes) with an area threshold that grows with the component's distance from the centre
  5. stamp OUT (beyond the radius) and CUT (the hall rectangle), remove diagonal pixel pinches
  6. raster -> planar topology: boundary chains between 4-connected regions, split at junction nodes
  7. Douglas-Peucker per chain with fixed end nodes (shared chains are simplified once, so stacked walls
     stay coincident); rim chains snap to the exact circle, cut chains to the exact rectangle
  8. faces -> cap polygons (validity loop halves a chain's tolerance until every face is valid),
     constrained Delaunay caps, ladder-triangulated walls split at every level a neighbour uses (no T-junctions)
  9. write VVCX v1 binary + provenance JSON
"""
# The docstring above is copied into the published JSON as "method"; keep it in step with the code.
#
# Usage: python3 build_context.py <dsm-dir> <out-dir> [--name merchant-city-v2] [--date YYYY-MM-DD] [--keep-work]
#                                 [--front-cut]
#   <dsm-dir>  heights_50cm.f32 and meta.json from fetch_dsm.py
#   <out-dir>  receives <name>.bin and <name>.json (the published pair), <name>.build.json (the build's
#              own report: the suppressed trees, repair counts and input hashes) and, with --keep-work,
#              _work.npz (the rasters check_render.py reads)
#   --date     the JSON's "generated" date; defaults to SOURCE_DATE_EPOCH, else today
#   --front-cut  v3 (merchant-city-v3): the city registered on the dome's drum ring, Trades Hall's street front
#              emptied for the planner's modelled front, and the neighbours' fronts beside it straightened
#              (FRONT_CUT_METHOD below). Without it the build is v2's, byte for byte.
# Requires numpy, scipy, scikit-image and shapely 2.

# Appended to "method" in a --front-cut build's JSON (v2's method is the docstring alone).
FRONT_CUT_METHOD = """\
v3 (--front-cut), on top of the above, in v2's frame and registration:
  5b. FRONT: x and z inside the modelled front's footprint plus 2.7 cm (front_cut_x, front_cut_z), less the hall's
      cut, is ground (band 0, y = ground_y); its chains snap to the exact rectangle as the cut's do, and where it
      meets the cut, to the two rectangles' crossing points
  5c. on the street front beside it (street_front_x, street_front_z, inside the clamp), band-1 components of at
      most street_front_sliver_m2 lying between the street and a band-2 block join the block: they are the
      wall's foot sharing its 0.5 m cells with the pavement, not a step
  7b. each run of chains between the street and the blocks beside the front is fitted, on its raster boundary
      sampled along its length, with the fewest straight segments (each at least street_front_min_m long and within
      street_front_max_angle_deg of the street) whose line stays within street_front_tol_m of the boundary averaged
      over street_front_window_m; segments meet at their lines' crossing within street_front_junction_m, else by a
      square jog (lines nearer than street_front_min_jog_m share one vertex); a run ending on FRONT ends where its
      line crosses the rectangle, one ending on another chain moves that node onto its line (pinning the segment
      through it instead if it would move more than street_front_end_move_m); the run's own nodes move onto the
      segments and its chains become them, so shared chains stay coincident and the validity loop runs as before on
      everything else"""
import argparse
import datetime
import gzip
import hashlib
import json
import math
import os
import struct
import time
import zlib
from pathlib import Path

import numpy as np
import scipy
import shapely
import skimage
from scipy import ndimage as ndi
from shapely.geometry import Polygon
from skimage.morphology import max_tree


def parse_args():
    ap = argparse.ArgumentParser(description="Architect's contour model of the city around Trades Hall (VVCX v1).")
    ap.add_argument("dsm_dir", type=Path, help="directory holding heights_50cm.f32 and meta.json (fetch_dsm.py)")
    ap.add_argument("out_dir", type=Path, help="directory the model, its JSON and the build report are written to")
    ap.add_argument("--name", help="file stem of the outputs (default merchant-city-v2; merchant-city-v3 with --front-cut)")
    ap.add_argument("--date", help="the JSON's 'generated' date, YYYY-MM-DD (default: SOURCE_DATE_EPOCH, else today)")
    ap.add_argument("--keep-work", action="store_true", help="also write _work.npz for check_render.py")
    ap.add_argument("--front-cut", action="store_true",
                    help="v3: register on the dome's drum ring, empty Trades Hall's street front, straighten its neighbours'")
    a = ap.parse_args()
    if a.name is None:
        a.name = "merchant-city-v3" if a.front_cut else "merchant-city-v2"
    if a.date is None:
        epoch = os.environ.get("SOURCE_DATE_EPOCH")
        day = (datetime.datetime.fromtimestamp(int(epoch), datetime.timezone.utc).date() if epoch
               else datetime.date.today())
        a.date = day.isoformat()
    else:
        a.date = datetime.date.fromisoformat(a.date).isoformat()
    return a


ARGS = parse_args()
OUT = ARGS.out_dir
SRC = ARGS.dsm_dir
OUT.mkdir(parents=True, exist_ok=True)

P = dict(
    radius=260.0, spacing=3.0, level_anchor_y=0.0, ground_y=-3.79,
    dsm_to_y=0.30 - 3.79, median_px=3,
    clamp_radius=45.0, clamp_inner_radius=26.0, clamp_front_z=-24.0, clamp_y=0.0, rect_half_x=11.2, rect_half_z=5.95, rect_front_z=-6.24,
    tol_near=0.5, tol_far=2.0, area_near=6.0, area_far=40.0, near_r=80.0, far_r=260.0,
    rim_step_deg=1.5, terrain_cut_y=-1.0, terrain_sigma=3.0,
    tree_max_area=1000.0, tree_min_residual=0.2, tree_max_height=22.0, frame_bearing_deg=102.96, centre_local=[3.0, 8.0],
)
V2_CENTRE_LOCAL = list(P["centre_local"])

# v3's registration (--front-cut): the planner's origin (the hall floor's centre) in NGR-local metres, the one
# number a later correction changes (a centre between cell corners is handled: OFF_E, OFF_N). It stays v2's
# (E 3.0, N 8.0). The hall's own E57 scan, which is the planner's frame, ranges out through the front door and the
# windows to the walls across Glassford Street, Garth Street and Hutcheson Street; matched to the DSM's edges of
# those walls it puts the origin at (E 3.018, N 7.981), sigma 0.06 / 0.12 m: the city is in register with the room
# to about 2 cm, bearing within 0.16 deg (D:/claude/th-facade-20261028/registration/registration.json,
# city_model_vs_room). The 0.96 m between the 2010 plan's front face (planner z -6.218) and the DSM's Trades Hall
# front is the DSM's own: that front faces away from the aircraft and its LiDAR shadow is filled 1.0-1.2 m out from
# the scanned faces. The DSM's dome-drum ring (E 3.435, N 7.891; facade.json dome.centre_local) stands 0.44 m
# streetward of the hall's interior dome, so it is not a registration target either.
FRONT_CUT_CENTRE_LOCAL = [3.0, 8.0]
# The modelled front's footprint (packages/web/src/components/grand-hall/hall-exterior-spec.ts): x = FRONT_AXIS_X
# -0.025 -+ FRONT_HALF_WIDTH 15.298, i.e. -15.323 .. +15.273, from the room's plane (z -5.295) out to the pediment's
# cornice (about z -7.54). The front cut is that plus 2.7 cm at each end and 5 mm behind its back, out into the
# street to z -12; in front of the hall the cut (rect_*) stays as it is.
FRONT_CUT_PARAMS = dict(
    front_cut_x=[-15.35, 15.3], front_cut_z=[-12.0, -5.29],
    street_front_x=[15.3, 45.0], street_front_z=[-12.0, -3.0], street_front_sliver_m2=3.0,
    street_front_tol_m=0.25, street_front_window_m=3.0, street_front_min_m=2.0, street_front_junction_m=1.0,
    street_front_max_angle_deg=5.0, street_front_end_move_m=0.35, street_front_min_jog_m=0.04,
)
FRONT_CUT = ARGS.front_cut
if FRONT_CUT:
    P = dict(P, centre_local=FRONT_CUT_CENTRE_LOCAL, **FRONT_CUT_PARAMS)
RES = 0.5
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


# ---------------------------------------------------------------- frame
B = math.radians(P["frame_bearing_deg"])
FWD = np.array([math.sin(B), math.cos(B)])                  # planner -z in (E, N)
XH = np.array([math.sin(B + math.pi / 2), math.cos(B + math.pi / 2)])   # planner +x
ZH = -FWD                                                     # planner +z


def to_planner(de, dn):
    return de * XH[0] + dn * XH[1], de * ZH[0] + dn * ZH[1]


def lerp_r(r, a, b):
    t = np.clip((np.asarray(r) - P["near_r"]) / (P["far_r"] - P["near_r"]), 0.0, 1.0)
    return a + (b - a) * t


# ---------------------------------------------------------------- 1-2 raster
meta = json.loads((SRC / "meta.json").read_text(encoding="utf-8"))
assert meta["res"] == RES and (meta["originE"], meta["originN"]) == (259329.0, 665183.0), "not the fetch_dsm.py grid"
G = meta["grid"]
HALF = meta["sizeM"] / 2
raw = np.fromfile(SRC / "heights_50cm.f32", dtype="<f4").reshape(G, G)   # row 0 = south, col 0 = west
ce, cn = P["centre_local"]
jc, ic = int(round((ce + HALF) / RES)), int(round((cn + HALF) / RES))   # corner indices of the centre
# The crop stays on the DSM's own cells: a centre between cell corners (v3's registration) moves the frame by the
# remainder, the corner's offset from the centre (exactly 0, 0 for v2's crown cell).
OFF_E, OFF_N = jc * RES - HALF - ce, ic * RES - HALF - cn
K = int(math.ceil((P["radius"] + 4) / RES))
m = 2
sub = raw[ic - K - m:ic + K + m, jc - K - m:jc + K + m].astype(np.float64)
med = ndi.median_filter(sub, size=P["median_px"])[m:-m, m:-m]
NR, NC = med.shape
ii, jj = np.mgrid[0:NR, 0:NC]
DE = (jj - K + 0.5) * RES + OFF_E
DN = (ii - K + 0.5) * RES + OFF_N
PX, PZ = to_planner(DE, DN)
RR = np.hypot(DE, DN)
y_raw = med + P["dsm_to_y"]

# ---- terrain smoothing + isolated tree suppression (LiDAR only: DSM planarity, no classification layer)
rawc = sub[m:-m, m:-m]
planar_res = np.abs(rawc - ndi.uniform_filter(rawc, 3))          # residual from the local 1.5 m plane (3x3 LSQ)
raised = ndi.binary_opening(y_raw > P["terrain_cut_y"], iterations=1)
rlab, rn = ndi.label(raised)
ridx = np.arange(1, rn + 1)
r_area = ndi.sum(np.ones_like(y_raw), rlab, ridx) * RES * RES
r_inner = ndi.binary_erosion(raised, iterations=3)
r_res = np.array(ndi.labeled_comprehension(planar_res, rlab * r_inner, ridx, np.median, float, 0.0))
r_max = ndi.maximum(y_raw, rlab, ridx) - P["ground_y"]
is_tree = (r_area < P["tree_max_area"]) & (r_res > P["tree_min_residual"]) & (r_max < P["tree_max_height"])
tree_mask = np.isin(rlab, ridx[is_tree])
ground = ~raised
wsum = lambda a, s_: ndi.gaussian_filter(a, s_ / RES)
w1 = wsum(ground.astype(float), P["terrain_sigma"])
t1 = wsum(np.where(ground, y_raw, 0.0), P["terrain_sigma"]) / np.maximum(w1, 1e-9)
w2 = wsum(ground.astype(float), 4 * P["terrain_sigma"])
t2 = wsum(np.where(ground, y_raw, 0.0), 4 * P["terrain_sigma"]) / np.maximum(w2, 1e-9)
terrain = np.where(w1 > 0.2, t1, t2)
y_s = y_raw.copy()
y_s[ground] = terrain[ground]
y_s[tree_mask] = t2[tree_mask]
tc_x = ndi.mean(PX, rlab, ridx)[is_tree]
tc_z = ndi.mean(PZ, rlab, ridx)[is_tree]
TREES = [dict(centre_xz=[round(float(cx_), 1), round(float(cz_), 1)], area_m2=round(float(a), 1), max_above_pavement=round(float(h), 1), median_plane_residual_m=round(float(rr), 3))
         for cx_, cz_, a, h, rr in zip(tc_x, tc_z, r_area[is_tree], r_max[is_tree], r_res[is_tree])]
y = y_s.copy()
# The hall's own block is sectioned at its floor: everything within the inner
# radius, and within the outer radius except the blocks across Glassford
# Street (planner z below clamp_front_z), which stay whole as the backdrop.
clampzone = (RR < P["clamp_inner_radius"]) | ((RR < P["clamp_radius"]) & (PZ > P["clamp_front_z"]))
y[clampzone] = np.minimum(y[clampzone], P["clamp_y"])
log("crop", med.shape)

# ---------------------------------------------------------------- 3 bands
S = P["spacing"]
k_first = math.floor((P["ground_y"] - P["level_anchor_y"]) / S) + 1
L_FIRST = P["level_anchor_y"] + k_first * S


def band_level(b):
    return P["ground_y"] if b <= 0 else L_FIRST + (b - 1) * S


band = np.where(y < L_FIRST, 0, 1 + np.floor((y - L_FIRST) / S)).astype(np.int32)
band_unfiltered = band.copy()
log("bands max", band.max(), "first level", L_FIRST)


# ---------------------------------------------------------------- 4 area filter (max-tree, variable threshold)
def mt_filter(img):
    parent, trav = max_tree(img, connectivity=1)
    par = parent.ravel().tolist()
    f = img.ravel().tolist()
    n = len(f)
    area = [1] * n
    sx = DE.ravel().tolist()
    sy = DN.ravel().tolist()
    tr = trav.tolist()
    for p in reversed(tr):
        q = par[p]
        if q != p:
            area[q] += area[p]
            sx[q] += sx[p]
            sy[q] += sy[p]
    an, af, nr, fr = P["area_near"], P["area_far"], P["near_r"], P["far_r"]
    out = [0] * n
    keep = [True] * n
    removed = 0
    for p in tr:
        q = par[p]
        if q == p:
            out[p] = f[p]
            continue
        if f[q] != f[p]:
            a = area[p]
            r = math.hypot(sx[p] / a, sy[p] / a)
            t = min(max((r - nr) / (fr - nr), 0.0), 1.0)
            ok = keep[q] and a * RES * RES >= an + (af - an) * t
            keep[p] = ok
            if not ok and keep[q]:
                removed += 1
            out[p] = f[p] if ok else out[q]
        else:
            out[p] = out[q]
    return np.array(out, dtype=np.int32).reshape(img.shape), removed


band, n_open = mt_filter(band)
nb, n_close = mt_filter(-band)
band = -nb
log(f"area filter: removed {n_open} small raised features, filled {n_close} small holes/pits")

# ---------------------------------------------------------------- 5 OUT / CUT, pinch removal
OUTL, CUTL = -1, -2
lab = band.copy()
lab[RR > P["radius"]] = OUTL
# The cut-out for the hall: |x| <= rect_half_x, from the street face (rect_front_z, the window wall's outer face at
# -6.245, its 0.95 m thickness; a centimetre grid puts the cut 5 mm under the wall's foot, never a crack in front of
# it) to rect_half_z behind.
incut = (np.abs(PX) <= P["rect_half_x"]) & (PZ >= P["rect_front_z"]) & (PZ <= P["rect_half_z"])
lab[incut] = CUTL
FRONTL = -3
SLIVERS = []
if FRONT_CUT:
    # v3: Trades Hall's street front is the planner's own model; the city keeps only bare ground there (band 0),
    # as a region of its own so its edges can snap to the exact rectangle.
    fx0, fx1 = P["front_cut_x"]
    fz0, fz1 = P["front_cut_z"]
    infront = (PX >= fx0) & (PX <= fx1) & (PZ >= fz0) & (PZ <= fz1) & ~incut
    lab[infront] = FRONTL
    band[infront] = 0
    # The neighbours' street fronts: a band-1 sliver between the pavement and a band-2 block is the wall's foot
    # sharing its 0.5 m cells with the pavement (the DSM there is part wall, part street), not a step; it joins
    # the block, so the front is one wall to straighten.
    ax_ = np.abs(PX)
    rr_ = np.hypot(PX, PZ)
    in_clamp = (rr_ < P["clamp_inner_radius"]) | ((rr_ < P["clamp_radius"]) & (PZ > P["clamp_front_z"]))
    sbox = ((ax_ >= P["street_front_x"][0]) & (ax_ <= P["street_front_x"][1]) & (PZ >= P["street_front_z"][0])
            & (PZ <= P["street_front_z"][1]) & in_clamp)
    four = ndi.generate_binary_structure(2, 1)
    slab, sn = ndi.label((lab == 1) & sbox, structure=four)
    for k_, sl_ in enumerate(ndi.find_objects(slab), start=1):
        grow = (slice(max(sl_[0].start - 1, 0), sl_[0].stop + 1), slice(max(sl_[1].start - 1, 0), sl_[1].stop + 1))
        mk = slab[grow] == k_
        ring = ndi.binary_dilation(mk, structure=four) & ~mk
        around = lab[grow][ring]
        area = float(mk.sum()) * RES * RES
        if area <= P["street_front_sliver_m2"] and (around == 0).any() and (around == 2).any() and not (around < 0).any():
            lab[grow][mk] = 2
            band[grow][mk] = 2
            SLIVERS.append(dict(centre_xz=[round(float(PX[grow][mk].mean()), 2), round(float(PZ[grow][mk].mean()), 2)],
                                area_m2=area))
    log("front cut", int(infront.sum()), "cells; street-front slivers joined to their blocks", len(SLIVERS))
for it in range(100):
    a, b_, c, d = lab[:-1, :-1], lab[:-1, 1:], lab[1:, :-1], lab[1:, 1:]
    m1 = (a == d) & (b_ != a) & (c != a)
    if m1.any():
        i1, j1 = np.nonzero(m1)
        lab[i1, j1 + 1] = lab[i1, j1]
        continue
    a, b_, c, d = lab[:-1, :-1], lab[:-1, 1:], lab[1:, :-1], lab[1:, 1:]
    m2 = (b_ == c) & (a != b_) & (d != b_)
    if m2.any():
        i2, j2 = np.nonzero(m2)
        lab[i2, j2] = lab[i2, j2 + 1]
        continue
    break
log("pinch removal iterations", it)

C = np.full(lab.shape, -1, dtype=np.int64)
comp_label = []
nid = 0
for lv in np.unique(lab):
    cc, n = ndi.label(lab == lv)
    msk = cc > 0
    C[msk] = cc[msk] - 1 + nid
    comp_label += [int(lv)] * n
    nid += n
comp_label = np.array(comp_label)
comp_area_px = np.bincount(C.ravel(), minlength=nid)
log("components", nid)

# ---------------------------------------------------------------- 6 topology
HB = np.zeros((NR + 1, NC), bool)
HB[1:NR, :] = C[:-1, :] != C[1:, :]
VB = np.zeros((NR, NC + 1), bool)
VB[:, 1:NC] = C[:, :-1] != C[:, 1:]
deg = np.zeros((NR + 1, NC + 1), np.int8)
deg[:, :-1] += HB
deg[:, 1:] += HB
deg[:-1, :] += VB
deg[1:, :] += VB
log("boundary edges", int(HB.sum() + VB.sum()), "nodes", int((deg >= 3).sum()))

HBl = HB.tolist()
VBl = VB.tolist()
Cl = C.tolist()
degl = deg.tolist()
vis_h = set()
vis_v = set()


def step_options(i, j):
    o = []
    if j < NC and HBl[i][j]:
        o.append(("h", i, j, i, j + 1))
    if j > 0 and HBl[i][j - 1]:
        o.append(("h", i, j - 1, i, j - 1))
    if i < NR and VBl[i][j]:
        o.append(("v", i, j, i + 1, j))
    if i > 0 and VBl[i - 1][j]:
        o.append(("v", i - 1, j, i - 1, j))
    return o


def sides(i, j, i2, j2):
    """left, right component when moving from corner (i,j) to (i2,j2)."""
    if i2 == i and j2 == j + 1:
        return Cl[i][j], Cl[i - 1][j]
    if i2 == i and j2 == j - 1:
        return Cl[i - 1][j - 1], Cl[i][j - 1]
    if i2 == i + 1:
        return Cl[i][j - 1], Cl[i][j]
    return Cl[i - 1][j], Cl[i - 1][j - 1]


chains = []   # dict(s=(i,j), e=(i,j), pts=[(i,j)...], l, r)


def walk(i0, j0, opt):
    kind, ei, ej, i1, j1 = opt
    (vis_h if kind == "h" else vis_v).add((ei, ej))
    l, r = sides(i0, j0, i1, j1)
    pts = [(i0, j0), (i1, j1)]
    ci, cj = i1, j1
    while degl[ci][cj] == 2 and (ci, cj) != (i0, j0):
        nxt = None
        for o in step_options(ci, cj):
            s = vis_h if o[0] == "h" else vis_v
            if (o[1], o[2]) not in s:
                nxt = o
                break
        if nxt is None:
            break
        (vis_h if nxt[0] == "h" else vis_v).add((nxt[1], nxt[2]))
        ci, cj = nxt[3], nxt[4]
        pts.append((ci, cj))
    chains.append(dict(s=(i0, j0), e=(ci, cj), pts=pts, l=l, r=r))


node_corners = list(zip(*np.nonzero(deg >= 3)))
for (i0, j0) in node_corners:
    i0, j0 = int(i0), int(j0)
    for o in step_options(i0, j0):
        s = vis_h if o[0] == "h" else vis_v
        if (o[1], o[2]) not in s:
            walk(i0, j0, o)
# closed loops with no node
for kind, arr in (("h", HB), ("v", VB)):
    for (ei, ej) in zip(*np.nonzero(arr)):
        ei, ej = int(ei), int(ej)
        s = vis_h if kind == "h" else vis_v
        if (ei, ej) in s:
            continue
        o = ("h", ei, ej, ei, ej + 1) if kind == "h" else ("v", ei, ej, ei + 1, ej)
        walk(ei, ej, o)
log("chains", len(chains))

# node table (real nodes + pseudo nodes of closed loops)
node_id = {}
for ch in chains:
    for key in (ch["s"], ch["e"]):
        if key not in node_id:
            node_id[key] = len(node_id)
    ch["sn"], ch["en"] = node_id[ch["s"]], node_id[ch["e"]]
NN = len(node_id)
node_xz = np.zeros((NN, 2))
for (ci_, cj_), k in node_id.items():
    node_xz[k] = to_planner((cj_ - K) * RES + OFF_E, (ci_ - K) * RES + OFF_N)


def corner_xz(pts):
    a = np.array(pts, dtype=np.float64)
    x, z = to_planner((a[:, 1] - K) * RES + OFF_E, (a[:, 0] - K) * RES + OFF_N)
    return np.stack([x, z], 1)


OUTC = set(np.nonzero(comp_label == OUTL)[0].tolist())
CUTC = set(np.nonzero(comp_label == CUTL)[0].tolist())
FRONTC = set(np.nonzero(comp_label == FRONTL)[0].tolist())
for ch in chains:
    ch["rim"] = ch["l"] in OUTC or ch["r"] in OUTC
    ch["cut"] = ch["l"] in CUTC or ch["r"] in CUTC
    ch["front"] = ch["l"] in FRONTC or ch["r"] in FRONTC
    pts = ch["pts"]
    # drop collinear staircase points (axis-aligned runs)
    if len(pts) > 2:
        a = np.array(pts)
        d = np.diff(a, axis=0)
        turn = np.any(d[1:] != d[:-1], axis=1)
        keep = np.concatenate([[True], turn, [True]])
        a = a[keep]
        ch["raw"] = corner_xz(a.tolist())
    else:
        ch["raw"] = corner_xz(pts)

# ---------------------------------------------------------------- 7 snapping
R0 = P["radius"]
HX, HZ, FZ = P["rect_half_x"], P["rect_half_z"], P["rect_front_z"]


def rectangle(x0, x1, z0, z1):
    """corners counter-clockwise from (x0, z0), edge lengths, cumulative perimeter, perimeter"""
    rc = np.array([[x0, z0], [x1, z0], [x1, z1], [x0, z1]])
    segl = np.array([x1 - x0, z1 - z0, x1 - x0, z1 - z0])
    scum = np.concatenate([[0], np.cumsum(segl)])
    return rc, segl, scum, scum[-1]


CUT_RECT = rectangle(-HX, HX, FZ, HZ)
RC, SEGL, SCUM, PER = CUT_RECT
FRONT_RECT = rectangle(*P["front_cut_x"], *P["front_cut_z"]) if FRONT_CUT else None


def rect_s(p, R=CUT_RECT):
    rc, segl, scum, _ = R
    best = None
    for k in range(4):
        a, b = rc[k], rc[(k + 1) % 4]
        t = np.clip(np.dot(p - a, b - a) / segl[k] ** 2, 0, 1)
        q = a + t * (b - a)
        dd = np.hypot(*(p - q))
        if best is None or dd < best[0]:
            best = (dd, scum[k] + t * segl[k])
    return best[1]


def rect_pt(s, R=CUT_RECT):
    rc, segl, scum, per = R
    s = s % per
    k = min(int(np.searchsorted(scum, s, side="right") - 1), 3)
    t = (s - scum[k]) / segl[k]
    return rc[k] + t * (rc[(k + 1) % 4] - rc[k])


def rect_crossings(A, B):
    """the points where two axis-aligned rectangles' perimeters cross"""
    out = []
    for k in range(4):
        a0, a1 = A[0][k], A[0][(k + 1) % 4]
        for m_ in range(4):
            b0, b1 = B[0][m_], B[0][(m_ + 1) % 4]
            for (p0, p1), (q0, q1) in (((a0, a1), (b0, b1)), ((b0, b1), (a0, a1))):
                if p0[1] == p1[1] and q0[0] == q1[0]:          # p horizontal (z constant), q vertical (x constant)
                    x, z = q0[0], p0[1]
                    if min(p0[0], p1[0]) <= x <= max(p0[0], p1[0]) and min(q0[1], q1[1]) <= z <= max(q0[1], q1[1]):
                        out.append((float(x), float(z)))
    return np.array(sorted(set(out)))


rim_nodes, cut_nodes, front_nodes = set(), set(), set()
for ch in chains:
    if ch["rim"]:
        rim_nodes.update([ch["sn"], ch["en"]])
    if ch["cut"]:
        cut_nodes.update([ch["sn"], ch["en"]])
    elif ch["front"]:
        front_nodes.update([ch["sn"], ch["en"]])
assert not (rim_nodes & cut_nodes)
assert not (rim_nodes & front_nodes)
for k in rim_nodes:
    node_xz[k] *= R0 / np.hypot(*node_xz[k])
for k in cut_nodes - front_nodes:
    node_xz[k] = rect_pt(rect_s(node_xz[k]))
FRONT_JUNCTIONS = []
if FRONT_CUT:
    for k in front_nodes - cut_nodes:
        node_xz[k] = rect_pt(rect_s(node_xz[k], FRONT_RECT), FRONT_RECT)
    # where the front cut's edge meets the hall's cut: one of the two rectangles' crossing points
    crossings = rect_crossings(CUT_RECT, FRONT_RECT)
    for k in sorted(front_nodes & cut_nodes):
        dd = np.hypot(*(crossings - node_xz[k]).T)
        j = int(np.argmin(dd))
        assert dd[j] < 0.75, f"a node on both cuts lies {dd[j]:.2f} m from their crossings"
        FRONT_JUNCTIONS.append(dict(node=int(k), at=crossings[j].tolist(), moved_m=round(float(dd[j]), 3)))
        node_xz[k] = crossings[j]

# ---------------------------------------------------------------- 7b street fronts beside the front cut (v3)
def raster_cell(x, z):
    """the crop's cell (row, column) holding planner (x, z); the frame's matrix is orthonormal, so its inverse is
    its transpose"""
    de, dn = x * XH[0] + z * ZH[0], x * XH[1] + z * ZH[1]
    return int(math.floor((dn - OFF_N) / RES + K)), int(math.floor((de - OFF_E) / RES + K))


def along(poly, step=0.05):
    """points at most step m apart along a polyline, the length each stands for, and their arc positions"""
    pts, wts = [], []
    for a, b in zip(poly[:-1], poly[1:]):
        L = float(np.hypot(*(b - a)))
        if L < 1e-12:
            continue
        n = max(1, int(math.ceil(L / step)))
        t = (np.arange(n) + 0.5) / n
        pts.append(a + t[:, None] * (b - a))
        wts.append(np.full(n, L / n))
    Q, W = np.vstack(pts), np.concatenate(wts)
    return Q, W, np.cumsum(W) - W / 2


def line_fit(Q, W, p0=None, p1=None):
    """weighted total least squares line (point, unit direction with +x along it); p0 and p1 pin points on it"""
    if p0 is not None and p1 is not None:
        c, d = p0, (p1 - p0) / np.hypot(*(p1 - p0))
    else:
        c = p0 if p0 is not None else p1 if p1 is not None else (Q * W[:, None]).sum(0) / W.sum()
        D = Q - c
        d = np.linalg.eigh((D * W[:, None]).T @ D)[1][:, 1]
    return c, (-d if d[0] < 0 else d)


def averaged(S, r, W, window):
    """r averaged (weighted by length) over the window centred on each arc position"""
    cw = np.concatenate([[0.0], np.cumsum(W)])
    cr = np.concatenate([[0.0], np.cumsum(W * r)])
    lo = np.searchsorted(S, S - window / 2, side="left")
    hi = np.searchsorted(S, S + window / 2, side="right")
    return (cr[hi] - cr[lo]) / (cw[hi] - cw[lo])


def residuals(Q, c, d):
    return (Q - c) @ np.array([-d[1], d[0]])     # + = behind the line (+z, into the block)


def on_polyline(F, p):
    """the closest point of a polyline to p and its arc position"""
    best = None
    arc = 0.0
    for a, b in zip(F[:-1], F[1:]):
        ab = b - a
        L = float(np.hypot(*ab))
        t = 0.0 if L < 1e-12 else min(max(float((p - a) @ ab) / (L * L), 0.0), 1.0)
        q = a + t * ab
        dd = float(np.hypot(*(p - q)))
        if best is None or dd < best[0]:
            best = (dd, q, arc + t * L)
        arc += L
    return best[1], best[2]


def sub_polyline(F, u0, u1, eps=0.02):
    """F from arc position u0 to u1 (u0 < u1), with F's own vertices in between"""
    arcs = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(F, axis=0).T))])

    def at(u):
        k = min(int(np.searchsorted(arcs, u, side="right")) - 1, len(F) - 2)
        L = arcs[k + 1] - arcs[k]
        return F[k] + (F[k + 1] - F[k]) * ((u - arcs[k]) / L if L > 0 else 0.0)

    mid = [F[k] for k in range(len(F)) if u0 + eps < arcs[k] < u1 - eps]
    return np.vstack([at(u0), *mid, at(u1)]) if mid else np.vstack([at(u0), at(u1)])


def street_front_runs(street):
    """chains between the street and a band 1-2 block inside the box and the clamp, joined end to end at nodes"""
    x_lo, x_hi = P["street_front_x"]
    z_lo, z_hi = P["street_front_z"]
    cand = {}
    for ci, ch in enumerate(chains):
        if ch["rim"] or ch["cut"] or ch["front"] or ch["sn"] == ch["en"] or street not in (ch["l"], ch["r"]):
            continue
        other = ch["r"] if ch["l"] == street else ch["l"]
        if int(comp_label[other]) not in (1, 2):
            continue
        q = ch["raw"]
        rr = np.hypot(q[:, 0], q[:, 1])
        clamp = (rr < P["clamp_inner_radius"] + 1.0) | ((rr < P["clamp_radius"] + 1.0) & (q[:, 1] > P["clamp_front_z"]))
        ax = np.abs(q[:, 0])
        if ((ax >= x_lo - 1.0) & (ax <= x_hi) & (q[:, 1] >= z_lo) & (q[:, 1] <= z_hi) & clamp).all():
            cand[ci] = other
    at = {}
    for ci in cand:
        for nd in (chains[ci]["sn"], chains[ci]["en"]):
            at.setdefault(nd, []).append(ci)
    used, runs = set(), []
    for nd0 in sorted(nd for nd, cs in at.items() if len(cs) != 2):
        for ci0 in at[nd0]:
            if ci0 in used:
                continue
            nodes, links = [nd0], []
            nd, ci = nd0, ci0
            while True:
                used.add(ci)
                ch = chains[ci]
                forward = ch["sn"] == nd
                nxt = ch["en"] if forward else ch["sn"]
                links.append((ci, forward))
                nodes.append(nxt)
                if len(at[nxt]) != 2:
                    break
                ci = next(c for c in at[nxt] if c != ci)
                if ci in used:
                    break
                nd = nxt
            runs.append((nodes, links))
    return runs


def segment_run(Q, W, S, p0, p1):
    """the fewest straight segments (then the least squared residual) whose lines stay within the tolerance of the
    boundary averaged along it; p0 / p1 pin the first / last segment through a node. [(arc0, arc1, c, d)] or None"""
    tol, window, min_len = P["street_front_tol_m"], P["street_front_window_m"], P["street_front_min_m"]
    total = float(S[-1] + W[-1] / 2)
    arcs = np.concatenate([np.arange(0.0, total - 0.25, 0.5), [total]])
    idx = np.searchsorted(S, arcs)
    nb = len(arcs) - 1
    best = [None] * (nb + 1)
    best[0] = (0, 0.0, -1, None)
    for k in range(1, nb + 1):
        for j in range(k):
            if best[j] is None or (arcs[k] - arcs[j] < min_len and not (j == 0 and k == nb)):
                continue
            sl = slice(idx[j], idx[k])
            if sl.stop - sl.start < 2:
                continue
            c, d = line_fit(Q[sl], W[sl], p0 if j == 0 else None, p1 if k == nb else None)
            if abs(math.degrees(math.atan2(d[1], d[0]))) > P["street_front_max_angle_deg"]:
                continue   # a building front runs along the street; a slanted piece is the average's ramp over a step
            r = residuals(Q[sl], c, d)
            if np.abs(averaged(S[sl], r, W[sl], window)).max() > tol:
                continue
            cand = (best[j][0] + 1, best[j][1] + float((W[sl] * r * r).sum()), j, (c, d))
            if best[k] is None or cand[:2] < best[k][:2]:
                best[k] = cand
    if best[nb] is None:
        return None
    segs, k = [], nb
    while k > 0:
        _, _, j, (c, d) = best[k]
        segs.append((float(arcs[j]), float(arcs[k]), c, d))
        k = j
    return segs[::-1]


def regularise_street_fronts():
    street = C[raster_cell(0.0, -16.0)]
    assert comp_label[street] == 0, "the street before the hall is not ground"
    report = []
    for nodes, links in street_front_runs(street):
        geoms = []
        for ci, forward in links:
            g = chains[ci]["raw"]
            geoms.append(g if forward else g[::-1])
        poly = np.vstack([geoms[0]] + [g[1:] for g in geoms[1:]])
        chord = node_xz[nodes[-1]] - node_xz[nodes[0]]
        side = "north" if float(poly[:, 0].mean()) < 0 else "south"
        if abs(chord[1]) > math.tan(math.radians(25)) * abs(chord[0]) or float(np.hypot(*chord)) < P["street_front_min_m"]:
            log(f"street front: run of {len(links)} chains at x {poly[:, 0].min():.1f}..{poly[:, 0].max():.1f} not along the street, left")
            continue
        # the street must lie on its -z side and the block on its +z side
        Q, W, S = along(poly)
        c, d = line_fit(Q, W)
        n = np.array([-d[1], d[0]])
        probe = [Q[int(k)] for k in np.linspace(0, len(Q) - 1, 9)]
        fronts = sum(C[raster_cell(*(q - 0.75 * n))] == street and C[raster_cell(*(q + 0.75 * n))] != street for q in probe)
        if fronts < 6:
            log(f"street front: run at x {poly[:, 0].min():.1f}..{poly[:, 0].max():.1f} does not face the street, left")
            continue
        # a run ending on the front cut ends where its line crosses the rectangle; one ending on another chain keeps
        # that node, and its last segment passes through it
        edge = {}
        for end, nd in (("start", nodes[0]), ("end", nodes[-1])):
            if nd in front_nodes:
                edge[end] = P["front_cut_x"][0] if node_xz[nd][0] < 0 else P["front_cut_x"][1]
        if edge:
            xe = next(iter(edge.values()))
            keep = np.abs(Q[:, 0]) >= abs(xe)
            Q, W = Q[keep], W[keep]
            S = np.cumsum(W) - W / 2
        def cross_x(c, d, xe):
            return c + d * ((xe - c[0]) / d[0])

        def proj(q, c, d):
            return c + d * float((q - c) @ d)

        # A run ending on another chain (the clamp's edge, where the full-height blocks begin) moves that node onto
        # its line, as it moves its own nodes: a raster corner stands up to a staircase's half-step off the wall.
        # Only a node that would move more than street_front_end_move_m is kept, its segment pinned through it.
        p0 = p1 = None
        for _ in range(3):
            segs = segment_run(Q, W, S, p0, p1)
            if segs is None:
                break
            again = False
            for end, k_, nd in (("start", 0, nodes[0]), ("end", -1, nodes[-1])):
                if end in edge or (end == "start" and p0 is not None) or (end == "end" and p1 is not None):
                    continue
                c_, d_ = segs[k_][2], segs[k_][3]
                if float(np.hypot(*(proj(node_xz[nd], c_, d_) - node_xz[nd]))) > P["street_front_end_move_m"]:
                    if end == "start":
                        p0 = node_xz[nd].copy()
                    else:
                        p1 = node_xz[nd].copy()
                    again = True
            if not again:
                break
        if segs is None:
            log(f"street front: no segmentation within tolerance for the {side} run, left as drawn")
            continue

        def end_point(end, seg):
            if end in edge:
                return cross_x(seg[2], seg[3], edge[end])
            pin = p0 if end == "start" else p1
            return pin if pin is not None else proj(node_xz[nodes[0 if end == "start" else -1]], seg[2], seg[3])

        F = [end_point("start", segs[0])]
        seg_ends = [[F[0], None] for _ in segs]
        junctions = []
        for k, ((a0, a1, ca, da), (_, _, cb, db)) in enumerate(zip(segs[:-1], segs[1:])):
            qb = Q[min(int(np.searchsorted(S, a1)), len(Q) - 1)]
            pa, pb = proj(qb, ca, da), proj(qb, cb, db)
            cr = da[0] * db[1] - da[1] * db[0]
            X = None
            if abs(cr) > 1e-9:
                t = ((cb - ca)[0] * db[1] - (cb - ca)[1] * db[0]) / cr
                X = ca + t * da
            jog = float(np.hypot(*(pb - pa)))
            if X is not None and float(np.hypot(*(X - pa))) <= P["street_front_junction_m"]:
                F.append(X)
                seg_ends[k][1], seg_ends[k + 1][0] = X, X
                junctions.append("kink")
            elif jog < P["street_front_min_jog_m"]:
                X = (pa + pb) / 2      # lines a centimetre or two apart: one vertex between them, no step
                F.append(X)
                seg_ends[k][1], seg_ends[k + 1][0] = X, X
                junctions.append(f"meet ({jog:.3f} m apart)")
            else:
                F += [pa, pb]
                seg_ends[k][1], seg_ends[k + 1][0] = pa, pb
                junctions.append(f"jog {jog:.2f} m")
        F.append(end_point("end", segs[-1]))
        seg_ends[-1][1] = F[-1]
        F = np.array(F)
        # the run's nodes onto the segments, its chains become them
        before = {nd: node_xz[nd].copy() for nd in nodes}
        us = [0.0]
        for nd in nodes[1:-1]:
            q, u = on_polyline(F, node_xz[nd])
            us.append(u)
        us.append(float(np.hypot(*np.diff(F, axis=0).T).sum()))
        if any(b <= a for a, b in zip(us[:-1], us[1:])):
            log(f"street front: the {side} run's nodes do not fall in order on its segments, left as drawn")
            continue
        vert_arcs = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(F, axis=0).T))])
        for k, nd in enumerate(nodes):
            if 0 < k < len(nodes) - 1:
                near = np.abs(vert_arcs - us[k]) < 0.02
                if near.any():
                    us[k] = float(vert_arcs[np.argmax(near)])
            node_xz[nd] = sub_polyline(F, us[k], us[k], 0.0)[0] if 0 < k < len(nodes) - 1 else F[0 if k == 0 else -1]
        rid = len(report)
        for k, (ci, forward) in enumerate(links):
            g = sub_polyline(F, us[k], us[k + 1])
            g[0], g[-1] = node_xz[nodes[k]], node_xz[nodes[k + 1]]
            chains[ci]["geom"] = g if forward else g[::-1]
            chains[ci]["fixed"] = True
            chains[ci]["street_front"] = rid
        moved = [float(np.hypot(*(node_xz[nd] - before[nd]))) for nd in nodes]
        segments = []
        for k, (a0, a1, c, d) in enumerate(segs):
            sl = (S >= a0) & (S < a1)
            r = residuals(Q[sl], c, d)
            sm = averaged(S[sl], r, W[sl], P["street_front_window_m"])
            segments.append(dict(
                id=f"{side}-{k + 1}", c=c, d=d, arcs=(a0, a1), ends=seg_ends[k],
                raw=dict(samples_m=round(float(W[sl].sum()), 2), rms_m=round(float(np.sqrt((W[sl] * r * r).sum() / W[sl].sum())), 3),
                         max_m=round(float(np.abs(r).max()), 3), mean_m=round(float((W[sl] * r).sum() / W[sl].sum()), 3),
                         averaged_max_m=round(float(np.abs(sm).max()), 3)),
                pinned="start" if (k == 0 and p0 is not None) else "end" if (k == len(segs) - 1 and p1 is not None) else None))
        report.append(dict(side=side, nodes=nodes, links=links, F=F, segments=segments, junctions=junctions,
                           ends={e: "on the front cut" if e in edge else "node kept, segment through it" if pin is not None
                                 else "node moved onto the line" for e, pin in (("start", p0), ("end", p1))},
                           nodes_moved=dict(count=sum(1 for v in moved if v > 1e-9), max_m=round(max(moved), 3)),
                           before=before, raw=[chains[ci]["raw"] for ci, _ in links]))
        log(f"street front {side}: {len(links)} chains, {len(segs)} segments, {sum(len(chains[ci]['raw']) for ci, _ in links)} raw "
            f"corners, nodes moved up to {max(moved):.3f} m")
    return report


STREET_FRONTS = regularise_street_fronts() if FRONT_CUT else []

STEP = math.radians(P["rim_step_deg"])
for ch in chains:
    a, b = node_xz[ch["sn"]], node_xz[ch["en"]]
    raw_ = ch["raw"]
    if ch.get("street_front") is not None:
        continue   # v3: already the run's straight segments (7b)
    if ch["rim"]:
        ang = np.unwrap(np.arctan2(raw_[:, 1], raw_[:, 0]))
        dlt = ang[-1] - ang[0]
        ta = math.atan2(a[1], a[0])
        tb = math.atan2(b[1], b[0])
        d2 = tb - ta
        d2 += 2 * math.pi * round((dlt - d2) / (2 * math.pi))
        if ch["sn"] == ch["en"] and abs(d2) < 1e-9:
            d2 = 2 * math.pi * (1 if dlt > 0 else -1)
        lo, hi = sorted([ta, ta + d2])
        ks = np.arange(math.floor(lo / STEP) + 1, math.ceil(hi / STEP))
        th = ks * STEP
        th = th[(th > lo + 1e-6) & (th < hi - 1e-6)]
        if d2 < 0:
            th = th[::-1]
        mid = np.stack([R0 * np.cos(th), R0 * np.sin(th)], 1)
        ch["geom"] = np.vstack([a, mid, b])
        ch["fixed"] = True
    elif ch["cut"] or ch["front"]:
        R = CUT_RECT if ch["cut"] else FRONT_RECT
        per, scum = R[3], R[2]
        ss = np.array([rect_s(p, R) for p in raw_])
        ss = np.unwrap(ss, period=per)
        dlt = ss[-1] - ss[0]
        sa, sb = rect_s(a, R), rect_s(b, R)
        d2 = sb - sa
        d2 += per * round((dlt - d2) / per)
        if ch["sn"] == ch["en"] and abs(d2) < 1e-9:
            d2 = per * (1 if dlt > 0 else -1)
        lo, hi = sorted([sa, sa + d2])
        corners = [c for kk in range(-2, 3) for c in (scum[:4] + kk * per) if lo + 1e-6 < c < hi - 1e-6]
        corners = sorted(corners, reverse=d2 < 0)
        mid = np.array([rect_pt(c, R) for c in corners]).reshape(-1, 2)
        ch["geom"] = np.vstack([a, mid, b])
        ch["fixed"] = True
    else:
        ch["fixed"] = False
        ch["fac"] = 1.0


# ---------------------------------------------------------------- DP with fixed ends, variable tolerance
def seg_dist(pts, a, b):
    ab = b - a
    L2 = float(ab @ ab)
    if L2 < 1e-18:
        return np.hypot(*(pts - a).T)
    t = np.clip(((pts - a) @ ab) / L2, 0, 1)
    q = a + t[:, None] * ab
    return np.hypot(*(pts - q).T)


def dp_open(pts, tol, keep, a, b):
    stack = [(a, b)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        d = seg_dist(pts[i + 1:j], pts[i], pts[j])
        ratio = d / tol[i + 1:j]
        k = int(np.argmax(ratio))
        if ratio[k] > 1.0:
            kk = i + 1 + k
            keep[kk] = True
            stack += [(i, kk), (kk, j)]


def simplify(ch):
    a, b = node_xz[ch["sn"]], node_xz[ch["en"]]
    pts = ch["raw"].copy()
    pts[0], pts[-1] = a, b
    n = len(pts)
    fac = ch["fac"]
    if fac <= 0 or n <= 2:
        ch["geom"] = pts
        return
    tol = lerp_r(np.hypot(pts[:, 0], pts[:, 1]), P["tol_near"], P["tol_far"]) * fac
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    if ch["sn"] == ch["en"]:
        # closed loop: split at the farthest point, then force one more vertex per half
        dd = np.hypot(*(pts - pts[0]).T)
        mm = int(np.argmax(dd))
        keep[mm] = True
        for (i, j) in ((0, mm), (mm, n - 1)):
            if j > i + 1:
                d = seg_dist(pts[i + 1:j], pts[i], pts[j])
                keep[i + 1 + int(np.argmax(d))] = True
        idx = np.nonzero(keep)[0]
        for i, j in zip(idx[:-1], idx[1:]):
            dp_open(pts, tol, keep, int(i), int(j))
    else:
        if ch.get("parallel") and n > 2:
            # another chain joins the same two nodes: keep its farthest point so the lens face cannot collapse
            d = seg_dist(pts[1:-1], pts[0], pts[-1])
            keep[1 + int(np.argmax(d))] = True
            idx = np.nonzero(keep)[0]
            for i, j in zip(idx[:-1], idx[1:]):
                dp_open(pts, tol, keep, int(i), int(j))
        else:
            dp_open(pts, tol, keep, 0, n - 1)
    ch["geom"] = pts[keep]


pair_count = {}
for ch in chains:
    key = (min(ch["sn"], ch["en"]), max(ch["sn"], ch["en"]))
    pair_count[key] = pair_count.get(key, 0) + 1
for ch in chains:
    ch["parallel"] = pair_count[(min(ch["sn"], ch["en"]), max(ch["sn"], ch["en"]))] > 1
for ch in chains:
    if not ch["fixed"]:
        simplify(ch)
log("simplified")

# ---------------------------------------------------------------- 8 faces
face_chains = {}
for ci, ch in enumerate(chains):
    for side in ("l", "r"):
        f = ch[side]
        if f in OUTC or f in CUTC:
            continue
        face_chains.setdefault(f, []).append((ci, side))


def ring_area(r):
    x, z = r[:, 0], r[:, 1]
    return 0.5 * float(np.dot(x, np.roll(z, -1)) - np.dot(z, np.roll(x, -1)))


def build_face(f):
    out_by_start = {}
    halfs = []
    for ci, side in face_chains[f]:
        ch = chains[ci]
        if side == "l":
            h = (ch["sn"], ch["en"], ch["geom"])
        else:
            h = (ch["en"], ch["sn"], ch["geom"][::-1])
        halfs.append(h)
        out_by_start.setdefault(h[0], []).append(len(halfs) - 1)
    used = [False] * len(halfs)
    rings = []
    for h0 in range(len(halfs)):
        if used[h0]:
            continue
        coords = []
        h = h0
        start = halfs[h0][0]
        while True:
            used[h] = True
            s, e, g = halfs[h]
            coords.append(g[:-1])
            if e == start:
                break
            cand = [k for k in out_by_start.get(e, []) if not used[k]]
            if not cand:
                return None, "open ring"
            h = cand[0]
        rings.append(np.vstack(coords))
    areas = [abs(ring_area(r)) for r in rings]
    si = int(np.argmax(areas))
    shell = rings[si]
    holes = [r for k, r in enumerate(rings) if k != si]
    if len(shell) < 3 or any(len(h) < 3 for h in holes):
        return None, "degenerate"
    poly = Polygon(shell, holes)
    if not poly.is_valid:
        return None, "invalid"
    a_raw = comp_area_px[f] * RES * RES
    if abs(poly.area - a_raw) > max(0.4 * a_raw, 1.5):
        return None, f"area {poly.area:.1f} vs raster {a_raw:.1f}"
    return poly, "ok"


faces = {}
bad = {}
for f in face_chains:
    poly, why = build_face(f)
    if poly is None:
        bad[f] = why
    else:
        faces[f] = poly
log("faces", len(faces), "invalid on first pass", len(bad))
rounds = 0
while bad and rounds < 12:
    rounds += 1
    touched = set()
    for f in bad:
        for ci, _ in face_chains[f]:
            ch = chains[ci]
            if ch["fixed"] or ch["fac"] == 0:
                continue
            ch["fac"] = ch["fac"] * 0.5 if ch["fac"] > 0.05 else 0.0
            simplify(ch)
            touched.add(ci)
    refaces = set()
    for ci in touched:
        for side in ("l", "r"):
            f = chains[ci][side]
            if f in face_chains:
                refaces.add(f)
    refaces |= set(bad)
    bad = {}
    for f in refaces:
        poly, why = build_face(f)
        if poly is None:
            bad[f] = why
            faces.pop(f, None)
        else:
            faces[f] = poly
    log(f"repair round {rounds}: still invalid {len(bad)}")
unresolved = {int(f): w for f, w in bad.items()}
if FRONT_CUT:
    beside = {chains[ci][s] for run in STREET_FRONTS for ci, _ in run["links"] for s in ("l", "r")}
    assert not (set(bad) & beside), f"faces beside a straightened street front are invalid: {sorted(set(bad) & beside)}"
for f in list(bad):
    # last resort keeps the face out of the mesh; reported in the JSON
    faces.pop(f, None)

# ---------------------------------------------------------------- mesh
comp_band = {f: max(int(comp_label[f]), 0) for f in range(nid)}   # OUT treated as ground for walls

cap_v = {}
cap_t = []


def cvid(x, z, yv):
    key = (x, z, yv)
    k = cap_v.get(key)
    if k is None:
        k = len(cap_v)
        cap_v[key] = k
    return k


for f, poly in faces.items():
    yv = band_level(comp_band[f])
    tris = shapely.constrained_delaunay_triangles(poly)
    for t in shapely.get_parts(tris):
        c = np.asarray(t.exterior.coords)[:3]
        ny = (c[1, 1] - c[0, 1]) * (c[2, 0] - c[0, 0]) - (c[1, 0] - c[0, 0]) * (c[2, 1] - c[0, 1])
        if abs(ny) < 1e-12:
            continue
        ids = [cvid(float(p[0]), float(p[1]), yv) for p in c]
        if ny < 0:
            ids = [ids[0], ids[2], ids[1]]
        cap_t.append(ids)
log("cap triangles", len(cap_t))

# walls
wall_chains = []
node_levels = [set() for _ in range(NN)]
for ci, ch in enumerate(chains):
    if ch["cut"]:
        continue
    l, r = ch["l"], ch["r"]
    if l not in faces and l not in OUTC:
        continue
    if r not in faces and r not in OUTC:
        continue
    bl, br = comp_band[l], comp_band[r]
    if bl == br:
        continue
    ylo, yhi = band_level(min(bl, br)), band_level(max(bl, br))
    wall_chains.append((ci, ylo, yhi, bl < br))
    node_levels[ch["sn"]].update([ylo, yhi])
    node_levels[ch["en"]].update([ylo, yhi])

wall_v = {}
wall_t = []


def wvid(x, z, yv):
    key = (x, z, yv)
    k = wall_v.get(key)
    if k is None:
        k = len(wall_v)
        wall_v[key] = k
    return k


for ci, ylo, yhi, left_is_lower in wall_chains:
    ch = chains[ci]
    g = ch["geom"]
    n = len(g)
    for s in range(n - 1):
        p, q = g[s], g[s + 1]
        dx, dz = q[0] - p[0], q[1] - p[1]
        if dx * dx + dz * dz < 1e-12:
            continue
        # local-frame "left" maps to planner (dz, -dx) because the planner map is a reflection
        nl = np.array([dz, -dx])
        outward = nl if left_is_lower else -nl
        A = sorted(v for v in node_levels[ch["sn"]] if ylo <= v <= yhi) if s == 0 else [ylo, yhi]
        Bv = sorted(v for v in node_levels[ch["en"]] if ylo <= v <= yhi) if s == n - 2 else [ylo, yhi]
        px_, pz_ = float(p[0]), float(p[1])
        qx_, qz_ = float(q[0]), float(q[1])
        i = j = 0
        while i < len(A) - 1 or j < len(Bv) - 1:
            if j == len(Bv) - 1 or (i < len(A) - 1 and A[i + 1] <= Bv[j + 1]):
                tri = [(px_, pz_, A[i]), (qx_, qz_, Bv[j]), (px_, pz_, A[i + 1])]
                i += 1
            else:
                tri = [(px_, pz_, A[i]), (qx_, qz_, Bv[j]), (qx_, qz_, Bv[j + 1])]
                j += 1
            a3 = np.array([[t[0], t[2], t[1]] for t in tri])  # (x, y, z)
            nrm = np.cross(a3[1] - a3[0], a3[2] - a3[0])
            if nrm[0] * outward[0] + nrm[2] * outward[1] < 0:
                tri = [tri[0], tri[2], tri[1]]
            wall_t.append([wvid(*t) for t in tri])
log("wall triangles", len(wall_t))


# ---------------------------------------------------------------- quantise, weld within runs, write
def quantise(vdict, tris):
    keys = list(vdict.keys())
    q = np.round(np.array([[k[0], k[2], k[1]] for k in keys]) * 100).astype(np.int64)   # x, y, z in cm
    uq, inv = np.unique(q, axis=0, return_inverse=True)
    t = inv.ravel()[np.array(tris, dtype=np.int64)]
    good = (t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])
    return uq, t[good], int((~good).sum())


cq, ct, cdeg = quantise(cap_v, cap_t)
wq, wt, wdeg = quantise(wall_v, wall_t)


def fix_tjunctions(cq, ct, wq, wt, max_iter=6):
    """Split any triangle whose open edge has another mesh vertex lying on it (collinear after simplification)."""
    pos = np.vstack([cq, wq])
    tris = np.vstack([ct, wt + len(cq)])
    run = np.concatenate([np.zeros(len(ct), int), np.ones(len(wt), int)])
    U, inv = np.unique(pos, axis=0, return_inverse=True)
    T = inv.ravel()[tris]
    Uf = U.astype(np.float64)
    nsplit = 0
    for _ in range(max_iter):
        e = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
        und = np.sort(e, 1)
        uq, ix, cnt = np.unique(und, axis=0, return_inverse=True, return_counts=True)
        ix = ix.ravel()
        open_e = np.nonzero(cnt[ix] == 1)[0]
        if len(open_e) == 0:
            break
        cand = np.unique(e[open_e].ravel())
        Cp = Uf[cand]
        splits = {}
        for k in open_e:
            a, b = e[k]
            pa, pb = Uf[a], Uf[b]
            ab = pb - pa
            L2 = ab @ ab
            t = ((Cp - pa) @ ab) / L2
            dvec = Cp - (pa + t[:, None] * ab)
            dist = np.sqrt((dvec ** 2).sum(1))
            sel = (t > 1e-4) & (t < 1 - 1e-4) & (dist < 0.75) & (cand != a) & (cand != b)
            if sel.any():
                order = np.argsort(t[sel])
                tri_i, loc = k % len(T), k // len(T)
                if tri_i not in splits:
                    splits[tri_i] = (loc, cand[sel][order])
        if not splits:
            break
        new_t, new_r, drop = [], [], []
        for tri_i, (loc, ms) in splits.items():
            v = T[tri_i]
            a, b, c = v[loc], v[(loc + 1) % 3], v[(loc + 2) % 3]
            chain_ = [a, *ms.tolist(), b]
            for p_, q_ in zip(chain_[:-1], chain_[1:]):
                new_t.append([p_, q_, c])
                new_r.append(run[tri_i])
            drop.append(tri_i)
            nsplit += 1
        keep = np.ones(len(T), bool)
        keep[drop] = False
        T = np.vstack([T[keep], np.array(new_t)])
        run = np.concatenate([run[keep], np.array(new_r)])
    out = []
    for rr in (0, 1):
        Tr = T[run == rr]
        used, loc_ = np.unique(Tr, return_inverse=True)
        out += [U[used], loc_.reshape(-1, 3)]
    return out[0], out[1], out[2], out[3], nsplit


cq, ct, wq, wt, n_tsplit = fix_tjunctions(cq, ct, wq, wt)
log("T-junction splits", n_tsplit)
assert np.abs(np.vstack([cq, wq])).max() < 32767
verts = np.vstack([cq, wq]).astype("<i2")
idx = np.vstack([ct, wt + len(cq)]).astype("<u4")
ntri = len(idx)
hdr = b"VVCX" + struct.pack("<III", 1, len(verts), idx.size)
blob = hdr + verts.tobytes() + idx.ravel().tobytes()
(OUT / f"{ARGS.name}.bin").write_bytes(blob)
gz = gzip.compress(blob, 9, mtime=0)
log(f"vertices {len(verts)} (caps {len(cq)}, walls {len(wq)}), triangles {ntri} (caps {len(ct)}, walls {len(wt)}), "
    f"degenerate dropped {cdeg + wdeg}, raw {len(blob)} B, gzip {len(gz)} B")

# ---------------------------------------------------------------- side products for checks
if ARGS.keep_work:
    np.savez_compressed(OUT / "_work.npz", band=band, band_unfiltered=band_unfiltered, lab=lab, y=y, y_raw=y_raw,
                        PX=PX, PZ=PZ, RR=RR, DE=DE, DN=DN)
levels_used = sorted({band_level(b) for b in np.unique(band)})
f32 = verts.astype(np.float64) / 100


def street_front_summary():
    """each straightened segment as published: its line and ends, the raw boundary's spread about it, and how far
    the written walls facing the street along it stand from it (centimetre vertices)"""
    Vw = wq.astype(np.float64) / 100
    A_, B_, C_ = Vw[wt[:, 0]], Vw[wt[:, 1]], Vw[wt[:, 2]]
    nrm = np.cross(B_ - A_, C_ - A_)[:, [0, 2]]
    nrm /= np.maximum(np.hypot(nrm[:, 0], nrm[:, 1]), 1e-12)[:, None]
    cen = ((A_ + B_ + C_) / 3)[:, [0, 2]]
    runs = []
    for run in STREET_FRONTS:
        segs = []
        for s in run["segments"]:
            c, d = s["c"], s["d"]
            n = np.array([-d[1], d[0]])
            t0, t1 = sorted(float((e - c) @ d) for e in s["ends"])
            tc = (cen - c) @ d
            sel = (nrm @ -n > math.cos(math.radians(30))) & (tc > t0 + 0.01) & (tc < t1 - 0.01) & (np.abs((cen - c) @ n) < 1.0)
            vv = np.vstack([A_[sel], B_[sel], C_[sel]])[:, [0, 2]]
            dev = np.abs((vv - c) @ n)
            segs.append({
                "id": s["id"],
                "line": {"point": [round(float(v), 4) for v in c], "direction": [round(float(v), 6) for v in d]},
                "ends": [[round(float(v), 3) for v in e] for e in s["ends"]],
                "length_m": round(t1 - t0, 3),
                "angle_to_x_deg": round(math.degrees(math.atan2(d[1], d[0])), 3),
                "pinned_through_node": s["pinned"],
                "raw_boundary_m": s["raw"],
                "walls": {"triangles": int(sel.sum()), "max_deviation_m": round(float(dev.max()), 4) if len(dev) else None},
            })
        runs.append({"side": run["side"], "chains": len(run["links"]), "ends": run["ends"], "junctions": run["junctions"],
                     "nodes_moved": run["nodes_moved"], "segments": segs})
    return runs


SF_SUMMARY = street_front_summary() if FRONT_CUT else []
for run in SF_SUMMARY:
    for s in run["segments"]:
        log(f"  {s['id']}: {s['length_m']} m at {s['angle_to_x_deg']} deg, raw rms {s['raw_boundary_m']['rms_m']} max "
            f"{s['raw_boundary_m']['max_m']} averaged {s['raw_boundary_m']['averaged_max_m']}, walls {s['walls']}")
FRONT_DOC = {}
if FRONT_CUT:
    FRONT_DOC = {
        "registration": {
            "centre_local": P["centre_local"],
            "note": ("unchanged from merchant-city-v2: the hall's own E57 scan (the planner's frame), ranging through the "
                     "front door and the windows to the walls across Glassford, Garth and Hutcheson Streets and matched "
                     "to the DSM's edges of them, puts the planner's origin at local (E 3.018, N 7.981), sigma 0.06 / "
                     "0.12 m: in register to about 2 cm. The DSM's own Trades Hall front stands 1.0-1.2 m out from the "
                     "scanned faces (it faces away from the aircraft; its LiDAR shadow is filled), and the DSM's dome-"
                     "drum ring 0.44 m streetward of the interior dome, so neither registers the city"),
        },
        "front_cut": (f"Trades Hall's street front is the planner's own model (hall-exterior-spec.ts: x -15.323..15.273, "
                      f"z -5.295 out to about -7.54, on the pavement): {P['front_cut_x'][0]}<=x<={P['front_cut_x'][1]}, "
                      f"{P['front_cut_z'][0]}<=z<={P['front_cut_z'][1]}, less the site cut, is ground at the ground disc's "
                      f"level (y {P['ground_y']}), its edges on the exact rectangle; the blocks beside it end there in "
                      f"section walls"),
        "street_fronts": {
            "rule": ("the fronts of the blocks beside the front cut on Glassford Street (|x| "
                     f"{P['street_front_x'][0]}..{P['street_front_x'][1]}, z {P['street_front_z'][0]}..{P['street_front_z'][1]}, "
                     "inside the clamp) are straight segments fitted to the DSM's raster boundary; raw_boundary_m is that "
                     "boundary's spread about each segment's line (+ = behind it), averaged_max_m its largest offset "
                     f"averaged over {P['street_front_window_m']} m, at most street_front_tol_m; walls.max_deviation_m is "
                     "the written walls' largest offset from the line, after rounding to centimetres"),
            "slivers_joined": len(SLIVERS),
            "runs": SF_SUMMARY,
        },
    }
info = dict(
    unresolved_faces=unresolved, repair_rounds=rounds,
    chains=len(chains), nodes=NN, faces=len(faces),
    chains_with_reduced_tolerance=int(sum(1 for c in chains if not c["fixed"] and c["fac"] < 1.0)),
    removed_small_raised=n_open, tjunction_splits=n_tsplit, filled_small_holes=n_close, degenerate_dropped=cdeg + wdeg,
)
# The published JSON. Every field is a function of the DSM, the parameters and --date, so a rebuild from
# the same grid reproduces it byte for byte.
doc = {
    "schema": "venviewer.context-model.v1",
    "title": "Architect's contour model of the city around Trades Hall, Glasgow",
    "generated": ARGS.date,
    "licence": {
        "attribution": "Contains LiDAR data: Crown copyright Scottish Government and Fugro (2020), OGL v3.0",
        "licence": "Open Government Licence v3.0",
        "note": "Geometry derived only from the Scottish LiDAR Phase 5 50 cm DSM. No OpenStreetMap data.",
    },
    "frame": {
        "name": "planner hall frame (metres, y up, right-handed)",
        "origin": f"hall floor centre = local (E {ce}, N {cn}) m from E259329 N665183, 3.79 m above the pavement",
        "minus_z_grid_bearing_deg": P["frame_bearing_deg"],
        "plus_x_unit_EN": XH.round(5).tolist(), "plus_z_unit_EN": ZH.round(5).tolist(),
        "from_local": f"dx=e-{ce}, dn=n-{cn}; x=XH.(dx,dn); z=ZH.(dx,dn); y=(DSM+0.30)-3.79",
        "true_bearing": "true = grid - 1.861 deg",
        "y_odn": "y = ODN - 14.19 (DSM datum 10.7 m ODN; pavement 10.40 m ODN at y=-3.79)",
    },
    "encoding": {
        "file": f"{ARGS.name}.bin",
        "header": "16 bytes: 'VVCX', uint32 version=1, uint32 vertexCount, uint32 indexCount (little-endian)",
        "vertices": "int16 x, y, z per vertex, centimetres (value/100 = metres)",
        "indices": "uint32, triangles, counter-clockwise seen from outside (right-hand normal points out of the solid)",
        "runs": {"caps": {"vertices": [0, int(len(cq))], "indices": [0, int(ct.size)]},
                 "walls": {"vertices": [int(len(cq)), int(len(verts))], "indices": [int(ct.size), int(idx.size)]}},
        "shading": "flat (derivative normals); caps and walls do not share vertices",
    },
    "method": __doc__.strip() + ("\n" + FRONT_CUT_METHOD if FRONT_CUT else ""),
    "parameters": P,
    "bands": {
        "spacing_m": S, "anchor_y": P["level_anchor_y"], "ground_disc_y": P["ground_y"],
        "first_level_y": L_FIRST, "levels_y_present": levels_used,
        "rule": "band b>=1 is where the smoothed DSM (planner y) >= first_level_y + (b-1)*spacing; caps sit at that level; "
                "band 0 is the ground disc at the hall pavement level (terrain below it is flattened onto it)",
    },
    "site_cut": f"nothing emitted inside |x|<={P['rect_half_x']}, {P['rect_front_z']}<=z<={P['rect_half_z']} (the street face: the hall's window wall's outer face); the solids cut by it are left open there (the hall model fills it)",
    "clamp": f"within {P['clamp_inner_radius']} m of the origin, and within {P['clamp_radius']} m where planner z > {P['clamp_front_z']} (all but the blocks across Glassford Street), y = min(y, 0) before banding",
    "rim": "solids crossing the 260 m circle are closed with section walls on the circle; the ground disc rim is open",
    **FRONT_DOC,
    "bbox_m": {"min": f32.min(0).round(2).tolist(), "max": f32.max(0).round(2).tolist(), "order": "x, y, z"},
    "counts": {"triangles": int(ntri), "cap_triangles": int(len(ct)), "wall_triangles": int(len(wt)),
               "vertices": int(len(verts)), "bytes_raw": len(blob), "bytes_gzip": len(gz)},
    "terrain": "cells not in a raised blob are replaced by a normalised-convolution Gaussian (sigma terrain_sigma) of ground cells only, so street-level contours follow the terrain, not LiDAR noise; low walls/railings narrower than ~1 m vanish",
    "generator": "tools/grand-hall-survey/context/build_context.py, run on the grid cut by tools/grand-hall-survey/context/fetch_dsm.py",
    "sources": {
        "dsm": "Scottish LiDAR Phase 5 50 cm DSM, tiles NS56NE, NS56SE, NS66NW, NS66SW (2020), cropped at its native 0.5 m cells (no resampling) to the 3 km square around HES NGR E259329 N665183 by fetch_dsm.py",
        "facade_frame": "Trades Hall facade fit to the same DSM (front at grid bearing 12.96 deg)",
    },
}
(OUT / f"{ARGS.name}.json").write_bytes((json.dumps(doc, indent=1) + "\n").encode("utf-8"))


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# The build's own report: what it removed and repaired, and exactly what it ran on. Not published.
report = {
    "model": {"file": f"{ARGS.name}.bin", "sha256": hashlib.sha256(blob).hexdigest()},
    "inputs": {"heights_50cm.f32": file_sha256(SRC / "heights_50cm.f32"), "meta.json": file_sha256(SRC / "meta.json")},
    "versions": {"numpy": np.__version__, "scipy": scipy.__version__, "scikit-image": skimage.__version__,
                 "shapely": shapely.__version__, "zlib": zlib.ZLIB_VERSION},
    "trees_suppressed": {"rule": "isolated raised blob (DSM > terrain_cut) with area < tree_max_area, interior median residual from a 1.5 m local plane > tree_min_residual (roof interiors: median 0.035 m) and top < tree_max_height above the pavement; flattened to the smoothed terrain", "blobs": TREES},
    "build": info,
}
if FRONT_CUT:
    report["front_cut"] = {"slivers_joined": SLIVERS, "junctions_on_both_cuts": FRONT_JUNCTIONS,
                           "street_front_lines": [[[round(float(v), 4) for v in p] for p in run["F"]] for run in STREET_FRONTS]}
(OUT / f"{ARGS.name}.build.json").write_bytes((json.dumps(report, indent=1) + "\n").encode("utf-8"))
log("done", json.dumps(info))
