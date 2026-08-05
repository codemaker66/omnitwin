"""Build a real Floor Atlas for one room of a real capture.

Reads scanner poses from the forged bundle manifest, fuses every sweep that
saw the requested floor region, and writes a metrically-true orthophoto plus
an honest coverage map. Sources are opened READ-ONLY; everything lands under
--out. Nothing here publishes.

  python floor_atlas_build.py --out <dir> \
      --equirect F:/E57/equirect_fixed \
      --manifest .../twin/trades-hall/manifest.json \
      --bounds 8.4 -4.5 22 18 --mm-per-px 8 \
      [--ss] [--mesh <glb>] [--max-sources 60] \
      [--floor-mask] [--orthophoto] [--provenance]

--bounds is CENTRE_X CENTRE_Y WIDTH_M HEIGHT_M in E57 world metres.

--floor-mask restricts the fusion to cells the mesh says are really floor
(floor_polygon), so walls and plinths stop being fused as if they were oak.
It requires --mesh and it REFUSES TO RUN on a z_floor that disagrees with the
mesh — see check_floor_height below for why that guard is not `mask.any()`.

--orthophoto writes the georeferenced deliverable (PNG + ESRI .pgw + .json
sidecars) via atlas_export instead of a bare PNG. --provenance additionally
records per-cell look counts and sampling geometry.
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image

import floor_atlas as fa
import nadir_fill as nf

# How far the floor-height agreement probes may disagree before the build
# refuses. At a correct z_floor the centre probe is the peak by a wide margin
# (measured on a +/-20 mm undulating slab: centre 1.0000 against 0.4926 and
# 0.5074 either side), so 0.02 is slack for mesh noise and nothing more.
FLOOR_HEIGHT_SLACK = 0.02


def check_floor_height(grid, z_floor: float, tris: np.ndarray, tol_m: float) -> dict:
    """Is z_floor really where the mesh puts the floor? Returns a report.

    WHY THIS IS NOT `mask.any()`, which is the check floor_polygon's own
    docstring asks a caller to make. `mask.any()` is sufficient only when the
    floor is a mathematical plane, because then the failure is a cliff: the
    +/-tol_m band either contains the slab or it does not. A laser-scanned
    floor undulates, and the cliff becomes a ramp — the mask stays non-empty
    while most of the real floor silently disappears. Measured here on a 32x32
    tessellated slab with uniform vertical noise, the fraction of the grid the
    mask keeps against the error in z_floor:

        undulation      +0 mm    +40 mm    +50 mm    +60 mm
          +/- 0 mm      100.0%    100.0%    100.0%      0.0% (empty)
          +/-10 mm      100.0%    100.0%     50.5%      0.0% (empty)
          +/-20 mm      100.0%     88.5%     50.7%     13.5%
          +/-30 mm      100.0%     78.0%     50.4%     24.2%

    At +/-20 mm of undulation with z_floor 40 mm out, `mask.any()` is True, a
    refusal keyed on it never fires, and 11 points of real floor are ANDed out
    of the atlas — quietly, because those cells come back merely "unobserved".
    This matters because --z-floor defaults to `median scanner z - 1.5`, which
    is a guess, and tol_m is only +/-50 mm.

    So the guard is a SHAPE test, not an emptiness test. Rasterise condition
    (a) at z_floor - tol_m, z_floor and z_floor + tol_m: the band is symmetric
    about z_floor, so a correct estimate puts the most surface inside the
    CENTRE probe and both neighbours below it. On the same sweep the centre
    probe stops being the peak at exactly the errors the table shows damage at
    — 40 mm for +/-20 mm undulation, 50 mm for +/-10 mm — while at zero error
    it is the peak in every condition measured (1.0000 against ~0.49/0.51).

    Both tests are kept, because they fail differently: the peak test is blind
    to a z_floor so far off that all three probes are empty (they tie at zero,
    which reads as a peak), and the emptiness test is blind to the ramp.
    Neither is redundant and the build refuses on either.
    """
    import floor_polygon as fp

    lo, mid, hi = (
        float(fp.surface_at_floor_height(grid, z_floor + d, tris, tol_m=tol_m).mean())
        for d in (-tol_m, 0.0, tol_m)
    )
    empty = mid <= 0.0
    off_peak = mid < max(lo, hi) - FLOOR_HEIGHT_SLACK
    return {
        "probe_below": round(lo, 4),
        "probe_at": round(mid, 4),
        "probe_above": round(hi, 4),
        "tol_m": tol_m,
        "ok": bool(not (empty or off_peak)),
        "why": (
            "no mesh surface within tol_m of z_floor" if empty
            else "z_floor is off-centre: a shifted band finds more surface"
            if off_peak else "z_floor agrees with the mesh"
        ),
    }


def load_nodes(manifest_path: str) -> dict[str, dict]:
    with open(manifest_path, "r", encoding="utf8") as f:
        m = json.load(f)
    return {
        n["id"]: {"t": np.array(n["pose"]["t"], dtype=np.float64), "floor": n["floor"]}
        for n in m["nodes"]
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--equirect", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bounds", nargs=4, type=float, required=True,
                    metavar=("CX", "CY", "W", "H"))
    ap.add_argument("--mm-per-px", type=float, default=8.0)
    ap.add_argument("--ss", action="store_true", help="use the 8192 panos")
    ap.add_argument("--mesh", default="")
    ap.add_argument("--max-sources", type=int, default=60)
    ap.add_argument("--z-floor", type=float, default=None,
                    help="world z of the floor; default = median scanner z - 1.5")
    ap.add_argument("--radius-m", type=float, default=14.0,
                    help="only fuse sweeps within this distance of the region")
    ap.add_argument("--label", default="room")
    ap.add_argument("--floor-mask", action="store_true",
                    help="fuse only cells the mesh says are floor (needs --mesh)")
    ap.add_argument("--clearance-m", type=float, default=None,
                    help="free height a cell needs to count as floor "
                         "(default 1.2; see floor_polygon for the frontier)")
    ap.add_argument("--orthophoto", action="store_true",
                    help="write a georeferenced plate (.png + .pgw + .json)")
    ap.add_argument("--dpi", type=float, default=None,
                    help="print resolution to stamp into the orthophoto")
    ap.add_argument("--provenance", action="store_true",
                    help="record per-cell looks and sampling geometry")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    cx, cy, wm, hm = args.bounds
    grid = fa.AtlasGrid(
        origin_xy=(cx - wm / 2.0, cy - hm / 2.0),
        mm_per_px=args.mm_per_px,
        width=int(round(wm * 1000.0 / args.mm_per_px)),
        height=int(round(hm * 1000.0 / args.mm_per_px)),
    )
    print(f"atlas: {grid.width}x{grid.height} px @ {args.mm_per_px} mm/px "
          f"= {grid.width_m:.2f} x {grid.height_m:.2f} m", flush=True)

    nodes = load_nodes(args.manifest)
    near = sorted(nodes.items(),
                  key=lambda kv: float(np.hypot(kv[1]["t"][0] - cx, kv[1]["t"][1] - cy)))
    storey_z = float(np.median([r["t"][2] for _k, r in near[:12]]))
    z_floor = args.z_floor if args.z_floor is not None else storey_z - 1.5
    print(f"scanner z median (near region): {storey_z:.3f} -> z_floor {z_floor:.3f}",
          flush=True)

    picks = []
    for nid, rec in nodes.items():
        t = rec["t"]
        if abs(t[2] - storey_z) > 0.8:          # different storey
            continue
        d = float(np.hypot(t[0] - cx, t[1] - cy))
        if d <= args.radius_m:
            picks.append((d, nid))
    picks.sort()
    picks = picks[: args.max_sources]
    if not picks:
        raise SystemExit("no sweeps within radius on this storey")
    print(f"fusing {len(picks)} sweeps (nearest {picks[0][1]} at {picks[0][0]:.1f} m, "
          f"farthest {picks[-1][1]} at {picks[-1][0]:.1f} m)", flush=True)

    occluder = None
    mask = None
    height_check: dict | None = None
    if args.mesh:
        import trimesh
        tris = np.asarray(
            trimesh.load(args.mesh, force="mesh", process=False).triangles,
            dtype=np.float64)
        if tris.size == 0:
            raise SystemExit("mesh loaded empty (compressed GLB?)")
        occluder = nf.VoxelOccluder.from_triangles(tris, voxel=0.10)
        print(f"occluder: {tris.shape[0]} tris, grid {occluder.grid.shape}", flush=True)

        if args.floor_mask:
            import floor_polygon as fp
            clearance = (args.clearance_m if args.clearance_m is not None
                         else fp.DEFAULT_CLEARANCE_M)
            # A clearance inside the dead band silently degrades the rule to
            # "there is a surface at floor height", which admits every wall in
            # the building — the exact failure the mask exists to prevent, and
            # it would be invisible in the output. Refuse instead.
            floor_bar = fp.DEFAULT_TOL_M + fp.DEFAULT_VOXEL_M
            if clearance <= floor_bar:
                raise SystemExit(
                    f"--clearance-m {clearance} is at or below tol_m + voxel "
                    f"({floor_bar}); the obstruction test would be a no-op and "
                    f"every wall would be fused as floor")
            height_check = check_floor_height(grid, z_floor, tris, fp.DEFAULT_TOL_M)
            print(f"floor height check: at {height_check['probe_at']:.4f} vs "
                  f"{height_check['probe_below']:.4f}/{height_check['probe_above']:.4f} "
                  f"below/above -> {height_check['why']}", flush=True)
            if not height_check["ok"]:
                raise SystemExit(
                    f"refusing to mask: {height_check['why']}. z_floor="
                    f"{z_floor:.3f} came from "
                    f"{'--z-floor' if args.z_floor is not None else 'median scanner z - 1.5'}"
                    f". Pass --z-floor derived from the mesh, or drop "
                    f"--floor-mask and accept that walls are fused as floor.")
            mask = fp.floor_mask(grid, z_floor, tris, clearance_m=clearance,
                                 occluder=occluder)
            print(f"floor mask: keeps {mask.mean() * 100:.1f}% of the grid "
                  f"({int(mask.sum())} px) at clearance {clearance} m", flush=True)
    elif args.floor_mask:
        raise SystemExit("--floor-mask needs --mesh: with no mesh there is no "
                         "evidence about where the floor is")

    def load(nid: str) -> np.ndarray:
        name = f"{nid}_8192.jpg" if args.ss else f"{nid}.jpg"
        return np.asarray(
            Image.open(os.path.join(args.equirect, name)).convert("RGB"),
            dtype=np.uint8)

    # lazy loaders, not rasters: the 8192 tier is ~100 MB per sweep and
    # the two-pass fusion would otherwise need 40 of them resident twice
    sources = [((lambda n=nid: load(n)), nodes[nid]["t"]) for _d, nid in picks]
    atlas, report = fa.accumulate_floor_atlas(
        sources, grid, z_floor=z_floor, occluder=occluder,
        floor_mask=mask, provenance=args.provenance)

    # The one honest no-data mask: a cell counts as real floor in the
    # deliverable only if the mesh says it IS floor and a camera actually saw
    # it. Passing anything less lets the plate print a coverage figure that
    # was never measured.
    real = report["observed"] if mask is None else (report["observed"] & mask)

    atlas_png = os.path.join(args.out, f"{args.label}-atlas.png")
    ortho = None
    if args.orthophoto:
        import atlas_export as ax
        ortho = ax.write_orthophoto(
            atlas_png, atlas, grid,
            mask=real,
            # Plain Python scalars only. atlas_export writes its PNG and .pgw
            # before it serialises the sidecar, so a numpy scalar in here
            # raises mid-write and leaves a truncated .json beside a good
            # image. Nothing below is a numpy type; keep it that way.
            provenance={"label": str(args.label), "sources": int(len(picks)),
                        "z_floor": float(round(z_floor, 4)), "ss": bool(args.ss)},
            dpi_hint=args.dpi,
        )
        print(f"orthophoto: {ortho['bytes'] / 1e6:.1f} MB, "
              f"{os.path.basename(ortho['world_file_path'])} + "
              f"{os.path.basename(ortho['json_path'])}, "
              f"no-data {ortho['no_data_px']} px", flush=True)
    else:
        Image.fromarray(atlas.clip(0, 255).astype(np.uint8)).save(atlas_png)

    counts = report["counts"]
    cov = (np.clip(counts, 0, 12) / 12.0 * 255).astype(np.uint8)
    Image.fromarray(cov).save(os.path.join(args.out, f"{args.label}-coverage.png"))

    prov_stats = None
    if args.provenance:
        # Raw measured quantities and their percentiles ONLY. The confidence
        # ENCODING in atlas_provenance is deliberately not called here: review
        # demonstrated that at the tier this pipeline actually ships (8 mm/px
        # against 8192-wide panoramas) its incidence cap binds on every cell,
        # so the score collapses to cos(incidence) and stops distinguishing a
        # 7-look cell from a 12-look one. The arrays underneath it are sound
        # and independently checked (looks + rejected == counts, exactly), so
        # they are what gets reported.
        p = report["provenance"]
        seen = p.looks > 0
        def pct(a, m):
            v = a[m]
            return ([round(float(x), 2) for x in np.percentile(v, [5, 50, 95])]
                    if v.size else None)
        prov_stats = {
            "looks_p5_p50_p95": pct(p.looks.astype(float), seen),
            "incidence_deg_p5_p50_p95": pct(p.best_incidence_deg, seen),
            "gsd_mm_p5_p50_p95": pct(p.effective_gsd_mm, seen),
            "rejected_px": int((p.rejected > 0).sum()),
            "observed_no_surviving_look_px": int((p.observed & ~seen).sum()),
        }
        print(f"provenance: {json.dumps(prov_stats)}", flush=True)

    out = {
        "room": args.label,
        "mm_per_px": args.mm_per_px,
        "width_px": grid.width, "height_px": grid.height,
        "extent_m": [round(grid.width_m, 3), round(grid.height_m, 3)],
        "origin_xy": [round(v, 4) for v in grid.origin_xy],
        "z_floor": round(z_floor, 4),
        "sources": [nid for _d, nid in picks],
        "covered_frac": round(report["covered_frac"], 4),
        "rejected_frac": round(report["rejected_frac"], 4),
        "mean_looks": round(report["mean_looks"], 2),
        "max_looks": report["max_looks"],
        "fallback_px": report["fallback_px"],
        "ss": bool(args.ss),
        # covered_frac is still observed-over-the-WHOLE-grid. Masking narrows
        # the scope, so it necessarily falls; floor_covered_frac is the same
        # question asked of the floor only. Reporting both is what makes the
        # difference between "we trimmed the scope" and "we lost coverage"
        # readable, instead of redefining one number so the loss cannot show.
        "floor_masked": bool(mask is not None),
        "floor_frac": round(report["floor_frac"], 4),
        "floor_covered_frac": round(report["floor_covered_frac"], 4),
    }
    if height_check is not None:
        out["floor_height_check"] = height_check
    if prov_stats is not None:
        out["provenance"] = prov_stats
    if ortho is not None:
        out["world_file"] = os.path.basename(ortho["world_file_path"])
        out["world_file_affine"] = ortho["world_file"]
        out["orthophoto_bytes"] = int(ortho["bytes"])
        out["orthophoto_no_data_px"] = int(ortho["no_data_px"])
    with open(os.path.join(args.out, f"{args.label}-atlas-report.json"),
              "w", encoding="utf8") as f:
        json.dump(out, f, indent=2)
    print(json.dumps({k: v for k, v in out.items() if k != "sources"}, indent=2))
    print(f"sources: {len(out['sources'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
