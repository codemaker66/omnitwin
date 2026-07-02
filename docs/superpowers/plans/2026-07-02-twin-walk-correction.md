# Twin Walk Correction — Street View Parity + Photographic Panoramas

**Status:** ACTIVE — supersedes the walk portions of Phase 1/2 until closed.
**Verdict being corrected (Blake, 2026-07-02):** "horribly broken … meant to be
like traditional Matterport / Google Street View: click to go forward, clean
photographic 360s you can turn the camera around in. The E57 panoramas are
pure lidar (blackened windows). Not usable."

## Root causes (owned)

1. **Wrong pixels.** The 149 panoramas were extracted from the E57 laser
   scan. Scanner imagery ≠ photography: glass/windows go black (no lidar
   return), zenith hole, scanner-composited colour. Matterport's viewer uses
   the separate photographic HDR panoramas their camera captures — those
   never entered our pipeline.
2. **Wrong interaction idiom.** Street View = cursor-following floor reticle,
   click to travel toward where you point, grab-the-world drag. We shipped
   fixed neighbour rings instead.

## Workstream A — photographic panoramas (the real fix)

Matterport stores per-sweep photographic **skybox faces** (6 clean HDR JPEGs
per sweep) for space `TH_T9pXgB4ygNf`. Owner access paths, in order of
preference:

1. **Model API (official):** Blake creates an API token (my.matterport.com →
   Settings → Developer Tools → API Token). The GraphQL Model API
   (`model(id).assets.skyboxes` / `panoLocations`) yields signed URLs for
   every sweep's skybox faces + sweep poses. One fetch script in twin-forge
   (`fetch-matterport-skyboxes.ts`) downloads all 149×6 faces.
2. If the token is not available: the showcase bundle
   (`my.matterport.com/show/?m=T9pXgB4ygNf`) exposes the same tiles to its
   own player; owner-authenticated scraping is a fallback, brittler.

Then the EXISTING forge takes over unchanged in shape:
- New `--skyboxes <dir>` input (Matterport face naming) replacing
  `--cubemaps`; a face-mapping table converts Matterport's skybox order/
  orientation to our tile layout (calibrated once, visually, like
  FACE_TO_CUBE — expect different quarter-turns).
- **Pose reconciliation:** Matterport sweep UUIDs ↔ E57 scan indices. The
  sweep positions from the API are matched to poses.json by nearest-neighbour
  position (the E57 came from the same capture; positions agree to cm).
  Result recorded in the manifest (`capture.sweepId` per node).
- Tiles/LODs/manifest/nav graph identical from there. The viewer needs NO
  rendering changes for this workstream — only a recalibrated FACE_TO_CUBE
  table (keyed by `capture.imagery: "matterport-skybox" | "e57-scanner"`).

**Ask of Blake (the only one): the Matterport API token.** Everything else
is mine.

## Workstream B — Street View interaction parity (no new data needed)

1. **Floor reticle:** a soft disc that follows the cursor along the floor
   plane (raycast at eye-height − 1.35 m), Street-View style — visible while
   the pointer aims somewhere walkable, highlighted when a travel target
   exists.
2. **Click to go forward:** clicking travels to the best next node in the
   pointed direction — argmax over graph neighbours of
   `dot(normalize(neighbour − here), pointDir)` within a 45° cone; fall back
   to the node nearest the pointed ray. The gold rings become subtle
   secondary affordances (Matterport shows sweep discs too — dimmer, smaller,
   ~0.22 opacity), never the primary mechanic.
3. **Drag semantics:** verify grab-the-world (drag right → view turns left),
   matching Street View exactly; fix signs if inverted. Inertia on release
   (velocity handoff into the look spring).
4. **Arrival orientation:** after travel, face the direction of travel
   (Street View behaviour), not the previous yaw.
5. **Double-click** = travel too; **wheel** stays fov zoom (SV parity).
6. Walk stays the default mode; the dollhouse/dive remain but out of the
   primary flow.

## Workstream C — live usability diagnosis (before/with B)

Drive the REAL browser through: drag in all four directions at 3 nodes
(assert the view-direction sign), a click-travel chain of 5 hops, mode
switch round-trip (verify WalkControls still own the camera after returning
from dollhouse — drei `makeDefault` restore is a suspect), mobile touch
drag. Fix everything found; encode the checks in the harness so regressions
cannot ship silently.

## Order of execution

1. C (diagnose) + B (reticle / click-forward / drag / arrival orientation) —
   immediately, on current imagery, so the mechanics are right.
2. A on token receipt — swap pixels, recalibrate faces, re-forge, re-run the
   full calibration battery.
3. Gates: harness captures for reticle/travel; e2e for click-forward and the
   drag sign.

## Non-negotiables carried over

Strict TS, springs, claim-safe copy, explicit-pathspec commits, visual gates
judged by eye before any "done".
