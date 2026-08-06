#!/usr/bin/env python3
"""Freeze and run the Reception geometry-only E57/JPEG edge audit.

This is the formal wrapper around :mod:`audit_e57_geometry_edges`.  It has three
deliberately separate commands:

``run-development``
    Verify the exact failed v1 report, read exactly the seven declared
    development scans, and publish a create-only v2 report. The sixteen
    held-out scans are not opened.

``create-protocol``
    Hash the exact failed v1 report, source E57, sealed v2 colour/orientation
    report, this tool, and its local code dependencies. Write one create-only
    JSON protocol containing the reviewed v2 method, scan split, thresholds,
    and runtime versions. This command does not decode a scan.

``run-audit``
    Verify every frozen hash and constant *before* opening the E57. Then read
    only the frozen held-out scans with ``colors=False``.  Six continuous
    coordinate frames are precomputed; all 48 rotated/mirrored candidates are
    then independently rasterized, compared with the embedded JPEGs, and
    written to one create-only report.

The audit never requests or reads E57 point colour.  It does decode the
embedded JPEG photographs, because photo edges are the evidence being tested.
The unchanged 240-offset test diagnoses exact pixel-location uniqueness only;
it never changes discrete orientation. Passing the discrete geometry gate does
not authorize dataset materialization or training and does not establish
continuous/metrology-grade calibration.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import importlib.metadata
import io
import json
import math
import os
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
import scipy
from PIL import Image
from scipy import ndimage

import audit_e57_geometry_edges as geometry
import audit_e57_room_images as room_audit
from audit_e57_room_images import (
    AuditError,
    MAX_E57_BYTES,
    MAX_IMAGE_BYTES,
    _canonical_json_bytes,
    _intrinsic_record,
    _safe_regular_file,
    _same_file_identity,
    _sha256_file,
    fail,
    write_create_only,
)


PROTOCOL_SCHEMA_VERSION = "omnitwin.reception.e57-geometry-edge-protocol.v2"
REPORT_SCHEMA_VERSION = "omnitwin.reception.e57-geometry-edge-audit.v2"
DEVELOPMENT_REPORT_SCHEMA_VERSION = (
    "omnitwin.reception.e57-geometry-edge-development.v2"
)
PROTOCOL_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_PROTOCOL_V2\0"
REPORT_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_AUDIT_V2\0"
DEVELOPMENT_REPORT_DIGEST_DOMAIN = (
    b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_DEVELOPMENT_V2\0"
)
# These two v1 constants are intentionally retained only to verify the exact
# failed development report that caused the reviewed post-development revision.
PRIOR_DEVELOPMENT_REPORT_SCHEMA_VERSION = (
    "omnitwin.reception.e57-geometry-edge-development.v1"
)
PRIOR_DEVELOPMENT_REPORT_DIGEST_DOMAIN = (
    b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_DEVELOPMENT_V1\0"
)
PRIOR_DEVELOPMENT_REPORT_FILE_NAME = (
    "reception-room-e57-geometry-edge-development-2026-07-14.json"
)
PRIOR_DEVELOPMENT_REPORT_SIZE_BYTES = 7_247_706
PRIOR_DEVELOPMENT_REPORT_SHA256 = (
    "d8307d8547ba2bce44f87a3173497a83762f98c994e13af272d95c21a24f941a"
)
PRIOR_DEVELOPMENT_REPORT_PAYLOAD_SHA256 = (
    "cf5c21ff0c1a2ba243c4a51bb8f04d945b03511e4c02de002619f375e0321591"
)
V2_REPORT_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_E57_LIDAR_IMAGE_REPROJECTION_V1\0"
V2_REPORT_SCHEMA_VERSION = "omnitwin.reception.e57-lidar-image-reprojection.v1"
MAX_PROTOCOL_BYTES = 8 * 1024 * 1024
MAX_V2_REPORT_BYTES = 64 * 1024 * 1024
MAX_DEVELOPMENT_REPORT_BYTES = 256 * 1024 * 1024
MAX_TOOL_SOURCE_BYTES = 5 * 1024 * 1024

DEVELOPMENT_SCAN_IDS = (122, 124, 126, 130, 134, 140, 144)
HELD_OUT_SCAN_IDS = (
    123,
    125,
    127,
    128,
    129,
    131,
    132,
    133,
    135,
    136,
    137,
    138,
    139,
    141,
    142,
    143,
)
ALL_PROTOCOL_SCAN_IDS = tuple(sorted(DEVELOPMENT_SCAN_IDS + HELD_OUT_SCAN_IDS))
HELD_OUT_SCOPE_MEANING = (
    "Held out only from development and threshold tuning of this XYZ-only "
    "LiDAR-geometry-versus-embedded-JPEG-edge metric. These scans are "
    "metric-held-out, not globally unseen: they were included in earlier v2 "
    "point-colour/orientation work and visual inspection."
)
DEVELOPMENT_EVIDENCE_PROVENANCE_LIMIT = (
    "This validator proves internal arithmetic consistency and exact byte/code "
    "binding. Because authority is none and there is no trusted signature, a "
    "coherent synthetic report could still be fabricated and re-digested. This "
    "local protocol does not prove who ran it or that its evidence came from the E57."
)

ANALYSIS_SIZE = 512
LOCAL_SHIFT_OFFSETS_PIXELS = (-4, 0, 4)
MINIMUM_PHOTO_EDGE_PIXELS = 1
GEOMETRY_EDGE_SPATIAL_GRID_SIZE = 8
# The old >=24-cell result remains visible as a diagnostic, but it no longer
# decides the v2 result.  V2 requires fewer cells only when they are actually
# spread across the image in both axes and all four quadrants.
LEGACY_MINIMUM_WELL_SUPPORTED_GEOMETRY_EDGE_GRID_CELLS_DIAGNOSTIC = 24
MINIMUM_DISTRIBUTED_GEOMETRY_EDGE_GRID_CELLS = 12
MINIMUM_DISTRIBUTED_GEOMETRY_EDGE_GRID_ROWS = 3
MINIMUM_DISTRIBUTED_GEOMETRY_EDGE_GRID_COLUMNS = 3
REQUIRED_DISTRIBUTED_GEOMETRY_EDGE_GRID_QUADRANTS = 4
MINIMUM_GEOMETRY_EDGE_PIXELS_PER_OCCUPIED_GRID_CELL = 25
MINIMUM_GEOMETRY_EDGE_DENSITY = 0.02
MAXIMUM_GEOMETRY_EDGE_DENSITY = 0.15
MINIMUM_PHOTO_EDGE_DENSITY = 0.02
MAXIMUM_PHOTO_EDGE_DENSITY = 0.15
SOURCE_ORGANIZED_ROW_COUNT = 1800
SOURCE_ORGANIZED_COLUMN_COUNT = 3600
SPATIAL_NULL_OFFSET_VALUES = tuple(range(-75, 76, 10))
SPATIAL_NULL_OFFSETS = tuple(
    (dx, dy)
    for dy in SPATIAL_NULL_OFFSET_VALUES
    for dx in SPATIAL_NULL_OFFSET_VALUES
    if max(abs(dx), abs(dy)) > 15
)
SPATIAL_NULL_ROI = (85, 427, 85, 427)  # y0, y1, x0, x1
SPATIAL_NULL_MINIMUM_GEOMETRY_PIXELS = 2000
SPATIAL_NULL_MINIMUM_GEOMETRY_FRACTION = 0.25
SPATIAL_NULL_COVERAGE_GRID_SIZE = 6
SPATIAL_NULL_MINIMUM_PIXELS_PER_COVERED_CELL = 25
SPATIAL_NULL_MINIMUM_COVERED_CELLS = 12
SPATIAL_NULL_MINIMUM_SPANNED_ROWS = 3
SPATIAL_NULL_MINIMUM_SPANNED_COLUMNS = 3
SPATIAL_NULL_MAXIMUM_TAIL_COUNT = 1
SPATIAL_NULL_Q99_SORTED_INDEX = 237
SPATIAL_NULL_MINIMUM_GAP_FRACTION = 0.02

DEFAULT_MINIMUM_PRIMARY_MATCHED_FRACTION_TO_AVOID_REJECT = 0.30
DEFAULT_MINIMUM_PRIMARY_MATCHED_FRACTION_FOR_PASS = 0.35
DEFAULT_MINIMUM_MARGIN_OVER_BEST_ALTERNATIVE = 0.02
DEFAULT_MINIMUM_SHIFTED_MARGIN_OVER_BEST_ALTERNATIVE = 0.02
DEFAULT_MINIMUM_GEOMETRY_EDGE_PIXELS = 5000
DEFAULT_MINIMUM_OCCUPIED_PIXEL_FRACTION = 0.45
SHIFT_SENSITIVE_DIAGNOSTIC_GAIN = 0.01

POINT_FIELDS_REQUESTED = (
    "cartesianX",
    "cartesianY",
    "cartesianZ",
    "rowIndex",
    "columnIndex",
)
POINT_COLOUR_FIELD_NAMES = ("colorRed", "colorGreen", "colorBlue")

PASS_DISCRETE_GEOMETRY_ORIENTATION = "PASS_DISCRETE_GEOMETRY_ORIENTATION"
PASS = PASS_DISCRETE_GEOMETRY_ORIENTATION
REJECT_GEOMETRY_MISMATCH = "REJECT_GEOMETRY_MISMATCH"
BLOCKED_INSUFFICIENT_GEOMETRY = "BLOCKED_INSUFFICIENT_GEOMETRY"
BLOCKED_AMBIGUOUS = "BLOCKED_AMBIGUOUS"

EXACT_PHASE_DIAGNOSTIC = "EXACT_PHASE_DIAGNOSTIC"
EXACT_PHASE_UNIQUE = "UNIQUE"
EXACT_PHASE_NONUNIQUE = "NONUNIQUE"
EXACT_PHASE_UNASSESSABLE = "UNASSESSABLE"

if len(SPATIAL_NULL_OFFSETS) != 240:
    raise RuntimeError("spatial-null offset family must contain exactly 240 offsets")
if set(DEVELOPMENT_SCAN_IDS).intersection(HELD_OUT_SCAN_IDS):
    raise RuntimeError("development and held-out scan IDs must be disjoint")
if len(ALL_PROTOCOL_SCAN_IDS) != 23:
    raise RuntimeError("the frozen scan split must contain exactly 23 stations")


def _spatial_null_offset_digest() -> str:
    return hashlib.sha256(
        b"OMNITWIN_RECEPTION_GEOMETRY_SPATIAL_NULL_OFFSETS_V1\0"
        + _canonical_json_bytes([list(offset) for offset in SPATIAL_NULL_OFFSETS])
    ).hexdigest()


def _round(value: float, digits: int = 6) -> float:
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
    code: str,
) -> None:
    expected = payload.get("payloadSha256")
    if not isinstance(expected, str) or len(expected) != 64:
        fail(code, f"{label} has no valid payloadSha256")
    without_digest = dict(payload)
    without_digest.pop("payloadSha256", None)
    actual = hashlib.sha256(
        domain + _canonical_json_bytes(without_digest)
    ).hexdigest()
    if not hmac.compare_digest(expected.lower(), actual):
        fail(code, f"{label} payload digest does not verify")


def _read_json_with_receipt(
    path: Path,
    *,
    label: str,
    maximum_bytes: int,
    invalid_code: str,
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
        decoded = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        fail(invalid_code, f"could not parse {label}: {error}")
    if not isinstance(decoded, dict):
        fail(invalid_code, f"{label} must contain one JSON object")
    return (
        decoded,
        {
            "fileName": path.name,
            "sizeBytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        },
        before,
    )


def _expected_prior_development_receipt() -> dict[str, Any]:
    return {
        "fileName": PRIOR_DEVELOPMENT_REPORT_FILE_NAME,
        "sizeBytes": PRIOR_DEVELOPMENT_REPORT_SIZE_BYTES,
        "sha256": PRIOR_DEVELOPMENT_REPORT_SHA256,
        "schemaVersion": PRIOR_DEVELOPMENT_REPORT_SCHEMA_VERSION,
        "payloadSha256": PRIOR_DEVELOPMENT_REPORT_PAYLOAD_SHA256,
    }


def _read_and_validate_prior_development_report(
    path: Path,
) -> tuple[dict[str, Any], dict[str, Any], os.stat_result]:
    """Read and exact-bind the failed v1 development evidence.

    V2 is a reviewed post-development rule change.  Every v2 command must
    therefore carry the exact failed v1 bytes forward instead of silently
    replacing or forgetting the evidence that motivated the revision.
    """

    report, file_receipt, before = _read_json_with_receipt(
        path,
        label="prior v1 geometry-edge development report",
        maximum_bytes=MAX_DEVELOPMENT_REPORT_BYTES,
        invalid_code="INVALID_PRIOR_DEVELOPMENT_REPORT",
    )
    actual_receipt = {
        **file_receipt,
        "schemaVersion": report.get("schemaVersion"),
        "payloadSha256": report.get("payloadSha256"),
    }
    if actual_receipt != _expected_prior_development_receipt():
        fail(
            "PRIOR_DEVELOPMENT_REPORT_MISMATCH",
            "prior development evidence is missing, altered, renamed, or substituted",
        )
    _verify_payload_digest(
        report,
        PRIOR_DEVELOPMENT_REPORT_DIGEST_DOMAIN,
        label="prior v1 geometry-edge development report",
        code="INVALID_PRIOR_DEVELOPMENT_REPORT_DIGEST",
    )
    return report, actual_receipt, before


def _method_revision_record() -> dict[str, Any]:
    """Return the explicit, frozen explanation for the reviewed v2 change."""

    return {
        "revision": "v2",
        "postDevelopmentRuleChange": True,
        "priorV1DevelopmentReportPassed": False,
        "priorV1ResultFacts": {
            "imageCount": 42,
            "unshiftedPrimaryRankOneCount": 42,
            "shiftedPrimaryRankOneCount": 42,
            "exactPhaseDiagnosticStatusCounts": {
                EXACT_PHASE_UNIQUE: 30,
                EXACT_PHASE_NONUNIQUE: 6,
                EXACT_PHASE_UNASSESSABLE: 6,
            },
            "legacyFullImageCoverageBlockerCount": 1,
            "legacyFullImageCoverageBlocker": {
                "scanId": 134,
                "name": "Skybox 0",
                "supportedCellCount": 22,
                "legacyRequiredCellCount": 24,
            },
        },
        "whyV1DidNotPass": (
            "V1 treated the 240-offset exact-pixel-placement check as a face-"
            "direction gate, and it also required at least 24 supported 8x8 cells. "
            "That produced 30 UNIQUE, 6 NONUNIQUE, and 6 UNASSESSABLE exact-phase "
            "results; scan 134 Skybox 0 was the only face below the separate "
            "full-image 24-cell coverage rule, with 22 cells."
        ),
        "constructMismatch": (
            "The 240-offset check asks whether the same geometry edges prefer one "
            "exact pixel location over far-away translated locations. That is a "
            "pixel-location uniqueness question, not a test of which cube direction "
            "or mirror is correct. V2 therefore reports it as EXACT_PHASE_DIAGNOSTIC "
            "and never lets it change a discrete-orientation result."
        ),
        "coverageRevision": (
            "V2 replaces the count-only 24-cell veto with distributed support: at "
            "least 12 supported cells spanning at least 3 rows, at least 3 columns, "
            "and all 4 image quadrants. The old >=24-cell answer remains visible as "
            "a diagnostic."
        ),
        "spatialNullConstantsChanged": False,
        "spatialNullThresholdsLoosened": False,
        "independentImagesClaimed": False,
        "pValueClaimed": False,
        "continuousCalibrationValidated": False,
    }


def _development_tuning_note() -> dict[str, Any]:
    return {
        "shiftGainAbove001IsDiagnosticOnly": True,
        "exactPhaseDiagnosticAffectsDiscreteOrientationPass": False,
        "legacy24CellCoverageAffectsDiscreteOrientationPass": False,
        "continuousCalibrationValidated": False,
        "plainLanguage": (
            "A small image shift can improve some correct-face scores, so that "
            "gain stays visible but never decides the result. M0, Ms, and the "
            "distributed full-image geometry support decide discrete orientation. "
            "The 240-offset check reports exact pixel-location uniqueness only."
        ),
    }


def _source_file_record(role: str, path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    stat = _safe_regular_file(path, role, MAX_TOOL_SOURCE_BYTES)
    digest = _sha256_file(path, stat, MAX_TOOL_SOURCE_BYTES)
    public = {
        "role": role,
        "fileName": path.name,
        "sizeBytes": stat.st_size,
        "sha256": digest,
    }
    private = {**public, "path": path, "stat": stat}
    return public, private


def _implementation_source_paths() -> dict[str, Path]:
    tool_dir = Path(__file__).resolve().parent
    return {
        "geometryAuditProtocolTool": Path(__file__).resolve(),
        "geometryEdgeCoreDependency": Path(geometry.__file__).resolve(),
        "roomAuditSafetyDependency": Path(room_audit.__file__).resolve(),
        "geometryAuditProtocolTests": (
            tool_dir / "tests" / "test_audit_e57_geometry_edge_protocol.py"
        ),
        "geometryEdgeCoreTests": (
            tool_dir / "tests" / "test_audit_e57_geometry_edges.py"
        ),
    }


def _capture_implementation_sources() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    public: list[dict[str, Any]] = []
    private: list[dict[str, Any]] = []
    for role, path in _implementation_source_paths().items():
        public_row, private_row = _source_file_record(role, path)
        public.append(public_row)
        private.append(private_row)
    return public, private


def _verify_captured_files_unchanged(captures: Sequence[Mapping[str, Any]]) -> None:
    for capture in captures:
        path = Path(capture["path"])
        after = _safe_regular_file(
            path,
            str(capture["role"]),
            MAX_TOOL_SOURCE_BYTES,
        )
        if not _same_file_identity(capture["stat"], after):
            fail(
                "TOOL_CHANGED_DURING_AUDIT",
                f"{path.name} changed while the audit was running",
            )
        actual = _sha256_file(path, after, MAX_TOOL_SOURCE_BYTES)
        if actual != capture["sha256"]:
            fail(
                "TOOL_CHANGED_DURING_AUDIT",
                f"{path.name} content changed while the audit was running",
            )


def _dependency_versions() -> dict[str, str]:
    try:
        pye57_version = importlib.metadata.version("pye57")
    except importlib.metadata.PackageNotFoundError:
        pye57_version = "unavailable"
    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "pillow": getattr(Image, "__version__", "unknown"),
        "pye57": pye57_version,
    }


def _method_constants() -> dict[str, Any]:
    return {
        "analysisImageWidth": ANALYSIS_SIZE,
        "analysisImageHeight": ANALYSIS_SIZE,
        "decimationStride": geometry.DECIMATION_STRIDE,
        "minimumValidRangeMetres": geometry.MIN_VALID_RANGE_METRES,
        "normalNeighbourRelativeGate": geometry.RANGE_GATE_RELATIVE,
        "normalNeighbourAbsoluteGateMetres": geometry.RANGE_GATE_ABSOLUTE_METRES,
        "minimumProjectionDepthMetres": geometry.MIN_POSITIVE_DEPTH_METRES,
        "maximumProjectionDepthMetres": geometry.MAX_POSITIVE_DEPTH_METRES,
        "geometryEdgeFraction": geometry.GEOMETRY_EDGE_FRACTION,
        "geometryDilationIterations": geometry.GEOMETRY_DILATION_ITERATIONS,
        "photoGaussianSigma": geometry.PHOTO_GAUSSIAN_SIGMA,
        "photoEdgeFraction": geometry.PHOTO_EDGE_FRACTION,
        "edgeBorderPixels": geometry.EDGE_BORDER_PIXELS,
        "photoMatchRadiusPixels": geometry.PHOTO_MATCH_RADIUS_PIXELS,
        "localShiftOffsetsPixels": list(LOCAL_SHIFT_OFFSETS_PIXELS),
        "localShiftBoundaryRule": "zero_fill_no_wrap_common_geometry_support",
        "shiftSensitiveDiagnosticGain": SHIFT_SENSITIVE_DIAGNOSTIC_GAIN,
        "geometryEdgeSpatialGridSize": GEOMETRY_EDGE_SPATIAL_GRID_SIZE,
        "minimumGeometryEdgePixelsPerCoveredGridCell": (
            MINIMUM_GEOMETRY_EDGE_PIXELS_PER_OCCUPIED_GRID_CELL
        ),
        "distributedGeometryEdgeSupport": {
            "minimumSupportedCells": (
                MINIMUM_DISTRIBUTED_GEOMETRY_EDGE_GRID_CELLS
            ),
            "minimumSupportedRows": (
                MINIMUM_DISTRIBUTED_GEOMETRY_EDGE_GRID_ROWS
            ),
            "minimumSupportedColumns": (
                MINIMUM_DISTRIBUTED_GEOMETRY_EDGE_GRID_COLUMNS
            ),
            "requiredQuadrants": (
                REQUIRED_DISTRIBUTED_GEOMETRY_EDGE_GRID_QUADRANTS
            ),
            "quadrantOrder": [
                "TOP_LEFT",
                "TOP_RIGHT",
                "BOTTOM_LEFT",
                "BOTTOM_RIGHT",
            ],
        },
        "legacyMinimum24SupportedCellsDiagnosticOnly": True,
        "legacyMinimumSupportedCells": (
            LEGACY_MINIMUM_WELL_SUPPORTED_GEOMETRY_EDGE_GRID_CELLS_DIAGNOSTIC
        ),
        "sourceOrganizedGridRows": SOURCE_ORGANIZED_ROW_COUNT,
        "sourceOrganizedGridColumns": SOURCE_ORGANIZED_COLUMN_COUNT,
        "indexBoundsMaximumInterpretation": "exclusive_grid_size_for_this_frozen_E57_source",
        "spatialNull": {
            "offsetsDxDy": [list(offset) for offset in SPATIAL_NULL_OFFSETS],
            "offsetOrder": "dy_outer_dx_inner",
            "offsetSha256": _spatial_null_offset_digest(),
            "roiY0Y1X0X1": list(SPATIAL_NULL_ROI),
            "minimumGeometryPixelsInRoi": SPATIAL_NULL_MINIMUM_GEOMETRY_PIXELS,
            "minimumRoiFractionOfFullGeometryEdges": (
                SPATIAL_NULL_MINIMUM_GEOMETRY_FRACTION
            ),
            "coverageGridSize": SPATIAL_NULL_COVERAGE_GRID_SIZE,
            "minimumPixelsPerCoveredCell": (
                SPATIAL_NULL_MINIMUM_PIXELS_PER_COVERED_CELL
            ),
            "minimumCoveredCells": SPATIAL_NULL_MINIMUM_COVERED_CELLS,
            "minimumSpannedRows": SPATIAL_NULL_MINIMUM_SPANNED_ROWS,
            "minimumSpannedColumns": SPATIAL_NULL_MINIMUM_SPANNED_COLUMNS,
            "maximumTailCount": SPATIAL_NULL_MAXIMUM_TAIL_COUNT,
            "q99SortedNullHitIndexZeroBased": SPATIAL_NULL_Q99_SORTED_INDEX,
            "minimumObservedMinusQ99Fraction": (
                SPATIAL_NULL_MINIMUM_GAP_FRACTION
            ),
            "decisionRole": EXACT_PHASE_DIAGNOSTIC,
            "decisionTarget": "pixel_location_uniqueness",
            "allowedStatuses": [
                EXACT_PHASE_UNIQUE,
                EXACT_PHASE_NONUNIQUE,
                EXACT_PHASE_UNASSESSABLE,
            ],
            "affectsDiscreteOrientationPass": False,
            "label": "exact_phase_diagnostic_not_a_p_value",
        },
        "candidateCountPerImage": len(geometry.CANDIDATES),
        "baseContinuousCoordinateFrameCountPerScan": len(
            geometry.FIXED_V2_MAPPING
        ),
        "independentCandidateRasterizationCountPerScan": len(geometry.CANDIDATES),
    }


def _threshold_record(
    *,
    minimum_primary_matched_fraction_to_avoid_reject: float,
    minimum_primary_matched_fraction_for_pass: float,
    minimum_margin_over_best_alternative: float,
    minimum_shifted_margin_over_best_alternative: float,
    minimum_geometry_edge_pixels: int,
    minimum_occupied_pixel_fraction: float,
) -> dict[str, Any]:
    numeric = (
        minimum_primary_matched_fraction_to_avoid_reject,
        minimum_primary_matched_fraction_for_pass,
        minimum_margin_over_best_alternative,
        minimum_shifted_margin_over_best_alternative,
        minimum_occupied_pixel_fraction,
    )
    if not all(math.isfinite(float(value)) for value in numeric):
        fail("INVALID_THRESHOLD", "all fractional thresholds must be finite")
    if not (
        0.0
        <= minimum_primary_matched_fraction_to_avoid_reject
        <= minimum_primary_matched_fraction_for_pass
        <= 1.0
    ):
        fail(
            "INVALID_THRESHOLD",
            "primary score cutoffs must satisfy 0 <= reject cutoff <= PASS cutoff <= 1",
        )
    if not 0.0 <= minimum_margin_over_best_alternative <= 1.0:
        fail("INVALID_THRESHOLD", "minimum alternative margin must be in [0,1]")
    if not 0.0 <= minimum_shifted_margin_over_best_alternative <= 1.0:
        fail("INVALID_THRESHOLD", "minimum shifted alternative margin must be in [0,1]")
    if (
        not isinstance(minimum_geometry_edge_pixels, int)
        or isinstance(minimum_geometry_edge_pixels, bool)
        or minimum_geometry_edge_pixels <= 0
    ):
        fail("INVALID_THRESHOLD", "minimum geometry edge pixels must be positive")
    if not 0.0 <= minimum_occupied_pixel_fraction <= 1.0:
        fail("INVALID_THRESHOLD", "minimum occupied fraction must be in [0,1]")
    return {
        "minimumPrimaryMatchedFractionToAvoidReject": _round(
            minimum_primary_matched_fraction_to_avoid_reject, 9
        ),
        "minimumPrimaryMatchedFractionForPass": _round(
            minimum_primary_matched_fraction_for_pass, 9
        ),
        "minimumMarginOverBestAlternative": _round(
            minimum_margin_over_best_alternative, 9
        ),
        "minimumShiftedMarginOverBestAlternative": _round(
            minimum_shifted_margin_over_best_alternative, 9
        ),
        "minimumGeometryEdgePixels": minimum_geometry_edge_pixels,
        "minimumOccupiedPixelFraction": _round(
            minimum_occupied_pixel_fraction, 9
        ),
        "minimumPhotoEdgePixels": MINIMUM_PHOTO_EDGE_PIXELS,
        "minimumDistributedGeometryEdgeGridCells": (
            MINIMUM_DISTRIBUTED_GEOMETRY_EDGE_GRID_CELLS
        ),
        "minimumDistributedGeometryEdgeGridRows": (
            MINIMUM_DISTRIBUTED_GEOMETRY_EDGE_GRID_ROWS
        ),
        "minimumDistributedGeometryEdgeGridColumns": (
            MINIMUM_DISTRIBUTED_GEOMETRY_EDGE_GRID_COLUMNS
        ),
        "requiredDistributedGeometryEdgeGridQuadrants": (
            REQUIRED_DISTRIBUTED_GEOMETRY_EDGE_GRID_QUADRANTS
        ),
        "legacyMinimumWellSupportedGeometryEdgeGridCellsDiagnosticOnly": (
            LEGACY_MINIMUM_WELL_SUPPORTED_GEOMETRY_EDGE_GRID_CELLS_DIAGNOSTIC
        ),
        "minimumGeometryEdgeDensity": MINIMUM_GEOMETRY_EDGE_DENSITY,
        "maximumGeometryEdgeDensity": MAXIMUM_GEOMETRY_EDGE_DENSITY,
        "minimumPhotoEdgeDensity": MINIMUM_PHOTO_EDGE_DENSITY,
        "maximumPhotoEdgeDensity": MAXIMUM_PHOTO_EDGE_DENSITY,
        "requiredPrimaryRankAmong48": 1,
    }


def _validate_v2_report(
    report: Mapping[str, Any],
    *,
    source_size: int,
    source_sha256: str,
) -> None:
    if report.get("schemaVersion") != V2_REPORT_SCHEMA_VERSION:
        fail("INVALID_V2_REPORT", "the colour/orientation report has the wrong schema")
    _verify_payload_digest(
        report,
        V2_REPORT_DIGEST_DOMAIN,
        label="v2 colour/orientation report",
        code="INVALID_V2_REPORT_DIGEST",
    )
    scope = report.get("scope")
    result = report.get("result")
    if not isinstance(scope, Mapping) or not isinstance(result, Mapping):
        fail("INVALID_V2_REPORT", "the v2 report has no valid scope/result objects")
    if (
        scope.get("sourceE57SizeBytes") != source_size
        or scope.get("sourceE57Sha256") != source_sha256
    ):
        fail("V2_SOURCE_MISMATCH", "the v2 report is bound to a different E57")
    if result.get("coarseDiscreteRigAxisMappingPassesInternalColourGate") is not True:
        fail("V2_GATE_NOT_PASSED", "the frozen v2 colour/orientation gate did not pass")
    mapping = result.get("fixedMappingBySkyboxName")
    if mapping != geometry.FIXED_V2_MAPPING:
        fail("V2_MAPPING_MISMATCH", "the v2 report mapping differs from fixed-v2")


def _development_evidence_fail(message: str) -> None:
    fail("INVALID_DEVELOPMENT_EVIDENCE", message)


def _evidence_int(value: Any, label: str, *, minimum: int = 0) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        _development_evidence_fail(f"{label} must be an integer >= {minimum}")
    return int(value)


def _evidence_float(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _development_evidence_fail(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        _development_evidence_fail(f"{label} must be finite")
    return result


def _expect_evidence(actual: Any, expected: Any, label: str) -> None:
    def equal_with_strict_booleans(left: Any, right: Any) -> bool:
        if isinstance(right, bool):
            return isinstance(left, bool) and left is right
        if isinstance(right, Mapping):
            return (
                isinstance(left, Mapping)
                and set(left) == set(right)
                and all(
                    equal_with_strict_booleans(left[key], value)
                    for key, value in right.items()
                )
            )
        if isinstance(right, list):
            return (
                isinstance(left, list)
                and len(left) == len(right)
                and all(
                    equal_with_strict_booleans(left_value, right_value)
                    for left_value, right_value in zip(left, right, strict=True)
                )
            )
        return left == right

    if not equal_with_strict_booleans(actual, expected):
        _development_evidence_fail(
            f"{label} is inconsistent: expected {expected!r}, got {actual!r}"
        )


def _validate_alignment_metric_record(
    record: Mapping[str, Any],
    *,
    label: str,
    expected_photo_edge_count: int | None = None,
    expected_geometry_edge_count: int | None = None,
) -> dict[str, Any]:
    geometry_count = _evidence_int(
        record.get("geometryEdgePixelCount"),
        f"{label}.geometryEdgePixelCount",
    )
    photo_count = _evidence_int(
        record.get("photoEdgePixelCount"),
        f"{label}.photoEdgePixelCount",
    )
    matched_count = _evidence_int(
        record.get("matchedGeometryEdgePixelCount"),
        f"{label}.matchedGeometryEdgePixelCount",
    )
    if matched_count > geometry_count:
        _development_evidence_fail(f"{label} matched count exceeds geometry count")
    if geometry_count > ANALYSIS_SIZE * ANALYSIS_SIZE:
        _development_evidence_fail(f"{label} geometry count exceeds image area")
    if photo_count > ANALYSIS_SIZE * ANALYSIS_SIZE:
        _development_evidence_fail(f"{label} photo count exceeds image area")
    if expected_photo_edge_count is not None and photo_count != expected_photo_edge_count:
        _development_evidence_fail(f"{label} photo-edge count changed")
    if (
        expected_geometry_edge_count is not None
        and geometry_count != expected_geometry_edge_count
    ):
        _development_evidence_fail(f"{label} geometry support changed")
    expected_fraction = (
        _round(matched_count / geometry_count, 9) if geometry_count else None
    )
    _expect_evidence(
        record.get("matchedFraction"), expected_fraction, f"{label}.matchedFraction"
    )
    _expect_evidence(
        record.get("geometryEdgeDensity"),
        _round(geometry_count / (ANALYSIS_SIZE * ANALYSIS_SIZE), 9),
        f"{label}.geometryEdgeDensity",
    )
    _expect_evidence(
        record.get("photoEdgeDensity"),
        _round(photo_count / (ANALYSIS_SIZE * ANALYSIS_SIZE), 9),
        f"{label}.photoEdgeDensity",
    )
    _expect_evidence(
        record.get("matchRadiusPixels"),
        geometry.PHOTO_MATCH_RADIUS_PIXELS,
        f"{label}.matchRadiusPixels",
    )
    return {
        "geometryCount": geometry_count,
        "photoCount": photo_count,
        "matchedCount": matched_count,
        "matchedFraction": expected_fraction,
    }


def _validate_spatial_null_report(
    evidence: Mapping[str, Any],
    *,
    full_geometry_edge_count: int,
    label: str,
) -> str:
    _expect_evidence(
        evidence.get("label"),
        "exact_phase_diagnostic_not_a_p_value",
        f"{label}.label",
    )
    _expect_evidence(
        evidence.get("decisionRole"),
        EXACT_PHASE_DIAGNOSTIC,
        f"{label}.decisionRole",
    )
    _expect_evidence(
        evidence.get("decisionTarget"),
        "pixel_location_uniqueness",
        f"{label}.decisionTarget",
    )
    _expect_evidence(
        evidence.get("affectsDiscreteOrientationPass"),
        False,
        f"{label}.affectsDiscreteOrientationPass",
    )
    _expect_evidence(
        evidence.get("continuousCalibrationValidated"),
        False,
        f"{label}.continuousCalibrationValidated",
    )
    _expect_evidence(
        evidence.get("roiY0Y1X0X1"), list(SPATIAL_NULL_ROI), f"{label}.roi"
    )
    _expect_evidence(
        evidence.get("coverageGridSize"),
        SPATIAL_NULL_COVERAGE_GRID_SIZE,
        f"{label}.coverageGridSize",
    )
    _expect_evidence(
        evidence.get("coverageCellSizePixels"), 57, f"{label}.coverageCellSize"
    )
    raw_counts = evidence.get("coverageCellGeometryPixelCounts")
    if (
        not isinstance(raw_counts, list)
        or len(raw_counts) != SPATIAL_NULL_COVERAGE_GRID_SIZE
        or any(
            not isinstance(row, list)
            or len(row) != SPATIAL_NULL_COVERAGE_GRID_SIZE
            for row in raw_counts
        )
    ):
        _development_evidence_fail(f"{label} coverage matrix must be 6 by 6")
    cell_counts = np.asarray(
        [
            [_evidence_int(value, f"{label}.coverage[{row}][{column}]") for column, value in enumerate(values)]
            for row, values in enumerate(raw_counts)
        ],
        dtype=np.int64,
    )
    geometry_in_roi = int(np.sum(cell_counts))
    if geometry_in_roi > full_geometry_edge_count:
        _development_evidence_fail(f"{label} ROI geometry count exceeds full count")
    _expect_evidence(
        evidence.get("geometryPixelsInRoi"), geometry_in_roi, f"{label}.geometryN"
    )
    _expect_evidence(
        evidence.get("fullGeometryEdgePixels"),
        full_geometry_edge_count,
        f"{label}.fullGeometryEdges",
    )
    roi_fraction = (
        geometry_in_roi / full_geometry_edge_count
        if full_geometry_edge_count
        else 0.0
    )
    _expect_evidence(
        evidence.get("roiFractionOfFullGeometryEdges"),
        _round(roi_fraction, 9),
        f"{label}.roiFraction",
    )
    supported = cell_counts >= SPATIAL_NULL_MINIMUM_PIXELS_PER_COVERED_CELL
    covered_cells = int(np.count_nonzero(supported))
    spanned_rows = int(np.count_nonzero(np.any(supported, axis=1)))
    spanned_columns = int(np.count_nonzero(np.any(supported, axis=0)))
    _expect_evidence(
        evidence.get("coveredCellCountAtLeast25Pixels"),
        covered_cells,
        f"{label}.coveredCells",
    )
    _expect_evidence(
        evidence.get("spannedSupportedGridRows"),
        spanned_rows,
        f"{label}.spannedRows",
    )
    _expect_evidence(
        evidence.get("spannedSupportedGridColumns"),
        spanned_columns,
        f"{label}.spannedColumns",
    )
    checks = {
        "minimumGeometryPixelsInRoi": (
            geometry_in_roi >= SPATIAL_NULL_MINIMUM_GEOMETRY_PIXELS
        ),
        "minimumRoiFractionOfFullGeometryEdges": (
            roi_fraction >= SPATIAL_NULL_MINIMUM_GEOMETRY_FRACTION
        ),
        "minimumCoveredCells": covered_cells >= SPATIAL_NULL_MINIMUM_COVERED_CELLS,
        "minimumSpannedRows": spanned_rows >= SPATIAL_NULL_MINIMUM_SPANNED_ROWS,
        "minimumSpannedColumns": (
            spanned_columns >= SPATIAL_NULL_MINIMUM_SPANNED_COLUMNS
        ),
    }
    _expect_evidence(
        evidence.get("assessabilityChecks"), checks, f"{label}.assessabilityChecks"
    )
    assessable = all(checks.values())
    _expect_evidence(evidence.get("assessable"), assessable, f"{label}.assessable")
    observed_hits = _evidence_int(
        evidence.get("observedHitCount"), f"{label}.observedHitCount"
    )
    if observed_hits > geometry_in_roi:
        _development_evidence_fail(f"{label} observed hits exceed N")
    _expect_evidence(
        evidence.get("observedMatchedFraction"),
        _round(observed_hits / geometry_in_roi, 9) if geometry_in_roi else None,
        f"{label}.observedMatchedFraction",
    )
    raw_null_hits = evidence.get("nullHitCountsInFrozenOffsetOrder")
    if not isinstance(raw_null_hits, list) or len(raw_null_hits) != 240:
        _development_evidence_fail(f"{label} must contain all 240 null hit counts")
    null_hits = [
        _evidence_int(value, f"{label}.nullHits[{index}]")
        for index, value in enumerate(raw_null_hits)
    ]
    if any(value > geometry_in_roi for value in null_hits):
        _development_evidence_fail(f"{label} null hits exceed N")
    _expect_evidence(evidence.get("nullOffsetCount"), 240, f"{label}.nullCount")
    _expect_evidence(
        evidence.get("nullOffsetsDxDySha256"),
        _spatial_null_offset_digest(),
        f"{label}.offsetDigest",
    )
    expected_hits_digest = hashlib.sha256(
        b"OMNITWIN_RECEPTION_GEOMETRY_SPATIAL_NULL_HITS_V1\0"
        + _canonical_json_bytes(null_hits)
    ).hexdigest()
    _expect_evidence(
        evidence.get("nullHitCountsSha256"),
        expected_hits_digest,
        f"{label}.hitDigest",
    )
    tail_count = sum(value >= observed_hits for value in null_hits)
    q99_hits = sorted(null_hits)[SPATIAL_NULL_Q99_SORTED_INDEX]
    gap_hits = observed_hits - q99_hits
    gap_fraction = gap_hits / geometry_in_roi if geometry_in_roi else None
    passes_tail = tail_count <= SPATIAL_NULL_MAXIMUM_TAIL_COUNT
    passes_gap = bool(geometry_in_roi and 50 * gap_hits >= geometry_in_roi)
    expected_values = {
        "tailCountNullHitsGreaterThanOrEqualObserved": tail_count,
        "empiricalSmoothedTailRatio": _round((1 + tail_count) / 241.0, 9),
        "q99SortedNullHitIndexZeroBased": SPATIAL_NULL_Q99_SORTED_INDEX,
        "q99NullHitCount": q99_hits,
        "observedMinusQ99HitCount": gap_hits,
        "observedMinusQ99Fraction": (
            _round(gap_fraction, 9) if gap_fraction is not None else None
        ),
        "passesTailCountAtMostOne": passes_tail,
        "passesObservedMinusQ99AtLeastTwoPercent": passes_gap,
    }
    for key, expected in expected_values.items():
        _expect_evidence(evidence.get(key), expected, f"{label}.{key}")
    if not assessable:
        diagnostic_status = EXACT_PHASE_UNASSESSABLE
    elif passes_tail and passes_gap:
        diagnostic_status = EXACT_PHASE_UNIQUE
    else:
        diagnostic_status = EXACT_PHASE_NONUNIQUE
    _expect_evidence(
        evidence.get("status"), diagnostic_status, f"{label}.status"
    )
    return diagnostic_status


def _is_lower_hex(value: Any, length: int) -> bool:
    return (
        isinstance(value, str)
        and len(value) == length
        and all(character in "0123456789abcdef" for character in value)
    )


def _expected_candidate_projection_metadata(candidate_id: str) -> dict[str, Any]:
    declared = geometry.CANDIDATE_BY_ID[candidate_id]
    target_forward = np.asarray(declared["forward"], dtype=np.float64)
    target_right = np.asarray(declared["right"], dtype=np.float64)
    matches: list[tuple[str, int]] = []
    for skybox_name, base_id in geometry.FIXED_V2_MAPPING.items():
        base = geometry.CANDIDATE_BY_ID[base_id]
        if not np.array_equal(np.asarray(base["forward"]), target_forward):
            continue
        base_right = np.asarray(base["right"], dtype=np.float64)
        base_down = np.asarray(base["down"], dtype=np.float64)
        rotated_rights = (
            base_right,
            base_down,
            -base_right,
            -base_down,
        )
        for quarter_turns, right in enumerate(rotated_rights):
            if np.array_equal(right, target_right):
                matches.append((skybox_name, quarter_turns))
    if len(matches) != 1:
        raise RuntimeError("candidate does not map to one frozen continuous base frame")
    skybox_name, quarter_turns = matches[0]
    return {
        "sourceBaseSkyboxName": skybox_name,
        "quarterTurnsCounterClockwise": quarter_turns,
        "verticalMirrorAfterRotation": bool(declared["mirrored"]),
        "mirrored": bool(declared["mirrored"]),
        "basisDeterminant": float(declared["basisDeterminant"]),
    }


def _recompute_development_image_row(
    row: Mapping[str, Any],
    *,
    thresholds: Mapping[str, Any],
    label: str,
) -> dict[str, Any]:
    scan_id = _evidence_int(row.get("scanId"), f"{label}.scanId")
    if scan_id not in DEVELOPMENT_SCAN_IDS:
        _development_evidence_fail(f"{label} has a non-development scan ID")
    _expect_evidence(row.get("evaluationRole"), "development", f"{label}.role")
    data3d_guid = row.get("data3DGuid")
    image2d_guid = row.get("image2DGuid")
    if not _is_lower_hex(data3d_guid, 32):
        _development_evidence_fail(f"{label}.data3DGuid must be 32 lowercase hex characters")
    if not _is_lower_hex(image2d_guid, 32):
        _development_evidence_fail(f"{label}.image2DGuid must be 32 lowercase hex characters")
    _evidence_int(row.get("image2DIndex"), f"{label}.image2DIndex")
    jpeg = row.get("jpeg")
    if not isinstance(jpeg, Mapping) or set(jpeg) != {
        "sha256",
        "sizeBytes",
        "width",
        "height",
    }:
        _development_evidence_fail(f"{label}.jpeg identity is incomplete")
    if not _is_lower_hex(jpeg.get("sha256"), 64):
        _development_evidence_fail(f"{label}.jpeg.sha256 must be 64 lowercase hex characters")
    jpeg_size = _evidence_int(jpeg.get("sizeBytes"), f"{label}.jpeg.sizeBytes", minimum=1)
    if jpeg_size > MAX_IMAGE_BYTES:
        _development_evidence_fail(f"{label}.jpeg is larger than the reader permits")
    _expect_evidence(jpeg.get("width"), 4096, f"{label}.jpeg.width")
    _expect_evidence(jpeg.get("height"), 4096, f"{label}.jpeg.height")
    _expect_evidence(
        row.get("declaredSourceIntrinsics"),
        {"fx": 2048.0, "fy": 2048.0, "cx": 2048.0, "cy": 2048.0},
        f"{label}.declaredSourceIntrinsics",
    )
    _expect_evidence(
        row.get("analysisIntrinsics"),
        {
            "fx": 256.0,
            "fy": 256.0,
            "cx": 256.0,
            "cy": 256.0,
            "width": ANALYSIS_SIZE,
            "height": ANALYSIS_SIZE,
        },
        f"{label}.analysisIntrinsics",
    )
    skybox_name = str(row.get("name"))
    if skybox_name not in geometry.FIXED_V2_MAPPING:
        _development_evidence_fail(f"{label} has an invalid Skybox name")
    primary_id = geometry.FIXED_V2_MAPPING[skybox_name]
    candidate_rows = row.get("candidateComparisons")
    if not isinstance(candidate_rows, list) or len(candidate_rows) != 48:
        _development_evidence_fail(f"{label} must contain all 48 candidate rows")
    candidate_ids: list[str] = []
    for candidate_index, candidate in enumerate(candidate_rows):
        if not isinstance(candidate, Mapping):
            _development_evidence_fail(
                f"{label} candidate {candidate_index} is not an object"
            )
        candidate_ids.append(str(candidate.get("candidateId")))
    if len(set(candidate_ids)) != 48 or set(candidate_ids) != set(
        geometry.CANDIDATE_BY_ID
    ):
        _development_evidence_fail(f"{label} candidate IDs are not the exact family")
    validated_by_id: dict[str, dict[str, Any]] = {}
    shared_photo_count: int | None = None
    projected_counts_by_base: dict[str, set[int]] = {
        skybox_name: set() for skybox_name in geometry.FIXED_V2_MAPPING
    }
    for candidate in candidate_rows:
        candidate_id = str(candidate["candidateId"])
        metrics = _validate_alignment_metric_record(
            candidate,
            label=f"{label}.{candidate_id}",
            expected_photo_edge_count=shared_photo_count,
        )
        if shared_photo_count is None:
            shared_photo_count = int(metrics["photoCount"])
        visible_count = _evidence_int(
            candidate.get("visiblePixelCount"), f"{label}.{candidate_id}.visible"
        )
        if visible_count > ANALYSIS_SIZE * ANALYSIS_SIZE:
            _development_evidence_fail(f"{label}.{candidate_id} visible count exceeds image area")
        projected_count = _evidence_int(
            candidate.get("projectedInputCount"),
            f"{label}.{candidate_id}.projectedInputCount",
        )
        if visible_count > projected_count:
            _development_evidence_fail(
                f"{label}.{candidate_id} visible count exceeds projected input count"
            )
        expected_projection = _expected_candidate_projection_metadata(candidate_id)
        for key, expected in expected_projection.items():
            _expect_evidence(
                candidate.get(key), expected, f"{label}.{candidate_id}.{key}"
            )
        projected_counts_by_base[
            str(expected_projection["sourceBaseSkyboxName"])
        ].add(projected_count)
        _expect_evidence(
            candidate.get("occupiedPixelFraction"),
            _round(visible_count / (ANALYSIS_SIZE * ANALYSIS_SIZE), 9),
            f"{label}.{candidate_id}.occupiedFraction",
        )
        raw_grid_counts = candidate.get("geometryEdgeGridCellPixelCounts")
        if not isinstance(raw_grid_counts, list) or len(raw_grid_counts) != 64:
            _development_evidence_fail(f"{label}.{candidate_id} lacks 64 grid counts")
        grid_counts = [
            _evidence_int(value, f"{label}.{candidate_id}.grid[{index}]")
            for index, value in enumerate(raw_grid_counts)
        ]
        if sum(grid_counts) != metrics["geometryCount"]:
            _development_evidence_fail(f"{label}.{candidate_id} grid counts do not sum")
        grid_support = _geometry_edge_grid_support_record_from_counts(grid_counts)
        for key, expected in grid_support.items():
            _expect_evidence(
                candidate.get(key),
                expected,
                f"{label}.{candidate_id}.{key}",
            )
        shift_rows = candidate.get("localShiftComparisons")
        if not isinstance(shift_rows, list) or len(shift_rows) != 9:
            _development_evidence_fail(f"{label}.{candidate_id} lacks nine shifts")
        offset_pairs: list[tuple[int, int]] = []
        common_count = _evidence_int(
            candidate.get("localShiftCommonSupportGeometryEdgePixelCount"),
            f"{label}.{candidate_id}.commonCount",
        )
        if common_count > metrics["geometryCount"]:
            _development_evidence_fail(
                f"{label}.{candidate_id} common support exceeds full geometry support"
            )
        validated_shifts: list[dict[str, Any]] = []
        for shift_index, shift in enumerate(shift_rows):
            if not isinstance(shift, Mapping):
                _development_evidence_fail(f"{label}.{candidate_id} shift is not an object")
            dx = _evidence_int(
                shift.get("dxPixels"),
                f"{label}.{candidate_id}.shift[{shift_index}].dx",
                minimum=-4,
            )
            dy = _evidence_int(
                shift.get("dyPixels"),
                f"{label}.{candidate_id}.shift[{shift_index}].dy",
                minimum=-4,
            )
            if dx not in LOCAL_SHIFT_OFFSETS_PIXELS or dy not in LOCAL_SHIFT_OFFSETS_PIXELS:
                _development_evidence_fail(f"{label}.{candidate_id} has an invalid shift")
            offset_pairs.append((dx, dy))
            shift_metrics = _validate_alignment_metric_record(
                shift,
                label=f"{label}.{candidate_id}.shift[{dx},{dy}]",
                expected_photo_edge_count=shared_photo_count,
                expected_geometry_edge_count=common_count,
            )
            validated_shifts.append(
                {"dxPixels": dx, "dyPixels": dy, **shift_metrics}
            )
        expected_offsets = {
            (dx, dy)
            for dy in LOCAL_SHIFT_OFFSETS_PIXELS
            for dx in LOCAL_SHIFT_OFFSETS_PIXELS
        }
        if len(set(offset_pairs)) != 9 or set(offset_pairs) != expected_offsets:
            _development_evidence_fail(f"{label}.{candidate_id} shift offsets are not exact")
        sorted_shifts = sorted(
            validated_shifts,
            key=lambda shift: (
                -(
                    float(shift["matchedFraction"])
                    if shift["matchedFraction"] is not None
                    else -1.0
                ),
                abs(shift["dxPixels"]) + abs(shift["dyPixels"]),
                shift["dyPixels"],
                shift["dxPixels"],
            ),
        )
        best_shift = sorted_shifts[0]
        zero_shift = next(
            shift
            for shift in validated_shifts
            if shift["dxPixels"] == 0 and shift["dyPixels"] == 0
        )
        gain = (
            _round(
                float(best_shift["matchedFraction"])
                - float(zero_shift["matchedFraction"]),
                9,
            )
            if best_shift["matchedFraction"] is not None
            and zero_shift["matchedFraction"] is not None
            else None
        )
        expected_candidate_values = {
            "bestLocalShiftDxPixels": best_shift["dxPixels"],
            "bestLocalShiftDyPixels": best_shift["dyPixels"],
            "bestLocalShiftMatchedFraction": best_shift["matchedFraction"],
            "commonSupportUnshiftedMatchedFraction": zero_shift["matchedFraction"],
            "localShiftGain": gain,
            "shiftSensitiveDiagnostic": bool(
                gain is not None and gain > SHIFT_SENSITIVE_DIAGNOSTIC_GAIN
            ),
            "localShiftUsesZeroFillNoWrap": True,
            "localShiftPreservesCommonGeometrySupport": True,
            "localShiftCommonSupportFractionOfFullGeometryEdges": (
                _round(common_count / metrics["geometryCount"], 9)
                if metrics["geometryCount"]
                else 0.0
            ),
        }
        for key, expected in expected_candidate_values.items():
            _expect_evidence(candidate.get(key), expected, f"{label}.{candidate_id}.{key}")
        validated_by_id[candidate_id] = {
            "record": candidate,
            "metrics": metrics,
            "gridSupport": grid_support,
            "bestShift": best_shift,
            "zeroShift": zero_shift,
            "shiftGain": gain,
        }
    for source_base, counts in projected_counts_by_base.items():
        if len(counts) != 1:
            _development_evidence_fail(
                f"{label} projected input count changes within {source_base} rotations"
            )
    sorted_unshifted = sorted(
        validated_by_id.items(),
        key=lambda item: (
            -(
                float(item[1]["metrics"]["matchedFraction"])
                if item[1]["metrics"]["matchedFraction"] is not None
                else -1.0
            ),
            item[0],
        ),
    )
    expected_unshifted_ids = [candidate_id for candidate_id, _ in sorted_unshifted]
    if candidate_ids != expected_unshifted_ids:
        _development_evidence_fail(f"{label} candidate rows are not canonically sorted")
    primary = validated_by_id[primary_id]
    primary_rank = expected_unshifted_ids.index(primary_id) + 1
    best_alternative_id = next(
        candidate_id for candidate_id in expected_unshifted_ids if candidate_id != primary_id
    )
    best_alternative = validated_by_id[best_alternative_id]
    primary_score = primary["metrics"]["matchedFraction"]
    alternative_score = best_alternative["metrics"]["matchedFraction"]
    margin = (
        _round(float(primary_score) - float(alternative_score), 9)
        if primary_score is not None and alternative_score is not None
        else None
    )
    _expect_evidence(row.get("primaryCandidateId"), primary_id, f"{label}.primaryId")
    _expect_evidence(row.get("primaryRankAmong48"), primary_rank, f"{label}.primaryRank")
    _expect_evidence(
        row.get("primaryEvaluation"), primary["record"], f"{label}.primaryEvaluation"
    )
    _expect_evidence(
        row.get("diagnosticWinnerCandidateId"),
        expected_unshifted_ids[0],
        f"{label}.winner",
    )
    _expect_evidence(
        row.get("bestAlternativeCandidateId"),
        best_alternative_id,
        f"{label}.bestAlternative",
    )
    _expect_evidence(row.get("marginOverBestAlternative"), margin, f"{label}.M0")
    _expect_evidence(
        row.get("photoEdgePixelCount"), shared_photo_count, f"{label}.photoEdgeCount"
    )
    sorted_shifted = sorted(
        validated_by_id.items(),
        key=lambda item: (
            -(
                float(item[1]["bestShift"]["matchedFraction"])
                if item[1]["bestShift"]["matchedFraction"] is not None
                else -1.0
            ),
            item[0],
        ),
    )
    shifted_ids = [candidate_id for candidate_id, _ in sorted_shifted]
    shifted_rank = shifted_ids.index(primary_id) + 1
    shifted_alternative_id = next(
        candidate_id for candidate_id in shifted_ids if candidate_id != primary_id
    )
    shifted_alternative = validated_by_id[shifted_alternative_id]
    shifted_margin = (
        _round(
            float(primary["bestShift"]["matchedFraction"])
            - float(shifted_alternative["bestShift"]["matchedFraction"]),
            9,
        )
        if primary["bestShift"]["matchedFraction"] is not None
        and shifted_alternative["bestShift"]["matchedFraction"] is not None
        else None
    )
    shift_diagnostic = row.get("localShiftDiagnostic")
    shifted_diagnostic = row.get("shiftedCandidateDiagnostic")
    if not isinstance(shift_diagnostic, Mapping) or not isinstance(
        shifted_diagnostic, Mapping
    ):
        _development_evidence_fail(f"{label} shift diagnostics are missing")
    expected_primary_shift = {
        "fullSupportUnshiftedScoreS0": primary_score,
        "commonSupportUnshiftedScore": primary["zeroShift"]["matchedFraction"],
        "bestShiftDxPixels": primary["bestShift"]["dxPixels"],
        "bestShiftDyPixels": primary["bestShift"]["dyPixels"],
        "bestShiftScore": primary["bestShift"]["matchedFraction"],
        "gainOverUnshifted": primary["shiftGain"],
        "shiftSensitive": bool(
            primary["shiftGain"] is not None
            and primary["shiftGain"] > SHIFT_SENSITIVE_DIAGNOSTIC_GAIN
        ),
        "shiftSensitiveDiagnosticOnly": True,
        "affectsDiscreteOrientationPass": False,
        "zeroFillNoWrap": True,
        "commonGeometryAndPhotoSupport": True,
        "comparisons": primary["record"]["localShiftComparisons"],
    }
    _expect_evidence(shift_diagnostic, expected_primary_shift, f"{label}.primaryShift")
    expected_shifted = {
        "primaryRankAmong48AfterEachCandidateBestLocalShift": shifted_rank,
        "diagnosticWinnerCandidateId": shifted_ids[0],
        "bestAlternativeCandidateId": shifted_alternative_id,
        "primaryMarginOverBestShiftedAlternative": shifted_margin,
        "marginAffectsDiscreteOrientationPass": True,
    }
    _expect_evidence(shifted_diagnostic, expected_shifted, f"{label}.shiftedCandidates")
    null_evidence = row.get("spatialNullStressTest")
    if not isinstance(null_evidence, Mapping):
        _development_evidence_fail(f"{label} spatial-null evidence is missing")
    exact_phase_status = _validate_spatial_null_report(
        null_evidence,
        full_geometry_edge_count=int(primary["metrics"]["geometryCount"]),
        label=f"{label}.spatialNull",
    )
    _expect_evidence(
        row.get("primaryGeometryEdgeCoverage"),
        primary["gridSupport"],
        f"{label}.primaryGeometryEdgeCoverage",
    )
    status, reasons = classify_image_evidence(
        primary_rank=primary_rank,
        primary_matched_fraction=(
            float(primary_score) if primary_score is not None else None
        ),
        margin_over_best_alternative=margin,
        shifted_margin_over_best_alternative=shifted_margin,
        geometry_edge_pixel_count=int(primary["metrics"]["geometryCount"]),
        supported_geometry_edge_grid_cells=int(
            primary["gridSupport"]["supportedGeometryEdgeGridCellCount"]
        ),
        supported_geometry_edge_grid_rows=int(
            primary["gridSupport"]["supportedGeometryEdgeGridRowCount"]
        ),
        supported_geometry_edge_grid_columns=int(
            primary["gridSupport"]["supportedGeometryEdgeGridColumnCount"]
        ),
        represented_geometry_edge_grid_quadrants=int(
            primary["gridSupport"][
                "representedGeometryEdgeGridQuadrantCount"
            ]
        ),
        geometry_edge_density=float(primary["record"]["geometryEdgeDensity"]),
        occupied_pixel_fraction=float(primary["record"]["occupiedPixelFraction"]),
        photo_edge_pixel_count=int(shared_photo_count or 0),
        photo_edge_density=float(primary["record"]["photoEdgeDensity"]),
        thresholds=thresholds,
    )
    _expect_evidence(row.get("status"), status, f"{label}.status")
    _expect_evidence(row.get("reasons"), reasons, f"{label}.reasons")
    for key in (
        "continuousCalibrationValidated",
        "metricGeometryValidated",
        "knownPoseMaterializationPermitted",
        "trainingPermitted",
    ):
        _expect_evidence(row.get(key), False, f"{label}.{key}")
    return {
        "status": status,
        "primaryRank": primary_rank,
        "shiftedRank": shifted_rank,
        "exactPhaseDiagnosticStatus": exact_phase_status,
        "primaryScore": float(primary_score) if primary_score is not None else None,
        "unshiftedMargin": margin,
        "shiftedMargin": shifted_margin,
        "shiftGain": primary["shiftGain"],
        "shiftSensitive": expected_primary_shift["shiftSensitive"],
        "maximumProjectedInputCount": max(
            count
            for counts in projected_counts_by_base.values()
            for count in counts
        ),
    }


def _validate_development_report(
    report: Mapping[str, Any],
    *,
    source_record: Mapping[str, Any],
    v2_receipt: Mapping[str, Any],
    prior_development_receipt: Mapping[str, Any],
    implementation_sources: Sequence[Mapping[str, Any]],
    dependency_versions: Mapping[str, str],
    thresholds: Mapping[str, Any],
) -> None:
    if dict(prior_development_receipt) != _expected_prior_development_receipt():
        fail(
            "PRIOR_DEVELOPMENT_REPORT_MISMATCH",
            "development validation did not receive the exact failed v1 receipt",
        )
    if report.get("schemaVersion") != DEVELOPMENT_REPORT_SCHEMA_VERSION:
        fail("INVALID_DEVELOPMENT_REPORT", "development report has the wrong schema")
    _verify_payload_digest(
        report,
        DEVELOPMENT_REPORT_DIGEST_DOMAIN,
        label="geometry-edge development report",
        code="INVALID_DEVELOPMENT_REPORT_DIGEST",
    )
    scope = report.get("scope")
    implementation = report.get("implementation")
    boundary = report.get("pointDataBoundary")
    result = report.get("result")
    scans = report.get("scans")
    images = report.get("images")
    if not all(
        isinstance(value, expected)
        for value, expected in (
            (scope, Mapping),
            (implementation, Mapping),
            (boundary, Mapping),
            (result, Mapping),
            (scans, list),
            (images, list),
        )
    ):
        fail("INVALID_DEVELOPMENT_REPORT", "development report structure is incomplete")
    if (
        scope.get("sourceE57") != dict(source_record)
        or scope.get("frozenV2ColourOrientationReport") != dict(v2_receipt)
        or scope.get("frozenPriorV1DevelopmentReport")
        != dict(prior_development_receipt)
        or scope.get("postDevelopmentRuleChange") is not True
        or scope.get("developmentScanIdsRead") != list(DEVELOPMENT_SCAN_IDS)
        or scope.get("heldOutScanIdsRead") != []
        or scope.get("heldOutScansOpened") is not False
        or scope.get("heldOutMeaning") != HELD_OUT_SCOPE_MEANING
        or scope.get("scanCount") != 7
        or scope.get("imageCount") != 42
    ):
        fail("INVALID_DEVELOPMENT_REPORT", "development scope is not exactly 7 scans/42 faces")
    if (
        report.get("developmentEvidenceProvenanceLimit")
        != DEVELOPMENT_EVIDENCE_PROVENANCE_LIMIT
        or report.get("authority") != "none"
    ):
        fail(
            "INVALID_DEVELOPMENT_REPORT",
            "development report overstates or omits its local provenance limit",
        )
    _expect_evidence(
        report.get("selfDigestMeaning"),
        {
            "authenticatesCreator": False,
            "provesTimestamp": False,
            "provesImmutability": False,
        },
        "development selfDigestMeaning",
    )
    _expect_evidence(
        report.get("methodRevision"),
        _method_revision_record(),
        "development methodRevision",
    )
    _expect_evidence(
        report.get("tuningNote"),
        _development_tuning_note(),
        "development tuningNote",
    )
    if (
        implementation.get("sourceFiles") != list(implementation_sources)
        or implementation.get("dependencyVersions") != dict(dependency_versions)
        or report.get("methodConstants") != _method_constants()
        or report.get("acceptanceThresholdsEvaluated") != dict(thresholds)
    ):
        fail(
            "DEVELOPMENT_IMPLEMENTATION_MISMATCH",
            "development report was not produced by this exact method/runtime/threshold set",
        )
    if (
        boundary.get("readScanArguments")
        != {
            "intensity": False,
            "colors": False,
            "row_column": True,
            "transform": False,
        }
        or boundary.get("allowedReturnedPointFields") != list(POINT_FIELDS_REQUESTED)
        or boundary.get("pointColourFieldsRequestedOrRead") is not False
    ):
        fail("DEVELOPMENT_POINT_COLOUR_VIOLATION", "development report read point colour")
    if [int(row.get("scanId", -1)) for row in scans] != list(DEVELOPMENT_SCAN_IDS):
        fail("INVALID_DEVELOPMENT_REPORT", "development scan rows are incomplete")
    expected_face_pairs = {
        (scan_id, f"Skybox {face}")
        for scan_id in DEVELOPMENT_SCAN_IDS
        for face in range(6)
    }
    actual_face_pairs = {
        (int(row.get("scanId", -1)), str(row.get("name"))) for row in images
    }
    if len(images) != 42 or actual_face_pairs != expected_face_pairs or any(
        row.get("evaluationRole") != "development" for row in images
    ):
        fail("INVALID_DEVELOPMENT_REPORT", "development image rows are not exact")
    recomputed_images = [
        _recompute_development_image_row(
            row,
            thresholds=thresholds,
            label=f"development scan {row.get('scanId')} {row.get('name')}",
        )
        for row in images
    ]
    recomputed_by_scan: dict[int, list[dict[str, Any]]] = {
        scan_id: [] for scan_id in DEVELOPMENT_SCAN_IDS
    }
    for row, recomputed in zip(images, recomputed_images, strict=True):
        recomputed_by_scan[int(row["scanId"])].append(recomputed)
    data3d_guids: set[str] = set()
    image2d_indexes: set[int] = set()
    image2d_guids: set[str] = set()
    jpeg_hashes: set[str] = set()
    for image in images:
        image_index = int(image["image2DIndex"])
        image_guid = str(image["image2DGuid"])
        jpeg_hash = str(image["jpeg"]["sha256"])
        if image_index in image2d_indexes:
            _development_evidence_fail("development image2D indexes are not unique")
        if image_guid in image2d_guids:
            _development_evidence_fail("development image2D GUIDs are not unique")
        if jpeg_hash in jpeg_hashes:
            _development_evidence_fail("development JPEG byte hashes are not unique")
        image2d_indexes.add(image_index)
        image2d_guids.add(image_guid)
        jpeg_hashes.add(jpeg_hash)
    for scan, scan_id in zip(scans, DEVELOPMENT_SCAN_IDS, strict=True):
        if not isinstance(scan, Mapping):
            _development_evidence_fail(f"development scan {scan_id} is not an object")
        _expect_evidence(
            scan.get("evaluationRole"),
            "development",
            f"development scan {scan_id}.role",
        )
        scan_guid = scan.get("data3DGuid")
        if not _is_lower_hex(scan_guid, 32):
            _development_evidence_fail(
                f"development scan {scan_id}.data3DGuid must be 32 lowercase hex characters"
            )
        if str(scan_guid) in data3d_guids:
            _development_evidence_fail("development data3D GUIDs are not unique")
        data3d_guids.add(str(scan_guid))
        source_images = [
            image for image in images if int(image["scanId"]) == scan_id
        ]
        if len(source_images) != 6 or any(
            image.get("data3DGuid") != scan_guid for image in source_images
        ):
            _development_evidence_fail(
                f"development scan {scan_id} image-to-scan identity is inconsistent"
            )
        face_results = recomputed_by_scan[scan_id]
        if len(face_results) != 6:
            _development_evidence_fail(f"development scan {scan_id} lacks six faces")
        scan_status = _aggregate_status([row["status"] for row in face_results])
        _expect_evidence(
            scan.get("status"), scan_status, f"development scan {scan_id}.status"
        )
        _expect_evidence(
            scan.get("allSixFacesPassDiscreteGeometryOrientation"),
            all(row["status"] == PASS for row in face_results),
            f"development scan {scan_id}.allSixPass",
        )
        _expect_evidence(
            scan.get("majorityVoteUsed"), False, f"development scan {scan_id}.majority"
        )
        _expect_evidence(
            scan.get("fullGridShape"),
            [SOURCE_ORGANIZED_ROW_COUNT, SOURCE_ORGANIZED_COLUMN_COUNT],
            f"development scan {scan_id}.fullGridShape",
        )
        _expect_evidence(
            scan.get("decimatedGridShape"),
            [SOURCE_ORGANIZED_ROW_COUNT // 2, SOURCE_ORGANIZED_COLUMN_COUNT // 2],
            f"development scan {scan_id}.decimatedGridShape",
        )
        valid_decimated = _evidence_int(
            scan.get("validDecimatedPointCount"),
            f"development scan {scan_id}.validDecimatedPointCount",
            minimum=1,
        )
        if valid_decimated > (SOURCE_ORGANIZED_ROW_COUNT // 2) * (
            SOURCE_ORGANIZED_COLUMN_COUNT // 2
        ):
            _development_evidence_fail(
                f"development scan {scan_id} valid decimated count exceeds its grid"
            )
        if any(
            int(face["maximumProjectedInputCount"]) > valid_decimated
            for face in face_results
        ):
            _development_evidence_fail(
                f"development scan {scan_id} projected input count exceeds valid decimated points"
            )
        if not _is_lower_hex(scan.get("geometrySampleSha256"), 64):
            _development_evidence_fail(
                f"development scan {scan_id}.geometrySampleSha256 is invalid"
            )
        _expect_evidence(
            scan.get("returnedPointFields"),
            list(POINT_FIELDS_REQUESTED),
            f"development scan {scan_id}.pointFields",
        )
        _expect_evidence(
            scan.get("pointColourFieldsRequestedOrRead"),
            False,
            f"development scan {scan_id}.pointColour",
        )
        _expect_evidence(
            scan.get("baseContinuousCoordinateFramesPrecomputed"),
            6,
            f"development scan {scan_id}.baseFrames",
        )
        _expect_evidence(
            scan.get("candidateMasksIndependentlyRasterized"),
            48,
            f"development scan {scan_id}.candidateRasterizations",
        )
        _expect_evidence(
            scan.get("rasterMaskRotationUsedAsProjectionSubstitute"),
            False,
            f"development scan {scan_id}.maskRotation",
        )
        grid_evidence = scan.get("organizedGridEvidence")
        if not isinstance(grid_evidence, Mapping):
            _development_evidence_fail(
                f"development scan {scan_id} organized-grid evidence is missing"
            )
        expected_grid_values = {
            "headerRowMinimum": 0,
            "headerRowMaximumRaw": SOURCE_ORGANIZED_ROW_COUNT,
            "headerColumnMinimum": 0,
            "headerColumnMaximumRaw": SOURCE_ORGANIZED_COLUMN_COUNT,
            "headerPointCount": (
                SOURCE_ORGANIZED_ROW_COUNT * SOURCE_ORGANIZED_COLUMN_COUNT
            ),
            "rowCountUsed": SOURCE_ORGANIZED_ROW_COUNT,
            "columnCountUsed": SOURCE_ORGANIZED_COLUMN_COUNT,
            "maximumInterpretation": "exclusive_grid_size",
            "dimensionsInferredFromSparseReturns": False,
        }
        for key, expected in expected_grid_values.items():
            _expect_evidence(
                grid_evidence.get(key),
                expected,
                f"development scan {scan_id}.grid.{key}",
            )
        returned_index_bounds = (
            (
                "returnedValidRowIndexMinimum",
                "returnedValidRowIndexMaximum",
                SOURCE_ORGANIZED_ROW_COUNT,
            ),
            (
                "returnedValidColumnIndexMinimum",
                "returnedValidColumnIndexMaximum",
                SOURCE_ORGANIZED_COLUMN_COUNT,
            ),
        )
        for minimum_key, maximum_key, size in returned_index_bounds:
            minimum_value = _evidence_int(
                grid_evidence.get(minimum_key),
                f"development scan {scan_id}.grid.{minimum_key}",
            )
            maximum_value = _evidence_int(
                grid_evidence.get(maximum_key),
                f"development scan {scan_id}.grid.{maximum_key}",
            )
            if minimum_value > maximum_value or maximum_value >= size:
                _development_evidence_fail(
                    f"development scan {scan_id} returned index bounds are invalid"
                )
        for key in (
            "continuousCalibrationValidated",
            "metricGeometryValidated",
            "knownPoseMaterializationPermitted",
            "trainingPermitted",
        ):
            _expect_evidence(
                scan.get(key), False, f"development scan {scan_id}.{key}"
            )
    primary_scores = [
        float(row["primaryScore"])
        for row in recomputed_images
        if row["primaryScore"] is not None
    ]
    unshifted_margins = [
        float(row["unshiftedMargin"])
        for row in recomputed_images
        if row["unshiftedMargin"] is not None
    ]
    shifted_margins = [
        float(row["shiftedMargin"])
        for row in recomputed_images
        if row["shiftedMargin"] is not None
    ]
    shift_gains = [
        float(row["shiftGain"])
        for row in recomputed_images
        if row["shiftGain"] is not None
    ]
    overall_status = _aggregate_status([row["status"] for row in recomputed_images])
    expected_result_values = {
        "statusUnderEvaluatedThresholds": overall_status,
        "all42PrimaryRankOneUnshifted": all(
            row["primaryRank"] == 1 for row in recomputed_images
        ),
        "all42PrimaryRankOneAfterAllCandidateLocalShifts": all(
            row["shiftedRank"] == 1 for row in recomputed_images
        ),
        "exactPhaseDiagnostic": _exact_phase_diagnostic_summary(images),
        "geometryCoverage": _geometry_coverage_summary(images),
        "primaryMatchedFraction": _numeric_summary(primary_scores),
        "unshiftedMarginM0": _numeric_summary(unshifted_margins),
        "allCandidatesShiftedMarginMs": _numeric_summary(shifted_margins),
        "primaryShiftGainDiagnostic": _numeric_summary(shift_gains),
        "shiftSensitiveFaceCount": sum(
            bool(row["shiftSensitive"]) for row in recomputed_images
        ),
        "continuousCalibrationValidated": False,
        "metricGeometryValidated": False,
        "knownPoseMaterializationPermitted": False,
        "trainingPermitted": False,
    }
    for key, expected in expected_result_values.items():
        _expect_evidence(result.get(key), expected, f"development result.{key}")
    if overall_status != PASS or any(row["status"] != PASS for row in recomputed_images):
        fail(
            "DEVELOPMENT_GATE_NOT_PASSED",
            "recomputed development evidence does not pass every frozen face gate",
        )


def create_protocol(
    *,
    e57_path: Path,
    v2_report_path: Path,
    prior_development_report_path: Path,
    development_report_path: Path,
    output_path: Path,
    audit_output_file_name: str,
    minimum_primary_matched_fraction_to_avoid_reject: float,
    minimum_primary_matched_fraction_for_pass: float,
    minimum_margin_over_best_alternative: float,
    minimum_shifted_margin_over_best_alternative: float,
    minimum_geometry_edge_pixels: int,
    minimum_occupied_pixel_fraction: float,
) -> dict[str, Any]:
    """Create the frozen protocol without decoding or opening an E57 scan."""

    if output_path.exists():
        fail("OUTPUT_EXISTS", "protocol output already exists; evidence is create-only")
    if (
        not audit_output_file_name
        or Path(audit_output_file_name).name != audit_output_file_name
        or audit_output_file_name in {".", ".."}
    ):
        fail("INVALID_ARGUMENT", "audit output must be one plain file name")
    thresholds = _threshold_record(
        minimum_primary_matched_fraction_to_avoid_reject=(
            minimum_primary_matched_fraction_to_avoid_reject
        ),
        minimum_primary_matched_fraction_for_pass=(
            minimum_primary_matched_fraction_for_pass
        ),
        minimum_margin_over_best_alternative=minimum_margin_over_best_alternative,
        minimum_shifted_margin_over_best_alternative=(
            minimum_shifted_margin_over_best_alternative
        ),
        minimum_geometry_edge_pixels=minimum_geometry_edge_pixels,
        minimum_occupied_pixel_fraction=minimum_occupied_pixel_fraction,
    )
    _, prior_receipt, prior_before = _read_and_validate_prior_development_report(
        prior_development_report_path
    )
    e57_before = _safe_regular_file(e57_path, "source E57", MAX_E57_BYTES)
    source_sha256 = _sha256_file(e57_path, e57_before, MAX_E57_BYTES)
    v2_report, v2_receipt, v2_before = _read_json_with_receipt(
        v2_report_path,
        label="v2 colour/orientation report",
        maximum_bytes=MAX_V2_REPORT_BYTES,
        invalid_code="INVALID_V2_REPORT",
    )
    _validate_v2_report(
        v2_report,
        source_size=e57_before.st_size,
        source_sha256=source_sha256,
    )
    source_records, source_captures = _capture_implementation_sources()
    dependency_versions = _dependency_versions()
    if dependency_versions["pye57"] == "unavailable":
        fail("PYE57_UNAVAILABLE", "pye57 must be installed before freezing the protocol")
    source_record = {
        "fileName": e57_path.name,
        "sizeBytes": e57_before.st_size,
        "sha256": source_sha256,
    }
    frozen_v2_receipt = {
        **v2_receipt,
        "schemaVersion": v2_report.get("schemaVersion"),
        "payloadSha256": v2_report.get("payloadSha256"),
    }
    development_report, development_receipt, development_before = (
        _read_json_with_receipt(
            development_report_path,
            label="geometry-edge development report",
            maximum_bytes=MAX_DEVELOPMENT_REPORT_BYTES,
            invalid_code="INVALID_DEVELOPMENT_REPORT",
        )
    )
    _validate_development_report(
        development_report,
        source_record=source_record,
        v2_receipt=frozen_v2_receipt,
        prior_development_receipt=prior_receipt,
        implementation_sources=source_records,
        dependency_versions=dependency_versions,
        thresholds=thresholds,
    )
    source_fingerprint = hashlib.sha256(
        b"OMNITWIN_RECEPTION_GEOMETRY_IMPLEMENTATION_V2\0"
        + _canonical_json_bytes(
            {
                "sourceFiles": source_records,
                "dependencyVersions": dependency_versions,
            }
        )
    ).hexdigest()
    development_shift_summary = development_report["result"][
        "primaryShiftGainDiagnostic"
    ]
    development_shift_sensitive_count = development_report["result"][
        "shiftSensitiveFaceCount"
    ]
    protocol = {
        "schemaVersion": PROTOCOL_SCHEMA_VERSION,
        "createdAtUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "scope": {
            "sourceE57": source_record,
            "frozenV2ColourOrientationReport": frozen_v2_receipt,
            "frozenPriorV1DevelopmentReport": prior_receipt,
            "postDevelopmentRuleChange": True,
            "frozenDevelopmentReport": {
                **development_receipt,
                "schemaVersion": development_report.get("schemaVersion"),
                "payloadSha256": development_report.get("payloadSha256"),
            },
            "developmentScanIds": list(DEVELOPMENT_SCAN_IDS),
            "heldOutScanIds": list(HELD_OUT_SCAN_IDS),
            "heldOutMeaning": HELD_OUT_SCOPE_MEANING,
            "developmentEvidenceProvenanceLimit": (
                DEVELOPMENT_EVIDENCE_PROVENANCE_LIMIT
            ),
            "allProtocolScanIds": list(ALL_PROTOCOL_SCAN_IDS),
            "auditReadsOnlyHeldOutScanIds": True,
            "expectedAuditOutputFileName": audit_output_file_name,
            "expectedAuditOutputLocation": "same_directory_as_protocol",
            "heldOutRunUniquenessLimit": "Create-only publication prevents a second result at the bound location while the first file exists. A local file alone cannot prove that nobody copied, deleted, or ran modified software elsewhere.",
        },
        "implementation": {
            "sourceFiles": source_records,
            "dependencyVersions": dependency_versions,
            "implementationFingerprintSha256": source_fingerprint,
        },
        "methodConstants": _method_constants(),
        "methodRevision": _method_revision_record(),
        "validatedDevelopmentDiagnostics": {
            "exactPhaseDiagnostic": development_report["result"][
                "exactPhaseDiagnostic"
            ],
            "geometryCoverage": development_report["result"][
                "geometryCoverage"
            ],
        },
        "acceptanceThresholds": thresholds,
        "fixedV2Mapping": dict(geometry.FIXED_V2_MAPPING),
        "candidateControls": {
            "baseCoordinateFramesPrecomputedPerScan": 6,
            "candidateRasterizationsPerScan": 48,
            "method": "precompute depth and continuous right/down projection numerators for six forward directions; transform those subpixel coordinates through four quarter turns with and without a vertical mirror; then independently floor, bounds-check, z-buffer, rank, dilate, and clear borders for every candidate",
            "candidateCountPerImage": 48,
            "properCandidateCount": 24,
            "mirroredCandidateCount": 24,
            "diagnosticWinnerMayReplaceFixedPrimary": False,
            "maskRotationUsedAsReprojectionSubstitute": False,
            "why": "Rotating a 512-pixel mask around array centre 255.5 is not exactly the same operation as rotating pinhole rays around principal coordinate 256. Continuous coordinates are transformed before rasterization instead.",
        },
        "developmentTuningHistory": [
            {
                "decision": "removed_primary_shift_gain_from_discrete_orientation_acceptance",
                "initialExploratoryCriterion": "exploratory primary local-shift gain <= 0.01",
                "developmentObservation": f"the validated seven-scan development report contains a maximum primary gain of {development_shift_summary['maximum']}, with {development_shift_sensitive_count} faces above 0.01",
                "finalRule": "gain > 0.01 is reported as SHIFT_SENSITIVE only and never changes the discrete-orientation status",
                "antiPHackingNote": "No local-shift-gain acceptance cutoff was introduced; the gain remains diagnostic only. Continuous calibration remains unvalidated.",
            }
        ],
        "pointDataBoundary": {
            "readScanArguments": {
                "intensity": False,
                "colors": False,
                "row_column": True,
                "transform": False,
            },
            "allowedReturnedPointFields": list(POINT_FIELDS_REQUESTED),
            "pointColourFieldsRequestedOrRead": False,
            "pointColourFieldNamesForbidden": list(POINT_COLOUR_FIELD_NAMES),
            "embeddedJpegRgbDecoded": True,
            "plainLanguage": "The scan reader may supply only XYZ plus organized row/column indexes. E57 point RGB is forbidden. The embedded JPEG is decoded because its visible edges are the comparison target.",
        },
        "decisionRules": {
            "PASS_DISCRETE_GEOMETRY_ORIENTATION": f"the fixed-v2 face is rank 1 of 48, has score at least {thresholds['minimumPrimaryMatchedFractionForPass']}, unshifted margin at least {thresholds['minimumMarginOverBestAlternative']}, all-candidates-shifted margin at least {thresholds['minimumShiftedMarginOverBestAlternative']}, and passes the count, density, occupied-area, photo-edge, and distributed full-image geometry-support gates",
            "REJECT_GEOMETRY_MISMATCH": f"there is sufficient evidence, there is no exact top-score tie, and the fixed-v2 face either loses the 48-way comparison or has an absolute edge match below {thresholds['minimumPrimaryMatchedFractionToAvoidReject']}",
            "BLOCKED_INSUFFICIENT_GEOMETRY": "geometry count, density, occupied area, or distributed full-image support is insufficient",
            "BLOCKED_AMBIGUOUS": f"the fixed-v2 face is exactly tied for the top score, score lies between {thresholds['minimumPrimaryMatchedFractionToAvoidReject']} and {thresholds['minimumPrimaryMatchedFractionForPass']}, a frozen margin is too small, or photo edges are unassessable",
            "EXACT_PHASE_DIAGNOSTIC": "the unchanged 240-offset check reports only whether the expected geometry has a unique exact pixel placement; UNIQUE, NONUNIQUE, and UNASSESSABLE never change discrete orientation",
            "legacy24CellDiagnostic": "the old >=24 supported-cell answer remains visible but never changes discrete orientation",
            "SHIFT_SENSITIVE": "primary gain above 0.01 under the fixed +/-4-pixel diagnostic; visible but never an acceptance status",
            "stationRule": "all six faces must PASS_DISCRETE_GEOMETRY_ORIENTATION; a majority vote can never upgrade a non-PASS face",
            "overallRule": "all 96 held-out faces must PASS_DISCRETE_GEOMETRY_ORIENTATION for the discrete gate to pass",
        },
        "nonAuthorization": {
            "continuousCalibrationValidated": False,
            "metricGeometryValidated": False,
            "knownPoseMaterializationPermitted": False,
            "trainingPermitted": False,
            "reason": "This protocol tests discrete edge alignment only. It does not clear privacy/rights or validate continuous intrinsics, distortion, metric depth, or inter-station registration.",
        },
        "authority": "none",
        "selfDigestMeaning": {
            "authenticatesCreator": False,
            "provesTimestamp": False,
            "provesImmutability": False,
            "plainLanguage": "The digest detects changes made without recomputing it; it is not a signature or trusted timestamp.",
        },
    }
    e57_after = _safe_regular_file(e57_path, "source E57", MAX_E57_BYTES)
    if not _same_file_identity(e57_before, e57_after):
        fail("FILE_CHANGED_DURING_READ", "source E57 changed while protocol was frozen")
    v2_after = _safe_regular_file(
        v2_report_path,
        "v2 colour/orientation report",
        MAX_V2_REPORT_BYTES,
    )
    if not _same_file_identity(v2_before, v2_after):
        fail("FILE_CHANGED_DURING_READ", "v2 report changed while protocol was frozen")
    prior_after = _safe_regular_file(
        prior_development_report_path,
        "prior v1 geometry-edge development report",
        MAX_DEVELOPMENT_REPORT_BYTES,
    )
    if not _same_file_identity(prior_before, prior_after):
        fail(
            "FILE_CHANGED_DURING_READ",
            "prior v1 development report changed while protocol was frozen",
        )
    development_after = _safe_regular_file(
        development_report_path,
        "geometry-edge development report",
        MAX_DEVELOPMENT_REPORT_BYTES,
    )
    if not _same_file_identity(development_before, development_after):
        fail(
            "FILE_CHANGED_DURING_READ",
            "development report changed while protocol was frozen",
        )
    _verify_captured_files_unchanged(source_captures)
    finalized = _finalize(protocol, PROTOCOL_DIGEST_DOMAIN)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_create_only(output_path, _canonical_json_bytes(finalized) + b"\n")
    return finalized


def _validate_protocol_shape(protocol: Mapping[str, Any]) -> None:
    if protocol.get("schemaVersion") != PROTOCOL_SCHEMA_VERSION:
        fail("INVALID_PROTOCOL", "protocol schema is not supported")
    _verify_payload_digest(
        protocol,
        PROTOCOL_DIGEST_DOMAIN,
        label="geometry-edge protocol",
        code="INVALID_PROTOCOL_DIGEST",
    )
    scope = protocol.get("scope")
    if not isinstance(scope, Mapping):
        fail("INVALID_PROTOCOL", "protocol scope is missing")
    if scope.get("developmentScanIds") != list(DEVELOPMENT_SCAN_IDS):
        fail("INVALID_PROTOCOL", "development scan IDs are not the frozen split")
    if (
        scope.get("frozenPriorV1DevelopmentReport")
        != _expected_prior_development_receipt()
        or scope.get("postDevelopmentRuleChange") is not True
    ):
        fail(
            "INVALID_PROTOCOL",
            "protocol does not bind the exact failed v1 development evidence",
        )
    if scope.get("heldOutScanIds") != list(HELD_OUT_SCAN_IDS):
        fail("INVALID_PROTOCOL", "held-out scan IDs are not the frozen split")
    if scope.get("heldOutMeaning") != HELD_OUT_SCOPE_MEANING:
        fail("INVALID_PROTOCOL", "held-out scope meaning is missing or changed")
    if (
        scope.get("developmentEvidenceProvenanceLimit")
        != DEVELOPMENT_EVIDENCE_PROVENANCE_LIMIT
    ):
        fail("INVALID_PROTOCOL", "development evidence provenance limit is missing")
    if scope.get("allProtocolScanIds") != list(ALL_PROTOCOL_SCAN_IDS):
        fail("INVALID_PROTOCOL", "complete scan split is inconsistent")
    if scope.get("auditReadsOnlyHeldOutScanIds") is not True:
        fail("INVALID_PROTOCOL", "protocol does not restrict the audit to held-out scans")
    if scope.get("expectedAuditOutputLocation") != "same_directory_as_protocol":
        fail("INVALID_PROTOCOL", "protocol output location rule is not frozen")
    if protocol.get("methodConstants") != _method_constants():
        fail("METHOD_CHANGED", "current method constants differ from the protocol")
    if protocol.get("methodRevision") != _method_revision_record():
        fail("METHOD_CHANGED", "reviewed v2 method-revision record is missing or changed")
    if protocol.get("fixedV2Mapping") != geometry.FIXED_V2_MAPPING:
        fail("METHOD_CHANGED", "current fixed-v2 mapping differs from the protocol")
    boundary = protocol.get("pointDataBoundary")
    if not isinstance(boundary, Mapping):
        fail("INVALID_PROTOCOL", "point-data boundary is missing")
    expected_arguments = {
        "intensity": False,
        "colors": False,
        "row_column": True,
        "transform": False,
    }
    if (
        boundary.get("readScanArguments") != expected_arguments
        or boundary.get("allowedReturnedPointFields") != list(POINT_FIELDS_REQUESTED)
        or boundary.get("pointColourFieldsRequestedOrRead") is not False
    ):
        fail("METHOD_CHANGED", "protocol does not enforce the no-point-colour reader")
    thresholds = protocol.get("acceptanceThresholds")
    if not isinstance(thresholds, Mapping):
        fail("INVALID_PROTOCOL", "acceptance thresholds are missing")
    expected_keys = {
        "minimumPrimaryMatchedFractionToAvoidReject",
        "minimumPrimaryMatchedFractionForPass",
        "minimumMarginOverBestAlternative",
        "minimumShiftedMarginOverBestAlternative",
        "minimumGeometryEdgePixels",
        "minimumOccupiedPixelFraction",
        "minimumPhotoEdgePixels",
        "minimumDistributedGeometryEdgeGridCells",
        "minimumDistributedGeometryEdgeGridRows",
        "minimumDistributedGeometryEdgeGridColumns",
        "requiredDistributedGeometryEdgeGridQuadrants",
        "legacyMinimumWellSupportedGeometryEdgeGridCellsDiagnosticOnly",
        "minimumGeometryEdgeDensity",
        "maximumGeometryEdgeDensity",
        "minimumPhotoEdgeDensity",
        "maximumPhotoEdgeDensity",
        "requiredPrimaryRankAmong48",
    }
    if set(thresholds) != expected_keys:
        fail("INVALID_PROTOCOL", "acceptance-threshold fields are not exact")
    rebuilt = _threshold_record(
        minimum_primary_matched_fraction_to_avoid_reject=float(
            thresholds["minimumPrimaryMatchedFractionToAvoidReject"]
        ),
        minimum_primary_matched_fraction_for_pass=float(
            thresholds["minimumPrimaryMatchedFractionForPass"]
        ),
        minimum_margin_over_best_alternative=float(
            thresholds["minimumMarginOverBestAlternative"]
        ),
        minimum_shifted_margin_over_best_alternative=float(
            thresholds["minimumShiftedMarginOverBestAlternative"]
        ),
        minimum_geometry_edge_pixels=int(thresholds["minimumGeometryEdgePixels"]),
        minimum_occupied_pixel_fraction=float(
            thresholds["minimumOccupiedPixelFraction"]
        ),
    )
    if dict(thresholds) != rebuilt:
        fail("INVALID_PROTOCOL", "acceptance thresholds are invalid or non-canonical")


def verify_protocol_inputs(
    *,
    protocol_path: Path,
    e57_path: Path,
    v2_report_path: Path,
    prior_development_report_path: Path,
    development_report_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    """Verify all frozen inputs before any E57 object may be constructed."""

    if output_path.exists():
        fail("OUTPUT_EXISTS", "audit output already exists; evidence is create-only")
    protocol, protocol_receipt, protocol_before = _read_json_with_receipt(
        protocol_path,
        label="geometry-edge protocol",
        maximum_bytes=MAX_PROTOCOL_BYTES,
        invalid_code="INVALID_PROTOCOL",
    )
    _validate_protocol_shape(protocol)
    scope = protocol["scope"]
    if output_path.name != scope.get("expectedAuditOutputFileName"):
        fail("OUTPUT_NAME_MISMATCH", "audit output file name differs from the protocol")
    if output_path.parent.resolve() != protocol_path.parent.resolve():
        fail(
            "OUTPUT_DIRECTORY_MISMATCH",
            "audit output must be in the same directory as its frozen protocol",
        )

    _, prior_receipt, prior_before = _read_and_validate_prior_development_report(
        prior_development_report_path
    )
    if scope.get("frozenPriorV1DevelopmentReport") != prior_receipt:
        fail(
            "PRIOR_DEVELOPMENT_REPORT_MISMATCH",
            "prior v1 development report bytes differ from the protocol",
        )

    source_record = scope.get("sourceE57")
    if not isinstance(source_record, Mapping):
        fail("INVALID_PROTOCOL", "source E57 receipt is missing")
    e57_before = _safe_regular_file(e57_path, "source E57", MAX_E57_BYTES)
    source_sha256 = _sha256_file(e57_path, e57_before, MAX_E57_BYTES)
    if (
        source_record.get("fileName") != e57_path.name
        or source_record.get("sizeBytes") != e57_before.st_size
        or source_record.get("sha256") != source_sha256
    ):
        fail("SOURCE_HASH_MISMATCH", "source E57 does not match the frozen protocol")

    v2_report, v2_receipt, v2_before = _read_json_with_receipt(
        v2_report_path,
        label="v2 colour/orientation report",
        maximum_bytes=MAX_V2_REPORT_BYTES,
        invalid_code="INVALID_V2_REPORT",
    )
    expected_v2 = scope.get("frozenV2ColourOrientationReport")
    if not isinstance(expected_v2, Mapping) or any(
        expected_v2.get(key) != value for key, value in v2_receipt.items()
    ):
        fail("V2_REPORT_HASH_MISMATCH", "v2 report bytes differ from the protocol")
    if (
        expected_v2.get("payloadSha256") != v2_report.get("payloadSha256")
        or expected_v2.get("schemaVersion") != v2_report.get("schemaVersion")
    ):
        fail("V2_REPORT_HASH_MISMATCH", "v2 report identity differs from the protocol")
    _validate_v2_report(
        v2_report,
        source_size=e57_before.st_size,
        source_sha256=source_sha256,
    )

    implementation = protocol.get("implementation")
    if not isinstance(implementation, Mapping):
        fail("INVALID_PROTOCOL", "implementation receipt is missing")
    expected_sources = implementation.get("sourceFiles")
    if not isinstance(expected_sources, list):
        fail("INVALID_PROTOCOL", "implementation source list is missing")
    current_sources, source_captures = _capture_implementation_sources()
    if current_sources != expected_sources:
        fail("IMPLEMENTATION_HASH_MISMATCH", "tool or local dependency bytes changed")
    current_versions = _dependency_versions()
    if current_versions != implementation.get("dependencyVersions"):
        fail("DEPENDENCY_VERSION_MISMATCH", "runtime dependency versions changed")
    current_fingerprint = hashlib.sha256(
        b"OMNITWIN_RECEPTION_GEOMETRY_IMPLEMENTATION_V2\0"
        + _canonical_json_bytes(
            {
                "sourceFiles": current_sources,
                "dependencyVersions": current_versions,
            }
        )
    ).hexdigest()
    if current_fingerprint != implementation.get("implementationFingerprintSha256"):
        fail("IMPLEMENTATION_HASH_MISMATCH", "implementation fingerprint changed")
    development_report, development_receipt, development_before = (
        _read_json_with_receipt(
            development_report_path,
            label="geometry-edge development report",
            maximum_bytes=MAX_DEVELOPMENT_REPORT_BYTES,
            invalid_code="INVALID_DEVELOPMENT_REPORT",
        )
    )
    expected_development = scope.get("frozenDevelopmentReport")
    if not isinstance(expected_development, Mapping) or any(
        expected_development.get(key) != value
        for key, value in development_receipt.items()
    ):
        fail(
            "DEVELOPMENT_REPORT_HASH_MISMATCH",
            "development report bytes differ from the protocol",
        )
    if (
        expected_development.get("payloadSha256")
        != development_report.get("payloadSha256")
        or expected_development.get("schemaVersion")
        != development_report.get("schemaVersion")
    ):
        fail(
            "DEVELOPMENT_REPORT_HASH_MISMATCH",
            "development report identity differs from the protocol",
        )
    _validate_development_report(
        development_report,
        source_record=source_record,
        v2_receipt=expected_v2,
        prior_development_receipt=prior_receipt,
        implementation_sources=current_sources,
        dependency_versions=current_versions,
        thresholds=protocol["acceptanceThresholds"],
    )
    expected_development_diagnostics = {
        "exactPhaseDiagnostic": development_report["result"][
            "exactPhaseDiagnostic"
        ],
        "geometryCoverage": development_report["result"]["geometryCoverage"],
    }
    if (
        protocol.get("validatedDevelopmentDiagnostics")
        != expected_development_diagnostics
    ):
        fail(
            "INVALID_PROTOCOL",
            "protocol development diagnostics differ from the bound report",
        )
    return {
        "protocol": protocol,
        "protocolReceipt": {
            **protocol_receipt,
            "schemaVersion": protocol.get("schemaVersion"),
            "payloadSha256": protocol.get("payloadSha256"),
        },
        "protocolPath": protocol_path,
        "protocolBefore": protocol_before,
        "e57Before": e57_before,
        "v2Before": v2_before,
        "priorDevelopmentBefore": prior_before,
        "priorDevelopmentPath": prior_development_report_path,
        "priorDevelopmentReceipt": prior_receipt,
        "developmentBefore": development_before,
        "developmentPath": development_report_path,
        "sourceSha256": source_sha256,
        "sourceCaptures": source_captures,
    }


def _axis_name(vector: np.ndarray) -> str:
    candidate = np.asarray(vector, dtype=np.float64)
    for name, axis in geometry.AXES.items():
        if np.array_equal(candidate, axis):
            return name
    raise ValueError(f"not a cardinal axis: {candidate.tolist()}")


def _candidate_id(forward: np.ndarray, right: np.ndarray, mirrored: bool) -> str:
    handedness = "mirrored" if mirrored else "proper"
    return f"forward_{_axis_name(forward)}_right_{_axis_name(right)}_{handedness}"


def precompute_six_base_projection_coordinates(
    prepared: Mapping[str, Any],
) -> dict[str, dict[str, Any]]:
    """Precompute six forward-depth/base-axis coordinate frames.

    The stored values are continuous projection numerators, not raster masks.
    Quarter-turn and mirror controls are applied to these values before every
    candidate is independently floored and z-buffered.  This avoids the
    half-pixel-centre error caused by ``np.rot90`` on an already-rasterized
    512-pixel mask.
    """

    points = np.asarray(prepared["points"], dtype=np.float64)
    jumps = np.asarray(prepared["absoluteLogRangeJump"], dtype=np.float64)
    normals = np.asarray(
        prepared["surfaceNormalDiscontinuity"], dtype=np.float64
    )
    if points.ndim != 2 or points.shape[1] != 3:
        raise ValueError("prepared points must have shape (point_count, 3)")
    if jumps.shape != (len(points),) or normals.shape != (len(points),):
        raise ValueError("prepared signal arrays must match prepared points")
    bases: dict[str, dict[str, Any]] = {}
    for skybox_name in sorted(geometry.FIXED_V2_MAPPING):
        candidate = geometry.CANDIDATE_BY_ID[geometry.FIXED_V2_MAPPING[skybox_name]]
        forward = np.asarray(candidate["forward"], dtype=np.float64)
        right = np.asarray(candidate["right"], dtype=np.float64)
        down = np.asarray(candidate["down"], dtype=np.float64)
        bases[skybox_name] = {
            "sourceBaseSkyboxName": skybox_name,
            "forward": forward,
            "baseRight": right,
            "baseDown": down,
            "depth": np.ascontiguousarray(points @ forward),
            "baseRightNumerator": np.ascontiguousarray(points @ right),
            "baseDownNumerator": np.ascontiguousarray(points @ down),
            "finitePointMask": np.all(np.isfinite(points), axis=1),
            "absoluteLogRangeJump": jumps,
            "surfaceNormalDiscontinuity": normals,
        }
    return bases


def _rasterize_candidate_from_base_coordinates(
    base: Mapping[str, Any],
    *,
    quarter_turns_counter_clockwise: int,
    mirrored: bool,
    fx: float,
    fy: float,
    cx: float,
    cy: float,
    width: int,
    height: int,
) -> tuple[str, dict[str, Any]]:
    """Transform continuous coordinates, then independently rasterize once."""

    if quarter_turns_counter_clockwise not in (0, 1, 2, 3):
        raise ValueError("quarter turns must be 0, 1, 2, or 3")
    if width <= 0 or height <= 0:
        raise ValueError("projection dimensions must be positive")
    depth = np.asarray(base["depth"], dtype=np.float64)
    right0 = np.asarray(base["baseRightNumerator"], dtype=np.float64)
    down0 = np.asarray(base["baseDownNumerator"], dtype=np.float64)
    base_right = np.asarray(base["baseRight"], dtype=np.float64)
    base_down = np.asarray(base["baseDown"], dtype=np.float64)
    rotations = (
        (right0, down0, base_right, base_down),
        (down0, -right0, base_down, -base_right),
        (-right0, -down0, -base_right, -base_down),
        (-down0, right0, -base_down, base_right),
    )
    right_numerator, proper_down_numerator, right, proper_down = rotations[
        quarter_turns_counter_clockwise
    ]
    down_numerator = -proper_down_numerator if mirrored else proper_down_numerator
    down = -proper_down if mirrored else proper_down
    candidate_id = _candidate_id(np.asarray(base["forward"]), right, mirrored)
    declared = geometry.CANDIDATE_BY_ID.get(candidate_id)
    if declared is None or not np.array_equal(declared["down"], down):
        raise RuntimeError("transformed continuous coordinates do not match cube basis")

    safe_depth = np.where(np.abs(depth) > 1.0e-15, depth, 1.0)
    u = cx + fx * right_numerator / safe_depth
    v = (height - cy) + fy * down_numerator / safe_depth
    valid = (
        np.asarray(base["finitePointMask"], dtype=bool)
        & np.isfinite(depth)
        & np.isfinite(u)
        & np.isfinite(v)
        & (depth > geometry.MIN_POSITIVE_DEPTH_METRES)
        & (depth < geometry.MAX_POSITIVE_DEPTH_METRES)
        & (u >= 0.0)
        & (u < width)
        & (v >= 0.0)
        & (v < height)
    )
    source_indexes = np.flatnonzero(valid)
    pixel_x = np.floor(u[source_indexes]).astype(np.int64)
    pixel_y = np.floor(v[source_indexes]).astype(np.int64)
    pixel_ids = pixel_y * width + pixel_x
    order = np.lexsort((source_indexes, depth[source_indexes], pixel_ids))
    sorted_pixel_ids = pixel_ids[order]
    first = np.ones(len(order), dtype=bool)
    if len(first) > 1:
        first[1:] = sorted_pixel_ids[1:] != sorted_pixel_ids[:-1]
    visible_indexes = source_indexes[order[first]]
    visible_x = np.floor(u[visible_indexes]).astype(np.int64)
    visible_y = np.floor(v[visible_indexes]).astype(np.int64)

    jump_image = np.zeros((height, width), dtype=np.float64)
    normal_image = np.zeros((height, width), dtype=np.float64)
    occupied = np.zeros((height, width), dtype=bool)
    jump_image[visible_y, visible_x] = np.asarray(
        base["absoluteLogRangeJump"]
    )[visible_indexes]
    normal_image[visible_y, visible_x] = np.asarray(
        base["surfaceNormalDiscontinuity"]
    )[visible_indexes]
    occupied[visible_y, visible_x] = True
    return candidate_id, {
        "absoluteLogRangeJumpImage": jump_image,
        "surfaceNormalDiscontinuityImage": normal_image,
        "occupiedMask": occupied,
        "projectedInputCount": int(len(source_indexes)),
        "visiblePixelCount": int(len(visible_indexes)),
        "sourceBaseSkyboxName": base["sourceBaseSkyboxName"],
        "quarterTurnsCounterClockwise": quarter_turns_counter_clockwise,
        "verticalMirrorAfterRotation": mirrored,
        "mirrored": mirrored,
        "basisDeterminant": float(declared["basisDeterminant"]),
    }


def rasterize_48_candidate_geometry_masks(
    base_coordinates: Mapping[str, Mapping[str, Any]],
    *,
    fx: float,
    fy: float,
    cx: float,
    cy: float,
    width: int,
    height: int,
) -> dict[str, dict[str, Any]]:
    """Rasterize all 48 candidates from six continuous base frames."""

    if set(base_coordinates) != set(geometry.FIXED_V2_MAPPING):
        raise ValueError("base coordinates must contain the exact six Skybox names")
    output: dict[str, dict[str, Any]] = {}
    for skybox_name in sorted(base_coordinates):
        base = base_coordinates[skybox_name]
        for quarter_turns in range(4):
            for mirrored in (False, True):
                candidate_id, projection = _rasterize_candidate_from_base_coordinates(
                    base,
                    quarter_turns_counter_clockwise=quarter_turns,
                    mirrored=mirrored,
                    fx=fx,
                    fy=fy,
                    cx=cx,
                    cy=cy,
                    width=width,
                    height=height,
                )
                if candidate_id in output:
                    raise RuntimeError("candidate was rasterized more than once")
                mask, _ = geometry.strongest_geometry_edge_mask(
                    projection["absoluteLogRangeJumpImage"],
                    projection["surfaceNormalDiscontinuityImage"],
                    projection["occupiedMask"],
                )
                output[candidate_id] = {
                    "mask": mask,
                    "sourceBaseSkyboxName": projection["sourceBaseSkyboxName"],
                    "quarterTurnsCounterClockwise": quarter_turns,
                    "verticalMirrorAfterRotation": mirrored,
                    "mirrored": mirrored,
                    "basisDeterminant": projection["basisDeterminant"],
                    "visiblePixelCount": projection["visiblePixelCount"],
                    "projectedInputCount": projection["projectedInputCount"],
                    "occupiedPixelFraction": _round(
                        projection["visiblePixelCount"] / (width * height), 9
                    ),
                }
    if set(output) != set(geometry.CANDIDATE_BY_ID) or len(output) != 48:
        raise RuntimeError("six coordinate frames did not produce the exact 48 candidates")
    return output


def _shift_mask_zero_fill(mask: np.ndarray, *, dy: int, dx: int) -> np.ndarray:
    source = np.asarray(mask, dtype=bool)
    output = np.zeros_like(source)
    height, width = source.shape
    source_y0 = max(0, -dy)
    source_y1 = min(height, height - dy)
    source_x0 = max(0, -dx)
    source_x1 = min(width, width - dx)
    if source_y0 >= source_y1 or source_x0 >= source_x1:
        return output
    output[
        source_y0 + dy : source_y1 + dy,
        source_x0 + dx : source_x1 + dx,
    ] = source[source_y0:source_y1, source_x0:source_x1]
    return output


def _local_shift_common_support_mask(mask: np.ndarray) -> np.ndarray:
    """Keep only pixels that remain inside photo support at every local shift."""

    values = np.asarray(mask, dtype=bool).copy()
    maximum_shift = max(abs(value) for value in LOCAL_SHIFT_OFFSETS_PIXELS)
    border = geometry.EDGE_BORDER_PIXELS + maximum_shift
    values[:border, :] = False
    values[-border:, :] = False
    values[:, :border] = False
    values[:, -border:] = False
    return values


def _score_mask_with_distance(
    mask: np.ndarray,
    distance_to_photo_edge: np.ndarray,
    *,
    photo_edge_count: int,
) -> dict[str, Any]:
    geometry_count = int(np.count_nonzero(mask))
    matched_count = int(
        np.count_nonzero(
            np.asarray(mask, dtype=bool)
            & (distance_to_photo_edge <= geometry.PHOTO_MATCH_RADIUS_PIXELS)
        )
    ) if photo_edge_count else 0
    return {
        "geometryEdgePixelCount": geometry_count,
        "geometryEdgeDensity": _round(geometry_count / mask.size, 9),
        "photoEdgePixelCount": photo_edge_count,
        "photoEdgeDensity": _round(photo_edge_count / mask.size, 9),
        "matchedGeometryEdgePixelCount": matched_count,
        "matchRadiusPixels": geometry.PHOTO_MATCH_RADIUS_PIXELS,
        "matchedFraction": (
            _round(matched_count / geometry_count, 9) if geometry_count else None
        ),
    }


def _geometry_edge_grid_cell_pixel_counts(
    mask: np.ndarray,
    *,
    grid_size: int = GEOMETRY_EDGE_SPATIAL_GRID_SIZE,
) -> list[int]:
    values = np.asarray(mask, dtype=bool)
    if values.ndim != 2:
        raise ValueError("spatial coverage mask must be two-dimensional")
    if grid_size <= 0:
        raise ValueError("spatial grid size must be positive")
    rows, columns = np.nonzero(values)
    if not len(rows):
        return [0] * (grid_size * grid_size)
    grid_rows = np.minimum(rows * grid_size // values.shape[0], grid_size - 1)
    grid_columns = np.minimum(
        columns * grid_size // values.shape[1], grid_size - 1
    )
    counts = np.bincount(
        grid_rows * grid_size + grid_columns,
        minlength=grid_size * grid_size,
    )
    return [int(value) for value in counts]


def _well_supported_geometry_edge_grid_cells(
    mask: np.ndarray,
    *,
    grid_size: int = GEOMETRY_EDGE_SPATIAL_GRID_SIZE,
    minimum_pixels_per_cell: int = (
        MINIMUM_GEOMETRY_EDGE_PIXELS_PER_OCCUPIED_GRID_CELL
    ),
) -> int:
    if minimum_pixels_per_cell <= 0:
        raise ValueError("minimum pixels per cell must be positive")
    counts = _geometry_edge_grid_cell_pixel_counts(mask, grid_size=grid_size)
    return sum(value >= minimum_pixels_per_cell for value in counts)


def _geometry_edge_grid_support_record_from_counts(
    counts: Sequence[int],
    *,
    grid_size: int = GEOMETRY_EDGE_SPATIAL_GRID_SIZE,
    minimum_pixels_per_cell: int = (
        MINIMUM_GEOMETRY_EDGE_PIXELS_PER_OCCUPIED_GRID_CELL
    ),
) -> dict[str, Any]:
    """Describe both the v2 distributed support and the legacy count result."""

    if grid_size <= 0 or grid_size % 2:
        raise ValueError("geometry support grid must have a positive even size")
    if minimum_pixels_per_cell <= 0:
        raise ValueError("minimum pixels per supported cell must be positive")
    raw_counts = list(counts)
    if len(raw_counts) != grid_size * grid_size or any(
        not isinstance(value, int) or isinstance(value, bool) or value < 0
        for value in raw_counts
    ):
        raise ValueError("geometry support counts must be non-negative grid integers")
    supported_coordinates = [
        divmod(index, grid_size)
        for index, value in enumerate(raw_counts)
        if value >= minimum_pixels_per_cell
    ]
    supported_rows = sorted({row for row, _ in supported_coordinates})
    supported_columns = sorted({column for _, column in supported_coordinates})
    midpoint = grid_size // 2
    quadrant_order = (
        "TOP_LEFT",
        "TOP_RIGHT",
        "BOTTOM_LEFT",
        "BOTTOM_RIGHT",
    )
    represented = {
        (
            "TOP" if row < midpoint else "BOTTOM"
        )
        + "_"
        + ("LEFT" if column < midpoint else "RIGHT")
        for row, column in supported_coordinates
    }
    supported_quadrants = [
        quadrant for quadrant in quadrant_order if quadrant in represented
    ]
    supported_cell_count = len(supported_coordinates)
    checks = {
        "minimumSupportedCells": (
            supported_cell_count
            >= MINIMUM_DISTRIBUTED_GEOMETRY_EDGE_GRID_CELLS
        ),
        "minimumSupportedRows": (
            len(supported_rows) >= MINIMUM_DISTRIBUTED_GEOMETRY_EDGE_GRID_ROWS
        ),
        "minimumSupportedColumns": (
            len(supported_columns)
            >= MINIMUM_DISTRIBUTED_GEOMETRY_EDGE_GRID_COLUMNS
        ),
        "allFourQuadrantsRepresented": (
            len(supported_quadrants)
            == REQUIRED_DISTRIBUTED_GEOMETRY_EDGE_GRID_QUADRANTS
        ),
    }
    return {
        "geometryEdgeGridCellPixelCounts": raw_counts,
        "supportedGeometryEdgeGridCellCount": supported_cell_count,
        "supportedGeometryEdgeGridRowIndexes": supported_rows,
        "supportedGeometryEdgeGridColumnIndexes": supported_columns,
        "supportedGeometryEdgeGridRowCount": len(supported_rows),
        "supportedGeometryEdgeGridColumnCount": len(supported_columns),
        "supportedGeometryEdgeGridQuadrants": supported_quadrants,
        "representedGeometryEdgeGridQuadrantCount": len(supported_quadrants),
        "distributedGeometryEdgeSupportChecks": checks,
        "distributedGeometryEdgeSupportPasses": all(checks.values()),
        "legacyAtLeast24SupportedGeometryEdgeGridCellsDiagnosticPasses": (
            supported_cell_count
            >= LEGACY_MINIMUM_WELL_SUPPORTED_GEOMETRY_EDGE_GRID_CELLS_DIAGNOSTIC
        ),
        "legacyMinimumSupportedGeometryEdgeGridCellsDiagnosticOnly": (
            LEGACY_MINIMUM_WELL_SUPPORTED_GEOMETRY_EDGE_GRID_CELLS_DIAGNOSTIC
        ),
    }


def _geometry_edge_grid_support_record(mask: np.ndarray) -> dict[str, Any]:
    return _geometry_edge_grid_support_record_from_counts(
        _geometry_edge_grid_cell_pixel_counts(mask)
    )


def empirical_spatial_null_stress_test(
    geometry_edge_mask: np.ndarray,
    photo_edge_mask: np.ndarray,
) -> dict[str, Any]:
    """Diagnose whether the exact primary pixel placement is unique.

    This is not a p-value and it is not a face-orientation gate. Geometry
    coordinates are never shifted as an image. The exact same N primary pixels
    inside the common-support ROI index the photo-edge distance map at the
    observed location and at every frozen offset.
    """

    geometry_mask = np.asarray(geometry_edge_mask, dtype=bool)
    photo_mask = np.asarray(photo_edge_mask, dtype=bool)
    if geometry_mask.shape != (ANALYSIS_SIZE, ANALYSIS_SIZE):
        raise ValueError("spatial-null geometry mask must be 512 by 512")
    if photo_mask.shape != geometry_mask.shape:
        raise ValueError("spatial-null photo mask must match geometry mask")
    if np.any(photo_mask):
        distance = ndimage.distance_transform_edt(~photo_mask)
    else:
        distance = np.full(photo_mask.shape, np.inf, dtype=np.float64)
    y0, y1, x0, x1 = SPATIAL_NULL_ROI
    roi_rows, roi_columns = np.nonzero(geometry_mask[y0:y1, x0:x1])
    rows = roi_rows + y0
    columns = roi_columns + x0
    geometry_pixels_in_roi = int(len(rows))
    full_geometry_pixels = int(np.count_nonzero(geometry_mask))
    roi_fraction = (
        geometry_pixels_in_roi / full_geometry_pixels if full_geometry_pixels else 0.0
    )

    cell_size = (y1 - y0) // SPATIAL_NULL_COVERAGE_GRID_SIZE
    if cell_size * SPATIAL_NULL_COVERAGE_GRID_SIZE != y1 - y0:
        raise RuntimeError("spatial-null ROI does not divide into its fixed grid")
    if geometry_pixels_in_roi:
        cell_rows = (rows - y0) // cell_size
        cell_columns = (columns - x0) // cell_size
        cell_counts = np.bincount(
            cell_rows * SPATIAL_NULL_COVERAGE_GRID_SIZE + cell_columns,
            minlength=SPATIAL_NULL_COVERAGE_GRID_SIZE**2,
        ).reshape(
            SPATIAL_NULL_COVERAGE_GRID_SIZE,
            SPATIAL_NULL_COVERAGE_GRID_SIZE,
        )
    else:
        cell_counts = np.zeros(
            (
                SPATIAL_NULL_COVERAGE_GRID_SIZE,
                SPATIAL_NULL_COVERAGE_GRID_SIZE,
            ),
            dtype=np.int64,
        )
    supported_cells = (
        cell_counts >= SPATIAL_NULL_MINIMUM_PIXELS_PER_COVERED_CELL
    )
    covered_cell_count = int(np.count_nonzero(supported_cells))
    spanned_row_count = int(np.count_nonzero(np.any(supported_cells, axis=1)))
    spanned_column_count = int(np.count_nonzero(np.any(supported_cells, axis=0)))
    assessability_checks = {
        "minimumGeometryPixelsInRoi": (
            geometry_pixels_in_roi >= SPATIAL_NULL_MINIMUM_GEOMETRY_PIXELS
        ),
        "minimumRoiFractionOfFullGeometryEdges": (
            roi_fraction >= SPATIAL_NULL_MINIMUM_GEOMETRY_FRACTION
        ),
        "minimumCoveredCells": (
            covered_cell_count >= SPATIAL_NULL_MINIMUM_COVERED_CELLS
        ),
        "minimumSpannedRows": (
            spanned_row_count >= SPATIAL_NULL_MINIMUM_SPANNED_ROWS
        ),
        "minimumSpannedColumns": (
            spanned_column_count >= SPATIAL_NULL_MINIMUM_SPANNED_COLUMNS
        ),
    }
    assessable = all(assessability_checks.values())
    observed_hits = int(
        np.count_nonzero(
            distance[rows, columns] <= geometry.PHOTO_MATCH_RADIUS_PIXELS
        )
    )
    null_hits = [
        int(
            np.count_nonzero(
                distance[rows + dy, columns + dx]
                <= geometry.PHOTO_MATCH_RADIUS_PIXELS
            )
        )
        for dx, dy in SPATIAL_NULL_OFFSETS
    ]
    tail_count = sum(hit_count >= observed_hits for hit_count in null_hits)
    q99_hits = sorted(null_hits)[SPATIAL_NULL_Q99_SORTED_INDEX]
    observed_minus_q99_hits = observed_hits - q99_hits
    observed_minus_q99_fraction = (
        observed_minus_q99_hits / geometry_pixels_in_roi
        if geometry_pixels_in_roi
        else None
    )
    passes_tail = tail_count <= SPATIAL_NULL_MAXIMUM_TAIL_COUNT
    passes_gap = bool(
        geometry_pixels_in_roi
        and 50 * observed_minus_q99_hits >= geometry_pixels_in_roi
    )
    if not assessable:
        diagnostic_status = EXACT_PHASE_UNASSESSABLE
    elif passes_tail and passes_gap:
        diagnostic_status = EXACT_PHASE_UNIQUE
    else:
        diagnostic_status = EXACT_PHASE_NONUNIQUE
    hits_digest = hashlib.sha256(
        b"OMNITWIN_RECEPTION_GEOMETRY_SPATIAL_NULL_HITS_V1\0"
        + _canonical_json_bytes(null_hits)
    ).hexdigest()
    return {
        "label": "exact_phase_diagnostic_not_a_p_value",
        "decisionRole": EXACT_PHASE_DIAGNOSTIC,
        "decisionTarget": "pixel_location_uniqueness",
        "status": diagnostic_status,
        "affectsDiscreteOrientationPass": False,
        "continuousCalibrationValidated": False,
        "assessable": assessable,
        "roiY0Y1X0X1": list(SPATIAL_NULL_ROI),
        "geometryPixelsInRoi": geometry_pixels_in_roi,
        "fullGeometryEdgePixels": full_geometry_pixels,
        "roiFractionOfFullGeometryEdges": _round(roi_fraction, 9),
        "coverageGridSize": SPATIAL_NULL_COVERAGE_GRID_SIZE,
        "coverageCellSizePixels": cell_size,
        "coverageCellGeometryPixelCounts": cell_counts.tolist(),
        "coveredCellCountAtLeast25Pixels": covered_cell_count,
        "spannedSupportedGridRows": spanned_row_count,
        "spannedSupportedGridColumns": spanned_column_count,
        "assessabilityChecks": assessability_checks,
        "observedHitCount": observed_hits,
        "observedMatchedFraction": (
            _round(observed_hits / geometry_pixels_in_roi, 9)
            if geometry_pixels_in_roi
            else None
        ),
        "nullOffsetCount": len(SPATIAL_NULL_OFFSETS),
        "nullOffsetsDxDySha256": _spatial_null_offset_digest(),
        "nullHitCountsInFrozenOffsetOrder": null_hits,
        "nullHitCountsSha256": hits_digest,
        "tailCountNullHitsGreaterThanOrEqualObserved": tail_count,
        "empiricalSmoothedTailRatio": _round((1 + tail_count) / 241.0, 9),
        "q99SortedNullHitIndexZeroBased": SPATIAL_NULL_Q99_SORTED_INDEX,
        "q99NullHitCount": q99_hits,
        "observedMinusQ99HitCount": observed_minus_q99_hits,
        "observedMinusQ99Fraction": (
            _round(observed_minus_q99_fraction, 9)
            if observed_minus_q99_fraction is not None
            else None
        ),
        "passesTailCountAtMostOne": passes_tail,
        "passesObservedMinusQ99AtLeastTwoPercent": passes_gap,
    }


def classify_image_evidence(
    *,
    primary_rank: int,
    primary_matched_fraction: float | None,
    margin_over_best_alternative: float | None,
    shifted_margin_over_best_alternative: float | None,
    geometry_edge_pixel_count: int,
    supported_geometry_edge_grid_cells: int,
    supported_geometry_edge_grid_rows: int,
    supported_geometry_edge_grid_columns: int,
    represented_geometry_edge_grid_quadrants: int,
    geometry_edge_density: float,
    occupied_pixel_fraction: float,
    photo_edge_pixel_count: int,
    photo_edge_density: float,
    thresholds: Mapping[str, Any],
) -> tuple[str, list[str]]:
    """Apply the frozen face-level PASS/REJECT/BLOCKED decision rules."""

    reasons: list[str] = []
    if geometry_edge_pixel_count < int(thresholds["minimumGeometryEdgePixels"]):
        reasons.append("geometry_edge_pixel_count_below_threshold")
    if occupied_pixel_fraction < float(thresholds["minimumOccupiedPixelFraction"]):
        reasons.append("occupied_pixel_fraction_below_threshold")
    if supported_geometry_edge_grid_cells < int(
        thresholds["minimumDistributedGeometryEdgeGridCells"]
    ):
        reasons.append("geometry_edge_supported_cell_count_below_threshold")
    if supported_geometry_edge_grid_rows < int(
        thresholds["minimumDistributedGeometryEdgeGridRows"]
    ):
        reasons.append("geometry_edge_supported_row_span_below_threshold")
    if supported_geometry_edge_grid_columns < int(
        thresholds["minimumDistributedGeometryEdgeGridColumns"]
    ):
        reasons.append("geometry_edge_supported_column_span_below_threshold")
    if represented_geometry_edge_grid_quadrants < int(
        thresholds["requiredDistributedGeometryEdgeGridQuadrants"]
    ):
        reasons.append("geometry_edge_support_does_not_cover_all_quadrants")
    if not (
        float(thresholds["minimumGeometryEdgeDensity"])
        <= geometry_edge_density
        <= float(thresholds["maximumGeometryEdgeDensity"])
    ):
        reasons.append("geometry_edge_density_outside_assessable_interval")
    if reasons:
        return BLOCKED_INSUFFICIENT_GEOMETRY, reasons
    if photo_edge_pixel_count < int(thresholds["minimumPhotoEdgePixels"]):
        return BLOCKED_AMBIGUOUS, ["photo_has_no_usable_edges"]
    if not (
        float(thresholds["minimumPhotoEdgeDensity"])
        <= photo_edge_density
        <= float(thresholds["maximumPhotoEdgeDensity"])
    ):
        return BLOCKED_AMBIGUOUS, [
            "photo_edge_density_outside_assessable_interval"
        ]
    if primary_matched_fraction is None:
        return BLOCKED_INSUFFICIENT_GEOMETRY, ["primary_score_is_unassessable"]
    if margin_over_best_alternative == 0.0:
        return BLOCKED_AMBIGUOUS, ["fixed_v2_primary_is_tied_for_top_score"]
    if primary_matched_fraction < float(
        thresholds["minimumPrimaryMatchedFractionToAvoidReject"]
    ):
        return REJECT_GEOMETRY_MISMATCH, ["primary_edge_match_below_threshold"]
    if primary_rank != int(thresholds["requiredPrimaryRankAmong48"]):
        return REJECT_GEOMETRY_MISMATCH, ["fixed_v2_primary_is_not_rank_one"]
    if primary_matched_fraction < float(
        thresholds["minimumPrimaryMatchedFractionForPass"]
    ):
        return BLOCKED_AMBIGUOUS, [
            "primary_edge_match_is_between_reject_and_pass_cutoffs"
        ]
    if (
        margin_over_best_alternative is None
        or margin_over_best_alternative
        < float(thresholds["minimumMarginOverBestAlternative"])
    ):
        reasons.append("margin_over_best_alternative_below_threshold")
    if (
        shifted_margin_over_best_alternative is None
        or shifted_margin_over_best_alternative
        < float(thresholds["minimumShiftedMarginOverBestAlternative"])
    ):
        reasons.append("shifted_margin_over_best_alternative_below_threshold")
    if reasons:
        return BLOCKED_AMBIGUOUS, reasons
    return PASS, ["all_frozen_face_thresholds_pass"]


def score_photo_against_candidate_masks(
    photo: np.ndarray,
    *,
    skybox_name: str,
    candidates: Mapping[str, Mapping[str, Any]],
    thresholds: Mapping[str, Any],
) -> dict[str, Any]:
    photo_magnitude = geometry.gaussian_sobel_photo_edges(photo)
    photo_mask = geometry.strongest_photo_edge_mask(photo_magnitude)
    photo_edge_count = int(np.count_nonzero(photo_mask))
    if photo_edge_count:
        distance = ndimage.distance_transform_edt(~photo_mask)
    else:
        distance = np.full(photo_mask.shape, np.inf, dtype=np.float64)
    rows: list[dict[str, Any]] = []
    for candidate_id, candidate in candidates.items():
        candidate_mask = np.asarray(candidate["mask"])
        metrics = _score_mask_with_distance(
            candidate_mask,
            distance,
            photo_edge_count=photo_edge_count,
        )
        common_support_mask = _local_shift_common_support_mask(candidate_mask)
        common_support_count = int(np.count_nonzero(common_support_mask))
        shift_rows: list[dict[str, Any]] = []
        for dy in LOCAL_SHIFT_OFFSETS_PIXELS:
            for dx in LOCAL_SHIFT_OFFSETS_PIXELS:
                shifted = _shift_mask_zero_fill(
                    common_support_mask,
                    dy=dy,
                    dx=dx,
                )
                shifted_metrics = _score_mask_with_distance(
                    shifted,
                    distance,
                    photo_edge_count=photo_edge_count,
                )
                if (
                    shifted_metrics["geometryEdgePixelCount"]
                    != common_support_count
                ):
                    raise RuntimeError(
                        "local shift left the common geometry support; border/shift constants are inconsistent"
                    )
                shift_rows.append(
                    {"dxPixels": dx, "dyPixels": dy, **shifted_metrics}
                )
        shift_rows.sort(
            key=lambda row: (
                -(
                    float(row["matchedFraction"])
                    if row["matchedFraction"] is not None
                    else -1.0
                ),
                abs(int(row["dxPixels"])) + abs(int(row["dyPixels"])),
                int(row["dyPixels"]),
                int(row["dxPixels"]),
            )
        )
        best_shift = shift_rows[0]
        common_support_unshifted = next(
            row
            for row in shift_rows
            if row["dxPixels"] == 0 and row["dyPixels"] == 0
        )
        shift_gain = (
            _round(
                float(best_shift["matchedFraction"])
                - float(common_support_unshifted["matchedFraction"]),
                9,
            )
            if common_support_unshifted["matchedFraction"] is not None
            and best_shift["matchedFraction"] is not None
            else None
        )
        grid_support = _geometry_edge_grid_support_record(candidate_mask)
        rows.append(
            {
                "candidateId": candidate_id,
                "sourceBaseSkyboxName": candidate["sourceBaseSkyboxName"],
                "quarterTurnsCounterClockwise": candidate[
                    "quarterTurnsCounterClockwise"
                ],
                "verticalMirrorAfterRotation": candidate[
                    "verticalMirrorAfterRotation"
                ],
                "mirrored": candidate["mirrored"],
                "basisDeterminant": candidate["basisDeterminant"],
                "projectedInputCount": candidate["projectedInputCount"],
                "visiblePixelCount": candidate["visiblePixelCount"],
                "occupiedPixelFraction": _round(
                    float(candidate["occupiedPixelFraction"]), 9
                ),
                **grid_support,
                "bestLocalShiftDxPixels": best_shift["dxPixels"],
                "bestLocalShiftDyPixels": best_shift["dyPixels"],
                "bestLocalShiftMatchedFraction": best_shift["matchedFraction"],
                "commonSupportUnshiftedMatchedFraction": (
                    common_support_unshifted["matchedFraction"]
                ),
                "localShiftCommonSupportGeometryEdgePixelCount": (
                    common_support_count
                ),
                "localShiftCommonSupportFractionOfFullGeometryEdges": _round(
                    common_support_count / int(metrics["geometryEdgePixelCount"]), 9
                )
                if int(metrics["geometryEdgePixelCount"])
                else 0.0,
                "localShiftGain": shift_gain,
                "shiftSensitiveDiagnostic": bool(
                    shift_gain is not None
                    and shift_gain > SHIFT_SENSITIVE_DIAGNOSTIC_GAIN
                ),
                "localShiftUsesZeroFillNoWrap": True,
                "localShiftPreservesCommonGeometrySupport": True,
                "localShiftComparisons": shift_rows,
                **metrics,
            }
        )
    rows.sort(
        key=lambda row: (
            -(
                float(row["matchedFraction"])
                if row["matchedFraction"] is not None
                else -1.0
            ),
            str(row["candidateId"]),
        )
    )
    primary_id = geometry.FIXED_V2_MAPPING[skybox_name]
    by_id = {str(row["candidateId"]): row for row in rows}
    primary = by_id[primary_id]
    primary_rank = next(
        index for index, row in enumerate(rows, start=1) if row["candidateId"] == primary_id
    )
    alternative_rows = [row for row in rows if row["candidateId"] != primary_id]
    best_alternative = alternative_rows[0]
    primary_score = primary["matchedFraction"]
    alternative_score = best_alternative["matchedFraction"]
    margin = (
        _round(float(primary_score) - float(alternative_score), 9)
        if primary_score is not None and alternative_score is not None
        else None
    )
    shifted_rows = sorted(
        rows,
        key=lambda row: (
            -(
                float(row["bestLocalShiftMatchedFraction"])
                if row["bestLocalShiftMatchedFraction"] is not None
                else -1.0
            ),
            str(row["candidateId"]),
        )
    )
    primary_shift_rank = next(
        index
        for index, row in enumerate(shifted_rows, start=1)
        if row["candidateId"] == primary_id
    )
    shifted_alternatives = [
        row for row in shifted_rows if row["candidateId"] != primary_id
    ]
    best_shifted_alternative = shifted_alternatives[0]
    shifted_margin = (
        _round(
            float(primary["bestLocalShiftMatchedFraction"])
            - float(best_shifted_alternative["bestLocalShiftMatchedFraction"]),
            9,
        )
        if primary["bestLocalShiftMatchedFraction"] is not None
        and best_shifted_alternative["bestLocalShiftMatchedFraction"] is not None
        else None
    )
    spatial_null = empirical_spatial_null_stress_test(
        np.asarray(candidates[primary_id]["mask"]),
        photo_mask,
    )
    status, reasons = classify_image_evidence(
        primary_rank=primary_rank,
        primary_matched_fraction=(
            float(primary_score) if primary_score is not None else None
        ),
        margin_over_best_alternative=margin,
        shifted_margin_over_best_alternative=shifted_margin,
        geometry_edge_pixel_count=int(primary["geometryEdgePixelCount"]),
        supported_geometry_edge_grid_cells=int(
            primary["supportedGeometryEdgeGridCellCount"]
        ),
        supported_geometry_edge_grid_rows=int(
            primary["supportedGeometryEdgeGridRowCount"]
        ),
        supported_geometry_edge_grid_columns=int(
            primary["supportedGeometryEdgeGridColumnCount"]
        ),
        represented_geometry_edge_grid_quadrants=int(
            primary["representedGeometryEdgeGridQuadrantCount"]
        ),
        geometry_edge_density=float(primary["geometryEdgeDensity"]),
        occupied_pixel_fraction=float(primary["occupiedPixelFraction"]),
        photo_edge_pixel_count=photo_edge_count,
        photo_edge_density=float(primary["photoEdgeDensity"]),
        thresholds=thresholds,
    )
    return {
        "status": status,
        "reasons": reasons,
        "primaryCandidateId": primary_id,
        "primaryRankAmong48": primary_rank,
        "primaryEvaluation": primary,
        "diagnosticWinnerCandidateId": rows[0]["candidateId"],
        "bestAlternativeCandidateId": best_alternative["candidateId"],
        "marginOverBestAlternative": margin,
        "primaryGeometryEdgeCoverage": (
            _geometry_edge_grid_support_record_from_counts(
                primary["geometryEdgeGridCellPixelCounts"]
            )
        ),
        "localShiftDiagnostic": {
            "fullSupportUnshiftedScoreS0": primary_score,
            "commonSupportUnshiftedScore": primary[
                "commonSupportUnshiftedMatchedFraction"
            ],
            "bestShiftDxPixels": primary["bestLocalShiftDxPixels"],
            "bestShiftDyPixels": primary["bestLocalShiftDyPixels"],
            "bestShiftScore": primary["bestLocalShiftMatchedFraction"],
            "gainOverUnshifted": primary["localShiftGain"],
            "shiftSensitive": bool(
                primary["localShiftGain"] is not None
                and float(primary["localShiftGain"])
                > SHIFT_SENSITIVE_DIAGNOSTIC_GAIN
            ),
            "shiftSensitiveDiagnosticOnly": True,
            "affectsDiscreteOrientationPass": False,
            "comparisons": primary["localShiftComparisons"],
            "zeroFillNoWrap": True,
            "commonGeometryAndPhotoSupport": True,
        },
        "shiftedCandidateDiagnostic": {
            "primaryRankAmong48AfterEachCandidateBestLocalShift": primary_shift_rank,
            "diagnosticWinnerCandidateId": shifted_rows[0]["candidateId"],
            "bestAlternativeCandidateId": best_shifted_alternative["candidateId"],
            "primaryMarginOverBestShiftedAlternative": shifted_margin,
            "marginAffectsDiscreteOrientationPass": True,
        },
        "spatialNullStressTest": spatial_null,
        "candidateComparisons": rows,
        "photoEdgePixelCount": photo_edge_count,
    }


def _read_organized_xyz(source: Any, scan_id: int) -> Mapping[str, Any]:
    fields = source.read_scan(
        scan_id,
        intensity=False,
        colors=False,
        row_column=True,
        transform=False,
    )
    if not isinstance(fields, Mapping):
        fail("INVALID_SCAN_RESULT", f"scan {scan_id} reader returned no field mapping")
    returned = set(str(name) for name in fields)
    forbidden = returned.intersection(POINT_COLOUR_FIELD_NAMES)
    if forbidden:
        fail(
            "POINT_COLOUR_BOUNDARY_VIOLATION",
            f"scan {scan_id} unexpectedly returned point colour fields: {sorted(forbidden)}",
        )
    unexpected = returned.difference(POINT_FIELDS_REQUESTED)
    if unexpected:
        fail(
            "POINT_FIELD_BOUNDARY_VIOLATION",
            f"scan {scan_id} returned unexpected point fields: {sorted(unexpected)}",
        )
    missing = set(POINT_FIELDS_REQUESTED).difference(returned)
    if missing:
        fail(
            "MISSING_ORGANIZED_POINT_FIELDS",
            f"scan {scan_id} is missing fields: {sorted(missing)}",
        )
    return fields


def _frozen_organized_grid_shape(
    header: Any,
    fields: Mapping[str, Any],
    *,
    scan_id: int,
) -> tuple[int, int, dict[str, Any]]:
    """Interpret this source's indexBounds maxima as exclusive grid sizes."""

    row_minimum = int(header.rowMinimum)
    column_minimum = int(header.columnMinimum)
    row_count = int(header.rowMaximum)
    column_count = int(header.columnMaximum)
    point_count = int(header.point_count)
    if row_minimum != 0 or column_minimum != 0:
        fail(
            "UNSUPPORTED_INDEX_BOUNDS",
            f"scan {scan_id} organized index minima are not zero",
        )
    if (
        row_count != SOURCE_ORGANIZED_ROW_COUNT
        or column_count != SOURCE_ORGANIZED_COLUMN_COUNT
    ):
        fail(
            "ORGANIZED_GRID_MISMATCH",
            f"scan {scan_id} does not have the frozen 1800 by 3600 grid",
        )
    if point_count != row_count * column_count:
        fail(
            "INDEX_BOUNDS_SEMANTICS_MISMATCH",
            f"scan {scan_id} point_count does not equal rowMaximum*columnMaximum",
        )
    rows = np.asarray(fields["rowIndex"])
    columns = np.asarray(fields["columnIndex"])
    if rows.ndim != 1 or columns.ndim != 1 or not len(rows) or not len(columns):
        fail("MISSING_ORGANIZED_POINT_FIELDS", f"scan {scan_id} has no returned indexes")
    try:
        row_values = rows.astype(np.float64)
        column_values = columns.astype(np.float64)
    except (TypeError, ValueError, OverflowError):
        fail("INVALID_ORGANIZED_INDEX", f"scan {scan_id} indexes are not numeric")
    if (
        not np.all(np.isfinite(row_values))
        or not np.all(np.isfinite(column_values))
        or not np.all(row_values == np.floor(row_values))
        or not np.all(column_values == np.floor(column_values))
        or float(np.min(row_values)) < 0.0
        or float(np.max(row_values)) >= row_count
        or float(np.min(column_values)) < 0.0
        or float(np.max(column_values)) >= column_count
    ):
        fail(
            "INDEX_OUTSIDE_FROZEN_GRID",
            f"scan {scan_id} returned an index outside its exclusive grid size",
        )
    return row_count, column_count, {
        "headerRowMinimum": row_minimum,
        "headerRowMaximumRaw": row_count,
        "headerColumnMinimum": column_minimum,
        "headerColumnMaximumRaw": column_count,
        "headerPointCount": point_count,
        "rowCountUsed": row_count,
        "columnCountUsed": column_count,
        "returnedValidRowIndexMinimum": int(np.min(row_values)),
        "returnedValidRowIndexMaximum": int(np.max(row_values)),
        "returnedValidColumnIndexMinimum": int(np.min(column_values)),
        "returnedValidColumnIndexMaximum": int(np.max(column_values)),
        "maximumInterpretation": "exclusive_grid_size",
        "dimensionsInferredFromSparseReturns": False,
    }


def _jpeg_record(representation: Any, *, label: str) -> dict[str, Any]:
    intrinsic = _intrinsic_record(representation, label)
    blob = representation["jpegImage"]
    size_bytes = int(blob.byteCount())
    if size_bytes <= 0 or size_bytes > MAX_IMAGE_BYTES:
        fail("INVALID_EMBEDDED_IMAGE_SIZE", f"{label} has invalid JPEG size")
    payload = bytearray(size_bytes)
    blob.read(payload, 0, size_bytes)
    digest = hashlib.sha256(payload).hexdigest()
    try:
        with Image.open(io.BytesIO(payload)) as opened:
            if opened.format != "JPEG":
                fail("IMAGE_FORMAT_MISMATCH", f"{label} is not JPEG")
            opened.load()
            rgb = opened.convert("RGB")
    except AuditError:
        raise
    except Exception as error:
        fail("IMAGE_DECODE_FAILED", f"could not decode {label}: {error}")
    source_width, source_height = rgb.size
    if (source_width, source_height) != (intrinsic["width"], intrinsic["height"]):
        fail("IMAGE_DIMENSION_MISMATCH", f"{label} dimensions differ from E57")
    analysis = np.asarray(
        rgb.resize((ANALYSIS_SIZE, ANALYSIS_SIZE), Image.Resampling.LANCZOS),
        dtype=np.uint8,
    )
    return {
        "photo": analysis,
        "sizeBytes": size_bytes,
        "sha256": digest,
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "fx": float(intrinsic["fxPixels"]) * ANALYSIS_SIZE / source_width,
        "fy": float(intrinsic["fyPixels"]) * ANALYSIS_SIZE / source_height,
        "cx": float(intrinsic["principalPointX"]) * ANALYSIS_SIZE / source_width,
        "cy": float(intrinsic["principalPointY"]) * ANALYSIS_SIZE / source_height,
        "sourceIntrinsics": {
            "fx": float(intrinsic["fxPixels"]),
            "fy": float(intrinsic["fyPixels"]),
            "cx": float(intrinsic["principalPointX"]),
            "cy": float(intrinsic["principalPointY"]),
        },
    }


def _geometry_sample_sha256(prepared: Mapping[str, Any]) -> str:
    digest = hashlib.sha256(b"OMNITWIN_RECEPTION_GEOMETRY_SAMPLE_V1\0")
    for name in (
        "points",
        "absoluteLogRangeJump",
        "surfaceNormalDiscontinuity",
    ):
        values = np.ascontiguousarray(np.asarray(prepared[name], dtype="<f8"))
        digest.update(name.encode("ascii") + b"\0")
        digest.update(values.tobytes())
    return digest.hexdigest()


def _shared_analysis_intrinsics(images: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    if len(images) != 6:
        fail("IMAGE_COUNT_MISMATCH", "a scan must have exactly six image records")
    first = {
        key: images[0][key] for key in ("fx", "fy", "cx", "cy")
    }
    for image in images[1:]:
        for key, expected in first.items():
            if not math.isclose(
                float(image[key]), float(expected), rel_tol=0.0, abs_tol=1.0e-9
            ):
                fail(
                    "INTRINSIC_MISMATCH",
                    "six-face precomputation requires identical analysis intrinsics",
                )
    return {
        **{key: float(value) for key, value in first.items()},
        "width": ANALYSIS_SIZE,
        "height": ANALYSIS_SIZE,
    }


def _aggregate_status(statuses: Sequence[str]) -> str:
    if statuses and all(status == PASS for status in statuses):
        return PASS
    if any(status == REJECT_GEOMETRY_MISMATCH for status in statuses):
        return REJECT_GEOMETRY_MISMATCH
    if any(status == BLOCKED_INSUFFICIENT_GEOMETRY for status in statuses):
        return BLOCKED_INSUFFICIENT_GEOMETRY
    return BLOCKED_AMBIGUOUS


def _validate_heldout_result_rows(
    scan_rows: Sequence[Any],
    image_rows: Sequence[Any],
) -> None:
    """Fail closed unless the held-out helper returned the exact frozen set."""

    if len(scan_rows) != len(HELD_OUT_SCAN_IDS):
        fail(
            "INVALID_HELDOUT_RESULT",
            "held-out processing did not return exactly 16 scan rows",
        )
    actual_scan_ids: list[int] = []
    for index, row in enumerate(scan_rows):
        if not isinstance(row, Mapping):
            fail(
                "INVALID_HELDOUT_RESULT",
                f"held-out scan row {index} is not an object",
            )
        scan_id = row.get("scanId")
        if not isinstance(scan_id, int) or isinstance(scan_id, bool):
            fail(
                "INVALID_HELDOUT_RESULT",
                f"held-out scan row {index} has an invalid scan ID",
            )
        if row.get("evaluationRole") != "held_out":
            fail(
                "INVALID_HELDOUT_RESULT",
                f"held-out scan {scan_id} has the wrong evaluation role",
            )
        actual_scan_ids.append(scan_id)
    if actual_scan_ids != list(HELD_OUT_SCAN_IDS):
        fail(
            "INVALID_HELDOUT_RESULT",
            "held-out scan rows are not the exact frozen scan IDs in order",
        )

    expected_pairs = {
        (scan_id, f"Skybox {face}")
        for scan_id in HELD_OUT_SCAN_IDS
        for face in range(6)
    }
    if len(image_rows) != len(expected_pairs):
        fail(
            "INVALID_HELDOUT_RESULT",
            "held-out processing did not return exactly 96 image rows",
        )
    actual_pairs: list[tuple[int, str]] = []
    for index, row in enumerate(image_rows):
        if not isinstance(row, Mapping):
            fail(
                "INVALID_HELDOUT_RESULT",
                f"held-out image row {index} is not an object",
            )
        scan_id = row.get("scanId")
        if not isinstance(scan_id, int) or isinstance(scan_id, bool):
            fail(
                "INVALID_HELDOUT_RESULT",
                f"held-out image row {index} has an invalid scan ID",
            )
        if row.get("evaluationRole") != "held_out":
            fail(
                "INVALID_HELDOUT_RESULT",
                f"held-out image row {index} has the wrong evaluation role",
            )
        actual_pairs.append((scan_id, str(row.get("name"))))
    if len(set(actual_pairs)) != len(actual_pairs) or set(actual_pairs) != expected_pairs:
        fail(
            "INVALID_HELDOUT_RESULT",
            "held-out image rows are not the exact 96 unique frozen scan/Skybox pairs",
        )


def _verify_inputs_unchanged_after_audit(
    verification: Mapping[str, Any],
    *,
    e57_path: Path,
    v2_report_path: Path,
) -> None:
    e57_after = _safe_regular_file(e57_path, "source E57", MAX_E57_BYTES)
    if not _same_file_identity(verification["e57Before"], e57_after):
        fail("FILE_CHANGED_DURING_READ", "source E57 changed during the audit")
    v2_after = _safe_regular_file(
        v2_report_path,
        "v2 colour/orientation report",
        MAX_V2_REPORT_BYTES,
    )
    if not _same_file_identity(verification["v2Before"], v2_after):
        fail("FILE_CHANGED_DURING_READ", "v2 report changed during the audit")
    prior_path = Path(verification["priorDevelopmentPath"])
    prior_after = _safe_regular_file(
        prior_path,
        "prior v1 geometry-edge development report",
        MAX_DEVELOPMENT_REPORT_BYTES,
    )
    if not _same_file_identity(
        verification["priorDevelopmentBefore"], prior_after
    ):
        fail("FILE_CHANGED_DURING_READ", "prior v1 report changed during audit")
    development_path = Path(verification["developmentPath"])
    development_after = _safe_regular_file(
        development_path,
        "geometry-edge development report",
        MAX_DEVELOPMENT_REPORT_BYTES,
    )
    if not _same_file_identity(
        verification["developmentBefore"], development_after
    ):
        fail("FILE_CHANGED_DURING_READ", "development report changed during audit")
    protocol_path = Path(verification["protocolPath"])
    protocol_after = _safe_regular_file(
        protocol_path,
        "geometry-edge protocol",
        MAX_PROTOCOL_BYTES,
    )
    if not _same_file_identity(verification["protocolBefore"], protocol_after):
        fail("FILE_CHANGED_DURING_READ", "protocol changed during the audit")
    _verify_captured_files_unchanged(verification["sourceCaptures"])


def _process_scan_set(
    source: Any,
    *,
    scan_ids: Sequence[int],
    evaluation_role: str,
    thresholds: Mapping[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Run the common geometry method on one explicit, already-authorized split."""

    if list(scan_ids) not in (list(DEVELOPMENT_SCAN_IDS), list(HELD_OUT_SCAN_IDS)):
        fail("INVALID_SCAN_SET", "runner accepts only the exact frozen split")
    root = source.image_file.root()
    data3d = root["data3D"]
    images2d = root["images2D"]
    if any(scan_id < 0 or scan_id >= data3d.childCount() for scan_id in scan_ids):
        fail("SCAN_OUT_OF_RANGE", f"a frozen {evaluation_role} scan is outside this E57")
    guid_to_image_indexes: dict[str, list[int]] = {}
    for image_index in range(images2d.childCount()):
        guid = str(images2d[image_index]["associatedData3DGuid"].value())
        guid_to_image_indexes.setdefault(guid, []).append(image_index)

    image_rows: list[dict[str, Any]] = []
    scan_rows: list[dict[str, Any]] = []
    all_image_guids: set[str] = set()
    all_jpeg_hashes: set[str] = set()
    for scan_id in scan_ids:
        header = source.get_header(scan_id)
        fields = _read_organized_xyz(source, scan_id)
        row_count, column_count, grid_evidence = _frozen_organized_grid_shape(
            header,
            fields,
            scan_id=scan_id,
        )
        prepared = geometry.prepare_geometry_samples(
            fields,
            row_count=row_count,
            column_count=column_count,
        )
        data3d_guid = str(data3d[scan_id]["guid"].value())
        image_indexes = sorted(
            guid_to_image_indexes.get(data3d_guid, []),
            key=lambda index: (
                str(images2d[index]["name"].value()),
                str(images2d[index]["guid"].value()),
            ),
        )
        if len(image_indexes) != 6:
            fail("IMAGE_COUNT_MISMATCH", f"scan {scan_id} has {len(image_indexes)} images")
        image_records: list[dict[str, Any]] = []
        for image_index in image_indexes:
            node = images2d[image_index]
            name = str(node["name"].value())
            if name not in geometry.FIXED_V2_MAPPING:
                fail("IMAGE_NAME_SET_MISMATCH", f"scan {scan_id} contains {name!r}")
            image_guid = str(node["guid"].value())
            if image_guid in all_image_guids:
                fail("DUPLICATE_IMAGE2D_GUID", f"image GUID {image_guid} is repeated")
            all_image_guids.add(image_guid)
            jpeg = _jpeg_record(
                node["pinholeRepresentation"],
                label=f"scan {scan_id} {name}",
            )
            if jpeg["sha256"] in all_jpeg_hashes:
                fail("DUPLICATE_IMAGE_BYTES", f"scan {scan_id} {name} repeats JPEG bytes")
            all_jpeg_hashes.add(jpeg["sha256"])
            image_records.append(
                {
                    "image2DIndex": image_index,
                    "image2DGuid": image_guid,
                    "name": name,
                    **jpeg,
                }
            )
        if {record["name"] for record in image_records} != set(
            geometry.FIXED_V2_MAPPING
        ):
            fail("IMAGE_NAME_SET_MISMATCH", f"scan {scan_id} lacks the exact six names")
        intrinsics = _shared_analysis_intrinsics(image_records)
        base_coordinates = precompute_six_base_projection_coordinates(prepared)
        candidates = rasterize_48_candidate_geometry_masks(
            base_coordinates,
            **intrinsics,
        )
        per_scan_rows: list[dict[str, Any]] = []
        for image in sorted(image_records, key=lambda record: record["name"]):
            score = score_photo_against_candidate_masks(
                np.asarray(image["photo"]),
                skybox_name=str(image["name"]),
                candidates=candidates,
                thresholds=thresholds,
            )
            row = {
                "scanId": scan_id,
                "evaluationRole": evaluation_role,
                "data3DGuid": data3d_guid,
                "image2DIndex": image["image2DIndex"],
                "image2DGuid": image["image2DGuid"],
                "name": image["name"],
                "jpeg": {
                    "sha256": image["sha256"],
                    "sizeBytes": image["sizeBytes"],
                    "width": image["sourceWidth"],
                    "height": image["sourceHeight"],
                },
                "declaredSourceIntrinsics": image["sourceIntrinsics"],
                "analysisIntrinsics": intrinsics,
                **score,
                "continuousCalibrationValidated": False,
                "metricGeometryValidated": False,
                "knownPoseMaterializationPermitted": False,
                "trainingPermitted": False,
            }
            image_rows.append(row)
            per_scan_rows.append(row)
        scan_status = _aggregate_status([str(row["status"]) for row in per_scan_rows])
        scan_rows.append(
            {
                "scanId": scan_id,
                "evaluationRole": evaluation_role,
                "data3DGuid": data3d_guid,
                "status": scan_status,
                "allSixFacesPassDiscreteGeometryOrientation": all(
                    row["status"] == PASS for row in per_scan_rows
                ),
                "majorityVoteUsed": False,
                "fullGridShape": prepared["fullGridShape"],
                "organizedGridEvidence": grid_evidence,
                "decimatedGridShape": prepared["gridShape"],
                "validDecimatedPointCount": prepared["validPointCount"],
                "geometrySampleSha256": _geometry_sample_sha256(prepared),
                "returnedPointFields": list(POINT_FIELDS_REQUESTED),
                "pointColourFieldsRequestedOrRead": False,
                "baseContinuousCoordinateFramesPrecomputed": 6,
                "candidateMasksIndependentlyRasterized": 48,
                "rasterMaskRotationUsedAsProjectionSubstitute": False,
                "continuousCalibrationValidated": False,
                "metricGeometryValidated": False,
                "knownPoseMaterializationPermitted": False,
                "trainingPermitted": False,
            }
        )
    return scan_rows, image_rows


def _verify_development_inputs(
    *,
    e57_path: Path,
    v2_report_path: Path,
    prior_development_report_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    if output_path.exists():
        fail("OUTPUT_EXISTS", "development output already exists; evidence is create-only")
    _, prior_receipt, prior_before = _read_and_validate_prior_development_report(
        prior_development_report_path
    )
    e57_before = _safe_regular_file(e57_path, "source E57", MAX_E57_BYTES)
    source_sha256 = _sha256_file(e57_path, e57_before, MAX_E57_BYTES)
    v2_report, v2_receipt, v2_before = _read_json_with_receipt(
        v2_report_path,
        label="v2 colour/orientation report",
        maximum_bytes=MAX_V2_REPORT_BYTES,
        invalid_code="INVALID_V2_REPORT",
    )
    _validate_v2_report(
        v2_report,
        source_size=e57_before.st_size,
        source_sha256=source_sha256,
    )
    source_records, source_captures = _capture_implementation_sources()
    versions = _dependency_versions()
    if versions["pye57"] == "unavailable":
        fail("PYE57_UNAVAILABLE", "pye57 is required for the development run")
    return {
        "e57Before": e57_before,
        "sourceE57": {
            "fileName": e57_path.name,
            "sizeBytes": e57_before.st_size,
            "sha256": source_sha256,
        },
        "v2Before": v2_before,
        "v2Receipt": {
            **v2_receipt,
            "schemaVersion": v2_report.get("schemaVersion"),
            "payloadSha256": v2_report.get("payloadSha256"),
        },
        "priorDevelopmentReceipt": prior_receipt,
        "priorDevelopmentBefore": prior_before,
        "priorDevelopmentPath": prior_development_report_path,
        "sourceRecords": source_records,
        "sourceCaptures": source_captures,
        "dependencyVersions": versions,
    }


def _verify_development_inputs_unchanged(
    verification: Mapping[str, Any],
    *,
    e57_path: Path,
    v2_report_path: Path,
    prior_development_report_path: Path,
) -> None:
    e57_after = _safe_regular_file(e57_path, "source E57", MAX_E57_BYTES)
    if not _same_file_identity(verification["e57Before"], e57_after):
        fail("FILE_CHANGED_DURING_READ", "source E57 changed during development run")
    v2_after = _safe_regular_file(
        v2_report_path,
        "v2 colour/orientation report",
        MAX_V2_REPORT_BYTES,
    )
    if not _same_file_identity(verification["v2Before"], v2_after):
        fail("FILE_CHANGED_DURING_READ", "v2 report changed during development run")
    prior_after = _safe_regular_file(
        prior_development_report_path,
        "prior v1 geometry-edge development report",
        MAX_DEVELOPMENT_REPORT_BYTES,
    )
    if not _same_file_identity(
        verification["priorDevelopmentBefore"], prior_after
    ):
        fail(
            "FILE_CHANGED_DURING_READ",
            "prior v1 development report changed during development run",
        )
    _verify_captured_files_unchanged(verification["sourceCaptures"])


def _numeric_summary(values: Sequence[float]) -> dict[str, float] | None:
    if not values:
        return None
    array = np.asarray(values, dtype=np.float64)
    return {
        "minimum": _round(float(np.min(array)), 9),
        "median": _round(float(np.median(array)), 9),
        "maximum": _round(float(np.max(array)), 9),
    }


def _exact_phase_diagnostic_summary(
    image_rows: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    records = [row["spatialNullStressTest"] for row in image_rows]
    status_counts = {
        status: sum(record.get("status") == status for record in records)
        for status in (
            EXACT_PHASE_UNIQUE,
            EXACT_PHASE_NONUNIQUE,
            EXACT_PHASE_UNASSESSABLE,
        )
    }
    return {
        "decisionRole": EXACT_PHASE_DIAGNOSTIC,
        "decisionTarget": "pixel_location_uniqueness",
        "affectsDiscreteOrientationPass": False,
        "continuousCalibrationValidated": False,
        "statusCounts": status_counts,
        "geometryPixelsInRoi": _numeric_summary(
            [float(record["geometryPixelsInRoi"]) for record in records]
        ),
        "observedHitCount": _numeric_summary(
            [float(record["observedHitCount"]) for record in records]
        ),
        "observedMatchedFraction": _numeric_summary(
            [
                float(record["observedMatchedFraction"])
                for record in records
                if record["observedMatchedFraction"] is not None
            ]
        ),
        "tailCountNullHitsGreaterThanOrEqualObserved": _numeric_summary(
            [
                float(record["tailCountNullHitsGreaterThanOrEqualObserved"])
                for record in records
            ]
        ),
        "q99NullHitCount": _numeric_summary(
            [float(record["q99NullHitCount"]) for record in records]
        ),
        "observedMinusQ99Fraction": _numeric_summary(
            [
                float(record["observedMinusQ99Fraction"])
                for record in records
                if record["observedMinusQ99Fraction"] is not None
            ]
        ),
    }


def _geometry_coverage_summary(
    image_rows: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    records = [row["primaryGeometryEdgeCoverage"] for row in image_rows]
    return {
        "distributedSupportAffectsDiscreteOrientationPass": True,
        "distributedSupportPassCount": sum(
            record["distributedGeometryEdgeSupportPasses"]
            for record in records
        ),
        "distributedSupportFailCount": sum(
            not record["distributedGeometryEdgeSupportPasses"]
            for record in records
        ),
        "supportedCellCount": _numeric_summary(
            [float(record["supportedGeometryEdgeGridCellCount"]) for record in records]
        ),
        "supportedRowCount": _numeric_summary(
            [float(record["supportedGeometryEdgeGridRowCount"]) for record in records]
        ),
        "supportedColumnCount": _numeric_summary(
            [float(record["supportedGeometryEdgeGridColumnCount"]) for record in records]
        ),
        "representedQuadrantCount": _numeric_summary(
            [
                float(record["representedGeometryEdgeGridQuadrantCount"])
                for record in records
            ]
        ),
        "legacyAtLeast24SupportedCellsDiagnosticOnly": True,
        "legacyDiagnosticAffectsDiscreteOrientationPass": False,
        "legacyAtLeast24PassCount": sum(
            record[
                "legacyAtLeast24SupportedGeometryEdgeGridCellsDiagnosticPasses"
            ]
            for record in records
        ),
        "legacyAtLeast24FailCount": sum(
            not record[
                "legacyAtLeast24SupportedGeometryEdgeGridCellsDiagnosticPasses"
            ]
            for record in records
        ),
    }


def run_development(
    *,
    e57_path: Path,
    v2_report_path: Path,
    prior_development_report_path: Path,
    output_path: Path,
    minimum_primary_matched_fraction_to_avoid_reject: float,
    minimum_primary_matched_fraction_for_pass: float,
    minimum_margin_over_best_alternative: float,
    minimum_shifted_margin_over_best_alternative: float,
    minimum_geometry_edge_pixels: int,
    minimum_occupied_pixel_fraction: float,
) -> dict[str, Any]:
    """Run exactly the seven development scans; never open a held-out scan."""

    thresholds = _threshold_record(
        minimum_primary_matched_fraction_to_avoid_reject=(
            minimum_primary_matched_fraction_to_avoid_reject
        ),
        minimum_primary_matched_fraction_for_pass=(
            minimum_primary_matched_fraction_for_pass
        ),
        minimum_margin_over_best_alternative=minimum_margin_over_best_alternative,
        minimum_shifted_margin_over_best_alternative=(
            minimum_shifted_margin_over_best_alternative
        ),
        minimum_geometry_edge_pixels=minimum_geometry_edge_pixels,
        minimum_occupied_pixel_fraction=minimum_occupied_pixel_fraction,
    )
    verification = _verify_development_inputs(
        e57_path=e57_path,
        v2_report_path=v2_report_path,
        prior_development_report_path=prior_development_report_path,
        output_path=output_path,
    )
    try:
        import pye57
    except ImportError:
        fail("PYE57_UNAVAILABLE", "pye57 is required for the development run")
    source = pye57.E57(str(e57_path))
    scan_rows, image_rows = _process_scan_set(
        source,
        scan_ids=DEVELOPMENT_SCAN_IDS,
        evaluation_role="development",
        thresholds=thresholds,
    )
    if len(scan_rows) != 7 or len(image_rows) != 42:
        fail("DEVELOPMENT_INCOMPLETE", "development run did not produce 7 scans/42 faces")
    overall_status = _aggregate_status([str(row["status"]) for row in image_rows])
    primary_scores = [
        float(row["primaryEvaluation"]["matchedFraction"])
        for row in image_rows
        if row["primaryEvaluation"]["matchedFraction"] is not None
    ]
    unshifted_margins = [
        float(row["marginOverBestAlternative"])
        for row in image_rows
        if row["marginOverBestAlternative"] is not None
    ]
    shifted_margins = [
        float(
            row["shiftedCandidateDiagnostic"][
                "primaryMarginOverBestShiftedAlternative"
            ]
        )
        for row in image_rows
        if row["shiftedCandidateDiagnostic"][
            "primaryMarginOverBestShiftedAlternative"
        ]
        is not None
    ]
    shift_gains = [
        float(row["localShiftDiagnostic"]["gainOverUnshifted"])
        for row in image_rows
        if row["localShiftDiagnostic"]["gainOverUnshifted"] is not None
    ]
    report = {
        "schemaVersion": DEVELOPMENT_REPORT_SCHEMA_VERSION,
        "scope": {
            "sourceE57": verification["sourceE57"],
            "frozenV2ColourOrientationReport": verification["v2Receipt"],
            "frozenPriorV1DevelopmentReport": verification[
                "priorDevelopmentReceipt"
            ],
            "postDevelopmentRuleChange": True,
            "developmentScanIdsRead": list(DEVELOPMENT_SCAN_IDS),
            "heldOutScanIdsRead": [],
            "heldOutScansOpened": False,
            "heldOutMeaning": HELD_OUT_SCOPE_MEANING,
            "scanCount": len(scan_rows),
            "imageCount": len(image_rows),
        },
        "implementation": {
            "sourceFiles": verification["sourceRecords"],
            "dependencyVersions": verification["dependencyVersions"],
        },
        "methodConstants": _method_constants(),
        "acceptanceThresholdsEvaluated": thresholds,
        "pointDataBoundary": {
            "readScanArguments": {
                "intensity": False,
                "colors": False,
                "row_column": True,
                "transform": False,
            },
            "allowedReturnedPointFields": list(POINT_FIELDS_REQUESTED),
            "pointColourFieldsRequestedOrRead": False,
        },
        "result": {
            "statusUnderEvaluatedThresholds": overall_status,
            "all42PrimaryRankOneUnshifted": all(
                row["primaryRankAmong48"] == 1 for row in image_rows
            ),
            "all42PrimaryRankOneAfterAllCandidateLocalShifts": all(
                row["shiftedCandidateDiagnostic"][
                    "primaryRankAmong48AfterEachCandidateBestLocalShift"
                ]
                == 1
                for row in image_rows
            ),
            "exactPhaseDiagnostic": _exact_phase_diagnostic_summary(image_rows),
            "geometryCoverage": _geometry_coverage_summary(image_rows),
            "primaryMatchedFraction": _numeric_summary(primary_scores),
            "unshiftedMarginM0": _numeric_summary(unshifted_margins),
            "allCandidatesShiftedMarginMs": _numeric_summary(shifted_margins),
            "primaryShiftGainDiagnostic": _numeric_summary(shift_gains),
            "shiftSensitiveFaceCount": sum(
                bool(row["localShiftDiagnostic"]["shiftSensitive"])
                for row in image_rows
            ),
            "continuousCalibrationValidated": False,
            "metricGeometryValidated": False,
            "knownPoseMaterializationPermitted": False,
            "trainingPermitted": False,
        },
        "methodRevision": _method_revision_record(),
        "tuningNote": _development_tuning_note(),
        "scans": scan_rows,
        "images": image_rows,
        "developmentEvidenceProvenanceLimit": (
            DEVELOPMENT_EVIDENCE_PROVENANCE_LIMIT
        ),
        "authority": "none",
        "selfDigestMeaning": {
            "authenticatesCreator": False,
            "provesTimestamp": False,
            "provesImmutability": False,
        },
    }
    _verify_development_inputs_unchanged(
        verification,
        e57_path=e57_path,
        v2_report_path=v2_report_path,
        prior_development_report_path=prior_development_report_path,
    )
    finalized = _finalize(report, DEVELOPMENT_REPORT_DIGEST_DOMAIN)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_create_only(output_path, _canonical_json_bytes(finalized) + b"\n")
    return finalized


def run_audit(
    *,
    protocol_path: Path,
    e57_path: Path,
    v2_report_path: Path,
    prior_development_report_path: Path,
    development_report_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    verification = verify_protocol_inputs(
        protocol_path=protocol_path,
        e57_path=e57_path,
        v2_report_path=v2_report_path,
        prior_development_report_path=prior_development_report_path,
        development_report_path=development_report_path,
        output_path=output_path,
    )
    protocol = verification["protocol"]
    thresholds = protocol["acceptanceThresholds"]
    try:
        import pye57
    except ImportError:
        fail("PYE57_UNAVAILABLE", "pye57 is required to run the audit")

    # No E57 object is constructed until every frozen hash above has passed.
    source = pye57.E57(str(e57_path))
    scan_rows, image_rows = _process_scan_set(
        source,
        scan_ids=HELD_OUT_SCAN_IDS,
        evaluation_role="held_out",
        thresholds=thresholds,
    )
    _validate_heldout_result_rows(scan_rows, image_rows)

    overall_status = _aggregate_status([str(row["status"]) for row in image_rows])
    status_counts = {
        status: sum(row["status"] == status for row in image_rows)
        for status in (
            PASS,
            REJECT_GEOMETRY_MISMATCH,
            BLOCKED_INSUFFICIENT_GEOMETRY,
            BLOCKED_AMBIGUOUS,
        )
    }
    report = {
        "schemaVersion": REPORT_SCHEMA_VERSION,
        "protocol": verification["protocolReceipt"],
        "scope": {
            "sourceE57": protocol["scope"]["sourceE57"],
            "frozenV2ColourOrientationReport": protocol["scope"][
                "frozenV2ColourOrientationReport"
            ],
            "frozenPriorV1DevelopmentReport": protocol["scope"][
                "frozenPriorV1DevelopmentReport"
            ],
            "postDevelopmentRuleChange": True,
            "frozenDevelopmentReport": protocol["scope"][
                "frozenDevelopmentReport"
            ],
            "developmentScanIdsNotReadByThisAudit": list(DEVELOPMENT_SCAN_IDS),
            "heldOutScanIdsRead": list(HELD_OUT_SCAN_IDS),
            "heldOutMeaning": HELD_OUT_SCOPE_MEANING,
            "developmentEvidenceProvenanceLimit": (
                DEVELOPMENT_EVIDENCE_PROVENANCE_LIMIT
            ),
            "scanCount": len(scan_rows),
            "imageCount": len(image_rows),
        },
        "runtime": {
            "dependencyVersions": _dependency_versions(),
            "implementationSourcesVerifiedBeforeAndAfter": protocol[
                "implementation"
            ]["sourceFiles"],
        },
        "methodConstants": protocol["methodConstants"],
        "methodRevision": protocol["methodRevision"],
        "acceptanceThresholds": thresholds,
        "pointDataBoundary": protocol["pointDataBoundary"],
        "result": {
            "status": overall_status,
            "statusCounts": status_counts,
            "everyHeldOutFacePasses": bool(image_rows)
            and all(row["status"] == PASS for row in image_rows),
            "coarseDiscreteGeometryOrientationGatePassed": overall_status == PASS,
            "fixedV2MappingWasNeverReplacedByDiagnosticWinner": True,
            "stationMajorityVoteUsed": False,
            "pointColourFieldsRequestedOrRead": False,
            "exactPhaseDiagnostic": _exact_phase_diagnostic_summary(image_rows),
            "geometryCoverage": _geometry_coverage_summary(image_rows),
            "continuousCalibrationValidated": False,
            "metricGeometryValidated": False,
            "knownPoseMaterializationPermitted": False,
            "trainingPermitted": False,
            "plainLanguage": (
                "Every face in the metric-held-out set passed the frozen test that compares XYZ/row/column LiDAR shape edges with embedded-JPEG edges; no LiDAR point RGB was read. This supports the six discrete face directions, but still does not authorize materialization or training."
                if overall_status == PASS
                else "At least one face in the metric-held-out set rejected or could not satisfy the frozen XYZ/row/column LiDAR-shape-versus-embedded-JPEG edge test; no LiDAR point RGB was read. The discrete geometry gate has not passed, and materialization/training remain forbidden."
            ),
        },
        "scans": scan_rows,
        "images": image_rows,
        "requiredBeforeMaterialization": [
            "Resolve every non-PASS face; a station majority cannot upgrade it.",
            "Validate continuous focal length, principal point, lens distortion, camera centre, metric depth, and inter-station registration.",
            "Complete full-resolution human privacy review and approve explicit masks.",
            "Obtain authoritative rights approval for the intended commercial processing and training purpose.",
        ],
        "authority": "none",
        "selfDigestMeaning": protocol["selfDigestMeaning"],
    }
    _verify_inputs_unchanged_after_audit(
        verification,
        e57_path=e57_path,
        v2_report_path=v2_report_path,
    )
    finalized = _finalize(report, REPORT_DIGEST_DOMAIN)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_create_only(output_path, _canonical_json_bytes(finalized) + b"\n")
    return finalized


def _add_threshold_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--minimum-primary-matched-fraction-to-avoid-reject",
        type=float,
        default=DEFAULT_MINIMUM_PRIMARY_MATCHED_FRACTION_TO_AVOID_REJECT,
    )
    parser.add_argument(
        "--minimum-primary-matched-fraction-for-pass",
        type=float,
        default=DEFAULT_MINIMUM_PRIMARY_MATCHED_FRACTION_FOR_PASS,
    )
    parser.add_argument(
        "--minimum-margin-over-best-alternative",
        type=float,
        default=DEFAULT_MINIMUM_MARGIN_OVER_BEST_ALTERNATIVE,
    )
    parser.add_argument(
        "--minimum-shifted-margin-over-best-alternative",
        type=float,
        default=DEFAULT_MINIMUM_SHIFTED_MARGIN_OVER_BEST_ALTERNATIVE,
    )
    parser.add_argument(
        "--minimum-geometry-edge-pixels",
        type=int,
        default=DEFAULT_MINIMUM_GEOMETRY_EDGE_PIXELS,
    )
    parser.add_argument(
        "--minimum-occupied-pixel-fraction",
        type=float,
        default=DEFAULT_MINIMUM_OCCUPIED_PIXEL_FRACTION,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Freeze or run the no-point-colour E57/JPEG geometry-edge audit."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser(
        "create-protocol",
        help="hash inputs and write a create-only frozen protocol; no scan is decoded",
    )
    create.add_argument("--e57", required=True, type=Path)
    create.add_argument("--v2-report", required=True, type=Path)
    create.add_argument("--prior-development-report", required=True, type=Path)
    create.add_argument("--development-report", required=True, type=Path)
    create.add_argument("--output", required=True, type=Path)
    create.add_argument("--audit-output-file-name", required=True)
    _add_threshold_arguments(create)

    development = subparsers.add_parser(
        "run-development",
        help="read exactly the seven development scans and write a create-only report",
    )
    development.add_argument("--e57", required=True, type=Path)
    development.add_argument("--v2-report", required=True, type=Path)
    development.add_argument("--prior-development-report", required=True, type=Path)
    development.add_argument("--output", required=True, type=Path)
    _add_threshold_arguments(development)

    run = subparsers.add_parser(
        "run-audit",
        help="verify the frozen protocol, then read only its held-out scans",
    )
    run.add_argument("--protocol", required=True, type=Path)
    run.add_argument("--e57", required=True, type=Path)
    run.add_argument("--v2-report", required=True, type=Path)
    run.add_argument("--prior-development-report", required=True, type=Path)
    run.add_argument("--development-report", required=True, type=Path)
    run.add_argument("--output", required=True, type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "create-protocol":
            create_protocol(
                e57_path=args.e57.resolve(strict=True),
                v2_report_path=args.v2_report.resolve(strict=True),
                prior_development_report_path=(
                    args.prior_development_report.resolve(strict=True)
                ),
                development_report_path=args.development_report.resolve(strict=True),
                output_path=args.output.resolve(),
                audit_output_file_name=args.audit_output_file_name,
                minimum_primary_matched_fraction_to_avoid_reject=(
                    args.minimum_primary_matched_fraction_to_avoid_reject
                ),
                minimum_primary_matched_fraction_for_pass=(
                    args.minimum_primary_matched_fraction_for_pass
                ),
                minimum_margin_over_best_alternative=args.minimum_margin_over_best_alternative,
                minimum_shifted_margin_over_best_alternative=(
                    args.minimum_shifted_margin_over_best_alternative
                ),
                minimum_geometry_edge_pixels=args.minimum_geometry_edge_pixels,
                minimum_occupied_pixel_fraction=args.minimum_occupied_pixel_fraction,
            )
        elif args.command == "run-development":
            run_development(
                e57_path=args.e57.resolve(strict=True),
                v2_report_path=args.v2_report.resolve(strict=True),
                prior_development_report_path=(
                    args.prior_development_report.resolve(strict=True)
                ),
                output_path=args.output.resolve(),
                minimum_primary_matched_fraction_to_avoid_reject=(
                    args.minimum_primary_matched_fraction_to_avoid_reject
                ),
                minimum_primary_matched_fraction_for_pass=(
                    args.minimum_primary_matched_fraction_for_pass
                ),
                minimum_margin_over_best_alternative=args.minimum_margin_over_best_alternative,
                minimum_shifted_margin_over_best_alternative=(
                    args.minimum_shifted_margin_over_best_alternative
                ),
                minimum_geometry_edge_pixels=args.minimum_geometry_edge_pixels,
                minimum_occupied_pixel_fraction=args.minimum_occupied_pixel_fraction,
            )
        else:
            run_audit(
                protocol_path=args.protocol.resolve(strict=True),
                e57_path=args.e57.resolve(strict=True),
                v2_report_path=args.v2_report.resolve(strict=True),
                prior_development_report_path=(
                    args.prior_development_report.resolve(strict=True)
                ),
                development_report_path=args.development_report.resolve(strict=True),
                output_path=args.output.resolve(),
            )
        return 0
    except (AuditError, FileNotFoundError, ValueError, KeyError, TypeError) as error:
        if isinstance(error, AuditError):
            code, message = error.code, error.message
        else:
            code, message = "INVALID_ARGUMENT", str(error)
        sys.stderr.write(
            _canonical_json_bytes({"error": {"code": code, "message": message}}).decode(
                "utf-8"
            )
            + "\n"
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
