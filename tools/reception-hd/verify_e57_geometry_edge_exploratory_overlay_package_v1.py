#!/usr/bin/env python3
"""Verify the sealed E57 geometry-edge exploratory overlay v1 package.

This is an external, read-only verifier for one exact authority-none package.
It deliberately does not import the renderer or its numerical dependencies.
The v1 renderer did not retain the 512x512 masks, so this verifier checks
receipts, closed metadata, retained arithmetic, and frozen-report linkage; it
does not claim to replay the render-time mask computation.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import math
import os
import stat
import struct
import sys
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from statistics import median
from typing import Any


PROTOCOL_SCHEMA_VERSION = (
    "omnitwin.reception.e57-geometry-edge-exploratory-overlay-protocol.v1"
)
MANIFEST_SCHEMA_VERSION = (
    "omnitwin.reception.e57-geometry-edge-exploratory-overlay-report.v1"
)
FROZEN_REPORT_SCHEMA_VERSION = (
    "omnitwin.reception.e57-geometry-edge-audit.v2"
)
VERIFICATION_SCHEMA_VERSION = (
    "omnitwin.reception.e57-geometry-edge-exploratory-overlay-verification.v1"
)

PROTOCOL_DIGEST_DOMAIN = (
    b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_EXPLORATORY_OVERLAY_PROTOCOL_V1\0"
)
MANIFEST_DIGEST_DOMAIN = (
    b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_EXPLORATORY_OVERLAY_REPORT_V1\0"
)
FROZEN_REPORT_DIGEST_DOMAIN = (
    b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_AUDIT_V2\0"
)
ARTIFACT_SET_DIGEST_DOMAIN = (
    b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_EXPLORATORY_ARTIFACT_SET_V1\0"
)
DIRECTORY_SET_DIGEST_DOMAIN = (
    b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_EXPLORATORY_DIRECTORY_SET_V1\0"
)
VERIFICATION_DIGEST_DOMAIN = (
    b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_EXPLORATORY_PACKAGE_VERIFICATION_V1\0"
)

EXPECTED_OUTPUT_DIRECTORY_NAME = (
    "reception-room-e57-geometry-edge-exploratory-overlays-v1-2026-07-14"
)
EXPECTED_PROTOCOL_RECEIPT = {
    "fileName": (
        "reception-room-e57-geometry-edge-exploratory-overlay-protocol-v1-2026-07-14.json"
    ),
    "sizeBytes": 54_087,
    "sha256": "b5347ef067b530653907dc2147133698bdf2ed2466858d8bfcf5cac3e33350c4",
    "schemaVersion": PROTOCOL_SCHEMA_VERSION,
    "payloadSha256": "2c62194a6153a6659e7c4caf6e2de2e8baa3cac717cad0ad5c88dae0ac859a38",
}
EXPECTED_MANIFEST_RECEIPT = {
    "fileName": "manifest.json",
    "sizeBytes": 118_427,
    "sha256": "b9ff934550b796be8a651476fb6f8095871d1f5ce38fbf2ef7898b9d4f27d382",
    "schemaVersion": MANIFEST_SCHEMA_VERSION,
    "payloadSha256": "352d1b10aa3353369a1db6dd4f751ecc7363cdd37994809fb37a1bb8655a1912",
}
EXPECTED_FROZEN_REPORT_RECEIPT = {
    "fileName": "reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json",
    "sizeBytes": 19_800_301,
    "sha256": "ed744eba259c5a40c886af65d8fccf54c36a60ee2e5890449dee0c23f50794a0",
    "schemaVersion": FROZEN_REPORT_SCHEMA_VERSION,
    "payloadSha256": "5bdfcb380692dfa6bb61c62880303cd46a13455737653667dfcba139213bf906",
}
EXPECTED_SOURCE_E57_RECEIPT = {
    "fileName": "cloud_0.e57",
    "sizeBytes": 20_518_437_888,
    "sha256": "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd",
}
EXPECTED_IMPLEMENTATION_SOURCE_FILES = [
    {
        "fileName": "explore_e57_geometry_edge_residuals.py",
        "sizeBytes": 51_378,
        "sha256": "20ab192d64c877e0d422d7c8095dc9ea28f22daa273679e5e56bb6de5e866020",
    },
    {
        "fileName": "audit_e57_geometry_edge_protocol.py",
        "sizeBytes": 175_621,
        "sha256": "dad2fa84c953c3a8dc70ab76c40a92581b845a4a6875465f28bcebd751c6c585",
    },
    {
        "fileName": "audit_e57_geometry_edges.py",
        "sizeBytes": 32_176,
        "sha256": "0ffa6c5146fdc4b0b319af0041e27af72574822e406dd2b63648420b5ebc4093",
    },
    {
        "fileName": "test_explore_e57_geometry_edge_residuals.py",
        "sizeBytes": 9_012,
        "sha256": "65f2da45ebcfb9ce104fd554e40e6117a240e4971db1a02666f3381683737aaf",
    },
]
IMPLEMENTATION_RELATIVE_PATHS = {
    "explore_e57_geometry_edge_residuals.py": Path(
        "tools/reception-hd/explore_e57_geometry_edge_residuals.py"
    ),
    "audit_e57_geometry_edge_protocol.py": Path(
        "tools/reception-hd/audit_e57_geometry_edge_protocol.py"
    ),
    "audit_e57_geometry_edges.py": Path(
        "tools/reception-hd/audit_e57_geometry_edges.py"
    ),
    "test_explore_e57_geometry_edge_residuals.py": Path(
        "tools/reception-hd/tests/test_explore_e57_geometry_edge_residuals.py"
    ),
}

EXPECTED_ARTIFACT_SET_SHA256 = (
    "066d99cd676b6d733a109bb6d9002f68aa45fc934a92ac9c3e009f0471de7be4"
)
EXPECTED_DIRECTORY_SET_SHA256 = (
    "68eba6f85bed86f1a1d8b2933f41a904bcb78026c3d444b1dc7552299345b037"
)
EXPECTED_PAIR_DELTAS = [
    0.149568335,
    0.375904862,
    0.297530627,
    0.263911166,
    0.125621041,
    -0.092123737,
    0.212960437,
    0.268919671,
    0.101130902,
    0.299681945,
    0.047814631,
    0.315819511,
    0.059789856,
    0.059993207,
]

PASS = "PASS_DISCRETE_GEOMETRY_ORIENTATION"
NONPASS_STATUSES = frozenset(
    {
        "REJECT_GEOMETRY_MISMATCH",
        "BLOCKED_INSUFFICIENT_GEOMETRY",
        "BLOCKED_AMBIGUOUS",
    }
)
EXPECTED_STATUS_COUNTS = {
    "BLOCKED_AMBIGUOUS": 4,
    "BLOCKED_INSUFFICIENT_GEOMETRY": 4,
    PASS: 13,
    "REJECT_GEOMETRY_MISMATCH": 6,
}
EXPECTED_LIMITATIONS = [
    "This is post-hoc exploratory use of already-consumed evidence, not held-out validation.",
    (
        "A reproduced fixed-primary mask does not validate the other 47 "
        "orientations or change the frozen result."
    ),
    (
        "The central Skybox 5 circle is a predeclared tripod/nadir hypothesis, "
        "not a confirmed segmentation or causal explanation."
    ),
    (
        "Both XYZ and JPEG evidence originate in the same E57 container and "
        "are not independent ground truth."
    ),
    (
        "The overlay is presentation-only; all quantitative results are "
        "computed on the 512 by 512 analysis masks before upsampling."
    ),
]
RAW_MASK_LIMITATION = (
    "The v1 package does not retain the raw 512x512 geometry, photo-edge, "
    "matched, or unmatched masks. This verifier checks retained values and "
    "receipts but cannot independently replay mask extraction or the retained "
    "claim about projected-input, visible-pixel, and occupied-pixel equality."
)
POST_RETURN_SWAP_LIMITATION = (
    "The verifier performs two full package snapshots and a final directory "
    "identity check, but a userspace verifier cannot prevent bytes from being "
    "swapped after its final check or after return. Immutable external custody "
    "is required to prevent that race."
)
SELF_AUTHENTICITY_LIMITATION = (
    "The verifier reports its own source receipt but cannot authenticate itself. "
    "A caller must independently pin and authenticate the verifier bytes."
)

EXPECTED_ANALYSIS_PLAN = {
    "analysisGrid": {"width": 512, "height": 512},
    "primaryMaskOnly": True,
    "all48CandidatesRescored": False,
    "frozenPrimaryMetricEqualityRequired": True,
    "readScanArguments": {
        "intensity": False,
        "colors": False,
        "row_column": True,
        "transform": False,
    },
    "allowedPointFields": [
        "cartesianX",
        "cartesianY",
        "cartesianZ",
        "rowIndex",
        "columnIndex",
    ],
    "pointColourFieldsRequestedOrRead": False,
    "nativeJpegBytesCopiedWithoutRecoding": True,
    "overlayResolution": "exact_native_JPEG_dimensions",
    "residualDefinition": (
        "primary geometry-edge pixel is matched when Euclidean distance to a "
        "frozen-method photo-edge pixel is <=2 analysis pixels; otherwise it "
        "is an unmatched residual"
    ),
    "hypothesizedNativeNadirTripodRegion": {
        "appliesOnlyToFace": "Skybox 5",
        "shape": "circle",
        "analysisCentreXYPixels": [256, 256],
        "analysisRadiusPixels": 80,
        "native4096CentreXYPixels": [2048, 2048],
        "native4096RadiusPixels": 640,
        "chosenBeforeRendering": True,
        "excludedFromAnyMetric": False,
        "meaning": (
            "conservative central nadir hypothesis for scanner/tripod footprint; "
            "not a confirmed object mask or causal label"
        ),
    },
}

EXPECTED_EVIDENCE_STATE = {
    "consumedPreviouslyHeldOutEvidence": True,
    "freshHeldOutEvidence": False,
    "acceptanceDecisionRole": "none",
    "thresholdsChanged": False,
    "frozenProtocolOrReportEdited": False,
    "hypothesisGeneratingOnly": True,
}
EXPECTED_TRUTH_AND_AUTHORITY = {
    "captured": "byte-identical embedded JPEG copies and source identifiers",
    "measured": "XYZ-derived masks, JPEG-edge masks, and residual counts",
    "generated": "lossless diagnostic PNG overlays and this manifest",
    "continuousCalibrationValidated": False,
    "metricGeometryValidated": False,
    "knownPoseMaterializationPermitted": False,
    "trainingPermitted": False,
    "signingPermitted": False,
    "publicationPermitted": False,
    "authority": "none",
}
EXPECTED_SELF_DIGEST_MEANING = {
    "authenticatesCreator": False,
    "provesTimestamp": False,
    "provesImmutability": False,
}

PROTOCOL_ROOT_KEYS = frozenset(
    {
        "schemaVersion",
        "purpose",
        "evidenceState",
        "inputs",
        "implementation",
        "selectionPlan",
        "analysisPlan",
        "expectedOutputDirectoryName",
        "truthAndAuthority",
        "selfDigestMeaning",
        "authority",
        "payloadSha256",
    }
)
MANIFEST_ROOT_KEYS = frozenset(
    {
        "schemaVersion",
        "protocol",
        "scope",
        "runtime",
        "truthSeparation",
        "selectionPlan",
        "analysisPlan",
        "records",
        "pairComparisons",
        "artifacts",
        "limitations",
        "continuousCalibrationValidated",
        "metricGeometryValidated",
        "knownPoseMaterializationPermitted",
        "trainingPermitted",
        "signingPermitted",
        "publicationPermitted",
        "authority",
        "selfDigestMeaning",
        "payloadSha256",
    }
)
RECORD_ROOT_KEYS = frozenset(
    {
        "scanId",
        "faceName",
        "exploratoryRoles",
        "pairIds",
        "frozenStatus",
        "frozenReasons",
        "captured",
        "measured",
        "generated",
        "continuousCalibrationValidated",
        "metricGeometryValidated",
        "knownPoseMaterializationPermitted",
        "trainingPermitted",
    }
)
MEASURED_KEYS = frozenset(
    {
        "geometryEdgePixelCount",
        "photoEdgePixelCount",
        "matchedGeometryEdgePixelCount",
        "unmatchedGeometryResidualPixelCount",
        "photoOnlyEdgePixelCount",
        "matchedFraction",
        "unmatchedResidualFraction",
        "matchRadiusAnalysisPixels",
        "hypothesizedNativeNadirTripodRegion",
        "frozenPrimaryMetricsReproducedExactly",
        "pointColourFieldsRequestedOrRead",
    }
)


class VerificationError(RuntimeError):
    """A stable-code verification failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


def fail(code: str, message: str) -> None:
    raise VerificationError(code, message)


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _finalize(payload: Mapping[str, Any], domain: bytes) -> dict[str, Any]:
    without_digest = dict(payload)
    without_digest.pop("payloadSha256", None)
    digest = hashlib.sha256(
        domain + _canonical_json_bytes(without_digest)
    ).hexdigest()
    return {**without_digest, "payloadSha256": digest}


def _verify_payload_digest(
    payload: Mapping[str, Any], domain: bytes, label: str
) -> None:
    expected = payload.get("payloadSha256")
    if not isinstance(expected, str) or len(expected) != 64:
        fail("INVALID_PAYLOAD_DIGEST", f"{label} has no valid payload digest")
    without_digest = dict(payload)
    without_digest.pop("payloadSha256", None)
    actual = hashlib.sha256(
        domain + _canonical_json_bytes(without_digest)
    ).hexdigest()
    if not hmac.compare_digest(expected.lower(), actual):
        fail("INVALID_PAYLOAD_DIGEST", f"{label} payload digest does not verify")


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON number {value}")


def _same_file_identity(left: os.stat_result, right: os.stat_result) -> bool:
    return (
        left.st_dev,
        left.st_ino,
        left.st_size,
        left.st_mtime_ns,
    ) == (
        right.st_dev,
        right.st_ino,
        right.st_size,
        right.st_mtime_ns,
    )


def _absolute_lexical(path: Path) -> Path:
    """Return an absolute normalized path without dereferencing symlinks."""

    return Path(os.path.abspath(os.fspath(path)))


def _stat_has_reparse_point(value: os.stat_result) -> bool:
    if stat.S_ISLNK(value.st_mode):
        return True
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x00000400)
    attributes = getattr(value, "st_file_attributes", 0)
    return bool(attributes & reparse_flag)


def _reject_reparse_chain(path: Path, label: str) -> None:
    """Reject a symlink/reparse point at any existing lexical path component."""

    lexical = _absolute_lexical(path)
    candidates = list(reversed((lexical, *lexical.parents)))
    for candidate in candidates:
        try:
            candidate_stat = candidate.lstat()
        except FileNotFoundError:
            continue
        except OSError as error:
            fail("READ_FAILED", f"cannot inspect {label} ancestor {candidate}: {error}")
        if _stat_has_reparse_point(candidate_stat):
            fail(
                "UNSAFE_REPARSE_PATH",
                f"{label} uses symlink/reparse component {candidate}",
            )


def _directory_stat(path: Path, label: str) -> os.stat_result:
    _reject_reparse_chain(path, label)
    try:
        value = path.lstat()
    except OSError as error:
        fail("READ_FAILED", f"cannot stat {label}: {error}")
    if _stat_has_reparse_point(value) or not stat.S_ISDIR(value.st_mode):
        fail("UNSAFE_FILE_TYPE", f"{label} must be a non-reparse directory")
    return value


def _same_directory_identity(left: os.stat_result, right: os.stat_result) -> bool:
    return (left.st_dev, left.st_ino) == (right.st_dev, right.st_ino)


def _regular_file_stat(path: Path, label: str, maximum_bytes: int) -> os.stat_result:
    _reject_reparse_chain(path, label)
    try:
        before = path.lstat()
    except OSError as error:
        fail("READ_FAILED", f"cannot stat {label}: {error}")
    if _stat_has_reparse_point(before) or not stat.S_ISREG(before.st_mode):
        fail("UNSAFE_FILE_TYPE", f"{label} must be a non-reparse regular file")
    if before.st_size < 0 or before.st_size > maximum_bytes:
        fail("FILE_SIZE_OUT_OF_RANGE", f"{label} exceeds its size boundary")
    return before


def _read_file(path: Path, label: str, maximum_bytes: int) -> tuple[bytes, dict[str, Any]]:
    before = _regular_file_stat(path, label, maximum_bytes)
    digest = hashlib.sha256()
    chunks: list[bytes] = []
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
                chunks.append(chunk)
    except OSError as error:
        fail("READ_FAILED", f"cannot read {label}: {error}")
    after = _regular_file_stat(path, label, maximum_bytes)
    if not _same_file_identity(before, after):
        fail("FILE_CHANGED_DURING_READ", f"{label} changed while being read")
    payload = b"".join(chunks)
    if len(payload) != before.st_size:
        fail("SHORT_READ", f"{label} size changed while being read")
    return payload, {
        "fileName": path.name,
        "sizeBytes": len(payload),
        "sha256": digest.hexdigest(),
    }


def _file_receipt(path: Path, label: str, maximum_bytes: int) -> dict[str, Any]:
    before = _regular_file_stat(path, label, maximum_bytes)
    digest = hashlib.sha256()
    read_bytes = 0
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                read_bytes += len(chunk)
                digest.update(chunk)
    except OSError as error:
        fail("READ_FAILED", f"cannot read {label}: {error}")
    after = _regular_file_stat(path, label, maximum_bytes)
    if not _same_file_identity(before, after) or read_bytes != before.st_size:
        fail("FILE_CHANGED_DURING_READ", f"{label} changed while being read")
    return {
        "fileName": path.name,
        "sizeBytes": read_bytes,
        "sha256": digest.hexdigest(),
    }


def _read_json(
    path: Path,
    label: str,
    expected_receipt: Mapping[str, Any],
    maximum_bytes: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload, receipt = _read_file(path, label, maximum_bytes)
    expected_file = {
        key: expected_receipt[key] for key in ("fileName", "sizeBytes", "sha256")
    }
    if receipt != expected_file:
        fail("EXACT_FILE_RECEIPT_MISMATCH", f"{label} exact receipt changed")
    try:
        decoded = json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_json_constant,
        )
    except (UnicodeError, json.JSONDecodeError, ValueError) as error:
        fail("INVALID_JSON", f"cannot parse {label}: {error}")
    if not isinstance(decoded, dict):
        fail("INVALID_JSON", f"{label} must contain one JSON object")
    return decoded, receipt


def _closed_keys(value: Any, expected: frozenset[str], label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        fail("INVALID_OBJECT", f"{label} must be an object")
    actual = frozenset(value)
    if actual != expected:
        added = sorted(actual - expected)
        missing = sorted(expected - actual)
        fail(
            "CLOSED_OBJECT_KEYS_MISMATCH",
            f"{label} keys changed (extra={added}, missing={missing})",
        )
    return value


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _round(value: float, digits: int = 9) -> float:
    result = round(float(value), digits)
    return 0.0 if result == 0.0 else result


def _selection_record(row: Mapping[str, Any]) -> dict[str, Any]:
    jpeg = row["jpeg"]
    primary = row["primaryEvaluation"]
    return {
        "scanId": int(row["scanId"]),
        "faceName": str(row["name"]),
        "data3DGuid": str(row["data3DGuid"]),
        "image2DIndex": int(row["image2DIndex"]),
        "image2DGuid": str(row["image2DGuid"]),
        "jpeg": {
            "sha256": str(jpeg["sha256"]),
            "sizeBytes": int(jpeg["sizeBytes"]),
            "width": int(jpeg["width"]),
            "height": int(jpeg["height"]),
        },
        "declaredSourceIntrinsics": dict(row["declaredSourceIntrinsics"]),
        "analysisIntrinsics": dict(row["analysisIntrinsics"]),
        "frozenStatus": str(row["status"]),
        "frozenReasons": list(row["reasons"]),
        "primaryCandidateId": str(row["primaryCandidateId"]),
        "frozenPrimaryMetrics": {
            "projectedInputCount": int(primary["projectedInputCount"]),
            "visiblePixelCount": int(primary["visiblePixelCount"]),
            "occupiedPixelFraction": float(primary["occupiedPixelFraction"]),
            "geometryEdgePixelCount": int(primary["geometryEdgePixelCount"]),
            "photoEdgePixelCount": int(primary["photoEdgePixelCount"]),
            "matchedGeometryEdgePixelCount": int(
                primary["matchedGeometryEdgePixelCount"]
            ),
            "matchedFraction": (
                float(primary["matchedFraction"])
                if primary["matchedFraction"] is not None
                else None
            ),
        },
    }


def _selection_key(row: Mapping[str, Any]) -> tuple[int, str]:
    return int(row["scanId"]), str(row["faceName"])


def _expected_selection_plan(images: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    failures = sorted(
        (row for row in images if row.get("status") != PASS),
        key=lambda row: (int(row["scanId"]), str(row["name"])),
    )
    if len(failures) != 14:
        fail("FROZEN_SELECTION_MISMATCH", "frozen report no longer has 14 failures")
    pairs: list[dict[str, Any]] = []
    for index, failure in enumerate(failures, start=1):
        controls = [
            row
            for row in images
            if row.get("name") == failure.get("name") and row.get("status") == PASS
        ]
        controls.sort(
            key=lambda row: (
                abs(int(row["scanId"]) - int(failure["scanId"])),
                int(row["scanId"]),
                int(row["image2DIndex"]),
            )
        )
        if not controls:
            fail("FROZEN_SELECTION_MISMATCH", "a failure has no same-face control")
        control = controls[0]
        distance = abs(int(control["scanId"]) - int(failure["scanId"]))
        pairs.append(
            {
                "pairId": f"pair-{index:02d}",
                "failure": _selection_record(failure),
                "control": _selection_record(control),
                "controlSelection": {
                    "sameFaceRequired": True,
                    "absoluteScanIdDistance": distance,
                    "orderedTieBreakValues": [
                        distance,
                        int(control["scanId"]),
                        int(control["image2DIndex"]),
                    ],
                },
            }
        )

    selected: dict[tuple[int, str], dict[str, Any]] = {}
    roles: dict[tuple[int, str], set[str]] = {}
    pair_ids: dict[tuple[int, str], set[str]] = {}
    for pair in pairs:
        for role in ("failure", "control"):
            row = pair[role]
            key = _selection_key(row)
            if key in selected and selected[key] != row:
                fail("FROZEN_SELECTION_MISMATCH", "selected face is contradictory")
            selected[key] = dict(row)
            roles.setdefault(key, set()).add(role)
            pair_ids.setdefault(key, set()).add(str(pair["pairId"]))
    unique = [
        {
            **selected[key],
            "exploratoryRoles": sorted(roles[key]),
            "pairIds": sorted(pair_ids[key]),
        }
        for key in sorted(selected)
    ]
    if len(unique) != 27:
        fail("FROZEN_SELECTION_MISMATCH", "selection no longer has 27 unique faces")
    return {
        "failureRule": "all_and_only_frozen_status_not_PASS_DISCRETE_GEOMETRY_ORIENTATION",
        "controlRule": (
            "same face and frozen PASS; minimize in order absolute scan-ID "
            "distance, scan ID, then image2D index; reuse permitted"
        ),
        "failureCount": 14,
        "pairCount": 14,
        "uniqueSelectedFaceCount": 27,
        "pairs": pairs,
        "uniqueSelectedFaces": unique,
    }


def _validate_heldout_report(report: Mapping[str, Any]) -> None:
    _verify_payload_digest(report, FROZEN_REPORT_DIGEST_DOMAIN, "frozen report")
    if report.get("schemaVersion") != FROZEN_REPORT_SCHEMA_VERSION:
        fail("FROZEN_REPORT_MISMATCH", "frozen report schema changed")
    if report.get("payloadSha256") != EXPECTED_FROZEN_REPORT_RECEIPT["payloadSha256"]:
        fail("FROZEN_REPORT_MISMATCH", "frozen report payload identity changed")
    if report.get("authority") != "none":
        fail("AUTHORITY_UPGRADE", "frozen report authority is not none")
    scope = report.get("scope")
    if not isinstance(scope, Mapping) or scope.get("sourceE57") != EXPECTED_SOURCE_E57_RECEIPT:
        fail("SOURCE_E57_MISMATCH", "frozen source E57 receipt changed")
    images = report.get("images")
    if not isinstance(images, list) or len(images) != 96:
        fail("FROZEN_REPORT_MISMATCH", "frozen report must have exactly 96 images")
    identities: set[tuple[int, str]] = set()
    for row in images:
        if not isinstance(row, Mapping):
            fail("FROZEN_REPORT_MISMATCH", "frozen image row is not an object")
        identity = (row.get("scanId"), row.get("name"))
        if identity in identities:
            fail("FROZEN_REPORT_MISMATCH", "frozen image identity is duplicated")
        identities.add(identity)
        if row.get("trainingPermitted") is not False:
            fail("AUTHORITY_UPGRADE", "frozen image permits training")


def _validate_local_implementation(repo_root: Path) -> None:
    _directory_stat(repo_root, "repository root")
    for expected in EXPECTED_IMPLEMENTATION_SOURCE_FILES:
        path = repo_root / IMPLEMENTATION_RELATIVE_PATHS[str(expected["fileName"])]
        actual = _file_receipt(path, f"implementation {path.name}", 5 * 1024 * 1024)
        if actual != expected:
            fail(
                "IMPLEMENTATION_RECEIPT_MISMATCH",
                f"bound implementation source {path.name} changed",
            )


def _validate_protocol(
    protocol: Mapping[str, Any],
    heldout_report: Mapping[str, Any],
    repo_root: Path,
) -> None:
    _closed_keys(protocol, PROTOCOL_ROOT_KEYS, "protocol")
    _verify_payload_digest(protocol, PROTOCOL_DIGEST_DOMAIN, "protocol")
    if protocol.get("schemaVersion") != PROTOCOL_SCHEMA_VERSION:
        fail("PROTOCOL_MISMATCH", "protocol schema changed")
    if protocol.get("purpose") != "exploratory_failure_localization_and_hypothesis_generation":
        fail("PROTOCOL_MISMATCH", "protocol purpose changed")
    if protocol.get("authority") != "none":
        fail("AUTHORITY_UPGRADE", "protocol authority is not none")
    if protocol.get("evidenceState") != EXPECTED_EVIDENCE_STATE:
        fail("PROTOCOL_MISMATCH", "protocol evidence state changed")
    if protocol.get("analysisPlan") != EXPECTED_ANALYSIS_PLAN:
        fail("PROTOCOL_MISMATCH", "protocol analysis plan changed")
    if protocol.get("truthAndAuthority") != EXPECTED_TRUTH_AND_AUTHORITY:
        fail("AUTHORITY_UPGRADE", "protocol truth/authority boundary changed")
    if protocol.get("selfDigestMeaning") != EXPECTED_SELF_DIGEST_MEANING:
        fail("PROTOCOL_MISMATCH", "protocol self-digest meaning changed")
    if protocol.get("expectedOutputDirectoryName") != EXPECTED_OUTPUT_DIRECTORY_NAME:
        fail("PROTOCOL_MISMATCH", "protocol output name changed")

    inputs = _closed_keys(
        protocol.get("inputs"), frozenset({"sourceE57", "frozenHeldoutReport"}), "protocol.inputs"
    )
    if inputs.get("sourceE57") != EXPECTED_SOURCE_E57_RECEIPT:
        fail("SOURCE_E57_MISMATCH", "protocol source differs from frozen source")
    if inputs.get("sourceE57") != heldout_report["scope"]["sourceE57"]:
        fail("SOURCE_E57_MISMATCH", "protocol source is not the frozen-report source")
    if inputs.get("frozenHeldoutReport") != EXPECTED_FROZEN_REPORT_RECEIPT:
        fail("FROZEN_REPORT_MISMATCH", "protocol frozen-report receipt changed")

    implementation = _closed_keys(
        protocol.get("implementation"),
        frozenset({"sourceFiles", "dependencyVersions"}),
        "protocol.implementation",
    )
    if implementation.get("sourceFiles") != EXPECTED_IMPLEMENTATION_SOURCE_FILES:
        fail("IMPLEMENTATION_RECEIPT_MISMATCH", "protocol implementation set changed")
    if not isinstance(implementation.get("dependencyVersions"), Mapping):
        fail("PROTOCOL_MISMATCH", "protocol dependency versions are missing")
    _validate_local_implementation(repo_root)

    images = heldout_report["images"]
    expected_selection = _expected_selection_plan(images)
    if protocol.get("selectionPlan") != expected_selection:
        fail("FROZEN_SELECTION_MISMATCH", "protocol selection differs from frozen report")
    if protocol.get("payloadSha256") != EXPECTED_PROTOCOL_RECEIPT["payloadSha256"]:
        fail("PROTOCOL_MISMATCH", "protocol payload identity changed")


def _artifact_name(selection: Mapping[str, Any], suffix: str) -> str:
    roles = "-".join(str(role) for role in selection["exploratoryRoles"])
    face_number = str(selection["faceName"]).split()[-1]
    return (
        f"{roles}__scan-{int(selection['scanId']):03d}__"
        f"skybox-{face_number}__{suffix}"
    )


def _validate_region(measured: Mapping[str, Any], face_name: str) -> None:
    region = measured["hypothesizedNativeNadirTripodRegion"]
    if face_name != "Skybox 5":
        _closed_keys(region, frozenset({"applies", "reason"}), "record measured region")
        if region != {"applies": False, "reason": "selected face is not Skybox 5"}:
            fail("REGION_METRIC_MISMATCH", "non-nadir face has a region measurement")
        return
    expected_keys = frozenset(
        {
            "applies",
            "shape",
            "analysisCentreXYPixels",
            "analysisRadiusPixels",
            "regionPixelCount",
            "geometryEdgePixelsInside",
            "matchedGeometryEdgePixelsInside",
            "unmatchedResidualPixelsInside",
            "unmatchedResidualPixelsOutside",
            "unmatchedResidualRateInside",
            "unmatchedResidualRateOutside",
            "insideMinusOutsideUnmatchedRate",
            "fractionOfAllUnmatchedResidualInside",
            "excludedFromAnyMetric",
            "interpretation",
        }
    )
    _closed_keys(region, expected_keys, "Skybox 5 measured region")
    if (
        region.get("applies") is not True
        or region.get("shape") != "circle"
        or region.get("analysisCentreXYPixels") != [256, 256]
        or region.get("analysisRadiusPixels") != 80
        or region.get("regionPixelCount") != 20_081
        or region.get("excludedFromAnyMetric") is not False
    ):
        fail("REGION_METRIC_MISMATCH", "Skybox 5 region definition changed")
    geometry_inside = region.get("geometryEdgePixelsInside")
    matched_inside = region.get("matchedGeometryEdgePixelsInside")
    unmatched_inside = region.get("unmatchedResidualPixelsInside")
    unmatched_outside = region.get("unmatchedResidualPixelsOutside")
    for value in (geometry_inside, matched_inside, unmatched_inside, unmatched_outside):
        if not _is_int(value) or value < 0:
            fail("REGION_METRIC_MISMATCH", "region count is invalid")
    if geometry_inside != matched_inside + unmatched_inside:
        fail("REGION_METRIC_MISMATCH", "region geometry partition does not add up")
    if unmatched_inside + unmatched_outside != measured["unmatchedGeometryResidualPixelCount"]:
        fail("REGION_METRIC_MISMATCH", "region unmatched partition does not add up")
    inside_rate = (
        _round(unmatched_inside / geometry_inside, 9) if geometry_inside else None
    )
    outside_geometry = measured["geometryEdgePixelCount"] - geometry_inside
    outside_rate = (
        _round(unmatched_outside / outside_geometry, 9) if outside_geometry else None
    )
    all_unmatched = measured["unmatchedGeometryResidualPixelCount"]
    inside_fraction = (
        _round(unmatched_inside / all_unmatched, 9) if all_unmatched else None
    )
    difference = (
        _round(inside_rate - outside_rate, 9)
        if inside_rate is not None and outside_rate is not None
        else None
    )
    expected_rates = (
        inside_rate,
        outside_rate,
        difference,
        inside_fraction,
    )
    actual_rates = (
        region.get("unmatchedResidualRateInside"),
        region.get("unmatchedResidualRateOutside"),
        region.get("insideMinusOutsideUnmatchedRate"),
        region.get("fractionOfAllUnmatchedResidualInside"),
    )
    if actual_rates != expected_rates:
        fail("REGION_METRIC_MISMATCH", "region rates do not reproduce from counts")


def _validate_measured(
    measured: Any, selection: Mapping[str, Any], face_name: str
) -> None:
    measured = _closed_keys(measured, MEASURED_KEYS, "record.measured")
    count_names = (
        "geometryEdgePixelCount",
        "photoEdgePixelCount",
        "matchedGeometryEdgePixelCount",
        "unmatchedGeometryResidualPixelCount",
        "photoOnlyEdgePixelCount",
    )
    for name in count_names:
        if not _is_int(measured.get(name)) or measured[name] < 0:
            fail("RETAINED_METRIC_MISMATCH", f"{name} is not a non-negative integer")
    geometry = measured["geometryEdgePixelCount"]
    matched = measured["matchedGeometryEdgePixelCount"]
    unmatched = measured["unmatchedGeometryResidualPixelCount"]
    if geometry <= 0 or matched + unmatched != geometry:
        fail("RETAINED_METRIC_MISMATCH", "geometry residual partition does not add up")
    if measured["photoOnlyEdgePixelCount"] > measured["photoEdgePixelCount"]:
        fail("RETAINED_METRIC_MISMATCH", "photo-only count exceeds photo edges")
    if measured.get("matchedFraction") != _round(matched / geometry, 9):
        fail("RETAINED_METRIC_MISMATCH", "matched fraction does not reproduce")
    if measured.get("unmatchedResidualFraction") != _round(unmatched / geometry, 9):
        fail("RETAINED_METRIC_MISMATCH", "unmatched fraction does not reproduce")
    if measured.get("matchRadiusAnalysisPixels") != 2:
        fail("RETAINED_METRIC_MISMATCH", "match radius changed")
    if measured.get("frozenPrimaryMetricsReproducedExactly") is not True:
        fail("RETAINED_METRIC_MISMATCH", "frozen-primary equality flag is false")
    if measured.get("pointColourFieldsRequestedOrRead") is not False:
        fail("POINT_COLOUR_BOUNDARY_VIOLATION", "record claims point colour access")
    frozen = selection["frozenPrimaryMetrics"]
    for name in (
        "geometryEdgePixelCount",
        "photoEdgePixelCount",
        "matchedGeometryEdgePixelCount",
        "matchedFraction",
    ):
        if measured.get(name) != frozen.get(name):
            fail(
                "FROZEN_PRIMARY_METRIC_MISMATCH",
                f"retained {name} differs from frozen report",
            )
    _validate_region(measured, face_name)


def _expected_manifest_scope() -> dict[str, Any]:
    return {
        "sourceE57": EXPECTED_SOURCE_E57_RECEIPT,
        "frozenHeldoutReport": EXPECTED_FROZEN_REPORT_RECEIPT,
        "consumedPreviouslyHeldOutEvidence": True,
        "freshHeldOutEvidence": False,
        "frozenAuditRerun": False,
        "frozenThresholdsChanged": False,
        "selectedFailureCount": 14,
        "selectedPairCount": 14,
        "uniqueSelectedFaceCount": 27,
    }


def _aggregate_metrics(pair_comparisons: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    failure_values = [
        float(row["failure"]["unmatchedResidualFraction"])
        for row in pair_comparisons
    ]
    control_values = [
        float(row["control"]["unmatchedResidualFraction"])
        for row in pair_comparisons
    ]
    deltas = [
        float(row["failureMinusControlUnmatchedResidualFraction"])
        for row in pair_comparisons
    ]
    return {
        "failureMeanUnmatchedResidualFraction": _round(
            sum(failure_values) / len(failure_values), 12
        ),
        "controlMeanUnmatchedResidualFraction": _round(
            sum(control_values) / len(control_values), 12
        ),
        "meanFailureMinusControl": _round(sum(deltas) / len(deltas), 12),
        "medianFailureMinusControl": _round(median(deltas), 12),
        "minimumFailureMinusControl": min(deltas),
        "maximumFailureMinusControl": max(deltas),
        "positivePairCount": sum(value > 0 for value in deltas),
        "zeroPairCount": sum(value == 0 for value in deltas),
        "negativePairCount": sum(value < 0 for value in deltas),
        "pairDeltasInProtocolOrder": deltas,
    }


def _validate_manifest(
    manifest: Mapping[str, Any],
    protocol: Mapping[str, Any],
    heldout_report: Mapping[str, Any],
) -> tuple[dict[str, Mapping[str, Any]], dict[str, tuple[int, int]], dict[str, Any]]:
    _closed_keys(manifest, MANIFEST_ROOT_KEYS, "manifest")
    _verify_payload_digest(manifest, MANIFEST_DIGEST_DOMAIN, "manifest")
    if manifest.get("schemaVersion") != MANIFEST_SCHEMA_VERSION:
        fail("MANIFEST_MISMATCH", "manifest schema changed")
    if manifest.get("protocol") != EXPECTED_PROTOCOL_RECEIPT:
        fail("PROTOCOL_MISMATCH", "manifest protocol receipt changed")
    if manifest.get("scope") != _expected_manifest_scope():
        fail("MANIFEST_SCOPE_MISMATCH", "manifest scope changed")
    if manifest["scope"]["sourceE57"] != heldout_report["scope"]["sourceE57"]:
        fail("SOURCE_E57_MISMATCH", "manifest source is not the frozen-report source")
    if manifest.get("selectionPlan") != protocol.get("selectionPlan"):
        fail("FROZEN_SELECTION_MISMATCH", "manifest selection differs from protocol")
    if manifest.get("analysisPlan") != EXPECTED_ANALYSIS_PLAN:
        fail("MANIFEST_MISMATCH", "manifest analysis plan changed")
    if manifest.get("limitations") != EXPECTED_LIMITATIONS:
        fail("MANIFEST_MISMATCH", "manifest limitations changed")
    if manifest.get("selfDigestMeaning") != EXPECTED_SELF_DIGEST_MEANING:
        fail("MANIFEST_MISMATCH", "manifest self-digest meaning changed")
    expected_policy = {
        "continuousCalibrationValidated": False,
        "metricGeometryValidated": False,
        "knownPoseMaterializationPermitted": False,
        "trainingPermitted": False,
        "signingPermitted": False,
        "publicationPermitted": False,
        "authority": "none",
    }
    if any(manifest.get(key) != value for key, value in expected_policy.items()):
        fail("AUTHORITY_UPGRADE", "manifest policy boundary changed")
    if manifest.get("truthSeparation") != {
        "captured": "byte-identical native JPEG copies and E57 identifiers",
        "measured": "fixed-primary XYZ/JPEG edge masks and residual counts",
        "generated": "PNG diagnostic overlays and this report",
        "aiGeneratedPixelsUsed": False,
    }:
        fail("TRUTH_SEPARATION_MISMATCH", "manifest truth separation changed")
    runtime = _closed_keys(
        manifest.get("runtime"),
        frozenset({"implementationSourcesVerifiedBeforeAndAfter", "dependencyVersions"}),
        "manifest.runtime",
    )
    if (
        runtime.get("implementationSourcesVerifiedBeforeAndAfter")
        != EXPECTED_IMPLEMENTATION_SOURCE_FILES
    ):
        fail("IMPLEMENTATION_RECEIPT_MISMATCH", "manifest implementation set changed")
    if runtime.get("dependencyVersions") != protocol["implementation"]["dependencyVersions"]:
        fail("IMPLEMENTATION_RECEIPT_MISMATCH", "manifest dependency set changed")

    artifact_rows = manifest.get("artifacts")
    if not isinstance(artifact_rows, list) or len(artifact_rows) != 54:
        fail("ARTIFACT_SET_MISMATCH", "manifest must list exactly 54 artifacts")
    artifacts: dict[str, Mapping[str, Any]] = {}
    for row in artifact_rows:
        row = _closed_keys(
            row,
            frozenset({"fileName", "sizeBytes", "sha256", "truthClass"}),
            "manifest artifact",
        )
        name = row.get("fileName")
        if not isinstance(name, str) or Path(name).name != name or name in artifacts:
            fail("ARTIFACT_SET_MISMATCH", "artifact name is invalid or duplicated")
        if not _is_int(row.get("sizeBytes")) or row["sizeBytes"] <= 0:
            fail("ARTIFACT_SET_MISMATCH", f"artifact {name} size is invalid")
        digest = row.get("sha256")
        if not isinstance(digest, str) or len(digest) != 64:
            fail("ARTIFACT_SET_MISMATCH", f"artifact {name} digest is invalid")
        artifacts[name] = row
    if list(artifacts) != sorted(artifacts):
        fail("ARTIFACT_SET_MISMATCH", "artifact list is not name-sorted")

    selections = protocol["selectionPlan"]["uniqueSelectedFaces"]
    selection_by_key = {_selection_key(row): row for row in selections}
    records = manifest.get("records")
    if not isinstance(records, list) or len(records) != 27:
        fail("RECORD_SET_MISMATCH", "manifest must have exactly 27 records")
    record_by_key: dict[tuple[int, str], Mapping[str, Any]] = {}
    dimensions: dict[str, tuple[int, int]] = {}
    referenced_artifacts: set[str] = set()
    for record in records:
        record = _closed_keys(record, RECORD_ROOT_KEYS, "manifest record")
        if not _is_int(record.get("scanId")) or not isinstance(record.get("faceName"), str):
            fail("RECORD_SET_MISMATCH", "record identity is invalid")
        key = (record["scanId"], record["faceName"])
        if key in record_by_key or key not in selection_by_key:
            fail("RECORD_SET_MISMATCH", "record identity is duplicate or unselected")
        selection = selection_by_key[key]
        for field in (
            "exploratoryRoles",
            "pairIds",
            "frozenStatus",
            "frozenReasons",
        ):
            if record.get(field) != selection.get(field):
                fail("RECORD_SET_MISMATCH", f"record {key} {field} changed")
        for field in (
            "continuousCalibrationValidated",
            "metricGeometryValidated",
            "knownPoseMaterializationPermitted",
            "trainingPermitted",
        ):
            if record.get(field) is not False:
                fail("AUTHORITY_UPGRADE", f"record {key} upgraded {field}")

        captured = _closed_keys(
            record.get("captured"),
            frozenset({"data3DGuid", "image2DIndex", "image2DGuid", "jpeg", "nativeCopy"}),
            "record.captured",
        )
        for field in ("data3DGuid", "image2DIndex", "image2DGuid", "jpeg"):
            if captured.get(field) != selection.get(field):
                fail("CAPTURE_RECEIPT_MISMATCH", f"record {key} captured {field} changed")
        native = _closed_keys(
            captured.get("nativeCopy"),
            frozenset({"fileName", "sizeBytes", "sha256", "truthClass"}),
            "record native copy",
        )
        expected_native_name = _artifact_name(selection, "native.jpg")
        if (
            native.get("fileName") != expected_native_name
            or native.get("sizeBytes") != selection["jpeg"]["sizeBytes"]
            or native.get("sha256") != selection["jpeg"]["sha256"]
            or native.get("truthClass") != "captured_byte_identical_copy"
            or artifacts.get(expected_native_name) != native
        ):
            fail("CAPTURE_RECEIPT_MISMATCH", f"record {key} native JPEG receipt changed")
        dimensions[expected_native_name] = (
            int(selection["jpeg"]["width"]),
            int(selection["jpeg"]["height"]),
        )

        generated = _closed_keys(
            record.get("generated"), frozenset({"overlay"}), "record.generated"
        )
        overlay = _closed_keys(
            generated.get("overlay"),
            frozenset({"fileName", "sizeBytes", "sha256", "truthClass"}),
            "record overlay",
        )
        expected_overlay_name = _artifact_name(selection, "overlay.png")
        if (
            overlay.get("fileName") != expected_overlay_name
            or overlay.get("truthClass") != "generated_diagnostic_presentation"
            or artifacts.get(expected_overlay_name) != overlay
        ):
            fail("OVERLAY_RECEIPT_MISMATCH", f"record {key} overlay receipt changed")
        dimensions[expected_overlay_name] = (4096, 4096)
        referenced_artifacts.update({expected_native_name, expected_overlay_name})

        _validate_measured(record.get("measured"), selection, record["faceName"])
        record_by_key[key] = record

    if list(record_by_key) != sorted(record_by_key):
        fail("RECORD_SET_MISMATCH", "record list is not scan/face sorted")
    if set(record_by_key) != set(selection_by_key):
        fail("RECORD_SET_MISMATCH", "records do not cover the exact selection")
    if referenced_artifacts != set(artifacts):
        fail("ARTIFACT_SET_MISMATCH", "records and artifact list do not have the same set")
    if Counter(row["frozenStatus"] for row in records) != Counter(EXPECTED_STATUS_COUNTS):
        fail("RECORD_SET_MISMATCH", "record status counts changed")

    pairs = manifest.get("pairComparisons")
    if not isinstance(pairs, list) or len(pairs) != 14:
        fail("PAIR_SUMMARY_MISMATCH", "manifest must have exactly 14 pair comparisons")
    for index, (actual, planned) in enumerate(
        zip(pairs, protocol["selectionPlan"]["pairs"], strict=True), start=1
    ):
        actual = _closed_keys(
            actual,
            frozenset(
                {
                    "pairId",
                    "failure",
                    "control",
                    "failureMinusControlUnmatchedResidualFraction",
                    "decisionRole",
                }
            ),
            "pair comparison",
        )
        if actual.get("pairId") != f"pair-{index:02d}" or actual["pairId"] != planned["pairId"]:
            fail("PAIR_SUMMARY_MISMATCH", "pair order or identity changed")
        expected_sides: dict[str, dict[str, Any]] = {}
        for role in ("failure", "control"):
            planned_side = planned[role]
            record = record_by_key[_selection_key(planned_side)]
            expected_sides[role] = {
                "scanId": record["scanId"],
                "faceName": record["faceName"],
                "frozenStatus": record["frozenStatus"],
                "unmatchedResidualFraction": record["measured"]["unmatchedResidualFraction"],
            }
            if actual.get(role) != expected_sides[role]:
                fail("PAIR_SUMMARY_MISMATCH", f"pair {index} {role} diverges from record")
        delta = _round(
            expected_sides["failure"]["unmatchedResidualFraction"]
            - expected_sides["control"]["unmatchedResidualFraction"],
            9,
        )
        if actual.get("failureMinusControlUnmatchedResidualFraction") != delta:
            fail("PAIR_SUMMARY_MISMATCH", f"pair {index} delta does not reproduce")
        if actual.get("decisionRole") != "exploratory_comparison_only":
            fail("PAIR_SUMMARY_MISMATCH", f"pair {index} decision role changed")

    aggregate = _aggregate_metrics(pairs)
    if aggregate["pairDeltasInProtocolOrder"] != EXPECTED_PAIR_DELTAS:
        fail("PAIR_SUMMARY_MISMATCH", "the sealed pair delta sequence changed")
    if aggregate != {
        "failureMeanUnmatchedResidualFraction": 0.547400907071,
        "controlMeanUnmatchedResidualFraction": 0.369792160357,
        "meanFailureMinusControl": 0.177608746714,
        "medianFailureMinusControl": 0.181264386,
        "minimumFailureMinusControl": -0.092123737,
        "maximumFailureMinusControl": 0.375904862,
        "positivePairCount": 13,
        "zeroPairCount": 0,
        "negativePairCount": 1,
        "pairDeltasInProtocolOrder": EXPECTED_PAIR_DELTAS,
    }:
        fail("PAIR_SUMMARY_MISMATCH", "sealed aggregate metrics changed")

    skybox5 = [row for row in records if row["faceName"] == "Skybox 5"]
    nadir_summary = {
        "selectedRecordCount": len(skybox5),
        "failureRecordCount": sum(row["frozenStatus"] != PASS for row in skybox5),
        "controlRecordCount": sum(row["frozenStatus"] == PASS for row in skybox5),
        "geometryEdgePixelsInside": sum(
            row["measured"]["hypothesizedNativeNadirTripodRegion"]["geometryEdgePixelsInside"]
            for row in skybox5
        ),
        "unmatchedResidualPixelsInside": sum(
            row["measured"]["hypothesizedNativeNadirTripodRegion"]["unmatchedResidualPixelsInside"]
            for row in skybox5
        ),
        "failureUnmatchedResidualPixelCount": sum(
            row["measured"]["unmatchedGeometryResidualPixelCount"]
            for row in skybox5
            if row["frozenStatus"] != PASS
        ),
        "controlUnmatchedResidualPixelCount": sum(
            row["measured"]["unmatchedGeometryResidualPixelCount"]
            for row in skybox5
            if row["frozenStatus"] == PASS
        ),
        "assessable": False,
        "reason": "no selected Skybox 5 geometry-edge pixel falls inside the predeclared circle",
    }
    if nadir_summary != {
        "selectedRecordCount": 13,
        "failureRecordCount": 7,
        "controlRecordCount": 6,
        "geometryEdgePixelsInside": 0,
        "unmatchedResidualPixelsInside": 0,
        "failureUnmatchedResidualPixelCount": 53_443,
        "controlUnmatchedResidualPixelCount": 29_441,
        "assessable": False,
        "reason": "no selected Skybox 5 geometry-edge pixel falls inside the predeclared circle",
    }:
        fail("REGION_METRIC_MISMATCH", "sealed nadir summary changed")
    aggregate["predeclaredSkybox5Region"] = nadir_summary
    if manifest.get("payloadSha256") != EXPECTED_MANIFEST_RECEIPT["payloadSha256"]:
        fail("MANIFEST_MISMATCH", "manifest payload identity changed")
    return artifacts, dimensions, aggregate


def _jpeg_dimensions(path: Path) -> tuple[int, int]:
    before = _regular_file_stat(path, f"JPEG {path.name}", 64 * 1024 * 1024)
    dimensions: tuple[int, int] | None = None
    try:
        with path.open("rb") as handle:
            if handle.read(2) != b"\xff\xd8":
                fail("INVALID_JPEG", f"{path.name} has no JPEG SOI marker")
            while True:
                prefix = handle.read(1)
                if not prefix:
                    break
                if prefix != b"\xff":
                    continue
                while prefix == b"\xff":
                    marker_byte = handle.read(1)
                    if not marker_byte:
                        fail("INVALID_JPEG", f"{path.name} has a truncated marker")
                    if marker_byte != b"\xff":
                        break
                marker = marker_byte[0]
                if marker in {0x01, *range(0xD0, 0xDA)}:
                    continue
                length_bytes = handle.read(2)
                if len(length_bytes) != 2:
                    fail("INVALID_JPEG", f"{path.name} has a truncated segment")
                length = struct.unpack(">H", length_bytes)[0]
                if length < 2:
                    fail("INVALID_JPEG", f"{path.name} has an invalid segment")
                if marker in {
                    0xC0,
                    0xC1,
                    0xC2,
                    0xC3,
                    0xC5,
                    0xC6,
                    0xC7,
                    0xC9,
                    0xCA,
                    0xCB,
                    0xCD,
                    0xCE,
                    0xCF,
                }:
                    payload = handle.read(length - 2)
                    if len(payload) < 5:
                        fail("INVALID_JPEG", f"{path.name} has a short SOF segment")
                    height, width = struct.unpack(">HH", payload[1:5])
                    dimensions = (width, height)
                    break
                handle.seek(length - 2, os.SEEK_CUR)
    except OSError as error:
        fail("READ_FAILED", f"cannot inspect JPEG {path.name}: {error}")
    if dimensions is None:
        fail("INVALID_JPEG", f"{path.name} has no supported SOF marker")
    after = _regular_file_stat(path, f"JPEG {path.name}", 64 * 1024 * 1024)
    if not _same_file_identity(before, after):
        fail("FILE_CHANGED_DURING_READ", f"JPEG {path.name} changed during inspection")
    return dimensions


def _png_dimensions(path: Path) -> tuple[int, int]:
    before = _regular_file_stat(path, f"PNG {path.name}", 64 * 1024 * 1024)
    try:
        with path.open("rb") as handle:
            header = handle.read(33)
    except OSError as error:
        fail("READ_FAILED", f"cannot inspect PNG {path.name}: {error}")
    if (
        len(header) != 33
        or header[:8] != b"\x89PNG\r\n\x1a\n"
        or header[8:12] != b"\x00\x00\x00\r"
        or header[12:16] != b"IHDR"
    ):
        fail("INVALID_PNG", f"{path.name} has no canonical PNG IHDR")
    width, height = struct.unpack(">II", header[16:24])
    if header[24:29] != bytes((8, 2, 0, 0, 0)):
        fail("INVALID_PNG", f"{path.name} is not the expected 8-bit RGB PNG")
    after = _regular_file_stat(path, f"PNG {path.name}", 64 * 1024 * 1024)
    if not _same_file_identity(before, after):
        fail("FILE_CHANGED_DURING_READ", f"PNG {path.name} changed during inspection")
    return width, height


def _verify_artifacts(
    package_directory: Path,
    artifacts: Mapping[str, Mapping[str, Any]],
    dimensions: Mapping[str, tuple[int, int]],
    initial_directory_stat: os.stat_result,
) -> dict[str, Any]:
    before = _directory_stat(package_directory, "package directory")
    if not _same_directory_identity(initial_directory_stat, before):
        fail("PACKAGE_DIRECTORY_CHANGED", "package directory identity changed")
    expected_names = set(artifacts) | {"manifest.json"}
    try:
        entries = list(package_directory.iterdir())
    except OSError as error:
        fail("READ_FAILED", f"cannot enumerate package directory: {error}")
    actual_names = {entry.name for entry in entries}
    if len(entries) != len(actual_names) or actual_names != expected_names:
        fail(
            "DIRECTORY_SET_MISMATCH",
            f"package directory entries changed (extra={sorted(actual_names - expected_names)}, "
            f"missing={sorted(expected_names - actual_names)})",
        )
    actual_receipts: list[dict[str, Any]] = []
    for name in sorted(artifacts):
        expected = artifacts[name]
        path = package_directory / name
        actual = _file_receipt(path, f"artifact {name}", int(expected["sizeBytes"]))
        expected_plain = {
            key: expected[key] for key in ("fileName", "sizeBytes", "sha256")
        }
        if actual != expected_plain:
            fail("ARTIFACT_RECEIPT_MISMATCH", f"artifact {name} receipt changed")
        if name.endswith("__native.jpg"):
            actual_dimensions = _jpeg_dimensions(path)
        elif name.endswith("__overlay.png"):
            actual_dimensions = _png_dimensions(path)
        else:
            fail("ARTIFACT_SET_MISMATCH", f"artifact {name} has an unexpected suffix")
        if actual_dimensions != dimensions[name]:
            fail("ARTIFACT_DIMENSION_MISMATCH", f"artifact {name} dimensions changed")
        actual_receipts.append(actual)

    manifest_actual = _file_receipt(
        package_directory / "manifest.json",
        "exploratory manifest snapshot",
        int(EXPECTED_MANIFEST_RECEIPT["sizeBytes"]),
    )
    expected_manifest_plain = {
        key: EXPECTED_MANIFEST_RECEIPT[key]
        for key in ("fileName", "sizeBytes", "sha256")
    }
    if manifest_actual != expected_manifest_plain:
        fail("EXACT_FILE_RECEIPT_MISMATCH", "manifest changed during package snapshot")

    artifact_set_sha256 = hashlib.sha256(
        ARTIFACT_SET_DIGEST_DOMAIN + _canonical_json_bytes(actual_receipts)
    ).hexdigest()
    if artifact_set_sha256 != EXPECTED_ARTIFACT_SET_SHA256:
        fail("ARTIFACT_SET_MISMATCH", "derived artifact-set receipt changed")
    directory_receipts = sorted(
        [*actual_receipts, manifest_actual], key=lambda row: str(row["fileName"])
    )
    directory_set_sha256 = hashlib.sha256(
        DIRECTORY_SET_DIGEST_DOMAIN + _canonical_json_bytes(directory_receipts)
    ).hexdigest()
    if directory_set_sha256 != EXPECTED_DIRECTORY_SET_SHA256:
        fail("DIRECTORY_SET_MISMATCH", "derived directory-set receipt changed")
    try:
        final_entries = list(package_directory.iterdir())
    except OSError as error:
        fail("READ_FAILED", f"cannot re-enumerate package directory: {error}")
    final_names = {entry.name for entry in final_entries}
    if len(final_entries) != len(final_names) or final_names != expected_names:
        fail("DIRECTORY_SET_MISMATCH", "package changed during snapshot re-enumeration")
    after = _directory_stat(package_directory, "package directory")
    if not _same_directory_identity(initial_directory_stat, after):
        fail("PACKAGE_DIRECTORY_CHANGED", "package directory identity changed")
    return {
        "artifactSetSha256": artifact_set_sha256,
        "directorySetSha256": directory_set_sha256,
        "artifactReceipts": actual_receipts,
        "directoryReceipts": directory_receipts,
    }


def verify_package(
    *,
    package_directory: Path,
    protocol_path: Path,
    frozen_report_path: Path,
    repo_root: Path,
    _between_snapshot_hook: Callable[[], None] | None = None,
) -> dict[str, Any]:
    package_directory = _absolute_lexical(package_directory)
    protocol_path = _absolute_lexical(protocol_path)
    frozen_report_path = _absolute_lexical(frozen_report_path)
    repo_root = _absolute_lexical(repo_root)
    if package_directory.name != EXPECTED_OUTPUT_DIRECTORY_NAME:
        fail("OUTPUT_NAME_MISMATCH", "package directory basename changed")
    initial_directory_stat = _directory_stat(package_directory, "package directory")
    _directory_stat(repo_root, "repository root")

    heldout, heldout_receipt = _read_json(
        frozen_report_path,
        "frozen heldout report",
        EXPECTED_FROZEN_REPORT_RECEIPT,
        64 * 1024 * 1024,
    )
    protocol, protocol_receipt = _read_json(
        protocol_path,
        "exploratory protocol",
        EXPECTED_PROTOCOL_RECEIPT,
        8 * 1024 * 1024,
    )
    manifest, manifest_receipt = _read_json(
        package_directory / "manifest.json",
        "exploratory manifest",
        EXPECTED_MANIFEST_RECEIPT,
        8 * 1024 * 1024,
    )
    _validate_heldout_report(heldout)
    _validate_protocol(protocol, heldout, repo_root)
    artifacts, dimensions, aggregate = _validate_manifest(manifest, protocol, heldout)
    verifier_receipt = _file_receipt(
        _absolute_lexical(Path(__file__)), "external verifier", 5 * 1024 * 1024
    )
    first_snapshot = _verify_artifacts(
        package_directory, artifacts, dimensions, initial_directory_stat
    )
    if _between_snapshot_hook is not None:
        _between_snapshot_hook()
    before_final_snapshot = _directory_stat(package_directory, "package directory")
    if not _same_directory_identity(initial_directory_stat, before_final_snapshot):
        fail("PACKAGE_DIRECTORY_CHANGED", "package directory identity changed")
    second_snapshot = _verify_artifacts(
        package_directory, artifacts, dimensions, initial_directory_stat
    )
    if first_snapshot != second_snapshot:
        fail("FINAL_SNAPSHOT_MISMATCH", "the two full package snapshots differ")
    final_directory_stat = _directory_stat(package_directory, "package directory")
    if not _same_directory_identity(initial_directory_stat, final_directory_stat):
        fail("PACKAGE_DIRECTORY_CHANGED", "package directory identity changed")
    artifact_set = str(second_snapshot["artifactSetSha256"])
    directory_set = str(second_snapshot["directorySetSha256"])
    report = {
        "schemaVersion": VERIFICATION_SCHEMA_VERSION,
        "status": "PASS_SEALED_PACKAGE_INTEGRITY",
        "authority": "none",
        "inputs": {
            "sourceE57": EXPECTED_SOURCE_E57_RECEIPT,
            "sourceE57BytesRehashedByThisVerifier": False,
            "frozenHeldoutReport": {
                **heldout_receipt,
                "schemaVersion": heldout["schemaVersion"],
                "payloadSha256": heldout["payloadSha256"],
            },
            "protocol": {
                **protocol_receipt,
                "schemaVersion": protocol["schemaVersion"],
                "payloadSha256": protocol["payloadSha256"],
            },
            "manifest": {
                **manifest_receipt,
                "schemaVersion": manifest["schemaVersion"],
                "payloadSha256": manifest["payloadSha256"],
            },
            "boundRendererImplementation": EXPECTED_IMPLEMENTATION_SOURCE_FILES,
            "externalVerifier": verifier_receipt,
        },
        "derivedReceipts": {
            "artifactSet": {
                "sha256": artifact_set,
                "domain": ARTIFACT_SET_DIGEST_DOMAIN[:-1].decode("ascii"),
                "artifactCount": 54,
                "persistedByV1Renderer": False,
                "meaning": "verifier-derived digest over name/size/SHA-256 artifact receipts",
            },
            "directorySet": {
                "sha256": directory_set,
                "domain": DIRECTORY_SET_DIGEST_DOMAIN[:-1].decode("ascii"),
                "fileCount": 55,
                "persistedByV1Renderer": False,
                "meaning": (
                    "verifier-derived digest over all package file receipts "
                    "including manifest"
                ),
            },
        },
        "checks": {
            "closedProtocolAndManifestObjects": True,
            "exactWholeFileIdentities": True,
            "lexicalPathsCheckedWithoutSymlinkDereference": True,
            "allExistingInputAncestorsRejectSymlinksAndReparsePoints": True,
            "packageDirectoryIdentityStableAcrossVerification": True,
            "twoFullPackageReceiptSnapshotsMatch": True,
            "frozenSourceDescriptorLinkedAcrossReportProtocolAndManifest": True,
            "nativeJpegCopiesMatchFrozenHeldoutReceipts": True,
            "overlayPngReceiptsAnd4096DimensionsVerified": True,
            "exactArtifactAndDirectorySets": True,
            "recordPairStatusAndSummaryLinkage": True,
            "retainedPrimaryMetricFieldsComparedToFrozen": [
                "geometryEdgePixelCount",
                "photoEdgePixelCount",
                "matchedGeometryEdgePixelCount",
                "matchedFraction",
            ],
            "rawAnalysisMasksRetained": False,
            "renderTimeMaskComputationIndependentlyReplayed": False,
            "postReturnByteSwapPrevented": False,
            "externalVerifierSelfAuthenticating": False,
        },
        "aggregateMetrics": aggregate,
        "limitations": [
            RAW_MASK_LIMITATION,
            POST_RETURN_SWAP_LIMITATION,
            SELF_AUTHENTICITY_LIMITATION,
        ],
        "selfDigestMeaning": {
            "authenticatesCreator": False,
            "provesTimestamp": False,
            "provesImmutability": False,
        },
        "signingPermitted": False,
        "publicationPermitted": False,
        "trainingPermitted": False,
    }
    return _finalize(report, VERIFICATION_DIGEST_DOMAIN)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-directory", required=True, type=Path)
    parser.add_argument("--protocol", required=True, type=Path)
    parser.add_argument("--frozen-report", required=True, type=Path)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=_absolute_lexical(Path(__file__)).parents[2],
        help="repository root used to verify bound renderer source receipts",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        result = verify_package(
            package_directory=_absolute_lexical(args.package_directory),
            protocol_path=_absolute_lexical(args.protocol),
            frozen_report_path=_absolute_lexical(args.frozen_report),
            repo_root=_absolute_lexical(args.repo_root),
        )
    except VerificationError as error:
        print(
            json.dumps(
                {"status": "FAIL", "code": error.code, "message": error.message},
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
    print(_canonical_json_bytes(result).decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
