# T-602 table chair identity and orientation correction

Blake reported that spawning a table produced the old chair geometry and outward
facing seats. The supplied-furniture default change is already in `8059f239`;
the additive orientation fix is `ead48f86`.

The correction is deployed in web/API source
`7f2a701b4dade7d9d6048a82511ffa83cf4ff821`. The live imported-furniture draft
renders 10 tables and 80 Turinis facing inward. A separate live default-spawn
rehearsal also passed, including saving and authenticated readback. Earlier
pending-release notes below describe intermediate evidence, not the current state.

The runtime Turini GLB is authored facing +Z. All 24,973 vertices above 0.55 m
have negative Z, locating its backrest behind the origin. The checked-chair GLB
and generated banquet-chair factory also face +Z. The planner and ChairMesh
fallback use -Z. The fix rotates only those model presentations by pi, preserving
asset IDs, cached sources, saved poses, dimensions, material maps and floor pivots.
Both direct rendering and instanced harvesting consume the normalized hierarchy.
Rectangular seating now follows Three.js positive Y rotation and faces the head
seats inward; wide-room theatre chairs face their stage consistently.

Independent source review found no blocking issue. A single-process comparison
bundled and executed the actual baseline and corrected modules with Three.js:
baseline passed 4/11 checks and failed 7 expected checks; corrected source passed
11/11. Coverage includes round/rectangular seats at 0, 45 and 90 degrees, outside
backrests, both theatre directions, off-centre imported models and actual generated
chair explode/restore. Evidence: `D:/claude/chair-geometry-check.mjs` and
`D:/claude/chair-geometry-{baseline,fixed}.log`.

Initial Vitest attempts failed during worker startup before any source imports or
tests ran. Those infrastructure failures are not behavioral red tests. Duplicate
workers, type/lint checks and the normal development server were stopped when the
release executor took ownership of combined verification. The diagnostic browser
fixture uses actual FurnitureProxy and InstancedFurnitureLayer with shipped GLBs;
it remains outside the committed product. Combined automated gates, deployment and
live browser verification are pending as of 14:17 UTC. No production data changed.

At 14:19 UTC, actual browser rendering passed for a round table with eight uploaded
Turinis in both FurnitureProxy and InstancedFurnitureLayer. A 45-degree trestle
with eight chairs also displayed inward heads and side seats. Screenshots were
visually inspected in the task tool history. Browser resource timings confirm the
Turini, round-table and trestle GLBs completed, and no browser errors were recorded.
This is local component/rendering qualification, not yet a deployed planner check.

At 14:29 UTC the release executor reported all chair suites green in combined
`59e079f0`, with the complete build passing. The affected web batch had 720 passes
and two legacy catalogue-count expectations awaiting test-only correction; two
unrelated navigation-test type errors were also being corrected. Deployment and
the actual live planner check remain pending. Root independently read the CI
typecheck errors and confirmed they concern unsupported `exact` options in those
navigation tests, with no chair-source diagnostic.

The 18:47 UTC production receipt records successful Vercel deployment 6314446074,
matching ready API identity and public entry `/assets/index-MYrlSuOu.js`. Root
independently confirmed the public planner response is HTTP 200 with that entry,
and all nine `ead48f86` files exactly match the deployed source. The release's
stable-source, clean-tree typecheck, build and lint receipts have exit code 0;
the affected web batch passed 65 files / 934 tests, with all four chair correction
test files and imported-default coverage included in its argument manifest.
Evidence lives under `D:/claude/venviewer-presentation-readiness-20260907/gates/`
(`7f2a701-types`, `7f2a701-web-tests`, `7f2a701-build`,
`7f2a701-remote-ci`) and `live-provider-7f2a701.json` in the parent directory.

Furniture owner T602 reports the actual current live scene at
<https://venviewer.com/plan/c6b0c1af-ff93-4fde-9b15-2789c3ec4cbb> has 90 instances:
10 tables and 80 uploaded Turinis, using full PBR materials and instanced rendering,
with chairs visibly facing the table centres. Historical preview is inactive and
editing is enabled. This is the originating owner's live browser observation;
root's independent visual checks were local, and root kept its viewport closed
for the performance owner's exclusive GPU sampling. The original approved
162-object plan and its saved asset identities remain separate and unchanged.

T602 then exercised the actual production authoring UI in a separate private QA
layout, `ccb80d7c-2bb7-4c7f-a8c3-bb4804eaeb76`: **Guests Expected 16 → Banquet
rounds** generated two imported white 6ft tables and 16 Turinis. Its live screenshot
showed inward-facing chairs at both tables. **Save layout** reported **Layout
saved**, and authenticated GET readback of revision 3 contained exactly 16 Turini
asset IDs (`7f1fb7a2` prefix) and two white 6ft table IDs (`aec69e97` prefix).
The browser still identified deployed `7f2a701b` / `MYrlSuOu`. This closes the
reported default-asset and outward-facing defects with actual live spawn/save
evidence. T602's broader extra-table and performance checks remain separately
owned; no physical-device performance or founder aesthetic acceptance is claimed.
