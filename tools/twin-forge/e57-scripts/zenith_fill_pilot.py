"""Run the zenith fill on ONE real sweep and show its work.

The mirror of nadir_fill_pilot. Loads a sweep and its neighbours from the
published bundle, solves the ceiling height photometrically, fills the blind
cone overhead, and writes straight-up before/after PNGs so a human can certify
the result by looking — which is the only certification this stage accepts.
The flat-region metric that gates the floor fill is unreliable overhead, so
there is deliberately no numeric pass/fail here.

Two things it will refuse to do:
  - fill a node whose ceiling is not planar (a dome), and
  - invent any pixel no donor could witness.

Usage:
  python zenith_fill_pilot.py --scan 126 \
    --equirect "F:/E57/equirect_filled" \
    --manifest "C:/.../public/twin/trades-hall/manifest.json" \
    --out "D:/claude/twin-cad-evidence/zenith"
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import nadir_fill as nf  # noqa: E402
import zenith_fill as zf  # noqa: E402


def load_nodes(manifest_path: str) -> dict[str, dict]:
    with open(manifest_path, "r", encoding="utf8") as f:
        m = json.load(f)
    return {
        n["id"]: {"t": np.array(n["pose"]["t"], dtype=np.float64), "floor": n["floor"]}
        for n in m["nodes"]
    }


def pick_zenith_donors(
    nodes: dict[str, dict],
    target_id: str,
    cone_radius_m: float,
    k: int,
    max_dist_m: float = 9.0,
) -> list[str]:
    """Donors for the ceiling, ranked by THE MIRROR RULE.

    Anything closer than the cone radius is blind in the same place as the
    target and is dropped outright, however convenient its distance. What
    survives is ranked by distance among the eligible — nearest-first over ALL
    neighbours, the nadir's ranking, would systematically pick the worst
    witnesses.
    """
    C_t = nodes[target_id]["t"]
    floor = nodes[target_id]["floor"]
    scored: list[tuple[float, str]] = []
    for nid, rec in nodes.items():
        if nid == target_id or rec["floor"] != floor:
            continue
        if abs(rec["t"][2] - C_t[2]) > 0.8:
            continue  # a different storey's scanner cannot see this ceiling
        d = float(np.hypot(rec["t"][0] - C_t[0], rec["t"][1] - C_t[1]))
        if d <= cone_radius_m or d > max_dist_m:
            continue  # inside its own cone, or too far to resolve anything
        scored.append((d, nid))
    scored.sort()
    return [nid for _d, nid in scored[:k]]


def zenith_view_dirs(size: int, half_fov_deg: float) -> np.ndarray:
    """Gnomonic directions for a straight-UP view — the mirror of
    nadir_fill.gnomonic_nadir_dirs, so before/after frames are comparable."""
    half = np.tan(np.radians(half_fov_deg))
    lin = np.linspace(-half, half, size)
    gx, gy = np.meshgrid(lin, lin)
    dirs = np.stack([gx, gy, np.ones_like(gx)], axis=-1)
    return dirs / np.linalg.norm(dirs, axis=-1, keepdims=True)


def solve_ceiling_z(
    target: np.ndarray,
    C_t: np.ndarray,
    donors: list[tuple[np.ndarray, np.ndarray]],
    lo: float | None = None,
    hi: float | None = None,
    step: float = 0.02,
    ring_deg: float = 8.0,
    cone_half_deg: float = 25.0,
    mask: np.ndarray | None = None,
) -> tuple[float, float]:
    """Ceiling height by photometric consensus, the way the floor solve works.

    For each candidate height, reproject the ring of ceiling just outside the
    blind cone into every donor and measure how well each donor agrees with the
    TARGET's own pixels there. The true height is where the reprojection lands
    on the same physical texture in every sweep; a wrong height smears each
    donor differently. Returns (z, agreement).
    """
    # The search window is RELATIVE TO THE SCANNER, never absolute. E57 world z
    # is not height-above-floor: scan_126 stands at z = -1.38 on the lower
    # storey, so its 3.2 m ceiling sits near z = +0.3. An absolute 2..9 m
    # window — which the synthetic scene happened to satisfy, its scanner being
    # at z = 1.5 — misses that ceiling entirely and pins the solve at the
    # boundary. A ceiling is between ~1 m and ~9 m ABOVE the tripod; say that.
    eye = float(np.asarray(C_t, dtype=np.float64)[2])
    lo = eye + 1.0 if lo is None else lo
    hi = eye + 9.0 if hi is None else hi
    h, w = target.shape[:2]
    if mask is None:
        mask = zf.zenith_cone_mask(h, w, cone_half_deg, feather_deg=ring_deg) & ~zf.zenith_cone_mask(
            h, w, cone_half_deg
        )
    rr, cc = np.nonzero(mask)
    if rr.size == 0:
        return float("nan"), 0.0
    stride = max(1, rr.size // 1500)
    rr, cc = rr[::stride], cc[::stride]
    # Vectorized throughout: this is a grid search over ~400 candidate heights
    # against every donor, so a per-point Python loop here costs millions of
    # scalar calls and turns a batch into an overnight job.
    dirs = nf.equirect_grid_dirs(w, h, 0, h)[rr, cc]
    tgt = target[rr, cc].astype(np.float64).mean(axis=1)  # luminance is enough

    best_z, best_score = float("nan"), -np.inf
    for z in np.arange(lo, hi + 1e-9, step):
        P, valid = zf.rays_ceiling_intersection(C_t, dirs, float(z))
        if valid.sum() < 32:
            continue
        idx = np.nonzero(valid)[0]
        Pv = P[idx]
        agree = []
        for donor_img, C_d in donors:
            d_rows, d_cols = nf.dirs_to_pixels(Pv - np.asarray(C_d, dtype=np.float64), w, h)
            vals = nf.sample_equirect(donor_img, d_rows, d_cols).astype(np.float64).mean(axis=1)
            a, b = tgt[idx], vals
            if a.std() < 1e-6 or b.std() < 1e-6:
                continue
            agree.append(float(np.corrcoef(a, b)[0, 1]))
        if not agree:
            continue
        score = float(np.mean(agree))
        if score > best_score:
            best_z, best_score = float(z), score
    return best_z, best_score


def sample_ceiling_heights(
    target: np.ndarray,
    C_t: np.ndarray,
    donors: list[tuple[np.ndarray, np.ndarray]],
    z_hint: float,
    cone_half_deg: float,
) -> np.ndarray:
    """Per-azimuth ceiling heights around the cone, for the planarity gate.
    Each sample re-solves the height on one narrow wedge, so a dome — whose
    height climbs toward the centre and differs wedge to wedge as the fit
    chases the curve — shows a wide spread where a flat ceiling agrees."""
    h, w = target.shape[:2]
    band = zf.zenith_cone_mask(h, w, cone_half_deg, feather_deg=10.0) & ~zf.zenith_cone_mask(
        h, w, cone_half_deg
    )
    cols = np.arange(w)
    heights = []
    for az0 in range(0, 360, 45):
        wedge = ((cols * 360.0 / w) >= az0) & ((cols * 360.0 / w) < az0 + 45)
        sub = band.copy()
        sub[:, ~wedge] = False
        if sub.sum() < 64:
            continue
        z, score = solve_ceiling_z(
            target, C_t, donors,
            lo=max(float(C_t[2]) + 0.5, z_hint - 1.5), hi=z_hint + 3.0, step=0.05,
            cone_half_deg=cone_half_deg, mask=sub,
        )
        if np.isfinite(z) and score > 0.2:
            heights.append(z)
    return np.array(heights, dtype=np.float64)


def save_png(img: np.ndarray, path: str) -> None:
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", type=int, required=True)
    ap.add_argument("--equirect", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--cone-half-deg", type=float, default=25.0)
    ap.add_argument("--view-size", type=int, default=768)
    ap.add_argument("--half-fov", type=float, default=58.0)
    ap.add_argument("--z-ceiling", type=float, default=float("nan"),
                    help="override the photometric solve (metres, E57 frame)")
    ap.add_argument("--force", action="store_true",
                    help="fill even when the ceiling fails the planarity gate")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    target_id = f"scan_{args.scan:03d}"
    nodes = load_nodes(args.manifest)
    if target_id not in nodes:
        print(f"unknown scan {target_id}")
        return 2
    C_t = nodes[target_id]["t"]

    target_path = os.path.join(args.equirect, f"{target_id}.jpg")
    target = np.asarray(Image.open(target_path).convert("RGB"), dtype=np.float32)
    h, w = target.shape[:2]
    print(f"target {target_id} at {C_t.round(2)}  {w}x{h}")

    # A provisional cone radius, refined once the height is known.
    provisional = zf.zenith_cone_radius_m(C_t[2] + 3.5, C_t[2], args.cone_half_deg)
    donor_ids = pick_zenith_donors(nodes, target_id, provisional, args.k)
    if not donor_ids:
        print("no donors outside the blind cone — nothing to fill from")
        return 3
    donors = []
    for nid in donor_ids:
        p = os.path.join(args.equirect, f"{nid}.jpg")
        if not os.path.exists(p):
            continue
        donors.append((np.asarray(Image.open(p).convert("RGB"), dtype=np.float32), nodes[nid]["t"]))
    print(f"donors (mirror rule, > {provisional:.2f} m away): {', '.join(donor_ids)}")

    if np.isfinite(args.z_ceiling):
        z_ceiling, score = float(args.z_ceiling), float("nan")
        print(f"ceiling height {z_ceiling:.2f} m (supplied)")
    else:
        z_ceiling, score = solve_ceiling_z(
            target, C_t, donors, cone_half_deg=args.cone_half_deg
        )
        print(f"ceiling height {z_ceiling:.2f} m solved photometrically (agreement {score:.3f})")
    if not np.isfinite(z_ceiling):
        print("could not solve a ceiling height — refusing to fill")
        return 4

    heights = sample_ceiling_heights(target, C_t, donors, z_ceiling, args.cone_half_deg)
    planar = zf.ceiling_is_planar(heights, tolerance_m=0.25) if heights.size else False
    # The gate judges a 5-95 percentile spread; print THAT, not a peak-to-peak,
    # or two nodes print the same number and get opposite verdicts.
    spread = zf.ceiling_planarity_spread(heights) if heights.size else float("nan")
    print(f"planarity: {heights.size} wedge solves, spread {spread:.2f} m -> "
          f"{'planar' if planar else 'NOT one plane (dome, soffit or stair)'}")
    if not planar and not args.force:
        print("refusing: the ceiling is not one plane; re-run with --force to override")
        report = {"scan": target_id,
                  "refused": "ceiling is not one plane (dome, soffit or stair)",
                  "z_ceiling_m": z_ceiling, "planarity_spread_m": spread,
                  "donors": donor_ids}
        with open(os.path.join(args.out, f"{target_id}-zenith.json"), "w", encoding="utf8") as f:
            json.dump(report, f, indent=2)
        return 5

    dirs = zenith_view_dirs(args.view_size, args.half_fov)
    before = nf.render_view(target, dirs)
    save_png(before, os.path.join(args.out, f"{target_id}-zenith-before.png"))

    filled, rep = zf.fill_zenith_hole(
        target, C_t, donors, z_ceiling=z_ceiling,
        cone_half_deg=args.cone_half_deg, eye_height=float(C_t[2]),
    )
    after = nf.render_view(filled, dirs)
    save_png(after, os.path.join(args.out, f"{target_id}-zenith-after.png"))

    report = {
        "scan": target_id,
        "z_ceiling_m": z_ceiling,
        "solve_agreement": score,
        "planarity_spread_m": spread,
        "planar": bool(planar),
        "cone_radius_m": rep["cone_radius_m"],
        "donors": donor_ids,
        "donors_used": rep["donors_used"],
        "hole_px": rep["hole_px"],
        "filled_px": rep["filled_px"],
        "donorless_px": rep["donorless_px"],
        "synth_px": rep["synth_px"],
    }
    with open(os.path.join(args.out, f"{target_id}-zenith.json"), "w", encoding="utf8") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))
    print(f"wrote before/after to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
