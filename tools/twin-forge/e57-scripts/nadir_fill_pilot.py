"""Pilot CLI: fill a real sweep's nadir tripod hole from its neighbours.

Reads the forged bundle manifest for scanner world positions, picks the k
nearest same-floor sweeps as donors, solves the floor plane photometrically
(no lidar needed — see solve_floor_z), runs nadir_fill.fill_nadir_hole with
auto smear detection, and writes results to --out ONLY:

    <out>/scan_XXX-before.png      straight-down view, original
    <out>/scan_XXX-after.png       straight-down view, filled
    <out>/scan_XXX-mask.png        detected smear mask overlay
    <out>/scan_XXX-filled.jpg      full filled equirect (base resolution)
    <out>/scan_XXX-report.json     honest numbers (donors, gains, rejects)

Source equirects are opened read-only; nothing under --equirect or the
bundle is modified. Publication of regenerated assets stays the foundry's
lane (docs/handoffs/TWIN-STATUS.md).

Usage:
  python nadir_fill_pilot.py --scan 0 \
      --equirect F:/E57/equirect_fixed \
      --manifest C:/Users/blake/omnitwin2/packages/web/public/twin/trades-hall/manifest.json \
      --out <dir> [--k 5] [--view-size 768] [--detect-rel 0.35] [--detect-cap 6]
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image

import nadir_fill as nf


def load_nodes(manifest_path: str) -> dict[str, dict]:
    with open(manifest_path, "r", encoding="utf8") as f:
        m = json.load(f)
    return {
        n["id"]: {"t": np.array(n["pose"]["t"], dtype=np.float64), "floor": n["floor"]}
        for n in m["nodes"]
    }


def pick_donors(
    nodes: dict[str, dict], target_id: str, k: int, max_dist_m: float = 8.0
) -> list[str]:
    C_t = nodes[target_id]["t"]
    floor = nodes[target_id]["floor"]
    scored = []
    for nid, rec in nodes.items():
        if nid == target_id or rec["floor"] != floor:
            continue
        if abs(rec["t"][2] - C_t[2]) > 0.8:
            continue
        d = float(np.hypot(rec["t"][0] - C_t[0], rec["t"][1] - C_t[1]))
        if 0.05 < d < max_dist_m:
            scored.append((d, nid))
    scored.sort()
    return [nid for _d, nid in scored[:k]]


def solve_floor_z(
    target_img: np.ndarray,
    C_t: np.ndarray,
    donors: list[tuple[np.ndarray, np.ndarray]],
    z_init: float,
    view_size: int = 320,
    half_fov_deg: float = 58.0,
    detect_kwargs: dict | None = None,
    occluder=None,
) -> tuple[float, float]:
    """Photometric floor solve: the z that makes donors' reprojection of the
    RING (floor visible in BOTH target and donors, just outside the smear)
    best agree with the target's own pixels. Coarse-to-fine 1-D search;
    returns (z_floor, best NCC). Self-calibrating — poses validate end-to-end
    on real data because a wrong z visibly shears the reprojection."""
    dirs = nf.gnomonic_nadir_dirs(view_size, half_fov_deg)
    view = nf.render_view(target_img, dirs)
    hole = nf.detect_smear_view(view, **(detect_kwargs or {}))
    from scipy import ndimage

    ring = ndimage.binary_dilation(hole, iterations=10) & ~ndimage.binary_dilation(
        hole, iterations=3
    )
    ring &= dirs[..., 2] < -1e-9
    ry, rx = np.nonzero(ring)
    if ry.size < 200:
        return z_init, 0.0
    dd = dirs[ry, rx]
    tvals = view[ry, rx] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

    # Visibility, computed once at the init height (the answer is
    # insensitive to the +/-0.3 m search range at cabinet scale). Two sides:
    # ring pixels whose OWN ray is mesh-blocked are not floor (cabinet bases
    # in a slot) and leave the solve entirely; then per-donor blindness.
    blocked0: list[np.ndarray | None] = [None] * len(donors)
    if occluder is not None:
        z_ex = z_init + 0.30
        t0 = (z_init - C_t[2]) / dd[:, 2]
        P0 = C_t[None, :] + t0[:, None] * dd
        floor_seen = ~occluder.blocked(C_t, P0, z_exempt_below=z_ex)
        if int(floor_seen.sum()) < 200:
            return z_init, 0.0
        dd = dd[floor_seen]
        tvals = tvals[floor_seen]
        P0 = P0[floor_seen]
        for di, (_dimg, C_d) in enumerate(donors):
            blocked0[di] = occluder.blocked(
                np.asarray(C_d, float), P0, z_exempt_below=z_ex
            )

    def ncc_at(z: float) -> float:
        t = (z - C_t[2]) / dd[:, 2]
        P = C_t[None, :] + t[:, None] * dd
        acc = np.zeros(dd.shape[0], dtype=np.float64)
        wacc = np.zeros(dd.shape[0], dtype=np.float64)
        for di, (dimg, C_d) in enumerate(donors):
            v = P - C_d[None, :]
            ok = (v[:, 2] < -0.05) & (np.hypot(v[:, 0], v[:, 1]) > 0.45)
            if blocked0[di] is not None:
                ok &= ~blocked0[di]
            if not np.any(ok):
                continue
            rows, cols = nf.dirs_to_pixels(v[ok], dimg.shape[1], dimg.shape[0])
            s = nf.sample_equirect(dimg, rows, cols) @ np.array(
                [0.2126, 0.7152, 0.0722], dtype=np.float32
            )
            dist = np.linalg.norm(v[ok], axis=1)
            w = np.clip(-v[ok, 2] / dist, 0, 1) ** 2 / np.maximum(dist**2, 1e-6)
            acc[ok] += w * s
            wacc[ok] += w
        good = wacc > 1e-9
        if good.sum() < 200:
            return -2.0
        pred = acc[good] / wacc[good]
        a = tvals[good] - tvals[good].mean()
        b = pred - pred.mean()
        den = float(np.sqrt((a * a).sum() * (b * b).sum()))
        return float((a * b).sum() / den) if den > 1e-9 else -2.0

    zs = np.arange(z_init - 0.30, z_init + 0.301, 0.02)
    scores = [ncc_at(float(z)) for z in zs]
    z_best = float(zs[int(np.argmax(scores))])
    zs2 = np.arange(z_best - 0.02, z_best + 0.0201, 0.004)
    scores2 = [ncc_at(float(z)) for z in zs2]
    z_fine = float(zs2[int(np.argmax(scores2))])
    # Physical guardrail: scanners stand on tripods. A solved height outside
    # 1.30-1.70 m means the ring was too contaminated to trust — fall back
    # to the nominal tripod height rather than shear the reprojection.
    height = float(C_t[2]) - z_fine
    if not (1.30 <= height <= 1.70):
        return z_init, -abs(float(max(scores2)))
    return z_fine, float(max(scores2))


def save_view_png(img: np.ndarray, path: str, size: int, half_fov: float) -> None:
    view = nf.render_view(img, nf.gnomonic_nadir_dirs(size, half_fov))
    Image.fromarray(view.clip(0, 255).astype(np.uint8)).save(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", type=int, required=True)
    ap.add_argument("--equirect", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--view-size", type=int, default=768)
    ap.add_argument("--half-fov", type=float, default=58.0)
    ap.add_argument("--detect-rel", type=float, default=0.35)
    ap.add_argument("--detect-cap", type=float, default=6.0)
    ap.add_argument("--tripod-radius", type=float, default=0.45)
    ap.add_argument("--ss", action="store_true",
                    help="use the 8192 supersampled panos (scan_XXX_8192.jpg) "
                         "for target AND donors — the viewer's zoom tier")
    ap.add_argument("--mesh", default="",
                    help="dollhouse GLB path: enables mesh donor-visibility "
                         "(the GLB shares the E57 Z-up frame per twin-basis.ts)")
    ap.add_argument("--zoom-fov", type=float, default=30.0,
                    help="half-fov of the zoom-crop proof renders (30 keeps "
                         "the smear boundary in frame at tripod height)")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    key = f"scan_{args.scan:03d}"
    nodes = load_nodes(args.manifest)
    if key not in nodes:
        raise SystemExit(f"{key} not in manifest")
    C_t = nodes[key]["t"]

    def load_eq(nid: str) -> np.ndarray:
        name = f"{nid}_8192.jpg" if args.ss else f"{nid}.jpg"
        p = os.path.join(args.equirect, name)
        # uint8 on purpose: the samplers gather-then-convert, so five 8192
        # donors stay ~100 MB each instead of 400 MB as float32.
        return np.asarray(Image.open(p).convert("RGB"), dtype=np.uint8)

    target = load_eq(key)
    donor_ids = pick_donors(nodes, key, args.k)
    if not donor_ids:
        raise SystemExit(f"{key}: no same-floor donors found")
    donors = [(load_eq(nid), nodes[nid]["t"]) for nid in donor_ids]
    detect_kwargs = {"rel_thresh": args.detect_rel, "abs_cap": args.detect_cap}

    occluder = None
    mesh_info = None
    if args.mesh:
        import trimesh

        m = trimesh.load(args.mesh, force="mesh", process=False)
        tris = np.asarray(m.triangles, dtype=np.float64)
        lo = tris.min(axis=(0, 1))
        hi = tris.max(axis=(0, 1))
        inside = (
            lo[0] - 1 < C_t[0] < hi[0] + 1 and lo[1] - 1 < C_t[1] < hi[1] + 1
        )
        occluder = nf.VoxelOccluder.from_triangles(tris, voxel=0.10)
        mesh_info = {
            "tris": int(tris.shape[0]),
            "bounds_lo": [round(float(x), 2) for x in lo],
            "bounds_hi": [round(float(x), 2) for x in hi],
            "target_inside_xy": bool(inside),
            "grid_shape": list(occluder.grid.shape),
            "occupancy_pct": round(float(occluder.grid.mean()) * 100.0, 2),
        }
        print("mesh:", json.dumps(mesh_info))
        if not inside:
            raise SystemExit(
                "mesh XY bounds do not contain the target scanner — frame "
                "mismatch, refusing to fill with a wrong occluder"
            )

    z_floor, ncc = solve_floor_z(
        target, C_t, donors, z_init=float(C_t[2]) - 1.5,
        detect_kwargs=detect_kwargs, occluder=occluder,
    )

    filled, report = nf.fill_nadir_hole(
        target,
        C_t,
        donors,
        z_floor=z_floor,
        hole_mask_eq=None,
        tripod_radius=args.tripod_radius,
        view_size=args.view_size,
        half_fov_deg=args.half_fov,
        detect_kwargs=detect_kwargs,
        occluder=occluder,
    )
    if mesh_info is not None:
        report["mesh"] = mesh_info
    report["scan"] = key
    report["donor_ids"] = donor_ids
    report["z_floor"] = round(z_floor, 4)
    report["floor_solve_ncc"] = round(ncc, 4)
    report["scanner_height_m"] = round(float(C_t[2]) - z_floor, 4)

    save_view_png(target, os.path.join(args.out, f"{key}-before.png"),
                  args.view_size, args.half_fov)
    save_view_png(filled, os.path.join(args.out, f"{key}-after.png"),
                  args.view_size, args.half_fov)

    # Mask overlay for honesty: what the detector decided to replace.
    dirs = nf.gnomonic_nadir_dirs(args.view_size, args.half_fov)
    view = nf.render_view(target, dirs)
    mask = nf.detect_smear_view(view, **detect_kwargs)
    overlay = view.copy()
    overlay[mask] = overlay[mask] * 0.45 + np.array([255.0, 90.0, 40.0]) * 0.55
    Image.fromarray(overlay.clip(0, 255).astype(np.uint8)).save(
        os.path.join(args.out, f"{key}-mask.png")
    )

    # Zoom-tier proof: tight straight-down crops of before vs after, plus
    # grain metrics measured on the DELIVERED pixels at zoom.
    from scipy import ndimage as ndi

    zdirs = nf.gnomonic_nadir_dirs(640, args.zoom_fov)
    zb = nf.render_view(target, zdirs)
    za = nf.render_view(filled, zdirs)
    Image.fromarray(zb.clip(0, 255).astype(np.uint8)).save(
        os.path.join(args.out, f"{key}-zoom-before.png")
    )
    Image.fromarray(za.clip(0, 255).astype(np.uint8)).save(
        os.path.join(args.out, f"{key}-zoom-after.png")
    )
    zmask = nf.detect_smear_view(zb, **detect_kwargs)
    zring = ndi.binary_dilation(zmask, iterations=12) & ~ndi.binary_dilation(
        zmask, iterations=3
    )
    lum_w = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

    def dstd(v, m):
        lp = ndi.gaussian_filter(v, (2.5, 2.5, 0.0))
        return float((((v - lp) @ lum_w)[m]).std())

    if int(zmask.sum()) > 500 and int(zring.sum()) > 500:
        report["zoom_grain_ratio"] = round(
            dstd(za, zmask) / max(dstd(za, zring), 1e-6), 3
        )
        inner = zmask & ~ndi.binary_erosion(zmask, iterations=3)
        outer = ndi.binary_dilation(zmask, iterations=3) & ~zmask
        step = abs(float((za[inner] @ lum_w).mean() - (za[outer] @ lum_w).mean()))
        report["zoom_boundary_step_pct"] = round(step / 255.0 * 100.0, 3)
    report["ss"] = bool(args.ss)
    report["zoom_half_fov_deg"] = args.zoom_fov

    Image.fromarray(filled.clip(0, 255).astype(np.uint8)).save(
        os.path.join(args.out, f"{key}-filled.jpg"), quality=90
    )
    with open(os.path.join(args.out, f"{key}-report.json"), "w", encoding="utf8") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
