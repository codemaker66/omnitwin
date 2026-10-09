# Grand Hall survey

The Grand Hall in the planner is drawn as surveyed: its walls are the scan's measured relief, and
the walls, floor, ceiling and dome wear the scan's own panoramas, projected onto the measured
surfaces. These scripts make those files from the public scan alone. The web reads them from
`packages/web/public/rooms/grand-hall/survey-2026-07-11/` (`hall-photos.ts`, `hall-relief.ts`).

## Sources

Everything comes from the Trades Hall twin, `https://twin.venviewer.com/trades-hall`, the
Matterport E57 capture of 11 July 2026 of the empty hall:

- `manifest.json`: each station's pose in the E57 frame (Z up, metres), its exposure (gain and
  white balance) and the SHA-256 of every published file.
- the reviewed dollhouse mesh named by the manifest, in the same frame: the geometry used for
  occlusion, for every surface's position and for the walls' relief.
- `tiles/scan_NNN/equirect_8192.webp`: each station's world-aligned 8K panorama. The Grand Hall is
  stations 0–48.

No photograph of a furnished room and no generated image is used. The 2010 blueprint
(`SECOND 2010.pdf`) was not available to the build that made these files; every dimension in
`packages/web/src/components/grand-hall/hall-spec.ts` was measured from the mesh (`measure/`).

Frames: planner `x = 8.795 − X`, `y = Z − 0.045`, `z = Y + 4.963` from E57 `(X, Y, Z)`. The
planner's origin is the centre of the hall's floor, and the floor is at E57 Z = 0.045.

## Build

Requirements: Python 3 with numpy and Pillow (with WebP); Node 22 with the workspace installed
(`pnpm install`; the scripts borrow three, three-mesh-bvh, meshoptimizer, glTF-Transform and
Playwright from `packages/web` and `packages/reconstruction-foundry`); Chromium for the headless
measuring page (Playwright's own, or set `CHROMIUM_PATH`). The work directory needs about 3 GB.
On four cores the whole build takes about two hours, almost all of it projection.

    bash tools/grand-hall-survey/build.sh <work-dir> packages/web/public/rooms/grand-hall/survey-2026-07-11

Without the second argument nothing outside the work directory is written. After publishing,
raise `HALL_SURVEY_REVISION` in `packages/web/src/components/grand-hall/hall-photos.ts`: the folder
is cached by browsers for up to a week, and the revision is what tells them the files changed. Every script runs in
the work directory; `build.sh` shows each command (`$SURVEY` in the scripts' usage lines is this
folder). Inputs and depth maps already in the work directory are kept, so a rerun after changing a
later step skips the downloads.

| Step | Scripts | Result |
| --- | --- | --- |
| Inputs | `fetch_inputs.py`, `dump-mesh.mjs` | `data/`: manifest, mesh, 49 panoramas, each checked against the manifest's hash; the mesh as world-space arrays |
| Occlusion | `render-depth.mjs` | `data/depth1024/`: each station's distance cubemap (six 1024² faces) rendered from the mesh |
| Surfaces | `render.mjs` with `views-walls.json`, `views-ceiling.json` | `out-walls/`: the world position of every texel of each wall's elevation (200 px/m, seen from 1.2 m inside the room) and of the ceiling (150 px/m) |
| Projection | `project-walls.py`, `project-ceiling.py`, `project-dome.py`, `project-floor.py` | `proj/*.npz`: linear colour and weight per texel; `proj/floor-patches.json`: the stations with a strong tripod patch |
| Windows | `window-relief.py` | the glass mask and a two-layer relief (curtains, then glazing) inside each window |
| Corners | `fix-corners.py` | each wall's corners without the neighbouring walls' fittings |
| Walls | `pack-atlas.py`, `wall-depth.py`, `relief-mesh.mjs` | `walls-4096.webp`, `walls-2048.webp` (alpha marks glass), `walls-relief.bin` |
| Ceiling and dome | `pack-overhead.py` | `ceiling-3072.webp`, `ceiling-1536.webp`, `dome-4096.webp`, `dome-2048.webp` |
| Floor | `flatten-floor.py`, `pack-floor.py` | `floor-2560.webp`, `floor-1280.webp` |

`wall-views.py` regenerates `views-walls.json`.

## How a texel gets its colour

`project.py` gives every texel a world position and normal. Each station in front of the surface
contributes when its distance cubemap shows nothing nearer along the ray (the nearest of a 3×3
neighbourhood, so thin occluders are not missed) and the ray misses the five chandeliers, whose
crystal is finer than any depth map. Colours are read from the panoramas bilinearly, corrected by
each station's manifest exposure and averaged in linear light, weighted towards head-on and near
views (cos⁴/d³ by default). A second pass down-weights any station that disagrees with the
consensus, an occluder the depth maps missed. On the floor, each panorama's view near its nadir
counts only where it holds real detail: the patch that hides the tripod is smooth where real
boards are not, and covers anything from nothing to 30 degrees around straight down. Some
patches are a smooth band around boards that look real but were filled in too, so a strong
patch discards everything inside its outer edge. Views brighter than the consensus (reflections
on the polished boards) are down-weighted.

The dome is unrolled by angle and arc length along its measured profile; each texel is first moved
along its normal onto the scanned surface (`surface-offset.mjs`), so the coats of arms that stand
proud of the profile are coloured where they are.

## What is edited rather than measured

- Movable equipment (speakers, a lectern, an equipment rack) is replaced by panelling copied or
  mirrored from the same wall, in both the photographs and the relief (`PATCHES` in
  `pack-atlas.py` and `wall-depth.py`).
- Two doors stood open during the scan. The end door takes the photograph and relief of the
  fireplace-end door's closed leaves; the main door becomes a plain 0.3 m recess, and
  `hall-walls.ts` models its closed mahogany leaves.
- The end arch's glazing was not reconstructed (the mesh closes it with a plane); it takes the
  glass depth of its twin at the fireplace end.
- The floor's soft reflection blotches (0.35–2.5 m across) are divided out and broad window glare
  is rolled off; board-scale detail and the room's broad fall of light are kept. Beneath some
  stations the floor is refilled with the same boards 1.8 m along the hall, towards its middle
  (the boards run lengthwise): the four that stood in a window bay or doorway, where no neighbour
  sees the floor well, and those with a strong tripod patch (`floor-patches.json`), where only
  the neighbours' oblique, softer views remained, out to where the station's own view counts
  again (0.4–0.9 m).
- In the relief, where a neighbouring wall's bench seen end-on in a corner stands out to the depth
  limit, the wall keeps its own face (`wall-depth.py`); what is left of the bench lies inside the
  one its own wall draws.
- Texels no station saw (behind the chandeliers' stems) are filled from their neighbours.

## Accuracy

The relief is meshed from 100 px/m depth maps and simplified to within 5 mm
(`meshoptimizer`, absolute error); positions are quantised to 16 bits over each wall's range
(0.3 mm along the hall). The walls' photographs are about 193 px/m in the 4096 atlas, the floor's
121 px/m and the ceiling's 145 px/m. They cannot be more accurate than the capture: the mesh is
Matterport's, and the colours are the panoramas' as photographed on the day (daylight through the
windows, with the chandeliers and the frieze uplights on).

## Measurements

`measure/` holds the passes that established the hall's dimensions in `hall-spec.ts`: its
orientation and wall planes, the elevation bands, the openings, the ceiling lattice, the dome's
profile and the chandeliers' positions. They print their figures. Run them in a work directory
the build has filled (they read `data/`), after `mkdir analysis` and

    node $SURVEY/render.mjs $SURVEY/views-elev.json out

(`views-plan.json` draws the whole building from above, for orientation.)
