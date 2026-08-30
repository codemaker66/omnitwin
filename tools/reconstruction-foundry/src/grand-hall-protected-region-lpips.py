#!/usr/bin/env python3
"""Offline, CPU-only, exact-material LPIPS/Alex protected-region evaluator."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import os
import platform
import socket
import sys
import warnings
from pathlib import Path
from typing import Any


SCHEMA = "venviewer.grand-hall.protected-region-lpips-result.v1"
EXPECTED_ALEX_SHA256 = "7be5be791159472b1fbf3c69796f7cb30dca7ad8466c2df70058c37116cdee02"
EXPECTED_ALEX_SIZE = 244_408_911
EXPECTED_CALIBRATION_SHA256 = "df73285e35b22355a2df87cdb6b70b343713b667eddbda73e1977e0c860835c0"
EXPECTED_CALIBRATION_SIZE = 6_009
MAX_IMAGE_BYTES = 256 * 1024 * 1024
EXPECTED_VENV_ROOT = Path("/mnt/f/venviewer-provider-cache/difix3d/c76edc595586e16732c91ddee82f3a6d83a8a9cc/runtime-py312-cu128-v1/venv")


def fail(message: str) -> None:
    raise RuntimeError(message)


def sha256_file(path: Path, expected_size: int | None = None) -> tuple[str, int]:
    before = path.stat()
    if not path.is_file() or before.st_nlink != 1:
        fail(f"{path.name} must be a single-link regular file")
    if before.st_size <= 0 or before.st_size > MAX_IMAGE_BYTES:
        fail(f"{path.name} has an invalid byte length")
    if expected_size is not None and before.st_size != expected_size:
        fail(f"{path.name} byte length does not match its exact lock")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    after = path.stat()
    identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
    identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
    if identity_before != identity_after:
        fail(f"{path.name} changed during hashing")
    return digest.hexdigest(), before.st_size


def stable_bytes(path: Path, expected_size: int | None = None) -> tuple[bytes, str, int]:
    before = path.stat()
    if not path.is_file() or before.st_nlink != 1:
        fail(f"{path.name} must be a single-link regular file")
    if before.st_size <= 0 or before.st_size > MAX_IMAGE_BYTES:
        fail(f"{path.name} has an invalid byte length")
    if expected_size is not None and before.st_size != expected_size:
        fail(f"{path.name} byte length does not match its exact lock")
    with path.open("rb") as handle:
        opened_before = os.fstat(handle.fileno())
        content = handle.read()
        opened_after = os.fstat(handle.fileno())
    after = path.stat()
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
    if identity(before) != identity(opened_before) or identity(opened_before) != identity(opened_after) or identity(opened_after) != identity(after):
        fail(f"{path.name} changed during stable read")
    digest = hashlib.sha256(content).hexdigest()
    return content, digest, len(content)


def exact_path(value: str, label: str) -> Path:
    path = Path(value)
    if not path.is_absolute() or path != Path(os.path.normpath(value)):
        fail(f"{label} must be an absolute normalized path")
    if path.is_symlink() or path.resolve(strict=True) != path:
        fail(f"{label} must not traverse a symlink")
    return path


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--source", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--protected-mask", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--candidate-sha256", required=True)
    parser.add_argument("--protected-mask-sha256", required=True)
    parser.add_argument("--alexnet-weight", required=True)
    parser.add_argument("--calibration-weight", required=True)
    parser.add_argument("--implementation", required=True)
    parser.add_argument("--implementation-sha256", required=True)
    values = parser.parse_args()
    for name in (
        "source_sha256",
        "candidate_sha256",
        "protected_mask_sha256",
        "implementation_sha256",
    ):
        value = getattr(values, name)
        if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
            fail(f"{name} must be a lowercase SHA-256 hex digest")
    return values


def load_rgb(content: bytes, name: str) -> tuple[Any, int, int]:
    from PIL import Image
    import numpy as np
    import torch

    with Image.open(io.BytesIO(content)) as image:
        if image.format != "PNG" or image.mode != "RGB":
            fail(f"{name} must be an RGB PNG")
        width, height = image.size
        if width <= 0 or height <= 0:
            fail(f"{name} has an invalid extent")
        pixels = np.asarray(image, dtype=np.float32)
    if pixels.shape != (height, width, 3):
        fail(f"{name} decoded shape is invalid")
    tensor = torch.from_numpy(pixels.copy()).permute(2, 0, 1).unsqueeze(0).div_(255.0)
    return tensor, width, height


def load_mask(content: bytes, name: str, width: int, height: int) -> tuple[Any, int]:
    from PIL import Image
    import numpy as np
    import torch

    with Image.open(io.BytesIO(content)) as image:
        if image.format != "PNG" or image.mode != "L":
            fail(f"{name} must be a grayscale PNG")
        if image.size != (width, height):
            fail("protected mask extent does not match both images")
        pixels = np.asarray(image, dtype=np.uint8)
    unique = np.unique(pixels)
    if any(int(value) not in (0, 255) for value in unique):
        fail("protected mask must be exactly binary")
    protected_count = int(np.count_nonzero(pixels == 255))
    if protected_count == 0:
        fail("protected mask has no protected pixels")
    return torch.from_numpy((pixels == 255).astype(np.float32)).unsqueeze(0).unsqueeze(0), protected_count


def build_models(alexnet_weight: Path, alexnet_bytes: bytes, calibration_weight: Path, calibration_bytes: bytes) -> tuple[Any, Any]:
    import lpips
    import torch
    from torchvision import models

    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    torch.manual_seed(0)
    torch.use_deterministic_algorithms(True)
    warnings.filterwarnings("ignore", category=UserWarning, module="torchvision.models._utils")
    os.environ["TORCH_HOME"] = str(alexnet_weight.parent.parent.parent)
    reference_model = lpips.LPIPS(
        net="alex",
        version="0.1",
        lpips=True,
        spatial=True,
        pnet_rand=False,
        pnet_tune=False,
        use_dropout=True,
        model_path=str(calibration_weight),
        eval_mode=True,
        verbose=False,
    )
    model = lpips.LPIPS(
        net="alex", version="0.1", lpips=True, spatial=True, pnet_rand=True,
        pnet_tune=False, use_dropout=True, model_path=None, eval_mode=True, verbose=False,
    )
    calibration_state = torch.load(io.BytesIO(calibration_bytes), map_location="cpu", weights_only=True)
    model.load_state_dict(calibration_state, strict=False)
    official = models.alexnet(weights=None)
    official.load_state_dict(torch.load(io.BytesIO(alexnet_bytes), map_location="cpu", weights_only=True), strict=True)
    features = official.features
    reference_slices = [
        reference_model.net.slice1,
        reference_model.net.slice2,
        reference_model.net.slice3,
        reference_model.net.slice4,
        reference_model.net.slice5,
    ]
    official_slices = [features[0:2], features[2:5], features[5:8], features[8:10], features[10:12]]
    for reference_slice, official_slice in zip(reference_slices, official_slices, strict=True):
        for reference_module, official_module in zip(reference_slice, official_slice, strict=True):
            reference_state = reference_module.state_dict()
            official_state = official_module.state_dict()
            if reference_state.keys() != official_state.keys() or any(
                not torch.equal(reference_state[key], official_state[key]) for key in reference_state
            ):
                fail("standard LPIPS AlexNet trunk tensors do not exactly match the official state_dict")
    model.net.slice1 = torch.nn.Sequential(*features[0:2])
    model.net.slice2 = torch.nn.Sequential(*features[2:5])
    model.net.slice3 = torch.nn.Sequential(*features[5:8])
    model.net.slice4 = torch.nn.Sequential(*features[8:10])
    model.net.slice5 = torch.nn.Sequential(*features[10:12])
    for parameter in model.parameters():
        parameter.requires_grad_(False)
    model.eval()
    for manual_linear, reference_linear in zip(model.lins, reference_model.lins, strict=True):
        manual_state = manual_linear.state_dict()
        reference_state = reference_linear.state_dict()
        if manual_state.keys() != reference_state.keys() or any(
            not torch.equal(manual_state[key], reference_state[key]) for key in manual_state
        ):
            fail("in-memory LPIPS calibration tensors do not match standard pnet_rand=False state")
    return model, reference_model


def prove_network_namespace() -> int:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.settimeout(0.25)
    try:
        probe.connect(("1.1.1.1", 53))
    except OSError as error:
        if error.errno != 101:
            fail(f"network namespace probe failed with unexpected errno {error.errno}")
        return int(error.errno)
    finally:
        probe.close()
    fail("network namespace unexpectedly allowed an external connection")


def main() -> None:
    if Path(sys.executable) != EXPECTED_VENV_ROOT / "bin/python" or Path(sys.prefix) != EXPECTED_VENV_ROOT:
        fail("Python interpreter does not match the sealed venv path")
    arguments = parse_arguments()
    paths = {
        "source": exact_path(arguments.source, "source"),
        "candidate": exact_path(arguments.candidate, "candidate"),
        "protected_mask": exact_path(arguments.protected_mask, "protected mask"),
        "alexnet_weight": exact_path(arguments.alexnet_weight, "AlexNet weight"),
        "calibration_weight": exact_path(arguments.calibration_weight, "LPIPS calibration weight"),
        "implementation": exact_path(arguments.implementation, "LPIPS implementation"),
    }
    expected = {
        "source": arguments.source_sha256,
        "candidate": arguments.candidate_sha256,
        "protected_mask": arguments.protected_mask_sha256,
        "implementation": arguments.implementation_sha256,
    }
    receipts: dict[str, dict[str, Any]] = {}
    contents: dict[str, bytes] = {}
    for role in ("source", "candidate", "protected_mask", "implementation"):
        content, digest, size = stable_bytes(paths[role])
        if digest != expected[role]:
            fail(f"{role} bytes do not match the exact caller binding")
        contents[role] = content
        receipts[role] = {"sha256": f"sha256:{digest}", "sizeBytes": size}
    alex_bytes, alex_digest, alex_size = stable_bytes(paths["alexnet_weight"], EXPECTED_ALEX_SIZE)
    calibration_bytes, calibration_digest, calibration_size = stable_bytes(paths["calibration_weight"], EXPECTED_CALIBRATION_SIZE)
    if alex_digest != EXPECTED_ALEX_SHA256 or calibration_digest != EXPECTED_CALIBRATION_SHA256:
        fail("LPIPS weights do not match the pinned exact-byte lock")

    network_errno = prove_network_namespace()
    import lpips
    import torch
    import torchvision

    source, width, height = load_rgb(contents["source"], paths["source"].name)
    candidate, candidate_width, candidate_height = load_rgb(contents["candidate"], paths["candidate"].name)
    if (candidate_width, candidate_height) != (width, height):
        fail("source and candidate extents differ")
    mask, protected_count = load_mask(contents["protected_mask"], paths["protected_mask"].name, width, height)
    model, reference_model = build_models(
        paths["alexnet_weight"], alex_bytes, paths["calibration_weight"], calibration_bytes
    )
    with torch.inference_mode():
        spatial = model(source, candidate, normalize=True)
        if tuple(spatial.shape) != (1, 1, height, width):
            fail("LPIPS spatial result extent does not match the native input extent")
        raw_value = float((spatial * mask).sum(dtype=torch.float64).item() / protected_count)
        reference_spatial = reference_model(source, candidate, normalize=True)
        raw_reference_value = float((reference_spatial * mask).sum(dtype=torch.float64).item() / protected_count)
        parity_difference = abs(raw_value - raw_reference_value)
        if parity_difference > 1e-8:
            fail(
                "manual exact-weight AlexNet replacement does not match standard LPIPS "
                f"(manual={raw_value:.17g}, standard={raw_reference_value:.17g}, difference={parity_difference:.17g})"
            )
        value = max(0.0, raw_value)
    if not torch.isfinite(torch.tensor(value)) or not torch.isfinite(torch.tensor(raw_value)):
        fail("protected LPIPS is not finite")

    for role in ("source", "candidate", "protected_mask", "implementation"):
        repeated_digest, repeated_size = sha256_file(paths[role])
        if receipts[role] != {"sha256": f"sha256:{repeated_digest}", "sizeBytes": repeated_size}:
            fail(f"{role} changed during evaluation")
    repeated_alex_digest, repeated_alex_size = sha256_file(paths["alexnet_weight"], EXPECTED_ALEX_SIZE)
    repeated_calibration_digest, repeated_calibration_size = sha256_file(
        paths["calibration_weight"], EXPECTED_CALIBRATION_SIZE
    )
    if (repeated_alex_digest, repeated_alex_size) != (alex_digest, alex_size):
        fail("AlexNet weight changed during evaluation")
    if (repeated_calibration_digest, repeated_calibration_size) != (calibration_digest, calibration_size):
        fail("LPIPS calibration weight changed during evaluation")
    result = {
        "schemaVersion": SCHEMA,
        "authority": "none",
        "device": "cpu",
        "deterministicAlgorithms": True,
        "nativeWidth": width,
        "nativeHeight": height,
        "protectedPixelCount": protected_count,
        "protectedRegionLpips": value,
        "rawProtectedRegionLpips": raw_value,
        "rawStandardProtectedRegionLpips": raw_reference_value,
        "standardParityAbsoluteDifference": parity_difference,
        "networkNamespaceProbeErrno": network_errno,
        "aggregation": "arithmetic_mean_of_spatial_lpips_over_binary_protected_mask",
        "aggregateProjection": "protected_region_lpips_equals_max_zero_raw_masked_mean",
        "lpipsVersion": importlib.metadata.version("lpips"),
        "torchVersion": torch.__version__,
        "torchvisionVersion": torchvision.__version__,
        "pythonVersion": platform.python_version(),
        "inputs": receipts,
        "weights": {
            "alexnet": {"sha256": f"sha256:{alex_digest}", "sizeBytes": alex_size},
            "calibration": {"sha256": f"sha256:{calibration_digest}", "sizeBytes": calibration_size},
        },
    }
    sys.stdout.write(json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(json.dumps({"code": "LPIPS_FAILED", "error": str(error)}, sort_keys=True, separators=(",", ":")) + "\n")
        raise SystemExit(1)
