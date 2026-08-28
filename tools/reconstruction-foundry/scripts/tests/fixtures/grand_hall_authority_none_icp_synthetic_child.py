"""Synthetic child protocol fixture; never imports or reads venue data."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys


WORKER_FILE_NAME = "grand_hall_authority_none_icp_replay.py"
STATUS_SCHEMA_VERSION = (
    "venviewer.grand-hall.authority-none-icp-child-status.v1"
)
SEED_ADAPTER_SCHEMA_VERSION = (
    "venviewer.grand-hall.authority-none-icp-seed-adapter.v1"
)
REPEATED_REPLAY_SCOPE = (
    "exact-full-receipt-including-correspondence-and-matrix-bytes"
)
THREAD_ENVIRONMENT_KEYS = (
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
)


def canonical(value: object) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def main() -> int:
    request_bytes = sys.stdin.buffer.read()
    request = json.loads(request_bytes.decode("utf-8"))
    if canonical(request) != request_bytes:
        return 2

    entry_bytes = Path(__file__).read_bytes()
    worker_bytes = Path(__file__).with_name(WORKER_FILE_NAME).read_bytes()
    entry_sha256 = hashlib.sha256(entry_bytes).hexdigest()
    worker_sha256 = hashlib.sha256(worker_bytes).hexdigest()
    if request.get("expectedEntrySha256") != entry_sha256:
        return 3
    if request.get("expectedWorkerSha256") != worker_sha256:
        return 4

    mode = request.get("sourceLogicalId")
    payload: object = "synthetic-stable-receipt"
    accepted_transform = False
    if mode == "synthetic-vary":
        payload = os.getpid()
    elif mode == "synthetic-path-leak":
        payload = "C:\\capture-secrets\\source.obj"
    elif mode == "synthetic-authority-drift":
        accepted_transform = True
    elif mode == "synthetic-env":
        payload = {
            "threadEnvironmentControls": {
                key: os.environ.get(key) for key in THREAD_ENVIRONMENT_KEYS
            },
            "unexpectedParentEnvironmentPresent": (
                "VENVIEWER_SYNTHETIC_PARENT_SENTINEL" in os.environ
            ),
        }

    unvalidated_receipt = {
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
            "schemaVersion": SEED_ADAPTER_SCHEMA_VERSION,
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
    if mode == "synthetic-time-field":
        unvalidated_receipt["runTimestamp"] = 1_788_000_000
    elif mode == "synthetic-relative-path-field":
        unvalidated_receipt["sourcePath"] = "relative-source.obj"
    receipt = dict(unvalidated_receipt)
    receipt["repeatedReplayValidation"] = {
        "sameProcessRunCount": 2,
        "canonicalReceiptBytesIdentical": True,
        "canonicalUnvalidatedReceiptSha256": hashlib.sha256(
            canonical(unvalidated_receipt)
        ).hexdigest(),
        "scope": REPEATED_REPLAY_SCOPE,
    }
    if mode == "synthetic-missing-repeat":
        del receipt["repeatedReplayValidation"]
    elif mode == "synthetic-repeat-digest-drift":
        receipt["repeatedReplayValidation"][
            "canonicalUnvalidatedReceiptSha256"
        ] = "0" * 64
    receipt_bytes = canonical(receipt)
    reported_parent = os.getppid()
    if mode == "synthetic-parent-drift":
        reported_parent += 1
    status = {
        "schemaVersion": STATUS_SCHEMA_VERSION,
        "childProcessId": os.getpid(),
        "reportedParentProcessId": reported_parent,
        "workerImplementationSha256": worker_sha256,
        "childEntryImplementationSha256": entry_sha256,
        "canonicalWorkerReceiptSha256": hashlib.sha256(receipt_bytes).hexdigest(),
    }
    if mode == "synthetic-pretty-json":
        receipt_bytes = json.dumps(receipt, indent=2, sort_keys=True).encode("utf-8")
        status["canonicalWorkerReceiptSha256"] = hashlib.sha256(
            receipt_bytes
        ).hexdigest()

    sys.stdout.buffer.write(receipt_bytes)
    sys.stderr.buffer.write(canonical(status))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
