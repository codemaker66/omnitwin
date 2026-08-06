"""Experimental COLMAP adapter for external E57-derived depth priors.

This module is not connected to an executable trainer.  T-514 validates its
input/indexing contract only; it does not prove that external E57 depth reaches
an optimization loss in the pinned RunPod image.

Subclasses gsplat's example COLMAP Dataset and adds:

  - `external_depth_dir` argument (path to a directory of .npz priors,
    one per training image, keyed by filename stem).
  - per-image lookup of `uv` (M×2 float32) and `depth_m` (M float32).
  - full-resolution UV validation followed by division by ``parser.factor``.
  - proposed injection as `data["points"]` and `data["depths"]` tensors for
    later runtime integration and verification.

When external depth is configured, split-resolution errors, missing priors,
and malformed priors fail closed.  The adapter never silently falls back to
training without the requested external supervision.

When external_depth_dir is set we disable patch_size: the parent's
random-crop path doesn't expose crop offsets to subclasses, so we'd
lose the uv→pixel mapping that the proposed depth loss relies on. This is a
known, unbenchmarked limitation.

Vendoring: a future runtime integration would require the source-locked gsplat
1.5.3 ``examples/datasets/colmap.py`` closure.  It is not currently vendored.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import torch

from venviewer_training.colmap_contract import resolve_split_image_name


_DEPTH_KEYS = frozenset({"uv", "depth_m", "width", "height"})


def _int32_scalar(value: np.ndarray, label: str) -> int:
    array = np.asarray(value)
    if array.shape != () or array.dtype != np.dtype(np.int32):
        raise ValueError(f"external depth {label} must be one int32 scalar")
    return int(array.item())


def _load_external_depth_prior(path: Path) -> tuple[np.ndarray, np.ndarray, int, int]:
    with np.load(path, allow_pickle=False) as payload:
        if set(payload.files) != _DEPTH_KEYS:
            raise ValueError(
                f"external depth {path.name} must contain exactly {sorted(_DEPTH_KEYS)}"
            )
        uv = np.asarray(payload["uv"])
        depth = np.asarray(payload["depth_m"])
        width = _int32_scalar(payload["width"], f"{path.name} width")
        height = _int32_scalar(payload["height"], f"{path.name} height")
    if uv.dtype != np.dtype(np.float32) or uv.ndim != 2 or uv.shape[1:] != (2,):
        raise ValueError(
            f"external depth {path.name} uv must be float32 with shape (M, 2)"
        )
    if (
        depth.dtype != np.dtype(np.float32)
        or depth.ndim != 1
        or depth.shape[0] != uv.shape[0]
    ):
        raise ValueError(
            f"external depth {path.name} depth_m must be float32 with shape (M,) matching uv"
        )
    if uv.shape[0] == 0:
        raise ValueError(f"external depth {path.name} must contain at least one sample")
    return uv, depth, width, height


def _scale_and_validate_depth_prior(
    uv: np.ndarray,
    depth: np.ndarray,
    *,
    source_width: int,
    source_height: int,
    runtime_width: int,
    runtime_height: int,
    factor: int,
    label: str,
) -> tuple[np.ndarray, np.ndarray]:
    if (
        source_width != runtime_width * factor
        or source_height != runtime_height * factor
    ):
        raise ValueError(
            f"external depth {label} declares {source_width}x{source_height}, but the "
            f"runtime image is {runtime_width}x{runtime_height} at factor {factor}"
        )
    if not bool(np.isfinite(uv).all()) or not bool(np.isfinite(depth).all()):
        raise ValueError(f"external depth {label} contains non-finite values")
    if not bool((depth > 0).all()):
        raise ValueError(f"external depth {label} contains non-positive depths")
    source_selector = (
        (uv[:, 0] >= 0)
        & (uv[:, 0] < source_width)
        & (uv[:, 1] >= 0)
        & (uv[:, 1] < source_height)
    )
    if not bool(source_selector.all()):
        raise ValueError(
            f"external depth {label} contains UVs outside its source image"
        )

    scaled_uv = np.ascontiguousarray(uv / np.float32(factor), dtype=np.float32)
    runtime_selector = (
        (scaled_uv[:, 0] >= 0)
        & (scaled_uv[:, 0] < runtime_width)
        & (scaled_uv[:, 1] >= 0)
        & (scaled_uv[:, 1] < runtime_height)
        & (depth > 0)
    )
    if not bool(runtime_selector.all()):
        raise ValueError(
            f"external depth {label} is outside the factor-scaled runtime image"
        )
    return scaled_uv[runtime_selector], np.ascontiguousarray(depth[runtime_selector])


# ============================================================================
# load the vendored upstream Dataset / Parser
# ============================================================================
_HERE = Path(__file__).resolve().parent
_UPSTREAM = _HERE / "_upstream_colmap.py"

if _UPSTREAM.exists():
    _spec = importlib.util.spec_from_file_location(
        "venviewer_training._upstream_colmap", str(_UPSTREAM)
    )
    assert _spec is not None and _spec.loader is not None
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules["venviewer_training._upstream_colmap"] = _mod
    _spec.loader.exec_module(_mod)
    _BaseDataset = _mod.Dataset
    Parser = _mod.Parser  # re-export for caller / sys.modules patch
else:

    class _BaseDataset:  # type: ignore[no-redef]
        def __init__(self, *args, **kwargs):
            raise SystemExit(
                "examples/datasets/colmap.py from gsplat 1.5.3 is not vendored.\n"
                "Vendor it as venviewer_training/_upstream_colmap.py.\n"
                "See VENDORING in venviewer_training/simple_trainer_depth.py."
            )

    class Parser:  # type: ignore[no-redef]
        def __init__(self, *args, **kwargs):
            raise SystemExit("Parser unavailable until upstream is vendored")


# ============================================================================
# subclass with depth-prior injection
# ============================================================================
class Dataset(_BaseDataset):  # type: ignore[misc, valid-type]
    """COLMAP Dataset with optional external sparse-depth priors.

    All extra kwargs are stripped before delegating to the parent so the
    upstream signature remains stable across gsplat versions.
    """

    def __init__(
        self,
        *args,
        external_depth_dir: Optional[str] = None,
        max_depth_samples: int = 200_000,
        **kwargs,
    ):
        depth_dir: Optional[Path] = None
        if external_depth_dir is not None:
            if not str(external_depth_dir).strip():
                raise ValueError("external_depth_dir must not be empty")
            depth_dir = Path(external_depth_dir)
            if depth_dir.is_symlink() or not depth_dir.is_dir():
                raise ValueError(
                    "external_depth_dir must be an existing non-symlink directory"
                )
            # parent's random-crop path doesn't expose crop offsets to
            # subclasses — we'd lose the uv→pixel mapping. Disable.
            kwargs["patch_size"] = None
        super().__init__(*args, **kwargs)
        self._depth_dir = depth_dir
        if (
            isinstance(max_depth_samples, bool)
            or not isinstance(max_depth_samples, (int, np.integer))
            or int(max_depth_samples) <= 0
        ):
            raise ValueError("max_depth_samples must be positive")
        self._max_depth_samples = int(max_depth_samples)

    def __getitem__(self, index: int):
        data = super().__getitem__(index)
        if self._depth_dir is None:
            return data

        # The parent resolves a split-local item through self.indices.  Any
        # disagreement here is a contract failure, not permission to guess a
        # filename from some other field.
        image_name = resolve_split_image_name(
            self.parser.image_names,
            self.indices,
            index,
        )
        stem = Path(image_name).stem
        npz_path = self._depth_dir / f"{stem}.npz"
        if npz_path.is_symlink():
            raise ValueError(
                f"external depth prior must not be a symlink: {npz_path.name}"
            )
        if not npz_path.is_file():
            raise FileNotFoundError(
                f"external depth prior is required for {image_name!r}: {npz_path.name}"
            )

        uv, depth, source_width, source_height = _load_external_depth_prior(npz_path)
        factor = getattr(self.parser, "factor", None)
        if isinstance(factor, bool) or not isinstance(factor, (int, np.integer)):
            raise ValueError(
                "parser.factor must be a positive integer for external depth"
            )
        factor = int(factor)
        if factor <= 0:
            raise ValueError(
                "parser.factor must be a positive integer for external depth"
            )
        image = data.get("image")
        image_shape = getattr(image, "shape", ())
        if len(image_shape) < 2:
            raise ValueError(
                "parent dataset did not return an image with height and width"
            )
        runtime_height = int(image_shape[0])
        runtime_width = int(image_shape[1])
        uv, depth = _scale_and_validate_depth_prior(
            uv,
            depth,
            source_width=source_width,
            source_height=source_height,
            runtime_width=runtime_width,
            runtime_height=runtime_height,
            factor=factor,
            label=npz_path.name,
        )

        if uv.shape[0] > self._max_depth_samples:
            # Deterministic, distributed coverage.  The former unseeded
            # np.random.choice made identical runs consume different priors.
            idx = np.linspace(
                0,
                uv.shape[0] - 1,
                num=self._max_depth_samples,
                dtype=np.int64,
            )
            uv = uv[idx]
            depth = depth[idx]

        data["points"] = torch.from_numpy(uv)
        data["depths"] = torch.from_numpy(depth)
        return data
