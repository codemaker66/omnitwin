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

# How like the surrounding ceiling a restored patch must end up to be
# promotable. Generous — a factor of two either way — because the point is to
# catch the two failure shapes, not to police texture:
#   scan_058 0.66x, scan_059 0.64x, scan_126 1.29x  accepted (look right)
#   scan_134 0.46x  under-recovered
#   scan_139 1.83x  over-textured, visibly mottled
LIKENESS_BAND = (0.5, 1.5)


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

    # An unconfident solve cannot support a planarity verdict: the wedge spread
    # would be measuring noise, and refusing it as "not planar" would dress an
    # instrument failure up as a fact about the building.
    if float(score) < zf.MIN_SOLVE_AGREEMENT:
        rec["refused"] = f"height solve too weak to judge (agreement {score:.3f})"
        return rec

    # THE GATE THAT MATTERS: do the donors agree with each other about the
    # surface INSIDE the cone — the region actually being filled? The
    # surrounding-ring spread below is kept as a secondary reading, but it
    # cannot see a dome ringed by flat coffers, which is exactly what let
    # scan_043 smear 663,539 px across the Grand Hall's oculus.
    cone_agree = zf.cone_donor_agreement(
        target.shape[:2], C, donors, float(z), cone_half_deg
    )
    rec["cone_donor_agreement"] = round(float(cone_agree), 3)
    if cone_agree < zf.MIN_CONE_DONOR_AGREEMENT:
        rec["refused"] = (
            f"not one plane inside the cone (donor agreement {cone_agree:.3f})"
        )
        return rec

    heights = zp.sample_ceiling_heights(target, C, donors, z, cone_half_deg)
    # Report the SAME statistic the gate judges on, never a different one.
    spread = zf.ceiling_planarity_spread(heights) if heights.size else float("nan")
    planar = zf.ceiling_is_planar(heights, tolerance_m=0.25) if heights.size else False
    rec["planarity_spread_m"] = None if not np.isfinite(spread) else round(float(spread), 3)
    rec["wedge_solves"] = int(heights.size)
    rec["planar"] = bool(planar)
    if not planar:
        # "Not one plane" is all that was measured. On this capture that covers
        # the Grand Hall dome, the staircase soffit and rooms with beams alike;
        # naming a cause here would be a claim about the building.
        rec["refused"] = "ceiling around the cone is not one plane"
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

        # ACCEPTANCE, and note it is NOT the gain. A detail gain rewards any
        # added variance, including smear: the Grand Hall dome scored x12.46
        # while its oculus was being turned to mush. What a restoration must do
        # is end up LIKE the ceiling it belongs to — so compare the restored
        # patch against the ring of real ceiling just outside the cone. Far
        # under it and the donors never recovered the ceiling's character; far
        # over it and they have added texture the ceiling does not have
        # (scan_139 landed at 1.83x its ring, and looks visibly mottled).
        ring_mask = zf.zenith_cone_mask(*target.shape[:2], cone_half_deg, feather_deg=12.0)
        ring_mask &= ~r["hole_mask_eq"]
        ring_detail = float(da[ring_mask[:band]].mean()) if ring_mask[:band].any() else 0.0
        rec["ring_detail"] = round(ring_detail, 3)
        k = a / ring_detail if ring_detail > 1e-6 else float("inf")
        rec["restored_vs_ring"] = None if not np.isfinite(k) else round(float(k), 2)
        if not (LIKENESS_BAND[0] <= k <= LIKENESS_BAND[1]):
            rec["refused"] = (
                f"restored patch does not resemble its ceiling "
                f"({k:.2f}x the surrounding ring)"
            )
            return rec
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
