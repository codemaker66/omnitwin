# Capture failure recovery — locally qualified, delivery pending

This follows the actual arrival test where all eleven Grand Hall geometry sources failed but a cached environment source succeeded, leaving the planner with an empty captured background. The existing all-twelve failure fallback worked; aggregate success counts did not identify the missing room.

Implementation is isolated in **D:/claude/capture-failure-recovery-20260907**, branch **codex/capture-failure-recovery-20260907**, based on live 7f2a701. The final twenty-file source chain is **48022cade195460f7c67e56db2c123c4ef47484b → 045a75df → b27907386a25b0dffe5605d4c7da43f89eda8693**. It is locally qualified and not deployed. T-601 coordinates its following serial intake after the current copy release, preserving the live 3b1d3389 auth changes. The prior presentation executor has archived its completed task; no parallel deployment was started.

The candidate preserves explicit staged environment roles through source resolution. Registered packages retain every URL as potential room content; a filename such as env.sog does not establish its role. Chunk outcomes retain current URL membership, ignore late removed-source callbacks and replace failed outcomes on successful retry without double-counting. Complete room-content failure selects procedural fallback even if its environment succeeds or remains pending. Partial room content remains visible with a persistent failure notice; terminal notices have no working animation and are available on narrow layouts.

Independent source review identified and corrected terminal failure being hidden behind a pending registry lookup, recovery wording that remained inappropriate after switching to Model, and a callback-stability test whose URL no longer matched the fixture membership. The ink effect is documented as a global count-driven fade, not a map of missing physical regions.

Verification to date:

- Web and E2E TypeScript checks passed. Initial misuse of --incremental false was rejected by the existing composite configuration; the actual package checks were then run without that override. A new test parameterization error was corrected before the successful run.
- Scoped ESLint passes. It first found a fixture loose-equality comparison, then an unnecessary undefined branch; the final guard checks the declared nullable type explicitly.
- Ordinary Vitest forks failed to start before any test imports, with 60-second worker response timeouts. A threads diagnostic first rejected inherited heap execArgv; a temporary config clearing that flag also stalled and was stopped. Basic child-process IPC and an actual worker handshake pass. The executor's external-config workaround preserves all original setup, assertions and timeouts while selecting one thread, clearing fork-only execArgv and supplying the heap allowance through command-local NODE_OPTIONS.
- **158 affected tests now pass**: six suites passed 128 checks in the combined run; two new scene checks failed because the inactive background group remained visible during its dissolve. The group now hides immediately on terminal capture failure; all 30 scene tests pass in the corrected run. The unsuccessful run remains a real failed regression, not a startup error. The first orchestration wrapper accidentally returned zero after restoring its environment; the actual failed Vitest result was used, and the corrected wrapper explicitly preserves the child exit code.
- Final web/E2E types and affected lint pass; production build passes in 28.78 seconds. Actual desktop/mobile failure-recovery browser verification, integration and changed live-flow check remain required. No new GPU or paid cloud workload was started.

The local vitest-qualification.config.mts diagnostic is not a product change and must not be included in a release commit. Dependency junctions reference the executor's installed modules; do not install through them.

## Local browser recovery matrix — 7 September, 19:49–20:02 UTC

Actual Brave rendering used the isolated development server at 127.0.0.1:5241, a synthetic empty public layout and the existing staged Grand Hall SOG files. The fixture controls individual source failures; it does not modify a real layout or production data. The fixture's unavailable venue/timeline labels are deliberately incomplete API responses, not evidence of production failures.

- At 1907 × 860, eleven failed geometry sources with a successful environment source close the welcome and reveal the procedural room. The terminal notice is visible and has no working animation.
- At 390 × 844, the same failure initially put the notice underneath the header. The mobile caption offset now clears the saved-layout header and provenance row; an actual fresh reload confirms readable notice text and no horizontal overflow. This CSS follow-up is not part of 48022cad yet.
- The mobile failure notice also appears when the runtime-package registry request remains pending. No arrival modal or working indicator remains after room-content failure.
- With one geometry source failed and the others delivered, the mobile capture remains visible and the persistent partial-failure notice is legible. The evidence label remains staged capture, unverified; missing content is not presented as a complete reconstruction.
- A fresh mobile arrival displayed the actual venue photograph correctly. This establishes that the local component can display it; it does not settle the earlier live cold-load timing issue.

The mobile full-failure screenshot exposed an additional usability defect: the normal portrait interior camera leaves the procedural fallback looking mostly at a wall/empty background. A failure-only camera handoff is being implemented and tested before this change is offered for release. Normal capture camera positions, explicit navigation, tours and history ownership must be preserved. Browser verification paused while source changes; its local tab is closed and the release executor was told the GPU/browser lane is temporarily free.

Screenshots were inspected directly in the CUA tool output. Source-request history is retained in D:/claude/capture-failure-recovery-20260907/output/playwright/capture-requests.ndjson. These are functional checks at emulated viewport sizes, not physical-device performance or aesthetic acceptance.

## Final camera and browser qualification — 20:20 UTC

The final camera follow-up is b2790738. Terminal room failure requests a one-shot planning overview after the existing Walk pose restoration. It fits the real room envelope to the current aspect/FOV and expands only the failure-specific orbit distance cap. Explicit Model, Flow, saved references, transitions and tours retain camera authority; frozen history defers recovery until its own restore. A user's subsequent camera adjustments are preserved. The normal captured-view camera is unchanged.

The camera adds 23 passing real OrbitControls tests and four tests projecting every envelope corner with a real Three.js perspective camera. Final web TypeScript, E2E TypeScript and scoped lint pass. Together with the earlier 158 source/scene/resolver checks, 185 affected checks passed across separate runs; this is not one combined test invocation. A later worker-startup retry again failed with two timeouts after 121.08 seconds and zero transform/setup/import/test work; a silent type-check attempt was stopped without claiming a result. Subsequent bounded runs produced the actual passing results. No assertion or timeout was weakened. The final production build passes in 23.95 seconds; its log SHA256 is 25b04045dd501aa4b0304ace4662690934f82c2386cec3be67dc7a45fd39806c.

Actual frozen-source Brave checks confirm:

- At 390 × 844, total room-content failure shows a complete procedural planning overview beneath a readable terminal notice. A selected Overhead preset takes control afterward, and 2D opens with planning geometry. This does not qualify the entire older mobile 2D/More-menu layout or contrast.
- With all sources delivered, the same phone viewport returns to the full captured hall, keeps its ordinary interior perspective, closes the welcome and shows no failure notice.
- At 1907 × 860, the failed capture shows the complete procedural room with the notice and controls visible. Explicit Model changes the selected mode and remains usable.
- Partial capture and failure while registry lookup remains pending were observed in the earlier matrix. The camera's terminal-only predicate does not execute for partial availability; those source/caption paths are unchanged by the camera follow-up.

The first repeated failure attempt still rendered cached successful sources: only seven local requests reached the fixture, even with the parent page's HTTP cache disabled. It was recorded as a partial result rather than counted as full-failure success. A fresh localhost origin established the phone's full-failure case; a fresh port 5242 established the desktop case, with all eleven geometry requests and env.sog present in the retained fixture log. The precise worker cache mechanism was not established. All temporary cache/viewport overrides were restored; both local verification tabs and both local server sessions were closed/stopped afterward.

The exact qualified chain and receipts were sent to Build next-gen venue platform for coordinated intake. Integration, deployment and a changed production-flow check remain required. Existing global CI E2E failures/cancellations are retained in the presentation executor's ci-2805-summary.json; these local checks do not turn that full suite green. No source capture was altered, no production layout was written and no new compute spend was started. Reconstructed image quality, physical-device 60fps and founder aesthetic acceptance remain separate open goals.
