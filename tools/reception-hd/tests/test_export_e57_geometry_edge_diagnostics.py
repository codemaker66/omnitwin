from __future__ import annotations

import io
import json
import ast
import hashlib
import sys
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image


TOOL_DIR = Path(__file__).resolve().parents[1]
if str(TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(TOOL_DIR))

import export_e57_geometry_edge_diagnostics as diagnostics  # noqa: E402


PASS = "PASS_DISCRETE_GEOMETRY_ORIENTATION"
REJECT = "REJECT_GEOMETRY_MISMATCH"
AMBIGUOUS = "BLOCKED_AMBIGUOUS"


def image_row(
    *,
    scan_id: int,
    face: int,
    status: str,
    geometry_count: int,
    photo_count: int = 24_602,
    image_index: int | None = None,
) -> dict[str, object]:
    name = f"Skybox {face}"
    primary_id = f"primary-{face}"
    alternative_id = f"alternative-{face}"
    return {
        "scanId": scan_id,
        "name": name,
        "status": status,
        "evaluationRole": "held_out",
        "image2DIndex": image_index if image_index is not None else scan_id * 6 + face,
        "image2DGuid": f"guid-{scan_id}-{face}",
        "primaryCandidateId": primary_id,
        "bestAlternativeCandidateId": alternative_id,
        "diagnosticWinnerCandidateId": (
            alternative_id if status == REJECT else primary_id
        ),
        "primaryRankAmong48": 2 if status == REJECT else 1,
        "marginOverBestAlternative": -0.01 if status == REJECT else 0.03,
        "photoEdgePixelCount": photo_count,
        "primaryEvaluation": {
            "geometryEdgePixelCount": geometry_count,
            "matchedFraction": 0.5,
            "supportedGeometryEdgeGridCellCount": 30,
            "supportedGeometryEdgeGridRowCount": 8,
            "supportedGeometryEdgeGridColumnCount": 8,
            "representedGeometryEdgeGridQuadrantCount": 4,
        },
        "shiftedCandidateDiagnostic": {
            "primaryRankAmong48AfterEachCandidateBestLocalShift": (
                2 if status == REJECT else 1
            ),
            "primaryMarginOverBestShiftedAlternative": (
                -0.01 if status == REJECT else 0.03
            ),
        },
        "reasons": ["synthetic_fixture_reason"],
        "spatialNullStressTest": {"status": "UNIQUE"},
        "trainingPermitted": False,
        "knownPoseMaterializationPermitted": False,
        "continuousCalibrationValidated": False,
        "metricGeometryValidated": False,
    }


def report_fixture() -> tuple[dict[str, object], dict[str, object], dict[str, object]]:
    receipt = {
        "fileName": "protocol.json",
        "sizeBytes": 123,
        "sha256": "a" * 64,
        "schemaVersion": diagnostics.PROTOCOL_SCHEMA_VERSION,
        "payloadSha256": "b" * 64,
    }
    images: list[dict[str, object]] = []
    scans: list[dict[str, object]] = []
    for scan_index, scan_id in enumerate(diagnostics.HELD_OUT_SCAN_IDS):
        scans.append(
            {
                "scanId": scan_id,
                "evaluationRole": "held_out",
                "pointColourFieldsRequestedOrRead": False,
                "majorityVoteUsed": False,
                "continuousCalibrationValidated": False,
                "metricGeometryValidated": False,
                "knownPoseMaterializationPermitted": False,
                "trainingPermitted": False,
            }
        )
        for face in range(6):
            status = REJECT if scan_index == 0 and face == 0 else PASS
            images.append(
                image_row(
                    scan_id=scan_id,
                    face=face,
                    status=status,
                    geometry_count=10_000 + scan_index * 10 + face,
                )
            )
    protocol = {
        "schemaVersion": diagnostics.PROTOCOL_SCHEMA_VERSION,
        "scope": {
            "heldOutScanIds": list(diagnostics.HELD_OUT_SCAN_IDS),
        },
    }
    report = {
        "schemaVersion": diagnostics.HELDOUT_REPORT_SCHEMA_VERSION,
        "protocol": receipt,
        "scope": {
            "scanCount": 16,
            "imageCount": 96,
            "heldOutScanIdsRead": list(diagnostics.HELD_OUT_SCAN_IDS),
        },
        "result": {
            "status": REJECT,
            "everyHeldOutFacePasses": False,
            "coarseDiscreteGeometryOrientationGatePassed": False,
            "fixedV2MappingWasNeverReplacedByDiagnosticWinner": True,
            "pointColourFieldsRequestedOrRead": False,
            "continuousCalibrationValidated": False,
            "metricGeometryValidated": False,
            "knownPoseMaterializationPermitted": False,
            "trainingPermitted": False,
        },
        "pointDataBoundary": {
            "pointColourFieldsRequestedOrRead": False,
            "readScanArguments": {
                "intensity": False,
                "colors": False,
                "row_column": True,
                "transform": False,
            },
        },
        "authority": "none",
        "scans": scans,
        "images": images,
    }
    return report, protocol, receipt


class PairingTests(unittest.TestCase):
    def test_relative_count_distance_uses_both_declared_counts(self) -> None:
        case = image_row(
            scan_id=1,
            face=5,
            status=REJECT,
            geometry_count=10_000,
            photo_count=20_000,
        )
        control = image_row(
            scan_id=2,
            face=5,
            status=PASS,
            geometry_count=11_000,
            photo_count=18_000,
        )

        self.assertAlmostEqual(
            diagnostics.relative_count_distance(case, control),
            0.2,
            places=12,
        )

    def test_pairing_requires_same_face_and_selects_nearest_pass(self) -> None:
        case = image_row(
            scan_id=10,
            face=5,
            status=REJECT,
            geometry_count=10_000,
        )
        wrong_face = image_row(
            scan_id=11,
            face=4,
            status=PASS,
            geometry_count=10_001,
        )
        farther = image_row(
            scan_id=12,
            face=5,
            status=PASS,
            geometry_count=11_000,
        )
        nearest = image_row(
            scan_id=13,
            face=5,
            status=PASS,
            geometry_count=10_010,
        )

        pairs = diagnostics.select_diagnostic_pairs(
            [case, wrong_face, farther, nearest]
        )

        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0]["caseScanId"], 10)
        self.assertEqual(pairs[0]["controlScanId"], 13)
        self.assertEqual(pairs[0]["faceName"], "Skybox 5")

    def test_pairing_tie_breaks_by_raw_deltas_then_scan_and_image(self) -> None:
        case = image_row(
            scan_id=20,
            face=2,
            status=AMBIGUOUS,
            geometry_count=10_000,
            photo_count=20_000,
        )
        high_scan = image_row(
            scan_id=30,
            face=2,
            status=PASS,
            geometry_count=10_100,
            photo_count=20_000,
        )
        low_scan = image_row(
            scan_id=25,
            face=2,
            status=PASS,
            geometry_count=9_900,
            photo_count=20_000,
        )

        pairs = diagnostics.select_diagnostic_pairs([case, high_scan, low_scan])

        self.assertEqual(pairs[0]["controlScanId"], 25)

    def test_pairing_allows_reuse_and_records_it(self) -> None:
        case_a = image_row(
            scan_id=40,
            face=5,
            status=REJECT,
            geometry_count=10_000,
        )
        case_b = image_row(
            scan_id=41,
            face=5,
            status=AMBIGUOUS,
            geometry_count=10_010,
        )
        control = image_row(
            scan_id=42,
            face=5,
            status=PASS,
            geometry_count=10_005,
        )

        pairs = diagnostics.select_diagnostic_pairs([case_a, case_b, control])

        self.assertEqual([pair["controlScanId"] for pair in pairs], [42, 42])
        self.assertEqual([pair["controlReuseCount"] for pair in pairs], [2, 2])

    def test_pairing_rejects_a_case_without_same_face_pass_control(self) -> None:
        case = image_row(
            scan_id=50,
            face=3,
            status=REJECT,
            geometry_count=10_000,
        )
        wrong_face = image_row(
            scan_id=51,
            face=4,
            status=PASS,
            geometry_count=10_000,
        )

        with self.assertRaisesRegex(ValueError, "same-face PASS control"):
            diagnostics.select_diagnostic_pairs([case, wrong_face])


class RenderingTests(unittest.TestCase):
    def test_edge_overlay_uses_declared_colours_for_matches_and_misses(self) -> None:
        photo = np.full((8, 8, 3), 100, dtype=np.uint8)
        photo_mask = np.zeros((8, 8), dtype=bool)
        geometry_mask = np.zeros((8, 8), dtype=bool)
        photo_mask[2, 2] = True
        geometry_mask[2, 2] = True
        geometry_mask[6, 6] = True

        overlay = diagnostics.compose_edge_overlay(
            photo,
            photo_mask,
            geometry_mask,
            dilate_for_display=False,
            draw_grid=False,
        )

        np.testing.assert_array_equal(
            overlay[2, 2], diagnostics.MATCHED_GEOMETRY_COLOUR
        )
        np.testing.assert_array_equal(
            overlay[6, 6], diagnostics.UNMATCHED_GEOMETRY_COLOUR
        )

    def test_edge_overlay_rejects_mismatched_shapes(self) -> None:
        photo = np.zeros((8, 8, 3), dtype=np.uint8)
        photo_mask = np.zeros((7, 8), dtype=bool)
        geometry_mask = np.zeros((8, 8), dtype=bool)

        with self.assertRaisesRegex(ValueError, "matching dimensions"):
            diagnostics.compose_edge_overlay(photo, photo_mask, geometry_mask)

    def test_grid_and_display_halos_never_erase_exact_edge_meanings(self) -> None:
        photo = np.full((128, 128, 3), 100, dtype=np.uint8)
        photo_mask = np.zeros((128, 128), dtype=bool)
        geometry_mask = np.zeros((128, 128), dtype=bool)
        photo_mask[40, 64] = True
        photo_mask[70, 64] = True
        geometry_mask[40, 64] = True
        geometry_mask[70, 67] = True

        overlay = diagnostics.compose_edge_overlay(
            photo,
            photo_mask,
            geometry_mask,
            dilate_for_display=True,
            draw_grid=True,
        )

        np.testing.assert_array_equal(
            overlay[40, 64], diagnostics.MATCHED_GEOMETRY_COLOUR
        )
        np.testing.assert_array_equal(
            overlay[70, 64], diagnostics.PHOTO_EDGE_COLOUR
        )
        np.testing.assert_array_equal(
            overlay[70, 67], diagnostics.UNMATCHED_GEOMETRY_COLOUR
        )

    def test_matched_halo_does_not_turn_adjacent_unmatched_core_green(self) -> None:
        photo = np.zeros((16, 16, 3), dtype=np.uint8)
        photo_mask = np.zeros((16, 16), dtype=bool)
        geometry_mask = np.zeros((16, 16), dtype=bool)
        photo_mask[4, 4] = True
        geometry_mask[4, 6] = True
        geometry_mask[4, 7] = True

        overlay = diagnostics.compose_edge_overlay(
            photo,
            photo_mask,
            geometry_mask,
            dilate_for_display=True,
            draw_grid=False,
        )

        np.testing.assert_array_equal(
            overlay[4, 6], diagnostics.MATCHED_GEOMETRY_COLOUR
        )
        np.testing.assert_array_equal(
            overlay[4, 7], diagnostics.UNMATCHED_GEOMETRY_COLOUR
        )

    def test_photo_edge_core_survives_a_grid_line(self) -> None:
        photo = np.zeros((128, 128, 3), dtype=np.uint8)
        mask = np.zeros((128, 128), dtype=bool)
        mask[40, 64] = True

        panel = diagnostics._photo_edge_panel(photo, mask)

        np.testing.assert_array_equal(panel[40, 64], diagnostics.PHOTO_EDGE_COLOUR)

    def test_numeric_edge_masks_are_rejected_instead_of_coerced(self) -> None:
        photo = np.zeros((8, 8, 3), dtype=np.uint8)
        photo_mask = np.zeros((8, 8), dtype=np.uint8)
        geometry_mask = np.zeros((8, 8), dtype=bool)

        with self.assertRaisesRegex(ValueError, "must be Boolean"):
            diagnostics.compose_edge_overlay(photo, photo_mask, geometry_mask)

    def test_pair_sheet_is_a_decodable_png_with_internal_only_banner(self) -> None:
        case_row = image_row(
            scan_id=60,
            face=5,
            status=REJECT,
            geometry_count=10_000,
        )
        control_row = image_row(
            scan_id=61,
            face=5,
            status=PASS,
            geometry_count=10_010,
        )
        pair = diagnostics.select_diagnostic_pairs([case_row, control_row])[0]
        photo = np.zeros((diagnostics.ANALYSIS_SIZE, diagnostics.ANALYSIS_SIZE, 3), dtype=np.uint8)
        mask = np.zeros((diagnostics.ANALYSIS_SIZE, diagnostics.ANALYSIS_SIZE), dtype=bool)
        visual_case = diagnostics.ImageVisual(
            row=case_row,
            photo=photo,
            photo_edge_mask=mask,
            primary_geometry_mask=mask,
            alternative_geometry_mask=mask,
        )
        visual_control = diagnostics.ImageVisual(
            row=control_row,
            photo=photo,
            photo_edge_mask=mask,
            primary_geometry_mask=mask,
            alternative_geometry_mask=mask,
        )

        payload = diagnostics.render_pair_sheet(
            visual_case,
            visual_control,
            pair,
            report_sha256="a" * 64,
        )

        with Image.open(io.BytesIO(payload)) as image:
            self.assertEqual(image.format, "PNG")
            self.assertEqual(image.size, diagnostics.PAIR_SHEET_SIZE)
        self.assertGreater(len(payload), 1_000)

    def test_output_file_name_is_stable_and_contains_both_scan_ids(self) -> None:
        case = image_row(
            scan_id=70,
            face=4,
            status=REJECT,
            geometry_count=10_000,
        )
        control = image_row(
            scan_id=71,
            face=4,
            status=PASS,
            geometry_count=10_000,
        )

        name = diagnostics.output_file_name(3, case, control)

        self.assertEqual(
            name,
            "case-03-scan-070-skybox-4-vs-pass-scan-071.png",
        )

    def test_pair_sheet_rejects_a_pair_receipt_for_another_scan(self) -> None:
        case_row = image_row(
            scan_id=80,
            face=5,
            status=REJECT,
            geometry_count=10_000,
        )
        control_row = image_row(
            scan_id=81,
            face=5,
            status=PASS,
            geometry_count=10_010,
        )
        pair = diagnostics.select_diagnostic_pairs([case_row, control_row])[0]
        pair["caseScanId"] = 999
        photo = np.zeros(
            (diagnostics.ANALYSIS_SIZE, diagnostics.ANALYSIS_SIZE, 3),
            dtype=np.uint8,
        )
        mask = np.zeros(
            (diagnostics.ANALYSIS_SIZE, diagnostics.ANALYSIS_SIZE),
            dtype=bool,
        )
        case = diagnostics.ImageVisual(
            row=case_row,
            photo=photo,
            photo_edge_mask=mask,
            primary_geometry_mask=mask,
            alternative_geometry_mask=mask,
        )
        control = diagnostics.ImageVisual(
            row=control_row,
            photo=photo,
            photo_edge_mask=mask,
            primary_geometry_mask=mask,
            alternative_geometry_mask=mask,
        )

        with self.assertRaisesRegex(ValueError, "pair receipt"):
            diagnostics.render_pair_sheet(
                case,
                control,
                pair,
                report_sha256="a" * 64,
            )


class EvidenceTests(unittest.TestCase):
    def test_manifest_digest_round_trips_and_detects_change(self) -> None:
        payload = {
            "schemaVersion": diagnostics.MANIFEST_SCHEMA_VERSION,
            "authority": "none",
            "trainingPermitted": False,
        }

        finalized = diagnostics.finalize_manifest(payload)

        self.assertTrue(diagnostics.verify_manifest_digest(finalized))
        finalized["trainingPermitted"] = True
        self.assertFalse(diagnostics.verify_manifest_digest(finalized))

    def test_selected_mask_receipt_uses_the_frozen_two_pixel_radius(self) -> None:
        photo_mask = np.zeros((8, 8), dtype=bool)
        geometry_mask = np.zeros((8, 8), dtype=bool)
        photo_mask[2, 2] = True
        geometry_mask[2, 4] = True
        geometry_mask[2, 5] = True
        grid_counts = diagnostics.geometry_grid_counts(geometry_mask)
        support = diagnostics.edge_protocol._geometry_edge_grid_support_record_from_counts(
            grid_counts
        )
        stored = {
            **support,
            "matchRadiusPixels": diagnostics.geometry.PHOTO_MATCH_RADIUS_PIXELS,
            "geometryEdgePixelCount": 2,
            "geometryEdgeDensity": diagnostics._round(2 / 64, 9),
            "photoEdgePixelCount": 1,
            "photoEdgeDensity": diagnostics._round(1 / 64, 9),
            "matchedGeometryEdgePixelCount": 1,
            "matchedFraction": 0.5,
        }

        diagnostics.verify_selected_mask_receipt(
            stored,
            geometry_mask,
            photo_mask,
        )
        stored["matchedGeometryEdgePixelCount"] = 2

        with self.assertRaisesRegex(ValueError, "matched geometry count"):
            diagnostics.verify_selected_mask_receipt(
                stored,
                geometry_mask,
                photo_mask,
            )

    def test_selected_mask_receipt_rejects_a_wrong_photo_count(self) -> None:
        photo_mask = np.zeros((8, 8), dtype=bool)
        geometry_mask = np.zeros((8, 8), dtype=bool)
        photo_mask[2, 2] = True
        geometry_mask[2, 2] = True
        counts = diagnostics.geometry_grid_counts(geometry_mask)
        stored = {
            **diagnostics.edge_protocol._geometry_edge_grid_support_record_from_counts(
                counts
            ),
            "matchRadiusPixels": 2,
            "geometryEdgePixelCount": 1,
            "geometryEdgeDensity": diagnostics._round(1 / 64, 9),
            "photoEdgePixelCount": 2,
            "photoEdgeDensity": diagnostics._round(2 / 64, 9),
            "matchedGeometryEdgePixelCount": 1,
            "matchedFraction": 1.0,
        }

        with self.assertRaisesRegex(ValueError, "photo edge count"):
            diagnostics.verify_selected_mask_receipt(
                stored,
                geometry_mask,
                photo_mask,
            )

    def test_exporter_never_calls_the_frozen_decision_or_full_rerun_functions(self) -> None:
        source = Path(diagnostics.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)
        called = {
            node.func.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        }

        self.assertTrue(
            set(diagnostics.FORBIDDEN_DECISION_FUNCTION_NAMES).isdisjoint(called)
        )

    def test_report_metadata_rejects_any_authorization_upgrade(self) -> None:
        report, protocol, receipt = report_fixture()
        diagnostics.validate_heldout_report(report, protocol, receipt)
        report["result"]["trainingPermitted"] = True

        with self.assertRaisesRegex(ValueError, "authorization flags"):
            diagnostics.validate_heldout_report(report, protocol, receipt)

    def test_report_metadata_requires_a_negative_heldout_result(self) -> None:
        report, protocol, receipt = report_fixture()
        report["result"]["status"] = PASS
        report["result"]["everyHeldOutFacePasses"] = True

        with self.assertRaisesRegex(ValueError, "negative held-out result"):
            diagnostics.validate_heldout_report(report, protocol, receipt)

    def test_report_metadata_rejects_scan_level_colour_or_majority_vote(self) -> None:
        report, protocol, receipt = report_fixture()
        report["scans"][0]["majorityVoteUsed"] = True

        with self.assertRaisesRegex(ValueError, "no-colour/no-vote"):
            diagnostics.validate_heldout_report(report, protocol, receipt)

    def test_create_only_bundle_refuses_an_existing_output_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "existing"
            output.mkdir()

            with self.assertRaisesRegex(ValueError, "already exists"):
                diagnostics.require_new_output_directory(output)

    def test_manifest_json_is_canonical_and_has_one_trailing_newline(self) -> None:
        finalized = diagnostics.finalize_manifest(
            {
                "schemaVersion": diagnostics.MANIFEST_SCHEMA_VERSION,
                "z": 1,
                "a": 2,
            }
        )

        payload = diagnostics.manifest_bytes(finalized)

        self.assertTrue(payload.endswith(b"\n"))
        self.assertFalse(payload.endswith(b"\n\n"))
        parsed = json.loads(payload.decode("utf-8"))
        self.assertEqual(parsed, finalized)

    def test_create_only_publisher_is_atomic_and_hashes_staged_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "bundle"
            manifest = diagnostics.publish_create_only_bundle(
                output,
                {"a.txt": b"alpha", "b.txt": b"beta"},
                {"schemaVersion": diagnostics.MANIFEST_SCHEMA_VERSION},
            )

            self.assertTrue(output.is_dir())
            self.assertEqual(
                {path.name for path in output.iterdir()},
                {"a.txt", "b.txt", "manifest.json"},
            )
            self.assertTrue(diagnostics.verify_manifest_digest(manifest))
            for receipt in manifest["outputsExcludingManifest"]:
                payload = (output / receipt["fileName"]).read_bytes()
                self.assertEqual(len(payload), receipt["sizeBytes"])
                self.assertEqual(hashlib.sha256(payload).hexdigest(), receipt["sha256"])

    def test_publisher_removes_staging_after_a_mid_write_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            output = parent / "bundle"
            original = diagnostics.write_create_only
            calls = 0

            def fail_second(path: Path, payload: bytes) -> None:
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise RuntimeError("injected write failure")
                original(path, payload)

            with mock.patch.object(
                diagnostics,
                "write_create_only",
                side_effect=fail_second,
            ):
                with self.assertRaisesRegex(RuntimeError, "injected write failure"):
                    diagnostics.publish_create_only_bundle(
                        output,
                        {"a.txt": b"alpha", "b.txt": b"beta"},
                        {"schemaVersion": diagnostics.MANIFEST_SCHEMA_VERSION},
                    )

            self.assertFalse(output.exists())
            self.assertEqual(list(parent.glob(".bundle.staging-*")), [])

    def test_publisher_preserves_a_destination_race_and_removes_staging(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            output = parent / "bundle"

            def create_racing_destination() -> None:
                output.mkdir()
                (output / "sentinel.txt").write_text("other process", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "already exists"):
                diagnostics.publish_create_only_bundle(
                    output,
                    {"a.txt": b"alpha"},
                    {"schemaVersion": diagnostics.MANIFEST_SCHEMA_VERSION},
                    before_publish=create_racing_destination,
                )

            self.assertEqual(
                (output / "sentinel.txt").read_text(encoding="utf-8"),
                "other process",
            )
            self.assertEqual(list(parent.glob(".bundle.staging-*")), [])

    def test_keyboard_interrupt_removes_private_staging(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            output = parent / "bundle"

            def interrupt() -> None:
                raise KeyboardInterrupt()

            with self.assertRaises(KeyboardInterrupt):
                diagnostics.publish_create_only_bundle(
                    output,
                    {"private-room-image.png": b"private pixels"},
                    {"schemaVersion": diagnostics.MANIFEST_SCHEMA_VERSION},
                    before_publish=interrupt,
                )

            self.assertFalse(output.exists())
            self.assertEqual(list(parent.glob(".bundle.staging-*")), [])

    def test_corrupted_staged_bytes_are_detected_before_publish(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            output = parent / "bundle"

            def corrupt(path: Path, payload: bytes) -> None:
                path.write_bytes(payload + b"corrupt")

            with mock.patch.object(
                diagnostics,
                "write_create_only",
                side_effect=corrupt,
            ):
                with self.assertRaisesRegex(ValueError, "size differs"):
                    diagnostics.publish_create_only_bundle(
                        output,
                        {"a.txt": b"alpha"},
                        {"schemaVersion": diagnostics.MANIFEST_SCHEMA_VERSION},
                    )

            self.assertFalse(output.exists())
            self.assertEqual(list(parent.glob(".bundle.staging-*")), [])

    def test_private_html_has_no_network_or_absolute_file_references(self) -> None:
        payload = diagnostics.index_html_bytes([]).decode("utf-8")
        lowered = payload.lower()

        self.assertIn("content-security-policy", lowered)
        self.assertNotIn("http://", lowered)
        self.assertNotIn("https://", lowered)
        self.assertNotIn("<script", lowered)
        self.assertNotIn("data:", lowered)
        self.assertNotIn("c:\\", lowered)
        self.assertIn("do not publish", lowered)

    def test_invalid_input_stops_before_pye57_construction(self) -> None:
        fake_e57 = mock.Mock()
        fake_module = SimpleNamespace(E57=fake_e57)
        with mock.patch.object(
            diagnostics,
            "load_verified_inputs",
            side_effect=ValueError("bad pinned input"),
        ), mock.patch.dict(sys.modules, {"pye57": fake_module}):
            with self.assertRaisesRegex(ValueError, "bad pinned input"):
                diagnostics.export_diagnostics(
                    e57_path=Path("missing.e57"),
                    protocol_path=Path("bad-protocol.json"),
                    heldout_report_path=Path("bad-report.json"),
                    output_dir=Path("unused-output"),
                )

        fake_e57.assert_not_called()

    def test_scan_reader_uses_exact_no_colour_arguments(self) -> None:
        class Source:
            def __init__(self) -> None:
                self.calls: list[tuple[int, dict[str, object]]] = []

            def read_scan(self, scan_id: int, **kwargs: object) -> dict[str, np.ndarray]:
                self.calls.append((scan_id, kwargs))
                value = np.array([0.0])
                index = np.array([0])
                return {
                    "cartesianX": value,
                    "cartesianY": value,
                    "cartesianZ": value,
                    "rowIndex": index,
                    "columnIndex": index,
                }

        source = Source()
        diagnostics.edge_protocol._read_organized_xyz(source, 123)

        self.assertEqual(
            source.calls,
            [
                (
                    123,
                    {
                        "intensity": False,
                        "colors": False,
                        "row_column": True,
                        "transform": False,
                    },
                )
            ],
        )

    def test_real_frozen_pair_map_is_locked_without_reading_image_pixels(self) -> None:
        report_path = (
            TOOL_DIR.parents[1]
            / "docs"
            / "reports"
            / "reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json"
        )
        report = json.loads(report_path.read_text(encoding="utf-8"))

        pairs = diagnostics.select_diagnostic_pairs(report["images"])
        actual = [
            (
                pair["caseScanId"],
                pair["faceName"],
                pair["controlScanId"],
            )
            for pair in pairs
        ]

        self.assertEqual(actual, diagnostics.EXPECTED_FROZEN_PAIR_MAP)

    def test_real_reconstruction_plan_is_exactly_13_scans_22_photos_44_masks(self) -> None:
        report_path = (
            TOOL_DIR.parents[1]
            / "docs"
            / "reports"
            / "reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json"
        )
        report = json.loads(report_path.read_text(encoding="utf-8"))
        pairs = diagnostics.select_diagnostic_pairs(report["images"])

        selected = diagnostics._selected_image_rows(report, pairs)
        plan = diagnostics.selected_reconstruction_plan(report, pairs)

        self.assertEqual(len(selected), 22)
        self.assertEqual(sorted(plan), diagnostics.EXPECTED_SELECTED_SCAN_IDS)
        self.assertEqual(
            {scan_id: len(ids) for scan_id, ids in plan.items()},
            diagnostics.EXPECTED_CANDIDATE_RASTERIZATIONS_BY_SCAN,
        )
        self.assertEqual(
            sum(len(ids) for ids in plan.values()),
            diagnostics.EXPECTED_CANDIDATE_RASTERIZATION_COUNT,
        )

    def test_real_shifted_challenger_selection_is_locked(self) -> None:
        report_path = (
            TOOL_DIR.parents[1]
            / "docs"
            / "reports"
            / "reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json"
        )
        report = json.loads(report_path.read_text(encoding="utf-8"))
        expected = {
            (131, "Skybox 5"): "forward_-Z_right_+X_mirrored",
            (136, "Skybox 2"): "forward_-Z_right_+Y_proper",
            (138, "Skybox 5"): "forward_+Z_right_+X_mirrored",
        }
        actual = {}
        for row in report["images"]:
            candidate_id, shifted = diagnostics._challenger_for_row(row)
            if shifted:
                actual[(row["scanId"], row["name"])] = candidate_id

        self.assertEqual(actual, expected)

    def test_real_frozen_input_hashes_have_not_changed(self) -> None:
        report_path = (
            TOOL_DIR.parents[1]
            / "docs"
            / "reports"
            / "reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json"
        )
        protocol_path = report_path.with_name(
            "reception-room-e57-geometry-edge-protocol-v2-2026-07-14.json"
        )

        self.assertEqual(
            hashlib.sha256(report_path.read_bytes()).hexdigest(),
            diagnostics.PINNED_HELDOUT_REPORT_SHA256,
        )
        self.assertEqual(
            hashlib.sha256(protocol_path.read_bytes()).hexdigest(),
            diagnostics.PINNED_PROTOCOL_SHA256,
        )


if __name__ == "__main__":
    unittest.main()
