#!/usr/bin/env python3
"""Offline, create-only GSFixer-base adapter for one Grand Hall frame.

This adapter deliberately performs only the official GSFixer image-to-image
inference path.  It never edits the captured reconstruction and its result is
always labelled ``GENERATED_CINEMATIC`` with no captured or structural
authority.
"""

from __future__ import annotations

import argparse
import errno
import hashlib
import importlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import time
import types
from typing import Any, Final, Mapping, Sequence


SCHEMA_VERSION: Final = "venviewer.grand-hall.gsfixer-base-adapter.v1"
PROVIDER_ID: Final = "GSFix3D/GSFix3D"
PROVIDER_COMMIT: Final = "88b03c0230ceef58455cd0cb7eda4a58923cf4ab"
MODEL_ID: Final = "goldoak1421/gsfixer-base"
MODEL_COMMIT: Final = "10da3bf12c1c299d559a85572601f17054dd4d2a"
WIDTH: Final = 1024
HEIGHT: Final = 576
SEED: Final = 2025
DENOISING_STEPS: Final = 4
PROCESSING_RESOLUTION: Final = 768
GRAND_HALL_SOURCE_SHA256: Final = "22585a23b5ced06c652f838d894a02903c2c405107dd13eaeb0957754d30ec43"
INPUT_PACK_MANIFEST_SIZE: Final = 2_473
INPUT_PACK_MANIFEST_SHA256: Final = "570ef5b363417fd20fec966b0c7b3d4fdeac1fcfb8446deb0c0719036fe0a8da"
INPUT_PACK_PUBLICATION_RECEIPT_SIZE: Final = 1_975
INPUT_PACK_PUBLICATION_RECEIPT_SHA256: Final = "e34cd13eaccec1eec36da37f516ef9b889db5b930234ca35ddb237c30766b73a"
GOAL_FILE_SIZE: Final = 10_478
GOAL_FILE_SHA256: Final = "55c73c581d107f5e4578c3c40cb3d6d345341041cc94d61c2b4858c9618282cf"
OUTPUT_NAME: Final = "gsfixer-base-candidate.png"
STARTED_RECEIPT_NAME: Final = "started.json"
SUCCESS_RECEIPT_NAME: Final = "receipt.json"
FAILURE_RECEIPT_NAME: Final = "terminal-failure.json"
ADAPTER_PENDING_SUPERVISOR_STATUS: Final = (
    "adapter_succeeded_pending_supervisor_terminal"
)
TRUSTED_HOST_PROVENANCE_POSTURE: Final = "trusted_host_diagnostic_only"
SUPERVISOR_PROTOCOL: Final = "venviewer.grand-hall.gsfixer-supervisor.v2"
SUPERVISOR_REQUIRED_SEALS: Final = 15
SUPERVISED_PYTHON_PATH: Final = (
    "/mnt/f/venviewer-provider-cache/difix3d/"
    "c76edc595586e16732c91ddee82f3a6d83a8a9cc/"
    "runtime-py312-cu128-v1/venv/bin/python"
)
SUPERVISED_PYTHON_SYMLINK_TARGET: Final = "/usr/bin/python3"
SUPERVISED_PYTHON_SIZE: Final = 8_020_928
SUPERVISED_PYTHON_SHA256: Final = "1643dacd9feaedc58f3cc581e4d22577dfe25c09b10282936186ccf0f2e61118"
SUPERVISED_SITE_PACKAGES: Final = (
    "/mnt/f/venviewer-provider-cache/difix3d/"
    "c76edc595586e16732c91ddee82f3a6d83a8a9cc/"
    "runtime-py312-cu128-v1/venv/lib/python3.12/site-packages"
)
SUPERVISED_STDLIB_PATHS: Final = (
    "/usr/lib/python312.zip",
    "/usr/lib/python3.12",
    "/usr/lib/python3.12/lib-dynload",
)
RUNTIME_CLOSURE_DOMAIN: Final = b"VENVIEWER_GSFIXER_RUNTIME_CLOSURE_V1\0"
# These pins are generated with ``runtime_tree_receipt`` and intentionally bind
# every directory, regular file byte, and symlink target below site-packages.
RUNTIME_CLOSURE_DIRECTORY_COUNT: Final = 3_638
RUNTIME_CLOSURE_FILE_COUNT: Final = 34_179
RUNTIME_CLOSURE_SYMLINK_COUNT: Final = 0
RUNTIME_CLOSURE_TOTAL_FILE_BYTES: Final = 7_596_737_571
RUNTIME_CLOSURE_SHA256: Final = "7c8d7f1a118400d446d6eeda3ec153f0855fa51a98059fbc86171fa75734d9de"
RECEIPT_PARENT: Final = Path(
    "/mnt/f/venviewer-provider-cache/gsfix3d/supervisor-runs"
)
ATTEMPT_PARENT: Final = Path(
    "/mnt/f/venviewer-provider-cache/gsfix3d/runs"
)


SOURCE_CLOSURE: Final[Mapping[str, tuple[int, str]]] = {
    "LICENSES/Apache-2.0.txt": (
        10_173,
        "0cec06e0e55fbc3dc5cee4fca9b607f66cb8f4e4dbcf3b3c013594dd156732e9",
    ),
    "LICENSES/Gaussian-Splatting-License.md": (
        4_274,
        "c2297cb5b2dd996979a6031ae7c5e112be310f87595c1dc40340be820e0d67e5",
    ),
    "LICENSES/LICENSE-MODEL.txt": (
        10_977,
        "c6eb688db91701503e4378447f33a0bb23b05b9d7eae7e26bfe8153d49327b3e",
    ),
    "README.md": (
        13_968,
        "168c2ff3efd5cb793160d93cbbc36cd86355aee2a4dd8ca4b5d95d3985348537",
    ),
    "marigold/__init__.py": (
        1_663,
        "e19b935eb76b0de16276ab575b50a0eed7eee7cc7f79e735b20c10b2b46f6f29",
    ),
    "marigold/marigold_gsfixer_pipeline.py": (
        21_787,
        "96d9cf7f193ff7e851a6961a4e6113e4432bd82a3590f008b772b5dce1035b14",
    ),
    "marigold/util/batchsize.py": (
        3_874,
        "e2e5d27da9bb3db2d77e9137eb1e1aae91b1f1988d6d5378a4aa46d40099992d",
    ),
    "marigold/util/image_util.py": (
        5_111,
        "4c64fcfcc3206d9375ab62cb4cb8837117a6c40653544b5e0d525f5437426dcb",
    ),
}

SOURCE_CODE_PATHS: Final = (
    "marigold/__init__.py",
    "marigold/marigold_gsfixer_pipeline.py",
    "marigold/util/batchsize.py",
    "marigold/util/image_util.py",
)


MODEL_CLOSURE: Final[Mapping[str, tuple[int, str]]] = {
    ".gitattributes": (
        1_554,
        "88023d0a029a0c409b30c03b689c68605b559f5cefe06376e4a26b38ed795269",
    ),
    "README.md": (
        2_823,
        "2e3b4c0a50f52e76adf5db5a0a41991dbf987a99385b2a8052d98231bc95138b",
    ),
    "model_index.json": (
        479,
        "224715bbe34a6a0bbf37beb268c91611e12896ed1d756e5ed1af5ba75372e0cb",
    ),
    "scheduler/scheduler_config.json": (
        553,
        "c85a30a192523b7b681c9093b934f8471806d428d3722ebbe8a8cf59f32d01a1",
    ),
    "text_encoder/config.json": (
        658,
        "e61e3fa7566aead9a1051949c1db6336933d854900d412b92164bcdc91ad9c5f",
    ),
    "text_encoder/model.safetensors": (
        1_361_597_018,
        "cce6febb0b6d876ee5eb24af35e27e764eb4f9b1d0b7c026c8c3333d4cfc916c",
    ),
    "tokenizer/merges.txt": (
        573_514,
        "0bc7695944744789d6fd6d0ab754bcbbb9e36f1c182df0a006d619ce70a1e052",
    ),
    "tokenizer/special_tokens_map.json": (
        484,
        "a83f5831a70d1d21c057186d35aaa504894103d24ee905baa99bc7e83ceb70ee",
    ),
    "tokenizer/tokenizer_config.json": (
        858,
        "94087ffb39b7b404b877c5d8719d4c5e3bd3cd92e89b8e7a600eaee1744e1929",
    ),
    "tokenizer/vocab.json": (
        1_109_372,
        "fd67774a869730a6b27bf53d3e434e72054f2a825873c7af3bece183bb1f791e",
    ),
    "unet/config.json": (
        1_985,
        "3a5de8a063f4eba83cdd779dde4eeb19983eaead42f0609bba8523cad83c5951",
    ),
    "unet/diffusion_pytorch_model.safetensors": (
        3_463_772_592,
        "c9d5901413231caa38115a907cdcb54dacf35cb16333bb83f3b5877b74b3b9f8",
    ),
    "vae/config.json": (
        641,
        "75ecccb13ea7ada0e906072b34d673ef8b57d614f03aac57a2abb5865c499437",
    ),
    "vae/diffusion_pytorch_model.safetensors": (
        334_643_276,
        "a1d993488569e928462932c8c38a0760b874d166399b14414135bd9c42df5815",
    ),
}


EXPECTED_MODEL_INDEX: Final[Mapping[str, Any]] = {
    "_class_name": "MarigoldGSFixerPipeline",
    "_diffusers_version": "0.25.0",
    "default_denoising_steps": 4,
    "default_processing_resolution": 768,
    "scheduler": ["diffusers", "DDIMScheduler"],
    "text_encoder": ["transformers", "CLIPTextModel"],
    "tokenizer": ["transformers", "CLIPTokenizer"],
    "unet": ["diffusers", "UNet2DConditionModel"],
    "vae": ["diffusers", "AutoencoderKL"],
}


class AdapterError(RuntimeError):
    """A fail-closed adapter validation or execution error."""


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def sha256_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def domain_digest(domain: str, payload: Any) -> str:
    return sha256_bytes((domain + "\n" + canonical_json(payload)).encode("utf-8"))


def supervisor_argv_digest(values: Sequence[str]) -> str:
    digest = hashlib.sha256(b"VENVIEWER_GSFIXER_ADAPTER_ARGV_V1\0")
    for value in values:
        payload = value.encode("utf-8")
        digest.update(len(payload).to_bytes(8, byteorder="big", signed=False))
        digest.update(payload)
    return f"sha256:{digest.hexdigest()}"


def normalized_sha256(value: str, label: str) -> str:
    candidate = value.removeprefix("sha256:").lower()
    if len(candidate) != 64 or any(character not in "0123456789abcdef" for character in candidate):
        raise AdapterError(f"{label} must be an exact SHA-256 digest.")
    return candidate


def exact_absolute_path(value: str, label: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        raise AdapterError(f"{label} must be absolute.")
    return path


def _regular_file_metadata(path: Path, label: str) -> os.stat_result:
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise AdapterError(f"{label} is missing: {path}") from error
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
        raise AdapterError(f"{label} must be a direct regular file: {path}")
    return metadata


def _stable_file_identity(metadata: os.stat_result) -> tuple[int, ...]:
    identity = (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_size,
        metadata.st_mtime_ns,
    )
    if sys.platform == "linux":
        return (*identity, metadata.st_ctime_ns)
    return identity


def stable_file_receipt(
    path: Path,
    label: str,
    expected_size: int | None = None,
    expected_sha256: str | None = None,
) -> Mapping[str, Any]:
    before = _regular_file_metadata(path, label)
    if expected_size is not None and before.st_size != expected_size:
        raise AdapterError(
            f"{label} size mismatch: expected {expected_size}, observed {before.st_size}."
        )
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise AdapterError(f"Could not open {label} without following links: {path}") from error
    digest = hashlib.sha256()
    try:
        opened = os.fstat(descriptor)
        opened_identity = _stable_file_identity(opened)
        before_identity = _stable_file_identity(before)
        if not stat.S_ISREG(opened.st_mode) or opened_identity != before_identity:
            raise AdapterError(f"{label} changed while it was opened: {path}")
        while True:
            chunk = os.read(descriptor, 8 * 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
        closed_identity = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    after = _regular_file_metadata(path, label)
    after_identity = _stable_file_identity(after)
    descriptor_identity = _stable_file_identity(closed_identity)
    if before_identity != descriptor_identity or before_identity != after_identity:
        raise AdapterError(f"{label} changed while it was hashed: {path}")
    observed = digest.hexdigest()
    if expected_sha256 is not None and observed != normalized_sha256(expected_sha256, label):
        raise AdapterError(
            f"{label} SHA-256 mismatch: expected {expected_sha256}, observed sha256:{observed}."
        )
    return {
        "path": str(path),
        "sha256": f"sha256:{observed}",
        "sizeBytes": after.st_size,
    }


def _update_length_prefixed(digest: Any, payload: bytes) -> None:
    digest.update(len(payload).to_bytes(8, byteorder="big", signed=False))
    digest.update(payload)


def runtime_tree_receipt(root: Path, label: str) -> Mapping[str, Any]:
    """Hash a complete runtime tree without importing code from that tree."""

    if not root.is_absolute():
        raise AdapterError(f"{label} must be absolute.")
    try:
        root_before = root.lstat()
    except OSError as error:
        raise AdapterError(f"Could not inspect {label}: {root}") from error
    if not stat.S_ISDIR(root_before.st_mode) or root.is_symlink():
        raise AdapterError(f"{label} must be a direct directory: {root}")
    if root.resolve(strict=True) != root:
        raise AdapterError(f"{label} must not traverse aliases or symlinked parents: {root}")

    closure = hashlib.sha256(RUNTIME_CLOSURE_DOMAIN)
    directory_count = 1
    file_count = 0
    symlink_count = 0
    total_file_bytes = 0
    for current_text, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
        directory_names.sort()
        file_names.sort()
        current = Path(current_text)
        for name in tuple(directory_names):
            member = current / name
            metadata = member.lstat()
            relative = member.relative_to(root).as_posix().encode("utf-8")
            if stat.S_ISLNK(metadata.st_mode):
                target = os.readlink(member).encode("utf-8")
                closure.update(b"L")
                _update_length_prefixed(closure, relative)
                _update_length_prefixed(closure, target)
                symlink_count += 1
                # os.walk must not recurse into a directory symlink.
                directory_names.remove(name)
            elif stat.S_ISDIR(metadata.st_mode):
                closure.update(b"D")
                _update_length_prefixed(closure, relative)
                directory_count += 1
            else:
                raise AdapterError(f"{label} contains an unsupported directory entry: {member}")
        for name in file_names:
            member = current / name
            metadata = member.lstat()
            relative = member.relative_to(root).as_posix().encode("utf-8")
            if stat.S_ISLNK(metadata.st_mode):
                target = os.readlink(member).encode("utf-8")
                closure.update(b"L")
                _update_length_prefixed(closure, relative)
                _update_length_prefixed(closure, target)
                symlink_count += 1
                continue
            if not stat.S_ISREG(metadata.st_mode):
                raise AdapterError(f"{label} contains a non-regular member: {member}")
            receipt = stable_file_receipt(member, f"{label} member {relative.decode('utf-8')}")
            member_digest = bytes.fromhex(str(receipt["sha256"]).removeprefix("sha256:"))
            member_size = int(receipt["sizeBytes"])
            closure.update(b"F")
            _update_length_prefixed(closure, relative)
            closure.update(member_size.to_bytes(8, byteorder="big", signed=False))
            closure.update(member_digest)
            file_count += 1
            total_file_bytes += member_size

    root_after = root.lstat()
    root_before_identity = (
        root_before.st_dev,
        root_before.st_ino,
        root_before.st_mtime_ns,
        root_before.st_ctime_ns,
    )
    root_after_identity = (
        root_after.st_dev,
        root_after.st_ino,
        root_after.st_mtime_ns,
        root_after.st_ctime_ns,
    )
    if root_before_identity != root_after_identity:
        raise AdapterError(f"{label} root changed while its closure was measured.")
    return {
        "path": str(root),
        "directoryCount": directory_count,
        "fileCount": file_count,
        "symlinkCount": symlink_count,
        "totalFileBytes": total_file_bytes,
        "sha256": f"sha256:{closure.hexdigest()}",
    }


def verify_runtime_closure() -> Mapping[str, Any]:
    root = Path(SUPERVISED_SITE_PACKAGES)
    receipt = runtime_tree_receipt(root, "supervised Python dependency closure")
    expected = {
        "path": SUPERVISED_SITE_PACKAGES,
        "directoryCount": RUNTIME_CLOSURE_DIRECTORY_COUNT,
        "fileCount": RUNTIME_CLOSURE_FILE_COUNT,
        "symlinkCount": RUNTIME_CLOSURE_SYMLINK_COUNT,
        "totalFileBytes": RUNTIME_CLOSURE_TOTAL_FILE_BYTES,
        "sha256": f"sha256:{RUNTIME_CLOSURE_SHA256}",
    }
    if receipt != expected:
        raise AdapterError("Supervised Python dependency bytes disagree with the audited closure pin.")
    return receipt


def verify_and_activate_runtime_closure() -> Mapping[str, Any]:
    receipt = verify_runtime_closure()
    if any(
        name in sys.modules
        for name in ("sitecustomize", "usercustomize", "_cuda_bindings_redirector", "_distutils_hack")
    ):
        raise AdapterError("A forbidden ambient startup hook was loaded before runtime attestation.")
    if SUPERVISED_SITE_PACKAGES in sys.path:
        raise AdapterError("Supervised site-packages was ambiently active before runtime attestation.")
    sys.path.insert(0, SUPERVISED_SITE_PACKAGES)
    return receipt


def stable_read_bytes(
    path: Path,
    label: str,
    expected_size: int,
    expected_sha256: str,
) -> tuple[bytes, Mapping[str, Any]]:
    before = _regular_file_metadata(path, label)
    if before.st_size != expected_size:
        raise AdapterError(
            f"{label} size mismatch: expected {expected_size}, observed {before.st_size}."
        )
    with path.open("rb", buffering=0) as source:
        payload = source.read()
    after = _regular_file_metadata(path, label)
    before_identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    after_identity = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
    if before_identity != after_identity or len(payload) != expected_size:
        raise AdapterError(f"{label} changed while it was read: {path}")
    observed = hashlib.sha256(payload).hexdigest()
    expected = normalized_sha256(expected_sha256, label)
    if observed != expected:
        raise AdapterError(
            f"{label} SHA-256 mismatch: expected sha256:{expected}, observed sha256:{observed}."
        )
    return payload, {
        "path": str(path),
        "sha256": f"sha256:{observed}",
        "sizeBytes": len(payload),
    }


def verify_closure(
    root: Path,
    expected: Mapping[str, tuple[int, str]],
    label: str,
) -> Sequence[Mapping[str, Any]]:
    if not root.is_absolute() or not root.is_dir() or root.is_symlink():
        raise AdapterError(f"{label} root must be an existing direct absolute directory: {root}")
    receipts: list[Mapping[str, Any]] = []
    for relative_path in sorted(expected):
        size, digest = expected[relative_path]
        receipt = stable_file_receipt(
            root / Path(relative_path),
            f"{label} member {relative_path}",
            size,
            digest,
        )
        receipts.append(
            {
                "relativePath": relative_path,
                "sha256": receipt["sha256"],
                "sizeBytes": receipt["sizeBytes"],
            }
        )
    return tuple(receipts)


def git_head(root: Path, expected_commit: str, label: str) -> str:
    environment = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_LFS_SKIP_SMUDGE": "1",
    }
    try:
        result = subprocess.run(
            ["/usr/bin/git", "-C", str(root), "rev-parse", "HEAD"],
            check=True,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=10,
            env=environment,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise AdapterError(f"Could not verify {label} Git identity.") from error
    observed = result.stdout.strip().lower()
    if observed != expected_commit:
        raise AdapterError(
            f"{label} commit mismatch: expected {expected_commit}, observed {observed}."
        )
    return observed


def read_exact_json(path: Path, label: str) -> Any:
    payload, _ = stable_read_bytes(
        path,
        label,
        MODEL_CLOSURE["model_index.json"][0],
        MODEL_CLOSURE["model_index.json"][1],
    )
    return exact_json_payload(payload, label)


def verify_model_index(model_root: Path) -> None:
    observed = read_exact_json(model_root / "model_index.json", "GSFixer model index")
    if observed != EXPECTED_MODEL_INDEX:
        raise AdapterError("GSFixer model_index.json does not match the audited base pipeline contract.")


def require_isolated_runtime() -> None:
    if sys.flags.isolated != 1 or sys.flags.ignore_environment != 1:
        raise AdapterError("Adapter requires Python isolated mode (-I).")
    if not sys.dont_write_bytecode:
        raise AdapterError("Adapter requires bytecode writes disabled (-B).")
    if sys.flags.no_site != 1:
        raise AdapterError("Adapter requires automatic site initialisation disabled (-S).")
    if tuple(sys.path) != SUPERVISED_STDLIB_PATHS:
        raise AdapterError(
            "Adapter startup path contains code outside the audited system standard library."
        )
    forbidden_environment = (
        "LD_AUDIT",
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "PYTHONHOME",
        "PYTHONPATH",
        "HF_TOKEN",
        "HUGGING_FACE_HUB_TOKEN",
    )
    if any(name in os.environ for name in forbidden_environment):
        raise AdapterError("Supervisor child environment retained a forbidden ambient loader or token value.")
    expected = {
        "CUBLAS_WORKSPACE_CONFIG": ":4096:8",
        "DIFFUSERS_OFFLINE": "1",
        "HF_DATASETS_OFFLINE": "1",
        "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1",
        "HF_HUB_DISABLE_TELEMETRY": "1",
        "HF_HUB_OFFLINE": "1",
        "PIP_NO_INDEX": "1",
        "TRANSFORMERS_OFFLINE": "1",
    }
    for name, value in expected.items():
        if os.environ.get(name) != value:
            raise AdapterError(f"Required offline runtime binding is missing for {name}.")
    fixed_environment = {
        "HOME": "/nonexistent",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/wsl/lib",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONHASHSEED": "0",
        "PYTHONNOUSERSITE": "1",
        "TMPDIR": "/tmp",
        "TZ": "UTC",
    }
    for name, value in fixed_environment.items():
        if os.environ.get(name) != value:
            raise AdapterError(f"Required fixed child environment is missing for {name}.")
    dynamic_environment = {
        "VENVIEWER_GSFIXER_ADAPTER_FD",
        "VENVIEWER_GSFIXER_ADAPTER_SHA256",
        "VENVIEWER_GSFIXER_ADAPTER_SIZE",
        "VENVIEWER_GSFIXER_ADAPTER_SOURCE_DEVICE",
        "VENVIEWER_GSFIXER_ADAPTER_SOURCE_INODE",
        "VENVIEWER_GSFIXER_ADAPTER_SOURCE_PATH",
        "VENVIEWER_GSFIXER_ATTEMPT_FD",
        "VENVIEWER_GSFIXER_ATTEMPT_PATH",
        "VENVIEWER_GSFIXER_COMPLETION_FD",
        "VENVIEWER_GSFIXER_COMPLETION_NONCE",
        "VENVIEWER_GSFIXER_COMPLETION_TAG",
        "VENVIEWER_GSFIXER_PYTHON_FD",
        "VENVIEWER_GSFIXER_RECEIPT_DEVICE",
        "VENVIEWER_GSFIXER_RECEIPT_FD",
        "VENVIEWER_GSFIXER_RECEIPT_INODE",
        "VENVIEWER_GSFIXER_RECEIPT_PATH",
        "VENVIEWER_GSFIXER_STARTED_RECEIPT_DIR",
        "VENVIEWER_GSFIXER_STARTED_RECEIPT_SHA256",
        "VENVIEWER_GSFIXER_STARTED_RECEIPT_SIZE",
        "VENVIEWER_GSFIXER_SUPERVISOR_PID",
        "VENVIEWER_GSFIXER_SUPERVISOR_PROTOCOL",
        "VENVIEWER_GSFIXER_SUPERVISOR_SHA256",
        "VENVIEWER_GSFIXER_SUPERVISOR_SIZE",
        "VENVIEWER_GSFIXER_SUPERVISOR_STATIC",
    }
    allowed_environment = set(expected) | set(fixed_environment) | dynamic_environment
    unexpected_environment = sorted(set(os.environ) - allowed_environment)
    if unexpected_environment:
        raise AdapterError(
            "Supervisor child environment contains unexpected names: "
            + ", ".join(unexpected_environment)
        )


def require_network_namespace() -> int:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.settimeout(1.0)
    try:
        result = probe.connect_ex(("1.1.1.1", 53))
    finally:
        probe.close()
    if result != errno.ENETUNREACH:
        raise AdapterError(
            f"No-network namespace expected ENETUNREACH ({errno.ENETUNREACH}), observed {result}."
        )
    return result


def package_versions() -> Mapping[str, str]:
    names = (
        "accelerate",
        "diffusers",
        "huggingface-hub",
        "numpy",
        "pillow",
        "safetensors",
        "torch",
        "torchvision",
        "transformers",
    )
    versions: dict[str, str] = {}
    for name in names:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = "not-installed"
    return dict(sorted(versions.items()))


def driver_version() -> str:
    try:
        result = subprocess.run(
            [
                "/usr/lib/wsl/lib/nvidia-smi",
                "--query-gpu=driver_version",
                "--format=csv,noheader",
            ],
            check=True,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=10,
            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise AdapterError("Could not obtain the NVIDIA driver version.") from error
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if len(lines) != 1:
        raise AdapterError("Expected exactly one visible NVIDIA GPU driver version.")
    return lines[0]


def configure_determinism(torch: Any) -> None:
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.set_float32_matmul_precision("highest")
    torch.manual_seed(SEED)
    torch.cuda.manual_seed_all(SEED)
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()


def install_unused_matplotlib_import_shim() -> None:
    """Satisfy upstream's unused depth-colour helper import without a new wheel.

    GSFixer RGB inference never calls ``colorize_depth_maps``.  Any accidental
    attempt to use the shim therefore fails instead of silently emulating
    matplotlib behaviour.
    """

    class UnavailableColormaps:
        def __getitem__(self, name: str) -> Any:
            raise AdapterError(
                f"The GSFixer RGB-only lane forbids upstream's optional matplotlib colormap {name!r}."
            )

    module = types.ModuleType("matplotlib")
    module.__file__ = "<venviewer-gsfixer-unused-matplotlib-shim>"
    module.colormaps = UnavailableColormaps()  # type: ignore[attr-defined]
    sys.modules["matplotlib"] = module


def exact_source_image(path: Path) -> tuple[Any, Mapping[str, Any]]:
    payload, receipt = stable_read_bytes(
        path,
        "Grand Hall source render",
        959_672,
        GRAND_HALL_SOURCE_SHA256,
    )
    image_module = importlib.import_module("PIL.Image")
    image = image_module.open(io.BytesIO(payload))
    image.load()
    if image.format != "PNG" or image.mode != "RGB" or image.size != (WIDTH, HEIGHT):
        raise AdapterError(
            f"Source must be exact RGB8 PNG {WIDTH}x{HEIGHT}; observed "
            f"format={image.format!r}, mode={image.mode!r}, size={image.size!r}."
        )
    return image, receipt


def supervised_parent_descriptor(parent: Path) -> int | None:
    if parent.parent != Path("/proc/self/fd") or not parent.name.isdecimal():
        return None
    descriptor = int(parent.name, 10)
    expected_descriptor = os.environ.get("VENVIEWER_GSFIXER_ATTEMPT_FD")
    expected_path = os.environ.get("VENVIEWER_GSFIXER_ATTEMPT_PATH")
    if expected_descriptor != str(descriptor) or expected_path is None:
        raise AdapterError("Attempt procfs parent is not the exact supervisor-bound descriptor.")
    try:
        metadata = os.fstat(descriptor)
        target = os.readlink(parent)
    except OSError as error:
        raise AdapterError("Could not attest the supervisor-bound attempt descriptor.") from error
    if not stat.S_ISDIR(metadata.st_mode) or target != expected_path:
        raise AdapterError("Attempt procfs parent changed before create-only output.")
    return descriptor


def exclusive_write(path: Path, payload: bytes, label: str) -> Mapping[str, Any]:
    parent_descriptor = supervised_parent_descriptor(path.parent)
    if parent_descriptor is None and (path.parent.is_symlink() or not path.parent.is_dir()):
        raise AdapterError(f"{label} parent must be a direct directory.")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    created = False
    try:
        descriptor = os.open(
            path.name if parent_descriptor is not None else path,
            flags,
            0o600,
            dir_fd=parent_descriptor,
        )
        created = True
    except FileExistsError as error:
        raise AdapterError(f"{label} is create-only and already exists: {path}") from error
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as target:
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
        return stable_file_receipt(path, label, len(payload), sha256_bytes(payload))
    except BaseException:
        if created:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        raise


def copy_exact_file(
    source: Path,
    destination: Path,
    label: str,
    expected_size: int,
    expected_sha256: str,
) -> Mapping[str, Any]:
    before = _regular_file_metadata(source, f"{label} source")
    if before.st_size != expected_size:
        raise AdapterError(
            f"{label} source size mismatch: expected {expected_size}, observed {before.st_size}."
        )
    source_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    target_flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0)
    )
    source_descriptor = os.open(source, source_flags)
    destination_descriptor: int | None = None
    created = False
    try:
        opened_before = os.fstat(source_descriptor)
        destination_descriptor = os.open(destination, target_flags, 0o400)
        created = True
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = os.read(source_descriptor, 8 * 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            total += len(chunk)
            offset = 0
            while offset < len(chunk):
                offset += os.write(destination_descriptor, chunk[offset:])
        os.fsync(destination_descriptor)
        opened_after = os.fstat(source_descriptor)
    except BaseException:
        if destination_descriptor is not None:
            os.close(destination_descriptor)
            destination_descriptor = None
        if created:
            try:
                destination.unlink(missing_ok=True)
            except OSError:
                pass
        raise
    finally:
        os.close(source_descriptor)
        if destination_descriptor is not None:
            os.close(destination_descriptor)
    after = _regular_file_metadata(source, f"{label} source")
    identity = lambda value: (
        value.st_dev,
        value.st_ino,
        value.st_size,
        value.st_mtime_ns,
    )
    observed_sha256 = digest.hexdigest()
    if (
        identity(before) != identity(opened_before)
        or identity(opened_before) != identity(opened_after)
        or identity(opened_after) != identity(after)
        or total != expected_size
        or observed_sha256 != normalized_sha256(expected_sha256, label)
    ):
        try:
            destination.unlink(missing_ok=True)
        except OSError:
            pass
        raise AdapterError(f"{label} source changed or disagreed with its exact closure during copy.")
    try:
        return stable_file_receipt(
            destination,
            label,
            expected_size,
            expected_sha256,
        )
    except BaseException:
        try:
            destination.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def write_canonical_receipt(path: Path, payload: Mapping[str, Any], label: str) -> Mapping[str, Any]:
    return exclusive_write(path, (canonical_json(payload) + "\n").encode("utf-8"), label)


def create_attempt_directory(path: Path) -> None:
    if not path.is_absolute():
        raise AdapterError("Attempt directory must be absolute.")
    parent = path.parent
    if not parent.is_dir() or parent.is_symlink():
        raise AdapterError("Attempt parent must already exist as a direct directory.")
    try:
        path.mkdir(mode=0o700, parents=False, exist_ok=False)
    except FileExistsError as error:
        raise AdapterError(f"Attempt directory is create-only and already exists: {path}") from error


def supervised_attempt_directory(
    declared: Path,
) -> tuple[Path, Mapping[str, Any]]:
    descriptor = _required_environment_integer("VENVIEWER_GSFIXER_ATTEMPT_FD", 3)
    environment_path = exact_absolute_path(
        _required_environment("VENVIEWER_GSFIXER_ATTEMPT_PATH"),
        "supervised attempt directory",
    )
    if environment_path != declared or declared.parent != ATTEMPT_PARENT:
        raise AdapterError("Supervised attempt path disagrees with the exact adapter command.")
    try:
        descriptor_metadata = os.fstat(descriptor)
        path_metadata = declared.lstat()
        descriptor_target = os.readlink(f"/proc/self/fd/{descriptor}")
    except OSError as error:
        raise AdapterError("Could not bind the supervisor-created attempt directory.") from error
    descriptor_identity = (
        descriptor_metadata.st_dev,
        descriptor_metadata.st_ino,
        descriptor_metadata.st_mode,
    )
    path_identity = (path_metadata.st_dev, path_metadata.st_ino, path_metadata.st_mode)
    if (
        not stat.S_ISDIR(descriptor_metadata.st_mode)
        or stat.S_ISLNK(path_metadata.st_mode)
        or descriptor_identity != path_identity
        or descriptor_target != str(declared)
        or declared.resolve(strict=True) != declared
    ):
        raise AdapterError("Supervisor-created attempt directory identity changed before use.")
    try:
        members = os.listdir(descriptor)
    except OSError as error:
        raise AdapterError("Could not inspect the supervisor-created attempt directory.") from error
    if members:
        raise AdapterError("Supervisor-created attempt directory was not empty at adapter start.")
    execution_root = Path(f"/proc/self/fd/{descriptor}")
    return execution_root, {
        "declaredPath": str(declared),
        "descriptor": descriptor,
        "descriptorTarget": descriptor_target,
        "device": descriptor_metadata.st_dev,
        "inode": descriptor_metadata.st_ino,
    }


def display_attempt_receipt(
    receipt: Mapping[str, Any],
    execution_root: Path,
    declared: Path,
) -> Mapping[str, Any]:
    require_supervised_attempt_stable(execution_root, declared)
    path = Path(str(receipt["path"]))
    if not path.is_relative_to(execution_root):
        raise AdapterError("Attempt output receipt escaped the supervised directory descriptor.")
    relative = path.relative_to(execution_root)
    return {**receipt, "path": str(declared / relative)}


def require_supervised_attempt_stable(execution_root: Path, declared: Path) -> None:
    try:
        descriptor = int(execution_root.name, 10)
        descriptor_metadata = os.fstat(descriptor)
        path_metadata = declared.lstat()
        descriptor_target = os.readlink(f"/proc/self/fd/{descriptor}")
    except (OSError, ValueError) as error:
        raise AdapterError("Could not re-attest the supervised attempt directory.") from error
    if (
        not stat.S_ISDIR(descriptor_metadata.st_mode)
        or stat.S_ISLNK(path_metadata.st_mode)
        or (descriptor_metadata.st_dev, descriptor_metadata.st_ino)
        != (path_metadata.st_dev, path_metadata.st_ino)
        or descriptor_target != str(declared)
        or declared.resolve(strict=True) != declared
    ):
        raise AdapterError("Supervised attempt directory changed before receipt publication.")


def supervised_receipt_directory() -> tuple[Path, Path, Mapping[str, Any]]:
    descriptor = _required_environment_integer("VENVIEWER_GSFIXER_RECEIPT_FD", 3)
    declared = exact_absolute_path(
        _required_environment("VENVIEWER_GSFIXER_RECEIPT_PATH"),
        "supervised receipt directory",
    )
    started_declared = exact_absolute_path(
        _required_environment("VENVIEWER_GSFIXER_STARTED_RECEIPT_DIR"),
        "GSFixer detached supervisor receipt directory",
    )
    if declared != started_declared or declared.parent != RECEIPT_PARENT:
        raise AdapterError("Supervised receipt path disagrees with the detached receipt binding.")
    try:
        descriptor_metadata = os.fstat(descriptor)
        path_metadata = declared.lstat()
        descriptor_target = os.readlink(f"/proc/self/fd/{descriptor}")
    except OSError as error:
        raise AdapterError("Could not bind the supervisor-created receipt directory.") from error
    expected_device = _required_environment_integer("VENVIEWER_GSFIXER_RECEIPT_DEVICE")
    expected_inode = _required_environment_integer("VENVIEWER_GSFIXER_RECEIPT_INODE")
    if (
        not stat.S_ISDIR(descriptor_metadata.st_mode)
        or stat.S_ISLNK(path_metadata.st_mode)
        or (descriptor_metadata.st_dev, descriptor_metadata.st_ino)
        != (path_metadata.st_dev, path_metadata.st_ino)
        or (descriptor_metadata.st_dev, descriptor_metadata.st_ino)
        != (expected_device, expected_inode)
        or descriptor_target != str(declared)
        or declared.resolve(strict=True) != declared
    ):
        raise AdapterError("Supervisor-created receipt directory identity changed before use.")
    execution_root = Path(f"/proc/self/fd/{descriptor}")
    return execution_root, declared, {
        "declaredPath": str(declared),
        "descriptor": descriptor,
        "descriptorTarget": descriptor_target,
        "device": descriptor_metadata.st_dev,
        "inode": descriptor_metadata.st_ino,
    }


def require_output_isolated(attempt: Path, protected_paths: Sequence[Path]) -> Path:
    parent = attempt.parent.resolve(strict=True)
    candidate = (parent / attempt.name).resolve(strict=False)
    if candidate.parent != parent or candidate.name in ("", ".", ".."):
        raise AdapterError("Attempt directory must be one new direct child of its existing parent.")
    for protected in protected_paths:
        resolved = protected.resolve(strict=True)
        if (
            candidate == resolved
            or candidate.is_relative_to(resolved)
            or resolved.is_relative_to(candidate)
        ):
            raise AdapterError(
                f"Attempt directory overlaps protected input material: {candidate} versus {resolved}."
            )
    return candidate


def exact_json_payload(payload: bytes, label: str) -> Mapping[str, Any]:
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise AdapterError(f"{label} must be valid UTF-8 JSON.") from error
    if not isinstance(parsed, dict):
        raise AdapterError(f"{label} must be a JSON object.")
    return parsed


def verify_input_lineage(
    input_path: Path,
    manifest_path: Path,
    publication_receipt_path: Path,
    goal_file_path: Path,
) -> tuple[Mapping[str, Any], Mapping[str, Any], Mapping[str, Any]]:
    manifest_bytes, manifest_receipt = stable_read_bytes(
        manifest_path,
        "Grand Hall source-pack manifest",
        INPUT_PACK_MANIFEST_SIZE,
        INPUT_PACK_MANIFEST_SHA256,
    )
    publication_bytes, publication_receipt = stable_read_bytes(
        publication_receipt_path,
        "Grand Hall source-pack publication receipt",
        INPUT_PACK_PUBLICATION_RECEIPT_SIZE,
        INPUT_PACK_PUBLICATION_RECEIPT_SHA256,
    )
    _, goal_receipt = stable_read_bytes(
        goal_file_path,
        "Grand Hall active goal",
        GOAL_FILE_SIZE,
        GOAL_FILE_SHA256,
    )
    if input_path.parent.resolve(strict=True) != manifest_path.parent.resolve(strict=True):
        raise AdapterError("Source render and source-pack manifest must be direct siblings.")
    if publication_receipt_path.parent.resolve(strict=True) != manifest_path.parent.resolve(strict=True):
        raise AdapterError("Source-pack publication receipt and manifest must be direct siblings.")
    manifest = exact_json_payload(manifest_bytes, "Grand Hall source-pack manifest")
    publication = exact_json_payload(publication_bytes, "Grand Hall source-pack publication receipt")
    expected_source = {
        "fileName": "source-render.png",
        "sha256": f"sha256:{GRAND_HALL_SOURCE_SHA256}",
        "sizeBytes": 959_672,
    }
    if manifest.get("roomRef") != "trades-hall/grand-hall" or manifest.get("sourceRender") != expected_source:
        raise AdapterError("Source-pack manifest does not bind the exact Grand Hall source render.")
    authority = manifest.get("authority")
    if not isinstance(authority, dict) or authority.get("authority") != "none":
        raise AdapterError("Source-pack manifest must retain its original authority-none posture.")
    expected_manifest = {
        "fileName": "manifest.authority-none.json",
        "sha256": f"sha256:{INPUT_PACK_MANIFEST_SHA256}",
        "sizeBytes": INPUT_PACK_MANIFEST_SIZE,
    }
    if publication.get("manifest") != expected_manifest or publication.get("authority") != "none":
        raise AdapterError("Source-pack publication receipt does not bind the exact authority-none manifest.")
    files = publication.get("filesBeforeReceipt")
    if not isinstance(files, list) or expected_source not in files:
        raise AdapterError("Source-pack publication receipt does not bind the exact source render.")
    return (
        {"manifest": manifest_receipt, "publicationReceipt": publication_receipt, "authority": authority},
        goal_receipt,
        manifest,
    )


def create_provider_source_snapshot(
    source_root: Path,
    attempt: Path,
) -> tuple[Path, Sequence[Mapping[str, Any]]]:
    snapshot = attempt / "provider-source"
    snapshot.mkdir(mode=0o700, parents=False, exist_ok=False)
    (snapshot / "marigold").mkdir(mode=0o700)
    (snapshot / "marigold" / "util").mkdir(mode=0o700)
    for relative_path in SOURCE_CODE_PATHS:
        size, digest = SOURCE_CLOSURE[relative_path]
        payload, _ = stable_read_bytes(
            source_root / relative_path,
            f"GSFix3D source snapshot member {relative_path}",
            size,
            digest,
        )
        exclusive_write(
            snapshot / relative_path,
            payload,
            f"GSFix3D private source snapshot member {relative_path}",
        )
    expected = {path: SOURCE_CLOSURE[path] for path in SOURCE_CODE_PATHS}
    return snapshot, verify_closure(snapshot, expected, "GSFix3D private source snapshot")


def create_model_execution_snapshot(
    model_root: Path,
    attempt: Path,
) -> tuple[Path, Sequence[Mapping[str, Any]]]:
    snapshot = attempt / "model-snapshot"
    snapshot.mkdir(mode=0o700, parents=False, exist_ok=False)
    for directory in ("scheduler", "text_encoder", "tokenizer", "unet", "vae"):
        (snapshot / directory).mkdir(mode=0o700)
    receipts: list[Mapping[str, Any]] = []
    for relative_path in sorted(MODEL_CLOSURE):
        source = model_root / relative_path
        destination = snapshot / relative_path
        size, digest = MODEL_CLOSURE[relative_path]
        receipt = copy_exact_file(
            source,
            destination,
            f"GSFixer private model snapshot member {relative_path}",
            size,
            digest,
        )
        receipts.append({
            "relativePath": relative_path,
            "sha256": receipt["sha256"],
            "sizeBytes": receipt["sizeBytes"],
        })
    return snapshot, tuple(receipts)


def require_exact_marigold_imports(snapshot_root: Path) -> Any:
    if any(name == "marigold" or name.startswith("marigold.") for name in sys.modules):
        raise AdapterError("Ambient or preloaded marigold modules are forbidden.")
    sys.path.insert(0, str(snapshot_root))
    try:
        module = importlib.import_module("marigold")
    finally:
        del sys.path[0]
    snapshot = snapshot_root.resolve(strict=True)
    for name, imported in tuple(sys.modules.items()):
        if name != "marigold" and not name.startswith("marigold."):
            continue
        file_name = getattr(imported, "__file__", None)
        if file_name is not None:
            if not Path(file_name).resolve(strict=True).is_relative_to(snapshot):
                raise AdapterError(f"Imported {name} from outside the private source snapshot.")
            continue
        package_paths = getattr(imported, "__path__", None)
        if package_paths is None or any(
            not Path(value).resolve(strict=True).is_relative_to(snapshot)
            for value in package_paths
        ):
            raise AdapterError(f"Namespace package {name} escaped the private source snapshot.")
    return module


def _required_environment(name: str) -> str:
    value = os.environ.get(name)
    if value is None or value == "":
        raise AdapterError(f"Missing supervisor binding environment value {name}.")
    return value


def _required_environment_integer(name: str, minimum: int = 0) -> int:
    value = _required_environment(name)
    try:
        parsed = int(value, 10)
    except ValueError as error:
        raise AdapterError(f"Supervisor binding value {name} must be an integer.") from error
    if str(parsed) != value or parsed < minimum:
        raise AdapterError(f"Supervisor binding value {name} is outside its exact bound.")
    return parsed


def _stable_descriptor_receipt(
    descriptor: int,
    label: str,
    expected_size: int,
    expected_sha256: str,
) -> Mapping[str, Any]:
    try:
        before = os.fstat(descriptor)
    except OSError as error:
        raise AdapterError(f"Could not inspect {label} descriptor.") from error
    if not stat.S_ISREG(before.st_mode) or before.st_size != expected_size:
        raise AdapterError(f"{label} descriptor is not the exact expected regular file.")
    digest = hashlib.sha256()
    offset = 0
    while offset < expected_size:
        try:
            chunk = os.pread(descriptor, min(8 * 1024 * 1024, expected_size - offset), offset)
        except OSError as error:
            raise AdapterError(f"Could not read {label} descriptor.") from error
        if not chunk:
            raise AdapterError(f"{label} descriptor yielded a short read.")
        digest.update(chunk)
        offset += len(chunk)
    try:
        after = os.fstat(descriptor)
    except OSError as error:
        raise AdapterError(f"Could not re-inspect {label} descriptor.") from error
    before_identity = (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
        before.st_ctime_ns,
    )
    after_identity = (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
        after.st_ctime_ns,
    )
    if before_identity != after_identity or digest.hexdigest() != normalized_sha256(expected_sha256, label):
        raise AdapterError(f"{label} descriptor changed or disagrees with its exact SHA-256.")
    return {
        "device": after.st_dev,
        "inode": after.st_ino,
        "sha256": f"sha256:{digest.hexdigest()}",
        "sizeBytes": after.st_size,
    }


def adapter_receipt() -> Mapping[str, Any]:
    if sys.platform != "linux" or not Path("/proc/self").is_dir():
        raise AdapterError("GSFixer adapter requires the audited Linux supervisor.")
    protocol = _required_environment("VENVIEWER_GSFIXER_SUPERVISOR_PROTOCOL")
    if protocol != SUPERVISOR_PROTOCOL:
        raise AdapterError("GSFixer supervisor protocol is not the exact audited version.")

    supervisor_pid = _required_environment_integer("VENVIEWER_GSFIXER_SUPERVISOR_PID", 1)
    if os.getppid() != supervisor_pid:
        raise AdapterError("GSFixer adapter parent is not the bound supervisor process.")
    supervisor_size = _required_environment_integer("VENVIEWER_GSFIXER_SUPERVISOR_SIZE", 1)
    supervisor_digest = normalized_sha256(
        _required_environment("VENVIEWER_GSFIXER_SUPERVISOR_SHA256"),
        "GSFixer supervisor environment digest",
    )
    if _required_environment("VENVIEWER_GSFIXER_SUPERVISOR_STATIC") != "1":
        raise AdapterError("GSFixer supervisor is not the externally allowlisted static trust root.")
    supervisor_executable = Path(f"/proc/{supervisor_pid}/exe")
    try:
        supervisor_descriptor = os.open(supervisor_executable, os.O_RDONLY | getattr(os, "O_CLOEXEC", 0))
    except OSError as error:
        raise AdapterError("Could not open the running supervisor executable through procfs.") from error
    try:
        supervisor_receipt = _stable_descriptor_receipt(
            supervisor_descriptor,
            "running GSFixer supervisor executable",
            supervisor_size,
            supervisor_digest,
        )
    finally:
        os.close(supervisor_descriptor)

    adapter_descriptor = _required_environment_integer("VENVIEWER_GSFIXER_ADAPTER_FD", 3)
    adapter_size = _required_environment_integer("VENVIEWER_GSFIXER_ADAPTER_SIZE", 1)
    adapter_digest = normalized_sha256(
        _required_environment("VENVIEWER_GSFIXER_ADAPTER_SHA256"),
        "sealed GSFixer adapter digest",
    )
    executed_receipt = _stable_descriptor_receipt(
        adapter_descriptor,
        "sealed GSFixer adapter execution image",
        adapter_size,
        adapter_digest,
    )
    try:
        import fcntl

        observed_seals = fcntl.fcntl(adapter_descriptor, 1034)
    except (ImportError, OSError) as error:
        raise AdapterError("Could not inspect the sealed adapter memory file.") from error
    if observed_seals != SUPERVISOR_REQUIRED_SEALS:
        raise AdapterError("Adapter execution memory file is not irrevocably sealed.")
    try:
        descriptor_target = os.readlink(f"/proc/self/fd/{adapter_descriptor}")
    except OSError as error:
        raise AdapterError("Could not resolve the sealed adapter descriptor through procfs.") from error
    if "memfd:venviewer-grand-hall-gsfixer-adapter" not in descriptor_target:
        raise AdapterError("Adapter execution descriptor is not the audited supervisor memfd.")

    python_descriptor = _required_environment_integer("VENVIEWER_GSFIXER_PYTHON_FD", 3)
    python_execution_receipt = _stable_descriptor_receipt(
        python_descriptor,
        "sealed supervised Python execution image",
        SUPERVISED_PYTHON_SIZE,
        SUPERVISED_PYTHON_SHA256,
    )
    try:
        python_seals = fcntl.fcntl(python_descriptor, 1034)
        python_descriptor_target = os.readlink(f"/proc/self/fd/{python_descriptor}")
    except OSError as error:
        raise AdapterError("Could not inspect the sealed Python execution image.") from error
    if (
        python_seals != SUPERVISOR_REQUIRED_SEALS
        or "memfd:venviewer-grand-hall-python-runtime" not in python_descriptor_target
    ):
        raise AdapterError("Python execution image is not the audited sealed supervisor memfd.")

    source_path = exact_absolute_path(
        _required_environment("VENVIEWER_GSFIXER_ADAPTER_SOURCE_PATH"),
        "GSFixer adapter source",
    ).resolve(strict=True)
    source_receipt = stable_file_receipt(
        source_path,
        "GSFixer adapter source",
        adapter_size,
        adapter_digest,
    )
    source_metadata = _regular_file_metadata(source_path, "GSFixer adapter source")
    if (
        source_metadata.st_dev != _required_environment_integer(
            "VENVIEWER_GSFIXER_ADAPTER_SOURCE_DEVICE"
        )
        or source_metadata.st_ino != _required_environment_integer(
            "VENVIEWER_GSFIXER_ADAPTER_SOURCE_INODE"
        )
    ):
        raise AdapterError("GSFixer adapter source path changed after supervisor snapshotting.")

    receipt_execution_root, receipt_directory, receipt_binding = supervised_receipt_directory()
    if (
        receipt_directory.is_symlink()
        or not receipt_directory.is_dir()
        or receipt_directory.parent != RECEIPT_PARENT
        or receipt_directory.name in ("", ".", "..")
    ):
        raise AdapterError("GSFixer detached supervisor receipt directory must be direct.")
    started_size = _required_environment_integer("VENVIEWER_GSFIXER_STARTED_RECEIPT_SIZE", 1)
    started_digest = normalized_sha256(
        _required_environment("VENVIEWER_GSFIXER_STARTED_RECEIPT_SHA256"),
        "GSFixer detached started receipt",
    )
    started_bytes, started_receipt = stable_read_bytes(
        receipt_execution_root / "started.json",
        "GSFixer detached started receipt",
        started_size,
        started_digest,
    )
    started_receipt = {
        **started_receipt,
        "path": str(receipt_directory / "started.json"),
    }
    started = exact_json_payload(started_bytes, "GSFixer detached started receipt")
    expected_started_fields = {
        "authority": "none",
        "schemaVersion": SUPERVISOR_PROTOCOL,
        "status": "started",
        "truthLayer": "GENERATED_CINEMATIC",
    }
    if any(started.get(key) != value for key, value in expected_started_fields.items()):
        raise AdapterError("GSFixer detached started receipt has invalid authority or status.")
    if started.get("adapterSource") != {
        "device": source_metadata.st_dev,
        "inode": source_metadata.st_ino,
        "path": str(source_path),
        "sha256": f"sha256:{adapter_digest}",
        "sizeBytes": adapter_size,
    }:
        raise AdapterError("GSFixer detached receipt does not bind the exact adapter source.")
    adapter_arguments = tuple(sys.argv[1:])
    completion_tag = _required_environment_integer("VENVIEWER_GSFIXER_COMPLETION_TAG", 1)
    if not adapter_arguments or started.get("adapterInvocation") != {
        "argvCount": len(adapter_arguments),
        "argvSha256": supervisor_argv_digest(adapter_arguments),
        "command": adapter_arguments[0],
        "completionTag": completion_tag,
    }:
        raise AdapterError("GSFixer detached receipt does not bind the exact adapter invocation.")
    if started.get("execution") != {
        "adapterMemfd": adapter_descriptor,
        "pythonMemfd": python_descriptor,
        "seals": SUPERVISOR_REQUIRED_SEALS,
    }:
        raise AdapterError("GSFixer detached receipt does not bind the sealed execution image.")
    if started.get("python") != {
        "executableSha256": f"sha256:{SUPERVISED_PYTHON_SHA256}",
        "executableSizeBytes": SUPERVISED_PYTHON_SIZE,
        "path": SUPERVISED_PYTHON_PATH,
        "symlinkTarget": SUPERVISED_PYTHON_SYMLINK_TARGET,
    }:
        raise AdapterError("GSFixer detached receipt does not bind the sealed Python runtime.")
    if started.get("supervisor") != {
        "cryptographicExecutionProvenance": False,
        "pid": supervisor_pid,
        "provenancePosture": TRUSTED_HOST_PROVENANCE_POSTURE,
        "sha256": f"sha256:{supervisor_digest}",
        "sizeBytes": supervisor_size,
    }:
        raise AdapterError("GSFixer detached receipt does not bind the running supervisor.")
    if started.get("receiptDirectory") != str(receipt_directory):
        raise AdapterError("GSFixer detached receipt does not bind its canonical output directory.")
    if started.get("receiptDirectoryBinding") != {
        "descriptor": receipt_binding["descriptor"],
        "device": receipt_binding["device"],
        "inode": receipt_binding["inode"],
    }:
        raise AdapterError("GSFixer detached receipt does not bind its inherited directory descriptor.")
    if (receipt_execution_root / "terminal.json").exists():
        raise AdapterError("GSFixer supervisor terminal receipt exists before adapter completion.")
    if os.getppid() != supervisor_pid:
        raise AdapterError("GSFixer supervisor process changed during adapter attestation.")

    return {
        **source_receipt,
        "executionBinding": "linux_supervisor_sealed_memfd",
        "sealedExecutionImage": {
            **executed_receipt,
            "descriptor": adapter_descriptor,
            "descriptorTarget": descriptor_target,
            "seals": observed_seals,
        },
        "supervisor": {
            **supervisor_receipt,
            "detachedStartedReceipt": started_receipt,
            "pid": supervisor_pid,
            "protocol": protocol,
            "receiptDirectory": str(receipt_directory),
            "receiptDirectoryBinding": receipt_binding,
        },
        "supervisedPython": {
            **python_execution_receipt,
            "descriptor": python_descriptor,
            "descriptorTarget": python_descriptor_target,
            "seals": python_seals,
        },
    }


def emit_supervisor_completion_proof(command: str) -> None:
    expected_tag = {"preflight": ord("P"), "run": ord("R")}.get(command)
    if expected_tag is None:
        raise AdapterError("Completion proof command is not an audited adapter command.")
    supervisor_pid = _required_environment_integer("VENVIEWER_GSFIXER_SUPERVISOR_PID", 1)
    if os.getppid() != supervisor_pid:
        raise AdapterError("Completion proof parent is not the bound supervisor.")
    receipt_execution_root, _, _ = supervised_receipt_directory()
    if (receipt_execution_root / "terminal.json").exists():
        raise AdapterError("Supervisor terminal receipt exists before the completion proof.")
    observed_tag = _required_environment_integer("VENVIEWER_GSFIXER_COMPLETION_TAG", 1)
    if observed_tag != expected_tag:
        raise AdapterError("Completion proof tag disagrees with the adapter command.")
    nonce_hex = _required_environment("VENVIEWER_GSFIXER_COMPLETION_NONCE")
    if len(nonce_hex) != 64 or any(character not in "0123456789abcdef" for character in nonce_hex):
        raise AdapterError("Completion proof nonce is not exact lowercase 256-bit hex.")
    completion_descriptor = _required_environment_integer(
        "VENVIEWER_GSFIXER_COMPLETION_FD",
        3,
    )
    payload = b"VGH1" + bytes.fromhex(nonce_hex) + bytes((expected_tag,))
    try:
        written = os.write(completion_descriptor, payload)
    except OSError as error:
        raise AdapterError("Could not write the process-bound supervisor completion proof.") from error
    if written != len(payload):
        raise AdapterError("Supervisor completion proof write was not atomic and exact.")
    try:
        os.close(completion_descriptor)
    except OSError as error:
        raise AdapterError("Could not close the supervisor completion proof descriptor.") from error


def base_identity(
    source_root: Path,
    model_root: Path,
    input_receipt: Mapping[str, Any],
    input_pack: Mapping[str, Any],
    goal_receipt: Mapping[str, Any],
    source_receipts: Sequence[Mapping[str, Any]],
    model_receipts: Sequence[Mapping[str, Any]],
    adapter_receipt_value: Mapping[str, Any],
    runtime_closure_receipt: Mapping[str, Any],
) -> Mapping[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "provider": {
            "id": PROVIDER_ID,
            "commit": PROVIDER_COMMIT,
            "sourceRoot": str(source_root),
            "closure": source_receipts,
            "closureSha256": domain_digest("VENVIEWER_GSFIXER_SOURCE_CLOSURE_V1", source_receipts),
        },
        "model": {
            "id": MODEL_ID,
            "commit": MODEL_COMMIT,
            "modelRoot": str(model_root),
            "closure": model_receipts,
            "closureSha256": domain_digest("VENVIEWER_GSFIXER_MODEL_CLOSURE_V1", model_receipts),
        },
        "input": input_receipt,
        "inputPack": input_pack,
        "authorization": {
            "activeGoal": goal_receipt,
            "scope": "safe_local_reversible_internal_r_and_d",
            "sourcePackAuthorityRemains": "none",
            "sourceTruthPromotionAuthorized": False,
        },
        "adapter": adapter_receipt_value,
        "runtimeDependencyClosure": {
            **runtime_closure_receipt,
            "scope": "site_packages_only",
            "unmeasuredExecutionDependencies": [
                "cuda_driver_and_device_runtime",
                "host_elf_interpreter_and_shared_libraries",
                "python_lib_dynload",
                "python_standard_library",
            ],
        },
        "parameters": {
            "seed": SEED,
            "denoisingSteps": DENOISING_STEPS,
            "processingResolution": PROCESSING_RESOLUTION,
            "matchInputResolution": True,
            "dtype": "float16",
            "conditionImages": 1,
        },
        "authority": {
            "truthLayer": "GENERATED_CINEMATIC",
            "capturedTruthAuthority": "none",
            "structuralTruthAuthority": "none",
            "measurementAuthority": "none",
            "planningAuthority": "none",
            "geometryMutation": False,
            "promotion": "prohibited_pending_human_review",
            "untouchedCapturedMasterRequired": True,
        },
        "limitations": {
            "singleFrameDiagnostic": True,
            "sceneFineTuned": False,
            "multiviewConsistent": False,
            "verifiedRealDetailAdded": False,
            "mayHallucinateArchitecture": True,
        },
    }


def verify_materials(
    source_root: Path,
    model_root: Path,
    input_path: Path,
    manifest_path: Path,
    publication_receipt_path: Path,
    goal_file_path: Path,
) -> tuple[
    Any,
    Mapping[str, Any],
    Mapping[str, Any],
    Mapping[str, Any],
    Sequence[Mapping[str, Any]],
    Sequence[Mapping[str, Any]],
]:
    git_head(source_root, PROVIDER_COMMIT, "GSFix3D source")
    git_head(model_root, MODEL_COMMIT, "GSFixer model")
    source_receipts = verify_closure(source_root, SOURCE_CLOSURE, "GSFix3D source")
    model_receipts = verify_closure(model_root, MODEL_CLOSURE, "GSFixer model")
    verify_model_index(model_root)
    image, input_receipt = exact_source_image(input_path)
    input_pack, goal_receipt, _ = verify_input_lineage(
        input_path,
        manifest_path,
        publication_receipt_path,
        goal_file_path,
    )
    return image, input_receipt, input_pack, goal_receipt, source_receipts, model_receipts


def run_preflight(arguments: argparse.Namespace) -> int:
    require_isolated_runtime()
    network_errno = require_network_namespace()
    source_root = exact_absolute_path(arguments.source_root, "Source root")
    model_root = exact_absolute_path(arguments.model_root, "Model root")
    input_path = exact_absolute_path(arguments.input, "Source image")
    manifest_path = exact_absolute_path(arguments.input_pack_manifest, "Input-pack manifest")
    publication_path = exact_absolute_path(
        arguments.input_pack_publication_receipt,
        "Input-pack publication receipt",
    )
    goal_path = exact_absolute_path(arguments.goal_file, "Active goal")
    adapter_receipt_value = adapter_receipt()
    runtime_closure_receipt = verify_and_activate_runtime_closure()
    _, input_receipt, input_pack, goal_receipt, source_receipts, model_receipts = verify_materials(
        source_root,
        model_root,
        input_path,
        manifest_path,
        publication_path,
        goal_path,
    )
    torch = importlib.import_module("torch")
    if not torch.cuda.is_available():
        raise AdapterError("CUDA is unavailable inside the exact offline runtime.")
    probe = torch.zeros((1,), device="cuda", dtype=torch.float32)
    if probe.item() != 0:
        raise AdapterError("CUDA allocation preflight returned an unexpected value.")
    torch.cuda.synchronize()
    identity = base_identity(
        source_root,
        model_root,
        input_receipt,
        input_pack,
        goal_receipt,
        source_receipts,
        model_receipts,
        adapter_receipt_value,
        runtime_closure_receipt,
    )
    receipt = {
        **identity,
        "status": "preflight_succeeded",
        "runtime": {
            "python": sys.version,
            "packages": package_versions(),
            "networkConnectErrno": network_errno,
            "networkUnreachable": True,
            "cudaAvailable": True,
            "gpuName": torch.cuda.get_device_name(0),
            "cudaRuntime": str(torch.version.cuda),
            "driverVersion": driver_version(),
        },
    }
    emit_supervisor_completion_proof("preflight")
    sys.stdout.write(canonical_json(receipt) + "\n")
    return 0


def run_inference(arguments: argparse.Namespace) -> int:
    require_isolated_runtime()
    network_errno = require_network_namespace()
    source_root = exact_absolute_path(arguments.source_root, "Source root")
    model_root = exact_absolute_path(arguments.model_root, "Model root")
    input_path = exact_absolute_path(arguments.input, "Source image")
    manifest_path = exact_absolute_path(arguments.input_pack_manifest, "Input-pack manifest")
    publication_path = exact_absolute_path(
        arguments.input_pack_publication_receipt,
        "Input-pack publication receipt",
    )
    goal_path = exact_absolute_path(arguments.goal_file, "Active goal")
    adapter_receipt_value = adapter_receipt()
    runtime_closure_receipt = verify_and_activate_runtime_closure()
    receipt_directory = exact_absolute_path(
        _required_environment("VENVIEWER_GSFIXER_STARTED_RECEIPT_DIR"),
        "GSFixer detached supervisor receipt directory",
    ).resolve(strict=True)
    declared_attempt = exact_absolute_path(arguments.attempt_dir, "Attempt directory")
    if declared_attempt.parent != ATTEMPT_PARENT:
        raise AdapterError("Attempt directory is not one direct child of the pinned GSFixer runs root.")
    declared_attempt = require_output_isolated(
        declared_attempt,
        (
            source_root,
            model_root,
            input_path.parent,
            manifest_path.parent,
            publication_path.parent,
            goal_path.parent,
            receipt_directory,
        ),
    )
    attempt, attempt_binding = supervised_attempt_directory(declared_attempt)
    started_monotonic = time.monotonic()
    started_payload: Mapping[str, Any] | None = None
    terminal_summary: Mapping[str, Any] | None = None
    try:
        (
            image,
            input_receipt,
            input_pack,
            goal_receipt,
            source_receipts,
            model_receipts,
        ) = verify_materials(
            source_root,
            model_root,
            input_path,
            manifest_path,
            publication_path,
            goal_path,
        )
        source_snapshot, source_snapshot_receipts = create_provider_source_snapshot(
            source_root,
            attempt,
        )
        model_snapshot, model_snapshot_receipts = create_model_execution_snapshot(
            model_root,
            attempt,
        )
        identity = base_identity(
            source_root,
            model_root,
            input_receipt,
            input_pack,
            goal_receipt,
            source_receipts,
            model_receipts,
            adapter_receipt_value,
            runtime_closure_receipt,
        )
        started_payload = {
            **identity,
            "status": "started",
            "networkConnectErrno": network_errno,
            "attemptDirectory": str(declared_attempt),
            "attemptExecutionBinding": attempt_binding,
            "executionSnapshots": {
                "providerSourceRoot": str(source_snapshot),
                "providerSourceClosure": source_snapshot_receipts,
                "providerSourceClosureSha256": domain_digest(
                    "VENVIEWER_GSFIXER_EXECUTION_SOURCE_CLOSURE_V1",
                    source_snapshot_receipts,
                ),
                "modelRoot": str(model_snapshot),
                "modelClosure": model_snapshot_receipts,
                "modelClosureSha256": domain_digest(
                    "VENVIEWER_GSFIXER_EXECUTION_MODEL_CLOSURE_V1",
                    model_snapshot_receipts,
                ),
                "modelSnapshotMethod": "create_only_exact_byte_copies",
            },
        }
        write_canonical_receipt(
            attempt / STARTED_RECEIPT_NAME,
            started_payload,
            "GSFixer started receipt",
        )

        torch = importlib.import_module("torch")
        if not torch.cuda.is_available():
            raise AdapterError("CUDA is unavailable inside the exact offline runtime.")
        configure_determinism(torch)
        install_unused_matplotlib_import_shim()
        marigold = require_exact_marigold_imports(source_snapshot)
        pipeline_class = getattr(marigold, "MarigoldGSFixerPipeline", None)
        if pipeline_class is None:
            raise AdapterError("Official MarigoldGSFixerPipeline was not imported from the pinned source.")

        pipeline = pipeline_class.from_pretrained(
            str(model_snapshot),
            torch_dtype=torch.float16,
            local_files_only=True,
            use_safetensors=True,
        )
        pipeline.set_progress_bar_config(disable=True)
        pipeline = pipeline.to(device="cuda", dtype=torch.float16)
        generator = torch.Generator(device="cuda").manual_seed(SEED)
        with torch.inference_mode():
            result = pipeline(
                condition_image1=image,
                denoising_steps=DENOISING_STEPS,
                processing_res=PROCESSING_RESOLUTION,
                match_input_res=True,
                resample_method="bilinear",
                batch_size=1,
                generator=generator,
                show_progress_bar=False,
            )
        torch.cuda.synchronize()
        output = getattr(result, "fixed_rgb", None)
        if output is None or output.mode != "RGB" or output.size != (WIDTH, HEIGHT):
            raise AdapterError("GSFixer did not return exactly one RGB image at the source resolution.")

        (
            _,
            post_input_receipt,
            post_input_pack,
            post_goal_receipt,
            post_source_receipts,
            post_model_receipts,
        ) = verify_materials(
            source_root,
            model_root,
            input_path,
            manifest_path,
            publication_path,
            goal_path,
        )
        post_source_snapshot_receipts = verify_closure(
            source_snapshot,
            {path: SOURCE_CLOSURE[path] for path in SOURCE_CODE_PATHS},
            "GSFix3D private source snapshot after inference",
        )
        post_model_snapshot_receipts = verify_closure(
            model_snapshot,
            MODEL_CLOSURE,
            "GSFixer private model snapshot after inference",
        )
        post_adapter_receipt = adapter_receipt()
        post_runtime_closure_receipt = verify_runtime_closure()
        pre_binding = {
            "input": input_receipt,
            "inputPack": input_pack,
            "goal": goal_receipt,
            "source": source_receipts,
            "model": model_receipts,
            "sourceSnapshot": source_snapshot_receipts,
            "modelSnapshot": model_snapshot_receipts,
            "adapter": adapter_receipt_value,
            "runtimeDependencyClosure": runtime_closure_receipt,
        }
        post_binding = {
            "input": post_input_receipt,
            "inputPack": post_input_pack,
            "goal": post_goal_receipt,
            "source": post_source_receipts,
            "model": post_model_receipts,
            "sourceSnapshot": post_source_snapshot_receipts,
            "modelSnapshot": post_model_snapshot_receipts,
            "adapter": post_adapter_receipt,
            "runtimeDependencyClosure": post_runtime_closure_receipt,
        }
        if canonical_json(pre_binding) != canonical_json(post_binding):
            raise AdapterError("Source, model, goal, or execution snapshot changed during inference.")
        buffer = io.BytesIO()
        output.save(buffer, format="PNG", optimize=False, compress_level=9)
        output_receipt = display_attempt_receipt(
            exclusive_write(
                attempt / OUTPUT_NAME,
                buffer.getvalue(),
                "GSFixer candidate PNG",
            ),
            attempt,
            declared_attempt,
        )
        elapsed = time.monotonic() - started_monotonic
        success = {
            **identity,
            "status": ADAPTER_PENDING_SUPERVISOR_STATUS,
            "cryptographicExecutionProvenance": False,
            "detachedSupervisorTerminalRequired": True,
            "outputEligibleForUse": False,
            "output": output_receipt,
            "executionSnapshots": started_payload["executionSnapshots"],
            "postRunAttestationSha256": domain_digest(
                "VENVIEWER_GSFIXER_POST_RUN_ATTESTATION_V1",
                post_binding,
            ),
            "runtime": {
                "python": sys.version,
                "packages": package_versions(),
                "networkConnectErrno": network_errno,
                "networkUnreachable": True,
                "gpuName": torch.cuda.get_device_name(0),
                "cudaRuntime": str(torch.version.cuda),
                "driverVersion": driver_version(),
                "peakCudaAllocatedBytes": int(torch.cuda.max_memory_allocated()),
                "peakCudaReservedBytes": int(torch.cuda.max_memory_reserved()),
                "elapsedSeconds": round(elapsed, 6),
            },
            "review": {
                "humanArchitectureReview": "required",
                "protectedRegionMetrics": "required",
                "forbiddenWindowsDoorsDarkFloorNeighbourFacadeReview": "required",
                "eligibleForCapturedMaster": False,
                "eligibleForAutomaticPromotion": False,
            },
        }
        receipt_file = display_attempt_receipt(
            write_canonical_receipt(
                attempt / SUCCESS_RECEIPT_NAME,
                success,
                "GSFixer success receipt",
            ),
            attempt,
            declared_attempt,
        )
        require_supervised_attempt_stable(attempt, declared_attempt)
        emit_supervisor_completion_proof("run")
        terminal_summary = {
            "status": ADAPTER_PENDING_SUPERVISOR_STATUS,
            "attemptDirectory": str(declared_attempt),
            "detachedSupervisorTerminalRequired": True,
            "output": output_receipt,
            "receipt": receipt_file,
        }
    except BaseException as error:
        failure = {
            "schemaVersion": SCHEMA_VERSION,
            "status": "failed_no_retry",
            "started": started_payload,
            "errorType": type(error).__name__,
            "error": str(error)[:2_000],
            "elapsedSeconds": round(time.monotonic() - started_monotonic, 6),
            "outputEligibleForUse": False,
            "automaticRetryPermitted": False,
        }
        failure_receipt: Mapping[str, Any] | None = None
        try:
            failure_receipt = display_attempt_receipt(
                write_canonical_receipt(
                    attempt / FAILURE_RECEIPT_NAME,
                    failure,
                    "GSFixer terminal failure receipt",
                ),
                attempt,
                declared_attempt,
            )
        except BaseException as receipt_error:
            sys.stderr.write(f"Could not write GSFixer failure receipt: {receipt_error}\n")
        terminal_failure = {
            "status": "failed_no_retry",
            "attemptDirectory": str(declared_attempt),
            "failureReceipt": failure_receipt,
            "errorType": type(error).__name__,
            "error": str(error)[:2_000],
        }
        raise AdapterError(canonical_json(terminal_failure)) from error
    if terminal_summary is None:
        raise AdapterError("GSFixer attempt reached no terminal state.")
    sys.stdout.write(canonical_json(terminal_summary) + "\n")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Offline, output-isolated Grand Hall GSFixer-base diagnostic adapter."
    )
    subcommands = parser.add_subparsers(dest="command", required=True)
    for name in ("preflight", "run"):
        command = subcommands.add_parser(name)
        command.add_argument("--source-root", required=True)
        command.add_argument("--model-root", required=True)
        command.add_argument("--input", required=True)
        command.add_argument("--input-pack-manifest", required=True)
        command.add_argument("--input-pack-publication-receipt", required=True)
        command.add_argument("--goal-file", required=True)
        if name == "run":
            command.add_argument("--attempt-dir", required=True)
    return parser


def main() -> int:
    arguments = build_parser().parse_args()
    if arguments.command == "preflight":
        return run_preflight(arguments)
    if arguments.command == "run":
        return run_inference(arguments)
    raise AdapterError(f"Unsupported command: {arguments.command!r}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AdapterError as error:
        sys.stderr.write(canonical_json({"status": "failed", "error": str(error)}) + "\n")
        raise SystemExit(1) from error
