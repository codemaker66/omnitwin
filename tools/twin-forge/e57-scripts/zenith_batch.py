"""Run the zenith fill across the sweeps the survey flagged, and measure it.

Evidence only: this writes filled equirects and before/after frames into an
output directory of its own and NEVER touches the published bundle. Promotion
is a separate, owner-authorised step, exactly as the nadir batch was.

Deliberately NOT a sweep of all 149. The survey found only 23 sweeps blind at
zenith; the other 126 see their own ceilings, and the pilot showed what happens
when the fill is pointed at one of those — it pastes a disc over good plaster.
Filling only what is broken is the whole discipline here.

Every node reports its own verdict: refused for a non-planar ceiling (a dome),
refused for want of a height solve, or filled with the detail it recovered.

Usage:
  python zenith_batch.py --survey ".../survey.json" \
    --equirect "F:/E57/equirect_filled" --manifest ".../manifest.json" \
    --out "D:/claude/twin-cad-evidence/zenith/batch"
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
import zenith_fill_pilot as zp  # noqa: E402


def process(
    nid: str,
    nodes: dict,
    equirect_dir: str,
    out_dir: str,
    cone_half_deg: float,
    k: int,
    save_frames: bool,
) -> dict:
    rec: dict = {"scan": nid}
    C = nodes[nid]["t"]
    path = os.path.join(equirect_dir, f"{nid}.jpg")
    if not os.path.exists(path):
        rec["refused"] = "source missing"
        return rec
    target = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)

    provisional = zf.zenith_cone_radius_m(C[2] + 3.5, C[2], cone_half_deg)
    donor_ids = zp.pick_zenith_donors(nodes, nid, provisional, k)
    donors = []
    for d in donor_ids:
        p = os.path.join(equirect_dir, f"{d}.jpg")
        if os.path.exists(p):
            donors.append(
                (np.asarray(Image.open(p).convert("RGB"), dtype=np.float32), nodes[d]["t"])
            )
    rec["donors"] = donor_ids
    if not donors:
        rec["refused"] = "no donor outside the blind cone"
        return rec

    z, score = zp.solve_ceiling_z(target, C, donors, cone_half_deg=cone_half_deg)
    rec["z_ceiling_m"] = None if not np.isfinite(z) else round(float(z), 3)
    rec["solve_agreement"] = None if not np.isfinite(score) else round(float(score), 3)
    if not np.isfinite(z):
        rec["refused"] = "no ceiling height solved"
        return rec

    heights = zp.sample_ceiling_heights(target, C, donors, z, cone_half_deg)
    planar = zf.ceiling_is_planar(heights, tolerance_m=0.25) if heights.size else False
    rec["height_spread_m"] = round(float(np.ptp(heights)), 3) if heights.size else None
    rec["planar"] = bool(planar)
    if not planar:
        rec["refused"] = "non-planar ceiling (dome)"
        return rec

    filled, r = zf.fill_zenith_hole(
        target, C, donors, z_ceiling=float(z),
        cone_half_deg=cone_half_deg, eye_height=float(C[2]),
    )
    rec.update(
        hole_px=r["hole_px"], filled_px=r["filled_px"],
        kept_target_px=r["kept_target_px"], donorless_px=r["donorless_px"],
        synth_px=r["synth_px"],
    )

    changed = (filled != target).any(axis=2)
    if changed.any():
        band = int(np.max(np.nonzero(r["hole_mask_eq"])[0])) + 4
        db = zf.local_detail(target[:band].mean(axis=2), 3)
        da = zf.local_detail(filled[:band].mean(axis=2), 3)
        sel = changed[:band]
        b, a = float(db[sel].mean()), float(da[sel].mean())
        rec["detail_before"] = round(b, 3)
        rec["detail_after"] = round(a, 3)
        rec["gain"] = round(a / max(b, 1e-9), 2)
    else:
        rec["gain"] = 1.0

    Image.fromarray(np.clip(filled, 0, 255).astype(np.uint8)).save(
        os.path.join(out_dir, f"{nid}.jpg"), quality=95
    )
    if save_frames:
        dirs = zp.zenith_view_dirs(768, 58.0)
        zp.save_png(nf.render_view(target, dirs), os.path.join(out_dir, f"{nid}-before.png"))
        zp.save_png(nf.render_view(filled, dirs), os.path.join(out_dir, f"{nid}-after.png"))
    return rec


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--survey", required=True)
    ap.add_argument("--equirect", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--cone-half-deg", type=float, default=25.0)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--frames", action="store_true", help="also write before/after PNGs")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    with open(args.survey, "r", encoding="utf8") as f:
        survey = json.load(f)
    targets = survey["blind_scans"]
    if args.limit:
        targets = targets[: args.limit]
    nodes = zp.load_nodes(args.manifest)

    report_path = os.path.join(args.out, "zenith-batch.jsonl")
    filled_n = refused_n = 0
    with open(report_path, "w", encoding="utf8") as out:
        for i, nid in enumerate(targets):
            if nid not in nodes:
                continue
            rec = process(
                nid, nodes, args.equirect, args.out,
                args.cone_half_deg, args.k, args.frames,
            )
            out.write(json.dumps(rec) + "\n")
            out.flush()
            if "refused" in rec:
                refused_n += 1
                print(f"[{i + 1}/{len(targets)}] {nid}: REFUSED — {rec['refused']}", flush=True)
            else:
                filled_n += 1
                print(
                    f"[{i + 1}/{len(targets)}] {nid}: ceiling {rec['z_ceiling_m']} m, "
                    f"{rec['filled_px']:,} px filled, detail x{rec.get('gain')}",
                    flush=True,
                )

    print(f"\nfilled {filled_n}, refused {refused_n}; report {report_path}")
    print("nothing was published — the bundle is untouched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
