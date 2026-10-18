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

## City context and window skylines

The city drawn around the hall, and the sky each window sees, come from one public source: the
Scottish LiDAR Phase 5 50 cm digital surface model (DSM). No OpenStreetMap data and no photograph
is used. Two outputs are published:

- `packages/web/public/rooms/grand-hall/context-2020-lidar/merchant-city-v2.bin` and `.json`: an
  architect's contour model of the Merchant City within 260 m of the hall, the DSM cut into 3 m
  terraces of flat caps and vertical walls. `hall-context.ts` loads the `.bin` and `HallContext.tsx`
  draws it. The `.json` records the frame, the encoding, every parameter and the counts. The
  binary is VVCX v1: a 16-byte header (`VVCX`, then uint32 version 1, vertex count and index
  count, little-endian), int16 x, y, z per vertex in centimetres, then uint32 triangle indices,
  caps before walls.
- `packages/web/src/components/grand-hall/hall-skyline.ts`: for each of the five openings in the
  window wall, the skyline above its centre (the highest angle of the roofs) at every degree of
  true azimuth from 11° to 191°. `hall-sun-times.ts` lets direct sun in at a window only above
  that window's skyline.

### Source

The Scottish Government publishes the Phase 5 LiDAR, flown by Fugro in 2020, on the Scottish
Remote Sensing Portal (`https://remotesensingdata.gov.scot`). The files are in the public bucket
`srsp-open-data`. The DSM comes as 5 km GeoTIFF tiles on the British National Grid (EPSG:27700):
float32 metres above ODN, 0.5 m cells, pixel-is-area, nodata −9999. The hall (HES listing
LB32713, NGR NS 59329 65183) is 671 m from the east edge and 183 m from the south edge of NS56NE,
so a 3 km square centred on it needs four tiles, each at
`https://srsp-open-data.s3-eu-west-2.amazonaws.com/lidar/phase-5/dsm/27700/gridded/<tile>_50CM_DSM_PHASE5.tif`:

| Tile | Bytes | SHA-256 |
| --- | --- | --- |
| NS56NE | 417 259 095 | `19b4472c5cd390c841a85532e16e757542cdecc631331bd0e71d209f61527a3e` |
| NS56SE | 409 688 376 | `a8d697f352e12e26367e31312be2e7bb1bdd7c86b71b1257aa25900c0fc43541` |
| NS66NW | 419 800 871 | `da06c7237795693cc56e056c2e83e76d2fce405f33cd090b08f6d76e5de99777` |
| NS66SW | 405 615 130 | `10115dd97929fdd3a4245b33217639fd4047be07be73f3b9d76fc0bb685814ee` |

The tiles were downloaded on 23 September 2026. The bucket gives all four a Last-Modified date of
6 July 2022. The data is under the Open Government Licence v3.0, and every use carries the
attribution "Contains LiDAR data: Crown copyright Scottish Government and Fugro (2020), OGL v3.0".

`context/fetch_dsm.py` downloads any missing tile and checks each one's size and hash. It then cuts
the 3 km square centred on E 259329 N 665183 (E 257829–260829, N 663683–666683) at the tiles' own
0.5 m cells. The square's edges fall on cell edges, so nothing is resampled. The four tiles have
no nodata cells inside the square; the script would fill any by Telea inpainting. Heights are stored relative to 10.7 m ODN,
the Phase 5 DTM at the hall's street level. The result, `heights_50cm.f32`, is 6000 × 6000
little-endian float32, row 0 = south, column 0 = west, with cell centres at −1500 + (i + 0.5) × 0.5 m
from the origin. `meta.json` beside it records the origin, datum, size and tile URLs.

### Frame

The model is in the planner's frame: metres, y up, origin at the centre of the hall's floor. These
facts are copied from the `frame` block of `merchant-city-v2.json`:

- The origin is at local (E 3.0, N 8.0) m from E 259329 N 665183, where the dome's crown peaks in
  the DSM. The frame takes the dome as standing over the centre of the hall, which `hall-spec.ts`
  places at the planner's origin.
- −z, the window wall's outward normal, points to grid bearing 102.96°. That figure comes from a
  fit of the Glassford Street front to the same DSM: the front runs at grid bearing 12.96°, fitted
  range 12.46–13.44°. True bearing = grid − 1.861°, the meridian convergence at the site, so the
  window wall faces 101.1° true and +x points to 191.1° true. In (E, N), +x = (−0.22427, −0.97453)
  and +z = (−0.97453, 0.22427).
- Heights: y = (DSM + 0.30) − 3.79 = ODN − 14.19. The pavement is at 10.40 m ODN (y = −3.79) and the
  hall's floor at 14.19 m ODN (y = 0).

The skyline uses the same mapping (`skyline/skyline.py`). Rays leave the outer face of the window
wall (planner z = −5.915) at each opening's centre, half way up. They run out to 600 m with the
earth's curvature, in 0.5° steps of true azimuth. The opening sizes are read from `hall-spec.ts`.
The DSM carries the hall's own cornice just outboard of the wall, so samples less than 1.25 m in
front of the facade plane are ignored, but only along the hall's own frontage: facade u from
−15.305 to +15.304 m, the two ends of the wall-face line (30.6 m apart, the adopted frontage width).
Beyond them the neighbours' fronts count, so a ray grazing along the street meets the taller
buildings on either side. The plane, the frontage's ends and the 102.96° bearing are constants of the
facade fit (the promo-film pipeline's `spec/facade/facade.json`: `frames.facade` and
`frontage.line_wall_face_local`), copied into the code rather than read at run time. Every ray now
leaves the zone, so every degree from 11° to 191° is measured. If one ever did not, `hall-skyline.ts`
would give it the nearest measured half-degree sample and its header would name the azimuths.

Until 17 October 2026 the zone ran the whole length of the street, so the neighbours' fronts were
ignored too. Bounding it raised the skyline only at the grazing ends, within 21° of the wall's
plane (11°–32° and 177°–191°), by up to 66°. The only change inside a window's reveal limit is at the
end arch, at 177°–178° (+13° and +42°). With the planner's own `hall-sun-times.ts`, run over every
day of 2026, sun on the floor changes on 45 days, all between 23 November and 14 January. On 25 of
them the 2–6 minute slot just before noon GMT, when only the end arch let sun in, is gone; on the
other 20 it starts 1–4 minutes later. The rest of the year is unchanged.

### Build

Requirements: Python 3 with numpy, scipy, scikit-image and shapely 2.1 or later. Fetching also
needs tifffile and opencv-python, the checks need Pillow and the plot needs matplotlib. The tiles
take 1.65 GB and the grid 144 MB. Building the model takes about 15 s and the skylines about
7 s.

    python3 tools/grand-hall-survey/context/fetch_dsm.py <work>/lidar <work>/dsm
    python3 tools/grand-hall-survey/context/build_context.py <work>/dsm <work>/context --date 2026-10-16
    python3 tools/grand-hall-survey/skyline/final.py <work>/dsm <work>/skyline

`build_context.py` writes `merchant-city-v2.bin` and `.json` (the published pair) and
`merchant-city-v2.build.json`. The last is the build's own report: the 15 suppressed trees, the repair
counts, the inputs' hashes and the library versions. `--date` sets the JSON's `generated` field,
the only one that would otherwise change from run to run. Without it, the date comes from
`SOURCE_DATE_EPOCH`, else today; pass the published date to reproduce the published file. `--keep-work`
also writes `_work.npz` for the checks. `final.py` writes `hall-skyline.ts` and `window-skylines.json`.
The JSON is the record behind the module: every 3 × 3 profile, the method, and the times direct sun
clears each window on 20 March, 21 June and 21 December 2026. Pass `--ts
packages/web/src/components/grand-hall/hall-skyline.ts` to write the module in place; `--plot` draws
`window-skylines.png`. A change to the window openings in `hall-spec.ts` changes the skylines, so
rerun `final.py` after one.

To publish a changed model, copy the pair into `packages/web/public/rooms/grand-hall/context-2020-lidar/`
and raise the `?r=` revision in `CONTEXT_MODEL_URL` (`hall-context.ts`), for the same reason as
`HALL_SURVEY_REVISION` above.

Diagnostics, not part of the build: `context/probe.py <dsm>` shows that in the grid's documented
orientation the dome's crown (24.19 m) is the local maximum at (3.0, 8.0), and that flipped or
transposed it is not; it also prints the terrain's spread within 260 m. `skyline/skyline.py <dsm>` prints each window's centre
profile. `context/check_render.py <build-dir> <dsm>` checks the mesh and renders it. On the published
model it finds all 27 216 caps facing up, no zero-area triangles, no cracks, open edges only on the
rim (454) and the site cut (5), and 2 edges shared by more than two triangles.

### Verification

On 16 October 2026 the whole chain was rebuilt from the four tiles in a clean directory. Every
file matched the copy then published, byte for byte. On 17 October the JSON's wording (the model's
file name, the crop, the generator) and the skyline's mask were corrected, and both files were
regenerated and published. The current published files are:

| Output | SHA-256 | Result |
| --- | --- | --- |
| `heights_50cm.f32` | `45c2977086bec5705cf177a6969472826bf0db328e5a2f9d4bf04853b5b4a5e4` | identical to the grid the published model was built from |
| `merchant-city-v2.bin` | `5cdb593af128e7a2537e5a0488ecd326ff5ff116e517534abda4278650a3f59e` | unchanged since the first rebuild, identical in every build since |
| `merchant-city-v2.json` | `a1b9444967bd4c3fb10237c81e6d980ed556ac0619d71a70b509b77e0d4cceb4` | rebuilt with `--date 2026-10-16` |
| `hall-skyline.ts` | `dda0ff9d8bcbe45db72a1b3e226c65bfe599cc24b917884b0c1e31ac9dcbe1dd` | rebuilt with the frontage-bounded mask |

The module's values are the 0.5° centre profiles rounded to 0.1°: the largest difference from the
unrounded profile is 0.05°. Each build ran twice, with identical results; the 16 October build also
ran once with `SOURCE_DATE_EPOCH` instead of `--date`. The libraries were Python 3.13.6, numpy 2.4.2,
scipy 1.17.0, scikit-image 0.26.0, shapely 2.1.2, tifffile 2026.8.23 and OpenCV 5.0.0. The JSON's
`bytes_gzip` is the length of a zlib level-9 stream and may differ by a few bytes under another zlib
(1.3.1 here). The web's `hall-sun-times` and `hall-sky` tests pass with the new module.
