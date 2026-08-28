"""Two-separate-process proof for the Grand Hall authority-none ICP replay.

This runner launches the reviewed child entry twice, sequentially, through the
same interpreter.  Each child receives source locations only on standard input
and emits one canonical worker receipt.  The runner fails closed unless:

* the reviewed source and target bytes match exact size/SHA-256 bindings before
  either child is launched and remain unchanged through both launches;
* both children attest distinct process IDs and this runner as their parent;
* the child, worker, and runner implementation bytes stay stable;
* each child emits the result of two exact same-process worker replays;
* both canonical worker receipts are byte-identical and match the reviewed
  receipt SHA-256; and
* the worker receipt retains its authority-none, path-free, no-write boundary.

The persisted proof omits machine and process identifiers.  It establishes
only equality under the reported worker versions and explicit child-launch
controls; it does not verify the effective interpreter binary, installed
dependency trees, loaded native closure, operating system, or CPU identity.
It is not registration acceptance or architectural evidence.  No source or
proof file is written.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
from typing import Mapping


WORKER_FILE_NAME = "grand_hall_authority_none_icp_replay.py"
CHILD_ENTRY_FILE_NAME = "grand_hall_authority_none_icp_child_entry.py"
CHILD_REQUEST_SCHEMA_VERSION = (
    "venviewer.grand-hall.authority-none-icp-child-request.v1"
)
CHILD_STATUS_SCHEMA_VERSION = (
    "venviewer.grand-hall.authority-none-icp-child-status.v1"
)
RUNNER_REQUEST_SCHEMA_VERSION = (
    "venviewer.grand-hall.authority-none-icp-two-process-request.v1"
)
PROOF_SCHEMA_VERSION = (
    "venviewer.grand-hall.authority-none-icp-two-process-proof.v1"
)
SYNTHETIC_PROOF_SCHEMA_VERSION = (
    "venviewer.grand-hall.authority-none-icp-two-process-proof.synthetic-test.v1"
)
WORKER_SCHEMA_VERSION = "venviewer.grand-hall.authority-none-icp-replay.v1"
SEED_ADAPTER_SCHEMA_VERSION = (
    "venviewer.grand-hall.authority-none-icp-seed-adapter.v1"
)
REVIEWED_WORKER_SHA256 = (
    "7f2cce27db8e9b5edc9892ac19a705813665fbbe69235f2523b826baf8b530c6"
)
REVIEWED_CHILD_ENTRY_SHA256 = (
    "8711080f64af76ea111185f0e07adf6faafafdb988f7049c9dbec210e4c5768a"
)
REVIEWED_CANONICAL_WORKER_RECEIPT_SHA256 = (
    "83d9bd9564f3c5212b27260b11d0527ab496f3d1404cc05edd39013e2d3d9332"
)
REVIEWED_SOURCE_BYTE_LENGTH = 2_222_742
REVIEWED_SOURCE_SHA256 = (
    "ba5aa3d2c244acca3937505a17b34fb7f437ef5f59b7a85e7e691a2b2bcd47b6"
)
REVIEWED_TARGET_BYTE_LENGTH = 38_381_816
REVIEWED_TARGET_SHA256 = (
    "cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7"
)
DEFAULT_SOURCE_LOGICAL_ID = "xgrids-grand-hall-big-obj"
DEFAULT_TARGET_LOGICAL_ID = "matterpak-grand-hall-room9-obj"
DEFAULT_CHILD_TIMEOUT_SECONDS = 60 * 60
MAX_CLI_REQUEST_BYTES = 64 * 1024
MAX_CHILD_OUTPUT_BYTES = 16 * 1024 * 1024
POST_TERMINATION_WAIT_SECONDS = 5
REPEATED_REPLAY_SCOPE = (
    "exact-full-receipt-including-correspondence-and-matrix-bytes"
)
CHILD_PYTHON_FLAGS = ("-I", "-B")
THREAD_ENVIRONMENT_CONTROLS = {
    "MKL_NUM_THREADS": "1",
    "NUMEXPR_NUM_THREADS": "1",
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
}
PRESERVED_CHILD_ENVIRONMENT_KEYS = {
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "WINDIR",
}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
LOGICAL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
ABSOLUTE_PATH_RE = re.compile(r"^(?:[A-Za-z]:[\\/]|\\\\|/)")
ISO_TIMESTAMP_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$"
)
FORBIDDEN_LOCATION_OR_TIME_KEYS = {
    "absolutepath",
    "birthtime",
    "capturedat",
    "completedat",
    "createdat",
    "ctime",
    "datetime",
    "date",
    "epoch",
    "finishedat",
    "filepath",
    "hostname",
    "computername",
    "machinename",
    "mtime",
    "rundate",
    "sourcepath",
    "startedat",
    "targetpath",
    "time",
    "timestamp",
    "updatedat",
}
FORBIDDEN_LOCATION_OR_TIME_KEY_SUFFIXES = (
    "absolutepath",
    "birthtime",
    "capturedat",
    "completedat",
    "createdat",
    "datetime",
    "filepath",
    "finishedat",
    "hostname",
    "machinename",
    "mtimens",
    "path",
    "rundate",
    "startedat",
    "timestamp",
    "updatedat",
)
FORBIDDEN_RAW_PROCESS_IDENTIFIER_KEYS = {
    "launcherprocessid",
    "parentprocessid",
    "pid",
    "ppid",
    "processid",
    "reportedparentprocessid",
    "runnerprocessid",
    "workerprocessid",
}


class TwoProcessProofError(RuntimeError):
    """Raised when two-process replay evidence fails a closed guard."""


@dataclass(frozen=True)
class _FileBinding:
    payload: bytes
    sha256: str


@dataclass(frozen=True)
class _ChildResult:
    launcher_process_id: int
    worker_process_id: int
    reported_parent_process_id: int
    launch_process_model: str
    receipt_bytes: bytes
    receipt: dict[str, object]
    seed_adapter_sha256: str
    worker_runtime: dict[str, object]
    repeated_replay_validation: dict[str, object]


@dataclass(frozen=True)
class _ExecutionPaths:
    runner: Path
    worker: Path
    entry: Path
    interpreter: Path


@dataclass(frozen=True)
class _ImplementationBindings:
    runner: _FileBinding
    worker: _FileBinding
    entry: _FileBinding


@dataclass(frozen=True)
class _ReviewedInputBindings:
    source_path: Path
    target_path: Path
    source: _FileBinding
    target: _FileBinding


@dataclass(frozen=True)
class _ProofProfile:
    schema_version: str
    authority_classification: str
    authority_claim: str
    determinism_classification: str
    synthetic_test_only: bool


PRODUCTION_PROOF_PROFILE = _ProofProfile(
    schema_version=PROOF_SCHEMA_VERSION,
    authority_classification="none",
    authority_claim="two-separate-os-process-diagnostic-repeatability-proof-only",
    determinism_classification=(
        "reported-worker-versions-and-explicit-child-launch-controls-only"
    ),
    synthetic_test_only=False,
)
SYNTHETIC_PROOF_PROFILE = _ProofProfile(
    schema_version=SYNTHETIC_PROOF_SCHEMA_VERSION,
    authority_classification="synthetic-test-only",
    authority_claim="synthetic-process-supervision-test-only",
    determinism_classification="synthetic-process-supervision-test-only",
    synthetic_test_only=True,
)


def canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise TwoProcessProofError("duplicate JSON keys are forbidden")
        result[key] = value
    return result


def _reject_non_finite(value: str) -> object:
    raise TwoProcessProofError(f"non-finite JSON number {value!r} is forbidden")


def _strict_canonical_json_object(payload: bytes, label: str) -> dict[str, object]:
    try:
        decoded = payload.decode("utf-8")
        value = json.loads(
            decoded,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_non_finite,
        )
    except TwoProcessProofError:
        raise
    except (UnicodeError, json.JSONDecodeError) as error:
        raise TwoProcessProofError(f"{label} is not strict UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise TwoProcessProofError(f"{label} root must be a JSON object")
    if canonical_json_bytes(value) != payload:
        raise TwoProcessProofError(f"{label} bytes are not canonical JSON")
    return value


def _file_identity(value: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        value.st_dev,
        value.st_ino,
        stat.S_IFMT(value.st_mode),
        value.st_size,
        value.st_mtime_ns,
    )


def _stable_regular_file_snapshot(path: Path, label: str) -> _FileBinding:
    try:
        before = path.lstat()
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        attributes = getattr(before, "st_file_attributes", 0)
        if stat.S_ISLNK(before.st_mode) or (
            reparse_flag and attributes & reparse_flag
        ):
            raise TwoProcessProofError(
                f"{label} must not be a link or reparse point"
            )
        if not stat.S_ISREG(before.st_mode):
            raise TwoProcessProofError(f"{label} must be a regular file")
        with path.open("rb") as stream:
            opened = os.fstat(stream.fileno())
            payload = stream.read()
            after_open = os.fstat(stream.fileno())
        after = path.lstat()
    except TwoProcessProofError:
        raise
    except OSError as error:
        raise TwoProcessProofError(f"{label} could not be read stably") from error
    identities = {
        _file_identity(before),
        _file_identity(opened),
        _file_identity(after_open),
        _file_identity(after),
    }
    if len(identities) != 1 or len(payload) != opened.st_size:
        raise TwoProcessProofError(f"{label} changed while it was being read")
    return _FileBinding(payload=payload, sha256=hashlib.sha256(payload).hexdigest())


def _reviewed_input_snapshot(
    path: Path,
    *,
    expected_byte_length: int,
    expected_sha256: str,
    label: str,
) -> _FileBinding:
    try:
        before = path.lstat()
    except OSError as error:
        raise TwoProcessProofError(f"{label} could not be inspected") from error
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    attributes = getattr(before, "st_file_attributes", 0)
    if stat.S_ISLNK(before.st_mode) or (
        reparse_flag and attributes & reparse_flag
    ):
        raise TwoProcessProofError(f"{label} must not be a link or reparse point")
    if not stat.S_ISREG(before.st_mode):
        raise TwoProcessProofError(f"{label} must be a regular file")
    if before.st_size != expected_byte_length:
        raise TwoProcessProofError(
            f"{label} byte length differs from the reviewed input binding"
        )
    binding = _stable_regular_file_snapshot(path, label)
    if len(binding.payload) != expected_byte_length:
        raise TwoProcessProofError(
            f"{label} byte length changed during reviewed-input validation"
        )
    if binding.sha256 != expected_sha256:
        raise TwoProcessProofError(
            f"{label} SHA-256 differs from the reviewed input binding"
        )
    return binding


def _prevalidate_production_inputs(
    source_path: str | Path,
    target_path: str | Path,
) -> _ReviewedInputBindings:
    source = Path(source_path)
    target = Path(target_path)
    return _ReviewedInputBindings(
        source_path=source,
        target_path=target,
        source=_reviewed_input_snapshot(
            source,
            expected_byte_length=REVIEWED_SOURCE_BYTE_LENGTH,
            expected_sha256=REVIEWED_SOURCE_SHA256,
            label="reviewed source input",
        ),
        target=_reviewed_input_snapshot(
            target,
            expected_byte_length=REVIEWED_TARGET_BYTE_LENGTH,
            expected_sha256=REVIEWED_TARGET_SHA256,
            label="reviewed target input",
        ),
    )


def _require_mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise TwoProcessProofError(f"{label} must be a JSON object")
    return value


def _require_exact_keys(
    value: Mapping[str, object], expected: set[str], label: str
) -> None:
    if set(value) != expected:
        raise TwoProcessProofError(f"{label} keys differ from the closed schema")


def _require_positive_int(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise TwoProcessProofError(f"{label} must be a positive integer")
    return value


def _require_sha256(value: object, label: str) -> str:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        raise TwoProcessProofError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _require_non_empty_string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise TwoProcessProofError(f"{label} must be a non-empty NUL-free string")
    return value


def _require_logical_id(value: str, label: str) -> str:
    if LOGICAL_ID_RE.fullmatch(value) is None:
        raise TwoProcessProofError(f"{label} must remain path-free")
    return value


def _normalise_key(value: str) -> str:
    return "".join(character for character in value.lower() if character.isalnum())


def _key_discloses_location_host_or_time(value: str) -> bool:
    normalised = _normalise_key(value)
    return normalised in FORBIDDEN_LOCATION_OR_TIME_KEYS or normalised.endswith(
        FORBIDDEN_LOCATION_OR_TIME_KEY_SUFFIXES
    )


def _assert_path_timestamp_and_host_free(value: object, label: str) -> None:
    if isinstance(value, dict):
        for key, member in value.items():
            if _key_discloses_location_host_or_time(key):
                raise TwoProcessProofError(
                    f"{label} contains forbidden location, host, or time field"
                )
            _assert_path_timestamp_and_host_free(member, f"{label}.{key}")
        return
    if isinstance(value, list):
        for index, member in enumerate(value):
            _assert_path_timestamp_and_host_free(member, f"{label}[{index}]")
        return
    if isinstance(value, str) and (
        ABSOLUTE_PATH_RE.match(value) is not None
        or ISO_TIMESTAMP_RE.match(value) is not None
    ):
        raise TwoProcessProofError(
            f"{label} contains an absolute location or timestamp string"
        )


def _assert_raw_process_identifiers_absent(value: object, label: str) -> None:
    if isinstance(value, dict):
        for key, member in value.items():
            if _normalise_key(key) in FORBIDDEN_RAW_PROCESS_IDENTIFIER_KEYS:
                raise TwoProcessProofError(
                    f"{label} contains a forbidden raw process identifier"
                )
            _assert_raw_process_identifiers_absent(member, f"{label}.{key}")
        return
    if isinstance(value, list):
        for index, member in enumerate(value):
            _assert_raw_process_identifiers_absent(member, f"{label}[{index}]")


def _validate_worker_authority_boundary(receipt: Mapping[str, object]) -> None:
    if receipt.get("schemaVersion") != WORKER_SCHEMA_VERSION:
        raise TwoProcessProofError("worker receipt schema version drifted")
    authority = _require_mapping(receipt.get("authority"), "worker authority")
    guardrails = _require_mapping(receipt.get("guardrails"), "worker guardrails")
    runtime = _require_mapping(receipt.get("runtime"), "worker runtime")
    algorithm = _require_mapping(receipt.get("algorithm"), "worker algorithm")
    nearest = _require_mapping(
        algorithm.get("nearestNeighbour"), "worker nearest-neighbour policy"
    )
    required_false = ("acceptedTransform", "architecturalEvidence")
    if authority.get("classification") != "none":
        raise TwoProcessProofError("worker authority must remain none")
    if any(authority.get(field) is not False for field in required_false):
        raise TwoProcessProofError("worker receipt makes a forbidden authority claim")
    for field in ("pathsIncludedInReceipt", "timestampsIncludedInReceipt", "writesFiles"):
        if guardrails.get(field) is not False:
            raise TwoProcessProofError(f"worker guardrail {field} must remain false")
    for field in ("doesNotInferArchitecture", "doesNotClaimRegistrationAcceptance"):
        if guardrails.get(field) is not True:
            raise TwoProcessProofError(f"worker guardrail {field} must remain true")
    if guardrails.get("exactSameProcessRepeatedReceiptRequired") is not True:
        raise TwoProcessProofError(
            "worker receipt lost its same-process repeated-replay requirement"
        )
    if runtime.get("bitExactComparisonRequiresSamePinnedNumericalRuntime") is not True:
        raise TwoProcessProofError("worker receipt lost its pinned-runtime boundary")
    if nearest.get("determinismClassification") != "same-runtime-same-host-only":
        raise TwoProcessProofError("worker determinism boundary drifted")
    _assert_path_timestamp_and_host_free(dict(receipt), "worker receipt")


def _worker_runtime_projection(
    receipt: Mapping[str, object],
) -> dict[str, object]:
    runtime = _require_mapping(receipt.get("runtime"), "worker runtime")
    _require_exact_keys(
        runtime,
        {
            "pythonVersion",
            "numpyVersion",
            "scipyVersion",
            "trimeshVersion",
            "bitExactComparisonRequiresSamePinnedNumericalRuntime",
        },
        "worker runtime",
    )
    projection: dict[str, object] = {
        "pythonVersion": _require_non_empty_string(
            runtime.get("pythonVersion"), "worker Python version"
        ),
        "numpyVersion": _require_non_empty_string(
            runtime.get("numpyVersion"), "worker NumPy version"
        ),
        "scipyVersion": _require_non_empty_string(
            runtime.get("scipyVersion"), "worker SciPy version"
        ),
        "trimeshVersion": _require_non_empty_string(
            runtime.get("trimeshVersion"), "worker trimesh version"
        ),
        "bitExactComparisonRequiresSamePinnedNumericalRuntime": True,
    }
    if runtime.get("bitExactComparisonRequiresSamePinnedNumericalRuntime") is not True:
        raise TwoProcessProofError("worker runtime projection lost its exact boundary")
    _assert_path_timestamp_and_host_free(projection, "worker runtime projection")
    return projection


def _seed_adapter_sha256(receipt: Mapping[str, object]) -> str:
    adapter = _require_mapping(receipt.get("seedAdapterV1"), "seed adapter v1")
    if adapter.get("schemaVersion") != SEED_ADAPTER_SCHEMA_VERSION:
        raise TwoProcessProofError("seed adapter schema version drifted")
    if adapter.get("workerSchemaVersion") != WORKER_SCHEMA_VERSION:
        raise TwoProcessProofError("seed adapter worker schema binding drifted")
    if adapter.get("authority") != "none":
        raise TwoProcessProofError("seed adapter authority must remain none")
    if adapter.get("architecturalEvidence") is not False:
        raise TwoProcessProofError("seed adapter makes an architectural claim")
    if adapter.get("humanReviewRequiredBeforeAnyPromotion") is not True:
        raise TwoProcessProofError("seed adapter lost its human-review boundary")
    _assert_path_timestamp_and_host_free(dict(adapter), "seed adapter v1")
    return hashlib.sha256(canonical_json_bytes(dict(adapter))).hexdigest()


def _repeated_replay_projection(
    receipt: Mapping[str, object],
) -> dict[str, object]:
    validation = _require_mapping(
        receipt.get("repeatedReplayValidation"),
        "same-process repeated replay validation",
    )
    _require_exact_keys(
        validation,
        {
            "sameProcessRunCount",
            "canonicalReceiptBytesIdentical",
            "canonicalUnvalidatedReceiptSha256",
            "scope",
        },
        "same-process repeated replay validation",
    )
    if validation.get("sameProcessRunCount") != 2:
        raise TwoProcessProofError("worker did not run exactly twice in each child")
    if validation.get("canonicalReceiptBytesIdentical") is not True:
        raise TwoProcessProofError("same-process canonical worker receipts differed")
    if validation.get("scope") != REPEATED_REPLAY_SCOPE:
        raise TwoProcessProofError("same-process repeated replay scope drifted")
    unvalidated_sha256 = _require_sha256(
        validation.get("canonicalUnvalidatedReceiptSha256"),
        "canonical unvalidated worker receipt SHA-256",
    )
    unvalidated_receipt = dict(receipt)
    del unvalidated_receipt["repeatedReplayValidation"]
    actual_unvalidated_sha256 = hashlib.sha256(
        canonical_json_bytes(unvalidated_receipt)
    ).hexdigest()
    if actual_unvalidated_sha256 != unvalidated_sha256:
        raise TwoProcessProofError(
            "same-process repeat validation is not bound to the worker receipt"
        )
    return {
        "requiredForEachChild": True,
        "sameProcessRunCountPerChild": 2,
        "canonicalUnvalidatedReceiptBytesIdenticalWithinEachChild": True,
        "canonicalUnvalidatedReceiptSha256": unvalidated_sha256,
        "scope": REPEATED_REPLAY_SCOPE,
    }


def _child_request(
    source_path: str | Path,
    target_path: str | Path,
    source_logical_id: str,
    target_logical_id: str,
    worker_sha256: str,
    entry_sha256: str,
) -> bytes:
    return canonical_json_bytes(
        {
            "schemaVersion": CHILD_REQUEST_SCHEMA_VERSION,
            "sourcePath": os.fspath(source_path),
            "targetPath": os.fspath(target_path),
            "sourceLogicalId": source_logical_id,
            "targetLogicalId": target_logical_id,
            "expectedWorkerSha256": worker_sha256,
            "expectedEntrySha256": entry_sha256,
        }
    )


def _validate_child_status(
    status: Mapping[str, object],
    launcher_process_id: int,
    runner_process_id: int,
    worker_sha256: str,
    entry_sha256: str,
    receipt_sha256: str,
) -> tuple[int, int, str]:
    _require_exact_keys(
        status,
        {
            "schemaVersion",
            "childProcessId",
            "reportedParentProcessId",
            "workerImplementationSha256",
            "childEntryImplementationSha256",
            "canonicalWorkerReceiptSha256",
        },
        "child status",
    )
    if status.get("schemaVersion") != CHILD_STATUS_SCHEMA_VERSION:
        raise TwoProcessProofError("child status schema version drifted")
    worker_id = _require_positive_int(status.get("childProcessId"), "worker process ID")
    reported_parent = _require_positive_int(
        status.get("reportedParentProcessId"), "reported parent process ID"
    )
    direct_process = (
        worker_id == launcher_process_id
        and reported_parent == runner_process_id
    )
    redirected_process = (
        worker_id != launcher_process_id
        and reported_parent == launcher_process_id
    )
    if not direct_process and not redirected_process:
        raise TwoProcessProofError("child process identity evidence did not match the launcher")
    expected_bindings = {
        "workerImplementationSha256": worker_sha256,
        "childEntryImplementationSha256": entry_sha256,
        "canonicalWorkerReceiptSha256": receipt_sha256,
    }
    for field, expected in expected_bindings.items():
        if status.get(field) != expected:
            raise TwoProcessProofError(f"child status binding {field} drifted")
    process_model = (
        "direct-python-child"
        if direct_process
        else "python-launcher-redirected-worker-child"
    )
    return worker_id, reported_parent, process_model


def _child_environment(
    parent_environment: Mapping[str, str] | None = None,
) -> dict[str, str]:
    source = os.environ if parent_environment is None else parent_environment
    environment = {
        key: value
        for key, value in source.items()
        if key.upper() in PRESERVED_CHILD_ENVIRONMENT_KEYS
    }
    environment.update(THREAD_ENVIRONMENT_CONTROLS)
    return environment


def _windows_kill_on_close_limits() -> tuple[object, int]:
    import ctypes
    from ctypes import wintypes

    class _IoCounters(ctypes.Structure):
        _fields_ = [
            ("readOperationCount", ctypes.c_ulonglong),
            ("writeOperationCount", ctypes.c_ulonglong),
            ("otherOperationCount", ctypes.c_ulonglong),
            ("readTransferCount", ctypes.c_ulonglong),
            ("writeTransferCount", ctypes.c_ulonglong),
            ("otherTransferCount", ctypes.c_ulonglong),
        ]

    class _BasicLimitInformation(ctypes.Structure):
        _fields_ = [
            ("perProcessUserTimeLimit", ctypes.c_longlong),
            ("perJobUserTimeLimit", ctypes.c_longlong),
            ("limitFlags", wintypes.DWORD),
            ("minimumWorkingSetSize", ctypes.c_size_t),
            ("maximumWorkingSetSize", ctypes.c_size_t),
            ("activeProcessLimit", wintypes.DWORD),
            ("affinity", ctypes.c_size_t),
            ("priorityClass", wintypes.DWORD),
            ("schedulingClass", wintypes.DWORD),
        ]

    class _ExtendedLimitInformation(ctypes.Structure):
        _fields_ = [
            ("basicLimitInformation", _BasicLimitInformation),
            ("ioInfo", _IoCounters),
            ("processMemoryLimit", ctypes.c_size_t),
            ("jobMemoryLimit", ctypes.c_size_t),
            ("peakProcessMemoryUsed", ctypes.c_size_t),
            ("peakJobMemoryUsed", ctypes.c_size_t),
        ]

    limits = _ExtendedLimitInformation()
    limits.basicLimitInformation.limitFlags = 0x00002000
    return limits, ctypes.sizeof(limits)


def _configure_windows_kill_on_close_job(job_handle: int) -> None:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.SetInformationJobObject.argtypes = (
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    )
    kernel32.SetInformationJobObject.restype = wintypes.BOOL
    limits, limits_size = _windows_kill_on_close_limits()
    if not kernel32.SetInformationJobObject(
        wintypes.HANDLE(job_handle),
        9,
        ctypes.byref(limits),
        limits_size,
    ):
        raise ctypes.WinError(ctypes.get_last_error())


def _assign_process_to_windows_job(job_handle: int, process_id: int) -> None:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
    kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL

    process_handle = kernel32.OpenProcess(0x00000101, False, process_id)
    if not process_handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if not kernel32.AssignProcessToJobObject(
            wintypes.HANDLE(job_handle), process_handle
        ):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        kernel32.CloseHandle(process_handle)


def _create_windows_kill_on_close_job(process_id: int) -> int:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL

    job_handle = kernel32.CreateJobObjectW(None, None)
    if not job_handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        numeric_handle = int(job_handle)
        _configure_windows_kill_on_close_job(numeric_handle)
        _assign_process_to_windows_job(numeric_handle, process_id)
    except Exception:
        kernel32.CloseHandle(job_handle)
        raise
    return numeric_handle


def _terminate_windows_job(job_handle: int) -> None:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.TerminateJobObject.argtypes = (wintypes.HANDLE, wintypes.UINT)
    kernel32.TerminateJobObject.restype = wintypes.BOOL
    kernel32.TerminateJobObject(wintypes.HANDLE(job_handle), 1)


def _close_windows_handle(handle: int) -> None:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.CloseHandle(wintypes.HANDLE(handle))


def _taskkill_windows_tree(process_id: int) -> None:
    system_root = os.environ.get("SystemRoot") or os.environ.get("WINDIR")
    if not system_root:
        return
    taskkill = Path(system_root) / "System32" / "taskkill.exe"
    if not taskkill.is_file():
        return
    try:
        subprocess.run(
            [os.fspath(taskkill), "/PID", str(process_id), "/T", "/F"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            shell=False,
            timeout=POST_TERMINATION_WAIT_SECONDS,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired):
        return


class _ChildProcessSupervisor:
    def __init__(self, process: subprocess.Popen[bytes]) -> None:
        self._process = process
        self._windows_job_handle: int | None = None
        if os.name == "nt":
            try:
                self._windows_job_handle = _create_windows_kill_on_close_job(
                    process.pid
                )
            except Exception as error:
                _taskkill_windows_tree(process.pid)
                if process.poll() is None:
                    process.kill()
                try:
                    process.wait(timeout=POST_TERMINATION_WAIT_SECONDS)
                except subprocess.TimeoutExpired:
                    pass
                raise TwoProcessProofError(
                    "child process could not be attached to a kill-on-close job"
                ) from error

    def terminate_tree(self) -> None:
        if os.name == "nt":
            # Snapshot and terminate the live descendant chain before ending
            # the launcher.  A venv redirector can spawn its worker before the
            # launcher is attached to the Job Object; killing the job first
            # would orphan that already-created descendant.
            _taskkill_windows_tree(self._process.pid)
            if self._windows_job_handle is not None:
                _terminate_windows_job(self._windows_job_handle)
        else:
            try:
                os.killpg(self._process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if self._process.poll() is None:
            try:
                self._process.kill()
            except ProcessLookupError:
                pass

    def close(self) -> None:
        if self._windows_job_handle is not None:
            _close_windows_handle(self._windows_job_handle)
            self._windows_job_handle = None


def _close_child_pipes(process: subprocess.Popen[bytes]) -> None:
    for stream in (process.stdin, process.stdout, process.stderr):
        if stream is not None:
            try:
                stream.close()
            except OSError:
                pass


def _launch_child(
    launch_ordinal: int,
    python_executable: Path,
    entry_path: Path,
    request_bytes: bytes,
    parent_process_id: int,
    worker_sha256: str,
    entry_sha256: str,
    timeout_seconds: int,
) -> _ChildResult:
    command = [
        os.fspath(python_executable),
        *CHILD_PYTHON_FLAGS,
        os.fspath(entry_path),
    ]
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        shell=False,
        close_fds=True,
        env=_child_environment(),
        start_new_session=os.name != "nt",
        creationflags=(
            getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            if os.name == "nt"
            else 0
        ),
    )
    supervisor = _ChildProcessSupervisor(process)
    try:
        stdout, stderr = _communicate_child(
            process,
            supervisor,
            request_bytes,
            launch_ordinal,
            timeout_seconds,
        )
    finally:
        supervisor.close()
    return _parse_child_result(
        process,
        stdout,
        stderr,
        parent_process_id,
        worker_sha256,
        entry_sha256,
    )


def _communicate_child(
    process: subprocess.Popen[bytes],
    supervisor: _ChildProcessSupervisor,
    request_bytes: bytes,
    launch_ordinal: int,
    timeout_seconds: int,
) -> tuple[bytes, bytes]:
    try:
        stdout, stderr = process.communicate(
            input=request_bytes, timeout=timeout_seconds
        )
    except subprocess.TimeoutExpired as error:
        supervisor.terminate_tree()
        try:
            process.communicate(timeout=POST_TERMINATION_WAIT_SECONDS)
        except subprocess.TimeoutExpired:
            supervisor.terminate_tree()
            _close_child_pipes(process)
            try:
                process.wait(timeout=POST_TERMINATION_WAIT_SECONDS)
            except subprocess.TimeoutExpired:
                pass
        raise TwoProcessProofError(
            f"child launch {launch_ordinal} exceeded the closed timeout"
        ) from error
    if process.returncode != 0:
        raise TwoProcessProofError(
            f"child launch {launch_ordinal} stopped without replay evidence"
        )
    if len(stdout) > MAX_CHILD_OUTPUT_BYTES or len(stderr) > MAX_CHILD_OUTPUT_BYTES:
        raise TwoProcessProofError(
            f"child launch {launch_ordinal} exceeded the evidence size limit"
        )
    return stdout, stderr


def _parse_child_result(
    process: subprocess.Popen[bytes],
    stdout: bytes,
    stderr: bytes,
    parent_process_id: int,
    worker_sha256: str,
    entry_sha256: str,
) -> _ChildResult:
    receipt = _strict_canonical_json_object(stdout, "canonical worker receipt")
    status = _strict_canonical_json_object(stderr, "canonical child status")
    _validate_worker_authority_boundary(receipt)
    seed_adapter_sha256 = _seed_adapter_sha256(receipt)
    worker_runtime = _worker_runtime_projection(receipt)
    repeated_replay_validation = _repeated_replay_projection(receipt)
    receipt_sha256 = hashlib.sha256(stdout).hexdigest()
    worker_process_id, reported_parent, process_model = _validate_child_status(
        status,
        process.pid,
        parent_process_id,
        worker_sha256,
        entry_sha256,
        receipt_sha256,
    )
    return _ChildResult(
        launcher_process_id=process.pid,
        worker_process_id=worker_process_id,
        reported_parent_process_id=reported_parent,
        launch_process_model=process_model,
        receipt_bytes=stdout,
        receipt=receipt,
        seed_adapter_sha256=seed_adapter_sha256,
        worker_runtime=worker_runtime,
        repeated_replay_validation=repeated_replay_validation,
    )


def _reverify_binding(path: Path, before: _FileBinding, label: str) -> None:
    after = _stable_regular_file_snapshot(path, label)
    if after.sha256 != before.sha256 or after.payload != before.payload:
        raise TwoProcessProofError(f"{label} changed during the parent run")


def _authority_boundary(profile: _ProofProfile) -> dict[str, object]:
    return {
        "classification": profile.authority_classification,
        "acceptedTransform": False,
        "architecturalEvidence": False,
        "registrationAcceptance": False,
        "claim": profile.authority_claim,
        "humanReviewRequiredBeforeAnyPromotion": True,
    }


def _process_evidence(
    children: tuple[_ChildResult, _ChildResult],
) -> dict[str, object]:
    return {
        "childProcessCount": 2,
        "launchProcessModels": [
            child.launch_process_model for child in children
        ],
        "distinctLauncherProcessIdsWithinParentRun": True,
        "distinctChildProcessIdsWithinParentRun": True,
        "launcherWorkerProcessChainsValidated": True,
        "canonicalWorkerReceiptBytesIdentical": True,
    }


def _implementation_bindings(
    bindings: _ImplementationBindings,
) -> dict[str, object]:
    return {
        "workerImplementationSha256": bindings.worker.sha256,
        "childEntryImplementationSha256": bindings.entry.sha256,
        "twoProcessRunnerImplementationSha256": bindings.runner.sha256,
        "bindingsReverifiedAfterBothChildrenExited": True,
    }


def _determinism_boundary(profile: _ProofProfile) -> dict[str, object]:
    return {
        "classification": profile.determinism_classification,
        "twoSeparateOsProcesses": True,
        "crossRuntimeExactReplayClaimed": False,
        "crossHostExactReplayClaimed": False,
        "crossPlatformExactReplayClaimed": False,
        "childPythonFlags": list(CHILD_PYTHON_FLAGS),
        "threadEnvironmentControls": dict(THREAD_ENVIRONMENT_CONTROLS),
        "effectiveInterpreterBinaryVerified": False,
        "reportedWorkerVersionsEqualAcrossChildren": True,
        "explicitChildLaunchControlsApplied": True,
        "environmentLockDocumentApplied": False,
        "installedDependencyTreesVerified": False,
        "loadedNativeClosureVerified": False,
        "operatingSystemOrCpuIdentityVerified": False,
    }


def _proof_guardrails(profile: _ProofProfile) -> dict[str, object]:
    guardrails: dict[str, object] = {
        "sourceLocationsPassedOnlyThroughChildStandardInput": True,
        "sourceLocationsIncludedInProof": False,
        "implementationLocationsIncludedInProof": False,
        "timestampsIncludedInProof": False,
        "machineIdentifiersIncludedInProof": False,
        "processIdentifiersIncludedInProof": False,
        "writesSourceFiles": False,
        "writesProofFiles": False,
        "reviewedInputBytesValidatedBeforeChildLaunch": (
            not profile.synthetic_test_only
        ),
        "canonicalWorkerReceiptOmittedFromProof": True,
        "completeWorkerEvidenceBoundByCanonicalReceiptSha256": True,
        "doesNotInferArchitecture": True,
        "doesNotClaimRegistrationAcceptance": True,
    }
    if profile.synthetic_test_only:
        guardrails["syntheticTestOnly"] = True
    return guardrails


def _reviewed_input_bindings_proof(
    bindings: _ReviewedInputBindings,
) -> dict[str, object]:
    return {
        "source": {
            "byteLength": len(bindings.source.payload),
            "sha256": bindings.source.sha256,
        },
        "target": {
            "byteLength": len(bindings.target.payload),
            "sha256": bindings.target.sha256,
        },
        "bindingsReverifiedAfterBothChildrenExited": True,
    }


def _build_proof(
    children: tuple[_ChildResult, _ChildResult],
    bindings: _ImplementationBindings,
    reviewed_input_bindings: _ReviewedInputBindings | None,
    profile: _ProofProfile,
) -> dict[str, object]:
    receipt_sha256 = hashlib.sha256(children[0].receipt_bytes).hexdigest()
    proof: dict[str, object] = {
        "schemaVersion": profile.schema_version,
        "authority": _authority_boundary(profile),
        "canonicalWorkerReceiptSha256": receipt_sha256,
        "canonicalWorkerReceiptByteLength": len(children[0].receipt_bytes),
        "workerReceiptSchemaVersion": children[0].receipt["schemaVersion"],
        "canonicalWorkerReceiptIncluded": False,
        "seedAdapterV1CanonicalJsonSha256": children[0].seed_adapter_sha256,
        "workerRuntime": children[0].worker_runtime,
        "sameProcessRepeatedReplayValidation": children[
            0
        ].repeated_replay_validation,
        "processEvidence": _process_evidence(children),
        "implementationBindings": _implementation_bindings(bindings),
        "determinismBoundary": _determinism_boundary(profile),
        "guardrails": _proof_guardrails(profile),
    }
    if reviewed_input_bindings is not None:
        proof["reviewedInputBindings"] = _reviewed_input_bindings_proof(
            reviewed_input_bindings
        )
    return proof


def _resolve_execution_paths(
    python_executable: str | Path,
    worker_path: str | Path,
    child_entry_path: str | Path,
) -> _ExecutionPaths:
    runner = Path(__file__).resolve(strict=True)
    worker = Path(worker_path).resolve(strict=True)
    entry = Path(child_entry_path).resolve(strict=True)
    interpreter = Path(python_executable).resolve(strict=True)
    if worker.parent != entry.parent:
        raise TwoProcessProofError("worker and child entry must be sibling files")
    return _ExecutionPaths(
        runner=runner,
        worker=worker,
        entry=entry,
        interpreter=interpreter,
    )


def _production_execution_paths() -> _ExecutionPaths:
    script_root = Path(__file__).resolve(strict=True).parent
    return _resolve_execution_paths(
        sys.executable,
        script_root / WORKER_FILE_NAME,
        script_root / CHILD_ENTRY_FILE_NAME,
    )


def _snapshot_implementation_bindings(
    paths: _ExecutionPaths,
    expected_worker_sha256: str,
    expected_entry_sha256: str | None,
) -> _ImplementationBindings:
    bindings = _ImplementationBindings(
        runner=_stable_regular_file_snapshot(paths.runner, "two-process runner"),
        worker=_stable_regular_file_snapshot(paths.worker, "reviewed worker"),
        entry=_stable_regular_file_snapshot(paths.entry, "child entry"),
    )
    _stable_regular_file_snapshot(paths.interpreter, "Python interpreter")
    if bindings.worker.sha256 != expected_worker_sha256:
        raise TwoProcessProofError("worker bytes differ from the expected reviewed digest")
    if (
        expected_entry_sha256 is not None
        and bindings.entry.sha256 != expected_entry_sha256
    ):
        raise TwoProcessProofError(
            "child entry bytes differ from the expected reviewed digest"
        )
    return bindings


def _launch_child_pair(
    paths: _ExecutionPaths,
    bindings: _ImplementationBindings,
    request_bytes: bytes,
    parent_process_id: int,
    timeout_seconds: int,
) -> tuple[_ChildResult, _ChildResult]:
    shared_arguments = (
        paths.interpreter,
        paths.entry,
        request_bytes,
        parent_process_id,
        bindings.worker.sha256,
        bindings.entry.sha256,
        timeout_seconds,
    )
    first = _launch_child(1, *shared_arguments)
    second = _launch_child(2, *shared_arguments)
    return first, second


def _validate_child_pair(
    children: tuple[_ChildResult, _ChildResult],
    expected_receipt_sha256: str,
    parent_process_id: int,
) -> None:
    first, second = children
    first_process_ids = {
        first.launcher_process_id,
        first.worker_process_id,
    }
    second_process_ids = {
        second.launcher_process_id,
        second.worker_process_id,
    }
    if parent_process_id in first_process_ids | second_process_ids:
        raise TwoProcessProofError(
            "runner process ID was reused by a child process"
        )
    if first_process_ids & second_process_ids:
        raise TwoProcessProofError(
            "a process ID was reused across the separate child launches"
        )
    if first.launcher_process_id == second.launcher_process_id:
        raise TwoProcessProofError("the operating system reused a launcher process ID")
    if first.worker_process_id == second.worker_process_id:
        raise TwoProcessProofError("the operating system reused a child process ID")
    if first.receipt_bytes != second.receipt_bytes:
        raise TwoProcessProofError("separate child canonical worker receipts differed")
    if first.seed_adapter_sha256 != second.seed_adapter_sha256:
        raise TwoProcessProofError("separate child seed-adapter digests differed")
    if first.worker_runtime != second.worker_runtime:
        raise TwoProcessProofError("separate child worker-runtime projections differed")
    if first.repeated_replay_validation != second.repeated_replay_validation:
        raise TwoProcessProofError(
            "separate child same-process replay validations differed"
        )
    actual_receipt_sha256 = hashlib.sha256(first.receipt_bytes).hexdigest()
    if actual_receipt_sha256 != expected_receipt_sha256:
        raise TwoProcessProofError("canonical worker receipt differs from the expected digest")


def _reverify_implementation_bindings(
    paths: _ExecutionPaths,
    bindings: _ImplementationBindings,
) -> None:
    _reverify_binding(paths.worker, bindings.worker, "reviewed worker")
    _reverify_binding(paths.entry, bindings.entry, "child entry")
    _reverify_binding(paths.runner, bindings.runner, "two-process runner")


def _reverify_reviewed_input_bindings(
    bindings: _ReviewedInputBindings,
) -> None:
    _reverify_binding(
        bindings.source_path,
        bindings.source,
        "reviewed source input",
    )
    _reverify_binding(
        bindings.target_path,
        bindings.target,
        "reviewed target input",
    )


def _run_bound_two_process_replay_proof(
    source_path: str | Path,
    target_path: str | Path,
    *,
    source_logical_id: str,
    target_logical_id: str,
    paths: _ExecutionPaths,
    expected_worker_sha256: str,
    expected_entry_sha256: str | None,
    expected_canonical_worker_receipt_sha256: str,
    child_timeout_seconds: int,
    reviewed_input_bindings: _ReviewedInputBindings | None,
    profile: _ProofProfile,
) -> dict[str, object]:
    source_id = _require_logical_id(source_logical_id, "source_logical_id")
    target_id = _require_logical_id(target_logical_id, "target_logical_id")
    expected_worker = _require_sha256(
        expected_worker_sha256, "expected_worker_sha256"
    )
    expected_receipt = _require_sha256(
        expected_canonical_worker_receipt_sha256,
        "expected_canonical_worker_receipt_sha256",
    )
    if expected_entry_sha256 is not None:
        expected_entry_sha256 = _require_sha256(
            expected_entry_sha256,
            "expected_entry_sha256",
        )
    timeout = _require_positive_int(child_timeout_seconds, "child_timeout_seconds")
    bindings = _snapshot_implementation_bindings(
        paths,
        expected_worker,
        expected_entry_sha256,
    )
    request_bytes = _child_request(
        source_path,
        target_path,
        source_id,
        target_id,
        bindings.worker.sha256,
        bindings.entry.sha256,
    )
    parent_process_id = os.getpid()
    children = _launch_child_pair(
        paths, bindings, request_bytes, parent_process_id, timeout
    )
    _validate_child_pair(children, expected_receipt, parent_process_id)
    _reverify_implementation_bindings(paths, bindings)
    if reviewed_input_bindings is not None:
        _reverify_reviewed_input_bindings(reviewed_input_bindings)
    proof = _build_proof(
        children,
        bindings,
        reviewed_input_bindings,
        profile,
    )
    _assert_path_timestamp_and_host_free(proof, "two-process proof")
    _assert_raw_process_identifiers_absent(proof, "two-process proof")
    canonical_json_bytes(proof)
    return proof


def run_two_process_replay_proof(
    source_path: str | Path,
    target_path: str | Path,
    *,
    source_logical_id: str = DEFAULT_SOURCE_LOGICAL_ID,
    target_logical_id: str = DEFAULT_TARGET_LOGICAL_ID,
    child_timeout_seconds: int = DEFAULT_CHILD_TIMEOUT_SECONDS,
) -> dict[str, object]:
    """Run the non-overridable reviewed production-v1 replay proof path."""

    reviewed_input_bindings = _prevalidate_production_inputs(
        source_path,
        target_path,
    )
    return _run_bound_two_process_replay_proof(
        source_path,
        target_path,
        source_logical_id=source_logical_id,
        target_logical_id=target_logical_id,
        paths=_production_execution_paths(),
        expected_worker_sha256=REVIEWED_WORKER_SHA256,
        expected_entry_sha256=REVIEWED_CHILD_ENTRY_SHA256,
        expected_canonical_worker_receipt_sha256=(
            REVIEWED_CANONICAL_WORKER_RECEIPT_SHA256
        ),
        child_timeout_seconds=child_timeout_seconds,
        reviewed_input_bindings=reviewed_input_bindings,
        profile=PRODUCTION_PROOF_PROFILE,
    )


def _run_synthetic_two_process_replay_proof(
    source_path: str | Path,
    target_path: str | Path,
    *,
    source_logical_id: str,
    target_logical_id: str,
    python_executable: str | Path,
    worker_path: str | Path,
    child_entry_path: str | Path,
    expected_worker_sha256: str,
    expected_canonical_worker_receipt_sha256: str,
    child_timeout_seconds: int,
) -> dict[str, object]:
    """Exercise process supervision without minting production-v1 evidence."""

    return _run_bound_two_process_replay_proof(
        source_path,
        target_path,
        source_logical_id=source_logical_id,
        target_logical_id=target_logical_id,
        paths=_resolve_execution_paths(
            python_executable,
            worker_path,
            child_entry_path,
        ),
        expected_worker_sha256=expected_worker_sha256,
        expected_entry_sha256=None,
        expected_canonical_worker_receipt_sha256=(
            expected_canonical_worker_receipt_sha256
        ),
        child_timeout_seconds=child_timeout_seconds,
        reviewed_input_bindings=None,
        profile=SYNTHETIC_PROOF_PROFILE,
    )


def _read_cli_request() -> dict[str, object]:
    payload = sys.stdin.buffer.read(MAX_CLI_REQUEST_BYTES + 1)
    if not payload or len(payload) > MAX_CLI_REQUEST_BYTES:
        raise TwoProcessProofError("runner request size is invalid")
    request = _strict_canonical_json_object(payload, "runner request")
    _require_exact_keys(
        request,
        {"schemaVersion", "sourcePath", "targetPath", "sourceLogicalId", "targetLogicalId"},
        "runner request",
    )
    if request.get("schemaVersion") != RUNNER_REQUEST_SCHEMA_VERSION:
        raise TwoProcessProofError("runner request schema version drifted")
    return request


def main() -> int:
    try:
        request = _read_cli_request()
        source_path = request.get("sourcePath")
        target_path = request.get("targetPath")
        source_logical_id = request.get("sourceLogicalId")
        target_logical_id = request.get("targetLogicalId")
        if not all(
            isinstance(value, str) and value and "\x00" not in value
            for value in (source_path, target_path, source_logical_id, target_logical_id)
        ):
            raise TwoProcessProofError("runner request string fields are invalid")
        proof = run_two_process_replay_proof(
            source_path,
            target_path,
            source_logical_id=source_logical_id,
            target_logical_id=target_logical_id,
        )
    except Exception as error:
        error_class = type(error).__name__
        sys.stderr.write(
            "Grand Hall authority-none two-process replay stopped safely "
            f"({error_class})."
        )
        return 1
    sys.stdout.buffer.write(canonical_json_bytes(proof))
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "PROOF_SCHEMA_VERSION",
    "REVIEWED_CANONICAL_WORKER_RECEIPT_SHA256",
    "REVIEWED_CHILD_ENTRY_SHA256",
    "REVIEWED_WORKER_SHA256",
    "TwoProcessProofError",
    "canonical_json_bytes",
    "run_two_process_replay_proof",
]
