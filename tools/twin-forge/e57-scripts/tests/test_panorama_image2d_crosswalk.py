from __future__ import annotations

import ast
import base64
import copy
from dataclasses import replace
import hashlib
import json
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from e57_image2d_evidence import DecodedJpeg, EvidenceProfile, canonical_json_bytes
import panorama_image2d_crosswalk as crosswalk
from panorama_image2d_crosswalk import (
    CROSSWALK_NAME,
    MATRIX_NAME,
    RECEIPT_NAME,
    CandidateVerification,
    CrosswalkProfile,
    Data3DSource,
    DependencyAttestation,
    DependencyPackageAttestation,
    FROZEN_CONFIGURATION,
    FeatureArtifact,
    GeneratorBinding,
    GeneratorFileBinding,
    PanoramaFeature,
    PanoramaSource,
    RankingPolicy,
    RetrievalScore,
    ScanFeature,
    SourceBindings,
    build_crosswalk_manifest,
    build_panorama_descriptor,
    build_publication_receipt,
    build_score_matrix_manifest,
    build_source_bindings,
    collect_stable_panorama_inventory,
    current_runtime_identity,
    load_strict_json_bytes,
    parse_panorama_display_name,
    publish_crosswalk_pack,
    rank_candidate_correspondences,
    score_complete_candidate_matrix,
    select_bidirectional_shortlist,
    verify_crosswalk_pack,
    verify_dependency_lock,
    verify_final_input_custody,
)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def generator_binding() -> GeneratorBinding:
    files = tuple(
        GeneratorFileBinding(path, f"{index + 1:x}" * 64, index + 1)
        for index, path in enumerate(crosswalk.GENERATOR_PATHS)
    )
    return GeneratorBinding("a" * 40, files)


def dependency_attestation() -> DependencyAttestation:
    packages = (
        DependencyPackageAttestation("numpy", 1, "3" * 64, "4" * 64),
        DependencyPackageAttestation("opencv-python-headless", 1, "5" * 64, "6" * 64),
    )
    return DependencyAttestation("same_host_same_binary_only", "7" * 64, packages, "8" * 64)


def candidate_verification(panorama: str, guid: str, inliers: int, supported_faces: int, ratio: int) -> CandidateVerification:
    counts = [0] * 6
    for index in range(supported_faces):
        counts[index] = crosswalk.FROZEN_CONFIGURATION.verification.supported_face_inliers
    counts[0] += inliers - sum(counts)
    pairs = tuple((index, max(0, count)) for index, count in enumerate(counts))
    supported = sum(count >= FROZEN_CONFIGURATION.verification.supported_face_inliers for _, count in pairs)
    coherent = supported >= FROZEN_CONFIGURATION.ranking.minimum_supported_faces
    total = sum(count for _, count in pairs)
    median, p95, reflection = (100, 200, False) if total else (None, None, None)
    return CandidateVerification(panorama, guid, total, supported, ratio, median, p95, reflection, coherent, pairs)


def wheel_record(members: dict[str, bytes], record_path: str) -> bytes:
    rows = []
    for name, content in sorted(members.items()):
        encoded = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).decode().rstrip("=")
        rows.append(f"{name},sha256={encoded},{len(content)}")
    rows.append(f"{record_path},,")
    return ("\n".join(rows) + "\n").encode()


def write_fixture_wheel(wheel_path: Path, site_root: Path, root_name: str, content: bytes) -> tuple[dict, Path]:
    dist_info = root_name + "-1.0.dist-info"
    license_path = dist_info + "/LICENSE.txt"
    notice_path = dist_info + "/NOTICE.txt"
    runtime_member = root_name + "/runtime.bin"
    source_member = root_name + "/__init__.py"
    record_path = dist_info + "/RECORD"
    members = {
        license_path: b"license",
        notice_path: b"notice",
        runtime_member: content,
        source_member: b"VERSION = '1.0'\n",
    }
    members[record_path] = wheel_record(members, record_path)
    with zipfile.ZipFile(wheel_path, "w") as archive:
        for name, payload in sorted(members.items()):
            archive.writestr(name, payload)
    for name, payload in members.items():
        target = site_root / Path(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    (site_root / dist_info / "INSTALLER").write_bytes(b"pip")
    count, tree_sha = crosswalk._verify_installed_distribution(wheel_path, site_root)
    item = {
        "installedFileCount": count,
        "installedTreeSha256": tree_sha,
        "license": "fixture",
        "licenseFile": license_path,
        "licenseFileSha256": digest_bytes(b"license"),
        "runtimeFiles": [{"name": "primary", "runtimeFileSha256": digest_bytes(content), "wheelRuntimeMember": runtime_member}],
        "sourceUrl": "https://files.pythonhosted.org/example/" + wheel_path.name,
        "thirdPartyNoticeFile": notice_path,
        "thirdPartyNoticeFileSha256": digest_bytes(b"notice"),
        "version": "1.0",
        "wheelFile": wheel_path.name,
        "wheelSha256": digest_bytes(wheel_path.read_bytes()),
        "wheelSizeBytes": wheel_path.stat().st_size,
    }
    return item, site_root / runtime_member


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class FakeBackend:
    dependency_versions = {"numpy": "1.0", "opencv-python-headless": "2.0"}

    def complete_retrieval(self, panoramas, scans):
        return [
            RetrievalScore(panorama.panorama_sha256, scan.data3d_guid, int(panorama.panorama_sha256[:4], 16) + len(scan.data3d_guid), 1)
            for panorama in reversed(panoramas)
            for scan in reversed(scans)
        ]


def dummy_evidence_profile() -> EvidenceProfile:
    return EvidenceProfile(digest("e57"), 3, 1, 1, 1, 8, 8, 4, 1024, 1024)


def profile_for_manifest(content: bytes, count: int, inventory_digest: str) -> CrosswalkProfile:
    return CrosswalkProfile(
        count, 1, 1, 16, 8, hashlib.sha256(content).hexdigest(), len(content),
        "b" * 64, inventory_digest, "c" * 64, 1, "d" * 64, 1,
        dummy_evidence_profile(),
    )


def manifest_bytes(records: list[dict], inventory_digest: str = "a" * 64) -> bytes:
    value = {
        "authority": "none",
        "manifestSha256": "sha256:" + "b" * 64,
        "sourceBindings": {
            "panoramaInventory": {
                "fileCount": len(records),
                "inventorySha256": "sha256:" + inventory_digest,
                "records": records,
            }
        },
    }
    return canonical_json_bytes(value)


def panorama_record(name: str, content: bytes) -> dict:
    number, token = parse_panorama_display_name(name)
    return {
        "byteLength": len(content),
        "digitToken": token,
        "relativePath": name,
        "sha256": "sha256:" + hashlib.sha256(content).hexdigest(),
        "sweepNumber": number,
    }


def fake_decoder(_content: bytes) -> DecodedJpeg:
    return DecodedJpeg(16, 8, "RGB", "JPEG")


class PanoramaImage2DCrosswalkTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary_root = os.environ.get("E57_EVIDENCE_TEST_TMP")
        self.temporary = tempfile.TemporaryDirectory(dir=temporary_root)
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _write_inventory(self, names: list[str], payloads: list[bytes], reverse: bool = False):
        panorama_root = self.root / ("panos-reversed" if reverse else "panos")
        panorama_root.mkdir()
        records = []
        for name, content in zip(names, payloads):
            (panorama_root / name).write_bytes(content)
            records.append(panorama_record(name, content))
        if reverse:
            records.reverse()
        content = manifest_bytes(records)
        manifest = self.root / ("manifest-reversed.json" if reverse else "manifest.json")
        manifest.write_bytes(content)
        return panorama_root, manifest, profile_for_manifest(content, len(records), "a" * 64)

    def test_parses_the_full_filename_digit_run_without_aliasing(self) -> None:
        self.assertEqual(parse_panorama_display_name("sweep_014jpg.jpg"), (14, "014"))
        self.assertEqual(parse_panorama_display_name("sweep_0148jpg.jpg"), (148, "0148"))
        self.assertEqual(parse_panorama_display_name("sweep_0149jpg.jpg"), (149, "0149"))
        self.assertEqual(parse_panorama_display_name("sweep_099pg.jpg"), (99, "099"))

    def test_inventory_is_byte_identified_and_permutation_independent(self) -> None:
        names = ["sweep_014jpg.jpg", "sweep_0148jpg.jpg", "sweep_0149jpg.jpg"]
        payloads = [b"fourteen", b"one-forty-eight", b"one-forty-nine"]
        first = self._write_inventory(names, payloads)
        second = self._write_inventory(names, payloads, reverse=True)
        left = collect_stable_panorama_inventory(*first, fake_decoder)
        right = collect_stable_panorama_inventory(*second, fake_decoder)
        self.assertEqual([item.sha256 for item in left], [item.sha256 for item in right])
        self.assertEqual({item.display_sweep_number for item in left}, {14, 148, 149})

    def test_inventory_rejects_duplicate_bytes_drift_and_reported_reparse(self) -> None:
        names = ["sweep_001jpg.jpg", "sweep_002jpg.jpg"]
        source = self._write_inventory(names, [b"same", b"same"])
        with self.assertRaisesRegex(ValueError, "identities must be unique"):
            collect_stable_panorama_inventory(*source, fake_decoder)
        source = self._write_inventory(["sweep_003jpg.jpg"], [b"original"], reverse=True)
        original = crosswalk._is_link_or_reparse
        with patch.object(crosswalk, "_is_link_or_reparse", side_effect=lambda path: path.name == "sweep_003jpg.jpg" or original(path)):
            with self.assertRaisesRegex(ValueError, "linked"):
                collect_stable_panorama_inventory(*source, fake_decoder)

    def test_inventory_rejects_a_decode_time_source_race(self) -> None:
        panorama_root, manifest, profile = self._write_inventory(["sweep_004jpg.jpg"], [b"original"])
        changed = False

        def racing_decoder(content: bytes) -> DecodedJpeg:
            nonlocal changed
            if not changed:
                (panorama_root / "sweep_004jpg.jpg").write_bytes(content + b"changed")
                changed = True
            return fake_decoder(content)

        with self.assertRaisesRegex(ValueError, "drifted"):
            collect_stable_panorama_inventory(panorama_root, manifest, profile, racing_decoder)

    def test_strict_json_rejects_duplicate_keys_and_nonfinite_constants(self) -> None:
        with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
            load_strict_json_bytes(b'{"authority":"none","authority":"none"}', "input")
        with self.assertRaisesRegex(ValueError, "constant is not permitted"):
            load_strict_json_bytes(b'{"score":NaN}', "input")

    def test_complete_matrix_is_22052_pairs_and_order_independent(self) -> None:
        panoramas = [PanoramaFeature(digest(f"pano-{index}"), FeatureArtifact(digest(f"pano-{index}"), 1, 1, (), ())) for index in range(148)]
        scans = [ScanFeature(f"guid-{index:03d}", ()) for index in range(149)]
        first = score_complete_candidate_matrix(panoramas, scans, FakeBackend())
        second = score_complete_candidate_matrix(list(reversed(panoramas)), list(reversed(scans)), FakeBackend())
        self.assertEqual(len(first), 22_052)
        self.assertEqual(first, second)

    def test_complete_matrix_rejects_missing_or_duplicate_pairs(self) -> None:
        panorama = PanoramaFeature("a" * 64, FeatureArtifact("a" * 64, 1, 1, (), ()))
        scan = ScanFeature("guid", ())
        backend = FakeBackend()
        backend.complete_retrieval = lambda _panoramas, _scans: []
        with self.assertRaisesRegex(ValueError, "complete candidate universe"):
            score_complete_candidate_matrix([panorama], [scan], backend)

    def test_bidirectional_shortlist_includes_row_and_column_winners(self) -> None:
        scores = [
            RetrievalScore("p1", "g1", 100, 2), RetrievalScore("p1", "g2", 90, 2),
            RetrievalScore("p2", "g1", 80, 2), RetrievalScore("p2", "g2", 1, 1),
        ]
        policy = replace(RankingPolicy(), row_shortlist_count=1, column_shortlist_count=1)
        self.assertEqual(select_bidirectional_shortlist(scores, policy), [("p1", "g1"), ("p1", "g2"), ("p2", "g1")])

    def test_shortlist_verifier_rejects_duplicate_backend_rows_and_inconsistent_counts(self) -> None:
        empty = FeatureArtifact("1" * 64, 1, 1, (), ())
        panoramas = [PanoramaFeature("1" * 64, empty), PanoramaFeature("2" * 64, replace(empty, identity_sha256="2" * 64))]
        scans = [ScanFeature("g", ())]

        class DuplicateVerifier:
            def verify_candidate(self, _panorama, _scan):
                return candidate_verification("1" * 64, "g", 0, 0, 0)

        shortlist = [("1" * 64, "g"), ("2" * 64, "g")]
        with self.assertRaisesRegex(ValueError, "incomplete or drifted identities"):
            crosswalk.verify_shortlist_candidates(shortlist, panoramas, scans, DuplicateVerifier())
        invalid = replace(candidate_verification("1" * 64, "g", 30, 3, 30), spherical_inliers=29)
        with self.assertRaisesRegex(ValueError, "per-face counts"):
            crosswalk._validate_verification(invalid)

    def test_ranking_fails_closed_for_weak_and_tied_candidates(self) -> None:
        panorama_ids = ["clear", "tie", "weak"]
        scores = [RetrievalScore(pano, guid, 10, 1) for pano in panorama_ids for guid in ("g1", "g2", "g3")]
        verified = [
            candidate_verification("clear", "g1", 300, 4, 300),
            candidate_verification("clear", "g2", 20, 1, 20),
            candidate_verification("clear", "g3", 10, 1, 10),
            candidate_verification("tie", "g1", 20, 1, 20),
            candidate_verification("tie", "g2", 220, 4, 220),
            candidate_verification("tie", "g3", 180, 4, 180),
            candidate_verification("weak", "g1", 20, 1, 20),
            candidate_verification("weak", "g2", 10, 1, 10),
            candidate_verification("weak", "g3", 5, 0, 5),
        ]
        rows = rank_candidate_correspondences(panorama_ids, scores, verified, RankingPolicy())
        states = {row["panoramaSha256"]: row["state"] for row in rows}
        self.assertEqual(states, {"clear": "candidate_human_pending", "tie": "ambiguous_human_pending", "weak": "no_supported_candidate"})
        self.assertIsNone(next(row for row in rows if row["state"] == "ambiguous_human_pending")["candidateData3DGuid"])

    def test_column_collision_is_reciprocally_ambiguous_without_bijection(self) -> None:
        scores = [RetrievalScore(pano, guid, 10, 1) for pano in ("p1", "p2") for guid in ("g1", "g2")]
        verified = [
            candidate_verification(pano, guid, 220 if guid == "g1" else 20, 4 if guid == "g1" else 1, 220)
            for pano in ("p1", "p2") for guid in ("g1", "g2")
        ]
        rows = rank_candidate_correspondences(["p1", "p2"], scores, verified, RankingPolicy())
        self.assertTrue(all(row["state"] == "ambiguous_human_pending" for row in rows))
        self.assertTrue(all(row["candidateData3DGuid"] is None for row in rows))
        self.assertTrue(all("duplicate_data3d_selection" in row["ambiguityReasons"] for row in rows))

    def _bindings(self) -> SourceBindings:
        return SourceBindings(*(["a" * 64, 1, "b" * 64, "c" * 64, 1, "d" * 64, 1, "e" * 64, "f" * 64]))

    def _matrix(self) -> dict:
        panorama = "7" * 64
        scores = [RetrievalScore(panorama, "g", 0, 0)]
        return build_score_matrix_manifest(scores, self._bindings(), FROZEN_CONFIGURATION, generator_binding(), dependency_attestation(), [panorama], ["g"])

    def _crosswalk(self, matrix: dict, size: int, digest_value: str) -> dict:
        snapshot = crosswalk.FileSnapshot(1, 1, 1, 1, 1, 1)
        pano = PanoramaSource("7" * 64, 1, 16, 8, self.root / "p", snapshot, "sweep_001jpg.jpg", 1, "001")
        scan = Data3DSource("g", (), 0)
        scores = [RetrievalScore("7" * 64, "g", 0, 0)]
        verified = [candidate_verification("7" * 64, "g", 0, 0, 0)]
        rows = rank_candidate_correspondences(["7" * 64], scores, verified, RankingPolicy())
        return build_crosswalk_manifest(rows, [pano], [scan], self._bindings(), digest_value, size, FROZEN_CONFIGURATION, generator_binding(), dependency_attestation())

    def _publish(self, output: Path, matrix: dict):
        return publish_crosswalk_pack(
            output, matrix, lambda size, value: self._crosswalk(matrix, size, value),
            self._bindings(), FROZEN_CONFIGURATION, generator_binding(), dependency_attestation(),
        )

    def _valid_manifest_set(self):
        matrix = self._matrix()
        matrix_bytes = canonical_json_bytes(matrix)
        crosswalk_value = self._crosswalk(matrix, len(matrix_bytes), digest_bytes(matrix_bytes))
        receipt = build_publication_receipt(
            matrix_bytes, canonical_json_bytes(crosswalk_value), self._bindings(),
            FROZEN_CONFIGURATION, generator_binding(), dependency_attestation(),
        )
        return matrix, crosswalk_value, receipt

    def test_publication_is_deterministic_no_replace_and_receipt_last(self) -> None:
        matrix = self._matrix()
        outputs = [self.root / "first", self.root / "second"]
        writes = []
        original_write = crosswalk._write_exclusive

        def recording_write(path: Path, content: bytes) -> None:
            writes.append(path.name)
            original_write(path, content)

        with patch.object(crosswalk, "_write_exclusive", side_effect=recording_write):
            self._publish(outputs[0], matrix)
        self._publish(outputs[1], matrix)
        self.assertEqual(writes[-1], RECEIPT_NAME)
        for name in (MATRIX_NAME, CROSSWALK_NAME, RECEIPT_NAME):
            self.assertEqual((outputs[0] / name).read_bytes(), (outputs[1] / name).read_bytes())
        with self.assertRaisesRegex(ValueError, "refusing to replace"):
            self._publish(outputs[0], matrix)
        receipt = json.loads((outputs[0] / RECEIPT_NAME).read_text())
        self.assertTrue(receipt["receiptWrittenLast"])

    def test_pack_verifier_rejects_extra_and_tampered_receipt(self) -> None:
        matrix = self._matrix()
        output = self.root / "pack"
        _, expected = self._publish(output, matrix)
        (output / "extra").write_bytes(b"x")
        with self.assertRaisesRegex(ValueError, "inventory"):
            verify_crosswalk_pack(output, matrix, expected, self._bindings(), FROZEN_CONFIGURATION, generator_binding(), dependency_attestation())
        (output / "extra").unlink()
        receipt = output / RECEIPT_NAME
        receipt.write_bytes(receipt.read_bytes().replace(b'"publicationComplete": true', b'"publicationComplete": false'))
        with self.assertRaisesRegex(ValueError, "receipt"):
            verify_crosswalk_pack(output, matrix, expected, self._bindings(), FROZEN_CONFIGURATION, generator_binding(), dependency_attestation())

    def test_pack_verifier_rejects_a_same_run_output_race(self) -> None:
        matrix = self._matrix()
        output = self.root / "racing-pack"
        _, expected = self._publish(output, matrix)
        original_load = crosswalk._load_canonical_stable
        calls = 0

        def racing_load(path: Path, snapshot, label: str):
            nonlocal calls
            result = original_load(path, snapshot, label)
            calls += 1
            if calls == 1:
                (output / MATRIX_NAME).write_bytes(result[1] + b" ")
            return result

        with patch.object(crosswalk, "_load_canonical_stable", side_effect=racing_load):
            with self.assertRaisesRegex(ValueError, "changed during strict verification"):
                verify_crosswalk_pack(output, matrix, expected, self._bindings(), FROZEN_CONFIGURATION, generator_binding(), dependency_attestation())

    def test_publication_rechecks_after_atomic_rename(self) -> None:
        matrix = self._matrix()
        output = self.root / "post-rename-race"
        original = crosswalk.verify_crosswalk_pack

        def racing_verify(root, *arguments):
            if root == output:
                path = root / MATRIX_NAME
                path.write_bytes(path.read_bytes() + b" ")
            return original(root, *arguments)

        with patch.object(crosswalk, "verify_crosswalk_pack", side_effect=racing_verify):
            with self.assertRaisesRegex(ValueError, "canonical evidence JSON"):
                self._publish(output, matrix)

    def test_independent_semantic_validators_reject_authority_counts_and_shortlist_drift(self) -> None:
        matrix, crosswalk_value, receipt = self._valid_manifest_set()
        altered_matrix = copy.deepcopy(matrix)
        altered_matrix["authority"] = "confirmed"
        with self.assertRaisesRegex(ValueError, "authority"):
            crosswalk.validate_matrix_manifest(altered_matrix, self._bindings(), FROZEN_CONFIGURATION, generator_binding(), dependency_attestation(), ["7" * 64], ["g"])
        altered_crosswalk = copy.deepcopy(crosswalk_value)
        altered_crosswalk["results"][0]["candidates"] = []
        with self.assertRaisesRegex(ValueError, "matrix-derived shortlist"):
            crosswalk.validate_crosswalk_manifest_without_sources(altered_crosswalk, matrix, self._bindings(), FROZEN_CONFIGURATION, generator_binding(), dependency_attestation())
        altered_crosswalk = copy.deepcopy(crosswalk_value)
        altered_crosswalk["results"][0]["candidates"][0]["cubeCoherent"] = True
        with self.assertRaisesRegex(ValueError, "cube-coherence"):
            crosswalk.validate_crosswalk_manifest_without_sources(altered_crosswalk, matrix, self._bindings(), FROZEN_CONFIGURATION, generator_binding(), dependency_attestation())
        altered_receipt = {**receipt, "authority": "runtime"}
        with self.assertRaisesRegex(ValueError, "authority"):
            crosswalk.validate_receipt_manifest(altered_receipt, canonical_json_bytes(matrix), canonical_json_bytes(crosswalk_value), self._bindings(), FROZEN_CONFIGURATION, generator_binding(), dependency_attestation())

    def test_final_custody_rehash_rejects_tamper_even_if_metadata_is_spoofed(self) -> None:
        path = self.root / "source.jpg"
        content = b"first"
        path.write_bytes(content)
        snapshot = crosswalk._snapshot(path)
        source = PanoramaSource(digest("first"), len(content), 16, 8, path, snapshot, "sweep_001jpg.jpg", 1, "001")

        class DescriptorBackend:
            def extract_panorama(self, identity_sha256, _content):
                return FeatureArtifact(identity_sha256, 16, 8, (), ())

        build_panorama_descriptor(source, DescriptorBackend())
        path.write_bytes(b"other")
        with patch.object(crosswalk, "_snapshot", return_value=snapshot):
            with self.assertRaisesRegex(ValueError, "custody SHA-256 drifted"):
                verify_final_input_custody(crosswalk.InputCustody((), (), ()), [source], [])

    def test_added_empty_directory_breaks_input_custody_inventory(self) -> None:
        panorama_root = self.root / "custody-panoramas"
        image2d_root = self.root / "custody-image2d"
        panorama_root.mkdir()
        image2d_root.mkdir()
        manifest = self.root / "custody-manifest.json"
        manifest.write_bytes(b"{}")
        (image2d_root / "image2d-inventory-authority-none.json").write_bytes(b"{}")
        (image2d_root / RECEIPT_NAME).write_bytes(b"{}")
        custody = crosswalk.capture_input_custody(panorama_root, manifest, image2d_root)
        (panorama_root / "unexpected-empty-directory").mkdir()
        with self.assertRaisesRegex(ValueError, "inventory drifted"):
            crosswalk.verify_input_custody(custody)

    def test_final_custody_rehash_rejects_manifest_tamper_with_spoofed_metadata(self) -> None:
        panorama_root = self.root / "manifest-race-panoramas"
        image2d_root = self.root / "manifest-race-image2d"
        panorama_root.mkdir()
        image2d_root.mkdir()
        manifest = self.root / "manifest-race.json"
        files = [manifest, image2d_root / "image2d-inventory-authority-none.json", image2d_root / RECEIPT_NAME]
        for path in files:
            path.write_bytes(b"{}")
        custody = crosswalk.capture_input_custody(panorama_root, manifest, image2d_root)
        manifest.write_bytes(b"[]")
        snapshots = dict(custody.file_snapshots)
        original_snapshot = crosswalk._snapshot

        def spoofed_snapshot(path: Path):
            return snapshots.get(path, original_snapshot(path))

        with patch.object(crosswalk, "_snapshot", side_effect=spoofed_snapshot):
            with self.assertRaisesRegex(ValueError, "file SHA-256 drifted"):
                verify_final_input_custody(custody, [], [])

    def test_source_bindings_ignore_display_renaming_and_permutation(self) -> None:
        snapshot = crosswalk.FileSnapshot(1, 1, 1, 1, 1, 1)
        left = [
            PanoramaSource("1" * 64, 1, 16, 8, Path("a"), snapshot, "sweep_014jpg.jpg", 14, "014"),
            PanoramaSource("2" * 64, 1, 16, 8, Path("b"), snapshot, "sweep_0148jpg.jpg", 148, "0148"),
        ]
        renamed = [
            PanoramaSource("2" * 64, 1, 16, 8, Path("renamed-b"), snapshot, "sweep_991jpg.jpg", 991, "991"),
            PanoramaSource("1" * 64, 1, 16, 8, Path("renamed-a"), snapshot, "sweep_992jpg.jpg", 992, "992"),
        ]
        profile = profile_for_manifest(manifest_bytes([]), 0, "a" * 64)
        self.assertEqual(build_source_bindings(left, [], profile), build_source_bindings(renamed, [], profile))

    def test_unrepresented_scan_is_not_forced_into_a_bijection(self) -> None:
        snapshot = crosswalk.FileSnapshot(1, 1, 1, 1, 1, 1)
        panorama_id = "8" * 64
        panoramas = [PanoramaSource(panorama_id, 1, 16, 8, Path("p1"), snapshot, "sweep_092jpg.jpg", 92, "092")]
        scans = [Data3DSource(name, (), index) for index, name in enumerate(("g1", "g2"))]
        scores = [RetrievalScore(panorama_id, "g1", 10, 1), RetrievalScore(panorama_id, "g2", 1, 1)]
        verified = [candidate_verification(panorama_id, "g1", 300, 4, 300), candidate_verification(panorama_id, "g2", 10, 1, 10)]
        rows = rank_candidate_correspondences([panorama_id], scores, verified, RankingPolicy())
        result = build_crosswalk_manifest(rows, panoramas, scans, self._bindings(), "1" * 64, 1, FROZEN_CONFIGURATION, generator_binding(), dependency_attestation())
        self.assertEqual(result["summary"]["data3DWithoutUnambiguousCandidateCount"], 1)

    def test_authority_contract_never_grants_downstream_authority(self) -> None:
        contract = self._matrix()["contract"]
        self.assertEqual(contract["correspondenceAuthority"], "candidate_feature_match_unverified")
        self.assertFalse(contract["sequenceAssumptionUsed"])
        forbidden = ("collisionAuthority", "exportAuthority", "publicAuthority", "reconstructionAuthority", "runtimeAuthority", "structuralAuthority", "trainingAuthority")
        self.assertTrue(all(contract[name] is False for name in forbidden))
        self.assertEqual(contract["roomMembershipAuthority"], "none")
        self.assertEqual(contract["transformAuthority"], "none")

    def test_generator_binding_covers_all_executable_local_modules_and_rejects_dirty_state(self) -> None:
        source_root = Path(__file__).parents[4]
        repo_root = self.root / "repo"
        evidence_path = FROZEN_CONFIGURATION.cube_basis_provenance.extractor_relative_path
        paths = (*crosswalk.GENERATOR_PATHS, crosswalk.DEPENDENCY_LOCK_RELATIVE_PATH, evidence_path)
        for relative in paths:
            source = source_root / Path(relative)
            target = repo_root / Path(relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
        subprocess.run(["git", "init", "-q"], cwd=repo_root, check=True)
        subprocess.run(["git", "add", "."], cwd=repo_root, check=True)
        subprocess.run(["git", "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"], cwd=repo_root, check=True)
        reviewed = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo_root, check=True, capture_output=True, text=True).stdout.strip()
        binding = crosswalk.capture_generator_binding(repo_root, reviewed)
        self.assertEqual(tuple(item.relative_path for item in binding.files), crosswalk.GENERATOR_PATHS)
        stage_guard = repo_root / Path(crosswalk.GENERATOR_PATHS[-1])
        stage_guard.write_bytes(stage_guard.read_bytes() + b"# drift\n")
        with self.assertRaisesRegex(ValueError, "not clean"):
            crosswalk.capture_generator_binding(repo_root, reviewed)

    def test_exact_historical_basis_report_supports_the_frozen_proper_basis(self) -> None:
        report = Path(r"F:\E57\equirect_ss\_equirect_v2_report.json")
        if not report.is_file():
            self.skipTest("reviewed historical basis report is unavailable")
        crosswalk.verify_frozen_basis_report(report)
        self.assertEqual([item.report_consensus_count for item in FROZEN_CONFIGURATION.cube_faces], [149, 149, 149, 149, 149, 148])
        self.assertEqual({item.face_index for item in FROZEN_CONFIGURATION.cube_faces}, set(range(6)))

    def test_dependency_lock_verifies_wheels_and_rejects_drift(self) -> None:
        wheel_root = self.root / "wheels"
        wheel_root.mkdir()
        site_root = self.root / "site"
        site_root.mkdir()
        packages = []
        installed = {"numpy": "1.0", "opencv-python-headless": "1.0"}
        runtime_paths = {}
        distribution_roots = {}
        for name, content in (("numpy", b"numpy"), ("opencv-python-headless", b"opencv")):
            filename = name + ".whl"
            import_root = "numpy" if name == "numpy" else "cv2"
            item, runtime_path = write_fixture_wheel(
                wheel_root / filename, site_root, import_root, content
            )
            item["name"] = name
            packages.append(item)
            runtime_paths[name] = {"primary": runtime_path}
            distribution_roots[name] = site_root
        archive = self.root / "python.tar.gz"
        license_path = self.root / "python-license.txt"
        archive.write_bytes(b"archive")
        license_path.write_bytes(b"python-license")
        controls = crosswalk._default_runtime_controls()
        for name in (
            "dependencyExistingPathsWriteSealed",
            "dependencyImportAllowlistEnforced",
            "pythonIgnoreEnvironment",
            "pythonIsolated",
            "pythonNoSite",
            "pythonPathEnvironmentAbsent",
            "pythonSafePath",
            "reviewedLocalModulesExplicitlyLoaded",
            "verifiedSiteRootAddedAfterSeal",
        ):
            self.assertIs(controls[name], True)
            missing = dict(controls)
            missing.pop(name)
            with self.assertRaisesRegex(ValueError, "runtime control keys drifted"):
                crosswalk._validate_runtime_controls(missing)
            with self.assertRaisesRegex(ValueError, "deterministic runtime controls"):
                crosswalk._validate_runtime_controls({**controls, name: False})
            with self.assertRaisesRegex(ValueError, "exact JSON boolean"):
                crosswalk._validate_runtime_controls({**controls, name: 1})
        with patch.dict(os.environ, {"PYTHONPATH": ""}):
            with self.assertRaisesRegex(ValueError, "PYTHONPATH absence"):
                crosswalk._validate_runtime_controls(controls)
        with patch.object(crosswalk.sys, "pycache_prefix", "D:/unexpected"):
            with self.assertRaisesRegex(ValueError, "bytecode-cache prefix"):
                crosswalk._validate_runtime_controls(controls)
        runtime = current_runtime_identity(controls)
        runtime.update({"pythonBaseCompleteFileCount": 1, "pythonBaseCompleteTreeSha256": "7" * 64, "pythonDistributionArchiveRelativePath": archive.name, "pythonDistributionArchiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "pythonDistributionArchiveSizeBytes": archive.stat().st_size, "pythonDistributionLicenseRelativePath": license_path.name, "pythonDistributionLicenseSha256": hashlib.sha256(license_path.read_bytes()).hexdigest(), "pythonDistributionLicenseSizeBytes": license_path.stat().st_size, "pythonDistributionSourceUrl": "https://github.com/astral-sh/python-build-standalone/releases/download/fixture/python.tar.gz"})
        lock = {"authority": "none", "packages": packages, "runtime": runtime, "schemaVersion": crosswalk.DEPENDENCY_SCHEMA}
        path = self.root / "lock.json"
        path.write_bytes(canonical_json_bytes(lock))
        arguments = (path, wheel_root, installed, runtime_paths, controls, distribution_roots)
        with patch.object(crosswalk, "_verify_python_base_distribution"):
            verified, _ = verify_dependency_lock(*arguments)
        self.assertEqual(verified, lock)
        with patch.object(crosswalk, "_verify_python_base_distribution"):
            plan = crosswalk.prepare_dependency_import(path, wheel_root, site_root)
        self.assertTrue(plan.import_origin_paths)
        self.assertTrue(
            all(value.suffix.lower() in {".py", ".pyw", ".pyd"} for value in plan.import_origin_paths)
        )
        rogue = site_root / "numpy" / "rogue.py"
        rogue.write_text("raise RuntimeError\n", encoding="utf-8")
        self.assertNotIn(rogue.resolve(strict=True), plan.import_origin_paths)
        rogue.unlink()
        installer = site_root / "numpy-1.0.dist-info" / "INSTALLER"
        installer.write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "tree differs from the exact lock"):
            with patch.object(crosswalk, "_verify_python_base_distribution"):
                verify_dependency_lock(*arguments)
        installer.write_bytes(b"pip")
        nested = site_root / "numpy" / "fake.dist-info"
        nested.mkdir()
        (nested / "direct_url.json").write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "tree differs from the exact lock"):
            with patch.object(crosswalk, "_verify_python_base_distribution"):
                verify_dependency_lock(*arguments)
        (nested / "direct_url.json").unlink()
        nested.rmdir()
        outside_runtime = self.root / "copied-runtime.bin"
        outside_runtime.write_bytes(runtime_paths["numpy"]["primary"].read_bytes())
        copied_paths = {
            name: dict(values) for name, values in runtime_paths.items()
        }
        copied_paths["numpy"]["primary"] = outside_runtime
        with self.assertRaisesRegex(ValueError, "runtime path differs"):
            with patch.object(crosswalk, "_verify_python_base_distribution"):
                verify_dependency_lock(
                    path, wheel_root, installed, copied_paths,
                    controls, distribution_roots,
                )
        for name in (
            "dependencyExistingPathsWriteSealed",
            "dependencyImportAllowlistEnforced",
            "pythonPathEnvironmentAbsent",
            "pythonIsolated",
        ):
            for replacement in (None, False):
                changed_runtime = dict(runtime)
                if replacement is None:
                    changed_runtime.pop(name)
                else:
                    changed_runtime[name] = replacement
                path.write_bytes(canonical_json_bytes({**lock, "runtime": changed_runtime}))
                with self.assertRaisesRegex(ValueError, "runtime"):
                    verify_dependency_lock(*arguments)
        path.write_bytes(canonical_json_bytes(lock))
        with self.assertRaisesRegex(ValueError, "runtime controls"):
            with patch.object(crosswalk, "_verify_python_base_distribution"):
                verify_dependency_lock(path, wheel_root, installed, runtime_paths, {**controls, "opencvThreads": 2}, distribution_roots)
        wheel_path = wheel_root / "numpy.whl"
        wheel_bytes = wheel_path.read_bytes()
        original_runtime_check = crosswalk._verify_runtime_files

        def race_wheel(package, exact_wheel, paths, site_root):
            original_runtime_check(package, exact_wheel, paths, site_root)
            if package["name"] == "numpy":
                exact_wheel.write_bytes(exact_wheel.read_bytes() + b"race")

        with patch.object(crosswalk, "_verify_python_base_distribution"), patch.object(crosswalk, "_verify_runtime_files", side_effect=race_wheel):
            with self.assertRaisesRegex(ValueError, "wheel changed"):
                verify_dependency_lock(*arguments)
        wheel_path.write_bytes(wheel_bytes)
        original_material = crosswalk._installed_file_material
        raced = False

        def race_tree(root, relative):
            nonlocal raced
            result = original_material(root, relative)
            if not raced and relative.endswith("runtime.bin"):
                raced = True
                (root / Path(relative)).write_bytes(b"tree-race")
            return result

        with patch.object(crosswalk, "_verify_python_base_distribution"), patch.object(crosswalk, "_installed_file_material", side_effect=race_tree):
            with self.assertRaisesRegex(ValueError, "changed during verification"):
                verify_dependency_lock(*arguments)
        runtime_paths["numpy"]["primary"].write_bytes(b"numpy")
        runtime_paths["numpy"]["primary"].write_bytes(b"same-version-tamper")
        with self.assertRaisesRegex(ValueError, "installed distribution member"):
            with patch.object(crosswalk, "_verify_python_base_distribution"):
                verify_dependency_lock(*arguments)
        runtime_paths["numpy"]["primary"].write_bytes(b"numpy")
        pyc = site_root / "numpy" / "__pycache__" / "malicious.pyc"
        pyc.parent.mkdir()
        pyc.write_bytes(b"code")
        with self.assertRaisesRegex(ValueError, "tree differs"):
            with patch.object(crosswalk, "_verify_python_base_distribution"):
                verify_dependency_lock(*arguments)
        pyc.unlink()
        archive.write_bytes(b"archive-drift")
        with self.assertRaisesRegex(ValueError, "archive bytes"):
            verify_dependency_lock(*arguments)
        archive.write_bytes(b"archive")
        (wheel_root / "numpy.whl").write_bytes(b"drift")
        with self.assertRaisesRegex(ValueError, "wheel bytes"):
            with patch.object(crosswalk, "_verify_python_base_distribution"):
                verify_dependency_lock(*arguments)

    def test_core_has_no_cv2_numpy_scipy_or_pickle_import(self) -> None:
        source = Path(__file__).parents[1] / "panorama_image2d_crosswalk.py"
        tree = ast.parse(source.read_text(encoding="utf-8"))
        imports = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
        imports.update(node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module)
        self.assertTrue({"cv2", "numpy", "scipy", "pickle"}.isdisjoint(imports))

    def test_production_functions_respect_fifty_line_policy(self) -> None:
        root = Path(__file__).parents[1]
        for name in ("panorama_image2d_crosswalk.py", "build_panorama_image2d_crosswalk.py"):
            tree = ast.parse((root / name).read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    length = (node.end_lineno or node.lineno) - node.lineno + 1
                    self.assertLessEqual(length, 50, f"{name}:{node.name} has {length} lines")


if __name__ == "__main__":
    unittest.main()
