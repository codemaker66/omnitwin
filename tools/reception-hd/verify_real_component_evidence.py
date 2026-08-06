#!/usr/bin/env python3
"""Verify the sealed 2026-07-16 Reception real-component CV evidence bundle.

The checker is deliberately read-only apart from its optional JSON receipt. It
validates the captured implementation hashes, every screenshot and sidecar,
repeat identity, embedded CV/board receipts, regenerated pixel metrics, and the
plain-language no-winner boundary.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import platform
import struct
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any, Mapping, Sequence


EXPECTED_ARTIFACT_SHA256 = {
    "capture-manifest.json": "e414ee58d64266c59bebfa23485f897c8c3472929853ec3b398e093ae43faf5b",
    "cv-triage.json": "9cc0af09bdc25fc004e34f1d0e741611f699145c81bf7e9e6be8befd7c58f15b",
    "pixel-metrics.json": "d79443a4594d97fab25724acc97772159d41f09f6b0a1cc63e89a0863490caf3",
    "cv-boards-current/index.json": "006dddb62557244c49897382d4a893ca1885e15971380848cf52f1f075f80bb3",
}
EXPECTED_CV_RECEIPT = "55bf71044439e9ce15cb6d069f296a155ba5aa8b33f46b4ed34a87648a9143dc"
EXPECTED_BOARD_RECEIPT = "52cf083c4cf21446defe000385d43dcc7ddd3f849432ff7f578b0908abc5886f"
EXPECTED_VIEWS = (
    "overview",
    "timber-left",
    "timber-right",
    "floor-surface",
    "ceiling-moulding",
    "column-skirting",
)
EXPECTED_CANDIDATES = {
    "quality-sog-fine-real-component": 2_002_009,
    "mobile-spz-fine-real-component": 1_978_258,
}
EXPECTED_METRIC_RANGES = {
    "psnrDb": [26.912251, 29.773793],
    "ssim": [0.941555, 0.961395],
    "mae": [0.025317, 0.040604],
}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class VerificationError(RuntimeError):
    """A sealed-evidence invariant failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"{path} must contain a JSON object")
    return value


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return sha256_bytes(encoded)


def safe_child(root: Path, relative: str) -> Path:
    require(relative != "" and Path(relative).is_absolute() is False, f"unsafe relative path: {relative!r}")
    root_resolved = root.resolve()
    result = (root_resolved / relative).resolve()
    require(result == root_resolved or root_resolved in result.parents, f"path escapes root: {relative}")
    return result


def verify_recorded_file(path: Path, size: int, sha256: str, label: str) -> None:
    require(path.is_file(), f"missing {label}: {path}")
    require(path.stat().st_size == size, f"{label} size changed: {path}")
    require(sha256_file(path).lower() == sha256.lower(), f"{label} SHA-256 changed: {path}")


def png_header(path: Path) -> tuple[int, int, int, int]:
    with path.open("rb") as handle:
        header = handle.read(33)
    require(len(header) == 33, f"PNG is too short: {path}")
    require(header[:8] == PNG_SIGNATURE, f"PNG signature mismatch: {path}")
    require(struct.unpack(">I", header[8:12])[0] == 13, f"PNG IHDR length mismatch: {path}")
    require(header[12:16] == b"IHDR", f"PNG starts without IHDR: {path}")
    width, height = struct.unpack(">II", header[16:24])
    bit_depth = header[24]
    color_type = header[25]
    return width, height, bit_depth, color_type


def import_compare_tool(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location("reception_compare_fixed_views", path)
    require(spec is not None and spec.loader is not None, f"cannot import metric tool: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def string_mapping(value: Any, label: str) -> Mapping[str, Any]:
    require(isinstance(value, Mapping), f"{label} must be an object")
    return value


def sequence(value: Any, label: str) -> Sequence[Any]:
    require(isinstance(value, Sequence) and not isinstance(value, (str, bytes)), f"{label} must be an array")
    return value


def verify_capture(
    repo: Path,
    evidence: Path,
    manifest: dict[str, Any],
    *,
    allow_environment_drift: bool,
) -> dict[str, Any]:
    environment = sequence(manifest.get("environmentIntegrity"), "environmentIntegrity")
    require(len(environment) == 15, "capture manifest must bind exactly 15 environment files")
    environment_matches = 0
    environment_drift: list[dict[str, Any]] = []
    for raw in environment:
        row = string_mapping(raw, "environmentIntegrity entry")
        relative = str(row.get("path", ""))
        path = safe_child(repo, relative)
        expected_size = int(row.get("sizeBytes", -1))
        expected_sha = str(row.get("sha256", "")).lower()
        if not path.is_file():
            environment_drift.append(
                {
                    "path": relative,
                    "reason": "missing",
                    "expectedSizeBytes": expected_size,
                    "expectedSha256": expected_sha,
                    "actualSizeBytes": None,
                    "actualSha256": None,
                }
            )
            continue
        actual_size = path.stat().st_size
        actual_sha = sha256_file(path)
        if actual_size == expected_size and actual_sha == expected_sha:
            environment_matches += 1
            continue
        environment_drift.append(
            {
                "path": relative,
                "reason": "size_or_sha256_changed",
                "expectedSizeBytes": expected_size,
                "expectedSha256": expected_sha,
                "actualSizeBytes": actual_size,
                "actualSha256": actual_sha,
            }
        )

    if environment_drift and not allow_environment_drift:
        changed_paths = ", ".join(item["path"] for item in environment_drift)
        raise VerificationError(
            "capture environment drifted for "
            f"{len(environment_drift)} file(s): {changed_paths}; "
            "rerun with --allow-environment-drift only to validate the immutable evidence "
            "while recording that strict current-source replay is not proved"
        )

    require(tuple(manifest.get("views", [])) == EXPECTED_VIEWS, "capture view order changed")
    candidates = sequence(manifest.get("candidates"), "candidates")
    observed_candidates = {
        str(string_mapping(item, "candidate").get("variantId")): int(string_mapping(item, "candidate").get("expectedGaussianCount", -1))
        for item in candidates
    }
    require(observed_candidates == EXPECTED_CANDIDATES, "candidate identities or decoded totals changed")

    screenshot_records = sequence(manifest.get("screenshotIntegrity"), "screenshotIntegrity")
    require(len(screenshot_records) == 24, "capture manifest must bind exactly 24 PNGs")
    screenshot_names: set[str] = set()
    screenshot_hashes: dict[str, str] = {}
    for raw in screenshot_records:
        row = string_mapping(raw, "screenshotIntegrity entry")
        name = str(row.get("name", ""))
        require(Path(name).name == name and name.endswith(".png"), f"unsafe screenshot name: {name}")
        require(name not in screenshot_names, f"duplicate screenshot entry: {name}")
        screenshot_names.add(name)
        path = evidence / name
        verify_recorded_file(path, int(row.get("bytes", -1)), str(row.get("sha256", "")), "screenshot")
        width, height, bit_depth, color_type = png_header(path)
        require((width, height, bit_depth, color_type) == (1200, 900, 8, 2), f"screenshot is not 1200x900 RGB8 PNG: {name}")
        screenshot_hashes[name] = sha256_file(path)

    sidecar_records = sequence(manifest.get("sidecarIntegrity"), "sidecarIntegrity")
    require(len(sidecar_records) == 12, "capture manifest must bind exactly 12 sidecars")
    repeat_pairs = 0
    canonical_image_names: set[str] = set()
    for raw in sidecar_records:
        row = string_mapping(raw, "sidecarIntegrity entry")
        name = str(row.get("name", ""))
        require(Path(name).name == name and name.endswith(".json"), f"unsafe sidecar name: {name}")
        path = evidence / name
        verify_recorded_file(path, int(row.get("bytes", -1)), str(row.get("sha256", "")), "sidecar")
        sidecar = load_json(path)
        variant = str(sidecar.get("variantId", ""))
        view = str(sidecar.get("reviewViewId", ""))
        require(variant in EXPECTED_CANDIDATES and view in EXPECTED_VIEWS, f"unexpected sidecar identity: {name}")
        require(sidecar.get("sceneState") == "live", f"sidecar did not capture a live scene: {name}")
        require(sidecar.get("loadedSourceCount") == 4, f"sidecar did not load four sources: {name}")
        require(sidecar.get("loadedSplatCount") == EXPECTED_CANDIDATES[variant], f"decoded total mismatch: {name}")
        require(sidecar.get("renderProfileId") == "reception-fixed-fine-review-v1", f"renderer profile mismatch: {name}")
        shots = sequence(sidecar.get("screenshots"), f"{name}.screenshots")
        require(len(shots) == 2, f"sidecar must bind two repeats: {name}")
        bound: list[tuple[str, str, int]] = []
        for shot_raw in shots:
            shot = string_mapping(shot_raw, f"{name}.screenshot")
            shot_name = Path(str(shot.get("path", ""))).name
            require(shot_name in screenshot_names, f"sidecar references unknown screenshot: {shot_name}")
            require(str(shot.get("format")) == "PNG", f"sidecar format is not PNG: {shot_name}")
            require(str(shot.get("sha256", "")).lower() == screenshot_hashes[shot_name], f"sidecar screenshot hash mismatch: {shot_name}")
            require(int(shot.get("sizeBytes", -1)) == (evidence / shot_name).stat().st_size, f"sidecar screenshot size mismatch: {shot_name}")
            bound.append((shot_name, screenshot_hashes[shot_name], int(shot.get("repeat", -1))))
        require({item[2] for item in bound} == {1, 2}, f"sidecar repeat ordinals changed: {name}")
        require(bound[0][1] == bound[1][1], f"repeat PNG bytes differ: {name}")
        repeat_pairs += 1
        canonical_image_names.add(next(item[0] for item in bound if item[2] == 1))

    require(screenshot_names == {
        name
        for canonical in canonical_image_names
        for name in (canonical, canonical.removesuffix(".png") + "-repeat-2.png")
    }, "screenshot inventory contains an unbound or missing repeat")
    repeat = string_mapping(manifest.get("repeatEvidence"), "repeatEvidence")
    require(repeat.get("comparedPairs") == 12 and repeat.get("byteIdenticalPairs") == 12, "repeat summary changed")
    require(repeat.get("delayMilliseconds") == 500, "repeat delay changed")
    return {
        "environmentFiles": len(environment),
        "environmentFilesMatched": environment_matches,
        "environmentFilesDrifted": len(environment_drift),
        "environmentDriftAllowed": allow_environment_drift,
        "environmentDrift": environment_drift,
        "screenshots": len(screenshot_records),
        "sidecars": len(sidecar_records),
        "byteIdenticalRepeatPairs": repeat_pairs,
        "pngContract": "1200x900 RGB8 true PNG",
        "candidateDecodedTotals": observed_candidates,
        "canonicalImageNames": sorted(canonical_image_names),
    }


def verify_cv(evidence: Path, cv: dict[str, Any], canonical_images: Sequence[str], manifest_sha: str) -> dict[str, Any]:
    binding = string_mapping(cv.get("evidenceBinding"), "evidenceBinding")
    manifest_binding = string_mapping(binding.get("captureManifest"), "evidenceBinding.captureManifest")
    require(str(manifest_binding.get("sha256", "")).lower() == manifest_sha, "CV report does not bind the capture manifest")

    payload = copy.deepcopy(cv)
    payload_binding = string_mapping(payload.get("evidenceBinding"), "evidenceBinding")
    receipt = string_mapping(payload_binding.pop("reportReceipt", None), "evidenceBinding.reportReceipt")
    calculated_receipt = canonical_sha256(payload)
    require(str(receipt.get("sha256", "")).lower() == EXPECTED_CV_RECEIPT, "CV embedded receipt changed")
    require(calculated_receipt == EXPECTED_CV_RECEIPT, "CV canonical receipt does not verify")

    inputs = sequence(binding.get("inputImages"), "evidenceBinding.inputImages")
    require(len(inputs) == 12, "CV report must bind exactly 12 canonical inputs")
    require({str(string_mapping(item, "CV input").get("name")) for item in inputs} == set(canonical_images), "CV input inventory differs from capture manifest")
    for raw in inputs:
        row = string_mapping(raw, "CV input")
        name = str(row.get("name", ""))
        path = evidence / name
        verify_recorded_file(path, int(row.get("sizeBytes", -1)), str(row.get("sha256", "")), "CV input")
        require(row.get("fileFormat") == "PNG" and row.get("decodedMode") == "RGB", f"CV input decoding changed: {name}")
        require(row.get("pixelDimensions") == [1200, 900], f"CV input dimensions changed: {name}")

    comparisons = sequence(cv.get("comparisons"), "comparisons")
    require(len(comparisons) == 2, "CV report must contain both comparison directions")
    verdicts: dict[str, dict[str, int]] = {}
    for raw in comparisons:
        comparison = string_mapping(raw, "comparison")
        pair_id = str(comparison.get("pairId", ""))
        per_view = sequence(comparison.get("perView"), f"{pair_id}.perView")
        require(len(per_view) == 6, f"comparison must contain six views: {pair_id}")
        require({str(string_mapping(item, "view result").get("view")) for item in per_view} == set(EXPECTED_VIEWS), f"view inventory changed: {pair_id}")
        counts = Counter(str(string_mapping(item, "view result").get("verdict")) for item in per_view)
        require(counts == Counter({"review": 5, "not_assessable": 1}), f"unexpected CV verdicts: {pair_id}: {dict(counts)}")
        verdicts[pair_id] = {
            "review": counts["review"],
            "not_assessable": counts["not_assessable"],
            "triage_clear": counts["triage_clear"],
        }
    return {"embeddedReceiptSha256": calculated_receipt, "directionVerdicts": verdicts}


def verify_metrics(repo: Path, evidence: Path, metrics: dict[str, Any]) -> dict[str, Any]:
    compare_path = repo / "tools/reception-hd/compare_fixed_views.py"
    compare_tool = import_compare_tool(compare_path)
    pairs = (
        ("quality-sog-fine-real-component", "mobile-spz-fine-real-component"),
        ("mobile-spz-fine-real-component", "quality-sog-fine-real-component"),
    )
    regenerated = compare_tool.build_report(evidence, pairs)
    require(regenerated == metrics, "current compare_fixed_views.py did not exactly regenerate pixel-metrics.json")
    comparisons = string_mapping(metrics.get("comparisons"), "pixel metrics comparisons")
    require(len(comparisons) == 2, "pixel metrics must contain two directions")
    observed_ranges: dict[str, list[float]] = {}
    for field in EXPECTED_METRIC_RANGES:
        values = [
            float(string_mapping(row, "metric row")[field])
            for comparison in comparisons.values()
            for row in sequence(string_mapping(comparison, "metric comparison").get("perView"), "metric perView")
        ]
        observed_ranges[field] = [round(min(values), 6), round(max(values), 6)]
    require(observed_ranges == EXPECTED_METRIC_RANGES, f"metric ranges changed: {observed_ranges}")
    return {
        "toolSha256": sha256_file(compare_path),
        "toolSizeBytes": compare_path.stat().st_size,
        "exactSemanticRegeneration": True,
        "ranges": observed_ranges,
    }


def verify_boards(evidence: Path, index: dict[str, Any], cv_sha: str) -> dict[str, Any]:
    payload = copy.deepcopy(index)
    receipt = string_mapping(payload.pop("indexReceipt", None), "indexReceipt")
    calculated_receipt = canonical_sha256(payload)
    require(str(receipt.get("sha256", "")).lower() == EXPECTED_BOARD_RECEIPT, "board embedded receipt changed")
    require(calculated_receipt == EXPECTED_BOARD_RECEIPT, "board canonical receipt does not verify")
    source_report = string_mapping(index.get("sourceReport"), "sourceReport")
    require(str(source_report.get("sha256", "")).lower() == cv_sha, "board index does not bind CV report bytes")

    boards = sequence(index.get("boards"), "boards")
    require(len(boards) == 12, "board index must bind exactly 12 boards")
    verdicts = Counter()
    board_root = evidence / "cv-boards-current"
    for raw in boards:
        row = string_mapping(raw, "board")
        relative = str(row.get("file", ""))
        path = safe_child(board_root, relative)
        verify_recorded_file(path, int(row.get("sizeBytes", -1)), str(row.get("sha256", "")), "review board")
        png_header(path)
        verdicts[str(row.get("verdict", ""))] += 1
    require(verdicts == Counter({"review": 10, "not_assessable": 2}), f"board verdict inventory changed: {dict(verdicts)}")
    return {
        "embeddedReceiptSha256": calculated_receipt,
        "boards": len(boards),
        "verdicts": dict(sorted(verdicts.items())),
    }


def run(repo: Path, evidence: Path, *, allow_environment_drift: bool = False) -> dict[str, Any]:
    repo = repo.resolve()
    evidence = evidence.resolve()
    require(repo.is_dir(), f"repository does not exist: {repo}")
    require(evidence.is_dir(), f"evidence root does not exist: {evidence}")

    artifacts: dict[str, dict[str, Any]] = {}
    loaded: dict[str, dict[str, Any]] = {}
    for relative, expected_sha in EXPECTED_ARTIFACT_SHA256.items():
        path = safe_child(evidence, relative)
        actual_sha = sha256_file(path)
        require(actual_sha == expected_sha, f"sealed artifact SHA-256 changed: {relative}")
        artifacts[relative] = {"sizeBytes": path.stat().st_size, "sha256": actual_sha}
        loaded[relative] = load_json(path)

    capture_result = verify_capture(
        repo,
        evidence,
        loaded["capture-manifest.json"],
        allow_environment_drift=allow_environment_drift,
    )
    cv_result = verify_cv(
        evidence,
        loaded["cv-triage.json"],
        capture_result.pop("canonicalImageNames"),
        artifacts["capture-manifest.json"]["sha256"],
    )
    metric_result = verify_metrics(repo, evidence, loaded["pixel-metrics.json"])
    board_result = verify_boards(
        evidence,
        loaded["cv-boards-current/index.json"],
        artifacts["cv-triage.json"]["sha256"],
    )

    checker = Path(__file__).resolve()
    return {
        "schemaVersion": "venviewer.reception-room-real-component-validation.v1",
        "verifiedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "status": (
            "passed_with_environment_drift"
            if capture_result["environmentFilesDrifted"]
            else "passed"
        ),
        "checker": {
            "path": checker.relative_to(repo).as_posix(),
            "sizeBytes": checker.stat().st_size,
            "sha256": sha256_file(checker),
            "python": platform.python_version(),
            "platform": platform.platform(),
            "argv": sys.argv,
        },
        "repository": str(repo),
        "evidenceRoot": str(evidence),
        "artifacts": artifacts,
        "checks": {
            "capture": capture_result,
            "computerVision": cv_result,
            "pixelMetrics": metric_result,
            "reviewBoards": board_result,
        },
        "preliminaryRejectedCapture": {
            "classification": "operator_session_record_only",
            "verifiedByThisRun": False,
            "record": "A preliminary screenshot path returned JPEG bytes under .png names and was rejected before the final PNG run.",
            "limitation": "Those discarded bytes, their hashes, rejection timestamp, and raw checker output were not retained; this receipt does not independently prove that preliminary event.",
        },
        "conclusion": {
            "proved": "The two candidates produce reproducible pairwise visual differences in five assessable fixed views.",
            "notProved": "Neither candidate is physically more accurate or higher quality without a registered independent room reference and human review.",
            "directionVerdict": "no_physically_supported_winner",
            "replayBoundary": (
                "The immutable evidence bundle verifies, but strict reproduction from the current checkout is not proved because one or more listed capture-environment files drifted."
                if capture_result["environmentFilesDrifted"]
                else "Every listed capture-environment file still matches its sealed size and SHA-256."
            ),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--evidence-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--allow-environment-drift",
        action="store_true",
        help=(
            "Validate the immutable evidence even when listed checkout files changed; "
            "the receipt will record every mismatch and will not claim strict replay."
        ),
    )
    args = parser.parse_args()
    try:
        receipt = run(
            args.repo,
            args.evidence_root,
            allow_environment_drift=args.allow_environment_drift,
        )
    except (OSError, ValueError, VerificationError) as error:
        print(f"VERIFICATION_FAILED: {error}", file=sys.stderr)
        return 1
    serialized = json.dumps(receipt, indent=2, ensure_ascii=False) + "\n"
    if args.output is None:
        print(serialized, end="")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
        print(f"VERIFICATION_PASSED: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
