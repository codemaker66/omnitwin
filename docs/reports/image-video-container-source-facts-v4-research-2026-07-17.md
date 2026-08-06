# Image / Video Container Source Facts V4 research

Date: 2026-07-17  
Workstream: T-508, ordinary offline product engineering  
Authority: none

## Exact question

Can the local Reconstruction Foundry establish useful, deterministic facts from
JPEG, PNG and common MP4/MOV-style video bytes while keeping format validity
strictly separate from capture role, provenance, visual quality, rights and
permission to process?

The required answer is an implemented and tested evidence chain, not an
extension-based label or a recommendation to use a future decoder.

## Success criteria

1. Issue a new immutable Universal Source Facts generation; do not widen V1,
   V2 or V3.
2. Inspect the already-open handle used by the complete receipt-bound hash; do
   not reopen a path or substitute same-sized bytes.
3. Bound source bytes, marker/chunk/box counts, metadata bytes, nesting and
   track counts, and fail closed on cancellation or source identity change.
4. Establish only byte-supported JPEG, PNG or ISO Base Media container facts.
5. Retain every image/video receipt candidate and explicitly leave DSLR,
   phone, panorama, ordinary image/video, captured, enhanced-captured,
   generated-cinematic and concept/imagination classification unresolved.
6. Carry every unresolved media fact through Source Readiness and a reviewed
   Operator Evidence Checklist mapping.
7. Keep XBIN all-or-nothing behavior and every no-network, no-mutation,
   no-reconstruction, authority-none and execution-not-authorized policy.
8. Provide deterministic fixtures, malformed and adversarial cases, real-file
   evidence, canonical downloads, desktop/mobile rendered QA and full gates.

## Primary format basis

- The [PNG Specification, Third Edition](https://www.w3.org/TR/png-3/) is a
  W3C Recommendation from 2025. It defines the eight-byte signature, ordered
  IHDR/IDAT/IEND structure, per-chunk CRC, critical/ancillary distinction,
  static PNG constraints and APNG extension. V4 can therefore verify bounded
  chunk structure and CRC without claiming that IDAT pixels were decoded.
- [ITU-T T.81](https://www.itu.int/rec/T-REC-T.81/en) remains the JPEG-1
  requirements and guidelines recommendation. Its marker model supports a
  bounded SOI/frame/scan/EOI structural profile. V4 does not turn marker
  structure into a pixel-decoder, EXIF-authority or camera-origin claim.
- [ISO/IEC 14496-12:2026](https://www.iso.org/standard/85596.html) defines the
  ISO Base Media File Format as the timed-media structure and metadata basis.
  The standard is current as of April 2026.
- Apple's primary [QuickTime atom documentation](https://developer.apple.com/documentation/quicktime-file-format/atoms)
  documents size/type headers, extended sizes, hierarchical containers and
  the rule that unknown atoms are skipped using their declared size. Its
  [file-type atom documentation](https://developer.apple.com/documentation/quicktime-file-format/file_type_compatibility_atom)
  defines major brand, minor version and compatible brands. These support a
  bounded ISO-BMFF/QuickTime-compatible metadata profile without reading media
  samples.

## Approach registry

| Approach | State | Mechanism and decisive result |
| --- | --- | --- |
| Filename extension as role | Rejected | `.jpg`, `.png`, `.mov` and `.mp4` are hints only. They cannot establish byte structure, camera class, panorama role or provenance. |
| EXIF/device strings as capture authority | Rejected | Metadata can be absent, rewritten, copied or generated. Presence may be a container fact; semantic trust needs separate digest-bound provenance evidence. |
| General image/video decoder as the canonical issuer | Blocked for V4 | A decoder can be a later compatibility probe, but decoder acceptance is version-dependent and can blur structure, decode and content-quality claims. |
| External `ffprobe`/media process | Blocked for V4 | Useful later for a separately reviewed decode/compatibility report; it would add an external process and usually a path reopen to the canonical receipt path. |
| Same-handle bounded container inspectors | Confirmed design | JPEG markers, PNG chunks/CRCs and ISO-BMFF top-level boxes plus bounded movie metadata can be derived from the exact hashed handle with explicit limits and stable failures. |
| Separate provenance/capture-role evidence | Confirmed design | Receipt candidates remain visible and V4 emits explicit unknowns. A later authoritative record may resolve role or provenance without changing what the container bytes meant. |
| AI or visual classifier guesses | Rejected as authority | Such output may propose review labels later, but cannot replace camera provenance, captured/generated lineage, rights or metric evidence. |

## Facts V4 may establish

- Exact digest and byte size inherited from the unchanged intake receipt.
- JPEG marker structure, declared frame dimensions/components/coding process,
  scan count and bounded application-metadata presence, without entropy decode.
- Static PNG chunk order, IHDR declarations, CRC agreement, IDAT byte extent,
  transparency declaration and bounded metadata presence, without pixel decode.
- ISO Base Media file-type brands, complete top-level box coverage and bounded
  movie/video-track declarations, without reading or decoding media samples.
- Stable resource-limit, parse-failure, unsupported-variant and
  unsupported-container outcomes when those facts are not established.

## Non-answers preserved by design

Container success does **not** answer any of the following:

- DSLR, phone, Matterport panorama, generic panorama, drone or ordinary media
  capture role;
- captured, enhanced-captured, generated-cinematic or concept/imagination
  provenance class;
- camera identity, trustworthy capture time, calibration, lens or projection;
- decoded pixel/sample validity, sequence relationships or camera graph;
- appearance fidelity, scene identity, physical accuracy or registration;
- ownership, training/derivative/redistribution rights, admission, route or
  recipe selection, worker/provider choice, spend or permission to execute.

## Domain-specific adversarial checklist

- Correct extension with wrong signature; correct signature with misleading
  extension; mixed image/video receipt candidates.
- Truncated JPEG segment, missing frame/scan/EOI, entropy byte stuffing,
  restart markers, extra bytes after EOI and unsupported frame coding.
- PNG bad signature, overflowing/truncated chunk, bad CRC, duplicate or
  reordered critical chunk, unknown critical chunk, invalid IHDR combination,
  APNG presented to a static-only profile and bytes after IEND.
- ISO box smaller than its header, 64-bit overflow, size zero in the wrong
  location, child escaping its parent, excessive depth/count, oversized movie
  metadata, missing file type/movie/video track and non-video media.
- Cancellation before, during and after bounded reads; handle stat change;
  outcome digest/size substitution; contradictory outcome category/code.
- Duplicate content under different paths; canonical ordering; tampered
  receipt-candidate list; XBIN mixed with otherwise valid media.
- UI that calls a valid container a DSLR, phone, panorama, captured or
  generated source; UI that implies an evidence request authorizes work.

## Current conclusion

Confirmed. The same-handle bounded-inspector design was implemented as a new
immutable V4 chain without widening V1-V3. It binds the receipt path, exact
magic prefix, byte count, SHA-256 and canonical media candidates before issuing
JPEG, static-PNG or ISO-BMFF movie/video declaration facts.

Real read-only replay established the JPEG and PNG profiles. ISO-BMFF remains
fixture-only and establishes complete top-level tiling plus selected movie and
video-track structure, not sample-table completeness, `mdat` binding, sample
decode or decoder compatibility. Ten capture-role, provenance, calibration,
decode, sequence, fidelity and rights questions remain explicit unknowns.

Focused and full gates, canonical artifact checks, rendered desktop/mobile QA
and the final independent audit passed. Exact results and source/artifact
identities are recorded in
`docs/reports/reception-room-image-video-container-source-facts-v4-evidence-2026-07-17.json`.
This proves the bounded V4 slice only. It does not complete T-508 or the broader
offline super-app goal.
