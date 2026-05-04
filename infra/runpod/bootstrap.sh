#!/usr/bin/env bash
# /opt/bootstrap.sh — runs once at pod start.
#
# Responsibilities:
#   1. Materialize the operator's git deploy key from a base64 secret.
#   2. Pull trainer code from OMNITWIN_GIT_REPO @ OMNITWIN_GIT_REF.
#   3. Snapshot the git state (SHA, branch, remote) into files that
#      run_training.sh will copy into the bundle's git_state.json.
#   4. Verify R2 is reachable.
#   5. Drop to an interactive shell so the operator can inspect the pod
#      and kick off /opt/run_training.sh per the runbook.
#
# Required env (provided as RunPod secrets via the pod template):
#   GIT_DEPLOY_KEY_B64   base64-encoded ed25519 private key
#   OMNITWIN_GIT_REPO    e.g. git@github.com:codemaker66/omnitwin.git
#   OMNITWIN_GIT_REF     branch or commit SHA, default "master"
#   R2_ACCOUNT_ID        Cloudflare R2 account id
#   AWS_ACCESS_KEY_ID    R2 S3-compat access key
#   AWS_SECRET_ACCESS_KEY R2 S3-compat secret

set -Eeuo pipefail

log() { echo "[bootstrap $(date -u +%H:%M:%S)] $*"; }

# --- ssh key ---
log "materializing git deploy key"
mkdir -p ~/.ssh
chmod 700 ~/.ssh
if [[ -z "${GIT_DEPLOY_KEY_B64:-}" ]]; then
  log "FATAL: GIT_DEPLOY_KEY_B64 secret missing"
  exit 78
fi
echo "$GIT_DEPLOY_KEY_B64" | base64 -d > ~/.ssh/id_ed25519
chmod 600 ~/.ssh/id_ed25519
ssh-keyscan -t ed25519 -H github.com >> ~/.ssh/known_hosts 2>/dev/null

# --- pod ssh pubkey for operator inbound ssh ---
if [[ -n "${POD_SSH_PUBKEY:-}" ]]; then
  echo "$POD_SSH_PUBKEY" >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
fi

# --- git clone ---
GIT_REF="${OMNITWIN_GIT_REF:-master}"
log "cloning ${OMNITWIN_GIT_REPO} @ ${GIT_REF} → /workspace/code"
mkdir -p /workspace
rm -rf /workspace/code
git clone "$OMNITWIN_GIT_REPO" /workspace/code
cd /workspace/code
git checkout "$GIT_REF"
git rev-parse HEAD > .git_sha
git rev-parse --abbrev-ref HEAD > .git_branch
git config --get remote.origin.url > .git_remote
log "code at $(cat .git_sha) on $(cat .git_branch)"

# --- rclone conf from secrets ---
log "writing rclone.conf"
/opt/write_rclone_conf.sh

# --- r2 sanity ---
log "verifying R2 access"
if rclone lsd r2: >/dev/null 2>&1; then
  log "R2 OK"
else
  log "WARN: rclone lsd r2: failed — credentials or endpoint may be wrong"
fi

log "bootstrap complete — drop to bash; run /opt/run_training.sh per RUNBOOK.md"
exec bash
