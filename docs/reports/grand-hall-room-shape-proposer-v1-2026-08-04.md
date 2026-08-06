# Grand Hall Room-Shape Proposer V1 — hardening and real refusal

**Date:** 2026-08-04  
**Scope:** exact Grand Hall pilot sweeps 0–48; sweep 49 remains excluded  
**Authority:** none; machine proposal only  
**Outcome:** integrity-verified `unmeasurable`; no crop or mesh was authorised

## What changed

Claude's untracked phase-1 proposer was a substantial implementation and its
29 synthetic tests passed, but its design-required outboard-mass safeguard was
only counted, never used. Its proposal also named the existing Potree-specific
room-envelope review schema even though no compatible adapter exists.

V1 hardens that slice without using advertised room dimensions:

- unadjudicated outboard mass now creates a blocking refusal instead of being
  silently compatible with a measured result;
- opposing-wall distances are sampled over the planes' actual overlapping
  support, not around coordinate zero;
- floor-to-ceiling distance is now plane-to-plane over the walked support and
  reports the measured range caused by non-parallelism;
- zero-length normals are counted and ignored, while insufficient usable-normal
  coverage fails closed;
- strict PLY intake consumes LF and CRLF headers correctly, rejects unexpected
  elements, truncation and trailing payload bytes;
- the outside-figure comparison independently verifies the frozen proposal
  digest and makes no comparison when the proposer refused a complete result;
- the review handoff now says exactly what exists: a proposer overlay targeting
  the human-review pattern, **not** a valid
  `omnitwin.foundry.room-envelope-review.v0` artifact or direct import;
- proposal-file bytes, diagnostics and the run receipt are hash-bound, with a
  dependency-free verifier; and
- a deterministic top-view diagnostic overlays the fixed-stride captured-point
  context, all 49 scanner origins and all 22 wall candidates.

## Frozen real inputs

| Input | Evidence |
|---|---|
| Cached cloud | 6,526,772 points; 313,285,263 bytes; SHA-256 `b7af01da3a57f9d3b334d5da3be84d9e8c5fecc1ef5011e553ab62f69a7cae87` |
| Scanner centres | 49 rows; 1,439 bytes; SHA-256 `16c8cf9f21427eaa2e841d1f85e03a8a20830e4abcb8349efa20f34f609f2608` |
| Pilot manifest file | 622,436 bytes; SHA-256 `a92471791884f0e62696de286777db77830bf4c821c7b224f8781e25095b050e` |
| Normal coverage | 6,526,768 usable; 4 zero-length normals ignored and disclosed |

The cloud and origins are preserved read-only in Claude's local scratch cache.
The durable proposal binds their hashes and sizes; the cache itself is not yet
a product-owned durable workspace and must not be treated as one.

## Real result

Proposal SHA-256: `7b850efa32104b8df6c35c40c29e0ec7af30acd861ee49e5ea5b83541644b1dd`  
Receipt SHA-256: `0da7325bd480a7bf23901f8690c9de0d3e9cfc1227c622582ecf9ec403fdbab7`

The result is `unmeasurable` with two explicit refusals:

1. `WALL_NOT_FOUND:y_max` — none of the enumerated positive-y planes passes
   completeness, measured-height coverage and walked-footprint coverage
   together.
2. `OUTBOARD_MASS_UNADJUDICATED:y_min` — the locally accepted negative-y
   surface has 401,966 points behind it, an outboard-to-inlier ratio of 0.831.
   Because the cached cloud has no per-point sweep identity, this revision
   cannot separate real architecture from rays passing through openings.

Diagnostic-only plane separations remain visible rather than being promoted to
a room result:

| Quantity | Centre | Range | Uncertainty | Status |
|---|---:|---:|---:|---|
| Recovered x-plane pair | 21.152 m | 21.124–21.180 m | 0.038 m | diagnostic axis only |
| Floor-to-ceiling pair | 6.744 m | 6.712–6.776 m | 0.046 m | diagnostic only |
| Complete room length/width/height | — | — | — | refused |

No advertised figure was used or compared. The comparison command prints
`dimensions: not compared -- the proposal refused a complete measurement`.

## Artifacts

- `docs/operations/grand-hall-room-shape-proposal-v1-2026-08-04.json`
- `docs/operations/grand-hall-room-shape-proposal-v1-2026-08-04-receipt.json`
- `docs/operations/grand-hall-room-shape-proposal-v1-2026-08-04-top-view.svg`

The SVG is 463,261 bytes at SHA-256
`1b7edf3ba02441fafe3e478ffabfcf1d0b0646e04dc72dfeb2c110302f2ae7c9`.
It is review context, not a surveyed plan.

## Verification

- 40/40 focused Python tests pass (up from 29/29).
- All five Python entry points compile.
- Two independent real replays produced byte-identical 26,877-byte proposal
  files at SHA-256
  `55baf588528473ab3baef67a56ba1ce33d2d4ec0b0949f1ae55662d640fd11bc`.
- The dependency-free verifier rehashed the 313 MB cloud, origins, proposal and
  SVG and returned `PASS_ROOM_SHAPE_RUN_INTEGRITY`.
- A headless local render of the SVG was visually inspected at 1200×900; the
  point context, candidate surfaces, outboard-review state, 49 origins, scale
  and refusal header were legible.

## Honest next slice

Do not run Poisson meshing from this envelope. First create a durable cached
cloud with per-point sweep identity and use opening-aware ray evidence to
adjudicate the negative-y outboard mass and explain the missing positive-y
boundary. Then add an explicit E57 room-shape proposal review adapter or a
versioned general room-envelope-review contract; the current Potree V0 review
artifact cannot ingest this metric-frame polygon directly. Only a complete,
human-accepted envelope should become the crop for the first bounded mesh.

This is ordinary local reconstruction work. It requires no cybersecurity
workstream, provider execution, signing, publication, training or paid compute.
