# Blueprint cleanup — south-gallery

Date: 2026-09-07. Built-in image_gen edit mode; one call for this asset. Original user source preserved. No CLI/API fallback, no app-code or geometry changes, no production-data writes.

## Provenance

- Source: `E:/downloads/blueprints/south gallery.png`
- Source SHA-256: `444C708FC8881BCF97C772029469353FFB4656477E71F1C698EB1950F8C2E1E5`
- Selection: `packages/web/public/room-plans/cleaned/south-gallery.png`
- Output: 1131 × 1391 PNG
- Output SHA-256: `523B5598B96364A7751CDAB7D39D21F7431E6A566445487C1B0E746F785FD841`
- Original generated output retained: `C:/Users/blake/.codex/generated_images/01a07bb3-3749-7b51-9816-2ba69baef8da/exec-43a0c7d0-0af4-4ed7-8ae6-a56ba4328282.png`

## Visual check and limitations

Compared the viewed source and generated output. This is a cleaned reference illustration, not a measured survey, approved event setup, current physical-condition record or safety assessment. Parent release owner handles app integration and rendered-flow checks.

- Removed the long segmented boardroom table and surrounding chairs. Removed the incidental neighbouring-plan fragment clipped at the far-left source edge.
- Preserved the left-bowing curve, its upper/lower doors and swing directions, top opening, three unequal right-side projections and stepped lower corners. No mirror/rotation observed.
- Preserved the source's 11.5m vertical annotation. No width, height, room title, north arrow, extra furniture or new structural connection added.
- Visible differences: background and stroke colours restyled; stroke weight, margin and apparent curve smoothness differ. The output remains a generated drawing with no survey or pixel-registration claim.
- Selected for a clearly labelled cleaned-reference viewer. Retain the original source as the check when a precise outline or opening position matters.

## Exact prompt

```text
Use case: precise-object-edit.
Edit target: E:/downloads/blueprints/south gallery.png, the supplied South Gallery floor-plan illustration.
Remove ONLY the long rectangular boardroom dining table and all chairs surrounding it, leaving an empty room. Preserve every architectural stroke: the exact asymmetrical outline, offsets at both ends, narrow top opening, left-side long curved boundary bulging LEFT, both left-side doors and original swing arcs above/below the curve, three right-side exterior rectangular projections/openings of unequal sizes and the lower right little step. Do not mirror, rotate, regularise or simplify the drawing. Keep precisely the same proportions and orientation as the input.
Preserve the source vertical dimension arrow at the left and the exact text "11.5m". Do not add a width annotation; the source has none. Do not add any other words, room title, north arrow, scale bar, legend, capacity, furniture, ornament, floor texture, shadows or new architecture. Remove the incidental fragment of the neighbouring drawing clipped at the far left edge.
Style only: crisp dark sage-green architectural linework on a flat plain warm ivory background (#faf8f2), restrained line hierarchy, no background texture, no effects. Entire outline and source dimension label visible with modest blank margin; portrait composition. Faithful cleaned reference illustration, not a measured survey.
```
