"""Read-only verifier for the Grand Hall authority-none ICP environment lock.

The lock and this verifier bind only the listed runtime and wheel file bytes.
The verifier does not launch listed runtime artifacts, import the locked wheels,
read Grand Hall source data, or claim cross-host/cross-platform reproducibility.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from typing import Mapping, Sequence


LOCK_FILE_NAME = "requirements-grand-hall-authority-none-icp-replay.lock.json"
LOCK_SCHEMA_VERSION = "venviewer.grand-hall-authority-none-icp-replay-environment-lock.v1"
EXPECTED_LOCK_SEMANTIC_SHA256 = "ed3ca16cca2e039da4407a5e8025624b87970ae31bb2fa4b7b27b25cb0ba35df"
DETERMINISM_CLASSIFICATION = "same_runtime_same_host_only"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
READ_SIZE = 1024 * 1024


class EnvironmentLockError(RuntimeError):
    """Raised when the lock or a listed file fails closed verification."""


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise EnvironmentLockError(f"Duplicate JSON key is forbidden: {key!r}.")
        result[key] = value
    return result


def _reject_non_finite(value: str) -> object:
    raise EnvironmentLockError(f"Non-finite JSON number is forbidden: {value}.")


def _canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _load_strict_json(lock_file: Path) -> dict[str, object]:
    try:
        raw = lock_file.read_text(encoding="utf-8")
        value = json.loads(
            raw,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_non_finite,
        )
    except EnvironmentLockError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise EnvironmentLockError("Environment lock is unavailable or invalid JSON.") from error
    if not isinstance(value, dict):
        raise EnvironmentLockError("Environment lock root must be a JSON object.")
    return value


def _require_mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise EnvironmentLockError(f"{label} must be a JSON object.")
    return value


def _validate_authority_boundary(document: Mapping[str, object]) -> None:
    determinism = _require_mapping(document.get("determinism"), "determinism")
    boundary = _require_mapping(document.get("verificationBoundary"), "verificationBoundary")
    if document.get("authority") != "none":
        raise EnvironmentLockError("Environment lock authority must remain none.")
    if determinism.get("classification") != DETERMINISM_CLASSIFICATION:
        raise EnvironmentLockError("Environment lock determinism classification drifted.")
    if determinism.get("crossHostExactReplayClaimed") is not False:
        raise EnvironmentLockError("Cross-host exact replay must remain unclaimed.")
    if determinism.get("crossPlatformExactReplayClaimed") is not False:
        raise EnvironmentLockError("Cross-platform exact replay must remain unclaimed.")
    for field in (
        "executesSourceData",
        "importsLockedWheels",
        "launchesListedRuntimeArtifacts",
        "networkRequired",
    ):
        if boundary.get(field) is not False:
            raise EnvironmentLockError(f"verificationBoundary.{field} must remain false.")


def verify_lock_document(lock_file: Path) -> dict[str, object]:
    """Load and verify the exact semantic lock without inspecting locked files."""

    document = _load_strict_json(lock_file)
    semantic_sha256 = hashlib.sha256(_canonical_json_bytes(document)).hexdigest()
    if semantic_sha256 != EXPECTED_LOCK_SEMANTIC_SHA256:
        raise EnvironmentLockError("Environment lock semantic SHA-256 does not match the reviewed pin.")
    if document.get("schemaVersion") != LOCK_SCHEMA_VERSION:
        raise EnvironmentLockError("Environment lock schema version drifted.")
    _validate_authority_boundary(document)
    return document


def _require_member_specs(document: Mapping[str, object], field: str) -> list[Mapping[str, object]]:
    value = document.get(field)
    if not isinstance(value, list) or not value:
        raise EnvironmentLockError(f"{field} must be a non-empty JSON array.")
    result: list[Mapping[str, object]] = []
    for index, item in enumerate(value):
        result.append(_require_mapping(item, f"{field}[{index}]"))
    return result


def _require_safe_member_name(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or value in {".", ".."}:
        raise EnvironmentLockError(f"{label} must be a direct member name.")
    if "/" in value or "\\" in value or ":" in value:
        raise EnvironmentLockError(f"{label} must not contain a location component.")
    return value


def _require_member_expectations(spec: Mapping[str, object], label: str) -> tuple[str, int, str]:
    name = _require_safe_member_name(spec.get("memberName"), f"{label}.memberName")
    byte_length = spec.get("byteLength")
    sha256 = spec.get("sha256")
    if isinstance(byte_length, bool) or not isinstance(byte_length, int) or byte_length <= 0:
        raise EnvironmentLockError(f"{label}.byteLength must be a positive integer.")
    if not isinstance(sha256, str) or SHA256_RE.fullmatch(sha256) is None:
        raise EnvironmentLockError(f"{label}.sha256 must be lowercase SHA-256.")
    return name, byte_length, sha256


def _identity(file_stat: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        file_stat.st_dev,
        file_stat.st_ino,
        stat.S_IFMT(file_stat.st_mode),
        file_stat.st_size,
        file_stat.st_mtime_ns,
    )


def _reject_link_or_non_file(member: Path, label: str) -> os.stat_result:
    try:
        file_stat = member.lstat()
    except OSError as error:
        raise EnvironmentLockError(f"{label} is unavailable.") from error
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    file_attributes = getattr(file_stat, "st_file_attributes", 0)
    if stat.S_ISLNK(file_stat.st_mode) or (reparse_flag and file_attributes & reparse_flag):
        raise EnvironmentLockError(f"{label} must not be a link or reparse point.")
    if not stat.S_ISREG(file_stat.st_mode):
        raise EnvironmentLockError(f"{label} must be a regular file.")
    return file_stat


def _stable_file_fingerprint(member: Path, label: str) -> tuple[int, str]:
    before = _reject_link_or_non_file(member, label)
    digest = hashlib.sha256()
    try:
        with member.open("rb") as stream:
            opened = os.fstat(stream.fileno())
            for block in iter(lambda: stream.read(READ_SIZE), b""):
                digest.update(block)
            after_open = os.fstat(stream.fileno())
        after = _reject_link_or_non_file(member, label)
    except OSError as error:
        raise EnvironmentLockError(f"{label} could not be read stably.") from error
    identities = {_identity(before), _identity(opened), _identity(after_open), _identity(after)}
    if len(identities) != 1:
        raise EnvironmentLockError(f"{label} changed while it was being verified.")
    return opened.st_size, digest.hexdigest()


def _verify_member_root(
    root: Path,
    specs: Sequence[Mapping[str, object]],
    kind: str,
) -> None:
    if root.is_symlink() or not root.is_dir():
        raise EnvironmentLockError(f"{kind} root must be an existing direct directory.")
    seen: set[str] = set()
    for index, spec in enumerate(specs):
        name, expected_length, expected_sha256 = _require_member_expectations(spec, f"{kind}[{index}]")
        if name in seen:
            raise EnvironmentLockError(f"{kind} member names must be unique.")
        seen.add(name)
        actual_length, actual_sha256 = _stable_file_fingerprint(root / name, f"{kind} member {name!r}")
        if actual_length != expected_length or actual_sha256 != expected_sha256:
            raise EnvironmentLockError(f"{kind} member {name!r} does not match the reviewed bytes.")


def verify_listed_file_bytes(
    document: Mapping[str, object],
    runtime_root: Path,
    wheel_root: Path,
) -> None:
    """Hash the listed direct members without executing or importing them."""

    runtime = _require_mapping(document.get("runtime"), "runtime")
    runtime_specs = _require_member_specs(runtime, "members")
    wheel_specs = _require_member_specs(document, "wheels")
    _verify_member_root(runtime_root, runtime_specs, "runtime")
    _verify_member_root(wheel_root, wheel_specs, "wheel")


def _parse_arguments(arguments: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify the non-authoritative Grand Hall ICP replay environment lock.",
    )
    parser.add_argument("--lock", type=Path, default=Path(__file__).with_name(LOCK_FILE_NAME))
    parser.add_argument("--runtime-root", type=Path)
    parser.add_argument("--wheel-root", type=Path)
    parsed = parser.parse_args(arguments)
    if (parsed.runtime_root is None) != (parsed.wheel_root is None):
        parser.error("--runtime-root and --wheel-root must be supplied together")
    return parsed


def _success_summary(listed_file_bytes_verified: bool) -> dict[str, object]:
    return {
        "authority": "none",
        "determinismClassification": DETERMINISM_CLASSIFICATION,
        "listedFileBytesVerified": listed_file_bytes_verified,
        "lockSemanticSha256": EXPECTED_LOCK_SEMANTIC_SHA256,
    }


def main(arguments: Sequence[str] | None = None) -> int:
    parsed = _parse_arguments(sys.argv[1:] if arguments is None else arguments)
    try:
        document = verify_lock_document(parsed.lock)
        has_roots = parsed.runtime_root is not None and parsed.wheel_root is not None
        if has_roots:
            verify_listed_file_bytes(document, parsed.runtime_root, parsed.wheel_root)
    except EnvironmentLockError as error:
        print(f"Grand Hall authority-none environment verification stopped safely: {error}", file=sys.stderr)
        return 1
    print(json.dumps(_success_summary(has_roots), separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
