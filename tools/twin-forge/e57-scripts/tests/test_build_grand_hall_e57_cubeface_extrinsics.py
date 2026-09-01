from __future__ import annotations

import ast
import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

import build_grand_hall_e57_cubeface_extrinsics as builder


def _minimal_result() -> dict[str, object]:
    scans = []
    for scan_index in builder.EXPECTED_SCANS:
        faces = []
        for face_index, winner_id in enumerate(builder.CANONICAL_FACE_BASIS_IDS):
            scores = []
            for basis in builder.SIGNED_AXIS_BASES:
                if basis.basis_id == winner_id:
                    score = builder.BasisScore(
                        basis.basis_id, basis.determinant, 10_000, 64, 0.99, 1.0
                    )
                else:
                    score = builder.BasisScore(
                        basis.basis_id, basis.determinant, 10_000, 64, 0.10, 50.0
                    )
                scores.append(score)
            ranked = sorted(scores, key=builder._score_sort_key)
            faces.append(
                {
                    "faceIndex": face_index,
                    "runnerUp": builder.basis_score_json(ranked[1]),
                    "scores": [builder.basis_score_json(value) for value in scores],
                    "winner": builder.basis_score_json(ranked[0]),
                }
            )
        quaternion, translation, sweep_number, supported_count, caveat = (
            builder.FROZEN_CANDIDATE_ROWS[scan_index - 40]
        )
        rotation, norm_error = builder.quaternion_wxyz_to_rotation(quaternion)
        scans.append(
            {
                "cameraCenterDiagnostic": {
                    "centerOffsetFitRun": False,
                    "reason": builder.CAMERA_CENTER_DIAGNOSTIC_REASON,
                    "scannerOriginUsedAsCandidateCenter": True,
                    "state": "diagnostic_not_run_not_an_authority_gate",
                },
                "cameraExtrinsics": [
                    builder.compose_camera_extrinsics(rotation, translation, value)
                    for value in builder.CANONICAL_FACE_BASIS_IDS
                ],
                "candidateCorrespondence": {
                    "accepted": False,
                    "caveat": caveat,
                    "humanReviewRequired": True,
                    "supportedCandidateCount": supported_count,
                    "sweepNumber": sweep_number,
                },
                "data3DGuid": builder.FROZEN_SCAN_GUIDS[scan_index - 40],
                "data3DPose": {
                    "coordinateFrame": "E57 file frame",
                    "quaternionNormError": norm_error,
                    "rotationQuaternionWxyz": list(quaternion),
                    "translationM": list(translation),
                },
                "faces": faces,
                "pointEvidence": {
                    "cartesianBoundsMaximumAbsDeltaM": 0.001,
                    "pointCount": builder.EXPECTED_POINT_COUNT,
                    "sampleCount": 80_000,
                    "sampleSha256": "c" * 64,
                    "validPointCount": builder.MINIMUM_VALID_POINT_COUNT,
                },
                "scanIndex": scan_index,
                "winningBasisIds": list(builder.CANONICAL_FACE_BASIS_IDS),
            }
        )
    configuration = builder._frozen_configuration()
    generator_files = [
        {
            "relativePath": relative,
            "sha256": f"{index + 1:x}" * 64,
            "sizeBytes": index + 1,
        }
        for index, relative in enumerate(builder.GENERATOR_RELATIVE_PATHS)
    ]
    generator = {"files": generator_files, "reviewedGitSha": "1" * 40}
    result = {
        "authority": "none",
        "configuration": configuration,
        "configurationSha256": builder.sha256_bytes(
            builder.canonical_json_bytes(configuration)
        ),
        "contract": {
            "dependencyBootstrapRequired": False,
            "evidenceGradeDependencyAttestationPassed": True,
            "machineVerificationPassed": True,
            "orientationAuthority": "none",
            "permissions": builder._permissions(),
            "storedImage2DPoseHandling": "not_read_not_used",
            "truthScope": builder.TRUTH_SCOPE,
        },
        "generator": generator,
        "generatorSha256": builder.sha256_bytes(builder.canonical_json_bytes(generator)),
        "runtime": {
            "activation": {
                "contractSha256": generator_files[2]["sha256"],
                "runtimeTreeFileCount": builder.FROZEN_RUNTIME_TREE[0],
                "runtimeTreeSha256": builder.FROZEN_RUNTIME_TREE[1],
            },
            "decoderBackend": "opencv_imdecode_color_bgr_to_rgb",
            "dependencies": {
                "numpy": {
                    "origin": str(builder.FROZEN_RUNTIME_ROOT / "Lib/site-packages/numpy/__init__.py"),
                    "version": "1.26.4",
                },
                "opencv-python-headless": {
                    "origin": str(builder.FROZEN_RUNTIME_ROOT / "Lib/site-packages/cv2/__init__.py"),
                    "version": "4.10.0.84",
                },
                "pye57": {
                    "origin": str(builder.FROZEN_RUNTIME_ROOT / "Lib/site-packages/pye57/__init__.py"),
                    "version": "0.4.19",
                },
                "pyquaternion": {
                    "origin": str(builder.FROZEN_RUNTIME_ROOT / "Lib/site-packages/pyquaternion/__init__.py"),
                    "version": "0.9.9",
                },
            },
            "evidenceGradeHermeticRuntimeReady": True,
            "nativePye57Files": list(builder.FROZEN_PYE57_NATIVE_FILES),
            "python": {
                "executable": str(builder.FROZEN_RUNTIME_ROOT / "Scripts/python.exe"),
                "executableSha256": builder.FROZEN_PYTHON_EXECUTABLE[1],
                "implementation": "cpython",
                "version": "3.12.12 (fixture)",
            },
        },
        "scanResults": scans,
        "schemaVersion": builder.RESULT_SCHEMA,
        "sourceBindings": builder._frozen_source_bindings(),
        "summary": {
            "allRequestedScansRecoveredIdenticalProperCube": True,
            "evidenceGradeVerificationPassed": True,
            "faceCount": 48,
            "machineVerificationPassed": True,
            "requestedScanIndices": list(builder.EXPECTED_SCANS),
            "scanCount": 8,
            "winnerAuthority": "none",
        },
    }
    digest = builder.sha256_bytes(builder.canonical_json_bytes(result))
    result["determinismVerification"] = {
        "attemptCount": 3,
        "attemptIsolation": "fresh_pye57_reader_same_process",
        "attemptResultSha256": [digest, digest, digest],
    }
    return result


def _refresh_determinism(result: dict[str, object]) -> None:
    base = dict(result)
    del base["determinismVerification"]
    digest = builder.sha256_bytes(builder.canonical_json_bytes(base))
    result["determinismVerification"]["attemptResultSha256"] = [digest, digest, digest]


class GrandHallCubefaceBuilderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_strict_json_rejects_duplicates_and_nonfinite_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "duplicate"):
            builder.load_strict_json(b'{"x":1,"x":2}', "fixture")
        with self.assertRaisesRegex(ValueError, "non-finite"):
            builder.load_strict_json(b'{"x":NaN}', "fixture")

    def test_publication_is_canonical_receipt_last_and_no_replace(self) -> None:
        output = self.root / "pack"
        events: list[str] = []

        def hook(event: str, _path: Path) -> None:
            events.append(event)

        result = _minimal_result()
        builder.publish_pack(output, result, hook)
        builder.verify_pack(output, result)
        self.assertEqual(
            events,
            [
                "before-publication-stage",
                "after-result-write",
                "after-receipt-write",
                "before-no-replace-rename",
                "after-no-replace-rename",
            ],
        )
        self.assertEqual(
            (output / builder.RESULT_NAME).read_bytes(),
            builder.canonical_json_bytes(result),
        )
        with self.assertRaisesRegex(ValueError, "replace"):
            builder.publish_pack(output, result)

    @unittest.skipUnless(os.name == "nt", "Windows no-replace race contract")
    def test_raced_final_target_is_not_replaced(self) -> None:
        output = self.root / "pack"

        def hook(event: str, path: Path) -> None:
            if event == "before-no-replace-rename":
                path.mkdir()
                (path / "attacker.txt").write_text("preserve", encoding="utf-8")

        with self.assertRaises((OSError, ValueError)):
            builder.publish_pack(output, _minimal_result(), hook)
        self.assertEqual((output / "attacker.txt").read_text(encoding="utf-8"), "preserve")
        self.assertFalse(any(self.root.glob(".pack.stage-*")))

    def test_pack_rejects_extra_tampered_and_hardlinked_files(self) -> None:
        output = self.root / "pack"
        result = _minimal_result()
        builder.publish_pack(output, result)
        (output / "extra").write_bytes(b"x")
        with self.assertRaisesRegex(ValueError, "inventory"):
            builder.verify_pack(output, result)
        (output / "extra").unlink()
        original = output / builder.RESULT_NAME
        original.write_bytes(original.read_bytes() + b" ")
        with self.assertRaises(ValueError):
            builder.verify_pack(output, result)

        second = self.root / "pack-two"
        builder.publish_pack(second, result)
        os.link(second / builder.RESULT_NAME, self.root / "hardlink")
        with self.assertRaisesRegex(ValueError, "hard-linked"):
            builder.verify_pack(second, result)

    def test_verify_pack_is_zero_write(self) -> None:
        output = self.root / "pack"
        result = _minimal_result()
        builder.publish_pack(output, result)
        before = {
            path.name: (path.read_bytes(), path.stat().st_mtime_ns, path.stat().st_ctime_ns)
            for path in output.iterdir()
        }
        with patch.object(builder, "_write_exclusive", side_effect=AssertionError("write")), patch.object(
            builder, "publication_stage", side_effect=AssertionError("stage")
        ):
            builder.verify_pack(output, result)
        after = {
            path.name: (path.read_bytes(), path.stat().st_mtime_ns, path.stat().st_ctime_ns)
            for path in output.iterdir()
        }
        self.assertEqual(before, after)

    def test_stable_reader_detects_same_size_replacement(self) -> None:
        path = self.root / "source.bin"
        path.write_bytes(b"abcd")
        snapshot = builder._snapshot(path)
        replacement = self.root / "replacement.bin"
        replacement.write_bytes(b"wxyz")
        os.replace(replacement, path)
        with self.assertRaisesRegex(ValueError, "changed"):
            builder._read_stable(path, snapshot)

    def test_raw_scan_contract_rejects_colour_wraparound(self) -> None:
        raw = {
            "cartesianX": np.asarray([1.0]),
            "cartesianY": np.asarray([0.0]),
            "cartesianZ": np.asarray([0.0]),
            "cartesianInvalidState": np.asarray([0], dtype=np.int8),
            "rowIndex": np.asarray([0], dtype=np.uint16),
            "columnIndex": np.asarray([0], dtype=np.uint16),
            "colorRed": np.asarray([256], dtype=np.int16),
            "colorGreen": np.asarray([0], dtype=np.uint8),
            "colorBlue": np.asarray([0], dtype=np.uint8),
        }
        with self.assertRaisesRegex(ValueError, "dtypes"):
            builder._scan_arrays(raw, 1)

    def test_input_snapshot_rejects_hardlinks(self) -> None:
        path = self.root / "source.bin"
        path.write_bytes(b"abcd")
        os.link(path, self.root / "alias.bin")
        with self.assertRaisesRegex(ValueError, "hard links"):
            builder._snapshot(path)

    def test_windows_open_identity_ignores_only_synthetic_permission_bits(self) -> None:
        expected = builder.FileSnapshot(
            7,
            11,
            stat.S_IFREG | 0o777,
            19,
            23,
            29,
            1,
        )
        opened = SimpleNamespace(
            st_dev=7,
            st_ino=11,
            st_mode=stat.S_IFREG | 0o666,
            st_size=19,
            st_mtime_ns=23,
            st_nlink=1,
        )
        with patch.object(builder.os, "name", "nt"):
            self.assertTrue(builder._same_open_file(opened, expected))
            opened.st_size = 20
            self.assertFalse(builder._same_open_file(opened, expected))
            opened.st_size = 19
            opened.st_mode = stat.S_IFDIR | 0o666
            self.assertFalse(builder._same_open_file(opened, expected))

    def test_installed_distribution_claim_is_recomputed_from_files(self) -> None:
        package = self.root / "Lib" / "site-packages" / "demo.py"
        package.parent.mkdir(parents=True)
        package.write_bytes(b"first")

        class FakeDistribution:
            metadata = {"Name": "numpy"}
            version = "1.26.4"
            files = [PurePosixPath("demo.py")]

            @staticmethod
            def locate_file(_declared: PurePosixPath) -> Path:
                return package

        with patch.object(
            builder.importlib.metadata,
            "distribution",
            return_value=FakeDistribution(),
        ):
            first = builder._installed_distribution_identity(self.root, "numpy")
            package.write_bytes(b"second")
            second = builder._installed_distribution_identity(self.root, "numpy")
        self.assertEqual(first["installedFileCount"], 1)
        self.assertNotEqual(first["installedTreeSha256"], second["installedTreeSha256"])

    @unittest.skipUnless(os.name == "nt", "Windows sharing-deny custody contract")
    def test_read_lease_blocks_write_and_delete_then_releases(self) -> None:
        path = self.root / "leased.bin"
        path.write_bytes(b"sealed")
        with builder.windows_read_leases([path]):
            with self.assertRaises(OSError):
                path.write_bytes(b"mutate")
            with self.assertRaises(OSError):
                path.unlink()
            self.assertEqual(path.read_bytes(), b"sealed")
        path.write_bytes(b"released")
        self.assertEqual(path.read_bytes(), b"released")

    @unittest.skipUnless(os.name == "nt", "Windows directory identity custody contract")
    def test_directory_lease_blocks_parent_swap_but_allows_child_creation(self) -> None:
        parent = self.root / "parent"
        parent.mkdir()
        moved = self.root / "moved"
        with builder.windows_directory_identity_lease(parent):
            (parent / "child.bin").write_bytes(b"allowed")
            with self.assertRaises(OSError):
                parent.rename(moved)
        parent.rename(moved)
        self.assertEqual((moved / "child.bin").read_bytes(), b"allowed")

    @unittest.skipUnless(os.name == "nt", "Windows publication parent custody contract")
    def test_publication_parent_swap_hook_is_blocked(self) -> None:
        parent = self.root / "parent"
        parent.mkdir()
        output = parent / "pack"
        blocked: list[bool] = []

        def hook(event: str, _path: Path) -> None:
            if event == "before-publication-stage":
                try:
                    parent.rename(self.root / "attacker-swap")
                except OSError:
                    blocked.append(True)

        builder.publish_pack(output, _minimal_result(), hook)
        self.assertEqual(blocked, [True])
        builder.verify_pack(output, _minimal_result())

    @unittest.skipUnless(os.name == "nt", "Windows published-directory custody contract")
    def test_post_rename_output_swap_hook_is_blocked(self) -> None:
        output = self.root / "pack"
        moved = self.root / "moved-pack"
        blocked: list[bool] = []

        def hook(event: str, _path: Path) -> None:
            if event == "after-no-replace-rename":
                try:
                    output.rename(moved)
                except OSError:
                    blocked.append(True)

        result = _minimal_result()
        builder.publish_pack(output, result, hook)
        self.assertEqual(blocked, [True])
        self.assertFalse(moved.exists())
        builder.verify_pack(output, result)

    def test_output_overlap_is_rejected_in_both_directions(self) -> None:
        protected = self.root / "protected"
        protected.mkdir()
        with self.assertRaisesRegex(ValueError, "overlaps"):
            builder.assert_disjoint_output(protected / "child", [protected])
        with self.assertRaisesRegex(ValueError, "overlaps"):
            builder.assert_disjoint_output(self.root, [protected])

    def test_cubeface_hash_fails_before_decode(self) -> None:
        path = self.root / "face.jpg"
        path.write_bytes(b"not-a-jpeg")
        snapshot = builder._snapshot(path)
        face = builder.CubefaceSource(
            40,
            0,
            240,
            "guid",
            path,
            "face.jpg",
            len(b"not-a-jpeg"),
            hashlib.sha256(b"different").hexdigest(),
            snapshot,
        )
        with patch.object(builder, "_decode_rgb", side_effect=AssertionError("decode")):
            with self.assertRaisesRegex(ValueError, "identity drifted"):
                builder._load_face(face)

    def test_strict_decoder_rejects_missing_opencv_without_fallback(self) -> None:
        with patch.dict(sys.modules, {"cv2": None}):
            with self.assertRaisesRegex(RuntimeError, "OpenCV decoder"):
                builder._decode_rgb(b"not-used")

    def test_pye57_boundary_has_no_image2d_pose_access(self) -> None:
        source = Path(builder.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)
        reader = next(
            node
            for node in tree.body
            if isinstance(node, ast.ClassDef) and node.name == "Pye57CaptureReader"
        )
        capture_members = {
            node.attr
            for node in ast.walk(reader)
            if isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Attribute)
            and isinstance(node.value.value, ast.Name)
            and node.value.value.id == "self"
            and node.value.attr == "_capture"
        }
        self.assertEqual(
            capture_members,
            {"close", "get_header", "read_scan_raw", "scan_count"},
        )
        forbidden = {"images2D", "root", "pose", "get_image2d_pose"}
        self.assertTrue(capture_members.isdisjoint(forbidden))
        self.assertIn('"storedImage2DPoseHandling": "not_read_not_used"', source)

    def test_dependency_runtime_contract_has_exact_wheels_and_complete_attestation(self) -> None:
        path = Path(builder.__file__).with_name(
            "e57-cubeface-extrinsics-dependency-bootstrap-authority-none.json"
        )
        contract = builder.load_strict_json(path.read_bytes(), "dependency bootstrap")
        self.assertIs(contract["bootstrapRequired"], False)
        self.assertIs(contract["evidenceGradeBuildPermitted"], True)
        packages = {item["name"]: item for item in contract["additionalPackages"]}
        self.assertEqual(packages["pye57"]["version"], "0.4.19")
        self.assertEqual(packages["pyquaternion"]["version"], "0.9.9")
        self.assertEqual(
            packages["pye57"]["artifactSha256"],
            "ec415dac94f66832d8f8709ef33eb43b1a5a002ac63c02af5458229c8d29e3a2",
        )
        self.assertEqual(
            packages["pyquaternion"]["artifactSha256"],
            "e65f6e3f7b1fdf1a9e23f82434334a1ae84f14223eee835190cd2e841f8172ec",
        )
        self.assertEqual(
            contract["runtimeCandidate"]["state"],
            "frozen_runtime_tree_and_native_attestation_complete",
        )
        attestation = contract["runtimeAttestation"]
        self.assertEqual(attestation["completeTree"]["fileCount"], 930)
        self.assertEqual(
            attestation["completeTree"]["sha256"],
            "02892b5dcecea27f224c95042d148d69ae7411f170ba02ef0e0c12d6c7c856d7",
        )
        self.assertEqual(
            {item["name"]: item["installedFileCount"] for item in attestation["installedDistributions"]},
            {"numpy": 810, "opencv-python-headless": 88, "pye57": 15, "pyquaternion": 9},
        )

    def test_result_validator_rejects_partial_scan_publication(self) -> None:
        result = _minimal_result()
        result["scanResults"] = result["scanResults"][:1]
        result["summary"]["scanCount"] = 1
        result["summary"]["faceCount"] = 6
        result["summary"]["requestedScanIndices"] = [40]
        base = dict(result)
        del base["determinismVerification"]
        digest = builder.sha256_bytes(builder.canonical_json_bytes(base))
        result["determinismVerification"]["attemptResultSha256"] = [
            digest,
            digest,
            digest,
        ]
        with self.assertRaisesRegex(ValueError, "summary|exact scans"):
            builder._validate_result_contract(result)

    def test_result_validator_rejects_forged_provenance_surfaces(self) -> None:
        mutations = {
            "generator": lambda value: value["generator"].update({"files": []}),
            "source": lambda value: value["sourceBindings"]["selectedT559Cubefaces"][0].update(
                {"sha256": "f" * 64}
            ),
            "runtime": lambda value: value["runtime"]["activation"].update(
                {"runtimeTreeSha256": "f" * 64}
            ),
            "truth": lambda value: value["contract"].update({"truthScope": "forged"}),
            "summary": lambda value: value["summary"].pop(
                "allRequestedScansRecoveredIdenticalProperCube"
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                result = _minimal_result()
                mutate(result)
                _refresh_determinism(result)
                with self.assertRaises(ValueError):
                    builder._validate_result_contract(result)

    def test_result_validator_rejects_extra_candidate_authority_field(self) -> None:
        result = _minimal_result()
        result["scanResults"][0]["candidateCorrespondence"][
            "roomMembershipAccepted"
        ] = True
        _refresh_determinism(result)
        with self.assertRaisesRegex(ValueError, "center or correspondence"):
            builder._validate_result_contract(result)

    def test_result_validator_rejects_recomputed_forged_data3d_pose(self) -> None:
        result = _minimal_result()
        scan = result["scanResults"][0]
        forged_translation = (999.0, 888.0, 777.0)
        quaternion = tuple(scan["data3DPose"]["rotationQuaternionWxyz"])
        rotation, _norm_error = builder.quaternion_wxyz_to_rotation(quaternion)
        scan["data3DPose"]["translationM"] = list(forged_translation)
        scan["cameraExtrinsics"] = [
            builder.compose_camera_extrinsics(rotation, forged_translation, basis_id)
            for basis_id in builder.CANONICAL_FACE_BASIS_IDS
        ]
        _refresh_determinism(result)
        with self.assertRaisesRegex(ValueError, "exact frozen candidate row"):
            builder._validate_result_contract(result)

    def test_real_frozen_input_contract_and_scan40_regression(self) -> None:
        if os.environ.get("VENVIEWER_RUN_REAL_E57_TESTS") != "1":
            self.skipTest("set VENVIEWER_RUN_REAL_E57_TESTS=1 for the 11-second real scan-40 regression")
        repo = Path(__file__).resolve().parents[4]
        prepared = builder.prepare_inputs(
            builder.FrozenInputs(
                Path(r"F:\VenviewerCaptureStaging\trades-hall-2026-07-10"),
                Path(r"D:\venviewer-evidence\trades-hall-grand-hall-e57-image2d-v1"),
                Path(r"D:\venviewer-evidence\trades-hall-grand-hall-panorama-image2d-crosswalk-v1"),
                repo / "docs/operations/grand-hall-camera-metric-subset-authority-none-v1.json",
            )
        )
        leased = [prepared.e57.path] + [face.path for face in prepared.rows[0].cubefaces]
        with builder.windows_read_leases(leased):
            reader = builder.Pye57CaptureReader(prepared.e57.path)
            try:
                result = builder._solve_scan(reader, prepared.rows[0])
            finally:
                reader.close()
        self.assertEqual(
            result["winningBasisIds"],
            [
                "r-y_d+x_f+z",
                "r-y_d-z_f+x",
                "r-x_d-z_f-y",
                "r+y_d-z_f-x",
                "r+x_d-z_f+y",
                "r-y_d-x_f-z",
            ],
        )
        self.assertEqual(len(result["faces"]), 6)
        self.assertTrue(all(len(face["scores"]) == 48 for face in result["faces"]))
        self.assertEqual(
            builder.sha256_bytes(builder.canonical_json_bytes(result)),
            "8a012c53c757742869857e085d48ba46932880af9f278ff8ce8762d33cede75d",
        )
        self.assertEqual(result["pointEvidence"]["sampleCount"], 81_383)
        self.assertEqual(
            result["pointEvidence"]["sampleSha256"],
            "0382715d5ad25fb957d23dc4aad6934e6ad88966ba1c0c41f2f35bfe31e3b554",
        )


if __name__ == "__main__":
    unittest.main()
