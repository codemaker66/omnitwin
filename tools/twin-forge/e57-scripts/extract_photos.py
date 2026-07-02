"""Extract Matterport's embedded photographic skybox faces from cloud_0.e57
and write them as drop-in replacements for the lidar-splat cubemaps.

Discovery (2026-07-02): images2D holds 149 sweeps x 6 "Skybox N" pinhole
JPEGs, 4096x4096, fx = 2048px, principal point (2048,2048) => exactly 90deg
per face: a photographic cubemap per sweep. The old cubemaps/ faces were
built from per-point lidar RGB (black glass, black zenith).

Face identity + in-plane orientation are solved EMPIRICALLY per sweep: each
source image, at each of 8 orientations (4 rotations x optional mirror), is
compared against each old lidar face at 96x96 grayscale using masked
normalized cross-correlation (lidar-black pixels ignored). Same scene =>
strong structural match. Output faces therefore land in EXACTLY the old
orientation convention, so the forge tiles, FACE_TO_CUBE and the viewer all
carry over unchanged - only the pixels improve.

Usage:  python extract_photos.py [--out cubemaps_photo] [--size 1536]
        [--scans all|0-10|3,7]
Writes: <out>/scan_NNN_{front,back,left,right,up,down}.jpg
        <out>/_extract_report.json  (per-face match scores; review < 0.35)
"""
import argparse
import gc
import io
import json
import os
import sys

import numpy as np
import pye57
from PIL import Image

E57_PATH = r"F:\E57\cloud_0.e57"
OLD_FACES_DIR = r"F:\E57\cubemaps"
FACES = ["front", "back", "left", "right", "up", "down"]
ORIENTATIONS = [(k, m) for m in (False, True) for k in range(4)]  # (rot90 k, mirror)


def apply_orientation(arr, k, mirror):
    out = np.rot90(arr, k)
    if mirror:
        out = np.fliplr(out)
    return out


def to_small_gray(img, size=96):
    return np.asarray(img.convert("L").resize((size, size), Image.BILINEAR), dtype=np.float64)


def masked_ncc(photo, lidar):
    """Normalized cross-correlation over pixels where the lidar face has
    signal (the splats are black where the laser saw nothing)."""
    mask = lidar > 12.0
    if mask.sum() < 500:
        return -1.0
    a = photo[mask]
    b = lidar[mask]
    a = a - a.mean()
    b = b - b.mean()
    denom = np.sqrt((a * a).sum() * (b * b).sum())
    if denom < 1e-9:
        return -1.0
    return float((a * b).sum() / denom)


def parse_scan_range(spec, count):
    if spec == "all":
        return list(range(count))
    out = []
    for part in spec.split(","):
        if "-" in part:
            lo, hi = part.split("-")
            out.extend(range(int(lo), int(hi) + 1))
        else:
            out.append(int(part))
    return [i for i in out if 0 <= i < count]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=r"F:\E57\cubemaps_photo")
    ap.add_argument("--size", type=int, default=1536)
    ap.add_argument("--scans", default="all")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    e57 = pye57.E57(E57_PATH)
    imf = e57.image_file
    root = imf.root()
    data3d = root["data3D"]
    guid_to_scan = {data3d[i]["guid"].value(): i for i in range(data3d.childCount())}

    # Group image indices per scan (file order: Skybox 0..5).
    images = root["images2D"]
    per_scan = {}
    for i in range(images.childCount()):
        guid = images[i]["associatedData3DGuid"].value()
        scan = guid_to_scan.get(guid)
        if scan is not None:
            per_scan.setdefault(scan, []).append(i)

    targets = parse_scan_range(args.scans, data3d.childCount())
    report = {}
    low_conf = []

    for scan in targets:
        indices = per_scan.get(scan, [])
        if len(indices) != 6:
            print(f"scan {scan}: expected 6 skybox images, found {len(indices)} - SKIP", flush=True)
            continue

        out_paths = {f: os.path.join(args.out, f"scan_{scan:03d}_{f}.jpg") for f in FACES}
        if all(os.path.exists(p) for p in out_paths.values()):
            continue  # idempotent, resumable

        photos = []
        for idx in indices:
            rep = images[idx]["pinholeRepresentation"]
            blob = rep["jpegImage"]
            buf = bytearray(blob.byteCount())
            blob.read(buf, 0, len(buf))
            photos.append(Image.open(io.BytesIO(bytes(buf))).convert("RGB"))

        photo_small = [to_small_gray(p) for p in photos]

        lidar_small = {}
        for face in FACES:
            old = os.path.join(OLD_FACES_DIR, f"scan_{scan:03d}_{face}.jpg")
            if not os.path.exists(old):
                break
            lidar_small[face] = to_small_gray(Image.open(old))
        if len(lidar_small) != 6:
            print(f"scan {scan}: missing old reference faces - SKIP", flush=True)
            continue

        # Greedy global assignment over (face, source, orientation) by score,
        # each source used once - stable against per-face ambiguity.
        candidates = []
        for face in FACES:
            for s, small in enumerate(photo_small):
                for k, mirror in ORIENTATIONS:
                    score = masked_ncc(apply_orientation(small, k, mirror), lidar_small[face])
                    candidates.append((score, face, s, k, mirror))
        candidates.sort(key=lambda c: c[0], reverse=True)
        assigned = {}
        used = set()
        for score, face, s, k, mirror in candidates:
            if face in assigned or s in used:
                continue
            assigned[face] = (s, k, mirror, score)
            used.add(s)
            if len(assigned) == 6:
                break

        scan_report = {}
        for face, (s, k, mirror, score) in assigned.items():
            arr = np.asarray(photos[s])
            arr = apply_orientation(arr, k, mirror)
            out_img = Image.fromarray(np.ascontiguousarray(arr)).resize(
                (args.size, args.size), Image.LANCZOS)
            out_img.save(out_paths[face], quality=88)
            scan_report[face] = round(score, 4)
            if score < 0.35:
                low_conf.append(f"scan_{scan:03d}_{face} (ncc {score:.3f})")
        report[f"scan_{scan:03d}"] = scan_report
        print(f"scan {scan}: " + " ".join(f"{f}={scan_report[f]:.2f}" for f in FACES), flush=True)
        # Six 4096^2 decodes per sweep: release aggressively or the process
        # OOMs around sweep ~30 on this machine.
        for p in photos:
            p.close()
        del photos, photo_small, lidar_small, candidates
        gc.collect()

    with open(os.path.join(args.out, "_extract_report.json"), "w", encoding="utf8") as f:
        json.dump({"faces": report, "low_confidence": low_conf}, f, indent=2)
    print(f"done. low-confidence faces: {len(low_conf)}", flush=True)
    if low_conf:
        print("\n".join(low_conf[:20]))


if __name__ == "__main__":
    sys.exit(main())
