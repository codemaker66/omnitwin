#!/usr/bin/env python3
"""Behavioural tests for the authority-none room-shape proposer.

Every synthetic room in this file is deliberately **20.37 x 9.62 x 6.85 m**.
Those are not the Grand Hall's published figures and they are not close to
them.  An estimator that has absorbed a published dimension -- by tuned
constant, by snapping, or by an author's memory -- fails here visibly rather
than silently agreeing with the brochure on the real capture.

The tests are ordered as the pipeline runs: frame, yaw, hole closing,
candidate evidence, selection, certificate, measurement, artifact, firewall.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import room_shape  # noqa: E402


# Deliberately unrelated to any published venue dimension.  See module docstring.
FIXTURE_LENGTH_M = 20.37
FIXTURE_WIDTH_M = 9.62
FIXTURE_HEIGHT_M = 6.85
FIXTURE_TRIPOD_M = 1.49


def _plane_grid(
    u0: float,
    u1: float,
    v0: float,
    v1: float,
    step: float,
) -> tuple[np.ndarray, np.ndarray]:
    us = np.arange(u0, u1 + 1e-9, step)
    vs = np.arange(v0, v1 + 1e-9, step)
    uu, vv = np.meshgrid(us, vs, indexing="ij")
    return uu.ravel(), vv.ravel()


def _keep_outside_rects(
    u: np.ndarray,
    v: np.ndarray,
    rects: tuple[tuple[float, float, float, float], ...],
) -> np.ndarray:
    keep = np.ones(u.shape, dtype=bool)
    for u0, u1, v0, v1 in rects:
        keep &= ~((u >= u0) & (u <= u1) & (v >= v0) & (v <= v1))
    return keep


def _yaw_then_tilt(yaw: float, tilt: float) -> np.ndarray:
    cy, sy = math.cos(yaw), math.sin(yaw)
    rz = np.array([[cy, -sy, 0.0], [sy, cy, 0.0], [0.0, 0.0, 1.0]])
    ct, st = math.cos(tilt), math.sin(tilt)
    rx = np.array([[1.0, 0.0, 0.0], [0.0, ct, -st], [0.0, st, ct]])
    return rx @ rz


class SyntheticRoom:
    """A rectangular room sampled on its interior faces, with optional defects.

    Coordinates are built in a canonical room frame (x along length, y along
    width, z up, floor at z = 0) and then rigidly posed into an arbitrary world
    frame, so the pipeline has to recover the frame rather than be handed it.
    """

    def __init__(
        self,
        *,
        length: float = FIXTURE_LENGTH_M,
        width: float = FIXTURE_WIDTH_M,
        height: float = FIXTURE_HEIGHT_M,
        step: float = 0.06,
        windows: bool = True,
        doorway: bool = False,
        corridor_wall_at: float | None = None,
        colonnade_inset: float | None = None,
        omit_wall: str | None = None,
        yaw_deg: float = 0.0,
        tilt_deg: float = 0.0,
        translation: tuple[float, float, float] = (0.0, 0.0, 0.0),
        origin_inset: float = 1.4,
        origin_count: int = 12,
        tripod_height: float = FIXTURE_TRIPOD_M,
    ) -> None:
        self.length = length
        self.width = width
        self.height = height
        points: list[np.ndarray] = []
        normals: list[np.ndarray] = []

        window_rects = (
            ((2.0, 4.4, 1.1, 4.3), (7.0, 9.4, 1.1, 4.3), (13.0, 15.4, 1.1, 4.3))
            if windows
            else ()
        )
        door_rects = ((4.2, 5.4, 0.0, 2.1),) if doorway else ()

        def add(pts: np.ndarray, nrm: tuple[float, float, float]) -> None:
            points.append(pts)
            normals.append(np.tile(np.asarray(nrm, dtype=float), (pts.shape[0], 1)))

        # x = 0 wall (inward +x).
        u, v = _plane_grid(0.0, width, 0.0, height, step)
        add(np.column_stack([np.zeros(u.shape), u, v]), (1.0, 0.0, 0.0))

        # x = length wall (inward -x).
        u, v = _plane_grid(0.0, width, 0.0, height, step)
        add(np.column_stack([np.full(u.shape, length), u, v]), (-1.0, 0.0, 0.0))

        # y = 0 wall (inward +y) -- the windows and the optional doorway.
        u, v = _plane_grid(0.0, length, 0.0, height, step)
        keep = _keep_outside_rects(u, v, window_rects + door_rects)
        add(
            np.column_stack([u[keep], np.zeros(u[keep].shape), v[keep]]),
            (0.0, 1.0, 0.0),
        )

        # y = width wall (inward -y).
        if omit_wall != "y_max":
            u, v = _plane_grid(0.0, length, 0.0, height, step)
            add(np.column_stack([u, np.full(u.shape, width), v]), (0.0, -1.0, 0.0))

        # Floor (inward +z) and ceiling (inward -z).
        u, v = _plane_grid(0.0, length, 0.0, width, step)
        add(np.column_stack([u, v, np.zeros(u.shape)]), (0.0, 0.0, 1.0))
        add(np.column_stack([u, v, np.full(u.shape, height)]), (0.0, 0.0, -1.0))

        # A corridor wall beyond the doorway, lit only through the door cone.
        if corridor_wall_at is not None:
            u, v = _plane_grid(3.9, 5.7, 0.0, 2.3, step)
            add(
                np.column_stack([u, np.full(u.shape, corridor_wall_at), v]),
                (0.0, 1.0, 0.0),
            )

        # A colonnade standing inboard of the y = width wall: floor-to-ceiling
        # columns that hole-closing would happily weld into a "solid wall".
        if colonnade_inset is not None:
            y = width - colonnade_inset
            for centre in np.arange(2.0, length - 1.0, 3.0):
                u, v = _plane_grid(centre - 0.28, centre + 0.28, 0.0, height, step)
                add(np.column_stack([u, np.full(u.shape, y), v]), (0.0, -1.0, 0.0))

        self.room_points = np.concatenate(points, axis=0)
        self.room_normals = np.concatenate(normals, axis=0)

        xs = np.linspace(origin_inset, length - origin_inset, origin_count)
        ys = np.full(xs.shape, width / 2.0)
        ys[::2] = origin_inset
        ys[1::2] = width - origin_inset
        self.room_origins = np.column_stack(
            [xs, ys, np.full(xs.shape, tripod_height)]
        )

        rot = _yaw_then_tilt(math.radians(yaw_deg), math.radians(tilt_deg))
        shift = np.asarray(translation, dtype=float)
        self.rotation = rot
        self.points = self.room_points @ rot.T + shift
        self.normals = self.room_normals @ rot.T
        self.origins = self.room_origins @ rot.T + shift


def _measure(room: SyntheticRoom) -> room_shape.RoomShapeMeasurement:
    return room_shape.measure_room_shape(room.points, room.normals, room.origins)


def _binding(room: SyntheticRoom) -> dict[str, object]:
    return {
        "manifestSha256": "a" * 64,
        "pointCloudSha256": "b" * 64,
        "pointCount": int(room.points.shape[0]),
        "originCount": int(room.origins.shape[0]),
        "label": "synthetic-fixture",
    }


class FloorFrameTests(unittest.TestCase):
    def test_recovers_up_axis_floor_and_tripod_height(self) -> None:
        room = SyntheticRoom()
        frame = room_shape.estimate_floor_frame(room.points, room.normals, room.origins)
        self.assertAlmostEqual(
            abs(float(np.dot(frame.up, (0.0, 0.0, 1.0)))), 1.0, places=4
        )
        self.assertAlmostEqual(frame.tripod_height_m, FIXTURE_TRIPOD_M, places=2)
        self.assertLess(frame.tripod_height_spread_m, 0.02)
        self.assertAlmostEqual(frame.ceiling_height_m, FIXTURE_HEIGHT_M, places=2)

    def test_recovers_up_axis_when_the_capture_is_tilted(self) -> None:
        room = SyntheticRoom(tilt_deg=4.0, yaw_deg=17.0, translation=(31.0, -12.0, 4.5))
        frame = room_shape.estimate_floor_frame(room.points, room.normals, room.origins)
        expected_up = room.rotation @ np.array([0.0, 0.0, 1.0])
        self.assertGreater(float(np.dot(frame.up, expected_up)), 0.9995)
        self.assertAlmostEqual(frame.tripod_height_m, FIXTURE_TRIPOD_M, places=2)

    def test_up_is_oriented_toward_the_scanner_not_away(self) -> None:
        room = SyntheticRoom(tilt_deg=-6.0)
        frame = room_shape.estimate_floor_frame(room.points, room.normals, room.origins)
        heights = (room.origins - np.asarray(frame.floor_point)) @ np.asarray(frame.up)
        self.assertTrue(bool(np.all(heights > 0.0)))


class YawTests(unittest.TestCase):
    def test_two_independent_estimators_agree_on_a_rotated_room(self) -> None:
        room = SyntheticRoom(yaw_deg=31.7)
        frame = room_shape.estimate_floor_frame(room.points, room.normals, room.origins)
        yaw = room_shape.estimate_yaw(room.points, room.normals, frame)
        self.assertLess(yaw.disagreement_deg, 1.5)
        self.assertGreater(yaw.rectangularity, 0.8)

    def test_disagreement_is_reported_not_raised(self) -> None:
        room = SyntheticRoom(yaw_deg=12.0)
        frame = room_shape.estimate_floor_frame(room.points, room.normals, room.origins)
        yaw = room_shape.estimate_yaw(room.points, room.normals, frame)
        self.assertIsInstance(yaw.disagreement_deg, float)
        self.assertIsInstance(yaw.normal_histogram_deg, float)
        self.assertIsInstance(yaw.span_minimisation_deg, float)


class HoleClosingTests(unittest.TestCase):
    def test_encloses_a_window_but_not_an_open_edge(self) -> None:
        occupied = np.ones((40, 30), dtype=bool)
        occupied[10:20, 8:18] = False  # a window, fully surrounded
        occupied[0:6, 5:12] = False  # a bite out of the left edge
        closed = room_shape.close_enclosed_holes(occupied)
        self.assertTrue(bool(closed[12:18, 10:16].all()))
        self.assertFalse(bool(closed[0:5, 6:11].any()))

    def test_seeded_rows_are_not_counted_as_occupied(self) -> None:
        occupied = np.zeros((20, 20), dtype=bool)
        closed = room_shape.close_enclosed_holes(occupied)
        self.assertEqual(int(closed.sum()), 0)

    def test_a_gap_reaching_the_ceiling_still_counts_as_enclosed(self) -> None:
        occupied = np.ones((40, 30), dtype=bool)
        occupied[12:18, 20:30] = False  # a tall opening running into the top row
        closed = room_shape.close_enclosed_holes(occupied)
        self.assertTrue(bool(closed[13:17, 22:29].all()))


class CandidateEvidenceTests(unittest.TestCase):
    def test_a_real_wall_is_areally_complete_and_spans_the_room(self) -> None:
        room = SyntheticRoom()
        measurement = _measure(room)
        wall = measurement.wall("y_min")
        self.assertIsNotNone(wall)
        assert wall is not None
        self.assertGreater(wall.completeness_closed, 0.85)
        self.assertGreater(wall.coverage_height, 0.95)
        self.assertGreater(wall.coverage_walked, 0.95)

    def test_a_wall_glimpsed_through_a_doorway_is_rejected(self) -> None:
        room = SyntheticRoom(doorway=True, corridor_wall_at=-3.0)
        measurement = _measure(room)
        wall = measurement.wall("y_min")
        self.assertIsNotNone(wall, "the real wall must still be found and accepted")
        assert wall is not None
        glimpse = [
            candidate
            for candidate in measurement.candidates
            if candidate.axis == 1
            and candidate.side == -1
            and candidate.offset_m < wall.offset_m - 1.0
        ]
        self.assertTrue(glimpse, "the corridor wall should be enumerated as a candidate")
        for candidate in glimpse:
            self.assertFalse(candidate.accepted)
            self.assertLess(candidate.coverage_height, 0.5)
            self.assertLess(candidate.coverage_walked, 0.3)

    def test_the_doorway_does_not_cost_its_own_wall_acceptance(self) -> None:
        room = SyntheticRoom(doorway=True, corridor_wall_at=-3.0)
        measurement = _measure(room)
        self.assertEqual(measurement.state, "measured")
        assert measurement.short_axis_m is not None
        # Measuring to the corridor wall 3 m beyond the door would read 12.62 m.
        self.assertAlmostEqual(
            measurement.short_axis_m.centre_m, FIXTURE_WIDTH_M, delta=0.05
        )

    def test_each_candidate_is_refit_before_it_is_judged(self) -> None:
        room = SyntheticRoom(yaw_deg=8.0)
        measurement = _measure(room)
        for candidate in measurement.candidates:
            if candidate.accepted:
                self.assertLess(candidate.plane.rms_m, 0.02)

    def test_plane_tolerance_is_measured_from_residuals(self) -> None:
        room = SyntheticRoom()
        measurement = _measure(room)
        for candidate in measurement.candidates:
            if candidate.accepted:
                self.assertGreaterEqual(
                    candidate.tolerance_m, room_shape.MIN_PLANE_TOLERANCE_M
                )


class SelectionTests(unittest.TestCase):
    def test_the_outer_wall_wins_over_an_inboard_colonnade(self) -> None:
        room = SyntheticRoom(colonnade_inset=1.15)
        measurement = _measure(room)
        passing = [
            candidate
            for candidate in measurement.candidates
            if candidate.name == "y_max" and candidate.accepted
        ]
        self.assertGreaterEqual(
            len(passing), 2, "the colonnade should also pass and be recorded"
        )
        assert measurement.short_axis_m is not None
        # Selecting the colonnade instead of the wall behind it would read 8.47 m.
        self.assertAlmostEqual(
            measurement.short_axis_m.centre_m, FIXTURE_WIDTH_M, delta=0.05
        )

    def test_a_missing_wall_refuses_rather_than_substituting(self) -> None:
        room = SyntheticRoom(omit_wall="y_max")
        measurement = _measure(room)
        self.assertIn("WALL_NOT_FOUND:y_max", measurement.refusals)
        self.assertIsNone(measurement.short_axis_m)

    def test_every_origin_must_lie_inside_every_accepted_wall(self) -> None:
        room = SyntheticRoom()
        measurement = _measure(room)
        self.assertTrue(measurement.interiority.satisfied)
        self.assertEqual(measurement.interiority.violating_origin_count, 0)
        self.assertGreater(measurement.interiority.minimum_clearance_m, 0.5)

    def test_unadjudicated_outboard_mass_blocks_a_complete_measurement(self) -> None:
        room = SyntheticRoom()
        rng = np.random.default_rng(19)
        outboard = np.column_stack(
            [
                rng.uniform(0.2, room.length - 0.2, 8_000),
                rng.uniform(-2.0, -0.8, 8_000),
                rng.uniform(0.2, room.height - 0.2, 8_000),
            ]
        )
        outboard_normals = np.tile((0.0, 0.0, 1.0), (outboard.shape[0], 1))
        measurement = room_shape.measure_room_shape(
            np.concatenate([room.points, outboard]),
            np.concatenate([room.normals, outboard_normals]),
            room.origins,
        )
        self.assertIn("OUTBOARD_MASS_UNADJUDICATED:y_min", measurement.refusals)
        self.assertEqual(measurement.state, "unmeasurable")
        wall = measurement.wall("y_min")
        self.assertIsNotNone(wall)
        assert wall is not None
        self.assertTrue(wall.outboard_review_required)


class MeasurementTests(unittest.TestCase):
    def test_dimensions_match_the_synthetic_truth(self) -> None:
        room = SyntheticRoom(yaw_deg=23.5, tilt_deg=2.0, translation=(-8.0, 41.0, 2.0))
        measurement = _measure(room)
        self.assertEqual(measurement.state, "measured")
        assert measurement.long_axis_m is not None
        assert measurement.short_axis_m is not None
        assert measurement.height_m is not None
        self.assertAlmostEqual(
            measurement.long_axis_m.centre_m, FIXTURE_LENGTH_M, delta=0.03
        )
        self.assertAlmostEqual(
            measurement.short_axis_m.centre_m, FIXTURE_WIDTH_M, delta=0.03
        )
        self.assertAlmostEqual(
            measurement.height_m.centre_m, FIXTURE_HEIGHT_M, delta=0.03
        )

    def test_uncertainty_is_reported_and_positive(self) -> None:
        room = SyntheticRoom()
        measurement = _measure(room)
        assert measurement.long_axis_m is not None
        self.assertGreater(measurement.long_axis_m.uncertainty_m, 0.0)
        self.assertLess(measurement.long_axis_m.uncertainty_m, 0.10)

    def test_out_of_parallel_is_measured_not_assumed(self) -> None:
        room = SyntheticRoom()
        measurement = _measure(room)
        assert measurement.long_axis_m is not None
        self.assertLess(measurement.long_axis_m.out_of_parallel_deg, 0.5)

    def test_an_outward_crop_margin_cannot_inflate_a_dimension(self) -> None:
        """Dimensions are plane-to-plane, so extra outboard points change nothing."""
        room = SyntheticRoom()
        baseline = _measure(room)
        rng = np.random.default_rng(7)
        skirt = np.column_stack(
            [
                rng.uniform(-18.0, 38.0, 40_000),
                rng.uniform(-22.0, 31.0, 40_000),
                rng.uniform(-2.0, 9.0, 40_000),
            ]
        )
        skirt_normals = np.tile(np.array([0.0, 0.0, 1.0]), (skirt.shape[0], 1))
        widened = room_shape.measure_room_shape(
            np.concatenate([room.points, skirt], axis=0),
            np.concatenate([room.normals, skirt_normals], axis=0),
            room.origins,
        )
        assert baseline.long_axis_m is not None
        assert widened.long_axis_m is not None
        self.assertAlmostEqual(
            widened.long_axis_m.centre_m, baseline.long_axis_m.centre_m, delta=0.02
        )

    def test_plane_separation_reports_splay_over_observed_support(self) -> None:
        near = room_shape.Plane((0.0, 0.0, 1.0), 0.0, 0.002, 0.002, 100)
        tilt = math.radians(2.0)
        far = room_shape.Plane(
            (math.sin(tilt), 0.0, -math.cos(tilt)),
            -5.0 * math.cos(tilt),
            0.003,
            0.003,
            100,
        )
        support = np.array([[-3.0, -2.0, 1.0], [0.0, 0.0, 1.0], [3.0, 2.0, 1.0]])
        measured = room_shape.measure_plane_separation(near, far, support)
        self.assertLess(measured.minimum_m, measured.centre_m)
        self.assertLess(measured.centre_m, measured.maximum_m)
        self.assertAlmostEqual(measured.out_of_parallel_deg, 2.0, places=5)


class InputValidationTests(unittest.TestCase):
    def test_sparse_zero_normals_are_counted_and_ignored(self) -> None:
        room = SyntheticRoom(step=0.3)
        normals = room.normals.copy()
        normals[0] = 0.0
        measurement = room_shape.measure_room_shape(room.points, normals, room.origins)
        self.assertEqual(measurement.input_point_count, room.points.shape[0])
        self.assertEqual(measurement.usable_normal_count, room.points.shape[0] - 1)
        self.assertNotIn("INSUFFICIENT_NORMAL_COVERAGE", measurement.refusals)

    def test_non_finite_inputs_are_rejected(self) -> None:
        room = SyntheticRoom(step=0.3)
        points = room.points.copy()
        points[0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, "finite"):
            room_shape.measure_room_shape(points, room.normals, room.origins)


class ProposalArtifactTests(unittest.TestCase):
    def _proposal(self) -> dict[str, object]:
        room = SyntheticRoom()
        return room_shape.build_proposal(_measure(room), source_binding=_binding(room))

    def test_the_proposal_claims_no_authority_and_names_its_review_seam(self) -> None:
        proposal = self._proposal()
        self.assertEqual(proposal["schemaVersion"], room_shape.ROOM_SHAPE_SCHEMA_VERSION)
        self.assertEqual(proposal["authority"], "none")
        self.assertEqual(proposal["reviewStatus"], "unreviewed")
        seam = proposal["reviewSeam"]
        assert isinstance(seam, dict)
        self.assertEqual(
            seam["targetSchemaVersion"], room_shape.REVIEW_SEAM_SCHEMA_VERSION
        )
        self.assertFalse(bool(seam["selfApproved"]))
        self.assertFalse(bool(seam["directImportCompatible"]))

    def test_the_proposed_polygon_satisfies_the_review_seams_own_rules(self) -> None:
        proposal = self._proposal()
        seam = proposal["reviewSeam"]
        assert isinstance(seam, dict)
        polygon = seam["proposedFootprintPolygonM"]
        assert isinstance(polygon, list)
        self.assertGreaterEqual(len(polygon), 3)
        self.assertLessEqual(len(polygon), room_shape.REVIEW_SEAM_MAX_VERTICES)
        self.assertEqual(len({tuple(vertex) for vertex in polygon}), len(polygon))
        self.assertTrue(room_shape.polygon_is_simple(polygon))

    def test_the_digest_binds_the_payload(self) -> None:
        proposal = self._proposal()
        digest = proposal.pop("proposalSha256")
        self.assertEqual(digest, room_shape.proposal_digest(proposal))
        proposal["reviewStatus"] = "reviewed"
        self.assertNotEqual(digest, room_shape.proposal_digest(proposal))

    def test_the_proposal_is_deterministic_and_carries_no_wall_clock(self) -> None:
        room = SyntheticRoom()
        first = room_shape.build_proposal(_measure(room), source_binding=_binding(room))
        second = room_shape.build_proposal(_measure(room), source_binding=_binding(room))
        self.assertEqual(first["proposalSha256"], second["proposalSha256"])
        self.assertNotIn("generatedAt", json.dumps(first))

    def test_limitations_record_what_this_phase_cannot_see(self) -> None:
        proposal = self._proposal()
        limitations = proposal["limitations"]
        assert isinstance(limitations, list)
        self.assertIn(room_shape.LIMITATION_NO_SWEEP_MULTIPLICITY, limitations)
        self.assertIn(room_shape.LIMITATION_NO_MIRROR_ADJUDICATION, limitations)


class IntegrityFirewallTests(unittest.TestCase):
    """The published figures are a check, never an input -- enforced, not promised."""

    def test_the_measurement_module_never_mentions_a_published_figure(self) -> None:
        source = Path(room_shape.__file__).read_text(encoding="utf-8")
        self.assertNotIn("published", source.lower())
        self.assertNotIn("compare_room_shape", source)

    def test_the_comparison_module_is_the_only_place_published_figures_live(self) -> None:
        import compare_room_shape_to_published as comparison

        self.assertIn("grand_hall", comparison.PUBLISHED_DIMENSIONS_M)
        comparison_source = Path(comparison.__file__).read_text(encoding="utf-8")
        self.assertNotIn("import room_shape", comparison_source)
        self.assertNotIn("from room_shape", comparison_source)

    def test_swapping_the_published_constants_leaves_the_measurement_byte_identical(
        self,
    ) -> None:
        import compare_room_shape_to_published as comparison

        room = SyntheticRoom()
        before = json.dumps(
            room_shape.build_proposal(_measure(room), source_binding=_binding(room)),
            sort_keys=True,
        )
        original = comparison.PUBLISHED_DIMENSIONS_M
        try:
            comparison.PUBLISHED_DIMENSIONS_M = {"grand_hall": (999.0, 888.0, 777.0)}
            after = json.dumps(
                room_shape.build_proposal(_measure(room), source_binding=_binding(room)),
                sort_keys=True,
            )
        finally:
            comparison.PUBLISHED_DIMENSIONS_M = original
        self.assertEqual(before, after)

    def test_the_comparison_prints_the_delta_without_rounding_the_measurement(
        self,
    ) -> None:
        import compare_room_shape_to_published as comparison

        line = comparison.format_comparison(
            label="length",
            measured_m=20.412,
            uncertainty_m=0.031,
            published_m=21.0,
        )
        self.assertIn("20.412", line)
        self.assertIn("0.031", line)
        self.assertIn("21", line)
        self.assertIn("-0.588", line)

    def test_comparison_rejects_a_tampered_proposal(self) -> None:
        import compare_room_shape_to_published as comparison

        room = SyntheticRoom()
        proposal = room_shape.build_proposal(_measure(room), source_binding=_binding(room))
        proposal["measurement"]["longAxisM"]["centreM"] = 999.0
        with self.assertRaisesRegex(SystemExit, "digest"):
            comparison.compare(proposal, "grand_hall")

    def test_comparison_does_not_compare_an_unmeasurable_proposal(self) -> None:
        import compare_room_shape_to_published as comparison

        room = SyntheticRoom(omit_wall="y_max")
        proposal = room_shape.build_proposal(_measure(room), source_binding=_binding(room))
        lines = comparison.compare(proposal, "grand_hall")
        self.assertTrue(any("not compared" in line for line in lines))
        self.assertFalse(any("advertised" in line for line in lines))


class PlyReaderTests(unittest.TestCase):
    def test_binary_ply_reader_consumes_a_crlf_header_exactly(self) -> None:
        import measure_room_shape_cli as cli

        header = "\r\n".join(
            [
                "ply",
                "format binary_little_endian 1.0",
                "element vertex 1",
                "property double x",
                "property double y",
                "property double z",
                "property double nx",
                "property double ny",
                "property double nz",
                "end_header",
                "",
            ]
        ).encode("ascii")
        payload = struct.pack("<6d", 1.0, 2.0, 3.0, 0.0, 0.0, 1.0)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "one.ply"
            path.write_bytes(header + payload)
            points, normals = cli.read_binary_ply(path)
        np.testing.assert_allclose(points, [[1.0, 2.0, 3.0]])
        np.testing.assert_allclose(normals, [[0.0, 0.0, 1.0]])

    def test_binary_ply_reader_rejects_trailing_payload(self) -> None:
        import measure_room_shape_cli as cli

        header = (
            "ply\nformat binary_little_endian 1.0\nelement vertex 1\n"
            "property double x\nproperty double y\nproperty double z\n"
            "property double nx\nproperty double ny\nproperty double nz\n"
            "end_header\n"
        ).encode("ascii")
        payload = struct.pack("<6d", 1.0, 2.0, 3.0, 0.0, 0.0, 1.0)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trailing.ply"
            path.write_bytes(header + payload + b"x")
            with self.assertRaisesRegex(ValueError, "unexpected bytes"):
                cli.read_binary_ply(path)


class DiagnosticTests(unittest.TestCase):
    def test_top_view_is_deterministic_and_bound_to_the_proposal(self) -> None:
        import room_shape_diagnostics as diagnostics

        room = SyntheticRoom(step=0.18, omit_wall="y_max")
        measurement = _measure(room)
        proposal = room_shape.build_proposal(
            measurement,
            source_binding=_binding(room),
        )
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.svg"
            second = Path(directory) / "second.svg"
            metadata = diagnostics.render_top_view_svg(
                first,
                points=room.points,
                origins=room.origins,
                measurement=measurement,
                proposal_sha256=str(proposal["proposalSha256"]),
            )
            diagnostics.render_top_view_svg(
                second,
                points=room.points,
                origins=room.origins,
                measurement=measurement,
                proposal_sha256=str(proposal["proposalSha256"]),
            )
            self.assertEqual(first.read_bytes(), second.read_bytes())
            source = first.read_text(encoding="utf-8")
        self.assertEqual(metadata["proposalSha256"], proposal["proposalSha256"])
        self.assertIn("WALL_NOT_FOUND:y_max", source)
        self.assertIn("fixed-stride context sample", source)


class RunVerifierTests(unittest.TestCase):
    def _write_run(self, root: Path) -> Path:
        import verify_room_shape_run as verifier

        room = SyntheticRoom(step=0.18)
        proposal = room_shape.build_proposal(_measure(room), source_binding=_binding(room))
        proposal_path = root / "proposal.json"
        proposal_path.write_text(
            json.dumps(proposal, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        proposal_bytes = proposal_path.read_bytes()
        receipt = {
            "schemaVersion": verifier.RECEIPT_SCHEMA_VERSION,
            "generatedAt": "2026-08-04T00:00:00Z",
            "proposalSha256": proposal["proposalSha256"],
            "proposalFileName": proposal_path.name,
            "proposalFileSha256": hashlib.sha256(proposal_bytes).hexdigest(),
            "proposalFileBytes": len(proposal_bytes),
            "inputs": {
                "cloudFileName": "fixture.ply",
                "cloudSha256": "c" * 64,
                "cloudBytes": 1,
                "originsFileName": "origins.txt",
                "originsSha256": "d" * 64,
                "originsBytes": 1,
                "pointCount": int(room.points.shape[0]),
                "originCount": int(room.origins.shape[0]),
            },
            "diagnostics": [],
            "toolchain": {"python": "fixture", "numpy": "fixture", "platform": "fixture"},
            "parameters": {},
            "policy": {
                "sourceBytesMutated": False,
                "networkUsed": False,
                "selfApproved": False,
                "comparedAgainstExternalFigures": False,
            },
        }
        receipt["receiptSha256"] = hashlib.sha256(
            verifier.RECEIPT_DIGEST_DOMAIN + verifier._canonical(receipt)
        ).hexdigest()
        receipt_path = root / "receipt.json"
        receipt_path.write_text(
            json.dumps(receipt, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return receipt_path

    def test_verifier_accepts_a_bound_authority_none_run(self) -> None:
        import verify_room_shape_run as verifier

        with tempfile.TemporaryDirectory() as directory:
            receipt_path = self._write_run(Path(directory))
            result = verifier.verify_run(receipt_path)
        self.assertEqual(result["status"], "PASS_ROOM_SHAPE_RUN_INTEGRITY")
        self.assertEqual(result["authority"], "none")

    def test_verifier_rejects_mutated_proposal_bytes(self) -> None:
        import verify_room_shape_run as verifier

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt_path = self._write_run(root)
            proposal_path = root / "proposal.json"
            proposal_path.write_bytes(proposal_path.read_bytes() + b" ")
            with self.assertRaisesRegex(ValueError, "do not match"):
                verifier.verify_run(receipt_path)


if __name__ == "__main__":
    unittest.main()
