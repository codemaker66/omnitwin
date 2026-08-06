from __future__ import annotations

import copy
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "build_e57_matched_camera_views.py"
SPEC = importlib.util.spec_from_file_location("build_e57_matched_camera_views", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


POSES = {
    131: {
        "centre": [17.5966262817, 7.379904747, -1.378595829],
        "translation": [-9.2620143896, -1.5178631254, 16.6708115584],
        "quaternion": [0.5190136692, 0.5336963205, 0.4723088977, -0.4719293949],
    },
    134: {
        "centre": [19.4265480042, 10.2739276886, -1.3638334274],
        "translation": [-9.3353375821, -1.5703696309, 19.8793815441],
        "quaternion": [0.478418399, 0.4966795917, 0.5125185412, -0.5116150541],
    },
    138: {
        "centre": [12.7848520279, 11.7243080139, -1.3823702335],
        "translation": [11.0885153278, -2.1696665345, 13.2348087329],
        "quaternion": [0.0345518964, 0.0579969962, 0.7164456298, -0.6943689037],
    },
}

# These values were calculated independently from the written equations before
# the production helper was implemented. They protect axis order and signs.
EXPECTED_VIEWER_CAMERAS = {
    131: {
        "position": [-3.1805253634296204, 0.08865221183731364, 6.34484594453617],
        "lookAt": [1.7898991972316574, 0.009577637959774732, 5.807605869205574],
        "up": [0.017168995535974733, 0.9997842757284163, 0.011688780881321444],
    },
    134: {
        "position": [-4.347363409501719, 0.10341461343731373, 9.56392520283708],
        "lookAt": [0.47685254031024726, 0.009755894426437539, 8.253135931469224],
        "up": [0.022747027414597568, 0.9996657125522233, 0.012289666035155371],
    },
    138: {
        "position": [2.4508476219973505, 0.08487780733731354, 9.556488750638254],
        "lookAt": [2.0236090862631064, -0.08170211294982632, 4.577561319580357],
        "up": [0.028090076350740355, 0.9989629454600717, -0.035832683521436946],
    },
}


def registration_document() -> dict[str, object]:
    return {
        "schemaVersion": MODULE.REGISTRATION_SCHEMA_VERSION,
        "authority": "none",
        "proper": {
            "rotationRowMajor": [list(row) for row in MODULE.EXPECTED_REGISTRATION_ROTATION],
            "translationMeters": list(MODULE.EXPECTED_REGISTRATION_TRANSLATION),
        },
        "scope": {
            "validationScanIdsRead": list(MODULE.EXPECTED_SCAN_IDS),
            "frozenTestScanIdsNotRead": list(MODULE.FROZEN_TEST_SCAN_IDS),
            "fitTransformChangedOrRefit": False,
        },
        "comparison": {
            "properBeatsMirrorOnCombinedRmseAndBothDirectionalMedians": True,
        },
        "inputs": {
            "e57": {"knownPinnedSha256NotRehashed": MODULE.E57_SHA256},
            "potree": {
                "declaredBoundsMinMeters": [-6.985000133514404, -13.258999824523926, -1.9420000314712524],
                "declaredBoundsMaxMeters": [7.9710001945495605, 2.7929999828338623, 1.9570000171661377],
            },
        },
    }


def camera_row(scan_id: int) -> dict[str, object]:
    expected = MODULE.EXPECTED_IMAGES[scan_id]
    pose = POSES[scan_id]
    return {
        "candidateDiagnostics": [],
        "coarseEmpiricalRawRasterColmapPoseDiagnostic": {},
        "continuousRawRasterColmapPoseCandidate": {
            "camera": {
                "model": "PINHOLE",
                "parameters": list(MODULE.EXPECTED_INTRINSICS),
                "principalYRule": MODULE.EXPECTED_PRINCIPAL_Y_RULE,
            },
            "cameraCentre": pose["centre"],
            "meaning": "development candidate",
            "rasterTransform": "none",
            "source": MODULE.EXPECTED_POSE_SOURCE,
            "status": "candidate_requires_continuous_and_independent_geometry_validation",
            "translation": pose["translation"],
            "worldToCameraQuaternionWxyz": pose["quaternion"],
        },
        "data3DGuid": expected["data3DGuid"],
        "declaredImage2DRotation": {},
        "declaredImage2DRotationLegacyPositiveZCheck": {},
        "declaredIntrinsics": {"cx": 2048.0, "cy": 2048.0, "fx": 2048.0, "fy": 2048.0},
        "declaredRotationPlusFileSpecificRawRasterRelation": {
            "assessable": True,
            "matchesEmpiricalWinner": True,
            "rasterTransformForMaterializer": "none_already_reflected_in_embedded_JPEG_relationship",
            "relationship": MODULE.EXPECTED_RELATIONSHIP,
            "rightCrossDownDotForward": 1.0,
            "status": "internally_consistent_coarse_axis_candidate",
        },
        "evaluationRole": "held_out",
        "fixedMappingEvaluation": {
            "candidateId": MODULE.EXPECTED_CANDIDATE_ID,
            "declaredRawRasterRelationMatchesFixedCandidate": True,
            "diagnosticArgmaxAgreesWithFixedMapping": True,
            "diagnosticArgmaxCandidateId": MODULE.EXPECTED_CANDIDATE_ID,
            "passesFixedRunAcceptanceThresholds": True,
            "primaryPass": True,
            "status": "passes",
        },
        "image2DGuid": expected["image2DGuid"],
        "image2DIndex": expected["image2DIndex"],
        "jpeg": {
            "height": expected["height"],
            "sha256": expected["jpegSha256"],
            "sizeBytes": expected["jpegSizeBytes"],
            "width": expected["width"],
        },
        "name": MODULE.SKYBOX_NAME,
        "scanId": scan_id,
        "winner": {
            "assessable": True,
            "candidateId": MODULE.EXPECTED_CANDIDATE_ID,
            "passesFixedRunAcceptanceThresholds": True,
            "rightCrossDownDotForward": 1.0,
        },
    }


def reprojection_document() -> dict[str, object]:
    return {
        "schemaVersion": MODULE.REPROJECTION_SCHEMA_VERSION,
        "authority": "none",
        "scope": {
            "sourceE57Sha256": MODULE.E57_SHA256,
            "heldOutScanIds": [122, 123, *MODULE.EXPECTED_SCAN_IDS, 140],
        },
        "result": {
            "fixedMappingBySkyboxName": {MODULE.SKYBOX_NAME: MODULE.EXPECTED_CANDIDATE_ID},
            "allFixedMappingRowsPrimaryPass": True,
            "declaredRotationPlusFileSpecificRawRasterRelationMatchesFixedMapping": True,
            "knownPoseMaterializationPermitted": False,
            "trainingPermitted": False,
        },
        "images": [camera_row(scan_id) for scan_id in MODULE.EXPECTED_SCAN_IDS],
    }


def build_fixture() -> dict[str, object]:
    return MODULE.build_receipt(
        registration_document(),
        reprojection_document(),
        registration_evidence={"path": "registration.json", "sha256": "a" * 64, "sizeBytes": 1},
        reprojection_evidence={"path": "reprojection.json", "sha256": "b" * 64, "sizeBytes": 1},
        tool_evidence={"path": "tool.py", "sha256": "c" * 64, "sizeBytes": 1},
        enforce_frozen_pins=False,
    )


class CameraMathTests(unittest.TestCase):
    def test_derivation_matches_independently_calculated_cameras(self) -> None:
        receipt = build_fixture()
        self.assertEqual(receipt["authority"], "none")
        self.assertEqual([row["scanId"] for row in receipt["views"]], [131, 134, 138])
        for row in receipt["views"]:
            scan_id = row["scanId"]
            expected = EXPECTED_VIEWER_CAMERAS[scan_id]
            camera = row["viewerCamera"]
            for actual, wanted in zip(camera["positionMeters"], expected["position"]):
                self.assertAlmostEqual(actual, wanted, places=12)
            for actual, wanted in zip(camera["lookAtMeters"], expected["lookAt"]):
                self.assertAlmostEqual(actual, wanted, places=12)
            for actual, wanted in zip(camera["up"], expected["up"]):
                self.assertAlmostEqual(actual, wanted, places=12)
            self.assertEqual(camera["fovDegrees"], 90.0)
            self.assertTrue(row["experimentalQuery"]["search"].startswith("?camera="))
            parsed_position = [
                float(item)
                for item in row["experimentalQuery"]["parameters"]["camera"].split(",")
            ]
            self.assertEqual(parsed_position, camera["positionMeters"])
            forward = [
                (camera["lookAtMeters"][axis] - camera["positionMeters"][axis]) / 5.0
                for axis in range(3)
            ]
            self.assertAlmostEqual(math.sqrt(sum(value * value for value in forward)), 1.0, places=12)
            self.assertAlmostEqual(sum(forward[i] * camera["up"][i] for i in range(3)), 0.0, places=12)


class FailClosedTests(unittest.TestCase):
    def assert_code(self, code: str, callback: object) -> None:
        with self.assertRaises(MODULE.CameraReceiptError) as raised:
            callback()
        self.assertEqual(raised.exception.code, code)

    def test_mirrored_registration_is_rejected(self) -> None:
        document = registration_document()
        document["proper"]["rotationRowMajor"] = [
            [1.0, 0.0, 0.0],
            [0.0, -1.0, 0.0],
            [0.0, 0.0, 1.0],
        ]
        self.assert_code(
            "MIRRORED_REGISTRATION",
            lambda: MODULE._validate_registration(document, enforce_frozen_pin=False),
        )

    def test_wrong_scan_or_face_is_rejected(self) -> None:
        document = reprojection_document()
        document["images"][0]["name"] = "Skybox 3"
        self.assert_code(
            "VALIDATION_SCAN_SET_MISMATCH",
            lambda: MODULE.build_receipt(
                registration_document(),
                document,
                registration_evidence={},
                reprojection_evidence={},
                tool_evidence={},
                enforce_frozen_pins=False,
            ),
        )

    def test_failed_continuous_pose_or_fixed_mapping_is_rejected(self) -> None:
        with self.subTest("continuous pose"):
            document = reprojection_document()
            document["images"][1]["continuousRawRasterColmapPoseCandidate"]["status"] = "failed"
            self.assert_code(
                "FAILED_POSE_EVIDENCE",
                lambda: MODULE.build_receipt(
                    registration_document(),
                    document,
                    registration_evidence={},
                    reprojection_evidence={},
                    tool_evidence={},
                    enforce_frozen_pins=False,
                ),
            )
        with self.subTest("fixed mapping"):
            document = reprojection_document()
            document["images"][1]["fixedMappingEvaluation"]["primaryPass"] = False
            self.assert_code(
                "FAILED_POSE_EVIDENCE",
                lambda: MODULE.build_receipt(
                    registration_document(),
                    document,
                    registration_evidence={},
                    reprojection_evidence={},
                    tool_evidence={},
                    enforce_frozen_pins=False,
                ),
            )

    def test_non_square_intrinsics_are_rejected(self) -> None:
        document = reprojection_document()
        document["images"][2]["continuousRawRasterColmapPoseCandidate"]["camera"]["parameters"] = [
            2048.0,
            2000.0,
            2048.0,
            2048.0,
        ]
        self.assert_code(
            "NON_SQUARE_INTRINSICS",
            lambda: MODULE.build_receipt(
                registration_document(),
                document,
                registration_evidence={},
                reprojection_evidence={},
                tool_evidence={},
                enforce_frozen_pins=False,
            ),
        )

    def test_malformed_extra_and_duplicate_records_are_rejected(self) -> None:
        with self.subTest("extra field"):
            document = reprojection_document()
            document["images"][0]["unexpected"] = True
            self.assert_code(
                "MALFORMED_OR_EXTRA_RECORD",
                lambda: MODULE.build_receipt(
                    registration_document(),
                    document,
                    registration_evidence={},
                    reprojection_evidence={},
                    tool_evidence={},
                    enforce_frozen_pins=False,
                ),
            )
        with self.subTest("duplicate target row"):
            document = reprojection_document()
            document["images"].append(copy.deepcopy(document["images"][0]))
            self.assert_code(
                "EXTRA_VALIDATION_RECORD",
                lambda: MODULE._select_validation_rows(document),
            )

    def test_duplicate_json_keys_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "duplicate.json"
            path.write_text('{"authority":"none","authority":"other"}\n', encoding="utf-8")
            self.assert_code("DUPLICATE_JSON_KEY", lambda: MODULE._read_json(path, "fixture"))

    def test_output_collision_is_rejected_without_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "receipt.json"
            output.write_text("keep me\n", encoding="utf-8")
            self.assert_code(
                "OUTPUT_EXISTS",
                lambda: MODULE._write_create_only(output, build_fixture(), ()),
            )
            self.assertEqual(output.read_text(encoding="utf-8"), "keep me\n")


if __name__ == "__main__":
    unittest.main()
