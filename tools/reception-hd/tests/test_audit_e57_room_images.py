from __future__ import annotations

import json
import hashlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

from audit_e57_room_images import (  # noqa: E402
    REVIEW_SCHEMA_VERSION,
    FACE_BASES,
    AuditError,
    _quat_to_matrix,
    _rotation_matrix_to_quaternion,
    analyze_rgb,
    best_circular_ncc,
    build_audit,
    coverage_summary,
    e57_pose_to_colmap_vertical_flip,
    finalize_report,
    inspect_image,
    inspect_derivation_evidence,
    known_pose_for_face,
    load_e57_poses,
    load_visual_review,
    parse_scan_ids,
    propose_station_split,
    station_connectivity,
    summarize_native_e57_records,
    verify_payload_digest,
    write_create_only,
)


def structured_rgb(width: int, height: int, offset: int = 0) -> np.ndarray:
    yy, xx = np.mgrid[0:height, 0:width]
    checker = (((xx + offset) // 8 + yy // 8) % 2).astype(np.float64)
    rgb = np.zeros((height, width, 3), dtype=np.float64)
    rgb[:, :, 0] = 0.15 + 0.65 * checker
    rgb[:, :, 1] = 0.12 + 0.45 * (1.0 - checker)
    rgb[:, :, 2] = 0.2 + 0.3 * np.sin((xx + offset) / 9.0) ** 2
    return rgb


def save_jpeg(path: Path, rgb: np.ndarray) -> None:
    Image.fromarray(np.clip(rgb * 255.0, 0, 255).astype(np.uint8), mode="RGB").save(
        path, format="JPEG", quality=92
    )


def fake_poses(scan_ids: list[int]) -> tuple[dict[int, dict[str, object]], int]:
    poses: dict[int, dict[str, object]] = {}
    for index, scan_id in enumerate(scan_ids):
        poses[scan_id] = {
            "rotationWxyz": [1.0, 0.0, 0.0, 0.0],
            "translation": [float(index % 2), float(index // 2), 1.5],
            "quaternionNorm": 1.0,
        }
    return poses, 149


def fake_native_images(scan_ids: list[int]) -> dict[str, object]:
    return {
        "complete": True,
        "sourceClass": "native_e57_pinhole_jpeg",
        "scanCount": len(scan_ids),
        "imageCount": len(scan_ids) * 6,
        "uniqueImage2DGuidCount": len(scan_ids) * 6,
        "totalJpegBytesReadAndHashed": 12345,
        "intrinsicGroupCount": 1,
        "intrinsicGroups": [],
        "imageDimensionGroups": [{"width": 4096, "height": 4096}],
        "nativeImageManifestSha256": "a" * 64,
        "duplicateBlobGroups": [],
        "relativeQualityReviews": [],
        "maximumCameraCentreSpread": 0.0,
        "maximumImageToScanCentreDelta": 0.0,
        "maximumQuaternionNormError": 0.0,
        "maximumIdealCubeDeviationDegrees": 0.0,
        "scans": [],
        "meaning": "fixture",
    }


def make_native_records(
    *,
    centres: list[list[float]] | None = None,
    sha256s: list[str] | None = None,
) -> list[dict[str, object]]:
    signals = analyze_rgb(structured_rgb(64, 64))
    intrinsic = {
        "width": 4096,
        "height": 4096,
        "focalLength": 0.5,
        "pixelWidth": 1 / 4096,
        "pixelHeight": 1 / 4096,
        "principalPointX": 2048.0,
        "principalPointY": 2048.0,
        "fxPixels": 2048.0,
        "fyPixels": 2048.0,
        "candidateColmapCameraAfterRequiredVerticalFlip": {
            "status": "blocked_pending_hash_bound_lidar_reprojection",
            "model": "PINHOLE",
            "parameters": [2048.0, 2048.0, 2048.0, 2048.0],
            "requiredRasterTransform": "vertical_flip",
            "continuousCoordinateRule": "v_colmap = imageHeight - v_e57",
            "pixelRowRule": "row_colmap = imageHeight - 1 - row_e57",
        },
    }
    centres = centres or [[0.0, 0.0, 1.5] for _ in range(6)]
    sha256s = sha256s or [f"{index + 1:064x}" for index in range(6)]
    records: list[dict[str, object]] = []
    for index, (_, (axis, right, down)) in enumerate(FACE_BASES.items()):
        camera_to_world = np.column_stack([right, down, axis])
        records.append(
            {
                "image2DIndex": index,
                "image2DGuid": f"image-guid-{index}",
                "associatedData3DGuid": "scan-guid",
                "name": f"Skybox {index}",
                "intrinsics": intrinsic,
                "pose": {
                    "rotationWxyz": _rotation_matrix_to_quaternion(camera_to_world),
                    "translation": centres[index],
                    "sourceQuaternionNorm": 1.0,
                    "normalizedBeforeUse": True,
                },
                "jpeg": {
                    "sizeBytes": 100 + index,
                    "sha256": sha256s[index],
                    "signals": json.loads(json.dumps(signals)),
                },
            }
        )
    return records


class E57RoomImageAuditTests(unittest.TestCase):
    def test_image_signals_are_descriptive_and_finite(self) -> None:
        signals = analyze_rgb(structured_rgb(128, 64))

        self.assertGreater(signals["luminance"]["p01ToP99Range"], 0.15)
        self.assertGreater(signals["detailSignals"]["gradientEnergySigma0"], 0.0)
        self.assertGreater(signals["detailSignals"]["sigma1Retention"], 0.0)
        self.assertLessEqual(signals["luminance"]["nearWhiteFraction"], 1.0)

    def test_circular_continuity_recovers_known_horizontal_roll(self) -> None:
        first = np.random.default_rng(7).random((64, 128))
        second = np.roll(first, 17, axis=1)

        result = best_circular_ncc(first, second)

        self.assertTrue(result["assessable"])
        self.assertGreater(result["bestNcc"], 0.99)
        recovered_pixels = round(result["bestYawShiftDegrees"] * 128 / 360) % 128
        self.assertEqual(recovered_pixels, 111)

    def test_flat_continuity_is_not_assessable(self) -> None:
        flat = np.full((64, 128), 0.5)
        result = best_circular_ncc(flat, flat)
        self.assertFalse(result["assessable"])
        self.assertIsNone(result["bestNcc"])

    def test_e57_to_colmap_candidate_requires_vertical_flip_and_positive_depth(self) -> None:
        quaternion = np.asarray([0.91, 0.12, -0.23, 0.31], dtype=float)
        quaternion /= np.linalg.norm(quaternion)
        centre = np.asarray([2.0, -3.0, 1.5])
        e57_point = np.asarray([0.25, -0.4, -2.0])
        camera_to_world = _quat_to_matrix(quaternion)
        world_point = camera_to_world @ e57_point + centre

        rotation, translation = e57_pose_to_colmap_vertical_flip(quaternion, centre)
        colmap_point = rotation @ world_point + translation

        np.testing.assert_allclose(colmap_point, [0.25, 0.4, 2.0], atol=1e-9)
        self.assertGreater(colmap_point[2], 0)
        self.assertAlmostEqual(float(np.linalg.det(rotation)), 1.0, places=9)
        np.testing.assert_allclose(rotation @ rotation.T, np.eye(3), atol=1e-9)
        fx, fy, cx, cy, height = 2048.0, 2048.0, 1800.5, 1700.25, 4096.0
        e57_u = cx - fx * e57_point[0] / e57_point[2]
        e57_v = cy - fy * e57_point[1] / e57_point[2]
        colmap_u = cx + fx * colmap_point[0] / colmap_point[2]
        colmap_v = (height - cy) + fy * colmap_point[1] / colmap_point[2]
        self.assertAlmostEqual(colmap_u, e57_u)
        self.assertAlmostEqual(colmap_v, height - e57_v)

    def test_known_face_pose_maps_camera_centre_to_origin(self) -> None:
        centre = np.array([2.0, -3.0, 1.5])
        pose = known_pose_for_face([1.0, 0.0, 0.0, 0.0], centre, "front")
        rotation = _quat_to_matrix(pose["worldToCameraQuaternionWxyz"])
        translation = np.asarray(pose["worldToCameraTranslation"])

        np.testing.assert_allclose(rotation @ centre + translation, np.zeros(3), atol=1e-9)
        np.testing.assert_allclose(rotation[2], np.array([1.0, 0.0, 0.0]), atol=1e-9)

    def test_coverage_describes_planar_station_spread(self) -> None:
        poses = {
            1: {"translation": [0.0, 0.0, 1.5]},
            2: {"translation": [2.0, 0.0, 1.5]},
            3: {"translation": [0.0, 3.0, 1.5]},
            4: {"translation": [2.0, 3.0, 1.5]},
        }
        result = coverage_summary(poses)
        self.assertEqual(result["stationCount"], 4)
        self.assertAlmostEqual(result["bestFitPlaneHullAreaSquareUnits"], 6.0)
        self.assertEqual(result["coordinateExtents"]["z"], 0.0)
        self.assertIn("does not prove", result["meaning"])

    def test_coverage_handles_coincident_and_collinear_stations(self) -> None:
        coincident = {
            scan_id: {"translation": [1.0, 2.0, 3.0]} for scan_id in (1, 2, 3)
        }
        coincident_result = coverage_summary(coincident)
        self.assertEqual(coincident_result["nearestStationDistance"]["minimum"], 0.0)
        self.assertEqual(coincident_result["bestFitPlaneHullAreaSquareUnits"], 0.0)
        self.assertEqual(coincident_result["spatialRank"], 0)
        self.assertFalse(coincident_result["spatiallyDiverse"])

        collinear = {
            scan_id: {"translation": [float(scan_id), 0.0, 0.0]}
            for scan_id in (1, 2, 3)
        }
        collinear_result = coverage_summary(collinear)
        self.assertEqual(collinear_result["bestFitPlaneHullAreaSquareUnits"], 0.0)
        self.assertEqual(collinear_result["spatialRank"], 1)
        self.assertFalse(collinear_result["spatiallyDiverse"])

    def test_native_records_prove_complete_cube_rig_and_unique_images(self) -> None:
        records = make_native_records()
        result = summarize_native_e57_records(
            {122: records},
            {122: {"translation": [0.0, 0.0, 1.5]}},
            [122],
        )
        self.assertEqual(result["imageCount"], 6)
        self.assertEqual(result["intrinsicGroupCount"], 1)
        self.assertEqual(result["scans"][0]["cameraPairAngles"]["near90DegreeCount"], 12)
        self.assertEqual(result["scans"][0]["cameraPairAngles"]["near180DegreeCount"], 3)
        self.assertEqual(result["maximumCameraCentreSpread"], 0.0)
        self.assertEqual(result["duplicateBlobGroups"], [])

    def test_native_records_reject_duplicate_bytes_and_displaced_centres(self) -> None:
        duplicate_hashes = ["1" * 64, "1" * 64] + [f"{index:064x}" for index in range(2, 6)]
        with self.assertRaises(AuditError) as duplicate_context:
            summarize_native_e57_records(
                {122: make_native_records(sha256s=duplicate_hashes)},
                {122: {"translation": [0.0, 0.0, 1.5]}},
                [122],
            )
        self.assertEqual(duplicate_context.exception.code, "DUPLICATE_NATIVE_JPEG")

        centres = [[0.0, 0.0, 1.5] for _ in range(6)]
        centres[5] = [0.01, 0.0, 1.5]
        with self.assertRaises(AuditError) as centre_context:
            summarize_native_e57_records(
                {122: make_native_records(centres=centres)},
                {122: {"translation": [0.0, 0.0, 1.5]}},
                [122],
            )
        self.assertEqual(centre_context.exception.code, "NATIVE_CAMERA_CENTRE_SPREAD")

    def test_station_split_never_splits_images_within_a_station(self) -> None:
        scan_ids = list(range(20, 32))
        poses = {
            scan_id: {"translation": [float(scan_id % 4), float(scan_id // 4), 1.5]}
            for scan_id in scan_ids
        }
        split = propose_station_split(scan_ids, poses)
        groups = [
            set(split["trainingScanIds"]),
            set(split["validationScanIds"]),
            set(split["testScanIds"]),
        ]
        self.assertEqual(set.union(*groups), set(scan_ids))
        self.assertFalse(groups[0] & groups[1])
        self.assertFalse(groups[0] & groups[2])
        self.assertFalse(groups[1] & groups[2])
        self.assertEqual(split["splitUnit"], "complete_six-image_camera_station")

    def test_station_split_fails_closed_for_colocated_repeat_captures(self) -> None:
        scan_ids = list(range(20, 32))
        poses = {
            scan_id: {"translation": [float(scan_id % 4), float(scan_id // 4), 1.5]}
            for scan_id in scan_ids
        }
        poses[31] = {"translation": list(poses[20]["translation"])}
        split = propose_station_split(scan_ids, poses)
        self.assertEqual(split["status"], "not_proposed")
        self.assertIn([20, 31], split["coLocatedStationGroups"])

    def test_station_connectivity_reports_bridge_loss(self) -> None:
        poses = {
            1: {"translation": [0.0, 0.0, 0.0]},
            2: {"translation": [1.5, 0.0, 0.0]},
            3: {"translation": [3.6, 0.0, 0.0]},
        }
        result = station_connectivity([1, 2, 3], poses, thresholds=(2.0, 2.5))
        self.assertEqual(result["thresholdResults"][0]["componentCount"], 2)
        self.assertEqual(result["thresholdResults"][1]["componentCount"], 1)

    def test_missing_data3d_pose_is_not_silently_treated_as_identity(self) -> None:
        class Header:
            rotation = [1.0, 0.0, 0.0, 0.0]
            translation = [0.0, 0.0, 0.0]

            @staticmethod
            def has_pose() -> bool:
                return False

        class Source:
            scan_count = 1

            @staticmethod
            def get_header(index: int) -> Header:
                return Header()

        fake_module = types.SimpleNamespace(E57=lambda _: Source())
        with tempfile.TemporaryDirectory() as temporary:
            source_path = Path(temporary) / "source.e57"
            source_path.write_bytes(b"fixture")
            with patch.dict(sys.modules, {"pye57": fake_module}):
                with self.assertRaises(AuditError) as context:
                    load_e57_poses(source_path, [0])
        self.assertEqual(context.exception.code, "MISSING_DATA3D_POSE")

    def test_near_unit_quaternion_is_normalized_before_matrix_use(self) -> None:
        unit = np.asarray([0.7, -0.2, 0.1, 0.67], dtype=float)
        unit /= np.linalg.norm(unit)
        scaled = unit * (1.0 + 0.9e-5)
        expected = _quat_to_matrix(unit)
        actual = _quat_to_matrix(scaled)
        np.testing.assert_allclose(actual, expected, atol=1e-12)
        np.testing.assert_allclose(actual @ actual.T, np.eye(3), atol=1e-12)
        self.assertAlmostEqual(float(np.linalg.det(actual)), 1.0, places=12)

    def test_visual_review_rejects_wrong_source_and_wrong_reviewed_bytes(self) -> None:
        base = {
            "schemaVersion": REVIEW_SCHEMA_VERSION,
            "scanIds": [1],
            "sourceE57Sha256": "a" * 64,
            "reviewTargetClass": "loose_derived_panoramas",
            "reviewMethod": "fixture",
            "reviewedPanoramaSha256ByScanId": {"1": "b" * 64},
            "requiresHumanConfirmation": True,
            "decisionsAreQuarantineOnly": True,
            "quarantinedScans": [],
            "authority": "none",
        }
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "review.json"
            path.write_text(json.dumps(base), encoding="utf-8")
            with self.assertRaises(AuditError) as source_context:
                load_visual_review(
                    path,
                    [1],
                    source_e57_sha256="c" * 64,
                    panorama_sha256_by_scan={1: "b" * 64},
                )
            self.assertEqual(source_context.exception.code, "VISUAL_REVIEW_SOURCE_MISMATCH")
            with self.assertRaises(AuditError) as artifact_context:
                load_visual_review(
                    path,
                    [1],
                    source_e57_sha256="a" * 64,
                    panorama_sha256_by_scan={1: "d" * 64},
                )
            self.assertEqual(
                artifact_context.exception.code,
                "VISUAL_REVIEW_ARTIFACT_MISMATCH",
            )

    def test_create_only_writer_never_replaces_and_cleans_failed_temp(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "report.json"
            write_create_only(destination, b"first")
            self.assertEqual(destination.read_bytes(), b"first")
            with self.assertRaises(AuditError) as exists_context:
                write_create_only(destination, b"second")
            self.assertEqual(exists_context.exception.code, "OUTPUT_EXISTS")
            self.assertEqual(destination.read_bytes(), b"first")

            failed_destination = root / "failed.json"
            with patch("audit_e57_room_images.os.link", side_effect=OSError("fixture")):
                with self.assertRaises(AuditError) as failed_context:
                    write_create_only(failed_destination, b"payload")
            self.assertEqual(failed_context.exception.code, "OUTPUT_WRITE_FAILED")
            self.assertFalse(failed_destination.exists())
            self.assertEqual(list(root.glob(".failed.json.*.tmp")), [])

    def test_derivation_content_binding_requires_source_script_and_exact_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = root / "extract.py"
            script.write_text("# fixture\n", encoding="utf-8")
            script_sha256 = hashlib.sha256(script.read_bytes()).hexdigest()
            expected_outputs = {"scan_001.jpg": "d" * 64}
            receipt = root / "receipt.json"
            receipt.write_text(
                json.dumps(
                    {
                        "schemaVersion": "omnitwin.e57-image-derivation-receipt.v1",
                        "sourceE57Sha256": "a" * 64,
                        "sourceNativeImageManifestSha256": "b" * 64,
                        "extractor": {"sha256": script_sha256},
                        "invocation": {"selectedScanIds": [1], "arguments": ["--scans", "1"]},
                        "outputs": [
                            {"scanId": 1, "relativePath": "scan_001.jpg", "sha256": "d" * 64}
                        ],
                    }
                ),
                encoding="utf-8",
            )
            without_script = inspect_derivation_evidence(
                label="fixture",
                script_path=None,
                report_path=receipt,
                scan_ids=[1],
                expected_output_sha256=expected_outputs,
                source_e57_sha256="a" * 64,
                native_image_manifest_sha256="b" * 64,
            )
            self.assertFalse(without_script["contentBindingVerified"])
            with_script = inspect_derivation_evidence(
                label="fixture",
                script_path=script,
                report_path=receipt,
                scan_ids=[1],
                expected_output_sha256=expected_outputs,
                source_e57_sha256="a" * 64,
                native_image_manifest_sha256="b" * 64,
            )
            self.assertTrue(with_script["contentBindingVerified"])
            self.assertFalse(with_script["provenanceAuthenticated"])
            self.assertFalse(with_script["lineageVerified"])
            self.assertFalse(with_script["usableForPoseBinding"])

    def test_full_fixture_is_digest_bound_and_excludes_reviewed_scan(self) -> None:
        scan_ids = [10, 11, 12]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            e57_path = root / "source.e57"
            e57_path.write_bytes(b"fixture-e57")
            panorama_dir = root / "panoramas"
            cubemap_dir = root / "cubefaces"
            panorama_dir.mkdir()
            cubemap_dir.mkdir()
            for index, scan_id in enumerate(scan_ids):
                save_jpeg(
                    panorama_dir / f"scan_{scan_id:03d}_8192.jpg",
                    structured_rgb(128, 64, offset=index * 3),
                )
                for face_index, face in enumerate(("front", "back", "left", "right", "up", "down")):
                    save_jpeg(
                        cubemap_dir / f"scan_{scan_id:03d}_{face}.jpg",
                        structured_rgb(64, 64, offset=face_index + index),
                    )
            review_path = root / "review.json"
            source_sha256 = hashlib.sha256(e57_path.read_bytes()).hexdigest()
            panorama_hashes = {
                str(scan_id): hashlib.sha256(
                    (panorama_dir / f"scan_{scan_id:03d}_8192.jpg").read_bytes()
                ).hexdigest()
                for scan_id in scan_ids
            }
            review_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": REVIEW_SCHEMA_VERSION,
                        "scanIds": scan_ids,
                        "sourceE57Sha256": source_sha256,
                        "reviewTargetClass": "loose_derived_panoramas",
                        "reviewMethod": "fixture",
                        "reviewedPanoramaSha256ByScanId": panorama_hashes,
                        "requiresHumanConfirmation": True,
                        "decisionsAreQuarantineOnly": True,
                        "quarantinedScans": [{"scanId": 11, "reason": "moving fixture person"}],
                        "observations": ["fixture only"],
                        "authority": "none",
                    }
                ),
                encoding="utf-8",
            )
            derivation_script = root / "extract.py"
            derivation_script.write_text("# fixture\n", encoding="utf-8")
            panorama_report = root / "panorama-report.json"
            panorama_report.write_text(
                json.dumps({"sweeps": {f"scan_{scan_id:03d}": "ok" for scan_id in scan_ids}}),
                encoding="utf-8",
            )
            cubeface_report = root / "cubeface-report.json"
            cubeface_report.write_text(
                json.dumps({"sweeps": {"scan_010": "ok"}}),
                encoding="utf-8",
            )

            with (
                patch(
                    "audit_e57_room_images.load_e57_poses",
                    return_value=fake_poses(scan_ids),
                ),
                patch(
                    "audit_e57_room_images.inspect_native_e57_images",
                    return_value=fake_native_images(scan_ids),
                ),
            ):
                report = build_audit(
                    e57_path=e57_path,
                    panorama_dir=panorama_dir,
                    cubemap_dir=cubemap_dir,
                    scan_ids=scan_ids,
                    panorama_dimensions=(128, 64),
                    cubemap_dimensions=(64, 64),
                    visual_review_path=review_path,
                    panorama_derivation_script=derivation_script,
                    panorama_derivation_report=panorama_report,
                    cubeface_derivation_script=derivation_script,
                    cubeface_derivation_report=cubeface_report,
                )

        self.assertTrue(verify_payload_digest(report))
        self.assertEqual(report["counts"]["panoramas"], 3)
        self.assertEqual(report["counts"]["cubefaces"], 18)
        self.assertEqual(len(report["scope"]["sourceE57Sha256"]), 64)
        self.assertEqual(report["technicalDecision"]["provisionallyQuarantinedScanIds"], [11])
        self.assertEqual(
            report["technicalDecision"]["provisionalCandidateScanIdsPendingNativeReview"],
            [10, 12],
        )
        self.assertFalse(report["authorizationDecision"]["trainingPermitted"])
        self.assertFalse(report["technicalDecision"]["nativeKnownPoseScaffoldVerified"])
        self.assertFalse(report["technicalDecision"]["knownPoseReady"])
        self.assertFalse(report["technicalDecision"]["derivedKnownPoseScaffoldVerified"])
        self.assertEqual(
            report["derivationEvidence"]["cubefaces"]["missingScanIds"],
            [11, 12],
        )
        self.assertEqual(report["authority"], "none")

        changed = json.loads(json.dumps(report))
        changed["counts"]["panoramas"] = 4
        self.assertFalse(verify_payload_digest(changed))
        resealed = finalize_report(changed)
        self.assertTrue(verify_payload_digest(resealed))
        self.assertFalse(resealed["selfDigestMeaning"]["authenticatesCreator"])

    def test_inspector_rejects_wrong_dimensions_and_corrupt_jpeg(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            wrong = root / "wrong.jpg"
            save_jpeg(wrong, structured_rgb(32, 32))
            with self.assertRaisesRegex(AuditError, "expected 64x64"):
                inspect_image(
                    wrong,
                    expected_dimensions=(64, 64),
                    thumbnail_dimensions=(32, 32),
                )

            corrupt = root / "corrupt.jpg"
            corrupt.write_bytes(b"not a jpeg")
            with self.assertRaises(AuditError) as context:
                inspect_image(
                    corrupt,
                    expected_dimensions=None,
                    thumbnail_dimensions=(32, 32),
                )
            self.assertEqual(context.exception.code, "IMAGE_DECODE_FAILED")

    def test_scan_parser_rejects_backwards_or_duplicate_sets_at_build_boundary(self) -> None:
        self.assertEqual(parse_scan_ids("122-124,130"), [122, 123, 124, 130])
        with self.assertRaises(AuditError):
            parse_scan_ids("124-122")


if __name__ == "__main__":
    unittest.main()
