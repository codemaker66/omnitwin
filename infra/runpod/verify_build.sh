#!/usr/bin/env bash
# /opt/verify_build.sh — operator-runs-this-first sanity dump.
#
# Emits a JSON object summarizing the runtime environment of the live pod.
# Run after bootstrap, before kicking off run_training.sh. Outputs to stdout;
# pipe to jq or tee to a file as needed.

set -Eeuo pipefail

py_ver=$(python --version 2>&1 | awk '{print $2}')
torch_ver=$(python -c 'import torch; print(torch.__version__)')
cuda_runtime=$(python -c 'import torch; print(torch.version.cuda)')
gsplat_ver=$(python -c 'import gsplat; print(gsplat.__version__)')
pycolmap_ver=$(python -c 'import pycolmap; print(getattr(pycolmap, "__version__", "rmbrualla-fork"))')
pye57_ver=$(python -c 'import pye57; print(getattr(pye57, "__version__", "unknown"))')
spz_ver=$(python -c 'import spz; print(getattr(spz, "__version__", "unknown"))' 2>/dev/null || echo "missing")
rclone_ver=$(rclone --version | head -1 | awk '{print $2}')
nv_smi=$(nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>/dev/null || echo "no-gpu")

python - <<PY
import json, sys
print(json.dumps({
    "trainer_image_version": "${OMNITWIN_TRAINER_VERSION:-unknown}",
    "python":      "$py_ver",
    "torch":       "$torch_ver",
    "cuda":        "$cuda_runtime",
    "gsplat":      "$gsplat_ver",
    "pycolmap":    "$pycolmap_ver",
    "pye57":       "$pye57_ver",
    "spz":         "$spz_ver",
    "rclone":      "$rclone_ver",
    "nvidia_smi":  """$nv_smi""".strip().splitlines(),
    "pod_id":      "${RUNPOD_POD_ID:-localpod}",
}, indent=2))
PY
