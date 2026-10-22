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
On four cores the walls' labels take about 40 minutes and their photographs about 8, each step
under 1.3 GB of memory; the ceiling, dome and floor's projection takes most of the rest of the
build's two hours. Two runs of the walls give byte-identical labels, orthophotos and atlases. The
walls' 2 mm detail takes about 15 minutes more (2.5 to 5.3 a wall, at most 1.25 GB), and two runs give
byte-identical tiles.

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
| Corners | `fix-corners.py --positions-only` | each wall's corners without the neighbouring walls' fittings: their texels moved back onto the wall (`out-walls/*.fixed.f32`) |
| Labels | `label-views.py` (with `bestview.py`) | `proj/labels-<wall>.npz`: each 40 mm block's station, its ranking of the others, and the depth where its best views agree (recorded, not applied); `labels-<wall>.json`: the counts behind them |
| Walls' photographs | `project-walls.py --labels` | `proj/<view>.fine.npz`: the 2.5 mm orthophoto (sRGB); `proj/<view>.npz`: the 5 mm one (linear, as the blend wrote it); `proj/composite-<wall>.json`: seam steps and colour offsets |
| Ceiling, dome, floor | `project-ceiling.py`, `project-dome.py`, `project-floor.py` | `proj/*.npz`: linear colour and weight per texel; `proj/floor-patches.json`: the stations with a strong tripod patch |
| Windows | `window-relief.py` | the glass mask and a two-layer relief (curtains, then glazing) inside each window |
| Walls | `pack-atlas.py`, `check-atlas.py`, `wall-depth.py`, `relief-mesh.mjs` | `walls-4096.webp`, `walls-2048.webp` (alpha marks glass), `walls-relief.bin`; before publishing, `check-atlas.py` compares the atlas with the one it replaces (sizes, glass only in the window openings, glass area within 2%) |
| Walls at 2 mm | `project-detail.py`, `pack-detail.py` | `proj/detail-<wall>.npy`: each wall's photograph at 2 mm; `detail/<wall>/<column>_<row>.webp` and `detail/index.json`: the tiles the planner streams where it looks closely (below) |
| Ceiling and dome | `pack-overhead.py` | `ceiling-3072.webp`, `ceiling-1536.webp`, `dome-4096.webp`, `dome-2048.webp` |
| Floor | `flatten-floor.py`, `pack-floor.py` | `floor-2560.webp`, `floor-1280.webp` |

`wall-views.py` regenerates `views-walls.json`.

## How a texel gets its colour

Every texel has a world position (the scanned relief's) and a normal. A station sees it when it
stands in front of the surface, its distance cubemap shows nothing nearer along the ray (the
nearest of a 3×3 neighbourhood, so thin occluders are not missed) and the ray misses the five
chandeliers, whose crystal is finer than any depth map. Colours are read from the panoramas
bilinearly and corrected by each station's manifest exposure.

### The walls: the sharpest photograph

The walls take each part's colour from the one panorama that photographed it most sharply, after
Waechter, Moehrle and Goesele's texturing of reconstructions (ECCV 2014). Each wall's 5 mm
orthophoto is cut into 40 mm blocks, and `label-views.py` gives every block one station, its
label:

- **Sharpness.** For each station that saw the whole block: the mean absolute Laplacian of its
  luminance sampled at 2.5 mm, times 2 mm over the size of a panorama pixel on the wall there
  (distance times the pixel's angle, divided by the cosine of incidence). The score is averaged
  over the neighbouring blocks the station saw, since a view's sharpness belongs to a region, not to
  one block's lettering.
- **What is set aside.** An occluder the depth maps missed: a view darker than the block's darker
  views, or of another hue, by more than `project.py`'s tolerance. Glare: a view brighter than the
  median by 2.5 median absolute deviations (at least 15%). Glare is a smooth veil that the Laplacian
  does not see, so a view also pays for each 10% it is brighter than the block's darker quarter of
  views, beyond the first 10%.
- **Labels.** The labels minimise those costs plus a cost for every seam between neighbouring
  blocks (half as much where the relief steps, at a board's or frame's edge, where a seam hides),
  by alpha-expansion (Boykov, Veksler and Zabih) on SciPy's max-flow. A texel the block's station
  did not see takes the next station in the block's ranking that did.
- **Depth, measured and not applied.** For every block with texture, the depth of projection is
  swept from 1 cm behind to 5 cm in front of the scanned relief in 2 mm steps, sampling the block's
  three best stations; the depth where their exposure-normalised luminances agree best (refined by a
  parabola, then smoothed by a membrane) is recorded in `labels-<wall>.npz`. The walls are sampled at
  the scanned relief all the same: with one station per block, the swept offsets bent the deacon
  boards' lettering between blocks (26.6% of names read, against 31.6% at the relief, on the end
  wall alone) and lifted the cornices' lit edges up to 25 mm onto the panelling above, where every
  station looks up from the same angle and depth is barely constrained. The best stations disagree
  by a median 1.6 mm vertically at the relief and 1.7 mm at the swept depth.
  `project-walls.py --depth-offsets` applies them, for measuring.

`project-walls.py --labels` then samples each texel 2 × 2 times (a 2.5 mm orthophoto) from its
station at the scanned relief, and levels the seams in three steps:

1. A colour offset for every station at every block corner, in sRGB levels, solved by least squares
   so that stations meeting at a seam agree there, while each offset changes little within its patch
   (Waechter et al.'s global adjustment). The stations are compared only over flat blocks that both
   saw whole, and the comparisons are re-weighted, so that a few millimetres of parallax or a patch
   of glare does not pull a whole patch. Offsets are bounded to 48 levels. Gains in linear light
   (exposure multiplies light) were tried and dropped: what the seams disagree about is mostly
   glare, which adds light, and on dark varnish it read as a doubled exposure (41% of gains met a
   1.5× bound, and flat seams were left twice as far apart).
2. What still differs along a seam is spread into both sides over three blocks: a membrane with half
   the step at the seam and nothing at the band's edge (Poisson image editing; Pérez, Gangnet and
   Blake 2003). It is solved in strips of 1,024 columns with 96 columns either side, which gives the
   whole wall's solution to within one level and keeps the build under 1.5 GB.
3. The seams are feathered over one block.

`pack-atlas.py` reduces the 2.5 mm orthophoto to the atlas's 5.2 mm in one Lanczos step. Going
through the 5 mm orthophoto first loses most of what the atlas can hold: from one station, the
deacon boards' names read 12.5% that way and 33.6% in one step. With a published atlas
(`build.sh`'s second argument) it keeps that atlas's alpha, the windows' glass, unchanged: the
glazing and its measurements were made against it, and `window-relief.py`'s colour test, run on the
sharper photograph, read 10,830 of its glass texels (a median 28 mm in from the edge) as opaque.

What the rebuild measured against the blend it replaced (S4a, 21 October 2026; method and files in
that day's session log): the end wall's deacon boards read 25.8% of 256 names, trades and years at
the 4096 atlas (2.7% before; two encodings of the same build read 25.8% and 30.1%), and 15-24% in the
planner's own frames at Blake's pose (0-3.5% before). The phone's 2048 atlas still reads none. The
end wall's portrait is sharper (equivalent edge blur 3.6 mm against 4.2 at Blake's distance) and its
dark lower canvas is no longer lifted by glare (10th percentile 33 against 86).

### The walls at 2 mm: the detail tiles

The atlas holds a wall at 5.2 mm a texel (10.3 mm on phones), too coarse for the deacon boards' names
from a couple of metres. `project-detail.py` samples the same labels, stations, colour offsets and
seam membrane at 2 mm instead of 2.5 mm, laid out in the planner's own frame (u along the wall from
its left end, down from 6.72 m), so each detail texel shows what the atlas texel under it shows, only
sharper: reduced to the atlas's 5.2 mm, the detail matches the published atlas to a mean of 2.0-2.9
sRGB levels with no shift (0.0-0.3 mm). The seam corrections live on the 5 mm grid and are
recomputed exactly as `project-walls.py` computes them; pack-atlas.py's patches (the movable
equipment, the end door's leaves) and its fill are repeated at 2 mm. Work goes in chunks of eight
tile columns, so the window wall's accumulator stays near 170 MB.

`pack-detail.py` cuts each wall into tiles of 512 x 512 texels: 496 of their own (0.992 m) inside an
8-texel gutter repeating the neighbouring tiles' texels (or the wall's edge), so the planner's
bilinear filtering and mip levels up to 3 never read past a tile's edge. WebP at quality 86 without
alpha; a tile whose own area is all window glass in the atlas's alpha would be left out (none is at
this pitch: every tile holding glass also holds frame or curtain). 462 tiles, 8.8 MB (the window wall
3.22 MB, the door wall 2.61, the end and fireplace walls 1.48 each); `index.json` gives the grid
(texel, tile, gutter, pitch, origin), each wall's columns and rows, and every tile's bytes and SHA-256,
and the planner refuses an index whose grid is not its own. A tile's gutter differs from the
neighbour's texels it repeats by a median 0.25% of their luminance (p90 1.1%), WebP's own seams. The
read of the boards that S4a's atlas cannot give, the detail gives: 95.7% of the 256 names, trades
and years in the planner at Blake's pose (S4a 20%), 91.8% on a phone 1.9 m away (0%).

Until revision 5 the walls were blended like the ceiling below. At a typical texel of the end wall's
deacon boards six stations were averaged, which disagree there by up to a centimetre at the relief's
depth (doubled lettering), and the averaging took in the varnish's glare (a haze over the
portraits).

### The ceiling, dome and floor: a weighted blend

`project.py` averages every station that sees a texel in linear light, weighted towards head-on and
near views (cos⁴/d³ by default). A second pass down-weights any station that disagrees with the
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

`measure/glazing-bars.py` measures the five windows' glazing for `HALL_GLAZING`: the glass plane from
the relief, each window's glazing bars rectified at 2 mm from four public panoramas and triangulated
(their plane lies within 1.5 cm of the relief's glass), the arched windows' fanlights in polar
coordinates about the transom, and the paint's colour as photographed. It reads `data/` (each
panorama checked against the manifest's hash), the published `walls-4096.webp` and
`walls-relief.bin`, and writes `glazing-bars.json` (the run behind `hall-spec.ts` is kept beside the
script) and the rectified views:

    python3 $SURVEY/measure/glazing-bars.py --data data --atlas walls-4096.webp --relief walls-relief.bin --out analysis/glazing

## Beyond the doors

Each open door in the planner shows a short stub of the space beyond it (`hall-beyond.ts`,
`hall-neighbours.ts`). Three scripts make what it draws; run them in order in a work directory
whose `data/` holds the manifest, the mesh and the panoramas named below (each checked against the
manifest's hash).

| Step | Script | Result |
| --- | --- | --- |
| The first floor | `measure/first-floor.py` | `first-floor-2010.json`: the 2010 FIRST plan's walls (its grey poche paths, read as vectors) and floor, registered to the scan (the hall's inner faces, then trimmed iterated closest points to the mesh's wall sections at 2.6 and 3.2 m; fitted residuals: hall median 4.6 cm, p90 16 cm; Saloon 8.2 / 26.5 cm; stair hall 13.6 / 40.6 cm), with the hall's own bodies and ring cut away (the door wall thinning to 0.46 m from x -6.0, where the scan's corridor face ends); built locally into the survey's gitignored `local/` folder and not published: it is the venue's drawing, and nothing on record lets it be republished (review F2, 22 October 2026). Atelier draws the first floor only where it is built |
| The stubs | `measure/beyond-doors.py` | `measure/beyond-doors.json`: each doorway's floor beyond it within its reach (D1 the Saloon and D2 the landing at the head of Stair 5 from the scan's height map, their levels -4.3 and -4.6 cm; D3 the east end of F.16 and D4 Stair 7's landing from the plan), D2's stairwell, the landing's balustrade (rail top 0.811 m, newels, 13 balusters at 14.5 cm) and the Saloon's panelling on the door wall (its plaster within 2.5 cm of the modelled face); `hall-neighbours.ts` carries its figures |
| The photographs | `project-beyond.py` | `beyond-832.webp`, `beyond-416.webp` and `beyond-atlas.json`: the Saloon's floor (stations 048-050), the landing with its inlaid TRADES HALL (018, 075, 076) and the end and main doors' linings (000, 048, 049; 016-019, 075, 076), projected as `project.py` does with occlusion from CPU depth maps of the mesh; two runs give identical files; published |

    # $PUBLIC: packages/web/public/rooms/grand-hall/survey-2026-07-11 (its local/ folder is gitignored)
    python3 $SURVEY/measure/first-floor.py --plan "FIRST 2010.pdf" --mesh data/mesh --out $PUBLIC/local/first-floor-2010.json
    python3 $SURVEY/measure/beyond-doors.py --mesh data/mesh --first-floor $PUBLIC/local/first-floor-2010.json --out beyond-doors.json
    python3 $SURVEY/project-beyond.py --beyond $SURVEY/measure/beyond-doors.json --out proj

Edited rather than measured here: the Saloon's floor under the open leaf's pocket, which no
station saw, is filled with its herringbone copied six teeth (0.692 m) along the floor from texels
that were seen (`herringbone_fill`); scan_147, on the landing, is read but not used (its pose puts
the inlay 15 cm from where the other three stations agree). D3 and D4 are the plan's alone (the
scan did not reach them), drawn in the corridor's measured colours as art direction.

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
