"""COLMAP dataset adapter that injects external E57-derived depth priors.

Subclasses gsplat's example COLMAP Dataset and adds:

  - `external_depth_dir` argument (path to a directory of .npz priors,
    one per training image, keyed by filename stem).
  - per-image lookup of `uv` (M×2 float32) and `depth_m` (M float32).
  - injection as `data["points"]` and `data["depths"]` tensors,
    matching gsplat's native depth-supervision contract.

When external_depth_dir is set we disable patch_size: the parent's
random-crop path doesn't expose crop offsets to subclasses, so we'd
lose the uv→pixel mapping that the depth loss relies on. This is a
known limitation; the loss-quality cost is small relative to the
+1–2 dB gain that the depth prior delivers.

Vendoring: requires `_upstream_colmap.py` (gsplat 1.5.3
examples/datasets/colmap.py) to be present alongside this file. See
the VENDORING block in `simple_trainer_depth.py`.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import torch


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
        if external_depth_dir is not None:
            # parent's random-crop path doesn't expose crop offsets to
            # subclasses — we'd lose the uv→pixel mapping. Disable.
            kwargs["patch_size"] = None
        super().__init__(*args, **kwargs)
        self._depth_dir = Path(external_depth_dir) if external_depth_dir else None
        self._max_depth_samples = int(max_depth_samples)

    def __getitem__(self, index: int):
        data = super().__getitem__(index)
        if self._depth_dir is None:
            return data

        # Parent stores the image filename; layout varies between gsplat
        # versions. Try the most stable accessor first.
        stem: Optional[str] = None
        try:
            stem = Path(self.parser.image_names[index]).stem
        except Exception:  # noqa: BLE001
            pass
        if stem is None:
            try:
                stem = Path(data.get("image_name", "")).stem  # type: ignore[arg-type]
            except Exception:  # noqa: BLE001
                pass
        if not stem:
            return data

        npz_path = self._depth_dir / f"{stem}.npz"
        if not npz_path.exists():
            return data

        with np.load(npz_path) as npz:
            uv = np.asarray(npz["uv"], dtype=np.float32)
            depth = np.asarray(npz["depth_m"], dtype=np.float32)

        if uv.shape[0] > self._max_depth_samples:
            idx = np.random.choice(uv.shape[0], self._max_depth_samples, replace=False)
            uv = uv[idx]
            depth = depth[idx]

        data["points"] = torch.from_numpy(uv)
        data["depths"] = torch.from_numpy(depth)
        return data
