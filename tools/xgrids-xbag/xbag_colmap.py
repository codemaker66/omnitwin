"""XBAG -> COLMAP bridge: posed frames for a bounded zone of a capture.

Inputs are the keyframe index written by ``xbag_extract.py index``, the
capture's ``project_data/poses.csv`` (10 Hz body poses: ``ts, x, y, z, qx, qy,
qz, qw``) and the T-566 calibration receipt (four cameras with intrinsics,
distortion and a pose relative to camera_0; ``camera_lidar`` and ``imu_lidar``
cross-sensor matrices). The receipt leaves four things unresolved and this
module resolves them by measurement rather than assumption:

- which stored fisheye is camera_0 versus camera_1, and which pinhole is
  camera_2 versus camera_3 (``fisheye_order`` / ``pinhole_order``);
- the direction of the per-camera pose matrices (``camera_pose_inverse``);
- the direction of the cross-sensor matrices and which sensor the pose file
  describes (``body_frame``, eight readings including "the pose file is
  already camera_0" in OpenCV or OpenGL axes);
- the pose file's quaternion layout and direction (``quat_layout``,
  ``pose_inverse``).

Every combination is a ``Hypothesis``; ``score`` ranks all 256 by how well the
resulting camera poses explain the verified feature matches between frames
(Sampson epipolar error on calibrated, undistorted points). The winner writes
the COLMAP text model; ``triangulate`` then checks it with COLMAP's own
known-pose triangulation.

Pipeline (each step is a subcommand, all inputs read-only):

    select   -> zone manifest (instants whose interpolated pose lies in the box)
    extract  -> images/slot{k}/seq{n}.jpg, optical class per slot
    features -> COLMAP database (SIFT in one pass, then one camera per slot folder)
    pairs    -> pose-guided pair list (same instant + nearest instants)
    match    -> feature matching + geometric verification for those pairs
    score    -> scores.csv, one row per hypothesis
    write    -> sparse/0/{cameras,images,points3D}.txt for one hypothesis
    triangulate -> sparse/0-triangulated with COLMAP's known-pose triangulator
    refine   -> sparse/0-refined: bundle adjustment with the calibration fixed, pose deltas reported

The pure parts (interpolation, frames, writers, scoring) need only numpy and
OpenCV; the heavy steps need the optional ``av`` and ``pycolmap`` packages.
"""

from __future__ import annotations

import argparse
import csv
import io
import itertools
import json
import math
import mmap
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Iterable, NamedTuple, Sequence

import numpy as np

from xbag_records import FrameRecord, OpticalClass, group_cotimed

if TYPE_CHECKING:  # optional dependencies, imported lazily at run time
    import pycolmap
    from PIL import Image

COLMAP_MODEL_BY_SOURCE = {"kb4": "OPENCV_FISHEYE", "pinhole": "OPENCV"}
CALIBRATION_IDS = ("camera_0", "camera_1", "camera_2", "camera_3")
FISHEYE_RATIO_MAX = 0.2   # outside-circle / inner-ring intensity: fisheye frames measured 0.017-0.074 on the Grand Hall
PINHOLE_GAP_FACTOR = 2.0  # the darkest pinhole of an instant must score at least this multiple of its brightest fisheye (0.183 vs 0.074 at seq 1068)
QUAT_LAYOUTS = ("xyzw", "wxyz")
BODY_FRAMES = (
    "lidar/c2l",       # pose file = LiDAR; camera_lidar maps camera_0 -> LiDAR
    "lidar/l2c",       # pose file = LiDAR; camera_lidar maps LiDAR -> camera_0
    "imu/i2l/c2l",     # pose file = IMU; imu_lidar maps IMU -> LiDAR; camera_lidar camera -> LiDAR
    "imu/i2l/l2c",
    "imu/l2i/c2l",     # pose file = IMU; imu_lidar maps LiDAR -> IMU
    "imu/l2i/l2c",
    "camera0/opencv",  # pose file is already camera_0 (x right, y down, z forward)
    "camera0/opengl",  # pose file is camera_0 in OpenGL axes (x right, y up, z backward)
)
FISHEYE_IDS = ("camera_0", "camera_1")
PINHOLE_IDS = ("camera_2", "camera_3")
_OPENGL_TO_OPENCV = np.diag([1.0, -1.0, -1.0, 1.0])


class CalibratedCamera(NamedTuple):
    camera_id: str
    model: str
    colmap_model: str
    width: int
    height: int
    intrinsics: tuple[float, float, float, float]
    distortion: tuple[float, ...]
    pose: np.ndarray  # 4x4 as given in the receipt, relative to camera_0

    @property
    def is_fisheye(self) -> bool:
        return self.colmap_model == "OPENCV_FISHEYE"

    @property
    def focal(self) -> float:
        return 0.5 * (self.intrinsics[0] + self.intrinsics[1])


@dataclass(frozen=True)
class Calibration:
    cameras: dict[str, CalibratedCamera]
    camera_lidar: np.ndarray
    imu_lidar: np.ndarray


@dataclass(frozen=True)
class Hypothesis:
    quat_layout: str
    pose_inverse: bool
    body_frame: str
    camera_pose_inverse: bool
    fisheye_order: tuple[int, int]
    pinhole_order: tuple[int, int]

    def label(self) -> str:
        return (
            f"{self.quat_layout}{'^-1' if self.pose_inverse else ''}|{self.body_frame}|"
            f"campose{'^-1' if self.camera_pose_inverse else ''}|fish{self.fisheye_order[0]}{self.fisheye_order[1]}|pin{self.pinhole_order[0]}{self.pinhole_order[1]}"
        )

    def to_dict(self) -> dict:
        return {
            "quat_layout": self.quat_layout,
            "pose_inverse": self.pose_inverse,
            "body_frame": self.body_frame,
            "camera_pose_inverse": self.camera_pose_inverse,
            "fisheye_order": list(self.fisheye_order),
            "pinhole_order": list(self.pinhole_order),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Hypothesis":
        return cls(
            quat_layout=str(data["quat_layout"]),
            pose_inverse=bool(data["pose_inverse"]),
            body_frame=str(data["body_frame"]),
            camera_pose_inverse=bool(data["camera_pose_inverse"]),
            fisheye_order=(int(data["fisheye_order"][0]), int(data["fisheye_order"][1])),
            pinhole_order=(int(data["pinhole_order"][0]), int(data["pinhole_order"][1])),
        )


class ZoneBox(NamedTuple):
    xmin: float
    xmax: float
    ymin: float
    ymax: float

    def contains(self, position: np.ndarray) -> bool:
        return bool(self.xmin <= position[0] <= self.xmax and self.ymin <= position[1] <= self.ymax)


class ZoneInstant(NamedTuple):
    seq: int
    ts_us: int
    records: tuple[FrameRecord, ...]
    position: np.ndarray
    quat_raw: np.ndarray  # the four numbers as stored in the pose file


class ImageEntry(NamedTuple):
    image_id: int
    name: str
    camera_id: int
    T_world_cam: np.ndarray


# --------------------------------------------------------------------------- calibration


def _matrix_from_row_major(values: Sequence[float]) -> np.ndarray:
    matrix = np.array([float(v) for v in values], dtype=float).reshape(4, 4)
    if not np.allclose(matrix[3], [0, 0, 0, 1]):
        raise ValueError("a 4x4 pose must end with the row 0 0 0 1")
    return matrix


def load_calibration(path: str | Path) -> Calibration:
    """Read the T-566 receipt (or any JSON with the same ``calibration`` shape)."""
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    block = data["calibration"] if "calibration" in data else data
    cameras: dict[str, CalibratedCamera] = {}
    for entry in block["cameras"]:
        model = str(entry["cameraModel"])
        if model not in COLMAP_MODEL_BY_SOURCE:
            raise ValueError(f"{entry['cameraId']}: unknown camera model {model!r}")
        intrinsics = tuple(float(v) for v in entry["intrinsicSourceOrder"])
        if len(intrinsics) != 4:
            raise ValueError(f"{entry['cameraId']}: expected fx fy cx cy, got {len(intrinsics)} values")
        distortion = tuple(float(v) for v in entry["distortionSourceOrder"])
        if len(distortion) != 4:
            raise ValueError(f"{entry['cameraId']}: expected four distortion coefficients, got {len(distortion)}")
        cameras[str(entry["cameraId"])] = CalibratedCamera(
            camera_id=str(entry["cameraId"]),
            model=model,
            colmap_model=COLMAP_MODEL_BY_SOURCE[model],
            width=int(entry.get("imageWidthPx", 4000)),
            height=int(entry.get("imageHeightPx", 3000)),
            intrinsics=intrinsics,  # type: ignore[arg-type]
            distortion=distortion,
            pose=_matrix_from_row_major(entry["cameraPose"]["rowMajor"]),
        )
    transforms = {str(t["sourceLabel"]): _matrix_from_row_major(t["transform"]["rowMajor"]) for t in block["crossSensorTransforms"]}
    missing = {"camera_lidar", "imu_lidar"} - set(transforms)
    if missing:
        raise ValueError(f"calibration lacks cross-sensor transforms: {sorted(missing)}")
    return Calibration(cameras=cameras, camera_lidar=transforms["camera_lidar"], imu_lidar=transforms["imu_lidar"])


# --------------------------------------------------------------------------- rotations and poses


def quat_xyzw_to_matrix(q: Sequence[float]) -> np.ndarray:
    x, y, z, w = (float(v) for v in q)
    n = math.sqrt(x * x + y * y + z * z + w * w)
    if n == 0:
        raise ValueError("zero quaternion")
    x, y, z, w = x / n, y / n, z / n, w / n
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def matrix_to_quat_wxyz(R: np.ndarray) -> tuple[float, float, float, float]:
    """Rotation matrix -> unit quaternion (w, x, y, z) with w >= 0 (Shepperd's method)."""
    m = np.asarray(R, dtype=float)
    trace = m[0, 0] + m[1, 1] + m[2, 2]
    if trace > 0:
        s = math.sqrt(trace + 1.0) * 2
        w, x, y, z = 0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        w, x, y, z = (m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        w, x, y, z = (m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        w, x, y, z = (m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s
    if w < 0:
        w, x, y, z = -w, -x, -y, -z
    n = math.sqrt(w * w + x * x + y * y + z * z)
    return w / n, x / n, y / n, z / n


def load_poses_csv(path: str | Path) -> np.ndarray:
    """``poses.csv`` -> (N, 8) float array ``[ts, x, y, z, q0, q1, q2, q3]`` sorted by time; a header row is skipped."""
    rows: list[list[float]] = []
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.reader(handle):
            if len(row) < 8:
                continue
            try:
                rows.append([float(v) for v in row[:8]])
            except ValueError:
                continue  # header
    if not rows:
        raise ValueError(f"{path}: no pose rows")
    poses = np.array(rows, dtype=float)
    return poses[np.argsort(poses[:, 0], kind="stable")]


def _slerp(qa: np.ndarray, qb: np.ndarray, weight: float) -> np.ndarray:
    qa = qa / np.linalg.norm(qa)
    qb = qb / np.linalg.norm(qb)
    dot = float(np.dot(qa, qb))
    if dot < 0:
        qb, dot = -qb, -dot
    if dot > 0.9995:
        out = qa + weight * (qb - qa)
        return out / np.linalg.norm(out)
    theta = math.acos(min(1.0, dot))
    sin_theta = math.sin(theta)
    return (math.sin((1 - weight) * theta) / sin_theta) * qa + (math.sin(weight * theta) / sin_theta) * qb


def interpolate_pose(poses: np.ndarray, t: float) -> tuple[np.ndarray, np.ndarray] | None:
    """Position and unit quaternion (same four-number layout as the file) at time ``t``, or ``None`` outside the file's span."""
    times = poses[:, 0]
    if t < times[0] or t > times[-1]:
        return None
    index = int(np.searchsorted(times, t, side="left"))
    if index < len(poses) and times[index] == t:
        row = poses[index]
        return row[1:4].copy(), row[4:8] / np.linalg.norm(row[4:8])
    before, after = poses[index - 1], poses[index]
    span = after[0] - before[0]
    weight = 0.0 if span <= 0 else (t - before[0]) / span
    position = before[1:4] * (1 - weight) + after[1:4] * weight
    return position, _slerp(before[4:8], after[4:8], weight)


def body_pose_matrix(position: np.ndarray, quat: np.ndarray, *, layout: str, inverse: bool) -> np.ndarray:
    """4x4 body pose from a position and the file's four quaternion numbers read in ``layout`` (``xyzw`` or ``wxyz``)."""
    if layout == "xyzw":
        q_xyzw = np.asarray(quat, dtype=float)
    elif layout == "wxyz":
        q_xyzw = np.array([quat[1], quat[2], quat[3], quat[0]], dtype=float)
    else:
        raise ValueError(f"unknown quaternion layout {layout!r}")
    T = np.eye(4)
    T[:3, :3] = quat_xyzw_to_matrix(q_xyzw)
    T[:3, 3] = np.asarray(position, dtype=float)
    return np.linalg.inv(T) if inverse else T


def enumerate_hypotheses() -> list[Hypothesis]:
    orders = ((0, 1), (1, 0))
    return [
        Hypothesis(layout, pose_inverse, body, camera_pose_inverse, fisheye, pinhole)
        for layout in QUAT_LAYOUTS
        for pose_inverse in (False, True)
        for body in BODY_FRAMES
        for camera_pose_inverse in (False, True)
        for fisheye in orders
        for pinhole in orders
    ]


def body_to_camera0(body_frame: str, calibration: Calibration) -> np.ndarray:
    """The matrix B with T_world_camera0 = T_world_body @ B under one reading of the cross-sensor matrices."""
    C = calibration.camera_lidar
    M = calibration.imu_lidar
    inv = np.linalg.inv
    table = {
        "lidar/c2l": lambda: C,
        "lidar/l2c": lambda: inv(C),
        "imu/i2l/c2l": lambda: inv(M) @ C,
        "imu/i2l/l2c": lambda: inv(M) @ inv(C),
        "imu/l2i/c2l": lambda: M @ C,
        "imu/l2i/l2c": lambda: M @ inv(C),
        "camera0/opencv": lambda: np.eye(4),
        "camera0/opengl": lambda: _OPENGL_TO_OPENCV.copy(),
    }
    if body_frame not in table:
        raise ValueError(f"unknown body frame {body_frame!r}; expected one of {BODY_FRAMES}")
    return table[body_frame]()


def camera_world_matrix(T_world_body: np.ndarray, body_to_cam0: np.ndarray, T_cam0_cam: np.ndarray, *, camera_pose_inverse: bool) -> np.ndarray:
    offset = np.linalg.inv(T_cam0_cam) if camera_pose_inverse else T_cam0_cam
    return T_world_body @ body_to_cam0 @ offset


def world_to_camera_colmap(T_world_cam: np.ndarray) -> tuple[float, float, float, float, float, float, float]:
    """COLMAP's image pose: rotation (qw qx qy qz) and translation with x_cam = R x_world + t."""
    R_cw = T_world_cam[:3, :3].T
    t = -R_cw @ T_world_cam[:3, 3]
    qw, qx, qy, qz = matrix_to_quat_wxyz(R_cw)
    return qw, qx, qy, qz, float(t[0]), float(t[1]), float(t[2])


def assign_cameras(optical_classes: Sequence[str], hypothesis: Hypothesis) -> list[str]:
    """Calibration camera id per slot of a co-timed group, from the optical classes and the hypothesis' orders."""
    fisheye_slots = [i for i, c in enumerate(optical_classes) if c == OpticalClass.FISHEYE.value]
    pinhole_slots = [i for i, c in enumerate(optical_classes) if c == OpticalClass.RECTILINEAR.value]
    if len(fisheye_slots) != 2 or len(pinhole_slots) != 2 or len(optical_classes) != 4:
        raise ValueError(f"a co-timed group needs two fisheye and two rectilinear slots, got {list(optical_classes)}")
    assigned = [""] * 4
    for slot, order in zip(fisheye_slots, hypothesis.fisheye_order):
        assigned[slot] = FISHEYE_IDS[order]
    for slot, order in zip(pinhole_slots, hypothesis.pinhole_order):
        assigned[slot] = PINHOLE_IDS[order]
    return assigned


def camera_pose_under(hypothesis: Hypothesis, calibration: Calibration, position: np.ndarray, quat_raw: np.ndarray, camera_id: str) -> np.ndarray:
    """T_world_camera for one frame under one hypothesis."""
    T_world_body = body_pose_matrix(position, quat_raw, layout=hypothesis.quat_layout, inverse=hypothesis.pose_inverse)
    B = body_to_camera0(hypothesis.body_frame, calibration)
    return camera_world_matrix(T_world_body, B, calibration.cameras[camera_id].pose, camera_pose_inverse=hypothesis.camera_pose_inverse)


# --------------------------------------------------------------------------- zone selection


def select_zone_instants(groups: Iterable[Sequence[FrameRecord]], poses: np.ndarray, zone: ZoneBox, budget: int) -> list[ZoneInstant]:
    """Complete four-camera instants whose interpolated pose lies inside ``zone``, spread evenly to at most ``budget``."""
    if not (zone.xmin < zone.xmax and zone.ymin < zone.ymax):
        raise ValueError(f"zone bounds must satisfy xmin < xmax and ymin < ymax, got {zone}")
    inside: list[ZoneInstant] = []
    for group in groups:
        if len(group) != 4:
            continue
        ts_us = group[0].ts_us
        result = interpolate_pose(poses, ts_us / 1e6)
        if result is None:
            continue
        position, quat = result
        if zone.contains(position):
            inside.append(ZoneInstant(seq=group[0].seq, ts_us=ts_us, records=tuple(group), position=position, quat_raw=quat))
    inside.sort(key=lambda instant: instant.ts_us)
    if budget <= 0:
        raise ValueError("budget must be positive")
    if len(inside) <= budget:
        return inside
    picks = np.unique(np.round(np.linspace(0, len(inside) - 1, budget)).astype(int))
    return [inside[i] for i in picks]


# --------------------------------------------------------------------------- COLMAP text model


def _fmt(value: float) -> str:
    return f"{value:.10g}"


def colmap_camera_line(camera_id: int, camera: CalibratedCamera) -> str:
    params = " ".join(_fmt(v) for v in (*camera.intrinsics, *camera.distortion))
    return f"{camera_id} {camera.colmap_model} {camera.width} {camera.height} {params}"


def write_sparse_text(out_dir: str | Path, cameras: Sequence[tuple[int, CalibratedCamera]], images: Sequence[ImageEntry]) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "cameras.txt", "w", encoding="utf-8", newline="\n") as handle:
        handle.write("# Camera list with one line of data per camera:\n#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]\n")
        handle.write(f"# Number of cameras: {len(cameras)}\n")
        for camera_id, camera in cameras:
            handle.write(colmap_camera_line(camera_id, camera) + "\n")
    with open(out / "images.txt", "w", encoding="utf-8", newline="\n") as handle:
        handle.write("# Image list with two lines of data per image:\n#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME\n#   POINTS2D[] as (X, Y, POINT3D_ID)\n")
        handle.write(f"# Number of images: {len(images)}, mean observations per image: 0\n")
        for image in images:
            qw, qx, qy, qz, tx, ty, tz = world_to_camera_colmap(image.T_world_cam)
            values = " ".join(_fmt(v) for v in (qw, qx, qy, qz, tx, ty, tz))
            handle.write(f"{image.image_id} {values} {image.camera_id} {image.name}\n\n")
    with open(out / "points3D.txt", "w", encoding="utf-8", newline="\n") as handle:
        handle.write("# 3D point list with one line of data per point:\n#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)\n# Number of points: 0, mean track length: 0\n")


# --------------------------------------------------------------------------- epipolar scoring


def normalised_points(camera: CalibratedCamera, pixels: np.ndarray) -> np.ndarray:
    """Pixel coordinates -> undistorted normalised image coordinates (x/z, y/z) for the camera's model."""
    import cv2  # optional dependency, only the scorer needs it

    fx, fy, cx, cy = camera.intrinsics
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=float)
    pts = np.ascontiguousarray(np.asarray(pixels, dtype=float).reshape(-1, 1, 2))
    if len(pts) == 0:
        return np.zeros((0, 2))
    if camera.is_fisheye:
        out = cv2.fisheye.undistortPoints(pts, K, np.array(camera.distortion[:4], dtype=float))
    else:
        out = cv2.undistortPoints(pts, K, np.array(camera.distortion[:4], dtype=float))
    return out.reshape(-1, 2)


def _skew(v: np.ndarray) -> np.ndarray:
    return np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]], dtype=float)


def sampson_distances(xa: np.ndarray, xb: np.ndarray, T_world_a: np.ndarray, T_world_b: np.ndarray) -> np.ndarray:
    """Sampson distance (normalised image units) of each correspondence under the hypothesised relative pose."""
    xa = np.asarray(xa, dtype=float).reshape(-1, 2)
    xb = np.asarray(xb, dtype=float).reshape(-1, 2)
    if len(xa) != len(xb):
        raise ValueError("correspondence arrays differ in length")
    if len(xa) == 0:
        return np.zeros(0)
    T_b_a = np.linalg.inv(T_world_b) @ T_world_a
    R, t = T_b_a[:3, :3], T_b_a[:3, 3]
    norm_t = np.linalg.norm(t)
    if norm_t < 1e-9:
        # pure rotation: a correspondence is consistent when R maps ray a onto ray b
        rays_a = np.c_[xa, np.ones(len(xa))] @ R.T
        rays_a /= rays_a[:, 2:3]
        return np.linalg.norm(rays_a[:, :2] - xb, axis=1)
    E = _skew(t / norm_t) @ R
    ha = np.c_[xa, np.ones(len(xa))]
    hb = np.c_[xb, np.ones(len(xb))]
    lb = ha @ E.T          # E @ xa, per row
    la = hb @ E            # E^T @ xb, per row
    numerator = np.sum(hb * lb, axis=1) ** 2
    denominator = lb[:, 0] ** 2 + lb[:, 1] ** 2 + la[:, 0] ** 2 + la[:, 1] ** 2
    with np.errstate(divide="ignore", invalid="ignore"):
        sampson = np.where(denominator > 0, numerator / denominator, np.inf)
    return np.sqrt(sampson)


def sampson_inlier_fraction(xa: np.ndarray, xb: np.ndarray, T_world_a: np.ndarray, T_world_b: np.ndarray, threshold: float) -> float:
    """Fraction of normalised correspondences whose Sampson distance under the hypothesised relative pose is below ``threshold``."""
    if len(xa) == 0 or len(xa) != len(xb):
        return 0.0
    return float(np.mean(sampson_distances(xa, xb, T_world_a, T_world_b) < threshold))


# --------------------------------------------------------------------------- optical class from the lens circle


def fisheye_circle(camera: CalibratedCamera, fov_degrees: float = 200.0) -> tuple[float, float, float]:
    """Centre and pixel radius of the lens circle: the kb4 model evaluated at half the lens field of view."""
    theta = math.radians(fov_degrees / 2)
    k1, k2, k3, k4 = (list(camera.distortion) + [0.0, 0.0, 0.0, 0.0])[:4]
    radius = camera.intrinsics[0] * (theta + k1 * theta**3 + k2 * theta**5 + k3 * theta**7 + k4 * theta**9)
    return camera.intrinsics[2], camera.intrinsics[3], radius


def outside_circle_ratio(gray: np.ndarray, circle: tuple[float, float, float], *, step: int = 4, margin: float = 100.0, ring: tuple[float, float] = (300.0, 100.0)) -> float:
    """Mean intensity beyond the lens circle (plus ``margin``) over the mean in a ring just inside it.

    A fisheye frame is dark outside its circle, so the ratio is near zero; a
    rectilinear frame carries scene across that arbitrary boundary, so the
    ratio sits near one however dark the scene. Corner darkness alone cannot
    tell a pinhole frame in an unlit corner from a fisheye.
    """
    cx, cy, radius = circle
    sample = np.asarray(gray, dtype=np.float32)[::step, ::step]
    yy, xx = np.mgrid[0 : sample.shape[0], 0 : sample.shape[1]]
    r = np.hypot(xx * step - cx, yy * step - cy)
    outer = r > radius + margin
    inner = (r > radius - ring[0]) & (r < radius - ring[1])
    if not outer.any() or not inner.any():
        raise ValueError("the lens circle leaves no pixels outside it or no ring inside it at this image size")
    return float((sample[outer].mean() + 1e-3) / (sample[inner].mean() + 1e-3))


def classes_from_circle_ratios(ratios: Sequence[float]) -> list[str]:
    """Optical class per slot of a co-timed group: the two lowest ratios are the fisheyes, and the split must be clear."""
    if len(ratios) != 4:
        raise ValueError(f"a co-timed group has four slots, got {len(ratios)} ratios")
    order = sorted(range(4), key=lambda i: ratios[i])
    fisheyes = set(order[:2])
    darkest_pinhole = min(ratios[i] for i in order[2:])
    brightest_fisheye = max(ratios[i] for i in fisheyes)
    if brightest_fisheye >= FISHEYE_RATIO_MAX or darkest_pinhole < PINHOLE_GAP_FACTOR * brightest_fisheye:
        raise ValueError(
            f"lens-circle ratios {[round(float(r), 3) for r in ratios]} do not split into two fisheye (< {FISHEYE_RATIO_MAX}) "
            f"and two rectilinear frames at least {PINHOLE_GAP_FACTOR:g}x brighter outside the circle"
        )
    return [OpticalClass.FISHEYE.value if i in fisheyes else OpticalClass.RECTILINEAR.value for i in range(4)]


# --------------------------------------------------------------------------- pose deltas


def pose_delta_stats(before: Sequence[np.ndarray], after: Sequence[np.ndarray]) -> dict:
    """Rotation (degrees) and translation (metres) between paired camera-to-world poses: median, p95, max."""
    if len(before) != len(after) or not before:
        raise ValueError("before and after need the same, non-zero number of poses")
    rotations = []
    translations = []
    for T_before, T_after in zip(before, after):
        relative = np.asarray(T_before)[:3, :3].T @ np.asarray(T_after)[:3, :3]
        cosine = np.clip((np.trace(relative) - 1.0) / 2.0, -1.0, 1.0)
        rotations.append(math.degrees(math.acos(cosine)))
        translations.append(float(np.linalg.norm(np.asarray(T_after)[:3, 3] - np.asarray(T_before)[:3, 3])))

    def summary(values: list[float]) -> dict:
        array = np.asarray(values, dtype=float)
        return {"median": float(np.median(array)), "p95": float(np.percentile(array, 95)), "max": float(array.max())}

    return {"count": len(before), "rotation_deg": summary(rotations), "translation_m": summary(translations)}


# --------------------------------------------------------------------------- manifest


def _record_dict(record: FrameRecord) -> dict:
    return {"record_offset": record.record_offset, "payload_offset": record.payload_offset, "payload_length": record.payload_length}


def image_name(slot: int, seq: int) -> str:
    return f"slot{slot}/seq{seq:05d}.jpg"


def write_manifest(path: str | Path, *, zone: ZoneBox, instants: Sequence[ZoneInstant], sources: dict) -> None:
    payload = {
        "schema": "xbag-colmap-zone-manifest/1",
        "zone": zone._asdict(),
        "sources": sources,
        "pose_quaternion_columns": "qx,qy,qz,qw as labelled by the file; the layout is a scored hypothesis",
        "instants": [
            {
                "seq": instant.seq,
                "ts_us": instant.ts_us,
                "position": [float(v) for v in instant.position],
                "quat_raw": [float(v) for v in instant.quat_raw],
                "slots": [dict(slot=slot, image=image_name(slot, instant.seq), **_record_dict(record)) for slot, record in enumerate(instant.records)],
            }
            for instant in instants
        ],
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1)


def read_manifest(path: str | Path) -> dict:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load_index_records(index_csv: str | Path) -> list[FrameRecord]:
    with open(index_csv, newline="", encoding="utf-8") as handle:
        return [
            FrameRecord(int(r["record_offset"]), int(r["seq"]), int(r["ts_us"]), int(r["codec_tag"]), int(r["width"]), int(r["height"]), int(r["payload_offset"]), int(r["payload_length"]))
            for r in csv.DictReader(handle)
        ]


# --------------------------------------------------------------------------- pipeline steps


def run_select(args: argparse.Namespace) -> int:
    poses = load_poses_csv(args.poses)
    records = load_index_records(args.index)
    zone = ZoneBox(*args.zone)
    groups = list(group_cotimed(records))
    instants = select_zone_instants(groups, poses, zone, args.budget)
    complete = sum(1 for g in groups if len(g) == 4)
    write_manifest(args.out, zone=zone, instants=instants, sources={"index_csv": str(args.index), "poses_csv": str(args.poses), "capture": str(args.capture) if args.capture else None})
    print(f"{complete} complete instants; {len(instants)} selected inside {zone} (budget {args.budget}) -> {args.out}")
    return 0


def decode_frame(payload: bytes) -> "Image.Image":
    import av  # optional dependency

    with av.open(io.BytesIO(payload), format="h264") as container:
        for frame in container.decode(video=0):
            return frame.to_image()
    raise ValueError("the decoder produced no picture")


def run_extract(args: argparse.Namespace) -> int:
    manifest = read_manifest(args.manifest)
    calibration = load_calibration(args.calibration)
    circle = fisheye_circle(calibration.cameras[FISHEYE_IDS[0]], args.fov_degrees)
    images_dir = Path(args.images)
    started = time.time()
    written = 0
    with open(args.capture, "rb") as handle:
        buf = mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ)
        try:
            for instant in manifest["instants"]:
                ratios = []
                for slot in instant["slots"]:
                    out = images_dir / slot["image"]
                    out.parent.mkdir(parents=True, exist_ok=True)
                    payload = bytes(buf[slot["payload_offset"] : slot["payload_offset"] + slot["payload_length"]])
                    picture = decode_frame(payload)
                    ratios.append(outside_circle_ratio(np.asarray(picture.convert("L")), circle))
                    slot["width"], slot["height"] = picture.width, picture.height
                    if not out.exists() or args.overwrite:
                        picture.save(out, quality=args.quality, subsampling=0)
                        written += 1
                try:
                    classes = classes_from_circle_ratios(ratios)
                except ValueError as error:
                    raise ValueError(f"seq {instant['seq']}: {error}") from error
                for slot, optical, ratio in zip(instant["slots"], classes, ratios):
                    slot["optical_class"] = optical
                    slot["circle_ratio"] = round(ratio, 4)
        finally:
            buf.close()
    with open(args.manifest, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=1)
    print(f"{written} frames written under {images_dir} in {time.time() - started:.0f}s; optical classes recorded in {args.manifest}")
    return 0


def slot_classes(manifest: dict) -> list[str]:
    """The optical class per slot, which must be the same at every instant for the per-folder camera of the database."""
    first = [s["optical_class"] for s in manifest["instants"][0]["slots"]]
    for instant in manifest["instants"]:
        classes = [s["optical_class"] for s in instant["slots"]]
        if classes != first:
            raise ValueError(f"seq {instant['seq']} orders its cameras {classes}, the first instant {first}; slot folders would mix lenses")
    return first


def provisional_camera_for_slot(manifest: dict, slot: int) -> str:
    """Provisional calibration id per slot for feature extraction: fisheye slots -> camera_0/1, rectilinear -> camera_2/3 in slot order."""
    return assign_cameras(slot_classes(manifest), Hypothesis("xyzw", False, BODY_FRAMES[0], False, (0, 1), (0, 1)))[slot]


def assign_database_cameras(db: "pycolmap.Database", manifest: dict, calibration: Calibration) -> dict[str, str]:
    """Rewrite each slot folder's database camera to the provisional calibration for its lens; returns folder -> calibration id.

    Feature extraction runs as one pass with one provisional camera model for
    every folder (see ``run_features``); geometric verification during
    matching wants the real lens model per folder, so the cameras are
    corrected here. Keypoints are in pixels and are not touched.
    """
    import pycolmap  # optional dependency

    folder_camera_ids: dict[str, int] = {}
    for image in db.read_all_images():
        folder = image.name.split("/")[0]
        if folder_camera_ids.setdefault(folder, image.camera_id) != image.camera_id:
            raise ValueError(f"database folder {folder} spans more than one camera")
    assigned: dict[str, str] = {}
    for slot in range(4):
        folder = manifest["instants"][0]["slots"][slot]["image"].split("/")[0]
        if folder not in folder_camera_ids:
            raise ValueError(f"folder {folder} has no images in the database")
        camera_id = provisional_camera_for_slot(manifest, slot)
        camera = calibration.cameras[camera_id]
        db.update_camera(
            pycolmap.Camera(model=camera.colmap_model, width=camera.width, height=camera.height, params=[*camera.intrinsics, *camera.distortion], camera_id=folder_camera_ids[folder])
        )
        assigned[folder] = camera_id
    return assigned


def run_features(args: argparse.Namespace) -> int:
    """SIFT for every selected frame in ONE extraction pass, then the per-folder cameras are corrected.

    One pass in the tool's own process is the launch pattern that never
    crashed here; a second ``extract_features`` call in the same process, and
    children spawned from a Python parent, died at start-up in most attempts
    (pycolmap 4.2.0, Windows; see .claude/gotchas/pycolmap-windows-traps.md).
    COLMAP skips frames already in the database, so a re-run after a crash
    continues where it stopped.
    """
    import pycolmap  # optional dependency

    manifest = read_manifest(args.manifest)
    calibration = load_calibration(args.calibration)
    expected = [slot["image"] for instant in manifest["instants"] for slot in instant["slots"]]
    extraction = pycolmap.FeatureExtractionOptions()
    extraction.num_threads = args.threads
    extraction.max_image_size = args.max_image_size
    extraction.sift.max_num_features = args.max_features
    provisional = calibration.cameras[PINHOLE_IDS[0]]
    reader = pycolmap.ImageReaderOptions()
    reader.camera_model = provisional.colmap_model
    reader.camera_params = ",".join(_fmt(v) for v in (*provisional.intrinsics, *provisional.distortion))
    pycolmap.extract_features(args.db, args.images, image_names=expected, camera_mode=pycolmap.CameraMode.PER_FOLDER, reader_options=reader, extraction_options=extraction)
    db = pycolmap.Database.open(args.db)
    try:
        registered = {image.name for image in db.read_all_images()}
        missing = sorted(set(expected) - registered)
        if missing:
            raise RuntimeError(f"{len(missing)} frames never reached the database, first {missing[:3]}; re-run to continue")
        assigned = assign_database_cameras(db, manifest, calibration)
        print(f"{db.num_images()} images, {db.num_keypoints()} keypoints, {db.num_cameras()} cameras ({assigned}) -> {args.db}")
    finally:
        db.close()
    return 0


def build_pairs(manifest: dict, neighbours: int, radius: float) -> list[tuple[str, str]]:
    """Same-instant pairs across the four slots, plus every slot pair between each instant and its nearest instants."""
    instants = manifest["instants"]
    positions = np.array([i["position"] for i in instants], dtype=float)
    pairs: set[tuple[str, str]] = set()
    for i, instant in enumerate(instants):
        names = [s["image"] for s in instant["slots"]]
        for a, b in itertools.combinations(names, 2):
            pairs.add((a, b))
        if len(instants) > 1 and neighbours > 0:
            distances = np.linalg.norm(positions - positions[i], axis=1)
            order = [j for j in np.argsort(distances) if j != i and distances[j] <= radius][:neighbours]
            for j in order:
                for a in names:
                    for b in (s["image"] for s in instants[j]["slots"]):
                        # canonical order by instant index, so a pair found from either side is the same tuple
                        pairs.add((a, b) if i < j else (b, a))
    return sorted(pairs)


def run_pairs(args: argparse.Namespace) -> int:
    manifest = read_manifest(args.manifest)
    pairs = build_pairs(manifest, args.neighbours, args.radius)
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        for a, b in pairs:
            handle.write(f"{a} {b}\n")
    print(f"{len(pairs)} pairs -> {args.out}")
    return 0


def run_match(args: argparse.Namespace) -> int:
    import pycolmap

    matching = pycolmap.FeatureMatchingOptions()
    matching.num_threads = args.threads
    pairing = pycolmap.ImportedPairingOptions()
    pairing.match_list_path = str(args.pairs)
    pairing.block_size = args.block_size
    started = time.time()
    pycolmap.match_image_pairs(args.db, matching_options=matching, pairing_options=pairing)
    db = pycolmap.Database.open(args.db)
    try:
        print(f"{db.num_matched_image_pairs()} matched pairs, {db.num_verified_image_pairs()} verified, in {time.time() - started:.0f}s -> {args.db}")
    finally:
        db.close()
    return 0


class _ScoringInputs(NamedTuple):
    instants: list[dict]
    image_slot: dict[str, tuple[int, int]]      # name -> (instant index, slot)
    keypoints: dict[str, np.ndarray]            # name -> (N,2) pixels
    pairs: list[tuple[str, str, np.ndarray]]    # (name_a, name_b, inlier index pairs)


def load_scoring_inputs(db_path: str, manifest: dict, pair_list: Sequence[tuple[str, str]], min_inliers: int) -> _ScoringInputs:
    import pycolmap

    db = pycolmap.Database.open(db_path)
    try:
        ids = {image.name: image.image_id for image in db.read_all_images()}
        image_slot = {slot["image"]: (i, s) for i, instant in enumerate(manifest["instants"]) for s, slot in enumerate(instant["slots"])}
        keypoints = {name: np.asarray(db.read_keypoints(image_id))[:, :2].astype(float) for name, image_id in ids.items() if name in image_slot}
        pairs: list[tuple[str, str, np.ndarray]] = []
        for a, b in pair_list:
            if a not in ids or b not in ids:
                continue
            id_a, id_b = ids[a], ids[b]
            if not db.exists_two_view_geometry(id_a, id_b):
                continue
            geometry = db.read_two_view_geometry(id_a, id_b)
            matches = np.asarray(geometry.inlier_matches)
            if len(matches) < min_inliers:
                continue
            if id_a > id_b:  # COLMAP stores the pair with the smaller id first
                matches = matches[:, ::-1]
                a, b = b, a
            pairs.append((a, b, matches))
    finally:
        db.close()
    return _ScoringInputs(manifest["instants"], image_slot, keypoints, pairs)


def score_hypotheses(inputs: _ScoringInputs, calibration: Calibration, hypotheses: Sequence[Hypothesis], pixel_threshold: float) -> list[dict]:
    """One row per hypothesis: weighted inlier fraction over all pairs, plus same-instant and cross-instant breakdowns."""
    # normalised keypoints depend only on which calibration camera a slot gets; cache per (name, camera id)
    normalised: dict[tuple[str, str], np.ndarray] = {}

    def norm(name: str, camera_id: str) -> np.ndarray:
        key = (name, camera_id)
        if key not in normalised:
            normalised[key] = normalised_points(calibration.cameras[camera_id], inputs.keypoints[name])
        return normalised[key]

    rows = []
    for hypothesis in hypotheses:
        assigned_by_instant = [assign_cameras([s["optical_class"] for s in instant["slots"]], hypothesis) for instant in inputs.instants]
        poses: dict[str, np.ndarray] = {}
        camera_of: dict[str, str] = {}
        for name, (i, slot) in inputs.image_slot.items():
            instant = inputs.instants[i]
            camera_of[name] = assigned_by_instant[i][slot]
            poses[name] = camera_pose_under(hypothesis, calibration, np.array(instant["position"]), np.array(instant["quat_raw"]), camera_of[name])
        totals = {"all": [0.0, 0], "same_instant": [0.0, 0], "cross_instant": [0.0, 0]}
        for a, b, matches in inputs.pairs:
            cam_a, cam_b = camera_of[a], camera_of[b]
            threshold = pixel_threshold / min(calibration.cameras[cam_a].focal, calibration.cameras[cam_b].focal)
            xa = norm(a, cam_a)[matches[:, 0]]
            xb = norm(b, cam_b)[matches[:, 1]]
            fraction = sampson_inlier_fraction(xa, xb, poses[a], poses[b], threshold)
            kind = "same_instant" if inputs.image_slot[a][0] == inputs.image_slot[b][0] else "cross_instant"
            for bucket in ("all", kind):
                totals[bucket][0] += fraction * len(matches)
                totals[bucket][1] += len(matches)
        row = {"label": hypothesis.label(), **hypothesis.to_dict()}
        for bucket, (weighted, count) in totals.items():
            row[bucket] = weighted / count if count else 0.0
            row[f"{bucket}_matches"] = count
        rows.append(row)
    rows.sort(key=lambda r: (-r["all"], r["label"]))
    return rows


def run_score(args: argparse.Namespace) -> int:
    manifest = read_manifest(args.manifest)
    calibration = load_calibration(args.calibration)
    with open(args.pairs, encoding="utf-8") as handle:
        pair_list = [tuple(line.split()) for line in handle if line.strip()]
    inputs = load_scoring_inputs(args.db, manifest, pair_list, args.min_inliers)  # type: ignore[arg-type]
    started = time.time()
    rows = score_hypotheses(inputs, calibration, enumerate_hypotheses(), args.pixel_threshold)
    columns = list(rows[0].keys())
    with open(args.out, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: (f"{v:.4f}" if isinstance(v, float) else v) for k, v in row.items()})
    print(f"{len(inputs.pairs)} verified pairs, {sum(len(m) for _, _, m in inputs.pairs)} matches; {len(rows)} hypotheses scored in {time.time() - started:.0f}s -> {args.out}")
    for row in rows[:5]:
        print(f"  {row['all']:.3f} (same {row['same_instant']:.3f}, cross {row['cross_instant']:.3f})  {row['label']}")
    return 0


def build_model_entries(
    manifest: dict,
    calibration: Calibration,
    hypothesis: Hypothesis,
    image_ids: dict[str, int] | None,
    folder_camera_ids: dict[str, int] | None,
) -> tuple[list[tuple[int, CalibratedCamera]], list[ImageEntry]]:
    """Cameras and posed images for one hypothesis.

    COLMAP's triangulator loads the database alongside the model and insists
    that a model camera and the database camera with the same id share a lens
    model, so each slot folder's camera keeps the id the database gave it
    (``folder_camera_ids``) and carries the calibration the hypothesis assigns
    to that slot. Without a database, slots number the cameras 1 to 4 and
    images count up in manifest order.
    """
    slot_assignment = assign_cameras(slot_classes(manifest), hypothesis)
    cameras: list[tuple[int, CalibratedCamera]] = []
    camera_id_by_slot: dict[int, int] = {}
    for slot in range(4):
        folder = manifest["instants"][0]["slots"][slot]["image"].split("/")[0]
        camera_id = folder_camera_ids[folder] if folder_camera_ids is not None else slot + 1
        camera_id_by_slot[slot] = camera_id
        cameras.append((camera_id, calibration.cameras[slot_assignment[slot]]))
    images: list[ImageEntry] = []
    next_id = 1
    for instant in manifest["instants"]:
        for slot, entry in enumerate(instant["slots"]):
            name = entry["image"]
            if image_ids is not None:
                if name not in image_ids:
                    continue
                image_id = image_ids[name]
            else:
                image_id, next_id = next_id, next_id + 1
            T = camera_pose_under(hypothesis, calibration, np.array(instant["position"]), np.array(instant["quat_raw"]), slot_assignment[slot])
            images.append(ImageEntry(image_id, name, camera_id_by_slot[slot], T))
    images.sort(key=lambda image: image.image_id)
    return cameras, images


def _hypothesis_from_args(args: argparse.Namespace) -> Hypothesis:
    if args.hypothesis_json:
        with open(args.hypothesis_json, encoding="utf-8") as handle:
            return Hypothesis.from_dict(json.load(handle))
    with open(args.scores, newline="", encoding="utf-8") as handle:
        best = next(csv.DictReader(handle))
    return Hypothesis(
        quat_layout=best["quat_layout"],
        pose_inverse=best["pose_inverse"] == "True",
        body_frame=best["body_frame"],
        camera_pose_inverse=best["camera_pose_inverse"] == "True",
        fisheye_order=tuple(json.loads(best["fisheye_order"])),  # type: ignore[arg-type]
        pinhole_order=tuple(json.loads(best["pinhole_order"])),  # type: ignore[arg-type]
    )


def run_write(args: argparse.Namespace) -> int:
    manifest = read_manifest(args.manifest)
    calibration = load_calibration(args.calibration)
    hypothesis = _hypothesis_from_args(args)
    image_ids = None
    folder_camera_ids = None
    if args.db:
        import pycolmap

        db = pycolmap.Database.open(args.db)
        try:
            images_in_db = db.read_all_images()
            image_ids = {image.name: image.image_id for image in images_in_db}
            folder_camera_ids = {}
            for image in images_in_db:
                folder = image.name.split("/")[0]
                if folder_camera_ids.setdefault(folder, image.camera_id) != image.camera_id:
                    raise ValueError(f"database folder {folder} spans more than one camera; the model cannot follow it")
        finally:
            db.close()
    cameras, images = build_model_entries(manifest, calibration, hypothesis, image_ids, folder_camera_ids)
    expected = 4 * len(manifest["instants"])
    if len(images) != expected:
        print(f"warning: {expected - len(images)} of {expected} frames are not in the database and were left out of the model", file=sys.stderr, flush=True)
    write_sparse_text(args.out, cameras, images)
    with open(Path(args.out) / "hypothesis.json", "w", encoding="utf-8") as handle:
        json.dump(
            {
                "hypothesis": hypothesis.to_dict(),
                "label": hypothesis.label(),
                "colmap_camera_ids": {camera_id: camera.camera_id for camera_id, camera in cameras},
                "slot_assignment": dict(zip((s["image"].split("/")[0] for s in manifest["instants"][0]["slots"]), assign_cameras(slot_classes(manifest), hypothesis))),
                "images_written": len(images),
                "images_missing_from_database": expected - len(images),
            },
            handle,
            indent=1,
        )
    print(f"{len(cameras)} cameras, {len(images)} images under {hypothesis.label()} -> {args.out}")
    return 0


def run_triangulate(args: argparse.Namespace) -> int:
    import pycolmap

    reconstruction = pycolmap.Reconstruction(args.model)
    options = pycolmap.IncrementalPipelineOptions()
    options.triangulation.min_angle = args.min_angle
    # one pixel bound for creating, completing and merging tracks and for the final filter;
    # loose for pose-file poses (a few px of pose error is normal), tight after refinement
    options.triangulation.merge_max_reproj_error = args.max_reproj_error
    options.triangulation.complete_max_reproj_error = args.max_reproj_error
    options.triangulation.create_max_angle_error = args.max_angle_error
    options.triangulation.continue_max_angle_error = args.max_angle_error
    options.triangulation.re_max_angle_error = max(args.max_angle_error, 5.0)
    options.mapper.filter_max_reproj_error = args.max_reproj_error
    options.mapper.filter_min_tri_angle = args.min_angle
    Path(args.out).mkdir(parents=True, exist_ok=True)
    started = time.time()
    result = pycolmap.triangulate_points(reconstruction, args.db, args.images, args.out, options=options)
    stats = {
        "images": result.num_images(),
        "registered_images": result.num_reg_images(),
        "points3D": result.num_points3D(),
        "mean_reprojection_error_px": result.compute_mean_reprojection_error(),
        "mean_track_length": result.compute_mean_track_length(),
        "mean_observations_per_image": result.compute_mean_observations_per_reg_image(),
        "seconds": round(time.time() - started, 1),
    }
    with open(Path(args.out) / "triangulation-stats.json", "w", encoding="utf-8") as handle:
        json.dump(stats, handle, indent=1)
    if args.ply:
        result.export_PLY(args.ply)
    print(json.dumps(stats))
    return 0


def _camera_world_poses(reconstruction: "pycolmap.Reconstruction") -> dict[int, np.ndarray]:
    poses = {}
    for image_id, image in reconstruction.images.items():
        if not image.has_pose:
            continue
        cam_from_world = image.cam_from_world().matrix() if callable(image.cam_from_world) else image.cam_from_world.matrix()
        T = np.eye(4)
        T[:3, :4] = np.asarray(cam_from_world)[:3, :4]
        poses[image_id] = np.linalg.inv(T)
    return poses


def run_refine(args: argparse.Namespace) -> int:
    """Bundle adjustment with the calibration fixed: the pose-file poses move only as far as the pictures demand.

    Every camera carries a soft position prior from the reference (pose-file)
    model, which fixes gauge, scale and frame; the result is still aligned back
    onto the reference by a similarity over projection centres before the
    deltas are measured, so they read as pose-file error, not frame drift.
    """
    import pycolmap

    reconstruction = pycolmap.Reconstruction(args.model)
    reference = pycolmap.Reconstruction(args.reference or args.model)  # the pose-file model: priors and deltas refer to it
    before = _camera_world_poses(reference)
    error_before = reconstruction.compute_mean_reprojection_error()
    options = pycolmap.BundleAdjustmentOptions()
    options.refine_focal_length = False
    options.refine_principal_point = False
    options.refine_extra_params = False
    options.refine_rig_from_world = True
    options.refine_points3D = True
    options.print_summary = False
    options.ceres.solver_options.max_num_iterations = args.iterations
    options.ceres.solver_options.function_tolerance = 1e-6
    config = pycolmap.BundleAdjustmentConfig()
    for image_id in reconstruction.reg_image_ids():
        config.add_image(image_id)
    for camera_id in reconstruction.cameras:
        config.set_constant_cam_intrinsics(camera_id)
    started = time.time()
    if args.prior_sigma_m > 0:
        # every camera keeps a soft tie to its pose-file position: that is the gauge, the metric
        # scale and the frame, and the deltas below say how far the pictures pulled it away
        priors = []
        for image_id, image in reconstruction.images.items():
            if not image.has_pose:
                continue
            prior = pycolmap.PosePrior()
            prior.position = np.asarray(reference.images[image_id].projection_center(), dtype=float)
            prior.position_covariance = np.eye(3) * args.prior_sigma_m**2
            prior.coordinate_system = pycolmap.PosePriorCoordinateSystem.CARTESIAN
            prior.corr_data_id = image.data_id
            priors.append(prior)
        prior_options = pycolmap.PosePriorBundleAdjustmentOptions()
        prior_options.alignment_ransac.max_error = args.align_max_error_m
        summary = pycolmap.create_pose_prior_bundle_adjuster(options, prior_options, config, priors, reconstruction).solve()
    else:
        config.fix_gauge(pycolmap.BundleAdjustmentGauge.TWO_CAMS_FROM_WORLD)
        summary = pycolmap.create_default_bundle_adjuster(options, config, reconstruction).solve()
    similarity = pycolmap.align_reconstructions_via_proj_centers(reconstruction, reference, args.align_max_error_m)
    aligned = similarity is not None
    if aligned:
        reconstruction.transform(similarity)
    reconstruction.update_point_3d_errors()  # stored per-point errors are stale after adjustment
    after = _camera_world_poses(reconstruction)
    common = sorted(set(before) & set(after))
    deltas = pose_delta_stats([before[i] for i in common], [after[i] for i in common])
    errors = np.array([point.error for point in reconstruction.points3D.values()], dtype=float)
    Path(args.out).mkdir(parents=True, exist_ok=True)
    reconstruction.write_text(args.out)
    stats = {
        "termination": str(summary.termination_type),
        "gauge": f"position priors, sigma {args.prior_sigma_m} m" if args.prior_sigma_m > 0 else "two cameras fixed",
        "points3D": reconstruction.num_points3D(),
        "reprojection_error_px": {
            "mean_before": error_before,
            "median_after": float(np.median(errors)) if len(errors) else None,
            "p90_after": float(np.percentile(errors, 90)) if len(errors) else None,
            "over_16px_after": int(np.sum(errors > 16)) if len(errors) else 0,
        },
        "aligned_back_to_input_frame": aligned,
        "similarity_scale": float(similarity.scale) if aligned else None,
        "pose_deltas_vs_pose_file": deltas,
        "seconds": round(time.time() - started, 1),
    }
    with open(Path(args.out) / "refinement-stats.json", "w", encoding="utf-8") as handle:
        json.dump(stats, handle, indent=1)
    if args.ply:
        reconstruction.export_PLY(args.ply)
    print(json.dumps(stats))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    select = sub.add_parser("select", help="pick the instants whose pose lies inside a zone")
    select.add_argument("--index", required=True, help="keyframe index CSV from xbag_extract.py index")
    select.add_argument("--poses", required=True, help="project_data/poses.csv")
    select.add_argument("--zone", nargs=4, type=float, metavar=("XMIN", "XMAX", "YMIN", "YMAX"), required=True)
    select.add_argument("--budget", type=int, default=150)
    select.add_argument("--capture", help="capture path, recorded in the manifest")
    select.add_argument("--out", required=True)
    select.set_defaults(func=run_select)

    extract = sub.add_parser("extract", help="decode the selected frames to JPEG")
    extract.add_argument("--capture", required=True)
    extract.add_argument("--manifest", required=True)
    extract.add_argument("--calibration", required=True, help="T-566 receipt; its kb4 model places the lens circle that tells the two lens types apart")
    extract.add_argument("--images", required=True)
    extract.add_argument("--fov-degrees", type=float, default=200.0)
    extract.add_argument("--quality", type=int, default=95)
    extract.add_argument("--overwrite", action="store_true")
    extract.set_defaults(func=run_extract)

    features = sub.add_parser("features", help="SIFT features into a COLMAP database, one camera per slot")
    features.add_argument("--manifest", required=True)
    features.add_argument("--calibration", required=True)
    features.add_argument("--images", required=True)
    features.add_argument("--db", required=True)
    features.add_argument("--threads", type=int, default=8)
    features.add_argument("--max-image-size", type=int, default=3200)
    features.add_argument("--max-features", type=int, default=8192)
    features.set_defaults(func=run_features)

    pairs = sub.add_parser("pairs", help="pose-guided pair list")
    pairs.add_argument("--manifest", required=True)
    pairs.add_argument("--neighbours", type=int, default=8)
    pairs.add_argument("--radius", type=float, default=3.0)
    pairs.add_argument("--out", required=True)
    pairs.set_defaults(func=run_pairs)

    match = sub.add_parser("match", help="match and verify the listed pairs")
    match.add_argument("--db", required=True)
    match.add_argument("--pairs", required=True)
    match.add_argument("--threads", type=int, default=-1)
    match.add_argument("--block-size", type=int, default=1225)
    match.set_defaults(func=run_match)

    score = sub.add_parser("score", help="rank every hypothesis by epipolar consistency")
    score.add_argument("--manifest", required=True)
    score.add_argument("--calibration", required=True)
    score.add_argument("--db", required=True)
    score.add_argument("--pairs", required=True)
    score.add_argument("--min-inliers", type=int, default=15)
    score.add_argument("--pixel-threshold", type=float, default=4.0)
    score.add_argument("--out", required=True)
    score.set_defaults(func=run_score)

    write = sub.add_parser("write", help="write the COLMAP text model for one hypothesis")
    write.add_argument("--manifest", required=True)
    write.add_argument("--calibration", required=True)
    write.add_argument("--scores", help="scores.csv; the first row wins unless --hypothesis-json is given")
    write.add_argument("--hypothesis-json")
    write.add_argument("--db", help="database whose image ids the model should follow")
    write.add_argument("--out", required=True)
    write.set_defaults(func=run_write)

    triangulate = sub.add_parser("triangulate", help="COLMAP known-pose triangulation as the check")
    triangulate.add_argument("--model", required=True)
    triangulate.add_argument("--db", required=True)
    triangulate.add_argument("--images", required=True)
    triangulate.add_argument("--out", required=True)
    triangulate.add_argument("--min-angle", type=float, default=1.5, help="degrees; minimum triangulation angle")
    triangulate.add_argument("--max-reproj-error", type=float, default=4.0, help="pixels; loosen (e.g. 16) for unrefined pose-file poses")
    triangulate.add_argument("--max-angle-error", type=float, default=2.0, help="degrees; loosen (e.g. 5) for unrefined pose-file poses")
    triangulate.add_argument("--ply")
    triangulate.set_defaults(func=run_triangulate)

    refine = sub.add_parser("refine", help="bundle adjustment with the calibration fixed; reports how far the poses moved")
    refine.add_argument("--model", required=True, help="a triangulated model (sparse/0-triangulated)")
    refine.add_argument("--out", required=True)
    refine.add_argument("--reference", help="the pose-file model (sparse/0); priors and deltas refer to it. Default: --model")
    refine.add_argument("--iterations", type=int, default=50)
    refine.add_argument("--prior-sigma-m", type=float, default=0.1, help="position prior per camera from the pose file; 0 fixes two cameras instead")
    refine.add_argument("--align-max-error-m", type=float, default=0.5)
    refine.add_argument("--ply")
    refine.set_defaults(func=run_refine)

    args = parser.parse_args(argv)
    if getattr(args, "command", None) == "write" and not (args.scores or args.hypothesis_json):
        parser.error("write needs --scores or --hypothesis-json")
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
