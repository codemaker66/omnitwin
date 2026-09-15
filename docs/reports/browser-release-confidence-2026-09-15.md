# Browser release confidence — Goal 17 / T-613

Status: **in progress**, 15 September 2026. This is working evidence, not a
completed release or acceptance claim. The [goal contract](../../goals/17-browser-release-confidence.md)
requires complete browser qualification, coordinated integration and the changed live journey.

## Source and baseline

Owned checkout: `D:/claude/venviewer-browser-release-20260915`, branch
`codex/browser-release-20260915`. Creation baseline `54ebfc61`; separately shipped
dependency release `641f26674bde55102221042e42967619bbd8b607` was fast-forwarded into
the candidate. Frozen install/postinstall passed. Goal16 has completed and returned
the serial T-601 release lane. Its dependency pins and required PostgreSQL/native
image checks remain intact.

All four original hosted shards were audited: **84 failed, 114 passed, 37 skipped,
116 never executed**. Each failed name also failed on predecessor `28209abc`; that
does not excuse the failures. Full logs and comparison remain under
`D:/claude/venviewer-planner-release-20260915/output/qualification/release/`.
The later `641f2667` hosted run had 85 failed, 106 passed, 28 skipped and 132
unexecuted cases. Its newly exposed venue-save locator and tool-pill wait failures
are repaired; its Twin timing failure remains part of the open gate.

Local commits record CI evidence collection, planner/Hallkeeper fixes, capture
fixtures, reviewed Linux references and real-frame instrumentation. Hosted results
and final release SHA will be recorded after qualification. No Goal17 deployment
is claimed here.

## Product defects repaired

- A dragged camera-reference form could fall beneath the inspector. A document-body
  portal preserves its viewport position and keeps Add + view reachable. Timeline
  preview still explicitly unmounts the composer.
- On phones, the furniture catalogue could appear beneath an expanded schedule.
  It now uses the established body tool layer and retains a 44px Close control
  after scrolling, Escape dismissal and opener focus restoration. The unlinked
  schedule fits its content, and tools use its measured height rather than a fixed
  assumption. Native placement and saved object payloads remain verified.
- Hallkeeper navigation and actions now retain their existing 44px minimum,
  including the separate loading and access-denied header. Tests assert both
  rendered bounds and navigation destinations.

These changes preserve the selected visual direction. They do not certify the
wider sublime redesign or represent founder aesthetic acceptance.

## Browser and code evidence

Receipt paths are relative to the owned checkout unless stated otherwise.
Do not add these counts together: some runs deliberately overlap.

| Scope | Result and limits | Receipt |
|---|---|---|
| Core editor | 15/15 passed, native Chrome, one worker, zero retries | `output/playwright/root-controls-after-3.json` |
| Hallkeeper, Rite landing, planner submission | 27/27 passed | `output/playwright/t613-role-landing/` |
| Public configuration and hardening | 22 passed; three original SpacePicker skips retained | `output/playwright/t613-public-flow/` |
| Accessibility, editor interactions, mobile, keyboard, navigation | 71 cases have passing receipts; final integrated mobile eight passed with zero retries/skips | `output/playwright/t613-mobile-nav/verification-manifest.json` |
| Final button/capture/tool union | Initial run: 52 passed, one staged pending-state race failed, one original walk-exit skip; all 45 button cases passed | `output/playwright/root-integrated-1.json` |
| Staged pending-state correction | Explicit 50Mbps CDP workload and DOM-ready navigation preserve the pending assertion; focused rerun passed, zero retries | `output/playwright/staged-integrated-2.json` |
| Linux state visual/frame cases | 22/22 passed in 188.18s, zero retries/skips, updates disabled, unchanged image/frame limits | `output/playwright/t613-state-visuals/linux-strict-final-1/results.json` |
| Twin HUD and native room navigation | Earlier 24/24 Linux cases passed; final whole-suite requalification remains open | `C:/Users/blake/AppData/Local/Temp/venviewer-linux-twin-delivery-20260915` |
| Mobile/schedule units | 43 cases across four files passed on integrated dependency pins | `output/playwright/t613-mobile-nav/verification-manifest.json` |
| Playwright configuration and composer units | 25 cases across two files passed | `output/qualification/config-composer-integrated.log` |
| Types and lint | Affected app and whole-E2E types plus scoped lint passed; final Hallkeeper assertion checks also passed | Mobile manifest; state-visual `final-e2e-types-3.log` and `final-eslint-2.log` |
| Web production build | Passed in 22.17s; build-check key only, output must never be served | `output/qualification/web-build-integrated.log` |
| CI inventory command | Parsed shard-one inventory: 93 scheduled cases | `output/qualification/ci-inventory-shard1.json` |

Fixtures use current typed/runtime-validated contracts and actual visible controls.
Access-denied cases also assert that protected content is absent. Independent
cases use default scheduling to prevent a single failure from suppressing later
coverage; genuinely stateful/live suites retain their existing policy.

Capture tests serve five real published Reception SOG files through a scoped
loopback HTTP server. Each file must match the checked-in descriptor SHA256 and
length before use. The fixture rejects non-loopback app targets, uses real network
delivery, and cleans up its exact route and owned server. Anonymous capture tests
assert that no internal registry request occurs. The separate registered asset
case uses the supported admin fixture and all seven published legacy assets.
Failed capture retains an honest notice and usable Model view.

The streaming run asserted incomplete progress before and after native control
input, ahead of screenshot readback. It logged first paint at 8,166ms and all five
chunks resolved at 16,288ms under **configured**, not independently measured,
50Mbps CDP throttling. The existing walk-state bridge tests containment/eye height;
it does not qualify native entry or the original quarantined Escape-exit case.

Seventeen existing Linux state references were individually viewed and reviewed,
with old/actual/new hashes retained in
`output/playwright/t613-state-visuals/reviewed-reference-changes.json`.
Twelve missing Linux Twin references were separately inspected. Twin HUD snapshots
intentionally exclude the live canvas and do not qualify reconstruction fidelity.
No image threshold or timing threshold was loosened, and no new skip was added.

## Performance evidence and unresolved CI dependency

The Twin benchmark now observes actual Three renderer submissions, changing
camera transforms and trusted pointer movement throughout a 1.2-second drag. It
requires input/drawing/camera activity in every quarter, a stable canvas/context
and actual draw calls; missing instrumentation fails. RAF cadence remains a
separate required measurement. Returned submissions are not GPU completion or
physical display presentation.

The exact source SHA256 is
`7d1a8adf56775ffb5ad8d94763841c32d8c7fb6b52fd7fe8cb3325a57b7eadde`.
Both final runs used identical source/lock inputs, 1440×900, DPR1, full-size
4096×2048 synthetic imagery, ordinary effects and all five existing cases.

| Final measurement | Mesa llvmpipe | RTX 4090 via WSL D3D12 |
|---|---:|---:|
| Passed / failed | 2 / 3 | 5 / 0 |
| Retries / skips | 0 / 0 | 0 / 0 |
| Walk returned-render p95 | 73.9ms | 17.1ms |
| Walk RAF p95 | 83.3ms | 16.8ms |
| Dollhouse returned-render p95 | 48.4ms | 17.5ms |
| Dollhouse RAF p95 | 50.1ms | 16.8ms |
| Longest observed hop task | 175ms | No long task observed |

Both keep the **20ms p95**, **150ms hop task** and **one consecutive interval over
33.4ms** limits. The passing hardware run still contains isolated 87.5ms Walk and
129.7ms Dollhouse intervals tolerated by that existing gate. The Dollhouse fixture
is an empty GLB; building geometry cost is outside this measurement.

Exact manifests, raw timing/camera data and failures are retained under
`output/qualification/twin-instrumentation-candidate/qualification-final.json`
and the referenced native Linux output directories. The Linux union was restored
from exact `641f2667` source with reviewed overlays: 3,188 file hashes verified,
native frozen install passed, snapshot and four immutable deltas retained under
`output/qualification/linux-final-union-20260915/snapshot-1/`.

This hardware result does **not** turn hosted software CI green. A concrete
zero-rental existing-worker versus capped disposable-GPU proposal is retained at
`output/qualification/gpu-ci-contingency/gpu-ci-contingency.md`; a founder choice
is pending. No runner enrollment, paid infrastructure, required-check replacement,
threshold override or timing exclusion has occurred.

## Remaining delivery work

Complete Linux verification is running as four sequential shards, one worker and
zero retries, with updates disabled and all scheduled names reconciled against
results. The final report must identify every original skip and any unexecuted or
unstable case. Hosted CI still needs the complete combined source, including the
unchanged PostgreSQL/native-image/security checks. Resolve the required GPU timing
path without waiving coverage, then integrate through T-601, verify production
source/provider identity and exercise the changed authorized live flows.

Physical iPhone/iPad/standard-office-PC 60fps, photographic PSNR50+, the complete
platform and founder aesthetic acceptance remain open.
