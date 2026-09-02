"""Tests for the XBAG -> COLMAP bridge.

Fixtures are synthetic: a calibration JSON shaped like the T-566 receipt, poses
along a line, and projected random points. No capture file is read.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
import unittest

import numpy as np

from xbag_records import FrameRecord
from xbag_colmap import (
    BODY_FRAMES,
    Hypothesis,
    ImageEntry,
    ZoneBox,
    assign_cameras,
    body_pose_matrix,
    body_to_camera0,
    camera_world_matrix,
    colmap_camera_line,
    enumerate_hypotheses,
    interpolate_pose,
    load_calibration,
    matrix_to_quat_wxyz,
    normalised_points,
    quat_xyzw_to_matrix,
    sampson_inlier_fraction,
    select_zone_instants,
    world_to_camera_colmap,
    write_sparse_text,
)

IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
CAMERA_LIDAR = [-0.002, 0.015, 0.9999, -0.0104, -0.99996, 0.008, -0.002, -0.04, -0.008, -0.9998, 0.015, -0.0464, 0, 0, 0, 1]
IMU_LIDAR = [-0.008, -0.99995, -0.006, 0.00425, -0.99992, 0.0085, -0.0096, 0.00418, 0.0097, 0.0059, -0.99994, -0.00446, 0, 0, 0, 1]


def calibration_dict() -> dict:
    return {
        "calibration": {
            "cameras": [
                {"cameraId": "camera_0", "cameraModel": "kb4", "intrinsicSourceOrder": [800, 801, 2000, 1500],
                 "distortionSourceOrder": [0.08, -0.002, -0.016, 0.004], "cameraPose": {"rowMajor": IDENTITY},
                 "imageWidthPx": 4000, "imageHeightPx": 3000},
                {"cameraId": "camera_1", "cameraModel": "kb4", "intrinsicSourceOrder": [790, 791, 1995, 1501],
                 "distortionSourceOrder": [0.09, -0.02, 0.007, -0.003],
                 "cameraPose": {"rowMajor": [-1, 0, 0, 0.001, 0, 1, 0, 0, 0, 0, -1, -0.09, 0, 0, 0, 1]},
                 "imageWidthPx": 4000, "imageHeightPx": 3000},
                {"cameraId": "camera_2", "cameraModel": "pinhole", "intrinsicSourceOrder": [1930, 1931, 1940, 1727],
                 "distortionSourceOrder": [-0.01, -0.05, 0.0001, 0.0002],
                 "cameraPose": {"rowMajor": [0, 0, 1, 0.03, 0, 1, 0, 0.005, -1, 0, 0, -0.03, 0, 0, 0, 1]},
                 "imageWidthPx": 4000, "imageHeightPx": 3000},
                {"cameraId": "camera_3", "cameraModel": "pinhole", "intrinsicSourceOrder": [1928, 1931, 1942, 1725],
                 "distortionSourceOrder": [-0.02, -0.04, 0.0003, 0.0009],
                 "cameraPose": {"rowMajor": [0, 0, 1, 0.03, 0, 1, 0, 0.005, -1, 0, 0, -0.06, 0, 0, 0, 1]},
                 "imageWidthPx": 4000, "imageHeightPx": 3000},
            ],
            "crossSensorTransforms": [
                {"sourceLabel": "camera_lidar", "transform": {"rowMajor": CAMERA_LIDAR}},
                {"sourceLabel": "imu_lidar", "transform": {"rowMajor": IMU_LIDAR}},
            ],
        }
    }


def write_calibration(tmp: str) -> str:
    path = os.path.join(tmp, "calibration.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(calibration_dict(), handle)
    return path


def quat_about_z(degrees: float) -> np.ndarray:
    half = math.radians(degrees) / 2
    return np.array([0.0, 0.0, math.sin(half), math.cos(half)])  # xyzw


class LoadCalibration(unittest.TestCase):
    def test_reads_four_cameras_with_colmap_models_and_two_cross_sensor_transforms(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cal = load_calibration(write_calibration(tmp))
        self.assertEqual(sorted(cal.cameras), ["camera_0", "camera_1", "camera_2", "camera_3"])
        self.assertEqual(cal.cameras["camera_0"].colmap_model, "OPENCV_FISHEYE")
        self.assertEqual(cal.cameras["camera_2"].colmap_model, "OPENCV")
        self.assertEqual((cal.cameras["camera_0"].width, cal.cameras["camera_0"].height), (4000, 3000))
        np.testing.assert_allclose(cal.cameras["camera_1"].pose[:3, 3], [0.001, 0, -0.09])
        self.assertEqual(cal.camera_lidar.shape, (4, 4))
        np.testing.assert_allclose(cal.imu_lidar[3], [0, 0, 0, 1])


class Quaternions(unittest.TestCase):
    def test_xyzw_to_matrix_rotates_x_onto_y_for_ninety_degrees_about_z(self) -> None:
        R = quat_xyzw_to_matrix(quat_about_z(90))
        np.testing.assert_allclose(R @ [1, 0, 0], [0, 1, 0], atol=1e-12)

    def test_matrix_to_wxyz_round_trips_with_a_positive_scalar_part(self) -> None:
        R = quat_xyzw_to_matrix(quat_about_z(90))
        w, x, y, z = matrix_to_quat_wxyz(R)
        self.assertGreater(w, 0)
        np.testing.assert_allclose([x, y, z, w], quat_about_z(90), atol=1e-12)


class InterpolatePose(unittest.TestCase):
    def poses(self) -> np.ndarray:
        return np.array([
            [10.0, 0, 0, 0, *quat_about_z(0)],
            [11.0, 2, 0, 0, *quat_about_z(90)],
        ])

    def test_midpoint_is_halfway_in_position_and_rotation(self) -> None:
        result = interpolate_pose(self.poses(), 10.5)
        assert result is not None
        position, q = result
        np.testing.assert_allclose(position, [1, 0, 0])
        np.testing.assert_allclose(quat_xyzw_to_matrix(q) @ [1, 0, 0], [math.cos(math.pi / 4), math.sin(math.pi / 4), 0], atol=1e-9)

    def test_exact_sample_returns_that_row(self) -> None:
        result = interpolate_pose(self.poses(), 11.0)
        assert result is not None
        np.testing.assert_allclose(result[0], [2, 0, 0])
        np.testing.assert_allclose(result[1], quat_about_z(90), atol=1e-12)

    def test_returns_none_outside_the_pose_range(self) -> None:
        self.assertIsNone(interpolate_pose(self.poses(), 9.99))
        self.assertIsNone(interpolate_pose(self.poses(), 11.01))

    def test_slerp_takes_the_short_way_when_the_second_quaternion_is_negated(self) -> None:
        poses = self.poses()
        poses[1, 4:8] = -poses[1, 4:8]  # same rotation, opposite sign
        result = interpolate_pose(poses, 10.5)
        assert result is not None
        np.testing.assert_allclose(quat_xyzw_to_matrix(result[1]) @ [1, 0, 0], [math.cos(math.pi / 4), math.sin(math.pi / 4), 0], atol=1e-9)


class BodyPoseMatrix(unittest.TestCase):
    def test_xyzw_layout_places_the_body_at_its_position_with_its_rotation(self) -> None:
        T = body_pose_matrix(np.array([1.0, 2.0, 3.0]), quat_about_z(90), layout="xyzw", inverse=False)
        np.testing.assert_allclose(T[:3, 3], [1, 2, 3])
        np.testing.assert_allclose(T[:3, :3] @ [1, 0, 0], [0, 1, 0], atol=1e-12)
        np.testing.assert_allclose(T[3], [0, 0, 0, 1])

    def test_wxyz_layout_reads_the_same_numbers_as_a_different_rotation(self) -> None:
        q = quat_about_z(90)
        a = body_pose_matrix(np.zeros(3), q, layout="xyzw", inverse=False)
        b = body_pose_matrix(np.zeros(3), q, layout="wxyz", inverse=False)
        self.assertFalse(np.allclose(a, b))

    def test_inverse_flag_inverts_the_matrix(self) -> None:
        q = quat_about_z(90)
        T = body_pose_matrix(np.array([1.0, 2.0, 3.0]), q, layout="xyzw", inverse=False)
        T_inv = body_pose_matrix(np.array([1.0, 2.0, 3.0]), q, layout="xyzw", inverse=True)
        np.testing.assert_allclose(T @ T_inv, np.eye(4), atol=1e-12)


class Hypotheses(unittest.TestCase):
    def test_enumerates_256_distinct_hypotheses(self) -> None:
        hyps = enumerate_hypotheses()
        self.assertEqual(len(hyps), 256)
        self.assertEqual(len(set(hyps)), 256)
        self.assertEqual(len(BODY_FRAMES), 8)

    def test_body_to_camera0_follows_each_body_frame_reading(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cal = load_calibration(write_calibration(tmp))
        C = np.array(CAMERA_LIDAR).reshape(4, 4)
        M = np.array(IMU_LIDAR).reshape(4, 4)
        np.testing.assert_allclose(body_to_camera0("camera0/opencv", cal), np.eye(4))
        np.testing.assert_allclose(body_to_camera0("camera0/opengl", cal), np.diag([1.0, -1.0, -1.0, 1.0]))
        np.testing.assert_allclose(body_to_camera0("lidar/c2l", cal), C)
        np.testing.assert_allclose(body_to_camera0("lidar/l2c", cal), np.linalg.inv(C))
        np.testing.assert_allclose(body_to_camera0("imu/i2l/c2l", cal), np.linalg.inv(M) @ C)
        np.testing.assert_allclose(body_to_camera0("imu/l2i/l2c", cal), M @ np.linalg.inv(C))
        with self.assertRaises(ValueError):
            body_to_camera0("moon/frame", cal)


class CameraWorldMatrix(unittest.TestCase):
    def test_composes_body_pose_body_to_camera0_and_the_camera_offset(self) -> None:
        T_world_body = np.eye(4)
        T_world_body[:3, 3] = [1, 0, 0]
        T_cam0_cam = np.eye(4)
        T_cam0_cam[:3, 3] = [0, 0, -0.09]
        forward = camera_world_matrix(T_world_body, np.eye(4), T_cam0_cam, camera_pose_inverse=False)
        inverted = camera_world_matrix(T_world_body, np.eye(4), T_cam0_cam, camera_pose_inverse=True)
        np.testing.assert_allclose(forward[:3, 3], [1, 0, -0.09])
        np.testing.assert_allclose(inverted[:3, 3], [1, 0, 0.09])


class WorldToCameraColmap(unittest.TestCase):
    def test_camera_at_a_position_with_identity_rotation(self) -> None:
        T = np.eye(4)
        T[:3, 3] = [1, 2, 3]
        qw, qx, qy, qz, tx, ty, tz = world_to_camera_colmap(T)
        np.testing.assert_allclose([qw, qx, qy, qz], [1, 0, 0, 0])
        np.testing.assert_allclose([tx, ty, tz], [-1, -2, -3])

    def test_a_point_in_front_of_the_camera_lands_on_its_positive_z_axis(self) -> None:
        # camera at the origin looking along world +x: cam x = world -y, cam y = world -z, cam z = world +x
        T = np.eye(4)
        T[:3, :3] = np.array([[0, 0, 1], [-1, 0, 0], [0, -1, 0]], dtype=float)
        qw, qx, qy, qz, tx, ty, tz = world_to_camera_colmap(T)
        R = quat_xyzw_to_matrix(np.array([qx, qy, qz, qw]))
        np.testing.assert_allclose(R @ [5, 0, 0] + [tx, ty, tz], [0, 0, 5], atol=1e-12)


class ColmapCameraLine(unittest.TestCase):
    def test_fisheye_and_pinhole_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cal = load_calibration(write_calibration(tmp))
        self.assertEqual(colmap_camera_line(1, cal.cameras["camera_0"]), "1 OPENCV_FISHEYE 4000 3000 800 801 2000 1500 0.08 -0.002 -0.016 0.004")
        self.assertEqual(colmap_camera_line(3, cal.cameras["camera_2"]), "3 OPENCV 4000 3000 1930 1931 1940 1727 -0.01 -0.05 0.0001 0.0002")


class WriteSparseText(unittest.TestCase):
    def entries(self, cal):
        T1 = np.eye(4)
        T1[:3, 3] = [1, 2, 3]
        T2 = np.eye(4)
        T2[:3, :3] = quat_xyzw_to_matrix(quat_about_z(90))
        T2[:3, 3] = [4, 5, 6]
        cameras = [(1, cal.cameras["camera_0"]), (2, cal.cameras["camera_2"])]
        images = [ImageEntry(1, "cam0/seq0.jpg", 1, T1), ImageEntry(2, "cam2/seq0.jpg", 2, T2)]
        return cameras, images

    def test_writes_cameras_images_and_an_empty_points_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cal = load_calibration(write_calibration(tmp))
            cameras, images = self.entries(cal)
            out = os.path.join(tmp, "sparse", "0")
            write_sparse_text(out, cameras, images)
            with open(os.path.join(out, "cameras.txt"), encoding="utf-8") as handle:
                camera_lines = [line for line in handle.read().splitlines() if line and not line.startswith("#")]
            with open(os.path.join(out, "images.txt"), encoding="utf-8") as handle:
                image_lines = [line for line in handle.read().splitlines() if not line.startswith("#")]
            with open(os.path.join(out, "points3D.txt"), encoding="utf-8") as handle:
                point_lines = [line for line in handle.read().splitlines() if line and not line.startswith("#")]
        self.assertEqual(len(camera_lines), 2)
        self.assertEqual(camera_lines[0].split()[:2], ["1", "OPENCV_FISHEYE"])
        # two lines per image: the pose line and an (empty) 2D-point line
        self.assertEqual(len(image_lines), 4)
        pose = image_lines[0].split()
        self.assertEqual(pose[0], "1")
        self.assertEqual(pose[-2:], ["1", "cam0/seq0.jpg"])
        np.testing.assert_allclose([float(v) for v in pose[1:8]], [1, 0, 0, 0, -1, -2, -3])
        self.assertEqual(image_lines[1], "")
        self.assertEqual(point_lines, [])

    def test_pycolmap_reads_the_model_back_with_the_same_projection_centres(self) -> None:
        try:
            import pycolmap
        except ImportError:
            self.skipTest("pycolmap not installed")
        with tempfile.TemporaryDirectory() as tmp:
            cal = load_calibration(write_calibration(tmp))
            cameras, images = self.entries(cal)
            out = os.path.join(tmp, "sparse", "0")
            write_sparse_text(out, cameras, images)
            rec = pycolmap.Reconstruction(out)
            self.assertEqual(rec.num_cameras(), 2)
            self.assertEqual(rec.num_images(), 2)
            self.assertEqual(rec.cameras[1].model.name, "OPENCV_FISHEYE")
            self.assertEqual(rec.cameras[2].model.name, "OPENCV")
            np.testing.assert_allclose(rec.images[2].projection_center(), [4, 5, 6], atol=1e-9)


class NormalisedPoints(unittest.TestCase):
    def test_pinhole_without_distortion_divides_by_focal_length(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cal = load_calibration(write_calibration(tmp))
        camera = cal.cameras["camera_2"]._replace(distortion=(0.0, 0.0, 0.0, 0.0))
        points = normalised_points(camera, np.array([[1940 + 1930, 1727], [1940, 1727 + 2 * 1931]], dtype=float))
        np.testing.assert_allclose(points, [[1, 0], [0, 2]], atol=1e-9)

    def test_fisheye_without_distortion_is_equidistant(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cal = load_calibration(write_calibration(tmp))
        camera = cal.cameras["camera_0"]._replace(distortion=(0.0, 0.0, 0.0, 0.0))
        theta = 0.5
        points = normalised_points(camera, np.array([[2000 + 800 * theta, 1500]], dtype=float))
        np.testing.assert_allclose(points, [[math.tan(theta), 0]], atol=1e-6)


class Sampson(unittest.TestCase):
    def synthetic(self):
        rng = np.random.default_rng(7)
        X = rng.uniform([-2, -2, 3], [2, 2, 8], size=(400, 3))
        T_a = np.eye(4)
        T_b = np.eye(4)
        yaw = math.radians(10)
        T_b[:3, :3] = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
        T_b[:3, 3] = [0.5, 0.0, 0.0]

        def project(T):
            Xc = (np.linalg.inv(T) @ np.c_[X, np.ones(len(X))].T).T[:, :3]
            return Xc[:, :2] / Xc[:, 2:3] + rng.normal(0, 1e-4, size=(len(X), 2))

        return project(T_a), project(T_b), T_a, T_b

    def test_the_true_relative_pose_explains_nearly_every_match(self) -> None:
        xa, xb, T_a, T_b = self.synthetic()
        self.assertGreater(sampson_inlier_fraction(xa, xb, T_a, T_b, threshold=2e-3), 0.95)

    def test_a_wrong_rotation_explains_few_matches(self) -> None:
        xa, xb, T_a, T_b = self.synthetic()
        wrong = T_b.copy()
        wrong[:3, :3] = quat_xyzw_to_matrix(quat_about_z(30)) @ T_b[:3, :3]
        self.assertLess(sampson_inlier_fraction(xa, xb, T_a, wrong, threshold=2e-3), 0.3)


class AssignCameras(unittest.TestCase):
    def test_maps_slots_to_calibration_ids_by_optical_class_and_hypothesis_order(self) -> None:
        classes = ["rectilinear", "rectilinear", "fisheye", "fisheye"]
        hyp = Hypothesis(quat_layout="xyzw", pose_inverse=False, body_frame="lidar/c2l", camera_pose_inverse=False, fisheye_order=(0, 1), pinhole_order=(1, 0))
        self.assertEqual(assign_cameras(classes, hyp), ["camera_3", "camera_2", "camera_0", "camera_1"])

    def test_refuses_a_group_without_two_of_each_class(self) -> None:
        hyp = enumerate_hypotheses()[0]
        with self.assertRaises(ValueError):
            assign_cameras(["fisheye", "fisheye", "fisheye", "rectilinear"], hyp)


class SelectZoneInstants(unittest.TestCase):
    def test_keeps_instants_inside_the_box_and_subsamples_evenly_to_the_budget(self) -> None:
        # walk along x from -20 to 0 over 20 s at 10 Hz, rotation fixed
        ts = np.arange(0, 20.01, 0.1)
        poses = np.c_[ts, -20 + ts, np.zeros_like(ts), np.zeros_like(ts), np.tile(quat_about_z(0), (len(ts), 1))]
        groups = []
        for seq, t in enumerate(np.arange(0.15, 19.9, 0.3)):
            ts_us = int(round(t * 1e6))
            groups.append(tuple(FrameRecord(record_offset=seq * 4 + slot, seq=seq, ts_us=ts_us + slot, codec_tag=3, width=4000, height=3000, payload_offset=1000 + seq * 4 + slot, payload_length=10) for slot in range(4)))
        zone = ZoneBox(xmin=-12, xmax=-8, ymin=-1, ymax=1)
        inside = select_zone_instants(groups, poses, zone, budget=100)
        self.assertTrue(all(-12 <= i.position[0] <= -8 for i in inside))
        self.assertEqual(len(inside), sum(1 for g in groups if -12 <= -20 + g[0].ts_us / 1e6 <= -8))
        three = select_zone_instants(groups, poses, zone, budget=3)
        self.assertEqual(len(three), 3)
        self.assertEqual(three[0].seq, inside[0].seq)
        self.assertGreater(three[1].seq, three[0].seq)
        self.assertGreater(three[2].seq, three[1].seq)
        self.assertEqual(len(three[0].records), 4)

    def test_refuses_a_box_whose_bounds_are_swapped(self) -> None:
        poses = np.array([[5.0, -10, 0, 0, *quat_about_z(0)], [6.0, -10, 0, 0, *quat_about_z(0)]])
        group = tuple(FrameRecord(record_offset=slot, seq=0, ts_us=5_500_000 + slot, codec_tag=3, width=4000, height=3000, payload_offset=100 + slot, payload_length=10) for slot in range(4))
        with self.assertRaises(ValueError):
            select_zone_instants([group], poses, ZoneBox(xmin=-9, xmax=-11, ymin=-1, ymax=1), budget=10)
        with self.assertRaises(ValueError):
            select_zone_instants([group], poses, ZoneBox(xmin=-11, xmax=-9, ymin=1, ymax=-1), budget=10)

    def test_skips_instants_the_pose_file_does_not_cover(self) -> None:
        poses = np.array([[5.0, -10, 0, 0, *quat_about_z(0)], [6.0, -10, 0, 0, *quat_about_z(0)]])
        early = tuple(FrameRecord(record_offset=slot, seq=0, ts_us=1_000_000 + slot, codec_tag=3, width=4000, height=3000, payload_offset=100 + slot, payload_length=10) for slot in range(4))
        covered = tuple(FrameRecord(record_offset=10 + slot, seq=1, ts_us=5_500_000 + slot, codec_tag=3, width=4000, height=3000, payload_offset=200 + slot, payload_length=10) for slot in range(4))
        chosen = select_zone_instants([early, covered], poses, ZoneBox(xmin=-11, xmax=-9, ymin=-1, ymax=1), budget=10)
        self.assertEqual([i.seq for i in chosen], [1])


class ModelEntries(unittest.TestCase):
    """COLMAP's triangulator wants the model's camera ids to be the database's per-folder cameras."""

    def manifest(self) -> dict:
        slots = lambda seq: [  # noqa: E731
            {"slot": 0, "image": f"slot0/seq{seq:05d}.jpg", "optical_class": "rectilinear"},
            {"slot": 1, "image": f"slot1/seq{seq:05d}.jpg", "optical_class": "rectilinear"},
            {"slot": 2, "image": f"slot2/seq{seq:05d}.jpg", "optical_class": "fisheye"},
            {"slot": 3, "image": f"slot3/seq{seq:05d}.jpg", "optical_class": "fisheye"},
        ]
        return {"instants": [{"seq": 5, "position": [1, 2, 3], "quat_raw": [0, 0, 0, 1], "slots": slots(5)}, {"seq": 9, "position": [2, 2, 3], "quat_raw": [0, 0, 0, 1], "slots": slots(9)}]}

    def test_cameras_follow_the_database_folder_ids_and_carry_the_assigned_calibration(self) -> None:
        from xbag_colmap import build_model_entries

        with tempfile.TemporaryDirectory() as tmp:
            cal = load_calibration(write_calibration(tmp))
        hyp = Hypothesis("xyzw", False, "camera0/opencv", False, fisheye_order=(1, 0), pinhole_order=(0, 1))
        image_ids = {"slot0/seq00005.jpg": 7, "slot1/seq00005.jpg": 8, "slot2/seq00005.jpg": 1, "slot3/seq00005.jpg": 2,
                     "slot0/seq00009.jpg": 9, "slot1/seq00009.jpg": 10, "slot2/seq00009.jpg": 3, "slot3/seq00009.jpg": 4}
        folder_camera_ids = {"slot0": 3, "slot1": 4, "slot2": 1, "slot3": 2}
        cameras, images = build_model_entries(self.manifest(), cal, hyp, image_ids, folder_camera_ids)
        self.assertEqual({camera_id: camera.camera_id for camera_id, camera in cameras}, {3: "camera_2", 4: "camera_3", 1: "camera_1", 2: "camera_0"})
        by_name = {image.name: image for image in images}
        self.assertEqual(by_name["slot2/seq00009.jpg"].camera_id, 1)
        self.assertEqual(by_name["slot2/seq00009.jpg"].image_id, 3)
        self.assertEqual([image.image_id for image in images], sorted(image_ids.values()))

    def test_without_a_database_the_slots_number_the_cameras(self) -> None:
        from xbag_colmap import build_model_entries

        with tempfile.TemporaryDirectory() as tmp:
            cal = load_calibration(write_calibration(tmp))
        hyp = Hypothesis("xyzw", False, "camera0/opencv", False, fisheye_order=(0, 1), pinhole_order=(0, 1))
        cameras, images = build_model_entries(self.manifest(), cal, hyp, None, None)
        self.assertEqual([camera_id for camera_id, _ in cameras], [1, 2, 3, 4])
        self.assertEqual([camera.camera_id for _, camera in cameras], ["camera_2", "camera_3", "camera_0", "camera_1"])
        self.assertEqual([image.image_id for image in images], list(range(1, 9)))


class BuildPairs(unittest.TestCase):
    """The pair list feeds the scorer; two instants that are each other's neighbour must yield one pair per slot pairing."""

    def manifest(self, positions: list[list[float]]) -> dict:
        return {
            "instants": [
                {"seq": k, "position": p, "quat_raw": [0, 0, 0, 1], "slots": [{"slot": s, "image": f"slot{s}/seq{k:05d}.jpg"} for s in range(4)]}
                for k, p in enumerate(positions)
            ]
        }

    def test_same_instant_pairs_plus_symmetric_cross_instant_pairs_without_duplicates(self) -> None:
        from xbag_colmap import build_pairs

        pairs = build_pairs(self.manifest([[0, 0, 0], [1, 0, 0]]), neighbours=6, radius=3.0)
        self.assertEqual(len(pairs), 2 * 6 + 16)
        self.assertEqual(len(set(pairs)), len(pairs))
        self.assertTrue(all(a < b or a.split("/")[1] < b.split("/")[1] for a, b in pairs if a.split("/")[1] != b.split("/")[1]))
        self.assertIn(("slot0/seq00000.jpg", "slot3/seq00001.jpg"), pairs)
        self.assertIn(("slot3/seq00000.jpg", "slot0/seq00001.jpg"), pairs)

    def test_instants_beyond_the_radius_are_not_paired(self) -> None:
        from xbag_colmap import build_pairs

        pairs = build_pairs(self.manifest([[0, 0, 0], [10, 0, 0]]), neighbours=6, radius=3.0)
        self.assertEqual(len(pairs), 2 * 6)


class DatabaseCameras(unittest.TestCase):
    """One extraction pass gives every folder the same provisional camera; the bridge then rewrites each folder's camera to its lens."""

    def test_rewrites_each_folder_camera_to_the_slot_calibration(self) -> None:
        try:
            import pycolmap
        except ImportError:
            self.skipTest("pycolmap not installed")
        from xbag_colmap import assign_database_cameras

        manifest = ModelEntries().manifest()
        with tempfile.TemporaryDirectory() as tmp:
            cal = load_calibration(write_calibration(tmp))
            db_path = os.path.join(tmp, "database.db")
            db = pycolmap.Database.open(db_path)
            try:
                for slot in range(4):
                    camera = pycolmap.Camera(model="OPENCV", width=4000, height=3000, params=[1930, 1931, 1940, 1727, -0.01, -0.05, 0.0001, 0.0002], camera_id=slot + 1)
                    db.write_camera(camera, use_camera_id=True)
                    for seq in (5, 9):
                        image = pycolmap.Image(name=f"slot{slot}/seq{seq:05d}.jpg", camera_id=slot + 1)
                        db.write_image(image)
                assigned = assign_database_cameras(db, manifest, cal)
                cameras = {camera.camera_id: camera for camera in db.read_all_cameras()}
            finally:
                db.close()
        self.assertEqual(assigned, {"slot0": "camera_2", "slot1": "camera_3", "slot2": "camera_0", "slot3": "camera_1"})
        self.assertEqual(cameras[3].model.name, "OPENCV_FISHEYE")
        np.testing.assert_allclose(list(cameras[3].params), [800, 801, 2000, 1500, 0.08, -0.002, -0.016, 0.004])
        self.assertEqual(cameras[2].model.name, "OPENCV")
        np.testing.assert_allclose(list(cameras[2].params)[:4], [1928, 1931, 1942, 1725])


class PoseDeltaStats(unittest.TestCase):
    """How far bundle adjustment moved the cameras from the pose-file poses: the pose file's accuracy, measured."""

    def test_reports_rotation_and_translation_percentiles(self) -> None:
        from xbag_colmap import pose_delta_stats

        before = []
        after = []
        for k in range(10):
            T = np.eye(4)
            T[:3, 3] = [k, 0, 0]
            before.append(T)
            moved = T.copy()
            moved[:3, :3] = quat_xyzw_to_matrix(quat_about_z(1.0 * k))  # 0..9 degrees
            moved[:3, 3] = [k, 0.01 * k, 0]                              # 0..9 cm
            after.append(moved)
        stats = pose_delta_stats(before, after)
        self.assertEqual(stats["count"], 10)
        self.assertAlmostEqual(stats["rotation_deg"]["median"], 4.5, places=6)
        self.assertAlmostEqual(stats["rotation_deg"]["p95"], 8.55, places=6)
        self.assertAlmostEqual(stats["translation_m"]["median"], 0.045, places=9)
        self.assertAlmostEqual(stats["translation_m"]["max"], 0.09, places=9)

    def test_refuses_mismatched_lists(self) -> None:
        from xbag_colmap import pose_delta_stats

        with self.assertRaises(ValueError):
            pose_delta_stats([np.eye(4)], [])


class LensCircle(unittest.TestCase):
    """The optical class comes from the calibrated lens circle: outside it a fisheye frame is dark, a pinhole frame is not."""

    def test_circle_radius_follows_the_kb4_model_at_the_lens_field_of_view(self) -> None:
        from xbag_colmap import fisheye_circle

        with tempfile.TemporaryDirectory() as tmp:
            cal = load_calibration(write_calibration(tmp))
        camera = cal.cameras["camera_0"]._replace(distortion=(0.0, 0.0, 0.0, 0.0))
        cx, cy, radius = fisheye_circle(camera, fov_degrees=200)
        self.assertEqual((cx, cy), (2000, 1500))
        self.assertAlmostEqual(radius, 800 * math.radians(100), places=6)

    def test_ratio_is_small_for_a_dark_surround_and_near_one_for_a_full_frame(self) -> None:
        from xbag_colmap import outside_circle_ratio

        yy, xx = np.mgrid[0:3000, 0:4000]
        inside = np.hypot(xx - 2006, yy - 1505) < 1543
        fisheye = np.where(inside, 120.0, 2.0).astype(np.float32)
        pinhole = np.full((3000, 4000), 120.0, dtype=np.float32)
        self.assertLess(outside_circle_ratio(fisheye, (2006, 1505, 1543)), 0.05)
        self.assertAlmostEqual(outside_circle_ratio(pinhole, (2006, 1505, 1543)), 1.0, places=3)

    def test_classes_take_the_two_lowest_ratios_as_the_fisheyes(self) -> None:
        from xbag_colmap import classes_from_circle_ratios

        self.assertEqual(classes_from_circle_ratios([0.9, 0.37, 0.03, 0.068]), ["rectilinear", "rectilinear", "fisheye", "fisheye"])
        self.assertEqual(classes_from_circle_ratios([0.03, 0.9, 0.02, 0.85]), ["fisheye", "rectilinear", "fisheye", "rectilinear"])

    def test_the_darkest_measured_instant_still_splits_by_the_relative_gap(self) -> None:
        # Grand Hall seq 1068: pinholes in an unlit corner score 0.18-0.19, the fisheyes 0.074 and 0.036
        from xbag_colmap import classes_from_circle_ratios

        self.assertEqual(classes_from_circle_ratios([0.183, 0.194, 0.074, 0.036]), ["rectilinear", "rectilinear", "fisheye", "fisheye"])

    def test_refuses_ratios_that_do_not_split_into_two_and_two(self) -> None:
        from xbag_colmap import classes_from_circle_ratios

        with self.assertRaises(ValueError):
            classes_from_circle_ratios([0.5, 0.5, 0.5, 0.5])          # nothing looks like a lens circle
        with self.assertRaises(ValueError):
            classes_from_circle_ratios([0.03, 0.02, 0.04, 0.9])       # three dark surrounds
        with self.assertRaises(ValueError):
            classes_from_circle_ratios([0.10, 0.12, 0.07, 0.06])      # no clear gap between the pairs


if __name__ == "__main__":
    unittest.main()
