"""Per-room floor census of the staged SOG tiles: where the finest-level Gaussians' floor sits
against the manifest's floor (scene y = 0).

The viewer draws Gaussians, not the vendor mesh, so this is the datum that matters. Decodes each
tile exactly as Spark's spark-lib/src/sogs.rs does (means: 16-bit from means_l + means_u<<8,
min/max, then sign(m)*(exp|m|-1)), moves the centres into the scene frame with the manifest
transform (rotation [-pi/2, 0, 0] then position), and prints the densest 2 cm slab per room.

  python tools/xgrids-lcc2/scripts/sog-floor-census.py [--manifest <generated .ts>] [--root D:/claude/splats/trades-hall]

Measured 2026-09-04 (offsets above the manifest floor): grand-hall +0.55, reception-room +0.51,
north-gallery +0.61, south-gallery +0.47, deacon-conveners +0.07, saloon +0.05, lady-convenors +0.05,
robert-adam-room +0.01. Requires numpy and Pillow (WebP support).
"""
import io, json, math, os, sys, time, zipfile
import numpy as np
from PIL import Image


def load_img(z, name):
    return np.asarray(Image.open(io.BytesIO(z.read(name))).convert("RGBA"), dtype=np.uint8)

def decode_tile(path):
    z = zipfile.ZipFile(path)
    meta = json.loads(z.read("meta.json"))
    assert meta["version"] == 2, meta.get("version")
    n = int(meta["count"])
    ml = load_img(z, meta["means"]["files"][0]).reshape(-1, 4)[:n]
    mu = load_img(z, meta["means"]["files"][1]).reshape(-1, 4)[:n]
    mins = np.array(meta["means"]["mins"], dtype=np.float64)
    maxs = np.array(meta["means"]["maxs"], dtype=np.float64)
    v = (ml[:, :3].astype(np.uint32) | (mu[:, :3].astype(np.uint32) << 8)).astype(np.float64) / 65535.0
    m = mins + (maxs - mins) * v
    centers = np.sign(m) * (np.exp(np.abs(m)) - 1.0)
    sc_img = load_img(z, meta["scales"]["files"][0]).reshape(-1, 4)[:n]
    codebook = np.exp(np.array(meta["scales"]["codebook"], dtype=np.float64))
    scales = codebook[sc_img[:, :3]]
    q_img = load_img(z, meta["quats"]["files"][0]).reshape(-1, 4)[:n]
    lut = (np.arange(256, dtype=np.float64) / 255.0 - 0.5) * math.sqrt(2)
    r0, r1, r2 = lut[q_img[:, 0]], lut[q_img[:, 1]], lut[q_img[:, 2]]
    rr = np.sqrt(np.maximum(0.0, 1.0 - (r0 * r0 + r1 * r1 + r2 * r2)))
    order = q_img[:, 3].astype(np.int32) - 252
    qx = np.where(order == 0, r0, np.where(order == 1, rr, r1))
    qy = np.where(order <= 1, r1, np.where(order == 2, rr, r2))
    qz = np.where(order <= 2, r2, rr)
    qw = np.where(order == 0, rr, r0)
    quats = np.stack([qx, qy, qz, qw], axis=1)
    sh0 = load_img(z, meta["sh0"]["files"][0]).reshape(-1, 4)[:n]
    opacity = sh0[:, 3].astype(np.float64) / 255.0
    return centers, scales, quats, opacity, meta

def quat_to_rot(q):
    x, y, z, w = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    R = np.empty((q.shape[0], 3, 3), dtype=np.float64)
    R[:, 0, 0] = 1 - 2 * (y * y + z * z); R[:, 0, 1] = 2 * (x * y - z * w);     R[:, 0, 2] = 2 * (x * z + y * w)
    R[:, 1, 0] = 2 * (x * y + z * w);     R[:, 1, 1] = 1 - 2 * (x * x + z * z); R[:, 1, 2] = 2 * (y * z - x * w)
    R[:, 2, 0] = 2 * (x * z - y * w);     R[:, 2, 1] = 2 * (y * z + x * w);     R[:, 2, 2] = 1 - 2 * (x * x + y * y)
    return R

def pct(a, ps=(10, 50, 90)):
    if a.size == 0: return None
    return {f"p{p}": round(float(np.percentile(a, p)), 4) for p in ps}

def band_stats(mask, centers, scales, opacity, up_align, proj):
    idx = np.flatnonzero(mask)
    s = scales[idx]
    smax = s.max(axis=1); smin = s.min(axis=1); sgeo = np.cbrt(s[:, 0] * s[:, 1] * s[:, 2])
    out = {
        "count": int(idx.size),
        "opaqueCount": int((opacity[idx] > 0.5).sum()),
        "scaleMaxM": pct(smax), "scaleMidM": pct(np.median(s, axis=1)), "scaleMinM": pct(smin), "scaleGeoM": pct(sgeo),
        "flatness_minOverMax": pct(smin / np.maximum(smax, 1e-9)),
        "opacity": pct(opacity[idx]),
        "thinAxisAlignedToUp_absCos": pct(up_align[idx]),
    }
    if proj is not None:
        pm = proj["mask"][idx]
        j = idx[pm]
        out["inView"] = int(j.size)
        if j.size:
            out["projMajorSigmaPx"] = pct(proj["major"][j])
            out["projMinorSigmaPx"] = pct(proj["minor"][j])
            out["projDiameterMajorPx_atMaxStdDev"] = pct(2 * MAX_STD_DEV * proj["major"][j])
            out["depthM"] = pct(proj["depth"][j])
    return out

def project(centers_s, R_world, scales):
    """EWA projection at the spawn pose (yaw 0, pitch 0): camera axes = world axes, looking -z."""
    t = centers_s - CAM
    depth = -t[:, 2]
    x_ndc = np.where(depth > 0.05, t[:, 0] / np.maximum(depth, 0.05), np.inf)
    y_ndc = np.where(depth > 0.05, t[:, 1] / np.maximum(depth, 0.05), np.inf)
    tan_v = math.tan(math.radians(FOV_DEG / 2)); tan_h = tan_v * ASPECT
    mask = (depth > 0.2) & (np.abs(x_ndc) < tan_h) & (np.abs(y_ndc) < tan_v)
    n = centers_s.shape[0]
    major = np.zeros(n); minor = np.zeros(n)
    j = np.flatnonzero(mask)
    if j.size:
        S = scales[j]
        Rw = R_world[j]
        RS = Rw * S[:, None, :]                     # Sigma_world = R diag(s^2) R^T
        Sigma = RS @ np.transpose(RS, (0, 2, 1))
        tx = t[j, 0]; ty = t[j, 1]; dz = depth[j]
        J = np.zeros((j.size, 2, 3))                # u = f x / depth, v = f y / depth
        J[:, 0, 0] = F_PX / dz; J[:, 0, 2] = F_PX * tx / (dz ** 2)
        J[:, 1, 1] = F_PX / dz; J[:, 1, 2] = F_PX * ty / (dz ** 2)
        S2 = J @ Sigma @ np.transpose(J, (0, 2, 1))
        a = S2[:, 0, 0]; b = S2[:, 0, 1]; d = S2[:, 1, 1]
        tr = (a + d) / 2; det = a * d - b * b
        disc = np.sqrt(np.maximum(tr * tr - det, 0))
        major[j] = np.sqrt(np.maximum(tr + disc, 0)); minor[j] = np.sqrt(np.maximum(tr - disc, 0))
    return {"mask": mask, "major": major, "minor": minor, "depth": depth}


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=os.path.join(os.path.dirname(__file__), "..", "..", "..", "packages", "web", "src", "data", "generated", "trades-hall-splat-bundles.ts"))
    parser.add_argument("--root", default="D:/claude/splats/trades-hall")
    parser.add_argument("--room", default=None)
    args = parser.parse_args()
    text = open(args.manifest, encoding="utf-8").read()
    decl = text.index("GeneratedRoomSplatBundle[] =")
    data = json.loads(text[text.index("[", decl + 30):text.rindex("]") + 1])
    rotate = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=float)   # three.js Euler (-pi/2, 0, 0)
    for room in data:
        slug = room["roomSlug"]
        if args.room and slug != args.room:
            continue
        position = np.array(room["transform"]["position"], dtype=float)
        finest = room["finestLevel"]
        heights = []
        for tile in room["tiles"]:
            if tile["lodLevel"] != finest or tile["isEnvironment"]:
                continue
            path = os.path.join(args.root, slug, tile["file"])
            if not os.path.exists(path):
                continue
            decoded = decode_tile(path)
            means = decoded["means"] if isinstance(decoded, dict) else decoded[0]
            scene = (rotate @ np.asarray(means, dtype=float).T).T + position
            heights.append(scene[:, 1])
        if not heights:
            print(f"{slug:24s} no finest tiles under {args.root}")
            continue
        y = np.concatenate(heights)
        counts, edges = np.histogram(y, bins=np.arange(-1.5, 3.0, 0.02))
        peak = int(np.argmax(counts))
        print(f"{slug:24s} finest {len(y):9d} centres | densest 2 cm slab at scene y = {edges[peak] + 0.01:+.2f} m (n={counts[peak]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
