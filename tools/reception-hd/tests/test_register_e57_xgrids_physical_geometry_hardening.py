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


class PhysicalGeometryHardeningTests(unittest.TestCase):
    def test_diameter_tie_anchor_is_stable_at_a_far_coordinate_origin(self) -> None:
        point_count = 5
        radius_m = 8e-6
        angles = np.linspace(
            0.0, 2.0 * math.pi, point_count, endpoint=False
        )
        points = np.column_stack(
            (
                radius_m * np.cos(angles),
                radius_m * np.sin(angles),
                np.zeros(point_count, dtype=np.float64),
            )
        )
        yaw = math.radians(36.3)
        rotation = np.asarray(
            [
                [math.cos(yaw), -math.sin(yaw)],
                [math.sin(yaw), math.cos(yaw)],
            ],
            dtype=np.float64,
        )
        points[:, :2] = points[:, :2] @ rotation.T
        weights = np.ones(point_count, dtype=np.float64)
        shifts_and_epsilons = (
            (np.zeros(3, dtype=np.float64), 1e-9),
            (np.asarray([1e6, -1e6, 1e6]), 1e-9),
            (np.asarray([1e9, -1e9, 1e9]), 1e-6),
        )
        translated_back = []
        for shift, comparison_epsilon_m in shifts_and_epsilons:
            with self.subTest(shift=float(shift[0])):
                representatives, _weights, evidence = (
                    surfaces._deduplicate_physical_points(
                        (points + shift)[::-1],
                        weights,
                        tolerance_m=2e-5,
                        comparison_epsilon_m=comparison_epsilon_m,
                        np=np,
                    )
                )
                self.assertEqual((1, 3), representatives.shape)
                translated_back.append(representatives[0] - shift)
                self.assertGreaterEqual(
                    evidence["geometricAnchorTieEpsilonMeters"],
                    evidence[
                        "floatingPointDistanceComparisonEpsilonMeters"
                    ],
                )
                self.assertTrue(
                    evidence[
                        "geometricAnchorTieEpsilonDoesNotWidenPhysicalDiameterGate"
                    ]
                )
        for representative in translated_back:
            np.testing.assert_allclose(
                representative, np.zeros(3), atol=5e-10, rtol=0.0
            )

    def test_accepted_near_unit_wall_normals_are_normalized_before_dot(self) -> None:
        true_dot = 0.9400005
        angle = math.acos(true_dot)
        unit_normals = np.asarray(
            [[1.0, 0.0], [math.cos(angle), math.sin(angle)]],
            dtype=np.float64,
        )
        points = np.zeros((2, 3), dtype=np.float64)
        consensus_rows = []
        for scale in (1.0, 0.9999991):
            with self.subTest(scale=scale):
                indexes, working_points, working_normals, evidence = (
                    surfaces._physical_wall_representative_indexes(
                        points,
                        unit_normals * scale,
                        distance_tolerance_m=1e-5,
                        comparison_epsilon_m=1e-9,
                        minimum_normal_dot=0.94,
                        np=np,
                    )
                )
                self.assertEqual(1, indexes.size)
                self.assertEqual((1, 3), working_points.shape)
                self.assertEqual((1, 2), working_normals.shape)
                self.assertTrue(
                    evidence[
                        "acceptedNearUnitNormalsRenormalizedBeforeComparison"
                    ]
                )
                self.assertAlmostEqual(
                    1.0, float(np.linalg.norm(working_normals[0])), places=12
                )
                consensus_rows.append(working_normals[0])
        np.testing.assert_allclose(
            consensus_rows[0], consensus_rows[1], atol=1e-12, rtol=0.0
        )

    def test_structural_extraction_requires_real_integer_plane_limits(self) -> None:
        empty_surface_set = surfaces.SurfaceSet(
            np.empty((0, 3), dtype=np.float64),
            np.empty((0, 3), dtype=np.float64),
            np.empty(0, dtype=np.int8),
            np.empty(0, dtype=np.float64),
        )
        invalid_cases = (
            {"plane_min_support_count": float("nan")},
            {"plane_min_support_count": float("inf")},
            {"plane_min_support_count": 4.5},
            {"plane_min_support_count": True},
            {"plane_seed_limit": float("nan")},
            {"plane_seed_limit": float("inf")},
            {"plane_seed_limit": 4.5},
            {"plane_seed_limit": True},
            {"plane_max_count": float("nan")},
            {"plane_max_count": float("inf")},
            {"plane_max_count": 2.5},
            {"plane_max_count": True},
        )
        for replacement in invalid_cases:
            with self.subTest(replacement=replacement):
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces.extract_structural_inventory(
                        empty_surface_set,
                        config=replace(
                            surfaces.StructuralConfig(), **replacement
                        ),
                        np=np,
                    )
                self.assertEqual("INVALID_PLANE_CONFIG", caught.exception.code)


if __name__ == "__main__":
    unittest.main()
