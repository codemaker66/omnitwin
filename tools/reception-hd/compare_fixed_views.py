"""Compute reproducible full-frame PSNR, SSIM, and MAE for Reception QA PNGs.

This is a codec/LOD diagnostic, not a physical-quality metric. It reads PNGs,
does not modify them, and treats their 8-bit sRGB channel values as normalized
sample values without linear-light conversion.
"""

from __future__ import annotations

import argparse
import json
import math
from importlib.metadata import version
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter


VIEWS = (
    "overview",
    "timber-left",
    "timber-right",
    "floor-surface",
    "ceiling-moulding",
    "column-skirting",
)

PAIRS = (
    ("quality-sh3-ply", "quality-sh3-sog-leaf"),
    ("mobile-sh0-ply", "mobile-sh0-sog-leaf"),
    ("mobile-sh0-ply", "mobile-sh0-spz-leaf"),
    ("mobile-sh0-sog-leaf", "mobile-sh0-spz-leaf"),
    ("mobile-sh0-spz-leaf", "mobile-sh0-spz-all-invalid"),
    ("mobile-sh0-spz-leaf", "mobile-sh0-spz-coarse"),
    ("quality-sh3-ply", "mobile-sh0-ply"),
)


def ssim_7x7(a: np.ndarray, b: np.ndarray) -> float:
    """Match skimage SSIM defaults for float RGB with channel_axis=2.

    Uses a 7x7 uniform window, sample covariance, K1=0.01, K2=0.03,
    data_range=1.0, reflect boundary mode, and crops the 3-pixel boundary.
    """

    window = 7
    sample_count = window * window
    covariance_normalization = sample_count / (sample_count - 1)
    filter_size = (window, window, 1)

    mean_a = uniform_filter(a, size=filter_size, mode="reflect")
    mean_b = uniform_filter(b, size=filter_size, mode="reflect")
    variance_a = covariance_normalization * (
        uniform_filter(a * a, size=filter_size, mode="reflect") - mean_a * mean_a
    )
    variance_b = covariance_normalization * (
        uniform_filter(b * b, size=filter_size, mode="reflect") - mean_b * mean_b
    )
    covariance = covariance_normalization * (
        uniform_filter(a * b, size=filter_size, mode="reflect") - mean_a * mean_b
    )

    c1 = 0.01**2
    c2 = 0.03**2
    score = ((2 * mean_a * mean_b + c1) * (2 * covariance + c2)) / (
        (mean_a * mean_a + mean_b * mean_b + c1)
        * (variance_a + variance_b + c2)
    )
    return float(score[3:-3, 3:-3, :].mean(dtype=np.float64))


def load_rgb(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(image.convert("RGB"), dtype=np.float64) / 255.0


def compare(a_path: Path, b_path: Path) -> dict[str, float]:
    a = load_rgb(a_path)
    b = load_rgb(b_path)
    if a.shape != b.shape:
        raise ValueError(f"image shape mismatch: {a_path} {a.shape} != {b_path} {b.shape}")

    difference = a - b
    mse = float(np.mean(difference * difference, dtype=np.float64))
    psnr = math.inf if mse == 0 else -10.0 * math.log10(mse)
    return {
        "psnrDb": round(psnr, 6),
        "ssim": round(ssim_7x7(a, b), 6),
        "mae": round(float(np.mean(np.abs(difference), dtype=np.float64)), 6),
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, list[float]]:
    return {
        field: [
            round(min(float(row[field]) for row in rows), 6),
            round(max(float(row[field]) for row in rows), 6),
        ]
        for field in ("psnrDb", "ssim", "mae")
    }


def build_report(
    root: Path,
    pairs: Iterable[tuple[str, str]] = PAIRS,
) -> dict[str, Any]:
    comparisons: dict[str, Any] = {}
    for a_id, b_id in pairs:
        rows: list[dict[str, Any]] = []
        for view in VIEWS:
            a_path = root / f"matrix-{view}-{a_id}.png"
            b_path = root / f"matrix-{view}-{b_id}.png"
            metrics = compare(a_path, b_path)
            rows.append({"view": view, **metrics})
        comparisons[f"{a_id}__{b_id}"] = {
            "ranges": summarize(rows),
            "perView": rows,
        }

    return {
        "schemaVersion": "venviewer.reception-room-fixed-view-metrics.v1",
        "method": {
            "input": "1200x900 lossless PNG, RGB channels",
            "sampleDomain": "uint8 sRGB values normalized to [0,1], no linearization",
            "scope": "full frame including identical background; no masks",
            "psnr": "10*log10(1/MSE), data_range=1",
            "ssim": (
                "skimage-compatible 7x7 uniform window, sample covariance, "
                "K1=0.01, K2=0.03, data_range=1, reflect boundary, RGB mean"
            ),
            "mae": "mean absolute error over all RGB samples",
            "pythonPackages": {
                "numpy": version("numpy"),
                "Pillow": version("Pillow"),
                "scipy": version("scipy"),
            },
        },
        "limitations": [
            "Pairwise similarity is not physical or perceptual source quality.",
            "Identical background can inflate agreement.",
            "All six cameras share one optical centre and do not test SH view dependence.",
            "No repeated-capture noise floor was measured.",
        ],
        "comparisons": comparisons,
    }


def _parse_pair(value: str) -> tuple[str, str]:
    parts = value.split(":", maxsplit=1)
    if len(parts) != 2 or not all(parts):
        raise argparse.ArgumentTypeError(
            "pair must be BASELINE_VARIANT:CANDIDATE_VARIANT"
        )
    return parts[0], parts[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--pair",
        action="append",
        type=_parse_pair,
        help="BASELINE_VARIANT:CANDIDATE_VARIANT; may be repeated",
    )
    args = parser.parse_args()

    report = build_report(args.root, args.pair or PAIRS)
    serialized = json.dumps(report, indent=2) + "\n"
    if args.output is None:
        print(serialized, end="")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")


if __name__ == "__main__":
    main()
