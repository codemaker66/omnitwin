"""Render plain-language, hash-bound PNG boards from CV triage evidence.

The boards are an aid for human review.  Coloured marks are computer-vision
warnings, never physical truth, a quality score, or automatic acceptance.

The renderer is deliberately strict.  It accepts only the current v2 triage
schema, verifies the report receipt and every source PNG, reruns the triage
measurements, and refuses stale or path-escaping evidence.  Source screenshots
are read into memory and are never written to.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import math
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFont, PngImagePlugin
from scipy.ndimage import binary_dilation, distance_transform_edt

from triage_fixed_views import TriageThresholds, _edge_field, analyze_rgb


REPORT_SCHEMA = "venviewer.reception-room-fixed-view-cv-triage.v2"
EVIDENCE_SCHEMA = "venviewer.reception-room-fixed-view-cv-evidence-binding.v2"
OUTPUT_SCHEMA = "venviewer.reception-room-fixed-view-cv-visual-report.v1"
WARNING_LABEL = "computer-vision warning — human review needed"
CLEAR_LABEL = (
    "computer-vision comparison — no configured warning crossed its limit; "
    "not an approval"
)
NOT_ASSESSABLE_LABEL = "not assessable — human review needed"

SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")
SAFE_PNG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,239}\.png$")
SHA256 = re.compile(r"^[0-9A-Fa-f]{64}$")

CHANGED_COLOUR = (255, 190, 0)
MISSING_EDGE_COLOUR = (0, 190, 235)
NEARBY_EDGE_COLOUR = (255, 70, 190)
INK = (26, 31, 38)
MUTED = (82, 92, 104)
PAPER = (247, 248, 250)
WARNING_BACKGROUND = (255, 236, 225)
WARNING_INK = (143, 48, 28)
CLEAR_BACKGROUND = (235, 242, 247)
CLEAR_OUTLINE = (157, 176, 190)
CLEAR_INK = (42, 66, 82)
NOT_ASSESSABLE_BACKGROUND = (255, 247, 218)
NOT_ASSESSABLE_OUTLINE = (210, 178, 82)
NOT_ASSESSABLE_INK = (101, 73, 15)


def _find_render_font() -> Path | None:
    windows = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    candidates = (
        windows / "segoeui.ttf",
        windows / "arial.ttf",
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
    )
    return next((path.resolve() for path in candidates if path.is_file()), None)


RENDER_FONT = _find_render_font()


class EvidenceError(ValueError):
    """Raised when supplied evidence cannot be safely rendered."""


@dataclass(frozen=True)
class BoundImage:
    name: str
    size_bytes: int
    sha256: str
    width: int
    height: int
    rgb: Image.Image
    array: np.ndarray


@dataclass(frozen=True)
class WarningMasks:
    changed_pixels: np.ndarray
    missing_baseline_edges: np.ndarray
    nearby_parallel_edges: np.ndarray


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest().upper()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def _canonical_sha256(value: Any) -> str:
    try:
        encoded = json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise EvidenceError("report contains unsupported JSON values") from error
    return _sha256_bytes(encoded)


def _strict_json(data: bytes) -> dict[str, Any]:
    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise EvidenceError(f"report contains duplicate JSON key: {key}")
            result[key] = value
        return result

    def reject_constant(value: str) -> None:
        raise EvidenceError(f"report contains unsupported number: {value}")

    try:
        value = json.loads(
            data,
            object_pairs_hook=reject_duplicates,
            parse_constant=reject_constant,
        )
    except UnicodeDecodeError as error:
        raise EvidenceError("report must be UTF-8 JSON") from error
    except json.JSONDecodeError as error:
        raise EvidenceError(f"report is not valid JSON: {error.msg}") from error
    if not isinstance(value, dict):
        raise EvidenceError("report must contain one JSON object")
    return value


def _mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise EvidenceError(f"{label} must be an object")
    return value


def _list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise EvidenceError(f"{label} must be a list")
    return value


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{label} must be non-empty text")
    return value


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EvidenceError(f"{label} must be a number")
    result = float(value)
    if not math.isfinite(result):
        raise EvidenceError(f"{label} must be finite")
    return result


def _positive_integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise EvidenceError(f"{label} must be a positive whole number")
    return value


def _safe_id(value: Any, label: str) -> str:
    result = _text(value, label)
    if not SAFE_ID.fullmatch(result):
        raise EvidenceError(f"{label} is not a safe identifier")
    return result


def _safe_png(value: Any, label: str) -> str:
    result = _text(value, label)
    if not SAFE_PNG.fullmatch(result) or Path(result).name != result:
        raise EvidenceError(f"{label} must be one PNG basename with no path")
    return result


def _sha(value: Any, label: str) -> str:
    result = _text(value, label)
    if not SHA256.fullmatch(result):
        raise EvidenceError(f"{label} must be a SHA-256 digest")
    return result.upper()


def _verify_report_receipt(report: dict[str, Any]) -> str:
    payload = copy.deepcopy(report)
    evidence = _mapping(payload.get("evidenceBinding"), "evidenceBinding")
    receipt = _mapping(evidence.pop("reportReceipt", None), "reportReceipt")
    if receipt.get("algorithm") != "SHA-256":
        raise EvidenceError("report receipt uses an unsupported algorithm")
    declared = _sha(receipt.get("sha256"), "report receipt")
    actual = _canonical_sha256(payload)
    if declared != actual:
        raise EvidenceError("report receipt mismatch; the report was changed")
    return declared


def _thresholds_from_report(report: dict[str, Any]) -> TriageThresholds:
    method = _mapping(report.get("method"), "method")
    values = _mapping(method.get("thresholds"), "method.thresholds")
    grid_sizes = _list(values.get("localGridSizes"), "localGridSizes")
    if not grid_sizes or any(
        isinstance(value, bool) or not isinstance(value, int) or value <= 0
        for value in grid_sizes
    ):
        raise EvidenceError("localGridSizes must contain positive whole numbers")
    scales = _list(
        values.get("multiscaleGradientSigmaPixels"),
        "multiscaleGradientSigmaPixels",
    )
    if len(scales) != 3:
        raise EvidenceError("multiscaleGradientSigmaPixels must have three values")
    ghost_band = _list(values.get("ghostBandPixels"), "ghostBandPixels")
    if len(ghost_band) != 2:
        raise EvidenceError("ghostBandPixels must have two values")

    thresholds = TriageThresholds(
        blur_sigma_pixels=_number(values.get("blurSigmaPixels"), "blurSigmaPixels"),
        absolute_edge_strength=_number(
            values.get("absoluteEdgeStrength"), "absoluteEdgeStrength"
        ),
        edge_match_tolerance_pixels=_number(
            values.get("edgeMatchTolerancePixels"), "edgeMatchTolerancePixels"
        ),
        ghost_band_min_pixels=_number(
            ghost_band[0],
            "ghostBandPixels[0]",
        ),
        ghost_band_max_pixels=_number(
            ghost_band[1],
            "ghostBandPixels[1]",
        ),
        parallel_orientation_cosine=_number(
            values.get("parallelOrientationCosine"), "parallelOrientationCosine"
        ),
        minimum_edge_pixels=_positive_integer(
            values.get("minimumEdgePixels"), "minimumEdgePixels"
        ),
        minimum_edge_fraction=_number(
            values.get("minimumEdgeFraction"), "minimumEdgeFraction"
        ),
        maximum_edge_fraction=_number(
            values.get("maximumEdgeFraction"), "maximumEdgeFraction"
        ),
        minimum_coherent_energy_ratio=_number(
            values.get("minimumCoherentEnergyRatio"),
            "minimumCoherentEnergyRatio",
        ),
        missing_edge_review_fraction=_number(
            values.get("missingEdgeReviewFraction"), "missingEdgeReviewFraction"
        ),
        extra_edge_review_fraction=_number(
            values.get("extraEdgeReviewFraction"), "extraEdgeReviewFraction"
        ),
        parallel_ghost_review_fraction=_number(
            values.get("parallelGhostReviewFraction"),
            "parallelGhostReviewFraction",
        ),
        edge_coverage_review_delta=_number(
            values.get("edgeCoverageReviewDelta"), "edgeCoverageReviewDelta"
        ),
        changed_pixel_delta=_number(
            values.get("changedPixelDelta"), "changedPixelDelta"
        ),
        changed_pixel_review_fraction=_number(
            values.get("changedPixelReviewFraction"),
            "changedPixelReviewFraction",
        ),
        rgb_mae_review=_number(values.get("rgbMaeReview"), "rgbMaeReview"),
        mean_rgb_drift_review=_number(
            values.get("meanRgbDriftReview"), "meanRgbDriftReview"
        ),
        local_grid_sizes=tuple(grid_sizes),
        local_changed_pixel_review_fraction=_number(
            values.get("localChangedPixelReviewFraction"),
            "localChangedPixelReviewFraction",
        ),
        local_rgb_mae_review=_number(
            values.get("localRgbMaeReview"), "localRgbMaeReview"
        ),
        multiscale_coarse_sigma_pixels=_number(
            scales[2], "multiscaleGradientSigmaPixels[2]"
        ),
        multiscale_minimum_gradient_energy_ratio=_number(
            values.get("multiscaleMinimumGradientEnergyRatio"),
            "multiscaleMinimumGradientEnergyRatio",
        ),
    )
    if _number(scales[0], "multiscaleGradientSigmaPixels[0]") != 0.0:
        raise EvidenceError("the first multiscale sigma must be zero")
    if _number(scales[1], "multiscaleGradientSigmaPixels[1]") != thresholds.blur_sigma_pixels:
        raise EvidenceError("the middle multiscale sigma must match blurSigmaPixels")
    if thresholds.as_report_dict() != values:
        raise EvidenceError("report thresholds do not match the supported v2 contract")
    return thresholds


def _verify_triage_source(evidence: dict[str, Any]) -> None:
    binding = _mapping(evidence.get("toolSource"), "toolSource")
    if binding.get("name") != "triage_fixed_views.py":
        raise EvidenceError("report names an unsupported triage tool")
    source = Path(__file__).with_name("triage_fixed_views.py").resolve(strict=True)
    if _positive_integer(binding.get("sizeBytes"), "toolSource.sizeBytes") != source.stat().st_size:
        raise EvidenceError("report is stale: the triage tool size changed")
    if _sha(binding.get("sha256"), "toolSource.sha256") != _sha256_file(source):
        raise EvidenceError("report is stale: the triage tool changed")


def _read_bound_images(
    evidence: dict[str, Any], screenshot_root: Path
) -> dict[str, BoundImage]:
    try:
        root = screenshot_root.resolve(strict=True)
    except FileNotFoundError as error:
        raise EvidenceError("the screenshot folder does not exist") from error
    if not root.is_dir():
        raise EvidenceError("the screenshot root must be a folder")

    images: dict[str, BoundImage] = {}
    for position, item in enumerate(
        _list(evidence.get("inputImages"), "evidenceBinding.inputImages")
    ):
        binding = _mapping(item, f"inputImages[{position}]")
        name = _safe_png(binding.get("name"), f"inputImages[{position}].name")
        if name in images:
            raise EvidenceError(f"duplicate input image binding: {name}")
        size = _positive_integer(binding.get("sizeBytes"), f"{name}.sizeBytes")
        digest = _sha(binding.get("sha256"), f"{name}.sha256")
        dimensions = _list(binding.get("pixelDimensions"), f"{name}.pixelDimensions")
        if len(dimensions) != 2:
            raise EvidenceError(f"{name} must declare width and height")
        width = _positive_integer(dimensions[0], f"{name}.width")
        height = _positive_integer(dimensions[1], f"{name}.height")
        if binding.get("fileFormat") != "PNG":
            raise EvidenceError(f"{name} is not declared as lossless PNG")

        supplied = root / name
        if supplied.is_symlink():
            raise EvidenceError(f"{name} must not be a symbolic link")
        try:
            resolved = supplied.resolve(strict=True)
        except FileNotFoundError as error:
            raise EvidenceError(f"missing screenshot: {name}") from error
        if resolved.parent != root:
            raise EvidenceError(f"screenshot path escapes the supplied root: {name}")
        if not resolved.is_file():
            raise EvidenceError(f"screenshot is not a regular file: {name}")

        data = resolved.read_bytes()
        if len(data) != size or _sha256_bytes(data) != digest:
            raise EvidenceError(f"screenshot hash or size mismatch: {name}")
        try:
            with Image.open(io.BytesIO(data)) as source:
                source.load()
                actual_format = source.format
                actual_mode = source.mode
                actual_dimensions = source.size
                rgb = source.convert("RGB").copy()
        except Exception as error:
            raise EvidenceError(f"screenshot cannot be decoded as PNG: {name}") from error
        if actual_format != "PNG":
            raise EvidenceError(f"screenshot bytes are not PNG: {name}")
        if actual_mode != binding.get("decodedMode"):
            raise EvidenceError(f"screenshot mode mismatch: {name}")
        if actual_dimensions != (width, height):
            raise EvidenceError(f"screenshot dimensions mismatch: {name}")
        array = np.asarray(rgb, dtype=np.float64) / 255.0
        array.setflags(write=False)
        images[name] = BoundImage(
            name=name,
            size_bytes=size,
            sha256=digest,
            width=width,
            height=height,
            rgb=rgb,
            array=array,
        )
    if not images:
        raise EvidenceError("report does not bind any input screenshots")
    return images


def _expected_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    verdicts = ("triage_clear", "review", "not_assessable")
    signal_names = tuple(rows[0]["flags"])
    range_names = (
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
    ranges: dict[str, list[float] | None] = {}
    for name in range_names:
        values = [float(row["metrics"][name]) for row in rows if row["metrics"][name] is not None]
        ranges[name] = None if not values else [round(min(values), 6), round(max(values), 6)]
    return {
        "verdictCounts": {
            verdict: sum(row["verdict"] == verdict for row in rows)
            for verdict in verdicts
        },
        "signalCounts": {
            signal: sum(bool(row["flags"][signal]) for row in rows)
            for signal in signal_names
        },
        "metricRanges": ranges,
    }


def _validate_and_rerun_comparisons(
    report: dict[str, Any],
    evidence: dict[str, Any],
    images: dict[str, BoundImage],
    thresholds: TriageThresholds,
) -> list[dict[str, Any]]:
    comparisons = _list(report.get("comparisons"), "comparisons")
    if not comparisons:
        raise EvidenceError("report has no comparisons")

    expected_usages: dict[str, set[tuple[str, str, str]]] = {
        name: set() for name in images
    }
    seen_pairs: set[str] = set()
    validated: list[dict[str, Any]] = []
    stable_keys = (
        "verdict",
        "meaning",
        "assessability",
        "flags",
        "triggeredSignals",
        "localMultiscale",
        "metrics",
    )
    for pair_position, item in enumerate(comparisons):
        pair = _mapping(item, f"comparisons[{pair_position}]")
        pair_id = _safe_id(pair.get("pairId"), f"comparisons[{pair_position}].pairId")
        baseline_variant = _safe_id(pair.get("baselineVariant"), f"{pair_id}.baselineVariant")
        candidate_variant = _safe_id(pair.get("candidateVariant"), f"{pair_id}.candidateVariant")
        if pair_id != f"{baseline_variant}__{candidate_variant}":
            raise EvidenceError(f"stale report: pair identifier does not match variants: {pair_id}")
        if pair_id in seen_pairs:
            raise EvidenceError(f"duplicate comparison: {pair_id}")
        seen_pairs.add(pair_id)

        rows = _list(pair.get("perView"), f"{pair_id}.perView")
        if not rows:
            raise EvidenceError(f"comparison has no views: {pair_id}")
        seen_views: set[str] = set()
        for view_position, row_value in enumerate(rows):
            row = _mapping(row_value, f"{pair_id}.perView[{view_position}]")
            view = _safe_id(row.get("view"), f"{pair_id}.view")
            if view in seen_views:
                raise EvidenceError(f"duplicate view in comparison: {pair_id}/{view}")
            seen_views.add(view)
            baseline_name = _safe_png(row.get("baselineFile"), f"{pair_id}/{view}.baselineFile")
            candidate_name = _safe_png(row.get("candidateFile"), f"{pair_id}/{view}.candidateFile")
            if baseline_name not in images or candidate_name not in images:
                raise EvidenceError(f"stale report: {pair_id}/{view} names an unbound screenshot")
            baseline = images[baseline_name]
            candidate = images[candidate_name]
            if (baseline.width, baseline.height) != (candidate.width, candidate.height):
                raise EvidenceError(f"different screenshot dimensions: {pair_id}/{view}")
            expected_usages[baseline_name].add((pair_id, view, "baseline"))
            expected_usages[candidate_name].add((pair_id, view, "candidate"))

            rerun = analyze_rgb(baseline.array, candidate.array, thresholds)
            if any(row.get(key) != rerun[key] for key in stable_keys):
                raise EvidenceError(f"stale report measurements: {pair_id}/{view}")
        if pair.get("summary") != _expected_summary(rows):
            raise EvidenceError(f"stale report summary: {pair_id}")
        validated.append(pair)

    declared_usages: dict[str, set[tuple[str, str, str]]] = {}
    for position, item in enumerate(_list(evidence.get("inputImages"), "inputImages")):
        binding = _mapping(item, f"inputImages[{position}]")
        name = _safe_png(binding.get("name"), f"inputImages[{position}].name")
        usages: set[tuple[str, str, str]] = set()
        for usage_position, usage_value in enumerate(
            _list(binding.get("usages"), f"{name}.usages")
        ):
            usage = _mapping(usage_value, f"{name}.usages[{usage_position}]")
            pair_id = _safe_id(usage.get("pairId"), f"{name}.usage.pairId")
            view = _safe_id(usage.get("view"), f"{name}.usage.view")
            role = usage.get("role")
            if role not in ("baseline", "candidate"):
                raise EvidenceError(f"{name} has an unsupported usage role")
            key = (pair_id, view, role)
            if key in usages:
                raise EvidenceError(f"{name} has a duplicate usage")
            usages.add(key)
        declared_usages[name] = usages
    if declared_usages != expected_usages:
        raise EvidenceError("stale report: screenshot usages do not match comparisons")
    return validated


def _warning_masks(
    baseline: np.ndarray,
    candidate: np.ndarray,
    thresholds: TriageThresholds,
) -> WarningMasks:
    baseline_edges = _edge_field(baseline, thresholds)
    candidate_edges = _edge_field(candidate, thresholds)
    changed = np.max(np.abs(candidate - baseline), axis=2) >= thresholds.changed_pixel_delta

    if np.any(candidate_edges.mask):
        distance_to_candidate = distance_transform_edt(~candidate_edges.mask)
        missing = baseline_edges.mask & (
            distance_to_candidate > thresholds.edge_match_tolerance_pixels
        )
    else:
        missing = baseline_edges.mask.copy()

    nearby = np.zeros_like(candidate_edges.mask, dtype=bool)
    if np.any(baseline_edges.mask) and np.any(candidate_edges.mask):
        distances, nearest = distance_transform_edt(
            ~baseline_edges.mask, return_indices=True
        )
        candidate_y, candidate_x = np.nonzero(candidate_edges.mask)
        nearest_y = nearest[0, candidate_y, candidate_x]
        nearest_x = nearest[1, candidate_y, candidate_x]
        orientation = np.abs(
            candidate_edges.unit_x[candidate_y, candidate_x]
            * baseline_edges.unit_x[nearest_y, nearest_x]
            + candidate_edges.unit_y[candidate_y, candidate_x]
            * baseline_edges.unit_y[nearest_y, nearest_x]
        )
        selected = (
            (distances[candidate_y, candidate_x] > thresholds.ghost_band_min_pixels)
            & (distances[candidate_y, candidate_x] <= thresholds.ghost_band_max_pixels)
            & (orientation >= thresholds.parallel_orientation_cosine)
        )
        nearby[candidate_y[selected], candidate_x[selected]] = True
    return WarningMasks(changed, missing, nearby)


def _concentration_regions(mask: np.ndarray, limit: int = 6) -> list[dict[str, Any]]:
    height, width = mask.shape
    columns = min(8, max(2, width // 64))
    rows = min(6, max(2, height // 64))
    candidates: list[tuple[float, int, int, int, int]] = []
    for row in range(rows):
        y0 = row * height // rows
        y1 = (row + 1) * height // rows
        for column in range(columns):
            x0 = column * width // columns
            x1 = (column + 1) * width // columns
            cell = mask[y0:y1, x0:x1]
            count = int(np.count_nonzero(cell))
            if count:
                candidates.append((count / cell.size, x0, y0, x1, y1))
    if not candidates:
        return []
    candidates.sort(key=lambda item: (-item[0], item[2], item[1]))
    threshold = candidates[0][0] * 0.45
    selected = [item for item in candidates if item[0] >= threshold][:limit]
    return [
        {
            "x": x0,
            "y": y0,
            "width": x1 - x0,
            "height": y1 - y0,
            "density": round(density, 6),
        }
        for density, x0, y0, x1, y1 in selected
    ]


def _attention_image(candidate: BoundImage, masks: WarningMasks) -> Image.Image:
    rgb = np.asarray(candidate.rgb, dtype=np.uint8)
    gray = np.asarray(candidate.rgb.convert("L"), dtype=np.uint8)
    output = np.repeat(gray[..., None], 3, axis=2).astype(np.uint16)
    output = (output * 4 + rgb.astype(np.uint16)) // 5

    def tint(mask: np.ndarray, colour: tuple[int, int, int], alpha: int, dilation: int) -> None:
        visible = binary_dilation(mask, iterations=dilation) if dilation else mask
        if not np.any(visible):
            return
        colour_array = np.asarray(colour, dtype=np.uint16)
        output[visible] = (
            output[visible] * (255 - alpha) + colour_array * alpha + 127
        ) // 255

    tint(masks.changed_pixels, CHANGED_COLOUR, 105, 1)
    tint(masks.missing_baseline_edges, MISSING_EDGE_COLOUR, 210, 2)
    tint(masks.nearby_parallel_edges, NEARBY_EDGE_COLOUR, 210, 2)
    return Image.fromarray(output.astype(np.uint8), mode="RGB")


def _font(size: int) -> ImageFont.ImageFont:
    # Use a Unicode-capable platform font when available so the warning's em
    # dash is visible.  Its exact bytes are recorded in the output index.
    if RENDER_FONT is not None:
        return ImageFont.truetype(str(RENDER_FONT), size=size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # pragma: no cover - compatibility for old Pillow only
        return ImageFont.load_default()


def _board_filename(pair_id: str, view: str) -> str:
    candidate = f"{pair_id}--{view}.png"
    if len(candidate.encode("utf-8")) <= 220:
        return candidate
    digest = _sha256_bytes(f"{pair_id}\0{view}".encode("utf-8"))[:16]
    return f"{pair_id[:80]}--{view[:80]}--{digest}.png"


def _status_presentation(
    verdict: str,
) -> tuple[str, tuple[int, int, int], tuple[int, int, int], tuple[int, int, int], str]:
    if verdict == "review":
        return (
            WARNING_LABEL,
            WARNING_BACKGROUND,
            (230, 167, 142),
            WARNING_INK,
            "3  WARNING MAP",
        )
    if verdict == "triage_clear":
        return (
            CLEAR_LABEL,
            CLEAR_BACKGROUND,
            CLEAR_OUTLINE,
            CLEAR_INK,
            "3  DIFFERENCE MAP",
        )
    if verdict == "not_assessable":
        return (
            NOT_ASSESSABLE_LABEL,
            NOT_ASSESSABLE_BACKGROUND,
            NOT_ASSESSABLE_OUTLINE,
            NOT_ASSESSABLE_INK,
            "3  ATTENTION MAP",
        )
    raise EvidenceError(f"unsupported triage verdict: {verdict}")


def _draw_board(
    pair: dict[str, Any],
    row: dict[str, Any],
    baseline: BoundImage,
    candidate: BoundImage,
    masks: WarningMasks,
    report_sha256: str,
    receipt_sha256: str,
    destination: Path,
) -> dict[str, Any]:
    width, height = baseline.width, baseline.height
    gutter = 20
    margin = 24
    group_width = width * 3 + gutter * 2
    board_width = max(1100, group_width + margin * 2)
    header_height = 166
    panel_label_height = 44
    footer_height = 244
    image_y = header_height + panel_label_height
    board_height = image_y + height + footer_height
    group_x = (board_width - group_width) // 2
    xs = (group_x, group_x + width + gutter, group_x + (width + gutter) * 2)

    board = Image.new("RGB", (board_width, board_height), PAPER)
    draw = ImageDraw.Draw(board)
    title_font = _font(25)
    body_font = _font(18)
    small_font = _font(16)
    label_font = _font(19)
    status_label, banner_fill, banner_outline, banner_ink, attention_label = (
        _status_presentation(row["verdict"])
    )

    draw.text((margin, 16), f"Reception Room comparison — {row['view']}", fill=INK, font=title_font)
    draw.text((margin, 53), f"Baseline: {pair['baselineVariant']}", fill=MUTED, font=body_font)
    draw.text((margin, 80), f"Candidate: {pair['candidateVariant']}", fill=MUTED, font=body_font)
    banner = (margin, 111, board_width - margin, 153)
    draw.rounded_rectangle(
        banner,
        radius=9,
        fill=banner_fill,
        outline=banner_outline,
        width=2,
    )
    draw.text((margin + 14, 120), status_label, fill=banner_ink, font=label_font)

    panel_labels = ("1  BASELINE", "2  CANDIDATE", attention_label)
    for x, label in zip(xs, panel_labels):
        draw.text((x, header_height + 10), label, fill=INK, font=label_font)
    board.paste(baseline.rgb, (xs[0], image_y))
    board.paste(candidate.rgb, (xs[1], image_y))
    board.paste(_attention_image(candidate, masks), (xs[2], image_y))

    flags = _mapping(row.get("flags"), f"{pair['pairId']}/{row['view']}.flags")
    changed_warning = bool(
        flags.get("grossPixelDrift") or flags.get("localMultiscaleRegression")
    )
    region_sets = {
        "changedPixels": (
            _concentration_regions(masks.changed_pixels) if changed_warning else [],
            CHANGED_COLOUR,
        ),
        "missingBaselineEdges": (
            _concentration_regions(masks.missing_baseline_edges)
            if flags.get("missingEdges")
            else [],
            MISSING_EDGE_COLOUR,
        ),
        "nearbyParallelEdges": (
            _concentration_regions(masks.nearby_parallel_edges)
            if flags.get("parallelNearbyEdges")
            else [],
            NEARBY_EDGE_COLOUR,
        ),
    }
    outline_width = max(2, min(width, height) // 300)
    for regions, colour in region_sets.values():
        for region in regions:
            x0 = xs[2] + region["x"]
            y0 = image_y + region["y"]
            x1 = x0 + region["width"] - 1
            y1 = y0 + region["height"] - 1
            draw.rectangle((x0, y0, x1, y1), outline=colour, width=outline_width)

    footer_y = image_y + height + 16
    verdict_text = {
        "review": "The check raised one or more warnings. A person should inspect this view.",
        "triage_clear": "No configured warning crossed its limit. This is not approval.",
        "not_assessable": (
            "The computer could not assess this view reliably. Do not treat it as a pass."
        ),
    }.get(row["verdict"], "Human review is required.")
    draw.text((margin, footer_y), verdict_text, fill=INK, font=body_font)
    draw.text(
        (margin, footer_y + 31),
        "The colours show image differences, not what is physically true in the room.",
        fill=MUTED,
        font=small_font,
    )

    legend_y = footer_y + 67
    legend = (
        (CHANGED_COLOUR, "Amber: pixels changed most in these areas."),
        (MISSING_EDGE_COLOUR, "Cyan: a baseline edge was not found nearby."),
        (
            NEARBY_EDGE_COLOUR,
            "Magenta: a nearby parallel edge may be doubled or may be legitimate.",
        ),
    )
    for index, (colour, label) in enumerate(legend):
        y = legend_y + index * 28
        draw.rectangle((margin, y + 2, margin + 18, y + 20), fill=colour, outline=INK)
        draw.text((margin + 28, y), label, fill=INK, font=small_font)

    counts = {
        "changedPixels": int(np.count_nonzero(masks.changed_pixels)),
        "missingBaselineEdges": int(np.count_nonzero(masks.missing_baseline_edges)),
        "nearbyParallelEdges": int(np.count_nonzero(masks.nearby_parallel_edges)),
    }
    count_text = (
        f"Marked pixels: changed {counts['changedPixels']:,} · missing baseline edges "
        f"{counts['missingBaselineEdges']:,} · nearby parallel edges "
        f"{counts['nearbyParallelEdges']:,}"
    )
    draw.text((margin, legend_y + 91), count_text, fill=MUTED, font=small_font)
    draw.text(
        (margin, legend_y + 120),
        (
            f"Inputs: {baseline.name} [{baseline.sha256[:12]}…]  |  "
            f"{candidate.name} [{candidate.sha256[:12]}…]"
        ),
        fill=MUTED,
        font=small_font,
    )

    metadata = PngImagePlugin.PngInfo()
    metadata_values = {
        "baselineFile": baseline.name,
        "baselineSha256": baseline.sha256,
        "baselinePanelX": str(xs[0]),
        "candidateFile": candidate.name,
        "candidateSha256": candidate.sha256,
        "candidatePanelX": str(xs[1]),
        "imagePanelY": str(image_y),
        "inputPixelHeight": str(height),
        "inputPixelWidth": str(width),
        "pairId": pair["pairId"],
        "reportReceiptSha256": receipt_sha256,
        "reportSha256": report_sha256,
        "schemaVersion": OUTPUT_SCHEMA,
        "statusLabel": status_label,
        "view": row["view"],
        "attentionPanelX": str(xs[2]),
    }
    if row["verdict"] == "review":
        metadata_values["warningLabel"] = WARNING_LABEL
    if RENDER_FONT is not None:
        metadata_values["renderFontName"] = RENDER_FONT.name
        metadata_values["renderFontSha256"] = _sha256_file(RENDER_FONT)
    for key in sorted(metadata_values):
        metadata.add_text(key, metadata_values[key])
    board.save(
        destination,
        format="PNG",
        compress_level=9,
        optimize=False,
        pnginfo=metadata,
    )
    return {
        "pairId": pair["pairId"],
        "view": row["view"],
        "verdict": row["verdict"],
        "statusLabel": status_label,
        "plainLanguageStatus": verdict_text,
        "file": f"boards/{destination.name}",
        "sizeBytes": destination.stat().st_size,
        "sha256": _sha256_file(destination),
        "baseline": {"name": baseline.name, "sha256": baseline.sha256},
        "candidate": {"name": candidate.name, "sha256": candidate.sha256},
        "warningPixelCounts": counts,
        "concentrationRegions": {
            key: regions for key, (regions, _colour) in region_sets.items()
        },
    }


def _markdown_index(index: dict[str, Any], comparisons: list[dict[str, Any]]) -> str:
    lines = [
        "# Reception Room computer-vision evidence",
        "",
        "> **Computer-vision comparison — read the status banner on each board.**",
        "",
        "These boards compare the exact baseline and candidate screenshots named below. "
        "The coloured third panel shows where the computer found image differences.",
        "",
        "It does **not** prove what is physically in the room, decide which image is better, "
        "or approve anything for release.",
        "",
        "## How to read a board",
        "",
        "1. **Baseline** is the reference screenshot.",
        "2. **Candidate** is the screenshot being checked.",
        "3. The third panel is a **difference map**, **warning map**, or **attention map**, "
        "depending on the board's status.",
        "",
        "Amber means pixels changed. Cyan means a baseline edge was not found nearby. "
        "Magenta means a nearby parallel edge could be doubling or a legitimate change.",
        "Large boxes appear only where a configured warning crossed its limit. Small coloured "
        "marks can remain below that limit and still need human interpretation.",
        "",
        "## Evidence binding",
        "",
        f"- Source report: `{index['sourceReport']['name']}`",
        f"- Exact report SHA-256: `{index['sourceReport']['sha256']}`",
        f"- Verified report receipt: `{index['sourceReport']['receiptSha256']}`",
        f"- Bound screenshots: {len(index['inputImages'])}",
        "- Local folder paths are intentionally not recorded.",
        "",
        "## Boards",
        "",
    ]
    boards_by_pair: dict[str, list[dict[str, Any]]] = {}
    for board in index["boards"]:
        boards_by_pair.setdefault(board["pairId"], []).append(board)
    for pair in comparisons:
        lines.extend(
            [
                f"### {pair['baselineVariant']} → {pair['candidateVariant']}",
                "",
            ]
        )
        for board in boards_by_pair[pair["pairId"]]:
            lines.append(
                f"- [{board['view']}]({board['file']}) — **{board['statusLabel']}**. "
                f"{board['plainLanguageStatus']}"
            )
        lines.append("")
    lines.extend(
        [
            "## Important limits",
            "",
            "- A board with no configured warning is **not approval**.",
            "- Both screenshots can share the same defect, which this comparison cannot see.",
            "- Camera, exposure, contrast, or legitimate geometry changes can create warnings.",
            "- A person must compare these boards with independent room evidence.",
            "",
        ]
    )
    return "\n".join(lines)


def render_triage_report(
    report_path: Path,
    screenshot_root: Path,
    output_root: Path,
) -> dict[str, Any]:
    """Validate evidence and atomically create deterministic boards and indexes."""

    report_file = report_path.resolve(strict=True)
    report_bytes = report_file.read_bytes()
    report_sha256 = _sha256_bytes(report_bytes)
    report = _strict_json(report_bytes)
    if report.get("schemaVersion") != REPORT_SCHEMA:
        raise EvidenceError("unsupported or stale report schema; expected v2")
    if report.get("resultType") != "regression_triage_not_acceptance":
        raise EvidenceError("unsupported report result type")
    evidence = _mapping(report.get("evidenceBinding"), "evidenceBinding")
    if evidence.get("schemaVersion") != EVIDENCE_SCHEMA:
        raise EvidenceError("unsupported or stale evidence-binding schema; expected v2")
    receipt_sha256 = _verify_report_receipt(report)
    _verify_triage_source(evidence)
    thresholds = _thresholds_from_report(report)
    images = _read_bound_images(evidence, screenshot_root)
    comparisons = _validate_and_rerun_comparisons(
        report, evidence, images, thresholds
    )

    output = output_root.absolute()
    if output.exists():
        raise EvidenceError("output folder already exists; choose a new folder")
    parent = output.parent.resolve(strict=True)
    temporary = Path(
        tempfile.mkdtemp(prefix=f".{output.name}.partial-", dir=parent)
    )
    try:
        boards_directory = temporary / "boards"
        boards_directory.mkdir()
        boards: list[dict[str, Any]] = []
        used_names: set[str] = set()
        for pair in comparisons:
            for row in pair["perView"]:
                filename = _board_filename(pair["pairId"], row["view"])
                if filename in used_names:
                    raise EvidenceError(f"duplicate output board name: {filename}")
                used_names.add(filename)
                baseline = images[row["baselineFile"]]
                candidate = images[row["candidateFile"]]
                masks = _warning_masks(baseline.array, candidate.array, thresholds)
                boards.append(
                    _draw_board(
                        pair,
                        row,
                        baseline,
                        candidate,
                        masks,
                        report_sha256,
                        receipt_sha256,
                        boards_directory / filename,
                    )
                )

        renderer_source = Path(__file__).resolve(strict=True)
        index: dict[str, Any] = {
            "schemaVersion": OUTPUT_SCHEMA,
            "resultType": "computer_vision_warning_human_review_not_acceptance",
            "reviewWarningLabel": WARNING_LABEL,
            "triageClearLabel": CLEAR_LABEL,
            "notAssessableLabel": NOT_ASSESSABLE_LABEL,
            "sourceReport": {
                "name": report_file.name,
                "sizeBytes": len(report_bytes),
                "sha256": report_sha256,
                "receiptSha256": receipt_sha256,
            },
            "rendererSource": {
                "name": renderer_source.name,
                "sizeBytes": renderer_source.stat().st_size,
                "sha256": _sha256_file(renderer_source),
            },
            "renderFont": (
                {
                    "name": RENDER_FONT.name,
                    "sizeBytes": RENDER_FONT.stat().st_size,
                    "sha256": _sha256_file(RENDER_FONT),
                }
                if RENDER_FONT is not None
                else {
                    "name": "Pillow-default",
                    "note": "Unicode coverage depends on the installed Pillow build",
                }
            ),
            "inputImages": [
                {
                    "name": image.name,
                    "sizeBytes": image.size_bytes,
                    "sha256": image.sha256,
                    "pixelDimensions": [image.width, image.height],
                }
                for image in sorted(images.values(), key=lambda item: item.name)
            ],
            "boards": boards,
            "limitations": [
                "Coloured marks show measured image differences; large boxes appear only for configured warnings.",
                "Review boards use the label: computer-vision warning — human review needed.",
                "Marks are not physical truth, a quality score, or automatic acceptance.",
                "No-warning results are not approval.",
                "Only screenshot basenames are recorded; local folder paths are omitted.",
            ],
        }
        index["indexReceipt"] = {
            "algorithm": "SHA-256",
            "sha256": _canonical_sha256(index),
        }
        (temporary / "index.json").write_text(
            json.dumps(index, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
            + "\n",
            encoding="utf-8",
            newline="\n",
        )
        (temporary / "README.md").write_text(
            _markdown_index(index, comparisons),
            encoding="utf-8",
            newline="\n",
        )
        os.replace(temporary, output)
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise
    return index


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Turn a verified v2 CV triage JSON into plain-language PNG review boards."
        )
    )
    parser.add_argument("--report", required=True, type=Path, help="v2 CV triage JSON")
    parser.add_argument(
        "--screenshot-root",
        required=True,
        type=Path,
        help="folder containing the hash-bound screenshots",
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="new folder for PNG boards and indexes",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        result = render_triage_report(args.report, args.screenshot_root, args.output)
    except (EvidenceError, FileNotFoundError, OSError) as error:
        parser.exit(2, f"error: {error}\n")
    review_count = sum(board["verdict"] == "review" for board in result["boards"])
    clear_count = sum(
        board["verdict"] == "triage_clear" for board in result["boards"]
    )
    not_assessable_count = sum(
        board["verdict"] == "not_assessable" for board in result["boards"]
    )
    print(
        f"Created {len(result['boards'])} comparison boards: "
        f"{review_count} review, {clear_count} no configured warning, "
        f"{not_assessable_count} not assessable."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
