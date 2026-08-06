from __future__ import annotations

import copy
import hashlib
import inspect
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

import numpy as np


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))
REPO_ROOT = Path(__file__).resolve().parents[3]
PRIOR_V1_DEVELOPMENT_PATH = (
    REPO_ROOT
    / "docs"
    / "reports"
    / "reception-room-e57-geometry-edge-development-2026-07-14.json"
)

import audit_e57_geometry_edge_protocol as protocol  # noqa: E402
import audit_e57_geometry_edges as geometry  # noqa: E402
from audit_e57_room_images import AuditError, _canonical_json_bytes  # noqa: E402


def _fake_v2_report(source_payload: bytes) -> dict[str, object]:
    source_sha256 = hashlib.sha256(source_payload).hexdigest()
    payload: dict[str, object] = {
        "schemaVersion": protocol.V2_REPORT_SCHEMA_VERSION,
        "scope": {
            "sourceE57SizeBytes": len(source_payload),
            "sourceE57Sha256": source_sha256,
        },
        "result": {
            "coarseDiscreteRigAxisMappingPassesInternalColourGate": True,
            "fixedMappingBySkyboxName": dict(geometry.FIXED_V2_MAPPING),
        },
        "authority": "none",
    }
    return protocol._finalize(payload, protocol.V2_REPORT_DIGEST_DOMAIN)


def _thresholds(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "minimumPrimaryMatchedFractionToAvoidReject": 0.30,
        "minimumPrimaryMatchedFractionForPass": 0.35,
        "minimumMarginOverBestAlternative": 0.02,
        "minimumShiftedMarginOverBestAlternative": 0.02,
        "minimumGeometryEdgePixels": 5000,
        "minimumOccupiedPixelFraction": 0.45,
        "minimumPhotoEdgePixels": 1,
        "minimumDistributedGeometryEdgeGridCells": 12,
        "minimumDistributedGeometryEdgeGridRows": 3,
        "minimumDistributedGeometryEdgeGridColumns": 3,
        "requiredDistributedGeometryEdgeGridQuadrants": 4,
        "legacyMinimumWellSupportedGeometryEdgeGridCellsDiagnosticOnly": 24,
        "minimumGeometryEdgeDensity": 0.02,
        "maximumGeometryEdgeDensity": 0.15,
        "minimumPhotoEdgeDensity": 0.02,
        "maximumPhotoEdgeDensity": 0.15,
        "requiredPrimaryRankAmong48": 1,
    }
    values.update(overrides)
    return values


def _file_receipt(path: Path) -> dict[str, object]:
    payload = path.read_bytes()
    return {
        "fileName": path.name,
        "sizeBytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


_SYNTHETIC_FACE_SCORE_CACHE: dict[str, dict[str, dict[str, object]]] = {}


def _synthetic_face_scores(
    thresholds: dict[str, object],
) -> dict[str, dict[str, object]]:
    cache_key = hashlib.sha256(_canonical_json_bytes(thresholds)).hexdigest()
    cached = _SYNTHETIC_FACE_SCORE_CACHE.get(cache_key)
    if cached is not None:
        return copy.deepcopy(cached)

    rng = np.random.default_rng(142857)
    primary_mask = np.zeros((protocol.ANALYSIS_SIZE, protocol.ANALYSIS_SIZE), dtype=bool)
    primary_mask.flat[
        rng.choice(primary_mask.size, size=10000, replace=False)
    ] = True
    alternative_mask = np.zeros_like(primary_mask)
    alternative_mask.flat[
        rng.choice(alternative_mask.size, size=10000, replace=False)
    ] = True
    scores: dict[str, dict[str, object]] = {}
    for skybox_name, primary_id in geometry.FIXED_V2_MAPPING.items():
        candidates: dict[str, dict[str, object]] = {}
        for candidate_id in geometry.CANDIDATE_BY_ID:
            metadata = protocol._expected_candidate_projection_metadata(candidate_id)
            candidates[candidate_id] = {
                "mask": (
                    primary_mask.copy()
                    if candidate_id == primary_id
                    else alternative_mask.copy()
                ),
                **metadata,
                "projectedInputCount": 170000,
                "visiblePixelCount": 160000,
                "occupiedPixelFraction": 160000 / (protocol.ANALYSIS_SIZE**2),
            }
        with (
            mock.patch.object(
                protocol.geometry,
                "gaussian_sobel_photo_edges",
                return_value=np.zeros(
                    (protocol.ANALYSIS_SIZE, protocol.ANALYSIS_SIZE),
                    dtype=np.float64,
                ),
            ),
            mock.patch.object(
                protocol.geometry,
                "strongest_photo_edge_mask",
                return_value=primary_mask,
            ),
        ):
            scores[skybox_name] = protocol.score_photo_against_candidate_masks(
                np.zeros(
                    (protocol.ANALYSIS_SIZE, protocol.ANALYSIS_SIZE), dtype=np.uint8
                ),
                skybox_name=skybox_name,
                candidates=candidates,
                thresholds=thresholds,
            )
    _SYNTHETIC_FACE_SCORE_CACHE[cache_key] = copy.deepcopy(scores)
    return scores


def _fake_development_report(
    *,
    source_path: Path,
    v2_path: Path,
    v2: dict[str, object],
    thresholds: dict[str, object],
) -> dict[str, object]:
    source_payload = source_path.read_bytes()
    source_record = {
        "fileName": source_path.name,
        "sizeBytes": len(source_payload),
        "sha256": hashlib.sha256(source_payload).hexdigest(),
    }
    v2_receipt = {
        **_file_receipt(v2_path),
        "schemaVersion": v2["schemaVersion"],
        "payloadSha256": v2["payloadSha256"],
    }
    source_records, _ = protocol._capture_implementation_sources()
    face_scores = _synthetic_face_scores(thresholds)
    scans: list[dict[str, object]] = []
    images: list[dict[str, object]] = []
    for scan_id in protocol.DEVELOPMENT_SCAN_IDS:
        data3d_guid = f"{scan_id:032x}"
        per_scan_images: list[dict[str, object]] = []
        for face in range(6):
            skybox_name = f"Skybox {face}"
            image_key = scan_id * 10 + face
            image = {
                "scanId": scan_id,
                "evaluationRole": "development",
                "data3DGuid": data3d_guid,
                "image2DIndex": image_key,
                "image2DGuid": f"{image_key:032x}",
                "name": skybox_name,
                "jpeg": {
                    "sha256": hashlib.sha256(
                        f"synthetic-jpeg-{scan_id}-{face}".encode("ascii")
                    ).hexdigest(),
                    "sizeBytes": 100000 + image_key,
                    "width": 4096,
                    "height": 4096,
                },
                "declaredSourceIntrinsics": {
                    "fx": 2048.0,
                    "fy": 2048.0,
                    "cx": 2048.0,
                    "cy": 2048.0,
                },
                "analysisIntrinsics": {
                    "fx": 256.0,
                    "fy": 256.0,
                    "cx": 256.0,
                    "cy": 256.0,
                    "width": protocol.ANALYSIS_SIZE,
                    "height": protocol.ANALYSIS_SIZE,
                },
                **copy.deepcopy(face_scores[skybox_name]),
                "continuousCalibrationValidated": False,
                "metricGeometryValidated": False,
                "knownPoseMaterializationPermitted": False,
                "trainingPermitted": False,
            }
            per_scan_images.append(image)
            images.append(image)
        scans.append(
            {
                "scanId": scan_id,
                "evaluationRole": "development",
                "data3DGuid": data3d_guid,
                "status": protocol.PASS,
                "allSixFacesPassDiscreteGeometryOrientation": True,
                "majorityVoteUsed": False,
                "fullGridShape": [1800, 3600],
                "organizedGridEvidence": {
                    "headerRowMinimum": 0,
                    "headerRowMaximumRaw": 1800,
                    "headerColumnMinimum": 0,
                    "headerColumnMaximumRaw": 3600,
                    "headerPointCount": 6480000,
                    "rowCountUsed": 1800,
                    "columnCountUsed": 3600,
                    "returnedValidRowIndexMinimum": 248,
                    "returnedValidRowIndexMaximum": 1715,
                    "returnedValidColumnIndexMinimum": 0,
                    "returnedValidColumnIndexMaximum": 3599,
                    "maximumInterpretation": "exclusive_grid_size",
                    "dimensionsInferredFromSparseReturns": False,
                },
                "decimatedGridShape": [900, 1800],
                "validDecimatedPointCount": 1500000,
                "geometrySampleSha256": hashlib.sha256(
                    f"synthetic-geometry-{scan_id}".encode("ascii")
                ).hexdigest(),
                "returnedPointFields": list(protocol.POINT_FIELDS_REQUESTED),
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
    primary_scores = [
        float(image["primaryEvaluation"]["matchedFraction"]) for image in images
    ]
    unshifted_margins = [
        float(image["marginOverBestAlternative"]) for image in images
    ]
    shifted_margins = [
        float(
            image["shiftedCandidateDiagnostic"][
                "primaryMarginOverBestShiftedAlternative"
            ]
        )
        for image in images
    ]
    shift_gains = [
        float(image["localShiftDiagnostic"]["gainOverUnshifted"])
        for image in images
    ]
    report: dict[str, object] = {
        "schemaVersion": protocol.DEVELOPMENT_REPORT_SCHEMA_VERSION,
        "scope": {
            "sourceE57": source_record,
            "frozenV2ColourOrientationReport": v2_receipt,
            "frozenPriorV1DevelopmentReport": (
                protocol._expected_prior_development_receipt()
            ),
            "postDevelopmentRuleChange": True,
            "developmentScanIdsRead": list(protocol.DEVELOPMENT_SCAN_IDS),
            "heldOutScanIdsRead": [],
            "heldOutScansOpened": False,
            "heldOutMeaning": protocol.HELD_OUT_SCOPE_MEANING,
            "scanCount": 7,
            "imageCount": 42,
        },
        "implementation": {
            "sourceFiles": source_records,
            "dependencyVersions": protocol._dependency_versions(),
        },
        "methodConstants": protocol._method_constants(),
        "acceptanceThresholdsEvaluated": thresholds,
        "pointDataBoundary": {
            "readScanArguments": {
                "intensity": False,
                "colors": False,
                "row_column": True,
                "transform": False,
            },
            "allowedReturnedPointFields": list(protocol.POINT_FIELDS_REQUESTED),
            "pointColourFieldsRequestedOrRead": False,
        },
        "result": {
            "statusUnderEvaluatedThresholds": protocol.PASS,
            "all42PrimaryRankOneUnshifted": True,
            "all42PrimaryRankOneAfterAllCandidateLocalShifts": True,
            "exactPhaseDiagnostic": protocol._exact_phase_diagnostic_summary(images),
            "geometryCoverage": protocol._geometry_coverage_summary(images),
            "primaryMatchedFraction": protocol._numeric_summary(primary_scores),
            "unshiftedMarginM0": protocol._numeric_summary(unshifted_margins),
            "allCandidatesShiftedMarginMs": protocol._numeric_summary(
                shifted_margins
            ),
            "primaryShiftGainDiagnostic": protocol._numeric_summary(shift_gains),
            "shiftSensitiveFaceCount": sum(gain > 0.01 for gain in shift_gains),
            "continuousCalibrationValidated": False,
            "metricGeometryValidated": False,
            "knownPoseMaterializationPermitted": False,
            "trainingPermitted": False,
        },
        "methodRevision": protocol._method_revision_record(),
        "tuningNote": protocol._development_tuning_note(),
        "scans": scans,
        "images": images,
        "developmentEvidenceProvenanceLimit": (
            protocol.DEVELOPMENT_EVIDENCE_PROVENANCE_LIMIT
        ),
        "authority": "none",
        "selfDigestMeaning": {
            "authenticatesCreator": False,
            "provesTimestamp": False,
            "provesImmutability": False,
        },
    }
    return protocol._finalize(report, protocol.DEVELOPMENT_REPORT_DIGEST_DOMAIN)


def _write_fake_development_report(
    *,
    path: Path,
    source_path: Path,
    v2_path: Path,
    v2: dict[str, object],
    thresholds: dict[str, object],
) -> dict[str, object]:
    finalized = _fake_development_report(
        source_path=source_path,
        v2_path=v2_path,
        v2=v2,
        thresholds=thresholds,
    )
    path.write_bytes(_canonical_json_bytes(finalized) + b"\n")
    return finalized


def _development_validation_kwargs(
    *,
    source_path: Path,
    v2_path: Path,
    v2: dict[str, object],
    thresholds: dict[str, object],
) -> dict[str, object]:
    source_payload = source_path.read_bytes()
    source_records, _ = protocol._capture_implementation_sources()
    return {
        "source_record": {
            "fileName": source_path.name,
            "sizeBytes": len(source_payload),
            "sha256": hashlib.sha256(source_payload).hexdigest(),
        },
        "v2_receipt": {
            **_file_receipt(v2_path),
            "schemaVersion": v2["schemaVersion"],
            "payloadSha256": v2["payloadSha256"],
        },
        "prior_development_receipt": (
            protocol._expected_prior_development_receipt()
        ),
        "implementation_sources": source_records,
        "dependency_versions": protocol._dependency_versions(),
        "thresholds": thresholds,
    }


def _refinalize_development_report(report: dict[str, object]) -> dict[str, object]:
    payload = copy.deepcopy(report)
    payload.pop("payloadSha256", None)
    return protocol._finalize(payload, protocol.DEVELOPMENT_REPORT_DIGEST_DOMAIN)


class E57GeometryEdgeProtocolTests(unittest.TestCase):
    def test_success_status_is_explicitly_discrete_orientation_only(self) -> None:
        self.assertEqual(
            protocol.PASS,
            "PASS_DISCRETE_GEOMETRY_ORIENTATION",
        )

    def test_exact_prior_v1_development_report_binding_verifies(self) -> None:
        report, receipt, _ = protocol._read_and_validate_prior_development_report(
            PRIOR_V1_DEVELOPMENT_PATH
        )
        self.assertEqual(receipt, protocol._expected_prior_development_receipt())
        self.assertEqual(
            report["schemaVersion"],
            protocol.PRIOR_DEVELOPMENT_REPORT_SCHEMA_VERSION,
        )

    def test_altered_prior_v1_development_report_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / protocol.PRIOR_DEVELOPMENT_REPORT_FILE_NAME
            path.write_bytes(PRIOR_V1_DEVELOPMENT_PATH.read_bytes() + b" ")
            with self.assertRaises(AuditError) as caught:
                protocol._read_and_validate_prior_development_report(path)
        self.assertEqual(
            caught.exception.code, "PRIOR_DEVELOPMENT_REPORT_MISMATCH"
        )

    def test_missing_prior_v1_development_report_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / protocol.PRIOR_DEVELOPMENT_REPORT_FILE_NAME
            with self.assertRaises(AuditError):
                protocol._read_and_validate_prior_development_report(path)

    def test_redigested_substitute_prior_v1_report_is_rejected(self) -> None:
        substitute = protocol._finalize(
            {
                "schemaVersion": protocol.PRIOR_DEVELOPMENT_REPORT_SCHEMA_VERSION,
                "result": {"statusUnderEvaluatedThresholds": protocol.PASS},
            },
            protocol.PRIOR_DEVELOPMENT_REPORT_DIGEST_DOMAIN,
        )
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / protocol.PRIOR_DEVELOPMENT_REPORT_FILE_NAME
            path.write_bytes(_canonical_json_bytes(substitute) + b"\n")
            with self.assertRaises(AuditError) as caught:
                protocol._read_and_validate_prior_development_report(path)
        self.assertEqual(
            caught.exception.code, "PRIOR_DEVELOPMENT_REPORT_MISMATCH"
        )

    def test_geometry_protocol_schemas_and_digest_domains_are_v2(self) -> None:
        self.assertTrue(protocol.PROTOCOL_SCHEMA_VERSION.endswith(".v2"))
        self.assertTrue(protocol.REPORT_SCHEMA_VERSION.endswith(".v2"))
        self.assertTrue(protocol.DEVELOPMENT_REPORT_SCHEMA_VERSION.endswith(".v2"))
        self.assertIn(b"_V2\0", protocol.PROTOCOL_DIGEST_DOMAIN)
        self.assertIn(b"_V2\0", protocol.REPORT_DIGEST_DOMAIN)
        self.assertIn(b"_V2\0", protocol.DEVELOPMENT_REPORT_DIGEST_DOMAIN)
        self.assertTrue(protocol.V2_REPORT_SCHEMA_VERSION.endswith(".v1"))

    def test_exact_phase_diagnostic_has_no_orientation_veto_path(self) -> None:
        parameters = inspect.signature(protocol.classify_image_evidence).parameters
        self.assertFalse(any("null" in name for name in parameters))
        source = Path(protocol.__file__).read_text(encoding="utf-8")
        for stale_gate_text in (
            "spatial_null_common_support_is_not_assessable",
            "empirical_spatial_null_stress_test_did_not_pass",
            "all42SpatialNullStressTestsPass",
            "passes density, coverage, and empirical spatial-null gates",
        ):
            self.assertNotIn(stale_gate_text, source)

    def test_every_command_requires_prior_development_report_argument(self) -> None:
        parser = protocol._build_parser()
        commands = {
            "run-development": [
                "--e57", "source.e57", "--v2-report", "colour.json",
                "--output", "development-v2.json",
            ],
            "create-protocol": [
                "--e57", "source.e57", "--v2-report", "colour.json",
                "--development-report", "development-v2.json",
                "--output", "protocol-v2.json",
                "--audit-output-file-name", "heldout-v2.json",
            ],
            "run-audit": [
                "--protocol", "protocol-v2.json", "--e57", "source.e57",
                "--v2-report", "colour.json",
                "--development-report", "development-v2.json",
                "--output", "heldout-v2.json",
            ],
        }
        for command, arguments in commands.items():
            with self.subTest(command=command):
                with self.assertRaises(SystemExit):
                    parser.parse_args([command, *arguments])
                parsed = parser.parse_args(
                    [
                        command,
                        *arguments,
                        "--prior-development-report",
                        protocol.PRIOR_DEVELOPMENT_REPORT_FILE_NAME,
                    ]
                )
                self.assertEqual(
                    parsed.prior_development_report.name,
                    protocol.PRIOR_DEVELOPMENT_REPORT_FILE_NAME,
                )

    def test_six_continuous_frames_match_direct_48_projections_exactly(self) -> None:
        rng = np.random.default_rng(2419)
        random_points = rng.normal(size=(800, 3)).astype(np.float64)
        # Include cardinal and exact-pixel-boundary rays.  These are the cases
        # where rotating an already-rasterized even-sized mask can be wrong.
        boundary_points = np.asarray(
            [
                [0.0, 0.0, 1.0],
                [1.0 / 256.0, 0.0, 1.0],
                [0.0, 1.0 / 256.0, 1.0],
                [-1.0 / 256.0, 0.0, 1.0],
                [0.0, -1.0 / 256.0, 1.0],
                [1.0, 0.0, 0.05],
                [1.0, 0.0, 50.0],
            ],
            dtype=np.float64,
        )
        points = np.vstack([random_points, boundary_points])
        jumps = rng.random(len(points))
        normals = rng.random(len(points))
        prepared = {
            "points": points,
            "absoluteLogRangeJump": jumps,
            "surfaceNormalDiscontinuity": normals,
        }

        bases = protocol.precompute_six_base_projection_coordinates(prepared)

        produced_ids: set[str] = set()
        for base in bases.values():
            for quarter_turns in range(4):
                for mirrored in (False, True):
                    candidate_id, transformed = (
                        protocol._rasterize_candidate_from_base_coordinates(
                            base,
                            quarter_turns_counter_clockwise=quarter_turns,
                            mirrored=mirrored,
                            fx=32.0,
                            fy=32.0,
                            cx=32.0,
                            cy=32.0,
                            width=64,
                            height=64,
                        )
                    )
                    produced_ids.add(candidate_id)
                    candidate = geometry.CANDIDATE_BY_ID[candidate_id]
                    direct = geometry.project_geometry_signals_zbuffer(
                        points,
                        jumps,
                        normals,
                        forward=candidate["forward"],
                        right=candidate["right"],
                        down=candidate["down"],
                        fx=32.0,
                        fy=32.0,
                        cx=32.0,
                        cy=32.0,
                        width=64,
                        height=64,
                    )
                    for key in (
                        "absoluteLogRangeJumpImage",
                        "surfaceNormalDiscontinuityImage",
                        "occupiedMask",
                    ):
                        np.testing.assert_array_equal(transformed[key], direct[key])
                    self.assertEqual(
                        transformed["projectedInputCount"],
                        direct["projectedInputCount"],
                    )
                    self.assertEqual(
                        transformed["visiblePixelCount"], direct["visiblePixelCount"]
                    )
        self.assertEqual(produced_ids, set(geometry.CANDIDATE_BY_ID))

    def test_48_masks_are_rasterized_without_rotating_a_raster_mask(self) -> None:
        rng = np.random.default_rng(99)
        prepared = {
            "points": rng.normal(size=(300, 3)),
            "absoluteLogRangeJump": rng.random(300),
            "surfaceNormalDiscontinuity": rng.random(300),
        }
        bases = protocol.precompute_six_base_projection_coordinates(prepared)

        with mock.patch.object(
            protocol.np,
            "rot90",
            side_effect=AssertionError("raster mask rotation is forbidden"),
        ):
            candidates = protocol.rasterize_48_candidate_geometry_masks(
                bases,
                fx=32.0,
                fy=32.0,
                cx=32.0,
                cy=32.0,
                width=64,
                height=64,
            )

        self.assertEqual(set(candidates), set(geometry.CANDIDATE_BY_ID))
        self.assertEqual(sum(not row["mirrored"] for row in candidates.values()), 24)
        self.assertEqual(sum(row["mirrored"] for row in candidates.values()), 24)

    def test_scan_reader_requests_no_colour_and_rejects_colour_return(self) -> None:
        fields = {
            "cartesianX": np.asarray([0.0]),
            "cartesianY": np.asarray([0.0]),
            "cartesianZ": np.asarray([1.0]),
            "rowIndex": np.asarray([0]),
            "columnIndex": np.asarray([0]),
        }
        source = mock.Mock()
        source.read_scan.return_value = fields

        returned = protocol._read_organized_xyz(source, 123)

        self.assertIs(returned, fields)
        source.read_scan.assert_called_once_with(
            123,
            intensity=False,
            colors=False,
            row_column=True,
            transform=False,
        )

        source.read_scan.return_value = {**fields, "colorRed": np.asarray([255])}
        with self.assertRaisesRegex(AuditError, "point colour"):
            protocol._read_organized_xyz(source, 123)

    def test_zero_fill_shift_never_wraps(self) -> None:
        mask = np.zeros((12, 12), dtype=bool)
        mask[4, 4] = True
        mask[4, 7] = True

        shifted = protocol._shift_mask_zero_fill(mask, dy=-4, dx=-4)

        self.assertTrue(shifted[0, 0])
        self.assertTrue(shifted[0, 3])
        self.assertEqual(np.count_nonzero(shifted), 2)
        self.assertFalse(shifted[-1, -1])

        edge = np.zeros((12, 12), dtype=bool)
        edge[0, 0] = True
        shifted_edge = protocol._shift_mask_zero_fill(edge, dy=-4, dx=-4)
        self.assertFalse(np.any(shifted_edge))

        formal = np.zeros((64, 64), dtype=bool)
        formal[8, 8] = True
        formal[12, 12] = True
        common = protocol._local_shift_common_support_mask(formal)
        self.assertFalse(common[8, 8])
        self.assertTrue(common[12, 12])
        for dy in protocol.LOCAL_SHIFT_OFFSETS_PIXELS:
            for dx in protocol.LOCAL_SHIFT_OFFSETS_PIXELS:
                shifted_common = protocol._shift_mask_zero_fill(
                    common, dy=dy, dx=dx
                )
                rows, columns = np.nonzero(shifted_common)
                self.assertTrue(np.all(rows >= geometry.EDGE_BORDER_PIXELS))
                self.assertTrue(np.all(columns >= geometry.EDGE_BORDER_PIXELS))

    def test_face_decisions_keep_reject_and_blocked_distinct(self) -> None:
        passing = {
            "primary_rank": 1,
            "primary_matched_fraction": 0.50,
            "margin_over_best_alternative": 0.08,
            "shifted_margin_over_best_alternative": 0.06,
            "geometry_edge_pixel_count": 8000,
            "supported_geometry_edge_grid_cells": 22,
            "supported_geometry_edge_grid_rows": 6,
            "supported_geometry_edge_grid_columns": 6,
            "represented_geometry_edge_grid_quadrants": 4,
            "geometry_edge_density": 0.05,
            "occupied_pixel_fraction": 0.60,
            "photo_edge_pixel_count": 1000,
            "photo_edge_density": 0.08,
            "thresholds": _thresholds(),
        }
        status, _ = protocol.classify_image_evidence(**passing)
        self.assertEqual(status, protocol.PASS)

    def test_exact_phase_status_cannot_change_a_discrete_pass(self) -> None:
        face_evidence = {
            "primary_rank": 1,
            "primary_matched_fraction": 0.50,
            "margin_over_best_alternative": 0.08,
            "shifted_margin_over_best_alternative": 0.06,
            "geometry_edge_pixel_count": 8000,
            "supported_geometry_edge_grid_cells": 22,
            "supported_geometry_edge_grid_rows": 6,
            "supported_geometry_edge_grid_columns": 6,
            "represented_geometry_edge_grid_quadrants": 4,
            "geometry_edge_density": 0.05,
            "occupied_pixel_fraction": 0.60,
            "photo_edge_pixel_count": 1000,
            "photo_edge_density": 0.08,
            "thresholds": _thresholds(),
        }
        for exact_phase_status in (
            protocol.EXACT_PHASE_UNIQUE,
            protocol.EXACT_PHASE_NONUNIQUE,
            protocol.EXACT_PHASE_UNASSESSABLE,
        ):
            with self.subTest(status=exact_phase_status):
                diagnostic = {
                    "decisionRole": protocol.EXACT_PHASE_DIAGNOSTIC,
                    "status": exact_phase_status,
                    "affectsDiscreteOrientationPass": False,
                }
                status, _ = protocol.classify_image_evidence(**face_evidence)
                self.assertEqual(status, protocol.PASS)
                self.assertFalse(diagnostic["affectsDiscreteOrientationPass"])

        passing = face_evidence
        status, reasons = protocol.classify_image_evidence(
            **{**passing, "geometry_edge_pixel_count": 4999}
        )
        self.assertEqual(status, protocol.BLOCKED_INSUFFICIENT_GEOMETRY)
        self.assertIn("geometry_edge_pixel_count_below_threshold", reasons)

        status, reasons = protocol.classify_image_evidence(
            **{
                **passing,
                "primary_rank": 2,
                "margin_over_best_alternative": -0.01,
            }
        )
        self.assertEqual(status, protocol.REJECT_GEOMETRY_MISMATCH)
        self.assertIn("fixed_v2_primary_is_not_rank_one", reasons)

        status, reasons = protocol.classify_image_evidence(
            **{**passing, "margin_over_best_alternative": 0.0}
        )
        self.assertEqual(status, protocol.BLOCKED_AMBIGUOUS)
        self.assertEqual(reasons, ["fixed_v2_primary_is_tied_for_top_score"])

        status, reasons = protocol.classify_image_evidence(
            **{
                **passing,
                "primary_rank": 2,
                "margin_over_best_alternative": -0.000000001,
            }
        )
        self.assertEqual(status, protocol.REJECT_GEOMETRY_MISMATCH)
        self.assertEqual(reasons, ["fixed_v2_primary_is_not_rank_one"])

        status, reasons = protocol.classify_image_evidence(
            **{
                **passing,
                "primary_rank": 2,
                "margin_over_best_alternative": 0.0,
            }
        )
        self.assertEqual(status, protocol.BLOCKED_AMBIGUOUS)
        self.assertEqual(reasons, ["fixed_v2_primary_is_tied_for_top_score"])

        status, reasons = protocol.classify_image_evidence(
            **{**passing, "represented_geometry_edge_grid_quadrants": 1}
        )
        self.assertEqual(status, protocol.BLOCKED_INSUFFICIENT_GEOMETRY)
        self.assertIn(
            "geometry_edge_support_does_not_cover_all_quadrants", reasons
        )

        status, reasons = protocol.classify_image_evidence(
            **{**passing, "margin_over_best_alternative": 0.019}
        )
        self.assertEqual(status, protocol.BLOCKED_AMBIGUOUS)
        self.assertIn("margin_over_best_alternative_below_threshold", reasons)

        status, reasons = protocol.classify_image_evidence(
            **{**passing, "shifted_margin_over_best_alternative": 0.019}
        )
        self.assertEqual(status, protocol.BLOCKED_AMBIGUOUS)
        self.assertIn("shifted_margin_over_best_alternative_below_threshold", reasons)

        status, reasons = protocol.classify_image_evidence(
            **{**passing, "primary_matched_fraction": 0.32}
        )
        self.assertEqual(status, protocol.BLOCKED_AMBIGUOUS)
        self.assertIn(
            "primary_edge_match_is_between_reject_and_pass_cutoffs", reasons
        )

        status, _ = protocol.classify_image_evidence(
            **{**passing, "primary_matched_fraction": 0.29}
        )
        self.assertEqual(status, protocol.REJECT_GEOMETRY_MISMATCH)

        status, _ = protocol.classify_image_evidence(
            **{**passing, "primary_matched_fraction": 0.30}
        )
        self.assertEqual(status, protocol.BLOCKED_AMBIGUOUS)
        status, _ = protocol.classify_image_evidence(
            **{**passing, "primary_matched_fraction": 0.35}
        )
        self.assertEqual(status, protocol.PASS)

    def test_station_aggregation_never_uses_majority_to_hide_failure(self) -> None:
        self.assertEqual(protocol._aggregate_status([protocol.PASS] * 6), protocol.PASS)
        self.assertEqual(
            protocol._aggregate_status(
                [protocol.PASS] * 5 + [protocol.REJECT_GEOMETRY_MISMATCH]
            ),
            protocol.REJECT_GEOMETRY_MISMATCH,
        )
        self.assertEqual(
            protocol._aggregate_status([protocol.PASS] * 5 + [protocol.BLOCKED_AMBIGUOUS]),
            protocol.BLOCKED_AMBIGUOUS,
        )
        self.assertEqual(
            protocol._aggregate_status(
                [protocol.PASS] * 5
                + [protocol.BLOCKED_INSUFFICIENT_GEOMETRY]
            ),
            protocol.BLOCKED_INSUFFICIENT_GEOMETRY,
        )

    def test_frozen_grid_uses_header_maxima_as_exclusive_sizes(self) -> None:
        header = mock.Mock(
            rowMinimum=0,
            rowMaximum=1800,
            columnMinimum=0,
            columnMaximum=3600,
            point_count=1800 * 3600,
        )
        fields = {
            "rowIndex": np.asarray([248, 800, 1715]),
            "columnIndex": np.asarray([0, 1800, 3599]),
        }

        rows, columns, evidence = protocol._frozen_organized_grid_shape(
            header,
            fields,
            scan_id=122,
        )

        self.assertEqual((rows, columns), (1800, 3600))
        self.assertEqual(evidence["headerPointCount"], 6_480_000)
        self.assertEqual(evidence["maximumInterpretation"], "exclusive_grid_size")
        self.assertFalse(evidence["dimensionsInferredFromSparseReturns"])
        self.assertNotEqual((rows, columns), (1801, 3601))

        bad_fields = {**fields, "rowIndex": np.asarray([1800])}
        with self.assertRaisesRegex(AuditError, "outside"):
            protocol._frozen_organized_grid_shape(
                header,
                bad_fields,
                scan_id=122,
            )

    def test_grid_coverage_requires_25_pixels_in_each_counted_cell(self) -> None:
        mask = np.zeros((512, 512), dtype=bool)
        # One pixel in each of 64 cells is not meaningful coverage.
        for row in range(8):
            for column in range(8):
                mask[row * 64 + 10, column * 64 + 10] = True
        self.assertEqual(protocol._well_supported_geometry_edge_grid_cells(mask), 0)

        mask[:] = False
        mask[10:15, 10:15] = True
        mask[10:15, 74:79] = True
        self.assertEqual(protocol._well_supported_geometry_edge_grid_cells(mask), 2)

    def test_known_good_distributed_geometry_support_passes(self) -> None:
        counts = [0] * 64
        for row, column in (
            (0, 0),
            (0, 4),
            (1, 1),
            (1, 5),
            (2, 2),
            (2, 6),
            (4, 0),
            (4, 4),
            (5, 1),
            (5, 5),
            (6, 2),
            (6, 6),
        ):
            counts[row * 8 + column] = 25
        support = protocol._geometry_edge_grid_support_record_from_counts(counts)
        self.assertTrue(support["distributedGeometryEdgeSupportPasses"])
        self.assertEqual(support["supportedGeometryEdgeGridCellCount"], 12)
        self.assertEqual(support["representedGeometryEdgeGridQuadrantCount"], 4)
        status, _ = protocol.classify_image_evidence(
            primary_rank=1,
            primary_matched_fraction=0.50,
            margin_over_best_alternative=0.08,
            shifted_margin_over_best_alternative=0.06,
            geometry_edge_pixel_count=8000,
            supported_geometry_edge_grid_cells=12,
            supported_geometry_edge_grid_rows=support[
                "supportedGeometryEdgeGridRowCount"
            ],
            supported_geometry_edge_grid_columns=support[
                "supportedGeometryEdgeGridColumnCount"
            ],
            represented_geometry_edge_grid_quadrants=4,
            geometry_edge_density=0.05,
            occupied_pixel_fraction=0.60,
            photo_edge_pixel_count=1000,
            photo_edge_density=0.08,
            thresholds=_thresholds(),
        )
        self.assertEqual(status, protocol.PASS)

    def test_twelve_cells_clustered_in_one_quadrant_fail_distribution(self) -> None:
        counts = [0] * 64
        for row, column in (
            (0, 0), (0, 1), (0, 2),
            (1, 0), (1, 1), (1, 2),
            (2, 0), (2, 1), (2, 2),
            (3, 0), (3, 1), (3, 2),
        ):
            counts[row * 8 + column] = 25
        support = protocol._geometry_edge_grid_support_record_from_counts(counts)
        self.assertEqual(support["supportedGeometryEdgeGridCellCount"], 12)
        self.assertFalse(support["distributedGeometryEdgeSupportPasses"])
        self.assertEqual(support["supportedGeometryEdgeGridQuadrants"], ["TOP_LEFT"])
        status, reasons = protocol.classify_image_evidence(
            primary_rank=1,
            primary_matched_fraction=0.50,
            margin_over_best_alternative=0.08,
            shifted_margin_over_best_alternative=0.06,
            geometry_edge_pixel_count=8000,
            supported_geometry_edge_grid_cells=12,
            supported_geometry_edge_grid_rows=4,
            supported_geometry_edge_grid_columns=3,
            represented_geometry_edge_grid_quadrants=1,
            geometry_edge_density=0.05,
            occupied_pixel_fraction=0.60,
            photo_edge_pixel_count=1000,
            photo_edge_density=0.08,
            thresholds=_thresholds(),
        )
        self.assertEqual(status, protocol.BLOCKED_INSUFFICIENT_GEOMETRY)
        self.assertIn("geometry_edge_support_does_not_cover_all_quadrants", reasons)

    def test_broad_22_cell_support_passes_while_legacy24_is_false(self) -> None:
        counts = [0] * 64
        coordinates = (
            (0, 0), (0, 4), (1, 1), (1, 5), (2, 2), (2, 6),
            (3, 3), (3, 7), (4, 0), (4, 4), (5, 1), (5, 5),
            (6, 2), (6, 6), (7, 3), (7, 7), (0, 1), (1, 4),
            (4, 1), (5, 4), (2, 3), (6, 7),
        )
        for row, column in coordinates:
            counts[row * 8 + column] = 25
        support = protocol._geometry_edge_grid_support_record_from_counts(counts)
        self.assertEqual(support["supportedGeometryEdgeGridCellCount"], 22)
        self.assertTrue(support["distributedGeometryEdgeSupportPasses"])
        self.assertFalse(
            support[
                "legacyAtLeast24SupportedGeometryEdgeGridCellsDiagnosticPasses"
            ]
        )
        status, _ = protocol.classify_image_evidence(
            primary_rank=1,
            primary_matched_fraction=0.50,
            margin_over_best_alternative=0.08,
            shifted_margin_over_best_alternative=0.06,
            geometry_edge_pixel_count=8000,
            supported_geometry_edge_grid_cells=22,
            supported_geometry_edge_grid_rows=8,
            supported_geometry_edge_grid_columns=8,
            represented_geometry_edge_grid_quadrants=4,
            geometry_edge_density=0.05,
            occupied_pixel_fraction=0.60,
            photo_edge_pixel_count=1000,
            photo_edge_density=0.08,
            thresholds=_thresholds(),
        )
        self.assertEqual(status, protocol.PASS)

    def test_spatial_null_offsets_and_common_support_are_frozen(self) -> None:
        self.assertEqual(len(protocol.SPATIAL_NULL_OFFSETS), 240)
        self.assertEqual(protocol.SPATIAL_NULL_OFFSETS[0], (-75, -75))
        self.assertEqual(protocol.SPATIAL_NULL_OFFSETS[-1], (75, 75))
        self.assertTrue(
            all(max(abs(dx), abs(dy)) > 15 for dx, dy in protocol.SPATIAL_NULL_OFFSETS)
        )
        self.assertEqual(
            protocol._spatial_null_offset_digest(),
            "a7781324e0edf47895a413e84812297fe56d54db53ca36a374ac3375c2c0622c",
        )
        self.assertEqual(protocol.SPATIAL_NULL_MAXIMUM_TAIL_COUNT, 1)
        self.assertEqual(protocol.SPATIAL_NULL_Q99_SORTED_INDEX, 237)
        self.assertEqual(protocol.SPATIAL_NULL_MINIMUM_GAP_FRACTION, 0.02)

    def test_spatial_null_applies_dx_to_columns_and_dy_to_rows(self) -> None:
        geometry_mask = np.zeros((512, 512), dtype=bool)
        photo_mask = np.zeros_like(geometry_mask)
        row, column = 200, 300
        dx, dy = 25, -35
        geometry_mask[row, column] = True
        photo_mask[row + dy, column + dx] = True

        result = protocol.empirical_spatial_null_stress_test(
            geometry_mask,
            photo_mask,
        )
        hits = result["nullHitCountsInFrozenOffsetOrder"]

        self.assertEqual(result["observedHitCount"], 0)
        self.assertEqual(result["geometryPixelsInRoi"], 1)
        self.assertEqual(sum(hits), 1)
        self.assertEqual(protocol.SPATIAL_NULL_OFFSETS[74], (25, -35))
        self.assertEqual(hits[74], 1)
        self.assertEqual(protocol.SPATIAL_NULL_OFFSETS[148], (-35, 25))
        self.assertEqual(hits[148], 0)
        self.assertEqual(protocol.SPATIAL_NULL_OFFSETS[165], (-25, 35))
        self.assertEqual(hits[165], 0)
        self.assertEqual(protocol.SPATIAL_NULL_OFFSETS[91], (35, -25))
        self.assertEqual(hits[91], 0)

    def test_exact_phase_diagnostic_reports_unique_distributed_alignment(self) -> None:
        rng = np.random.default_rng(84)
        geometry_mask = np.zeros((512, 512), dtype=bool)
        flat_choices = rng.choice(342 * 342, size=5000, replace=False)
        rows = flat_choices // 342 + 85
        columns = flat_choices % 342 + 85
        geometry_mask[rows, columns] = True
        photo_mask = geometry_mask.copy()

        result = protocol.empirical_spatial_null_stress_test(
            geometry_mask,
            photo_mask,
        )

        self.assertTrue(result["assessable"])
        self.assertEqual(result["decisionRole"], protocol.EXACT_PHASE_DIAGNOSTIC)
        self.assertEqual(result["status"], protocol.EXACT_PHASE_UNIQUE)
        self.assertFalse(result["affectsDiscreteOrientationPass"])
        self.assertFalse(result["continuousCalibrationValidated"])
        self.assertEqual(result["geometryPixelsInRoi"], 5000)
        self.assertEqual(result["observedHitCount"], 5000)
        self.assertEqual(result["nullOffsetCount"], 240)
        self.assertEqual(
            result["nullHitCountsSha256"],
            hashlib.sha256(
                b"OMNITWIN_RECEPTION_GEOMETRY_SPATIAL_NULL_HITS_V1\0"
                + _canonical_json_bytes(
                    result["nullHitCountsInFrozenOffsetOrder"]
                )
            ).hexdigest(),
        )
        self.assertLessEqual(result["tailCountNullHitsGreaterThanOrEqualObserved"], 1)
        self.assertGreaterEqual(result["observedMinusQ99Fraction"], 0.02)

    def test_exact_phase_diagnostic_reports_sparse_support_unassessable(self) -> None:
        geometry_mask = np.zeros((512, 512), dtype=bool)
        geometry_mask[100:110, 100:110] = True
        photo_mask = geometry_mask.copy()

        result = protocol.empirical_spatial_null_stress_test(
            geometry_mask,
            photo_mask,
        )

        self.assertFalse(result["assessable"])
        self.assertEqual(result["status"], protocol.EXACT_PHASE_UNASSESSABLE)
        self.assertFalse(result["affectsDiscreteOrientationPass"])
        self.assertFalse(
            result["assessabilityChecks"]["minimumGeometryPixelsInRoi"]
        )

    def test_exact_phase_diagnostic_reports_nonunique_when_offsets_tie(self) -> None:
        rng = np.random.default_rng(85)
        geometry_mask = np.zeros((512, 512), dtype=bool)
        choices = rng.choice(342 * 342, size=5000, replace=False)
        geometry_mask[choices // 342 + 85, choices % 342 + 85] = True
        photo_mask = np.ones_like(geometry_mask)

        result = protocol.empirical_spatial_null_stress_test(
            geometry_mask,
            photo_mask,
        )

        self.assertTrue(result["assessable"])
        self.assertEqual(result["status"], protocol.EXACT_PHASE_NONUNIQUE)
        self.assertEqual(
            result["tailCountNullHitsGreaterThanOrEqualObserved"], 240
        )
        self.assertFalse(result["affectsDiscreteOrientationPass"])

    def test_full_face_scoring_applies_m0_ms_and_reports_exact_phase(self) -> None:
        rng = np.random.default_rng(731)
        primary_mask = np.zeros((512, 512), dtype=bool)
        primary_indexes = rng.choice(512 * 512, size=10000, replace=False)
        primary_mask.flat[primary_indexes] = True
        alternative_mask = np.zeros_like(primary_mask)
        alternative_indexes = rng.choice(512 * 512, size=10000, replace=False)
        alternative_mask.flat[alternative_indexes] = True
        primary_id = geometry.FIXED_V2_MAPPING["Skybox 0"]
        candidates: dict[str, dict[str, object]] = {}
        for candidate_id, candidate in geometry.CANDIDATE_BY_ID.items():
            candidates[candidate_id] = {
                "mask": (
                    primary_mask.copy()
                    if candidate_id == primary_id
                    else alternative_mask.copy()
                ),
                "sourceBaseSkyboxName": "Skybox 0",
                "quarterTurnsCounterClockwise": 0,
                "verticalMirrorAfterRotation": bool(candidate["mirrored"]),
                "mirrored": bool(candidate["mirrored"]),
                "basisDeterminant": float(candidate["basisDeterminant"]),
                "visiblePixelCount": 160000,
                "projectedInputCount": 170000,
                "occupiedPixelFraction": 0.61,
            }
        with (
            mock.patch.object(
                protocol.geometry,
                "gaussian_sobel_photo_edges",
                return_value=np.zeros((512, 512), dtype=np.float64),
            ),
            mock.patch.object(
                protocol.geometry,
                "strongest_photo_edge_mask",
                return_value=primary_mask,
            ),
        ):
            result = protocol.score_photo_against_candidate_masks(
                np.zeros((512, 512), dtype=np.uint8),
                skybox_name="Skybox 0",
                candidates=candidates,
                thresholds=_thresholds(),
            )

        self.assertEqual(result["status"], protocol.PASS)
        self.assertEqual(result["primaryRankAmong48"], 1)
        self.assertGreaterEqual(result["marginOverBestAlternative"], 0.02)
        self.assertGreaterEqual(
            result["shiftedCandidateDiagnostic"][
                "primaryMarginOverBestShiftedAlternative"
            ],
            0.02,
        )
        self.assertEqual(
            result["spatialNullStressTest"]["status"],
            protocol.EXACT_PHASE_UNIQUE,
        )
        self.assertFalse(
            result["spatialNullStressTest"]["affectsDiscreteOrientationPass"]
        )
        self.assertTrue(
            result["primaryGeometryEdgeCoverage"][
                "distributedGeometryEdgeSupportPasses"
            ]
        )
        self.assertEqual(
            len(
                result["primaryEvaluation"][
                    "geometryEdgeGridCellPixelCounts"
                ]
            ),
            64,
        )
        self.assertIn(
            "supportedGeometryEdgeGridRowIndexes", result["primaryEvaluation"]
        )
        self.assertIn(
            "supportedGeometryEdgeGridColumnIndexes", result["primaryEvaluation"]
        )
        self.assertIn(
            "supportedGeometryEdgeGridQuadrants", result["primaryEvaluation"]
        )
        self.assertEqual(len(result["candidateComparisons"]), 48)
        self.assertFalse(
            result["localShiftDiagnostic"]["affectsDiscreteOrientationPass"]
        )

    def test_development_validator_accepts_complete_recomputed_evidence(self) -> None:
        source_payload = b"synthetic-complete-development-source"
        thresholds = _thresholds()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_path = root / "cloud_0.e57"
            source_path.write_bytes(source_payload)
            v2_path = root / "v2.json"
            v2 = _fake_v2_report(source_payload)
            v2_path.write_bytes(_canonical_json_bytes(v2) + b"\n")
            report = _fake_development_report(
                source_path=source_path,
                v2_path=v2_path,
                v2=v2,
                thresholds=thresholds,
            )

            protocol._validate_development_report(
                report,
                **_development_validation_kwargs(
                    source_path=source_path,
                    v2_path=v2_path,
                    v2=v2,
                    thresholds=thresholds,
                ),
            )

    def test_development_validator_rejects_hollow_asserted_pass_rows(self) -> None:
        source_payload = b"synthetic-hollow-development-source"
        thresholds = _thresholds()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_path = root / "cloud_0.e57"
            source_path.write_bytes(source_payload)
            v2_path = root / "v2.json"
            v2 = _fake_v2_report(source_payload)
            v2_path.write_bytes(_canonical_json_bytes(v2) + b"\n")
            report = _fake_development_report(
                source_path=source_path,
                v2_path=v2_path,
                v2=v2,
                thresholds=thresholds,
            )
            report["images"] = [
                {
                    "scanId": scan_id,
                    "name": f"Skybox {face}",
                    "evaluationRole": "development",
                    "status": protocol.PASS,
                    "trainingPermitted": False,
                }
                for scan_id in protocol.DEVELOPMENT_SCAN_IDS
                for face in range(6)
            ]
            hollow = _refinalize_development_report(report)

            with self.assertRaises(AuditError):
                protocol._validate_development_report(
                    hollow,
                    **_development_validation_kwargs(
                        source_path=source_path,
                        v2_path=v2_path,
                        v2=v2,
                        thresholds=thresholds,
                    ),
                )

    def test_development_validator_structures_non_object_candidate_error(self) -> None:
        source_payload = b"synthetic-malformed-candidate-source"
        thresholds = _thresholds()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_path = root / "cloud_0.e57"
            source_path.write_bytes(source_payload)
            v2_path = root / "v2.json"
            v2 = _fake_v2_report(source_payload)
            v2_path.write_bytes(_canonical_json_bytes(v2) + b"\n")
            report = _fake_development_report(
                source_path=source_path,
                v2_path=v2_path,
                v2=v2,
                thresholds=thresholds,
            )
            validation_kwargs = _development_validation_kwargs(
                source_path=source_path,
                v2_path=v2_path,
                v2=v2,
                thresholds=thresholds,
            )
            for label, malformed_value in (("null", None), ("scalar", 7)):
                with self.subTest(label=label):
                    malformed_report = copy.deepcopy(report)
                    malformed_report["images"][0]["candidateComparisons"][
                        0
                    ] = malformed_value
                    malformed = _refinalize_development_report(malformed_report)

                    with self.assertRaises(AuditError) as caught:
                        protocol._validate_development_report(
                            malformed,
                            **validation_kwargs,
                        )
                    self.assertEqual(
                        caught.exception.code, "INVALID_DEVELOPMENT_EVIDENCE"
                    )
                    self.assertIn(
                        "candidate 0 is not an object", caught.exception.message
                    )

    def test_development_validator_rejects_re_digested_pass_critical_tampering(
        self,
    ) -> None:
        source_payload = b"synthetic-tamper-development-source"
        thresholds = _thresholds()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_path = root / "cloud_0.e57"
            source_path.write_bytes(source_payload)
            v2_path = root / "v2.json"
            v2 = _fake_v2_report(source_payload)
            v2_path.write_bytes(_canonical_json_bytes(v2) + b"\n")
            valid = _fake_development_report(
                source_path=source_path,
                v2_path=v2_path,
                v2=v2,
                thresholds=thresholds,
            )
            validation_kwargs = _development_validation_kwargs(
                source_path=source_path,
                v2_path=v2_path,
                v2=v2,
                thresholds=thresholds,
            )

            def tamper_m0(report: dict[str, object]) -> None:
                report["images"][0]["marginOverBestAlternative"] += 0.001

            def tamper_ms(report: dict[str, object]) -> None:
                report["images"][0]["shiftedCandidateDiagnostic"][
                    "primaryMarginOverBestShiftedAlternative"
                ] += 0.001

            def tamper_rank(report: dict[str, object]) -> None:
                report["images"][0]["primaryRankAmong48"] = 2

            def tamper_spatial_null(report: dict[str, object]) -> None:
                report["images"][0]["spatialNullStressTest"][
                    "tailCountNullHitsGreaterThanOrEqualObserved"
                ] += 1

            def tamper_exact_phase_role(report: dict[str, object]) -> None:
                report["images"][0]["spatialNullStressTest"][
                    "decisionRole"
                ] = "ORIENTATION_GATE"

            def tamper_exact_phase_status(report: dict[str, object]) -> None:
                report["images"][0]["spatialNullStressTest"][
                    "status"
                ] = protocol.EXACT_PHASE_NONUNIQUE

            def tamper_grid_coverage(report: dict[str, object]) -> None:
                report["images"][0]["candidateComparisons"][0][
                    "geometryEdgeGridCellPixelCounts"
                ][0] += 1

            def tamper_derived_grid_coverage(report: dict[str, object]) -> None:
                report["images"][0]["candidateComparisons"][0][
                    "supportedGeometryEdgeGridRowCount"
                ] += 1

            def tamper_primary_grid_coverage(report: dict[str, object]) -> None:
                report["images"][0]["primaryGeometryEdgeCoverage"][
                    "representedGeometryEdgeGridQuadrantCount"
                ] = 3

            def tamper_top_level_summary(report: dict[str, object]) -> None:
                report["result"]["unshiftedMarginM0"]["maximum"] += 0.001

            def tamper_exact_phase_summary(report: dict[str, object]) -> None:
                report["result"]["exactPhaseDiagnostic"]["statusCounts"][
                    protocol.EXACT_PHASE_UNIQUE
                ] += 1

            def tamper_coverage_summary(report: dict[str, object]) -> None:
                report["result"]["geometryCoverage"][
                    "legacyAtLeast24FailCount"
                ] += 1

            def tamper_candidate_metadata(report: dict[str, object]) -> None:
                report["images"][0]["candidateComparisons"][0][
                    "sourceBaseSkyboxName"
                ] = "Skybox 5"

            def replace_boolean_with_integer(report: dict[str, object]) -> None:
                report["images"][0]["trainingPermitted"] = 0

            mutations = {
                "unshifted margin M0": tamper_m0,
                "all-candidates-shifted margin Ms": tamper_ms,
                "primary rank": tamper_rank,
                "spatial-null tail": tamper_spatial_null,
                "exact-phase role": tamper_exact_phase_role,
                "exact-phase status": tamper_exact_phase_status,
                "geometry grid coverage": tamper_grid_coverage,
                "derived geometry grid coverage": tamper_derived_grid_coverage,
                "primary geometry grid coverage": tamper_primary_grid_coverage,
                "top-level summary": tamper_top_level_summary,
                "exact-phase summary": tamper_exact_phase_summary,
                "geometry coverage summary": tamper_coverage_summary,
                "candidate projection metadata": tamper_candidate_metadata,
                "strict boolean type": replace_boolean_with_integer,
            }
            for label, mutate in mutations.items():
                with self.subTest(label=label):
                    tampered = copy.deepcopy(valid)
                    mutate(tampered)
                    tampered = _refinalize_development_report(tampered)
                    with self.assertRaises(AuditError):
                        protocol._validate_development_report(
                            tampered,
                            **validation_kwargs,
                        )

    def test_create_protocol_freezes_hashes_without_decoding_a_scan(self) -> None:
        source_payload = b"synthetic-E57-container-bytes"
        thresholds = _thresholds(
            minimumPrimaryMatchedFractionToAvoidReject=0.31,
            minimumPrimaryMatchedFractionForPass=0.36,
            minimumMarginOverBestAlternative=0.025,
            minimumShiftedMarginOverBestAlternative=0.03,
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_path = root / "cloud_0.e57"
            source_path.write_bytes(source_payload)
            v2_path = root / "v2.json"
            v2 = _fake_v2_report(source_payload)
            v2_path.write_bytes(_canonical_json_bytes(v2) + b"\n")
            development_path = root / "development.json"
            _write_fake_development_report(
                path=development_path,
                source_path=source_path,
                v2_path=v2_path,
                v2=v2,
                thresholds=thresholds,
            )
            protocol_path = root / "geometry-protocol.json"
            audit_output = root / "geometry-audit.json"

            with mock.patch.dict(sys.modules, {"pye57_forbidden_scan_probe": None}):
                frozen = protocol.create_protocol(
                    e57_path=source_path,
                    v2_report_path=v2_path,
                    prior_development_report_path=PRIOR_V1_DEVELOPMENT_PATH,
                    development_report_path=development_path,
                    output_path=protocol_path,
                    audit_output_file_name=audit_output.name,
                    minimum_primary_matched_fraction_to_avoid_reject=0.31,
                    minimum_primary_matched_fraction_for_pass=0.36,
                    minimum_margin_over_best_alternative=0.025,
                    minimum_shifted_margin_over_best_alternative=0.03,
                    minimum_geometry_edge_pixels=5000,
                    minimum_occupied_pixel_fraction=0.45,
                )

            self.assertTrue(protocol_path.is_file())
            self.assertEqual(frozen["schemaVersion"], protocol.PROTOCOL_SCHEMA_VERSION)
            self.assertTrue(frozen["scope"]["postDevelopmentRuleChange"])
            self.assertEqual(
                frozen["scope"]["frozenPriorV1DevelopmentReport"],
                protocol._expected_prior_development_receipt(),
            )
            self.assertFalse(
                frozen["methodRevision"]["priorV1DevelopmentReportPassed"]
            )
            self.assertFalse(
                frozen["methodRevision"]["spatialNullThresholdsLoosened"]
            )
            self.assertEqual(
                frozen["methodRevision"]["priorV1ResultFacts"][
                    "exactPhaseDiagnosticStatusCounts"
                ],
                {"UNIQUE": 30, "NONUNIQUE": 6, "UNASSESSABLE": 6},
            )
            self.assertEqual(
                frozen["scope"]["developmentScanIds"],
                list(protocol.DEVELOPMENT_SCAN_IDS),
            )
            self.assertEqual(
                frozen["scope"]["heldOutScanIds"], list(protocol.HELD_OUT_SCAN_IDS)
            )
            self.assertFalse(
                frozen["pointDataBoundary"]["pointColourFieldsRequestedOrRead"]
            )
            self.assertFalse(frozen["nonAuthorization"]["trainingPermitted"])
            self.assertFalse(
                frozen["nonAuthorization"]["continuousCalibrationValidated"]
            )
            self.assertNotIn(
                "maximumPrimaryLocalShiftGain", frozen["acceptanceThresholds"]
            )
            self.assertIn(
                "removed_primary_shift_gain_from_discrete_orientation_acceptance",
                {
                    row["decision"]
                    for row in frozen["developmentTuningHistory"]
                },
            )
            self.assertIn(
                "PASS_DISCRETE_GEOMETRY_ORIENTATION", frozen["decisionRules"]
            )
            pass_rule = frozen["decisionRules"][
                "PASS_DISCRETE_GEOMETRY_ORIENTATION"
            ]
            self.assertIn("0.36", pass_rule)
            self.assertIn("0.025", pass_rule)
            self.assertIn("0.03", pass_rule)
            self.assertNotIn("spatial", pass_rule.lower())
            self.assertIn("EXACT_PHASE_DIAGNOSTIC", frozen["decisionRules"])
            self.assertIn(
                "0.31",
                frozen["decisionRules"]["REJECT_GEOMETRY_MISMATCH"],
            )
            self.assertEqual(
                frozen["scope"]["heldOutMeaning"],
                protocol.HELD_OUT_SCOPE_MEANING,
            )
            self.assertEqual(
                frozen["scope"]["developmentEvidenceProvenanceLimit"],
                protocol.DEVELOPMENT_EVIDENCE_PROVENANCE_LIMIT,
            )
            self.assertEqual(
                frozen["scope"]["sourceE57"]["sha256"],
                hashlib.sha256(source_payload).hexdigest(),
            )
            self.assertEqual(len(frozen["implementation"]["sourceFiles"]), 5)
            self.assertEqual(
                frozen["scope"]["frozenDevelopmentReport"]["fileName"],
                development_path.name,
            )

            verified = protocol.verify_protocol_inputs(
                protocol_path=protocol_path,
                e57_path=source_path,
                v2_report_path=v2_path,
                prior_development_report_path=PRIOR_V1_DEVELOPMENT_PATH,
                development_report_path=development_path,
                output_path=audit_output,
            )
            self.assertEqual(verified["sourceSha256"], hashlib.sha256(source_payload).hexdigest())

            with self.assertRaisesRegex(AuditError, "already exists"):
                protocol.create_protocol(
                    e57_path=source_path,
                    v2_report_path=v2_path,
                    prior_development_report_path=PRIOR_V1_DEVELOPMENT_PATH,
                    development_report_path=development_path,
                    output_path=protocol_path,
                    audit_output_file_name=audit_output.name,
                    minimum_primary_matched_fraction_to_avoid_reject=0.31,
                    minimum_primary_matched_fraction_for_pass=0.36,
                    minimum_margin_over_best_alternative=0.025,
                    minimum_shifted_margin_over_best_alternative=0.03,
                    minimum_geometry_edge_pixels=5000,
                    minimum_occupied_pixel_fraction=0.45,
                )

            development_path.write_bytes(development_path.read_bytes() + b" ")
            with self.assertRaisesRegex(AuditError, "bytes differ"):
                protocol.verify_protocol_inputs(
                    protocol_path=protocol_path,
                    e57_path=source_path,
                    v2_report_path=v2_path,
                    prior_development_report_path=PRIOR_V1_DEVELOPMENT_PATH,
                    development_report_path=development_path,
                    output_path=audit_output,
                )

    def test_protocol_verification_stops_on_source_hash_mismatch(self) -> None:
        source_payload = b"first synthetic source"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_path = root / "cloud_0.e57"
            source_path.write_bytes(source_payload)
            v2_path = root / "v2.json"
            v2 = _fake_v2_report(source_payload)
            v2_path.write_bytes(_canonical_json_bytes(v2) + b"\n")
            development_path = root / "development.json"
            _write_fake_development_report(
                path=development_path,
                source_path=source_path,
                v2_path=v2_path,
                v2=v2,
                thresholds=_thresholds(),
            )
            protocol_path = root / "protocol.json"
            audit_output = root / "result.json"
            protocol.create_protocol(
                e57_path=source_path,
                v2_report_path=v2_path,
                prior_development_report_path=PRIOR_V1_DEVELOPMENT_PATH,
                development_report_path=development_path,
                output_path=protocol_path,
                audit_output_file_name=audit_output.name,
                minimum_primary_matched_fraction_to_avoid_reject=0.30,
                minimum_primary_matched_fraction_for_pass=0.35,
                minimum_margin_over_best_alternative=0.02,
                minimum_shifted_margin_over_best_alternative=0.02,
                minimum_geometry_edge_pixels=5000,
                minimum_occupied_pixel_fraction=0.45,
            )
            source_path.write_bytes(b"different synthetic source bytes")

            with self.assertRaisesRegex(AuditError, "does not match"):
                protocol.verify_protocol_inputs(
                    protocol_path=protocol_path,
                    e57_path=source_path,
                    v2_report_path=v2_path,
                    prior_development_report_path=PRIOR_V1_DEVELOPMENT_PATH,
                    development_report_path=development_path,
                    output_path=audit_output,
                )

    def test_protocol_json_digest_recomputes(self) -> None:
        payload = {"schemaVersion": "test", "value": [1, 2, 3]}
        finalized = protocol._finalize(payload, protocol.PROTOCOL_DIGEST_DOMAIN)
        without_digest = dict(finalized)
        expected = without_digest.pop("payloadSha256")
        actual = hashlib.sha256(
            protocol.PROTOCOL_DIGEST_DOMAIN + _canonical_json_bytes(without_digest)
        ).hexdigest()
        self.assertEqual(expected, actual)
        self.assertEqual(json.loads(_canonical_json_bytes(finalized)), finalized)

    def test_run_development_dispatches_only_the_seven_development_ids(self) -> None:
        scan_rows = [
            {
                "scanId": scan_id,
                "evaluationRole": "development",
                "status": protocol.PASS,
            }
            for scan_id in protocol.DEVELOPMENT_SCAN_IDS
        ]
        image_rows = [
            {
                "scanId": scan_id,
                "name": f"Skybox {face}",
                "evaluationRole": "development",
                "status": protocol.PASS,
                "primaryRankAmong48": 1,
                "primaryEvaluation": {"matchedFraction": 0.5},
                "marginOverBestAlternative": 0.1,
                "shiftedCandidateDiagnostic": {
                    "primaryRankAmong48AfterEachCandidateBestLocalShift": 1,
                    "primaryMarginOverBestShiftedAlternative": 0.08,
                },
                "localShiftDiagnostic": {
                    "gainOverUnshifted": 0.02,
                    "shiftSensitive": True,
                },
                "spatialNullStressTest": {
                    "status": protocol.EXACT_PHASE_UNIQUE,
                    "geometryPixelsInRoi": 5000,
                    "observedHitCount": 4000,
                    "observedMatchedFraction": 0.8,
                    "tailCountNullHitsGreaterThanOrEqualObserved": 0,
                    "q99NullHitCount": 3000,
                    "observedMinusQ99Fraction": 0.2,
                },
                "primaryGeometryEdgeCoverage": {
                    "supportedGeometryEdgeGridCellCount": 22,
                    "supportedGeometryEdgeGridRowCount": 6,
                    "supportedGeometryEdgeGridColumnCount": 6,
                    "representedGeometryEdgeGridQuadrantCount": 4,
                    "distributedGeometryEdgeSupportPasses": True,
                    "legacyAtLeast24SupportedGeometryEdgeGridCellsDiagnosticPasses": False,
                },
            }
            for scan_id in protocol.DEVELOPMENT_SCAN_IDS
            for face in range(6)
        ]
        verification = {
            "sourceE57": {
                "fileName": "synthetic.e57",
                "sizeBytes": 1,
                "sha256": "a" * 64,
            },
            "v2Receipt": {
                "fileName": "v2.json",
                "sizeBytes": 1,
                "sha256": "b" * 64,
                "schemaVersion": protocol.V2_REPORT_SCHEMA_VERSION,
                "payloadSha256": "c" * 64,
            },
            "priorDevelopmentReceipt": (
                protocol._expected_prior_development_receipt()
            ),
            "sourceRecords": [],
            "sourceCaptures": [],
            "dependencyVersions": protocol._dependency_versions(),
        }
        fake_pye57 = types.SimpleNamespace(E57=lambda _: object())
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "development.json"
            with (
                mock.patch.dict(sys.modules, {"pye57": fake_pye57}),
                mock.patch.object(
                    protocol,
                    "_verify_development_inputs",
                    return_value=verification,
                ),
                mock.patch.object(
                    protocol,
                    "_verify_development_inputs_unchanged",
                ),
                mock.patch.object(
                    protocol,
                    "_process_scan_set",
                    return_value=(scan_rows, image_rows),
                ) as process,
            ):
                report = protocol.run_development(
                    e57_path=Path("synthetic.e57"),
                    v2_report_path=Path("v2.json"),
                    prior_development_report_path=PRIOR_V1_DEVELOPMENT_PATH,
                    output_path=output,
                    minimum_primary_matched_fraction_to_avoid_reject=0.30,
                    minimum_primary_matched_fraction_for_pass=0.35,
                    minimum_margin_over_best_alternative=0.02,
                    minimum_shifted_margin_over_best_alternative=0.02,
                    minimum_geometry_edge_pixels=5000,
                    minimum_occupied_pixel_fraction=0.45,
                )

            self.assertTrue(output.is_file())
            self.assertEqual(report["scope"]["heldOutScanIdsRead"], [])
            self.assertFalse(report["scope"]["heldOutScansOpened"])
            _, kwargs = process.call_args
            self.assertEqual(tuple(kwargs["scan_ids"]), protocol.DEVELOPMENT_SCAN_IDS)
            self.assertEqual(kwargs["evaluation_role"], "development")

    def test_run_audit_rejects_partial_all_pass_heldout_rows(self) -> None:
        partial_scan_ids = protocol.HELD_OUT_SCAN_IDS[:-1]
        scan_rows = [
            {
                "scanId": scan_id,
                "evaluationRole": "held_out",
                "status": protocol.PASS,
            }
            for scan_id in partial_scan_ids
        ]
        image_rows = [
            {
                "scanId": scan_id,
                "name": f"Skybox {face}",
                "evaluationRole": "held_out",
                "status": protocol.PASS,
            }
            for scan_id in partial_scan_ids
            for face in range(6)
        ]
        verification = {
            "protocol": {"acceptanceThresholds": _thresholds()},
        }
        fake_pye57 = types.SimpleNamespace(E57=lambda _: object())
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "heldout.json"
            with (
                mock.patch.dict(sys.modules, {"pye57": fake_pye57}),
                mock.patch.object(
                    protocol,
                    "verify_protocol_inputs",
                    return_value=verification,
                ),
                mock.patch.object(
                    protocol,
                    "_process_scan_set",
                    return_value=(scan_rows, image_rows),
                ) as process,
            ):
                with self.assertRaises(AuditError) as caught:
                    protocol.run_audit(
                        protocol_path=Path("protocol.json"),
                        e57_path=Path("synthetic.e57"),
                        v2_report_path=Path("v2.json"),
                        prior_development_report_path=PRIOR_V1_DEVELOPMENT_PATH,
                        development_report_path=Path("development.json"),
                        output_path=output,
                    )

            self.assertEqual(caught.exception.code, "INVALID_HELDOUT_RESULT")
            self.assertIn("exactly 16 scan rows", caught.exception.message)
            self.assertFalse(output.exists())
            _, kwargs = process.call_args
            self.assertEqual(tuple(kwargs["scan_ids"]), protocol.HELD_OUT_SCAN_IDS)
            self.assertEqual(kwargs["evaluation_role"], "held_out")


if __name__ == "__main__":
    unittest.main()
