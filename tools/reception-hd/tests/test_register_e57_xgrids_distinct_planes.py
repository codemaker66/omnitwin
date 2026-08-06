from __future__ import annotations

from dataclasses import replace
import math
from pathlib import Path
import sys
import unittest

import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

import register_e57_xgrids_surfaces as surfaces  # noqa: E402


def room() -> surfaces.SurfaceSet:
    points: list[list[float]] = []
    normals: list[list[float]] = []
    labels: list[int] = []

    def add(rows: list[list[float]], normal: list[float], label: int) -> None:
        points.extend(rows)
        normals.extend([normal] * len(rows))
        labels.extend([label] * len(rows))

    z_values = np.linspace(0.0, 3.0, 7)
    for y in np.linspace(0.0, 5.0, 13):
        add([[0.0, float(y), float(z)] for z in z_values], [1.0, 0.0, 0.0], surfaces.LABEL_WALL)
    for y in np.linspace(0.0, 3.0, 9):
        add([[7.0, float(y), float(z)] for z in z_values], [1.0, 0.0, 0.0], surfaces.LABEL_WALL)
    for x in np.linspace(0.0, 7.0, 17):
        add([[float(x), 0.0, float(z)] for z in z_values], [0.0, 1.0, 0.0], surfaces.LABEL_WALL)
    for x in np.linspace(0.0, 3.0, 9):
        add([[float(x), 5.0, float(z)] for z in z_values], [0.0, 1.0, 0.0], surfaces.LABEL_WALL)
    for y in np.linspace(2.0, 4.0, 8):
        add([[2.0, float(y), float(z)] for z in z_values], [1.0, 0.0, 0.0], surfaces.LABEL_WALL)
    floor_xy = [
        (float(x), float(y))
        for x in np.linspace(0.2, 6.8, 14)
        for y in np.linspace(0.2, 4.8, 11)
        if x < 3.0 or y < 3.0
    ]
    add([[x, y, 0.0] for x, y in floor_xy], [0.0, 0.0, 1.0], surfaces.LABEL_FLOOR)
    add([[x, y, 3.0] for x, y in floor_xy], [0.0, 0.0, 1.0], surfaces.LABEL_CEILING)
    point_array = np.asarray(points, dtype=np.float64)
    return surfaces.SurfaceSet(
        point_array,
        np.asarray(normals, dtype=np.float64),
        np.asarray(labels, dtype=np.int8),
        np.ones(point_array.shape[0], dtype=np.float64),
    )


def config() -> surfaces.StructuralConfig:
    return surfaces.StructuralConfig(
        fit_points_per_class=500,
        continuous_refinement_max_evaluations=800,
    )


class DistinctPlaneTests(unittest.TestCase):
    def test_canonical_plane_flips_normal_and_offset_together(self) -> None:
        normal, offset = surfaces._canonical_xy_plane(np.asarray([-1.0, 0.0]), -7.0, np=np)
        np.testing.assert_array_equal(normal, [1.0, 0.0])
        self.assertEqual(7.0, offset)

    def test_parallel_planes_remain_distinct(self) -> None:
        inventory, evidence = surfaces.extract_structural_inventory(room(), config=config(), np=np)
        x_offsets = sorted(
            round(plane.offset_m, 3)
            for plane in inventory.wall_planes
            if abs(float(plane.normal_xy[0])) > 0.99
        )
        y_offsets = sorted(
            round(plane.offset_m, 3)
            for plane in inventory.wall_planes
            if abs(float(plane.normal_xy[1])) > 0.99
        )
        self.assertEqual([0.0, 2.0, 7.0], x_offsets)
        self.assertEqual([0.0, 5.0], y_offsets)
        self.assertEqual(5, evidence["wallPlaneCount"])

    def test_horizontal_level_uses_supported_plane_not_broad_band_median(self) -> None:
        values = np.concatenate(
            (
                np.linspace(-0.01, 0.01, 120),
                np.linspace(0.35, 0.45, 80),
            )
        )
        level, _mad, evidence = surfaces._dominant_horizontal_level(
            values,
            np.ones(values.size),
            role="floor",
            config=config(),
            np=np,
        )
        self.assertAlmostEqual(0.0, level, delta=0.01)
        self.assertGreaterEqual(evidence["supportCount"], 120)

    def test_horizontal_envelope_beats_more_densely_sampled_interior_clutter(self) -> None:
        floor_values = np.concatenate(
            (
                np.linspace(-0.01, 0.01, 120),
                np.linspace(0.39, 0.41, 480),
                np.asarray([-0.9, -0.8, -0.7]),
            )
        )
        ceiling_values = np.concatenate(
            (
                np.linspace(2.59, 2.61, 480),
                np.linspace(2.99, 3.01, 120),
                np.asarray([3.7, 3.8, 3.9]),
            )
        )
        floor, _floor_mad, floor_evidence = surfaces._dominant_horizontal_level(
            floor_values,
            np.ones(floor_values.size),
            role="floor",
            config=config(),
            np=np,
        )
        ceiling, _ceiling_mad, ceiling_evidence = surfaces._dominant_horizontal_level(
            ceiling_values,
            np.ones(ceiling_values.size),
            role="ceiling",
            config=config(),
            np=np,
        )
        self.assertAlmostEqual(0.0, floor, delta=0.01)
        self.assertAlmostEqual(3.0, ceiling, delta=0.01)
        self.assertEqual("lowest supported distinct mode", floor_evidence["selectionRule"])
        self.assertEqual("highest supported distinct mode", ceiling_evidence["selectionRule"])
        self.assertGreaterEqual(floor_evidence["supportedDistinctLevelCount"], 2)
        self.assertGreaterEqual(ceiling_evidence["supportedDistinctLevelCount"], 2)

    def test_inventory_envelope_requires_long_wall_endpoints_for_interior_clutter(self) -> None:
        base = room()
        floor_clutter_xy = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.3, 6.7, 25)
                for y in np.linspace(0.3, 4.7, 20)
            ],
            dtype=np.float64,
        )
        additions = (
            (floor_clutter_xy, 0.80, surfaces.LABEL_FLOOR),
            (floor_clutter_xy, 2.20, surfaces.LABEL_CEILING),
        )
        extra_points = np.vstack(
            [
                np.column_stack((xy, np.full(xy.shape[0], z, dtype=np.float64)))
                for xy, z, _label in additions
            ]
        )
        extra_labels = np.concatenate(
            [
                np.full(xy.shape[0], label, dtype=np.int8)
                for xy, _z, label in additions
            ]
        )
        extra_normals = np.tile(
            np.asarray([0.0, 0.0, 1.0], dtype=np.float64),
            (extra_points.shape[0], 1),
        )
        augmented = surfaces.SurfaceSet(
            np.vstack((base.points, extra_points)),
            np.vstack((base.normals, extra_normals)),
            np.concatenate((base.labels, extra_labels)),
            np.ones(base.points.shape[0] + extra_points.shape[0], dtype=np.float64),
        )
        inventory, evidence = surfaces.extract_structural_inventory(
            augmented, config=config(), np=np
        )
        self.assertAlmostEqual(0.0, inventory.floor_z_m, delta=0.01)
        self.assertAlmostEqual(3.0, inventory.ceiling_z_m, delta=0.01)
        floor_levels = evidence["horizontalLevels"]["floor"]["supportedDistinctLevels"]
        ceiling_levels = evidence["horizontalLevels"]["ceiling"]["supportedDistinctLevels"]
        raised_floor = min(floor_levels, key=lambda item: abs(item["levelMeters"] - 0.80))
        low_soffit = min(ceiling_levels, key=lambda item: abs(item["levelMeters"] - 2.20))
        self.assertFalse(raised_floor["qualifiedAsBoundarySupportedLevel"])
        self.assertFalse(low_soffit["qualifiedAsBoundarySupportedLevel"])

    def test_broad_higher_band_without_wall_support_blocks_lower_top(self) -> None:
        cfg = config()
        base = room()
        inventory, _ = surfaces.extract_structural_inventory(base, config=cfg, np=np)
        ceiling = base.points[base.labels == surfaces.LABEL_CEILING].copy()
        broad_high = ceiling.copy()
        broad_high[:, 2] = 8.0
        points = np.vstack((ceiling, broad_high))
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                points,
                np.ones(points.shape[0]),
                inventory.wall_planes,
                role="ceiling",
                allow_multiple_ceiling_levels=True,
                config=cfg,
                np=np,
            )
        self.assertEqual(
            "HIGHER_CEILING_BAND_INSUFFICIENT_BOUNDARY_SUPPORT",
            caught.exception.code,
        )

    def test_remote_ceiling_at_correct_z_does_not_contact_origin_walls(self) -> None:
        cfg = config()
        base = room()
        inventory, _ = surfaces.extract_structural_inventory(base, config=cfg, np=np)
        near_points = base.points[base.labels == surfaces.LABEL_CEILING].copy()

        level, _mad, evidence = surfaces._select_room_envelope_level(
            near_points,
            np.ones(near_points.shape[0], dtype=np.float64),
            inventory.wall_planes,
            role="ceiling",
            allow_multiple_ceiling_levels=True,
            config=cfg,
            np=np,
        )
        self.assertAlmostEqual(3.0, level, delta=0.01)
        selected = evidence["supportedDistinctLevels"][evidence["selectedDistinctLevelIndex"]]
        self.assertTrue(selected["qualifiedAsBoundarySupportedLevel"])
        self.assertTrue(selected["selectedAsRoomEnvelope"])
        self.assertGreaterEqual(selected["supportingBoundaryWallCount"], 2)

        # Change only XY. The footprint size and correct ceiling Z remain unchanged.
        remote_points = near_points.copy()
        remote_points[:, :2] += np.asarray([100.0, 200.0])

        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                remote_points,
                np.ones(remote_points.shape[0], dtype=np.float64),
                inventory.wall_planes,
                role="ceiling",
                allow_multiple_ceiling_levels=True,
                config=cfg,
                np=np,
            )
        self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)

    def test_unobserved_midpoint_higher_ceiling_band_cannot_be_hidden(self) -> None:
        cfg = config()
        base = room()
        inventory, _ = surfaces.extract_structural_inventory(
            base, config=cfg, np=np
        )
        true_top = base.points[
            base.labels == surfaces.LABEL_CEILING
        ].copy()
        high_xy = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(10.0, 11.2, 4)
                for y in np.linspace(10.0, 10.8, 3)
            ]
        )
        high_z = np.asarray([3.9405] * 6 + [4.0595] * 6)
        high_band = np.column_stack((high_xy, high_z))
        points = np.vstack((true_top, high_band))

        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                points,
                np.ones(points.shape[0]),
                inventory.wall_planes,
                role="ceiling",
                allow_multiple_ceiling_levels=True,
                config=cfg,
                np=np,
            )
        self.assertEqual(
            "HIGHER_CEILING_BAND_INSUFFICIENT_BOUNDARY_SUPPORT",
            caught.exception.code,
        )

    def test_close_ceiling_modes_cannot_reuse_the_same_wall_endpoint(self) -> None:
        cfg = config()
        base = room()
        inventory, _ = surfaces.extract_structural_inventory(base, config=cfg, np=np)
        ceiling_xy = base.points[base.labels == surfaces.LABEL_CEILING, :2]
        points = np.vstack(
            (
                np.column_stack((ceiling_xy, np.full(ceiling_xy.shape[0], 2.75))),
                np.column_stack((ceiling_xy, np.full(ceiling_xy.shape[0], 3.00))),
            )
        )

        _level, _mad, evidence = surfaces._select_room_envelope_level(
            points,
            np.ones(points.shape[0], dtype=np.float64),
            inventory.wall_planes,
            role="ceiling",
            allow_multiple_ceiling_levels=True,
            config=cfg,
            np=np,
        )

        candidates = sorted(
            evidence["supportedDistinctLevels"], key=lambda item: item["levelMeters"]
        )
        self.assertEqual(2, len(candidates))
        np.testing.assert_allclose(evidence["reportedBoundarySupportedBandMeters"], [3.0])
        self.assertTrue(candidates[-1]["selectedAsRoomEnvelope"])
        self.assertTrue(candidates[-1]["usedForFixedScaleGate"])

        rows_by_plane: dict[int, list[dict[str, object]]] = {}
        for candidate in candidates:
            for wall in candidate["wallEndpointSupport"]:
                rows_by_plane.setdefault(wall["planeId"], []).append(wall)

        self.assertTrue(rows_by_plane)
        for wall_rows in rows_by_plane.values():
            self.assertEqual(2, len(wall_rows))
            self.assertTrue(all(row["withinEndpointTolerance"] for row in wall_rows))
            self.assertTrue(all(row["spatiallyContactsWallPatch"] for row in wall_rows))
            self.assertEqual(
                1,
                sum(
                    bool(row["assignedExclusivelyToCandidate"])
                    for row in wall_rows
                ),
            )
            self.assertEqual(
                1,
                sum(
                    bool(row["supportsBoundaryQualification"])
                    for row in wall_rows
                ),
            )

    @staticmethod
    def _parallel_wall_patch(
        plane_id: int,
        x_offset_m: float,
        cfg: surfaces.StructuralConfig,
    ) -> surfaces.WallPlanePatch:
        occupied_cells = frozenset(
            (tangent_cell, z_cell)
            for tangent_cell in range(27)
            for z_cell in range(20)
        )
        cell_m = cfg.plane_occupancy_cell_m
        return surfaces.WallPlanePatch(
            plane_id=plane_id,
            normal_xy=np.asarray([1.0, 0.0]),
            offset_m=x_offset_m,
            point_indices=np.empty(0, dtype=np.int64),
            support_count=len(occupied_cells),
            support_area_proxy_m2=len(occupied_cells) * cell_m * cell_m,
            tangent_range_m=(0.0, 4.0),
            tangent_segments=(
                surfaces.WallTangentSegment(
                    segment_id=0,
                    tangent_range_m=(0.0, 4.0),
                    raw_point_count=27,
                    distinct_tangent_position_count=27,
                    endpoint_column_count=27,
                    robust_z_range_m=(0.0, 2.925),
                    typical_vertical_sampling_gap_m=0.15,
                    lower_endpoint_support_tangent_positions_m=tuple(
                        float(value) for value in np.linspace(0.075, 3.925, 27)
                    ),
                    upper_endpoint_support_tangent_positions_m=tuple(
                        float(value) for value in np.linspace(0.075, 3.925, 27)
                    ),
                ),
            ),
            z_range_m=(0.0, 3.0),
            robust_z_range_m=(0.0, 2.925),
            occupied_cells=occupied_cells,
            residual_median_m=0.0,
            residual_p95_m=0.0,
        )

    def _plane_score_fixture(
        self,
        specs: tuple[tuple[int, np.ndarray, float, np.ndarray], ...],
        z_values: tuple[float, ...],
        *,
        cfg: surfaces.StructuralConfig,
        base_inventory: surfaces.StructuralInventory,
    ) -> tuple[surfaces.SurfaceSet, surfaces.StructuralInventory]:
        point_chunks: list[np.ndarray] = []
        normal_chunks: list[np.ndarray] = []
        patches: list[surfaces.WallPlanePatch] = []
        start = 0
        for plane_id, normal_xy, offset_m, tangent_values in specs:
            normal_xy = np.asarray(normal_xy, dtype=np.float64)
            tangent = np.asarray([-normal_xy[1], normal_xy[0]], dtype=np.float64)
            rows = np.asarray(
                [
                    [
                        float((offset_m * normal_xy + u * tangent)[0]),
                        float((offset_m * normal_xy + u * tangent)[1]),
                        float(z),
                    ]
                    for u in tangent_values
                    for z in z_values
                ],
                dtype=np.float64,
            )
            indexes = np.arange(start, start + rows.shape[0], dtype=np.int64)
            start += rows.shape[0]
            point_chunks.append(rows)
            normal_chunks.append(
                np.tile([normal_xy[0], normal_xy[1], 0.0], (rows.shape[0], 1))
            )
            patches.append(
                replace(
                    self._parallel_wall_patch(plane_id, float(offset_m), cfg),
                    normal_xy=normal_xy,
                    offset_m=float(offset_m),
                    point_indices=indexes,
                    support_count=rows.shape[0],
                    support_area_proxy_m2=2.0,
                    tangent_range_m=(
                        float(np.min(tangent_values)),
                        float(np.max(tangent_values)),
                    ),
                    z_range_m=(float(min(z_values)), float(max(z_values))),
                    robust_z_range_m=(float(min(z_values)), float(max(z_values))),
                )
            )
        points = np.vstack(point_chunks)
        surface_set = surfaces.SurfaceSet(
            points,
            np.vstack(normal_chunks),
            np.full(points.shape[0], surfaces.LABEL_WALL, dtype=np.int8),
            np.ones(points.shape[0], dtype=np.float64),
        )
        inventory = replace(
            base_inventory,
            wall_planes=tuple(patches),
            floor_z_m=float(min(z_values)),
            ceiling_z_m=float(max(z_values)),
            ceiling_levels_m=(float(max(z_values)),),
            ceiling_level_mads_m=(0.0,),
        )
        return surface_set, inventory

    @staticmethod
    def _full_plane_score(
        source_set: surfaces.SurfaceSet,
        target_set: surfaces.SurfaceSet,
        source_inventory: surfaces.StructuralInventory,
        target_inventory: surfaces.StructuralInventory,
        hypothesis: surfaces.PlaneHypothesis,
        cfg: surfaces.StructuralConfig,
    ) -> tuple[float, dict[str, object]]:
        return surfaces._score_plane_hypothesis(
            source_set,
            target_set,
            source_inventory,
            target_inventory,
            hypothesis,
            full_patch_score=True,
            config=cfg,
            linear_sum_assignment=linear_sum_assignment,
            np=np,
            cKDTree=cKDTree,
        )

    @staticmethod
    def _parallel_ceiling_patch(width_m: float) -> np.ndarray:
        xy = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.05, width_m - 0.05, 17)
                for y in np.linspace(0.05, 3.95, 17)
            ]
        )
        # This exactly matches the robust upper endpoint of the synthetic walls.
        return np.column_stack((xy, np.full(xy.shape[0], 2.925)))

    def test_parallel_fallback_requires_opposite_side_wall_separation(self) -> None:
        cfg = config()
        near_duplicate_walls = (
            self._parallel_wall_patch(10, 0.0, cfg),
            self._parallel_wall_patch(11, 0.6, cfg),
        )
        opposite_side_walls = (
            self._parallel_wall_patch(10, 0.0, cfg),
            self._parallel_wall_patch(11, 2.0, cfg),
        )

        near_profiles, _ = surfaces._boundary_wall_profiles(
            near_duplicate_walls, config=cfg, np=np
        )
        opposite_profiles, _ = surfaces._boundary_wall_profiles(
            opposite_side_walls, config=cfg, np=np
        )
        near_separated, near_pair_evidence = surfaces._well_separated_parallel_support(
            near_profiles,
            anchor_xy=np.asarray([0.3, 2.0]),
            config=cfg,
            np=np,
        )
        opposite_separated, opposite_pair_evidence = (
            surfaces._well_separated_parallel_support(
                opposite_profiles,
                anchor_xy=np.asarray([1.0, 2.0]),
                config=cfg,
                np=np,
            )
        )
        self.assertFalse(near_separated)
        self.assertTrue(opposite_separated)
        self.assertFalse(near_pair_evidence[0]["qualifiesAsWellSeparatedParallelPair"])
        self.assertTrue(opposite_pair_evidence[0]["qualifiesAsWellSeparatedParallelPair"])

        near_points = self._parallel_ceiling_patch(0.6)
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                near_points,
                np.ones(near_points.shape[0], dtype=np.float64),
                near_duplicate_walls,
                role="ceiling",
                allow_multiple_ceiling_levels=True,
                config=cfg,
                np=np,
            )
        self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)
        near_floor_points = near_points.copy()
        near_floor_points[:, 2] = 0.0
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                near_floor_points,
                np.ones(near_floor_points.shape[0], dtype=np.float64),
                near_duplicate_walls,
                role="floor",
                config=cfg,
                np=np,
            )
        self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)

        opposite_points = self._parallel_ceiling_patch(2.0)
        level, _mad, evidence = surfaces._select_room_envelope_level(
            opposite_points,
            np.ones(opposite_points.shape[0], dtype=np.float64),
            opposite_side_walls,
            role="ceiling",
            allow_multiple_ceiling_levels=True,
            config=cfg,
            np=np,
        )
        self.assertAlmostEqual(2.925, level)

        opposite_floor_points = opposite_points.copy()
        opposite_floor_points[:, 2] = 0.0
        floor_level, _floor_mad, floor_evidence = (
            surfaces._select_room_envelope_level(
                opposite_floor_points,
                np.ones(opposite_floor_points.shape[0], dtype=np.float64),
                opposite_side_walls,
                role="floor",
                config=cfg,
                np=np,
            )
        )
        self.assertAlmostEqual(0.0, floor_level)
        floor_selected = floor_evidence["supportedDistinctLevels"][
            floor_evidence["selectedDistinctLevelIndex"]
        ]
        self.assertFalse(floor_selected["hasTwoNonparallelSupportingBoundaryWalls"])
        self.assertTrue(
            floor_selected["hasTwoWellSeparatedParallelSupportingBoundaryWalls"]
        )

        selected = evidence["supportedDistinctLevels"][evidence["selectedDistinctLevelIndex"]]
        self.assertFalse(selected["hasTwoNonparallelSupportingBoundaryWalls"])
        self.assertTrue(selected["hasTwoWellSeparatedParallelSupportingBoundaryWalls"])
        supporting_walls = [
            wall
            for wall in selected["wallEndpointSupport"]
            if wall["supportsBoundaryQualification"]
        ]
        self.assertEqual({10, 11}, {wall["planeId"] for wall in supporting_walls})
        self.assertTrue(
            all(wall["spatiallyContactsWallPatch"] for wall in supporting_walls)
        )

    def test_near_parallel_separation_is_invariant_to_map_origin(self) -> None:
        cfg = config()
        angle = math.radians(1.0)
        first = self._parallel_wall_patch(20, 0.0, cfg)
        second = replace(
            self._parallel_wall_patch(21, 0.5, cfg),
            normal_xy=np.asarray([math.cos(angle), math.sin(angle)]),
        )
        original_profiles = [{"plane": first}, {"plane": second}]
        original_ok, original_evidence = surfaces._well_separated_parallel_support(
            original_profiles,
            anchor_xy=np.asarray([0.0, 0.0]),
            config=cfg,
            np=np,
        )

        translation = np.asarray([0.0, 100.0])
        translated_first = replace(
            first,
            offset_m=float(first.offset_m + first.normal_xy @ translation),
        )
        translated_second = replace(
            second,
            offset_m=float(second.offset_m + second.normal_xy @ translation),
        )
        translated_profiles = [
            {"plane": translated_first},
            {"plane": translated_second},
        ]
        translated_ok, translated_evidence = surfaces._well_separated_parallel_support(
            translated_profiles,
            anchor_xy=translation,
            config=cfg,
            np=np,
        )

        self.assertFalse(original_ok)
        self.assertEqual(original_ok, translated_ok)
        self.assertAlmostEqual(
            original_evidence[0]["anchorMeasuredSeparationMeters"],
            translated_evidence[0]["anchorMeasuredSeparationMeters"],
            places=12,
        )

    def test_exact_parallel_boundaries_are_stable_under_rigid_motion(self) -> None:
        cfg = config()

        def transform_plane(
            plane: surfaces.WallPlanePatch,
            rotation_xy: np.ndarray,
            translation_xy: np.ndarray,
        ) -> surfaces.WallPlanePatch:
            normal = rotation_xy @ plane.normal_xy
            return replace(
                plane,
                normal_xy=normal,
                offset_m=float(plane.offset_m + normal @ translation_xy),
            )

        cases = (
            (
                (
                    self._parallel_wall_patch(70, 0.0, cfg),
                    self._parallel_wall_patch(71, 1.0, cfg),
                ),
                np.asarray([0.5, 2.0]),
            ),
            (
                (
                    self._parallel_wall_patch(72, 0.0, cfg),
                    replace(
                        self._parallel_wall_patch(73, 1.2, cfg),
                        normal_xy=np.asarray(
                            [
                                math.cos(math.radians(2.0)),
                                math.sin(math.radians(2.0)),
                            ]
                        ),
                    ),
                ),
                np.asarray([0.5, 2.0]),
            ),
            (
                (
                    self._parallel_wall_patch(74, 0.0, cfg),
                    self._parallel_wall_patch(75, 1.2, cfg),
                ),
                np.asarray([0.0, 2.0]),
            ),
        )
        angle = math.radians(123.4)
        rotation_xy = np.asarray(
            [
                [math.cos(angle), -math.sin(angle)],
                [math.sin(angle), math.cos(angle)],
            ]
        )
        translation_xy = np.asarray([100000.0, -73100.0])
        for walls, anchor in cases:
            with self.subTest(plane_ids=[wall.plane_id for wall in walls]):
                original_profiles = [{"plane": wall} for wall in walls]
                original_ok, _original_evidence = (
                    surfaces._well_separated_parallel_support(
                        original_profiles,
                        anchor_xy=anchor,
                        config=cfg,
                        np=np,
                    )
                )
                transformed_walls = tuple(
                    transform_plane(wall, rotation_xy, translation_xy)
                    for wall in walls
                )
                transformed_anchor = (
                    rotation_xy @ anchor + translation_xy
                )
                transformed_ok, _transformed_evidence = (
                    surfaces._well_separated_parallel_support(
                        [{"plane": wall} for wall in transformed_walls],
                        anchor_xy=transformed_anchor,
                        config=cfg,
                        np=np,
                    )
                )
                self.assertTrue(original_ok)
                self.assertEqual(original_ok, transformed_ok)

    def test_horizontal_footprint_and_wall_contact_are_rigid_transform_invariant(self) -> None:
        cfg = config()
        source = room()
        transformed = surfaces.transform_surfaces(
            source,
            surfaces.yaw_rotation(math.radians(31.25), np),
            np.asarray([0.05, -0.07, 0.4]),
            np,
        )
        _source_inventory, source_evidence = surfaces.extract_structural_inventory(
            source, config=cfg, np=np
        )
        _target_inventory, target_evidence = surfaces.extract_structural_inventory(
            transformed, config=cfg, np=np
        )

        for role in ("floor", "ceiling"):
            source_level = source_evidence["horizontalLevels"][role]
            target_level = target_evidence["horizontalLevels"][role]
            source_selected = source_level["supportedDistinctLevels"][
                source_level["selectedDistinctLevelIndex"]
            ]
            target_selected = target_level["supportedDistinctLevels"][
                target_level["selectedDistinctLevelIndex"]
            ]
            self.assertAlmostEqual(
                source_selected["horizontalFootprintAreaSquareMeters"],
                target_selected["horizontalFootprintAreaSquareMeters"],
                places=10,
            )
            self.assertEqual(
                source_selected["supportingBoundaryWallCount"],
                target_selected["supportingBoundaryWallCount"],
            )
            source_coverages = sorted(
                wall["spatialContactTotalCoverageMeters"]
                for wall in source_selected["wallEndpointSupport"]
                if wall["supportsBoundaryQualification"]
            )
            target_coverages = sorted(
                wall["spatialContactTotalCoverageMeters"]
                for wall in target_selected["wallEndpointSupport"]
                if wall["supportsBoundaryQualification"]
            )
            np.testing.assert_allclose(source_coverages, target_coverages, atol=1e-10)

    def test_far_xy_outlier_cannot_inflate_local_horizontal_footprint(self) -> None:
        cluster = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.0, 0.2, 3)
                for y in np.linspace(0.0, 0.2, 3)
            ]
        )
        points = np.vstack((cluster, np.asarray([[100.0, 100.0]])))
        area, evidence, _component_indexes = surfaces._robust_xy_footprint_area(
            points,
            maximum_triangle_edge_m=0.80,
            minimum_triangle_quality=0.20,
            density_sliver_max_width_m=0.025,
            metric_boundary_epsilon_m=1e-9,
            np=np,
        )
        self.assertAlmostEqual(0.04, area, places=12)
        self.assertEqual(1, evidence["nonAuthoritativeInputPointCount"])
        self.assertGreater(
            evidence["rawConvexHullAreaSquareMetersSensitivityOnly"], 10.0
        )
        self.assertLess(area, config().horizontal_level_min_footprint_area_m2)

    def test_l_shaped_boundary_points_do_not_fake_filled_ceiling_area(self) -> None:
        arm = np.linspace(0.0, 0.5, 6)
        points = np.vstack(
            (
                np.column_stack((arm, np.zeros(arm.size))),
                np.column_stack((np.zeros(arm.size), arm)),
            )
        )
        area, evidence, _component_indexes = surfaces._robust_xy_footprint_area(
            points,
            maximum_triangle_edge_m=0.80,
            minimum_triangle_quality=0.20,
            density_sliver_max_width_m=0.025,
            metric_boundary_epsilon_m=1e-9,
            np=np,
        )
        self.assertLess(area, config().horizontal_level_min_footprint_area_m2)
        self.assertLessEqual(area, 0.125 + 1e-12)
        self.assertTrue(
            evidence["authoritativeComponentConvexHullAreaSquareMetersSensitivityOnly"]
            > 0.0
            or evidence["broadSamplingBridgeAmbiguousComponentCount"] > 0
            or evidence[
                "sampledOuterBoundaryInsufficientStrictInteriorSupportRejectedFailClosed"
            ]
        )

    def test_dense_tiny_patch_cannot_erase_larger_room_footprint(self) -> None:
        room_xy = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.0, 4.0, 9)
                for y in np.linspace(0.0, 4.0, 9)
            ]
        )
        tiny_dense_patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(10.0, 10.1, 51)
                for y in np.linspace(10.0, 10.1, 51)
            ]
        )
        for xy in (
            np.vstack((room_xy, tiny_dense_patch)),
            np.vstack((tiny_dense_patch, room_xy)),
        ):
            area, evidence, component_indexes = surfaces._robust_xy_footprint_area(
                xy,
                maximum_triangle_edge_m=0.80,
                minimum_triangle_quality=0.20,
                density_sliver_max_width_m=0.025,
                metric_boundary_epsilon_m=1e-9,
                np=np,
            )
            self.assertAlmostEqual(16.0, area, places=10)
            self.assertFalse(
                evidence["globalPointDensityWeightedRadialPrefilterUsed"]
            )
            self.assertTrue(
                evidence["componentSelectionUsesPhysicalAreaNotPointCount"]
            )
            selected_xy = xy[component_indexes]
            self.assertLessEqual(float(np.max(selected_xy[:, 0])), 4.0)
            self.assertLessEqual(float(np.max(selected_xy[:, 1])), 4.0)
            np.testing.assert_allclose(
                evidence["authoritativeComponentAreaCentroidXYMeters"],
                [2.0, 2.0],
                atol=1e-10,
            )

    def test_redundant_near_point_cannot_break_equal_component_ambiguity(self) -> None:
        cfg = config()
        first_patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(3.0, 3.45, 3)
                for y in np.linspace(3.0, 3.45, 3)
            ]
        )
        second_patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.05, 0.50, 3)
                for y in np.linspace(0.05, 0.50, 3)
            ]
        )
        redundant_near_center = np.asarray([[3.226, 3.225]])
        base_xy = np.vstack((first_patch, second_patch))
        attacked_xy = np.vstack(
            (first_patch, redundant_near_center, second_patch)
        )
        for xy in (base_xy, attacked_xy):
            area, evidence, component_indexes = surfaces._robust_xy_footprint_area(
                xy,
                maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                np=np,
            )
            self.assertEqual(0.0, area)
            self.assertTrue(
                evidence["authoritativeLargestComponentSelectionAmbiguous"]
            )
            self.assertEqual(0, component_indexes.size)
            np.testing.assert_allclose(
                evidence[
                    "acceptedTriangleConnectedComponentAreasSquareMeters"
                ][:2],
                [0.2025, 0.2025],
                atol=1e-10,
            )

        inventory, _ = surfaces.extract_structural_inventory(
            room(), config=cfg, np=np
        )
        for xy in (base_xy, attacked_xy):
            points = np.column_stack((xy, np.zeros(xy.shape[0])))
            with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                surfaces._select_room_envelope_level(
                    points,
                    np.ones(points.shape[0]),
                    inventory.wall_planes,
                    role="floor",
                    config=cfg,
                    np=np,
                )
            self.assertEqual(
                "HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND",
                caught.exception.code,
            )

    def test_redundant_boundary_point_cannot_remove_footprint_area(self) -> None:
        cfg = config()
        base_xy = np.asarray(
            [
                [float(x), float(y)]
                for x in (0.0, 0.225, 0.45)
                for y in (0.0, 0.1, 0.2, 0.3)
            ]
        )
        augmented_xy = np.vstack((base_xy, np.asarray([[0.0, 0.024]])))
        selected_areas: list[float] = []
        for xy in (base_xy, augmented_xy):
            area, _evidence, _component_indexes = surfaces._robust_xy_footprint_area(
                xy,
                maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                np=np,
            )
            selected_areas.append(area)
        np.testing.assert_allclose(selected_areas, [0.135, 0.135], atol=1e-12)

    def test_horizontal_near_duplicate_corner_preserves_boundary_area_under_rigid_yaw(self) -> None:
        cfg = config()
        base_xy = np.asarray(
            [
                [float(x), float(y)]
                for x in (0.0, 0.225, 0.45)
                for y in (0.0, 0.1, 0.2, 0.3)
            ],
            dtype=np.float64,
        )
        # This second sample is physically indistinguishable from the genuine
        # lower-left corner, but lies just inside the footprint.  Collapsing
        # the pair must not move a threshold-exact 0.135 m^2 surface below the
        # declared minimum, nor make that decision depend on yaw or row order.
        attacked_xy = np.vstack((base_xy, np.asarray([[6e-6, 6e-6]])))
        identity_order = np.arange(attacked_xy.shape[0], dtype=np.int64)
        orders = (
            identity_order,
            identity_order[::-1],
            np.random.default_rng(1731).permutation(attacked_xy.shape[0]),
        )
        observed_areas: list[float] = []
        for yaw_degrees, order in zip((0.0, 73.0, 179.0), orders, strict=True):
            angle = math.radians(yaw_degrees)
            rotation = np.asarray(
                [
                    [math.cos(angle), -math.sin(angle)],
                    [math.sin(angle), math.cos(angle)],
                ]
            )
            rotated_xy = attacked_xy @ rotation.T
            rotated_points = np.column_stack(
                (rotated_xy, np.zeros(rotated_xy.shape[0], dtype=np.float64))
            )[order]
            physical_points, _physical_weights, deduplication = (
                surfaces._deduplicate_physical_points(
                    rotated_points,
                    np.ones(rotated_points.shape[0], dtype=np.float64),
                    tolerance_m=cfg.horizontal_level_point_dedup_tolerance_m,
                    comparison_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                    np=np,
                )
            )
            area, _evidence, _component_indexes = surfaces._robust_xy_footprint_area(
                physical_points[:, :2],
                maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                np=np,
            )
            self.assertEqual(1, deduplication["removedPointCount"])
            self.assertGreaterEqual(
                area + cfg.metric_boundary_comparison_epsilon_m,
                cfg.horizontal_level_min_footprint_area_m2,
            )
            self.assertAlmostEqual(
                cfg.horizontal_level_min_footprint_area_m2,
                area,
                delta=1e-12,
            )
            observed_areas.append(area)
        np.testing.assert_allclose(
            observed_areas,
            [cfg.horizontal_level_min_footprint_area_m2] * len(observed_areas),
            atol=1e-12,
            rtol=0.0,
        )

    def test_physical_point_distance_boundary_is_rigid_yaw_invariant(self) -> None:
        rows = np.asarray([[0.0, 0.0, 0.0], [1.0001e-5, 0.0, 0.0]])
        for yaw_degrees in (0.0, 2.0, 73.0, 179.0):
            with self.subTest(yaw_degrees=yaw_degrees):
                angle = math.radians(yaw_degrees)
                rotation = np.asarray(
                    [
                        [math.cos(angle), -math.sin(angle)],
                        [math.sin(angle), math.cos(angle)],
                    ]
                )
                rotated = rows.copy()
                rotated[:, :2] = rotated[:, :2] @ rotation.T
                physical, _weights, evidence = surfaces._deduplicate_physical_points(
                    rotated,
                    np.ones(rotated.shape[0]),
                    tolerance_m=1e-5,
                    comparison_epsilon_m=1e-9,
                    np=np,
                )
                self.assertEqual(1, evidence["physicalPointCount"])
                np.testing.assert_allclose(
                    physical[0, :2] @ rotation,
                    [5.0005e-6, 0.0],
                    atol=1e-15,
                )

    def test_physical_point_outward_support_resists_multiplicity_and_yaw(self) -> None:
        rows = np.asarray(
            [
                [-4e-6, 0.0, 0.0],
                [4e-6, 0.0, 0.0],
                [0.0002499999924279821, 1.999999984375001, 0.0],
            ]
        )
        for yaw_degrees in (0.0, 1.0, 73.0, 179.0):
            with self.subTest(yaw_degrees=yaw_degrees):
                angle = math.radians(yaw_degrees)
                rotation = np.asarray(
                    [
                        [math.cos(angle), -math.sin(angle)],
                        [math.sin(angle), math.cos(angle)],
                    ]
                )
                rotated = rows.copy()
                rotated[:, :2] = rotated[:, :2] @ rotation.T
                physical, _weights, _evidence = surfaces._deduplicate_physical_points(
                    rotated,
                    np.ones(rotated.shape[0]),
                    tolerance_m=1e-5,
                    comparison_epsilon_m=1e-9,
                    np=np,
                )
                restored = physical[:, :2] @ rotation
                local = restored[np.argmin(np.linalg.norm(restored, axis=1))]
                np.testing.assert_allclose(local, [-4e-6, 0.0], atol=1e-15)

        for jitter_center in (-4e-6, 4e-6):
            with self.subTest(jitter_center=jitter_center):
                rng = np.random.default_rng(1739)
                jitter = np.column_stack(
                    (
                        jitter_center + rng.normal(0.0, 1e-10, 100),
                        rng.normal(0.0, 1e-10, 100),
                        np.zeros(100),
                    )
                )
                attacked = np.vstack((rows, jitter))
                physical, _weights, evidence = surfaces._deduplicate_physical_points(
                    attacked,
                    np.ones(attacked.shape[0]),
                    tolerance_m=1e-5,
                    comparison_epsilon_m=1e-9,
                    np=np,
                )
                local = physical[np.argmin(np.linalg.norm(physical, axis=1)), :2]
                self.assertLess(float(np.linalg.norm(local - [-4e-6, 0.0])), 1e-9)
                self.assertEqual(0, evidence["ambiguousOrOversizedComponentsOmitted"])

    def test_real_two_centimeter_slit_is_not_density_sliver_repair(self) -> None:
        cfg = config()
        walls = (
            self._parallel_wall_patch(76, 0.0, cfg),
            self._parallel_wall_patch(77, 1.0, cfg),
        )
        for y_values in (
            np.linspace(0.0, 0.45, 3),
            np.linspace(0.0, 0.45, 4),
            np.linspace(0.0, 0.45, 20),
        ):
            left = np.asarray(
                [
                    [float(x), float(y)]
                    for x in (0.0, 0.245, 0.49)
                    for y in y_values
                ]
            )
            right = np.asarray(
                [
                    [float(x), float(y)]
                    for x in (0.51, 0.755, 1.0)
                    for y in y_values
                ]
            )
            xy = np.vstack((left, right))
            area, evidence, component_indexes = surfaces._robust_xy_footprint_area(
                xy,
                maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                np=np,
            )
            self.assertLess(area, cfg.horizontal_level_min_footprint_area_m2)
            self.assertEqual(0, evidence["densitySliverMergedGroupCount"])
            points = np.column_stack((xy, np.zeros(xy.shape[0])))
            with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                surfaces._select_room_envelope_level(
                    points,
                    np.ones(points.shape[0]),
                    walls,
                    role="floor",
                    config=cfg,
                    np=np,
                )
            self.assertEqual(
                "HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND",
                caught.exception.code,
            )

    def test_disconnected_traces_cannot_lend_area_or_wall_contact(self) -> None:
        cfg = config()
        inventory, _ = surfaces.extract_structural_inventory(room(), config=cfg, np=np)
        patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.5, 1.0, 4)
                for y in np.linspace(0.5, 1.0, 4)
            ]
        )
        traces = np.vstack(
            (
                np.column_stack((np.full(3, 0.05), np.asarray([0.5, 0.75, 1.0]))),
                np.column_stack((np.asarray([0.5, 0.75, 1.0]), np.full(3, 0.05))),
            )
        )
        for xy in (patch, np.vstack((patch, traces))):
            points = np.column_stack((xy, np.full(xy.shape[0], 3.0)))
            with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                surfaces._select_room_envelope_level(
                    points,
                    np.ones(points.shape[0]),
                    inventory.wall_planes,
                    role="ceiling",
                    config=cfg,
                    np=np,
                )
            self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)

    def test_cocircular_footprint_is_rigid_motion_invariant_and_terminates(self) -> None:
        cfg = config()
        for point_count, radius in ((19, 0.214), (30, 0.212), (80, 0.212)):
            angles = np.linspace(0.0, 2.0 * math.pi, point_count, endpoint=False)
            base = np.column_stack((np.cos(angles), np.sin(angles))) * radius
            results: list[tuple[float, int]] = []
            for yaw_degrees, translation in (
                (0.0, np.asarray([0.25, 0.25])),
                (7.3, np.asarray([0.25, 0.25])),
                (37.1, np.asarray([999.0, -999.0])),
            ):
                yaw = math.radians(yaw_degrees)
                rotation = np.asarray(
                    [[math.cos(yaw), -math.sin(yaw)], [math.sin(yaw), math.cos(yaw)]]
                )
                xy = base @ rotation.T + translation
                area, evidence, component_indexes = surfaces._robust_xy_footprint_area(
                    xy,
                    maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                    minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                    density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                    metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                    np=np,
                )
                results.append((area, int(component_indexes.size)))
                self.assertLess(area, cfg.horizontal_level_min_footprint_area_m2)
                self.assertTrue(evidence["cocircularInputRejectedFailClosed"])
            np.testing.assert_allclose(
                [result[0] for result in results],
                np.full(3, results[0][0]),
                atol=1e-12,
            )
            self.assertEqual(1, len({result[1] for result in results}))

    def test_partial_cocircular_quad_is_rotation_invariant_fail_closed(self) -> None:
        cfg = config()
        radius = 0.8 / (2.0 * math.sin(math.radians(65.0)))
        angles = np.radians(np.asarray([0.0, 60.0, 130.0, 240.0]))
        quad = np.column_stack((radius * np.cos(angles), radius * np.sin(angles)))
        points = np.vstack((quad, np.asarray([[3.0, 3.0]])))
        areas = []
        for yaw_degrees in (0.0, 1.0, 23.75):
            yaw = math.radians(yaw_degrees)
            rotation = np.asarray(
                [[math.cos(yaw), -math.sin(yaw)], [math.sin(yaw), math.cos(yaw)]]
            )
            candidate = points @ rotation.T + np.asarray([100.0, -200.0])
            area, evidence, _indexes = surfaces._robust_xy_footprint_area(
                candidate,
                maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                np=np,
            )
            areas.append(area)
            self.assertGreater(evidence["cocircularLocalQuadRejectedTriangleCount"], 0)
        np.testing.assert_allclose(areas, np.zeros(3), atol=1e-12)

    def test_dense_valid_square_does_not_disappear_below_sliver_resolution(self) -> None:
        cfg = config()
        for step_m in (0.05, 0.03, 0.02):
            values = np.arange(0.0, 0.400001, step_m)
            xy = np.asarray([[float(x), float(y)] for x in values for y in values])
            area, evidence, component_indexes = surfaces._robust_xy_footprint_area(
                xy,
                maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                np=np,
            )
            expected_area = float((values[-1] - values[0]) ** 2)
            self.assertAlmostEqual(expected_area, area, places=10)
            self.assertEqual(xy.shape[0], component_indexes.size)
            self.assertFalse(evidence["absoluteMinimumTriangleAltitudeUsed"])

    def test_anomalous_five_centimeter_seam_cannot_pool_wall_contacts(self) -> None:
        cfg = config()
        first_patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.02, 0.15, 3)
                for y in np.linspace(0.15, 0.85, 5)
            ]
        )
        second_patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.20, 0.85, 5)
                for y in np.linspace(0.02, 0.25, 3)
            ]
        )
        xy = np.vstack((first_patch, second_patch))
        area, evidence, component_indexes = surfaces._robust_xy_footprint_area(
            xy,
            maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
            minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
            density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
            metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        self.assertEqual(0.0, area)
        self.assertEqual(0, component_indexes.size)
        self.assertTrue(evidence["anomalousParallelSamplingSeamRejectedFailClosed"])
        inventory, _ = surfaces.extract_structural_inventory(room(), config=cfg, np=np)
        points = np.column_stack((xy, np.zeros(xy.shape[0])))
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                points,
                np.ones(points.shape[0]),
                inventory.wall_planes,
                role="floor",
                config=cfg,
                np=np,
            )
        self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)

    def test_circular_trace_plus_one_center_point_is_not_a_filled_floor(self) -> None:
        cfg = config()
        inventory, _ = surfaces.extract_structural_inventory(room(), config=cfg, np=np)
        for point_count in (12, 19):
            angles = np.linspace(0.0, 2.0 * math.pi, point_count, endpoint=False)
            radius = 0.30
            ring = np.column_stack(
                (radius + radius * np.cos(angles), radius + radius * np.sin(angles))
            )
            xy = np.vstack((ring, np.asarray([[radius, radius]])))
            area, evidence, component_indexes = surfaces._robust_xy_footprint_area(
                xy,
                maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                np=np,
            )
            self.assertEqual(0.0, area)
            self.assertEqual(0, component_indexes.size)
            self.assertTrue(
                evidence["circularBoundaryInsufficientInteriorSupportRejectedFailClosed"]
            )
            points = np.column_stack((xy, np.zeros(xy.shape[0])))
            with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                surfaces._select_room_envelope_level(
                    points,
                    np.ones(points.shape[0]),
                    inventory.wall_planes,
                    role="floor",
                    config=cfg,
                    np=np,
                )
            self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)

    def test_dense_sparse_sampling_transitions_preserve_one_filled_square(self) -> None:
        cfg = config()
        dense_left = np.asarray(
            [
                [float(x), float(y)]
                for x in np.arange(0.0, 0.500001, 0.02)
                for y in np.arange(0.0, 1.000001, 0.02)
            ]
        )
        sparse_right = np.asarray(
            [
                [float(x), float(y)]
                for x in np.arange(0.5, 1.000001, 0.10)
                for y in np.arange(0.0, 1.000001, 0.10)
            ]
        )
        sparse_full = np.asarray(
            [
                [float(x), float(y)]
                for x in np.arange(0.0, 1.000001, 0.10)
                for y in np.arange(0.0, 1.000001, 0.10)
            ]
        )
        dense_center = np.asarray(
            [
                [float(x), float(y)]
                for x in np.arange(0.3, 0.700001, 0.02)
                for y in np.arange(0.3, 0.700001, 0.02)
            ]
        )
        for xy in (
            np.unique(np.vstack((dense_left, sparse_right)), axis=0),
            np.unique(np.vstack((sparse_full, dense_center)), axis=0),
        ):
            area, evidence, _indexes = surfaces._robust_xy_footprint_area(
                xy,
                maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                np=np,
            )
            self.assertAlmostEqual(1.0, area, places=10)
            self.assertEqual(
                1, evidence["acceptedTriangleConnectedComponentCount"]
            )
            np.testing.assert_allclose(
                evidence["authoritativeComponentAreaCentroidXYMeters"],
                [0.5, 0.5],
                atol=1e-10,
            )
            self.assertEqual(
                "edge length must not exceed the sum of both endpoint 2-D support radii",
                evidence["mutualLocalEdgeRule"],
            )

    def test_remote_ambiguous_sampling_patch_cannot_erase_larger_clear_floor(self) -> None:
        cfg = config()
        clear_values = np.arange(0.0, 1.000001, 0.10)
        clear = np.asarray(
            [[float(x), float(y)] for x in clear_values for y in clear_values]
        )
        first_patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.02, 0.15, 3)
                for y in np.linspace(0.15, 0.85, 5)
            ]
        )
        second_patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.20, 0.85, 5)
                for y in np.linspace(0.02, 0.25, 3)
            ]
        )
        remote_ambiguous = np.vstack((first_patch, second_patch)) + np.asarray(
            [4.0, 4.0]
        )
        area, evidence, indexes = surfaces._robust_xy_footprint_area(
            np.vstack((clear, remote_ambiguous)),
            maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
            minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
            density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
            metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        self.assertAlmostEqual(1.0, area, places=10)
        self.assertEqual(1, evidence["ambiguousProvisionalComponentCount"])
        self.assertFalse(
            evidence["ambiguousProvisionalComponentCouldBeAuthoritative"]
        )
        self.assertEqual(
            "provisional local Delaunay component",
            evidence["topologyAmbiguityScope"],
        )
        selected = np.vstack((clear, remote_ambiguous))[indexes]
        self.assertLessEqual(float(np.max(selected)), 1.0)

    def test_larger_ambiguous_component_cannot_be_silently_discarded(self) -> None:
        cfg = config()
        clear_values = np.arange(0.0, 0.400001, 0.05)
        clear = np.asarray(
            [[float(x), float(y)] for x in clear_values for y in clear_values]
        )
        first_patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.02, 0.15, 3)
                for y in np.linspace(0.15, 0.85, 5)
            ]
        )
        second_patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.20, 0.85, 5)
                for y in np.linspace(0.02, 0.25, 3)
            ]
        )
        ambiguous = np.vstack((first_patch, second_patch)) + np.asarray([4.0, 4.0])
        area, evidence, indexes = surfaces._robust_xy_footprint_area(
            np.vstack((clear, ambiguous)),
            maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
            minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
            density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
            metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        self.assertEqual(0.0, area)
        self.assertEqual(0, indexes.size)
        self.assertTrue(
            evidence["ambiguousProvisionalComponentCouldBeAuthoritative"]
        )

    def test_circular_trace_plus_three_inner_points_remains_ambiguous(self) -> None:
        cfg = config()
        for point_count in (12, 19, 30):
            outer_angles = np.linspace(
                0.0, 2.0 * math.pi, point_count, endpoint=False
            )
            inner_angles = np.linspace(0.0, 2.0 * math.pi, 3, endpoint=False)
            base = np.vstack(
                (
                    np.column_stack(
                        (0.3 * np.cos(outer_angles), 0.3 * np.sin(outer_angles))
                    ),
                    np.column_stack(
                        (0.12 * np.cos(inner_angles), 0.12 * np.sin(inner_angles))
                    ),
                )
            )
            for yaw_degrees in (0.0, 37.1):
                angle = math.radians(yaw_degrees)
                rotation = np.asarray(
                    [
                        [math.cos(angle), -math.sin(angle)],
                        [math.sin(angle), math.cos(angle)],
                    ]
                )
                xy = base @ rotation.T + np.asarray([999.0, -999.0])
                area, evidence, indexes = surfaces._robust_xy_footprint_area(
                    xy,
                    maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                    minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                    density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                    metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                    np=np,
                )
                self.assertEqual(0.0, area)
                self.assertEqual(0, indexes.size)
                self.assertTrue(
                    evidence[
                        "circularBoundaryInsufficientInteriorSupportRejectedFailClosed"
                    ]
                )

    def test_noisy_circular_trace_plus_center_still_lacks_interior_support(self) -> None:
        cfg = config()
        angles = np.linspace(0.0, 2.0 * math.pi, 12, endpoint=False)
        ring = np.column_stack((0.3 * np.cos(angles), 0.3 * np.sin(angles)))
        ring[0, 0] += 2e-8
        xy = np.vstack((ring, np.zeros((1, 2), dtype=np.float64)))
        area, evidence, indexes = surfaces._robust_xy_footprint_area(
            xy,
            maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
            minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
            density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
            metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        self.assertEqual(0.0, area)
        self.assertEqual(0, indexes.size)
        self.assertTrue(
            evidence[
                "circularBoundaryInsufficientInteriorSupportRejectedFailClosed"
            ]
        )
        circular = evidence["parallelSamplingSeamEvidence"][
            "ambiguousComponents"
        ][0]["circularBoundaryInteriorSupportEvidence"]
        self.assertTrue(circular["approximatelyCircularBoundary"])
        self.assertFalse(circular["interiorSupportSufficient"])

    def test_circular_boundary_with_distributed_dense_interior_is_a_filled_surface(self) -> None:
        cfg = config()
        angles = np.linspace(0.0, 2.0 * math.pi, 12, endpoint=False)
        ring = np.column_stack((0.3 * np.cos(angles), 0.3 * np.sin(angles)))
        interior = np.asarray(
            [
                [float(x), float(y)]
                for x in np.arange(-0.20, 0.200001, 0.05)
                for y in np.arange(-0.20, 0.200001, 0.05)
                if x * x + y * y < 0.28**2
            ]
        )
        area, evidence, indexes = surfaces._robust_xy_footprint_area(
            np.vstack((ring, interior)),
            maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
            minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
            density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
            metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        self.assertAlmostEqual(0.27, area, places=10)
        self.assertEqual(ring.shape[0] + interior.shape[0], indexes.size)
        self.assertFalse(
            evidence[
                "circularBoundaryInsufficientInteriorSupportRejectedFailClosed"
            ]
        )

    def test_uneven_rows_are_reported_as_ambiguity_not_a_proven_slit(self) -> None:
        cfg = config()
        x_values = np.asarray(
            [0.0, 0.1, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1.0]
        )
        y_values = np.arange(0.0, 1.000001, 0.10)
        xy = np.asarray(
            [[float(x), float(y)] for x in x_values for y in y_values]
        )
        area, evidence, indexes = surfaces._robust_xy_footprint_area(
            xy,
            maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
            minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
            density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
            metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        self.assertEqual(0.0, area)
        self.assertEqual(0, indexes.size)
        self.assertTrue(
            evidence[
                "narrowGapOrSamplingIrregularityIsReportedAsAmbiguityNotPhysicalSlit"
            ]
        )
        reasons = evidence["parallelSamplingSeamEvidence"]["ambiguousComponents"][
            0
        ]["reasons"]
        self.assertIn(
            "narrow gap or sampling irregularity is topologically ambiguous",
            reasons,
        )

    def test_exact_duplicate_rows_cannot_manufacture_level_support(self) -> None:
        cfg = config()
        inventory, _ = surfaces.extract_structural_inventory(
            room(), config=cfg, np=np
        )
        xy = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.05, 0.50, 3)
                for y in np.linspace(0.05, 0.50, 3)
            ]
        )
        base = np.column_stack((xy, np.zeros(xy.shape[0])))
        duplicated = np.vstack((base, base[:3]))
        codes: list[str] = []
        for points in (base, duplicated):
            with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                surfaces._select_room_envelope_level(
                    points,
                    np.ones(points.shape[0]),
                    inventory.wall_planes,
                    role="floor",
                    config=cfg,
                    np=np,
                )
            codes.append(caught.exception.code)
        self.assertEqual(codes[0], codes[1])
        self.assertEqual("INVALID_HORIZONTAL_LEVEL_INPUT", codes[0])

    def test_nanometre_jittered_rows_cannot_manufacture_level_support(self) -> None:
        cfg = config()
        inventory, _ = surfaces.extract_structural_inventory(
            room(), config=cfg, np=np
        )
        xy = np.asarray(
            [
                [float(x), float(y)]
                for x in (0.05, 0.20, 0.35, 0.50)
                for y in (0.05, 0.275, 0.50)
                if (x, y) != (0.20, 0.275)
            ],
            dtype=np.float64,
        )
        base = np.column_stack((xy, np.zeros(xy.shape[0])))
        near_duplicate = base[0].copy()
        near_duplicate[0] += 1e-8
        jittered = np.vstack((base, near_duplicate))
        for role, z_shift in (("floor", 0.0), ("ceiling", 3.0)):
            points = jittered.copy()
            points[:, 2] += z_shift
            for permutation in (
                np.arange(points.shape[0]),
                np.asarray([11, 3, 7, 1, 9, 5, 0, 10, 2, 8, 4, 6]),
            ):
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces._select_room_envelope_level(
                        points[permutation],
                        np.ones(points.shape[0]),
                        inventory.wall_planes,
                        role=role,
                        config=cfg,
                        np=np,
                    )
                self.assertEqual("INVALID_HORIZONTAL_LEVEL_INPUT", caught.exception.code)

    def test_asymmetric_exact_window_keeps_eligible_level(self) -> None:
        values = np.asarray([0.0] * 4 + [0.12] * 8, dtype=np.float64)
        for role in ("floor", "ceiling"):
            level, _mad, evidence = surfaces._dominant_horizontal_level(
                values,
                np.ones(values.size),
                role=role,
                config=config(),
                np=np,
            )
            self.assertAlmostEqual(0.06, level, places=12)
            self.assertEqual(12, evidence["supportCount"])
            self.assertLessEqual(
                evidence["p95AbsoluteResidualMeters"],
                config().horizontal_level_max_residual_m + 1e-12,
            )

    def test_density_ramp_never_returns_members_outside_residual_cap(self) -> None:
        cfg = config()
        values = np.concatenate(
            [
                np.full(max(1, int(1 + index / 20)), index / 1000.0)
                for index in range(700)
            ]
        )
        for role in ("floor", "ceiling"):
            modes, _evidence = surfaces._extract_horizontal_level_modes(
                values,
                np.ones(values.size),
                role=role,
                config=cfg,
                np=np,
            )
            for mode in modes:
                residuals = np.abs(values[mode.point_indices] - mode.level_m)
                self.assertGreaterEqual(mode.support_count, cfg.horizontal_level_min_support_count)
                self.assertLessEqual(
                    float(np.max(residuals)),
                    cfg.horizontal_level_max_residual_m
                    + cfg.metric_boundary_comparison_epsilon_m,
                )

    def test_unqualified_extreme_band_cannot_hide_real_room_boundary(self) -> None:
        cfg = config()
        surface_set = room()
        inventory, _ = surfaces.extract_structural_inventory(
            surface_set, config=cfg, np=np
        )
        room_xy = surface_set.points[
            surface_set.labels == surfaces.LABEL_FLOOR, :2
        ]
        remote_xy = np.column_stack(
            (np.linspace(20.0, 21.1, 12), np.full(12, 20.0))
        )
        for role, remote_z, boundary_z, interior_z in (
            ("floor", -0.18, 0.0, 0.30),
            ("ceiling", 3.18, 3.0, 2.70),
        ):
            points = np.vstack(
                (
                    np.column_stack(
                        (remote_xy, np.full(remote_xy.shape[0], remote_z))
                    ),
                    np.column_stack(
                        (room_xy, np.full(room_xy.shape[0], boundary_z))
                    ),
                    np.column_stack(
                        (room_xy, np.full(room_xy.shape[0], interior_z))
                    ),
                )
            )
            level, _mad, evidence = surfaces._select_room_envelope_level(
                points,
                np.ones(points.shape[0]),
                inventory.wall_planes,
                role=role,
                allow_multiple_ceiling_levels=(role == "ceiling"),
                config=cfg,
                np=np,
            )
            self.assertAlmostEqual(boundary_z, level, places=12)
            returned_levels = [
                row["levelMeters"] for row in evidence["supportedDistinctLevels"]
            ]
            self.assertTrue(any(abs(value - boundary_z) <= 1e-12 for value in returned_levels))
            self.assertFalse(
                evidence["supportedZWindowCanBeSilentlyRemovedBeforeSpatialQualification"]
            )

    def test_exact_duplicate_rows_cannot_manufacture_full_inventory(self) -> None:
        cfg = config()
        points: list[list[float]] = []
        normals: list[list[float]] = []
        labels: list[int] = []

        def add(rows: list[list[float]], normal: list[float], label: int) -> None:
            points.extend(rows)
            normals.extend([normal] * len(rows))
            labels.extend([label] * len(rows))

        x_wall = [
            [0.0, y, z]
            for y in (0.0, 0.375, 0.75)
            for z in (0.0, 3.0)
        ]
        y_wall = [
            [x, 0.0, z]
            for x in (0.0, 0.375, 0.75)
            for z in (0.0, 3.0)
        ]
        add(
            x_wall + x_wall,
            [1.0, 0.0, 0.0],
            surfaces.LABEL_WALL,
        )
        add(
            y_wall + y_wall,
            [0.0, 1.0, 0.0],
            surfaces.LABEL_WALL,
        )
        xy = [
            [x, y]
            for x in (0.0, 0.225, 0.45)
            for y in (0.0, 0.225, 0.45)
        ]
        floor = [[x, y, 0.0] for x, y in xy]
        ceiling = [[x, y, 3.0] for x, y in xy]
        add(
            floor + floor[:3],
            [0.0, 0.0, 1.0],
            surfaces.LABEL_FLOOR,
        )
        add(
            ceiling + ceiling[:3],
            [0.0, 0.0, 1.0],
            surfaces.LABEL_CEILING,
        )
        point_array = np.asarray(points, dtype=np.float64)
        surface_set = surfaces.SurfaceSet(
            point_array,
            np.asarray(normals, dtype=np.float64),
            np.asarray(labels, dtype=np.int8),
            np.ones(point_array.shape[0], dtype=np.float64),
        )
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces.extract_structural_inventory(
                surface_set, config=cfg, np=np
            )
        self.assertEqual(
            "INSUFFICIENT_DISTINCT_WALL_GEOMETRY",
            caught.exception.code,
        )

    def test_flipped_normal_duplicates_cannot_manufacture_wall_support(self) -> None:
        cfg = config()
        x_wall = np.asarray(
            [
                [0.0, y, z]
                for y in (0.0, 0.375, 0.75)
                for z in (0.0, 3.0)
            ],
            dtype=np.float64,
        )
        y_wall = np.asarray(
            [
                [x, 0.0, z]
                for x in (0.0, 0.375, 0.75)
                for z in (0.0, 3.0)
            ],
            dtype=np.float64,
        )
        horizontal_xy = np.asarray(
            [
                [x, y]
                for x in np.linspace(0.0, 0.45, 4)
                for y in np.linspace(0.0, 0.45, 4)
            ],
            dtype=np.float64,
        )
        floor = np.column_stack(
            (horizontal_xy, np.zeros(horizontal_xy.shape[0]))
        )
        ceiling = np.column_stack(
            (horizontal_xy, np.full(horizontal_xy.shape[0], 3.0))
        )
        points = np.vstack((x_wall, x_wall, y_wall, y_wall, floor, ceiling))
        normals = np.vstack(
            (
                np.tile([1.0, 0.0, 0.0], (x_wall.shape[0], 1)),
                np.tile([-1.0, 0.0, 0.0], (x_wall.shape[0], 1)),
                np.tile([0.0, 1.0, 0.0], (y_wall.shape[0], 1)),
                np.tile([0.0, -1.0, 0.0], (y_wall.shape[0], 1)),
                np.tile([0.0, 0.0, 1.0], (floor.shape[0], 1)),
                np.tile([0.0, 0.0, 1.0], (ceiling.shape[0], 1)),
            )
        )
        labels = np.concatenate(
            (
                np.full(2 * x_wall.shape[0], surfaces.LABEL_WALL),
                np.full(2 * y_wall.shape[0], surfaces.LABEL_WALL),
                np.full(floor.shape[0], surfaces.LABEL_FLOOR),
                np.full(ceiling.shape[0], surfaces.LABEL_CEILING),
            )
        ).astype(np.int8)
        surface_set = surfaces.SurfaceSet(
            points,
            normals,
            labels,
            np.ones(points.shape[0]),
        )
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces.extract_structural_inventory(
                surface_set, config=cfg, np=np
            )
        self.assertEqual(
            "INSUFFICIENT_DISTINCT_WALL_GEOMETRY",
            caught.exception.code,
        )

    def test_nanometre_jittered_wall_rows_cannot_manufacture_inventory(self) -> None:
        cfg = config()
        tangent_positions = (0.0, 0.25, 0.50, 0.75)
        x_wall = np.asarray(
            [[0.0, y, z] for y in tangent_positions for z in (0.0, 3.0)],
            dtype=np.float64,
        )
        y_wall = np.asarray(
            [[x, 0.0, z] for x in tangent_positions for z in (0.0, 3.0)],
            dtype=np.float64,
        )
        jittered_x_wall = x_wall.copy()
        jittered_x_wall[:, 1] += 1e-8
        jittered_y_wall = y_wall.copy()
        jittered_y_wall[:, 0] += 1e-8
        horizontal_xy = np.asarray(
            [
                [float(x), float(y)]
                for x in (0.0, 0.15, 0.30, 0.45)
                for y in (0.0, 0.15, 0.30, 0.45)
            ]
        )
        floor = np.column_stack(
            (horizontal_xy, np.zeros(horizontal_xy.shape[0]))
        )
        ceiling = np.column_stack(
            (horizontal_xy, np.full(horizontal_xy.shape[0], 3.0))
        )
        for add_jittered_copies in (False, True):
            wall_chunks = [x_wall, y_wall]
            wall_normal_chunks = [
                np.tile([1.0, 0.0, 0.0], (x_wall.shape[0], 1)),
                np.tile([0.0, 1.0, 0.0], (y_wall.shape[0], 1)),
            ]
            if add_jittered_copies:
                wall_chunks.extend((jittered_x_wall, jittered_y_wall))
                wall_normal_chunks.extend(
                    (
                        np.tile([1.0, 0.0, 0.0], (jittered_x_wall.shape[0], 1)),
                        np.tile([0.0, 1.0, 0.0], (jittered_y_wall.shape[0], 1)),
                    )
                )
            wall_points = np.vstack(wall_chunks)
            points = np.vstack((wall_points, floor, ceiling))
            normals = np.vstack(
                (
                    *wall_normal_chunks,
                    np.tile([0.0, 0.0, 1.0], (floor.shape[0], 1)),
                    np.tile([0.0, 0.0, 1.0], (ceiling.shape[0], 1)),
                )
            )
            labels = np.concatenate(
                (
                    np.full(wall_points.shape[0], surfaces.LABEL_WALL),
                    np.full(floor.shape[0], surfaces.LABEL_FLOOR),
                    np.full(ceiling.shape[0], surfaces.LABEL_CEILING),
                )
            ).astype(np.int8)
            surface_set = surfaces.SurfaceSet(
                points,
                normals,
                labels,
                np.ones(points.shape[0]),
            )
            with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                surfaces.extract_structural_inventory(
                    surface_set, config=cfg, np=np
                )
            self.assertEqual(
                "INSUFFICIENT_DISTINCT_WALL_GEOMETRY",
                caught.exception.code,
            )

    def test_near_coincident_wall_normal_family_inventory_is_rigid_yaw_and_permutation_invariant(self) -> None:
        cfg = config()
        clean = room()
        clean_inventory, clean_evidence = surfaces.extract_structural_inventory(
            clean, config=cfg, np=np
        )
        wall_mask = clean.labels == surfaces.LABEL_WALL
        horizontal_mask = ~wall_mask

        def two_wall_normal_copies(delta_degrees: float) -> np.ndarray:
            angle = math.radians(delta_degrees)
            rotation = np.asarray(
                [
                    [math.cos(angle), -math.sin(angle)],
                    [math.sin(angle), math.cos(angle)],
                ]
            )
            rows = clean.normals[wall_mask].copy()
            rows[:, :2] = rows[:, :2] @ rotation.T
            return rows

        # The two measurements at every physical wall position differ by
        # 19.9 degrees: just inside the configured 0.94 dot-product family.
        # They therefore represent one physical vote, even when a global yaw
        # puts one canonical normal on each side of the X-axis sign boundary.
        attacked_points = np.vstack(
            (
                clean.points[wall_mask],
                clean.points[wall_mask],
                clean.points[horizontal_mask],
            )
        )
        attacked_normals = np.vstack(
            (
                two_wall_normal_copies(1.0),
                two_wall_normal_copies(20.9),
                clean.normals[horizontal_mask],
            )
        )
        attacked_labels = np.concatenate(
            (
                clean.labels[wall_mask],
                clean.labels[wall_mask],
                clean.labels[horizontal_mask],
            )
        )
        attacked_weights = np.ones(attacked_points.shape[0], dtype=np.float64)

        def inventory_signature(
            inventory: surfaces.StructuralInventory,
            inverse_rotation_xy: np.ndarray,
        ) -> list[tuple[np.ndarray, float, int, float, float, float]]:
            rows: list[tuple[np.ndarray, float, int, float, float, float]] = []
            for plane in inventory.wall_planes:
                normal, offset = surfaces._canonical_xy_plane(
                    inverse_rotation_xy @ plane.normal_xy,
                    plane.offset_m,
                    np=np,
                )
                rows.append(
                    (
                        normal,
                        float(offset),
                        plane.support_count,
                        plane.support_area_proxy_m2,
                        plane.tangent_range_m[1] - plane.tangent_range_m[0],
                        plane.residual_p95_m,
                    )
                )
            rows.sort(
                key=lambda row: (
                    round(float(row[0][0]), 10),
                    round(float(row[0][1]), 10),
                    row[1],
                )
            )
            return rows

        expected_signature: list[
            tuple[np.ndarray, float, int, float, float, float]
        ] | None = None
        expected_unassigned_wall_fraction: float | None = None
        row_count = attacked_points.shape[0]
        identity_order = np.arange(row_count, dtype=np.int64)
        cases = (
            (0.0, identity_order),
            (0.0, identity_order[::-1]),
            (73.0, np.random.default_rng(1733).permutation(row_count)),
            (73.0, identity_order[::-1]),
            (179.0, np.random.default_rng(1735).permutation(row_count)),
            (179.0, identity_order),
        )
        for yaw_degrees, order in cases:
            with self.subTest(
                yaw_degrees=yaw_degrees,
                first_input_row=int(order[0]),
            ):
                angle = math.radians(yaw_degrees)
                rotation_xy = np.asarray(
                    [
                        [math.cos(angle), -math.sin(angle)],
                        [math.sin(angle), math.cos(angle)],
                    ]
                )
                points = attacked_points.copy()
                normals = attacked_normals.copy()
                points[:, :2] = points[:, :2] @ rotation_xy.T
                normals[:, :2] = normals[:, :2] @ rotation_xy.T
                candidate = surfaces.SurfaceSet(
                    points[order],
                    normals[order],
                    attacked_labels[order],
                    attacked_weights[order],
                )
                inventory, evidence = surfaces.extract_structural_inventory(
                    candidate, config=cfg, np=np
                )
                physical = evidence["wallSurfacePhysicalDeduplication"]
                self.assertEqual(
                    clean_evidence["rawWallSurfaceCountAfterExactRowDeduplication"],
                    physical["physicalWallSurfaceCount"],
                )
                self.assertEqual(0, physical["ambiguousNormalComponentsOmitted"])
                actual_signature = inventory_signature(inventory, rotation_xy.T)
                if expected_signature is None:
                    expected_signature = actual_signature
                    expected_unassigned_wall_fraction = (
                        inventory.unassigned_wall_fraction
                    )
                assert expected_unassigned_wall_fraction is not None
                self.assertEqual(len(expected_signature), len(actual_signature))
                for expected, actual in zip(
                    expected_signature, actual_signature, strict=True
                ):
                    np.testing.assert_allclose(actual[0], expected[0], atol=1e-10)
                    self.assertAlmostEqual(actual[1], expected[1], delta=1e-10)
                    self.assertEqual(actual[2], expected[2])
                    np.testing.assert_allclose(actual[3:], expected[3:], atol=1e-10)
                self.assertAlmostEqual(
                    clean_inventory.floor_z_m, inventory.floor_z_m, delta=1e-12
                )
                self.assertAlmostEqual(
                    clean_inventory.ceiling_z_m, inventory.ceiling_z_m, delta=1e-12
                )
                self.assertAlmostEqual(
                    expected_unassigned_wall_fraction,
                    inventory.unassigned_wall_fraction,
                    delta=1e-12,
                )

    def test_transitive_near_coincident_wall_normal_chain_is_omitted_fail_closed(self) -> None:
        cfg = config()
        base_points = np.zeros((3, 3), dtype=np.float64)
        identity_order = np.arange(3, dtype=np.int64)
        orders = (identity_order, identity_order[::-1], np.asarray([1, 2, 0]))
        for yaw_degrees, order in zip((0.0, 73.0, 179.0), orders, strict=True):
            with self.subTest(yaw_degrees=yaw_degrees):
                axial_angles = [
                    math.radians(value + yaw_degrees) for value in (1.0, 20.0, 39.0)
                ]
                canonical_normals = np.vstack(
                    [
                        surfaces._canonical_xy_plane(
                            np.asarray([math.cos(angle), math.sin(angle)]),
                            0.0,
                            np=np,
                        )[0]
                        for angle in axial_angles
                    ]
                )
                indexes, working_points, working_normals, evidence = (
                    surfaces._physical_wall_representative_indexes(
                        base_points[order],
                        canonical_normals[order],
                        distance_tolerance_m=cfg.horizontal_level_point_dedup_tolerance_m,
                        comparison_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                        minimum_normal_dot=cfg.plane_normal_min_abs_dot,
                        np=np,
                    )
                )
                self.assertEqual(0, indexes.size)
                self.assertEqual((0, 3), working_points.shape)
                self.assertEqual((0, 2), working_normals.shape)
                self.assertEqual(0, evidence["physicalWallSurfaceCount"])
                self.assertEqual(1, evidence["ambiguousNormalComponentsOmitted"])

    def test_wall_physical_distance_boundary_is_rigid_yaw_invariant(self) -> None:
        rows = np.asarray([[0.0, 0.0, 0.0], [1.0001e-5, 0.0, 0.0]])
        normals = np.tile(np.asarray([1.0, 0.0]), (rows.shape[0], 1))
        for yaw_degrees in (0.0, 2.0, 73.0, 179.0):
            with self.subTest(yaw_degrees=yaw_degrees):
                angle = math.radians(yaw_degrees)
                rotation = np.asarray(
                    [
                        [math.cos(angle), -math.sin(angle)],
                        [math.sin(angle), math.cos(angle)],
                    ]
                )
                rotated_rows = rows.copy()
                rotated_rows[:, :2] = rotated_rows[:, :2] @ rotation.T
                rotated_normals = normals @ rotation.T
                _indexes, working_points, _working_normals, evidence = (
                    surfaces._physical_wall_representative_indexes(
                        rotated_rows,
                        rotated_normals,
                        distance_tolerance_m=1e-5,
                        comparison_epsilon_m=1e-9,
                        minimum_normal_dot=0.94,
                        np=np,
                    )
                )
                self.assertEqual(1, evidence["physicalWallSurfaceCount"])
                self.assertEqual(0, evidence["ambiguousSpatialComponentsOmitted"])
                np.testing.assert_allclose(
                    working_points[0, :2] @ rotation,
                    [5.0005e-6, 0.0],
                    atol=1e-15,
                )

    def test_transitive_near_coincident_wall_position_chain_is_omitted_fail_closed(self) -> None:
        rows = np.asarray(
            [[0.0, 0.0, 0.0], [8e-6, 0.0, 0.0], [16e-6, 0.0, 0.0]]
        )
        normals = np.tile(np.asarray([1.0, 0.0]), (rows.shape[0], 1))
        indexes, working_points, working_normals, evidence = (
            surfaces._physical_wall_representative_indexes(
                rows,
                normals,
                distance_tolerance_m=1e-5,
                comparison_epsilon_m=1e-9,
                minimum_normal_dot=0.94,
                np=np,
            )
        )
        self.assertEqual(0, indexes.size)
        self.assertEqual((0, 3), working_points.shape)
        self.assertEqual((0, 2), working_normals.shape)
        self.assertEqual(1, evidence["ambiguousSpatialComponentsOmitted"])
        self.assertEqual(1, evidence["ambiguousComponentsOmitted"])

    def test_wall_physical_deduplication_rejects_nonfinite_tolerances(self) -> None:
        rows = np.zeros((2, 3), dtype=np.float64)
        normals = np.tile(np.asarray([1.0, 0.0]), (rows.shape[0], 1))
        invalid_cases = (
            {"distance_tolerance_m": float("nan")},
            {"distance_tolerance_m": float("inf")},
            {"comparison_epsilon_m": float("nan")},
            {"comparison_epsilon_m": float("inf")},
            {"minimum_normal_dot": float("nan")},
            {"minimum_normal_dot": float("inf")},
        )
        for replacement in invalid_cases:
            with self.subTest(replacement=replacement):
                arguments = {
                    "distance_tolerance_m": 1e-5,
                    "comparison_epsilon_m": 1e-9,
                    "minimum_normal_dot": 0.94,
                }
                arguments.update(replacement)
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces._physical_wall_representative_indexes(
                        rows, normals, np=np, **arguments
                    )
                self.assertEqual(
                    "INVALID_PHYSICAL_WALL_DEDUPLICATION", caught.exception.code
                )

    def test_plane_extraction_rejects_nonfinite_primary_thresholds(self) -> None:
        invalid_cases = (
            {"plane_normal_min_abs_dot": float("nan")},
            {"plane_max_point_residual_m": float("inf")},
            {"plane_min_support_fraction": float("nan")},
            {"horizontal_level_point_dedup_tolerance_m": float("inf")},
            {"metric_boundary_comparison_epsilon_m": float("nan")},
        )
        for replacement in invalid_cases:
            with self.subTest(replacement=replacement):
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces.extract_structural_inventory(
                        room(), config=replace(config(), **replacement), np=np
                    )
                self.assertEqual("INVALID_PLANE_CONFIG", caught.exception.code)

    def test_exact_max_edge_is_stable_after_large_translation(self) -> None:
        cfg = config()
        triangle = np.asarray(
            [
                [0.0, 0.0],
                [0.8, 0.0],
                [0.4, 0.4 * math.sqrt(3.0)],
            ]
        )
        areas: list[float] = []
        for xy in (triangle, triangle + np.asarray([1e6, -1e6])):
            area, _evidence, _component_indexes = surfaces._robust_xy_footprint_area(
                xy,
                maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                np=np,
            )
            areas.append(area)
        self.assertGreater(areas[0], cfg.horizontal_level_min_footprint_area_m2)
        np.testing.assert_allclose(areas, [0.16 * math.sqrt(3.0)] * 2, atol=1e-9)

    def test_equal_footprint_components_stay_ambiguous_after_rigid_motion(self) -> None:
        cfg = config()
        first = np.asarray([[0.0, 0.0], [0.8, 0.0], [0.4, 0.35]])
        local_yaw = math.radians(7.0)
        local_rotation = np.asarray(
            [
                [math.cos(local_yaw), -math.sin(local_yaw)],
                [math.sin(local_yaw), math.cos(local_yaw)],
            ]
        )
        points = np.vstack(
            (first, first @ local_rotation.T + np.asarray([3.0, 2.0]))
        )
        yaw = math.radians(2.0)
        rotation = np.asarray(
            [
                [math.cos(yaw), -math.sin(yaw)],
                [math.sin(yaw), math.cos(yaw)],
            ]
        )
        for candidate in (
            points,
            points @ rotation.T + np.asarray([10000.0, -7310.0]),
        ):
            area, evidence, component_indexes = surfaces._robust_xy_footprint_area(
                candidate,
                maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                np=np,
            )
            self.assertEqual(0.0, area)
            self.assertTrue(
                evidence["authoritativeLargestComponentSelectionAmbiguous"]
            )
            self.assertEqual(
                2, evidence["acceptedTriangleConnectedComponentCount"]
            )
            self.assertEqual(0, component_indexes.size)

    def test_cocircular_diagonal_choice_is_rigid_motion_invariant(self) -> None:
        cfg = config()
        radius = 0.8 / (2.0 * math.sin(math.radians(65.0)))
        angles = np.radians(np.asarray([0.0, 60.0, 130.0, 240.0]))
        points = np.column_stack(
            (radius * np.cos(angles), radius * np.sin(angles))
        )
        areas: list[float] = []
        for yaw_degrees, translation in (
            (0.0, np.zeros(2)),
            (23.75, np.zeros(2)),
            (23.75, np.asarray([999.0, -999.0])),
        ):
            yaw = math.radians(yaw_degrees)
            rotation = np.asarray(
                [
                    [math.cos(yaw), -math.sin(yaw)],
                    [math.sin(yaw), math.cos(yaw)],
                ]
            )
            candidate = points @ rotation.T + translation
            area, evidence, _component_indexes = surfaces._robust_xy_footprint_area(
                candidate,
                maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
                minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
                density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
                metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                np=np,
            )
            self.assertFalse(evidence["iterativeCocircularFlipsUsed"])
            areas.append(area)
        self.assertGreater(areas[0], cfg.horizontal_level_min_footprint_area_m2)
        np.testing.assert_allclose(areas, [areas[0]] * 3, atol=1e-9)

    def test_dense_l_shaped_boundary_still_does_not_count_as_filled_area(self) -> None:
        cfg = config()
        horizontal = np.arange(0.05, 6.0001, 0.10)
        vertical = np.arange(0.05, 4.0001, 0.10)
        xy = np.vstack(
            (
                np.column_stack((horizontal, np.full(horizontal.size, 0.05))),
                np.column_stack((np.full(vertical.size, 0.05), vertical)),
            )
        )
        area, evidence, _component_indexes = surfaces._robust_xy_footprint_area(
            xy,
            maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
            minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
            density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
            metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        self.assertLess(area, cfg.horizontal_level_min_footprint_area_m2)
        self.assertLessEqual(area, 0.08 + 1e-12)
        self.assertGreater(
            evidence["rejectedForSubresolutionAltitudeCount"]
            + evidence["cocircularLocalQuadRejectedTriangleCount"],
            0,
        )
        self.assertEqual(0.20, evidence["minimumAcceptedTriangleQuality"])

        inventory, _ = surfaces.extract_structural_inventory(room(), config=cfg, np=np)
        points = np.column_stack((xy, np.full(xy.shape[0], 3.0)))
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                points,
                np.ones(points.shape[0]),
                inventory.wall_planes,
                role="ceiling",
                allow_multiple_ceiling_levels=True,
                config=cfg,
                np=np,
            )
        self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)

    def test_disconnected_small_patches_cannot_add_up_to_one_ceiling(self) -> None:
        cfg = config()
        first_patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.05, 0.35, 7)
                for y in np.linspace(1.10, 1.40, 7)
            ]
        )
        second_patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(3.35, 3.65, 7)
                for y in np.linspace(0.05, 0.35, 7)
            ]
        )
        xy = np.vstack((first_patch, second_patch))
        area, evidence, component_indexes = surfaces._robust_xy_footprint_area(
            xy,
            maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
            minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
            density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
            metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        self.assertEqual(2, evidence["acceptedTriangleConnectedComponentCount"])
        self.assertAlmostEqual(
            0.18,
            evidence["acceptedLocalTriangleAreaSumSquareMetersSensitivityOnly"],
            places=12,
        )
        self.assertTrue(evidence["authoritativeLargestComponentSelectionAmbiguous"])
        self.assertEqual(0.0, area)
        self.assertEqual(0, component_indexes.size)

        inventory, _ = surfaces.extract_structural_inventory(room(), config=cfg, np=np)
        points = np.column_stack((xy, np.full(xy.shape[0], 3.0)))
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                points,
                np.ones(points.shape[0]),
                inventory.wall_planes,
                role="ceiling",
                allow_multiple_ceiling_levels=True,
                config=cfg,
                np=np,
            )
        self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)

    def test_wall_contact_must_belong_to_authoritative_footprint_component(self) -> None:
        cfg = config()
        interior = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(3.0, 3.5, 15)
                for y in np.linspace(3.0, 3.5, 15)
            ]
        )
        first_trace = np.column_stack(
            (np.full(9, 0.05), np.linspace(1.0, 1.5, 9))
        )
        second_trace = np.column_stack(
            (np.linspace(3.3, 3.7, 9), np.full(9, 0.05))
        )
        xy = np.vstack((interior, first_trace, second_trace))
        area, evidence, component_indexes = surfaces._robust_xy_footprint_area(
            xy,
            maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
            minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
            density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
            metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        self.assertAlmostEqual(0.25, area, places=12)
        self.assertEqual(18, evidence["nonAuthoritativeInputPointCount"])
        self.assertEqual(interior.shape[0], component_indexes.size)

        inventory, _ = surfaces.extract_structural_inventory(room(), config=cfg, np=np)
        points = np.column_stack((xy, np.full(xy.shape[0], 3.0)))
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                points,
                np.ones(points.shape[0]),
                inventory.wall_planes,
                role="ceiling",
                allow_multiple_ceiling_levels=True,
                config=cfg,
                np=np,
            )
        self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)

    def test_rejected_skinny_trace_triangles_cannot_expand_wall_contact(self) -> None:
        cfg = config()
        patch = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.55, 1.05, 15)
                for y in np.linspace(0.55, 1.05, 15)
            ]
        )
        first_trace = np.column_stack(
            (np.full(61, 0.05), np.linspace(0.55, 1.05, 61))
        )
        second_trace = np.column_stack(
            (np.linspace(0.55, 1.05, 61), np.full(61, 0.05))
        )
        xy = np.vstack((patch, first_trace, second_trace))
        area, evidence, component_indexes = surfaces._robust_xy_footprint_area(
            xy,
            maximum_triangle_edge_m=cfg.horizontal_level_footprint_max_triangle_edge_m,
            minimum_triangle_quality=cfg.horizontal_level_footprint_min_triangle_quality,
            density_sliver_max_width_m=cfg.horizontal_level_footprint_density_sliver_max_width_m,
            metric_boundary_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        self.assertAlmostEqual(0.25, area, places=10)
        self.assertTrue(
            evidence[
                "wallContactPointsRestrictedToAuthoritativeAcceptedOrSameComponentDensitySliverVertices"
            ]
        )
        self.assertGreater(
            evidence["rejectedTriangleCountForInsufficientShapeQuality"], 0
        )
        self.assertLess(component_indexes.size, xy.shape[0])

        inventory, _ = surfaces.extract_structural_inventory(
            room(), config=cfg, np=np
        )
        inset = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.8, 6.2, 15)
                for y in np.linspace(0.8, 4.2, 15)
            ]
        )
        sparse_first_trace = np.column_stack(
            (np.full(9, 0.05), np.linspace(0.9, 1.4, 9))
        )
        sparse_second_trace = np.column_stack(
            (np.linspace(3.2, 3.7, 9), np.full(9, 0.05))
        )
        attacked_xy = np.vstack(
            (inset, sparse_first_trace, sparse_second_trace)
        )
        attacked_points = np.column_stack(
            (attacked_xy, np.full(attacked_xy.shape[0], 3.0))
        )
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                attacked_points,
                np.ones(attacked_points.shape[0]),
                inventory.wall_planes,
                role="ceiling",
                allow_multiple_ceiling_levels=True,
                config=cfg,
                np=np,
            )
        self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)

    def test_isolated_high_wall_points_do_not_poison_room_height_consensus(self) -> None:
        cfg = config()
        base = room()
        extra_points = np.asarray([[0.0, 2.0, 8.0], [2.0, 0.0, 8.0]])
        augmented = surfaces.SurfaceSet(
            np.vstack((base.points, extra_points)),
            np.vstack((base.normals, np.asarray([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]))),
            np.concatenate(
                (base.labels, np.asarray([surfaces.LABEL_WALL, surfaces.LABEL_WALL], dtype=np.int8))
            ),
            np.ones(base.points.shape[0] + extra_points.shape[0]),
        )
        inventory, _ = surfaces.extract_structural_inventory(
            augmented,
            config=cfg,
            np=np,
        )
        self.assertAlmostEqual(0.0, inventory.floor_z_m, delta=0.01)
        self.assertAlmostEqual(3.0, inventory.ceiling_z_m, delta=0.01)

    def test_density_equalized_local_wall_endpoint_ignores_dense_midwall_samples(self) -> None:
        cfg = config()
        tangent_values = np.linspace(0.0, 4.0, 27)
        z_values = np.linspace(0.0, 3.0, 7)
        base = np.asarray(
            [
                [0.0, float(tangent), float(z)]
                for tangent in tangent_values
                for z in z_values
            ],
            dtype=np.float64,
        )
        base_segments = surfaces._wall_tangent_segments(
            base,
            base[:, 1],
            config=cfg,
            np=np,
        )
        dense_tangent = np.linspace(0.0, 4.0, 5000)
        dense_midwall = np.column_stack(
            (
                np.zeros(dense_tangent.size),
                dense_tangent,
                1.5 + 0.02 * np.sin(dense_tangent * 17.0),
            )
        )
        augmented = np.vstack((base, dense_midwall))
        augmented_segments = surfaces._wall_tangent_segments(
            augmented,
            augmented[:, 1],
            config=cfg,
            np=np,
        )
        self.assertEqual(1, len(base_segments))
        self.assertEqual(1, len(augmented_segments))
        np.testing.assert_allclose(
            base_segments[0].robust_z_range_m,
            augmented_segments[0].robust_z_range_m,
            atol=1e-12,
        )
        self.assertEqual(
            base_segments[0].endpoint_column_count,
            augmented_segments[0].endpoint_column_count,
        )
        np.testing.assert_allclose(base_segments[0].robust_z_range_m, [0.0, 3.0])

    def test_short_full_height_wall_fragments_are_not_room_boundaries(self) -> None:
        cfg = config()
        positive_positions = (0.005, 0.155, 0.305)
        negative_positions = (-0.305, -0.155, -0.005)
        short_positive = replace(
            self._parallel_wall_patch(60, 0.0, cfg).tangent_segments[0],
            tangent_range_m=(0.0, 0.31),
            raw_point_count=21,
            distinct_tangent_position_count=3,
            endpoint_column_count=3,
            lower_endpoint_support_tangent_positions_m=positive_positions,
            upper_endpoint_support_tangent_positions_m=positive_positions,
        )
        short_negative = replace(
            short_positive,
            tangent_range_m=(-0.31, 0.0),
            lower_endpoint_support_tangent_positions_m=negative_positions,
            upper_endpoint_support_tangent_positions_m=negative_positions,
        )
        first = replace(
            self._parallel_wall_patch(60, 0.0, cfg),
            tangent_range_m=(0.0, 0.31),
            tangent_segments=(short_positive,),
        )
        second = replace(
            self._parallel_wall_patch(61, 0.0, cfg),
            normal_xy=np.asarray([0.0, 1.0]),
            tangent_range_m=(-0.31, 0.0),
            tangent_segments=(short_negative,),
        )
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._boundary_wall_profiles((first, second), config=cfg, np=np)
        self.assertEqual("INSUFFICIENT_BOUNDARY_WALL_GEOMETRY", caught.exception.code)

    def test_disconnected_same_plane_height_cannot_be_borrowed_across_gap(self) -> None:
        cfg = config()

        def segment(
            segment_id: int,
            low: float,
            high: float,
            upper_z: float,
        ) -> surfaces.WallTangentSegment:
            positions = tuple(float(value) for value in np.linspace(low + 0.075, high - 0.075, 13))
            return surfaces.WallTangentSegment(
                segment_id=segment_id,
                tangent_range_m=(low, high),
                raw_point_count=91,
                distinct_tangent_position_count=13,
                endpoint_column_count=13,
                robust_z_range_m=(0.0, upper_z),
                typical_vertical_sampling_gap_m=0.15,
                lower_endpoint_support_tangent_positions_m=positions,
                upper_endpoint_support_tangent_positions_m=positions,
            )

        first = replace(
            self._parallel_wall_patch(70, 0.0, cfg),
            tangent_range_m=(0.0, 6.0),
            tangent_segments=(segment(0, 0.0, 2.0, 2.4), segment(1, 4.0, 6.0, 3.0)),
        )
        second = replace(
            self._parallel_wall_patch(71, 0.0, cfg),
            normal_xy=np.asarray([0.0, 1.0]),
            tangent_range_m=(-6.0, 0.0),
            tangent_segments=(
                segment(0, -2.0, 0.0, 2.4),
                segment(1, -6.0, -4.0, 3.0),
            ),
        )
        xy = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.05, 1.95, 17)
                for y in np.linspace(0.05, 1.95, 17)
            ]
        )
        points = np.column_stack((xy, np.full(xy.shape[0], 3.0)))
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                points,
                np.ones(points.shape[0]),
                (first, second),
                role="ceiling",
                allow_multiple_ceiling_levels=True,
                config=cfg,
                np=np,
            )
        self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)

    def test_dense_lower_mode_does_not_change_valid_top_gate(self) -> None:
        cfg = config()
        base = room()
        inventory, _ = surfaces.extract_structural_inventory(base, config=cfg, np=np)
        top = base.points[base.labels == surfaces.LABEL_CEILING].copy()
        dense_lower_xy = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.2, 6.8, 70)
                for y in np.linspace(0.2, 4.8, 55)
            ]
        )
        dense_lower = np.column_stack(
            (dense_lower_xy, np.full(dense_lower_xy.shape[0], 2.0))
        )
        points = np.vstack((top, dense_lower))
        level, _mad, evidence = surfaces._select_room_envelope_level(
            points,
            np.ones(points.shape[0]),
            inventory.wall_planes,
            role="ceiling",
            allow_multiple_ceiling_levels=True,
            config=cfg,
            np=np,
        )
        self.assertAlmostEqual(3.0, level, delta=0.01)
        selected = evidence["supportedDistinctLevels"][evidence["selectedDistinctLevelIndex"]]
        self.assertTrue(selected["usedForFixedScaleGate"])
        self.assertTrue(evidence["horizontalFootprint"]["authoritativeGateIndependentOfOtherModeAreas"])

    def test_highest_ceiling_mode_is_reserved_when_candidate_limit_is_full(self) -> None:
        cfg = config()
        base = room()
        inventory, _ = surfaces.extract_structural_inventory(base, config=cfg, np=np)
        room_xy = base.points[base.labels == surfaces.LABEL_CEILING, :2]
        true_top = np.column_stack((room_xy, np.full(room_xy.shape[0], 3.0)))
        dense_wrong = np.vstack(
            (
                np.column_stack((room_xy, np.full(room_xy.shape[0], 2.6))),
                np.column_stack((room_xy, np.full(room_xy.shape[0], 2.6))),
            )
        )
        remote_xy = np.asarray(
            [
                [100.0 + float(x), 200.0 + float(y)]
                for x in np.linspace(0.0, 2.4, 13)
                for y in np.linspace(0.0, 1.8, 10)
            ]
        )
        clutter = np.vstack(
            [
                np.column_stack((remote_xy, np.full(remote_xy.shape[0], z)))
                for z in (0.3, 0.6, 0.9, 1.2, 1.5, 1.8)
            ]
        )
        points = np.vstack((true_top, dense_wrong, clutter))
        level, _mad, evidence = surfaces._select_room_envelope_level(
            points,
            np.ones(points.shape[0]),
            inventory.wall_planes,
            role="ceiling",
            allow_multiple_ceiling_levels=True,
            config=cfg,
            np=np,
        )
        self.assertAlmostEqual(3.0, level, delta=0.01)
        self.assertTrue(evidence["candidateTraversalIndependentOfRawSupportRanking"])
        self.assertEqual("highest_to_lowest", evidence["candidateTraversalRoleOrder"])
        self.assertAlmostEqual(3.0, evidence["firstRoleExtremeLevelMeters"], delta=0.01)
        self.assertTrue(evidence["candidateCountLimitReached"])
        self.assertFalse(evidence["potentialAdditionalSupportedBasinRemainsAfterLimit"])

    def test_lowest_floor_mode_is_reserved_when_candidate_limit_is_full(self) -> None:
        cfg = config()
        base = room()
        inventory, _ = surfaces.extract_structural_inventory(base, config=cfg, np=np)
        room_xy = base.points[base.labels == surfaces.LABEL_FLOOR, :2]
        true_floor = np.column_stack((room_xy, np.zeros(room_xy.shape[0])))
        dense_wrong = np.vstack(
            (
                np.column_stack((room_xy, np.full(room_xy.shape[0], 0.4))),
                np.column_stack((room_xy, np.full(room_xy.shape[0], 0.4))),
            )
        )
        remote_xy = np.asarray(
            [
                [100.0 + float(x), 200.0 + float(y)]
                for x in np.linspace(0.0, 2.4, 13)
                for y in np.linspace(0.0, 1.8, 10)
            ]
        )
        clutter = np.vstack(
            [
                np.column_stack((remote_xy, np.full(remote_xy.shape[0], z)))
                for z in (0.7, 1.0, 1.3, 1.6, 1.9, 2.2)
            ]
        )
        points = np.vstack((true_floor, dense_wrong, clutter))
        level, _mad, evidence = surfaces._select_room_envelope_level(
            points,
            np.ones(points.shape[0]),
            inventory.wall_planes,
            role="floor",
            config=cfg,
            np=np,
        )
        self.assertAlmostEqual(0.0, level, delta=0.01)
        self.assertTrue(evidence["candidateTraversalIndependentOfRawSupportRanking"])
        self.assertEqual("lowest_to_highest", evidence["candidateTraversalRoleOrder"])
        self.assertAlmostEqual(0.0, evidence["firstRoleExtremeLevelMeters"], delta=0.01)
        self.assertTrue(evidence["supportFractionIsDescriptiveOnly"])

    def test_unexamined_ninth_supported_level_fails_closed_for_both_roles(self) -> None:
        cfg = config()
        base = room()
        inventory, _ = surfaces.extract_structural_inventory(base, config=cfg, np=np)
        remote_xy = np.asarray(
            [
                [100.0 + float(x), 200.0 + float(y)]
                for x in np.linspace(0.0, 2.4, 13)
                for y in np.linspace(0.0, 1.8, 10)
            ]
        )
        for role, true_level, wrong_level, extreme_level, clutter_levels in (
            ("ceiling", 3.0, 2.6, 4.0, (0.3, 0.6, 0.9, 1.2, 1.5, 1.8)),
            ("floor", 0.0, 0.4, -1.0, (0.7, 1.0, 1.3, 1.6, 1.9, 2.2)),
        ):
            with self.subTest(role=role):
                label = (
                    surfaces.LABEL_CEILING
                    if role == "ceiling"
                    else surfaces.LABEL_FLOOR
                )
                room_xy = base.points[base.labels == label, :2]
                true_room_level = np.column_stack(
                    (room_xy, np.full(room_xy.shape[0], true_level))
                )
                dense_wrong_level = np.vstack(
                    (
                        np.column_stack(
                            (room_xy, np.full(room_xy.shape[0], wrong_level))
                        ),
                        np.column_stack(
                            (room_xy, np.full(room_xy.shape[0], wrong_level))
                        ),
                    )
                )
                zero_area_extreme = np.column_stack(
                    (
                        np.linspace(
                            50.0,
                            51.1,
                            cfg.horizontal_level_min_support_count,
                        ),
                        np.full(
                            cfg.horizontal_level_min_support_count, 50.0
                        ),
                        np.full(
                            cfg.horizontal_level_min_support_count,
                            extreme_level,
                        ),
                    )
                )
                clutter = np.vstack(
                    [
                        np.column_stack(
                            (
                                remote_xy,
                                np.full(remote_xy.shape[0], clutter_level),
                            )
                        )
                        for clutter_level in clutter_levels
                    ]
                )
                points = np.vstack(
                    (
                        zero_area_extreme,
                        true_room_level,
                        dense_wrong_level,
                        clutter,
                    )
                )
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces._select_room_envelope_level(
                        points,
                        np.ones(points.shape[0]),
                        inventory.wall_planes,
                        role=role,
                        allow_multiple_ceiling_levels=role == "ceiling",
                        config=cfg,
                        np=np,
                    )
                self.assertEqual(
                    "HORIZONTAL_LEVEL_CANDIDATE_BUDGET_EXHAUSTED",
                    caught.exception.code,
                )

    def test_exact_endpoint_mode_prevents_higher_mode_from_borrowing_endpoint(self) -> None:
        cfg = config()
        first = self._parallel_wall_patch(80, 0.0, cfg)
        negative_positions = tuple(
            float(value) for value in np.linspace(-3.925, -0.075, 27)
        )
        second_segment = replace(
            first.tangent_segments[0],
            tangent_range_m=(-4.0, 0.0),
            lower_endpoint_support_tangent_positions_m=negative_positions,
            upper_endpoint_support_tangent_positions_m=negative_positions,
        )
        second = replace(
            self._parallel_wall_patch(81, 0.0, cfg),
            normal_xy=np.asarray([0.0, 1.0]),
            tangent_range_m=(-4.0, 0.0),
            tangent_segments=(second_segment,),
        )
        xy = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.05, 3.95, 17)
                for y in np.linspace(0.05, 3.95, 17)
            ]
        )
        points = np.vstack(
            (
                np.column_stack((xy, np.full(xy.shape[0], 2.925))),
                np.column_stack((xy, np.full(xy.shape[0], 3.145))),
            )
        )
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                points,
                np.ones(points.shape[0]),
                (first, second),
                role="ceiling",
                allow_multiple_ceiling_levels=True,
                config=cfg,
                np=np,
            )
        self.assertEqual(
            "HIGHER_CEILING_BAND_INSUFFICIENT_BOUNDARY_SUPPORT",
            caught.exception.code,
        )

    def test_contact_threshold_is_stable_after_yaw_and_large_translation(self) -> None:
        cfg = replace(
            config(),
            horizontal_level_min_footprint_area_m2=0.01,
            horizontal_level_min_support_count=4,
            horizontal_level_min_wall_contact_points=2,
            horizontal_level_min_wall_contact_total_coverage_m=0.30,
            horizontal_level_min_wall_contact_contiguous_coverage_m=0.30,
        )
        positive_positions = (0.05, 0.20, 0.95)
        negative_positions = (-0.95, -0.20, -0.05)
        first_segment = replace(
            self._parallel_wall_patch(90, 0.0, cfg).tangent_segments[0],
            tangent_range_m=(0.0, 1.0),
            raw_point_count=21,
            distinct_tangent_position_count=3,
            endpoint_column_count=3,
            lower_endpoint_support_tangent_positions_m=positive_positions,
            upper_endpoint_support_tangent_positions_m=positive_positions,
        )
        second_segment = replace(
            first_segment,
            tangent_range_m=(-1.0, 0.0),
            lower_endpoint_support_tangent_positions_m=negative_positions,
            upper_endpoint_support_tangent_positions_m=negative_positions,
        )
        walls = (
            replace(
                self._parallel_wall_patch(90, 0.0, cfg),
                tangent_range_m=(0.0, 1.0),
                tangent_segments=(first_segment,),
            ),
            replace(
                self._parallel_wall_patch(91, 0.0, cfg),
                normal_xy=np.asarray([0.0, 1.0]),
                tangent_range_m=(-1.0, 0.0),
                tangent_segments=(second_segment,),
            ),
        )
        xy = np.repeat(
            np.asarray(
                [[0.05, 0.05], [0.05, 0.20], [0.20, 0.05], [0.20, 0.20]]
            ),
            3,
            axis=0,
        )
        points = np.column_stack((xy, np.full(xy.shape[0], 2.925)))
        original_level, _mad, original_evidence = surfaces._select_room_envelope_level(
            points,
            np.ones(points.shape[0]),
            walls,
            role="ceiling",
            allow_multiple_ceiling_levels=True,
            config=cfg,
            np=np,
        )

        angle = math.radians(31.0)
        rotation_xy = np.asarray(
            [[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]]
        )
        translation_xy = np.asarray([1000.0, -1000.0])

        def transform_wall(wall: surfaces.WallPlanePatch) -> surfaces.WallPlanePatch:
            transformed_normal = rotation_xy @ wall.normal_xy
            transformed_tangent = np.asarray(
                [-transformed_normal[1], transformed_normal[0]]
            )
            tangent_shift = float(transformed_tangent @ translation_xy)
            transformed_segments = tuple(
                replace(
                    item,
                    tangent_range_m=(
                        item.tangent_range_m[0] + tangent_shift,
                        item.tangent_range_m[1] + tangent_shift,
                    ),
                    lower_endpoint_support_tangent_positions_m=tuple(
                        value + tangent_shift
                        for value in item.lower_endpoint_support_tangent_positions_m
                    ),
                    upper_endpoint_support_tangent_positions_m=tuple(
                        value + tangent_shift
                        for value in item.upper_endpoint_support_tangent_positions_m
                    ),
                )
                for item in wall.tangent_segments
            )
            return replace(
                wall,
                normal_xy=transformed_normal,
                offset_m=float(wall.offset_m + transformed_normal @ translation_xy),
                tangent_range_m=(
                    wall.tangent_range_m[0] + tangent_shift,
                    wall.tangent_range_m[1] + tangent_shift,
                ),
                tangent_segments=transformed_segments,
            )

        transformed_xy = points[:, :2] @ rotation_xy.T + translation_xy
        transformed_points = np.column_stack((transformed_xy, points[:, 2]))
        transformed_level, _mad, transformed_evidence = surfaces._select_room_envelope_level(
            transformed_points,
            np.ones(transformed_points.shape[0]),
            tuple(transform_wall(wall) for wall in walls),
            role="ceiling",
            allow_multiple_ceiling_levels=True,
            config=cfg,
            np=np,
        )
        self.assertAlmostEqual(original_level, transformed_level, places=12)
        original_selected = original_evidence["supportedDistinctLevels"][0]
        transformed_selected = transformed_evidence["supportedDistinctLevels"][0]
        self.assertEqual(
            original_selected["qualifiedAsBoundarySupportedLevel"],
            transformed_selected["qualifiedAsBoundarySupportedLevel"],
        )
        np.testing.assert_allclose(
            sorted(
                row["spatialContactLongestContiguousCoverageMeters"]
                for row in original_selected["wallEndpointSupport"]
                if row["supportsBoundaryQualification"]
            ),
            [0.30, 0.30],
            atol=1e-12,
        )
        np.testing.assert_allclose(
            sorted(
                row["spatialContactLongestContiguousCoverageMeters"]
                for row in transformed_selected["wallEndpointSupport"]
                if row["supportsBoundaryQualification"]
            ),
            [0.30, 0.30],
            atol=1e-10,
        )

    def test_disconnected_wall_tangent_gap_cannot_fake_spatial_contact(self) -> None:
        cfg = config()
        remote_columns = tuple(range(-675, -666)) + tuple(range(666, 675))
        occupied_cells = frozenset(
            (column, z_cell)
            for column in remote_columns
            for z_cell in range(20)
        )
        first = replace(
            self._parallel_wall_patch(30, 0.0, cfg),
            occupied_cells=occupied_cells,
            support_count=len(occupied_cells),
            tangent_range_m=(-101.25, 101.25),
            tangent_segments=(
                surfaces.WallTangentSegment(
                    segment_id=0,
                    tangent_range_m=(-101.25, -99.9),
                    raw_point_count=180,
                    distinct_tangent_position_count=9,
                    endpoint_column_count=9,
                    robust_z_range_m=(0.0, 2.925),
                    typical_vertical_sampling_gap_m=0.15,
                    lower_endpoint_support_tangent_positions_m=tuple(
                        float(value) for value in np.linspace(-101.175, -99.975, 9)
                    ),
                    upper_endpoint_support_tangent_positions_m=tuple(
                        float(value) for value in np.linspace(-101.175, -99.975, 9)
                    ),
                ),
                surfaces.WallTangentSegment(
                    segment_id=1,
                    tangent_range_m=(99.9, 101.25),
                    raw_point_count=180,
                    distinct_tangent_position_count=9,
                    endpoint_column_count=9,
                    robust_z_range_m=(0.0, 2.925),
                    typical_vertical_sampling_gap_m=0.15,
                    lower_endpoint_support_tangent_positions_m=tuple(
                        float(value) for value in np.linspace(99.975, 101.175, 9)
                    ),
                    upper_endpoint_support_tangent_positions_m=tuple(
                        float(value) for value in np.linspace(99.975, 101.175, 9)
                    ),
                ),
            ),
        )
        second = replace(
            self._parallel_wall_patch(31, 0.0, cfg),
            normal_xy=np.asarray([0.0, 1.0]),
            occupied_cells=occupied_cells,
            support_count=len(occupied_cells),
            tangent_range_m=(-101.25, 101.25),
            tangent_segments=first.tangent_segments,
        )
        xy = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.05, 1.0, 9)
                for y in np.linspace(0.05, 1.0, 9)
            ]
        )
        points = np.column_stack((xy, np.full(xy.shape[0], 2.925)))
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                points,
                np.ones(points.shape[0]),
                (first, second),
                role="ceiling",
                allow_multiple_ceiling_levels=True,
                config=cfg,
                np=np,
            )
        self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)

    def test_parallel_walls_on_same_side_do_not_bracket_ceiling_footprint(self) -> None:
        cfg = config()
        profiles = [
            {"plane": self._parallel_wall_patch(40, 0.0, cfg)},
            {"plane": self._parallel_wall_patch(41, 2.0, cfg)},
        ]
        accepted, evidence = surfaces._well_separated_parallel_support(
            profiles,
            anchor_xy=np.asarray([4.0, 2.0]),
            config=cfg,
            np=np,
        )
        self.assertFalse(accepted)
        self.assertFalse(evidence[0]["wallsBracketFootprintAnchor"])

    def test_sparse_wall_sampling_cannot_expand_endpoint_tolerance_beyond_cap(self) -> None:
        cfg = config()
        sparse_cells = frozenset(
            (tangent_cell, z_cell)
            for tangent_cell in range(27)
            for z_cell in (0, 10, 20)
        )
        sparse_positive_segment = replace(
            self._parallel_wall_patch(50, 0.0, cfg).tangent_segments[0],
            robust_z_range_m=(0.0, 2.5),
            typical_vertical_sampling_gap_m=1.5,
        )
        sparse_negative_segment = replace(
            sparse_positive_segment,
            tangent_range_m=(-4.0, 0.0),
            lower_endpoint_support_tangent_positions_m=tuple(
                float(value) for value in np.linspace(-3.925, -0.075, 27)
            ),
            upper_endpoint_support_tangent_positions_m=tuple(
                float(value) for value in np.linspace(-3.925, -0.075, 27)
            ),
        )
        first = replace(
            self._parallel_wall_patch(50, 0.0, cfg),
            occupied_cells=sparse_cells,
            support_count=len(sparse_cells),
            robust_z_range_m=(0.0, 2.5),
            tangent_segments=(sparse_positive_segment,),
        )
        second = replace(
            self._parallel_wall_patch(51, 0.0, cfg),
            normal_xy=np.asarray([0.0, 1.0]),
            occupied_cells=sparse_cells,
            support_count=len(sparse_cells),
            tangent_range_m=(-4.0, 0.0),
            tangent_segments=(sparse_negative_segment,),
            robust_z_range_m=(0.0, 2.5),
        )
        xy = np.asarray(
            [
                [float(x), float(y)]
                for x in np.linspace(0.05, 3.95, 17)
                for y in np.linspace(0.05, 3.95, 17)
            ]
        )
        points = np.vstack(
            (
                np.column_stack((xy, np.full(xy.shape[0], 2.5))),
                np.column_stack((xy, np.full(xy.shape[0], 3.0))),
            )
        )
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces._select_room_envelope_level(
                points,
                np.ones(points.shape[0]),
                (first, second),
                role="ceiling",
                allow_multiple_ceiling_levels=True,
                config=cfg,
                np=np,
            )
        # The 3.0 m band is 0.5 m above the local wall endpoint.  Sparse wall
        # sampling cannot expand the hard 0.45 m endpoint cap, and a broad
        # unsupported higher band must block selecting the lower 2.5 m band.
        self.assertEqual(
            "HIGHER_CEILING_BAND_INSUFFICIENT_BOUNDARY_SUPPORT",
            caught.exception.code,
        )

    def test_plane_matching_entrypoints_reject_malformed_config_cleanly(self) -> None:
        surface_set = room()
        base_config = config()
        inventory, _ = surfaces.extract_structural_inventory(
            surface_set, config=base_config, np=np
        )
        seed_ids = tuple(plane.plane_id for plane in inventory.wall_planes[:2])
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), seed_ids, seed_ids, False
        )
        invalid_replacements = (
            {"plane_max_height_mismatch_m": float("nan")},
            {"metric_boundary_comparison_epsilon_m": float("inf")},
            {"angular_boundary_comparison_epsilon": float("nan")},
            {"plane_min_pair_angle_degrees": 0.0},
            {"plane_min_pair_angle_degrees": 5e-324},
            {"plane_hypothesis_normal_tolerance_degrees": float("inf")},
            {"plane_match_normal_tolerance_degrees": 90.0},
            {"plane_match_max_offset_m": float("nan")},
            {"plane_occupancy_cell_m": float("inf")},
            {"plane_occupancy_cell_m": 5e-324},
            {"plane_occupancy_dilation_cells": True},
            {"plane_occupancy_dilation_cells": 1.5},
            {"plane_occupancy_dilation_cells": 17},
            {"plane_min_occupied_cells": True},
            {"plane_min_occupied_cells": 0},
        )
        for replacement in invalid_replacements:
            malformed = replace(base_config, **replacement)
            with self.subTest(entrypoint="generate", replacement=replacement):
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces.generate_plane_pair_hypotheses(
                        inventory,
                        inventory,
                        mirrored=False,
                        config=malformed,
                        np=np,
                    )
                self.assertEqual("INVALID_PLANE_CONFIG", caught.exception.code)
            with self.subTest(entrypoint="score", replacement=replacement):
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces._score_plane_hypothesis(
                        surface_set,
                        surface_set,
                        inventory,
                        inventory,
                        hypothesis,
                        full_patch_score=False,
                        config=malformed,
                        linear_sum_assignment=linear_sum_assignment,
                        np=np,
                        cKDTree=cKDTree,
                    )
                self.assertEqual("INVALID_PLANE_CONFIG", caught.exception.code)

    def test_plane_matching_entrypoints_reject_malformed_inventory_cleanly(self) -> None:
        surface_set = room()
        cfg = config()
        inventory, _ = surfaces.extract_structural_inventory(
            surface_set, config=cfg, np=np
        )
        seed_ids = tuple(plane.plane_id for plane in inventory.wall_planes[:2])
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), seed_ids, seed_ids, False
        )
        planes = list(inventory.wall_planes)

        def with_first_plane(**changes: object) -> surfaces.StructuralInventory:
            changed = list(planes)
            changed[0] = replace(changed[0], **changes)
            return replace(inventory, wall_planes=tuple(changed))

        duplicate_id_planes = list(planes)
        duplicate_id_planes[1] = replace(
            duplicate_id_planes[1], plane_id=duplicate_id_planes[0].plane_id
        )
        duplicate_equation_planes = list(planes)
        duplicate_equation_planes[1] = replace(
            duplicate_equation_planes[1],
            normal_xy=duplicate_equation_planes[0].normal_xy.copy(),
            offset_m=duplicate_equation_planes[0].offset_m,
        )
        malformed_inventories = {
            "nonfinite_floor": replace(inventory, floor_z_m=float("nan")),
            "nonfinite_ceiling": replace(inventory, ceiling_z_m=float("inf")),
            "overflowing_height": replace(
                inventory,
                floor_z_m=-1e308,
                ceiling_z_m=1e308,
                ceiling_levels_m=(1e308,),
            ),
            "negative_floor_mad": replace(inventory, floor_level_mad_m=-1.0),
            "bad_unassigned_fraction": replace(inventory, unassigned_wall_fraction=2.0),
            "empty_ceiling_sequence": replace(inventory, ceiling_levels_m=()),
            "mismatched_ceiling_evidence": replace(
                inventory, ceiling_level_mads_m=()
            ),
            "boolean_ceiling_level": replace(
                inventory, ceiling_levels_m=(True,)
            ),
            "nonunit_plane_normal": with_first_plane(
                normal_xy=np.asarray([2.0, 0.0])
            ),
            "nonnumeric_plane_normal": with_first_plane(normal_xy="bad"),
            "nonfinite_plane_offset": with_first_plane(offset_m=float("nan")),
            "nonpositive_plane_area": with_first_plane(support_area_proxy_m2=0.0),
            "duplicate_plane_ids": replace(
                inventory, wall_planes=tuple(duplicate_id_planes)
            ),
            "duplicate_plane_equations": replace(
                inventory, wall_planes=tuple(duplicate_equation_planes)
            ),
        }
        for reason, malformed in malformed_inventories.items():
            with self.subTest(entrypoint="generate", reason=reason):
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces.generate_plane_pair_hypotheses(
                        malformed,
                        inventory,
                        mirrored=False,
                        config=cfg,
                        np=np,
                    )
                self.assertEqual(
                    "INVALID_PLANE_HYPOTHESIS_INPUT", caught.exception.code
                )
            with self.subTest(entrypoint="score", reason=reason):
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces._score_plane_hypothesis(
                        surface_set,
                        surface_set,
                        malformed,
                        inventory,
                        hypothesis,
                        full_patch_score=False,
                        config=cfg,
                        linear_sum_assignment=linear_sum_assignment,
                        np=np,
                        cKDTree=cKDTree,
                    )
                self.assertEqual("INVALID_PLANE_SCORE_INPUT", caught.exception.code)

    def test_top_envelope_hard_cap_boundary_is_not_noise_relaxed(self) -> None:
        base_inventory, _ = surfaces.extract_structural_inventory(
            room(), config=config(), np=np
        )
        passing = replace(
            base_inventory,
            ceiling_z_m=3.149,
            ceiling_levels_m=(3.149,),
            ceiling_level_mads_m=(1.0,),
        )
        _hypotheses, evidence = surfaces.generate_plane_pair_hypotheses(
            base_inventory,
            passing,
            mirrored=False,
            config=config(),
            np=np,
        )
        self.assertAlmostEqual(0.149, evidence["topEnvelopeHeightDifferenceMeters"])

        failing = replace(
            base_inventory,
            ceiling_z_m=3.151,
            ceiling_levels_m=(3.151,),
            ceiling_level_mads_m=(1.0,),
        )
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces.generate_plane_pair_hypotheses(
                base_inventory,
                failing,
                mirrored=False,
                config=config(),
                np=np,
            )
        self.assertEqual("FIXED_SCALE_HEIGHT_MISMATCH", caught.exception.code)

    def test_exact_height_cap_is_stable_after_large_z_origin_shift(self) -> None:
        base_inventory, _ = surfaces.extract_structural_inventory(
            room(), config=config(), np=np
        )
        shifted_target = replace(
            base_inventory,
            floor_z_m=-259.15,
            ceiling_z_m=-255.99999999999997,
            ceiling_levels_m=(-255.99999999999997,),
            ceiling_level_mads_m=(0.0,),
        )
        _hypotheses, evidence = surfaces.generate_plane_pair_hypotheses(
            base_inventory,
            shifted_target,
            mirrored=False,
            config=config(),
            np=np,
        )
        self.assertAlmostEqual(
            0.15,
            evidence["topEnvelopeHeightDifferenceMeters"],
            places=12,
        )
        self.assertEqual(
            config().metric_boundary_comparison_epsilon_m,
            evidence["metricBoundaryComparisonEpsilonMeters"],
        )

    def test_exact_nonparallel_angle_boundary_is_rigid_rotation_invariant(self) -> None:
        cfg = config()
        angle = math.radians(cfg.plane_min_pair_angle_degrees)
        first = self._parallel_wall_patch(100, 0.0, cfg)
        second = replace(
            self._parallel_wall_patch(101, 1.0, cfg),
            normal_xy=np.asarray([math.cos(angle), math.sin(angle)]),
        )
        self.assertTrue(
            surfaces._has_nonparallel_supporting_walls(
                [{"plane": first}, {"plane": second}],
                config=cfg,
            )
        )
        yaw = math.radians(-179.5)
        rotation = np.asarray(
            [[math.cos(yaw), -math.sin(yaw)], [math.sin(yaw), math.cos(yaw)]]
        )
        rotated_first = replace(first, normal_xy=rotation @ first.normal_xy)
        rotated_second = replace(second, normal_xy=rotation @ second.normal_xy)
        self.assertTrue(
            surfaces._has_nonparallel_supporting_walls(
                [{"plane": rotated_first}, {"plane": rotated_second}],
                config=cfg,
            )
        )

    def test_exact_eight_degree_hypothesis_translation_is_origin_invariant(self) -> None:
        cfg = config()
        base_inventory, _ = surfaces.extract_structural_inventory(
            room(), config=cfg, np=np
        )
        source_first = self._parallel_wall_patch(0, 0.0, cfg)
        source_second = replace(
            self._parallel_wall_patch(1, 0.0, cfg),
            normal_xy=np.asarray([0.0, 1.0]),
        )
        target_first = self._parallel_wall_patch(10, 0.0, cfg)
        target_angle = math.radians(82.0)
        target_second = replace(
            self._parallel_wall_patch(11, 0.0, cfg),
            normal_xy=np.asarray(
                [math.cos(target_angle), math.sin(target_angle)]
            ),
        )
        source_inventory = replace(
            base_inventory, wall_planes=(source_first, source_second)
        )
        target_inventory = replace(
            base_inventory, wall_planes=(target_first, target_second)
        )

        def matching_candidate(
            inventory_source: surfaces.StructuralInventory,
            inventory_target: surfaces.StructuralInventory,
        ) -> surfaces.PlaneHypothesis:
            hypotheses, _evidence = surfaces.generate_plane_pair_hypotheses(
                inventory_source,
                inventory_target,
                mirrored=False,
                config=cfg,
                np=np,
            )
            return next(
                hypothesis
                for hypothesis in hypotheses
                if hypothesis.source_seed_plane_ids == (0, 1)
                and hypothesis.target_seed_plane_ids == (10, 11)
                and abs(hypothesis.yaw_radians) <= 1e-12
            )

        original = matching_candidate(source_inventory, target_inventory)
        np.testing.assert_allclose(original.translation[:2], [0.0, 0.0], atol=1e-12)

        common_origin_shift = np.asarray([999.0, 999.0])

        def shifted_plane(plane: surfaces.WallPlanePatch) -> surfaces.WallPlanePatch:
            return replace(
                plane,
                offset_m=float(
                    plane.offset_m + plane.normal_xy @ common_origin_shift
                ),
            )

        shifted_source = replace(
            source_inventory,
            wall_planes=tuple(
                shifted_plane(plane) for plane in source_inventory.wall_planes
            ),
        )
        shifted_target = replace(
            target_inventory,
            wall_planes=tuple(
                shifted_plane(plane) for plane in target_inventory.wall_planes
            ),
        )
        shifted = matching_candidate(shifted_source, shifted_target)
        np.testing.assert_allclose(shifted.translation[:2], [0.0, 0.0], atol=1e-9)

    def test_exact_plane_match_gate_uses_pair_local_origin_invariant_anchor(self) -> None:
        cfg = config()
        base_inventory, _ = surfaces.extract_structural_inventory(
            room(), config=cfg, np=np
        )

        def line_points(normal_xy: np.ndarray, offset_m: float) -> np.ndarray:
            tangent = np.asarray([-normal_xy[1], normal_xy[0]])
            rows = []
            for tangent_value in np.linspace(-1.0, 1.0, 6):
                xy = offset_m * normal_xy + tangent_value * tangent
                rows.extend(
                    ([float(xy[0]), float(xy[1]), z] for z in (0.0, 3.0))
                )
            return np.asarray(rows, dtype=np.float64)

        source_normals_xy = (
            np.asarray([1.0, 0.0]),
            np.asarray([0.0, 1.0]),
        )
        target_normals_xy = tuple(
            np.asarray(
                [math.cos(math.radians(angle)), math.sin(math.radians(angle))]
            )
            for angle in (10.0, 100.0)
        )
        source_patch_points = tuple(
            line_points(normal, 0.0) for normal in source_normals_xy
        )
        target_patch_points = tuple(
            line_points(normal, 0.35) for normal in target_normals_xy
        )

        def surfaces_and_inventory(
            patch_points: tuple[np.ndarray, np.ndarray],
            normals_xy: tuple[np.ndarray, np.ndarray],
            offsets: tuple[float, float],
        ) -> tuple[surfaces.SurfaceSet, surfaces.StructuralInventory]:
            points = np.vstack(patch_points)
            normals = np.vstack(
                [
                    np.tile(
                        [normal[0], normal[1], 0.0],
                        (rows.shape[0], 1),
                    )
                    for rows, normal in zip(
                        patch_points, normals_xy, strict=True
                    )
                ]
            )
            surface_set = surfaces.SurfaceSet(
                points,
                normals,
                np.full(points.shape[0], surfaces.LABEL_WALL, dtype=np.int8),
                np.ones(points.shape[0]),
            )
            patches = []
            start = 0
            for plane_id, (rows, normal, offset) in enumerate(
                zip(patch_points, normals_xy, offsets, strict=True)
            ):
                indexes = np.arange(start, start + rows.shape[0], dtype=np.int64)
                start += rows.shape[0]
                patches.append(
                    replace(
                        self._parallel_wall_patch(plane_id, offset, cfg),
                        normal_xy=normal,
                        offset_m=offset,
                        point_indices=indexes,
                    )
                )
            return surface_set, replace(
                base_inventory, wall_planes=tuple(patches)
            )

        source_surfaces, source_inventory = surfaces_and_inventory(
            source_patch_points, source_normals_xy, (0.0, 0.0)
        )
        target_surfaces, target_inventory = surfaces_and_inventory(
            target_patch_points, target_normals_xy, (0.35, 0.35)
        )
        hypothesis = surfaces.PlaneHypothesis(
            yaw_radians=0.0,
            translation=np.zeros(3),
            source_seed_plane_ids=(0, 1),
            target_seed_plane_ids=(0, 1),
            mirrored=False,
        )

        def score(
            source_set: surfaces.SurfaceSet,
            target_set: surfaces.SurfaceSet,
            source_inv: surfaces.StructuralInventory,
            target_inv: surfaces.StructuralInventory,
        ) -> float:
            value, evidence = surfaces._score_plane_hypothesis(
                source_set,
                target_set,
                source_inv,
                target_inv,
                hypothesis,
                full_patch_score=False,
                config=cfg,
                linear_sum_assignment=linear_sum_assignment,
                np=np,
                cKDTree=cKDTree,
            )
            self.assertTrue(evidence["assessable"])
            return value

        original_score = score(
            source_surfaces,
            target_surfaces,
            source_inventory,
            target_inventory,
        )
        # Stay comfortably inside the scorer's explicit 1 km numerical
        # domain while still exercising a very large common world shift.
        shift_xy = np.asarray([900.0, 900.0])

        def shifted(
            surface_set: surfaces.SurfaceSet,
            inventory: surfaces.StructuralInventory,
        ) -> tuple[surfaces.SurfaceSet, surfaces.StructuralInventory]:
            points = surface_set.points.copy()
            points[:, :2] += shift_xy
            shifted_set = surfaces.SurfaceSet(
                points,
                surface_set.normals,
                surface_set.labels,
                surface_set.weights,
            )
            shifted_inventory = replace(
                inventory,
                wall_planes=tuple(
                    replace(
                        plane,
                        offset_m=float(
                            plane.offset_m + plane.normal_xy @ shift_xy
                        ),
                    )
                    for plane in inventory.wall_planes
                ),
            )
            return shifted_set, shifted_inventory

        shifted_source_surfaces, shifted_source_inventory = shifted(
            source_surfaces, source_inventory
        )
        shifted_target_surfaces, shifted_target_inventory = shifted(
            target_surfaces, target_inventory
        )
        shifted_score = score(
            shifted_source_surfaces,
            shifted_target_surfaces,
            shifted_source_inventory,
            shifted_target_inventory,
        )
        self.assertAlmostEqual(original_score, shifted_score, places=10)

    def test_full_patch_occupancy_is_pair_local_and_origin_invariant(self) -> None:
        cfg = config()
        base_inventory, _ = surfaces.extract_structural_inventory(room(), config=cfg, np=np)
        u = np.asarray([0.02, 0.62, 1.22, 1.82, 2.42, 3.02])
        delta = 0.29
        tx, ty = 1.515, 1.485
        source_set, source_inventory = self._plane_score_fixture(
            (
                (0, np.asarray([1.0, 0.0]), 0.0, u),
                (1, np.asarray([0.0, 1.0]), 0.0, u),
            ),
            (0.0, 3.0),
            cfg=cfg,
            base_inventory=base_inventory,
        )
        target_set, target_inventory = self._plane_score_fixture(
            (
                (10, np.asarray([1.0, 0.0]), 0.0, u + delta),
                (11, np.asarray([0.0, 1.0]), 0.0, u + delta),
                (12, np.asarray([1.0, 0.0]), tx, u + ty + delta),
                (13, np.asarray([0.0, 1.0]), ty, u - tx + delta),
            ),
            (0.0, 3.0),
            cfg=cfg,
            base_inventory=base_inventory,
        )
        hypotheses = (
            surfaces.PlaneHypothesis(0.0, np.zeros(3), (0, 1), (10, 11), False),
            surfaces.PlaneHypothesis(
                0.0, np.asarray([tx, ty, 0.0]), (0, 1), (12, 13), False
            ),
        )

        def evaluate(
            source: surfaces.SurfaceSet,
            target: surfaces.SurfaceSet,
            source_inv: surfaces.StructuralInventory,
            target_inv: surfaces.StructuralInventory,
        ) -> list[float]:
            scores: list[float] = []
            for hypothesis in hypotheses:
                score, evidence = self._full_plane_score(
                    source, target, source_inv, target_inv, hypothesis, cfg
                )
                self.assertTrue(evidence["assessable"])
                self.assertEqual(2, evidence["occupancyAssessablePlaneCount"])
                self.assertAlmostEqual(1.0, evidence["occupancyF1"])
                scores.append(score)
            return scores

        original_scores = evaluate(
            source_set, target_set, source_inventory, target_inventory
        )
        self.assertAlmostEqual(0.1685, original_scores[0], places=12)
        self.assertAlmostEqual(original_scores[0], original_scores[1], places=12)
        shift_xy = np.asarray([0.015, -0.015])
        shift_z = 0.017

        def shifted(
            surface_set: surfaces.SurfaceSet,
            inventory: surfaces.StructuralInventory,
        ) -> tuple[surfaces.SurfaceSet, surfaces.StructuralInventory]:
            points = surface_set.points.copy()
            points[:, :2] += shift_xy
            points[:, 2] += shift_z
            return (
                surfaces.SurfaceSet(
                    points,
                    surface_set.normals,
                    surface_set.labels,
                    surface_set.weights,
                ),
                replace(
                    inventory,
                    wall_planes=tuple(
                        replace(
                            plane,
                            offset_m=float(plane.offset_m + plane.normal_xy @ shift_xy),
                            z_range_m=tuple(value + shift_z for value in plane.z_range_m),
                            robust_z_range_m=tuple(
                                value + shift_z for value in plane.robust_z_range_m
                            ),
                        )
                        for plane in inventory.wall_planes
                    ),
                    floor_z_m=inventory.floor_z_m + shift_z,
                    ceiling_z_m=inventory.ceiling_z_m + shift_z,
                    ceiling_levels_m=tuple(
                        value + shift_z for value in inventory.ceiling_levels_m
                    ),
                ),
            )

        shifted_source, shifted_source_inventory = shifted(source_set, source_inventory)
        shifted_target, shifted_target_inventory = shifted(target_set, target_inventory)
        shifted_scores = evaluate(
            shifted_source,
            shifted_target,
            shifted_source_inventory,
            shifted_target_inventory,
        )
        np.testing.assert_allclose(original_scores, shifted_scores, atol=1e-10)
        self.assertAlmostEqual(shifted_scores[0], shifted_scores[1], places=12)

    def test_plane_score_recovers_cheapest_independent_wall_assignment(self) -> None:
        cfg = config()
        base_inventory, _ = surfaces.extract_structural_inventory(
            room(), config=cfg, np=np
        )

        def normal(degrees: float) -> np.ndarray:
            angle = math.radians(degrees)
            return np.asarray([math.cos(angle), math.sin(angle)])

        tangent_values = np.asarray([-0.45, -0.15, 0.15, 0.45])
        source_set, source_inventory = self._plane_score_fixture(
            (
                (0, normal(0.0), 0.0, tangent_values),
                (1, normal(20.0), 0.1, tangent_values),
            ),
            (0.0, 0.45, 0.90),
            cfg=cfg,
            base_inventory=base_inventory,
        )
        target_set, target_inventory = self._plane_score_fixture(
            (
                (10, normal(10.0), 0.0, tangent_values),
                (11, normal(10.0), 0.1, tangent_values),
                (12, normal(30.0), 0.2, tangent_values),
            ),
            (0.0, 0.45, 0.90),
            cfg=cfg,
            base_inventory=base_inventory,
        )
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (10, 12), False
        )
        score, evidence = surfaces._score_plane_hypothesis(
            source_set,
            target_set,
            source_inventory,
            target_inventory,
            hypothesis,
            full_patch_score=False,
            config=cfg,
            linear_sum_assignment=linear_sum_assignment,
            np=np,
            cKDTree=cKDTree,
        )
        self.assertTrue(math.isfinite(score))
        self.assertTrue(evidence["assessable"])
        self.assertTrue(
            evidence["constrainedIndependentWallAssignmentRecoveryUsed"]
        )
        self.assertGreater(
            evidence["constrainedIndependentWallAssignmentCandidateCount"], 0
        )

    def test_plane_score_requires_independence_in_same_correspondence_pair(self) -> None:
        cfg = config()
        base_inventory, _ = surfaces.extract_structural_inventory(
            room(), config=cfg, np=np
        )

        def normal(degrees: float) -> np.ndarray:
            angle = math.radians(degrees)
            return np.asarray([math.cos(angle), math.sin(angle)])

        tangent_values = np.asarray([-0.45, -0.15, 0.15, 0.45])
        source_set, source_inventory = self._plane_score_fixture(
            (
                (0, normal(-10.0), 0.0, tangent_values),
                (1, normal(10.0), 0.1, tangent_values),
            ),
            (0.0, 0.45, 0.90),
            cfg=cfg,
            base_inventory=base_inventory,
        )
        target_set, target_inventory = self._plane_score_fixture(
            (
                (10, normal(-2.0), 0.0, tangent_values),
                (11, normal(2.0), 0.1, tangent_values),
            ),
            (0.0, 0.45, 0.90),
            cfg=cfg,
            base_inventory=base_inventory,
        )
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (10, 11), False
        )
        score, evidence = surfaces._score_plane_hypothesis(
            source_set,
            target_set,
            source_inventory,
            target_inventory,
            hypothesis,
            full_patch_score=False,
            config=cfg,
            linear_sum_assignment=linear_sum_assignment,
            np=np,
            cKDTree=cKDTree,
        )
        self.assertTrue(math.isinf(score))
        self.assertFalse(evidence["assessable"])
        self.assertEqual(
            "no matched correspondence pair contains independent wall directions in both source and target",
            evidence["reason"],
        )

    def test_full_patch_occupancy_survives_canonical_tangent_flip(self) -> None:
        cfg = config()
        base_inventory, _ = surfaces.extract_structural_inventory(room(), config=cfg, np=np)
        source_u = np.asarray([-0.45, -0.30])
        target_u = np.asarray([-0.45, -0.15, -0.075])
        z_values = (0.0, 0.45, 0.90)
        source_set, source_inventory = self._plane_score_fixture(
            (
                (0, np.asarray([1.0, 0.0]), 0.0, source_u),
                (1, np.asarray([0.0, 1.0]), 0.0, source_u),
            ),
            z_values,
            cfg=cfg,
            base_inventory=base_inventory,
        )
        target_set, target_inventory = self._plane_score_fixture(
            (
                (10, np.asarray([1.0, 0.0]), 0.0, target_u),
                (11, np.asarray([0.0, 1.0]), 0.0, target_u),
            ),
            z_values,
            cfg=cfg,
            base_inventory=base_inventory,
        )
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (10, 11), False
        )
        original_score, original_evidence = self._full_plane_score(
            source_set,
            target_set,
            source_inventory,
            target_inventory,
            hypothesis,
            cfg,
        )
        self.assertTrue(original_evidence["assessable"])
        self.assertAlmostEqual(1.0, original_evidence["occupancyF1"])
        angle = math.radians(100.0)
        rotation = np.asarray(
            [[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]]
        )

        def rotated_and_canonicalized(
            surface_set: surfaces.SurfaceSet,
            inventory: surfaces.StructuralInventory,
        ) -> tuple[surfaces.SurfaceSet, surfaces.StructuralInventory]:
            points = surface_set.points.copy()
            points[:, :2] = points[:, :2] @ rotation.T
            normals = surface_set.normals.copy()
            normals[:, :2] = normals[:, :2] @ rotation.T
            transformed_planes = []
            for plane in inventory.wall_planes:
                raw_normal = rotation @ plane.normal_xy
                normal, offset = surfaces._canonical_xy_plane(
                    raw_normal, plane.offset_m, np=np
                )
                self.assertAlmostEqual(-1.0, float(raw_normal @ normal), places=12)
                transformed_planes.append(
                    replace(plane, normal_xy=normal, offset_m=offset)
                )
            return (
                surfaces.SurfaceSet(
                    points, normals, surface_set.labels, surface_set.weights
                ),
                replace(inventory, wall_planes=tuple(transformed_planes)),
            )

        rotated_source, rotated_source_inventory = rotated_and_canonicalized(
            source_set, source_inventory
        )
        rotated_target, rotated_target_inventory = rotated_and_canonicalized(
            target_set, target_inventory
        )
        rotated_score, rotated_evidence = self._full_plane_score(
            rotated_source,
            rotated_target,
            rotated_source_inventory,
            rotated_target_inventory,
            hypothesis,
            cfg,
        )
        self.assertTrue(rotated_evidence["assessable"])
        self.assertAlmostEqual(1.0, rotated_evidence["occupancyF1"])
        self.assertAlmostEqual(original_score, rotated_score, places=12)

    def test_full_patch_score_fails_cleanly_for_empty_plane_patches(self) -> None:
        cfg = config()
        surface_set = room()
        inventory, _ = surfaces.extract_structural_inventory(surface_set, config=cfg, np=np)
        empty_inventory = replace(
            inventory,
            wall_planes=tuple(
                replace(plane, point_indices=np.empty(0, dtype=np.int64))
                for plane in inventory.wall_planes
            ),
        )
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (0, 1), False
        )
        for source_inventory, target_inventory in (
            (empty_inventory, inventory),
            (inventory, empty_inventory),
            (empty_inventory, empty_inventory),
        ):
            score, evidence = self._full_plane_score(
                surface_set,
                surface_set,
                source_inventory,
                target_inventory,
                hypothesis,
                cfg,
            )
            self.assertTrue(math.isinf(score))
            self.assertFalse(evidence["assessable"])
            self.assertGreater(evidence["emptyFullPatchPairCount"], 0)

    def test_plane_score_rejects_negative_or_nonfinite_support_area_cleanly(self) -> None:
        cfg = config()
        base_inventory, _ = surfaces.extract_structural_inventory(
            room(), config=cfg, np=np
        )
        tangent_values = np.asarray([-0.45, -0.15, 0.15, 0.45])
        specs = (
            (0, np.asarray([1.0, 0.0]), 0.0, tangent_values),
            (1, np.asarray([0.0, 1.0]), 0.0, tangent_values),
        )
        surface_set, inventory = self._plane_score_fixture(
            specs,
            (0.0, 0.45, 0.90),
            cfg=cfg,
            base_inventory=base_inventory,
        )
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (0, 1), False
        )

        def with_first_area(
            candidate: surfaces.StructuralInventory, value: float
        ) -> surfaces.StructuralInventory:
            planes = list(candidate.wall_planes)
            planes[0] = replace(planes[0], support_area_proxy_m2=value)
            return replace(candidate, wall_planes=tuple(planes))

        for side in ("source", "target"):
            for value in (-0.1, float("nan"), float("inf"), float("-inf")):
                with self.subTest(side=side, support_area_proxy_m2=value):
                    source_inventory = (
                        with_first_area(inventory, value)
                        if side == "source"
                        else inventory
                    )
                    target_inventory = (
                        with_first_area(inventory, value)
                        if side == "target"
                        else inventory
                    )
                    with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                        self._full_plane_score(
                            surface_set,
                            surface_set,
                            source_inventory,
                            target_inventory,
                            hypothesis,
                            cfg,
                        )
                    self.assertEqual(
                        "INVALID_PLANE_SCORE_INPUT", caught.exception.code
                    )

    def test_plane_score_rejects_invalid_patch_indexes_cleanly(self) -> None:
        cfg = config()
        base_inventory, _ = surfaces.extract_structural_inventory(
            room(), config=cfg, np=np
        )
        tangent_values = np.asarray([-0.45, -0.15, 0.15, 0.45])
        specs = (
            (0, np.asarray([1.0, 0.0]), 0.0, tangent_values),
            (1, np.asarray([0.0, 1.0]), 0.0, tangent_values),
        )
        surface_set, inventory = self._plane_score_fixture(
            specs,
            (0.0, 0.45, 0.90),
            cfg=cfg,
            base_inventory=base_inventory,
        )
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (0, 1), False
        )

        def with_first_indexes(
            candidate: surfaces.StructuralInventory, indexes: np.ndarray
        ) -> surfaces.StructuralInventory:
            planes = list(candidate.wall_planes)
            planes[0] = replace(planes[0], point_indices=indexes)
            return replace(candidate, wall_planes=tuple(planes))

        malformed_indexes = {
            "negative": np.asarray([-1], dtype=np.int64),
            "out_of_range": np.asarray(
                [surface_set.points.shape[0]], dtype=np.int64
            ),
            "duplicate": np.asarray([0, 0], dtype=np.int64),
            "noninteger": np.asarray([0.5], dtype=np.float64),
        }
        for side in ("source", "target"):
            for reason, indexes in malformed_indexes.items():
                with self.subTest(side=side, reason=reason):
                    source_inventory = (
                        with_first_indexes(inventory, indexes)
                        if side == "source"
                        else inventory
                    )
                    target_inventory = (
                        with_first_indexes(inventory, indexes)
                        if side == "target"
                        else inventory
                    )
                    with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                        self._full_plane_score(
                            surface_set,
                            surface_set,
                            source_inventory,
                            target_inventory,
                            hypothesis,
                            cfg,
                        )
                    self.assertEqual(
                        "INVALID_PLANE_SCORE_INPUT", caught.exception.code
                    )

    def test_plane_score_rejects_cross_plane_patch_index_reuse(self) -> None:
        cfg = config()
        base_inventory, _ = surfaces.extract_structural_inventory(
            room(), config=cfg, np=np
        )
        tangent_values = np.asarray([-0.45, -0.15, 0.15, 0.45])
        surface_set, inventory = self._plane_score_fixture(
            (
                (0, np.asarray([1.0, 0.0]), 0.0, tangent_values),
                (1, np.asarray([0.0, 1.0]), 0.0, tangent_values),
            ),
            (0.0, 0.45, 0.90),
            cfg=cfg,
            base_inventory=base_inventory,
        )
        planes = list(inventory.wall_planes)
        planes[1] = replace(
            planes[1],
            point_indices=np.concatenate(
                (planes[1].point_indices, planes[0].point_indices[:1])
            ),
        )
        malformed = replace(inventory, wall_planes=tuple(planes))
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (0, 1), False
        )
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            self._full_plane_score(
                surface_set,
                surface_set,
                malformed,
                inventory,
                hypothesis,
                cfg,
            )
        self.assertEqual("INVALID_PLANE_SCORE_INPUT", caught.exception.code)

    def test_plane_score_rejects_nonnumeric_hypothesis_geometry_cleanly(self) -> None:
        cfg = config()
        base_inventory, _ = surfaces.extract_structural_inventory(
            room(), config=cfg, np=np
        )
        tangent_values = np.asarray([-0.45, -0.15, 0.15, 0.45])
        surface_set, inventory = self._plane_score_fixture(
            (
                (0, np.asarray([1.0, 0.0]), 0.0, tangent_values),
                (1, np.asarray([0.0, 1.0]), 0.0, tangent_values),
            ),
            (0.0, 0.45, 0.90),
            cfg=cfg,
            base_inventory=base_inventory,
        )
        malformed_hypotheses = (
            surfaces.PlaneHypothesis("bad", np.zeros(3), (0, 1), (0, 1), False),
            surfaces.PlaneHypothesis(0.0, "bad", (0, 1), (0, 1), False),
            surfaces.PlaneHypothesis(0.0, np.zeros(3), (0, 1), (0, 1), 1),
        )
        for hypothesis in malformed_hypotheses:
            with self.subTest(hypothesis=hypothesis):
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces._score_plane_hypothesis(
                        surface_set,
                        surface_set,
                        inventory,
                        inventory,
                        hypothesis,
                        full_patch_score=False,
                        config=cfg,
                        linear_sum_assignment=linear_sum_assignment,
                        np=np,
                        cKDTree=cKDTree,
                    )
                self.assertEqual("INVALID_PLANE_SCORE_INPUT", caught.exception.code)

    def test_plane_assignment_tie_prefers_rigid_invariant_support_coverage(self) -> None:
        cfg = config()
        base_inventory, _ = surfaces.extract_structural_inventory(room(), config=cfg, np=np)
        u = np.asarray([-0.45, -0.15, 0.15, 0.45])
        z_values = (0.0, 0.45, 0.90)
        source_set, source_inventory = self._plane_score_fixture(
            (
                (0, np.asarray([1.0, 0.0]), 0.0, u),
                (1, np.asarray([0.0, 1.0]), 0.0, u),
            ),
            z_values,
            cfg=cfg,
            base_inventory=base_inventory,
        )
        target_set, target_inventory = self._plane_score_fixture(
            (
                (10, np.asarray([1.0, 0.0]), -0.10, np.asarray([-0.15, 0.15])),
                (
                    11,
                    np.asarray([1.0, 0.0]),
                    0.10,
                    np.linspace(-1.50, 1.50, 11),
                ),
                (12, np.asarray([0.0, 1.0]), 0.0, u),
            ),
            z_values,
            cfg=cfg,
            base_inventory=base_inventory,
        )
        source_inventory = replace(
            source_inventory,
            wall_planes=tuple(
                replace(plane, support_area_proxy_m2=1.0)
                for plane in source_inventory.wall_planes
            ),
        )
        # These deliberately forged metadata values must not steer the full
        # physical score.  The indexed patch points above make plane 11 the
        # genuinely larger of the two equal-residual X walls.
        target_areas = {10: 10.0, 11: 0.1, 12: 1.0}
        target_inventory = replace(
            target_inventory,
            wall_planes=tuple(
                replace(plane, support_area_proxy_m2=target_areas[plane.plane_id])
                for plane in target_inventory.wall_planes
            ),
        )
        hypothesis = surfaces.PlaneHypothesis(
            0.0, np.zeros(3), (0, 1), (11, 12), False
        )

        def evaluate(
            source: surfaces.SurfaceSet,
            target: surfaces.SurfaceSet,
            source_inv: surfaces.StructuralInventory,
            target_inv: surfaces.StructuralInventory,
        ) -> tuple[float, float]:
            score, evidence = self._full_plane_score(
                source, target, source_inv, target_inv, hypothesis, cfg
            )
            self.assertTrue(evidence["assessable"])
            return score, float(evidence["matchedTargetAreaFraction"])

        original_score, original_coverage = evaluate(
            source_set, target_set, source_inventory, target_inventory
        )
        physical_areas = {
            plane.plane_id: len(
                surfaces._plane_occupancy_cells(
                    target_set.points[plane.point_indices],
                    plane.normal_xy,
                    cfg.plane_occupancy_cell_m,
                    comparison_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
                    np=np,
                )
            )
            * cfg.plane_occupancy_cell_m**2
            for plane in target_inventory.wall_planes
        }
        expected_coverage = (
            physical_areas[11] + physical_areas[12]
        ) / math.fsum(physical_areas.values())
        self.assertAlmostEqual(expected_coverage, original_coverage)
        self.assertGreater(original_coverage, 0.75)
        angle = math.radians(100.0)
        rotation = np.asarray(
            [[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]]
        )

        def rotated(
            surface_set: surfaces.SurfaceSet,
            inventory: surfaces.StructuralInventory,
        ) -> tuple[surfaces.SurfaceSet, surfaces.StructuralInventory]:
            points = surface_set.points.copy()
            points[:, :2] = points[:, :2] @ rotation.T
            normals = surface_set.normals.copy()
            normals[:, :2] = normals[:, :2] @ rotation.T
            planes = []
            for plane in inventory.wall_planes:
                normal, offset = surfaces._canonical_xy_plane(
                    rotation @ plane.normal_xy, plane.offset_m, np=np
                )
                planes.append(replace(plane, normal_xy=normal, offset_m=offset))
            planes.sort(
                key=lambda plane: (
                    math.atan2(float(plane.normal_xy[1]), float(plane.normal_xy[0])),
                    plane.offset_m,
                    -plane.support_count,
                )
            )
            return (
                surfaces.SurfaceSet(
                    points, normals, surface_set.labels, surface_set.weights
                ),
                replace(inventory, wall_planes=tuple(planes)),
            )

        rotated_source, rotated_source_inventory = rotated(source_set, source_inventory)
        rotated_target, rotated_target_inventory = rotated(target_set, target_inventory)
        rotated_score, rotated_coverage = evaluate(
            rotated_source,
            rotated_target,
            rotated_source_inventory,
            rotated_target_inventory,
        )
        self.assertAlmostEqual(original_coverage, rotated_coverage, places=12)
        self.assertAlmostEqual(original_score, rotated_score, places=10)

    def test_plane_support_area_cells_use_intrinsic_patch_origin(self) -> None:
        cfg = config()
        tangent_values = np.asarray([0.02, 0.17, 0.47, 0.62])
        z_values = np.asarray([0.02, 0.17, 0.47])
        normal = np.asarray([1.0, 0.0])
        tangent = np.asarray([0.0, 1.0])
        points = np.asarray(
            [
                [
                    float((u * tangent)[0]),
                    float((u * tangent)[1]),
                    float(z),
                ]
                for u in tangent_values
                for z in z_values
            ]
        )
        base_cells = surfaces._plane_occupancy_cells(
            points,
            normal,
            cfg.plane_occupancy_cell_m,
            comparison_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        shifted = points + np.asarray([12.0, 0.02, 0.02])
        shifted_cells = surfaces._plane_occupancy_cells(
            shifted,
            normal,
            cfg.plane_occupancy_cell_m,
            comparison_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        self.assertEqual(len(base_cells), len(shifted_cells))
        angle = math.radians(100.0)
        rotation = np.asarray(
            [[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]]
        )
        rotated_points = points.copy()
        rotated_points[:, :2] = rotated_points[:, :2] @ rotation.T
        rotated_normal, _offset = surfaces._canonical_xy_plane(
            rotation @ normal, 0.0, np=np
        )
        rotated_cells = surfaces._plane_occupancy_cells(
            rotated_points,
            rotated_normal,
            cfg.plane_occupancy_cell_m,
            comparison_epsilon_m=cfg.metric_boundary_comparison_epsilon_m,
            np=np,
        )
        self.assertEqual(len(base_cells), len(rotated_cells))

    def test_fixed_scale_height_mismatch_respects_hard_cap(self) -> None:
        source = room()
        target_points = source.points.copy()
        target_points[source.labels == surfaces.LABEL_CEILING, 2] += 0.30
        target = surfaces.SurfaceSet(
            target_points,
            source.normals,
            source.labels,
            source.weights,
        )
        source_inventory, _ = surfaces.extract_structural_inventory(
            source, config=config(), np=np
        )
        target_inventory, _ = surfaces.extract_structural_inventory(
            target, config=config(), np=np
        )
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces.generate_plane_pair_hypotheses(
                source_inventory,
                target_inventory,
                mirrored=False,
                config=config(),
                np=np,
            )
        self.assertEqual("FIXED_SCALE_HEIGHT_MISMATCH", caught.exception.code)

    def test_secondary_ceiling_bands_are_report_only_and_cannot_steer_or_reject(self) -> None:
        source_inventory, _ = surfaces.extract_structural_inventory(
            room(), config=config(), np=np
        )
        target_surface = surfaces.transform_surfaces(
            room(), np.eye(3), np.asarray([0.0, 0.0, 0.4]), np
        )
        target_inventory, _ = surfaces.extract_structural_inventory(
            target_surface, config=config(), np=np
        )
        source_multilevel = replace(
            source_inventory,
            ceiling_z_m=3.0,
            ceiling_levels_m=(2.45, 2.78, 3.0),
            ceiling_level_mads_m=(0.01, 0.01, 0.01),
        )
        target_multilevel = replace(
            target_inventory,
            ceiling_z_m=3.4,
            ceiling_levels_m=(2.85, 3.18, 3.4),
            ceiling_level_mads_m=(0.01, 0.01, 0.01),
        )
        hypotheses, evidence = surfaces.generate_plane_pair_hypotheses(
            source_multilevel,
            target_multilevel,
            mirrored=False,
            config=config(),
            np=np,
        )
        self.assertAlmostEqual(0.4, evidence["floorOnlyZTranslationMeters"])
        self.assertFalse(evidence["zTranslationUsesCeilingLevels"])
        self.assertAlmostEqual(0.0, evidence["topEnvelopeHeightDifferenceMeters"])
        self.assertTrue(evidence["topCeilingEnvelopeUsedForFixedScaleCheck"])
        self.assertFalse(
            evidence["secondaryCeilingBandsUsedToAdmitRejectSteerOrRelaxTopCap"]
        )

        count_mismatch = replace(
            target_multilevel,
            ceiling_levels_m=(3.4,),
            ceiling_level_mads_m=(0.01,),
        )
        mismatch_hypotheses, mismatch_evidence = surfaces.generate_plane_pair_hypotheses(
            source_multilevel,
            count_mismatch,
            mirrored=False,
            config=config(),
            np=np,
        )
        self.assertFalse(mismatch_evidence["reportedLowerBandCountsMatch"])
        self.assertEqual(len(hypotheses), len(mismatch_hypotheses))
        for first, second in zip(hypotheses, mismatch_hypotheses, strict=True):
            self.assertAlmostEqual(first.yaw_radians, second.yaw_radians, places=12)
            np.testing.assert_allclose(first.translation, second.translation, atol=1e-12)

    def test_plane_seed_recovers_known_transform(self) -> None:
        source = room()
        expected_yaw = 32.0
        expected_translation = np.asarray([4.2, -1.3, 0.25])
        target = surfaces.transform_surfaces(
            source,
            surfaces.yaw_rotation(math.radians(expected_yaw), np),
            expected_translation,
            np,
        )
        rotation, translation, trace = surfaces.fit_structural_zup_family(
            source,
            target,
            mirrored=False,
            config=config(),
            np=np,
            cKDTree=cKDTree,
        )
        actual_yaw = math.degrees(math.atan2(float(rotation[1, 0]), float(rotation[0, 0])))
        yaw_error = abs((actual_yaw - expected_yaw + 180.0) % 360.0 - 180.0)
        self.assertLessEqual(yaw_error, 0.25)
        np.testing.assert_allclose(translation, expected_translation, atol=0.02)
        plane_fit = trace["distinctPlaneFit"]
        self.assertTrue(plane_fit["floorAndTopCeilingUsedOnlyForZFamilyChecks"])
        self.assertTrue(plane_fit["floorUsedForZTranslation"])
        self.assertTrue(plane_fit["topCeilingEnvelopeUsedForFixedScaleCheck"])
        self.assertFalse(plane_fit["reportedSecondaryCeilingBandsUsedForFit"])
        self.assertFalse(plane_fit["ceilingLevelsUsedForZTranslation"])
        self.assertTrue(plane_fit["zTranslationFrozenDuringContinuousRefinement"])
        self.assertFalse(plane_fit["classWideNearestWallIcpUsedAsProof"])
        self.assertEqual(
            plane_fit["cheapAssessableHypothesisCount"],
            plane_fit["fullScoreAttemptCount"],
        )
        self.assertTrue(plane_fit["attemptedFullScoreForEveryCheapAssessableHypothesis"])

    def test_disconnected_horizontal_interior_cannot_steer_yaw_or_xy(self) -> None:
        source = room()
        expected_yaw = 22.75
        expected_translation = np.asarray([1.25, -2.75, 0.4])
        target = surfaces.transform_surfaces(
            source,
            surfaces.yaw_rotation(math.radians(expected_yaw), np),
            expected_translation,
            np,
        )
        horizontal = target.labels != surfaces.LABEL_WALL
        # Keep a thin, genuine contact ring beside the source wall patches so
        # the floor/ceiling levels remain physically attributable to this room.
        # Move only the large interior region: if horizontal nearest-neighbour
        # geometry can steer yaw/XY, this deliberately wrong interior dominates.
        source_xy = source.points[:, :2]
        contacts_room_walls = (
            (source_xy[:, 0] <= 0.5)
            | (source_xy[:, 0] >= 6.5)
            | (source_xy[:, 1] <= 0.5)
            | (source_xy[:, 1] >= 4.5)
        )
        altered_points = target.points.copy()
        altered_points[horizontal & ~contacts_room_walls, :2] += np.asarray([20.0, -15.0])
        altered_target = surfaces.SurfaceSet(
            altered_points,
            target.normals,
            target.labels,
            target.weights,
        )
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces.fit_structural_zup_family(
                source,
                altered_target,
                mirrored=False,
                config=config(),
                np=np,
                cKDTree=cKDTree,
            )
        self.assertEqual("HORIZONTAL_ROOM_ENVELOPE_NOT_FOUND", caught.exception.code)

    def test_fit_tolerates_deterministic_wall_occlusion_and_noise(self) -> None:
        source = room()
        expected_yaw = 17.25
        expected_translation = np.asarray([-0.8, 2.1, -0.2])
        target = surfaces.transform_surfaces(
            source,
            surfaces.yaw_rotation(math.radians(expected_yaw), np),
            expected_translation,
            np,
        )
        wall_rows = np.flatnonzero(target.labels == surfaces.LABEL_WALL)
        keep = np.ones(target.points.shape[0], dtype=bool)
        keep[wall_rows[::3]] = False
        noisy_points = target.points[keep].copy()
        noisy_labels = target.labels[keep]
        noisy_wall = noisy_labels == surfaces.LABEL_WALL
        noise = np.random.default_rng(1725).normal(0.0, 0.004, (int(np.count_nonzero(noisy_wall)), 3))
        noisy_points[noisy_wall] += noise
        occluded_target = surfaces.SurfaceSet(
            noisy_points,
            target.normals[keep],
            noisy_labels,
            target.weights[keep],
        )
        rotation, translation, _trace = surfaces.fit_structural_zup_family(
            source,
            occluded_target,
            mirrored=False,
            config=config(),
            np=np,
            cKDTree=cKDTree,
        )
        actual_yaw = math.degrees(math.atan2(float(rotation[1, 0]), float(rotation[0, 0])))
        yaw_error = abs((actual_yaw - expected_yaw + 180.0) % 360.0 - 180.0)
        self.assertLessEqual(yaw_error, 0.5)
        np.testing.assert_allclose(translation, expected_translation, atol=0.05)


if __name__ == "__main__":
    unittest.main()
