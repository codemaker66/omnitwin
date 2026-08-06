# XGRIDS/Potree v2 point-values V8 report

Date: 2026-07-18  
Workstream: T-531 under active T-508  
Authority: none

## Outcome

The bounded V8 slice is implemented and replayed against the exact Reception
bundle established by V7. It immutably embeds the V7 Source Facts, Readiness and
Checklist artifacts, adds a separate point-value domain, and produces twelve
deterministic private local diagnostic PNGs. No cybersecurity, credential,
deployment, signing, publication or cloud work is needed for this ordinary
local reconstruction-product path.

The exact 175,237 interleaved records were decoded under the official Potree
DEFAULT worker convention and checked against the already established V7
hierarchy, declared ranges and node bounds. The run found no non-finite value,
declared-range failure or node-bound violation. One V7 unknown—whether the
declared point and byte values had been decoded and validated—is now resolved
for this exact bundle. Nine V7 unknowns remain.

V8 does not turn numeric values into metres or authoritative geometry. Units,
axes, frame, CRS, physical meaning, completeness, accuracy, registration,
provenance, capture class, rights, vendor-byte semantics and official-viewer
fidelity remain unresolved.

## What V8 establishes

- Exact binding to V7 receipt `40ea026b…`, bundle `f226739d…` and all three
  unchanged member identities before point bytes are interpreted.
- A bounded 14-byte record decode: little-endian raw `int32[3]` position,
  `uint8` intensity at byte offset 12 and one opaque `uint8` at byte offset 13.
- Exact scale/offset decoding, finite checks, raw and decoded extrema, seven
  deterministic quantiles per component, declared-range checks and per-node
  bounds checks with one scale unit of tolerance.
- Exact one-byte histograms, sums, observed ranges and distinct counts for the
  intensity and opaque attributes.
- An exact deep duplicate profile for inputs at or below 500,000 records,
  including unique positions, duplicate excess, full-record duplicates and the
  most repeated raw position.
- Twelve canonical 1024×1024 RGBA PNG diagnostics: three axis pairs by four
  modes, with fixed fit, camera, frontmost, tie-break and colour-map rules.
- Separate V8 facts, readiness and effective-checklist digests without changing
  V7 bytes, meanings, paths or download names.

The point-value profile accepts at most 64 MiB of octree bytes and 4,000,000
points, has a 30-second synchronous phase budget, and performs the exact deep
profile only through 500,000 points. Cancellation is observed before work and
at phase guards. Because decoding and PNG compression are synchronous on one
JavaScript thread, V8 does not promise a same-thread abort in the middle of an
individual compression phase.

## Real read-only evidence

The source remained:

`F:/gaussian splat -- xgrids/model/Reception_Room_2026-06-01-150618/project_data/model`

| Member | Bytes | SHA-256 |
| --- | ---: | --- |
| `metadata.json` | 1,299 | `65e314ff0908ba9a87a4e149f82c3bc76fe529fd0aa63b621c7c69b8e94a0d7e` |
| `hierarchy.bin` | 2,046 | `40d1fe4a74f7cd5f92ec6752bc9f5aebe5ba262795da8748c00363017f76e21b` |
| `octree.bin` | 2,453,318 | `c49eb7a959be867ef27b63ca1e17b36505566a882f359b642b268afb979e98f5` |

The unchanged bundle SHA-256 is
`f226739d3f8e94605b8c363a1b135986388b5cf920df0194ff960bfed5940fb2`.
Three final runs produced the same canonical V8 artifact chain:

`29da55f1… facts → 0106b768… readiness → 234e6dc2… checklist`

The runs completed in approximately 4.186, 3.926 and 3.220 seconds. Canonical
JSON sizes before the app's trailing newline were 25,369, 43,495 and 120,088
bytes respectively.

## Point-value and duplicate-profile findings

Raw position extrema are `[0,0,0]` to `[149560,160520,38990]`. Applying the
exact declared scale and offset gives numeric extrema:

- minimum `[-6.985000133514404,-13.258999824523926,-1.9420000314712524]`;
- maximum `[7.970999488665257,2.7929997699684463,1.9569998700317228]`;
- node-bound tolerance approximately `0.00009999999747378752` per component.

Across 525,711 decoded components, all values were finite. Intensity observed
1–255, sum 6,967,027 and 186 distinct values. The opaque byte declared as
`lcc prediction` observed 20–100, sum 14,415,430 and 79 distinct values; its
meaning remains unknown.

There are 168,929 unique raw positions and 6,308 records beyond the first at a
repeated position. Twelve positions have multiplicity greater than one. The
largest multiplicity is 6,298 at raw position `[62270,125420,30490]`. There are
168,936 unique complete 14-byte records and 6,301 duplicate complete records.
This crosses the frozen exact 1% duplicate-excess threshold and produces one
quality warning. It is an observation, not a conclusion about corruption or
cause.

## Deterministic diagnostic previews

The profile is
`deterministic_cpu_triplanar_rgba_png_fflate_0_8_2_v1`. Every image is
1024×1024 with a 32-pixel margin. In canonical order:

| View / mode | Occupied pixels | Max records/pixel | PNG bytes | PNG SHA-256 |
| --- | ---: | ---: | ---: | --- |
| `position_0_1 / omitted_component` | 107,704 | 6,298 | 271,188 | `b6d27263e2c8b8497e3ca622ee93ec239177fc29da0233bddca6fe05cedf2768` |
| `position_0_1 / intensity_byte` | 107,704 | 6,298 | 248,812 | `576b431d12ed8272adf1b9f0f771564edf03a77720720321d6065899d887a86c` |
| `position_0_1 / opaque_vendor_byte` | 107,704 | 6,298 | 177,798 | `41fb2aadfc010ab32f63b48e6b8aff3fe999656b7deb1b6c671b9a11f863db6c` |
| `position_0_1 / record_density` | 107,704 | 6,298 | 117,941 | `7cc169a071215e15448001e530ebc705f03ecff4b0cb843ab9cc4bb09677586d` |
| `position_0_2 / omitted_component` | 68,792 | 6,300 | 156,713 | `d845ca5fbf6f81b70fcacaaefc00c82414090b4ab531d737444437c774e36dd3` |
| `position_0_2 / intensity_byte` | 68,792 | 6,300 | 125,803 | `a36cba22279883e3edfc5d2d9cc286b19410812ea41102c13d3f1c55ceb2a8c6` |
| `position_0_2 / opaque_vendor_byte` | 68,792 | 6,300 | 113,083 | `69fc695a6dcb6e5fc176e165ca39bef3e786859302d7c36305cd80974a17511b` |
| `position_0_2 / record_density` | 68,792 | 6,300 | 60,642 | `a48887c8e605a97fbb5951d4d73c351420d83e643674ee4f1f840d1dc57870d9` |
| `position_1_2 / omitted_component` | 66,340 | 6,301 | 148,610 | `5b6e6ece11c83849d32bae29026fb3d4bcfb4ccf6f293c65b57af89d19eb5662` |
| `position_1_2 / intensity_byte` | 66,340 | 6,301 | 122,293 | `273dc74cf1d8683147e416af4bb11b022b213f7559d38b03b468906abdd1e7d7` |
| `position_1_2 / opaque_vendor_byte` | 66,340 | 6,301 | 109,895 | `0d38f277c38fc30f7483279a179775242973a691cf2f49372cdffe2b1096574d` |
| `position_1_2 / record_density` | 66,340 | 6,301 | 60,249 | `e07b935f17805838265d9e5e9ddd1c76d4adf15d072712dd0e4ff16d697e2637` |

These are private CPU diagnostics, not screenshots from the official Potree
renderer and not evidence of renderer fidelity.

## Product surface, fidelity ledger and verification

The loopback app adds a responsive V8 diagnostic workbench while preserving the
public V7 state, text, endpoints and three canonical V7 download filenames. The
only copy change is the new V8 diagnostic content.

Frontend fidelity ledger:

- inherited Georgia heading hierarchy;
- teal authority pills and section labels;
- cream paper surfaces and bordered cards;
- inherited V7 section rhythm and control sizing;
- one-column responsive collapse at the mobile layout;
- muted epistemic copy that distinguishes observations from authority.

In-app Browser QA exercised every one of the three plane controls, all four
modes, 2.5× zoom and reset. At desktop 1440×1000 and mobile 390×844, there was
no page-level horizontal overflow and the console contained no warning or
error. The selected image hash changed to the exact manifest identity for each
interaction. Live HTTP checks returned 200 for state, all three V8 JSON
downloads and the selected PNG attachment. The listener stopped and port 41776
was confirmed closed.

Final screenshots:

- `docs/reports/evidence/xgrids-potree-v8-diagnostic-desktop-2026-07-18.png`
  — SHA-256 `1335b7dcd98ed3aee0230e2d5676f1f01a19dd53d1ab618500354571e5413ad5`;
- `docs/reports/evidence/xgrids-potree-v8-diagnostic-mobile-390x844-2026-07-18.png`
  — SHA-256 `084f93206cd17e2e7642535ed65a668b94b9c7f8c2648922bd879bf71bd83a0b`.

Verification at this checkpoint:

- focused core V8: 29/29 across four files;
- focused local app V8: 39/39 across three files;
- focused core/tool lint, full core lint and core typecheck: passed;
- full core suite: 717 passed, one skipped; two failures belong to an unrelated
  shared untracked `local-inspection-handoff-package-v0` implementation;
- full tool suite: 623 passed; one older 500-file HTTP stress case ended in
  `ECONNRESET`; three isolated reruns reproduced the reset while polling the
  generic state route before admission or Potree preview assertions;
- `git diff --check`: passed.

The repeatable socket reset appears outside V8 preview behavior, but exact
causal independence from the global V8 intake integration is not claimed. The
whole core package typecheck is presently obstructed by the same unrelated
shared untracked handoff file's TS7056 inference errors. The tool package build
retains its pre-existing sibling-source `rootDir`/TS6307 packaging limitation;
its current full lint also reports one unrelated shared complete-handoff
optional-chain error, while the focused V8 lint remains clean.

## Evidence boundary

The exact machine-readable record is
`docs/reports/xgrids-potree-v2-point-values-v8-evidence-2026-07-18.json`.
It records all raw/decoded quantiles, pixel hashes, PNG hashes, UI checks and
gate qualifications. No source was changed and no reconstruction, external
service, paid compute, signing, release or publication occurred.

This completes only T-531's bounded V8 slice. T-508 and the broader OmniTwin
Foundry `/goal` remain active.

## Next bounded step

Do not widen V8 silently. A useful next product slice is a local operator review
flow that can compare these exact V8 diagnostics with the already frozen SOG,
SPZ and captured-quality evidence without converting any observation into
selection, processing permission or authority. Independent surveyed controls
and purpose-scoped rights remain later prerequisites for physical or release
claims, not blockers to ordinary local product development.
