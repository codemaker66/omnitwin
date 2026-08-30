#!/usr/bin/env python3
"""Create or verify exhaustive local Difix runtime/model seals.

Sealing is deliberately expensive: every regular file is read through one
stable descriptor and every symbolic link is inventoried with its resolved
target. The TypeScript CLI exposes this tool but never runs it implicitly.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
from typing import Any, Iterable, Mapping


RUNTIME_SCHEMA = "venviewer.grand-hall.difix-no-reference-runtime-seal.v1"
MODEL_SCHEMA = "venviewer.grand-hall.difix-no-reference-model-seal.v1"
PROVIDER_ID = "nv-tlabs/Difix3D"
PROVIDER_REVISION = "c76edc595586e16732c91ddee82f3a6d83a8a9cc"
MODEL_ID = "nvidia/difix"
MODEL_REVISION = "2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388"
EXACT_WEIGHTS: list[Mapping[str, Any]] = [
    {
        "relativePath": "text_encoder/model.safetensors",
        "sizeBytes": 1_361_596_304,
        "sha256": "sha256:67e013543d4fac905c882e2993d86a2d454ee69dc9e8f37c0c23d33a48959d15",
    },
    {
        "relativePath": "unet/diffusion_pytorch_model.safetensors",
        "sizeBytes": 3_463_726_504,
        "sha256": "sha256:3815819b0009d16b5f7538ecbf2dd0ac4a6b07a238ab82d869465c347864bb70",
    },
    {
        "relativePath": "vae/diffusion_pytorch_model.safetensors",
        "sizeBytes": 338_717_612,
        "sha256": "sha256:20a5e872469d801876e448ec1d499b1e99cc666497a6aa133ed22c9e0a7a1a25",
    },
]
EXACT_LOAD_CLOSURE: list[Mapping[str, Any]] = [
    {"relativePath": "model_index.json", "sizeBytes": 586, "sha256": "sha256:0b4316574ae102b3855c4508a13becc81b353f6455dafa6186ac37d82c8292b9"},
    {"relativePath": "scheduler/scheduler_config.json", "sizeBytes": 700, "sha256": "sha256:78e1c4d74df2c94c7d886f0d3f9ccff9c88851dda9c6ae4ccab3356a18efa855"},
    {"relativePath": "text_encoder/config.json", "sizeBytes": 603, "sha256": "sha256:2796729c12b32c17e039ef9d5a78bcc61d52d1afbcbe11edf004a26531c92c2a"},
    {"relativePath": "text_encoder/model.safetensors", "sizeBytes": 1_361_596_304, "sha256": "sha256:67e013543d4fac905c882e2993d86a2d454ee69dc9e8f37c0c23d33a48959d15"},
    {"relativePath": "tokenizer/merges.txt", "sizeBytes": 524_619, "sha256": "sha256:9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a"},
    {"relativePath": "tokenizer/special_tokens_map.json", "sizeBytes": 574, "sha256": "sha256:c2d0fb8b86ad86b1f46134d4a5f93fd1e688c932a78efc8d149087c33a53ad06"},
    {"relativePath": "tokenizer/tokenizer_config.json", "sizeBytes": 885, "sha256": "sha256:b91e0a1eba063043b4ee76bec870f2fa0c12a3ff404155b30e64c77d25c0758f"},
    {"relativePath": "tokenizer/vocab.json", "sizeBytes": 1_059_962, "sha256": "sha256:e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349"},
    {"relativePath": "unet/config.json", "sizeBytes": 1_852, "sha256": "sha256:bc47aaf41ef8a34b38ef06518ace2276bb57c38a92309c40e398a8d96a8e33db"},
    {"relativePath": "unet/diffusion_pytorch_model.safetensors", "sizeBytes": 3_463_726_504, "sha256": "sha256:3815819b0009d16b5f7538ecbf2dd0ac4a6b07a238ab82d869465c347864bb70"},
    {"relativePath": "vae/autoencoder_kl.py", "sizeBytes": 24_456, "sha256": "sha256:a0c16e2fe489d0386b04274b25e6cec212f37264283f8ce1c042270d27250edf"},
    {"relativePath": "vae/config.json", "sizeBytes": 698, "sha256": "sha256:d2ea6077dead151d8d0f21cd772b0de11b056c9c723c203840f6afaa1f3185f7"},
    {"relativePath": "vae/diffusion_pytorch_model.safetensors", "sizeBytes": 338_717_612, "sha256": "sha256:20a5e872469d801876e448ec1d499b1e99cc666497a6aa133ed22c9e0a7a1a25"},
]


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def sha256_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def domain_digest(domain: str, value: Any) -> str:
    return sha256_bytes(
        domain.encode("ascii") + b"\x00" + canonical_json(value).encode("utf-8")
    )


def require_absolute_wsl(path: Path) -> Path:
    value = str(path)
    if not value.startswith("/") or "\\" in value or ".." in PurePosixPath(value).parts:
        raise RuntimeError(f"Expected an absolute normalized WSL path, got {value!r}.")
    return path


def stable_file(path: Path) -> tuple[int, int, int, str]:
    before = path.stat(follow_symlinks=False)
    if not stat.S_ISREG(before.st_mode) or path.is_symlink():
        raise RuntimeError(f"Expected a direct regular file: {path}")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    digest = hashlib.sha256()
    try:
        opened_before = os.fstat(descriptor)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            opened_before.st_dev,
            opened_before.st_ino,
            opened_before.st_size,
            opened_before.st_mtime_ns,
            opened_before.st_ctime_ns,
        ):
            raise RuntimeError(f"File raced before hashing: {path}")
        while True:
            chunk = os.read(descriptor, 4 * 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
        opened_after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    after = path.stat(follow_symlinks=False)
    first = (
        opened_before.st_dev,
        opened_before.st_ino,
        opened_before.st_size,
        opened_before.st_mtime_ns,
        opened_before.st_ctime_ns,
    )
    second = (
        opened_after.st_dev,
        opened_after.st_ino,
        opened_after.st_size,
        opened_after.st_mtime_ns,
        opened_after.st_ctime_ns,
    )
    third = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
    if first != second or second != third:
        raise RuntimeError(f"File raced while hashing: {path}")
    return after.st_size, stat.S_IMODE(after.st_mode), after.st_nlink, "sha256:" + digest.hexdigest()


def direct_file_receipt(host_path: str, wsl_path: Path) -> Mapping[str, Any]:
    require_absolute_wsl(wsl_path)
    size, _mode, links, digest = stable_file(wsl_path)
    if links != 1:
        raise RuntimeError(f"Bound seal artifact must have exactly one hard link: {wsl_path}")
    return {
        "hostPath": host_path,
        "wslPath": str(wsl_path),
        "sizeBytes": size,
        "sha256": digest,
    }


def tree_nodes(root: Path) -> list[tuple[str, os.stat_result, str | None]]:
    require_absolute_wsl(root)
    if not root.is_dir() or root.is_symlink():
        raise RuntimeError(f"Inventory root must be a direct directory: {root}")
    nodes: list[tuple[str, os.stat_result, str | None]] = []
    for directory, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
        directory_path = Path(directory)
        names = sorted(directory_names + file_names)
        retained_directories: list[str] = []
        for name in names:
            path = directory_path / name
            relative = path.relative_to(root).as_posix()
            metadata = path.lstat()
            link_target = os.readlink(path) if stat.S_ISLNK(metadata.st_mode) else None
            nodes.append((relative, metadata, link_target))
            if name in directory_names and not stat.S_ISLNK(metadata.st_mode):
                retained_directories.append(name)
        directory_names[:] = sorted(retained_directories)
    return sorted(nodes, key=lambda item: item[0])


def tree_identity(nodes: Iterable[tuple[str, os.stat_result, str | None]]) -> list[list[Any]]:
    return [
        [
            relative,
            metadata.st_dev,
            metadata.st_ino,
            metadata.st_mode,
            metadata.st_nlink,
            metadata.st_size,
            metadata.st_mtime_ns,
            metadata.st_ctime_ns,
            target,
        ]
        for relative, metadata, target in nodes
    ]


def resolved_link_receipt(path: Path, relative: str, target: str) -> Mapping[str, Any]:
    resolved = path.resolve(strict=True)
    metadata = resolved.stat(follow_symlinks=False)
    if stat.S_ISREG(metadata.st_mode):
        size, _mode, _links, digest = stable_file(resolved)
        return {
            "relativePath": relative,
            "target": target,
            "resolvedWslPath": str(resolved),
            "resolvedType": "file",
            "resolvedSizeBytes": size,
            "resolvedSha256": digest,
        }
    if stat.S_ISDIR(metadata.st_mode):
        raise RuntimeError(
            f"Directory symlinks are prohibited because their contents would escape the exhaustive file inventory: {path}"
        )
    raise RuntimeError(f"Symbolic link resolves to unsupported node type: {path}")


def directory_inventory(host_root: str, wsl_root: Path) -> Mapping[str, Any]:
    before = tree_nodes(wsl_root)
    files: list[Mapping[str, Any]] = []
    symlinks: list[Mapping[str, Any]] = []
    for relative, metadata, target in before:
        path = wsl_root / PurePosixPath(relative)
        if stat.S_ISDIR(metadata.st_mode):
            continue
        if stat.S_ISLNK(metadata.st_mode):
            if target is None:
                raise RuntimeError(f"Missing link target for {path}")
            symlinks.append(resolved_link_receipt(path, relative, target))
            continue
        if not stat.S_ISREG(metadata.st_mode):
            raise RuntimeError(f"Inventory contains an unsupported special node: {path}")
        size, mode, link_count, digest = stable_file(path)
        files.append(
            {
                "relativePath": relative,
                "sizeBytes": size,
                "mode": mode,
                "linkCount": link_count,
                "sha256": digest,
            }
        )
    after = tree_nodes(wsl_root)
    if tree_identity(before) != tree_identity(after):
        raise RuntimeError(f"Directory tree raced while sealing: {wsl_root}")
    material = {"files": files, "symlinks": symlinks}
    return {
        "hostRoot": host_root,
        "wslRoot": str(wsl_root),
        "totalFileBytes": sum(int(item["sizeBytes"]) for item in files),
        "fileCount": len(files),
        "files": files,
        "symlinks": symlinks,
        "inventorySha256": domain_digest(
            "VENVIEWER_GRAND_HALL_DIFIX_DIRECTORY_INVENTORY_V1", material
        ),
    }


def interpreter_chain(venv_python: Path) -> list[Mapping[str, Any]]:
    chain: list[Mapping[str, Any]] = []
    path = require_absolute_wsl(venv_python)
    seen: set[str] = set()
    for _index in range(32):
        normalized = str(path.absolute())
        if normalized in seen:
            raise RuntimeError("Interpreter symlink chain contains a cycle.")
        seen.add(normalized)
        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            target = os.readlink(path)
            chain.append(
                {
                    "wslPath": normalized,
                    "nodeType": "symlink",
                    "target": target,
                    "sizeBytes": metadata.st_size,
                    "sha256": None,
                }
            )
            path = (path.parent / target).absolute() if not target.startswith("/") else Path(target)
            continue
        if stat.S_ISREG(metadata.st_mode):
            size, _mode, _links, digest = stable_file(path)
            chain.append(
                {
                    "wslPath": normalized,
                    "nodeType": "file",
                    "target": None,
                    "sizeBytes": size,
                    "sha256": digest,
                }
            )
            return chain
        raise RuntimeError(f"Interpreter chain contains unsupported node: {path}")
    raise RuntimeError("Interpreter symlink chain exceeds 32 nodes.")


def create_only_json(path: Path, value: Mapping[str, Any]) -> None:
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    try:
        raw = (canonical_json(value) + "\n").encode("utf-8")
        offset = 0
        while offset < len(raw):
            offset += os.write(descriptor, raw[offset:])
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def runtime_payload(args: argparse.Namespace, existing: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
    if str(args.trusted_verifier_python_wsl) != "/usr/bin/python3":
        raise RuntimeError("Trusted verifier must be the pinned system /usr/bin/python3 interpreter.")
    created_at = existing["createdAt"] if existing is not None else args.created_at
    runtime_id = existing["runtimeId"] if existing is not None else args.runtime_id
    provider_source_tree = directory_inventory(args.source_host, args.source_wsl)
    source_archive = direct_file_receipt(args.source_archive_host, args.source_archive_wsl)
    pipeline = next(
        (entry for entry in provider_source_tree["files"] if entry["relativePath"] == "src/pipeline_difix.py"),
        None,
    )
    if pipeline is None or pipeline["sizeBytes"] != 56_400 or pipeline["sha256"] != "sha256:2f73e2708b3f9ce560800163554f869e5e43e3a42049f67da3609f7736cbab3a":
        raise RuntimeError("Provider source tree does not contain the exact pinned pipeline_difix.py.")
    if source_archive["sizeBytes"] != 6_041_600 or source_archive["sha256"] != "sha256:01b1cd73b67b2b8e6003860295f465b4a3a46f705032c599bfe02b33e6d66a80":
        raise RuntimeError("Provider source archive does not match the audited deterministic archive.")
    return {
        "schemaVersion": RUNTIME_SCHEMA,
        "runtimeId": runtime_id,
        "createdAt": created_at,
        "providerRepositoryId": PROVIDER_ID,
        "providerRevision": PROVIDER_REVISION,
        "venv": directory_inventory(args.venv_host, args.venv_wsl),
        "trustedVerifierInterpreterChain": interpreter_chain(
            args.trusted_verifier_python_wsl
        ),
        "externalInterpreterChain": interpreter_chain(args.venv_python_wsl),
        "providerSourceTree": provider_source_tree,
        "sourceArchive": source_archive,
        "wheelhouse": directory_inventory(args.wheelhouse_host, args.wheelhouse_wsl),
        "wheelHashInventory": direct_file_receipt(args.wheel_hashes_host, args.wheel_hashes_wsl),
        "pipFreeze": direct_file_receipt(args.pip_freeze_host, args.pip_freeze_wsl),
        "networkAcquisitionComplete": True,
        "sealedForOfflineExecution": True,
    }


def model_payload(args: argparse.Namespace, existing: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
    created_at = existing["createdAt"] if existing is not None else args.created_at
    snapshot = directory_inventory(args.snapshot_host, args.snapshot_wsl)
    files = {entry["relativePath"]: entry for entry in snapshot["files"]}
    for expected in EXACT_LOAD_CLOSURE:
        actual = files.get(expected["relativePath"])
        if (
            actual is None
            or actual["sizeBytes"] != expected["sizeBytes"]
            or actual["sha256"] != expected["sha256"]
            or actual["linkCount"] != 1
        ):
            raise RuntimeError(
                f"Model snapshot does not contain direct exact load-closure file {expected['relativePath']}."
            )
    for expected in EXACT_WEIGHTS:
        actual = files.get(expected["relativePath"])
        if actual is None or actual["sizeBytes"] != expected["sizeBytes"] or actual["sha256"] != expected["sha256"]:
            raise RuntimeError(f"Model snapshot does not contain exact weight {expected['relativePath']}.")
    for relative, digest in {
        "SNAPSHOT-MANIFEST.json": "sha256:6d3d3d8155b03b3021deb1597eb70355dfff2281ba4e526920ec7b1c12f2aea9",
        "SHA256SUMS": "sha256:eeb786cee49b2e611b29a685411f92ab431eec98985ce93eb366ee1cd94e7298",
        "model_index.json": "sha256:0b4316574ae102b3855c4508a13becc81b353f6455dafa6186ac37d82c8292b9",
    }.items():
        if files.get(relative, {}).get("sha256") != digest:
            raise RuntimeError(f"Model snapshot evidence mismatch for {relative}.")
    return {
        "schemaVersion": MODEL_SCHEMA,
        "modelId": MODEL_ID,
        "revision": MODEL_REVISION,
        "createdAt": created_at,
        "snapshot": snapshot,
        "localFilesOnly": True,
        "auditedSnapshotManifestSha256": "sha256:6d3d3d8155b03b3021deb1597eb70355dfff2281ba4e526920ec7b1c12f2aea9",
        "auditedSha256SumsSha256": "sha256:eeb786cee49b2e611b29a685411f92ab431eec98985ce93eb366ee1cd94e7298",
        "auditedAcquisitionReceiptSha256": "sha256:6f05ac17c461cb55568e05ea51983a943715a640903340377227ac3c615fdea4",
        "modelIndexSha256": "sha256:0b4316574ae102b3855c4508a13becc81b353f6455dafa6186ac37d82c8292b9",
        "expectedWeightFiles": EXACT_WEIGHTS,
        "expectedLoadClosureFiles": EXACT_LOAD_CLOSURE,
    }


def load_object(path: Path) -> Mapping[str, Any]:
    parsed = json.loads(path.read_bytes())
    if not isinstance(parsed, dict):
        raise RuntimeError("Seal must be a JSON object.")
    return parsed


def seal_runtime(args: argparse.Namespace) -> int:
    payload = runtime_payload(args)
    value = dict(payload)
    value["runtimeSealSha256"] = domain_digest(
        "VENVIEWER_GRAND_HALL_DIFIX_RUNTIME_SEAL_V1", payload
    )
    create_only_json(args.output, value)
    sys.stdout.write(canonical_json({"state": "runtime_sealed", "runtimeSealSha256": value["runtimeSealSha256"]}) + "\n")
    return 0


def check_runtime(args: argparse.Namespace) -> int:
    expected = load_object(args.manifest)
    payload = runtime_payload(args, expected)
    actual = dict(payload)
    actual["runtimeSealSha256"] = domain_digest(
        "VENVIEWER_GRAND_HALL_DIFIX_RUNTIME_SEAL_V1", payload
    )
    if canonical_json(actual) != canonical_json(expected):
        raise RuntimeError("Runtime seal no longer matches the exact runtime/source/wheel inventory.")
    sys.stdout.write(canonical_json({"state": "runtime_checked", "runtimeSealSha256": actual["runtimeSealSha256"]}) + "\n")
    return 0


def seal_model(args: argparse.Namespace) -> int:
    payload = model_payload(args)
    value = dict(payload)
    value["modelSealSha256"] = domain_digest(
        "VENVIEWER_GRAND_HALL_DIFIX_MODEL_SEAL_V1", payload
    )
    create_only_json(args.output, value)
    sys.stdout.write(canonical_json({"state": "model_sealed", "modelSealSha256": value["modelSealSha256"]}) + "\n")
    return 0


def check_model(args: argparse.Namespace) -> int:
    expected = load_object(args.manifest)
    payload = model_payload(args, expected)
    actual = dict(payload)
    actual["modelSealSha256"] = domain_digest(
        "VENVIEWER_GRAND_HALL_DIFIX_MODEL_SEAL_V1", payload
    )
    if canonical_json(actual) != canonical_json(expected):
        raise RuntimeError("Model seal no longer matches the exact local snapshot.")
    sys.stdout.write(canonical_json({"state": "model_checked", "modelSealSha256": actual["modelSealSha256"]}) + "\n")
    return 0


def add_runtime_paths(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--venv-host", required=True)
    parser.add_argument("--venv-wsl", type=Path, required=True)
    parser.add_argument("--venv-python-wsl", type=Path, required=True)
    parser.add_argument("--trusted-verifier-python-wsl", type=Path, required=True)
    parser.add_argument("--source-host", required=True)
    parser.add_argument("--source-wsl", type=Path, required=True)
    parser.add_argument("--source-archive-host", required=True)
    parser.add_argument("--source-archive-wsl", type=Path, required=True)
    parser.add_argument("--wheelhouse-host", required=True)
    parser.add_argument("--wheelhouse-wsl", type=Path, required=True)
    parser.add_argument("--wheel-hashes-host", required=True)
    parser.add_argument("--wheel-hashes-wsl", type=Path, required=True)
    parser.add_argument("--pip-freeze-host", required=True)
    parser.add_argument("--pip-freeze-wsl", type=Path, required=True)


def add_model_paths(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--snapshot-host", required=True)
    parser.add_argument("--snapshot-wsl", type=Path, required=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    runtime_seal = commands.add_parser("seal-runtime")
    runtime_seal.add_argument("--runtime-id", required=True)
    runtime_seal.add_argument("--created-at", required=True)
    add_runtime_paths(runtime_seal)
    runtime_seal.add_argument("--output", type=Path, required=True)
    runtime_check = commands.add_parser("check-runtime")
    add_runtime_paths(runtime_check)
    runtime_check.add_argument("--manifest", type=Path, required=True)
    model_seal = commands.add_parser("seal-model")
    model_seal.add_argument("--created-at", required=True)
    add_model_paths(model_seal)
    model_seal.add_argument("--output", type=Path, required=True)
    model_check = commands.add_parser("check-model")
    add_model_paths(model_check)
    model_check.add_argument("--manifest", type=Path, required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "seal-runtime":
        return seal_runtime(args)
    if args.command == "check-runtime":
        return check_runtime(args)
    if args.command == "seal-model":
        return seal_model(args)
    if args.command == "check-model":
        return check_model(args)
    raise RuntimeError("Unknown seal command.")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - top-level operator boundary
        sys.stderr.write(f"DIFIX_SEAL_FAILED:{type(error).__name__}:{error}\n")
        raise SystemExit(1) from None
