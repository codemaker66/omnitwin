from __future__ import annotations

from contextlib import redirect_stderr
import copy
import hashlib
from io import StringIO
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


# This import must precede every numeric import: it exercises T560's startup gate.
import build_grand_hall_panorama_e57_orientation as builder


PNG = b"\x89PNG\r\n\x1a\n"


def _sha(label: str) -> str:
    return hashlib.sha256(label.encode("utf-8")).hexdigest()


def _binding(relative: str) -> dict[str, object]:
    return {"relativePath": relative, "sha256": _sha(relative), "sizeBytes": 1}


def _candidate_pose() -> dict[str, object]:
    forward = [[0.0, 0.0, 1.0], [-1.0, 0.0, 0.0], [0.0, -1.0, 0.0]]
    inverse = [[0.0, -1.0, 0.0], [0.0, 0.0, -1.0], [1.0, 0.0, 0.0]]
    return {
        "accepted": False,
        "authority": "none",
        "cameraCenterState": "conditional_scanner_origin_zero_offset_hypothesis_unaccepted",
        "compositionState": "candidate_only_requires_correspondence_and_orientation_human_acceptance",
        "data3DQuaternionNormError": 0.0,
        "data3DRotationQuaternionWxyz": [1.0, 0.0, 0.0, 0.0],
        "data3DTranslationM": [1.0, 2.0, 3.0],
        "extrinsics": {
            "cameraCenterE57M": [1.0, 2.0, 3.0],
            "rotationDirection": "e57_from_conventional_panorama_camera",
            "rotationE57FromPanoramaCamera": forward,
            "rotationPanoramaCameraFromE57": inverse,
            "translationPanoramaCameraFromE57M": [2.0, 3.0, -1.0],
        },
        "humanReviewRequired": True,
    }


def _pack() -> builder.DerivedPack:
    files: dict[str, bytes] = {}
    pairs: list[dict[str, object]] = []
    for pair_id, sweep, scan, primary in builder._expected_pair_plan():
        name = f"orientation-review-{pair_id}-source-only.png"
        content = PNG + pair_id.encode("ascii")
        files[name] = content
        index = sweep - builder.EXPECTED_SWEEPS[0]
        caveat = (
            "two_matcher_supported_candidates_human_review_required"
            if primary and sweep == builder.ALTERNATE_SWEEP
            else "supported_same_or_near_station_revisit_human_comparison_required"
            if not primary
            else None
        )
        pairs.append(
            {
                "authority": "none",
                "candidateCorrespondence": {
                    "accepted": False,
                    "candidateKind": "primary" if primary else "supported_alternate",
                    "caveat": caveat,
                    "humanReviewRequired": True,
                    "supportedCandidateCount": 2 if sweep == 47 else 1,
                    "t560RatioMatchCount": (
                        builder.EXPECTED_T560_PRIMARY_RATIO_MATCHES[index]
                        if primary
                        else builder.EXPECTED_T560_ALTERNATE_RATIO_MATCHES
                    ),
                    "t560SphericalInlierCount": (
                        builder.EXPECTED_T560_PRIMARY_INLIERS[index]
                        if primary
                        else builder.EXPECTED_T560_ALTERNATE_INLIERS
                    ),
                },
                "candidateE57Pose": _candidate_pose() if primary else None,
                "data3DGuid": (
                    builder.EXPECTED_GUIDS[scan - 40]
                    if primary
                    else builder.ALTERNATE_GUID
                ),
                "guards": builder._authority_guards(),
                "humanDecisionOptions": (
                    ["scan46", "scan10", "both_same_station_revisit_unresolved", "neither", "unsure"]
                    if sweep == 47
                    else ["accept_candidate", "reject_candidate", "unsure"]
                ),
                "humanReviewGates": {
                    "allVisiblePixelsGrandHall": "pending",
                    "cameraCorrespondence": "pending",
                    "cameraStationInsideGrandHall": "pending",
                    "doorwayWindowOcclusionMasks": "pending",
                    "externalPanoramaOrientation": "pending",
                },
                "matchIdentityDigests": [_sha(pair_id + "-match")],
                "matchRecords": [
                    {
                        "externalPanoramaFeaturePixel2048x1024": [10.0, 20.0],
                        "faceFeaturePixel512x512": [30.0, 40.0],
                        "faceIndex": 1,
                        "faceQueryIndex": 2,
                        "foldIndex": 0,
                        "identitySha256": _sha(pair_id + "-match"),
                        "panoramaTrainIndex": 3,
                    }
                ],
                "nativeCubefaces": [
                    {
                        "faceIndex": face,
                        "relativePath": (
                            f"t559/images/scan_{scan:03d}/"
                            f"image2d_{scan * 6 + face:03d}_skybox_{face}.jpg"
                        ),
                        "sha256": _sha(f"scan-{scan}-face-{face}"),
                    }
                    for face in range(6)
                ],
                "orientationProposal": {
                    "foldIndexByMatch": [0],
                    "globalReflectionApplied": True,
                    "matchCount": 1,
                    "rotationPanoramaCanonicalFromScanner": [
                        [1.0, 0.0, 0.0],
                        [0.0, -1.0, 0.0],
                        [0.0, 0.0, 1.0],
                    ],
                },
                "pairId": pair_id,
                "physicalE57PoseComposed": primary,
                "reviewAid": {
                    "authority": "none",
                    "heightPx": (
                        builder.REVIEW_HEADER_HEIGHT
                        + builder.REVIEW_PANEL_HEIGHT * 2
                        + builder.REVIEW_FACE_HEIGHT
                    ),
                    "relativePath": name,
                    "role": "source_only_human_review_diagnostic",
                    "sha256": builder.sha256_bytes(content),
                    "sizeBytes": len(content),
                    "widthPx": builder.REVIEW_PANEL_WIDTH * 2,
                },
                "scanIndex": scan,
                "sourceExternalPanorama": {
                    "relativePath": f"sweep_{sweep:03d}jpg.jpg",
                    "sha256": _sha(f"sweep-{sweep}"),
                    "sweepNumber": sweep,
                },
                "state": "orientation_proposal_human_pending",
                "t561BoundaryAttentionRectangles": [
                    {"height": 100, "width": 100, "x": 5, "y": 5}
                ],
            }
        )
    contact_name = "orientation-review-contact-sheet-source-only.png"
    contact = PNG + b"contact"
    files[contact_name] = contact
    generator = {
        "files": [_binding(relative) for relative in builder.GENERATOR_RELATIVE_PATHS],
        "reviewedGitSha": "1" * 40,
    }
    source_bindings = {
        "controlFiles": [_binding(f"controls/{index:02d}.json") for index in range(14)],
        "sourceImages": [
            *[_binding(f"external/sweep-{sweep:03d}.jpg") for sweep in range(41, 49)],
            *[
                _binding(f"native/scan-{scan:03d}-face-{face}.jpg")
                for scan in (10, *range(40, 48))
                for face in range(6)
            ],
        ],
    }
    result = {
        "authority": "none",
        "contract": {
            "exactSourceImageCount": builder.EXPECTED_SOURCE_IMAGE_COUNT,
            "generatedContentUsed": False,
            "humanReviewRequired": True,
            "networkAccessUsed": False,
            "permissions": builder._authority_guards(),
            "sourceMutationPermitted": False,
            "truthScope": builder.TRUTH_SCOPE,
        },
        "dependencyAttestation": {},
        "generator": generator,
        "generatorSha256": builder.sha256_bytes(builder.canonical_json_bytes(generator)),
        "pairResults": pairs,
        "reviewContactSheet": {
            "authority": "none",
            "heightPx": (builder.CONTACT_LABEL_HEIGHT + builder.CONTACT_THUMB_HEIGHT) * 3,
            "relativePath": contact_name,
            "role": "source_only_nine_candidate_contact_sheet",
            "sha256": builder.sha256_bytes(contact),
            "sizeBytes": len(contact),
            "widthPx": builder.CONTACT_THUMB_WIDTH * builder.CONTACT_COLUMNS,
        },
        "schemaVersion": builder.RESULT_SCHEMA,
        "sourceBindings": source_bindings,
        "sourceBindingsSha256": builder.sha256_bytes(
            builder.canonical_json_bytes(source_bindings)
        ),
        "summary": {
            "acceptedCorrespondenceCount": 0,
            "acceptedOrientationCount": 0,
            "alternatePairCount": 1,
            "externalPanoramaCount": 8,
            "nativeCubefaceCount": 54,
            "pairCount": 9,
            "physicalCandidatePoseCount": 8,
            "reviewAidCount": 10,
            "winnerAuthority": "none",
        },
        "warnings": builder._warnings(),
    }
    return builder.DerivedPack(result, files)


class OrientationPackContractTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary_root = os.environ.get("E57_EVIDENCE_TEST_TMP")
        self.temporary = tempfile.TemporaryDirectory(dir=temporary_root)
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_exact_plan_renders_scan10_alternate_without_physical_pose(self) -> None:
        pack = _pack()
        with patch.object(builder.orientation_core, "validate_authority_none_result"):
            builder.validate_result(pack.result)
        rows = pack.result["pairResults"]
        alternate = rows[7]
        self.assertEqual(alternate["pairId"], "sweep-047-scan-010-alternate")
        self.assertIsNone(alternate["candidateE57Pose"])
        self.assertFalse(alternate["physicalE57PoseComposed"])
        self.assertIn("scan10", alternate["humanDecisionOptions"])
        self.assertIn(
            alternate["reviewAid"]["relativePath"],
            pack.files,
        )

    def test_alternate_cannot_claim_a_t564_composed_pose(self) -> None:
        pack = _pack()
        pack.result["pairResults"][7]["candidateE57Pose"] = _candidate_pose()
        with patch.object(builder.orientation_core, "validate_authority_none_result"):
            with self.assertRaisesRegex(ValueError, "scan-10 alternate"):
                builder.validate_result(pack.result)

    def test_primary_rejects_forged_nested_pose_matrix(self) -> None:
        pack = _pack()
        pack.result["pairResults"][0]["candidateE57Pose"]["extrinsics"][
            "rotationE57FromPanoramaCamera"
        ][0][0] = 0.25
        with patch.object(builder.orientation_core, "validate_authority_none_result"):
            with self.assertRaisesRegex(ValueError, "proper|source-bound"):
                builder.validate_result(pack.result)

    def test_publish_is_receipt_last_no_replace_and_verifiable(self) -> None:
        pack = _pack()
        output = self.root / "pack"
        events: list[str] = []
        with patch.object(builder.orientation_core, "validate_authority_none_result"):
            builder.publish_pack(output, pack, lambda event, _path: events.append(event))
            builder.verify_pack(output, pack)
            with self.assertRaisesRegex(ValueError, "replace|existing"):
                builder.publish_pack(output, pack)
        self.assertEqual(
            events,
            [
                "before-publication-stage",
                "after-payload-write",
                "after-result-write",
                "after-receipt-write",
                "before-no-replace-rename",
                "after-no-replace-rename",
            ],
        )
        receipt = json.loads((output / builder.RECEIPT_NAME).read_text("utf-8"))
        self.assertTrue(receipt["receiptWrittenLast"])
        self.assertEqual(len(receipt["files"]), 11)
        self.assertNotIn(builder.RECEIPT_NAME, [row["relativePath"] for row in receipt["files"]])

    def test_check_verifier_is_zero_write_and_detects_payload_tamper(self) -> None:
        pack = _pack()
        output = self.root / "pack"
        with patch.object(builder.orientation_core, "validate_authority_none_result"):
            builder.publish_pack(output, pack)
            before = {
                path.name: (path.read_bytes(), path.stat().st_mtime_ns)
                for path in output.iterdir()
            }
            builder.verify_pack(output, pack)
            after = {
                path.name: (path.read_bytes(), path.stat().st_mtime_ns)
                for path in output.iterdir()
            }
            self.assertEqual(before, after)
            target = output / "orientation-review-sweep-047-scan-010-alternate-source-only.png"
            target.write_bytes(target.read_bytes() + b"tamper")
            with self.assertRaisesRegex(ValueError, "fresh recomputation"):
                builder.verify_pack(output, pack)

    def test_result_rejects_opened_permission_and_wrong_pack_schema(self) -> None:
        for mutate in (
            lambda result: result["contract"]["permissions"].__setitem__("runtimeInputPermitted", True),
            lambda result: result.__setitem__("schemaVersion", builder.orientation_core.RESULT_SCHEMA),
        ):
            pack = _pack()
            mutate(pack.result)
            with patch.object(builder.orientation_core, "validate_authority_none_result"):
                with self.assertRaises(ValueError):
                    builder.validate_result(pack.result)

    def test_cli_requires_explicit_source_hash_verification(self) -> None:
        stderr = StringIO()
        with redirect_stderr(stderr), self.assertRaises(SystemExit) as raised:
            builder.main([])
        self.assertEqual(raised.exception.code, 2)
        self.assertIn("required", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
