# Blueprint cleanup — robert-adam-room

Date: 2026-09-07. Built-in image_gen edit mode; one call for this asset. Original user source preserved. No CLI/API fallback, no app-code or geometry changes, no production-data writes.

## Provenance

- Source: `E:/downloads/blueprints/robert adam.png`
- Source SHA-256: `EEC9A44415D8C842392E664419DF2088F132FD80B5CB5108F797BE65845F63F3`
- Selection: `packages/web/public/room-plans/cleaned/robert-adam-room.png`
- Output: 1254 × 1254 PNG
- Output SHA-256: `981040FAC6156894DBDDF3AA16463DAEFE10583AB5A6FB8A4A22D5D81D4DC7F5`
- Original generated output retained: `C:/Users/blake/.codex/generated_images/01a07bb3-3749-7b51-9816-2ba69baef8da/exec-62e49fd4-0080-4530-875b-f4a10acce52b.png`

## Visual check and limitations

Compared the viewed source and generated output. This is a cleaned reference illustration, not a measured survey, approved event setup, current physical-condition record or safety assessment. Parent release owner handles app integration and rendered-flow checks.

- Removed only the theatre chair rows from the broad page-top section.
- Both connected sections remain in one image with their source relationship: the narrower page-bottom section is offset right, connected through the short run of steps.
- Preserved two plain circles and the broken zigzag line as unclassified source symbols, without claiming their function. Preserved the curved lower-left boundary and double door, top-wall opening details and projections, other recesses and bottom door swings.
- Source labels 11.4m, 7.4m, 10m and 5.6m remain. These have not been replaced with different currently published values.
- Visible differences: stroke/background palette and small line-weight/spacing changes; the curved lower-left boundary has double linework. No section removed, mirrored or newly connected. No new label, north arrow or extra furniture observed.
- Source illustration sections do not establish a single uniform pixel-to-metre scale. Do not calibrate furniture against the complete image.
- The current official room page describes two sections within Robert Adam, with figures differing from this image. Keep the supplied annotations as source history rather than silently reconciling them: https://www.tradeshallglasgow.co.uk/rooms/ . Do not interpret top/bottom on the page as the venue's upper/lower level names.

## Exact prompt

```text
Use case: precise-object-edit.
Edit target: E:/downloads/blueprints/robert adam.png. This is ONE room with TWO CONNECTED SECTIONS, both of which must remain completely visible in one cleaned reference image.
Remove ONLY the rows of loose theatre chairs from the broad section at the TOP of the source image. Do not remove anything else. The two unlabelled plain circles in the LOWER part are protected architectural-looking symbols, not chairs or tables: preserve both circles in their exact original positions and sizes. Preserve the zigzag line across the upper part of that lower section, the curved left boundary and its double door, the short line beside that double door, and all lower door recesses/swings.
Preserve every architectural line, projection, recess, wall break and door swing in the source. Retain the broad page-top section, the narrower page-bottom section positioned to the RIGHT of the top section's left edge, the stepped connection between sections, both top-wall projecting rectangles and the top window/opening details, the top section's far-left double doors, and the lower section's right-side rectangular recess. Do not merge the sections into a flat rectangle; do not crop either section. Keep the exact layout, relative proportions and orientation of the illustration. The names Upper/Lower are not printed in the source and must not be added.
Preserve every dimension label and its dimension line exactly as drawn: "11.4m" across top, "7.4m" at upper right, "10m" vertically beside lower section, "5.6m" along bottom. Do not recalculate or replace these numbers. Do not add words, room title, north arrow, scale bar, legend, capacity, furniture, ornament, floor texture, shadows or new architecture.
Style only: crisp dark sage-green architectural linework on a flat plain warm ivory background (#faf8f2), restrained consistent line hierarchy. Preserve the source's entire roughly square composition with a modest blank margin. This is a cleaned reference illustration, not calibrated survey geometry; trace the supplied architectural details faithfully and do not infer improvements.
```
