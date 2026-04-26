#!/usr/bin/env bash
# /opt/run_training.sh — single training run on a RunPod A100 pod.
#
# Pulls a colmap_v2 dataset from R2, optionally generates E57 depth priors,
# trains via venviewer_training.simple_trainer_depth with the configured
# extension flags, builds a Venue Artifact bundle (per D-014), and pushes
# the tarball to R2 outputs prefix.
#
# Usage:
#   /opt/run_training.sh \
#     --venue-id trades-hall \
#     --config /workspace/code/configs/training/config_b.yaml \
#     --enable-mip-splatting \
#     --enable-3dgut \
#     --enable-dn-supervision \
#     --enable-bilateral-grid

set -Eeuo pipefail

# ============================================================================
# argparse
# ============================================================================
VENUE_ID=""
CONFIG=""
TRAINER="gsplat"
ITERS=""
ENABLE_MIP=0
ENABLE_3DGUT=0
ENABLE_DN=0
ENABLE_BG=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --venue-id)               VENUE_ID="$2"; shift 2 ;;
    --config)                 CONFIG="$2"; shift 2 ;;
    --trainer)                TRAINER="$2"; shift 2 ;;
    --iters)                  ITERS="$2"; shift 2 ;;
    --enable-mip-splatting)   ENABLE_MIP=1; shift ;;
    --enable-3dgut)           ENABLE_3DGUT=1; shift ;;
    --enable-dn-supervision)  ENABLE_DN=1; shift ;;
    --enable-bilateral-grid)  ENABLE_BG=1; shift ;;
    -h|--help)
      sed -n '2,18p' "$0"; exit 0 ;;
    *)
      echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

[[ -z "$VENUE_ID" ]] && { echo "--venue-id required" >&2; exit 64; }
[[ -z "$CONFIG"   ]] && { echo "--config required"   >&2; exit 64; }
if [[ "$TRAINER" != "gsplat" ]]; then
  echo "only --trainer gsplat is supported (got: $TRAINER)" >&2
  exit 64
fi
[[ -f "$CONFIG"   ]] || { echo "config file not found: $CONFIG" >&2; exit 66; }

# ============================================================================
# run id + paths
# ============================================================================
TS_UTC=$(date -u +%Y%m%dT%H%M%SZ)
POD="${RUNPOD_POD_ID:-localpod}"
RUN_ID="${TS_UTC}-${POD}"

DATA_DIR=/workspace/data
OUTPUT_ROOT=/workspace/output
LOG_DIR=/workspace/logs
BUNDLE_DIR="${OUTPUT_ROOT}/${RUN_ID}"
CKPT_DIR="${BUNDLE_DIR}/ckpts"
mkdir -p "$DATA_DIR" "$BUNDLE_DIR" "$CKPT_DIR" "$LOG_DIR"

LOG_FILE="${LOG_DIR}/train-${RUN_ID}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "============================================================"
echo " run_training.sh"
echo "============================================================"
echo "venue_id   = $VENUE_ID"
echo "run_id     = $RUN_ID"
echo "config     = $CONFIG"
echo "iters      = ${ITERS:-config-default}"
echo "extensions = mip=$ENABLE_MIP 3dgut=$ENABLE_3DGUT dn=$ENABLE_DN bg=$ENABLE_BG"
echo "started    = $(date -u)"
echo "============================================================"

# ============================================================================
# spot termination handler — flush whatever we have to R2 .partial/
# ============================================================================
PARTIAL_PREFIX="r2:venviewer-training-outputs/${VENUE_ID}/${RUN_ID}.partial/"
on_term() {
  echo "!! signal received — flushing partial state to ${PARTIAL_PREFIX}"
  if rclone copy "$BUNDLE_DIR" "$PARTIAL_PREFIX" --transfers 8 --ignore-existing >/dev/null 2>&1; then
    echo "partial bundle pushed"
  else
    echo "WARN: partial push failed — local bundle preserved at $BUNDLE_DIR"
  fi
  exit 143
}
trap on_term TERM INT

# ============================================================================
# r2 sanity
# ============================================================================
rclone lsd r2: >/dev/null

# ============================================================================
# pull dataset
# ============================================================================
INPUT_PREFIX="r2:venviewer-training-inputs/${VENUE_ID}/colmap_v2"
echo "pulling dataset: ${INPUT_PREFIX} → ${DATA_DIR}"
rclone copy "$INPUT_PREFIX" "$DATA_DIR" --transfers 16 --checkers 32

if [[ ! -d "$DATA_DIR/sparse/0" ]]; then
  echo "FATAL: $DATA_DIR/sparse/0 not found — dataset shape is wrong"
  exit 70
fi

# ============================================================================
# depth priors (optional)
# ============================================================================
DEPTH_DIR="$DATA_DIR/depths_e57"
if [[ "$ENABLE_DN" == "1" ]]; then
  CACHED="r2:venviewer-training-inputs/${VENUE_ID}/depths_e57"
  if rclone lsd "$CACHED" >/dev/null 2>&1; then
    echo "pulling cached depth priors from ${CACHED}"
    rclone copy "$CACHED" "$DEPTH_DIR" --transfers 16
  else
    E57_PATH="$DATA_DIR/scan.e57"
    if [[ ! -f "$E57_PATH" ]]; then
      echo "FATAL: $E57_PATH missing — depth supervision needs an E57 cloud"
      exit 71
    fi
    echo "generating depth priors from E57 (~10–15min on Trades-Hall-class venue)"
    python -m venviewer_training.project_e57_depth \
      --e57    "$E57_PATH" \
      --colmap "$DATA_DIR/sparse/0" \
      --images "$DATA_DIR/images" \
      --out    "$DEPTH_DIR"
    echo "caching priors back to ${CACHED} for reuse"
    rclone copy "$DEPTH_DIR" "$CACHED" --transfers 16
  fi
fi

# ============================================================================
# resume from prior partial run if one exists
# ============================================================================
if rclone lsd "${PARTIAL_PREFIX}ckpts" >/dev/null 2>&1; then
  echo "resuming from prior partial run @ ${PARTIAL_PREFIX}ckpts"
  rclone copy "${PARTIAL_PREFIX}ckpts" "$CKPT_DIR" --transfers 8
fi

# ============================================================================
# background checkpoint mirror — every 180s, copy ckpts/ to R2 partial
# ============================================================================
(
  while true; do
    sleep 180
    rclone copy "$CKPT_DIR" "${PARTIAL_PREFIX}ckpts/" --transfers 4 --checkers 8 >/dev/null 2>&1 || true
  done
) &
MIRROR_PID=$!
trap 'kill $MIRROR_PID 2>/dev/null || true; on_term' TERM INT

# ============================================================================
# capture hardware + git state for the bundle
# ============================================================================
python - <<'PY' > "$BUNDLE_DIR/hardware.json"
import json, os
import torch
out = {
    "gpu":           torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
    "device_count":  torch.cuda.device_count(),
    "torch":         torch.__version__,
    "cuda":          torch.version.cuda,
    "trainer_image": os.environ.get("OMNITWIN_TRAINER_VERSION", "unknown"),
    "pod_id":        os.environ.get("RUNPOD_POD_ID", "unknown"),
    "pod_region":    os.environ.get("RUNPOD_POD_HOSTNAME", "unknown"),
}
print(json.dumps(out, indent=2))
PY

if [[ -f /workspace/code/.git_sha ]]; then
  python - <<'PY' > "$BUNDLE_DIR/git_state.json"
import json
print(json.dumps({
    "sha":    open("/workspace/code/.git_sha").read().strip(),
    "branch": open("/workspace/code/.git_branch").read().strip(),
    "remote": open("/workspace/code/.git_remote").read().strip(),
    "dirty":  False,
}, indent=2))
PY
fi

# ============================================================================
# launch training
# ============================================================================
WALL="${OMNITWIN_WALLCLOCK_SEC:-14400}"
EXTRA=()
[[ "$ENABLE_MIP"   == "1" ]] && EXTRA+=(--antialiased)
[[ "$ENABLE_3DGUT" == "1" ]] && EXTRA+=(--with_ut --with_eval3d)
[[ "$ENABLE_BG"    == "1" ]] && EXTRA+=(--use_bilateral_grid)
[[ -n "$ITERS"            ]] && EXTRA+=(--max_steps "$ITERS")
[[ "$ENABLE_DN"    == "1" ]] && EXTRA+=(--depth_loss --external_depth_dir "$DEPTH_DIR")

echo "============================================================"
echo " launching trainer (wallclock cap ${WALL}s)"
echo "============================================================"
timeout --kill-after=30s "$WALL" \
  python -m venviewer_training.simple_trainer_depth \
    default \
    --data_dir   "$DATA_DIR" \
    --result_dir "$BUNDLE_DIR" \
    --config     "$CONFIG" \
    "${EXTRA[@]}"

# ============================================================================
# stop background mirror, build bundle
# ============================================================================
kill $MIRROR_PID 2>/dev/null || true

echo "============================================================"
echo " building bundle"
echo "============================================================"

# canonicalize PLY: gsplat writes ply/point_cloud_<step>.ply
LATEST_PLY=$(ls -t "$BUNDLE_DIR/ply/"*.ply 2>/dev/null | head -1)
if [[ -z "$LATEST_PLY" ]]; then
  echo "FATAL: no .ply file produced by trainer"
  exit 72
fi
cp "$LATEST_PLY" "$BUNDLE_DIR/scene.ply"

# eval on holdout views
python -m venviewer_training.eval_holdout \
  --bundle "$BUNDLE_DIR" \
  --data   "$DATA_DIR"

# manifest with SHA-256 of every file
python -m venviewer_training.make_manifest \
  --bundle   "$BUNDLE_DIR" \
  --venue-id "$VENUE_ID" \
  --run-id   "$RUN_ID"

# tarball with deterministic ordering
TARBALL="/tmp/${RUN_ID}.tar.gz"
tar --sort=name -czf "$TARBALL" -C "$OUTPUT_ROOT" "$RUN_ID"

# ============================================================================
# push bundle to R2 (canonical, not .partial/)
# ============================================================================
OUT_PREFIX="r2:venviewer-training-outputs/${VENUE_ID}/${RUN_ID}/"
echo "============================================================"
echo " pushing bundle to ${OUT_PREFIX}"
echo "============================================================"
rclone copy "$TARBALL" "$OUT_PREFIX" --transfers 4

# clean up the partial markers — successful run supersedes them
rclone purge "${PARTIAL_PREFIX}" >/dev/null 2>&1 || true

echo "============================================================"
echo " run complete"
echo " bundle: ${OUT_PREFIX}"
echo " ended:  $(date -u)"
echo "============================================================"

# ============================================================================
# optional self-terminate (only if API key + pod id are present)
# ============================================================================
if [[ -n "${RUNPOD_API_KEY:-}" && -n "${RUNPOD_POD_ID:-}" ]]; then
  echo "self-terminating pod ${RUNPOD_POD_ID}"
  curl -fsS \
    -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
    -H "Content-Type: application/json" \
    -X POST https://api.runpod.io/graphql \
    -d "{\"query\":\"mutation { podTerminate(input:{podId:\\\"${RUNPOD_POD_ID}\\\"}) }\"}" \
    >/dev/null && echo "termination requested"
fi
