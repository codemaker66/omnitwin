from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))
REPO_ROOT = Path(__file__).resolve().parents[3]
FROZEN_REPORT_PATH = (
    REPO_ROOT
    / "docs"
    / "reports"
    / "reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json"
)

import explore_e57_geometry_edge_residuals as exploratory  # noqa: E402
from audit_e57_room_images import AuditError  # noqa: E402


class E57GeometryEdgeResidualExplorationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.frozen_report = json.loads(FROZEN_REPORT_PATH.read_text("utf-8"))

    def test_actual_selection_is_exact_and_deterministic(self) -> None:
        exploratory._validate_frozen_report(self.frozen_report)
        pairs = exploratory.select_failure_control_pairs(
            self.frozen_report["images"]
        )
        actual = [
            (
                pair["failure"]["scanId"],
                pair["failure"]["faceName"],
                pair["control"]["scanId"],
                pair["control"]["faceName"],
            )
            for pair in pairs
        ]
        self.assertEqual(
            actual,
            [
                (123, "Skybox 3", 125, "Skybox 3"),
                (127, "Skybox 5", 125, "Skybox 5"),
                (128, "Skybox 5", 129, "Skybox 5"),
                (131, "Skybox 5", 129, "Skybox 5"),
                (132, "Skybox 5", 133, "Skybox 5"),
                (136, "Skybox 1", 135, "Skybox 1"),
                (136, "Skybox 2", 135, "Skybox 2"),
                (137, "Skybox 1", 138, "Skybox 1"),
                (137, "Skybox 2", 138, "Skybox 2"),
                (138, "Skybox 5", 137, "Skybox 5"),
                (139, "Skybox 4", 138, "Skybox 4"),
                (141, "Skybox 5", 139, "Skybox 5"),
                (142, "Skybox 4", 141, "Skybox 4"),
                (142, "Skybox 5", 143, "Skybox 5"),
            ],
        )
        unique = exploratory._unique_selections(pairs)
        self.assertEqual(len(unique), exploratory.EXPECTED_UNIQUE_SELECTED_FACE_COUNT)
        self.assertTrue(
            all(
                pair["failure"]["faceName"] == pair["control"]["faceName"]
                and pair["failure"]["frozenStatus"] != exploratory.PASS
                and pair["control"]["frozenStatus"] == exploratory.PASS
                for pair in pairs
            )
        )

    def test_selection_rejects_missing_same_face_control(self) -> None:
        rows = copy.deepcopy(self.frozen_report["images"])
        for row in rows:
            if row["name"] == "Skybox 3" and row["status"] == exploratory.PASS:
                row["status"] = exploratory.frozen.BLOCKED_AMBIGUOUS
        with self.assertRaisesRegex(ValueError, "requires exactly 14"):
            exploratory.select_failure_control_pairs(rows)

    def test_residual_metrics_partition_geometry_and_quantify_region(self) -> None:
        geometry = np.zeros((7, 7), dtype=bool)
        geometry[3, 1:6] = True
        photo = np.zeros_like(geometry)
        photo[3, 1] = True
        region = np.zeros_like(geometry)
        region[2:5, 3:6] = True
        measured, matched, unmatched, photo_only = exploratory.residual_metrics(
            geometry, photo, nadir_region_mask=region
        )
        self.assertEqual(measured["geometryEdgePixelCount"], 5)
        self.assertEqual(measured["matchedGeometryEdgePixelCount"], 3)
        self.assertEqual(measured["unmatchedGeometryResidualPixelCount"], 2)
        self.assertEqual(int(np.count_nonzero(matched & unmatched)), 0)
        self.assertTrue(np.array_equal(matched | unmatched, geometry))
        self.assertEqual(int(np.count_nonzero(photo_only)), 0)
        nadir = measured["hypothesizedNativeNadirTripodRegion"]
        self.assertTrue(nadir["applies"])
        self.assertEqual(nadir["unmatchedResidualPixelsInside"], 2)
        self.assertEqual(nadir["fractionOfAllUnmatchedResidualInside"], 1.0)
        self.assertFalse(nadir["excludedFromAnyMetric"])

    def test_residual_metrics_report_non_nadir_as_not_applicable(self) -> None:
        mask = np.zeros((8, 8), dtype=bool)
        mask[4, 4] = True
        measured, _, _, _ = exploratory.residual_metrics(
            mask, mask, nadir_region_mask=None
        )
        self.assertEqual(measured["matchedFraction"], 1.0)
        self.assertFalse(
            measured["hypothesizedNativeNadirTripodRegion"]["applies"]
        )

    def test_protocol_rejects_truth_upgrade_and_region_change(self) -> None:
        pairs = exploratory.select_failure_control_pairs(
            self.frozen_report["images"]
        )
        base = {
            "schemaVersion": exploratory.PROTOCOL_SCHEMA_VERSION,
            "purpose": "exploratory_failure_localization_and_hypothesis_generation",
            "evidenceState": exploratory._expected_evidence_state(),
            "selectionPlan": {
                "failureRule": "all_and_only_frozen_status_not_PASS_DISCRETE_GEOMETRY_ORIENTATION",
                "controlRule": (
                    "same face and frozen PASS; minimize in order absolute scan-ID "
                    "distance, scan ID, then image2D index; reuse permitted"
                ),
                "failureCount": exploratory.EXPECTED_FAILURE_COUNT,
                "pairCount": exploratory.EXPECTED_PAIR_COUNT,
                "uniqueSelectedFaceCount": (
                    exploratory.EXPECTED_UNIQUE_SELECTED_FACE_COUNT
                ),
                "pairs": pairs,
                "uniqueSelectedFaces": exploratory._unique_selections(pairs),
            },
            "analysisPlan": exploratory._expected_analysis_plan(),
            "truthAndAuthority": exploratory._expected_truth_and_authority(),
            "selfDigestMeaning": exploratory._expected_self_digest_meaning(),
            "authority": "none",
        }
        protocol = exploratory._finalize(
            base, exploratory.PROTOCOL_DIGEST_DOMAIN
        )
        exploratory._validate_protocol(protocol, self.frozen_report)

        upgraded = copy.deepcopy(base)
        upgraded["truthAndAuthority"]["trainingPermitted"] = True
        with self.assertRaisesRegex(AuditError, "truth upgrade"):
            exploratory._validate_protocol(
                exploratory._finalize(
                    upgraded, exploratory.PROTOCOL_DIGEST_DOMAIN
                ),
                self.frozen_report,
            )

        moved = copy.deepcopy(base)
        moved["analysisPlan"]["hypothesizedNativeNadirTripodRegion"][
            "analysisRadiusPixels"
        ] = 81
        with self.assertRaisesRegex(AuditError, "analysis plan changed"):
            exploratory._validate_protocol(
                exploratory._finalize(moved, exploratory.PROTOCOL_DIGEST_DOMAIN),
                self.frozen_report,
            )

    def test_overlay_is_lossless_native_size_png(self) -> None:
        native = Image.new("RGB", (128, 96), (80, 80, 80))
        matched = np.zeros((16, 16), dtype=bool)
        unmatched = np.zeros_like(matched)
        photo_only = np.zeros_like(matched)
        matched[4:6, 4:6] = True
        unmatched[8:10, 8:10] = True
        photo_only[1:3, 12:14] = True
        payload = exploratory.render_overlay(
            native,
            matched=matched,
            unmatched=unmatched,
            photo_only=photo_only,
            face_name="Skybox 0",
        )
        with Image.open(__import__("io").BytesIO(payload)) as opened:
            self.assertEqual(opened.format, "PNG")
            self.assertEqual(opened.size, native.size)

    def test_frozen_primary_metric_equality_is_fail_closed(self) -> None:
        selection = {
            "scanId": 123,
            "faceName": "Skybox 3",
            "frozenPrimaryMetrics": {
                "projectedInputCount": 100,
                "visiblePixelCount": 50,
                "occupiedPixelFraction": exploratory._round(
                    50 / (exploratory.ANALYSIS_SIZE**2), 9
                ),
                "geometryEdgePixelCount": 10,
                "photoEdgePixelCount": 20,
                "matchedGeometryEdgePixelCount": 4,
                "matchedFraction": 0.4,
            },
        }
        projection = {"projectedInputCount": 100, "visiblePixelCount": 50}
        measured = {
            "geometryEdgePixelCount": 10,
            "photoEdgePixelCount": 20,
            "matchedGeometryEdgePixelCount": 4,
            "matchedFraction": 0.4,
        }
        exploratory._assert_frozen_primary_metrics(
            selection, projection, measured
        )
        measured["matchedGeometryEdgePixelCount"] = 5
        with self.assertRaisesRegex(AuditError, "changed"):
            exploratory._assert_frozen_primary_metrics(
                selection, projection, measured
            )


if __name__ == "__main__":
    unittest.main()
