"""Per-sweep WORLD-FRAME equirect panoramas, v2: EMPIRICAL per-photo orientation.

v1 (extract_equirect.py) trusted the stored Image2D pose quaternions. Proven
wrong: the composite was a per-photo patchwork - upright at some azimuths,
v-flipped at others (81/149 nodes flagged inverted-ish in the viewer sweep).
The scan poses (data3D) are healthy; the per-photo CAMERA orientation is not.

v2 fits each photo's orientation EMPIRICALLY against laser truth before
compositing:

  TRUTH RASTER T (per sweep): the lidar panorama F:\\E57\\panoramas\\
  scan_NNN.jpg is stored NADIR-AT-ROW-0 (vertically flipped vs standard
  equirect - validated on scans 000/040/100: the tripod blind cone is the
  black band at the TOP, and ceiling content (hanging chandeliers) sits in
  the lower half). We V-FLIP it to standard zenith-top. Its columns run
  CCW (+az) - pinned by reading MIRRORED board text in the v-flipped
  scan_003 lidar pano (see scanner_pano_dirs; the previously determined
  'az negated' was an artifact of the missing v-flip). Result: truth in
  the SCANNER frame on the scanner_pano_dirs grid. Because the output
  world raster is also +az-columns, a CORRECT output JPG reads
  flat-MIRRORED - matching the viewer contract (EQUIRECT_U_FLIP=false:
  in-view rightward = decreasing az un-mirrors it; twin-visual-check.mjs:
  'the raw equirect JPGs are the horizontal MIRROR of Matterport's flat
  raster by convention; the viewer renders them true').

  PER-PHOTO FIT: the six skybox photos are EXACT axis-aligned cube faces in
  the scanner frame (verified numerically on scans 000/002: stored forward /
  right / down axes are all +-unit axes; Skybox 0=-Z, 1=-X, 2=+Y, 3=+X,
  4=-Y, 5=+Z). The originally planned 8-dihedral search about the stored
  optical axis proved too small on scan_000: photos 1/3's content sits
  ~180 deg of azimuth from where their stored quats claim (full-circle NCC
  diagnostic), i.e. the corruption includes FACE MOVES, not just roll/flip.
  So each photo is fitted over the full 48-element cube group of
  axis-aligned camera bases in the scanner frame: forward in {+-X,+-Y,+-Z}
  x 4 rolls x {proper, mirrored} (mirrors flip handedness - included
  deliberately, the stored data has proven untrustworthy enough to warrant
  it; the laser raster is chirality-unambiguous so a mirrored source raster
  fits ONLY its mirrored candidate). The stored basis is one of the 48 -
  the identity candidate, not gospel. Scoring: render the photo alone into
  a low-res SCANNER-frame band, masked NCC vs T over (photo coverage
  INTERSECT T signal), max over azimuth shifts AZ_SHIFT0 +- 4 columns
  (residual rig yaw). Winner must score >= 0.35 with >= 0.05 margin over
  the runner-up, else the photo is flagged AMBIGUOUS in the report (argmax
  still used - no auto-repair drama, the report is the gate).

  COMPOSITE: full-res 2048x1024 WORLD-frame equirect with the fitted bases
  (R_scan @ fitted scanner-frame basis; scan poses are healthy),
  nearest-camera-wins (max forward z), bilinear. OUTPUT RASTER CONVENTION
  IS IDENTICAL TO v1 (viewer/tiler need no changes):
    - E57 world frame, Z-up; row 0 = zenith
    - column c -> az = (c + 0.5) / W * 2*pi, az = atan2(y, x) (+X toward +Y)

  ACCEPTANCE: whole-sweep low-res scanner-frame composite vs T NCC,
  recorded per sweep in _equirect_v2_report.json alongside every photo's
  fitted basis + scores. No thresholds gate the write.

Chunked --scans, resumable, gc per sweep; run a fresh process per ~12 sweeps
(Windows commit-exhaustion trap - kill leftover python before rerunning if a
MemoryError killed a run).

--fullshift: development diagnostic - search the winning candidate's azimuth
shift over the whole circle and report it, to verify AZ_SHIFT0.
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
FIT_W, FIT_H = 480, 240  # low-res fit/acceptance raster
AZ_SHIFT0 = 0      # global lidar-raster azimuth offset, columns of FIT_W
AZ_SHIFT_SPAN = 4  # +/- columns of residual rig yaw searched around AZ_SHIFT0
NCC_MIN = 0.35     # winner floor
NCC_MARGIN = 0.05  # winner-vs-runner-up floor
T_SIGNAL = 12.0    # lidar gray above this = signal (blind cone / void is ~0)
MIN_OVERLAP = 500  # min masked pixels for a valid NCC

# Solved camera convention (v3 anchor test, scan_000): E57 pinhole standard.
# Columns = [optical axis, image-right, image-down] expressed in camera coords.
# Used only to express the STORED pose as axes for the report comparison.
CONV = np.column_stack([[0.0, 0, 1], [1.0, 0, 0], [0, 1.0, 0]])

AXES = {
    "+x": np.array([1.0, 0.0, 0.0]), "-x": np.array([-1.0, 0.0, 0.0]),
    "+y": np.array([0.0, 1.0, 0.0]), "-y": np.array([0.0, -1.0, 0.0]),
    "+z": np.array([0.0, 0.0, 1.0]), "-z": np.array([0.0, 0.0, -1.0]),
}


def build_candidates():
    """All 48 axis-aligned camera bases (fwd, right, down) in the SCANNER
    frame: 6 forwards x 4 perpendicular rights x {proper d=f x r,
    mirrored d=-(f x r)}. Proper bases satisfy right x down = fwd (the
    pinhole handedness of CONV); mirrored ones are the horizontal-mirror
    twins."""
    cands = []
    for fn, f in AXES.items():
        for rn, r in AXES.items():
            if abs(float(np.dot(f, r))) > 0.5:
                continue  # right must be perpendicular to forward
            d = np.cross(f, r)
            cands.append((f"f{fn}_r{rn}_p", f, r, d))
            cands.append((f"f{fn}_r{rn}_m", f, r, -d))
    assert len(cands) == 48
    return cands


CANDIDATES = build_candidates()


def axis_name(v):
    i = int(np.argmax(np.abs(v)))
    return ("-" if v[i] < 0 else "+") + "xyz"[i]


def quat_to_mat(q):
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def world_equirect_dirs(w, h):
    """Unit ray grid (h x w x 3) over the full sphere, E57 WORLD frame (Z-up).
    Row 0 = zenith; azimuth from +X toward +Y. Same as v1."""
    el = np.pi / 2 - (np.arange(h) + 0.5) / h * np.pi
    az = (np.arange(w) + 0.5) / w * 2 * np.pi
    cos_el = np.cos(el)[:, None]
    return np.stack([
        cos_el * np.cos(az)[None, :],
        cos_el * np.sin(az)[None, :],
        np.broadcast_to(np.sin(el)[:, None], (h, w)),
    ], axis=2).astype(np.float32)


def scanner_pano_dirs(w, h):
    """SCANNER-frame grid matching the V-FLIPPED lidar pano raster:
    row 0 = zenith (standard), azimuth POSITIVE (columns run CCW seen from
    +Z). Pinned EMPIRICALLY: the v-flipped lidar pano of scan_003 shows the
    Deacon Conveners board text MIRRORED in flat view, and flat-mirrored
    <=> columns +az (a correct +az equirect always reads flat-mirrored).
    The prior 'columns clockwise => az negated' claim was an artifact of
    the missing v-flip: zenith-top rows + negated az = the true grid
    rotated 180 deg about scanner X - self-consistent, chirally wrong."""
    el = np.pi / 2 - (np.arange(h) + 0.5) / h * np.pi
    az = (np.arange(w) + 0.5) / w * 2 * np.pi
    cos_el = np.cos(el)[:, None]
    return np.stack([
        cos_el * np.cos(az)[None, :],
        cos_el * np.sin(az)[None, :],
        np.broadcast_to(np.sin(el)[:, None], (h, w)),
    ], axis=2).astype(np.float32)


def lidar_truth(scan):
    """Truth raster T: lidar pano, V-FLIPPED to zenith-top, low-res gray."""
    p = os.path.join(PANO_DIR, f"scan_{scan:03d}.jpg")
    if not os.path.exists(p):
        return None
    raw = np.asarray(
        Image.open(p).convert("L").resize((FIT_W, FIT_H), Image.BILINEAR),
        dtype=np.float64)
    return raw[::-1].copy()  # nadir-at-row-0 -> zenith-at-row-0


def solo_band(gray, flat_dirs, f, r, d, fx, cx, cy, shape):
    """Render one photo alone (nearest sample) under a candidate basis given
    in the SAME frame as flat_dirs. Returns (band float64, cover bool)."""
    z = flat_dirs @ f.astype(np.float32)
    x = flat_dirs @ r.astype(np.float32)
    y = flat_dirs @ d.astype(np.float32)
    with np.errstate(divide="ignore", invalid="ignore"):
        uu = fx * x / z + cx
        vv = fx * y / z + cy
    valid = (z > 0.05) & (uu >= 0) & (uu <= SRC_SIZE - 1) & (vv >= 0) & (vv <= SRC_SIZE - 1)
    band = np.zeros(z.shape, dtype=np.float64)
    band[valid] = gray[
        np.clip(vv[valid].astype(np.int32), 0, SRC_SIZE - 1),
        np.clip(uu[valid].astype(np.int32), 0, SRC_SIZE - 1),
    ]
    return band.reshape(shape), valid.reshape(shape)


def masked_ncc(band, cover, truth, signal, shifts):
    """Max masked NCC of band-vs-truth over azimuth column shifts.
    Returns (score, shift). Mask = rolled cover & truth signal."""
    best = (-2.0, 0)
    for s in shifts:
        sb = np.roll(band, s, axis=1)
        mask = np.roll(cover, s, axis=1) & signal
        if mask.sum() < MIN_OVERLAP:
            continue
        aa = sb[mask]
        bb = truth[mask]
        aa = aa - aa.mean()
        bb = bb - bb.mean()
        den = np.sqrt((aa * aa).sum() * (bb * bb).sum())
        if den < 1e-9:
            continue
        score = float((aa * bb).sum() / den)
        if score > best[0]:
            best = (score, int(s))
    return best


def fit_photo(gray, flat_dirs, truth, signal, fx, cx, cy, shape, stored_axes,
              fullshift):
    """Score all 48 axis-aligned candidates for one photo.
    Returns (record, winning (f, r, d), band, cover)."""
    shifts = [(AZ_SHIFT0 + s) % FIT_W
              for s in range(-AZ_SHIFT_SPAN, AZ_SHIFT_SPAN + 1)]
    scored = []
    for name, f, r, d in CANDIDATES:
        band, cover = solo_band(gray, flat_dirs, f, r, d, fx, cx, cy, shape)
        score, shift = masked_ncc(band, cover, truth, signal, shifts)
        scored.append((score, name, shift, f, r, d, band, cover))
    scored.sort(key=lambda t: t[0], reverse=True)
    win, runner = scored[0], scored[1]
    sf, sr, sd = stored_axes
    stored_name = f"f{axis_name(sf)}_r{axis_name(sr)}_" + (
        "p" if float(np.dot(np.cross(sr, sd), sf)) > 0 else "m")
    rec = {
        "basis": win[1],
        "stored": stored_name,
        "identity": win[1] == stored_name,
        "mirror": win[1].endswith("_m"),
        "face_move": win[1].split("_")[0] != stored_name.split("_")[0],
        "ncc": round(win[0], 4),
        "runner_up": runner[1],
        "margin": round(win[0] - runner[0], 4),
        "shift": win[2],
    }
    if win[0] < NCC_MIN or (win[0] - runner[0]) < NCC_MARGIN:
        rec["ambiguous"] = True
    if fullshift:  # dev diagnostic: where does the winner REALLY align?
        fscore, fshift = masked_ncc(win[6], win[7], truth, signal,
                                    range(0, FIT_W, 2))
        rec["fullshift"] = {"ncc": round(fscore, 4), "shift": fshift}
    return rec, (win[3], win[4], win[5]), win[6], win[7]


def render_world_rgb(dirs_world, photos, bases, r_scan, fx, cx, cy):
    """Full-colour bilinear best-photo render along world-frame rays, using
    the FITTED scanner-frame camera bases. Nearest-camera-wins (max z)."""
    h, w = dirs_world.shape[:2]
    out = np.zeros((h, w, 3), dtype=np.uint8)
    best = np.full((h, w), -1.0, dtype=np.float32)
    flat = dirs_world.reshape(-1, 3)
    for img, (f, r, d) in zip(photos, bases):
        # camera axes in WORLD frame; z/x/y = world ray dotted with each
        m = (r_scan @ np.column_stack([f, r, d])).astype(np.float32)
        zxy = flat @ m
        z = zxy[:, 0].reshape(h, w)
        x = zxy[:, 1].reshape(h, w)
        y = zxy[:, 2].reshape(h, w)
        del zxy
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
        del z, x, y, uu, vv, valid, score, take, p, sample
    return out


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
    ap.add_argument("--fullshift", action="store_true",
                    help="dev: full-circle azimuth diagnostic per winner")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    report_path = os.path.join(args.out, "_equirect_v2_report.json")
    report = {
        "raster": "world-frame Z-up; row0=zenith; az=atan2(y,x) from +X toward +Y",
        "truth": "lidar pano v-flipped to zenith-top (stored nadir-at-row-0), columns +az (CCW), scanner frame",
        "fit": "48 axis-aligned scanner-frame camera bases per photo, masked NCC vs lidar truth",
        "az_shift0": AZ_SHIFT0,
        "sweeps": {},
    }
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
    fit_grid = scanner_pano_dirs(FIT_W, FIT_H)
    fit_flat = fit_grid.reshape(-1, 3)

    targets = parse_scans(args.scans, n_scans)
    for scan in targets:
        key = f"scan_{scan:03d}"
        full_path = os.path.join(args.out, f"{key}.jpg")
        prev_path = os.path.join(args.out, f"{key}_preview.jpg")
        done = (os.path.exists(full_path) and os.path.exists(prev_path)
                and isinstance(report["sweeps"].get(key), dict)
                and "sweep_ncc" in report["sweeps"][key])
        if done and not args.force:
            continue
        if len(per_scan.get(scan, [])) != 6:
            report["sweeps"][key] = "MISSING_IMAGES"
            print(f"{key}: MISSING_IMAGES", flush=True)
            continue
        truth = lidar_truth(scan)
        if truth is None:
            report["sweeps"][key] = "NO_LIDAR_PANO"
            print(f"{key}: NO_LIDAR_PANO", flush=True)
            continue
        signal = truth > T_SIGNAL

        photos, mats = load_photos(scan)
        grays = [p.mean(axis=2) for p in photos]
        r_scan = scan_rot[scan]

        # --- per-photo empirical orientation fit against laser truth ---
        fits, bases = [], []
        comp_band = np.zeros((FIT_H, FIT_W), dtype=np.float64)
        comp_cover = np.zeros((FIT_H, FIT_W), dtype=bool)
        for j in range(6):
            stored = (
                r_scan.T @ (mats[j] @ CONV[:, 0]),
                r_scan.T @ (mats[j] @ CONV[:, 1]),
                r_scan.T @ (mats[j] @ CONV[:, 2]),
            )
            rec, basis, band, cover = fit_photo(
                grays[j], fit_flat, truth, signal, fx, cx, cy,
                (FIT_H, FIT_W), stored, args.fullshift)
            fits.append(rec)
            bases.append(basis)
            fresh = cover & ~comp_cover
            comp_band[fresh] = band[fresh]
            comp_cover |= cover
            del band, cover, fresh

        # --- whole-sweep acceptance: corrected composite vs truth ---
        shifts = [(AZ_SHIFT0 + s) % FIT_W
                  for s in range(-AZ_SHIFT_SPAN, AZ_SHIFT_SPAN + 1)]
        sweep_ncc, sweep_shift = masked_ncc(comp_band, comp_cover, truth,
                                            signal, shifts)

        # --- full-res world-frame composite with fitted bases ---
        pano = render_world_rgb(world_grid, photos, bases, r_scan, fx, cx, cy)
        Image.fromarray(pano).save(full_path, quality=90)
        Image.fromarray(pano).resize((PREV_W, PREV_H), Image.LANCZOS).save(prev_path, quality=85)

        entry = {
            "photos": fits,
            "sweep_ncc": round(sweep_ncc, 4),
            "sweep_shift": sweep_shift,
            "ambiguous": [j for j, f in enumerate(fits) if f.get("ambiguous")],
        }
        report["sweeps"][key] = entry
        print(f"{key}: sweep_ncc={entry['sweep_ncc']} "
              f"basis={[f['basis'] for f in fits]} "
              f"ambiguous={entry['ambiguous']}", flush=True)
        del photos, mats, grays, pano, comp_band, comp_cover
        gc.collect()

    report["ambiguous_photos"] = sorted(
        f"{k}#{j}" for k, v in report["sweeps"].items()
        if isinstance(v, dict) for j in v.get("ambiguous", []))
    with open(report_path, "w", encoding="utf8") as f:
        json.dump(report, f, indent=2)
    n_amb = len(report["ambiguous_photos"])
    print(f"done: {len(targets)} targeted, {n_amb} ambiguous photos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
