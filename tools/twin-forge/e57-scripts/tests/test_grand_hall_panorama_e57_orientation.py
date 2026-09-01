from __future__ import annotations

from dataclasses import replace
import json
import unittest

import numpy as np

import grand_hall_panorama_e57_orientation as core


PANORAMA_SHA = "sha256:" + "a1" * 32
DATA3D_GUID = "b2" * 16


def _rotation() -> np.ndarray:
    axis = np.asarray([0.3, -0.5, 0.8], dtype=np.float64)
    axis /= np.linalg.norm(axis)
    angle = 0.71
    cross = np.asarray(
        [
            [0.0, -axis[2], axis[1]],
            [axis[2], 0.0, -axis[0]],
            [-axis[1], axis[0], 0.0],
        ]
    )
    return (
        np.eye(3) * np.cos(angle)
        + (1.0 - np.cos(angle)) * np.outer(axis, axis)
        + np.sin(angle) * cross
    )


def _synthetic_matches(
    *, reflected: bool = True, outlier_count: int = 24
) -> tuple[np.ndarray, np.ndarray, np.ndarray, core.MatchPartition]:
    random = np.random.default_rng(745)
    source = random.normal(size=(180, 3))
    source /= np.linalg.norm(source, axis=1, keepdims=True)
    reflection = np.asarray(core.SCANNER_Y_REFLECTION) if reflected else np.eye(3)
    target = source @ reflection.T @ _rotation().T
    target += random.normal(scale=0.001, size=target.shape)
    target /= np.linalg.norm(target, axis=1, keepdims=True)
    if outlier_count:
        target[:outlier_count] = random.normal(size=(outlier_count, 3))
        target[:outlier_count] /= np.linalg.norm(
            target[:outlier_count], axis=1, keepdims=True
        )
    faces = np.arange(len(source), dtype=np.int64) % 6
    partition = core.build_match_partition(
        PANORAMA_SHA,
        DATA3D_GUID,
        faces,
        np.arange(len(source), dtype=np.int64) * 2,
        np.arange(len(source), dtype=np.int64) * 3,
    )
    return source, target, faces, partition


def _fast_thresholds() -> core.OrientationThresholds:
    return core.OrientationThresholds(
        fold_ransac_iterations=70,
        final_ransac_iterations=140,
        minimum_correspondences=15,
        minimum_final_inliers=12,
        minimum_held_out_inliers=10,
        minimum_inliers_per_supported_face=1,
    )


class GrandHallPanoramaE57OrientationTests(unittest.TestCase):
    def test_identity_partition_is_order_independent_and_face_balanced(self) -> None:
        source, _target, faces, original = _synthetic_matches(outlier_count=0)
        permutation = np.random.default_rng(19).permutation(len(source))
        shuffled = core.build_match_partition(
            PANORAMA_SHA,
            DATA3D_GUID,
            faces[permutation],
            (np.arange(len(source)) * 2)[permutation],
            (np.arange(len(source)) * 3)[permutation],
        )
        original_by_query = {
            int(query): int(fold)
            for query, fold in zip(np.arange(len(source)) * 2, original.fold_indices)
        }
        shuffled_by_query = {
            int(query): int(fold)
            for query, fold in zip(
                (np.arange(len(source)) * 2)[permutation], shuffled.fold_indices
            )
        }
        self.assertEqual(original_by_query, shuffled_by_query)
        for face in range(6):
            counts = np.bincount(original.fold_indices[faces == face], minlength=5)
            self.assertLessEqual(int(counts.max() - counts.min()), 1)
        expected_seed = int.from_bytes(
            __import__("hashlib").sha256(
                (PANORAMA_SHA + DATA3D_GUID).encode("utf-8")
            ).digest()[:8],
            "little",
        )
        self.assertEqual(original.seed, expected_seed)

    def test_identity_partition_rejects_duplicate_or_noncanonical_identity(self) -> None:
        faces = np.asarray([0] * 15, dtype=np.int64)
        query = np.arange(15, dtype=np.int64)
        train = np.arange(15, dtype=np.int64)
        query[1] = query[0]
        train[1] = train[0]
        with self.assertRaisesRegex(ValueError, "collision|duplicate"):
            core.build_match_partition(
                PANORAMA_SHA, DATA3D_GUID, faces, query, train
            )
        with self.assertRaisesRegex(ValueError, "sha256"):
            core.build_match_partition(
                PANORAMA_SHA.removeprefix("sha256:"),
                DATA3D_GUID,
                faces,
                np.arange(15),
                np.arange(15),
            )

    def test_five_fold_solver_recovers_reflected_orientation_with_outliers(self) -> None:
        source, target, faces, partition = _synthetic_matches()
        fit = core.solve_cross_validated_orientation(
            source,
            target,
            faces,
            partition.seed,
            _fast_thresholds(),
            fold_indices=partition.fold_indices,
            match_identity_digests=partition.identity_digests,
        )
        self.assertTrue(fit.global_reflection_applied)
        self.assertEqual(fit.fold_chirality_winners, (True,) * 5)
        np.testing.assert_allclose(
            fit.rotation_panorama_from_reflected_scanner,
            _rotation(),
            atol=0.005,
        )
        np.testing.assert_allclose(
            fit.rotation_panorama_from_scanner,
            _rotation() @ core.SCANNER_Y_REFLECTION,
            atol=0.005,
        )
        self.assertGreaterEqual(fit.final_metrics.inlier_count, 150)
        self.assertEqual(len(fit.folds), 5)
        self.assertEqual([fold.fold_index for fold in fit.folds], list(range(5)))
        self.assertEqual(sum(fit.face_inlier_counts), fit.final_metrics.inlier_count)
        self.assertFalse(fit.final_inliers.flags.writeable)

    def test_solver_is_reorder_stable_when_fold_identities_follow_matches(self) -> None:
        source, target, faces, partition = _synthetic_matches()
        first = core.solve_cross_validated_orientation(
            source,
            target,
            faces,
            partition.seed,
            _fast_thresholds(),
            fold_indices=partition.fold_indices,
            match_identity_digests=partition.identity_digests,
        )
        order = np.random.default_rng(91).permutation(len(source))
        second = core.solve_cross_validated_orientation(
            source[order],
            target[order],
            faces[order],
            partition.seed,
            _fast_thresholds(),
            fold_indices=partition.fold_indices[order],
            match_identity_digests=tuple(partition.identity_digests[index] for index in order),
        )
        np.testing.assert_allclose(
            first.rotation_panorama_from_scanner,
            second.rotation_panorama_from_scanner,
            atol=1e-12,
        )
        self.assertEqual(first.final_metrics, second.final_metrics)

    def test_fold_model_never_observes_its_held_out_targets(self) -> None:
        source, target, faces, partition = _synthetic_matches(outlier_count=0)
        thresholds = _fast_thresholds()
        original = core.fit_fold_orientation(
            source,
            target,
            faces,
            partition.fold_indices,
            held_out_fold=2,
            reflected=True,
            seed=partition.seed ^ 2,
            thresholds=thresholds,
            match_identity_digests=partition.identity_digests,
        )
        changed_target = target.copy()
        held_out = partition.fold_indices == 2
        changed_target[held_out] = np.roll(changed_target[held_out], 1, axis=0)
        changed = core.fit_fold_orientation(
            source,
            changed_target,
            faces,
            partition.fold_indices,
            held_out_fold=2,
            reflected=True,
            seed=partition.seed ^ 2,
            thresholds=thresholds,
            match_identity_digests=partition.identity_digests,
        )
        np.testing.assert_array_equal(original.rotation, changed.rotation)
        self.assertNotEqual(original.held_out_metrics, changed.held_out_metrics)

    def test_default_gate_rejects_one_face_masquerading_as_spherical_support(self) -> None:
        source, target, _faces, partition = _synthetic_matches(outlier_count=0)
        faces = np.zeros(len(source), dtype=np.int64)
        faces[30] = 1
        faces[31] = 2
        partition = core.build_match_partition(
            PANORAMA_SHA,
            DATA3D_GUID,
            faces,
            np.arange(len(source), dtype=np.int64) * 2,
            np.arange(len(source), dtype=np.int64) * 3,
        )
        thresholds = replace(
            core.OrientationThresholds(),
            fold_ransac_iterations=70,
            final_ransac_iterations=140,
        )
        with self.assertRaisesRegex(ValueError, "cubeface support"):
            core.solve_cross_validated_orientation(
                source,
                target,
                faces,
                partition.seed,
                thresholds,
                fold_indices=partition.fold_indices,
                match_identity_digests=partition.identity_digests,
            )

    def test_exact_chirality_tie_prefers_no_reflection(self) -> None:
        angle = np.linspace(0.1, 5.9, 90)
        source = np.column_stack(
            (np.cos(angle), np.zeros_like(angle), np.sin(angle))
        )
        target = source @ _rotation().T
        faces = np.arange(len(source), dtype=np.int64) % 6
        partition = core.build_match_partition(
            PANORAMA_SHA,
            DATA3D_GUID,
            faces,
            np.arange(len(source)),
            np.arange(len(source)) + 200,
        )
        fit = core.solve_cross_validated_orientation(
            source,
            target,
            faces,
            partition.seed,
            _fast_thresholds(),
            fold_indices=partition.fold_indices,
            match_identity_digests=partition.identity_digests,
        )
        self.assertFalse(fit.global_reflection_applied)

    def test_composition_yields_a_proper_e57_camera_rotation(self) -> None:
        orientation = _rotation() @ core.SCANNER_Y_REFLECTION
        e57_from_scanner = np.asarray(
            [[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]]
        )
        e57_from_camera = core.compose_e57_from_panorama_camera(
            e57_from_scanner, orientation, True
        )
        self.assertAlmostEqual(float(np.linalg.det(e57_from_camera)), 1.0, places=12)
        np.testing.assert_allclose(
            np.cross(e57_from_camera[:, 0], e57_from_camera[:, 1]),
            e57_from_camera[:, 2],
            atol=1e-12,
        )
        camera_ray = np.asarray([0.2, -0.3, 0.93])
        scanner_from_camera = orientation.T @ core.PANORAMA_FROM_CAMERA
        np.testing.assert_allclose(
            e57_from_camera @ camera_ray,
            e57_from_scanner @ scanner_from_camera @ camera_ray,
            atol=1e-12,
        )
        with self.assertRaisesRegex(ValueError, "proper|reflection"):
            core.compose_e57_from_panorama_camera(
                e57_from_scanner, _rotation(), False
            )

    def test_quaternion_extrinsics_preserve_camera_centre_and_inverse(self) -> None:
        e57_rotation, norm_error = core.quaternion_wxyz_to_rotation(
            (1.0, 0.0, 0.0, 0.0)
        )
        self.assertEqual(norm_error, 0.0)
        orientation = _rotation() @ core.SCANNER_Y_REFLECTION
        value = core.compose_panorama_camera_extrinsics(
            e57_rotation, (1.0, 2.0, 3.0), orientation, True
        )
        forward = np.asarray(value["rotationE57FromPanoramaCamera"])
        inverse = np.asarray(value["rotationPanoramaCameraFromE57"])
        translation = np.asarray(value["translationPanoramaCameraFromE57M"])
        np.testing.assert_allclose(inverse @ forward, np.eye(3), atol=1e-12)
        np.testing.assert_allclose(
            inverse @ np.asarray([1.0, 2.0, 3.0]) + translation,
            np.zeros(3),
            atol=1e-12,
        )
        with self.assertRaisesRegex(ValueError, "norm"):
            core.quaternion_wxyz_to_rotation((2.0, 0.0, 0.0, 0.0))

    def test_reprojection_uses_pixel_centres_and_lowest_face_for_ties(self) -> None:
        pixels = core.equirectangular_pixel_centres(4, 2, row_start=0, row_stop=1)
        np.testing.assert_array_equal(
            pixels,
            np.asarray([[0.5, 0.5], [1.5, 0.5], [2.5, 0.5], [3.5, 0.5]]),
        )
        rays = np.asarray([[1.0, 0.0, 1.0]])
        rays /= np.linalg.norm(rays, axis=1, keepdims=True)
        face, _uv, valid = core.scanner_rays_to_cubeface_pixels(
            rays, core.CubefaceIntrinsics(8, 8, 4.0, 4.0, 4.0, 4.0)
        )
        self.assertEqual(face.tolist(), [0])
        self.assertFalse(valid[0])  # the exact tie lies on the selected face boundary

    def test_source_only_cubeface_reprojection_is_deterministic(self) -> None:
        colours = (
            (255, 0, 0),
            (0, 255, 0),
            (0, 0, 255),
            (255, 255, 0),
            (255, 0, 255),
            (0, 255, 255),
        )
        cubefaces = [np.full((8, 8, 3), colour, dtype=np.uint8) for colour in colours]
        orientation = _rotation() @ core.SCANNER_Y_REFLECTION
        first, first_valid = core.reproject_cubefaces_to_equirect(
            cubefaces, orientation, True, 32, 16
        )
        second, second_valid = core.reproject_cubefaces_to_equirect(
            cubefaces, orientation, True, 32, 16
        )
        np.testing.assert_array_equal(first, second)
        np.testing.assert_array_equal(first_valid, second_valid)
        self.assertTrue(first_valid.all())
        self.assertTrue(
            set(map(tuple, np.unique(first.reshape(-1, 3), axis=0))).issubset(
                set(colours)
            )
        )

    def test_source_only_reprojection_uses_bilinear_sampling(self) -> None:
        size = 16
        yy, xx = np.indices((size, size))
        cubefaces = [
            np.stack(
                (
                    (xx * 11 + face * 7) % 256,
                    (yy * 13 + face * 9) % 256,
                    (xx * 3 + yy * 5 + face * 17) % 256,
                ),
                axis=2,
            ).astype(np.uint8)
            for face in range(6)
        ]
        orientation = _rotation() @ core.SCANNER_Y_REFLECTION
        output, valid = core.reproject_cubefaces_to_equirect(
            cubefaces, orientation, True, 32, 16
        )
        row, column = 6, 11
        self.assertTrue(valid[row, column])
        panorama_ray = core.equirectangular_pixels_to_rays(
            np.asarray([[column + 0.5, row + 0.5]]), 32, 16
        )
        scanner_ray = panorama_ray @ orientation
        faces, uv, sample_valid = core.scanner_rays_to_cubeface_pixels(
            scanner_ray,
            core.CubefaceIntrinsics(size, size, size / 2, size / 2, size / 2, size / 2),
        )
        self.assertTrue(sample_valid[0])
        face = int(faces[0])
        u, v = uv[0]
        x0, y0 = int(np.floor(u)), int(np.floor(v))
        x1, y1 = min(x0 + 1, size - 1), min(y0 + 1, size - 1)
        wx, wy = u - x0, v - y0
        expected = (
            cubefaces[face][y0, x0].astype(float) * (1 - wx) * (1 - wy)
            + cubefaces[face][y0, x1].astype(float) * wx * (1 - wy)
            + cubefaces[face][y1, x0].astype(float) * (1 - wx) * wy
            + cubefaces[face][y1, x1].astype(float) * wx * wy
        )
        np.testing.assert_array_equal(output[row, column], np.floor(expected + 0.5).astype(np.uint8))

    def test_json_is_finite_and_authority_none_validator_is_fail_closed(self) -> None:
        source, target, faces, partition = _synthetic_matches()
        fit = core.solve_cross_validated_orientation(
            source,
            target,
            faces,
            partition.seed,
            _fast_thresholds(),
            fold_indices=partition.fold_indices,
            match_identity_digests=partition.identity_digests,
        )
        value = core.orientation_fit_json(fit)
        core.validate_authority_none_result(value)
        encoded = core.canonical_finite_json_bytes(value)
        self.assertEqual(json.loads(encoded), value)
        corrupted = json.loads(encoded)
        corrupted["guards"]["runtimeInputPermitted"] = True
        with self.assertRaisesRegex(ValueError, "guard|authority"):
            core.validate_authority_none_result(corrupted)
        extra = json.loads(encoded)
        extra["inventedArchitecture"] = False
        with self.assertRaisesRegex(ValueError, "keys"):
            core.validate_authority_none_result(extra)
        with self.assertRaisesRegex(ValueError, "finite"):
            core.canonical_finite_json_bytes({"bad": float("nan")})

    def test_invalid_rays_folds_and_matrices_fail_closed(self) -> None:
        source, target, faces, partition = _synthetic_matches(outlier_count=0)
        broken = source.copy()
        broken[0] = 0.0
        with self.assertRaisesRegex(ValueError, "non-zero"):
            core.solve_cross_validated_orientation(
                broken,
                target,
                faces,
                partition.seed,
                _fast_thresholds(),
                fold_indices=partition.fold_indices,
                match_identity_digests=partition.identity_digests,
            )
        bad_folds = partition.fold_indices.copy()
        bad_folds.setflags(write=True)
        bad_folds[:] = 0
        with self.assertRaisesRegex(ValueError, "five folds"):
            core.solve_cross_validated_orientation(
                source,
                target,
                faces,
                partition.seed,
                _fast_thresholds(),
                fold_indices=bad_folds,
                match_identity_digests=partition.identity_digests,
            )
        with self.assertRaisesRegex(ValueError, "orthogonal"):
            core.compose_e57_from_panorama_camera(
                np.eye(3) * 2.0,
                _rotation() @ core.SCANNER_Y_REFLECTION,
                True,
            )


if __name__ == "__main__":
    unittest.main()
