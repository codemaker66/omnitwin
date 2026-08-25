# Grand Hall T-554 review pack

Status: **human review pending — authority none**

This pack is the first evidence gate for a source-faithful, Grand Hall-only
reconstruction. It does not authorize training, reconstruction, runtime use,
deployment, generated fill, architectural repair, or production trust.

## What is already machine-checked

- all 148 Matterport panorama JPEGs are inventoried by exact byte identity;
- numeric sweeps 1–50 are exposed as review candidates and the other 98 files
  remain explicitly unreviewed/ineligible for T-554;
- MatterPak room 9 is shown directly from source geometry;
- all eight exact shared-index interfaces are present and remain `PENDING`;
- room 9 is correctly reported as non-watertight rather than silently capped;
- the retained E57 pose source and its deterministic value normalization are
  bound without claiming a reviewed E57-to-MatterPak transform;
- no neighbouring room, facade, invented window, invented doorway, dark floor,
  closure surface, or generated content has been added.

The canonical root descriptor is [review-pack.json](./review-pack.json). It
binds the final boundary manifest, panorama manifest, 148-file inventory,
50 review candidates, all eight interfaces, and the T-550/T-551/T-553 source
receipts.

## Open these files in this order

1. [Panorama candidate overview](./panoramas/panorama-candidate-overview-review-only.png)
   — inspect scans 000–049. The coloured labels are pending hypotheses, not
   decisions.
2. [Six diagnostic panorama pairs](./panoramas/panorama-crosswalk-six-review-only.png)
   — useful visual comparisons only; the pairings are not byte lineage or
   accepted correspondences.
3. [Room-scale XY plan](./boundary/plan-xy.svg) — source room 9, rooms 13/14,
   candidate centres, and the complete eight-interface legend.
4. [Room 9↔13 portal diagnostic](./boundary/portal-room9-room13.svg) and
   [room 9↔14 portal diagnostic](./boundary/portal-room9-room14.svg) — point and
   residual diagnostics only, explicitly not closure geometry.
5. Exact source slices:
   [Z=0.10 m](./boundary/slice-z-0.10m.svg),
   [Z=1.50 m](./boundary/slice-z-1.50m.svg), and
   [Z=2.50 m](./boundary/slice-z-2.50m.svg).
6. [All-camera diagnostic overview](./boundary/camera-overview-diagnostic.svg)
   only if needed. It is deliberately separate because all 149 diagnostic
   centres make the room-scale plan harder to read.

Record decisions in [REVIEW-CHECKLIST.md](./REVIEW-CHECKLIST.md). Leaving an
item `UNSURE` is safe; no unresolved item can become runtime authority.

## Baby-step workflow

1. Look at panorama scan 000 in the overview.
2. Mark it `INCLUDE`, `EXCLUDE`, or `UNSURE` in the checklist.
3. Repeat through scan 049. You may overturn every current agent hypothesis.
4. Look at the room-scale plan and portal diagrams.
5. Give one disposition for each of the eight interface IDs. Do not infer a
   doorway merely because two source submeshes share vertices.
6. Stop. The closed selection volume and panorama masks do not exist yet.
7. After those decisions, the pipeline authors a separate non-convex,
   invisible selection volume. It will have no render, collision, structural,
   or architecture-export authority.
8. The pipeline authors one exact 8192×4096 grayscale binary mask for every
   included panorama. Pixel `0` means included and pixel `255` means excluded.
   A reviewed all-zero mask is valid; the process must never invent an excluded
   pixel or reason.
9. Review the volume and masks. Only then can T-554 produce accepted artifacts.
10. Run XGRIDS/LCC Creator Data on qualified hardware. After real output exists,
    T-557 solves the ARF→CVF transform and creates a bit-exact mask against that
    exact ordered output inventory.
11. T-558 then verifies this concrete root descriptor plus every accepted file,
    proving the exact T-550/T-551/T-553 lineage, and requires an audited,
    format-aware streamed adapter to prove the real output record kind, order,
    boundaries, and counts before any runtime trust can be considered.

## What is deliberately deferred

- No closed selection volume is authored.
- No panorama mask is authored.
- No portal/interface decision is authored.
- No XGRIDS/LCC output exists from which to solve a reviewed transform.
- No E57-record-order mask is being misrepresented as an XGRIDS output mask.
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

- root descriptor: `sha256:a0b39dae80cec0724f68ebced0b4662223304e82bff1233b8c477b23f0088c24`
- boundary manifest: `sha256:6d0f6a230053ccc85275a80260c7b27cfd612ee5c7ca9964bc0ca8653b84de27`
- panorama manifest: `sha256:c2d74ee55b27be9b4641d3b94968591d37735d353987d30adca4fc785b3636ef`
- panorama inventory: `sha256:949f4cbf365f33d47c5e75f46b881aff857695fbbb70879e27c4f23f4b2af176`
