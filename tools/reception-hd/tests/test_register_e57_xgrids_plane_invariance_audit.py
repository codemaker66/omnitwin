from __future__ import annotations

import math
from pathlib import Path
import sys
import unittest

import numpy as np


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

import register_e57_xgrids_surfaces as surfaces  # noqa: E402


def wall_plane(
    plane_id: int,
    angle_degrees: float,
    *,
    normal_as_list: bool = False,
) -> surfaces.WallPlanePatch:
    angle = math.radians(angle_degrees)
    normal = np.asarray([math.cos(angle), math.sin(angle)], dtype=np.float64)
    if normal[0] < -1e-12 or (abs(float(normal[0])) <= 1e-12 and normal[1] < 0.0):
        normal *= -1.0
    normal_value = normal.tolist() if normal_as_list else normal
    return surfaces.WallPlanePatch(
        plane_id=plane_id,
        normal_xy=normal_value,
        offset_m=0.0,
        point_indices=np.empty(0, dtype=np.int64),
        support_count=1,
        support_area_proxy_m2=1.0,
        tangent_range_m=(0.0, 1.0),
        tangent_segments=(),
        z_range_m=(0.0, 3.0),
        robust_z_range_m=(0.0, 3.0),
        occupied_cells=frozenset(),
        residual_median_m=0.0,
        residual_p95_m=0.0,
    )


def inventory(
    planes: list[surfaces.WallPlanePatch],
    *,
    angular_sort: bool = False,
) -> surfaces.StructuralInventory:
    if angular_sort:
        planes = sorted(
            planes,
            key=lambda plane: math.atan2(
                float(plane.normal_xy[1]), float(plane.normal_xy[0])
            ),
        )
    return surfaces.StructuralInventory(
        wall_planes=tuple(planes),
        floor_z_m=0.0,
        ceiling_z_m=3.0,
        floor_level_mad_m=0.0,
        ceiling_level_mad_m=0.0,
        ceiling_levels_m=(3.0,),
        ceiling_level_mads_m=(0.0,),
        unassigned_wall_fraction=0.0,
    )


def candidate_geometry(
    hypotheses: list[surfaces.PlaneHypothesis],
) -> tuple[tuple[float, tuple[float, float, float]], ...]:
    return tuple(
        (
            round(float(hypothesis.yaw_radians), 12),
            tuple(round(float(value), 12) for value in hypothesis.translation),
        )
        for hypothesis in hypotheses
    )


class PlaneHypothesisInvarianceAuditTests(unittest.TestCase):
    def generate(
        self,
        source: surfaces.StructuralInventory,
        target: surfaces.StructuralInventory,
    ) -> tuple[list[surfaces.PlaneHypothesis], dict[str, object]]:
        return surfaces.generate_plane_pair_hypotheses(
            source,
            target,
            mirrored=False,
            config=surfaces.StructuralConfig(),
            np=np,
        )

    def test_source_pair_candidate_geometry_is_inventory_order_invariant(self) -> None:
        source_planes = [wall_plane(1, 0.0), wall_plane(2, 50.0)]
        target_planes = [wall_plane(11, 0.0), wall_plane(12, 57.0)]
        reference, evidence = self.generate(
            inventory(source_planes), inventory(target_planes)
        )
        reference_geometry = candidate_geometry(reference)

        for source_rows, target_rows in (
            (list(reversed(source_planes)), target_planes),
            (source_planes, list(reversed(target_planes))),
            (list(reversed(source_planes)), list(reversed(target_planes))),
        ):
            with self.subTest(
                source_ids=[plane.plane_id for plane in source_rows],
                target_ids=[plane.plane_id for plane in target_rows],
            ):
                hypotheses, _other_evidence = self.generate(
                    inventory(source_rows), inventory(target_rows)
                )
                self.assertEqual(reference_geometry, candidate_geometry(hypotheses))

        self.assertEqual(1, evidence["sourceNonparallelPairCount"])
        self.assertEqual(2, evidence["sourceOrderedNonparallelPairCount"])
        self.assertTrue(
            evidence["bothSourcePairOrientationsEnumeratedForOrderInvariance"]
        )
        self.assertEqual(
            [-180.0, -173.0, 0.0, 7.0],
            [round(math.degrees(row.yaw_radians), 9) for row in reference],
        )

    def test_common_rotation_across_canonical_sort_boundary_preserves_candidates(self) -> None:
        signatures = []
        for common_rotation_degrees in (0.0, 60.0):
            source = inventory(
                [
                    wall_plane(1, common_rotation_degrees),
                    wall_plane(2, 50.0 + common_rotation_degrees),
                ],
                angular_sort=True,
            )
            target = inventory(
                [
                    wall_plane(11, common_rotation_degrees),
                    wall_plane(12, 57.0 + common_rotation_degrees),
                ],
                angular_sort=True,
            )
            hypotheses, _evidence = self.generate(source, target)
            signatures.append(candidate_geometry(hypotheses))
        self.assertEqual(signatures[0], signatures[1])

    def test_valid_list_normals_are_normalized_before_generation_math(self) -> None:
        array_hypotheses, _array_evidence = self.generate(
            inventory([wall_plane(1, 0.0), wall_plane(2, 50.0)]),
            inventory([wall_plane(11, 0.0), wall_plane(12, 57.0)]),
        )
        list_hypotheses, _list_evidence = self.generate(
            inventory(
                [
                    wall_plane(1, 0.0, normal_as_list=True),
                    wall_plane(2, 50.0, normal_as_list=True),
                ]
            ),
            inventory(
                [
                    wall_plane(11, 0.0, normal_as_list=True),
                    wall_plane(12, 57.0, normal_as_list=True),
                ]
            ),
        )
        self.assertEqual(
            candidate_geometry(array_hypotheses),
            candidate_geometry(list_hypotheses),
        )

    def test_default_metric_epsilon_grid_finds_every_accepted_neighbour(self) -> None:
        base_x = (0.0049999995, 0.0100000004, 0.0100000005)
        retained_local_x = []
        for target_frame_shift in (0.0, 1e-9):
            hypotheses = [
                surfaces.PlaneHypothesis(
                    yaw_radians=0.0,
                    translation=np.asarray(
                        [target_frame_shift + x_value, 0.0, 0.0]
                    ),
                    source_seed_plane_ids=(0, 1),
                    target_seed_plane_ids=(0, 1),
                    mirrored=False,
                )
                for x_value in base_x
            ]
            retained, evidence = surfaces._deduplicate_plane_hypotheses_invariantly(
                hypotheses,
                source_anchor_xy=np.zeros(2),
                config=surfaces.StructuralConfig(),
                np=np,
            )
            self.assertEqual(1, len(retained))
            retained_local_x.append(
                float(retained[0].translation[0]) - target_frame_shift
            )
            self.assertGreater(
                evidence["candidateSearchMetricCellWidthMeters"], 0.005
            )
            self.assertEqual(
                1, evidence["candidateSearchNeighbourRadiusCellsPerDimension"]
            )
            self.assertTrue(
                evidence[
                    "candidateSearchCellWidthsIncludeBoundaryComparisonEpsilon"
                ]
            )
        np.testing.assert_allclose(
            retained_local_x, [0.0100000004, 0.0100000004], atol=1e-15
        )

    def test_yaw_grid_finds_all_neighbours_admitted_by_angular_epsilon(self) -> None:
        config = surfaces.StructuralConfig(
            angular_boundary_comparison_epsilon=0.002
        )
        base_yaw = (0.0001, 0.0027, 0.00275)
        retained_local_yaw = []
        for common_yaw_shift in (0.0, 0.0006):
            hypotheses = [
                surfaces.PlaneHypothesis(
                    yaw_radians=common_yaw_shift + yaw,
                    translation=np.zeros(3),
                    source_seed_plane_ids=(0, 1),
                    target_seed_plane_ids=(0, 1),
                    mirrored=False,
                )
                for yaw in base_yaw
            ]
            retained, evidence = surfaces._deduplicate_plane_hypotheses_invariantly(
                hypotheses,
                source_anchor_xy=np.zeros(2),
                config=config,
                np=np,
            )
            self.assertEqual(1, len(retained))
            retained_local_yaw.append(
                float(retained[0].yaw_radians) - common_yaw_shift
            )
            self.assertGreaterEqual(
                math.radians(evidence["candidateSearchYawCellWidthDegrees"]),
                math.radians(0.05)
                + config.angular_boundary_comparison_epsilon,
            )
        np.testing.assert_allclose(retained_local_yaw, [0.0027, 0.0027], atol=1e-15)


if __name__ == "__main__":
    unittest.main()
