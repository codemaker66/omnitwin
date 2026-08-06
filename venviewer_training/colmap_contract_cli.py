"""Read-only CLI for the fixed Config-B COLMAP dataset contract.

The caller supplies one already-admitted package root.  This module derives
``dataset`` and ``depths`` beneath that root, validates them with the existing
dependency-light contract, and emits one bounded canonical JSON envelope.
It does not train, write files, start subprocesses, or contact a network.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Sequence, TextIO

from venviewer_training.colmap_contract import (
    ColmapContractError,
    validate_colmap_training_contract,
)


SCHEMA_VERSION = "venviewer.prepared-hd-dataset-gate.v0"
MAX_SUCCESS_ENVELOPE_BYTES = 8 * 1024 * 1024
VALIDATION_ERROR_EXIT = 2

_SAFE_ERROR_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
_SAFE_VALIDATION_MESSAGE = (
    "Prepared COLMAP package does not satisfy the fixed Config-B dataset contract."
)


def _canonical_json_bytes(value: dict[str, Any]) -> bytes:
    """Encode one bounded, deterministic JSON line without partial output."""

    encoder = json.JSONEncoder(
        allow_nan=False,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    encoded = bytearray()
    for fragment in encoder.iterencode(value):
        fragment_bytes = fragment.encode("ascii")
        if len(encoded) + len(fragment_bytes) + 1 > MAX_SUCCESS_ENVELOPE_BYTES:
            raise ColmapContractError(
                "OUTPUT_TOO_LARGE",
                "prepared dataset summary exceeds the bounded CLI output limit",
            )
        encoded.extend(fragment_bytes)
    encoded.extend(b"\n")
    return bytes(encoded)


def _safe_error_bytes(error: ColmapContractError) -> bytes:
    code = error.code if _SAFE_ERROR_CODE.fullmatch(error.code) else "VALIDATION_FAILED"
    document = {
        "error": {"code": code, "message": _SAFE_VALIDATION_MESSAGE},
        "ok": False,
        "schemaVersion": SCHEMA_VERSION,
    }
    # Every variable field is either fixed text or a length-bounded error code.
    return (
        json.dumps(
            document,
            allow_nan=False,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode("ascii")


def run_package_root(
    package_root: Path,
    *,
    stdout: TextIO = sys.stdout,
    stderr: TextIO = sys.stderr,
) -> int:
    """Validate ``PACKAGE_ROOT/dataset`` and ``PACKAGE_ROOT/depths``."""

    package_root = Path(package_root)
    try:
        summary = validate_colmap_training_contract(
            package_root / "dataset",
            package_root / "depths",
            depth_required=True,
            data_factor=2,
            test_every=8,
        )
        payload = _canonical_json_bytes(
            {
                "ok": True,
                "schemaVersion": SCHEMA_VERSION,
                "summary": summary,
            }
        )
    except ColmapContractError as error:
        stderr.write(_safe_error_bytes(error).decode("ascii"))
        return VALIDATION_ERROR_EXIT

    stdout.write(payload.decode("ascii"))
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m venviewer_training.colmap_contract_cli",
        description=(
            "Validate the dataset and depths beneath one trusted package root "
            "against the fixed Config-B input contract."
        ),
        allow_abbrev=False,
    )
    parser.add_argument(
        "--package-root",
        required=True,
        type=Path,
        metavar="ROOT",
        help="already-admitted package containing dataset/ and depths/",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    return run_package_root(args.package_root, stdout=sys.stdout, stderr=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())

