"""Generate sparse per-image UV+depth .npz priors from an E57 LiDAR cloud.

Pipeline:
  1. Load every E57 scan station and concatenate into a single Nx3
     array in the E57 global frame (pye57).
  2. Voxel-downsample to ~1cm for ICP tractability.
  3. Estimate an E57 → COLMAP rigid transform via centroid alignment
     (initial guess) + open3d point-to-point ICP (refinement).
     Default ICP: max_correspondence_distance=0.5m, fitness >= 0.3.
  4. For each COLMAP camera, project the full-resolution E57 cloud
     into the camera frame, z-buffer to keep the nearest point per
     pixel, optionally erode edges, subsample to max_samples_per_image.
  5. Save uv (M×2 float32), depth_m (M float32), width/height (int32)
     to <out>/<image_stem>.npz per training image, plus
     _priors_summary.json with the transform + per-image sample counts.

CRITICAL: uses pycolmap.SceneManager from the rmbrualla fork
(commit cc7ea4b73). Upstream pycolmap REMOVED SceneManager and the
gsplat example trainers depend on it. Non-negotiable per D-016.

Expect ~10–15 minutes total runtime on the A100 pod CPU for a
Trades-Hall-class venue (149 stations, 37M E57 points, ~300 training
images). The slowest step is per-image projection — parallelized via
ProcessPoolExecutor.
"""

from __future__ import annotations

import argparse
import json
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np


# ============================================================================
# E57 loading
# ============================================================================

def load_e57(path: str) -> np.ndarray:
    """Concatenate every scan station into one Nx3 array in E57 global frame."""
    import pye57

    e57 = pye57.E57(path)
    pts: list[np.ndarray] = []
    for i in range(e57.scan_count):
        scan = e57.read_scan(
            i, ignore_missing_fields=True, intensity=False, colors=False
        )
        x = np.asarray(scan["cartesianX"], dtype=np.float64)
        y = np.asarray(scan["cartesianY"], dtype=np.float64)
        z = np.asarray(scan["cartesianZ"], dtype=np.float64)
        local = np.column_stack([x, y, z])

        # Apply per-station pose to put points in the global frame.
        try:
            header = e57.get_header(i)
            R = np.asarray(getattr(header, "rotation_matrix", None) or np.eye(3))
            t = np.asarray(getattr(header, "translation", None) or [0.0, 0.0, 0.0])
            glob = local @ R.T + t
        except Exception:  # noqa: BLE001 — fall back to local coords
            glob = local

        pts.append(glob)

    if not pts:
        raise RuntimeError(f"E57 file has no scans: {path}")
    return np.concatenate(pts, axis=0).astype(np.float32)


def voxel_downsample(points: np.ndarray, voxel_m: float) -> np.ndarray:
    """Coarse voxel downsample by integer-bucketing coordinates."""
    if voxel_m <= 0:
        return points
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
    import open3d as o3d

    src = o3d.geometry.PointCloud()
    src.points = o3d.utility.Vector3dVector(
        voxel_downsample(e57_pts, voxel_m).astype(np.float64)
    )
    dst = o3d.geometry.PointCloud()
    dst.points = o3d.utility.Vector3dVector(colmap_pts.astype(np.float64))

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
    if result.fitness < fitness_threshold:
        raise RuntimeError(
            f"ICP fitness {result.fitness:.3f} below threshold "
            f"{fitness_threshold} — alignment failed; check E57/COLMAP "
            "scale and orientation"
        )
    return np.asarray(result.transformation)


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

    points = np.array(
        [[p.xyz[0], p.xyz[1], p.xyz[2]] for p in sm.points3D.values()],
        dtype=np.float32,
    )

    cams = {}
    for img_id, img in sm.images.items():
        cam = sm.cameras[img.camera_id]
        cams[Path(img.name).stem] = {
            "name":   img.name,
            "qvec":   np.asarray(img.q),  # (w, x, y, z) per the rmbrualla fork
            "tvec":   np.asarray(img.t),
            "fx":     float(cam.fx),
            "fy":     float(cam.fy),
            "cx":     float(cam.cx),
            "cy":     float(cam.cy),
            "width":  int(cam.width),
            "height": int(cam.height),
        }
    return {"cameras": cams, "points3D": points}


def quat_to_R(q: np.ndarray) -> np.ndarray:
    """Quaternion (w, x, y, z) → 3x3 rotation matrix."""
    w, x, y, z = q
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

def project_one(args_tuple) -> tuple[str, int]:
    name, cam, e57_pts_in_colmap, max_samples, erosion_px, out_dir = args_tuple

    R = quat_to_R(cam["qvec"])
    t = cam["tvec"].reshape(3, 1)

    # world → camera
    pts_cam = (R @ e57_pts_in_colmap.T + t).T  # Nx3
    z = pts_cam[:, 2]
    front = z > 0.05
    pts_cam = pts_cam[front]
    z = z[front]
    if pts_cam.shape[0] == 0:
        return name, 0

    u = (pts_cam[:, 0] * cam["fx"] / z) + cam["cx"]
    v = (pts_cam[:, 1] * cam["fy"] / z) + cam["cy"]
    in_bounds = (
        (u >= erosion_px) & (u < cam["width"]  - erosion_px)
        & (v >= erosion_px) & (v < cam["height"] - erosion_px)
    )
    u, v, z = u[in_bounds], v[in_bounds], z[in_bounds]
    if u.size == 0:
        return name, 0

    # z-buffer: nearest point per integer pixel
    pix = np.floor(np.column_stack([v, u])).astype(np.int64)
    order = np.argsort(z)
    pix, u, v, z = pix[order], u[order], v[order], z[order]
    flat = pix[:, 0] * cam["width"] + pix[:, 1]
    _, first_idx = np.unique(flat, return_index=True)
    u, v, z = u[first_idx], v[first_idx], z[first_idx]

    if u.size > max_samples:
        sel = np.random.choice(u.size, max_samples, replace=False)
        u, v, z = u[sel], v[sel], z[sel]

    out_path = Path(out_dir) / f"{Path(name).stem}.npz"
    np.savez_compressed(
        out_path,
        uv=np.column_stack([u, v]).astype(np.float32),
        depth_m=z.astype(np.float32),
        width=np.int32(cam["width"]),
        height=np.int32(cam["height"]),
    )
    return name, int(u.size)


# ============================================================================
# main
# ============================================================================

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--e57",    required=True, help="E57 cloud file")
    p.add_argument("--colmap", required=True, help="COLMAP sparse/0 directory")
    p.add_argument("--images", required=True, help="COLMAP images/ directory")
    p.add_argument("--out",    required=True, help="output dir for .npz priors")
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
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/4] loading E57 cloud {args.e57}")
    e57_pts = load_e57(args.e57)
    print(f"      loaded {e57_pts.shape[0]:,} points")

    print(f"[2/4] loading COLMAP scene {args.colmap}")
    scene = load_colmap_cameras(args.colmap)
    print(
        f"      {len(scene['cameras']):,} cameras / "
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
        for cam in scene["cameras"].values()
    ]
    counts: list[int] = []
    with ProcessPoolExecutor(max_workers=args.num_workers) as ex:
        for fut in as_completed([ex.submit(project_one, j) for j in jobs]):
            _, n = fut.result()
            counts.append(n)
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
    }
    (out_dir / "_priors_summary.json").write_text(json.dumps(summary, indent=2))
    print(f"summary → {out_dir / '_priors_summary.json'}")


if __name__ == "__main__":
    main()
