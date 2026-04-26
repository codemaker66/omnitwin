"""Compute / collate held-out PSNR / SSIM / LPIPS-Alex into eval_holdout.json.

The gsplat trainer already writes per-iter metrics into the bundle's
`stats/` directory and `training_metrics.jsonl`. This script reads
those and produces the canonical `eval_holdout.json` artifact for the
Venue Artifact bundle (per D-014).

WebGL FPS is measured separately by `webgl_fps.ts` on real client
hardware (M1 MacBook, RTX 4090, real iPhone). The `summary.fps` field
is left null at training time and populated at eval time after a manual
client-side measurement.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import torch


def _last_eval_row(jsonl_path: Path) -> dict[str, Any]:
    """Find the most recent line that carries any eval_* key."""
    if not jsonl_path.exists():
        return {}
    last: dict[str, Any] = {}
    for line in jsonl_path.read_text().splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if any(k.startswith("eval_") for k in row):
            last = row
    return last


def _per_image_rows(stats_dir: Path) -> list[dict[str, Any]]:
    """Surface gsplat's per-image holdout JSON if the trainer wrote it."""
    if not stats_dir.exists():
        return []
    candidates = sorted(
        stats_dir.glob("val_step*.json"), key=lambda p: p.stat().st_mtime
    )
    if not candidates:
        return []
    try:
        payload = json.loads(candidates[-1].read_text())
    except Exception:  # noqa: BLE001
        return []
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and "images" in payload:
        return list(payload["images"])
    return []


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--bundle", required=True, help="bundle directory")
    p.add_argument(
        "--data", required=True, help="COLMAP dataset root (kept for symmetry)"
    )
    p.add_argument("--device", default="cuda")
    args = p.parse_args()

    bundle = Path(args.bundle)
    out_path = bundle / "eval_holdout.json"

    cfg_path = bundle / "training_config.json"
    cfg = json.loads(cfg_path.read_text()) if cfg_path.exists() else {}

    last_row = _last_eval_row(bundle / "training_metrics.jsonl")
    per_image = _per_image_rows(bundle / "stats")

    summary = {
        "config": cfg,
        "data":   args.data,
        "device": args.device,
        "torch_version": torch.__version__,
        "summary": {
            "psnr":  last_row.get("eval_psnr"),
            "ssim":  last_row.get("eval_ssim"),
            "lpips": last_row.get("eval_lpips"),
            "fps":   None,  # populated by webgl_fps.ts on real client hardware
        },
        "per_image": per_image,
    }
    out_path.write_text(json.dumps(summary, indent=2))
    print(f"eval_holdout.json written → {out_path}")


if __name__ == "__main__":
    main()
