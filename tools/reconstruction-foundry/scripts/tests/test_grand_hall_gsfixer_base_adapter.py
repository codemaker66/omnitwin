from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ADAPTER_PATH = (
    Path(__file__).resolve().parents[2]
    / "python"
    / "grand_hall_gsfixer_base_adapter.py"
)
SUPERVISOR_SOURCE_PATH = (
    Path(__file__).resolve().parents[2]
    / "native"
    / "grand_hall_gsfixer_supervisor.c"
)
LATE_EXTRA_PROOF_FIXTURE_PATH = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "gsfixer_proof_late_extra_byte.py"
)
LATE_EXTRA_PROOF_HARNESS_PATH = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "gsfixer_proof_late_extra_harness.c"
)
CONTINUOUS_PROOF_STREAM_HARNESS_PATH = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "gsfixer_proof_continuous_stream_harness.c"
)


def load_adapter():
    specification = importlib.util.spec_from_file_location(
        "grand_hall_gsfixer_base_adapter",
        ADAPTER_PATH,
    )
    if specification is None or specification.loader is None:
        raise RuntimeError("Could not load the GSFixer adapter module.")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


class GrandHallGsfixerBaseAdapterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.adapter = load_adapter()

    def test_canonical_digest_is_stable_and_ascii(self) -> None:
        payload = {"z": "Grand Hall", "nested": {"b": 2, "a": "é"}}
        self.assertEqual(
            self.adapter.canonical_json(payload),
            '{"nested":{"a":"\\u00e9","b":2},"z":"Grand Hall"}',
        )
        self.assertEqual(
            self.adapter.domain_digest("VENVIEWER_GSFIXER_TEST_V1", payload),
            "sha256:e72405064c90e6a0691d993a3bf31f9557bd8fb6c9a08cfae0daeceec1da7612",
        )

    def test_stable_file_receipt_enforces_size_and_digest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "input.bin"
            path.write_bytes(b"grand-hall")
            digest = self.adapter.sha256_bytes(b"grand-hall")
            receipt = self.adapter.stable_file_receipt(
                path,
                "fixture",
                len(b"grand-hall"),
                digest,
            )
            self.assertEqual(receipt["sha256"], digest)
            with self.assertRaisesRegex(self.adapter.AdapterError, "size mismatch"):
                self.adapter.stable_file_receipt(path, "fixture", 1, digest)
            with self.assertRaisesRegex(self.adapter.AdapterError, "SHA-256 mismatch"):
                self.adapter.stable_file_receipt(path, "fixture", None, "0" * 64)

    def test_verify_closure_rejects_a_changed_member(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            member = root / "member.bin"
            member.write_bytes(b"sealed")
            closure = {"member.bin": (6, self.adapter.sha256_bytes(b"sealed"))}
            receipts = self.adapter.verify_closure(root, closure, "fixture")
            self.assertEqual(receipts[0]["relativePath"], "member.bin")
            member.write_bytes(b"altered")
            with self.assertRaisesRegex(self.adapter.AdapterError, "size mismatch"):
                self.adapter.verify_closure(root, closure, "fixture")

    def test_attempt_and_outputs_are_create_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            attempt = parent / "attempt"
            self.adapter.create_attempt_directory(attempt)
            with self.assertRaisesRegex(self.adapter.AdapterError, "already exists"):
                self.adapter.create_attempt_directory(attempt)
            output = attempt / "receipt.json"
            self.adapter.exclusive_write(output, b"{}\n", "receipt")
            with self.assertRaisesRegex(self.adapter.AdapterError, "already exists"):
                self.adapter.exclusive_write(output, b"{}\n", "receipt")

    def test_authority_is_always_generated_and_non_promotable(self) -> None:
        identity = self.adapter.base_identity(
            Path("/source"),
            Path("/model"),
            {"sha256": "sha256:" + "1" * 64, "sizeBytes": 1, "path": "/input"},
            {"manifest": {}, "publicationReceipt": {}, "authority": {"authority": "none"}},
            {"sha256": "sha256:" + "2" * 64, "sizeBytes": 1, "path": "/goal"},
            (),
            (),
            {"sha256": "sha256:" + "3" * 64, "sizeBytes": 1, "path": "/adapter"},
            {
                "path": "/runtime",
                "directoryCount": 1,
                "fileCount": 1,
                "symlinkCount": 0,
                "totalFileBytes": 1,
                "sha256": "sha256:" + "4" * 64,
            },
        )
        self.assertEqual(identity["authority"]["truthLayer"], "GENERATED_CINEMATIC")
        self.assertEqual(identity["authority"]["capturedTruthAuthority"], "none")
        self.assertEqual(identity["authority"]["structuralTruthAuthority"], "none")
        self.assertFalse(identity["authority"]["geometryMutation"])
        self.assertEqual(
            identity["authority"]["promotion"],
            "prohibited_pending_human_review",
        )
        self.assertTrue(identity["limitations"]["mayHallucinateArchitecture"])
        self.assertEqual(
            identity["authorization"]["scope"],
            "safe_local_reversible_internal_r_and_d",
        )
        self.assertEqual(identity["runtimeDependencyClosure"]["path"], "/runtime")
        self.assertEqual(
            identity["runtimeDependencyClosure"]["scope"],
            "site_packages_only",
        )
        self.assertEqual(
            identity["runtimeDependencyClosure"]["unmeasuredExecutionDependencies"],
            [
                "cuda_driver_and_device_runtime",
                "host_elf_interpreter_and_shared_libraries",
                "python_lib_dynload",
                "python_standard_library",
            ],
        )

    def test_runtime_tree_receipt_binds_paths_and_every_file_byte(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / "package").mkdir()
            member = root / "package" / "module.py"
            member.write_bytes(b"VALUE = 1\n")
            first = self.adapter.runtime_tree_receipt(root, "fixture runtime")
            self.assertEqual(first["directoryCount"], 2)
            self.assertEqual(first["fileCount"], 1)
            self.assertEqual(first["symlinkCount"], 0)
            member.write_bytes(b"VALUE = 2\n")
            second = self.adapter.runtime_tree_receipt(root, "fixture runtime")
            self.assertNotEqual(first["sha256"], second["sha256"])

    def test_supervisor_argv_digest_is_order_and_value_bound(self) -> None:
        values = ("preflight", "--source-root", "/source")
        digest = self.adapter.supervisor_argv_digest(values)
        self.assertEqual(digest, self.adapter.supervisor_argv_digest(values))
        self.assertNotEqual(
            digest,
            self.adapter.supervisor_argv_digest(("preflight", "/source", "--source-root")),
        )
        self.assertNotEqual(
            digest,
            self.adapter.supervisor_argv_digest(("preflight", "--source-root", "/other")),
        )

    def test_supervisor_pins_the_exact_adapter_for_a_trusted_host_diagnostic(self) -> None:
        adapter_bytes = ADAPTER_PATH.read_bytes()
        adapter_source = adapter_bytes.decode("utf-8")
        supervisor_source = SUPERVISOR_SOURCE_PATH.read_text(encoding="utf-8")
        digest_match = re.search(
            r'#define EXPECTED_ADAPTER_SHA256 "([0-9a-f]{64})"',
            supervisor_source,
        )
        size_match = re.search(
            r"#define EXPECTED_ADAPTER_SIZE ([0-9]+)LL",
            supervisor_source,
        )
        self.assertIsNotNone(digest_match)
        self.assertIsNotNone(size_match)
        self.assertEqual(digest_match.group(1), hashlib.sha256(adapter_bytes).hexdigest())
        self.assertEqual(int(size_match.group(1)), len(adapter_bytes))
        self.assertNotIn("SUPERVISOR_SHA256: Final", adapter_source)
        self.assertNotIn("externally_allowlisted_static_elf", supervisor_source)
        self.assertIn("trusted_host_diagnostic_only", supervisor_source)
        self.assertIn("cryptographicExecutionProvenance\\\":false", supervisor_source)
        self.assertIn("PR_SET_PDEATHSIG", supervisor_source)
        self.assertIn("terminate_for_signal", supervisor_source)
        self.assertIn("read_completion_proof_stream", supervisor_source)
        self.assertIn("proof.stream_closed &&", supervisor_source)

    def test_late_extra_proof_fixture_escapes_the_child_process_group(self) -> None:
        fixture_source = LATE_EXTRA_PROOF_FIXTURE_PATH.read_text(encoding="utf-8")
        self.assertIn("os.fork()", fixture_source)
        self.assertIn("os.setsid()", fixture_source)
        self.assertIn("time.sleep(0.25)", fixture_source)
        self.assertIn('os.write(descriptor, b"X")', fixture_source)

    @unittest.skipUnless(
        sys.platform == "linux" and shutil.which("gcc") is not None,
        "native proof-reader harness requires Linux and GCC",
    )
    def test_native_proof_reader_rejects_an_escaped_late_writer(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            executable = Path(temporary) / "gsfixer-proof-reader-test"
            compile_result = subprocess.run(
                [
                    "gcc",
                    "-std=c17",
                    "-O2",
                    "-Wall",
                    "-Wextra",
                    "-Werror",
                    str(LATE_EXTRA_PROOF_HARNESS_PATH),
                    "-o",
                    str(executable),
                    "-lcrypto",
                    "-ldl",
                    "-pthread",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(compile_result.returncode, 0, compile_result.stderr)
            run_result = subprocess.run(
                [str(executable)],
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertEqual(run_result.returncode, 0, run_result.stderr)
            receipt = json.loads(run_result.stdout)
            self.assertEqual(receipt["exitCode"], 126)
            self.assertTrue(receipt["completionProofStreamClosed"])
            self.assertFalse(receipt["completionProofValid"])
            self.assertEqual(receipt["completionProofBytesObserved"], 38)

    @unittest.skipUnless(
        sys.platform == "linux" and shutil.which("gcc") is not None,
        "native continuously-readable proof harness requires Linux and GCC",
    )
    def test_native_proof_reader_enforces_deadline_while_reads_stay_positive(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            executable = Path(temporary) / "gsfixer-continuous-proof-reader-test"
            compile_result = subprocess.run(
                [
                    "gcc",
                    "-std=c17",
                    "-O2",
                    "-Wall",
                    "-Wextra",
                    "-Werror",
                    str(CONTINUOUS_PROOF_STREAM_HARNESS_PATH),
                    "-o",
                    str(executable),
                    "-lcrypto",
                    "-ldl",
                    "-pthread",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(compile_result.returncode, 0, compile_result.stderr)
            run_result = subprocess.run(
                [str(executable)],
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertEqual(run_result.returncode, 0, run_result.stderr)
            receipt = json.loads(run_result.stdout)
            self.assertEqual(receipt["exitCode"], 126)
            self.assertFalse(receipt["completionProofStreamClosed"])
            self.assertFalse(receipt["completionProofValid"])
            self.assertEqual(receipt["completionProofBytesObserved"], 38)
            self.assertGreaterEqual(receipt["elapsedMilliseconds"], 50)
            self.assertLess(receipt["elapsedMilliseconds"], 1000)

    def test_adapter_receipt_is_provisional_until_the_supervisor_terminal(self) -> None:
        adapter_source = ADAPTER_PATH.read_text(encoding="utf-8")
        self.assertEqual(
            self.adapter.ADAPTER_PENDING_SUPERVISOR_STATUS,
            "adapter_succeeded_pending_supervisor_terminal",
        )
        self.assertEqual(
            self.adapter.TRUSTED_HOST_PROVENANCE_POSTURE,
            "trusted_host_diagnostic_only",
        )
        self.assertNotIn('"status": "succeeded"', adapter_source)
        self.assertIn("emit_supervisor_completion_proof(\"run\")", adapter_source)

    def test_attempt_must_be_disjoint_from_every_input_tree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            output_parent = root / "outputs"
            output_parent.mkdir()
            accepted = output_parent / "attempt"
            self.assertEqual(
                self.adapter.require_output_isolated(accepted, (source,)),
                accepted,
            )
            with self.assertRaisesRegex(self.adapter.AdapterError, "overlaps"):
                self.adapter.require_output_isolated(source / "attempt", (source,))
            (source / "nested").mkdir()
            with self.assertRaisesRegex(self.adapter.AdapterError, "overlaps"):
                self.adapter.require_output_isolated(root / "source", (source / "nested",))

    @unittest.skipUnless(sys.platform == "linux", "directory-FD binding requires Linux procfs")
    def test_supervised_attempt_uses_the_exact_inherited_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary).resolve()
            declared = parent / "attempt"
            declared.mkdir(mode=0o700)
            descriptor = os.open(declared, os.O_RDONLY | os.O_DIRECTORY)
            environment = {
                "VENVIEWER_GSFIXER_ATTEMPT_FD": str(descriptor),
                "VENVIEWER_GSFIXER_ATTEMPT_PATH": str(declared),
            }
            try:
                with mock.patch.object(self.adapter, "ATTEMPT_PARENT", parent), mock.patch.dict(
                    os.environ,
                    environment,
                    clear=False,
                ):
                    execution_root, binding = self.adapter.supervised_attempt_directory(declared)
                self.assertEqual(execution_root, Path(f"/proc/self/fd/{descriptor}"))
                self.assertEqual(binding["declaredPath"], str(declared))
                with mock.patch.dict(os.environ, environment, clear=False):
                    receipt = self.adapter.exclusive_write(
                        execution_root / "probe.bin",
                        b"bound",
                        "supervised probe",
                    )
                self.assertEqual((declared / "probe.bin").read_bytes(), b"bound")
                self.assertEqual(receipt["sha256"], self.adapter.sha256_bytes(b"bound"))
            finally:
                os.close(descriptor)

    @unittest.skipUnless(sys.platform == "linux", "directory-FD binding requires Linux procfs")
    def test_supervised_receipt_uses_the_exact_inherited_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary).resolve()
            declared = parent / "receipt"
            displaced = parent / "receipt-displaced"
            declared.mkdir(mode=0o700)
            descriptor = os.open(declared, os.O_RDONLY | os.O_DIRECTORY)
            metadata = os.fstat(descriptor)
            environment = {
                "VENVIEWER_GSFIXER_RECEIPT_FD": str(descriptor),
                "VENVIEWER_GSFIXER_RECEIPT_PATH": str(declared),
                "VENVIEWER_GSFIXER_RECEIPT_DEVICE": str(metadata.st_dev),
                "VENVIEWER_GSFIXER_RECEIPT_INODE": str(metadata.st_ino),
                "VENVIEWER_GSFIXER_STARTED_RECEIPT_DIR": str(declared),
            }
            try:
                with mock.patch.object(self.adapter, "RECEIPT_PARENT", parent), mock.patch.dict(
                    os.environ,
                    environment,
                    clear=False,
                ):
                    execution_root, receipt_directory, binding = (
                        self.adapter.supervised_receipt_directory()
                    )
                self.assertEqual(execution_root, Path(f"/proc/self/fd/{descriptor}"))
                self.assertEqual(receipt_directory, declared)
                self.assertEqual(binding["device"], metadata.st_dev)
                self.assertEqual(binding["inode"], metadata.st_ino)

                wrong_inode = {
                    **environment,
                    "VENVIEWER_GSFIXER_RECEIPT_INODE": str(metadata.st_ino + 1),
                }
                with mock.patch.object(self.adapter, "RECEIPT_PARENT", parent), mock.patch.dict(
                    os.environ,
                    wrong_inode,
                    clear=False,
                ), self.assertRaisesRegex(self.adapter.AdapterError, "identity changed"):
                    self.adapter.supervised_receipt_directory()

                declared.rename(displaced)
                declared.mkdir(mode=0o700)
                with mock.patch.object(self.adapter, "RECEIPT_PARENT", parent), mock.patch.dict(
                    os.environ,
                    environment,
                    clear=False,
                ), self.assertRaisesRegex(self.adapter.AdapterError, "identity changed"):
                    self.adapter.supervised_receipt_directory()
                declared.rmdir()
                displaced.rename(declared)
            finally:
                os.close(descriptor)

    def test_grand_hall_source_digest_is_compiled_not_caller_controlled(self) -> None:
        parser = self.adapter.build_parser()
        option_strings = {
            option
            for action in parser._subparsers._group_actions[0].choices["run"]._actions
            for option in action.option_strings
        }
        self.assertNotIn("--expected-input-sha256", option_strings)
        self.assertIn("--input-pack-manifest", option_strings)
        self.assertIn("--input-pack-publication-receipt", option_strings)
        self.assertIn("--goal-file", option_strings)
        self.assertEqual(
            self.adapter.GRAND_HALL_SOURCE_SHA256,
            "22585a23b5ced06c652f838d894a02903c2c405107dd13eaeb0957754d30ec43",
        )

    def test_adapter_receipt_rejects_execution_without_the_linux_supervisor(self) -> None:
        with self.assertRaisesRegex(
            self.adapter.AdapterError,
            "Linux supervisor|Missing supervisor binding",
        ):
            self.adapter.adapter_receipt()

    def test_completion_proof_is_nonce_and_command_bound(self) -> None:
        read_descriptor, write_descriptor = os.pipe()
        nonce = "ab" * 32
        environment = {
            "VENVIEWER_GSFIXER_SUPERVISOR_PID": "731",
            "VENVIEWER_GSFIXER_COMPLETION_FD": str(write_descriptor),
            "VENVIEWER_GSFIXER_COMPLETION_NONCE": nonce,
            "VENVIEWER_GSFIXER_COMPLETION_TAG": str(ord("P")),
        }
        with tempfile.TemporaryDirectory() as temporary:
            receipt_directory = Path(temporary)
            try:
                with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
                    os,
                    "getppid",
                    return_value=731,
                ), mock.patch.object(
                    self.adapter,
                    "supervised_receipt_directory",
                    return_value=(receipt_directory, receipt_directory, {}),
                ):
                    self.adapter.emit_supervisor_completion_proof("preflight")
                self.assertEqual(
                    os.read(read_descriptor, 128),
                    b"VGH1" + bytes.fromhex(nonce) + b"P",
                )
            finally:
                os.close(read_descriptor)

    def test_completion_proof_rejects_an_existing_terminal_receipt(self) -> None:
        read_descriptor, write_descriptor = os.pipe()
        nonce = "cd" * 32
        environment = {
            "VENVIEWER_GSFIXER_SUPERVISOR_PID": "731",
            "VENVIEWER_GSFIXER_COMPLETION_FD": str(write_descriptor),
            "VENVIEWER_GSFIXER_COMPLETION_NONCE": nonce,
            "VENVIEWER_GSFIXER_COMPLETION_TAG": str(ord("P")),
        }
        with tempfile.TemporaryDirectory() as temporary:
            receipt_directory = Path(temporary)
            (receipt_directory / "terminal.json").write_text("{}\n", encoding="utf-8")
            try:
                with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
                    os,
                    "getppid",
                    return_value=731,
                ), mock.patch.object(
                    self.adapter,
                    "supervised_receipt_directory",
                    return_value=(receipt_directory, receipt_directory, {}),
                ), self.assertRaisesRegex(self.adapter.AdapterError, "terminal receipt exists"):
                    self.adapter.emit_supervisor_completion_proof("preflight")
            finally:
                os.close(write_descriptor)
                os.close(read_descriptor)

    def test_matplotlib_shim_allows_introspection_but_forbids_colormaps(self) -> None:
        previous = sys.modules.get("matplotlib")
        try:
            self.adapter.install_unused_matplotlib_import_shim()
            module = sys.modules["matplotlib"]
            self.assertEqual(
                module.__file__,
                "<venviewer-gsfixer-unused-matplotlib-shim>",
            )
            with self.assertRaisesRegex(self.adapter.AdapterError, "colormap"):
                module.colormaps["Spectral"]
        finally:
            if previous is None:
                sys.modules.pop("matplotlib", None)
            else:
                sys.modules["matplotlib"] = previous

    def test_exclusive_write_removes_a_file_if_post_write_verification_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "receipt.json"
            with mock.patch.object(
                self.adapter,
                "stable_file_receipt",
                side_effect=self.adapter.AdapterError("verification failed"),
            ):
                with self.assertRaisesRegex(self.adapter.AdapterError, "verification failed"):
                    self.adapter.exclusive_write(path, b"{}\n", "fixture receipt")
            self.assertFalse(path.exists())

    def test_model_execution_snapshot_is_an_independent_exact_copy(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model = root / "model"
            attempt = root / "attempt"
            model.mkdir()
            attempt.mkdir()
            payload = b"sealed-model-member"
            member = model / "model_index.json"
            member.write_bytes(payload)
            closure = {
                "model_index.json": (
                    len(payload),
                    self.adapter.sha256_bytes(payload),
                ),
            }
            with mock.patch.object(self.adapter, "MODEL_CLOSURE", closure):
                snapshot, receipts = self.adapter.create_model_execution_snapshot(
                    model,
                    attempt,
                )
            copied = snapshot / "model_index.json"
            self.assertEqual(copied.read_bytes(), payload)
            self.assertEqual(receipts[0]["sha256"], self.adapter.sha256_bytes(payload))
            self.assertNotEqual(member.stat().st_ino, copied.stat().st_ino)
            member.write_bytes(b"changed-source-member")
            self.assertEqual(copied.read_bytes(), payload)

    def test_import_origin_is_confined_to_the_private_source_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            snapshot = Path(temporary)
            package = snapshot / "marigold"
            package.mkdir()
            (package / "__init__.py").write_text("MARKER = 'private'\n", encoding="utf-8")
            previous = {
                name: module
                for name, module in sys.modules.items()
                if name == "marigold" or name.startswith("marigold.")
            }
            for name in previous:
                sys.modules.pop(name, None)
            try:
                imported = self.adapter.require_exact_marigold_imports(snapshot)
                self.assertEqual(imported.MARKER, "private")
                self.assertTrue(Path(imported.__file__).resolve().is_relative_to(snapshot.resolve()))
            finally:
                for name in tuple(sys.modules):
                    if name == "marigold" or name.startswith("marigold."):
                        sys.modules.pop(name, None)
                sys.modules.update(previous)

    def test_input_lineage_binds_room_source_authority_publication_and_goal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            input_path = root / "source-render.png"
            manifest_path = root / "manifest.authority-none.json"
            publication_path = root / "publication-receipt.json"
            goal_path = root / "goal.txt"
            source_digest = "4" * 64
            expected_source = {
                "fileName": "source-render.png",
                "sha256": f"sha256:{source_digest}",
                "sizeBytes": 959_672,
            }
            manifest = {
                "roomRef": "trades-hall/grand-hall",
                "sourceRender": expected_source,
                "authority": {"authority": "none"},
            }
            manifest_bytes = json.dumps(manifest, separators=(",", ":")).encode("utf-8")
            manifest_path.write_bytes(manifest_bytes)
            publication = {
                "manifest": {
                    "fileName": "manifest.authority-none.json",
                    "sha256": self.adapter.sha256_bytes(manifest_bytes),
                    "sizeBytes": len(manifest_bytes),
                },
                "authority": "none",
                "filesBeforeReceipt": [expected_source],
            }
            publication_bytes = json.dumps(publication, separators=(",", ":")).encode("utf-8")
            publication_path.write_bytes(publication_bytes)
            goal_bytes = b"Grand Hall local generated-cinematic diagnostic authorization\n"
            goal_path.write_bytes(goal_bytes)
            patches = (
                mock.patch.object(self.adapter, "GRAND_HALL_SOURCE_SHA256", source_digest),
                mock.patch.object(self.adapter, "INPUT_PACK_MANIFEST_SIZE", len(manifest_bytes)),
                mock.patch.object(self.adapter, "INPUT_PACK_MANIFEST_SHA256", self.adapter.sha256_bytes(manifest_bytes).removeprefix("sha256:")),
                mock.patch.object(self.adapter, "INPUT_PACK_PUBLICATION_RECEIPT_SIZE", len(publication_bytes)),
                mock.patch.object(self.adapter, "INPUT_PACK_PUBLICATION_RECEIPT_SHA256", self.adapter.sha256_bytes(publication_bytes)),
                mock.patch.object(self.adapter, "GOAL_FILE_SIZE", len(goal_bytes)),
                mock.patch.object(self.adapter, "GOAL_FILE_SHA256", self.adapter.sha256_bytes(goal_bytes)),
            )
            with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
                input_pack, goal_receipt, parsed = self.adapter.verify_input_lineage(
                    input_path,
                    manifest_path,
                    publication_path,
                    goal_path,
                )
                self.assertEqual(parsed["roomRef"], "trades-hall/grand-hall")
                self.assertEqual(input_pack["authority"], {"authority": "none"})
                self.assertEqual(goal_receipt["sha256"], self.adapter.sha256_bytes(goal_bytes))

                tampered = {**manifest, "authority": {"authority": "generated"}}
                tampered_bytes = json.dumps(tampered, separators=(",", ":")).encode("utf-8")
                manifest_path.write_bytes(tampered_bytes)
                with mock.patch.object(self.adapter, "INPUT_PACK_MANIFEST_SIZE", len(tampered_bytes)), mock.patch.object(
                    self.adapter,
                    "INPUT_PACK_MANIFEST_SHA256",
                    self.adapter.sha256_bytes(tampered_bytes).removeprefix("sha256:"),
                ):
                    with self.assertRaisesRegex(self.adapter.AdapterError, "authority-none"):
                        self.adapter.verify_input_lineage(
                            input_path,
                            manifest_path,
                            publication_path,
                            goal_path,
                        )


if __name__ == "__main__":
    unittest.main()
