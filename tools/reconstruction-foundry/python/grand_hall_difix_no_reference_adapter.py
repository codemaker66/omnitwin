#!/usr/bin/env python3
"""Bounded, local-only Difix no-reference adapter for one Grand Hall diagnostic.

This module intentionally does not import provider code or torch at module import
time. The preflight and run entry points are separate. The run entry point loads
only the pinned ``pipeline_difix.py::DifixPipeline`` and deliberately executes
one reviewed, hash-bound local custom VAE component. It never retrieves or
executes remote code.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import errno
import hashlib
import importlib
import importlib.metadata
import importlib.util
import inspect
import io
import json
import os
from pathlib import Path
import resource
import socket
import stat
import subprocess
import sys
from typing import Any, Mapping


WIDTH = 1024
HEIGHT = 576
PROMPT = "remove degradation"
TIMESTEPS = [199]
SEED = 42
OOM_EXIT_CODE = 86
ADAPTER_RECEIPT_SCHEMA = (
    "venviewer.grand-hall.difix-no-reference-python-adapter-receipt.v1"
)
PIPELINE_DIFIX_SHA256 = "sha256:2f73e2708b3f9ce560800163554f869e5e43e3a42049f67da3609f7736cbab3a"
MODEL_INDEX_SHA256 = "sha256:0b4316574ae102b3855c4508a13becc81b353f6455dafa6186ac37d82c8292b9"
AUDITED_VAE_SHA256 = "sha256:a0c16e2fe489d0386b04274b25e6cec212f37264283f8ce1c042270d27250edf"
AUDITED_VAE_SIZE = 24_456
AUDITED_PIPELINE_MODULE_NAME = "_venviewer_audited_pipeline_difix"
MODEL_LOAD_CLOSURE: tuple[tuple[str, int, str], ...] = (
    ("model_index.json", 586, MODEL_INDEX_SHA256),
    ("scheduler/scheduler_config.json", 700, "sha256:78e1c4d74df2c94c7d886f0d3f9ccff9c88851dda9c6ae4ccab3356a18efa855"),
    ("text_encoder/config.json", 603, "sha256:2796729c12b32c17e039ef9d5a78bcc61d52d1afbcbe11edf004a26531c92c2a"),
    ("text_encoder/model.safetensors", 1_361_596_304, "sha256:67e013543d4fac905c882e2993d86a2d454ee69dc9e8f37c0c23d33a48959d15"),
    ("tokenizer/merges.txt", 524_619, "sha256:9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a"),
    ("tokenizer/special_tokens_map.json", 574, "sha256:c2d0fb8b86ad86b1f46134d4a5f93fd1e688c932a78efc8d149087c33a53ad06"),
    ("tokenizer/tokenizer_config.json", 885, "sha256:b91e0a1eba063043b4ee76bec870f2fa0c12a3ff404155b30e64c77d25c0758f"),
    ("tokenizer/vocab.json", 1_059_962, "sha256:e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349"),
    ("unet/config.json", 1_852, "sha256:bc47aaf41ef8a34b38ef06518ace2276bb57c38a92309c40e398a8d96a8e33db"),
    ("unet/diffusion_pytorch_model.safetensors", 3_463_726_504, "sha256:3815819b0009d16b5f7538ecbf2dd0ac4a6b07a238ab82d869465c347864bb70"),
    ("vae/autoencoder_kl.py", AUDITED_VAE_SIZE, AUDITED_VAE_SHA256),
    ("vae/config.json", 698, "sha256:d2ea6077dead151d8d0f21cd772b0de11b056c9c723c203840f6afaa1f3185f7"),
    ("vae/diffusion_pytorch_model.safetensors", 338_717_612, "sha256:20a5e872469d801876e448ec1d499b1e99cc666497a6aa133ed22c9e0a7a1a25"),
)
EXPECTED_CONFIGURATION: Mapping[str, Any] = {
    "prompt": PROMPT,
    "referenceImage": None,
    "torchDtype": "float32",
    "width": WIDTH,
    "height": HEIGHT,
    "numInferenceSteps": 1,
    "timesteps": TIMESTEPS,
    "guidanceScale": 0,
    "negativePrompt": None,
    "numImagesPerPrompt": 1,
    "eta": 0,
    "generatorDevice": "cuda",
    "seed": SEED,
    "outputType": "pil",
    "returnDict": True,
    "guidanceRescale": 0,
    "clipSkip": None,
    "imageProcessor": {
        "doResize": False,
        "doConvertRgb": False,
        "doNormalize": True,
    },
    "disabledOptimizations": [
        "autocast",
        "compile",
        "cpu_offload",
        "tf32",
        "vae_tiling",
        "xformers",
    ],
    "deterministicAlgorithms": True,
    "cudnnBenchmark": False,
    "cudnnDeterministic": True,
    "localFilesOnly": True,
}


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


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def domain_digest(domain: str, value: Any) -> str:
    material = domain.encode("ascii") + b"\x00" + canonical_json(value).encode("utf-8")
    return sha256_bytes(material)


def stable_file(
    path: Path,
    expected_sha256: str,
    expected_size: int,
    *,
    collect_bytes: bool,
) -> tuple[Mapping[str, Any], bytes | None]:
    before = path.stat(follow_symlinks=False)
    if not stat.S_ISREG(before.st_mode) or path.is_symlink() or before.st_nlink != 1:
        raise RuntimeError(f"Bound input is not a direct regular file: {path}")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
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
            raise RuntimeError(f"Bound input changed before its stable read: {path}")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            if collect_bytes:
                chunks.append(chunk)
        data = b"".join(chunks) if collect_bytes else None
        opened_after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    after = path.stat(follow_symlinks=False)
    identity_before = (
        opened_before.st_dev,
        opened_before.st_ino,
        opened_before.st_size,
        opened_before.st_mtime_ns,
        opened_before.st_ctime_ns,
    )
    identity_after = (
        opened_after.st_dev,
        opened_after.st_ino,
        opened_after.st_size,
        opened_after.st_mtime_ns,
        opened_after.st_ctime_ns,
    )
    path_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
    if identity_before != identity_after or identity_after != path_after:
        raise RuntimeError(f"Bound input changed during its stable read: {path}")
    actual_sha256 = "sha256:" + digest.hexdigest()
    if opened_after.st_size != expected_size or actual_sha256 != expected_sha256:
        raise RuntimeError(f"Bound input size or digest mismatch: {path}")
    return {
        "wslPath": str(path),
        "sizeBytes": int(opened_after.st_size),
        "sha256": actual_sha256,
        "linkCount": int(opened_after.st_nlink),
    }, data


def stable_read(path: Path, expected_sha256: str, expected_size: int) -> bytes:
    _receipt, data = stable_file(
        path,
        expected_sha256,
        expected_size,
        collect_bytes=True,
    )
    if data is None:
        raise RuntimeError("Stable byte collection returned no bytes.")
    return data


def stable_hash(path: Path, expected_sha256: str, expected_size: int) -> Mapping[str, Any]:
    receipt, _data = stable_file(
        path,
        expected_sha256,
        expected_size,
        collect_bytes=False,
    )
    return receipt


def _file_identity(metadata: os.stat_result) -> tuple[int, int, int, int, int, int, int]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_nlink,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def stable_copy_create_only(
    source: Path,
    destination: Path,
    expected_sha256: str,
    expected_size: int,
    *,
    collect_bytes: bool,
) -> tuple[Mapping[str, Any], Mapping[str, Any], bytes | None]:
    """Copy one exact direct file without reopening the source for model loading.

    The source is read through one no-follow descriptor and the destination is
    created once at mode 0400. A failed copy is deliberately left in place so
    the consumed attempt cannot silently reuse or overwrite a partial snapshot.
    """

    source_before = os.lstat(source)
    if not stat.S_ISREG(source_before.st_mode) or source_before.st_nlink != 1:
        raise RuntimeError(f"Bound model source is not a direct single-link regular file: {source}")
    destination_parent = os.lstat(destination.parent)
    if not stat.S_ISDIR(destination_parent.st_mode) or stat.S_ISLNK(destination_parent.st_mode):
        raise RuntimeError(f"Private snapshot parent is not a direct directory: {destination.parent}")

    read_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    write_flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0)
    )
    source_descriptor = os.open(source, read_flags)
    destination_descriptor: int | None = None
    digest = hashlib.sha256()
    collected: list[bytes] = []
    try:
        source_opened_before = os.fstat(source_descriptor)
        if (
            not stat.S_ISREG(source_opened_before.st_mode)
            or source_opened_before.st_nlink != 1
            or _file_identity(source_before) != _file_identity(source_opened_before)
        ):
            raise RuntimeError(f"Bound model source changed before private snapshot copy: {source}")
        destination_descriptor = os.open(destination, write_flags, 0o400)
        os.fchmod(destination_descriptor, 0o400)
        destination_opened_before = os.fstat(destination_descriptor)
        if not stat.S_ISREG(destination_opened_before.st_mode) or destination_opened_before.st_nlink != 1:
            raise RuntimeError(f"Private snapshot target is not a direct single-link regular file: {destination}")

        copied_size = 0
        while True:
            chunk = os.read(source_descriptor, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            copied_size += len(chunk)
            if collect_bytes:
                collected.append(chunk)
            offset = 0
            while offset < len(chunk):
                written = os.write(destination_descriptor, chunk[offset:])
                if written <= 0:
                    raise RuntimeError(f"Private snapshot write made no progress: {destination}")
                offset += written
        os.fsync(destination_descriptor)
        source_opened_after = os.fstat(source_descriptor)
        destination_opened_after = os.fstat(destination_descriptor)
    finally:
        if destination_descriptor is not None:
            os.close(destination_descriptor)
        os.close(source_descriptor)

    source_after = os.lstat(source)
    destination_after = os.lstat(destination)
    if (
        _file_identity(source_before) != _file_identity(source_opened_before)
        or _file_identity(source_opened_before) != _file_identity(source_opened_after)
        or _file_identity(source_opened_after) != _file_identity(source_after)
    ):
        raise RuntimeError(f"Bound model source changed during private snapshot copy: {source}")
    if (
        destination_opened_before.st_dev != destination_opened_after.st_dev
        or destination_opened_before.st_ino != destination_opened_after.st_ino
        or destination_opened_after.st_dev != destination_after.st_dev
        or destination_opened_after.st_ino != destination_after.st_ino
        or not stat.S_ISREG(destination_after.st_mode)
        or destination_after.st_nlink != 1
    ):
        raise RuntimeError(f"Private snapshot target changed during create-only copy: {destination}")
    actual_sha256 = "sha256:" + digest.hexdigest()
    if copied_size != expected_size or actual_sha256 != expected_sha256:
        raise RuntimeError(f"Bound model source size or digest mismatch during copy: {source}")
    if destination_opened_after.st_size != expected_size or destination_after.st_size != expected_size:
        raise RuntimeError(f"Private snapshot target size mismatch after copy: {destination}")

    source_receipt = {
        "wslPath": str(source),
        "sizeBytes": int(source_opened_after.st_size),
        "sha256": actual_sha256,
        "linkCount": int(source_opened_after.st_nlink),
    }
    private_receipt = stable_hash(destination, expected_sha256, expected_size)
    return source_receipt, private_receipt, b"".join(collected) if collect_bytes else None


def _snapshot_digest(root: Path, files: list[Mapping[str, Any]]) -> str:
    return domain_digest(
        "VENVIEWER_GRAND_HALL_DIFIX_PRIVATE_MODEL_SNAPSHOT_V1",
        {"wslRoot": str(root), "files": files},
    )


def create_private_model_execution_snapshot(
    source_root: Path,
    destination_root: Path,
) -> tuple[list[Mapping[str, Any]], Mapping[str, Any], Mapping[str, Any]]:
    """Create the only model tree the provider is permitted to load."""

    os.mkdir(destination_root, 0o700)
    directory_names = ("scheduler", "text_encoder", "tokenizer", "unet", "vae")
    for directory_name in directory_names:
        os.mkdir(destination_root / directory_name, 0o700)

    source_receipts: list[Mapping[str, Any]] = []
    private_receipts: list[Mapping[str, Any]] = []
    model_index_bytes: bytes | None = None
    for relative_path, size_bytes, expected_sha256 in MODEL_LOAD_CLOSURE:
        source_receipt, private_receipt, collected = stable_copy_create_only(
            source_root / Path(relative_path),
            destination_root / Path(relative_path),
            expected_sha256,
            size_bytes,
            collect_bytes=relative_path == "model_index.json",
        )
        source_receipts.append({"relativePath": relative_path, **source_receipt})
        private_receipts.append({"relativePath": relative_path, **private_receipt})
        if relative_path == "model_index.json":
            model_index_bytes = collected

    if model_index_bytes is None:
        raise RuntimeError("Pinned model_index.json was not collected while creating the private snapshot.")
    model_index = json.loads(model_index_bytes)
    for directory_name in reversed(directory_names):
        os.chmod(destination_root / directory_name, 0o500)
    os.chmod(destination_root, 0o500)
    snapshot_before = {
        "wslRoot": str(destination_root),
        "filesBeforeLoad": private_receipts,
        "snapshotSha256BeforeLoad": _snapshot_digest(destination_root, private_receipts),
    }
    return source_receipts, model_index, snapshot_before


def finalize_private_model_execution_snapshot(
    snapshot_before: Mapping[str, Any],
) -> Mapping[str, Any]:
    root = Path(str(snapshot_before["wslRoot"]))
    files_after: list[Mapping[str, Any]] = []
    for relative_path, size_bytes, expected_sha256 in MODEL_LOAD_CLOSURE:
        receipt = stable_hash(root / Path(relative_path), expected_sha256, size_bytes)
        files_after.append({"relativePath": relative_path, **receipt})
    snapshot_after_sha256 = _snapshot_digest(root, files_after)
    if snapshot_after_sha256 != snapshot_before["snapshotSha256BeforeLoad"]:
        raise RuntimeError("Private model execution snapshot changed after its audited load.")
    return {
        **snapshot_before,
        "filesAfterInference": files_after,
        "snapshotSha256AfterInference": snapshot_after_sha256,
    }


def create_only_bytes(path: Path, value: bytes) -> None:
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(descriptor)


def create_only_json(path: Path, value: Mapping[str, Any]) -> None:
    create_only_bytes(path, (canonical_json(value) + "\n").encode("utf-8"))


def load_execution_lock(
    path: Path,
    expected_file_sha256: str,
    expected_size_bytes: int,
    expected_execution_lock_sha256: str,
) -> Mapping[str, Any]:
    raw = stable_read(path, expected_file_sha256, expected_size_bytes)
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise RuntimeError("Execution lock must be a JSON object.")
    digest = parsed.get("executionLockSha256")
    payload = {key: value for key, value in parsed.items() if key != "executionLockSha256"}
    if digest != domain_digest("VENVIEWER_GRAND_HALL_DIFIX_EXECUTION_LOCK_V1", payload):
        raise RuntimeError("Execution lock self digest mismatch.")
    if digest != expected_execution_lock_sha256:
        raise RuntimeError("Execution lock differs from the exact pre-claim lock digest.")
    if parsed.get("configuration") != EXPECTED_CONFIGURATION:
        raise RuntimeError("Execution lock does not contain the exact adapter configuration.")
    return parsed


def package_versions() -> Mapping[str, str]:
    names = [
        "accelerate",
        "diffusers",
        "numpy",
        "pillow",
        "safetensors",
        "torch",
        "torchvision",
        "transformers",
        "xformers",
    ]
    versions: dict[str, str] = {}
    for name in names:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = "not-installed"
    return dict(sorted(versions.items()))


def driver_version() -> str:
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
        check=True,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=10,
        env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
    )
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if len(lines) != 1:
        raise RuntimeError("Expected exactly one visible GPU driver version.")
    return lines[0]


def require_isolated_python() -> None:
    if sys.flags.isolated != 1 or sys.flags.ignore_environment != 1:
        raise RuntimeError("Adapter requires Python isolated mode (-I).")
    if not sys.dont_write_bytecode:
        raise RuntimeError("Adapter requires bytecode writes disabled (-B).")


def require_absent_direct_child(path: Path, parent: Path, label: str) -> None:
    if path.parent.resolve(strict=True) != parent.resolve(strict=True):
        raise RuntimeError(f"{label} must be a direct attempt-local child.")
    try:
        os.lstat(path)
    except FileNotFoundError:
        return
    raise RuntimeError(f"{label} must be fresh and absent before provider imports: {path}")


def require_exact_attempt_cache_environment(
    args: argparse.Namespace,
    paths: Mapping[str, Any],
) -> None:
    if str(args.hf_modules_cache) != paths["hfModulesCacheWsl"]:
        raise RuntimeError("HF modules cache path disagrees with the execution lock.")
    if str(args.torch_home) != paths["torchHomeWsl"]:
        raise RuntimeError("Torch home path disagrees with the execution lock.")
    if str(args.attempt_directory) != paths["attemptDirectoryWsl"]:
        raise RuntimeError("Attempt directory path disagrees with the execution lock.")
    if str(args.model_execution_snapshot) != paths["modelExecutionSnapshotWsl"]:
        raise RuntimeError("Private model execution snapshot path disagrees with the execution lock.")
    expected_environment = {
        "HOME": str(args.attempt_directory),
        "HF_MODULES_CACHE": str(args.hf_modules_cache),
        "TORCH_HOME": str(args.torch_home),
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "DIFFUSERS_OFFLINE": "1",
        "HF_DATASETS_OFFLINE": "1",
        "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1",
        "HF_HUB_DISABLE_TELEMETRY": "1",
        "PIP_NO_INDEX": "1",
        "CUBLAS_WORKSPACE_CONFIG": ":4096:8",
    }
    for name, expected in expected_environment.items():
        if os.environ.get(name) != expected:
            raise RuntimeError(f"Exact isolated environment binding is missing for {name}.")
    attempt = args.attempt_directory
    attempt_metadata = attempt.stat(follow_symlinks=False)
    if not stat.S_ISDIR(attempt_metadata.st_mode) or attempt.is_symlink():
        raise RuntimeError("Attempt directory must be a direct directory.")
    require_absent_direct_child(args.hf_modules_cache, attempt, "HF modules cache")
    require_absent_direct_child(args.torch_home, attempt, "Torch home")
    require_absent_direct_child(
        args.model_execution_snapshot,
        attempt,
        "Private model execution snapshot",
    )


def require_network_unreachable() -> int:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.settimeout(1.0)
    try:
        result = probe.connect_ex(("1.1.1.1", 53))
    finally:
        probe.close()
    if result != errno.ENETUNREACH:
        raise RuntimeError(
            f"Network namespace preflight expected ENETUNREACH ({errno.ENETUNREACH}), got {result}."
        )
    return result


def run_preflight() -> int:
    require_isolated_python()
    network_errno = require_network_unreachable()
    torch = importlib.import_module("torch")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable inside the exact no-network namespace.")
    probe = torch.zeros((1,), device="cuda", dtype=torch.float32)
    if probe.item() != 0:
        raise RuntimeError("CUDA allocation preflight returned an unexpected value.")
    torch.cuda.synchronize()
    receipt = {
        "schemaVersion": "venviewer.grand-hall.difix-no-reference-preflight.v1",
        "networkConnectErrno": network_errno,
        "networkUnreachable": True,
        "cudaAvailable": True,
        "cudaAllocationSucceeded": True,
        "gpuName": torch.cuda.get_device_name(0),
        "cudaRuntime": str(torch.version.cuda),
        "driverVersion": driver_version(),
        "packages": package_versions(),
    }
    sys.stdout.write(canonical_json(receipt) + "\n")
    return 0


def exact_rgb_image(source_bytes: bytes) -> Any:
    image_module = importlib.import_module("PIL.Image")
    image = image_module.open(io.BytesIO(source_bytes))
    image.load()
    if image.format != "PNG":
        raise RuntimeError(f"Source image must decode as PNG, got {image.format!r}.")
    if image.mode != "RGB":
        raise RuntimeError(f"Source image must already be RGB8 without conversion, got {image.mode!r}.")
    if image.size != (WIDTH, HEIGHT):
        raise RuntimeError(f"Source image must be exactly {WIDTH}x{HEIGHT}, got {image.size!r}.")
    return image


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


def preload_exact_local_code_and_model_closure(
    provider_source_root: Path,
    model_snapshot_root: Path,
    model_execution_snapshot_root: Path,
) -> tuple[Path, bytes, Mapping[str, Any], Mapping[str, Any], Mapping[str, Any]]:
    source_module_root = provider_source_root / "src"
    provider_module = source_module_root / "pipeline_difix.py"
    provider_receipt, provider_bytes = stable_file(
        provider_module,
        PIPELINE_DIFIX_SHA256,
        56_400,
        collect_bytes=True,
    )
    if provider_bytes is None:
        raise RuntimeError("Pinned provider pipeline bytes were not collected.")
    model_receipts, model_index, private_snapshot_before = create_private_model_execution_snapshot(
        model_snapshot_root,
        model_execution_snapshot_root,
    )
    expected_null_components = {
        "_class_name": "DifixPipeline",
        "_diffusers_version": "0.25.1",
        "_name_or_path": "nvidia/difix",
        "feature_extractor": [None, None],
        "image_encoder": [None, None],
        "requires_safety_checker": True,
        "safety_checker": [None, None],
        "scheduler": ["diffusers", "DDPMScheduler"],
        "text_encoder": ["transformers", "CLIPTextModel"],
        "tokenizer": ["transformers", "CLIPTokenizer"],
        "unet": ["diffusers", "UNet2DConditionModel"],
        "vae": ["autoencoder_kl", "AutoencoderKL"],
    }
    if model_index != expected_null_components:
        raise RuntimeError("Pinned model_index.json component contract mismatch.")
    closure = {
        "providerPipeline": provider_receipt,
        "modelFiles": model_receipts,
    }
    closure_receipt = {
        **closure,
        "closureSha256": domain_digest(
            "VENVIEWER_GRAND_HALL_DIFIX_PRELOAD_CLOSURE_V1",
            closure,
        ),
    }
    return provider_module, provider_bytes, model_index, closure_receipt, private_snapshot_before


class AuditedBytesModuleLoader:
    def __init__(self, path: Path, source_bytes: bytes) -> None:
        self.path = path
        self.source_bytes = source_bytes

    def create_module(self, _specification: Any) -> None:
        return None

    def exec_module(self, module: Any) -> None:
        code = compile(self.source_bytes, str(self.path), "exec", dont_inherit=True)
        exec(code, module.__dict__)  # noqa: S102 - executes only the stable hash-bound audited provider bytes


def import_exact_pipeline_class(provider_module: Path, provider_bytes: bytes) -> Any:
    if AUDITED_PIPELINE_MODULE_NAME in sys.modules:
        raise RuntimeError("Pinned provider module name was already populated before its explicit import.")
    loader = AuditedBytesModuleLoader(provider_module, provider_bytes)
    specification = importlib.util.spec_from_file_location(
        AUDITED_PIPELINE_MODULE_NAME,
        provider_module,
        loader=loader,
    )
    if specification is None or specification.loader is None:
        raise RuntimeError("Pinned provider pipeline could not be assigned an explicit file loader.")
    module = importlib.util.module_from_spec(specification)
    sys.modules[AUDITED_PIPELINE_MODULE_NAME] = module
    try:
        specification.loader.exec_module(module)
    except Exception:
        sys.modules.pop(AUDITED_PIPELINE_MODULE_NAME, None)
        raise
    module_file = Path(str(getattr(module, "__file__", ""))).resolve(strict=True)
    if module_file != provider_module.resolve(strict=True):
        raise RuntimeError("Explicit provider import resolved to an unexpected file.")
    pipeline_class = getattr(module, "DifixPipeline", None)
    if pipeline_class is None or pipeline_class.__module__ != AUDITED_PIPELINE_MODULE_NAME:
        raise RuntimeError("Pinned pipeline_difix.py::DifixPipeline was not loaded directly.")
    return pipeline_class


def assert_cache_directory(path: Path, label: str) -> Path:
    metadata = path.stat(follow_symlinks=False)
    if not stat.S_ISDIR(metadata.st_mode) or path.is_symlink():
        raise RuntimeError(f"{label} must be a direct directory.")
    return path.resolve(strict=True)


def audited_vae_cache_evidence(
    pipeline: Any,
    hf_modules_cache: Path,
) -> tuple[dict[str, Any], Path]:
    cache_root = assert_cache_directory(hf_modules_cache, "Attempt-local HF modules cache")
    dynamic_root = assert_cache_directory(hf_modules_cache / "diffusers_modules", "Dynamic module root")
    local_root = assert_cache_directory(hf_modules_cache / "diffusers_modules" / "local", "Local dynamic module root")
    if dynamic_root.parent != cache_root or local_root.parent != dynamic_root:
        raise RuntimeError("Dynamic module cache escaped its exact attempt-local directory hierarchy.")
    expected_copy = hf_modules_cache / "diffusers_modules" / "local" / "autoencoder_kl.py"
    class_file = Path(inspect.getfile(pipeline.vae.__class__)).resolve(strict=True)
    expected_copy_resolved = expected_copy.resolve(strict=True)
    if class_file != expected_copy_resolved:
        raise RuntimeError("Loaded VAE class did not resolve to the exact attempt-local audited copy.")
    try:
        class_file.relative_to(cache_root)
    except ValueError as error:
        raise RuntimeError("Loaded VAE class file escaped the attempt-local HF modules cache.") from error
    copied_receipt = stable_hash(expected_copy, AUDITED_VAE_SHA256, AUDITED_VAE_SIZE)
    expected_module = "diffusers_modules.local.autoencoder_kl"
    actual_module = pipeline.vae.__class__.__module__
    if actual_module != expected_module or pipeline.vae.__class__.__name__ != "AutoencoderKL":
        raise RuntimeError("Loaded VAE class identity differs from the reviewed local custom component.")
    return {
        "deliberatelyExecutedAuditedLocalCustomPython": True,
        "remoteRetrieval": False,
        "sourceRelativePath": "vae/autoencoder_kl.py",
        "sourceSizeBytes": AUDITED_VAE_SIZE,
        "sourceSha256": AUDITED_VAE_SHA256,
        "hfModulesCacheWsl": str(hf_modules_cache),
        "loadedClassModule": actual_module,
        "loadedClassName": pipeline.vae.__class__.__name__,
        "copiedModuleWslPath": str(expected_copy_resolved),
        "copiedModuleSizeBytes": copied_receipt["sizeBytes"],
        "copiedModuleSha256AfterLoad": copied_receipt["sha256"],
        "copiedModuleSha256AfterInference": None,
    }, expected_copy


def load_exact_pipeline(
    provider_module: Path,
    provider_bytes: bytes,
    model_execution_snapshot_root: Path,
    hf_modules_cache: Path,
    torch: Any,
) -> tuple[Any, dict[str, Any], Path]:
    pipeline_class = import_exact_pipeline_class(provider_module, provider_bytes)
    pipeline = pipeline_class.from_pretrained(
        str(model_execution_snapshot_root),
        torch_dtype=torch.float32,
        local_files_only=True,
    )
    if (
        pipeline.__class__.__module__ != AUDITED_PIPELINE_MODULE_NAME
        or pipeline.config.get("requires_safety_checker") is not True
        or pipeline.safety_checker is not None
        or pipeline.feature_extractor is not None
        or getattr(pipeline, "image_encoder", None) is not None
    ):
        raise RuntimeError(
            "Pinned DifixPipeline did not preserve the deliberately audited null safety/component contract."
        )
    custom_component, copied_vae_path = audited_vae_cache_evidence(
        pipeline,
        hf_modules_cache,
    )
    image_processor_class = importlib.import_module(
        "diffusers.image_processor"
    ).VaeImageProcessor
    pipeline.image_processor = image_processor_class(
        vae_scale_factor=pipeline.vae_scale_factor,
        do_resize=False,
        do_convert_rgb=False,
        do_normalize=True,
    )
    pipeline = pipeline.to(device="cuda", dtype=torch.float32)
    for component_name in ("unet", "vae", "text_encoder"):
        component = getattr(pipeline, component_name)
        if component.dtype != torch.float32:
            raise RuntimeError(f"{component_name} is not float32 after exact pipeline placement.")
    return pipeline, custom_component, copied_vae_path


def scheduler_receipt(pipeline: Any) -> tuple[str, str, list[int]]:
    scheduler = pipeline.scheduler
    scheduler_class = f"{scheduler.__class__.__module__}.{scheduler.__class__.__qualname__}"
    config = dict(scheduler.config)
    config_sha256 = domain_digest(
        "VENVIEWER_GRAND_HALL_DIFIX_SCHEDULER_CONFIG_V1", config
    )
    actual_timesteps = [int(value) for value in scheduler.timesteps.detach().cpu().tolist()]
    return scheduler_class, config_sha256, actual_timesteps


def write_output_create_only(image: Any, path: Path) -> tuple[int, str]:
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as stream:
            image.save(stream, format="PNG", optimize=False, compress_level=9)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(descriptor)
    raw = path.read_bytes()
    return len(raw), sha256_bytes(raw)


def finalize_custom_component_evidence(
    evidence: dict[str, Any],
    copied_vae_path: Path,
) -> Mapping[str, Any]:
    after = stable_hash(copied_vae_path, AUDITED_VAE_SHA256, AUDITED_VAE_SIZE)
    evidence["copiedModuleSha256AfterInference"] = after["sha256"]
    return evidence


def actual_runtime_receipt(
    torch: Any,
    pipeline: Any,
    network_before_load: int,
    network_after_load: int,
    args: argparse.Namespace,
) -> Mapping[str, Any]:
    scheduler_class, scheduler_config_sha256, actual_timesteps = scheduler_receipt(pipeline)
    if actual_timesteps != TIMESTEPS:
        raise RuntimeError(f"Scheduler used unexpected timesteps: {actual_timesteps!r}")
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return {
        "schedulerClass": scheduler_class,
        "schedulerConfigSha256": scheduler_config_sha256,
        "timesteps": actual_timesteps,
        "torchDtype": "float32",
        "packages": package_versions(),
        "gpuName": torch.cuda.get_device_name(0),
        "cudaRuntime": str(torch.version.cuda),
        "driverVersion": driver_version(),
        "peakCudaAllocatedBytes": int(torch.cuda.max_memory_allocated()),
        "peakCudaReservedBytes": int(torch.cuda.max_memory_reserved()),
        "peakRssBytes": int(usage.ru_maxrss) * 1024,
        "networkConnectErrnoBeforeLoad": network_before_load,
        "networkConnectErrnoAfterLoad": network_after_load,
        "pythonIsolated": sys.flags.isolated == 1,
        "bytecodeWritesDisabled": sys.dont_write_bytecode,
        "hfModulesCacheWsl": str(args.hf_modules_cache),
        "torchHomeWsl": str(args.torch_home),
        "modelExecutionSnapshotWsl": str(args.model_execution_snapshot),
    }


def run_inference(args: argparse.Namespace) -> int:
    require_isolated_python()
    started_at = utc_now()
    lock = load_execution_lock(
        args.execution_lock,
        args.expected_execution_lock_file_sha256,
        args.expected_execution_lock_size_bytes,
        args.expected_execution_lock_sha256,
    )
    paths = lock["paths"]
    if str(args.execution_lock) != paths["executionLockWsl"]:
        raise RuntimeError("Adapter execution-lock path disagrees with the execution lock.")
    source_receipt = paths["sourceImage"]
    if (
        lock["sourceImageSha256"] != args.expected_source_image_sha256
        or source_receipt["sha256"] != args.expected_source_image_sha256
        or lock["adapterSha256"] != args.expected_adapter_sha256
    ):
        raise RuntimeError("Pre-claim source or adapter binding differs from the execution lock.")
    if str(args.source_image) != paths["sourceImageWsl"]:
        raise RuntimeError("Adapter source path disagrees with the execution lock.")
    if str(args.output_image) != paths["outputImageWsl"]:
        raise RuntimeError("Adapter output path disagrees with the execution lock.")
    if str(args.adapter_receipt) != paths["adapterReceiptWsl"]:
        raise RuntimeError("Adapter receipt path disagrees with the execution lock.")
    if str(args.provider_source_root) != paths["providerSourceRootWsl"]:
        raise RuntimeError("Provider source root disagrees with the execution lock.")
    if str(args.model_snapshot_root) != paths["modelSnapshotRootWsl"]:
        raise RuntimeError("Model snapshot root disagrees with the execution lock.")
    require_exact_attempt_cache_environment(args, paths)
    network_before_load = require_network_unreachable()

    source_bytes = stable_read(
        args.source_image,
        source_receipt["sha256"],
        source_receipt["sizeBytes"],
    )
    source_image = exact_rgb_image(source_bytes)
    torch = importlib.import_module("torch")
    configure_determinism(torch)
    pipeline: Any | None = None
    provider_module, provider_bytes, _model_index, preload_closure, private_snapshot_before = preload_exact_local_code_and_model_closure(
        args.provider_source_root,
        args.model_snapshot_root,
        args.model_execution_snapshot,
    )
    custom_component: dict[str, Any] | None = None
    copied_vae_path: Path | None = None
    network_after_load: int | None = None
    try:
        pipeline, custom_component, copied_vae_path = load_exact_pipeline(
            provider_module,
            provider_bytes,
            args.model_execution_snapshot,
            args.hf_modules_cache,
            torch,
        )
        network_after_load = require_network_unreachable()
        generator = torch.Generator(device="cuda").manual_seed(SEED)
        result = pipeline(
            prompt=PROMPT,
            image=source_image,
            ref_image=None,
            height=HEIGHT,
            width=WIDTH,
            num_inference_steps=1,
            timesteps=TIMESTEPS,
            guidance_scale=0,
            negative_prompt=None,
            num_images_per_prompt=1,
            eta=0,
            generator=generator,
            latents=None,
            prompt_embeds=None,
            negative_prompt_embeds=None,
            ip_adapter_image=None,
            output_type="pil",
            return_dict=True,
            cross_attention_kwargs=None,
            guidance_rescale=0,
            clip_skip=None,
            callback_on_step_end=None,
        )
        images = result.images
        if not isinstance(images, list) or len(images) != 1:
            raise RuntimeError("Difix returned anything other than exactly one image.")
        output = images[0]
        if output.mode != "RGB" or output.size != (WIDTH, HEIGHT):
            raise RuntimeError(
                f"Difix output must be one RGB PIL image at {WIDTH}x{HEIGHT}; got {output.mode!r} {output.size!r}."
            )
        torch.cuda.synchronize()
        custom_component = dict(finalize_custom_component_evidence(custom_component, copied_vae_path))
        private_snapshot = finalize_private_model_execution_snapshot(private_snapshot_before)
        actual = actual_runtime_receipt(
            torch,
            pipeline,
            network_before_load,
            network_after_load,
            args,
        )
        output_size, output_sha256 = write_output_create_only(output, args.output_image)
        receipt: dict[str, Any] = {
            "schemaVersion": ADAPTER_RECEIPT_SCHEMA,
            "outcome": "succeeded",
            "startedAt": started_at,
            "completedAt": utc_now(),
            "sourceImage": {
                "sizeBytes": len(source_bytes),
                "sha256": sha256_bytes(source_bytes),
                "mode": "RGB",
                "width": WIDTH,
                "height": HEIGHT,
            },
            "outputImage": {
                "sizeBytes": output_size,
                "sha256": output_sha256,
                "mode": "RGB",
                "width": WIDTH,
                "height": HEIGHT,
            },
            "actualExecution": actual,
            "preloadClosure": preload_closure,
            "privateModelExecutionSnapshot": private_snapshot,
            "auditedLocalCustomComponent": custom_component,
            "configuration": EXPECTED_CONFIGURATION,
            "authority": {
                "captured": "none",
                "structural": "none",
                "runtime": "none",
                "resultClass": "generated_cinematic_diagnostic",
            },
        }
        receipt["adapterReceiptSha256"] = domain_digest(
            "VENVIEWER_GRAND_HALL_DIFIX_PYTHON_ADAPTER_RECEIPT_V1", receipt
        )
        create_only_json(args.adapter_receipt, receipt)
        sys.stdout.write(canonical_json({"state": "completed", "outputSha256": output_sha256}) + "\n")
        return 0
    except torch.cuda.OutOfMemoryError as error:
        torch.cuda.synchronize()
        if custom_component is not None and copied_vae_path is not None:
            custom_component = dict(finalize_custom_component_evidence(custom_component, copied_vae_path))
        private_snapshot = finalize_private_model_execution_snapshot(private_snapshot_before)
        failure = {
            "schemaVersion": ADAPTER_RECEIPT_SCHEMA,
            "outcome": "out_of_memory",
            "startedAt": started_at,
            "completedAt": utc_now(),
            "sourceImage": {
                "sizeBytes": len(source_bytes),
                "sha256": sha256_bytes(source_bytes),
                "mode": "RGB",
                "width": WIDTH,
                "height": HEIGHT,
            },
            "outputImage": None,
            "actualExecution": actual_runtime_receipt(
                torch,
                pipeline,
                network_before_load,
                network_after_load,
                args,
            ) if pipeline is not None and network_after_load is not None else None,
            "preloadClosure": preload_closure,
            "privateModelExecutionSnapshot": private_snapshot,
            "auditedLocalCustomComponent": custom_component,
            "failureCode": "cuda_out_of_memory",
            "failureType": type(error).__name__,
            "configuration": EXPECTED_CONFIGURATION,
            "authority": {
                "captured": "none",
                "structural": "none",
                "runtime": "none",
                "resultClass": "generated_cinematic_diagnostic",
            },
        }
        failure["adapterReceiptSha256"] = domain_digest(
            "VENVIEWER_GRAND_HALL_DIFIX_PYTHON_ADAPTER_RECEIPT_V1", failure
        )
        create_only_json(args.adapter_receipt, failure)
        sys.stderr.write("VENVIEWER_DIFIX_CUDA_OOM\n")
        return OOM_EXIT_CODE


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("preflight")
    run = subparsers.add_parser("run")
    run.add_argument("--execution-lock", type=Path, required=True)
    run.add_argument("--expected-execution-lock-file-sha256", required=True)
    run.add_argument("--expected-execution-lock-size-bytes", type=int, required=True)
    run.add_argument("--expected-execution-lock-sha256", required=True)
    run.add_argument("--expected-source-image-sha256", required=True)
    run.add_argument("--expected-adapter-sha256", required=True)
    run.add_argument("--attempt-directory", type=Path, required=True)
    run.add_argument("--hf-modules-cache", type=Path, required=True)
    run.add_argument("--torch-home", type=Path, required=True)
    run.add_argument("--model-execution-snapshot", type=Path, required=True)
    run.add_argument("--source-image", type=Path, required=True)
    run.add_argument("--provider-source-root", type=Path, required=True)
    run.add_argument("--model-snapshot-root", type=Path, required=True)
    run.add_argument("--output-image", type=Path, required=True)
    run.add_argument("--adapter-receipt", type=Path, required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "preflight":
        return run_preflight()
    if args.command == "run":
        return run_inference(args)
    raise RuntimeError("Unsupported adapter command.")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - top-level receipt/log boundary
        sys.stderr.write(f"VENVIEWER_DIFIX_ADAPTER_FAILED:{type(error).__name__}:{error}\n")
        raise SystemExit(1) from None
