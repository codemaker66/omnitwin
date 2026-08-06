# Reception Room computer-vision result

Date: 14 July 2026

## Bottom line

Yes, computer vision can help here, and it has now been used locally in two practical ways:

1. It compared the existing PLY, SOG, and SPZ renders at the same six camera views.
2. It searched all 138 E57-derived JPEG views from scans 122–144 for images that look like those renders, trying all four quarter-turn rotations.

This work diagnosed package behaviour and produced a useful private search shortlist. It did **not** sharpen the splat, prove a camera pose, or recover missing captured detail.

## What the package comparison established

| Comparison | Result across six views | Safe meaning |
|---|---:|---|
| Valid Mobile SPZ versus invalid parent-plus-child SPZ | 6 warnings | Loading coarse and fine hierarchy levels together causes a clear visual regression. Do not use that package composition. |
| Quality PLY versus valid Quality SOG | 6 with no configured warning | Valid SOG packaging did not trigger the configured loss checks at these views. |
| Mobile PLY versus valid Mobile SOG | 6 with no configured warning | Valid Mobile SOG packaging did not trigger the configured loss checks at these views. |
| Mobile PLY versus valid Mobile SPZ | 6 with no configured warning | Valid Mobile SPZ packaging did not trigger the configured loss checks at these views. |
| Mobile SPZ versus Quality SOG | 6 warnings | The two quality tiers differ materially. This test does not say which one is physically better. |

Safe conclusion: incorrect hierarchy composition is definitely damaging. Valid single-generation SOG/SPZ packaging is a weaker explanation for the room-wide softness seen in these six views. Exact source-versus-runtime loss still needs the Reception model opened safely in LCC.

Package-audit receipt: `E32323EEC6607AF60B5BE765E6CDC06E7FD7BEA64351C0365FD4B10B2AAB20C0`

## E57-derived image shortlist

Read “first image to inspect,” not “confirmed match.” The score is an image-feature similarity value, not a percentage or confidence level.

| Rendered view | First image to inspect | Rotation | Score | Tool assessment |
|---|---|---:|---:|---|
| Overview | `scan_142_left.jpg` | 180° | 0.496626 | Ambiguous shortlist |
| Timber left | `scan_128_left.jpg` | 180° | 0.559164 | Review first |
| Timber right | `scan_125_front.jpg` | 180° | 0.598341 | Review first |
| Floor | `scan_135_up.jpg` | 0° | 0.381244 | Ambiguous shortlist |
| Ceiling moulding | `scan_127_down.jpg` | 0° | 0.562522 | Ambiguous shortlist |
| Column and skirting | `scan_125_front.jpg` | 180° | 0.611235 | Ambiguous shortlist |

Human visual check of the boards:

- **Overview:** useful. The first two results show the cabinet wall, columns, and floor.
- **Timber left:** the strongest result. The first two images directly show the cabinet bank.
- **Timber right:** weak ordering. The third result is more useful than the first two because it actually shows the cabinet-and-column area.
- **Floor:** useful only for coarse floor colour and plank pattern. The leading images contain large blurred or hidden centres and glare, so they cannot supply HD floor texture.
- **Ceiling:** limited. The first result is worth reviewing; the second and third are quarantined, and the third is an obvious whole-image matching failure.
- **Column and skirting:** weak ordering. The third result clearly shows a column and base; the first two mostly match the room’s general colours.

The whole-image model is often attracted to broad grey walls, white ceilings, and wooden floors. A future second pass should search smaller feature crops for cabinets, columns, moulding, and floor separately.

## What this cannot prove

The shortlist does not prove any of the following:

- exact camera position, field of view, scale, or calibration;
- that two images show the same physical viewpoint;
- alignment with the E57 geometry;
- that Quality is better than Mobile;
- loss-free behaviour outside these six same-centre views;
- novel-view stability or spherical-harmonic quality;
- original sensor provenance;
- privacy clearance, commercial rights, or training permission;
- fireplace, chandelier, painting, or table quality.

The separate geometry gate remains `REJECT_GEOMETRY_MISMATCH`. Its 82-of-96 sub-check count must not be described as “mostly passed.” It does not permit pose materialisation, reconstruction, or training.

The six current queries also do not satisfy the original hero-feature success criterion: they omit the fireplace, chandelier, painting, and table, and they share one optical centre.

## Safety and repeatability evidence

- The final private bundle is `e57-visual-retrieval-2026-07-14-v4`.
- The standalone verifier checked all 10 files and all six boards.
- The verifier reported `productionExtractorVerified: true`.
- A clean second run reproduced all 10 files byte for byte.
- Final report receipt: `224ED731E7C03339A486D74B7C547A1A8D28C24E6637823C762F7C24F3E5EF55`.
- Final index receipt: `3CC4C0659EC0C2AFD078776106D08112ACC78928DC5D32BB431A0F62E604119E`.
- Final report-file SHA-256: `BFEB87CCCAABFBE42C1C4BC3DBDF98C19977FC0974E661802A88AD3B11540F04`.
- Retrieval-tool SHA-256: `D9517EC1DCB29E08F6B115409A4CA09E42C6C13579D059D07956B69DEF7DA570`.
- Pinned AlexNet weights SHA-256: `7BE5BE791159472B1FBF3C69796F7CB30DCA7AD8466C2DF70058C37116CDEE02`.
- Focused retrieval tests: 17 run, 16 passed, and one Windows symlink test skipped because the account could not create a symlink.
- Full Reception Room tool suite: 177 run, 175 passed, and two Windows symlink-creation tests skipped for the same permission reason.
- No model or data was downloaded. No venue pixels were uploaded. No raw E57, splat, or LCC project was changed.

Repeatability proves that this computer gives the same shortlist from the same bytes. It does not prove that the shortlist is physically correct.

The bundle is private. Every board says `PRIVATE - DO NOT PUBLISH`; every candidate says `NOT CLEARED`, and quarantined candidates are marked in red.

## The remaining safe LCC blocker

An unsaved LCC editor titled `Temporary...` is already open with another scene. Opening Reception produces a warning that continuing may corrupt the open file.

Blake’s safe next action is:

1. Save or export the existing temporary LCC work if it matters.
2. Close that editor.
3. Reopen the Reception Room project.
4. If the corruption warning still appears, stop and do not click through it.

Computer vision can analyze accessible pixels. It cannot safely create the missing source-LCC screenshots while another unsaved editor is blocking the project.

## Exact next engineering step

After the temporary LCC editor is safely closed, capture matched LCC source views for the fireplace, chandelier, painting, carved timber, and table. Compare those exact views with the full-quality PLY, valid SOG/SPZ, and Venviewer runtime. That is the cheapest decisive test of whether the dominant softness is already present in the reconstruction or is added later.

In parallel, improve the E57 search with feature-sized crops and independent edge/shape checks. Keep that result as a search aid until it passes an actual geometry and camera-model validation.
