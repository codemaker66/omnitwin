"""Build-time and pod-time smoke check.

Verifies every binary dependency of the Venviewer trainer image imports
cleanly. Run with --no-cuda during `docker build` (no GPU on the build
host); run without flags after pod boot to also assert CUDA visibility.

Exit code 0 => image is sane. Non-zero => the image cannot run training.
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys
from typing import Any


REQUIRED = (
    "torch",
    "gsplat",
    "spz",
    "pye57",
    "pycolmap",
    "numpy",
    "scipy",
    "cv2",
    "PIL",
    "open3d",
    "yaml",
    "tyro",
    "tensorboard",
    "plyfile",
    "torchmetrics",
)


def _version(mod: Any) -> str:
    for attr in ("__version__", "VERSION", "version"):
        v = getattr(mod, attr, None)
        if v is not None:
            return str(v)
    return "unknown"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--no-cuda",
        action="store_true",
        help="Skip the CUDA-availability assertion (use during docker build).",
    )
    args = parser.parse_args()

    report: dict[str, Any] = {"imports": {}, "cuda": None, "ok": True}
    for name in REQUIRED:
        try:
            mod = importlib.import_module(name)
            report["imports"][name] = {"version": _version(mod), "ok": True}
        except Exception as exc:  # noqa: BLE001 — surface root cause
            report["imports"][name] = {"error": repr(exc), "ok": False}
            report["ok"] = False

    try:
        import torch  # noqa: WPS433 — late import after report start

        report["cuda"] = {
            "available": bool(torch.cuda.is_available()),
            "device_count": torch.cuda.device_count(),
            "torch_cuda_version": torch.version.cuda,
        }
        if not args.no_cuda and not torch.cuda.is_available():
            report["ok"] = False
            report["cuda"]["error"] = "CUDA not available at runtime"
    except Exception as exc:  # noqa: BLE001
        report["cuda"] = {"error": repr(exc)}
        report["ok"] = False

    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
