# Grand Hall T-554 review pack

Status: **human review pending — authority none**

This pack is the first evidence gate for a source-faithful, Grand Hall-only
reconstruction. It does not authorize training, reconstruction, runtime use,
deployment, generated fill, architectural repair, or production trust.

## What is already machine-checked

- all 148 Matterport panorama JPEGs are inventoried by exact byte identity;
- numeric panorama sweeps 1–50 are exposed as source-image review candidates
  and the other 98 files remain explicitly unreviewed/ineligible for T-554;
- each candidate JPEG identity contains only its sweep number, filename, exact
  bytes, and dimensions; the apparent sweep→E57 scan sequence is stored
  separately as `sequence_hypothesis_unverified` with no geometric-camera,
  training, reconstruction, or runtime authority;
- MatterPak room 9 is shown directly from source geometry;
- all eight exact shared-index interfaces are present and remain `PENDING`;
- room 9 is correctly reported as non-watertight rather than silently capped;
- the retained E57 pose source and its deterministic value normalization are
  bound without claiming a reviewed E57-to-MatterPak transform;
- no neighbouring room, facade, invented window, invented doorway, dark floor,
  closure surface, or generated content has been added.

The canonical root descriptor is [review-pack.json](./review-pack.json). It
binds the final boundary manifest, all-eight exact interface-topology atlas,
panorama manifest, 148-file inventory,
50 pure source-JPEG review candidates, the separate authority-none sequence
hypotheses, all eight interfaces, and the T-550/T-551/T-553 source receipts.

## Open these files in this order

1. [Panorama candidate overview](./panoramas/panorama-candidate-overview-review-only.png)
   — inspect source panorama sweeps 001–050. A displayed E57 scan number is a
   separate diagnostic sequence hypothesis, not source identity, pose,
   correspondence, or a decision.
2. [Six diagnostic panorama pairs](./panoramas/panorama-crosswalk-six-review-only.png)
   — historical-unverified visual comparisons only; the pairings are not byte
   lineage, geometric camera authority, or accepted correspondences.
3. [Room-scale XY plan](./boundary/plan-xy.svg) — source room 9, rooms 13/14,
   candidate centres, and the complete eight-interface legend.
4. All-eight exact-source interface atlas:
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
5. [Room 9↔13 shared-interface plane fit](./boundary/interface-plane-fit-room9-room13.svg) and
   [room 9↔14 shared-interface plane fit](./boundary/interface-plane-fit-room9-room14.svg) — the
   two largest exact shared-vertex interfaces by source count. These are residual
   diagnostics only: they infer no portal, doorway, or closure geometry.
6. Exact source slices:
   [Z=0.10 m](./boundary/slice-z-0.10m.svg),
   [Z=1.50 m](./boundary/slice-z-1.50m.svg), and
   [Z=2.50 m](./boundary/slice-z-2.50m.svg).
7. [All-camera diagnostic overview](./boundary/camera-overview-diagnostic.svg)
   only if needed. It is deliberately separate because all 149 diagnostic
   centres make the room-scale plan harder to read.

Record decisions in [REVIEW-CHECKLIST.md](./REVIEW-CHECKLIST.md). Leaving an
item `UNSURE` is safe; no unresolved item can become runtime authority.

## Baby-step workflow

1. Look at source panorama sweep 001 in the overview.
2. Mark it `INCLUDE`, `EXCLUDE`, or `UNSURE` in the checklist.
3. Repeat through source panorama sweep 050. You may overturn every current
   image-content hypothesis. This review does not accept any E57 scan mapping.
4. Look at the room-scale plan and all-eight interface atlas.
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

- root descriptor: `sha256:8a6bef9c3b9e5c27e4c1f62994d7d8d01a82b4afee9515d39f2513c36dcac3aa`
- boundary manifest: `sha256:289dff7895d9e840671d503b74f576460f6e15b7ff32efae0ca12a866a875dd3`
- all-eight interface atlas: `sha256:6f7b702ef8b74b22e6d83d516ff8a2b160ee78ddcdd66f7a06370982ed96e4bc`
- panorama manifest: `sha256:4c23c3374dabd64e158c179ffaa38b32ae40876aaaf9da5f16ee57093f88f5bc`
- full 148-file panorama-directory inventory: `sha256:949f4cbf365f33d47c5e75f46b881aff857695fbbb70879e27c4f23f4b2af176`
- pure 50-JPEG source inventory v2: `sha256:2f726892ec3a29e7f0d608f22c4f4b0ca5ef89546b9d59072ab065ba336bd7f1`
