from __future__ import annotations

import copy
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = (
    Path(__file__).resolve().parents[1] / "build_e57_method_holdout_camera_views.py"
)
SPEC = importlib.util.spec_from_file_location(
    "build_e57_method_holdout_camera_views", MODULE_PATH
)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


POSES = {
    126: {
        "centre": [13.8556938171, 5.1018781662, -1.3794653416],
        "translation": [-13.5004332826, -0.7971404406, -6.0840122374],
        "quaternion": [0.7034017348, 0.7096374534, -0.0388819123, 0.0113525827],
    },
    129: {
        "centre": [18.1249599457, 2.8670783043, -1.40218997],
        "translation": [-18.0652039674, -0.7641615612, -3.4300015268],
        "quaternion": [0.7004004724, 0.7134125239, -0.0219368227, -0.0007244432],
    },
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
    141: {
        "centre": [14.7490701675, 9.3063182831, -1.3703913689],
        "translation": [-15.0955576325, -2.0565887434, -8.5973941285],
        "quaternion": [0.7153849036, 0.6981968313, 0.026897384, -0.0047069323],
    },
}


def registration_document() -> dict[str, object]:
    base = MODULE.BASE
    return {
        "schemaVersion": base.REGISTRATION_SCHEMA_VERSION,
        "authority": "none",
        "proper": {
            "rotationRowMajor": [list(row) for row in base.EXPECTED_REGISTRATION_ROTATION],
            "translationMeters": list(base.EXPECTED_REGISTRATION_TRANSLATION),
        },
        "scope": {
            "validationScanIdsRead": list(MODULE.ORIGINAL_VALIDATION_SCAN_IDS),
            "frozenTestScanIdsNotRead": list(MODULE.HOLDOUT_SCAN_IDS),
            "fitTransformChangedOrRefit": False,
        },
        "comparison": {
            "properBeatsMirrorOnCombinedRmseAndBothDirectionalMedians": True,
        },
        "inputs": {
            "e57": {"knownPinnedSha256NotRehashed": base.E57_SHA256},
            "potree": {
                "declaredBoundsMinMeters": [
                    -6.985000133514404,
                    -13.258999824523926,
                    -1.9420000314712524,
                ],
                "declaredBoundsMaxMeters": [
                    7.9710001945495605,
                    2.7929999828338623,
                    1.9570000171661377,
                ],
            },
        },
    }


def expected_image(scan_id: int) -> dict[str, object]:
    if scan_id in MODULE.EXPECTED_IMAGES:
        return MODULE.EXPECTED_IMAGES[scan_id]
    return MODULE.BASE.EXPECTED_IMAGES[scan_id]


def camera_row(scan_id: int) -> dict[str, object]:
    base = MODULE.BASE
    expected = expected_image(scan_id)
    pose = POSES[scan_id]
    return {
        "candidateDiagnostics": [],
        "coarseEmpiricalRawRasterColmapPoseDiagnostic": {},
        "continuousRawRasterColmapPoseCandidate": {
            "camera": {
                "model": "PINHOLE",
                "parameters": list(base.EXPECTED_INTRINSICS),
                "principalYRule": base.EXPECTED_PRINCIPAL_Y_RULE,
            },
            "cameraCentre": list(pose["centre"]),
            "meaning": "synthetic receipt fixture",
            "rasterTransform": "none",
            "source": base.EXPECTED_POSE_SOURCE,
            "status": "candidate_requires_continuous_and_independent_geometry_validation",
            "translation": list(pose["translation"]),
            "worldToCameraQuaternionWxyz": list(pose["quaternion"]),
        },
        "data3DGuid": expected["data3DGuid"],
        "declaredImage2DRotation": {},
        "declaredImage2DRotationLegacyPositiveZCheck": {},
        "declaredIntrinsics": {"cx": 2048.0, "cy": 2048.0, "fx": 2048.0, "fy": 2048.0},
        "declaredRotationPlusFileSpecificRawRasterRelation": {
            "assessable": True,
            "matchesEmpiricalWinner": True,
            "rasterTransformForMaterializer": (
                "none_already_reflected_in_embedded_JPEG_relationship"
            ),
            "relationship": base.EXPECTED_RELATIONSHIP,
            "rightCrossDownDotForward": 1.0,
            "status": "internally_consistent_coarse_axis_candidate",
        },
        "evaluationRole": "held_out",
        "fixedMappingEvaluation": {
            "candidateId": base.EXPECTED_CANDIDATE_ID,
            "declaredRawRasterRelationMatchesFixedCandidate": True,
            "diagnosticArgmaxAgreesWithFixedMapping": True,
            "diagnosticArgmaxCandidateId": base.EXPECTED_CANDIDATE_ID,
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
            "candidateId": base.EXPECTED_CANDIDATE_ID,
            "passesFixedRunAcceptanceThresholds": True,
            "rightCrossDownDotForward": 1.0,
        },
    }


def reprojection_document() -> dict[str, object]:
    base = MODULE.BASE
    scan_ids = (*MODULE.HOLDOUT_SCAN_IDS, *MODULE.ORIGINAL_VALIDATION_SCAN_IDS)
    return {
        "schemaVersion": base.REPROJECTION_SCHEMA_VERSION,
        "authority": "none",
        "scope": {
            "sourceE57Sha256": base.E57_SHA256,
            "heldOutScanIds": [
                122,
                123,
                126,
                129,
                131,
                134,
                138,
                140,
                141,
            ],
        },
        "result": {
            "fixedMappingBySkyboxName": {
                MODULE.SKYBOX_NAME: base.EXPECTED_CANDIDATE_ID
            },
            "allFixedMappingRowsPrimaryPass": True,
            "declaredRotationPlusFileSpecificRawRasterRelationMatchesFixedMapping": True,
            "knownPoseMaterializationPermitted": False,
            "trainingPermitted": False,
        },
        "images": [camera_row(scan_id) for scan_id in scan_ids],
    }


def evidence(label: str) -> dict[str, object]:
    return {"path": f"{label}.json", "sha256": label[0] * 64, "sizeBytes": 1}


def build_fixture(
    registration: dict[str, object] | None = None,
    reprojection: dict[str, object] | None = None,
) -> dict[str, object]:
    return MODULE.build_receipt(
        registration if registration is not None else registration_document(),
        reprojection if reprojection is not None else reprojection_document(),
        registration_evidence=evidence("aaaa-registration"),
        reprojection_evidence=evidence("bbbb-reprojection"),
        tool_evidence=evidence("cccc-tool"),
        enforce_frozen_pins=False,
    )


class ExactHoldoutCameraTests(unittest.TestCase):
    def test_exact_independently_recorded_cameras_and_safety_scope(self) -> None:
        receipt = build_fixture()
        MODULE.verify_receipt(receipt)
        self.assertEqual(receipt["schemaVersion"], MODULE.SCHEMA_VERSION)
        self.assertEqual(receipt["authority"], "none")
        self.assertEqual([row["scanId"] for row in receipt["views"]], [126, 129, 141])
        self.assertTrue(receipt["scope"]["methodSpecificHoldout"])
        self.assertFalse(receipt["scope"]["globallyPristine"])
        self.assertFalse(receipt["scope"]["globallyUnseen"])
        self.assertFalse(receipt["scope"]["rawE57Read"])
        self.assertFalse(receipt["scope"]["jpegBytesRead"])
        self.assertFalse(receipt["scope"]["jpegPixelsDecoded"])
        self.assertFalse(receipt["scope"]["externalPoseFileRead"])
        self.assertFalse(receipt["usageLimits"]["runtimePromotionPermitted"])
        self.assertFalse(receipt["usageLimits"]["trainingPermitted"])
        self.assertFalse(receipt["usageLimits"]["publicReleasePermitted"])
        self.assertEqual(
            receipt["inputs"]["baseCameraTool"]["sha256"], MODULE.BASE_TOOL_SHA256
        )

        for row in receipt["views"]:
            scan_id = row["scanId"]
            self.assertEqual(row["viewerCamera"], MODULE.EXPECTED_VIEWER_CAMERAS[scan_id])
            self.assertEqual(
                row["sourceImage"]["jpeg"]["sha256"],
                MODULE.EXPECTED_IMAGES[scan_id]["jpegSha256"],
            )
            self.assertEqual(
                row["experimentalQuery"]["parameters"]["experimentalViewId"],
                f"e57-method-holdout-scan-{scan_id}-skybox-4",
            )
            camera = row["viewerCamera"]
            forward = [
                (camera["lookAtMeters"][axis] - camera["positionMeters"][axis]) / 5.0
                for axis in range(3)
            ]
            self.assertAlmostEqual(
                math.sqrt(sum(value * value for value in forward)), 1.0, places=12
            )
            self.assertAlmostEqual(
                sum(forward[index] * camera["up"][index] for index in range(3)),
                0.0,
                places=12,
            )

    def test_self_digest_detects_receipt_tampering(self) -> None:
        receipt = build_fixture()
        receipt["scope"]["globallyPristine"] = True
        with self.assertRaises(MODULE.HoldoutCameraReceiptError) as raised:
            MODULE.verify_receipt(receipt)
        self.assertEqual(raised.exception.code, "RECEIPT_DIGEST_MISMATCH")


class FailClosedTests(unittest.TestCase):
    def assert_code(self, code: str, callback: object) -> None:
        with self.assertRaises(MODULE.HoldoutCameraReceiptError) as raised:
            callback()
        self.assertEqual(raised.exception.code, code)

    def test_original_frozen_validation_is_rejected_before_holdout_derivation(self) -> None:
        registration = registration_document()
        registration["scope"]["validationScanIdsRead"] = [126, 129, 141]
        self.assert_code(
            "VALIDATION_SCAN_SET_MISMATCH",
            lambda: build_fixture(registration=registration),
        )

    def test_holdout_jpeg_identity_tampering_is_rejected(self) -> None:
        reprojection = reprojection_document()
        row = next(row for row in reprojection["images"] if row["scanId"] == 129)
        row["jpeg"]["sha256"] = "0" * 64
        self.assert_code(
            "JPEG_EVIDENCE_MISMATCH",
            lambda: build_fixture(reprojection=reprojection),
        )

    def test_consistent_pose_tampering_cannot_move_a_pinned_viewer_camera(self) -> None:
        reprojection = reprojection_document()
        row = next(row for row in reprojection["images"] if row["scanId"] == 126)
        pose = row["continuousRawRasterColmapPoseCandidate"]
        pose["cameraCentre"][0] += 0.01
        rotation = MODULE.BASE._quaternion_to_matrix(
            pose["worldToCameraQuaternionWxyz"]
        )
        pose["translation"] = [
            -value for value in MODULE.BASE._matvec(rotation, pose["cameraCentre"])
        ]
        self.assert_code(
            "VIEWER_CAMERA_PIN_MISMATCH",
            lambda: build_fixture(reprojection=reprojection),
        )

    def test_wrong_holdout_scan_or_face_is_rejected(self) -> None:
        with self.subTest("face"):
            reprojection = reprojection_document()
            row = next(row for row in reprojection["images"] if row["scanId"] == 126)
            row["name"] = "Skybox 3"
            self.assert_code(
                "VALIDATION_SCAN_SET_MISMATCH",
                lambda: build_fixture(reprojection=reprojection),
            )
        with self.subTest("scan"):
            reprojection = reprojection_document()
            row = next(row for row in reprojection["images"] if row["scanId"] == 141)
            row["scanId"] = 142
            self.assert_code(
                "VALIDATION_SCAN_SET_MISMATCH",
                lambda: build_fixture(reprojection=reprojection),
            )

    def test_base_globals_restore_after_success_and_failure(self) -> None:
        original_scan_ids = MODULE.BASE.EXPECTED_SCAN_IDS
        original_test_ids = MODULE.BASE.FROZEN_TEST_SCAN_IDS
        original_images = MODULE.BASE.EXPECTED_IMAGES

        build_fixture()
        self.assertIs(MODULE.BASE.EXPECTED_SCAN_IDS, original_scan_ids)
        self.assertIs(MODULE.BASE.FROZEN_TEST_SCAN_IDS, original_test_ids)
        self.assertIs(MODULE.BASE.EXPECTED_IMAGES, original_images)

        reprojection = reprojection_document()
        row = next(row for row in reprojection["images"] if row["scanId"] == 141)
        row["jpeg"]["sizeBytes"] += 1
        self.assert_code(
            "JPEG_EVIDENCE_MISMATCH",
            lambda: build_fixture(reprojection=reprojection),
        )
        self.assertIs(MODULE.BASE.EXPECTED_SCAN_IDS, original_scan_ids)
        self.assertIs(MODULE.BASE.FROZEN_TEST_SCAN_IDS, original_test_ids)
        self.assertIs(MODULE.BASE.EXPECTED_IMAGES, original_images)

    def test_file_evidence_pins_fail_closed(self) -> None:
        self.assert_code(
            "REGISTRATION_FILE_PIN_MISMATCH",
            lambda: MODULE._require_file_pins(
                {"path": "registration.json", "sha256": "0" * 64, "sizeBytes": 1},
                {
                    "path": "reprojection.json",
                    "sha256": MODULE.REPROJECTION_FILE_SHA256,
                    "sizeBytes": 1,
                },
            ),
        )

    def test_output_is_create_only(self) -> None:
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
