# The Grand Hall model

The planner draws the Grand Hall as the room surveyed on 11 July 2026, not as a generic shell:
the walls are the scan's measured relief, and every surface wears the scan's own photographs,
relit for the chosen light. Code: `packages/web/src/components/grand-hall/`. Data:
`packages/web/public/rooms/grand-hall/survey-2026-07-11/`, rebuilt from the public scan by
[`tools/grand-hall-survey`](../../tools/grand-hall-survey/README.md), which also lists every
place the photographs were edited rather than measured.

## Where it runs

`PlannerScene` mounts `GrandHallModel` and `HallLightRig` when `useModelledGrandHall()`: the space
is named "Grand Hall" (the same test as the planner's room variant) and its venue is Trades Hall,
read once per venue; another venue's room of that name gets the generic room. The furniture, its
placement and its saved layouts are the planner's own; furniture nameplates now show only over the
items in hand, in every room (`PlacedFurniture.tsx`). `/dev/grand-hall` (`GrandHallLabPage`,
development builds only) shows the room alone, posed through a window bridge for headless review.

## What it draws

- **Walls** (`hall-walls.ts`, `hall-relief.ts`): `walls-relief.bin`, four height-field meshes
  (35,185 triangles) simplified to within 5 mm of the scan, coloured by the wall atlas projected
  along each wall's normal, as the orthophotos were made. Faces the orthophotos see edge-on (the
  sides of doorcases and boards) take a coarser mip, so a single row of texels never streaks. The
  varnished dado and attic panelling are glossy; plaster and frieze are matte. The main door stood
  open in the scan: its closed mahogany leaves are modelled in the relief's 0.3 m recess. Until
  the relief arrives each wall is a flat photograph; the parser rejects a malformed file.
- **Floor, coffered ceiling and dome** (`hall-geometry.ts`, `hall-ceiling.ts`): the measured
  plane, lattice and dome profile, each with its own photograph; the floor is glossy.
- **Chandeliers** (`hall-chandeliers.ts`): the five fittings as scanned, pale silver-gilt scrollwork
  and acanthus on dark bronze stems with white flame bulbs, drawn to the lowest points, reaches and
  bulb heights measured in the panoramas (`HALL_CHANDELIERS`; method in the 10 October session log).
  The four rose fittings are one template copied into place, so all five draw in three calls
  (gilt, bronze, bulbs) plus one instanced sprite of halos. Shown on a walk and in the room view
  once the camera comes down, never in plan. Without the reflection map the metal's own light is
  raised, so a software rasteriser does not draw it black. In the reflection environment each
  fitting's lamps are a bright sphere of `glowRadius`, the size the moods were set with, not
  the measured reach.

## Light

The photographs already hold the scan's light: daylight through the windows with the chandeliers
and the frieze uplights on. Each vertex carries four baked channels (`hall-lighting-model.ts`:
occlusion, chandelier, daylight, uplight); a mood (`hall-mood.ts`: Daylight, Evening,
Candlelight) relights a texel by the ratio of the mood's light to the scan's light from the same
channels, so Daylight shows the room exactly as photographed. Glass, marked in the atlas's alpha,
follows the daylight alone, falling to dusk blue and then dark. `HallLightRig` adds what a bake
cannot: real lights for the furniture and highlights in varnish and gilt, with a reflection
environment (`HallEnvironment`). The canvas uses Khronos PBR Neutral tone mapping for the
photographed room (`lib/capture-display.ts`), which keeps the photographs' mid-tones.

## Views and loading

`HallViewControls` offers Plan, Room and Walk, the three moods and, where the captured room may be
shown, Capture. `hall-view-store` carries the request; `HallViewDirector` glides the camera through
the planner's existing transition (reduced motion respected; the views wait while a saved viewpoint
holds the camera) and Walk uses `InteriorCamera` with the hall's own arrival point. The cutaway
(`wallCutHeight`) lowers the walls between the camera and the room to the dado rail and, in plan,
cuts every wall at 3.12 m, above the doors. Gaussian splats stay off the public site
(`lib/splat-access.ts`), so production shows only the model; where a capture fails to load, Capture
is disabled and Walk uses the model.

The four photographs and the relief stream in after the first frame. `hall-view-store` counts them
and `RoomResolveCaption` reports "Loading the Grand Hall's surfaces · N of 5" through the shared
`Activity` indicator; if one fails, the room is drawn more simply there (a plain colour for a
photograph, flat walls for the relief) and the caption says planning is unaffected. The files are
fetched at a revision (`HALL_SURVEY_REVISION`), raised whenever they are rebuilt in place.

How much of the finish a device carries is `hall-finish.ts`: phones load the half-size photographs
(0.80 MB instead of 2.79 MB); a software rasteriser, read from the canvas's own WebGL context with
no probe context, also leaves out the reflection map and the chandeliers' lights for a soft fill.

## Checks

- `src/components/grand-hall/__tests__/hall-geometry.test.ts` reads the shipped relief and checks
  it against the room: plaster flat beside the main door, glass deep in every window, the firebox
  behind and the mantel proud of the chimney breast, the door recess, the geometry envelope, and
  rejection of malformed files.
- `src/components/grand-hall/__tests__/hall-chandeliers.test.ts` checks each chandelier's lowest
  point and reach against the survey, its bulbs, that every triangle faces along its normals (the
  metal is single-sided) with none degenerate, that every bulb faces outward, and the triangle
  budget; `mesh-builder.test.ts` covers lathe orientation, pole triangles and translated merges.
- `stores/__tests__/hall-view-store.test.ts`, `lib/__tests__/room-resolve-model.test.ts`,
  `cockpit/__tests__/HallViewControls.test.tsx`, `cockpit/__tests__/RoomResolveCaption.test.tsx`,
  `editor/__tests__/PlannerScene*.test.tsx` and `CameraRig.showcase.test.tsx` cover the views,
  loading caption, capture fallback, device tier and camera glides.
- The rendered room needs browser evidence: `/dev/grand-hall` or the planner itself.

Not yet measured: frame time on the declared devices, and Blake's aesthetic acceptance.
