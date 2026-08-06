from __future__ import annotations

import copy
import hashlib
import json
import os
import stat
import sys
import tempfile
import types
import unittest
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))
REPO_ROOT = Path(__file__).resolve().parents[3]
PROTOCOL_PATH = (
    REPO_ROOT
    / "docs"
    / "reports"
    / "reception-room-e57-geometry-edge-exploratory-overlay-protocol-v1-2026-07-14.json"
)
FROZEN_REPORT_PATH = (
    REPO_ROOT
    / "docs"
    / "reports"
    / "reception-room-e57-geometry-edge-heldout-v2-2026-07-14.json"
)
PACKAGE_PATH = (
    REPO_ROOT
    / "docs"
    / "reports"
    / "evidence"
    / "reception-room-e57-geometry-edge-exploratory-overlays-v1-2026-07-14"
)

import verify_e57_geometry_edge_exploratory_overlay_package_v1 as verifier  # noqa: E402


class E57GeometryEdgeExploratoryOverlayPackageVerifierTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.protocol = json.loads(PROTOCOL_PATH.read_text("utf-8"))
        cls.frozen_report = json.loads(FROZEN_REPORT_PATH.read_text("utf-8"))
        cls.manifest = json.loads((PACKAGE_PATH / "manifest.json").read_text("utf-8"))

    @contextmanager
    def _hardlinked_package(self) -> Iterator[Path]:
        with tempfile.TemporaryDirectory() as temporary:
            package = (
                Path(temporary) / verifier.EXPECTED_OUTPUT_DIRECTORY_NAME
            )
            package.mkdir()
            for source in PACKAGE_PATH.iterdir():
                os.link(source, package / source.name)
            yield package

    def _verify(
        self, package: Path, hook: Callable[[], None] | None = None
    ) -> dict[str, object]:
        return verifier.verify_package(
            package_directory=package,
            protocol_path=PROTOCOL_PATH,
            frozen_report_path=FROZEN_REPORT_PATH,
            repo_root=REPO_ROOT,
            _between_snapshot_hook=hook,
        )

    @staticmethod
    def _expected_receipt(path: Path) -> dict[str, object]:
        payload = path.read_bytes()
        return {
            "fileName": path.name,
            "sizeBytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }

    def test_happy_path_verifies_the_current_on_disk_package(self) -> None:
        result = self._verify(PACKAGE_PATH)
        self.assertEqual(result["status"], "PASS_SEALED_PACKAGE_INTEGRITY")
        self.assertEqual(
            result["derivedReceipts"]["artifactSet"]["sha256"],
            verifier.EXPECTED_ARTIFACT_SET_SHA256,
        )
        self.assertEqual(
            result["derivedReceipts"]["directorySet"]["sha256"],
            verifier.EXPECTED_DIRECTORY_SET_SHA256,
        )
        self.assertFalse(result["checks"]["rawAnalysisMasksRetained"])
        self.assertFalse(
            result["checks"]["renderTimeMaskComputationIndependentlyReplayed"]
        )
        self.assertTrue(result["checks"]["twoFullPackageReceiptSnapshotsMatch"])
        self.assertTrue(
            result["checks"][
                "allExistingInputAncestorsRejectSymlinksAndReparsePoints"
            ]
        )
        self.assertFalse(result["checks"]["postReturnByteSwapPrevented"])
        self.assertFalse(result["checks"]["externalVerifierSelfAuthenticating"])
        verifier._verify_payload_digest(
            result, verifier.VERIFICATION_DIGEST_DOMAIN, "verification result"
        )

    def test_json_reader_rejects_duplicate_keys_and_nonfinite_numbers(self) -> None:
        cases = {
            "duplicate": b'{"value":1,"value":2}\n',
            "nan": b'{"value":NaN}\n',
            "positive-infinity": b'{"value":Infinity}\n',
            "negative-infinity": b'{"value":-Infinity}\n',
        }
        for name, payload in cases.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / f"{name}.json"
                path.write_bytes(payload)
                with self.assertRaisesRegex(
                    verifier.VerificationError, "INVALID_JSON"
                ):
                    verifier._read_json(
                        path,
                        name,
                        self._expected_receipt(path),
                        1024,
                    )

    def test_lexical_symlink_leaf_and_ancestor_are_rejected_when_supported(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real_directory = root / "real"
            real_directory.mkdir()
            real_file = real_directory / "payload.json"
            real_file.write_text('{"value":1}\n', encoding="utf-8")
            leaf_link = root / "leaf.json"
            ancestor_link = root / "ancestor"
            try:
                leaf_link.symlink_to(real_file)
                ancestor_link.symlink_to(real_directory, target_is_directory=True)
            except (NotImplementedError, OSError) as error:
                self.skipTest(f"symlinks unavailable in this environment: {error}")

            for path in (leaf_link, ancestor_link / real_file.name):
                with self.subTest(path=path):
                    lexical = verifier._absolute_lexical(path)
                    self.assertIn(path.parent.name, str(lexical))
                    with self.assertRaisesRegex(
                        verifier.VerificationError, "UNSAFE_REPARSE_PATH"
                    ):
                        verifier._read_json(
                            lexical,
                            "symlinked JSON",
                            {
                                **self._expected_receipt(real_file),
                                "fileName": path.name,
                            },
                            1024,
                        )

    def test_windows_reparse_attribute_is_treated_as_unsafe(self) -> None:
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x00000400)
        fake_stat = types.SimpleNamespace(
            st_mode=stat.S_IFREG,
            st_file_attributes=reparse_flag,
        )
        self.assertTrue(verifier._stat_has_reparse_point(fake_stat))

    def test_rejects_redigested_protocol_source_substitution(self) -> None:
        mutated = copy.deepcopy(self.protocol)
        mutated["inputs"]["sourceE57"] = {
            "fileName": "substitute.e57",
            "sizeBytes": 123,
            "sha256": "0" * 64,
        }
        mutated = verifier._finalize(mutated, verifier.PROTOCOL_DIGEST_DOMAIN)
        with self.assertRaisesRegex(
            verifier.VerificationError, "SOURCE_E57_MISMATCH"
        ):
            verifier._validate_protocol(mutated, self.frozen_report, REPO_ROOT)

    def test_rejects_extra_contradictory_protocol_policy_claims(self) -> None:
        mutated = copy.deepcopy(self.protocol)
        mutated["publicationPermitted"] = True
        mutated["continuousCalibrationValidated"] = True
        mutated = verifier._finalize(mutated, verifier.PROTOCOL_DIGEST_DOMAIN)
        with self.assertRaisesRegex(
            verifier.VerificationError, "CLOSED_OBJECT_KEYS_MISMATCH"
        ):
            verifier._validate_protocol(mutated, self.frozen_report, REPO_ROOT)

    def test_rejects_artifact_byte_tamper(self) -> None:
        with self._hardlinked_package() as package:
            target = package / "control__scan-125__skybox-3__native.jpg"
            payload = bytearray(target.read_bytes())
            payload[-1] ^= 0x01
            target.unlink()
            target.write_bytes(payload)
            with self.assertRaisesRegex(
                verifier.VerificationError, "ARTIFACT_RECEIPT_MISMATCH"
            ):
                self._verify(package)

    def test_second_full_snapshot_rejects_between_pass_mutation(self) -> None:
        with self._hardlinked_package() as package:
            target = package / "control__scan-125__skybox-3__native.jpg"
            clean_payload = target.read_bytes()
            target.unlink()
            target.write_bytes(clean_payload)
            hook_called = False

            def mutate_after_first_snapshot() -> None:
                nonlocal hook_called
                hook_called = True
                with target.open("r+b") as handle:
                    handle.seek(-1, os.SEEK_END)
                    value = handle.read(1)
                    handle.seek(-1, os.SEEK_END)
                    handle.write(bytes((value[0] ^ 0x01,)))

            with self.assertRaisesRegex(
                verifier.VerificationError, "ARTIFACT_RECEIPT_MISMATCH"
            ):
                self._verify(package, mutate_after_first_snapshot)
            self.assertTrue(hook_called)

    def test_rejects_added_or_deleted_artifact(self) -> None:
        with self.subTest("addition"), self._hardlinked_package() as package:
            (package / "unexpected.txt").write_text("unexpected", encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "DIRECTORY_SET_MISMATCH"
            ):
                self._verify(package)
        with self.subTest("deletion"), self._hardlinked_package() as package:
            (package / "control__scan-125__skybox-3__native.jpg").unlink()
            with self.assertRaisesRegex(
                verifier.VerificationError, "DIRECTORY_SET_MISMATCH"
            ):
                self._verify(package)

    def test_rejects_redigested_record_or_pair_summary_divergence(self) -> None:
        with self.subTest("record"):
            mutated = copy.deepcopy(self.manifest)
            mutated["records"][0]["frozenStatus"] = "BLOCKED_AMBIGUOUS"
            mutated = verifier._finalize(mutated, verifier.MANIFEST_DIGEST_DOMAIN)
            with self.assertRaisesRegex(
                verifier.VerificationError, "RECORD_SET_MISMATCH"
            ):
                verifier._validate_manifest(
                    mutated, self.protocol, self.frozen_report
                )
        with self.subTest("pair summary"):
            mutated = copy.deepcopy(self.manifest)
            mutated["pairComparisons"][0][
                "failureMinusControlUnmatchedResidualFraction"
            ] = 0.0
            mutated = verifier._finalize(mutated, verifier.MANIFEST_DIGEST_DOMAIN)
            with self.assertRaisesRegex(
                verifier.VerificationError, "PAIR_SUMMARY_MISMATCH"
            ):
                verifier._validate_manifest(
                    mutated, self.protocol, self.frozen_report
                )


if __name__ == "__main__":
    unittest.main()
