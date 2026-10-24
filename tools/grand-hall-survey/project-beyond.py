"""Photographs of what lies just beyond the Grand Hall's doors, for the planner's Ashlar section.

Projects the public 8K panoramas of the stations beyond the end and main doors onto four surfaces,
measured by measure/beyond-doors.py and hall-spec.ts:

- the Saloon's floor beyond the end door (herringbone oak), at the scan's floor level there;
- the landing beyond the main door, with the inlaid TRADES HALL and crest, at its level;
- the end door's and the main door's linings (both jambs and the head, through the wall's depth),
  unrolled as hall-beyond.ts reads them.

Stations: scan_048 (in the end doorway), scan_049 and scan_050 (the Saloon), scan_018 (just
beyond the main door), scan_075 and scan_076 (the corridor either side of it), and for the
linings the hall's stations in front of each door (scan_000; scan_016, 017 and 019). scan_147 (the
landing) is read but not used: its pose puts the inlay 15 cm from where the other three stations
agree. Each panorama is checked against the manifest's SHA-256 before use. Colour, exposure,
weights and the second (consensus) and glare passes are project.py's. These stations have no
depth cubemaps (render-depth.mjs renders the hall's 49), so occlusion is found here on the CPU,
the same way: each station's distance to the dollhouse mesh is rendered into an equirectangular
map (0.25 degrees; the mesh's triangles near the station, sampled densely enough to leave no
gaps), and a texel counts only where the nearest stored distance of the 3 x 3 cells around its
direction is not shorter than its own, less project.py's tolerance.

Writes the atlas (832 x 640, half size for phones) and beyond-atlas.json (each surface's pixels,
its world mapping, stations, coverage and median colour, which hall-beyond.ts uses before the
image arrives).

Usage (in the work directory, which holds data/manifest.json, data/pano8k/ and data/mesh/):
    python3 $SURVEY/project-beyond.py --beyond $SURVEY/measure/beyond-doors.json --out proj
Requirements: numpy, scipy, Pillow (WebP).
"""
import argparse
import hashlib
import json
import os
import sys
import time

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project import DATA, linear_to_srgb, load_pano, nadir_weight, sample_pano, srgb_to_linear  # noqa: E402

HL, HW = 21.135 / 2, 10.59 / 2
DEPTH_W, DEPTH_H = 1440, 720
DEPTH_STEP = 2 * np.pi / DEPTH_W
ATLAS = (832, 640)

STATIONS = ["scan_000", "scan_016", "scan_017", "scan_018", "scan_019", "scan_048", "scan_049", "scan_050", "scan_075", "scan_076", "scan_147"]


def to_e57(p):
    """Planner (x, y, z) -> E57 (X, Y, Z)."""
    p = np.asarray(p, float)
    return np.stack([8.795 - p[..., 0], p[..., 2] - 4.963, p[..., 1] + 0.045], axis=-1)


def direction_to_e57(n):
    """A planner direction in the E57 frame."""
    n = np.asarray(n, float)
    return np.stack([-n[..., 0], n[..., 2], n[..., 1]], axis=-1)


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def load_stations(manifest):
    out = {}
    for node in manifest["nodes"]:
        if node["id"] in STATIONS:
            g = node["exposure"]["gain"]
            wb = node["exposure"]["wb"]
            out[node["id"]] = {"id": node["id"], "t": np.array(node["pose"]["t"], float), "gain": np.array([g * wb[0], g * wb[1], g * wb[2]])}
    return out


def check_panoramas(manifest):
    hashes = manifest["contentHashes"]
    for sid in STATIONS:
        path = os.path.join(DATA, "pano8k", f"{sid}_8192.webp")
        expected = hashes.get(f"tiles/{sid}/equirect_8192.webp")
        if expected is None or sha256(path) != expected:
            sys.exit(f"{path} is not the manifest's panorama")


def load_mesh():
    pos = np.fromfile(os.path.join(DATA, "mesh", "positions.f32"), dtype=np.float32).reshape(-1, 3).astype(np.float64)
    idx = np.fromfile(os.path.join(DATA, "mesh", "indices.u32"), dtype=np.uint32).reshape(-1, 3)
    return pos, idx


def depth_map(station, pos, idx, lo, hi):
    """Distance from the station to the mesh in every 0.25 degree cell of an equirectangular map
    (az = atan2(Y, X), elevation up), from the triangles that meet the box [lo, hi] (E57). Each
    triangle is sampled on a barycentric grid fine enough that neighbouring samples fall less
    than half a cell apart, so it leaves no gap."""
    a, b, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    tmin = np.minimum(np.minimum(a, b), c)
    tmax = np.maximum(np.maximum(a, b), c)
    keep = np.all(tmax >= lo, axis=1) & np.all(tmin <= hi, axis=1)
    depth = np.full(DEPTH_W * DEPTH_H, np.inf, np.float32)
    S = station["t"]
    for A, B, C in zip(a[keep], b[keep], c[keep]):
        near = max(1e-3, min(np.linalg.norm(A - S), np.linalg.norm(B - S), np.linalg.norm(C - S)))
        edge = max(np.linalg.norm(B - A), np.linalg.norm(C - B), np.linalg.norm(A - C))
        n = int(min(400, max(1, np.ceil(edge / (0.45 * near * DEPTH_STEP)))))
        i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1))
        m = i + j <= n
        u = (i[m] / n)[:, None]
        v = (j[m] / n)[:, None]
        p = A + (B - A) * u + (C - A) * v - S
        d = np.linalg.norm(p, axis=1)
        az = np.arctan2(p[:, 1], p[:, 0]) % (2 * np.pi)
        el = np.arcsin(np.clip(p[:, 2] / np.maximum(d, 1e-9), -1, 1))
        col = np.minimum(DEPTH_W - 1, (az / DEPTH_STEP).astype(int))
        row = np.clip(((np.pi / 2 - el) / DEPTH_STEP).astype(int), 0, DEPTH_H - 1)
        np.minimum.at(depth, row * DEPTH_W + col, d.astype(np.float32))
    return depth.reshape(DEPTH_H, DEPTH_W)


def depth_lookup(depth, v):
    """The nearest stored distance of the 3 x 3 cells around each direction v (N, 3)."""
    d = np.linalg.norm(v, axis=1)
    az = np.arctan2(v[:, 1], v[:, 0]) % (2 * np.pi)
    el = np.arcsin(np.clip(v[:, 2] / np.maximum(d, 1e-9), -1, 1))
    col = np.minimum(DEPTH_W - 1, (az / DEPTH_STEP).astype(int))
    row = np.clip(((np.pi / 2 - el) / DEPTH_STEP).astype(int), 0, DEPTH_H - 1)
    best = np.full(len(v), np.inf, np.float32)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            best = np.minimum(best, depth[np.clip(row + dr, 0, DEPTH_H - 1), (col + dc) % DEPTH_W])
    return best


def samples(station, depth, points, normals, cos_min, p_cos, q_dist, max_dist, nadir):
    v = points - station["t"]
    dist = np.linalg.norm(v, axis=1)
    cos = -np.einsum("ij,ij->i", v, normals) / np.maximum(dist, 1e-6)
    idx = np.nonzero((cos > cos_min) & (dist < max_dist))[0]
    if len(idx) == 0:
        return None
    d = dist[idx]
    tol = 0.035 + 0.008 * d / np.maximum(cos[idx], 0.25)
    idx = idx[depth_lookup(depth, v[idx]) >= d - tol]
    if len(idx) == 0:
        return None
    col = srgb_to_linear(sample_pano(load_pano(station["id"]), v[idx])) * station["gain"][None, :]
    w = (cos[idx] ** p_cos) / (dist[idx] ** q_dist)
    if nadir:
        w = w * nadir_weight(station["id"], v[idx])
    return idx, col, w


def project(points, normals, stations, depths, cos_min=0.2, p_cos=4.0, q_dist=3.0, max_dist=12.0, nadir=False, glare=0):
    """project.py's blend (weights, the consensus pass, the glare passes) with this occlusion."""
    n = len(points)
    cache = {}
    for st in stations:
        res = samples(st, depths[st["id"]], points, normals, cos_min, p_cos, q_dist, max_dist, nadir)
        if res is not None:
            cache[st["id"]] = res
    acc = np.zeros((n, 3))
    wsum = np.zeros(n)
    used = {}
    for sid, (idx, col, w) in cache.items():
        acc[idx] += col * w[:, None]
        wsum[idx] += w
        used[sid] = int(len(idx))
    mean = acc / np.maximum(wsum, 1e-12)[:, None]
    luma = np.array([0.2126, 0.7152, 0.0722])
    acc2 = np.zeros((n, 3))
    wsum2 = np.zeros(n)
    for idx, col, w in cache.values():
        m = mean[idx]
        diff = np.abs((col - m) @ luma) + 0.5 * np.abs(col - m).max(axis=1)
        agree = np.exp(-(diff / (0.02 + 0.2 * (m @ luma))) ** 2)
        acc2[idx] += col * (w * (agree + 1e-4))[:, None]
        wsum2[idx] += w * (agree + 1e-4)
    out = np.where(wsum2[:, None] > 0, acc2 / np.maximum(wsum2, 1e-12)[:, None], mean)
    for _ in range(glare):
        acc3 = np.zeros((n, 3))
        wsum3 = np.zeros(n)
        for idx, col, w in cache.values():
            m = out[idx]
            brighter = np.maximum(0.0, (col - m) @ luma)
            agree = np.exp(-(brighter / (0.01 + 0.12 * (m @ luma))) ** 2)
            acc3[idx] += col * (w * (agree + 1e-4))[:, None]
            wsum3[idx] += w * (agree + 1e-4)
        out = np.where(wsum3[:, None] > 0, acc3 / np.maximum(wsum3, 1e-12)[:, None], out)
    return out, wsum, used


def floor_surface(name, x0, x1, z0, z1, level, ppm, stations, at):
    w = int(np.ceil((x1 - x0) * ppm))
    h = int(np.ceil((z1 - z0) * ppm))
    X, Z = np.meshgrid(x0 + (np.arange(w) + 0.5) / ppm, z0 + (np.arange(h) + 0.5) / ppm)
    pts = np.stack([X, np.full_like(X, level), Z], axis=-1).reshape(-1, 3)
    nrm = np.tile([0.0, 1.0, 0.0], (len(pts), 1))
    return {"name": name, "kind": "floor", "w": w, "h": h, "points": pts, "normals": nrm, "stations": stations, "rect": [at[0], at[1], w, h],
            "map": {"x0": x0, "z0": z0, "y": level, "ppm": ppm, "columns": "x from x0", "rows": "z from z0"}}


def lining_surface(name, door, ppm, stations, at):
    """A doorway's lining in the door wall, unrolled: rows s along the perimeter (the jamb at its
    lower-u edge from the floor up, the head from lower to higher u, the other jamb from the head
    down), columns t the depth behind the hall's face."""
    u0, u1, head, depth = door["u0"], door["u1"], door["head"], door["depth"]
    width = u1 - u0
    w = int(np.ceil(depth * ppm))
    h = int(np.ceil((2 * head + width) * ppm))
    T, S = np.meshgrid((np.arange(w) + 0.5) / ppm, (np.arange(h) + 0.5) / ppm)
    pts = np.zeros(T.shape + (3,))
    nrm = np.zeros(T.shape + (3,))
    left = S < head
    top = (S >= head) & (S < head + width)
    right = S >= head + width
    # Door wall: x = HL - u, its plane z = HW, behind it +z.
    pts[..., 2] = HW + T
    pts[left, 0] = HL - u0
    pts[left, 1] = S[left]
    nrm[left] = (-1.0, 0.0, 0.0)  # the jamb at the lower-u (higher-x) edge faces -x, into the opening
    pts[top, 0] = HL - (u0 + (S[top] - head))
    pts[top, 1] = head
    nrm[top] = (0.0, -1.0, 0.0)
    pts[right, 0] = HL - u1
    pts[right, 1] = head - (S[right] - head - width)
    nrm[right] = (1.0, 0.0, 0.0)
    return {"name": name, "kind": "lining", "w": w, "h": h, "points": pts.reshape(-1, 3), "normals": nrm.reshape(-1, 3), "stations": stations,
            "rect": [at[0], at[1], w, h],
            "map": {"u0": u0, "u1": u1, "head": head, "depth": depth, "ppm": ppm,
                    "rows": "s: the lower-u jamb from the floor up, the head toward higher u, the higher-u jamb from the head down", "columns": "t: depth behind the hall's face"}}


# The Saloon's single leaf as the scan has it, standing open over the floor: from its hinge to its
# free edge (planner x, z), from horizontal sections of the mesh at 0.3-1.8 m (z = 1.047 x - 3.263).
LEAF = ((9.262, 6.435), (10.222, 7.439))


def herringbone_fill(img, seen, ppm, x0, z0, region):
    """Fills the Saloon's floor where the scan's open leaf hid it (unseen texels inside `region`,
    x0 <= x <= x1 and z <= z1, metres) with the same boards further into the room. The
    herringbone's columns run along z, so a copy a whole number of its teeth further along z lands
    in phase: the pitch is the strongest autocorrelation of the high-passed floor along z between
    8 and 20 cm; of the shifts by 6 to 10 teeth (each refined by a texel either way), the one whose
    copy best correlates with the seen floor in a band round the region is used, its colour scaled
    to the band's."""
    h, w = seen.shape
    lum = img @ np.array([0.2126, 0.7152, 0.0722])
    hole = hole_mask(img, seen, ppm, x0, z0, region)
    if not hole.any():
        return img, hole, 0, 0
    hp = lum - ndimage.gaussian_filter(lum, 5)
    return _fill(img, seen, hole, hp, ppm, h, w)


def hole_mask(img, seen, ppm, x0, z0, region):
    """What the scan's open Saloon leaf hid or darkened, within `region` (x0 <= x <= x1, z <= z1)."""
    h, w = seen.shape
    X, Z = np.meshgrid(x0 + (np.arange(w) + 0.5) / ppm, z0 + (np.arange(h) + 0.5) / ppm)
    lum = img @ np.array([0.2126, 0.7152, 0.0722])
    inside = (X >= region[0]) & (X <= region[1]) & (Z <= region[2])
    # Unseen, within 6 cm of the leaf as the mesh has it (seen past its foot, the floor there
    # carries the leaf's colour), or far darker than the floor (the leaf's shadow and its stop).
    leaf = LEAF
    along = np.clip(((X - leaf[0][0]) * (leaf[1][0] - leaf[0][0]) + (Z - leaf[0][1]) * (leaf[1][1] - leaf[0][1]))
                    / ((leaf[1][0] - leaf[0][0]) ** 2 + (leaf[1][1] - leaf[0][1]) ** 2), 0, 1)
    near_leaf = np.hypot(X - (leaf[0][0] + along * (leaf[1][0] - leaf[0][0])), Z - (leaf[0][1] + along * (leaf[1][1] - leaf[0][1]))) < 0.06
    dark = lum < 0.4 * np.median(lum[seen])
    return inside & (~seen | near_leaf | dark)


def _fill(img, seen, hole, hp, ppm, h, w):

    def ncc(a, b):
        a, b = a - a.mean(), b - b.mean()
        return float((a * b).mean() / np.sqrt(max((a * a).mean() * (b * b).mean(), 1e-12)))

    rows, cols = slice(int(0.1 * h), int(0.5 * h)), slice(int(0.25 * w), int(0.6 * w))

    def along(shift):
        m = seen[rows, cols] & seen[rows.start + shift:rows.stop + shift, cols]
        return ncc(hp[rows, cols][m], hp[rows.start + shift:rows.stop + shift, cols][m])

    pitch = max(range(int(0.08 * ppm), int(0.2 * ppm) + 1), key=along)
    ring = ndimage.binary_dilation(hole, iterations=8) & ~hole & seen
    rr, rc = np.nonzero(ring)
    hr, hc = np.nonzero(hole)
    best = None
    for k in range(6, 11):
        for shift in (k * pitch - 1, k * pitch, k * pitch + 1):
            if max(hr.max(), rr.max()) + shift >= h:
                continue
            ok = seen[rr + shift, rc] & seen[hr.max() // 2 + shift, rc].astype(bool)
            score = ncc(hp[rr[ok], rc[ok]], hp[rr[ok] + shift, rc[ok]])
            if best is None or score > best[0]:
                best = (score, shift)
    if best is None:
        return img, np.zeros_like(hole), pitch, 0
    shift = best[1]
    gain = img[ring].mean(axis=0) / np.maximum(img[rr + shift, rc].mean(axis=0), 1e-6)
    out = img.copy()
    # Only from floor some station saw; the rest takes its nearest neighbour, as any unseen texel.
    usable = seen[hr + shift, hc] & ~hole[hr + shift, hc]
    out[hr[usable], hc[usable]] = img[hr[usable] + shift, hc[usable]] * gain
    copied = np.zeros_like(hole)
    copied[hr[usable], hc[usable]] = True
    return out, copied, pitch, shift


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--beyond", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    manifest = json.load(open(os.path.join(DATA, "manifest.json")))
    check_panoramas(manifest)
    stations = load_stations(manifest)
    beyond = {d["opening"]: d for d in json.load(open(args.beyond))["doors"]}
    pos, idx = load_mesh()
    door_u = lambda scan_x: HL - 8.795 + scan_x  # hall-spec.ts doorU
    doorway = lambda centre, width, depth: {"u0": centre - width / 2, "u1": centre + width / 2, "head": 2.35, "depth": depth}
    bounds = lambda poly: (min(p[0] for p in poly), max(p[0] for p in poly), min(p[1] for p in poly), max(p[1] for p in poly))
    end, main_ = beyond["door-end"], beyond["door-main"]
    ex0, ex1, ez0, ez1 = bounds(end["floor"])
    mx0, mx1, mz0, mz1 = bounds(main_["floor"])
    surfaces = [
        floor_surface("saloon-floor", ex0, ex1, ez0, ez1, end["floorLevel"], 120, ["scan_048", "scan_049", "scan_050"], (0, 0)),
        # scan_147's projection lands the inlay 15 cm from where the other three agree (its pose,
        # 0.24 m higher than theirs, is suspect), so the landing and the main door's lining are theirs.
        floor_surface("landing-floor", mx0, mx1, mz0, mz1, main_["floorLevel"], 120, ["scan_018", "scan_075", "scan_076"], (0, 296)),
        # The linings are also seen from inside the hall, from the stations before each door.
        lining_surface("end-door-lining", doorway(door_u(-0.025), 1.1, 1.14), 100, ["scan_000", "scan_048", "scan_049"], (588, 0)),
        lining_surface("main-door-lining", doorway(door_u(8.79), 1.45, 1.09), 100, ["scan_016", "scan_017", "scan_018", "scan_019", "scan_075", "scan_076"], (708, 0)),
    ]
    atlas = np.zeros((ATLAS[1], ATLAS[0], 3), np.float32)
    filled = np.zeros((ATLAS[1], ATLAS[0]), bool)
    seen_masks = {}
    report = []
    for surface in surfaces:
        t0 = time.time()
        pts = to_e57(surface["points"])
        normals = direction_to_e57(surface["normals"])
        sts = [stations[s] for s in surface["stations"]]
        lo = np.minimum(pts.min(axis=0), np.min([s["t"] for s in sts], axis=0)) - 0.5
        hi = np.maximum(pts.max(axis=0), np.max([s["t"] for s in sts], axis=0)) + 0.5
        depths = {s["id"]: depth_map(s, pos, idx, lo, hi) for s in sts}
        if surface["kind"] == "floor":
            rgb, wsum, used = project(pts, normals, sts, depths, cos_min=0.12, p_cos=2.0, q_dist=2.0, nadir=True, glare=1)
        else:
            rgb, wsum, used = project(pts, normals, sts, depths, cos_min=0.15)
        w, h = surface["w"], surface["h"]
        img = rgb.reshape(h, w, 3)
        seen = (wsum > 0).reshape(h, w)
        seen_masks[surface["name"]] = seen
        if surface["name"] == "saloon-floor":
            # The Saloon's single leaf stood open over its floor in the scan (46 degrees, from the
            # hinge at x 9.37 to x 10.26, z 7.44); the planner swings it to 90, so the floor it hid shows.
            ppm, x0, z0, region = surface["map"]["ppm"], surface["map"]["x0"], surface["map"]["z0"], (9.2, 11.3, 7.6)
            hidden = hole_mask(img, seen, ppm, x0, z0, region)
            img, copied, pitch, shift = herringbone_fill(img, seen, ppm, x0, z0, region)
            surface["edit"] = (f"the floor the open Saloon leaf hid or darkened ({int(hidden.sum())} texels, x 9.2-11.3, z under 7.6): "
                               f"{int(copied.sum())} from the same boards {shift / ppm:.3f} m further along z ({round(shift / pitch)} teeth of "
                               f"{pitch / ppm * 1000:.0f} mm), colour matched, the rest from their nearest neighbours")
            seen = (seen & ~hidden) | copied
        # Texels no station saw take their nearest seen neighbour.
        if not seen.all() and seen.any():
            _, (ri, ci) = ndimage.distance_transform_edt(~seen, return_indices=True)
            img = img[ri, ci]
        x, y = surface["rect"][0], surface["rect"][1]
        atlas[y:y + h, x:x + w] = img
        filled[y:y + h, x:x + w] = True
        srgb = linear_to_srgb(img.reshape(-1, 3))
        report.append({k: surface[k] for k in ("name", "kind", "rect", "map", "stations")} | ({"edit": surface["edit"]} if "edit" in surface else {}) | {
            "stationsSeeing": used, "coverage": round(float(seen.mean()), 4),
            "medianSrgb": [int(round(float(np.median(srgb[:, k])))) for k in range(3)]})
        print(surface["name"], w, "x", h, "coverage", round(float(seen.mean()), 4), used, round(time.time() - t0, 1), "s", flush=True)
    # Gutters: each region's edge texels carried outward, so filtering and mip levels never mix regions.
    _, (ri, ci) = ndimage.distance_transform_edt(~filled, return_indices=True)
    atlas = atlas[ri, ci]
    image = Image.fromarray(np.clip(linear_to_srgb(atlas.reshape(-1, 3)), 0, 255).reshape(atlas.shape).astype(np.uint8))
    files = {}
    for size in (ATLAS, (ATLAS[0] // 2, ATLAS[1] // 2)):
        path = os.path.join(args.out, f"beyond-{size[0]}.webp")
        (image if size == ATLAS else image.resize(size, Image.LANCZOS)).save(path, quality=88, method=6)
        files[os.path.basename(path)] = {"size": list(size), "bytes": os.path.getsize(path), "sha256": sha256(path)}
    np.savez_compressed(os.path.join(args.out, "beyond-seen.npz"), **seen_masks)
    with open(os.path.join(args.out, "beyond-atlas.json"), "w") as f:
        json.dump({"version": 1, "atlas": list(ATLAS), "files": files, "surfaces": report,
                   "occlusion": f"CPU distance maps from the dollhouse mesh, {DEPTH_W} x {DEPTH_H} equirectangular, nearest of 3 x 3 cells"}, f, indent=1)
    print(json.dumps(files, indent=1))


if __name__ == "__main__":
    main()
