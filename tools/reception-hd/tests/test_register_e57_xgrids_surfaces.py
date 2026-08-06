from __future__ import annotations

import hashlib
import io
import json
import math
import os
from pathlib import Path
import struct
import sys
import tempfile
import types
import unittest
from unittest import mock

import numpy as np
from scipy.spatial import cKDTree


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

import register_e57_xgrids_surfaces as surfaces  # noqa: E402


def asymmetric_room() -> surfaces.SurfaceSet:
    points: list[list[float]] = []
    normals: list[list[float]] = []
    labels: list[int] = []

    def add(rows: list[list[float]], normal: list[float], label: int) -> None:
        points.extend(rows)
        normals.extend([normal] * len(rows))
        labels.extend([label] * len(rows))

    z_values = np.linspace(0.0, 3.0, 8)
    for y in np.linspace(0.0, 5.0, 15):
        add([[0.0, float(y), float(z)] for z in z_values], [-1.0, 0.0, 0.0], surfaces.LABEL_WALL)
    for y in np.linspace(0.0, 3.0, 11):
        add([[7.0, float(y), float(z)] for z in z_values], [1.0, 0.0, 0.0], surfaces.LABEL_WALL)
    for x in np.linspace(0.0, 7.0, 19):
        add([[float(x), 0.0, float(z)] for z in z_values], [0.0, -1.0, 0.0], surfaces.LABEL_WALL)
    for x in np.linspace(0.0, 3.0, 10):
        add([[float(x), 5.0, float(z)] for z in z_values], [0.0, 1.0, 0.0], surfaces.LABEL_WALL)
    # The partial interior wall deliberately breaks mirror symmetry.
    for y in np.linspace(2.0, 4.0, 9):
        add([[2.0, float(y), float(z)] for z in z_values], [1.0, 0.0, 0.0], surfaces.LABEL_WALL)
    floor_xy = [
        (float(x), float(y))
        for x in np.linspace(0.2, 6.8, 18)
        for y in np.linspace(0.2, 4.8, 14)
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


def deterministic_surface_variant(
    surface_set: surfaces.SurfaceSet,
    *,
    density: float,
    permutation_seed: int,
) -> surfaces.SurfaceSet:
    """Return a repeatable, class-balanced density and ordering variant."""

    selected_by_class: list[np.ndarray] = []
    for label in (surfaces.LABEL_WALL, surfaces.LABEL_FLOOR, surfaces.LABEL_CEILING):
        class_indexes = np.flatnonzero(surface_set.labels == label)
        keep_count = max(4, int(math.floor(class_indexes.size * density)))
        positions = np.linspace(0, class_indexes.size - 1, keep_count, dtype=np.int64)
        selected_by_class.append(class_indexes[positions])
    selected = np.concatenate(selected_by_class)
    permutation = np.random.default_rng(permutation_seed).permutation(selected.size)
    indexes = selected[permutation]
    return surfaces.SurfaceSet(
        surface_set.points[indexes],
        surface_set.normals[indexes],
        surface_set.labels[indexes],
        surface_set.weights[indexes],
    )


def mirror_symmetric_room() -> surfaces.SurfaceSet:
    # Use one physically continuous, reflection-symmetric room.  Mirroring the
    # asymmetric L-shaped fixture used to create two sampling lobes joined only
    # across a narrow artificial seam; that is not valid evidence for the
    # strengthened continuous-interior floor test exercised by the production
    # fitter.
    points: list[list[float]] = []
    normals: list[list[float]] = []
    labels: list[int] = []

    def add(rows: list[list[float]], normal: list[float], label: int) -> None:
        points.extend(rows)
        normals.extend([normal] * len(rows))
        labels.extend([label] * len(rows))

    z_values = np.linspace(0.0, 3.0, 8)
    for x, normal in ((-3.5, [-1.0, 0.0, 0.0]), (3.5, [1.0, 0.0, 0.0])):
        for y in np.linspace(0.0, 5.0, 15):
            add(
                [[float(x), float(y), float(z)] for z in z_values],
                normal,
                surfaces.LABEL_WALL,
            )
    for y, normal in ((0.0, [0.0, -1.0, 0.0]), (5.0, [0.0, 1.0, 0.0])):
        for x in np.linspace(-3.5, 3.5, 19):
            add(
                [[float(x), float(y), float(z)] for z in z_values],
                normal,
                surfaces.LABEL_WALL,
            )
    floor_xy = [
        (float(x), float(y))
        for x in np.linspace(-3.3, 3.3, 18)
        for y in np.linspace(0.2, 4.8, 14)
    ]
    add(
        [[x, y, 0.0] for x, y in floor_xy],
        [0.0, 0.0, 1.0],
        surfaces.LABEL_FLOOR,
    )
    add(
        [[x, y, 3.0] for x, y in floor_xy],
        [0.0, 0.0, 1.0],
        surfaces.LABEL_CEILING,
    )
    point_array = np.asarray(points, dtype=np.float64)
    return surfaces.SurfaceSet(
        point_array,
        np.asarray(normals, dtype=np.float64),
        np.asarray(labels, dtype=np.int8),
        np.ones(point_array.shape[0], dtype=np.float64),
    )


def yaw_degrees(rotation: np.ndarray) -> float:
    return math.degrees(math.atan2(float(rotation[1, 0]), float(rotation[0, 0])))


def wrapped_yaw_error_degrees(actual: float, expected: float) -> float:
    return abs((actual - expected + 180.0) % 360.0 - 180.0)


def fast_config(**changes: object) -> surfaces.StructuralConfig:
    values: dict[str, object] = {
        "fit_points_per_class": 180,
        "yaw_start_count": 12,
        "maximum_iterations": 12,
        "pca_neighbors": 12,
        "pca_max_neighbor_radius_m": 1.0,
    }
    values.update(changes)
    return surfaces.StructuralConfig(**values)


def plane_grid(z: float = 0.0, size: int = 20, spacing: float = 0.03) -> np.ndarray:
    return np.asarray(
        [[x * spacing, y * spacing, z] for x in range(size) for y in range(size)],
        dtype=np.float64,
    )


def x_axis_rotation_quaternion(degrees: float) -> np.ndarray:
    half_angle = math.radians(degrees) / 2.0
    return np.asarray(
        [math.cos(half_angle), math.sin(half_angle), 0.0, 0.0],
        dtype=np.float64,
    )


class GaussianTests(unittest.TestCase):
    def test_covariance_normal_uses_smallest_axis_and_wxyz_candidate(self) -> None:
        scales = np.log(np.asarray([[0.01, 0.08, 0.12], [0.01, 0.08, 0.12]]))
        angle = math.pi / 2.0
        quaternions = np.asarray(
            [[1.0, 0.0, 0.0, 0.0], [math.cos(angle / 2), 0.0, 0.0, math.sin(angle / 2)]],
            dtype=np.float64,
        )
        normals, decoded_scales = surfaces.gaussian_covariance_normals(scales, quaternions, np)
        np.testing.assert_allclose(decoded_scales, np.exp(scales), atol=1e-12)
        np.testing.assert_allclose(normals[0], [1.0, 0.0, 0.0], atol=1e-12)
        np.testing.assert_allclose(normals[1], [0.0, 1.0, 0.0], atol=1e-12)

    def test_filter_is_visible_planar_and_bounded(self) -> None:
        count = 32
        positions = np.column_stack((np.arange(count) * 0.01, np.zeros(count), np.zeros(count)))
        opacity = np.full(count, 2.0)
        scales = np.tile(np.log([0.01, 0.05, 0.08]), (count, 1))
        quaternions = np.tile([1.0, 0.0, 0.0, 0.0], (count, 1))
        opacity[0] = -20.0
        scales[1] = np.log([0.04, 0.04, 0.04])
        positions[2, 0] = 10_000.0
        points, _normals, _weights, evidence = surfaces.filter_gaussian_surfaces(
            positions,
            opacity,
            scales,
            quaternions,
            config=fast_config(),
            np=np,
        )
        self.assertEqual(29, points.shape[0])
        self.assertEqual(1, evidence["rejectedCountsNotMutuallyExclusive"]["invisible"])
        self.assertEqual(1, evidence["rejectedCountsNotMutuallyExclusive"]["positionOutOfBounds"])
        self.assertEqual(1, evidence["rejectedCountsNotMutuallyExclusive"]["notPlanarOrNeedleLike"])

    def test_wrong_wxyz_convention_is_refused(self) -> None:
        positions = plane_grid()
        scales = np.tile(np.log([0.06, 0.01, 0.08]), (positions.shape[0], 1))
        # The smallest axis is local Y. As xyzw, these fields become a +90
        # degree X rotation and map local Y to Z. As wxyz, they are a +90
        # degree Z rotation and leave the normal in XY, contradicting the plane.
        quaternions = np.tile(
            [math.sqrt(0.5), 0.0, 0.0, math.sqrt(0.5)],
            (positions.shape[0], 1),
        )
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces.assess_gaussian_normal_convention(
                positions,
                scales,
                quaternions,
                query_limit=200,
                config=fast_config(pca_neighbors=12, pca_max_neighbor_radius_m=0.2),
                np=np,
                cKDTree=cKDTree,
            )
        self.assertEqual("WXYZ_NORMAL_CONVENTION_CONTRADICTED", caught.exception.code)

    def test_relative_wxyz_advantage_cannot_override_bad_absolute_coherence(self) -> None:
        positions = plane_grid()
        scales = np.tile(np.log([0.06, 0.01, 0.08]), (positions.shape[0], 1))
        # The WXYZ interpretation is 30 degrees from the measured plane normal.
        # XYZW is even worse at 90 degrees, but "less wrong" is not safe enough
        # to let production fitting continue.
        quaternions = np.tile(
            x_axis_rotation_quaternion(60.0),
            (positions.shape[0], 1),
        )
        evidence = surfaces.assess_gaussian_normal_convention(
            positions,
            scales,
            quaternions,
            query_limit=200,
            config=fast_config(pca_neighbors=12, pca_max_neighbor_radius_m=0.2),
            np=np,
            cKDTree=cKDTree,
        )
        self.assertEqual(
            "covariance_normals_rejected_use_source_local_pca",
            evidence["status"],
        )
        self.assertFalse(evidence["useCovarianceNormalsForFit"])
        self.assertEqual(
            {
                "passed": False,
                "maximumMedianUnsignedAngleDegrees": 20.0,
                "minimumFractionWithin15Degrees": 0.5,
                "failureRule": "reject_if_either_threshold_fails",
                "reasons": [
                    "median_unsigned_angle_exceeds_20_degrees",
                    "fraction_within_15_degrees_below_0.5",
                ],
            },
            evidence["absoluteCoherenceGate"],
        )

    def test_absolute_coherence_fraction_gate_is_not_replaced_by_median(self) -> None:
        positions = plane_grid()
        scales = np.tile(np.log([0.06, 0.01, 0.08]), (positions.shape[0], 1))
        # The median is 19 degrees, inside the 20-degree limit, but fewer than
        # half of the normals are within 15 degrees. Either failed threshold
        # must stop fitting even though WXYZ decisively beats XYZW.
        quaternions = np.vstack(
            [
                x_axis_rotation_quaternion(80.0)
                if index % 5 < 2
                else x_axis_rotation_quaternion(71.0)
                for index in range(positions.shape[0])
            ]
        )
        evidence = surfaces.assess_gaussian_normal_convention(
            positions,
            scales,
            quaternions,
            query_limit=200,
            config=fast_config(pca_neighbors=12, pca_max_neighbor_radius_m=0.2),
            np=np,
            cKDTree=cKDTree,
        )
        self.assertEqual(
            "covariance_normals_rejected_use_source_local_pca",
            evidence["status"],
        )
        self.assertFalse(evidence["useCovarianceNormalsForFit"])
        self.assertEqual(
            {
                "passed": False,
                "maximumMedianUnsignedAngleDegrees": 20.0,
                "minimumFractionWithin15Degrees": 0.5,
                "failureRule": "reject_if_either_threshold_fails",
                "reasons": ["fraction_within_15_degrees_below_0.5"],
            },
            evidence["absoluteCoherenceGate"],
        )

    def test_strong_wxyz_coherence_passes_with_plain_absolute_gate_evidence(self) -> None:
        positions = plane_grid()
        scales = np.tile(np.log([0.06, 0.01, 0.08]), (positions.shape[0], 1))
        quaternions = np.tile(
            x_axis_rotation_quaternion(90.0),
            (positions.shape[0], 1),
        )
        evidence = surfaces.assess_gaussian_normal_convention(
            positions,
            scales,
            quaternions,
            query_limit=200,
            config=fast_config(pca_neighbors=12, pca_max_neighbor_radius_m=0.2),
            np=np,
            cKDTree=cKDTree,
        )
        self.assertEqual(
            "wxyz_meets_absolute_coherence_thresholds_but_not_proven",
            evidence["status"],
        )
        self.assertTrue(evidence["useCovarianceNormalsForFit"])
        self.assertEqual(
            {
                "passed": True,
                "maximumMedianUnsignedAngleDegrees": 20.0,
                "minimumFractionWithin15Degrees": 0.5,
                "failureRule": "reject_if_either_threshold_fails",
                "reasons": [],
            },
            evidence["absoluteCoherenceGate"],
        )
        self.assertEqual(0.0, evidence["wxyz"]["medianUnsignedAngleDegrees"])
        self.assertEqual(1.0, evidence["wxyz"]["fractionWithin15Degrees"])
        self.assertGreater(
            evidence["wxyzMedianAngleAdvantageDegrees"],
            80.0,
        )

    def test_binary_parser_requires_exact_source_fields_and_ignores_nx(self) -> None:
        helper = surfaces._get_alignment()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "gaussians.ply"
            names = list(surfaces.GAUSSIAN_FIELDS) + ["nx"]
            header = (
                "ply\nformat binary_little_endian 1.0\n"
                "element vertex 32\n"
                + "".join(f"property float {name}\n" for name in names)
                + "end_header\n"
            ).encode("ascii")
            rows = []
            for index in range(32):
                values = [
                    float(index), 0.0, 0.0, 2.0,
                    math.log(0.01), math.log(0.05), math.log(0.08),
                    1.0, 0.0, 0.0, 0.0,
                    999.0,
                ]
                rows.append(struct.pack("<" + "f" * len(values), *values))
            path.write_bytes(header + b"".join(rows))
            stat = path.stat()
            snapshot = helper.FileSnapshot(stat.st_size, stat.st_mtime_ns, stat.st_ino, stat.st_dev)
            layout = helper._read_ply_header(path, snapshot)
            decoded, evidence = surfaces.load_gaussian_ply_sample(
                path, snapshot, layout, 32, "unit", np
            )
            self.assertEqual((32, 3), decoded["positions"].shape)
            self.assertIn("nx", evidence["additionalFieldsIgnored"])
            self.assertFalse(evidence["storedNxNyNzUsed"])
            self.assertTrue(evidence["sequentialVertexRegionRead"])
            self.assertTrue(evidence["allDeclaredVertexBytesRead"])
            self.assertTrue(evidence["allDeclaredVerticesDecoded"])
            self.assertIn("bounded sequential", evidence["sampleMethod"])
            np.testing.assert_allclose(decoded["positions"][:, 0], np.arange(32))

            missing_layout = helper.PlyLayout(
                layout.format_name,
                layout.vertex_count,
                tuple(prop for prop in layout.vertex_properties if prop.name != "opacity"),
                layout.data_offset,
                layout.vertex_stride_bytes - 4,
                layout.header_sha256,
            )
            with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                surfaces.validate_gaussian_ply_layout(missing_layout)
            self.assertEqual("MISSING_GAUSSIAN_FIELD", caught.exception.code)

    def test_sparse_sorted_reader_restores_deterministic_sample_order(self) -> None:
        helper = surfaces._get_alignment()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sparse-gaussians.ply"
            vertex_count = 3_000
            names = list(surfaces.GAUSSIAN_FIELDS)
            header = (
                "ply\nformat binary_little_endian 1.0\n"
                f"element vertex {vertex_count}\n"
                + "".join(f"property float {name}\n" for name in names)
                + "end_header\n"
            ).encode("ascii")
            rows = []
            for index in range(vertex_count):
                values = [
                    float(index), 0.0, 0.0, 2.0,
                    math.log(0.01), math.log(0.05), math.log(0.08),
                    1.0, 0.0, 0.0, 0.0,
                ]
                rows.append(struct.pack("<" + "f" * len(values), *values))
            path.write_bytes(header + b"".join(rows))
            stat = path.stat()
            snapshot = helper.FileSnapshot(
                stat.st_size, stat.st_mtime_ns, stat.st_ino, stat.st_dev
            )
            layout = helper._read_ply_header(path, snapshot)
            decoded, evidence = surfaces.load_gaussian_ply_sample(
                path, snapshot, layout, 24, "sparse-unit", np
            )
            expected = helper._deterministic_indices(vertex_count, 24, "sparse-unit")
            np.testing.assert_allclose(decoded["positions"][:, 0], expected)
            self.assertFalse(evidence["sequentialVertexRegionRead"])
            self.assertFalse(evidence["allDeclaredVertexBytesRead"])
            self.assertFalse(evidence["allDeclaredVerticesDecoded"])
            self.assertIn("sparse sorted", evidence["sampleMethod"])

    def test_sequential_and_sparse_readers_decode_identical_samples(self) -> None:
        helper = surfaces._get_alignment()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "equivalent-readers.ply"
            vertex_count = 300
            names = list(surfaces.GAUSSIAN_FIELDS)
            header = (
                "ply\nformat binary_little_endian 1.0\n"
                f"element vertex {vertex_count}\n"
                + "".join(f"property float {name}\n" for name in names)
                + "end_header\n"
            ).encode("ascii")
            rows = []
            for index in range(vertex_count):
                values = [
                    float(index), float(index % 7), float(index % 11), 2.0,
                    math.log(0.01), math.log(0.05), math.log(0.08),
                    1.0, 0.0, 0.0, 0.0,
                ]
                rows.append(struct.pack("<" + "f" * len(values), *values))
            path.write_bytes(header + b"".join(rows))
            stat = path.stat()
            snapshot = helper.FileSnapshot(
                stat.st_size, stat.st_mtime_ns, stat.st_ino, stat.st_dev
            )
            layout = helper._read_ply_header(path, snapshot)
            with mock.patch.object(
                surfaces, "GAUSSIAN_SEQUENTIAL_SAMPLE_DENSITY_THRESHOLD", 0.0
            ):
                sequential, sequential_evidence = surfaces.load_gaussian_ply_sample(
                    path, snapshot, layout, 24, "equivalent-unit", np
                )
            with mock.patch.object(
                surfaces, "GAUSSIAN_SEQUENTIAL_SAMPLE_DENSITY_THRESHOLD", 2.0
            ):
                sparse, sparse_evidence = surfaces.load_gaussian_ply_sample(
                    path, snapshot, layout, 24, "equivalent-unit", np
                )
            for field in sequential:
                np.testing.assert_array_equal(sequential[field], sparse[field])
            self.assertTrue(sequential_evidence["sequentialVertexRegionRead"])
            self.assertFalse(sparse_evidence["sequentialVertexRegionRead"])


class PcaAndClassificationTests(unittest.TestCase):
    def test_distant_neighbors_cannot_form_fake_local_plane(self) -> None:
        points = plane_grid(size=10, spacing=1.0)
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces.estimate_local_pca_surfaces(
                points,
                query_limit=100,
                seed="radius",
                config=fast_config(pca_neighbors=8, pca_max_neighbor_radius_m=0.2),
                np=np,
                cKDTree=cKDTree,
            )
        self.assertEqual("INSUFFICIENT_E57_PLANAR_POINTS", caught.exception.code)

    def test_wall_floor_and_ceiling_are_classified(self) -> None:
        room = asymmetric_room()
        classified, evidence = surfaces.classify_zup_surfaces(
            room.points,
            room.normals,
            room.weights,
            config=fast_config(),
            np=np,
        )
        self.assertEqual(room.points.shape[0], classified.points.shape[0])
        self.assertGreater(evidence["classCounts"]["wall"], 100)
        self.assertGreater(evidence["classCounts"]["floor"], 100)
        self.assertGreater(evidence["classCounts"]["ceiling"], 100)


class FitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = asymmetric_room()
        self.rotation = surfaces.yaw_rotation(math.radians(32.0), np)
        self.translation = np.asarray([4.2, -1.3, 0.25])
        self.target = surfaces.transform_surfaces(self.source, self.rotation, self.translation, np)
        self.config = fast_config()

    def assert_recovers_known_transform(
        self,
        source: surfaces.SurfaceSet,
        target: surfaces.SurfaceSet,
        *,
        expected_yaw_degrees: float,
        expected_translation: np.ndarray,
        config: surfaces.StructuralConfig,
    ) -> None:
        recovered_rotation, recovered_translation, _trace = surfaces.fit_structural_zup_family(
            source,
            target,
            mirrored=False,
            config=config,
            np=np,
            cKDTree=cKDTree,
        )
        yaw_error = wrapped_yaw_error_degrees(
            yaw_degrees(recovered_rotation), expected_yaw_degrees
        )
        translation_error = float(np.linalg.norm(recovered_translation - expected_translation))
        with self.subTest(metric="yaw"):
            self.assertLessEqual(
                yaw_error,
                0.5,
                f"recovered yaw is wrong by {yaw_error:.6f} degrees",
            )
        with self.subTest(metric="translation"):
            self.assertLessEqual(
                translation_error,
                0.05,
                f"recovered translation is wrong by {translation_error:.6f} metres",
            )

    def test_default_fit_recovers_known_asymmetric_room_transform(self) -> None:
        self.assert_recovers_known_transform(
            self.source,
            self.target,
            expected_yaw_degrees=32.0,
            expected_translation=self.translation,
            config=surfaces.StructuralConfig(),
        )

    def test_default_fit_recovers_off_grid_yaws_across_densities_and_orders(self) -> None:
        cases = (
            (7.25, 1.00, 7101),
            (22.75, 0.75, 2275),
            (37.25, 0.55, 3755),
        )
        for expected_yaw, density, seed in cases:
            with self.subTest(yaw=expected_yaw, density=density, seed=seed):
                source = deterministic_surface_variant(
                    asymmetric_room(), density=density, permutation_seed=seed
                )
                expected_translation = np.asarray([1.25, -2.75, 0.4], dtype=np.float64)
                target = surfaces.transform_surfaces(
                    source,
                    surfaces.yaw_rotation(math.radians(expected_yaw), np),
                    expected_translation,
                    np,
                )
                target = deterministic_surface_variant(
                    target, density=1.0, permutation_seed=seed + 1
                )
                self.assert_recovers_known_transform(
                    source,
                    target,
                    expected_yaw_degrees=expected_yaw,
                    expected_translation=expected_translation,
                    config=surfaces.StructuralConfig(),
                )

    def test_proper_family_beats_separately_optimized_mirror(self) -> None:
        proper_r, proper_t, proper_trace = surfaces.fit_structural_zup_family(
            self.source,
            self.target,
            mirrored=False,
            config=self.config,
            np=np,
            cKDTree=cKDTree,
        )
        mirror_r, mirror_t, mirror_trace = surfaces.fit_structural_zup_family(
            self.source,
            self.target,
            mirrored=True,
            config=self.config,
            np=np,
            cKDTree=cKDTree,
        )
        self.assertAlmostEqual(1.0, float(np.linalg.det(proper_r)), places=10)
        self.assertAlmostEqual(-1.0, float(np.linalg.det(mirror_r)), places=10)
        self.assertLess(proper_trace["fitScore"], mirror_trace["fitScore"] * 0.65)
        np.testing.assert_allclose(proper_r[:, 2], [0.0, 0.0, 1.0], atol=1e-12)
        self.assertEqual(1.0, surfaces._matrix_evidence(proper_r, proper_t, np)["fixedScale"])
        self.assertEqual(1.0, surfaces._matrix_evidence(mirror_r, mirror_t, np)["fixedScale"])

    def test_fit_is_deterministic(self) -> None:
        first = surfaces.fit_structural_zup_family(
            self.source, self.target, mirrored=False, config=self.config, np=np, cKDTree=cKDTree
        )
        second = surfaces.fit_structural_zup_family(
            self.source, self.target, mirrored=False, config=self.config, np=np, cKDTree=cKDTree
        )
        np.testing.assert_array_equal(first[0], second[0])
        np.testing.assert_array_equal(first[1], second[1])
        self.assertEqual(first[2], second[2])

    def test_raw_outliers_are_not_hidden_by_closest_ninety_percent(self) -> None:
        count = self.source.points.shape[0] // 9
        far = surfaces.SurfaceSet(
            self.source.points[:count] + np.asarray([20.0, 0.0, 0.0]),
            self.source.normals[:count],
            self.source.labels[:count],
            self.source.weights[:count],
        )
        contaminated = surfaces.SurfaceSet(
            np.vstack((self.source.points, far.points)),
            np.vstack((self.source.normals, far.normals)),
            np.concatenate((self.source.labels, far.labels)),
            np.concatenate((self.source.weights, far.weights)),
        )
        metrics = surfaces.evaluate_structural_alignment(
            contaminated,
            self.source,
            np.eye(3),
            np.zeros(3),
            np=np,
            cKDTree=cKDTree,
        )
        wall = metrics["sourceToTarget"]["classes"]["wall"]
        self.assertGreater(wall["rawNearestDistanceMeters"]["rmse"], 1.0)
        self.assertLess(wall["fixedDistanceCoverageFractions"]["within500mm"], 1.0)
        self.assertTrue(wall["scoreUsesAllClassifiedSurfaces"])
        self.assertGreater(wall["score"], wall["nearestDistanceMetersWithinClosest90Percent"]["rmse"])

    def test_fit_crop_is_defined_without_validation(self) -> None:
        low, high, evidence = surfaces.derive_fit_supported_crop(self.target, np=np)
        self.assertTrue(evidence["derivedOnlyFromFrozenFitSurfaces"])
        self.assertFalse(evidence["validationExaminedDuringCropDefinition"])
        shifted_validation = surfaces.transform_surfaces(
            self.target, np.eye(3), np.asarray([100.0, 100.0, 100.0]), np
        )
        low_again, high_again, _ = surfaces.derive_fit_supported_crop(self.target, np=np)
        np.testing.assert_array_equal(low, low_again)
        np.testing.assert_array_equal(high, high_again)
        self.assertGreater(float(np.min(shifted_validation.points[:, 0])), float(high[0]))


class LeakageAndPostureTests(unittest.TestCase):
    def test_frozen_test_scan_is_rejected_from_both_roles(self) -> None:
        points = np.zeros((32, 3), dtype=np.float64)
        for role in ("fit", "validation"):
            with self.subTest(role=role), self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                surfaces.validate_scan_mapping({126: points}, role, np=np, require_all=False)
            self.assertEqual("FROZEN_TEST_LEAK", caught.exception.code)

    def test_per_scan_validation_requires_only_frozen_validation_ids(self) -> None:
        room = asymmetric_room()
        with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
            surfaces.evaluate_validation_scans_separately(
                room,
                {126: room, 134: room, 138: room},
                np.eye(3),
                np.zeros(3),
                np.diag([-1.0, 1.0, 1.0]),
                np.zeros(3),
                np.min(room.points, axis=0) - 1.0,
                np.max(room.points, axis=0) + 1.0,
                config=fast_config(),
                np=np,
                cKDTree=cKDTree,
            )
        self.assertEqual("FROZEN_TEST_LEAK", caught.exception.code)

    def test_document_is_authority_none_even_when_proper_wins(self) -> None:
        room = asymmetric_room()
        rotation = surfaces.yaw_rotation(math.radians(32.0), np)
        target = surfaces.transform_surfaces(room, rotation, np.asarray([4.2, -1.3, 0.25]), np)
        document, _overlays = surfaces.build_structural_diagnostic(
            room,
            target,
            target,
            config=fast_config(),
            np=np,
            cKDTree=cKDTree,
        )
        self.assertEqual("none", document["authority"])
        self.assertFalse(document["decision"]["eligibleForT505Completion"])
        self.assertFalse(document["decision"]["eligibleForTransformRegistration"])
        self.assertTrue(document["fit"]["forbiddenMirrorControl"]["mayNeverBeRegisteredOrUsedAsPhysicalTransform"])
        self.assertFalse(document["frozenTest"]["geometryRequested"])

    def test_mirror_symmetric_geometry_reports_indeterminate_handedness(self) -> None:
        room = mirror_symmetric_room()
        document, _overlays = surfaces.build_structural_diagnostic(
            room,
            room,
            room,
            config=surfaces.StructuralConfig(),
            np=np,
            cKDTree=cKDTree,
        )
        self.assertEqual(
            "sample_scores_tied",
            document["frozenValidation"]["samplePreference"],
        )
        self.assertFalse(document["frozenValidation"]["provesPhysicalHandedness"])

    def test_visual_overlay_is_png_and_keeps_blocked_banner(self) -> None:
        self.assertIn("AUTHORITY NONE", surfaces.PRIVATE_BLOCKED_BANNER)
        self.assertIn("not decoded/scored", surfaces.PRIVATE_BLOCKED_BANNER)
        self.assertIn("container bytes hashed", surfaces.PRIVATE_BLOCKED_BANNER)
        self.assertNotIn("not read", surfaces.PRIVATE_BLOCKED_BANNER)
        room = asymmetric_room()
        payload = surfaces.render_comparison_png(
            {"validation": room, "proper": room, "mirror": room}, "top", np=np
        )
        self.assertTrue(payload.startswith(b"\x89PNG\r\n\x1a\n"))


class PublicationAndPinTests(unittest.TestCase):
    def test_execute_wires_per_scan_validation_only_into_diagnostic_builder(self) -> None:
        room = asymmetric_room()
        validation_map = {scan: room for scan in surfaces.VALIDATION_SCAN_IDS}
        arguments = types.SimpleNamespace(
            stage_manifest=Path("stage.json"),
            reception_evidence=Path("evidence.json"),
            xgrids_root=Path("xgrids"),
            xgrids_ply=Path("cloud.ply"),
            xgrids_poses=Path("poses.json"),
            scan_range="122-144",
            output=Path("result.json"),
            verify_e57_bytes=True,
            expected_stage_manifest_sha256="1" * 64,
            expected_reception_evidence_sha256="2" * 64,
            expected_ply_sha256="3" * 64,
            expected_poses_sha256="4" * 64,
            points_per_scan=64,
            pca_query_points_per_scan=32,
            xgrids_sample_gaussians=64,
        )
        parser = mock.Mock()
        parser.parse_args.return_value = arguments
        helper = mock.Mock()
        helper._load_geometry_dependencies.return_value = (np, object(), cKDTree, {})
        helper._read_e57_point_samples.return_value = (
            {scan: np.zeros((32, 3)) for scan in surfaces.DIAGNOSTIC_SCAN_IDS},
            {},
        )
        bundle = types.SimpleNamespace(
            paths={"xgridsPly": Path("cloud.ply"), "e57": Path("scan.e57")},
            snapshots={"xgridsPly": object(), "e57": object()},
            ply_layout=object(),
            evidence={"xgridsPly": {"sha256": "a" * 64}},
            protected_roots=(),
        )
        helper.inspect_inputs.return_value = bundle
        gaussian = {
            "positions": np.zeros((32, 3)),
            "opacityLogits": np.zeros(32),
            "logScales": np.zeros((32, 3)),
            "quaternionsWxyz": np.zeros((32, 4)),
        }
        e57_results = [
            (room, {"role": "fit"}, {}),
            (room, {"role": "validation"}, validation_map),
        ]
        diagnostic = {
            "authority": "none",
            "status": "private_structural_cv_diagnostic_t505_blocked",
            "frozenTest": {},
        }
        overlays = {"validation": room, "proper": room, "mirror": room}
        with (
            mock.patch.object(surfaces, "verify_alignment_tool_pin", return_value={}),
            mock.patch.object(surfaces, "build_parser", return_value=parser),
            mock.patch.object(surfaces, "_get_alignment", return_value=helper),
            mock.patch.object(surfaces, "load_gaussian_ply_sample", return_value=(gaussian, {})),
            mock.patch.object(
                surfaces,
                "filter_gaussian_surfaces",
                return_value=(room.points, room.normals, room.weights, {}),
            ),
            mock.patch.object(
                surfaces,
                "assess_gaussian_normal_convention",
                return_value={"useCovarianceNormalsForFit": True},
            ),
            mock.patch.object(surfaces, "gaussian_mask_sensitivity", return_value={}),
            mock.patch.object(
                surfaces,
                "classify_zup_surfaces",
                return_value=(room, {}),
            ),
            mock.patch.object(
                surfaces,
                "e57_surface_set_from_scans",
                side_effect=e57_results,
            ) as e57_builder,
            mock.patch.object(
                surfaces,
                "build_structural_diagnostic",
                return_value=(diagnostic, overlays),
            ) as diagnostic_builder,
            mock.patch.object(surfaces, "render_comparison_png", return_value=b"png"),
        ):
            document = surfaces.execute(
                [], e57_adapter=object(), write_output=False
            )
        self.assertEqual("none", document["authority"])
        self.assertTrue(
            document["frozenTest"][
                "completeE57ContainerBytesReadForWholeFileHashVerification"
            ]
        )
        self.assertFalse(document["frozenTest"]["wholeFileHashingDecodedStationGeometry"])
        self.assertIsNone(document["frozenTest"]["geometryDecoded"])
        for field in (
            "geometrySampled",
            "geometryRendered",
            "geometryFitted",
            "geometryScored",
        ):
            self.assertIsNone(document["frozenTest"][field])
        self.assertEqual(
            "not independently verifiable inside injected adapter",
            document["frozenTest"]["geometryDecodeStatus"],
        )
        self.assertIsNone(
            document["safety"]["frozenTestStationGeometryDecodedOrUsed"]
        )
        self.assertFalse(
            document["surfaceEvidence"]["e57Read"]["adapter"][
                "decodeBoundaryEnforcedByPinnedDefaultAdapter"
            ]
        )
        self.assertEqual(
            "not independently verifiable inside injected adapter",
            document["scope"]["testScanGeometryDecodeSampleRenderFitScoreStatus"],
        )
        self.assertEqual(2, e57_builder.call_count)
        for call in e57_builder.call_args_list:
            self.assertNotIn("validation_by_scan", call.kwargs)
        self.assertIs(
            validation_map,
            diagnostic_builder.call_args.kwargs["validation_by_scan"],
        )
        tool_payload = Path(surfaces.__file__).read_bytes()
        self.assertEqual(
            hashlib.sha256(tool_payload).hexdigest(),
            document["runtime"]["structuralTool"]["sha256"],
        )
        self.assertEqual(
            len(tool_payload), document["runtime"]["structuralTool"]["sizeBytes"]
        )
        self.assertEqual(
            surfaces.StructuralConfig().plane_max_count,
            document["runtime"]["configuration"]["plane_max_count"],
        )

    def test_injected_e57_adapter_cannot_publish_artifacts(self) -> None:
        parser = mock.Mock()
        parser.parse_args.return_value = types.SimpleNamespace()
        with (
            mock.patch.object(surfaces, "verify_alignment_tool_pin", return_value={}),
            mock.patch.object(surfaces, "build_parser", return_value=parser),
        ):
            with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                surfaces.execute([], e57_adapter=object(), write_output=True)
        self.assertEqual(
            "CUSTOM_E57_ADAPTER_PUBLICATION_FORBIDDEN",
            caught.exception.code,
        )

    def test_helper_source_is_pinned_before_exact_byte_execution(self) -> None:
        source = Path(surfaces.__file__).read_text(encoding="utf-8")
        self.assertNotIn("import align_e57_xgrids", source)
        self.assertIn("compile(payload", source)
        pin = surfaces.verify_alignment_tool_pin()
        self.assertEqual(surfaces.EXPECTED_ALIGNMENT_TOOL_SHA256, pin["sha256"])
        helper = surfaces._get_alignment()
        self.assertEqual(str(surfaces.ALIGNMENT_TOOL_PATH), helper.__file__)
        with mock.patch.object(surfaces, "EXPECTED_ALIGNMENT_TOOL_SHA256", "0" * 64):
            with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                surfaces.verify_alignment_tool_pin()
            self.assertEqual("ALIGNMENT_TOOL_PIN_MISMATCH", caught.exception.code)

    def test_receipt_is_published_last_as_commit_marker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {
                "receipt": root / "result.json",
                "top": root / "result-top.png",
                "side": root / "result-side.png",
            }
            payloads = {"receipt": b"{}\n", "top": b"top", "side": b"side"}
            original_link = os.link
            order: list[str] = []

            def recording_link(source: object, target: object, *args: object, **kwargs: object) -> None:
                order.append(Path(target).name)
                original_link(source, target, *args, **kwargs)

            with mock.patch.object(surfaces.os, "link", side_effect=recording_link):
                surfaces._write_artifacts_create_only(
                    paths, payloads, protected_paths=(), protected_roots=()
                )
            self.assertEqual(["result-top.png", "result-side.png", "result.json"], order)
            self.assertEqual(b"{}\n", paths["receipt"].read_bytes())

    def test_publication_failure_removes_partial_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {
                "receipt": root / "result.json",
                "top": root / "result-top.png",
                "side": root / "result-side.png",
            }
            payloads = {"receipt": b"{}\n", "top": b"top", "side": b"side"}
            original_link = os.link

            def fail_on_side(source: object, target: object, *args: object, **kwargs: object) -> None:
                if Path(target).name.endswith("side.png"):
                    raise OSError("injected")
                original_link(source, target, *args, **kwargs)

            with mock.patch.object(surfaces.os, "link", side_effect=fail_on_side):
                with self.assertRaises(surfaces.SurfaceAlignmentError):
                    surfaces._write_artifacts_create_only(
                        paths, payloads, protected_paths=(), protected_roots=()
                    )
            self.assertFalse(any(path.exists() for path in paths.values()))

    def test_publication_reports_unconfirmed_cleanup_and_residual_name(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {
                "receipt": root / "result.json",
                "top": root / "result-top.png",
                "side": root / "result-side.png",
            }
            payloads = {"receipt": b"{}\n", "top": b"top", "side": b"side"}
            original_link = os.link
            original_unlink = Path.unlink

            def fail_on_side(source: object, target: object, *args: object, **kwargs: object) -> None:
                if Path(target).name.endswith("side.png"):
                    raise OSError("injected publication failure")
                original_link(source, target, *args, **kwargs)

            def fail_top_cleanup(path: Path, *args: object, **kwargs: object) -> None:
                if path.name == "result-top.png":
                    raise OSError("injected cleanup failure")
                original_unlink(path, *args, **kwargs)

            with (
                mock.patch.object(surfaces.os, "link", side_effect=fail_on_side),
                mock.patch.object(Path, "unlink", new=fail_top_cleanup),
            ):
                with self.assertRaises(surfaces.SurfaceAlignmentError) as caught:
                    surfaces._write_artifacts_create_only(
                        paths, payloads, protected_paths=(), protected_roots=()
                    )
            self.assertEqual("OUTPUT_CLEANUP_UNCONFIRMED", caught.exception.code)
            self.assertIn("result-top.png", caught.exception.message)
            self.assertTrue(paths["top"].exists())

    def test_main_does_not_claim_artifacts_absent_after_output_cleanup_error(self) -> None:
        output = io.StringIO()
        error = surfaces.SurfaceAlignmentError(
            "OUTPUT_CLEANUP_UNCONFIRMED",
            "inspect result-top.png",
        )
        with (
            mock.patch.object(surfaces, "execute", side_effect=error),
            mock.patch.object(surfaces.sys, "stdout", output),
        ):
            status = surfaces.main([])
        self.assertEqual(2, status)
        payload = json.loads(output.getvalue())
        self.assertEqual(
            "error_artifact_state_requires_inspection",
            payload["status"],
        )
        self.assertFalse(payload["artifactsConfirmedAbsent"])


if __name__ == "__main__":
    unittest.main()
