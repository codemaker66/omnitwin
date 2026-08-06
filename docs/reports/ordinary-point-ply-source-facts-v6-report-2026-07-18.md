# Ordinary point PLY Source Facts V6 report

Date: 2026-07-18  
Workstream: T-508, ordinary offline product engineering  
Authority: none

## Outcome

The V6 ordinary point PLY slice is implemented, replayed against real files and
independently reviewed with no remaining P0-P2 correctness issue. It adds new
immutable Source Facts, Source Readiness and Operator Evidence digest domains
without widening V1-V5. No cybersecurity work is needed for this source
understanding path.

Gaussian inspection keeps precedence. If inherited Gaussian inspection
establishes or explicitly rejects a Gaussian target, V6 never reinterprets it
as ordinary point geometry. Otherwise, the ordinary inspector uses the same
already-open identity-checked handle and binds its result to the exact receipt
size and SHA-256. Cancellation issues no artifact.

## What V6 establishes

- Case-sensitive PLY 1.0 `binary_little_endian` syntax.
- Exactly one positive vertex element with unique fixed-width scalar
  properties and required declarations named `x`, `y` and `z`.
- Declared/canonical scalar type, property order, byte offset and byte width.
- Exact `header bytes + vertex count × record stride = source bytes`
  arithmetic with no trailing bytes.
- Header byte counts consistent with the recorded declarations and LF, CRLF or
  mixed line-ending mode.
- Deterministic readiness and evidence requests for all ten unresolved point
  facts.

It does not decode any coordinate, normal, colour or other scalar. Property
names do not establish semantics. Units, scale, frame, CRS, axes, geometry
role, bounds, density, completeness, accuracy, registration, provenance,
capture class, rights and authority remain explicit unknowns.

## Real read-only evidence

| Source | Bytes | Result | Final facts SHA-256 |
| --- | ---: | --- | --- |
| COLMAP `fused.ply` | 23,248 | Established: 852 vertices, 244-byte CRLF header, 27-byte stride, XYZ + normals + RGB | `bc792ad77dfe97afca30ae9b9b43cf302edc99abe1fd7c3bccf33b9afc826fe7` |
| LCC2 mesh `0_19.ply` | 6,359 | `POINT_PLY_EXTRA_ELEMENT_UNSUPPORTED`; no point facts | `2e36741598442af16dbb1b97fb8f222ffb67708ace4edb5e8ea53e0f9ee30f44` |
| `export_05000.ply` | 7,222,206 | Inherited Gaussian established; no ordinary-point fallthrough | `cc1a093340bf61ea5c51f21d02350f1de43b264792e2c38e2f5876442aeda4f6` |

Each source repeated byte-identically through receipt → facts → readiness →
checklist, and its size, mtime and SHA-256 were unchanged before and after. The
positive chain is:

`15895f3b… → bc792ad7… → 1fb58d77… → d60549ac…`

The positive file is a derived COLMAP `stereo_fusion` candidate. The nearby
script is not a digest-bound execution transcript, so the file is parser
evidence only—not captured, metric or authoritative geometry.

## Inventory and deferred profiles

The bounded repository and six-root inventory found 199 PLY files: 8 ordinary
point candidates, 64 meshes and 127 Gaussian files. It also found five XYZ
files and no LAS, LAZ, PTS or PCD input.

The 1.61 GB MatterPak `cloud.xyz` had only a bounded headerless XYZRGB prefix
observation. XYZ therefore waits for a distinct complete streaming-row
contract. LAS/LAZ waits for a real receipted input. Decoded point values and
physical bounds are also a separate later profile; none should silently widen
V6.

## Product surface and verification

The local app now uses V6 end to end and exposes a bounded nine-row property
table plus canonical Source Facts, Readiness and Checklist V6 downloads.
Rendered checks at 1280×720 and 390×844 found no page-level horizontal
overflow and no console warning/error. Wide evidence tables remain contained
in their own horizontal scrollers. All three V6 files were downloaded, found
on disk and independently hashed; the listener was then shut down.

Final verification:

- focused V6: 23/23 across three files;
- frozen V1-V5 compatibility: 57/57 across five files;
- Reconstruction Foundry: 610 passed and one existing skip across 49 files;
- core lint, typecheck and build: passed;
- focused local app: 46/46; CLI lint, typecheck and build: passed;
- the broad CLI suite remains red only in concurrently changing unrelated
  offline-preview tests plus a full-suite-only 20-second 500-file timeout; all
  implicated files pass alone and no deterministic V6 failure was found;
- final exact replay reproduced all three recorded chains;
- independent consistency review found no remaining P0-P2 correctness issue.

The exact machine-readable record is
`docs/reports/ordinary-point-ply-source-facts-v6-evidence-2026-07-18.json`.
This completes the bounded V6 slice only. T-508 and the broader OmniTwin
Foundry `/goal` remain active.

## Next bounded step

Do not widen V6 with XYZ, LAS/LAZ or decoded values. The next source profile
should be chosen only from a complete real-input pass with explicit byte,
line, count, cancellation and identity-binding limits. Authority claims still
need independent controls, reviewed transforms, provenance and rights, but
those gates do not block continued ordinary local super-app engineering.
