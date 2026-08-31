# Grand Hall visible-first browser bake-off

## Status and scope

This runbook executes the local browser half of the fixed-camera Grand Hall
bake-off. It is diagnostic and grants no staging, publication, runtime
admission, room-boundary, or production authority.

The orchestrator runs the representations sequentially in this order:

1. exact SOG fine frontier;
2. name-matched SPZ candidate;
3. supplied triangle PLY.

Each lane receives a new Playwright operating-system process, a new Chromium
browser, and a strict-port Vite server. Within that one browser, the lane emits
one cold capture followed by three warm captures. SOG and SPZ form the only
captured-radiance review pool. PLY remains structural evidence with
deterministic debug appearance and is excluded from radiance ranking.

## Required fixed camera

Every lane is bound to profile `source-pose-19890-interior-v1`. The
orchestrator reads
`tools/reconstruction-foundry/native/grand-hall-lcc-native-capture/camera-profile.json`,
hashes its exact bytes, verifies the browser camera and projection against it,
and copies those bytes into the new evidence directory under a digest-addressed
filename. The Three target must be exactly:

```text
[0.15796363067625974, 2.15606153541565, -0.19184415815737577]
```

The profile is inspection-only. It is not a recovered optical camera or an
accepted native-to-browser room transform.

## Preconditions

- Use the reviewed local source root. The command does not fetch or upload
  anything.
- Commit the orchestrator and camera profile first. The repository must be at a
  clean, current `HEAD`; untracked source files also fail the run.
- Choose a previously absent evidence directory directly beneath
  `docs/evidence/grand-hall-lineage`. The orchestrator never overwrites an
  existing run.
- Reserve three consecutive localhost ports. The default range is 5189-5191.
- Do not run another WebGL workload that competes for the same GPU during this
  bake-off.

## Exact execution command

From the repository root in PowerShell, replace only `<new-run-id>` with a
reviewed unique identifier:

```powershell
$env:GRAND_HALL_LINEAGE_ROOT='C:\GRAND_HALL_BIG_MODEL_VARIATIONS'
$env:GRAND_HALL_LINEAGE_EVIDENCE_DIR="$(Resolve-Path .)\docs\evidence\grand-hall-lineage\<new-run-id>"
$env:GRAND_HALL_LINEAGE_BASE_PORT='5189'
pnpm --filter @omnitwin/web visual-lineage:bakeoff
```

Do not invoke the Playwright spec directly for the bake-off. Direct invocation
retains the legacy one-capture diagnostic path; the orchestrator owns process
isolation, the cold-plus-three-warm schedule, and the final receipt.

The orchestrator fixes the controlled profile at 1600 x 900 at DPR 1, 120
explicit warm-up frames, and 600 timed frames for every capture. It does not
inherit lower frame-count overrides, CI retry mode, alternate browser channels,
preview-server mode, or alternate capture modes from the operator shell.

## Fail-closed checks

Before launching a browser, the orchestrator requires an absent output path, a
clean worktree, a stable `HEAD`, a successful shared-types build, and an exact
shared-camera profile. It rechecks source state after all lanes.

Each lane must produce exactly four JSON/PNG pairs labelled `cold-run-1`,
`warm-run-1`, `warm-run-2`, and `warm-run-3`. The cold record must show one
request for every immutable source member. Warm records must show no additional
source requests, proving use of the same browser HTTP cache rather than merely
renaming repeated cold loads. The orchestrator also verifies source counts,
bytes, hashes, decoded counts, camera values, screenshot hashes, lack of WebGL
context loss through the evidence schema, and distinct runner process IDs.

Any mismatch exits non-zero and no completed bundle receipt is written.

## Output and review boundary

The new directory contains a digest-addressed camera-profile artifact, one
subdirectory per representation, and
`visible-first-browser-bakeoff-receipt.json`. That receipt identifies SOG and
SPZ as radiance-ranking eligible and PLY as structural-only.

Successful execution still leaves every image `diagnostic` and
`visualAssessment: not_reviewed`. A human reviewer must cite exact JSON and PNG
hashes in a separate disposition. Do not infer a winner, native-camera parity,
room acceptance, package activation, staging readiness, or production
approval from this browser bundle.
