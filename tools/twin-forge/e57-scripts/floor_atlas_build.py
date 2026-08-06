"""Build a real Floor Atlas for one room of a real capture.

Reads scanner poses from the forged bundle manifest, fuses every sweep that
saw the requested floor region, and writes a metrically-true orthophoto plus
an honest coverage map. Sources are opened READ-ONLY; everything lands under
--out. Nothing here publishes.

  python floor_atlas_build.py --out <dir> \
      --equirect F:/E57/equirect_fixed \
      --manifest .../twin/trades-hall/manifest.json \
      --bounds 8.4 -4.5 22 18 --mm-per-px 8 \
      [--ss] [--mesh <glb>] [--max-sources 60]

--bounds is CENTRE_X CENTRE_Y WIDTH_M HEIGHT_M in E57 world metres.
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image

import floor_atlas as fa
import nadir_fill as nf


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
    if args.mesh:
        import trimesh
        tris = np.asarray(
            trimesh.load(args.mesh, force="mesh", process=False).triangles,
            dtype=np.float64)
        if tris.size == 0:
            raise SystemExit("mesh loaded empty (compressed GLB?)")
        occluder = nf.VoxelOccluder.from_triangles(tris, voxel=0.10)
        print(f"occluder: {tris.shape[0]} tris, grid {occluder.grid.shape}", flush=True)

    def load(nid: str) -> np.ndarray:
        name = f"{nid}_8192.jpg" if args.ss else f"{nid}.jpg"
        return np.asarray(
            Image.open(os.path.join(args.equirect, name)).convert("RGB"),
            dtype=np.uint8)

    # lazy loaders, not rasters: the 8192 tier is ~100 MB per sweep and
    # the two-pass fusion would otherwise need 40 of them resident twice
    sources = [((lambda n=nid: load(n)), nodes[nid]["t"]) for _d, nid in picks]
    atlas, report = fa.accumulate_floor_atlas(
        sources, grid, z_floor=z_floor, occluder=occluder)

    Image.fromarray(atlas.clip(0, 255).astype(np.uint8)).save(
        os.path.join(args.out, f"{args.label}-atlas.png"))
    counts = report["counts"]
    cov = (np.clip(counts, 0, 12) / 12.0 * 255).astype(np.uint8)
    Image.fromarray(cov).save(os.path.join(args.out, f"{args.label}-coverage.png"))

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
    }
    with open(os.path.join(args.out, f"{args.label}-atlas-report.json"),
              "w", encoding="utf8") as f:
        json.dump(out, f, indent=2)
    print(json.dumps({k: v for k, v in out.items() if k != "sources"}, indent=2))
    print(f"sources: {len(out['sources'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
