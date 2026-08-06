"""Compare E57-matched Reception renders without fitting or moving either image.

The tool accepts exactly the held validation scans 131, 134, and 138.  It
performs one declared full-frame isotropic resize, removes one fixed declared
border, and scores exposure-resistant structure.  It never registers, shifts,
rotates, warps, trains, publishes, or physically approves a candidate.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
from io import BytesIO
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
import sys
from typing import Any, NamedTuple, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError
from scipy.ndimage import distance_transform_edt, gaussian_filter, sobel


INPUT_SCHEMA_VERSION = "venviewer.reception-e57-matched-cv-input.v1"
RECEIPT_SCHEMA_VERSION = "venviewer.reception-e57-matched-cv-receipt.v1"
EXPECTED_SCAN_IDS = (131, 134, 138)
FROZEN_TEST_SCAN_IDS = (126, 129, 141)
CANDIDATE_IDS = ("quality", "mobile")
CONTACT_COLUMNS = (
    ("reference", "REAL E57 REFERENCE"),
    ("quality", "QUALITY CANDIDATE"),
    ("mobile", "MOBILE CANDIDATE"),
)
METRIC_IDS = (
    "multiscaleEdgeChamfer",
    "normalizedGradientOrientationSimilarity",
)
SCALE_FACTORS = (1, 2, 4)
SCALE_WEIGHTS = (0.50, 0.30, 0.20)
EDGE_QUANTILE = 0.85
EDGE_DISTANCE_CLIP_PIXELS = 32.0
LOCAL_NORMALIZATION_SIGMA = 3.0
MAX_BORDER_FRACTION = 0.05
MIN_COMPARISON_DIMENSION = 64
MAX_COMPARISON_DIMENSION = 4096
MAX_IMAGE_DIMENSION = 16384
MAX_IMAGE_PIXELS = 100_000_000
MAX_IMAGE_BYTES = 256 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
NUMERIC_TOLERANCE = 1e-12
RECEIPT_DIGEST_DOMAIN = b"venviewer.reception-e57-matched-cv-receipt.v1\x00"


class ComparisonError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


class ImageRecord(NamedTuple):
    path: Path
    sha256: str
    size_bytes: int
    mtime_ns: int
    original_width: int
    original_height: int
    original_mode: str
    image_format: str
    comparison_rgb: np.ndarray
    evidence: dict[str, Any]


def fail(code: str, message: str) -> None:
    raise ComparisonError(code, message)


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail("DUPLICATE_JSON_KEY", f"JSON object repeats key {key!r}")
        result[key] = value
    return result


def _exact_object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail("INVALID_MANIFEST", f"{label} must be an object")
    actual = set(value)
    if actual != keys:
        fail(
            "INVALID_MANIFEST_KEYS",
            f"{label} keys differ; missing={sorted(keys-actual)}, unexpected={sorted(actual-keys)}",
        )
    return value


def _int_in_range(value: Any, minimum: int, maximum: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        fail("INVALID_MANIFEST", f"{label} must be an integer")
    if value < minimum or value > maximum:
        fail("INVALID_MANIFEST", f"{label} must be between {minimum} and {maximum}")
    return value


def _read_manifest(path: Path) -> tuple[dict[str, Any], bytes, Path, os.stat_result]:
    try:
        resolved = path.resolve(strict=True)
        stat = resolved.stat()
    except (OSError, RuntimeError) as error:
        fail("MANIFEST_NOT_READABLE", f"cannot open manifest: {error}")
    if not resolved.is_file() or stat.st_size > MAX_MANIFEST_BYTES:
        fail("MANIFEST_NOT_READABLE", "manifest must be a regular file no larger than 1 MiB")
    try:
        payload = resolved.read_bytes()
        decoded = json.loads(payload.decode("utf-8"), object_pairs_hook=_unique_object)
    except ComparisonError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail("INVALID_MANIFEST_JSON", str(error))
    if not isinstance(decoded, dict):
        fail("INVALID_MANIFEST", "manifest root must be an object")
    return decoded, payload, resolved, stat


def _validate_comparison(value: Any) -> dict[str, int]:
    raw = _exact_object(value, {"width", "height", "borderPixels"}, "comparison")
    width = _int_in_range(
        raw["width"], MIN_COMPARISON_DIMENSION, MAX_COMPARISON_DIMENSION, "comparison.width"
    )
    height = _int_in_range(
        raw["height"], MIN_COMPARISON_DIMENSION, MAX_COMPARISON_DIMENSION, "comparison.height"
    )
    if width % max(SCALE_FACTORS) or height % max(SCALE_FACTORS):
        fail(
            "INVALID_MANIFEST",
            f"comparison width and height must be divisible by {max(SCALE_FACTORS)} so multiscale scoring keeps the full frame",
        )
    maximum_border = math.floor(min(width, height) * MAX_BORDER_FRACTION)
    border = _int_in_range(raw["borderPixels"], 0, maximum_border, "comparison.borderPixels")
    if width - 2 * border < MIN_COMPARISON_DIMENSION // 2:
        fail("INVALID_MANIFEST", "declared border leaves too little comparison image")
    return {"width": width, "height": height, "borderPixels": border}


def _parse_candidate(value: Any, label: str) -> dict[str, str | None]:
    if not isinstance(value, dict):
        fail("INVALID_MANIFEST", f"{label} must be an object")
    keys = set(value)
    if keys not in ({"render"}, {"render", "repeat"}):
        fail("INVALID_MANIFEST_KEYS", f"{label} must contain render and optional repeat")
    result: dict[str, str | None] = {"render": None, "repeat": None}
    for key in keys:
        if not isinstance(value[key], str) or not value[key].strip():
            fail("INVALID_MANIFEST", f"{label}.{key} must be a non-empty path string")
        result[key] = value[key]
    return result


def _parse_views(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        fail("INVALID_MANIFEST", "views must be an array")
    parsed: list[dict[str, Any]] = []
    scan_ids: list[int] = []
    for index, item in enumerate(value):
        raw = _exact_object(
            item, {"scanId", "reference", "quality", "mobile"}, f"views[{index}]"
        )
        scan_id = _int_in_range(raw["scanId"], 0, 1_000_000, f"views[{index}].scanId")
        if not isinstance(raw["reference"], str) or not raw["reference"].strip():
            fail("INVALID_MANIFEST", f"views[{index}].reference must be a non-empty path")
        scan_ids.append(scan_id)
        parsed.append(
            {
                "scanId": scan_id,
                "reference": raw["reference"],
                "quality": _parse_candidate(raw["quality"], f"views[{index}].quality"),
                "mobile": _parse_candidate(raw["mobile"], f"views[{index}].mobile"),
            }
        )
    if len(scan_ids) != len(set(scan_ids)):
        fail("DUPLICATE_SCAN_ID", "views contain a duplicate scan ID")
    frozen = sorted(set(scan_ids).intersection(FROZEN_TEST_SCAN_IDS))
    if frozen:
        fail("FROZEN_TEST_SCAN_FIREWALL", f"frozen test scan IDs are forbidden: {frozen}")
    missing = sorted(set(EXPECTED_SCAN_IDS) - set(scan_ids))
    extra = sorted(set(scan_ids) - set(EXPECTED_SCAN_IDS))
    if missing or extra:
        fail("VALIDATION_SCAN_SET_MISMATCH", f"missing={missing}, extra={extra}")
    return sorted(parsed, key=lambda row: row["scanId"])


def _validate_manifest(raw: dict[str, Any]) -> tuple[dict[str, int], list[dict[str, Any]]]:
    document = _exact_object(
        raw, {"schemaVersion", "authority", "comparison", "views"}, "manifest"
    )
    if document["schemaVersion"] != INPUT_SCHEMA_VERSION:
        fail("SCHEMA_VERSION_MISMATCH", f"schemaVersion must be {INPUT_SCHEMA_VERSION}")
    if document["authority"] != "none":
        fail("AUTHORITY_NOT_NONE", "computer-vision input authority must be none")
    return _validate_comparison(document["comparison"]), _parse_views(document["views"])


def _resolve_input_path(raw: str, manifest_parent: Path, label: str) -> Path:
    supplied = Path(raw)
    candidate = supplied if supplied.is_absolute() else manifest_parent / supplied
    try:
        resolved = candidate.resolve(strict=True)
        stat = resolved.stat()
    except (OSError, RuntimeError) as error:
        fail("MISSING_IMAGE", f"{label} cannot be opened: {error}")
    if not resolved.is_file():
        fail("MISSING_IMAGE", f"{label} is not a regular file")
    if stat.st_size <= 0 or stat.st_size > MAX_IMAGE_BYTES:
        fail("INVALID_IMAGE_SIZE", f"{label} file size is outside the accepted range")
    return resolved


def _collect_paths(
    views: list[dict[str, Any]], manifest_parent: Path
) -> tuple[dict[tuple[int, str, str], Path], list[Path]]:
    paths: dict[tuple[int, str, str], Path] = {}
    seen: dict[Path, str] = {}
    for view in views:
        scan_id = int(view["scanId"])
        roles = [("reference", "render", view["reference"])]
        for candidate_id in CANDIDATE_IDS:
            candidate = view[candidate_id]
            roles.append((candidate_id, "render", candidate["render"]))
            if candidate["repeat"] is not None:
                roles.append((candidate_id, "repeat", candidate["repeat"]))
        for owner, role, raw_path in roles:
            label = f"scan {scan_id} {owner} {role}"
            resolved = _resolve_input_path(str(raw_path), manifest_parent, label)
            if resolved in seen:
                fail("DUPLICATE_INPUT_PATH", f"{label} reuses the path already used by {seen[resolved]}")
            seen[resolved] = label
            paths[(scan_id, owner, role)] = resolved
    return paths, sorted(seen, key=lambda path: str(path).casefold())


def _validate_image_geometry(
    original_width: int, original_height: int, width: int, height: int, label: str
) -> None:
    if original_width > MAX_IMAGE_DIMENSION or original_height > MAX_IMAGE_DIMENSION:
        fail("INVALID_IMAGE_DIMENSIONS", f"{label} dimensions exceed the safety limit")
    if original_width * original_height > MAX_IMAGE_PIXELS:
        fail("INVALID_IMAGE_DIMENSIONS", f"{label} pixel count exceeds the safety limit")
    if original_width * height != original_height * width:
        fail("ASPECT_RATIO_MISMATCH", f"{label} does not match {width}x{height} aspect ratio")
    if original_width < width or original_height < height:
        fail("UPSAMPLING_FORBIDDEN", f"{label} is smaller than the declared comparison size")


def _decode_rgb(
    path: Path, width: int, height: int, label: str
) -> tuple[bytes, os.stat_result, int, int, str, str, np.ndarray]:
    try:
        stat_before = path.stat()
        payload = path.read_bytes()
        with Image.open(path) as opened:
            opened.verify()
        with Image.open(path) as opened:
            original_width, original_height = opened.size
            original_mode = opened.mode
            image_format = opened.format or "unknown"
            if getattr(opened, "is_animated", False):
                fail("ANIMATED_IMAGE", f"{label} must be a single static frame")
            _validate_image_geometry(original_width, original_height, width, height, label)
            converted = opened.convert("RGB")
            if converted.size != (width, height):
                converted = converted.resize((width, height), Image.Resampling.LANCZOS)
            array = np.asarray(converted, dtype=np.uint8).copy()
    except ComparisonError:
        raise
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        fail("INVALID_IMAGE", f"{label} cannot be decoded: {error}")
    try:
        stat_after = path.stat()
    except OSError as error:
        fail("INPUT_CHANGED_DURING_READ", f"{label} cannot be rechecked: {error}")
    if (
        stat_before.st_size != stat_after.st_size
        or stat_before.st_mtime_ns != stat_after.st_mtime_ns
        or len(payload) != stat_before.st_size
    ):
        fail("INPUT_CHANGED_DURING_READ", f"{label} changed while it was read")
    return (
        payload,
        stat_before,
        original_width,
        original_height,
        original_mode,
        image_format,
        array,
    )


def _load_rgb(path: Path, width: int, height: int, label: str) -> ImageRecord:
    payload, stat, original_width, original_height, mode, image_format, array = _decode_rgb(
        path, width, height, label
    )
    resize_method = "identity" if (original_width, original_height) == (width, height) else "full_frame_isotropic_lanczos"
    evidence = {
        "path": str(path),
        "sha256": _sha256_bytes(payload),
        "sizeBytes": len(payload),
        "originalDimensions": [original_width, original_height],
        "comparisonDimensions": [width, height],
        "originalMode": mode,
        "format": image_format,
        "resizeMethod": resize_method,
    }
    return ImageRecord(
        path,
        evidence["sha256"],
        len(payload),
        stat.st_mtime_ns,
        original_width,
        original_height,
        mode,
        image_format,
        array,
        evidence,
    )


def _to_gray(rgb: np.ndarray) -> np.ndarray:
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        fail("IMAGE_ARRAY_SHAPE_MISMATCH", "image array must have shape height x width x 3")
    values = rgb.astype(np.float32) / np.float32(255.0)
    return (
        values[..., 0] * np.float32(0.2126)
        + values[..., 1] * np.float32(0.7152)
        + values[..., 2] * np.float32(0.0722)
    )


def _blank_statistics(gray: np.ndarray) -> dict[str, float]:
    low, high = np.quantile(gray, (0.01, 0.99))
    gradient_y = sobel(gray, axis=0, mode="reflect") / np.float32(8.0)
    gradient_x = sobel(gray, axis=1, mode="reflect") / np.float32(8.0)
    gradient = np.hypot(gradient_x, gradient_y)
    return {
        "standardDeviation": float(np.std(gray, dtype=np.float64)),
        "p01ToP99Range": float(high - low),
        "p95GradientMagnitude": float(np.quantile(gradient, 0.95)),
    }


def _require_nonblank(gray: np.ndarray, label: str) -> dict[str, float]:
    statistics = _blank_statistics(gray)
    if (
        statistics["standardDeviation"] < 0.01
        or statistics["p01ToP99Range"] < 0.04
        or statistics["p95GradientMagnitude"] < 0.002
    ):
        fail("BLANK_IMAGE", f"{label} lacks the minimum full-frame intensity and edge variation")
    return {key: round(value, 9) for key, value in statistics.items()}


def _downsample_mean(gray: np.ndarray, factor: int) -> np.ndarray:
    if factor == 1:
        return gray
    height = (gray.shape[0] // factor) * factor
    width = (gray.shape[1] // factor) * factor
    trimmed = gray[:height, :width]
    return trimmed.reshape(height // factor, factor, width // factor, factor).mean(axis=(1, 3))


def _gradient_features(gray: np.ndarray, border: int) -> tuple[np.ndarray, ...]:
    if border:
        gray = gray[border:-border, border:-border]
    mean = gaussian_filter(gray, sigma=LOCAL_NORMALIZATION_SIGMA, mode="reflect")
    centered = gray - mean
    variance = gaussian_filter(centered * centered, sigma=LOCAL_NORMALIZATION_SIGMA, mode="reflect")
    normalized = np.clip(centered / np.sqrt(variance + 1e-6), -4.0, 4.0)
    gradient_y = sobel(normalized, axis=0, mode="reflect") / 8.0
    gradient_x = sobel(normalized, axis=1, mode="reflect") / 8.0
    magnitude = np.hypot(gradient_x, gradient_y)
    threshold = max(float(np.quantile(magnitude, EDGE_QUANTILE)), 1e-4)
    edges = magnitude >= threshold
    if int(np.count_nonzero(edges)) < 16:
        fail("INSUFFICIENT_STRUCTURE", "an image scale contains too few structural edges")
    return gradient_x, gradient_y, magnitude, edges


def _edge_chamfer(a_edges: np.ndarray, b_edges: np.ndarray, clip_pixels: float) -> float:
    distance_to_b = np.minimum(distance_transform_edt(~b_edges), clip_pixels)
    distance_to_a = np.minimum(distance_transform_edt(~a_edges), clip_pixels)
    forward = float(np.mean(distance_to_b[a_edges], dtype=np.float64))
    reverse = float(np.mean(distance_to_a[b_edges], dtype=np.float64))
    return (forward + reverse) / (2.0 * clip_pixels)


def _gradient_similarity(a: tuple[np.ndarray, ...], b: tuple[np.ndarray, ...]) -> float:
    a_x, a_y, a_magnitude, _ = a
    b_x, b_y, b_magnitude, _ = b
    a_scale = max(float(np.quantile(a_magnitude, 0.95)), 1e-6)
    b_scale = max(float(np.quantile(b_magnitude, 0.95)), 1e-6)
    a_strength = np.clip(a_magnitude / a_scale, 0.0, 1.0)
    b_strength = np.clip(b_magnitude / b_scale, 0.0, 1.0)
    orientation = np.abs(a_x * b_x + a_y * b_y) / (a_magnitude * b_magnitude + 1e-8)
    strength = (2.0 * a_strength * b_strength) / (
        a_strength * a_strength + b_strength * b_strength + 1e-8
    )
    weight = np.maximum(a_strength, b_strength)
    active = weight >= 0.10
    if not np.any(active):
        fail("INSUFFICIENT_STRUCTURE", "gradient comparison has no active structural pixels")
    score = np.sum(weight[active] * orientation[active] * strength[active], dtype=np.float64)
    return float(score / np.sum(weight[active], dtype=np.float64))


def compare_arrays(a_rgb: np.ndarray, b_rgb: np.ndarray, *, border_pixels: int) -> dict[str, float]:
    if a_rgb.shape != b_rgb.shape:
        fail("IMAGE_ARRAY_SHAPE_MISMATCH", "comparison arrays must have identical shapes")
    if any(dimension % max(SCALE_FACTORS) for dimension in a_rgb.shape[:2]):
        fail(
            "IMAGE_ARRAY_SHAPE_MISMATCH",
            f"comparison height and width must be divisible by {max(SCALE_FACTORS)}",
        )
    if border_pixels < 0 or border_pixels > math.floor(min(a_rgb.shape[:2]) * MAX_BORDER_FRACTION):
        fail("INVALID_BORDER", "border exceeds the fixed five-percent limit")
    a_gray = _to_gray(a_rgb)
    b_gray = _to_gray(b_rgb)
    _require_nonblank(a_gray, "first image")
    _require_nonblank(b_gray, "second image")
    chamfer = 0.0
    gradient = 0.0
    for factor, weight in zip(SCALE_FACTORS, SCALE_WEIGHTS, strict=True):
        scaled_border = math.ceil(border_pixels / factor)
        a_features = _gradient_features(_downsample_mean(a_gray, factor), scaled_border)
        b_features = _gradient_features(_downsample_mean(b_gray, factor), scaled_border)
        clip_pixels = max(EDGE_DISTANCE_CLIP_PIXELS / factor, 1.0)
        chamfer += weight * _edge_chamfer(a_features[3], b_features[3], clip_pixels)
        gradient += weight * _gradient_similarity(a_features, b_features)
    return {
        "multiscaleEdgeChamfer": chamfer,
        "normalizedGradientOrientationSimilarity": gradient,
    }


def _compare_records(reference: ImageRecord, candidate: ImageRecord, border: int) -> dict[str, float]:
    return compare_arrays(reference.comparison_rgb, candidate.comparison_rgb, border_pixels=border)


def _metric_winner(metric_id: str, quality: float, mobile: float) -> tuple[str | None, float]:
    difference = mobile - quality if metric_id == METRIC_IDS[0] else quality - mobile
    if difference > NUMERIC_TOLERANCE:
        return "quality", difference
    if difference < -NUMERIC_TOLERANCE:
        return "mobile", -difference
    return None, 0.0


def _quality_positive_effect(metric_id: str, quality: float, mobile: float) -> tuple[float, float | None]:
    signed = mobile - quality if metric_id == METRIC_IDS[0] else quality - mobile
    scale = (abs(quality) + abs(mobile)) / 2.0
    relative = None if scale <= NUMERIC_TOLERANCE else signed / scale
    return signed, relative


def _aggregate_effects(rows: list[dict[str, Any]]) -> dict[str, Any]:
    aggregate: dict[str, Any] = {}
    for metric_id in METRIC_IDS:
        per_view: list[dict[str, Any]] = []
        signed_values: list[float] = []
        relative_values: list[float] = []
        for row in rows:
            quality = row["candidates"]["quality"]["metricsVersusReference"][metric_id]
            mobile = row["candidates"]["mobile"]["metricsVersusReference"][metric_id]
            signed, relative = _quality_positive_effect(metric_id, quality, mobile)
            signed_values.append(signed)
            if relative is not None:
                relative_values.append(relative)
            per_view.append(
                {
                    "scanId": row["scanId"],
                    "signedEffectQualityPositive": signed,
                    "relativeEffectQualityPositive": relative,
                }
            )
        aggregate[metric_id] = {
            "signConvention": "positive_favors_quality_negative_favors_mobile",
            "relativeDenominator": "mean absolute magnitude of the two candidate scores in the same view",
            "perView": per_view,
            "meanSignedEffectQualityPositive": math.fsum(signed_values) / len(signed_values),
            "medianSignedEffectQualityPositive": float(np.median(signed_values)),
            "meanRelativeEffectQualityPositive": (
                None
                if not relative_values
                else math.fsum(relative_values) / len(relative_values)
            ),
            "medianRelativeEffectQualityPositive": (
                None if not relative_values else float(np.median(relative_values))
            ),
        }
    return aggregate


def _load_records(
    paths: dict[tuple[int, str, str], Path], comparison: dict[str, int]
) -> tuple[dict[tuple[int, str, str], ImageRecord], dict[tuple[int, str, str], dict[str, float]]]:
    records: dict[tuple[int, str, str], ImageRecord] = {}
    blank_statistics: dict[tuple[int, str, str], dict[str, float]] = {}
    for key in sorted(paths):
        scan_id, owner, role = key
        label = f"scan {scan_id} {owner} {role}"
        record = _load_rgb(paths[key], comparison["width"], comparison["height"], label)
        records[key] = record
        blank_statistics[key] = _require_nonblank(_to_gray(record.comparison_rgb), label)
    return records, blank_statistics


def _candidate_view_entry(
    scan_id: int,
    candidate_id: str,
    reference: ImageRecord,
    records: dict[tuple[int, str, str], ImageRecord],
    blank_statistics: dict[tuple[int, str, str], dict[str, float]],
    border: int,
) -> tuple[dict[str, Any], dict[str, float] | None]:
    main_key = (scan_id, candidate_id, "render")
    main = records[main_key]
    metrics = _compare_records(reference, main, border)
    entry: dict[str, Any] = {
        "render": {**main.evidence, "nonblankStatistics": blank_statistics[main_key]},
        "metricsVersusReference": metrics,
        "repeat": None,
    }
    repeat_key = (scan_id, candidate_id, "repeat")
    if repeat_key not in records:
        return entry, None
    repeat = records[repeat_key]
    repeat_metrics = _compare_records(reference, repeat, border)
    deviations = {
        metric_id: abs(metrics[metric_id] - repeat_metrics[metric_id])
        for metric_id in METRIC_IDS
    }
    entry["repeat"] = {
        **repeat.evidence,
        "nonblankStatistics": blank_statistics[repeat_key],
        "metricsVersusReference": repeat_metrics,
        "absoluteMetricDeviationFromMain": deviations,
    }
    return entry, deviations


def _build_view_rows(
    records: dict[tuple[int, str, str], ImageRecord],
    blank_statistics: dict[tuple[int, str, str], dict[str, float]],
    border: int,
) -> tuple[list[dict[str, Any]], dict[str, float], dict[str, int], list[int]]:
    rows: list[dict[str, Any]] = []
    repeat_deviations = {metric_id: [] for metric_id in METRIC_IDS}
    repeat_counts = {candidate_id: 0 for candidate_id in CANDIDATE_IDS}
    common_repeat_scans: list[int] = []
    for scan_id in EXPECTED_SCAN_IDS:
        reference = records[(scan_id, "reference", "render")]
        candidate_rows: dict[str, Any] = {}
        both_repeat = True
        for candidate_id in CANDIDATE_IDS:
            entry, deviations = _candidate_view_entry(
                scan_id, candidate_id, reference, records, blank_statistics, border
            )
            if deviations is not None:
                repeat_counts[candidate_id] += 1
                for metric_id in METRIC_IDS:
                    repeat_deviations[metric_id].append(deviations[metric_id])
            else:
                both_repeat = False
            candidate_rows[candidate_id] = entry
        if both_repeat:
            common_repeat_scans.append(scan_id)
        rows.append(
            {
                "scanId": scan_id,
                "reference": {
                    **reference.evidence,
                    "nonblankStatistics": blank_statistics[(scan_id, "reference", "render")],
                },
                "candidates": candidate_rows,
            }
        )
    noise = {
        metric_id: max(repeat_deviations[metric_id], default=0.0)
        for metric_id in METRIC_IDS
    }
    return rows, noise, repeat_counts, common_repeat_scans


def _annotate_view_comparisons(
    rows: list[dict[str, Any]], repeat_noise: dict[str, float]
) -> dict[str, dict[str, int]]:
    counts = {
        candidate_id: {metric_id: 0 for metric_id in METRIC_IDS}
        for candidate_id in CANDIDATE_IDS
    }
    for row in rows:
        comparisons: dict[str, Any] = {}
        for metric_id in METRIC_IDS:
            quality = row["candidates"]["quality"]["metricsVersusReference"][metric_id]
            mobile = row["candidates"]["mobile"]["metricsVersusReference"][metric_id]
            winner, margin = _metric_winner(metric_id, quality, mobile)
            signed_effect, relative_effect = _quality_positive_effect(metric_id, quality, mobile)
            clear = winner is not None and margin > repeat_noise[metric_id] + NUMERIC_TOLERANCE
            if clear:
                counts[winner][metric_id] += 1
            comparisons[metric_id] = {
                "rawWinner": winner,
                "absoluteMargin": margin,
                "signedEffectQualityPositive": signed_effect,
                "relativeEffectQualityPositive": relative_effect,
                "observedRepeatNoiseFloor": repeat_noise[metric_id],
                "clearWinnerBeyondRepeatNoise": winner if clear else None,
            }
        row["candidateComparison"] = comparisons
    return counts


def _decision_outcome(
    counts: dict[str, dict[str, int]], common_repeat_scans: list[int]
) -> tuple[str, str | None, list[str]]:
    repeat_evidence_available = bool(common_repeat_scans)
    qualifiers = [
        candidate_id
        for candidate_id in CANDIDATE_IDS
        if repeat_evidence_available
        and all(counts[candidate_id][metric_id] >= 2 for metric_id in METRIC_IDS)
    ]
    if len(qualifiers) == 1:
        candidate: str | None = qualifiers[0]
        reasons = [
            f"{candidate} satisfies the predeclared directional rule: at least two of three held validation views on both primary metrics, with every counted margin above observed repeat noise.",
            "This rule has no calibrated minimum practical-effect threshold, so a numerically slight margin can count when supplied repeat deviations are small or zero.",
        ]
        return "directional_lead", candidate, reasons
    reasons = []
    if not repeat_evidence_available:
        reasons.append("No common repeat evidence exists for both candidates, so repeat noise is unknown.")
    reasons.append(
        "No single candidate won at least two of three held validation views on both primary metrics after every counted margin had to exceed observed repeat noise."
    )
    return "no_reliable_winner", None, reasons


def _apply_decision(
    rows: list[dict[str, Any]],
    repeat_noise: dict[str, float],
    repeat_counts: dict[str, int],
    common_repeat_scans: list[int],
) -> dict[str, Any]:
    counts = _annotate_view_comparisons(rows, repeat_noise)
    status, candidate, reasons = _decision_outcome(counts, common_repeat_scans)
    return {
        "status": status,
        "candidate": candidate,
        "claimScope": "computer_vision_directional_lead_only",
        "isPhysicalApproval": False,
        "isRuntimePromotionApproval": False,
        "isPracticallyMaterial": None,
        "practicalMaterialityAssessment": "not_calibrated",
        "practicalMaterialityExplanation": "Signed and relative effects are reported, but no preregistered evidence-backed threshold says what size is meaningful for this room or decision.",
        "reasons": reasons,
        "clearWinCounts": counts,
        "aggregateEffectSizes": _aggregate_effects(rows),
        "repeatEvidence": {
            "repeatCountByCandidate": repeat_counts,
            "commonRepeatScanIds": common_repeat_scans,
            "observedGlobalNoiseFloorByMetric": repeat_noise,
        },
    }


def _verify_records_unchanged(records: dict[tuple[int, str, str], ImageRecord]) -> None:
    for key, record in records.items():
        try:
            stat = record.path.stat()
            current_hash = _sha256_bytes(record.path.read_bytes())
        except OSError as error:
            fail("INPUT_CHANGED_AFTER_SCORING", f"{key} cannot be re-read: {error}")
        if (
            stat.st_size != record.size_bytes
            or stat.st_mtime_ns != record.mtime_ns
            or current_hash != record.sha256
        ):
            fail("INPUT_CHANGED_AFTER_SCORING", f"{key} changed during scoring")


def _receipt_image_hashes(document: dict[str, Any]) -> dict[tuple[int, str, str], str]:
    result: dict[tuple[int, str, str], str] = {}
    for row in document["views"]:
        scan_id = int(row["scanId"])
        result[(scan_id, "reference", "render")] = row["reference"]["sha256"]
        for candidate_id in CANDIDATE_IDS:
            candidate = row["candidates"][candidate_id]
            result[(scan_id, candidate_id, "render")] = candidate["render"]["sha256"]
            if candidate["repeat"] is not None:
                result[(scan_id, candidate_id, "repeat")] = candidate["repeat"]["sha256"]
    return result


def _require_records_match_receipt(
    records: dict[tuple[int, str, str], ImageRecord], document: dict[str, Any]
) -> None:
    expected = _receipt_image_hashes(document)
    actual = {key: record.sha256 for key, record in records.items()}
    if actual != expected:
        fail("INPUT_CHANGED_AFTER_SCORING", "contact-sheet image bytes differ from scored bytes")


def _centered_text(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    text: str,
    font: ImageFont.ImageFont,
    fill: tuple[int, int, int],
) -> None:
    left, top, right, bottom = box
    bounds = draw.textbbox((0, 0), text, font=font)
    text_width = bounds[2] - bounds[0]
    text_height = bounds[3] - bounds[1]
    x = left + (right - left - text_width) // 2
    y = top + (bottom - top - text_height) // 2 - bounds[1]
    draw.text((x, y), text, font=font, fill=fill)


def _contact_geometry(records: dict[tuple[int, str, str], ImageRecord]) -> dict[str, int]:
    sample = records[(EXPECTED_SCAN_IDS[0], "reference", "render")].comparison_rgb
    comparison_height, comparison_width = sample.shape[:2]
    display_scale = min(1.0, 512.0 / max(comparison_width, comparison_height))
    cell_width = max(1, round(comparison_width * display_scale))
    cell_height = max(1, round(comparison_height * display_scale))
    gutter = 10
    label_width = max(112, cell_width // 5)
    title_height = 100
    column_height = 48
    return {
        "cellWidth": cell_width,
        "cellHeight": cell_height,
        "gutter": gutter,
        "labelWidth": label_width,
        "titleHeight": title_height,
        "columnHeight": column_height,
        "width": label_width + 3 * cell_width + 4 * gutter,
        "height": title_height + column_height + 3 * cell_height + 4 * gutter,
    }


def _draw_contact_labels(draw: ImageDraw.ImageDraw, geometry: dict[str, int]) -> ImageFont.ImageFont:
    font_basis = min(geometry["cellWidth"], geometry["cellHeight"])
    title_font = ImageFont.load_default(size=max(22, font_basis // 18))
    label_font = ImageFont.load_default(size=max(16, font_basis // 25))
    note_font = ImageFont.load_default(size=max(13, font_basis // 34))
    gutter = geometry["gutter"]
    draw.text((gutter, 12), "Reception E57-matched visual review", font=title_font, fill=(245, 247, 250))
    draw.text(
        (gutter, 60),
        "AUTHORITY NONE  |  HUMAN REVIEW AID  |  NOT PHYSICAL APPROVAL",
        font=note_font,
        fill=(255, 190, 92),
    )
    for index, (_, label) in enumerate(CONTACT_COLUMNS):
        left = geometry["labelWidth"] + (index + 1) * gutter + index * geometry["cellWidth"]
        _centered_text(
            draw,
            (left, geometry["titleHeight"], left + geometry["cellWidth"], geometry["titleHeight"] + geometry["columnHeight"]),
            label,
            label_font,
            (218, 224, 232),
        )
    return label_font


def _draw_contact_tiles(
    canvas: Image.Image,
    draw: ImageDraw.ImageDraw,
    records: dict[tuple[int, str, str], ImageRecord],
    geometry: dict[str, int],
    label_font: ImageFont.ImageFont,
) -> None:
    gutter = geometry["gutter"]
    cell_width = geometry["cellWidth"]
    cell_height = geometry["cellHeight"]
    for row_index, scan_id in enumerate(EXPECTED_SCAN_IDS):
        top = geometry["titleHeight"] + geometry["columnHeight"] + (row_index + 1) * gutter + row_index * cell_height
        _centered_text(
            draw,
            (gutter, top, geometry["labelWidth"], top + cell_height),
            f"SCAN {scan_id}",
            label_font,
            (218, 224, 232),
        )
        for column_index, (owner, _) in enumerate(CONTACT_COLUMNS):
            tile = Image.fromarray(records[(scan_id, owner, "render")].comparison_rgb, mode="RGB")
            if tile.size != (cell_width, cell_height):
                tile = tile.resize((cell_width, cell_height), Image.Resampling.LANCZOS)
            left = geometry["labelWidth"] + (column_index + 1) * gutter + column_index * cell_width
            canvas.paste(tile, (left, top))
            draw.rectangle(
                (left, top, left + cell_width - 1, top + cell_height - 1),
                outline=(112, 121, 134),
                width=2,
            )


def _contact_sheet_bytes(records: dict[tuple[int, str, str], ImageRecord]) -> tuple[bytes, dict[str, Any]]:
    geometry = _contact_geometry(records)
    canvas = Image.new("RGB", (geometry["width"], geometry["height"]), (20, 23, 28))
    draw = ImageDraw.Draw(canvas)
    label_font = _draw_contact_labels(draw, geometry)
    _draw_contact_tiles(canvas, draw, records, geometry, label_font)
    stream = BytesIO()
    canvas.save(stream, format="PNG", optimize=False, compress_level=9)
    payload = stream.getvalue()
    return payload, {
        "dimensions": [geometry["width"], geometry["height"]],
        "layout": {"rows": list(EXPECTED_SCAN_IDS), "columns": [label for _, label in CONTACT_COLUMNS]},
        "imagePolicy": "full-frame comparison images only; display resize is isotropic and no score is computed from the contact sheet",
    }


def _seal(document: dict[str, Any]) -> dict[str, Any]:
    unsigned = copy.deepcopy(document)
    unsigned.pop("receipt", None)
    digest = hashlib.sha256(RECEIPT_DIGEST_DOMAIN + _canonical_json_bytes(unsigned)).hexdigest()
    sealed = copy.deepcopy(unsigned)
    sealed["receipt"] = {
        "algorithm": "SHA-256",
        "domain": RECEIPT_DIGEST_DOMAIN[:-1].decode("ascii"),
        "sha256": digest,
        "isSignature": False,
        "authenticatesCreator": False,
        "provesTimestamp": False,
    }
    return sealed


def _method_evidence() -> dict[str, Any]:
    return {
        "geometryPolicy": "full-frame isotropic resize only; no shift, rotation, warp, registration, or favorable crop search",
        "resize": "Pillow LANCZOS to exactly the manifest-declared comparison dimensions; upsampling forbidden",
        "border": f"exactly the declared borderPixels on every side; capped at {MAX_BORDER_FRACTION:.0%}",
        "metrics": {
            METRIC_IDS[0]: {
                "direction": "lower_is_better",
                "definition": "weighted mean symmetric distance between robust local-contrast Sobel edge sets at scales 1, 2, and 4; distances clipped at 32 comparison pixels",
            },
            METRIC_IDS[1]: {
                "direction": "higher_is_better",
                "range": [0.0, 1.0],
                "definition": "weighted multiscale similarity of unsigned gradient orientation and robust normalized gradient strength",
            },
        },
        "scaleFactors": list(SCALE_FACTORS),
        "scaleWeights": list(SCALE_WEIGHTS),
        "edgeMagnitudeQuantile": EDGE_QUANTILE,
        "decisionRule": "directional lead only when one candidate has clear wins on both metrics in at least two of three views, every counted margin exceeds the maximum observed repeat-score deviation, at least one scan has repeats for both candidates, and every input passes nonblank checks",
        "practicalEffectThreshold": None,
        "practicalEffectThresholdReason": "no preregistered evidence-backed materiality threshold exists; the decision is directional only",
        "packages": {
            "numpy": version("numpy"),
            "Pillow": version("Pillow"),
            "scipy": version("scipy"),
        },
    }


def _safety_evidence() -> dict[str, Any]:
    return {
        "sourceMutationPermitted": False,
        "sourceMutationPerformed": False,
        "geometricRegistrationPermitted": False,
        "geometricRegistrationPerformed": False,
        "trainingPermitted": False,
        "trainingPerformed": False,
        "networkUsePermitted": False,
        "networkUsePerformed": False,
        "physicalApprovalGrantedOrClaimed": False,
        "runtimePromotionGrantedOrClaimed": False,
        "outputPolicy": "one create-only authority-none JSON receipt",
    }


def _limitations() -> list[str]:
    return [
        "The E57 panoramas are camera images, not independent surveyed control measurements.",
        "A structural image lead can be caused by camera, exposure, occlusion, or renderer differences and does not prove physical accuracy.",
        "The observed repeat noise floor covers only the repeat images supplied in this manifest.",
        "Byte-identical supplied repeats produce a zero observed score deviation; this does not prove the renderer has zero stochastic variation outside those captures.",
        "The directional rule does not establish that the measured effect is large enough to matter in practice.",
        "The self-digest detects an unrecomputed edit but is not a signature, trusted timestamp, rights grant, or truth certificate.",
    ]


def evaluate_manifest(manifest_path: Path) -> dict[str, Any]:
    raw, manifest_bytes, resolved_manifest, manifest_stat = _read_manifest(Path(manifest_path))
    comparison, views = _validate_manifest(raw)
    paths, _ = _collect_paths(views, resolved_manifest.parent)
    records, blank_statistics = _load_records(paths, comparison)
    rows, repeat_noise, repeat_counts, common_repeat_scans = _build_view_rows(
        records, blank_statistics, comparison["borderPixels"]
    )
    decision = _apply_decision(rows, repeat_noise, repeat_counts, common_repeat_scans)
    _verify_records_unchanged(records)
    try:
        current_manifest_bytes = resolved_manifest.read_bytes()
        current_manifest_stat = resolved_manifest.stat()
    except OSError as error:
        fail("MANIFEST_CHANGED_DURING_SCORING", f"manifest cannot be rechecked: {error}")
    if (
        current_manifest_stat.st_mtime_ns != manifest_stat.st_mtime_ns
        or current_manifest_stat.st_size != manifest_stat.st_size
        or _sha256_bytes(current_manifest_bytes) != _sha256_bytes(manifest_bytes)
    ):
        fail("MANIFEST_CHANGED_DURING_SCORING", "manifest changed during scoring")
    tool_bytes = Path(__file__).read_bytes()
    document = {
        "schemaVersion": RECEIPT_SCHEMA_VERSION,
        "status": "diagnostic_complete_authority_none",
        "authority": "none",
        "scope": {
            "roomLabel": "Reception Room",
            "heldValidationScanIds": list(EXPECTED_SCAN_IDS),
            "frozenTestScanIdsNotRequestedReadOrUsed": list(FROZEN_TEST_SCAN_IDS),
            "candidateIds": list(CANDIDATE_IDS),
        },
        "inputEvidence": {
            "manifest": {
                "path": str(resolved_manifest),
                "sha256": _sha256_bytes(manifest_bytes),
                "sizeBytes": len(manifest_bytes),
            },
            "tool": {"path": str(Path(__file__).resolve()), "sha256": _sha256_bytes(tool_bytes)},
        },
        "comparison": comparison,
        "method": _method_evidence(),
        "views": rows,
        "decision": decision,
        "safety": _safety_evidence(),
        "limitations": _limitations(),
    }
    return _seal(document)


def _write_create_only(output: Path, document: dict[str, Any], protected: set[Path]) -> None:
    candidate = output.resolve(strict=False)
    if candidate in protected:
        fail("OUTPUT_OVERLAPS_INPUT", "output path overlaps a protected input")
    if not candidate.parent.exists() or not candidate.parent.is_dir():
        fail("OUTPUT_PARENT_MISSING", "output parent directory must already exist")
    payload = (json.dumps(document, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    try:
        descriptor = os.open(candidate, flags, 0o600)
    except FileExistsError:
        fail("OUTPUT_EXISTS", "output already exists; receipts are create-only")
    except OSError as error:
        fail("OUTPUT_NOT_WRITABLE", f"cannot create receipt: {error}")
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    except OSError as error:
        try:
            candidate.unlink(missing_ok=True)
        except OSError:
            pass
        fail("OUTPUT_WRITE_FAILED", f"cannot finish receipt: {error}")


def _write_bytes_create_only(output: Path, payload: bytes, protected: set[Path]) -> None:
    candidate = output.resolve(strict=False)
    if candidate in protected:
        fail("OUTPUT_OVERLAPS_INPUT", "contact-sheet path overlaps another protected path")
    if candidate.suffix.casefold() != ".png":
        fail("CONTACT_SHEET_EXTENSION", "contact sheet must use a .png path")
    if not candidate.parent.exists() or not candidate.parent.is_dir():
        fail("OUTPUT_PARENT_MISSING", "contact-sheet parent directory must already exist")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    try:
        descriptor = os.open(candidate, flags, 0o600)
    except FileExistsError:
        fail("OUTPUT_EXISTS", "contact sheet already exists; outputs are create-only")
    except OSError as error:
        fail("OUTPUT_NOT_WRITABLE", f"cannot create contact sheet: {error}")
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    except OSError as error:
        try:
            candidate.unlink(missing_ok=True)
        except OSError:
            pass
        fail("OUTPUT_WRITE_FAILED", f"cannot finish contact sheet: {error}")


def run(manifest_path: Path, output: Path, contact_sheet: Path | None = None) -> dict[str, Any]:
    manifest = Path(manifest_path)
    target = Path(output).resolve(strict=False)
    if target.exists():
        fail("OUTPUT_EXISTS", "output already exists; receipts are create-only")
    contact_target = None if contact_sheet is None else Path(contact_sheet).resolve(strict=False)
    if contact_target is not None and contact_target.exists():
        fail("OUTPUT_EXISTS", "contact sheet already exists; outputs are create-only")
    document = evaluate_manifest(manifest)
    raw, manifest_bytes, resolved_manifest, _ = _read_manifest(manifest)
    if _sha256_bytes(manifest_bytes) != document["inputEvidence"]["manifest"]["sha256"]:
        fail("MANIFEST_CHANGED_DURING_SCORING", "manifest changed after scoring")
    comparison, views = _validate_manifest(raw)
    paths, image_paths = _collect_paths(views, resolved_manifest.parent)
    protected = {resolved_manifest, *image_paths, target}
    contact_created = False
    if contact_target is not None:
        records, _ = _load_records(paths, comparison)
        _require_records_match_receipt(records, document)
        contact_payload, layout = _contact_sheet_bytes(records)
        _verify_records_unchanged(records)
        unsigned = copy.deepcopy(document)
        unsigned.pop("receipt", None)
        unsigned["contactSheet"] = {
            "path": str(contact_target),
            "sha256": _sha256_bytes(contact_payload),
            "sizeBytes": len(contact_payload),
            "authority": "none",
            "isPhysicalApproval": False,
            **layout,
        }
        unsigned["safety"]["outputPolicy"] = (
            "one create-only authority-none JSON receipt and one optional create-only labeled PNG review aid"
        )
        document = _seal(unsigned)
        _write_bytes_create_only(contact_target, contact_payload, protected)
        contact_created = True
        protected.add(contact_target)
    try:
        _write_create_only(target, document, protected - {target})
    except Exception:
        if contact_created and contact_target is not None:
            try:
                contact_target.unlink(missing_ok=True)
            except OSError:
                pass
        raise
    return document


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--contact-sheet",
        type=Path,
        help="optional new .png path for a labeled 3x3 human-review contact sheet",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    try:
        arguments = build_parser().parse_args(argv)
        document = run(arguments.manifest, arguments.output, arguments.contact_sheet)
        print(
            json.dumps(
                {
                    "status": document["decision"]["status"],
                    "candidate": document["decision"]["candidate"],
                    "authority": "none",
                    "isPhysicalApproval": False,
                    "output": str(arguments.output.resolve(strict=False)),
                    "contactSheet": (
                        None
                        if arguments.contact_sheet is None
                        else str(arguments.contact_sheet.resolve(strict=False))
                    ),
                    "receiptSha256": document["receipt"]["sha256"],
                },
                sort_keys=True,
            )
        )
        return 0
    except ComparisonError as error:
        print(
            json.dumps(
                {"status": "error_no_receipt_created", "code": error.code, "message": error.message},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
