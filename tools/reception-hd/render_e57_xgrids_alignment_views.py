#!/usr/bin/env python3
"""Build a private, authority-none E57/XGRIDS visual alignment diagnosis.

The program deliberately does less than a registration or release tool.  It
uses geometry only, keeps the frozen test-station geometry undecoded, fits a fixed-scale
Z-up yaw transform on the development stations, and creates a deterministic
set of labelled PNG views plus a tamper-evident manifest.  The package cannot
complete T-505, start training, alter runtime state, publish, or grant rights.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.metadata
import importlib.util
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tempfile
from typing import Any, Iterable, Mapping, Sequence


EXPECTED_T515_FILE_SHA256 = (
    "c87aa8a4c96c9e86601013b41287b2019556b384fc868b206cfdb95759afdba2"
)
EXPECTED_T515_INTERNAL_SHA256 = (
    "3f05ef356b6edaf41ed5464b9b875d2881758d4118fc6ef0533cafd03c00bd93"
)
EXPECTED_E57_SHA256 = "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd"
EXPECTED_STAGE_MANIFEST_SHA256 = "c044823c232dae518df84140c90004a1c17dc682c84885d6f36848933d72ddff"
EXPECTED_RECEPTION_EVIDENCE_SHA256 = "aba2f18be28e38ece5d5f67f2f64172f2134a36768dfe92772262674f8ea0b32"
EXPECTED_XGRIDS_PLY_SHA256 = "da8efa94895ef7aa2c6024336278d855fdb13026bf10028901c3ac46d1e91a3d"
EXPECTED_XGRIDS_POSES_SHA256 = "d9822320412473bf8dd4681910abf395b2957a1d24612064354944fe8581881f"
T515_SCHEMA = "omnitwin.reception.e57-xgrids-alignment-diagnostic.v1"
T515_DOMAIN = b"OMNITWIN_RECEPTION_E57_XGRIDS_ALIGNMENT_V1\0"
PACKAGE_SCHEMA = "omnitwin.reception.e57-xgrids-visual-diagnostic.v1"
PACKAGE_DOMAIN = b"OMNITWIN_RECEPTION_E57_XGRIDS_VISUAL_DIAGNOSTIC_V1\0"

FIT_SCAN_IDS = (124, 125, 127, 128, 130, 132, 133, 135, 136, 137, 139, 142, 143, 144)
VALIDATION_SCAN_IDS = (131, 134, 138)
TEST_SCAN_IDS = (126, 129, 141)
BOUNDARY_SCAN_IDS = (122, 123, 140)
REAL_CONTEXT_BOUNDARY_SCAN_IDS = (122,)

DISTANCE_BINS_METERS = (0.05, 0.10, 0.25)
MIN_POINTS = 8
MAX_RENDER_POINTS = 180_000


class OverlayError(RuntimeError):
    """Stable refusal raised for unsafe or invalid diagnostic requests."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def fail(code: str, message: str) -> None:
    raise OverlayError(code, message)


def _is_link_like(path: Path) -> bool:
    try:
        details = path.lstat()
    except OSError as error:
        fail("PATH_STAT_FAILED", f"could not inspect {path}: {error}")
    attributes = getattr(details, "st_file_attributes", 0)
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    return path.is_symlink() or bool(attributes & reparse)


def _assert_no_link_ancestors(path: Path, label: str) -> None:
    selected = Path(path).expanduser()
    absolute = selected if selected.is_absolute() else Path.cwd() / selected
    chain: list[Path] = []
    cursor = absolute
    while True:
        chain.append(cursor)
        if cursor.parent == cursor:
            break
        cursor = cursor.parent
    for ancestor in reversed(chain):
        if ancestor.exists() and _is_link_like(ancestor):
            fail("LINK_ANCESTOR_FORBIDDEN", f"{label} crosses link or junction {ancestor.name}")


def _canonical_json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        fail("NON_CANONICAL_JSON", "value cannot be represented as canonical JSON")
        raise AssertionError from error


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        fail("READ_FAILED", f"could not hash {path.name}: {error}")
    return digest.hexdigest()


def _strict_json_bytes(payload: bytes, label: str) -> dict[str, Any]:
    def pairs_hook(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                fail("DUPLICATE_JSON_KEY", f"{label} repeats JSON key {key!r}")
            result[key] = value
        return result

    def reject_constant(value: str) -> Any:
        fail("NONFINITE_JSON", f"{label} contains non-finite token {value}")

    try:
        parsed = json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=pairs_hook,
            parse_constant=reject_constant,
        )
    except OverlayError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail("INVALID_JSON", f"{label} is not strict UTF-8 JSON: {error}")
    if not isinstance(parsed, dict):
        fail("INVALID_JSON_ROOT", f"{label} root must be an object")
    _canonical_json_bytes(parsed)
    return parsed


def _verify_t515_document(document: dict[str, Any]) -> dict[str, Any]:
    receipt = document.get("receipt")
    if not isinstance(receipt, dict):
        fail("T515_RECEIPT_MISSING", "T-515 receipt object is missing")
    embedded = receipt.get("sha256")
    unsigned = copy.deepcopy(document)
    unsigned.pop("receipt", None)
    computed = _sha256_bytes(T515_DOMAIN + _canonical_json_bytes(unsigned))
    if embedded != computed:
        fail("T515_INTERNAL_DIGEST_INVALID", "T-515 canonical self-digest does not match")
    if computed != EXPECTED_T515_INTERNAL_SHA256:
        fail("T515_INTERNAL_PIN_MISMATCH", "T-515 internal receipt is not the pinned real run")
    required = {
        "authority": "none",
        "schemaVersion": T515_SCHEMA,
        "status": "diagnostic_complete_t505_blocked",
        "mode": "diagnose",
    }
    for key, expected in required.items():
        if document.get(key) != expected:
            fail("T515_POSTURE_MISMATCH", f"T-515 {key} is not {expected!r}")
    scope = document.get("scope")
    if not isinstance(scope, dict):
        fail("T515_SCOPE_MISSING", "T-515 frozen scan scope is missing")
    frozen = {
        "frozenFitScanIds": list(FIT_SCAN_IDS),
        "frozenValidationScanIds": list(VALIDATION_SCAN_IDS),
        "frozenTestScanIdsNotReadOrUsed": list(TEST_SCAN_IDS),
        "quarantinedOrBoundaryScanIdsNotFitOrValidated": list(BOUNDARY_SCAN_IDS),
    }
    for key, expected in frozen.items():
        if scope.get(key) != expected:
            fail("T515_SCOPE_MISMATCH", f"T-515 {key} changed")
    eligibility = document.get("t505Eligibility")
    if isinstance(eligibility, dict) and any(
        eligibility.get(key) is not False
        for key in (
            "eligibleForT505Completion",
            "eligibleForT502Training",
            "eligibleForRuntimeOrPublicUse",
        )
    ):
        fail("T515_ELIGIBILITY_MISMATCH", "T-515 is not permanently blocked")
    return document


def verify_t515_receipt(path: Path) -> dict[str, Any]:
    selected = Path(path)
    _assert_no_link_ancestors(selected, "T-515 receipt")
    try:
        before = selected.lstat()
        if not selected.is_file() or _is_link_like(selected):
            fail("UNSAFE_T515_RECEIPT", "T-515 receipt must be a regular non-link file")
        payload = selected.read_bytes()
        after = selected.lstat()
    except OSError as error:
        fail("T515_READ_FAILED", f"could not read T-515 receipt: {error}")
    before_identity = (
        before.st_size,
        before.st_mtime_ns,
        getattr(before, "st_ino", None),
        getattr(before, "st_dev", None),
    )
    after_identity = (
        after.st_size,
        after.st_mtime_ns,
        getattr(after, "st_ino", None),
        getattr(after, "st_dev", None),
    )
    if before_identity != after_identity:
        fail("T515_CHANGED_DURING_READ", "T-515 receipt changed while it was read")
    if _sha256_bytes(payload) != EXPECTED_T515_FILE_SHA256:
        fail("T515_FILE_PIN_MISMATCH", "T-515 whole-file SHA-256 is not the pinned real run")
    return _verify_t515_document(_strict_json_bytes(payload, "T-515 receipt"))


def _points(value: Any, label: str, np: Any) -> Any:
    array = np.asarray(value, dtype=np.float64)
    if array.ndim != 2 or array.shape[1] != 3 or int(array.shape[0]) < MIN_POINTS:
        fail("INVALID_POINTS", f"{label} must be a finite Nx3 array with at least {MIN_POINTS} rows")
    if not bool(np.all(np.isfinite(array))):
        fail("NONFINITE_POINTS", f"{label} contains NaN or infinity")
    return array


def _deterministic_indices(count: int, limit: int, seed: str) -> list[int]:
    if count <= 0 or limit <= 0:
        return []
    selected = min(count, limit)
    if selected == count:
        return list(range(count))
    digest = hashlib.sha256(
        seed.encode("utf-8") + b"\0" + str(count).encode() + b"\0" + str(limit).encode()
    ).digest()
    start = int.from_bytes(digest[:8], "big") % count
    step = 1 + int.from_bytes(digest[8:16], "big") % (count - 1)
    while math.gcd(step, count) != 1:
        step = 1 if step + 1 >= count else step + 1
    return [(start + index * step) % count for index in range(selected)]


def _sample(points: Any, limit: int, seed: str, np: Any) -> Any:
    return points[_deterministic_indices(int(points.shape[0]), limit, seed)]


def _yaw_rotation(angle: float, np: Any) -> Any:
    cosine = math.cos(angle)
    sine = math.sin(angle)
    return np.asarray(
        [[cosine, -sine, 0.0], [sine, cosine, 0.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )


def _solve_ordered_yaw(source: Any, target: Any, np: Any) -> tuple[Any, Any, float]:
    source_xy = source[:, :2]
    target_xy = target[:, :2]
    source_center = np.mean(source_xy, axis=0)
    target_center = np.mean(target_xy, axis=0)
    covariance = (source_xy - source_center).T @ (target_xy - target_center)
    u, _, vt = np.linalg.svd(covariance)
    rotation_2d = vt.T @ u.T
    if float(np.linalg.det(rotation_2d)) < 0.0:
        vt[-1, :] *= -1.0
        rotation_2d = vt.T @ u.T
    angle = math.atan2(float(rotation_2d[1, 0]), float(rotation_2d[0, 0]))
    rotation = _yaw_rotation(angle, np)
    translation_xy = target_center - rotation_2d @ source_center
    translation_z = float(np.median(target[:, 2] - source[:, 2]))
    translation = np.asarray([translation_xy[0], translation_xy[1], translation_z])
    residual = source @ rotation.T + translation - target
    return rotation, translation, float(np.max(np.linalg.norm(residual, axis=1)))


def _structural_slice(points: Any, np: Any) -> tuple[Any, tuple[float, float]]:
    low, high = [float(value) for value in np.quantile(points[:, 2], [0.02, 0.98])]
    span = high - low
    inset = min(0.45, max(0.02, span * 0.18))
    selected = points[(points[:, 2] > low + inset) & (points[:, 2] < high - inset)]
    if int(selected.shape[0]) < MIN_POINTS:
        selected = points
    return selected, (low, high)


def _pca_angle_xy(points: Any, np: Any) -> float:
    centered = points[:, :2] - np.median(points[:, :2], axis=0)
    covariance = np.cov(centered.T)
    values, vectors = np.linalg.eigh(covariance)
    direction = vectors[:, int(np.argmax(values))]
    return math.atan2(float(direction[1]), float(direction[0]))


def _xy_conditioning(points: Any, label: str, np: Any) -> dict[str, float]:
    centered = points[:, :2] - np.mean(points[:, :2], axis=0)
    singular = np.linalg.svd(centered, compute_uv=False)
    if singular.size != 2 or float(singular[0]) <= 1e-9:
        fail("DEGENERATE_XY_GEOMETRY", f"{label} has no usable XY spread")
    ratio = float(singular[1] / singular[0])
    if ratio < 1e-4:
        fail("DEGENERATE_XY_GEOMETRY", f"{label} is too close to a line for yaw fitting")
    return {
        "largestSingularValue": float(singular[0]),
        "smallestSingularValue": float(singular[1]),
        "smallestToLargestRatio": ratio,
    }


def _absolute_yaw_update(source: Any, matched: Any, np: Any) -> tuple[Any, Any, float]:
    source_center = np.mean(source[:, :2], axis=0)
    target_center = np.mean(matched[:, :2], axis=0)
    covariance = (source[:, :2] - source_center).T @ (matched[:, :2] - target_center)
    u, _, vt = np.linalg.svd(covariance)
    rotation_2d = vt.T @ u.T
    if float(np.linalg.det(rotation_2d)) < 0.0:
        vt[-1, :] *= -1.0
        rotation_2d = vt.T @ u.T
    angle = math.atan2(float(rotation_2d[1, 0]), float(rotation_2d[0, 0]))
    translation_xy = target_center - rotation_2d @ source_center
    translation_z = float(np.median(matched[:, 2] - source[:, 2]))
    return _yaw_rotation(angle, np), translation_xy, translation_z


def fit_gravity_yaw(
    source: Any,
    target: Any,
    np: Any,
    cKDTree: Any,
    maximum_iterations: int = 50,
) -> tuple[Any, Any, dict[str, Any]]:
    """Fit a proper yaw-only transform with scale exactly one and +Z preserved."""

    source = _points(source, "gravity source", np)
    target = _points(target, "gravity target", np)
    if not isinstance(maximum_iterations, int) or not 1 <= maximum_iterations <= 200:
        fail("INVALID_ITERATIONS", "maximum_iterations must be an integer from 1 to 200")
    source_conditioning = _xy_conditioning(source, "gravity source", np)
    target_conditioning = _xy_conditioning(target, "gravity target", np)

    # Exact ordered correspondences are used only when they prove themselves by
    # producing a near-zero residual.  This makes synthetic controls decisive
    # without assuming that unrelated real point files share record order.
    if source.shape == target.shape:
        ordered_rotation, ordered_translation, ordered_maximum = _solve_ordered_yaw(
            source, target, np
        )
        scale = max(1.0, float(np.linalg.norm(np.ptp(target, axis=0))))
        if ordered_maximum <= 1e-8 * scale:
            return ordered_rotation, ordered_translation, {
                "method": "proved ordered-correspondence yaw solution",
                "fixedScale": 1.0,
                "gravityConstrained": True,
                "positiveZUpPreserved": True,
                "mappedUpAxisDotTargetUpAxis": 1.0,
                "determinantRotation": 1.0,
                "yawDegrees": math.degrees(
                    math.atan2(ordered_rotation[1, 0], ordered_rotation[0, 0])
                ),
                "iterationCount": 0,
                "orderedMaximumResidualMeters": ordered_maximum,
                "yawFamilyUnambiguous": True,
                "yawFamilyAmbiguityReason": "ordered correspondences prove the exact yaw on this control",
                "xyConditioning": {
                    "source": source_conditioning,
                    "target": target_conditioning,
                },
            }

    source_fit = _sample(source, 40_000, "gravity-source", np)
    target_fit = _sample(target, 80_000, "gravity-target", np)
    source_structure, source_z = _structural_slice(source_fit, np)
    target_structure, target_z = _structural_slice(target_fit, np)
    source_structure = _sample(source_structure, 40_000, "gravity-source-structure", np)
    target_structure = _sample(target_structure, 80_000, "gravity-target-structure", np)
    base_angle = _pca_angle_xy(target_structure, np) - _pca_angle_xy(source_structure, np)
    target_tree_xy = cKDTree(target_structure[:, :2])
    vertical_translation = (
        (target_z[0] + target_z[1]) - (source_z[0] + source_z[1])
    ) / 2.0
    candidates: list[tuple[float, float, Any, Any, int]] = []

    for quarter_turn in range(4):
        angle = base_angle + quarter_turn * math.pi / 2.0
        rotation = _yaw_rotation(angle, np)
        translation_xy = np.median(target_structure[:, :2], axis=0) - (
            rotation[:2, :2] @ np.median(source_structure[:, :2], axis=0)
        )
        used_iterations = 0
        for iteration in range(min(maximum_iterations, 40)):
            transformed_xy = source_structure[:, :2] @ rotation[:2, :2].T + translation_xy
            distances, nearest = target_tree_xy.query(transformed_xy, k=1, workers=1)
            cutoff = float(np.quantile(distances, 0.70, method="linear"))
            keep = distances <= cutoff
            if int(np.count_nonzero(keep)) < MIN_POINTS:
                break
            updated_rotation, updated_xy, _ = _absolute_yaw_update(
                source_structure[keep], target_structure[nearest[keep]], np
            )
            delta = float(np.linalg.norm(updated_rotation - rotation)) + float(
                np.linalg.norm(updated_xy - translation_xy)
            )
            rotation = updated_rotation
            translation_xy = updated_xy
            used_iterations = iteration + 1
            if delta <= 1e-10:
                break
        transformed_xy = source_structure[:, :2] @ rotation[:2, :2].T + translation_xy
        forward = target_tree_xy.query(transformed_xy, k=1, workers=1)[0]
        reverse = cKDTree(transformed_xy).query(target_structure[:, :2], k=1, workers=1)[0]
        forward = np.sort(forward)[: max(1, int(math.floor(forward.size * 0.95)))]
        reverse = np.sort(reverse)[: max(1, int(math.floor(reverse.size * 0.95)))]
        score = float(np.sqrt(np.mean(np.concatenate((forward, reverse)) ** 2)))
        tie = math.atan2(float(rotation[1, 0]), float(rotation[0, 0])) % (2 * math.pi)
        translation = np.asarray(
            [translation_xy[0], translation_xy[1], vertical_translation], dtype=np.float64
        )
        candidates.append((score, tie, rotation, translation, used_iterations))

    candidates.sort(key=lambda row: (row[0], row[1]))
    score, _, rotation, translation, structure_iterations = candidates[0]
    runner_up_score = float(candidates[1][0])
    yaw_margin = runner_up_score - float(score)
    yaw_unambiguous = runner_up_score >= max(float(score) + 1e-6, float(score) * 1.05)
    target_tree = cKDTree(target_fit)
    refinement_iterations = 0
    for iteration in range(maximum_iterations):
        transformed = source_fit @ rotation.T + translation
        distances, nearest = target_tree.query(transformed, k=1, workers=1)
        cutoff = float(np.quantile(distances, 0.75, method="linear"))
        keep = distances <= cutoff
        if int(np.count_nonzero(keep)) < MIN_POINTS:
            break
        updated_rotation, updated_xy, updated_z = _absolute_yaw_update(
            source_fit[keep], target_fit[nearest[keep]], np
        )
        updated_translation = np.asarray(
            [updated_xy[0], updated_xy[1], updated_z], dtype=np.float64
        )
        delta = float(np.linalg.norm(updated_rotation - rotation)) + float(
            np.linalg.norm(updated_translation - translation)
        )
        rotation = updated_rotation
        translation = updated_translation
        refinement_iterations = iteration + 1
        if delta <= 1e-10:
            break

    determinant = float(np.linalg.det(rotation))
    up_dot = float(rotation[2, 2])
    if abs(determinant - 1.0) > 1e-10 or abs(up_dot - 1.0) > 1e-12:
        fail("GRAVITY_CONSTRAINT_DRIFT", "yaw fit left the proper +Z-up family")
    return rotation, translation, {
        "method": (
            "four PCA yaw families; central-height 2D trimmed ICP; full 3D yaw-only trimmed refinement"
        ),
        "fixedScale": 1.0,
        "gravityConstrained": True,
        "positiveZUpPreserved": True,
        "upAxisAssumption": "XGRIDS +Z and E57 +Z are assumed to be the same physical up direction",
        "independentGravityMeasurement": False,
        "mappedUpAxisDotTargetUpAxis": up_dot,
        "determinantRotation": determinant,
        "yawDegrees": math.degrees(math.atan2(rotation[1, 0], rotation[0, 0])),
        "translationMeters": [float(value) for value in translation],
        "structuralInitializationTrimmed95RmseMeters": score,
        "runnerUpYawFamilyTrimmed95RmseMeters": runner_up_score,
        "yawFamilyMarginMeters": yaw_margin,
        "yawFamilyUnambiguous": yaw_unambiguous,
        "yawFamilyAmbiguityRule": "runner-up must be at least 5% and 1 micrometre worse than the selected family",
        "structuralIterationCount": structure_iterations,
        "refinementIterationCount": refinement_iterations,
        "candidateYawFamilyCount": 4,
        "xyConditioning": {
            "source": source_conditioning,
            "target": target_conditioning,
        },
    }


def distance_bin_counts(distances: Any, np: Any) -> dict[str, int]:
    values = np.asarray(distances, dtype=np.float64)
    if values.ndim != 1 or int(values.size) == 0:
        fail("INVALID_DISTANCES", "distance array must be a non-empty vector")
    if not bool(np.all(np.isfinite(values))) or bool(np.any(values < 0.0)):
        fail("INVALID_DISTANCES", "distances must be finite and non-negative")
    return {
        "le_0_05_m": int(np.count_nonzero(values <= 0.05)),
        "gt_0_05_le_0_10_m": int(np.count_nonzero((values > 0.05) & (values <= 0.10))),
        "gt_0_10_le_0_25_m": int(np.count_nonzero((values > 0.10) & (values <= 0.25))),
        "gt_0_25_m": int(np.count_nonzero(values > 0.25)),
    }


def _statistics(values: Any, np: Any) -> dict[str, Any]:
    array = np.asarray(values, dtype=np.float64)
    sorted_values = np.sort(array)
    retained = sorted_values[: max(1, int(math.floor(sorted_values.size * 0.95)))]
    return {
        "count": int(array.size),
        "meanMeters": float(np.mean(array)),
        "medianMeters": float(np.median(array)),
        "rmseMeters": float(np.sqrt(np.mean(array * array))),
        "p95Meters": float(np.quantile(array, 0.95, method="linear")),
        "maximumMeters": float(np.max(array)),
        "trimmed95Percent": {
            "retainedCount": int(retained.size),
            "rmseMeters": float(np.sqrt(np.mean(retained * retained))),
            "maximumMeters": float(np.max(retained)),
        },
        "fixedDistanceBins": distance_bin_counts(array, np),
    }


def _bidirectional(
    source: Any, target: Any, rotation: Any, translation: Any, np: Any, cKDTree: Any
) -> tuple[dict[str, Any], Any, Any, Any]:
    transformed = source @ rotation.T + translation
    source_to_target = cKDTree(target).query(transformed, k=1, workers=1)[0]
    target_to_source = cKDTree(transformed).query(target, k=1, workers=1)[0]
    return (
        {
            "xgridsGaussianCentresToE57LaserGeometry": _statistics(source_to_target, np),
            "e57LaserGeometryToXgridsGaussianCentres": _statistics(target_to_source, np),
            "directionsKeptSeparate": True,
            "distanceMeaning": (
                "XGRIDS to E57 asks whether appearance-primitives lie near a laser measurement; "
                "E57 to XGRIDS asks whether laser-measured geometry has a nearby appearance primitive."
            ),
        },
        transformed,
        source_to_target,
        target_to_source,
    )


def _safe_member_path(raw: str) -> PurePosixPath:
    if not isinstance(raw, str) or not raw or "\\" in raw:
        fail("UNSAFE_PACKAGE_MEMBER", "package member must be a non-empty POSIX path")
    selected = PurePosixPath(raw)
    if selected.is_absolute() or ".." in selected.parts or "." in selected.parts:
        fail("UNSAFE_PACKAGE_MEMBER", f"unsafe package member {raw!r}")
    if any(not part or ":" in part or "\x00" in part for part in selected.parts):
        fail("UNSAFE_PACKAGE_MEMBER", f"unsafe package member {raw!r}")
    return selected


def _write_package_create_only(
    output_dir: Path,
    files: Mapping[str, bytes],
    *,
    _write_hook: Any | None = None,
) -> None:
    output = Path(output_dir)
    if output.exists() or output.is_symlink():
        fail("OUTPUT_EXISTS", "output package directory already exists")
    if not files or "manifest.json" not in files:
        fail("PACKAGE_MANIFEST_MISSING", "package must include manifest.json")
    members = {str(_safe_member_path(name)): bytes(payload) for name, payload in files.items()}
    _assert_no_link_ancestors(output.parent, "output package")
    try:
        parent = output.parent.resolve(strict=True)
    except OSError as error:
        fail("OUTPUT_PARENT_MISSING", f"output parent must already exist: {error}")
    if not parent.is_dir() or parent.is_symlink():
        fail("UNSAFE_OUTPUT_PARENT", "output parent must be a real directory")
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}.", suffix=".private-tmp", dir=parent))
    published = False
    try:
        for relative in sorted(members):
            member = staging.joinpath(*PurePosixPath(relative).parts)
            member.parent.mkdir(parents=True, exist_ok=True)
            with member.open("xb") as target:
                if _write_hook is None:
                    target.write(members[relative])
                else:
                    _write_hook(target, members[relative])
                target.flush()
                os.fsync(target.fileno())
        try:
            descriptor = os.open(staging, os.O_RDONLY)
        except OSError:
            descriptor = None
        if descriptor is not None:
            try:
                os.fsync(descriptor)
            except OSError:
                pass
            finally:
                os.close(descriptor)
        os.rename(staging, output)
        published = True
    except FileExistsError:
        fail("OUTPUT_EXISTS", "another process created the package first")
    except OverlayError:
        raise
    except OSError as error:
        fail("PACKAGE_WRITE_FAILED", f"could not create package: {error}")
    finally:
        if not published:
            shutil.rmtree(staging, ignore_errors=True)


def _load_pillow() -> tuple[Any, Any, Any]:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as error:
        fail("PILLOW_UNAVAILABLE", "visual package generation requires Pillow")
        raise AssertionError from error
    return Image, ImageDraw, ImageFont


def _font(ImageFont: Any, size: int) -> Any:
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size=size)
    except OSError:
        return ImageFont.load_default()


def _render_runtime_evidence() -> dict[str, Any]:
    import PIL

    _, _, ImageFont = _load_pillow()
    selected = _font(ImageFont, 20)
    evidence: dict[str, Any] = {
        "pillowVersion": str(PIL.__version__),
        "fontRequest": "DejaVuSans.ttf",
        "crossMachineByteIdentityClaimed": False,
        "sameRecordedEnvironmentReplayExpected": True,
    }
    try:
        family, style = selected.getname()
        evidence["resolvedFontFamily"] = str(family)
        evidence["resolvedFontStyle"] = str(style)
    except Exception:
        evidence["resolvedFontFamily"] = "Pillow default"
        evidence["resolvedFontStyle"] = "unknown"
    raw_path = getattr(selected, "path", None)
    if isinstance(raw_path, (str, os.PathLike)) and Path(raw_path).is_file():
        path = Path(raw_path)
        evidence["resolvedFontFileName"] = path.name
        evidence["resolvedFontSha256"] = _sha256_file(path)
        evidence["resolvedFontSizeBytes"] = path.stat().st_size
    else:
        evidence["resolvedFontFileName"] = "pillow-embedded-default"
        evidence["resolvedFontSha256"] = None
        evidence["resolvedFontSizeBytes"] = None
    return evidence


BACKGROUND = (9, 14, 22)
PLOT_BACKGROUND = (13, 20, 30)
GRID = (49, 63, 79)
TEXT = (235, 241, 247)
MUTED = (164, 178, 194)
E57_CYAN = (0, 190, 255)
XGRIDS_ORANGE = (255, 126, 34)
OVERLAP_WHITE = (255, 255, 255)
BOUNDARY_PURPLE = (187, 116, 255)
DISTANCE_COLORS = (
    (48, 209, 88),
    (255, 214, 10),
    (255, 149, 0),
    (191, 90, 242),
)


def _project(points: Any, projection: str, np: Any) -> Any:
    if projection == "xy":
        return points[:, [0, 1]]
    if projection == "xz":
        return points[:, [0, 2]]
    if projection == "yz":
        return points[:, [1, 2]]
    if projection == "oblique":
        return np.column_stack(
            (
                0.7071067811865476 * points[:, 0]
                - 0.7071067811865476 * points[:, 1],
                0.3535533905932738 * points[:, 0]
                + 0.3535533905932738 * points[:, 1]
                + 0.8660254037844386 * points[:, 2],
            )
        )
    fail("INVALID_PROJECTION", f"unknown projection {projection}")


def _projection_labels(projection: str) -> tuple[str, str]:
    return {
        "xy": ("E57 X (m)", "E57 Y (m)"),
        "xz": ("E57 X (m)", "E57 Z (m)"),
        "yz": ("E57 Y (m)", "E57 Z (m)"),
        "oblique": ("orthographic horizontal axis (m)", "orthographic vertical + depth (m)"),
    }[projection]


def _bounds(points: Any, projection: str, np: Any, margin: float = 0.15) -> list[float]:
    projected = _project(points, projection, np)
    low = np.min(projected, axis=0)
    high = np.max(projected, axis=0)
    span = np.maximum(high - low, 0.25)
    low -= span * margin
    high += span * margin
    return [float(low[0]), float(high[0]), float(low[1]), float(high[1])]


def _equal_aspect_bounds(
    raw: Sequence[float], plot_width: int, plot_height: int
) -> tuple[float, float, float, float]:
    xmin, xmax, ymin, ymax = [float(value) for value in raw]
    xspan = max(xmax - xmin, 1e-6)
    yspan = max(ymax - ymin, 1e-6)
    desired = plot_width / plot_height
    actual = xspan / yspan
    if actual < desired:
        expanded = yspan * desired
        center = (xmin + xmax) / 2.0
        xmin, xmax = center - expanded / 2.0, center + expanded / 2.0
    else:
        expanded = xspan / desired
        center = (ymin + ymax) / 2.0
        ymin, ymax = center - expanded / 2.0, center + expanded / 2.0
    return xmin, xmax, ymin, ymax


def _pixel_coordinates(
    points: Any,
    projection: str,
    bounds: Sequence[float],
    width: int,
    height: int,
    pad_left: int,
    pad_top: int,
    pad_right: int,
    pad_bottom: int,
    np: Any,
) -> tuple[Any, Any, tuple[float, float, float, float]]:
    plot_width = width - pad_left - pad_right
    plot_height = height - pad_top - pad_bottom
    xmin, xmax, ymin, ymax = _equal_aspect_bounds(bounds, plot_width, plot_height)
    projected = _project(points, projection, np)
    x = np.rint(
        pad_left + (projected[:, 0] - xmin) * (plot_width - 1) / (xmax - xmin)
    ).astype(np.int64)
    y = np.rint(
        pad_top + (ymax - projected[:, 1]) * (plot_height - 1) / (ymax - ymin)
    ).astype(np.int64)
    valid = (
        (x >= pad_left)
        & (x < width - pad_right)
        & (y >= pad_top)
        & (y < height - pad_bottom)
    )
    return x[valid], y[valid], (xmin, xmax, ymin, ymax)


def _metre_label_interval(
    low: float,
    high: float,
    pixel_span: int,
    *,
    minimum_pixel_spacing: int = 48,
) -> int:
    """Choose a readable integer-metre label interval for a plotted axis."""
    extent = float(high) - float(low)
    if not math.isfinite(extent) or extent <= 0.0:
        raise ValueError("axis bounds must be finite and increasing")
    if pixel_span <= 1 or minimum_pixel_spacing <= 0:
        raise ValueError("pixel spans and label spacing must be positive")
    required = max(1.0, extent * minimum_pixel_spacing / float(pixel_span - 1))
    magnitude = 10.0 ** math.floor(math.log10(required))
    for multiplier in (1.0, 2.0, 5.0, 10.0):
        candidate = multiplier * magnitude
        if candidate >= required:
            return max(1, int(math.ceil(candidate - 1e-12)))
    raise AssertionError("unreachable label interval selection")


def _draw_frame(
    image: Any,
    draw: Any,
    title: str,
    subtitle: str,
    projection: str,
    expanded_bounds: Sequence[float],
    ImageFont: Any,
    *,
    width: int,
    height: int,
    pad_left: int,
    pad_top: int,
    pad_right: int,
    pad_bottom: int,
) -> None:
    title_font = _font(ImageFont, 20)
    body_font = _font(ImageFont, 15)
    small_font = _font(ImageFont, 13)
    draw.text((pad_left, 12), title, fill=TEXT, font=title_font)
    draw.text((pad_left, 39), subtitle, fill=MUTED, font=small_font)
    xmin, xmax, ymin, ymax = expanded_bounds
    plot_left, plot_top = pad_left, pad_top
    plot_right, plot_bottom = width - pad_right, height - pad_bottom
    draw.rectangle((plot_left, plot_top, plot_right, plot_bottom), outline=GRID, width=1)
    x_label_interval = _metre_label_interval(xmin, xmax, plot_right - plot_left)
    start_x = math.ceil(xmin)
    for value in range(start_x, math.floor(xmax) + 1):
        x = plot_left + (value - xmin) * (plot_right - plot_left - 1) / (xmax - xmin)
        draw.line((x, plot_top, x, plot_bottom), fill=GRID, width=1)
        if value % x_label_interval == 0:
            draw.text((x + 2, plot_bottom + 4), str(value), fill=MUTED, font=small_font)
    y_label_interval = _metre_label_interval(ymin, ymax, plot_bottom - plot_top)
    start_y = math.ceil(ymin)
    for value in range(start_y, math.floor(ymax) + 1):
        y = plot_top + (ymax - value) * (plot_bottom - plot_top - 1) / (ymax - ymin)
        draw.line((plot_left, y, plot_right, y), fill=GRID, width=1)
        if value % y_label_interval == 0:
            draw.text((6, y - 7), str(value), fill=MUTED, font=small_font)
    x_label, y_label = _projection_labels(projection)
    draw.text((width // 2 - 55, height - 23), x_label, fill=MUTED, font=body_font)
    draw.text((7, pad_top - 22), y_label, fill=MUTED, font=body_font)


def _png_bytes(image: Any) -> bytes:
    target = io.BytesIO()
    image.save(target, format="PNG", optimize=False, compress_level=9)
    return target.getvalue()


def _render_overlay(
    e57_points: Any,
    xgrids_points: Any,
    np: Any,
    *,
    projection: str,
    title: str,
    subtitle: str,
    bounds: Sequence[float] | None = None,
    boundary_points: Any | None = None,
    crop_box: Sequence[Sequence[float]] | None = None,
    width: int = 1200,
    height: int = 900,
) -> bytes:
    Image, ImageDraw, ImageFont = _load_pillow()
    pad_left, pad_top, pad_right, pad_bottom = 72, 82, 24, 58
    e57 = _sample(e57_points, MAX_RENDER_POINTS, f"render-e57-{projection}", np)
    xgrids = _sample(xgrids_points, MAX_RENDER_POINTS, f"render-xgrids-{projection}", np)
    combined = np.concatenate((e57, xgrids), axis=0)
    selected_bounds = _bounds(combined, projection, np) if bounds is None else list(bounds)
    image = Image.new("RGB", (width, height), BACKGROUND)
    pixels = np.asarray(image).copy()
    pixels[pad_top : height - pad_bottom, pad_left : width - pad_right] = PLOT_BACKGROUND
    image = Image.fromarray(pixels, mode="RGB")
    draw = ImageDraw.Draw(image)
    _, _, expanded = _pixel_coordinates(
        combined,
        projection,
        selected_bounds,
        width,
        height,
        pad_left,
        pad_top,
        pad_right,
        pad_bottom,
        np,
    )
    _draw_frame(
        image,
        draw,
        title,
        subtitle,
        projection,
        expanded,
        ImageFont,
        width=width,
        height=height,
        pad_left=pad_left,
        pad_top=pad_top,
        pad_right=pad_right,
        pad_bottom=pad_bottom,
    )
    # Geometry is deliberately painted after the grid so a guide line can
    # never erase a measured evidence pixel.
    pixels = np.asarray(image).copy()
    ex, ey, expanded = _pixel_coordinates(
        e57, projection, selected_bounds, width, height, pad_left, pad_top, pad_right, pad_bottom, np
    )
    xx, xy, _ = _pixel_coordinates(
        xgrids, projection, selected_bounds, width, height, pad_left, pad_top, pad_right, pad_bottom, np
    )
    e57_mask = np.zeros((height, width), dtype=bool)
    xgrids_mask = np.zeros((height, width), dtype=bool)
    e57_mask[ey, ex] = True
    xgrids_mask[xy, xx] = True
    pixels[e57_mask] = E57_CYAN
    pixels[xgrids_mask] = XGRIDS_ORANGE
    pixels[e57_mask & xgrids_mask] = OVERLAP_WHITE
    if boundary_points is not None and int(boundary_points.shape[0]) > 0:
        boundary = _sample(boundary_points, MAX_RENDER_POINTS // 3, "render-boundary", np)
        bx, by, _ = _pixel_coordinates(
            boundary,
            projection,
            selected_bounds,
            width,
            height,
            pad_left,
            pad_top,
            pad_right,
            pad_bottom,
            np,
        )
        pixels[by, bx] = BOUNDARY_PURPLE
    image = Image.fromarray(pixels, mode="RGB")
    draw = ImageDraw.Draw(image)
    legend_font = _font(ImageFont, 14)
    legend = "E57 laser geometry: cyan   XGRIDS Gaussian centres: orange   shared projected pixel: white"
    if boundary_points is not None:
        legend += "   scan 122 boundary: purple"
    draw.rectangle((pad_left, 59, min(width - 20, pad_left + 970), 78), fill=BACKGROUND)
    draw.text((pad_left + 4, 61), legend, fill=TEXT, font=legend_font)
    draw.text(
        (pad_left, height - 42),
        "White is only a 2D projected-pixel collision; it is not a 3D distance match.",
        fill=MUTED,
        font=legend_font,
    )
    if crop_box is not None and projection == "xy":
        low, high = crop_box
        corners = np.asarray([[low[0], low[1], 0.0], [high[0], high[1], 0.0]])
        cx, cy, _ = _pixel_coordinates(
            corners,
            "xy",
            selected_bounds,
            width,
            height,
            pad_left,
            pad_top,
            pad_right,
            pad_bottom,
            np,
        )
        if len(cx) == 2:
            draw.rectangle((int(cx[0]), int(cy[1]), int(cx[1]), int(cy[0])), outline=(255, 214, 10), width=3)
            draw.text((int(cx[0]) + 5, int(cy[1]) + 5), "post-hoc diagnostic crop", fill=(255, 214, 10), font=legend_font)
    return _png_bytes(image)


def _render_distance(
    points: Any,
    distances: Any,
    np: Any,
    *,
    title: str,
    subtitle: str,
    bounds: Sequence[float],
    sample_seed: str,
    width: int = 1200,
    height: int = 900,
) -> bytes:
    Image, ImageDraw, ImageFont = _load_pillow()
    pad_left, pad_top, pad_right, pad_bottom = 72, 82, 24, 58
    indices = _deterministic_indices(int(points.shape[0]), MAX_RENDER_POINTS, sample_seed)
    selected_points = points[indices]
    selected_distances = distances[indices]
    image = Image.new("RGB", (width, height), BACKGROUND)
    pixels = np.asarray(image).copy()
    pixels[pad_top : height - pad_bottom, pad_left : width - pad_right] = PLOT_BACKGROUND
    image = Image.fromarray(pixels, mode="RGB")
    draw = ImageDraw.Draw(image)
    _, _, expanded = _pixel_coordinates(
        selected_points,
        "xy",
        bounds,
        width,
        height,
        pad_left,
        pad_top,
        pad_right,
        pad_bottom,
        np,
    )
    _draw_frame(
        image,
        draw,
        title,
        subtitle,
        "xy",
        expanded,
        ImageFont,
        width=width,
        height=height,
        pad_left=pad_left,
        pad_top=pad_top,
        pad_right=pad_right,
        pad_bottom=pad_bottom,
    )
    pixels = np.asarray(image).copy()
    x, y, expanded = _pixel_coordinates(
        selected_points,
        "xy",
        bounds,
        width,
        height,
        pad_left,
        pad_top,
        pad_right,
        pad_bottom,
        np,
    )
    projected = _project(selected_points, "xy", np)
    xmin, xmax, ymin, ymax = expanded
    valid = (
        (projected[:, 0] >= xmin)
        & (projected[:, 0] <= xmax)
        & (projected[:, 1] >= ymin)
        & (projected[:, 1] <= ymax)
    )
    selected_distances = selected_distances[valid]
    categories = np.digitize(selected_distances, DISTANCE_BINS_METERS, right=True)
    severity = np.full((height, width), -1, dtype=np.int8)
    np.maximum.at(severity, (y, x), categories.astype(np.int8))
    for category, colour in enumerate(DISTANCE_COLORS):
        pixels[severity == category] = colour
    image = Image.fromarray(pixels, mode="RGB")
    draw = ImageDraw.Draw(image)
    font = _font(ImageFont, 14)
    labels = ("<=5 cm", "5-10 cm", "10-25 cm", ">25 cm (overflow included)")
    x_cursor = pad_left
    for colour, label in zip(DISTANCE_COLORS, labels, strict=True):
        draw.rectangle((x_cursor, 59, x_cursor + 18, 75), fill=colour)
        draw.text((x_cursor + 24, 59), label, fill=TEXT, font=font)
        x_cursor += 205
    draw.text(
        (pad_left, height - 42),
        "Colours use actual 3D nearest-neighbour distance; bins are diagnostic, not approval thresholds.",
        fill=MUTED,
        font=font,
    )
    return _png_bytes(image)


def _crop_bounds(source_mapped: Any, training_target: Any, np: Any) -> tuple[Any, Any, str]:
    source_low, source_high = np.quantile(source_mapped, [0.02, 0.98], axis=0)
    target_low, target_high = np.quantile(training_target, [0.02, 0.98], axis=0)
    low = np.maximum(source_low, target_low)
    high = np.minimum(source_high, target_high)
    method = "post-hoc intersection of each development cloud's 2nd-98th percentile bounds"
    if bool(np.any(high - low < 0.35)):
        low = np.minimum(source_low, target_low)
        high = np.maximum(source_high, target_high)
        method = "post-hoc robust union fallback because the robust intersection was degenerate"
    margin = np.minimum(0.10, np.maximum(0.02, (high - low) * 0.01))
    return low - margin, high + margin, method


def _inside(points: Any, low: Any, high: Any, np: Any) -> Any:
    return np.all((points >= low) & (points <= high), axis=1)


def _matrix_evidence(rotation: Any, translation: Any, np: Any) -> dict[str, Any]:
    determinant = float(np.linalg.det(rotation))
    up_dot = float(np.dot(rotation @ np.asarray([0.0, 0.0, 1.0]), np.asarray([0.0, 0.0, 1.0])))
    up_dot_clamped = max(-1.0, min(1.0, up_dot))
    return {
        "rotationRowMajor": [[float(value) for value in row] for row in rotation],
        "translationMeters": [float(value) for value in translation],
        "determinantRotation": determinant,
        "scaleFixed": 1.0,
        "yawReadoutDegrees": math.degrees(math.atan2(rotation[1, 0], rotation[0, 0])),
        "mappedUpAxisDotTargetUpAxis": up_dot,
        "upAxisErrorDegrees": math.degrees(math.acos(up_dot_clamped)),
    }


def _parse_t515_proper(document: dict[str, Any], np: Any) -> tuple[Any, Any] | None:
    try:
        transform = document["diagnostic"]["fit"]["transform"]
        rotation = np.asarray(transform["rotationRowMajor"], dtype=np.float64)
        translation = np.asarray(transform["translationMeters"], dtype=np.float64)
    except (KeyError, TypeError, ValueError):
        return None
    if rotation.shape != (3, 3) or translation.shape != (3,) or not np.all(np.isfinite(rotation)):
        fail("INVALID_T515_TRANSFORM", "T-515 proper transform is malformed")
    return rotation, translation


def _default_candidates(
    gravity_rotation: Any,
    gravity_translation: Any,
    source: Any,
    t515_document: dict[str, Any],
    np: Any,
) -> dict[str, tuple[Any, Any, str, bool]]:
    proper = _parse_t515_proper(t515_document, np)
    if proper is None:
        proper = (gravity_rotation.copy(), gravity_translation.copy())
        proper_note = "synthetic fallback: T-515 matrix absent"
    else:
        proper_note = "exact transform recorded by the pinned T-515 receipt"
    proper_rotation, proper_translation = proper
    source_center = np.mean(source, axis=0)
    mapped_center = proper_rotation @ source_center + proper_translation
    mirror_rotation = gravity_rotation @ np.diag([-1.0, 1.0, 1.0])
    mirror_translation = (gravity_rotation @ source_center + gravity_translation) - mirror_rotation @ source_center
    angle = math.radians(37.0)
    wrong_delta = _yaw_rotation(angle, np)
    wrong_rotation = wrong_delta @ proper_rotation
    wrong_translation = mapped_center - wrong_rotation @ source_center
    return {
        "gravityConstrained": (
            gravity_rotation,
            gravity_translation,
            "fixed-scale, +Z-up, yaw-only exploratory candidate",
            False,
        ),
        "t515ProperUnconstrained": (
            proper_rotation,
            proper_translation,
            proper_note,
            False,
        ),
        "improperMirrorControl": (
            mirror_rotation,
            mirror_translation,
            "physically forbidden reflection control; default derived about the gravity candidate centre",
            True,
        ),
        "wrongAngleControl": (
            wrong_rotation,
            wrong_translation,
            "37 degree wrong-angle control about the source centre",
            False,
        ),
    }


def _render_candidate_grid(
    validation_target: Any,
    source: Any,
    candidates: Mapping[str, tuple[Any, Any, str, bool]],
    shared_bounds: Sequence[float],
    metrics: Mapping[str, Any],
    np: Any,
) -> bytes:
    Image, ImageDraw, ImageFont = _load_pillow()
    labels = (
        ("gravityConstrained", "Gravity-constrained"),
        ("t515ProperUnconstrained", "T-515 determinant +1, unconstrained"),
        ("improperMirrorControl", "Improper mirror (forbidden)"),
        ("wrongAngleControl", "Wrong-angle control"),
    )
    canvas = Image.new("RGB", (1400, 1040), BACKGROUND)
    for index, (key, label) in enumerate(labels):
        rotation, translation, _, _ = candidates[key]
        mapped = source @ rotation.T + translation
        forward_stats = metrics[key]["fullValidation"]["xgridsGaussianCentresToE57LaserGeometry"]
        reverse_stats = metrics[key]["fullValidation"]["e57LaserGeometryToXgridsGaussianCentres"]
        forward_overlap = forward_stats["fixedDistanceBins"]["le_0_05_m"] / forward_stats["count"]
        reverse_overlap = reverse_stats["fixedDistanceBins"]["le_0_05_m"] / reverse_stats["count"]
        minimum_overlap = min(forward_overlap, reverse_overlap)
        panel_bytes = _render_overlay(
            validation_target,
            mapped,
            np,
            projection="xy",
            title=label,
            subtitle=(
                f"PRIVATE | NONE | T-505 BLOCKED | X->E {forward_stats['rmseMeters']*1000:.0f}mm | "
                f"E->X {reverse_stats['rmseMeters']*1000:.0f}mm | min5cm {minimum_overlap*100:.1f}%"
            ),
            bounds=shared_bounds,
            width=690,
            height=500,
        )
        panel = Image.open(io.BytesIO(panel_bytes)).convert("RGB")
        canvas.paste(panel, ((index % 2) * 700, (index // 2) * 510))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 1020, 1400, 1040), fill=BACKGROUND)
    draw.text(
        (20, 1021),
        "All panels share the same raw validation points, metre bounds, projection, and diagnostic interpretation.",
        fill=TEXT,
        font=_font(ImageFont, 14),
    )
    return _png_bytes(canvas)


def _validate_scan_mapping(
    mapping: Mapping[int, Any],
    label: str,
    allowed: set[int],
    required: set[int],
    np: Any,
) -> dict[int, Any]:
    if not isinstance(mapping, Mapping):
        fail("INVALID_SCAN_MAPPING", f"{label} must be a scan-to-points mapping")
    normalized: dict[int, Any] = {}
    for raw_scan, value in mapping.items():
        if isinstance(raw_scan, bool) or not isinstance(raw_scan, int):
            fail("INVALID_SCAN_ID", f"{label} contains a non-integer scan id")
        if raw_scan in TEST_SCAN_IDS:
            fail("FROZEN_TEST_LEAK", f"frozen test scan {raw_scan} was supplied to T-516")
        if raw_scan not in allowed:
            fail("SCAN_ROLE_MISMATCH", f"scan {raw_scan} is not allowed in {label}")
        normalized[raw_scan] = _points(value, f"{label} scan {raw_scan}", np)
    if set(normalized) != required:
        fail(
            "SCAN_ROLE_MISMATCH",
            f"{label} ids are {sorted(normalized)}; required {sorted(required)}",
        )
    return normalized


def _seal_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    unsigned = copy.deepcopy(manifest)
    unsigned.pop("manifestReceipt", None)
    digest = _sha256_bytes(PACKAGE_DOMAIN + _canonical_json_bytes(unsigned))
    manifest["manifestReceipt"] = {
        "algorithm": "SHA-256",
        "domain": "OMNITWIN_RECEPTION_E57_XGRIDS_VISUAL_DIAGNOSTIC_V1\\0",
        "sha256": digest,
        "isSignature": False,
        "authenticatesCreator": False,
        "provesTimestamp": False,
    }
    return manifest


def _build_package_from_arrays_core(
    source_points: Any,
    training_by_scan: Mapping[int, Any],
    validation_by_scan: Mapping[int, Any],
    boundary_by_scan: Mapping[int, Any],
    t515_document: dict[str, Any],
    output_dir: Path,
    np: Any,
    cKDTree: Any,
    *,
    candidate_overrides: Mapping[str, tuple[Any, Any, str, bool]] | None = None,
    source_bindings: Mapping[str, Any] | None = None,
    t515_file_pin_verified: bool = False,
    _pre_publish_hook: Any | None = None,
    _production_inputs_verified: bool = False,
) -> dict[str, Any]:
    """Build and atomically publish a deterministic private visual package."""

    source = _points(source_points, "XGRIDS Gaussian centres", np)
    fit = _validate_scan_mapping(
        training_by_scan,
        "fit",
        set(FIT_SCAN_IDS),
        set(FIT_SCAN_IDS),
        np,
    )
    validation = _validate_scan_mapping(
        validation_by_scan,
        "validation",
        set(VALIDATION_SCAN_IDS),
        set(VALIDATION_SCAN_IDS),
        np,
    )
    boundary_required = {int(scan) for scan in boundary_by_scan}
    if 122 not in boundary_required:
        fail("BOUNDARY_122_MISSING", "scan 122 must remain visible as boundary evidence")
    boundary = _validate_scan_mapping(
        boundary_by_scan,
        "boundary",
        set(BOUNDARY_SCAN_IDS),
        boundary_required,
        np,
    )
    _verify_t515_document(t515_document)
    production_inputs_verified = bool(_production_inputs_verified)
    if t515_file_pin_verified and not production_inputs_verified:
        fail(
            "UNVERIFIED_PRODUCTION_CLAIM",
            "array helper cannot claim the real whole-file pin without the internal production input gate",
        )

    training_target = np.concatenate([fit[scan] for scan in FIT_SCAN_IDS], axis=0)
    validation_target = np.concatenate([validation[scan] for scan in VALIDATION_SCAN_IDS], axis=0)
    boundary_target = np.concatenate([boundary[scan] for scan in sorted(boundary)], axis=0)
    # Exact duplicate records from synthetic or overlapping adapters add cost but
    # no geometric information.  Deduplication is deterministic and recorded.
    training_unique = np.unique(training_target, axis=0)
    gravity_rotation, gravity_translation, gravity_trace = fit_gravity_yaw(
        source,
        training_unique,
        np,
        cKDTree,
        maximum_iterations=60,
    )
    gravity_mapped = source @ gravity_rotation.T + gravity_translation
    crop_low, crop_high, crop_method = _crop_bounds(gravity_mapped, training_unique, np)

    candidates = _default_candidates(
        gravity_rotation, gravity_translation, source, t515_document, np
    )
    if candidate_overrides is not None:
        for key, raw in candidate_overrides.items():
            if key not in candidates or not isinstance(raw, tuple) or len(raw) != 4:
                fail("INVALID_CANDIDATE_OVERRIDE", f"invalid override for {key}")
            rotation = np.asarray(raw[0], dtype=np.float64)
            translation = np.asarray(raw[1], dtype=np.float64)
            if (
                rotation.shape != (3, 3)
                or translation.shape != (3,)
                or not np.all(np.isfinite(rotation))
                or not np.all(np.isfinite(translation))
            ):
                fail("INVALID_CANDIDATE_OVERRIDE", f"non-finite transform override for {key}")
            gram = rotation.T @ rotation
            determinant = float(np.linalg.det(rotation))
            expected_sign = -1.0 if key == "improperMirrorControl" else 1.0
            if (
                not np.allclose(gram, np.eye(3), rtol=0.0, atol=1e-8)
                or abs(determinant - expected_sign) > 1e-8
            ):
                fail(
                    "INVALID_CANDIDATE_OVERRIDE",
                    f"{key} must be an orthonormal fixed-scale transform with determinant {expected_sign:+.0f}",
                )
            candidates[key] = (rotation, translation, str(raw[2]), bool(raw[3]))

    validation_crop_mask = _inside(validation_target, crop_low, crop_high, np)
    validation_crop = validation_target[validation_crop_mask]
    if int(validation_crop.shape[0]) < MIN_POINTS:
        validation_crop = validation_target
        crop_method += "; validation crop was too small, so crop metrics use the full validation set"

    candidate_metrics: dict[str, Any] = {}
    candidate_evidence: dict[str, Any] = {}
    mapped_by_candidate: dict[str, Any] = {}
    for key, (rotation, translation, note, forbidden) in candidates.items():
        full_metrics, mapped, _, _ = _bidirectional(
            source, validation_target, rotation, translation, np, cKDTree
        )
        mapped_by_candidate[key] = mapped
        source_crop = mapped[_inside(mapped, crop_low, crop_high, np)]
        if int(source_crop.shape[0]) >= MIN_POINTS and int(validation_crop.shape[0]) >= MIN_POINTS:
            identity = np.eye(3, dtype=np.float64)
            zero = np.zeros(3, dtype=np.float64)
            crop_metrics, _, _, _ = _bidirectional(
                source_crop, validation_crop, identity, zero, np, cKDTree
            )
        else:
            crop_metrics = {
                "status": "insufficient_points_inside_fixed_crop",
                "xgridsPointCount": int(source_crop.shape[0]),
                "e57PointCount": int(validation_crop.shape[0]),
            }
        candidate_metrics[key] = {
            "fullValidation": full_metrics,
            "fixedExploratoryCropValidation": crop_metrics,
            "fullValidationCounts": {
                "xgridsGaussianCentres": int(source.shape[0]),
                "e57LaserPoints": int(validation_target.shape[0]),
            },
            "cropCounts": {
                "xgridsGaussianCentres": int(source_crop.shape[0]),
                "e57LaserPoints": int(validation_crop.shape[0]),
            },
        }
        candidate_evidence[key] = {
            **_matrix_evidence(rotation, translation, np),
            "note": note,
            "physicallyForbidden": forbidden,
        }

    gravity_source_crop = gravity_mapped[_inside(gravity_mapped, crop_low, crop_high, np)]
    if int(gravity_source_crop.shape[0]) < MIN_POINTS:
        gravity_source_crop = gravity_mapped
    identity = np.eye(3, dtype=np.float64)
    zero = np.zeros(3, dtype=np.float64)
    gravity_crop_metrics, _, gravity_forward, gravity_reverse = _bidirectional(
        gravity_source_crop, validation_crop, identity, zero, np, cKDTree
    )

    full_e57 = np.concatenate((training_target, validation_target), axis=0)
    full_bounds_xy = _bounds(
        np.concatenate((full_e57, boundary_target, gravity_mapped), axis=0), "xy", np
    )
    crop_all = np.concatenate((gravity_source_crop, validation_crop), axis=0)
    crop_bounds_by_view = {
        projection: _bounds(crop_all, projection, np, margin=0.08)
        for projection in ("xy", "xz", "yz", "oblique")
    }
    comparison_union = np.concatenate(
        [validation_target] + [mapped_by_candidate[key] for key in sorted(mapped_by_candidate)],
        axis=0,
    )
    comparison_bounds = _bounds(comparison_union, "xy", np, margin=0.08)

    pngs: dict[str, bytes] = {
        "views/full-context-top.png": _render_overlay(
            full_e57,
            gravity_mapped,
            np,
            projection="xy",
            title="Full development context — top view",
            subtitle="PRIVATE | AUTHORITY NONE | T-505 BLOCKED | test geometry 126/129/141 not decoded",
            bounds=full_bounds_xy,
            boundary_points=boundary.get(122),
            crop_box=(crop_low, crop_high),
        ),
        "views/crop-top.png": _render_overlay(
            validation_crop,
            gravity_source_crop,
            np,
            projection="xy",
            title="Post-hoc exploratory crop — top view",
            subtitle="PRIVATE | AUTHORITY NONE | T-505 BLOCKED | post-hoc crop, not independent validation",
            bounds=crop_bounds_by_view["xy"],
        ),
        "views/crop-side-xz.png": _render_overlay(
            validation_crop,
            gravity_source_crop,
            np,
            projection="xz",
            title="Post-hoc exploratory crop — X/Z side view",
            subtitle="PRIVATE | AUTHORITY NONE | T-505 BLOCKED | +Z upright; fixed unit scale",
            bounds=crop_bounds_by_view["xz"],
        ),
        "views/crop-side-yz.png": _render_overlay(
            validation_crop,
            gravity_source_crop,
            np,
            projection="yz",
            title="Post-hoc exploratory crop — Y/Z side view",
            subtitle="PRIVATE | AUTHORITY NONE | T-505 BLOCKED | floor/ceiling disagreement visible",
            bounds=crop_bounds_by_view["yz"],
        ),
        "views/crop-oblique.png": _render_overlay(
            validation_crop,
            gravity_source_crop,
            np,
            projection="oblique",
            title="Post-hoc exploratory crop — oblique orthographic view",
            subtitle="PRIVATE | AUTHORITY NONE | T-505 BLOCKED | geometry only; no photographs",
            bounds=crop_bounds_by_view["oblique"],
        ),
        "views/distance-xgrids-to-e57.png": _render_distance(
            gravity_source_crop,
            gravity_forward,
            np,
            title="XGRIDS Gaussian centres → E57 laser geometry",
            subtitle="PRIVATE | AUTHORITY NONE | T-505 BLOCKED | actual 3D distance in fixed crop",
            bounds=crop_bounds_by_view["xy"],
            sample_seed="distance-xgrids-to-e57-fixed-sample",
        ),
        "views/distance-e57-to-xgrids.png": _render_distance(
            validation_crop,
            gravity_reverse,
            np,
            title="E57 laser geometry → XGRIDS Gaussian centres",
            subtitle="PRIVATE | AUTHORITY NONE | T-505 BLOCKED | actual 3D distance in fixed crop",
            bounds=crop_bounds_by_view["xy"],
            sample_seed="distance-e57-to-xgrids-fixed-sample",
        ),
        "views/candidate-comparison.png": _render_candidate_grid(
            validation_target,
            source,
            candidates,
            comparison_bounds,
            candidate_metrics,
            np,
        ),
    }

    file_entries = [
        {
            "path": path,
            "sha256": _sha256_bytes(payload),
            "sizeBytes": len(payload),
            "mediaType": "image/png",
        }
        for path, payload in sorted(pngs.items())
    ]
    requested_ids = sorted(set(fit) | set(validation) | set(boundary))
    bindings = copy.deepcopy(dict(source_bindings or {}))
    # Reject accidental path leakage in caller-provided evidence.  Names and
    # hashes are allowed; Windows drive paths and rooted POSIX paths are not.
    serialized_bindings = json.dumps(bindings, ensure_ascii=False, sort_keys=True)
    if ":\\" in serialized_bindings or '"/' in serialized_bindings:
        fail("ABSOLUTE_PATH_LEAK", "source bindings contain an absolute path")
    manifest: dict[str, Any] = {
        "schemaVersion": PACKAGE_SCHEMA,
        "authority": "none",
        "status": "private_visual_diagnostic_t505_blocked",
        "resultType": "not_a_transform_artifact_or_approval",
        "plainLanguageDecision": (
            "Computer vision found a same-room geometric signal, but this private package is a measuring aid only. "
            "It does not approve the crop, transform, rights, training, runtime use, or publication; T-505 remains blocked."
        ),
        "evidencePosture": (
            "verified_exact_real_inputs"
            if production_inputs_verified
            else "synthetic_or_injected_arrays_not_real_evidence"
        ),
        "scope": {
            "fitScanIds": list(FIT_SCAN_IDS),
            "validationScanIds": list(VALIDATION_SCAN_IDS),
            "testScanIdsGeometryNotDecodedSampledRenderedFitOrScored": list(TEST_SCAN_IDS),
            "boundaryScanIdsNotFitOrScored": list(BOUNDARY_SCAN_IDS),
            "boundaryScanIdsReadForContext": sorted(boundary),
            "scoredScanIds": list(VALIDATION_SCAN_IDS),
            "requestedScanIds": requested_ids,
            "leakageGuard": (
                "scan geometry 126, 129 and 141 is not requested from pye57, decoded, sampled, rendered, fitted or scored; "
                "the mandatory whole-file SHA-256 still reads the E57 container bytes"
            ),
        },
        "sourceSemantics": {
            "e57": "laser-measured geometry",
            "xgrids": "Gaussian centres are appearance primitives, not surveyed surfaces",
            "photographsOrRgbUsed": False,
            "nativeImagesRead": False,
        },
        "t515Evidence": {
            "internalReceiptSha256": t515_document["receipt"]["sha256"],
            "expectedWholeFileSha256": EXPECTED_T515_FILE_SHA256,
            "wholeFilePinVerifiedBeforeBuild": bool(t515_file_pin_verified),
            "status": t515_document["status"],
            "authority": t515_document["authority"],
        },
        "sourceBindings": bindings,
        "sampling": {
            "xgridsPointCount": int(source.shape[0]),
            "fitPointCountBeforeExactDeduplication": int(training_target.shape[0]),
            "fitPointCountAfterExactDeduplication": int(training_unique.shape[0]),
            "validationPointCount": int(validation_target.shape[0]),
            "boundaryContextPointCount": int(boundary_target.shape[0]),
            "perScanPointCounts": {
                str(scan): int(points.shape[0])
                for scan, points in sorted({**fit, **validation, **boundary}.items())
            },
            "renderSampling": "deterministic SHA-256-seeded coprime-stride cap; metrics use every supplied sample point",
        },
        "gravityConstrainedFit": {
            "trace": gravity_trace,
            "transform": _matrix_evidence(gravity_rotation, gravity_translation, np),
            "fitUsesOnlyScanIds": list(FIT_SCAN_IDS),
            "validationUsedDuringFit": False,
            "boundaryUsedDuringFit": False,
            "testUsedDuringFit": False,
        },
        "exploratoryCrop": {
            "reviewedOrIndependent": False,
            "postHoc": True,
            "method": crop_method,
            "minimumE57Meters": [float(value) for value in crop_low],
            "maximumE57Meters": [float(value) for value in crop_high],
            "meaning": "The crop diagnoses overlap and missing coverage; it is not a signed room boundary.",
        },
        "candidateTransforms": candidate_evidence,
        "candidateMetricsOnIdenticalValidationSamples": candidate_metrics,
        "gravityCropBidirectionalMetrics": gravity_crop_metrics,
        "distanceBinsMeters": {
            "le_0_05_m": "distance <= 0.05",
            "gt_0_05_le_0_10_m": "0.05 < distance <= 0.10",
            "gt_0_10_le_0_25_m": "0.10 < distance <= 0.25",
            "gt_0_25_m": "distance > 0.25; unbounded overflow retained",
            "approvalThresholds": False,
        },
        "viewPolicy": {
            "sharedCandidateComparisonBoundsMeters": [float(value) for value in comparison_bounds],
            "equalAspectRatio": True,
            "metreGrid": True,
            "whiteOverlayMeaning": "same 2D projected pixel only, never inferred 3D agreement",
            "distanceColourMeaning": "computed from raw 3D nearest-neighbour distance before rasterization",
            "perPixelDistanceCollisionRule": "show the worst (largest-bin) sampled distance in that pixel",
            "views": {
                "views/full-context-top.png": {
                    "projection": "xy_top_orthographic",
                    "boundsMeters": [float(value) for value in _equal_aspect_bounds(full_bounds_xy, 1104, 760)],
                },
                "views/crop-top.png": {
                    "projection": "xy_top_orthographic",
                    "boundsMeters": [float(value) for value in _equal_aspect_bounds(crop_bounds_by_view["xy"], 1104, 760)],
                },
                "views/crop-side-xz.png": {
                    "projection": "xz_side_orthographic",
                    "boundsMeters": [float(value) for value in _equal_aspect_bounds(crop_bounds_by_view["xz"], 1104, 760)],
                },
                "views/crop-side-yz.png": {
                    "projection": "yz_side_orthographic",
                    "boundsMeters": [float(value) for value in _equal_aspect_bounds(crop_bounds_by_view["yz"], 1104, 760)],
                },
                "views/crop-oblique.png": {
                    "projection": "fixed_linear_oblique_orthographic",
                    "boundsMeters": [float(value) for value in _equal_aspect_bounds(crop_bounds_by_view["oblique"], 1104, 760)],
                    "projectionFormula": [
                        "u=0.7071067811865476*x-0.7071067811865476*y",
                        "v=0.3535533905932738*x+0.3535533905932738*y+0.8660254037844386*z",
                    ],
                },
                "views/distance-xgrids-to-e57.png": {
                    "projection": "xy_top_orthographic_after_raw_3d_distance",
                    "boundsMeters": [float(value) for value in _equal_aspect_bounds(crop_bounds_by_view["xy"], 1104, 760)],
                    "direction": "xgridsGaussianCentresToE57LaserGeometry",
                },
                "views/distance-e57-to-xgrids.png": {
                    "projection": "xy_top_orthographic_after_raw_3d_distance",
                    "boundsMeters": [float(value) for value in _equal_aspect_bounds(crop_bounds_by_view["xy"], 1104, 760)],
                    "direction": "e57LaserGeometryToXgridsGaussianCentres",
                },
                "views/candidate-comparison.png": {
                    "projection": "four_xy_top_orthographic_panels",
                    "boundsMetersEachPanel": [float(value) for value in _equal_aspect_bounds(comparison_bounds, 594, 360)],
                },
            },
            "fixedRgbPalette": {
                "background": list(BACKGROUND),
                "plotBackground": list(PLOT_BACKGROUND),
                "grid": list(GRID),
                "e57LaserGeometry": list(E57_CYAN),
                "xgridsGaussianCentres": list(XGRIDS_ORANGE),
                "sharedProjectedPixelNot3dMatch": list(OVERLAP_WHITE),
                "scan122Boundary": list(BOUNDARY_PURPLE),
                "distanceLe5cm": list(DISTANCE_COLORS[0]),
                "distanceGt5Le10cm": list(DISTANCE_COLORS[1]),
                "distanceGt10Le25cm": list(DISTANCE_COLORS[2]),
                "distanceGt25cmOverflow": list(DISTANCE_COLORS[3]),
            },
            "renderingRuntime": _render_runtime_evidence(),
        },
        "t505Eligibility": {
            "eligibleForT505Completion": False,
            "eligibleForT502Training": False,
            "eligibleForRuntimeOrPublicUse": False,
            "reason": "authority none; T-505 blocked; no independent controls, reviewed crop, rights approval, or accuracy pass",
        },
        "safety": {
            "sourceMutationPerformed": False,
            "networkAccessPerformed": False,
            "providerUsePerformed": False,
            "trainingPerformed": False,
            "registrationSigningOrPublicationPerformed": False,
            "outputPolicy": "entire private package is staged and then published as one create-only directory rename",
        },
        "verification": {
            "selfDigestDetectsAccidentalOrUnrecomputedChange": True,
            "selfDigestAuthenticatesCreatorOrTruth": False,
            "maliciousRedigestRequiresExternalWholeManifestPin": True,
        },
        "limitations": [
            "Gravity is an explicit +Z-up assumption supported by geometry, not an independent inclinometer measurement.",
            "The exploratory crop is selected after seeing development geometry and cannot be called independent validation.",
            "Nearest-neighbour distances can be fooled by repeated walls, floors, ceilings, incomplete coverage and unlike sampling density.",
            "Gaussian centres are appearance primitives, not surveyed surfaces.",
            "The improper control is physically forbidden even when its numerical score is favorable; its note states whether it was optimized or centre-derived.",
            "A self-digest detects an unrecomputed edit but does not authenticate author, time, truth, rights or immutability.",
            "Scale fixed at 1.0 assumes both sources use metres; it is not an independent surveyed scale control.",
            "Whole-file hashing reads all E57 container bytes even though frozen test-scan geometry is never decoded or sampled.",
            "PNG byte identity is established for the recorded Pillow/font environment; cross-machine byte identity is not claimed.",
        ],
        "files": file_entries,
    }
    _seal_manifest(manifest)
    manifest_payload = json.dumps(
        manifest,
        allow_nan=False,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8") + b"\n"
    all_files = {**pngs, "manifest.json": manifest_payload}
    if _pre_publish_hook is not None:
        _pre_publish_hook()
    _write_package_create_only(Path(output_dir), all_files)
    return manifest


def build_package_from_arrays(
    source_points: Any,
    training_by_scan: Mapping[int, Any],
    validation_by_scan: Mapping[int, Any],
    boundary_by_scan: Mapping[int, Any],
    t515_document: dict[str, Any],
    output_dir: Path,
    np: Any,
    cKDTree: Any,
) -> dict[str, Any]:
    """Synthetic/injected-array seam used for deterministic tests only.

    This public helper can never issue ``verified_exact_real_inputs``.  The
    production CLI reaches the private core only after native source loading,
    exact receipt checks, and the pre-publication rehash barrier.
    """

    return _build_package_from_arrays_core(
        source_points,
        training_by_scan,
        validation_by_scan,
        boundary_by_scan,
        t515_document,
        output_dir,
        np,
        cKDTree,
        t515_file_pin_verified=False,
        _production_inputs_verified=False,
    )


def verify_package(
    package_dir: Path, expected_manifest_sha256: str | None = None
) -> dict[str, Any]:
    root = Path(package_dir)
    _assert_no_link_ancestors(root, "visual package")
    if not root.is_dir() or _is_link_like(root):
        fail("INVALID_PACKAGE", "package must be a real directory")
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file() or _is_link_like(manifest_path):
        fail("MANIFEST_MISSING", "package manifest.json is missing")
    manifest_before = manifest_path.lstat()
    manifest_bytes = manifest_path.read_bytes()
    manifest_after = manifest_path.lstat()
    if (
        manifest_before.st_size,
        manifest_before.st_mtime_ns,
        getattr(manifest_before, "st_ino", None),
        getattr(manifest_before, "st_dev", None),
    ) != (
        manifest_after.st_size,
        manifest_after.st_mtime_ns,
        getattr(manifest_after, "st_ino", None),
        getattr(manifest_after, "st_dev", None),
    ):
        fail("MANIFEST_CHANGED_DURING_READ", "manifest changed while it was read")
    manifest_sha256 = _sha256_bytes(manifest_bytes)
    if expected_manifest_sha256 is not None:
        if (
            not isinstance(expected_manifest_sha256, str)
            or len(expected_manifest_sha256) != 64
            or any(character not in "0123456789abcdef" for character in expected_manifest_sha256)
        ):
            fail("INVALID_EXPECTED_DIGEST", "expected manifest SHA-256 must be 64 lowercase hex characters")
        if manifest_sha256 != expected_manifest_sha256:
            fail("MANIFEST_EXTERNAL_PIN_MISMATCH", "manifest differs from the externally pinned bytes")
    manifest = _strict_json_bytes(manifest_bytes, "package manifest")
    expected_top_level = {
        "schemaVersion",
        "authority",
        "status",
        "resultType",
        "plainLanguageDecision",
        "evidencePosture",
        "scope",
        "sourceSemantics",
        "t515Evidence",
        "sourceBindings",
        "sampling",
        "gravityConstrainedFit",
        "exploratoryCrop",
        "candidateTransforms",
        "candidateMetricsOnIdenticalValidationSamples",
        "gravityCropBidirectionalMetrics",
        "distanceBinsMeters",
        "viewPolicy",
        "t505Eligibility",
        "safety",
        "verification",
        "limitations",
        "files",
        "manifestReceipt",
    }
    if set(manifest) != expected_top_level:
        fail("MANIFEST_SCHEMA_INVALID", f"unexpected manifest fields: {sorted(set(manifest) ^ expected_top_level)}")

    def reject_positive_claims(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                lowered = str(key).lower()
                if isinstance(item, bool) and item and (
                    lowered.startswith("eligible")
                    or "approved" in lowered
                    or lowered == "approval"
                ):
                    fail("CONTRADICTORY_AUTHORITY_CLAIM", f"manifest asserts {key}=true")
                reject_positive_claims(item)
        elif isinstance(value, list):
            for item in value:
                reject_positive_claims(item)

    reject_positive_claims(manifest)
    receipt = manifest.get("manifestReceipt")
    if not isinstance(receipt, dict) or not isinstance(receipt.get("sha256"), str):
        fail("MANIFEST_RECEIPT_MISSING", "manifest self-digest is missing")
    if (
        set(receipt)
        != {
            "algorithm",
            "domain",
            "sha256",
            "isSignature",
            "authenticatesCreator",
            "provesTimestamp",
        }
        or receipt.get("algorithm") != "SHA-256"
        or receipt.get("domain") != "OMNITWIN_RECEPTION_E57_XGRIDS_VISUAL_DIAGNOSTIC_V1\\0"
        or receipt.get("isSignature") is not False
        or receipt.get("authenticatesCreator") is not False
        or receipt.get("provesTimestamp") is not False
    ):
        fail("MANIFEST_RECEIPT_INVALID", "manifest receipt metadata overclaims or changed")
    unsigned = copy.deepcopy(manifest)
    unsigned.pop("manifestReceipt", None)
    expected = _sha256_bytes(PACKAGE_DOMAIN + _canonical_json_bytes(unsigned))
    if receipt["sha256"] != expected:
        fail("MANIFEST_TAMPERED", "manifest self-digest does not match")
    if (
        manifest.get("schemaVersion") != PACKAGE_SCHEMA
        or manifest.get("authority") != "none"
        or manifest.get("status") != "private_visual_diagnostic_t505_blocked"
        or manifest.get("resultType") != "not_a_transform_artifact_or_approval"
    ):
        fail("MANIFEST_POSTURE_INVALID", "package authority or blocked posture changed")
    eligibility = manifest.get("t505Eligibility")
    if not isinstance(eligibility, dict) or any(
        eligibility.get(key) is not False
        for key in (
            "eligibleForT505Completion",
            "eligibleForT502Training",
            "eligibleForRuntimeOrPublicUse",
        )
    ):
        fail("MANIFEST_POSTURE_INVALID", "package eligibility is not fail-closed")
    safety = manifest.get("safety")
    required_false = (
        "sourceMutationPerformed",
        "networkAccessPerformed",
        "providerUsePerformed",
        "trainingPerformed",
        "registrationSigningOrPublicationPerformed",
    )
    if not isinstance(safety, dict) or any(safety.get(key) is not False for key in required_false):
        fail("MANIFEST_POSTURE_INVALID", "package safety posture is not fail-closed")
    semantics = manifest.get("sourceSemantics")
    if (
        not isinstance(semantics, dict)
        or semantics.get("photographsOrRgbUsed") is not False
        or semantics.get("nativeImagesRead") is not False
        or "not surveyed surfaces" not in str(semantics.get("xgrids", "")).lower()
    ):
        fail("MANIFEST_POSTURE_INVALID", "package source semantics changed")
    scope = manifest.get("scope")
    if (
        not isinstance(scope, dict)
        or scope.get("fitScanIds") != list(FIT_SCAN_IDS)
        or scope.get("validationScanIds") != list(VALIDATION_SCAN_IDS)
        or scope.get("testScanIdsGeometryNotDecodedSampledRenderedFitOrScored") != list(TEST_SCAN_IDS)
        or scope.get("boundaryScanIdsNotFitOrScored") != list(BOUNDARY_SCAN_IDS)
        or scope.get("scoredScanIds") != list(VALIDATION_SCAN_IDS)
        or any(scan in scope.get("requestedScanIds", []) for scan in TEST_SCAN_IDS)
    ):
        fail("MANIFEST_SCOPE_INVALID", "package frozen scan roles changed")
    crop = manifest.get("exploratoryCrop")
    if (
        not isinstance(crop, dict)
        or crop.get("reviewedOrIndependent") is not False
        or crop.get("postHoc") is not True
    ):
        fail("MANIFEST_POSTURE_INVALID", "exploratory crop is no longer explicitly post-hoc and unreviewed")
    bins = manifest.get("distanceBinsMeters")
    if not isinstance(bins, dict) or bins.get("approvalThresholds") is not False:
        fail("MANIFEST_POSTURE_INVALID", "distance bins were misrepresented as approval thresholds")
    verification = manifest.get("verification")
    if (
        not isinstance(verification, dict)
        or verification.get("selfDigestDetectsAccidentalOrUnrecomputedChange") is not True
        or verification.get("selfDigestAuthenticatesCreatorOrTruth") is not False
        or verification.get("maliciousRedigestRequiresExternalWholeManifestPin") is not True
    ):
        fail("MANIFEST_POSTURE_INVALID", "manifest verification meaning changed")
    gravity = manifest.get("gravityConstrainedFit")
    if (
        not isinstance(gravity, dict)
        or gravity.get("fitUsesOnlyScanIds") != list(FIT_SCAN_IDS)
        or gravity.get("validationUsedDuringFit") is not False
        or gravity.get("boundaryUsedDuringFit") is not False
        or gravity.get("testUsedDuringFit") is not False
        or not isinstance(gravity.get("trace"), dict)
        or gravity["trace"].get("fixedScale") != 1.0
        or gravity["trace"].get("gravityConstrained") is not True
        or gravity["trace"].get("positiveZUpPreserved") is not True
    ):
        fail("MANIFEST_POSTURE_INVALID", "gravity fit scope or physical constraints changed")
    t515_evidence_all = manifest.get("t515Evidence")
    if (
        not isinstance(t515_evidence_all, dict)
        or t515_evidence_all.get("authority") != "none"
        or t515_evidence_all.get("status") != "diagnostic_complete_t505_blocked"
    ):
        fail("MANIFEST_POSTURE_INVALID", "T-515 authority-none binding changed")
    posture = manifest.get("evidencePosture")
    if posture not in {
        "verified_exact_real_inputs",
        "synthetic_or_injected_arrays_not_real_evidence",
    }:
        fail("MANIFEST_POSTURE_INVALID", "package evidence posture is unknown")
    if posture == "verified_exact_real_inputs":
        if expected_manifest_sha256 is None:
            fail(
                "EXTERNAL_MANIFEST_PIN_REQUIRED",
                "real-evidence packages require the externally recorded whole-manifest SHA-256",
            )
        bindings = manifest.get("sourceBindings")
        t515_evidence = manifest.get("t515Evidence")
        try:
            real_pins = {
                "e57": bindings["e57"]["sha256"],
                "stage": bindings["captureStageManifest"]["sha256"],
                "reception": bindings["receptionScopeEvidence"]["fileSha256"],
                "ply": bindings["xgridsPly"]["sha256"],
                "poses": bindings["xgridsPoses"]["sha256"],
                "t515File": t515_evidence["expectedWholeFileSha256"],
                "t515Internal": t515_evidence["internalReceiptSha256"],
            }
        except (KeyError, TypeError):
            fail("REAL_INPUT_PIN_MISSING", "real-evidence package omits a production pin")
        expected_real_pins = {
            "e57": EXPECTED_E57_SHA256,
            "stage": EXPECTED_STAGE_MANIFEST_SHA256,
            "reception": EXPECTED_RECEPTION_EVIDENCE_SHA256,
            "ply": EXPECTED_XGRIDS_PLY_SHA256,
            "poses": EXPECTED_XGRIDS_POSES_SHA256,
            "t515File": EXPECTED_T515_FILE_SHA256,
            "t515Internal": EXPECTED_T515_INTERNAL_SHA256,
        }
        if real_pins != expected_real_pins or t515_evidence.get("wholeFilePinVerifiedBeforeBuild") is not True:
            fail("REAL_INPUT_PIN_MISMATCH", "real-evidence package does not carry every exact production pin")
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        fail("FILE_INDEX_INVALID", "manifest file index is missing")
    required_pngs = {
        "views/full-context-top.png",
        "views/crop-top.png",
        "views/crop-side-xz.png",
        "views/crop-side-yz.png",
        "views/crop-oblique.png",
        "views/distance-xgrids-to-e57.png",
        "views/distance-e57-to-xgrids.png",
        "views/candidate-comparison.png",
    }
    indexed = {"manifest.json"}
    indexed_pngs: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"path", "sha256", "sizeBytes", "mediaType"}:
            fail("FILE_INDEX_INVALID", "file index entry must be an object")
        relative = str(_safe_member_path(entry.get("path")))
        if relative in indexed:
            fail("FILE_INDEX_INVALID", f"duplicate indexed path {relative}")
        indexed.add(relative)
        indexed_pngs.add(relative)
        if entry.get("mediaType") != "image/png":
            fail("FILE_INDEX_INVALID", f"indexed file {relative} has the wrong media type")
        path = root.joinpath(*PurePosixPath(relative).parts)
        if not path.is_file() or _is_link_like(path):
            fail("PACKAGE_FILE_MISSING", f"indexed file {relative} is missing")
        before = path.lstat()
        payload = path.read_bytes()
        after = path.lstat()
        if (
            before.st_size,
            before.st_mtime_ns,
            getattr(before, "st_ino", None),
            getattr(before, "st_dev", None),
        ) != (
            after.st_size,
            after.st_mtime_ns,
            getattr(after, "st_ino", None),
            getattr(after, "st_dev", None),
        ):
            fail("PACKAGE_FILE_CHANGED_DURING_READ", f"indexed file {relative} changed while read")
        if entry.get("sizeBytes") != len(payload) or entry.get("sha256") != _sha256_bytes(payload):
            fail("PACKAGE_FILE_TAMPERED", f"indexed file {relative} changed")
    if indexed_pngs != required_pngs:
        fail("FILE_INDEX_INVALID", f"required visual set changed: {sorted(indexed_pngs ^ required_pngs)}")
    actual: set[str] = set()
    for path in root.rglob("*"):
        if path.is_symlink():
            fail("PACKAGE_LINK_FORBIDDEN", "package contains a symbolic link or junction")
        if path.is_file():
            actual.add(path.relative_to(root).as_posix())
    if actual != indexed:
        fail("UNINDEXED_PACKAGE_FILE", f"package contents differ from index: {sorted(actual ^ indexed)}")
    return manifest


def _load_alignment_module(expected_sha256: str, expected_size_bytes: int) -> tuple[Any, Path, tuple[int, int, int | None, int | None, str]]:
    path = Path(__file__).resolve().with_name("align_e57_xgrids.py")
    pinned_snapshot = _snapshot(path)
    if pinned_snapshot[0] != expected_size_bytes or pinned_snapshot[4] != expected_sha256:
        fail(
            "ALIGNMENT_TOOL_PIN_MISMATCH",
            "align_e57_xgrids.py differs from the exact tool bytes recorded by T-515",
        )
    spec = importlib.util.spec_from_file_location("omnitwin_t515_alignment_for_views", path)
    if spec is None or spec.loader is None:
        fail("ALIGNMENT_TOOL_UNAVAILABLE", "could not load the T-515 alignment helper")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module, path, pinned_snapshot


def _positive_int(maximum: int) -> Any:
    def parse(value: str) -> int:
        try:
            selected = int(value, 10)
        except ValueError as error:
            raise argparse.ArgumentTypeError("must be an integer") from error
        if not 1 <= selected <= maximum:
            raise argparse.ArgumentTypeError(f"must be from 1 to {maximum}")
        return selected

    return parse


def _lower_sha256(value: str) -> str:
    if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        raise argparse.ArgumentTypeError("must be 64 lowercase hexadecimal characters")
    return value


def _plain_package_version(distribution: str) -> str:
    try:
        selected = importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        selected = "unknown"
    if not selected or any(
        character
        not in "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.+-_"
        for character in selected
    ):
        fail("INVALID_DEPENDENCY_VERSION", f"{distribution} version is not a plain version string")
    return selected


def _snapshot(path: Path) -> tuple[int, int, int | None, int | None, str]:
    _assert_no_link_ancestors(path, path.name)
    if not path.is_file() or _is_link_like(path):
        fail("UNSAFE_FILE", f"{path.name} must be a regular non-link file")
    details = path.lstat()
    return (
        int(details.st_size),
        int(details.st_mtime_ns),
        getattr(details, "st_ino", None),
        getattr(details, "st_dev", None),
        _sha256_file(path),
    )


def _assert_output_outside_sources(output: Path, protected_roots: Iterable[Path]) -> None:
    _assert_no_link_ancestors(output.parent, "output package")
    parent = output.parent.resolve(strict=True)
    candidate = parent / output.name
    for raw_root in protected_roots:
        root = Path(raw_root).resolve(strict=True)
        try:
            candidate.relative_to(root)
        except ValueError:
            continue
        fail("OUTPUT_OVERLAPS_SOURCE_ROOT", f"output package is inside protected source root {root.name}")


def _verify_t515_matches_bundle(t515: dict[str, Any], bundle: Any) -> None:
    try:
        prior = t515["inputEvidence"]
        expected = {
            "e57": prior["e57"]["currentBytesSha256"],
            "captureStageManifest": prior["captureStageManifest"]["sha256"],
            "receptionScopeEvidence": prior["receptionScopeEvidence"]["fileSha256"],
            "xgridsPly": prior["xgridsPly"]["sha256"],
            "xgridsPoses": prior["xgridsPoses"]["sha256"],
            "toolSourceSha256": prior["toolSource"]["sha256"],
            "toolSourceSizeBytes": prior["toolSource"]["sizeBytes"],
        }
        actual = {
            "e57": bundle.evidence["e57"]["currentBytesSha256"],
            "captureStageManifest": bundle.evidence["captureStageManifest"]["sha256"],
            "receptionScopeEvidence": bundle.evidence["receptionScopeEvidence"]["fileSha256"],
            "xgridsPly": bundle.evidence["xgridsPly"]["sha256"],
            "xgridsPoses": bundle.evidence["xgridsPoses"]["sha256"],
            "toolSourceSha256": bundle.tool_evidence["sha256"],
            "toolSourceSizeBytes": bundle.tool_evidence["sizeBytes"],
        }
    except (KeyError, TypeError):
        fail("T515_INPUT_BINDING_MISSING", "T-515 exact input bindings are missing")
    if expected != actual:
        fail("T515_INPUT_BINDING_MISMATCH", "current geometry does not match every T-515 input hash")


def _real_build(arguments: argparse.Namespace, *, e57_adapter: Any | None = None) -> dict[str, Any]:
    if e57_adapter is not None:
        fail(
            "INJECTED_ADAPTER_NOT_PRODUCTION",
            "an injected E57 adapter is a synthetic test seam and cannot issue a production-evidence package",
        )
    t515_path = Path(arguments.t515_receipt)
    t515_snapshot = _snapshot(t515_path)
    t515 = verify_t515_receipt(t515_path)
    tool_path = Path(__file__).resolve(strict=True)
    tool_snapshot = _snapshot(tool_path)
    try:
        pinned_alignment_source = t515["inputEvidence"]["toolSource"]
        alignment_expected_sha = pinned_alignment_source["sha256"]
        alignment_expected_size = int(pinned_alignment_source["sizeBytes"])
    except (KeyError, TypeError, ValueError):
        fail("T515_TOOL_PIN_MISSING", "T-515 does not carry the alignment-tool byte pin")
    alignment, alignment_path, alignment_snapshot = _load_alignment_module(
        alignment_expected_sha, alignment_expected_size
    )
    bundle = alignment.inspect_inputs(arguments)
    alignment._verify_expected_digests(arguments, bundle)
    _verify_t515_matches_bundle(t515, bundle)
    _assert_output_outside_sources(Path(arguments.output_dir), bundle.protected_roots)

    np, _, cKDTree, dependency_versions = alignment._load_geometry_dependencies()
    source = alignment._load_ply_sample(
        bundle.paths["xgridsPly"],
        bundle.snapshots["xgridsPly"],
        bundle.ply_layout,
        arguments.xgrids_sample_points,
        "t516-xgrids-gaussian-centres",
        np,
    )
    requested_scan_ids = FIT_SCAN_IDS + VALIDATION_SCAN_IDS + REAL_CONTEXT_BOUNDARY_SCAN_IDS
    if any(scan in requested_scan_ids for scan in TEST_SCAN_IDS):
        fail("INTERNAL_TEST_LEAK", "T-516 requested a frozen test scan")
    points_by_scan, e57_read = alignment._read_e57_point_samples(
        bundle.paths["e57"],
        bundle.snapshots["e57"],
        requested_scan_ids,
        arguments.points_per_scan,
        np,
        None,
    )
    e57_read = copy.deepcopy(e57_read)
    e57_read["adapter"]["version"] = _plain_package_version("pye57")
    fit = {scan: points_by_scan[scan] for scan in FIT_SCAN_IDS}
    validation = {scan: points_by_scan[scan] for scan in VALIDATION_SCAN_IDS}
    boundary = {scan: points_by_scan[scan] for scan in REAL_CONTEXT_BOUNDARY_SCAN_IDS}
    training_target = np.concatenate([fit[scan] for scan in FIT_SCAN_IDS], axis=0)

    mirror_rotation, mirror_translation, mirror_trace = alignment._fit_rigid_icp(
        source,
        training_target,
        maximum_iterations=arguments.maximum_iterations,
        trim_fraction=0.8,
        determinant_sign=-1,
        np=np,
        cKDTree=cKDTree,
    )
    proper = _parse_t515_proper(t515, np)
    if proper is None:
        fail("T515_TRANSFORM_MISSING", "pinned T-515 proper transform is missing")
    proper_rotation, proper_translation = proper
    source_center = np.mean(source, axis=0)
    mapped_center = proper_rotation @ source_center + proper_translation
    wrong_delta = alignment._axis_angle_rotation(
        (1.0, 2.0, 3.0), math.radians(37.0), np
    )
    wrong_rotation = wrong_delta @ proper_rotation
    wrong_translation = mapped_center - wrong_rotation @ source_center
    overrides = {
        "t515ProperUnconstrained": (
            proper_rotation,
            proper_translation,
            "exact determinant +1 transform recorded by the pinned T-515 receipt; it nearly flips +Z",
            False,
        ),
        "improperMirrorControl": (
            mirror_rotation,
            mirror_translation,
            "separately optimized 24-start improper/mirrored family recomputed on the T-516 fit samples",
            True,
        ),
        "wrongAngleControl": (
            wrong_rotation,
            wrong_translation,
            "T-515 37 degree rotation about axis (1,2,3), centre-preserving and recomputed on the T-516 source sample",
            False,
        ),
    }
    source_bindings = {
        "e57": {
            "fileName": bundle.evidence["e57"]["fileName"],
            "sha256": bundle.evidence["e57"]["currentBytesSha256"],
            "sizeBytes": bundle.evidence["e57"]["sizeBytes"],
            "scanCount": 149,
        },
        "captureStageManifest": bundle.evidence["captureStageManifest"],
        "receptionScopeEvidence": bundle.evidence["receptionScopeEvidence"],
        "xgridsPly": {
            "fileName": bundle.evidence["xgridsPly"]["fileName"],
            "sha256": bundle.evidence["xgridsPly"]["sha256"],
            "sizeBytes": bundle.evidence["xgridsPly"]["sizeBytes"],
            "declaredVertexCount": bundle.ply_layout.vertex_count,
        },
        "xgridsPoses": {
            "fileName": bundle.evidence["xgridsPoses"]["fileName"],
            "sha256": bundle.evidence["xgridsPoses"]["sha256"],
            "sizeBytes": bundle.evidence["xgridsPoses"]["sizeBytes"],
            "poseCount": bundle.pose_summary["poseCount"],
        },
        "t515Receipt": {
            "fileName": t515_path.name,
            "wholeFileSha256": EXPECTED_T515_FILE_SHA256,
            "internalReceiptSha256": EXPECTED_T515_INTERNAL_SHA256,
        },
        "generatorSource": {
            "fileName": tool_path.name,
            "sha256": tool_snapshot[4],
            "sizeBytes": tool_snapshot[0],
        },
        "alignmentSource": bundle.tool_evidence,
        "geometryDependencies": dependency_versions,
        "e57GeometryRead": e57_read,
        "improperOptimizationTrace": mirror_trace,
    }

    def pre_publish() -> None:
        # This intentionally performs the second full E57 hash immediately
        # before atomic publication.  It also re-pins both executable sources
        # and the T-515 receipt after all geometry and PNG work.
        alignment._verify_bundle_unchanged(bundle)
        if _snapshot(t515_path) != t515_snapshot:
            fail("T515_CHANGED_DURING_BUILD", "T-515 receipt changed during package generation")
        if _snapshot(tool_path) != tool_snapshot:
            fail("TOOL_CHANGED_DURING_BUILD", "T-516 generator changed during package generation")
        if _snapshot(alignment_path) != alignment_snapshot:
            fail("ALIGNMENT_TOOL_CHANGED_DURING_BUILD", "T-515 alignment helper changed during package generation")

    manifest = _build_package_from_arrays_core(
        source,
        fit,
        validation,
        boundary,
        t515,
        arguments.output_dir,
        np,
        cKDTree,
        candidate_overrides=overrides,
        source_bindings=source_bindings,
        t515_file_pin_verified=True,
        _pre_publish_hook=pre_publish,
        _production_inputs_verified=True,
    )
    manifest_path = Path(arguments.output_dir) / "manifest.json"
    manifest_sha256 = _sha256_file(manifest_path)
    verify_package(arguments.output_dir, expected_manifest_sha256=manifest_sha256)
    return {
        "authority": manifest["authority"],
        "status": manifest["status"],
        "packageDirectoryName": Path(arguments.output_dir).name,
        "manifestSha256": manifest_sha256,
        "manifestReceiptSha256": manifest["manifestReceipt"]["sha256"],
        "fileCountExcludingManifest": len(manifest["files"]),
        "testScanIdsGeometryNotDecodedOrUsed": list(TEST_SCAN_IDS),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="render_e57_xgrids_alignment_views.py",
        description=(
            "Create or verify a private geometry-only Reception alignment visual package. "
            "Every result remains authority-none and T-505-blocked."
        ),
    )
    subparsers = parser.add_subparsers(dest="mode", required=True)
    build = subparsers.add_parser("build", help="build a new create-only private package")
    build.add_argument("--t515-receipt", type=Path, required=True)
    build.add_argument("--stage-manifest", type=Path, required=True)
    build.add_argument("--reception-evidence", type=Path, required=True)
    build.add_argument("--xgrids-root", type=Path, required=True)
    build.add_argument("--xgrids-ply", type=Path, required=True)
    build.add_argument("--xgrids-poses", type=Path, required=True)
    build.add_argument("--scan-range", required=True, help="must be 122-144")
    build.add_argument("--output-dir", type=Path, required=True)
    build.add_argument("--verify-e57-bytes", action="store_true", required=True)
    build.add_argument("--expected-stage-manifest-sha256", type=_lower_sha256, required=True)
    build.add_argument("--expected-reception-evidence-sha256", type=_lower_sha256, required=True)
    build.add_argument("--expected-ply-sha256", type=_lower_sha256, required=True)
    build.add_argument("--expected-poses-sha256", type=_lower_sha256, required=True)
    build.add_argument("--points-per-scan", type=_positive_int(100_000), default=20_000)
    build.add_argument("--xgrids-sample-points", type=_positive_int(2_000_000), default=80_000)
    build.add_argument("--maximum-iterations", type=_positive_int(200), default=40)

    verify = subparsers.add_parser("verify", help="verify a package against its external manifest pin")
    verify.add_argument("--package", type=Path, required=True)
    verify.add_argument("--expected-manifest-sha256", type=_lower_sha256, required=True)
    return parser


def execute(argv: Sequence[str], *, e57_adapter: Any | None = None) -> dict[str, Any]:
    arguments = build_parser().parse_args(list(argv))
    if arguments.mode == "verify":
        manifest = verify_package(
            arguments.package,
            expected_manifest_sha256=arguments.expected_manifest_sha256,
        )
        return {
            "authority": manifest["authority"],
            "status": manifest["status"],
            "manifestSha256": arguments.expected_manifest_sha256,
            "manifestReceiptSha256": manifest["manifestReceipt"]["sha256"],
            "verified": True,
        }
    return _real_build(arguments, e57_adapter=e57_adapter)


def main(argv: Sequence[str] | None = None) -> int:
    try:
        result = execute(sys.argv[1:] if argv is None else argv)
        sys.stdout.write(json.dumps(result, allow_nan=False, sort_keys=True) + "\n")
        return 0
    except OverlayError as error:
        sys.stderr.write(
            json.dumps(
                {
                    "authority": "none",
                    "status": "refused_t505_blocked",
                    "errorCode": error.code,
                    "message": error.message,
                },
                sort_keys=True,
            )
            + "\n"
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
