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
    return spread_to_budget(inside, budget)


def spread_to_budget(instants: Sequence[ZoneInstant], budget: int) -> list[ZoneInstant]:
    """At most ``budget`` instants, spread evenly over the sequence (first and last always kept)."""
    if budget <= 0:
        raise ValueError("budget must be positive")
    if len(instants) <= budget:
        return list(instants)
    picks = np.unique(np.round(np.linspace(0, len(instants) - 1, budget)).astype(int))
    return [instants[i] for i in picks]


def select_keyframes(instants: Sequence[ZoneInstant], *, min_distance_m: float, min_angle_deg: float) -> list[ZoneInstant]:
    """Motion keyframing: keep an instant once the scanner has moved ``min_distance_m`` or turned ``min_angle_deg`` since the last kept one.

    The pose file's quaternion is read as ``xyzw`` body-to-world (the reading
    the T-571 scoring settled); a wrong reading would only change which
    instants count as a turn, never drop the first instant.
    """
    kept: list[ZoneInstant] = []
    last_position: np.ndarray | None = None
    last_rotation: np.ndarray | None = None
    for instant in instants:
        rotation = quat_xyzw_to_matrix(instant.quat_raw)
        if last_position is None or last_rotation is None:
            keep = True
        else:
            moved = float(np.linalg.norm(instant.position - last_position))
            cosine = np.clip((np.trace(last_rotation.T @ rotation) - 1.0) / 2.0, -1.0, 1.0)
            turned = math.degrees(math.acos(cosine))
            keep = moved >= min_distance_m or turned >= min_angle_deg
        if keep:
            kept.append(instant)
            last_position, last_rotation = instant.position, rotation
    return kept


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


def classes_from_circle_ratios(ratios: Sequence[float], *, strict: bool = True) -> list[str]:
    """Optical class per slot of a co-timed group: the two lowest ratios are the fisheyes.

    ``strict`` also demands a clear split (fisheyes under ``FISHEYE_RATIO_MAX``,
    pinholes at least ``PINHOLE_GAP_FACTOR`` times brighter outside the circle).
    Rank-only mode keeps the fisheye bound but drops the gap: in the hall's
    darkest corners the gap shrinks below 2 (seq 2217: 0.096 vs 0.051) while
    the order never flips; ``check_slot_pattern`` then guards the whole run.
    """
    if len(ratios) != 4:
        raise ValueError(f"a co-timed group has four slots, got {len(ratios)} ratios")
    order = sorted(range(4), key=lambda i: ratios[i])
    fisheyes = set(order[:2])
    darkest_pinhole = min(ratios[i] for i in order[2:])
    brightest_fisheye = max(ratios[i] for i in fisheyes)
    if brightest_fisheye >= FISHEYE_RATIO_MAX or (strict and darkest_pinhole < PINHOLE_GAP_FACTOR * brightest_fisheye):
        raise ValueError(
            f"lens-circle ratios {[round(float(r), 3) for r in ratios]} do not split into two fisheye (< {FISHEYE_RATIO_MAX}) "
            f"and two rectilinear frames{f' at least {PINHOLE_GAP_FACTOR:g}x brighter outside the circle' if strict else ''}"
        )
    return [OpticalClass.FISHEYE.value if i in fisheyes else OpticalClass.RECTILINEAR.value for i in range(4)]


def check_slot_pattern(instants: Sequence[dict]) -> list[str]:
    """The optical-class pattern every instant must share; raises naming the instants that disagree with the majority."""
    from collections import Counter

    patterns = Counter(tuple(slot["optical_class"] for slot in instant["slots"]) for instant in instants)
    majority = list(patterns.most_common(1)[0][0])
    odd = [instant for instant in instants if [slot["optical_class"] for slot in instant["slots"]] != majority]
    if odd:
        described = ", ".join(f"seq {instant['seq']} {[slot['optical_class'][0] for slot in instant['slots']]} ratios {[slot.get('circle_ratio') for slot in instant['slots']]}" for instant in odd[:5])
        raise ValueError(f"{len(odd)} instant(s) order their cameras unlike the majority {[c[0] for c in majority]}: {described}")
    return majority


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
    inside = select_zone_instants(groups, poses, zone, budget=10**9)
    keyframed = select_keyframes(inside, min_distance_m=args.keyframe_distance_m, min_angle_deg=args.keyframe_angle_deg) if args.keyframe_distance_m > 0 or args.keyframe_angle_deg > 0 else inside
    instants = spread_to_budget(keyframed, args.budget)
    complete = sum(1 for g in groups if len(g) == 4)
    write_manifest(
        args.out,
        zone=zone,
        instants=instants,
        sources={"index_csv": str(args.index), "poses_csv": str(args.poses), "capture": str(args.capture) if args.capture else None, "keyframe_distance_m": args.keyframe_distance_m, "keyframe_angle_deg": args.keyframe_angle_deg, "budget": args.budget},
    )
    print(f"{complete} complete instants; {len(inside)} inside {zone}; {len(keyframed)} after keyframing (>= {args.keyframe_distance_m} m or {args.keyframe_angle_deg} deg); {len(instants)} selected (budget {args.budget}) -> {args.out}")
    return 0


def decode_frame(payload: bytes) -> "Image.Image":
    import av  # optional dependency

    with av.open(io.BytesIO(payload), format="h264") as container:
        for frame in container.decode(video=0):
            return frame.to_image()
    raise ValueError("the decoder produced no picture")


_WORKER_BUF: mmap.mmap | None = None


def _extract_worker_init(capture: str) -> None:
    global _WORKER_BUF
    handle = open(capture, "rb")
    _WORKER_BUF = mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ)


def _extract_instant(task: tuple[dict, str, tuple[float, float, float], int, bool]) -> tuple[int, list[float], list[tuple[int, int]], int]:
    """Decode one instant's four frames (in a worker): returns (seq, circle ratios, sizes, frames written)."""
    instant, images_dir, circle, quality, overwrite = task
    assert _WORKER_BUF is not None
    ratios: list[float] = []
    sizes: list[tuple[int, int]] = []
    written = 0
    for slot in instant["slots"]:
        out = Path(images_dir) / slot["image"]
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists() and not overwrite:
            from PIL import Image

            picture = Image.open(out)   # already written by an earlier run: classify from the JPEG instead of decoding again
            picture.load()
        else:
            payload = bytes(_WORKER_BUF[slot["payload_offset"] : slot["payload_offset"] + slot["payload_length"]])
            picture = decode_frame(payload)
            picture.save(out, quality=quality, subsampling=0)
            written += 1
        ratios.append(outside_circle_ratio(np.asarray(picture.convert("L")), circle))
        sizes.append((picture.width, picture.height))
    return instant["seq"], ratios, sizes, written


def run_extract(args: argparse.Namespace) -> int:
    from concurrent.futures import ProcessPoolExecutor

    manifest = read_manifest(args.manifest)
    calibration = load_calibration(args.calibration)
    circle = fisheye_circle(calibration.cameras[FISHEYE_IDS[0]], args.fov_degrees)
    started = time.time()
    written = 0
    tasks = [(instant, str(args.images), circle, args.quality, args.overwrite) for instant in manifest["instants"]]
    by_seq = {instant["seq"]: instant for instant in manifest["instants"]}
    workers = max(1, args.workers)
    with ProcessPoolExecutor(max_workers=workers, initializer=_extract_worker_init, initargs=(str(args.capture),)) as pool:
        for done, (seq, ratios, sizes, count) in enumerate(pool.map(_extract_instant, tasks, chunksize=4), start=1):
            instant = by_seq[seq]
            try:
                classes = classes_from_circle_ratios(ratios, strict=False)
            except ValueError as error:
                raise ValueError(f"seq {seq}: {error}") from error
            for slot, optical, ratio, (width, height) in zip(instant["slots"], classes, ratios, sizes):
                slot["optical_class"] = optical
                slot["circle_ratio"] = round(ratio, 4)
                slot["width"], slot["height"] = width, height
            written += count
            if done % 250 == 0:
                print(f"  {done}/{len(tasks)} instants, {time.time() - started:.0f}s", flush=True)
    pattern = check_slot_pattern(manifest["instants"])
    with open(args.manifest, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=1)
    print(f"{written} frames written under {args.images} in {time.time() - started:.0f}s with {workers} workers; slot pattern {[c[0] for c in pattern]} at every instant; recorded in {args.manifest}")
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


def import_keypoints(db: "pycolmap.Database", image_id: int, keypoints: np.ndarray, *, scale: float) -> int:
    """Store detector keypoints (x, y in the detection image) as COLMAP keypoints in full-resolution pixels; returns the count.

    Detectors index pixel centres at integers; COLMAP puts the first pixel's
    centre at (0.5, 0.5), so half a pixel is added after scaling.
    """
    points = np.asarray(keypoints, dtype=np.float64).reshape(-1, 2) * float(scale) + 0.5
    if len(points) == 0:
        raise ValueError(f"image {image_id}: no keypoints to import")
    db.write_keypoints(image_id, points.astype(np.float32))
    return len(points)


def import_image_matches(db: "pycolmap.Database", image_id1: int, image_id2: int, matches: np.ndarray) -> int:
    """Store raw index matches between two images' stored keypoints; COLMAP's verification builds the geometry later. Returns the count."""
    pairs = np.asarray(matches, dtype=np.int64).reshape(-1, 2)
    if len(pairs) == 0:
        return 0
    n1 = db.num_keypoints_for_image(image_id1)
    n2 = db.num_keypoints_for_image(image_id2)
    if pairs.min() < 0 or pairs[:, 0].max() >= n1 or pairs[:, 1].max() >= n2:
        raise ValueError(f"matches between images {image_id1} and {image_id2} index beyond their {n1} and {n2} keypoints")
    db.write_matches(image_id1, image_id2, pairs.astype(np.uint32))
    return len(pairs)


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
    expected = names_of_lens(manifest, args.only_lens) if args.only_lens else [slot["image"] for instant in manifest["instants"] for slot in instant["slots"]]
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


def pairs_for_matcher(pairs: Sequence[tuple[str, str]], manifest: dict, *, cross_lens: bool) -> list[tuple[str, str]]:
    """Pairs the learned matcher should run: every same-instant pair, and cross-instant pairs of the same lens class unless ``cross_lens``."""
    lens = {slot["image"]: slot["optical_class"] for instant in manifest["instants"] for slot in instant["slots"]}
    instant_of = {slot["image"]: i for i, instant in enumerate(manifest["instants"]) for slot in instant["slots"]}
    kept = []
    for a, b in pairs:
        if cross_lens or instant_of[a] == instant_of[b] or lens[a] == lens[b]:
            kept.append((a, b))
    return kept


def _check_lens(lens: str) -> str:
    if lens not in (OpticalClass.FISHEYE.value, OpticalClass.RECTILINEAR.value):
        raise ValueError(f"unknown lens class {lens!r}")
    return lens


def names_of_lens(manifest: dict, lens: str) -> list[str]:
    """Image names of one lens class, in manifest order."""
    _check_lens(lens)
    return [slot["image"] for instant in manifest["instants"] for slot in instant["slots"] if slot["optical_class"] == lens]


def pairs_of_lens(pairs: Sequence[tuple[str, str]], manifest: dict, lens: str) -> list[tuple[str, str]]:
    """Pairs whose two images are both of one lens class."""
    wanted = set(names_of_lens(manifest, lens))
    return [(a, b) for a, b in pairs if a in wanted and b in wanted]


def shard(items: Sequence, index: int, *, count: int) -> list:
    """Items ``index`` of ``count`` interleaved shards (sizes differ by at most one)."""
    if count < 1 or not 0 <= index < count:
        raise ValueError(f"shard index {index} is not within 0..{count - 1}")
    return [item for k, item in enumerate(items) if k % count == index]


def _load_for_detector(path: str | Path, width: int):
    """RGB tensor (1,3,H,W) in [0,1] resized to ``width`` pixels wide, and the factor back to full resolution."""
    import cv2
    import torch

    image = cv2.imread(str(path))
    if image is None:
        raise ValueError(f"cannot read {path}")
    h, w = image.shape[:2]
    scale = width / w
    resized = cv2.resize(image, (width, int(round(h * scale))), interpolation=cv2.INTER_AREA)
    tensor = torch.from_numpy(cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float().div(255)[None]
    return tensor, 1.0 / scale


def feature_path(features_dir: str | Path, image_name: str) -> Path:
    return Path(features_dir) / (image_name.rsplit(".", 1)[0] + ".npz")


def run_gpu_features(args: argparse.Namespace) -> int:
    """DISK keypoints + descriptors per frame on the GPU, one .npz per image (keypoints in full-resolution pixels). Restartable."""
    import kornia.feature as KF
    import torch

    manifest = read_manifest(args.manifest)
    names = [slot["image"] for instant in manifest["instants"] for slot in instant["slots"]]
    todo = [name for name in names if not feature_path(args.features, name).exists()]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    detector = KF.DISK.from_pretrained("depth").to(device).eval()
    started = time.time()
    with torch.inference_mode():
        for done, name in enumerate(todo, start=1):
            tensor, back = _load_for_detector(Path(args.images) / name, args.width)
            features = detector(tensor.to(device), n=args.max_keypoints, pad_if_not_divisible=True)[0]
            out = feature_path(args.features, name)
            out.parent.mkdir(parents=True, exist_ok=True)
            np.savez(
                out,
                keypoints=(features.keypoints.cpu().numpy() * back).astype(np.float32),
                descriptors=features.descriptors.cpu().numpy().astype(np.float16),
                detect_size=np.array([tensor.shape[-1], tensor.shape[-2]], dtype=np.int32),
            )
            if done % 500 == 0:
                print(f"  {done}/{len(todo)} images, {time.time() - started:.0f}s", flush=True)
    print(f"{len(todo)} images detected ({len(names) - len(todo)} already present) in {time.time() - started:.0f}s -> {args.features}")
    return 0


def run_gpu_match(args: argparse.Namespace) -> int:
    """LightGlue over this shard of the pair list; matches go to part files, imported by ``gpu-import``. Restartable per part."""
    import kornia.feature as KF
    import torch

    manifest = read_manifest(args.manifest)
    with open(args.pairs, encoding="utf-8") as handle:
        all_pairs = [tuple(line.split()) for line in handle if line.strip()]
    planned = pairs_for_matcher(all_pairs, manifest, cross_lens=args.cross_lens)  # type: ignore[arg-type]
    if args.only_lens:
        planned = pairs_of_lens(planned, manifest, args.only_lens)
    pairs = shard(planned, args.shard, count=args.shards)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    matcher = KF.LightGlue("disk").to(device).eval()
    parts_dir = Path(args.matches)
    parts_dir.mkdir(parents=True, exist_ok=True)
    cache: dict[str, tuple] = {}

    def load(name: str):
        if name not in cache:
            if len(cache) > args.cache_images:
                cache.clear()
            data = np.load(feature_path(args.features, name))
            width, height = (int(v) for v in data["detect_size"])
            back = 4000.0 / width if width else 1.0
            keypoints = torch.from_numpy(data["keypoints"] / back).to(device)          # back to detector pixels for LightGlue
            descriptors = torch.from_numpy(data["descriptors"].astype(np.float32)).to(device)
            cache[name] = (keypoints, descriptors, torch.tensor([[width, height]], device=device, dtype=torch.float))
        return cache[name]

    started = time.time()
    part_size = args.part_size
    written = 0
    with torch.inference_mode():
        for start in range(0, len(pairs), part_size):
            part_path = parts_dir / f"shard{args.shard:02d}-part{start // part_size:05d}.npz"
            if part_path.exists():
                continue
            names_a, names_b, matches = [], [], []
            for a, b in pairs[start : start + part_size]:
                ka, da, sa = load(a)
                kb, db_, sb = load(b)
                result = matcher({"image0": {"keypoints": ka[None], "descriptors": da[None], "image_size": sa}, "image1": {"keypoints": kb[None], "descriptors": db_[None], "image_size": sb}})
                index_pairs = result["matches"][0].cpu().numpy().astype(np.uint32)
                names_a.append(a)
                names_b.append(b)
                matches.append(index_pairs)
            np.savez(part_path, names_a=np.array(names_a), names_b=np.array(names_b), matches=np.array(matches, dtype=object), allow_pickle=True)
            written += len(names_a)
            print(f"  shard {args.shard}: {min(start + part_size, len(pairs))}/{len(pairs)} pairs, {time.time() - started:.0f}s", flush=True)
    print(f"shard {args.shard} of {args.shards}: {written} pairs matched in {time.time() - started:.0f}s -> {parts_dir}")
    return 0


def run_gpu_import(args: argparse.Namespace) -> int:
    """Create the database (images, provisional cameras), import keypoints and all part files' matches, then run COLMAP's verification."""
    import pycolmap

    manifest = read_manifest(args.manifest)
    calibration = load_calibration(args.calibration)
    names = [slot["image"] for instant in manifest["instants"] for slot in instant["slots"]]
    with_features = set(names_of_lens(manifest, args.only_lens)) if args.only_lens else set(names)
    provisional = calibration.cameras[PINHOLE_IDS[0]]
    reader = pycolmap.ImageReaderOptions()
    reader.camera_model = provisional.colmap_model
    reader.camera_params = ",".join(_fmt(v) for v in (*provisional.intrinsics, *provisional.distortion))
    pycolmap.Database.open(args.db).close()  # import_images needs the database file to exist
    pycolmap.import_images(args.db, args.images, camera_mode=pycolmap.CameraMode.PER_FOLDER, image_names=names, options=reader)
    started = time.time()
    db = pycolmap.Database.open(args.db)
    try:
        ids = {image.name: image.image_id for image in db.read_all_images()}
        missing = [name for name in names if name not in ids]
        if missing:
            raise RuntimeError(f"{len(missing)} frames were not imported, first {missing[:3]}")
        assign_database_cameras(db, manifest, calibration)
        keypoint_counts = 0
        for name in names:
            if name not in with_features or db.exists_keypoints(ids[name]):
                continue
            data = np.load(feature_path(args.features, name))
            keypoint_counts += import_keypoints(db, ids[name], data["keypoints"], scale=1.0)
        imported = 0
        verify_pairs = set()
        for part in sorted(Path(args.matches).glob("shard*-part*.npz")) if Path(args.matches).exists() else []:
            data = np.load(part, allow_pickle=True)
            for a, b, matches in zip(data["names_a"], data["names_b"], data["matches"]):
                if str(a) not in with_features or str(b) not in with_features:
                    continue
                id_a, id_b = ids[str(a)], ids[str(b)]
                if len(matches) < args.min_matches or db.exists_matches(id_a, id_b):
                    continue
                imported += import_image_matches(db, id_a, id_b, np.asarray(matches))
                verify_pairs.add((str(a), str(b)))
    finally:
        db.close()
    if verify_pairs:
        verify_list = Path(args.db).with_suffix(".verify-pairs.txt")
        with open(verify_list, "w", encoding="utf-8", newline="\n") as handle:
            for a, b in sorted(verify_pairs):
                handle.write(f"{a} {b}\n")
        options = pycolmap.TwoViewGeometryOptions()
        options.ransac.max_error = args.max_error
        options.min_num_inliers = args.min_inliers
        pycolmap.verify_matches(args.db, verify_list, options)
    db = pycolmap.Database.open(args.db)
    try:
        print(f"{db.num_images()} images, {keypoint_counts} keypoints imported, {imported} matches over {len(verify_pairs)} pairs, {db.num_verified_image_pairs()} verified, in {time.time() - started:.0f}s -> {args.db}")
    finally:
        db.close()
    return 0


def run_pairs_lens(args: argparse.Namespace) -> int:
    """The pairs of one lens class, for a matcher that handles only that lens (COLMAP SIFT for the fisheyes)."""
    manifest = read_manifest(args.manifest)
    with open(args.pairs, encoding="utf-8") as handle:
        pairs = [tuple(line.split()) for line in handle if line.strip()]
    kept = pairs_of_lens(pairs, manifest, args.lens)  # type: ignore[arg-type]
    with open(args.out, "w", encoding="utf-8", newline="\n") as handle:
        for a, b in kept:
            handle.write(f"{a} {b}\n")
    print(f"{len(kept)} {args.lens} pairs of {len(pairs)} -> {args.out}")
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


# --------------------------------------------------------------------------- trainer package (T-502 contract: PINHOLE cameras)


class VirtualView(NamedTuple):
    suffix: str
    R_view_from_camera: np.ndarray  # rotation taking fisheye-camera coordinates to the virtual pinhole's coordinates
    focal: float
    width: int
    height: int

    @property
    def K(self) -> np.ndarray:
        return np.array([[self.focal, 0.0, self.width / 2.0], [0.0, self.focal, self.height / 2.0], [0.0, 0.0, 1.0]])


def _rotation_about(axis: np.ndarray, degrees: float) -> np.ndarray:
    axis = np.asarray(axis, dtype=float) / np.linalg.norm(axis)
    angle = math.radians(degrees)
    K = _skew(axis)
    return np.eye(3) + math.sin(angle) * K + (1 - math.cos(angle)) * (K @ K)


def fisheye_virtual_views(*, size: int, fov_deg: float, tilt_deg: float) -> list[VirtualView]:
    """Five square pinhole views that cover a sideways 200-degree fisheye: centre, up, down, fore, aft.

    Each view is ``fov_deg`` wide; the four tilted views turn the optical axis
    by ``tilt_deg`` towards -y (up), +y (down), +x (fore) and -x (aft) of the
    fisheye's OpenCV frame. ``R_view_from_camera`` maps fisheye rays into the
    view's frame, so a view's optical axis in fisheye coordinates is its
    transpose applied to (0, 0, 1).
    """
    focal = size / (2.0 * math.tan(math.radians(fov_deg) / 2.0))
    # rotating the camera frame by +tilt about +x turns the z axis towards -y (up in OpenCV axes)
    plan = [("c", np.eye(3)), ("u", _rotation_about([1, 0, 0], tilt_deg)), ("d", _rotation_about([1, 0, 0], -tilt_deg)), ("f", _rotation_about([0, 1, 0], -tilt_deg)), ("a", _rotation_about([0, 1, 0], tilt_deg))]
    return [VirtualView(suffix, R.T, focal, size, size) for suffix, R in plan]


class PinholeCamera(NamedTuple):
    colmap_model: str
    width: int
    height: int
    params: tuple[float, float, float, float]  # fx fy cx cy

    @property
    def K(self) -> np.ndarray:
        fx, fy, cx, cy = self.params
        return np.array([[fx, 0.0, cx], [0.0, fy, cy], [0.0, 0.0, 1.0]])


def rectified_pinhole(camera: CalibratedCamera) -> PinholeCamera:
    """The PINHOLE camera of an OPENCV frame undistorted at the same size with no cropping (OpenCV's alpha = 0 new matrix)."""
    import cv2

    if camera.is_fisheye:
        raise ValueError("rectified_pinhole is for the OPENCV pinhole cameras; fisheyes become virtual views")
    K = camera.K if hasattr(camera, "K") else np.array([[camera.intrinsics[0], 0, camera.intrinsics[2]], [0, camera.intrinsics[1], camera.intrinsics[3]], [0, 0, 1]], dtype=float)
    new_K, _ = cv2.getOptimalNewCameraMatrix(K, np.array(camera.distortion[:4], dtype=float), (camera.width, camera.height), 0, (camera.width, camera.height))
    return PinholeCamera("PINHOLE", camera.width, camera.height, (float(new_K[0, 0]), float(new_K[1, 1]), float(new_K[0, 2]), float(new_K[1, 2])))


def splits_from_names(names: Sequence[str], *, test_every: int) -> dict[str, list[str]]:
    """gsplat's hold-out rule: every ``test_every``-th image of the name-sorted list is held out."""
    ordered = sorted(names)
    heldout = [name for index, name in enumerate(ordered) if index % test_every == 0]
    train = [name for index, name in enumerate(ordered) if index % test_every != 0]
    return {"train": train, "heldout": heldout}


def depth_samples(points_world: np.ndarray, T_world_cam: np.ndarray, K: np.ndarray, *, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """Project world points into a pinhole view: (uv float32 in pixels, depth_m float32) for the points in front and inside the frame."""
    points = np.asarray(points_world, dtype=float).reshape(-1, 3)
    if len(points) == 0:
        return np.zeros((0, 2), np.float32), np.zeros(0, np.float32)
    T_cam_world = np.linalg.inv(np.asarray(T_world_cam, dtype=float))
    cam = (T_cam_world[:3, :3] @ points.T).T + T_cam_world[:3, 3]
    depth = cam[:, 2]
    ahead = depth > 1e-6
    uv = np.full((len(points), 2), np.nan)
    uv[ahead] = (K[:2, :2] @ (cam[ahead, :2] / depth[ahead, None]).T).T + K[:2, 2]
    inside = ahead & (uv[:, 0] >= 0) & (uv[:, 0] < width) & (uv[:, 1] >= 0) & (uv[:, 1] < height)
    return uv[inside].astype(np.float32), depth[inside].astype(np.float32)


def sharpness(gray: np.ndarray, *, width: int = 1000) -> float:
    """Variance of the Laplacian on a ``width``-pixel-wide copy: a blur gate for the trainer package (higher is sharper).

    Measured on a reduced copy so a 12 MP frame costs a few megabytes rather
    than a 96 MB float64 buffer per worker.
    """
    import cv2

    array = np.asarray(gray, dtype=np.uint8)
    h, w = array.shape[:2]
    if w > width:
        array = cv2.resize(array, (width, max(1, int(round(h * width / w)))), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(array, cv2.CV_32F).var())


def _fisheye_view_maps(camera: CalibratedCamera, view: VirtualView) -> tuple[np.ndarray, np.ndarray]:
    """cv2.remap maps that render one virtual pinhole view out of a kb4 fisheye frame (exact forward model)."""
    import cv2

    fx, fy, cx, cy = camera.intrinsics
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=float)
    D = np.array(camera.distortion[:4], dtype=float)
    # R maps view rays into fisheye-camera rays: view -> camera = R_view_from_camera^T
    R = view.R_view_from_camera.T
    map1, map2 = cv2.fisheye.initUndistortRectifyMap(K, D, R.T, view.K, (view.width, view.height), cv2.CV_32FC1)
    return map1, map2


_PACKAGE_CTX: dict = {}


def _package_worker_init(context: dict) -> None:
    global _PACKAGE_CTX
    _PACKAGE_CTX = context


def _package_image(task: tuple) -> dict:
    """Render one source frame into its package images (full + half) in a worker; returns per-output records."""
    import cv2

    name, kind, source, outputs = task   # outputs: list of (relative name, map1, map2 | None, size)
    ctx = _PACKAGE_CTX
    image = cv2.imread(str(source))
    if image is None:
        raise ValueError(f"cannot read {source}")
    records = []
    for rel_name, maps, size in outputs:
        if maps is None:
            rendered = image
        else:
            rendered = cv2.remap(image, maps[0], maps[1], interpolation=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT)
        if kind == "fisheye" and ctx.get("mask") is not None and maps is not None:
            mask = cv2.remap(ctx["mask"], maps[0], maps[1], interpolation=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT)
            rendered = rendered.copy()
            rendered[mask > 0] = 0
        full = Path(ctx["dataset"]) / "images" / rel_name
        half = (Path(ctx["dataset"]) / "images_2" / rel_name).with_suffix(".png")   # the trainer contract refuses a JPEG runtime folder
        full.parent.mkdir(parents=True, exist_ok=True)
        half.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(full), rendered, [cv2.IMWRITE_JPEG_QUALITY, ctx["quality"]])
        h, w = rendered.shape[:2]
        cv2.imwrite(str(half), cv2.resize(rendered, (w // 2, h // 2), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_PNG_COMPRESSION, 1])
        gray = cv2.cvtColor(rendered, cv2.COLOR_BGR2GRAY)
        records.append({"name": rel_name, "source": name, "width": w, "height": h, "sharpness": sharpness(gray)})
    return {"source": name, "outputs": records}


def run_package(args: argparse.Namespace) -> int:
    """Build the T-502 trainer package from the refined model: PINHOLE cameras only.

    Pinhole frames are undistorted at full size; each fisheye frame becomes
    five virtual pinhole views (centre, up, down, fore, aft) rendered through
    the exact kb4 model, with the static operator mask blacked out. Every
    output gets a full-size and an exact half-size copy, a sharpness score, a
    pose derived from the refined model, and sparse depth samples from the
    refined points. Layout: ``dataset/{images,images_2,sparse/0/*.bin,splits.json}``,
    ``depths/*.npz`` (training images only), ``colmap_input.json``,
    ``package-receipt.json``.
    """
    import cv2
    import pycolmap
    from concurrent.futures import ProcessPoolExecutor

    manifest = read_manifest(args.manifest)
    calibration = load_calibration(args.calibration)
    with open(Path(args.hypothesis_model) / "hypothesis.json", encoding="utf-8") as handle:
        slot_assignment = json.load(handle)["slot_assignment"]
    refined = pycolmap.Reconstruction(args.model)
    refined_by_name = {image.name: image for image in refined.images.values()}
    point_index = {point_id: index for index, point_id in enumerate(sorted(refined.points3D))}
    points_xyz = np.array([refined.points3D[point_id].xyz for point_id in sorted(refined.points3D)]) if refined.num_points3D() else np.zeros((0, 3))
    points_rgb = np.array([refined.points3D[point_id].color for point_id in sorted(refined.points3D)], dtype=np.uint8) if refined.num_points3D() else np.zeros((0, 3), np.uint8)
    # the refined model's REAL tracks: which points each source frame observed (frustum visibility ignores occlusion)
    observed: dict[str, np.ndarray] = {}
    for name, image in refined_by_name.items():
        ids = [point2D.point3D_id for point2D in image.points2D if point2D.has_point3D()]
        observed[name] = np.array([point_index[point_id] for point_id in ids], dtype=int)
    views = fisheye_virtual_views(size=args.view_size, fov_deg=args.view_fov_deg, tilt_deg=args.view_tilt_deg)
    # the down view is tilted less so it stops short of the operator at the bottom rim
    views = [view._replace(R_view_from_camera=_rotation_about([1, 0, 0], -args.down_tilt_deg).T) if view.suffix == "d" else view for view in views]

    # cameras of the package: one undistorted PINHOLE per physical pinhole camera, one shared PINHOLE for the virtual views
    package_cameras: dict[str, PinholeCamera] = {}
    maps_by_source: dict[str, list] = {}
    for folder, camera_id in slot_assignment.items():
        camera = calibration.cameras[camera_id]
        if camera.is_fisheye:
            for view in views:
                key = f"view-{view.suffix}"
                package_cameras.setdefault(key, PinholeCamera("PINHOLE", view.width, view.height, (view.focal, view.focal, view.width / 2.0, view.height / 2.0)))
            maps_by_source[folder] = [(view.suffix, _fisheye_view_maps(camera, view), (view.width, view.height)) for view in views]
        else:
            new_camera = rectified_pinhole(camera)
            package_cameras[camera_id] = new_camera
            K = np.array([[camera.intrinsics[0], 0, camera.intrinsics[2]], [0, camera.intrinsics[1], camera.intrinsics[3]], [0, 0, 1]], dtype=float)
            map1, map2 = cv2.initUndistortRectifyMap(K, np.array(camera.distortion[:4], dtype=float), None, new_camera.K, (camera.width, camera.height), cv2.CV_32FC1)
            maps_by_source[folder] = [(None, (map1, map2), (camera.width, camera.height))]

    masks = {}
    if args.operator_masks:
        for folder, camera_id in slot_assignment.items():
            if calibration.cameras[camera_id].is_fisheye:
                mask_path = Path(args.operator_masks) / f"operator-mask-{folder}.png"
                if mask_path.exists():
                    masks[folder] = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)

    dataset = Path(args.out) / "dataset"
    dataset.mkdir(parents=True, exist_ok=True)
    tasks = []
    poses: dict[str, tuple[str, np.ndarray]] = {}   # package image name -> (package camera key, T_world_view)
    source_of: dict[str, str] = {}                  # package image name -> source frame name
    for instant in manifest["instants"]:
        for slot in instant["slots"]:
            name = slot["image"]
            if name not in refined_by_name:
                continue
            folder = name.split("/")[0]
            camera_id = slot_assignment[folder]
            camera = calibration.cameras[camera_id]
            image = refined_by_name[name]
            cam_from_world = np.eye(4)
            cam_from_world[:3, :4] = np.asarray(image.cam_from_world().matrix() if callable(image.cam_from_world) else image.cam_from_world.matrix())[:3, :4]
            T_world_cam = np.linalg.inv(cam_from_world)
            stem = f"inst{instant['seq']:05d}"
            outputs = []
            for suffix, maps, size in maps_by_source[folder]:
                if suffix is None:
                    rel = f"{stem}_{camera_id}.jpg"
                    poses[rel] = (camera_id, T_world_cam)
                else:
                    rel = f"{stem}_{camera_id}_{suffix}.jpg"
                    view = next(v for v in views if v.suffix == suffix)
                    T_world_view = T_world_cam.copy()
                    T_world_view[:3, :3] = T_world_cam[:3, :3] @ view.R_view_from_camera.T
                    poses[rel] = (f"view-{suffix}", T_world_view)
                source_of[rel] = name
                outputs.append((rel, maps, size))
            tasks.append((name, "fisheye" if camera.is_fisheye else "pinhole", str(Path(args.images) / name), outputs))

    started = time.time()
    records: dict[str, dict] = {}
    context_by_kind = {"dataset": str(dataset), "quality": args.quality}
    # one worker pool per fisheye folder mask is overkill: the mask is looked up by folder inside the worker context
    with ProcessPoolExecutor(max_workers=max(1, args.workers), initializer=_package_worker_init, initargs=({**context_by_kind, "mask": None},)) as pool:
        pinhole_tasks = [t for t in tasks if t[1] == "pinhole"]
        for done, result in enumerate(pool.map(_package_image, pinhole_tasks, chunksize=2), start=1):
            for record in result["outputs"]:
                records[record["name"]] = record
            if done % 500 == 0:
                print(f"  pinholes {done}/{len(pinhole_tasks)}, {time.time() - started:.0f}s", flush=True)
    for folder, mask in ({f: masks.get(f) for f in maps_by_source if any(calibration.cameras[slot_assignment[f]].is_fisheye for _ in [0])}).items():
        folder_tasks = [t for t in tasks if t[1] == "fisheye" and t[0].startswith(folder + "/")]
        with ProcessPoolExecutor(max_workers=max(1, args.workers), initializer=_package_worker_init, initargs=({**context_by_kind, "mask": mask},)) as pool:
            for done, result in enumerate(pool.map(_package_image, folder_tasks, chunksize=2), start=1):
                for record in result["outputs"]:
                    records[record["name"]] = record
                if done % 500 == 0:
                    print(f"  {folder} views {done}/{len(folder_tasks)}, {time.time() - started:.0f}s", flush=True)

    # blur gate: drop outputs below a fraction of their camera's median sharpness
    by_camera: dict[str, list[float]] = {}
    for rel, record in records.items():
        by_camera.setdefault(poses[rel][0], []).append(record["sharpness"])
    threshold = {key: args.blur_fraction * float(np.median(values)) for key, values in by_camera.items()}
    sharp = sorted(rel for rel, record in records.items() if record["sharpness"] >= threshold[poses[rel][0]])
    dropped = sorted(set(records) - set(sharp))
    # sparse support per view from the source frame's real observations; a view with too few is dropped
    samples: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
    unsupported = []
    for rel in sharp:
        key, T_world_view = poses[rel]
        camera = package_cameras[key]
        tracked = observed[source_of[rel]]
        uv, depth = depth_samples(points_xyz[tracked], T_world_view, camera.K, width=camera.width, height=camera.height)
        visible = tracked[_visible_point_indices(points_xyz[tracked], T_world_view, camera.K, camera.width, camera.height)]
        if len(uv) < args.min_depth_samples:
            unsupported.append(rel)
            continue
        samples[rel] = (uv, depth, visible)
    kept = sorted(samples)
    for rel in dropped + unsupported:
        (dataset / "images" / rel).unlink(missing_ok=True)
        (dataset / "images_2" / rel).with_suffix(".png").unlink(missing_ok=True)

    # the COLMAP model of the package, written by pycolmap for consistency
    model = pycolmap.Reconstruction()
    camera_ids: dict[str, int] = {}
    for index, (key, camera) in enumerate(sorted(package_cameras.items()), start=1):
        model.add_camera_with_trivial_rig(pycolmap.Camera(model="PINHOLE", width=camera.width, height=camera.height, params=list(camera.params), camera_id=index))
        camera_ids[key] = index
    point_ids: dict[int, int] = {}
    for index, xyz in enumerate(points_xyz):
        point_ids[index] = model.add_point3D(xyz, pycolmap.Track(), points_rgb[index])
    splits = splits_from_names(kept, test_every=args.test_every)
    heldout = set(splits["heldout"])
    depths_dir = Path(args.out) / "depths"
    depths_dir.mkdir(parents=True, exist_ok=True)
    observation_count = 0
    for image_id, rel in enumerate(kept, start=1):
        key, T_world_view = poses[rel]
        camera = package_cameras[key]
        cam_from_world = np.linalg.inv(T_world_view)
        uv, depth, visible = samples[rel]
        image = pycolmap.Image(name=rel, keypoints=uv.astype(np.float64).reshape(-1, 2), camera_id=camera_ids[key], image_id=image_id)
        model.add_image_with_trivial_frame(image)
        frame = model.frame(model.image(image_id).frame_id)
        frame.rig_from_world = pycolmap.Rigid3d(np.ascontiguousarray(cam_from_world[:3, :4]))
        model.register_frame(frame.frame_id)
        for k in range(len(visible)):
            model.add_observation(point_ids[int(visible[k])], pycolmap.TrackElement(image_id, k))
            observation_count += 1
        if rel not in heldout and len(uv):
            np.savez(depths_dir / (Path(rel).stem + ".npz"), uv=uv.astype(np.float32), depth_m=depth.astype(np.float32), width=np.int32(camera.width), height=np.int32(camera.height))
    sparse_dir = dataset / "sparse" / "0"
    sparse_dir.mkdir(parents=True, exist_ok=True)
    orphaned = [point_id for point_id, point in model.points3D.items() if point.track.length() == 0]
    for point_id in orphaned:           # observed only outside every rendered view: the contract refuses empty tracks
        model.delete_point3D(point_id)
    model.update_point_3d_errors()   # points were added without an error; the contract refuses the -1 default
    model.write_binary(sparse_dir)
    with open(dataset / "splits.json", "w", encoding="utf-8") as handle:
        json.dump(splits, handle, indent=1)
    bbox = points_xyz.min(axis=0).tolist() if len(points_xyz) else None, points_xyz.max(axis=0).tolist() if len(points_xyz) else None
    summary = {
        "n_cameras": model.num_cameras(), "n_images": model.num_images(), "n_points3D": model.num_points3D(), "n_observations": observation_count,
        "image_sizes": sorted({(c.width, c.height) for c in package_cameras.values()}), "points_bbox_min": bbox[0], "points_bbox_max": bbox[1],
        "frame": "the LCC2 export's SLAM frame (poses.csv); train with normalize_world_space False",
    }
    with open(Path(args.out) / "colmap_input.json", "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=1)
    receipt = {
        "schema": "xbag-colmap-trainer-package/1", "source_model": str(args.model), "slot_assignment": slot_assignment,
        "virtual_views": [{"suffix": v.suffix, "fov_deg": args.view_fov_deg, "size": v.width} for v in views], "down_tilt_deg": args.down_tilt_deg, "view_tilt_deg": args.view_tilt_deg,
        "operator_masks": sorted(masks), "blur_fraction_of_median": args.blur_fraction, "sharpness_threshold_by_camera": threshold,
        "images_kept": len(kept), "images_dropped_for_blur": len(dropped), "images_dropped_for_no_sparse_support": len(unsupported), "min_depth_samples": args.min_depth_samples, "dropped": (dropped + unsupported)[:50], "test_every": args.test_every, "heldout": len(heldout),
        "depth_priors": "sparse points of the refined model projected into each training view (uv, depth_m); none for held-out images",
        "seconds": round(time.time() - started, 1), **summary,
    }
    with open(Path(args.out) / "package-receipt.json", "w", encoding="utf-8") as handle:
        json.dump(receipt, handle, indent=1)
    print(json.dumps({k: receipt[k] for k in ("images_kept", "images_dropped_for_blur", "n_cameras", "n_points3D", "n_observations", "heldout", "seconds")}))
    return 0


def _visible_point_indices(points_world: np.ndarray, T_world_cam: np.ndarray, K: np.ndarray, width: int, height: int) -> np.ndarray:
    """Indices of the points that ``depth_samples`` keeps, in the same order."""
    if len(points_world) == 0:
        return np.zeros(0, dtype=int)
    T_cam_world = np.linalg.inv(T_world_cam)
    cam = (T_cam_world[:3, :3] @ np.asarray(points_world, dtype=float).T).T + T_cam_world[:3, 3]
    depth = cam[:, 2]
    ahead = depth > 1e-6
    uv = np.full((len(points_world), 2), np.nan)
    uv[ahead] = (K[:2, :2] @ (cam[ahead, :2] / depth[ahead, None]).T).T + K[:2, 2]
    inside = ahead & (uv[:, 0] >= 0) & (uv[:, 0] < width) & (uv[:, 1] >= 0) & (uv[:, 1] < height)
    return np.nonzero(inside)[0]


def rig_config_entries(calibration: Calibration, slot_assignment: dict[str, str]) -> list[dict]:
    """COLMAP rig-config camera entries for the four-camera rig: the camera_0 slot is the reference sensor.

    ``slot_assignment`` maps a slot folder (``slot0``) to a calibration id. COLMAP
    wants ``cam_from_rig``; the receipt gives each camera's pose IN camera_0's
    frame (camera -> camera_0), so cam_from_rig is its inverse. Rotations are
    written w x y z as ``read_rig_config`` expects.
    """
    entries = []
    for folder, camera_id in sorted(slot_assignment.items(), key=lambda item: (item[1] != FISHEYE_IDS[0], item[0])):
        camera = calibration.cameras[camera_id]
        entry: dict = {
            "image_prefix": f"{folder}/",
            "ref_sensor": camera_id == FISHEYE_IDS[0],
            "camera_model_name": camera.colmap_model,
            "camera_params": [float(v) for v in (*camera.intrinsics, *camera.distortion)],
        }
        if not entry["ref_sensor"]:
            cam_from_rig = np.linalg.inv(camera.pose)
            qw, qx, qy, qz = matrix_to_quat_wxyz(cam_from_rig[:3, :3])
            entry["cam_from_rig_rotation"] = [qw, qx, qy, qz]
            entry["cam_from_rig_translation"] = [float(v) for v in cam_from_rig[:3, 3]]
        entries.append(entry)
    if not entries or not entries[0]["ref_sensor"]:
        raise ValueError(f"no slot is assigned {FISHEYE_IDS[0]}, the rig's reference sensor: {slot_assignment}")
    return entries


def run_rig(args: argparse.Namespace) -> int:
    """Declare the four cameras as one rig in the database and the model (frames = instants), so refinement moves one pose per instant."""
    import pycolmap

    manifest = read_manifest(args.manifest)
    calibration = load_calibration(args.calibration)
    with open(Path(args.model) / "hypothesis.json", encoding="utf-8") as handle:
        slot_assignment = json.load(handle)["slot_assignment"]
    entries = rig_config_entries(calibration, slot_assignment)
    config_path = Path(args.out) / "rig-config.json"
    Path(args.out).mkdir(parents=True, exist_ok=True)
    with open(config_path, "w", encoding="utf-8") as handle:
        json.dump([{"cameras": entries}], handle, indent=1)
    configs = pycolmap.read_rig_config(config_path)
    reconstruction = pycolmap.Reconstruction(args.model)
    db = pycolmap.Database.open(args.db)
    try:
        pycolmap.apply_rig_config(configs, db, reconstruction)
        rigs, frames = db.num_rigs(), db.num_frames()
    finally:
        db.close()
    reconstruction.write_text(args.out)
    print(f"rig applied: {rigs} rig(s), {frames} frames in the database; model {reconstruction.num_rigs()} rig(s), {reconstruction.num_frames()} frames, {reconstruction.num_images()} images -> {args.out}")
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
    options.refine_sensor_from_rig = False   # the receipt's camera-to-camera_0 offsets stay fixed when the model carries a rig
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
        # with a rig, a frame has one pose: the prior belongs to the reference sensor's image only
        ref_sensor_ids = {rig.ref_sensor_id.id for rig in reconstruction.rigs.values() if rig.num_sensors() > 1}
        for image_id, image in reconstruction.images.items():
            if not image.has_pose:
                continue
            if ref_sensor_ids and image.camera_id not in ref_sensor_ids:
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
    select.add_argument("--keyframe-distance-m", type=float, default=0.0, help="motion keyframing: keep an instant after this much travel (0 = off)")
    select.add_argument("--keyframe-angle-deg", type=float, default=0.0, help="motion keyframing: keep an instant after this much turning (0 = off)")
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
    extract.add_argument("--workers", type=int, default=1, help="decoder processes; each maps the capture read-only")
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
    features.add_argument("--only-lens", choices=["fisheye", "rectilinear"], help="extract only this lens class (the hybrid path: SIFT for fisheyes, GPU features for pinholes)")
    features.set_defaults(func=run_features)

    pairs_lens = sub.add_parser("pairs-lens", help="filter a pair list to one lens class")
    pairs_lens.add_argument("--manifest", required=True)
    pairs_lens.add_argument("--pairs", required=True)
    pairs_lens.add_argument("--lens", choices=["fisheye", "rectilinear"], required=True)
    pairs_lens.add_argument("--out", required=True)
    pairs_lens.set_defaults(func=run_pairs_lens)

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

    gpu_features = sub.add_parser("gpu-features", help="DISK keypoints per frame on the GPU (kornia), one .npz per image")
    gpu_features.add_argument("--manifest", required=True)
    gpu_features.add_argument("--images", required=True)
    gpu_features.add_argument("--features", required=True, help="output directory of per-image .npz files")
    gpu_features.add_argument("--width", type=int, default=1600, help="detection width in pixels")
    gpu_features.add_argument("--max-keypoints", type=int, default=4096)
    gpu_features.set_defaults(func=run_gpu_features)

    gpu_match = sub.add_parser("gpu-match", help="LightGlue over one shard of the pair list (kornia), to part files")
    gpu_match.add_argument("--manifest", required=True)
    gpu_match.add_argument("--pairs", required=True)
    gpu_match.add_argument("--features", required=True)
    gpu_match.add_argument("--matches", required=True, help="output directory of part files")
    gpu_match.add_argument("--shard", type=int, default=0)
    gpu_match.add_argument("--shards", type=int, default=1)
    gpu_match.add_argument("--part-size", type=int, default=2000)
    gpu_match.add_argument("--cache-images", type=int, default=3000, help="feature files held on the GPU before the cache is cleared")
    gpu_match.add_argument("--cross-lens", action="store_true", help="also match fisheye-to-pinhole pairs across instants")
    gpu_match.add_argument("--only-lens", choices=["fisheye", "rectilinear"], help="match only pairs of this lens class")
    gpu_match.set_defaults(func=run_gpu_match)

    gpu_import = sub.add_parser("gpu-import", help="build the database from the GPU features and matches, then verify with COLMAP")
    gpu_import.add_argument("--manifest", required=True)
    gpu_import.add_argument("--calibration", required=True)
    gpu_import.add_argument("--images", required=True)
    gpu_import.add_argument("--features", required=True)
    gpu_import.add_argument("--matches", required=True)
    gpu_import.add_argument("--db", required=True)
    gpu_import.add_argument("--min-matches", type=int, default=15)
    gpu_import.add_argument("--max-error", type=float, default=4.0, help="pixels; RANSAC threshold of the verification")
    gpu_import.add_argument("--min-inliers", type=int, default=15)
    gpu_import.add_argument("--only-lens", choices=["fisheye", "rectilinear"], help="import keypoints and matches only for this lens class")
    gpu_import.set_defaults(func=run_gpu_import)

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

    rig = sub.add_parser("rig", help="declare the four cameras as one rig (frames = instants) in the database and a copy of the model")
    rig.add_argument("--manifest", required=True)
    rig.add_argument("--calibration", required=True)
    rig.add_argument("--model", required=True, help="sparse/0 written by `write` (its hypothesis.json gives the slot assignment)")
    rig.add_argument("--db", required=True)
    rig.add_argument("--out", required=True)
    rig.set_defaults(func=run_rig)

    package = sub.add_parser("package", help="the T-502 trainer package (PINHOLE only) from the refined model")
    package.add_argument("--manifest", required=True)
    package.add_argument("--calibration", required=True)
    package.add_argument("--images", required=True, help="source frames (slot folders)")
    package.add_argument("--model", required=True, help="the refined model (sparse/4-final)")
    package.add_argument("--hypothesis-model", required=True, help="the model directory holding hypothesis.json (sparse/0)")
    package.add_argument("--operator-masks", help="directory with operator-mask-slot{k}.png for the fisheye slots")
    package.add_argument("--out", required=True)
    package.add_argument("--view-size", type=int, default=1400)
    package.add_argument("--view-fov-deg", type=float, default=90.0)
    package.add_argument("--view-tilt-deg", type=float, default=50.0)
    package.add_argument("--down-tilt-deg", type=float, default=35.0)
    package.add_argument("--blur-fraction", type=float, default=0.35, help="drop images below this fraction of their camera's median Laplacian variance")
    package.add_argument("--min-depth-samples", type=int, default=10, help="drop views with fewer projected sparse observations than this")
    package.add_argument("--test-every", type=int, default=8)
    package.add_argument("--quality", type=int, default=95)
    package.add_argument("--workers", type=int, default=6)
    package.set_defaults(func=run_package)

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
