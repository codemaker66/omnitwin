"""Read-only computer-vision triage for same-camera Reception Room PNGs.

This module deliberately does not produce a quality or physical-truth score.
It looks for regression signals that are useful before a human review:

* baseline edges that are missing from the candidate;
* candidate edges that sit close to and parallel with a baseline edge, which is
  a useful signal for shifted or doubled structure;
* large changes in edge coverage or full-frame colour.

The input images are never changed.  A ``triage_clear`` result only means that
the configured signals stayed within tolerance; it is not release acceptance.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import platform
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image
from scipy.ndimage import (
    binary_dilation,
    distance_transform_edt,
    gaussian_filter,
    maximum_filter,
    sobel,
)


VIEWS = (
    "overview",
    "timber-left",
    "timber-right",
    "floor-surface",
    "ceiling-moulding",
    "column-skirting",
)

DEFAULT_PAIRS = (
    ("mobile-sh0-spz-leaf", "mobile-sh0-spz-all-invalid"),
    ("quality-sh3-ply", "quality-sh3-sog-leaf"),
)


class ImageShapeMismatch(ValueError):
    """Raised before comparison when two images do not have the same shape."""


@dataclass(frozen=True)
class TriageThresholds:
    """Pinned thresholds for deterministic fixed-view triage.

    These values are intentionally conservative.  They are regression alarms,
    not perceptual just-noticeable-difference or acceptance thresholds.
    """

    blur_sigma_pixels: float = 1.2
    absolute_edge_strength: float = 0.025
    edge_match_tolerance_pixels: float = 2.0
    ghost_band_min_pixels: float = 2.0
    ghost_band_max_pixels: float = 10.0
    parallel_orientation_cosine: float = 0.8
    minimum_edge_pixels: int = 96
    minimum_edge_fraction: float = 0.0005
    maximum_edge_fraction: float = 0.18
    minimum_coherent_energy_ratio: float = 0.4
    missing_edge_review_fraction: float = 0.4
    extra_edge_review_fraction: float = 0.4
    parallel_ghost_review_fraction: float = 0.28
    edge_coverage_review_delta: float = 0.04
    changed_pixel_delta: float = 12.0 / 255.0
    changed_pixel_review_fraction: float = 0.2
    rgb_mae_review: float = 0.025
    mean_rgb_drift_review: float = 0.04
    local_grid_sizes: tuple[int, ...] = (2, 4, 8)
    local_changed_pixel_review_fraction: float = 0.5
    local_rgb_mae_review: float = 0.05
    multiscale_coarse_sigma_pixels: float = 2.4
    multiscale_minimum_gradient_energy_ratio: float = 0.96

    def as_report_dict(self) -> dict[str, Any]:
        return {
            "blurSigmaPixels": self.blur_sigma_pixels,
            "absoluteEdgeStrength": self.absolute_edge_strength,
            "edgeMatchTolerancePixels": self.edge_match_tolerance_pixels,
            "ghostBandPixels": [
                self.ghost_band_min_pixels,
                self.ghost_band_max_pixels,
            ],
            "parallelOrientationCosine": self.parallel_orientation_cosine,
            "minimumEdgePixels": self.minimum_edge_pixels,
            "minimumEdgeFraction": self.minimum_edge_fraction,
            "maximumEdgeFraction": self.maximum_edge_fraction,
            "minimumCoherentEnergyRatio": self.minimum_coherent_energy_ratio,
            "missingEdgeReviewFraction": self.missing_edge_review_fraction,
            "extraEdgeReviewFraction": self.extra_edge_review_fraction,
            "parallelGhostReviewFraction": self.parallel_ghost_review_fraction,
            "edgeCoverageReviewDelta": self.edge_coverage_review_delta,
            "changedPixelDelta": self.changed_pixel_delta,
            "changedPixelReviewFraction": self.changed_pixel_review_fraction,
            "rgbMaeReview": self.rgb_mae_review,
            "meanRgbDriftReview": self.mean_rgb_drift_review,
            "localGridSizes": list(self.local_grid_sizes),
            "localChangedPixelReviewFraction": (
                self.local_changed_pixel_review_fraction
            ),
            "localRgbMaeReview": self.local_rgb_mae_review,
            "multiscaleGradientSigmaPixels": [
                0.0,
                self.blur_sigma_pixels,
                self.multiscale_coarse_sigma_pixels,
            ],
            "multiscaleMinimumGradientEnergyRatio": (
                self.multiscale_minimum_gradient_energy_ratio
            ),
        }


@dataclass(frozen=True)
class EdgeField:
    raw_magnitude: np.ndarray
    magnitude: np.ndarray
    unit_x: np.ndarray
    unit_y: np.ndarray
    mask: np.ndarray
    coherent_energy_ratio: float


def load_rgb(path: Path) -> np.ndarray:
    """Load a PNG-compatible image as normalized float RGB without modifying it."""

    with Image.open(path) as image:
        return np.asarray(image.convert("RGB"), dtype=np.float64) / 255.0


def _luminance(rgb: np.ndarray) -> np.ndarray:
    # Fixed Rec. 709 weights in the stored sRGB sample domain.  This is not a
    # linear-light or physical luminance calculation; the report says so.
    return (
        0.2126 * rgb[..., 0]
        + 0.7152 * rgb[..., 1]
        + 0.0722 * rgb[..., 2]
    )


def _gradient(gray: np.ndarray, sigma: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    sample = gaussian_filter(gray, sigma=sigma, mode="reflect") if sigma else gray
    # scipy's Sobel response to a unit vertical step is four.  Dividing by four
    # makes the threshold easier to interpret while retaining deterministic data.
    gx = sobel(sample, axis=1, mode="reflect") / 4.0
    gy = sobel(sample, axis=0, mode="reflect") / 4.0
    magnitude = np.hypot(gx, gy)
    return gx, gy, magnitude


def _edge_field(rgb: np.ndarray, thresholds: TriageThresholds) -> EdgeField:
    gray = _luminance(rgb)
    _, _, raw_magnitude = _gradient(gray, sigma=0.0)
    gx, gy, magnitude = _gradient(gray, sigma=thresholds.blur_sigma_pixels)

    local_peak = magnitude >= (maximum_filter(magnitude, size=3, mode="reflect") - 1e-12)
    mask = local_peak & (magnitude >= thresholds.absolute_edge_strength)

    denominator = float(raw_magnitude.sum(dtype=np.float64))
    coherent_energy_ratio = (
        0.0
        if denominator <= 1e-12
        else float(magnitude.sum(dtype=np.float64)) / denominator
    )
    safe_magnitude = np.maximum(magnitude, 1e-12)
    return EdgeField(
        raw_magnitude=raw_magnitude,
        magnitude=magnitude,
        unit_x=gx / safe_magnitude,
        unit_y=gy / safe_magnitude,
        mask=mask,
        coherent_energy_ratio=coherent_energy_ratio,
    )


def _round(value: float) -> float:
    return round(float(value), 6)


def _percentile(values: np.ndarray, percentile: float) -> float | None:
    if values.size == 0:
        return None
    if not np.isfinite(values).all():
        return None
    return _round(float(np.percentile(values, percentile)))


def _gradient_energy_ratio(
    baseline_magnitude: np.ndarray,
    candidate_magnitude: np.ndarray,
) -> float | None:
    denominator = float(baseline_magnitude.sum(dtype=np.float64))
    if denominator <= 1e-12:
        return None
    return float(candidate_magnitude.sum(dtype=np.float64)) / denominator


def _local_multiscale_signals(
    baseline_rgb: np.ndarray,
    candidate_rgb: np.ndarray,
    baseline: EdgeField,
    candidate: EdgeField,
    rgb_difference: np.ndarray,
    thresholds: TriageThresholds,
) -> dict[str, Any]:
    """Find concentrated pixel loss and coherent detail loss at several scales.

    This is still regression triage, not a sharpness, quality, or physical-truth
    score.  A warning can be caused by a legitimate exposure, contrast, camera,
    or geometry change and therefore always requires human review.
    """

    changed_pixels = (
        np.max(rgb_difference, axis=2) >= thresholds.changed_pixel_delta
    )
    height, width = changed_pixels.shape
    maximum_tile_changed_fraction = 0.0
    maximum_tile_rgb_mae = 0.0
    local_pixel_drift = False

    for grid_size in thresholds.local_grid_sizes:
        for tile_y in range(grid_size):
            y0 = round(tile_y * height / grid_size)
            y1 = round((tile_y + 1) * height / grid_size)
            for tile_x in range(grid_size):
                x0 = round(tile_x * width / grid_size)
                x1 = round((tile_x + 1) * width / grid_size)
                tile_changed_fraction = float(
                    np.mean(changed_pixels[y0:y1, x0:x1], dtype=np.float64)
                )
                tile_rgb_mae = float(
                    np.mean(
                        rgb_difference[y0:y1, x0:x1],
                        dtype=np.float64,
                    )
                )
                maximum_tile_changed_fraction = max(
                    maximum_tile_changed_fraction, tile_changed_fraction
                )
                maximum_tile_rgb_mae = max(maximum_tile_rgb_mae, tile_rgb_mae)
                if (
                    tile_changed_fraction
                    >= thresholds.local_changed_pixel_review_fraction
                    and tile_rgb_mae >= thresholds.local_rgb_mae_review
                ):
                    local_pixel_drift = True

    baseline_gray = _luminance(baseline_rgb)
    candidate_gray = _luminance(candidate_rgb)
    _, _, baseline_coarse_magnitude = _gradient(
        baseline_gray, thresholds.multiscale_coarse_sigma_pixels
    )
    _, _, candidate_coarse_magnitude = _gradient(
        candidate_gray, thresholds.multiscale_coarse_sigma_pixels
    )
    ratios_by_scale = {
        "sigma0": _gradient_energy_ratio(
            baseline.raw_magnitude, candidate.raw_magnitude
        ),
        f"sigma{thresholds.blur_sigma_pixels:g}": _gradient_energy_ratio(
            baseline.magnitude, candidate.magnitude
        ),
        f"sigma{thresholds.multiscale_coarse_sigma_pixels:g}": (
            _gradient_energy_ratio(
                baseline_coarse_magnitude, candidate_coarse_magnitude
            )
        ),
    }
    finite_ratios = [ratio for ratio in ratios_by_scale.values() if ratio is not None]
    minimum_gradient_energy_ratio = min(finite_ratios) if finite_ratios else None
    multiscale_detail_loss = (
        minimum_gradient_energy_ratio is not None
        and minimum_gradient_energy_ratio
        < thresholds.multiscale_minimum_gradient_energy_ratio
    )

    reasons: list[str] = []
    if local_pixel_drift:
        reasons.append("local_pixel_drift")
    if multiscale_detail_loss:
        reasons.append("multiscale_detail_loss")

    return {
        "triggered": bool(reasons),
        "reasons": reasons,
        "maximumTileChangedPixelFraction": _round(
            maximum_tile_changed_fraction
        ),
        "maximumTileRgbMae": _round(maximum_tile_rgb_mae),
        "gradientEnergyRatios": {
            scale: None if ratio is None else _round(ratio)
            for scale, ratio in ratios_by_scale.items()
        },
        "minimumGradientEnergyRatio": (
            None
            if minimum_gradient_energy_ratio is None
            else _round(minimum_gradient_energy_ratio)
        ),
    }


def _assessability(
    baseline: EdgeField,
    pixel_count: int,
    thresholds: TriageThresholds,
) -> tuple[bool, list[str], dict[str, float | int]]:
    edge_pixels = int(np.count_nonzero(baseline.mask))
    edge_fraction = edge_pixels / pixel_count
    reasons: list[str] = []
    if edge_pixels < thresholds.minimum_edge_pixels:
        reasons.append("too_few_coherent_edges")
    if edge_fraction < thresholds.minimum_edge_fraction:
        reasons.append("edge_coverage_too_low")
    if edge_fraction > thresholds.maximum_edge_fraction:
        reasons.append("edge_coverage_noise_like")
    if baseline.coherent_energy_ratio < thresholds.minimum_coherent_energy_ratio:
        reasons.append("high_frequency_content_not_stable_after_blur")
    return (
        not reasons,
        reasons,
        {
            "baselineEdgePixels": edge_pixels,
            "baselineEdgeFraction": _round(edge_fraction),
            "baselineCoherentEnergyRatio": _round(baseline.coherent_energy_ratio),
        },
    )


def analyze_rgb(
    baseline_rgb: np.ndarray,
    candidate_rgb: np.ndarray,
    thresholds: TriageThresholds | None = None,
) -> dict[str, Any]:
    """Compare two same-camera RGB arrays and return triage signals.

    Shape mismatch fails closed.  Arrays must be height x width x 3.  The
    function does not mutate either array.
    """

    thresholds = thresholds or TriageThresholds()
    if baseline_rgb.shape != candidate_rgb.shape:
        raise ImageShapeMismatch(
            f"image shape mismatch: {baseline_rgb.shape} != {candidate_rgb.shape}"
        )
    if baseline_rgb.ndim != 3 or baseline_rgb.shape[2] != 3:
        raise ValueError(f"expected height x width x 3 RGB arrays, got {baseline_rgb.shape}")
    if baseline_rgb.shape[0] < 16 or baseline_rgb.shape[1] < 16:
        raise ValueError("images must be at least 16x16 pixels")
    if not np.isfinite(baseline_rgb).all() or not np.isfinite(candidate_rgb).all():
        raise ValueError("images contain non-finite sample values")

    baseline = _edge_field(baseline_rgb, thresholds)
    candidate = _edge_field(candidate_rgb, thresholds)
    pixel_count = baseline_rgb.shape[0] * baseline_rgb.shape[1]
    assessable, assessability_reasons, assessability_metrics = _assessability(
        baseline, pixel_count, thresholds
    )

    baseline_edge_count = int(np.count_nonzero(baseline.mask))
    candidate_edge_count = int(np.count_nonzero(candidate.mask))
    if candidate_edge_count:
        baseline_distance_to_candidate = distance_transform_edt(~candidate.mask)[
            baseline.mask
        ]
    else:
        baseline_distance_to_candidate = np.full(baseline_edge_count, np.inf)

    if baseline_edge_count:
        candidate_distance_map, nearest_baseline = distance_transform_edt(
            ~baseline.mask, return_indices=True
        )
        candidate_distance_to_baseline = candidate_distance_map[candidate.mask]
    else:
        nearest_baseline = None
        candidate_distance_to_baseline = np.full(candidate_edge_count, np.inf)

    if baseline_edge_count:
        missing_fraction = float(
            np.mean(
                baseline_distance_to_candidate
                > thresholds.edge_match_tolerance_pixels,
                dtype=np.float64,
            )
        )
    else:
        missing_fraction = 0.0
    if candidate_edge_count and nearest_baseline is not None:
        extra_fraction = float(
            np.mean(
                candidate_distance_to_baseline
                > thresholds.edge_match_tolerance_pixels,
                dtype=np.float64,
            )
        )
        candidate_y, candidate_x = np.nonzero(candidate.mask)
        nearest_y = nearest_baseline[0, candidate_y, candidate_x]
        nearest_x = nearest_baseline[1, candidate_y, candidate_x]
        orientation_dot = np.abs(
            candidate.unit_x[candidate_y, candidate_x]
            * baseline.unit_x[nearest_y, nearest_x]
            + candidate.unit_y[candidate_y, candidate_x]
            * baseline.unit_y[nearest_y, nearest_x]
        )
        parallel_ghost = (
            (candidate_distance_to_baseline > thresholds.ghost_band_min_pixels)
            & (candidate_distance_to_baseline <= thresholds.ghost_band_max_pixels)
            & (orientation_dot >= thresholds.parallel_orientation_cosine)
        )
        parallel_ghost_fraction = float(np.mean(parallel_ghost, dtype=np.float64))
    else:
        extra_fraction = 0.0
        parallel_ghost_fraction = 0.0

    baseline_coverage = float(
        np.mean(binary_dilation(baseline.mask, iterations=3), dtype=np.float64)
    )
    candidate_coverage = float(
        np.mean(binary_dilation(candidate.mask, iterations=3), dtype=np.float64)
    )
    edge_coverage_delta = abs(candidate_coverage - baseline_coverage)

    rgb_difference = np.abs(candidate_rgb - baseline_rgb)
    rgb_mae = float(np.mean(rgb_difference, dtype=np.float64))
    changed_pixel_fraction = float(
        np.mean(
            np.max(rgb_difference, axis=2) >= thresholds.changed_pixel_delta,
            dtype=np.float64,
        )
    )
    mean_rgb_drift = float(
        np.max(
            np.abs(
                candidate_rgb.mean(axis=(0, 1), dtype=np.float64)
                - baseline_rgb.mean(axis=(0, 1), dtype=np.float64)
            )
        )
    )
    local_multiscale = _local_multiscale_signals(
        baseline_rgb,
        candidate_rgb,
        baseline,
        candidate,
        rgb_difference,
        thresholds,
    )

    flags = {
        "missingEdges": missing_fraction >= thresholds.missing_edge_review_fraction,
        "extraEdges": extra_fraction >= thresholds.extra_edge_review_fraction,
        "parallelNearbyEdges": (
            parallel_ghost_fraction >= thresholds.parallel_ghost_review_fraction
        ),
        "edgeCoverageDrift": (
            edge_coverage_delta >= thresholds.edge_coverage_review_delta
        ),
        "grossPixelDrift": (
            changed_pixel_fraction >= thresholds.changed_pixel_review_fraction
            or rgb_mae >= thresholds.rgb_mae_review
        ),
        "meanColorDrift": mean_rgb_drift >= thresholds.mean_rgb_drift_review,
        "localMultiscaleRegression": local_multiscale["triggered"],
    }
    triggered = [name for name, active in flags.items() if active]
    if not assessable:
        verdict = "not_assessable"
    elif triggered:
        verdict = "review"
    else:
        verdict = "triage_clear"

    return {
        "verdict": verdict,
        "meaning": {
            "triage_clear": "no configured regression signal fired; not acceptance",
            "review": "one or more regression signals fired; human review required",
            "not_assessable": "baseline lacks reliable structure for this method",
        }[verdict],
        "assessability": {
            "assessable": assessable,
            "reasons": assessability_reasons,
            **assessability_metrics,
        },
        "flags": flags,
        "triggeredSignals": triggered,
        "localMultiscale": local_multiscale,
        "metrics": {
            "candidateEdgePixels": candidate_edge_count,
            "candidateEdgeFraction": _round(candidate_edge_count / pixel_count),
            "candidateCoherentEnergyRatio": _round(candidate.coherent_energy_ratio),
            "missingEdgeFraction": _round(missing_fraction),
            "extraEdgeFraction": _round(extra_fraction),
            "parallelNearbyEdgeFraction": _round(parallel_ghost_fraction),
            "baselineToCandidateEdgeDistanceP95Pixels": _percentile(
                baseline_distance_to_candidate, 95
            ),
            "candidateToBaselineEdgeDistanceP95Pixels": _percentile(
                candidate_distance_to_baseline, 95
            ),
            "baselineDilatedEdgeCoverage": _round(baseline_coverage),
            "candidateDilatedEdgeCoverage": _round(candidate_coverage),
            "edgeCoverageAbsoluteDelta": _round(edge_coverage_delta),
            "changedPixelFraction": _round(changed_pixel_fraction),
            "rgbMae": _round(rgb_mae),
            "meanRgbChannelMaxDrift": _round(mean_rgb_drift),
            "maximumTileChangedPixelFraction": local_multiscale[
                "maximumTileChangedPixelFraction"
            ],
            "maximumTileRgbMae": local_multiscale["maximumTileRgbMae"],
            "minimumGradientEnergyRatio": local_multiscale[
                "minimumGradientEnergyRatio"
            ],
        },
    }


def compare_files(
    baseline_path: Path,
    candidate_path: Path,
    thresholds: TriageThresholds | None = None,
) -> dict[str, Any]:
    return analyze_rgb(load_rgb(baseline_path), load_rgb(candidate_path), thresholds)


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def _input_image_bindings(
    root: Path,
    pairs: tuple[tuple[str, str], ...],
) -> list[dict[str, Any]]:
    usages_by_name: dict[str, list[dict[str, str]]] = {}
    paths_by_name: dict[str, Path] = {}
    for baseline_id, candidate_id in pairs:
        pair_id = f"{baseline_id}__{candidate_id}"
        for view in VIEWS:
            for role, variant_id in (
                ("baseline", baseline_id),
                ("candidate", candidate_id),
            ):
                name = f"matrix-{view}-{variant_id}.png"
                paths_by_name[name] = root / name
                usages_by_name.setdefault(name, []).append(
                    {"pairId": pair_id, "view": view, "role": role}
                )

    bindings: list[dict[str, Any]] = []
    for name in sorted(paths_by_name):
        path = paths_by_name[name]
        stat = path.stat()
        with Image.open(path) as image:
            width, height = image.size
            decoded_mode = image.mode
            image_format = image.format
        bindings.append(
            {
                "name": name,
                "sizeBytes": stat.st_size,
                "sha256": _sha256_file(path),
                "pixelDimensions": [width, height],
                "decodedMode": decoded_mode,
                "fileFormat": image_format,
                "usages": usages_by_name[name],
            }
        )
    return bindings


def _capture_manifest_binding(
    capture_manifest: Path | None,
    input_images: list[dict[str, Any]],
) -> dict[str, Any]:
    if capture_manifest is None:
        return {
            "supplied": False,
            "inputIntegrityStatus": "not_bound",
        }

    manifest_bytes = capture_manifest.read_bytes()
    try:
        manifest = json.loads(manifest_bytes)
    except json.JSONDecodeError as error:
        raise ValueError(f"capture manifest is not valid JSON: {error}") from error
    if not isinstance(manifest, dict):
        raise ValueError("capture manifest must contain a JSON object")

    declared_integrity = manifest.get("screenshotIntegrity")
    integrity_status = "not_declared"
    if declared_integrity is not None:
        if not isinstance(declared_integrity, list):
            raise ValueError("capture manifest screenshotIntegrity must be a list")
        declared_by_name: dict[str, dict[str, Any]] = {}
        for entry in declared_integrity:
            if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
                raise ValueError(
                    "capture manifest screenshotIntegrity entries need string names"
                )
            name = entry["name"]
            if name in declared_by_name:
                raise ValueError(
                    f"capture manifest has duplicate screenshotIntegrity entry: {name}"
                )
            declared_by_name[name] = entry

        mismatches: list[str] = []
        for image in input_images:
            declared = declared_by_name.get(image["name"])
            if declared is None:
                mismatches.append(f"{image['name']}:missing")
                continue
            declared_hash = declared.get("sha256")
            declared_size = declared.get("bytes", declared.get("sizeBytes"))
            if (
                not isinstance(declared_hash, str)
                or declared_hash.upper() != image["sha256"]
                or declared_size != image["sizeBytes"]
            ):
                mismatches.append(f"{image['name']}:hash_or_size")
        if mismatches:
            raise ValueError(
                "capture manifest does not match used input images: "
                + ", ".join(mismatches)
            )
        integrity_status = "verified_for_all_used_inputs"

    return {
        "supplied": True,
        "name": capture_manifest.name,
        "sizeBytes": len(manifest_bytes),
        "sha256": _sha256_bytes(manifest_bytes),
        "declaredSchemaVersion": manifest.get("schemaVersion"),
        "inputIntegrityStatus": integrity_status,
    }


def _runtime_binding() -> dict[str, Any]:
    return {
        "python": {
            "implementation": platform.python_implementation(),
            "version": platform.python_version(),
        },
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "packages": {
            "numpy": version("numpy"),
            "Pillow": version("Pillow"),
            "scipy": version("scipy"),
        },
    }


def _canonical_json_sha256(value: Any) -> str:
    canonical = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return _sha256_bytes(canonical)


def verify_report_receipt(report: dict[str, Any]) -> bool:
    """Verify the embedded content receipt without trusting presentation bytes."""

    payload = copy.deepcopy(report)
    evidence_binding = payload.get("evidenceBinding")
    if not isinstance(evidence_binding, dict):
        return False
    receipt = evidence_binding.pop("reportReceipt", None)
    if not isinstance(receipt, dict) or not isinstance(receipt.get("sha256"), str):
        return False
    return receipt["sha256"].upper() == _canonical_json_sha256(payload)


def _range(rows: list[dict[str, Any]], field: str) -> list[float] | None:
    values = [
        float(row["metrics"][field])
        for row in rows
        if row["metrics"][field] is not None
    ]
    if not values:
        return None
    return [_round(min(values)), _round(max(values))]


def _pair_report(
    root: Path,
    baseline_id: str,
    candidate_id: str,
    thresholds: TriageThresholds,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for view in VIEWS:
        baseline_name = f"matrix-{view}-{baseline_id}.png"
        candidate_name = f"matrix-{view}-{candidate_id}.png"
        result = compare_files(root / baseline_name, root / candidate_name, thresholds)
        rows.append(
            {
                "view": view,
                "baselineFile": baseline_name,
                "candidateFile": candidate_name,
                **result,
            }
        )

    verdict_counts = {
        verdict: sum(row["verdict"] == verdict for row in rows)
        for verdict in ("triage_clear", "review", "not_assessable")
    }
    signal_counts = {
        signal: sum(bool(row["flags"][signal]) for row in rows)
        for signal in rows[0]["flags"]
    }
    return {
        "pairId": f"{baseline_id}__{candidate_id}",
        "baselineVariant": baseline_id,
        "candidateVariant": candidate_id,
        "summary": {
            "verdictCounts": verdict_counts,
            "signalCounts": signal_counts,
            "metricRanges": {
                field: _range(rows, field)
                for field in (
                    "missingEdgeFraction",
                    "extraEdgeFraction",
                    "parallelNearbyEdgeFraction",
                    "baselineToCandidateEdgeDistanceP95Pixels",
                    "candidateToBaselineEdgeDistanceP95Pixels",
                    "edgeCoverageAbsoluteDelta",
                    "changedPixelFraction",
                    "rgbMae",
                    "maximumTileChangedPixelFraction",
                    "maximumTileRgbMae",
                    "minimumGradientEnergyRatio",
                )
            },
        },
        "perView": rows,
    }


def build_report(
    root: Path,
    pairs: Iterable[tuple[str, str]] = DEFAULT_PAIRS,
    thresholds: TriageThresholds | None = None,
    capture_manifest: Path | None = None,
) -> dict[str, Any]:
    """Build a deterministic report without including the supplied root path."""

    thresholds = thresholds or TriageThresholds()
    pinned_pairs = tuple(pairs)
    input_images = _input_image_bindings(root, pinned_pairs)
    runtime = _runtime_binding()
    comparisons = [
        _pair_report(root, baseline_id, candidate_id, thresholds)
        for baseline_id, candidate_id in pinned_pairs
    ]
    tool_source = Path(__file__).resolve()
    report: dict[str, Any] = {
        "schemaVersion": "venviewer.reception-room-fixed-view-cv-triage.v2",
        "backwardCompatibleWith": [
            "venviewer.reception-room-fixed-view-cv-triage.v1"
        ],
        "resultType": "regression_triage_not_acceptance",
        "inputDescription": (
            "same-camera lossless PNG basenames under caller-supplied root; "
            "raw input bytes are SHA-256 bound in evidenceBinding"
        ),
        "method": {
            "sampleDomain": (
                "uint8 sRGB samples normalized to [0,1]; Rec.709 weights in stored "
                "sample domain; no linear-light or physical luminance claim"
            ),
            "edgeDetection": (
                "1.2px Gaussian blur, Sobel gradient, fixed-strength local maxima"
            ),
            "edgeMatching": (
                "bidirectional Euclidean distance transforms with a 2px match tolerance"
            ),
            "ghostSignal": (
                "candidate edge 2-10px from nearest baseline edge with absolute "
                "gradient-direction cosine at least 0.8"
            ),
            "structureGuard": (
                "refuses a clear result for too few, overly dense, or blur-unstable edges"
            ),
            "localMultiscaleSignal": (
                "reviews a concentrated 2x2/4x4/8x8 tile change or a loss of "
                "luminance-gradient energy across 0px, 1.2px, and 2.4px scales; "
                "this is a regression warning, not a sharpness or quality score"
            ),
            "thresholds": thresholds.as_report_dict(),
            "pythonPackages": runtime["packages"],
        },
        "limitations": [
            "A triage_clear result is not product acceptance and is not a claim of quality or physical truth.",
            "The baseline is treated as the structural comparator; defects shared by both images are invisible.",
            "The nearby parallel-edge signal can also fire on legitimate geometry or small camera changes, so it requires human review.",
            "All current views share one optical centre and do not test view-dependent appearance or motion stability.",
            "Full-frame colour and changed-pixel metrics include the background and are only gross drift alarms.",
            "No source photographs, metric geometry, segmentation masks, or independent renderer are used.",
            "Thresholds are pinned for regression reproducibility, not calibrated to human just-noticeable differences.",
            "The thresholds were checked on this diagnostic capture rather than an independent benchmark, so new cameras or renderer settings require a fresh calibration set.",
            "Local or multiscale warnings can also fire after legitimate contrast, exposure, camera, or geometry changes and always require human review.",
        ],
        "comparisons": comparisons,
        "evidenceBinding": {
            "schemaVersion": (
                "venviewer.reception-room-fixed-view-cv-evidence-binding.v2"
            ),
            "inputImages": input_images,
            "captureManifest": _capture_manifest_binding(
                capture_manifest, input_images
            ),
            "toolSource": {
                "name": tool_source.name,
                "sizeBytes": tool_source.stat().st_size,
                "sha256": _sha256_file(tool_source),
            },
            "runtime": runtime,
            "receiptCanonicalization": (
                "UTF-8 JSON with sorted keys, compact separators and no NaN; "
                "scope is the complete report before evidenceBinding.reportReceipt "
                "is inserted"
            ),
        },
    }
    report["evidenceBinding"]["reportReceipt"] = {
        "algorithm": "SHA-256",
        "sha256": _canonical_json_sha256(report),
    }
    return report


def _parse_pair(value: str) -> tuple[str, str]:
    parts = value.split(":", maxsplit=1)
    if len(parts) != 2 or not all(parts):
        raise argparse.ArgumentTypeError("pair must be BASELINE_VARIANT:CANDIDATE_VARIANT")
    return parts[0], parts[1]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Triage same-camera fixed views for structural regression signals."
    )
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--capture-manifest",
        type=Path,
        help=(
            "optional fixed-view capture manifest to hash and verify against "
            "screenshotIntegrity entries"
        ),
    )
    parser.add_argument(
        "--pair",
        action="append",
        type=_parse_pair,
        help="BASELINE_VARIANT:CANDIDATE_VARIANT; may be repeated",
    )
    args = parser.parse_args()

    report = build_report(
        args.root,
        args.pair or DEFAULT_PAIRS,
        capture_manifest=args.capture_manifest,
    )
    serialized = json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n"
    if args.output is None:
        print(serialized, end="")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")


if __name__ == "__main__":
    main()
