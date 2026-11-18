# Measuring the Saloon (T-662, 18 October 2026)

The scripts that measured `../../saloon.room.json` from the twin, kept as the record of how
each figure was found. They are the first room's exploratory pass, numbered in the order they
were run; a general measuring tool for every room replaces them in the generalisation stage.

Inputs, in a work directory named by `ROOMS_SURVEY_WORK` (default `work`):

- `manifest.json`, `mesh/dollhouse.glb` and `pano512/scan_NNN.webp` from the twin
  (`tools/grand-hall-survey/fetch_inputs.py` fetches the manifest and mesh);
- the decoded mesh as `mesh/positions.f32`, `mesh/indices.u32`, `mesh/chunks.u16`
  (`tools/grand-hall-survey/dump-mesh.mjs`).

Optional inputs, by environment variable: `E57_CUBE_FACES` (the .e57 export's 4096 px
image2D cube faces, for the high-resolution crops), `FIRST_2010_PDF` (the venue's 2010 first
floor plan) and `SALOON_PLAN_PNG` (the venue's Saloon room plan). Outputs go to
`SALOON_MEASURE_OUT` (default `work/saloon-measure`).

Run `01_check.py` to `31_write_measurements.py` in order with `python -X utf8`; `30` writes the
draft config and `31` the measurements file with every fit and residual. The published config
then took five corrections from an independent check by ray casting (18 October): the rear
width (7.10 m between the end sections, 7.01 m at the front), a narrower source for the mirror
patch behind the open lobby door, the two glass planes, the mantel shelf's extent and the
unverified capture date.

`32_glass_split.py` (added after the build's review, 18 October) casts rays into the three bays
to find where the glass changes from the lower plane to the upper one, and how deep each plane
sits. On the mesh the change is at v 3.513 to 3.518 m in all three bays (0 of 260 rows
misassigned), at the transom's top and so at the configured 3.52 m. The "about 3.6 m" noted
earlier is where the mesh's ramp between the planes settles. The upper light's median depth is
0.592 to 0.614 m, against the configured 0.596 m. The build's windows step repeats the split
check on the rendered elevations, and refuses to publish if they disagree (`roombuild/windows.py`).
