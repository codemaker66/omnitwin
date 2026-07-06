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

SUPERSAMPLED RENDER (2026-07-05). The render stage rasterises the sphere at
8192x4096 (~22.8 px/deg - a mild 2x ratio against the ~45.5 px/deg native
photos, safe for plain bilinear taps) and LANCZOS-downscales to the 4096x2048
delivery base. The previous direct 4096 render point-sampled a 4x decimation
with NO prefilter - detail was destroyed and aliased in the asset itself (the
crisp cubemaps_photo_v3 faces prove the sources are pristine). Rendering runs
in 8192x512 horizontal bands accumulated into one uint8 canvas so no process
ever holds more than one band of float intermediates. Outputs per sweep:
scan_NNN_8192.jpg (q85), scan_NNN.jpg (LANCZOS 4096x2048, q90 - the crisp
delivery base) and scan_NNN_preview.jpg (LANCZOS 512x256, q85).

--bases-from: reuse per-photo orientations already solved by a previous run
(its _equirect_v2_report.json) instead of re-running the 48-candidate fit.
The full-res render never consumed anything but the fitted bases (the
per-photo az shift was fit-scoring tolerance only), so loading them is
render-identical. Sweeps missing from that report still fit fresh.
--verify-fit: run the fit anyway and assert it reproduces the loaded report's
bases exactly (the fit is deterministic) - the validation gate run on a few
sweeps before a bulk --bases-from pass.
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
# Native-resolution sampling (2026-07-05): the skybox photos are 4096 sq
# (2048 px per 90 deg = an 8192-wide sphere equivalent); downsampling the
# sources starves the output. 4096-wide output = 11.4 px/deg = sharpness
# parity with the legacy cube tiles Blake judged high-res; 2048 (the first
# equirect ship) was half that and read as "terrible resolution".
SRC_SIZE = 4096
# Each skybox face is an EXACT 90-deg pinhole, so adjacent faces meet at 45 deg
# with zero overlap. The strict `uu <= SRC_SIZE - 1` acceptance then left a
# ~0.03-deg band BETWEEN neighbours that no face claimed; those pixels kept the
# zero-init canvas and rendered as a thin BLACK seam along every cube edge (the
# 2026-07 "stitching line" report). EDGE_PAD widens each face's acceptance by a
# couple of px so neighbours overlap and the gap closes; nearest-camera-wins
# still picks the better-aligned face everywhere but the hairline boundary.
EDGE_PAD = 2.0
# Hard nearest-camera-wins also baked a SECOND, subtler seam: each face is
# sampled out to its 45-deg edge where lens vignetting leaves the photo edges a
# few percent darker, and with no cross-fade the two dark edges butt into a thin
# 2-4% dark LINE at every cube boundary (the eye's hyperacuity catches the sharp
# step even though it is shallow). Instead of argmax we now accumulate every
# covered face weighted by alignment z=cos(angle-to-axis) raised to BLEND_POWER:
# away from boundaries the aligned face dominates (detail preserved), but across
# each edge the two ~equal-z faces cross-fade, spreading the dip into an
# imperceptible gradient. All six faces share one optical centre, so blending is
# parallax-free (no ghosting).
BLEND_POWER = 16.0
# Supersampled render raster (SUPERSAMPLED RENDER, module docstring): render
# at 8192 wide, deliver the LANCZOS-prefiltered 4096 base alongside it.
SS_W, SS_H = 8192, 4096
BAND_ROWS = 512  # 8192x512 render bands - bounded float footprint per band
OUT_W, OUT_H = 4096, 2048
PREV_W, PREV_H = 512, 256
SS_JPEG_QUALITY = 85
BASE_JPEG_QUALITY = 90
PREV_JPEG_QUALITY = 85
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


def world_equirect_band_dirs(w, h, row0, rows):
    """Unit ray grid (rows x w x 3) for one horizontal band of the
    full-sphere equirect raster, E57 WORLD frame (Z-up). Row 0 of the FULL
    raster = zenith; azimuth from +X toward +Y. Convention identical to
    v1/v2 - only the resolution and the banding are new."""
    el = np.pi / 2 - (np.arange(row0, row0 + rows) + 0.5) / h * np.pi
    az = (np.arange(w) + 0.5) / w * 2 * np.pi
    cos_el = np.cos(el)[:, None]
    return np.stack([
        cos_el * np.cos(az)[None, :],
        cos_el * np.sin(az)[None, :],
        np.broadcast_to(np.sin(el)[:, None], (rows, w)),
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


def render_world_band(row0, rows, w, h, photos, cam_world, fx, cx, cy):
    """One horizontal band of the world-frame composite: per-pixel
    nearest-camera-wins (max forward z) across the photos, bilinear taps -
    semantics identical to the pre-supersampling whole-frame renderer,
    just band-shaped. `cam_world` = per-photo world-frame camera matrices
    (columns fwd/right/down), precomputed once per sweep."""
    flat = world_equirect_band_dirs(w, h, row0, rows).reshape(-1, 3)
    n = rows * w
    accum = np.zeros((n, 3), dtype=np.float32)  # alignment-weighted colour sum
    wsum = np.zeros(n, dtype=np.float32)         # weight sum (for normalisation)
    for img, m in zip(photos, cam_world):
        zxy = flat @ m
        z = zxy[:, 0]
        x = zxy[:, 1]
        y = zxy[:, 2]
        del zxy
        with np.errstate(divide="ignore", invalid="ignore"):
            uu = fx * x / z + cx
            vv = fx * y / z + cy
        # EDGE_PAD overlap (see the constant): accept a couple px past each face
        # edge so neighbours meet with no coverage gap.
        valid = (z > 0.05) & (uu >= -EDGE_PAD) & (uu <= SRC_SIZE - 1 + EDGE_PAD) \
            & (vv >= -EDGE_PAD) & (vv <= SRC_SIZE - 1 + EDGE_PAD)
        vi = np.nonzero(valid)[0]
        if vi.size == 0:
            del z, x, y, uu, vv, valid
            continue
        # Alignment weight z^BLEND_POWER (see the constant): 1 at the face centre,
        # ~0.707^p at its 45-deg edge, so the aligned face dominates away from
        # boundaries and the two near-equal-z faces cross-fade across each edge.
        weight = np.power(np.maximum(z[vi], 0.0), BLEND_POWER).astype(np.float32)
        # Clamp into the real texel range so a padded boundary ray reads the
        # face's EDGE texel (fu/fv stay in [0,1]) rather than extrapolating.
        uu_t = np.clip(uu[vi], 0.0, SRC_SIZE - 1.0)
        vv_t = np.clip(vv[vi], 0.0, SRC_SIZE - 1.0)
        u0 = np.clip(uu_t.astype(np.int32), 0, SRC_SIZE - 2)
        v0 = np.clip(vv_t.astype(np.int32), 0, SRC_SIZE - 2)
        fu = (uu_t - u0)[:, None]
        fv = (vv_t - v0)[:, None]
        # Bilinear gather straight off the uint8 photo (band memory discipline).
        sample = ((img[v0, u0] * (1 - fu) + img[v0, u0 + 1] * fu) * (1 - fv)
                  + (img[v0 + 1, u0] * (1 - fu) + img[v0 + 1, u0 + 1] * fu) * fv)
        wcol = weight[:, None]
        accum[vi] += wcol * sample.astype(np.float32)
        wsum[vi] += weight
        del z, x, y, uu, vv, valid, vi, weight, uu_t, vv_t, u0, v0, fu, fv, sample, wcol
    out = np.zeros((n, 3), dtype=np.uint8)
    covered = wsum > 1e-6
    out[covered] = np.clip(
        accum[covered] / wsum[covered, None], 0, 255).astype(np.uint8)
    return out.reshape(rows, w, 3)


def render_world_ss(photos, bases, r_scan, fx, cx, cy):
    """The supersampled SS_W x SS_H world-frame composite, rendered in
    BAND_ROWS-high bands accumulated into one uint8 canvas."""
    # camera axes in WORLD frame; z/x/y = world ray dotted with each column
    cam_world = [(r_scan @ np.column_stack([f, r, d])).astype(np.float32)
                 for f, r, d in bases]
    canvas = np.zeros((SS_H, SS_W, 3), dtype=np.uint8)
    for row0 in range(0, SS_H, BAND_ROWS):
        canvas[row0:row0 + BAND_ROWS] = render_world_band(
            row0, BAND_ROWS, SS_W, SS_H, photos, cam_world, fx, cx, cy)
    return canvas


def parse_basis_name(name):
    """Inverse of build_candidates' naming: 'f+z_r-y_p' -> (fwd, right, down)
    scanner-frame axes. 'p' bases carry d = f x r, 'm' (mirrored) the
    negation - exactly how the candidates were built, so a loaded basis
    renders identically to the fitted one."""
    fpart, rpart, kind = name.split("_")
    if kind not in ("p", "m") or fpart[0] != "f" or rpart[0] != "r":
        raise ValueError(f"unrecognised basis name: {name}")
    f = AXES[fpart[1:]]
    r = AXES[rpart[1:]]
    d = np.cross(f, r)
    return f, r, (d if kind == "p" else -d)


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
    ap.add_argument("--bases-from", default="",
                    help="path to a previous run's _equirect_v2_report.json; "
                         "sweeps present there reuse the solved bases and "
                         "skip the fit (the render consumes only the bases)")
    ap.add_argument("--verify-fit", action="store_true",
                    help="run the fit even when --bases-from covers a sweep "
                         "and assert it reproduces that report's bases")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    bases_src = {}
    if args.bases_from:
        with open(args.bases_from, "r", encoding="utf8") as f:
            bases_src = json.load(f).get("sweeps", {})

    report_path = os.path.join(args.out, "_equirect_v2_report.json")
    report = {
        "raster": "world-frame Z-up; row0=zenith; az=atan2(y,x) from +X toward +Y",
        "truth": "lidar pano v-flipped to zenith-top (stored nadir-at-row-0), columns +az (CCW), scanner frame",
        "fit": "48 axis-aligned scanner-frame camera bases per photo, masked NCC vs lidar truth",
        "az_shift0": AZ_SHIFT0,
        "supersample": {"render": [SS_W, SS_H], "band_rows": BAND_ROWS,
                        "base": [OUT_W, OUT_H], "downscale": "lanczos"},
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

    fit_grid = scanner_pano_dirs(FIT_W, FIT_H)
    fit_flat = fit_grid.reshape(-1, 3)

    def save_report():
        report["ambiguous_photos"] = sorted(
            f"{k}#{j}" for k, v in report["sweeps"].items()
            if isinstance(v, dict) for j in v.get("ambiguous", []))
        with open(report_path, "w", encoding="utf8") as f:
            json.dump(report, f, indent=2)

    targets = parse_scans(args.scans, n_scans)
    for scan in targets:
        key = f"scan_{scan:03d}"
        full_path = os.path.join(args.out, f"{key}.jpg")
        ss_path = os.path.join(args.out, f"{key}_8192.jpg")
        prev_path = os.path.join(args.out, f"{key}_preview.jpg")
        done = (os.path.exists(full_path) and os.path.exists(prev_path)
                and os.path.exists(ss_path)
                and isinstance(report["sweeps"].get(key), dict)
                and "sweep_ncc" in report["sweeps"][key])
        if done and not args.force:
            continue
        if len(per_scan.get(scan, [])) != 6:
            report["sweeps"][key] = "MISSING_IMAGES"
            print(f"{key}: MISSING_IMAGES", flush=True)
            continue

        src_entry = bases_src.get(key)
        loadable = (isinstance(src_entry, dict)
                    and len(src_entry.get("photos", [])) == 6)
        r_scan = scan_rot[scan]

        if loadable and not args.verify_fit:
            # Render stage only: apply the already-solved bases verbatim.
            photos, mats = load_photos(scan)
            bases = [parse_basis_name(p["basis"]) for p in src_entry["photos"]]
            entry = {
                "photos": src_entry["photos"],
                "sweep_ncc": src_entry["sweep_ncc"],
                "sweep_shift": src_entry.get("sweep_shift", 0),
                "ambiguous": src_entry.get("ambiguous", []),
                "bases_source": "loaded",
            }
        else:
            truth = lidar_truth(scan)
            if truth is None:
                report["sweeps"][key] = "NO_LIDAR_PANO"
                print(f"{key}: NO_LIDAR_PANO", flush=True)
                continue
            signal = truth > T_SIGNAL

            photos, mats = load_photos(scan)
            grays = [p.mean(axis=2) for p in photos]

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

            if args.verify_fit and loadable:
                got = [rec["basis"] for rec in fits]
                want = [p["basis"] for p in src_entry["photos"]]
                if got != want:
                    raise AssertionError(
                        f"{key}: deterministic fit diverged from --bases-from "
                        f"report: fit={got} report={want}")
                print(f"{key}: fit verified identical to --bases-from report",
                      flush=True)

            # --- whole-sweep acceptance: corrected composite vs truth ---
            shifts = [(AZ_SHIFT0 + s) % FIT_W
                      for s in range(-AZ_SHIFT_SPAN, AZ_SHIFT_SPAN + 1)]
            sweep_ncc, sweep_shift = masked_ncc(comp_band, comp_cover, truth,
                                                signal, shifts)
            entry = {
                "photos": fits,
                "sweep_ncc": round(sweep_ncc, 4),
                "sweep_shift": sweep_shift,
                "ambiguous": [j for j, f in enumerate(fits) if f.get("ambiguous")],
                "bases_source": "fit",
            }
            del grays, comp_band, comp_cover, truth, signal

        # --- supersampled world-frame composite with the solved bases ---
        canvas = render_world_ss(photos, bases, r_scan, fx, cx, cy)
        ss_img = Image.fromarray(canvas)
        ss_img.save(ss_path, quality=SS_JPEG_QUALITY)
        base_img = ss_img.resize((OUT_W, OUT_H), Image.LANCZOS)
        base_img.save(full_path, quality=BASE_JPEG_QUALITY)
        ss_img.resize((PREV_W, PREV_H), Image.LANCZOS).save(
            prev_path, quality=PREV_JPEG_QUALITY)
        base_img.close()
        ss_img.close()

        report["sweeps"][key] = entry
        save_report()  # per-sweep flush: a killed chunk resumes cleanly
        print(f"{key}: sweep_ncc={entry['sweep_ncc']} "
              f"bases_source={entry['bases_source']} "
              f"basis={[p['basis'] for p in entry['photos']]} "
              f"ambiguous={entry['ambiguous']}", flush=True)
        del photos, mats, bases, canvas
        gc.collect()

    save_report()
    n_amb = len(report["ambiguous_photos"])
    print(f"done: {len(targets)} targeted, {n_amb} ambiguous photos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
