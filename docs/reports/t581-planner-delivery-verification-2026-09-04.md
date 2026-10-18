# T-581 planner delivery verification

Date: 2026-09-04. Scope: the planner progressive-loading slice of T-581, within the first batch on [the execution board](../../goals/EXECUTION.md). Captures-console migration and production qualification remain later T-581 work.

## Source and checks

The change is committed on `codex/t581-planner-ladder` at `6dad07fe27e22baba9b96b99c002fc3a880215f3`, in `D:/claude/venviewer-t581-20260904`. The unchanged baseline is `328880ca`, in `D:/claude/venviewer-t581-baseline-20260904`. The changed checkout remained clean during verification. No source edits occurred during a browser run. Neither branch was merged or deployed.

The planner now shares the walkthrough's delivery state machine. Staged rooms load their coarse cover before refinement, retain that cover if fine tiles fail, use one renderer host and finish with the same final assets. Registered runtime packages keep their direct loading path. Stable callbacks and source identities avoid restarting requests during progress updates. A late retained-source progress defect found in independent review was fixed with a regression that failed before the correction.

Validation: the full pre-review-fix web suite passed 5,142 tests in 387 files, with 18 skipped. After the review correction, 63 focused tests passed, followed by final web/e2e typechecks, changed-file lint, a frozen build and diff checks. The full suite was not rerun after that final correction. The independent reviewer closed the identified defect.

## Loading measurements

Both local optimised builds used the same public draft, real staged tiles, a fresh browser and a 20 Mbps / 40 ms network profile. They used test build mode with the real API URL and GET-only response passthrough to adapt CORS for local ports. No API bodies were fabricated; non-GET requests were blocked. This does not qualify production authentication or CORS.

| Observation | Unchanged planner | Changed planner |
|---|---:|---:|
| First geometry response body | 22.588 s | 9.396 s |
| Last response body | 52.397 s | 60.540 s |
| Total delivered | 106.9 MB | 114.1 MB |
| Splat requests | 12 | 13 |
| Page errors | 0 | 0 |

This is one comparison, not a distribution or a device qualification. The added coarse view costs 7.2 MB and the final response arrived later. Body measurements include browser-launch time. The changed build's first geometry decode callback occurred at 8.947 s from navigation, a different clock. Neither measurement establishes when pixels were presented. The byte-idle probe stopped at 10/11 decodes; the later explicit completion checks avoid treating network completion as decode completion.

Artifacts: `D:/claude/ladder-sweep/codex-local-before-20260904.json`, `codex-local-after-20260904.json`, and the reproducible helper `D:/claude/ladder-sweep/delivery-probe.mjs`.

## Browser environment and interaction

The initial stock headless Chromium 147.0.7727.15 used ANGLE/SwiftShader software Vulkan. The unchanged and changed builds both stalled on the first evaluation after final resolve; the unchanged browser also timed out on a trivial `1 + 1` evaluation. Browser-level commands remained responsive. This failure therefore exists without T-581. No source change was made to accommodate it.

The hardware run verified NVIDIA GeForce RTX 4090 / ANGLE D3D11 through browser-level CDP SystemInfo before loading the venue. The optimised planner responded to body reads, layer switches, entering the room, camera drag, Escape and return to the mesh view. There were zero page errors. The same three 401 responses occurred in both builds for anonymous access to truth-mode summary, layout timeline and latest runtime package; they are recorded, not labelled successful integrations.

Diagnostics: `D:/claude/venviewer-t581-measurements/stall-diagnostic-{before,after}.json` and `stall-diagnostic-after-hardware.json`, with matching checkpoint `.jsonl` files and `stall-diagnostic.mjs`.

The final compiled qualification explicitly waited for `stage=sharp`, 11/11 settled, zero failed and complete=true before interaction. It waited for a nonnull initial camera and measured yaw 0 to 0.046669 radians after an actual drag. Containment, Escape returning to the plan, and Mesh selection all passed. The title/body were present and no development error overlay appeared. Page errors and request failures were empty; the browser closed cleanly. Evidence: `D:/claude/venviewer-t581-measurements/compiled-qualification.json`, with its `.jsonl` checkpoints and `.mjs` helper. An independent reviewer read this artifact and the controlled visual evidence and approved completion of the initial planner slice. No further source change was needed after the hardware environment correction.

## Visual coverage

Pixel readback was a separate diagnostic on the same frozen source, served in development mode at port 4382. The planner enables `preserveDrawingBuffer` only in development with `?capture=1`; the optimised builds ignore that flag. The actual context's preserved-buffer setting was verified before readback.

Fine requests were held while the real coarse room and environment settled. The coarse image was captured with 0/11 fine tiles decoded. The held requests were then released unchanged; the second image was captured only after `stage=sharp`, 11/11 settled, zero failures and complete=true. The camera remained identical. These deliberately controlled, unthrottled captures are visual mechanism evidence, not load-time benchmarks.

Root inspected both images. The sampled view covers the visible floor, walls, window and ceiling in both stages, with no visible tile holes; the final image resolves finer wall-board and chandelier detail. This does not establish coverage at every viewpoint or PSNR fidelity. A subsequent drag changed yaw from 0 to 0.029684 radians; containment, return to plan and mesh selection passed. Page errors and failed requests were empty.

- Coarse image: `D:/claude/venviewer-t581-measurements/coverage-diagnostic-coarse.png`; SHA256 `A7C564065CA962A9E9F78B6EE5000AE0F5174180C82EAA37B71EE781E2C81794`.
- Final image: `D:/claude/venviewer-t581-measurements/coverage-diagnostic-full.png`; SHA256 `F0DFE2E341B602221E6E26F5D8C2836F5263F6696F9CF2EB90900F1A0079CEAE`.
- Counters, camera, GPU and checks: `D:/claude/venviewer-t581-measurements/coverage-diagnostic.json`; reproduction: `coverage-diagnostic.mjs`; durable checkpoints: `coverage-diagnostic.jsonl`.

## Limits and next work

The final source quality was not reduced by this change. Existing source fidelity and resolution settings are not acceptance of the founder's eventual quality mandate. No PSNR 50+, physical iPhone/iPad/office-PC 60 fps, all-viewpoint coverage, production first-pixel threshold, accessibility or finished sublime UI claim follows from these checks.

The earlier production smoke passed four of five checks; Grand Hall first-view timing exceeded its 15-second budget in that run. A separate faster observation establishes variability, not a consistently green production gate. That smoke used the normal anonymous draft-creation flow; local comparisons then reused the draft read-only. No administrative inventory/booking data changes or paid compute occurred.

Keep T-581 open for captures-console migration and later production qualification. The later GOAL.md V0 instruction forbids a Saturday planner push. T-582's handling of permanently hung requests also remains separate work.
