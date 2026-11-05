---
id: smoke-readonly
title: Read-only smoke test of the credit runner
# Runs only when named: pnpm --filter @omnitwin/credit-runner night --only smoke-readonly
enabled: false
model: claude-opus-5-5
effort: low
budget_usd: 0.75
timeout_minutes: 10
install: false
read_only: true
acceptance: "git diff --quiet HEAD"
---
This run exists to prove the credit runner end to end: that it bills the
VenViewer Console org's API key, and that the report records cost, turns and a
summary. It must not change anything.

1. Read `pnpm-workspace.yaml` and the root `package.json`.
2. List every workspace package under `packages/` and `tools/` as one line each:
   the folder, then the `name` from its `package.json`.
3. Say which Node and pnpm versions the root `package.json` requires.

Do not read anything else, and change no files.
