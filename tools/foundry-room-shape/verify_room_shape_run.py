#!/usr/bin/env python3
"""Verify one frozen room-shape proposal, receipt and diagnostic set.

This verifier is deliberately dependency-free and does not import the
measurement or comparison modules.  It checks bytes and canonical digests; it
does not endorse the proposed walls or turn an authority-none result into a
reviewed measurement.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any

PROPOSAL_SCHEMA_VERSION = "omnitwin.foundry.room-shape-proposal.v0"
PROPOSAL_DIGEST_DOMAIN = b"OMNITWIN_FOUNDRY_ROOM_SHAPE_PROPOSAL_V0\0"
RECEIPT_SCHEMA_VERSION = "omnitwin.foundry.room-shape-run-receipt.v0"
RECEIPT_DIGEST_DOMAIN = b"OMNITWIN_FOUNDRY_ROOM_SHAPE_RUN_RECEIPT_V0\0"
DIAGNOSTIC_SCHEMA_VERSION = "omnitwin.foundry.room-shape-diagnostic.v0"
SHA256_HEX = re.compile(r"^[a-f0-9]{64}$")


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        ensure_ascii=True,
    ).encode("utf-8")


def _sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def _safe_member(root: Path, raw_name: Any, field: str) -> Path:
    if not isinstance(raw_name, str) or not raw_name or Path(raw_name).name != raw_name:
        raise ValueError(f"{field} must be one plain file name")
    return root / raw_name


def _expect_hash(value: Any, field: str) -> str:
    if not isinstance(value, str) or SHA256_HEX.fullmatch(value) is None:
        raise ValueError(f"{field} must be lowercase SHA-256 hex")
    return value


def _verify_digest(
    document: dict[str, Any],
    *,
    field: str,
    domain: bytes,
) -> str:
    claimed = _expect_hash(document.get(field), field)
    payload = dict(document)
    del payload[field]
    actual = hashlib.sha256(domain + _canonical(payload)).hexdigest()
    if actual != claimed:
        raise ValueError(f"{field} does not match the canonical payload")
    return claimed


def _verify_bound_file(
    path: Path,
    *,
    expected_sha256: Any,
    expected_bytes: Any,
    field: str,
) -> None:
    expected_hash = _expect_hash(expected_sha256, f"{field}.sha256")
    if not isinstance(expected_bytes, int) or isinstance(expected_bytes, bool) or expected_bytes < 0:
        raise ValueError(f"{field}.sizeBytes must be a non-negative integer")
    actual_hash, actual_bytes = _sha256_file(path)
    if actual_hash != expected_hash or actual_bytes != expected_bytes:
        raise ValueError(f"{field} bytes do not match the receipt")


def verify_run(
    receipt_path: Path,
    *,
    cloud_path: Path | None = None,
    origins_path: Path | None = None,
) -> dict[str, Any]:
    root = receipt_path.resolve().parent
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if not isinstance(receipt, dict):
        raise ValueError("receipt must be a JSON object")
    if receipt.get("schemaVersion") != RECEIPT_SCHEMA_VERSION:
        raise ValueError("unsupported receipt schemaVersion")
    receipt_sha = _verify_digest(
        receipt,
        field="receiptSha256",
        domain=RECEIPT_DIGEST_DOMAIN,
    )

    proposal_path = _safe_member(
        root,
        receipt.get("proposalFileName"),
        "proposalFileName",
    )
    _verify_bound_file(
        proposal_path,
        expected_sha256=receipt.get("proposalFileSha256"),
        expected_bytes=receipt.get("proposalFileBytes"),
        field="proposalFile",
    )
    proposal = json.loads(proposal_path.read_text(encoding="utf-8"))
    if not isinstance(proposal, dict):
        raise ValueError("proposal must be a JSON object")
    if proposal.get("schemaVersion") != PROPOSAL_SCHEMA_VERSION:
        raise ValueError("unsupported proposal schemaVersion")
    if proposal.get("authority") != "none" or proposal.get("reviewStatus") != "unreviewed":
        raise ValueError("proposal must remain authority-none and unreviewed")
    proposal_sha = _verify_digest(
        proposal,
        field="proposalSha256",
        domain=PROPOSAL_DIGEST_DOMAIN,
    )
    if receipt.get("proposalSha256") != proposal_sha:
        raise ValueError("receipt proposalSha256 does not bind the proposal")

    diagnostics = receipt.get("diagnostics")
    if not isinstance(diagnostics, list):
        raise ValueError("receipt diagnostics must be an array")
    seen_names: set[str] = set()
    for index, diagnostic in enumerate(diagnostics):
        if not isinstance(diagnostic, dict):
            raise ValueError(f"diagnostics[{index}] must be an object")
        name = diagnostic.get("fileName")
        path = _safe_member(root, name, f"diagnostics[{index}].fileName")
        if path.name in seen_names:
            raise ValueError("diagnostic file names must be unique")
        seen_names.add(path.name)
        if diagnostic.get("schemaVersion") != DIAGNOSTIC_SCHEMA_VERSION:
            raise ValueError(f"diagnostics[{index}] has an unsupported schemaVersion")
        _verify_bound_file(
            path,
            expected_sha256=diagnostic.get("sha256"),
            expected_bytes=diagnostic.get("sizeBytes"),
            field=f"diagnostics[{index}]",
        )

    inputs = receipt.get("inputs")
    if not isinstance(inputs, dict):
        raise ValueError("receipt inputs must be an object")
    if cloud_path is not None:
        _verify_bound_file(
            cloud_path,
            expected_sha256=inputs.get("cloudSha256"),
            expected_bytes=inputs.get("cloudBytes"),
            field="cloud",
        )
    if origins_path is not None:
        _verify_bound_file(
            origins_path,
            expected_sha256=inputs.get("originsSha256"),
            expected_bytes=inputs.get("originsBytes"),
            field="origins",
        )

    policy = receipt.get("policy")
    expected_policy = {
        "sourceBytesMutated": False,
        "networkUsed": False,
        "selfApproved": False,
        "comparedAgainstExternalFigures": False,
    }
    if policy != expected_policy:
        raise ValueError("receipt policy must retain the authority-none local boundary")

    measurement = proposal.get("measurement")
    state = measurement.get("state") if isinstance(measurement, dict) else None
    return {
        "status": "PASS_ROOM_SHAPE_RUN_INTEGRITY",
        "receiptSha256": receipt_sha,
        "proposalSha256": proposal_sha,
        "state": state,
        "refusals": proposal.get("refusals", []),
        "diagnosticCount": len(diagnostics),
        "inputsRehashed": {
            "cloud": cloud_path is not None,
            "origins": origins_path is not None,
        },
        "authority": "none",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("receipt", type=Path)
    parser.add_argument("--cloud", type=Path)
    parser.add_argument("--origins", type=Path)
    args = parser.parse_args(argv)
    try:
        result = verify_run(
            args.receipt,
            cloud_path=args.cloud,
            origins_path=args.origins,
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"FAIL_ROOM_SHAPE_RUN_INTEGRITY: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
