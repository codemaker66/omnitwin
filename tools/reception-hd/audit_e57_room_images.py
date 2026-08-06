#!/usr/bin/env python3
"""Read-only computer-vision and pose audit for one E57 room scan range.

The tool answers a deliberately narrow question: do the selected E57 scan
stations have a complete, decodable, pose-bound image set that is technically
usable as the input to a future known-pose reconstruction experiment?

It does not copy images, create COLMAP files, train a model, infer legal rights,
or claim that visually similar panoramas prove room identity.  Every output is
authority-none evidence and every image remains subject to human review.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import math
import os
import platform
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
import scipy
from PIL import Image, UnidentifiedImageError
from scipy.ndimage import gaussian_filter
from scipy.spatial import ConvexHull, QhullError


SCHEMA_VERSION = "omnitwin.reception.e57-room-image-audit.v1"
REVIEW_SCHEMA_VERSION = "omnitwin.reception.e57-visual-review.v1"
DERIVATION_RECEIPT_SCHEMA_VERSION = "omnitwin.e57-image-derivation-receipt.v1"
REPORT_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_E57_ROOM_IMAGE_AUDIT_V1\0"
FACES = ("front", "back", "left", "right", "up", "down")
MAX_IMAGE_BYTES = 128 * 1024 * 1024
MAX_E57_BYTES = 4 * 1024**4
MAX_LINEAGE_ARTIFACT_BYTES = 32 * 1024 * 1024
MAX_IMAGE_PIXELS = 80_000_000
HASH_CHUNK_BYTES = 8 * 1024 * 1024
QUATERNION_TOLERANCE = 1e-5
CAMERA_CENTRE_TOLERANCE = 1e-6
COLOCATED_STATION_TOLERANCE = 1e-6
E57_TO_COLMAP_VERTICAL_FLIP = np.diag([1.0, -1.0, -1.0])


class AuditError(RuntimeError):
    """Expected, stable failure which should stop the audit."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def fail(code: str, message: str) -> None:
    raise AuditError(code, message)


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _round(value: float, digits: int = 6) -> float:
    result = round(float(value), digits)
    return 0.0 if result == 0.0 else result


def _finite(values: Iterable[float], label: str) -> list[float]:
    result = [float(value) for value in values]
    if not all(math.isfinite(value) for value in result):
        fail("NONFINITE_VALUE", f"{label} contains a non-finite value")
    return result


def _normalized_quaternion(values: Iterable[float], label: str) -> tuple[list[float], float]:
    quaternion = _finite(values, label)
    norm = math.sqrt(sum(value * value for value in quaternion))
    if norm <= 0 or abs(norm - 1.0) > QUATERNION_TOLERANCE:
        fail("INVALID_QUATERNION", f"{label} norm is {norm}")
    return [value / norm for value in quaternion], norm


def _safe_regular_file(path: Path, label: str, maximum_bytes: int) -> os.stat_result:
    if path.is_symlink():
        fail("UNSAFE_SYMLINK", f"{label} must not be a symbolic link")
    try:
        stat = path.stat()
    except FileNotFoundError:
        fail("MISSING_FILE", f"missing {label}: {path.name}")
    except OSError as error:
        fail("READ_FAILED", f"could not inspect {label}: {error}")
    if not path.is_file():
        fail("NOT_REGULAR_FILE", f"{label} is not a regular file: {path.name}")
    if stat.st_size <= 0:
        fail("EMPTY_FILE", f"{label} is empty: {path.name}")
    if stat.st_size > maximum_bytes:
        fail("FILE_TOO_LARGE", f"{label} exceeds {maximum_bytes} bytes: {path.name}")
    return stat


def _same_file_identity(before: os.stat_result, after: os.stat_result) -> bool:
    return (
        before.st_size == after.st_size
        and before.st_mtime_ns == after.st_mtime_ns
        and getattr(before, "st_ino", None) == getattr(after, "st_ino", None)
        and getattr(before, "st_dev", None) == getattr(after, "st_dev", None)
    )


def _sha256_file(
    path: Path,
    expected: os.stat_result,
    maximum_bytes: int = MAX_IMAGE_BYTES,
) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            while True:
                chunk = source.read(HASH_CHUNK_BYTES)
                if not chunk:
                    break
                digest.update(chunk)
    except OSError as error:
        fail("READ_FAILED", f"could not hash {path.name}: {error}")
    after = _safe_regular_file(path, path.name, maximum_bytes)
    if not _same_file_identity(expected, after):
        fail("FILE_CHANGED_DURING_READ", f"{path.name} changed while it was being hashed")
    return digest.hexdigest()


def _read_bounded_json(
    path: Path,
    *,
    label: str,
    maximum_bytes: int,
    invalid_code: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Hash and parse the exact same bounded bytes, then recheck file identity."""

    before = _safe_regular_file(path, label, maximum_bytes)
    try:
        payload = path.read_bytes()
    except OSError as error:
        fail("READ_FAILED", f"could not read {label}: {error}")
    after = _safe_regular_file(path, label, maximum_bytes)
    if not _same_file_identity(before, after):
        fail("FILE_CHANGED_DURING_READ", f"{label} changed while it was being read")
    try:
        raw = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        fail(invalid_code, f"could not parse {label}: {error}")
    if not isinstance(raw, dict):
        fail(invalid_code, f"{label} must contain one JSON object")
    return raw, {
        "fileName": path.name,
        "sizeBytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


@dataclass(frozen=True)
class ImageInspection:
    evidence: dict[str, Any]
    grayscale: np.ndarray


def _thumbnail_rgb(image: Image.Image, maximum_width: int, maximum_height: int) -> np.ndarray:
    rgb = image.convert("RGB")
    rgb.thumbnail((maximum_width, maximum_height), Image.Resampling.LANCZOS)
    return np.asarray(rgb, dtype=np.float64) / 255.0


def _gradient_energy(gray: np.ndarray, sigma: float) -> float:
    working = gaussian_filter(gray, sigma=sigma, mode="reflect") if sigma > 0 else gray
    gy, gx = np.gradient(working)
    return float(np.mean(np.hypot(gx, gy)))


def analyze_rgb(rgb: np.ndarray) -> dict[str, Any]:
    """Return descriptive signals, never a universal 'quality score'."""

    if rgb.ndim != 3 or rgb.shape[2] != 3:
        fail("INVALID_IMAGE_ARRAY", "decoded image must be an RGB array")
    if not np.isfinite(rgb).all():
        fail("NONFINITE_IMAGE", "decoded image contains a non-finite value")
    gray = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    p01, p05, p50, p95, p99 = np.percentile(gray, [1, 5, 50, 95, 99])
    energy0 = _gradient_energy(gray, 0.0)
    energy1 = _gradient_energy(gray, 1.0)
    energy2 = _gradient_energy(gray, 2.0)
    saturation = np.max(rgb, axis=2) - np.min(rgb, axis=2)
    return {
        "luminance": {
            "p01": _round(p01),
            "p05": _round(p05),
            "median": _round(p50),
            "p95": _round(p95),
            "p99": _round(p99),
            "p01ToP99Range": _round(p99 - p01),
            "nearBlackFraction": _round(np.mean(gray <= 2.0 / 255.0)),
            "nearWhiteFraction": _round(np.mean(gray >= 253.0 / 255.0)),
        },
        "detailSignals": {
            "gradientEnergySigma0": _round(energy0, 8),
            "gradientEnergySigma1": _round(energy1, 8),
            "gradientEnergySigma2": _round(energy2, 8),
            "sigma1Retention": _round(energy1 / energy0 if energy0 > 0 else 0.0),
            "sigma2Retention": _round(energy2 / energy0 if energy0 > 0 else 0.0),
        },
        "colourSignals": {
            "medianChromaRange": _round(np.median(saturation)),
            "p95ChromaRange": _round(np.percentile(saturation, 95)),
        },
    }


def inspect_image(
    path: Path,
    *,
    expected_dimensions: tuple[int, int] | None,
    thumbnail_dimensions: tuple[int, int],
) -> ImageInspection:
    before = _safe_regular_file(path, "image", MAX_IMAGE_BYTES)
    sha256 = _sha256_file(path, before)
    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        with Image.open(path) as probe:
            if probe.format != "JPEG":
                fail("UNEXPECTED_IMAGE_FORMAT", f"{path.name} is {probe.format}, expected JPEG")
            width, height = probe.size
            if width * height > MAX_IMAGE_PIXELS:
                fail("IMAGE_TOO_LARGE", f"{path.name} exceeds {MAX_IMAGE_PIXELS} decoded pixels")
            probe.verify()
        with Image.open(path) as decoded:
            decoded.load()
            width, height = decoded.size
            rgb = _thumbnail_rgb(decoded, *thumbnail_dimensions)
    except (UnidentifiedImageError, OSError, ValueError) as error:
        fail("IMAGE_DECODE_FAILED", f"could not fully decode {path.name}: {error}")
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit
    after = _safe_regular_file(path, "image", MAX_IMAGE_BYTES)
    if not _same_file_identity(before, after):
        fail("FILE_CHANGED_DURING_READ", f"{path.name} changed while it was decoded")
    if expected_dimensions is not None and (width, height) != expected_dimensions:
        fail(
            "UNEXPECTED_IMAGE_DIMENSIONS",
            f"{path.name} is {width}x{height}, expected {expected_dimensions[0]}x{expected_dimensions[1]}",
        )
    gray = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    return ImageInspection(
        evidence={
            "fileName": path.name,
            "sizeBytes": before.st_size,
            "sha256": sha256,
            "width": width,
            "height": height,
            "decodedThumbnailWidth": int(rgb.shape[1]),
            "decodedThumbnailHeight": int(rgb.shape[0]),
            "signals": analyze_rgb(rgb),
        },
        grayscale=gray,
    )


def inspect_jpeg_bytes(
    data: bytes | bytearray,
    *,
    label: str,
    expected_dimensions: tuple[int, int],
    thumbnail_dimensions: tuple[int, int] = (256, 256),
) -> dict[str, Any]:
    if not data:
        fail("EMPTY_EMBEDDED_IMAGE", f"{label} has no JPEG bytes")
    if len(data) > MAX_IMAGE_BYTES:
        fail("FILE_TOO_LARGE", f"{label} exceeds {MAX_IMAGE_BYTES} bytes")
    raw = bytes(data)
    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            if probe.format != "JPEG":
                fail("UNEXPECTED_IMAGE_FORMAT", f"{label} is {probe.format}, expected JPEG")
            width, height = probe.size
            probe.verify()
        with Image.open(io.BytesIO(raw)) as decoded:
            decoded.load()
            width, height = decoded.size
            rgb = _thumbnail_rgb(decoded, *thumbnail_dimensions)
    except (UnidentifiedImageError, OSError, ValueError) as error:
        fail("IMAGE_DECODE_FAILED", f"could not fully decode {label}: {error}")
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit
    if (width, height) != expected_dimensions:
        fail(
            "UNEXPECTED_IMAGE_DIMENSIONS",
            f"{label} is {width}x{height}, expected {expected_dimensions[0]}x{expected_dimensions[1]}",
        )
    return {
        "sizeBytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "width": width,
        "height": height,
        "decodedThumbnailWidth": int(rgb.shape[1]),
        "decodedThumbnailHeight": int(rgb.shape[0]),
        "signals": analyze_rgb(rgb),
    }


def best_circular_ncc(first: np.ndarray, second: np.ndarray) -> dict[str, Any]:
    if first.shape != second.shape or first.ndim != 2:
        fail("CONTINUITY_SHAPE_MISMATCH", "continuity images must be equally sized grayscale arrays")
    height, width = first.shape
    trim = max(1, height // 8)
    a = gaussian_filter(first[trim:-trim, :], sigma=2.0, mode="wrap")
    b = gaussian_filter(second[trim:-trim, :], sigma=2.0, mode="wrap")
    a = a - float(np.mean(a))
    b = b - float(np.mean(b))
    denominator = float(np.sqrt(np.sum(a * a) * np.sum(b * b)))
    if denominator <= 1e-12:
        return {"assessable": False, "bestNcc": None, "bestYawShiftDegrees": None}
    correlations = np.array(
        [float(np.sum(a * np.roll(b, shift, axis=1)) / denominator) for shift in range(width)]
    )
    shift = int(np.argmax(correlations))
    return {
        "assessable": True,
        "bestNcc": _round(correlations[shift]),
        "bestYawShiftDegrees": _round(shift * 360.0 / width, 3),
    }


def _rotation_matrix_to_quaternion(rotation: np.ndarray) -> list[float]:
    """Convert a proper 3x3 rotation to COLMAP's [qw, qx, qy, qz]."""

    rotation = np.asarray(rotation, dtype=np.float64)
    if rotation.shape != (3, 3):
        fail("INVALID_ROTATION_MATRIX", "rotation matrix must be 3x3")
    if not np.all(np.isfinite(rotation)):
        fail("INVALID_ROTATION_MATRIX", "rotation matrix contains a non-finite value")
    if not np.allclose(rotation @ rotation.T, np.eye(3), atol=1e-8):
        fail("INVALID_ROTATION_MATRIX", "rotation matrix is not orthonormal")
    determinant = float(np.linalg.det(rotation))
    if not math.isclose(determinant, 1.0, abs_tol=1e-8):
        fail(
            "IMPROPER_ROTATION_MATRIX",
            f"rotation matrix determinant is {determinant}; reflections cannot be stored as quaternions",
        )

    trace = float(np.trace(rotation))
    if trace > 0:
        s = math.sqrt(trace + 1.0) * 2.0
        values = [0.25 * s, (rotation[2, 1] - rotation[1, 2]) / s, (rotation[0, 2] - rotation[2, 0]) / s, (rotation[1, 0] - rotation[0, 1]) / s]
    else:
        index = int(np.argmax(np.diag(rotation)))
        if index == 0:
            s = math.sqrt(1.0 + rotation[0, 0] - rotation[1, 1] - rotation[2, 2]) * 2.0
            values = [(rotation[2, 1] - rotation[1, 2]) / s, 0.25 * s, (rotation[0, 1] + rotation[1, 0]) / s, (rotation[0, 2] + rotation[2, 0]) / s]
        elif index == 1:
            s = math.sqrt(1.0 + rotation[1, 1] - rotation[0, 0] - rotation[2, 2]) * 2.0
            values = [(rotation[0, 2] - rotation[2, 0]) / s, (rotation[0, 1] + rotation[1, 0]) / s, 0.25 * s, (rotation[1, 2] + rotation[2, 1]) / s]
        else:
            s = math.sqrt(1.0 + rotation[2, 2] - rotation[0, 0] - rotation[1, 1]) * 2.0
            values = [(rotation[1, 0] - rotation[0, 1]) / s, (rotation[0, 2] + rotation[2, 0]) / s, (rotation[1, 2] + rotation[2, 1]) / s, 0.25 * s]
    result = np.asarray(values, dtype=np.float64)
    result /= np.linalg.norm(result)
    if result[0] < 0:
        result *= -1
    return [_round(value, 10) for value in result]


def _quat_to_matrix(quaternion: Sequence[float]) -> np.ndarray:
    normalized, _ = _normalized_quaternion(quaternion, "quaternion")
    w, x, y, z = normalized
    return np.asarray(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
            [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
            [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )


def e57_pose_to_colmap_vertical_flip(
    camera_to_world_quaternion: Sequence[float],
    camera_centre: Sequence[float],
) -> tuple[np.ndarray, np.ndarray]:
    """Return an unverified candidate COLMAP extrinsic for a vertically flipped E57 image.

    E57 pinhole images see points at negative camera Z. COLMAP perspective
    cameras see points at positive camera Z. A vertical raster flip plus a
    proper 180-degree rotation about camera X converts the coordinate
    conventions without trying to encode a reflection as a quaternion.
    """

    e57_camera_to_world = _quat_to_matrix(camera_to_world_quaternion)
    candidate_world_to_camera = E57_TO_COLMAP_VERTICAL_FLIP @ e57_camera_to_world.T
    centre = np.asarray(_finite(camera_centre, "camera centre"), dtype=np.float64)
    if centre.shape != (3,):
        fail("INVALID_CAMERA_CENTRE", "camera centre must contain exactly three values")
    translation = -candidate_world_to_camera @ centre
    return candidate_world_to_camera, translation


FACE_BASES: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]] = {
    "front": (np.array([1.0, 0, 0]), np.array([0, -1.0, 0]), np.array([0, 0, -1.0])),
    "back": (np.array([-1.0, 0, 0]), np.array([0, 1.0, 0]), np.array([0, 0, -1.0])),
    "left": (np.array([0, 1.0, 0]), np.array([1.0, 0, 0]), np.array([0, 0, -1.0])),
    "right": (np.array([0, -1.0, 0]), np.array([-1.0, 0, 0]), np.array([0, 0, -1.0])),
    "up": (np.array([0, 0, 1.0]), np.array([0, -1.0, 0]), np.array([1.0, 0, 0])),
    "down": (np.array([0, 0, -1.0]), np.array([0, -1.0, 0]), np.array([-1.0, 0, 0])),
}


def known_pose_for_face(
    scan_quaternion: Sequence[float],
    scan_translation: Sequence[float],
    face: str,
) -> dict[str, Any]:
    axis, right, down = FACE_BASES[face]
    camera_to_scan = np.column_stack([right, down, axis])
    scan_to_world = _quat_to_matrix(scan_quaternion)
    camera_to_world = scan_to_world @ camera_to_scan
    world_to_camera = camera_to_world.T
    centre = np.asarray(scan_translation, dtype=np.float64)
    translation = -world_to_camera @ centre
    return {
        "worldToCameraQuaternionWxyz": _rotation_matrix_to_quaternion(world_to_camera),
        "worldToCameraTranslation": [_round(value, 10) for value in translation],
    }


def load_e57_poses(e57_path: Path, scan_ids: Sequence[int]) -> tuple[dict[int, dict[str, Any]], int]:
    _safe_regular_file(e57_path, "E57 source", MAX_E57_BYTES)
    try:
        import pye57  # imported lazily so pure tests do not need an E57 fixture
    except ImportError:
        fail("PYE57_UNAVAILABLE", "pye57 is required to read pose headers")
    try:
        source = pye57.E57(str(e57_path))
        scan_count = int(source.scan_count)
        poses: dict[int, dict[str, Any]] = {}
        for scan_id in scan_ids:
            if scan_id < 0 or scan_id >= scan_count:
                fail("SCAN_OUT_OF_RANGE", f"scan {scan_id} is outside the E57's 0..{scan_count - 1} range")
            header = source.get_header(scan_id)
            if not header.has_pose():
                fail("MISSING_DATA3D_POSE", f"scan {scan_id} has no declared Data3D pose")
            quaternion, source_norm = _normalized_quaternion(
                header.rotation,
                f"scan {scan_id} quaternion",
            )
            translation = _finite(header.translation, f"scan {scan_id} translation")
            poses[scan_id] = {
                "rotationWxyz": [_round(value, 10) for value in quaternion],
                "translation": [_round(value, 10) for value in translation],
                "sourceQuaternionNorm": _round(source_norm, 10),
                "normalizedBeforeUse": True,
            }
    except AuditError:
        raise
    except Exception as error:
        fail("E57_READ_FAILED", f"could not read E57 pose headers: {error}")
    return poses, scan_count


def _node_quaternion(node: Any, label: str) -> tuple[list[float], float]:
    values, source_norm = _normalized_quaternion(
        [node[key].value() for key in ("w", "x", "y", "z")],
        label,
    )
    return values, source_norm


def _node_translation(node: Any, label: str) -> list[float]:
    return _finite([node[key].value() for key in ("x", "y", "z")], label)


def _intrinsic_record(representation: Any, label: str) -> dict[str, Any]:
    width = int(representation["imageWidth"].value())
    height = int(representation["imageHeight"].value())
    focal_length = float(representation["focalLength"].value())
    pixel_width = float(representation["pixelWidth"].value())
    pixel_height = float(representation["pixelHeight"].value())
    principal_x = float(representation["principalPointX"].value())
    principal_y = float(representation["principalPointY"].value())
    _finite(
        [focal_length, pixel_width, pixel_height, principal_x, principal_y],
        f"{label} intrinsics",
    )
    if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
        fail("INVALID_INTRINSICS", f"{label} has invalid dimensions")
    if focal_length <= 0 or pixel_width <= 0 or pixel_height <= 0:
        fail("INVALID_INTRINSICS", f"{label} has non-positive focal length or pixel pitch")
    if not (0 <= principal_x <= width and 0 <= principal_y <= height):
        fail("INVALID_INTRINSICS", f"{label} principal point lies outside the image")
    return {
        "width": width,
        "height": height,
        "focalLength": _round(focal_length, 12),
        "pixelWidth": _round(pixel_width, 12),
        "pixelHeight": _round(pixel_height, 12),
        "principalPointX": _round(principal_x, 9),
        "principalPointY": _round(principal_y, 9),
        "fxPixels": _round(focal_length / pixel_width, 9),
        "fyPixels": _round(focal_length / pixel_height, 9),
        "candidateColmapCameraAfterRequiredVerticalFlip": {
            "status": "blocked_pending_hash_bound_lidar_reprojection",
            "model": "PINHOLE",
            "parameters": [
                _round(focal_length / pixel_width, 9),
                _round(focal_length / pixel_height, 9),
                _round(principal_x, 9),
                _round(height - principal_y, 9),
            ],
            "requiredRasterTransform": "vertical_flip",
            "continuousCoordinateRule": "v_colmap = imageHeight - v_e57",
            "pixelRowRule": "row_colmap = imageHeight - 1 - row_e57",
        },
    }


def _intrinsic_key(intrinsic: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical_json_bytes(intrinsic)).hexdigest()


def _pair_angles_degrees(quaternions: Sequence[Sequence[float]]) -> list[float]:
    forwards = []
    for quaternion in quaternions:
        forward = _quat_to_matrix(quaternion)[:, 2]
        forwards.append(forward / np.linalg.norm(forward))
    angles: list[float] = []
    for index, first in enumerate(forwards):
        for second in forwards[index + 1 :]:
            cosine = float(np.clip(np.dot(first, second), -1.0, 1.0))
            angles.append(float(np.degrees(np.arccos(cosine))))
    return angles


def summarize_native_e57_records(
    records_by_scan: dict[int, list[dict[str, Any]]],
    scan_poses: dict[int, dict[str, Any]],
    scan_ids: Sequence[int],
) -> dict[str, Any]:
    expected_names = {f"Skybox {index}" for index in range(6)}
    all_guids: list[str] = []
    all_hashes: dict[str, list[str]] = {}
    intrinsic_groups: dict[str, dict[str, Any]] = {}
    dimension_groups: set[tuple[int, int]] = set()
    scan_summaries: list[dict[str, Any]] = []
    total_bytes = 0
    maximum_centre_spread = 0.0
    maximum_scan_centre_delta = 0.0
    maximum_quaternion_norm_error = 0.0
    maximum_cube_angle_deviation = 0.0
    image_signal_rows: list[tuple[int, str, str, dict[str, Any]]] = []

    for scan_id in scan_ids:
        records = sorted(
            records_by_scan.get(scan_id, []),
            key=lambda record: (record["name"], record["image2DGuid"]),
        )
        if len(records) != 6:
            fail("NATIVE_IMAGE_COUNT_MISMATCH", f"scan {scan_id} has {len(records)} native images, expected 6")
        names = {str(record["name"]) for record in records}
        if names != expected_names:
            fail("NATIVE_IMAGE_NAME_SET_MISMATCH", f"scan {scan_id} does not contain Skybox 0 through Skybox 5 exactly once")
        associated_guids = {str(record["associatedData3DGuid"]) for record in records}
        if len(associated_guids) != 1:
            fail("MIXED_DATA3D_ASSOCIATION", f"scan {scan_id} images do not share one associatedData3DGuid")
        centres = np.asarray([record["pose"]["translation"] for record in records], dtype=np.float64)
        centre_spread = float(np.max(np.linalg.norm(centres[:, None, :] - centres[None, :, :], axis=2)))
        scan_centre = np.asarray(scan_poses[scan_id]["translation"], dtype=np.float64)
        scan_centre_delta = float(np.max(np.linalg.norm(centres - scan_centre, axis=1)))
        if centre_spread > CAMERA_CENTRE_TOLERANCE:
            fail(
                "NATIVE_CAMERA_CENTRE_SPREAD",
                f"scan {scan_id} camera centres differ by {centre_spread}, above {CAMERA_CENTRE_TOLERANCE}",
            )
        if scan_centre_delta > CAMERA_CENTRE_TOLERANCE:
            fail(
                "IMAGE_SCAN_CENTRE_MISMATCH",
                f"scan {scan_id} Image2D centre differs from its Data3D pose by {scan_centre_delta}",
            )
        pair_angles = _pair_angles_degrees([record["pose"]["rotationWxyz"] for record in records])
        angle_deviations = [min(abs(angle - 90.0), abs(angle - 180.0)) for angle in pair_angles]
        near_90 = sum(abs(angle - 90.0) <= 0.1 for angle in pair_angles)
        near_180 = sum(abs(angle - 180.0) <= 0.1 for angle in pair_angles)
        if near_90 != 12 or near_180 != 3:
            fail("NATIVE_CAMERA_RIG_NOT_CUBIC", f"scan {scan_id} camera axes are not a complete six-face rig")
        maximum_centre_spread = max(maximum_centre_spread, centre_spread)
        maximum_scan_centre_delta = max(maximum_scan_centre_delta, scan_centre_delta)
        maximum_cube_angle_deviation = max(maximum_cube_angle_deviation, max(angle_deviations))
        for record in records:
            guid = str(record["image2DGuid"])
            all_guids.append(guid)
            sha256 = str(record["jpeg"]["sha256"])
            all_hashes.setdefault(sha256, []).append(guid)
            total_bytes += int(record["jpeg"]["sizeBytes"])
            intrinsic_groups.setdefault(_intrinsic_key(record["intrinsics"]), record["intrinsics"])
            dimension_groups.add(
                (int(record["intrinsics"]["width"]), int(record["intrinsics"]["height"]))
            )
            image_signal_rows.append(
                (scan_id, guid, str(record["name"]), record["jpeg"]["signals"])
            )
            maximum_quaternion_norm_error = max(
                maximum_quaternion_norm_error,
                abs(float(record["pose"]["sourceQuaternionNorm"]) - 1.0),
            )
        scan_summaries.append(
            {
                "scanId": scan_id,
                "associatedData3DGuid": records[0]["associatedData3DGuid"],
                "imageCount": len(records),
                "names": [record["name"] for record in records],
                "maximumCameraCentreSpread": _round(centre_spread, 12),
                "maximumImageToScanCentreDelta": _round(scan_centre_delta, 12),
                "cameraPairAngles": {
                    "near90DegreeCount": near_90,
                    "near180DegreeCount": near_180,
                    "maximumIdealCubeDeviationDegrees": _round(max(angle_deviations), 6),
                },
                "images": records,
            }
        )

    if len(all_guids) != len(set(all_guids)):
        fail("DUPLICATE_IMAGE2D_GUID", "native E57 Image2D GUIDs are not unique")
    duplicate_blob_groups = [
        {"sha256": digest, "image2DGuids": guids}
        for digest, guids in sorted(all_hashes.items())
        if len(guids) > 1
    ]
    if duplicate_blob_groups:
        fail(
            "DUPLICATE_NATIVE_JPEG",
            "two or more native Image2D records contain exactly identical JPEG bytes",
        )
    orientation_medians = {
        name: float(
            np.median(
                [
                    signals["detailSignals"]["gradientEnergySigma1"]
                    for _, _, row_name, signals in image_signal_rows
                    if row_name == name
                ]
            )
        )
        for name in sorted({name for _, _, name, _ in image_signal_rows})
    }
    quality_reviews: list[dict[str, Any]] = []
    for scan_id, guid, name, signals in image_signal_rows:
        detail = float(signals["detailSignals"]["gradientEnergySigma1"])
        median_detail = orientation_medians[name]
        relative = detail / median_detail if median_detail > 0 else 0.0
        signals["detailSignals"]["relativeToSameRigCameraMedianSigma1"] = _round(relative)
        reasons: list[str] = []
        if relative < 0.5:
            reasons.append("multiscale_detail_below_half_native_set_median")
        luminance = signals["luminance"]
        if float(luminance["nearBlackFraction"]) > 0.2:
            reasons.append("more_than_twenty_percent_near_black")
        if float(luminance["nearWhiteFraction"]) > 0.2:
            reasons.append("more_than_twenty_percent_near_white")
        if float(luminance["p01ToP99Range"]) < 0.15:
            reasons.append("low_luminance_range")
        if reasons:
            quality_reviews.append(
                {"scanId": scan_id, "image2DGuid": guid, "name": name, "reasons": reasons}
            )
    manifest_rows = [
        {
            "scanId": int(scan["scanId"]),
            "associatedData3DGuid": str(scan["associatedData3DGuid"]),
            "images": [
                {
                    "image2DGuid": str(record["image2DGuid"]),
                    "name": str(record["name"]),
                    "jpegSha256": str(record["jpeg"]["sha256"]),
                    "jpegSizeBytes": int(record["jpeg"]["sizeBytes"]),
                    "intrinsicsSha256": _intrinsic_key(record["intrinsics"]),
                    "declaredPose": {
                        "rotationWxyz": record["pose"]["rotationWxyz"],
                        "translation": record["pose"]["translation"],
                    },
                }
                for record in scan["images"]
            ],
        }
        for scan in scan_summaries
    ]
    manifest_sha256 = hashlib.sha256(
        b"OMNITWIN_E57_NATIVE_IMAGE_MANIFEST_V1\0" + _canonical_json_bytes(manifest_rows)
    ).hexdigest()
    return {
        "complete": True,
        "sourceClass": "native_e57_pinhole_jpeg",
        "scanCount": len(scan_ids),
        "imageCount": len(all_guids),
        "uniqueImage2DGuidCount": len(set(all_guids)),
        "totalJpegBytesReadAndHashed": total_bytes,
        "intrinsicGroupCount": len(intrinsic_groups),
        "intrinsicGroups": [intrinsic_groups[key] for key in sorted(intrinsic_groups)],
        "imageDimensionGroups": [
            {"width": width, "height": height} for width, height in sorted(dimension_groups)
        ],
        "nativeImageManifestSha256": manifest_sha256,
        "duplicateBlobGroups": duplicate_blob_groups,
        "relativeQualityReviews": quality_reviews,
        "sameRigCameraMedianGradientEnergySigma1": {
            name: _round(value, 8) for name, value in orientation_medians.items()
        },
        "maximumCameraCentreSpread": _round(maximum_centre_spread, 12),
        "maximumImageToScanCentreDelta": _round(maximum_scan_centre_delta, 12),
        "maximumQuaternionNormError": _round(maximum_quaternion_norm_error, 12),
        "maximumIdealCubeDeviationDegrees": _round(maximum_cube_angle_deviation, 6),
        "scans": scan_summaries,
        "meaning": (
            "These JPEG bytes, intrinsics, Image2D GUIDs and declared camera metadata are read directly from the fingerprinted E57. "
            "This proves internal file completeness and declared associations only. It does not prove that the declared rotations physically register each photograph to the laser scan."
        ),
    }


def inspect_native_e57_images(
    e57_path: Path,
    scan_ids: Sequence[int],
    scan_poses: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    try:
        import pye57
    except ImportError:
        fail("PYE57_UNAVAILABLE", "pye57 is required to inspect native Image2D records")
    try:
        source = pye57.E57(str(e57_path))
        root = source.image_file.root()
        data3d = root["data3D"]
        images = root["images2D"]
        guid_to_scan: dict[str, int] = {}
        for index in range(data3d.childCount()):
            guid = str(data3d[index]["guid"].value())
            if guid in guid_to_scan:
                fail("DUPLICATE_DATA3D_GUID", f"Data3D GUID {guid} is repeated")
            guid_to_scan[guid] = index
        records_by_scan: dict[int, list[dict[str, Any]]] = {scan_id: [] for scan_id in scan_ids}
        target_set = set(scan_ids)
        for index in range(images.childCount()):
            image = images[index]
            associated_guid = str(image["associatedData3DGuid"].value())
            scan_id = guid_to_scan.get(associated_guid)
            if scan_id not in target_set:
                continue
            label = f"scan {scan_id} Image2D {index}"
            representation = image["pinholeRepresentation"]
            intrinsic = _intrinsic_record(representation, label)
            rotation, source_quaternion_norm = _node_quaternion(
                image["pose"]["rotation"],
                f"{label} quaternion",
            )
            translation = _node_translation(image["pose"]["translation"], f"{label} translation")
            blob = representation["jpegImage"]
            byte_count = int(blob.byteCount())
            if byte_count <= 0 or byte_count > MAX_IMAGE_BYTES:
                fail("INVALID_EMBEDDED_IMAGE_SIZE", f"{label} has invalid JPEG byte count {byte_count}")
            jpeg_bytes = bytearray(byte_count)
            blob.read(jpeg_bytes, 0, byte_count)
            candidate_colmap_world_to_camera, candidate_colmap_translation = (
                e57_pose_to_colmap_vertical_flip(rotation, translation)
            )
            records_by_scan[int(scan_id)].append(
                {
                    "image2DIndex": index,
                    "image2DGuid": str(image["guid"].value()),
                    "associatedData3DGuid": associated_guid,
                    "name": str(image["name"].value()),
                    "intrinsics": intrinsic,
                    "pose": {
                        "rotationWxyz": [_round(value, 10) for value in rotation],
                        "translation": [_round(value, 10) for value in translation],
                        "sourceQuaternionNorm": _round(source_quaternion_norm, 10),
                        "normalizedBeforeUse": True,
                        "candidateColmapAfterRequiredVerticalFlip": {
                            "status": "blocked_pending_hash_bound_lidar_reprojection",
                            "requiredRasterTransform": "vertical_flip",
                            "e57ToColmapCameraAxisRotation": [
                                [1.0, 0.0, 0.0],
                                [0.0, -1.0, 0.0],
                                [0.0, 0.0, -1.0],
                            ],
                            "worldToCameraQuaternionWxyz": _rotation_matrix_to_quaternion(
                                candidate_colmap_world_to_camera
                            ),
                            "translation": [
                                _round(value, 10) for value in candidate_colmap_translation
                            ],
                            "cheiralityRule": "a visible E57 point with z<0 becomes COLMAP z>0",
                            "warning": (
                                "This is a mathematically valid convention conversion, not proof that this file's declared Image2D rotation matches the photograph."
                            ),
                        },
                    },
                    "jpeg": inspect_jpeg_bytes(
                        jpeg_bytes,
                        label=label,
                        expected_dimensions=(intrinsic["width"], intrinsic["height"]),
                    ),
                }
            )
        return summarize_native_e57_records(records_by_scan, scan_poses, scan_ids)
    except AuditError:
        raise
    except Exception as error:
        fail("E57_NATIVE_IMAGE_READ_FAILED", f"could not inspect native E57 Image2D records: {error}")


def propose_station_split(
    candidate_scan_ids: Sequence[int],
    poses: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    ids = sorted(candidate_scan_ids)
    if len(ids) < 12:
        return {
            "status": "not_proposed",
            "reason": "At least twelve candidate camera stations are required to keep at least eight training stations while holding out validation and test stations.",
        }
    positions = {scan_id: np.asarray(poses[scan_id]["translation"], dtype=np.float64) for scan_id in ids}
    colocated_groups: list[list[int]] = []
    remaining = set(ids)
    while remaining:
        first = min(remaining)
        group = sorted(
            candidate
            for candidate in remaining
            if float(np.linalg.norm(positions[first] - positions[candidate]))
            <= COLOCATED_STATION_TOLERANCE
        )
        for candidate in group:
            remaining.remove(candidate)
        if len(group) > 1:
            colocated_groups.append(group)
    if colocated_groups:
        return {
            "status": "not_proposed",
            "reason": "Co-located or repeat station captures must be resolved as one equivalence group before splitting.",
            "coLocatedStationGroups": colocated_groups,
            "coLocationTolerance": COLOCATED_STATION_TOLERANCE,
        }

    def farthest_subset(pool: list[int], count: int) -> list[int]:
        if count <= 0:
            return []
        centre = np.mean(np.asarray([positions[scan_id] for scan_id in pool]), axis=0)
        selected = [max(pool, key=lambda scan_id: (float(np.linalg.norm(positions[scan_id] - centre)), -scan_id))]
        while len(selected) < count:
            remaining = [scan_id for scan_id in pool if scan_id not in selected]
            selected.append(
                max(
                    remaining,
                    key=lambda scan_id: (
                        min(float(np.linalg.norm(positions[scan_id] - positions[chosen])) for chosen in selected),
                        -scan_id,
                    ),
                )
            )
        return selected

    heldout_count_per_split = max(2, round(len(ids) * 0.15))
    heldout_order = farthest_subset(ids, heldout_count_per_split * 2)
    validation = sorted(heldout_order[::2])
    test = sorted(heldout_order[1::2])
    training = sorted(
        scan_id for scan_id in ids if scan_id not in set(validation + test)
    )
    return {
        "status": "technical_proposal_pending_human_review",
        "splitUnit": "complete_six-image_camera_station",
        "trainingScanIds": training,
        "validationScanIds": validation,
        "testScanIds": test,
        "actualFractions": {
            "training": _round(len(training) / len(ids), 6),
            "validation": _round(len(validation) / len(ids), 6),
            "test": _round(len(test) / len(ids), 6),
        },
        "leakageGuard": "All six embedded E57 Image2D skybox JPEGs and every LiDAR/point record from one E57 station stay in the same split. Validation/test station geometry cannot initialize, supervise, register, mask, or tune the training candidate.",
        "algorithm": "Hold out max(2, round(15%)) stations per evaluation split. Select their union with deterministic farthest-point sampling, then alternate into validation and test. Exact duplicate JPEGs are rejected and co-located stations block the proposal.",
        "meaning": "Spatial farthest-point selection spreads validation and test stations; it does not prove every hero feature is represented.",
    }


def station_connectivity(
    scan_ids: Sequence[int],
    poses: dict[int, dict[str, Any]],
    thresholds: Sequence[float] = (2.0, 2.5),
) -> dict[str, Any]:
    ids = sorted(scan_ids)
    positions = {
        scan_id: np.asarray(poses[scan_id]["translation"], dtype=np.float64)
        for scan_id in ids
    }
    results = []
    for threshold in thresholds:
        remaining = set(ids)
        components: list[list[int]] = []
        while remaining:
            start = min(remaining)
            remaining.remove(start)
            queue = [start]
            component = [start]
            while queue:
                current = queue.pop(0)
                neighbors = [
                    candidate
                    for candidate in sorted(remaining)
                    if float(
                        np.linalg.norm(positions[current] - positions[candidate])
                    )
                    <= threshold
                ]
                for neighbor in neighbors:
                    remaining.remove(neighbor)
                    queue.append(neighbor)
                    component.append(neighbor)
            components.append(sorted(component))
        results.append(
            {
                "threshold": _round(threshold, 3),
                "componentCount": len(components),
                "components": components,
            }
        )
    return {
        "stationCount": len(ids),
        "thresholdResults": results,
        "meaning": "Connectivity by camera-centre distance is a coverage warning, not proof that surfaces overlap or feature matching will succeed.",
    }


def coverage_summary(poses: dict[int, dict[str, Any]]) -> dict[str, Any]:
    ordered = np.asarray([poses[index]["translation"] for index in sorted(poses)], dtype=np.float64)
    if len(ordered) < 3:
        fail("INSUFFICIENT_POSES", "at least three scan poses are required")
    deltas = ordered[:, None, :] - ordered[None, :, :]
    distances = np.linalg.norm(deltas, axis=2)
    np.fill_diagonal(distances, np.inf)
    nearest = np.min(distances, axis=1)
    centred = ordered - np.mean(ordered, axis=0)
    _, singular_values, vh = np.linalg.svd(centred, full_matrices=False)
    tolerance = max(float(singular_values[0]) if len(singular_values) else 0.0, 1.0) * 1e-10
    spatial_rank = int(np.sum(singular_values > tolerance))
    hull_area = 0.0
    hull_status = "degenerate_rank_below_two"
    if spatial_rank >= 2:
        plane = centred @ vh[:2].T
        try:
            hull_area = float(ConvexHull(plane).volume)
            hull_status = "computed"
        except QhullError:
            hull_status = "qhull_degenerate"
    return {
        "stationCount": len(ordered),
        "coordinateExtents": {
            "x": _round(np.ptp(ordered[:, 0])),
            "y": _round(np.ptp(ordered[:, 1])),
            "z": _round(np.ptp(ordered[:, 2])),
        },
        "nearestStationDistance": {
            "minimum": _round(np.min(nearest)),
            "median": _round(np.median(nearest)),
            "maximum": _round(np.max(nearest)),
        },
        "bestFitPlaneHullAreaSquareUnits": _round(hull_area),
        "hullStatus": hull_status,
        "spatialRank": spatial_rank,
        "spatiallyDiverse": spatial_rank >= 2 and hull_area > 0,
        "centredPositionSingularValues": [_round(value) for value in singular_values],
        "meaning": "This describes camera-station spread only; it does not prove surface coverage, scale units, room identity, or metric accuracy.",
    }


def load_visual_review(
    path: Path | None,
    scan_ids: Sequence[int],
    *,
    source_e57_sha256: str,
    panorama_sha256_by_scan: dict[int, str],
) -> tuple[dict[str, Any] | None, set[int]]:
    if path is None:
        return None, set()
    raw, file_evidence = _read_bounded_json(
        path,
        label="visual review",
        maximum_bytes=1024 * 1024,
        invalid_code="VISUAL_REVIEW_INVALID",
    )
    if raw.get("schemaVersion") != REVIEW_SCHEMA_VERSION:
        fail("VISUAL_REVIEW_INVALID", f"visual review must use {REVIEW_SCHEMA_VERSION}")
    if raw.get("scanIds") != list(scan_ids):
        fail("VISUAL_REVIEW_SCOPE_MISMATCH", "visual review scanIds do not exactly match this audit")
    if raw.get("sourceE57Sha256") != source_e57_sha256:
        fail("VISUAL_REVIEW_SOURCE_MISMATCH", "visual review is not bound to this exact E57")
    if raw.get("reviewTargetClass") != "loose_derived_panoramas":
        fail("VISUAL_REVIEW_INVALID", "this review must identify its target as loose_derived_panoramas")
    if raw.get("decisionsAreQuarantineOnly") is not True:
        fail("VISUAL_REVIEW_INVALID", "derived-panorama decisions must be quarantine-only")
    if raw.get("requiresHumanConfirmation") is not True:
        fail("VISUAL_REVIEW_INVALID", "vision-model screening must explicitly require human confirmation")
    if raw.get("authority") != "none":
        fail("VISUAL_REVIEW_INVALID", "visual review authority must be none")
    review_method = raw.get("reviewMethod")
    if not isinstance(review_method, str) or not review_method.strip():
        fail("VISUAL_REVIEW_INVALID", "visual review must name a non-empty review method")
    reported_hashes = raw.get("reviewedPanoramaSha256ByScanId")
    expected_hashes = {str(scan_id): panorama_sha256_by_scan[scan_id] for scan_id in scan_ids}
    if reported_hashes != expected_hashes:
        fail(
            "VISUAL_REVIEW_ARTIFACT_MISMATCH",
            "visual review is not bound to every exact panorama byte inspected by this audit",
        )
    quarantines = raw.get("quarantinedScans")
    if not isinstance(quarantines, list):
        fail("VISUAL_REVIEW_INVALID", "visual review quarantinedScans must be a list")
    quarantined_ids: set[int] = set()
    for item in quarantines:
        if not isinstance(item, dict) or set(item) != {"scanId", "reason"}:
            fail("VISUAL_REVIEW_INVALID", "each quarantine needs only scanId and reason")
        scan_id = item["scanId"]
        reason = item["reason"]
        if not isinstance(scan_id, int) or scan_id not in scan_ids:
            fail("VISUAL_REVIEW_INVALID", "visual review contains an out-of-scope scan")
        if scan_id in quarantined_ids or not isinstance(reason, str) or not reason.strip():
            fail("VISUAL_REVIEW_INVALID", "visual review quarantines must be unique and have a reason")
        quarantined_ids.add(scan_id)
    challenges = raw.get("boundaryChallengeScans", [])
    if not isinstance(challenges, list):
        fail("VISUAL_REVIEW_INVALID", "visual review boundaryChallengeScans must be a list")
    challenge_ids: set[int] = set()
    for item in challenges:
        if not isinstance(item, dict) or set(item) != {"scanId", "reason"}:
            fail("VISUAL_REVIEW_INVALID", "each boundary challenge needs only scanId and reason")
        scan_id = item["scanId"]
        reason = item["reason"]
        if not isinstance(scan_id, int) or scan_id not in scan_ids:
            fail("VISUAL_REVIEW_INVALID", "visual review contains an out-of-scope boundary scan")
        if scan_id in quarantined_ids or scan_id in challenge_ids:
            fail("VISUAL_REVIEW_INVALID", "boundary scans must be unique and cannot also be quarantined")
        if not isinstance(reason, str) or not reason.strip():
            fail("VISUAL_REVIEW_INVALID", "boundary challenges must have a reason")
        challenge_ids.add(scan_id)
    orientation = raw.get("derivedCubefaceOrientationReview")
    if orientation is not None:
        if not isinstance(orientation, dict) or orientation.get("status") not in {
            "systematic_inconsistency_observed_unverified",
            "not_reviewed",
        }:
            fail("VISUAL_REVIEW_INVALID", "derived orientation status is not recognized")
    return {
        **file_evidence,
        "reviewTargetClass": "loose_derived_panoramas",
        "reviewMethod": review_method,
        "requiresHumanConfirmation": True,
        "decisionsAreQuarantineOnly": True,
        "nativeImageReviewComplete": False,
        "quarantinedScans": quarantines,
        "boundaryChallengeScans": challenges,
        "observations": raw.get("observations", []),
        "derivedCubefaceOrientationReview": orientation,
        "binding": {
            "sourceE57Sha256": source_e57_sha256,
            "reviewedPanoramaSha256ByScanId": expected_hashes,
        },
        "plainLanguage": (
            "This hash-bound model screening reviewed the loose derived panoramas, not the 138 embedded native JPEGs. "
            "Its flags can quarantine stations conservatively but cannot clear any station for training."
        ),
    }, quarantined_ids


def inspect_derivation_evidence(
    *,
    label: str,
    script_path: Path | None,
    report_path: Path | None,
    scan_ids: Sequence[int],
    expected_output_sha256: dict[str, str],
    source_e57_sha256: str,
    native_image_manifest_sha256: str,
) -> dict[str, Any]:
    evidence: dict[str, Any] = {
        "label": label,
        "script": None,
        "report": None,
        "reportedScanIds": [],
        "missingScanIds": list(scan_ids),
        "outputHashMentionsMatchCurrentBytes": False,
        "missingOrMismatchedOutputPaths": sorted(expected_output_sha256),
        "strictReceiptSchemaPresent": False,
        "contentBindingVerified": False,
        "provenanceAuthenticated": False,
        "lineageVerified": False,
        "usableForPoseBinding": False,
    }
    script_sha256: str | None = None
    if script_path is not None:
        stat = _safe_regular_file(script_path, f"{label} script", MAX_LINEAGE_ARTIFACT_BYTES)
        script_sha256 = _sha256_file(script_path, stat, MAX_LINEAGE_ARTIFACT_BYTES)
        evidence["script"] = {
            "fileName": script_path.name,
            "sizeBytes": stat.st_size,
            "sha256": script_sha256,
        }
    if report_path is not None:
        raw, report_evidence = _read_bounded_json(
            report_path,
            label=f"{label} report",
            maximum_bytes=MAX_LINEAGE_ARTIFACT_BYTES,
            invalid_code="DERIVATION_REPORT_INVALID",
        )
        reported: set[int] = set()
        if isinstance(raw.get("sweeps"), dict):
            for key in raw["sweeps"]:
                match = re.fullmatch(r"scan_([0-9]{3})", str(key))
                if match is not None:
                    reported.add(int(match.group(1)))
        scoped = sorted(set(scan_ids).intersection(reported))
        output_hashes = raw.get("outputSha256ByRelativePath")
        missing_or_mismatched = sorted(
            path
            for path, expected_sha256 in expected_output_sha256.items()
            if not isinstance(output_hashes, dict)
            or output_hashes.get(path) != expected_sha256
        )
        hash_mentions_match = not missing_or_mismatched
        evidence["report"] = {
            **report_evidence,
            "totalReportedScans": len(reported),
        }
        evidence["reportedScanIds"] = scoped
        evidence["missingScanIds"] = sorted(set(scan_ids).difference(reported))
        evidence["outputHashMentionsMatchCurrentBytes"] = hash_mentions_match
        evidence["missingOrMismatchedOutputPaths"] = missing_or_mismatched
        strict = raw.get("schemaVersion") == DERIVATION_RECEIPT_SCHEMA_VERSION
        evidence["strictReceiptSchemaPresent"] = strict
        outputs = raw.get("outputs")
        output_rows_valid = isinstance(outputs, list) and all(
            isinstance(row, dict)
            and set(row) == {"scanId", "relativePath", "sha256"}
            and isinstance(row.get("scanId"), int)
            and isinstance(row.get("relativePath"), str)
            and isinstance(row.get("sha256"), str)
            for row in (outputs if isinstance(outputs, list) else [])
        )
        receipt_output_map = (
            {str(row["relativePath"]): str(row["sha256"]) for row in outputs}
            if output_rows_valid
            else {}
        )
        output_scan_ids = (
            sorted({int(row["scanId"]) for row in outputs}) if output_rows_valid else []
        )
        extractor = raw.get("extractor")
        invocation = raw.get("invocation")
        evidence["contentBindingVerified"] = bool(
            strict
            and script_sha256 is not None
            and raw.get("sourceE57Sha256") == source_e57_sha256
            and raw.get("sourceNativeImageManifestSha256")
            == native_image_manifest_sha256
            and isinstance(extractor, dict)
            and extractor.get("sha256") == script_sha256
            and isinstance(invocation, dict)
            and invocation.get("selectedScanIds") == list(scan_ids)
            and isinstance(invocation.get("arguments"), list)
            and output_rows_valid
            and output_scan_ids == list(scan_ids)
            and receipt_output_map == expected_output_sha256
        )
    evidence["plainLanguage"] = (
        "The old extraction JSON is descriptive evidence only. Matching filenames and hashes can detect a mismatch, but a self-authored local report does not authenticate who derived the files, when, or from which physical camera orientation. Loose derived images remain diagnostic-only and have no admitted pose binding."
    )
    return evidence


def finalize_report(report: dict[str, Any]) -> dict[str, Any]:
    payload = dict(report)
    payload.pop("payloadSha256", None)
    digest = hashlib.sha256(REPORT_DIGEST_DOMAIN + _canonical_json_bytes(payload)).hexdigest()
    return {**payload, "payloadSha256": digest}


def verify_payload_digest(report: dict[str, Any]) -> bool:
    expected = report.get("payloadSha256")
    if not isinstance(expected, str):
        return False
    return finalize_report(report).get("payloadSha256") == expected


def write_create_only(path: Path, payload: bytes) -> None:
    """Publish fully written bytes atomically without ever replacing a path."""

    temporary_path: Path | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{path.name}.",
            suffix=".tmp",
            dir=path.parent,
        )
        temporary_path = Path(temporary_name)
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(payload)
            destination.flush()
            os.fsync(destination.fileno())
        os.link(temporary_path, path)
    except FileExistsError:
        fail("OUTPUT_EXISTS", "output already exists; evidence files are create-only")
    except OSError as error:
        fail("OUTPUT_WRITE_FAILED", f"could not publish output: {error}")
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass


def build_audit(
    *,
    e57_path: Path,
    panorama_dir: Path,
    cubemap_dir: Path,
    scan_ids: Sequence[int],
    panorama_dimensions: tuple[int, int] = (8192, 4096),
    cubemap_dimensions: tuple[int, int] = (1536, 1536),
    visual_review_path: Path | None = None,
    panorama_derivation_script: Path | None = None,
    panorama_derivation_report: Path | None = None,
    cubeface_derivation_script: Path | None = None,
    cubeface_derivation_report: Path | None = None,
) -> dict[str, Any]:
    if not scan_ids or len(set(scan_ids)) != len(scan_ids) or list(scan_ids) != sorted(scan_ids):
        fail("INVALID_SCAN_SET", "scan IDs must be a non-empty, strictly increasing unique list")
    if panorama_dir.is_symlink() or cubemap_dir.is_symlink():
        fail("UNSAFE_SYMLINK", "image roots must not be symbolic links")
    if not panorama_dir.is_dir() or not cubemap_dir.is_dir():
        fail("MISSING_DIRECTORY", "panorama and cubemap directories must exist")

    e57_before = _safe_regular_file(e57_path, "E57 source", MAX_E57_BYTES)
    e57_sha256 = _sha256_file(e57_path, e57_before, MAX_E57_BYTES)
    poses, source_scan_count = load_e57_poses(e57_path, scan_ids)
    native_images = inspect_native_e57_images(e57_path, scan_ids, poses)
    e57_after = _safe_regular_file(e57_path, "E57 source", MAX_E57_BYTES)
    if not _same_file_identity(e57_before, e57_after):
        fail("FILE_CHANGED_DURING_READ", "the E57 source changed during its hash and pose audit")
    scans: list[dict[str, Any]] = []
    panorama_grayscale: dict[int, np.ndarray] = {}
    panorama_energy: list[float] = []
    total_bytes = 0

    for scan_id in scan_ids:
        panorama = inspect_image(
            panorama_dir / f"scan_{scan_id:03d}_8192.jpg",
            expected_dimensions=panorama_dimensions,
            thumbnail_dimensions=(512, 256),
        )
        panorama_grayscale[scan_id] = panorama.grayscale
        panorama_energy.append(panorama.evidence["signals"]["detailSignals"]["gradientEnergySigma1"])
        total_bytes += int(panorama.evidence["sizeBytes"])
        faces: list[dict[str, Any]] = []
        for face in FACES:
            inspected = inspect_image(
                cubemap_dir / f"scan_{scan_id:03d}_{face}.jpg",
                expected_dimensions=cubemap_dimensions,
                thumbnail_dimensions=(256, 256),
            )
            total_bytes += int(inspected.evidence["sizeBytes"])
            faces.append(
                {
                    "face": face,
                    **inspected.evidence,
                    "poseBinding": {
                        "status": "blocked",
                        "reason": "Loose derived face labels are not pose authority. The native E57 metadata is only a reprojection candidate and is not yet an accepted pose.",
                    },
                }
            )
        scans.append(
            {
                "scanId": scan_id,
                "pose": poses[scan_id],
                "panorama": panorama.evidence,
                "cubefaces": faces,
                "visualReviewState": "not_cleared_native_review_required",
            }
        )

    panorama_sha256_by_scan = {
        int(scan["scanId"]): str(scan["panorama"]["sha256"]) for scan in scans
    }
    visual_review, quarantined_ids = load_visual_review(
        visual_review_path,
        scan_ids,
        source_e57_sha256=e57_sha256,
        panorama_sha256_by_scan=panorama_sha256_by_scan,
    )
    for scan in scans:
        if int(scan["scanId"]) in quarantined_ids:
            scan["visualReviewState"] = "provisionally_quarantined_from_derived_panorama_screening"

    panorama_lineage = inspect_derivation_evidence(
        label="panorama derivation",
        script_path=panorama_derivation_script,
        report_path=panorama_derivation_report,
        scan_ids=scan_ids,
        expected_output_sha256={
            str(scan["panorama"]["fileName"]): str(scan["panorama"]["sha256"])
            for scan in scans
        },
        source_e57_sha256=e57_sha256,
        native_image_manifest_sha256=str(native_images["nativeImageManifestSha256"]),
    )
    cubeface_lineage = inspect_derivation_evidence(
        label="cubeface derivation",
        script_path=cubeface_derivation_script,
        report_path=cubeface_derivation_report,
        scan_ids=scan_ids,
        expected_output_sha256={
            str(face["fileName"]): str(face["sha256"])
            for scan in scans
            for face in scan["cubefaces"]
        },
        source_e57_sha256=e57_sha256,
        native_image_manifest_sha256=str(native_images["nativeImageManifestSha256"]),
    )

    median_energy = float(np.median(np.asarray(panorama_energy)))
    relative_detail_reviews: list[dict[str, Any]] = []
    for scan, energy in zip(scans, panorama_energy):
        ratio = energy / median_energy if median_energy > 0 else 0.0
        scan["panorama"]["signals"]["detailSignals"]["relativeToSetMedianSigma1"] = _round(ratio)
        if ratio < 0.5:
            relative_detail_reviews.append(
                {"scanId": scan["scanId"], "reason": "panorama_multiscale_detail_below_half_set_median"}
            )

    continuity: list[dict[str, Any]] = []
    for first_id, second_id in zip(scan_ids, scan_ids[1:]):
        continuity.append(
            {
                "firstScanId": first_id,
                "secondScanId": second_id,
                **best_circular_ncc(panorama_grayscale[first_id], panorama_grayscale[second_id]),
                "meaning": "A high value supports visual continuity after yaw alignment; it does not certify room identity or reject local moving objects.",
            }
        )

    candidate_ids = [scan_id for scan_id in scan_ids if scan_id not in quarantined_ids]
    boundary_challenge_ids = sorted(
        int(item["scanId"])
        for item in (
            visual_review.get("boundaryChallengeScans", [])
            if isinstance(visual_review, dict)
            else []
        )
    )
    core_candidate_ids = [
        scan_id for scan_id in candidate_ids if scan_id not in boundary_challenge_ids
    ]
    orientation_review = (
        visual_review.get("derivedCubefaceOrientationReview")
        if isinstance(visual_review, dict)
        else None
    )
    derived_orientation_inconsistency_observed = bool(
        isinstance(orientation_review, dict)
        and orientation_review.get("status")
        == "systematic_inconsistency_observed_unverified"
    )
    dimension_text = ", ".join(
        f'{group["width"]}x{group["height"]}'
        for group in native_images.get("imageDimensionGroups", [])
    ) or "reported native dimensions"
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "scope": {
            "scanIds": list(scan_ids),
            "sourceE57FileName": e57_path.name,
            "sourceE57SizeBytes": e57_before.st_size,
            "sourceE57Sha256": e57_sha256,
            "sourceE57ScanCount": source_scan_count,
            "panoramaNaming": "scan_NNN_8192.jpg",
            "cubefaceNaming": "scan_NNN_{front,back,left,right,up,down}.jpg",
        },
        "runtime": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "pillow": getattr(Image, "__version__", "unknown"),
            "pye57": importlib.metadata.version("pye57"),
            "toolSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        },
        "counts": {
            "scans": len(scans),
            "panoramas": len(scans),
            "cubefaces": len(scans) * len(FACES),
            "poseBoundLooseDerivedCubefaces": 0,
            "nativeE57PinholeImages": native_images["imageCount"],
            "nativeE57ImageBytesReadAndHashed": native_images["totalJpegBytesReadAndHashed"],
            "provisionalCandidateScansPendingNativeReview": len(candidate_ids),
            "provisionalCoreScansAfterBoundarySeparation": len(core_candidate_ids),
            "totalImageBytesReadAndHashed": total_bytes,
        },
        "coverage": coverage_summary(poses),
        "nativeE57Images": native_images,
        "relativeDetailReviews": relative_detail_reviews,
        "adjacentPanoramaContinuity": continuity,
        "visualReview": visual_review,
        "derivationEvidence": {
            "panoramas": panorama_lineage,
            "cubefaces": cubeface_lineage,
            "looseDerivedImagePoseBindingAdmitted": False,
        },
        "scans": scans,
        "technicalDecision": {
            "selectedNativeRecordsCompleteAndDecodable": True,
            "finiteE57PoseSet": True,
            "e57DeclaredImageToData3DAssociationsResolved": True,
            "physicalImageToLaserRegistrationVerified": False,
            "nativeImageScaffoldCandidate": True,
            "nativeKnownPoseScaffoldVerified": False,
            "knownPoseReady": False,
            "nativePoseStatus": "conflicting_evidence_requires_hash_bound_lidar_reprojection",
            "derivedImagePoseBindingVerified": False,
            "derivedOrientationInconsistencyObserved": derived_orientation_inconsistency_observed,
            "derivedKnownPoseScaffoldVerified": False,
            "recommendedTechnicalSource": "native_e57_jpeg_only_after_pose_reprojection",
            "provisionalCandidateScanIdsPendingNativeReview": candidate_ids,
            "provisionalCoreScanIdsPendingNativeReview": core_candidate_ids,
            "boundaryChallengeScanIds": boundary_challenge_ids,
            "provisionallyQuarantinedScanIds": sorted(quarantined_ids),
            "provisionalConnectivityAfterModelQuarantine": station_connectivity(candidate_ids, poses),
            "provisionalCoreConnectivity": station_connectivity(core_candidate_ids, poses),
            "proposedStationSplit": propose_station_split(core_candidate_ids, poses),
            "requiredBeforeMaterialization": [
                f"A person reviews every embedded E57 {dimension_text} Image2D skybox JPEG at full resolution.",
                "Every admitted station receives an explicit nadir/tripod privacy mask.",
                "A hash-bound LiDAR-to-native-photo reprojection test proves the camera optical axis, rotation direction, handedness, focal convention, and required raster flip on several non-symmetric stations.",
                "Authoritative rights approval permits the intended processing and commercial training purpose.",
            ],
            "status": "known_pose_not_ready_reprojection_and_review_required",
            "plainLanguage": (
                f"The selected E57 range contains a complete internally associated set of {dimension_text} embedded Image2D skybox JPEGs and declared camera metadata. These are the highest-resolution images inside this E57, not proven sensor-original photographs. "
                "That makes it worth a laser-to-photo reprojection test, but it is not a verified known-pose training set. "
                "The loose derived cube faces carry no admitted pose binding. Scans flagged by derived-panorama screening are quarantined only provisionally; every embedded JPEG still needs full-resolution human review, privacy masking, and rights approval."
            ),
        },
        "authorizationDecision": {
            "trainingPermitted": False,
            "status": "blocked_pending_authoritative_rights_review",
            "plainLanguage": (
                "Possessing or decoding an E57 export does not establish permission to use its photographs, poses, or derivatives for commercial model training."
            ),
        },
        "limitations": [
            "The computer-vision signals are relative screening measurements, not a universal image-quality score.",
            "Circular panorama correlation is compatible with one room but cannot prove room identity and can hide small moving objects.",
            "A systematic orientation inconsistency was observed in the loose derived cube faces, but the exact proposed remapping is not hash-bound proof. Their labels and poses are not admitted.",
            "E57 camera fields are present, but no accepted COLMAP extrinsic exists yet. E57's documented pinhole model sees points at negative camera Z, and a vertical raster flip plus camera-axis conversion is required even if the declared rotations prove physically correct.",
            "Existing local extraction scripts make conflicting claims about the native Image2D rotations. This audit does not blame the source data; it treats the current interpretation as conflicted until direct LiDAR-to-photo reprojection settles it.",
            "Camera-station spread does not prove that every wall, ceiling, ornament, or hidden surface has enough angular coverage.",
            "No source file was copied, changed, staged, uploaded, reconstructed, trained on, or published by this audit.",
        ],
        "selfDigestMeaning": {
            "authenticatesCreator": False,
            "provesTimestamp": False,
            "provesImmutability": False,
            "plainLanguage": "The payload SHA-256 detects an unrecomputed change or accidental corruption only. Anyone can recompute it; it does not prove author, time, truth, rights, or immutability.",
        },
        "authority": "none",
    }
    return finalize_report(report)


def parse_scan_ids(value: str) -> list[int]:
    result: list[int] = []
    for token in value.split(","):
        token = token.strip()
        if not token:
            fail("INVALID_SCAN_SET", "scan list contains an empty item")
        if "-" in token:
            parts = token.split("-")
            if len(parts) != 2:
                fail("INVALID_SCAN_SET", f"invalid scan range: {token}")
            start, end = (int(part) for part in parts)
            if start > end:
                fail("INVALID_SCAN_SET", f"scan range runs backwards: {token}")
            result.extend(range(start, end + 1))
        else:
            result.append(int(token))
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Read-only CV and known-pose readiness audit for an E57 room scan range."
    )
    parser.add_argument("--e57", required=True, type=Path)
    parser.add_argument("--panoramas", required=True, type=Path)
    parser.add_argument("--cubefaces", required=True, type=Path)
    parser.add_argument("--scans", required=True, help="Example: 122-144 or 122,124,130")
    parser.add_argument("--visual-review", type=Path)
    parser.add_argument("--panorama-derivation-script", type=Path)
    parser.add_argument("--panorama-derivation-report", type=Path)
    parser.add_argument("--cubeface-derivation-script", type=Path)
    parser.add_argument("--cubeface-derivation-report", type=Path)
    parser.add_argument("--output", type=Path, help="Write canonical JSON here; stdout is used when omitted")
    args = parser.parse_args(argv)
    try:
        report = build_audit(
            e57_path=args.e57.resolve(strict=True),
            panorama_dir=args.panoramas.resolve(strict=True),
            cubemap_dir=args.cubefaces.resolve(strict=True),
            scan_ids=parse_scan_ids(args.scans),
            visual_review_path=args.visual_review.resolve(strict=True) if args.visual_review else None,
            panorama_derivation_script=args.panorama_derivation_script.resolve(strict=True) if args.panorama_derivation_script else None,
            panorama_derivation_report=args.panorama_derivation_report.resolve(strict=True) if args.panorama_derivation_report else None,
            cubeface_derivation_script=args.cubeface_derivation_script.resolve(strict=True) if args.cubeface_derivation_script else None,
            cubeface_derivation_report=args.cubeface_derivation_report.resolve(strict=True) if args.cubeface_derivation_report else None,
        )
        output = _canonical_json_bytes(report) + b"\n"
        if args.output is None:
            sys.stdout.buffer.write(output)
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            write_create_only(args.output, output)
        return 0
    except (AuditError, FileNotFoundError, ValueError) as error:
        if isinstance(error, AuditError):
            payload = {"error": {"code": error.code, "message": error.message}}
        else:
            payload = {"error": {"code": "INVALID_ARGUMENT", "message": str(error)}}
        sys.stderr.write(_canonical_json_bytes(payload).decode("utf-8") + "\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
