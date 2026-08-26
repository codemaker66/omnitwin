# Grand Hall T-554 review pack

Status: **human review pending — authority none**

This pack is the first evidence gate for a source-faithful, Grand Hall-only
reconstruction. It does not authorize training, reconstruction, runtime use,
deployment, generated fill, architectural repair, or production trust.

## What is already machine-checked

- all 148 Matterport panorama JPEGs are inventoried by exact byte identity;
- numeric panorama sweeps 1–50 are exposed as the current source-image review
  candidates; the other 98 inventory entries are not assumed ineligible or
  outside the room and each still requires an exact-JPEG human disposition;
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

Non-authoritative visual inspection of those source-bound pages found clear
possible Grand Hall evidence in sweeps 051–075: they visibly continue the same
wood-panelled, fireplace-and-window hall seen in the earlier review images.
This is not a human room-membership decision, but it is enough to trigger the
defined stop condition. The current 50-image candidate set is incomplete and
must not be accepted or used to author final masks. An authorized venue
reviewer must confirm the affected exact sources; T-550 and this root review
pack must then be rebuilt before T-554 acceptance can resume.

## Open these files in this order

1. [Panorama candidate overview](./panoramas/panorama-candidate-overview-review-only.png)
   — inspect source panorama sweeps 001–050. A displayed E57 scan number is a
   separate diagnostic sequence hypothesis, not source identity, pose,
   correspondence, or a decision.
2. [Six diagnostic panorama pairs](./panoramas/panorama-crosswalk-six-review-only.png)
   — historical-unverified visual comparisons only; the pairings are not byte
   lineage, geometric camera authority, or accepted correspondences.
3. Open the exact, source-bound
   [remaining-inventory supplement](../grand-hall-t554-panorama-inventory-review/)
   and then open the corresponding original under
   `F:\downloads (some very important)\TH Panoramic` whenever the resampled tile
   is not decisive. Inspect every one of the 98 entries outside the current
   50-candidate set. The formal template supplies their exact identities. The
   current pages already expose possible Grand Hall evidence in sweeps 051–075,
   so stop for authorized confirmation and a rebuilt candidate set.
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

Record decisions in [REVIEW-CHECKLIST.md](./REVIEW-CHECKLIST.md). Leaving an
item `UNSURE` is safe; no unresolved item can become runtime authority.
The checklist is a visual decision aid, not the formal submission. Use the
[local T-554 acceptance runbook](../grand-hall-t554-acceptance-runbook.md) to
generate authority-none JSON templates and, only after qualified human review
of every decision, volume, and mask, run the local fail-closed acceptance gate.

## Baby-step workflow

1. Generate blank, authority-none JSON templates with the
   [local acceptance runbook](../grand-hall-t554-acceptance-runbook.md), or copy
   the [exact checked-in pending templates](../grand-hall-t554-acceptance-template/)
   into a separate working directory. Room 9, both cleanup classes, all 148
   panorama entries, and all eight interfaces are still unresolved; the volume
   is empty. This grants no authority.
2. Review exact MatterPak room 9 against the intended Grand Hall. Do not accept
   the source room number as proof of room identity.
3. Inspect the source-bound `Window` and `Mirror` cleanup handling. Accepting
   either means only that its source scope handling is correct; it does not
   assert that architectural windows or mirrors exist.
4. Look at source panorama sweep 001 in the overview and mark it `INCLUDE`,
   `EXCLUDE`, or `UNSURE` in the working formal JSON.
5. Repeat through source panorama sweep 050. You may overturn every current
   image-content hypothesis. This review accepts no E57 scan mapping.
6. Generate the separate inventory-review supplement (seven pages plus one
   manifest, eight files total) using the
   [local acceptance runbook](../grand-hall-t554-acceptance-runbook.md). Its
   output is a sibling directory named
   `grand-hall-t554-panorama-inventory-review`, never a child of this immutable
   review-pack root. The supplement preserves this pack's exact bytes and
   digests, binds every tile to one of the remaining 98 source identities, and
   remains authority-none and human-pending. The checked-in supplement was
   exact-regeneration-verified against the supplied source directory.
7. Open every supplement page and, when necessary, its exact original JPEG at
   8192x4096. Disposition each of the remaining 98 formal rows.
   Use `EXCLUDE_OUTSIDE_GRAND_HALL` only when the frame contains no Grand Hall
   evidence. If any might contain Grand Hall evidence, record
   `GRAND_HALL_EVIDENCE_FOUND_REVIEW_SET_INCOMPLETE` and stop for a rebuilt
   review set.
8. Look at the room-scale plan and all-eight interface atlas. Give one
   disposition for each interface ID. Shared vertices do not prove a doorway.
9. A qualified geometry operator authors a separate non-convex, invisible
   selection volume. It has no render, collision, structural, or
   architecture-export authority.
10. A qualified operator authors one exact 8192×4096 grayscale binary mask for
   every included panorama. Pixel `0` means included and pixel `255` means
   excluded. A reviewed all-zero mask is valid; the process must never invent
   an excluded pixel or reason.
11. Run the local `bind-masks` preparation command. It validates the exact mask
    PNGs and fills SHA-256, byte length, included-pixel count, and
    excluded-pixel count into a new still-pending decision document. It cannot
    perform or claim human review.
12. The authorized human compares those exact bound mask bytes with their
    exact source JPEGs at original resolution before setting `maskReviewed`.
    No unresolved item may be accepted.
13. Run the local acceptance gate. It re-verifies all 148 source JPEGs and the
    exact reviewed mask bindings, then writes a self-contained local bundle.
    `publication-receipt.json` is written last; an output without that complete
    receipt grants no authority. Production trust remains `null`, and
    reconstruction/runtime/staging stay unauthorized.
14. Run XGRIDS/LCC Creator Data only on qualified hardware and under a separate
    later authorization. After real output exists,
    T-557 solves the ARF→CVF transform and creates a bit-exact mask against that
    exact ordered output inventory.
15. T-558 then verifies this concrete root descriptor plus every accepted file,
    proving the exact T-550/T-551/T-553 lineage, and requires an audited,
    format-aware streamed adapter to prove the real output record kind, order,
    boundaries, and counts before any runtime trust can be considered.

## What is deliberately deferred

- No closed selection volume is authored.
- No panorama mask is authored.
- No portal/interface decision is authored.
- MatterPak room 9 has not been human-accepted as the Grand Hall.
- The `Window` and `Mirror` cleanup handling has not been human-accepted.
- None of the 148 supplied panorama dispositions has been human-accepted; the
  50/98 split is a review-work split, not an eligibility decision.
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
