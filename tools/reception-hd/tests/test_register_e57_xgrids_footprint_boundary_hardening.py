from __future__ import annotations

from dataclasses import replace
import math
from pathlib import Path
import sys
import unittest

import numpy as np


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

import register_e57_xgrids_surfaces as surfaces  # noqa: E402


def footprint(points_xy: np.ndarray):
    config = surfaces.StructuralConfig()
    return surfaces._robust_xy_footprint_area(
        points_xy,
        maximum_triangle_edge_m=(
            config.horizontal_level_footprint_max_triangle_edge_m
        ),
        minimum_triangle_quality=(
            config.horizontal_level_footprint_min_triangle_quality
        ),
        density_sliver_max_width_m=(
            config.horizontal_level_footprint_density_sliver_max_width_m
        ),
        metric_boundary_epsilon_m=(
            config.metric_boundary_comparison_epsilon_m
        ),
        np=np,
    )


def rigid_xy(points_xy: np.ndarray, yaw_degrees: float) -> np.ndarray:
    angle = math.radians(yaw_degrees)
    rotation = np.asarray(
        [
            [math.cos(angle), -math.sin(angle)],
            [math.sin(angle), math.cos(angle)],
        ],
        dtype=np.float64,
    )
    return points_xy @ rotation.T + np.asarray([999.0, -999.0])


class FootprintBoundaryHardeningTests(unittest.TestCase):
    def test_nonfinite_footprint_thresholds_are_rejected_before_geometry(self) -> None:
        points = np.asarray(
            [[0.0, 0.0], [0.1, 0.0], [0.1, 0.1], [0.0, 0.1]],
            dtype=np.float64,
        )
        defaults = {
            "maximum_triangle_edge_m": 0.8,
            "minimum_triangle_quality": 0.2,
            "density_sliver_max_width_m": 0.025,
            "metric_boundary_epsilon_m": 1e-9,
        }
        invalid_cases = (
            ("maximum_triangle_edge_m", float("nan")),
            ("maximum_triangle_edge_m", float("inf")),
            ("minimum_triangle_quality", float("nan")),
            ("minimum_triangle_quality", float("inf")),
            ("density_sliver_max_width_m", float("nan")),
            ("density_sliver_max_width_m", float("inf")),
            ("metric_boundary_epsilon_m", float("nan")),
            ("metric_boundary_epsilon_m", float("inf")),
        )
        for field, value in invalid_cases:
            with self.subTest(field=field, value=value):
                arguments = dict(defaults)
                arguments[field] = value
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces._robust_xy_footprint_area(
                        points, np=np, **arguments
                    )
                self.assertEqual(
                    "INVALID_HORIZONTAL_ENVELOPE_INPUT", caught.exception.code
                )

    def test_nonfinite_footprint_config_is_rejected_at_envelope_entry(self) -> None:
        points = np.column_stack(
            (
                np.linspace(0.0, 1.1, 12),
                np.zeros(12, dtype=np.float64),
                np.zeros(12, dtype=np.float64),
            )
        )
        invalid_cases = (
            {"horizontal_level_footprint_max_triangle_edge_m": float("inf")},
            {
                "horizontal_level_footprint_density_sliver_max_width_m": float(
                    "nan"
                )
            },
        )
        for replacement in invalid_cases:
            with self.subTest(replacement=replacement):
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces._select_room_envelope_level(
                        points,
                        np.ones(points.shape[0], dtype=np.float64),
                        (),
                        role="floor",
                        config=replace(surfaces.StructuralConfig(), **replacement),
                        np=np,
                    )
                self.assertEqual(
                    "INVALID_HORIZONTAL_ENVELOPE_INPUT", caught.exception.code
                )

    def test_nested_boundary_traces_do_not_fake_a_filled_disk(self) -> None:
        outer_angles = np.linspace(0.0, 2.0 * math.pi, 16, endpoint=False)
        inner_angles = (
            np.linspace(0.0, 2.0 * math.pi, 8, endpoint=False) + 0.03
        )
        base = np.vstack(
            (
                np.column_stack(
                    (0.30 * np.cos(outer_angles), 0.30 * np.sin(outer_angles))
                ),
                np.column_stack(
                    (0.12 * np.cos(inner_angles), 0.12 * np.sin(inner_angles))
                ),
            )
        )
        for yaw_degrees in (0.0, 37.0):
            with self.subTest(yaw_degrees=yaw_degrees):
                points = rigid_xy(base, yaw_degrees)[::-1]
                area, evidence, indexes = footprint(points)
                self.assertEqual(0.0, area)
                self.assertEqual(0, indexes.size)
                self.assertTrue(
                    evidence[
                        "sampledOuterBoundaryInsufficientStrictInteriorSupportRejectedFailClosed"
                    ]
                )
                component = evidence["parallelSamplingSeamEvidence"][
                    "ambiguousComponents"
                ][0]
                support = component[
                    "circularBoundaryInteriorSupportEvidence"
                ]
                self.assertEqual(8, support["strictInteriorPointCount"])
                self.assertEqual(
                    0, support["interiorLocallyTwoDimensionalPointCount"]
                )
                self.assertFalse(
                    support["interiorLocalTwoDimensionalSupportSufficient"]
                )
                self.assertFalse(support["interiorSupportSufficient"])

    def test_concave_outline_edges_do_not_count_as_interior_fill(self) -> None:
        corner = 0.20
        polygon = (
            (0.0, 0.0),
            (1.0, 0.0),
            (1.0, corner),
            (corner, corner),
            (corner, 1.0),
            (0.0, 1.0),
        )
        segments = []
        for first, second in zip(polygon, polygon[1:] + polygon[:1], strict=True):
            length = float(
                np.linalg.norm(np.asarray(second) - np.asarray(first))
            )
            segments.append(
                np.linspace(
                    first,
                    second,
                    max(1, int(round(length / 0.10))),
                    endpoint=False,
                )
            )
        base = np.unique(np.vstack(segments), axis=0)
        for yaw_degrees in (0.0, 37.0):
            with self.subTest(yaw_degrees=yaw_degrees):
                points = rigid_xy(base, yaw_degrees)[::-1]
                area, evidence, indexes = footprint(points)
                self.assertEqual(0.0, area)
                self.assertEqual(0, indexes.size)
                self.assertTrue(
                    evidence[
                        "sampledOuterBoundaryInsufficientStrictInteriorSupportRejectedFailClosed"
                    ]
                )
                component = evidence["parallelSamplingSeamEvidence"][
                    "ambiguousComponents"
                ][0]
                support = component[
                    "circularBoundaryInteriorSupportEvidence"
                ]
                self.assertFalse(support["approximatelyCircularBoundary"])
                self.assertEqual(15, support["strictInteriorPointCount"])
                self.assertEqual(
                    1, support["interiorLocallyTwoDimensionalPointCount"]
                )
                self.assertGreater(
                    support["interiorGeometricCoverageFraction"], 0.30
                )
                self.assertFalse(support["interiorSupportSufficient"])

    def test_filled_circle_remains_valid_under_rigid_motion(self) -> None:
        angles = np.linspace(0.0, 2.0 * math.pi, 12, endpoint=False)
        ring = np.column_stack((0.30 * np.cos(angles), 0.30 * np.sin(angles)))
        interior = np.asarray(
            [
                [float(x), float(y)]
                for x in np.arange(-0.20, 0.200001, 0.05)
                for y in np.arange(-0.20, 0.200001, 0.05)
                if x * x + y * y < 0.28**2
            ]
        )
        base = np.vstack((ring, interior))
        for yaw_degrees in (0.0, 37.0):
            with self.subTest(yaw_degrees=yaw_degrees):
                points = rigid_xy(base, yaw_degrees)
                area, evidence, indexes = footprint(points)
                self.assertAlmostEqual(0.27, area, places=10)
                self.assertEqual(points.shape[0], indexes.size)
                self.assertFalse(
                    evidence[
                        "sampledOuterBoundaryInsufficientStrictInteriorSupportRejectedFailClosed"
                    ]
                )
                support = surfaces._circular_boundary_interior_support_evidence(
                    points,
                    metric_boundary_epsilon_m=1e-9,
                    np=np,
                )
                self.assertEqual(
                    support["strictInteriorPointCount"],
                    support["interiorLocallyTwoDimensionalPointCount"],
                )
                self.assertTrue(support["interiorSupportSufficient"])

    def test_coarse_grid_and_density_transition_remain_valid(self) -> None:
        coarse_values = np.linspace(0.0, 0.40, 3)
        coarse = np.asarray(
            [[float(x), float(y)] for x in coarse_values for y in coarse_values]
        )
        coarse_area, coarse_evidence, coarse_indexes = footprint(coarse)
        self.assertAlmostEqual(0.16, coarse_area, places=12)
        self.assertEqual(9, coarse_indexes.size)
        self.assertFalse(
            coarse_evidence[
                "sampledOuterBoundaryInsufficientStrictInteriorSupportRejectedFailClosed"
            ]
        )

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
        transition = np.unique(np.vstack((dense, sparse)), axis=0)
        area, evidence, indexes = footprint(transition)
        self.assertAlmostEqual(0.30, area, places=12)
        self.assertEqual(28, indexes.size)
        self.assertEqual(6, evidence["densityTransitionCertifiedTriangleCount"])
        self.assertEqual(1, evidence["densityTransitionCertifiedGroupCount"])
        self.assertFalse(
            evidence[
                "sampledOuterBoundaryInsufficientStrictInteriorSupportRejectedFailClosed"
            ]
        )


if __name__ == "__main__":
    unittest.main()
