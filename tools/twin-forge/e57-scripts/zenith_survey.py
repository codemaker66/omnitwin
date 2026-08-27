"""Which sweeps are actually blind overhead? Survey before batch.

The pilot's expensive half is the photometric height solve, and running it on
149 sweeps to discover that most of them do not need filling would be a waste.
This triage answers the cheap question first — is this sweep blind at zenith at
all? — using one image per node and no donors.

THE MEASURE IS A RATIO, NOT A THRESHOLD, and that is the whole point. A blind
cone is smooth because nothing was recorded there, so its detail collapses
relative to the ceiling immediately around it. A legitimately plain plaster
ceiling is smooth in BOTH places and scores near 1.0, so it is correctly left
alone — which a bare flatness threshold would get wrong, and did get wrong for
this investigation until a donor test settled it. The same self-calibrating
idea as the fill's evidence gate, applied one ring wider.

Usage:
  python zenith_survey.py \
    --equirect "F:/E57/equirect_filled" \
    --manifest ".../manifest.json" \
    --out "D:/claude/twin-cad-evidence/zenith/survey.json"
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import zenith_fill as zf  # noqa: E402

# Below this ratio the cone is markedly flatter than the ceiling around it,
# which is what a blind cone looks like. Chosen to sit well under the ~1.0 a
# uniformly plain ceiling scores and well above the near-0 of a total blank.
BLIND_RATIO = 0.45


def survey_node(
    path: str, cone_half_deg: float = 25.0, ring_deg: float = 12.0, radius: int = 3
) -> dict:
    img = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    h, w = img.shape[:2]
    cone = zf.zenith_cone_mask(h, w, cone_half_deg)
    ring = zf.zenith_cone_mask(h, w, cone_half_deg, feather_deg=ring_deg) & ~cone
    band = int(np.max(np.nonzero(ring)[0])) + radius + 1
    detail = zf.local_detail(img[:band].mean(axis=2), radius)
    c = float(detail[cone[:band]].mean())
    r = float(detail[ring[:band]].mean())
    ratio = c / r if r > 1e-6 else float("nan")
    return {
        "cone_detail": round(c, 4),
        "ring_detail": round(r, 4),
        "ratio": round(ratio, 4) if np.isfinite(ratio) else None,
        "blind": bool(np.isfinite(ratio) and ratio < BLIND_RATIO),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--equirect", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cone-half-deg", type=float, default=25.0)
    args = ap.parse_args()

    with open(args.manifest, "r", encoding="utf8") as f:
        manifest = json.load(f)
    node_ids = [n["id"] for n in manifest["nodes"]]

    rows: list[dict] = []
    for i, nid in enumerate(node_ids):
        path = os.path.join(args.equirect, f"{nid}.jpg")
        if not os.path.exists(path):
            rows.append({"scan": nid, "missing": True})
            continue
        rec = survey_node(path, args.cone_half_deg)
        rec["scan"] = nid
        rows.append(rec)
        if (i + 1) % 20 == 0:
            print(f"  {i + 1}/{len(node_ids)} surveyed", flush=True)

    scored = [r for r in rows if r.get("ratio") is not None]
    blind = [r for r in scored if r["blind"]]
    blind.sort(key=lambda r: r["ratio"])

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf8") as f:
        json.dump(
            {
                "blind_ratio_threshold": BLIND_RATIO,
                "surveyed": len(scored),
                "blind_count": len(blind),
                "blind_scans": [r["scan"] for r in blind],
                "rows": rows,
            },
            f,
            indent=2,
        )

    print(f"\nsurveyed {len(scored)} sweeps; {len(blind)} look blind at zenith "
          f"(ratio < {BLIND_RATIO})")
    ratios = np.array([r["ratio"] for r in scored], dtype=float)
    for lo, hi in ((0.0, 0.2), (0.2, 0.45), (0.45, 0.7), (0.7, 1.0), (1.0, 99.0)):
        n = int(((ratios >= lo) & (ratios < hi)).sum())
        print(f"  ratio {lo:>4.2f}-{hi:<5.2f}: {n:>3} {'#' * min(n, 60)}")
    print("\nworst 15:")
    for r in blind[:15]:
        print(f"  {r['scan']}  ratio {r['ratio']:.3f}  "
              f"(cone {r['cone_detail']:.2f} vs ring {r['ring_detail']:.2f})")
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
