# Browser release confidence — Goal 17 / T-613

Status: **in progress**, 15 September 2026. This is working evidence, not a
completed release or acceptance claim. The [goal contract](../../goals/17-browser-release-confidence.md)
requires complete browser qualification, coordinated integration and the changed live journey.

## Delivered candidate and deployment follow-up — 15 September

PR16 merged as `26184f42172c74d667a5ba4a38f47789a90d1503` after all13
pre-merge jobs passed (CI35019954434). Its tree
`99299c37b3f34afadde0ec65650b859768f1bf47` is identical to the qualified
merge candidate. All13 post-merge jobs also passed (CI35021791429), including
a fresh isolated GPU run and authenticated publication. Both complete browser
gates reconcile353 cases:307 ordinary passes, four executed expected failures,
42 unchanged original skips; zero failed, flaky, retried, missing or unrun cases.
Native12/12 and PostgreSQL113/113 pass against all69 exact-source migrations.

Vercel production `6FBWjHpiHTR9Mr3HANPUFy4zS5no` is Ready and the authenticated
provider overview binds venviewer.com to26184f42. API641f2667 remains healthy;
there is no API/schema production delta. All15 read-only public smoke checks
pass. The signed-in saved planner retains162 objects; camera reference composition
opens above the inspector and cancels without saving. Its first cold attempt hit
a Clerk UI asset timeout and recovered on reload. Grand Hall capture remained at
zero decoded chunks in the current live observation; that investigation and the
remaining responsive/hallkeeper live checks are still open.

The successful main CI exposed a pre-existing Deploy workflow argument error:
`pnpm ... db:verify-tail -- --deploy-gate` forwards a literal separator that the
parser rejects before accessing the database. Deploy35023087839 therefore failed
before migrations; no migration ran. The correction removes only that separator.
The regression test now parses the actual workflow arguments;17/17 focused tests
pass. Safe real-pnpm reproduction confirms the original error and that the fixed
command reaches the expected missing-DATABASE_URL guard without a DB connection.
The corrected workflow still requires hosted qualification and delivery.

Private receipts are under
`D:/claude/venviewer-browser-release-20260915/output/qualification/production-26184f42/`:
`current-required-gates-review.json`, `main-ci-and-deploy-review.json`,
`web-provider-ui.json`, `public-smoke-checkpoint.json` and
`deploy-workflow-local-verification.json`. The prior failed runs remain retained.
The final scheduled smoke config is held until the last qualified release;
its existing scheduler is unchanged. Goal17 remains active. Wider sublime,
physical-device60fps and reconstructionPSNR50+ acceptance remain open.

## Current continuation — isolated GPU evidence path

The previous hardware-choice hold was an overly broad interpretation of approval.
The existing authorization permits a temporary, isolated job on the available RTX
4090. No rental, permanent worker enrollment, daemon, repository permission or
production-origin change is required for this path.

The new `.github/gpu/` tooling partitions the unchanged 353-case inventory into
348 hosted CPU cases and five required hardware cases. Four shard inventories
contain 93/87/81/87 cases; the exact full union, 42 original skips and four
executed expected failures are independently checked. Every hosted attempt issues
a fresh source-bound request. The operator's publisher authenticates the original
artifact, committed source and actual worker observations before uploading the
bounded raw report and owner status. GitHub independently verifies that evidence
and requires the full CPU/GPU union. Unavailable hardware or missing evidence
fails the workflow. This is an operator-invoked check, not an unattended service
or newly configured server-side branch prohibition.

Bubblewrap isolation was measured with no external network route or host
credentials, read-only source/dependencies, private writable caches/results,
private Xvfb and `/dev/dxg`. Namespace UID65534 maps to host0; the boundary is the
namespace/mount/capability policy, not a new unprivileged host account. The
benchmark lease serializes participating jobs, not every desktop GPU consumer.
The first suite attempt correctly failed when pnpm attempted an unavailable
download. A read-only mount of installed pnpm9.15.4 fixed that setup issue.
All five unchanged cases then passed in 22.8s without retries. The complete new
worker/probe trial passed five cases in25.8s, measured wrapper elapsed30.426s;
observed before/after runtime identities agree and both render p95 values are
17.1ms. This local-only request is explicitly not authenticated hosted evidence.

An independent installed-source review found the old verifier mixed wall-clock
starts and monotonic durations to invent finish timestamps. Receipt v2 instead
requires the actual controller monotonic duration, checks summed case duration
against report duration against that measured envelope, and retains recorded
wall starts for freshness. No timing budget, pixel size, scene, assertion or
historical measurement was modified. No missing historical duration was invented.

Verification:151/151 Node cases pass separately on Windows and Linux;32/32 Python
boundary/source cases pass on Linux. Independent reviews covered the worker,
clock correction, partition order and final reconciliation. Source admission now
rejects extra Vite configuration files, escaped cache paths and mismatched runner
helpers. The publisher's archive transport was read-only checked against a real
GitHub artifact and its SHA256 matched. Evidence is in
`output/qualification/gpu-ci-contingency/` and
`output/qualification/gpu-ci-partition-20260915/`; the actual worker result is at
`/root/venviewer-t613-gpu-isolation-probe/worker-qualification-1/result` in Ubuntu.

Fresh hosted CI on the complete committed implementation, integration and live
delivery remain required. The earlier evidence below is retained history.

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
are retained below; the final release SHA awaits qualification. No Goal17 deployment
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
Image and frame-budget thresholds are unchanged, and no new skip was added.
The later orchestration-deadline corrections are documented below separately
from per-action and rendering limits.

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

The first candidate is draft [PR16](https://github.com/codemaker66/omnitwin/pull/16),
head `957f2b00563ab40113e52152601e5ac1dfc03cc2`. Hosted run34960484926 tested merge
commit `9bf3715a7b653d98d0f181d873364cbb65c7943e`; its tree and the candidate head
both resolve to `82f5a9dd81c02ac57b0a006e878b1acd55044de1`.

### Closed hosted results

Seven jobs passed: audit, lint, typecheck, build, native-image smoke and browser
shards one/two. Workspace Test and browser shards three/four failed.

| Browser shard | Ordinary passes | Executed expected failures | Unexpected failures | Flaky passes | Original skips |
|---|---:|---:|---:|---:|---:|
| 1 | 86 | 0 | 0 | 0 | 7 |
| 2 | 87 | 0 | 0 | 0 | 0 |
| 3 | 62 | 0 | 6 | 2 | 15 |
| 4 | 63 | 4 | 1 | 0 | 20 |
| Total | 298 | 4 | 7 | 2 | 42 |

All 353 unique scheduled IDs reconcile: 311 executed and 42 deliberately skipped,
with no empty attempt, unexplained skip, global timeout or cascade of unrun cases.
Four expected failures execute existing Twin responsive quarantines. The static
skip/gate audit confirms unchanged conditions and identities relative to `641f2667`;
see `output/qualification/skip-quarantine-inventory-20260915/`.

The seven browser failures are three obsolete staff Reviews controls, two obsolete
quiz footer assertions, a loaded Reception capture that stops responding before
its screenshot, and the unchanged Twin walk timing limit. Two capture cases pass
only after retries: initial fallback arrival and staged streaming/readback.
The workspace unit job fails only two assertions against old schedule empty-state
copy. PostgreSQL platform tests pass 60/60 and event access passes 53/53; the native
image passes 12/12 with digest
`sha256:42521ddcd170ee3c56a0d34cba680e435390b7c9fdbe75a34e202bb16a36ff30`.

Raw hosted inventories, results, native/PostgreSQL receipts and failure artifacts
are retained in `output/qualification/hosted-pr16-34960484926/`.

### Follow-up candidate and open checks

The full CockpitBottom unit file now passes 58/58 after checking the current two
empty-state messages inside the same no-event schedule. Synchronous private-data
removal, one timeline request and inactive preview assertions remain intact.
Receipt: `output/qualification/cockpit-bottom-copy-followup.log`.
The Reviews and quiz tests now target the rendered native controls and retain
their action/payload, containment and overflow checks. A separate asset-registry
loading test waits for navigation and the actual held API request before measuring
the existing five-second visible-loading limit. These corrected paths now pass in
the 18-case native Linux follow-up below; whole-E2E types and scoped lint also pass.

Hosted capture traces show blocked browser work and ReadPixels driver warnings,
including an 88.7-second visible-canvas assertion before the loaded screenshot
helper was reached. The streaming retry also stalls before and during readback.
These are not evidence of duplicate canvases or an auth-provider remount. The old
artificial-wheel screenshot workaround was subsequently replaced by the passive
owned-canvas readback described below. No capture coverage, pixel detail or frame
limit has been removed.
Extracted trace/action receipts: `output/qualification/capture-followup-20260915/`.

The complete independent native Linux run has closed. All 353 names reconcile:
290 ordinary passes, four executed expected failures, 17 unexpected failures and
42 original skips. All 311 active cases ran once, with no missing, extra, duplicate,
unrun or retried case. Its 3,188 frozen source hashes match before/after. Receipt:
`output/playwright/t613-full-linux/run-1/README.md` and `reconciliation.json`.

The native failures comprise five stale-control cases, two request/loading timing
races, four staged-file download failures, one registered-capture stall, two
cumulative functional-journey timeouts and three Twin software-renderer performance
failures. These remain failed original results even when a later correction passes.

Two scenario-local total deadlines are now 45 seconds: the single camera-reference
journey and the ten full-narration quiz viewport cases. The camera trace completed
all assertions in approximately 32 seconds including startup and the native
create/drag/view/exit/reopen sequence. Quiz narration itself intentionally takes
22.73 seconds, and the failed run spent 8.615 seconds loading before starting it.
The generic 30-second test total could not contain that sequence. Every existing
five-second camera state gate, the quiz 25-second readiness gate, native narration,
and all geometry/scroll assertions are retained. This changes total test scheduling
allowances; it does not establish or relax a product frame-performance result.

Frozen deltas five/six contain those changes and the other test corrections.
Whole-E2E types and scoped lint pass. All 18 focused native Linux cases now pass
in 5.7 minutes: all ten narration viewports, both large-desktop invitation cases,
all three staff review cases, both request boundaries and the full camera-reference
journey. The run used one worker, zero retries and unchanged snapshots. Receipt:
`/root/venviewer-browser-release-20260915/output/qualification/t613-followup-linux-20260915/run-1/`.

The Linux R2 failure is separately diagnosed: native fetch abandoned IPv4 connection
attempts and reported unreachable IPv6, while an explicit IPv4 HEAD returned 200.
A second native-fetch HEAD with child-only `--no-network-family-autoselection`
returned 200 in 657.622ms. No system setting changed. This qualifies that tiny
connection diagnostic, not full-body download or cold capture-fixture reliability.
The first probe also exposed a wall-clock adjustment, so subsequent elapsed-time
diagnostics use `performance.now`; the original negative wall-clock duration is
retained rather than silently relabelled. See `capture-followup-20260915/` logs.

The passive registered-capture `baseline-1` diagnostic failed on default SwiftShader
with seven real SOG files, a 1440×900 viewport and DPR1. It retained 53 returned
render calls with no probe errors. The last two developing chunks were still at
opacity 0.95349 around 68.46s and 0.97840 around 86.63s. The final page-screenshot
step occupied 236.6s before the 300s test budget expired; the summary records
305.0s including finalization. Font-network causation is unproven. Returned render
calls measure CPU/native submissions, not GPU presentation. No synthetic input or
extra render loop was added. Evidence remains under the native checkout's
`packages/web/output/t613-capture-diagnostic/runs/baseline-1/`.

A three-file dissolve candidate now gives each opacity channel its own monotonic
timeline, consumes its full elapsed interval and preserves retargeting, reduced
motion and the final redraw. Its 45 focused units and 54 PlannerScene/lighting/SS++
regressions pass, as do app/E2E types, scoped lint and the web build. The app fix is
committed locally as `ea07e8b2`. Static receipts:
`output/qualification/capture-followup-20260915/dissolve-*-1.*`. The build used the
local validation key; that generated dist is not a deployable artifact.

The identical SwiftShader `candidate-1` diagnostic now observes all seven chunks
at exact opacity 1 by 21.745s, but still fails the unchanged viewport screenshot
after 273.277s in that step. Its 47 returned calls and frozen delta-seven source
hashes are retained in `dissolve-default-comparison-1.json`. The fade defect is
corrected; the full screenshot stall is not. The failure explicitly records fonts
loaded before timeout, so waiting for fonts does not explain the entire stall.

The explicit RTX comparison `candidate-rtx4090-2` passes in 19.5s overall; its test
body records 14.554s and the unchanged viewport screenshot takes 355ms. Every
observed adapter is ANGLE/OpenGL through D3D12 on NVIDIA GeForce RTX 4090, with
zero probe errors and 81 returned calls. Source assets, pixels, timeouts and the
capture sequence are unchanged; native GL launch settings and backend selection
are the intentional experimental difference. Attempt one correctly failed when
the environment selector alone still produced SwiftShader. Both attempts remain
under the native `packages/web/output/t613-capture-diagnostic/runs/` directory;
`graphics-harness-transfer-1.json` and `-2.json` record the observer/config deltas.

The resulting viewport was inspected: it retains the room chrome and visible
unverified-runtime evidence label. This legacy package's appearance/alignment is
not newly accepted and the screenshot is not a fidelity or performance benchmark.
The explicit software OpenGL comparison also passes: `candidate-llvmpipe-1` takes
40.2s overall, with a 31.723s test body and a 13.962s viewport screenshot. Every
observed adapter is Mesa llvmpipe, with 59 returned calls and zero probe errors.
Both completed viewports were inspected against the stated evidence-label contract.
This supports selecting the existing native GL path for capture tests; it does not
turn the separately failed Twin frame-performance gate into a pass.

A shared launch helper now selects that backend only in the three capture specs.
Their existing bodies, assets, assertions, timeouts and quarantine remain intact;
whole-E2E types and scoped lint pass. The staged screenshot helper reads its
application-owned preserved canvas without artificial wheel events. Commit
`f78e190f` contains this capture-test change.

All eight scheduled capture cases now complete: seven pass, one original walk-exit
quarantine remains skipped, with zero retries and no snapshot changes, in 2.4 minutes.
The cache directory was absent before the run; all five descriptor-verified files
were downloaded and their final hashes match. The child process used the disclosed
Node connection setting, without prewarming or global environment changes. Actual
CDP-throttled streaming, controls during loading, reduced motion, camera containment
and registered/failed/uncaptured states pass. All eight frozen source/lock hashes
match before and after. Receipt: native
`output/qualification/t613-capture-native-gl-linux-20260915/run-1/`.

The same passive capture also passes under a clean `env -i` plus `xvfb-run`, with no
inherited WSL display, in 39.8s overall. The workflow now wraps the existing E2E
command with `xvfb-run --auto-servernum`; the hosted image already includes the
required dependency. Actual hosted backend/results still require the next run.
The unchanged five Twin tests completed under this same clean Xvfb setup: two
passed and three failed in 32.6s, with no retries. The actual adapter is Mesa
llvmpipe, and both benchmark/lock hashes match after the run. The room hop's
longest task is 244ms against 150ms; pano and dollhouse RAF p95 are 66.7ms and
50ms against 20ms. The capture environment correction therefore does not close
the required performance gate. Retained receipt: native
`output/qualification/t613-twin-native-gl-xvfb-linux-20260915/run-1/`.

### Second hosted candidate

PR16 now contains head `61ccc5a601f6fa69d71aadae40f3d797a08740ff`. Hosted
run35008947128 uses merge `037fcc83c4244936b7d94914966b682b0525e362`; both trees
are `a8fe4125a4392e24e2ee8e2a0bc2982a050addad`. The complete run has closed with
nine passing jobs and one failure, browser shard four. Audit, lint, types, build,
workspace Test, native-image and browser shards one/two/three passed.
Platform PostgreSQL passed 60/60 and
event access 53/53 with zero skips and 69 migrations/replay entries each.
Native-image passed 12/12, digest
`sha256:32fba1ec2e9d6d3a75453d21d0b23c8f6d8c57c469907a3dbdda06f7894f36ba`.

The closed browser results contain 304 ordinary passes, four executed expected
failures, three failures and 42 original skips, with no flaky outcomes. The skip
identities match the prior run exactly; the capture worker group moved one
quarantine between shards. All seven active capture cases pass on their first
attempt, including real staged streaming and the full registered-capture viewport.
Actual throttled diagnostics report first paint at 7028ms and five chunks resolved
at 16979ms with 50Mbps configured; these are this fixture's hosted observations,
not physical-device or general loading guarantees.

Only the three unchanged Twin timing cases fail: the hop's longest tasks are
224/202/191ms over its three attempts, pano RAF p95 is 50.1/66.8/66.6ms and
dollhouse RAF p95 is 33.4/50.1/33.4ms. The actual observed renderer is Mesa
llvmpipe. Their 150ms/20ms limits remain unchanged. Final source-bound inventory
reconciliation accounts for all 353 unique cases: 311 executed, zero missing,
extra, duplicate, unrun or interrupted cases. Six retry attempts belong only to
the three timing failures. The original 42 skip identities and four executed
expected-failure identities match the previous run exactly. The reconciler's
exit1 denotes complete accounting with real failures, not a qualified release.

Retained candidate artifacts and inspected capture screenshots:
`output/qualification/hosted-pr16-35008947128/`. The screenshots establish the
stated rendering/evidence-label behavior. The legacy capture's blurred appearance
and alignment are not accepted, corrected or reclassified as fidelity evidence.

Vercel Preview deployment6465933837 reports success at this exact head. Its
homepage opens in the existing authenticated provider session, but following Plan
Grand Hall fails because the preview requests `http://localhost:3001/venues`
and receives `ERR_CONNECTION_REFUSED`. Ordinary Retry reproduces it. This is the
preview's observed effective API target; stored provider settings were not
inspected or changed. The successful preview build is not venue-flow qualification.
See `preview-observation.md` in the retained candidate directory.

Resolve the required GPU timing path without waiving coverage, then integrate
through T-601, verify production source/provider identity
and exercise the changed authorized live flows. PR16 remains draft and unmerged;
no Goal17 change has been deployed to production.

Physical iPhone/iPad/standard-office-PC 60fps, photographic PSNR50+, the complete
platform and founder aesthetic acceptance remain open.

### Exact-commit GPU diagnostic and job preparation

An ordinary bounded local diagnostic now exercises the same PR head `61ccc5a6`,
tree `a8fe4125`, in fresh native Linux source. The independently derived Git manifest
covers all 3,191 tracked files. The first Windows archive inherited line-ending
conversion and failed 2,664 file hashes before any install/test; that failed
receipt is retained. A command-level `core.autocrlf=false` archive matches every
committed blob. Offline frozen installation passes in 27.6s, with no downloads;
all 3,191 tracked hashes still match before and after browser execution.

All five existing Twin cases pass in 22.8s with one worker, no retries/skips or
snapshot updates. The explicit `env -i` wrapper supplies only the recorded WSL
graphics/display settings and ordinary test paths; no `TWIN_*` budget override
is supplied. The actual in-test renderer is ANGLE D3D12 NVIDIA GeForce RTX 4090,
at 1440x900/DPR1. Pano/dollhouse render-submission p95 is 16.9ms/17.0ms and RAF p95
is 16.8ms/16.7ms against the unchanged 20ms limit. Both samples sustain native
input, actual draws and changing rendered camera transforms through all four
quarters. The hop has zero observed long tasks. Isolated late submissions remain
57.7ms/97.6ms; the original maximum-one-consecutive-late-frame rule is unchanged.

This is source-bound local evidence on the existing shared machine. It does not
authenticate an isolated CI worker or publish an enforced check. Retained wall
timestamps and monotonic report duration disagree by about 110ms at closure;
do not manufacture a compatible authenticated receipt or relax the verifier's
clock checks. Raw receipts remain unchanged. Synthetic full-size imagery and
the empty GLB do not qualify real venue geometry, physical devices or aesthetics.
Evidence: `output/qualification/gpu-ci-contingency/exact-pr61ccc5a6/`,
including raw samples, runtime/source checks and root/independent review.

The output-only controller proposal now derives its complete source map from
independently chosen Git objects, pins the unchanged benchmark/verifier, and
prepares fresh nonce/expiry-bound jobs without launching or publishing anything.
The source builder passed 20 baseline tests and two focused transport regressions;
the job preparer passed nine boundary tests. Independent review corrected
non-ASCII version acceptance. Source identity and prepared jobs are distinct from
authenticated worker execution; expiry/replay enforcement, isolated hardware,
transport and publishing remain unimplemented. Receipts and limitations are in
`output/qualification/gpu-ci-contingency/controller-proposal/`.

Hosted CI35008947128 remains failed. No worker enrollment, new compute purchase,
branch-rule change, merge or production deployment occurred. The founder's
hardware arrangement choice remains pending, and Goal17 remains active.

A subsequent authenticated dashboard audit confirms the failed preview belongs
to the existing `omnitwin-web` project at PR head `61ccc5a6`. `VITE_API_URL` exists
only in Production; no matching Preview or shared Preview setting is present.
Its stored Production value is `https://api.venviewer.com`; the active production
bundle was not inspected by this audit. One Python preflight failed before an
HTTP response with an unretained nested transport cause. A subsequent Node
preflight to that API returned 204 but no `Access-Control-Allow-Origin` for this
exact preview origin. Thus the missing variable alone is not a sufficient repair.
Provider settings, production access rules and deployments remain unchanged.
Sanitized receipts and the separate root addendum are under
`output/qualification/hosted-pr16-35008947128/preview-configuration-audit/`.
