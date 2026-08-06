from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

import align_e57_xgrids as align  # noqa: E402


FIXTURE_E57_PAYLOAD = b"small-read-only-e57-placeholder"
_REAL_RECEPTION_E57_SHA256 = align.RECEPTION_E57_SHA256
_REAL_RECEPTION_E57_SIZE_BYTES = align.RECEPTION_E57_SIZE_BYTES


def setUpModule() -> None:
    # Unit fixtures are intentionally tiny. Production CLI defaults remain
    # pinned in source to the real 20.5 GB Reception E57 identity.
    align.RECEPTION_E57_SHA256 = hashlib.sha256(FIXTURE_E57_PAYLOAD).hexdigest()
    align.RECEPTION_E57_SIZE_BYTES = len(FIXTURE_E57_PAYLOAD)


def tearDownModule() -> None:
    align.RECEPTION_E57_SHA256 = _REAL_RECEPTION_E57_SHA256
    align.RECEPTION_E57_SIZE_BYTES = _REAL_RECEPTION_E57_SIZE_BYTES


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def source_points(count: int = 80) -> list[list[float]]:
    # An intentionally asymmetric, full-rank shape.
    return [
        [
            0.17 * index + 0.03 * (index % 3),
            0.11 * ((index * index + 3 * index) % 29) + 0.007 * index,
            0.13 * ((index * 7 + index * index) % 23) + 0.002 * index * index,
        ]
        for index in range(count)
    ]


def write_ascii_ply(path: Path, points: list[list[float]]) -> None:
    lines = [
        "ply",
        "format ascii 1.0",
        f"element vertex {len(points)}",
        "property float x",
        "property float y",
        "property float z",
        "element face 0",
        "property list uchar uint vertex_indices",
        "end_header",
    ]
    lines.extend(" ".join(format(value, ".17g") for value in point) for point in points)
    path.write_text("\n".join(lines) + "\n", encoding="ascii", newline="\n")


def write_binary_ply(path: Path, points: list[list[float]]) -> None:
    header = (
        "ply\n"
        "format binary_little_endian 1.0\n"
        f"element vertex {len(points)}\n"
        "property float x\n"
        "property float y\n"
        "property float z\n"
        "element face 0\n"
        "property list uchar uint vertex_indices\n"
        "end_header\n"
    ).encode("ascii")
    payload = header + b"".join(struct.pack("<fff", *point) for point in points)
    path.write_bytes(payload)


def write_poses(path: Path, *, timestamp_order: tuple[int, ...] = tuple(range(40))) -> None:
    poses = [
        {
            "ts": f"1780322782.{index:09d}",
            "T": [index * 0.01, (index % 5) * 0.02, (index % 7) * 0.03],
            "R": [1.0, 0.0, 0.0, 0.0],
            "RGB": None,
        }
        for index in timestamp_order
    ]
    path.write_text(
        json.dumps({"poses": poses, "fusionPoses": None}, separators=(",", ":")),
        encoding="utf-8",
    )


def make_reception_evidence(e57_payload: bytes) -> dict[str, object]:
    evidence: dict[str, object] = {
        "schemaVersion": align.RECEPTION_EVIDENCE_SCHEMA,
        "authority": "none",
        "scope": {
            "scanIds": list(align.RECEPTION_SCAN_IDS),
            "sourceE57FileName": "capture.e57",
            "sourceE57ScanCount": 149,
            "sourceE57Sha256": sha256_bytes(e57_payload),
            "sourceE57SizeBytes": len(e57_payload),
        },
        "technicalDecision": {
            "proposedStationSplit": {
                "trainingScanIds": list(align.FROZEN_FIT_SCAN_IDS),
                "validationScanIds": list(align.FROZEN_VALIDATION_SCAN_IDS),
                "testScanIds": list(align.FROZEN_TEST_SCAN_IDS),
            }
        },
        "authorizationDecision": {
            "status": "blocked_pending_authoritative_rights_review",
            "trainingPermitted": False,
        },
        "visualReview": {
            "nativeImageReviewComplete": False,
            "requiresHumanConfirmation": True,
        },
    }
    evidence["payloadSha256"] = hashlib.sha256(
        align.RECEPTION_EVIDENCE_DIGEST_DOMAIN + canonical(evidence)
    ).hexdigest()
    return evidence


def write_evidence(path: Path, evidence: dict[str, object]) -> None:
    path.write_text(json.dumps(evidence, separators=(",", ":")), encoding="utf-8")


def make_fixture(root: Path, points: list[list[float]] | None = None) -> dict[str, Path]:
    source = root / "source"
    source.mkdir()
    receipts = root / "receipts"
    receipts.mkdir()
    stage = source / "stage"
    stage.mkdir()
    e57_payload = FIXTURE_E57_PAYLOAD
    e57 = stage / "capture.e57"
    e57.write_bytes(e57_payload)
    stage_manifest = stage / "capture-stage-manifest.json"
    entry = {
        "sourceRelativePath": "capture.e57",
        "targetRelativePath": "capture.e57",
        "sizeBytes": len(e57_payload),
        "sha256": sha256_bytes(e57_payload),
        "role": "primary_capture",
    }
    stage_manifest.write_text(
        json.dumps(
            {
                "schemaVersion": align.STAGE_SCHEMA,
                "sourceRoot": "fixture-source",
                "planSha256": "1" * 64,
                "fileCount": 1,
                "totalBytes": len(e57_payload),
                "files": [entry],
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    evidence_root = source / "evidence"
    evidence_root.mkdir()
    evidence = evidence_root / "reception-evidence.json"
    write_evidence(evidence, make_reception_evidence(e57_payload))
    xgrids = source / "xgrids"
    xgrids.mkdir()
    ply = xgrids / "xgrids.ply"
    write_ascii_ply(ply, points or source_points())
    poses = xgrids / "poses.json"
    write_poses(poses)
    return {
        "stageManifest": stage_manifest,
        "e57": e57,
        "evidence": evidence,
        "xgridsRoot": xgrids,
        "ply": ply,
        "poses": poses,
        "receiptRoot": receipts,
    }


def preflight_args(files: dict[str, Path], output: Path) -> list[str]:
    return [
        "preflight",
        "--stage-manifest",
        str(files["stageManifest"]),
        "--reception-evidence",
        str(files["evidence"]),
        "--xgrids-root",
        str(files["xgridsRoot"]),
        "--xgrids-ply",
        str(files["ply"]),
        "--xgrids-poses",
        str(files["poses"]),
        "--scan-range",
        "122-144",
        "--output",
        str(output),
        "--verify-e57-bytes",
    ]


def diagnostic_args(
    files: dict[str, Path], output: Path, preflight: dict[str, object]
) -> list[str]:
    inputs = preflight["inputEvidence"]
    assert isinstance(inputs, dict)
    return [
        "diagnose",
        "--stage-manifest",
        str(files["stageManifest"]),
        "--reception-evidence",
        str(files["evidence"]),
        "--xgrids-root",
        str(files["xgridsRoot"]),
        "--xgrids-ply",
        str(files["ply"]),
        "--xgrids-poses",
        str(files["poses"]),
        "--scan-range",
        "122-144",
        "--output",
        str(output),
        "--verify-e57-bytes",
        "--expected-stage-manifest-sha256",
        inputs["captureStageManifest"]["sha256"],
        "--expected-reception-evidence-sha256",
        inputs["receptionScopeEvidence"]["fileSha256"],
        "--expected-ply-sha256",
        inputs["xgridsPly"]["sha256"],
        "--expected-poses-sha256",
        inputs["xgridsPoses"]["sha256"],
        "--points-per-scan",
        "1000",
        "--xgrids-sample-points",
        "1000",
        "--overlap-distance-m",
        "0.0001",
        "--max-rmse-m",
        "0.0001",
        "--max-p95-m",
        "0.0001",
        "--min-overlap-fraction",
        "0.99",
    ]


class FakeE57Adapter:
    def __init__(self, points: list[list[float]], validation_offset: float = 0.0) -> None:
        self.points = points
        self.validation_offset = validation_offset
        self.requested: tuple[int, ...] | None = None

    def read_samples(
        self, _path: Path, scan_ids: tuple[int, ...], _limit: int
    ) -> dict[str, object]:
        self.requested = tuple(scan_ids)
        rows: dict[int, list[list[float]]] = {}
        for scan_id in scan_ids:
            offset = self.validation_offset if scan_id in align.FROZEN_VALIDATION_SCAN_IDS else 0.0
            rows[scan_id] = [
                [point[0] + offset, point[1], point[2]] for point in self.points
            ]
        return {
            "adapter": {"name": "deterministic-test-adapter", "version": "1"},
            "scanCount": 149,
            "rawPointCounts": {scan_id: len(self.points) for scan_id in scan_ids},
            "pointsByScan": rows,
        }


class ContractAndPreflightTests(unittest.TestCase):
    def test_production_reception_e57_identity_pin_is_exact(self) -> None:
        self.assertEqual(
            "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd",
            _REAL_RECEPTION_E57_SHA256,
        )
        self.assertEqual(20_518_437_888, _REAL_RECEPTION_E57_SIZE_BYTES)
        self.assertEqual(149, align.RECEPTION_E57_SCAN_COUNT)

    def test_module_import_does_not_require_geometry_packages(self) -> None:
        script = f"""
import builtins, importlib.util, sys
real_import = builtins.__import__
def guarded(name, *args, **kwargs):
    if name.split('.')[0] in {{'numpy', 'scipy', 'pye57'}}:
        raise ImportError(name)
    return real_import(name, *args, **kwargs)
builtins.__import__ = guarded
spec = importlib.util.spec_from_file_location('lazy_alignment', {str(MODULE_ROOT / 'align_e57_xgrids.py')!r})
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
print(module.SCHEMA_VERSION)
"""
        result = subprocess.run(
            [sys.executable, "-c", script],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn(align.SCHEMA_VERSION, result.stdout)

    def test_scan_scope_and_frozen_split_are_exact(self) -> None:
        self.assertEqual(tuple(range(122, 145)), align.parse_scan_range("122-144"))
        self.assertEqual((131, 134, 138), align.FROZEN_VALIDATION_SCAN_IDS)
        self.assertFalse(
            set(align.FROZEN_FIT_SCAN_IDS) & set(align.FROZEN_VALIDATION_SCAN_IDS)
        )
        for invalid in ("121-144", "122-143", "144-122", "122:144", "122 - 144"):
            with self.subTest(invalid=invalid), self.assertRaises(align.AlignmentError):
                align.parse_scan_range(invalid)

    def test_preflight_binds_bytes_and_stays_t505_ineligible(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = make_fixture(root)
            output = files["receiptRoot"] / "preflight.json"
            original_import = importlib.util.find_spec
            # execute() must not touch optional geometry dependencies in preflight mode.
            document = align.execute(preflight_args(files, output))
            self.assertTrue(output.is_file())
            self.assertEqual("none", document["authority"])
            self.assertEqual("preflight_complete_t505_blocked", document["status"])
            self.assertFalse(document["t505Eligibility"]["eligibleForT505Completion"])
            self.assertFalse(document["t505Eligibility"]["eligibleForT502Training"])
            self.assertEqual(
                sha256_bytes(files["ply"].read_bytes()),
                document["inputEvidence"]["xgridsPly"]["sha256"],
            )
            self.assertFalse(
                document["inputEvidence"]["xgridsPly"]["layout"][
                    "allDeclaredVertexXyzValidatedInDiagnostic"
                ]
            )
            preflight_ply_gate = next(
                gate
                for gate in document["t505Eligibility"]["gates"]
                if gate["gate"] == "complete_ply_container_validation"
            )
            self.assertEqual(
                "failed_vertex_and_nonvertex_payload_unparsed",
                preflight_ply_gate["status"],
            )
            self.assertIn("does not read or validate declared vertex xyz", preflight_ply_gate["meaning"])
            self.assertTrue(
                document["inputEvidence"]["e57"]["currentBytesFullyHashedThisRun"]
            )
            self.assertEqual(
                sha256_bytes(files["e57"].read_bytes()),
                document["inputEvidence"]["e57"]["currentBytesSha256"],
            )
            unsigned = copy.deepcopy(document)
            receipt = unsigned.pop("receipt")
            expected = hashlib.sha256(
                align.RECEIPT_DIGEST_DOMAIN + canonical(unsigned)
            ).hexdigest()
            self.assertEqual(expected, receipt["sha256"])
            self.assertIs(original_import, importlib.util.find_spec)

    def test_output_is_create_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = make_fixture(root)
            output = files["receiptRoot"] / "receipt.json"
            output.write_text("do not replace", encoding="utf-8")
            with self.assertRaises(align.AlignmentError) as caught:
                align.execute(preflight_args(files, output))
            self.assertEqual("OUTPUT_EXISTS", caught.exception.code)
            self.assertEqual("do not replace", output.read_text(encoding="utf-8"))

    def test_output_cannot_be_created_inside_stage_or_xgrids_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = make_fixture(root)
            for output in (
                files["stageManifest"].parent / "receipt.json",
                files["xgridsRoot"] / "receipt.json",
            ):
                with self.subTest(output=output), self.assertRaises(
                    align.AlignmentError
                ) as caught:
                    align.execute(preflight_args(files, output))
                self.assertEqual("OUTPUT_OVERLAPS_SOURCE_ROOT", caught.exception.code)
                self.assertFalse(output.exists())

    def test_atomic_publication_cleans_partial_temp_and_preserves_race_winner(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            partial_final = root / "partial.json"

            def fail_halfway(target: object, payload: bytes) -> None:
                target.write(payload[: len(payload) // 2])
                raise OSError("injected disk failure")

            with self.assertRaises(align.AlignmentError) as caught:
                align._write_create_only(
                    partial_final,
                    {"status": "complete"},
                    (),
                    (),
                    _write_hook=fail_halfway,
                )
            self.assertEqual("OUTPUT_WRITE_FAILED", caught.exception.code)
            self.assertFalse(partial_final.exists())
            self.assertEqual([], list(root.glob("*.private-tmp")))

            raced_final = root / "race.json"

            def create_race_winner(target: object, payload: bytes) -> None:
                target.write(payload)
                raced_final.write_text("race winner", encoding="utf-8")

            with self.assertRaises(align.AlignmentError) as caught:
                align._write_create_only(
                    raced_final,
                    {"status": "complete"},
                    (),
                    (),
                    _write_hook=create_race_winner,
                )
            self.assertEqual("OUTPUT_EXISTS", caught.exception.code)
            self.assertEqual("race winner", raced_final.read_text(encoding="utf-8"))
            self.assertEqual([], list(root.glob("*.private-tmp")))

    def test_exact_e57_hash_flag_is_mandatory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = make_fixture(root)
            arguments = preflight_args(
                files, files["receiptRoot"] / "preflight.json"
            )
            arguments.remove("--verify-e57-bytes")
            with self.assertRaises(align.AlignmentError) as caught:
                align.execute(arguments)
            self.assertEqual("INVALID_ARGUMENTS", caught.exception.code)

    def test_authority_none_evidence_cannot_claim_rights(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = make_fixture(root)
            evidence = json.loads(files["evidence"].read_text(encoding="utf-8"))
            evidence.pop("payloadSha256")
            evidence["authorizationDecision"]["trainingPermitted"] = True
            evidence["payloadSha256"] = hashlib.sha256(
                align.RECEPTION_EVIDENCE_DIGEST_DOMAIN + canonical(evidence)
            ).hexdigest()
            write_evidence(files["evidence"], evidence)
            with self.assertRaises(align.AlignmentError) as caught:
                align.execute(preflight_args(files, files["receiptRoot"] / "out.json"))
            self.assertEqual("UNSUPPORTED_RIGHTS_CLAIM", caught.exception.code)

    def test_jointly_redigested_manifest_and_audit_cannot_substitute_another_e57(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = make_fixture(root)
            replacement = b"different-nine-scan-lobby-placeholder"
            files["e57"].write_bytes(replacement)
            manifest = json.loads(files["stageManifest"].read_text(encoding="utf-8"))
            manifest["files"][0]["sizeBytes"] = len(replacement)
            manifest["files"][0]["sha256"] = sha256_bytes(replacement)
            manifest["totalBytes"] = len(replacement)
            files["stageManifest"].write_text(
                json.dumps(manifest, separators=(",", ":")), encoding="utf-8"
            )
            evidence = json.loads(files["evidence"].read_text(encoding="utf-8"))
            evidence.pop("payloadSha256")
            evidence["scope"]["sourceE57Sha256"] = sha256_bytes(replacement)
            evidence["scope"]["sourceE57SizeBytes"] = len(replacement)
            evidence["payloadSha256"] = hashlib.sha256(
                align.RECEPTION_EVIDENCE_DIGEST_DOMAIN + canonical(evidence)
            ).hexdigest()
            write_evidence(files["evidence"], evidence)
            with self.assertRaises(align.AlignmentError) as caught:
                align.execute(
                    preflight_args(
                        files, files["receiptRoot"] / "substitution.json"
                    )
                )
            self.assertEqual("UNEXPECTED_RECEPTION_E57_IDENTITY", caught.exception.code)

    def test_final_rehash_detects_same_size_restored_mtime_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = make_fixture(root)
            arguments = align.build_parser().parse_args(
                preflight_args(files, files["receiptRoot"] / "out.json")
            )
            bundle = align.inspect_inputs(arguments)
            before = files["ply"].stat()
            payload = files["ply"].read_bytes()
            first_vertex = payload.index(b"end_header\n") + len(b"end_header\n")
            changed = bytearray(payload)
            changed[first_vertex] = ord("9") if changed[first_vertex] != ord("9") else ord("8")
            changed = bytes(changed)
            self.assertNotEqual(payload, changed)
            self.assertEqual(len(payload), len(changed))
            files["ply"].write_bytes(changed)
            os.utime(files["ply"], ns=(before.st_atime_ns, before.st_mtime_ns))
            with self.assertRaises(align.AlignmentError) as caught:
                align._verify_bundle_unchanged(bundle)
            self.assertEqual("FILE_CHANGED_DURING_RUN", caught.exception.code)


class DefensiveParserTests(unittest.TestCase):
    def test_organized_e57_sampling_is_record_order_invariant(self) -> None:
        np = __import__("numpy")
        rows = np.asarray([18 * (index // 20) for index in range(100)], dtype=np.int64)
        columns = np.asarray([18 * (index % 20) for index in range(100)], dtype=np.int64)
        record = {
            "cartesianX": rows.astype(float) * 0.01,
            "cartesianY": columns.astype(float) * 0.01,
            "cartesianZ": np.asarray([index * 0.003 for index in range(100)]),
            "rowIndex": rows,
            "columnIndex": columns,
        }
        forward, forward_evidence = align._organized_e57_sample(
            record, 124, 40, np
        )
        permutation = np.asarray(list(reversed(range(100))))
        reversed_record = {
            name: values[permutation] for name, values in record.items()
        }
        reversed_sample, reversed_evidence = align._organized_e57_sample(
            reversed_record, 124, 40, np
        )
        np.testing.assert_array_equal(forward, reversed_sample)
        self.assertEqual(40, forward_evidence["samplePointCountAfterLimit"])
        self.assertEqual(
            forward_evidence["strideSelectedFiniteCellCount"],
            reversed_evidence["strideSelectedFiniteCellCount"],
        )
        self.assertFalse(
            forward_evidence["compactedFiniteStreamOrderUsedForGridSelection"]
        )

    def test_organized_e57_sampling_rejects_duplicate_cells(self) -> None:
        np = __import__("numpy")
        count = 40
        record = {
            "cartesianX": np.arange(count, dtype=float),
            "cartesianY": np.arange(count, dtype=float),
            "cartesianZ": np.arange(count, dtype=float),
            "rowIndex": np.zeros(count, dtype=int),
            "columnIndex": np.zeros(count, dtype=int),
        }
        with self.assertRaises(align.AlignmentError) as caught:
            align._organized_e57_sample(record, 124, 40, np)
        self.assertEqual("DUPLICATE_ORGANIZED_CELL", caught.exception.code)

    def test_binary_ply_is_read_defensively_and_ignores_faces(self) -> None:
        np = unittest.import_module("numpy") if hasattr(unittest, "import_module") else __import__("numpy")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cloud.ply"
            points = source_points(40)
            write_binary_ply(path, points)
            resolved, snapshot = align._safe_regular_file(path, "PLY", align.MAX_PLY_BYTES)
            layout = align._read_ply_header(resolved, snapshot)
            sample = align._load_ply_sample(
                resolved, snapshot, layout, 40, "test-seed", np
            )
            self.assertEqual((40, 3), sample.shape)
            self.assertEqual("binary_little_endian", layout.format_name)

    def test_rejects_vertex_lists_truncation_and_nonfinite_ascii(self) -> None:
        cases: list[tuple[str, bytes, str]] = []
        list_vertex = (
            "ply\nformat ascii 1.0\nelement vertex 40\n"
            "property float x\nproperty float y\nproperty float z\n"
            "property list uchar uint neighbors\nend_header\n"
        ).encode("ascii") + b"0 0 0 0\n" * 40
        cases.append(("list.ply", list_vertex, "UNSUPPORTED_VERTEX_LIST"))
        truncated = (
            "ply\nformat binary_little_endian 1.0\nelement vertex 40\n"
            "property float x\nproperty float y\nproperty float z\nend_header\n"
        ).encode("ascii") + struct.pack("<fff", 0.0, 0.0, 0.0)
        cases.append(("truncated.ply", truncated, "TRUNCATED_PLY_VERTICES"))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, payload, code in cases:
                with self.subTest(name=name):
                    path = root / name
                    path.write_bytes(payload)
                    resolved, snapshot = align._safe_regular_file(path, "PLY", align.MAX_PLY_BYTES)
                    with self.assertRaises(align.AlignmentError) as caught:
                        align._read_ply_header(resolved, snapshot)
                    self.assertEqual(code, caught.exception.code)

            nonfinite = root / "nonfinite.ply"
            points = source_points(40)
            write_ascii_ply(nonfinite, points)
            text = nonfinite.read_text(encoding="ascii")
            nonfinite.write_text(text.replace("0 0 0", "nan 0 0", 1), encoding="ascii")
            resolved, snapshot = align._safe_regular_file(nonfinite, "PLY", align.MAX_PLY_BYTES)
            layout = align._read_ply_header(resolved, snapshot)
            np = __import__("numpy")
            with self.assertRaises(align.AlignmentError) as caught:
                align._load_ply_sample(resolved, snapshot, layout, 40, "all", np)
            self.assertEqual("NONFINITE_PLY_POINT", caught.exception.code)

    def test_unsampled_nonfinite_vertex_is_still_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cloud.ply"
            points = source_points(100)
            points[-1][2] = float("nan")
            write_ascii_ply(path, points)
            resolved, snapshot = align._safe_regular_file(
                path, "PLY", align.MAX_PLY_BYTES
            )
            layout = align._read_ply_header(resolved, snapshot)
            with self.assertRaises(align.AlignmentError) as caught:
                align._load_ply_sample(
                    resolved, snapshot, layout, 32, "sample-that-may-skip-last", __import__("numpy")
                )
            self.assertEqual("NONFINITE_PLY_POINT", caught.exception.code)

    def test_poses_reject_nonmonotonic_time_and_duplicate_json_keys(self) -> None:
        payload = json.dumps(
            {
                "poses": [
                    {"ts": "2", "T": [0, 0, 0], "R": [1, 0, 0, 0], "RGB": None},
                    {"ts": "1", "T": [1, 0, 0], "R": [1, 0, 0, 0], "RGB": None},
                ],
                "fusionPoses": None,
            }
        ).encode()
        with self.assertRaises(align.AlignmentError) as caught:
            align._parse_poses(payload)
        self.assertEqual("NONMONOTONIC_POSES", caught.exception.code)
        duplicate = b'{"poses":[],"poses":[],"fusionPoses":null}'
        with self.assertRaises(align.AlignmentError) as caught:
            align._parse_poses(duplicate)
        self.assertEqual("DUPLICATE_JSON_KEY", caught.exception.code)

    def test_sampling_is_reproducible_and_not_an_even_prefix(self) -> None:
        first = align._deterministic_indices(10_007, 100, "bound-input-sha")
        second = align._deterministic_indices(10_007, 100, "bound-input-sha")
        other = align._deterministic_indices(10_007, 100, "different-sha")
        self.assertEqual(first, second)
        self.assertNotEqual(first, other)
        self.assertEqual(100, len(set(first)))
        self.assertNotEqual(list(range(100)), first)
        gaps = {(first[index + 1] - first[index]) % 10_007 for index in range(99)}
        self.assertEqual(1, len(gaps))
        self.assertNotEqual(1, next(iter(gaps)))


class DiagnosticGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        try:
            cls.np = __import__("numpy")
            cls.spatial = __import__("scipy.spatial", fromlist=["cKDTree"])
        except ImportError as error:  # pragma: no cover - environment dependent
            raise unittest.SkipTest(f"optional geometry dependencies unavailable: {error}")

    def transformed_points(self, points: list[list[float]]) -> list[list[float]]:
        return [[-point[1] + 4.0, point[0] - 2.0, point[2] + 1.0] for point in points]

    def test_proper_rigid_fit_recovers_known_transform(self) -> None:
        source = self.np.asarray(source_points())
        target = self.np.asarray(self.transformed_points(source.tolist()))
        rotation, translation, corrected = align.fit_proper_rigid(source, target, self.np)
        expected = self.np.asarray([[0, -1, 0], [1, 0, 0], [0, 0, 1]], dtype=float)
        self.np.testing.assert_allclose(expected, rotation, atol=1e-12)
        self.np.testing.assert_allclose([4, -2, 1], translation, atol=1e-12)
        self.assertAlmostEqual(1.0, float(self.np.linalg.det(rotation)), places=12)
        self.assertFalse(corrected)

    def test_diagnostic_is_machine_green_but_still_authority_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            points = source_points()
            files = make_fixture(root, points)
            preflight = align.execute(
                preflight_args(files, files["receiptRoot"] / "preflight.json")
            )
            adapter = FakeE57Adapter(self.transformed_points(points))
            document = align.execute(
                diagnostic_args(files, files["receiptRoot"] / "diagnostic.json", preflight),
                e57_adapter=adapter,
            )
            result = document["diagnostic"]
            self.assertTrue(
                document["inputEvidence"]["xgridsPly"]["layout"][
                    "allDeclaredVertexXyzValidatedInDiagnostic"
                ]
            )
            diagnostic_ply_gate = next(
                gate
                for gate in document["t505Eligibility"]["gates"]
                if gate["gate"] == "complete_ply_container_validation"
            )
            self.assertEqual(
                "failed_nonvertex_payload_unparsed", diagnostic_ply_gate["status"]
            )
            self.assertIn("Every declared vertex xyz is checked", diagnostic_ply_gate["meaning"])
            self.assertTrue(result["diagnosticThresholdResult"]["passesAllDiagnosticChecks"])
            self.assertTrue(result["negativeControls"]["separationPass"])
            determinant = result["fit"]["transform"]["determinantRotation"]
            self.assertAlmostEqual(1.0, determinant, places=8)
            self.assertAlmostEqual(
                -1.0,
                result["negativeControls"]["optimizedImproperMirrorCompetitor"]["determinantRotation"],
                places=8,
            )
            self.assertEqual(
                align.FROZEN_FIT_SCAN_IDS + align.FROZEN_VALIDATION_SCAN_IDS,
                adapter.requested,
            )
            self.assertFalse(document["t505Eligibility"]["eligibleForT505Completion"])
            self.assertIn(
                "authoritative_processing_and_commercial_rights",
                document["t505Eligibility"]["blockers"],
            )
            self.assertFalse(
                result["operatorProposedAccuracyThresholds"]["reviewedOrApproved"]
            )

    def test_validation_points_do_not_influence_fit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            points = source_points()
            files = make_fixture(root, points)
            preflight = align.execute(
                preflight_args(files, files["receiptRoot"] / "preflight.json")
            )
            adapter = FakeE57Adapter(
                self.transformed_points(points), validation_offset=100.0
            )
            arguments = diagnostic_args(
                files, files["receiptRoot"] / "diagnostic.json", preflight
            )
            document = align.execute(arguments, e57_adapter=adapter)
            transform = document["diagnostic"]["fit"]["transform"]
            self.np.testing.assert_allclose(
                [4.0, -2.0, 1.0], transform["translationMeters"], atol=1e-7
            )
            self.assertLess(
                document["diagnostic"]["trainingEvaluation"]["combinedStatisticsMeters"]["rmse"],
                1e-7,
            )
            self.assertGreater(
                document["diagnostic"]["frozenValidationEvaluation"]["metrics"]["combinedStatisticsMeters"]["rmse"],
                10.0,
            )
            self.assertFalse(
                document["diagnostic"]["frozenValidationEvaluation"]["usedDuringFit"]
            )

    def test_symmetric_axis_initialization_fails_ambiguity_gate(self) -> None:
        cube = self.np.asarray(
            [[x, y, z] for x in (-1.0, 1.0) for y in (-1.0, 1.0) for z in (-1.0, 1.0)]
            * 4
        )
        _, _, trace = align._fit_rigid_icp(
            cube,
            cube.copy(),
            maximum_iterations=3,
            trim_fraction=0.8,
            np=self.np,
            cKDTree=self.spatial.cKDTree,
        )
        self.assertFalse(trace["axisInitializationUnambiguous"])

    def test_improper_family_is_independently_refined_on_identical_samples(self) -> None:
        source = self.np.asarray(source_points())
        target = source.copy()
        target[:, 0] *= -1.0
        target += self.np.asarray([5.0, -3.0, 2.0])
        proper_rotation, proper_translation, proper_trace = align._fit_rigid_icp(
            source,
            target,
            maximum_iterations=20,
            trim_fraction=0.8,
            determinant_sign=1,
            np=self.np,
            cKDTree=self.spatial.cKDTree,
        )
        mirror_rotation, mirror_translation, mirror_trace = align._fit_rigid_icp(
            source,
            target,
            maximum_iterations=20,
            trim_fraction=0.8,
            determinant_sign=-1,
            np=self.np,
            cKDTree=self.spatial.cKDTree,
        )
        self.assertAlmostEqual(1.0, float(self.np.linalg.det(proper_rotation)), places=8)
        self.assertAlmostEqual(-1.0, float(self.np.linalg.det(mirror_rotation)), places=8)
        self.assertEqual(24, proper_trace["refinedMultiStartCount"])
        self.assertEqual(24, mirror_trace["refinedMultiStartCount"])
        proper_metrics = align._evaluate_bidirectional(
            source,
            target,
            proper_rotation,
            proper_translation,
            1e-5,
            self.np,
            self.spatial.cKDTree,
        )
        mirror_metrics = align._evaluate_bidirectional(
            source,
            target,
            mirror_rotation,
            mirror_translation,
            1e-5,
            self.np,
            self.spatial.cKDTree,
        )
        self.assertLess(mirror_metrics["combinedStatisticsMeters"]["rmse"], 1e-8)
        self.assertGreater(
            proper_metrics["combinedStatisticsMeters"]["rmse"],
            mirror_metrics["combinedStatisticsMeters"]["rmse"] + 1e-3,
        )

    def test_nearly_planar_geometry_is_rejected_by_conditioning_gate(self) -> None:
        points = self.np.asarray(
            [
                [float(index), float((index * index) % 17), 1e-10 * float(index % 3)]
                for index in range(80)
            ]
        )
        with self.assertRaises(align.AlignmentError) as caught:
            align._geometry_conditioning(points, "near-plane", self.np)
        self.assertEqual("ILL_CONDITIONED_GEOMETRY", caught.exception.code)

    def test_diagnostic_rejects_stale_preflight_digest_pin(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            points = source_points()
            files = make_fixture(root, points)
            preflight = align.execute(
                preflight_args(files, files["receiptRoot"] / "preflight.json")
            )
            arguments = diagnostic_args(
                files, files["receiptRoot"] / "diagnostic.json", preflight
            )
            pin_index = arguments.index("--expected-ply-sha256") + 1
            arguments[pin_index] = "0" * 64
            with self.assertRaises(align.AlignmentError) as caught:
                align.execute(
                    arguments,
                    e57_adapter=FakeE57Adapter(self.transformed_points(points)),
                )
            self.assertEqual("PINNED_DIGEST_MISMATCH", caught.exception.code)
            self.assertFalse((files["receiptRoot"] / "diagnostic.json").exists())


if __name__ == "__main__":
    unittest.main()
