#!/usr/bin/env python3
"""Create hash-bound exploratory overlays for the consumed E57 edge evidence.

This tool is deliberately downstream of the frozen v2 held-out audit.  It does
not change or re-run that audit, choose thresholds, or create fresh held-out
evidence.  ``create-protocol`` reads the frozen report and predeclares the exact
14 non-passing faces, a deterministic same-face passing control for each, and a
hypothesized central nadir/tripod region.  ``render`` then reads only the XYZ
fields and exact embedded JPEG bytes needed to reconstruct the already-frozen
primary geometry mask and render lossless, full-native-resolution diagnostics.

The output separates captured bytes (byte-identical JPEG copies), measured
arrays/metrics (XYZ-versus-JPEG edge residuals), and generated presentation
artifacts (PNG overlays).  It grants no authority for calibration, metric
geometry, pose materialization, training, signing, or publication.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import hmac
import importlib.metadata
import io
import json
import math
import os
import platform
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

import audit_e57_geometry_edge_protocol as frozen
import audit_e57_geometry_edges as geometry
from audit_e57_room_images import (
    AuditError,
    MAX_E57_BYTES,
    MAX_IMAGE_BYTES,
    _canonical_json_bytes,
    _safe_regular_file,
    _same_file_identity,
    _sha256_file,
    fail,
    write_create_only,
)


PROTOCOL_SCHEMA_VERSION = (
    "omnitwin.reception.e57-geometry-edge-exploratory-overlay-protocol.v1"
)
REPORT_SCHEMA_VERSION = (
    "omnitwin.reception.e57-geometry-edge-exploratory-overlay-report.v1"
)
PROTOCOL_DIGEST_DOMAIN = (
    b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_EXPLORATORY_OVERLAY_PROTOCOL_V1\0"
)
REPORT_DIGEST_DOMAIN = (
    b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_EXPLORATORY_OVERLAY_REPORT_V1\0"
)
FROZEN_REPORT_DIGEST_DOMAIN = frozen.REPORT_DIGEST_DOMAIN
FROZEN_REPORT_SCHEMA_VERSION = frozen.REPORT_SCHEMA_VERSION
MAX_FROZEN_REPORT_BYTES = 64 * 1024 * 1024
MAX_PROTOCOL_BYTES = 8 * 1024 * 1024
MAX_TOOL_SOURCE_BYTES = 5 * 1024 * 1024
EXPECTED_FROZEN_REPORT_FILE_NAME = (
    "reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json"
)
EXPECTED_FROZEN_REPORT_SIZE_BYTES = 19_800_301
EXPECTED_FROZEN_REPORT_SHA256 = (
    "ed744eba259c5a40c886af65d8fccf54c36a60ee2e5890449dee0c23f50794a0"
)
EXPECTED_FROZEN_REPORT_PAYLOAD_SHA256 = (
    "5bdfcb380692dfa6bb61c62880303cd46a13455737653667dfcba139213bf906"
)
EXPECTED_SOURCE_E57_FILE_NAME = "cloud_0.e57"
EXPECTED_SOURCE_E57_SIZE_BYTES = 20_518_437_888
EXPECTED_SOURCE_E57_SHA256 = (
    "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd"
)
EXPECTED_FAILURE_COUNT = 14
EXPECTED_PAIR_COUNT = 14
EXPECTED_UNIQUE_SELECTED_FACE_COUNT = 27
ANALYSIS_SIZE = frozen.ANALYSIS_SIZE
NADIR_FACE_NAME = "Skybox 5"
NADIR_REGION_CENTRE_XY = (256, 256)
NADIR_REGION_RADIUS_PIXELS = 80
NATIVE_IMAGE_SIZE = 4096
NATIVE_NADIR_REGION_CENTRE_XY = (2048, 2048)
NATIVE_NADIR_REGION_RADIUS_PIXELS = 640
PASS = frozen.PASS
NONPASS_STATUSES = frozenset(
    {
        frozen.REJECT_GEOMETRY_MISMATCH,
        frozen.BLOCKED_INSUFFICIENT_GEOMETRY,
        frozen.BLOCKED_AMBIGUOUS,
    }
)
POINT_COLOUR_FIELD_NAMES = frozenset(frozen.POINT_COLOUR_FIELD_NAMES)
IMPLEMENTATION_PATHS = (
    Path(__file__).resolve(),
    Path(frozen.__file__).resolve(),
    Path(geometry.__file__).resolve(),
    Path(__file__).resolve().parent
    / "tests"
    / "test_explore_e57_geometry_edge_residuals.py",
)


def _expected_evidence_state() -> dict[str, Any]:
    return {
        "consumedPreviouslyHeldOutEvidence": True,
        "freshHeldOutEvidence": False,
        "acceptanceDecisionRole": "none",
        "thresholdsChanged": False,
        "frozenProtocolOrReportEdited": False,
        "hypothesisGeneratingOnly": True,
    }


def _expected_nadir_region() -> dict[str, Any]:
    return {
        "appliesOnlyToFace": NADIR_FACE_NAME,
        "shape": "circle",
        "analysisCentreXYPixels": list(NADIR_REGION_CENTRE_XY),
        "analysisRadiusPixels": NADIR_REGION_RADIUS_PIXELS,
        "native4096CentreXYPixels": list(NATIVE_NADIR_REGION_CENTRE_XY),
        "native4096RadiusPixels": NATIVE_NADIR_REGION_RADIUS_PIXELS,
        "chosenBeforeRendering": True,
        "excludedFromAnyMetric": False,
        "meaning": (
            "conservative central nadir hypothesis for scanner/tripod footprint; "
            "not a confirmed object mask or causal label"
        ),
    }


def _expected_analysis_plan() -> dict[str, Any]:
    return {
        "analysisGrid": {"width": ANALYSIS_SIZE, "height": ANALYSIS_SIZE},
        "primaryMaskOnly": True,
        "all48CandidatesRescored": False,
        "frozenPrimaryMetricEqualityRequired": True,
        "readScanArguments": {
            "intensity": False,
            "colors": False,
            "row_column": True,
            "transform": False,
        },
        "allowedPointFields": list(frozen.POINT_FIELDS_REQUESTED),
        "pointColourFieldsRequestedOrRead": False,
        "nativeJpegBytesCopiedWithoutRecoding": True,
        "overlayResolution": "exact_native_JPEG_dimensions",
        "residualDefinition": (
            "primary geometry-edge pixel is matched when Euclidean distance "
            "to a frozen-method photo-edge pixel is <=2 analysis pixels; "
            "otherwise it is an unmatched residual"
        ),
        "hypothesizedNativeNadirTripodRegion": _expected_nadir_region(),
    }


def _expected_truth_and_authority() -> dict[str, Any]:
    return {
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


def _expected_self_digest_meaning() -> dict[str, bool]:
    return {
        "authenticatesCreator": False,
        "provesTimestamp": False,
        "provesImmutability": False,
    }


def _round(value: float, digits: int = 9) -> float:
    result = round(float(value), digits)
    return 0.0 if result == 0.0 else result


def _finalize(payload: Mapping[str, Any], domain: bytes) -> dict[str, Any]:
    without_digest = dict(payload)
    without_digest.pop("payloadSha256", None)
    digest = hashlib.sha256(
        domain + _canonical_json_bytes(without_digest)
    ).hexdigest()
    return {**without_digest, "payloadSha256": digest}


def _verify_payload_digest(
    payload: Mapping[str, Any],
    domain: bytes,
    *,
    label: str,
    error_code: str,
) -> None:
    expected = payload.get("payloadSha256")
    if not isinstance(expected, str) or len(expected) != 64:
        fail(error_code, f"{label} has no valid payloadSha256")
    without_digest = dict(payload)
    without_digest.pop("payloadSha256", None)
    actual = hashlib.sha256(
        domain + _canonical_json_bytes(without_digest)
    ).hexdigest()
    if not hmac.compare_digest(expected.lower(), actual):
        fail(error_code, f"{label} payload digest does not verify")


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key, value in pairs:
        if key in output:
            raise ValueError(f"duplicate JSON key {key!r}")
        output[key] = value
    return output


def _read_json_with_receipt(
    path: Path,
    *,
    label: str,
    maximum_bytes: int,
    error_code: str,
) -> tuple[dict[str, Any], dict[str, Any], os.stat_result]:
    before = _safe_regular_file(path, label, maximum_bytes)
    try:
        payload = path.read_bytes()
    except OSError as error:
        fail("READ_FAILED", f"could not read {label}: {error}")
    after = _safe_regular_file(path, label, maximum_bytes)
    if not _same_file_identity(before, after):
        fail("FILE_CHANGED_DURING_READ", f"{label} changed while being read")
    try:
        parsed = json.loads(
            payload.decode("utf-8"), object_pairs_hook=_reject_duplicate_keys
        )
    except (UnicodeError, json.JSONDecodeError, ValueError) as error:
        fail(error_code, f"could not parse {label}: {error}")
    if not isinstance(parsed, dict):
        fail(error_code, f"{label} must contain one JSON object")
    return (
        parsed,
        {
            "fileName": path.name,
            "sizeBytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        },
        before,
    )


def _file_receipt(path: Path, *, maximum_bytes: int) -> dict[str, Any]:
    before = _safe_regular_file(path, path.name, maximum_bytes)
    return {
        "fileName": path.name,
        "sizeBytes": before.st_size,
        "sha256": _sha256_file(path, before, maximum_bytes),
    }


def _implementation_receipts() -> list[dict[str, Any]]:
    receipts: list[dict[str, Any]] = []
    for path in IMPLEMENTATION_PATHS:
        receipts.append(_file_receipt(path, maximum_bytes=MAX_TOOL_SOURCE_BYTES))
    return receipts


def _dependency_versions() -> dict[str, str]:
    def version(distribution: str) -> str:
        try:
            return importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            return "unavailable"

    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "Pillow": version("Pillow"),
        "scipy": version("scipy"),
        "pye57": version("pye57"),
    }


def _validate_frozen_report(report: Mapping[str, Any]) -> None:
    if report.get("schemaVersion") != FROZEN_REPORT_SCHEMA_VERSION:
        fail("INVALID_FROZEN_REPORT", "frozen report schema is not v2")
    _verify_payload_digest(
        report,
        FROZEN_REPORT_DIGEST_DOMAIN,
        label="frozen heldout report",
        error_code="INVALID_FROZEN_REPORT",
    )
    if report.get("payloadSha256") != EXPECTED_FROZEN_REPORT_PAYLOAD_SHA256:
        fail("INVALID_FROZEN_REPORT", "frozen report payload identity changed")
    if report.get("authority") != "none":
        fail("INVALID_FROZEN_REPORT", "frozen report authority must remain none")
    images = report.get("images")
    if not isinstance(images, list) or len(images) != 96:
        fail("INVALID_FROZEN_REPORT", "frozen report must contain exactly 96 faces")
    expected_pairs = {
        (scan_id, f"Skybox {face}")
        for scan_id in frozen.HELD_OUT_SCAN_IDS
        for face in range(6)
    }
    actual_pairs: set[tuple[int, str]] = set()
    jpeg_hashes: set[str] = set()
    for index, row in enumerate(images):
        if not isinstance(row, Mapping):
            fail("INVALID_FROZEN_REPORT", f"image row {index} is not an object")
        scan_id = row.get("scanId")
        name = row.get("name")
        pair = (scan_id, name)
        if (
            not isinstance(scan_id, int)
            or isinstance(scan_id, bool)
            or not isinstance(name, str)
            or pair in actual_pairs
        ):
            fail("INVALID_FROZEN_REPORT", f"image row {index} identity is invalid")
        actual_pairs.add(pair)
        jpeg = row.get("jpeg")
        if not isinstance(jpeg, Mapping):
            fail("INVALID_FROZEN_REPORT", f"image row {index} has no JPEG receipt")
        jpeg_hash = jpeg.get("sha256")
        if (
            not isinstance(jpeg_hash, str)
            or len(jpeg_hash) != 64
            or jpeg_hash in jpeg_hashes
        ):
            fail("INVALID_FROZEN_REPORT", f"image row {index} JPEG hash is invalid")
        jpeg_hashes.add(jpeg_hash)
        if row.get("trainingPermitted") is not False:
            fail("INVALID_FROZEN_REPORT", "frozen report must prohibit training")
    if actual_pairs != expected_pairs:
        fail("INVALID_FROZEN_REPORT", "frozen report face set is not exact")
    nonpass = [row for row in images if row.get("status") != PASS]
    if len(nonpass) != EXPECTED_FAILURE_COUNT or any(
        row.get("status") not in NONPASS_STATUSES for row in nonpass
    ):
        fail(
            "INVALID_FROZEN_REPORT",
            "frozen report does not contain the exact expected 14 non-passing faces",
        )
    scope = report.get("scope")
    if not isinstance(scope, Mapping) or not isinstance(
        scope.get("sourceE57"), Mapping
    ):
        fail("INVALID_FROZEN_REPORT", "frozen report source receipt is missing")
    if scope["sourceE57"] != {
        "fileName": EXPECTED_SOURCE_E57_FILE_NAME,
        "sizeBytes": EXPECTED_SOURCE_E57_SIZE_BYTES,
        "sha256": EXPECTED_SOURCE_E57_SHA256,
    }:
        fail("INVALID_FROZEN_REPORT", "frozen report source E57 identity changed")


def _validate_expected_frozen_report_receipt(receipt: Mapping[str, Any]) -> None:
    if dict(receipt) != {
        "fileName": EXPECTED_FROZEN_REPORT_FILE_NAME,
        "sizeBytes": EXPECTED_FROZEN_REPORT_SIZE_BYTES,
        "sha256": EXPECTED_FROZEN_REPORT_SHA256,
    }:
        fail("INVALID_FROZEN_REPORT", "frozen report exact file receipt changed")


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


def select_failure_control_pairs(
    images: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Select every non-pass and its deterministic nearest same-face pass."""

    failures = sorted(
        (row for row in images if row.get("status") != PASS),
        key=lambda row: (int(row["scanId"]), str(row["name"])),
    )
    if len(failures) != EXPECTED_FAILURE_COUNT:
        raise ValueError("selection requires exactly 14 non-passing faces")
    pairs: list[dict[str, Any]] = []
    for pair_index, failure in enumerate(failures, start=1):
        controls = [
            row
            for row in images
            if row.get("name") == failure.get("name")
            and row.get("status") == PASS
        ]
        if not controls:
            raise ValueError(
                f"no same-face passing control for scan {failure['scanId']} {failure['name']}"
            )
        controls.sort(
            key=lambda row: (
                abs(int(row["scanId"]) - int(failure["scanId"])),
                int(row["scanId"]),
                int(row["image2DIndex"]),
            )
        )
        control = controls[0]
        pairs.append(
            {
                "pairId": f"pair-{pair_index:02d}",
                "failure": _selection_record(failure),
                "control": _selection_record(control),
                "controlSelection": {
                    "sameFaceRequired": True,
                    "absoluteScanIdDistance": abs(
                        int(control["scanId"]) - int(failure["scanId"])
                    ),
                    "orderedTieBreakValues": [
                        abs(int(control["scanId"]) - int(failure["scanId"])),
                        int(control["scanId"]),
                        int(control["image2DIndex"]),
                    ],
                },
            }
        )
    return pairs


def _selection_key(row: Mapping[str, Any]) -> tuple[int, str]:
    return int(row["scanId"]), str(row["faceName"])


def _unique_selections(pairs: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[tuple[int, str], dict[str, Any]] = {}
    roles: dict[tuple[int, str], set[str]] = {}
    pair_ids: dict[tuple[int, str], set[str]] = {}
    for pair in pairs:
        for role in ("failure", "control"):
            row = dict(pair[role])
            key = _selection_key(row)
            if key in by_key and by_key[key] != row:
                raise ValueError("one selected face has contradictory frozen records")
            by_key[key] = row
            roles.setdefault(key, set()).add(role)
            pair_ids.setdefault(key, set()).add(str(pair["pairId"]))
    output: list[dict[str, Any]] = []
    for key in sorted(by_key):
        output.append(
            {
                **by_key[key],
                "exploratoryRoles": sorted(roles[key]),
                "pairIds": sorted(pair_ids[key]),
            }
        )
    return output


def create_protocol(
    *,
    e57_path: Path,
    frozen_report_path: Path,
    output_path: Path,
    expected_output_directory_name: str,
) -> dict[str, Any]:
    if output_path.exists():
        fail("OUTPUT_EXISTS", "exploratory protocol output already exists")
    report, report_receipt, report_before = _read_json_with_receipt(
        frozen_report_path,
        label="frozen v2 heldout report",
        maximum_bytes=MAX_FROZEN_REPORT_BYTES,
        error_code="INVALID_FROZEN_REPORT",
    )
    _validate_frozen_report(report)
    _validate_expected_frozen_report_receipt(report_receipt)
    source_before = _safe_regular_file(e57_path, "source E57", MAX_E57_BYTES)
    source_sha256 = _sha256_file(e57_path, source_before, MAX_E57_BYTES)
    source_receipt = report["scope"]["sourceE57"]
    if (
        source_before.st_size != source_receipt.get("sizeBytes")
        or source_sha256 != source_receipt.get("sha256")
    ):
        fail("SOURCE_HASH_MISMATCH", "source E57 differs from the frozen report")
    if not expected_output_directory_name or Path(
        expected_output_directory_name
    ).name != expected_output_directory_name:
        fail("INVALID_OUTPUT_NAME", "expected output directory must be one basename")
    pairs = select_failure_control_pairs(report["images"])
    unique = _unique_selections(pairs)
    if (
        len(pairs) != EXPECTED_PAIR_COUNT
        or len(unique) != EXPECTED_UNIQUE_SELECTED_FACE_COUNT
    ):
        fail("INVALID_SELECTION", "expected 14 pairs and 27 unique selected faces")
    implementation = _implementation_receipts()
    dependencies = _dependency_versions()
    if dependencies["pye57"] == "unavailable":
        fail("PYE57_UNAVAILABLE", "pye57 is required for the exploratory render")
    protocol = {
        "schemaVersion": PROTOCOL_SCHEMA_VERSION,
        "purpose": "exploratory_failure_localization_and_hypothesis_generation",
        "evidenceState": _expected_evidence_state(),
        "inputs": {
            "sourceE57": dict(source_receipt),
            "frozenHeldoutReport": {
                **report_receipt,
                "schemaVersion": report["schemaVersion"],
                "payloadSha256": report["payloadSha256"],
            },
        },
        "implementation": {
            "sourceFiles": implementation,
            "dependencyVersions": dependencies,
        },
        "selectionPlan": {
            "failureRule": "all_and_only_frozen_status_not_PASS_DISCRETE_GEOMETRY_ORIENTATION",
            "controlRule": (
                "same face and frozen PASS; minimize in order absolute scan-ID "
                "distance, scan ID, then image2D index; reuse permitted"
            ),
            "failureCount": EXPECTED_FAILURE_COUNT,
            "pairCount": EXPECTED_PAIR_COUNT,
            "uniqueSelectedFaceCount": len(unique),
            "pairs": pairs,
            "uniqueSelectedFaces": unique,
        },
        "analysisPlan": _expected_analysis_plan(),
        "expectedOutputDirectoryName": expected_output_directory_name,
        "truthAndAuthority": _expected_truth_and_authority(),
        "selfDigestMeaning": _expected_self_digest_meaning(),
        "authority": "none",
    }
    if not _same_file_identity(
        report_before,
        _safe_regular_file(
            frozen_report_path, "frozen v2 heldout report", MAX_FROZEN_REPORT_BYTES
        ),
    ):
        fail("FILE_CHANGED_DURING_READ", "frozen report changed during protocol build")
    if not _same_file_identity(
        source_before, _safe_regular_file(e57_path, "source E57", MAX_E57_BYTES)
    ):
        fail("FILE_CHANGED_DURING_READ", "source E57 changed during protocol build")
    finalized = _finalize(protocol, PROTOCOL_DIGEST_DOMAIN)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_create_only(output_path, _canonical_json_bytes(finalized) + b"\n")
    return finalized


def _validate_protocol(
    protocol: Mapping[str, Any], frozen_report: Mapping[str, Any]
) -> None:
    if protocol.get("schemaVersion") != PROTOCOL_SCHEMA_VERSION:
        fail("INVALID_PROTOCOL", "unexpected exploratory protocol schema")
    _verify_payload_digest(
        protocol,
        PROTOCOL_DIGEST_DOMAIN,
        label="exploratory protocol",
        error_code="INVALID_PROTOCOL",
    )
    if protocol.get("authority") != "none":
        fail("INVALID_PROTOCOL", "protocol authority must remain none")
    if protocol.get("purpose") != (
        "exploratory_failure_localization_and_hypothesis_generation"
    ):
        fail("INVALID_PROTOCOL", "protocol purpose changed")
    if protocol.get("evidenceState") != _expected_evidence_state():
        fail("INVALID_PROTOCOL", "protocol evidence-state boundary changed")
    expected_pairs = select_failure_control_pairs(frozen_report["images"])
    selection = protocol.get("selectionPlan")
    expected_selection = {
        "failureRule": "all_and_only_frozen_status_not_PASS_DISCRETE_GEOMETRY_ORIENTATION",
        "controlRule": (
            "same face and frozen PASS; minimize in order absolute scan-ID "
            "distance, scan ID, then image2D index; reuse permitted"
        ),
        "failureCount": EXPECTED_FAILURE_COUNT,
        "pairCount": EXPECTED_PAIR_COUNT,
        "uniqueSelectedFaceCount": EXPECTED_UNIQUE_SELECTED_FACE_COUNT,
        "pairs": expected_pairs,
        "uniqueSelectedFaces": _unique_selections(expected_pairs),
    }
    if not isinstance(selection, Mapping) or dict(selection) != expected_selection:
        fail("INVALID_PROTOCOL", "protocol pair selection differs from frozen report")
    if protocol.get("analysisPlan") != _expected_analysis_plan():
        fail("INVALID_PROTOCOL", "exploratory analysis plan changed")
    if protocol.get("truthAndAuthority") != _expected_truth_and_authority():
        fail("INVALID_PROTOCOL", "protocol contains an unauthorized truth upgrade")
    if protocol.get("selfDigestMeaning") != _expected_self_digest_meaning():
        fail("INVALID_PROTOCOL", "protocol self-digest meaning changed")


def _verify_render_inputs(
    *,
    protocol_path: Path,
    frozen_report_path: Path,
    e57_path: Path,
    output_directory: Path,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    if output_directory.exists():
        fail("OUTPUT_EXISTS", "exploratory output directory already exists")
    protocol, protocol_receipt, _ = _read_json_with_receipt(
        protocol_path,
        label="exploratory overlay protocol",
        maximum_bytes=MAX_PROTOCOL_BYTES,
        error_code="INVALID_PROTOCOL",
    )
    frozen_report, report_receipt, _ = _read_json_with_receipt(
        frozen_report_path,
        label="frozen v2 heldout report",
        maximum_bytes=MAX_FROZEN_REPORT_BYTES,
        error_code="INVALID_FROZEN_REPORT",
    )
    _validate_frozen_report(frozen_report)
    _validate_expected_frozen_report_receipt(report_receipt)
    _validate_protocol(protocol, frozen_report)
    expected_report = protocol["inputs"]["frozenHeldoutReport"]
    actual_report = {
        **report_receipt,
        "schemaVersion": frozen_report["schemaVersion"],
        "payloadSha256": frozen_report["payloadSha256"],
    }
    if actual_report != expected_report:
        fail("FROZEN_REPORT_HASH_MISMATCH", "frozen report differs from protocol")
    if output_directory.name != protocol.get("expectedOutputDirectoryName"):
        fail("OUTPUT_NAME_MISMATCH", "output directory name differs from protocol")
    current_implementation = _implementation_receipts()
    if current_implementation != protocol["implementation"]["sourceFiles"]:
        fail("IMPLEMENTATION_HASH_MISMATCH", "exploratory tool bytes changed")
    if _dependency_versions() != protocol["implementation"]["dependencyVersions"]:
        fail("DEPENDENCY_VERSION_MISMATCH", "exploratory runtime changed")
    source_before = _safe_regular_file(e57_path, "source E57", MAX_E57_BYTES)
    source_sha256 = _sha256_file(e57_path, source_before, MAX_E57_BYTES)
    expected_source = protocol["inputs"]["sourceE57"]
    if (
        source_before.st_size != expected_source.get("sizeBytes")
        or source_sha256 != expected_source.get("sha256")
    ):
        fail("SOURCE_HASH_MISMATCH", "source E57 differs from protocol")
    return (
        protocol,
        frozen_report,
        {
            "protocolReceipt": {
                **protocol_receipt,
                "schemaVersion": protocol["schemaVersion"],
                "payloadSha256": protocol["payloadSha256"],
            },
            "sourceBefore": source_before,
            "sourceSha256": source_sha256,
        },
    )


def _read_organized_xyz(source: Any, scan_id: int) -> Mapping[str, Any]:
    fields = source.read_scan(
        scan_id,
        intensity=False,
        colors=False,
        row_column=True,
        transform=False,
    )
    if not isinstance(fields, Mapping):
        fail("INVALID_SCAN_RESULT", f"scan {scan_id} did not return a field mapping")
    returned = {str(name) for name in fields}
    if returned.intersection(POINT_COLOUR_FIELD_NAMES):
        fail("POINT_COLOUR_BOUNDARY_VIOLATION", f"scan {scan_id} returned colour")
    if returned != set(frozen.POINT_FIELDS_REQUESTED):
        fail("POINT_FIELD_BOUNDARY_VIOLATION", f"scan {scan_id} field set changed")
    return fields


def _image_node_for_selection(
    source: Any, selection: Mapping[str, Any]
) -> Any:
    root = source.image_file.root()
    images2d = root["images2D"]
    index = int(selection["image2DIndex"])
    if index < 0 or index >= images2d.childCount():
        fail("IMAGE_INDEX_MISMATCH", "selected Image2D index is out of range")
    node = images2d[index]
    if (
        str(node["name"].value()) != selection["faceName"]
        or str(node["guid"].value()) != selection["image2DGuid"]
        or str(node["associatedData3DGuid"].value()) != selection["data3DGuid"]
    ):
        fail("IMAGE_IDENTITY_MISMATCH", "selected Image2D identity changed")
    return node


def _read_native_jpeg(
    node: Any, selection: Mapping[str, Any]
) -> tuple[bytes, Image.Image]:
    representation = node["pinholeRepresentation"]
    intrinsic = frozen._intrinsic_record(
        representation,
        f"scan {selection['scanId']} {selection['faceName']}",
    )
    blob = representation["jpegImage"]
    size = int(blob.byteCount())
    expected = selection["jpeg"]
    if size != expected["sizeBytes"] or size <= 0 or size > MAX_IMAGE_BYTES:
        fail("JPEG_SIZE_MISMATCH", "embedded JPEG size differs from protocol")
    payload = bytearray(size)
    blob.read(payload, 0, size)
    jpeg_bytes = bytes(payload)
    if hashlib.sha256(jpeg_bytes).hexdigest() != expected["sha256"]:
        fail("JPEG_HASH_MISMATCH", "embedded JPEG bytes differ from protocol")
    try:
        with Image.open(io.BytesIO(jpeg_bytes)) as opened:
            if opened.format != "JPEG":
                fail("IMAGE_FORMAT_MISMATCH", "embedded image is not JPEG")
            opened.load()
            rgb = opened.convert("RGB")
    except AuditError:
        raise
    except Exception as error:
        fail("IMAGE_DECODE_FAILED", f"could not decode selected JPEG: {error}")
    if rgb.size != (expected["width"], expected["height"]):
        fail("IMAGE_DIMENSION_MISMATCH", "embedded JPEG dimensions changed")
    if rgb.size != (int(intrinsic["width"]), int(intrinsic["height"])):
        fail("IMAGE_DIMENSION_MISMATCH", "JPEG differs from declared E57 intrinsics")
    return jpeg_bytes, rgb


def _primary_projection_and_mask(
    prepared: Mapping[str, Any], selection: Mapping[str, Any]
) -> tuple[dict[str, Any], np.ndarray]:
    candidate_id = str(selection["primaryCandidateId"])
    if candidate_id != geometry.FIXED_V2_MAPPING[selection["faceName"]]:
        fail("PRIMARY_MAPPING_MISMATCH", "selection primary mapping is not frozen v2")
    candidate = geometry.CANDIDATE_BY_ID[candidate_id]
    intrinsics = selection["analysisIntrinsics"]
    projection = geometry.project_geometry_signals_zbuffer(
        np.asarray(prepared["points"]),
        np.asarray(prepared["absoluteLogRangeJump"]),
        np.asarray(prepared["surfaceNormalDiscontinuity"]),
        forward=np.asarray(candidate["forward"]),
        right=np.asarray(candidate["right"]),
        down=np.asarray(candidate["down"]),
        fx=float(intrinsics["fx"]),
        fy=float(intrinsics["fy"]),
        cx=float(intrinsics["cx"]),
        cy=float(intrinsics["cy"]),
        width=int(intrinsics["width"]),
        height=int(intrinsics["height"]),
    )
    mask, _ = geometry.strongest_geometry_edge_mask(
        np.asarray(projection["absoluteLogRangeJumpImage"]),
        np.asarray(projection["surfaceNormalDiscontinuityImage"]),
        np.asarray(projection["occupiedMask"]),
    )
    return dict(projection), mask


def _circle_mask(
    shape: tuple[int, int], *, centre_xy: tuple[int, int], radius: int
) -> np.ndarray:
    if radius <= 0:
        raise ValueError("circle radius must be positive")
    rows, columns = np.ogrid[: shape[0], : shape[1]]
    centre_x, centre_y = centre_xy
    return (columns - centre_x) ** 2 + (rows - centre_y) ** 2 <= radius**2


def residual_metrics(
    geometry_mask: np.ndarray,
    photo_mask: np.ndarray,
    *,
    nadir_region_mask: np.ndarray | None,
) -> tuple[dict[str, Any], np.ndarray, np.ndarray, np.ndarray]:
    geometry_values = np.asarray(geometry_mask, dtype=bool)
    photo_values = np.asarray(photo_mask, dtype=bool)
    if geometry_values.shape != photo_values.shape or geometry_values.ndim != 2:
        raise ValueError("geometry and photo masks must have matching 2D shapes")
    distance_to_photo = (
        ndimage.distance_transform_edt(~photo_values)
        if np.any(photo_values)
        else np.full(photo_values.shape, np.inf, dtype=np.float64)
    )
    matched = geometry_values & (
        distance_to_photo <= geometry.PHOTO_MATCH_RADIUS_PIXELS
    )
    unmatched = geometry_values & ~matched
    distance_to_geometry = (
        ndimage.distance_transform_edt(~geometry_values)
        if np.any(geometry_values)
        else np.full(geometry_values.shape, np.inf, dtype=np.float64)
    )
    photo_only = photo_values & (
        distance_to_geometry > geometry.PHOTO_MATCH_RADIUS_PIXELS
    )
    geometry_count = int(np.count_nonzero(geometry_values))
    matched_count = int(np.count_nonzero(matched))
    unmatched_count = int(np.count_nonzero(unmatched))
    record: dict[str, Any] = {
        "geometryEdgePixelCount": geometry_count,
        "photoEdgePixelCount": int(np.count_nonzero(photo_values)),
        "matchedGeometryEdgePixelCount": matched_count,
        "unmatchedGeometryResidualPixelCount": unmatched_count,
        "matchedFraction": _round(matched_count / geometry_count, 9)
        if geometry_count
        else None,
        "unmatchedResidualFraction": _round(unmatched_count / geometry_count, 9)
        if geometry_count
        else None,
        "photoOnlyEdgePixelCount": int(np.count_nonzero(photo_only)),
        "matchRadiusAnalysisPixels": geometry.PHOTO_MATCH_RADIUS_PIXELS,
    }
    if nadir_region_mask is None:
        record["hypothesizedNativeNadirTripodRegion"] = {
            "applies": False,
            "reason": "selected face is not Skybox 5",
        }
    else:
        region = np.asarray(nadir_region_mask, dtype=bool)
        if region.shape != geometry_values.shape:
            raise ValueError("nadir region mask must match residual masks")
        geometry_inside = int(np.count_nonzero(geometry_values & region))
        matched_inside = int(np.count_nonzero(matched & region))
        unmatched_inside = int(np.count_nonzero(unmatched & region))
        geometry_outside = geometry_count - geometry_inside
        unmatched_outside = unmatched_count - unmatched_inside
        inside_rate = unmatched_inside / geometry_inside if geometry_inside else None
        outside_rate = unmatched_outside / geometry_outside if geometry_outside else None
        record["hypothesizedNativeNadirTripodRegion"] = {
            "applies": True,
            "shape": "circle",
            "analysisCentreXYPixels": list(NADIR_REGION_CENTRE_XY),
            "analysisRadiusPixels": NADIR_REGION_RADIUS_PIXELS,
            "excludedFromAnyMetric": False,
            "regionPixelCount": int(np.count_nonzero(region)),
            "geometryEdgePixelsInside": geometry_inside,
            "matchedGeometryEdgePixelsInside": matched_inside,
            "unmatchedResidualPixelsInside": unmatched_inside,
            "unmatchedResidualPixelsOutside": unmatched_outside,
            "fractionOfAllUnmatchedResidualInside": _round(
                unmatched_inside / unmatched_count, 9
            )
            if unmatched_count
            else None,
            "unmatchedResidualRateInside": _round(inside_rate, 9)
            if inside_rate is not None
            else None,
            "unmatchedResidualRateOutside": _round(outside_rate, 9)
            if outside_rate is not None
            else None,
            "insideMinusOutsideUnmatchedRate": _round(inside_rate - outside_rate, 9)
            if inside_rate is not None and outside_rate is not None
            else None,
            "interpretation": (
                "exploratory overlap with a predeclared central nadir/tripod "
                "hypothesis; this does not identify the object or establish cause"
            ),
        }
    return record, matched, unmatched, photo_only


def _assert_frozen_primary_metrics(
    selection: Mapping[str, Any],
    projection: Mapping[str, Any],
    measured: Mapping[str, Any],
) -> None:
    expected = selection["frozenPrimaryMetrics"]
    exact_pairs = {
        "projectedInputCount": int(projection["projectedInputCount"]),
        "visiblePixelCount": int(projection["visiblePixelCount"]),
        "geometryEdgePixelCount": measured["geometryEdgePixelCount"],
        "photoEdgePixelCount": measured["photoEdgePixelCount"],
        "matchedGeometryEdgePixelCount": measured["matchedGeometryEdgePixelCount"],
    }
    for key, actual in exact_pairs.items():
        if actual != expected[key]:
            fail(
                "FROZEN_PRIMARY_METRIC_MISMATCH",
                f"{selection['scanId']} {selection['faceName']} {key} changed",
            )
    occupied = _round(
        int(projection["visiblePixelCount"]) / (ANALYSIS_SIZE * ANALYSIS_SIZE), 9
    )
    if occupied != expected["occupiedPixelFraction"]:
        fail("FROZEN_PRIMARY_METRIC_MISMATCH", "occupied fraction changed")
    if measured["matchedFraction"] != expected["matchedFraction"]:
        fail("FROZEN_PRIMARY_METRIC_MISMATCH", "matched fraction changed")


def _mask_layer(mask: np.ndarray, size: tuple[int, int], colour: tuple[int, int, int, int]) -> Image.Image:
    alpha = Image.fromarray(np.asarray(mask, dtype=np.uint8) * colour[3], mode="L")
    alpha = alpha.resize(size, Image.Resampling.NEAREST)
    layer = Image.new("RGBA", size, colour[:3] + (0,))
    layer.putalpha(alpha)
    return layer


def render_overlay(
    native_rgb: Image.Image,
    *,
    matched: np.ndarray,
    unmatched: np.ndarray,
    photo_only: np.ndarray,
    face_name: str,
) -> bytes:
    """Render a lossless native-size overlay without changing measured masks."""

    output = native_rgb.convert("RGBA")
    output = Image.alpha_composite(
        output, _mask_layer(photo_only, output.size, (255, 196, 0, 95))
    )
    output = Image.alpha_composite(
        output, _mask_layer(matched, output.size, (0, 235, 130, 190))
    )
    output = Image.alpha_composite(
        output, _mask_layer(unmatched, output.size, (255, 24, 120, 225))
    )
    draw = ImageDraw.Draw(output)
    font = ImageFont.load_default(size=18)
    legend = (
        "EXPLORATORY / CONSUMED EVIDENCE  |  green: matched XYZ edge  |  "
        "magenta: unmatched XYZ residual  |  amber: photo-only edge"
    )
    legend_box = (12, 12, min(output.width - 12, 1190), 54)
    draw.rectangle(legend_box, fill=(0, 0, 0, 190), outline=(255, 255, 255, 220), width=2)
    draw.text((24, 23), legend, fill=(255, 255, 255, 255), font=font)
    if face_name == NADIR_FACE_NAME:
        cx, cy = NATIVE_NADIR_REGION_CENTRE_XY
        radius = NATIVE_NADIR_REGION_RADIUS_PIXELS
        draw.ellipse(
            (cx - radius, cy - radius, cx + radius, cy + radius),
            outline=(255, 255, 255, 235),
            width=7,
        )
        label = "predeclared nadir/tripod hypothesis (not excluded)"
        draw.rectangle(
            (cx - radius, cy - radius - 42, cx + radius, cy - radius),
            fill=(0, 0, 0, 180),
        )
        draw.text(
            (cx - radius + 10, cy - radius - 31),
            label,
            fill=(255, 255, 255, 255),
            font=font,
        )
    payload = io.BytesIO()
    output.convert("RGB").save(payload, format="PNG", compress_level=6)
    return payload.getvalue()


def _artifact_name(selection: Mapping[str, Any], suffix: str) -> str:
    roles = "-".join(selection["exploratoryRoles"])
    face_number = str(selection["faceName"]).split()[-1]
    return f"{roles}__scan-{int(selection['scanId']):03d}__skybox-{face_number}__{suffix}"


def _write_artifact(path: Path, payload: bytes, *, truth_class: str) -> dict[str, Any]:
    write_create_only(path, payload)
    return {
        "fileName": path.name,
        "sizeBytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "truthClass": truth_class,
    }


def render(
    *,
    protocol_path: Path,
    frozen_report_path: Path,
    e57_path: Path,
    output_directory: Path,
) -> dict[str, Any]:
    protocol, frozen_report, verification = _verify_render_inputs(
        protocol_path=protocol_path,
        frozen_report_path=frozen_report_path,
        e57_path=e57_path,
        output_directory=output_directory,
    )
    try:
        import pye57
    except ImportError:
        fail("PYE57_UNAVAILABLE", "pye57 is required for exploratory rendering")
    output_directory.parent.mkdir(parents=True, exist_ok=True)
    try:
        output_directory.mkdir()
    except FileExistsError:
        fail("OUTPUT_EXISTS", "exploratory output directory already exists")

    source = pye57.E57(str(e57_path))
    selections = protocol["selectionPlan"]["uniqueSelectedFaces"]
    selections_by_scan: dict[int, list[dict[str, Any]]] = {}
    for selection in selections:
        selections_by_scan.setdefault(int(selection["scanId"]), []).append(selection)
    region_mask = _circle_mask(
        (ANALYSIS_SIZE, ANALYSIS_SIZE),
        centre_xy=NADIR_REGION_CENTRE_XY,
        radius=NADIR_REGION_RADIUS_PIXELS,
    )
    records: list[dict[str, Any]] = []
    all_artifacts: list[dict[str, Any]] = []
    for scan_id in sorted(selections_by_scan):
        fields = _read_organized_xyz(source, scan_id)
        header = source.get_header(scan_id)
        row_count, column_count, _ = frozen._frozen_organized_grid_shape(
            header, fields, scan_id=scan_id
        )
        prepared = geometry.prepare_geometry_samples(
            fields, row_count=row_count, column_count=column_count
        )
        del fields
        for selection in sorted(
            selections_by_scan[scan_id], key=lambda row: str(row["faceName"])
        ):
            node = _image_node_for_selection(source, selection)
            jpeg_bytes, native_rgb = _read_native_jpeg(node, selection)
            analysis_rgb = np.asarray(
                native_rgb.resize(
                    (ANALYSIS_SIZE, ANALYSIS_SIZE), Image.Resampling.LANCZOS
                ),
                dtype=np.uint8,
            )
            projection, geometry_mask = _primary_projection_and_mask(
                prepared, selection
            )
            photo_magnitude = geometry.gaussian_sobel_photo_edges(analysis_rgb)
            photo_mask = geometry.strongest_photo_edge_mask(photo_magnitude)
            measured, matched, unmatched, photo_only = residual_metrics(
                geometry_mask,
                photo_mask,
                nadir_region_mask=(
                    region_mask if selection["faceName"] == NADIR_FACE_NAME else None
                ),
            )
            _assert_frozen_primary_metrics(selection, projection, measured)
            native_name = _artifact_name(selection, "native.jpg")
            overlay_name = _artifact_name(selection, "overlay.png")
            native_artifact = _write_artifact(
                output_directory / native_name,
                jpeg_bytes,
                truth_class="captured_byte_identical_copy",
            )
            overlay_bytes = render_overlay(
                native_rgb,
                matched=matched,
                unmatched=unmatched,
                photo_only=photo_only,
                face_name=str(selection["faceName"]),
            )
            overlay_artifact = _write_artifact(
                output_directory / overlay_name,
                overlay_bytes,
                truth_class="generated_diagnostic_presentation",
            )
            if native_artifact["sha256"] != selection["jpeg"]["sha256"]:
                fail("CAPTURE_COPY_HASH_MISMATCH", "native JPEG copy is not exact")
            all_artifacts.extend((native_artifact, overlay_artifact))
            records.append(
                {
                    "scanId": scan_id,
                    "faceName": selection["faceName"],
                    "exploratoryRoles": selection["exploratoryRoles"],
                    "pairIds": selection["pairIds"],
                    "frozenStatus": selection["frozenStatus"],
                    "frozenReasons": selection["frozenReasons"],
                    "captured": {
                        "data3DGuid": selection["data3DGuid"],
                        "image2DIndex": selection["image2DIndex"],
                        "image2DGuid": selection["image2DGuid"],
                        "jpeg": selection["jpeg"],
                        "nativeCopy": native_artifact,
                    },
                    "measured": {
                        **measured,
                        "frozenPrimaryMetricsReproducedExactly": True,
                        "pointColourFieldsRequestedOrRead": False,
                    },
                    "generated": {"overlay": overlay_artifact},
                    "continuousCalibrationValidated": False,
                    "metricGeometryValidated": False,
                    "knownPoseMaterializationPermitted": False,
                    "trainingPermitted": False,
                }
            )
            native_rgb.close()
            del analysis_rgb, projection, geometry_mask, photo_magnitude
            del photo_mask, matched, unmatched, photo_only, overlay_bytes
            gc.collect()
        del prepared
        gc.collect()

    record_by_key = {
        (int(row["scanId"]), str(row["faceName"])): row for row in records
    }
    pair_comparisons: list[dict[str, Any]] = []
    for pair in protocol["selectionPlan"]["pairs"]:
        failure = record_by_key[_selection_key(pair["failure"])]
        control = record_by_key[_selection_key(pair["control"])]
        failure_rate = failure["measured"]["unmatchedResidualFraction"]
        control_rate = control["measured"]["unmatchedResidualFraction"]
        pair_comparisons.append(
            {
                "pairId": pair["pairId"],
                "failure": {
                    "scanId": failure["scanId"],
                    "faceName": failure["faceName"],
                    "frozenStatus": failure["frozenStatus"],
                    "unmatchedResidualFraction": failure_rate,
                },
                "control": {
                    "scanId": control["scanId"],
                    "faceName": control["faceName"],
                    "frozenStatus": control["frozenStatus"],
                    "unmatchedResidualFraction": control_rate,
                },
                "failureMinusControlUnmatchedResidualFraction": _round(
                    float(failure_rate) - float(control_rate), 9
                ),
                "decisionRole": "exploratory_comparison_only",
            }
        )

    if (
        len(records) != EXPECTED_UNIQUE_SELECTED_FACE_COUNT
        or len(pair_comparisons) != EXPECTED_PAIR_COUNT
    ):
        fail("INCOMPLETE_OUTPUT", "exploratory render did not produce the exact plan")
    source_after = _safe_regular_file(e57_path, "source E57", MAX_E57_BYTES)
    if not _same_file_identity(verification["sourceBefore"], source_after):
        fail("FILE_CHANGED_DURING_READ", "source E57 changed during render")
    if _implementation_receipts() != protocol["implementation"]["sourceFiles"]:
        fail("IMPLEMENTATION_HASH_MISMATCH", "tool bytes changed during render")
    report = {
        "schemaVersion": REPORT_SCHEMA_VERSION,
        "protocol": verification["protocolReceipt"],
        "scope": {
            "sourceE57": protocol["inputs"]["sourceE57"],
            "frozenHeldoutReport": protocol["inputs"]["frozenHeldoutReport"],
            "consumedPreviouslyHeldOutEvidence": True,
            "freshHeldOutEvidence": False,
            "frozenAuditRerun": False,
            "frozenThresholdsChanged": False,
            "selectedFailureCount": EXPECTED_FAILURE_COUNT,
            "selectedPairCount": EXPECTED_PAIR_COUNT,
            "uniqueSelectedFaceCount": len(records),
        },
        "runtime": {
            "implementationSourcesVerifiedBeforeAndAfter": protocol[
                "implementation"
            ]["sourceFiles"],
            "dependencyVersions": protocol["implementation"]["dependencyVersions"],
        },
        "truthSeparation": {
            "captured": "byte-identical native JPEG copies and E57 identifiers",
            "measured": "fixed-primary XYZ/JPEG edge masks and residual counts",
            "generated": "PNG diagnostic overlays and this report",
            "aiGeneratedPixelsUsed": False,
        },
        "selectionPlan": protocol["selectionPlan"],
        "analysisPlan": protocol["analysisPlan"],
        "records": records,
        "pairComparisons": pair_comparisons,
        "artifacts": sorted(all_artifacts, key=lambda row: row["fileName"]),
        "limitations": [
            "This is post-hoc exploratory use of already-consumed evidence, not held-out validation.",
            "A reproduced fixed-primary mask does not validate the other 47 orientations or change the frozen result.",
            "The central Skybox 5 circle is a predeclared tripod/nadir hypothesis, not a confirmed segmentation or causal explanation.",
            "Both XYZ and JPEG evidence originate in the same E57 container and are not independent ground truth.",
            "The overlay is presentation-only; all quantitative results are computed on the 512 by 512 analysis masks before upsampling.",
        ],
        "continuousCalibrationValidated": False,
        "metricGeometryValidated": False,
        "knownPoseMaterializationPermitted": False,
        "trainingPermitted": False,
        "signingPermitted": False,
        "publicationPermitted": False,
        "authority": "none",
        "selfDigestMeaning": protocol["selfDigestMeaning"],
    }
    finalized = _finalize(report, REPORT_DIGEST_DOMAIN)
    manifest_path = output_directory / "manifest.json"
    write_create_only(manifest_path, _canonical_json_bytes(finalized) + b"\n")
    return finalized


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build exploratory native-JPEG/XYZ residual overlays without changing the frozen v2 audit."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create-protocol")
    create.add_argument("--e57", required=True, type=Path)
    create.add_argument("--frozen-report", required=True, type=Path)
    create.add_argument("--output", required=True, type=Path)
    create.add_argument("--expected-output-directory-name", required=True)
    render_parser = subparsers.add_parser("render")
    render_parser.add_argument("--protocol", required=True, type=Path)
    render_parser.add_argument("--frozen-report", required=True, type=Path)
    render_parser.add_argument("--e57", required=True, type=Path)
    render_parser.add_argument("--output-directory", required=True, type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        if args.command == "create-protocol":
            result = create_protocol(
                e57_path=args.e57,
                frozen_report_path=args.frozen_report,
                output_path=args.output,
                expected_output_directory_name=args.expected_output_directory_name,
            )
        else:
            result = render(
                protocol_path=args.protocol,
                frozen_report_path=args.frozen_report,
                e57_path=args.e57,
                output_directory=args.output_directory,
            )
    except AuditError as error:
        print(f"ERROR [{error.code}] {error.message}", file=sys.stderr)
        return 2
    print(json.dumps({"schemaVersion": result["schemaVersion"], "payloadSha256": result["payloadSha256"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
