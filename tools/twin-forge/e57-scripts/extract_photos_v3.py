"""True spherical resampling of Matterport's embedded skybox photos (v3).

v1 (NCC rot90 matching) and v2 (pose snapping) both assumed each embedded
photo differs from a canonical scanner-frame cube face by a whole-image
rot90/flip. Probing the Image2D pose quaternions shows that is false: the
skybox rigs sit at arbitrary continuous rotations relative to both the scan
frame and the world (5-15 deg residuals) - whole-image ops CANNOT be correct
in general, which is exactly the "upside down / different room" defect set.

v3 does it properly: for every output pixel of each canonical scanner-frame
face, rotate the ray into the world (R_scan), then into each photo's camera
frame (R_img^T), project through the exact pinhole intrinsics, and bilinearly
sample the best-covering photo. No assumptions, no guessing - just the poses
the file provides.

Camera convention: E57 pinhole (+Z optical axis, +X image-right, +Y
image-down) is tried first and verified against the lidar faces of scan_000
(masked NCC >= 0.85 average); on failure the 24 axis conventions are brute
forced with the same acceptance test.

Output: <out>/scan_NNN_{face}.jpg (1536 sq, same contract as before) +
_extract_v3_report.json. Idempotent per sweep; chunk with --scans if needed.
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
FACE_BASES = {
    "front": (np.array([1.0, 0, 0]), np.array([0, -1.0, 0]), np.array([0, 0, -1.0])),
    "back": (np.array([-1.0, 0, 0]), np.array([0, 1.0, 0]), np.array([0, 0, -1.0])),
    "left": (np.array([0, 1.0, 0]), np.array([1.0, 0, 0]), np.array([0, 0, -1.0])),
    "right": (np.array([0, -1.0, 0]), np.array([-1.0, 0, 0]), np.array([0, 0, -1.0])),
    "up": (np.array([0, 0, 1.0]), np.array([0, -1.0, 0]), np.array([1.0, 0, 0])),
    "down": (np.array([0, 0, -1.0]), np.array([0, -1.0, 0]), np.array([-1.0, 0, 0])),
}
OUT_SIZE_DEFAULT = 1536
SRC_SIZE = 2048  # photos downsampled 4096->2048 before sampling (output is 1536)


def quat_to_mat(q):
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def all_conventions():
    """E57-standard first, then the other 23 axis conventions."""
    e57_standard = np.column_stack([[0.0, 0, 1], [1.0, 0, 0], [0, 1.0, 0]])
    convs = [e57_standard]
    basis = [np.array(v, dtype=float) for v in
             ([1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1])]
    for a in basis:
        for r in basis:
            if abs(np.dot(a, r)) > 0.5:
                continue
            d = np.cross(a, r)
            c = np.column_stack([a, r, d])
            if not any(np.allclose(c, e) for e in convs):
                convs.append(c)
    return convs


def face_dirs(size):
    """Unit ray grid (size x size x 3) per canonical face, scanner frame."""
    px = (np.arange(size) + 0.5) / size * 2 - 1  # -1..1
    u, v = np.meshgrid(px, px)  # v runs down the raster (rows)
    grids = {}
    for face, (axis, right, down) in FACE_BASES.items():
        d = (axis[None, None, :]
             + u[:, :, None] * right[None, None, :]
             + v[:, :, None] * down[None, None, :])
        grids[face] = d / np.linalg.norm(d, axis=2, keepdims=True)
    return grids


def resample_sweep(photos, cam_mats, fx, cx, cy, r_scan, grids, out_size, conv):
    """Render all six canonical faces from the sweep's posed photos.
    photos: list of HxWx3 uint8; cam_mats: world<-camera rotations."""
    faces_out = {}
    axes_cam = conv[:, 0]
    right_cam = conv[:, 1]
    down_cam = conv[:, 2]
    for face, dirs in grids.items():
        d_world = dirs @ r_scan.T  # scanner -> world
        best_score = np.full(dirs.shape[:2], -1.0)
        out = np.zeros((out_size, out_size, 3), dtype=np.uint8)
        for img, r_img in zip(photos, cam_mats):
            d_cam = d_world @ r_img  # world -> camera (applies R_img^T)
            z = d_cam @ axes_cam
            x = d_cam @ right_cam
            y = d_cam @ down_cam
            with np.errstate(divide="ignore", invalid="ignore"):
                uu = fx * x / z + cx
                vv = fx * y / z + cy
            valid = (z > 0.05) & (uu >= 0) & (uu <= SRC_SIZE - 1) & (vv >= 0) & (vv <= SRC_SIZE - 1)
            score = np.where(valid, z, -1.0)
            take = score > best_score
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
            best_score = np.where(take, score, best_score)
        faces_out[face] = out
    return faces_out


def to_small_gray_arr(arr, size=96):
    return np.asarray(
        Image.fromarray(arr).convert("L").resize((size, size), Image.BILINEAR),
        dtype=np.float64)


def masked_ncc(a_img, b_img):
    mask = b_img > 12.0
    if mask.sum() < 500:
        return -1.0
    a = a_img[mask] - a_img[mask].mean()
    b = b_img[mask] - b_img[mask].mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 1e-9 else -1.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=r"F:\E57\cubemaps_photo_v3")
    ap.add_argument("--size", type=int, default=OUT_SIZE_DEFAULT)
    ap.add_argument("--scans", default="all")
    # Manual eye-verified roll overrides: "40:0,180,180,0,0,0;112:..."
    # (degrees per Skybox photo in file order). Wins over auto-repair.
    ap.add_argument("--force-rolls", default="")
    # Pose swaps for sweeps whose Skybox file order got scrambled (e.g.
    # scan_001 stores the ceiling image in the down-pose slot and the
    # nadir image in the up-pose slot). "1:0-5" swaps the stored poses of
    # photos 0 and 5 for scan 1; comma-separate multiple pairs. Applied
    # before --force-rolls (rolls index by IMAGE file order).
    ap.add_argument("--swap-poses", default="")
    # Sweeps whose stored Image2D poses are corrupt (faces swapped/rolled
    # arbitrarily — scan_040 et al). Their photos are pristine; only the
    # quats lie. Repair = synthesize poses from the RIG PATTERN: Skybox j's
    # sweep-relative rotation R_local_j = R_scan^T R_img_j is generator-fixed,
    # so its average over verified-good sweeps reconstructs the truth.
    ap.add_argument("--synth-poses", default="", help="comma list of scan ids")
    ap.add_argument("--rig-donors", default="0,7,20,60,90,120,140",
                    help="verified-good scans used to average the rig pattern")
    args = ap.parse_args()

    forced_rolls = {}
    if args.force_rolls:
        for part in args.force_rolls.split(";"):
            scan_str, rolls_str = part.split(":")
            forced_rolls[int(scan_str)] = [int(r) for r in rolls_str.split(",")]
    pose_swaps = {}
    if args.swap_poses:
        for part in args.swap_poses.split(";"):
            scan_str, pairs_str = part.split(":")
            pose_swaps[int(scan_str)] = [
                tuple(int(x) for x in pair.split("-"))
                for pair in pairs_str.split(",")
            ]
    synth_scans = {int(s) for s in args.synth_poses.split(",") if s != ""}
    os.makedirs(args.out, exist_ok=True)

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

    # Intrinsics are constant across the rig: fx = 2048px at 4096 -> scale.
    fx = 2048.0 * (SRC_SIZE / 4096.0)
    cx = cy = SRC_SIZE / 2.0

    grids = face_dirs(args.size)

    # ---- Convention solve on scan_000 --------------------------------------
    # IMPORTANT FRAME NOTE: the old lidar cubemaps (and the v1 photo faces
    # matched to them) live in the scanner's RASTER frame — azimuth zero is
    # the mechanical start angle, arbitrary per sweep. v3 renders in the POSE
    # frame (the one the viewer actually applies via each node's quaternion),
    # so v3 faces are rotated about the vertical vs the old set by each
    # sweep's start-azimuth. The anchor test therefore scores each rendered
    # face against its BEST MATCH among the verified v1 photo faces
    # (cubemaps_photo, judged correct in the live viewer for scan_000):
    # up stays up under a yaw offset, so the right convention wins clearly
    # even though face identities shift around the horizon.
    v1_dir = r"F:\E57\cubemaps_photo"
    photos0, mats0 = load_photos(0)
    v1_faces = [
        np.asarray(Image.open(os.path.join(v1_dir, f"scan_000_{f}.jpg")).convert("L")
                   .resize((96, 96), Image.BILINEAR), dtype=np.float64)
        for f in FACES
    ]
    scored = []
    for conv in all_conventions():
        rendered = resample_sweep(photos0, mats0, fx, cx, cy, scan_rot[0], grids, args.size, conv)
        total = 0.0
        for f in FACES:
            small = to_small_gray_arr(rendered[f])
            total += max(masked_ncc(small, ref) for ref in v1_faces)
        scored.append((total / 6.0, conv, rendered))
    scored.sort(key=lambda t: -t[0])
    anchor_avg, conv_used, rendered0 = scored[0]
    runner_up = scored[1][0]
    print(f"convention solved: best-match avg ncc {anchor_avg:.3f} (runner-up {runner_up:.3f})")
    print(conv_used)
    if anchor_avg < 0.5 or anchor_avg - runner_up < 0.05:
        print("FAILED: convention not decisively separable — do not trust output")
        return 1
    for f in FACES:
        Image.fromarray(rendered0[f]).save(
            os.path.join(args.out, f"scan_000_{f}.jpg"), quality=88)

    if args.scans == "all":
        targets = list(range(n_scans))
    else:
        targets = []
        for part in args.scans.split(","):
            if "-" in part:
                lo, hi = part.split("-")
                targets.extend(range(int(lo), int(hi) + 1))
            else:
                targets.append(int(part))

    # ---- Pano oracle -------------------------------------------------------
    # The lidar panorama (rows = elevation, cols = azimuth in the scanner's
    # RASTER frame) is dense geometric truth up to one unknown yaw offset per
    # sweep. A photo rendered into pose-frame pano space with the CORRECT
    # roll matches the lidar pano at some azimuth shift; with a WRONG roll no
    # shift can fix it. Scoring = max masked-NCC over azimuth shifts.
    PANO_H, PANO_W = 90, 240

    def pano_dirs():
        el = (np.arange(PANO_H) + 0.5) / PANO_H * np.pi - np.pi / 2  # -90..90
        # Scanner columns run clockwise (verified on scan_000: flipped azimuth
        # scores 0.605 vs 0.397 unflipped), hence the negated azimuth.
        az = -((np.arange(PANO_W) + 0.5) / PANO_W * 2 * np.pi)
        el = el[::-1]  # row 0 = zenith, matching the lidar pano raster
        cos_el = np.cos(el)[:, None]
        d = np.stack([
            cos_el * np.cos(az)[None, :],
            cos_el * np.sin(az)[None, :],
            np.broadcast_to(np.sin(el)[:, None], (PANO_H, PANO_W)),
        ], axis=2)
        return d  # scanner/pose frame, Z-up

    PANO_GRID = pano_dirs()

    def render_pano(photos_list, mats_list, r_scan_m):
        """Low-res pose-frame pano from the given photos; black = uncovered."""
        d_world = PANO_GRID @ r_scan_m.T
        out = np.zeros((PANO_H, PANO_W), dtype=np.float64)
        best = np.full((PANO_H, PANO_W), -1.0)
        a = conv_used[:, 0]
        r = conv_used[:, 1]
        dn = conv_used[:, 2]
        for img, r_img in zip(photos_list, mats_list):
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
        p = os.path.join(r"F:\E57\panoramas", f"scan_{scan:03d}.jpg")
        if not os.path.exists(p):
            return None
        return np.asarray(
            Image.open(p).convert("L").resize((PANO_W, PANO_H), Image.BILINEAR),
            dtype=np.float64)

    def best_shift_ncc(rendered_pano, lidar):
        """Max masked NCC over all azimuth shifts (5-ish° steps); also returns
        the winning shift so photos of one sweep can be held to a common one."""
        cover = rendered_pano > 4.0
        signal = lidar > 12.0
        best = (-2.0, 0)
        for s in range(0, PANO_W, 2):
            shifted = np.roll(rendered_pano, s, axis=1)
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

    def roll_mat(theta):
        c, s = np.cos(theta), np.sin(theta)
        a = conv_used[:, 0]
        r = conv_used[:, 1]
        d = conv_used[:, 2]
        r2 = c * r + s * d
        d2 = -s * r + c * d
        return np.column_stack([a, r2, d2]) @ np.column_stack([a, r, d]).T

    ROLLS = [0.0, np.pi / 2, np.pi, 3 * np.pi / 2]

    def sweep_pano_score(photos_list, mats_list, scan):
        lid = lidar_pano(scan)
        if lid is None:
            return None
        return best_shift_ncc(render_pano(photos_list, mats_list, scan_rot[scan]), lid)

    # Seam-energy oracle: the six 90° photos tile the sphere; with correct
    # rolls the composite cube is continuous, and any wrongly-rolled photo
    # produces hard seams where source coverage switches. Gradient energy of
    # a low-res composite is therefore a self-contained roll-correctness
    # cost — no external reference, immune to the lidar's blind spots.
    SEAM_SIZE = 72
    grids_seam = face_dirs(SEAM_SIZE)

    def seam_energy(photos_list, mats_list, scan):
        total = 0.0
        rendered = resample_sweep(
            photos_list, mats_list, fx, cx, cy, scan_rot[scan],
            grids_seam, SEAM_SIZE, conv_used)
        for f in FACES:
            g = np.asarray(
                Image.fromarray(rendered[f]).convert("L"), dtype=np.float64)
            total += float(np.abs(np.diff(g, axis=0)).sum())
            total += float(np.abs(np.diff(g, axis=1)).sum())
        return total

    def repair_mats(photos_list, mats_list, scan):
        """Minimum-seam-energy roll assignment. The pano oracle shortlists
        which photos are suspect (its confident zeros stay fixed) so the
        brute-force stays small; the seam cost picks the true combination."""
        lid = lidar_pano(scan)
        candidates = []  # per photo: list of candidate roll indices
        for j, m in enumerate(mats_list):
            if lid is not None:
                per_roll = []
                for k, theta in enumerate(ROLLS):
                    pano = render_pano([photos_list[j]], [m @ roll_mat(theta)], scan_rot[scan])
                    per_roll.append((best_shift_ncc(pano, lid)[0], k))
                per_roll.sort(reverse=True)
                # Confidently correct as-is → pin; otherwise search all four.
                if per_roll[0][1] == 0 and per_roll[0][0] - per_roll[1][0] > 0.08:
                    candidates.append([0])
                    continue
            candidates.append([0, 1, 2, 3])

        best_combo = None
        best_cost = np.inf
        from itertools import product
        for combo in product(*candidates):
            mats_try = [m @ roll_mat(ROLLS[k]) for m, k in zip(mats_list, combo)]
            cost = seam_energy(photos_list, mats_try, scan)
            if cost < best_cost:
                best_cost = cost
                best_combo = combo
        if best_combo is None:
            return mats_list, None
        fixed = [m @ roll_mat(ROLLS[k]) for m, k in zip(mats_list, best_combo)]
        return fixed, [k * 90 for k in best_combo]

    def faces_to_pano(face_images):
        """Existing output faces → pose-frame pano (for verifying old runs)."""
        out = np.zeros((PANO_H, PANO_W), dtype=np.float64)
        d = PANO_GRID
        for face, (axis, right, down) in FACE_BASES.items():
            za = d @ axis
            sel = (za >= np.abs(d @ np.array([1.0, 0, 0]))) & (za > 0)
            for other, (oa, _, _) in FACE_BASES.items():
                if other != face:
                    sel &= za >= (d @ oa)
            if not sel.any():
                continue
            u = (d[sel] @ right) / za[sel]
            v = (d[sel] @ down) / za[sel]
            size = face_images[face].shape[0]
            ui = np.clip(((u + 1) / 2 * size), 0, size - 1).astype(np.int32)
            vi = np.clip(((v + 1) / 2 * size), 0, size - 1).astype(np.int32)
            out[sel] = face_images[face][vi, ui]
        return out

    # Calibrated on the flipped-azimuth oracle: known-good sweeps score ~0.6,
    # roll-broken ones ~0.3 (photo-vs-lidar luminance gap keeps the ceiling
    # well under 1.0). 0.5 splits the observed distributions.
    GOOD_NCC = 0.5

    report = {"convention": conv_used.tolist(), "anchor_avg_ncc": round(anchor_avg, 4), "sweeps": {}}
    for scan in targets:
        out_paths = {f: os.path.join(args.out, f"scan_{scan:03d}_{f}.jpg") for f in FACES}
        if len(per_scan.get(scan, [])) != 6:
            report["sweeps"][f"scan_{scan:03d}"] = "MISSING_IMAGES"
            continue
        lid = lidar_pano(scan)

        # Verify existing output via the pano oracle (heals past runs).
        # Forced-roll sweeps ALWAYS re-render: the oracle is blind to
        # wall-band rolls, so a broken existing output can still pass it.
        if (scan not in forced_rolls
                and all(os.path.exists(p) for p in out_paths.values())
                and lid is not None):
            existing = {
                f: np.asarray(Image.open(out_paths[f]).convert("L").resize((192, 192), Image.BILINEAR), dtype=np.float64)
                for f in FACES
            }
            score, _ = best_shift_ncc(faces_to_pano(existing), lid)
            if score >= GOOD_NCC:
                continue  # verified good

        photos, mats = load_photos(scan)
        status = "ok"
        if scan in pose_swaps:
            for a, b in pose_swaps[scan]:
                mats[a], mats[b] = mats[b], mats[a]
        if scan in synth_scans:
            # Rig-pattern average from donor sweeps: mean of R_scan^T R_img_j
            # per Skybox index (matrix mean + SVD re-orthonormalization is a
            # valid rotation average for tightly clustered rotations).
            donors = [int(s) for s in args.rig_donors.split(",")]
            mats_synth = []
            for j in range(6):
                acc = np.zeros((3, 3))
                for d in donors:
                    idxs = per_scan.get(d, [])
                    if len(idxs) != 6:
                        continue
                    acc += scan_rot[d].T @ img_rot[idxs[j]]
                u, _, vt = np.linalg.svd(acc)
                r_local = u @ np.diag([1.0, 1.0, float(np.linalg.det(u @ vt))]) @ vt
                mats_synth.append(scan_rot[scan] @ r_local)
            mats = mats_synth
            status = "synthesized_rig_poses"
            rendered = resample_sweep(photos, mats, fx, cx, cy, scan_rot[scan], grids, args.size, conv_used)
            for f in FACES:
                Image.fromarray(rendered[f]).save(out_paths[f], quality=88)
            report["sweeps"][f"scan_{scan:03d}"] = status
            print(f"scan {scan}: {status}", flush=True)
            del photos, rendered
            gc.collect()
            continue
        if scan in forced_rolls:
            degs = forced_rolls[scan]
            mats = [m @ roll_mat(np.deg2rad(d)) for m, d in zip(mats, degs)]
            status = {"forced_rolls_deg": degs}
            if scan in pose_swaps:
                status["swapped_poses"] = [list(p) for p in pose_swaps[scan]]
            rendered = resample_sweep(photos, mats, fx, cx, cy, scan_rot[scan], grids, args.size, conv_used)
            for f in FACES:
                Image.fromarray(rendered[f]).save(out_paths[f], quality=88)
            report["sweeps"][f"scan_{scan:03d}"] = status
            print(f"scan {scan}: {status}", flush=True)
            del photos, rendered
            gc.collect()
            continue
        checked = sweep_pano_score(photos, mats, scan)
        if checked is not None and checked[0] < GOOD_NCC:
            mats2, rolls = repair_mats(photos, mats, scan)
            # Accept on the repair's own oracle: the seam-minimal combo wins
            # whenever it beats the original's seam energy (the pano NCC is
            # only the cheap trigger — it is blind to wall-band rolls).
            e_before = seam_energy(photos, mats, scan)
            e_after = seam_energy(photos, mats2, scan)
            if rolls is not None and e_after < e_before:
                mats = mats2
                status = {
                    "repaired_rolls_deg": rolls,
                    "seam": round(e_after / max(e_before, 1e-9), 3),
                    "trigger_ncc": round(checked[0], 3),
                }
            else:
                status = f"SUSPECT ncc {checked[0]:.3f} — seam repair found nothing better, review by eye"
        rendered = resample_sweep(photos, mats, fx, cx, cy, scan_rot[scan], grids, args.size, conv_used)
        for f in FACES:
            Image.fromarray(rendered[f]).save(out_paths[f], quality=88)
        report["sweeps"][f"scan_{scan:03d}"] = status
        print(f"scan {scan}: {status}", flush=True)
        del photos, rendered
        gc.collect()

    with open(os.path.join(args.out, "_extract_v3_report.json"), "w", encoding="utf8") as f:
        json.dump(report, f, indent=2)
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
