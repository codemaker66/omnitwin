#!/usr/bin/env python3
"""Export post-hoc visual diagnostics for the frozen Reception edge result.

This tool does not rerun, reclassify, or aggregate the held-out decision.  It
copies the exact frozen status/reasons and reconstructs only the primary and
decision-relevant challenger masks needed for a human-readable picture.

The pictures are private diagnostic evidence.  They cannot turn a failed
held-out result into a pass, validate continuous or metric calibration, create
known poses, authorize training, or clear privacy and source rights.
"""

from __future__ import annotations

import argparse
import csv
import gc
import hashlib
import hmac
import html
import io
import json
import math
import os
import shutil
import sys
import tempfile
import textwrap
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

import audit_e57_geometry_edge_protocol as edge_protocol
import audit_e57_geometry_edges as geometry
from audit_e57_room_images import (
    AuditError,
    MAX_E57_BYTES,
    _canonical_json_bytes,
    _safe_regular_file,
    _same_file_identity,
    _sha256_file,
    fail,
    write_create_only,
)


MANIFEST_SCHEMA_VERSION = "omnitwin.reception.e57-geometry-edge-diagnostics.v1"
MANIFEST_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_DIAGNOSTICS_V1\0"
PROTOCOL_SCHEMA_VERSION = edge_protocol.PROTOCOL_SCHEMA_VERSION
HELDOUT_REPORT_SCHEMA_VERSION = edge_protocol.REPORT_SCHEMA_VERSION
HELD_OUT_SCAN_IDS = edge_protocol.HELD_OUT_SCAN_IDS
ANALYSIS_SIZE = edge_protocol.ANALYSIS_SIZE
GRID_SIZE = edge_protocol.GEOMETRY_EDGE_SPATIAL_GRID_SIZE
SUPPORTED_CELL_MINIMUM = (
    edge_protocol.MINIMUM_GEOMETRY_EDGE_PIXELS_PER_OCCUPIED_GRID_CELL
)

PINNED_PROTOCOL_FILE_NAME = (
    "reception-room-e57-geometry-edge-protocol-v2-2026-07-14.json"
)
PINNED_PROTOCOL_SIZE_BYTES = 15_758
PINNED_PROTOCOL_SHA256 = (
    "7212244f38a4678cd3e3b60a491c6b2154390d253d9eaa22e0255e16e8cd78d9"
)
PINNED_PROTOCOL_PAYLOAD_SHA256 = (
    "05802cd31a964ae64a9f05949f040291cc3bc06a4765d3e4e9150866bcd9ead4"
)
PINNED_HELDOUT_REPORT_FILE_NAME = (
    "reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json"
)
PINNED_HELDOUT_REPORT_SIZE_BYTES = 19_800_301
PINNED_HELDOUT_REPORT_SHA256 = (
    "ed744eba259c5a40c886af65d8fccf54c36a60ee2e5890449dee0c23f50794a0"
)
PINNED_HELDOUT_REPORT_PAYLOAD_SHA256 = (
    "5bdfcb380692dfa6bb61c62880303cd46a13455737653667dfcba139213bf906"
)
MAX_HELDOUT_REPORT_BYTES = 64 * 1024 * 1024
MAX_PROTOCOL_BYTES = edge_protocol.MAX_PROTOCOL_BYTES
MAX_TOOL_SOURCE_BYTES = edge_protocol.MAX_TOOL_SOURCE_BYTES

FORBIDDEN_DECISION_FUNCTION_NAMES = (
    "run_audit",
    "_process_scan_set",
    "score_photo_against_candidate_masks",
    "classify_image_evidence",
    "rasterize_48_candidate_geometry_masks",
    "_score_mask_with_distance",
    "empirical_spatial_null_stress_test",
    "_geometry_edge_grid_support_record",
    "edge_alignment_metrics",
    "compare_cube_candidates",
    "cube_orientation_candidates",
)

EXPECTED_FROZEN_PAIR_MAP = [
    (123, "Skybox 3", 128),
    (127, "Skybox 5", 125),
    (128, "Skybox 5", 125),
    (131, "Skybox 5", 137),
    (132, "Skybox 5", 137),
    (136, "Skybox 1", 132),
    (136, "Skybox 2", 138),
    (137, "Skybox 1", 132),
    (137, "Skybox 2", 138),
    (138, "Skybox 5", 129),
    (139, "Skybox 4", 129),
    (141, "Skybox 5", 137),
    (142, "Skybox 4", 123),
    (142, "Skybox 5", 129),
]
EXPECTED_SELECTED_SCAN_IDS = [
    123,
    125,
    127,
    128,
    129,
    131,
    132,
    136,
    137,
    138,
    139,
    141,
    142,
]
EXPECTED_CANDIDATE_RASTERIZATIONS_BY_SCAN = {
    123: 4,
    125: 2,
    127: 2,
    128: 4,
    129: 4,
    131: 2,
    132: 4,
    136: 4,
    137: 6,
    138: 4,
    139: 2,
    141: 2,
    142: 4,
}
EXPECTED_CANDIDATE_RASTERIZATION_COUNT = 44

PHOTO_EDGE_COLOUR = np.array([0, 210, 255], dtype=np.uint8)
MATCHED_GEOMETRY_COLOUR = np.array([110, 255, 90], dtype=np.uint8)
UNMATCHED_GEOMETRY_COLOUR = np.array([255, 50, 150], dtype=np.uint8)
GRID_COLOUR = np.array([165, 170, 180], dtype=np.uint8)
QUADRANT_COLOUR = np.array([255, 215, 80], dtype=np.uint8)
MISSING_QUADRANT_COLOUR = (255, 70, 70)

PANEL_SIZE = ANALYSIS_SIZE
PANEL_COUNT = 6
PANEL_LABEL_HEIGHT = 34
PANEL_GAP = 10
SHEET_MARGIN = 18
SHEET_HEADER_HEIGHT = 118
ROW_HEADER_HEIGHT = 92
ROW_GAP = 12
SHEET_FOOTER_HEIGHT = 116
PAIR_SHEET_WIDTH = (
    2 * SHEET_MARGIN
    + PANEL_COUNT * PANEL_SIZE
    + (PANEL_COUNT - 1) * PANEL_GAP
)
PAIR_SHEET_HEIGHT = (
    SHEET_HEADER_HEIGHT
    + 2 * (ROW_HEADER_HEIGHT + PANEL_LABEL_HEIGHT + PANEL_SIZE)
    + ROW_GAP
    + SHEET_FOOTER_HEIGHT
)
PAIR_SHEET_SIZE = (PAIR_SHEET_WIDTH, PAIR_SHEET_HEIGHT)

PRIVATE_WARNING = (
    "These pictures help a human see where the frozen masks agree or disagree. "
    "They do not repeat the 48-way held-out decision and cannot turn a failure "
    "into a pass."
)
PRIVACY_WARNING = (
    "Images may contain people or private details. No native-image privacy "
    "clearance or masking was performed. Keep this bundle local and do not "
    "publish it."
)
CONTROL_WARNING = (
    "Controls share the same capture and source. They are mechanically selected "
    "comparison exemplars, not randomized or independent statistical controls."
)


@dataclass(frozen=True)
class ImageVisual:
    row: Mapping[str, Any]
    photo: np.ndarray
    photo_edge_mask: np.ndarray
    primary_geometry_mask: np.ndarray
    alternative_geometry_mask: np.ndarray
    shifted_primary_geometry_mask: np.ndarray | None = None
    shifted_alternative_geometry_mask: np.ndarray | None = None
    challenger_candidate_id: str | None = None
    challenger_is_shifted: bool = False
    primary_shift_dx_dy: tuple[int, int] = (0, 0)
    alternative_shift_dx_dy: tuple[int, int] = (0, 0)


@dataclass(frozen=True)
class VerifiedInputs:
    protocol: Mapping[str, Any]
    protocol_receipt: Mapping[str, Any]
    protocol_stat: os.stat_result
    report: Mapping[str, Any]
    report_receipt: Mapping[str, Any]
    report_stat: os.stat_result
    e57_stat: os.stat_result
    source_sha256: str
    implementation_captures: Sequence[Mapping[str, Any]]
    exporter_sources: Sequence[Mapping[str, Any]]
    exporter_captures: Sequence[Mapping[str, Any]]


def _round(value: float, digits: int = 9) -> float:
    result = round(float(value), digits)
    return 0.0 if result == 0.0 else result


def finalize_manifest(payload: Mapping[str, Any]) -> dict[str, Any]:
    without_digest = dict(payload)
    without_digest.pop("payloadSha256", None)
    digest = hashlib.sha256(
        MANIFEST_DIGEST_DOMAIN + _canonical_json_bytes(without_digest)
    ).hexdigest()
    return {**without_digest, "payloadSha256": digest}


def verify_manifest_digest(payload: Mapping[str, Any]) -> bool:
    expected = payload.get("payloadSha256")
    if not isinstance(expected, str) or len(expected) != 64:
        return False
    actual = finalize_manifest(payload)["payloadSha256"]
    return hmac.compare_digest(expected.lower(), actual)


def manifest_bytes(payload: Mapping[str, Any]) -> bytes:
    return _canonical_json_bytes(payload) + b"\n"


def require_new_output_directory(output_dir: Path) -> None:
    if output_dir.exists() or output_dir.is_symlink():
        raise ValueError("output directory already exists; diagnostics are create-only")
    if output_dir.name in ("", ".", ".."):
        raise ValueError("output directory must have a non-empty leaf name")


def _primary_geometry_count(row: Mapping[str, Any]) -> int:
    primary = row.get("primaryEvaluation")
    if not isinstance(primary, Mapping):
        raise ValueError("image row has no primary evaluation")
    value = primary.get("geometryEdgePixelCount")
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError("image row has an invalid geometry edge count")
    return value


def _photo_edge_count(row: Mapping[str, Any]) -> int:
    value = row.get("photoEdgePixelCount")
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError("image row has an invalid photo edge count")
    return value


def relative_count_distance(
    case: Mapping[str, Any],
    control: Mapping[str, Any],
) -> float:
    case_geometry = _primary_geometry_count(case)
    case_photo = _photo_edge_count(case)
    geometry_delta = abs(_primary_geometry_count(control) - case_geometry)
    photo_delta = abs(_photo_edge_count(control) - case_photo)
    return geometry_delta / case_geometry + photo_delta / case_photo


def _pair_sort_key(
    case: Mapping[str, Any],
    control: Mapping[str, Any],
) -> tuple[float, int, int, int, int]:
    geometry_delta = abs(_primary_geometry_count(control) - _primary_geometry_count(case))
    photo_delta = abs(_photo_edge_count(control) - _photo_edge_count(case))
    return (
        relative_count_distance(case, control),
        geometry_delta,
        photo_delta,
        int(control["scanId"]),
        int(control["image2DIndex"]),
    )


def _pair_record(
    case: Mapping[str, Any],
    control: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "caseScanId": int(case["scanId"]),
        "caseImage2DIndex": int(case["image2DIndex"]),
        "caseImage2DGuid": str(case["image2DGuid"]),
        "faceName": str(case["name"]),
        "frozenStatus": str(case["status"]),
        "frozenReasons": [str(reason) for reason in case["reasons"]],
        "controlScanId": int(control["scanId"]),
        "controlImage2DIndex": int(control["image2DIndex"]),
        "controlImage2DGuid": str(control["image2DGuid"]),
        "controlFrozenStatus": str(control["status"]),
        "relativeCountDistance": _round(relative_count_distance(case, control), 12),
        "geometryEdgeCountDelta": (
            _primary_geometry_count(control) - _primary_geometry_count(case)
        ),
        "photoEdgeCountDelta": _photo_edge_count(control) - _photo_edge_count(case),
        "controlReuseAllowed": True,
    }


def select_diagnostic_pairs(images: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    pass_status = edge_protocol.PASS_DISCRETE_GEOMETRY_ORIENTATION
    cases = sorted(
        (row for row in images if row.get("status") != pass_status),
        key=lambda row: (int(row["scanId"]), str(row["name"])),
    )
    controls = [row for row in images if row.get("status") == pass_status]
    pairs: list[dict[str, Any]] = []
    for case in cases:
        same_face = [row for row in controls if row.get("name") == case.get("name")]
        if not same_face:
            raise ValueError(
                f"case {case.get('scanId')}/{case.get('name')} has no same-face PASS control"
            )
        control = min(same_face, key=lambda row: _pair_sort_key(case, row))
        pairs.append(_pair_record(case, control))
    reuse_counts: dict[tuple[int, str], int] = {}
    for pair in pairs:
        key = (int(pair["controlScanId"]), str(pair["faceName"]))
        reuse_counts[key] = reuse_counts.get(key, 0) + 1
    for pair in pairs:
        key = (int(pair["controlScanId"]), str(pair["faceName"]))
        pair["controlReuseCount"] = reuse_counts[key]
    return pairs


def output_file_name(
    index: int,
    case: Mapping[str, Any],
    control: Mapping[str, Any],
) -> str:
    face = int(str(case["name"]).split()[-1])
    return (
        f"case-{index:02d}-scan-{int(case['scanId']):03d}-skybox-{face}"
        f"-vs-pass-scan-{int(control['scanId']):03d}.png"
    )


def geometry_grid_counts(mask: np.ndarray) -> list[int]:
    return edge_protocol._geometry_edge_grid_cell_pixel_counts(
        np.asarray(mask, dtype=bool),
        grid_size=GRID_SIZE,
    )


def _distance_to_photo_edges(photo_mask: np.ndarray) -> np.ndarray:
    if np.count_nonzero(photo_mask):
        return ndimage.distance_transform_edt(~np.asarray(photo_mask, dtype=bool))
    return np.full(photo_mask.shape, np.inf, dtype=np.float64)


def verify_selected_mask_receipt(
    stored: Mapping[str, Any],
    geometry_mask: np.ndarray,
    photo_mask: np.ndarray,
) -> None:
    candidate = np.asarray(geometry_mask)
    photo = np.asarray(photo_mask)
    if candidate.dtype != np.bool_ or photo.dtype != np.bool_:
        raise ValueError("selected and photo masks must be Boolean")
    if candidate.ndim != 2 or photo.ndim != 2 or candidate.shape != photo.shape:
        raise ValueError("selected mask and photo mask must have matching dimensions")
    geometry_count = int(np.count_nonzero(candidate))
    photo_count = int(np.count_nonzero(photo))
    if stored.get("matchRadiusPixels") != geometry.PHOTO_MATCH_RADIUS_PIXELS:
        raise ValueError("selected mask match radius differs from the frozen protocol")
    if stored.get("geometryEdgePixelCount") != geometry_count:
        raise ValueError("selected mask geometry count differs from frozen report")
    if stored.get("photoEdgePixelCount") != photo_count:
        raise ValueError("selected mask photo edge count differs from frozen report")
    if stored.get("geometryEdgeDensity") != _round(geometry_count / candidate.size, 9):
        raise ValueError("selected mask geometry density differs from frozen report")
    if stored.get("photoEdgeDensity") != _round(photo_count / photo.size, 9):
        raise ValueError("selected mask photo density differs from frozen report")
    grid_counts = geometry_grid_counts(candidate)
    if stored.get("geometryEdgeGridCellPixelCounts") != grid_counts:
        raise ValueError("selected mask grid counts differ from frozen report")
    support = edge_protocol._geometry_edge_grid_support_record_from_counts(grid_counts)
    for key, value in support.items():
        if stored.get(key) != value:
            raise ValueError(f"selected mask distributed support differs at {key}")
    distance = _distance_to_photo_edges(photo)
    matched_count = int(
        np.count_nonzero(
            candidate & (distance <= geometry.PHOTO_MATCH_RADIUS_PIXELS)
        )
    )
    if stored.get("matchedGeometryEdgePixelCount") != matched_count:
        raise ValueError("selected mask matched geometry count differs from frozen report")
    fraction = _round(matched_count / geometry_count, 9) if geometry_count else None
    if stored.get("matchedFraction") != fraction:
        raise ValueError("selected mask matched fraction differs from frozen report")


def _authorization_flags_are_false(record: Mapping[str, Any]) -> bool:
    return all(
        record.get(field) is False
        for field in (
            "continuousCalibrationValidated",
            "metricGeometryValidated",
            "knownPoseMaterializationPermitted",
            "trainingPermitted",
        )
    )


def validate_heldout_report(
    report: Mapping[str, Any],
    protocol: Mapping[str, Any],
    protocol_receipt: Mapping[str, Any],
) -> None:
    if report.get("schemaVersion") != HELDOUT_REPORT_SCHEMA_VERSION:
        raise ValueError("held-out report schema is unsupported")
    if report.get("protocol") != protocol_receipt:
        raise ValueError("held-out report does not bind the supplied protocol")
    if report.get("authority") != "none":
        raise ValueError("held-out report authority is not none")
    result = report.get("result")
    if not isinstance(result, Mapping) or result.get("status") == edge_protocol.PASS:
        raise ValueError("diagnostic exporter requires the frozen negative held-out result")
    if result.get("everyHeldOutFacePasses") is not False:
        raise ValueError("held-out report does not record the frozen failure")
    if not _authorization_flags_are_false(result):
        raise ValueError("held-out result authorization flags are not all false")
    images = report.get("images")
    scans = report.get("scans")
    if not isinstance(images, list) or not isinstance(scans, list):
        raise ValueError("held-out report rows are missing")
    edge_protocol._validate_heldout_result_rows(scans, images)
    if any(not _authorization_flags_are_false(row) for row in images):
        raise ValueError("held-out image authorization flags are not all false")
    if any(not _authorization_flags_are_false(row) for row in scans):
        raise ValueError("held-out scan authorization flags are not all false")
    if any(
        row.get("pointColourFieldsRequestedOrRead") is not False
        or row.get("majorityVoteUsed") is not False
        for row in scans
    ):
        raise ValueError("held-out scan rows violate the no-colour/no-vote boundary")
    scope = report.get("scope")
    if not isinstance(scope, Mapping):
        raise ValueError("held-out scope is missing")
    if scope.get("heldOutScanIdsRead") != list(HELD_OUT_SCAN_IDS):
        raise ValueError("held-out report scan IDs differ from the frozen split")
    if protocol.get("scope", {}).get("heldOutScanIds") != list(HELD_OUT_SCAN_IDS):
        raise ValueError("protocol held-out scan IDs differ from the frozen split")
    boundary = report.get("pointDataBoundary")
    expected_arguments = {
        "intensity": False,
        "colors": False,
        "row_column": True,
        "transform": False,
    }
    if not isinstance(boundary, Mapping):
        raise ValueError("held-out point-data boundary is missing")
    if (
        boundary.get("pointColourFieldsRequestedOrRead") is not False
        or boundary.get("readScanArguments") != expected_arguments
    ):
        raise ValueError("held-out report does not preserve the no-colour boundary")


def _read_bound_json(
    path: Path,
    *,
    label: str,
    maximum_bytes: int,
) -> tuple[dict[str, Any], dict[str, Any], os.stat_result]:
    payload, receipt, before = edge_protocol._read_json_with_receipt(
        path,
        label=label,
        maximum_bytes=maximum_bytes,
        invalid_code="INVALID_DIAGNOSTIC_INPUT",
    )
    return payload, receipt, before


def _verify_pinned_receipt(
    receipt: Mapping[str, Any],
    payload: Mapping[str, Any],
    *,
    expected_name: str,
    expected_size: int,
    expected_sha256: str,
    expected_payload_sha256: str,
    label: str,
) -> None:
    expected = {
        "fileName": expected_name,
        "sizeBytes": expected_size,
        "sha256": expected_sha256,
    }
    if dict(receipt) != expected:
        fail("PINNED_INPUT_MISMATCH", f"{label} bytes differ from the pinned result")
    if payload.get("payloadSha256") != expected_payload_sha256:
        fail("PINNED_INPUT_MISMATCH", f"{label} payload digest differs")


def _protocol_receipt(
    receipt: Mapping[str, Any],
    protocol: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        **receipt,
        "schemaVersion": protocol.get("schemaVersion"),
        "payloadSha256": protocol.get("payloadSha256"),
    }


def _capture_exporter_sources() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    test_path = Path(__file__).resolve().parent / "tests" / (
        "test_export_e57_geometry_edge_diagnostics.py"
    )
    specifications = (
        ("diagnosticOverlayExporter", Path(__file__).resolve()),
        ("diagnosticOverlayExporterTests", test_path),
    )
    public: list[dict[str, Any]] = []
    private: list[dict[str, Any]] = []
    for role, path in specifications:
        stat = _safe_regular_file(path, role, MAX_TOOL_SOURCE_BYTES)
        source_sha256 = _sha256_file(path, stat, MAX_TOOL_SOURCE_BYTES)
        public.append(
            {
                "fileName": path.name,
                "role": role,
                "sizeBytes": stat.st_size,
                "sha256": source_sha256,
            }
        )
        private.append(
            {
                "path": path,
                "stat": stat,
                "role": role,
                "sha256": source_sha256,
            }
        )
    return public, private


def load_verified_inputs(
    *,
    protocol_path: Path,
    heldout_report_path: Path,
    e57_path: Path,
    output_dir: Path,
) -> VerifiedInputs:
    require_new_output_directory(output_dir)
    protocol, protocol_receipt, protocol_stat = _read_bound_json(
        protocol_path,
        label="frozen geometry-edge protocol",
        maximum_bytes=MAX_PROTOCOL_BYTES,
    )
    _verify_pinned_receipt(
        protocol_receipt,
        protocol,
        expected_name=PINNED_PROTOCOL_FILE_NAME,
        expected_size=PINNED_PROTOCOL_SIZE_BYTES,
        expected_sha256=PINNED_PROTOCOL_SHA256,
        expected_payload_sha256=PINNED_PROTOCOL_PAYLOAD_SHA256,
        label="protocol",
    )
    edge_protocol._validate_protocol_shape(protocol)
    report, report_receipt, report_stat = _read_bound_json(
        heldout_report_path,
        label="frozen held-out geometry-edge report",
        maximum_bytes=MAX_HELDOUT_REPORT_BYTES,
    )
    _verify_pinned_receipt(
        report_receipt,
        report,
        expected_name=PINNED_HELDOUT_REPORT_FILE_NAME,
        expected_size=PINNED_HELDOUT_REPORT_SIZE_BYTES,
        expected_sha256=PINNED_HELDOUT_REPORT_SHA256,
        expected_payload_sha256=PINNED_HELDOUT_REPORT_PAYLOAD_SHA256,
        label="held-out report",
    )
    edge_protocol._verify_payload_digest(
        report,
        edge_protocol.REPORT_DIGEST_DOMAIN,
        label="held-out geometry-edge report",
        code="INVALID_HELDOUT_REPORT_DIGEST",
    )
    receipt = _protocol_receipt(protocol_receipt, protocol)
    validate_heldout_report(report, protocol, receipt)
    current_sources, implementation_captures = (
        edge_protocol._capture_implementation_sources()
    )
    if current_sources != protocol["implementation"]["sourceFiles"]:
        fail("IMPLEMENTATION_HASH_MISMATCH", "frozen geometry implementation changed")
    if edge_protocol._dependency_versions() != protocol["implementation"]["dependencyVersions"]:
        fail("DEPENDENCY_VERSION_MISMATCH", "frozen geometry dependencies changed")
    exporter_sources, exporter_captures = _capture_exporter_sources()
    e57_stat = _safe_regular_file(e57_path, "source E57", MAX_E57_BYTES)
    source_sha256 = _sha256_file(e57_path, e57_stat, MAX_E57_BYTES)
    expected_source = protocol["scope"]["sourceE57"]
    if expected_source != {
        "fileName": e57_path.name,
        "sizeBytes": e57_stat.st_size,
        "sha256": source_sha256,
    }:
        fail("SOURCE_HASH_MISMATCH", "source E57 differs from the frozen protocol")
    pairs = select_diagnostic_pairs(report["images"])
    actual_pair_map = [
        (pair["caseScanId"], pair["faceName"], pair["controlScanId"])
        for pair in pairs
    ]
    if actual_pair_map != EXPECTED_FROZEN_PAIR_MAP:
        fail("PAIR_MAP_MISMATCH", "mechanical control pairing changed")
    return VerifiedInputs(
        protocol=protocol,
        protocol_receipt=receipt,
        protocol_stat=protocol_stat,
        report=report,
        report_receipt={
            **report_receipt,
            "schemaVersion": report.get("schemaVersion"),
            "payloadSha256": report.get("payloadSha256"),
        },
        report_stat=report_stat,
        e57_stat=e57_stat,
        source_sha256=source_sha256,
        implementation_captures=implementation_captures,
        exporter_sources=exporter_sources,
        exporter_captures=exporter_captures,
    )


def _font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    del bold
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _rgb_photo(photo: np.ndarray) -> np.ndarray:
    values = np.asarray(photo)
    if values.ndim != 3 or values.shape[2] != 3:
        raise ValueError("photo must be an RGB image")
    if values.dtype != np.uint8:
        raise ValueError("photo must use exact 8-bit RGB pixels")
    return values.copy()


def _matching_masks(
    photo: np.ndarray,
    photo_edge_mask: np.ndarray,
    geometry_edge_mask: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    image = _rgb_photo(photo)
    photo_mask = np.asarray(photo_edge_mask)
    geometry_mask = np.asarray(geometry_edge_mask)
    if photo_mask.dtype != np.bool_ or geometry_mask.dtype != np.bool_:
        raise ValueError("photo and geometry edge masks must be Boolean")
    if (
        photo_mask.ndim != 2
        or geometry_mask.ndim != 2
        or photo_mask.shape != image.shape[:2]
        or geometry_mask.shape != image.shape[:2]
    ):
        raise ValueError("photo and edge masks must have matching dimensions")
    distance = _distance_to_photo_edges(photo_mask)
    matched = geometry_mask & (distance <= geometry.PHOTO_MATCH_RADIUS_PIXELS)
    return image, matched, geometry_mask & ~matched


def _display_dilation(mask: np.ndarray) -> np.ndarray:
    return ndimage.binary_dilation(np.asarray(mask, dtype=bool), iterations=1)


def _draw_reference_grid(array: np.ndarray) -> None:
    height, width = array.shape[:2]
    for index in range(1, GRID_SIZE):
        x = round(index * width / GRID_SIZE)
        y = round(index * height / GRID_SIZE)
        colour = QUADRANT_COLOUR if index == GRID_SIZE // 2 else GRID_COLOUR
        thickness = 2 if index == GRID_SIZE // 2 else 1
        array[:, max(0, x - thickness // 2) : min(width, x + 1), :] = colour
        array[max(0, y - thickness // 2) : min(height, y + 1), :, :] = colour
    border = geometry.EDGE_BORDER_PIXELS
    if border > 0 and border * 2 < min(height, width):
        array[:border, :, :] = GRID_COLOUR
        array[-border:, :, :] = GRID_COLOUR
        array[:, :border, :] = GRID_COLOUR
        array[:, -border:, :] = GRID_COLOUR


def compose_edge_overlay(
    photo: np.ndarray,
    photo_edge_mask: np.ndarray,
    geometry_edge_mask: np.ndarray,
    *,
    dilate_for_display: bool = True,
    draw_grid: bool = True,
) -> np.ndarray:
    """Overlay the selected photo/geometry edges without changing the score."""

    image, matched, unmatched = _matching_masks(
        photo,
        photo_edge_mask,
        geometry_edge_mask,
    )
    photo_mask = np.asarray(photo_edge_mask, dtype=bool)
    output = np.clip(image.astype(np.float32) * 0.48, 0, 255).astype(np.uint8)
    if dilate_for_display:
        photo_mask = _display_dilation(photo_mask)
        matched = _display_dilation(matched)
        unmatched = _display_dilation(unmatched)
    if draw_grid:
        _draw_reference_grid(output)
    output[photo_mask] = PHOTO_EDGE_COLOUR
    output[unmatched] = UNMATCHED_GEOMETRY_COLOUR
    output[matched] = MATCHED_GEOMETRY_COLOUR
    # Display dilation must never change the exact semantic core of an edge.
    exact_photo = np.asarray(photo_edge_mask, dtype=bool)
    _, exact_matched, exact_unmatched = _matching_masks(
        photo,
        photo_edge_mask,
        geometry_edge_mask,
    )
    output[exact_photo] = PHOTO_EDGE_COLOUR
    output[exact_unmatched] = UNMATCHED_GEOMETRY_COLOUR
    output[exact_matched] = MATCHED_GEOMETRY_COLOUR
    return output


def _photo_edge_panel(photo: np.ndarray, photo_edge_mask: np.ndarray) -> np.ndarray:
    image = _rgb_photo(photo)
    mask = np.asarray(photo_edge_mask)
    if mask.dtype != np.bool_:
        raise ValueError("photo edge mask must be Boolean")
    if mask.shape != image.shape[:2]:
        raise ValueError("photo and edge masks must have matching dimensions")
    output = np.clip(image.astype(np.float32) * 0.22, 0, 255).astype(np.uint8)
    _draw_reference_grid(output)
    output[_display_dilation(mask)] = PHOTO_EDGE_COLOUR
    output[mask] = PHOTO_EDGE_COLOUR
    return output


def _coverage_panel(visual: ImageVisual) -> np.ndarray:
    base = compose_edge_overlay(
        visual.photo,
        visual.photo_edge_mask,
        visual.primary_geometry_mask,
        dilate_for_display=True,
        draw_grid=True,
    )
    coverage = visual.row.get("primaryGeometryEdgeCoverage")
    if not isinstance(coverage, Mapping):
        coverage = visual.row.get("primaryEvaluation", {})
    represented = {
        str(value) for value in coverage.get("supportedGeometryEdgeGridQuadrants", [])
    }
    quadrants = {
        "TOP_LEFT": (0, 0, PANEL_SIZE // 2, PANEL_SIZE // 2),
        "TOP_RIGHT": (PANEL_SIZE // 2, 0, PANEL_SIZE, PANEL_SIZE // 2),
        "BOTTOM_LEFT": (0, PANEL_SIZE // 2, PANEL_SIZE // 2, PANEL_SIZE),
        "BOTTOM_RIGHT": (
            PANEL_SIZE // 2,
            PANEL_SIZE // 2,
            PANEL_SIZE,
            PANEL_SIZE,
        ),
    }
    opened = Image.fromarray(base, mode="RGB").convert("RGBA")
    tint = Image.new("RGBA", opened.size, (0, 0, 0, 0))
    tint_draw = ImageDraw.Draw(tint)
    for name, bounds in quadrants.items():
        if name not in represented:
            tint_draw.rectangle(bounds, fill=(*MISSING_QUADRANT_COLOUR, 54))
            tint_draw.text(
                (bounds[0] + 10, bounds[1] + 10),
                f"NO CELL REACHED\nSUPPORT MINIMUM\n{name.replace('_', ' ')}",
                fill=(*MISSING_QUADRANT_COLOUR, 255),
                font=_font(15, bold=True),
                spacing=2,
            )
    opened = Image.alpha_composite(opened, tint).convert("RGB")
    draw = ImageDraw.Draw(opened)
    counts = coverage.get("geometryEdgeGridCellPixelCounts")
    if not isinstance(counts, list) or len(counts) != GRID_SIZE * GRID_SIZE:
        counts = geometry_grid_counts(visual.primary_geometry_mask)
    cell_width = PANEL_SIZE / GRID_SIZE
    cell_height = PANEL_SIZE / GRID_SIZE
    font = _font(12, bold=True)
    for row_index in range(GRID_SIZE):
        for column_index in range(GRID_SIZE):
            value = int(counts[row_index * GRID_SIZE + column_index])
            x = int(column_index * cell_width) + 4
            y = int(row_index * cell_height) + int(cell_height) - 17
            colour = (250, 250, 250) if value >= SUPPORTED_CELL_MINIMUM else (255, 130, 130)
            draw.text((x, y), str(value), fill=colour, font=font)
    return np.asarray(opened, dtype=np.uint8)


def _shifted_comparison_panel(visual: ImageVisual) -> np.ndarray:
    primary = (
        visual.shifted_primary_geometry_mask
        if visual.shifted_primary_geometry_mask is not None
        else visual.primary_geometry_mask
    )
    output = compose_edge_overlay(
        visual.photo,
        visual.photo_edge_mask,
        primary,
        dilate_for_display=True,
        draw_grid=True,
    )
    opened = Image.fromarray(output, mode="RGB")
    draw = ImageDraw.Draw(opened)
    banner_font = _font(16, bold=True)
    draw.rectangle((0, 0, PANEL_SIZE, 30), fill=(15, 18, 24))
    pdx, pdy = visual.primary_shift_dx_dy
    draw.text(
        (8, 5),
        f"PRIMARY COMMON SUPPORT · dx={pdx:+d}, dy={pdy:+d}",
        fill="white",
        font=banner_font,
    )
    return np.asarray(opened, dtype=np.uint8)


def _short_candidate(candidate_id: str | None) -> str:
    if not candidate_id:
        return "not recorded"
    return (
        candidate_id.replace("forward_", "F ")
        .replace("_right_", " / R ")
        .replace("_proper", " proper")
        .replace("_mirrored", " mirror")
    )


def _format_number(value: Any, digits: int = 3) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{float(value):.{digits}f}"
    return "n/a"


def _plain_status(status: str) -> str:
    return {
        edge_protocol.PASS_DISCRETE_GEOMETRY_ORIENTATION: "PASSED",
        edge_protocol.REJECT_GEOMETRY_MISMATCH: (
            "FAILED — another cube orientation matched better"
        ),
        edge_protocol.BLOCKED_AMBIGUOUS: "UNDECIDED — the result was too close",
        edge_protocol.BLOCKED_INSUFFICIENT_GEOMETRY: (
            "BLOCKED — one picture quarter lacked enough supported scan-edge cells"
        ),
    }.get(status, status.replace("_", " ").lower())


def _plain_reason(reason: str) -> str:
    return {
        "fixed_v2_primary_is_not_rank_one": (
            "a different cube orientation matched the photograph better"
        ),
        "margin_over_best_alternative_below_threshold": (
            "the expected orientation did not beat the runner-up clearly enough"
        ),
        "shifted_margin_over_best_alternative_below_threshold": (
            "after a tiny ±4-pixel nudge, the choices were still too close"
        ),
        "geometry_edge_support_does_not_cover_all_quadrants": (
            "one picture quarter had no 8×8 cell with enough laser-scan edge pixels"
        ),
    }.get(reason, reason.replace("_", " "))


def _visual_summary(visual: ImageVisual, *, role: str) -> tuple[str, str]:
    row = visual.row
    primary = row.get("primaryEvaluation", {})
    coverage = row.get("primaryGeometryEdgeCoverage", primary)
    shifted = row.get("shiftedCandidateDiagnostic", {})
    phase = row.get("spatialNullStressTest", {})
    status = str(row.get("status", "UNKNOWN"))
    reasons = "; ".join(
        _plain_reason(str(reason)) for reason in row.get("reasons", [])
    ) or "none"
    first = (
        f"{role} — scan {int(row['scanId'])}, {row['name']} — "
        f"FROZEN RESULT: {_plain_status(status)} — why: {reasons}"
    )
    second = (
        f"expected-edge match {_format_number(primary.get('matchedFraction'))} | expected orientation rank "
        f"{row.get('primaryRankAmong48', 'n/a')}/48 | original lead over runner-up "
        f"{_format_number(row.get('marginOverBestAlternative'))} | after-nudge rank "
        f"{shifted.get('primaryRankAmong48AfterEachCandidateBestLocalShift', 'n/a')}/48 | after-nudge lead "
        f"{_format_number(shifted.get('primaryMarginOverBestShiftedAlternative'))} | "
        f"coverage {coverage.get('supportedGeometryEdgeGridCellCount', 'n/a')} cells, "
        f"{coverage.get('supportedGeometryEdgeGridRowCount', 'n/a')} rows, "
        f"{coverage.get('supportedGeometryEdgeGridColumnCount', 'n/a')} columns, "
        f"{coverage.get('representedGeometryEdgeGridQuadrantCount', 'n/a')}/4 quadrants | "
        f"exact-phase {phase.get('status', 'n/a')} (non-gating)"
    )
    return first, second


def _panel_title_lines(visual: ImageVisual) -> list[str]:
    pdx, pdy = visual.primary_shift_dx_dy
    adx, ady = visual.alternative_shift_dx_dy
    challenger_note = (
        f"shifted common support ({adx:+d},{ady:+d})"
        if visual.challenger_is_shifted
        else "unshifted diagnostic"
    )
    return [
        "1  SOURCE PHOTO · 512 px",
        "2  PHOTO EDGES · cyan",
        "3  FIXED PRIMARY · green match / magenta miss",
        f"4  CHALLENGER ({challenger_note}) · {_short_candidate(visual.challenger_candidate_id)}",
        f"5  PRIMARY BEST ±4 px COMMON SUPPORT · ({pdx:+d},{pdy:+d})",
        "6  PRIMARY SUPPORT · 8×8 cells / quadrants",
    ]


def _row_panels(visual: ImageVisual) -> list[np.ndarray]:
    displayed_challenger = (
        visual.shifted_alternative_geometry_mask
        if visual.challenger_is_shifted
        and visual.shifted_alternative_geometry_mask is not None
        else visual.alternative_geometry_mask
    )
    return [
        _rgb_photo(visual.photo),
        _photo_edge_panel(visual.photo, visual.photo_edge_mask),
        compose_edge_overlay(
            visual.photo,
            visual.photo_edge_mask,
            visual.primary_geometry_mask,
        ),
        compose_edge_overlay(
            visual.photo,
            visual.photo_edge_mask,
            displayed_challenger,
        ),
        _shifted_comparison_panel(visual),
        _coverage_panel(visual),
    ]


def _validate_image_visual(visual: ImageVisual) -> None:
    if np.asarray(visual.photo).shape != (ANALYSIS_SIZE, ANALYSIS_SIZE, 3):
        raise ValueError("diagnostic visual photo must be exact 512-pixel RGB")
    if np.asarray(visual.photo).dtype != np.uint8:
        raise ValueError("diagnostic visual photo must use exact 8-bit RGB pixels")
    masks = (
        visual.photo_edge_mask,
        visual.primary_geometry_mask,
        visual.alternative_geometry_mask,
        visual.shifted_primary_geometry_mask,
        visual.shifted_alternative_geometry_mask,
    )
    for mask in masks:
        if mask is not None and np.asarray(mask).shape != (
            ANALYSIS_SIZE,
            ANALYSIS_SIZE,
        ):
            raise ValueError("diagnostic visual mask must be exact 512 by 512")
        if mask is not None and np.asarray(mask).dtype != np.bool_:
            raise ValueError("diagnostic visual masks must be Boolean")


def _png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=False, compress_level=9)
    return buffer.getvalue()


def render_pair_sheet(
    case: ImageVisual,
    control: ImageVisual,
    pair: Mapping[str, Any],
    *,
    report_sha256: str,
) -> bytes:
    _validate_image_visual(case)
    _validate_image_visual(control)
    if case.row.get("name") != control.row.get("name"):
        raise ValueError("case and control must be the same Skybox face")
    if case.row.get("status") == edge_protocol.PASS_DISCRETE_GEOMETRY_ORIENTATION:
        raise ValueError("case row must preserve a frozen non-pass result")
    if control.row.get("status") != edge_protocol.PASS_DISCRETE_GEOMETRY_ORIENTATION:
        raise ValueError("control row must preserve a frozen PASS result")
    expected_bindings = {
        "caseScanId": case.row.get("scanId"),
        "caseImage2DIndex": case.row.get("image2DIndex"),
        "caseImage2DGuid": case.row.get("image2DGuid"),
        "faceName": case.row.get("name"),
        "controlScanId": control.row.get("scanId"),
        "controlImage2DIndex": control.row.get("image2DIndex"),
        "controlImage2DGuid": control.row.get("image2DGuid"),
    }
    if any(pair.get(key) != value for key, value in expected_bindings.items()):
        raise ValueError("pair receipt does not bind the supplied case and PASS exemplar")
    canvas = Image.new("RGB", PAIR_SHEET_SIZE, (23, 27, 34))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, PAIR_SHEET_WIDTH, 48), fill=(118, 24, 42))
    draw.text(
        (SHEET_MARGIN, 11),
        "PRIVATE · POST-HOC COMPUTER-VISION DIAGNOSTIC · FROZEN RESULT COPIED, NOT RECOMPUTED",
        fill="white",
        font=_font(22, bold=True),
    )
    draw.text(
        (SHEET_MARGIN, 61),
        (
            f"Case scan {pair['caseScanId']} {pair['faceName']} versus same-face PASS exemplar "
            f"scan {pair['controlScanId']} · heldout report SHA-256 {report_sha256[:20]}…"
        ),
        fill=(224, 229, 236),
        font=_font(18),
    )
    draw.text(
        (SHEET_MARGIN, 88),
        "Legend: cyan = photo edge · green = geometry within 2 px · magenta = farther than 2 px · lines are thickened 1 px and grid is display-only",
        fill=(181, 190, 203),
        font=_font(16),
    )

    y = SHEET_HEADER_HEIGHT
    for row_index, (visual, role) in enumerate(
        (
            (case, "FAILED / BLOCKED FACE"),
            (control, "SAME-FACE PASS EXAMPLE — NOT INDEPENDENT"),
        )
    ):
        first, second = _visual_summary(visual, role=role)
        draw.rectangle(
            (0, y, PAIR_SHEET_WIDTH, y + ROW_HEADER_HEIGHT),
            fill=(35, 41, 51) if row_index == 0 else (31, 52, 44),
        )
        draw.text(
            (SHEET_MARGIN, y + 12),
            first,
            fill=(255, 218, 224) if row_index == 0 else (210, 255, 225),
            font=_font(18, bold=True),
        )
        draw.text(
            (SHEET_MARGIN, y + 47),
            second,
            fill=(221, 226, 234),
            font=_font(15),
        )
        y += ROW_HEADER_HEIGHT
        titles = _panel_title_lines(visual)
        panels = _row_panels(visual)
        for panel_index, (title, panel) in enumerate(zip(titles, panels)):
            x = SHEET_MARGIN + panel_index * (PANEL_SIZE + PANEL_GAP)
            draw.rectangle(
                (x, y, x + PANEL_SIZE, y + PANEL_LABEL_HEIGHT),
                fill=(12, 15, 20),
            )
            draw.text(
                (x + 7, y + 8),
                title,
                fill=(235, 238, 243),
                font=_font(14, bold=True),
            )
            panel_image = Image.fromarray(panel, mode="RGB")
            if panel_image.size != (PANEL_SIZE, PANEL_SIZE):
                raise ValueError("diagnostic panel has an unexpected size")
            canvas.paste(panel_image, (x, y + PANEL_LABEL_HEIGHT))
        y += PANEL_LABEL_HEIGHT + PANEL_SIZE
        if row_index == 0:
            y += ROW_GAP

    draw.rectangle((0, y, PAIR_SHEET_WIDTH, PAIR_SHEET_HEIGHT), fill=(14, 17, 22))
    footer_lines = [PRIVATE_WARNING, PRIVACY_WARNING, CONTROL_WARNING]
    for index, line in enumerate(footer_lines):
        draw.text(
            (SHEET_MARGIN, y + 12 + index * 31),
            line,
            fill=(245, 205, 111) if index == 0 else (204, 211, 222),
            font=_font(16, bold=index == 0),
        )
    return _png_bytes(canvas)


def render_contact_sheet(
    sheets: Sequence[tuple[str, bytes, Mapping[str, Any]]],
) -> bytes:
    if len(sheets) != 14:
        raise ValueError("contact sheet requires the exact 14 frozen non-pass cases")
    columns = 2
    thumb_width = 760
    thumb_height = round(PAIR_SHEET_HEIGHT * thumb_width / PAIR_SHEET_WIDTH)
    label_height = 42
    margin = 20
    gap = 18
    header_height = 112
    rows = math.ceil(len(sheets) / columns)
    width = 2 * margin + columns * thumb_width + (columns - 1) * gap
    height = header_height + margin + rows * (thumb_height + label_height + gap)
    canvas = Image.new("RGB", (width, height), (20, 24, 31))
    draw = ImageDraw.Draw(canvas)
    draw.text(
        (margin, 18),
        "PRIVATE · 14 FROZEN NON-PASS FACES WITH SAME-FACE PASS EXEMPLARS",
        fill="white",
        font=_font(24, bold=True),
    )
    draw.text((margin, 53), PRIVATE_WARNING, fill=(245, 205, 111), font=_font(15))
    draw.text(
        (margin, 73),
        "May contain people or private details — keep local and do not publish.",
        fill=(255, 165, 165),
        font=_font(14, bold=True),
    )
    for index, (file_name, payload, pair) in enumerate(sheets):
        column = index % columns
        row = index // columns
        x = margin + column * (thumb_width + gap)
        y = header_height + row * (thumb_height + label_height + gap)
        with Image.open(io.BytesIO(payload)) as opened:
            opened.load()
            thumbnail = opened.convert("RGB").resize(
                (thumb_width, thumb_height),
                Image.Resampling.LANCZOS,
            )
        canvas.paste(thumbnail, (x, y + label_height))
        draw.text(
            (x, y + 9),
            (
                f"{index + 1:02d} · scan {pair['caseScanId']} {pair['faceName']} · "
                f"{_plain_status(str(pair['frozenStatus']))} · PASS example {pair['controlScanId']}"
            ),
            fill=(229, 234, 241),
            font=_font(15, bold=True),
        )
        if file_name != output_file_name(
            index + 1,
            {"scanId": pair["caseScanId"], "name": pair["faceName"]},
            {"scanId": pair["controlScanId"]},
        ):
            raise ValueError("contact-sheet file name differs from the stable pair name")
    return _png_bytes(canvas)


def _candidate_evaluation(
    row: Mapping[str, Any],
    candidate_id: str,
) -> Mapping[str, Any]:
    comparisons = row.get("candidateComparisons")
    if not isinstance(comparisons, list):
        raise ValueError("frozen image row has no candidate comparisons")
    candidate_ids = [
        item.get("candidateId") for item in comparisons if isinstance(item, Mapping)
    ]
    if (
        len(candidate_ids) != 48
        or len(set(candidate_ids)) != 48
        or set(candidate_ids) != set(geometry.CANDIDATE_BY_ID)
    ):
        raise ValueError("frozen image row does not contain the exact 48 candidate IDs")
    matches = [
        item
        for item in comparisons
        if isinstance(item, Mapping) and item.get("candidateId") == candidate_id
    ]
    if len(matches) != 1:
        raise ValueError(f"candidate {candidate_id!r} is not unique in the frozen row")
    if candidate_id == row.get("primaryCandidateId"):
        primary = row.get("primaryEvaluation")
        if primary != matches[0]:
            raise ValueError("primary evaluation differs from its frozen candidate row")
        if not isinstance(primary, Mapping):
            raise ValueError("frozen primary evaluation is missing")
        return primary
    return matches[0]


def _challenger_for_row(row: Mapping[str, Any]) -> tuple[str, bool]:
    name = str(row.get("name"))
    expected_primary = geometry.FIXED_V2_MAPPING.get(name)
    if row.get("primaryCandidateId") != expected_primary:
        raise ValueError("frozen row primary differs from the fixed v2 mapping")
    reasons = {str(reason) for reason in row.get("reasons", [])}
    shifted_reason = "shifted_margin_over_best_alternative_below_threshold"
    if shifted_reason in reasons:
        shifted = row.get("shiftedCandidateDiagnostic")
        if not isinstance(shifted, Mapping):
            raise ValueError("shifted-margin row lacks its frozen shifted diagnostic")
        candidate_id = shifted.get("bestAlternativeCandidateId")
        is_shifted = True
    elif "fixed_v2_primary_is_not_rank_one" in reasons:
        candidate_id = row.get("diagnosticWinnerCandidateId")
        is_shifted = False
    else:
        candidate_id = row.get("bestAlternativeCandidateId")
        is_shifted = False
    if not isinstance(candidate_id, str) or candidate_id not in geometry.CANDIDATE_BY_ID:
        raise ValueError("frozen row lacks a valid decision-relevant challenger")
    if candidate_id == row.get("primaryCandidateId"):
        raise ValueError("diagnostic challenger unexpectedly equals the fixed primary")
    return candidate_id, is_shifted


def _verify_projection_receipt(
    evaluation: Mapping[str, Any],
    candidate_id: str,
    projection: Mapping[str, Any],
    *,
    width: int,
    height: int,
) -> None:
    expected = edge_protocol._expected_candidate_projection_metadata(candidate_id)
    for key, value in expected.items():
        if evaluation.get(key) != value or projection.get(key) != value:
            raise ValueError(f"selected candidate projection metadata differs at {key}")
    for key in ("projectedInputCount", "visiblePixelCount"):
        if evaluation.get(key) != projection.get(key):
            raise ValueError(f"selected candidate projection count differs at {key}")
    occupied_fraction = _round(
        int(projection["visiblePixelCount"]) / (width * height),
        9,
    )
    if evaluation.get("occupiedPixelFraction") != occupied_fraction:
        raise ValueError("selected candidate occupied-pixel fraction differs")


def verify_shifted_mask_receipt(
    stored: Mapping[str, Any],
    shifted_mask: np.ndarray,
    photo_mask: np.ndarray,
) -> None:
    candidate = np.asarray(shifted_mask)
    photo = np.asarray(photo_mask)
    if candidate.dtype != np.bool_ or photo.dtype != np.bool_:
        raise ValueError("shifted and photo masks must be Boolean")
    if candidate.ndim != 2 or photo.ndim != 2 or candidate.shape != photo.shape:
        raise ValueError("shifted mask and photo mask must have matching dimensions")
    if stored.get("matchRadiusPixels") != geometry.PHOTO_MATCH_RADIUS_PIXELS:
        raise ValueError("shifted mask match radius differs from the frozen protocol")
    geometry_count = int(np.count_nonzero(candidate))
    photo_count = int(np.count_nonzero(photo))
    distance = _distance_to_photo_edges(photo)
    matched_count = int(
        np.count_nonzero(candidate & (distance <= geometry.PHOTO_MATCH_RADIUS_PIXELS))
    )
    expected = {
        "geometryEdgePixelCount": geometry_count,
        "geometryEdgeDensity": _round(geometry_count / candidate.size, 9),
        "matchedGeometryEdgePixelCount": matched_count,
        "matchedFraction": _round(matched_count / geometry_count, 9)
        if geometry_count
        else None,
        "photoEdgePixelCount": photo_count,
        "photoEdgeDensity": _round(photo_count / photo.size, 9),
    }
    for key, value in expected.items():
        if stored.get(key) != value:
            raise ValueError(f"shifted mask receipt differs at {key}")


def _best_shifted_mask(
    full_mask: np.ndarray,
    evaluation: Mapping[str, Any],
    photo_mask: np.ndarray,
) -> tuple[np.ndarray, tuple[int, int]]:
    common = edge_protocol._local_shift_common_support_mask(full_mask)
    common_count = int(np.count_nonzero(common))
    full_count = int(np.count_nonzero(full_mask))
    if evaluation.get("localShiftCommonSupportGeometryEdgePixelCount") != common_count:
        raise ValueError("local-shift common-support pixel count differs")
    expected_fraction = _round(common_count / full_count, 9) if full_count else None
    if evaluation.get("localShiftCommonSupportFractionOfFullGeometryEdges") != expected_fraction:
        raise ValueError("local-shift common-support fraction differs")
    if (
        evaluation.get("localShiftPreservesCommonGeometrySupport") is not True
        or evaluation.get("localShiftUsesZeroFillNoWrap") is not True
    ):
        raise ValueError("local-shift frozen safety flags are missing")
    comparisons = evaluation.get("localShiftComparisons")
    if not isinstance(comparisons, list) or len(comparisons) != 9:
        raise ValueError("selected candidate lacks the frozen nine local shifts")
    keys = [
        (int(item["dxPixels"]), int(item["dyPixels"]))
        for item in comparisons
        if isinstance(item, Mapping)
    ]
    expected_keys = {
        (dx, dy)
        for dx in edge_protocol.LOCAL_SHIFT_OFFSETS_PIXELS
        for dy in edge_protocol.LOCAL_SHIFT_OFFSETS_PIXELS
    }
    if len(keys) != 9 or set(keys) != expected_keys:
        raise ValueError("selected candidate local-shift offsets differ")
    zero_rows = [
        item
        for item in comparisons
        if item.get("dxPixels") == 0 and item.get("dyPixels") == 0
    ]
    if len(zero_rows) != 1:
        raise ValueError("selected candidate has no unique zero-shift receipt")
    verify_shifted_mask_receipt(zero_rows[0], common, photo_mask)
    dx = int(evaluation.get("bestLocalShiftDxPixels"))
    dy = int(evaluation.get("bestLocalShiftDyPixels"))
    selected_rows = [
        item
        for item in comparisons
        if item.get("dxPixels") == dx and item.get("dyPixels") == dy
    ]
    if len(selected_rows) != 1:
        raise ValueError("selected candidate has no unique best-shift receipt")
    shifted = edge_protocol._shift_mask_zero_fill(common, dy=dy, dx=dx)
    verify_shifted_mask_receipt(selected_rows[0], shifted, photo_mask)
    if evaluation.get("bestLocalShiftMatchedFraction") != selected_rows[0].get(
        "matchedFraction"
    ):
        raise ValueError("best local-shift score differs from its frozen row")
    return shifted, (dx, dy)


def _verify_primary_local_shift_summary(
    row: Mapping[str, Any],
    primary_evaluation: Mapping[str, Any],
) -> None:
    summary = row.get("localShiftDiagnostic")
    if not isinstance(summary, Mapping):
        raise ValueError("frozen primary local-shift summary is missing")
    comparisons = primary_evaluation.get("localShiftComparisons")
    zero_rows = [
        item
        for item in comparisons
        if isinstance(item, Mapping)
        and item.get("dxPixels") == 0
        and item.get("dyPixels") == 0
    ]
    if len(zero_rows) != 1:
        raise ValueError("frozen primary has no unique common-support zero shift")
    expected = {
        "fullSupportUnshiftedScoreS0": primary_evaluation.get("matchedFraction"),
        "commonSupportUnshiftedScore": zero_rows[0].get("matchedFraction"),
        "bestShiftDxPixels": primary_evaluation.get("bestLocalShiftDxPixels"),
        "bestShiftDyPixels": primary_evaluation.get("bestLocalShiftDyPixels"),
        "bestShiftScore": primary_evaluation.get("bestLocalShiftMatchedFraction"),
        "gainOverUnshifted": primary_evaluation.get("localShiftGain"),
        "comparisons": comparisons,
        "commonGeometryAndPhotoSupport": True,
        "zeroFillNoWrap": True,
        "shiftSensitive": primary_evaluation.get("shiftSensitiveDiagnostic"),
        "shiftSensitiveDiagnosticOnly": True,
        "affectsDiscreteOrientationPass": False,
    }
    for key, value in expected.items():
        if summary.get(key) != value:
            raise ValueError(f"primary local-shift summary differs at {key}")


def _reconstruct_candidate(
    base_coordinates: Mapping[str, Mapping[str, Any]],
    *,
    candidate_id: str,
    evaluation: Mapping[str, Any],
    analysis_intrinsics: Mapping[str, Any],
) -> tuple[np.ndarray, Mapping[str, Any]]:
    expected = edge_protocol._expected_candidate_projection_metadata(candidate_id)
    base_name = str(expected["sourceBaseSkyboxName"])
    if base_name not in base_coordinates:
        raise ValueError("selected candidate has no frozen base coordinate frame")
    width = int(analysis_intrinsics["width"])
    height = int(analysis_intrinsics["height"])
    returned_id, projection = edge_protocol._rasterize_candidate_from_base_coordinates(
        base_coordinates[base_name],
        quarter_turns_counter_clockwise=int(
            expected["quarterTurnsCounterClockwise"]
        ),
        mirrored=bool(expected["mirrored"]),
        fx=float(analysis_intrinsics["fx"]),
        fy=float(analysis_intrinsics["fy"]),
        cx=float(analysis_intrinsics["cx"]),
        cy=float(analysis_intrinsics["cy"]),
        width=width,
        height=height,
    )
    if returned_id != candidate_id:
        raise ValueError("selected rasterization returned a different candidate ID")
    _verify_projection_receipt(
        evaluation,
        candidate_id,
        projection,
        width=width,
        height=height,
    )
    mask, _ = geometry.strongest_geometry_edge_mask(
        projection["absoluteLogRangeJumpImage"],
        projection["surfaceNormalDiscontinuityImage"],
        projection["occupiedMask"],
    )
    return np.asarray(mask, dtype=bool), projection


def _validate_analysis_intrinsics(intrinsics: Any) -> Mapping[str, Any]:
    expected_keys = {"fx", "fy", "cx", "cy", "width", "height"}
    if not isinstance(intrinsics, Mapping) or set(intrinsics) != expected_keys:
        raise ValueError("frozen analysis intrinsics have an unexpected shape")
    if (
        intrinsics.get("width") != ANALYSIS_SIZE
        or intrinsics.get("height") != ANALYSIS_SIZE
    ):
        raise ValueError("frozen analysis intrinsics are not 512 by 512")
    for key in ("fx", "fy", "cx", "cy"):
        value = intrinsics.get(key)
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise ValueError(f"frozen analysis intrinsic {key} is invalid")
    return intrinsics


def _read_selected_jpeg(
    images2d: Any,
    row: Mapping[str, Any],
) -> tuple[np.ndarray, np.ndarray]:
    image_index = int(row["image2DIndex"])
    if image_index < 0 or image_index >= int(images2d.childCount()):
        raise ValueError("selected image index is outside images2D")
    node = images2d[image_index]
    expected_scalars = {
        "name": str(row["name"]),
        "guid": str(row["image2DGuid"]),
        "associatedData3DGuid": str(row["data3DGuid"]),
    }
    for key, expected in expected_scalars.items():
        if str(node[key].value()) != expected:
            raise ValueError(f"selected E57 image differs from frozen {key}")
    jpeg = edge_protocol._jpeg_record(
        node["pinholeRepresentation"],
        label=f"scan {int(row['scanId'])} {row['name']} post-hoc diagnostic",
    )
    receipt = {
        "sha256": jpeg["sha256"],
        "sizeBytes": jpeg["sizeBytes"],
        "width": jpeg["sourceWidth"],
        "height": jpeg["sourceHeight"],
    }
    if receipt != row.get("jpeg"):
        raise ValueError("selected JPEG bytes or dimensions differ from frozen report")
    if jpeg["sourceIntrinsics"] != row.get("declaredSourceIntrinsics"):
        raise ValueError("selected JPEG source intrinsics differ from frozen report")
    analysis_intrinsics = _validate_analysis_intrinsics(row.get("analysisIntrinsics"))
    actual_analysis = {
        "fx": jpeg["fx"],
        "fy": jpeg["fy"],
        "cx": jpeg["cx"],
        "cy": jpeg["cy"],
        "width": ANALYSIS_SIZE,
        "height": ANALYSIS_SIZE,
    }
    if actual_analysis != analysis_intrinsics:
        raise ValueError("selected JPEG analysis intrinsics differ from frozen report")
    photo = np.asarray(jpeg["photo"], dtype=np.uint8)
    if photo.shape != (ANALYSIS_SIZE, ANALYSIS_SIZE, 3):
        raise ValueError("selected JPEG analysis image is not 512-pixel RGB")
    photo_edge_mask = geometry.strongest_photo_edge_mask(
        geometry.gaussian_sobel_photo_edges(photo)
    )
    if int(np.count_nonzero(photo_edge_mask)) != row.get("photoEdgePixelCount"):
        raise ValueError("selected JPEG photo-edge count differs from frozen report")
    return photo, np.asarray(photo_edge_mask, dtype=bool)


def _scan_rows_by_id(report: Mapping[str, Any]) -> dict[int, Mapping[str, Any]]:
    rows = report.get("scans")
    if not isinstance(rows, list):
        raise ValueError("frozen scan rows are missing")
    result = {int(row["scanId"]): row for row in rows if isinstance(row, Mapping)}
    if len(result) != len(rows):
        raise ValueError("frozen scan rows contain duplicate IDs")
    return result


def _selected_image_rows(
    report: Mapping[str, Any],
    pairs: Sequence[Mapping[str, Any]],
) -> dict[tuple[int, str], Mapping[str, Any]]:
    images = report.get("images")
    if not isinstance(images, list):
        raise ValueError("frozen image rows are missing")
    all_rows = {
        (int(row["scanId"]), str(row["name"])): row
        for row in images
        if isinstance(row, Mapping)
    }
    selected_keys: set[tuple[int, str]] = set()
    for pair in pairs:
        face = str(pair["faceName"])
        selected_keys.add((int(pair["caseScanId"]), face))
        selected_keys.add((int(pair["controlScanId"]), face))
    if len(selected_keys) != 22:
        raise ValueError("mechanical pairing did not select exactly 22 unique photographs")
    if not selected_keys.issubset(all_rows):
        raise ValueError("mechanical pairing refers to an absent frozen image row")
    selected = {key: all_rows[key] for key in sorted(selected_keys)}
    scan_ids = sorted({key[0] for key in selected})
    if scan_ids != EXPECTED_SELECTED_SCAN_IDS:
        raise ValueError("mechanical pairing did not select the exact 13 scans")
    return selected


def selected_reconstruction_plan(
    report: Mapping[str, Any],
    pairs: Sequence[Mapping[str, Any]],
) -> dict[int, list[str]]:
    selected = _selected_image_rows(report, pairs)
    plan: dict[int, set[str]] = {
        scan_id: set() for scan_id in EXPECTED_SELECTED_SCAN_IDS
    }
    for (scan_id, _face), row in selected.items():
        primary_id = str(row["primaryCandidateId"])
        challenger_id, _ = _challenger_for_row(row)
        _candidate_evaluation(row, primary_id)
        _candidate_evaluation(row, challenger_id)
        plan[scan_id].update((primary_id, challenger_id))
    counts = {scan_id: len(candidate_ids) for scan_id, candidate_ids in plan.items()}
    if counts != EXPECTED_CANDIDATE_RASTERIZATIONS_BY_SCAN:
        raise ValueError("selected candidate reconstruction budget changed")
    if sum(counts.values()) != EXPECTED_CANDIDATE_RASTERIZATION_COUNT:
        raise ValueError("selected candidate reconstruction total changed")
    return {
        scan_id: sorted(candidate_ids) for scan_id, candidate_ids in plan.items()
    }


def _verify_scan_receipt(
    scan_row: Mapping[str, Any],
    *,
    data3d_guid: str,
    grid_evidence: Mapping[str, Any],
    prepared: Mapping[str, Any],
) -> None:
    expected = {
        "data3DGuid": data3d_guid,
        "fullGridShape": prepared["fullGridShape"],
        "decimatedGridShape": prepared["gridShape"],
        "validDecimatedPointCount": prepared["validPointCount"],
        "organizedGridEvidence": grid_evidence,
        "geometrySampleSha256": edge_protocol._geometry_sample_sha256(prepared),
        "returnedPointFields": list(edge_protocol.POINT_FIELDS_REQUESTED),
        "pointColourFieldsRequestedOrRead": False,
        "majorityVoteUsed": False,
        "continuousCalibrationValidated": False,
        "metricGeometryValidated": False,
        "knownPoseMaterializationPermitted": False,
        "trainingPermitted": False,
    }
    for key, value in expected.items():
        if scan_row.get(key) != value:
            raise ValueError(f"selected scan receipt differs from frozen {key}")


def build_selected_visuals(
    source: Any,
    report: Mapping[str, Any],
    pairs: Sequence[Mapping[str, Any]],
) -> dict[tuple[int, str], ImageVisual]:
    selected = _selected_image_rows(report, pairs)
    reconstruction_plan = selected_reconstruction_plan(report, pairs)
    scan_rows = _scan_rows_by_id(report)
    root = source.image_file.root()
    data3d = root["data3D"]
    images2d = root["images2D"]
    if int(data3d.childCount()) <= max(EXPECTED_SELECTED_SCAN_IDS):
        raise ValueError("source E57 has too few data3D records")
    output: dict[tuple[int, str], ImageVisual] = {}
    seen_image_indexes: set[int] = set()
    seen_image_guids: set[str] = set()
    for scan_id in EXPECTED_SELECTED_SCAN_IDS:
        scan_row = scan_rows.get(scan_id)
        if scan_row is None:
            raise ValueError(f"selected scan {scan_id} has no frozen scan row")
        data3d_guid = str(data3d[scan_id]["guid"].value())
        if data3d_guid != scan_row.get("data3DGuid"):
            raise ValueError(f"selected scan {scan_id} GUID differs from frozen report")
        header = source.get_header(scan_id)
        fields = edge_protocol._read_organized_xyz(source, scan_id)
        row_count, column_count, grid_evidence = (
            edge_protocol._frozen_organized_grid_shape(
                header,
                fields,
                scan_id=scan_id,
            )
        )
        prepared = geometry.prepare_geometry_samples(
            fields,
            row_count=row_count,
            column_count=column_count,
        )
        _verify_scan_receipt(
            scan_row,
            data3d_guid=data3d_guid,
            grid_evidence=grid_evidence,
            prepared=prepared,
        )
        base_coordinates = edge_protocol.precompute_six_base_projection_coordinates(
            prepared
        )
        candidate_cache: dict[str, tuple[np.ndarray, Mapping[str, Any]]] = {}
        scan_image_rows = [
            row for (row_scan_id, _), row in selected.items() if row_scan_id == scan_id
        ]
        for row in sorted(scan_image_rows, key=lambda item: str(item["name"])):
            image_index = int(row["image2DIndex"])
            image_guid = str(row["image2DGuid"])
            if image_index in seen_image_indexes or image_guid in seen_image_guids:
                raise ValueError("selected photographs contain a duplicate index or GUID")
            seen_image_indexes.add(image_index)
            seen_image_guids.add(image_guid)
            photo, photo_mask = _read_selected_jpeg(images2d, row)
            primary_id = str(row["primaryCandidateId"])
            challenger_id, challenger_is_shifted = _challenger_for_row(row)
            primary_evaluation = _candidate_evaluation(row, primary_id)
            challenger_evaluation = _candidate_evaluation(row, challenger_id)
            _verify_primary_local_shift_summary(row, primary_evaluation)
            intrinsics = _validate_analysis_intrinsics(row["analysisIntrinsics"])
            for candidate_id, evaluation in (
                (primary_id, primary_evaluation),
                (challenger_id, challenger_evaluation),
            ):
                if candidate_id not in candidate_cache:
                    candidate_cache[candidate_id] = _reconstruct_candidate(
                        base_coordinates,
                        candidate_id=candidate_id,
                        evaluation=evaluation,
                        analysis_intrinsics=intrinsics,
                    )
                else:
                    _verify_projection_receipt(
                        evaluation,
                        candidate_id,
                        candidate_cache[candidate_id][1],
                        width=int(intrinsics["width"]),
                        height=int(intrinsics["height"]),
                    )
                verify_selected_mask_receipt(
                    evaluation,
                    candidate_cache[candidate_id][0],
                    photo_mask,
                )
            primary_mask = candidate_cache[primary_id][0]
            challenger_mask = candidate_cache[challenger_id][0]
            shifted_primary, primary_shift = _best_shifted_mask(
                primary_mask,
                primary_evaluation,
                photo_mask,
            )
            shifted_challenger, challenger_shift = _best_shifted_mask(
                challenger_mask,
                challenger_evaluation,
                photo_mask,
            )
            output[(scan_id, str(row["name"]))] = ImageVisual(
                row=row,
                photo=photo,
                photo_edge_mask=photo_mask,
                primary_geometry_mask=primary_mask.copy(),
                alternative_geometry_mask=challenger_mask.copy(),
                shifted_primary_geometry_mask=shifted_primary,
                shifted_alternative_geometry_mask=shifted_challenger,
                challenger_candidate_id=challenger_id,
                challenger_is_shifted=challenger_is_shifted,
                primary_shift_dx_dy=primary_shift,
                alternative_shift_dx_dy=challenger_shift,
            )
        if set(candidate_cache) != set(reconstruction_plan[scan_id]):
            raise ValueError("actual selected candidate rasterizations changed")
        del candidate_cache
        del base_coordinates
        del prepared
        del fields
        gc.collect()
    if set(output) != set(selected):
        raise ValueError("visual reconstruction did not produce the exact selected images")
    return output


def human_review_csv_bytes(pairs: Sequence[Mapping[str, Any]]) -> bytes:
    destination = io.StringIO(newline="")
    writer = csv.writer(destination, lineterminator="\n")
    writer.writerow(
        [
            "case_scan_id",
            "face_name",
            "pass_example_scan_id",
            "frozen_status",
            "frozen_reason",
            "human_visual_diagnosis",
            "confidence_low_medium_high",
            "evidence_seen",
            "notes",
        ]
    )
    for pair in pairs:
        writer.writerow(
            [
                pair["caseScanId"],
                pair["faceName"],
                pair["controlScanId"],
                pair["frozenStatus"],
                ";".join(str(reason) for reason in pair["frozenReasons"]),
                "",
                "",
                "",
                "",
            ]
        )
    return destination.getvalue().encode("utf-8")


def index_html_bytes(
    sheets: Sequence[tuple[str, bytes, Mapping[str, Any]]],
) -> bytes:
    cards: list[str] = []
    for index, (file_name, _payload, pair) in enumerate(sheets, start=1):
        reason = "; ".join(
            _plain_reason(str(value)) for value in pair["frozenReasons"]
        )
        cards.append(
            "\n".join(
                [
                    '<article class="card">',
                    f"<h2>{index:02d}. Scan {int(pair['caseScanId'])}, "
                    f"{html.escape(str(pair['faceName']))}</h2>",
                    f"<p><strong>{html.escape(_plain_status(str(pair['frozenStatus'])))}</strong></p>",
                    f"<p>{html.escape(reason)}.</p>",
                    f"<p>Compared with same-face PASS example from scan "
                    f"{int(pair['controlScanId'])}. This example is not independent.</p>",
                    f'<a href="{html.escape(file_name)}"><img loading="lazy" '
                    f'src="{html.escape(file_name)}" alt="Private computer-vision edge '
                    f'diagnostic for scan {int(pair["caseScanId"])} '
                    f'{html.escape(str(pair["faceName"]))}"></a>',
                    "</article>",
                ]
            )
        )
    document = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Private Reception Room computer-vision diagnostics</title>
  <style>
    :root {{ color-scheme: dark; font-family: system-ui, sans-serif; }}
    body {{ margin: 0; background: #11151b; color: #edf1f7; line-height: 1.5; }}
    main {{ max-width: 1500px; margin: auto; padding: 24px; }}
    .warning {{ border: 2px solid #ff6b7f; background: #391924; padding: 18px; border-radius: 10px; }}
    .explain {{ background: #192431; padding: 16px 20px; border-radius: 10px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit,minmax(520px,1fr)); gap: 22px; }}
    .card {{ background: #1b222c; padding: 16px; border-radius: 10px; }}
    img {{ width: 100%; height: auto; border: 1px solid #4b596b; }}
    a {{ color: #7edcff; }}
    code {{ background: #0d1117; padding: 2px 5px; }}
  </style>
</head>
<body><main>
  <h1>Reception Room: visual explanation of the frozen edge-test failures</h1>
  <div class="warning"><strong>PRIVATE — KEEP LOCAL — DO NOT PUBLISH.</strong><br>
  {html.escape(PRIVACY_WARNING)}<br>{html.escape(PRIVATE_WARNING)}</div>
  <div class="explain">
    <h2>How to read these pictures</h2>
    <p>Cyan marks strong edges found in the photograph. Green marks laser-scan edges no more
    than two pixels from a photograph edge. Magenta marks laser-scan edges farther away.
    Each failed or blocked face appears above a mechanically selected image of the same cube
    face that passed. The PASS image is a comparison example, not an independent control.</p>
    <p>The six panels show the 512-pixel source, photograph edges, the expected cube orientation,
    the already-recorded runner-up, the expected orientation after its already-recorded tiny
    nudge, and the 8×8 spread of laser-scan edges. The pictures copy the sealed outcome; they do
    not rerun the 48-way decision and cannot change a failure into a pass.</p>
    <p><a href="contact-sheet.png">Open the 14-case contact sheet</a> ·
    <a href="human-review.csv">Open the blank human-review table</a> ·
    <a href="manifest.json">Open the hash-bound manifest</a></p>
  </div>
  <div class="grid">{''.join(cards)}</div>
</main></body></html>
"""
    return document.encode("utf-8")


def private_warning_bytes() -> bytes:
    lines = [
        "PRIVATE DIAGNOSTIC — KEEP LOCAL — DO NOT PUBLISH",
        "",
        PRIVATE_WARNING,
        PRIVACY_WARNING,
        CONTROL_WARNING,
        "",
        "What the colours mean:",
        "- Cyan: a strong edge detected in the photograph.",
        "- Green: a laser-scan edge within the frozen two-pixel matching distance.",
        "- Magenta: a laser-scan edge farther than two pixels from a photograph edge.",
        "- Grey/yellow lines: display-only 8x8 cell and quadrant guides.",
        "- Coloured edge lines are thickened by one pixel for visibility; scores use exact cores.",
        "",
        "The 16 held-out scan positions have already been used. They cannot independently",
        "validate a revised method. Continuous calibration and metric geometry remain",
        "unvalidated. Known-pose materialization and training remain forbidden.",
    ]
    return ("\n".join(lines) + "\n").encode("utf-8")


def _output_receipt(file_name: str, payload: bytes) -> dict[str, Any]:
    return {
        "fileName": file_name,
        "sizeBytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def _verify_staged_outputs(
    staging: Path,
    expected_payloads: Mapping[str, bytes],
) -> None:
    entries = list(staging.iterdir())
    if {entry.name for entry in entries} != set(expected_payloads):
        raise ValueError("staging directory contains an unexpected output set")
    for entry in entries:
        if entry.is_symlink() or not entry.is_file():
            raise ValueError("staging output is not a regular non-symlink file")
        expected = expected_payloads[entry.name]
        initial_stat = entry.stat()
        if initial_stat.st_size != len(expected):
            raise ValueError(f"staged {entry.name} size differs from its receipt")
        stat = _safe_regular_file(
            entry,
            f"staged {entry.name}",
            max(len(expected), 1),
        )
        if stat.st_size != len(expected):
            raise ValueError(f"staged {entry.name} size differs from its receipt")
        if _sha256_file(entry, stat, max(len(expected), 1)) != hashlib.sha256(
            expected
        ).hexdigest():
            raise ValueError(f"staged {entry.name} bytes differ from its receipt")


def publish_create_only_bundle(
    output_dir: Path,
    files: Mapping[str, bytes],
    manifest_payload: Mapping[str, Any],
    *,
    before_publish: Callable[[], None] | None = None,
) -> dict[str, Any]:
    require_new_output_directory(output_dir)
    if "manifest.json" in files:
        raise ValueError("manifest.json is written last by the bundle publisher")
    for file_name, payload in files.items():
        if Path(file_name).name != file_name or file_name in ("", ".", ".."):
            raise ValueError("bundle output names must be safe leaf names")
        if not isinstance(payload, bytes):
            raise ValueError("bundle outputs must be fully materialized bytes")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(
            prefix=f".{output_dir.name}.staging-",
            dir=output_dir.parent,
        )
    )
    try:
        receipts: list[dict[str, Any]] = []
        for file_name in sorted(files):
            payload = files[file_name]
            write_create_only(staging / file_name, payload)
            receipts.append(_output_receipt(file_name, payload))
        _verify_staged_outputs(staging, files)
        manifest = finalize_manifest(
            {
                **dict(manifest_payload),
                "outputsExcludingManifest": receipts,
            }
        )
        manifest_payload_bytes = manifest_bytes(manifest)
        write_create_only(staging / "manifest.json", manifest_payload_bytes)
        _verify_staged_outputs(
            staging,
            {**dict(files), "manifest.json": manifest_payload_bytes},
        )
        if before_publish is not None:
            before_publish()
        require_new_output_directory(output_dir)
        staging.rename(output_dir)
        return manifest
    except BaseException as original_error:
        try:
            shutil.rmtree(staging)
        except FileNotFoundError:
            pass
        except OSError as cleanup_error:
            raise RuntimeError(
                "could not remove the private diagnostic staging directory"
            ) from cleanup_error
        if staging.exists():
            raise RuntimeError(
                "private diagnostic staging directory remains after failure"
            ) from original_error
        raise


def _verify_inputs_unchanged(
    verified: VerifiedInputs,
    *,
    protocol_path: Path,
    heldout_report_path: Path,
    e57_path: Path,
) -> None:
    e57_after = _safe_regular_file(e57_path, "source E57", MAX_E57_BYTES)
    if not _same_file_identity(verified.e57_stat, e57_after):
        fail("FILE_CHANGED_DURING_READ", "source E57 changed during diagnostics")
    for path, before, expected_sha256, label, maximum in (
        (
            protocol_path,
            verified.protocol_stat,
            PINNED_PROTOCOL_SHA256,
            "frozen protocol",
            MAX_PROTOCOL_BYTES,
        ),
        (
            heldout_report_path,
            verified.report_stat,
            PINNED_HELDOUT_REPORT_SHA256,
            "frozen held-out report",
            MAX_HELDOUT_REPORT_BYTES,
        ),
    ):
        after = _safe_regular_file(path, label, maximum)
        if not _same_file_identity(before, after):
            fail("FILE_CHANGED_DURING_READ", f"{label} changed during diagnostics")
        if _sha256_file(path, after, maximum) != expected_sha256:
            fail("FILE_CHANGED_DURING_READ", f"{label} bytes changed during diagnostics")
    edge_protocol._verify_captured_files_unchanged(
        verified.implementation_captures
    )
    edge_protocol._verify_captured_files_unchanged(verified.exporter_captures)


def _manifest_payload(
    verified: VerifiedInputs,
    pairs: Sequence[Mapping[str, Any]],
    visuals: Mapping[tuple[int, str], ImageVisual],
) -> dict[str, Any]:
    unique_controls = {
        (int(pair["controlScanId"]), str(pair["faceName"])) for pair in pairs
    }
    visual_selections = []
    for (scan_id, face_name), visual in sorted(visuals.items()):
        pdx, pdy = visual.primary_shift_dx_dy
        adx, ady = visual.alternative_shift_dx_dy
        visual_selections.append(
            {
                "scanId": scan_id,
                "faceName": face_name,
                "image2DIndex": int(visual.row["image2DIndex"]),
                "image2DGuid": str(visual.row["image2DGuid"]),
                "frozenStatus": str(visual.row["status"]),
                "primaryCandidateId": str(visual.row["primaryCandidateId"]),
                "primaryBestShiftDxPixels": pdx,
                "primaryBestShiftDyPixels": pdy,
                "challengerCandidateId": str(visual.challenger_candidate_id),
                "challengerDisplayedWithBestShift": bool(
                    visual.challenger_is_shifted
                ),
                "challengerBestShiftDxPixels": adx,
                "challengerBestShiftDyPixels": ady,
            }
        )
    if len(visual_selections) != 22:
        raise ValueError("manifest requires the exact 22 visual selections")
    return {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "createdAtUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "authority": "none",
        "artifactRole": "post_hoc_private_visual_explanation",
        "plainLanguagePurpose": (
            "Show a human where frozen laser-scan edge masks agree or disagree with "
            "the selected 512-pixel photographs."
        ),
        "frozenOutcomeCopiedNotRecomputed": True,
        "fullHeldOutDecisionRerun": False,
        "candidateRanksRecomputed": False,
        "faceStatusesRecomputed": False,
        "thresholdsChanged": False,
        "selectedMasksReconstructedOnlyForDisplayAndReceiptChecking": True,
        "heldOutStationsConsumed": True,
        "heldOutStationsCanIndependentlyValidateARevision": False,
        "humanReviewCanChangeFrozenDecision": False,
        "sourceE57": {
            "fileName": verified.protocol["scope"]["sourceE57"]["fileName"],
            "sizeBytes": verified.e57_stat.st_size,
            "sha256": verified.source_sha256,
        },
        "frozenProtocol": dict(verified.protocol_receipt),
        "frozenHeldOutReport": dict(verified.report_receipt),
        "frozenResult": {
            "status": verified.report["result"]["status"],
            "everyHeldOutFacePasses": False,
            "coarseDiscreteGeometryOrientationGatePassed": False,
        },
        "selection": {
            "nonPassCaseCount": len(pairs),
            "uniquePassExampleCount": len(unique_controls),
            "uniqueSelectedPhotographCount": 22,
            "selectedScanCount": len(EXPECTED_SELECTED_SCAN_IDS),
            "selectedScanIds": list(EXPECTED_SELECTED_SCAN_IDS),
            "selectedCandidateRasterizationCount": (
                EXPECTED_CANDIDATE_RASTERIZATION_COUNT
            ),
            "selectedCandidateRasterizationsByScan": dict(
                EXPECTED_CANDIDATE_RASTERIZATIONS_BY_SCAN
            ),
            "pairs": [dict(pair) for pair in pairs],
            "visualSelections": visual_selections,
            "pairingRule": (
                "Same Skybox face; nearest relative geometry-edge plus photo-edge count; "
                "ties use raw deltas, lower scan ID, then lower image index; reuse allowed."
            ),
            "pairingLimit": (
                "Every photograph has the same selected photo-edge count, so matching is "
                "effectively by same face and total geometry-edge count. The examples do "
                "not control scene content, blur, occlusion, people, or lighting."
            ),
            "passExamplesAreIndependentControls": False,
        },
        "readBoundary": {
            "readScanArguments": {
                "intensity": False,
                "colors": False,
                "row_column": True,
                "transform": False,
            },
            "pointColourFieldsRequestedOrRead": False,
            "embeddedJpegRgbDecoded": True,
            "nativePhotographDimensions": [4096, 4096],
            "analysisPhotographDimensions": [512, 512],
            "nativeFullResolutionPhotographsExported": False,
            "rawJpegBytesExported": False,
            "exifExported": False,
            "networkTransferPerformed": False,
        },
        "safetyAndAuthorization": {
            "privacyReviewComplete": False,
            "nativeImageMaskingPerformed": False,
            "sourceRightsApproved": False,
            "externalPublicationPermitted": False,
            "continuousCalibrationValidated": False,
            "metricGeometryValidated": False,
            "knownPoseMaterializationPermitted": False,
            "trainingPermitted": False,
        },
        "display": {
            "pairSheetCount": 14,
            "pairSheetPixelDimensions": list(PAIR_SHEET_SIZE),
            "sourcePanelsUseOnly512PixelAnalysisResize": True,
            "displayLineDilationPixels": 1,
            "displayDilationChangesScores": False,
            "displayGridChangesScores": False,
            "matchedGeometryMeaning": "within the frozen two-pixel photo-edge radius",
        },
        "warnings": [PRIVATE_WARNING, PRIVACY_WARNING, CONTROL_WARNING],
        "implementation": {
            "frozenDecisionSources": verified.protocol["implementation"]["sourceFiles"],
            "diagnosticExporterSources": list(verified.exporter_sources),
            "dependencyVersions": verified.protocol["implementation"][
                "dependencyVersions"
            ],
            "forbiddenDecisionFunctionsInvoked": False,
            "forbiddenDecisionFunctionNames": list(
                FORBIDDEN_DECISION_FUNCTION_NAMES
            ),
        },
    }


def export_diagnostics(
    *,
    e57_path: Path,
    protocol_path: Path,
    heldout_report_path: Path,
    output_dir: Path,
) -> dict[str, Any]:
    verified = load_verified_inputs(
        protocol_path=protocol_path,
        heldout_report_path=heldout_report_path,
        e57_path=e57_path,
        output_dir=output_dir,
    )
    pairs = select_diagnostic_pairs(verified.report["images"])
    try:
        import pye57  # Imported only after every pinned byte/hash check succeeds.
    except ImportError as error:
        fail("PYE57_UNAVAILABLE", f"pye57 is required for diagnostics: {error}")

    source = pye57.E57(str(e57_path))
    try:
        visuals = build_selected_visuals(source, verified.report, pairs)
    finally:
        del source
        gc.collect()
    sheets: list[tuple[str, bytes, Mapping[str, Any]]] = []
    for index, pair in enumerate(pairs, start=1):
        face = str(pair["faceName"])
        case = visuals[(int(pair["caseScanId"]), face)]
        control = visuals[(int(pair["controlScanId"]), face)]
        file_name = output_file_name(index, case.row, control.row)
        payload = render_pair_sheet(
            case,
            control,
            pair,
            report_sha256=PINNED_HELDOUT_REPORT_SHA256,
        )
        sheets.append((file_name, payload, pair))
    files: dict[str, bytes] = {
        file_name: payload for file_name, payload, _pair in sheets
    }
    files.update(
        {
            "contact-sheet.png": render_contact_sheet(sheets),
            "index.html": index_html_bytes(sheets),
            "human-review.csv": human_review_csv_bytes(pairs),
            "PRIVATE_DIAGNOSTIC_DO_NOT_PUBLISH.txt": private_warning_bytes(),
        }
    )
    manifest = publish_create_only_bundle(
        output_dir,
        files,
        _manifest_payload(verified, pairs, visuals),
        before_publish=lambda: _verify_inputs_unchanged(
            verified,
            protocol_path=protocol_path,
            heldout_report_path=heldout_report_path,
            e57_path=e57_path,
        ),
    )
    return {
        "outputDirectory": str(output_dir),
        "manifestPayloadSha256": manifest["payloadSha256"],
        "pairSheetCount": len(sheets),
        "fileCountIncludingManifest": len(files) + 1,
        "authority": "none",
        "frozenDecisionChanged": False,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Create private 512-pixel computer-vision overlays for the frozen "
            "Reception Room geometry-edge failures without rerunning the decision."
        )
    )
    parser.add_argument("--e57", type=Path, required=True, help="Exact source cloud_0.e57")
    parser.add_argument(
        "--protocol",
        type=Path,
        required=True,
        help="Exact frozen v2 geometry-edge protocol JSON",
    )
    parser.add_argument(
        "--heldout-report",
        type=Path,
        required=True,
        help="Exact frozen one-shot held-out geometry-edge report JSON",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="New local/private directory; an existing path is refused",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        result = export_diagnostics(
            e57_path=arguments.e57.resolve(),
            protocol_path=arguments.protocol.resolve(),
            heldout_report_path=arguments.heldout_report.resolve(),
            output_dir=arguments.output_dir.resolve(),
        )
    except AuditError as error:
        print(
            json.dumps(
                {"status": "error", "code": error.code, "message": error.message},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    except Exception as error:
        print(
            json.dumps(
                {
                    "status": "error",
                    "code": "DIAGNOSTIC_EXPORT_FAILED",
                    "message": str(error),
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    print(json.dumps({"status": "ok", **result}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
