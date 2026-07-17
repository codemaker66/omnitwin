"""Batch nadir fill for the whole bundle — all sweeps, SS-first ladder.

Fills the 8192 supersampled pano (the zoom tier) and DERIVES the 4096 base
and 512 preview from it by Lanczos downscale — exactly how the extractor
builds the LOD ladder, so the viewer's 512→4096→8192 swaps stay coherent.

Sources under --equirect are opened READ-ONLY; everything lands in --out:

    scan_XXX_8192.jpg / scan_XXX.jpg / scan_XXX_preview.jpg
    scan_XXX.done.json          per-scan report (also the resume marker)
    batch_report.jsonl          one line per processed scan, append-only

Resumable: a scan with a done-marker is skipped, so a killed run continues
where it stopped. scan_000 (counter-plinth shadow) automatically gets the
fine treatment: 5 cm voxels + 0.15 m floor exemption.

Publication stays the foundry's lane — this script stages files only.

Usage:
  python nadir_fill_batch.py --out F:/E57/equirect_filled \
      --equirect F:/E57/equirect_fixed \
      --manifest C:/Users/blake/omnitwin2/packages/web/public/twin/trades-hall/manifest.json \
      --mesh C:/Users/blake/omnitwin2/packages/web/public/twin/trades-hall/mesh/dollhouse.glb \
      [--scans all|0,28,46] [--workers 3] [--k 8]
"""

from __future__ import annotations

import argparse
import json
import os
import time
import traceback
from multiprocessing import get_context

import numpy as np
from PIL import Image

import nadir_fill as nf
from nadir_fill_pilot import load_nodes, pick_donors, solve_floor_z

SS_W, SS_H = 8192, 4096
OUT_W, OUT_H = 4096, 2048
PREV_W, PREV_H = 512, 256

# Sweeps needing the fine occluder: 5 cm voxels + 0.15 m exemption resolve
# geometry the 10 cm/0.30 m pair is blind to (counter-plinth recesses).
FINE_SCANS = {0}

_G: dict = {}


def _init(
    manifest: str,
    occ_data: tuple | None,
    occ_fine_data: tuple | None,
    equirect: str,
    out: str,
    k: int,
) -> None:
    """Worker init. The mesh is loaded and voxelized ONCE in the parent —
    workers receive finished occupancy grids, so a bad GLB aborts the run
    up front instead of respawn-looping the pool's initializer."""
    nodes = load_nodes(manifest)
    occ = nf.VoxelOccluder(*occ_data) if occ_data else None
    occ_fine = nf.VoxelOccluder(*occ_fine_data) if occ_fine_data else None
    _G.update(nodes=nodes, occ=occ, occ_fine=occ_fine, eq=equirect, out=out, k=k)


def build_occluders(mesh_path: str, nodes: dict) -> tuple[tuple, tuple]:
    """Parent-side: load a PLAIN glTF (no compression extensions — the
    bundle dollhouse is meshopt-required and undecodable here; use the
    matterpak original, verified same E57 Z-up frame), voxelize at both
    granularities, and sanity-gate the frame against the scan poses."""
    import trimesh

    tris = np.asarray(
        trimesh.load(mesh_path, force="mesh", process=False).triangles,
        dtype=np.float64,
    )
    if tris.shape[0] == 0 or float(np.abs(tris).max()) < 1e-6:
        raise SystemExit(
            f"mesh loaded empty/degenerate from {mesh_path} — compressed "
            "GLB? Use an uncompressed variant (e.g. matterpak trades-hall-"
            "resized1k.glb)"
        )
    lo = tris.min(axis=(0, 1))
    hi = tris.max(axis=(0, 1))
    outside = [
        k for k, rec in nodes.items()
        if not (lo[0] - 1 < rec["t"][0] < hi[0] + 1
                and lo[1] - 1 < rec["t"][1] < hi[1] + 1)
    ]
    if outside:
        raise SystemExit(
            f"frame mismatch: {len(outside)} scan poses outside mesh XY "
            f"bounds (e.g. {outside[:3]}) — refusing to occlude with a "
            "wrong-frame mesh"
        )
    print(f"mesh: {tris.shape[0]} tris, lo={np.round(lo,2).tolist()} "
          f"hi={np.round(hi,2).tolist()}", flush=True)
    occ = nf.VoxelOccluder.from_triangles(tris, voxel=0.10)
    occ_f = nf.VoxelOccluder.from_triangles(tris, voxel=0.05)
    print(f"occluders: coarse {occ.grid.shape} "
          f"({occ.grid.mean()*100:.2f}% occ), fine {occ_f.grid.shape}",
          flush=True)
    return (occ.grid, occ.origin, occ.voxel), (occ_f.grid, occ_f.origin, occ_f.voxel)


def process_scan(scan: int) -> dict:
    t0 = time.time()
    key = f"scan_{scan:03d}"
    out = _G["out"]
    marker = os.path.join(out, f"{key}.done.json")
    if os.path.exists(marker):
        with open(marker, "r", encoding="utf8") as f:
            rec = json.load(f)
        rec["skipped"] = True
        return rec
    try:
        nodes = _G["nodes"]
        if key not in nodes:
            raise RuntimeError("not in manifest")
        C_t = nodes[key]["t"]
        fine = scan in FINE_SCANS
        occ = _G["occ_fine"] if (fine and _G["occ_fine"] is not None) else _G["occ"]
        z_exempt = 0.15 if fine else 0.30

        def load(nid: str, ss: bool) -> np.ndarray:
            name = f"{nid}_8192.jpg" if ss else f"{nid}.jpg"
            return np.asarray(
                Image.open(os.path.join(_G["eq"], name)).convert("RGB"),
                dtype=np.uint8,
            )

        donor_ids = pick_donors(nodes, key, _G["k"])
        if not donor_ids:
            raise RuntimeError("no same-floor donors")

        # Solve the floor plane on base-res imagery (cheap), fill on SS.
        target_b = load(key, False)
        donors_b = [(load(n, False), nodes[n]["t"]) for n in donor_ids]
        z_floor, ncc = solve_floor_z(
            target_b, C_t, donors_b, z_init=float(C_t[2]) - 1.5, occluder=occ
        )
        del target_b, donors_b

        target = load(key, True)
        donors = [(load(n, True), nodes[n]["t"]) for n in donor_ids]
        filled, rep = nf.fill_nadir_hole(
            target,
            C_t,
            donors,
            z_floor=z_floor,
            hole_mask_eq=None,
            view_size=1536,
            half_fov_deg=34.0,
            occluder=occ,
            z_exempt_m=z_exempt,
        )
        del donors, target

        img = Image.fromarray(filled.clip(0, 255).astype(np.uint8))
        del filled
        img.save(os.path.join(out, f"{key}_8192.jpg"), quality=85)
        base = img.resize((OUT_W, OUT_H), Image.LANCZOS)
        base.save(os.path.join(out, f"{key}.jpg"), quality=90)
        img.resize((PREV_W, PREV_H), Image.LANCZOS).save(
            os.path.join(out, f"{key}_preview.jpg"), quality=85
        )
        base.close()
        img.close()

        rec = {
            "scan": key,
            "z_floor": round(z_floor, 4),
            "height_m": round(float(C_t[2]) - z_floor, 4),
            "ncc": round(ncc, 4),
            "fine_voxel": fine,
            "donors": donor_ids,
            "hole_px_eq": rep.get("hole_px_eq"),
            "synthesized_px": rep.get("synthesized_px"),
            "mesh_occluded_px": rep.get("mesh_occluded_px"),
            "grain_gain": rep.get("grain_gain"),
            "sheen": rep.get("sheen_field"),
            "secs": round(time.time() - t0, 1),
        }
        with open(marker, "w", encoding="utf8") as f:
            json.dump(rec, f)
        return rec
    except Exception as exc:  # noqa: BLE001 — batch must survive bad sweeps
        return {
            "scan": key,
            "error": str(exc),
            "trace": traceback.format_exc()[-800:],
            "secs": round(time.time() - t0, 1),
        }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--equirect", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mesh", default="")
    ap.add_argument("--scans", default="all")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--k", type=int, default=8)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    nodes = load_nodes(args.manifest)
    n_all = len(nodes)
    if args.scans == "all":
        targets = sorted(int(k.split("_")[1]) for k in nodes)
    else:
        targets = [int(s) for s in args.scans.split(",")]

    report_path = os.path.join(args.out, "batch_report.jsonl")
    print(f"batch: {len(targets)}/{n_all} sweeps, {args.workers} workers, "
          f"mesh={'yes' if args.mesh else 'NO'}", flush=True)

    occ_data = occ_fine_data = None
    if args.mesh:
        occ_data, occ_fine_data = build_occluders(args.mesh, nodes)

    ctx = get_context("spawn")
    done = errors = 0
    t_start = time.time()
    with ctx.Pool(
        args.workers,
        initializer=_init,
        initargs=(args.manifest, occ_data, occ_fine_data,
                  args.equirect, args.out, args.k),
        maxtasksperchild=8,
    ) as pool:
        with open(report_path, "a", encoding="utf8") as rf:
            for rec in pool.imap_unordered(process_scan, targets):
                rf.write(json.dumps(rec) + "\n")
                rf.flush()
                done += 1
                if "error" in rec:
                    errors += 1
                    print(f"[{done}/{len(targets)}] {rec['scan']} ERROR {rec['error']}",
                          flush=True)
                else:
                    print(
                        f"[{done}/{len(targets)}] {rec['scan']} "
                        f"h={rec.get('height_m')} ncc={rec.get('ncc')} "
                        f"synth={rec.get('synthesized_px')} {rec.get('secs')}s"
                        f"{' (resumed)' if rec.get('skipped') else ''}",
                        flush=True,
                    )
    mins = (time.time() - t_start) / 60.0
    print(f"done: {done} sweeps, {errors} errors, {mins:.1f} min", flush=True)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
