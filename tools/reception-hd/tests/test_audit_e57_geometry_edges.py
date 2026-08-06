from __future__ import annotations

import inspect
import math
import sys
import unittest
from pathlib import Path

import numpy as np


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

import audit_e57_geometry_edges as geometry  # noqa: E402
from audit_e57_geometry_edges import (  # noqa: E402
    FIXED_V2_MAPPING,
    compare_cube_candidates,
    cube_orientation_candidates,
    deterministic_decimate_grid,
    edge_alignment_metrics,
    empirical_cdf_rank_map,
    gaussian_sobel_photo_edges,
    geometry_signals,
    prepare_geometry_samples,
    project_geometry_signals_zbuffer,
    reconstruct_organized_xyz,
    strongest_geometry_edge_mask,
    strongest_photo_edge_mask,
)


class _AccessRecordingFields(dict[str, np.ndarray]):
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self.accessed: list[str] = []

    def __getitem__(self, key: str) -> np.ndarray:
        self.accessed.append(key)
        if key.lower().startswith("color"):
            raise AssertionError("geometry audit attempted to read point colour")
        return super().__getitem__(key)


class E57GeometryEdgeTests(unittest.TestCase):
    def test_reconstructs_sparse_organized_grid_and_validates_cells(self) -> None:
        fields = {
            "cartesianX": np.asarray([1.0, 3.0, 4.0]),
            "cartesianY": np.asarray([10.0, 30.0, 40.0]),
            "cartesianZ": np.asarray([100.0, 300.0, 400.0]),
            "rowIndex": np.asarray([0, 1, 1]),
            "columnIndex": np.asarray([0, 0, 2]),
        }

        grid = reconstruct_organized_xyz(fields, row_count=2, column_count=3)

        self.assertEqual(grid.shape, (2, 3, 3))
        np.testing.assert_array_equal(grid[0, 0], [1.0, 10.0, 100.0])
        np.testing.assert_array_equal(grid[1, 2], [4.0, 40.0, 400.0])
        self.assertTrue(np.all(np.isnan(grid[0, 1])))

        duplicate = dict(fields)
        duplicate["rowIndex"] = np.asarray([0, 0, 1])
        duplicate["columnIndex"] = np.asarray([0, 0, 2])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            reconstruct_organized_xyz(duplicate, row_count=2, column_count=3)

        fractional = dict(fields)
        fractional["rowIndex"] = np.asarray([0.0, 0.5, 1.0])
        with self.assertRaisesRegex(ValueError, "integer"):
            reconstruct_organized_xyz(fractional)

        with self.assertRaisesRegex(ValueError, "outside"):
            reconstruct_organized_xyz(fields, row_count=1, column_count=3)

        invalid = dict(fields)
        invalid["cartesianInvalidState"] = np.asarray([0, 1, 0])
        invalid_grid = reconstruct_organized_xyz(invalid, row_count=2, column_count=3)
        self.assertTrue(np.all(np.isnan(invalid_grid[1, 0])))

    def test_deterministic_decimation_is_stride_two_anchored_at_zero(self) -> None:
        grid = np.arange(5 * 7 * 3, dtype=np.float64).reshape(5, 7, 3)

        first = deterministic_decimate_grid(grid)
        second = deterministic_decimate_grid(grid)

        self.assertEqual(first.shape, (3, 4, 3))
        np.testing.assert_array_equal(first, grid[0:5:2, 0:7:2])
        np.testing.assert_array_equal(second, first)

        with self.assertRaisesRegex(ValueError, "non-empty"):
            deterministic_decimate_grid(np.empty((0, 7, 3)))

    def test_log_range_jump_keeps_large_depth_break(self) -> None:
        grid = np.asarray([[[0.0, 0.0, 1.0], [0.0, 0.0, 2.0], [0.0, 0.0, 2.0]]])

        signals = geometry_signals(grid)

        self.assertAlmostEqual(
            signals["absoluteLogRangeJump"][0, 0],
            math.log(2.0),
            places=12,
        )
        self.assertAlmostEqual(
            signals["absoluteLogRangeJump"][0, 1],
            math.log(2.0),
            places=12,
        )
        self.assertEqual(signals["normalNeighbourCount"][0, 0], 0)
        self.assertEqual(signals["normalNeighbourCount"][0, 1], 1)

        with self.assertRaisesRegex(ValueError, "non-empty"):
            geometry_signals(np.empty((0, 3, 3)))
        with self.assertRaisesRegex(ValueError, "non-negative"):
            geometry_signals(grid, relative_gate=float("nan"))

    def test_horizontal_neighbours_wrap_but_vertical_neighbours_do_not(self) -> None:
        seam_grid = np.zeros((3, 4, 3), dtype=np.float64)
        seam_grid[..., 2] = 1.0
        seam_grid[1, 3, 2] = 2.0

        seam_signals = geometry_signals(seam_grid)

        self.assertAlmostEqual(
            seam_signals["absoluteLogRangeJump"][1, 0],
            math.log(2.0),
        )

        vertical_grid = np.zeros((3, 4, 3), dtype=np.float64)
        vertical_grid[..., 2] = 1.0
        vertical_grid[2, :, 2] = 3.0
        vertical_signals = geometry_signals(vertical_grid)
        self.assertAlmostEqual(vertical_signals["absoluteLogRangeJump"][0, 1], 0.0)

    def test_surface_normal_discontinuity_detects_a_gated_fold(self) -> None:
        rows, columns = 7, 9
        y = np.linspace(-0.3, 0.3, rows)
        x = np.linspace(-0.4, 0.4, columns)
        grid = np.empty((rows, columns, 3), dtype=np.float64)
        for row, y_value in enumerate(y):
            for column, x_value in enumerate(x):
                z = 2.0 if x_value <= 0.0 else 2.0 + 1.0 * x_value
                grid[row, column] = [x_value, y_value, z]

        signals = geometry_signals(grid)

        flat_region = signals["surfaceNormalDiscontinuity"][3, 1]
        fold_region = np.max(signals["surfaceNormalDiscontinuity"][2:5, 3:7])
        self.assertLess(flat_region, 1.0e-6)
        self.assertGreater(fold_region, 0.10)
        self.assertTrue(np.all(signals["normalValidMask"][1:-1, 1:-1]))

    def test_nearest_depth_zbuffer_and_source_index_tie_break(self) -> None:
        points = np.asarray(
            [
                [0.0, 0.0, 2.0],
                [0.0, 0.0, 1.0],
                [0.0, 0.0, 1.0],
                [0.5, 0.0, 1.0],
                [0.0, 0.0, 0.05],
                [0.0, 0.0, 50.0],
            ]
        )
        jumps = np.asarray([0.2, 0.8, 0.9, 0.4, 1.0, 1.0])
        normals = np.asarray([0.1, 0.3, 0.7, 0.2, 1.0, 1.0])

        projected = project_geometry_signals_zbuffer(
            points,
            jumps,
            normals,
            forward=np.asarray([0.0, 0.0, 1.0]),
            right=np.asarray([1.0, 0.0, 0.0]),
            down=np.asarray([0.0, 1.0, 0.0]),
            fx=2.0,
            fy=2.0,
            cx=2.0,
            cy=2.0,
            width=5,
            height=5,
        )

        self.assertEqual(projected["visiblePixelCount"], 2)
        self.assertEqual(projected["projectedInputCount"], 4)
        self.assertEqual(projected["sourceIndexImage"][3, 2], 1)
        self.assertAlmostEqual(projected["depthImage"][3, 2], 1.0)
        self.assertAlmostEqual(projected["absoluteLogRangeJumpImage"][3, 2], 0.8)
        self.assertAlmostEqual(projected["surfaceNormalDiscontinuityImage"][3, 2], 0.3)
        self.assertTrue(projected["occupiedMask"][3, 2])

        with self.assertRaisesRegex(ValueError, "positive"):
            project_geometry_signals_zbuffer(
                points,
                jumps,
                normals,
                forward=np.asarray([0.0, 0.0, 1.0]),
                right=np.asarray([1.0, 0.0, 0.0]),
                down=np.asarray([0.0, 1.0, 0.0]),
                fx=2.0,
                fy=2.0,
                cx=2.0,
                cy=2.0,
                width=5.0,  # type: ignore[arg-type]
                height=5,
            )
        invalid_jumps = jumps.copy()
        invalid_jumps[0] = float("nan")
        with self.assertRaisesRegex(ValueError, "finite and non-negative"):
            project_geometry_signals_zbuffer(
                points,
                invalid_jumps,
                normals,
                forward=np.asarray([0.0, 0.0, 1.0]),
                right=np.asarray([1.0, 0.0, 0.0]),
                down=np.asarray([0.0, 1.0, 0.0]),
                fx=2.0,
                fy=2.0,
                cx=2.0,
                cy=2.0,
                width=5,
                height=5,
            )

    def test_edge_alignment_uses_fixed_euclidean_radius(self) -> None:
        geometry_mask = np.zeros((7, 7), dtype=bool)
        geometry_mask[1, 1] = True
        geometry_mask[3, 3] = True
        geometry_mask[6, 6] = True
        photo_mask = np.zeros_like(geometry_mask)
        photo_mask[1, 2] = True  # one pixel from the first geometry edge
        photo_mask[5, 3] = True  # two pixels from the second geometry edge

        metrics = edge_alignment_metrics(geometry_mask, photo_mask, radius=2)

        self.assertEqual(metrics["matchedGeometryEdgePixelCount"], 2)
        self.assertAlmostEqual(metrics["matchedFraction"], 2.0 / 3.0)

    def test_gaussian_sobel_photo_edges_find_a_step(self) -> None:
        photo = np.zeros((32, 32), dtype=np.uint8)
        photo[:, 16:] = 255

        magnitude = gaussian_sobel_photo_edges(photo)
        mask = strongest_photo_edge_mask(magnitude, fraction=0.05)

        self.assertEqual(magnitude.shape, photo.shape)
        strongest_column = int(np.unravel_index(np.argmax(magnitude), magnitude.shape)[1])
        self.assertIn(strongest_column, (15, 16))
        edge_columns = np.flatnonzero(np.any(mask, axis=0))
        self.assertTrue(np.all((edge_columns >= 13) & (edge_columns <= 18)))
        self.assertFalse(np.any(mask[:8]))
        self.assertFalse(np.any(mask[-8:]))

    def test_blank_and_sparse_photos_do_not_promote_zero_gradient_to_edges(self) -> None:
        blank = np.zeros((32, 32), dtype=np.float64)
        blank_mask = strongest_photo_edge_mask(blank)
        self.assertFalse(np.any(blank_mask))

        sparse = np.zeros((32, 32), dtype=np.float64)
        sparse[16, 16] = 1.0
        sparse_mask = strongest_photo_edge_mask(sparse)
        self.assertEqual(np.count_nonzero(sparse_mask), 1)
        self.assertTrue(sparse_mask[16, 16])

    def test_empty_photo_edge_mask_never_matches_geometry(self) -> None:
        geometry_mask = np.zeros((24, 24), dtype=bool)
        geometry_mask[0, 0] = True
        geometry_mask[12, 12] = True
        photo_mask = np.zeros_like(geometry_mask)

        metrics = edge_alignment_metrics(geometry_mask, photo_mask, radius=2)

        self.assertEqual(metrics["photoEdgePixelCount"], 0)
        self.assertEqual(metrics["matchedGeometryEdgePixelCount"], 0)
        self.assertEqual(metrics["matchedFraction"], 0.0)

    def test_geometry_pipeline_never_reads_point_colour(self) -> None:
        fields = _AccessRecordingFields(
            cartesianX=np.asarray([0.0, 0.1, 0.0, 0.1]),
            cartesianY=np.asarray([0.0, 0.0, 0.1, 0.1]),
            cartesianZ=np.asarray([1.0, 1.0, 1.0, 1.0]),
            rowIndex=np.asarray([0, 0, 1, 1]),
            columnIndex=np.asarray([0, 1, 0, 1]),
            colorRed=np.asarray([255, 255, 255, 255]),
            colorGreen=np.asarray([0, 0, 0, 0]),
            colorBlue=np.asarray([0, 0, 0, 0]),
        )

        prepared = prepare_geometry_samples(
            fields,
            row_count=2,
            column_count=2,
        )

        self.assertEqual(prepared["decimationStride"], 2)
        self.assertEqual(prepared["sampleCount"], 1)
        self.assertFalse(any(name.lower().startswith("color") for name in fields.accessed))
        self.assertNotIn("colour", inspect.signature(prepare_geometry_samples).parameters)
        self.assertNotIn("color", inspect.signature(prepare_geometry_samples).parameters)

    def test_rank_map_is_separate_right_sided_empirical_cdf(self) -> None:
        occupied = np.asarray([[True, True, True], [True, False, True]])
        signal = np.asarray([[0.0, 2.0, 2.0], [1.0, 99.0, 4.0]])

        ranked = empirical_cdf_rank_map(signal, occupied)

        # Positive occupied values sort to [1, 2, 2, 4].  Right-sided ranking
        # assigns both tied 2s the rank 3/4 and leaves zero/unoccupied at zero.
        np.testing.assert_allclose(
            ranked,
            [[0.0, 0.75, 0.75], [0.25, 0.0, 1.0]],
        )

    def test_geometry_mask_uses_96th_percentile_and_default_cross_dilation(self) -> None:
        occupied = np.zeros((32, 32), dtype=bool)
        jump = np.zeros((32, 32), dtype=np.float64)
        normal = np.zeros_like(jump)
        for column, value in zip((12, 14, 16, 18), (1.0, 2.0, 3.0, 4.0), strict=True):
            occupied[16, column] = True
            jump[16, column] = value

        mask, strength = strongest_geometry_edge_mask(jump, normal, occupied)

        self.assertAlmostEqual(strength[16, 18], 1.0)
        self.assertEqual(np.count_nonzero(mask), 5)
        self.assertTrue(mask[16, 18])
        self.assertTrue(mask[15, 18])
        self.assertTrue(mask[17, 18])
        self.assertTrue(mask[16, 17])
        self.assertTrue(mask[16, 19])
        self.assertFalse(mask[15, 17])  # no diagonal in SciPy's default cross

    def test_candidate_family_has_24_proper_and_24_mirrored_bases(self) -> None:
        candidates = cube_orientation_candidates()

        self.assertEqual(len(candidates), 48)
        proper = [row for row in candidates if not row["mirrored"]]
        mirrored = [row for row in candidates if row["mirrored"]]
        self.assertEqual(len(proper), 24)
        self.assertEqual(len(mirrored), 24)
        for row in proper:
            self.assertAlmostEqual(row["basisDeterminant"], 1.0, places=12)
        for row in mirrored:
            self.assertAlmostEqual(row["basisDeterminant"], -1.0, places=12)
        self.assertTrue(
            all(
                geometry.CANDIDATE_BY_ID[candidate_id]["basisDeterminant"] > 0.0
                for candidate_id in FIXED_V2_MAPPING.values()
            )
        )

    def test_fixed_v2_mapping_locks_forward_right_and_raw_down_axes(self) -> None:
        expected = {
            "Skybox 0": ([0.0, 0.0, 1.0], [0.0, -1.0, 0.0]),
            "Skybox 1": ([1.0, 0.0, 0.0], [0.0, -1.0, 0.0]),
            "Skybox 2": ([0.0, -1.0, 0.0], [-1.0, 0.0, 0.0]),
            "Skybox 3": ([-1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
            "Skybox 4": ([0.0, 1.0, 0.0], [1.0, 0.0, 0.0]),
            "Skybox 5": ([0.0, 0.0, -1.0], [0.0, -1.0, 0.0]),
        }
        for skybox_name, (forward, right) in expected.items():
            candidate = geometry.CANDIDATE_BY_ID[FIXED_V2_MAPPING[skybox_name]]
            np.testing.assert_array_equal(candidate["forward"], forward)
            np.testing.assert_array_equal(candidate["right"], right)
            np.testing.assert_array_equal(
                candidate["down"],
                np.cross(np.asarray(forward), np.asarray(right)),
            )

            # A point displaced along the candidate's right and raw-down axes
            # must move to larger image u and v respectively.
            point = (
                2.0 * candidate["forward"]
                + 0.5 * candidate["right"]
                + 0.25 * candidate["down"]
            )[None, :]
            projected = project_geometry_signals_zbuffer(
                point,
                np.asarray([1.0]),
                np.asarray([1.0]),
                forward=candidate["forward"],
                right=candidate["right"],
                down=candidate["down"],
                fx=8.0,
                fy=8.0,
                cx=16.0,
                cy=15.0,
                width=33,
                height=31,
            )
            self.assertEqual(projected["sourceIndexImage"][17, 18], 0)

    def test_candidate_comparison_keeps_fixed_v2_mapping_primary(self) -> None:
        points = np.asarray(
            [
                [-0.3, -0.3, 1.0],
                [0.3, -0.3, 1.0],
                [-0.3, 0.3, 1.0],
                [0.3, 0.3, 1.0],
            ]
        )
        jumps = np.asarray([0.0, 0.8, 0.2, 0.9])
        normals = np.asarray([0.0, 0.1, 0.7, 0.2])
        photo = np.zeros((32, 32), dtype=np.uint8)
        photo[:, 16:] = 255

        comparison = compare_cube_candidates(
            points,
            jumps,
            normals,
            photo,
            skybox_name="Skybox0",
            fx=16.0,
            fy=16.0,
            cx=16.0,
            cy=16.0,
        )

        self.assertEqual(comparison["primaryMappingVersion"], "fixed-v2")
        self.assertEqual(
            comparison["primaryCandidateId"],
            FIXED_V2_MAPPING["Skybox 0"],
        )
        self.assertEqual(len(comparison["candidateComparisons"]), 48)
        self.assertIn(
            comparison["diagnosticWinnerCandidateId"],
            {row["id"] for row in geometry.CANDIDATES},
        )


if __name__ == "__main__":
    unittest.main()
