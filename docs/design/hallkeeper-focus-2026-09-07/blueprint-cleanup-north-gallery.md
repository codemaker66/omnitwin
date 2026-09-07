# Blueprint cleanup — north-gallery

Date: 2026-09-07. Built-in image_gen edit mode; initial edit plus one targeted correction. Both candidates rejected. Original user source preserved. No CLI/API fallback, no app-code or geometry changes, no production-data writes.

## Provenance

- Source: `E:/downloads/blueprints/north gallary.png`
- Source SHA-256: `3A0777EEE2FDDA048C30EA7E2995E2EAAC29AFC9314FB437C038D526701CE7EA`
- No selected public derivative. The initial public copy was removed after review rejected its proportion drift.
- Rejected first candidate: `docs/design/hallkeeper-focus-2026-09-07/rejected-assets/north-gallery-v1-rejected.png`
- Output: 1019 × 1543 PNG
- Output SHA-256: `69A9073F7E49D6BC42BD609C1E007CC87077B27A12CDB1176A1F079B28456662`
- Original generated output retained: `C:/Users/blake/.codex/generated_images/01a07bb3-3749-7b51-9816-2ba69baef8da/exec-241d55a4-8a53-4baa-8311-5dbbade1656b.png`

## Visual check and limitations

Compared the viewed source and generated output. This is a cleaned reference illustration, not a measured survey, approved event setup, current physical-condition record or safety assessment. Parent release owner handles app integration and rendered-flow checks.

- Isolated the left room only. The separate South source matches the paired image's right-hand room; this is the basis for the North selection, not a geographical orientation inference.
- Removed theatre chairs. Preserved the curve bowing right, two flanking doors and swing arcs, unequal outer-wall projections, top opening and stepped lower outline. No new furniture, room title, north arrow or scale bar.
- Source labels 11.5m and 4m remain; vertical annotation moved alongside the isolated room.
- Visible differences: generated double-line wall strokes replace the source's single interior boundary against thick black wall mass; exterior openings read as outlined rectangular projections. The isolated output appears slightly taller/slimmer than the source room. No pixel-registered or measured equivalence is claimed. Door positions and handedness remain recognisable.
- REJECTED: a reference-art label does not excuse changed room proportions. Do not integrate this image.

## Targeted correction and result

- Correction output: `docs/design/hallkeeper-focus-2026-09-07/rejected-assets/north-gallery-v2-rejected.png`
- Original output retained: `C:/Users/blake/.codex/generated_images/01a07bb3-3749-7b51-9816-2ba69baef8da/exec-dcfc7b71-dd5b-416c-9cb3-66fca308d8fd.png`
- SHA-256: `9C37CD4D849C325748D98AE1949780ED2AA4D66F80492FFB6420D80AACB09A44`
- Single-stroke wall styling is improved, the left-room identity and handed curve are retained, and chairs are removed. However, comparison with the original still shows a taller/slimmer outline. The correction does not satisfy the requested source-proportion preservation; it is also rejected and not copied into public assets.
- Use the original source reference pending a faithful derivative. No measurement or current-layout guarantee follows from either candidate.

## Exact prompt

```text
Use case: precise-object-edit.
Edit target: supplied floor-plan illustration E:/downloads/blueprints/north gallary.png. It contains TWO separate gallery drawings side by side. Make ONE cleaned reference image of the LEFT-HAND room only, the North Gallery. Completely exclude the right-hand room and its boardroom furniture. Do not mirror, rotate or redesign the left-hand room.
Remove ONLY the rows of individual loose chairs inside the left-hand room. Leave its interior otherwise empty. Preserve faithfully the exact left-hand room's wall outline and thickness relationships, all little stepped offsets at top and bottom, all exterior-wall openings and projections, the long curved right boundary bulging RIGHT toward the original paired image's centre, and both door openings with their original swing arcs above and below that curved boundary. Preserve the original asymmetry; do not straighten or regularise the curved wall.
Retain the source dimension annotations exactly: "11.5m" for the vertical room extent and "4m" for the horizontal width, with simple dimension arrow lines outside the isolated room. These are transcribed source labels, not recalculated dimensions. Do not add any other words, a room title, north arrow, scale bar, legend, capacity, furniture, ornament, floor texture, shadows or new architecture.
Restyle only: precise crisp dark sage-green architectural linework on a flat plain warm ivory background (#faf8f2). Uniform clean draughting clarity, subtle hierarchy between wall lines and door swings. Keep the original room's proportions and orientation, show the entire outline and both dimension labels uncropped with a modest empty margin. Portrait composition. This is a non-survey cleaned reference illustration; geometry must be traced from the input, not invented.
```

## Exact targeted correction prompt

```text
Use case: precise-object-edit. Targeted correction of a cleaned North Gallery plan.
GEOMETRY AUTHORITY is image 1: the ORIGINAL supplied paired floor plan E:/downloads/blueprints/north gallary.png. Use only its LEFT room, not the right room. Image 2 is the REJECTED first cleanup: it incorrectly introduced double wall outlines and stretched the room taller/slimmer. Do NOT inherit those errors from image 2; it is included solely to show what to correct.
Produce a faithful cleaned tracing of image 1's LEFT room. Retain exactly its proportions and handedness; isolate the room by cropping, never by stretching. The original inner boundary from its main top edge to bottom is visually about 2.3 times the widest room-body width including the curved bulge, not the skinnier shape in image2. The source is an illustration: do NOT rescale its shape to make the printed 11.5m and 4m values mathematically proportional. Do NOT make a symmetry correction.
Change ONLY removal of the known rows of theatre chairs plus the palette. Keep the original single boundary line style. No double wall contours, no extruded wall thickness, no duplicated parallel wall strokes. Retain every original wall break, offset, exterior-wall opening/projection and its relative size and vertical position. Keep the left-room top end offsets and opening, bottom stepped outline, single long right boundary bulging RIGHT, and the two door openings/single swing arcs above and below this curve. Do not manufacture three rectangular closed boxes where source window details differ. Precisely trace the original architecture, leaving no chairs.
Retain the source labels "11.5m" and "4m" with simple external dimension arrows, moved beside/below the isolated room only as necessary. Dimension placement is independent of room geometry. No other labels or words.
Crisp thin single dark sage-green linework (#355842) on a flat plain warm ivory background (#faf8f2), similar single-stroke architectural clarity to the ORIGINAL. No texture, shadows, embellishment, extra furniture, north arrow or scale bar. Preserve orientation and include a modest empty margin. Exclude the other gallery completely. The goal is a faithful unstretched furniture-free illustration, not a redesign.
```
