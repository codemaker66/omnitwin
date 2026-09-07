# T-602 table chair identity and orientation correction

Blake reported that spawning a table produced the old chair geometry and outward
facing seats. The supplied-furniture default change is already in `8059f239`;
the additive orientation fix is `ead48f86`.

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
