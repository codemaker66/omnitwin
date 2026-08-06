"""Build a Floor Atlas for one reviewed room region.

Reads scanner poses from a supported node source, fuses selected panoramas on
a nominal metric grid, and writes an orthophoto plus coverage and lossless
sample-accounting rasters. Sources are opened READ-ONLY; everything lands
under --out. Nothing here publishes or gains authority automatically.

  python floor_atlas_build.py --out <dir> \
      --equirect F:/E57/equirect_fixed \
      --manifest .../twin/trades-hall/manifest.json \
      --bounds 8.4 -4.5 22 18 --mm-per-px 8 \
      [--ss] [--mesh <glb>] [--max-sources 60] \
      [--align] [--harmonise]

--bounds is CENTRE_X CENTRE_Y WIDTH_M HEIGHT_M in E57 world metres.
"""

from __future__ import annotations

import argparse
import hashlib
from importlib.metadata import PackageNotFoundError, version
import json
import os
from pathlib import Path
import platform
from typing import Any

import numpy as np
from PIL import Image

import floor_atlas as fa
import nadir_fill as nf


SCRIPT_DIR = Path(__file__).resolve().parent
SCHEMA_VERSION = "omnitwin.floor-atlas.run.v1"
MESH_VOXEL_M = 0.10
SELF_BLIND_M = 0.80
MAX_INCIDENCE_DEG = 80.0
Z_EXEMPT_M = 0.30
ROBUST_SIGMA = 2.0
SPECULAR_SIGMA = 0.5
MIN_ROBUST_SOURCES = 3
DEFAULT_STOREY_TOLERANCE_M = 0.80
STOREY_CLUSTER_GAP_M = 1.20
INVALID_FILENAME_CHARS = '<>:"/\\|?*'
WINDOWS_RESERVED_STEMS = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json_sha256(value: Any) -> str:
    payload = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf8")
    return hashlib.sha256(payload).hexdigest()


def artifact_record(path: Path, media_type: str) -> dict[str, Any]:
    resolved = path.resolve()
    return {
        "path": os.fspath(resolved),
        "filename": resolved.name,
        "size_bytes": resolved.stat().st_size,
        "sha256": sha256_file(resolved),
        "media_type": media_type,
    }


def assert_artifact_unchanged(record: dict[str, Any]) -> None:
    path = Path(record["path"])
    actual_size = path.stat().st_size
    if actual_size != record["size_bytes"]:
        raise RuntimeError(
            f"input changed during run: {path} size "
            f"{record['size_bytes']} -> {actual_size}"
        )
    actual_sha256 = sha256_file(path)
    if actual_sha256 != record["sha256"]:
        raise RuntimeError(
            f"input changed during run: {path} SHA-256 "
            f"{record['sha256']} -> {actual_sha256}"
        )


def planned_output_paths(output_dir: Path, label: str) -> dict[str, Path]:
    return {
        "atlas": (output_dir / f"{label}-atlas.png").resolve(),
        "coverage_preview": (output_dir / f"{label}-coverage.png").resolve(),
        "counts": (output_dir / f"{label}-counts.npy").resolve(),
        "retained_counts": (output_dir / f"{label}-retained-counts.npy").resolve(),
        "eligible_counts": (output_dir / f"{label}-eligible-counts.npy").resolve(),
        "report": (output_dir / f"{label}-atlas-report.json").resolve(),
    }


def paths_alias(left: Path, right: Path) -> bool:
    left = left.resolve()
    right = right.resolve()
    if os.path.normcase(os.fspath(left)) == os.path.normcase(os.fspath(right)):
        return True
    if left.exists() and right.exists():
        try:
            return os.path.samefile(left, right)
        except OSError:
            return False
    return False


def assert_outputs_disjoint_from_inputs(
    outputs: dict[str, Path],
    input_paths: list[Path],
    equirect_dir: Path,
    requested_output_dir: Path,
) -> None:
    output_values = list(outputs.values())
    resolved_output_dir = requested_output_dir.resolve()
    for role, output in outputs.items():
        if output.parent != resolved_output_dir:
            raise ValueError(
                f"planned output escapes --out through an existing link ({role}): "
                f"{output}"
            )
    for index, left in enumerate(output_values):
        for right in output_values[index + 1 :]:
            if paths_alias(left, right):
                raise ValueError(f"planned output paths alias each other: {left} / {right}")
    for output in output_values:
        for input_path in input_paths:
            if paths_alias(output, input_path):
                raise ValueError(
                    f"planned output aliases a read-only input: {output}"
                )
    if (
        resolved_output_dir == equirect_dir
        or resolved_output_dir.is_relative_to(equirect_dir)
    ):
        raise ValueError(
            "--out must not be the panorama directory or one of its descendants"
        )


def package_version(distribution: str) -> str | None:
    try:
        return version(distribution)
    except PackageNotFoundError:
        return None


def load_nodes(
    manifest_path: Path,
) -> tuple[dict[str, dict[str, Any]], str]:
    with manifest_path.open("r", encoding="utf8") as stream:
        manifest = json.load(stream)
    raw_nodes = manifest.get("nodes") if isinstance(manifest, dict) else None
    source_format = "forged_bundle_manifest_v1"
    if not isinstance(raw_nodes, list):
        if not isinstance(manifest, dict) or not manifest:
            raise ValueError(
                "node source must contain nodes or a non-empty legacy pose map"
            )
        raw_nodes = []
        for key, value in manifest.items():
            if not isinstance(value, dict) or "translation" not in value:
                raise ValueError(
                    "node source is neither a forged manifest nor legacy pose map"
                )
            node_id = f"scan_{int(key):03d}" if str(key).isdigit() else str(key)
            raw_nodes.append(
                {
                    "id": node_id,
                    "pose": {"t": value["translation"]},
                    "floor": None,
                }
            )
        source_format = "legacy_pose_map_v1"
    if not raw_nodes:
        raise ValueError("node source contains no nodes")

    nodes: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(raw_nodes):
        if not isinstance(raw, dict):
            raise ValueError(f"manifest nodes[{index}] must be an object")
        node_id = raw.get("id")
        pose = raw.get("pose")
        translation = pose.get("t") if isinstance(pose, dict) else None
        if not isinstance(node_id, str) or not node_id:
            raise ValueError(f"manifest nodes[{index}].id must be a string")
        validate_filename_segment(node_id, f"manifest nodes[{index}].id")
        if node_id in nodes:
            raise ValueError(f"duplicate node id: {node_id}")
        try:
            centre = np.asarray(translation, dtype=np.float64)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"manifest node {node_id} has invalid pose.t") from exc
        if centre.shape != (3,) or not np.isfinite(centre).all():
            raise ValueError(f"manifest node {node_id} pose.t must be 3 finite values")
        nodes[node_id] = {"t": centre, "floor": raw.get("floor")}
    return nodes, source_format


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser()
    ap.add_argument("--equirect", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bounds", nargs=4, type=float, required=True,
                    metavar=("CX", "CY", "W", "H"))
    ap.add_argument("--mm-per-px", type=float, default=8.0)
    ap.add_argument("--ss", action="store_true", help="use the 8192 panos")
    ap.add_argument("--mesh", default="")
    ap.add_argument("--max-sources", type=int, default=60)
    ap.add_argument("--z-floor", type=float, default=None,
                    help="world z of the floor; default = median scanner z - 1.5")
    ap.add_argument("--radius-m", type=float, default=14.0,
                    help="only fuse sweeps within this distance of the region")
    ap.add_argument(
        "--floor-id",
        default=None,
        help="select nodes whose manifest floor value matches this string",
    )
    ap.add_argument(
        "--storey-z",
        type=float,
        default=None,
        help="expected scanner-centre z for explicit storey selection",
    )
    ap.add_argument(
        "--storey-tolerance-m",
        type=float,
        default=DEFAULT_STOREY_TOLERANCE_M,
        help="maximum scanner-centre z distance from the selected storey",
    )
    ap.add_argument("--label", default="room")
    ap.add_argument(
        "--align",
        action="store_true",
        help="opt in to experimental per-source floor-height alignment",
    )
    ap.add_argument(
        "--harmonise",
        action="store_true",
        help="opt in to experimental incidence-binned colour harmonisation",
    )
    return ap


def validate_args(args: argparse.Namespace) -> None:
    _cx, _cy, width_m, height_m = args.bounds
    finite_values = [
        *args.bounds,
        args.mm_per_px,
        args.radius_m,
        args.storey_tolerance_m,
    ]
    if args.z_floor is not None:
        finite_values.append(args.z_floor)
    if args.storey_z is not None:
        finite_values.append(args.storey_z)
    if not all(np.isfinite(finite_values)):
        raise ValueError("bounds, scale, radius and z-floor must be finite")
    if width_m <= 0 or height_m <= 0:
        raise ValueError("bounds width and height must be positive")
    if args.mm_per_px <= 0:
        raise ValueError("--mm-per-px must be positive")
    if args.radius_m <= 0:
        raise ValueError("--radius-m must be positive")
    if args.max_sources <= 0:
        raise ValueError("--max-sources must be positive")
    if args.storey_tolerance_m <= 0:
        raise ValueError("--storey-tolerance-m must be positive")
    validate_filename_segment(args.label, "--label")


def select_sources(
    nodes: dict[str, dict[str, Any]],
    cx: float,
    cy: float,
    args: argparse.Namespace,
) -> tuple[float, float, str, str, list[tuple[float, str]]]:
    within_radius = []
    for node_id, record in nodes.items():
        centre = record["t"]
        distance = float(np.hypot(centre[0] - cx, centre[1] - cy))
        if distance <= args.radius_m:
            within_radius.append((distance, node_id, record))
    if not within_radius:
        raise ValueError("no sweeps within radius")

    candidates = within_radius
    selection_parts = []
    if args.floor_id is not None:
        candidates = [
            item
            for item in candidates
            if item[2]["floor"] is not None
            and str(item[2]["floor"]) == args.floor_id
        ]
        if not candidates:
            raise ValueError(f"no sweeps match --floor-id {args.floor_id!r}")
        selection_parts.append("manifest_floor_id")

    if args.storey_z is not None:
        storey_z = float(args.storey_z)
        selection_parts.append("operator_storey_z")
    else:
        floor_values = {
            str(record["floor"])
            for _distance, _node, record in candidates
            if record["floor"] is not None
        }
        if args.floor_id is None and len(floor_values) > 1:
            raise ValueError(
                "ambiguous manifest floors within radius; use --floor-id or --storey-z"
            )
        sorted_z = sorted(float(record["t"][2]) for _d, _n, record in candidates)
        clusters = [[sorted_z[0]]]
        for value in sorted_z[1:]:
            # Anchor each cluster at its minimum. Adjacent heights must not
            # single-link across two storeys through intermediate outliers.
            if value - clusters[-1][0] > STOREY_CLUSTER_GAP_M:
                clusters.append([value])
            else:
                clusters[-1].append(value)
        if len(clusters) > 1:
            raise ValueError(
                "ambiguous scanner-height clusters within radius; use --storey-z"
            )
        storey_z = float(np.median(clusters[0]))
        selection_parts.append("single_storey_cluster")

    if args.z_floor is None:
        z_floor = storey_z - 1.5
        derivation = "selected_storey_z_minus_1_5m"
    else:
        z_floor = float(args.z_floor)
        derivation = "operator_supplied"

    picks = []
    for distance, node_id, record in candidates:
        centre = record["t"]
        if abs(centre[2] - storey_z) > args.storey_tolerance_m:
            continue
        picks.append((distance, node_id))
    picks.sort()
    picks = picks[: args.max_sources]
    if not picks:
        raise ValueError("no sweeps within radius on this storey")
    return storey_z, z_floor, derivation, "+".join(selection_parts), picks


def panorama_path(equirect: Path, node_id: str, supersampled: bool) -> Path:
    name = f"{node_id}_8192.jpg" if supersampled else f"{node_id}.jpg"
    equirect = equirect.resolve()
    path = (equirect / name).resolve()
    if path.parent != equirect:
        raise ValueError(f"panorama path escapes --equirect for {node_id}: {path}")
    if path.name != name:
        raise ValueError(f"panorama basename mismatch for {node_id}: {path.name}")
    if not path.is_file():
        raise FileNotFoundError(f"panorama missing for {node_id}: {path}")
    return path


def panorama_input_records(
    equirect: Path,
    picks: list[tuple[float, str]],
    nodes: dict[str, dict[str, Any]],
    supersampled: bool,
) -> tuple[list[dict[str, Any]], dict[str, Path]]:
    records = []
    paths = {}
    for distance, node_id in picks:
        path = panorama_path(equirect, node_id, supersampled)
        for other_id, other_path in paths.items():
            if paths_alias(path, other_path):
                raise ValueError(
                    "selected panorama artifacts alias the same physical file: "
                    f"{other_id} / {node_id}"
                )
        with Image.open(path) as image:
            width_px, height_px = image.size
        record = artifact_record(path, "image/jpeg")
        record.update(
            {
                "node_id": node_id,
                "pose_t_m": [float(value) for value in nodes[node_id]["t"]],
                "distance_m": distance,
                "width_px": width_px,
                "height_px": height_px,
            }
        )
        records.append(record)
        paths[node_id] = path
    return records, paths


def load_image(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(image.convert("RGB"), dtype=np.uint8)


def load_occluder(mesh_path: Path | None):
    if mesh_path is None:
        return None
    import trimesh

    triangles = np.asarray(
        trimesh.load(mesh_path, force="mesh", process=False).triangles,
        dtype=np.float64,
    )
    if triangles.size == 0:
        raise ValueError("mesh loaded empty (compressed GLB?)")
    occluder = nf.VoxelOccluder.from_triangles(triangles, voxel=MESH_VOXEL_M)
    print(
        f"occluder: {triangles.shape[0]} tris, grid {occluder.grid.shape}",
        flush=True,
    )
    return occluder


def write_outputs(
    paths: dict[str, Path],
    atlas: np.ndarray,
    contributor_counts: np.ndarray,
    retained_counts: np.ndarray,
    eligible_counts: np.ndarray,
) -> dict[str, dict[str, Any]]:
    atlas_path = paths["atlas"]
    coverage_path = paths["coverage_preview"]
    counts_path = paths["counts"]
    retained_counts_path = paths["retained_counts"]
    eligible_counts_path = paths["eligible_counts"]

    Image.fromarray(atlas.clip(0, 255).astype(np.uint8)).save(atlas_path)
    coverage = (
        np.clip(contributor_counts, 0, 12) / 12.0 * 255
    ).astype(np.uint8)
    Image.fromarray(coverage).save(coverage_path)
    if int(eligible_counts.max(initial=0)) > np.iinfo(np.uint32).max:
        raise OverflowError("observation counts exceed uint32 output capacity")
    contributor_counts_u32 = contributor_counts.astype(np.uint32)
    retained_counts_u32 = retained_counts.astype(np.uint32)
    eligible_counts_u32 = eligible_counts.astype(np.uint32)
    np.save(counts_path, contributor_counts_u32, allow_pickle=False)
    np.save(retained_counts_path, retained_counts_u32, allow_pickle=False)
    np.save(eligible_counts_path, eligible_counts_u32, allow_pickle=False)

    outputs = {
        "atlas": {
            **artifact_record(atlas_path, "image/png"),
            "dtype": "uint8",
            "shape": list(atlas.shape),
        },
        "coverage_preview": {
            **artifact_record(coverage_path, "image/png"),
            "dtype": "uint8",
            "shape": list(coverage.shape),
        },
        "counts": {
            **artifact_record(counts_path, "application/x-npy"),
            "dtype": "uint32",
            "shape": list(contributor_counts_u32.shape),
            "semantics": "post_rejection_contributors_with_fallback_restored",
        },
        "retained_counts": {
            **artifact_record(retained_counts_path, "application/x-npy"),
            "dtype": "uint32",
            "shape": list(retained_counts_u32.shape),
            "semantics": "post_rejection_retained_before_fallback",
        },
        "eligible_counts": {
            **artifact_record(eligible_counts_path, "application/x-npy"),
            "dtype": "uint32",
            "shape": list(eligible_counts_u32.shape),
            "semantics": "geometrically_eligible_pre_rejection_observations",
        },
    }
    return outputs


def tool_record() -> dict[str, Any]:
    source_names = ["floor_atlas_build.py", "floor_atlas.py", "nadir_fill.py"]
    return {
        "name": "floor_atlas_build.py",
        "source_files": [
            artifact_record(SCRIPT_DIR / name, "text/x-python")
            for name in source_names
        ],
        "tested_requirements": artifact_record(
            SCRIPT_DIR / "requirements-floor-atlas-tested.txt", "text/plain"
        ),
        "run_schema": artifact_record(
            SCRIPT_DIR / "schemas" / "floor-atlas-run-v1.schema.json",
            "application/schema+json",
        ),
    }


def runtime_record() -> dict[str, Any]:
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "packages": {
            distribution: package_version(distribution)
            for distribution in (
                "numpy",
                "Pillow",
                "pye57",
                "scipy",
                "trimesh",
                "jsonschema",
            )
        },
    }


def validate_filename_segment(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value in {".", ".."}
        or Path(value).name != value
        or any(character in value for character in INVALID_FILENAME_CHARS)
        or value.endswith((" ", "."))
        or value.split(".", 1)[0].upper() in WINDOWS_RESERVED_STEMS
    ):
        raise ValueError(f"{label} must be one filename-safe segment")
    return value


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    validate_args(args)
    output_dir = Path(args.out).resolve()
    planned_outputs = planned_output_paths(output_dir, args.label)
    manifest_path = Path(args.manifest).resolve()
    equirect_dir = Path(args.equirect).resolve()
    mesh_path = Path(args.mesh).resolve() if args.mesh else None
    if not manifest_path.is_file():
        raise FileNotFoundError(f"manifest not found: {manifest_path}")
    if not equirect_dir.is_dir():
        raise FileNotFoundError(f"equirect directory not found: {equirect_dir}")
    if mesh_path is not None and not mesh_path.is_file():
        raise FileNotFoundError(f"mesh not found: {mesh_path}")
    manifest_record = artifact_record(manifest_path, "application/json")
    mesh_record = (
        artifact_record(mesh_path, "application/octet-stream")
        if mesh_path is not None
        else None
    )
    frozen_tool_record = tool_record()

    cx, cy, wm, hm = args.bounds
    width_px = int(round(wm * 1000.0 / args.mm_per_px))
    height_px = int(round(hm * 1000.0 / args.mm_per_px))
    if width_px < 1 or height_px < 1:
        raise ValueError("bounds must cover at least one atlas pixel per axis")
    effective_width_m = width_px * args.mm_per_px / 1000.0
    effective_height_m = height_px * args.mm_per_px / 1000.0
    grid = fa.AtlasGrid(
        origin_xy=(
            cx - effective_width_m / 2.0,
            cy - effective_height_m / 2.0,
        ),
        mm_per_px=args.mm_per_px,
        width=width_px,
        height=height_px,
    )
    print(f"atlas: {grid.width}x{grid.height} px @ {args.mm_per_px} mm/px "
          f"= {grid.width_m:.2f} x {grid.height_m:.2f} m", flush=True)

    nodes, node_source_format = load_nodes(manifest_path)
    storey_z, z_floor, z_derivation, source_selection_method, picks = select_sources(
        nodes, cx, cy, args
    )
    print(f"scanner z median (near region): {storey_z:.3f} -> z_floor {z_floor:.3f}",
          flush=True)
    print(f"fusing {len(picks)} sweeps (nearest {picks[0][1]} at {picks[0][0]:.1f} m, "
          f"farthest {picks[-1][1]} at {picks[-1][0]:.1f} m)", flush=True)

    panorama_records, panorama_paths = panorama_input_records(
        equirect_dir, picks, nodes, args.ss
    )
    frozen_input_paths = [
        manifest_path,
        *(record_path for record_path in panorama_paths.values()),
        *(
            [mesh_path]
            if mesh_path is not None
            else []
        ),
        *(
            Path(record["path"])
            for record in frozen_tool_record["source_files"]
        ),
        Path(frozen_tool_record["tested_requirements"]["path"]),
        Path(frozen_tool_record["run_schema"]["path"]),
    ]
    assert_outputs_disjoint_from_inputs(
        planned_outputs, frozen_input_paths, equirect_dir, output_dir
    )
    occluder = load_occluder(mesh_path)
    if args.align or args.harmonise:
        enabled = ", ".join(
            name
            for name, active in (
                ("alignment", args.align),
                ("harmonisation", args.harmonise),
            )
            if active
        )
        print(f"experimental opt-ins enabled: {enabled}", flush=True)

    # lazy loaders, not rasters: the 8192 tier is ~100 MB per sweep and
    # the two-pass fusion would otherwise need 40 of them resident twice
    sources = [
        ((lambda path=panorama_paths[node_id]: load_image(path)), nodes[node_id]["t"])
        for _distance, node_id in picks
    ]
    atlas, report = fa.accumulate_floor_atlas(
        sources,
        grid,
        z_floor=z_floor,
        occluder=occluder,
        z_exempt_m=Z_EXEMPT_M,
        self_blind_m=SELF_BLIND_M,
        max_incidence_deg=MAX_INCIDENCE_DEG,
        robust_sigma=ROBUST_SIGMA,
        specular_sigma=SPECULAR_SIGMA,
        min_robust_sources=MIN_ROBUST_SOURCES,
        align=args.align,
        harmonise=args.harmonise,
    )
    counts = report["contributor_counts"]
    retained_counts = report["retained_counts"]
    eligible_counts = report["eligible_counts"]
    assert_artifact_unchanged(manifest_record)
    if mesh_record is not None:
        assert_artifact_unchanged(mesh_record)
    for panorama_record in panorama_records:
        assert_artifact_unchanged(panorama_record)
    for source_record in frozen_tool_record["source_files"]:
        assert_artifact_unchanged(source_record)
    assert_artifact_unchanged(frozen_tool_record["tested_requirements"])
    assert_artifact_unchanged(frozen_tool_record["run_schema"])
    output_dir.mkdir(parents=True, exist_ok=True)
    if planned_output_paths(output_dir, args.label) != planned_outputs:
        raise RuntimeError("resolved output paths changed during run")
    outputs = write_outputs(
        planned_outputs, atlas, counts, retained_counts, eligible_counts
    )

    out = {
        "schema_version": SCHEMA_VERSION,
        "authority": "none",
        "provenance": {
            "source_truth_class": "unknown_unverified",
            "transform_class": "deterministic_multi_view_fusion",
            "transform_generated_content": False,
            "output_truth_class": "inferred_from_unverified_sources",
            "metric_use": "planning_grade_not_survey_truth",
        },
        "room": args.label,
        "mm_per_px": args.mm_per_px,
        "width_px": grid.width, "height_px": grid.height,
        "extent_m": [grid.width_m, grid.height_m],
        "origin_xy": [float(v) for v in grid.origin_xy],
        "z_floor": float(z_floor),
        "sources": [nid for _d, nid in picks],
        "covered_frac": report["covered_frac"],
        "rejected_frac": report["rejected_frac"],
        "mean_looks": report["mean_looks"],
        "max_looks": report["max_looks"],
        "eligible_mean_looks": report["eligible_mean_looks"],
        "eligible_max_looks": report["eligible_max_looks"],
        "eligible_sample_count": report["eligible_sample_count"],
        "retained_sample_count": report["retained_sample_count"],
        "rejected_sample_count": report["rejected_sample_count"],
        "fallback_px": report["fallback_px"],
        "ss": bool(args.ss),
        "alignment": {
            "enabled": bool(report["alignment_enabled"]),
            "convention": "effective_camera_z_equals_manifest_z_minus_dz",
            "estimates": [
                {"node_id": node_id, **estimate}
                for (_distance, node_id), estimate in zip(
                    picks, report["alignment_estimates"]
                )
            ],
        },
        "harmonisation": {
            "enabled": bool(report["harmonisation_enabled"]),
            "diagnostics": [
                {"node_id": node_id, **diagnostic}
                for (_distance, node_id), diagnostic in zip(
                    picks, report["harmonisation_diagnostics"]
                )
            ],
        },
        "parameters": {
            "bounds_centre_xy_m": [cx, cy],
            "bounds_size_m": [wm, hm],
            "effective_bounds_size_m": [grid.width_m, grid.height_m],
            "mm_per_px": args.mm_per_px,
            "ss": bool(args.ss),
            "radius_m": args.radius_m,
            "max_sources": args.max_sources,
            "source_selection": {
                "floor_id": args.floor_id,
                "requested_storey_z": args.storey_z,
                "effective_storey_z": storey_z,
                "storey_tolerance_m": args.storey_tolerance_m,
                "cluster_gap_m": STOREY_CLUSTER_GAP_M,
                "method": source_selection_method,
            },
            "z_floor_m": {
                "requested": args.z_floor,
                "effective": z_floor,
                "derivation": z_derivation,
                "storey_z": storey_z,
            },
            "self_blind_m": SELF_BLIND_M,
            "max_incidence_deg": MAX_INCIDENCE_DEG,
            "occlusion": {
                "enabled": mesh_path is not None,
                "mesh_voxel_m": MESH_VOXEL_M if mesh_path is not None else None,
                "z_exempt_m": Z_EXEMPT_M if mesh_path is not None else None,
            },
            "robust_sigma": ROBUST_SIGMA,
            "specular_sigma": SPECULAR_SIGMA,
            "min_robust_sources": MIN_ROBUST_SOURCES,
            "align": bool(args.align),
            "harmonise": bool(args.harmonise),
        },
        "inputs": {
            "manifest": manifest_record,
            "node_source_format": node_source_format,
            "mesh": mesh_record,
            "panoramas": panorama_records,
        },
        "outputs": outputs,
        "tool": frozen_tool_record,
        "runtime": runtime_record(),
    }
    out["integrity"] = {
        "scope": "report_object_excluding_integrity",
        "canonicalization": "python_json_sort_keys_compact_utf8_v1",
        "payload_sha256": canonical_json_sha256(out),
    }
    report_path = planned_outputs["report"]
    with report_path.open("w", encoding="utf8", newline="\n") as stream:
        json.dump(out, stream, indent=2, sort_keys=True)
        stream.write("\n")
    summary_keys = (
        "schema_version",
        "room",
        "covered_frac",
        "rejected_frac",
        "mean_looks",
        "max_looks",
        "fallback_px",
        "alignment",
        "harmonisation",
        "integrity",
    )
    print(json.dumps({key: out[key] for key in summary_keys}, indent=2))
    print(f"sources: {len(out['sources'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
