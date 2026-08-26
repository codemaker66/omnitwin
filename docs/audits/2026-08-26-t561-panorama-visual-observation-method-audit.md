# T-561 panorama visual-observation method audit

Date: 2026-08-26
Task: T-561
Scope: Trades Hall Grand Hall panorama visual-scope observations
Status: complete at the authority-none observation and human-pending successor boundary

## Decision

The supplied panorama directory contains 148 exact JPEG identities spanning
sweep numbers 1 through 149 with sweep 093 absent. The historical T-550/T-554
v1 path split those bytes into 50 candidates and 98 non-candidates. That split
is not safe for a room-only reconstruction: agent visual review found visible
Grand Hall pixels in 24 of the 98 records that v1 could only force toward
whole-frame exclusion.

T-561 therefore records a new, additive, authority-none visual-observation
pack. It does not rewrite the immutable T-550/T-554 v1 evidence or the T-560
crosswalk. A later T-554 v2 review must use one inventory-ordered 148-record
decision set so a reviewer can include or exclude any supplied source without
moving it between eligibility arrays.

## Observed partition

The exact-source-file visual review produced these agent observations:

- Grand Hall pixels observed: sweeps 001-061, 065-075, and 148-149 (74 files).
- No Grand Hall pixels observed: sweeps 062-064, 076-092, and 094-147
  (74 files).
- Source absent: sweep 093.
- Agent uncertainty flags: zero.

This partition is a navigation and review result only. `No pixels observed`
does not mean measured empty, and `pixels observed` does not mean human
accepted. A human may overturn either observation.

## Inspection-resolution correction

The exact 8192x4096 JPEG identities were opened, but the Codex image surface
displayed them at 2048x1024. T-561 must therefore state:

- source grid: 8192x4096;
- inspection display: 2048x1024;
- display may have been resampled: true;
- native-resolution human review completed: false.

The earlier shorthand "original-resolution review" was inaccurate and must
not enter an evidence or acceptance claim. Exact 8192x4096 mask authoring and
side-by-side human review remain required by T-554.

## Boundary-sensitive evidence

Many camera stations lie inside one room while their pixels cross a portal
into another. The most consequential cases are:

- sweeps 001 and 018: Grand Hall-dominant frames with adjacent-space pixels;
- sweeps 019 and 050: adjacent camera positions with localized Grand Hall
  pixels through a portal;
- sweep 049: mixed threshold frame with Grand Hall on both sides of the
  equirectangular seam;
- sweeps 051-061 and 065-075: memorial-room camera positions with localized
  Grand Hall pixels through open portals;
- sweeps 148-149: circulation camera positions with localized Grand Hall
  pixels through an open doorway.

Conservative rectangles may be rendered as attention aids. They are not masks:
being inside a rectangle does not imply inclusion, and being outside does not
imply exclusion. Door leaves, jambs, arches, thresholds, stitching bands, and
occlusions still require exact native-grid polygon review.

## Required fail-closed properties

The T-561 implementation is acceptable only if it:

1. strictly binds all 148 exact filenames, hashes, byte lengths, and
   dimensions plus the absence of sweep 093;
2. verifies the immutable T-554 panorama evidence and complete source
   inventory before and after derivation;
3. fully decodes every source JPEG;
4. validates every attention rectangle on the original 8192x4096 coordinate
   grid and represents seam wraps as two in-bounds rectangles;
5. renders deterministic review-only aids with an explicit non-mask warning;
6. publishes into an absent output through a no-replace staged directory with
   the receipt written last;
7. supports a separate zero-write check that reconstructs expected bytes and
   rejects missing, extra, changed, aliased, or undecodable outputs; and
8. fixes every downstream authority and permission flag to none or false.

## Authority boundary

T-561 grants no room-membership, camera-position, camera-pose, orientation,
transform, mask, training, reconstruction, architectural, structural,
collision, export, runtime, staging, publication, or production-trust
authority. T-560's ambiguous Image2D candidates for sweeps 078 and 079 are a
separate correspondence question and are not resolved by the zero-uncertainty
room-pixel observation partition.

No API key, generative model, image generator, or video generator is required
for this gate. Generated fill remains prohibited.

## Real-run result

The no-replace real build completed at the disjoint local evidence root
`D:\venviewer-evidence\grand-hall-t561-panorama-visual-observation-pack-v1`.
It emitted 148 source records, 70 deterministic review aids, and 72 files /
307,663,539 bytes in total. A separate zero-write invocation returned
`checked_exact_regeneration` and `exactRegenerationVerified=true`.
During review, the initial implementation was found to force a complete JPEG
decode only for the 70 files that produced aids. The implementation was
corrected to stable-read and fully decode all 148 exact JPEGs before rendering
any applicable aid. The real zero-write check was then rerun from that corrected
path and passed with unchanged persisted bytes and digests.

The sealed input file is 173,677 bytes with serialized SHA-256
`9b196214bab065ce353019797f81134ec782bf71cf9d9b203851911ae774f297`
and observation-set self-digest
`sha256:d235821e4251f2e849f99f387950803a1095102c7a11f3c4052fd42a647bbdb2`.
The generated observation manifest self-digest is
`sha256:87aa9cdb7a0a731832928586a4106806ae175ec17e559dd530bfe66d32934c83`
and its serialized-file SHA-256 is
`6234491aeb52c39dbd230cb4268c62637c16fd35d664ece129f536e85d75eb1f`.
The publication-receipt self-digest is
`sha256:63f606bbe2a1e39fcf4c0f291c08571e4663e819da82cbbdd7ed845cc993b03c`
and its serialized-file SHA-256 is
`bebdfc93eee8b6a99c7d9a67b5c3f3c8661e2cbc4df86712b7df86ba8e7260ed`.

Visual spot-checks of the generated aids for seam-sensitive sweep 049,
portal-localized sweep 051, and circulation sweep 148 confirmed that the
rectangles are rendered on the intended regions and visibly labelled
`REVIEW AID ONLY / NOT A MASK / AUTHORITY NONE`.

The additive T-554 v2 contract subsequently passed independent adversarial
review after closing source-identity, path, exact-interface, cleanup-class,
closed-volume, T-561-lineage, and cross-artifact consistency gaps. Its real
unified human-pending pack generated and exact-check verified with review-pack
self-digest
`sha256:6a1c83a7784e39876d12f83294699fd9ad32ae85372f9b2a622b26cfce5e2037`
and receipt self-digest
`sha256:d6b5e4da5d5bffb4207fd15524295c24055612106d38c45a659b754e38a38845`.

T-561 is therefore complete only at this authority-none preparation boundary.
Native-grid human decisions, exact masks, accepted volume and interface
evidence, reconstruction, and admission remain subsequent blocked work.
