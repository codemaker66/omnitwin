"""Seamless per-sweep WORLD-FRAME equirectangular panoramas (Twin imagery v4).

Replaces the six-face cubemap path. The cube pipeline needed a per-face
quarter-turn table (FACE_TO_CUBE) plus WebGL's left-handed cube conventions,
and produced node-dependent seam/rotation defects (scan_050: one wall face
rotated 90 deg vs its neighbours). An equirect has no faces, no seams and no
per-face table - the whole failure class dies.

Per sweep: load its six embedded skybox photos + Image2D pose quaternions,
then for every output pixel rotate the WORLD-frame ray into each photo's
camera frame (R_img^T), project through the exact pinhole intrinsics, and
bilinearly sample the nearest-axis photo (max forward z wins - the photos
tile the sphere exactly, so no blending is needed or wanted).

OUTPUT RASTER CONVENTION (the viewer's equirect shader depends on this):
  - E57 world frame, Z-up. NOT the scanner frame - poses only position
    nodes in the viewer; the pano itself is world-aligned.
  - column c -> azimuth az = (c + 0.5) / W * 2*pi, where
    az = atan2(y_world, x_world)  (from +X toward +Y, CCW seen from +Z)
  - row r -> elevation el = pi/2 - (r + 0.5) / H * pi
    (row 0 = zenith, last row = nadir)

Camera convention: solved by extract_photos_v3's anchor test on scan_000 -
E57 pinhole standard, conv = column_stack([[0,0,1],[1,0,0],[0,1,0]])
(+Z optical axis, +X image-right, +Y image-down); fx = 2048 px at 4096,
principal point at centre.

VERIFICATION (numeric, per sweep): the lidar panorama F:\\E57\\panoramas\\
scan_NNN.jpg is dense geometric truth in the scanner's RASTER frame (rows =
elevation zenith-top, azimuth direction flipped - v3's pano_dirs). A second
240x90 grayscale thumbnail is rendered purely for comparison in the SCANNER
frame (world rays = R_scan @ scanner rays) and scored by max masked-NCC over
azimuth shifts. Good sweeps land ~0.6; the photo-vs-lidar luminance gap keeps
the ceiling well under 1.0. Sweeps under 0.45 are LISTED for human review -
NO auto-repair anywhere, nothing is ever modified (the 2026-07-04 postmortem:
the E57 poses are healthy; v3's auto-repair was the corruptor).

Output: <out>/scan_NNN.jpg (2048x1024, q90) + scan_NNN_preview.jpg (512x256)
+ _equirect_report.json (merged across chunked runs). Idempotent per sweep;
chunk with --scans; gc per sweep (run a fresh process per ~15 sweeps if the
working set creeps).
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
PANO_DIR = r"F:\E57\panoramas"
OUT_DEFAULT = r"F:\E57\equirect"
SRC_SIZE = 2048  # photos downsampled 4096 -> 2048 before sampling
OUT_W, OUT_H = 2048, 1024
PREV_W, PREV_H = 512, 256
VER_W, VER_H = 240, 90
REVIEW_NCC = 0.45

# Solved camera convention (v3 anchor test, scan_000): E57 pinhole standard.
# Columns = [optical axis, image-right, image-down] expressed in camera coords.
CONV = np.column_stack([[0.0, 0, 1], [1.0, 0, 0], [0, 1.0, 0]])


def quat_to_mat(q):
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def world_equirect_dirs(w, h):
    """Unit ray grid (h x w x 3) over the full sphere, E57 WORLD frame (Z-up).
    Row 0 = zenith; azimuth from +X toward +Y. See module docstring."""
    el = np.pi / 2 - (np.arange(h) + 0.5) / h * np.pi
    az = (np.arange(w) + 0.5) / w * 2 * np.pi
    cos_el = np.cos(el)[:, None]
    return np.stack([
        cos_el * np.cos(az)[None, :],
        cos_el * np.sin(az)[None, :],
        np.broadcast_to(np.sin(el)[:, None], (h, w)),
    ], axis=2).astype(np.float32)


def scanner_pano_dirs(w, h):
    """v3's pano_dirs: SCANNER-frame grid matching the lidar pano raster
    (rows = elevation zenith-top, azimuth FLIPPED - scanner columns run
    clockwise, verified on scan_000). Verification only."""
    el = (np.arange(h) + 0.5) / h * np.pi - np.pi / 2
    az = -((np.arange(w) + 0.5) / w * 2 * np.pi)
    el = el[::-1]  # row 0 = zenith
    cos_el = np.cos(el)[:, None]
    return np.stack([
        cos_el * np.cos(az)[None, :],
        cos_el * np.sin(az)[None, :],
        np.broadcast_to(np.sin(el)[:, None], (h, w)),
    ], axis=2)


def render_rgb(dirs_world, photos, mats, fx, cx, cy):
    """Full-colour bilinear best-photo render along world-frame rays."""
    h, w = dirs_world.shape[:2]
    out = np.zeros((h, w, 3), dtype=np.uint8)
    best = np.full((h, w), -1.0, dtype=np.float32)
    a, r, dn = CONV[:, 0], CONV[:, 1], CONV[:, 2]
    for img, r_img in zip(photos, mats):
        d_cam = dirs_world @ r_img.astype(np.float32)  # world -> camera (R^T)
        z = d_cam @ a.astype(np.float32)
        x = d_cam @ r.astype(np.float32)
        y = d_cam @ dn.astype(np.float32)
        with np.errstate(divide="ignore", invalid="ignore"):
            uu = fx * x / z + cx
            vv = fx * y / z + cy
        valid = (z > 0.05) & (uu >= 0) & (uu <= SRC_SIZE - 1) & (vv >= 0) & (vv <= SRC_SIZE - 1)
        score = np.where(valid, z, -1.0)
        take = score > best
        if not take.any():
            continue
        u0 = np.clip(uu[take].astype(np.int32), 0, SRC_SIZE - 2)
        v0 = np.clip(vv[take].astype(np.int32), 0, SRC_SIZE - 2)
        fu = (uu[take] - u0)[:, None]
        fv = (vv[take] - v0)[:, None]
        p = img.astype(np.float32)
        sample = ((p[v0, u0] * (1 - fu) + p[v0, u0 + 1] * fu) * (1 - fv)
                  + (p[v0 + 1, u0] * (1 - fu) + p[v0 + 1, u0 + 1] * fu) * fv)
        out[take] = np.clip(sample, 0, 255).astype(np.uint8)
        best = np.where(take, score, best)
        del d_cam, z, x, y, uu, vv, valid, score, take, p, sample
    return out


def render_scanner_gray(photos, mats, r_scan, fx, cx, cy, grid):
    """240x90 SCANNER-frame grayscale thumbnail - verification only."""
    d_world = grid @ r_scan.T  # scanner -> world
    out = np.zeros(grid.shape[:2], dtype=np.float64)
    best = np.full(grid.shape[:2], -1.0)
    a, r, dn = CONV[:, 0], CONV[:, 1], CONV[:, 2]
    for img, r_img in zip(photos, mats):
        d_cam = d_world @ r_img
        z = d_cam @ a
        x = d_cam @ r
        y = d_cam @ dn
        with np.errstate(divide="ignore", invalid="ignore"):
            uu = fx * x / z + cx
            vv = fx * y / z + cy
        valid = (z > 0.05) & (uu >= 0) & (uu <= SRC_SIZE - 1) & (vv >= 0) & (vv <= SRC_SIZE - 1)
        take = np.where(valid, z, -1.0) > best
        if not take.any():
            continue
        gray = img.mean(axis=2)
        out[take] = gray[
            np.clip(vv[take].astype(np.int32), 0, SRC_SIZE - 1),
            np.clip(uu[take].astype(np.int32), 0, SRC_SIZE - 1),
        ]
        best = np.where(take, np.where(valid, z, -1.0), best)
    return out


def lidar_pano(scan):
    p = os.path.join(PANO_DIR, f"scan_{scan:03d}.jpg")
    if not os.path.exists(p):
        return None
    return np.asarray(
        Image.open(p).convert("L").resize((VER_W, VER_H), Image.BILINEAR),
        dtype=np.float64)


def best_shift_ncc(rendered, lidar):
    """Max masked NCC over azimuth shifts (the lidar raster's start azimuth
    is arbitrary per sweep); returns (score, shift_columns)."""
    cover = rendered > 4.0
    signal = lidar > 12.0
    best = (-2.0, 0)
    for s in range(0, VER_W, 2):
        shifted = np.roll(rendered, s, axis=1)
        mask = np.roll(cover, s, axis=1) & signal
        if mask.sum() < 400:
            continue
        aa = shifted[mask] - shifted[mask].mean()
        bb = lidar[mask] - lidar[mask].mean()
        den = np.sqrt((aa * aa).sum() * (bb * bb).sum())
        if den < 1e-9:
            continue
        score = float((aa * bb).sum() / den)
        if score > best[0]:
            best = (score, s)
    return best


def parse_scans(spec, n_scans):
    if spec == "all":
        return list(range(n_scans))
    targets = []
    for part in spec.split(","):
        if "-" in part:
            lo, hi = part.split("-")
            targets.extend(range(int(lo), int(hi) + 1))
        else:
            targets.append(int(part))
    return targets


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT_DEFAULT)
    ap.add_argument("--scans", default="all")
    ap.add_argument("--force", action="store_true",
                    help="re-render even when outputs + report entry exist")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    report_path = os.path.join(args.out, "_equirect_report.json")
    report = {"convention": CONV.tolist(), "raster": "world-frame Z-up; row0=zenith; az=atan2(y,x) from +X toward +Y", "sweeps": {}}
    if os.path.exists(report_path):
        with open(report_path, "r", encoding="utf8") as f:
            prior = json.load(f)
        report["sweeps"] = prior.get("sweeps", {})

    e57 = pye57.E57(E57_PATH)
    root = e57.image_file.root()
    data3d = root["data3D"]
    n_scans = data3d.childCount()
    guid_to_scan = {data3d[i]["guid"].value(): i for i in range(n_scans)}
    scan_rot = {}
    for i in range(n_scans):
        q = data3d[i]["pose"]["rotation"]
        scan_rot[i] = quat_to_mat([q["w"].value(), q["x"].value(), q["y"].value(), q["z"].value()])

    images = root["images2D"]
    per_scan = {}
    img_rot = {}
    for i in range(images.childCount()):
        guid = images[i]["associatedData3DGuid"].value()
        scan = guid_to_scan.get(guid)
        if scan is None:
            continue
        per_scan.setdefault(scan, []).append(i)
        q = images[i]["pose"]["rotation"]
        img_rot[i] = quat_to_mat([q["w"].value(), q["x"].value(), q["y"].value(), q["z"].value()])

    def load_photos(scan):
        out = []
        for idx in per_scan[scan]:
            rep = images[idx]["pinholeRepresentation"]
            blob = rep["jpegImage"]
            buf = bytearray(blob.byteCount())
            blob.read(buf, 0, len(buf))
            img = Image.open(io.BytesIO(bytes(buf))).convert("RGB")
            img = img.resize((SRC_SIZE, SRC_SIZE), Image.BILINEAR)
            out.append(np.asarray(img))
            img.close()
        return out, [img_rot[idx] for idx in per_scan[scan]]

    fx = 2048.0 * (SRC_SIZE / 4096.0)
    cx = cy = SRC_SIZE / 2.0

    world_grid = world_equirect_dirs(OUT_W, OUT_H)
    ver_grid = scanner_pano_dirs(VER_W, VER_H)

    targets = parse_scans(args.scans, n_scans)
    for scan in targets:
        key = f"scan_{scan:03d}"
        full_path = os.path.join(args.out, f"{key}.jpg")
        prev_path = os.path.join(args.out, f"{key}_preview.jpg")
        done = (os.path.exists(full_path) and os.path.exists(prev_path)
                and key in report["sweeps"]
                and isinstance(report["sweeps"][key], dict)
                and "ncc" in report["sweeps"][key])
        if done and not args.force:
            continue
        if len(per_scan.get(scan, [])) != 6:
            report["sweeps"][key] = "MISSING_IMAGES"
            print(f"{key}: MISSING_IMAGES", flush=True)
            continue

        photos, mats = load_photos(scan)
        pano = render_rgb(world_grid, photos, mats, fx, cx, cy)
        Image.fromarray(pano).save(full_path, quality=90)
        Image.fromarray(pano).resize((PREV_W, PREV_H), Image.LANCZOS).save(prev_path, quality=85)

        lid = lidar_pano(scan)
        if lid is None:
            report["sweeps"][key] = {"ncc": None, "shift": None, "note": "no lidar pano"}
        else:
            thumb = render_scanner_gray(photos, mats, scan_rot[scan], fx, cx, cy, ver_grid)
            score, shift = best_shift_ncc(thumb, lid)
            entry = {"ncc": round(score, 4), "shift": shift}
            if score < REVIEW_NCC:
                entry["review"] = True  # LISTED for eyes - never modified
            report["sweeps"][key] = entry
        print(f"{key}: {report['sweeps'][key]}", flush=True)
        del photos, mats, pano
        gc.collect()

    report["review"] = sorted(
        k for k, v in report["sweeps"].items()
        if isinstance(v, dict) and v.get("ncc") is not None and v["ncc"] < REVIEW_NCC
    )
    with open(report_path, "w", encoding="utf8") as f:
        json.dump(report, f, indent=2)
    print(f"done: {len(targets)} targeted, {len(report['review'])} for review")
    return 0


if __name__ == "__main__":
    sys.exit(main())
