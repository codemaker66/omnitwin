"""Read-only child entry for one validated Grand Hall authority-none ICP replay.

The entry receives source locations through canonical JSON on standard input so
they never appear in the child command line.  Standard output contains only the
canonical worker receipt.  Standard error contains only a canonical,
path-independent process-attestation object on success.  The reviewed worker is
invoked through its two-run gate, so every emitted receipt contains exact
same-process repeat validation before the parent compares separate processes.

This program does not accept a worker location.  It executes the exact stable
byte snapshot of the reviewed sibling worker and writes no files.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import ModuleType
from typing import Any, Callable, Mapping


WORKER_FILE_NAME = "grand_hall_authority_none_icp_replay.py"
REQUEST_SCHEMA_VERSION = (
    "venviewer.grand-hall.authority-none-icp-child-request.v1"
)
STATUS_SCHEMA_VERSION = (
    "venviewer.grand-hall.authority-none-icp-child-status.v1"
)
MAX_REQUEST_BYTES = 64 * 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
LOGICAL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
REPEATED_REPLAY_SCOPE = (
    "exact-full-receipt-including-correspondence-and-matrix-bytes"
)


class ChildEntryError(RuntimeError):
    """Raised when the child cannot produce trustworthy replay evidence."""


def _canonical_json_bytes(value: object) -> bytes:
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
            raise ChildEntryError("child request contains a duplicate JSON key")
        result[key] = value
    return result


def _reject_non_finite(value: str) -> object:
    raise ChildEntryError(f"child request contains non-finite JSON number {value!r}")


def _strict_json_object(payload: bytes, label: str) -> dict[str, object]:
    try:
        decoded = payload.decode("utf-8")
        value = json.loads(
            decoded,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_non_finite,
        )
    except ChildEntryError:
        raise
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ChildEntryError(f"{label} is not strict UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise ChildEntryError(f"{label} root must be a JSON object")
    if _canonical_json_bytes(value) != payload:
        raise ChildEntryError(f"{label} must use canonical JSON bytes")
    return value


def _file_identity(value: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        value.st_dev,
        value.st_ino,
        stat.S_IFMT(value.st_mode),
        value.st_size,
        value.st_mtime_ns,
    )


def _stable_regular_file_snapshot(path: Path, label: str) -> tuple[bytes, str]:
    try:
        before = path.lstat()
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        attributes = getattr(before, "st_file_attributes", 0)
        if stat.S_ISLNK(before.st_mode) or (
            reparse_flag and attributes & reparse_flag
        ):
            raise ChildEntryError(f"{label} must not be a link or reparse point")
        if not stat.S_ISREG(before.st_mode):
            raise ChildEntryError(f"{label} must be a regular file")
        with path.open("rb") as stream:
            opened = os.fstat(stream.fileno())
            payload = stream.read()
            after_open = os.fstat(stream.fileno())
        after = path.lstat()
    except ChildEntryError:
        raise
    except OSError as error:
        raise ChildEntryError(f"{label} could not be read stably") from error
    identities = {
        _file_identity(before),
        _file_identity(opened),
        _file_identity(after_open),
        _file_identity(after),
    }
    if len(identities) != 1 or len(payload) != opened.st_size:
        raise ChildEntryError(f"{label} changed while it was being read")
    return payload, hashlib.sha256(payload).hexdigest()


def _require_exact_keys(
    value: Mapping[str, object], expected: set[str], label: str
) -> None:
    actual = set(value)
    if actual != expected:
        raise ChildEntryError(
            f"{label} keys differ from the closed schema"
        )


def _require_string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ChildEntryError(f"{label} must be a non-empty NUL-free string")
    return value


def _require_sha256(value: object, label: str) -> str:
    candidate = _require_string(value, label)
    if SHA256_RE.fullmatch(candidate) is None:
        raise ChildEntryError(f"{label} must be a lowercase SHA-256 digest")
    return candidate


def _require_logical_id(value: object, label: str) -> str:
    candidate = _require_string(value, label)
    if LOGICAL_ID_RE.fullmatch(candidate) is None:
        raise ChildEntryError(f"{label} must remain path-free")
    return candidate


def _validate_request(value: Mapping[str, object]) -> dict[str, str]:
    _require_exact_keys(
        value,
        {
            "schemaVersion",
            "sourcePath",
            "targetPath",
            "sourceLogicalId",
            "targetLogicalId",
            "expectedWorkerSha256",
            "expectedEntrySha256",
        },
        "child request",
    )
    if value.get("schemaVersion") != REQUEST_SCHEMA_VERSION:
        raise ChildEntryError("child request schema version drifted")
    return {
        "sourcePath": _require_string(value.get("sourcePath"), "sourcePath"),
        "targetPath": _require_string(value.get("targetPath"), "targetPath"),
        "sourceLogicalId": _require_logical_id(
            value.get("sourceLogicalId"), "sourceLogicalId"
        ),
        "targetLogicalId": _require_logical_id(
            value.get("targetLogicalId"), "targetLogicalId"
        ),
        "expectedWorkerSha256": _require_sha256(
            value.get("expectedWorkerSha256"), "expectedWorkerSha256"
        ),
        "expectedEntrySha256": _require_sha256(
            value.get("expectedEntrySha256"), "expectedEntrySha256"
        ),
    }


def _load_exact_worker(worker_bytes: bytes) -> ModuleType:
    module = ModuleType("_venviewer_grand_hall_authority_none_icp_replay_exact")
    module.__file__ = WORKER_FILE_NAME
    try:
        code = compile(worker_bytes, WORKER_FILE_NAME, "exec", dont_inherit=True)
        exec(code, module.__dict__)
    except Exception as error:
        raise ChildEntryError("reviewed worker bytes could not be loaded") from error
    return module


def _require_worker_callable(
    module: ModuleType, name: str
) -> Callable[..., dict[str, Any]]:
    candidate = getattr(module, name, None)
    if not callable(candidate):
        raise ChildEntryError(f"reviewed worker does not expose {name}")
    return candidate


def _validate_repeated_replay_receipt(receipt: dict[str, Any]) -> None:
    validation = receipt.get("repeatedReplayValidation")
    if not isinstance(validation, dict):
        raise ChildEntryError(
            "reviewed worker omitted exact same-process replay validation"
        )
    _require_exact_keys(
        validation,
        {
            "sameProcessRunCount",
            "canonicalReceiptBytesIdentical",
            "canonicalUnvalidatedReceiptSha256",
            "scope",
        },
        "repeated replay validation",
    )
    if validation.get("sameProcessRunCount") != 2:
        raise ChildEntryError("reviewed worker did not execute exactly twice")
    if validation.get("canonicalReceiptBytesIdentical") is not True:
        raise ChildEntryError("reviewed worker same-process receipts differed")
    if validation.get("scope") != REPEATED_REPLAY_SCOPE:
        raise ChildEntryError("reviewed worker repeat-validation scope drifted")
    expected_unvalidated_sha256 = _require_sha256(
        validation.get("canonicalUnvalidatedReceiptSha256"),
        "canonicalUnvalidatedReceiptSha256",
    )
    unvalidated_receipt = dict(receipt)
    del unvalidated_receipt["repeatedReplayValidation"]
    actual_unvalidated_sha256 = hashlib.sha256(
        _canonical_json_bytes(unvalidated_receipt)
    ).hexdigest()
    if actual_unvalidated_sha256 != expected_unvalidated_sha256:
        raise ChildEntryError(
            "reviewed worker repeat validation is not bound to the emitted receipt"
        )


def _execute_validated_replay(
    worker: ModuleType,
    request: Mapping[str, str],
) -> dict[str, Any]:
    replay_twice = _require_worker_callable(
        worker, "replay_grand_hall_authority_none_icp_twice"
    )
    receipt = replay_twice(
        request["sourcePath"],
        request["targetPath"],
        source_logical_id=request["sourceLogicalId"],
        target_logical_id=request["targetLogicalId"],
    )
    _validate_repeated_replay_receipt(receipt)
    return receipt


def _read_request() -> dict[str, object]:
    payload = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if not payload or len(payload) > MAX_REQUEST_BYTES:
        raise ChildEntryError("child request size is invalid")
    return _strict_json_object(payload, "child request")


def _run() -> tuple[bytes, dict[str, object]]:
    request = _validate_request(_read_request())
    entry_path = Path(__file__)
    worker_path = entry_path.with_name(WORKER_FILE_NAME)
    entry_bytes, entry_sha256 = _stable_regular_file_snapshot(
        entry_path, "child entry"
    )
    worker_bytes, worker_sha256 = _stable_regular_file_snapshot(
        worker_path, "reviewed worker"
    )
    if entry_sha256 != request["expectedEntrySha256"]:
        raise ChildEntryError("child entry bytes differ from the parent binding")
    if worker_sha256 != request["expectedWorkerSha256"]:
        raise ChildEntryError("reviewed worker bytes differ from the parent binding")
    if hashlib.sha256(entry_bytes).hexdigest() != entry_sha256:
        raise ChildEntryError("child entry digest verification failed")

    worker = _load_exact_worker(worker_bytes)
    receipt = _execute_validated_replay(worker, request)
    receipt_bytes = _canonical_json_bytes(receipt)
    status = {
        "schemaVersion": STATUS_SCHEMA_VERSION,
        "childProcessId": os.getpid(),
        "reportedParentProcessId": os.getppid(),
        "workerImplementationSha256": worker_sha256,
        "childEntryImplementationSha256": entry_sha256,
        "canonicalWorkerReceiptSha256": hashlib.sha256(
            receipt_bytes
        ).hexdigest(),
    }
    return receipt_bytes, status


def main() -> int:
    try:
        receipt_bytes, status = _run()
    except Exception as error:
        error_class = type(error).__name__
        sys.stderr.write(
            "Grand Hall authority-none replay child stopped safely "
            f"({error_class})."
        )
        return 1
    sys.stdout.buffer.write(receipt_bytes)
    sys.stdout.buffer.flush()
    sys.stderr.buffer.write(_canonical_json_bytes(status))
    sys.stderr.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
