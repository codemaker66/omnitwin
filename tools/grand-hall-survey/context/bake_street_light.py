"""Street lighting round the Grand Hall at night: the lamp table and the light texture for the city model.

Inputs
  street-lamps-ogl-2026-10-18.json  Glasgow City Council's open lamp positions (fetch_street_lamps.py, OGL v3)
  merchant-city-v2.bin / .json      the published city model (build_context.py): its frame, parameters, walls, caps
  _work.npz                         the model's rasters (build_context.py --keep-work): bands and the site labels
  heights_50cm.f32 + meta.json      the LiDAR grid the model was cut from (fetch_dsm.py), for column heights
  Trades Hall's two door lanterns   the facade survey (photo 05), as the DOOR_LANTERNS constant below

Steps
  1. the council's points in the planner frame within the model's reach; points within 0.3 m merged; six points
     in George Square's paving that are not lamp columns left out (EXCLUDED); the door lanterns added
  2. bracket or column, from the model alone: a point standing in a building (a surface at least 2.2 m above the
     ground round it) or within 2.5 m of a drawn building wall is a wall bracket, anything else a column
  3. brackets snap to the nearest drawn building wall and move 0.85 m out along its normal (a 0.5 m bracket and
     half a lantern); a column throws its light away from the nearest building
  4. mounting heights: 8 m for brackets (Trades Hall's own lamp sits level with the first-floor window arches,
     between the springing at 7.60 m and the crown at 9.03 m, in our facade photograph); a column's height is the
     LiDAR spike over it where the DSM resolves one within an arm's reach (1.5 m) of its point (4-12.5 m), else
     8 m (a spike further off is another object: a signal, a sign); a bracket stands at the foot of its drawn
     wall, a column on the model's drawn ground
  5. fittings the model cannot carry draw none and keep their light ("fitting"): "cut", a bracket whose drawn
     wall is cut at the hall's floor by the site's clamp below its head, or a column inside the clamp with its
     head above the cut (y = 0); "low-wall", a bracket on a wall the model's 3 m bands drew too low to hang it at
     least 4 m over the street. A bracket on a wall drawn lower than its head moves onto the wall that carries on
     up within 2.5 m behind a ledge, or else hangs 0.6 m under the drawn top (height_source "model-wall")
  6. each lamp's switching altitude: -3.0 +- 0.6 degrees of sun, from a hash of its id, on the light maps'
     8-bit lattice (-3.6 + 1.2 k / 255), so the maps and the table agree exactly
  7. two light maps, each 512 x 512 RGBA8 over +-260 m, warped s = asinh(x / 60) / asinh(260 / 60) (about 0.5 m
     a texel at the hall, 0.85 m at 80 m, 2.3 m at the edge). The pool map, read filtered:
       R   the distance to the nearest visible pool, metres, 1.3x shorter along the street than across it, the
           pool's centre 1.6 m out from the head along its throw; 0-24 m (door lanterns' pools scaled by 0.4)
       G   that pool's lamp's switching altitude, -3.6..-2.4 degrees as 0..255
       B   that lamp's foot (the ground its pool lies on), y -6..26 m as 1..255
       A   its pool's strength, 0..1 (door lanterns 0.6)
     every texel holding the nearest pool lamp's G B A, so filtering only ever blends real lamps. The head map,
     read texel by texel:
       R   the nearest visible head's switching altitude, as G above
       G B that head from the texel's centre, x and z, +-16 m (0 beyond 16 m)
       A   that head's height y, -6..26 m as 1..255; 0 where no head is within 16 m
     A texel sees a lamp when the line from the lamp's head (launched from outside its own building) to the
     texel's surface clears the model's bands; values carry 3 texels into building footprints so wall edges
     sample the street's light
  8. write street-light-v2.bin (header 'VVSL', then the pool map, then the head map) and street-lamps-v2.json

Usage
  python bake_street_light.py <out-dir> --work <_work.npz> --dsm-dir <dir> [--lamps ...] [--model-dir ...]
         [--facade facade.json] [--pub pub-layer.json] [--check]
  --check  rebuilds into a temporary folder, asserts byte-identical output and runs the bake checks
  --pub    a local copy of the council's Pub_Lighting_Columns response (never committed): checks the
           bracket/column classification against it (at least 95 % agreement)
Requires numpy and scipy.
"""
# The docstring above is copied into the published JSON as "method"; keep it in step with the code.
import argparse
import hashlib
import json
import math
import struct
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
DEFAULT_LAMPS = HERE / "street-lamps-ogl-2026-10-18.json"
DEFAULT_MODEL_DIR = REPO / "packages/web/public/rooms/grand-hall/context-2020-lidar"
MODEL_NAME = "merchant-city-v2"

P = dict(
    reach_m=258.0, dedupe_m=0.3, raised_m=2.2, building_above_m=4.5, building_width_m=2.5, building_window_m=20.0, bracket_wall_m=2.5,
    wall_min_height_m=2.5, wall_foot_slack_m=4.0, stack_m=2.5, normal_window_m=2.5, lantern_min_m=4.0, eaves_m=0.6, street_probe_m=[0.85, 2.0, 3.5, 5.0], bracket_outreach_m=0.85, bracket_height_m=8.0,
    column_default_m=8.0, column_arm_m=0.5, lidar_match_m=1.5, lidar_height_m=[4.0, 12.5],
    switch_centre_deg=-3.0, switch_spread_deg=0.6, pool_offset_m=1.6, pool_stretch=1.3,
    pool_range_m=24.0, head_range_m=16.0, head_y_range=[-6.0, 26.0], door_pool_scale=0.4, door_pool_strength=0.6,
    size=512, warp_m=60.0, extent_m=260.0, carry_texels=3, launch_max_m=3.0, ray_step_m=0.5,
    ray_clearance_m=0.3, large_snap_m=4.0,
)

# Six of the council's points in George Square are lights set in the square's paving, not lamp columns: a street
# lamp model would stand them up as lanterns on the paving. Only their OBJECTIDs and one reason are kept here.
EXCLUDED_REASON = "George Square: a light in the paving, not a lamp column"
EXCLUDED = {oid: EXCLUDED_REASON for oid in (62677, 62678, 62679, 62680, 62681, 62682)}

# Trades Hall's two private door lanterns, from the facade survey (D:/claude/orbit-lookdev-20260923/spec/facade/
# facade.json, bays[3].door.lamps, read from photo 05): u = +-2.461 m either side of the building axis, 2.904-3.494 m
# above the pavement, 0.256 m wide. They hang on the podium's face (d = 1.07 m in front of the end bays' wall, an
# inferred depth) on short brackets, so their centres stand 0.30 m proud of it.
DOOR_LANTERNS = dict(u=2.461, z_bottom=2.904, z_top=3.494, width=0.256, podium_face_d=1.07, proud_m=0.30,
                     facade_origin_local=[10.0, 6.406], u_axis_local=[0.224, 0.975], d_axis_local=[0.975, -0.224])

# The lamps the site's cut must take away: Trades Hall's own street lamp, on its front, and the four whose walls
# or columns stand inside the cut site. A rule that cuts 24095, across Glassford Street, is wrong.
EXPECTED_CUT = {24094, 24096, 45116, 45117, 45127}
# The bracket whose drawn wall is too low to carry it (the model's bands drew its building 3 m tall).
EXPECTED_LOW_WALL = {8463}
FACADE_PHOTO_LAMP = 24094

MAGIC = b"VVSL"
VERSION = 2
HEADER = struct.Struct("<4sIIffffffffffI")   # magic, version, size, warp, extent, pool range, head range, y min,
                                              # y max, switch min, switch max, door pool scale, pool stretch, count
SWITCH_RANGE = (P["switch_centre_deg"] - P["switch_spread_deg"], P["switch_centre_deg"] + P["switch_spread_deg"])
LIGHT_FILE = "street-light-v2.bin"
LAMPS_FILE = "street-lamps-v2.json"


def parse_args():
    ap = argparse.ArgumentParser(description="Street lighting round the Grand Hall at night (VVSL v2).")
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--work", type=Path, required=True, help="_work.npz from build_context.py --keep-work")
    ap.add_argument("--dsm-dir", type=Path, required=True, help="heights_50cm.f32 and meta.json (fetch_dsm.py)")
    ap.add_argument("--lamps", type=Path, default=DEFAULT_LAMPS)
    ap.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    ap.add_argument("--facade", type=Path, help="facade.json: checks DOOR_LANTERNS against the survey")
    ap.add_argument("--pub", type=Path, help="a local Pub_Lighting_Columns response (never committed)")
    ap.add_argument("--check", action="store_true")
    return ap.parse_args()


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# ---------------------------------------------------------------- the model
class Model:
    def __init__(self, model_dir, work_path):
        self.meta = json.loads((model_dir / f"{MODEL_NAME}.json").read_text(encoding="utf-8"))
        blob = (model_dir / f"{MODEL_NAME}.bin").read_bytes()
        assert blob[:4] == b"VVCX"
        _, nv, ni = struct.unpack("<III", blob[4:16])
        verts = np.frombuffer(blob, "<i2", nv * 3, 16).reshape(-1, 3).astype(np.float64) / 100
        idx = np.frombuffer(blob, "<u4", ni, 16 + nv * 6).reshape(-1, 3).astype(np.int64)
        runs = self.meta["encoding"]["runs"]
        c0, c1 = (v // 3 for v in runs["caps"]["indices"])
        w0, w1 = (v // 3 for v in runs["walls"]["indices"])
        self.caps = verts[idx[c0:c1]]
        self.walls_tri = verts[idx[w0:w1]]
        frame = self.meta["frame"]
        self.xh = np.array(frame["plus_x_unit_EN"])
        self.zh = np.array(frame["plus_z_unit_EN"])
        par = self.meta["parameters"]
        self.par = par
        self.centre_e = 259329.0 + par["centre_local"][0]
        self.centre_n = 665183.0 + par["centre_local"][1]
        self.ground_y = par["ground_y"]
        self._walls()
        self._caps_index()
        work = np.load(work_path)
        self.band = work["band"]
        self.lab = work["lab"]
        self.res = 0.5
        self.k = self.band.shape[0] // 2
        # check the raster's frame against the model's
        px, pz = work["PX"], work["PZ"]
        for (i, j) in ((10, 20), (500, 700), (1000, 33)):
            assert self.cell(px[i, j], pz[i, j]) == (i, j), "the rasters are not the model's frame"
        first = par["level_anchor_y"] + (math.floor((par["ground_y"] - par["level_anchor_y"]) / par["spacing"]) + 1) * par["spacing"]
        levels = np.where(self.band <= 0, par["ground_y"], first + (self.band - 1) * par["spacing"]).astype(np.float64)
        # Surfaces the light can be blocked by: the bands; nothing beyond the rim; the hall's own block (the cut
        # rectangle, where the hall model stands) as tall.
        self.surface = np.where(self.lab == -1, par["ground_y"], np.where(self.lab == -2, 20.0, levels))
        rr = np.hypot(px, pz)
        self.clampzone = (rr < par["clamp_inner_radius"]) | ((rr < par["clamp_radius"]) & (pz > par["clamp_front_z"]))
        # Raised cells (the drawn model): a surface at least raised_m over the lowest ground within window_m.
        # The light texture carries the street's values into them.
        win = int(round(P["building_window_m"] / self.res)) * 2 + 1
        low = ndi.minimum_filter(np.where(self.lab == -1, par["ground_y"], levels), size=win)
        self.local_ground = low
        self.building = (self.surface - low >= P["raised_m"])
        # Buildings: the model's heights with its trees taken out (its "y"), before the site's clamp (the LiDAR
        # itself inside the clamp), in the model's bands, at least building_above_m over the lowest ground within
        # window_m. A terrace step in the street is raised but not a building; a tree is neither.
        whole = np.where(self.clampzone, work["y_raw"], work["y"])
        whole = np.where(whole < first, par["ground_y"], first + np.floor((whole - first) / par["spacing"]) * par["spacing"])
        tall = (whole - ndi.minimum_filter(whole, size=win)) >= P["building_above_m"]
        # opened: a column, a statue or a kiosk narrower than building_width_m is not a building
        width = int(round(P["building_width_m"] / self.res))
        self.built = ndi.binary_opening(tall, structure=np.ones((width, width), dtype=bool))

    def to_planner(self, e, n):
        de, dn = np.asarray(e) - self.centre_e, np.asarray(n) - self.centre_n
        return de * self.xh[0] + dn * self.xh[1], de * self.zh[0] + dn * self.zh[1]

    def to_local(self, x, z):
        """planner (x, z) -> (dE, dN) from the centre (the frame is orthonormal: its inverse is its transpose)"""
        x, z = np.asarray(x, dtype=np.float64), np.asarray(z, dtype=np.float64)
        return x * self.xh[0] + z * self.zh[0], x * self.xh[1] + z * self.zh[1]

    def cell(self, x, z):
        de, dn = self.to_local(x, z)
        return int(math.floor(dn / self.res + self.k)), int(math.floor(de / self.res + self.k))

    def cells(self, x, z):
        de, dn = self.to_local(x, z)
        i = np.clip(np.floor(dn / self.res + self.k).astype(np.int64), 0, self.band.shape[0] - 1)
        j = np.clip(np.floor(de / self.res + self.k).astype(np.int64), 0, self.band.shape[1] - 1)
        return i, j

    def _walls(self):
        segs = {}
        for tri in self.walls_tri:
            xz = [(round(float(p[0]), 2), round(float(p[2]), 2)) for p in tri]
            u = sorted(set(xz))
            if len(u) != 2:
                continue
            key = (u[0], u[1])
            nrm = np.cross(tri[1] - tri[0], tri[2] - tri[0])
            lo, hi, nx, nz = segs.get(key, (1e9, -1e9, 0.0, 0.0))
            segs[key] = (min(lo, tri[:, 1].min()), max(hi, tri[:, 1].max()), nx + nrm[0], nz + nrm[2])
        keys = list(segs)
        self.seg_a = np.array([k[0] for k in keys])
        self.seg_b = np.array([k[1] for k in keys])
        vals = np.array([segs[k] for k in keys])
        self.seg_lo, self.seg_hi = vals[:, 0], vals[:, 1]
        nrm = vals[:, 2:4]
        self.seg_n = nrm / np.maximum(np.hypot(nrm[:, 0], nrm[:, 1])[:, None], 1e-12)

    def building_walls(self):
        """drawn walls at least wall_min_height_m tall with a building (LiDAR) a metre behind them"""
        mid = (self.seg_a + self.seg_b) / 2
        inside = mid - self.seg_n * 1.0
        i, j = self.cells(inside[:, 0], inside[:, 1])
        mi, mj = self.cells(mid[:, 0], mid[:, 1])
        self.seg_cut = self.clampzone[mi, mj] & (self.seg_hi <= self.par["clamp_y"] + 0.01)
        return ((self.seg_hi - self.seg_lo) >= P["wall_min_height_m"]) & self.built[i, j]

    def wall_normal(self, q, index, mask):
        """the wall's outward normal, averaged along the drawn wall within normal_window_m of q (smooths kinks)"""
        a, b = self.seg_a[mask], self.seg_b[mask]
        ab = b - a
        t = np.clip(((q - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-12), 0, 1)
        d = np.hypot(*(q - (a + t[:, None] * ab)).T)
        n = self.seg_n[mask]
        near = (d <= P["normal_window_m"]) & ((n @ self.seg_n[index]) > 0.5)
        s = (n[near] * np.hypot(*ab[near].T)[:, None]).sum(0)
        length = float(np.hypot(*s))
        return s / length if length > 1e-9 else self.seg_n[index]

    def street_before(self, q, n, wall_foot):
        out = [self.ground_at(*(q + n * k)) for k in P["street_probe_m"]]
        return round(min([wall_foot, *[g for g in out if g is not None]]), 3)

    def nearest_wall(self, x, z, mask):
        a, b = self.seg_a[mask], self.seg_b[mask]
        ab = b - a
        p = np.array([x, z])
        t = np.clip(((p - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-12), 0, 1)
        q = a + t[:, None] * ab
        d = np.hypot(*(p - q).T)
        k = int(np.argmin(d))
        index = np.nonzero(mask)[0][k]
        return float(d[k]), q[k], index

    def _caps_index(self):
        c = self.caps
        self.cap_xz = c[:, :, [0, 2]]
        self.cap_y = c[:, 0, 1]
        self.cap_min = self.cap_xz.min(1)
        self.cap_max = self.cap_xz.max(1)

    def ground_at(self, x, z):
        """the drawn cap's height at (x, z), None outside every cap"""
        m = (self.cap_min[:, 0] <= x) & (self.cap_max[:, 0] >= x) & (self.cap_min[:, 1] <= z) & (self.cap_max[:, 1] >= z)
        for k in np.nonzero(m)[0]:
            a, b, c = self.cap_xz[k]
            v0, v1, v2 = b - a, c - a, np.array([x, z]) - a
            den = v0[0] * v1[1] - v1[0] * v0[1]
            if abs(den) < 1e-12:
                continue
            s = (v2[0] * v1[1] - v1[0] * v2[1]) / den
            t = (v0[0] * v2[1] - v2[0] * v0[1]) / den
            if s >= -1e-9 and t >= -1e-9 and s + t <= 1 + 1e-9:
                return float(self.cap_y[k])
        return None


# ---------------------------------------------------------------- LiDAR column heights
def lidar_spikes(dsm_dir, model, points):
    """narrow raised features (white top-hat) near each point: (height above local ground, distance) or None"""
    meta = json.loads((dsm_dir / "meta.json").read_text(encoding="utf-8"))
    g, res, half = meta["grid"], meta["res"], meta["sizeM"] / 2
    e_w, n_s = meta["originE"] - half, meta["originN"] - half
    full = np.memmap(dsm_dir / "heights_50cm.f32", dtype="<f4", mode="r", shape=(g, g))
    out = {}
    for key, (x, z) in points.items():
        de, dn = model.to_local(x, z)
        e, n = model.centre_e + float(de), model.centre_n + float(dn)
        ci, cj = int((n - n_s) / res), int((e - e_w) / res)
        k = 30   # 15 m round the point
        dsm = np.asarray(full[ci - k:ci + k + 1, cj - k:cj + k + 1], dtype=np.float64)
        ground = ndi.uniform_filter(ndi.percentile_filter(dsm, 10, size=13), size=5)
        h = dsm - ground
        opened = ndi.grey_opening(h, size=(5, 5))
        tophat = h - opened
        lab, _ = ndi.label(tophat > 3.0, structure=np.ones((3, 3)))
        best = None
        for idx, sl in enumerate(ndi.find_objects(lab), start=1):
            if sl is None:
                continue
            m = lab[sl] == idx
            area = int(m.sum())
            extent = max(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start) * res
            if area > 12 or extent > 3.0:
                continue
            hv = np.where(m, h[sl], -1e9)
            top = float(hv.max())
            if not 4.0 <= top <= 14.0:
                continue
            a, b = np.unravel_index(int(np.argmax(hv)), hv.shape)
            i, j = sl[0].start + a, sl[1].start + b
            if float(opened[i, j]) > 1.5:
                continue
            se = e_w + (cj - k + j + 0.5) * res
            sn = n_s + (ci - k + i + 0.5) * res
            d = math.hypot(se - e, sn - n)
            if d <= P["lidar_match_m"] and (best is None or d < best[1]):
                best = (top, d)
        out[key] = best
    return out


# ---------------------------------------------------------------- lamps
def switch_byte(key):
    """the lamp's switching altitude on the light maps' lattice, 0..255, from a 32-bit multiplicative hash of its number"""
    h = ((key * 2654435761) & 0xFFFFFFFF) / 2 ** 32
    return min(255, int(h * 256))


def switch_altitude(byte):
    """-3.6..-2.4 degrees for a lattice step 0..255, as the shader decodes it"""
    lo, hi = SWITCH_RANGE
    return round(lo + (hi - lo) * byte / 255, 4)


def y_byte(y):
    """a height on the maps' lattice, 1..255 over the y range"""
    lo, hi = P["head_y_range"]
    return np.clip(1 + np.round((np.asarray(y, dtype=np.float64) - lo) / (hi - lo) * 254), 1, 255).astype(np.uint8)


def door_lanterns(model):
    d = DOOR_LANTERNS
    o, ua, da = (np.array(d[k]) for k in ("facade_origin_local", "u_axis_local", "d_axis_local"))
    depth = d["podium_face_d"] + d["proud_m"]
    ox, oz = model.to_planner(259329.0 + o[0], 665183.0 + o[1])
    hx, hz = model.to_planner(259329.0 + o[0] + da[0], 665183.0 + o[1] + da[1])
    heading = np.array([float(hx - ox), float(hz - oz)])
    heading /= np.hypot(*heading)
    out = []
    for name, u, key in (("door-north", d["u"], 1), ("door-south", -d["u"], 2)):
        local = o + u * ua + depth * da
        x, z = model.to_planner(259329.0 + local[0], 665183.0 + local[1])
        y = (d["z_bottom"] + d["z_top"]) / 2 + model.ground_y
        byte = switch_byte(1_000_000 + key)
        out.append(dict(key=-key, id=f"trades-hall:{name}", objectid=None, source="facade-survey", kind="door",
                        head=[float(x), y, float(z)], foot_y=model.ground_y, heading=heading.tolist(),
                        reach=d["proud_m"], fitting="drawn", height_source="facade-photo",
                        switch_byte=byte, switch_altitude=switch_altitude(byte), snap_shift=0.0, flags=[]))
    return out


def build_lamps(model, lamps_doc, dsm_dir):
    pts = []
    for r in lamps_doc["lamps"]:
        x, z = model.to_planner(r["e"], r["n"])
        pts.append((r["objectid"], float(x), float(z)))
    pts = [p for p in pts if math.hypot(p[1], p[2]) <= P["reach_m"]]
    within = len(pts)
    excluded = sorted(p[0] for p in pts if p[0] in EXCLUDED)
    pts = [p for p in pts if p[0] not in EXCLUDED]
    pts.sort(key=lambda p: p[0])
    merged = {}
    kept = []
    for p in pts:
        twin = next((k for k in kept if math.hypot(k[1] - p[1], k[2] - p[2]) < P["dedupe_m"]), None)
        if twin is None:
            kept.append(p)
        else:
            merged.setdefault(twin[0], []).append(p[0])
    walls = model.building_walls()
    lamps = []
    columns = {}
    for oid, x, z in kept:
        i, j = model.cell(x, z)
        ground_here = float(model.local_ground[i, j])
        facade = walls & (model.seg_lo <= ground_here + P["wall_foot_slack_m"])
        dwall, q, si = model.nearest_wall(x, z, facade)
        # Beside a wall too low to carry a lantern (and not cut by the site), a lamp stands on its own column.
        carries = model.seg_cut[si] or model.seg_hi[si] - model.seg_lo[si] >= P["lantern_min_m"] + P["eaves_m"]
        bracket = bool(model.built[i, j]) or (dwall <= P["bracket_wall_m"] and carries)
        flags = []
        if bracket:
            # The bracket stands 8 m over the street in front of its wall: the lowest drawn ground within 5 m out.
            foot = model.street_before(q, model.seg_n[si], float(model.seg_lo[si]))
            head_y = foot + P["bracket_height_m"]
            wall = si
            if model.seg_hi[si] < head_y and not model.seg_cut[si]:
                # A wall stopped short by a ledge: mount on the wall that carries on up within stack_m behind it.
                up = walls & (model.seg_lo <= model.seg_hi[si] + 0.1) & (model.seg_hi > model.seg_hi[si] + 0.1)                     & ((model.seg_n @ model.seg_n[si]) > 0.9)
                if up.any():
                    d2, q2, s2 = model.nearest_wall(q[0], q[1], up)
                    if d2 <= P["stack_m"]:
                        q, wall = q2, s2
            top = float(model.seg_hi[wall])
            fitting = "drawn"
            source = "facade-photo" if oid == FACADE_PHOTO_LAMP else "default"
            if top < head_y:
                if model.seg_cut[wall]:
                    fitting = "cut"           # the site's cut: the lamp's wall is drawn only to the hall's floor
                elif top - P["eaves_m"] - foot >= P["lantern_min_m"]:
                    # The model's 3 m bands drew the wall lower than the lamp: hang it just under the drawn top.
                    head_y = top - P["eaves_m"]
                    source = "model-wall"
                    flags.append(f"under its {top - foot:.1f} m drawn wall")
                else:
                    # Too low to hang a lantern over the street: its light stays, at its own height, unfitted.
                    fitting = "low-wall"
                    flags.append(f"light only: its drawn wall is {top - foot:.1f} m")
            n = model.wall_normal(q, wall, walls)
            head_xz = q + n * P["bracket_outreach_m"]
            shift = float(math.hypot(head_xz[0] - x, head_xz[1] - z))
            if shift > P["large_snap_m"]:
                flags.append(f"snapped {shift:.1f} m")
            byte = switch_byte(oid)
            lamps.append(dict(key=oid, id=f"gcc:{oid}", objectid=oid, source="gcc-ogl", kind="bracket",
                              head=[float(head_xz[0]), head_y, float(head_xz[1])], foot_y=round(foot, 3),
                              heading=[float(n[0]), float(n[1])], reach=P["bracket_outreach_m"],
                              fitting=fitting, height_source=source, switch_byte=byte,
                              switch_altitude=switch_altitude(byte), snap_shift=round(shift, 2), flags=flags,
                              merged=merged.get(oid, []), cell=(i, j)))
        else:
            away = np.array([x, z]) - q
            heading = away / max(float(np.hypot(*away)), 1e-9)
            foot = model.ground_at(x, z)
            if foot is None:
                foot = float(model.surface[i, j])
                flags.append("foot from the raster")
            columns[oid] = (x, z)
            byte = switch_byte(oid)
            lamps.append(dict(key=oid, id=f"gcc:{oid}", objectid=oid, source="gcc-ogl", kind="column",
                              head=[x, None, z], foot_y=round(float(foot), 3),
                              heading=[float(heading[0]), float(heading[1])], reach=P["column_arm_m"],
                              fitting=None, height_source=None, switch_byte=byte, switch_altitude=switch_altitude(byte),
                              snap_shift=0.0, flags=flags, merged=merged.get(oid, []), cell=(i, j)))
    spikes = lidar_spikes(dsm_dir, model, columns)
    lo, hi = P["lidar_height_m"]
    for lamp in lamps:
        if lamp["kind"] != "column":
            continue
        spike = spikes[lamp["key"]]
        if spike is not None and lo <= spike[0] <= hi:
            height, lamp["height_source"] = round(spike[0], 2), "lidar"
        else:
            height, lamp["height_source"] = P["column_default_m"], "default"
            if spike is not None:
                lamp["flags"].append(f"LiDAR spike {spike[0]:.1f} m out of range")
        lamp["head"][1] = lamp["foot_y"] + height
        i, j = lamp["cell"]
        lamp["fitting"] = "cut" if model.clampzone[i, j] and lamp["head"][1] > model.par["clamp_y"] else "drawn"
    lamps += door_lanterns(model)
    for lamp in lamps:
        lamp["head"] = [round(v, 3) for v in lamp["head"]]
        lamp["heading"] = [round(v, 4) for v in lamp["heading"]]
    counts = dict(within_reach=within, excluded=excluded, merged={str(k): v for k, v in sorted(merged.items())})
    return lamps, counts


# ---------------------------------------------------------------- texture
def warp_axis():
    n = P["size"]
    s = (np.arange(n) + 0.5) / n * 2 - 1
    return P["warp_m"] * np.sinh(s * math.asinh(P["extent_m"] / P["warp_m"]))


def warp_index(x):
    """continuous texel coordinate of a world coordinate (texel centres at k + 0.5)"""
    s = np.arcsinh(np.asarray(x) / P["warp_m"]) / math.asinh(P["extent_m"] / P["warp_m"])
    return (s + 1) / 2 * P["size"]


def pool_rho(lamp, tx, tz):
    hx, _, hz = lamp["head"]
    t = np.array(lamp["heading"])
    cx, cz = hx + t[0] * P["pool_offset_m"], hz + t[1] * P["pool_offset_m"]
    dx, dz = tx - cx, tz - cz
    across = dx * t[0] + dz * t[1]
    along = -dx * t[1] + dz * t[0]
    rho = np.sqrt((along / P["pool_stretch"]) ** 2 + across ** 2)
    if lamp["kind"] == "door":
        rho = rho / P["door_pool_scale"]
    return rho


def launch_point(model, lamp):
    """the head's horizontal position moved out along its throw until it stands over open ground"""
    hx, hy, hz = lamp["head"]
    t = np.array(lamp["heading"])
    for step in np.arange(0.0, P["launch_max_m"] + 1e-9, 0.25):
        x, z = hx + t[0] * step, hz + t[1] * step
        i, j = model.cell(x, z)
        if model.surface[i, j] < hy - 1.0 and not model.building[i, j]:
            return x, z
    return hx + t[0] * P["launch_max_m"], hz + t[1] * P["launch_max_m"]


def visible(model, lamp, lx, lz, tx, tz, ty):
    """whether the line from the head (launched at lx, lz) to each texel's surface point clears the bands"""
    hy = lamp["head"][1]
    dx, dz = tx - lx, tz - lz
    length = np.hypot(dx, dz)
    nmax = int(math.ceil(float(length.max(initial=0.0)) / P["ray_step_m"])) + 1
    ok = np.ones(tx.shape, dtype=bool)
    for k in range(1, nmax):
        f = np.minimum(k * P["ray_step_m"] / np.maximum(length, 1e-9), 1.0)
        live = ok & (length - k * P["ray_step_m"] > 0.25)
        if not live.any():
            continue
        sx, sz = lx + dx * f, lz + dz * f
        i, j = model.cells(sx, sz)
        ray_y = hy + (ty - hy) * f
        ok &= ~(live & (model.surface[i, j] > ray_y + P["ray_clearance_m"]))
    return ok


def bake(model, lamps):
    n = P["size"]
    axis = warp_axis()
    TX, TZ = np.meshgrid(axis, axis)          # [v (z), u (x)]
    ti, tj = model.cells(TX, TZ)
    ty = model.surface[ti, tj]
    building = model.building[ti, tj] | (model.lab[ti, tj] == -2)
    outside = model.lab[ti, tj] == -1
    open_ = ~building & ~outside
    best_rho = np.full((n, n), np.inf)
    rho_lamp = np.full((n, n), -1, dtype=np.int64)
    best_d = np.full((n, n), np.inf)
    head_lamp = np.full((n, n), -1, dtype=np.int64)
    reach = max(P["pool_range_m"] * P["pool_stretch"] + P["pool_offset_m"], P["head_range_m"]) + 1
    for li, lamp in enumerate(lamps):
        hx, _, hz = lamp["head"]
        u0, u1 = (int(v) for v in np.clip(np.floor(warp_index([hx - reach, hx + reach])), 0, n - 1))
        v0, v1 = (int(v) for v in np.clip(np.floor(warp_index([hz - reach, hz + reach])), 0, n - 1))
        sl = (slice(v0, v1 + 1), slice(u0, u1 + 1))
        tx, tz = TX[sl], TZ[sl]
        rho = pool_rho(lamp, tx, tz)
        dh = np.hypot(tx - hx, tz - hz)
        cand = open_[sl] & ((rho < P["pool_range_m"]) | (dh < P["head_range_m"]))
        if not cand.any():
            continue
        lx, lz = launch_point(model, lamp)
        seen = np.zeros(cand.shape, dtype=bool)
        seen[cand] = visible(model, lamp, lx, lz, tx[cand], tz[cand], ty[sl][cand])
        better = seen & (rho < best_rho[sl]) & (rho < P["pool_range_m"])
        best_rho[sl] = np.where(better, rho, best_rho[sl])
        rho_lamp[sl] = np.where(better, li, rho_lamp[sl])
        nearer = seen & (dh < best_d[sl]) & (dh < P["head_range_m"])
        best_d[sl] = np.where(nearer, dh, best_d[sl])
        head_lamp[sl] = np.where(nearer, li, head_lamp[sl])
    # Carry into building footprints: each building texel within carry_texels of a valued street texel takes its
    # lamps, with the distances recomputed where it stands.
    for lamp_of in (rho_lamp, head_lamp):
        valued = lamp_of >= 0
        dist, (ii, jj) = ndi.distance_transform_edt(~valued, return_indices=True)
        take = building & ~valued & (dist <= P["carry_texels"])
        lamp_of[take] = lamp_of[ii[take], jj[take]]
    heads = np.array([l["head"] for l in lamps])
    rho_out = np.full((n, n), P["pool_range_m"])
    for li, lamp in enumerate(lamps):
        m = rho_lamp == li
        if m.any():
            rho_out[m] = np.minimum(pool_rho(lamp, TX[m], TZ[m]), P["pool_range_m"])
    has_head = head_lamp >= 0
    hl = np.where(has_head, head_lamp, 0)
    vx = np.where(has_head, heads[hl, 0] - TX, 0.0)
    vz = np.where(has_head, heads[hl, 2] - TZ, 0.0)
    hy = np.where(has_head, heads[hl, 1], 0.0)
    gb = P["head_range_m"]
    has_head &= np.hypot(vx, vz) <= gb
    vx, vz = np.where(has_head, vx, 0.0), np.where(has_head, vz, 0.0)
    a_lo, a_hi = P["head_y_range"]
    assert np.all((hy[has_head] >= a_lo) & (hy[has_head] <= a_hi)), "a head outside the maps' y range"
    feet = np.array([l["foot_y"] for l in lamps], dtype=np.float64)
    assert np.all((feet >= a_lo) & (feet <= a_hi)), "a foot outside the maps' y range"
    switches = np.array([l["switch_byte"] for l in lamps], dtype=np.uint8)
    strengths = np.array([P["door_pool_strength"] if l["kind"] == "door" else 1.0 for l in lamps])
    # Every texel takes its nearest pool lamp's switch, foot and strength, so the filtered map only ever blends
    # real lamps' values (inside a pool they are its own lamp's).
    owned = rho_lamp >= 0
    if owned.any():
        _, (oi, oj) = ndi.distance_transform_edt(~owned, return_indices=True)
        pool_of = rho_lamp[oi, oj]
    else:
        pool_of = np.zeros((n, n), dtype=np.int64)
    pool = np.zeros((n, n, 4), dtype=np.uint8)
    pool[..., 0] = np.clip(np.round(rho_out / P["pool_range_m"] * 255), 0, 255)
    pool[..., 1] = switches[pool_of]
    pool[..., 2] = y_byte(feet[pool_of])
    pool[..., 3] = np.clip(np.round(strengths[pool_of] * 255), 0, 255)
    head = np.zeros((n, n, 4), dtype=np.uint8)
    head[..., 0] = np.where(has_head, switches[hl], 0)
    head[..., 1] = np.clip(np.round((vx + gb) / (2 * gb) * 255), 0, 255)
    head[..., 2] = np.clip(np.round((vz + gb) / (2 * gb) * 255), 0, 255)
    head[..., 3] = np.where(has_head, y_byte(hy), 0)
    stats = dict(texels_in_a_pool_12m=int((rho_out < 12).sum()), texels_with_a_head=int(has_head.sum()))
    return dict(pool=pool, head=head, rho=rho_out, rho_lamp=rho_lamp, head_lamp=np.where(has_head, head_lamp, -1),
                axis=axis, stats=stats)


# ---------------------------------------------------------------- output
def header(count):
    return HEADER.pack(MAGIC, VERSION, P["size"], P["warp_m"], P["extent_m"], P["pool_range_m"], P["head_range_m"],
                       P["head_y_range"][0], P["head_y_range"][1], SWITCH_RANGE[0], SWITCH_RANGE[1],
                       P["door_pool_scale"], P["pool_stretch"], count)


def published_lamp(lamp):
    return {
        "id": lamp["id"], "objectid": lamp["objectid"], "source": lamp["source"], "kind": lamp["kind"],
        "head": lamp["head"], "foot_y": lamp["foot_y"], "heading": lamp["heading"], "reach": lamp["reach"],
        "fitting": lamp["fitting"], "height_source": lamp["height_source"],
        "switch_altitude": lamp["switch_altitude"], "snap_shift": lamp["snap_shift"],
    }


def write(out_dir, args, model, lamps, counts, maps):
    out_dir.mkdir(parents=True, exist_ok=True)
    blob = header(len(lamps)) + maps["pool"].tobytes() + maps["head"].tobytes()
    (out_dir / LIGHT_FILE).write_bytes(blob)
    lamps_doc = json.loads(args.lamps.read_text(encoding="utf-8"))
    kinds = {k: sum(1 for l in lamps if l["kind"] == k) for k in ("bracket", "column", "door")}
    doc = {
        "schema": "venviewer.street-light.v2",
        "title": "Street lighting round the Grand Hall, Trades Hall, Glasgow, for the city model at night",
        "licence": {
            "attribution": lamps_doc["licence"]["attribution"],
            "licence": "Open Government Licence v3.0",
            "lidar": model.meta["licence"]["attribution"],
            "note": ("Positions only from Glasgow City Council's open Lighting Columns layer; brackets, heights and "
                     "throws derived here from the LiDAR model and our own facade survey. No attribute of the "
                     "council's Pub_Lighting_Columns layer is used."),
        },
        "frame": "the planner hall frame of merchant-city-v2.json (metres, y up)",
        "encoding": {
            "file": LIGHT_FILE,
            "header": ("56 bytes little-endian: 'VVSL', uint32 version=2, uint32 size, float32 warp_m, float32 extent_m, "
                       "float32 pool range (m), float32 head range (m), float32 y min, float32 y max, "
                       "float32 switch min (deg), float32 switch max (deg), float32 door pool scale, "
                       "float32 pool stretch, uint32 lamp count"),
            "texels": ("the pool map, then the head map: each size x size RGBA8, row v (planner z) by column u "
                       "(planner x), row 0 at z = -extent"),
            "warp": "u = (asinh(x / warp) / asinh(extent / warp) + 1) / 2, the same for v from z",
            "pool_map": {
                "R": "pool distance, metres / pool range x 255 (the nearest visible pool; 1.3x shorter along the street)",
                "G": "that pool's lamp's switching altitude: (deg - switch min) / (switch max - switch min) x 255",
                "B": "that lamp's foot y: 1 + (y - min) / (max - min) x 254",
                "A": "that pool's strength x 255",
                "fill": "every texel holds its nearest pool lamp's G, B and A",
            },
            "head_map": {
                "R": "the nearest visible head's switching altitude, as the pool map's G",
                "GB": "that head minus the texel's centre, x and z: (d + range) / (2 range) x 255",
                "A": "that head's y: 1 + (y - min) / (max - min) x 254; 0 = no head within range",
            },
        },
        "method": __doc__.strip(),
        "parameters": P,
        "excluded": {str(k): v for k, v in EXCLUDED.items()},
        "inputs": {
            "lamps": {"file": args.lamps.name, "sha256": sha256(args.lamps), "source": lamps_doc["source"]["query"],
                      "retrieved": lamps_doc["source"]["retrieved"]},
            "model": {"file": f"{MODEL_NAME}.bin", "sha256": sha256(args.model_dir / f"{MODEL_NAME}.bin")},
            "work": {"file": "_work.npz", "sha256": sha256(args.work)},
            "dsm": {"file": "heights_50cm.f32", "sha256": sha256(args.dsm_dir / "heights_50cm.f32")},
            "door_lanterns": DOOR_LANTERNS,
        },
        "counts": {
            "lamps": len(lamps), **kinds,
            "drawn": sum(1 for l in lamps if l["fitting"] == "drawn"),
            "cut": sorted(l["objectid"] for l in lamps if l["fitting"] == "cut"),
            "low_wall": sorted(l["objectid"] for l in lamps if l["fitting"] == "low-wall"),
            "under_a_low_wall": sorted(l["objectid"] for l in lamps if l["height_source"] == "model-wall"),
            "height_lidar": sum(1 for l in lamps if l["height_source"] == "lidar"),
            "large_snaps": [l["id"] for l in lamps if l["snap_shift"] > P["large_snap_m"]],
            "within_reach": counts["within_reach"], "excluded": counts["excluded"], "merged": counts["merged"],
            **maps["stats"],
        },
        "lamps": [published_lamp(l) for l in lamps],
    }
    (out_dir / LAMPS_FILE).write_bytes((json.dumps(doc, indent=1) + "\n").encode("utf-8"))


# ---------------------------------------------------------------- checks
class Fail(Exception):
    pass


def expect(cond, msg):
    if not cond:
        raise Fail(msg)
    print("  ok", msg)


class FlatSite:
    """a flat street with optional walls, in a frame where planner x = east and z = north"""
    def __init__(self):
        self.res, self.k = 0.5, 200
        self.surface = np.full((400, 400), -3.79)
        self.building = np.zeros((400, 400), dtype=bool)

    def cells(self, x, z):
        i = np.clip(np.floor(np.asarray(z) / 0.5 + 200).astype(np.int64), 0, 399)
        j = np.clip(np.floor(np.asarray(x) / 0.5 + 200).astype(np.int64), 0, 399)
        return i, j

    def cell(self, x, z):
        i, j = self.cells(x, z)
        return int(i), int(j)


def synthetic_checks():
    lamp = dict(head=[0.0, 4.21, 0.0], heading=[0.0, -1.0], kind="column")
    g = np.linspace(-20, 20, 801)
    X, Z = np.meshgrid(g, g)
    rho = pool_rho(lamp, X, Z)
    k = np.unravel_index(int(np.argmin(rho)), rho.shape)
    expect(abs(X[k]) < 0.06 and abs(Z[k] + P["pool_offset_m"]) < 0.06,
           f"a pool peaks {P['pool_offset_m']} m out along its throw (at {X[k]:.2f}, {Z[k]:.2f})")
    along = g[np.abs(pool_rho(lamp, g, np.full_like(g, -P["pool_offset_m"])) - 6) < 0.03]
    across = g[np.abs(pool_rho(lamp, np.zeros_like(g), g) - 6) < 0.03]
    ratio = (along.max() - along.min()) / (across.max() - across.min())
    expect(abs(ratio - P["pool_stretch"]) < 0.02, f"the pool is {ratio:.3f}x longer along the street than across it")
    site = FlatSite()
    site.surface[205:207, :] = 10.0          # a wall to y = 10, 2.5-3.5 m behind the lamp (z = +2.5..+3.5)
    tz = np.array([4.0, 6.0, 9.0])
    tx = np.zeros(3)
    expect(not visible(site, lamp, 0.0, 0.0, tx, tz, np.full(3, -3.79)).any(), "no light falls behind a wall")
    expect(visible(site, lamp, 0.0, 0.0, tx, -tz, np.full(3, -3.79)).all(), "light falls on the open side")
    bytes_ = [switch_byte(k) for k in range(1, 4001)]
    expect(min(bytes_) == 0 and max(bytes_) == 255 and switch_altitude(0) == SWITCH_RANGE[0]
           and switch_altitude(255) == SWITCH_RANGE[1], "the switching lattice spans -3.6..-2.4 in 256 steps")


def model_checks(model, lamps, maps, pub_path):
    ids = [l["id"] for l in lamps]
    expect(len(set(ids)) == len(ids), f"{len(ids)} lamp ids, all distinct")
    for l in lamps:
        if not all(math.isfinite(v) for v in [*l["head"], *l["heading"], l["foot_y"], l["switch_altitude"]]):
            raise Fail(f"{l['id']}: a value is not finite")
    expect(True, "every lamp value is finite")
    sw = [l["switch_altitude"] for l in lamps]
    expect(min(sw) >= -3.6 and max(sw) <= -2.4, f"switch altitudes lie in [{min(sw)}, {max(sw)}]")
    expect(all(l["switch_altitude"] == switch_altitude(l["switch_byte"]) for l in lamps),
           "every switching altitude lies on the maps' lattice")
    cut = {l["objectid"] for l in lamps if l["fitting"] == "cut"}
    expect(cut == EXPECTED_CUT, f"the site's cut takes {sorted(cut)}")
    low = {l["objectid"] for l in lamps if l["fitting"] == "low-wall"}
    expect(low == EXPECTED_LOW_WALL, f"the walls too low to carry a lantern carry {sorted(low)}")
    across = next(l for l in lamps if l["objectid"] == 24095)
    expect(across["fitting"] == "drawn", "24095, across Glassford Street, stands whole")
    hung = [l["head"][1] - l["foot_y"] for l in lamps if l["fitting"] == "drawn" and l["kind"] != "door"]
    expect(min(hung) >= P["lantern_min_m"] - 1e-6, f"every drawn street lantern hangs at least {min(hung):.2f} m up")
    tall = model.building_walls()
    worst = 0.0
    for l in lamps:
        if l["kind"] != "bracket":
            continue
        plate = np.array([l["head"][0], l["head"][2]]) - np.array(l["heading"]) * l["reach"]
        d, _, _ = model.nearest_wall(plate[0], plate[1], tall)
        worst = max(worst, d)
    expect(worst <= 0.1, f"every bracket's wall plate sits on a model wall (worst {worst:.3f} m)")
    worst = 0.0
    for l in lamps:
        if l["kind"] != "column":
            continue
        g = model.ground_at(l["head"][0], l["head"][2])
        if g is None:
            raise Fail(f"{l['id']}: no drawn ground under the column")
        worst = max(worst, abs(g - l["foot_y"]))
    expect(worst <= 0.05, f"every column foot stands on the model's ground (worst {worst:.3f} m)")
    rho_float = maps["rho"]
    expect(not np.isnan(rho_float).any(), "the float bake has no NaN")
    pool, head = maps["pool"], maps["head"]
    decoded = pool[..., 0].astype(np.float64) / 255 * P["pool_range_m"]
    edge = (rho_float > 4.0) & (rho_float < 8.0)
    err = np.abs(decoded - rho_float)[edge].max() * P["pool_stretch"]
    expect(err <= 0.1, f"8-bit pool edges lie within {err:.3f} m of the float bake")
    # Each pool's own texels carry its lamp's switch and foot; each head texel its lamp's switch.
    rho_lamp, head_lamp = maps["rho_lamp"], maps["head_lamp"]
    lit = (rho_lamp >= 0) & (rho_float < 6.0)
    li = rho_lamp[lit]
    expect(np.array_equal(pool[..., 1][lit], np.array([lamps[k]["switch_byte"] for k in li], dtype=np.uint8)),
           f"every pool texel ({int(lit.sum())}) carries its lamp's switch")
    lo, hi = P["head_y_range"]
    foot = lo + (pool[..., 2][lit].astype(np.float64) - 1) / 254 * (hi - lo)
    ferr = np.abs(foot - np.array([lamps[k]["foot_y"] for k in li])).max()
    expect(ferr <= (hi - lo) / 254 / 2 + 1e-6, f"every pool texel carries its lamp's foot (within {ferr:.3f} m)")
    seen = head_lamp >= 0
    expect(np.array_equal(head[..., 0][seen], np.array([lamps[k]["switch_byte"] for k in head_lamp[seen]], dtype=np.uint8)),
           f"every head texel ({int(seen.sum())}) carries its lamp's switch")
    if pub_path is not None:
        attrs = {f["attributes"]["OBJECTID"]: f["attributes"]
                 for f in json.loads(pub_path.read_text(encoding="utf-8"))["features"]}
        agree = total = 0
        for l in lamps:
            ct = (attrs.get(l["objectid"]) or {}).get("COLUMN_TYPE") or ""
            if l["objectid"] not in attrs or ct.startswith(("Secondary", "Uplighter")) or ct in ("", "?"):
                continue
            total += 1
            agree += (l["kind"] == "bracket") == ct.startswith("Wall")
        expect(agree / total >= 0.95, f"the classification agrees with the council's types for {agree} of {total}")
        # Local only: how near the derived column heights come to the council's (nothing of it is written).
        off = [abs((l["head"][1] - l["foot_y"]) - float(attrs[l["objectid"]]["COLUMN_HEIGHT"]))
               for l in lamps if l["kind"] == "column" and l["objectid"] in attrs
               and attrs[l["objectid"]].get("COLUMN_HEIGHT") not in (None, "", 0)]
        print(f"  note: column heights within 1 m of the council's for {sum(d <= 1 for d in off)} of {len(off)}, "
              f"mean error {sum(off) / max(1, len(off)):.2f} m")
    else:
        print("  skipped: the classification check against the council's types (no --pub)")


def run(args, out_dir):
    model = Model(args.model_dir, args.work)
    lamps_doc = json.loads(args.lamps.read_text(encoding="utf-8"))
    lamps, counts = build_lamps(model, lamps_doc, args.dsm_dir)
    maps = bake(model, lamps)
    write(out_dir, args, model, lamps, counts, maps)
    return model, lamps, maps


def main():
    args = parse_args()
    if args.facade is not None:
        fac = json.loads(args.facade.read_text(encoding="utf-8"))
        door = next(b for b in fac["bays"] if b.get("id") == "temple-front")["door"]["lamps"]
        survey = (abs(door["u"][1]["v"]), door["z_bottom"]["v"], door["z_top"]["v"], door["width"]["v"])
        expected = (DOOR_LANTERNS["u"], DOOR_LANTERNS["z_bottom"], DOOR_LANTERNS["z_top"], DOOR_LANTERNS["width"])
        if survey != expected:
            raise SystemExit(f"DOOR_LANTERNS {expected} differ from the facade survey {survey}")
        print("door lanterns agree with the facade survey")
    model, lamps, maps = run(args, args.out_dir)
    kinds = {k: sum(1 for l in lamps if l["kind"] == k) for k in ("bracket", "column", "door")}
    print(f"{len(lamps)} lamps {kinds}, cut {sorted(l['objectid'] for l in lamps if l['fitting'] == 'cut')}, "
          f"low wall {sorted(l['objectid'] for l in lamps if l['fitting'] == 'low-wall')}")
    for l in lamps:
        if l["flags"]:
            print("  ", l["id"], l["kind"], "; ".join(l["flags"]))
    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            run(args, Path(tmp))
            for name in (LIGHT_FILE, LAMPS_FILE):
                same = (Path(tmp) / name).read_bytes() == (args.out_dir / name).read_bytes()
                expect(same, f"{name} rebuilds byte for byte")
        try:
            synthetic_checks()
            model_checks(model, lamps, maps, args.pub)
        except Fail as failure:
            print("FAILED:", failure)
            sys.exit(1)
        print("all checks passed")


if __name__ == "__main__":
    main()
