"""Venviewer fork of gsplat 1.5.3 examples/simple_trainer.py.

UPSTREAM
    Source:    https://github.com/nerfstudio-project/gsplat
    Tag:       v1.5.3
    Path:      examples/simple_trainer.py
    SHA:       <FILL-IN-AT-VENDORING-TIME>
               Recorded in venviewer_training/_upstream_simple_trainer.sha256
               at vendoring time so fork drift is detectable.

WHY A FORK
    Two changes from upstream:

      1. Dataset import — upstream:
             from datasets.colmap import Dataset
         here:
             from venviewer_training.colmap_depth_dataset import Dataset
         The replacement adds an `external_depth_dir` argument and
         injects sparse uv+depth tensors as data["points"] /
         data["depths"] per gsplat's native depth-supervision contract.

      2. fused_ssim import — upstream:
             from fused_ssim import fused_ssim
         here:
             try:    from fused_ssim import fused_ssim
             except: from venviewer_training.ssim_fallback import fused_ssim
         ssim_fallback is a pure-PyTorch SSIM that lets the trainer run
         on pods where the fused-ssim wheel didn't compile against the
         local CUDA toolchain.

    Everything else stays identical to upstream — gsplat's CLI surface,
    config dataclass, training loop, eval cadence are inherited untouched.

VENDORING

    The upstream examples/ directory is NOT installed by pip — it lives
    in the gsplat repo only. To use this fork on a fresh pod:

        cd /workspace/code/venviewer_training
        GSPLAT_REF=v1.5.3
        BASE=https://raw.githubusercontent.com/nerfstudio-project/gsplat/${GSPLAT_REF}/examples
        curl -fsSL "${BASE}/simple_trainer.py" > _upstream_simple_trainer.py
        curl -fsSL "${BASE}/datasets/colmap.py" > _upstream_colmap.py
        sha256sum _upstream_simple_trainer.py _upstream_colmap.py \
          > _upstream_checksums.sha256

    Then this module patches the two upstream import sites via
    sys.modules and defers all work to the vendored copy.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

# ============================================================================
# patch 1 — route `from datasets.colmap import Dataset` to our subclass
# ============================================================================
import venviewer_training.colmap_depth_dataset as _depth_ds

_datasets_pkg = types.ModuleType("datasets")
_datasets_colmap = types.ModuleType("datasets.colmap")
_datasets_colmap.Dataset = _depth_ds.Dataset  # type: ignore[attr-defined]
# Parser is also imported by upstream from datasets.colmap; pass through.
if hasattr(_depth_ds, "Parser"):
    _datasets_colmap.Parser = _depth_ds.Parser  # type: ignore[attr-defined]
_datasets_pkg.colmap = _datasets_colmap  # type: ignore[attr-defined]
sys.modules.setdefault("datasets", _datasets_pkg)
sys.modules.setdefault("datasets.colmap", _datasets_colmap)

# ============================================================================
# patch 2 — fused_ssim with pure-PyTorch fallback
# ============================================================================
try:
    from fused_ssim import fused_ssim as _fused_ssim  # type: ignore
except Exception:  # noqa: BLE001 — silently fall back to pure-PyTorch
    from venviewer_training.ssim_fallback import fused_ssim as _fused_ssim

if "fused_ssim" not in sys.modules:
    _fused_pkg = types.ModuleType("fused_ssim")
    _fused_pkg.fused_ssim = _fused_ssim  # type: ignore[attr-defined]
    sys.modules["fused_ssim"] = _fused_pkg

# ============================================================================
# load vendored upstream and re-export its CLI entrypoint
# ============================================================================
_HERE = Path(__file__).resolve().parent
_UPSTREAM = _HERE / "_upstream_simple_trainer.py"
if not _UPSTREAM.exists():
    raise SystemExit(
        f"upstream not vendored at {_UPSTREAM}\n"
        "see the VENDORING block in venviewer_training/simple_trainer_depth.py"
    )

_spec = importlib.util.spec_from_file_location(
    "venviewer_training._upstream_simple_trainer", str(_UPSTREAM)
)
if _spec is None or _spec.loader is None:  # pragma: no cover
    raise SystemExit(f"could not load spec for {_UPSTREAM}")
_mod = importlib.util.module_from_spec(_spec)
sys.modules["venviewer_training._upstream_simple_trainer"] = _mod
_spec.loader.exec_module(_mod)

# upstream's tyro CLI lives in main(). If a future gsplat refactor changes
# the entrypoint name, this fork pattern needs updating — fail loudly.
main = getattr(_mod, "main", None)
if main is None:  # pragma: no cover
    raise SystemExit(
        "vendored upstream simple_trainer.py has no main() — fork pattern "
        "needs updating for the new gsplat release"
    )


if __name__ == "__main__":
    main()
