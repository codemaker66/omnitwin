from __future__ import annotations

from dataclasses import replace
import hashlib
import unittest

import numpy as np

import grand_hall_e57_cubeface_extrinsics as core


def _direction_colours(directions: np.ndarray) -> np.ndarray:
    unit = directions / np.linalg.norm(directions, axis=1, keepdims=True)
    quantized = np.floor((unit + 1.0) * 8191.0).astype(np.int64)
    mixed = (
        quantized[:, 0] * 73_856_093
        ^ quantized[:, 1] * 19_349_663
        ^ quantized[:, 2] * 83_492_791
    )
    return np.column_stack(
        ((mixed >> 1) & 255, (mixed >> 11) & 255, (mixed >> 21) & 255)
    ).astype(np.uint8)


def _synthetic_cube() -> tuple[core.ScannerSample, list[np.ndarray], core.CameraIntrinsics]:
    intrinsics = core.CameraIntrinsics(64, 64, 32.0, 32.0, 32.0, 32.0)
    basis_ids = (
        "r-y_d+x_f+z",
        "r-y_d-z_f+x",
        "r-x_d-z_f-y",
        "r+y_d-z_f-x",
        "r+x_d-z_f+y",
        "r-y_d-x_f-z",
    )
    point_chunks: list[np.ndarray] = []
    colour_chunks: list[np.ndarray] = []
    images: list[np.ndarray] = []
    for basis_id in basis_ids:
        basis = core.BASIS_BY_ID[basis_id]
        grid_y, grid_x = np.mgrid[2:62, 2:62]
        camera = np.column_stack(
            (
                (grid_x.ravel() - intrinsics.principal_x) / intrinsics.focal_x,
                (grid_y.ravel() - intrinsics.principal_y) / intrinsics.focal_y,
                np.ones(grid_x.size),
            )
        )
        scanner = camera @ basis.matrix().T
        colours = _direction_colours(scanner)
        point_chunks.append(scanner)
        colour_chunks.append(colours)
        full_y, full_x = np.mgrid[0:64, 0:64]
        full_camera = np.column_stack(
            (
                (full_x.ravel() - intrinsics.principal_x) / intrinsics.focal_x,
                (full_y.ravel() - intrinsics.principal_y) / intrinsics.focal_y,
                np.ones(full_x.size),
            )
        )
        full_scanner = full_camera @ basis.matrix().T
        image = _direction_colours(full_scanner).reshape(64, 64, 3)
        image = np.minimum(image.astype(np.uint16) + 1, 255).astype(np.uint8)
        images.append(image)
    points = np.concatenate(point_chunks)
    colours = np.concatenate(colour_chunks)
    row = np.arange(len(points), dtype=np.uint16)
    column = np.arange(len(points), dtype=np.uint16)
    digest = hashlib.sha256(points.astype("<f8").tobytes()).hexdigest()
    return core.ScannerSample(points, colours, row, column, digest), images, intrinsics


class GrandHallCubefaceCoreTests(unittest.TestCase):
    def test_enumerates_all_signed_axis_bases(self) -> None:
        self.assertEqual(len(core.SIGNED_AXIS_BASES), 48)
        self.assertEqual(sum(item.determinant == 1 for item in core.SIGNED_AXIS_BASES), 24)
        self.assertEqual(sum(item.determinant == -1 for item in core.SIGNED_AXIS_BASES), 24)
        for item in core.SIGNED_AXIS_BASES:
            np.testing.assert_array_equal(item.matrix().T @ item.matrix(), np.eye(3))

    def test_recovers_a_proper_six_face_cube_from_pose_blind_inputs(self) -> None:
        sample, images, intrinsics = _synthetic_cube()
        thresholds = core.ScoringThresholds(
            minimum_samples_per_face=3_000,
            minimum_coverage_bins=32,
            minimum_luminance_ncc=0.95,
            minimum_ncc_margin=0.50,
            maximum_rgb_mae=2.0,
            minimum_runner_mae_ratio=10.0,
        )
        solves = [
            core.solve_face(sample, image, index, intrinsics, thresholds)
            for index, image in enumerate(images)
        ]
        self.assertEqual(
            core.validate_cube_solution(solves),
            (
                "r-y_d+x_f+z",
                "r-y_d-z_f+x",
                "r-x_d-z_f-y",
                "r+y_d-z_f-x",
                "r+x_d-z_f+y",
                "r-y_d-x_f-z",
            ),
        )
        self.assertTrue(all(len(value.scores) == 48 for value in solves))
        self.assertTrue(all(value.winner.determinant == 1 for value in solves))

    def test_corrupted_image_fails_closed(self) -> None:
        sample, images, intrinsics = _synthetic_cube()
        random = np.random.default_rng(17).integers(0, 256, size=images[0].shape, dtype=np.uint8)
        with self.assertRaisesRegex(ValueError, "reflection|correlation|margin|colour"):
            core.solve_face(
                sample,
                random,
                0,
                intrinsics,
                core.ScoringThresholds(minimum_samples_per_face=3_000),
            )

    def test_low_texture_image_fails_closed(self) -> None:
        sample, _images, intrinsics = _synthetic_cube()
        with self.assertRaisesRegex(ValueError, "reflection|correlation"):
            core.solve_face(
                sample,
                np.full((64, 64, 3), 127, dtype=np.uint8),
                0,
                intrinsics,
                core.ScoringThresholds(minimum_samples_per_face=3_000),
            )

    def test_perfect_match_has_infinite_runner_error_ratio(self) -> None:
        winner = core.BasisScore("winner", 1, 10_000, 64, 0.99, 0.0)
        runner = core.BasisScore("runner", 1, 10_000, 64, 0.20, 25.0)
        core._require_face_gates(winner, runner, core.ScoringThresholds(), 0)
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            core._require_face_gates(
                winner,
                replace(runner, rgb_mae=0.0),
                core.ScoringThresholds(),
                0,
            )

    def test_cube_rejects_duplicate_face_orientation(self) -> None:
        sample, images, intrinsics = _synthetic_cube()
        thresholds = core.ScoringThresholds(
            minimum_samples_per_face=3_000,
            minimum_coverage_bins=32,
            minimum_luminance_ncc=0.95,
            minimum_ncc_margin=0.50,
            maximum_rgb_mae=2.0,
            minimum_runner_mae_ratio=10.0,
        )
        first = core.solve_face(sample, images[0], 0, intrinsics, thresholds)
        duplicates = [replace(first, face_index=index) for index in range(6)]
        with self.assertRaisesRegex(ValueError, "reuses"):
            core.validate_cube_solution(duplicates)

    def test_sampling_is_order_stable_and_rejects_duplicate_rays(self) -> None:
        points = np.asarray([[2.0, 0.0, 0.0], [3.0, 0.0, 0.0], [4.0, 0.0, 0.0]])
        colours = np.asarray([[1, 2, 3], [4, 5, 6], [7, 8, 9]], dtype=np.uint8)
        rows = np.asarray([8, 0, 16], dtype=np.uint16)
        columns = np.asarray([8, 0, 16], dtype=np.uint16)
        invalid = np.zeros(3, dtype=np.int8)
        sample = core.deterministic_scanner_sample(points, colours, rows, columns, invalid)
        self.assertEqual(sample.row_indices.tolist(), [0, 8, 16])
        duplicate_rows = np.asarray([0, 0, 16], dtype=np.uint16)
        duplicate_columns = np.asarray([0, 0, 16], dtype=np.uint16)
        with self.assertRaisesRegex(ValueError, "duplicate"):
            core.deterministic_scanner_sample(
                points, colours, duplicate_rows, duplicate_columns, invalid
            )

    def test_sampling_rejects_nonfinite_points_and_out_of_range_colours(self) -> None:
        point = np.asarray([[float("nan"), 0.0, 1.0]])
        rows = np.asarray([0], dtype=np.uint16)
        invalid = np.asarray([0], dtype=np.int8)
        with self.assertRaisesRegex(ValueError, "NaN"):
            core.deterministic_scanner_sample(
                point, np.asarray([[1, 2, 3]], dtype=np.uint8), rows, rows, invalid
            )
        with self.assertRaisesRegex(ValueError, "uint8"):
            core.deterministic_scanner_sample(
                np.asarray([[0.0, 0.0, 1.0]]),
                np.asarray([[300, 2, 3]], dtype=np.int16),
                rows,
                rows,
                invalid,
            )
        with self.assertRaisesRegex(ValueError, "16-bit"):
            core.deterministic_scanner_sample(
                np.asarray([[0.0, 0.0, 1.0]]),
                np.asarray([[1, 2, 3]], dtype=np.uint8),
                np.asarray([65_536], dtype=np.int64),
                rows,
                invalid,
            )

    def test_quaternion_and_extrinsics_are_proper_and_invertible(self) -> None:
        rotation, error = core.quaternion_wxyz_to_rotation((1.0, 0.0, 0.0, 0.0))
        self.assertEqual(error, 0.0)
        extrinsics = core.compose_camera_extrinsics(
            rotation, (1.0, 2.0, 3.0), "r-y_d+x_f+z"
        )
        forward = np.asarray(extrinsics["rotationE57FromCamera"])
        inverse = np.asarray(extrinsics["rotationCameraFromE57"])
        np.testing.assert_allclose(inverse @ forward, np.eye(3), atol=1e-14)
        camera_translation = np.asarray(extrinsics["translationCameraFromE57M"])
        np.testing.assert_allclose(inverse @ np.asarray([1.0, 2.0, 3.0]) + camera_translation, 0.0)
        with self.assertRaisesRegex(ValueError, "norm"):
            core.quaternion_wxyz_to_rotation((2.0, 0.0, 0.0, 0.0))

    def test_scoring_core_exposes_no_image2d_pose_parameter(self) -> None:
        self.assertNotIn("pose", core.solve_face.__annotations__)
        self.assertEqual(
            set(core.ScannerSample.__dataclass_fields__),
            {"points", "colors", "row_indices", "column_indices", "digest"},
        )


if __name__ == "__main__":
    unittest.main()
