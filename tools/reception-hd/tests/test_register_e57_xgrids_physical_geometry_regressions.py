from __future__ import annotations

import math
from pathlib import Path
import sys
import unittest

import numpy as np


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

import register_e57_xgrids_surfaces as surfaces  # noqa: E402


def config() -> surfaces.StructuralConfig:
    return surfaces.StructuralConfig(
        fit_points_per_class=500,
        continuous_refinement_max_evaluations=800,
    )


class PhysicalGeometryRegressionTests(unittest.TestCase):
    @staticmethod
    def _footprint(points_xy: np.ndarray) -> tuple[float, dict[str, object], np.ndarray]:
        cfg = config()
        return surfaces._robust_xy_footprint_area(
            points_xy,
            maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
            minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
            density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
            metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )

    def test_horizontal_physical_deduplication_is_far_origin_invariant(self) -> None:
        base_rows = np.asarray(
            [[0.0, 0.0, 0.0], [2.0e-5, 0.0, 0.0]], dtype=np.float64
        )
        shifts = (
            np.zeros(3, dtype=np.float64),
            np.asarray([1.0e6, -1.0e6, 1.0e6], dtype=np.float64),
        )

        for shift in shifts:
            with self.subTest(shift=shift.tolist()):
                physical, weights, evidence = surfaces._deduplicate_physical_points(
                    base_rows + shift,
                    np.ones(base_rows.shape[0], dtype=np.float64),
                    tolerance_m=1.0e-5,
                    comparison_epsilon_m=1.0e-9,
                    np=np,
                )
                self.assertEqual((2, 3), physical.shape)
                self.assertEqual((2,), weights.shape)
                self.assertEqual(2, evidence["physicalPointCount"])
                self.assertEqual(0, evidence["removedPointCount"])
                self.assertTrue(
                    evidence["distanceCandidateSearchUsesLocalizedCoordinates"]
                )
                coordinate_ulp_m = max(
                    math.ulp(float(value))
                    for value in (base_rows + shift).reshape(-1)
                )
                np.testing.assert_allclose(
                    physical - shift,
                    base_rows,
                    atol=coordinate_ulp_m,
                    rtol=0.0,
                )

    def test_257_row_bounded_components_use_distinct_geometry_not_raw_cap(self) -> None:
        cases = (
            (
                "exact repeats",
                np.zeros((257, 3), dtype=np.float64),
                np.zeros(3, dtype=np.float64),
            ),
            (
                "257 distinct positions in five micrometres",
                np.column_stack(
                    (
                        np.linspace(0.0, 5.0e-6, 257),
                        np.zeros(257, dtype=np.float64),
                        np.zeros(257, dtype=np.float64),
                    )
                ),
                np.asarray([2.5e-6, 0.0, 0.0], dtype=np.float64),
            ),
        )

        for label, rows, expected_anchor in cases:
            with self.subTest(case=label):
                physical, weights, evidence = surfaces._deduplicate_physical_points(
                    rows,
                    np.ones(rows.shape[0], dtype=np.float64),
                    tolerance_m=1.0e-5,
                    comparison_epsilon_m=1.0e-9,
                    np=np,
                )
                self.assertEqual((1, 3), physical.shape)
                self.assertEqual((1,), weights.shape)
                self.assertEqual(1, evidence["physicalPointCount"])
                self.assertEqual(0, evidence["ambiguousOrOversizedComponentsOmitted"])
                self.assertEqual(257, evidence["largestComponentRawPointCount"])
                np.testing.assert_allclose(
                    physical[0], expected_anchor, atol=1.0e-15, rtol=0.0
                )

    def test_257_row_transitive_chain_is_omitted_with_stable_empty_shapes(self) -> None:
        rows = np.column_stack(
            (
                np.linspace(0.0, 2.0e-5, 257),
                np.zeros(257, dtype=np.float64),
                np.zeros(257, dtype=np.float64),
            )
        )
        physical, weights, evidence = surfaces._deduplicate_physical_points(
            rows,
            np.ones(rows.shape[0], dtype=np.float64),
            tolerance_m=1.0e-5,
            comparison_epsilon_m=1.0e-9,
            np=np,
        )

        self.assertEqual((0, 3), physical.shape)
        self.assertEqual((0,), weights.shape)
        self.assertEqual(0, evidence["physicalPointCount"])
        self.assertEqual(1, evidence["ambiguousOrOversizedComponentsOmitted"])
        self.assertEqual(257, evidence["largestComponentRawPointCount"])

    def test_wall_transitive_chain_is_far_origin_invariant_fail_closed(self) -> None:
        base_rows = np.asarray(
            [[0.0, 0.0, 0.0], [8.0e-6, 0.0, 0.0], [1.6e-5, 0.0, 0.0]],
            dtype=np.float64,
        )
        normals = np.tile(
            np.asarray([1.0, 0.0], dtype=np.float64), (base_rows.shape[0], 1)
        )
        for shift in (
            np.zeros(3, dtype=np.float64),
            np.asarray([1.0e6, -1.0e6, 1.0e6], dtype=np.float64),
        ):
            with self.subTest(shift=shift.tolist()):
                indexes, working_points, working_normals, evidence = (
                    surfaces._physical_wall_representative_indexes(
                        base_rows + shift,
                        normals,
                        distance_tolerance_m=1.0e-5,
                        comparison_epsilon_m=1.0e-9,
                        minimum_normal_dot=0.94,
                        np=np,
                    )
                )
                self.assertEqual((0,), indexes.shape)
                self.assertEqual((0, 3), working_points.shape)
                self.assertEqual((0, 2), working_normals.shape)
                self.assertEqual(0, evidence["physicalWallSurfaceCount"])
                self.assertEqual(1, evidence["ambiguousSpatialComponentsOmitted"])
                self.assertEqual(1, evidence["ambiguousComponentsOmitted"])

    def test_wall_geometric_anchor_is_not_steered_by_exact_multiplicity(self) -> None:
        side_m = 8.0e-6
        base_rows = np.asarray(
            [
                [0.0, 0.0, 0.0],
                [side_m, 0.0, 0.0],
                [0.5 * side_m, 0.5 * math.sqrt(3.0) * side_m, 0.0],
            ],
            dtype=np.float64,
        )
        attacked_rows = np.vstack(
            (base_rows, np.repeat(base_rows[[0]], 200, axis=0))
        )
        observations: list[tuple[np.ndarray, np.ndarray]] = []

        for rows in (base_rows, attacked_rows):
            normals = np.tile(
                np.asarray([1.0, 0.0], dtype=np.float64), (rows.shape[0], 1)
            )
            _indexes, working_points, working_normals, evidence = (
                surfaces._physical_wall_representative_indexes(
                    rows,
                    normals,
                    distance_tolerance_m=1.0e-5,
                    comparison_epsilon_m=1.0e-9,
                    minimum_normal_dot=0.94,
                    np=np,
                )
            )
            self.assertEqual(1, evidence["physicalWallSurfaceCount"])
            self.assertEqual((1, 3), working_points.shape)
            self.assertEqual((1, 2), working_normals.shape)
            observations.append((working_points, working_normals))

        expected_anchor = np.asarray(
            [0.5 * side_m, math.sqrt(3.0) * side_m / 6.0, 0.0]
        )
        np.testing.assert_allclose(
            observations[0][0][0], expected_anchor, atol=1.0e-15, rtol=0.0
        )
        np.testing.assert_allclose(
            observations[1][0], observations[0][0], atol=1.0e-15, rtol=0.0
        )
        np.testing.assert_allclose(
            observations[1][1], observations[0][1], atol=1.0e-15, rtol=0.0
        )

    def test_wall_deduplication_rejects_zero_and_nonunit_normals(self) -> None:
        rows = np.asarray(
            [[0.0, 0.0, 0.0], [5.0e-6, 0.0, 0.0]], dtype=np.float64
        )
        invalid_normals = (
            np.zeros((2, 2), dtype=np.float64),
            np.tile(np.asarray([2.0, 0.0]), (2, 1)),
        )
        for normals in invalid_normals:
            with self.subTest(normals=normals.tolist()):
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces._physical_wall_representative_indexes(
                        rows,
                        normals,
                        distance_tolerance_m=1.0e-5,
                        comparison_epsilon_m=1.0e-9,
                        minimum_normal_dot=0.94,
                        np=np,
                    )
                self.assertEqual(
                    "INVALID_PHYSICAL_WALL_DEDUPLICATION", caught.exception.code
                )

    def test_wall_deduplication_rejects_pair_radius_overflow_cleanly(self) -> None:
        rows = np.asarray(
            [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]], dtype=np.float64
        )
        normals = np.tile(np.asarray([1.0, 0.0]), (2, 1))
        maximum_float = float.fromhex("0x1.fffffffffffffp+1023")

        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._physical_wall_representative_indexes(
                rows,
                normals,
                distance_tolerance_m=maximum_float,
                comparison_epsilon_m=maximum_float,
                minimum_normal_dot=0.94,
                np=np,
            )
        self.assertEqual(
            "INVALID_PHYSICAL_POINT_DEDUPLICATION", caught.exception.code
        )

    def test_boundary_only_ellipse_and_near_circle_are_rejected_fail_closed(self) -> None:
        angles = np.linspace(0.0, 2.0 * math.pi, 16, endpoint=False)
        cases = (
            ((0.30, 0.20), False),
            ((0.30, 0.294), True),
        )

        for (radius_x, radius_y), approximately_circular in cases:
            with self.subTest(
                radius_x=radius_x,
                radius_y=radius_y,
                approximately_circular=approximately_circular,
            ):
                points_xy = np.column_stack(
                    (radius_x * np.cos(angles), radius_y * np.sin(angles))
                )
                area, evidence, indexes = self._footprint(points_xy)
                self.assertEqual(0.0, area)
                self.assertEqual((0,), indexes.shape)
                self.assertTrue(
                    evidence[
                        "sampledOuterBoundaryInsufficientStrictInteriorSupportRejectedFailClosed"
                    ]
                )
                ambiguous = evidence["parallelSamplingSeamEvidence"][
                    "ambiguousComponents"
                ]
                self.assertTrue(ambiguous)
                boundary_evidence = ambiguous[0][
                    "circularBoundaryInteriorSupportEvidence"
                ]
                self.assertTrue(boundary_evidence["boundaryTraceScreenTriggered"])
                self.assertEqual(0, boundary_evidence["strictInteriorPointCount"])
                self.assertFalse(boundary_evidence["interiorSupportSufficient"])
                self.assertEqual(
                    0, boundary_evidence["interiorLocallyTwoDimensionalPointCount"]
                )
                self.assertFalse(
                    boundary_evidence[
                        "interiorLocalTwoDimensionalSupportSufficient"
                    ]
                )
                self.assertEqual(
                    approximately_circular,
                    boundary_evidence["approximatelyCircularBoundary"],
                )

    def test_filled_circular_surface_is_yaw_invariant_without_global_angle_bins(self) -> None:
        outer_angles = np.linspace(0.0, 2.0 * math.pi, 12, endpoint=False)
        boundary = np.column_stack(
            (0.30 * np.cos(outer_angles), 0.30 * np.sin(outer_angles))
        )
        interior = np.asarray(
            [[x, y] for x in (-0.12, 0.0, 0.12) for y in (-0.12, 0.0, 0.12)],
            dtype=np.float64,
        )
        base = np.vstack((boundary, interior))
        observed_areas: list[float] = []

        for yaw_degrees in (0.0, 1.0, 37.0):
            angle = math.radians(yaw_degrees)
            rotation = np.asarray(
                [
                    [math.cos(angle), -math.sin(angle)],
                    [math.sin(angle), math.cos(angle)],
                ]
            )
            points_xy = base @ rotation.T + np.asarray([0.25, -0.15])
            area, evidence, indexes = self._footprint(points_xy)
            observed_areas.append(area)
            self.assertEqual(base.shape[0], indexes.size)
            self.assertFalse(
                evidence[
                    "sampledOuterBoundaryInsufficientStrictInteriorSupportRejectedFailClosed"
                ]
            )
            boundary_evidence = (
                surfaces._circular_boundary_interior_support_evidence(
                    points_xy,
                    metric_boundary_epsilon_m=config().metric_boundary_comparison_epsilon_m,
                    np=np,
                )
            )
            self.assertTrue(boundary_evidence["boundaryTraceScreenTriggered"])
            self.assertEqual(9, boundary_evidence["strictInteriorPointCount"])
            self.assertTrue(boundary_evidence["interiorSupportSufficient"])
            self.assertEqual(
                9, boundary_evidence["interiorLocallyTwoDimensionalPointCount"]
            )
            self.assertEqual(
                1.0,
                boundary_evidence["interiorLocallyTwoDimensionalPointFraction"],
            )
            self.assertTrue(
                boundary_evidence["interiorLocalTwoDimensionalSupportSufficient"]
            )
            self.assertLessEqual(
                boundary_evidence["maximumInteriorAngularGapDegrees"],
                boundary_evidence["maximumAllowedInteriorAngularGapDegrees"]
                + 1.0e-12,
            )
            self.assertFalse(
                boundary_evidence["fixedGlobalPolarSectorBinsUsedForDecision"]
            )

        np.testing.assert_allclose(
            observed_areas, np.full(3, 0.27), atol=1.0e-12, rtol=0.0
        )

    def test_exact_dense_sparse_rectangle_transition_preserves_area_not_contact(self) -> None:
        y_values = np.asarray([0.0, 0.1, 0.2, 0.3])
        dense = np.asarray(
            [
                [float(x), float(y)]
                for x in np.arange(0.0, 0.500001, 0.1)
                for y in y_values
            ]
        )
        sparse = np.asarray(
            [
                [float(x), float(y)]
                for x in (0.5, 0.8, 1.0)
                for y in y_values
            ]
        )
        points_xy = np.unique(np.vstack((dense, sparse)), axis=0)
        self.assertEqual((32, 2), points_xy.shape)

        area, evidence, indexes = self._footprint(points_xy)

        self.assertAlmostEqual(0.30, area, places=12)
        self.assertEqual(1, evidence["acceptedTriangleConnectedComponentCount"])
        self.assertEqual(6, evidence["densityTransitionCertifiedTriangleCount"])
        self.assertEqual(1, evidence["densityTransitionCertifiedGroupCount"])
        self.assertEqual(4, evidence["broadSamplingBridgeContactExcludedVertexCount"])
        np.testing.assert_array_equal(
            indexes,
            np.concatenate(
                (
                    np.arange(0, 24, dtype=np.int64),
                    np.arange(28, 32, dtype=np.int64),
                )
            ),
        )
        np.testing.assert_array_equal(points_xy[24:28, 0], np.full(4, 0.8))
        np.testing.assert_array_equal(points_xy[28:32, 0], np.full(4, 1.0))


if __name__ == "__main__":
    unittest.main()
