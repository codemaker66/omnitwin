# Supplied furniture models

`@omnitwin/types`' canonical catalogue owns furniture identity and planning size.
This directory holds versioned presentation assets. Each imported model directory
contains a GLB, a rendered preview and provenance; it does not establish owned
inventory quantities or manufacturer accuracy.

The September batch uses `v1/model.glb`; the earlier Burgess Turini retains its
existing `v1/chair.glb` URL. Do not overwrite an already published version to
silently change appearance or calibration. Update catalogue URLs and the database
registration together, preserving stable UUIDs and saved-object references.

To reproduce the September GLBs, extract the reviewed source GLBs into individual
source folders and run the following with repository dependencies installed:

```text
node packages/web/scripts/prepare-furniture-batch.mjs <repository> <extracted-sources> packages/web/scripts/furniture-batch-20260907.json <output-directory>
```

The script checks source hashes, simplifies geometry, downsamples maps to 1K,
encodes lossless WebP, centres/grounds/calibrates geometry and records provenance.
Original sources and 2K derivatives are retained separately. Preview images are
neutral studio renders of the final models. See the batch import report for the
source selection, comparisons and verification evidence.

For future imports, supply a textured/PBR GLB and measured width, depth and height.
Keep material maps embedded. Include front, rear and side reference photographs
when available so orientation and generated defects can be checked. Image-derived
dimensions remain provisional until measured; geometry calibration cannot verify
hidden construction details or physical stock counts.
