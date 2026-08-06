"""Generate sparse per-image UV+depth .npz priors from an E57 LiDAR cloud.

Pipeline:
  1. Load every E57 scan station and concatenate into a single Nx3
     array in the E57 global frame (pye57).
  2. Voxel-downsample to ~1cm for ICP tractability.
  3. Estimate an E57 → COLMAP rigid transform via centroid alignment
     (initial guess) + open3d point-to-point ICP (refinement).
     Default ICP: max_correspondence_distance=0.5m, fitness >= 0.3.
  4. Read the exact train/held-out split beside the COLMAP images directory.
     For each training camera only, project the full-resolution E57 cloud
     into the camera frame, z-buffer to keep the nearest point per
     pixel, optionally erode edges, subsample to max_samples_per_image.
  5. Save uv (M×2 float32), depth_m (M float32), width/height (int32)
     to <out>/<image_stem>.npz per training image, plus
     _priors_summary.json with the transform + per-image sample counts.

CRITICAL: uses pycolmap.SceneManager from the rmbrualla fork
(commit cc7ea4b73). Upstream pycolmap REMOVED SceneManager and the
gsplat example trainers depend on it. Non-negotiable per D-016.

No real Reception Room E57/Open3D/RunPod end-to-end run or timing benchmark
has been recorded. Per-image projection is parallelized with
ProcessPoolExecutor, but its venue-scale duration remains unverified.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path, PurePosixPath

import numpy as np


_MAX_SPLITS_BYTES = 1024 * 1024


# ============================================================================
# E57 loading
# ============================================================================

def load_e57(path: str) -> np.ndarray:
    """Concatenate every scan station into one Nx3 array in E57 global frame.

    pye57 0.4.16 applies the station pose inside ``read_scan`` when
    ``transform=True``.  Applying ``ScanHeader.rotation_matrix`` and
    ``ScanHeader.translation`` again would move every posed station twice.
    """
    import pye57

    pts: list[np.ndarray] = []
    with pye57.E57(path, mode="r") as e57:
        for scan_index in range(e57.scan_count):
            scan = e57.read_scan(
                scan_index,
                intensity=False,
                colors=False,
                row_column=False,
                transform=True,
                ignore_missing_fields=True,
            )
            try:
                x = np.asarray(scan["cartesianX"], dtype=np.float64)
                y = np.asarray(scan["cartesianY"], dtype=np.float64)
                z = np.asarray(scan["cartesianZ"], dtype=np.float64)
            except KeyError as error:
                raise RuntimeError(
                    f"E57 scan {scan_index} did not yield global Cartesian coordinates"
                ) from error

            if x.ndim != 1 or y.ndim != 1 or z.ndim != 1:
                raise RuntimeError(
                    f"E57 scan {scan_index} Cartesian fields must be one-dimensional"
                )
            if not (x.size == y.size == z.size):
                raise RuntimeError(
                    f"E57 scan {scan_index} Cartesian fields have different lengths"
                )
            global_points = np.column_stack([x, y, z])
            if global_points.size and not np.isfinite(global_points).all():
                raise RuntimeError(f"E57 scan {scan_index} contains non-finite points")
            if global_points.size:
                pts.append(global_points)

    if not pts:
        raise RuntimeError(f"E57 file has no usable points: {path}")
    return np.concatenate(pts, axis=0).astype(np.float32)


def voxel_downsample(points: np.ndarray, voxel_m: float) -> np.ndarray:
    """Coarse voxel downsample by integer-bucketing coordinates."""
    if not np.isfinite(voxel_m) or voxel_m <= 0:
        raise ValueError("voxel_m must be finite and greater than zero")
    keys = np.floor(points / voxel_m).astype(np.int64)
    _, idx = np.unique(keys, axis=0, return_index=True)
    return points[idx]


# ============================================================================
# ICP alignment to COLMAP
# ============================================================================

def estimate_transform(
    e57_pts: np.ndarray,
    colmap_pts: np.ndarray,
    voxel_m: float = 0.01,
    max_corr: float = 0.5,
    fitness_threshold: float = 0.3,
) -> np.ndarray:
    """Estimate 4x4 rigid transform mapping E57 frame → COLMAP frame.

    Initial guess: centroid translation. Refinement: point-to-point ICP.
    """
    if not np.isfinite(voxel_m) or voxel_m <= 0:
        raise ValueError("voxel_m must be finite and greater than zero")
    if not np.isfinite(max_corr) or max_corr <= 0:
        raise ValueError("max_corr must be finite and greater than zero")
    if (
        not np.isfinite(fitness_threshold)
        or fitness_threshold <= 0
        or fitness_threshold > 1
    ):
        raise ValueError("fitness_threshold must be finite and in (0, 1]")

    e57_array = np.asarray(e57_pts, dtype=np.float64)
    colmap_array = np.asarray(colmap_pts, dtype=np.float64)
    for label, points in (("E57", e57_array), ("COLMAP", colmap_array)):
        if points.ndim != 2 or points.shape[1:] != (3,) or points.shape[0] == 0:
            raise ValueError(f"{label} points must be a non-empty Nx3 array")
        if not np.isfinite(points).all():
            raise ValueError(f"{label} points must all be finite")

    import open3d as o3d

    src = o3d.geometry.PointCloud()
    src.points = o3d.utility.Vector3dVector(
        voxel_downsample(e57_array, voxel_m)
    )
    dst = o3d.geometry.PointCloud()
    dst.points = o3d.utility.Vector3dVector(colmap_array)

    c_src = np.asarray(src.points).mean(axis=0)
    c_dst = np.asarray(dst.points).mean(axis=0)
    init = np.eye(4)
    init[:3, 3] = c_dst - c_src

    result = o3d.pipelines.registration.registration_icp(
        src,
        dst,
        max_correspondence_distance=max_corr,
        init=init,
        estimation_method=o3d.pipelines.registration.TransformationEstimationPointToPoint(),
        criteria=o3d.pipelines.registration.ICPConvergenceCriteria(max_iteration=100),
    )
    fitness = float(result.fitness)
    if not np.isfinite(fitness) or fitness < 0 or fitness > 1:
        raise RuntimeError("ICP returned an invalid fitness value")
    if fitness < fitness_threshold:
        raise RuntimeError(
            f"ICP fitness {fitness:.3f} below threshold "
            f"{fitness_threshold} — alignment failed; check E57/COLMAP "
            "scale and orientation"
        )
    inlier_rmse = float(result.inlier_rmse)
    if not np.isfinite(inlier_rmse) or inlier_rmse < 0:
        raise RuntimeError("ICP returned an invalid inlier RMSE")

    transform = np.asarray(result.transformation, dtype=np.float64)
    if transform.shape != (4, 4) or not np.isfinite(transform).all():
        raise RuntimeError("ICP transform must be a finite 4x4 matrix")
    if not np.allclose(transform[3], np.array([0.0, 0.0, 0.0, 1.0]), atol=1e-8):
        raise RuntimeError("ICP transform has an invalid homogeneous last row")
    rotation = transform[:3, :3]
    if not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-5):
        raise RuntimeError("ICP transform rotation is not orthonormal")
    if not np.isclose(np.linalg.det(rotation), 1.0, atol=1e-5):
        raise RuntimeError("ICP transform rotation must have determinant +1")
    return transform


# ============================================================================
# COLMAP scene loading via pycolmap.SceneManager (rmbrualla fork)
# ============================================================================

def load_colmap_cameras(colmap_dir: str) -> dict:
    """Load per-image cameras + the scene's 3D point cloud.

    NOTE: this depends on `pycolmap.SceneManager` from the rmbrualla fork
    @ commit cc7ea4b73. Upstream PyPI pycolmap removed SceneManager.
    """
    import pycolmap

    sm = pycolmap.SceneManager(colmap_dir)
    sm.load_cameras()
    sm.load_images()
    sm.load_points3D()

    # At the pinned rmbrualla commit, SceneManager.points3D is already an
    # Nx3 ndarray.  It is not the mapping exposed by modern pycolmap.
    points = np.asarray(sm.points3D, dtype=np.float32)
    if points.ndim != 2 or points.shape[1:] != (3,):
        raise RuntimeError(
            f"COLMAP points3D must be an Nx3 array; received shape {points.shape}"
        )
    if points.shape[0] == 0:
        raise RuntimeError("COLMAP reconstruction contains no 3D points")
    if not np.isfinite(points).all():
        raise RuntimeError("COLMAP points3D contains non-finite coordinates")

    cams = {}
    output_names: dict[str, str] = {}
    ordered_images = sorted(
        sm.images.items(),
        key=lambda item: (str(item[1].name), int(item[0])),
    )
    for _img_id, img in ordered_images:
        cam = sm.cameras[img.camera_id]
        if int(cam.camera_type) not in (0, 1):
            raise RuntimeError(
                f"COLMAP image {img.name!r} uses unsupported distorted camera "
                f"model id {cam.camera_type}; this projector supports only "
                "SIMPLE_PINHOLE and PINHOLE"
            )

        name = str(img.name)
        stem = PurePosixPath(name).stem
        folded_stem = stem.casefold()
        if not stem:
            raise RuntimeError(f"COLMAP image {name!r} has no output-safe stem")
        if folded_stem in output_names:
            raise RuntimeError(
                "COLMAP images would overwrite the same depth prior: "
                f"{output_names[folded_stem]!r} and {name!r}"
            )
        output_names[folded_stem] = name

        # The pinned Image stores its quaternion object at img.q, its numeric
        # (w, x, y, z) components at img.q.q, and translation at img.tvec.
        qvec = np.asarray(img.q.q, dtype=np.float64)
        tvec = np.asarray(img.tvec, dtype=np.float64)
        if qvec.shape != (4,) or not np.isfinite(qvec).all():
            raise RuntimeError(f"COLMAP image {name!r} has an invalid quaternion")
        qnorm = math.hypot(*(float(component) for component in qvec))
        if not np.isfinite(qnorm) or not np.isclose(qnorm, 1.0, rtol=0.0, atol=1e-5):
            raise RuntimeError(
                f"COLMAP image {name!r} quaternion norm must be 1 within 1e-5"
            )
        if tvec.shape != (3,) or not np.isfinite(tvec).all():
            raise RuntimeError(f"COLMAP image {name!r} has an invalid translation")

        intrinsics = np.asarray(
            [cam.fx, cam.fy, cam.cx, cam.cy], dtype=np.float64
        )
        if not np.isfinite(intrinsics).all() or intrinsics[0] <= 0 or intrinsics[1] <= 0:
            raise RuntimeError(f"COLMAP image {name!r} has invalid intrinsics")
        if int(cam.width) <= 0 or int(cam.height) <= 0:
            raise RuntimeError(f"COLMAP image {name!r} has invalid dimensions")

        cams[stem] = {
            "name":   name,
            "qvec":   qvec,
            "tvec":   tvec,
            "fx":     float(cam.fx),
            "fy":     float(cam.fy),
            "cx":     float(cam.cx),
            "cy":     float(cam.cy),
            "width":  int(cam.width),
            "height": int(cam.height),
        }
    return {"cameras": cams, "points3D": points}


def validate_dataset_layout(
    colmap_dir: str | Path, images_dir: str | Path
) -> tuple[Path, Path]:
    """Bind the sparse model and images to one exact COLMAP dataset root."""

    sparse_model = Path(colmap_dir)
    images = Path(images_dir)
    if images.is_symlink() or not images.is_dir() or images.name != "images":
        raise ValueError("--images must be the non-symlink <dataset>/images directory")
    if (
        sparse_model.is_symlink()
        or not sparse_model.is_dir()
        or sparse_model.name != "0"
        or sparse_model.parent.name != "sparse"
    ):
        raise ValueError("--colmap must be the non-symlink <dataset>/sparse/0 directory")
    try:
        expected_model = (images.parent / "sparse" / "0").resolve(strict=True)
        resolved_model = sparse_model.resolve(strict=True)
    except OSError as error:
        raise ValueError("could not resolve the COLMAP dataset layout") from error
    if resolved_model != expected_model:
        raise ValueError("--colmap and --images must belong to the same dataset root")
    return sparse_model, images


def _reject_duplicate_json_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"splits.json contains duplicate key {key!r}")
        result[key] = value
    return result


def _safe_image_name(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty image name")
    pure = PurePosixPath(value)
    if (
        pure.is_absolute()
        or pure.as_posix() != value
        or "\\" in value
        or ":" in value
        or "\x00" in value
        or any(part in {"", ".", ".."} for part in pure.parts)
    ):
        raise ValueError(f"{label} is not a safe relative POSIX image name: {value!r}")
    return value


def _require_exact_regular_image(images_dir: Path, relative_name: str) -> None:
    """Require every path component with exact case and without symlinks."""

    current = images_dir
    parts = PurePosixPath(relative_name).parts
    for index, part in enumerate(parts):
        try:
            matches = [entry for entry in current.iterdir() if entry.name == part]
        except OSError as error:
            raise ValueError(f"cannot inspect images directory for {relative_name!r}") from error
        if len(matches) != 1:
            raise ValueError(
                f"image {relative_name!r} is missing with the exact registered filename"
            )
        current = matches[0]
        if current.is_symlink():
            raise ValueError(f"image path must not contain a symlink: {relative_name!r}")
        if index < len(parts) - 1 and not current.is_dir():
            raise ValueError(f"image parent is not a directory: {relative_name!r}")
    if not current.is_file():
        raise ValueError(f"registered image is not a regular file: {relative_name!r}")


def _enumerate_regular_images(images_dir: Path) -> list[str]:
    names: list[str] = []

    def visit(directory: Path, components: tuple[str, ...]) -> None:
        try:
            entries = sorted(
                directory.iterdir(),
                key=lambda entry: (entry.name.casefold(), entry.name),
            )
        except OSError as error:
            raise ValueError("could not enumerate --images") from error
        for entry in entries:
            relative_name = PurePosixPath(*components, entry.name).as_posix()
            _safe_image_name(relative_name, label="images entry")
            if entry.is_symlink():
                raise ValueError(f"image path must not be a symlink: {relative_name!r}")
            if entry.is_dir():
                visit(entry, (*components, entry.name))
            elif entry.is_file():
                names.append(relative_name)
            else:
                raise ValueError(
                    f"images entry must be a regular file or directory: {relative_name!r}"
                )

    visit(images_dir, ())
    return sorted(names)


def select_training_cameras(cameras: dict, images_dir: str | Path) -> list[dict]:
    """Return only the canonical training cameras from sibling ``splits.json``.

    The frozen comparison uses gsplat's default ``test_every=8`` rule over
    camera names sorted lexicographically.  Enforcing that rule here prevents
    the depth projector from generating priors for held-out evaluation views.
    """

    root = Path(images_dir)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("--images must be an existing non-symlink directory")
    splits_path = root.parent / "splits.json"
    if splits_path.is_symlink() or not splits_path.is_file():
        raise ValueError("a regular sibling splits.json is required beside --images")
    try:
        stat_before = splits_path.stat()
        if stat_before.st_size > _MAX_SPLITS_BYTES:
            raise ValueError("splits.json exceeds the 1 MiB safety limit")
        with splits_path.open("rb") as source:
            encoded = source.read(_MAX_SPLITS_BYTES + 1)
        stat_after = splits_path.stat()
    except OSError as error:
        raise ValueError("could not read sibling splits.json") from error
    if len(encoded) > _MAX_SPLITS_BYTES:
        raise ValueError("splits.json exceeds the 1 MiB safety limit")
    stable_identity_before = (
        stat_before.st_dev,
        stat_before.st_ino,
        stat_before.st_size,
        stat_before.st_mtime_ns,
    )
    stable_identity_after = (
        stat_after.st_dev,
        stat_after.st_ino,
        stat_after.st_size,
        stat_after.st_mtime_ns,
    )
    if stable_identity_before != stable_identity_after or splits_path.is_symlink():
        raise ValueError("splits.json changed while it was being read")
    try:
        splits = json.loads(
            encoded.decode("utf-8", errors="strict"),
            object_pairs_hook=_reject_duplicate_json_pairs,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("splits.json is not valid UTF-8 JSON") from error
    if not isinstance(splits, dict) or set(splits) != {"train", "heldout"}:
        raise ValueError("splits.json must contain exactly train and heldout arrays")

    parsed: dict[str, list[str]] = {}
    folded_names: dict[str, str] = {}
    for split_name in ("train", "heldout"):
        raw_names = splits[split_name]
        if not isinstance(raw_names, list) or not raw_names:
            raise ValueError(f"splits.json {split_name} must be a non-empty array")
        names: list[str] = []
        for index, raw_name in enumerate(raw_names):
            name = _safe_image_name(raw_name, label=f"{split_name}[{index}]")
            folded = name.casefold()
            if folded in folded_names:
                raise ValueError(
                    f"split image names collide or repeat: {folded_names[folded]!r} and {name!r}"
                )
            folded_names[folded] = name
            names.append(name)
        parsed[split_name] = names

    camera_by_name: dict[str, dict] = {}
    folded_cameras: dict[str, str] = {}
    for camera in cameras.values():
        if not isinstance(camera, dict):
            raise ValueError("COLMAP camera record must be a mapping")
        name = _safe_image_name(camera.get("name"), label="COLMAP camera name")
        folded = name.casefold()
        if folded in folded_cameras:
            raise ValueError(
                f"COLMAP camera names collide: {folded_cameras[folded]!r} and {name!r}"
            )
        folded_cameras[folded] = name
        camera_by_name[name] = camera

    sorted_names = sorted(camera_by_name)
    expected_heldout = [name for index, name in enumerate(sorted_names) if index % 8 == 0]
    expected_train = [name for index, name in enumerate(sorted_names) if index % 8 != 0]
    if parsed["train"] != expected_train or parsed["heldout"] != expected_heldout:
        raise ValueError(
            "splits.json does not match the frozen sorted-name test_every=8 rule"
        )
    if set(parsed["train"]) | set(parsed["heldout"]) != set(camera_by_name):
        raise ValueError("splits.json does not exhaustively match the COLMAP cameras")

    for name in sorted_names:
        _require_exact_regular_image(root, name)
    actual_image_names = _enumerate_regular_images(root)
    if actual_image_names != sorted_names:
        raise ValueError(
            "--images files do not exactly match the registered COLMAP camera names"
        )
    return [camera_by_name[name] for name in expected_train]


def quat_to_R(q: np.ndarray) -> np.ndarray:
    """Quaternion (w, x, y, z) → 3x3 rotation matrix."""
    components = np.asarray(q, dtype=np.float64)
    if components.shape != (4,) or not np.isfinite(components).all():
        raise ValueError("quaternion must contain four finite components")
    norm = math.hypot(*(float(component) for component in components))
    if not np.isfinite(norm):
        raise ValueError("quaternion norm must be finite")
    if norm <= np.finfo(np.float64).eps:
        raise ValueError("quaternion must be non-zero")
    if not np.isclose(norm, 1.0, rtol=0.0, atol=1e-5):
        raise ValueError("quaternion norm must be 1 within 1e-5")
    w, x, y, z = components / norm
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w),     2 * (x * z + y * w)],
            [2 * (x * y + z * w),     1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w),     2 * (y * z + x * w),     1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )


# ============================================================================
# per-image projection (worker function)
# ============================================================================

_DEPTH_PRIOR_MEMBER_ORDER = ("uv", "depth_m", "width", "height")
_FIXED_ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def _npy_bytes(array: np.ndarray) -> bytes:
    stream = io.BytesIO()
    materialized = np.asarray(array)
    if materialized.ndim > 0:
        materialized = np.ascontiguousarray(materialized)
    np.lib.format.write_array(
        stream,
        materialized,
        version=(1, 0),
        allow_pickle=False,
    )
    return stream.getvalue()


def _write_depth_prior(
    path: Path,
    *,
    uv: np.ndarray,
    depth_m: np.ndarray,
    width: int,
    height: int,
) -> None:
    """Write one byte-stable NPZ under the pinned Python/NumPy toolchain."""

    arrays = {
        "uv": np.asarray(uv, dtype="<f4"),
        "depth_m": np.asarray(depth_m, dtype="<f4"),
        "width": np.asarray(width, dtype="<i4"),
        "height": np.asarray(height, dtype="<i4"),
    }
    stream = io.BytesIO()
    with zipfile.ZipFile(
        stream,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
        strict_timestamps=True,
    ) as archive:
        for member_name in _DEPTH_PRIOR_MEMBER_ORDER:
            member = zipfile.ZipInfo(
                f"{member_name}.npy", date_time=_FIXED_ZIP_TIMESTAMP
            )
            member.compress_type = zipfile.ZIP_DEFLATED
            member.create_system = 3
            member.external_attr = 0o100600 << 16
            archive.writestr(
                member,
                _npy_bytes(arrays[member_name]),
                compresslevel=9,
            )
    with path.open("xb") as output:
        output.write(stream.getvalue())

def project_one(args_tuple) -> tuple[str, int]:
    name, cam, e57_pts_in_colmap, max_samples, erosion_px, out_dir = args_tuple

    if max_samples <= 0:
        raise ValueError("max_samples must be positive")
    if erosion_px < 0:
        raise ValueError("erosion_px must be non-negative")

    R = quat_to_R(cam["qvec"])
    t = cam["tvec"].reshape(3, 1)

    # world → camera
    pts_cam = (R @ e57_pts_in_colmap.T + t).T  # Nx3
    z = pts_cam[:, 2]
    front = z > 0.05
    pts_cam = pts_cam[front]
    z = z[front]
    if pts_cam.shape[0] == 0:
        raise RuntimeError(f"no E57 points project in front of training image {name!r}")

    u = (pts_cam[:, 0] * cam["fx"] / z) + cam["cx"]
    v = (pts_cam[:, 1] * cam["fy"] / z) + cam["cy"]
    in_bounds = (
        (u >= erosion_px) & (u < cam["width"]  - erosion_px)
        & (v >= erosion_px) & (v < cam["height"] - erosion_px)
    )
    u, v, z = u[in_bounds], v[in_bounds], z[in_bounds]
    if u.size == 0:
        raise RuntimeError(f"no E57 points project inside training image {name!r}")

    # Z-buffer: group by integer pixel, choose nearest depth, then break exact
    # depth ties by sub-pixel coordinate and original source order.  The result
    # remains in ascending pixel order regardless of NumPy sort defaults.
    pix = np.floor(np.column_stack([v, u])).astype(np.int64)
    flat = pix[:, 0] * cam["width"] + pix[:, 1]
    source_index = np.arange(flat.size, dtype=np.int64)
    order = np.lexsort((source_index, v, u, z, flat))
    ordered_flat = flat[order]
    first_in_pixel = np.empty(ordered_flat.size, dtype=bool)
    first_in_pixel[0] = True
    first_in_pixel[1:] = ordered_flat[1:] != ordered_flat[:-1]
    selected = order[first_in_pixel]
    u, v, z = u[selected], v[selected], z[selected]

    if u.size > max_samples:
        # Deterministic, distributed coverage keeps identical source inputs
        # byte-stable instead of drawing a fresh unseeded subset each run.
        sel = np.linspace(0, u.size - 1, num=max_samples, dtype=np.int64)
        u, v, z = u[sel], v[sel], z[sel]

    out_path = Path(out_dir) / f"{PurePosixPath(name).stem}.npz"
    _write_depth_prior(
        out_path,
        uv=np.column_stack([u, v]).astype(np.float32),
        depth_m=z.astype(np.float32),
        width=int(cam["width"]),
        height=int(cam["height"]),
    )
    return name, int(u.size)


# ============================================================================
# main
# ============================================================================

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--e57",    required=True, help="E57 cloud file")
    p.add_argument("--colmap", required=True, help="COLMAP sparse/0 directory")
    p.add_argument(
        "--images",
        required=True,
        help="COLMAP images/ directory; the exact split is read from sibling splits.json",
    )
    p.add_argument(
        "--out",
        required=True,
        help="new, nonexistent output directory for .npz priors",
    )
    p.add_argument("--voxel-m", type=float, default=0.01,
                   help="voxel size for ICP-side downsample (m)")
    p.add_argument("--max-samples-per-image", type=int, default=200_000)
    p.add_argument("--erosion-px", type=int, default=1,
                   help="reject points within this many pixels of the image edge")
    p.add_argument("--num-workers", type=int, default=8)
    p.add_argument("--icp-fitness-threshold", type=float, default=0.3)
    p.add_argument("--icp-max-corr", type=float, default=0.5)
    args = p.parse_args()

    out_dir = Path(args.out)
    if out_dir.exists() or out_dir.is_symlink():
        raise FileExistsError("--out must not already exist")
    colmap_dir, images_dir = validate_dataset_layout(args.colmap, args.images)

    print(f"[1/4] loading E57 cloud {args.e57}")
    e57_pts = load_e57(args.e57)
    print(f"      loaded {e57_pts.shape[0]:,} points")

    print(f"[2/4] loading COLMAP scene {colmap_dir}")
    scene = load_colmap_cameras(str(colmap_dir))
    training_cameras = select_training_cameras(scene["cameras"], images_dir)
    print(
        f"      {len(training_cameras):,} training cameras / "
        f"{len(scene['cameras']) - len(training_cameras):,} held-out cameras / "
        f"{scene['points3D'].shape[0]:,} 3D points"
    )

    print("[3/4] estimating E57 → COLMAP transform via ICP")
    T = estimate_transform(
        e57_pts,
        scene["points3D"],
        voxel_m=args.voxel_m,
        max_corr=args.icp_max_corr,
        fitness_threshold=args.icp_fitness_threshold,
    )
    print("      transform estimated OK")

    # Create only after every input and the proposed alignment have passed.
    # exist_ok=False closes the race with another process and prevents stale
    # priors from a previous E57/transform from surviving a retry.
    out_dir.mkdir(parents=True, exist_ok=False)

    # apply transform to full-resolution E57 once, share with workers
    e57_in_colmap = (T[:3, :3] @ e57_pts.T + T[:3, 3:4]).T

    print(f"[4/4] projecting per-image depth (workers={args.num_workers})")
    jobs = [
        (
            cam["name"],
            cam,
            e57_in_colmap,
            args.max_samples_per_image,
            args.erosion_px,
            str(out_dir),
        )
        for cam in training_cameras
    ]
    counts_by_name: dict[str, int] = {}
    with ProcessPoolExecutor(max_workers=args.num_workers) as ex:
        for fut in as_completed([ex.submit(project_one, j) for j in jobs]):
            name, n = fut.result()
            counts_by_name[name] = n
    expected_names = [cam["name"] for cam in training_cameras]
    if set(counts_by_name) != set(expected_names):
        raise RuntimeError("depth projection did not return every expected training image")
    counts = [counts_by_name[name] for name in expected_names]
    if any(count <= 0 for count in counts):
        raise RuntimeError("depth projection returned an empty training prior")
    expected_prior_files = sorted(
        f"{PurePosixPath(name).stem}.npz" for name in expected_names
    )
    actual_entries = sorted(entry.name for entry in out_dir.iterdir())
    if actual_entries != expected_prior_files or any(
        entry.is_symlink() or not entry.is_file() for entry in out_dir.iterdir()
    ):
        raise RuntimeError("output directory does not contain the exact expected prior set")
    print(
        f"      wrote {len(counts)} priors, "
        f"mean {np.mean(counts) if counts else 0:.0f} samples/image"
    )

    summary = {
        "e57":          args.e57,
        "colmap":       args.colmap,
        "transform":    T.tolist(),
        "n_priors":     len(counts),
        "mean_samples": float(np.mean(counts)) if counts else 0.0,
        "min_samples":  int(np.min(counts))    if counts else 0,
        "max_samples":  int(np.max(counts))    if counts else 0,
        "training_images": [
            {
                "name": name,
                "prior": f"{PurePosixPath(name).stem}.npz",
                "samples": counts_by_name[name],
            }
            for name in expected_names
        ],
    }
    summary_path = out_dir / "_priors_summary.json"
    with summary_path.open("x", encoding="utf-8", newline="\n") as output:
        output.write(
            json.dumps(summary, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            + "\n"
        )
    final_entries = sorted(entry.name for entry in out_dir.iterdir())
    if final_entries != sorted([*expected_prior_files, summary_path.name]):
        raise RuntimeError("output directory changed while sealing the depth summary")
    print(f"summary → {summary_path}")


if __name__ == "__main__":
    main()
