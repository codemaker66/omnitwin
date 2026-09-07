# Supplied furniture in the planner — 7 September 2026 follow-up

Blake added two 4ft cloth-covered trestles and reported that the venue planner
still appeared to use the old furniture. This extends T-602. T-601 coordinated
the release, then explicitly handed execution to the founder's dedicated
`Deploy Venviewer to live site` task on 7 September. This task continues to own
the furniture's changed live-flow verification.

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
This follow-up shipped in web/API release
`7f2a701b4dade7d9d6048a82511ffa83cf4ff821`. Vercel production deployment
6314446074 succeeded; the inspected web module is `index-MYrlSuOu.js`.
All 20 GLBs and 20 previews match their prepared bytes. All 20 provenance files
match the release Git blobs; the initial 18 metadata mismatches were the Windows
checkout's CRLF versus the deployed LF bytes, retained in the original comparison
receipt rather than discarded. The live inventory lists both new 4ft trestles.

Subsequent visual investigation found a separate orientation defect: the Turini
GLB faces +Z, while table seating assumes -Z. An independent projection of the
original and runtime vertices confirms the backrest is at negative Z. The
orientation task's candidate `ead48f86af307a3545585d8c823e415b4dd303d2` normalizes
the renderer's chair basis and corrects rectangular seating rotation signs.
It is qualified and included in the deployed release. The prepared round layout
keeps exactly the same poses and footprint qualification. Live visual inspection
shows the Turini seats facing the table centres. The earlier local functional
checks alone did not establish correct facing.

The new private DEMO ONLY configuration is
`c6b0c1af-ff93-4fde-9b15-2789c3ec4cbb`, revision 2, with exactly 10 imported
white-cloth rounds and 80 Turini chairs. Its draft event variant is
`3cfcc8dd-8e3c-45af-b530-38705f76f653`. Guarded production creation, save and
GET readback passed; the original configuration and historical artifacts passed
preservation checks at 19:02:54 UTC. No approval, phase freeze or Ops compilation
was performed. The original 162 object rows were not edited.

The actual live planner opened this exact configuration with 90 current rendered
objects, inactive historical preview and enabled Add furniture controls. Read-only
R3F inspection found two visible instanced batches: 10 tables at 50,000 triangles
and 80 chairs at 52,986 triangles, both with base-colour, normal and metallic maps.
The native canvas was 3814 × 1720 at DPR 2. The furniture task inspected its CUA
screenshot inline. The navigation task additionally saved its independently
captured 19:16:49 UTC image at
`D:/claude/venviewer-presentation-readiness-20260907/navigation-live/planner-design-7f2a701.jpg`,
which the furniture task then inspected from disk. This also qualifies the explicit-route fix
against the previously restored 162-object locked historical preview.

A separate private QA configuration, `ccb80d7c-2bb7-4c7f-a8c3-bb4804eaeb76`,
passed the actual live UI sequence: Guests 16 → Banquet rounds generated two
imported rounds and 16 Turini chairs, saved/read back at revision 3. Catalogue
placement then added the black 4ft trestle with two Turini chairs and the white
4ft trestle alone. The white table was rotated 90 degrees in its single-object
inspector. Revision 6 saved and reopened with all 22 objects unchanged, including
server IDs, transforms, group membership and dressing. The complete sorted raw
object SHA256 before and after reload is
`4cfe3201c239cf3e19025ff7c42c95d9dc65cb0772c0c19886ae4c34655544bc`.
The reopened renderer contains four visible full-PBR batches (2 rounds, 18 Turinis,
1 black trestle and 1 white trestle), with inactive historical preview. The white
table's rotation read back as 1.57080 radians. Both trestles retain their intrinsic
cloth with no authored linen overlay. This QA draft has no event link.

The final read-only API comparison exceeded initial 3-second and 25-second tool
timeouts before completing successfully; this delay is retained as evidence,
not hidden or presented as a save failure. No write was retried. An intermediate
CUA stale-element error after switching 2D views and a locator miss were resolved
with a fresh accessibility tree before continuing.
A later return to the demonstration hit a transient network load error and venue
access check. One normal reload recovered the saved 90-object layout; the tab was
left in selection mode and marked as the deliverable. No fresh draft was created
from the error screen. The load error remains a recorded reliability limitation.

The independent navigation task also inspected the exact 90-object live route:
editable catalogue, Flow → More → Scene overlays → Guest flow on/off, return to
Design and Interior; no furniture writes. A brief 2D check found that unknown
imported table capacity was incorrectly labelled “0 cap.”; the actual placed-chair
count was correct. Isolated correction
`957e3e4c00d4161fab72998f301acf61332c4074` preserves unknown versus known zero,
shows a neutral Round/dimensions label, and passes 190 blueprint tests, full
web/E2E typecheck and scoped lint. It shipped in web release
`2805f78e5b94e34a95e052407180ed2ed2a9e063`, Vercel deployment 6315127880,
module `index-KV0_vdZi.js`. API remains the unchanged 7f2 release. The furniture
model files, shared catalogue, defaults and seating geometry are unchanged from
7f2, so the exact published model-byte receipt remains applicable.

The actual live 2805 QA view passed: two Round labels, zero “0 cap.” labels,
round-table dimensions in Layers and the selected inspector, no invented capacity
row, and the correct 18 placed chairs across four tables. The initial signed-in
venue-access check exceeded the navigation tool's 10-second timeout but completed
without retry or auth bypass. The live screenshot was inspected inline; these
checks made no production writes. The planner was returned to the 90-object 3D
demonstration afterward.

The independent performance task's final moving-camera qualification is
inconclusive: unsolicited trusted pointer input/capture loss interrupted all
bounded samples. It retained the raw traces and unchanged native-buffer evidence.
Neither a 60fps pass nor an idle demand-render sample's low frame rate is a valid
moving-camera GPU result. No furniture performance guarantee is made here.

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

An independent closeout review found a separate scaled-chair capacity edge case:
nine legacy chairs at scale 2 overlap around a 1.83m round even though the current
circumference formula permits nine. Seven fit in the independent footprint check.
The unscaled Turini default and this eight-chair-per-table demonstration are
unaffected. A bounded regression fix, `997d980b1837d48454e692624b67a65b90111780`,
is qualified for the next release: five reproduced failures become passing
independent SAT geometry cases; 60 affected tests, full web/E2E typecheck and scoped
lint pass. The conservative chair-corner limit preserves the unscaled Turini
ceiling and exact showcase poses. This fix is not yet deployed, and this report
does not establish non-overlap for every scaled arrangement in the current release.

The release owner's final read-only production inventory at 19:21:07 UTC records
16 configurations and 281 objects. These include the furniture task's 90/22-object
drafts plus two separately created configurations with 2 and 5 objects; timestamps
establish that both configurations predate this task's writes. Their concurrent
work was preserved. The protected original 162 objects, configuration, snapshots
and bookings retain their baseline hashes; there remain four events, 15 bookings,
zero sent-email rows, zero stock rows, 40 assets and 69 migrations. Receipt:
`D:/claude/venviewer-presentation-readiness-20260907/preservation-after-live-qa-inventory-20260907.json`.
