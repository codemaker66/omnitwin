# Live imported furniture verification — 7 September 2026

## Deployment and workload

The private production demonstration is
https://venviewer.com/plan/c6b0c1af-ff93-4fde-9b15-2789c3ec4cbb.
It contains 10 imported white-cloth 6ft round tables and 80 imported Burgess
Turini 18/3 chairs. The guarded save/readback reached revision 2; the timeline
preview is inactive and Add furniture is enabled. This is a demonstration draft,
not an operationally approved layout.

The measured web source is `7f2a701b4dade7d9d6048a82511ffa83cf4ff821`, entry
`/assets/index-MYrlSuOu.js`, production deployment receipt `6314446074`.
The API independently reported the same SHA and production environment.
The furniture publication receipt verifies all 20 GLBs and 20 preview images
against expected bytes and SHA-256; provenance matches the exact release blobs.

The actual rendered scene contains two visible instanced furniture batches:
10 × 50,000 table triangles and 80 × 52,986 chair triangles, with base,
normal and metallic maps. Furniture alone totals 4,738,880 triangles.
The captured Grand Hall is also loaded: both final probe endpoints record 12
populated splat chunks with 6,030,980 source splats. That is a source count,
not a claim that every splat is simultaneously drawn. The original approved 162-object
configuration and its frozen history were preserved by the draft executor's
guarded verification.

## Measurement conditions

The actual authenticated Brave browser runs on Windows with an RTX 4090
(24 GB, driver 596.49), Ryzen 7 3800X and approximately 32 GB RAM.
The native viewport is 1907 × 860 CSS pixels, DPR 2, with a 3814 × 1720
drawing buffer. No viewport, DPR, asset, LOD or quality overrides are used.
Other user applications remain open; host load is retained rather than assumed
idle. This is desktop evidence, not a laptop or iPad qualification.

The workload drives the application's real right-button Interior camera look.
The probe records actual main-render return times, camera poses, RAF callbacks,
buffer dimensions, long tasks and environment changes. Browser compositor
traces separately record presentations attributed to the exact page frame and
renderer process. Renderer return cadence is CPU submission evidence, not
physical display timing. Chromium presentation feedback is also not a measured
input-to-photon latency result.

Each timed run must retain the correct configuration, all 90 imported instances,
unchanged furniture transforms and native drawing buffer, sustained actual
camera motion, and uninterrupted trusted right-pointer input. Average FPS alone
does not establish a steady 60 FPS experience; presentation gap percentiles,
longest gaps and counts over 16.7/33.4/50 ms are reported separately.

## Retained invalid attempts

- The early local fixture attempt used the wrong mouse button and did not move
  the camera. Its sparse demand renders are not a GPU throughput measurement.
- A later local attempt stopped at an unsupported raw keyboard tool call,
  before a timed sample. It does not establish performance.
- Live 19:07:57 UTC: all 758 commanded right-pointer moves were observed, but
  204 additional trusted zero-button moves followed an off-script path. The
  sample was rejected as contaminated input; its approximately 100.5 renderer
  returns per second are not a performance pass.
- Live 19:08:47 UTC: an additional trusted pointerdown at approximately 4.114 s
  and pointerup at 4.661 s interrupted the held look. The deployed camera clears
  dragging on pointerup and then settles. The remaining idle interval is not
  interpreted as a rendering slowdown. Raw trace, inputs and rejected result
  are preserved.

The trace parser initially failed attribution because the start marker preceded
the first layer-tree marker by 5.135 ms. Earlier explicit browser frame-to-process
metadata supplies the correct identity. A separate v2 parser uses that evidence,
rejects conflicting/wrong identities and passes 15 deterministic fixtures.
The original parser and failed output remain intact. Correcting trace attribution
does not make the interrupted motion sample valid.

## Evidence locations

Raw probes, inputs, compositor traces, parser fixtures and host counters are in
`D:/claude/venviewer-planner-branding-20260907/output/playwright/furniture-performance/`.
Publication and guarded scene receipts are in
`D:/claude/furniture-followup-20260907/live-furniture-publication.json` and
`D:/claude/furniture-followup-20260907/live-showcase-render-receipt.json`.

## Final bounded timing attempt: inconclusive

The final production attempt began at 19:19:30 UTC using the v2 probe and
parser. It retained the native 3814 × 1720 buffer and actual 90-object scene.
The compositor trace is complete and attributable, but the movement protocol
failed again. An additional release had already lost pointer capture during
preflight; this is retained as a further protocol defect rather than a readiness
pass. Two additional trusted pointer presses at +337.4 and +813.0 ms,
releases at +768.6 and +1247.3 ms, and corresponding capture loss interrupted
the scripted held look. There were 355 zero-button moves and 23 moves with an
unexpected target/identity. Camera travel is zero in every full second from
second 2 onward. No in-sample repress, recovery, dropped outliers or quality
reduction was used.

The rejected sample contains 102 main-render returns and 101 unique browser
presentation timestamps across 15.020 s. Its approximately 6.7 presentations
per wall-clock second includes the long idle demand-render interval and is
**not** a 6.7 FPS GPU throughput result. The diagnostic presentation gaps have
p95 20.788 ms, p99 108.346 ms and maximum 241.654 ms; these belong to the
interrupted attempt and do not qualify uninterrupted movement. Selecting only
its short active interval would not establish a passing 15-second workload.

Final files use prefix
`2026-09-07T19-19-30-922Z-live-7f2-native2-final-traced-v2-ff17a1fb` in the
evidence folder above. The renderer wrapper and listeners were cleaned up,
input was released, and the owned browser tab was navigated away from 3D.
All participating tasks were told the GPU window was released.

Deployment and functional furniture behavior passed. **Steady 60 FPS and
“no lag” remain unverified.** A clean sustained-motion run with exclusive
pointer input is still required; this report neither certifies performance
nor attributes the failed protocol to a product rendering defect. The source
of the additional native input was not established.

## Live functional checks

The furniture task separately completed placement, rotation, save and reload
checks in private QA configuration `ccb80d7c-2bb7-4c7f-a8c3-bb4804eaeb76`.
The inspected receipt is
`D:/claude/furniture-followup-20260907/live-qa-render-receipt.json`.
Its final persisted
state is 22 objects at revision 6, including two imported rounds, 18 Turini
chairs and one each of the new black and white 4ft tables. Four visible batches
retain their full PBR maps. The white table's 90-degree rotation survives reload.
The raw object hash before and after reload matches:
`4cfe3201c239cf3e19025ff7c42c95d9dc65cb0772c0c19886ae4c34655544bc`.
The 90-object demonstration is a separate saved configuration and was not
changed by these QA actions.

The navigation task also verified the live Flow → More planner tools → Scene
overlays → Guest flow toggle in both directions, with the control hit target
and panel bounds checked at the actual native viewport. These functional
checks carry no FPS or operational-approval claim.
The independently captured 90-object screenshot was inspected from
`D:/claude/venviewer-presentation-readiness-20260907/navigation-live/planner-design-7f2a701.jpg`.
The QA receipt retains read-only timeout and stale-locator attempts, subsequently
resolved, and separate follow-ups for an unknown 2D capacity label and oversized
chair-round capacity. These checks do not certify the full capacity-planning UI.

The local instrumentation changes passed 15 trace-attribution fixtures and
five camera-pose checks. The v2 pose comparison first checks exact equality
to avoid floating-point quaternion noise falsely labelling an unchanged camera
as moving. Real translation and rotation remain detected. These are test-tool
changes only; no product rendering code or assets were changed by this task.
