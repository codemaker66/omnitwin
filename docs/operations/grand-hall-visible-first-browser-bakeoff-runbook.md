# Grand Hall visible-first browser bake-off

## Status and scope

This runbook executes the local browser half of the fixed-camera Grand Hall
bake-off. It is diagnostic and grants no staging, publication, runtime
admission, room-boundary, or production authority.

The orchestrator runs the representations sequentially in this order:

1. exact SOG fine frontier;
2. name-matched SPZ candidate;
3. supplied triangle PLY.

Each lane receives a new Playwright operating-system process, a new browser
from the selected installed Chrome/Edge channel, and a strict-port Vite server.
SOG and SPZ form the only captured-radiance review pool. PLY remains structural
evidence with deterministic debug appearance and is excluded from radiance
ranking.

Each representation receives one cold source navigation/load and four total captures from one live fixture runtime. The following three resident captures perform no navigation, source fetch, decode, or scene attachment. They measure visual and frame-time stability of the long-lived decoded runtime; they do not claim HTTP-cache reload performance.

The rejected `2026-08-31-visible-first-hardware-v2` attempt is incomplete. Its
cold SOG capture succeeded, but the first reload increased served source
requests from 11 to 22. It produced no complete four-capture SOG lane, no SPZ
or PLY lane, and no final bundle receipt. The fresh successor target is
`2026-08-31-visible-first-hardware-v3`, using the same-runtime resident-capture
contract below rather than another reload experiment.

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
- Install current Google Chrome or Microsoft Edge on the Windows operator
  machine. The bundled Playwright Chromium is deliberately not a bake-off
  candidate because its headless launch can resolve to SwiftShader.
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
isolation, the one-cold-load-plus-three-resident-captures schedule, and the
final receipt.

The orchestrator fixes the controlled profile at 1600 x 900 at DPR 1, 120
explicit warm-up frames, and 600 timed frames for every capture. It does not
inherit lower frame-count overrides, CI retry mode, alternate browser channels,
preview-server mode, or alternate capture modes from the operator shell.

## Hardware browser launch

Before it creates the evidence directory, the orchestrator probes installed
Chrome and Edge candidates in fail-closed order. The preferred candidate is
the installed `chrome` channel in headless mode. A headed launch of the same
channel is the first fallback; Edge headless/headed candidates follow. Every
candidate receives these exact arguments:

```text
--use-angle=d3d11
--disable-software-rasterizer
--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding
--disable-features=CalculateNativeWinOcclusion
--force-device-scale-factor=1
```

The lightweight probe creates only a 16 x 16 WebGL canvas. It selects a
candidate only when unmasked renderer evidence names recognised hardware and
the context is live. Software renderers such as SwiftShader, generic/unknown
renderer strings, context loss, a missing browser channel, or an unavailable
WebGL context are rejected. There is no software fallback.

The selected browser/channel/headless state, exact launch arguments, browser
version, user agent, WebGL vendor/renderer/version, probe duration, rejected
attempts, and profile SHA-256 are bound into the v2 bundle receipt. Each fresh
lane process then repeats the 16 x 16 check inside its own Playwright worker
before reading or navigating to any Grand Hall source. Its capture records
carry a digest-bound `VENVIEWER_BROWSER_HARDWARE_PREFLIGHT_V1` marker, and the
orchestrator rejects a worker whose hardware identity differs from the
selected launch profile.

## Fail-closed checks

Before launching a browser, the orchestrator requires an absent output path, a
clean worktree, a stable `HEAD`, a successful shared-types build, and an exact
shared-camera profile. The hardware selection probe must pass before the output
directory exists. It rechecks source state after the probe and after all lanes.

Each lane must produce exactly four JSON/PNG pairs labelled `cold-load-1`,
`resident-capture-1`, `resident-capture-2`, and `resident-capture-3`. The cold
record must show one request for every immutable source member. Every resident
record must show the same cumulative source-request total, the same live
fixture-runtime identity, and a strictly advancing controlled frame interval.
The records carry a `VENVIEWER_BROWSER_SOURCE_RESIDENCY_V1` marker whose exact
process scope is
`one_representation_one_cold_load_plus_three_resident_captures`. These facts
prove same-runtime residency for this harness; they do not test a reload or
claim an HTTP-cache hit. The orchestrator also verifies source counts, bytes,
hashes, decoded counts, camera values, screenshot hashes, lack of WebGL context
loss through the evidence schema, the pre-source hardware marker and profile
digest, and distinct runner process IDs.

Any mismatch exits non-zero and no completed bundle receipt is written.

## Output and review boundary

The new directory contains a digest-addressed camera-profile artifact, one
subdirectory per representation, and
`visible-first-browser-bakeoff-receipt.json`. Its schema is
`venviewer.grand-hall.visible-first-browser-bakeoff.v3`; it identifies SOG and
SPZ as radiance-ranking eligible and PLY as structural-only.

Successful execution still leaves every image `diagnostic` and
`visualAssessment: not_reviewed`. A human reviewer must cite exact JSON and PNG
hashes in a separate disposition. Do not infer a winner, native-camera parity,
room acceptance, package activation, staging readiness, or production
approval from this browser bundle.
