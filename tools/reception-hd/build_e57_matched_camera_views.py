#!/usr/bin/env python3
"""Build development-only viewer cameras from frozen E57 evidence receipts.

This tool reads two JSON evidence files and writes one create-only JSON receipt.
It does not open the E57, JPEGs, an exported pose file, or any frozen-test data.
Only scans 131, 134, and 138 at Skybox 4 contribute camera records.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import sys
import tempfile
from typing import Any, Iterable, Sequence


OUTPUT_SCHEMA_VERSION = "omnitwin.reception.e57-matched-camera-views.v1"
REGISTRATION_SCHEMA_VERSION = (
    "omnitwin.reception.potree-e57-validation-proper-vs-mirror.v0"
)
REPROJECTION_SCHEMA_VERSION = "omnitwin.reception.e57-lidar-image-reprojection.v1"
REGISTRATION_PAYLOAD_SHA256 = (
    "6efde23f40da53cf8c20f65aef1b7656ac49daf7e5413a7ca9e9444ec374aa50"
)
REPROJECTION_PAYLOAD_SHA256 = (
    "a1482521518db90fb0edd41855a2be34efc28b45a348e64358b18d78d09f784c"
)
E57_SHA256 = "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd"
EXPECTED_SCAN_IDS = (131, 134, 138)
FROZEN_TEST_SCAN_IDS = (126, 129, 141)
SKYBOX_NAME = "Skybox 4"
EXPECTED_CANDIDATE_ID = "forward_+Y_right_+X_proper"
EXPECTED_RELATIONSHIP = (
    "raw JPEG vertical order is reversed relative to the documented E57 pinhole "
    "raster relationship"
)
EXPECTED_PRINCIPAL_Y_RULE = (
    "cy_raw_colmap = imageHeight - cy_e57 under the file-specific vertical raster "
    "relationship"
)
EXPECTED_POSE_SOURCE = (
    "E57 Image2D rotation transformed by diag(1,-1,-1), tested against the "
    "file-specific raw-JPEG/point-colour vertical relation"
)
EXPECTED_INTRINSICS = (2048.0, 2048.0, 2048.0, 2048.0)
EXPECTED_REGISTRATION_ROTATION = (
    (-0.9767424772079121, -0.2144157951685259, 0.0),
    (0.2144157951685259, -0.9767424772079121, 0.0),
    (0.0, 0.0, 1.0),
)
EXPECTED_REGISTRATION_TRANSLATION = (
    13.129636870981638,
    1.8645790764845938,
    -1.4672480408373136,
)
EXPECTED_IMAGES: dict[int, dict[str, Any]] = {
    131: {
        "image2DIndex": 790,
        "image2DGuid": "8097472603f345209d113cc905191ea4",
        "data3DGuid": "8097472603f345209d113cc905191e9f",
        "jpegSha256": "ef176883c2426d116de26f79f70c988dbbda27fe37b6e1197f0e0df8819ecbff",
        "jpegSizeBytes": 2_533_560,
        "width": 4096,
        "height": 4096,
    },
    134: {
        "image2DIndex": 808,
        "image2DGuid": "5a58245f2e7a42c98a8aee9c666c8637",
        "data3DGuid": "5a58245f2e7a42c98a8aee9c666c8632",
        "jpegSha256": "73292913ed862e633af7497f6d39de32e616feb83a7c6735960e5f460f6d41d1",
        "jpegSizeBytes": 2_604_201,
        "width": 4096,
        "height": 4096,
    },
    138: {
        "image2DIndex": 832,
        "image2DGuid": "393151089e5642d9bd8c51d3167cad16",
        "data3DGuid": "393151089e5642d9bd8c51d3167cad11",
        "jpegSha256": "acc4cb20cba9caf868f65f471eae29b2d7f790bbce69b197dec338c0ccc1a191",
        "jpegSizeBytes": 2_853_976,
        "width": 4096,
        "height": 4096,
    },
}
Q_XGRIDS_TO_VIEWER = (
    (1.0, 0.0, 0.0),
    (0.0, 0.0, 1.0),
    (0.0, -1.0, 0.0),
)
LOOK_DISTANCE_METERS = 5.0
MAX_REPORT_BYTES = 4_000_000
MAX_TOOL_BYTES = 1_000_000
NUMERIC_TOLERANCE = 1e-8
OUTPUT_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_E57_MATCHED_CAMERA_VIEWS_V1\0"
REPROJECTION_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_E57_LIDAR_IMAGE_REPROJECTION_V1\0"

ROW_KEYS = {
    "candidateDiagnostics",
    "coarseEmpiricalRawRasterColmapPoseDiagnostic",
    "continuousRawRasterColmapPoseCandidate",
    "data3DGuid",
    "declaredImage2DRotation",
    "declaredImage2DRotationLegacyPositiveZCheck",
    "declaredIntrinsics",
    "declaredRotationPlusFileSpecificRawRasterRelation",
    "evaluationRole",
    "fixedMappingEvaluation",
    "image2DGuid",
    "image2DIndex",
    "jpeg",
    "name",
    "scanId",
    "winner",
}
POSE_KEYS = {
    "camera",
    "cameraCentre",
    "meaning",
    "rasterTransform",
    "source",
    "status",
    "translation",
    "worldToCameraQuaternionWxyz",
}
CAMERA_KEYS = {"model", "parameters", "principalYRule"}
JPEG_KEYS = {"height", "sha256", "sizeBytes", "width"}
INTRINSIC_KEYS = {"cx", "cy", "fx", "fy"}


class CameraReceiptError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


def fail(code: str, message: str) -> None:
    raise CameraReceiptError(code, message)


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail("DUPLICATE_JSON_KEY", f"JSON object repeats key {key!r}")
        result[key] = value
    return result


def _reject_nonfinite_json(value: str) -> None:
    fail("NONFINITE_JSON_NUMBER", f"JSON contains forbidden numeric literal {value}")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _read_json(path: Path, label: str) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        resolved = path.expanduser().resolve(strict=True)
        before = resolved.stat()
    except (OSError, RuntimeError) as error:
        fail("INPUT_NOT_READABLE", f"{label} cannot be opened: {error}")
    if resolved.suffix.lower() != ".json" or not stat.S_ISREG(before.st_mode):
        fail("INVALID_INPUT_PATH", f"{label} must be a regular .json file")
    if before.st_size <= 0 or before.st_size > MAX_REPORT_BYTES:
        fail("INVALID_INPUT_SIZE", f"{label} exceeds its bounded JSON size")
    try:
        raw = resolved.read_bytes()
        after = resolved.stat()
        document = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_nonfinite_json,
        )
    except CameraReceiptError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail("INVALID_INPUT_JSON", f"{label} is not strict UTF-8 JSON: {error}")
    identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
    if identity_before != identity_after or len(raw) != before.st_size:
        fail("INPUT_CHANGED_DURING_READ", f"{label} changed while it was read")
    if not isinstance(document, dict):
        fail("INVALID_INPUT_JSON", f"{label} root must be an object")
    evidence = {
        "path": str(resolved),
        "sha256": _sha256_bytes(raw),
        "sizeBytes": len(raw),
    }
    return document, evidence


def _tool_evidence(path: Path) -> dict[str, Any]:
    try:
        resolved = path.resolve(strict=True)
        before = resolved.stat()
        raw = resolved.read_bytes()
        after = resolved.stat()
    except (OSError, RuntimeError) as error:
        fail("TOOL_NOT_READABLE", f"cannot hash this tool: {error}")
    if (
        not stat.S_ISREG(before.st_mode)
        or before.st_size <= 0
        or before.st_size > MAX_TOOL_BYTES
        or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        or len(raw) != before.st_size
    ):
        fail("TOOL_CHANGED_DURING_READ", "tool source is not a stable bounded regular file")
    return {"path": str(resolved), "sha256": _sha256_bytes(raw), "sizeBytes": len(raw)}


def _require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail("MALFORMED_RECORD", f"{label} must be an object")
    return value


def _require_exact_keys(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    result = _require_object(value, label)
    actual = set(result)
    if actual != keys:
        fail(
            "MALFORMED_OR_EXTRA_RECORD",
            f"{label} keys differ; missing={sorted(keys-actual)}, unexpected={sorted(actual-keys)}",
        )
    return result


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail("INVALID_NUMBER", f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        fail("INVALID_NUMBER", f"{label} must be finite")
    return result


def _vector(value: Any, size: int, label: str) -> tuple[float, ...]:
    if not isinstance(value, list) or len(value) != size:
        fail("INVALID_VECTOR", f"{label} must contain exactly {size} numbers")
    return tuple(_finite_number(item, f"{label}[{index}]") for index, item in enumerate(value))


def _matrix3(value: Any, label: str) -> tuple[tuple[float, ...], ...]:
    if not isinstance(value, list) or len(value) != 3:
        fail("INVALID_MATRIX", f"{label} must be a 3x3 array")
    return tuple(_vector(row, 3, f"{label}[{index}]") for index, row in enumerate(value))


def _transpose(matrix: Sequence[Sequence[float]]) -> tuple[tuple[float, ...], ...]:
    return tuple(tuple(matrix[row][column] for row in range(3)) for column in range(3))


def _matvec(matrix: Sequence[Sequence[float]], vector: Sequence[float]) -> tuple[float, ...]:
    return tuple(sum(matrix[row][column] * vector[column] for column in range(3)) for row in range(3))


def _sub(left: Sequence[float], right: Sequence[float]) -> tuple[float, ...]:
    return tuple(left[index] - right[index] for index in range(3))


def _add(left: Sequence[float], right: Sequence[float]) -> tuple[float, ...]:
    return tuple(left[index] + right[index] for index in range(3))


def _scale(vector: Sequence[float], scalar: float) -> tuple[float, ...]:
    return tuple(item * scalar for item in vector)


def _dot(left: Sequence[float], right: Sequence[float]) -> float:
    return sum(left[index] * right[index] for index in range(3))


def _cross(left: Sequence[float], right: Sequence[float]) -> tuple[float, ...]:
    return (
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    )


def _norm(vector: Sequence[float]) -> float:
    return math.sqrt(_dot(vector, vector))


def _determinant(matrix: Sequence[Sequence[float]]) -> float:
    a, b, c = matrix
    return (
        a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
    )


def _quaternion_to_matrix(wxyz: Sequence[float]) -> tuple[tuple[float, ...], ...]:
    norm = math.sqrt(sum(item * item for item in wxyz))
    if not math.isfinite(norm) or abs(norm - 1.0) > 1e-6:
        fail("INVALID_CAMERA_FRAME", f"quaternion norm {norm!r} is not unit length")
    w, x, y, z = (item / norm for item in wxyz)
    matrix = (
        (1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y - z * w), 2.0 * (x * z + y * w)),
        (2.0 * (x * y + z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z - x * w)),
        (2.0 * (x * z - y * w), 2.0 * (y * z + x * w), 1.0 - 2.0 * (x * x + y * y)),
    )
    if abs(_determinant(matrix) - 1.0) > NUMERIC_TOLERANCE:
        fail("INVALID_CAMERA_FRAME", "quaternion does not produce a proper rotation")
    return matrix


def _validate_orthonormal_frame(
    right: Sequence[float], down: Sequence[float], forward: Sequence[float]
) -> None:
    axes = (right, down, forward)
    if any(abs(_norm(axis) - 1.0) > NUMERIC_TOLERANCE for axis in axes):
        fail("INVALID_CAMERA_FRAME", "camera axes are not unit length")
    if any(
        abs(_dot(axes[left], axes[right_index])) > NUMERIC_TOLERANCE
        for left, right_index in ((0, 1), (0, 2), (1, 2))
    ):
        fail("INVALID_CAMERA_FRAME", "camera axes are not orthogonal")
    if abs(_dot(_cross(right, down), forward) - 1.0) > NUMERIC_TOLERANCE:
        fail("MIRRORED_CAMERA_FRAME", "right/down/forward axes are not right-handed")


def _verify_payload_digest(
    document: dict[str, Any], expected: str, domain: bytes, label: str
) -> None:
    supplied = document.get("payloadSha256")
    if supplied != expected:
        fail("FROZEN_RECEIPT_MISMATCH", f"{label} payloadSha256 is not the pinned receipt")
    unsigned = dict(document)
    unsigned.pop("payloadSha256", None)
    actual = _sha256_bytes(domain + _canonical_json_bytes(unsigned))
    if actual != supplied:
        fail("PAYLOAD_DIGEST_MISMATCH", f"{label} payload digest does not verify")


def _validate_registration(
    document: dict[str, Any], *, enforce_frozen_pin: bool = True
) -> tuple[tuple[tuple[float, ...], ...], tuple[float, ...], tuple[float, ...], tuple[float, ...]]:
    if document.get("schemaVersion") != REGISTRATION_SCHEMA_VERSION:
        fail("REGISTRATION_SCHEMA_MISMATCH", "registration receipt schema is not supported")
    if document.get("authority") != "none":
        fail("AUTHORITY_NOT_NONE", "registration receipt authority must be none")
    if enforce_frozen_pin:
        _verify_payload_digest(document, REGISTRATION_PAYLOAD_SHA256, b"", "registration receipt")
    proper = _require_object(document.get("proper"), "registration.proper")
    rotation = _matrix3(proper.get("rotationRowMajor"), "registration.proper.rotationRowMajor")
    translation = _vector(proper.get("translationMeters"), 3, "registration.proper.translationMeters")
    determinant = _determinant(rotation)
    if determinant < 0.0:
        fail("MIRRORED_REGISTRATION", "registration transform has determinant -1")
    if abs(determinant - 1.0) > NUMERIC_TOLERANCE:
        fail("INVALID_REGISTRATION", "registration rotation determinant must be +1")
    _validate_orthonormal_frame(rotation[0], rotation[1], rotation[2])
    if enforce_frozen_pin and (
        rotation != EXPECTED_REGISTRATION_ROTATION
        or translation != EXPECTED_REGISTRATION_TRANSLATION
    ):
        fail("FROZEN_TRANSFORM_MISMATCH", "proper transform differs from the frozen receipt")
    scope = _require_object(document.get("scope"), "registration.scope")
    if scope.get("validationScanIdsRead") != list(EXPECTED_SCAN_IDS):
        fail("VALIDATION_SCAN_SET_MISMATCH", "registration validation set is not 131/134/138")
    if scope.get("frozenTestScanIdsNotRead") != list(FROZEN_TEST_SCAN_IDS):
        fail("FROZEN_TEST_FIREWALL_FAILED", "registration does not preserve the frozen test set")
    if scope.get("fitTransformChangedOrRefit") is not False:
        fail("REGISTRATION_REFIT", "registration transform was changed during validation")
    comparison = _require_object(document.get("comparison"), "registration.comparison")
    if comparison.get("properBeatsMirrorOnCombinedRmseAndBothDirectionalMedians") is not True:
        fail("PROPER_REGISTRATION_NOT_SUPPORTED", "validation did not beat the mirror competitor")
    inputs = _require_object(document.get("inputs"), "registration.inputs")
    e57 = _require_object(inputs.get("e57"), "registration.inputs.e57")
    if e57.get("knownPinnedSha256NotRehashed") != E57_SHA256:
        fail("E57_PIN_MISMATCH", "registration receipt names a different E57")
    potree = _require_object(inputs.get("potree"), "registration.inputs.potree")
    source_min = _vector(potree.get("declaredBoundsMinMeters"), 3, "potree minimum bounds")
    source_max = _vector(potree.get("declaredBoundsMaxMeters"), 3, "potree maximum bounds")
    if any(source_min[index] >= source_max[index] for index in range(3)):
        fail("INVALID_BOUNDS", "Potree bounds are empty or reversed")
    return rotation, translation, source_min, source_max


def _validate_reprojection_envelope(
    document: dict[str, Any], *, enforce_frozen_pin: bool = True
) -> None:
    if document.get("schemaVersion") != REPROJECTION_SCHEMA_VERSION:
        fail("REPROJECTION_SCHEMA_MISMATCH", "reprojection report schema is not supported")
    if document.get("authority") != "none":
        fail("AUTHORITY_NOT_NONE", "reprojection report authority must be none")
    if enforce_frozen_pin:
        _verify_payload_digest(
            document,
            REPROJECTION_PAYLOAD_SHA256,
            REPROJECTION_DIGEST_DOMAIN,
            "reprojection report",
        )
    scope = _require_object(document.get("scope"), "reprojection.scope")
    if scope.get("sourceE57Sha256") != E57_SHA256:
        fail("E57_PIN_MISMATCH", "reprojection report names a different E57")
    held_out = scope.get("heldOutScanIds")
    if not isinstance(held_out, list) or not set(EXPECTED_SCAN_IDS).issubset(held_out):
        fail("VALIDATION_SCAN_SET_MISMATCH", "validation scans are not held out in the camera report")
    result = _require_object(document.get("result"), "reprojection.result")
    mapping = _require_object(result.get("fixedMappingBySkyboxName"), "fixed face mapping")
    if mapping.get(SKYBOX_NAME) != EXPECTED_CANDIDATE_ID:
        fail("WRONG_CAMERA_FRAME", "Skybox 4 is not mapped to the pinned proper frame")
    if (
        result.get("allFixedMappingRowsPrimaryPass") is not True
        or result.get("declaredRotationPlusFileSpecificRawRasterRelationMatchesFixedMapping")
        is not True
        or result.get("knownPoseMaterializationPermitted") is not False
        or result.get("trainingPermitted") is not False
    ):
        fail("FAILED_REPROJECTION_ENVELOPE", "reprojection report does not retain its safety gates")


def _select_validation_rows(document: dict[str, Any]) -> list[dict[str, Any]]:
    images = document.get("images")
    if not isinstance(images, list):
        fail("MALFORMED_RECORD", "reprojection.images must be an array")
    selected: dict[int, dict[str, Any]] = {}
    for index, candidate in enumerate(images):
        if not isinstance(candidate, dict):
            fail("MALFORMED_RECORD", f"reprojection.images[{index}] must be an object")
        scan_id = candidate.get("scanId")
        name = candidate.get("name")
        if isinstance(scan_id, bool) or not isinstance(scan_id, int) or not isinstance(name, str):
            fail("MALFORMED_RECORD", f"reprojection.images[{index}] lacks a valid scanId/name")
        if scan_id in EXPECTED_SCAN_IDS and name == SKYBOX_NAME:
            if scan_id in selected:
                fail("EXTRA_VALIDATION_RECORD", f"duplicate {scan_id}/{SKYBOX_NAME} record")
            selected[scan_id] = candidate
    missing = sorted(set(EXPECTED_SCAN_IDS) - set(selected))
    extra = sorted(set(selected) - set(EXPECTED_SCAN_IDS))
    if missing or extra:
        fail("VALIDATION_SCAN_SET_MISMATCH", f"missing={missing}, extra={extra}")
    return [selected[scan_id] for scan_id in EXPECTED_SCAN_IDS]


def _validate_camera_row(row: dict[str, Any]) -> dict[str, Any]:
    scan_id = row.get("scanId")
    expected = EXPECTED_IMAGES.get(scan_id)
    if expected is None or row.get("name") != SKYBOX_NAME:
        fail("WRONG_SCAN_OR_FACE", "camera row is not an allowed validation scan at Skybox 4")
    _require_exact_keys(row, ROW_KEYS, f"scan {scan_id} row")
    if row.get("evaluationRole") != "held_out":
        fail("FAILED_POSE_EVIDENCE", f"scan {scan_id} is not held out")
    for key in ("image2DIndex", "image2DGuid", "data3DGuid"):
        if row.get(key) != expected[key]:
            fail("WRONG_SCAN_OR_FACE", f"scan {scan_id} {key} differs from the pinned image")
    jpeg = _require_exact_keys(row.get("jpeg"), JPEG_KEYS, f"scan {scan_id} jpeg")
    expected_jpeg = {
        "height": expected["height"],
        "sha256": expected["jpegSha256"],
        "sizeBytes": expected["jpegSizeBytes"],
        "width": expected["width"],
    }
    if jpeg != expected_jpeg:
        fail("JPEG_EVIDENCE_MISMATCH", f"scan {scan_id} JPEG hash/dimensions differ")
    declared = _require_exact_keys(
        row.get("declaredIntrinsics"), INTRINSIC_KEYS, f"scan {scan_id} declared intrinsics"
    )
    if tuple(_finite_number(declared[key], f"declaredIntrinsics.{key}") for key in ("fx", "fy", "cx", "cy")) != EXPECTED_INTRINSICS:
        fail("NON_SQUARE_INTRINSICS", f"scan {scan_id} declared intrinsics are not pinned square PINHOLE")
    pose = _require_exact_keys(
        row.get("continuousRawRasterColmapPoseCandidate"), POSE_KEYS, f"scan {scan_id} continuous pose"
    )
    camera = _require_exact_keys(pose.get("camera"), CAMERA_KEYS, f"scan {scan_id} pose camera")
    if camera.get("model") != "PINHOLE" or tuple(camera.get("parameters", ())) != EXPECTED_INTRINSICS:
        fail("NON_SQUARE_INTRINSICS", f"scan {scan_id} pose is not PINHOLE [2048,2048,2048,2048]")
    if camera.get("principalYRule") != EXPECTED_PRINCIPAL_Y_RULE:
        fail("FAILED_POSE_EVIDENCE", f"scan {scan_id} principal-Y rule changed")
    if (
        pose.get("status") != "candidate_requires_continuous_and_independent_geometry_validation"
        or pose.get("rasterTransform") != "none"
        or pose.get("source") != EXPECTED_POSE_SOURCE
    ):
        fail("FAILED_POSE_EVIDENCE", f"scan {scan_id} continuous pose gate failed")
    fixed = _require_object(row.get("fixedMappingEvaluation"), f"scan {scan_id} fixed mapping")
    if (
        fixed.get("primaryPass") is not True
        or fixed.get("status") != "passes"
        or fixed.get("passesFixedRunAcceptanceThresholds") is not True
        or fixed.get("candidateId") != EXPECTED_CANDIDATE_ID
        or fixed.get("diagnosticArgmaxCandidateId") != EXPECTED_CANDIDATE_ID
        or fixed.get("diagnosticArgmaxAgreesWithFixedMapping") is not True
        or fixed.get("declaredRawRasterRelationMatchesFixedCandidate") is not True
    ):
        fail("FAILED_POSE_EVIDENCE", f"scan {scan_id} fixed mapping did not pass")
    relation = _require_object(
        row.get("declaredRotationPlusFileSpecificRawRasterRelation"),
        f"scan {scan_id} declared relation",
    )
    if (
        relation.get("assessable") is not True
        or relation.get("matchesEmpiricalWinner") is not True
        or relation.get("status") != "internally_consistent_coarse_axis_candidate"
        or relation.get("relationship") != EXPECTED_RELATIONSHIP
        or relation.get("rasterTransformForMaterializer")
        != "none_already_reflected_in_embedded_JPEG_relationship"
        or _finite_number(relation.get("rightCrossDownDotForward"), "relation handedness")
        != 1.0
    ):
        fail("FAILED_POSE_EVIDENCE", f"scan {scan_id} declared relation did not match")
    winner = _require_object(row.get("winner"), f"scan {scan_id} winner")
    if (
        winner.get("candidateId") != EXPECTED_CANDIDATE_ID
        or winner.get("assessable") is not True
        or winner.get("passesFixedRunAcceptanceThresholds") is not True
        or _finite_number(winner.get("rightCrossDownDotForward"), "winner handedness") != 1.0
    ):
        fail("MIRRORED_CAMERA_FRAME", f"scan {scan_id} winner is not the proper frame")
    return pose


def _viewer_bounds(
    source_min: Sequence[float], source_max: Sequence[float]
) -> tuple[tuple[float, ...], tuple[float, ...]]:
    corners = [
        _matvec(Q_XGRIDS_TO_VIEWER, (x, y, z))
        for x in (source_min[0], source_max[0])
        for y in (source_min[1], source_max[1])
        for z in (source_min[2], source_max[2])
    ]
    minimum = tuple(min(corner[index] for corner in corners) for index in range(3))
    maximum = tuple(max(corner[index] for corner in corners) for index in range(3))
    return minimum, maximum


def _decimal(value: float) -> str:
    if value == 0.0:
        return "0"
    return format(value, ".17g")


def _vector_parameter(value: Sequence[float]) -> str:
    return ",".join(_decimal(item) for item in value)


def _derive_view(
    row: dict[str, Any],
    registration_rotation: Sequence[Sequence[float]],
    registration_translation: Sequence[float],
    viewer_min: Sequence[float],
    viewer_max: Sequence[float],
) -> dict[str, Any]:
    scan_id = int(row["scanId"])
    pose = _validate_camera_row(row)
    centre_e57 = _vector(pose.get("cameraCentre"), 3, f"scan {scan_id} camera centre")
    quaternion = _vector(
        pose.get("worldToCameraQuaternionWxyz"), 4, f"scan {scan_id} quaternion"
    )
    translation_cw = _vector(pose.get("translation"), 3, f"scan {scan_id} COLMAP translation")
    rotation_cw = _quaternion_to_matrix(quaternion)
    expected_translation_cw = _scale(_matvec(rotation_cw, centre_e57), -1.0)
    if max(abs(expected_translation_cw[index] - translation_cw[index]) for index in range(3)) > 1e-7:
        fail("FAILED_POSE_EVIDENCE", f"scan {scan_id} camera centre and translation disagree")
    registration_inverse = _transpose(registration_rotation)
    centre_xgrids = _matvec(
        registration_inverse, _sub(centre_e57, registration_translation)
    )
    position = _matvec(Q_XGRIDS_TO_VIEWER, centre_xgrids)
    rotation_camera_to_e57 = _transpose(rotation_cw)
    def transform_axis(axis: Sequence[float]) -> tuple[float, ...]:
        return _matvec(
            Q_XGRIDS_TO_VIEWER,
            _matvec(registration_inverse, _matvec(rotation_camera_to_e57, axis)),
        )
    right = transform_axis((1.0, 0.0, 0.0))
    down = transform_axis((0.0, 1.0, 0.0))
    forward = transform_axis((0.0, 0.0, 1.0))
    up = transform_axis((0.0, -1.0, 0.0))
    _validate_orthonormal_frame(right, down, forward)
    if any(abs(up[index] + down[index]) > NUMERIC_TOLERANCE for index in range(3)):
        fail("INVALID_CAMERA_FRAME", f"scan {scan_id} viewer up is not negative image down")
    if any(
        position[index] < viewer_min[index] or position[index] > viewer_max[index]
        for index in range(3)
    ):
        fail("CAMERA_OUT_OF_BOUNDS", f"scan {scan_id} camera is outside declared Potree bounds")
    look_at = _add(position, _scale(forward, LOOK_DISTANCE_METERS))
    fov = math.degrees(2.0 * math.atan(EXPECTED_IMAGES[scan_id]["height"] / (2.0 * 2048.0)))
    if abs(fov - 90.0) > 1e-12 or not all(
        math.isfinite(value) and abs(value) <= 100.0 for value in (*position, *look_at, *up)
    ):
        fail("INVALID_VIEWER_CAMERA", f"scan {scan_id} derived viewer camera is out of bounds")
    view_id = f"e57-validation-scan-{scan_id}-skybox-4"
    parameters = {
        "camera": _vector_parameter(position),
        "lookAt": _vector_parameter(look_at),
        "up": _vector_parameter(up),
        "fov": _decimal(fov),
        "experimentalViewId": view_id,
    }
    search = (
        f"?camera={parameters['camera']}&lookAt={parameters['lookAt']}"
        f"&up={parameters['up']}&fov={parameters['fov']}"
        f"&experimentalViewId={parameters['experimentalViewId']}"
    )
    expected = EXPECTED_IMAGES[scan_id]
    return {
        "scanId": scan_id,
        "skyboxName": SKYBOX_NAME,
        "sourceImage": {
            "data3DGuid": expected["data3DGuid"],
            "image2DGuid": expected["image2DGuid"],
            "image2DIndex": expected["image2DIndex"],
            "jpeg": {
                "height": expected["height"],
                "sha256": expected["jpegSha256"],
                "sizeBytes": expected["jpegSizeBytes"],
                "width": expected["width"],
            },
        },
        "sourceContinuousPose": {
            "cameraCentreE57Meters": list(centre_e57),
            "cameraModel": "PINHOLE",
            "cameraParameters": list(EXPECTED_INTRINSICS),
            "worldToCameraQuaternionWxyz": list(quaternion),
        },
        "viewerCamera": {
            "fovDegrees": fov,
            "lookAtMeters": list(look_at),
            "positionMeters": list(position),
            "up": list(up),
        },
        "experimentalQuery": {"parameters": parameters, "search": search},
        "checks": {
            "cameraCentreInsideDeclaredPotreeBounds": True,
            "continuousPoseCentreTranslationConsistent": True,
            "fixedMappingPrimaryPass": True,
            "properRightDownForwardFrame": True,
            "rawRasterRelationMatched": True,
        },
    }


def _finalize(document: dict[str, Any]) -> dict[str, Any]:
    unsigned = dict(document)
    unsigned.pop("payloadSha256", None)
    digest = _sha256_bytes(OUTPUT_DIGEST_DOMAIN + _canonical_json_bytes(unsigned))
    return {**unsigned, "payloadSha256": digest}


def build_receipt(
    registration_document: dict[str, Any],
    reprojection_document: dict[str, Any],
    *,
    registration_evidence: dict[str, Any],
    reprojection_evidence: dict[str, Any],
    tool_evidence: dict[str, Any],
    enforce_frozen_pins: bool = True,
) -> dict[str, Any]:
    rotation, translation, source_min, source_max = _validate_registration(
        registration_document, enforce_frozen_pin=enforce_frozen_pins
    )
    _validate_reprojection_envelope(
        reprojection_document, enforce_frozen_pin=enforce_frozen_pins
    )
    viewer_min, viewer_max = _viewer_bounds(source_min, source_max)
    rows = _select_validation_rows(reprojection_document)
    views = [
        _derive_view(row, rotation, translation, viewer_min, viewer_max) for row in rows
    ]
    report = {
        "schemaVersion": OUTPUT_SCHEMA_VERSION,
        "authority": "none",
        "scope": {
            "purpose": "development viewer camera derivation for private visual comparison",
            "selectedScanIds": list(EXPECTED_SCAN_IDS),
            "selectedSkyboxName": SKYBOX_NAME,
            "frozenTestScanIdsNotRead": list(FROZEN_TEST_SCAN_IDS),
            "rawE57Read": False,
            "jpegBytesRead": False,
            "poseJsonRead": False,
            "note": (
                "The pre-existing reprojection report contains other scans and faces; "
                "only scans 131, 134, and 138 at Skybox 4 contribute to this receipt."
            ),
        },
        "inputs": {
            "registrationReceipt": {
                **registration_evidence,
                "payloadSha256": registration_document.get("payloadSha256"),
                "schemaVersion": registration_document.get("schemaVersion"),
            },
            "reprojectionReport": {
                **reprojection_evidence,
                "payloadSha256": reprojection_document.get("payloadSha256"),
                "schemaVersion": reprojection_document.get("schemaVersion"),
            },
            "tool": tool_evidence,
        },
        "derivation": {
            "registrationEquation": "p_e57 = R_xgrids_to_e57 * p_xgrids + t_e57",
            "registrationRotationRowMajor": [list(row) for row in rotation],
            "registrationRotationDeterminant": _determinant(rotation),
            "registrationTranslationMeters": list(translation),
            "viewerAxisConversionRowMajor": [list(row) for row in Q_XGRIDS_TO_VIEWER],
            "viewerDeclaredBoundsMeters": {
                "maximum": list(viewer_max),
                "minimum": list(viewer_min),
            },
            "lookDistanceMeters": LOOK_DISTANCE_METERS,
            "fovFormula": "2*atan(imageHeight/(2*fy))",
            "queryDecimalFormat": "IEEE-754 round-trip, 17 significant decimal digits",
        },
        "views": views,
        "usageLimits": {
            "physicalApprovalGranted": False,
            "promotionPermitted": False,
            "publicReleasePermitted": False,
            "trainingPermitted": False,
            "plainLanguage": (
                "These cameras make two existing development renders easier to compare "
                "from the same evidence-backed viewpoints. They do not prove physical "
                "accuracy or approve either candidate."
            ),
        },
    }
    return _finalize(report)


def _write_create_only(path: Path, document: dict[str, Any], protected: Iterable[Path]) -> Path:
    supplied = path.expanduser()
    if supplied.suffix.lower() != ".json":
        fail("INVALID_OUTPUT_PATH", "output must end in .json")
    if supplied.exists() or supplied.is_symlink():
        fail("OUTPUT_EXISTS", "output already exists; receipts are create-only")
    try:
        parent = supplied.parent.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        fail("INVALID_OUTPUT_PATH", f"output parent does not exist: {error}")
    if not parent.is_dir() or parent.is_symlink():
        fail("INVALID_OUTPUT_PATH", "output parent must be a non-link directory")
    output = parent / supplied.name
    protected_resolved = {item.resolve(strict=True) for item in protected}
    if output in protected_resolved:
        fail("OUTPUT_OVERLAPS_INPUT", "output path equals an input or tool path")
    payload = json.dumps(
        document, ensure_ascii=False, allow_nan=False, indent=2, sort_keys=True
    ).encode("utf-8") + b"\n"
    temporary: Path | None = None
    published = False
    try:
        descriptor, name = tempfile.mkstemp(
            prefix=f".{output.name}.", suffix=".private-tmp", dir=parent
        )
        temporary = Path(name)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, output)
        published = True
        try:
            temporary.unlink()
        except OSError:
            pass
    except FileExistsError:
        fail("OUTPUT_EXISTS", "output appeared before create-only publication")
    except OSError as error:
        fail("OUTPUT_WRITE_FAILED", f"could not publish receipt: {error}")
    finally:
        if not published and temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
    return output


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registration-receipt", type=Path, required=True)
    parser.add_argument("--reprojection-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        registration, registration_evidence = _read_json(
            arguments.registration_receipt, "registration receipt"
        )
        reprojection, reprojection_evidence = _read_json(
            arguments.reprojection_report, "reprojection report"
        )
        tool_evidence = _tool_evidence(Path(__file__))
        receipt = build_receipt(
            registration,
            reprojection,
            registration_evidence=registration_evidence,
            reprojection_evidence=reprojection_evidence,
            tool_evidence=tool_evidence,
        )
        output = _write_create_only(
            arguments.output,
            receipt,
            (arguments.registration_receipt, arguments.reprojection_report, Path(__file__)),
        )
    except CameraReceiptError as error:
        print(json.dumps({"error": {"code": error.code, "message": error.message}}), file=sys.stderr)
        return 2
    print(
        json.dumps(
            {
                "output": str(output),
                "payloadSha256": receipt["payloadSha256"],
                "schemaVersion": receipt["schemaVersion"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
