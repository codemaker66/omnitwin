from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

from retrieve_e57_reference_views import (  # noqa: E402
    E57_AUDIT_DIGEST_DOMAIN,
    FACE_NAMES,
    GEOMETRY_PROVENANCE_LIMIT,
    GEOMETRY_HELDOUT_DIGEST_DOMAIN,
    HELDOUT_SCAN_IDS,
    QUERY_VIEWS,
    SOURCE_E57_SHA256,
    SOURCE_E57_SIZE_BYTES,
    EmbeddingTask,
    RetrievalError,
    _canonical_sha256,
    _verify_report_receipt,
    build_retrieval_bundle,
    parse_scan_range,
    rank_candidate_rotations,
    rotate_quarter_turns,
    verify_model_weights,
    verify_retrieval_bundle,
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def write_index(path: Path, index: dict[str, object]) -> None:
    unsigned = copy.deepcopy(index)
    unsigned.pop("indexReceipt", None)
    index["indexReceipt"] = {
        "algorithm": "SHA-256",
        "sha256": _canonical_sha256(unsigned),
    }
    path.write_text(
        json.dumps(index, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def write_report_and_rebind_index(bundle: Path, report: dict[str, object]) -> None:
    evidence = report["evidenceBinding"]
    assert isinstance(evidence, dict)
    unsigned = copy.deepcopy(report)
    unsigned_evidence = unsigned["evidenceBinding"]
    assert isinstance(unsigned_evidence, dict)
    unsigned_evidence.pop("reportReceipt", None)
    receipt = _canonical_sha256(unsigned)
    evidence["reportReceipt"] = {"algorithm": "SHA-256", "sha256": receipt}
    report_path = bundle / "report.json"
    report_path.write_text(
        json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    index_path = bundle / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    index["sourceReport"] = {
        "name": "report.json",
        "sizeBytes": report_path.stat().st_size,
        "sha256": sha256(report_path),
        "receiptSha256": receipt,
    }
    write_index(index_path, index)


class FakeExtractor:
    @property
    def evidence(self) -> dict[str, object]:
        return {
            "architecture": "deterministic-test-fixture",
            "networkAccess": "none",
        }

    def extract(self, tasks: list[EmbeddingTask]) -> np.ndarray:
        rows: list[np.ndarray] = []
        for task in tasks:
            digest = hashlib.sha256(
                f"{task.image.name}:{task.quarter_turns_clockwise}".encode("utf-8")
            ).digest()
            row = np.frombuffer(digest[:16], dtype=np.uint8).astype(np.float64) + 1.0
            rows.append(row)
        return np.stack(rows)


def build_test_bundle(*args: object, **kwargs: object) -> dict[str, object]:
    kwargs["allow_test_extractor"] = True
    return build_retrieval_bundle(*args, **kwargs)


def verify_test_bundle(path: Path) -> dict[str, object]:
    return verify_retrieval_bundle(path, allow_test_bundle=True)


def make_fixture(root: Path) -> tuple[Path, Path, Path, Path, Path]:
    query_root = root / "queries"
    candidate_root = root / "candidates"
    query_root.mkdir()
    candidate_root.mkdir()
    integrity: list[dict[str, object]] = []
    for index, view in enumerate(QUERY_VIEWS):
        image = np.zeros((48, 64, 3), dtype=np.uint8)
        image[:, :, 0] = 30 + index * 20
        image[8:40, 12 + index : 20 + index, 1] = 220
        path = query_root / f"matrix-{view}-fixture.png"
        Image.fromarray(image, mode="RGB").save(path)
        integrity.append(
            {"name": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}
        )
    manifest = root / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schemaVersion": "test.fixed-view.v1",
                "screenshotIntegrity": integrity,
            }
        ),
        encoding="utf-8",
    )

    cubefaces: list[dict[str, object]] = []
    for index, face in enumerate(FACE_NAMES):
        image = np.zeros((64, 64, 3), dtype=np.uint8)
        image[:, :, index % 3] = 70 + index * 20
        image[6 + index : 22 + index, 10:54, :] = 180
        path = candidate_root / f"scan_122_{face}.jpg"
        Image.fromarray(image, mode="RGB").save(path, quality=92)
        cubefaces.append(
            {
                "fileName": path.name,
                "face": face,
                "sizeBytes": path.stat().st_size,
                "sha256": sha256(path).lower(),
                "width": 64,
                "height": 64,
            }
        )
    (candidate_root / "_extract_v3_report.json").write_text(
        json.dumps({"status": "descriptive-test-fixture"}), encoding="utf-8"
    )
    audit_payload: dict[str, object] = {
        "schemaVersion": "omnitwin.reception.e57-room-image-audit.v1",
        "authority": "none",
        "counts": {"cubefaces": 6, "scans": 1},
        "scans": [
            {
                "scanId": 122,
                "visualReviewState": "not_cleared_native_review_required",
                "cubefaces": cubefaces,
            }
        ],
    }
    canonical = json.dumps(
        audit_payload,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    audit_payload["payloadSha256"] = hashlib.sha256(
        E57_AUDIT_DIGEST_DOMAIN + canonical
    ).hexdigest()
    audit = root / "e57-audit.json"
    audit.write_text(json.dumps(audit_payload), encoding="utf-8")
    geometry_payload: dict[str, object] = {
        "schemaVersion": "omnitwin.reception.e57-geometry-edge-audit.v2",
        "authority": "none",
        "scope": {
            "imageCount": 96,
            "heldOutScanIdsRead": list(HELDOUT_SCAN_IDS),
            "developmentEvidenceProvenanceLimit": GEOMETRY_PROVENANCE_LIMIT,
            "sourceE57": {
                "fileName": "cloud_0.e57",
                "sha256": SOURCE_E57_SHA256.lower(),
                "sizeBytes": SOURCE_E57_SIZE_BYTES,
            },
        },
        "result": {
            "status": "REJECT_GEOMETRY_MISMATCH",
            "trainingPermitted": False,
            "knownPoseMaterializationPermitted": False,
            "pointColourFieldsRequestedOrRead": False,
            "statusCounts": {"PASS_DISCRETE_GEOMETRY_ORIENTATION": 82},
        },
    }
    geometry_canonical = json.dumps(
        geometry_payload,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    geometry_payload["payloadSha256"] = hashlib.sha256(
        GEOMETRY_HELDOUT_DIGEST_DOMAIN + geometry_canonical
    ).hexdigest()
    geometry = root / "geometry-heldout.json"
    geometry.write_text(json.dumps(geometry_payload), encoding="utf-8")
    return query_root, candidate_root, manifest, audit, geometry


class E57ReferenceRetrievalTests(unittest.TestCase):
    def test_scan_range_is_strict_and_bounded(self) -> None:
        self.assertEqual(parse_scan_range("122-124"), (122, 123, 124))
        for value in ("122", "124-122", "1-1001", "122,123", "../122-144"):
            with self.subTest(value=value), self.assertRaises(RetrievalError):
                parse_scan_range(value)

    def test_quarter_turns_are_clockwise_and_lossless(self) -> None:
        source = Image.fromarray(
            np.asarray(
                [
                    [[1, 0, 0], [2, 0, 0], [3, 0, 0]],
                    [[4, 0, 0], [5, 0, 0], [6, 0, 0]],
                ],
                dtype=np.uint8,
            ),
            mode="RGB",
        )
        rotated = np.asarray(rotate_quarter_turns(source, 1))[:, :, 0]
        np.testing.assert_array_equal(rotated, np.asarray([[4, 1], [5, 2], [6, 3]]))
        restored = np.asarray(rotate_quarter_turns(source, 4))
        np.testing.assert_array_equal(restored, np.asarray(source))

    def test_ranking_chooses_one_best_rotation_per_image(self) -> None:
        queries = np.asarray([[1.0, 0.0]])
        candidates = np.asarray(
            [
                [0.0, 1.0],
                [0.2, 0.8],
                [1.0, 0.0],
                [0.4, 0.6],
                [0.9, 0.1],
                [0.0, 1.0],
                [0.0, 1.0],
                [0.0, 1.0],
            ]
        )
        ranked = rank_candidate_rotations(
            queries, candidates, ["scan_122_back.jpg", "scan_122_front.jpg"], 2
        )[0]
        self.assertEqual(ranked[0]["candidateName"], "scan_122_back.jpg")
        self.assertEqual(ranked[0]["quarterTurnsClockwise"], 2)
        self.assertEqual(ranked[1]["candidateName"], "scan_122_front.jpg")

    def test_model_hash_is_checked_before_loading(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            weights = Path(directory) / "weights.pth"
            weights.write_bytes(b"not a model")
            evidence = verify_model_weights(weights, sha256(weights))
            self.assertEqual(evidence["sha256"], sha256(weights))
            with self.assertRaisesRegex(RetrievalError, "mismatch"):
                verify_model_weights(weights, "0" * 64)

    def test_production_builder_rejects_a_test_extractor_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
            with self.assertRaisesRegex(RetrievalError, "pinned AlexNet extractor"):
                build_retrieval_bundle(
                    query_root,
                    manifest,
                    "fixture",
                    candidate_root,
                    audit,
                    geometry,
                    (122,),
                    root / "bundle",
                    FakeExtractor(),
                    3,
                )

    def test_full_fixture_bundle_is_atomic_and_receipted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
            output = root / "bundle"
            index = build_test_bundle(
                query_root,
                manifest,
                "fixture",
                candidate_root,
                audit,
                geometry,
                (122,),
                output,
                FakeExtractor(),
                3,
            )
            self.assertEqual(len(index["boards"]), 6)
            self.assertTrue(index["privateData"])
            self.assertEqual(len(list((output / "boards").glob("*.png"))), 6)
            with Image.open(output / "boards" / "match--overview.png") as board:
                self.assertEqual(board.info["reviewStateLabelsRendered"], "true")
                self.assertEqual(
                    json.loads(board.info["candidateReviewStates"]),
                    ["not_cleared_native_review_required"] * 3,
                )
            report = json.loads((output / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(
                _verify_report_receipt(report),
                report["evidenceBinding"]["reportReceipt"]["sha256"],
            )
            self.assertEqual(report["authority"]["level"], "none")
            geometry_binding = report["evidenceBinding"]["geometryEdgeHeldout"]
            self.assertEqual(
                geometry_binding["developmentEvidenceProvenanceLimit"],
                GEOMETRY_PROVENANCE_LIMIT,
            )
            self.assertEqual(
                geometry_binding["payloadIntegrityStatus"],
                "self_digest_verified_not_provenance",
            )
            self.assertEqual(
                geometry_binding["heldOutScanIdsRead"], list(HELDOUT_SCAN_IDS)
            )
            self.assertEqual(
                geometry_binding["sourceE57"]["sha256"], SOURCE_E57_SHA256
            )
            self.assertEqual(len(report["matches"][0]["rankings"]), 6)
            self.assertTrue(all(value is False for value in report["decisions"].values()))
            with self.assertRaisesRegex(RetrievalError, "test-extractor bundles"):
                verify_retrieval_bundle(output)
            verified = verify_test_bundle(output)
            self.assertEqual(verified["boardsVerified"], 6)
            self.assertTrue(verified["allDecisionsFalse"])
            self.assertFalse(verified["productionExtractorVerified"])
            tampered = copy.deepcopy(report)
            tampered["matches"][0]["rankings"][0]["cosineSimilarity"] += 0.01
            with self.assertRaisesRegex(RetrievalError, "does not match"):
                _verify_report_receipt(tampered)
            self.assertFalse(any(root.glob(".bundle.partial-*")))

    def test_verifier_rejects_board_and_support_file_tampering(self) -> None:
        for relative in ("boards/match--overview.png", "README.md"):
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
                output = root / "bundle"
                build_test_bundle(
                    query_root,
                    manifest,
                    "fixture",
                    candidate_root,
                    audit,
                    geometry,
                    (122,),
                    output,
                    FakeExtractor(),
                    3,
                )
                target = output / Path(relative)
                target.write_bytes(target.read_bytes() + b"tamper")
                with self.assertRaisesRegex(RetrievalError, "does not bind"):
                    verify_test_bundle(output)

    def test_verifier_rejects_redigested_duplicate_support_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
            output = root / "bundle"
            build_test_bundle(
                query_root,
                manifest,
                "fixture",
                candidate_root,
                audit,
                geometry,
                (122,),
                output,
                FakeExtractor(),
                3,
            )
            index_path = output / "index.json"
            index = json.loads(index_path.read_text(encoding="utf-8"))
            index["supportFiles"][1] = copy.deepcopy(index["supportFiles"][0])
            write_index(index_path, index)
            with self.assertRaisesRegex(RetrievalError, "exactly once"):
                verify_test_bundle(output)

    def test_verifier_rejects_redigested_extra_match_row(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
            output = root / "bundle"
            build_test_bundle(
                query_root,
                manifest,
                "fixture",
                candidate_root,
                audit,
                geometry,
                (122,),
                output,
                FakeExtractor(),
                3,
            )
            report = json.loads((output / "report.json").read_text(encoding="utf-8"))
            report["matches"].append(copy.deepcopy(report["matches"][0]))
            write_report_and_rebind_index(output, report)
            with self.assertRaisesRegex(RetrievalError, "six fixed views"):
                verify_test_bundle(output)

    def test_verifier_rejects_index_receipt_tampering_and_extra_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
            output = root / "bundle"
            build_test_bundle(
                query_root,
                manifest,
                "fixture",
                candidate_root,
                audit,
                geometry,
                (122,),
                output,
                FakeExtractor(),
                3,
            )
            index_path = output / "index.json"
            original = index_path.read_bytes()
            index = json.loads(original)
            index["warning"] += " altered"
            index_path.write_text(json.dumps(index), encoding="utf-8")
            with self.assertRaisesRegex(RetrievalError, "receipt does not match"):
                verify_test_bundle(output)
            index_path.write_bytes(original)
            (output / "unexpected.txt").write_text("unexpected", encoding="utf-8")
            with self.assertRaisesRegex(RetrievalError, "unexpected file"):
                verify_test_bundle(output)

    def test_verifier_rejects_bundle_symlink_when_supported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
            output = root / "bundle"
            build_test_bundle(
                query_root,
                manifest,
                "fixture",
                candidate_root,
                audit,
                geometry,
                (122,),
                output,
                FakeExtractor(),
                3,
            )
            link = output / "linked-warning.txt"
            try:
                link.symlink_to(output / "PRIVATE-DATA-WARNING.txt")
            except OSError as error:
                self.skipTest(f"symlinks unavailable in this environment: {error}")
            with self.assertRaisesRegex(RetrievalError, "symbolic link"):
                verify_test_bundle(output)

    def test_query_tampering_stops_before_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
            target = query_root / "matrix-overview-fixture.png"
            target.write_bytes(target.read_bytes() + b"tamper")
            output = root / "bundle"
            with self.assertRaisesRegex(RetrievalError, "capture-manifest integrity"):
                build_test_bundle(
                    query_root,
                    manifest,
                    "fixture",
                    candidate_root,
                    audit,
                    geometry,
                    (122,),
                    output,
                    FakeExtractor(),
                    3,
                )
            self.assertFalse(output.exists())

    def test_cube_face_tampering_is_rejected_by_e57_audit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
            target = candidate_root / "scan_122_left.jpg"
            target.write_bytes(target.read_bytes() + b"tamper")
            with self.assertRaisesRegex(RetrievalError, "E57 image-audit integrity"):
                build_test_bundle(
                    query_root,
                    manifest,
                    "fixture",
                    candidate_root,
                    audit,
                    geometry,
                    (122,),
                    root / "bundle",
                    FakeExtractor(),
                    3,
                )

    def test_e57_audit_payload_tampering_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
            payload = json.loads(audit.read_text(encoding="utf-8"))
            payload["counts"]["cubefaces"] = 99
            audit.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(RetrievalError, "payload SHA-256"):
                build_test_bundle(
                    query_root,
                    manifest,
                    "fixture",
                    candidate_root,
                    audit,
                    geometry,
                    (122,),
                    root / "bundle",
                    FakeExtractor(),
                    3,
                )

    def test_redigested_geometry_report_cannot_drop_provenance_limit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
            payload = json.loads(geometry.read_text(encoding="utf-8"))
            payload.pop("payloadSha256")
            payload["scope"]["developmentEvidenceProvenanceLimit"] = "verified"
            canonical = json.dumps(
                payload,
                allow_nan=False,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
            payload["payloadSha256"] = hashlib.sha256(
                GEOMETRY_HELDOUT_DIGEST_DOMAIN + canonical
            ).hexdigest()
            geometry.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(RetrievalError, "frozen negative result"):
                build_test_bundle(
                    query_root,
                    manifest,
                    "fixture",
                    candidate_root,
                    audit,
                    geometry,
                    (122,),
                    root / "bundle",
                    FakeExtractor(),
                    3,
                )

    def test_candidate_derivation_report_must_be_a_regular_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
            derivation = candidate_root / "_extract_v3_report.json"
            derivation.unlink()
            derivation.mkdir()
            with self.assertRaisesRegex(RetrievalError, "regular file"):
                build_test_bundle(
                    query_root,
                    manifest,
                    "fixture",
                    candidate_root,
                    audit,
                    geometry,
                    (122,),
                    root / "bundle",
                    FakeExtractor(),
                    3,
                )

    def test_existing_output_is_never_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            query_root, candidate_root, manifest, audit, geometry = make_fixture(root)
            output = root / "bundle"
            output.mkdir()
            marker = output / "keep.txt"
            marker.write_text("keep", encoding="utf-8")
            with self.assertRaisesRegex(RetrievalError, "already exists"):
                build_test_bundle(
                    query_root,
                    manifest,
                    "fixture",
                    candidate_root,
                    audit,
                    geometry,
                    (122,),
                    output,
                    FakeExtractor(),
                    3,
                )
            self.assertEqual(marker.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
