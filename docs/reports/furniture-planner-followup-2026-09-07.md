# Supplied furniture in the planner — 7 September 2026 follow-up

Blake added two 4ft cloth-covered trestles and reported that the venue planner
still appeared to use the old furniture. This extends T-602. T-601 retains sole
production release ownership.

## Reproduced live behavior

On the published `11ad2dbf` application, the approved demonstration configuration
`3b18bfc3-4a40-4723-8130-13134c80e16e` contains 144 generic Banquet Chair objects
and 18 generic 6ft Round Table objects. Both catalogue entries still resolve to
procedural geometry. A fresh browser loaded no furniture GLBs when showing this
layout, and screenshots confirmed the old meshes in current and historical views.
The earlier batch made the imported variants selectable, but did not replace these
default choices. At 12:16 UTC the original remained approved, revision 10, with
all 162 objects and the unchanged sorted-object SHA-256
`568a9086b7c6525f9766de01fb39fc51f119b16185ed3af7fa7bd530d022d9d7`.

Automatic table seating, quick-add and Guests layout generation explicitly chose
the old chair/table slugs. Group rearrangement also overwrote existing chair asset
IDs with that hard-coded chair. Correcting defaults must preserve existing slot
identities and use actual chair dimensions for spacing and capacity.

## New source assets

The source folders are `E:/downloads/furniture_glbs/4ft_tressel_black_cloth` and
`4ft_tressel_white_cloth`. Each provides a distinct one-million-triangle PBR GLB.
The original files remain unchanged. The existing reproducible preparation script
produces 50,000 triangles per model, with base-colour, normal and metallic/roughness
maps at 1K. Total GLB size is 4,197,152 bytes; previews total 9,170 bytes.

The new catalogue identities are `trestle-4ft-black`
(`b55671ff-925d-573f-bf11-359e15736557`) and `trestle-4ft-white`
(`166ead7c-6eba-5462-8380-519e9ba8e4bd`). Their approximate planning envelope is
1.22 m wide × 0.76 m deep × 0.74 m high. Only nominal 4ft length is indicated by
the source folder; depth and height follow the comparable trestle catalogue.
Both imports include cloth geometry, so the generic linen tools must not add a
second cloth. No stock quantity is inferred.

## Saved and historical layouts

The original generic chair has a nominal 0.45 × 0.45 × 0.90 m envelope; the supplied
Turini is 0.42 × 0.58 × 0.88 m. Aliasing the GLB onto the old envelope would cause
the current uniform-fit loader to shrink it to about 0.683 m high. Changing a live
mesh URL can also change historical preview appearance. Neither is an acceptable
way to update the approved demonstration.

Newly authored groups use the supplied, correctly dimensioned chair and imported
white-cloth round table. Automatic aisles are measured between complete occupied
chair groups. Wall snapping includes rotated chair corners: the previous depth-only
reserve missed the 13-chair ring's corner by 14.2mm. Existing object IDs, asset identities, planning dimensions
and frozen snapshots stay intact. A separate private DEMO ONLY draft can showcase
the imported models using geometry qualified against their actual envelopes;
it is not a replacement of the approved operational layout.

## Qualification state

The two prepared GLBs reproduce byte-for-byte in a second clean run, and their
bounds and floor alignment were read back. Source and final previews were inspected.
The shared catalogue's 17 integrity tests pass. API migration 0069, existing import
replay, seed and readiness checks pass 60 focused tests against explicit disposable
PostgreSQL targets, including the complete 68-entry migration chain. API typecheck,
build and scoped lint pass. The local inventory browser renders both new previews
and leaves physical stock unrecorded at desktop and 390px widths. The final web
checks pass 229 planner regressions plus 42 model/linen/history regressions, full
typecheck, scoped lint and a standard production build. The build used the existing
public Clerk key read from the published application; no secret environment was
copied and no production guard was disabled.

Actual browser checks pass Guests banquet generation (2 imported rounds and 16
Turinis), theatre generation (32 Turinis in complete rows for 16 requested guests),
quick auto-fill, and banquet save/reload with stable database IDs and poses. Both new
4ft models were dragged from the catalogue onto the floor; the black table accepted
two Turini chairs, the white table was placed alone and rotated 90 degrees. All four
objects survived save/reload. Three actual instanced imported mesh batches rendered
with base-colour, normal and metallic/roughness maps; no extra linen was applied.
Desktop and 390px screenshots are retained. The narrow viewport is responsive
evidence, not a physical mobile GPU performance measurement.

Failed local evidence is retained: worker-start contention, the corrected misplaced
wall parameter, stale legacy test selectors, and browser harness errors from HMR
module selection, asynchronous polling and group-versus-single selection. Final
browser polls await the actual mounted editor bridge's stores and server-assigned
IDs. No persistence assertion was weakened to hide data loss.

Source checks completed in the isolated
`codex/furniture-planner-followup-20260907` worktree.
This follow-up has not yet been deployed.

A separate demo geometry experiment uses the actual 21 × 10m room outline and
application-generated Turini seating, with positions quantized to millimetres.
Independent circle/OBB and OBB/OBB checks include every pair, including chairs and
their own table, plus every footprint's room boundary. A newly generated 18-table,
144-chair grid at 3.30m pitch has no static overlaps but only 0.210m minimum group
gap and 0.155m minimum wall gap. A 10-table, 80-chair 4 × 5m grid provides 0.910m
and 0.955m respectively. This is geometric evidence, not an aisle, comfort, fire or
operational approval. All seven candidate files reproduce unchanged against the
final source. The selected 10/80 candidate also passes all 4,005 full-footprint pairs
after actual five-decimal API rotation rounding (minimum gaps 0.909998m and 0.954999m).
The original approved 162-object plan remains unchanged.

Detailed evidence and the supported generated-draft API plan are under
`D:/claude/furniture-followup-20260907`. Wider device-performance targets and
founder aesthetic acceptance remain separate.
