# Reception captured-quality comparison V0 report

Date: 2026-07-18

Workstream: T-529 under the active T-508 super-app path

Authority: none

## Outcome

The local Foundry app can now run a frozen, real-data Reception comparison
between the Quality SOG profile and Mobile SPZ profile. It renders six fixed
views twice, records exact source and screenshot identities, scores matching
pairs, exposes progress/cancel/report-download states, and retains an
authority-none regression-triage report.

This is ordinary local reconstruction-product engineering. No cybersecurity,
credential, penetration-testing, cloud-deployment, signing or publication work
is needed for this path.

The comparison deliberately selects no winner. It is not product acceptance,
survey evidence, physical-accuracy evidence, a rights decision, release
authority or proof of network isolation.

## Frozen real inputs

| Profile | Exact files | Decoded Gaussians |
| --- | ---: | ---: |
| `quality-sog-fine-v1` | 4 SOG files / 35,735,101 bytes | 2,002,009 |
| `mobile-spz-fine-v1` | 4 SPZ files / 30,010,681 bytes | 1,978,258 |

All eight files were hashed before and after capture and were unchanged. A
final independent rehash still matched every recorded size and SHA-256. There
is no overarching source receipt (`sourceReceiptSha256` is `null`), so the
claim is limited to the eight direct asset identities in the evidence manifest.

The renderer was pinned to `reception-viewer-profile-source-v1` at 1200×900,
device scale 1. The frozen views are overview, timber-left, timber-right,
floor-surface, ceiling-moulding and column-skirting. They share one optical
centre; this does not test view-dependent appearance from different camera
positions.

## Real run and results

The successful uninterrupted run is retained at:

`output/playwright/reception-captured-quality-v0/20260718abcdef0123456789abcdef02/`

It produced 24 lossless PNGs and 24 matching manifest entries. Independent
verification found no missing, extra, size-mismatched or hash-mismatched
capture. The two repeats were byte-identical for all 12 profile/view pairs,
leaving 12 unique screenshot hashes.

The six Quality/Mobile view pairs produced these full-frame sRGB ranges:

| Metric | Range |
| --- | ---: |
| MAE | 0.028078–0.044548 |
| SSIM | 0.939355–0.963672 |
| PSNR | 25.698124–29.266582 dB |

Every automated triage verdict is `review`. Identical background can increase
agreement, and these metrics do not rank physical or perceptual source quality.
Visual review found all six pairs coherent, closely aligned and free of blank
or visibly corrupted captures, with small appearance differences. No winner or
equivalence claim is made.

The compiled report verifies against
`omnitwin.foundry.captured-quality-comparison-report.v0`. Its self-digest is
`7f3e11b92ee6a2c60ca13a5391b02a319f25dda80de7db3f8ff61a442ae3fe99`;
the 27,053-byte file SHA-256 is
`bf824e25d7c8a7750fa5a5aef5964b96b6559de3ab7dc5e106d9e8a50678b5a7`.
The runner recorded zero external requests and zero console errors. Zero is an
application observation, not independent OS/network-isolation proof.

## Windows commit and cancellation repair

The first full attempt completed all captures, post-source checks and scoring,
then Windows returned `EPERM` during final directory rename because the
detached watchdog still had its marker open. That attempt retained no success
or report. The runner now stops and awaits the watchdog before commit, removes
the marker, retries transient `EPERM`/`EBUSY`, refuses overwrite, and removes
only an exact runner-owned final directory if cancellation arrives after
rename. The second full attempt then committed atomically.

The successful run used runner SHA-256
`5139c23d1a294673d4e5cbf49bb27bafc9ebdc041e32d182a8a9f31ef6345a01`.
Later cancellation-only hardening changed the current runner SHA-256 to
`0e5741b043952fa7791122cde2c4d4312131550eee18135a8f31236e9582f3a6`.
That later edit passed 19 deterministic unit/injected tests but was not given
another expensive 24-capture replay.

## Local app QA

The loopback app presents a dedicated optional panel with exact scope, progress,
stop/discard and digest-bound report download states. Rendered QA passed at
1280×720 desktop and 390×844 mobile with no page-level horizontal overflow and
no browser console warning/error. No screenshot artifact was persisted.

A real UI start-then-cancel smoke stopped during capture, displayed “The local
captured-quality comparison was cancelled. No report was retained,” left the
dedicated output root empty and shut down the loopback listener on port 43722.

## Verification

- 99/99 focused tests passed: local tool 69, core contract 5, web loopback
  origin handling 6 and runner 19.
- Core, tool and web source/e2e typechecks passed.
- Targeted TypeScript lint passed for core, tool and web. The repository ESLint
  project service does not include the standalone runner `.mjs` files; both
  passed `node --check` and the 19 runner tests.
- Core build passed.
- The tool build reports 18 `TS6059`/`TS6307` diagnostics from its existing
  sibling-source/`rootDir` configuration; the new contract import is one of
  nine affected sibling imports. Tool typecheck and focused runtime tests pass.
- The production web build correctly stopped before compilation because no
  live Clerk `pk_live_...` key was supplied; that release gate was not bypassed.

Exact artifact, implementation and source hashes are in
`docs/reports/reception-room-captured-quality-comparison-v0-evidence-2026-07-18.json`.

## Truth boundary and next bounded step

T-529 completes this captured-quality regression-triage slice only. T-508 and
the broader `/goal` remain active. T-507 independent surveyed controls and
T-486 rights/identity/release inputs remain necessary only for later authority
or publication claims; they do not block ordinary local super-app work.

Next, freeze an XGRIDS/Potree 2.0 bundle Source Facts V7 profile from
`metadata.json`, `hierarchy.bin` and `octree.bin`. The most useful inputs are
one known-good Reception export bundle plus real count/byte-range mismatch
negatives. Do not reinterpret successful bundle structure as metric accuracy,
provenance, rights, renderer fidelity or authority.
