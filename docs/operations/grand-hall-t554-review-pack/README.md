# Grand Hall T-554 review pack

Status: **historical v1 review aid; stopped and superseded for acceptance — authority none**

This pack is the first evidence gate for a source-faithful, Grand Hall-only
reconstruction. It does not authorize training, reconstruction, runtime use,
deployment, generated fill, architectural repair, or production trust.

The checked-in JSON, PNG, and SVG evidence remains immutable. Do not use this
pack's historical 50-candidate/98-other split to run T-554 acceptance. T-561
has delivered a separately versioned successor with one unified 148-row
human-pending review surface. Use
[`grand-hall-t554-review-pack-v2-runbook.md`](../grand-hall-t554-review-pack-v2-runbook.md);
do not use this preserved v1 pack for acceptance.

## What is already machine-checked

- all 148 Matterport panorama JPEGs are inventoried by exact byte identity;
- numeric panorama sweeps 1–50 are exposed as the historical v1 source-image
  candidates; the other 98 entries were never human-established as ineligible
  or outside the room, and the split is now superseded for acceptance;
- each candidate JPEG identity contains only its sweep number, filename, exact
  bytes, and dimensions; the apparent sweep→E57 scan sequence is stored
  separately as `sequence_hypothesis_unverified` with no geometric-camera,
  training, reconstruction, or runtime authority;
- MatterPak room 9 is shown directly from source geometry but is not yet
  accepted as the Grand Hall;
- the source-bound `Window` and `Mirror` cleanup classes require separate
  human inspection and may be accepted only as scope handling with no
  architectural authority;
- all eight exact shared-index interfaces are present and remain `PENDING`;
- room 9 is correctly reported as non-watertight rather than silently capped;
- the retained E57 pose source and its deterministic value normalization are
  bound without claiming a reviewed E57-to-MatterPak transform;
- no neighbouring room, facade, invented window, invented doorway, dark floor,
  closure surface, or generated content has been added.

The canonical root descriptor is [review-pack.json](./review-pack.json). It
binds the final boundary manifest, all-eight exact interface-topology atlas,
panorama manifest, 148-file inventory, 50 pure source-JPEG review candidates,
the 98 remaining entries requiring separate dispositions, the separate
authority-none sequence hypotheses, all eight interfaces, and the
T-550/T-551/T-553 source receipts.

## Current fail-closed finding

The exact [remaining-inventory review supplement](../grand-hall-t554-panorama-inventory-review/)
was generated from the supplied source directory and then byte-for-byte
regeneration-checked. It contains seven review pages plus one manifest (eight
files total). Its manifest is
`sha256:fd1c53ef54db0ab3c34d1fc879ce22ce9a8c9947bc7aca1ade311ebe77d468a0`.

A later all-source audit supersedes that contact-sheet interpretation. At the
model's 2048x1024 display resolution, authority-none agents observed Grand
Hall pixels in sweeps 001–061, 065–075, and 148–149 (74 exact source files),
and observed no Grand Hall pixels in sweeps 062–064, 076–092, and 094–147
(74 exact source files). Numeric sweep 093 is absent from the exact 148-file
inventory, not unresolved. The audit recorded zero agent uncertainty flags,
but `nativeResolutionHumanReviewCompleted=false`. These are agent
observations, not human `INCLUDE`/`EXCLUDE` decisions, `measured_empty`, masks,
camera-location classifications, or E57 scan mappings; their authority is
`none` and all 148 records remain human-pending.

The 24 positive observations outside the historical 1–50 group permanently
stop this v1 pack's acceptance path. Preserve it as evidence and wait for the
separately versioned T-561 successor before formal human review or mask work.

## Open these files in this order

1. [Panorama candidate overview](./panoramas/panorama-candidate-overview-review-only.png)
   — historical v1 aid for sweeps 001–050 only. It is not the current candidate
   boundary. A displayed E57 scan number is a separate diagnostic sequence
   hypothesis, not source identity, pose, correspondence, or a decision.
2. [Six diagnostic panorama pairs](./panoramas/panorama-crosswalk-six-review-only.png)
   — historical-unverified visual comparisons only; the pairings are not byte
   lineage, geometric camera authority, or accepted correspondences.
3. Open the exact, source-bound
   [remaining-inventory supplement](../grand-hall-t554-panorama-inventory-review/)
   and then open the corresponding original under
   `F:\downloads (some very important)\TH Panoramic` whenever the resampled tile
   is not decisive. It historically covers the 98 entries outside the v1
   50-candidate set. The preserved template supplies their exact identities. The
   current pages are historical contact-sheet aids only. The later 2048x1024
   display-resolution audit recorded the exact 74/74 observation split above
   and supersedes their earlier interpretation. Do not infer camera station,
   room membership, whole-frame exclusion, or pixel authority from either aid.
4. [Bound T-551 room-9 source evidence](../grand-hall-room9-source-boundary-evidence-v1.json)
   — inspect the exact room-9 selection and its explicit MatterPak
   `Window`/`Mirror` cleanup warning. Inspect the supplied source OBJ as needed.
   If the available evidence is insufficient to judge either cleanup class,
   stop and request a better evidence view rather than accepting the label.
5. [Room-scale XY plan](./boundary/plan-xy.svg) — source room 9, rooms 13/14,
   candidate centres, and the complete eight-interface legend.
6. All-eight exact-source interface atlas:
   [0:2](./boundary/interfaces/interface-matterpak-1-9-0-2.svg),
   [0:3](./boundary/interfaces/interface-matterpak-1-9-0-3.svg),
   [0:4](./boundary/interfaces/interface-matterpak-1-9-0-4.svg),
   [1:10](./boundary/interfaces/interface-matterpak-1-9-1-10.svg),
   [1:11](./boundary/interfaces/interface-matterpak-1-9-1-11.svg),
   [1:12](./boundary/interfaces/interface-matterpak-1-9-1-12.svg),
   [1:13](./boundary/interfaces/interface-matterpak-1-9-1-13.svg), and
   [1:14](./boundary/interfaces/interface-matterpak-1-9-1-14.svg). Each page
   shows exact source triangles and shared topology in XY/XZ/YZ, with no inferred
   doorway, closure, keep-side, mask, camera join, or generated contour.
7. [Room 9↔13 shared-interface plane fit](./boundary/interface-plane-fit-room9-room13.svg) and
   [room 9↔14 shared-interface plane fit](./boundary/interface-plane-fit-room9-room14.svg) — the
   two largest exact shared-vertex interfaces by source count. These are residual
   diagnostics only: they infer no portal, doorway, or closure geometry.
8. Exact source slices:
   [Z=0.10 m](./boundary/slice-z-0.10m.svg),
   [Z=1.50 m](./boundary/slice-z-1.50m.svg), and
   [Z=2.50 m](./boundary/slice-z-2.50m.svg).
9. [All-camera diagnostic overview](./boundary/camera-overview-diagnostic.svg)
   only if needed. It is deliberately separate because all 149 diagnostic
   centres make the room-scale plan harder to read.

Do not record formal decisions in the historical
[REVIEW-CHECKLIST.md](./REVIEW-CHECKLIST.md). Read the
[local T-554 acceptance runbook](../grand-hall-t554-acceptance-runbook.md) for
the explicit v1 stop condition and the remaining successor requirements. No
current command may turn this pack into acceptance or runtime authority.

## Baby-step workflow

1. Stop. Do not run the v1 `accept` command or use the 50/98 split to create
   formal decisions or masks.
2. Preserve this directory and the sibling supplement byte-for-byte as
   historical, authority-none evidence.
3. Wait until T-561 publishes and checks a separately versioned successor with
   one unified row for each of the 148 exact source JPEG identities.
4. Have an authorized venue reviewer inspect every exact JPEG at native
   8192x4096 resolution. The reviewer may overturn either agent observation
   class. Only that later workflow may change
   `nativeResolutionHumanReviewCompleted` from `false`.
5. Review exact MatterPak room 9, both source cleanup classes, and all eight
   source interfaces independently. No label or shared topology proves a room,
   window, mirror, doorway, or portal.
6. Have a qualified geometry operator author and review a separate non-convex,
   invisible selection volume. It has no render, collision, structural, or
   architecture-export authority.
7. Author one exact 8192×4096 grayscale binary mask for every panorama the
   human includes, bind its SHA-256/length/pixel counts, then have the human
   compare those exact mask bytes with the exact source before setting
   `maskReviewed`.
8. Run only the future successor's fail-closed acceptance and verification
   commands. No such command or final T-561 artifact hash is documented yet.
9. Preserve `productionTrust: null` and keep reconstruction, runtime, staging,
   deployment, and publication unauthorized after local scope acceptance.
10. T-555, T-557, T-556, and T-558 remain separate later reconstruction,
    registration/masking, bake-off, and concrete-byte admission gates.

## What is deliberately deferred

- No closed selection volume is authored.
- No panorama mask is authored.
- No portal/interface decision is authored.
- MatterPak room 9 has not been human-accepted as the Grand Hall.
- The `Window` and `Mirror` cleanup handling has not been human-accepted.
- None of the 148 supplied panorama dispositions has been human-accepted. The
  v1 50/98 split is stopped and superseded; the completed T-561 successor
  remains `authority: none` with `nativeResolutionHumanReviewCompleted=false`.
- No XGRIDS/LCC output exists from which to solve a reviewed transform.
- No E57-record-order mask is being misrepresented as an XGRIDS output mask.
- The local template, mask-binding preparation, and acceptance commands exist,
  but no completed human decision record, reviewed volume, reviewed mask set,
  complete receipt-last bundle, or real accepted artifact has been produced.
- The generic accepted-bundle verifier is byte-integrity groundwork only. No
  real XGRIDS/LCC format adapter or API/intake trust integration exists yet.
- Production trust remains `null`.

No generative-model, image, or video API key is needed for this stage. The
factual master must come from supplied capture evidence. Generative tools may
later create a separately labelled creative layer, but they cannot repair or
replace the verified room master. The later LCC run needs licensed LCC access,
at least 128 GiB RAM, qualified empty local NVMe scratch with at least 500 GiB
free, and human confirmation of the installed LCC version/settings.

## Immutable review identities

- root descriptor: `sha256:8a6bef9c3b9e5c27e4c1f62994d7d8d01a82b4afee9515d39f2513c36dcac3aa`
- boundary manifest: `sha256:289dff7895d9e840671d503b74f576460f6e15b7ff32efae0ca12a866a875dd3`
- all-eight interface atlas: `sha256:6f7b702ef8b74b22e6d83d516ff8a2b160ee78ddcdd66f7a06370982ed96e4bc`
- panorama manifest: `sha256:4c23c3374dabd64e158c179ffaa38b32ae40876aaaf9da5f16ee57093f88f5bc`
- full 148-file panorama-directory inventory: `sha256:949f4cbf365f33d47c5e75f46b881aff857695fbbb70879e27c4f23f4b2af176`
- pure 50-JPEG source inventory v2: `sha256:2f726892ec3a29e7f0d608f22c4f4b0ca5ef89546b9d59072ab065ba336bd7f1`
