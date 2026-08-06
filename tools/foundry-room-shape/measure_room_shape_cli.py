#!/usr/bin/env python3
"""Run the room-shape proposer over a cached point cloud and freeze the result.

Reads one binary point cloud and one scanner-origin list, both read-only, and
writes two files: an authority-none proposal (deterministic, digest-bound, no
wall clock) and a run receipt (wall clock, toolchain, and every parameter the
run used, so a later revision that drifts toward a convenient answer is legible
as a diff rather than a rumour).

It compares against nothing.  Use compare_room_shape_to_published.py for that,
deliberately as a separate step on the frozen file.

Usage:
    py -3.12 measure_room_shape_cli.py \
        --cloud  cached-cloud.ply \
        --origins sweep-centres.txt \
        --label  "grand-hall-pilot-sweeps-0-48" \
        --out-dir docs/operations
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import room_shape

RECEIPT_SCHEMA_VERSION = "omnitwin.foundry.room-shape-run-receipt.v0"
RECEIPT_DIGEST_DOMAIN = b"OMNITWIN_FOUNDRY_ROOM_SHAPE_RUN_RECEIPT_V0\0"
PLY_MAGIC = b"ply"
HEADER_TERMINATOR = b"end_header"
MAX_HEADER_BYTES = 64 * 1024


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
    return digest.hexdigest(), size


def read_binary_ply(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Read a little-endian binary PLY carrying x, y, z, nx, ny, nz.

    Deliberately strict: an unexpected element order, property list or endian
    declaration raises rather than being silently reinterpreted, because a
    misread cloud would still produce a plausible-looking measurement.
    """
    with path.open("rb") as handle:
        header_bytes = 0
        lines: list[str] = []
        while True:
            raw_line = handle.readline(MAX_HEADER_BYTES - header_bytes + 1)
            if not raw_line:
                raise ValueError(f"{path.name}: no end_header found")
            header_bytes += len(raw_line)
            if header_bytes > MAX_HEADER_BYTES:
                raise ValueError(f"{path.name}: header is implausibly long")
            line = raw_line.rstrip(b"\r\n").decode("ascii", errors="strict").strip()
            if line:
                lines.append(line)
            if line == HEADER_TERMINATOR.decode("ascii"):
                break
        if not lines or lines[0] != "ply":
            raise ValueError(f"{path.name}: not a PLY file")
        if len(lines) < 2:
            raise ValueError(f"{path.name}: incomplete PLY header")
        if lines[1] != "format binary_little_endian 1.0":
            raise ValueError(f"{path.name}: unsupported PLY format {lines[1]!r}")
        counts = [line for line in lines if line.startswith("element vertex ")]
        if len(counts) != 1:
            raise ValueError(f"{path.name}: expected exactly one vertex element")
        elements = [line for line in lines if line.startswith("element ")]
        if elements != counts:
            raise ValueError(f"{path.name}: only one vertex element is supported")
        vertex_count = int(counts[0].split()[-1])
        properties = [
            line.split()[1:] for line in lines if line.startswith("property ")
        ]
        expected = [
            ["double", name] for name in ("x", "y", "z", "nx", "ny", "nz")
        ]
        if properties != expected:
            raise ValueError(
                f"{path.name}: expected six double properties x,y,z,nx,ny,nz, "
                f"found {properties!r}"
            )
        raw = np.fromfile(handle, dtype="<f8", count=vertex_count * 6)
        trailing = handle.read(1)
    if raw.size != vertex_count * 6:
        raise ValueError(f"{path.name}: truncated vertex payload")
    if trailing:
        raise ValueError(f"{path.name}: unexpected bytes after vertex payload")
    table = raw.reshape(vertex_count, 6)
    return np.ascontiguousarray(table[:, 0:3]), np.ascontiguousarray(table[:, 3:6])


def read_origins(path: Path) -> np.ndarray:
    values = np.loadtxt(path, dtype=float)
    if values.ndim != 2 or values.shape[1] != 3:
        raise ValueError(f"{path.name}: expected three columns of metres per sweep")
    return values


def parameters() -> dict[str, float | int]:
    """Every knob this revision used, recorded so a later drift is a diff."""
    return {
        "completenessAccept": room_shape.COMPLETENESS_ACCEPT,
        "coverageHeightAccept": room_shape.COVERAGE_HEIGHT_ACCEPT,
        "coverageWalkedAccept": room_shape.COVERAGE_WALKED_ACCEPT,
        "cellM": room_shape.CELL_M,
        "minPlaneToleranceM": room_shape.MIN_PLANE_TOLERANCE_M,
        "measurementFloorM": room_shape.MEASUREMENT_FLOOR_M,
        "horizontalNormalMinCos": room_shape.HORIZONTAL_NORMAL_MIN_COS,
        "verticalNormalMaxCos": room_shape.VERTICAL_NORMAL_MAX_COS,
        "axisNormalMinCos": room_shape.AXIS_NORMAL_MIN_COS,
        "minNormalCoverage": room_shape.MIN_NORMAL_COVERAGE,
        "peakBinM": room_shape.PEAK_BIN_M,
        "peakMergeM": room_shape.PEAK_MERGE_M,
        "peakMinShare": room_shape.PEAK_MIN_SHARE,
        "maxCandidatesPerSide": room_shape.MAX_CANDIDATES_PER_SIDE,
        "spanEstimatorMaxPoints": room_shape.SPAN_ESTIMATOR_MAX_POINTS,
        "outboardMassMarginM": room_shape.OUTBOARD_MASS_MARGIN_M,
        "outboardReviewMinPoints": room_shape.OUTBOARD_REVIEW_MIN_POINTS,
        "outboardReviewMinRatio": room_shape.OUTBOARD_REVIEW_MIN_RATIO,
        "disputeCompletenessMargin": room_shape.DISPUTE_COMPLETENESS_MARGIN,
        "disputeSeparationM": room_shape.DISPUTE_SEPARATION_M,
    }


def summarise(proposal: dict[str, object]) -> list[str]:
    measurement = proposal["measurement"]
    frame = proposal["frame"]
    yaw = proposal["yaw"]
    assert isinstance(measurement, dict) and isinstance(frame, dict)
    assert isinstance(yaw, dict)
    lines = [
        f"state            {measurement['state']}",
        f"tripod height    {frame['tripodHeightM']:.3f} m "
        f"(spread {frame['tripodHeightSpreadM']:.3f} m)",
        f"scanner->ceiling {frame['scannerToCeilingM']:.3f} m",
        f"yaw              {yaw['normalHistogramDeg']:.3f} deg by normals, "
        f"{yaw['spanMinimisationDeg']:.3f} deg by spans "
        f"(disagreement {yaw['disagreementDeg']:.3f} deg, "
        f"rectangularity {yaw['rectangularity']:.3f})",
    ]
    for label, key in (("long axis", "longAxisM"), ("short axis", "shortAxisM"), ("height", "heightM")):
        entry = measurement.get(key)
        if isinstance(entry, dict):
            lines.append(
                f"{label:16s} {entry['centreM']:.3f} +/- {entry['uncertaintyM']:.3f} m "
                f"(range {entry['minimumM']:.3f}-{entry['maximumM']:.3f}, "
                f"out of parallel {entry['outOfParallelDeg']:.3f} deg)"
            )
        else:
            lines.append(f"{label:16s} not measured")
    refusals = proposal.get("refusals") or []
    lines.append(f"refusals         {', '.join(map(str, refusals)) if refusals else 'none'}")
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cloud", type=Path, required=True)
    parser.add_argument("--origins", type=Path, required=True)
    parser.add_argument("--label", required=True, help="what this capture is")
    parser.add_argument("--manifest-sha256", default="", help="binding ingest digest")
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--name", default="room-shape-proposal")
    parser.add_argument(
        "--diagnostics",
        action="store_true",
        help="write a deterministic authority-none top-view SVG",
    )
    args = parser.parse_args(argv)

    cloud_sha, cloud_bytes = sha256_file(args.cloud)
    origins_sha, origins_bytes = sha256_file(args.origins)
    points, normals = read_binary_ply(args.cloud)
    origins = read_origins(args.origins)
    print(
        f"read {points.shape[0]:,} points and {origins.shape[0]} scanner origins",
        file=sys.stderr,
    )

    measurement = room_shape.measure_room_shape(points, normals, origins)
    proposal = room_shape.build_proposal(
        measurement,
        source_binding={
            "label": args.label,
            "manifestSha256": args.manifest_sha256,
            "pointCloudSha256": cloud_sha,
            "pointCloudBytes": cloud_bytes,
            "originsSha256": origins_sha,
            "originsBytes": origins_bytes,
            "pointCount": int(points.shape[0]),
            "originCount": int(origins.shape[0]),
        },
    )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    proposal_path = args.out_dir / f"{args.name}.json"
    receipt_path = args.out_dir / f"{args.name}-receipt.json"
    proposal_path.write_text(
        json.dumps(proposal, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    proposal_file_sha, proposal_file_bytes = sha256_file(proposal_path)
    diagnostics: list[dict[str, object]] = []
    if args.diagnostics:
        import room_shape_diagnostics

        diagnostic_path = args.out_dir / f"{args.name}-top-view.svg"
        diagnostic_metadata = room_shape_diagnostics.render_top_view_svg(
            diagnostic_path,
            points=points,
            origins=origins,
            measurement=measurement,
            proposal_sha256=str(proposal["proposalSha256"]),
        )
        diagnostic_sha, diagnostic_bytes = sha256_file(diagnostic_path)
        diagnostics.append(
            {
                "fileName": diagnostic_path.name,
                "sha256": diagnostic_sha,
                "sizeBytes": diagnostic_bytes,
                "schemaVersion": diagnostic_metadata["schemaVersion"],
            }
        )
    receipt = {
        "schemaVersion": RECEIPT_SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "proposalSha256": proposal["proposalSha256"],
        "proposalFileName": proposal_path.name,
        "proposalFileSha256": proposal_file_sha,
        "proposalFileBytes": proposal_file_bytes,
        "inputs": {
            "cloudFileName": args.cloud.name,
            "cloudSha256": cloud_sha,
            "cloudBytes": cloud_bytes,
            "originsFileName": args.origins.name,
            "originsSha256": origins_sha,
            "originsBytes": origins_bytes,
            "pointCount": int(points.shape[0]),
            "originCount": int(origins.shape[0]),
        },
        "diagnostics": diagnostics,
        "toolchain": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "platform": platform.system(),
        },
        "parameters": parameters(),
        "policy": {
            "sourceBytesMutated": False,
            "networkUsed": False,
            "selfApproved": False,
            "comparedAgainstExternalFigures": False,
        },
    }
    receipt_canonical = json.dumps(
        receipt,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        ensure_ascii=True,
    )
    receipt["receiptSha256"] = hashlib.sha256(
        RECEIPT_DIGEST_DOMAIN + receipt_canonical.encode("utf-8")
    ).hexdigest()
    receipt_path.write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    for line in summarise(proposal):
        print(line)
    print(f"\nproposal {proposal['proposalSha256']}")
    print(f"wrote    {proposal_path}")
    print(f"wrote    {receipt_path}")
    for diagnostic in diagnostics:
        print(f"wrote    {args.out_dir / str(diagnostic['fileName'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
