"""Deterministic, authority-none preflight for the Venviewer gsplat recipe.

This module validates configuration and dataset contracts only.  It never
starts model optimization, imports the upstream Tyro entrypoint, contacts a
provider, or writes a D-014 candidate.  Actual splat training remains RunPod
only under D-016 and the Foundry execution gates.
"""

from __future__ import annotations

import hashlib
import importlib.metadata as importlib_metadata
import importlib.util as importlib_util
import json
import math
import os
import re
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Mapping, Sequence


PREFLIGHT_SCHEMA_VERSION = "venviewer.trainer-contract-preflight.v0"
SOURCE_LOCK_SCHEMA_VERSION = "venviewer.gsplat-source-lock.v0"
SOURCE_LOCK_FILENAME = "gsplat-v1.5.3.source-lock.json"

CONFIG_KEYS = frozenset(
    {
        "max_steps",
        "save_steps",
        "ply_steps",
        "eval_steps",
        "sh_degree",
        "antialiased",
        "strategy",
        "post_processing",
        "bilateral_grid_shape",
        "depth_loss",
        "depth_lambda",
        "with_ut",
        "with_eval3d",
        "pose_opt",
        "app_opt",
        "save_ply",
        "disable_viewer",
        "data_factor",
    }
)

STRATEGY_KEYS = frozenset(
    {
        "type",
        "cap_max",
        "noise_lr",
        "refine_start_iter",
        "refine_stop_iter",
        "noise_injection_stop_iter",
        "refine_every",
        "min_opacity",
    }
)

UPSTREAM_BINDINGS: dict[str, str] = {
    "antialiased": "Config.antialiased",
    "app_opt": "Config.app_opt",
    "bilateral_grid_shape": "Config.bilateral_grid_shape",
    "data_factor": "Config.data_factor",
    "depth_lambda": "Config.depth_lambda",
    "depth_loss": "Config.depth_loss",
    "disable_viewer": "Config.disable_viewer",
    "eval_steps": "Config.eval_steps",
    "max_steps": "Config.max_steps",
    "ply_steps": "Config.ply_steps",
    "pose_opt": "Config.pose_opt",
    "post_processing": "Config.use_bilateral_grid",
    "save_ply": "Config.save_ply",
    "save_steps": "Config.save_steps",
    "sh_degree": "Config.sh_degree",
    "strategy.cap_max": "MCMCStrategy.cap_max",
    "strategy.min_opacity": "MCMCStrategy.min_opacity",
    "strategy.noise_injection_stop_iter": "MCMCStrategy.noise_injection_stop_iter",
    "strategy.noise_lr": "MCMCStrategy.noise_lr",
    "strategy.refine_every": "MCMCStrategy.refine_every",
    "strategy.refine_start_iter": "MCMCStrategy.refine_start_iter",
    "strategy.refine_stop_iter": "MCMCStrategy.refine_stop_iter",
    "strategy.type": "Tyro preset mcmc",
    "with_eval3d": "Config.with_eval3d",
    "with_ut": "Config.with_ut",
}

MCMC_INHERITED_DEFAULTS: dict[str, Any] = {
    "init_opa": 0.5,
    "init_scale": 0.1,
    "opacity_reg": 0.01,
    "scale_reg": 0.01,
    "strategy_verbose": True,
}

UPSTREAM_INHERITED_CONFIG_DEFAULTS: dict[str, Any] = {
    "test_every": 8,
}

# T-514 freezes one exact comparison recipe.  Structural validation alone is
# not enough: an in-range change such as a different Gaussian cap or depth
# weight would silently turn the later LCC2 bake-off into a different
# experiment.  Keep the expected normalized values here so comments and YAML
# formatting may change without allowing any recipe value to drift.
FROZEN_CONFIG_B_NORMALIZED: dict[str, Any] = {
    "preset": "mcmc",
    "max_steps": 30_000,
    "save_steps": [
        1_000,
        2_000,
        3_000,
        4_000,
        5_000,
        7_000,
        10_000,
        15_000,
        20_000,
        25_000,
        30_000,
    ],
    "ply_steps": [30_000],
    "eval_steps": [7_000, 15_000, 30_000],
    "sh_degree": 3,
    "antialiased": True,
    "strategy": {
        "type": "MCMCStrategy",
        "cap_max": 5_000_000,
        "noise_lr": 500_000.0,
        "refine_start_iter": 500,
        "refine_stop_iter": 25_000,
        "noise_injection_stop_iter": 24_000,
        "refine_every": 100,
        "min_opacity": 0.005,
        "verbose": True,
    },
    "use_bilateral_grid": True,
    "bilateral_grid_shape": [16, 16, 8],
    "depth_loss": True,
    "depth_lambda": 0.02,
    "with_ut": True,
    "with_eval3d": True,
    "pose_opt": False,
    "app_opt": False,
    "save_ply": True,
    "disable_viewer": True,
    "data_factor": 2,
    **UPSTREAM_INHERITED_CONFIG_DEFAULTS,
    **MCMC_INHERITED_DEFAULTS,
}

FORBIDDEN_LEGACY_ARGUMENTS = ("default", "--config", "--external-depth-dir")

RUNTIME_MODULES: tuple[tuple[str, str | None], ...] = (
    ("torch", "2.4.1"),
    ("gsplat", "1.5.3"),
    ("numpy", "1.26.4"),
    ("yaml", "6.0.2"),
    ("tyro", "0.8.10"),
    ("imageio", None),
    ("viser", None),
    ("nerfview", None),
    ("torchmetrics", None),
    ("tensorboard", None),
    ("cv2", None),
    ("PIL", None),
    ("sklearn", None),
    ("tqdm", None),
    ("pycolmap", None),
    ("scipy", None),
    ("tensorly", None),
    ("matplotlib", None),
    ("typing_extensions", None),
    ("fused_ssim", None),
)

RUNTIME_DISTRIBUTIONS: dict[str, tuple[str, ...]] = {
    "torch": ("torch",),
    "gsplat": ("gsplat",),
    "numpy": ("numpy",),
    "yaml": ("PyYAML",),
    "tyro": ("tyro",),
    "imageio": ("imageio",),
    "viser": ("viser",),
    "nerfview": ("nerfview",),
    "torchmetrics": ("torchmetrics",),
    "tensorboard": ("tensorboard",),
    "cv2": ("opencv-python", "opencv-python-headless", "opencv-contrib-python"),
    "PIL": ("Pillow",),
    "sklearn": ("scikit-learn",),
    "tqdm": ("tqdm",),
    "pycolmap": ("pycolmap",),
    "scipy": ("scipy",),
    "tensorly": ("tensorly",),
    "matplotlib": ("matplotlib",),
    "typing_extensions": ("typing_extensions",),
    "fused_ssim": ("fused-ssim", "fused_ssim"),
}

EXPECTED_SOURCE_CLOSURE: dict[str, tuple[int, str]] = {
    "examples/datasets/colmap.py": (
        18_447,
        "2aa364ecfd2d7dd715ede5192fccd533982edf3be68b98008440a5aedf3b3fed",
    ),
    "examples/datasets/normalize.py": (
        4_650,
        "019be99afb9cf947842b42c149fb5baecd840847795b0d63e6596d86aa7f79b3",
    ),
    "examples/datasets/traj.py": (
        9_447,
        "69eb03c2b9d04c88bc2d4c4e0a5f398a51b8079889f3aea83775328f455ff936",
    ),
    "examples/gsplat_viewer.py": (
        9_675,
        "c4037793460b1c0fd1f895eed80ba373492136b7c1845f8ddea5f3173838d71a",
    ),
    "examples/lib_bilagrid.py": (
        22_151,
        "fefcebafdf7e8c533fe8c0c83c67a81b010ecc2e4b99677a49528307a306f4b2",
    ),
    "examples/requirements.txt": (
        677,
        "c488a9146f7428560b24cfc7a01455808f356d4c8468641b23277c9236bbcc8a",
    ),
    "examples/simple_trainer.py": (
        49_728,
        "79319e1cd7404e4d1ba0c425634235c39e6054f0643b904a01feea6179462c05",
    ),
    "examples/utils.py": (
        7_519,
        "44a38b236940706705c9351b365be6bd21d49efc57dd695ba5a7e70055b959e1",
    ),
}

RUNTIME_BLOCKERS = (
    "d014_bilateral_grid_serialization_is_undefined",
    "external_e57_depth_is_not_wired_into_upstream_runner",
    "legacy_runpod_runner_is_disabled_by_execution_policy",
    "runtime_dependency_closure_is_not_fully_pinned_or_proven",
    "training_metrics_and_heldout_bundle_production_are_not_proven",
    "trusted_jobspec_rights_confirmation_and_compute_approval_are_required",
    "upstream_tyro_runtime_translation_has_not_run_in_the_pinned_image",
)


class TrainerContractError(Exception):
    """Stable expected failure for machine-readable preflight output."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _reject_duplicate_pairs(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise TrainerContractError("DUPLICATE_KEY", f"duplicate key: {key}")
        result[key] = value
    return result


def canonical_json_bytes(value: Any) -> bytes:
    """Return the repository's compact, sorted, UTF-8 JSON representation."""

    return (
        json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path, chunk_size: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while True:
            block = source.read(chunk_size)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def _regular_file(path: Path, label: str, maximum_bytes: int) -> bytes:
    if path.is_symlink():
        raise TrainerContractError("UNSAFE_FILE", f"{label} must not be a symlink")
    if not path.exists():
        raise TrainerContractError("MISSING_FILE", f"missing {label}")
    if not path.is_file():
        raise TrainerContractError("UNSAFE_FILE", f"{label} must be a regular file")
    size_before = path.stat().st_size
    if size_before > maximum_bytes:
        raise TrainerContractError("FILE_TOO_LARGE", f"{label} exceeds {maximum_bytes} bytes")
    data = path.read_bytes()
    if len(data) != size_before or path.stat().st_size != size_before:
        raise TrainerContractError("FILE_CHANGED_DURING_READ", f"{label} changed while read")
    return data


def _strict_yaml_load(data: bytes) -> dict[str, Any]:
    try:
        import yaml
    except Exception as error:  # noqa: BLE001 - stable boundary
        raise TrainerContractError(
            "MISSING_DEPENDENCY", "PyYAML is required for trainer-contract preflight"
        ) from error

    class UniqueKeyLoader(yaml.SafeLoader):
        pass

    def construct_mapping(loader: Any, node: Any, deep: bool = False) -> dict[str, Any]:
        loader.flatten_mapping(node)
        pairs: list[tuple[str, Any]] = []
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node, deep=deep)
            if not isinstance(key, str):
                raise TrainerContractError("INVALID_KEY", "YAML mapping keys must be strings")
            value = loader.construct_object(value_node, deep=deep)
            pairs.append((key, value))
        return _reject_duplicate_pairs(pairs)

    UniqueKeyLoader.add_constructor(
        yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, construct_mapping
    )
    try:
        parsed = yaml.load(data.decode("utf-8", errors="strict"), Loader=UniqueKeyLoader)
    except TrainerContractError:
        raise
    except UnicodeDecodeError as error:
        raise TrainerContractError("INVALID_UTF8", "config must be UTF-8") from error
    except yaml.YAMLError as error:
        raise TrainerContractError("INVALID_YAML", "config is not valid YAML") from error
    if not isinstance(parsed, dict):
        raise TrainerContractError("INVALID_CONFIG", "config root must be a mapping")
    return parsed


def _require_exact_keys(value: Mapping[str, Any], expected: frozenset[str], label: str) -> None:
    actual = frozenset(value.keys())
    unknown = sorted(actual - expected)
    missing = sorted(expected - actual)
    if unknown:
        raise TrainerContractError("UNKNOWN_CONFIG_FIELD", f"{label} has unknown fields: {unknown}")
    if missing:
        raise TrainerContractError("MISSING_CONFIG_FIELD", f"{label} lacks fields: {missing}")


def _bool(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise TrainerContractError("INVALID_CONFIG_TYPE", f"{label} must be boolean")
    return value


def _int(value: Any, label: str, minimum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TrainerContractError("INVALID_CONFIG_TYPE", f"{label} must be an integer")
    if minimum is not None and value < minimum:
        raise TrainerContractError("INVALID_CONFIG_VALUE", f"{label} must be >= {minimum}")
    return value


def _number(value: Any, label: str, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TrainerContractError("INVALID_CONFIG_TYPE", f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise TrainerContractError("INVALID_CONFIG_VALUE", f"{label} must be finite")
    if minimum is not None and result < minimum:
        raise TrainerContractError("INVALID_CONFIG_VALUE", f"{label} must be >= {minimum}")
    return result


def _steps(value: Any, label: str, max_steps: int) -> list[int]:
    if not isinstance(value, list) or not value:
        raise TrainerContractError("INVALID_CONFIG_TYPE", f"{label} must be a non-empty list")
    result = [_int(item, f"{label}[{index}]", 1) for index, item in enumerate(value)]
    if result != sorted(set(result)):
        raise TrainerContractError(
            "INVALID_CONFIG_VALUE", f"{label} must be strictly increasing and unique"
        )
    if result[-1] > max_steps:
        raise TrainerContractError("INVALID_CONFIG_VALUE", f"{label} exceeds max_steps")
    return result


def normalize_training_config(config_bytes: bytes) -> dict[str, Any]:
    """Validate Config B shape and return a complete normalized MCMC snapshot."""

    raw = _strict_yaml_load(config_bytes)
    _require_exact_keys(raw, CONFIG_KEYS, "config")

    max_steps = _int(raw["max_steps"], "max_steps", 1)
    strategy_raw = raw["strategy"]
    if not isinstance(strategy_raw, dict):
        raise TrainerContractError("INVALID_CONFIG_TYPE", "strategy must be a mapping")
    _require_exact_keys(strategy_raw, STRATEGY_KEYS, "strategy")
    if strategy_raw["type"] != "MCMCStrategy":
        raise TrainerContractError(
            "UNSUPPORTED_STRATEGY", "strategy.type must be MCMCStrategy"
        )

    refine_start = _int(strategy_raw["refine_start_iter"], "strategy.refine_start_iter", 0)
    refine_stop = _int(strategy_raw["refine_stop_iter"], "strategy.refine_stop_iter", 1)
    if not refine_start < refine_stop <= max_steps:
        raise TrainerContractError(
            "INVALID_CONFIG_VALUE",
            "strategy refine range must satisfy start < stop <= max_steps",
        )
    noise_stop = _int(
        strategy_raw["noise_injection_stop_iter"],
        "strategy.noise_injection_stop_iter",
    )
    if noise_stop != -1 and not refine_start <= noise_stop <= refine_stop:
        raise TrainerContractError(
            "INVALID_CONFIG_VALUE",
            "noise_injection_stop_iter must be -1 or inside the refine range",
        )
    min_opacity = _number(strategy_raw["min_opacity"], "strategy.min_opacity", 0.0)
    if min_opacity > 1.0:
        raise TrainerContractError("INVALID_CONFIG_VALUE", "strategy.min_opacity must be <= 1")

    grid = raw["bilateral_grid_shape"]
    if not isinstance(grid, list) or len(grid) != 3:
        raise TrainerContractError(
            "INVALID_CONFIG_TYPE", "bilateral_grid_shape must have three integers"
        )
    grid_values = [_int(item, f"bilateral_grid_shape[{index}]", 1) for index, item in enumerate(grid)]

    post_processing = raw["post_processing"]
    if post_processing != "bilateral_grid":
        raise TrainerContractError(
            "UNSUPPORTED_POST_PROCESSING",
            "Config B preflight requires post_processing=bilateral_grid",
        )

    antialiased = _bool(raw["antialiased"], "antialiased")
    if not antialiased:
        raise TrainerContractError(
            "INVALID_CONFIG_VALUE", "Config B requires antialiased=true"
        )

    with_ut = _bool(raw["with_ut"], "with_ut")
    with_eval3d = _bool(raw["with_eval3d"], "with_eval3d")
    if with_ut != with_eval3d:
        raise TrainerContractError(
            "DISCONNECTED_CONFIG_FIELD", "with_ut and with_eval3d must be enabled together"
        )
    if not with_ut:
        raise TrainerContractError(
            "INVALID_CONFIG_VALUE", "Config B requires with_ut=true and with_eval3d=true"
        )
    depth_loss = _bool(raw["depth_loss"], "depth_loss")
    depth_lambda = _number(raw["depth_lambda"], "depth_lambda", 0.0)
    if not depth_loss and depth_lambda != 0.0:
        raise TrainerContractError(
            "DISCONNECTED_CONFIG_FIELD", "depth_lambda must be zero when depth_loss is disabled"
        )
    if not depth_loss:
        raise TrainerContractError(
            "INVALID_CONFIG_VALUE", "Config B requires depth_loss=true"
        )
    if depth_lambda <= 0.0:
        raise TrainerContractError(
            "INVALID_CONFIG_VALUE", "Config B requires depth_lambda to be greater than zero"
        )
    if _bool(raw["pose_opt"], "pose_opt") or _bool(raw["app_opt"], "app_opt"):
        raise TrainerContractError(
            "UNPROVEN_CONFIG_MODE", "pose_opt and app_opt are not part of the frozen Config B proof"
        )
    if not _bool(raw["save_ply"], "save_ply"):
        raise TrainerContractError("INVALID_CONFIG_VALUE", "save_ply must be enabled")
    if not _bool(raw["disable_viewer"], "disable_viewer"):
        raise TrainerContractError("INVALID_CONFIG_VALUE", "disable_viewer must be enabled")

    strategy = {
        "type": "MCMCStrategy",
        "cap_max": _int(strategy_raw["cap_max"], "strategy.cap_max", 1),
        "noise_lr": _number(strategy_raw["noise_lr"], "strategy.noise_lr", 0.0),
        "refine_start_iter": refine_start,
        "refine_stop_iter": refine_stop,
        "noise_injection_stop_iter": noise_stop,
        "refine_every": _int(strategy_raw["refine_every"], "strategy.refine_every", 1),
        "min_opacity": min_opacity,
        "verbose": True,
    }
    normalized = {
        "preset": "mcmc",
        "max_steps": max_steps,
        "save_steps": _steps(raw["save_steps"], "save_steps", max_steps),
        "ply_steps": _steps(raw["ply_steps"], "ply_steps", max_steps),
        "eval_steps": _steps(raw["eval_steps"], "eval_steps", max_steps),
        "sh_degree": _int(raw["sh_degree"], "sh_degree", 0),
        "antialiased": antialiased,
        "strategy": strategy,
        "use_bilateral_grid": True,
        "bilateral_grid_shape": grid_values,
        "depth_loss": depth_loss,
        "depth_lambda": depth_lambda,
        "with_ut": with_ut,
        "with_eval3d": with_eval3d,
        "pose_opt": False,
        "app_opt": False,
        "save_ply": True,
        "disable_viewer": True,
        "data_factor": _int(raw["data_factor"], "data_factor", 1),
        **UPSTREAM_INHERITED_CONFIG_DEFAULTS,
        **MCMC_INHERITED_DEFAULTS,
    }
    if normalized["sh_degree"] > 4:
        raise TrainerContractError("INVALID_CONFIG_VALUE", "sh_degree must be between 0 and 4")
    if normalized != FROZEN_CONFIG_B_NORMALIZED:
        raise TrainerContractError(
            "CONFIG_B_DRIFT",
            "Config B values differ from the frozen Reception Room comparison recipe",
        )
    return normalized


def compile_canonical_argv(config: Mapping[str, Any]) -> list[str]:
    """Compile the audited Tyro spelling without claiming runtime execution proof."""

    strategy = config["strategy"]
    assert isinstance(strategy, Mapping)
    argv = [
        "mcmc",
        "--max-steps",
        str(config["max_steps"]),
        "--save-steps",
        *[str(value) for value in config["save_steps"]],
        "--ply-steps",
        *[str(value) for value in config["ply_steps"]],
        "--eval-steps",
        *[str(value) for value in config["eval_steps"]],
        "--sh-degree",
        str(config["sh_degree"]),
        "--antialiased",
        "--strategy.cap-max",
        str(strategy["cap_max"]),
        "--strategy.noise-lr",
        str(strategy["noise_lr"]),
        "--strategy.refine-start-iter",
        str(strategy["refine_start_iter"]),
        "--strategy.refine-stop-iter",
        str(strategy["refine_stop_iter"]),
        "--strategy.noise-injection-stop-iter",
        str(strategy["noise_injection_stop_iter"]),
        "--strategy.refine-every",
        str(strategy["refine_every"]),
        "--strategy.min-opacity",
        str(strategy["min_opacity"]),
        "--use-bilateral-grid",
        "--bilateral-grid-shape",
        *[str(value) for value in config["bilateral_grid_shape"]],
        "--depth-loss",
        "--depth-lambda",
        str(config["depth_lambda"]),
        "--with-ut",
        "--with-eval3d",
        "--no-pose-opt",
        "--no-app-opt",
        "--save-ply",
        "--disable-viewer",
        "--data-factor",
        str(config["data_factor"]),
    ]
    if any(argument in argv for argument in FORBIDDEN_LEGACY_ARGUMENTS):
        raise TrainerContractError("LEGACY_ARGUMENT", "compiled argv contains a forbidden argument")
    return argv


def _load_source_lock(path: Path) -> tuple[dict[str, Any], str]:
    data = _regular_file(path, "gsplat source lock", 256 * 1024)
    try:
        value = json.loads(data.decode("utf-8", errors="strict"), object_pairs_hook=_reject_duplicate_pairs)
    except TrainerContractError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock is invalid JSON") from error
    if not isinstance(value, dict) or value.get("schemaVersion") != SOURCE_LOCK_SCHEMA_VERSION:
        raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock schema is unsupported")
    expected_top_keys = {
        "schemaVersion",
        "project",
        "repository",
        "tag",
        "releaseArchive",
        "license",
        "requiredSourceClosure",
        "apiContract",
        "runtimeStatus",
    }
    if set(value) != expected_top_keys:
        raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock fields are not exact")
    if (
        value.get("project") != "nerfstudio-project/gsplat"
        or value.get("repository") != "https://github.com/nerfstudio-project/gsplat"
        or value.get("tag") != "v1.5.3"
        or value.get("releaseArchive")
        != {
            "url": "https://github.com/nerfstudio-project/gsplat/archive/refs/tags/v1.5.3.tar.gz",
            "byteSize": 27_454_693,
            "sha256": "8a24428b8ea2ce7c3e10fcf5aa20e20fe503b8329c96db797f4eab703729aac3",
        }
        or value.get("license")
        != {
            "spdx": "Apache-2.0",
            "sourceUrl": "https://raw.githubusercontent.com/nerfstudio-project/gsplat/v1.5.3/LICENSE",
            "byteSize": 11_345,
            "sha256": "96a4f89293c0df19880da9b0e35f67589f5885ea61b224ef16bb2bd599a8a44d",
            "legalReviewStatus": "recorded_not_legal_advice",
        }
    ):
        raise TrainerContractError(
            "INVALID_SOURCE_LOCK", "source lock project, release, or licence identity is wrong"
        )
    expected_api_contract = {
        "targetPython": "3.10",
        "declaredTyroVersion": "0.8.10",
        "entrypointSignature": "main(local_rank, world_rank, world_size, cfg)",
        "preset": "mcmc",
        "inheritedConfigDefaults": {"test_every": 8},
        "inheritedMcmcDefaults": {
            "init_opa": 0.5,
            "init_scale": 0.1,
            "opacity_reg": 0.01,
            "scale_reg": 0.01,
            "strategy.verbose": True,
        },
    }
    expected_runtime_status = {
        "sourceVendored": False,
        "dependencyClosurePinned": False,
        "upstreamCliImported": False,
        "externalE57DepthWired": False,
        "trainingMetricsJsonlProduced": False,
        "d014BilateralGridSerializationDefined": False,
        "legacyRunnerEnabled": False,
    }
    if value.get("apiContract") != expected_api_contract:
        raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock API contract is wrong")
    if value.get("runtimeStatus") != expected_runtime_status:
        raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock runtime status is wrong")
    closure = value.get("requiredSourceClosure")
    if not isinstance(closure, list) or len(closure) != len(EXPECTED_SOURCE_CLOSURE):
        raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock closure is incomplete")
    actual_closure: dict[str, tuple[int, str]] = {}
    for entry in closure:
        if not isinstance(entry, dict) or set(entry) != {"path", "byteSize", "sha256"}:
            raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock entry is invalid")
        relative = entry.get("path")
        byte_size = entry.get("byteSize")
        digest = entry.get("sha256")
        if not isinstance(relative, str):
            raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock path is invalid")
        pure_path = PurePosixPath(relative)
        if (
            not pure_path.parts
            or pure_path.is_absolute()
            or pure_path.as_posix() != relative
            or "\\" in relative
            or any(part in {"", ".", ".."} for part in pure_path.parts)
        ):
            raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock path is unsafe")
        if isinstance(byte_size, bool) or not isinstance(byte_size, int) or byte_size <= 0:
            raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock byte size is invalid")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock hash is invalid")
        if relative in actual_closure:
            raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock path is duplicated")
        actual_closure[relative] = (byte_size, digest)
    if actual_closure != EXPECTED_SOURCE_CLOSURE:
        raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock closure identity is wrong")
    if [entry["path"] for entry in closure] != list(EXPECTED_SOURCE_CLOSURE):
        raise TrainerContractError("INVALID_SOURCE_LOCK", "source lock closure order is not canonical")
    return value, sha256_bytes(data)


def _source_closure_probe(lock: Mapping[str, Any]) -> dict[str, Any]:
    root_value = os.environ.get("VENVIEWER_GSPLAT_SOURCE_ROOT")
    if not root_value:
        return {"present": False, "verified": False, "files": []}
    root = Path(root_value)
    if root.is_symlink() or not root.is_dir():
        return {"present": False, "verified": False, "files": []}
    files: list[dict[str, Any]] = []
    verified = True
    for entry in lock["requiredSourceClosure"]:
        relative = str(entry["path"])
        candidate = root.joinpath(*PurePosixPath(relative).parts)
        unsafe_parent = any(
            parent.is_symlink()
            for parent in [candidate.parent, *candidate.parents]
            if parent != root.parent
        )
        present = candidate.is_file() and not candidate.is_symlink() and not unsafe_parent
        actual_hash: str | None = None
        actual_size: int | None = None
        if present:
            try:
                source_bytes = _regular_file(candidate, relative, int(entry["byteSize"]))
            except TrainerContractError:
                present = False
            else:
                actual_hash = sha256_bytes(source_bytes)
                actual_size = len(source_bytes)
        matches = bool(
            present
            and actual_hash == entry["sha256"]
            and actual_size == entry["byteSize"]
        )
        verified = verified and matches
        files.append({"path": relative, "present": present, "matchesLock": matches})
    return {"present": all(item["present"] for item in files), "verified": verified, "files": files}


def probe_runtime_dependencies(
    importer: Callable[[str], Any] | None = None,
) -> list[dict[str, Any]]:
    """Probe availability without importing third-party code by default.

    An injected importer remains available for focused tests.  Normal preflight
    uses module specifications plus installed-package metadata, which avoids
    executing package import hooks while still exposing missing/version-mismatched
    dependencies as blockers.
    """

    rows: list[dict[str, Any]] = []
    for module_name, expected_version in RUNTIME_MODULES:
        if importer is not None:
            try:
                module = importer(module_name)
                version_value = getattr(module, "__version__", None)
                version = str(version_value) if version_value is not None else "unknown"
                matches = expected_version is None or version == expected_version or version.startswith(
                    expected_version + "+"
                )
                rows.append(
                    {
                        "module": module_name,
                        "available": True,
                        "probeExecutedImport": True,
                        "probeMethod": "injected_importer",
                        "version": version,
                        "expectedVersion": expected_version,
                        "matchesExpected": matches,
                    }
                )
                continue
            except Exception as error:  # noqa: BLE001 - dependency boundary
                rows.append(
                    {
                        "module": module_name,
                        "available": False,
                        "probeExecutedImport": True,
                        "probeMethod": "injected_importer",
                        "version": None,
                        "expectedVersion": expected_version,
                        "matchesExpected": False,
                        "errorType": type(error).__name__,
                    }
                )
                continue

        try:
            available = importlib_util.find_spec(module_name) is not None
        except (ImportError, AttributeError, ValueError):
            available = False
        if not available:
            rows.append(
                {
                    "module": module_name,
                    "available": False,
                    "probeExecutedImport": False,
                    "probeMethod": "module_spec_and_distribution_metadata",
                    "version": None,
                    "expectedVersion": expected_version,
                    "matchesExpected": False,
                    "errorType": "ModuleNotFoundError",
                }
            )
            continue

        version = "unknown"
        for distribution_name in RUNTIME_DISTRIBUTIONS[module_name]:
            try:
                version = importlib_metadata.version(distribution_name)
                break
            except importlib_metadata.PackageNotFoundError:
                continue
        matches = expected_version is None or version == expected_version or version.startswith(
            expected_version + "+"
        )
        rows.append(
            {
                "module": module_name,
                "available": True,
                "probeExecutedImport": False,
                "probeMethod": "module_spec_and_distribution_metadata",
                "version": version,
                "expectedVersion": expected_version,
                "matchesExpected": matches,
            }
        )
    return rows


def build_preflight_receipt(
    *,
    config_path: Path,
    dataset_root: Path,
    depth_dir: Path,
    runtime_probe: Callable[[], list[dict[str, Any]]] = probe_runtime_dependencies,
) -> dict[str, Any]:
    """Validate exact inputs and build a canonical authority-none receipt."""

    config_bytes = _regular_file(config_path, "training config", 1024 * 1024)
    normalized_config = normalize_training_config(config_bytes)
    canonical_argv = compile_canonical_argv(normalized_config)

    from venviewer_training.colmap_contract import (  # lazy so --help stays dependency-light
        ColmapContractError,
        validate_colmap_training_contract,
    )

    try:
        dataset = validate_colmap_training_contract(
            dataset_root,
            depth_dir,
            depth_required=bool(normalized_config["depth_loss"]),
            data_factor=int(normalized_config["data_factor"]),
            test_every=int(normalized_config["test_every"]),
        )
    except ColmapContractError as error:
        raise TrainerContractError(error.code, error.message) from error

    source_lock_path = Path(__file__).resolve().parent / SOURCE_LOCK_FILENAME
    source_lock, source_lock_digest = _load_source_lock(source_lock_path)
    dependencies = runtime_probe()
    source_probe = _source_closure_probe(source_lock)

    runtime_ready = bool(
        source_probe["verified"]
        and all(row["available"] and row["matchesExpected"] for row in dependencies)
        and not RUNTIME_BLOCKERS
    )
    payload: dict[str, Any] = {
        "schemaVersion": PREFLIGHT_SCHEMA_VERSION,
        "authority": "none",
        "decision": "contract_valid_runtime_blocked",
        "actualTraining": False,
        "modelOptimizationStarted": False,
        "gpuUsed": False,
        "networkAccess": False,
        "providerAccess": False,
        "objectStorageMutation": False,
        "d014CandidateProduced": False,
        "localTrainingAuthorized": False,
        "requiredExecutionEnvironment": "RunPod under accepted D-016 after trusted Foundry gates",
        "config": {
            "fileName": config_path.name,
            "byteSize": len(config_bytes),
            "sha256": sha256_bytes(config_bytes),
            "normalized": normalized_config,
            "upstreamBindings": UPSTREAM_BINDINGS,
            "canonicalArgv": canonical_argv,
            "runtimeTranslationStatus": "blocked_unproved_in_pinned_image",
        },
        "dataset": dataset,
        "sourceLock": {
            "fileName": SOURCE_LOCK_FILENAME,
            "sha256": source_lock_digest,
            "project": source_lock["project"],
            "repository": source_lock["repository"],
            "tag": source_lock["tag"],
            "releaseArchive": source_lock["releaseArchive"],
            "license": source_lock["license"],
            "apiContract": source_lock["apiContract"],
            "requiredSourceClosure": source_lock["requiredSourceClosure"],
            "runtimeStatus": source_lock["runtimeStatus"],
        },
        "sourceClosureProbe": source_probe,
        "runtimeDependencies": dependencies,
        "runtimeReady": runtime_ready,
        "runtimeBlockers": list(RUNTIME_BLOCKERS),
    }
    payload_digest = sha256_bytes(canonical_json_bytes(payload))
    return {**payload, "receiptPayloadSha256": payload_digest}


def receipt_bytes(receipt: Mapping[str, Any]) -> bytes:
    return canonical_json_bytes(dict(receipt))


__all__ = [
    "CONFIG_KEYS",
    "FROZEN_CONFIG_B_NORMALIZED",
    "FORBIDDEN_LEGACY_ARGUMENTS",
    "PREFLIGHT_SCHEMA_VERSION",
    "RUNTIME_BLOCKERS",
    "TrainerContractError",
    "UPSTREAM_BINDINGS",
    "build_preflight_receipt",
    "canonical_json_bytes",
    "compile_canonical_argv",
    "normalize_training_config",
    "probe_runtime_dependencies",
    "receipt_bytes",
]
