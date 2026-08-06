from __future__ import annotations

from dataclasses import replace
from fractions import Fraction
import math
from pathlib import Path
import sys
import unittest
from unittest import mock

import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

import register_e57_xgrids_surfaces as surfaces  # noqa: E402


def config() -> surfaces.StructuralConfig:
    return surfaces.StructuralConfig(
        fit_points_per_class=500,
        continuous_refinement_max_evaluations=800,
    )


def normal(degrees: float) -> np.ndarray:
    angle = math.radians(degrees)
    return np.asarray([math.cos(angle), math.sin(angle)], dtype=np.float64)


def patch(
    plane_id: int,
    angle_degrees: float,
    offset_m: float,
    area_m2: float,
    *,
    point_indices: np.ndarray | None = None,
) -> surfaces.WallPlanePatch:
    indexes = (
        np.empty(0, dtype=np.int64)
        if point_indices is None
        else np.asarray(point_indices, dtype=np.int64)
    )
    return surfaces.WallPlanePatch(
        plane_id=plane_id,
        normal_xy=normal(angle_degrees),
        offset_m=float(offset_m),
        point_indices=indexes,
        support_count=max(int(indexes.size), 1),
        support_area_proxy_m2=float(area_m2),
        tangent_range_m=(-0.5, 0.5),
        tangent_segments=(),
        z_range_m=(0.0, 3.0),
        robust_z_range_m=(0.0, 3.0),
        occupied_cells=frozenset(),
        residual_median_m=0.0,
        residual_p95_m=0.0,
    )


def inventory(
    planes: tuple[surfaces.WallPlanePatch, ...],
) -> surfaces.StructuralInventory:
    return surfaces.StructuralInventory(
        wall_planes=planes,
        floor_z_m=0.0,
        ceiling_z_m=3.0,
        floor_level_mad_m=0.0,
        ceiling_level_mad_m=0.0,
        ceiling_levels_m=(3.0,),
        ceiling_level_mads_m=(0.0,),
        unassigned_wall_fraction=0.0,
    )


def surface(points: np.ndarray) -> surfaces.SurfaceSet:
    rows = np.asarray(points, dtype=np.float64)
    return surfaces.SurfaceSet(
        points=rows,
        normals=np.tile(np.asarray([0.0, 0.0, 1.0]), (rows.shape[0], 1)),
        labels=np.full(rows.shape[0], surfaces.LABEL_WALL, dtype=np.int8),
        weights=np.ones(rows.shape[0], dtype=np.float64),
    )


def score(
    source_surface: surfaces.SurfaceSet,
    target_surface: surfaces.SurfaceSet,
    source_inventory: surfaces.StructuralInventory,
    target_inventory: surfaces.StructuralInventory,
    hypothesis: surfaces.PlaneHypothesis,
    *,
    full_patch_score: bool = False,
    cfg: surfaces.StructuralConfig | None = None,
) -> tuple[float, dict[str, object]]:
    return surfaces._score_plane_hypothesis(
        source_surface,
        target_surface,
        source_inventory,
        target_inventory,
        hypothesis,
        full_patch_score=full_patch_score,
        config=config() if cfg is None else cfg,
        linear_sum_assignment=linear_sum_assignment,
        np=np,
        cKDTree=cKDTree,
    )


def indexed_fixture(
    specs: tuple[
        tuple[int, float, float, float, np.ndarray], ...
    ],
) -> tuple[surfaces.SurfaceSet, surfaces.StructuralInventory]:
    point_chunks: list[np.ndarray] = []
    planes: list[surfaces.WallPlanePatch] = []
    start = 0
    for plane_id, angle_degrees, offset_m, area_m2, raw_points in specs:
        points = np.asarray(raw_points, dtype=np.float64)
        indexes = np.arange(start, start + points.shape[0], dtype=np.int64)
        start += points.shape[0]
        point_chunks.append(points)
        planes.append(
            patch(
                plane_id,
                angle_degrees,
                offset_m,
                area_m2,
                point_indices=indexes,
            )
        )
    return surface(np.vstack(point_chunks)), inventory(tuple(planes))


class PlaneScorerHardeningTests(unittest.TestCase):
    def test_exact_score_tie_selects_same_physical_matching_after_role_swap(
        self,
    ) -> None:
        source_planes = tuple(
            patch(index, angle, 0.0, area)
            for index, (angle, area) in enumerate(
                ((0.0, 0.1), (90.0, 0.2), (0.0, 0.4), (45.0, 0.3))
            )
        )
        target_planes = tuple(
            patch(10 + index, angle, 0.0, area)
            for index, (angle, area) in enumerate(
                ((0.0, 0.4), (90.0, 0.3), (0.0, 0.1), (45.0, 0.2))
            )
        )
        patch_for_unit_linear = 6.333333333333333
        pair_rows: dict[tuple[int, int], dict[str, object]] = {}
        for edge in ((0, 0), (1, 1), (2, 2)):
            costly = edge != (1, 1)
            pair_rows[edge] = {
                "offsetResidualMeters": 0.0,
                "normalAngleRadians": 0.0,
                "patchBidirectionalRmseMeters": (
                    patch_for_unit_linear if costly else 0.0
                ),
                "occupancyAssessable": True,
                "occupancyF1": 0.0 if costly else 1.0,
                "exactLinearNumeratorMeters": 1.0 if costly else 0.0,
            }
        cfg = replace(config(), plane_occupancy_cell_m=0.05)

        base_matches, base_evidence = surfaces._exact_partial_plane_matching(
            pair_rows,
            source_planes,
            target_planes,
            (0.1, 0.2, 0.4, 0.3),
            (0.4, 0.3, 0.1, 0.2),
            source_total_area_m2=1.0,
            target_total_area_m2=1.0,
            config=cfg,
        )
        transposed_rows = {
            (target_index, source_index): row
            for (source_index, target_index), row in pair_rows.items()
        }
        swapped_matches, swapped_evidence = surfaces._exact_partial_plane_matching(
            transposed_rows,
            target_planes,
            source_planes,
            (0.4, 0.3, 0.1, 0.2),
            (0.1, 0.2, 0.4, 0.3),
            source_total_area_m2=1.0,
            target_total_area_m2=1.0,
            config=cfg,
        )
        swapped_mapped_back = {
            (source_index, target_index)
            for target_index, source_index in swapped_matches or []
        }

        self.assertEqual({(1, 1), (2, 2)}, set(base_matches or []))
        self.assertEqual(set(base_matches or []), swapped_mapped_back)
        np.testing.assert_allclose(
            base_evidence["selectedRoleSymmetricCoveragePair"], (0.4, 0.6)
        )
        np.testing.assert_allclose(
            base_evidence["selectedRoleSymmetricCoveragePair"],
            swapped_evidence["selectedRoleSymmetricCoveragePair"],
        )

    def test_equal_cardinality_search_retries_transposed_orientation_on_cap(
        self,
    ) -> None:
        candidate_planes = (
            patch(0, 0.0, 0.0, 1.0),
            patch(1, 90.0, 0.0, 1.0),
        )
        first_failure = surfaces.SurfaceAlignmentError(
            "PLANE_ASSIGNMENT_SEARCH_LIMIT", "first orientation capped"
        )
        successful = (
            [(0, 0), (1, 1)],
            {"jointlyNonparallelWitnessPairCount": 1},
        )
        with mock.patch.object(
            surfaces,
            "_exact_partial_plane_matching_one_orientation",
            side_effect=(first_failure, successful),
        ) as exact_orientation:
            matches, evidence = surfaces._exact_partial_plane_matching(
                {},
                candidate_planes,
                candidate_planes,
                (1.0, 1.0),
                (1.0, 1.0),
                source_total_area_m2=2.0,
                target_total_area_m2=2.0,
                config=config(),
            )
        self.assertEqual([(0, 0), (1, 1)], matches)
        self.assertTrue(evidence["internalBitMaskUsesSourceInventory"])
        self.assertTrue(
            evidence["equalCardinalityOppositeOrientationRetryUsed"]
        )
        self.assertEqual(2, exact_orientation.call_count)
        self.assertFalse(exact_orientation.call_args_list[0].kwargs["transpose"])
        self.assertTrue(exact_orientation.call_args_list[1].kwargs["transpose"])

    def test_exact_assignment_search_limit_fails_closed_without_an_incumbent(
        self,
    ) -> None:
        candidate_planes = (
            patch(0, 0.0, 0.0, 1.0),
            patch(1, 90.0, 0.0, 1.0),
            patch(2, 45.0, 0.1, 1.0),
        )
        origin_surface = surface(np.asarray([[0.0, 0.0, 0.0]]))
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (0, 1), False
        )
        with mock.patch.object(
            surfaces, "PLANE_ASSIGNMENT_MAX_TRANSITIONS", 1
        ), self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            score(
                origin_surface,
                origin_surface,
                inventory(candidate_planes),
                inventory(candidate_planes),
                hypothesis,
            )
        self.assertEqual("PLANE_ASSIGNMENT_SEARCH_LIMIT", caught.exception.code)

    def test_constrained_recovery_is_invariant_to_quarter_turns_and_tuple_reversal(
        self,
    ) -> None:
        source_planes = (
            patch(0, 40.0, 0.20, 1.0),
            patch(1, 20.0, 0.30, 2.0),
            patch(2, 10.0, 0.00, 4.0),
        )
        target_planes = (
            patch(10, 20.0, 0.00, 0.5),
            patch(11, 40.0, 0.10, 0.5),
            patch(12, 30.0, 0.20, 1.0),
            patch(13, 30.0, 0.25, 0.5),
        )
        origin_surface = surface(np.asarray([[0.0, 0.0, 0.0]]))
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 2), (10, 13), False
        )

        quarter_turn = np.asarray([[0.0, -1.0], [1.0, 0.0]])

        def rotated_plane(
            plane: surfaces.WallPlanePatch, turns: int
        ) -> surfaces.WallPlanePatch:
            rotation = np.linalg.matrix_power(quarter_turn, turns)
            canonical_normal, canonical_offset = surfaces._canonical_xy_plane(
                rotation @ plane.normal_xy, plane.offset_m, np=np
            )
            return replace(
                plane,
                normal_xy=canonical_normal,
                offset_m=canonical_offset,
            )

        canonical_source = tuple(
            rotated_plane(plane, 0) for plane in source_planes
        )
        canonical_target = tuple(
            rotated_plane(plane, 0) for plane in target_planes
        )
        baseline_score, baseline_evidence = score(
            origin_surface,
            origin_surface,
            inventory(canonical_source),
            inventory(canonical_target),
            hypothesis,
        )
        self.assertTrue(baseline_evidence["assessable"])
        self.assertTrue(
            baseline_evidence["constrainedIndependentWallAssignmentRecoveryUsed"]
        )

        for turns in range(4):
            rotated_source = tuple(
                rotated_plane(plane, turns) for plane in source_planes
            )
            rotated_target = tuple(
                rotated_plane(plane, turns) for plane in target_planes
            )
            for reverse_source in (False, True):
                for reverse_target in (False, True):
                    with self.subTest(
                        quarter_turns=turns,
                        reverse_source=reverse_source,
                        reverse_target=reverse_target,
                    ):
                        candidate_source = (
                            tuple(reversed(rotated_source))
                            if reverse_source
                            else rotated_source
                        )
                        candidate_target = (
                            tuple(reversed(rotated_target))
                            if reverse_target
                            else rotated_target
                        )
                        candidate_score, candidate_evidence = score(
                            origin_surface,
                            origin_surface,
                            inventory(candidate_source),
                            inventory(candidate_target),
                            hypothesis,
                        )
                        self.assertTrue(candidate_evidence["assessable"])
                        self.assertTrue(
                            candidate_evidence[
                                "constrainedIndependentWallAssignmentRecoveryUsed"
                            ]
                        )
                        self.assertAlmostEqual(
                            baseline_score, candidate_score, places=12
                        )
                        self.assertAlmostEqual(
                            baseline_evidence["planeOffsetRmseMeters"],
                            candidate_evidence["planeOffsetRmseMeters"],
                            places=12,
                        )
                        self.assertAlmostEqual(
                            baseline_evidence["matchedSourceAreaFraction"],
                            candidate_evidence["matchedSourceAreaFraction"],
                            places=12,
                        )
                        self.assertAlmostEqual(
                            baseline_evidence["matchedTargetAreaFraction"],
                            candidate_evidence["matchedTargetAreaFraction"],
                            places=12,
                        )

    def test_target_plane_id_relabeling_cannot_change_score_or_offset_rmse(self) -> None:
        source_planes = tuple(
            patch(plane_id, angle, offset, 1.0)
            for plane_id, (angle, offset) in enumerate(
                ((30.0, 0.30), (20.0, 0.10), (10.0, 0.20))
            )
        )
        target_planes = tuple(
            patch(plane_id, angle, offset, 1.0)
            for plane_id, (angle, offset) in zip(
                (10, 11, 12, 13),
                ((40.0, 0.15), (20.0, 0.25), (20.0, 0.30), (10.0, 0.35)),
                strict=True,
            )
        )
        relabeled_target_planes = tuple(
            replace(plane, plane_id=replacement_id)
            for plane, replacement_id in zip(
                target_planes, (13, 12, 11, 10), strict=True
            )
        )
        origin_surface = surface(np.asarray([[0.0, 0.0, 0.0]]))
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 2), (10, 13), False
        )

        original_score, original_evidence = score(
            origin_surface,
            origin_surface,
            inventory(source_planes),
            inventory(target_planes),
            hypothesis,
        )
        relabeled_score, relabeled_evidence = score(
            origin_surface,
            origin_surface,
            inventory(source_planes),
            inventory(relabeled_target_planes),
            hypothesis,
        )

        self.assertTrue(original_evidence["assessable"])
        self.assertTrue(relabeled_evidence["assessable"])
        self.assertAlmostEqual(original_score, relabeled_score, places=12)
        self.assertAlmostEqual(
            original_evidence["planeOffsetRmseMeters"],
            relabeled_evidence["planeOffsetRmseMeters"],
            places=12,
        )

    def test_more_than_configured_maximum_inventory_planes_are_rejected_cleanly(
        self,
    ) -> None:
        planes = tuple(
            patch(
                plane_id,
                float((plane_id % 16) * 5),
                float(plane_id + 1),
                1.0,
            )
            for plane_id in range(17)
        )
        candidate_inventory = inventory(planes)
        origin_surface = surface(np.asarray([[0.0, 0.0, 0.0]]))
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 4), (0, 4), False
        )

        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            score(
                origin_surface,
                origin_surface,
                candidate_inventory,
                candidate_inventory,
                hypothesis,
            )
        self.assertEqual("INVALID_PLANE_SCORE_INPUT", caught.exception.code)

    def test_list_valued_surface_points_work_or_fail_with_domain_error(self) -> None:
        planes = (
            patch(0, 0.0, 0.0, 1.0, point_indices=np.asarray([0])),
            patch(1, 90.0, 0.0, 1.0, point_indices=np.asarray([1])),
        )
        candidate_inventory = inventory(planes)
        points = [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]
        list_surface = surfaces.SurfaceSet(
            points=points,
            normals=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            labels=[surfaces.LABEL_WALL, surfaces.LABEL_WALL],
            weights=[1.0, 1.0],
        )
        array_surface = surface(np.asarray(points, dtype=np.float64))
        list_hypothesis = surfaces.PlaneHypothesis(
            0.0, [0.0, 0.0, 0.0], (0, 1), (0, 1), False
        )
        baseline_score, baseline_evidence = score(
            array_surface,
            array_surface,
            candidate_inventory,
            candidate_inventory,
            list_hypothesis,
        )

        try:
            candidate_score, candidate_evidence = score(
                list_surface,
                list_surface,
                candidate_inventory,
                candidate_inventory,
                list_hypothesis,
            )
        except surfaces.SurfaceAlignmentError as error:
            self.assertEqual("INVALID_PLANE_SCORE_INPUT", error.code)
        except Exception as error:  # pragma: no cover - this is the regression
            self.fail(
                "list-valued SurfaceSet.points leaked a raw "
                f"{type(error).__name__}: {error}"
            )
        else:
            self.assertEqual(
                bool(baseline_evidence["assessable"]),
                bool(candidate_evidence["assessable"]),
            )
            self.assertAlmostEqual(baseline_score, candidate_score, places=12)

    def test_exact_offset_gate_at_far_origin_is_invariant_or_fails_for_precision(
        self,
    ) -> None:
        def fixture(
            qx: float, qy: float
        ) -> tuple[
            surfaces.SurfaceSet,
            surfaces.StructuralInventory,
            surfaces.StructuralInventory,
            surfaces.PlaneHypothesis,
        ]:
            source_inventory = inventory(
                (
                    patch(0, 0.0, qx, 1.0),
                    patch(1, 90.0, qy, 1.0),
                )
            )
            target_inventory = inventory(
                (
                    patch(10, 0.0, qx + 0.35, 1.0),
                    patch(11, 90.0, qy + 0.35, 1.0),
                )
            )
            anchor_surface = surface(np.asarray([[qx, qy, 0.0]]))
            hypothesis = surfaces.PlaneHypothesis(
                0.0, np.zeros(3), (0, 1), (10, 11), False
            )
            return anchor_surface, source_inventory, target_inventory, hypothesis

        near_surface, near_source, near_target, near_hypothesis = fixture(0.0, 0.0)
        near_score, near_evidence = score(
            near_surface,
            near_surface,
            near_source,
            near_target,
            near_hypothesis,
        )
        self.assertTrue(near_evidence["assessable"])
        self.assertAlmostEqual(0.35, near_score, places=12)
        self.assertAlmostEqual(
            0.35, near_evidence["planeOffsetRmseMeters"], places=12
        )

        far_surface, far_source, far_target, far_hypothesis = fixture(1.0e9, -1.0e9)
        try:
            far_score, far_evidence = score(
                far_surface,
                far_surface,
                far_source,
                far_target,
                far_hypothesis,
            )
        except surfaces.SurfaceAlignmentError as error:
            self.assertIn(
                error.code,
                {
                    "INSUFFICIENT_PLANE_COMPARISON_PRECISION",
                    "INVALID_PLANE_SCORE_INPUT",
                },
            )
            self.assertIn("precision", str(error).lower())
        else:
            self.assertTrue(far_evidence["assessable"])
            self.assertTrue(math.isfinite(far_score))
            self.assertAlmostEqual(near_score, far_score, places=9)
            self.assertAlmostEqual(
                near_evidence["planeOffsetRmseMeters"],
                far_evidence["planeOffsetRmseMeters"],
                places=9,
            )

    def test_approximate_duplicate_plane_validation_is_translation_invariant(
        self,
    ) -> None:
        cfg = replace(
            config(),
            angular_boundary_comparison_epsilon=1.0e-4,
            metric_boundary_comparison_epsilon_m=1.0e-4,
        )
        origin_planes = (
            patch(0, 0.0, 0.0, 1.0),
            patch(1, 0.005, 0.0, 1.0),
            patch(2, 90.0, 2.0, 1.0),
        )
        translation_xy = np.asarray([0.0, 10.0])
        translated_planes = tuple(
            replace(
                plane,
                offset_m=float(
                    plane.offset_m + plane.normal_xy @ translation_xy
                ),
            )
            for plane in origin_planes
        )

        def validation_outcome(
            candidate_inventory: surfaces.StructuralInventory,
        ) -> tuple[str, ...]:
            try:
                surfaces._validate_plane_matching_inventory(
                    candidate_inventory,
                    "source",
                    config=cfg,
                    error_code="INVALID_PLANE_SCORE_INPUT",
                    np=np,
                )
            except surfaces.SurfaceAlignmentError as error:
                return "rejected", error.code
            return ("accepted",)

        origin_outcome = validation_outcome(inventory(origin_planes))
        translated_outcome = validation_outcome(inventory(translated_planes))
        self.assertEqual(origin_outcome, translated_outcome)

    def test_full_score_rejects_patch_indexes_far_from_declared_planes(self) -> None:
        yz_values = np.asarray(
            [
                [-0.3, 0.0],
                [-0.3, 0.3],
                [0.0, 0.0],
                [0.0, 0.3],
                [0.3, 0.0],
                [0.3, 0.3],
            ]
        )
        source_x_patch = np.column_stack(
            (np.full(6, 100.0), yz_values[:, 0], yz_values[:, 1])
        )
        target_x_patch = np.column_stack(
            (np.zeros(6), yz_values[:, 0], yz_values[:, 1])
        )
        source_y_patch = np.column_stack(
            (yz_values[:, 0], np.full(6, 100.0), yz_values[:, 1])
        )
        target_y_patch = np.column_stack(
            (yz_values[:, 0], np.zeros(6), yz_values[:, 1])
        )
        source_surface = surface(np.vstack((source_x_patch, source_y_patch)))
        target_surface = surface(np.vstack((target_x_patch, target_y_patch)))
        source_inventory = inventory(
            (
                patch(0, 0.0, 0.0, 1.0, point_indices=np.arange(0, 6)),
                patch(1, 90.0, 0.0, 1.0, point_indices=np.arange(6, 12)),
            )
        )
        target_inventory = inventory(
            (
                patch(10, 0.0, 0.0, 1.0, point_indices=np.arange(0, 6)),
                patch(11, 90.0, 0.0, 1.0, point_indices=np.arange(6, 12)),
            )
        )
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (10, 11), False
        )

        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            score(
                source_surface,
                target_surface,
                source_inventory,
                target_inventory,
                hypothesis,
                full_patch_score=True,
                cfg=replace(config(), plane_min_occupied_cells=1),
            )
        self.assertEqual("INVALID_PLANE_SCORE_INPUT", caught.exception.code)

    def test_assignment_minimizes_the_actual_reported_score(self) -> None:
        source_planes = (
            patch(0, 30.0, 0.20, 2.0),
            patch(1, 10.0, 0.05, 0.5),
            patch(2, 0.0, 0.20, 0.5),
        )
        target_planes = (
            patch(10, 0.0, 0.00, 0.5),
            patch(11, 10.0, 0.05, 4.0),
            patch(12, 50.0, 0.25, 2.0),
            patch(13, 20.0, 0.25, 4.0),
        )
        origin_surface = surface(np.asarray([[0.0, 0.0, 0.0]]))
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 2), (10, 12), False
        )
        actual_score, evidence = score(
            origin_surface,
            origin_surface,
            inventory(source_planes),
            inventory(target_planes),
            hypothesis,
        )

        feasible_offset_residuals = np.asarray([0.05, 0.05, 0.15])
        expected_offset_rmse = float(
            np.sqrt(np.mean(feasible_offset_residuals**2))
        )
        expected_target_coverage = 8.5 / 10.5
        expected_score = (
            expected_offset_rmse
            + 0.05 * math.radians(10.0)
            + 0.25 * (1.0 - expected_target_coverage)
        )

        self.assertTrue(evidence["assessable"])
        self.assertAlmostEqual(expected_score, actual_score, places=12)
        self.assertAlmostEqual(
            expected_offset_rmse,
            evidence["planeOffsetRmseMeters"],
            places=12,
        )
        self.assertAlmostEqual(
            expected_target_coverage,
            evidence["matchedTargetAreaFraction"],
            places=12,
        )

    def test_assignment_can_leave_a_compatible_low_value_plane_unmatched(self) -> None:
        source_planes = (
            patch(0, 0.0, 0.0, 10.0),
            patch(1, 90.0, 0.0, 10.0),
            patch(2, 0.0, 1.0, 0.001),
        )
        target_planes = (
            patch(10, 0.0, 0.0, 10.0),
            patch(11, 90.0, 0.0, 10.0),
            patch(12, 0.0, 1.35, 0.001),
        )
        origin_surface = surface(np.asarray([[0.0, 0.0, 0.0]]))
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (10, 11), False
        )
        actual_score, evidence = score(
            origin_surface,
            origin_surface,
            inventory(source_planes),
            inventory(target_planes),
            hypothesis,
        )

        expected_matched_fraction = 20.0 / 20.001
        expected_score = 0.25 * (
            (1.0 - expected_matched_fraction)
            + (1.0 - expected_matched_fraction)
        )
        self.assertTrue(evidence["assessable"])
        self.assertEqual(2, evidence["oneToOneMatchedPlaneCount"])
        self.assertAlmostEqual(expected_score, actual_score, places=12)
        self.assertAlmostEqual(
            expected_matched_fraction,
            evidence["matchedSourceAreaFraction"],
            places=12,
        )
        self.assertAlmostEqual(
            expected_matched_fraction,
            evidence["matchedTargetAreaFraction"],
            places=12,
        )

    def test_source_target_role_swap_preserves_the_symmetric_score(self) -> None:
        source_planes = tuple(
            patch(plane_id, angle, offset, area)
            for plane_id, (angle, offset, area) in enumerate(
                (
                    (20.0, 0.0, 0.5),
                    (10.0, -0.1, 1.0),
                    (60.0, 0.0, 1.0),
                    (90.0, -0.1, 1.0),
                )
            )
        )
        target_planes = tuple(
            patch(plane_id, angle, offset, area)
            for plane_id, (angle, offset, area) in zip(
                (10, 11, 12, 13),
                (
                    (20.0, 0.2, 1.0),
                    (60.0, 0.1, 1.0),
                    (20.0, 0.0, 2.0),
                    (40.0, -0.2, 1.0),
                ),
                strict=True,
            )
        )
        origin_surface = surface(np.asarray([[0.0, 0.0, 0.0]]))
        source_inventory = inventory(source_planes)
        target_inventory = inventory(target_planes)
        forward_hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 2), (10, 11), False
        )
        reverse_hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (10, 11), (0, 2), False
        )

        forward_score, forward_evidence = score(
            origin_surface,
            origin_surface,
            source_inventory,
            target_inventory,
            forward_hypothesis,
        )
        reverse_score, reverse_evidence = score(
            origin_surface,
            origin_surface,
            target_inventory,
            source_inventory,
            reverse_hypothesis,
        )

        self.assertTrue(forward_evidence["assessable"])
        self.assertTrue(reverse_evidence["assessable"])
        self.assertAlmostEqual(forward_score, reverse_score, places=12)
        self.assertAlmostEqual(
            forward_evidence["planeOffsetRmseMeters"],
            reverse_evidence["planeOffsetRmseMeters"],
            places=12,
        )
        self.assertAlmostEqual(
            forward_evidence["matchedSourceAreaFraction"],
            reverse_evidence["matchedTargetAreaFraction"],
            places=12,
        )
        self.assertAlmostEqual(
            forward_evidence["matchedTargetAreaFraction"],
            reverse_evidence["matchedSourceAreaFraction"],
            places=12,
        )
        self.assertAlmostEqual(
            forward_evidence["meanNormalAngleDegrees"],
            reverse_evidence["meanNormalAngleDegrees"],
            places=12,
        )

    def test_huge_fraction_config_and_inventory_scalars_fail_cleanly(self) -> None:
        huge = Fraction(10**10_000, 1)
        planes = (
            patch(0, 0.0, 0.0, 1.0),
            patch(1, 90.0, 0.0, 1.0),
        )
        candidate_inventory = inventory(planes)
        origin_surface = surface(np.asarray([[0.0, 0.0, 0.0]]))
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (0, 1), False
        )

        for field in ("plane_match_max_offset_m", "maximum_abs_coordinate_m"):
            with self.subTest(kind="config", field=field):
                malformed_config = replace(config(), **{field: huge})
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    score(
                        origin_surface,
                        origin_surface,
                        candidate_inventory,
                        candidate_inventory,
                        hypothesis,
                        cfg=malformed_config,
                    )
                self.assertEqual("INVALID_PLANE_CONFIG", caught.exception.code)

        for field in ("floor_z_m", "unassigned_wall_fraction"):
            with self.subTest(kind="inventory", field=field):
                malformed_inventory = replace(
                    candidate_inventory, **{field: huge}
                )
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    score(
                        origin_surface,
                        origin_surface,
                        malformed_inventory,
                        candidate_inventory,
                        hypothesis,
                    )
                self.assertEqual(
                    "INVALID_PLANE_SCORE_INPUT", caught.exception.code
                )

    def test_huge_unreduced_yaw_fails_cleanly(self) -> None:
        planes = (
            patch(0, 0.0, 0.0, 1.0),
            patch(1, 90.0, 0.0, 1.0),
        )
        candidate_inventory = inventory(planes)
        origin_surface = surface(np.asarray([[0.0, 0.0, 0.0]]))

        for yaw_radians in (math.tau * 1.0e12, math.tau * 1.0e16):
            with self.subTest(yaw_radians=yaw_radians):
                hypothesis = surfaces.PlaneHypothesis(
                    yaw_radians,
                    np.zeros(3),
                    (0, 1),
                    (0, 1),
                    False,
                )
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    score(
                        origin_surface,
                        origin_surface,
                        candidate_inventory,
                        candidate_inventory,
                        hypothesis,
                    )
                self.assertEqual(
                    "INVALID_PLANE_SCORE_INPUT", caught.exception.code
                )

    def test_full_patch_score_mode_must_be_an_exact_python_bool(self) -> None:
        planes = (
            patch(0, 0.0, 0.0, 1.0),
            patch(1, 90.0, 0.0, 1.0),
        )
        candidate_inventory = inventory(planes)
        origin_surface = surface(np.asarray([[0.0, 0.0, 0.0]]))
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (0, 1), False
        )

        for invalid_mode in (None, 0, 1, "False", np.bool_(True)):
            with self.subTest(mode=repr(invalid_mode)):
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    score(
                        origin_surface,
                        origin_surface,
                        candidate_inventory,
                        candidate_inventory,
                        hypothesis,
                        full_patch_score=invalid_mode,  # type: ignore[arg-type]
                    )
                self.assertEqual(
                    "INVALID_PLANE_SCORE_INPUT", caught.exception.code
                )

    def test_forged_support_area_metadata_cannot_steer_full_score(self) -> None:
        tangent = np.asarray([-0.45, -0.15, 0.15])
        heights = np.asarray([0.0, 0.30])
        x_zero = np.asarray(
            [[0.0, u, z] for u in tangent for z in heights], dtype=np.float64
        )
        y_zero = np.asarray(
            [[u + 0.8, 0.0, z] for u in tangent for z in heights],
            dtype=np.float64,
        )
        source_x_other = np.asarray(
            [[1.0, u + 2.0, z] for u in tangent for z in heights],
            dtype=np.float64,
        )
        target_x_other = np.asarray(
            [[2.0, u + 2.0, z] for u in tangent for z in heights],
            dtype=np.float64,
        )
        source_surface, source_inventory = indexed_fixture(
            (
                (0, 0.0, 0.0, 1.0, x_zero),
                (1, 90.0, 0.0, 1.0, y_zero),
                (2, 0.0, 1.0, 1.0, source_x_other),
            )
        )
        target_surface, target_inventory = indexed_fixture(
            (
                (10, 0.0, 0.0, 1.0, x_zero),
                (11, 90.0, 0.0, 1.0, y_zero),
                (12, 0.0, 2.0, 1.0, target_x_other),
            )
        )
        forged_source_planes = list(source_inventory.wall_planes)
        forged_target_planes = list(target_inventory.wall_planes)
        forged_source_planes[2] = replace(
            forged_source_planes[2], support_area_proxy_m2=1.0e-12
        )
        forged_target_planes[2] = replace(
            forged_target_planes[2], support_area_proxy_m2=1.0e-12
        )
        forged_source_inventory = replace(
            source_inventory, wall_planes=tuple(forged_source_planes)
        )
        forged_target_inventory = replace(
            target_inventory, wall_planes=tuple(forged_target_planes)
        )
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (10, 11), False
        )
        cfg = replace(config(), plane_min_occupied_cells=1)

        baseline_score, baseline_evidence = score(
            source_surface,
            target_surface,
            source_inventory,
            target_inventory,
            hypothesis,
            full_patch_score=True,
            cfg=cfg,
        )
        forged_score, forged_evidence = score(
            source_surface,
            target_surface,
            forged_source_inventory,
            forged_target_inventory,
            hypothesis,
            full_patch_score=True,
            cfg=cfg,
        )

        self.assertTrue(baseline_evidence["assessable"])
        self.assertTrue(forged_evidence["assessable"])
        self.assertAlmostEqual(baseline_score, forged_score, places=12)
        self.assertAlmostEqual(
            baseline_evidence["matchedSourceAreaFraction"],
            forged_evidence["matchedSourceAreaFraction"],
            places=12,
        )
        self.assertAlmostEqual(
            baseline_evidence["matchedTargetAreaFraction"],
            forged_evidence["matchedTargetAreaFraction"],
            places=12,
        )
        self.assertTrue(
            forged_evidence["physicalSupportAreaRecomputedFromIndexedPatchRows"]
        )
        self.assertTrue(
            forged_evidence["declaredSupportAreaCannotSteerFullPatchScore"]
        )

    def test_invalid_support_count_fails_in_full_patch_mode(self) -> None:
        tangent = np.asarray([-0.30, 0.0, 0.30])
        heights = np.asarray([0.0, 0.30])
        x_patch = np.asarray(
            [[0.0, u, z] for u in tangent for z in heights], dtype=np.float64
        )
        y_patch = np.asarray(
            [[u + 0.6, 0.0, z] for u in tangent for z in heights],
            dtype=np.float64,
        )
        candidate_surface, candidate_inventory = indexed_fixture(
            (
                (0, 0.0, 0.0, 1.0, x_patch),
                (1, 90.0, 0.0, 1.0, y_patch),
            )
        )
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (0, 1), False
        )

        for invalid_support_count in (-999, 5, True, 6.0):
            with self.subTest(support_count=repr(invalid_support_count)):
                malformed_planes = list(candidate_inventory.wall_planes)
                malformed_planes[0] = replace(
                    malformed_planes[0], support_count=invalid_support_count
                )
                malformed_inventory = replace(
                    candidate_inventory, wall_planes=tuple(malformed_planes)
                )
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    score(
                        candidate_surface,
                        candidate_surface,
                        malformed_inventory,
                        candidate_inventory,
                        hypothesis,
                        full_patch_score=True,
                    )
                self.assertEqual(
                    "INVALID_PLANE_SCORE_INPUT", caught.exception.code
                )

    def test_unassessable_occupancy_receives_zero_f1_and_full_penalty(self) -> None:
        tangent = np.linspace(0.001, 0.009, 12)
        x_patch = np.asarray(
            [[0.0, float(u), 0.001] for u in tangent], dtype=np.float64
        )
        y_patch = np.asarray(
            [[float(u), 0.0, 0.001] for u in tangent], dtype=np.float64
        )
        candidate_surface, candidate_inventory = indexed_fixture(
            (
                (0, 0.0, 0.0, 1.0, x_patch),
                (1, 90.0, 0.0, 1.0, y_patch),
            )
        )
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (0, 1), False
        )
        cfg = replace(
            config(),
            plane_occupancy_cell_m=0.05,
            plane_min_occupied_cells=6,
        )

        actual_score, evidence = score(
            candidate_surface,
            candidate_surface,
            candidate_inventory,
            candidate_inventory,
            hypothesis,
            full_patch_score=True,
            cfg=cfg,
        )

        self.assertTrue(evidence["assessable"])
        self.assertEqual(0, evidence["occupancyAssessablePlaneCount"])
        self.assertEqual(0.0, evidence["occupancyF1"])
        self.assertAlmostEqual(cfg.plane_occupancy_cell_m, actual_score, places=12)
        self.assertEqual(0.0, evidence["unassessableOccupancyF1ForScore"])
        self.assertEqual(
            "all matched physical wall patches",
            evidence["occupancyMeanDenominator"],
        )


if __name__ == "__main__":
    unittest.main()
