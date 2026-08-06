from __future__ import annotations

import contextlib
import hashlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

import audit_e57_lidar_reprojection as reprojection_audit  # noqa: E402
from audit_e57_lidar_reprojection import (  # noqa: E402
    CANDIDATES,
    _angular_difference_degrees,
    cube_orientation_candidates,
    derive_and_evaluate_fixed_mapping,
    project_points,
    score_orientation,
    visible_pixel_selection,
)
from audit_e57_room_images import (  # noqa: E402
    AuditError,
    _quat_to_matrix,
    e57_pose_to_colmap_vertical_flip,
)


class _FakeValueNode:
    def __init__(self, value: object) -> None:
        self._value = value

    def value(self) -> object:
        return self._value


class _FakeBlobNode:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def byteCount(self) -> int:
        return len(self._payload)

    def read(self, target: bytearray, start: int, count: int) -> None:
        target[start : start + count] = self._payload[:count]


def _jpeg_payload(width: int, height: int) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (width, height), color=(40, 90, 130)).save(
        output,
        format="JPEG",
    )
    return output.getvalue()


def _fake_pinhole_representation(
    *,
    declared_width: int,
    declared_height: int,
    jpeg_width: int | None = None,
    jpeg_height: int | None = None,
    focal_length: float = 0.02,
) -> dict[str, object]:
    jpeg_width = declared_width if jpeg_width is None else jpeg_width
    jpeg_height = declared_height if jpeg_height is None else jpeg_height
    return {
        "imageWidth": _FakeValueNode(declared_width),
        "imageHeight": _FakeValueNode(declared_height),
        "focalLength": _FakeValueNode(focal_length),
        "pixelWidth": _FakeValueNode(0.001),
        "pixelHeight": _FakeValueNode(0.001),
        "principalPointX": _FakeValueNode(declared_width / 2),
        "principalPointY": _FakeValueNode(declared_height / 2),
        "jpegImage": _FakeBlobNode(_jpeg_payload(jpeg_width, jpeg_height)),
    }


class E57LidarReprojectionTests(unittest.TestCase):
    def test_angular_difference_normalizes_nearly_cardinal_axes(self) -> None:
        angle = _angular_difference_degrees(
            np.asarray([2.0, 0.0000002, 0.0]),
            np.asarray([1.0, 0.0, 0.0]),
        )

        self.assertGreater(angle, 0.0)
        self.assertAlmostEqual(angle, 0.000006, places=6)

    def test_jpeg_record_rejects_decoded_and_declared_dimension_mismatch(self) -> None:
        representation = _fake_pinhole_representation(
            declared_width=20,
            declared_height=12,
            jpeg_width=16,
            jpeg_height=12,
        )

        with self.assertRaises(AuditError) as raised:
            reprojection_audit._jpeg_record(
                representation,
                analysis_size=128,
                label="synthetic skybox",
            )

        self.assertEqual(raised.exception.code, "IMAGE_DIMENSION_MISMATCH")

    def test_jpeg_record_rejects_invalid_declared_intrinsics(self) -> None:
        representation = _fake_pinhole_representation(
            declared_width=16,
            declared_height=12,
            focal_length=0.0,
        )

        with self.assertRaises(AuditError) as raised:
            reprojection_audit._jpeg_record(
                representation,
                analysis_size=128,
                label="synthetic skybox",
            )

        self.assertEqual(raised.exception.code, "INVALID_INTRINSICS")

    def test_code_source_verification_rejects_a_mutated_capture(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "captured_tool.py"
            original = b"print('original')\n"
            source.write_bytes(original)
            capture = {
                "role": "syntheticTool",
                "path": source,
                "stat": source.stat(),
                "sha256": hashlib.sha256(original).hexdigest(),
            }
            source.write_bytes(b"print('mutated and longer')\n")

            with self.assertRaises(AuditError) as raised:
                reprojection_audit._verify_code_sources_unchanged([capture])

        self.assertEqual(raised.exception.code, "TOOL_CHANGED_DURING_AUDIT")

    def test_blocked_discovery_mapping_nulls_continuous_pose(self) -> None:
        row = {
            "scanId": 1,
            "name": "Skybox 0",
            "winner": {"candidateId": "forward_+Z_right_-Y_proper"},
            "candidateDiagnostics": [],
            "continuousRawRasterColmapPoseCandidate": {
                "status": "candidate_requires_continuous_and_independent_geometry_validation",
                "worldToCameraQuaternionWxyz": [1.0, 0.0, 0.0, 0.0],
                "translation": [4.0, 5.0, 6.0],
                "meaning": "synthetic pose that must not survive a blocked mapping",
            },
        }

        summary = derive_and_evaluate_fixed_mapping([row], [1])
        pose = row["continuousRawRasterColmapPoseCandidate"]

        self.assertFalse(summary["discoveryRowsComplete"])
        self.assertEqual(
            row["fixedMappingEvaluation"]["status"],
            "blocked_discovery_mapping_not_unanimous_or_complete",
        )
        self.assertIsNone(pose["worldToCameraQuaternionWxyz"])
        self.assertIsNone(pose["translation"])
        self.assertEqual(
            pose["status"],
            "blocked_fixed_mapping_or_relation_failure",
        )

    def test_candidate_family_contains_48_unique_orientations(self) -> None:
        candidates = cube_orientation_candidates()
        self.assertEqual(len(candidates), 48)
        self.assertEqual(len({candidate["id"] for candidate in candidates}), 48)
        for candidate in candidates:
            forward = candidate["forward"]
            right = candidate["right"]
            down = candidate["down"]
            self.assertAlmostEqual(float(np.dot(forward, right)), 0.0)
            self.assertAlmostEqual(float(np.dot(forward, down)), 0.0)
            self.assertAlmostEqual(float(np.dot(right, down)), 0.0)

    def test_candidate_family_has_24_proper_and_24_mirrored_determinants(self) -> None:
        determinant_counts = {1: 0, -1: 0}
        for candidate in cube_orientation_candidates():
            camera_to_scan = np.column_stack(
                [candidate["right"], candidate["down"], candidate["forward"]]
            )
            determinant = float(np.linalg.det(camera_to_scan))
            expected = -1 if candidate["mirrored"] else 1
            self.assertAlmostEqual(determinant, float(expected), places=12)
            determinant_counts[expected] += 1

        self.assertEqual(determinant_counts, {1: 24, -1: 24})

    def test_projection_recovers_the_known_nonmirrored_basis(self) -> None:
        width = height = 128
        fx = fy = 64.0
        cx = cy = 64.0
        forward = np.asarray([0.0, 0.0, 1.0])
        right = np.asarray([0.0, -1.0, 0.0])
        down = np.asarray([1.0, 0.0, 0.0])
        yy, xx = np.mgrid[8:120:2, 8:120:2]
        u = xx.reshape(-1).astype(float) + 0.25
        v = yy.reshape(-1).astype(float) + 0.25
        depth = 2.0 + ((xx.reshape(-1) + 3 * yy.reshape(-1)) % 17) / 10.0
        points = (
            depth[:, None] * forward
            + ((u - cx) / fx * depth)[:, None] * right
            + ((v - cy) / fy * depth)[:, None] * down
        )
        point_luma = (
            (37 * xx.reshape(-1) + 91 * yy.reshape(-1) + 17 * (xx * yy).reshape(-1))
            % 251
        ).astype(np.float32)
        image = np.zeros((height, width), dtype=np.float32)
        image[np.floor(v).astype(int), np.floor(u).astype(int)] = point_luma

        scored = []
        for candidate in CANDIDATES:
            score = score_orientation(
                points,
                point_luma,
                image,
                forward=candidate["forward"],
                right=candidate["right"],
                down=candidate["down"],
                fx=fx,
                fy=fy,
                cx=cx,
                cy=cy,
            )
            numeric = score["ncc"] if score["ncc"] is not None else -2.0
            scored.append((numeric, candidate["id"]))
        scored.sort(reverse=True)

        self.assertEqual(scored[0][1], "forward_+Z_right_-Y_proper")
        self.assertGreater(scored[0][0], 0.999)
        self.assertGreater(scored[0][0] - scored[1][0], 0.2)

    def test_projected_pixels_follow_right_and_down_axes(self) -> None:
        points = np.asarray([[1.0, 2.0, 4.0], [-1.0, -2.0, 4.0]])
        u, v, depth, valid = project_points(
            points,
            forward=np.asarray([0.0, 0.0, 1.0]),
            right=np.asarray([1.0, 0.0, 0.0]),
            down=np.asarray([0.0, 1.0, 0.0]),
            fx=100.0,
            fy=100.0,
            cx=50.0,
            cy=50.0,
            width=100,
            height=100,
        )
        np.testing.assert_allclose(u, [75.0, 25.0])
        np.testing.assert_allclose(v, [100.0, 0.0])
        np.testing.assert_allclose(depth, [4.0, 4.0])
        np.testing.assert_array_equal(valid, [False, True])

    def test_visible_pixel_selection_keeps_nearest_depth_and_measures_full_grid(self) -> None:
        # One sample in the centre of every 8x8 coverage cell.
        grid_y, grid_x = np.mgrid[0:8, 0:8]
        u = (grid_x.reshape(-1) * 10 + 5).astype(np.float64)
        v = (grid_y.reshape(-1) * 10 + 5).astype(np.float64)
        depth = np.full(64, 2.0, dtype=np.float64)

        # Add a nearer point in the same quantized pixel as sample zero. The
        # z-buffer must keep this last sample, independent of input order.
        u = np.append(u, 5.9)
        v = np.append(v, 5.1)
        depth = np.append(depth, 0.25)
        valid = np.ones(len(u), dtype=bool)

        selection = visible_pixel_selection(
            u,
            v,
            depth,
            valid,
            width=80,
            height=80,
        )

        self.assertEqual(selection["rawOverlapPoints"], 65)
        self.assertEqual(selection["uniqueVisiblePixels"], 64)
        self.assertEqual(selection["occupiedGridCells"], 64)
        self.assertEqual(selection["occupiedGridFraction"], 1.0)
        self.assertIn(64, selection["indexes"].tolist())
        self.assertNotIn(0, selection["indexes"].tolist())

    def test_visible_pixel_selection_excludes_invalid_points_from_coverage(self) -> None:
        selection = visible_pixel_selection(
            np.asarray([1.2, 71.2, 71.2]),
            np.asarray([1.2, 71.2, 71.2]),
            np.asarray([1.0, 0.5, 0.25]),
            np.asarray([True, True, False]),
            width=80,
            height=80,
        )

        self.assertEqual(selection["rawOverlapPoints"], 2)
        self.assertEqual(selection["uniqueVisiblePixels"], 2)
        self.assertEqual(selection["occupiedGridCells"], 2)

    def test_nonidentity_e57_pose_matches_raw_colmap_projection_with_noncentral_intrinsics(
        self,
    ) -> None:
        quaternion = np.asarray([0.71, -0.19, 0.41, 0.53], dtype=np.float64)
        quaternion /= np.linalg.norm(quaternion)
        camera_to_world = _quat_to_matrix(quaternion)
        camera_centre = np.asarray([3.25, -8.5, 1.75], dtype=np.float64)
        world_to_colmap, colmap_translation = e57_pose_to_colmap_vertical_flip(
            quaternion,
            camera_centre,
        )

        # All points are in front of the E57 camera (negative local Z).
        e57_camera_points = np.asarray(
            [
                [0.4, -0.2, -2.0],
                [-0.7, 0.8, -3.5],
                [1.2, 0.5, -5.0],
                [-0.1, -1.1, -1.8],
            ],
            dtype=np.float64,
        )
        world_points = (
            (camera_to_world @ e57_camera_points.T).T + camera_centre
        )
        colmap_points = (
            (world_to_colmap @ world_points.T).T + colmap_translation
        )

        width, height = 901, 613
        fx, fy = 487.25, 499.75
        cx_e57, cy_e57 = 317.4, 211.6
        x_e57, y_e57, z_e57 = e57_camera_points.T
        u_e57 = cx_e57 - fx * x_e57 / z_e57
        v_e57 = cy_e57 - fy * y_e57 / z_e57
        u_raw = u_e57
        v_raw = height - v_e57

        x_colmap, y_colmap, z_colmap = colmap_points.T
        u_colmap = cx_e57 + fx * x_colmap / z_colmap
        v_colmap = (height - cy_e57) + fy * y_colmap / z_colmap

        self.assertTrue(np.all(z_colmap > 0.0))
        np.testing.assert_allclose(u_colmap, u_raw, atol=1e-10)
        np.testing.assert_allclose(v_colmap, v_raw, atol=1e-10)
        np.testing.assert_allclose(
            -world_to_colmap.T @ colmap_translation,
            camera_centre,
            atol=1e-12,
        )
        self.assertAlmostEqual(float(np.linalg.det(world_to_colmap)), 1.0, places=12)

    def test_held_out_argmax_cannot_replace_mapping_frozen_on_discovery_scans(self) -> None:
        fixed_candidates = {
            "Skybox 0": "forward_+Z_right_-Y_proper",
            "Skybox 1": "forward_+X_right_-Y_proper",
            "Skybox 2": "forward_-Y_right_-X_proper",
            "Skybox 3": "forward_-X_right_+Y_proper",
            "Skybox 4": "forward_+Y_right_+X_proper",
            "Skybox 5": "forward_-Z_right_-Y_proper",
        }
        challenger = "forward_+Z_right_+X_proper"

        def diagnostic(candidate_id: str, ncc: float) -> dict[str, object]:
            return {
                "candidateId": candidate_id,
                "ncc": ncc,
                "assessable": True,
                "rawOverlapPoints": 7000,
                "uniqueVisiblePixels": 6500,
                "occupiedGridCells": 40,
            }

        rows: list[dict[str, object]] = []
        for scan_id in (1, 2, 3, 4):
            for name, fixed_candidate in fixed_candidates.items():
                held_out_disagreement = scan_id == 4 and name == "Skybox 0"
                diagnostics = [
                    diagnostic(
                        fixed_candidate,
                        0.90 if held_out_disagreement else 0.96,
                    ),
                    diagnostic(
                        challenger,
                        0.99 if held_out_disagreement else 0.50,
                    ),
                ]
                rows.append(
                    {
                        "scanId": scan_id,
                        "name": name,
                        "winner": {
                            "candidateId": (
                                challenger if held_out_disagreement else fixed_candidate
                            )
                        },
                        "candidateDiagnostics": diagnostics,
                    }
                )

        summary = derive_and_evaluate_fixed_mapping(rows, [1, 2, 3])
        held_out_row = next(
            row
            for row in rows
            if row["scanId"] == 4 and row["name"] == "Skybox 0"
        )
        evaluation = held_out_row["fixedMappingEvaluation"]

        self.assertTrue(summary["discoveryRowsComplete"])
        self.assertTrue(summary["discoveryMappingUnanimous"])
        self.assertTrue(summary["discoveryMappingIsProperSixFaceBijection"])
        self.assertEqual(
            summary["fixedMappingBySkyboxName"],
            fixed_candidates,
        )
        self.assertEqual(held_out_row["evaluationRole"], "held_out")
        self.assertEqual(
            evaluation["candidateId"],
            fixed_candidates["Skybox 0"],
        )
        self.assertEqual(evaluation["diagnosticArgmaxCandidateId"], challenger)
        self.assertFalse(evaluation["diagnosticArgmaxAgreesWithFixedMapping"])
        self.assertLess(evaluation["marginOverBestCoveredAlternative"], 0.0)
        self.assertFalse(evaluation["passesFixedRunAcceptanceThresholds"])
        self.assertFalse(evaluation["primaryPass"])
        self.assertFalse(summary["heldOutPrimaryPass"])

    def test_unanimous_but_collapsed_six_face_mapping_fails_every_row_closed(self) -> None:
        collapsed_candidate_id = "forward_+Z_right_-Y_proper"
        alternative_candidate_id = "forward_+Z_right_+X_proper"
        collapsed_candidate = next(
            candidate
            for candidate in CANDIDATES
            if candidate["id"] == collapsed_candidate_id
        )

        def score(candidate_id: str, ncc: float) -> dict[str, object]:
            return {
                "candidateId": candidate_id,
                "ncc": ncc,
                "assessable": True,
                "rawOverlapPoints": 7000,
                "uniqueVisiblePixels": 6500,
                "occupiedGridCells": 40,
            }

        rows = []
        for scan_id in (1, 2, 3, 4):
            for skybox_index in range(6):
                rows.append(
                    {
                        "scanId": scan_id,
                        "name": f"Skybox {skybox_index}",
                        "winner": {"candidateId": collapsed_candidate_id},
                        "candidateDiagnostics": [
                            score(collapsed_candidate_id, 0.96),
                            score(alternative_candidate_id, 0.50),
                        ],
                        "declaredRotationPlusFileSpecificRawRasterRelation": {
                            "ncc": 0.96,
                            "assessable": True,
                            "rawOverlapPoints": 7000,
                            "uniqueVisiblePixels": 6500,
                            "occupiedGridCells": 40,
                            "forwardInData3DFrame": collapsed_candidate[
                                "forward"
                            ].tolist(),
                            "imageRightInData3DFrame": collapsed_candidate[
                                "right"
                            ].tolist(),
                            "imageDownInData3DFrame": collapsed_candidate[
                                "down"
                            ].tolist(),
                            "convertedPoseGapFromSnappedEmpiricalWinner": {
                                "angleDegrees": 0.0
                            },
                        },
                        "continuousRawRasterColmapPoseCandidate": {
                            "status": "candidate_requires_continuous_and_independent_geometry_validation",
                            "worldToCameraQuaternionWxyz": [1.0, 0.0, 0.0, 0.0],
                            "translation": [1.0, 2.0, 3.0],
                        },
                    }
                )

        summary = derive_and_evaluate_fixed_mapping(rows, [1, 2, 3])

        self.assertTrue(summary["discoveryRowsComplete"])
        self.assertTrue(summary["discoveryMappingUnanimous"])
        self.assertFalse(summary["discoveryMappingIsProperSixFaceBijection"])
        self.assertFalse(summary["heldOutPrimaryPass"])
        self.assertTrue(
            all(not row["fixedMappingEvaluation"]["primaryPass"] for row in rows)
        )
        self.assertTrue(
            all(
                row["continuousRawRasterColmapPoseCandidate"][
                    "worldToCameraQuaternionWxyz"
                ]
                is None
                and row["continuousRawRasterColmapPoseCandidate"]["translation"]
                is None
                for row in rows
            )
        )

    def test_cli_requires_discovery_scans(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "synthetic.e57"
            source.write_bytes(b"not read because build is mocked")
            output = root / "report.json"
            argv = [
                "--e57",
                str(source),
                "--scans",
                "1-4",
                "--output",
                str(output),
            ]
            with (
                mock.patch.object(
                    reprojection_audit,
                    "build_reprojection_audit",
                    return_value={"synthetic": True},
                ) as build,
                mock.patch.object(reprojection_audit, "write_create_only"),
                contextlib.redirect_stderr(io.StringIO()),
                self.assertRaises(SystemExit) as raised,
            ):
                reprojection_audit.main(argv)

            self.assertEqual(raised.exception.code, 2)
            build.assert_not_called()

    def test_cli_parses_and_passes_discovery_scans_without_reading_e57(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "synthetic.e57"
            source.write_bytes(b"not read because build is mocked")
            output = root / "report.json"
            argv = [
                "--e57",
                str(source),
                "--scans",
                "1-4",
                "--discovery-scans",
                "1-3",
                "--output",
                str(output),
            ]
            report = {"synthetic": True}
            with (
                mock.patch.object(
                    reprojection_audit,
                    "build_reprojection_audit",
                    return_value=report,
                ) as build,
                mock.patch.object(
                    reprojection_audit,
                    "write_create_only",
                ) as write,
            ):
                return_code = reprojection_audit.main(argv)

            self.assertEqual(return_code, 0)
            build.assert_called_once_with(
                e57_path=source.resolve(),
                scan_ids=[1, 2, 3, 4],
                maximum_points=120000,
                analysis_size=512,
                overlay_dir=None,
                overlay_scan_ids=[],
                discovery_scan_ids=[1, 2, 3],
            )
            write.assert_called_once()
            self.assertEqual(write.call_args.args[0], output)
            self.assertEqual(write.call_args.args[1], b'{"synthetic":true}\n')


if __name__ == "__main__":
    unittest.main()
