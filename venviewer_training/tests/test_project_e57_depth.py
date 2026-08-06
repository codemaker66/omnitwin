"""Focused contract tests for the E57-to-COLMAP depth projector.

The tests use small in-memory stand-ins with the exact public shapes exposed
by pye57 0.4.16 and rmbrualla/pycolmap commit cc7ea4b73.  They do not read a
real capture, start training, contact a provider, or open a network socket.
"""

from __future__ import annotations

import ast
import hashlib
import socket
import subprocess
import sys
import tempfile
import urllib.request
import unittest
import zipfile
from collections import OrderedDict
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np

from venviewer_training import project_e57_depth


class ProjectE57DepthTests(unittest.TestCase):
    @staticmethod
    def _fake_open3d(
        *,
        fitness: float = 0.8,
        inlier_rmse: float = 0.01,
        transformation: np.ndarray | None = None,
    ) -> SimpleNamespace:
        class FakePointCloud:
            def __init__(self) -> None:
                self.points = np.empty((0, 3), dtype=np.float64)

        result = SimpleNamespace(
            fitness=fitness,
            inlier_rmse=inlier_rmse,
            transformation=(
                np.eye(4, dtype=np.float64)
                if transformation is None
                else transformation
            ),
        )
        registration = SimpleNamespace(
            registration_icp=lambda *_args, **_kwargs: result,
            TransformationEstimationPointToPoint=lambda: object(),
            ICPConvergenceCriteria=lambda **_kwargs: object(),
        )
        return SimpleNamespace(
            geometry=SimpleNamespace(PointCloud=FakePointCloud),
            utility=SimpleNamespace(
                Vector3dVector=lambda points: np.asarray(points, dtype=np.float64)
            ),
            pipelines=SimpleNamespace(registration=registration),
        )

    @staticmethod
    def _valid_icp_points() -> tuple[np.ndarray, np.ndarray]:
        points = np.array(
            [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            dtype=np.float64,
        )
        return points, points.copy()

    def test_projector_has_no_training_or_provider_sdk_import(self) -> None:
        source_path = Path(project_e57_depth.__file__)
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        imported_roots: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_roots.update(alias.name.split(".", 1)[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_roots.add(node.module.split(".", 1)[0])
        self.assertTrue(
            imported_roots.isdisjoint({"boto3", "gsplat", "requests", "runpod", "torch"}),
            imported_roots,
        )

    def test_load_e57_uses_pye57_global_transform_once_and_closes(self) -> None:
        calls: list[tuple[int, dict[str, object]]] = []
        state = {"entered": False, "closed": False}

        class FakeE57:
            scan_count = 2

            def __init__(self, path: str, mode: str) -> None:
                self.path = path
                self.mode = mode

            def __enter__(self) -> "FakeE57":
                state["entered"] = True
                return self

            def __exit__(self, *_args: object) -> None:
                state["closed"] = True

            def read_scan(self, index: int, **kwargs: object) -> dict[str, np.ndarray]:
                calls.append((index, kwargs))
                base = 10.0 + index
                return {
                    "cartesianX": np.array([base]),
                    "cartesianY": np.array([20.0 + index]),
                    "cartesianZ": np.array([30.0 + index]),
                }

            def get_header(self, _index: int) -> object:
                raise AssertionError("read_scan(transform=True) already applied the pose")

        fake_module = SimpleNamespace(E57=FakeE57)
        with mock.patch.dict(sys.modules, {"pye57": fake_module}):
            points = project_e57_depth.load_e57("capture.e57")

        np.testing.assert_array_equal(
            points,
            np.array([[10.0, 20.0, 30.0], [11.0, 21.0, 31.0]], dtype=np.float32),
        )
        self.assertTrue(state["entered"])
        self.assertTrue(state["closed"])
        self.assertEqual([index for index, _kwargs in calls], [0, 1])
        for _index, kwargs in calls:
            self.assertIs(kwargs["transform"], True)
            self.assertIs(kwargs["ignore_missing_fields"], True)

    def test_load_e57_rejects_missing_global_cartesian_field(self) -> None:
        class FakeE57:
            scan_count = 1

            def __init__(self, _path: str, mode: str) -> None:
                self.mode = mode

            def __enter__(self) -> "FakeE57":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def read_scan(self, _index: int, **_kwargs: object) -> dict[str, np.ndarray]:
                return {
                    "cartesianX": np.array([1.0]),
                    "cartesianY": np.array([2.0]),
                }

        with mock.patch.dict(sys.modules, {"pye57": SimpleNamespace(E57=FakeE57)}):
            with self.assertRaisesRegex(RuntimeError, "global Cartesian coordinates"):
                project_e57_depth.load_e57("capture.e57")

    def test_estimate_transform_rejects_invalid_icp_fitness(self) -> None:
        e57_points, colmap_points = self._valid_icp_points()
        for fitness in (float("nan"), float("inf"), -0.01, 1.01):
            with self.subTest(fitness=fitness), mock.patch.dict(
                sys.modules,
                {"open3d": self._fake_open3d(fitness=fitness)},
            ):
                with self.assertRaises(RuntimeError):
                    project_e57_depth.estimate_transform(e57_points, colmap_points)

    def test_estimate_transform_rejects_invalid_inlier_rmse(self) -> None:
        e57_points, colmap_points = self._valid_icp_points()
        for inlier_rmse in (float("nan"), float("inf"), -0.01):
            with self.subTest(inlier_rmse=inlier_rmse), mock.patch.dict(
                sys.modules,
                {"open3d": self._fake_open3d(inlier_rmse=inlier_rmse)},
            ):
                with self.assertRaises(RuntimeError):
                    project_e57_depth.estimate_transform(e57_points, colmap_points)

    def test_estimate_transform_rejects_invalid_numeric_controls(self) -> None:
        e57_points, colmap_points = self._valid_icp_points()
        cases = {
            "threshold_nan": {"fitness_threshold": float("nan")},
            "threshold_zero": {"fitness_threshold": 0.0},
            "threshold_negative": {"fitness_threshold": -0.1},
            "threshold_above_one": {"fitness_threshold": 1.01},
            "max_corr_nan": {"max_corr": float("nan")},
            "max_corr_inf": {"max_corr": float("inf")},
            "max_corr_zero": {"max_corr": 0.0},
            "max_corr_negative": {"max_corr": -0.1},
            "voxel_nan": {"voxel_m": float("nan")},
            "voxel_inf": {"voxel_m": float("inf")},
            "voxel_zero": {"voxel_m": 0.0},
            "voxel_negative": {"voxel_m": -0.1},
        }
        fake_open3d = self._fake_open3d()
        for name, overrides in cases.items():
            with self.subTest(name=name), mock.patch.dict(
                sys.modules,
                {"open3d": fake_open3d},
            ):
                with self.assertRaises(ValueError):
                    project_e57_depth.estimate_transform(
                        e57_points,
                        colmap_points,
                        **overrides,
                    )

    def test_estimate_transform_rejects_bad_shape_and_nonfinite_matrix(self) -> None:
        e57_points, colmap_points = self._valid_icp_points()
        nonfinite = np.eye(4, dtype=np.float64)
        nonfinite[1, 3] = np.nan
        cases = {
            "wrong_shape": np.eye(3, dtype=np.float64),
            "nonfinite": nonfinite,
        }
        for name, transformation in cases.items():
            with self.subTest(name=name), mock.patch.dict(
                sys.modules,
                {"open3d": self._fake_open3d(transformation=transformation)},
            ):
                with self.assertRaises(RuntimeError):
                    project_e57_depth.estimate_transform(e57_points, colmap_points)

    def test_estimate_transform_rejects_bad_homogeneous_last_row(self) -> None:
        e57_points, colmap_points = self._valid_icp_points()
        scaled_last_row = np.eye(4, dtype=np.float64)
        scaled_last_row[3, 3] = 2.0
        projective_last_row = np.eye(4, dtype=np.float64)
        projective_last_row[3, 0] = 0.1
        for transformation in (scaled_last_row, projective_last_row):
            with self.subTest(last_row=transformation[3].tolist()), mock.patch.dict(
                sys.modules,
                {"open3d": self._fake_open3d(transformation=transformation)},
            ):
                with self.assertRaises(RuntimeError):
                    project_e57_depth.estimate_transform(e57_points, colmap_points)

    def test_estimate_transform_rejects_non_rigid_rotation(self) -> None:
        e57_points, colmap_points = self._valid_icp_points()
        non_orthonormal = np.eye(4, dtype=np.float64)
        non_orthonormal[0, 0] = 2.0
        reflection = np.eye(4, dtype=np.float64)
        reflection[0, 0] = -1.0
        for name, transformation in {
            "non_orthonormal": non_orthonormal,
            "reflection": reflection,
        }.items():
            with self.subTest(name=name), mock.patch.dict(
                sys.modules,
                {"open3d": self._fake_open3d(transformation=transformation)},
            ):
                with self.assertRaises(RuntimeError):
                    project_e57_depth.estimate_transform(e57_points, colmap_points)

    def test_estimate_transform_accepts_finite_rigid_result_at_threshold(self) -> None:
        e57_points, colmap_points = self._valid_icp_points()
        transformation = np.array(
            [
                [0.0, -1.0, 0.0, 1.5],
                [1.0, 0.0, 0.0, -2.0],
                [0.0, 0.0, 1.0, 0.25],
                [0.0, 0.0, 0.0, 1.0],
            ],
            dtype=np.float64,
        )
        with mock.patch.dict(
            sys.modules,
            {
                "open3d": self._fake_open3d(
                    fitness=0.3,
                    inlier_rmse=0.0,
                    transformation=transformation,
                )
            },
        ):
            result = project_e57_depth.estimate_transform(
                e57_points,
                colmap_points,
                fitness_threshold=0.3,
            )

        np.testing.assert_array_equal(result, transformation)

    @staticmethod
    def _fake_scene_manager(
        *,
        duplicate_stems: bool = False,
        camera_type: int = 1,
        first_qvec: np.ndarray | None = None,
    ) -> type:
        camera = SimpleNamespace(
            camera_type=camera_type,
            fx=8.0,
            fy=8.5,
            cx=5.0,
            cy=4.0,
            width=10,
            height=8,
        )
        first_name = "z-room/frame.png" if not duplicate_stems else "first/frame.jpg"
        second_name = "a-room/view.png" if not duplicate_stems else "second/frame.png"
        first = SimpleNamespace(
            name=first_name,
            camera_id=7,
            q=SimpleNamespace(
                q=(
                    np.array([1.0, 0.0, 0.0, 0.0])
                    if first_qvec is None
                    else np.asarray(first_qvec, dtype=np.float64)
                )
            ),
            tvec=np.array([1.0, 2.0, 3.0]),
        )
        second = SimpleNamespace(
            name=second_name,
            camera_id=7,
            q=SimpleNamespace(q=np.array([0.5, 0.5, 0.5, 0.5])),
            tvec=np.array([4.0, 5.0, 6.0]),
        )

        class FakeSceneManager:
            instances: list["FakeSceneManager"] = []

            def __init__(self, folder: str) -> None:
                self.folder = folder
                self.cameras = {7: camera}
                self.images = OrderedDict([(91, first), (3, second)])
                self.points3D = np.array(
                    [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]], dtype=np.float64
                )
                self.loaded: list[str] = []
                self.instances.append(self)

            def load_cameras(self) -> None:
                self.loaded.append("cameras")

            def load_images(self) -> None:
                self.loaded.append("images")

            def load_points3D(self) -> None:
                self.loaded.append("points3D")

        return FakeSceneManager

    def test_load_colmap_matches_pinned_scene_manager_shapes(self) -> None:
        manager_type = self._fake_scene_manager()
        with mock.patch.dict(
            sys.modules,
            {"pycolmap": SimpleNamespace(SceneManager=manager_type)},
        ):
            scene = project_e57_depth.load_colmap_cameras("sparse/0")

        self.assertEqual(manager_type.instances[0].loaded, ["cameras", "images", "points3D"])
        np.testing.assert_array_equal(
            scene["points3D"],
            np.array([[1, 2, 3], [4, 5, 6]], dtype=np.float32),
        )
        self.assertEqual(list(scene["cameras"]), ["view", "frame"])
        np.testing.assert_array_equal(
            scene["cameras"]["frame"]["qvec"],
            np.array([1.0, 0.0, 0.0, 0.0]),
        )
        np.testing.assert_array_equal(
            scene["cameras"]["frame"]["tvec"],
            np.array([1.0, 2.0, 3.0]),
        )

    def test_load_colmap_rejects_output_collision_and_distorted_camera(self) -> None:
        duplicate_manager = self._fake_scene_manager(duplicate_stems=True)
        with mock.patch.dict(
            sys.modules,
            {"pycolmap": SimpleNamespace(SceneManager=duplicate_manager)},
        ):
            with self.assertRaisesRegex(RuntimeError, "overwrite the same depth prior"):
                project_e57_depth.load_colmap_cameras("sparse/0")

        distorted_manager = self._fake_scene_manager(camera_type=2)
        with mock.patch.dict(
            sys.modules,
            {"pycolmap": SimpleNamespace(SceneManager=distorted_manager)},
        ):
            with self.assertRaisesRegex(RuntimeError, "unsupported distorted camera"):
                project_e57_depth.load_colmap_cameras("sparse/0")

    def test_load_colmap_rejects_overflowing_and_non_unit_quaternions(self) -> None:
        cases = {
            "overflowing_finite_components": np.full(4, 1e308, dtype=np.float64),
            "finite_non_unit": np.array([2.0, 0.0, 0.0, 0.0], dtype=np.float64),
        }
        for name, qvec in cases.items():
            manager_type = self._fake_scene_manager(first_qvec=qvec)
            with self.subTest(name=name), mock.patch.dict(
                sys.modules,
                {"pycolmap": SimpleNamespace(SceneManager=manager_type)},
            ):
                with self.assertRaisesRegex(RuntimeError, "quaternion norm"):
                    project_e57_depth.load_colmap_cameras("sparse/0")

    def test_select_training_cameras_excludes_heldout_and_sorts_exact_names(self) -> None:
        cameras = {
            "z": {"name": "train-z.png"},
            "heldout": {"name": "heldout.png"},
            "a": {"name": "nested/train-a.png"},
        }
        with tempfile.TemporaryDirectory() as temporary:
            dataset_root = Path(temporary)
            images_dir = dataset_root / "images"
            (images_dir / "nested").mkdir(parents=True)
            for name in ("train-z.png", "heldout.png", "nested/train-a.png"):
                path = images_dir / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"fixture image")
            (dataset_root / "splits.json").write_text(
                '{"train":["nested/train-a.png","train-z.png"],'
                '"heldout":["heldout.png"]}\n',
                encoding="utf-8",
                newline="\n",
            )

            selected = project_e57_depth.select_training_cameras(cameras, images_dir)

        self.assertEqual(
            [camera["name"] for camera in selected],
            ["nested/train-a.png", "train-z.png"],
        )

    def test_select_training_cameras_rejects_non_exhaustive_splits(self) -> None:
        cameras = {
            "first": {"name": "first.png"},
            "second": {"name": "second.png"},
            "third": {"name": "third.png"},
        }
        with tempfile.TemporaryDirectory() as temporary:
            dataset_root = Path(temporary)
            images_dir = dataset_root / "images"
            images_dir.mkdir()
            (images_dir / "first.png").write_bytes(b"fixture image")
            (images_dir / "second.png").write_bytes(b"fixture image")
            (images_dir / "third.png").write_bytes(b"fixture image")
            (dataset_root / "splits.json").write_text(
                '{"train":["second.png"],"heldout":["first.png"]}\n',
                encoding="utf-8",
                newline="\n",
            )

            with self.assertRaisesRegex(ValueError, "test_every=8|exhaustively"):
                project_e57_depth.select_training_cameras(cameras, images_dir)

    def test_select_training_cameras_rejects_missing_image_file(self) -> None:
        cameras = {
            "first": {"name": "first.png"},
            "second": {"name": "second.png"},
        }
        with tempfile.TemporaryDirectory() as temporary:
            dataset_root = Path(temporary)
            images_dir = dataset_root / "images"
            images_dir.mkdir()
            (images_dir / "first.png").write_bytes(b"fixture image")
            (dataset_root / "splits.json").write_text(
                '{"train":["second.png"],"heldout":["first.png"]}\n',
                encoding="utf-8",
                newline="\n",
            )

            with self.assertRaises(ValueError):
                project_e57_depth.select_training_cameras(cameras, images_dir)

    def test_select_training_cameras_rejects_extra_image_file(self) -> None:
        cameras = {
            "first": {"name": "first.png"},
            "second": {"name": "second.png"},
        }
        with tempfile.TemporaryDirectory() as temporary:
            dataset_root = Path(temporary)
            images_dir = dataset_root / "images"
            images_dir.mkdir()
            (images_dir / "first.png").write_bytes(b"fixture image")
            (images_dir / "second.png").write_bytes(b"fixture image")
            (images_dir / "unregistered.png").write_bytes(b"extra image")
            (dataset_root / "splits.json").write_text(
                '{"train":["second.png"],"heldout":["first.png"]}\n',
                encoding="utf-8",
                newline="\n",
            )

            with self.assertRaises(ValueError):
                project_e57_depth.select_training_cameras(cameras, images_dir)

    def test_select_training_cameras_rejects_oversized_split_before_json_parse(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset_root = Path(temporary)
            images_dir = dataset_root / "images"
            images_dir.mkdir()
            (dataset_root / "splits.json").write_bytes(b" " * (1024 * 1024 + 1))

            with (
                mock.patch.object(
                    project_e57_depth.json,
                    "loads",
                    side_effect=AssertionError("oversized split reached JSON parsing"),
                ) as json_loads,
                self.assertRaisesRegex(ValueError, "1 MiB"),
            ):
                project_e57_depth.select_training_cameras({}, images_dir)

            json_loads.assert_not_called()

    def test_validate_dataset_layout_accepts_exact_same_root_layout(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset_root = Path(temporary) / "dataset"
            colmap_dir = dataset_root / "sparse" / "0"
            images_dir = dataset_root / "images"
            colmap_dir.mkdir(parents=True)
            images_dir.mkdir()

            project_e57_depth.validate_dataset_layout(colmap_dir, images_dir)

    def test_validate_dataset_layout_rejects_different_roots(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            colmap_dir = root / "first" / "sparse" / "0"
            images_dir = root / "second" / "images"
            colmap_dir.mkdir(parents=True)
            images_dir.mkdir(parents=True)

            with self.assertRaises(ValueError):
                project_e57_depth.validate_dataset_layout(colmap_dir, images_dir)

    def test_validate_dataset_layout_rejects_wrong_directory_names(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset_root = Path(temporary) / "dataset"
            cases = (
                (dataset_root / "sparse" / "1", dataset_root / "images"),
                (dataset_root / "sparse" / "0", dataset_root / "photos"),
            )
            for colmap_dir, images_dir in cases:
                colmap_dir.mkdir(parents=True, exist_ok=True)
                images_dir.mkdir(parents=True, exist_ok=True)
                with self.subTest(colmap=colmap_dir.name, images=images_dir.name):
                    with self.assertRaises(ValueError):
                        project_e57_depth.validate_dataset_layout(colmap_dir, images_dir)

    def test_validate_dataset_layout_rejects_missing_directories(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset_root = Path(temporary) / "dataset"
            existing_colmap = dataset_root / "sparse" / "0"
            existing_images = dataset_root / "images"
            existing_colmap.mkdir(parents=True)
            existing_images.mkdir()
            cases = (
                (dataset_root / "missing" / "sparse" / "0", existing_images),
                (existing_colmap, dataset_root / "missing" / "images"),
            )
            for colmap_dir, images_dir in cases:
                with self.subTest(colmap=colmap_dir, images=images_dir):
                    with self.assertRaises(ValueError):
                        project_e57_depth.validate_dataset_layout(colmap_dir, images_dir)

    def test_validate_dataset_layout_rejects_symlinked_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset_root = Path(temporary) / "dataset"
            colmap_dir = dataset_root / "sparse" / "0"
            real_images = dataset_root / "real-images"
            images_link = dataset_root / "images"
            colmap_dir.mkdir(parents=True)
            real_images.mkdir()
            try:
                images_link.symlink_to(real_images, target_is_directory=True)
            except OSError:
                images_link.mkdir()
                with mock.patch.object(
                    Path,
                    "is_symlink",
                    new=lambda path: path == images_link,
                ):
                    with self.assertRaises(ValueError):
                        project_e57_depth.validate_dataset_layout(
                            colmap_dir, images_link
                        )
                return

            with self.assertRaises(ValueError):
                project_e57_depth.validate_dataset_layout(colmap_dir, images_link)

    def test_projection_has_stable_z_buffer_order_and_npz_bytes(self) -> None:
        camera = {
            "name": "nested/frame.png",
            "qvec": np.array([1.0, 0.0, 0.0, 0.0]),
            "tvec": np.zeros(3),
            "fx": 1.0,
            "fy": 1.0,
            "cx": 0.0,
            "cy": 0.0,
            "width": 4,
            "height": 3,
        }
        points = np.array(
            [
                [0.8, 0.8, 2.0],  # pixel 0, farther
                [0.4, 0.4, 1.0],  # pixel 0, same depth but larger u
                [0.2, 0.4, 1.0],  # pixel 0, deterministic tie winner
                [1.2, 0.2, 1.0],  # pixel 1
                [0.2, 1.2, 1.0],  # pixel 4
            ],
            dtype=np.float64,
        )

        with (
            tempfile.TemporaryDirectory() as first_dir,
            tempfile.TemporaryDirectory() as second_dir,
        ):
            network_error = AssertionError("projection must not contact a provider")
            with (
                mock.patch.object(socket, "create_connection", side_effect=network_error),
                mock.patch.object(subprocess, "Popen", side_effect=network_error),
                mock.patch.object(urllib.request, "urlopen", side_effect=network_error),
            ):
                first_result = project_e57_depth.project_one(
                    (camera["name"], camera, points, 10, 0, first_dir)
                )
                second_result = project_e57_depth.project_one(
                    (camera["name"], camera, points, 10, 0, second_dir)
                )

            first_path = Path(first_dir) / "frame.npz"
            second_path = Path(second_dir) / "frame.npz"
            self.assertEqual(first_result, ("nested/frame.png", 3))
            self.assertEqual(second_result, first_result)
            self.assertEqual(first_path.read_bytes(), second_path.read_bytes())

            with zipfile.ZipFile(first_path) as archive:
                self.assertEqual(
                    archive.namelist(),
                    ["uv.npy", "depth_m.npy", "width.npy", "height.npy"],
                )
                self.assertTrue(
                    all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in archive.infolist())
                )

            with np.load(first_path, allow_pickle=False) as prior:
                np.testing.assert_allclose(
                    prior["uv"],
                    np.array([[0.2, 0.4], [1.2, 0.2], [0.2, 1.2]], dtype=np.float32),
                )
                np.testing.assert_array_equal(
                    prior["depth_m"], np.ones(3, dtype=np.float32)
                )
                self.assertEqual(int(prior["width"]), 4)
                self.assertEqual(int(prior["height"]), 3)

    def test_project_one_rejects_zero_usable_samples_without_writing(self) -> None:
        camera = {
            "name": "nested/frame.png",
            "qvec": np.array([1.0, 0.0, 0.0, 0.0]),
            "tvec": np.zeros(3),
            "fx": 1.0,
            "fy": 1.0,
            "cx": 0.0,
            "cy": 0.0,
            "width": 4,
            "height": 3,
        }
        cases = {
            "behind_camera": np.array([[0.0, 0.0, -1.0]], dtype=np.float64),
            "outside_image": np.array([[100.0, 100.0, 1.0]], dtype=np.float64),
        }

        for name, points in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                output_path = Path(temporary) / "frame.npz"
                with self.assertRaises(RuntimeError):
                    project_e57_depth.project_one(
                        (camera["name"], camera, points, 10, 0, temporary)
                    )
                self.assertFalse(output_path.exists())

    def test_depth_prior_writer_is_create_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output_path = Path(temporary) / "frame.npz"
            project_e57_depth._write_depth_prior(
                output_path,
                uv=np.array([[0.25, 0.5]], dtype=np.float32),
                depth_m=np.array([1.0], dtype=np.float32),
                width=4,
                height=3,
            )
            original_digest = hashlib.sha256(output_path.read_bytes()).hexdigest()

            with self.assertRaises(FileExistsError):
                project_e57_depth._write_depth_prior(
                    output_path,
                    uv=np.array([[1.25, 1.5]], dtype=np.float32),
                    depth_m=np.array([2.0], dtype=np.float32),
                    width=8,
                    height=6,
                )

            self.assertEqual(
                hashlib.sha256(output_path.read_bytes()).hexdigest(),
                original_digest,
            )

    def test_quaternion_validation_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "four finite"):
            project_e57_depth.quat_to_R(np.array([1.0, 0.0, np.nan, 0.0]))
        with self.assertRaisesRegex(ValueError, "non-zero"):
            project_e57_depth.quat_to_R(np.zeros(4))

        cases = {
            "overflowing_finite_components": np.full(4, 1e308, dtype=np.float64),
            "finite_non_unit": np.array([2.0, 0.0, 0.0, 0.0], dtype=np.float64),
        }
        for name, qvec in cases.items():
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "quaternion norm"):
                    project_e57_depth.quat_to_R(qvec)


if __name__ == "__main__":
    unittest.main()
