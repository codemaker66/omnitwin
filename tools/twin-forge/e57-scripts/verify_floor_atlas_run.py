"""Verify a Floor Atlas run report and every locally referenced artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from typing import Any

import numpy as np
from PIL import Image
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError


SCHEMA_VERSION = "omnitwin.floor-atlas.run.v1"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SCRIPT_DIR = Path(__file__).resolve().parent


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


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def verify_artifact(record: Any, label: str) -> Path:
    require(isinstance(record, dict), f"{label} must be an object")
    path_value = record.get("path")
    require(isinstance(path_value, str) and path_value, f"{label}.path missing")
    path = Path(path_value)
    require(path.is_absolute(), f"{label}.path must be absolute: {path}")
    require(path.is_file(), f"{label} missing: {path}")
    require(record.get("filename") == path.name, f"{label}.filename mismatch")
    size = record.get("size_bytes")
    require(isinstance(size, int) and size >= 0, f"{label}.size_bytes invalid")
    actual_size = path.stat().st_size
    require(
        actual_size == size,
        f"{label} size mismatch: expected {size}, got {actual_size}: {path}",
    )
    expected = record.get("sha256")
    require(
        isinstance(expected, str) and SHA256_PATTERN.fullmatch(expected) is not None,
        f"{label}.sha256 invalid",
    )
    actual = sha256_file(path)
    require(actual == expected, f"{label} SHA-256 mismatch: {expected} -> {actual}")
    media_type = record.get("media_type")
    require(
        isinstance(media_type, str) and media_type,
        f"{label}.media_type missing",
    )
    return path


def require_physical_paths_distinct(paths: list[Path], label: str) -> None:
    for index, left in enumerate(paths):
        for right in paths[index + 1 :]:
            require(
                not os.path.samefile(left, right),
                f"{label} alias the same physical file: {left} / {right}",
            )


def verify_report_digest(report: dict[str, Any]) -> None:
    integrity = report.get("integrity")
    require(isinstance(integrity, dict), "integrity must be an object")
    require(
        integrity.get("scope") == "report_object_excluding_integrity",
        "integrity scope mismatch",
    )
    require(
        integrity.get("canonicalization")
        == "python_json_sort_keys_compact_utf8_v1",
        "integrity canonicalization mismatch",
    )
    claimed = integrity.get("payload_sha256")
    require(
        isinstance(claimed, str) and SHA256_PATTERN.fullmatch(claimed) is not None,
        "integrity.payload_sha256 invalid",
    )
    digest_payload = dict(report)
    del digest_payload["integrity"]
    actual = canonical_json_sha256(digest_payload)
    require(actual == claimed, f"report digest mismatch: {claimed} -> {actual}")


def linked_schema_path(report: dict[str, Any]) -> Path:
    tool = report.get("tool")
    require(isinstance(tool, dict), "tool must be an object")
    schema_record = tool.get("run_schema")
    require(
        isinstance(schema_record, dict)
        and schema_record.get("media_type") == "application/schema+json",
        "tool.run_schema media_type mismatch",
    )
    path = verify_artifact(schema_record, "tool.run_schema")
    require(
        path.name == "floor-atlas-run-v1.schema.json",
        "tool.run_schema filename mismatch",
    )
    return path


def validate_report_schema(report: dict[str, Any], schema_path: Path) -> None:
    schema = json.loads(schema_path.read_text(encoding="utf8"))
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema).iter_errors(report),
        key=lambda error: [str(part) for part in error.absolute_path],
    )
    if errors:
        first = errors[0]
        location = ".".join(str(part) for part in first.absolute_path) or "$"
        raise ValueError(f"schema validation failed at {location}: {first.message}")


def verify_truth_classification(report: dict[str, Any]) -> None:
    require(report.get("schema_version") == SCHEMA_VERSION, "schema_version mismatch")
    require(report.get("authority") == "none", "authority must be none")
    require(
        report.get("provenance")
        == {
            "source_truth_class": "unknown_unverified",
            "transform_class": "deterministic_multi_view_fusion",
            "transform_generated_content": False,
            "output_truth_class": "inferred_from_unverified_sources",
            "metric_use": "planning_grade_not_survey_truth",
        },
        "provenance classification mismatch",
    )


def verify_tool_artifacts(report: dict[str, Any]) -> None:
    tool = report.get("tool")
    require(isinstance(tool, dict), "tool must be an object")
    require(tool.get("name") == "floor_atlas_build.py", "tool.name mismatch")
    source_files = tool.get("source_files")
    require(isinstance(source_files, list) and source_files, "tool sources missing")
    require(
        [record.get("filename") for record in source_files]
        == ["floor_atlas_build.py", "floor_atlas.py", "nadir_fill.py"],
        "tool source filenames/order mismatch",
    )
    for index, record in enumerate(source_files):
        require(
            record.get("media_type") == "text/x-python",
            f"tool.source_files[{index}] media_type mismatch",
        )
        path = verify_artifact(record, f"tool.source_files[{index}]")
        require(
            path.resolve() == (SCRIPT_DIR / record["filename"]).resolve(),
            f"tool.source_files[{index}] is not the verifier-adjacent source",
        )
    requirements_record = tool.get("tested_requirements")
    require(
        isinstance(requirements_record, dict)
        and requirements_record.get("media_type") == "text/plain",
        "tool.tested_requirements media_type mismatch",
    )
    requirements_path = verify_artifact(
        requirements_record, "tool.tested_requirements"
    )
    require(
        requirements_path.name == "requirements-floor-atlas-tested.txt",
        "tool.tested_requirements filename mismatch",
    )
    require(
        requirements_path.resolve()
        == (SCRIPT_DIR / "requirements-floor-atlas-tested.txt").resolve(),
        "tool.tested_requirements is not verifier-adjacent",
    )
    schema_record = tool.get("run_schema")
    require(
        isinstance(schema_record, dict)
        and schema_record.get("media_type") == "application/schema+json",
        "tool.run_schema media_type mismatch",
    )
    schema_path = verify_artifact(schema_record, "tool.run_schema")
    require(
        schema_path.name == "floor-atlas-run-v1.schema.json",
        "tool.run_schema filename mismatch",
    )
    require(
        schema_path.resolve()
        == (SCRIPT_DIR / "schemas" / "floor-atlas-run-v1.schema.json").resolve(),
        "tool.run_schema is not verifier-adjacent",
    )


def verify_inputs(
    report: dict[str, Any],
) -> tuple[Path, dict[str, dict[str, Any]]]:
    inputs = report.get("inputs")
    require(isinstance(inputs, dict), "inputs must be an object")
    manifest_record = inputs.get("manifest")
    require(
        isinstance(manifest_record, dict)
        and manifest_record.get("media_type") == "application/json",
        "inputs.manifest media_type mismatch",
    )
    manifest_path = verify_artifact(manifest_record, "inputs.manifest")
    mesh = inputs.get("mesh")
    if mesh is not None:
        require(
            mesh.get("media_type") == "application/octet-stream",
            "inputs.mesh media_type mismatch",
        )
        verify_artifact(mesh, "inputs.mesh")
    panoramas = inputs.get("panoramas")
    require(isinstance(panoramas, list) and panoramas, "input panoramas missing")

    node_source_format = inputs.get("node_source_format")
    require(
        node_source_format
        in {"forged_bundle_manifest_v1", "legacy_pose_map_v1"},
        "inputs.node_source_format invalid",
    )
    from floor_atlas_build import load_nodes

    nodes, actual_source_format = load_nodes(manifest_path)
    require(
        actual_source_format == node_source_format,
        "inputs.node_source_format does not match manifest adapter",
    )
    source_ids = report.get("sources")
    require(isinstance(source_ids, list), "sources must be an array")
    require(
        source_ids == [record.get("node_id") for record in panoramas],
        "source order does not match panorama records",
    )
    panorama_paths = []
    for index, record in enumerate(panoramas):
        require(
            record.get("media_type") == "image/jpeg",
            f"inputs.panoramas[{index}] media_type mismatch",
        )
        path = verify_artifact(record, f"inputs.panoramas[{index}]")
        panorama_paths.append(path)
        node_id = record.get("node_id")
        require(node_id in nodes, f"panorama node absent from manifest: {node_id}")
        require(
            record.get("pose_t_m")
            == [float(value) for value in nodes[node_id]["t"]],
            f"panorama pose does not match manifest: {node_id}",
        )
        with Image.open(path) as image:
            actual_dimensions = [image.width, image.height]
            require(
                image.format == "JPEG",
                f"panorama container is not JPEG: {node_id}",
            )
        require(
            actual_dimensions
            == [record.get("width_px"), record.get("height_px")],
            f"panorama dimensions mismatch: {node_id}",
        )
    require_physical_paths_distinct(
        panorama_paths, "selected panorama artifacts"
    )
    return manifest_path, nodes


def verify_outputs(report: dict[str, Any]) -> None:
    outputs = report.get("outputs")
    require(isinstance(outputs, dict), "outputs must be an object")
    atlas_path = verify_artifact(outputs.get("atlas"), "outputs.atlas")
    coverage_path = verify_artifact(
        outputs.get("coverage_preview"), "outputs.coverage_preview"
    )
    counts_path = verify_artifact(outputs.get("counts"), "outputs.counts")
    retained_counts_path = verify_artifact(
        outputs.get("retained_counts"), "outputs.retained_counts"
    )
    eligible_counts_path = verify_artifact(
        outputs.get("eligible_counts"), "outputs.eligible_counts"
    )

    width = report.get("width_px")
    height = report.get("height_px")
    require(
        isinstance(width, int) and width > 0 and isinstance(height, int) and height > 0,
        "reported raster dimensions invalid",
    )
    with Image.open(atlas_path) as atlas:
        require(atlas.size == (width, height), "atlas dimensions mismatch")
        require(atlas.mode == "RGB", f"atlas mode mismatch: {atlas.mode}")
        require(atlas.format == "PNG", f"atlas container mismatch: {atlas.format}")
        atlas_pixels = np.asarray(atlas, dtype=np.uint8)
    with Image.open(coverage_path) as coverage:
        require(coverage.size == (width, height), "coverage dimensions mismatch")
        require(coverage.mode == "L", f"coverage mode mismatch: {coverage.mode}")
        require(
            coverage.format == "PNG",
            f"coverage container mismatch: {coverage.format}",
        )
        coverage_pixels = np.asarray(coverage, dtype=np.uint8)

    require(
        outputs["atlas"].get("shape") == [height, width, 3],
        "atlas output shape declaration mismatch",
    )
    require(
        outputs["atlas"].get("dtype") == "uint8",
        "atlas output dtype declaration mismatch",
    )
    require(
        outputs["coverage_preview"].get("shape") == [height, width],
        "coverage output shape declaration mismatch",
    )
    require(
        outputs["coverage_preview"].get("dtype") == "uint8",
        "coverage output dtype declaration mismatch",
    )

    counts = np.load(counts_path, allow_pickle=False)
    retained_counts = np.load(retained_counts_path, allow_pickle=False)
    eligible_counts = np.load(eligible_counts_path, allow_pickle=False)
    require(counts.dtype == np.uint32, f"counts dtype mismatch: {counts.dtype}")
    require(counts.shape == (height, width), f"counts shape mismatch: {counts.shape}")
    require(
        retained_counts.dtype == np.uint32,
        f"retained counts dtype mismatch: {retained_counts.dtype}",
    )
    require(
        retained_counts.shape == (height, width),
        f"retained counts shape mismatch: {retained_counts.shape}",
    )
    require(
        eligible_counts.dtype == np.uint32,
        f"eligible counts dtype mismatch: {eligible_counts.dtype}",
    )
    require(
        eligible_counts.shape == (height, width),
        f"eligible counts shape mismatch: {eligible_counts.shape}",
    )
    source_count = len(report["sources"])
    require(
        int(counts.max(initial=0)) <= source_count
        and int(retained_counts.max(initial=0)) <= source_count
        and int(eligible_counts.max(initial=0)) <= source_count,
        "sample count exceeds the number of selected sources",
    )
    require(
        np.all(retained_counts <= eligible_counts),
        "retained counts exceed eligible counts",
    )
    fallback = (eligible_counts > 0) & (retained_counts == 0)
    expected_counts = retained_counts.copy()
    expected_counts[fallback] = eligible_counts[fallback]
    require(
        np.array_equal(counts, expected_counts),
        "contributor counts do not match retained/fallback semantics",
    )
    require(
        np.all(atlas_pixels[counts == 0] == 0),
        "atlas contains RGB values without contributor support",
    )
    require(
        outputs["counts"].get("dtype") == "uint32",
        "counts output dtype declaration mismatch",
    )
    require(
        outputs["counts"].get("shape") == [height, width],
        "counts output shape declaration mismatch",
    )
    require(
        outputs["counts"].get("semantics")
        == "post_rejection_contributors_with_fallback_restored",
        "counts output semantics mismatch",
    )
    require(
        outputs["retained_counts"].get("dtype") == "uint32",
        "retained counts output dtype declaration mismatch",
    )
    require(
        outputs["retained_counts"].get("shape") == [height, width],
        "retained counts output shape declaration mismatch",
    )
    require(
        outputs["retained_counts"].get("semantics")
        == "post_rejection_retained_before_fallback",
        "retained counts output semantics mismatch",
    )
    require(
        outputs["eligible_counts"].get("dtype") == "uint32",
        "eligible counts output dtype declaration mismatch",
    )
    require(
        outputs["eligible_counts"].get("shape") == [height, width],
        "eligible counts output shape declaration mismatch",
    )
    require(
        outputs["eligible_counts"].get("semantics")
        == "geometrically_eligible_pre_rejection_observations",
        "eligible counts output semantics mismatch",
    )
    require(
        int(counts.max(initial=0)) == report.get("max_looks"),
        "max_looks does not match counts raster",
    )
    require(
        int(eligible_counts.max(initial=0)) == report.get("eligible_max_looks"),
        "eligible_max_looks does not match eligible counts raster",
    )
    contributor_observed = counts > 0
    eligible_observed = eligible_counts > 0
    covered_fraction = float((counts > 0).mean())
    require(
        abs(covered_fraction - float(report.get("covered_frac"))) <= 1e-12,
        "covered_frac does not match counts raster",
    )
    mean_looks = (
        float(counts[contributor_observed].mean())
        if contributor_observed.any()
        else 0.0
    )
    eligible_mean_looks = (
        float(eligible_counts[eligible_observed].mean())
        if eligible_observed.any()
        else 0.0
    )
    require(
        abs(mean_looks - float(report.get("mean_looks"))) <= 1e-12,
        "mean_looks does not match counts raster",
    )
    require(
        abs(eligible_mean_looks - float(report.get("eligible_mean_looks")))
        <= 1e-12,
        "eligible_mean_looks does not match eligible counts raster",
    )
    eligible_sample_count = int(eligible_counts.sum(dtype=np.uint64))
    retained_sample_count = int(retained_counts.sum(dtype=np.uint64))
    rejected_sample_count = eligible_sample_count - retained_sample_count
    require(
        report.get("eligible_sample_count") == eligible_sample_count,
        "eligible_sample_count does not match eligible counts raster",
    )
    require(
        report.get("retained_sample_count") == retained_sample_count,
        "retained_sample_count does not match retained counts raster",
    )
    require(
        report.get("rejected_sample_count") == rejected_sample_count,
        "rejected_sample_count does not match retained/eligible rasters",
    )
    expected_rejected_fraction = (
        rejected_sample_count / eligible_sample_count
        if eligible_sample_count
        else 0.0
    )
    require(
        abs(expected_rejected_fraction - float(report.get("rejected_frac")))
        <= 1e-12,
        "rejected_frac does not match retained/eligible rasters",
    )
    require(
        report.get("fallback_px") == int(fallback.sum()),
        "fallback_px does not match retained/eligible rasters",
    )
    expected_coverage = (np.clip(counts, 0, 12) / 12.0 * 255).astype(np.uint8)
    require(
        np.array_equal(coverage_pixels, expected_coverage),
        "coverage preview does not match contributor counts",
    )


def verify_effective_contract(
    report: dict[str, Any], nodes: dict[str, dict[str, Any]]
) -> None:
    from types import SimpleNamespace

    import floor_atlas_build as build

    parameters = report.get("parameters")
    require(isinstance(parameters, dict), "parameters must be an object")
    require(
        float(report["mm_per_px"]) == float(parameters["mm_per_px"]),
        "top-level mm_per_px does not match effective parameter",
    )
    require(
        report["ss"] == parameters["ss"],
        "top-level ss does not match effective parameter",
    )
    require(
        float(report["z_floor"]) == float(parameters["z_floor_m"]["effective"]),
        "top-level z_floor does not match effective parameter",
    )

    constants = {
        "self_blind_m": build.SELF_BLIND_M,
        "max_incidence_deg": build.MAX_INCIDENCE_DEG,
        "robust_sigma": build.ROBUST_SIGMA,
        "specular_sigma": build.SPECULAR_SIGMA,
        "min_robust_sources": build.MIN_ROBUST_SOURCES,
    }
    for key, expected in constants.items():
        require(
            parameters.get(key) == expected,
            f"parameters.{key} does not match bound tool constant",
        )

    centre = np.asarray(parameters["bounds_centre_xy_m"], dtype=np.float64)
    requested_size = np.asarray(parameters["bounds_size_m"], dtype=np.float64)
    effective_size = np.asarray(
        parameters["effective_bounds_size_m"], dtype=np.float64
    )
    mm_per_px = float(parameters["mm_per_px"])
    expected_width = int(round(requested_size[0] * 1000.0 / mm_per_px))
    expected_height = int(round(requested_size[1] * 1000.0 / mm_per_px))
    require(
        [expected_width, expected_height]
        == [report["width_px"], report["height_px"]],
        "raster dimensions do not match requested bounds and mm_per_px",
    )
    expected_effective_size = np.array(
        [expected_width * mm_per_px / 1000.0, expected_height * mm_per_px / 1000.0]
    )
    require(
        np.allclose(effective_size, expected_effective_size, rtol=0.0, atol=1e-12),
        "effective_bounds_size_m mismatch",
    )
    require(
        np.allclose(
            np.asarray(report["extent_m"], dtype=np.float64),
            expected_effective_size,
            rtol=0.0,
            atol=1e-12,
        ),
        "extent_m mismatch",
    )
    expected_origin = centre - expected_effective_size / 2.0
    require(
        np.allclose(
            np.asarray(report["origin_xy"], dtype=np.float64),
            expected_origin,
            rtol=0.0,
            atol=1e-12,
        ),
        "origin_xy does not preserve the requested bounds centre",
    )

    source_selection = parameters["source_selection"]
    require(
        source_selection["cluster_gap_m"] == build.STOREY_CLUSTER_GAP_M,
        "source-selection cluster gap does not match bound tool constant",
    )
    z_floor_record = parameters["z_floor_m"]
    selection_args = SimpleNamespace(
        radius_m=parameters["radius_m"],
        floor_id=source_selection["floor_id"],
        storey_z=source_selection["requested_storey_z"],
        storey_tolerance_m=source_selection["storey_tolerance_m"],
        z_floor=z_floor_record["requested"],
        max_sources=parameters["max_sources"],
    )
    storey_z, z_floor, derivation, method, picks = build.select_sources(
        nodes, float(centre[0]), float(centre[1]), selection_args
    )
    require(
        abs(storey_z - float(source_selection["effective_storey_z"])) <= 1e-12,
        "effective_storey_z does not reproduce",
    )
    require(
        abs(storey_z - float(z_floor_record["storey_z"])) <= 1e-12,
        "z_floor_m.storey_z does not reproduce",
    )
    require(abs(z_floor - float(z_floor_record["effective"])) <= 1e-12,
            "effective z-floor does not reproduce")
    require(z_floor_record["derivation"] == derivation,
            "z-floor derivation does not reproduce")
    require(source_selection["method"] == method,
            "source-selection method does not reproduce")
    expected_sources = [node_id for _distance, node_id in picks]
    require(report["sources"] == expected_sources,
            "selected sources do not reproduce from inputs and parameters")
    panoramas = report["inputs"]["panoramas"]
    suffix = "_8192.jpg" if report["ss"] else ".jpg"
    for (expected_distance, node_id), record in zip(picks, panoramas):
        require(
            abs(float(record["distance_m"]) - expected_distance) <= 1e-12,
            f"panorama distance does not reproduce: {node_id}",
        )
        require(
            Path(record["path"]).name == f"{node_id}{suffix}",
            f"panorama tier/filename mismatch: {node_id}",
        )

    mesh_present = report["inputs"]["mesh"] is not None
    occlusion = parameters["occlusion"]
    require(
        occlusion["enabled"] == mesh_present,
        "occlusion.enabled does not match mesh presence",
    )
    if mesh_present:
        require(
            occlusion["mesh_voxel_m"] == build.MESH_VOXEL_M
            and occlusion["z_exempt_m"] == build.Z_EXEMPT_M,
            "occlusion parameters do not match bound tool constants",
        )
    else:
        require(
            occlusion["mesh_voxel_m"] is None
            and occlusion["z_exempt_m"] is None,
            "disabled occlusion parameters must be null",
        )

    room = report["room"]
    expected_output_names = {
        "atlas": f"{room}-atlas.png",
        "coverage_preview": f"{room}-coverage.png",
        "counts": f"{room}-counts.npy",
        "retained_counts": f"{room}-retained-counts.npy",
        "eligible_counts": f"{room}-eligible-counts.npy",
    }
    for role, filename in expected_output_names.items():
        require(
            report["outputs"][role]["filename"] == filename,
            f"outputs.{role}.filename mismatch",
        )


def verify_artifact_path_disjointness(
    report: dict[str, Any], report_path: Path
) -> None:
    output_paths = [
        Path(record["path"])
        for record in report["outputs"].values()
    ]
    output_paths.append(report_path)
    protected_records = [report["inputs"]["manifest"]]
    if report["inputs"]["mesh"] is not None:
        protected_records.append(report["inputs"]["mesh"])
    protected_records.extend(report["inputs"]["panoramas"])
    protected_records.extend(report["tool"]["source_files"])
    protected_records.extend(
        [report["tool"]["tested_requirements"], report["tool"]["run_schema"]]
    )
    protected_paths = [Path(record["path"]) for record in protected_records]
    require_physical_paths_distinct(output_paths, "declared output artifacts")
    for output_path in output_paths:
        for protected_path in protected_paths:
            require(
                not os.path.samefile(output_path, protected_path),
                "declared output aliases an input/tool artifact: "
                f"{output_path} / {protected_path}",
            )


def verify_alignment_cardinality(report: dict[str, Any]) -> None:
    alignment = report.get("alignment")
    harmonisation = report.get("harmonisation")
    parameters = report.get("parameters")
    require(isinstance(alignment, dict), "alignment must be an object")
    require(isinstance(harmonisation, dict), "harmonisation must be an object")
    require(isinstance(parameters, dict), "parameters must be an object")
    sources = report.get("sources")
    require(isinstance(sources, list), "sources must be an array")
    estimates = alignment.get("estimates")
    require(isinstance(estimates, list), "alignment.estimates must be an array")
    require(len(estimates) == len(sources), "alignment estimate count mismatch")
    require(
        [estimate.get("node_id") for estimate in estimates] == sources,
        "alignment estimates do not match source order",
    )
    require(
        alignment.get("convention")
        == "effective_camera_z_equals_manifest_z_minus_dz",
        "alignment convention mismatch",
    )
    alignment_enabled = alignment.get("enabled")
    for index, estimate in enumerate(estimates):
        dz = estimate.get("dz_m")
        require(
            isinstance(dz, (int, float)) and abs(float(dz)) <= 0.0300001,
            f"alignment.estimates[{index}].dz_m out of range",
        )
        require(
            isinstance(estimate.get("status"), str),
            f"alignment.estimates[{index}].status missing",
        )
        require(
            isinstance(estimate.get("accepted"), bool),
            f"alignment.estimates[{index}].accepted missing",
        )
        status = estimate["status"]
        accepted = estimate["accepted"]
        require(
            accepted == (status in {"zero_best", "shift_accepted"}),
            f"alignment.estimates[{index}] accepted/status contradiction",
        )
        require(
            estimate["boundary_hit"] == (status == "best_at_search_boundary"),
            f"alignment.estimates[{index}] boundary/status contradiction",
        )
        if not alignment_enabled:
            require(status == "disabled", "disabled alignment has active estimate")
            require(
                dz == 0.0
                and estimate["valid_pixels"] == 0
                and all(
                    estimate[key] is None
                    for key in (
                        "zero_score",
                        "best_score",
                        "score_gain",
                        "peak_margin",
                    )
                ),
                f"alignment.estimates[{index}] disabled state is not neutral",
            )
            continue
        require(status != "disabled", "enabled alignment has disabled estimate")
        if status == "insufficient_fixed_support":
            require(
                estimate["valid_pixels"] < 200,
                f"alignment.estimates[{index}] support refusal contradiction",
            )
        if status == "zero_candidate_unscorable":
            require(
                estimate["valid_pixels"] >= 200,
                f"alignment.estimates[{index}] zero-score refusal contradiction",
            )
        if status in {
            "insufficient_fixed_support",
            "zero_candidate_unscorable",
        }:
            require(
                dz == 0.0
                and all(
                    estimate[key] is None
                    for key in (
                        "zero_score",
                        "best_score",
                        "score_gain",
                        "peak_margin",
                    )
                ),
                f"alignment.estimates[{index}] refusal is not neutral",
            )
            continue
        require(
            estimate["valid_pixels"] >= 200,
            f"alignment.estimates[{index}] scored state lacks support",
        )
        for field in ("zero_score", "best_score", "score_gain"):
            require(
                isinstance(estimate[field], (int, float)),
                f"alignment.estimates[{index}].{field} must be numeric",
            )
        zero_score = float(estimate["zero_score"])
        best_score = float(estimate["best_score"])
        score_gain = float(estimate["score_gain"])
        peak_margin = estimate["peak_margin"]
        require(
            peak_margin is None or isinstance(peak_margin, (int, float)),
            f"alignment.estimates[{index}].peak_margin invalid",
        )
        require(
            score_gain >= 0.0
            and (peak_margin is None or float(peak_margin) >= 0.0),
            f"alignment.estimates[{index}] gain/margin must be nonnegative",
        )
        require(
            abs((best_score - zero_score) - score_gain) <= 1e-12,
            f"alignment.estimates[{index}] score gain mismatch",
        )
        if status == "zero_best":
            require(
                dz == 0.0 and abs(score_gain) <= 1e-12,
                f"alignment.estimates[{index}] zero-best contradiction",
            )
        elif status == "shift_accepted":
            require(
                dz != 0.0
                and abs(dz) < 0.03
                and abs(dz / 0.003 - round(dz / 0.003)) <= 1e-9
                and score_gain >= 0.002
                and peak_margin is not None
                and float(peak_margin) >= 0.0005,
                f"alignment.estimates[{index}] accepted shift contradiction",
            )
        elif status == "insufficient_score_gain":
            require(
                dz == 0.0 and score_gain < 0.002,
                f"alignment.estimates[{index}] score-gain refusal contradiction",
            )
        elif status == "ambiguous_peak":
            require(
                dz == 0.0
                and score_gain >= 0.002
                and (peak_margin is None or float(peak_margin) < 0.0005),
                f"alignment.estimates[{index}] ambiguity refusal contradiction",
            )
        else:
            require(
                dz == 0.0,
                f"alignment.estimates[{index}] refused shift must be zero",
            )
    require(
        alignment.get("enabled") == parameters.get("align"),
        "alignment option mismatch",
    )
    require(
        harmonisation.get("enabled") == parameters.get("harmonise"),
        "harmonisation option mismatch",
    )
    diagnostics = harmonisation.get("diagnostics")
    require(isinstance(diagnostics, list), "harmonisation diagnostics missing")
    if harmonisation.get("enabled"):
        require(
            [item.get("node_id") for item in diagnostics] == sources,
            "harmonisation diagnostics do not match source order",
        )
        for index, diagnostic in enumerate(diagnostics):
            channels = diagnostic.get("channels")
            require(
                isinstance(channels, list)
                and [channel.get("channel") for channel in channels]
                == ["r", "g", "b"],
                f"harmonisation diagnostics[{index}] channel order mismatch",
            )
            channel_bin_counts = []
            for channel in channels:
                curve = channel.get("gain_curve")
                require(
                    isinstance(curve, list)
                    and len(curve) == 24
                    and all(0.65 <= float(value) <= 1.55 for value in curve),
                    f"harmonisation diagnostics[{index}] gain curve invalid",
                )
                require(
                    abs(float(channel["gain_min"]) - min(curve)) <= 1e-12
                    and abs(float(channel["gain_max"]) - max(curve)) <= 1e-12,
                    f"harmonisation diagnostics[{index}] gain range mismatch",
                )
                bin_counts = channel.get("bin_counts")
                require(
                    isinstance(bin_counts, list)
                    and len(bin_counts) == 24
                    and all(isinstance(value, int) and value >= 0 for value in bin_counts),
                    f"harmonisation diagnostics[{index}] bin counts invalid",
                )
                require(
                    sum(bin_counts) == diagnostic["valid_pixels"],
                    f"harmonisation diagnostics[{index}] bin counts do not total",
                )
                supported = [value >= 40 for value in bin_counts]
                require(
                    channel["supported_bins"] == sum(supported),
                    f"harmonisation diagnostics[{index}] supported-bin count mismatch",
                )
                require(
                    all(
                        is_supported or float(gain) == 1.0
                        for is_supported, gain in zip(supported, curve)
                    ),
                    f"harmonisation diagnostics[{index}] unsupported bin is non-neutral",
                )
                channel_bin_counts.append(bin_counts)
            require(
                channel_bin_counts[0]
                == channel_bin_counts[1]
                == channel_bin_counts[2],
                f"harmonisation diagnostics[{index}] RGB bin support differs",
            )
    else:
        require(not diagnostics, "disabled harmonisation must have no diagnostics")


def verify_floor_atlas_run(report_path: Path) -> None:
    report = json.loads(report_path.read_text(encoding="utf8"))
    require(isinstance(report, dict), "run report must be a JSON object")
    schema_path = linked_schema_path(report)
    validate_report_schema(report, schema_path)
    verify_report_digest(report)
    verify_truth_classification(report)
    verify_tool_artifacts(report)
    verify_alignment_cardinality(report)
    _manifest_path, nodes = verify_inputs(report)
    verify_effective_contract(report, nodes)
    verify_outputs(report)
    verify_artifact_path_disjointness(report, report_path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    args = parser.parse_args(argv)
    try:
        verify_floor_atlas_run(args.report.resolve())
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        SchemaError,
        json.JSONDecodeError,
    ) as exc:
        print(f"FAIL_FLOOR_ATLAS_RUN_INTEGRITY: {exc}", file=sys.stderr)
        return 1
    print("PASS_FLOOR_ATLAS_RUN_INTEGRITY")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
