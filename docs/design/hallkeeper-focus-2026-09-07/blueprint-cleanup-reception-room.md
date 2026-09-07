# Reception Room blueprint cleanup

Date: 2026-09-07

## Provenance and scope

- Source supplied by Blake: `E:/downloads/blueprints/reception room.png`.
- Source SHA-256: `4C625F9BBEC689127FC113E6366E674FF23EFD6DE236F86D84EBB5000788422A`.
- Original preserved at `packages/web/public/room-plans/originals/reception-room.png`.
- Selected built-in image_gen output: `C:/Users/blake/.codex/generated_images/01a07d45-dac4-7772-8f36-8e3491b42339/exec-a1fcc596-2663-409f-815d-ca506e80f968.png`.
- Project asset: `packages/web/public/room-plans/cleaned/reception-room.png` (1088 × 1446 pixels).
- Method: built-in image_gen edit; no CLI or programmatic raster editing. Original files were not overwritten.

This is a cleaned **reference drawing**, not surveyed geometry, an approved event layout, or a scale-calibrated placement canvas. Keep it distinct from live saved furniture geometry. Dimension text is transcribed from the supplied image, not independently verified. Image generation resamples strokes and margins; do not infer new measurements or capacities from pixels. Warm ivory and dark sage match the hallkeeper design direction. Visual QA checks structure against the source but does not establish geometric accuracy.

## Visual QA

Removed the two blocks of seating in the upper portion. Kept both connected portions as one Reception Room. Visually checked four upper panes, upper-right notch, partition and left door swing, lower right rectangular recesses, and all three dimension annotations. The prompt mistakenly named seven diagonal partition ticks; source and selected output visibly contain six, matching one another. Paired wall strokes and font smoothing are stylistic derivatives; no intentional topology change was accepted.

## Prompt

```text
Use case: precise-object-edit. Edit target: supplied Reception Room blueprint, a single room plan with two connected portions. Clean the exact drawing by removing ONLY the two blocks of individual chairs in the upper portion. Preserve ALL architectural lines exactly: the wide upper portion, top bank of four rectangular panes/openings and their dividers, left wall step near top, right upper-wall notch, the horizontal partition at mid-height WITH all its seven diagonal ticks and the left single door and swing arc, the lower connected room portion with its right-hand rectangular recesses, and all wall positions. DO NOT separate the upper and lower portions or combine/simplify the outline. Keep portrait source orientation and proportions. Preserve dimension arrows and exact text '9.6m', '12m', '7.3m' in original positions. Change black background to completely plain warm ivory (#FAF8F2), gold linework to dark sage (#536350), crisp consistent restrained architectural strokes. No shadows, texture, gradients, perspective, decoration, title or any new label/dimension/symbol. Preserve openings, door arcs, recesses and unknown details faithfully. This is an edited source reference, not a surveyed geometry or a redesign.
```
