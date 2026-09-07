# Saloon blueprint cleanup

Date: 2026-09-07

## Provenance and scope

- Source supplied by Blake: `E:/downloads/blueprints/saloon.png`.
- Source SHA-256: `9AA1D639377D68D91C2C7CFE43E252645901168B6DC9DBDF65BEBD8ABC284E19`.
- Original preserved at `packages/web/public/room-plans/originals/saloon.png`.
- Selected built-in image_gen output: `C:/Users/blake/.codex/generated_images/01a07d45-dac4-7772-8f36-8e3491b42339/exec-9906832c-183e-4c9a-9a93-0dc8eff75c22.png`.
- Project asset: `packages/web/public/room-plans/cleaned/saloon.png` (1133 × 1388 pixels).
- Method: built-in image_gen edit; no CLI or programmatic raster editing. Original files were not overwritten.

This is a cleaned **reference drawing**, not surveyed geometry, an approved event layout, or a scale-calibrated placement canvas. Keep it distinct from live saved furniture geometry. Dimension text is transcribed from the supplied image, not independently verified. Image generation resamples strokes and margins; do not infer new measurements or capacities from pixels. Warm ivory and dark sage match the hallkeeper design direction. Visual QA checks structure against the source but does not establish geometric accuracy.

## Visual QA

Removed six table-and-chair clusters. Visually checked the left wall steps/central projection, three right-side angled wall sections, upper-right doorway, lower-right doorway/alcove, both bottom doors, and both dimension labels. Two initial generations incorrectly closed the top boundary; both were rejected. The selected third result removes that invented horizontal line and retains the open upper boundary shown in the supplied raster. Output margin/canvas proportions differ from the source; inner room proportions were visually checked only. Paired wall strokes and font smoothing are stylistic derivatives.

## Prompt

```text
Use case: precise-object-edit. Edit target: supplied Saloon blueprint. Clean this exact room drawing for a hallkeeper reference. Remove ONLY all six round dining tables and the chairs clustered around them. Preserve every architectural outline exactly: left wall steps and narrow central outward notch, all angular right wall recesses, the top-right door opening and swing arc, lower-right small door/alcove and swing arc, both door openings and arcs on the bottom edge, and every opening at the top. Keep original tall portrait framing, orientation, relative proportions and all source dimension arrows. Preserve exact dimension text '11.9m' and '6.9m' at their source positions. Change black background to plain warm ivory (#FAF8F2), retained linework and text to crisp restrained dark sage (#536350). No shadows, texture, perspective, gradients or decoration. Do not smooth, straighten, symmetrise, invent or erase any wall segment, doorway, recess, opening or swing arc. Add no title, labels, dimensions, symbols or furniture. Faithful source cleanup only, not a redesign or surveyed geometry.
```

## Rejected retry and targeted correction

The first (`exec-db7f0a5b-6f4f-471f-9abb-37bec3fd1656.png`) and second (`exec-33b03af8-66ed-4153-8315-1a72bbf53c82.png`) variants were not copied into the project's usable asset directory. Both remain in the generated_images provenance directory. The first variant was the edit target for the final narrow correction.

```text
Use case: precise-object-edit. Edit target: supplied Saloon blueprint. Faithful cleanup, keep precisely its line topology. Remove ONLY the six round dining tables and every chair around them. Recolour the black field to completely plain warm ivory (#FAF8F2) and white retained strokes/text to restrained dark sage (#536350). IMPORTANT: The top of the original drawing is OPEN — there is NO horizontal wall line across the top connecting the left and right edges. Preserve that open top exactly. Do not invent a horizontal top wall or close any opening. Keep every left wall step, left central small outward notch, each angular right wall recess, the upper right doorway and its arc, lower right door/alcove and arc, both bottom door openings and swing arcs. Preserve dimension arrows and text '11.9m' and '6.9m' at original positions. Keep portrait framing/orientation/proportions. Do not smooth, straighten, symmetrise, invent or erase any retained architectural segment, door, window, opening or recess. Add no text or features. No texture, shadows, gradients, perspectives or decorations. This is a cleaned source reference drawing, not surveyed geometry.
```

```text
Make ONE surgical correction to this diagram. Erase the long horizontal DOUBLE LINE across the very top, the two parallel strokes running between the top ends of the left and right walls at approximately x=265 to x=944 and y=58 to y=70 in this 1120x1404 drawing. Replace those two horizontal strokes with the same ivory background so the drawing is OPEN along its entire top edge. Preserve the short vertical top ends at left and right. Do not draw anything in their place. Do not reconnect the left and right walls. Keep ALL other pixels, wall outlines, dimensions, door arcs, proportions and styling unchanged. This corrects a spurious line. The original room reference has no line across that upper edge.
```
