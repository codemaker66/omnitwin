# Planner capture recovery and readable annotations — 15 September 2026

Status: integrated candidate; production build, compiled browser acceptance and release are pending. This report records tested behavior, not founder aesthetic acceptance or physical-device performance.

## Problem and correction

The interrupted 7 September candidate retained a reproduced failure: with Interior and Flow active, resize a desktop planner to 390 × 844 while capture requests are held, then fail all eleven geometry sources while the environment succeeds. The capture-unavailable message appeared, but the ordinary orbit restoration left most of the procedural room outside the view.

The parent PlannerScene effect yielded Interior before CameraRig observed the failure through the separate Canvas reconciler. CameraRig consequently classified the existing Flow lens as a new orbit owner and cancelled recovery. CameraRig now records ownership before yielding Interior itself. The recovery uses the whole room envelope, current aspect and camera FOV; it changes framing, not render resolution or source quality. Explicit camera actions remain authoritative.

A separate regression found that closing a frozen layout preview remounted CockpitPlanningCamera and replayed the unchanged Flow lens over the recovered pose. That owner now remains mounted, suspended while preview owns the camera. Lens changes during preview cannot queue a later movement; a fresh Flow choice after preview still works.

Scene warnings now use measured screen placement, avoid the actual planner controls and client event schedule, and provide native tap/click/keyboard actions with owned-focus cleanup. Long disclosures remain available through a counted scroll list. Annotation ownership stays mounted during camera movement and at compact widths; animated geometry follows the existing motion/viewport policy. A covering modal temporarily defers the layer. Simulated flow, human-review requirements and heritage-guide limitations remain explicit.

## Integration boundaries

The release checkout starts from live web `28209abcb0f8bac3a115ca42fd1d81e81f621125`, preserving the F03 event-access/client-schedule work and its API `04dbd8bb89453a893cb882474002417a00ca46fc`.

Merge `1e14770c9b287c3073550a49efe8e03211b976a4` has parents live `28209abc` and recovered candidate `87aca5ca`. Three conflicts retain both capture-environment semantics and current authority, request-key and revocation guards. All twenty non-overlapping incoming blobs were verified identical. The API, shared contracts, dependencies, lockfile and CI are unchanged from the live release. No migration or business-data change is part of this candidate.

Camera handoff correction: source `5d2b20e1`, intaken as `b6bec98e`. Annotation source: `fc1e8bfe`, `25519204`, `049d8fde`, intaken as `dae742f2`, `3ee0e5be`, `6889b5b1`. The final parent wiring keeps their annotation owner outside the motion-only component. Hallkeeper, event-access and public smoke documentation closeouts are also preserved.

## Verification to date

- Combined candidate: **251 passed, zero failed or skipped, across thirteen test files**. Whole web and E2E TypeScript checks and scoped lint passed. Evidence: `output/qualification/combined-tests-20260915.json`, companion log, `combined-web-types-20260915.log`, `combined-e2e-types-20260915.log`, and `combined-scoped-lint-20260915.log` in the release checkout.
- Conflict integration: 35 focused hook/cockpit tests and lint passed before final camera/annotation intake. These overlap the combined totals and are not additional unique coverage.
- Camera regression before the ownership correction: three new desktop/portrait/resized tests failed while the original twenty-six passed. The independent frozen-preview sibling regression also failed before correction. Failed and passing receipts remain under `D:/claude/capture-flow-integration-20260907/output/qualification/`.
- Actual local Chrome, same controlled failure before and after: at 390 × 844, projected room corners previously reached approximately 3.80 horizontal NDC; afterwards every corner stayed within 0.80 horizontally and 0.35 vertically. Resizing back to 1366 × 1000 preserved the recovered pose. Screenshots were inspected. This is browser framing evidence, not a physical iPhone or frame-rate measurement.
- Local camera browser fixture permitted synthetic GET/HEAD API responses only and returned real worker-visible source failures. The read-only camera diagnostic was injected by the external development harness; it is absent from repository source and production builds. Traces and before/after images are in that checkout's `output/qualification/20260915/` directory.
- Annotation source tests: 41 checks and lint passed before integration. Earlier compiled desktop evidence found eight non-overlapping annotations with 44px targets and native click/dismiss behavior. It also exposed the parent compact/motion gate, now corrected. Final integrated keyboard, touch, modal, dock and compiled-browser checks remain pending.

## Release and outstanding acceptance

The serial release lane returned from the F03 owner after web `28209abc` / API `04db` passed fifteen public smoke checks. The existing scheduled smoke remains public and read-only; its scheduler, runner and wrapper are not changed by this work. See [the maintenance contract](../operations/public-release-smoke.md).

Do not publish this candidate until its exact production build and changed compiled UI flows have been checked. Record provider/deployed identities and actual live flow checks in the closeout. Public shell checks do not establish authenticated access or business workflow success.

Broader E2E/security findings from the previous release, real ordinary-client provider/revocation acceptance, founder approval of the sublime redesign, physical iPhone/iPad/office-PC 60fps and reconstruction PSNR targets remain open. No lower quality target or full-platform completion is claimed.
## Compiled candidate review and follow-up

The exact `809ef6ba` production build passed with real public Clerk/API configuration and authentication bypass disabled. Independent review found no material source blocker. The external camera fixture and diagnostic markers are absent from its production distribution.

Compiled desktop native click, Enter, Space, Escape, dismissal and focus restoration passed. The real schedule expanded/collapsed at desktop; a real sign-in modal made the annotations inert/hidden and Escape restored the selected warning. At 390 pixels with a standard pointer, eight warnings had 44px targets, no overlap or horizontal overflow; all remained actionable through the counted scroll list above the expanded client schedule. Actual worker-visible geometry failures produced a usable whole-room fallback with Flow retained and Interior exited.

This review found three remaining integration defects before publication: the expanded-schedule CSS omitted lens panels and allowed Flow to cover Hide schedule at tablet width; the visible capture failure notice was not an annotation obstacle; and fresh narrow/coarse-pointer sessions had no lens entry point in More or View. The follow-up adds the missing lens-panel layout rule, measures only visible capture notices and their visibility transitions, and restores canonical lens selection in the mobile More sheet with readable touch controls and focus return. Mobile desktop-inspector settings parity is not established by lens selection alone. Native-touch and final successor-browser acceptance must follow those fixes.

Follow-up source verification: **259 tests passed, zero failed or skipped, across fourteen files**. Whole web/E2E TypeScript and scoped lint passed against the frozen follow-up. Evidence is in `output/qualification/final-tests-20260915.json` and the matching final type/lint logs. Its exact production rebuild and native-touch/browser recheck are still required before publication.

## Sibling-header visual correction

Final native-touch screenshot review of `68172fc0` found an additional real overlap despite successful tap checks: the phone header occupied y8–78, while the annotation list began at y12 and its first button at y58. The header was a sibling of `.cockpit-shell`; the existing descendant-only query could not see it. The body-portalled View panel had the same ownership mismatch. The failed image and exact bounds remain in `browser-followup/native-flow-390.jpg` and `header-obstruction-result.json` under the annotation evidence directory.

Layout and resize observation now share an explicit document-level blocker collection, limited to visible controls intersecting the current canvas. Coordinates remain in CSS pixels relative to that canvas. Regression coverage exercises a sibling header resized through ResizeObserver, excludes an off-canvas widget and checks selection/beam restoration when a body-portalled View panel closes. Review of the actual outer panel bounds found no additional transition-completion correction necessary.

The final focused source run passed **260 tests across fourteen files, zero failures or skips**, plus whole web/E2E TypeScript and changed-file lint. Receipts are `output/qualification/sibling-final-tests-20260915.json` and the sibling type/lint logs. The predecessor's tablet Hide schedule button, wide coarse-pointer More→Flow entry and visible/cleared capture notice checks passed; the new exact build and fresh native-touch visual acceptance still precede publication.

## Selected-warning caption ownership

The exact `713cad08` build and native phone header/list checks passed, including all eight tap/disclosure/Escape actions, real touch scrolling back to the fully visible first warning, settled View presets, tablet schedule collapse and capture notice visibility transitions. Selecting a warning after capture failure exposed a separate duplicate: CockpitEvidenceBeam projected the same full explanation over its already-open annotation card. The retained `browser-header-fixed/view-painted-390.jpg` establishes that visual obstruction; the approximate position recorded during review is not a DOM measurement.

Annotation-owned beams now suppress only their separate HTML caption. The full label, room light column and ground ring remain, while the accessible annotation disclosure owns the explanation. Caption preference stays attached to the retained beam during fade-out; other beam producers retain the default caption. Source and tests preserve human-review wording and independent beam ownership.

Final affected verification passed **283 tests in sixteen files, zero failed or skipped**, whole web/E2E TypeScript and changed-file lint. This total includes the store and beam checks and supersedes the prior candidate totals; those earlier runs are not additional unique tests. Evidence: `output/qualification/beam-final-tests-20260915.json` and companion type/lint logs. An exact rebuild and inspection of the selected warning in the failed-capture phone state remain required before release.
