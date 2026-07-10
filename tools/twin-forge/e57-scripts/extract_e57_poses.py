"""Extract E57 data3D poses into a provenance-anchored Twin Forge input.

The operation reads only E57 headers, writes to a new directory outside the
immutable capture stage, and can compare an existing Twin manifest without
trusting or modifying that bundle.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any

import pye57
from pye57.__version__ import __version__ as PYE57_VERSION

from e57_stage_guard import (
    assert_disjoint_output,
    canonical_json_sha256,
    load_stage,
    require_finite_vector,
    sha256_file,
    verify_stage_file,
)


POSE_SCHEMA_VERSION = "venviewer.e57-poses.v1"


def _compare_manifest(path: Path, poses: dict[str, dict[str, list[float]]]) -> dict[str, Any]:
    resolved = path.expanduser().resolve(strict=True)
    raw = json.loads(resolved.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not isinstance(raw.get("nodes"), list):
        raise ValueError("comparison Twin manifest must contain a nodes array")
    nodes = raw["nodes"]
    mismatches: list[dict[str, Any]] = []
    max_quaternion_delta = 0.0
    max_translation_delta = 0.0
    for index, pose in enumerate(poses.values()):
        if index >= len(nodes) or not isinstance(nodes[index], dict):
            mismatches.append({"index": index, "reason": "missing_node"})
            continue
        node = nodes[index]
        expected_id = f"scan_{index:03d}"
        if node.get("index") != index or node.get("id") != expected_id:
            mismatches.append({"index": index, "reason": "identity"})
            continue
        node_pose = node.get("pose")
        if not isinstance(node_pose, dict):
            mismatches.append({"index": index, "reason": "pose_shape"})
            continue
        try:
            manifest_q = require_finite_vector(node_pose.get("q", []), 4, "manifest quaternion")
            manifest_t = require_finite_vector(node_pose.get("t", []), 3, "manifest translation")
        except (TypeError, ValueError):
            mismatches.append({"index": index, "reason": "pose_shape"})
            continue
        q_delta = max(abs(a - b) for a, b in zip(pose["rotation"], manifest_q))
        t_delta = max(abs(a - b) for a, b in zip(pose["translation"], manifest_t))
        max_quaternion_delta = max(max_quaternion_delta, q_delta)
        max_translation_delta = max(max_translation_delta, t_delta)
        if q_delta != 0.0 or t_delta != 0.0:
            mismatches.append(
                {
                    "index": index,
                    "reason": "pose_value",
                    "maxQuaternionAbsDelta": q_delta,
                    "maxTranslationAbsDeltaM": t_delta,
                }
            )
    if len(nodes) != len(poses):
        mismatches.append(
            {
                "reason": "node_count",
                "expected": len(poses),
                "actual": len(nodes),
            }
        )
    return {
        "manifestPath": str(resolved),
        "manifestSha256": sha256_file(resolved),
        "trusted": False,
        "nodeCount": len(nodes),
        "identityAndPoseMatch": not mismatches,
        "mismatchCount": len(mismatches),
        "maxQuaternionAbsDelta": max_quaternion_delta,
        "maxTranslationAbsDeltaM": max_translation_delta,
        "firstMismatches": mismatches[:20],
        "limitation": "Pose equality does not validate the bundle's derived imagery, mesh, hashes, QA, signing, or exposure status.",
    }


def _extract_poses(e57_path: Path) -> tuple[dict[str, dict[str, list[float]]], list[str]]:
    capture = pye57.E57(str(e57_path))
    poses: dict[str, dict[str, list[float]]] = {}
    guids: list[str] = []
    for index in range(capture.scan_count):
        header = capture.get_header(index)
        rotation = require_finite_vector(header.rotation, 4, f"scan {index} rotation")
        translation = require_finite_vector(header.translation, 3, f"scan {index} translation")
        norm = math.sqrt(sum(component * component for component in rotation))
        if abs(norm - 1.0) > 1e-5:
            raise ValueError(f"scan {index} quaternion is not normalized: {norm}")
        guid = str(header.guid)
        if not guid:
            raise ValueError(f"scan {index} has no data3D guid")
        guids.append(guid)
        poses[str(index)] = {"rotation": rotation, "translation": translation}
    if len(guids) != len(set(guids)):
        raise ValueError("E57 data3D guids must be unique")
    return poses, guids


def _write_json(path: Path, value: Any) -> None:
    content = json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True, help="verified capture stage root")
    parser.add_argument("--out", required=True, help="new, disjoint output directory")
    parser.add_argument(
        "--verify-source-hash",
        action="store_true",
        help="re-read and SHA-256 the staged E57 before extracting poses",
    )
    parser.add_argument(
        "--compare-manifest",
        default="",
        help="optional existing Twin manifest to compare as untrusted evidence",
    )
    args = parser.parse_args(argv)

    stage = load_stage(Path(args.stage))
    output = assert_disjoint_output(Path(args.out), [stage.root])
    if output.exists():
        raise ValueError(f"refusing to replace an existing pose artifact: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    if args.verify_source_hash:
        verify_stage_file(stage.primary_e57)

    poses, guids = _extract_poses(stage.primary_e57.path)
    comparison = (
        _compare_manifest(Path(args.compare_manifest), poses)
        if args.compare_manifest
        else None
    )
    report = {
        "schemaVersion": POSE_SCHEMA_VERSION,
        "captureStage": {
            "root": str(stage.root),
            "planSha256": stage.plan_sha256,
            "manifestSha256": sha256_file(stage.manifest_path),
        },
        "sourceE57": {
            "targetRelativePath": stage.primary_e57.target_relative_path,
            "sizeBytes": stage.primary_e57.size_bytes,
            "sha256": stage.primary_e57.sha256,
            "hashVerifiedThisRun": bool(args.verify_source_hash),
        },
        "extractor": {"name": "pye57", "version": PYE57_VERSION},
        "coordinateConvention": "E57 data3D pose; quaternion [w,x,y,z], translation [x,y,z] metres, Z-up",
        "scanCount": len(poses),
        "poseSha256": canonical_json_sha256(poses),
        "data3DGuidSha256": canonical_json_sha256(guids),
        "comparison": comparison,
        "promotionStatus": "candidate_only",
        "limitations": [
            "Header pose extraction does not validate point geometry, imagery orientation, mesh alignment, or runtime suitability.",
            "This artifact is unsigned and must not be used to close T-091 or enable public exposure.",
        ],
    }

    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}.stage-", dir=output.parent))
    try:
        _write_json(temporary / "poses.json", poses)
        _write_json(temporary / "pose-evidence.json", report)
        os.replace(temporary, output)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    print(
        f"pose extraction complete: {len(poses)} scans, pose SHA-256 {report['poseSha256']}, output {output}"
    )
    if comparison is not None:
        print(
            "comparison: "
            f"match={comparison['identityAndPoseMatch']} mismatches={comparison['mismatchCount']} "
            f"max_translation_delta_m={comparison['maxTranslationAbsDeltaM']}"
        )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"pose extraction failed: {error}", file=sys.stderr)
        sys.exit(1)
