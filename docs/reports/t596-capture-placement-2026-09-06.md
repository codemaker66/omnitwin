# Capture furniture placement and seating controls — 6 September 2026

The real interactive rehearsal found two blocking defects. In Capture mode,
catalogue placement could not intersect a floor because the visible room shell
was absent. After fixing that, the seating dialog's Place Chairs button was
covered by the room-layer controls: an actual click switched to Combined instead
of placing furniture. Both failed observations are retained.

## Change

A hidden interaction mesh follows the existing planner polygon in every live
Model/Capture/Combined scene. Concave outlines and the existing render coordinates
are preserved. It paints no visible floor, writes no depth, and makes no new
architectural accuracy claim. The mesh and placement system withdraw together
for immutable phase previews. Pointer handlers resolve the current floor instead
of retaining a removed shell, and direct clicks obtain their own floor hit.
Furniture and chair-brush releases cancel over a panel or missing/outside floor;
a valid brush uses its actual release endpoint.

The seating dialog now portals to the document body above the transformed
planner, preserving its focus trap and confirm/cancel behavior. Its panel fits
the viewport and can scroll. Reduced motion disables its animations. The old
backdrop blur remains absent, matching the planner's existing GPU constraint.
The placement coach avoids the reference viewer's side panels and preview lock.

## Verification

- The initial PlannerScene regression failed in Capture, then passed after the
  interaction floor was implemented.
- 44 focused component/pointer/geometry checks pass, plus 150 existing placement,
  chair-brush, chair-dialog-store and table-dressing checks. Actual Three.js
  raycasts cover concave boundaries, orientation, hidden targets and withdrawal.
- Web source and E2E typechecks, changed-file strict lint and production-mode
  compilation pass. The build took 38.41 seconds and used the repository's CI
  placeholder Clerk key; it is not a deployable real-account artifact.
- Independent source review found the adjacent stale chair-brush release branch;
  that branch was repaired and re-reviewed. One initially untyped test mock failed
  strict lint and was corrected; neither failure was hidden.

In actual visible Chromium at 1016×571 CSS pixels / 2560×1440 rendering, the
corrected flow clicked the captured floor, opened an unobstructed seating dialog,
and placed one round table with eight chairs. Ivory linen and dinner settings
were applied through the actual controls. The controlled API saved the nine
objects; a fresh page load restored every item and styling field exactly.

A real pointer drag from the catalogue added one poseur table. A second drag
released over Layers left all ten objects unchanged, cleared the ghost and ended
drag mode. One Undo restored the exact prior nine dressed objects, and the API
saved that result with no pending state or save error. The final capture was
painted (12,096,360 triangles; loading caption hidden); the dedicated interaction
mesh remained invisible. These counts establish the inspected scene, not FPS.

Evidence: `D:/claude/venviewer-synthetic-interactive-20260906/`, including
`placement-capture-failure.json`, `placement-coach-overlap.jpg`,
`chair-dialog-covered.jpg`, `chair-dialog-clear.jpg`, the before/after reopen
JSON, catalogue-drag/invalid-drop JSON, `placement-final-state.json`, screenshots
and exact test/build logs. A failed developer diagnostic import of a nonexistent
configuration-store module is retained as a harness error; the corrected
editor-store read succeeded. It is not an application runtime failure.

## Scope and release

All writes used the new local rehearsal configuration
`23f634e4-d147-4326-8ca8-88c0fb40b4e6`, synthetic DEMO ONLY Owner, loopback API
3009 and isolated PostgreSQL 54339. No existing approved fixture or production
record was changed. External delivery was blocked. Source stayed frozen during
browser and automated verification. Mobile modal qualification is separately
owned and must be reported from its actual result.

The latest founder request authorizes T601's narrow combined demo release after
its gates. The task Build next-gen venue platform is the sole production release
owner and receives this tested change; this task does not deploy in parallel.
The internal-only demo review option is a separate implementation. Full live
approval, photographic PSNR50+, physical-device 60fps and aesthetic acceptance
are not established by this placement repair.
