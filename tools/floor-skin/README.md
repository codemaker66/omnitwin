# Floor skin (T-639)

A room's floor drawn as what it is: a measured surface wearing its own photographs.
The package sits beside the room's splat tiles and is drawn under the same transform.

Build (inputs are the 28 September 2026 research outputs; nothing here reads F:):

    python tools/floor-skin/build_floor_skin.py --arm A --room grand-hall \
      --floor D:/claude/visual-firstprinciples-20260928/floor \
      --out D:/claude/splats/trades-hall/grand-hall/floor-skin/v1

Contents: `floor-skin.json` (schema `venviewer.floor-skin.v1`), texture tiers
`albedo-{4096|2048|1024}-{0|1}.webp` (two 10.6 m tiles, alpha = measured floor),
`height-5cm.i16` (int16, 0.1 mm relative to the fitted plane, −32768 outside) and
`slab-mask-1024x512.u8` (255 where the splat host hides floor-slab splats).

Arm A re-bakes the Matterport textured OBJ floor; Arm B is the multi-view photo mosaic; Arm C re-projects
the raw 4096 px cube faces after a joint pose solve, and measured sharpest in all six comparison crops of the
28 September study. Arms B and C carry the daylight of the capture (a sun patch and window-light pools along
the window wall); the south third was photographed only in the evening. Use the arm that wins in the browser
comparison (spec §4 I1).

In development `SPLAT_STAGING_ROOT` serves the output. For preview and production,
publish the folder to R2 under `splats/trades-hall/<room>/floor-skin/v1/` before
pushing code that reads it.
