"""Venviewer Config B contract preflight.

This entrypoint is intentionally dependency-light.  ``--help`` and
``preflight`` work without importing the upstream trainer, CUDA, Torch, Tyro,
or viewer packages at module import time.  The legacy execution path remains
closed: actual splat optimization is RunPod-only under D-016 and requires the
trusted Foundry JobSpec, rights, confirmation, compute, cost, kill-switch, and
attempt-ledger gates.

Examples
--------

Validate a real prepared COLMAP contract without training::

    python -B -m venviewer_training.simple_trainer_depth preflight \
      --config configs/training/config_b.yaml \
      --dataset C:/prepared/colmap_v2 \
      --depth-dir C:/prepared/depths_e57

Run the repository-owned deterministic synthetic proof::

    python -B -m venviewer_training.simple_trainer_depth preflight \
      --config configs/training/config_b.yaml --synthetic-fixture
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Sequence


BLOCKED_EXECUTION_MESSAGE = (
    "Actual training is not available from this entrypoint. D-016 requires "
    "RunPod, and the trusted Foundry execution gates are not connected."
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m venviewer_training.simple_trainer_depth",
        description=(
            "Validate the frozen Config B and COLMAP/depth contracts without "
            "starting training or contacting a provider."
        ),
    )
    subparsers = parser.add_subparsers(dest="command")

    preflight = subparsers.add_parser(
        "preflight",
        help="run the authority-none CPU contract proof (no optimization)",
    )
    preflight.add_argument("--config", required=True, type=Path)
    source = preflight.add_mutually_exclusive_group(required=True)
    source.add_argument("--dataset", type=Path, help="prepared colmap_v2 root")
    source.add_argument(
        "--synthetic-fixture",
        action="store_true",
        help="use the small deterministic repository-owned test fixture",
    )
    preflight.add_argument(
        "--depth-dir",
        type=Path,
        help=(
            "depth-prior directory to validate (defaults to DATASET/depths; "
            "this checker does not connect it to training)"
        ),
    )
    preflight.add_argument(
        "--output",
        type=Path,
        help="optionally create a new canonical JSON receipt; never overwrites",
    )

    execute = subparsers.add_parser(
        "execute",
        help="always fails closed; actual training requires the Foundry executor",
    )
    execute.add_argument("arguments", nargs=argparse.REMAINDER)
    return parser


def _run_preflight(args: argparse.Namespace) -> int:
    from venviewer_training.trainer_contract import (
        TrainerContractError,
        build_preflight_receipt,
        receipt_bytes,
    )

    temporary: tempfile.TemporaryDirectory[str] | None = None
    try:
        if args.synthetic_fixture:
            if args.depth_dir is not None:
                raise TrainerContractError(
                    "INVALID_ARGUMENT",
                    "--depth-dir cannot be combined with --synthetic-fixture; the fixture owns its depth files",
                )
            temporary = tempfile.TemporaryDirectory(prefix="venviewer-trainer-contract-")
            from venviewer_training.tests.fixture_builder import build_valid_colmap_fixture

            dataset_root, depth_dir = build_valid_colmap_fixture(Path(temporary.name))
        else:
            dataset_root = args.dataset
            assert isinstance(dataset_root, Path)
            depth_dir = args.depth_dir or (dataset_root / "depths")

        receipt = build_preflight_receipt(
            config_path=args.config,
            dataset_root=dataset_root,
            depth_dir=depth_dir,
        )
        encoded = receipt_bytes(receipt)
        if args.output is not None:
            try:
                with args.output.open("xb") as destination:
                    destination.write(encoded)
            except FileExistsError as error:
                raise TrainerContractError(
                    "OUTPUT_EXISTS", "output receipt already exists; refusing to overwrite"
                ) from error
            except OSError as error:
                raise TrainerContractError(
                    "OUTPUT_WRITE_FAILED", "could not create output receipt"
                ) from error
        sys.stdout.buffer.write(encoded)
        return 0
    except TrainerContractError as error:
        sys.stderr.write(
            json.dumps(
                {"code": error.code, "message": error.message, "ok": False},
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
        )
        return 2
    finally:
        if temporary is not None:
            temporary.cleanup()


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    if args.command == "execute":
        sys.stderr.write(BLOCKED_EXECUTION_MESSAGE + "\n")
        return 78
    if args.command == "preflight":
        return _run_preflight(args)
    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
