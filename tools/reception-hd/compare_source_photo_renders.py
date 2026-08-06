"""Freeze and score same-camera source-photo comparisons without promotion authority.

The command has two intentionally different uses.  A source-view diagnostic can
show where an existing reconstruction stopped matching one of its own source
photographs, but it can never choose a winner.  A held-out physical comparison
can expose a machine directional signal only after stricter lineage, camera,
mask, repeat, threshold, and human-review gates pass.  Neither mode grants
physical, commercial, runtime-promotion, publication, or training authority.
"""

from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import sys
from typing import Any, Sequence
from urllib.parse import unquote, urlsplit

import numpy as np
from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError
from scipy.ndimage import binary_erosion, distance_transform_edt, gaussian_filter, sobel, uniform_filter


DRAFT_SCHEMA_VERSION = "venviewer.reception-source-photo-cv-draft.v1"
PROTOCOL_SCHEMA_VERSION = "venviewer.reception-source-photo-cv-protocol.v1"
RUN_SCHEMA_VERSION = "venviewer.reception-source-photo-cv-run.v2"
CAPTURE_RECEIPT_SCHEMA_VERSION = "venviewer.reception-source-photo-capture-receipt.v3"
CAPTURE_PLAN_SCHEMA_VERSION = "venviewer.reception-source-photo-capture-plan.v1"
SERVED_PAGE_MANIFEST_SCHEMA_VERSION = "venviewer.reception-served-page-manifest.v1"
CAPTURE_TOOLCHAIN_SCHEMA_VERSION = "venviewer.reception-capture-toolchain.v1"
CAPTURE_ADAPTER_SCHEMA_VERSION = "venviewer.reception-renderer-capture.v1"
FRAME_DIGEST_DOMAIN = b"venviewer.reception-presented-frame.v1\x00"
DATASET_INVENTORY_SCHEMA_VERSION = "venviewer.reception-source-photo-dataset-inventory.v1"
RESULT_SCHEMA_VERSION = "venviewer.reception-source-photo-cv-result.v1"
ANSWER_KEY_SCHEMA_VERSION = "venviewer.reception-source-photo-cv-answer-key.v1"
REVIEW_INPUT_SCHEMA_VERSION = "venviewer.reception-source-photo-human-review-input.v1"
REVIEW_RECEIPT_SCHEMA_VERSION = "venviewer.reception-source-photo-human-review-receipt.v1"
CAMERA_VALIDATION_SCHEMA_VERSION = "venviewer.reception-camera-validation.v1"
REFERENCE_ACQUISITION_SCHEMA_VERSION = "venviewer.reception-reference-acquisition.v1"
CAPTURE_ADAPTER_APPROVAL_SCHEMA_VERSION = "venviewer.reception-capture-adapter-approval.v1"
METRIC_IDS = (
    "maskedMultiscaleEdgeChamfer",
    "maskedGradientOrientationSimilarity",
    "maskedLinearRgbRmse",
    "maskedSrgbPsnrDb",
    "maskedSrgbSsim",
    "maskedSrgbMae",
)
LOWER_IS_BETTER = frozenset(
    {"maskedMultiscaleEdgeChamfer", "maskedLinearRgbRmse", "maskedSrgbMae"}
)
PURPOSES = frozenset({"source_view_diagnostic", "heldout_physical_comparison"})
REFERENCE_ROLES = frozenset({"source_view", "heldout_physical", "unknown"})
LINEAGE_STATES = frozenset({"yes", "no", "unknown"})
LINEAGE_FIELDS = frozenset(
    {
        "usedInReconstruction",
        "usedInMapping",
        "usedInBundleAdjustment",
        "usedInTraining",
        "usedInAppearanceFitting",
        "usedInPoseRefinement",
        "usedInThresholdSelection",
        "candidateImagesViewedBeforeMaskFreeze",
    }
)
CANDIDATE_DATA_USES = (
    "reconstruction",
    "mapping",
    "bundle_adjustment",
    "training",
    "appearance_fitting",
    "pose_refinement",
    "threshold_selection",
)
HERO_FEATURES = frozenset(
    {
        "timber_doors_glazing",
        "curtains_windows",
        "column_moulding",
        "floorboards",
        "room_depth_detail",
    }
)
REGION_FEATURES = HERO_FEATURES | {"context"}
HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,95}$")
SCALE_FACTORS = (1, 2, 4)
SCALE_WEIGHTS = (0.50, 0.30, 0.20)
EDGE_QUANTILE = 0.85
EDGE_DISTANCE_CLIP_PIXELS = 32.0
LOCAL_NORMALIZATION_SIGMA = 3.0
MIN_IMAGE_DIMENSION = 64
MAX_IMAGE_DIMENSION = 8192
MAX_IMAGE_PIXELS = 100_000_000
MAX_IMAGE_BYTES = 512 * 1024 * 1024
MAX_JSON_BYTES = 4 * 1024 * 1024
MAX_CAPTURE_ASSET_BYTES = 64 * 1024 * 1024
MAX_CAPTURE_CANDIDATE_BYTES = 512 * 1024 * 1024
MAX_REVIEW_BOARD_PIXELS = 100_000_000
MAX_REVIEW_BOARD_DIMENSION = 32_768
MIN_HELDOUT_CAMERA_SEPARATION_METRES = 0.25
MIN_HELDOUT_FIT_CONTROLS = 12
MIN_HELDOUT_BLIND_CONTROLS = 6
MAX_HELDOUT_MEDIAN_REPROJECTION_PIXELS = 1.0
MAX_HELDOUT_P95_REPROJECTION_PIXELS = 2.0
MAX_HELDOUT_REPROJECTION_PIXELS = 4.0
TRUSTED_HELDOUT_CAPTURE_RUNNER_SHA256: frozenset[str] = frozenset()
MIN_MASK_PIXELS = 256
MIN_MASK_EDGE_PIXELS = 8
MIN_MASK_FRACTION = 0.005
MAX_MASK_FRACTION = 0.75
PROTOCOL_DIGEST_DOMAIN = b"venviewer.reception-source-photo-cv-protocol.v1\x00"
RESULT_DIGEST_DOMAIN = b"venviewer.reception-source-photo-cv-result.v1\x00"
ANSWER_KEY_DIGEST_DOMAIN = b"venviewer.reception-source-photo-cv-answer-key.v1\x00"
REVIEW_DIGEST_DOMAIN = b"venviewer.reception-source-photo-human-review-receipt.v1\x00"
RENDERER_BINDING_DIGEST_DOMAIN = b"venviewer.reception-renderer-binding.v1\x00"
RUNTIME_ENVIRONMENT_DIGEST_DOMAIN = b"venviewer.reception-capture-runtime-environment.v1\x00"
SERVED_PAGE_MANIFEST_DIGEST_DOMAIN = b"venviewer.reception-served-page-manifest.v1\x00"
CAPTURE_TOOLCHAIN_DIGEST_DOMAIN = b"venviewer.reception-capture-toolchain.v1\x00"
SERVED_PAGE_CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}


class SourceComparisonError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


def fail(code: str, message: str) -> None:
    raise SourceComparisonError(code, message)


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
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


def _read_stable_bytes(path: Path, maximum: int, label: str) -> tuple[bytes, os.stat_result]:
    try:
        before = path.stat()
        if not path.is_file() or before.st_size <= 0 or before.st_size > maximum:
            fail("INVALID_FILE_SIZE", f"{label} must be a non-empty regular file within the size limit")
        payload = path.read_bytes()
        after = path.stat()
    except SourceComparisonError:
        raise
    except OSError as error:
        fail("FILE_NOT_READABLE", f"{label} cannot be read: {error}")
    if len(payload) != before.st_size or before.st_size != after.st_size:
        fail("INPUT_CHANGED_DURING_READ", f"{label} changed size while it was read")
    if before.st_mtime_ns != after.st_mtime_ns:
        fail("INPUT_CHANGED_DURING_READ", f"{label} changed modification time while it was read")
    return payload, before


def _read_json(path: Path, label: str) -> tuple[dict[str, Any], Path]:
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        fail("JSON_NOT_READABLE", f"{label} cannot be resolved: {error}")
    payload, _ = _read_stable_bytes(resolved, MAX_JSON_BYTES, label)
    try:
        parsed = json.loads(payload.decode("utf-8"), object_pairs_hook=_unique_object)
    except SourceComparisonError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail("INVALID_JSON", f"{label} is not strict UTF-8 JSON: {error}")
    if not isinstance(parsed, dict):
        fail("INVALID_JSON", f"{label} root must be an object")
    return parsed, resolved


def _exact_object(value: Any, keys: set[str], code: str, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(code, f"{label} must be an object")
    actual = set(value)
    if actual != keys:
        fail(
            code,
            f"{label} keys differ; missing={sorted(keys - actual)}, unexpected={sorted(actual - keys)}",
        )
    return value


def _safe_id(value: Any, label: str) -> str:
    if not isinstance(value, str) or SAFE_ID.fullmatch(value) is None:
        fail("INVALID_ID", f"{label} must be a lower-case safe identifier")
    return value


def _sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or HEX_SHA256.fullmatch(value) is None:
        fail("INVALID_SHA256", f"{label} must be a lower-case SHA-256")
    return value


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail("INVALID_NUMBER", f"{label} must be a finite number")
    converted = float(value)
    if not math.isfinite(converted):
        fail("INVALID_NUMBER", f"{label} must be finite")
    return converted


def _positive_integer(value: Any, maximum: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > maximum:
        fail("INVALID_INTEGER", f"{label} must be an integer from 1 through {maximum}")
    return value


def _path_is_inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _resolve_bundle_path(raw: Any, parent: Path, label: str) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        fail("INVALID_FILE_REFERENCE", f"{label}.path must be a non-empty relative path")
    supplied = Path(raw)
    if supplied.is_absolute() or ".." in supplied.parts:
        fail("PATH_ESCAPE", f"{label}.path must stay inside the comparison bundle")
    try:
        root = parent.resolve(strict=True)
        resolved = (root / supplied).resolve(strict=True)
    except (OSError, RuntimeError) as error:
        fail("FILE_NOT_READABLE", f"{label} cannot be resolved: {error}")
    if not _path_is_inside(root, resolved):
        fail("PATH_ESCAPE", f"{label}.path escapes the comparison bundle")
    return resolved


def _reject_link_or_hardlink(path: Path, parent: Path, label: str) -> None:
    current = parent.resolve(strict=True)
    relative = path.relative_to(current)
    for part in relative.parts:
        current = current / part
        try:
            if current.is_symlink():
                fail("LINKED_INPUT_FORBIDDEN", f"{label} uses a symbolic link")
        except OSError as error:
            fail("FILE_NOT_READABLE", f"{label} link status cannot be checked: {error}")
    try:
        links = path.stat().st_nlink
    except OSError as error:
        fail("FILE_NOT_READABLE", f"{label} link count cannot be checked: {error}")
    if links != 1:
        fail("LINKED_INPUT_FORBIDDEN", f"{label} must have exactly one filesystem link")


def _file_evidence(value: Any, parent: Path, label: str, maximum: int) -> dict[str, Any]:
    raw = _exact_object(value, {"path", "sha256"}, "INVALID_FILE_REFERENCE", label)
    expected = _sha256(raw["sha256"], f"{label}.sha256")
    resolved = _resolve_bundle_path(raw["path"], parent, label)
    _reject_link_or_hardlink(resolved, parent, label)
    payload, stat = _read_stable_bytes(resolved, maximum, label)
    observed = _sha256_bytes(payload)
    if observed != expected:
        fail("FILE_HASH_MISMATCH", f"{label} expected {expected}, observed {observed}")
    return {
        "relativePath": str(Path(raw["path"]).as_posix()),
        "resolvedPath": str(resolved),
        "sha256": observed,
        "sizeBytes": len(payload),
        "mtimeNanoseconds": stat.st_mtime_ns,
    }


def _identity_file_evidence(value: Any, parent: Path, label: str, maximum: int) -> dict[str, Any]:
    raw = _exact_object(
        value, {"path", "sizeBytes", "sha256"}, "INVALID_IDENTITY_FILE_REFERENCE", label
    )
    expected_size = _positive_integer(raw["sizeBytes"], maximum, f"{label}.sizeBytes")
    expected_hash = _sha256(raw["sha256"], f"{label}.sha256")
    resolved = _resolve_bundle_path(raw["path"], parent, label)
    _reject_link_or_hardlink(resolved, parent, label)
    payload, stat = _read_stable_bytes(resolved, maximum, label)
    if len(payload) != expected_size:
        fail(
            "FILE_SIZE_MISMATCH",
            f"{label} expected {expected_size} bytes, observed {len(payload)}",
        )
    observed_hash = _sha256_bytes(payload)
    if observed_hash != expected_hash:
        fail("FILE_HASH_MISMATCH", f"{label} expected {expected_hash}, observed {observed_hash}")
    return {
        "relativePath": str(Path(raw["path"]).as_posix()),
        "resolvedPath": str(resolved),
        "sha256": observed_hash,
        "sizeBytes": len(payload),
        "mtimeNanoseconds": stat.st_mtime_ns,
    }


def _decode_png(evidence: dict[str, Any], label: str, mode: str) -> np.ndarray:
    path = Path(evidence["resolvedPath"])
    payload, _ = _read_stable_bytes(path, MAX_IMAGE_BYTES, label)
    if _sha256_bytes(payload) != evidence["sha256"]:
        fail("INPUT_CHANGED", f"{label} bytes changed after the protocol was frozen")
    try:
        with Image.open(BytesIO(payload)) as opened:
            opened.verify()
        with Image.open(BytesIO(payload)) as opened:
            if opened.format != "PNG" or getattr(opened, "is_animated", False):
                fail("LOSSLESS_PNG_REQUIRED", f"{label} must be one static PNG")
            if opened.mode != mode:
                fail("UNSUPPORTED_IMAGE_MODE", f"{label} must use PNG mode {mode}, observed {opened.mode}")
            _validate_png_colour_metadata(opened.info, label, mode)
            array = np.asarray(opened, dtype=np.uint8).copy()
    except SourceComparisonError:
        raise
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        fail("INVALID_IMAGE", f"{label} cannot be decoded: {error}")
    return array


def _validate_png_colour_metadata(info: dict[str, Any], label: str, mode: str) -> None:
    if mode != "RGB":
        return
    if info.get("icc_profile") is not None:
        fail("EMBEDDED_COLOUR_PROFILE_UNSUPPORTED", f"{label} contains an ICC profile; v1 accepts canonical sRGB bytes only")
    gamma = info.get("gamma")
    if gamma is not None and not math.isclose(float(gamma), 0.45455, abs_tol=0.00005):
        fail("NON_SRGB_PNG_METADATA", f"{label} declares a non-sRGB transfer gamma")
    chromaticity = info.get("chromaticity")
    standard = (0.3127, 0.3290, 0.6400, 0.3300, 0.3000, 0.6000, 0.1500, 0.0600)
    if chromaticity is not None and not np.allclose(chromaticity, standard, atol=0.0001, rtol=0.0):
        fail("NON_SRGB_PNG_METADATA", f"{label} declares non-sRGB chromaticities")


def _image_evidence(
    value: Any, parent: Path, label: str, width: int, height: int
) -> tuple[dict[str, Any], np.ndarray]:
    evidence = _file_evidence(value, parent, label, MAX_IMAGE_BYTES)
    array = _decode_png(evidence, label, "RGB")
    if array.shape != (height, width, 3):
        fail("IMAGE_DIMENSION_MISMATCH", f"{label} must be exactly {width}x{height} RGB")
    evidence["width"] = width
    evidence["height"] = height
    evidence["mode"] = "RGB"
    evidence["format"] = "PNG"
    return evidence, array


def _mask_evidence(
    value: Any, parent: Path, label: str, width: int, height: int
) -> tuple[dict[str, Any], np.ndarray]:
    evidence = _file_evidence(value, parent, label, MAX_IMAGE_BYTES)
    array = _decode_png(evidence, label, "L")
    if array.shape != (height, width):
        fail("MASK_DIMENSION_MISMATCH", f"{label} must be exactly {width}x{height}")
    values = set(int(item) for item in np.unique(array))
    if not values.issubset({0, 255}) or 255 not in values:
        fail("NONBINARY_MASK", f"{label} must contain only 0 and 255 and select pixels")
    selected = int(np.count_nonzero(array))
    fraction = selected / float(width * height)
    if selected < MIN_MASK_PIXELS or fraction < MIN_MASK_FRACTION or fraction > MAX_MASK_FRACTION:
        fail("INVALID_MASK_COVERAGE", f"{label} selected fraction {fraction:.6f} is outside the safe range")
    evidence.update({"width": width, "height": height, "selectedPixels": selected, "selectedFraction": fraction})
    return evidence, array == 255


def _numeric_vector(value: Any, length: int, label: str) -> list[float]:
    if not isinstance(value, list) or len(value) != length:
        fail("INVALID_CAMERA", f"{label} must contain exactly {length} numbers")
    return [_finite_number(item, f"{label}[{index}]") for index, item in enumerate(value)]


def _validate_camera_matrix(matrix: list[float], label: str) -> None:
    values = np.asarray(matrix, dtype=np.float64).reshape(4, 4)
    if not np.allclose(values[3], np.array([0.0, 0.0, 0.0, 1.0]), atol=1e-9, rtol=0.0):
        fail("UNSUPPORTED_CAMERA", f"{label} must be an affine camera-to-world matrix")
    rotation = values[:3, :3]
    if not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-7, rtol=0.0):
        fail("UNSUPPORTED_CAMERA", f"{label} rotation must be orthonormal")
    if not math.isclose(float(np.linalg.det(rotation)), 1.0, abs_tol=1e-7):
        fail("UNSUPPORTED_CAMERA", f"{label} rotation must be proper and non-mirrored")


def _camera_binding_digest(camera: dict[str, Any]) -> str:
    keys = (
        "projectionModel", "imageWidth", "imageHeight", "fxPixels", "fyPixels",
        "cxPixels", "cyPixels", "skewPixels", "coordinateFrame", "cameraToWorld",
        "worldToCamera", "projectionMatrix", "positionMetres", "targetMetres", "up",
        "verticalFovDegrees", "nearMetres", "farMetres", "viewport", "crop",
    )
    return _sha256_bytes(_canonical_json_bytes({key: camera[key] for key in keys}))


def _camera_validation_receipt(
    evidence: dict[str, Any], camera: dict[str, Any], view_id: str, heldout: bool, label: str
) -> dict[str, Any]:
    raw, _ = _read_json(Path(evidence["resolvedPath"]), label)
    keys = {
        "schemaVersion", "viewId", "cameraBindingDigest", "method", "controlSource",
        "fitControlCount", "blindControlCount", "medianReprojectionErrorPixels",
        "p95ReprojectionErrorPixels", "maximumReprojectionErrorPixels",
        "candidateDataUsed", "targetAssistance",
    }
    receipt = _exact_object(raw, keys, "INVALID_CAMERA_VALIDATION_KEYS", label)
    if receipt["schemaVersion"] != CAMERA_VALIDATION_SCHEMA_VERSION or receipt["viewId"] != view_id:
        fail("CAMERA_VALIDATION_HEADER_MISMATCH", f"{label} header is invalid")
    if receipt["cameraBindingDigest"] != _camera_binding_digest(camera):
        fail("CAMERA_VALIDATION_BINDING_MISMATCH", f"{label} does not bind the frozen camera")
    return _validated_camera_residuals(receipt, heldout, label)


def _validated_camera_residuals(value: dict[str, Any], heldout: bool, label: str) -> dict[str, Any]:
    if not heldout:
        if value["method"] not in {"declared_unverified", "independent_natural_feature_reprojection"}:
            fail("INVALID_CAMERA_VALIDATION", f"{label}.method is unsupported")
        if value["method"] == "declared_unverified":
            expected = {
                "controlSource": "unknown", "fitControlCount": 0, "blindControlCount": 0,
                "medianReprojectionErrorPixels": None, "p95ReprojectionErrorPixels": None,
                "maximumReprojectionErrorPixels": None, "candidateDataUsed": "unknown",
                "targetAssistance": "unknown",
            }
            if any(value[key] != expected[key] for key in expected):
                fail("INVALID_CAMERA_VALIDATION", f"{label} unverified declaration contains unsupported evidence claims")
            return value
        _validated_camera_residuals(value, True, label)
        return value
    if value["method"] != "independent_natural_feature_reprojection" or value["controlSource"] != "captured_static_architecture":
        fail("HELDOUT_CAMERA_VALIDATION_REQUIRED", f"{label} needs independent natural-feature reprojection")
    if value["candidateDataUsed"] is not False or value["targetAssistance"] != "excluded":
        fail("HELDOUT_CAMERA_VALIDATION_NOT_NEUTRAL", f"{label} used candidate data or target assistance")
    fit = _positive_integer(value["fitControlCount"], 100_000, f"{label}.fitControlCount")
    blind = _positive_integer(value["blindControlCount"], 100_000, f"{label}.blindControlCount")
    median = _finite_number(value["medianReprojectionErrorPixels"], f"{label}.medianReprojectionErrorPixels")
    p95 = _finite_number(value["p95ReprojectionErrorPixels"], f"{label}.p95ReprojectionErrorPixels")
    maximum = _finite_number(value["maximumReprojectionErrorPixels"], f"{label}.maximumReprojectionErrorPixels")
    if fit < MIN_HELDOUT_FIT_CONTROLS or blind < MIN_HELDOUT_BLIND_CONTROLS:
        fail("HELDOUT_CAMERA_CONTROL_COVERAGE_INCOMPLETE", f"{label} has too few fit or blind controls")
    if not (0 <= median <= p95 <= maximum) or median > MAX_HELDOUT_MEDIAN_REPROJECTION_PIXELS or p95 > MAX_HELDOUT_P95_REPROJECTION_PIXELS or maximum > MAX_HELDOUT_REPROJECTION_PIXELS:
        fail("HELDOUT_CAMERA_REPROJECTION_TOO_HIGH", f"{label} exceeds frozen reprojection limits")
    return {**value, "fitControlCount": fit, "blindControlCount": blind, "medianReprojectionErrorPixels": median, "p95ReprojectionErrorPixels": p95, "maximumReprojectionErrorPixels": maximum}


def _validate_camera(value: Any, parent: Path, label: str, view_id: str, heldout: bool) -> dict[str, Any]:
    keys = {
        "projectionModel", "imageWidth", "imageHeight", "fxPixels", "fyPixels",
        "cxPixels", "cyPixels", "skewPixels", "pixelCenterConvention", "distortionModel",
        "distortionCoefficients", "coordinateFrame", "poseConvention", "handedness",
        "worldAxes", "cameraToWorld", "worldToCamera", "projectionMatrix",
        "positionMetres", "targetMetres", "up", "verticalFovDegrees", "nearMetres",
        "farMetres", "units", "viewport", "crop", "orientation",
        "cropResizeHistory", "rectificationReceipt", "cameraValidation",
    }
    raw = _exact_object(value, keys, "INVALID_CAMERA_KEYS", label)
    width = _positive_integer(raw["imageWidth"], MAX_IMAGE_DIMENSION, f"{label}.imageWidth")
    height = _positive_integer(raw["imageHeight"], MAX_IMAGE_DIMENSION, f"{label}.imageHeight")
    if min(width, height) < MIN_IMAGE_DIMENSION or width * height > MAX_IMAGE_PIXELS:
        fail("UNSUPPORTED_CAMERA", f"{label} dimensions are outside the supported range")
    if width % max(SCALE_FACTORS) or height % max(SCALE_FACTORS):
        fail("UNSUPPORTED_CAMERA", f"{label} dimensions must be divisible by {max(SCALE_FACTORS)}")
    camera = _validated_camera_fields(raw, parent, label, width, height)
    _validate_camera_matrix(camera["cameraToWorld"], f"{label}.cameraToWorld")
    _validate_full_camera_consistency(camera, label)
    validation_ref = _file_evidence(
        raw["cameraValidation"], parent, f"{label}.cameraValidation", MAX_JSON_BYTES
    )
    validation = _camera_validation_receipt(
        validation_ref, camera, view_id, heldout, f"{label}.cameraValidation"
    )
    return {**camera, "cameraValidation": {**validation_ref, "data": validation}}


def _validated_camera_fields(
    raw: dict[str, Any], parent: Path, label: str, width: int, height: int
) -> dict[str, Any]:
    fixed = _validated_fixed_camera_fields(raw, label)
    frame = _safe_id(raw["coordinateFrame"], f"{label}.coordinateFrame")
    intrinsics = _validated_camera_intrinsics(raw, label, width, height)
    return {
        **fixed,
        "imageWidth": width,
        "imageHeight": height,
        **intrinsics,
        "distortionCoefficients": [],
        "coordinateFrame": frame,
        "cameraToWorld": _numeric_vector(raw["cameraToWorld"], 16, f"{label}.cameraToWorld"),
        "worldToCamera": _numeric_vector(raw["worldToCamera"], 16, f"{label}.worldToCamera"),
        "projectionMatrix": _numeric_vector(raw["projectionMatrix"], 16, f"{label}.projectionMatrix"),
        "positionMetres": _numeric_vector(raw["positionMetres"], 3, f"{label}.positionMetres"),
        "targetMetres": _numeric_vector(raw["targetMetres"], 3, f"{label}.targetMetres"),
        "up": _numeric_vector(raw["up"], 3, f"{label}.up"),
        "verticalFovDegrees": _finite_number(raw["verticalFovDegrees"], f"{label}.verticalFovDegrees"),
        "nearMetres": _finite_number(raw["nearMetres"], f"{label}.nearMetres"),
        "farMetres": _finite_number(raw["farMetres"], f"{label}.farMetres"),
        "units": raw["units"],
        "viewport": _validate_viewport(raw["viewport"], width, height, label),
        "crop": _validate_crop(raw["crop"], width, height, label),
        "orientation": raw["orientation"],
        "rectificationReceipt": _file_evidence(
            raw["rectificationReceipt"], parent, f"{label}.rectificationReceipt", MAX_JSON_BYTES
        ),
    }


def _validated_fixed_camera_fields(raw: dict[str, Any], label: str) -> dict[str, str]:
    fixed = {
        "projectionModel": "rectified_pinhole",
        "pixelCenterConvention": "pixel_centres_at_half_integers",
        "distortionModel": "none_after_rectification",
        "poseConvention": "camera_to_world_row_major",
        "handedness": "right",
        "worldAxes": "x_right_y_up_z_back",
        "cropResizeHistory": "none_after_rectification",
    }
    for key, expected in fixed.items():
        if raw[key] != expected:
            fail("UNSUPPORTED_CAMERA", f"{label}.{key} must be {expected!r}")
    if raw["distortionCoefficients"] != []:
        fail("UNSUPPORTED_CAMERA", f"{label} must already have zero distortion")
    return fixed


def _validated_camera_intrinsics(
    raw: dict[str, Any], label: str, width: int, height: int
) -> dict[str, float]:
    fx = _finite_number(raw["fxPixels"], f"{label}.fxPixels")
    fy = _finite_number(raw["fyPixels"], f"{label}.fyPixels")
    cx = _finite_number(raw["cxPixels"], f"{label}.cxPixels")
    cy = _finite_number(raw["cyPixels"], f"{label}.cyPixels")
    skew = _finite_number(raw["skewPixels"], f"{label}.skewPixels")
    if fx <= 0 or fy <= 0 or skew != 0.0 or not (0 <= cx < width) or not (0 <= cy < height):
        fail("UNSUPPORTED_CAMERA", f"{label} focal lengths and principal point are invalid")
    return {
        "fxPixels": fx,
        "fyPixels": fy,
        "cxPixels": cx,
        "cyPixels": cy,
        "skewPixels": skew,
    }


def _validate_viewport(value: Any, width: int, height: int, label: str) -> dict[str, Any]:
    raw = _exact_object(value, {"cssWidth", "cssHeight", "devicePixelRatio"}, "INVALID_CAMERA", f"{label}.viewport")
    css_width = _positive_integer(raw["cssWidth"], MAX_IMAGE_DIMENSION, f"{label}.viewport.cssWidth")
    css_height = _positive_integer(raw["cssHeight"], MAX_IMAGE_DIMENSION, f"{label}.viewport.cssHeight")
    dpr = _finite_number(raw["devicePixelRatio"], f"{label}.viewport.devicePixelRatio")
    if dpr <= 0 or not math.isclose(css_width * dpr, width, abs_tol=1e-9) or not math.isclose(css_height * dpr, height, abs_tol=1e-9):
        fail("UNSUPPORTED_CAMERA", f"{label}.viewport CSS size and DPR must produce the exact image dimensions")
    return {"cssWidth": css_width, "cssHeight": css_height, "devicePixelRatio": dpr}


def _validate_crop(value: Any, width: int, height: int, label: str) -> dict[str, int]:
    raw = _exact_object(value, {"xPixels", "yPixels", "widthPixels", "heightPixels"}, "INVALID_CAMERA", f"{label}.crop")
    expected = {"xPixels": 0, "yPixels": 0, "widthPixels": width, "heightPixels": height}
    if raw != expected:
        fail("UNSUPPORTED_CAMERA", f"{label}.crop must preserve the complete rectified image")
    return expected


def _validate_full_camera_consistency(camera: dict[str, Any], label: str) -> None:
    if camera["units"] != "metres" or camera["orientation"] != "pixels_already_upright":
        fail("UNSUPPORTED_CAMERA", f"{label} units and pixel orientation are unsupported")
    camera_to_world = np.asarray(camera["cameraToWorld"], dtype=np.float64).reshape(4, 4)
    world_to_camera = np.asarray(camera["worldToCamera"], dtype=np.float64).reshape(4, 4)
    if not np.allclose(camera_to_world @ world_to_camera, np.eye(4), atol=1e-8, rtol=0.0):
        fail("UNSUPPORTED_CAMERA", f"{label} camera matrices are not inverses")
    expected_position = camera_to_world[:3, 3]
    expected_target = expected_position - camera_to_world[:3, 2]
    expected_up = camera_to_world[:3, 1]
    if not np.allclose(camera["positionMetres"], expected_position, atol=1e-8, rtol=0.0):
        fail("UNSUPPORTED_CAMERA", f"{label} position does not match cameraToWorld")
    if not np.allclose(camera["targetMetres"], expected_target, atol=1e-8, rtol=0.0) or not np.allclose(camera["up"], expected_up, atol=1e-8, rtol=0.0):
        fail("UNSUPPORTED_CAMERA", f"{label} target or up vector does not match cameraToWorld")
    _validate_projection_consistency(camera, label)


def _validate_projection_consistency(camera: dict[str, Any], label: str) -> None:
    near, far = camera["nearMetres"], camera["farMetres"]
    if near <= 0 or far <= near:
        fail("UNSUPPORTED_CAMERA", f"{label} near/far planes are invalid")
    expected_fov = math.degrees(2.0 * math.atan(camera["imageHeight"] / (2.0 * camera["fyPixels"])))
    if not math.isclose(camera["verticalFovDegrees"], expected_fov, abs_tol=1e-8):
        fail("UNSUPPORTED_CAMERA", f"{label} vertical field of view disagrees with fyPixels")
    width, height = camera["imageWidth"], camera["imageHeight"]
    fx, fy, cx, cy = camera["fxPixels"], camera["fyPixels"], camera["cxPixels"], camera["cyPixels"]
    expected = np.array([
        2.0 * fx / width, 0.0, 1.0 - 2.0 * cx / width, 0.0,
        0.0, 2.0 * fy / height, 2.0 * cy / height - 1.0, 0.0,
        0.0, 0.0, -(far + near) / (far - near), -(2.0 * far * near) / (far - near),
        0.0, 0.0, -1.0, 0.0,
    ])
    if not np.allclose(camera["projectionMatrix"], expected, atol=1e-8, rtol=0.0):
        fail("UNSUPPORTED_CAMERA", f"{label} projection matrix disagrees with intrinsics and clip planes")


def _validate_lineage(value: Any, role: str, label: str) -> dict[str, str]:
    raw = _exact_object(value, set(LINEAGE_FIELDS), "INVALID_LINEAGE_KEYS", label)
    result: dict[str, str] = {}
    for key in sorted(LINEAGE_FIELDS):
        if raw[key] not in LINEAGE_STATES:
            fail("INVALID_LINEAGE", f"{label}.{key} must be yes, no, or unknown")
        result[key] = raw[key]
    if role == "heldout_physical" and any(state != "no" for state in result.values()):
        fail("HELDOUT_LINEAGE_NOT_CLEAN", f"{label} contains use or uncertainty")
    return result


def _threshold(value: Any, heldout: bool, label: str) -> float | None:
    if value is None:
        if heldout:
            fail("MISSING_PRACTICAL_THRESHOLD", f"{label} is required for a held-out comparison")
        return None
    number = _finite_number(value, label)
    if number <= 0:
        fail("INVALID_PRACTICAL_THRESHOLD", f"{label} must be greater than zero")
    return number


def _validate_color_transform(value: Any, parent: Path, label: str) -> dict[str, Any] | None:
    if value is None:
        return None
    raw = _exact_object(
        value,
        {"matrix3x3", "offsetLinearRgb", "appliedTo", "derivation", "evidenceReceipt"},
        "INVALID_COLOR_TRANSFORM",
        label,
    )
    if raw["appliedTo"] != "all_candidates_only" or raw["derivation"] != "color_chart":
        fail("INVALID_COLOR_TRANSFORM", f"{label} must be one shared chart-derived candidate transform")
    return {
        "matrix3x3": _numeric_vector(raw["matrix3x3"], 9, f"{label}.matrix3x3"),
        "offsetLinearRgb": _numeric_vector(raw["offsetLinearRgb"], 3, f"{label}.offsetLinearRgb"),
        "appliedTo": "all_candidates_only",
        "derivation": "color_chart",
        "evidenceReceipt": _file_evidence(
            raw["evidenceReceipt"], parent, f"{label}.evidenceReceipt", MAX_JSON_BYTES
        ),
    }


def _validate_human_review(value: Any, parent: Path, heldout: bool) -> dict[str, Any]:
    raw = _exact_object(
        value,
        {"required", "blindCandidateLabels", "planReceipt"},
        "INVALID_HUMAN_REVIEW",
        "comparison.humanReview",
    )
    if raw["required"] is not True or raw["blindCandidateLabels"] is not True:
        fail("INVALID_HUMAN_REVIEW", "human review and blind candidate labels must be required")
    if raw["planReceipt"] is None:
        if heldout:
            fail("HUMAN_REVIEW_PLAN_REQUIRED", "held-out comparison needs a frozen human-review plan")
        receipt = None
    else:
        receipt = _file_evidence(
            raw["planReceipt"], parent, "comparison.humanReview.planReceipt", MAX_JSON_BYTES
        )
    return {"required": True, "blindCandidateLabels": True, "planReceipt": receipt}


def _validate_comparison(value: Any, parent: Path, heldout: bool) -> dict[str, Any]:
    raw = _exact_object(
        value,
        {"metricIds", "minimumPracticalEffect", "sharedColorTransform", "fullFrameIsDiagnosticOnly", "humanReview"},
        "INVALID_COMPARISON_KEYS",
        "comparison",
    )
    if raw["metricIds"] != list(METRIC_IDS):
        fail("METRIC_SET_MISMATCH", f"comparison.metricIds must be {list(METRIC_IDS)!r}")
    thresholds = _exact_object(
        raw["minimumPracticalEffect"], set(METRIC_IDS), "INVALID_THRESHOLD_KEYS", "minimumPracticalEffect"
    )
    if raw["fullFrameIsDiagnosticOnly"] is not True:
        fail("FULL_FRAME_AUTHORITY_FORBIDDEN", "full-frame scores must be diagnostic only")
    return {
        "metricIds": list(METRIC_IDS),
        "minimumPracticalEffect": {
            metric: _threshold(thresholds[metric], heldout, f"minimumPracticalEffect.{metric}")
            for metric in METRIC_IDS
        },
        "sharedColorTransform": _validate_color_transform(
            raw["sharedColorTransform"], parent, "comparison.sharedColorTransform"
        ),
        "fullFrameIsDiagnosticOnly": True,
        "humanReview": _validate_human_review(raw["humanReview"], parent, heldout),
    }


def _validate_rights(value: Any, parent: Path) -> dict[str, Any]:
    raw = _exact_object(
        value,
        {"internalComparisonApproved", "publicationApproved", "trainingApproved", "receipt"},
        "INVALID_RIGHTS_KEYS",
        "rights",
    )
    if raw["internalComparisonApproved"] is not True:
        fail("INTERNAL_COMPARISON_RIGHTS_REQUIRED", "source pixels cannot be decoded without approved internal-comparison rights")
    if raw["publicationApproved"] is not False or raw["trainingApproved"] is not False:
        fail("RIGHTS_SCOPE_TOO_BROAD", "v0 rights must keep publication and training disabled")
    return {
        "internalComparisonApproved": True,
        "publicationApproved": False,
        "trainingApproved": False,
        "receipt": _file_evidence(raw["receipt"], parent, "rights.receipt", MAX_JSON_BYTES),
        "attestationStrength": "hash_bound_not_externally_attested",
    }


def _validate_renderer_binding(value: Any) -> dict[str, str]:
    keys = {
        "digest", "runtimeBuildDigest", "runtimeEnvironmentDigest", "profileDigest",
        "toneMapDigest", "exposureDigest", "colourSpaceDigest",
    }
    raw = _exact_object(value, keys, "INVALID_RENDERER_BINDING_KEYS", "rendererBinding")
    binding = {key: _sha256(raw[key], f"rendererBinding.{key}") for key in sorted(keys)}
    components = {key: binding[key] for key in sorted(keys - {"digest"})}
    expected = _sha256_bytes(RENDERER_BINDING_DIGEST_DOMAIN + _canonical_json_bytes(components))
    if binding["digest"] != expected:
        fail("RENDERER_BINDING_DIGEST_MISMATCH", "rendererBinding.digest must bind every renderer component")
    return binding


def _validate_candidate_bindings(value: Any, candidate_ids: list[str]) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) != len(candidate_ids):
        fail("CANDIDATE_BINDING_COUNT_MISMATCH", "candidateBindings must contain one record per candidate")
    result: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        raw = _exact_object(item, {"candidateId", "assetSetSha256", "profileId", "expectedSplatCount"}, "INVALID_CANDIDATE_BINDING_KEYS", f"candidateBindings[{index}]")
        result.append({
            "candidateId": _safe_id(raw["candidateId"], f"candidateBindings[{index}].candidateId"),
            "assetSetSha256": _sha256(raw["assetSetSha256"], f"candidateBindings[{index}].assetSetSha256"),
            "profileId": _safe_id(raw["profileId"], f"candidateBindings[{index}].profileId"),
            "expectedSplatCount": _positive_integer(raw["expectedSplatCount"], 2_147_483_647, f"candidateBindings[{index}].expectedSplatCount"),
        })
    if {item["candidateId"] for item in result} != set(candidate_ids):
        fail("CANDIDATE_BINDING_ID_MISMATCH", "candidateBindings IDs do not match candidateIds")
    return sorted(result, key=lambda item: item["candidateId"])


def _capture_approval(evidence: dict[str, Any], runner_sha256: str, renderer_digest: str) -> dict[str, Any]:
    raw, _ = _read_json(Path(evidence["resolvedPath"]), "capture adapter approval")
    keys = {
        "schemaVersion", "runnerSha256", "rendererBindingDigest", "independentReview",
        "rendererOwnedTelemetry", "assetBytesBoundToFrame", "cameraStateBoundToFrame",
        "rendererStateBoundToFrame", "roomStateBoundToFrame", "presentedFrameIdBoundToFrame",
        "approvedForHeldoutPhysicalComparison",
    }
    approval = _exact_object(raw, keys, "INVALID_CAPTURE_APPROVAL_KEYS", "capture adapter approval")
    if approval["schemaVersion"] != CAPTURE_ADAPTER_APPROVAL_SCHEMA_VERSION or approval["runnerSha256"] != runner_sha256 or approval["rendererBindingDigest"] != renderer_digest:
        fail("CAPTURE_APPROVAL_BINDING_MISMATCH", "capture adapter approval does not bind this runner and renderer")
    required = keys - {"schemaVersion", "runnerSha256", "rendererBindingDigest"}
    if any(approval[key] is not True for key in required):
        fail("CAPTURE_APPROVAL_INCOMPLETE", "capture adapter approval must affirm every held-out evidence control")
    return approval


def _validate_capture_binding(value: Any, parent: Path, heldout: bool, renderer_digest: str) -> dict[str, Any]:
    raw = _exact_object(value, {"evidenceClass", "runnerImplementation", "independentApprovalReceipt"}, "INVALID_CAPTURE_BINDING_KEYS", "captureBinding")
    evidence_class = raw["evidenceClass"]
    if evidence_class not in {
        "diagnostic_dom_preflight",
        "diagnostic_renderer_owned_telemetry",
        "pinned_renderer_owned_telemetry",
    }:
        fail("INVALID_CAPTURE_EVIDENCE_CLASS", "captureBinding.evidenceClass is unsupported")
    runner = _file_evidence(raw["runnerImplementation"], parent, "captureBinding.runnerImplementation", MAX_IMAGE_BYTES)
    if raw["independentApprovalReceipt"] is None:
        approval = None
    else:
        receipt = _file_evidence(raw["independentApprovalReceipt"], parent, "captureBinding.independentApprovalReceipt", MAX_JSON_BYTES)
        approval = {**receipt, "data": _capture_approval(receipt, runner["sha256"], renderer_digest)}
    if heldout and (evidence_class != "pinned_renderer_owned_telemetry" or approval is None):
        fail("HELDOUT_TRUSTED_CAPTURE_ADAPTER_REQUIRED", "held-out comparison needs an independently approved, renderer-owned capture adapter")
    if heldout and runner["sha256"] not in TRUSTED_HELDOUT_CAPTURE_RUNNER_SHA256:
        fail("HELDOUT_CAPTURE_ADAPTER_NOT_ALLOWLISTED", "v1 has no independently reviewed capture adapter; held-out evidence is deliberately unavailable")
    if not heldout and approval is not None:
        fail("DIAGNOSTIC_CAPTURE_APPROVAL_FORBIDDEN", "diagnostic capture must not carry a trusted-adapter approval")
    return {"evidenceClass": evidence_class, "runnerImplementation": runner, "independentApprovalReceipt": approval}


def _parse_inventory(evidence: dict[str, Any], candidate_id: str, heldout: bool) -> dict[str, Any]:
    raw, _ = _read_json(Path(evidence["resolvedPath"]), f"{candidate_id} dataset inventory")
    keys = {"schemaVersion", "candidateId", "completeness", "usedImageLineage", "coveredUses"}
    inventory = _exact_object(raw, keys, "INVALID_DATASET_INVENTORY_KEYS", f"{candidate_id} dataset inventory")
    if inventory["schemaVersion"] != DATASET_INVENTORY_SCHEMA_VERSION or inventory["candidateId"] != candidate_id:
        fail("DATASET_INVENTORY_HEADER_MISMATCH", f"{candidate_id} dataset inventory header is invalid")
    if inventory["completeness"] not in {"complete", "unknown"}:
        fail("INVALID_DATASET_INVENTORY", f"{candidate_id} completeness must be complete or unknown")
    if heldout and inventory["completeness"] != "complete":
        fail("HELDOUT_INVENTORY_INCOMPLETE", f"{candidate_id} held-out comparison needs a complete dataset inventory")
    records = _inventory_lineage_records(inventory["usedImageLineage"], candidate_id)
    covered = _inventory_covered_uses(inventory["coveredUses"], candidate_id)
    if heldout and covered != list(CANDIDATE_DATA_USES):
        fail("HELDOUT_INVENTORY_USE_COVERAGE_INCOMPLETE", f"{candidate_id} inventory does not cover every candidate-data use")
    used = sorted({use for record in records for use in record["uses"]}, key=CANDIDATE_DATA_USES.index)
    if used != covered or (heldout and not records):
        fail("DATASET_INVENTORY_USE_COVERAGE_INCOMPLETE", f"{candidate_id} lineage records do not support coveredUses")
    return {"candidateId": candidate_id, "completeness": inventory["completeness"], "usedImageLineage": records, "coveredUses": covered, "receipt": evidence}


def _inventory_lineage_records(value: Any, candidate_id: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        fail("INVALID_DATASET_INVENTORY", f"{candidate_id}.usedImageLineage must be an array")
    records: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        label = f"{candidate_id}.usedImageLineage[{index}]"
        raw = _exact_object(item, {"developedImageSha256", "rawSourceSha256", "sourceIdentityId", "uses"}, "INVALID_DATASET_LINEAGE_KEYS", label)
        uses = _inventory_covered_uses(raw["uses"], label)
        if not uses:
            fail("INVALID_DATASET_INVENTORY", f"{label}.uses cannot be empty")
        records.append({
            "developedImageSha256": _sha256(raw["developedImageSha256"], f"{label}.developedImageSha256"),
            "rawSourceSha256": _sha256(raw["rawSourceSha256"], f"{label}.rawSourceSha256"),
            "sourceIdentityId": _safe_id(raw["sourceIdentityId"], f"{label}.sourceIdentityId"),
            "uses": uses,
        })
    developed = [item["developedImageSha256"] for item in records]
    if len(developed) != len(set(developed)):
        fail("DUPLICATE_DATASET_HASH", f"{candidate_id} repeats a developed image hash")
    return sorted(records, key=lambda item: item["developedImageSha256"])


def _inventory_covered_uses(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or len(value) != len(set(value)) or any(item not in CANDIDATE_DATA_USES for item in value):
        fail("INVALID_DATASET_INVENTORY", f"{label} candidate-data uses are invalid")
    return sorted(value, key=CANDIDATE_DATA_USES.index)


def _validate_candidate_inventories(
    value: Any, parent: Path, candidate_ids: list[str], heldout: bool
) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) != len(candidate_ids):
        fail("DATASET_INVENTORY_COUNT_MISMATCH", "candidateInventories must contain one receipt per candidate")
    inventories: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        raw = _exact_object(item, {"candidateId", "receipt"}, "INVALID_DATASET_INVENTORY_REF", f"candidateInventories[{index}]")
        candidate_id = _safe_id(raw["candidateId"], f"candidateInventories[{index}].candidateId")
        evidence = _file_evidence(raw["receipt"], parent, f"candidateInventories[{index}].receipt", MAX_JSON_BYTES)
        inventories.append(_parse_inventory(evidence, candidate_id, heldout))
    if {item["candidateId"] for item in inventories} != set(candidate_ids):
        fail("DATASET_INVENTORY_CANDIDATE_MISMATCH", "candidate inventory IDs do not match candidateIds")
    return sorted(inventories, key=lambda item: item["candidateId"])


def _check_heldout_hash_leakage(views: list[dict[str, Any]], inventories: list[dict[str, Any]], heldout: bool) -> None:
    if not heldout:
        return
    developed_hashes = {
        evidence["sha256"]
        for view in views
        for evidence in [view["reference"]["image"], *view["reference"]["repeatImages"]]
    }
    acquisitions = [item["data"] for view in views for item in view["reference"]["acquisitionReceipts"]]
    raw_hashes = {item["rawSourceSha256"] for item in acquisitions}
    source_ids = {item["sourceIdentityId"] for item in acquisitions}
    for inventory in inventories:
        records = inventory["usedImageLineage"]
        leaks = {
            "developed": sorted(developed_hashes.intersection(item["developedImageSha256"] for item in records)),
            "raw": sorted(raw_hashes.intersection(item["rawSourceSha256"] for item in records)),
            "sourceIdentity": sorted(source_ids.intersection(item["sourceIdentityId"] for item in records)),
        }
        if any(leaks.values()):
            fail("HELDOUT_REFERENCE_LINEAGE_LEAKAGE", f"{inventory['candidateId']} inventory overlaps held-out source lineage: {leaks}")


def _validate_region(
    value: Any, parent: Path, label: str, width: int, height: int, heldout: bool
) -> tuple[dict[str, Any], np.ndarray]:
    keys = {
        "regionId", "kind", "feature", "mask", "sharedFovVerified",
        "roomStateStatus", "targetAssistance", "contentStatus",
    }
    raw = _exact_object(value, keys, "INVALID_REGION_KEYS", label)
    region_id = _safe_id(raw["regionId"], f"{label}.regionId")
    if raw["kind"] not in {"hero", "non_hero"} or raw["feature"] not in REGION_FEATURES:
        fail("INVALID_REGION", f"{label} kind or feature is unsupported")
    if raw["kind"] == "hero" and raw["feature"] not in HERO_FEATURES:
        fail("INVALID_REGION", f"{label} hero region must name a required hero feature")
    safe = (
        raw["sharedFovVerified"] is True
        and raw["roomStateStatus"] == "unchanged"
        and raw["targetAssistance"] == "excluded"
        and raw["contentStatus"] == "static_architecture"
    )
    if not safe:
        fail("UNSAFE_REGION", f"{label} is not a stable, target-free, shared-FOV region")
    mask, pixels = _mask_evidence(raw["mask"], parent, f"{label}.mask", width, height)
    return {
        "regionId": region_id,
        "kind": raw["kind"],
        "feature": raw["feature"],
        "mask": mask,
        "sharedFovVerified": True,
        "roomStateStatus": "unchanged",
        "targetAssistance": "excluded",
        "contentStatus": "static_architecture",
        "decisionEligible": heldout,
    }, pixels


def _acquisition_receipt(
    evidence: dict[str, Any], image: dict[str, Any], heldout: bool,
    view_id: str, camera_binding_digest: str, room_state_digest: str,
    development_recipe_digest: str, label: str
) -> dict[str, Any]:
    raw, _ = _read_json(Path(evidence["resolvedPath"]), label)
    keys = {
        "schemaVersion", "viewId", "cameraBindingDigest", "roomStateDigest",
        "developmentRecipeDigest", "captureId", "captureSessionId", "sourceIdentityId",
        "rawSourceSha256", "developedImageSha256", "deviceIdentityDigest",
        "capturedAtUtc", "acquisitionOrdinal", "physicalAcquisition",
        "generatedPixels", "candidateDataUsed",
    }
    receipt = _exact_object(raw, keys, "INVALID_REFERENCE_ACQUISITION_KEYS", label)
    if receipt["schemaVersion"] != REFERENCE_ACQUISITION_SCHEMA_VERSION:
        fail("REFERENCE_ACQUISITION_HEADER_MISMATCH", f"{label} schema is unsupported")
    bindings = {
        "viewId": view_id, "cameraBindingDigest": camera_binding_digest,
        "roomStateDigest": room_state_digest, "developmentRecipeDigest": development_recipe_digest,
    }
    if any(receipt[key] != expected for key, expected in bindings.items()):
        fail("REFERENCE_ACQUISITION_BINDING_MISMATCH", f"{label} does not bind its frozen view and camera")
    if receipt["developedImageSha256"] != image["sha256"]:
        fail("REFERENCE_ACQUISITION_IMAGE_MISMATCH", f"{label} does not bind its developed PNG")
    normalized = {
        **receipt,
        "captureId": _safe_id(receipt["captureId"], f"{label}.captureId"),
        "captureSessionId": _safe_id(receipt["captureSessionId"], f"{label}.captureSessionId"),
        "sourceIdentityId": _safe_id(receipt["sourceIdentityId"], f"{label}.sourceIdentityId"),
        "rawSourceSha256": _sha256(receipt["rawSourceSha256"], f"{label}.rawSourceSha256"),
        "deviceIdentityDigest": _sha256(receipt["deviceIdentityDigest"], f"{label}.deviceIdentityDigest"),
        "capturedAtUtc": _parse_utc_timestamp(receipt["capturedAtUtc"], f"{label}.capturedAtUtc"),
        "acquisitionOrdinal": _positive_integer(receipt["acquisitionOrdinal"], 3, f"{label}.acquisitionOrdinal"),
    }
    if receipt["physicalAcquisition"] is not True or receipt["generatedPixels"] is not False:
        fail("CAPTURED_REFERENCE_ACQUISITION_REQUIRED", f"{label} must declare a physical, non-generated acquisition")
    if heldout and receipt["candidateDataUsed"] is not False:
        fail("HELDOUT_REFERENCE_ACQUISITION_NOT_INDEPENDENT", f"{label} is not a physical, non-generated, candidate-neutral acquisition")
    return normalized


def _validate_acquisition_set(
    receipts: list[dict[str, Any]], images: list[dict[str, Any]], heldout: bool, label: str
) -> None:
    if len(receipts) != len(images):
        fail("REFERENCE_ACQUISITION_COUNT_MISMATCH", f"{label} needs one receipt per reference image")
    fields = ("captureId", "sourceIdentityId", "rawSourceSha256", "developedImageSha256")
    if heldout and any(len({item[field] for item in receipts}) != len(receipts) for field in fields):
        fail("HELDOUT_REFERENCE_REPEAT_NOT_DISTINCT", f"{label} reuses capture, source, RAW, or developed-image identity")
    if heldout and len({item["captureSessionId"] for item in receipts}) != 1:
        fail("HELDOUT_REFERENCE_SESSION_MISMATCH", f"{label} repeats must share one frozen acquisition session")
    if heldout and len({item["deviceIdentityDigest"] for item in receipts}) != 1:
        fail("HELDOUT_REFERENCE_DEVICE_MISMATCH", f"{label} repeats must use one frozen capture device")
    if heldout and [item["acquisitionOrdinal"] for item in receipts] != [1, 2, 3]:
        fail("HELDOUT_REFERENCE_SEQUENCE_INVALID", f"{label} acquisition ordinals must be 1, 2, 3")
    times = [datetime.fromisoformat(item["capturedAtUtc"].replace("Z", "+00:00")) for item in receipts]
    if heldout and not (times[0] < times[1] < times[2]):
        fail("HELDOUT_REFERENCE_SEQUENCE_INVALID", f"{label} acquisition times must increase")


def _reference_images(
    raw: dict[str, Any], parent: Path, label: str, width: int, height: int, heldout: bool
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not isinstance(raw["repeatImages"], list):
        fail("INVALID_REFERENCE_REPEATS", f"{label}.repeatImages must be an array")
    if heldout and len(raw["repeatImages"]) != 2:
        fail("HELDOUT_REFERENCE_REPEATS_REQUIRED", f"{label} needs exactly two physical repeats")
    if not heldout and len(raw["repeatImages"]) > 2:
        fail("INVALID_REFERENCE_REPEATS", f"{label} permits at most two optional repeats")
    image, _ = _image_evidence(raw["image"], parent, f"{label}.image", width, height)
    repeats = [
        _image_evidence(item, parent, f"{label}.repeatImages[{index}]", width, height)[0]
        for index, item in enumerate(raw["repeatImages"])
    ]
    return image, repeats


def _reference_acquisitions(
    raw: dict[str, Any], parent: Path, label: str, images: list[dict[str, Any]],
    heldout: bool, view_id: str, camera_digest: str, room_state_digest: str
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    if not isinstance(raw["acquisitionReceipts"], list):
        fail("INVALID_REFERENCE_ACQUISITIONS", f"{label}.acquisitionReceipts must be an array")
    if len(raw["acquisitionReceipts"]) != len(images):
        fail("REFERENCE_ACQUISITION_COUNT_MISMATCH", f"{label} needs one acquisition receipt per reference image")
    development = _file_evidence(
        raw["developmentRecipeReceipt"], parent, f"{label}.developmentRecipeReceipt", MAX_JSON_BYTES
    )
    receipt_evidence = [
        _file_evidence(item, parent, f"{label}.acquisitionReceipts[{index}]", MAX_JSON_BYTES)
        for index, item in enumerate(raw["acquisitionReceipts"])
    ]
    acquisitions = [
        _acquisition_receipt(
            item, images[index], heldout, view_id, camera_digest,
            room_state_digest, development["sha256"],
            f"{label}.acquisitionReceipts[{index}]"
        )
        for index, item in enumerate(receipt_evidence)
    ]
    _validate_acquisition_set(acquisitions, images, heldout, label)
    return development, receipt_evidence, acquisitions


def _validate_reference(
    value: Any, parent: Path, label: str, width: int, height: int, heldout: bool,
    view_id: str, camera_binding_digest: str, room_state_digest: str
) -> dict[str, Any]:
    keys = {
        "image", "repeatImages", "role", "lineage", "generatedPixels",
        "candidateDerived", "acquisitionReceipts", "developmentRecipeReceipt",
    }
    raw = _exact_object(value, keys, "INVALID_REFERENCE_KEYS", label)
    if raw["generatedPixels"] is not False or raw["candidateDerived"] is not False:
        fail("CAPTURED_REFERENCE_REQUIRED", f"{label} must be captured, non-generated, and independent of candidate output")
    if raw["role"] not in REFERENCE_ROLES:
        fail("INVALID_REFERENCE_ROLE", f"{label}.role is unsupported")
    if heldout and raw["role"] != "heldout_physical":
        fail("HELDOUT_REFERENCE_ROLE_REQUIRED", f"{label}.role must be heldout_physical")
    image, repeats = _reference_images(raw, parent, label, width, height, heldout)
    development, receipt_evidence, acquisitions = _reference_acquisitions(
        raw, parent, label, [image, *repeats], heldout, view_id,
        camera_binding_digest, room_state_digest
    )
    return {
        "image": image,
        "repeatImages": repeats,
        "role": raw["role"],
        "lineage": _validate_lineage(raw["lineage"], raw["role"], f"{label}.lineage"),
        "generatedPixels": False,
        "candidateDerived": False,
        "acquisitionReceipts": [
            {**evidence, "data": data}
            for evidence, data in zip(receipt_evidence, acquisitions, strict=True)
        ],
        "developmentRecipeReceipt": development,
    }


def _validate_view(value: Any, parent: Path, index: int, heldout: bool) -> dict[str, Any]:
    label = f"views[{index}]"
    raw = _exact_object(
        value, {"viewId", "roomStateDigest", "camera", "reference", "regions"}, "INVALID_VIEW_KEYS", label
    )
    view_id = _safe_id(raw["viewId"], f"{label}.viewId")
    room_state = _sha256(raw["roomStateDigest"], f"{label}.roomStateDigest")
    camera = _validate_camera(raw["camera"], parent, f"{label}.camera", view_id, heldout)
    width, height = camera["imageWidth"], camera["imageHeight"]
    reference = _validate_reference(
        raw["reference"], parent, f"{label}.reference", width, height, heldout,
        view_id, _camera_binding_digest(camera), room_state
    )
    if not isinstance(raw["regions"], list) or not raw["regions"]:
        fail("REGIONS_REQUIRED", f"{label}.regions must contain at least one frozen mask")
    regions: list[dict[str, Any]] = []
    masks: list[np.ndarray] = []
    for region_index, item in enumerate(raw["regions"]):
        region, mask = _validate_region(
            item, parent, f"{label}.regions[{region_index}]", width, height, heldout
        )
        regions.append(region)
        masks.append(mask)
    _validate_region_set(regions, masks, label)
    camera_digest = _sha256_bytes(_canonical_json_bytes(camera))
    return {
        "viewId": view_id,
        "roomStateDigest": room_state,
        "camera": camera,
        "cameraDigest": camera_digest,
        "reference": reference,
        "regions": regions,
    }


def _validate_region_set(regions: list[dict[str, Any]], masks: list[np.ndarray], label: str) -> None:
    ids = [region["regionId"] for region in regions]
    if len(ids) != len(set(ids)):
        fail("DUPLICATE_REGION_ID", f"{label} repeats a regionId")
    occupied = np.zeros_like(masks[0], dtype=bool)
    for index, mask in enumerate(masks):
        if np.any(occupied & mask):
            fail("OVERLAPPING_REGION_MASKS", f"{label}.regions[{index}] overlaps an earlier mask")
        occupied |= mask


def _validate_view_coverage(views: list[dict[str, Any]], heldout: bool) -> None:
    view_ids = [view["viewId"] for view in views]
    if len(view_ids) != len(set(view_ids)):
        fail("DUPLICATE_VIEW_ID", "views repeat a viewId")
    if not heldout:
        return
    if len(views) < 6:
        fail("HELDOUT_VIEW_COVERAGE_INCOMPLETE", "held-out comparison requires at least six camera poses")
    if len({view["roomStateDigest"] for view in views}) != 1:
        fail("HELDOUT_ROOM_STATE_MISMATCH", "held-out comparison requires one unchanged room-state identity")
    if len({view["camera"]["coordinateFrame"] for view in views}) != 1:
        fail("HELDOUT_CAMERA_FRAME_MISMATCH", "held-out camera stations must share one coordinate frame")
    bindings = [_camera_binding_digest(view["camera"]) for view in views]
    if len(bindings) != len(set(bindings)):
        fail("HELDOUT_CAMERA_POSES_NOT_DISTINCT", "held-out comparison repeats a camera binding")
    positions = [np.asarray(view["camera"]["positionMetres"], dtype=np.float64) for view in views]
    if any(float(np.linalg.norm(first - second)) < MIN_HELDOUT_CAMERA_SEPARATION_METRES for index, first in enumerate(positions) for second in positions[index + 1:]):
        fail("HELDOUT_CAMERA_STATIONS_TOO_CLOSE", f"held-out camera stations must be at least {MIN_HELDOUT_CAMERA_SEPARATION_METRES:.2f} m apart")
    acquisitions = [item["data"] for view in views for item in view["reference"]["acquisitionReceipts"]]
    unique_fields = ("captureId", "sourceIdentityId", "rawSourceSha256", "developedImageSha256")
    if any(len({item[field] for item in acquisitions}) != len(acquisitions) for field in unique_fields):
        fail("HELDOUT_REFERENCE_ACQUISITION_REUSED", "held-out views reuse a capture, source identity, RAW, or developed image")
    regions = [region for view in views for region in view["regions"]]
    heroes = [region for region in regions if region["kind"] == "hero"]
    contexts = [region for region in regions if region["kind"] == "non_hero"]
    features = {region["feature"] for region in heroes}
    if len(heroes) < 5 or len(contexts) < 5 or not HERO_FEATURES.issubset(features):
        fail("HELDOUT_REGION_COVERAGE_INCOMPLETE", "held-out comparison needs five hero features and five non-hero regions")


def _collect_protocol_paths(document: dict[str, Any]) -> list[Path]:
    paths: list[Path] = [Path(document["rights"]["receipt"]["resolvedPath"])]
    paths.append(Path(document["captureBinding"]["runnerImplementation"]["resolvedPath"]))
    approval = document["captureBinding"]["independentApprovalReceipt"]
    if approval is not None:
        paths.append(Path(approval["resolvedPath"]))
    paths.extend(Path(item["receipt"]["resolvedPath"]) for item in document["candidateInventories"])
    comparison = document["comparison"]
    color = comparison["sharedColorTransform"]
    if color is not None:
        paths.append(Path(color["evidenceReceipt"]["resolvedPath"]))
    plan = comparison["humanReview"]["planReceipt"]
    if plan is not None:
        paths.append(Path(plan["resolvedPath"]))
    for view in document["views"]:
        paths.append(Path(view["camera"]["rectificationReceipt"]["resolvedPath"]))
        paths.append(Path(view["camera"]["cameraValidation"]["resolvedPath"]))
        paths.append(Path(view["reference"]["image"]["resolvedPath"]))
        paths.extend(Path(item["resolvedPath"]) for item in view["reference"]["repeatImages"])
        paths.extend(Path(item["resolvedPath"]) for item in view["reference"]["acquisitionReceipts"])
        paths.append(Path(view["reference"]["developmentRecipeReceipt"]["resolvedPath"]))
        paths.extend(Path(region["mask"]["resolvedPath"]) for region in view["regions"])
    return paths


def _require_unique_paths(paths: list[Path], code: str, label: str) -> None:
    canonical = [str(path).casefold() for path in paths]
    if len(canonical) != len(set(canonical)):
        fail(code, f"{label} reuses one filesystem path for multiple evidence roles")


def _tool_evidence() -> dict[str, Any]:
    path = Path(__file__).resolve(strict=True)
    payload, _ = _read_stable_bytes(path, MAX_IMAGE_BYTES, "comparison implementation")
    return {
        "path": str(path),
        "sha256": _sha256_bytes(payload),
        "metricImplementation": (
            "mask-aware multiscale edge Chamfer, gradient orientation, linear-RGB RMSE, "
            "sRGB PSNR, sRGB SSIM, and sRGB MAE v1"
        ),
        "pythonPackages": {
            "numpy": version("numpy"),
            "Pillow": version("Pillow"),
            "scipy": version("scipy"),
        },
    }


def _seal(document: dict[str, Any], field: str, domain: bytes) -> dict[str, Any]:
    sealed = copy.deepcopy(document)
    sealed[field] = _sha256_bytes(domain + _canonical_json_bytes(sealed))
    return sealed


def _verify_seal(document: dict[str, Any], field: str, domain: bytes, code: str) -> None:
    observed = document.get(field)
    if not isinstance(observed, str):
        fail(code, f"{field} is missing")
    payload = copy.deepcopy(document)
    del payload[field]
    expected = _sha256_bytes(domain + _canonical_json_bytes(payload))
    if observed != expected:
        fail(code, f"{field} expected {expected}, observed {observed}")


def _protocol_limitations(purpose: str) -> list[str]:
    limitations = [
        "Hash binding proves byte identity, not who created a receipt or whether its factual statements are true.",
        "The scorer never registers, shifts, rotates, warps, crops, resizes, sharpens, denoises, or individually colour-fits a candidate.",
        "Full-frame scores are diagnostics only; frozen region masks drive any machine directional signal.",
        "A machine directional signal is not physical approval, beauty approval, commercial approval, or runtime-promotion authority.",
        "Movement, novel-view stability, device performance, rights, and human materiality remain separate gates.",
    ]
    if purpose == "source_view_diagnostic":
        limitations.append(
            "A source photograph may have helped build a candidate, so this protocol disables candidate selection even when one candidate scores better."
        )
    return limitations


def _validated_draft(raw: dict[str, Any], parent: Path) -> dict[str, Any]:
    keys = {
        "schemaVersion", "authority", "comparisonId", "roomId", "purpose",
        "candidateIds", "candidateBindings", "rights", "candidateInventories",
        "rendererBinding", "captureBinding", "comparison", "views",
    }
    draft = _exact_object(raw, keys, "INVALID_DRAFT_KEYS", "draft")
    if draft["schemaVersion"] != DRAFT_SCHEMA_VERSION or draft["authority"] != "none":
        fail("DRAFT_HEADER_MISMATCH", "draft schemaVersion and authority must match the v1 authority-none contract")
    if draft["purpose"] not in PURPOSES:
        fail("INVALID_PURPOSE", f"purpose must be one of {sorted(PURPOSES)}")
    heldout = draft["purpose"] == "heldout_physical_comparison"
    candidate_ids = _validate_candidate_ids(draft["candidateIds"])
    candidate_bindings = _validate_candidate_bindings(draft["candidateBindings"], candidate_ids)
    rights = _validate_rights(draft["rights"], parent)
    inventories = _validate_candidate_inventories(
        draft["candidateInventories"], parent, candidate_ids, heldout
    )
    renderer_binding = _validate_renderer_binding(draft["rendererBinding"])
    capture_binding = _validate_capture_binding(
        draft["captureBinding"], parent, heldout, renderer_binding["digest"]
    )
    comparison = _validate_comparison(draft["comparison"], parent, heldout)
    if not isinstance(draft["views"], list) or not draft["views"]:
        fail("VIEWS_REQUIRED", "draft.views must contain at least one camera pose")
    views = [_validate_view(item, parent, index, heldout) for index, item in enumerate(draft["views"])]
    _validate_view_coverage(views, heldout)
    _check_heldout_hash_leakage(views, inventories, heldout)
    document = _protocol_document(
        draft, candidate_ids, candidate_bindings, rights, inventories,
        renderer_binding, capture_binding, comparison, views
    )
    _require_unique_paths(_collect_protocol_paths(document), "DUPLICATE_PROTOCOL_PATH", "protocol")
    return document


def _validate_candidate_ids(value: Any) -> list[str]:
    if not isinstance(value, list) or len(value) != 2:
        fail("CANDIDATE_COUNT_MISMATCH", "candidateIds must contain exactly two candidates")
    candidate_ids = [_safe_id(item, f"candidateIds[{index}]") for index, item in enumerate(value)]
    if len(set(candidate_ids)) != 2:
        fail("DUPLICATE_CANDIDATE_ID", "candidateIds must be unique")
    return candidate_ids


def _protocol_document(
    draft: dict[str, Any],
    candidate_ids: list[str],
    candidate_bindings: list[dict[str, Any]],
    rights: dict[str, Any],
    inventories: list[dict[str, Any]],
    renderer_binding: dict[str, str],
    capture_binding: dict[str, Any],
    comparison: dict[str, Any],
    views: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "schemaVersion": PROTOCOL_SCHEMA_VERSION,
        "status": "frozen_authority_none",
        "authority": "none",
        "comparisonId": _safe_id(draft["comparisonId"], "comparisonId"),
        "roomId": _safe_id(draft["roomId"], "roomId"),
        "purpose": draft["purpose"],
        "candidateIds": candidate_ids,
        "candidateBindings": candidate_bindings,
        "rights": rights,
        "candidateInventories": inventories,
        "rendererBinding": renderer_binding,
        "captureBinding": capture_binding,
        "comparison": comparison,
        "views": views,
        "toolEvidence": _tool_evidence(),
        "permissions": {
            "physicalApproval": False,
            "commercialApproval": False,
            "runtimePromotion": False,
            "publication": False,
            "training": False,
        },
        "limitations": _protocol_limitations(draft["purpose"]),
    }


def _prepare_output(path: Path, protected: set[Path], label: str) -> Path:
    try:
        resolved_parent = path.parent.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        fail("OUTPUT_PARENT_NOT_FOUND", f"{label} parent cannot be resolved: {error}")
    resolved = resolved_parent / path.name
    if resolved in protected:
        fail("OUTPUT_OVERLAPS_INPUT", f"{label} overlaps an input")
    if resolved.exists():
        fail("OUTPUT_EXISTS", f"{label} already exists: {resolved}")
    return resolved


def _write_create_only(path: Path, payload: bytes, protected: set[Path], label: str) -> None:
    resolved = _prepare_output(path, protected, label)
    try:
        with resolved.open("xb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError:
        fail("OUTPUT_EXISTS", f"{label} appeared before it could be written")
    except OSError as error:
        try:
            resolved.unlink(missing_ok=True)
        except OSError:
            pass
        fail("OUTPUT_WRITE_FAILED", f"{label} could not be written: {error}")


def freeze_protocol(draft_path: Path, output_path: Path) -> dict[str, Any]:
    raw, resolved_draft = _read_json(draft_path, "draft")
    document = _validated_draft(raw, resolved_draft.parent)
    sealed = _seal(document, "protocolDigest", PROTOCOL_DIGEST_DOMAIN)
    protected = {resolved_draft, *_collect_protocol_paths(sealed)}
    payload = json.dumps(sealed, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    _write_create_only(output_path, payload.encode("utf-8"), protected, "frozen protocol")
    return sealed


def _evidence_ref(evidence: dict[str, Any]) -> dict[str, str]:
    return {"path": evidence["relativePath"], "sha256": evidence["sha256"]}


def _protocol_bundle_root(protocol: dict[str, Any]) -> Path:
    evidence_items = list(_protocol_evidence_by_path(protocol).values())
    if not evidence_items:
        fail("PROTOCOL_EVIDENCE_MISSING", "frozen protocol contains no evidence files")
    roots: list[Path] = []
    for evidence in evidence_items:
        relative = Path(evidence["relativePath"])
        resolved = Path(evidence["resolvedPath"])
        root = resolved
        for _ in relative.parts:
            root = root.parent
        if (root / relative).resolve(strict=True) != resolved.resolve(strict=True):
            fail("PROTOCOL_EVIDENCE_ROOT_MISMATCH", "frozen evidence path does not match its relative path")
        roots.append(root.resolve(strict=True))
    if len({str(item).casefold() for item in roots}) != 1:
        fail("PROTOCOL_EVIDENCE_ROOT_MISMATCH", "frozen evidence files do not share one bundle root")
    return roots[0]


def _thaw_comparison(comparison: dict[str, Any]) -> dict[str, Any]:
    thawed = copy.deepcopy(comparison)
    color = thawed["sharedColorTransform"]
    if color is not None:
        color["evidenceReceipt"] = _evidence_ref(color["evidenceReceipt"])
    plan = thawed["humanReview"]["planReceipt"]
    if plan is not None:
        thawed["humanReview"]["planReceipt"] = _evidence_ref(plan)
    return thawed


def _thaw_camera(camera: dict[str, Any]) -> dict[str, Any]:
    thawed = copy.deepcopy(camera)
    thawed["rectificationReceipt"] = _evidence_ref(camera["rectificationReceipt"])
    thawed["cameraValidation"] = _evidence_ref(camera["cameraValidation"])
    return thawed


def _thaw_reference(reference: dict[str, Any]) -> dict[str, Any]:
    return {
        "image": _evidence_ref(reference["image"]),
        "repeatImages": [_evidence_ref(item) for item in reference["repeatImages"]],
        "role": reference["role"],
        "lineage": copy.deepcopy(reference["lineage"]),
        "generatedPixels": reference["generatedPixels"],
        "candidateDerived": reference["candidateDerived"],
        "acquisitionReceipts": [_evidence_ref(item) for item in reference["acquisitionReceipts"]],
        "developmentRecipeReceipt": _evidence_ref(reference["developmentRecipeReceipt"]),
    }


def _thaw_view(view: dict[str, Any]) -> dict[str, Any]:
    return {
        "viewId": view["viewId"],
        "roomStateDigest": view["roomStateDigest"],
        "camera": _thaw_camera(view["camera"]),
        "reference": _thaw_reference(view["reference"]),
        "regions": [
            {**{key: value for key, value in region.items() if key not in {"mask", "decisionEligible"}}, "mask": _evidence_ref(region["mask"])}
            for region in view["regions"]
        ],
    }


def _protocol_as_draft(protocol: dict[str, Any]) -> dict[str, Any]:
    capture = protocol["captureBinding"]
    return {
        "schemaVersion": DRAFT_SCHEMA_VERSION,
        "authority": "none",
        "comparisonId": protocol["comparisonId"],
        "roomId": protocol["roomId"],
        "purpose": protocol["purpose"],
        "candidateIds": copy.deepcopy(protocol["candidateIds"]),
        "candidateBindings": copy.deepcopy(protocol["candidateBindings"]),
        "rights": {
            "internalComparisonApproved": protocol["rights"]["internalComparisonApproved"],
            "publicationApproved": protocol["rights"]["publicationApproved"],
            "trainingApproved": protocol["rights"]["trainingApproved"],
            "receipt": _evidence_ref(protocol["rights"]["receipt"]),
        },
        "candidateInventories": [
            {"candidateId": item["candidateId"], "receipt": _evidence_ref(item["receipt"])}
            for item in protocol["candidateInventories"]
        ],
        "rendererBinding": copy.deepcopy(protocol["rendererBinding"]),
        "captureBinding": {
            "evidenceClass": capture["evidenceClass"],
            "runnerImplementation": _evidence_ref(capture["runnerImplementation"]),
            "independentApprovalReceipt": _evidence_ref(capture["independentApprovalReceipt"]) if capture["independentApprovalReceipt"] is not None else None,
        },
        "comparison": _thaw_comparison(protocol["comparison"]),
        "views": [_thaw_view(view) for view in protocol["views"]],
    }


def _revalidate_frozen_protocol(protocol: dict[str, Any]) -> None:
    keys = {
        "schemaVersion", "status", "authority", "comparisonId", "roomId", "purpose",
        "candidateIds", "candidateBindings", "rights", "candidateInventories",
        "rendererBinding", "captureBinding", "comparison", "views", "toolEvidence",
        "permissions", "limitations", "protocolDigest",
    }
    _exact_object(protocol, keys, "INVALID_PROTOCOL_KEYS", "frozen protocol")
    rebuilt = _validated_draft(_protocol_as_draft(protocol), _protocol_bundle_root(protocol))
    observed = copy.deepcopy(protocol)
    del observed["protocolDigest"]
    if _canonical_json_bytes(observed) != _canonical_json_bytes(rebuilt):
        fail("PROTOCOL_SEMANTIC_MISMATCH", "frozen protocol no longer matches a fully validated draft")


def verify_protocol_file(protocol_path: Path) -> dict[str, Any]:
    protocol, _ = _read_json(protocol_path, "frozen protocol")
    if protocol.get("schemaVersion") != PROTOCOL_SCHEMA_VERSION:
        fail("PROTOCOL_SCHEMA_MISMATCH", "frozen protocol schema is unsupported")
    _verify_seal(protocol, "protocolDigest", PROTOCOL_DIGEST_DOMAIN, "PROTOCOL_DIGEST_MISMATCH")
    _revalidate_frozen_protocol(protocol)
    return protocol


def _verify_protocol_inputs(protocol: dict[str, Any]) -> None:
    expected_tool = protocol["toolEvidence"]["sha256"]
    if _tool_evidence()["sha256"] != expected_tool:
        fail("TOOL_CHANGED_SINCE_FREEZE", "comparison implementation changed after protocol freeze")
    for path in _collect_protocol_paths(protocol):
        _verify_protocol_path(path, protocol)


def _protocol_evidence_by_path(document: dict[str, Any]) -> dict[Path, dict[str, Any]]:
    result: dict[Path, dict[str, Any]] = {}
    result[Path(document["rights"]["receipt"]["resolvedPath"])] = document["rights"]["receipt"]
    runner = document["captureBinding"]["runnerImplementation"]
    result[Path(runner["resolvedPath"])] = runner
    approval = document["captureBinding"]["independentApprovalReceipt"]
    if approval is not None:
        result[Path(approval["resolvedPath"])] = approval
    for inventory in document["candidateInventories"]:
        result[Path(inventory["receipt"]["resolvedPath"])] = inventory["receipt"]
    comparison = document["comparison"]
    optional = [comparison["humanReview"]["planReceipt"]]
    if comparison["sharedColorTransform"] is not None:
        optional.append(comparison["sharedColorTransform"]["evidenceReceipt"])
    for item in optional:
        if item is not None:
            result[Path(item["resolvedPath"])] = item
    for view in document["views"]:
        items = [
            view["camera"]["rectificationReceipt"],
            view["camera"]["cameraValidation"],
            view["reference"]["image"],
            view["reference"]["developmentRecipeReceipt"],
        ]
        items.extend(view["reference"]["repeatImages"])
        items.extend(view["reference"]["acquisitionReceipts"])
        items.extend(region["mask"] for region in view["regions"])
        for item in items:
            result[Path(item["resolvedPath"])] = item
    return result


def _verify_protocol_path(path: Path, protocol: dict[str, Any]) -> None:
    evidence = _protocol_evidence_by_path(protocol)[path]
    payload, stat = _read_stable_bytes(path, MAX_IMAGE_BYTES, f"frozen input {path.name}")
    if _sha256_bytes(payload) != evidence["sha256"] or len(payload) != evidence["sizeBytes"]:
        fail("FROZEN_INPUT_CHANGED", f"frozen input changed: {path}")
    if stat.st_mtime_ns != evidence["mtimeNanoseconds"]:
        fail("FROZEN_INPUT_CHANGED", f"frozen input modification time changed: {path}")


def _validate_saved_frame_evidence(
    value: Any, protocol: dict[str, Any], candidate: dict[str, Any],
    view: dict[str, Any], presented_frame_id: Any, renderer_frame_digest: Any,
) -> dict[str, Any]:
    keys = {
        "schemaVersion", "protocolDigest", "challengeNonce", "documentSessionId",
        "renderSequence", "presentedFrameId", "candidateId", "viewId",
        "assetSetSha256", "assetReceipts", "profileId", "loadedSourceCount",
        "loadedSplatCount", "rendererBinding", "camera", "renderer",
        "framebufferPixelSha256",
    }
    raw = _exact_object(value, keys, "INVALID_FRAME_EVIDENCE_KEYS", "frameEvidence")
    checks = {
        "schemaVersion": CAPTURE_ADAPTER_SCHEMA_VERSION,
        "protocolDigest": protocol["protocolDigest"],
        "presentedFrameId": presented_frame_id,
        "candidateId": candidate["candidateId"],
        "viewId": view["viewId"],
        "assetSetSha256": candidate["assetSha256"],
        "profileId": candidate["profileId"],
        "loadedSplatCount": candidate["expectedSplatCount"],
        "rendererBinding": protocol["rendererBinding"],
    }
    if any(raw[key] != expected for key, expected in checks.items()):
        fail("FRAME_EVIDENCE_IDENTITY_MISMATCH", "saved frame evidence differs from the frozen run")
    _safe_id(raw["challengeNonce"], "frameEvidence.challengeNonce")
    _safe_id(raw["presentedFrameId"], "frameEvidence.presentedFrameId")
    if not isinstance(raw["documentSessionId"], str) or re.fullmatch(r"[a-f0-9]{32}", raw["documentSessionId"]) is None:
        fail("INVALID_FRAME_SESSION", "frameEvidence.documentSessionId must be 32 lowercase hex characters")
    _positive_integer(raw["renderSequence"], 2_147_483_647, "frameEvidence.renderSequence")
    source_count = _positive_integer(raw["loadedSourceCount"], 1_000, "frameEvidence.loadedSourceCount")
    assets = raw["assetReceipts"]
    if not isinstance(assets, list) or len(assets) != source_count or not all(isinstance(item, dict) for item in assets):
        fail("INVALID_FRAME_ASSETS", "frameEvidence.assetReceipts do not match loadedSourceCount")
    if not isinstance(raw["camera"], dict) or not isinstance(raw["renderer"], dict):
        fail("INVALID_FRAME_STATE", "frameEvidence camera and renderer must be objects")
    _sha256(raw["framebufferPixelSha256"], "frameEvidence.framebufferPixelSha256")
    expected_digest = _sha256_bytes(FRAME_DIGEST_DOMAIN + _canonical_json_bytes(raw))
    if renderer_frame_digest != expected_digest:
        fail("FRAME_EVIDENCE_DIGEST_MISMATCH", "saved frame evidence does not reproduce rendererFrameDigest")
    return raw


def _provenance_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail("INVALID_TEXT", f"{label} must be a non-empty string")
    return value


def _capture_origin(value: Any, label: str) -> str:
    if not isinstance(value, str):
        fail("INVALID_CAPTURE_ORIGIN", f"{label} must be an explicit 127.0.0.1 HTTP port")
    match = re.fullmatch(r"http://127\.0\.0\.1:([0-9]{1,5})", value)
    if match is None:
        fail("INVALID_CAPTURE_ORIGIN", f"{label} must be an explicit 127.0.0.1 HTTP port")
    port = int(match.group(1))
    if port < 1_024 or port > 65_535:
        fail("INVALID_CAPTURE_ORIGIN", f"{label} port must be from 1024 through 65535")
    return f"http://127.0.0.1:{port}"


def _capture_request_path(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.startswith("/") or value.startswith("//"):
        fail("INVALID_CAPTURE_REQUEST_PATH", f"{label} must be an origin-relative path")
    parsed = urlsplit(value)
    decoded_segments = [unquote(segment) for segment in parsed.path.split("/")]
    if (
        parsed.scheme or parsed.netloc or parsed.query or parsed.fragment
        or parsed.path != value or "\\" in value or "\x00" in value
        or any(segment in {".", ".."} for segment in decoded_segments)
    ):
        fail("INVALID_CAPTURE_REQUEST_PATH", f"{label} cannot contain URL or path normalization")
    return value


def _capture_plan_asset(value: Any, candidate_index: int, asset_index: int) -> dict[str, Any]:
    label = f"capturePlan.candidates[{candidate_index}].assets[{asset_index}]"
    raw = _exact_object(
        value, {"requestPath", "localPath", "sha256", "sizeBytes"},
        "INVALID_CAPTURE_PLAN_ASSET_KEYS", label,
    )
    if not isinstance(raw["localPath"], str) or not os.path.isabs(raw["localPath"]):
        fail("INVALID_CAPTURE_LOCAL_PATH", f"{label}.localPath must be an absolute file path")
    return {
        "requestPath": _capture_request_path(raw["requestPath"], f"{label}.requestPath"),
        "localPath": os.path.normpath(raw["localPath"]),
        "sha256": _sha256(raw["sha256"], f"{label}.sha256"),
        "sizeBytes": _positive_integer(raw["sizeBytes"], MAX_CAPTURE_ASSET_BYTES, f"{label}.sizeBytes"),
    }


def _capture_asset_set_digest(assets: list[dict[str, Any]]) -> str:
    identity = [
        {"requestedPath": item["requestPath"], "digest": item["sha256"], "sizeBytes": item["sizeBytes"]}
        for item in sorted(assets, key=lambda item: item["requestPath"])
    ]
    payload = json.dumps(identity, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return _sha256_bytes(payload)


def _capture_plan_candidate(value: Any, index: int) -> dict[str, Any]:
    label = f"capturePlan.candidates[{index}]"
    raw = _exact_object(
        value,
        {"candidateId", "assetSetSha256", "profileId", "expectedSplatCount", "assetOrigin", "assets"},
        "INVALID_CAPTURE_PLAN_CANDIDATE_KEYS", label,
    )
    if not isinstance(raw["assets"], list) or not 1 <= len(raw["assets"]) <= 16:
        fail("INVALID_CAPTURE_PLAN_ASSETS", f"{label}.assets must contain one through sixteen files")
    assets = [_capture_plan_asset(item, index, asset_index) for asset_index, item in enumerate(raw["assets"])]
    request_paths = [item["requestPath"] for item in assets]
    local_paths = [item["localPath"].casefold() for item in assets]
    if len(set(request_paths)) != len(assets) or len(set(local_paths)) != len(assets):
        fail("DUPLICATE_CAPTURE_PLAN_ASSET", f"{label}.assets must use unique request and local paths")
    if sum(item["sizeBytes"] for item in assets) > MAX_CAPTURE_CANDIDATE_BYTES:
        fail("CAPTURE_PLAN_ASSET_LIMIT_EXCEEDED", f"{label}.assets exceed the candidate byte limit")
    asset_set = _sha256(raw["assetSetSha256"], f"{label}.assetSetSha256")
    if _capture_asset_set_digest(assets) != asset_set:
        fail("CAPTURE_PLAN_ASSET_SET_MISMATCH", f"{label}.assetSetSha256 does not bind its assets")
    return {
        "candidateId": _safe_id(raw["candidateId"], f"{label}.candidateId"),
        "assetSetSha256": asset_set,
        "profileId": _safe_id(raw["profileId"], f"{label}.profileId"),
        "expectedSplatCount": _positive_integer(raw["expectedSplatCount"], 2_147_483_647, f"{label}.expectedSplatCount"),
        "assetOrigin": _capture_origin(raw["assetOrigin"], f"{label}.assetOrigin"),
        "assets": assets,
    }


def _capture_runtime_environment_digest(candidates: list[dict[str, Any]]) -> str:
    by_id = {item["candidateId"]: item for item in candidates}
    manifest = {
        "mobileOrigin": by_id["mobile"]["assetOrigin"],
        "qualityOrigin": by_id["quality"]["assetOrigin"],
    }
    return _sha256_bytes(RUNTIME_ENVIRONMENT_DIGEST_DOMAIN + _canonical_json_bytes(manifest))


def _validate_capture_plan(value: Any, protocol: dict[str, Any]) -> dict[str, Any]:
    raw = _exact_object(
        value, {"schemaVersion", "authority", "protocolDigest", "webOrigin", "candidates"},
        "INVALID_CAPTURE_PLAN_KEYS", "capturePlan",
    )
    if raw["schemaVersion"] != CAPTURE_PLAN_SCHEMA_VERSION or raw["authority"] != "none":
        fail("CAPTURE_PLAN_HEADER_MISMATCH", "capturePlan header is invalid")
    if raw["protocolDigest"] != protocol["protocolDigest"]:
        fail("CAPTURE_PLAN_PROTOCOL_MISMATCH", "capturePlan does not bind the frozen protocol")
    if not isinstance(raw["candidates"], list) or len(raw["candidates"]) != 2:
        fail("CAPTURE_PLAN_CANDIDATE_COUNT_MISMATCH", "capturePlan needs exactly two candidates")
    candidates = [_capture_plan_candidate(item, index) for index, item in enumerate(raw["candidates"])]
    if [item["candidateId"] for item in candidates] != protocol["candidateIds"]:
        fail("CAPTURE_PLAN_CANDIDATE_SET_MISMATCH", "capturePlan candidate order differs from the protocol")
    bindings = {item["candidateId"]: item for item in protocol["candidateBindings"]}
    for candidate in candidates:
        expected = bindings[candidate["candidateId"]]
        observed = (candidate["assetSetSha256"], candidate["profileId"], candidate["expectedSplatCount"])
        frozen = (expected["assetSetSha256"], expected["profileId"], expected["expectedSplatCount"])
        if observed != frozen:
            fail("CAPTURE_PLAN_CANDIDATE_BINDING_MISMATCH", "capturePlan candidate differs from the protocol")
    web_origin = _capture_origin(raw["webOrigin"], "capturePlan.webOrigin")
    asset_origins = [item["assetOrigin"] for item in candidates]
    if len(set(asset_origins)) != 2 or web_origin in asset_origins:
        fail("CAPTURE_PLAN_ORIGIN_COLLISION", "capture origins must be unique")
    expected_environment = protocol["rendererBinding"]["runtimeEnvironmentDigest"]
    if _capture_runtime_environment_digest(candidates) != expected_environment:
        fail("CAPTURE_PLAN_RUNTIME_ENVIRONMENT_MISMATCH", "capturePlan origins differ from the frozen runtime environment")
    return {**raw, "webOrigin": web_origin, "candidates": candidates}


def _validate_toolchain_size_block(value: Any, label: str) -> dict[str, Any]:
    raw = _exact_object(value, {"fileCount", "sizeBytes", "treeSha256"}, "INVALID_TOOLCHAIN_KEYS", label)
    return {
        "fileCount": _positive_integer(raw["fileCount"], 10_000_000, f"{label}.fileCount"),
        "sizeBytes": _positive_integer(raw["sizeBytes"], 1_000_000_000_000, f"{label}.sizeBytes"),
        "treeSha256": _sha256(raw["treeSha256"], f"{label}.treeSha256"),
    }


def _validate_capture_toolchain(value: Any) -> dict[str, Any]:
    raw = _exact_object(
        value, {"schemaVersion", "node", "packages", "chromium", "digest"},
        "INVALID_TOOLCHAIN_KEYS", "servedPageManifest.captureToolchain",
    )
    if raw["schemaVersion"] != CAPTURE_TOOLCHAIN_SCHEMA_VERSION:
        fail("CAPTURE_TOOLCHAIN_HEADER_MISMATCH", "capture toolchain schema is unsupported")
    node = _exact_object(
        raw["node"], {"version", "platform", "architecture", "sizeBytes", "sha256"},
        "INVALID_TOOLCHAIN_KEYS", "captureToolchain.node",
    )
    normalized_node = {
        "version": _provenance_text(node["version"], "captureToolchain.node.version"),
        "platform": _provenance_text(node["platform"], "captureToolchain.node.platform"),
        "architecture": _provenance_text(node["architecture"], "captureToolchain.node.architecture"),
        "sizeBytes": _positive_integer(node["sizeBytes"], 1_000_000_000_000, "captureToolchain.node.sizeBytes"),
        "sha256": _sha256(node["sha256"], "captureToolchain.node.sha256"),
    }
    packages = _validate_capture_toolchain_packages(raw["packages"])
    chromium = _validate_toolchain_size_block(raw["chromium"], "captureToolchain.chromium")
    body = {"schemaVersion": raw["schemaVersion"], "node": normalized_node, "packages": packages, "chromium": chromium}
    digest = _sha256(raw["digest"], "captureToolchain.digest")
    if _sha256_bytes(CAPTURE_TOOLCHAIN_DIGEST_DOMAIN + _canonical_json_bytes(body)) != digest:
        fail("CAPTURE_TOOLCHAIN_DIGEST_MISMATCH", "captureToolchain.digest does not bind the toolchain")
    return {**body, "digest": digest}


def _validate_capture_toolchain_packages(value: Any) -> list[dict[str, Any]]:
    names = ["vite", "@vitejs/plugin-react", "@playwright/test", "playwright", "playwright-core"]
    if not isinstance(value, list) or len(value) != len(names):
        fail("INVALID_TOOLCHAIN_PACKAGES", "captureToolchain.packages must list the five capture packages")
    result = []
    for index, item in enumerate(value):
        label = f"captureToolchain.packages[{index}]"
        raw = _exact_object(
            item, {"name", "version", "fileCount", "sizeBytes", "treeSha256"},
            "INVALID_TOOLCHAIN_KEYS", label,
        )
        if raw["name"] != names[index]:
            fail("INVALID_TOOLCHAIN_PACKAGES", "captureToolchain package identities are out of order")
        result.append({
            "name": raw["name"],
            "version": _provenance_text(raw["version"], f"{label}.version"),
            **_validate_toolchain_size_block(
                {key: raw[key] for key in ("fileCount", "sizeBytes", "treeSha256")}, label
            ),
        })
    return result


def _validate_served_page_entry(value: Any, index: int) -> dict[str, Any]:
    label = f"servedPageManifest.entries[{index}]"
    raw = _exact_object(
        value, {"path", "sizeBytes", "sha256", "contentType"},
        "INVALID_SERVED_PAGE_ENTRY_KEYS", label,
    )
    return {
        "path": _capture_request_path(raw["path"], f"{label}.path"),
        "sizeBytes": _positive_integer(raw["sizeBytes"], 1_000_000_000, f"{label}.sizeBytes"),
        "sha256": _sha256(raw["sha256"], f"{label}.sha256"),
        "contentType": _provenance_text(raw["contentType"], f"{label}.contentType"),
    }


def _validate_served_page_manifest(
    value: Any, protocol: dict[str, Any], web_origin: str
) -> dict[str, Any]:
    keys = {
        "schemaVersion", "authority", "webOrigin", "runtimeBuildDigest",
        "runtimeEnvironmentDigest", "rendererBindingDigest", "retainedRoot",
        "captureToolchain", "entries", "digest",
    }
    raw = _exact_object(value, keys, "INVALID_SERVED_PAGE_MANIFEST_KEYS", "servedPageManifest")
    if raw["schemaVersion"] != SERVED_PAGE_MANIFEST_SCHEMA_VERSION or raw["authority"] != "none":
        fail("SERVED_PAGE_MANIFEST_HEADER_MISMATCH", "servedPageManifest header is invalid")
    if raw["retainedRoot"] != "served-page":
        fail("SERVED_PAGE_RETAINED_ROOT_MISMATCH", "servedPageManifest.retainedRoot must be served-page")
    if not isinstance(raw["entries"], list) or not raw["entries"]:
        fail("INVALID_SERVED_PAGE_ENTRIES", "servedPageManifest.entries must be non-empty")
    entries = [_validate_served_page_entry(item, index) for index, item in enumerate(raw["entries"])]
    paths = [item["path"] for item in entries]
    if paths != sorted(paths) or len(paths) != len(set(paths)) or "/index.html" not in paths:
        fail("INVALID_SERVED_PAGE_ENTRIES", "servedPageManifest entries must be sorted, unique, and include /index.html")
    toolchain = _validate_capture_toolchain(raw["captureToolchain"])
    renderer = protocol["rendererBinding"]
    checks = {
        "webOrigin": web_origin,
        "runtimeBuildDigest": renderer["runtimeBuildDigest"],
        "runtimeEnvironmentDigest": renderer["runtimeEnvironmentDigest"],
        "rendererBindingDigest": renderer["digest"],
    }
    if any(raw[key] != expected for key, expected in checks.items()):
        fail("SERVED_PAGE_RENDERER_MISMATCH", "servedPageManifest differs from the run or renderer binding")
    body = {key: raw[key] for key in keys - {"digest", "captureToolchain", "entries"}}
    body.update({"captureToolchain": toolchain, "entries": entries})
    digest = _sha256(raw["digest"], "servedPageManifest.digest")
    if _sha256_bytes(SERVED_PAGE_MANIFEST_DIGEST_DOMAIN + _canonical_json_bytes(body)) != digest:
        fail("SERVED_PAGE_MANIFEST_DIGEST_MISMATCH", "servedPageManifest.digest does not bind its contents")
    return {**body, "digest": digest}


def _enumerate_retained_served_page(root: Path) -> list[Path]:
    try:
        if root.is_symlink() or not root.is_dir():
            fail("INVALID_SERVED_PAGE_ROOT", "served-page must be a real directory")
    except OSError as error:
        fail("INVALID_SERVED_PAGE_ROOT", f"served-page cannot be inspected: {error}")
    files: list[Path] = []
    pending = [root]
    while pending:
        directory = pending.pop()
        try:
            entries = list(os.scandir(directory))
        except OSError as error:
            fail("SERVED_PAGE_NOT_READABLE", f"served-page cannot be enumerated: {error}")
        for entry in entries:
            path = Path(entry.path)
            if entry.is_symlink():
                fail("LINKED_INPUT_FORBIDDEN", f"served-page contains a symbolic link: {path.name}")
            if entry.is_dir(follow_symlinks=False):
                pending.append(path)
            elif entry.is_file(follow_symlinks=False):
                if path.stat().st_nlink != 1:
                    fail("LINKED_INPUT_FORBIDDEN", f"served-page file must have one link: {path.name}")
                files.append(path)
            else:
                fail("INVALID_SERVED_PAGE_ENTRY", f"served-page contains a non-file entry: {path.name}")
    return sorted(files, key=lambda path: path.relative_to(root).as_posix())


def _verify_retained_served_page(
    parent: Path, manifest: dict[str, Any]
) -> list[dict[str, Any]]:
    root = parent / manifest["retainedRoot"]
    files = _enumerate_retained_served_page(root)
    actual_paths = [f"/{path.relative_to(root).as_posix()}" for path in files]
    expected_paths = [entry["path"] for entry in manifest["entries"]]
    if actual_paths != expected_paths:
        fail("SERVED_PAGE_PATH_SET_MISMATCH", "retained served-page files differ from its manifest")
    records = []
    for path, entry in zip(files, manifest["entries"], strict=True):
        payload, stat = _read_stable_bytes(path, MAX_IMAGE_BYTES, f"served page {entry['path']}")
        expected_type = SERVED_PAGE_CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
        if entry["contentType"] != expected_type:
            fail("SERVED_PAGE_CONTENT_TYPE_MISMATCH", f"served page {entry['path']} has the wrong content type")
        if len(payload) != entry["sizeBytes"] or _sha256_bytes(payload) != entry["sha256"]:
            fail("SERVED_PAGE_FILE_MISMATCH", f"served page {entry['path']} differs from its manifest")
        records.append({
            "relativePath": f"{manifest['retainedRoot']}/{path.relative_to(root).as_posix()}",
            "resolvedPath": str(path.resolve(strict=True)),
            "sha256": entry["sha256"],
            "sizeBytes": entry["sizeBytes"],
            "mtimeNanoseconds": stat.st_mtime_ns,
        })
    return records


def _load_capture_provenance(
    run: dict[str, Any], parent: Path, protocol: dict[str, Any]
) -> dict[str, Any]:
    plan_evidence = _identity_file_evidence(run["capturePlan"], parent, "run.capturePlan", MAX_JSON_BYTES)
    plan_raw, _ = _read_json(Path(plan_evidence["resolvedPath"]), "run.capturePlan")
    plan = _validate_capture_plan(plan_raw, protocol)
    web_origin = _capture_origin(run["webOrigin"], "run.webOrigin")
    if plan["webOrigin"] != web_origin:
        fail("RUN_CAPTURE_PLAN_ORIGIN_MISMATCH", "run.webOrigin differs from capturePlan.webOrigin")
    page_evidence = _identity_file_evidence(
        run["servedPageManifest"], parent, "run.servedPageManifest", MAX_JSON_BYTES
    )
    page_raw, _ = _read_json(Path(page_evidence["resolvedPath"]), "run.servedPageManifest")
    page = _validate_served_page_manifest(page_raw, protocol, web_origin)
    served_page_files = _verify_retained_served_page(parent, page)
    page_digest = _sha256(run["servedPageManifestDigest"], "run.servedPageManifestDigest")
    toolchain_digest = _sha256(run["captureToolchainDigest"], "run.captureToolchainDigest")
    if page_digest != page["digest"]:
        fail("RUN_SERVED_PAGE_MANIFEST_MISMATCH", "run does not bind the servedPageManifest digest")
    if toolchain_digest != page["captureToolchain"]["digest"]:
        fail("RUN_CAPTURE_TOOLCHAIN_MISMATCH", "run does not bind the capture toolchain digest")
    return {
        "capturePlan": {**plan_evidence, "data": plan},
        "webOrigin": web_origin,
        "servedPageManifest": {**page_evidence, "data": page},
        "servedPageFiles": served_page_files,
        "servedPageManifestDigest": page_digest,
        "captureToolchainDigest": toolchain_digest,
    }


def _validate_capture_receipt(
    value: dict[str, Any],
    protocol: dict[str, Any],
    candidate: dict[str, Any],
    view: dict[str, Any],
    image: dict[str, Any],
    capture_runner_sha256: str,
    capture_provenance: dict[str, Any],
) -> dict[str, Any]:
    keys = {
        "schemaVersion", "authority", "protocolDigest", "candidateId", "viewId",
        "captureId", "reloadId", "cameraDigest", "roomStateDigest", "assetSha256",
        "profileId", "expectedSplatCount", "rendererConfigDigest", "runtimeBuildDigest", "runtimeEnvironmentDigest",
        "profileDigest", "toneMapDigest", "exposureDigest", "colourSpaceDigest",
        "captureEvidenceClass", "capturePlanSha256", "capturePlanSizeBytes", "webOrigin",
        "servedPageManifestDigest", "captureToolchainDigest",
        "presentedFrameId", "rendererFrameDigest", "imageSha256",
        "frameEvidence",
        "captureOrdinal", "renderedFrameCounter", "capturedAtUtc",
        "captureRunnerSha256",
    }
    raw = _exact_object(value, keys, "INVALID_CAPTURE_RECEIPT_KEYS", "capture receipt")
    if raw["schemaVersion"] != CAPTURE_RECEIPT_SCHEMA_VERSION or raw["authority"] != "none":
        fail("CAPTURE_RECEIPT_HEADER_MISMATCH", "capture receipt header is invalid")
    checks = _capture_receipt_checks(
        protocol, candidate, view, image, capture_runner_sha256, capture_provenance
    )
    for key, (expected, code) in checks.items():
        if raw[key] != expected:
            fail(code, f"capture receipt {key} expected {expected!r}, observed {raw[key]!r}")
    ordinal = _positive_integer(raw["captureOrdinal"], 3, "capture receipt captureOrdinal")
    frame_counter = _positive_integer(
        raw["renderedFrameCounter"], 2_147_483_647, "capture receipt renderedFrameCounter"
    )
    captured_at = _parse_utc_timestamp(raw["capturedAtUtc"], "capture receipt capturedAtUtc")
    frame_evidence = _validate_saved_frame_evidence(
        raw["frameEvidence"], protocol, candidate, view,
        raw["presentedFrameId"], raw["rendererFrameDigest"],
    )
    return {
        **raw,
        "captureId": _safe_id(raw["captureId"], "capture receipt captureId"),
        "reloadId": _safe_id(raw["reloadId"], "capture receipt reloadId"),
        "presentedFrameId": _safe_id(raw["presentedFrameId"], "capture receipt presentedFrameId"),
        "rendererFrameDigest": _sha256(raw["rendererFrameDigest"], "capture receipt rendererFrameDigest"),
        "frameEvidence": frame_evidence,
        "captureOrdinal": ordinal,
        "renderedFrameCounter": frame_counter,
        "capturedAtUtc": captured_at,
    }


def _capture_receipt_checks(
    protocol: dict[str, Any], candidate: dict[str, Any], view: dict[str, Any],
    image: dict[str, Any], capture_runner_sha256: str, capture_provenance: dict[str, Any]
) -> dict[str, tuple[Any, str]]:
    return {
        "protocolDigest": (protocol["protocolDigest"], "CAPTURE_PROTOCOL_MISMATCH"),
        "candidateId": (candidate["candidateId"], "CAPTURE_CANDIDATE_MISMATCH"),
        "viewId": (view["viewId"], "CAPTURE_VIEW_MISMATCH"),
        "cameraDigest": (view["cameraDigest"], "CAPTURE_CAMERA_MISMATCH"),
        "roomStateDigest": (view["roomStateDigest"], "CAPTURE_ROOM_STATE_MISMATCH"),
        "assetSha256": (candidate["assetSha256"], "CAPTURE_ASSET_MISMATCH"),
        "profileId": (candidate["profileId"], "CAPTURE_PROFILE_MISMATCH"),
        "expectedSplatCount": (candidate["expectedSplatCount"], "CAPTURE_SPLAT_COUNT_MISMATCH"),
        "rendererConfigDigest": (candidate["rendererConfigDigest"], "CAPTURE_RENDERER_MISMATCH"),
        "runtimeBuildDigest": (protocol["rendererBinding"]["runtimeBuildDigest"], "CAPTURE_RENDERER_MISMATCH"),
        "runtimeEnvironmentDigest": (
            protocol["rendererBinding"]["runtimeEnvironmentDigest"],
            "CAPTURE_RENDERER_MISMATCH",
        ),
        "profileDigest": (protocol["rendererBinding"]["profileDigest"], "CAPTURE_RENDERER_MISMATCH"),
        "toneMapDigest": (protocol["rendererBinding"]["toneMapDigest"], "CAPTURE_RENDERER_MISMATCH"),
        "exposureDigest": (protocol["rendererBinding"]["exposureDigest"], "CAPTURE_RENDERER_MISMATCH"),
        "colourSpaceDigest": (protocol["rendererBinding"]["colourSpaceDigest"], "CAPTURE_RENDERER_MISMATCH"),
        "captureEvidenceClass": (protocol["captureBinding"]["evidenceClass"], "CAPTURE_EVIDENCE_CLASS_MISMATCH"),
        "capturePlanSha256": (capture_provenance["capturePlan"]["sha256"], "CAPTURE_PLAN_RECEIPT_MISMATCH"),
        "capturePlanSizeBytes": (capture_provenance["capturePlan"]["sizeBytes"], "CAPTURE_PLAN_RECEIPT_MISMATCH"),
        "webOrigin": (capture_provenance["webOrigin"], "CAPTURE_WEB_ORIGIN_MISMATCH"),
        "servedPageManifestDigest": (
            capture_provenance["servedPageManifestDigest"], "CAPTURE_SERVED_PAGE_MISMATCH"
        ),
        "captureToolchainDigest": (
            capture_provenance["captureToolchainDigest"], "CAPTURE_TOOLCHAIN_MISMATCH"
        ),
        "imageSha256": (image["sha256"], "CAPTURE_IMAGE_MISMATCH"),
        "captureRunnerSha256": (capture_runner_sha256, "CAPTURE_RUNNER_MISMATCH"),
    }


def _parse_utc_timestamp(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.endswith("Z"):
        fail("INVALID_CAPTURE_TIME", f"{label} must be an ISO-8601 UTC timestamp ending in Z")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as error:
        fail("INVALID_CAPTURE_TIME", f"{label} is invalid: {error}")
    if parsed.tzinfo != timezone.utc:
        fail("INVALID_CAPTURE_TIME", f"{label} must use UTC")
    return parsed.isoformat().replace("+00:00", "Z")


def _load_capture(
    value: Any,
    parent: Path,
    protocol: dict[str, Any],
    candidate: dict[str, Any],
    view: dict[str, Any],
    index: int,
    capture_runner_sha256: str,
    capture_provenance: dict[str, Any],
) -> tuple[dict[str, Any], np.ndarray]:
    raw = _exact_object(value, {"image", "receipt"}, "INVALID_CAPTURE_KEYS", "capture")
    width = view["camera"]["imageWidth"]
    height = view["camera"]["imageHeight"]
    image, pixels = _image_evidence(raw["image"], parent, f"capture[{index}].image", width, height)
    receipt = _file_evidence(raw["receipt"], parent, f"capture[{index}].receipt", MAX_JSON_BYTES)
    receipt_raw, _ = _read_json(Path(receipt["resolvedPath"]), f"capture[{index}].receipt")
    receipt_data = _validate_capture_receipt(
        receipt_raw, protocol, candidate, view, image, capture_runner_sha256, capture_provenance
    )
    return {"image": image, "receipt": {**receipt, "data": receipt_data}}, pixels


def _load_candidate_view(
    value: Any,
    parent: Path,
    protocol: dict[str, Any],
    candidate: dict[str, Any],
    view: dict[str, Any],
    capture_runner_sha256: str,
    capture_provenance: dict[str, Any],
) -> tuple[dict[str, Any], list[np.ndarray]]:
    raw = _exact_object(value, {"viewId", "captures"}, "INVALID_CANDIDATE_VIEW_KEYS", "candidate view")
    if raw["viewId"] != view["viewId"]:
        fail("CANDIDATE_VIEW_MISMATCH", f"candidate view expected {view['viewId']}")
    if not isinstance(raw["captures"], list) or len(raw["captures"]) != 3:
        fail("CAPTURE_REPEAT_COUNT_MISMATCH", "every candidate view requires exactly three captures")
    captures: list[dict[str, Any]] = []
    arrays: list[np.ndarray] = []
    for index, item in enumerate(raw["captures"]):
        capture, pixels = _load_capture(
            item, parent, protocol, candidate, view, index, capture_runner_sha256, capture_provenance
        )
        captures.append(capture)
        arrays.append(pixels)
    return {"viewId": view["viewId"], "captures": captures}, arrays


def _load_candidate(
    value: Any,
    parent: Path,
    protocol: dict[str, Any],
    views_by_id: dict[str, dict[str, Any]],
    capture_runner_sha256: str,
    capture_provenance: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, list[np.ndarray]]]:
    raw = _exact_object(
        value,
        {"candidateId", "assetSha256", "profileId", "expectedSplatCount", "rendererConfigDigest", "views"},
        "INVALID_RUN_KEYS",
        "candidate",
    )
    candidate = {
        "candidateId": _safe_id(raw["candidateId"], "candidate.candidateId"),
        "assetSha256": _sha256(raw["assetSha256"], "candidate.assetSha256"),
        "profileId": _safe_id(raw["profileId"], "candidate.profileId"),
        "expectedSplatCount": _positive_integer(raw["expectedSplatCount"], 2_147_483_647, "candidate.expectedSplatCount"),
        "rendererConfigDigest": _sha256(raw["rendererConfigDigest"], "candidate.rendererConfigDigest"),
    }
    bindings = {item["candidateId"]: item for item in protocol["candidateBindings"]}
    expected = bindings.get(candidate["candidateId"])
    if expected is None:
        fail("CAPTURE_CANDIDATE_BINDING_MISMATCH", "candidate identity differs from the frozen protocol")
    if candidate["assetSha256"] != expected["assetSetSha256"] or candidate["profileId"] != expected["profileId"] or candidate["expectedSplatCount"] != expected["expectedSplatCount"]:
        fail("CAPTURE_CANDIDATE_BINDING_MISMATCH", "candidate asset set differs from the frozen protocol")
    if candidate["rendererConfigDigest"] != protocol["rendererBinding"]["digest"]:
        fail("CAPTURE_RENDERER_MISMATCH", "candidate renderer digest does not match the frozen common renderer")
    if not isinstance(raw["views"], list):
        fail("INVALID_RUN", "candidate.views must be an array")
    supplied = {item.get("viewId") for item in raw["views"] if isinstance(item, dict)}
    if supplied != set(views_by_id):
        fail("CANDIDATE_VIEW_SET_MISMATCH", "candidate views do not match the frozen protocol")
    normalized: list[dict[str, Any]] = []
    arrays: dict[str, list[np.ndarray]] = {}
    for item in raw["views"]:
        view = views_by_id[item["viewId"]]
        loaded, pixels = _load_candidate_view(
            item, parent, protocol, candidate, view, capture_runner_sha256, capture_provenance
        )
        normalized.append(loaded)
        arrays[view["viewId"]] = pixels
    candidate["views"] = sorted(normalized, key=lambda item: item["viewId"])
    return candidate, arrays


def _validate_plan_run_candidates(
    plan: dict[str, Any], candidates: list[dict[str, Any]], protocol: dict[str, Any]
) -> None:
    if [item["candidateId"] for item in candidates] != protocol["candidateIds"]:
        fail("CANDIDATE_SET_MISMATCH", "run candidate order differs from the frozen protocol")
    plan_by_id = {item["candidateId"]: item for item in plan["candidates"]}
    for candidate in candidates:
        planned = plan_by_id[candidate["candidateId"]]
        observed = (
            candidate["assetSha256"], candidate["profileId"], candidate["expectedSplatCount"]
        )
        expected = (
            planned["assetSetSha256"], planned["profileId"], planned["expectedSplatCount"]
        )
        if observed != expected:
            fail("RUN_CAPTURE_PLAN_CANDIDATE_MISMATCH", "run candidate differs from capturePlan")


def _validate_run(
    raw: dict[str, Any], parent: Path, protocol: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, dict[str, list[np.ndarray]]]]:
    run = _exact_object(
        raw,
        {
            "schemaVersion", "authority", "protocolDigest", "captureRunnerImplementation",
            "capturePlan", "webOrigin", "servedPageManifest", "servedPageManifestDigest",
            "captureToolchainDigest", "candidates",
        },
        "INVALID_RUN_KEYS",
        "run",
    )
    if run["schemaVersion"] != RUN_SCHEMA_VERSION or run["authority"] != "none":
        fail("RUN_HEADER_MISMATCH", "run header does not match the v2 authority-none contract")
    if run["protocolDigest"] != protocol["protocolDigest"]:
        fail("RUN_PROTOCOL_MISMATCH", "run does not bind the frozen protocol")
    if not isinstance(run["candidates"], list) or len(run["candidates"]) != 2:
        fail("CANDIDATE_COUNT_MISMATCH", "run must contain exactly two candidates")
    runner = _file_evidence(
        run["captureRunnerImplementation"], parent, "run.captureRunnerImplementation", MAX_IMAGE_BYTES
    )
    if runner["sha256"] != protocol["captureBinding"]["runnerImplementation"]["sha256"]:
        fail("CAPTURE_RUNNER_NOT_FROZEN", "run capture implementation differs from the frozen protocol")
    provenance = _load_capture_provenance(run, parent, protocol)
    views_by_id = {view["viewId"]: view for view in protocol["views"]}
    candidates: list[dict[str, Any]] = []
    arrays: dict[str, dict[str, list[np.ndarray]]] = {}
    for item in run["candidates"]:
        candidate, candidate_arrays = _load_candidate(
            item, parent, protocol, views_by_id, runner["sha256"], provenance
        )
        candidates.append(candidate)
        arrays[candidate["candidateId"]] = candidate_arrays
    if {candidate["candidateId"] for candidate in candidates} != set(protocol["candidateIds"]):
        fail("CANDIDATE_SET_MISMATCH", "run candidates do not match the frozen protocol")
    _validate_plan_run_candidates(provenance["capturePlan"]["data"], candidates, protocol)
    normalized = {
        "schemaVersion": RUN_SCHEMA_VERSION,
        "authority": "none",
        "protocolDigest": run["protocolDigest"],
        "captureRunnerImplementation": runner,
        **provenance,
        "candidates": candidates,
    }
    _validate_run_uniqueness(normalized, protocol)
    return normalized, arrays


def _run_paths(run: dict[str, Any]) -> list[Path]:
    result: list[Path] = [
        Path(run["captureRunnerImplementation"]["resolvedPath"]),
        Path(run["capturePlan"]["resolvedPath"]),
        Path(run["servedPageManifest"]["resolvedPath"]),
    ]
    result.extend(Path(item["resolvedPath"]) for item in run["servedPageFiles"])
    for candidate in run["candidates"]:
        for view in candidate["views"]:
            for capture in view["captures"]:
                result.append(Path(capture["image"]["resolvedPath"]))
                result.append(Path(capture["receipt"]["resolvedPath"]))
    return result


def _run_evidence(run: dict[str, Any]) -> list[dict[str, Any]]:
    result = [run["captureRunnerImplementation"], run["capturePlan"], run["servedPageManifest"]]
    result.extend(run["servedPageFiles"])
    for candidate in run["candidates"]:
        for view in candidate["views"]:
            for capture in view["captures"]:
                result.extend((capture["image"], capture["receipt"]))
    return result


def _verify_evidence_records(records: list[dict[str, Any]], label: str) -> None:
    for index, evidence in enumerate(records):
        payload, stat = _read_stable_bytes(Path(evidence["resolvedPath"]), MAX_IMAGE_BYTES, f"{label}[{index}]")
        if len(payload) != evidence["sizeBytes"] or _sha256_bytes(payload) != evidence["sha256"] or stat.st_mtime_ns != evidence["mtimeNanoseconds"]:
            fail("INPUT_CHANGED_BEFORE_COMMIT", f"{label}[{index}] changed before outputs were committed")


def _validate_run_uniqueness(run: dict[str, Any], protocol: dict[str, Any]) -> None:
    _require_unique_paths(_run_paths(run), "DUPLICATE_RUN_PATH", "run")
    protocol_paths = {str(path).casefold() for path in _collect_protocol_paths(protocol)}
    if protocol_paths.intersection(str(path).casefold() for path in _run_paths(run)):
        fail("REFERENCE_CANDIDATE_PATH_OVERLAP", "a candidate input aliases protocol evidence")
    capture_ids: list[str] = []
    reload_ids: list[str] = []
    presented_ids: list[str] = []
    frame_digests: list[str] = []
    for candidate in run["candidates"]:
        for view in candidate["views"]:
            for capture in view["captures"]:
                data = capture["receipt"]["data"]
                capture_ids.append(data["captureId"])
                reload_ids.append(data["reloadId"])
                presented_ids.append(data["presentedFrameId"])
                frame_digests.append(data["rendererFrameDigest"])
    if len(capture_ids) != len(set(capture_ids)):
        fail("CAPTURE_ID_REUSED", "captureId must be globally unique")
    if len(reload_ids) != len(set(reload_ids)):
        fail("CAPTURE_RELOAD_ID_REUSED", "reloadId must be globally unique")
    if len(presented_ids) != len(set(presented_ids)) or len(frame_digests) != len(set(frame_digests)):
        fail("RENDERER_FRAME_EVIDENCE_REUSED", "renderer-owned frame identity must be globally unique")
    _validate_fresh_capture_sequences(run)


def _validate_fresh_capture_sequences(run: dict[str, Any]) -> None:
    for candidate in run["candidates"]:
        for view in candidate["views"]:
            data = [capture["receipt"]["data"] for capture in view["captures"]]
            ordinals = [item["captureOrdinal"] for item in data]
            counters = [item["renderedFrameCounter"] for item in data]
            timestamps = [datetime.fromisoformat(item["capturedAtUtc"].replace("Z", "+00:00")) for item in data]
            if ordinals != [1, 2, 3]:
                fail("CAPTURE_ORDINAL_MISMATCH", f"{candidate['candidateId']}/{view['viewId']} ordinals must be 1, 2, 3")
            if not (counters[0] < counters[1] < counters[2]):
                fail("CAPTURE_FRAME_COUNTER_NOT_FRESH", f"{candidate['candidateId']}/{view['viewId']} frame counters must increase")
            if not (timestamps[0] < timestamps[1] < timestamps[2]):
                fail("CAPTURE_TIMESTAMPS_NOT_INCREASING", f"{candidate['candidateId']}/{view['viewId']} timestamps must increase")


def _srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    values = rgb.astype(np.float32) / np.float32(255.0)
    return np.where(
        values <= np.float32(0.04045),
        values / np.float32(12.92),
        np.power((values + np.float32(0.055)) / np.float32(1.055), np.float32(2.4)),
    ).astype(np.float32)


def _linear_luminance(linear: np.ndarray) -> np.ndarray:
    return (
        linear[..., 0] * np.float32(0.2126)
        + linear[..., 1] * np.float32(0.7152)
        + linear[..., 2] * np.float32(0.0722)
    )


def _downsample_mean(values: np.ndarray, factor: int) -> np.ndarray:
    if factor == 1:
        return values
    height, width = values.shape[:2]
    if values.ndim == 2:
        return values.reshape(height // factor, factor, width // factor, factor).mean(axis=(1, 3))
    channels = values.shape[2]
    return values.reshape(height // factor, factor, width // factor, factor, channels).mean(axis=(1, 3))


def _downsample_mask(mask: np.ndarray, factor: int) -> np.ndarray:
    if factor == 1:
        return mask
    height, width = mask.shape
    blocks = mask.reshape(height // factor, factor, width // factor, factor)
    return np.all(blocks, axis=(1, 3))


def _fill_from_masked_pixels(values: np.ndarray, mask: np.ndarray) -> np.ndarray:
    if not np.any(mask):
        fail("INSUFFICIENT_MASKED_PIXELS", "a mask contains no usable pixels")
    _, nearest = distance_transform_edt(~mask, return_indices=True)
    return values[tuple(nearest)]


def _masked_gradient_features(gray: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, ...]:
    valid = binary_erosion(mask, iterations=2, border_value=0)
    if int(np.count_nonzero(valid)) < 64:
        fail("INSUFFICIENT_MASKED_PIXELS", "a scaled mask leaves too few interior pixels")
    protected = _fill_from_masked_pixels(gray, mask)
    mean = gaussian_filter(protected, sigma=LOCAL_NORMALIZATION_SIGMA, mode="reflect")
    centered = protected - mean
    variance = gaussian_filter(centered * centered, sigma=LOCAL_NORMALIZATION_SIGMA, mode="reflect")
    normalized = np.clip(centered / np.sqrt(variance + 1e-6), -4.0, 4.0)
    gradient_y = sobel(normalized, axis=0, mode="reflect") / np.float32(8.0)
    gradient_x = sobel(normalized, axis=1, mode="reflect") / np.float32(8.0)
    magnitude = np.hypot(gradient_x, gradient_y)
    threshold = max(float(np.quantile(magnitude[valid], EDGE_QUANTILE)), 1e-4)
    edges = valid & (magnitude >= threshold)
    if int(np.count_nonzero(edges)) < MIN_MASK_EDGE_PIXELS:
        fail("INSUFFICIENT_STRUCTURE", "a masked image scale contains too few structural edges")
    return gradient_x, gradient_y, magnitude, edges, valid


def _edge_chamfer(a_edges: np.ndarray, b_edges: np.ndarray, clip: float) -> float:
    distance_to_b = np.minimum(distance_transform_edt(~b_edges), clip)
    distance_to_a = np.minimum(distance_transform_edt(~a_edges), clip)
    forward = float(np.mean(distance_to_b[a_edges], dtype=np.float64))
    reverse = float(np.mean(distance_to_a[b_edges], dtype=np.float64))
    return (forward + reverse) / (2.0 * clip)


def _gradient_similarity(a: tuple[np.ndarray, ...], b: tuple[np.ndarray, ...]) -> float:
    a_x, a_y, a_magnitude, _, a_valid = a
    b_x, b_y, b_magnitude, _, b_valid = b
    valid = a_valid & b_valid
    a_scale = max(float(np.quantile(a_magnitude[valid], 0.95)), 1e-6)
    b_scale = max(float(np.quantile(b_magnitude[valid], 0.95)), 1e-6)
    a_strength = np.clip(a_magnitude / a_scale, 0.0, 1.0)
    b_strength = np.clip(b_magnitude / b_scale, 0.0, 1.0)
    orientation = np.abs(a_x * b_x + a_y * b_y) / (a_magnitude * b_magnitude + 1e-8)
    strength = 2.0 * a_strength * b_strength / (a_strength * a_strength + b_strength * b_strength + 1e-8)
    weight = np.maximum(a_strength, b_strength)
    active = valid & (weight >= 0.10)
    if not np.any(active):
        fail("INSUFFICIENT_STRUCTURE", "masked gradient comparison has no active pixels")
    numerator = np.sum(weight[active] * orientation[active] * strength[active], dtype=np.float64)
    return float(numerator / np.sum(weight[active], dtype=np.float64))


def compare_masked_arrays(reference_rgb: np.ndarray, candidate_rgb: np.ndarray, mask: np.ndarray) -> dict[str, float]:
    if reference_rgb.shape != candidate_rgb.shape or mask.shape != reference_rgb.shape[:2]:
        fail("IMAGE_ARRAY_SHAPE_MISMATCH", "reference, candidate, and mask shapes must match")
    reference_linear = _srgb_to_linear(reference_rgb)
    candidate_linear = _srgb_to_linear(candidate_rgb)
    selected = mask[..., None]
    rmse = float(np.sqrt(np.mean(np.square(reference_linear - candidate_linear)[np.broadcast_to(selected, reference_linear.shape)], dtype=np.float64)))
    reference_gray = _linear_luminance(reference_linear)
    candidate_gray = _linear_luminance(candidate_linear)
    chamfer = 0.0
    gradient = 0.0
    for factor, weight in zip(SCALE_FACTORS, SCALE_WEIGHTS, strict=True):
        scaled_mask = _downsample_mask(mask, factor)
        reference_features = _masked_gradient_features(_downsample_mean(reference_gray, factor), scaled_mask)
        candidate_features = _masked_gradient_features(_downsample_mean(candidate_gray, factor), scaled_mask)
        chamfer += weight * _edge_chamfer(reference_features[3], candidate_features[3], max(EDGE_DISTANCE_CLIP_PIXELS / factor, 1.0))
        gradient += weight * _gradient_similarity(reference_features, candidate_features)
    return {
        "maskedMultiscaleEdgeChamfer": chamfer,
        "maskedGradientOrientationSimilarity": gradient,
        "maskedLinearRgbRmse": rmse,
        **_masked_srgb_metrics(reference_rgb, candidate_rgb, mask),
    }


def _masked_srgb_metrics(
    reference_rgb: np.ndarray, candidate_rgb: np.ndarray, mask: np.ndarray
) -> dict[str, float]:
    reference = reference_rgb.astype(np.float32) / np.float32(255.0)
    candidate = candidate_rgb.astype(np.float32) / np.float32(255.0)
    selected = np.broadcast_to(mask[..., None], reference.shape)
    difference = reference - candidate
    mse = float(np.mean(np.square(difference)[selected], dtype=np.float64))
    mae = float(np.mean(np.abs(difference)[selected], dtype=np.float64))
    psnr = -10.0 * math.log10(max(mse, 1e-12))
    return {
        "maskedSrgbPsnrDb": psnr,
        "maskedSrgbSsim": _masked_ssim(reference, candidate, mask),
        "maskedSrgbMae": mae,
    }


def _masked_ssim(reference: np.ndarray, candidate: np.ndarray, mask: np.ndarray) -> float:
    window = 7
    sample_count = window * window
    normalization = sample_count / (sample_count - 1)
    filter_size = (window, window, 1)
    mean_a = uniform_filter(reference, size=filter_size, mode="reflect")
    mean_b = uniform_filter(candidate, size=filter_size, mode="reflect")
    variance_a = normalization * (
        uniform_filter(reference * reference, size=filter_size, mode="reflect") - mean_a * mean_a
    )
    variance_b = normalization * (
        uniform_filter(candidate * candidate, size=filter_size, mode="reflect") - mean_b * mean_b
    )
    covariance = normalization * (
        uniform_filter(reference * candidate, size=filter_size, mode="reflect") - mean_a * mean_b
    )
    numerator = (2.0 * mean_a * mean_b + 0.01**2) * (2.0 * covariance + 0.03**2)
    denominator = (mean_a * mean_a + mean_b * mean_b + 0.01**2) * (
        variance_a + variance_b + 0.03**2
    )
    valid = binary_erosion(mask, structure=np.ones((window, window), dtype=bool), border_value=0)
    if int(np.count_nonzero(valid)) < MIN_MASK_PIXELS:
        fail("INSUFFICIENT_MASKED_PIXELS", "SSIM mask leaves too few seven-pixel-window samples")
    return float(np.mean((numerator / denominator)[np.broadcast_to(valid[..., None], reference.shape)], dtype=np.float64))


def _apply_shared_transform(rgb: np.ndarray, transform: dict[str, Any] | None) -> np.ndarray:
    if transform is None:
        return rgb
    linear = _srgb_to_linear(rgb)
    matrix = np.asarray(transform["matrix3x3"], dtype=np.float32).reshape(3, 3)
    offset = np.asarray(transform["offsetLinearRgb"], dtype=np.float32)
    adjusted = np.clip(linear @ matrix.T + offset, 0.0, 1.0)
    srgb = np.where(
        adjusted <= np.float32(0.0031308),
        adjusted * np.float32(12.92),
        np.float32(1.055) * np.power(adjusted, np.float32(1.0 / 2.4)) - np.float32(0.055),
    )
    return np.rint(np.clip(srgb, 0.0, 1.0) * np.float32(255.0)).astype(np.uint8)


def _load_protocol_arrays(protocol: dict[str, Any]) -> tuple[dict[str, list[np.ndarray]], dict[str, dict[str, np.ndarray]]]:
    references: dict[str, list[np.ndarray]] = {}
    masks: dict[str, dict[str, np.ndarray]] = {}
    for view in protocol["views"]:
        width = view["camera"]["imageWidth"]
        height = view["camera"]["imageHeight"]
        images = [view["reference"]["image"], *view["reference"]["repeatImages"]]
        references[view["viewId"]] = [
            _decode_bound_image(item, f"{view['viewId']} reference {index}", width, height)
            for index, item in enumerate(images)
        ]
        masks[view["viewId"]] = {
            region["regionId"]: _decode_bound_mask(region["mask"], region["regionId"], width, height)
            for region in view["regions"]
        }
    return references, masks


def _decode_bound_image(evidence: dict[str, Any], label: str, width: int, height: int) -> np.ndarray:
    array = _decode_png(evidence, label, "RGB")
    if array.shape != (height, width, 3):
        fail("FROZEN_INPUT_CHANGED", f"{label} dimensions changed")
    return array


def _decode_bound_mask(evidence: dict[str, Any], label: str, width: int, height: int) -> np.ndarray:
    array = _decode_png(evidence, label, "L")
    if array.shape != (height, width) or not set(int(item) for item in np.unique(array)).issubset({0, 255}):
        fail("FROZEN_INPUT_CHANGED", f"{label} mask semantics changed")
    return array == 255


def _score_capture_set(reference: np.ndarray, captures: list[np.ndarray], mask: np.ndarray, transform: dict[str, Any] | None) -> dict[str, Any]:
    untouched = [compare_masked_arrays(reference, capture, mask) for capture in captures]
    normalized = None
    if transform is not None:
        normalized = [compare_masked_arrays(reference, _apply_shared_transform(capture, transform), mask) for capture in captures]
    return {"untouched": _summarize_metric_rows(untouched), "sharedNormalized": _summarize_metric_rows(normalized) if normalized is not None else None}


def _summarize_metric_rows(rows: list[dict[str, float]]) -> dict[str, Any]:
    return {
        "perCapture": rows,
        "mean": {metric: float(np.mean([row[metric] for row in rows], dtype=np.float64)) for metric in METRIC_IDS},
        "standardDeviation": {metric: float(np.std([row[metric] for row in rows], dtype=np.float64)) for metric in METRIC_IDS},
        "minimum": {metric: min(row[metric] for row in rows) for metric in METRIC_IDS},
        "maximum": {metric: max(row[metric] for row in rows) for metric in METRIC_IDS},
    }


def _reference_noise(
    references: list[np.ndarray], candidate: np.ndarray, mask: np.ndarray, transform: dict[str, Any] | None
) -> dict[str, dict[str, float]]:
    lanes: dict[str, dict[str, float]] = {}
    for lane, transformed in (("untouched", candidate), ("sharedNormalized", _apply_shared_transform(candidate, transform))):
        if lane == "sharedNormalized" and transform is None:
            continue
        rows = [compare_masked_arrays(reference, transformed, mask) for reference in references]
        lanes[lane] = {
            metric: max(row[metric] for row in rows) - min(row[metric] for row in rows)
            for metric in METRIC_IDS
        }
    return lanes


def _score_region(
    reference_images: list[np.ndarray], candidate_arrays: dict[str, list[np.ndarray]], mask: np.ndarray, transform: dict[str, Any] | None
) -> dict[str, Any]:
    candidates: dict[str, Any] = {}
    for candidate_id, captures in candidate_arrays.items():
        scores = _score_capture_set(reference_images[0], captures, mask, transform)
        scores["physicalReferenceNoiseRange"] = _reference_noise(reference_images, captures[0], mask, transform)
        candidates[candidate_id] = scores
    return {"candidates": candidates}


def _metric_margin(first: dict[str, Any], second: dict[str, Any], metric: str, lane: str) -> tuple[str | None, float]:
    first_value = first[lane]["mean"][metric]
    second_value = second[lane]["mean"][metric]
    difference = second_value - first_value if metric in LOWER_IS_BETTER else first_value - second_value
    if abs(difference) <= 1e-12:
        return None, 0.0
    return ("first" if difference > 0 else "second"), abs(difference)


def _metric_noise(candidate: dict[str, Any], metric: str, lane: str) -> float:
    return candidate["physicalReferenceNoiseRange"].get(lane, {}).get(metric, 0.0)


def _clear_range_leader(
    first: dict[str, Any],
    second: dict[str, Any],
    metric: str,
    lane: str,
    threshold: float | None,
) -> tuple[str | None, float, float]:
    physical_noise = max(_metric_noise(first, metric, lane), _metric_noise(second, metric, lane))
    if metric in LOWER_IS_BETTER:
        first_gap = second[lane]["minimum"][metric] - first[lane]["maximum"][metric]
        second_gap = first[lane]["minimum"][metric] - second[lane]["maximum"][metric]
    else:
        first_gap = first[lane]["minimum"][metric] - second[lane]["maximum"][metric]
        second_gap = second[lane]["minimum"][metric] - first[lane]["maximum"][metric]
    required = physical_noise + (threshold if threshold is not None else math.inf)
    if first_gap > required:
        return "first", first_gap, physical_noise
    if second_gap > required:
        return "second", second_gap, physical_noise
    return None, max(first_gap, second_gap, 0.0), physical_noise


def _annotate_region_signal(
    scored: dict[str, Any], candidate_ids: list[str], thresholds: dict[str, float | None]
) -> None:
    first = scored["candidates"][candidate_ids[0]]
    second = scored["candidates"][candidate_ids[1]]
    signals: dict[str, Any] = {}
    for lane in ("untouched", "sharedNormalized"):
        if first[lane] is None or second[lane] is None:
            continue
        lane_signals: dict[str, Any] = {}
        for metric in METRIC_IDS:
            side, margin = _metric_margin(first, second, metric, lane)
            threshold = thresholds[metric]
            clear_side, separated_margin, noise = _clear_range_leader(
                first, second, metric, lane, threshold
            )
            winner = candidate_ids[0] if clear_side == "first" else candidate_ids[1] if clear_side == "second" else None
            lane_signals[metric] = {
                "rawLeader": candidate_ids[0] if side == "first" else candidate_ids[1] if side == "second" else None,
                "meanMargin": margin,
                "repeatRangeSeparation": separated_margin,
                "physicalReferenceNoiseFloor": noise,
                "minimumPracticalEffect": threshold,
                "clearLeader": winner,
            }
        signals[lane] = lane_signals
    scored["signals"] = signals


def _score_view(
    view: dict[str, Any], references: list[np.ndarray], masks: dict[str, np.ndarray], arrays: dict[str, dict[str, list[np.ndarray]]], protocol: dict[str, Any]
) -> dict[str, Any]:
    candidate_ids = protocol["candidateIds"]
    view_arrays = {candidate: arrays[candidate][view["viewId"]] for candidate in candidate_ids}
    regions: list[dict[str, Any]] = []
    for region in view["regions"]:
        scored = _score_region(references, view_arrays, masks[region["regionId"]], protocol["comparison"]["sharedColorTransform"])
        _annotate_region_signal(scored, candidate_ids, protocol["comparison"]["minimumPracticalEffect"])
        regions.append({"regionId": region["regionId"], "kind": region["kind"], "feature": region["feature"], **scored})
    full_mask = np.ones(references[0].shape[:2], dtype=bool)
    full_frame = _score_region(references, view_arrays, full_mask, protocol["comparison"]["sharedColorTransform"])
    return {"viewId": view["viewId"], "regions": regions, "fullFrameDiagnosticOnly": full_frame}


def _region_majority(
    regions: list[dict[str, Any]], lane: str, metric: str, candidate_ids: list[str]
) -> str | None:
    leaders = [
        region["signals"].get(lane, {}).get(metric, {}).get("clearLeader")
        for region in regions
    ]
    required = len(leaders) // 2 + 1
    winners = [candidate for candidate in candidate_ids if leaders.count(candidate) >= required]
    return winners[0] if len(winners) == 1 else None


def _feature_signal(
    views: list[dict[str, Any]], feature: str, lane: str, candidate_ids: list[str]
) -> tuple[str | None, dict[str, Any]]:
    regions = [
        region for view in views for region in view["regions"]
        if region.get("kind") == "hero" and region.get("feature") == feature
    ]
    metric_winners = {
        metric: _region_majority(regions, lane, metric, candidate_ids)
        for metric in METRIC_IDS
    }
    unique = {winner for winner in metric_winners.values() if winner is not None}
    signal = next(iter(unique)) if len(unique) == 1 and all(metric_winners.values()) else None
    return signal, {"regionCount": len(regions), "metricWinners": metric_winners}


def _context_regressions(
    views: list[dict[str, Any]], lane: str, candidate: str | None
) -> list[dict[str, str]]:
    if candidate is None:
        return []
    regressions: list[dict[str, str]] = []
    for view in views:
        for region in view["regions"]:
            if region.get("kind") != "non_hero":
                continue
            for metric in METRIC_IDS:
                leader = region["signals"].get(lane, {}).get(metric, {}).get("clearLeader")
                if leader is not None and leader != candidate:
                    regressions.append({"viewId": view["viewId"], "regionId": region["regionId"], "metric": metric, "clearLeader": leader})
    return regressions


def _lane_signal(
    views: list[dict[str, Any]], lane: str, candidate_ids: list[str]
) -> tuple[str | None, dict[str, Any]]:
    features = {
        feature: _feature_signal(views, feature, lane, candidate_ids)
        for feature in sorted(HERO_FEATURES)
    }
    feature_winners = {feature: result[0] for feature, result in features.items()}
    unique = {winner for winner in feature_winners.values() if winner is not None}
    hero_candidate = (
        next(iter(unique))
        if len(unique) == 1 and all(feature_winners.values())
        else None
    )
    regressions = _context_regressions(views, lane, hero_candidate)
    signal = hero_candidate if hero_candidate is not None and not regressions else None
    evidence = {
        "heroFeatures": {feature: result[1] for feature, result in features.items()},
        "heroFeatureWinners": feature_winners,
        "heroCandidate": hero_candidate,
        "contextRegressionVeto": bool(regressions),
        "contextRegressions": regressions,
    }
    return signal, evidence


def _decision(protocol: dict[str, Any], views: list[dict[str, Any]]) -> dict[str, Any]:
    base = {
        "candidateDirectionalLead": None,
        "productWinner": None,
        "promotionAuthorized": False,
        "isPhysicalApproval": False,
        "isCommercialApproval": False,
        "humanReviewRequired": True,
    }
    if protocol["purpose"] == "source_view_diagnostic":
        return {"status": "source_view_diagnostic_only", **base, "reason": "The reference may have helped build a candidate, so numerical differences cannot select a candidate."}
    untouched, untouched_evidence = _lane_signal(views, "untouched", protocol["candidateIds"])
    normalized = None
    normalized_evidence = None
    if protocol["comparison"]["sharedColorTransform"] is not None:
        normalized, normalized_evidence = _lane_signal(views, "sharedNormalized", protocol["candidateIds"])
    if normalized_evidence is not None and untouched != normalized:
        return {"status": "unstable_under_normalisation", **base, "reason": "Untouched and shared-normalized processing do not produce the same machine signal.", "laneEvidence": {"untouched": untouched_evidence, "sharedNormalized": normalized_evidence}}
    if untouched is None and untouched_evidence["contextRegressionVeto"]:
        return {"status": "context_regression_veto", **base, "reason": "A candidate led on every required hero feature but was clearly worse in at least one non-hero context region.", "laneEvidence": {"untouched": untouched_evidence, "sharedNormalized": normalized_evidence}}
    if untouched is None:
        return {"status": "no_stable_machine_signal", **base, "reason": "Pixel and structural metrics do not agree beyond frozen thresholds and repeat noise.", "laneEvidence": {"untouched": untouched_evidence, "sharedNormalized": normalized_evidence}}
    return {"status": "directional_lead_requires_human_review", **base, "candidateDirectionalLead": untouched, "reason": "Every required hero feature agreed beyond the frozen thresholds, with no clear regression in a non-hero context region; product selection remains disabled.", "laneEvidence": {"untouched": untouched_evidence, "sharedNormalized": normalized_evidence}}


def _blind_mapping(candidate_ids: list[str]) -> dict[str, str]:
    ordered = list(candidate_ids)
    if os.urandom(1)[0] & 1:
        ordered.reverse()
    return {"A": ordered[0], "B": ordered[1]}


def _mask_bounds(mask: np.ndarray, label: str) -> tuple[int, int, int, int]:
    rows, columns = np.nonzero(mask)
    if not rows.size or not columns.size:
        fail("EMPTY_REVIEW_MASK", f"{label} has no visible pixels")
    return int(columns.min()), int(rows.min()), int(columns.max()) + 1, int(rows.max()) + 1


def _board_rows(
    protocol: dict[str, Any],
    references: dict[str, list[np.ndarray]],
    masks: dict[str, dict[str, np.ndarray]],
    arrays: dict[str, dict[str, list[np.ndarray]]],
    mapping: dict[str, str],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for view in protocol["views"]:
        view_id = view["viewId"]
        for region in view["regions"]:
            region_id = region["regionId"]
            bounds = _mask_bounds(masks[view_id][region_id], region_id)
            left, top, right, bottom = bounds
            source_arrays = (
                references[view_id][0],
                arrays[mapping["A"]][view_id][0],
                arrays[mapping["B"]][view_id][0],
            )
            crop_mask = masks[view_id][region_id][top:bottom, left:right]
            crops = [_masked_review_crop(item[top:bottom, left:right], crop_mask) for item in source_arrays]
            rows.append({"reviewRowId": _review_row_id(len(rows)), "viewId": view_id, "regionId": region_id, "crops": crops})
    return rows


def _masked_review_crop(pixels: np.ndarray, mask: np.ndarray) -> Image.Image:
    protected = pixels.copy()
    protected[~mask] = np.array([32, 34, 36], dtype=np.uint8)
    return Image.fromarray(protected, mode="RGB")


def _review_row_id(index: int) -> str:
    return f"row-{index + 1:03d}"


def _review_board_size(rows: list[dict[str, Any]]) -> tuple[int, int, int]:
    gutter, header, gap = 224, 38, 8
    tile_width = max(crop.width for row in rows for crop in row["crops"])
    width = gutter + tile_width * 3
    height = header + sum(max(row["crops"][0].height, 34) + gap for row in rows)
    if width > MAX_REVIEW_BOARD_DIMENSION or height > MAX_REVIEW_BOARD_DIMENSION:
        fail("REVIEW_BOARD_TOO_LARGE", "native-pixel region board exceeds the supported dimensions")
    if width * height > MAX_REVIEW_BOARD_PIXELS:
        fail("REVIEW_BOARD_TOO_LARGE", "native-pixel region board exceeds the supported pixel budget")
    return width, height, tile_width


def _draw_review_board(rows: list[dict[str, Any]], size: tuple[int, int, int]) -> Image.Image:
    width, height, tile_width = size
    gutter, header, gap = 224, 38, 8
    board = Image.new("RGB", (width, height), (20, 22, 24))
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default()
    for column, label in enumerate(("REFERENCE", "CANDIDATE A", "CANDIDATE B")):
        draw.text((gutter + column * tile_width + 8, 11), label, fill=(245, 245, 245), font=font)
    y = header
    for row in rows:
        draw.text((8, y + 11), row["reviewRowId"], fill=(255, 215, 110), font=font)
        for column, crop in enumerate(row["crops"]):
            board.paste(crop, (gutter + column * tile_width, y))
        y += max(row["crops"][0].height, 34) + gap
    return board


def _board_bytes(
    protocol: dict[str, Any],
    references: dict[str, list[np.ndarray]],
    masks: dict[str, dict[str, np.ndarray]],
    arrays: dict[str, dict[str, list[np.ndarray]]],
) -> tuple[bytes, dict[str, str]]:
    mapping = _blind_mapping(protocol["candidateIds"])
    rows = _board_rows(protocol, references, masks, arrays, mapping)
    board = _draw_review_board(rows, _review_board_size(rows))
    output = BytesIO()
    board.save(output, format="PNG", optimize=False)
    return output.getvalue(), mapping


def _review_text(protocol: dict[str, Any], board_sha256: str) -> str:
    lines = [
        "# Reception Room blinded source-photo review",
        "",
        f"Protocol: `{protocol['protocolDigest']}`",
        f"Board SHA-256: `{board_sha256}`",
        "",
        "This board cannot choose a product winner by itself.",
        "Every row is an unscaled, native-pixel crop around one mask frozen before scoring.",
        "Record A, B, tie, or not assessable for detail, ghosting, colour, edge stability, and source likeness.",
        "Do not reveal the A/B key until every row is completed. A display mismatch, missing row, tie, or not-assessable result keeps the gate open.",
        "",
        "Display device: ____________________",
        "Display pixel dimensions: __________",
        "Viewing distance: __________________",
        "Zoom (must be 100%): ______________",
        "Reviewer: __________________________",
        "",
    ]
    row_count = sum(len(view["regions"]) for view in protocol["views"])
    for index in range(row_count):
        lines.extend(_review_region_lines(_review_row_id(index)))
    return "\n".join(lines)


def _review_region_lines(review_row_id: str) -> list[str]:
    return [
        f"## {review_row_id}",
        "",
        "Preference (A/B/tie/not assessable): __________",
        "Materially visible (yes/no/not assessable): ____",
        "Confidence (low/medium/high): __________________",
        "Artifacts (none/ghosting/blur/colour shift/geometry mismatch/lighting mismatch): __________",
        "Notes: _________________________________________",
        "",
    ]


def _review_form_bytes(result: dict[str, Any], board_bytes: bytes) -> bytes:
    with Image.open(BytesIO(board_bytes)) as board:
        board_width, board_height = board.size
    identities = [
        (view["viewId"], region["regionId"])
        for view in result["views"]
        for region in view["regions"]
    ]
    rows = [
        {
            "reviewRowId": _review_row_id(index),
            "preference": "not_assessable",
            "materiallyVisible": "not_assessable",
            "confidence": "low",
            "artifactFlags": ["none"],
            "notes": "Not reviewed.",
        }
        for index, _ in enumerate(identities)
    ]
    form = {
        "schemaVersion": REVIEW_INPUT_SCHEMA_VERSION,
        "authority": "human_observation_only",
        "resultDigest": result["resultDigest"],
        "protocolDigest": result["protocolDigest"],
        "boardSha256": _sha256_bytes(board_bytes),
        "reviewerId": "reviewer-not-recorded",
        "deviceModel": "not-recorded",
        "displayWidthPixels": board_width,
        "displayHeightPixels": board_height,
        "displayCalibration": "unknown",
        "viewingDistanceCentimetres": 60.0,
        "zoomPercent": 100,
        "boardDisplayedAtNativePixels": False,
        "rows": rows,
    }
    return (json.dumps(form, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _result_document(
    protocol: dict[str, Any],
    run: dict[str, Any],
    views: list[dict[str, Any]],
    board_bytes: bytes | None,
    review_bytes: bytes | None,
    answer_key_bytes: bytes | None,
) -> dict[str, Any]:
    return {
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "status": "diagnostic_complete_authority_none",
        "authority": "none",
        "protocolDigest": protocol["protocolDigest"],
        "runDigest": _sha256_bytes(_canonical_json_bytes(run)),
        "purpose": protocol["purpose"],
        "candidateIds": protocol["candidateIds"],
        "views": views,
        "decision": _decision(protocol, views),
        "humanReviewArtifacts": {
            "boardSha256": _sha256_bytes(board_bytes) if board_bytes is not None else None,
            "reviewTemplateSha256": _sha256_bytes(review_bytes) if review_bytes is not None else None,
            "answerKeySha256": _sha256_bytes(answer_key_bytes) if answer_key_bytes is not None else None,
            "regionCropsAtNativePixels": True if board_bytes is not None else None,
            "reviewCompleted": False,
        },
        "permissions": protocol["permissions"],
        "limitations": protocol["limitations"],
    }


def _write_bundle(outputs: list[tuple[Path, bytes, str]], protected: set[Path]) -> None:
    resolved = [_prepare_output(path, protected, label) for path, _, label in outputs]
    if len({str(path).casefold() for path in resolved}) != len(resolved):
        fail("OUTPUT_PATH_REUSED", "two requested outputs resolve to the same path")
    written: list[Path] = []
    try:
        for (path, payload, label), target in zip(outputs, resolved, strict=True):
            _write_create_only(path, payload, protected, label)
            written.append(target)
    except SourceComparisonError:
        for target in written:
            try:
                target.unlink(missing_ok=True)
            except OSError:
                pass
        raise


def evaluate_run(
    protocol_path: Path,
    run_path: Path,
    output_path: Path,
    board_path: Path | None = None,
    review_path: Path | None = None,
    answer_key_path: Path | None = None,
    review_form_path: Path | None = None,
) -> dict[str, Any]:
    protocol = verify_protocol_file(protocol_path)
    resolved_protocol = protocol_path.resolve(strict=True)
    raw_run, resolved_run = _read_json(run_path, "capture run")
    run, arrays = _validate_run(raw_run, resolved_run.parent, protocol)
    references, masks = _load_protocol_arrays(protocol)
    views = [_score_view(view, references[view["viewId"]], masks[view["viewId"]], arrays, protocol) for view in protocol["views"]]
    board_bytes, mapping = (
        _board_bytes(protocol, references, masks, arrays) if board_path is not None else (None, None)
    )
    review_bytes = _review_text(protocol, _sha256_bytes(board_bytes)).encode("utf-8") if review_path is not None and board_bytes is not None else None
    if (review_path is not None or answer_key_path is not None or review_form_path is not None) and board_path is None:
        fail("REVIEW_BOARD_REQUIRED", "review artifacts require a blinded board")
    if board_path is not None and answer_key_path is None:
        fail("ANSWER_KEY_REQUIRED", "a blinded board requires a separate answer key")
    answer_key_bytes = _answer_key_bytes(protocol, board_bytes, mapping) if board_bytes is not None and mapping is not None else None
    document = _result_document(protocol, run, views, board_bytes, review_bytes, answer_key_bytes)
    sealed = _seal(document, "resultDigest", RESULT_DIGEST_DOMAIN)
    outputs = [(output_path, (json.dumps(sealed, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8"), "result")]
    if board_path is not None and board_bytes is not None:
        outputs.append((board_path, board_bytes, "review board"))
    if review_path is not None and review_bytes is not None:
        outputs.append((review_path, review_bytes, "review template"))
    if answer_key_path is not None and answer_key_bytes is not None:
        outputs.append((answer_key_path, answer_key_bytes, "answer key"))
    if review_form_path is not None and board_bytes is not None:
        outputs.append((review_form_path, _review_form_bytes(sealed, board_bytes), "review input form"))
    rechecked_protocol = verify_protocol_file(protocol_path)
    if rechecked_protocol["protocolDigest"] != protocol["protocolDigest"]:
        fail("PROTOCOL_CHANGED_BEFORE_COMMIT", "protocol changed while the run was scored")
    rechecked_run, _ = _read_json(run_path, "capture run final check")
    if _canonical_json_bytes(rechecked_run) != _canonical_json_bytes(raw_run):
        fail("RUN_CHANGED_BEFORE_COMMIT", "capture run changed while it was scored")
    _verify_evidence_records(_run_evidence(run), "run evidence")
    protected = {resolved_protocol, resolved_run, *_collect_protocol_paths(protocol), *_run_paths(run)}
    _write_bundle(outputs, protected)
    return sealed


def _answer_key_bytes(
    protocol: dict[str, Any], board_bytes: bytes, mapping: dict[str, str]
) -> bytes:
    document = {
        "schemaVersion": ANSWER_KEY_SCHEMA_VERSION,
        "authority": "none",
        "protocolDigest": protocol["protocolDigest"],
        "boardSha256": _sha256_bytes(board_bytes),
        "blindingNonce": os.urandom(32).hex(),
        "mapping": mapping,
        "rowMapping": {
            _review_row_id(index): {"viewId": view["viewId"], "regionId": region["regionId"]}
            for index, (view, region) in enumerate(
                (view, region) for view in protocol["views"] for region in view["regions"]
            )
        },
        "instruction": "Keep this file separate until the blinded review is complete.",
    }
    sealed = _seal(document, "answerKeyDigest", ANSWER_KEY_DIGEST_DOMAIN)
    return (json.dumps(sealed, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _verified_result(path: Path) -> tuple[dict[str, Any], Path]:
    result, resolved = _read_json(path, "comparison result")
    if result.get("schemaVersion") != RESULT_SCHEMA_VERSION:
        fail("RESULT_SCHEMA_MISMATCH", "comparison result schema is unsupported")
    _verify_seal(result, "resultDigest", RESULT_DIGEST_DOMAIN, "RESULT_DIGEST_MISMATCH")
    return result, resolved


def _verified_answer_key(
    path: Path, result: dict[str, Any], board_sha256: str
) -> tuple[dict[str, Any], Path]:
    key, resolved = _read_json(path, "answer key")
    _exact_object(
        key,
        {"schemaVersion", "authority", "protocolDigest", "boardSha256", "blindingNonce", "mapping", "rowMapping", "instruction", "answerKeyDigest"},
        "INVALID_ANSWER_KEY_KEYS",
        "answer key",
    )
    if key.get("schemaVersion") != ANSWER_KEY_SCHEMA_VERSION:
        fail("ANSWER_KEY_SCHEMA_MISMATCH", "answer key schema is unsupported")
    _verify_seal(key, "answerKeyDigest", ANSWER_KEY_DIGEST_DOMAIN, "ANSWER_KEY_DIGEST_MISMATCH")
    _sha256(key["blindingNonce"], "answer key blindingNonce")
    expected = result["humanReviewArtifacts"]["answerKeySha256"]
    payload, _ = _read_stable_bytes(resolved, MAX_JSON_BYTES, "answer key")
    if _sha256_bytes(payload) != expected:
        fail("ANSWER_KEY_FILE_MISMATCH", "answer key file does not match the result receipt")
    if key["protocolDigest"] != result["protocolDigest"] or key["boardSha256"] != board_sha256:
        fail("ANSWER_KEY_BINDING_MISMATCH", "answer key does not bind this result and board")
    return key, resolved


def _verified_board(path: Path, result: dict[str, Any]) -> tuple[bytes, Path]:
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        fail("REVIEW_BOARD_NOT_READABLE", f"review board cannot be resolved: {error}")
    payload, _ = _read_stable_bytes(resolved, MAX_IMAGE_BYTES, "review board")
    if _sha256_bytes(payload) != result["humanReviewArtifacts"]["boardSha256"]:
        fail("REVIEW_BOARD_MISMATCH", "review board does not match the result receipt")
    return payload, resolved


def _review_row(value: Any, label: str) -> dict[str, Any]:
    keys = {
        "reviewRowId", "preference", "materiallyVisible", "confidence",
        "artifactFlags", "notes",
    }
    raw = _exact_object(value, keys, "INVALID_REVIEW_ROW_KEYS", label)
    preference = raw["preference"]
    if preference not in {"A", "B", "tie", "not_assessable"}:
        fail("INVALID_REVIEW_VALUE", f"{label}.preference is unsupported")
    if raw["materiallyVisible"] not in {"yes", "no", "not_assessable"}:
        fail("INVALID_REVIEW_VALUE", f"{label}.materiallyVisible is unsupported")
    if raw["confidence"] not in {"low", "medium", "high"}:
        fail("INVALID_REVIEW_VALUE", f"{label}.confidence is unsupported")
    flags = _review_flags(raw["artifactFlags"], f"{label}.artifactFlags")
    if not isinstance(raw["notes"], str) or len(raw["notes"]) > 1000:
        fail("INVALID_REVIEW_VALUE", f"{label}.notes must be a string no longer than 1000 characters")
    return {
        "reviewRowId": _safe_id(raw["reviewRowId"], f"{label}.reviewRowId"),
        "preference": preference,
        "materiallyVisible": raw["materiallyVisible"],
        "confidence": raw["confidence"],
        "artifactFlags": flags,
        "notes": raw["notes"],
    }


def _review_flags(value: Any, label: str) -> list[str]:
    allowed = {"none", "ghosting", "blur", "colour_shift", "geometry_mismatch", "lighting_mismatch"}
    if not isinstance(value, list) or not value:
        fail("INVALID_REVIEW_VALUE", f"{label} must be a non-empty array")
    flags = [_safe_id(item, f"{label}[{index}]") for index, item in enumerate(value)]
    if len(flags) != len(set(flags)) or not set(flags).issubset(allowed):
        fail("INVALID_REVIEW_VALUE", f"{label} contains a duplicate or unsupported flag")
    if "none" in flags and len(flags) != 1:
        fail("INVALID_REVIEW_VALUE", f"{label} cannot combine none with an artifact")
    return sorted(flags)


def _expected_review_rows(result: dict[str, Any]) -> set[str]:
    count = sum(len(view["regions"]) for view in result["views"])
    return {_review_row_id(index) for index in range(count)}


def _validate_completed_review(raw: dict[str, Any], result: dict[str, Any], board_sha256: str, board: bytes) -> dict[str, Any]:
    keys = {
        "schemaVersion", "authority", "resultDigest", "protocolDigest", "boardSha256",
        "reviewerId", "deviceModel", "displayWidthPixels", "displayHeightPixels",
        "displayCalibration", "viewingDistanceCentimetres", "zoomPercent",
        "boardDisplayedAtNativePixels", "rows",
    }
    review = _exact_object(raw, keys, "INVALID_REVIEW_KEYS", "completed review")
    _validate_review_header(review, result, board_sha256, board)
    if not isinstance(review["rows"], list):
        fail("INVALID_REVIEW", "completed review rows must be an array")
    rows = [_review_row(item, f"rows[{index}]") for index, item in enumerate(review["rows"])]
    identities = [row["reviewRowId"] for row in rows]
    if len(identities) != len(set(identities)) or set(identities) != _expected_review_rows(result):
        fail("REVIEW_ROW_SET_MISMATCH", "completed review rows must cover every frozen region exactly once")
    return {
        **{key: review[key] for key in keys - {"rows"}},
        "reviewerId": _safe_id(review["reviewerId"], "reviewerId"),
        "deviceModel": _nonempty_text(review["deviceModel"], "deviceModel", 200),
        "rows": rows,
    }


def _validate_review_header(review: dict[str, Any], result: dict[str, Any], board_sha256: str, board: bytes) -> None:
    if review["schemaVersion"] != REVIEW_INPUT_SCHEMA_VERSION or review["authority"] != "human_observation_only":
        fail("REVIEW_HEADER_MISMATCH", "completed review header is invalid")
    bindings = {"resultDigest": result["resultDigest"], "protocolDigest": result["protocolDigest"], "boardSha256": board_sha256}
    if any(review[key] != expected for key, expected in bindings.items()):
        fail("REVIEW_BINDING_MISMATCH", "completed review does not bind this result and board")
    display_width = _positive_integer(review["displayWidthPixels"], 100_000, "displayWidthPixels")
    display_height = _positive_integer(review["displayHeightPixels"], 100_000, "displayHeightPixels")
    with Image.open(BytesIO(board)) as opened:
        board_width, board_height = opened.size
    if display_width < board_width or display_height < board_height:
        fail("REVIEW_DISPLAY_TOO_SMALL", "display cannot show the complete board at native pixels")
    distance = _finite_number(review["viewingDistanceCentimetres"], "viewingDistanceCentimetres")
    if not 30.0 <= distance <= 150.0:
        fail("INVALID_REVIEW_VALUE", "viewingDistanceCentimetres must be between 30 and 150")
    if review["displayCalibration"] not in {"calibrated", "not_calibrated", "unknown"}:
        fail("INVALID_REVIEW_VALUE", "displayCalibration is unsupported")
    if review["zoomPercent"] != 100 or not isinstance(review["boardDisplayedAtNativePixels"], bool):
        fail("INVALID_REVIEW_VALUE", "zoomPercent must be 100 and native-pixel display must be explicitly recorded")


def _nonempty_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        fail("INVALID_REVIEW_VALUE", f"{label} must be non-empty and no longer than {maximum} characters")
    return value


def _human_observation(result: dict[str, Any], review: dict[str, Any], answer_key: dict[str, Any]) -> tuple[str | None, str]:
    if result["purpose"] == "source_view_diagnostic":
        return None, "review_recorded_source_diagnostic_only"
    display_ok = review["displayCalibration"] == "calibrated" and review["boardDisplayedAtNativePixels"] is True
    preferences = {row["preference"] for row in review["rows"]}
    material = all(row["materiallyVisible"] == "yes" for row in review["rows"])
    evidence_ok = all(row["confidence"] == "high" and row["artifactFlags"] == ["none"] for row in review["rows"])
    assessable = preferences.issubset({"A", "B"}) and len(preferences) == 1
    if not display_ok or not material or not evidence_ok or not assessable:
        return None, "review_recorded_gate_open"
    label = next(iter(preferences))
    observed = answer_key["mapping"][label]
    decision = result["decision"]
    if decision["status"] != "directional_lead_requires_human_review":
        return None, "review_recorded_no_machine_signal_gate_open"
    if observed != decision["candidateDirectionalLead"]:
        return None, "review_recorded_disagreement_gate_open"
    return observed, "review_recorded_directional_observation_only"


def record_review(
    result_path: Path,
    board_path: Path,
    answer_key_path: Path,
    completed_review_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    result, resolved_result = _verified_result(result_path)
    board, resolved_board = _verified_board(board_path, result)
    board_sha256 = _sha256_bytes(board)
    answer_key, resolved_key = _verified_answer_key(answer_key_path, result, board_sha256)
    raw_review, resolved_review = _read_json(completed_review_path, "completed review")
    review = _validate_completed_review(raw_review, result, board_sha256, board)
    observation, status = _human_observation(result, review, answer_key)
    document = _review_receipt_document(result, board_sha256, answer_key, review, observation, status)
    sealed = _seal(document, "reviewReceiptDigest", REVIEW_DIGEST_DOMAIN)
    payload = (json.dumps(sealed, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    protected = {resolved_result, resolved_board, resolved_key, resolved_review}
    _write_create_only(output_path, payload, protected, "human review receipt")
    return sealed


def _review_receipt_document(
    result: dict[str, Any],
    board_sha256: str,
    answer_key: dict[str, Any],
    review: dict[str, Any],
    observation: str | None,
    status: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": REVIEW_RECEIPT_SCHEMA_VERSION,
        "status": status,
        "authority": "human_observation_only",
        "resultDigest": result["resultDigest"],
        "protocolDigest": result["protocolDigest"],
        "boardSha256": board_sha256,
        "answerKeyDigest": answer_key["answerKeyDigest"],
        "completedReview": review,
        "humanDirectionalObservation": observation,
        "productWinner": None,
        "physicalApproval": False,
        "commercialApproval": False,
        "runtimePromotionAuthorized": False,
        "reason": "A blinded human observation is one gate only; movement, devices, rights, physical controls, and product approval remain separate.",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Freeze or score a same-camera source-photo comparison")
    subparsers = parser.add_subparsers(dest="command", required=True)
    freeze = subparsers.add_parser("freeze-protocol")
    freeze.add_argument("--draft", type=Path, required=True)
    freeze.add_argument("--output", type=Path, required=True)
    verify = subparsers.add_parser("verify-protocol")
    verify.add_argument("--protocol", type=Path, required=True)
    score = subparsers.add_parser("score")
    score.add_argument("--protocol", type=Path, required=True)
    score.add_argument("--run", type=Path, required=True)
    score.add_argument("--output", type=Path, required=True)
    score.add_argument("--review-board", type=Path)
    score.add_argument("--review-template", type=Path)
    score.add_argument("--answer-key", type=Path)
    score.add_argument("--review-form", type=Path)
    review = subparsers.add_parser("record-review")
    review.add_argument("--result", type=Path, required=True)
    review.add_argument("--review-board", type=Path, required=True)
    review.add_argument("--answer-key", type=Path, required=True)
    review.add_argument("--completed-review", type=Path, required=True)
    review.add_argument("--output", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "freeze-protocol":
            document = freeze_protocol(args.draft, args.output)
            summary = {"status": document["status"], "protocolDigest": document["protocolDigest"], "authority": "none"}
        elif args.command == "verify-protocol":
            document = verify_protocol_file(args.protocol)
            summary = {
                "status": "protocol_verified_authority_none",
                "protocolDigest": document["protocolDigest"],
                "viewCount": len(document["views"]),
                "candidateIds": document["candidateIds"],
                "authority": "none",
            }
        elif args.command == "score":
            document = evaluate_run(
                args.protocol,
                args.run,
                args.output,
                args.review_board,
                args.review_template,
                args.answer_key,
                args.review_form,
            )
            summary = {"status": document["decision"]["status"], "candidateDirectionalLead": document["decision"]["candidateDirectionalLead"], "productWinner": None, "authority": "none"}
        else:
            document = record_review(
                args.result,
                args.review_board,
                args.answer_key,
                args.completed_review,
                args.output,
            )
            summary = {
                "status": document["status"],
                "humanDirectionalObservation": document["humanDirectionalObservation"],
                "productWinner": None,
                "authority": "human_observation_only",
            }
        print(json.dumps(summary, sort_keys=True))
        return 0
    except SourceComparisonError as error:
        print(json.dumps({"status": "error", "code": error.code, "message": error.message}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
