from __future__ import annotations

import hashlib
import inspect
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
from types import ModuleType
import unittest
from unittest import mock


SCRIPT_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = Path(__file__).resolve().parent / "fixtures"
REPOSITORY_ROOT = SCRIPT_ROOT.parents[2]
PROOF_FILE = (
    REPOSITORY_ROOT
    / "docs"
    / "operations"
    / "grand-hall-authority-none-icp-two-process-proof-v1.json"
)
EXPECTED_WORKER_SHA256 = (
    "7f2cce27db8e9b5edc9892ac19a705813665fbbe69235f2523b826baf8b530c6"
)
EXPECTED_CHILD_ENTRY_SHA256 = (
    "8711080f64af76ea111185f0e07adf6faafafdb988f7049c9dbec210e4c5768a"
)
EXPECTED_RUNNER_SHA256 = (
    "52c226b711c321842eecfd587de61103dc16c6c939c3fc1b064e7ab7f56067a6"
)
EXPECTED_VALIDATED_RECEIPT_SHA256 = (
    "83d9bd9564f3c5212b27260b11d0527ab496f3d1404cc05edd39013e2d3d9332"
)
EXPECTED_SEED_ADAPTER_SHA256 = (
    "5f84fa5a63f9d8fabda0f1a689d15a6c4046fd11e8d1813a53c2544bade798a6"
)
EXPECTED_PROOF_CANONICAL_SHA256 = (
    "c9d23fa354e1415dd69fed28ebe3e3e2aa638be75283f1a93b707ed5cfd57c62"
)
EXPECTED_PROOF_RAW_SHA256 = (
    "a48eb43502b276a8e37467276d11248aef8f7bd684560eab3717c185b61a0c7d"
)
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

import grand_hall_authority_none_icp_child_entry as child_entry  # noqa: E402
import grand_hall_authority_none_icp_two_process_runner as runner  # noqa: E402


def _process_is_running(process_id: int) -> bool:
    if os.name != "nt":
        try:
            os.kill(process_id, 0)
        except ProcessLookupError:
            return False
        return True

    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    handle = kernel32.OpenProcess(0x00100000, False, process_id)
    if not handle:
        return False
    try:
        return kernel32.WaitForSingleObject(handle, 0) == 0x00000102
    finally:
        kernel32.CloseHandle(handle)


def _synthetic_receipt(
    *, payload: object = "synthetic-stable-receipt", accepted_transform: bool = False
) -> dict[str, object]:
    unvalidated = {
        "schemaVersion": "venviewer.grand-hall.authority-none-icp-replay.v1",
        "authority": {
            "classification": "none",
            "acceptedTransform": accepted_transform,
            "architecturalEvidence": False,
        },
        "runtime": {
            "pythonVersion": "synthetic-python",
            "numpyVersion": "synthetic-numpy",
            "scipyVersion": "synthetic-scipy",
            "trimeshVersion": "synthetic-trimesh",
            "bitExactComparisonRequiresSamePinnedNumericalRuntime": True,
        },
        "algorithm": {
            "nearestNeighbour": {
                "determinismClassification": "same-runtime-same-host-only",
            },
        },
        "guardrails": {
            "pathsIncludedInReceipt": False,
            "timestampsIncludedInReceipt": False,
            "writesFiles": False,
            "doesNotInferArchitecture": True,
            "doesNotClaimRegistrationAcceptance": True,
            "exactSameProcessRepeatedReceiptRequired": True,
        },
        "seedAdapterV1": {
            "schemaVersion": (
                "venviewer.grand-hall.authority-none-icp-seed-adapter.v1"
            ),
            "workerSchemaVersion": (
                "venviewer.grand-hall.authority-none-icp-replay.v1"
            ),
            "authority": "none",
            "architecturalEvidence": False,
            "humanReviewRequiredBeforeAnyPromotion": True,
            "syntheticPayload": payload,
        },
        "syntheticPayload": payload,
    }
    receipt = dict(unvalidated)
    receipt["repeatedReplayValidation"] = {
        "sameProcessRunCount": 2,
        "canonicalReceiptBytesIdentical": True,
        "canonicalUnvalidatedReceiptSha256": hashlib.sha256(
            runner.canonical_json_bytes(unvalidated)
        ).hexdigest(),
        "scope": runner.REPEATED_REPLAY_SCOPE,
    }
    return receipt


class GrandHallAuthorityNoneIcpTwoProcessRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.worker = self.root / runner.WORKER_FILE_NAME
        self.entry = self.root / runner.CHILD_ENTRY_FILE_NAME
        self.worker.write_bytes(b"synthetic worker bytes; never executed\n")
        shutil.copyfile(
            FIXTURE_ROOT / "grand_hall_authority_none_icp_synthetic_child.py",
            self.entry,
        )
        self.worker_sha256 = hashlib.sha256(self.worker.read_bytes()).hexdigest()
        stable_receipt_bytes = runner.canonical_json_bytes(_synthetic_receipt())
        self.stable_receipt_sha256 = hashlib.sha256(stable_receipt_bytes).hexdigest()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _run(
        self,
        mode: str = "synthetic-stable",
        *,
        expected_receipt: dict[str, object] | None = None,
        child_timeout_seconds: int = 10,
    ) -> dict[str, object]:
        expected_bytes = runner.canonical_json_bytes(
            _synthetic_receipt() if expected_receipt is None else expected_receipt
        )
        return runner._run_synthetic_two_process_replay_proof(
            self.root / "source-location-is-never-read.obj",
            self.root / "target-location-is-never-read.obj",
            source_logical_id=mode,
            target_logical_id="synthetic-target",
            python_executable=sys.executable,
            worker_path=self.worker,
            child_entry_path=self.entry,
            expected_worker_sha256=self.worker_sha256,
            expected_canonical_worker_receipt_sha256=hashlib.sha256(
                expected_bytes
            ).hexdigest(),
            child_timeout_seconds=child_timeout_seconds,
        )

    def test_records_distinct_child_process_evidence_and_exact_bindings(self) -> None:
        proof = self._run()

        self.assertEqual(
            proof["schemaVersion"], runner.SYNTHETIC_PROOF_SCHEMA_VERSION
        )
        self.assertEqual(
            proof["authority"]["classification"], "synthetic-test-only"
        )
        self.assertFalse(proof["authority"]["acceptedTransform"])
        self.assertNotIn("workerReceipt", proof)
        self.assertEqual(
            proof["workerReceiptSchemaVersion"],
            "venviewer.grand-hall.authority-none-icp-replay.v1",
        )
        self.assertFalse(proof["canonicalWorkerReceiptIncluded"])
        self.assertEqual(
            proof["canonicalWorkerReceiptSha256"], self.stable_receipt_sha256
        )
        self.assertEqual(
            proof["seedAdapterV1CanonicalJsonSha256"],
            hashlib.sha256(
                runner.canonical_json_bytes(
                    _synthetic_receipt()["seedAdapterV1"]
                )
            ).hexdigest(),
        )
        self.assertEqual(
            proof["workerRuntime"], _synthetic_receipt()["runtime"]
        )
        self.assertEqual(
            proof["sameProcessRepeatedReplayValidation"][
                "sameProcessRunCountPerChild"
            ],
            2,
        )
        self.assertTrue(
            proof["guardrails"][
                "completeWorkerEvidenceBoundByCanonicalReceiptSha256"
            ]
        )
        process_evidence = proof["processEvidence"]
        self.assertEqual(process_evidence["childProcessCount"], 2)
        self.assertEqual(len(process_evidence["launchProcessModels"]), 2)
        self.assertTrue(
            all(
                model
                in {
                    "direct-python-child",
                    "python-launcher-redirected-worker-child",
                }
                for model in process_evidence["launchProcessModels"]
            )
        )
        self.assertTrue(
            process_evidence["distinctLauncherProcessIdsWithinParentRun"]
        )
        self.assertTrue(
            process_evidence["distinctChildProcessIdsWithinParentRun"]
        )
        self.assertTrue(
            process_evidence["launcherWorkerProcessChainsValidated"]
        )
        self.assertTrue(process_evidence["canonicalWorkerReceiptBytesIdentical"])
        self.assertTrue(proof["guardrails"]["syntheticTestOnly"])
        self.assertFalse(
            proof["guardrails"][
                "reviewedInputBytesValidatedBeforeChildLaunch"
            ]
        )
        self.assertNotIn("reviewedInputBindings", proof)

        bindings = proof["implementationBindings"]
        self.assertEqual(bindings["workerImplementationSha256"], self.worker_sha256)
        self.assertEqual(
            bindings["childEntryImplementationSha256"],
            hashlib.sha256(self.entry.read_bytes()).hexdigest(),
        )
        actual_runner_sha256 = hashlib.sha256(
            Path(runner.__file__).read_bytes()
        ).hexdigest()
        self.assertEqual(
            bindings["twoProcessRunnerImplementationSha256"],
            actual_runner_sha256,
        )
        rendered = runner.canonical_json_bytes(proof).decode("utf-8")
        self.assertNotIn(str(self.root), rendered)
        self.assertNotIn("source-location-is-never-read.obj", rendered)
        self.assertNotIn("target-location-is-never-read.obj", rendered)
        for forbidden_key in (
            "runnerProcessId",
            "launcherProcessId",
            "reportedParentProcessId",
            "workerProcessId",
        ):
            self.assertNotIn(f'"{forbidden_key}":', rendered)

    def test_independent_exact_proof_runs_have_identical_canonical_bytes(self) -> None:
        first = self._run()
        second = self._run()
        self.assertEqual(
            runner.canonical_json_bytes(first),
            runner.canonical_json_bytes(second),
        )

    def test_reviewed_production_files_and_proof_are_exactly_bound(self) -> None:
        worker_path = SCRIPT_ROOT / runner.WORKER_FILE_NAME
        entry_path = SCRIPT_ROOT / runner.CHILD_ENTRY_FILE_NAME
        runner_path = Path(runner.__file__)
        actual_hashes = {
            "workerImplementationSha256": hashlib.sha256(
                worker_path.read_bytes()
            ).hexdigest(),
            "childEntryImplementationSha256": hashlib.sha256(
                entry_path.read_bytes()
            ).hexdigest(),
            "twoProcessRunnerImplementationSha256": hashlib.sha256(
                runner_path.read_bytes()
            ).hexdigest(),
        }
        self.assertEqual(
            actual_hashes,
            {
                "workerImplementationSha256": EXPECTED_WORKER_SHA256,
                "childEntryImplementationSha256": EXPECTED_CHILD_ENTRY_SHA256,
                "twoProcessRunnerImplementationSha256": EXPECTED_RUNNER_SHA256,
            },
        )
        self.assertEqual(runner.REVIEWED_WORKER_SHA256, EXPECTED_WORKER_SHA256)
        self.assertEqual(
            runner.REVIEWED_CHILD_ENTRY_SHA256,
            EXPECTED_CHILD_ENTRY_SHA256,
        )
        self.assertEqual(
            runner.REVIEWED_CANONICAL_WORKER_RECEIPT_SHA256,
            EXPECTED_VALIDATED_RECEIPT_SHA256,
        )

        raw_proof = PROOF_FILE.read_bytes()
        proof = json.loads(raw_proof.decode("utf-8"))
        canonical_proof = runner.canonical_json_bytes(proof)
        self.assertEqual(raw_proof, canonical_proof + b"\n")
        self.assertEqual(len(canonical_proof), 3_464)
        self.assertEqual(
            hashlib.sha256(canonical_proof).hexdigest(),
            EXPECTED_PROOF_CANONICAL_SHA256,
        )
        self.assertEqual(
            hashlib.sha256(raw_proof).hexdigest(),
            EXPECTED_PROOF_RAW_SHA256,
        )
        self.assertEqual(proof["schemaVersion"], runner.PROOF_SCHEMA_VERSION)
        self.assertEqual(proof["implementationBindings"], {
            **actual_hashes,
            "bindingsReverifiedAfterBothChildrenExited": True,
        })
        self.assertEqual(
            proof["canonicalWorkerReceiptSha256"],
            EXPECTED_VALIDATED_RECEIPT_SHA256,
        )
        self.assertEqual(proof["canonicalWorkerReceiptByteLength"], 840_753)
        self.assertEqual(
            proof["seedAdapterV1CanonicalJsonSha256"],
            EXPECTED_SEED_ADAPTER_SHA256,
        )
        self.assertEqual(
            proof["workerRuntime"],
            {
                "pythonVersion": "3.13.6",
                "numpyVersion": "2.4.2",
                "scipyVersion": "1.17.0",
                "trimeshVersion": "4.11.2",
                "bitExactComparisonRequiresSamePinnedNumericalRuntime": True,
            },
        )
        self.assertEqual(
            proof["sameProcessRepeatedReplayValidation"],
            {
                "requiredForEachChild": True,
                "sameProcessRunCountPerChild": 2,
                "canonicalUnvalidatedReceiptBytesIdenticalWithinEachChild": True,
                "canonicalUnvalidatedReceiptSha256": (
                    "ecf86ad05802aab6c8893bb64942c89b86df24b171927e881035942f5c5d636d"
                ),
                "scope": runner.REPEATED_REPLAY_SCOPE,
            },
        )
        determinism = proof["determinismBoundary"]
        self.assertEqual(
            determinism["classification"],
            "reported-worker-versions-and-explicit-child-launch-controls-only",
        )
        self.assertFalse(determinism["effectiveInterpreterBinaryVerified"])
        self.assertTrue(
            determinism["reportedWorkerVersionsEqualAcrossChildren"]
        )
        self.assertTrue(determinism["explicitChildLaunchControlsApplied"])
        self.assertFalse(determinism["environmentLockDocumentApplied"])
        self.assertFalse(determinism["installedDependencyTreesVerified"])
        self.assertFalse(determinism["loadedNativeClosureVerified"])
        self.assertEqual(
            determinism["threadEnvironmentControls"],
            runner.THREAD_ENVIRONMENT_CONTROLS,
        )
        self.assertEqual(
            proof["reviewedInputBindings"],
            {
                "source": {
                    "byteLength": runner.REVIEWED_SOURCE_BYTE_LENGTH,
                    "sha256": runner.REVIEWED_SOURCE_SHA256,
                },
                "target": {
                    "byteLength": runner.REVIEWED_TARGET_BYTE_LENGTH,
                    "sha256": runner.REVIEWED_TARGET_SHA256,
                },
                "bindingsReverifiedAfterBothChildrenExited": True,
            },
        )
        guardrails = proof["guardrails"]
        self.assertFalse(guardrails["machineIdentifiersIncludedInProof"])
        self.assertFalse(guardrails["processIdentifiersIncludedInProof"])
        self.assertTrue(
            guardrails["reviewedInputBytesValidatedBeforeChildLaunch"]
        )
        process_evidence = proof["processEvidence"]
        self.assertEqual(
            len(process_evidence["launchProcessModels"]),
            2,
        )
        runner._assert_path_timestamp_and_host_free(proof, "reviewed proof")
        runner._assert_raw_process_identifiers_absent(proof, "reviewed proof")

    def test_rejects_receipts_that_differ_between_child_processes(self) -> None:
        with self.assertRaisesRegex(
            runner.TwoProcessProofError,
            "separate child canonical worker receipts differed",
        ):
            self._run("synthetic-vary")

    def test_rejects_an_absolute_location_leaked_by_a_child(self) -> None:
        with self.assertRaisesRegex(
            runner.TwoProcessProofError,
            "absolute location or timestamp",
        ):
            self._run("synthetic-path-leak")

    def test_rejects_location_and_numeric_timestamp_fields(self) -> None:
        for mode in ("synthetic-relative-path-field", "synthetic-time-field"):
            with self.subTest(mode=mode), self.assertRaisesRegex(
                runner.TwoProcessProofError,
                "forbidden location, host, or time field",
            ):
                self._run(mode)

    def test_rejects_a_child_receipt_that_claims_an_accepted_transform(self) -> None:
        with self.assertRaisesRegex(
            runner.TwoProcessProofError,
            "forbidden authority claim",
        ):
            self._run("synthetic-authority-drift")

    def test_rejects_child_parent_process_identity_drift(self) -> None:
        with self.assertRaisesRegex(
            runner.TwoProcessProofError,
            "process identity evidence did not match",
        ):
            self._run("synthetic-parent-drift")

    def test_rejects_noncanonical_child_receipt_bytes(self) -> None:
        with self.assertRaisesRegex(
            runner.TwoProcessProofError,
            "bytes are not canonical JSON",
        ):
            self._run("synthetic-pretty-json")

    def test_rejects_missing_or_unbound_same_process_validation(self) -> None:
        expectations = {
            "synthetic-missing-repeat": "repeated replay validation",
            "synthetic-repeat-digest-drift": "not bound to the worker receipt",
        }
        for mode, message in expectations.items():
            with self.subTest(mode=mode), self.assertRaisesRegex(
                runner.TwoProcessProofError,
                message,
            ):
                self._run(mode)

    def test_rejects_worker_bytes_before_launch_when_reviewed_digest_drifts(self) -> None:
        with self.assertRaisesRegex(
            runner.TwoProcessProofError,
            "worker bytes differ from the expected reviewed digest",
        ):
            runner._run_synthetic_two_process_replay_proof(
                self.root / "unused-source.obj",
                self.root / "unused-target.obj",
                source_logical_id="synthetic-stable",
                target_logical_id="synthetic-target",
                python_executable=sys.executable,
                worker_path=self.worker,
                child_entry_path=self.entry,
                expected_worker_sha256="0" * 64,
                expected_canonical_worker_receipt_sha256=self.stable_receipt_sha256,
                child_timeout_seconds=10,
            )

    def test_production_v1_api_exposes_no_path_or_digest_overrides(self) -> None:
        parameters = inspect.signature(
            runner.run_two_process_replay_proof
        ).parameters
        self.assertEqual(
            set(parameters),
            {
                "source_path",
                "target_path",
                "source_logical_id",
                "target_logical_id",
                "child_timeout_seconds",
            },
        )
        production_paths = runner._production_execution_paths()
        self.assertEqual(
            production_paths.worker,
            SCRIPT_ROOT / runner.WORKER_FILE_NAME,
        )
        self.assertEqual(
            production_paths.entry,
            SCRIPT_ROOT / runner.CHILD_ENTRY_FILE_NAME,
        )

    def test_reviewed_input_snapshot_binds_size_and_sha256(self) -> None:
        path = self.root / "bounded-reviewed-input.obj"
        payload = b"reviewed-input-bytes"
        path.write_bytes(payload)
        expected_sha256 = hashlib.sha256(payload).hexdigest()
        binding = runner._reviewed_input_snapshot(
            path,
            expected_byte_length=len(payload),
            expected_sha256=expected_sha256,
            label="fixture input",
        )
        self.assertEqual(binding.payload, payload)
        self.assertEqual(binding.sha256, expected_sha256)

        path.write_bytes(b"x" * len(payload))
        with self.assertRaisesRegex(
            runner.TwoProcessProofError,
            "SHA-256 differs from the reviewed input binding",
        ):
            runner._reviewed_input_snapshot(
                path,
                expected_byte_length=len(payload),
                expected_sha256=expected_sha256,
                label="fixture input",
            )

    def test_unreviewed_production_input_fails_before_any_child_launch(self) -> None:
        source = self.root / "unreviewed-source.obj"
        target = self.root / "unreviewed-target.obj"
        source.write_bytes(b"not-the-reviewed-source")
        target.write_bytes(b"not-the-reviewed-target")
        with (
            mock.patch.object(runner, "_launch_child_pair") as launch_pair,
            self.assertRaisesRegex(
                runner.TwoProcessProofError,
                "reviewed source input byte length differs",
            ),
        ):
            runner.run_two_process_replay_proof(source, target)
        launch_pair.assert_not_called()

    def test_child_environment_is_closed_and_sets_all_thread_controls(self) -> None:
        parent_environment = {
            "SystemRoot": "C:\\Windows",
            "TEMP": "C:\\Temp",
            "VENVIEWER_SYNTHETIC_PARENT_SENTINEL": "must-not-leak",
            "OMP_NUM_THREADS": "99",
        }
        child_environment = runner._child_environment(parent_environment)
        self.assertEqual(
            child_environment,
            {
                "SystemRoot": "C:\\Windows",
                "TEMP": "C:\\Temp",
                **runner.THREAD_ENVIRONMENT_CONTROLS,
            },
        )

        sentinel = "VENVIEWER_SYNTHETIC_PARENT_SENTINEL"
        previous = os.environ.get(sentinel)
        os.environ[sentinel] = "must-not-leak"
        try:
            expected_payload = {
                "threadEnvironmentControls": runner.THREAD_ENVIRONMENT_CONTROLS,
                "unexpectedParentEnvironmentPresent": False,
            }
            proof = self._run(
                "synthetic-env",
                expected_receipt=_synthetic_receipt(payload=expected_payload),
            )
        finally:
            if previous is None:
                del os.environ[sentinel]
            else:
                os.environ[sentinel] = previous
        self.assertEqual(
            proof["determinismBoundary"]["threadEnvironmentControls"],
            runner.THREAD_ENVIRONMENT_CONTROLS,
        )

    def test_timeout_terminates_redirected_launcher_and_worker_tree(self) -> None:
        shutil.copyfile(
            FIXTURE_ROOT / "grand_hall_authority_none_icp_timeout_tree_child.py",
            self.entry,
        )
        marker = self.root / "timeout-process-ids.txt"
        with self.assertRaisesRegex(
            runner.TwoProcessProofError,
            "exceeded the closed timeout",
        ):
            runner._run_synthetic_two_process_replay_proof(
                marker,
                self.root / "unused-target.obj",
                source_logical_id="synthetic-timeout",
                target_logical_id="synthetic-target",
                python_executable=sys.executable,
                worker_path=self.worker,
                child_entry_path=self.entry,
                expected_worker_sha256=self.worker_sha256,
                expected_canonical_worker_receipt_sha256=(
                    self.stable_receipt_sha256
                ),
                child_timeout_seconds=2,
            )

        process_ids = {
            key: int(value)
            for key, value in (
                line.split("=", maxsplit=1)
                for line in marker.read_text(encoding="utf-8").splitlines()
            )
        }
        self.assertEqual(set(process_ids), {"launcher", "worker"})
        deadline = time.monotonic() + runner.POST_TERMINATION_WAIT_SECONDS
        while any(_process_is_running(value) for value in process_ids.values()):
            if time.monotonic() >= deadline:
                break
            time.sleep(0.05)
        self.assertFalse(
            any(_process_is_running(value) for value in process_ids.values()),
            f"timed-out process tree survived: {process_ids}",
        )

    def test_posix_timeout_cleanup_kills_the_child_process_group(self) -> None:
        process = mock.Mock()
        process.pid = 4815
        process.poll.return_value = None
        with (
            mock.patch.object(runner.os, "name", "posix"),
            mock.patch.object(runner.os, "killpg", create=True) as kill_group,
            mock.patch.object(runner.signal, "SIGKILL", 9, create=True),
        ):
            supervisor = runner._ChildProcessSupervisor(process)
            supervisor.terminate_tree()
        kill_group.assert_called_once_with(4815, 9)
        process.kill.assert_called_once_with()

    def test_production_child_request_schema_rejects_unknown_fields(self) -> None:
        valid = {
            "schemaVersion": child_entry.REQUEST_SCHEMA_VERSION,
            "sourcePath": "synthetic-source.obj",
            "targetPath": "synthetic-target.obj",
            "sourceLogicalId": "synthetic-source",
            "targetLogicalId": "synthetic-target",
            "expectedWorkerSha256": "1" * 64,
            "expectedEntrySha256": "2" * 64,
        }
        self.assertEqual(
            child_entry._validate_request(valid)["sourceLogicalId"],
            "synthetic-source",
        )
        with self.assertRaisesRegex(child_entry.ChildEntryError, "closed schema"):
            child_entry._validate_request({**valid, "unexpected": False})

    def test_production_child_request_requires_canonical_duplicate_free_json(self) -> None:
        with self.assertRaisesRegex(child_entry.ChildEntryError, "duplicate JSON key"):
            child_entry._strict_json_object(b'{"a":1,"a":1}', "fixture")
        with self.assertRaisesRegex(child_entry.ChildEntryError, "canonical JSON"):
            child_entry._strict_json_object(b'{"b": 1}', "fixture")

    def test_production_child_invokes_and_requires_the_two_run_worker_gate(self) -> None:
        worker = ModuleType("synthetic_reviewed_worker")
        calls: list[tuple[object, ...]] = []

        def replay_twice(*args: object, **kwargs: object) -> dict[str, object]:
            calls.append((*args, kwargs))
            return _synthetic_receipt()

        worker.replay_grand_hall_authority_none_icp_twice = replay_twice
        request = {
            "sourcePath": "source.obj",
            "targetPath": "target.obj",
            "sourceLogicalId": "synthetic-source",
            "targetLogicalId": "synthetic-target",
        }
        receipt = child_entry._execute_validated_replay(worker, request)
        self.assertEqual(receipt, _synthetic_receipt())
        self.assertEqual(len(calls), 1)

        invalid = _synthetic_receipt()
        invalid["repeatedReplayValidation"][
            "canonicalUnvalidatedReceiptSha256"
        ] = "0" * 64
        worker.replay_grand_hall_authority_none_icp_twice = (
            lambda *args, **kwargs: invalid
        )
        with self.assertRaisesRegex(
            child_entry.ChildEntryError,
            "not bound to the emitted receipt",
        ):
            child_entry._execute_validated_replay(worker, request)


if __name__ == "__main__":
    unittest.main()
