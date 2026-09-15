#!/usr/bin/env bash
set -euo pipefail
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp > /results/xvfb.log 2>&1 &
display_pid=$!
trap 'kill "$display_pid" 2>/dev/null || true; wait "$display_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 50); do
  if [[ -S /tmp/.X11-unix/X99 ]]; then break; fi
  if ! kill -0 "$display_pid" 2>/dev/null; then exit 1; fi
  sleep .1
done
test -S /tmp/.X11-unix/X99
node /runner/probe-runtime.cjs > /results/runtime-before.json
pnpm --filter @omnitwin/web exec playwright test --test-list=/runner/gpu-tests.txt --workers=1 --retries=0 --repeat-each=1 --update-snapshots=none --reporter=line,json --output=/results/test-results
node /runner/probe-runtime.cjs > /results/runtime-after.json
