# Grand Hall blueprint cleanup

Date: 2026-09-07

## Provenance and scope

- Source supplied by Blake: `E:/downloads/blueprints/grand hall.png`.
- Source SHA-256: `532C8BC1F3A18A81AAC246234AE401FACD3E4D33645393D5D58DFBA9BD752AAD`.
- Original preserved at `packages/web/public/room-plans/originals/grand-hall.png`.
- Selected built-in image_gen output: `C:/Users/blake/.codex/generated_images/01a07d45-dac4-7772-8f36-8e3491b42339/exec-7bb6c5e4-ed27-4bcf-9a46-194e2b9da647.png`.
- Project asset: `packages/web/public/room-plans/cleaned/grand-hall.png` (1551 × 1014 pixels).
- Method: built-in image_gen edit; no CLI or programmatic raster editing. Original files were not overwritten.

This is a cleaned **reference drawing**, not surveyed geometry, an approved event layout, or a scale-calibrated placement canvas. Keep it distinct from live saved furniture geometry. Dimension text is transcribed from the supplied image, not independently verified. Image generation resamples strokes and margins; do not infer new measurements or capacities from pixels. Warm ivory and dark sage match the hallkeeper design direction. Visual QA checks structure against the source but does not establish geometric accuracy.

## Visual QA

Removed fourteen table-and-chair clusters. Visually checked the three top double doors, right-hand door, lower windows/recesses, balcony outline, both dimension arrows and labels. Preserved the unlabelled bottom-centre rectangle because its purpose is uncertain. The drawing uses paired wall strokes and a cleaner font instead of the source raster's single bright outline. Those are rendering changes; no intentional topology change was accepted.

## Prompt

```text
Use case: precise-object-edit. Edit target: the supplied Grand Hall blueprint image. Create a cleaned reference drawing for a venue room plan, with the exact source framing, orientation and proportions. Remove ONLY the 14 obvious round dining table clusters and their individual chairs inside the room. Preserve every architectural line, all wall segments, three double door openings and swing arcs on the top edge, the right-side doorway and arcs, lower windows/recesses, the projecting balcony, and the lone unlabelled horizontal rectangle at bottom centre inside the hall (do not remove that rectangle). Preserve the exact positions and shapes. Preserve dimension arrows and the exact text '10.5m', '21m', 'Balcony' at their original positions; add no other text. Change black field to plain warm ivory (#FAF8F2) and all retained white linework/text to crisp dark sage (#536350); use same restrained line weight. No shadows, gradients, paper texture, symbols, new doors, labels, furniture or decorations. This is faithful source cleanup, not redesign or a surveyed plan. Do not crop source elements.
```
